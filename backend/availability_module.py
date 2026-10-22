"""
availability_module.py — Station & Edge Availability
=====================================================
Tracks operational status (open / closed) for every station and edge.

**Hard constraint**: unavailable stations and edges are *completely excluded*
from the A* search graph before the algorithm runs — they are never merely
penalised. This is the correct approach for modelling closures or disruptions:
a closed station simply does not exist in the search space.

Design
------
- Stations are keyed by their station ID.
- Edges are keyed as (from_station_id, to_station_id) tuples.
- Toggling an edge marks *both* directed copies as unavailable, since the
  physical segment is bidirectional.
"""

from typing import Dict, List, Tuple


class AvailabilityModule:
    """
    Manages the open/closed status of metro stations and connections.

    Usage
    -----
    avail = AvailabilityModule(metro.station_ids, metro.edge_ids)

    # Hard constraint check inside A*:
    if not avail.is_station_available("central_hub"):
        continue   # skip node entirely

    # Simulate a disruption:
    avail.toggle_station("central_hub")
    avail.toggle_edge("university", "central_hub")
    """

    def __init__(self, station_ids: List[str], edge_ids: List[str]) -> None:
        # All stations start operational.
        self.station_status: Dict[str, bool] = {sid: True for sid in station_ids}

        # Parse directed edge IDs ("from__to") → (from, to) tuple.
        # Initialise all edges as available.
        self.edge_status: Dict[Tuple[str, str], bool] = {}
        for eid in edge_ids:
            parts = eid.split("__")
            if len(parts) == 2:
                self.edge_status[(parts[0], parts[1])] = True

    # ── Station availability ───────────────────────────────────────────────

    def is_station_available(self, station_id: str) -> bool:
        """Return True if the station is currently operational."""
        return self.station_status.get(station_id, True)

    def toggle_station(self, station_id: str) -> dict:
        """
        Toggle a station between open and closed.
        Returns the new status so the API can return it directly.
        """
        current = self.station_status.get(station_id, True)
        self.station_status[station_id] = not current
        return {"station_id": station_id, "available": not current}

    def set_station(self, station_id: str, available: bool) -> None:
        self.station_status[station_id] = available

    # ── Edge availability ─────────────────────────────────────────────────

    def is_edge_available(self, from_id: str, to_id: str) -> bool:
        """Return True if the connection is operational in *either* direction."""
        fwd = self.edge_status.get((from_id, to_id), True)
        rev = self.edge_status.get((to_id, from_id), True)
        return fwd and rev

    def toggle_edge(self, from_id: str, to_id: str) -> dict:
        """
        Toggle a bidirectional edge between open and closed.
        Both directed copies are updated together.
        """
        current = self.edge_status.get((from_id, to_id), True)
        self.edge_status[(from_id, to_id)] = not current
        self.edge_status[(to_id, from_id)] = not current
        return {
            "from_station": from_id,
            "to_station": to_id,
            "available": not current,
        }

    # ── Bulk read ─────────────────────────────────────────────────────────

    def get_all_status(self) -> dict:
        """
        Return all availability data in a deduplicated form.

        Edges are deduplicated (only the canonical from<to direction is kept)
        so the API doesn't return both directions as separate keys.
        """
        seen_edges: set = set()
        edges_out: Dict[str, bool] = {}

        for (frm, to), status in self.edge_status.items():
            pair = tuple(sorted([frm, to]))
            if pair not in seen_edges:
                seen_edges.add(pair)
                edges_out[f"{pair[0]}__{pair[1]}"] = status

        return {
            "stations": dict(self.station_status),
            "edges": edges_out,
        }
