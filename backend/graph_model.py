"""
graph_model.py — Metro Network Graph Model
===========================================
Defines the core data structures for the metro network:
  - Station  : a node in the graph (one physical platform)
  - Edge     : a directed, weighted connection between two adjacent stations
  - MetroGraph: the full network as an adjacency-list graph

All connections are stored as *directed* edges internally (both directions),
but the JSON source has one entry per physical segment.
"""

from __future__ import annotations
import json
import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional


# ─── Data Classes ─────────────────────────────────────────────────────────────

@dataclass
class Station:
    """
    A metro station — node in the network graph.

    Attributes
    ----------
    id            : unique identifier (snake_case, used throughout the app)
    name          : human-readable display name
    lines         : list of metro lines this station belongs to
    x, y          : visual coordinates for map rendering (also used for h(n))
    is_interchange: True when the station serves ≥ 2 different lines
    """
    id: str
    name: str
    lines: List[str]
    x: float
    y: float
    is_interchange: bool = False

    def distance_to(self, other: Station) -> float:
        """Euclidean distance (coordinate units) to another station."""
        return math.sqrt((self.x - other.x) ** 2 + (self.y - other.y) ** 2)

    @property
    def primary_line(self) -> str:
        """The first (or only) line this station belongs to."""
        return self.lines[0]


@dataclass
class Edge:
    """
    A directed, weighted connection between two adjacent stations.

    Each undirected physical segment in the JSON becomes two directed Edge
    objects (one per direction) stored in MetroGraph.adjacency.

    Attributes
    ----------
    from_station : source station ID
    to_station   : destination station ID
    line         : metro line this connection belongs to
    travel_time  : time to traverse this segment (minutes)
    travel_cost  : base fare for this segment (₹ units)
    """
    from_station: str
    to_station: str
    line: str
    travel_time: float   # minutes
    travel_cost: float   # ₹ fare units

    @property
    def id(self) -> str:
        """Unique edge key: 'from__to'."""
        return f"{self.from_station}__{self.to_station}"


# ─── Metro Graph ───────────────────────────────────────────────────────────────

class MetroGraph:
    """
    The metro network represented as a weighted directed graph.

    Internally stores:
      - stations   : Dict[station_id, Station]
      - edges      : Dict[edge_id, Edge]          — both directed copies
      - adjacency  : Dict[station_id, List[Edge]] — outgoing edges per station
      - orig_edges : List[dict]                   — original JSON edge records
                     (used for API serialisation; avoids returning duplicates)
    """

    def __init__(self, data_path: str) -> None:
        with open(data_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)

        self.stations: Dict[str, Station] = {}
        self.edges: Dict[str, Edge] = {}
        self.adjacency: Dict[str, List[Edge]] = {}
        self._orig_edges: List[dict] = data["edges"]  # keep original 20 records

        # ── Load stations ──────────────────────────────────────────────────
        for s in data["stations"]:
            station = Station(
                id=s["id"],
                name=s["name"],
                lines=s["lines"],
                x=s["x"],
                y=s["y"],
                is_interchange=s.get("is_interchange", len(s["lines"]) > 1),
            )
            self.stations[station.id] = station
            self.adjacency[station.id] = []

        # ── Load edges (create both directions for each segment) ───────────
        for e in data["edges"]:
            for frm, to in [(e["from"], e["to"]), (e["to"], e["from"])]:
                edge = Edge(
                    from_station=frm,
                    to_station=to,
                    line=e["line"],
                    travel_time=float(e["travel_time"]),
                    travel_cost=float(e["travel_cost"]),
                )
                self.edges[edge.id] = edge
                self.adjacency[frm].append(edge)

    # ── Public helpers ─────────────────────────────────────────────────────

    def get_neighbors(self, station_id: str) -> List[Edge]:
        """All outgoing edges from a given station."""
        return self.adjacency.get(station_id, [])

    @property
    def station_ids(self) -> List[str]:
        return list(self.stations.keys())

    @property
    def edge_ids(self) -> List[str]:
        """IDs of all directed edges (both directions, 40 total)."""
        return list(self.edges.keys())

    def to_dict(self) -> dict:
        """
        Serialise graph for API responses.

        Returns stations (all 20) and edges (original 20 undirected segments
        only — not the 40 directed internal copies).
        """
        return {
            "stations": [
                {
                    "id": s.id,
                    "name": s.name,
                    "lines": s.lines,
                    "x": s.x,
                    "y": s.y,
                    "is_interchange": s.is_interchange,
                }
                for s in self.stations.values()
            ],
            "edges": [
                {
                    "from": e["from"],
                    "to": e["to"],
                    "line": e["line"],
                    "travel_time": e["travel_time"],
                    "travel_cost": e["travel_cost"],
                    "id": f"{e['from']}__{e['to']}",
                }
                for e in self._orig_edges
            ],
        }
