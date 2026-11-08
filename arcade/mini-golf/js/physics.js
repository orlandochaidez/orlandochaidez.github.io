/* Pocket Putt — top-down ball physics. Fixed timestep, sub-stepped so the ball never moves
   more than a fraction of its radius per sub-step (no tunnelling through walls). */
(function (G) {
  'use strict';
  const MG = (G.MG = G.MG || {});
  const { pointInPoly } = MG.geom;

  const C = (MG.PHYS = {
    STEP: 1 / 120,
    MAX_SPEED: 960,       // world units / s at full power
    MIN_SHOT: 0.06,       // power below this cancels the shot
    FRICTION_C: 45,       // constant rolling resistance (u/s^2)
    FRICTION_K: 0.75,     // speed-proportional drag (1/s)
    SAND_MUL: 5.5,
    WALL_E: 0.72,         // wall restitution
    BUMPER_E: 1.0,
    BUMPER_KICK: 110,
    MOVER_E: 0.85,
    CAPTURE_SPEED: 300,   // faster than this over the cup = lip out / roll over
    STOP_SPEED: 5,
    SINK_TIME: 0.38,
    SPLASH_TIME: 0.75,
  });

  function sliderPos(s, t) {
    const k = Math.sin(s.speed * t + s.phase) * s.range;
    return { x: s.x + s.ax * k, y: s.y + s.ay * k, vx: s.ax * s.range * s.speed * Math.cos(s.speed * t + s.phase), vy: s.ay * s.range * s.speed * Math.cos(s.speed * t + s.phase) };
  }
  MG.sliderPos = sliderPos;
  MG.spinnerAngle = (s, t) => s.phase + s.speed * t;

  function createSim(hole) {
    const segs = [];
    for (const l of hole.loops) for (let i = 0; i < l.length; i++) {
      const a = l[i], b = l[(i + 1) % l.length];
      segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, half: MG.WALL_HALF });
    }
    for (const w of hole.walls) segs.push({ ax: w.a.x, ay: w.a.y, bx: w.b.x, by: w.b.y, half: MG.WALL_HALF });
    for (const p of hole.blocks) for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, half: 1 });
    }
    return {
      hole, segs, t: 0,
      ball: { x: hole.tee.x, y: hole.tee.y, vx: 0, vy: 0 },
      last: { x: hole.tee.x, y: hole.tee.y },
      state: 'rest',   // rest | moving | sinking | sunk | splash
      anim: 0, restTimer: 0, moveTime: 0, overCup: false, scale: 1,
      sinkFrom: null, splashAt: null,
    };
  }
  MG.createSim = createSim;

  MG.shoot = function (sim, dirx, diry, power) {
    if (sim.state !== 'rest') return false;
    const sp = C.MAX_SPEED * Math.pow(power, 1.15);
    sim.last = { x: sim.ball.x, y: sim.ball.y };
    sim.ball.vx = dirx * sp; sim.ball.vy = diry * sp;
    sim.state = 'moving'; sim.restTimer = 0; sim.moveTime = 0; sim.overCup = false;
    return true;
  };

  // Returns true if a collision happened. ev: events array.
  function collideSeg(b, ax, ay, bx, by, half, e, wvx, wvy, ev, kind) {
    const R = MG.BALL_R + half;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((b.x - ax) * dx + (b.y - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + dx * t, cy = ay + dy * t;
    let nx = b.x - cx, ny = b.y - cy;
    const d2 = nx * nx + ny * ny;
    if (d2 >= R * R) return false;
    let d = Math.sqrt(d2);
    if (d < 1e-6) { const l = Math.sqrt(l2) || 1; nx = -dy / l; ny = dx / l; d = 0; }
    else { nx /= d; ny /= d; }
    b.x += nx * (R - d); b.y += ny * (R - d);
    let rvx = b.vx - wvx, rvy = b.vy - wvy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const tx = rvx - vn * nx, ty = rvy - vn * ny;
      rvx = tx * 0.985 - e * vn * nx; rvy = ty * 0.985 - e * vn * ny;
      b.vx = rvx + wvx; b.vy = rvy + wvy;
      ev.push({ type: kind || 'wall', speed: -vn, x: cx, y: cy });
    }
    return true;
  }

  function collideCircle(b, cx, cy, r, ev) {
    const R = MG.BALL_R + r;
    let nx = b.x - cx, ny = b.y - cy;
    const d2 = nx * nx + ny * ny;
    if (d2 >= R * R) return false;
    const d = Math.sqrt(d2) || 1e-6;
    nx /= d; ny /= d;
    b.x = cx + nx * R; b.y = cy + ny * R;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= (1 + C.BUMPER_E) * vn * nx; b.vy -= (1 + C.BUMPER_E) * vn * ny;
      b.vx += nx * C.BUMPER_KICK; b.vy += ny * C.BUMPER_KICK;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > C.MAX_SPEED) { b.vx *= C.MAX_SPEED / sp; b.vy *= C.MAX_SPEED / sp; }
      ev.push({ type: 'bumper', speed: -vn, x: cx, y: cy });
    }
    return true;
  }

  function collideMovers(sim, ev) {
    const h = sim.hole, b = sim.ball, t = sim.t;
    let hit = false;
    for (const s of h.spinners) {
      const a0 = MG.spinnerAngle(s, t);
      for (let k = 0; k < s.bars; k++) {
        const a = a0 + (k * Math.PI) / s.bars;
        const ux = Math.cos(a) * s.len, uy = Math.sin(a) * s.len;
        // velocity of the bar at the closest point to the ball (omega x r)
        const px = b.x - s.x, py = b.y - s.y;
        const proj = Math.max(-1, Math.min(1, (px * ux + py * uy) / (s.len * s.len)));
        const rx = ux * proj, ry = uy * proj;
        const wvx = -s.speed * ry, wvy = s.speed * rx;
        if (collideSeg(b, s.x - ux, s.y - uy, s.x + ux, s.y + uy, 4, C.MOVER_E, wvx, wvy, ev, 'mover')) hit = true;
      }
      if (collideSeg(b, s.x, s.y, s.x, s.y, 6, C.WALL_E, 0, 0, ev, 'wall')) hit = true;
    }
    for (const s of h.sliders) {
      const p = sliderPos(s, t);
      const hw = s.w / 2, hh = s.h / 2;
      const xs = [p.x - hw, p.x + hw], ys = [p.y - hh, p.y + hh];
      const e = [[xs[0], ys[0], xs[1], ys[0]], [xs[1], ys[0], xs[1], ys[1]], [xs[1], ys[1], xs[0], ys[1]], [xs[0], ys[1], xs[0], ys[0]]];
      for (const q of e) if (collideSeg(b, q[0], q[1], q[2], q[3], 2, C.MOVER_E, p.vx, p.vy, ev, 'mover')) hit = true;
    }
    return hit;
  }

  function inSand(h, x, y) { for (const z of h.sand) if (pointInPoly(x, y, z)) return true; return false; }
  function slopeAt(h, x, y, out) {
    out.x = 0; out.y = 0;
    for (const s of h.slopes) if (x > s.x && x < s.x + s.w && y > s.y && y < s.y + s.h) { out.x += s.dx * s.strength; out.y += s.dy * s.strength; }
    return out;
  }
  MG.inSand = inSand;

  const tmp = { x: 0, y: 0 };

  MG.step = function (sim, dt, ev) {
    const h = sim.hole, b = sim.ball;
    sim.t += dt;

    if (sim.state === 'sinking') {
      sim.anim += dt;
      const k = Math.min(1, sim.anim / C.SINK_TIME);
      b.x = sim.sinkFrom.x + (h.cup.x - sim.sinkFrom.x) * Math.min(1, k * 1.8);
      b.y = sim.sinkFrom.y + (h.cup.y - sim.sinkFrom.y) * Math.min(1, k * 1.8);
      sim.scale = 1 - 0.55 * k;
      if (k >= 1) { sim.state = 'sunk'; ev.push({ type: 'sunk' }); }
      return;
    }
    if (sim.state === 'splash') {
      sim.anim += dt;
      if (sim.anim >= C.SPLASH_TIME) {
        b.x = sim.last.x; b.y = sim.last.y; b.vx = b.vy = 0;
        sim.state = 'rest'; sim.scale = 1;
        ev.push({ type: 'reset' });
      }
      return;
    }
    if (sim.state === 'sunk') return;

    if (sim.state === 'rest') {
      // moving obstacles can still shove a resting ball
      const ovx = b.vx, ovy = b.vy;
      collideMovers(sim, ev);
      if (Math.hypot(b.vx - ovx, b.vy - ovy) > 1) { sim.state = 'moving'; sim.restTimer = 0; ev.push({ type: 'pushed' }); }
      else return;
    }

    // moving
    sim.moveTime += dt;
    const speed0 = Math.hypot(b.vx, b.vy);
    const n = Math.max(1, Math.ceil((speed0 * dt) / (MG.BALL_R * 0.35)));
    const hs = dt / n;
    for (let i = 0; i < n; i++) {
      // slopes
      slopeAt(h, b.x, b.y, tmp);
      b.vx += tmp.x * hs; b.vy += tmp.y * hs;
      // friction
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0) {
        const mul = inSand(h, b.x, b.y) ? C.SAND_MUL : 1;
        const ns = Math.max(0, sp - (C.FRICTION_C + C.FRICTION_K * sp) * mul * hs);
        b.vx *= ns / sp; b.vy *= ns / sp;
      }
      b.x += b.vx * hs; b.y += b.vy * hs;

      // collisions (two passes resolves corners)
      for (let pass = 0; pass < 2; pass++) {
        for (const s of sim.segs) collideSeg(b, s.ax, s.ay, s.bx, s.by, s.half, C.WALL_E, 0, 0, ev, 'wall');
        for (const u of h.bumpers) collideCircle(b, u.x, u.y, u.r, ev);
        collideMovers(sim, ev);
      }

      // cup
      const cdx = h.cup.x - b.x, cdy = h.cup.y - b.y;
      const cd = Math.hypot(cdx, cdy);
      const csp = Math.hypot(b.vx, b.vy);
      if (cd < MG.CUP_R + 3 && csp < C.CAPTURE_SPEED * 1.4 && cd > 0.01) {
        // gentle "gravity" toward the cup lip
        const g = 1400 * (1 - cd / (MG.CUP_R + 3));
        b.vx += (cdx / cd) * g * hs; b.vy += (cdy / cd) * g * hs;
      }
      if (cd < MG.CUP_R - 1.5) {
        if (csp < C.CAPTURE_SPEED) {
          sim.state = 'sinking'; sim.anim = 0; sim.sinkFrom = { x: b.x, y: b.y };
          b.vx = b.vy = 0;
          ev.push({ type: 'sink' });
          return;
        } else if (!sim.overCup) {
          // lip-out: deflect and bleed speed
          sim.overCup = true;
          const cross = cdx * b.vy - cdy * b.vx;
          const ang = (cross > 0 ? -1 : 1) * 0.35 * (1 - cd / MG.CUP_R) + (cross === 0 ? 0.2 : 0);
          const ca = Math.cos(ang), sa = Math.sin(ang);
          const vx = b.vx * ca - b.vy * sa, vy = b.vx * sa + b.vy * ca;
          b.vx = vx * 0.86; b.vy = vy * 0.86;
          ev.push({ type: 'lip' });
        }
      } else if (cd > MG.CUP_R + 1) sim.overCup = false;

      // water
      for (const w of h.water) {
        if (pointInPoly(b.x, b.y, w)) {
          sim.state = 'splash'; sim.anim = 0; sim.splashAt = { x: b.x, y: b.y };
          b.vx = b.vy = 0;
          ev.push({ type: 'water', x: b.x, y: b.y });
          return;
        }
      }
      // safety: escaped the course somehow -> put back, no penalty
      if (!MG.geom.pointInLoops(b.x, b.y, h.loops)) {
        b.x = sim.last.x; b.y = sim.last.y; b.vx = b.vy = 0;
        sim.state = 'rest'; ev.push({ type: 'rest', escaped: true }); return;
      }
    }

    // stopping
    const sp = Math.hypot(b.vx, b.vy);
    slopeAt(h, b.x, b.y, tmp);
    const onSlope = tmp.x !== 0 || tmp.y !== 0;
    if (sp < C.STOP_SPEED && !onSlope) {
      b.vx = b.vy = 0; sim.state = 'rest'; ev.push({ type: 'rest' });
    } else if (sp < C.STOP_SPEED * 2.4) {
      sim.restTimer += dt;
      if (sim.restTimer > (onSlope ? 0.6 : 0.3)) { b.vx = b.vy = 0; sim.state = 'rest'; ev.push({ type: 'rest' }); }
    } else sim.restTimer = 0;
    if (sim.moveTime > 25) { b.vx = b.vy = 0; sim.state = 'rest'; ev.push({ type: 'rest' }); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
