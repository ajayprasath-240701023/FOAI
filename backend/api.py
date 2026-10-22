"""
api.py — FastAPI Application
==============================
Wires all modules together and exposes a REST API for the frontend.

Endpoints
---------
GET  /                          → serves frontend/index.html
GET  /api/graph                 → full graph + live crowd + availability
POST /api/route                 → A* route search
GET  /api/crowd                 → current crowd levels
POST /api/crowd/randomize       → simulate real-time crowd changes
PUT  /api/crowd/{station_id}    → set a specific station's crowd level
PUT  /api/station/{id}/toggle   → toggle station open/closed
PUT  /api/edge/{from}/{to}/toggle → toggle edge open/closed
GET  /api/status                → all availability statuses

Run with:
    uvicorn api:app --reload --host 0.0.0.0 --port 8000
"""

import os
import json
import urllib.request
import urllib.error
import sys
from pathlib import Path

from typing import Optional, Tuple, Dict, List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# ── Module resolution (run from backend/ OR project root) ─────────────────────
sys.path.insert(0, str(Path(__file__).parent))

def _load_env_file():
    """Load key-value pairs from .env into os.environ if not already set."""
    candidates = [
        Path(".env"),
        Path("../.env"),
        Path(__file__).parent / ".env",
        Path(__file__).parent.parent / ".env",
    ]
    for env_path in candidates:
        if env_path.is_file():
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip("'\"")
                            if k and (k not in os.environ or not os.environ[k]):
                                os.environ[k] = v
            except Exception:
                pass

_load_env_file()

from graph_model import MetroGraph
from crowd_module import CrowdModule
from availability_module import AvailabilityModule
from cost_calculator import CostCalculator
from astar_search import AStarSearch

# ─── App Setup ─────────────────────────────────────────────────────────────────

