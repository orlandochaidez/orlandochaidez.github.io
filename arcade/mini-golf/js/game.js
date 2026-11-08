/* Pocket Putt — game loop, rendering, input, UI. */
(function () {
  'use strict';
  const MG = window.MG;
  const PH = MG.PHYS;
  const Sound = MG.Sound;
  const { pointInLoops } = MG.geom;

  const MAX_STROKES = 10;
  const LS_BEST = 'pocketputt.best.v1';
  const LS_MUTE = 'pocketputt.muted';

  /* ---------------- DOM ---------------- */
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const staticCanvas = document.createElement('canvas');
  const sctx = staticCanvas.getContext('2d');

  /* ---------------- state ---------------- */
  const S = {
    seed: 0, holes: [], idx: 0, strokes: 0, scores: [],
    sim: null, aim: null, paused: false, phase: 'title',
    trail: [], fx: [], flashes: [], time: 0,
    view: { s: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1, safeB: 0 },
    hintShown: true, lastPowerStep: -1,
  };

  /* ---------------- utils ---------------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const vib = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* no haptics */ } };
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const fmtToPar = (n) => (n === 0 ? 'E' : n > 0 ? '+' + n : String(n));
  function hash01(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  function readSafeBottom() {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;bottom:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden';
    document.body.appendChild(d);
    const v = parseFloat(getComputedStyle(d).paddingBottom) || 0;
    d.remove();
    return v;
  }

  /* ---------------- layout ---------------- */
  function holeBounds(h) {
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const l of h.loops) for (const p of l) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const pad = 16;
    return { minX: minX - pad, minY: minY - pad - 30 /* flag room */, maxX: maxX + pad, maxY: maxY + pad };
  }

  function layout() {
    const v = S.view;
    v.dpr = Math.min(window.devicePixelRatio || 1, 3);
    v.w = window.innerWidth; v.h = window.innerHeight;
    v.safeB = readSafeBottom();
    canvas.width = Math.round(v.w * v.dpr); canvas.height = Math.round(v.h * v.dpr);
    staticCanvas.width = canvas.width; staticCanvas.height = canvas.height;
    if (!S.sim) return;
    const b = holeBounds(S.sim.hole);
    const hud = document.getElementById('hud').getBoundingClientRect();
    const top = hud.bottom + 2;
    const bottom = v.h - (40 + v.safeB);
    const availW = v.w - 12, availH = Math.max(100, bottom - top);
    const bw = Math.max(300, b.maxX - b.minX), bh = b.maxY - b.minY;
    v.s = Math.min(availW / bw, availH / bh, 2.4);
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    v.ox = v.w / 2 - cx * v.s;
    v.oy = top + availH / 2 - cy * v.s;
    renderStatic();
  }
  const toScreen = (x, y) => ({ x: S.view.ox + x * S.view.s, y: S.view.oy + y * S.view.s });

  /* ---------------- static layer (course) ---------------- */
  function loopsPath(c, loops) {
    c.beginPath();
    for (const l of loops) {
      c.moveTo(l[0].x, l[0].y);
      for (let i = 1; i < l.length; i++) c.lineTo(l[i].x, l[i].y);
      c.closePath();
    }
  }
  function polyPath(c, p) {
    c.beginPath(); c.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < p.length; i++) c.lineTo(p[i].x, p[i].y);
    c.closePath();
  }

  function drawBackground(c, v) {
    const g = c.createLinearGradient(0, 0, 0, v.h);
    g.addColorStop(0, '#1f6e72'); g.addColorStop(1, '#123e46');
    c.fillStyle = g; c.fillRect(0, 0, v.w, v.h);
    // soft polka pattern
    c.fillStyle = 'rgba(255,255,255,0.045)';
    const sp = 26;
    for (let y = 0, row = 0; y < v.h + sp; y += sp, row++) {
      for (let x = (row % 2) * (sp / 2); x < v.w + sp; x += sp) {
        c.beginPath(); c.arc(x, y, 2.2, 0, Math.PI * 2); c.fill();
      }
    }
  }

  function strokeWood(c, pathFn, width, cap) {
    c.lineJoin = 'round'; c.lineCap = cap || 'round';
    c.save(); c.translate(2.2, 3.4); pathFn(); c.strokeStyle = 'rgba(0,20,10,0.28)'; c.lineWidth = width + 1.5; c.stroke(); c.restore();
    pathFn(); c.strokeStyle = '#8f5526'; c.lineWidth = width; c.stroke();
    pathFn(); c.strokeStyle = '#c4824a'; c.lineWidth = width - 3; c.stroke();
    c.save(); c.translate(-0.8, -1.3); pathFn(); c.strokeStyle = 'rgba(255,228,180,0.55)'; c.lineWidth = 1.6; c.stroke(); c.restore();
  }

  function renderStatic() {
    const v = S.view, c = sctx, h = S.sim.hole;
    c.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    drawBackground(c, v);
    c.setTransform(v.dpr * v.s, 0, 0, v.dpr * v.s, v.dpr * v.ox, v.dpr * v.oy);
    const b = holeBounds(h);

    // course drop shadow
    c.save(); c.translate(4, 9); loopsPath(c, h.loops); c.fillStyle = 'rgba(0,15,20,0.35)'; c.fill('evenodd'); c.restore();
    c.save(); c.translate(2, 5); loopsPath(c, h.loops); c.fillStyle = 'rgba(0,15,20,0.25)'; c.fill('evenodd'); c.restore();

    // turf + mowing stripes
    c.save();
    loopsPath(c, h.loops); c.clip('evenodd');
    c.fillStyle = '#5ec552'; c.fillRect(b.minX - 20, b.minY - 20, b.maxX - b.minX + 40, b.maxY - b.minY + 40);
    c.fillStyle = '#55b94a';
    for (let y = Math.floor(b.minY / 32) * 32, i = 0; y < b.maxY + 32; y += 32, i++) {
      if (i % 2 === 0) c.fillRect(b.minX - 20, y, b.maxX - b.minX + 40, 16);
    }
    // faint grain
    c.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 260; i++) {
      const x = b.minX + hash01(i) * (b.maxX - b.minX), y = b.minY + hash01(i + 999) * (b.maxY - b.minY);
      c.fillRect(x, y, 1.2, 3);
    }

    // slopes (hills)
    for (const s of h.slopes) drawSlope(c, s);
    // sand
    for (const z of h.sand) drawSand(c, z);
    // water
    for (const z of h.water) drawWater(c, z);

    // darker turf near walls for depth
    loopsPath(c, h.loops);
    c.strokeStyle = 'rgba(0,40,10,0.16)'; c.lineWidth = 26; c.lineJoin = 'round'; c.stroke();
    loopsPath(c, h.loops);
    c.strokeStyle = 'rgba(0,40,10,0.12)'; c.lineWidth = 14; c.stroke();
    c.restore();

    // tee mat
    drawTee(c, h.tee);
    // cup
    drawCup(c, h.cup);

    // blocks
    for (const p of h.blocks) {
      c.save(); c.translate(2.5, 4); polyPath(c, p); c.fillStyle = 'rgba(0,20,10,0.3)'; c.fill(); c.restore();
      polyPath(c, p); c.fillStyle = '#7f8b95'; c.fill();
      c.save(); polyPath(c, p); c.clip();
      c.translate(-1.5, -2); polyPath(c, p); c.fillStyle = '#a9b4bc'; c.fill(); c.restore();
      polyPath(c, p); c.strokeStyle = '#5f6a73'; c.lineWidth = 1.5; c.lineJoin = 'round'; c.stroke();
    }
    // bumpers
    for (const u of h.bumpers) drawBumper(c, u, 0);
    // interior walls
    for (const w of h.walls) strokeWood(c, () => { c.beginPath(); c.moveTo(w.a.x, w.a.y); c.lineTo(w.b.x, w.b.y); }, MG.WALL_HALF * 2);
    // outline walls
    strokeWood(c, () => loopsPath(c, h.loops), MG.WALL_HALF * 2);
  }

  function drawSlope(c, s) {
    c.save();
    c.beginPath(); c.rect(s.x, s.y, s.w, s.h); c.clip();
    const len = Math.hypot(s.dx, s.dy) || 1, ux = s.dx / len, uy = s.dy / len;
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    const half = Math.abs(ux) * s.w / 2 + Math.abs(uy) * s.h / 2;
    // uphill (opposite push) is lit, downhill is shaded
    const g = c.createLinearGradient(cx - ux * half, cy - uy * half, cx + ux * half, cy + uy * half);
    g.addColorStop(0, 'rgba(255,255,220,0.42)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.0)');
    g.addColorStop(1, 'rgba(0,45,10,0.36)');
    c.fillStyle = g; c.fillRect(s.x, s.y, s.w, s.h);
    // contour lines across the hill
    c.strokeStyle = 'rgba(0,50,15,0.12)'; c.lineWidth = 1.2;
    const px = -uy, py = ux;
    for (let k = -half + 10; k < half; k += 16) {
      c.beginPath();
      c.moveTo(cx + ux * k - px * 400, cy + uy * k - py * 400);
      c.lineTo(cx + ux * k + px * 400, cy + uy * k + py * 400);
      c.stroke();
    }
    // chevrons pointing downhill
    const ang = Math.atan2(uy, ux);
    const step = 26;
    c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 2.6; c.lineCap = 'round'; c.lineJoin = 'round';
    for (let y = s.y + step / 2; y < s.y + s.h; y += step) {
      for (let x = s.x + step / 2; x < s.x + s.w; x += step) {
        c.save(); c.translate(x, y); c.rotate(ang);
        c.strokeStyle = 'rgba(0,50,15,0.25)';
        c.beginPath(); c.moveTo(-3, -5); c.lineTo(4, 1); c.lineTo(-3, 7); c.stroke();
        c.strokeStyle = 'rgba(255,255,255,0.7)';
        c.beginPath(); c.moveTo(-4, -6); c.lineTo(3, 0); c.lineTo(-4, 6); c.stroke();
        c.restore();
      }
    }
    // edge ridge lines at the top and bottom of the hill
    c.restore();
    c.save();
    c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 1.5; c.setLineDash([4, 5]);
    c.strokeRect(s.x + 0.75, s.y + 0.75, s.w - 1.5, s.h - 1.5);
    c.restore();
  }

  function drawSand(c, z) {
    c.save(); c.translate(0, 1.5); polyPath(c, z); c.fillStyle = 'rgba(80,60,20,0.25)'; c.fill(); c.restore();
    polyPath(c, z); c.fillStyle = '#efd49a'; c.fill();
    c.save(); polyPath(c, z); c.clip();
    const cen = MG.geom.polyCentroid(z);
    c.fillStyle = 'rgba(150,110,50,0.35)';
    for (let i = 0; i < 40; i++) {
      const a = hash01(i + cen.x) * Math.PI * 2, r = hash01(i * 3 + cen.y) * 30;
      c.fillRect(cen.x + Math.cos(a) * r, cen.y + Math.sin(a) * r, 1.2, 1.2);
    }
    polyPath(c, z); c.strokeStyle = 'rgba(180,135,60,0.6)'; c.lineWidth = 4; c.stroke();
    c.restore();
  }

  function drawWater(c, z) {
    const cen = MG.geom.polyCentroid(z);
    polyPath(c, z); c.strokeStyle = '#c9b98a'; c.lineWidth = 6; c.lineJoin = 'round'; c.stroke(); // muddy bank
    polyPath(c, z);
    const g = c.createRadialGradient(cen.x - 4, cen.y - 4, 2, cen.x, cen.y, 40);
    g.addColorStop(0, '#6fd0f4'); g.addColorStop(1, '#2391cc');
    c.fillStyle = g; c.fill();
    c.save(); polyPath(c, z); c.clip();
    polyPath(c, z); c.strokeStyle = 'rgba(10,70,120,0.45)'; c.lineWidth = 6; c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1.5; c.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const x = cen.x - 10 + i * 9, y = cen.y - 6 + i * 6;
      c.beginPath(); c.arc(x, y, 5, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
    }
    c.restore();
    polyPath(c, z); c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 1.4; c.stroke();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function drawTee(c, t) {
    roundRect(c, t.x - 17, t.y - 11, 34, 22, 6); c.fillStyle = 'rgba(0,50,10,0.18)'; c.fill();
    roundRect(c, t.x - 16, t.y - 10, 32, 20, 5); c.fillStyle = '#48a83e'; c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1.2; c.stroke();
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(t.x - 11, t.y, 2.2, 0, 7); c.fill();
    c.beginPath(); c.arc(t.x + 11, t.y, 2.2, 0, 7); c.fill();
  }
  function drawCup(c, p) {
    c.beginPath(); c.arc(p.x, p.y, MG.CUP_R + 3, 0, Math.PI * 2); c.fillStyle = 'rgba(0,40,10,0.15)'; c.fill();
    c.beginPath(); c.arc(p.x, p.y, MG.CUP_R, 0, Math.PI * 2);
    const g = c.createRadialGradient(p.x, p.y + 3, 1, p.x, p.y, MG.CUP_R);
    g.addColorStop(0, '#0b1710'); g.addColorStop(1, '#22382a');
    c.fillStyle = g; c.fill();
    c.beginPath(); c.arc(p.x, p.y - 2.5, MG.CUP_R - 2.5, Math.PI * 0.05, Math.PI * 0.95);
    c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 2; c.stroke();
    c.beginPath(); c.arc(p.x, p.y, MG.CUP_R + 0.6, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.4; c.stroke();
  }
  function drawBumper(c, u, flash) {
    c.beginPath(); c.arc(u.x + 2, u.y + 3.5, u.r, 0, 7); c.fillStyle = 'rgba(0,20,10,0.3)'; c.fill();
    c.beginPath(); c.arc(u.x, u.y, u.r, 0, 7); c.fillStyle = flash ? '#ffd166' : '#e8483b'; c.fill();
    c.beginPath(); c.arc(u.x, u.y, u.r * 0.66, 0, 7); c.fillStyle = '#fff7ec'; c.fill();
    c.beginPath(); c.arc(u.x, u.y, u.r * 0.34, 0, 7); c.fillStyle = flash ? '#ffb000' : '#e8483b'; c.fill();
    c.beginPath(); c.arc(u.x - u.r * 0.3, u.y - u.r * 0.35, u.r * 0.25, 0, 7); c.fillStyle = 'rgba(255,255,255,0.6)'; c.fill();
  }

  /* ---------------- dynamic render ---------------- */
  function render() {
    const v = S.view, c = ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(staticCanvas, 0, 0);
    if (!S.sim) return;
    const sim = S.sim, h = sim.hole, b = sim.ball;
    c.setTransform(v.dpr * v.s, 0, 0, v.dpr * v.s, v.dpr * v.ox, v.dpr * v.oy);

    // bumper flashes
    for (const f of S.flashes) drawBumper(c, f.u, true);

    // sliders
    for (const s of h.sliders) {
      const p = MG.sliderPos(s, sim.t);
      roundRect(c, p.x - s.w / 2 + 2.5, p.y - s.h / 2 + 4, s.w, s.h, 4); c.fillStyle = 'rgba(0,20,10,0.3)'; c.fill();
      roundRect(c, p.x - s.w / 2, p.y - s.h / 2, s.w, s.h, 4); c.fillStyle = '#d9822b'; c.fill();
      roundRect(c, p.x - s.w / 2 + 1.5, p.y - s.h / 2 + 1.2, s.w - 3, s.h - 4, 3); c.fillStyle = '#ffa94d'; c.fill();
      // little arrows showing which way it slides
      c.save(); c.translate(p.x, p.y - 0.6); c.rotate(Math.atan2(s.ay, s.ax));
      const L = (s.ax ? s.w : s.h) / 2 - 3.5;
      c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1.6; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(-L + 3, -3); c.lineTo(-L, 0); c.lineTo(-L + 3, 3);
      c.moveTo(L - 3, -3); c.lineTo(L, 0); c.lineTo(L - 3, 3);
      c.moveTo(-L + 1, 0); c.lineTo(L - 1, 0); c.stroke();
      c.restore();
    }
    // spinners
    for (const s of h.spinners) {
      const a0 = MG.spinnerAngle(s, sim.t);
      for (let k = 0; k < s.bars; k++) {
        const a = a0 + (k * Math.PI) / s.bars;
        const ux = Math.cos(a) * s.len, uy = Math.sin(a) * s.len;
        const seg = (dx, dy) => { c.beginPath(); c.moveTo(s.x - ux + dx, s.y - uy + dy); c.lineTo(s.x + ux + dx, s.y + uy + dy); };
        c.lineCap = 'round';
        seg(2.5, 4); c.strokeStyle = 'rgba(0,20,10,0.3)'; c.lineWidth = 9; c.stroke();
        seg(0, 0); c.strokeStyle = '#2a5c8f'; c.lineWidth = 9; c.stroke();
        seg(0, 0); c.strokeStyle = '#4f9be0'; c.lineWidth = 5.5; c.stroke();
        c.save(); c.setLineDash([6, 6]); seg(-0.5, -0.8); c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 1.6; c.stroke(); c.restore();
      }
      c.beginPath(); c.arc(s.x + 1.5, s.y + 2.5, 7.5, 0, 7); c.fillStyle = 'rgba(0,20,10,0.3)'; c.fill();
      c.beginPath(); c.arc(s.x, s.y, 7.5, 0, 7); c.fillStyle = '#ffd166'; c.fill();
      c.strokeStyle = '#c9952e'; c.lineWidth = 1.5; c.stroke();
      c.beginPath(); c.arc(s.x - 2, s.y - 2, 2.2, 0, 7); c.fillStyle = 'rgba(255,255,255,0.7)'; c.fill();
    }

    // trail
    if (S.trail.length > 1) {
      c.lineCap = 'round';
      for (let i = 1; i < S.trail.length; i++) {
        const a = S.trail[i - 1], q = S.trail[i];
        const k = i / S.trail.length;
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(q.x, q.y);
        c.strokeStyle = 'rgba(255,255,255,' + (0.42 * k).toFixed(3) + ')';
        c.lineWidth = MG.BALL_R * 1.5 * k; c.stroke();
      }
    }

    // ball
    if (sim.state !== 'splash' && sim.state !== 'sunk') {
      const r = MG.BALL_R * sim.scale;
      const sinking = sim.state === 'sinking';
      if (!sinking) { c.beginPath(); c.ellipse(b.x + 2.2, b.y + 3, r * 1.02, r * 0.9, 0, 0, 7); c.fillStyle = 'rgba(0,25,10,0.32)'; c.fill(); }
      c.beginPath(); c.arc(b.x, b.y, r, 0, 7);
      const g = c.createRadialGradient(b.x - r * 0.35, b.y - r * 0.4, r * 0.1, b.x, b.y, r);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.7, '#f1f4f6'); g.addColorStop(1, sinking ? '#55636b' : '#c9d2d8');
      c.fillStyle = g; c.fill();
      if (sinking) { c.fillStyle = 'rgba(10,25,15,' + (1 - sim.scale).toFixed(2) + ')'; c.fill(); }
    }

    // flag (fades when the ball gets close)
    {
      const p = h.cup;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      const alpha = sim.state === 'sinking' || sim.state === 'sunk' ? 0.25 : clamp((d - 18) / 50, 0.28, 1);
      c.save(); c.globalAlpha = alpha;
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + 16, p.y + 9); c.strokeStyle = 'rgba(0,25,10,0.3)'; c.lineWidth = 2; c.stroke();
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x, p.y - 44); c.strokeStyle = '#f4f1e8'; c.lineWidth = 2.2; c.lineCap = 'round'; c.stroke();
      const wv = Math.sin(S.time * 4) * 2.5;
      c.beginPath(); c.moveTo(p.x + 1, p.y - 44);
      c.quadraticCurveTo(p.x + 11, p.y - 42 + wv, p.x + 22, p.y - 37 + wv * 0.6);
      c.quadraticCurveTo(p.x + 11, p.y - 32 - wv * 0.4, p.x + 1, p.y - 30);
      c.closePath(); c.fillStyle = '#ff6b5b'; c.fill();
      c.beginPath(); c.arc(p.x, p.y - 45, 1.8, 0, 7); c.fillStyle = '#ffd166'; c.fill();
      c.restore();
    }

    // fx
    for (const f of S.fx) {
      const k = f.t / f.life;
      if (f.kind === 'ring') {
        c.beginPath(); c.arc(f.x, f.y, f.r0 + (f.r1 - f.r0) * k, 0, 7);
        c.strokeStyle = f.color.replace('A', (1 - k).toFixed(2)); c.lineWidth = 2.2 * (1 - k) + 0.5; c.stroke();
      } else if (f.kind === 'p') {
        c.save(); c.globalAlpha = 1 - k; c.translate(f.x, f.y); c.rotate(f.rot);
        c.fillStyle = f.color; c.fillRect(-f.size / 2, -f.size / 4, f.size, f.size / 2); c.restore();
      } else if (f.kind === 'drop') {
        c.beginPath(); c.arc(f.x, f.y, f.size * (1 - k * 0.5), 0, 7); c.fillStyle = 'rgba(160,220,255,' + (1 - k).toFixed(2) + ')'; c.fill();
      }
    }

    // aim
    if (S.aim && sim.state === 'rest') drawAim(c);
  }

  function aimInfo() {
    const a = S.aim; if (!a) return null;
    const dx = a.x0 - a.x, dy = a.y0 - a.y;
    const len = Math.hypot(dx, dy);
    const maxDrag = clamp(Math.min(S.view.w, S.view.h) * 0.42, 110, 240);
    const power = clamp(len / maxDrag, 0, 1);
    return { ux: len ? dx / len : 0, uy: len ? dy / len : -1, power, len };
  }

  function drawAim(c) {
    const ai = aimInfo(); if (!ai) return;
    const b = S.sim.ball, v = S.view;
    const live = ai.power >= PH.MIN_SHOT;
    const hue = 120 - 120 * ai.power;
    const col = live ? 'hsl(' + hue + ',85%,55%)' : 'rgba(255,255,255,0.5)';
    if (live) {
      // dotted guide
      const L = 30 + ai.power * 190;
      for (let d = MG.BALL_R + 8, i = 0; d < L; d += 9, i++) {
        const k = d / L;
        c.beginPath(); c.arc(b.x + ai.ux * d, b.y + ai.uy * d, 2.6 - k * 1.1, 0, 7);
        c.fillStyle = 'rgba(255,255,255,' + (0.95 - k * 0.6).toFixed(2) + ')'; c.fill();
      }
      // arrow head
      const ex = b.x + ai.ux * (L + 4), ey = b.y + ai.uy * (L + 4);
      c.save(); c.translate(ex, ey); c.rotate(Math.atan2(ai.uy, ai.ux));
      c.beginPath(); c.moveTo(8, 0); c.lineTo(-5, -7); c.lineTo(-2, 0); c.lineTo(-5, 7); c.closePath();
      c.fillStyle = col; c.fill(); c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1; c.stroke();
      c.restore();
      // slingshot band behind the ball
      const bl = 8 + ai.power * 34;
      c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(b.x - ai.ux * bl, b.y - ai.uy * bl);
      c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 2; c.setLineDash([3, 3]); c.stroke(); c.setLineDash([]);
      c.beginPath(); c.arc(b.x - ai.ux * bl, b.y - ai.uy * bl, 3, 0, 7); c.fillStyle = 'rgba(255,255,255,0.8)'; c.fill();
    }
    // power ring
    c.beginPath(); c.arc(b.x, b.y, 15, 0, 7); c.strokeStyle = 'rgba(0,30,20,0.3)'; c.lineWidth = 4.5; c.stroke();
    if (ai.power > 0) {
      c.beginPath(); c.arc(b.x, b.y, 15, -Math.PI / 2, -Math.PI / 2 + ai.power * Math.PI * 2);
      c.strokeStyle = col; c.lineWidth = 4.5; c.lineCap = 'round'; c.stroke();
    }

    // screen-space: drag guide + power bar
    c.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    const a = S.aim;
    c.beginPath(); c.arc(a.x0, a.y0, 16, 0, 7); c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 2; c.stroke();
    c.beginPath(); c.moveTo(a.x0, a.y0); c.lineTo(a.x, a.y); c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 2; c.stroke();
    c.beginPath(); c.arc(a.x, a.y, 9, 0, 7); c.fillStyle = 'rgba(255,255,255,0.25)'; c.fill();

    const bw = Math.min(220, v.w * 0.6), bh = 12;
    const bx = (v.w - bw) / 2, by = v.h - v.safeB - 30;
    roundRect(c, bx - 3, by - 3, bw + 6, bh + 6, 9); c.fillStyle = 'rgba(10,40,45,0.7)'; c.fill();
    if (ai.power > 0) {
      const g = c.createLinearGradient(bx, 0, bx + bw, 0);
      g.addColorStop(0, '#5ee06a'); g.addColorStop(0.55, '#ffd23f'); g.addColorStop(1, '#ff4d3d');
      c.save(); roundRect(c, bx, by, bw, bh, 6); c.clip();
      c.fillStyle = g; c.fillRect(bx, by, bw * ai.power, bh); c.restore();
    }
    c.font = '700 12px ui-rounded, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.fillText(live ? Math.round(ai.power * 100) + '%' : 'Release to cancel', v.w / 2, by - 6);
  }

  /* ---------------- fx helpers ---------------- */
  function addRing(x, y, r0, r1, life, color) { S.fx.push({ kind: 'ring', x, y, r0, r1, life, t: 0, color }); }
  function confetti(x, y) {
    const cols = ['#ff6b5b', '#ffd166', '#4fb5ff', '#7bdc6b', '#b48cff', '#ffffff'];
    for (let i = 0; i < 36; i++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 160;
      S.fx.push({ kind: 'p', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, size: 4 + Math.random() * 3, life: 0.9 + Math.random() * 0.5, t: 0, color: cols[i % cols.length], drag: 2.2 });
    }
  }
  function splash(x, y) {
    addRing(x, y, 4, 26, 0.7, 'rgba(255,255,255,A)');
    addRing(x, y, 2, 16, 0.5, 'rgba(200,240,255,A)');
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 90;
      S.fx.push({ kind: 'drop', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: 1.5 + Math.random() * 1.8, life: 0.5 + Math.random() * 0.3, t: 0, drag: 3 });
    }
  }
  function updateFx(dt) {
    for (const f of S.fx) {
      f.t += dt;
      if (f.vx != null) {
        f.x += f.vx * dt; f.y += f.vy * dt;
        const d = Math.exp(-(f.drag || 0) * dt); f.vx *= d; f.vy *= d;
        if (f.vr) f.rot += f.vr * dt;
      }
    }
    S.fx = S.fx.filter((f) => f.t < f.life);
    for (const f of S.flashes) f.t -= dt;
    S.flashes = S.flashes.filter((f) => f.t > 0);
  }

  /* ---------------- UI ---------------- */
  let toastTimer = 0;
  function toast(text, small, ms) {
    const el = $('toast');
    el.textContent = text;
    el.classList.toggle('small', !!small);
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms || 1200);
  }
  function totalToPar() {
    let t = 0;
    S.scores.forEach((sc, i) => { if (sc != null) t += sc - S.holes[i].par; });
    return t;
  }
  function updateHud() {
    const h = S.holes[S.idx];
    $('hHole').textContent = S.idx + 1;
    $('hPar').textContent = h ? h.par : '-';
    $('hStrokes').textContent = S.strokes;
    $('hTotal').textContent = fmtToPar(totalToPar());
    $('holeName').textContent = h ? h.name : '';
  }
  function showModal(id, on) { $(id).classList.toggle('show', on); }
  function setPaused(p) {
    S.paused = p;
    if (p) S.aim = null;
  }

  function readBest() { try { return JSON.parse(lsGet(LS_BEST) || 'null'); } catch (e) { return null; } }
  function bestText() {
    const b = readBest();
    return b ? 'Best round: ' + fmtToPar(b.toPar) + ' (' + b.strokes + ' strokes)' : '';
  }

  function buildScorecard(final) {
    const t = $('scTable');
    let parTot = 0, scTot = 0;
    let head = '<tr><th class="rowlbl">Hole</th>', par = '<tr class="par"><td class="rowlbl">Par</td>', sc = '<tr class="score"><td class="rowlbl">Score</td>';
    S.holes.forEach((h, i) => {
      head += '<th>' + (i + 1) + '</th>';
      par += '<td>' + h.par + '</td>';
      parTot += h.par;
      const s = S.scores[i];
      let cls = '';
      if (s != null) { scTot += s; cls = s < h.par ? 'under' : s > h.par ? 'over' : ''; }
      if (!final && i === S.idx && s == null) cls += ' cur';
      sc += '<td class="' + cls + '">' + (s != null ? s : '–') + '</td>';
    });
    head += '<th>Tot</th></tr>'; par += '<td class="tot">' + parTot + '</td></tr>'; sc += '<td class="tot">' + scTot + '</td></tr>';
    t.innerHTML = head + par + sc;
    const tp = totalToPar();
    $('scTotal').textContent = final ? scTot + ' strokes · ' + fmtToPar(tp) : 'So far: ' + fmtToPar(tp);
    $('scSub').textContent = 'Round ' + MG.seedToCode(S.seed);
    $('scTitle').textContent = final ? (tp < 0 ? 'Under par!' : tp === 0 ? 'Right on par' : 'Round complete') : 'Scorecard';
    $('scCloseBtn').classList.toggle('hidden', final);
  }

  /* ---------------- flow ---------------- */
  function setHash() {
    try { history.replaceState(null, '', location.pathname + location.search + '#r=' + MG.seedToCode(S.seed)); } catch (e) { /* file:// etc */ }
  }
  function startRound(seed) {
    S.seed = seed >>> 0;
    S.holes = MG.buildRound(S.seed);
    S.scores = new Array(S.holes.length).fill(null);
    setHash();
    loadHole(0);
  }
  function loadHole(i) {
    S.token = (S.token || 0) + 1; // invalidates pending hole transitions
    S.idx = i; S.strokes = 0;
    S.sim = MG.createSim(S.holes[i]);
    S.trail = []; S.fx = []; S.flashes = []; S.aim = null;
    S.phase = 'play';
    updateHud();
    layout();
    $('roundCode').textContent = 'Round ' + MG.seedToCode(S.seed) + ' · Hole ' + (i + 1) + ': ' + S.holes[i].name;
    const fade = $('fade'); fade.classList.remove('on');
  }
  function nextHole(token) {
    if (token !== S.token) return;
    const fade = $('fade');
    fade.classList.add('on');
    setTimeout(() => {
      if (token !== S.token) return;
      if (S.idx + 1 >= S.holes.length) finishRound();
      else loadHole(S.idx + 1);
    }, 300);
  }
  function finishRound() {
    S.token++;
    S.phase = 'done';
    $('fade').classList.remove('on');
    const tp = totalToPar();
    const strokes = S.scores.reduce((a, b) => a + (b || 0), 0);
    const best = readBest();
    let newBest = false;
    if (!best || tp < best.toPar || (tp === best.toPar && strokes < best.strokes)) {
      lsSet(LS_BEST, JSON.stringify({ toPar: tp, strokes, code: MG.seedToCode(S.seed), date: new Date().toISOString().slice(0, 10) }));
      newBest = true;
    }
    buildScorecard(true);
    $('scBest').textContent = newBest ? 'New best round!' : bestText();
    showModal('scorecard', true);
    Sound.cheer(tp <= 0);
  }
  function scoreName(strokes, par) {
    if (strokes === 1) return 'Hole in One!';
    const d = strokes - par;
    if (d <= -3) return 'Albatross!';
    if (d === -2) return 'Eagle!';
    if (d === -1) return 'Birdie!';
    if (d === 0) return 'Par';
    if (d === 1) return 'Bogey';
    if (d === 2) return 'Double Bogey';
    return '+' + d;
  }
  function holeDone(score, label) {
    S.scores[S.idx] = score;
    S.phase = 'between';
    updateHud();
    toast(label, false, 1300);
    const tk = S.token;
    setTimeout(() => nextHole(tk), 1500);
  }
  function checkMax() {
    if (S.phase !== 'play') return;
    if (S.strokes >= MAX_STROKES && S.sim.state === 'rest') {
      holeDone(MAX_STROKES, 'Max strokes');
    }
  }

  function handleEvents(ev) {
    for (const e of ev) {
      switch (e.type) {
        case 'wall': Sound.clink(e.speed); if (e.speed > 320) vib(6); break;
        case 'bumper': {
          Sound.bumper(); vib(10);
          const u = S.sim.hole.bumpers.find((q) => Math.abs(q.x - e.x) < 0.01 && Math.abs(q.y - e.y) < 0.01);
          if (u) S.flashes.push({ u, t: 0.12 });
          addRing(e.x, e.y, u ? u.r : 10, (u ? u.r : 10) + 10, 0.3, 'rgba(255,220,120,A)');
          break;
        }
        case 'mover': Sound.mover(); vib(12); break;
        case 'lip': Sound.lip(); toast('Lip out!', true, 700); break;
        case 'sink': Sound.plop(); vib([18, 40, 30]); break;
        case 'sunk': {
          const h = S.sim.hole;
          confetti(h.cup.x, h.cup.y);
          addRing(h.cup.x, h.cup.y, MG.CUP_R, MG.CUP_R + 22, 0.6, 'rgba(255,255,255,A)');
          const name = scoreName(S.strokes, h.par);
          if (S.strokes - h.par <= 0) Sound.cheer(S.strokes - h.par < 0 || S.strokes === 1);
          holeDone(S.strokes, name);
          break;
        }
        case 'water':
          Sound.splash(); vib(35); splash(e.x, e.y);
          S.strokes += 1; updateHud();
          toast('Splash! +1', true, 1000);
          break;
        case 'reset': {
          const b = S.sim.ball; addRing(b.x, b.y, 3, 18, 0.45, 'rgba(255,255,255,A)');
          S.trail = []; checkMax(); break;
        }
        case 'rest': checkMax(); break;
        case 'pushed': S.aim = null; break;
      }
    }
  }

  /* ---------------- input ---------------- */
  function onDown(e) {
    Sound.unlock();
    if (S.phase !== 'play' || S.paused || !S.sim || S.sim.state !== 'rest' || S.aim) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    S.aim = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
    S.lastPowerStep = 0;
    if (S.hintShown) { $('hint').classList.add('off'); S.hintShown = false; }
  }
  function onMove(e) {
    if (!S.aim || e.pointerId !== S.aim.id) return;
    e.preventDefault();
    S.aim.x = e.clientX; S.aim.y = e.clientY;
    const ai = aimInfo();
    const step = Math.floor(ai.power * 10);
    if (step !== S.lastPowerStep) { S.lastPowerStep = step; Sound.tick(); }
  }
  function onUp(e) {
    if (!S.aim || e.pointerId !== S.aim.id) return;
    e.preventDefault();
    S.aim.x = e.clientX; S.aim.y = e.clientY;
    const ai = aimInfo();
    S.aim = null;
    if (!ai || ai.power < PH.MIN_SHOT || S.sim.state !== 'rest' || S.phase !== 'play') return;
    if (MG.shoot(S.sim, ai.ux, ai.uy, ai.power)) {
      S.strokes += 1; updateHud();
      Sound.putt(ai.power); vib(8);
      S.trail = [];
    }
  }
  function onCancel(e) { if (S.aim && e.pointerId === S.aim.id) S.aim = null; }

  canvas.addEventListener('pointerdown', onDown, { passive: false });
  canvas.addEventListener('pointermove', onMove, { passive: false });
  canvas.addEventListener('pointerup', onUp, { passive: false });
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('lostpointercapture', onCancel);

  // No scrolling, zooming or pull-to-refresh while playing.
  const blockTouch = (e) => { if (!e.target.closest || !e.target.closest('.card')) e.preventDefault(); };
  document.addEventListener('touchmove', blockTouch, { passive: false });
  document.addEventListener('touchstart', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend', 'dblclick', 'contextmenu'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));

  /* ---------------- buttons ---------------- */
  const tap = (id, fn) => $(id).addEventListener('click', (e) => { e.preventDefault(); Sound.unlock(); fn(); });
  function refreshMuteIcon() { $('icoSound').classList.toggle('hidden', Sound.muted); $('icoMute').classList.toggle('hidden', !Sound.muted); }
  tap('muteBtn', () => { Sound.setMuted(!Sound.muted); lsSet(LS_MUTE, Sound.muted ? '1' : '0'); refreshMuteIcon(); });
  tap('menuBtn', () => { if (S.phase === 'title') return; setPaused(true); showModal('menu', true); });
  tap('resumeBtn', () => { showModal('menu', false); setPaused(false); });
  tap('cardBtn', () => { showModal('menu', false); buildScorecard(false); $('scBest').textContent = bestText(); showModal('scorecard', true); });
  tap('scCloseBtn', () => { showModal('scorecard', false); setPaused(false); });
  tap('restartBtn', () => { showModal('menu', false); setPaused(false); startRound(S.seed); });
  tap('newRoundBtn2', () => { showModal('menu', false); setPaused(false); startRound(MG.randomSeed()); });
  tap('replayBtn', () => { showModal('scorecard', false); setPaused(false); startRound(S.seed); });
  tap('newRoundBtn', () => { showModal('scorecard', false); setPaused(false); startRound(MG.randomSeed()); });
  tap('playBtn', () => {
    showModal('title', false);
    setPaused(false);
    S.phase = 'play';
    $('hint').classList.remove('off');
  });

  /* ---------------- visibility / resize ---------------- */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      Sound.suspend();
      if (S.phase === 'play' || S.phase === 'between') { setPaused(true); if (S.phase === 'play') showModal('menu', true); }
    } else {
      Sound.resume();
      lastT = performance.now();
      if (S.phase === 'between') setPaused(false);
    }
  });
  let resizeT = 0;
  const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(layout, 60); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  /* ---------------- loop ---------------- */
  let lastT = performance.now(), acc = 0;
  const events = [];
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - lastT) / 1000; lastT = now;
    if (dt > 0.1) dt = 0.1; if (dt < 0) dt = 0;
    if (S.paused || !S.sim) { if (!S.drawnPaused) { render(); S.drawnPaused = true; } return; }
    S.drawnPaused = false;
    S.time += dt;
    acc += dt;
    let n = 0;
    while (acc >= PH.STEP && n < 14) {
      MG.step(S.sim, PH.STEP, events);
      acc -= PH.STEP; n++;
    }
    if (n >= 14) acc = 0;
    if (events.length) { const copy = events.splice(0); handleEvents(copy); }
    const b = S.sim.ball;
    if (S.sim.state === 'moving') {
      S.trail.push({ x: b.x, y: b.y });
      if (S.trail.length > 18) S.trail.shift();
    } else if (S.trail.length) S.trail.shift();
    updateFx(dt);
    render();
  }

  /* ---------------- boot ---------------- */
  Sound.muted = lsGet(LS_MUTE) === '1';
  refreshMuteIcon();
  $('bestLine').textContent = bestText();
  const params = new URLSearchParams(location.search);
  const hashCode = (location.hash.match(/r=([0-9a-z]+)/i) || [])[1];
  const seed = MG.codeToSeed(params.get('seed') || hashCode) || MG.randomSeed();
  startRound(seed);
  S.phase = 'title';
  const startHole = parseInt(params.get('hole'), 10);
  if (startHole >= 1 && startHole <= 9) { loadHole(startHole - 1); S.phase = 'title'; }
  if (params.get('autoplay') === '1') { showModal('title', false); S.phase = 'play'; }
  requestAnimationFrame((t) => { lastT = t; frame(t); });

  // Small hook for automated testing / debugging.
  window.PocketPutt = { state: S, loadHole, startRound };
})();
