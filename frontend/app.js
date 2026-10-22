/**
 * app.js — AI Metro Dashboard Controller v2.5
 * ============================================
 * Coordinates the 3-panel neural transit dashboard:
 *  - Top command bar with live HUD and Web Audio FX
 *  - Left sidebar: quick trip chips, profile policies, disruption deck
 *  - Center: MetroCanvas interactive map with HTML glass tooltips
 *  - Right panel: turn-by-turn itinerary, comparison cards, and A* inspector
 */

'use strict';

const API = '';

// ── Routing Preference Profiles ──────────────────────────────────────────────

const PRESETS = {
  balanced: {
    weights: { time_weight: 1.0, crowd_weight: 1.0, transfer_weight: 1.0, cost_weight: 1.0 },
    hint: 'Balanced Weights (Equal Priority)'
  },
  avoid_crowds: {
    weights: { time_weight: 0.1, crowd_weight: 6.0, transfer_weight: 0.5, cost_weight: 0.1 },
    hint: 'Optimal Comfort (Bypasses Congested Hubs)'
  },
  fastest: {
    weights: { time_weight: 5.0, crowd_weight: 0.05, transfer_weight: 0.1, cost_weight: 0.1 },
    hint: 'Minimal Travel Time (Speed Priority)'
  },
  minimal_transfers: {
    weights: { time_weight: 0.2, crowd_weight: 0.2, transfer_weight: 8.0, cost_weight: 0.2 },
    hint: 'Direct Journey (Minimizes Line Changes)'
  }
};

// ── Web Audio FX Synthesizer (Zero external dependencies) ───────────────────

let audioCtx = null;
let soundEnabled = true;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playAudioFx(type = 'click') {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (type === 'click') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.04);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.04);
    } else if (type === 'select') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(640, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'route') {
      // 3-note ascending victory chime
      [523.25, 659.25, 783.99].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.06);
        gain.gain.setValueAtTime(0.12, now + idx * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.16);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.06);
        osc.stop(now + idx * 0.06 + 0.16);
      });
    } else if (type === 'step') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(960, now);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.03);
    } else if (type === 'disrupt') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.12);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    }
  } catch (e) {
    // Audio context silently ignored if unavailable
  }
}

// ── Application State ────────────────────────────────────────────────────────

let graphData = null;
let metroCanvas = null;

let selectedSource = null;
let selectedDest = null;
let clickMode = 'source';

let currentRoutes = [];
let activeRouteIdx = 0;
let currentTrace = [];

let tracePlaying = false;
let traceIdx = 0;
let traceTimer = null;
let traceSpeedMs = 250;

let hoveredStation = null;
let currentDepartureWindow = 't';

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  initLucideIcons();
  initTransitClock();
  initCanvas();
  initPresets();
  initDeparturePills();
  initQuickChips();
  initButtons();
  initSoundToggle();
  initDisruptionSearch();
  initStationTooltipActions();
  initLegendToggle();
  initAccordion();
  initKeyboardShortcuts();
  initCouncilModal();
  initScenarioChips();
  initPassModal();
  await loadNetwork();
});

function initLucideIcons() {
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

// ── Live UTC Clock ───────────────────────────────────────────────────────────

function initTransitClock() {
  const clockEl = document.getElementById('transit-clock');
  if (!clockEl) return;

  function update() {
    const d = new Date();
    const hrs = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    const secs = String(d.getSeconds()).padStart(2, '0');
    clockEl.innerHTML = `${hrs}:${mins}:${secs} <span class="clock-zone">SYS</span>`;
  }
  update();
  setInterval(update, 1000);
}

// ── Sound Toggle ─────────────────────────────────────────────────────────────

function initSoundToggle() {
  const btn = document.getElementById('btn-toggle-sound');
  if (!btn) return;

  btn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    btn.classList.toggle('active', soundEnabled);
    const icon = document.getElementById('sound-icon');
    if (icon) {
      icon.setAttribute('data-lucide', soundEnabled ? 'volume-2' : 'volume-x');
      initLucideIcons();
    }
    if (soundEnabled) playAudioFx('select');
  });
}

// ── Canvas Setup ─────────────────────────────────────────────────────────────

function initCanvas() {
  const container = document.getElementById('map-viewport');
  if (!container) return;

  metroCanvas = new MetroCanvas(container, {
    onStationClick: handleMapStationClick,
    onStationHover: handleMapStationHover,
    onStationLeave: handleMapStationLeave
  });

  document.getElementById('btn-map-fit')?.addEventListener('click', () => {
    playAudioFx('click');
    metroCanvas.fit();
  });
  document.getElementById('btn-map-reset')?.addEventListener('click', () => {
    playAudioFx('click');
    metroCanvas.resetView();
  });
  document.getElementById('btn-map-zoomin')?.addEventListener('click', () => {
    playAudioFx('click');
    metroCanvas.scale = Math.min(metroCanvas.scale * 1.2, metroCanvas.maxScale);
    metroCanvas.requestRender();
  });
  document.getElementById('btn-map-zoomout')?.addEventListener('click', () => {
    playAudioFx('click');
    metroCanvas.scale = Math.max(metroCanvas.scale * 0.83, metroCanvas.minScale);
    metroCanvas.requestRender();
  });
}

function handleMapStationClick(station) {
  if (!station.available) {
    playAudioFx('disrupt');
    updateMapStatus(`Station "${station.name}" is currently offline for maintenance`);
    return;
  }

  playAudioFx('select');

  if (clickMode === 'source' || !selectedSource) {
    selectedSource = station.id;
    clickMode = 'dest';
    syncDropdowns();
    updateMapStatus(`Origin selected: ${station.name} — Now select destination`);
  } else {
    if (selectedSource === station.id) {
      updateMapStatus('Destination station must be different from origin');
      return;
    }
    selectedDest = station.id;
    clickMode = 'source';
    syncDropdowns();
    updateMapStatus(`Route selected: ${getStationName(selectedSource)} → ${station.name}`);
  }

  metroCanvas.setEndpoints(selectedSource, selectedDest);
  updateFindButtonState();
  hideStationTooltip();
}

// ── Station Tooltip Overlay ──────────────────────────────────────────────────

function handleMapStationHover(station, screenPos) {
  hoveredStation = station;
  const statusEl = document.getElementById('map-status-text');

  if (station) {
    const status = station.available !== false ? 'Operational' : 'Closed / Maintenance';
    const linesStr = Array.isArray(station.lines)
      ? station.lines.map(l => metroCanvas.lineDisplayNames[l] || l).join(' / ')
      : '';
    const crowd = station.crowd_level || 'Low';

    if (statusEl) {
      statusEl.textContent = `${station.name} — ${status} · Crowd: ${crowd} · ${linesStr}`;
    }

    showStationTooltip(station, screenPos);
  }
}

