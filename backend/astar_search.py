"""
astar_search.py — A* Search Engine
=====================================
Core AI algorithm for the AI Metro route planner.

Algorithm Overview
------------------
State   : (station_id, current_line)
          — capturing the *line* in the state is essential: two arrivals at the
            same interchange station via different lines have different onward
            costs (one incurs a transfer penalty, the other does not).

Open set: min-heap on f(n) = g(n) + h(n)
          Entries: (f, tie_break_counter, station_id, current_line,
                    g_value, path_stations, path_lines)
          tie_break_counter is an incrementing integer that breaks f-value ties
          deterministically without comparing lists.

Closed set: set of (station_id, current_line) states already expanded.
            A state is added only when it is *popped* from the heap (not when
            pushed), consistent with the canonical A* algorithm.

Termination: when the popped node equals the destination.

Trace
-----
Every pop from the heap produces a TraceStep record that captures f/g/h and
the action taken (START / EXPLORE / SKIP / GOAL). This trace is returned to
the frontend for the live A* visualisation.

Alternative Routes
------------------
A simplified Yen's-style approach:
  For each intermediate station in the optimal path, re-run A* with that
  station excluded from the graph. Return the best differing path found.
  This is O(k × A*) where k = number of intermediate stations.
"""

import heapq
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple


# ─── Result & Trace Data Classes ──────────────────────────────────────────────

@dataclass
class PathResult:
    """
    A complete route from source to destination.

    Attributes
    ----------
    stations     : ordered station IDs (source first, destination last)
    lines        : line for each segment; lines[0] is None (no line at source)
    total_time   : sum of travel_time for all edges on the path (minutes)
    total_fare   : sum of travel_cost for all edges on the path (₹)
    total_score  : A* g-value — the composite cost used for ranking
    transfers    : number of line changes along the route
    crowd_levels : crowd level at each station in the path
    rank         : 1 = optimal, 2 = first alternative
    resilience_score : 0-100% network resilience metric
    resilience_label : description of resilience status
    resilience_alternatives_count : count of alternatives within 15% cost
    """
    stations: List[str]
    lines: List[Optional[str]]
    total_time: float
    total_fare: float
    total_score: float
    transfers: int
    crowd_levels: List[str]
    rank: int = 1
    resilience_score: int = 50
    resilience_label: str = "Moderate"
    resilience_alternatives_count: int = 0


@dataclass
class TraceStep:
    """
    One step in the A* exploration — recorded for the visualisation panel.

    action values:
      "START"   — source node added to open set
      "EXPLORE" — node expanded (popped from heap, neighbours enqueued)
      "SKIP"    — node popped but already in closed set (duplicate)
      "GOAL"    — destination reached
    """
    step_index: int
    station_id: str
    station_name: str
    f_value: float
    g_value: float
    h_value: float
    current_line: Optional[str]
    action: str
    path_so_far: List[str]


# ─── Search Engine ────────────────────────────────────────────────────────────

