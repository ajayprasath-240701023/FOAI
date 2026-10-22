"""
crowd_module.py — Crowd Level Management
=========================================
Tracks crowd levels (Low / Medium / High) per station.

Crowd level is used as a *penalty* in the A* edge cost function:
  Low    →  0 penalty  (no deterrent)
  Medium →  8 penalty  (moderate deterrent)
  High   → 20 penalty  (strong deterrent)

Levels can be:
  - Randomised (simulating real-time fluctuations) via randomize()
  - Set individually via set_crowd_level(station_id, level)
"""

import random
from typing import Dict

# ── Constants ──────────────────────────────────────────────────────────────────

CROWD_LEVELS = ["Low", "Medium", "High"]

# Penalty added to edge cost (destination station) for each crowd level.
CROWD_PENALTIES: Dict[str, float] = {
    "Low": 0,
    "Medium": 8,
    "High": 20,
}

# CSS/UI colours associated with each level (used by the API response).
CROWD_COLORS: Dict[str, str] = {
    "Low": "#69db7c",
    "Medium": "#ffd43b",
    "High": "#ff6b6b",
}

# Weighted probability for realistic crowd simulation.
# Stations are more often Low or Medium than High.
_CROWD_WEIGHTS = [50, 35, 15]  # Low : Medium : High


# ── Module ────────────────────────────────────────────────────────────────────

class CrowdModule:
    """
    Manages the simulated crowd levels for every station.

    Usage
    -----
    crowd = CrowdModule(metro.station_ids)
    level  = crowd.get_crowd_level("central_hub")   # → "Medium"
    penalty = crowd.get_crowd_penalty("central_hub") # → 8
    crowd.randomize()                                # simulate real-time change
    """

    def __init__(self, station_ids: list) -> None:
        # Initialise with a weighted-random crowd level per station.
        self.crowd_levels: Dict[str, str] = {
            sid: random.choices(CROWD_LEVELS, weights=_CROWD_WEIGHTS, k=1)[0]
            for sid in station_ids
        }
        # Seed key interchange hubs with peak rush-hour congestion
        if "central_hub" in self.crowd_levels:
            self.crowd_levels["central_hub"] = "High"
        if "expo_centre" in self.crowd_levels:
            self.crowd_levels["expo_centre"] = "High"
        if "old_town" in self.crowd_levels:
            self.crowd_levels["old_town"] = "Medium"
        if "market_plaza" in self.crowd_levels:
            self.crowd_levels["market_plaza"] = "Medium"

    # ── Read ──────────────────────────────────────────────────────────────

    def get_crowd_level(self, station_id: str) -> str:
        """Return the current crowd level string for a station."""
        return self.crowd_levels.get(station_id, "Low")

    def get_crowd_penalty(self, station_id: str) -> float:
        """Return the numeric penalty for the station's current crowd level."""
        level = self.get_crowd_level(station_id)
        return CROWD_PENALTIES.get(level, 0.0)

    def get_all_levels(self) -> Dict[str, str]:
        """Return the full {station_id: level} mapping."""
        return dict(self.crowd_levels)

    # ── Write ─────────────────────────────────────────────────────────────

    def set_crowd_level(self, station_id: str, level: str) -> None:
        """Set an explicit crowd level for a specific station."""
        if level not in CROWD_LEVELS:
            raise ValueError(f"Invalid crowd level '{level}'. Must be one of {CROWD_LEVELS}.")
        self.crowd_levels[station_id] = level

    def randomize(self) -> Dict[str, str]:
        """
        Simulate real-time crowd changes by re-randomising all station levels.
        Returns the updated crowd levels mapping.
        """
        for sid in self.crowd_levels:
            self.crowd_levels[sid] = random.choices(
                CROWD_LEVELS, weights=_CROWD_WEIGHTS, k=1
            )[0]
        return self.get_all_levels()

    def get_time_shifted_module(self, minutes: int) -> "CrowdModule":
        """
        Create a new CrowdModule representing dynamic crowd conditions at T + minutes.
        Simulates realistic rush-hour decay and passenger dispersal:
          - At T+0 : Live congestion (rush-hour peak).
          - At T+15: High crowds decay to Medium; Medium crowds clear to Low.
          - At T+30: Full off-peak clearance (all crowds clear to Low).
        """
        shifted = CrowdModule(list(self.crowd_levels.keys()))

        for sid, current in self.crowd_levels.items():
            if minutes <= 0:
                shifted.crowd_levels[sid] = current
            elif minutes <= 15:
                if current == "High":
                    shifted.crowd_levels[sid] = "Medium"
                elif current == "Medium":
                    shifted.crowd_levels[sid] = "Low"
                else:
                    shifted.crowd_levels[sid] = "Low"
            else:  # T >= 30
                shifted.crowd_levels[sid] = "Low"

        return shifted