function handleMapStationLeave() {
  hoveredStation = null;
  hideStationTooltip();
  const statusEl = document.getElementById('map-status-text');
  if (statusEl) {
    if (selectedSource && selectedDest) {
      statusEl.textContent = `Route: ${getStationName(selectedSource)} → ${getStationName(selectedDest)}`;
    } else {
      statusEl.textContent = 'Ready — Select departure and arrival stations to compute optimal path';
    }
  }
}

function showStationTooltip(station, screenPos) {
  const tt = document.getElementById('station-tooltip');
  if (!tt || !screenPos) return;

  const ttName = document.getElementById('tt-name');
  const ttAvail = document.getElementById('tt-avail');
  const ttDot = document.getElementById('tt-dot');
  const ttLines = document.getElementById('tt-lines');
  const ttCrowd = document.getElementById('tt-crowd');
  const ttCrowdBar = document.getElementById('tt-crowd-bar');

  if (ttName) ttName.textContent = station.name;

  const isAvail = station.available !== false;
  if (ttAvail) {
    ttAvail.textContent = isAvail ? 'Operational' : 'Closed';
    ttAvail.className = `tooltip-avail ${isAvail ? 'online' : 'offline'}`;
  }
  if (ttDot) {
    ttDot.className = `tooltip-dot ${isAvail ? 'online' : 'offline'}`;
  }

  if (ttLines) {
    ttLines.innerHTML = '';
    const lines = Array.isArray(station.lines) ? station.lines : [station.line || 'Blue'];
    lines.forEach(l => {
      const sp = document.createElement('span');
      const lName = (l || '').toLowerCase();
      sp.className = `tt-line-tag ${lName === 'green' ? 'line-a' : lName === 'blue' ? 'line-b' : 'line-c'}`;
      sp.textContent = metroCanvas?.lineDisplayNames?.[l] || l;
      ttLines.appendChild(sp);
    });
  }

  const crowd = station.crowd_level || 'Low';
  if (ttCrowd) ttCrowd.textContent = crowd;

  if (ttCrowdBar) {
    const pct = crowd === 'High' ? 88 : crowd === 'Medium' ? 58 : 24;
    ttCrowdBar.style.width = `${pct}%`;
    ttCrowdBar.className = `tt-crowd-bar-fill ${crowd === 'High' ? 'high' : crowd === 'Medium' ? 'med' : 'low'}`;
  }

  // Positioning with viewport bounds checking
  const container = document.getElementById('map-viewport');
  if (container) {
    const rect = container.getBoundingClientRect();
    let left = screenPos.x + 18;
    let top = screenPos.y - 40;

    if (left + 230 > rect.width) left = screenPos.x - 240;
    if (top + 160 > rect.height) top = rect.height - 170;
    if (top < 10) top = 10;

    tt.style.left = `${left}px`;
    tt.style.top = `${top}px`;
    tt.style.display = 'block';
  }
}

function hideStationTooltip() {
  const tt = document.getElementById('station-tooltip');
  if (tt) tt.style.display = 'none';
}

function initStationTooltipActions() {
  document.getElementById('tt-btn-src')?.addEventListener('click', () => {
    if (!hoveredStation) return;
    playAudioFx('select');
    selectedSource = hoveredStation.id;
    syncDropdowns();
    metroCanvas.setEndpoints(selectedSource, selectedDest);
    updateFindButtonState();
    hideStationTooltip();
    updateMapStatus(`Origin set: ${hoveredStation.name}`);
  });

  document.getElementById('tt-btn-dst')?.addEventListener('click', () => {
    if (!hoveredStation) return;
    playAudioFx('select');
    selectedDest = hoveredStation.id;
    syncDropdowns();
    metroCanvas.setEndpoints(selectedSource, selectedDest);
    updateFindButtonState();
    hideStationTooltip();
    updateMapStatus(`Destination set: ${hoveredStation.name}`);
  });
}

// ── Network Loading ──────────────────────────────────────────────────────────

