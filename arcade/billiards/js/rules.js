/* Rack & Roll — 8-ball rules. Pure functions shared by the game and the CPU. */
(function (root) {
  'use strict';
  const RR = (root.RR = root.RR || {});

  const groupOf = (id) => (id === 0 ? 'cue' : id === 8 ? 'eight' : id < 8 ? 'solid' : 'stripe');
  const groupIds = (g) => (g === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : g === 'stripe' ? [9, 10, 11, 12, 13, 14, 15] : []);
  const other = (g) => (g === 'solid' ? 'stripe' : g === 'stripe' ? 'solid' : null);

  function remaining(sim, g) {
    let n = 0;
    for (const id of groupIds(g)) if (sim.balls[id].on) n++;
    return n;
  }

  // Which object balls may the shooter legally strike first?
  function legalTargets(game, sim) {
    if (game.mode === 'practice') {
      const out = [];
      for (let i = 1; i < 16; i++) if (sim.balls[i].on) out.push(i);
      return out;
    }
    const g = game.players[game.turn].group;
    if (!g) {
      const out = [];
      for (let i = 1; i < 16; i++) if (i !== 8 && sim.balls[i].on) out.push(i);
      if (!out.length && sim.balls[8].on) out.push(8);
      return out;
    }
    const mine = groupIds(g).filter((id) => sim.balls[id].on);
    return mine.length ? mine : sim.balls[8].on ? [8] : [];
  }

  /* Decide the outcome of a finished shot.
     game: { mode, players:[{group}], turn, isBreak }
     sim:  the table after the shot (sim.shot holds firstHit, railAfter, potted, railMask) */
  function evaluate(game, sim) {
    const shot = sim.shot;
    const me = game.turn;
    const myGroup = game.players[me].group;
    const potted = shot.potted.map((p) => p.id);
    const scratch = potted.includes(0);
    const eight = potted.includes(8);
    const obj = potted.filter((id) => id !== 0 && id !== 8);
    const open = !myGroup;
    const res = {
      foul: null, scratch, win: false, lose: false, assign: null,
      keepTurn: false, ballInHand: false, kitchen: false, respot8: false,
      potted, obj, reason: '', cleared: false,
    };

    // Before the shot, was the shooter on the 8?
    const onEight = !open && remaining(sim, myGroup) + obj.filter((id) => groupOf(id) === myGroup).length === 0;

    if (shot.firstHit === null) res.foul = 'No ball hit';
    else if (!game.isBreak && game.mode !== 'practice') {
      const f = shot.firstHit;
      if (open) { if (f === 8) res.foul = 'Can\'t hit the 8 first'; }
      else if (onEight) { if (f !== 8) res.foul = 'Must hit the 8 first'; }
      else if (groupOf(f) !== myGroup) res.foul = 'Wrong ball first';
    }
    if (!res.foul && !game.isBreak && potted.length === 0 && !shot.railAfter) res.foul = 'No rail after contact';
    if (scratch) res.foul = 'Scratch';

    if (game.mode === 'practice') {
      if (eight && remaining(sim, 'solid') + remaining(sim, 'stripe') > 0) res.respot8 = true;
      let left = 0;
      for (let i = 1; i < 16; i++) if (sim.balls[i].on) left++;
      if (left === 0 && !res.respot8) res.cleared = true;
      res.keepTurn = true;
      if (res.foul) { res.ballInHand = true; res.kitchen = game.isBreak && scratch; }
      return res;
    }

    if (eight) {
      if (game.isBreak) {
        res.respot8 = true; // 8 on the break comes back to the foot spot
      } else if (onEight && !res.foul) {
        res.win = true; res.reason = 'Sank the 8';
        return res;
      } else {
        res.lose = true;
        res.reason = scratch ? 'Scratched on the 8' : res.foul ? 'Fouled on the 8' : 'Sank the 8 too early';
        return res;
      }
    }

    if (res.foul) {
      res.ballInHand = true;
      res.kitchen = game.isBreak && scratch;
      return res;
    }

    if (game.isBreak) {
      res.keepTurn = obj.length > 0;
      return res;
    }
    if (open) {
      if (obj.length) { res.assign = groupOf(obj[0]); res.keepTurn = true; }
      return res;
    }
    res.keepTurn = obj.some((id) => groupOf(id) === myGroup);
    return res;
  }

  RR.Rules = { groupOf, groupIds, other, remaining, legalTargets, evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = RR;
})(typeof window !== 'undefined' ? window : globalThis);
