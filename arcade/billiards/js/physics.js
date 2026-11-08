/* Rack & Roll — table geometry and ball physics.
   Pure logic (no DOM) so the CPU player can run the exact same simulation
   on cloned tables. Works in the browser (window.RR) and in Node (module.exports). */
(function (root) {
  'use strict';
  const RR = (root.RR = root.RR || {});

  // World units. The playing surface (cushion nose to cushion nose) is W x L,
  // drawn portrait: x across, y down the table. The break is taken from the bottom.
  const W = 100, L = 200, R = 2.6, D = R * 2;
  const STEP = 1 / 120;          // fixed physics step (seconds)
  const MAXV = 410;              // cue ball speed at full power (units/s)
  const MU_SLIDE = 165;          // sliding friction deceleration
  const ROLL = 15;               // rolling resistance (constant part)
  const DRAG = 0.34;             // rolling resistance (speed-proportional part)
  const E_BALL = 0.95;           // ball-ball restitution
  const E_CUSH = 0.76;           // cushion restitution
  const SIDE_THROW = 0.22;       // how much side spin bends a cushion rebound
  const SIDE_DECAY = 1.1;        // side spin bleed-off per second
  const STOP_V = 0.9;            // below this a rolling ball is put to sleep
  const HEAD_Y = L * 0.75;       // head string (break kitchen is y >= HEAD_Y)
  const FOOT = { x: W / 2, y: L * 0.25 };
  const HEAD = { x: W / 2, y: L * 0.75 };

  // Pocket mouths
  const CA = 8.0;                // corner: cushion noses stop CA from the corner on each rail
  const SS = 6.2;                // side: half width of the side pocket mouth

  /* ---------------- geometry ---------------- */
  const segs = [];     // cushion noses and pocket jaws, each a line segment (capsule radius 0)
  const pockets = [];  // pocket descriptors
  const cushionPolys = []; // for drawing: rubber cushion quads

  function addSeg(ax, ay, bx, by, kind) {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    segs.push({ ax, ay, bx, by, dx, dy, len2, kind,
      minX: Math.min(ax, bx) - R - 0.5, maxX: Math.max(ax, bx) + R + 0.5,
      minY: Math.min(ay, by) - R - 0.5, maxY: Math.max(ay, by) + R + 0.5 });
  }
  // corner jaw directions for the (0,0) corner (pointing back into the pocket throat)
  const JC_TOP = { x: -0.8, y: -0.6 };  // from (CA,0)
  const JC_LEFT = { x: -0.6, y: -0.8 }; // from (0,CA)
  const JC_LEN = 5.2;
  const JS = { x: -0.95, y: 0.31 };     // side jaw from (0, L/2 - SS), mirrored for the other
  const JS_LEN = 4.8;
  const CUSH = 3.6;                     // cushion rubber depth (visual)

  function mirror(p, mx, my) { return { x: mx ? W - p.x : p.x, y: my ? L - p.y : p.y }; }

  (function build() {
    // corners
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
    for (const [mx, my] of corners) {
      const sx = mx ? -1 : 1, sy = my ? -1 : 1;
      const a1 = mirror({ x: CA, y: 0 }, mx, my), b1 = { x: a1.x + JC_TOP.x * JC_LEN * sx, y: a1.y + JC_TOP.y * JC_LEN * sy };
      const a2 = mirror({ x: 0, y: CA }, mx, my), b2 = { x: a2.x + JC_LEFT.x * JC_LEN * sx, y: a2.y + JC_LEFT.y * JC_LEN * sy };
      addSeg(a1.x, a1.y, b1.x, b1.y, 'jaw');
      addSeg(a2.x, a2.y, b2.x, b2.y, 'jaw');
      const c = mirror({ x: -2.3, y: -2.3 }, mx, my);
      const inv = Math.SQRT1_2;
      pockets.push({
        id: pockets.length, corner: true,
        cx: c.x, cy: c.y, r: 5.8,
        // mouth line through a1,a2; inward normal points to the table
        mx: (a1.x + a2.x) / 2, my: (a1.y + a2.y) / 2,
        nx: inv * sx, ny: inv * sy,
        depth: R * 0.7,
        ax: (a1.x + a2.x) / 2 - inv * sx * 1.6, ay: (a1.y + a2.y) / 2 - inv * sy * 1.6,
        jaws: [a1, b1, a2, b2],
      });
    }
    // sides (left x=0, right x=W)
    for (const mx of [0, 1]) {
      const sx = mx ? -1 : 1;
      const a1 = { x: mx ? W : 0, y: L / 2 - SS }, b1 = { x: a1.x + JS.x * JS_LEN * sx, y: a1.y + JS.y * JS_LEN };
      const a2 = { x: mx ? W : 0, y: L / 2 + SS }, b2 = { x: a2.x + JS.x * JS_LEN * sx, y: a2.y - JS.y * JS_LEN };
      addSeg(a1.x, a1.y, b1.x, b1.y, 'jaw');
      addSeg(a2.x, a2.y, b2.x, b2.y, 'jaw');
      pockets.push({
        id: pockets.length, corner: false,
        cx: mx ? W + 3.9 : -3.9, cy: L / 2, r: 5.5,
        mx: a1.x, my: L / 2, nx: sx, ny: 0,
        depth: R * 0.85,
        ax: a1.x - sx * 1.4, ay: L / 2,
        jaws: [a1, b1, a2, b2],
      });
    }
    // cushion noses
    addSeg(CA, 0, W - CA, 0, 'rail');
    addSeg(CA, L, W - CA, L, 'rail');
    addSeg(0, CA, 0, L / 2 - SS, 'rail');
    addSeg(0, L / 2 + SS, 0, L - CA, 'rail');
    addSeg(W, CA, W, L / 2 - SS, 'rail');
    addSeg(W, L / 2 + SS, W, L - CA, 'rail');

    // drawing polygons for the cushion rubber (nose edge -> back edge following the jaw angles)
    const tC = CUSH / Math.abs(JC_TOP.y); // jaw parameter that reaches the back edge
    const ex = JC_TOP.x * tC;             // x shift at the back edge (negative = toward the corner)
    cushionPolys.push([{ x: CA, y: 0 }, { x: W - CA, y: 0 }, { x: W - CA - ex, y: -CUSH }, { x: CA + ex, y: -CUSH }]);
    cushionPolys.push([{ x: CA, y: L }, { x: W - CA, y: L }, { x: W - CA - ex, y: L + CUSH }, { x: CA + ex, y: L + CUSH }]);
    const sShift = JS.y * (CUSH / Math.abs(JS.x));
    for (const mx of [0, 1]) {
      const X = mx ? W : 0, bx = mx ? W + CUSH : -CUSH;
      cushionPolys.push([{ x: X, y: CA }, { x: X, y: L / 2 - SS }, { x: bx, y: L / 2 - SS + sShift }, { x: bx, y: CA + ex }]);
      cushionPolys.push([{ x: X, y: L / 2 + SS }, { x: X, y: L - CA }, { x: bx, y: L - CA - ex }, { x: bx, y: L / 2 + SS - sShift }]);
    }
  })();

  /* ---------------- sim ---------------- */
  function makeBall(id, x, y) {
    return { id, x, y, vx: 0, vy: 0, wx: 0, wy: 0, sz: 0, on: true, pocket: -1, moving: false };
  }
  function newShot() { return { firstHit: null, railAfter: false, potted: [], railMask: 0, cueRails: 0, contacts: 0 }; }

  function createSim() {
    const balls = [];
    for (let i = 0; i < 16; i++) balls.push(makeBall(i, -50, -50));
    return { balls, moving: false, shot: newShot(), t: 0 };
  }

  function cloneSim(s) {
    const balls = new Array(16);
    for (let i = 0; i < 16; i++) {
      const b = s.balls[i];
      balls[i] = { id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, wx: b.wx, wy: b.wy, sz: b.sz, on: b.on, pocket: b.pocket, moving: b.moving };
    }
    const sh = s.shot;
    return { balls, moving: s.moving, t: s.t, shot: { firstHit: sh.firstHit, railAfter: sh.railAfter, potted: sh.potted.slice(), railMask: sh.railMask, cueRails: sh.cueRails, contacts: sh.contacts } };
  }

  // Standard triangle rack: apex on the foot spot, 8 in the middle of the third row,
  // one solid and one stripe on the back corners, everything else shuffled.
  function rack(sim, rnd) {
    rnd = rnd || Math.random;
    const others = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
    for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = others[i]; others[i] = others[j]; others[j] = t; }
    const slots = []; // [row, col]
    for (let r = 0; r < 5; r++) for (let c = 0; c <= r; c++) slots.push([r, c]);
    const order = new Array(15);
    let k = 0;
    for (let i = 0; i < 15; i++) {
      const [r, c] = slots[i];
      if (r === 2 && c === 1) order[i] = 8; else order[i] = others[k++];
    }
    // back corners: slots 10 and 14 must be one of each group
    const g = (id) => (id < 8 ? 0 : 1);
    if (g(order[10]) === g(order[14])) {
      for (let i = 0; i < 15; i++) {
        if (i === 10 || i === 14 || order[i] === 8) continue;
        if (g(order[i]) !== g(order[14])) { const t = order[i]; order[i] = order[10]; order[10] = t; break; }
      }
    }
    const gap = 0.03, rowH = Math.sqrt(3) * (R + gap / 2);
    for (const b of sim.balls) { b.on = false; b.vx = b.vy = b.wx = b.wy = b.sz = 0; b.moving = false; b.pocket = -1; }
    for (let i = 0; i < 15; i++) {
      const [r, c] = slots[i];
      const b = sim.balls[order[i]];
      b.x = FOOT.x + (c - r / 2) * (D + gap) + (rnd() - 0.5) * 0.02;
      b.y = FOOT.y - r * rowH + (rnd() - 0.5) * 0.02;
      b.on = true;
    }
    const cue = sim.balls[0];
    cue.x = HEAD.x; cue.y = HEAD.y + 8; cue.on = true;
    sim.moving = false; sim.shot = newShot();
  }

  function shoot(sim, angle, power, spinX, spinY) {
    const cue = sim.balls[0];
    if (!cue.on) return false;
    const V = Math.max(0.02, Math.min(1, power)) * MAXV;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    cue.vx = V * dx; cue.vy = V * dy;
    // tip height sets the initial roll: +1 = max follow, -1 = max draw, 0 = stun/slide
    const sy = Math.max(-1, Math.min(1, spinY || 0)), sx = Math.max(-1, Math.min(1, spinX || 0));
    cue.wx = V * dx * sy * 1.15; cue.wy = V * dy * sy * 1.15;
    cue.sz = sx * V * 0.55;
    cue.moving = true;
    sim.moving = true;
    sim.shot = newShot();
    sim.t = 0;
    return true;
  }

  function step(sim, dt, ev) {
    const balls = sim.balls;
    let maxV = 0;
    for (let i = 0; i < 16; i++) {
      const b = balls[i];
      if (!b.on || !b.moving) continue;
      const v = Math.abs(b.vx) + Math.abs(b.vy);
      if (v > maxV) maxV = v;
    }
    const n = Math.min(16, Math.max(1, Math.ceil(maxV * dt / (R * 0.35))));
    const h = dt / n;
    for (let k = 0; k < n; k++) substep(sim, h, ev);
    sim.t += dt;
    let any = false;
    for (let i = 0; i < 16; i++) if (balls[i].on && balls[i].moving) { any = true; break; }
    sim.moving = any;
  }

  function substep(sim, h, ev) {
    const balls = sim.balls, shot = sim.shot;
    // 1. friction + integrate
    for (let i = 0; i < 16; i++) {
      const b = balls[i];
      if (!b.on || !b.moving) continue;
      let ux = b.vx - b.wx, uy = b.vy - b.wy;
      const us = Math.hypot(ux, uy);
      if (us > 0.6) {
        // sliding: friction opposes the slip at the contact point; it slows the ball
        // and builds natural roll (5/2 factor for a solid sphere)
        const dv = MU_SLIDE * h;
        if (dv * 3.5 >= us) {
          b.vx -= ux / 3.5; b.vy -= uy / 3.5;
          b.wx = b.vx; b.wy = b.vy;
        } else {
          ux /= us; uy /= us;
          b.vx -= ux * dv; b.vy -= uy * dv;
          b.wx += ux * dv * 2.5; b.wy += uy * dv * 2.5;
        }
      } else {
        const sp = Math.hypot(b.vx, b.vy);
        const dec = (ROLL + DRAG * sp) * h;
        if (sp <= dec || sp < STOP_V) { b.vx = b.vy = b.wx = b.wy = 0; }
        else { const f = (sp - dec) / sp; b.vx *= f; b.vy *= f; b.wx = b.vx; b.wy = b.vy; }
      }
      if (b.sz !== 0) { b.sz *= 1 - SIDE_DECAY * h; if (Math.abs(b.sz) < 0.5) b.sz = 0; }
      b.x += b.vx * h; b.y += b.vy * h;
      if (b.vx === 0 && b.vy === 0 && b.wx === 0 && b.wy === 0) { b.moving = false; b.sz = 0; }
    }

    // 2. ball-ball
    for (let i = 0; i < 16; i++) {
      const a = balls[i];
      if (!a.on) continue;
      for (let j = i + 1; j < 16; j++) {
        const b = balls[j];
        if (!b.on || (!a.moving && !b.moving)) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        if (dx > D || dx < -D || dy > D || dy < -D) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= D * D || d2 === 0) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
        // separate
        const over = (D - d) / 2 + 1e-4;
        a.x -= nx * over; a.y -= ny * over; b.x += nx * over; b.y += ny * over;
        const rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny; // closing speed
        if (rv <= 0) continue;
        const jn = rv * (1 + E_BALL) / 2;
        a.vx -= jn * nx; a.vy -= jn * ny;
        b.vx += jn * nx; b.vy += jn * ny;
        a.moving = b.moving = true;
        if (i === 0 && shot.firstHit === null) shot.firstHit = j;
        shot.contacts++;
        if (ev) ev.push({ t: 'ball', v: rv, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, a: i, b: j });
      }
    }

    // 3. cushions, jaws, pockets
    for (let i = 0; i < 16; i++) {
      const b = balls[i];
      if (!b.on || !b.moving) continue;
      if (b.x > R + 0.8 && b.x < W - R - 0.8 && b.y > R + 0.8 && b.y < L - R - 0.8) continue;
      for (let s = 0; s < segs.length; s++) {
        const g = segs[s];
        if (b.x < g.minX || b.x > g.maxX || b.y < g.minY || b.y > g.maxY) continue;
        let t = ((b.x - g.ax) * g.dx + (b.y - g.ay) * g.dy) / g.len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = g.ax + g.dx * t, py = g.ay + g.dy * t;
        let nx = b.x - px, ny = b.y - py;
        const d2 = nx * nx + ny * ny;
        if (d2 >= R * R || d2 === 0) continue;
        const d = Math.sqrt(d2); nx /= d; ny /= d;
        b.x += nx * (R - d + 1e-4); b.y += ny * (R - d + 1e-4);
        const vn = b.vx * nx + b.vy * ny;
        if (vn >= 0) continue;
        b.vx -= (1 + E_CUSH) * vn * nx; b.vy -= (1 + E_CUSH) * vn * ny;
        // the cushion strikes above the ball's centre and kills most of the roll into it
        const wn = b.wx * nx + b.wy * ny;
        b.wx -= 1.45 * wn * nx; b.wy -= 1.45 * wn * ny;
        // side spin: friction at the contact point throws the ball along the rail
        if (b.sz !== 0) {
          b.vx -= SIDE_THROW * b.sz * ny; b.vy -= SIDE_THROW * b.sz * -nx;
          b.sz *= 0.55;
        }
        if (shot.firstHit !== null) shot.railAfter = true;
        if (i === 0) shot.cueRails++; else shot.railMask |= 1 << i;
        if (ev) ev.push({ t: 'cush', v: -vn, x: b.x, y: b.y, id: i, kind: g.kind });
      }
      for (let p = 0; p < pockets.length; p++) {
        const pk = pockets[p];
        const dx = b.x - pk.mx, dy = b.y - pk.my;
        if (dx * dx + dy * dy > 225) continue;
        if (dx * pk.nx + dy * pk.ny < -pk.depth) {
          b.on = false; b.pocket = p; b.moving = false;
          const sp = Math.hypot(b.vx, b.vy);
          if (ev) ev.push({ t: 'pocket', id: i, p, v: sp, x: b.x, y: b.y, vx: b.vx, vy: b.vy });
          b.vx = b.vy = b.wx = b.wy = b.sz = 0;
          shot.potted.push({ id: i, p });
          break;
        }
      }
    }
  }

  // Run a cloned sim until everything stops. Returns the sim.
  function runToRest(sim, maxT) {
    const lim = maxT || 25;
    let t = 0;
    while (sim.moving && t < lim) { step(sim, STEP, null); t += STEP; }
    if (sim.moving) { for (const b of sim.balls) { b.vx = b.vy = b.wx = b.wy = b.sz = 0; b.moving = false; } sim.moving = false; }
    return sim;
  }

  /* ---------------- queries ---------------- */
  // Is (x,y) a legal spot for the cue ball (inside the bed, not touching another ball)?
  function canPlace(sim, x, y, kitchen) {
    if (x < R || x > W - R || y < R || y > L - R) return false;
    if (kitchen && y < HEAD_Y) return false;
    for (let i = 1; i < 16; i++) {
      const b = sim.balls[i];
      if (!b.on) continue;
      if ((b.x - x) * (b.x - x) + (b.y - y) * (b.y - y) < (D + 0.05) * (D + 0.05)) return false;
    }
    return true;
  }

  // Cast a ball-sized ray from (x,y) along angle: first ball it would strike, or the cushion.
  function rayCast(sim, x, y, ang, ignore) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let best = Infinity, hit = -1;
    for (let i = 0; i < 16; i++) {
      if (i === ignore) continue;
      const b = sim.balls[i];
      if (!b.on) continue;
      const ox = b.x - x, oy = b.y - y;
      const tc = ox * dx + oy * dy;
      if (tc < 0) continue;
      const d2 = ox * ox + oy * oy - tc * tc;
      if (d2 > D * D) continue;
      const t = tc - Math.sqrt(D * D - d2);
      if (t < best && t > -0.01) { best = Math.max(0, t); hit = i; }
    }
    // cushion: the bed shrunk by R
    let tw = Infinity, nx = 0, ny = 0;
    if (dx > 1e-9) { const t = (W - R - x) / dx; if (t < tw) { tw = t; nx = -1; ny = 0; } }
    if (dx < -1e-9) { const t = (R - x) / dx; if (t < tw) { tw = t; nx = 1; ny = 0; } }
    if (dy > 1e-9) { const t = (L - R - y) / dy; if (t < tw) { tw = t; nx = 0; ny = -1; } }
    if (dy < -1e-9) { const t = (R - y) / dy; if (t < tw) { tw = t; nx = 0; ny = 1; } }
    if (hit >= 0 && best <= tw) {
      const gx = x + dx * best, gy = y + dy * best;
      return { type: 'ball', id: hit, t: best, gx, gy };
    }
    return { type: 'cush', t: Math.max(0, tw), gx: x + dx * tw, gy: y + dy * tw, nx, ny };
  }

  // Is the straight corridor from (x0,y0) to (x1,y1) clear of balls (excluding ids in skip)?
  function pathClear(sim, x0, y0, x1, y1, skipA, skipB, width) {
    const w = width || D;
    const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) return true;
    for (let i = 0; i < 16; i++) {
      if (i === skipA || i === skipB) continue;
      const b = sim.balls[i];
      if (!b.on) continue;
      let t = ((b.x - x0) * dx + (b.y - y0) * dy) / len2;
      if (t <= 0 || t >= 1) continue;
      const px = x0 + dx * t - b.x, py = y0 + dy * t - b.y;
      if (px * px + py * py < w * w * 0.98) return false;
    }
    return true;
  }

  RR.PHYS = { W, L, R, D, STEP, MAXV, HEAD_Y, FOOT, HEAD, CA, SS, CUSH, segs, pockets, cushionPolys };
  RR.createSim = createSim;
  RR.cloneSim = cloneSim;
  RR.rack = rack;
  RR.shoot = shoot;
  RR.step = step;
  RR.runToRest = runToRest;
  RR.canPlace = canPlace;
  RR.rayCast = rayCast;
  RR.pathClear = pathClear;
  if (typeof module !== 'undefined' && module.exports) module.exports = RR;
})(typeof window !== 'undefined' ? window : globalThis);