async function loadNetwork() {
  updateMapStatus('Loading neural metro network graph…');
  try {
    const res = await fetch(`${API}/api/graph`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    graphData = await res.json();

    metroCanvas.setData(graphData.stations, graphData.edges);
    populateDropdowns(graphData.stations);
    buildDisruptionsList(graphData.stations);

    updateMapStatus(`Network online — ${graphData.stations.length} stations connected across 3 active lines`);
  } catch (err) {
    console.error('Failed to load network:', err);
    updateMapStatus('Error: Failed to connect to AI Metro API server');
  }
}

// ── Dropdowns ────────────────────────────────────────────────────────────────

function populateDropdowns(stations) {
  const srcSel = document.getElementById('source-select');
  const dstSel = document.getElementById('dest-select');
  if (!srcSel || !dstSel) return;

  srcSel.innerHTML = '<option value="">Select departure station…</option>';
  dstSel.innerHTML = '<option value="">Select arrival station…</option>';

  const sorted = [...stations].sort((a, b) => a.name.localeCompare(b.name));
  for (const s of sorted) {
    const lineLabel = Array.isArray(s.lines)
      ? s.lines.map(l => metroCanvas.lineDisplayNames[l] || l).join('/')
      : '';
    const text = `${s.name} (${lineLabel})`;

    const o1 = new Option(text, s.id);
    const o2 = new Option(text, s.id);
    srcSel.appendChild(o1);
    dstSel.appendChild(o2);
  }

  srcSel.addEventListener('change', (e) => {
    playAudioFx('select');
    selectedSource = e.target.value || null;
    metroCanvas.setEndpoints(selectedSource, selectedDest);
    updateFindButtonState();
  });

  dstSel.addEventListener('change', (e) => {
    playAudioFx('select');
    selectedDest = e.target.value || null;
    metroCanvas.setEndpoints(selectedSource, selectedDest);
    updateFindButtonState();
  });
}

function syncDropdowns() {
  const s = document.getElementById('source-select');
  const d = document.getElementById('dest-select');
  if (s) s.value = selectedSource || '';
  if (d) d.value = selectedDest || '';
}

function updateFindButtonState() {
  const btn = document.getElementById('btn-find-route');
  const valid = selectedSource && selectedDest && selectedSource !== selectedDest;
  if (btn) btn.disabled = !valid;
}

// ── Quick Demo Trips ─────────────────────────────────────────────────────────

function initQuickChips() {
  document.querySelectorAll('.quick-chip-btn').forEach(chip => {
    chip.addEventListener('click', () => {
      const src = chip.dataset.src;
      const dst = chip.dataset.dst;
      if (!src || !dst) return;

      playAudioFx('select');
      selectedSource = src;
      selectedDest = dst;
      syncDropdowns();
      metroCanvas.setEndpoints(selectedSource, selectedDest);
      updateFindButtonState();

      // Trigger automatic route search for instant delight
      executeAStarSearch();
    });
  });

  // Top header Quick Demo button
  document.getElementById('btn-quick-demo')?.addEventListener('click', () => {
    playAudioFx('select');
    selectedSource = 'airport';
    selectedDest = 'central_hub';
    syncDropdowns();
    metroCanvas.setEndpoints(selectedSource, selectedDest);
    updateFindButtonState();
    executeAStarSearch();
  });
}

// ── Optimization Policy Presets ──────────────────────────────────────────────

function initPresets() {
  document.querySelectorAll('#preset-pills .pill').forEach(btn => {
    btn.addEventListener('click', () => {
      playAudioFx('click');
      const key = btn.dataset.preset;
      if (!PRESETS[key]) return;

      document.querySelectorAll('#preset-pills .pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');

      const hintEl = document.getElementById('policy-hint');
      if (hintEl) hintEl.textContent = PRESETS[key].hint;

      // Recalculate if endpoints are ready
      if (selectedSource && selectedDest && selectedSource !== selectedDest) {
        executeAStarSearch();
      }
    });
  });
}

function getActivePresetWeights() {
  const activeBtn = document.querySelector('#preset-pills .pill.active');
  const key = activeBtn?.dataset.preset || 'balanced';
  return { ...PRESETS[key].weights };
}

// ── Departure Time Window Pills (t, t+15, t+30) ──────────────────────────────

function initDeparturePills() {
  document.querySelectorAll('#departure-pills .pill').forEach(btn => {
    btn.addEventListener('click', () => {
      playAudioFx('click');
      const win = btn.dataset.window || 't';
      currentDepartureWindow = win;

      document.querySelectorAll('#departure-pills .pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');

      const hintEl = document.getElementById('departure-hint');
      if (hintEl) {
        hintEl.textContent = win === 't' ? 'Now (t)' : win === 't+15' ? '+15m (t+15)' : '+30m (t+30)';
      }

      if (selectedSource && selectedDest && selectedSource !== selectedDest) {
        executeAStarSearch();
      }
    });
  });
}

// ── Buttons ──────────────────────────────────────────────────────────────────

function initButtons() {
  // Swap
  document.getElementById('btn-swap')?.addEventListener('click', () => {
    playAudioFx('click');
    const tmp = selectedSource;
    selectedSource = selectedDest;
    selectedDest = tmp;
    syncDropdowns();
    metroCanvas.setEndpoints(selectedSource, selectedDest);
    updateFindButtonState();
    if (selectedSource && selectedDest) executeAStarSearch();
  });

  // Find Route
  document.getElementById('btn-find-route')?.addEventListener('click', () => {
    executeAStarSearch();
  });

  // Simulate Crowd
  document.getElementById('btn-simulate-crowd')?.addEventListener('click', () => {
    playAudioFx('click');
    simulateCrowdRandomize();
  });

  // Reset System (both sidebar and nav reset)
  document.getElementById('btn-reset-all')?.addEventListener('click', () => {
    playAudioFx('click');
    resetAllSystem();
  });
  document.getElementById('btn-nav-reset')?.addEventListener('click', () => {
    playAudioFx('click');
    resetAllSystem();
  });

  // Trace Playback controls
  document.getElementById('btn-trace-play')?.addEventListener('click', () => {
    playAudioFx('click');
    toggleTracePlayback();
  });
  document.getElementById('btn-trace-step')?.addEventListener('click', () => {
    playAudioFx('step');
    stepTraceForward();
  });
  document.getElementById('btn-trace-prev')?.addEventListener('click', () => {
    playAudioFx('step');
    stepTraceBackward();
  });
  document.getElementById('btn-trace-reset')?.addEventListener('click', () => {
    playAudioFx('click');
    resetTrace();
  });

  // Speed selector
  document.querySelectorAll('#speed-selector .speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      playAudioFx('click');
      document.querySelectorAll('#speed-selector .speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      traceSpeedMs = parseInt(btn.dataset.speed, 10) || 250;
      if (tracePlaying) {
        pauseTrace();
        playTrace();
      }
    });
  });
}

// ── Keyboard Shortcuts ───────────────────────────────────────────────────────

function initKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    if (e.key === 'Enter') {
      const btn = document.getElementById('btn-find-route');
      if (btn && !btn.disabled) {
        executeAStarSearch();
      }
    } else if (e.key === 'Escape') {
      hideStationTooltip();
    }
  });
}

// ── Legend Toggle ────────────────────────────────────────────────────────────

function initLegendToggle() {
  const legend = document.getElementById('map-legend');
  const btn = document.getElementById('legend-toggle-btn');
  if (legend && btn) {
    btn.addEventListener('click', () => {
      playAudioFx('click');
      legend.classList.toggle('collapsed');
    });
  }
}

// ── Alt Route Accordion ──────────────────────────────────────────────────────

