"""Quick smoke test — run from project root: python backend/test_smoke.py"""
import sys
sys.path.insert(0, 'backend')

from graph_model import MetroGraph
from crowd_module import CrowdModule
from availability_module import AvailabilityModule
from cost_calculator import CostCalculator
from astar_search import AStarSearch

import os
_DATA_PATH = 'backend/metro_network.json' if os.path.exists('backend/metro_network.json') else 'metro_network.json'
metro = MetroGraph(_DATA_PATH)
crowd = CrowdModule(metro.station_ids)
avail = AvailabilityModule(metro.station_ids, metro.edge_ids)
calc  = CostCalculator()
astar = AStarSearch()

print(f"Stations   : {len(metro.stations)}")
print(f"Edges dir. : {len(metro.edges)}")
print(f"Edges orig : {len(metro._orig_edges)}")

# Test 1: direct Blue Line route
paths, trace = astar.search(metro, 'west_terminal', 'east_terminal', crowd, avail, calc, {}, 2)
assert len(paths) >= 1, "Expected at least 1 path"
print(f"\nTest 1 — West Terminal -> East Terminal")
for p in paths:
    names = " -> ".join(metro.stations[s].name for s in p.stations)
    print(f"  Rank {p.rank}: {names}")
    print(f"    time={p.total_time}min  fare=Rs{p.total_fare}  transfers={p.transfers}")

# Test 2: multi-line route requiring transfers
paths2, trace2 = astar.search(metro, 'airport', 'northern_heights', crowd, avail, calc, {}, 2)
assert len(paths2) >= 1, "Expected at least 1 path"
print(f"\nTest 2 — Airport -> Northern Heights")
for p in paths2:
    names = " -> ".join(metro.stations[s].name for s in p.stations)
    print(f"  Rank {p.rank}: {names}")
    print(f"    time={p.total_time}min  fare=Rs{p.total_fare}  transfers={p.transfers}")

# Test 3: availability exclusion
avail.toggle_station('central_hub')  # close central hub
paths3, _ = astar.search(metro, 'west_terminal', 'east_terminal', crowd, avail, calc, {}, 1)
print(f"\nTest 3 — Blue route with Central Hub CLOSED: {len(paths3)} path(s) found")
if paths3:
    names = " -> ".join(metro.stations[s].name for s in paths3[0].stations)
    print(f"  Route: {names}")
avail.toggle_station('central_hub')  # re-open

# Test 4: trace length
_, trace4 = astar.search(metro, 'north_connect', 'south_terminal', crowd, avail, calc, {}, 1)
print(f"\nTest 4 — Trace steps (North Connect -> South Terminal): {len(trace4)}")

# Test 5: Route Resilience score
paths5, _ = astar.search(metro, 'west_terminal', 'south_terminal', crowd, avail, calc, {}, 2)
assert len(paths5) >= 1
print(f"\nTest 5 — Route Resilience Score: {paths5[0].resilience_score}% ({paths5[0].resilience_label})")
assert 0 <= paths5[0].resilience_score <= 100

# Test 6: Time-Shift crowd simulation
crowd_15 = crowd.get_time_shifted_module(15)
crowd_30 = crowd.get_time_shifted_module(30)
assert len(crowd_15.get_all_levels()) == 20
assert len(crowd_30.get_all_levels()) == 20
print(f"\nTest 6 — Time-Shift modules generated successfully (T+15, T+30)")

# Test 7: Multi-Agent debate synthesis (fallback)
from api import _synthesize_dispatcher_debate, _serialise_route
r_route = _serialise_route(paths5[0])
transcript, chosen = _synthesize_dispatcher_debate(
    "West Terminal", "South Terminal", r_route, r_route, r_route
)
assert len(transcript) == 4
print(f"\nTest 7 — Transit Council Debate generated: {len(transcript)} dialogue turns, chosen={chosen}")

print("\nALL SMOKE TESTS PASSED (7/7) [OK]")

