/* Pocket Putt — course data, seeded RNG, procedural generator, solvability check.
   Works in the browser (window.MG) and in Node (globalThis.MG) for testing. */
(function (G) {
  'use strict';
  const MG = (G.MG = G.MG || {});

  // World units. The course is designed in a 400 x 720 portrait space.
  const W = 400, H = 720;
  MG.W = W; MG.H = H;
  MG.BALL_R = 7;
  MG.CUP_R = 11;
  MG.WALL_HALF = 5;      // half thickness of wood walls
  MG.HOLES_PER_ROUND = 9;

  /* ---------------- seeded random ---------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) {
    const r = mulberry32(seed >>> 0);
    const api = {
      next: r,
      range: (a, b) => a + (b - a) * r(),
      int: (a, b) => Math.floor(a + (b - a + 1) * r()),
      pick: (arr) => arr[Math.floor(r() * arr.length)],
      chance: (p) => r() < p,
      shuffle: (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(r() * (i + 1));
          const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
      },
    };
    return api;
  }
  MG.makeRng = makeRng;
  MG.randomSeed = () => (Math.floor(Math.random() * 2147483646) + 1) >>> 0;
  MG.seedToCode = (s) => (s >>> 0).toString(36).toUpperCase();
  MG.codeToSeed = (c) => {
    const n = parseInt(String(c || '').trim(), 36);
    return Number.isFinite(n) && n > 0 ? (n >>> 0) : 0;
  };

  /* ---------------- geometry helpers ---------------- */
  const P = (x, y) => ({ x, y });
  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function pointInLoops(x, y, loops) {
    let c = 0;
    for (const l of loops) if (pointInPoly(x, y, l)) c++;
    return (c & 1) === 1; // even-odd, so holes in the turf work
  }
  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + dx * t - px, cy = ay + dy * t - py;
    return Math.sqrt(cx * cx + cy * cy);
  }
  function rectPoly(x, y, w, h) { return [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)]; }
  function blobPoly(rng, cx, cy, r, n, jitter) {
    n = n || 14; jitter = jitter == null ? 0.22 : jitter;
    const pts = [];
    const ph = rng ? rng.range(0, Math.PI * 2) : 0;
    for (let i = 0; i < n; i++) {
      const a = ph + (i / n) * Math.PI * 2;
      const k = rng ? 1 + rng.range(-jitter, jitter) : 1 + Math.sin(i * 2.7) * jitter * 0.6;
      pts.push(P(cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k * 0.92));
    }
    return smoothPoly(pts);
  }
  function smoothPoly(pts) { // one Chaikin pass for organic edges
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push(P(a.x * 0.75 + b.x * 0.25, a.y * 0.75 + b.y * 0.25));
      out.push(P(a.x * 0.25 + b.x * 0.75, a.y * 0.25 + b.y * 0.75));
    }
    return out;
  }
  function squarePoly(cx, cy, s, ang) {
    const pts = [];
    for (let i = 0; i < 4; i++) {
      const a = ang + Math.PI / 4 + (i * Math.PI) / 2;
      pts.push(P(cx + Math.cos(a) * s * Math.SQRT1_2, cy + Math.sin(a) * s * Math.SQRT1_2));
    }
    return pts;
  }
  function polyCentroid(poly) {
    let x = 0, y = 0;
    for (const p of poly) { x += p.x; y += p.y; }
    return P(x / poly.length, y / poly.length);
  }
  MG.geom = { P, pointInPoly, pointInLoops, distToSeg, rectPoly, blobPoly, squarePoly, polyCentroid };

  /* ---------------- hole template ---------------- */
  function emptyHole() {
    return {
      name: '', par: 3, tee: P(200, 620), cup: P(200, 120),
      loops: [], walls: [], blocks: [], bumpers: [], sand: [], water: [], slopes: [],
      spinners: [], sliders: [], handmade: false,
    };
  }

  /* ---------------- hand-made holes ---------------- */
  const pts = (arr) => arr.map((a) => P(a[0], a[1]));
  function handHoles() {
    const holes = [];

    // 1 — Warm-Up: straight shot threading two bumpers
    let h = emptyHole();
    h.name = 'Warm-Up'; h.handmade = true; h.par = 2;
    h.loops = [pts([[130, 80], [270, 80], [300, 110], [300, 630], [270, 660], [130, 660], [100, 630], [100, 110]])];
    h.tee = P(200, 600); h.cup = P(200, 150);
    h.bumpers = [{ x: 160, y: 370, r: 11 }, { x: 240, y: 370, r: 11 }];
    h.sand = [blobPoly(null, 256, 236, 22, 12, 0.2)];
    h.walls = [{ a: P(100, 470), b: P(128, 498) }, { a: P(300, 470), b: P(272, 498) }];
    holes.push(h);

    // 2 — Dogleg: L-shape with a 45° bank, a side slope and a sand trap
    h = emptyHole();
    h.name = 'Dogleg'; h.handmade = true; h.par = 3;
    h.loops = [pts([[40, 150], [130, 60], [330, 60], [360, 90], [360, 230], [330, 260], [190, 260], [160, 290], [160, 650], [130, 680], [70, 680], [40, 650]])];
    h.tee = P(100, 625); h.cup = P(305, 160);
    h.slopes = [{ x: 40, y: 380, w: 120, h: 100, dx: 1, dy: 0, strength: 90 }];
    h.sand = [blobPoly(null, 232, 112, 22, 12, 0.18)];
    h.bumpers = [{ x: 250, y: 205, r: 10 }];
    holes.push(h);

    // 3 — Windmill Gate: time the spinner, avoid the ponds
    h = emptyHole();
    h.name = 'Windmill Gate'; h.handmade = true; h.par = 3;
    h.loops = [pts([[90, 60], [310, 60], [340, 90], [340, 650], [310, 680], [90, 680], [60, 650], [60, 90]])];
    h.tee = P(200, 615); h.cup = P(200, 140);
    h.walls = [{ a: P(60, 370), b: P(148, 370) }, { a: P(252, 370), b: P(340, 370) }];
    h.spinners = [{ x: 200, y: 370, len: 56, speed: 1.6, phase: 0, bars: 1 }];
    h.water = [blobPoly(null, 118, 525, 30, 14, 0.15), blobPoly(null, 288, 232, 26, 14, 0.15)];
    h.bumpers = [{ x: 130, y: 205, r: 10 }];
    holes.push(h);

    // 4 — Hill Climb: putt up the slope, past the sliding block
    h = emptyHole();
    h.name = 'Hill Climb'; h.handmade = true; h.par = 3;
    h.loops = [pts([[120, 60], [280, 60], [350, 160], [350, 560], [280, 680], [120, 680], [50, 560], [50, 160]])];
    h.tee = P(200, 630); h.cup = P(200, 122);
    h.slopes = [{ x: 50, y: 300, w: 300, h: 120, dx: 0, dy: 1, strength: 150 }];
    h.sliders = [{ x: 200, y: 222, w: 64, h: 18, ax: 1, ay: 0, range: 92, speed: 1.3, phase: 0 }];
    h.water = [blobPoly(null, 296, 505, 26, 14, 0.15)];
    h.sand = [blobPoly(null, 110, 500, 24, 12, 0.2)];
    holes.push(h);

    return holes;
  }

  /* ---------------- procedural generator ---------------- */
  const CELL = 76, COLS = 5, ROWS = 9, OX = 10, OY = 18;
  const cellCenter = (c, r) => P(OX + c * CELL + CELL / 2, OY + r * CELL + CELL / 2);

  function buildLoops(filled) {
    // filled: Set of "c,r". Trace boundary edges, region on the right of travel (y-down).
    const has = (c, r) => filled.has(c + ',' + r);
    const edges = new Map(); // startKey -> end
    const add = (x1, y1, x2, y2) => edges.set(x1 + ',' + y1, [x2, y2, x1, y1]);
    for (const k of filled) {
      const [c, r] = k.split(',').map(Number);
      if (!has(c, r - 1)) add(c, r, c + 1, r);
      if (!has(c + 1, r)) add(c + 1, r, c + 1, r + 1);
      if (!has(c, r + 1)) add(c + 1, r + 1, c, r + 1);
      if (!has(c - 1, r)) add(c, r + 1, c, r);
    }
    const loops = [];
    while (edges.size) {
      const startKey = edges.keys().next().value;
      let key = startKey;
      const loop = [];
      let guard = 0;
      while (guard++ < 1000) {
        const e = edges.get(key);
        if (!e) break;
        edges.delete(key);
        loop.push(P(e[2], e[3]));
        key = e[0] + ',' + e[1];
        if (key === startKey) break;
      }
      // merge collinear points
      const m = [];
      for (let i = 0; i < loop.length; i++) {
        const a = loop[(i - 1 + loop.length) % loop.length], b = loop[i], c = loop[(i + 1) % loop.length];
        const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if (cr !== 0) m.push(b);
      }
      // to world + chamfer every corner (convex corners cut, concave corners filled)
      const wpts = m.map((p) => P(OX + p.x * CELL, OY + p.y * CELL));
      const out = [];
      for (let i = 0; i < wpts.length; i++) {
        const a = wpts[(i - 1 + wpts.length) % wpts.length], b = wpts[i], c = wpts[(i + 1) % wpts.length];
        const d1x = b.x - a.x, d1y = b.y - a.y, d2x = c.x - b.x, d2y = c.y - b.y;
        const convex = d1x * d2y - d1y * d2x > 0;
        const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
        const ch = Math.min(convex ? 18 : 22, l1 * 0.34, l2 * 0.34);
        out.push(P(b.x - (d1x / l1) * ch, b.y - (d1y / l1) * ch));
        out.push(P(b.x + (d2x / l2) * ch, b.y + (d2y / l2) * ch));
      }
      if (out.length >= 3) loops.push(out);
    }
    return loops;
  }

  function fixPinches(filled) {
    const has = (c, r) => filled.has(c + ',' + r);
    let changed = true, guard = 0;
    while (changed && guard++ < 50) {
      changed = false;
      for (let c = -1; c < COLS; c++) for (let r = -1; r < ROWS; r++) {
        const a = has(c, r), b = has(c + 1, r), d = has(c, r + 1), e = has(c + 1, r + 1);
        if (a && e && !b && !d) { filled.add((c + 1) + ',' + r); changed = true; }
        else if (b && d && !a && !e) { filled.add(c + ',' + r); changed = true; }
      }
    }
  }

  function tryGenerate(rng) {
    const h = emptyHole();
    // 1. random walk from the bottom toward the top
    let c = rng.int(0, COLS - 1), r = ROWS - 1 - rng.int(0, 1);
    const endRow = rng.int(0, 1);
    const path = [[c, r]];
    const visited = new Set([c + ',' + r]);
    let dir = rng.pick([-1, 1]), lateralRun = 0, sinceUp = 0;
    let guard = 0;
    while (r > endRow && guard++ < 60) {
      const canLat = c + dir >= 0 && c + dir < COLS && !visited.has((c + dir) + ',' + r);
      if (canLat && lateralRun < 3 && rng.chance(sinceUp === 0 ? 0.5 : 0.35)) {
        c += dir; lateralRun++; sinceUp++;
      } else {
        r -= 1; lateralRun = 0; sinceUp = 0;
        if (rng.chance(0.5)) dir = -dir;
      }
      path.push([c, r]); visited.add(c + ',' + r);
    }
    // a little lateral finish on the top row sometimes
    if (rng.chance(0.4)) {
      const d2 = c <= 1 ? 1 : c >= COLS - 2 ? -1 : rng.pick([-1, 1]);
      const steps = rng.int(1, 2);
      for (let i = 0; i < steps; i++) {
        const nc = c + d2;
        if (nc < 0 || nc >= COLS || visited.has(nc + ',' + r)) break;
        c = nc; path.push([c, r]); visited.add(c + ',' + r);
      }
    }
    if (path.length < 6) return null;

    // 2. widen with some side cells (these become ponds/sand/bumper zones too)
    const filled = new Set(visited);
    const extras = [];
    for (let i = 1; i < path.length - 1; i++) {
      if (!rng.chance(0.3)) continue;
      const [pc, pr] = path[i];
      const opts = [[pc - 1, pr], [pc + 1, pr], [pc, pr - 1], [pc, pr + 1]].filter(
        ([x, y]) => x >= 0 && x < COLS && y >= 0 && y < ROWS && !filled.has(x + ',' + y)
      );
      if (!opts.length) continue;
      const [x, y] = rng.pick(opts);
      filled.add(x + ',' + y); extras.push([x, y]);
    }
    fixPinches(filled);
    h.loops = buildLoops(filled);

    // 3. tee & cup
    const [tc, tr] = path[0];
    const [cc, cr] = path[path.length - 1];
    h.tee = cellCenter(tc, tr);
    const cupC = cellCenter(cc, cr);
    h.cup = P(cupC.x + rng.range(-10, 10), cupC.y + rng.range(-10, 10));

    // cell info: travel axis for interior path cells
    const info = path.map((p, i) => {
      const prev = path[i - 1], next = path[i + 1];
      const inD = prev ? [p[0] - prev[0], p[1] - prev[1]] : null;
      const outD = next ? [next[0] - p[0], next[1] - p[1]] : null;
      const straight = inD && outD && inD[0] === outD[0] && inD[1] === outD[1];
      return { c: p[0], r: p[1], inD, outD, straight, center: cellCenter(p[0], p[1]) };
    });
    const interior = info.slice(1, -1);
    const straightCells = interior.filter((x) => x.straight);
    const used = new Set();
    const takeCell = (list) => {
      const free = list.filter((x) => !used.has(x.c + ',' + x.r));
      if (!free.length) return null;
      const x = rng.pick(free); used.add(x.c + ',' + x.r); return x;
    };
    const farFromEnds = (x, y, d) => Math.hypot(x - h.tee.x, y - h.tee.y) > d && Math.hypot(x - h.cup.x, y - h.cup.y) > d;

    // 4. features
    const pool = rng.shuffle(['bumpers', 'wall', 'sand', 'slope', 'water', 'spinner', 'slider', 'block', 'sand', 'bumpers', 'water', 'slope']);
    const count = rng.int(3, 5);
    let placed = 0;
    for (const f of pool) {
      if (placed >= count) break;
      if (f === 'bumpers') {
        const cell = takeCell(interior); if (!cell) continue;
        const n = rng.int(1, 2);
        const axis = cell.outD || cell.inD;
        const perp = [-axis[1], axis[0]];
        for (let i = 0; i < n; i++) {
          const off = n === 1 ? rng.pick([-1, 1]) * rng.range(12, 20) : (i ? 1 : -1) * 22;
          const x = cell.center.x + perp[0] * off, y = cell.center.y + perp[1] * off;
          if (farFromEnds(x, y, 34)) h.bumpers.push({ x, y, r: rng.range(8.5, 11) });
        }
        placed++;
      } else if (f === 'wall') {
        const cell = takeCell(interior.concat(extras.map(([x, y]) => ({ c: x, r: y, center: cellCenter(x, y), inD: [0, -1] })))); if (!cell) continue;
        const axis = cell.outD || cell.inD;
        const perp = [-axis[1], axis[0]];
        const s = rng.pick([-1, 1]);
        const cx = cell.center.x + perp[0] * s * 16, cy = cell.center.y + perp[1] * s * 16;
        const ang = Math.atan2(axis[1], axis[0]) + s * rng.range(0.5, 0.9);
        const L = rng.range(13, 18);
        if (farFromEnds(cx, cy, 40)) {
          h.walls.push({ a: P(cx - Math.cos(ang) * L, cy - Math.sin(ang) * L), b: P(cx + Math.cos(ang) * L, cy + Math.sin(ang) * L) });
          placed++;
        }
      } else if (f === 'sand') {
        const cand = interior.concat(info.slice(-1)).concat(extras.map(([x, y]) => ({ c: x, r: y, center: cellCenter(x, y) })));
        const cell = rng.pick(cand);
        const rad = rng.range(15, 24);
        const x = cell.center.x + rng.range(-16, 16), y = cell.center.y + rng.range(-16, 16);
        if (Math.hypot(x - h.cup.x, y - h.cup.y) < rad + 20 || Math.hypot(x - h.tee.x, y - h.tee.y) < rad + 24) continue;
        h.sand.push(blobPoly(rng, x, y, rad, 12, 0.2)); placed++;
      } else if (f === 'slope') {
        const cell = takeCell(straightCells); if (!cell) continue;
        const axis = cell.outD;
        const sgn = rng.pick([1, -1, 1]);
        let dx = axis[0] * sgn, dy = axis[1] * sgn;
        if (rng.chance(0.3)) { const t = dx; dx = -dy * rng.pick([-1, 1]); dy = t; } // cross slope
        h.slopes.push({ x: OX + cell.c * CELL, y: OY + cell.r * CELL, w: CELL, h: CELL, dx, dy, strength: rng.range(70, 120) });
        placed++;
      } else if (f === 'water') {
        if (extras.length && rng.chance(0.7)) {
          const [x, y] = rng.pick(extras);
          const cc2 = cellCenter(x, y);
          if (!farFromEnds(cc2.x, cc2.y, 60)) continue;
          h.water.push(blobPoly(rng, cc2.x + rng.range(-6, 6), cc2.y + rng.range(-6, 6), rng.range(22, 28), 14, 0.15));
        } else {
          const cell = takeCell(interior); if (!cell) continue;
          const axis = cell.outD || cell.inD;
          const perp = [-axis[1], axis[0]];
          const s = rng.pick([-1, 1]);
          const x = cell.center.x + perp[0] * s * 22, y = cell.center.y + perp[1] * s * 22;
          if (!farFromEnds(x, y, 46)) continue;
          h.water.push(blobPoly(rng, x, y, rng.range(12, 15), 12, 0.15));
        }
        placed++;
      } else if (f === 'spinner') {
        const cell = takeCell(straightCells); if (!cell) continue;
        if (!farFromEnds(cell.center.x, cell.center.y, 60)) continue;
        h.spinners.push({ x: cell.center.x, y: cell.center.y, len: rng.range(26, 31), speed: rng.pick([-1, 1]) * rng.range(1.2, 2.0), phase: rng.range(0, 6.28), bars: 1 });
        placed++;
      } else if (f === 'slider') {
        const cell = takeCell(straightCells); if (!cell) continue;
        if (!farFromEnds(cell.center.x, cell.center.y, 50)) continue;
        const axis = cell.outD;
        const across = [-axis[1], axis[0]];
        const horiz = across[0] !== 0;
        h.sliders.push({ x: cell.center.x, y: cell.center.y, w: horiz ? 26 : 16, h: horiz ? 16 : 26, ax: Math.abs(across[0]), ay: Math.abs(across[1]), range: 15, speed: rng.range(1.1, 1.9), phase: rng.range(0, 6.28) });
        placed++;
      } else if (f === 'block') {
        const cell = takeCell(interior); if (!cell) continue;
        const x = cell.center.x + rng.range(-14, 14), y = cell.center.y + rng.range(-14, 14);
        if (!farFromEnds(x, y, 46)) continue;
        h.blocks.push(squarePoly(x, y, rng.range(14, 20), rng.pick([0, Math.PI / 4, rng.range(0, 1.5)])));
        placed++;
      }
    }
    h.handmade = false;
    return h;
  }

  /* ---------------- solvability check (grid BFS) ---------------- */
  const GRID = 4;
  function validateHole(h) {
    const R = MG.BALL_R;
    const gw = Math.ceil(W / GRID), gh = Math.ceil(H / GRID);
    const blocked = new Uint8Array(gw * gh);
    const segs = [];
    for (const l of h.loops) for (let i = 0; i < l.length; i++) segs.push([l[i], l[(i + 1) % l.length], MG.WALL_HALF]);
    for (const w of h.walls) segs.push([w.a, w.b, MG.WALL_HALF]);
    for (const b of h.blocks) for (let i = 0; i < b.length; i++) segs.push([b[i], b[(i + 1) % b.length], 0]);
    const isBlocked = (x, y) => {
      if (!pointInLoops(x, y, h.loops)) return true;
      for (const s of segs) if (distToSeg(x, y, s[0].x, s[0].y, s[1].x, s[1].y) < R + s[2] + 0.5) return true;
      for (const b of h.blocks) if (pointInPoly(x, y, b)) return true;
      for (const b of h.bumpers) if (Math.hypot(x - b.x, y - b.y) < b.r + R + 0.5) return true;
      for (const w of h.water) if (pointInPoly(x, y, w)) return true;
      for (const s of h.spinners) if (Math.hypot(x - s.x, y - s.y) < 6 + R) return true;
      for (const s of h.sliders) {
        if (Math.abs(x - s.x) < s.w / 2 + R && Math.abs(y - s.y) < s.h / 2 + R) return true;
      }
      return false;
    };
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) blocked[j * gw + i] = isBlocked(i * GRID + GRID / 2, j * GRID + GRID / 2) ? 1 : 0;
    const toIdx = (p) => Math.floor(p.y / GRID) * gw + Math.floor(p.x / GRID);
    const s = toIdx(h.tee), t = toIdx(h.cup);
    if (blocked[s] || blocked[t]) return { ok: false, reason: 'tee/cup blocked' };
    // cup and tee must be on plain turf
    const onZone = (p) => h.sand.some((z) => pointInPoly(p.x, p.y, z)) || h.water.some((z) => pointInPoly(p.x, p.y, z)) ||
      h.slopes.some((z) => p.x > z.x && p.x < z.x + z.w && p.y > z.y && p.y < z.y + z.h);
    if (onZone(h.tee) || onZone(h.cup)) return { ok: false, reason: 'tee/cup in zone' };
    // cup clearance: nothing solid within reach of the cup lip
    const dist = new Float32Array(gw * gh).fill(-1);
    const q = [s]; dist[s] = 0; let qi = 0;
    while (qi < q.length) {
      const cur = q[qi++];
      if (cur === t) break;
      const ci = cur % gw, cj = (cur / gw) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
        const n = nj * gw + ni;
        if (blocked[n] || dist[n] >= 0) continue;
        if (di && dj && (blocked[cj * gw + ni] || blocked[nj * gw + ci])) continue; // no corner cutting
        dist[n] = dist[cur] + (di && dj ? 1.414 : 1);
        q.push(n);
      }
    }
    if (dist[t] < 0) return { ok: false, reason: 'no path' };
    return { ok: true, pathLen: dist[t] * GRID };
  }
  MG.validateHole = validateHole;

  function parFor(h, pathLen) {
    let par = 2 + Math.floor(pathLen / 300);
    const hazards = h.water.length + h.spinners.length + h.sliders.length;
    if (hazards >= 2) par += 1;
    return Math.max(2, Math.min(5, par));
  }

  function fallbackHole() {
    const h = emptyHole();
    h.loops = [pts([[110, 70], [290, 70], [320, 100], [320, 640], [290, 670], [110, 670], [80, 640], [80, 100]])];
    h.tee = P(200, 620); h.cup = P(200, 130); h.par = 3;
    return h;
  }

  const NAMES_A = ['Twisty', 'Mossy', 'Breezy', 'Pebble', 'Lucky', 'Sunny', 'Crooked', 'Sneaky', 'Bouncy', 'Quiet', 'Zig', 'Tidal', 'Clover', 'Maple'];
  const NAMES_B = ['Lane', 'Loop', 'Alley', 'Run', 'Corner', 'Bend', 'Hollow', 'Garden', 'Pass', 'Switchback', 'Steps', 'Way'];

  function generateHole(seed, index) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const rng = makeRng((seed * 2654435761 + index * 40503 + attempt * 97 + 1) >>> 0);
      const h = tryGenerate(rng);
      if (!h) continue;
      const v = validateHole(h);
      if (!v.ok) continue;
      h.par = parFor(h, v.pathLen);
      h.name = rng.pick(NAMES_A) + ' ' + rng.pick(NAMES_B);
      h.pathLen = v.pathLen;
      return h;
    }
    const h = fallbackHole(); h.name = 'Straightaway';
    return h;
  }
  MG.generateHole = generateHole;

  // A round: hand-made holes at fixed slots, procedural ones in between.
  const HAND_SLOTS = { 0: 0, 2: 1, 5: 2, 7: 3 };
  MG.buildRound = function (seed) {
    const hand = handHoles();
    const holes = [];
    for (let i = 0; i < MG.HOLES_PER_ROUND; i++) {
      if (HAND_SLOTS[i] != null) holes.push(hand[HAND_SLOTS[i]]);
      else holes.push(generateHole(seed, i));
    }
    return holes;
  };
  MG.handHoles = handHoles;
})(typeof window !== 'undefined' ? window : globalThis);