function initAccordion() {
  const trigger = document.getElementById('alt-accordion-trigger');
  const accordion = document.getElementById('alt-accordion');
  if (trigger && accordion) {
    trigger.addEventListener('click', () => {
      playAudioFx('click');
      accordion.classList.toggle('open');
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// A* ROUTE SEARCH EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════

async function executeAStarSearch() {
  if (!selectedSource || !selectedDest) return;

  const findBtn = document.getElementById('btn-find-route');
  const spinner = document.getElementById('search-spinner');
  if (findBtn) findBtn.disabled = true;
  if (spinner) spinner.classList.remove('hidden');

  updateMapStatus('Computing crowd-weighted A* heuristic path…');

  try {
    const payload = {
      source: selectedSource,
      destination: selectedDest,
      preferences: getActivePresetWeights(),
      departure_time: currentDepartureWindow,
      num_paths: 2
    };

    const res = await fetch(`${API}/api/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Route search failed');

    currentRoutes = data.routes || [];
    currentTrace = data.trace || [];
    activeRouteIdx = 0;

    if (currentRoutes.length === 0) {
      showEmptyRouteState('No traversable path found — check network disruptions');
      updateMapStatus('No viable route available due to line/station closures');
      playAudioFx('disrupt');
      return;
    }

    playAudioFx('route');
    displayRoute(currentRoutes[0]);
    renderAltTabs(currentRoutes);
    renderTraceTable(currentTrace);
    updateInspectorMetrics(currentTrace);

    // Show alternative path on canvas if found
    if (currentRoutes.length > 1) {
      metroCanvas.setAltRoute(currentRoutes[1].stations, currentRoutes[1].lines);
      showAltAccordion(currentRoutes[0], currentRoutes[1]);
    } else {
      metroCanvas.setAltRoute([], []);
      hideAltAccordion();
    }

    // Fetch dynamic crowd forecast across time windows (t, t+15, t+30)
    fetchTimeShiftAnalysis(selectedSource, selectedDest);

    const r = currentRoutes[0];
    const winLabel = currentDepartureWindow === 't' ? 'Now (t)' : currentDepartureWindow === 't+15' ? 't+15' : 't+30';
    updateMapStatus(`Optimal route [${winLabel}]: ${r.total_time} min · ₹${r.total_fare} · ${r.transfers} transfer(s) · Crowd: ${r.crowd_summary}`);

    // Update canvas top banner
    showCanvasBanner(`Optimal Route (${winLabel}): ${getStationName(selectedSource)} ➔ ${getStationName(selectedDest)} (${r.total_time} min)`);
  } catch (err) {
    console.error(err);
    updateMapStatus(`Error: ${err.message}`);
    playAudioFx('disrupt');
  } finally {
    if (findBtn) findBtn.disabled = false;
    if (spinner) spinner.classList.add('hidden');
  }
}

function showCanvasBanner(text) {
  const banner = document.getElementById('canvas-top-banner');
  const bannerText = document.getElementById('banner-route-text');
  if (banner && bannerText) {
    bannerText.textContent = text;
    banner.style.display = 'flex';
  }
}

function hideCanvasBanner() {
  const banner = document.getElementById('canvas-top-banner');
  if (banner) banner.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE DISPLAY & METRICS
// ═══════════════════════════════════════════════════════════════════════════════

function displayRoute(route) {
  if (!route) return;

  metroCanvas.setActiveRoute(route.stations, route.lines);

  // Key stat values
  setMetric('metric-time', `${route.total_time}`);
  setMetric('metric-time-sub', 'Minutes travel');

  setMetric('metric-fare', `₹${route.total_fare}`);
  setMetric('metric-fare-sub', 'Standard Smart Card');

  setMetric('metric-transfers', `${route.transfers}`);
  setMetric('metric-transfer-sub', route.transfers === 0 ? 'Direct Journey' : `${route.transfers} Line Change`);

  setMetric('metric-crowd', route.crowd_summary || 'Low');
  setMetric('metric-crowd-sub', `${route.crowd_summary} Density`);

  // Animate stat tiles
  document.querySelectorAll('.stat-tile').forEach(t => {
    t.classList.remove('animate-in');
    void t.offsetWidth;
    t.classList.add('animate-in');
  });

  // Route Rank Badge
  const badge = document.getElementById('route-rank-badge');
  if (badge) {
    badge.textContent = route.rank === 1 ? 'Optimal Route' : `Alternative #${route.rank}`;
    badge.className = `route-rank-badge ${route.rank === 1 ? 'optimal' : 'alt'}`;
  }

  // Action Buttons (Boarding Pass & Debate)
  const passBtn = document.getElementById('btn-open-pass');
  if (passBtn) passBtn.style.display = 'inline-flex';
  const debateBtn = document.getElementById('btn-route-council');
  if (debateBtn) debateBtn.style.display = 'inline-flex';

  // Eco & Carbon Footprint Card
  const ecoCard = document.getElementById('eco-impact-card');
  const co2El = document.getElementById('eco-co2-saved');
  const fuelEl = document.getElementById('eco-fuel-saved');
  if (ecoCard && co2El && fuelEl) {
    const co2Kg = Math.max((route.total_time * 0.7 * 0.115).toFixed(1), 0.4);
    const fuelSaved = Math.max(Math.round(route.total_time * 9.5), 45);
    co2El.textContent = `${co2Kg} kg CO₂ prevented`;
    fuelEl.textContent = `Saved ₹${fuelSaved} vs taxi`;
    ecoCard.style.display = 'flex';
  }

  // Render Step-by-Step Timeline
  renderItinerary(route);
}

function setMetric(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderItinerary(route) {
  const container = document.getElementById('station-timeline');
  if (!container) return;

  container.innerHTML = '';
  const stations = route.stations || [];
  const lines = route.lines || [];
  const names = route.station_names || stations.map(getStationName);
  const crowds = route.crowd_levels || [];

  for (let i = 0; i < stations.length; i++) {
    const line = lines[i];
    const name = names[i];
    const crowd = crowds[i] || 'Low';
    const isFirst = i === 0;
    const isLast = i === stations.length - 1;
    const isInterchange = i > 0 && i < stations.length - 1 && lines[i] !== lines[i + 1] && lines[i + 1] != null;

    const step = document.createElement('div');
    step.className = `timeline-step ${isFirst ? 'step-origin' : isLast ? 'step-dest' : ''} ${isInterchange ? 'interchange' : ''}`;

    let badgeClass = 'badge-blue';
    const lineLower = (line || '').toLowerCase();
    if (lineLower === 'green') badgeClass = 'badge-green';
    else if (lineLower === 'red') badgeClass = 'badge-red';

    const displayLine = metroCanvas?.lineDisplayNames?.[line] || line || '—';
    const crowdClass = crowd === 'High' ? 'crowd-high' : crowd === 'Medium' ? 'crowd-med' : 'crowd-low';

    step.innerHTML = `
      <div class="step-marker-col">
        <span class="step-num">${i + 1}</span>
        <div class="step-rail-line"></div>
      </div>
      <div class="step-body">
        <div class="step-top-line">
          <span class="step-name">${name}</span>
          <span class="step-crowd-badge ${crowdClass}">${crowd}</span>
        </div>
        <div class="step-meta">
          <span class="step-badge ${badgeClass}">${displayLine}</span>
          ${isFirst ? '<span class="step-flag flag-origin">Departure</span>' : ''}
          ${isLast ? '<span class="step-flag flag-dest">Final Stop</span>' : ''}
        </div>
        ${isInterchange ? `
          <div class="transfer-callout">
            <i data-lucide="git-merge" class="tf-icon"></i>
            <span>Transfer to <strong>${metroCanvas?.lineDisplayNames?.[lines[i + 1]] || lines[i + 1]}</strong> (approx 2 min walk)</span>
          </div>
        ` : ''}
      </div>
    `;

    container.appendChild(step);
  }

  initLucideIcons();
}

function renderAltTabs(routes) {
  const container = document.getElementById('alt-selector-btns');
  if (!container) return;

  container.innerHTML = '';
  if (routes.length <= 1) return;

  routes.forEach((r, idx) => {
    const btn = document.createElement('button');
    btn.className = `alt-tab-btn ${idx === activeRouteIdx ? 'active' : ''}`;
    btn.textContent = idx === 0 ? 'Optimal' : `Alt ${idx}`;
    btn.addEventListener('click', () => {
      playAudioFx('click');
      activeRouteIdx = idx;
      document.querySelectorAll('.alt-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      displayRoute(routes[idx]);
    });
    container.appendChild(btn);
  });
}

function showEmptyRouteState(msg) {
  metroCanvas.clearActiveRoute();
  setMetric('metric-time', '—');
  setMetric('metric-fare', '—');
  setMetric('metric-transfers', '—');
  setMetric('metric-crowd', '—');

  const badge = document.getElementById('route-rank-badge');
  if (badge) badge.textContent = 'No Route';

  const tl = document.getElementById('station-timeline');
  if (tl) {
    tl.innerHTML = `
      <div class="timeline-empty">
        <div class="empty-icon-wrap"><i data-lucide="alert-circle" class="empty-icon text-amber"></i></div>
        <span class="empty-heading">Route Unavailable</span>
        <span class="empty-sub">${msg || 'Select stations to search'}</span>
      </div>
    `;
    initLucideIcons();
  }
  const tsCard = document.getElementById('time-shift-card');
  if (tsCard) tsCard.style.display = 'none';

  const ecoCard = document.getElementById('eco-impact-card');
  if (ecoCard) ecoCard.style.display = 'none';
  const passBtn = document.getElementById('btn-open-pass');
  if (passBtn) passBtn.style.display = 'none';
  const debateBtn = document.getElementById('btn-route-council');
  if (debateBtn) debateBtn.style.display = 'none';

  hideCanvasBanner();
}

// ── Departure Time Window Forecast Matrix (t, t+15, t+30) ───────────────────

async function fetchTimeShiftAnalysis(src, dst) {
  const card = document.getElementById('time-shift-card');
  const grid = document.getElementById('time-shift-grid');
  const adviceEl = document.getElementById('time-shift-advice-text');
  if (!card || !grid || !adviceEl) return;

  try {
    const res = await fetch(`${API}/api/time-shift`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: src,
        destination: dst,
        preferences: getActivePresetWeights()
      })
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.windows || !data.windows.length) return;

    grid.innerHTML = '';
    data.windows.forEach(w => {
      const col = document.createElement('div');
      const winKey = w.window.toLowerCase(); // "t+0", "t+15", "t+30"
      const matchWindow = winKey === 't+0' ? 't' : winKey;
      const isActive = currentDepartureWindow === matchWindow;

      col.className = `ts-col-card ${isActive ? 'active-window' : ''}`;
      col.title = `Click to route with departure window ${w.label}`;
      const crowdLower = (w.crowd || 'low').toLowerCase();

      col.innerHTML = `
        <span class="ts-window-label">${w.window} (${w.label.replace('WAIT ', '+').replace('DEPART ', '')})</span>
        <span class="ts-time-val">${w.time}<span style="font-size: 10px; font-weight: normal; color: var(--text-muted);"> min</span></span>
        <span class="ts-crowd-pill ${crowdLower}">${w.crowd}</span>
        <span class="ts-sub-info">₹${w.fare} · ${w.transfers} xfer</span>
      `;

      col.addEventListener('click', () => {
        playAudioFx('click');
        currentDepartureWindow = matchWindow;
        document.querySelectorAll('#departure-pills .pill').forEach(p => {
          p.classList.toggle('active', p.dataset.window === matchWindow);
        });
        const hintEl = document.getElementById('departure-hint');
        if (hintEl) {
          hintEl.textContent = matchWindow === 't' ? 'Now (t)' : matchWindow === 't+15' ? '+15m (t+15)' : '+30m (t+30)';
        }
        executeAStarSearch();
      });

      grid.appendChild(col);
    });

    adviceEl.textContent = data.advice || '';
    card.style.display = 'flex';
    initLucideIcons();
  } catch (e) {
    console.warn('Time-shift forecast unavailable:', e);
  }
}

// ── Alternative Route Accordion Comparison ───────────────────────────────────

function showAltAccordion(primary, alt) {
  const acc = document.getElementById('alt-accordion');
  const content = document.getElementById('alt-compare-content');
  if (!acc || !content) return;

  acc.style.display = 'block';

  const timeDiff = alt.total_time - primary.total_time;
  const fareDiff = alt.total_fare - primary.total_fare;

  content.innerHTML = `
    <div class="alt-compare-row">
      <span class="alt-compare-label">Metrics</span>
      <span class="alt-compare-head">Optimal</span>
      <span class="alt-compare-head">Alternative</span>
    </div>
    <div class="alt-compare-row">
      <span class="alt-compare-label">Travel Time</span>
      <span class="alt-compare-val">${primary.total_time} min</span>
      <span class="alt-compare-val ${timeDiff > 0 ? 'worse' : timeDiff < 0 ? 'better' : ''}">
        ${alt.total_time} min ${timeDiff !== 0 ? `(${timeDiff > 0 ? '+' : ''}${timeDiff}m)` : ''}
      </span>
    </div>
    <div class="alt-compare-row">
      <span class="alt-compare-label">Estimated Fare</span>
      <span class="alt-compare-val">₹${primary.total_fare}</span>
      <span class="alt-compare-val ${fareDiff > 0 ? 'worse' : fareDiff < 0 ? 'better' : ''}">
        ₹${alt.total_fare} ${fareDiff !== 0 ? `(${fareDiff > 0 ? '+' : ''}₹${fareDiff})` : ''}
      </span>
    </div>
    <div class="alt-compare-row">
      <span class="alt-compare-label">Transfers</span>
      <span class="alt-compare-val">${primary.transfers}</span>
      <span class="alt-compare-val">${alt.transfers}</span>
    </div>
    <div class="alt-compare-row">
      <span class="alt-compare-label">Crowd Summary</span>
      <span class="alt-compare-val">${primary.crowd_summary}</span>
      <span class="alt-compare-val">${alt.crowd_summary}</span>
    </div>
  `;
}

function hideAltAccordion() {
  const acc = document.getElementById('alt-accordion');
  if (acc) acc.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISRUPTIONS LIST & TOGGLES
// ═══════════════════════════════════════════════════════════════════════════════

function buildDisruptionsList(stations) {
  const container = document.getElementById('disruptions-list');
  if (!container) return;

  container.innerHTML = '';
  const sorted = [...stations].sort((a, b) => a.name.localeCompare(b.name));

  for (const s of sorted) {
    const item = document.createElement('div');
    item.className = `disruption-item ${s.available === false ? 'offline' : ''}`;
    item.dataset.stationId = s.id;
    item.dataset.stationName = s.name.toLowerCase();

    const lineText = Array.isArray(s.lines)
      ? s.lines.map(l => metroCanvas?.lineDisplayNames?.[l] || l).join(' / ')
      : '';
    item.dataset.lines = lineText.toLowerCase();

    item.innerHTML = `
      <div class="disr-info">
        <span class="disr-name">${s.name}</span>
        <span class="disr-line">${lineText}</span>
      </div>
      <div class="disr-toggle-wrap">
        <span class="disr-status-badge ${s.available === false ? 'offline' : 'online'}">
          ${s.available === false ? 'CLOSED' : 'OPEN'}
        </span>
      </div>
    `;

    item.addEventListener('click', () => {
      playAudioFx('disrupt');
      toggleStationInterlock(s.id, item);
    });
    container.appendChild(item);
  }

  updateDisruptionCount();
}

function initDisruptionSearch() {
  const searchInput = document.getElementById('disruption-search');
  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll('.disruption-item').forEach(item => {
      const name = item.dataset.stationName || '';
      const lines = item.dataset.lines || '';
      const matches = !q || name.includes(q) || lines.includes(q);
      item.style.display = matches ? 'flex' : 'none';
    });
  });
}

async function toggleStationInterlock(stationId, itemEl) {
  try {
    const res = await fetch(`${API}/api/station/${stationId}/toggle`, { method: 'PUT' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Toggle failed');

    const isAvail = data.available !== false;
    itemEl.classList.toggle('offline', !isAvail);

    const statusBadge = itemEl.querySelector('.disr-status-badge');
    if (statusBadge) {
      statusBadge.textContent = isAvail ? 'OPEN' : 'CLOSED';
      statusBadge.className = `disr-status-badge ${isAvail ? 'online' : 'offline'}`;
    }

    // Update local state
    const st = graphData.stations.find(s => s.id === stationId);
    if (st) st.available = isAvail;

    metroCanvas.updateCrowdAndStatus(null, { stations: { [stationId]: isAvail } });
    updateDisruptionCount();

    // Auto recalculate if route passes through this station
    if (selectedSource && selectedDest) {
      executeAStarSearch();
    }
  } catch (err) {
    console.error(err);
    updateMapStatus(`Error toggling station: ${err.message}`);
  }
}

function updateDisruptionCount() {
  const count = document.querySelectorAll('.disruption-item.offline').length;
  const badge = document.getElementById('disruption-count');
  if (badge) {
    badge.textContent = count;
    badge.className = `badge-count ${count > 0 ? 'active-disruptions' : ''}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CROWD SIMULATION & RESET
// ═══════════════════════════════════════════════════════════════════════════════

async function simulateCrowdRandomize() {
  try {
    const res = await fetch(`${API}/api/crowd/randomize`, { method: 'POST' });
    const crowdData = await res.json();
    metroCanvas.updateCrowdAndStatus(crowdData, null);
    updateMapStatus('Dynamic passenger congestion updated across all lines');

    if (selectedSource && selectedDest) {
      executeAStarSearch();
    }
  } catch (err) {
    console.error('Failed to randomize crowds:', err);
  }
}

async function resetAllSystem() {
  try {
    const statusRes = await fetch(`${API}/api/status`);
    const statusData = await statusRes.json();

    if (statusData && statusData.stations) {
      for (const [sid, avail] of Object.entries(statusData.stations)) {
        if (!avail) {
          await fetch(`${API}/api/station/${sid}/toggle`, { method: 'PUT' });
        }
      }
    }

    selectedSource = null;
    selectedDest = null;
    currentRoutes = [];
    currentTrace = [];
    clickMode = 'source';

    syncDropdowns();
    metroCanvas.clearActiveRoute();
    metroCanvas.setEndpoints(null, null);
    showEmptyRouteState('Select departure and arrival stations to compute optimal path');
    updateFindButtonState();
    hideCanvasBanner();

    // Reset disruption UI
    document.querySelectorAll('.disruption-item.offline').forEach(item => {
      item.classList.remove('offline');
      const badge = item.querySelector('.disr-status-badge');
      if (badge) {
        badge.textContent = 'OPEN';
        badge.className = 'disr-status-badge online';
      }
    });
    updateDisruptionCount();

    // Reset inspector
    setMetric('insp-visited', '—');
    setMetric('insp-closed', '—');
    setMetric('insp-prune', '—');
    setMetric('trace-step-counter', '0 / 0');
    const tbody = document.getElementById('trace-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No search trace recorded. Run a route to inspect A*.</td></tr>';

    hideAltAccordion();
    const tsCard = document.getElementById('time-shift-card');
    if (tsCard) tsCard.style.display = 'none';
    currentDepartureWindow = 't';
    document.querySelectorAll('#departure-pills .pill').forEach(p => {
      p.classList.toggle('active', p.dataset.window === 't');
    });
    const depHint = document.getElementById('departure-hint');
    if (depHint) depHint.textContent = 'Now (t)';

    await loadNetwork();

    updateMapStatus('System reset — default transit parameters restored');
  } catch (err) {
    console.error('Reset failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// A* ALGORITHM INSPECTOR & STEP-THROUGH
// ═══════════════════════════════════════════════════════════════════════════════

function updateInspectorMetrics(trace) {
  if (!trace || trace.length === 0) {
    setMetric('insp-visited', '0');
    setMetric('insp-closed', '0');
    setMetric('insp-prune', '0%');
    return;
  }

  const totalVisited = trace.length;
  const closedCount = trace.filter(t => t.action === 'expand' || t.action === 'close').length;
  const totalNetworkNodes = graphData?.stations?.length || 20;
  const prunePct = Math.round(((totalNetworkNodes - totalVisited) / totalNetworkNodes) * 100);

  setMetric('insp-visited', String(totalVisited));
  setMetric('insp-closed', String(closedCount));
  setMetric('insp-prune', `${Math.max(prunePct, 0)}% Saved`);
}

function renderTraceTable(trace) {
  const tbody = document.getElementById('trace-tbody');
  const counter = document.getElementById('trace-step-counter');
  if (!tbody) return;

  tbody.innerHTML = '';
  if (!trace || trace.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No search trace recorded</td></tr>';
    if (counter) counter.textContent = '0 / 0';
    return;
  }

  trace.forEach((t, i) => {
    const tr = document.createElement('tr');
    tr.id = `trace-row-${i}`;
    tr.innerHTML = `
      <td class="mono">${t.step}</td>
      <td><strong>${t.station_name}</strong></td>
      <td class="mono">${t.g.toFixed(2)}</td>
      <td class="mono">${t.h.toFixed(2)}</td>
      <td class="mono f-val">${t.f.toFixed(2)}</td>
    `;
    tr.addEventListener('click', () => {
      traceIdx = i;
      highlightTraceStep(traceIdx);
    });
    tbody.appendChild(tr);
  });

  if (counter) counter.textContent = `0 / ${trace.length}`;
  traceIdx = 0;
}

function toggleTracePlayback() {
  if (tracePlaying) {
    pauseTrace();
  } else {
    playTrace();
  }
}

function playTrace() {
  if (!currentTrace || currentTrace.length === 0) return;
  tracePlaying = true;

  const icon = document.getElementById('trace-play-icon');
  if (icon) {
    icon.setAttribute('data-lucide', 'pause');
    initLucideIcons();
  }

  traceTimer = setInterval(() => {
    if (traceIdx >= currentTrace.length) {
      pauseTrace();
      return;
    }
    highlightTraceStep(traceIdx);
    traceIdx++;
  }, traceSpeedMs);
}

function pauseTrace() {
  tracePlaying = false;
  clearInterval(traceTimer);

  const icon = document.getElementById('trace-play-icon');
  if (icon) {
    icon.setAttribute('data-lucide', 'play');
    initLucideIcons();
  }
}

function stepTraceForward() {
  if (!currentTrace || currentTrace.length === 0) return;
  if (traceIdx < currentTrace.length) {
    highlightTraceStep(traceIdx);
    traceIdx++;
  }
}

function stepTraceBackward() {
  if (!currentTrace || currentTrace.length === 0) return;
  if (traceIdx > 1) {
    traceIdx -= 2;
    highlightTraceStep(traceIdx);
    traceIdx++;
  } else {
    resetTrace();
  }
}

function resetTrace() {
  pauseTrace();
  traceIdx = 0;
  metroCanvas.setEvaluatingStation(null);

  document.querySelectorAll('.trace-table tr').forEach(r => r.classList.remove('active-trace-row'));
  const counter = document.getElementById('trace-step-counter');
  if (counter) counter.textContent = `0 / ${currentTrace.length}`;

  if (currentRoutes.length > 0) {
    metroCanvas.setActiveRoute(currentRoutes[activeRouteIdx].stations, currentRoutes[activeRouteIdx].lines);
  }
}

function highlightTraceStep(index) {
  const step = currentTrace[index];
  if (!step) return;

  document.querySelectorAll('.trace-table tr').forEach(r => r.classList.remove('active-trace-row'));
  const row = document.getElementById(`trace-row-${index}`);
  if (row) {
    row.classList.add('active-trace-row');
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  const counter = document.getElementById('trace-step-counter');
  if (counter) counter.textContent = `${index + 1} / ${currentTrace.length}`;

  // Highlight evaluating station on the canvas with radar beacon!
  if (step.station_id) {
    metroCanvas.setEvaluatingStation(step.station_id);
  }

  // Draw partial path examined
  if (step.path && step.path.length > 0) {
    metroCanvas.setActiveRoute(step.path, []);
  }

  updateMapStatus(`Step ${index + 1}: Evaluating ${step.station_name} — f(n)=${step.f.toFixed(2)} [g=${step.g.toFixed(2)} + h=${step.h.toFixed(2)}]`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function updateMapStatus(text) {
  const el = document.getElementById('map-status-text');
  if (el) el.textContent = text;
}

function getStationName(stationId) {
  if (!graphData || !graphData.stations) return stationId;
  const s = graphData.stations.find(st => st.id === stationId);
  return s ? s.name : stationId;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MULTI-AGENT TRANSIT AI COUNCIL CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

let lastCompromiseRoute = null;

function initCouncilModal() {
  document.getElementById('btn-nav-council')?.addEventListener('click', openCouncilModal);
  document.getElementById('btn-route-council')?.addEventListener('click', openCouncilModal);
  document.getElementById('btn-close-council')?.addEventListener('click', closeCouncilModal);

  const modal = document.getElementById('council-modal');
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeCouncilModal();
  });

  document.getElementById('btn-apply-compromise')?.addEventListener('click', () => {
    if (!lastCompromiseRoute) return;
    playAudioFx('route');
    currentRoutes = [lastCompromiseRoute];
    activeRouteIdx = 0;
    displayRoute(lastCompromiseRoute);
    closeCouncilModal();
    updateMapStatus(`Adopted Dispatcher Compromise: ${lastCompromiseRoute.total_time} min · ₹${lastCompromiseRoute.total_fare} · ${lastCompromiseRoute.crowd_summary} crowd`);
  });
}

async function openCouncilModal() {
  // If no pair selected, choose instant demo terminals
  if (!selectedSource || !selectedDest || selectedSource === selectedDest) {
    selectedSource = 'airport';
    selectedDest = 'central_hub';
    syncDropdowns();
    updateFindButtonState();
    metroCanvas.setEndpoints(selectedSource, selectedDest);
  }

  playAudioFx('select');
  const modal = document.getElementById('council-modal');
  if (modal) modal.style.display = 'flex';

  const termEl = document.getElementById('council-terminals');
  if (termEl) {
    termEl.textContent = `Deliberation: ${getStationName(selectedSource)} ➔ ${getStationName(selectedDest)}`;
  }

  const feed = document.getElementById('council-transcript-feed');
  if (feed) {
    feed.innerHTML = `
      <div class="transcript-entry dispatcher">
        <span class="transcript-speaker">Control Room Dispatch</span>
        <span class="transcript-msg">Decrypting multi-agent telemetry and evaluating routes...</span>
      </div>
    `;
  }

  const summaryEl = document.getElementById('council-compromise-summary');
  if (summaryEl) summaryEl.textContent = 'Simulating consensus across time, comfort, and fare models…';

  try {
    const res = await fetch(`${API}/api/council-debate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: selectedSource, destination: selectedDest })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Council debate unavailable');
    }

    const data = await res.json();
    lastCompromiseRoute = data.compromise_route;

    // Update Engine Tag
    const engineTag = document.getElementById('council-engine-tag');
    if (engineTag) engineTag.textContent = data.engine || 'SCADA Dispatcher';

    // Populate Agent 1: The Rusher
    if (data.agents?.rusher) {
      const r = data.agents.rusher;
      const elT = document.getElementById('c-rusher-time');
      const elF = document.getElementById('c-rusher-fare');
      const elC = document.getElementById('c-rusher-crowd');
      if (elT) elT.innerHTML = `<i data-lucide="clock"></i> ${r.total_time} min`;
      if (elF) elF.innerHTML = `<i data-lucide="indian-rupee"></i> ₹${r.total_fare}`;
      if (elC) elC.innerHTML = `<i data-lucide="users"></i> ${r.crowd_summary}`;
    }

    // Populate Agent 2: The Relaxer
    if (data.agents?.relaxer) {
      const l = data.agents.relaxer;
      const elT = document.getElementById('c-relaxer-time');
      const elF = document.getElementById('c-relaxer-fare');
      const elC = document.getElementById('c-relaxer-crowd');
      if (elT) elT.innerHTML = `<i data-lucide="clock"></i> ${l.total_time} min`;
      if (elF) elF.innerHTML = `<i data-lucide="indian-rupee"></i> ₹${l.total_fare}`;
      if (elC) elC.innerHTML = `<i data-lucide="users"></i> ${l.crowd_summary}`;
    }

    // Populate Agent 3: The Hawk
    if (data.agents?.hawk) {
      const h = data.agents.hawk;
      const elT = document.getElementById('c-hawk-time');
      const elF = document.getElementById('c-hawk-fare');
      const elC = document.getElementById('c-hawk-crowd');
      if (elT) elT.innerHTML = `<i data-lucide="clock"></i> ${h.total_time} min`;
      if (elF) elF.innerHTML = `<i data-lucide="indian-rupee"></i> ₹${h.total_fare}`;
      if (elC) elC.innerHTML = `<i data-lucide="users"></i> ${h.crowd_summary}`;
    }

    // Highlight Chosen Agent
    document.querySelectorAll('.council-agent-card').forEach(c => c.classList.remove('chosen-agent'));
    const chosenType = (data.compromise_route?.chosen_agent || 'relaxer').toLowerCase();
    const chosenCard = document.getElementById(`agent-card-${chosenType}`);
    if (chosenCard) chosenCard.classList.add('chosen-agent');

    // Populate Transcript
    if (feed && Array.isArray(data.debate)) {
      feed.innerHTML = '';
      data.debate.forEach(turn => {
        const item = document.createElement('div');
        item.className = `transcript-entry ${turn.type || 'dispatcher'}`;
        item.innerHTML = `
          <span class="transcript-speaker">${turn.speaker}</span>
          <span class="transcript-msg">${turn.text}</span>
        `;
        feed.appendChild(item);
      });
      feed.scrollTop = feed.scrollHeight;
    }

    // Populate Compromise Bar
    if (summaryEl && data.compromise_route) {
      const cr = data.compromise_route;
      summaryEl.textContent = `${cr.station_names.join(' ➔ ')} (${cr.total_time} min · ₹${cr.total_fare} · ${cr.crowd_summary} crowd)`;
    }

    initLucideIcons();
  } catch (err) {
    console.error('Council debate error:', err);
    if (feed) {
      feed.innerHTML = `
        <div class="transcript-entry dispatcher">
          <span class="transcript-speaker">Error</span>
          <span class="transcript-msg">${err.message || 'Unable to establish council link.'}</span>
        </div>
      `;
    }
  }
}

function closeCouncilModal() {
  playAudioFx('click');
  const modal = document.getElementById('council-modal');
  if (modal) modal.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMERGENCY SCENARIOS CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

function initScenarioChips() {
  document.querySelectorAll('.scenario-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      const scenario = chip.dataset.scenario;
      playAudioFx('disrupt');

      if (scenario === 'storm') {
        updateMapStatus('⚡ Thunderstorm Alert: Shutting down Central Hub & surging crowd at surrounding lines');
        // Close central hub if open
        const ch = graphData?.stations?.find(s => s.id === 'central_hub');
        if (ch && ch.available !== false) {
          await fetch(`${API}/api/station/central_hub/toggle`, { method: 'PUT' });
        }
        // Set crowd high at adjacent stations
        await fetch(`${API}/api/crowd/old_town`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: 'High' }) });
        await fetch(`${API}/api/crowd/suburban_north`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: 'High' }) });
      } else if (scenario === 'match') {
        updateMapStatus('⚽ Match Day Surge: Expo Centre and Airport experiencing peak congestion');
        await fetch(`${API}/api/crowd/expo_centre`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: 'High' }) });
        await fetch(`${API}/api/crowd/airport`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: 'High' }) });
        await fetch(`${API}/api/crowd/cultural_hub`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: 'High' }) });
      } else if (scenario === 'repair') {
        updateMapStatus('🚧 Track Repair: Line B track split between Market Plaza and Riverside');
        await fetch(`${API}/api/edge/market_plaza/riverside/toggle`, { method: 'PUT' });
      } else if (scenario === 'clear') {
        await resetAllSystem();
        return;
      }

      await loadNetwork();
      if (selectedSource && selectedDest) {
        executeAStarSearch();
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// DIGITAL SMART TOKEN / BOARDING PASS CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

function initPassModal() {
  document.getElementById('btn-open-pass')?.addEventListener('click', () => {
    if (currentRoutes && currentRoutes.length > 0) {
      openPassModal(currentRoutes[activeRouteIdx]);
    }
  });

  document.getElementById('btn-close-pass')?.addEventListener('click', closePassModal);

  const modal = document.getElementById('pass-modal');
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closePassModal();
  });

  document.getElementById('btn-print-pass')?.addEventListener('click', () => {
    window.print();
  });

  document.getElementById('btn-copy-pass')?.addEventListener('click', () => {
    if (!currentRoutes || !currentRoutes.length) return;
    const r = currentRoutes[activeRouteIdx];
    const srcName = getStationName(r.stations[0]);
    const dstName = getStationName(r.stations[r.stations.length - 1]);
    const summary = `AI METRO SMART TOKEN\nFrom: ${srcName}\nTo: ${dstName}\nDuration: ${r.total_time} min | Fare: ₹${r.total_fare} | Transfers: ${r.transfers}\nLines: ${r.lines_used.join(', ')}\nStations:\n${r.station_names.join(' ➔ ')}`;

    navigator.clipboard?.writeText(summary).then(() => {
      const copyBtn = document.getElementById('btn-copy-pass');
      if (copyBtn) {
        const origText = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i data-lucide="check"></i> <span>Copied!</span>';
        initLucideIcons();
        setTimeout(() => {
          copyBtn.innerHTML = origText;
          initLucideIcons();
        }, 2000);
      }
    });
  });
}