class AStarSearch:
    """
    A* Search Engine.

    Usage
    -----
    astar = AStarSearch()
    paths, trace = astar.search(
        graph, "west_terminal", "south_terminal",
        crowd, availability, cost_calc,
        preferences={"crowd_weight": 2.0},
        num_paths=2
    )
    """

    # ── Public entry point ────────────────────────────────────────────────

    def search(
        self,
        graph,
        source_id: str,
        destination_id: str,
        crowd_module,
        availability_module,
        cost_calculator,
        preferences: dict,
        num_paths: int = 2,
    ) -> Tuple[List[PathResult], List[TraceStep]]:
        """
        Find up to *num_paths* routes and a full A* exploration trace.

        Returns
        -------
        (List[PathResult], List[TraceStep])
          — results ordered best-first; trace from the first (optimal) search.
        """
        all_paths: List[PathResult] = []

        # ── Step 1: optimal path ──────────────────────────────────────────
        optimal, trace = self._astar_single(
            graph, source_id, destination_id,
            crowd_module, availability_module, cost_calculator, preferences,
            excluded_nodes=set(), excluded_edges=set(),
        )

        if not optimal:
            return [], trace

        optimal.rank = 1
        all_paths.append(optimal)

        # ── Step 2: alternative path & resilience score ──────────────────
        alt, score, label, close_count = self._find_alternatives_and_resilience(
            graph, source_id, destination_id,
            crowd_module, availability_module, cost_calculator, preferences,
            optimal,
        )
        optimal.resilience_score = score
        optimal.resilience_label = label
        optimal.resilience_alternatives_count = close_count

        if num_paths > 1 and alt:
            alt.rank = 2
            alt.resilience_score = score
            alt.resilience_label = label
            alt.resilience_alternatives_count = close_count
            all_paths.append(alt)

        return all_paths, trace

    # ── Core A* ──────────────────────────────────────────────────────────

    def _astar_single(
        self,
        graph,
        source_id: str,
        destination_id: str,
        crowd_module,
        availability_module,
        cost_calculator,
        preferences: dict,
        excluded_nodes: Set[str],
        excluded_edges: Set[Tuple[str, str]],
    ) -> Tuple[Optional[PathResult], List[TraceStep]]:
        """
        Run one A* search with optional exclusion sets.

        Excluded nodes / edges enforce the *hard constraint* for both
        unavailability (set by AvailabilityModule) and the alternative-route
        search (temporarily excluding path nodes to force a detour).
        """

        trace: List[TraceStep] = []

        # ── Pre-checks ────────────────────────────────────────────────────
        if (
            source_id in excluded_nodes
            or not availability_module.is_station_available(source_id)
            or not availability_module.is_station_available(destination_id)
        ):
            return None, trace

        goal = graph.stations[destination_id]
        h_start = cost_calculator.heuristic(graph.stations[source_id], goal)

        # ── Open set ──────────────────────────────────────────────────────
        # Entry: (f, counter, station_id, current_line, g, path_stations, path_lines)
        counter = 0
        open_set: List = []
        heapq.heappush(open_set, (
            h_start, counter,
            source_id, None,          # station, line (None = not boarded yet)
            0.0,                       # g(source) = 0
            [source_id], [None],       # path_stations, path_lines
        ))

        # ── Closed set & best-g tracking ──────────────────────────────────
        closed_set: Set[Tuple[str, Optional[str]]] = set()
        best_g: Dict[Tuple[str, Optional[str]], float] = {(source_id, None): 0.0}

        step_idx = 0

        # Record START
        trace.append(TraceStep(
            step_index=step_idx,
            station_id=source_id,
            station_name=graph.stations[source_id].name,
            f_value=round(h_start, 2),
            g_value=0.0,
            h_value=round(h_start, 2),
            current_line=None,
            action="START",
            path_so_far=[source_id],
        ))

        # ── Main loop ─────────────────────────────────────────────────────
        while open_set:
            f, _, curr_id, curr_line, g, path_stations, path_lines = heapq.heappop(open_set)

            state = (curr_id, curr_line)

            # ── Closed set check ──────────────────────────────────────────
            if state in closed_set:
                step_idx += 1
                h = cost_calculator.heuristic(graph.stations[curr_id], goal)
                trace.append(TraceStep(
                    step_index=step_idx,
                    station_id=curr_id,
                    station_name=graph.stations[curr_id].name,
                    f_value=round(f, 2),
                    g_value=round(g, 2),
                    h_value=round(h, 2),
                    current_line=curr_line,
                    action="SKIP",
                    path_so_far=list(path_stations),
                ))
                continue

            closed_set.add(state)
            step_idx += 1

            # ── Goal check ────────────────────────────────────────────────
            if curr_id == destination_id:
                trace.append(TraceStep(
                    step_index=step_idx,
                    station_id=curr_id,
                    station_name=graph.stations[curr_id].name,
                    f_value=round(f, 2),
                    g_value=round(g, 2),
                    h_value=0.0,
                    current_line=curr_line,
                    action="GOAL",
                    path_so_far=list(path_stations),
                ))
                result = self._build_result(
                    path_stations, path_lines, g, graph, crowd_module
                )
                return result, trace

            # ── Record EXPLORE ────────────────────────────────────────────
            h = cost_calculator.heuristic(graph.stations[curr_id], goal)
            trace.append(TraceStep(
                step_index=step_idx,
                station_id=curr_id,
                station_name=graph.stations[curr_id].name,
                f_value=round(f, 2),
                g_value=round(g, 2),
                h_value=round(h, 2),
                current_line=curr_line,
                action="EXPLORE",
                path_so_far=list(path_stations),
            ))

            # ── Expand neighbours ─────────────────────────────────────────
            for edge in graph.get_neighbors(curr_id):
                nbr_id = edge.to_station

                # Hard constraints ─────────────────────────────────────────
                if nbr_id in excluded_nodes:
                    continue
                if (curr_id, nbr_id) in excluded_edges:
                    continue
                if not availability_module.is_station_available(nbr_id):
                    continue
                if not availability_module.is_edge_available(curr_id, nbr_id):
                    continue

                nbr_state = (nbr_id, edge.line)
                if nbr_state in closed_set:
                    continue

                # Compute g(neighbour) ─────────────────────────────────────
                edge_cost = cost_calculator.calculate_edge_cost(
                    edge=edge,
                    from_station=graph.stations[curr_id],
                    to_station=graph.stations[nbr_id],
                    crowd_module=crowd_module,
                    current_line=curr_line,
                    preferences=preferences,
                )
                new_g = g + edge_cost

                # Only enqueue if this is a better path to nbr_state ───────
                if new_g < best_g.get(nbr_state, float("inf")):
                    best_g[nbr_state] = new_g
                    h_nbr = cost_calculator.heuristic(graph.stations[nbr_id], goal)
                    new_f = new_g + h_nbr
                    counter += 1
                    heapq.heappush(open_set, (
                        new_f, counter,
                        nbr_id, edge.line,
                        new_g,
                        path_stations + [nbr_id],
                        path_lines + [edge.line],
                    ))

        # Open set exhausted — no path exists.
        return None, trace

    # ── Alternative route ─────────────────────────────────────────────────

    def _find_alternatives_and_resilience(
        self,
        graph,
        source_id: str,
        destination_id: str,
        crowd_module,
        availability_module,
        cost_calculator,
        preferences: dict,
        optimal: PathResult,
    ) -> Tuple[Optional[PathResult], int, str, int]:
        """
        Find all viable alternatives by excluding each intermediate station
        (and primary edges) one at a time using Yen's K-shortest approach.
        Calculates Network Resilience Score (0-100%) based on how many
        fallback routes exist within a 15% cost threshold of the optimal route.
        """
        intermediates = optimal.stations[1:-1]
        unique_alts: Dict[Tuple[str, ...], PathResult] = {}

        if not intermediates:
            excluded_edges = {(source_id, destination_id), (destination_id, source_id)}
            alt, _ = self._astar_single(
                graph, source_id, destination_id,
                crowd_module, availability_module, cost_calculator, preferences,
                excluded_nodes=set(), excluded_edges=excluded_edges,
            )
            if alt and alt.stations != optimal.stations:
                unique_alts[tuple(alt.stations)] = alt
        else:
            for station_to_exclude in intermediates:
                alt, _ = self._astar_single(
                    graph, source_id, destination_id,
                    crowd_module, availability_module, cost_calculator, preferences,
                    excluded_nodes={station_to_exclude}, excluded_edges=set(),
                )
                if alt and alt.stations != optimal.stations:
                    key = tuple(alt.stations)
                    if key not in unique_alts or alt.total_score < unique_alts[key].total_score:
                        unique_alts[key] = alt

        sorted_alts = sorted(unique_alts.values(), key=lambda p: p.total_score)
        best_alt = sorted_alts[0] if sorted_alts else None

        # Calculate resilience based on alternatives within 15% cost margin
        threshold = 0.15
        max_cost = optimal.total_score * (1.0 + threshold)
        close_alts = [a for a in sorted_alts if a.total_score <= max_cost]
        close_count = len(close_alts)

        if close_count >= 3:
            score = min(90 + close_count * 2, 98)
            label = f"HIGH RESILIENCE ({close_count} fallback routes ≤15% cost)"
        elif close_count == 2:
            score = 80
            label = "STRONG RESILIENCE (2 fallback routes ≤15% cost)"
        elif close_count == 1:
            score = 60
            label = "MODERATE (1 fallback route available within +15% cost)"
        elif len(sorted_alts) > 0:
            score = 35
            label = "FRAGILE (Alternatives incur significant cost penalty)"
        else:
            score = 15
            label = "CRITICAL FRAGILITY (Zero alternative routes available)"

        return best_alt, score, label, close_count

    # ── Path result builder ───────────────────────────────────────────────

    @staticmethod
    def _build_result(
        path_stations: List[str],
        path_lines: List[Optional[str]],
        total_score: float,
        graph,
        crowd_module,
    ) -> PathResult:
        """
        Assemble a PathResult from the raw path data stored in the heap.
        Computes true travel time, fare, and transfer count from the edges.
        """
        base_edge_time = 0.0
        total_fare = 0.0
        transfers = 0
        current_line: Optional[str] = None
        crowd_levels: List[str] = []

        for i, sid in enumerate(path_stations):
            crowd_levels.append(crowd_module.get_crowd_level(sid))

            if i > 0:
                prev_id = path_stations[i - 1]
                edge_line = path_lines[i]
                edge = graph.edges.get(f"{prev_id}__{sid}")
                if edge:
                    base_edge_time += edge.travel_time
                    total_fare += edge.travel_cost

                if current_line is not None and edge_line != current_line:
                    transfers += 1
                current_line = edge_line

        # Real-world dynamic delays:
        # High crowd adds +2m platform boarding/dwell delay, Medium adds +1m
        # Transfers incur +2m interchange walking connection delay
        crowd_delay = sum(2.0 if c == "High" else 1.0 if c == "Medium" else 0.0 for c in crowd_levels)
        transfer_walk_delay = transfers * 2.0
        total_time = base_edge_time + crowd_delay + transfer_walk_delay

        return PathResult(
            stations=list(path_stations),
            lines=list(path_lines),
            total_time=round(total_time, 1),
            total_fare=total_fare,
            total_score=round(total_score, 2),
            transfers=transfers,
            crowd_levels=crowd_levels,
        )
