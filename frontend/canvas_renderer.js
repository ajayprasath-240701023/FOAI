/**
 * canvas_renderer.js — AI Metro Neural Canvas Engine v2.5
 * ========================================================
 * High-performance HTML5 Canvas 2D renderer with retina scaling,
 * multi-layered neon glow rails, dynamic train particle streams,
 * pulsing radar markers for origin/destination, interchange hubs,
 * and real-time A* search evaluation highlights.
 */

'use strict';

class MetroCanvas {
  constructor(containerId, options = {}) {
    this.container = typeof containerId === 'string'
      ? document.getElementById(containerId)
      : containerId;
    if (!this.container) throw new Error('MetroCanvas: container element not found');

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'metro-canvas-element';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // ── Vibrant Color System ──────────────────────────────────────────────────
    this.lineColors = {
      blue:    '#818cf8',   // Line B: Electric Indigo
      Blue:    '#818cf8',
      red:     '#fbbf24',   // Line C: Luminous Amber
      Red:     '#fbbf24',
      green:   '#34d399',   // Line A: Emerald Green
      Green:   '#34d399',
      default: '#94a3b8'
    };

    this.lineDisplayNames = {
      Blue:  'Line B',
      Red:   'Line C',
      Green: 'Line A',
      blue:  'Line B',
      red:   'Line C',
      green: 'Line A'
    };

    this.crowdColors = {
      Low:    '#34d399',   // Emerald
      Medium: '#fbbf24',   // Amber
      High:   '#f87171'    // Coral Crimson
    };

    // ── State ─────────────────────────────────────────────────────────────────
    this.stations = [];
    this.edges = [];
    this.stationMap = new Map();

    this.activeRouteStations = [];
    this.activeRouteLines = [];
    this.altRouteStations = [];
    this.altRouteLines = [];

    this.sourceStationId = null;
    this.destStationId = null;
    this.hoveredStationId = null;
    this.evaluatingStationId = null; // Highlighted during A* step-through

    // ── Viewport Transform ───────────────────────────────────────────────────
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.minScale = 0.35;
    this.maxScale = 3.5;

    // ── Interaction ──────────────────────────────────────────────────────────
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.hasDragged = false;

    // ── Animation Loop ───────────────────────────────────────────────────────
    this.animTime = 0;
    this.trainProgress = 0;
    this.pulsePhase = 0;

    // ── Callbacks ────────────────────────────────────────────────────────────
    this.onStationClick = options.onStationClick || (() => {});
    this.onStationHover = options.onStationHover || (() => {});
    this.onStationLeave = options.onStationLeave || (() => {});

    this._initEvents();
    this._initResizeObserver();
    this._startLoop();
  }

  // ── Data Loading & Updates ─────────────────────────────────────────────────

  setData(stations, edges) {
    this.stations = stations || [];
    this.edges = edges || [];
    this.stationMap.clear();
    for (const s of this.stations) {
      this.stationMap.set(s.id, s);
    }
    this.fit();
  }

  updateCrowdAndStatus(crowdData, statusData) {
    for (const s of this.stations) {
      if (crowdData && crowdData[s.id]) {
        s.crowd_level = crowdData[s.id];
      }
      if (statusData && statusData.stations && statusData.stations[s.id] !== undefined) {
        s.available = statusData.stations[s.id];
      }
    }
    for (const e of this.edges) {
      if (statusData && statusData.edges) {
        const pairKey = [e.from, e.to].sort().join('__');
        if (statusData.edges[pairKey] !== undefined) {
          e.available = statusData.edges[pairKey];
        }
      }
    }
    this.requestRender();
  }

  setActiveRoute(stations, lines) {
    this.activeRouteStations = stations || [];
    this.activeRouteLines = lines || [];
    this.trainProgress = 0;
    this.requestRender();
  }

  setAltRoute(stations, lines) {
    this.altRouteStations = stations || [];
    this.altRouteLines = lines || [];
    this.requestRender();
  }

  clearActiveRoute() {
    this.activeRouteStations = [];
    this.activeRouteLines = [];
    this.altRouteStations = [];
    this.altRouteLines = [];
    this.evaluatingStationId = null;
    this.requestRender();
  }