function openPassModal(route) {
  if (!route) return;
  playAudioFx('select');

  const modal = document.getElementById('pass-modal');
  if (modal) modal.style.display = 'flex';

  const srcName = getStationName(route.stations[0]);
  const dstName = getStationName(route.stations[route.stations.length - 1]);

  setMetric('pass-serial', `PASS-${Math.floor(1000 + Math.random() * 9000)}-${route.stations.length}X`);
  setMetric('pass-origin', srcName);
  setMetric('pass-dest', dstName);
  setMetric('pass-time', `${route.total_time} min`);
  setMetric('pass-fare', `₹${route.total_fare}`);
  setMetric('pass-transfers', route.transfers === 0 ? 'Direct' : `${route.transfers} Swap`);
  setMetric('pass-crowd', route.crowd_summary);

  const winPill = document.querySelector('#departure-pills .pill.active');
  setMetric('pass-window', winPill?.textContent?.trim() || 'Now (t)');

  // Render Line badges on pass
  const linesRow = document.getElementById('pass-lines-row');
  if (linesRow) {
    linesRow.innerHTML = '';
    (route.lines_used || []).forEach(l => {
      const sp = document.createElement('span');
      const lLower = (l || '').toLowerCase();
      sp.className = `line-pill-badge ${lLower === 'green' ? 'line-a' : lLower === 'blue' ? 'line-b' : 'line-c'}`;
      sp.textContent = metroCanvas?.lineDisplayNames?.[l] || l;
      linesRow.appendChild(sp);
    });
  }

  initLucideIcons();
}

function closePassModal() {
  playAudioFx('click');
  const modal = document.getElementById('pass-modal');
  if (modal) modal.style.display = 'none';
}

