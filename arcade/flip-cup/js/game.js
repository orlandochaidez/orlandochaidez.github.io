// Flip Cup: phone-only flick game. Two modes:
//  cup    - a red cup sits on the table edge; flick the phone to flip it rim-down. 6 cups, race the clock.
//  bottle - a water bottle sits in your palm; pancake-toss it so it lands on its base on the table.
// Physics runs in meters (y up). The flick strength comes from the phone's gyroscope peak rotation rate.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const cvs = $('game'), ctx = cvs.getContext('2d');
  const params = new URLSearchParams(location.search);
  const DESK = params.has('desk');               // debug: allow desktop + swipe
  const G = 9.8;
  const TAU = Math.PI * 2;
  const CUPS_PER_ROUND = 6;

  // ---------- geometry ----------
  const CUP = { H: 0.12, bw: 0.056, rw: 0.088 };
  const BOT = { H: 0.21, W: 0.066 };
  const TABLE_LEFT_BOTTLE = 0.26;               // table starts here in bottle mode (palm is at x=0)
  const PALM_Y = 0.24;

  function shapePts(mode) {
    if (mode === 'cup') {
      const h = CUP.H / 2;
      return [[-CUP.bw / 2, -h], [CUP.bw / 2, -h], [CUP.rw / 2, h], [-CUP.rw / 2, h]];
    }
    const h = BOT.H / 2, w = BOT.W / 2;
    return [[-w, -h], [w, -h], [w, h * 0.55], [w * 0.45, h], [-w * 0.45, h], [-w, h * 0.55]];
  }
  function lowest(b, pts) {
    const c = Math.cos(b.th), s = Math.sin(b.th);
    let my = Infinity, mx = 0;
    for (const [px, py] of pts) {
      const y = b.y + px * s + py * c, x = b.x + px * c - py * s;
      if (y < my) { my = y; mx = x; }
    }
    return { y: my, x: mx };
  }
  const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const nearest = (th, base, step) => base + Math.round((th - base) / step) * step;

  // ---------- body / launch ----------
  function restBody(mode) {
    if (mode === 'cup') return { x: 0.035, y: CUP.H / 2, vx: 0, vy: 0, th: 0, w: 0, rot: 0 };
    return { x: 0.0, y: PALM_Y + BOT.H / 2, vx: 0, vy: 0, th: 0, w: 0, rot: 0 };
  }
  function launch(mode, p) {
    const b = restBody(mode);
    if (mode === 'cup') {
      b.vx = 0.22; b.vy = 1.15 + 1.6 * p; b.w = -(560 * (0.35 + 0.65 * p)) * Math.PI / 180;
    } else {
      b.vx = 0.6; b.vy = 2.2 + 1.2 * p; b.w = -(1575 * (0.5 + 0.5 * p)) * Math.PI / 180;
    }
    return b;
  }
  // Advance one step. Returns null while flying, or an outcome object on landing.
  function step(mode, b, dt) {
    b.vy -= G * dt;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (mode === 'bottle') b.w *= Math.exp(-3.0 * dt);   // sloshing water bleeds off spin
    else b.w *= Math.exp(-0.15 * dt);
    b.th += b.w * dt; b.rot += Math.abs(b.w * dt);
    if (b.vy > 0) return null;
    const lo = lowest(b, shapePts(mode));
    if (mode === 'bottle') {
      if (lo.x < TABLE_LEFT_BOTTLE - 0.01) {
        if (b.y < -0.9) return { kind: 'miss' };
        return null;
      }
    }
    if (lo.y > 0) return null;
    return judge(mode, b);
  }
  function judge(mode, b) {
    const a = wrap(b.th), wDeg = Math.abs(b.w) * 180 / Math.PI;
    if (mode === 'cup') {
      const tol = 0.42;
      if (Math.abs(Math.abs(a) - Math.PI) < tol) return { kind: 'win', target: nearest(b.th, Math.PI, TAU) };
      if (Math.abs(a) < tol) return { kind: b.rot < 1 ? 'soft' : 'over', target: nearest(b.th, 0, TAU) };
      return { kind: b.rot < Math.PI ? 'soft' : 'hard', target: nearest(b.th, Math.PI / 2, Math.PI) };
    }
    const tol = 0.42;
    if (Math.abs(a) < tol && wDeg < 560) {
      if (b.rot < 4.2) return { kind: 'soft', target: nearest(b.th, 0, TAU), upright: true };
      return { kind: b.rot > 10.5 ? 'double' : 'win', target: nearest(b.th, 0, TAU) };
    }
    if (Math.abs(Math.abs(a) - Math.PI) < 0.22 && wDeg < 360) return { kind: 'cap', target: nearest(b.th, Math.PI, TAU) };
    return { kind: b.rot < TAU ? 'soft' : 'hard', target: nearest(b.th, Math.PI / 2, Math.PI) };
  }
  function simulate(mode, p) {
    const b = launch(mode, p);
    for (let i = 0; i < 4000; i++) { const r = step(mode, b, 1 / 240); if (r) return r.kind; }
    return 'miss';
  }
  // Sweet-spot zone per mode (used for the power meter).
  const P_MAX = 1.2;
  const ZONES = {};
  for (const m of ['cup', 'bottle']) {
    let lo = null, hi = null;
    for (let p = 0; p <= P_MAX; p += 0.004) {
      const k = simulate(m, p);
      if (k === 'win' || k === 'double') { if (lo === null) lo = p; hi = p; }
      else if (lo !== null && m === 'cup') break;
      else if (lo !== null && m === 'bottle' && k !== 'win') break;
    }
    ZONES[m] = { lo: lo ?? 0.5, hi: hi ?? 0.6 };
  }

  // ---------- state ----------
  const S = {
    mode: null, body: null, phase: 'idle', // idle | flying | settle | result
    settle: null, outcome: null, resultT: 0,
    flat: false, flatSince: 0, armed: false, tiltX: 0, tiltY: 0,
    sensor: false, fallback: DESK, gotMotion: false,
    capture: null, lastP: null,
    cupsDone: 0, tStart: 0, tEnd: 0, running: false,
    streak: 0, total: 0,
    particles: [], shake: 0, slosh: 0,
  };
  const best = {
    get cup() { return parseFloat(localStorage.getItem('flipcup.bestCup')) || null; },
    set cup(v) { localStorage.setItem('flipcup.bestCup', String(v)); },
    get streak() { return parseInt(localStorage.getItem('flipcup.bestStreak') || '0', 10); },
    set streak(v) { localStorage.setItem('flipcup.bestStreak', String(v)); },
  };

  // ---------- UI ----------
  const isPhone = DESK || (matchMedia('(pointer:coarse)').matches && ('ontouchstart' in window) && Math.min(screen.width, screen.height) < 820);
  function show(id, on = true) { $(id).classList.toggle('show', on); }
  function hud(on) { $('hud').classList.toggle('hidden', !on); $('status').classList.toggle('hidden', !on); }
  let toastTimer = 0;
  function toast(html, cls = '', ms = 1200) {
    const t = $('toast'); t.innerHTML = html; t.className = 'toast show ' + cls;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'toast ' + cls; }, ms);
  }
  function setMeter(p) {
    const m = $('meter'); m.classList.remove('hidden');
    const z = ZONES[S.mode];
    $('zone').style.left = (z.lo / P_MAX * 100) + '%';
    $('zone').style.width = ((z.hi - z.lo) / P_MAX * 100) + '%';
    $('needle').style.left = (clamp(p, 0, P_MAX) / P_MAX * 100) + '%';
  }
  function updateHud() {
    if (S.mode === 'cup') {
      $('l1').textContent = 'Cups'; $('v1').textContent = `${S.cupsDone}/${CUPS_PER_ROUND}`;
      $('l2').textContent = 'Time';
      const t = S.running ? (performance.now() - S.tStart) / 1000 : (S.tEnd ? (S.tEnd - S.tStart) / 1000 : 0);
      $('v2').textContent = t.toFixed(1);
      $('l3').textContent = 'Best'; $('v3').textContent = best.cup ? best.cup.toFixed(1) : '--';
    } else {
      $('l1').textContent = 'Streak'; $('v1').textContent = S.streak;
      $('l2').textContent = 'Landed'; $('v2').textContent = S.total;
      $('l3').textContent = 'Best'; $('v3').textContent = best.streak;
    }
  }
  function setStatus() {
    const st = $('status'), tx = $('statusText');
    let ready = false, msg;
    if (S.phase !== 'idle') msg = S.phase === 'flying' ? 'Flipping...' : '...';
    else if (S.fallback && !S.sensor) { msg = 'Swipe up fast to flick'; ready = true; }
    else if (!S.flat) msg = 'Lay your phone flat, face up';
    else if (!S.armed) msg = 'Hold it flat...';
    else { msg = S.mode === 'cup' ? 'Ready. Flick it!' : 'Ready. Toss it!'; ready = true; }
    tx.textContent = msg; st.classList.toggle('ready', ready);
    $('bubble').style.transform = `translate(${clamp(S.tiltX, -1, 1) * 10}px, ${clamp(S.tiltY, -1, 1) * 10}px)`;
  }

  const HOW = {
    cup: ['Hold your phone flat in your palm, screen up, like the cup is sitting on it.',
      'When the pill turns green, pop the bottom edge of your phone up (slap it or flick your wrist) so the cup flips away from you onto the table.',
      'Soft flick = it won\'t turn over. Too hard = it over-rotates. Find the green zone on the meter.',
      'Flip all 6 cups as fast as you can.'],
    bottle: ['Hold your phone flat, screen up, like a pan with a pancake on it.',
      'When it turns green, pop the bottom edge up like flipping a pancake. The bottle flips away from you toward the table.',
      'The bottle has to do a full flip and land on its base. The water slows its spin, so commit to it.',
      'Land on the cap for a legendary flip.'],
  };

  // ---------- sensors ----------
  async function requestMotion() {
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const r = await DeviceMotionEvent.requestPermission();
        if (r !== 'granted') { S.fallback = true; return false; }
      }
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try { await DeviceOrientationEvent.requestPermission(); } catch (e) { /* optional */ }
      }
    } catch (e) { S.fallback = true; return false; }
    window.addEventListener('devicemotion', onMotion);
    setTimeout(() => { if (!S.gotMotion) { S.fallback = true; toast('No motion sensor<small>Swipe up to flick instead</small>', 'bad', 2200); } }, 1800);
    return true;
  }
  function onMotion(e) {
    const g = e.accelerationIncludingGravity, r = e.rotationRate;
    if (!g || g.z == null) return;
    if (!S.gotMotion && r && (r.alpha != null || r.beta != null)) { S.gotMotion = true; S.sensor = true; }
    const now = performance.now();
    const gz = Math.abs(g.z), gxy = Math.hypot(g.x || 0, g.y || 0);
    S.tiltX = (g.x || 0) / 4; S.tiltY = -(g.y || 0) / 4;
    const flat = gz > 8.2 && gxy < 3.4;
    if (flat && !S.flat) S.flatSince = now;
    S.flat = flat;
    if (S.phase === 'idle' && !S.armed && S.flat && now - S.flatSince > 350) { S.armed = true; Sfx.arm(); }
    if (!r) return;
    const rate = Math.hypot(r.beta || 0, (r.gamma || 0) * 0.6);   // deg/s: pitch (bottom-edge slap) counts most
    const lin = e.acceleration ? Math.abs(e.acceleration.z || 0) : 0;
    if (S.capture) {
      S.capture.peak = Math.max(S.capture.peak, rate);
      S.capture.lin = Math.max(S.capture.lin, lin);
      if (now - S.capture.t0 > 170) finishCapture();
      return;
    }
    if (S.phase === 'idle' && S.armed && rate > 230) {
      S.capture = { t0: now, peak: rate, lin };
    }
  }
  function finishCapture() {
    const c = S.capture; S.capture = null;
    // ~150 deg/s is a twitch; ~1250 deg/s is a hard snap. Linear accel adds a little.
    const p = clamp((c.peak - 150) / 1100 + Math.min(c.lin, 25) / 250, 0, P_MAX);
    doFlick(p);
  }
  // Swipe fallback (no gyro / ?desk)
  let sw = null;
  cvs.addEventListener('pointerdown', (e) => { sw = { y: e.clientY, t: performance.now() }; });
  cvs.addEventListener('pointerup', (e) => {
    if (!sw || !S.fallback || S.phase !== 'idle') { sw = null; return; }
    const dy = sw.y - e.clientY, dt = Math.max(16, performance.now() - sw.t); sw = null;
    if (dy < 30) return;
    const v = dy / dt; // px per ms
    doFlick(clamp((v - 0.25) / 2.6, 0, P_MAX));
  });

  // ---------- game flow ----------
  function doFlick(p) {
    if (S.phase !== 'idle' || !S.mode) return;
    S.lastP = p; S.armed = false;
    S.body = launch(S.mode, p); S.phase = 'flying';
    if (S.mode === 'cup' && !S.running && S.cupsDone === 0) { S.running = true; S.tStart = performance.now(); S.tEnd = 0; }
    Sfx.whoosh(p);
    if (navigator.vibrate) navigator.vibrate(12);
    setMeter(p);
  }
  function startMode(mode) {
    S.mode = mode; S.body = restBody(mode); S.phase = 'idle'; S.armed = false;
    S.cupsDone = 0; S.running = false; S.tEnd = 0; S.streak = 0; S.total = 0; S.particles = [];
    $('meter').classList.add('hidden');
    hud(true); updateHud();
  }
  function onLand(out) {
    const b = S.body;
    S.outcome = out; S.phase = out.kind === 'miss' ? 'result' : 'settle';
    S.settle = { from: b.th, to: out.target ?? b.th, t: 0, x0: b.x, vx: b.vx * 0.25 };
    S.resultT = 0;
    const good = out.kind === 'win' || out.kind === 'double' || out.kind === 'cap';
    if (out.kind !== 'miss') { good ? Sfx.clack() : Sfx.thud(); S.shake = good ? 0.12 : 0.2; }
    const z = ZONES[S.mode], p = S.lastP;
    const hint = p < z.lo ? 'Flick harder' : p > z.hi ? 'Ease up a little' : 'So close';
    if (S.mode === 'cup') {
      if (good) {
        S.cupsDone++; burst(b.x, 0.02, 18); Sfx.win();
        toast(S.cupsDone >= CUPS_PER_ROUND ? 'DONE!' : 'FLIPPED!', 'good', 900);
        if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
      } else if (out.kind === 'soft') toast(`Too soft<small>${hint}</small>`, 'bad');
      else toast(`Over-flipped<small>${hint}</small>`, 'bad');
    } else {
      if (good) {
        S.streak++; S.total++;
        if (S.streak > best.streak) best.streak = S.streak;
        burst(b.x, 0.02, out.kind === 'win' ? 20 : 45);
        if (out.kind === 'cap') { toast('CAP FLIP!!<small>Legendary</small>', 'good', 1600); Sfx.bigwin(); S.total += 2; }
        else if (out.kind === 'double') { toast('DOUBLE FLIP!', 'good', 1300); Sfx.bigwin(); }
        else { toast(S.streak > 2 ? `STUCK IT! x${S.streak}` : 'STUCK IT!', 'good', 1000); Sfx.win(); }
        if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
      } else {
        S.streak = 0;
        if (out.kind === 'miss') { toast('Missed the table', 'bad'); Sfx.fail(); }
        else if (out.kind === 'soft') toast(`Not enough flip<small>${hint}</small>`, 'bad');
        else toast(`Bonk<small>${hint}</small>`, 'bad');
      }
    }
    updateHud();
  }
  function afterResult() {
    const o = S.outcome; const good = o && (o.kind === 'win' || o.kind === 'double' || o.kind === 'cap');
    if (S.mode === 'cup' && good && S.cupsDone >= CUPS_PER_ROUND) {
      S.running = false; S.tEnd = performance.now();
      const t = (S.tEnd - S.tStart) / 1000, prev = best.cup, isBest = !prev || t < prev;
      if (isBest) best.cup = t;
      $('finTitle').textContent = isBest ? 'New best! 🏆' : 'All 6 flipped!';
      $('finText').textContent = `${t.toFixed(1)} seconds` + (prev && !isBest ? ` · best ${prev.toFixed(1)}` : '');
      Sfx.bigwin(); updateHud(); show('finish');
      S.phase = 'done'; return;
    }
    S.body = restBody(S.mode); S.phase = 'idle'; S.outcome = null; S.armed = false;
    if (S.flat) S.flatSince = performance.now();
    S.slideIn = 1;
  }

  // ---------- particles ----------
  function burst(x, y, n) {
    const cols = ['#ffcf5a', '#e3262f', '#ffffff', '#5ad1ff', '#7dff9c'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI, sp = 0.6 + Math.random() * 1.6;
      S.particles.push({ x, y, z: 0, vx: (Math.random() - 0.5) * 0.8, vz: Math.cos(a) * sp * 0.5, vy: Math.sin(a) * sp + 0.6, life: 1, c: cols[i % cols.length], r: Math.random() * TAU });
    }
  }

  // ---------- render (3/4 view from behind the player: forward = up the screen) ----------
  let W = 0, H = 0, DPR = 1, SC = 1, CX = 0, BY = 0, V0 = 0, D0 = 0;
  const PHI = 52 * Math.PI / 180, SP = Math.sin(PHI), CP = Math.cos(PHI), FOC = 1.6;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = innerWidth; H = innerHeight;
    cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  addEventListener('resize', resize); resize();
  function camera() {
    // v = screen-up distance of a world point, d = depth from the camera
    const span = S.mode === 'bottle' ? 0.74 : 0.56;
    V0 = S.mode === 'bottle' ? 0.02 : -0.06;
    D0 = 0;
    SC = Math.min((H * 0.78) / span, W / 0.46);
    CX = W / 2; BY = H * 0.88;
  }
  // project world (x fwd, y up, z right) -> [screenX, screenY, scale]
  function P(x, y, z = 0) {
    const v = x * SP + y * CP, d = x * CP - y * SP;
    const k = FOC / (FOC + d - D0);
    return [CX + z * SC * k, BY - (v - V0) * SC * k, SC * k];
  }

  function drawBackdrop() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2b1c14'); g.addColorStop(0.55, '#3d281c'); g.addColorStop(1, '#1d120c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save();
    const ly = H * 0.11;
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let x = -20; x <= W + 20; x += 8) ctx.lineTo(x, ly + Math.sin(x / W * Math.PI * 3) * 12);
    ctx.stroke();
    const t = performance.now() / 1000;
    for (let i = 0; i < 9; i++) {
      const x = (i + 0.5) * W / 9, y = ly + Math.sin(x / W * Math.PI * 3) * 12 + 7;
      const tw = 0.75 + 0.25 * Math.sin(t * 2 + i * 1.7);
      const c = ['#ffcf5a', '#ff7a59', '#7dd3ff'][i % 3];
      const rg = ctx.createRadialGradient(x, y, 0, x, y, 24);
      rg.addColorStop(0, c); rg.addColorStop(0.25, c + '88'); rg.addColorStop(1, 'transparent');
      ctx.globalAlpha = tw; ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, 24, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  function poly(pts) { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); }
  function drawTable(x0, x1) {
    const zw = 0.42;
    const a = P(x0, 0, -zw), b = P(x0, 0, zw), c = P(x1, 0, zw), d = P(x1, 0, -zw);
    // front face (near edge, facing the player)
    const fa = P(x0, -0.5, -zw), fb = P(x0, -0.5, zw);
    const gf = ctx.createLinearGradient(0, a[1], 0, fa[1]);
    gf.addColorStop(0, '#6b3e1f'); gf.addColorStop(1, '#24120a');
    ctx.fillStyle = gf; poly([a, b, fb, fa]); ctx.fill();
    // top surface
    const gt = ctx.createLinearGradient(0, d[1], 0, a[1]);
    gt.addColorStop(0, '#7a4a26'); gt.addColorStop(1, '#c48a52');
    ctx.fillStyle = gt; poly([a, b, c, d]); ctx.fill();
    // wood planks
    ctx.strokeStyle = 'rgba(60,30,10,.28)'; ctx.lineWidth = 1;
    for (let i = 1; i < 7; i++) {
      const z = -zw + i * (2 * zw / 7), p1 = P(x0, 0, z), p2 = P(x1, 0, z);
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
    }
    // edge highlight
    ctx.strokeStyle = 'rgba(255,225,180,.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  function shadowAt(x, y) {
    const h = Math.max(0, y);
    if (S.mode === 'bottle' && x < TABLE_LEFT_BOTTLE) return;
    const p = P(x, 0, 0), r = (0.045 + h * 0.06) * p[2];
    ctx.fillStyle = `rgba(0,0,0,${clamp(0.38 - h * 0.6, 0.06, 0.38)})`;
    ctx.beginPath(); ctx.ellipse(p[0], p[1], r, r * SP * 0.9, 0, 0, TAU); ctx.fill();
  }
  // A solid of revolution along the body's axis, drawn as stacked frustum segments.
  // segs: [{a, b, ra, rb, side, end}] with a<b along local axis (m), radii in m.
  function drawSolid(b, segs, glow) {
    const c = Math.cos(b.th), s = Math.sin(b.th);
    const ax = -s, ay = c;                 // axis direction (world x,y)
    const facing = Math.sin(b.th + PHI);   // >0: the +axis end faces the camera
    const tilt = Math.abs(facing);
    const pt = (t) => P(b.x + ax * t, b.y + ay * t, 0);
    const order = facing > 0 ? segs : segs.slice().reverse();
    if (glow) { ctx.save(); ctx.shadowColor = 'rgba(125,255,156,.95)'; ctx.shadowBlur = 20 * DPR; }
    for (const g of order) {
      const pa = pt(g.a), pb = pt(g.b);
      const ra = g.ra * pa[2], rb = g.rb * pb[2];
      const ea = ra * tilt, eb = rb * tilt;
      const grad = ctx.createLinearGradient(pa[0] - ra, 0, pa[0] + ra, 0);
      grad.addColorStop(0, g.dark); grad.addColorStop(0.42, g.side); grad.addColorStop(0.6, g.lite || g.side); grad.addColorStop(1, g.dark);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.ellipse(pa[0], pa[1], ra, Math.max(0.5, ea), 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(pb[0], pb[1], rb, Math.max(0.5, eb), 0, 0, TAU); ctx.fill();
      poly([[pa[0] - ra, pa[1]], [pa[0] + ra, pa[1]], [pb[0] + rb, pb[1]], [pb[0] - rb, pb[1]]]); ctx.fill();
    }
    if (glow) ctx.restore();
    // visible end cap
    const g = facing > 0 ? segs[segs.length - 1] : segs[0];
    const t = facing > 0 ? g.b : g.a, r = facing > 0 ? g.rb : g.ra;
    const p = pt(t), rr = r * p[2];
    return { p, rr, er: rr * tilt, top: facing > 0 };
  }
  function drawCup(b, glow) {
    const h = CUP.H / 2, rb = CUP.bw / 2, rw = CUP.rw / 2, k = b.k || 1;
    const R = (t) => rb + (rw - rb) * ((t + h) / (2 * h));
    const red = { side: '#ef3a41', lite: '#ff6a70', dark: '#8e0f16' };
    const white = { side: '#f7f3ee', lite: '#ffffff', dark: '#c9c2b8' };
    const segs = [
      { a: -h * k, b: h * 0.62 * k, ra: rb * k, rb: R(h * 0.62) * k, ...red },
      { a: h * 0.62 * k, b: h * k, ra: R(h * 0.62) * k, rb: rw * k, ...white },
    ];
    const cap = drawSolid(b, segs, glow);
    if (cap.top) {      // looking into the cup
      ctx.fillStyle = '#f7f3ee'; ctx.beginPath(); ctx.ellipse(cap.p[0], cap.p[1], cap.rr, cap.er, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#b8141c'; ctx.beginPath(); ctx.ellipse(cap.p[0], cap.p[1], cap.rr * 0.9, cap.er * 0.9, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(cap.p[0], cap.p[1] - cap.er * 0.25, cap.rr * 0.7, cap.er * 0.55, 0, 0, TAU); ctx.fill();
    } else {            // looking at the bottom
      ctx.fillStyle = '#a8121a'; ctx.beginPath(); ctx.ellipse(cap.p[0], cap.p[1], cap.rr, cap.er, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(cap.p[0], cap.p[1], cap.rr * 0.7, cap.er * 0.7, 0, 0, TAU); ctx.stroke();
    }
  }
  function drawBottle(b, glow) {
    const h = BOT.H / 2, w = BOT.W / 2;
    const clear = { side: 'rgba(205,235,255,.55)', lite: 'rgba(255,255,255,.75)', dark: 'rgba(120,170,210,.6)' };
    const water = { side: '#3d9df0', lite: '#7cc4ff', dark: '#1a5fb0' };
    const label = { side: '#1f6fd1', lite: '#3d8be6', dark: '#123f82' };
    const capc = { side: '#1b56b8', lite: '#3a78db', dark: '#0f306b' };
    const segs = [
      { a: -h, b: -h * 0.3, ra: w, rb: w, ...water },
      { a: -h * 0.3, b: h * 0.15, ra: w, rb: w, ...label },
      { a: h * 0.15, b: h * 0.45, ra: w, rb: w, ...clear },
      { a: h * 0.45, b: h * 0.84, ra: w, rb: w * 0.42, ...clear },
      { a: h * 0.84, b: h * 0.9, ra: w * 0.42, rb: w * 0.42, ...clear },
      { a: h * 0.9, b: h, ra: w * 0.5, rb: w * 0.5, ...capc },
    ];
    const cap = drawSolid(b, segs, glow);
    ctx.fillStyle = cap.top ? '#2a6ad0' : '#2f86e0';
    ctx.beginPath(); ctx.ellipse(cap.p[0], cap.p[1], cap.rr, cap.er, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 1.2; ctx.stroke();
  }
  function drawHand() {
    const y = PALM_Y - 0.012;
    // forearm coming from the bottom of the screen
    const a1 = P(-0.6, y - 0.04, -0.045), a2 = P(-0.6, y - 0.04, 0.045), a3 = P(-0.07, y, 0.04), a4 = P(-0.07, y, -0.04);
    ctx.fillStyle = '#b97b52'; poly([a1, a2, a3, a4]); ctx.fill();
    // palm
    const c = P(0, y, 0);
    const g = ctx.createRadialGradient(c[0], c[1], 2, c[0], c[1], 0.09 * c[2]);
    g.addColorStop(0, '#f0b98c'); g.addColorStop(1, '#c98a5e');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(c[0], c[1], 0.055 * c[2], 0.075 * c[2] * SP, 0, 0, TAU); ctx.fill();
    // fingers pointing forward
    ctx.strokeStyle = '#d99c70'; ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const z = -0.033 + i * 0.022, f0 = P(0.04, y, z), f1 = P(0.1 - Math.abs(i - 1.5) * 0.012, y, z * 1.1);
      ctx.lineWidth = 0.018 * f0[2]; ctx.beginPath(); ctx.moveTo(f0[0], f0[1]); ctx.lineTo(f1[0], f1[1]); ctx.stroke();
    }
    // thumb
    const t0 = P(-0.01, y, -0.05), t1 = P(0.04, y + 0.004, -0.075);
    ctx.lineWidth = 0.02 * t0[2]; ctx.beginPath(); ctx.moveTo(t0[0], t0[1]); ctx.lineTo(t1[0], t1[1]); ctx.stroke();
  }
  function drawDoneCups() {
    // finished cups line up across the far end of the table (rim-down); empty slots are faint rings
    const k = 0.8, X = 0.46;
    for (let i = 0; i < CUPS_PER_ROUND; i++) {
      const z = -0.175 + i * 0.07;
      const p = P(X, 0, z);
      if (i >= S.cupsDone) {
        ctx.strokeStyle = 'rgba(255,235,200,.35)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(p[0], p[1], CUP.rw / 2 * k * p[2], CUP.rw / 2 * k * p[2] * SP * 0.9, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        continue;
      }
      const saveCX = CX; CX = saveCX + (p[0] - P(X, 0, 0)[0]);
      drawCup({ x: X, y: CUP.H / 2 * k, th: Math.PI, k }, false);
      CX = saveCX;
    }
  }
  function drawParticles(dt) {
    for (const p of S.particles) {
      p.vy -= 3.2 * dt; p.x += p.vx * 0.6 * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.life -= dt * 0.8; p.r += dt * 8;
      const s = P(p.x, p.y, p.z);
      ctx.save(); ctx.globalAlpha = clamp(p.life, 0, 1); ctx.translate(s[0], s[1]); ctx.rotate(p.r);
      ctx.fillStyle = p.c; ctx.fillRect(-4, -2, 8, 4); ctx.restore();
    }
    S.particles = S.particles.filter((p) => p.life > 0 && p.y > -0.5);
  }

  // ---------- loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (S.mode && S.phase === 'flying') {
      const n = Math.ceil(dt * 240);
      for (let i = 0; i < n; i++) {
        const out = step(S.mode, S.body, dt / n);
        if (out) { onLand(out); break; }
      }
      S.slosh += (S.body.w * 0.04 - S.slosh) * Math.min(1, dt * 8);
    } else S.slosh *= Math.exp(-dt * 4);
    if (S.phase === 'settle') {
      const st = S.settle, b = S.body; st.t = Math.min(1, st.t + dt / 0.32);
      const e = 1 - Math.pow(1 - st.t, 3);
      b.th = st.from + (st.to - st.from) * e;
      b.x += st.vx * dt * (1 - e);
      const lo = lowest(b, shapePts(S.mode)); b.y -= lo.y;
      if (st.t >= 1) { S.phase = 'result'; S.resultT = 0; }
    }
    if (S.phase === 'result') {
      if (S.outcome && S.outcome.kind === 'miss') { const b = S.body; b.vy -= G * dt; b.y += b.vy * dt; b.x += b.vx * dt; b.th += b.w * dt; }
      S.resultT += dt; if (S.resultT > 1.05) afterResult();
    }
    render(dt);
    if (S.mode && (S.running || S.phase !== 'done')) updateHud();
    if (S.mode) setStatus();
    requestAnimationFrame(frame);
  }
  function render(dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBackdrop();
    if (!S.mode) { S.mode = null; return; }
    camera();
    let shx = 0, shy = 0;
    if (S.shake > 0) { S.shake -= dt; shx = (Math.random() - 0.5) * 6 * S.shake * 8; shy = (Math.random() - 0.5) * 6 * S.shake * 8; }
    ctx.save(); ctx.translate(shx, shy);
    const ready = S.phase === 'idle' && (S.armed || (S.fallback && !S.sensor));
    if (S.mode === 'cup') {
      drawTable(0.02, 1.6);
      drawDoneCups();
      shadowAt(S.body.x, S.body.y);
      drawCup(S.body, ready);
    } else {
      drawTable(TABLE_LEFT_BOTTLE, 1.6);
      const m = P(0.43, 0, 0);
      ctx.strokeStyle = 'rgba(255,207,90,.45)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(m[0], m[1], 0.07 * m[2], 0.07 * m[2] * SP * 0.9, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      drawHand();
      shadowAt(S.body.x, S.body.y);
      drawBottle(S.body, ready);
    }
    drawParticles(dt);
    ctx.restore();
  }

  // ---------- wiring ----------
  document.querySelectorAll('.mode').forEach((btn) => btn.addEventListener('click', async () => {
    Sfx.unlock();
    const mode = btn.dataset.mode;
    if (!S.sensor && !DESK) await requestMotion();
    show('title', false);
    $('howTitle').textContent = mode === 'cup' ? 'Flip Cup' : 'Bottle Flip';
    $('howList').innerHTML = HOW[mode].map((s) => `<li>${s}</li>`).join('');
    show('howto');
    $('goBtn').onclick = () => { show('howto', false); startMode(mode); };
  }));
  $('backBtn').onclick = () => { S.mode = null; hud(false); $('meter').classList.add('hidden'); show('finish', false); show('title'); };
  $('againBtn').onclick = () => { show('finish', false); startMode(S.mode); };
  $('menuBtn2').onclick = () => { show('finish', false); $('backBtn').onclick(); };
  const muteIcons = () => { $('icoSound').classList.toggle('hidden', Sfx.muted); $('icoMute').classList.toggle('hidden', !Sfx.muted); };
  $('muteBtn').onclick = () => { Sfx.toggle(); muteIcons(); }; muteIcons();

  if (!isPhone) show('gate'); else show('title');
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission !== 'function') $('permNote').classList.add('hidden');
  requestAnimationFrame(frame);

  // test hook
  window.__flipcup = { S, ZONES, simulate, flick: doFlick, startMode, launch };
})();