app = FastAPI(
    title="AI Metro — Crowd-Aware Route Planner",
    description=(
        "A* search-based metro route planner with dynamic crowd simulation "
        "and real-time availability control."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Initialise modules ────────────────────────────────────────────────────────

_BACKEND_DIR  = Path(__file__).parent
_FRONTEND_DIR = _BACKEND_DIR.parent / "frontend"
_DATA_FILE    = _BACKEND_DIR / "metro_network.json"

metro    = MetroGraph(str(_DATA_FILE))
crowd    = CrowdModule(metro.station_ids)
avail    = AvailabilityModule(metro.station_ids, metro.edge_ids)
cost_calc = CostCalculator()
astar    = AStarSearch()

# ─── Pydantic models ───────────────────────────────────────────────────────────

class Preferences(BaseModel):
    cost_weight:     float = Field(default=1.0, ge=0.0, le=10.0)
    time_weight:     float = Field(default=1.0, ge=0.0, le=10.0)
    crowd_weight:    float = Field(default=1.0, ge=0.0, le=10.0)
    transfer_weight: float = Field(default=1.0, ge=0.0, le=10.0)


class RouteRequest(BaseModel):
    source:         str
    destination:    str
    preferences:    Preferences = Preferences()
    num_paths:      int = Field(default=2, ge=1, le=3)
    departure_time: str = Field(default="t", description="Departure window: 't', 't+15', or 't+30'")


class CrowdLevelRequest(BaseModel):
    level: str  # "Low" | "Medium" | "High"


class CouncilDebateRequest(BaseModel):
    source: str
    destination: str


class TimeShiftRequest(BaseModel):
    source:      str
    destination: str
    preferences: Optional[Preferences] = None


# ─── API Endpoints ─────────────────────────────────────────────────────────────

@app.get("/api/graph", summary="Full metro graph with live crowd & availability")
def get_graph():
    """
    Returns all stations and edges enriched with current:
    - crowd_level   (Low / Medium / High)
    - available     (True / False)
    """
    graph_data  = metro.to_dict()
    crowd_data  = crowd.get_all_levels()
    status_data = avail.get_all_status()

    for station in graph_data["stations"]:
        sid = station["id"]
        station["crowd_level"] = crowd_data.get(sid, "Low")
        station["available"]   = status_data["stations"].get(sid, True)

    for edge in graph_data["edges"]:
        eid = edge["id"]
        # Canonical key is alphabetically sorted pair
        pair_key = "__".join(sorted([edge["from"], edge["to"]]))
        edge["available"] = status_data["edges"].get(pair_key, True)

    return graph_data


@app.post("/api/route", summary="Find optimal (+ alternative) route via A*")
def find_route(request: RouteRequest):
    """
    Run the A* search engine and return:
    - up to `num_paths` routes (optimal first, then best alternative)
    - the full A* exploration trace (f/g/h per step) for visualisation
    - support for departure windows: t (now), t+15, and t+30
    """
    if request.source not in metro.stations:
        raise HTTPException(404, detail=f"Station '{request.source}' not found.")
    if request.destination not in metro.stations:
        raise HTTPException(404, detail=f"Station '{request.destination}' not found.")
    if request.source == request.destination:
        raise HTTPException(400, detail="Source and destination must differ.")

    prefs = {
        "cost_weight":     request.preferences.cost_weight,
        "time_weight":     request.preferences.time_weight,
        "crowd_weight":    request.preferences.crowd_weight,
        "transfer_weight": request.preferences.transfer_weight,
    }

    # Select crowd module based on departure time window
    if request.departure_time == "t+15":
        active_crowd = crowd.get_time_shifted_module(15)
    elif request.departure_time == "t+30":
        active_crowd = crowd.get_time_shifted_module(30)
    else:
        active_crowd = crowd

    paths, trace = astar.search(
        graph=metro,
        source_id=request.source,
        destination_id=request.destination,
        crowd_module=active_crowd,
        availability_module=avail,
        cost_calculator=cost_calc,
        preferences=prefs,
        num_paths=request.num_paths,
    )

    if not paths:
        return {
            "routes": [],
            "trace": _serialise_trace(trace),
            "departure_time": request.departure_time,
            "message": "No route found. Some stations may be unavailable.",
        }

    return {
        "routes": [_serialise_route(p) for p in paths],
        "trace":  _serialise_trace(trace),
        "departure_time": request.departure_time,
    }


@app.get("/api/crowd", summary="Current crowd levels for all stations")
def get_crowd():
    return crowd.get_all_levels()


@app.post("/api/crowd/randomize", summary="Simulate real-time crowd changes")
def randomize_crowd():
    """Randomise all station crowd levels (weighted: mostly Low/Medium)."""
    return crowd.randomize()


@app.put("/api/crowd/{station_id}", summary="Set a specific station's crowd level")
def set_crowd(station_id: str, body: CrowdLevelRequest):
    if station_id not in metro.stations:
        raise HTTPException(404, detail=f"Station '{station_id}' not found.")
    crowd.set_crowd_level(station_id, body.level)
    return {"station_id": station_id, "level": body.level}


@app.put("/api/station/{station_id}/toggle", summary="Toggle station open/closed")
def toggle_station(station_id: str):
    """
    Mark a station as closed for maintenance (or re-open it).
    Closed stations are *excluded* from the A* graph on the next search.
    """
    if station_id not in metro.stations:
        raise HTTPException(404, detail=f"Station '{station_id}' not found.")
    return avail.toggle_station(station_id)


@app.put("/api/edge/{from_id}/{to_id}/toggle", summary="Toggle edge open/closed")
def toggle_edge(from_id: str, to_id: str):
    if from_id not in metro.stations or to_id not in metro.stations:
        raise HTTPException(404, detail="One or both stations not found.")
    return avail.toggle_edge(from_id, to_id)


@app.get("/api/status", summary="All station & edge availability statuses")
def get_status():
    return avail.get_all_status()


@app.post("/api/council-debate", summary="Multi-Agent Transit Council debate (Rusher, Relaxer, Hawk)")
def council_debate(request: CouncilDebateRequest):
    """
    Executes the Multi-Agent Transit Council:
      1. The Rusher (speed priority)
      2. The Relaxer (crowd & transfer avoidance)
      3. The Hawk (fare/cost minimization)
    Synthesizes a 3-way debate + Dispatcher compromise via Groq Llama-3.1
    (or deterministic SCADA Dispatcher fallback).
    """
    if request.source not in metro.stations or request.destination not in metro.stations:
        raise HTTPException(404, detail="Source or destination station not found.")
    if request.source == request.destination:
        raise HTTPException(400, detail="Source and destination must differ.")

    # 1. Agent 1: The Rusher (Time Optimizer)
    rusher_prefs = {"time_weight": 2.5, "crowd_weight": 0.0, "transfer_weight": 0.2, "cost_weight": 0.5}
    rusher_paths, _ = astar.search(metro, request.source, request.destination, crowd, avail, cost_calc, rusher_prefs, 1)

    # 2. Agent 2: The Relaxer (Comfort Advocate)
    relaxer_prefs = {"time_weight": 0.5, "crowd_weight": 2.5, "transfer_weight": 2.2, "cost_weight": 0.5}
    relaxer_paths, _ = astar.search(metro, request.source, request.destination, crowd, avail, cost_calc, relaxer_prefs, 1)

    # 3. Agent 3: The Hawk (Budget Maximizer)
    hawk_prefs = {"cost_weight": 2.5, "time_weight": 0.5, "crowd_weight": 0.5, "transfer_weight": 0.5}
    hawk_paths, _ = astar.search(metro, request.source, request.destination, crowd, avail, cost_calc, hawk_prefs, 1)

    if not rusher_paths or not relaxer_paths or not hawk_paths:
        raise HTTPException(404, detail="No route found between selected terminals.")

    r_route = _serialise_route(rusher_paths[0])
    l_route = _serialise_route(relaxer_paths[0])
    h_route = _serialise_route(hawk_paths[0])

    source_name = metro.stations[request.source].name
    dest_name = metro.stations[request.destination].name

    # Try Groq Llama-3.1 API first if available
    llm_result = _call_groq_debate(source_name, dest_name, r_route, l_route, h_route)

    if llm_result and "debate" in llm_result:
        debate_transcript = llm_result["debate"]
        chosen_agent = llm_result.get("chosen_agent", "relaxer")
    else:
        debate_transcript, chosen_agent = _synthesize_dispatcher_debate(
            source_name, dest_name, r_route, l_route, h_route
        )

    if chosen_agent == "rusher":
        compromise_route = r_route
    elif chosen_agent == "hawk":
        compromise_route = h_route
    else:
        compromise_route = l_route

    return {
        "source": source_name,
        "destination": dest_name,
        "debate": debate_transcript,
        "agents": {
            "rusher": r_route,
            "relaxer": l_route,
            "hawk": h_route
        },
        "compromise_route": compromise_route,
        "engine": "Groq Llama-3.1-8b" if (llm_result and os.environ.get("GROQ_API_KEY")) else "SCADA Dispatcher Heuristic"
    }


@app.post("/api/time-shift", summary="Time-shift departure windows analysis (T+0, T+15, T+30)")
def time_shift_analysis(request: TimeShiftRequest):
    """
    Simulates departure at T=0, T+15, and T+30 minutes using crowd decay modeling.
    Returns comparison matrix and advisory recommendation.
    """
    if request.source not in metro.stations or request.destination not in metro.stations:
        raise HTTPException(404, detail="Source or destination station not found.")
    if request.source == request.destination:
        raise HTTPException(400, detail="Source and destination must differ.")

    if request.preferences:
        prefs = {
            "cost_weight":     request.preferences.cost_weight,
            "time_weight":     request.preferences.time_weight,
            "crowd_weight":    request.preferences.crowd_weight,
            "transfer_weight": request.preferences.transfer_weight,
        }
    else:
        prefs = {"cost_weight": 1.0, "time_weight": 1.0, "crowd_weight": 2.0, "transfer_weight": 1.2}

    # Window 1: Depart Now (T+0)
    w0_paths, _ = astar.search(metro, request.source, request.destination, crowd, avail, cost_calc, prefs, 1)

    # Window 2: Depart T+15
    crowd_15 = crowd.get_time_shifted_module(15)
    w15_paths, _ = astar.search(metro, request.source, request.destination, crowd_15, avail, cost_calc, prefs, 1)

    # Window 3: Depart T+30
    crowd_30 = crowd.get_time_shifted_module(30)
    w30_paths, _ = astar.search(metro, request.source, request.destination, crowd_30, avail, cost_calc, prefs, 1)

    if not w0_paths:
        raise HTTPException(404, detail="No viable path found.")

    r0 = _serialise_route(w0_paths[0])
    r15 = _serialise_route(w15_paths[0]) if w15_paths else r0
    r30 = _serialise_route(w30_paths[0]) if w30_paths else r0

    if r0["crowd_summary"] == "High" and r15["crowd_summary"] in ["Medium", "Low"]:
        advice = f"ADVISORY: Delaying departure by 15 mins bypasses peak interchange congestion (drops from {r0['crowd_summary']} to {r15['crowd_summary']}), arriving with minimal duration penalty."
    elif r30["crowd_summary"] == "Low" and r0["crowd_summary"] != "Low":
        advice = f"ADVISORY: T+30 window offers complete off-peak clearance ({r30['total_time']} min · Low crowd index across entire track line)."
    else:
        advice = f"ADVISORY: Immediate dispatch (T+0) is optimal ({r0['total_time']} min · {r0['crowd_summary']} crowd index). Delaying departure provides negligible benefit."

    return {
        "windows": [
            {
                "window": "T+0",
                "label": "DEPART NOW",
                "time": r0["total_time"],
                "fare": r0["total_fare"],
                "transfers": r0["transfers"],
                "crowd": r0["crowd_summary"],
                "stations": r0["station_names"]
            },
            {
                "window": "T+15",
                "label": "WAIT 15 MIN",
                "time": r15["total_time"],
                "fare": r15["total_fare"],
                "transfers": r15["transfers"],
                "crowd": r15["crowd_summary"],
                "stations": r15["station_names"]
            },
            {
                "window": "T+30",
                "label": "WAIT 30 MIN",
                "time": r30["total_time"],
                "fare": r30["total_fare"],
                "transfers": r30["transfers"],
                "crowd": r30["crowd_summary"],
                "stations": r30["station_names"]
            }
        ],
        "advice": advice
    }


# ─── Serve Frontend ────────────────────────────────────────────────────────────

if _FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(_FRONTEND_DIR)), name="static")

    @app.get("/", include_in_schema=False)
    def serve_index():
        return FileResponse(str(_FRONTEND_DIR / "index.html"))