  setEndpoints(sourceId, destId) {
    this.sourceStationId = sourceId;
    this.destStationId = destId;
    this.requestRender();
  }

  setEvaluatingStation(stationId) {
    this.evaluatingStationId = stationId;
    this.requestRender();
  }

  // ── Coordinates & Transforms ───────────────────────────────────────────────

  worldToScreen(wx, wy) {
    return {
      x: wx * this.scale + this.panX,
      y: wy * this.scale + this.panY
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.panX) / this.scale,
      y: (sy - this.panY) / this.scale
    };
  }

  // ── Auto Fit & Center ──────────────────────────────────────────────────────

  fit(padding = 70) {
    if (!this.stations.length) return;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const s of this.stations) {
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.y > maxY) maxY = s.y;
    }

    const dataW = maxX - minX || 1;
    const dataH = maxY - minY || 1;
    const dpr = window.devicePixelRatio || 1;
    const cw = this.canvas.width / dpr;
    const ch = this.canvas.height / dpr;

    if (cw <= 0 || ch <= 0) return;

    const availW = Math.max(cw - padding * 2, 100);
    const availH = Math.max(ch - padding * 2, 100);

    const sx = availW / dataW;
    const sy = availH / dataH;
    this.scale = Math.min(sx, sy, 1.35);
    this.scale = Math.max(this.scale, this.minScale);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this.panX = cw / 2 - cx * this.scale;
    this.panY = ch / 2 - cy * this.scale;

    this.requestRender();
  }

  resetView() {
    this.fit();
  }

  // ── Resize Observer ────────────────────────────────────────────────────────

  _initResizeObserver() {
    this.resizeObserver = new ResizeObserver(() => this._handleResize());
    this.resizeObserver.observe(this.container);
    this._handleResize();
  }

  _handleResize() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(rect.width) || 800;
    const h = Math.floor(rect.height) || 600;

    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.fit();
    }
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  _initEvents() {
    const c = this.canvas;

    c.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.hasDragged = false;
      this.dragStartX = e.clientX - this.panX;
      this.dragStartY = e.clientY - this.panY;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        const newPX = e.clientX - this.dragStartX;
        const newPY = e.clientY - this.dragStartY;
        if (Math.hypot(newPX - this.panX, newPY - this.panY) > 3) {
          this.hasDragged = true;
        }
        this.panX = newPX;
        this.panY = newPY;
        this.requestRender();
      } else {
        const rect = c.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        if (mx >= 0 && mx <= rect.width && my >= 0 && my <= rect.height) {
          this._handleHover(mx, my);
        } else if (this.hoveredStationId) {
          this.hoveredStationId = null;
          this.canvas.style.cursor = 'default';
          this.onStationLeave();
          this.requestRender();
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (this.isDragging) {
        this.isDragging = false;
        if (!this.hasDragged) {
          const rect = c.getBoundingClientRect();
          this._handleClick(e.clientX - rect.left, e.clientY - rect.top);
        }
      }
    });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      const newScale = Math.min(Math.max(this.scale * factor, this.minScale), this.maxScale);

      this.panX = mx - (mx - this.panX) * (newScale / this.scale);
      this.panY = my - (my - this.panY) * (newScale / this.scale);
      this.scale = newScale;
      this.requestRender();
    }, { passive: false });
  }

  _findStationAtScreen(sx, sy, threshold = 28) {
    const world = this.screenToWorld(sx, sy);
    const rWorld = threshold / this.scale;
    for (const s of this.stations) {
      if (Math.hypot(s.x - world.x, s.y - world.y) <= rWorld) return s;
    }
    return null;
  }

  _handleClick(sx, sy) {
    const station = this._findStationAtScreen(sx, sy);
    if (station) this.onStationClick(station);
  }

  _handleHover(sx, sy) {
    const station = this._findStationAtScreen(sx, sy);
    const newId = station ? station.id : null;

    if (newId !== this.hoveredStationId) {
      this.hoveredStationId = newId;
      this.canvas.style.cursor = station ? 'pointer' : 'grab';

      if (station) {
        const screenPos = this.worldToScreen(station.x, station.y);
        this.onStationHover(station, screenPos);
      } else {
        this.onStationLeave();
      }
      this.requestRender();
    }
  }

  // ── Animation Loop ─────────────────────────────────────────────────────────

  _startLoop() {
    let last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      this.animTime += dt;
      this.pulsePhase = (this.pulsePhase + dt * 2.2) % (Math.PI * 2);

      // Advance train particle along route
      if (this.activeRouteStations.length > 1) {
        this.trainProgress = (this.trainProgress + dt * 0.35) % 1.0;
        this.draw();
      } else if (this.sourceStationId || this.destStationId || this.evaluatingStationId) {
        // Redraw pulse waves for origin/destination beacons
        this.draw();
      }

      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  requestRender() {
    this.draw();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // RENDER PIPELINE
  // ════════════════════════════════════════════════════════════════════════════

  draw() {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const cw = this.canvas.width / dpr;
    const ch = this.canvas.height / dpr;

    ctx.clearRect(0, 0, cw, ch);

    // 1. Futuristic Tech Background & Subtle Grid
    this._drawGrid(ctx, cw, ch);

    // 2. Metro Network Track Edges
    this._drawEdges(ctx);

    // 3. Alternative Route (dashed purple line)
    if (this.altRouteStations.length > 1) {
      this._drawAltRoute(ctx);
    }

    // 4. Optimal Route (neon cyan laser beam + pulse train)
    if (this.activeRouteStations.length > 1) {
      this._drawActiveRoute(ctx);
    }

    // 5. Stations (with crowd rings, interchange hubs, and radar beacons)
    this._drawStations(ctx);

    // 6. Numbered badges for optimal route stops
    if (this.activeRouteStations.length > 1) {
      this._drawRouteStopBadges(ctx);
    }
  }

  // ── Background Coordinate Grid ─────────────────────────────────────────────

  _drawGrid(ctx, cw, ch) {
    const gridSize = 45 * this.scale;
    if (gridSize < 12) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.lineWidth = 1;

    const sx = this.panX % gridSize;
    const sy = this.panY % gridSize;

    ctx.beginPath();
    for (let x = sx; x < cw; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ch);
    }
    for (let y = sy; y < ch; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(cw, y);
    }
    ctx.stroke();

    // Subtle crosshairs at major grid intersections
    const majorGrid = gridSize * 4;
    ctx.fillStyle = 'rgba(0, 229, 255, 0.06)';
    const msx = this.panX % majorGrid;
    const msy = this.panY % majorGrid;
    for (let x = msx; x < cw; x += majorGrid) {
      for (let y = msy; y < ch; y += majorGrid) {
        ctx.fillRect(x - 2, y - 2, 4, 4);
      }
    }

    ctx.restore();
  }

  // ── Track Edges ────────────────────────────────────────────────────────────

  _drawEdges(ctx) {
    const hasRoute = this.activeRouteStations.length > 1;
    const routePairs = new Set();
    if (hasRoute) {
      for (let i = 0; i < this.activeRouteStations.length - 1; i++) {
        const u = this.activeRouteStations[i];
        const v = this.activeRouteStations[i + 1];
        routePairs.add(`${u}__${v}`);
        routePairs.add(`${v}__${u}`);
      }
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const edge of this.edges) {
      const u = this.stationMap.get(edge.from);
      const v = this.stationMap.get(edge.to);
      if (!u || !v) continue;

      const p1 = this.worldToScreen(u.x, u.y);
      const p2 = this.worldToScreen(v.x, v.y);
      const isRoute = routePairs.has(`${edge.from}__${edge.to}`);
      const isAvail = edge.available !== false && u.available !== false && v.available !== false;
      const lineColor = this.lineColors[edge.line] || this.lineColors.default;

      if (!isAvail) {
        // Disrupted track: greyed-out dashed line with red cross mark
        ctx.save();
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = Math.max(3.5 * this.scale, 2.5);
        ctx.setLineDash([8, 6]);
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      ctx.save();
      if (hasRoute && !isRoute) {
        // Non-route tracks stay gracefully visible (38% opacity) with nice colored line
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = Math.max(4.5 * this.scale, 3);
        ctx.shadowColor = lineColor;
        ctx.shadowBlur = 4 * this.scale;
        ctx.globalAlpha = 0.38;
      } else {
        // Normal crisp line with vibrant ambient glow
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = Math.max(6 * this.scale, 3.5);
        ctx.shadowColor = lineColor;
        ctx.shadowBlur = 10 * this.scale;
        ctx.globalAlpha = 0.92;
      }

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  // ── Alternative Route (Dashed Purple Track) ────────────────────────────────

  _drawAltRoute(ctx) {
    const coords = [];
    for (const sid of this.altRouteStations) {
      const s = this.stationMap.get(sid);
      if (s) coords.push(this.worldToScreen(s.x, s.y));
    }
    if (coords.length < 2) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([12, 8]);
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = Math.max(5 * this.scale, 3.5);
    ctx.shadowColor = '#c084fc';
    ctx.shadowBlur = 14;
    ctx.globalAlpha = 0.65;

    ctx.beginPath();
    ctx.moveTo(coords[0].x, coords[0].y);
    for (let i = 1; i < coords.length; i++) {
      ctx.lineTo(coords[i].x, coords[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ── Optimal Active Route (Laser Cyan Beam) ─────────────────────────────────

  _drawActiveRoute(ctx) {
    const coords = [];
    for (const sid of this.activeRouteStations) {
      const s = this.stationMap.get(sid);
      if (s) coords.push(this.worldToScreen(s.x, s.y));
    }
    if (coords.length < 2) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. Outer Neon Cyan Glow Halo
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = Math.max(13 * this.scale, 7);
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 24 * this.scale;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(coords[0].x, coords[0].y);
    for (let i = 1; i < coords.length; i++) ctx.lineTo(coords[i].x, coords[i].y);
    ctx.stroke();

    // 2. Mid Beam (Electric Cyan)
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = Math.max(6 * this.scale, 3.5);
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 10 * this.scale;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.moveTo(coords[0].x, coords[0].y);
    for (let i = 1; i < coords.length; i++) ctx.lineTo(coords[i].x, coords[i].y);
    ctx.stroke();

    // 3. Ultra-Bright White Laser Core
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2.5 * this.scale, 1.8);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1.0;
    ctx.beginPath();
    ctx.moveTo(coords[0].x, coords[0].y);
    for (let i = 1; i < coords.length; i++) ctx.lineTo(coords[i].x, coords[i].y);
    ctx.stroke();

    // 4. Directional Chevrons
    this._drawTrackDirectionChevrons(ctx, coords);

    // 5. Dynamic Train Particle Stream
    this._drawTrainParticle(ctx, coords);

    ctx.restore();
  }

  _drawTrackDirectionChevrons(ctx, coords) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.7;

    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 40) continue;

      const angle = Math.atan2(dy, dx);
      // Place chevron at midpoint
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;

      ctx.save();
      ctx.translate(midX, midY);
      ctx.rotate(angle);
      ctx.beginPath();
      const sz = Math.max(4 * this.scale, 3);
      ctx.moveTo(-sz, -sz);
      ctx.lineTo(0, 0);
      ctx.lineTo(-sz, sz);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  _drawTrainParticle(ctx, coords) {
    let totalLen = 0;
    const segLens = [];
    for (let i = 0; i < coords.length - 1; i++) {
      const d = Math.hypot(coords[i + 1].x - coords[i].x, coords[i + 1].y - coords[i].y);
      segLens.push(d);
      totalLen += d;
    }
    if (totalLen <= 0) return;

    const target = this.trainProgress * totalLen;
    let cur = 0;
    let px = coords[0].x, py = coords[0].y;
    let angle = 0;

    for (let i = 0; i < segLens.length; i++) {
      if (cur + segLens[i] >= target) {
        const r = (target - cur) / segLens[i];
        px = coords[i].x + (coords[i + 1].x - coords[i].x) * r;
        py = coords[i].y + (coords[i + 1].y - coords[i].y) * r;
        angle = Math.atan2(coords[i + 1].y - coords[i].y, coords[i + 1].x - coords[i].x);
        break;
      }
      cur += segLens[i];
    }

    // Outer glow wave
    ctx.save();
    ctx.fillStyle = '#00f0ff';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 22;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(14 * this.scale, 9), 0, Math.PI * 2);
    ctx.fill();

    // Train Capsule
    ctx.translate(px, py);
    ctx.rotate(angle);

    // Glowing train body
    const tw = Math.max(14 * this.scale, 10);
    const th = Math.max(7 * this.scale, 5);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 12;
    ctx.globalAlpha = 1.0;
    ctx.beginPath();
    ctx.roundRect(-tw / 2, -th / 2, tw, th, 3);
    ctx.fill();

    // Front headlight beam
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(tw / 2, 0, Math.max(2.5 * this.scale, 1.8), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ── Numbered Badges along Route ───────────────────────────────────────────

  _drawRouteStopBadges(ctx) {
    const routeSet = this.activeRouteStations;

    for (let i = 0; i < routeSet.length; i++) {
      const s = this.stationMap.get(routeSet[i]);
      if (!s) continue;

      const p = this.worldToScreen(s.x, s.y);
      const num = i + 1;
      const r = Math.max(10 * this.scale, 8);

      ctx.save();
      // Badge pill
      ctx.fillStyle = '#0a1022';
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(p.x, p.y - r - 12 * this.scale, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Number text
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#00f0ff';
      ctx.font = `700 ${Math.round(Math.max(10 * this.scale, 9))}px 'JetBrains Mono', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(num), p.x, p.y - r - 12 * this.scale);
      ctx.restore();
    }
  }

  // ── Stations Rendering ────────────────────────────────────────────────────

  _drawStations(ctx) {
    const hasRoute = this.activeRouteStations.length > 1;
    const routeSet = new Set(this.activeRouteStations);

    for (const station of this.stations) {
      const p = this.worldToScreen(station.x, station.y);
      const isAvail = station.available !== false;
      const isInterchange = station.is_interchange || (station.lines && station.lines.length > 1);
      const isHovered = this.hoveredStationId === station.id;
      const isSource = this.sourceStationId === station.id;
      const isDest = this.destStationId === station.id;
      const isEvaluating = this.evaluatingStationId === station.id;
      const inRoute = routeSet.has(station.id);

      ctx.save();

      // Non-route stations stay softly legible (45% opacity)
      if (hasRoute && !inRoute && !isSource && !isDest) {
        ctx.globalAlpha = 0.45;
      }

      const baseR = isInterchange ? 12 * this.scale : 8 * this.scale;
      const crowdLvl = station.crowd_level || 'Low';
      const crowdColor = this.crowdColors[crowdLvl] || this.crowdColors.Low;

      // 1. Crowd Halo Ring (Glowing outer indicator)
      if (isAvail) {
        ctx.save();
        ctx.strokeStyle = crowdColor;
        ctx.lineWidth = Math.max(2.5 * this.scale, 1.8);
        ctx.shadowColor = crowdColor;
        ctx.shadowBlur = crowdLvl === 'High' ? 16 * this.scale : 8 * this.scale;

        // If high crowd, subtle pulsing expansion
        const pulseOffset = crowdLvl === 'High' ? Math.sin(this.pulsePhase) * 2 * this.scale : 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, baseR + 4 * this.scale + pulseOffset, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 2. Station Body & Ring
      const primaryLine = Array.isArray(station.lines) ? station.lines[0] : (station.line || 'Blue');
      const nodeColor = this.lineColors[primaryLine] || '#ffffff';

      if (!isAvail) {
        // Closed station: dark background + red dashed outline + cross mark
        ctx.fillStyle = '#18121d';
        ctx.strokeStyle = '#f87171';
        ctx.lineWidth = 2.5 * this.scale;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, baseR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Red X mark
        ctx.setLineDash([]);
        ctx.strokeStyle = '#f87171';
        ctx.lineWidth = 2 * this.scale;
        const xOff = 4.5 * this.scale;
        ctx.beginPath();
        ctx.moveTo(p.x - xOff, p.y - xOff);
        ctx.lineTo(p.x + xOff, p.y + xOff);
        ctx.moveTo(p.x + xOff, p.y - xOff);
        ctx.lineTo(p.x - xOff, p.y + xOff);
        ctx.stroke();
      } else {
        // Operational station disc
        ctx.beginPath();
        ctx.arc(p.x, p.y, baseR, 0, Math.PI * 2);
        ctx.fillStyle = '#0a1022';
        ctx.strokeStyle = isHovered ? '#ffffff' : nodeColor;
        ctx.lineWidth = isHovered ? 4 * this.scale : 2.8 * this.scale;
        ctx.shadowColor = isHovered ? '#ffffff' : nodeColor;
        ctx.shadowBlur = isHovered ? 14 : 6;
        ctx.fill();
        ctx.stroke();

        // Interchange: Dual concentric rings with white inner nucleus
        if (isInterchange) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, baseR * 0.52, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.shadowBlur = 0;
          ctx.fill();
        }
      }

      // 3. Radar Wave Ripples for Origin / Destination / Evaluating
      if (isSource) {
        this._drawBeaconWave(ctx, p.x, p.y, baseR, '#34d399', 'ORIGIN');
      } else if (isDest) {
        this._drawBeaconWave(ctx, p.x, p.y, baseR, '#f472b6', 'DESTINATION');
      } else if (isEvaluating) {
        this._drawBeaconWave(ctx, p.x, p.y, baseR, '#fbbf24', 'EVALUATING');
      }

      // 4. Station Text Label
      this._drawStationLabel(ctx, station, p, isAvail, isInterchange, isSource, isDest);

      ctx.restore();
    }
  }

  _drawBeaconWave(ctx, cx, cy, baseR, color, tag) {
    ctx.save();
    const waveRadius = baseR + ((this.pulsePhase / (Math.PI * 2)) * 18 * this.scale);
    const waveAlpha = 1.0 - (this.pulsePhase / (Math.PI * 2));

    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * this.scale;
    ctx.globalAlpha = Math.max(waveAlpha, 0);
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(cx, cy, waveRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Floating pill badge above the station
    if (tag) {
      ctx.globalAlpha = 1.0;
      ctx.shadowBlur = 8;
      ctx.font = `700 ${Math.round(Math.max(8.5 * this.scale, 8))}px 'Space Grotesk', sans-serif`;
      const tw = ctx.measureText(tag).width;
      const tagH = 14 * this.scale;
      const tagW = tw + 10 * this.scale;
      const tagY = cy - baseR - 20 * this.scale;

      ctx.fillStyle = '#0a1022';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(cx - tagW / 2, tagY - tagH / 2, tagW, tagH, 4);
      ctx.fill();
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tag, cx, tagY);
    }

    ctx.restore();
  }

  _drawStationLabel(ctx, station, p, isAvail, isInterchange, isSource, isDest) {
    ctx.save();
    const fontSize = Math.round(Math.max(10.5 * this.scale, 9.5));
    ctx.font = `600 ${fontSize}px 'Inter', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const labelY = p.y + (isInterchange ? 24 * this.scale : 18 * this.scale);
    const text = station.name;
    const tw = ctx.measureText(text).width;
    const px = 6 * this.scale;
    const py = 3 * this.scale;

    // Glass pill background
    ctx.fillStyle = 'rgba(8, 14, 28, 0.90)';
    ctx.strokeStyle = isSource ? '#34d399' : isDest ? '#f472b6' : 'rgba(56, 82, 120, 0.4)';
    ctx.lineWidth = 1;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 6;

    const pillR = 4;
    const pillX = p.x - tw / 2 - px;
    const pillY = labelY - fontSize / 2 - py;
    const pillW = tw + px * 2;
    const pillH = fontSize + py * 2;

    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, pillR);
    ctx.fill();
    ctx.stroke();

    // Text Label
    ctx.shadowBlur = 0;
    if (!isAvail) {
      ctx.fillStyle = '#f87171';
    } else if (isSource) {
      ctx.fillStyle = '#34d399';
    } else if (isDest) {
      ctx.fillStyle = '#f472b6';
    } else {
      ctx.fillStyle = '#e8edf5';
    }

    ctx.fillText(text, p.x, labelY);
    ctx.restore();
  }
}

window.MetroCanvas = MetroCanvas;
