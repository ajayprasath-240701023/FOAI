"""
cost_calculator.py — Dynamic Edge Cost & Heuristic
====================================================
Implements the two key functions that drive the A* search:

1. calculate_edge_cost(edge, …)
   Computes the composite cost of traversing one edge:

       edge_cost = cost_weight   × travel_cost     (fare)
                 + time_weight   × travel_time      (minutes)
                 + crowd_weight  × crowd_penalty    (0 / 8 / 20)
                 + transfer_weight × transfer_penalty (0 or 25)

   All four components are multiplied by user-supplied weights (sliders in
   the UI), so the formula can be biased towards speed, cheapness, comfort,
   or minimal transfers on demand.

2. heuristic(station, goal)
   Admissible h(n) = Euclidean distance × SCALE.

   Admissibility proof
   -------------------
   Shortest physical edge in the network spans ≈ 75 px (suburban_north →
   central_hub on the Red Line).
   Minimum possible edge cost with the lowest legal weight (0.5) is:
       0.5 × 8 (fare) + 0.5 × 3 (time) = 5.5 units

   HEURISTIC_SCALE = 0.05  →  h(75 px) = 75 × 0.05 = 3.75 < 5.5  ✓
   h(n) never overestimates → A* remains optimal for any weight setting.
"""

import math
from typing import Optional

# ── Constants ──────────────────────────────────────────────────────────────────

# Cost applied when the traveller changes metro lines at an interchange.
TRANSFER_PENALTY: float = 25.0

# Scale that converts coordinate-unit distance → cost units for the heuristic.
# Kept conservative (0.05) to guarantee admissibility across all weight combos.
HEURISTIC_SCALE: float = 0.05

# Crowd penalty lookup (mirrors crowd_module.py — kept here for decoupling).
CROWD_PENALTIES = {"Low": 0.0, "Medium": 8.0, "High": 20.0}


# ── Calculator ────────────────────────────────────────────────────────────────

class CostCalculator:
    """
    Stateless helper used by AStarSearch to compute edge costs and h(n).
    """

    def calculate_edge_cost(
        self,
        edge,
        from_station,
        to_station,
        crowd_module,
        current_line: Optional[str],
        preferences: dict,
    ) -> float:
        """
        Compute the composite cost of traversing *edge* from *from_station*
        to *to_station*, given the current route context.

        Parameters
        ----------
        edge          : Edge object (has travel_time, travel_cost, line)
        from_station  : Station object (source of this step)
        to_station    : Station object (destination of this step)
        crowd_module  : CrowdModule — for crowd level lookup
        current_line  : the metro line currently being travelled, or None at start
        preferences   : dict with keys cost_weight / time_weight /
                        crowd_weight / transfer_weight  (all default 1.0)

        Returns
        -------
        float : composite cost (lower = preferred by A*)
        """
        cost_weight     = float(preferences.get("cost_weight",     1.0))
        time_weight     = float(preferences.get("time_weight",     1.0))
        crowd_weight    = float(preferences.get("crowd_weight",    1.0))
        transfer_weight = float(preferences.get("transfer_weight", 1.0))

        # ── Component 1: fare ──────────────────────────────────────────────
        travel_cost = edge.travel_cost

        # ── Component 2: time ─────────────────────────────────────────────
        time_cost = edge.travel_time

        # ── Component 3: crowd penalty at the destination station ─────────
        crowd_level   = crowd_module.get_crowd_level(to_station.id)
        crowd_penalty = CROWD_PENALTIES.get(crowd_level, 0.0)

        # ── Component 4: transfer penalty ─────────────────────────────────
        # A transfer occurs when the traveller boards a different line.
        # current_line is None only at the very first edge (no line yet).
        is_transfer     = (current_line is not None) and (edge.line != current_line)
        transfer_penalty = TRANSFER_PENALTY if is_transfer else 0.0

        return (
            cost_weight     * travel_cost
            + time_weight   * time_cost
            + crowd_weight  * crowd_penalty
            + transfer_weight * transfer_penalty
        )

    def heuristic(self, station, goal) -> float:
        """
        Admissible heuristic: h(n) = Euclidean distance × HEURISTIC_SCALE.

        Because we exclude crowd and transfer penalties from h(n), and because
        HEURISTIC_SCALE is chosen to be below the minimum cost-per-pixel
        achievable by any edge, this is always admissible (h(n) ≤ true cost).
        """
        dist = math.sqrt(
            (station.x - goal.x) ** 2 + (station.y - goal.y) ** 2
        )
        return dist * HEURISTIC_SCALE

    def decompose_edge_cost(
        self,
        edge,
        to_station,
        crowd_module,
        current_line: Optional[str],
        preferences: dict,
    ) -> dict:
        """
        Return each cost component separately (used for route result details).
        """
        cw  = float(preferences.get("cost_weight",     1.0))
        tw  = float(preferences.get("time_weight",     1.0))
        crw = float(preferences.get("crowd_weight",    1.0))
        trw = float(preferences.get("transfer_weight", 1.0))

        crowd_level   = crowd_module.get_crowd_level(to_station.id)
        crowd_penalty = CROWD_PENALTIES.get(crowd_level, 0.0)
        is_transfer   = (current_line is not None) and (edge.line != current_line)

        return {
            "travel_cost":     cw  * edge.travel_cost,
            "time_cost":       tw  * edge.travel_time,
            "crowd_penalty":   crw * crowd_penalty,
            "transfer_penalty": trw * (TRANSFER_PENALTY if is_transfer else 0.0),
        }