# ─── Helpers ───────────────────────────────────────────────────────────────────

def _serialise_route(path) -> dict:
    """Convert a PathResult to a JSON-serialisable dict."""
    station_names = [metro.stations[s].name for s in path.stations]
    lines_used = list(dict.fromkeys(
        [ln for ln in path.lines if ln is not None]
    ))  # unique, ordered

    return {
        "rank":           path.rank,
        "stations":       path.stations,
        "station_names":  station_names,
        "lines":          path.lines,
        "lines_used":     lines_used,
        "total_time":     path.total_time,
        "total_fare":     path.total_fare,
        "total_score":    path.total_score,
        "transfers":      path.transfers,
        "crowd_levels":   path.crowd_levels,
        "crowd_summary":  _crowd_summary(path.crowd_levels),
        "resilience_score": getattr(path, "resilience_score", 50),
        "resilience_label": getattr(path, "resilience_label", "Moderate"),
        "resilience_alternatives_count": getattr(path, "resilience_alternatives_count", 0),
    }


def _serialise_trace(trace) -> list:
    """Convert list[TraceStep] to a JSON-serialisable list of dicts."""
    return [
        {
            "step":         t.step_index,
            "station_id":   t.station_id,
            "station_name": t.station_name,
            "f":            t.f_value,
            "g":            t.g_value,
            "h":            t.h_value,
            "line":         t.current_line,
            "action":       t.action,
            "path":         t.path_so_far,
        }
        for t in trace
    ]


