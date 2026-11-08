/* Rack & Roll — CPU opponent.
   Builds candidate shots (every legal ball into every pocket, a few speeds and spins,
   plain hits and kicks as a fallback), plays each one out with the real physics on a
   cloned table, scores the result with the real rules, and picks the best.
   Difficulty adds aim/power error at execution time and limits look-ahead.
   think() is a generator so the game can spread the work over several frames. */
(function (root) {
  'use strict';
  const RR = (root.RR = root.RR || {});
  const P = RR.PHYS;
  const Rules = RR.Rules;

  const LEVELS = {
    easy:   { powers: [0.42, 0.7], spins: [[0, 0]], aimErr: 1.5, powErr: 0.12, position: false, safety: false, maxCand: 8,  place: 3 },
    medium: { powers: [0.3, 0.5, 0.78], spins: [[0, 0], [0, -0.5]], aimErr: 0.6, powErr: 0.06, position: true, safety: false, maxCand: 14, place: 5 },
    hard:   { powers: [0.26, 0.4, 0.58, 0.85], spins: [[0, 0], [0, 0.5], [0, -0.6]], aimErr: 0.16, powErr: 0.025, position: true, safety: true, maxCand: 20, place: 8 },
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // How makeable is target -> pocket from the cue position? 0 (no) .. 1 (hanger).
  function ease(sim, cx, cy, id, pk) {
    const b = sim.balls[id];
    let dx = pk.ax - b.x, dy = pk.ay - b.y;
    const d2 = Math.hypot(dx, dy);
    if (d2 < 0.01) return { e: 1, ang: Math.atan2(b.y - cy, b.x - cx) };
    dx /= d2; dy /= d2;
    // approach angle into the pocket mouth
    const app = -(dx * pk.nx + dy * pk.ny);
    if (app < (pk.corner ? 0.25 : 0.55)) return null;
    const gx = b.x - dx * P.D, gy = b.y - dy * P.D;
    let ax = gx - cx, ay = gy - cy;
    const d1 = Math.hypot(ax, ay);
    if (d1 < 0.01) return null;
    ax /= d1; ay /= d1;
    const cut = ax * dx + ay * dy; // cos(cut angle)
    if (cut < 0.2) return null;
    if (!RR.pathClear(sim, cx, cy, gx, gy, 0, id)) return null;
    if (!RR.pathClear(sim, b.x, b.y, pk.ax, pk.ay, 0, id)) return null;
    const dist = d1 + d2;
    const e = cut * cut * clamp(1.15 - dist / 260, 0.15, 1) * (pk.corner ? 1 : 0.85) * (0.6 + 0.4 * app);
    return { e, ang: Math.atan2(ay, ax), d1, d2, cut };
  }

  // Best shot quality available to `player` from the current layout (cheap, no simulation).
  function layoutScore(game, sim, player) {
    const cue = sim.balls[0];
    if (!cue.on) return 0;
    const g2 = Object.assign({}, game, { turn: player });
    const targets = Rules.legalTargets(g2, sim);
    let best = 0, count = 0;
    for (const id of targets) {
      for (const pk of P.pockets) {
        const r = ease(sim, cue.x, cue.y, id, pk);
        if (!r) continue;
        if (r.e > best) best = r.e;
        if (r.e > 0.35) count++;
      }
    }
    return best * 120 + Math.min(count, 5) * 12;
  }

  function score(game, sim, cfg) {
    const res = Rules.evaluate(game, sim);
    if (res.win || res.cleared) return { s: 100000, res };
    if (res.lose) return { s: -100000, res };
    const me = game.turn;
    const next = applyResult(game, res);
    let s;
    if (res.foul) {
      s = -600;
    } else if (res.keepTurn) {
      const mine = next.players[me].group;
      const own = mine ? res.obj.filter((id) => Rules.groupOf(id) === mine).length : res.obj.length;
      s = 300 + own * 70;
      if (cfg.position) s += layoutScore(next, sim, me);
      if (mine && Rules.remaining(sim, mine) === 0) s += 40; // now on the 8
    } else {
      s = 0;
      if (cfg.safety) s -= layoutScore(next, sim, 1 - me) * 0.8;
    }
    // potting the opponent's balls helps them (when groups are known)
    const myG = next.players[me].group;
    if (myG) s -= res.obj.filter((id) => Rules.groupOf(id) !== myG).length * 20;
    return { s, res };
  }

  // Game-state bookkeeping after a result, as far as the CPU needs it (group assignment).
  function applyResult(game, res) {
    const players = game.players.map((p) => ({ group: p.group }));
    if (res.assign) {
      players[game.turn].group = res.assign;
      players[1 - game.turn].group = Rules.other(res.assign);
    }
    return { mode: game.mode, players, turn: game.turn, isBreak: false };
  }

  function candidatesFrom(game, sim, cfg) {
    const cue = sim.balls[0];
    const targets = Rules.legalTargets(game, sim);
    const list = [];
    for (const id of targets) {
      for (const pk of P.pockets) {
        const r = ease(sim, cue.x, cue.y, id, pk);
        if (r) list.push({ ang: r.ang, e: r.e, id, need: r.d1 + r.d2 / Math.max(0.3, r.cut) });
      }
    }
    list.sort((a, b) => b.e - a.e);
    const shots = [];
    for (const c of list.slice(0, cfg.maxCand)) {
      // speeds scaled to the distance the balls must travel
      const base = clamp(0.18 + c.need / 330, 0.2, 0.75);
      const pw = new Set(cfg.powers.map((p) => clamp(base * (0.7 + p), 0.12, 1)));
      for (const p of pw) for (const sp of cfg.spins) shots.push({ angle: c.ang, power: p, spinX: sp[0], spinY: sp[1], kind: 'pot', e: c.e });
    }
    // plain full hits on each legal ball (keeps it legal when nothing is pottable)
    for (const id of targets) {
      const b = sim.balls[id];
      if (!RR.pathClear(sim, cue.x, cue.y, b.x, b.y, 0, id)) continue;
      const a = Math.atan2(b.y - cue.y, b.x - cue.x);
      for (const off of [-0.06, 0, 0.06]) shots.push({ angle: a + off * (P.D / Math.max(10, Math.hypot(b.x - cue.x, b.y - cue.y))) * 8, power: 0.38, spinX: 0, spinY: 0, kind: 'hit' });
    }
    return shots;
  }

  function kickShots() {
    const shots = [];
    for (let k = 0; k < 40; k++) shots.push({ angle: (k / 40) * Math.PI * 2, power: 0.5, spinX: 0, spinY: 0, kind: 'kick' });
    return shots;
  }

  // Cue-ball placements for ball in hand: straight-in positions behind the best pots.
  function placements(game, sim, kitchen, cfg) {
    const out = [];
    const targets = Rules.legalTargets(game, sim);
    const opts = [];
    for (const id of targets) {
      const b = sim.balls[id];
      for (const pk of P.pockets) {
        let dx = pk.ax - b.x, dy = pk.ay - b.y;
        const d = Math.hypot(dx, dy);
        if (d < 1) continue;
        dx /= d; dy /= d;
        const app = -(dx * pk.nx + dy * pk.ny);
        if (app < (pk.corner ? 0.3 : 0.6)) continue;
        if (!RR.pathClear(sim, b.x, b.y, pk.ax, pk.ay, 0, id)) continue;
        for (const back of [9, 16, 26]) {
          for (const tilt of [0, 0.25, -0.25]) {
            const ca = Math.cos(tilt), sa = Math.sin(tilt);
            const rx = dx * ca - dy * sa, ry = dx * sa + dy * ca;
            const x = b.x - rx * (P.D + back), y = b.y - ry * (P.D + back);
            if (!RR.canPlace(sim, x, y, kitchen)) continue;
            if (!RR.pathClear(sim, x, y, b.x - dx * P.D, b.y - dy * P.D, 0, id)) continue;
            opts.push({ x, y, q: app * (1 - d / 300) - Math.abs(tilt) * 0.3 - back / 200 });
          }
        }
      }
    }
    opts.sort((a, b) => b.q - a.q);
    for (const o of opts) {
      if (out.length >= cfg.place) break;
      if (out.some((p) => Math.hypot(p.x - o.x, p.y - o.y) < 6)) continue;
      out.push(o);
    }
    if (!out.length) {
      // anywhere legal near the head spot / middle
      for (const [x, y] of [[P.HEAD.x, P.HEAD.y + 6], [30, 170], [70, 170], [50, 100], [25, 120], [75, 80]]) {
        if (RR.canPlace(sim, x, y, kitchen)) { out.push({ x, y }); break; }
      }
    }
    return out;
  }

  /* The thinking loop. out.best gets { angle, power, spinX, spinY, cue:{x,y}|null, score } */
  function* think(game, sim0, level, opts, out) {
    const cfg = LEVELS[level] || LEVELS.medium;
    opts = opts || {};
    let best = null;
    const tryShot = (base, shot, cuePos) => {
      const s = RR.cloneSim(base);
      RR.shoot(s, shot.angle, shot.power, shot.spinX, shot.spinY);
      RR.runToRest(s, 20);
      const r = score(game, s, cfg);
      // tiny preference for intended pots and softer shots on ties
      const val = r.s + (shot.e || 0) * 10 - shot.power * 4;
      if (!best || val > best.score) best = { angle: shot.angle, power: shot.power, spinX: shot.spinX, spinY: shot.spinY, cue: cuePos, score: val, res: r.res };
    };

    if (game.isBreak && game.mode !== 'practice') {
      const base = RR.cloneSim(sim0);
      const x = P.W / 2 + (Math.random() - 0.5) * 30;
      base.balls[0].x = x; base.balls[0].y = P.HEAD.y + 10;
      const apex = { x: P.FOOT.x, y: P.FOOT.y };
      const a = Math.atan2(apex.y - base.balls[0].y, apex.x - base.balls[0].x);
      out.best = { angle: a + (Math.random() - 0.5) * 0.004, power: 0.97, spinX: 0, spinY: -0.15, cue: { x, y: base.balls[0].y }, score: 0 };
      return;
    }

    let bases = [{ sim: sim0, cue: null }];
    if (opts.ballInHand) {
      const pl = placements(game, sim0, !!opts.kitchen, cfg);
      bases = pl.map((p) => {
        const s = RR.cloneSim(sim0);
        s.balls[0].x = p.x; s.balls[0].y = p.y; s.balls[0].on = true;
        return { sim: s, cue: { x: p.x, y: p.y } };
      });
      if (!bases.length) bases = [{ sim: sim0, cue: null }];
    }

    for (const b of bases) {
      for (const shot of candidatesFrom(game, b.sim, cfg)) { tryShot(b.sim, shot, b.cue); yield; }
    }
    if (!best || best.score < -300) {
      const b = bases[0];
      for (const shot of kickShots()) { tryShot(b.sim, shot, b.cue); yield; }
    }
    out.best = best;
  }

  // Execution error for the chosen difficulty.
  function gauss() { let u = 0, v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function addError(shot, level) {
    const cfg = LEVELS[level] || LEVELS.medium;
    return Object.assign({}, shot, {
      angle: shot.angle + gauss() * cfg.aimErr * Math.PI / 180,
      power: clamp(shot.power * (1 + gauss() * cfg.powErr), 0.05, 1),
    });
  }

  RR.AI = { think, addError, LEVELS, layoutScore, ease };
  if (typeof module !== 'undefined' && module.exports) module.exports = RR;
})(typeof window !== 'undefined' ? window : globalThis);