def _crowd_summary(crowd_levels: list) -> str:
    """Summarise the overall crowd experience along a route."""
    if not crowd_levels:
        return "Low"
    if "High" in crowd_levels:
        return "High"
    if "Medium" in crowd_levels:
        return "Medium"
    return "Low"


def _call_groq_debate(source_name: str, dest_name: str, r_route: dict, l_route: dict, h_route: dict) -> Optional[dict]:
    """
    Calls the Groq API (llama-3.1-8b-instant) to generate a multi-agent debate transcript.
    Returns parsed JSON dict or None on error / missing key.
    """
    groq_api_key = os.environ.get("GROQ_API_KEY")
    if not groq_api_key:
        return None

    prompt = f"""
Urban Transit Control Room Dispatch Debate.
Source: {source_name} -> Destination: {dest_name}

Agent 1 - The Rusher (Speed Focus):
Route: {" -> ".join(r_route["station_names"])}
Duration: {r_route["total_time"]} min | Fare: Rs {r_route["total_fare"]} | Transfers: {r_route["transfers"]} | Crowd: {r_route["crowd_summary"]}

Agent 2 - The Relaxer (Comfort & Low Crowd Focus):
Route: {" -> ".join(l_route["station_names"])}
Duration: {l_route["total_time"]} min | Fare: Rs {l_route["total_fare"]} | Transfers: {l_route["transfers"]} | Crowd: {l_route["crowd_summary"]}

Agent 3 - The Hawk (Budget & Fare Focus):
Route: {" -> ".join(h_route["station_names"])}
Duration: {h_route["total_time"]} min | Fare: Rs {h_route["total_fare"]} | Transfers: {h_route["transfers"]} | Crowd: {h_route["crowd_summary"]}

You are the gritty, decisive Transit Dispatcher in a SCADA control room.
Write 1 sharp statement from The Rusher, 1 from The Relaxer, 1 from The Hawk, and the final Dispatcher Verdict selecting the compromise route.
Respond ONLY with a JSON object in this exact structure:
{{
  "debate": [
    {{"speaker": "The Rusher", "type": "rusher", "text": "..."}},
    {{"speaker": "The Relaxer", "type": "relaxer", "text": "..."}},
    {{"speaker": "The Hawk", "type": "hawk", "text": "..."}},
    {{"speaker": "Dispatcher Verdict", "type": "dispatcher", "text": "..."}}
  ],
  "chosen_agent": "relaxer"
}}
"""
    try:
        req_data = json.dumps({
            "model": "llama-3.1-8b-instant",
            "messages": [
                {"role": "system", "content": "You are the Transit Dispatcher for AI Metro SCADA Control Room. Return valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.5,
            "response_format": {"type": "json_object"}
        }).encode("utf-8")

        req = urllib.request.Request(
            "https://api.groq.com/openai/v1/chat/completions",
            data=req_data,
            headers={
                "Authorization": f"Bearer {groq_api_key}",
                "Content-Type": "application/json"
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            content = data["choices"][0]["message"]["content"]
            return json.loads(content)
    except Exception:
        return None


def _synthesize_dispatcher_debate(source_name: str, dest_name: str, r_route: dict, l_route: dict, h_route: dict) -> Tuple[list, str]:
    """
    Deterministic SCADA Dispatcher debate synthesizer used when LLM API is unavailable.
    Produces authentic, gritty multi-agent control room dialogue.
    """
    rusher_line = f"Clock says {r_route['total_time']} min. Speed is non-negotiable. Take the direct line regardless of platform density."
    
    if l_route["crowd_summary"] != r_route["crowd_summary"]:
        relaxer_line = f"Vetoed! Rusher is sending commuters into a {r_route['crowd_summary']}-crowd choke point. My route clocks {l_route['total_time']} min with {l_route['crowd_summary']} crowd index."
    else:
        relaxer_line = f"Transfers matter. With {l_route['transfers']} line switches and {l_route['crowd_summary']} crowd, passenger comfort remains protected."

    if h_route["total_fare"] < r_route["total_fare"]:
        hawk_line = f"You're burning commuter credits. My itinerary caps the fare at Rs {h_route['total_fare']}, saving hard cash on every transfer."
    else:
        hawk_line = f"Ledger verified. At Rs {h_route['total_fare']}, travel economics are strictly balanced."

    # Choose the balanced route
    if l_route["crowd_summary"] in ["Low", "Medium"] and l_route["total_time"] <= r_route["total_time"] + 4:
        chosen = "relaxer"
        dispatcher_line = f"DISPATCHER ORDER: Compromise approved. Routing via Relaxer's path ({l_route['total_time']} min · {l_route['crowd_summary']} crowd) to prevent bottlenecking at interchanges."
    elif r_route["total_time"] + 5 < l_route["total_time"]:
        chosen = "rusher"
        dispatcher_line = f"DISPATCHER ORDER: Excessive delay on alternate tracks. Expediting Rusher's express itinerary ({r_route['total_time']} min)."
    else:
        chosen = "relaxer"
        dispatcher_line = f"DISPATCHER ORDER: Standard protocol active. Authorizing Comfort Corridor ({l_route['total_time']} min · Rs {l_route['total_fare']})."

    transcript = [
        {"speaker": "The Rusher [Time Priority]", "type": "rusher", "text": rusher_line},
        {"speaker": "The Relaxer [Comfort Priority]", "type": "relaxer", "text": relaxer_line},
        {"speaker": "The Hawk [Budget Priority]", "type": "hawk", "text": hawk_line},
        {"speaker": "Dispatcher Ruling", "type": "dispatcher", "text": dispatcher_line}
    ]

    return transcript, chosen

