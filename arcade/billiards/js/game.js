/* Rack & Roll — game loop, input, rendering, turns and UI. */
(function () {
  'use strict';
  const RR = window.RR;
  const P = RR.PHYS, Rules = RR.Rules, AI = RR.AI, Sound = RR.Sound, Rnd = RR.Render;
  const { W, L, R, D } = P;
  const RAIL = Rnd.RAIL;

  const LS_MUTE = 'racknroll.muted';
  const LS_LEVEL = 'racknroll.level';
  const LS_REC = 'racknroll.record.v1';

  /* ---------------- DOM ---------------- */
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const tableCanvas = document.createElement('canvas');
  const tctx = tableCanvas.getContext('2d');

  /* ---------------- utils ---------------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const vib = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* no haptics */ } };
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  function readSafe() {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:0;height:0;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden';
    document.body.appendChild(d);
    const cs = getComputedStyle(d);
    const v = { t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
    d.remove();
    return v;
  }

  /* ---------------- state ---------------- */
  const S = {
    phase: 'title',        // title | aim | strike | moving | cpu | over
    paused: false,
    mode: 'cpu', level: lsGet(LS_LEVEL) || 'medium',
    game: null, sim: RR.createSim(),
    aim: -Math.PI / 2, power: 0, spin: { x: 0, y: 0 },
    ballInHand: false, kitchen: true,
    ptr: new Map(), wheelOff: 0,
    strike: null, cpu: null, drops: [], fx: [], time: 0,
    lastPos: [], firstBreaker: 0, shotCount: 0, token: 0,
    view: { s: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1, safe: { t: 0, b: 0 } },
    perf: { tick: 0, render: 0, maxFrame: 0 },
    cpuLog: [],
    ui: {},
  };
  const art = new Rnd.BallArt();

  /* ---------------- layout ---------------- */
  function layout() {
    const v = S.view;
    v.dpr = Math.min(window.devicePixelRatio || 1, 3);
    v.w = window.innerWidth; v.h = window.innerHeight;
    v.safe = readSafe();
    canvas.width = Math.round(v.w * v.dpr); canvas.height = Math.round(v.h * v.dpr);
    tableCanvas.width = canvas.width; tableCanvas.height = canvas.height;

    const hud = $('hud').getBoundingClientRect();
    const top = hud.bottom + 6;
    const bottom = v.h - (36 + v.safe.b);
    const gap = 5;
    const TW = W + RAIL * 2, TH = L + RAIL * 2;
    const availH = Math.max(120, bottom - top);
    // Wide screens: controls sit beside the table. Phones: the table takes the full
    // width and the controls ride on the long rails, clear of the pockets.
    let CW = clamp(Math.round(v.w * 0.1), 38, 66);
    const sFull = Math.min((v.w - 6) / TW, availH / TH);
    const side = (v.w - TW * sFull) / 2;
    if (side >= 31) { v.overlay = false; v.s = sFull; CW = clamp(Math.floor(side - 6), 25, 66); }
    else {
      const sSide = Math.min((v.w - 2 * (CW + gap) - 4) / TW, availH / TH);
      v.overlay = sSide < sFull * 0.94;
      v.s = v.overlay ? sFull : sSide;
    }
    const tw = TW * v.s, th = TH * v.s;
    const tl = (v.w - tw) / 2, tt = top + (availH - th) / 2;
    v.ox = tl + RAIL * v.s; v.oy = tt + RAIL * v.s;
    v.table = { x: tl, y: tt, w: tw, h: th };
    let sb;
    if (v.overlay) {
      const railPx = (RAIL - 1) * v.s;
      CW = Math.max(30, Math.round(railPx + 4));
      const lx = tl + (RAIL * v.s - CW) / 2 + 0.5, rx = v.w - lx - CW;
      const y0 = v.oy + (L / 2 + P.SS + 7) * v.s, y1 = v.oy + (L - P.CA - 5) * v.s;
      S.ui.power = { x: lx, y: y0, w: CW, h: y1 - y0 };
      S.ui.wheel = { x: rx + 3, y: y0 + 4, w: CW - 6, h: y1 - y0 - 26 };
      sb = Math.min(CW + 4, 44);
      S.ui.spinBtn = { x: rx + (CW - sb) / 2, y: v.oy + L * 0.3125 * v.s - sb / 2 - 6, w: sb, h: sb + 14 };
      S.ui.powerHit = { x: lx - 6, y: y0 - 10, w: CW + 16, h: y1 - y0 + 20 };
      S.ui.wheelHit = { x: rx - 10, y: y0 - 6, w: CW + 16, h: y1 - y0 + 6 };
      S.ui.colR = rx;
    } else {
      const lx = Math.max(4, tl - gap - CW), rx = Math.min(v.w - CW - 4, tl + tw + gap);
      const ph = Math.min(th * 0.66, 420);
      S.ui.power = { x: lx, y: tt + (th - ph) / 2, w: CW, h: ph };
      sb = Math.min(CW - 2, 46);
      S.ui.spinBtn = { x: rx + (CW - sb) / 2, y: tt + th * 0.08, w: sb, h: sb + 14 };
      const wy = S.ui.spinBtn.y + sb + 30;
      const wh = Math.min(th * 0.5, 300);
      S.ui.wheel = { x: rx + CW * 0.14, y: wy, w: CW * 0.72, h: wh };
      S.ui.powerHit = { x: lx - 4, y: tt, w: CW + 8, h: th };
      S.ui.wheelHit = { x: rx - 4, y: wy - 10, w: CW + 8, h: wh + 20 };
      S.ui.colR = rx;
    }

    const btn = $('spinBtn');
    btn.style.left = (S.ui.spinBtn.x + sb / 2) + 'px';
    btn.style.top = S.ui.spinBtn.y + 'px';
    btn.style.transform = 'translateX(-50%)';
    const ball = btn.querySelector('.spin-ball');
    ball.style.width = ball.style.height = sb + 'px';

    art.setRadius(R * v.s * v.dpr);
    renderTable();
  }
  const sx = (x) => S.view.ox + x * S.view.s;
  const sy = (y) => S.view.oy + y * S.view.s;
  const toWorld = (px, py) => ({ x: (px - S.view.ox) / S.view.s, y: (py - S.view.oy) / S.view.s });
  const inRect = (r, x, y) => r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

  function renderTable() {
    const v = S.view, c = tctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    // background
    const g = c.createRadialGradient(canvas.width / 2, canvas.height * 0.45, 10, canvas.width / 2, canvas.height * 0.45, Math.max(canvas.width, canvas.height) * 0.75);
    g.addColorStop(0, '#1b3346'); g.addColorStop(1, '#08121c');
    c.fillStyle = g; c.fillRect(0, 0, canvas.width, canvas.height);
    // faint diagonal weave
    c.strokeStyle = 'rgba(255,255,255,0.025)'; c.lineWidth = 1 * v.dpr;
    for (let k = -canvas.height; k < canvas.width; k += 14 * v.dpr) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + canvas.height, canvas.height); c.stroke(); }
    c.setTransform(v.dpr * v.s, 0, 0, v.dpr * v.s, v.dpr * v.ox, v.dpr * v.oy);
    Rnd.drawTable(c);
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* ---------------- HUD ---------------- */
  const iconCache = {};
  const icon = (i) => iconCache[i] || (iconCache[i] = Rnd.ballIconURL(i, 16));

  function updateHud() {
    const g = S.game;
    if (!g) return;
    for (let k = 0; k < 2; k++) {
      const pl = g.players[k];
      const card = $('pl' + k);
      if (g.mode === 'practice' && k === 1) { card.style.visibility = 'hidden'; continue; }
      card.style.visibility = '';
      card.classList.toggle('active', g.turn === k && S.phase !== 'over');
      $('nm' + k).textContent = pl.name;
      $('av' + k).textContent = pl.name[0];
      const tag = $('tag' + k);
      const box = $('pb' + k);
      let html = '';
      if (g.mode === 'practice') {
        tag.textContent = 'Practice'; tag.className = 'ptag';
        let left = 0; for (let i = 1; i < 16; i++) if (S.sim.balls[i].on) left++;
        html = `<span class="open">${15 - left}/15 potted · ${S.shotCount} shots</span>`;
      } else if (!pl.group) {
        tag.textContent = '';
        html = `<span class="open">${g.isBreak ? (g.turn === k ? 'Breaking' : 'Open table') : 'Open table'}</span>`;
      } else {
        tag.textContent = pl.group === 'solid' ? 'Solids' : 'Stripes';
        tag.className = 'ptag';
        const ids = Rules.groupIds(pl.group);
        const left = ids.filter((id) => S.sim.balls[id].on).length;
        if (left === 0) {
          html = `<img src="${icon(8)}" class="on8" alt="8">`;
          tag.textContent = 'On the 8'; tag.className = 'ptag keep';
        } else {
          const k2 = k === 1;
          const list = ids.map((id) => `<img src="${icon(id)}" class="${S.sim.balls[id].on ? '' : 'gone'}" alt="${id}">`);
          html = (k2 ? list.reverse() : list).join('');
        }
      }
      if (box.dataset.h !== html) { box.innerHTML = html; box.dataset.h = html; }
    }
    const rr = ((S.ui.spinBtn && S.ui.spinBtn.w) || 36) / 2 - 6;
    $('spinDotSmall').style.transform = `translate(calc(-50% + ${S.spin.x * rr}px), calc(-50% + ${-S.spin.y * rr}px))`;
  }

  let toastT = 0;
  function toast(text, opts) {
    opts = opts || {};
    const el = $('toast');
    el.innerHTML = '';
    const a = document.createElement('span'); a.textContent = text; el.appendChild(a);
    if (opts.sub) { const b = document.createElement('span'); b.className = 't2'; b.textContent = opts.sub; el.appendChild(b); }
    el.className = 'toast show' + (opts.small ? ' small' : '') + (opts.foul ? ' foul' : '');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('show'), opts.ms || 1300);
  }
  let hintT = 0;
  function hint(text, ms) {
    const el = $('hint');
    clearTimeout(hintT);
    if (!text) { el.classList.add('off'); return; }
    el.textContent = text; el.classList.remove('off');
    if (ms) hintT = setTimeout(() => el.classList.add('off'), ms);
  }
  function showModal(id, on) { $(id).classList.toggle('show', on); }
  function setPaused(p) { S.paused = p; if (!p) lastT = performance.now(); }

  /* ---------------- game flow ---------------- */
  function isCpuTurn() { return S.game && S.game.players[S.game.turn].isCpu; }
  function curName() { return S.game.players[S.game.turn].name; }

  function newGame(mode, level, breaker) {
    S.token++;
    S.mode = mode; if (level) S.level = level;
    const names = mode === 'cpu' ? ['You', 'CPU'] : mode === 'pvp' ? ['Player 1', 'Player 2'] : ['You', ''];
    S.game = {
      mode, turn: breaker || 0, isBreak: true,
      players: names.map((n, i) => ({ name: n, group: null, isCpu: mode === 'cpu' && i === 1, pots: 0, fouls: 0, shots: 0 })),
    };
    S.firstBreaker = S.game.turn;
    $('spinBtn').classList.remove('hidden');
    RR.rack(S.sim);
    art.resetOrientation();
    S.lastPos = S.sim.balls.map((b) => ({ x: b.x, y: b.y }));
    S.drops = []; S.fx = []; S.strike = null; S.cpu = null; S.shotCount = 0;
    S.spin = { x: 0, y: 0 };
    S.ballInHand = true; S.kitchen = true;
    S.aim = Math.atan2(P.FOOT.y - S.sim.balls[0].y, P.FOOT.x - S.sim.balls[0].x);
    S.phase = 'aim';
    updateHud();
    beginTurn(true);
  }

  function defaultAim() {
    const cue = S.sim.balls[0];
    if (S.game.isBreak) { S.aim = Math.atan2(P.FOOT.y - cue.y, P.FOOT.x - cue.x); return; }
    const targets = Rules.legalTargets(S.game, S.sim);
    let best = null, bd = 1e9;
    for (const id of targets) {
      const b = S.sim.balls[id];
      const d = Math.hypot(b.x - cue.x, b.y - cue.y);
      const clear = RR.pathClear(S.sim, cue.x, cue.y, b.x, b.y, 0, id);
      const score = d + (clear ? 0 : 400);
      if (score < bd) { bd = score; best = b; }
    }
    if (best) S.aim = Math.atan2(best.y - cue.y, best.x - cue.x);
  }

  function beginTurn(first) {
    const g = S.game;
    S.power = 0;
    S.spin = { x: 0, y: 0 };
    defaultAim();
    updateHud();
    const name = curName();
    if (isCpuTurn()) {
      S.phase = 'cpu';
      startCpu();
      hint('CPU is lining up a shot…');
    } else {
      S.phase = 'aim';
      if (S.ballInHand) hint(S.kitchen ? 'Ball in hand behind the line · drag the cue ball' : 'Ball in hand · drag the cue ball anywhere', 4500);
      else if (S.shotCount < 2) hint('Drag the table to aim · pull the cue down to shoot', 5000);
      else hint(null);
    }
    $('spinBtn').classList.toggle('disabled', isCpuTurn());
    if (!first && g.mode !== 'practice') {
      if (g.mode === 'pvp') toast(name + "'s turn", { small: true, ms: 1000 });
      Sound.turn();
    }
  }

  function takeShot(angle, power, spinX, spinY) {
    if (!(S.phase === 'aim' || S.phase === 'cpu')) return false;
    S.phase = 'strike';
    S.strike = { t: 0, dur: 0.07 + 0.05 * (1 - power), from: 3 + power * 26, angle, power, spinX, spinY };
    S.aim = angle;
    hint(null);
    return true;
  }
  function fireShot() {
    const st = S.strike;
    S.strike = null;
    const g = S.game;
    g.players[g.turn].shots++;
    S.shotCount++;
    RR.shoot(S.sim, st.angle, st.power, st.spinX, st.spinY);
    Sound.strike(st.power);
    vib(st.power > 0.7 ? 18 : 9);
    S.ballInHand = false;
    S.phase = 'moving';
    S.power = 0;
  }

  function spotBall(id) {
    const b = S.sim.balls[id];
    let y = P.FOOT.y;
    while (!RR.canPlace(S.sim, P.FOOT.x, y, false) && y > R) y -= 0.5;
    b.x = P.FOOT.x; b.y = y; b.on = true; b.pocket = -1; b.vx = b.vy = b.wx = b.wy = b.sz = 0; b.moving = false;
    S.lastPos[id] = { x: b.x, y: b.y };
  }
  function respawnCue(kitchen) {
    const c = S.sim.balls[0];
    const tries = [[P.HEAD.x, P.HEAD.y + 8], [P.HEAD.x - 12, P.HEAD.y + 8], [P.HEAD.x + 12, P.HEAD.y + 8], [P.HEAD.x, P.HEAD.y + 22], [25, 185], [75, 185]];
    let ok = false;
    for (const [x, y] of tries) { if (RR.canPlace(S.sim, x, y, kitchen)) { c.x = x; c.y = y; ok = true; break; } }
    if (!ok) { for (let y = L - R - 1; y > R && !ok; y -= 4) for (let x = R + 1; x < W - R && !ok; x += 4) if (RR.canPlace(S.sim, x, y, kitchen)) { c.x = x; c.y = y; ok = true; } }
    c.on = true; c.pocket = -1; c.vx = c.vy = c.wx = c.wy = c.sz = 0; c.moving = false;
    S.lastPos[0] = { x: c.x, y: c.y };
  }

  function endShot() {
    const g = S.game, me = g.turn;
    const res = Rules.evaluate(g, S.sim);
    const pl = g.players[me];
    pl.pots += res.obj.length;
    if (res.foul) pl.fouls++;
    const wasBreak = g.isBreak;
    g.isBreak = false;

    if (g.mode === 'practice') {
      if (res.respot8) spotBall(8);
      if (res.scratch) respawnCue(res.kitchen);
      if (res.cleared) { gameOver(0, 'Table cleared in ' + S.shotCount + ' shots'); return; }
      S.ballInHand = res.ballInHand; S.kitchen = res.kitchen;
      if (res.foul) { toast(res.foul, { small: true, foul: true, sub: 'Ball in hand' }); Sound.foul(); vib([30, 40, 30]); }
      else if (res.obj.length || (res.potted.includes(8) && res.respot8)) Sound.good();
      if (res.respot8) toast('8 spotted', { small: true, ms: 900 });
      beginTurn(false);
      return;
    }

    if (res.win) { gameOver(me, res.reason); return; }
    if (res.lose) { gameOver(1 - me, res.reason); return; }
    if (res.respot8) { spotBall(8); toast('8 on the break', { small: true, sub: 'Spotted on the foot spot' }); }
    if (res.assign) {
      pl.group = res.assign; g.players[1 - me].group = Rules.other(res.assign);
      const label = res.assign === 'solid' ? 'Solids' : 'Stripes';
      toast((me === 0 && g.mode === 'cpu' ? 'You\u2019re ' : pl.name + ': ') + label, { small: true, ms: 1400 });
      Sound.good();
    }
    if (res.scratch) respawnCue(res.kitchen);
    if (res.foul) {
      const nextName = g.players[1 - me].name;
      toast(res.foul, { foul: true, sub: (nextName === 'You' ? 'You have' : nextName + ' has') + ' ball in hand', ms: 1700 });
      Sound.foul(); vib([30, 40, 30]);
      S.ballInHand = true; S.kitchen = res.kitchen;
      g.turn = 1 - me;
    } else {
      S.ballInHand = false; S.kitchen = false;
      if (!res.assign && res.obj.length && res.keepTurn) Sound.good();
      if (!res.keepTurn) g.turn = 1 - me;
      else if (wasBreak && res.obj.length) toast('Nice break', { small: true, ms: 900 });
    }
    updateHud();
    const tk = S.token;
    S.phase = 'wait';
    setTimeout(() => { if (tk === S.token && S.phase === 'wait') beginTurn(false); }, res.foul ? 650 : 250);
  }

  function readRecord() { try { return JSON.parse(lsGet(LS_REC) || '{}') || {}; } catch (e) { return {}; } }
  function recordLine() {
    const r = readRecord();
    const parts = ['easy', 'medium', 'hard'].filter((k) => r[k]).map((k) => `${k[0].toUpperCase() + k.slice(1)} ${r[k].w}-${r[k].l}`);
    return parts.length ? 'Your record vs CPU: ' + parts.join(' · ') : '';
  }

  function gameOver(winner, reason) {
    const g = S.game;
    S.phase = 'over';
    S.token++;
    updateHud();
    hint(null);
    const w = g.players[winner];
    let title, good = true;
    if (g.mode === 'practice') { title = 'Table cleared!'; }
    else if (g.mode === 'cpu') {
      good = winner === 0;
      title = good ? 'You win!' : 'CPU wins';
      const r = readRecord();
      r[S.level] = r[S.level] || { w: 0, l: 0 };
      if (good) r[S.level].w++; else r[S.level].l++;
      lsSet(LS_REC, JSON.stringify(r));
    } else title = w.name + ' wins!';
    $('overTitle').textContent = title;
    let sub = reason;
    if (g.mode !== 'practice') {
      // phrase the reason from the winner's side when the loser gave it away
      if (/early|Scratched|Fouled/.test(reason)) sub = g.players[1 - winner].name + ' ' + reason.toLowerCase().replace(/^sank/, 'sank').replace(/^scratched/, 'scratched').replace(/^fouled/, 'fouled');
      else sub = (w.name === 'You' ? 'You' : w.name) + ' ' + reason.toLowerCase();
      if (g.mode === 'cpu') sub += ' · ' + S.level[0].toUpperCase() + S.level.slice(1);
    }
    $('overSub').textContent = sub;
    const rows = g.mode === 'practice' ? [g.players[0]] : g.players;
    $('overStats').innerHTML = '<span class="h"></span><span class="h n">Potted</span><span class="h n">Fouls</span>' +
      rows.map((p) => `<span>${p.name}</span><span class="n">${p.pots}</span><span class="n">${p.fouls}</span>`).join('');
    $('overIcon').innerHTML = good
      ? '<svg viewBox="0 0 72 72"><path d="M22 10h28v14a14 14 0 0 1-28 0z" fill="#ffb23f"/><path d="M22 14h-8a8 8 0 0 0 8 12M50 14h8a8 8 0 0 1-8 12" stroke="#ffb23f" stroke-width="4" fill="none"/><rect x="32" y="36" width="8" height="12" fill="#d98a14"/><rect x="22" y="48" width="28" height="8" rx="3" fill="#6e3f22"/><circle cx="36" cy="20" r="6" fill="#141414"/><circle cx="36" cy="20" r="3" fill="#f6f1e4"/></svg>'
      : '<svg viewBox="0 0 72 72"><circle cx="36" cy="36" r="26" fill="#141414"/><circle cx="36" cy="36" r="12" fill="#f6f1e4"/><text x="36" y="42" font-size="16" font-weight="900" text-anchor="middle" fill="#111" font-family="system-ui,sans-serif">8</text></svg>';
    setTimeout(() => showModal('over', true), 650);
    if (good) { Sound.win(); vib([20, 50, 20, 50, 40]); burst(); } else Sound.lose();
  }

  /* ---------------- CPU ---------------- */
  function startCpu() {
    const g = S.game;
    const out = {};
    const snapshot = { mode: g.mode, players: g.players.map((p) => ({ group: p.group })), turn: g.turn, isBreak: g.isBreak };
    S.cpu = {
      gen: AI.think(snapshot, RR.cloneSim(S.sim), S.level, { ballInHand: S.ballInHand || g.isBreak, kitchen: S.kitchen || g.isBreak }, out),
      out, t: 0, stage: 'think', token: S.token,
    };
  }
  function updateCpu(dt) {
    const c = S.cpu;
    if (!c || S.phase !== 'cpu') return;
    c.t += dt;
    if (c.stage === 'think') {
      const t0 = performance.now();
      let done = false;
      while (performance.now() - t0 < 7) {
        const r = c.gen.next();
        if (r.done) { done = true; break; }
      }
      if (done && c.t > 0.55) {
        const best = c.out.best || { angle: S.aim, power: 0.5, spinX: 0, spinY: 0 };
        c.shot = AI.addError(best, S.level);
        S.cpuLog.push({ level: S.level, planned: best.res ? (best.res.foul || 'legal') : 'break', score: Math.round(best.score || 0) });
        c.cueFrom = { x: S.sim.balls[0].x, y: S.sim.balls[0].y };
        c.cueTo = best.cue && (S.ballInHand || S.game.isBreak) ? best.cue : null;
        c.aimFrom = S.aim;
        c.stage = c.cueTo ? 'place' : 'aim';
        c.t = 0;
      }
    } else if (c.stage === 'place') {
      const k = easeInOut(clamp(c.t / 0.5, 0, 1));
      const cue = S.sim.balls[0];
      cue.x = lerp(c.cueFrom.x, c.cueTo.x, k); cue.y = lerp(c.cueFrom.y, c.cueTo.y, k);
      S.lastPos[0] = { x: cue.x, y: cue.y };
      if (c.t >= 0.5) { c.stage = 'aim'; c.t = 0; c.aimFrom = S.aim; }
    } else if (c.stage === 'aim') {
      const dur = 0.55;
      const k = easeInOut(clamp(c.t / dur, 0, 1));
      S.aim = c.aimFrom + angDiff(c.aimFrom, c.shot.angle) * k;
      S.spin = { x: c.shot.spinX * k, y: c.shot.spinY * k };
      if (c.t >= dur + 0.15) { c.stage = 'pull'; c.t = 0; }
    } else if (c.stage === 'pull') {
      const dur = 0.45;
      S.power = c.shot.power * easeInOut(clamp(c.t / dur, 0, 1));
      if (c.t >= dur + 0.12) {
        c.stage = 'done';
        S.cpu = null;
        takeShot(c.shot.angle, c.shot.power, c.shot.spinX, c.shot.spinY);
      }
    }
  }

  /* ---------------- physics events ---------------- */
  function handleEvents(ev) {
    for (const e of ev) {
      if (e.t === 'ball') Sound.clack(e.v);
      else if (e.t === 'cush') { if (e.kind === 'jaw' && e.v > 25) { Sound.clack(e.v * 0.5); } Sound.cushion(e.v); }
      else if (e.t === 'pocket') {
        Sound.pocket(e.v); vib(14);
        const pk = P.pockets[e.p];
        S.drops.push({ id: e.id, p: e.p, t: 0, x: e.x, y: e.y, tx: pk.cx, ty: pk.cy });
        updateHud();
      }
    }
  }

  /* ---------------- input ---------------- */
  function canControl() { return S.phase === 'aim' && !S.paused && S.game && !isCpuTurn(); }
  function role(x, y) {
    if (inRect(S.ui.powerHit, x, y)) return 'power';
    if (inRect(S.ui.wheelHit, x, y)) return 'wheel';
    if (S.ballInHand) {
      const c = S.sim.balls[0];
      const d = Math.hypot(x - sx(c.x), y - sy(c.y));
      if (d < Math.max(R * S.view.s * 3, 30)) return 'place';
    }
    return 'aim';
  }
  function onDown(e) {
    Sound.unlock();
    if (!canControl()) return;
    e.preventDefault();
    const r = role(e.clientX, e.clientY);
    for (const p of S.ptr.values()) if (p.role === r || (r === 'place' && p.role === 'aim') || (r === 'aim' && p.role === 'place')) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const p = { role: r, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), moved: false };
    if (r === 'place') { const c = S.sim.balls[0]; p.dx = sx(c.x) - e.clientX; p.dy = sy(c.y) - e.clientY; }
    S.ptr.set(e.pointerId, p);
    if (r === 'power') { S.power = 0; S.lastTick = 0; }
  }
  function onMove(e) {
    const p = S.ptr.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (!canControl()) { S.ptr.delete(e.pointerId); S.power = 0; return; }
    const px = p.x, py = p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(p.x - p.x0, p.y - p.y0) > 6) p.moved = true;
    const cue = S.sim.balls[0];
    if (p.role === 'aim' && p.moved) {
      const cx = sx(cue.x), cy = sy(cue.y);
      const a0 = Math.atan2(py - cy, px - cx), a1 = Math.atan2(p.y - cy, p.x - cx);
      const r = Math.hypot(p.x - cx, p.y - cy);
      // close to the cue ball the angle swings wildly; damp it
      const k = clamp(r / 70, 0.15, 1);
      S.aim += angDiff(a0, a1) * k;
    } else if (p.role === 'wheel') {
      const dy = p.y - py;
      S.aim += dy * 0.0011;
      S.wheelOff += dy;
      if (Math.floor(S.wheelOff / 8) !== Math.floor((S.wheelOff - dy) / 8)) Sound.tick();
    } else if (p.role === 'power') {
      const u = S.ui.power;
      S.power = clamp((p.y - p.y0) / (u.h * 0.78), 0, 1);
      const step = Math.floor(S.power * 10);
      if (step !== S.lastTick) { S.lastTick = step; Sound.tick(); }
    } else if (p.role === 'place') {
      const w = toWorld(p.x + p.dx, p.y + p.dy);
      const x = clamp(w.x, R, W - R), y = clamp(w.y, S.kitchen ? P.HEAD_Y : R, L - R);
      if (RR.canPlace(S.sim, x, y, S.kitchen)) {
        cue.x = x; cue.y = y;
        S.lastPos[0] = { x, y };
        S.placeBad = false;
      } else {
        // slide along: try each axis on its own
        if (RR.canPlace(S.sim, x, cue.y, S.kitchen)) cue.x = x;
        else if (RR.canPlace(S.sim, cue.x, y, S.kitchen)) cue.y = y;
        S.placeBad = true;
      }
      S.lastPos[0] = { x: cue.x, y: cue.y };
      if (S.game.isBreak) S.aim = Math.atan2(P.FOOT.y - cue.y, P.FOOT.x - cue.x);
    }
  }
  function onUp(e) {
    const p = S.ptr.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    S.ptr.delete(e.pointerId);
    S.placeBad = false;
    if (!canControl()) return;
    const cue = S.sim.balls[0];
    if (p.role === 'aim' && !p.moved && performance.now() - p.t0 < 350) {
      // tap: aim straight at the touched point (snaps to a ball if one is under the finger)
      const w = toWorld(p.x, p.y);
      let tx = w.x, ty = w.y;
      for (let i = 1; i < 16; i++) {
        const b = S.sim.balls[i];
        if (b.on && Math.hypot(b.x - w.x, b.y - w.y) < R * 1.8) { tx = b.x; ty = b.y; break; }
      }
      if (Math.hypot(tx - cue.x, ty - cue.y) > R) S.aim = Math.atan2(ty - cue.y, tx - cue.x);
    } else if (p.role === 'power') {
      const pw = S.power;
      if (pw > 0.03) takeShot(S.aim, pw, S.spin.x, S.spin.y);
      else S.power = 0;
    }
  }
  function onCancel(e) {
    const p = S.ptr.get(e.pointerId);
    if (!p) return;
    S.ptr.delete(e.pointerId);
    if (p.role === 'power') S.power = 0;
  }
  canvas.addEventListener('pointerdown', onDown, { passive: false });
  canvas.addEventListener('pointermove', onMove, { passive: false });
  canvas.addEventListener('pointerup', onUp, { passive: false });
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('lostpointercapture', onCancel);
  // desktop: mouse wheel = fine aim, arrow keys = nudge
  canvas.addEventListener('wheel', (e) => { if (!canControl()) return; e.preventDefault(); S.aim += Math.sign(e.deltaY) * 0.0035 * (e.shiftKey ? 0.25 : 1); }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (!canControl()) return;
    if (e.key === 'ArrowLeft') { S.aim -= e.shiftKey ? 0.001 : 0.006; e.preventDefault(); }
    if (e.key === 'ArrowRight') { S.aim += e.shiftKey ? 0.001 : 0.006; e.preventDefault(); }
  });

  // No scrolling, zooming or pull-to-refresh while playing.
  const blockTouch = (e) => { if (!e.target.closest || !e.target.closest('.card')) e.preventDefault(); };
  document.addEventListener('touchmove', blockTouch, { passive: false });
  document.addEventListener('touchstart', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend', 'dblclick', 'contextmenu'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));

  /* ---------------- spin picker ---------------- */
  function setSpin(x, y) {
    let m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; m = 1; }
    S.spin = { x, y };
    $('spinDotBig').style.transform = `translate(calc(-50% + ${x * 58}px), calc(-50% + ${-y * 58}px))`;
    updateHud();
  }
  (function spinPad() {
    const pad = $('spinPad');
    let active = false;
    const at = (e) => {
      const r = pad.querySelector('.spin-big').getBoundingClientRect();
      setSpin(((e.clientX - (r.left + r.width / 2)) / (r.width / 2)) / 0.72, (-(e.clientY - (r.top + r.height / 2)) / (r.height / 2)) / 0.72);
    };
    pad.addEventListener('pointerdown', (e) => { active = true; try { pad.setPointerCapture(e.pointerId); } catch (er) { /* */ } at(e); Sound.tick(); e.preventDefault(); });
    pad.addEventListener('pointermove', (e) => { if (active) at(e); });
    pad.addEventListener('pointerup', () => { active = false; });
    pad.addEventListener('pointercancel', () => { active = false; });
  })();

  /* ---------------- buttons ---------------- */
  const tap = (id, fn) => $(id).addEventListener('click', (e) => { e.preventDefault(); Sound.unlock(); Sound.click(); fn(); });
  function refreshMuteIcon() { $('icoSound').classList.toggle('hidden', Sound.muted); $('icoMute').classList.toggle('hidden', !Sound.muted); }
  function refreshSeg() { for (const b of $('diffSeg').querySelectorAll('button')) { b.classList.toggle('on', b.dataset.lv === S.level); b.setAttribute('aria-checked', b.dataset.lv === S.level); } }
  for (const b of $('diffSeg').querySelectorAll('button')) {
    b.addEventListener('click', (e) => { e.preventDefault(); Sound.unlock(); Sound.click(); S.level = b.dataset.lv; lsSet(LS_LEVEL, S.level); refreshSeg(); });
  }
  tap('muteBtn', () => { Sound.setMuted(!Sound.muted); lsSet(LS_MUTE, Sound.muted ? '1' : '0'); refreshMuteIcon(); });
  tap('menuBtn', () => {
    if (S.phase === 'title' || S.phase === 'over') return;
    $('menuSub').textContent = S.mode === 'cpu' ? 'vs CPU · ' + S.level[0].toUpperCase() + S.level.slice(1) : S.mode === 'pvp' ? 'Pass & play' : 'Practice';
    setPaused(true); showModal('menu', true);
  });
  tap('resumeBtn', () => { showModal('menu', false); setPaused(false); });
  tap('restartBtn', () => { showModal('menu', false); setPaused(false); newGame(S.mode, S.level, 0); });
  tap('quitBtn', () => { showModal('menu', false); goTitle(); });
  tap('howBtn', () => showModal('how', true));
  tap('howBtn2', () => { showModal('menu', false); showModal('how', true); S.howFromMenu = true; });
  tap('howClose', () => { showModal('how', false); if (S.howFromMenu) { S.howFromMenu = false; showModal('menu', true); } });
  tap('spinBtn', () => { if (!canControl()) return; setSpin(S.spin.x, S.spin.y); showModal('spin', true); });
  tap('spinReset', () => setSpin(0, 0));
  tap('spinDone', () => showModal('spin', false));
  $('spin').addEventListener('click', (e) => { if (e.target.id === 'spin') showModal('spin', false); });
  const start = (mode) => { showModal('title', false); setPaused(false); newGame(mode, S.level, 0); };
  tap('playCpuBtn', () => start('cpu'));
  tap('playPvpBtn', () => start('pvp'));
  tap('playPracBtn', () => start('practice'));
  tap('rematchBtn', () => { showModal('over', false); newGame(S.mode, S.level, 1 - S.firstBreaker); });
  tap('overMenu', () => { showModal('over', false); goTitle(); });

  function goTitle() {
    S.token++;
    S.phase = 'title'; S.cpu = null; setPaused(false);
    $('spinBtn').classList.add('hidden');
    $('recordLine').textContent = recordLine();
    refreshSeg();
    showModal('title', true);
    hint(null);
  }

  /* ---------------- visibility / resize ---------------- */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      Sound.suspend();
      S.ptr.clear(); S.power = 0;
      if (S.phase !== 'title' && S.phase !== 'over' && !S.paused) { setPaused(true); showModal('menu', true); }
    } else {
      Sound.resume();
      lastT = performance.now();
    }
  });
  let resizeT = 0;
  const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(layout, 60); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  /* ---------------- effects ---------------- */
  function burst() {
    const cols = ['#ffb23f', '#f4c21b', '#1d4fcf', '#d9262b', '#0f8a4b', '#ffffff'];
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 90;
      S.fx.push({ kind: 'conf', x: W / 2, y: L / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, t: 0, life: 1.6 + Math.random(), c: cols[i % cols.length], r: Math.random() * 6 });
    }
  }
  function updateFx(dt) {
    for (const f of S.fx) {
      f.t += dt;
      if (f.kind === 'conf') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 60 * dt; f.vx *= 0.99; f.r += dt * 8; }
    }
    S.fx = S.fx.filter((f) => f.t < f.life);
    for (const d of S.drops) d.t += dt;
    S.drops = S.drops.filter((d) => d.t < 0.45);
  }

  /* ---------------- render ---------------- */
  function render() {
    const v = S.view, c = ctx, dpr = v.dpr;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(tableCanvas, 0, 0);
    if (!S.game) { drawControls(c); return; }
    const balls = S.sim.balls;
    const X = (x) => (v.ox + x * v.s) * dpr, Y = (y) => (v.oy + y * v.s) * dpr;

    // pocket drops (under the rails' lip, clipped to the hole)
    for (const d of S.drops) {
      const pk = P.pockets[d.p];
      const k = clamp(d.t / 0.32, 0, 1), e = k * k;
      c.save();
      c.beginPath(); c.arc(X(pk.cx), Y(pk.cy), pk.r * v.s * dpr * 1.05, 0, Math.PI * 2);
      // include the mouth so the ball is visible as it crosses in
      c.moveTo(X(d.x) + R * v.s * dpr * 1.2, Y(d.y));
      c.arc(X(d.x), Y(d.y), R * v.s * dpr * 1.2, 0, Math.PI * 2);
      c.clip();
      c.globalAlpha = 1 - k * 0.55;
      art.draw(c, d.id, X(lerp(d.x, d.tx, e)), Y(lerp(d.y, d.ty, e)), 1 - k * 0.35);
      c.globalAlpha = 1;
      c.fillStyle = `rgba(0,0,0,${k * 0.6})`;
      c.beginPath(); c.arc(X(lerp(d.x, d.tx, e)), Y(lerp(d.y, d.ty, e)), R * v.s * dpr * (1 - k * 0.35), 0, Math.PI * 2); c.fill();
      c.restore();
    }

    // shadows then balls
    for (let i = 0; i < 16; i++) { const b = balls[i]; if (b.on) art.drawShadow(c, X(b.x), Y(b.y)); }
    for (let i = 0; i < 16; i++) { const b = balls[i]; if (b.on) art.draw(c, i, X(b.x), Y(b.y)); }

    const cue = balls[0];
    const showAim = cue.on && (S.phase === 'aim' || (S.phase === 'cpu' && S.cpu && S.cpu.stage !== 'think') || S.phase === 'strike');
    c.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.ox, dpr * v.oy);
    if (S.ballInHand && (S.phase === 'aim' || S.phase === 'cpu') && cue.on) drawBallInHand(c, cue);
    if (showAim && S.phase !== 'strike') drawAimGuide(c, cue);
    if (showAim) drawCue(c, cue);
    // confetti
    for (const f of S.fx) {
      if (f.kind !== 'conf') continue;
      c.save(); c.translate(f.x, f.y); c.rotate(f.r); c.globalAlpha = clamp(1 - f.t / f.life, 0, 1);
      c.fillStyle = f.c; c.fillRect(-1, -0.5, 2, 1); c.restore();
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    drawControls(c);
  }

  function drawBallInHand(c, cue) {
    const pulse = 0.5 + 0.5 * Math.sin(S.time * 5);
    c.save();
    if (S.kitchen) {
      c.fillStyle = 'rgba(255,255,255,0.05)';
      c.fillRect(0, P.HEAD_Y, W, L - P.HEAD_Y);
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 0.35; c.setLineDash([1.4, 1.2]);
      c.beginPath(); c.moveTo(0, P.HEAD_Y); c.lineTo(W, P.HEAD_Y); c.stroke(); c.setLineDash([]);
    }
    c.strokeStyle = S.placeBad ? 'rgba(255,90,80,0.9)' : `rgba(255,200,90,${0.55 + pulse * 0.4})`;
    c.lineWidth = 0.5;
    c.beginPath(); c.arc(cue.x, cue.y, R + 1.4 + pulse * 0.8, 0, Math.PI * 2); c.stroke();
    // four little arrows
    c.fillStyle = 'rgba(255,220,150,0.85)';
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2, r0 = R + 3.4 + pulse * 0.6;
      c.save(); c.translate(cue.x + Math.cos(a) * r0, cue.y + Math.sin(a) * r0); c.rotate(a);
      c.beginPath(); c.moveTo(1.1, 0); c.lineTo(-0.4, -0.9); c.lineTo(-0.4, 0.9); c.closePath(); c.fill();
      c.restore();
    }
    c.restore();
  }

  function dotted(c, x0, y0, x1, y1, gapU, rad, color) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    if (len < 0.01) return;
    c.fillStyle = color;
    const n = Math.floor(len / gapU);
    c.beginPath();
    for (let i = 0; i <= n; i++) {
      const t = (i * gapU) / len;
      const x = x0 + dx * t, y = y0 + dy * t;
      c.moveTo(x + rad, y); c.arc(x, y, rad, 0, Math.PI * 2);
    }
    c.fill();
  }

  function drawAimGuide(c, cue) {
    const a = S.aim, dx = Math.cos(a), dy = Math.sin(a);
    const rc = RR.rayCast(S.sim, cue.x, cue.y, a, 0);
    const lw = Math.max(0.28, 0.9 / S.view.s);
    c.save();
    c.lineCap = 'round';
    dotted(c, cue.x + dx * (R + 1.2), cue.y + dy * (R + 1.2), rc.gx - dx * R, rc.gy - dy * R, 2.1, Math.max(0.36, 0.8 / S.view.s), 'rgba(255,255,255,0.85)');
    if (rc.type === 'ball') {
      const tb = S.sim.balls[rc.id];
      const legal = S.game.isBreak || Rules.legalTargets(S.game, S.sim).includes(rc.id);
      // ghost ball
      c.strokeStyle = legal ? 'rgba(255,255,255,0.9)' : 'rgba(255,95,85,0.95)';
      c.lineWidth = lw;
      c.beginPath(); c.arc(rc.gx, rc.gy, R, 0, Math.PI * 2); c.stroke();
      if (!legal) {
        c.beginPath(); c.moveTo(rc.gx - R * 0.55, rc.gy - R * 0.55); c.lineTo(rc.gx + R * 0.55, rc.gy + R * 0.55);
        c.moveTo(rc.gx + R * 0.55, rc.gy - R * 0.55); c.lineTo(rc.gx - R * 0.55, rc.gy + R * 0.55); c.stroke();
      } else {
        let nx = tb.x - rc.gx, ny = tb.y - rc.gy;
        const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        const cosc = clamp(dx * nx + dy * ny, 0, 1);
        // object ball path
        const ol = 7 + 26 * cosc;
        c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = lw * 1.1;
        c.beginPath(); c.moveTo(tb.x + nx * R, tb.y + ny * R); c.lineTo(tb.x + nx * (R + ol), tb.y + ny * (R + ol)); c.stroke();
        // cue ball tangent path (bent a little by follow/draw)
        let tx = dx - nx * cosc, ty = dy - ny * cosc;
        const tl = Math.hypot(tx, ty);
        if (tl > 0.02) {
          tx /= tl; ty /= tl;
          const sp = S.spin.y;
          const bx = tx * (1 - Math.abs(sp) * 0.5) + nx * sp * 0.9, by = ty * (1 - Math.abs(sp) * 0.5) + ny * sp * 0.9;
          const bl = Math.hypot(bx, by) || 1;
          const cl = 5 + 14 * (1 - cosc);
          c.strokeStyle = 'rgba(190,230,255,0.75)'; c.lineWidth = lw;
          c.beginPath(); c.moveTo(rc.gx, rc.gy); c.lineTo(rc.gx + (bx / bl) * cl, rc.gy + (by / bl) * cl); c.stroke();
        }
      }
    } else {
      // rail: ghost at the cushion and a short bounce line
      c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = lw;
      c.beginPath(); c.arc(rc.gx, rc.gy, R, 0, Math.PI * 2); c.stroke();
      const vn = dx * rc.nx + dy * rc.ny;
      const rx = dx - 2 * vn * rc.nx, ry = dy - 2 * vn * rc.ny;
      dotted(c, rc.gx + rx * (R + 0.8), rc.gy + ry * (R + 0.8), rc.gx + rx * 18, rc.gy + ry * 18, 2.1, Math.max(0.3, 0.65 / S.view.s), 'rgba(255,255,255,0.45)');
    }
    c.restore();
  }

  function drawCue(c, cue) {
    let a = S.aim, pull;
    if (S.strike) {
      const k = clamp(S.strike.t / S.strike.dur, 0, 1);
      pull = S.strike.from * (1 - k * k) - 0.3;
      a = S.strike.angle;
    } else pull = 3 + S.power * 26;
    const dx = Math.cos(a), dy = Math.sin(a);
    const len = 150;
    const tipD = R + 0.5 + pull;
    c.save();
    c.translate(cue.x, cue.y);
    c.rotate(a + Math.PI); // +x now points from the ball back toward the butt
    // shadow
    c.save(); c.translate(1.4, 2.0);
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.beginPath(); c.moveTo(tipD, -0.55); c.lineTo(tipD + len, -1.45); c.lineTo(tipD + len, 1.45); c.lineTo(tipD, 0.55); c.closePath(); c.fill();
    c.restore();
    const seg = (x0, x1, w0, w1, fill) => {
      c.beginPath(); c.moveTo(tipD + x0, -w0); c.lineTo(tipD + x1, -w1); c.lineTo(tipD + x1, w1); c.lineTo(tipD + x0, w0); c.closePath();
      c.fillStyle = fill; c.fill();
    };
    const wAt = (x) => 0.55 + (x / len) * 0.9;
    const shaft = c.createLinearGradient(0, -1, 0, 1);
    shaft.addColorStop(0, '#f6e2b8'); shaft.addColorStop(0.45, '#e7c98e'); shaft.addColorStop(1, '#b8915a');
    const butt = c.createLinearGradient(0, -1.4, 0, 1.4);
    butt.addColorStop(0, '#5b2e1a'); butt.addColorStop(0.45, '#3a1a0d'); butt.addColorStop(1, '#1d0c05');
    const wrap = c.createLinearGradient(0, -1.3, 0, 1.3);
    wrap.addColorStop(0, '#3d4b59'); wrap.addColorStop(0.5, '#1a232c'); wrap.addColorStop(1, '#0b1015');
    seg(0, 0.8, 0.5, 0.52, '#3a7bd5');                 // chalked tip
    seg(0.8, 2.6, 0.52, 0.57, '#f3efe4');              // ferrule
    seg(2.6, 78, 0.57, wAt(78), shaft);                // maple shaft
    seg(78, 80, wAt(78), wAt(80), '#d9d2c0');          // joint ring
    seg(80, 95, wAt(80), wAt(95), butt);               // forearm
    seg(95, 98, wAt(95), wAt(98), '#ffb23f');          // accent ring
    seg(98, 130, wAt(98), wAt(130), wrap);             // wrap
    seg(130, len, wAt(130), wAt(len), butt);           // butt sleeve
    // shine
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 0.22;
    c.beginPath(); c.moveTo(tipD + 3, -0.3); c.lineTo(tipD + 76, -0.62); c.stroke();
    c.restore();
    void dx; void dy;
  }

  function rrect(c, x, y, w, h, r) { Rnd.roundRect(c, x, y, w, h, r); }

  function drawControls(c) {
    const dpr = S.view.dpr;
    const show = S.game && S.phase !== 'title';
    if (!show) return;
    const live = canControl();
    c.save();
    c.scale(dpr, dpr);
    // power column
    const u = S.ui.power;
    c.globalAlpha = live || S.phase === 'cpu' ? 1 : 0.55;
    rrect(c, u.x, u.y, u.w, u.h, Math.min(16, u.w / 2));
    c.fillStyle = 'rgba(5,14,22,0.9)'; c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 1; c.stroke();
    const pad = 6, tx = u.x + u.w / 2, ty = u.y + pad, th = u.h - pad * 2;
    // power fill from the top
    const pw = S.strike ? S.strike.power * (1 - clamp(S.strike.t / S.strike.dur, 0, 1)) : S.power;
    if (pw > 0) {
      const fh = th * 0.78 * pw;
      const g = c.createLinearGradient(0, ty, 0, ty + th * 0.78);
      g.addColorStop(0, '#5fe08a'); g.addColorStop(0.5, '#ffd34d'); g.addColorStop(1, '#ff5b4a');
      rrect(c, u.x + 4, ty, u.w - 8, fh, Math.min(10, (u.w - 8) / 2));
      c.fillStyle = g; c.globalAlpha *= 0.5; c.fill(); c.globalAlpha = live || S.phase === 'cpu' ? 1 : 0.55;
    }
    // ticks
    c.fillStyle = 'rgba(255,255,255,0.18)';
    for (let k = 1; k < 10; k++) c.fillRect(u.x + 5, ty + th * 0.78 * (k / 10), k % 5 === 0 ? 9 : 5, 1);
    // the cue, tip up, sliding down as you pull
    const off = th * 0.78 * pw;
    const cw = Math.max(5, u.w * 0.2);
    const cy0 = ty + 4 + off;
    const clen = th - 8;
    c.save();
    c.beginPath(); c.rect(u.x, u.y, u.w, u.h); c.clip();
    const sh = c.createLinearGradient(tx - cw / 2, 0, tx + cw / 2, 0);
    sh.addColorStop(0, '#b8915a'); sh.addColorStop(0.5, '#f6e2b8'); sh.addColorStop(1, '#a98450');
    c.fillStyle = '#3a7bd5'; c.fillRect(tx - cw * 0.32, cy0, cw * 0.64, 3);
    c.fillStyle = '#f3efe4'; c.fillRect(tx - cw * 0.34, cy0 + 3, cw * 0.68, 5);
    c.beginPath(); c.moveTo(tx - cw * 0.36, cy0 + 8); c.lineTo(tx + cw * 0.36, cy0 + 8); c.lineTo(tx + cw / 2, cy0 + clen * 0.6); c.lineTo(tx - cw / 2, cy0 + clen * 0.6); c.closePath();
    c.fillStyle = sh; c.fill();
    c.fillStyle = '#3a1a0d'; c.fillRect(tx - cw / 2, cy0 + clen * 0.6, cw, clen * 0.4 + th);
    c.fillStyle = '#ffb23f'; c.fillRect(tx - cw / 2, cy0 + clen * 0.6, cw, 3);
    c.restore();
    // pull hint arrow
    if (live && S.power === 0) {
      const bob = (Math.sin(S.time * 4) + 1) * 3;
      c.fillStyle = 'rgba(255,200,90,0.85)';
      const ay = u.y + u.h - 22 + bob;
      c.beginPath(); c.moveTo(tx - 7, ay); c.lineTo(tx + 7, ay); c.lineTo(tx, ay + 8); c.closePath(); c.fill();
    }
    if (pw > 0) {
      c.fillStyle = '#fff'; c.font = '800 11px ui-rounded, system-ui, sans-serif'; c.textAlign = 'center';
      c.fillText(Math.round(pw * 100) + '%', tx, u.y - 6);
    }
    // fine-aim wheel
    const w = S.ui.wheel;
    rrect(c, w.x - 3, w.y - 3, w.w + 6, w.h + 6, Math.min(14, w.w / 2));
    c.fillStyle = 'rgba(5,14,22,0.9)'; c.fill();
    rrect(c, w.x, w.y, w.w, w.h, Math.min(11, w.w / 2 - 2));
    const wg = c.createLinearGradient(0, w.y, 0, w.y + w.h);
    wg.addColorStop(0, '#1a232c'); wg.addColorStop(0.5, '#56636f'); wg.addColorStop(1, '#1a232c');
    c.fillStyle = wg; c.fill();
    c.save(); c.clip();
    const sp = 8, offs = ((S.wheelOff % sp) + sp) % sp;
    for (let y = w.y - sp + offs; y < w.y + w.h + sp; y += sp) {
      const k = (y - w.y) / w.h; // 0..1
      const curve = Math.sin(clamp(k, 0, 1) * Math.PI);
      c.fillStyle = `rgba(0,0,0,${0.35 + 0.25 * (1 - curve)})`;
      c.fillRect(w.x + 3, y, w.w - 6, 1.6 * (0.4 + curve * 0.6) + 0.6);
      c.fillStyle = `rgba(255,255,255,${0.1 + 0.18 * curve})`;
      c.fillRect(w.x + 3, y + 2, w.w - 6, 1);
    }
    c.restore();
    c.fillStyle = 'rgba(207,224,234,0.8)'; c.font = '800 9px ui-rounded, system-ui, sans-serif'; c.textAlign = 'center';
    c.fillText('FINE', w.x + w.w / 2, w.y + w.h + 15);
    c.restore();
  }

  /* ---------------- loop ---------------- */
  let lastT = performance.now(), acc = 0;
  const events = [];
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - lastT) / 1000; lastT = now;
    if (dt > 0.1) dt = 0.1; if (dt < 0) dt = 0;
    if (S.paused) { if (!S.drawnPaused) { render(); S.drawnPaused = true; } return; }
    S.drawnPaused = false;
    S.time += dt;
    Sound.frame();
    const p0 = performance.now();
    tick(dt);
    const p1 = performance.now();
    render();
    const p2 = performance.now();
    // rolling averages of main-thread cost, readable from the test hook
    S.perf.tick = S.perf.tick * 0.95 + (p1 - p0) * 0.05;
    S.perf.render = S.perf.render * 0.95 + (p2 - p1) * 0.05;
    S.perf.maxFrame = Math.max(S.perf.maxFrame * 0.995, p2 - p0);
  }
  function tick(dt) {
    if (S.phase === 'strike' && S.strike) {
      S.strike.t += dt;
      if (S.strike.t >= S.strike.dur) fireShot();
    }
    if (S.phase === 'moving') {
      acc += dt * (S.speed || 1);
      let n = 0;
      while (acc >= P.STEP && n < 40) { RR.step(S.sim, P.STEP, events); acc -= P.STEP; n++; }
      if (n >= 40) acc = 0;
      if (events.length) handleEvents(events.splice(0));
      rollBalls();
      if (!S.sim.moving && S.drops.length === 0) { acc = 0; endShot(); }
    } else rollBalls();
    if (S.phase === 'cpu') updateCpu(dt);
    updateFx(dt);
  }
  function rollBalls() {
    const balls = S.sim.balls;
    for (let i = 0; i < 16; i++) {
      const b = balls[i], lp = S.lastPos[i];
      if (!lp) { S.lastPos[i] = { x: b.x, y: b.y }; continue; }
      if (b.on && (b.x !== lp.x || b.y !== lp.y)) {
        art.roll(i, b.x - lp.x, b.y - lp.y);
        lp.x = b.x; lp.y = b.y;
      }
    }
  }

  /* ---------------- boot ---------------- */
  Sound.muted = lsGet(LS_MUTE) === '1';
  refreshMuteIcon();
  refreshSeg();
  $('recordLine').textContent = recordLine();
  layout();
  // show a racked table behind the title card
  RR.rack(S.sim);
  S.lastPos = S.sim.balls.map((b) => ({ x: b.x, y: b.y }));
  S.game = null;
  render();
  // the table is drawn behind the title: give render a game-less pass that still shows balls
  const params = new URLSearchParams(location.search);
  const qMode = params.get('mode');
  if (qMode === 'cpu' || qMode === 'pvp' || qMode === 'practice') {
    if (params.get('level')) S.level = params.get('level');
    showModal('title', false);
    newGame(qMode, S.level, 0);
  } else {
    // idle preview: a racked table under the title card
    S.game = { mode: 'preview', turn: 0, isBreak: true, players: [{ name: 'You', group: null }, { name: 'CPU', group: null }] };
    S.phase = 'title';
    $('spinBtn').classList.add('hidden');
    hint(null);
  }
  requestAnimationFrame((t) => { lastT = t; frame(t); });

  /* ---------------- test / debug hook ---------------- */
  // Lets automated tests set up positions and shots through the same code paths as play.
  window.RackRoll = {
    state: S,
    start(mode, level, breaker) { showModal('title', false); showModal('over', false); newGame(mode || 'cpu', level || S.level, breaker || 0); return S.phase; },
    // place balls: { cue:[x,y], 1:[x,y], ... }; every ball not listed is removed (counts as potted)
    setup(spec, opts) {
      opts = opts || {};
      for (let i = 0; i < 16; i++) {
        const b = S.sim.balls[i], p = i === 0 ? spec.cue : spec[i];
        b.vx = b.vy = b.wx = b.wy = b.sz = 0; b.moving = false;
        if (p) { b.x = p[0]; b.y = p[1]; b.on = true; b.pocket = -1; } else { b.on = false; b.pocket = 0; }
        S.lastPos[i] = { x: b.x, y: b.y };
      }
      const g = S.game;
      if (opts.groups) { g.players[0].group = opts.groups[0]; g.players[1].group = opts.groups[1]; }
      if (opts.turn !== undefined) g.turn = opts.turn;
      g.isBreak = !!opts.isBreak;
      S.ballInHand = !!opts.ballInHand; S.kitchen = false;
      S.drops = []; S.cpu = null; S.token++;
      art.resetOrientation();
      beginTurn(true);
      return S.phase;
    },
    aimAt(id, pocket) {
      const cue = S.sim.balls[0], b = S.sim.balls[id];
      if (pocket === undefined) return Math.atan2(b.y - cue.y, b.x - cue.x);
      const pk = P.pockets[pocket];
      const dx = pk.ax - b.x, dy = pk.ay - b.y, d = Math.hypot(dx, dy);
      const gx = b.x - (dx / d) * D, gy = b.y - (dy / d) * D;
      return Math.atan2(gy - cue.y, gx - cue.x);
    },
    shoot(angle, power, spinX, spinY) {
      if (S.phase !== 'aim') return false;
      return takeShot(angle, power, spinX || 0, spinY || 0);
    },
    // simulate instantly to rest and run end-of-shot rules
    settle() {
      if (S.phase === 'strike') fireShot();
      if (S.phase !== 'moving') return S.phase;
      const ev = [];
      while (S.sim.moving) { RR.step(S.sim, P.STEP, ev); }
      handleEvents(ev);
      rollBalls();
      S.drops = [];
      endShot();
      return S.phase;
    },
    placeCue(x, y) { if (!S.ballInHand || !RR.canPlace(S.sim, x, y, S.kitchen)) return false; const c = S.sim.balls[0]; c.x = x; c.y = y; S.lastPos[0] = { x, y }; return true; },
    info() {
      const g = S.game;
      return {
        phase: S.phase, mode: g && g.mode, turn: g && g.turn, isBreak: g && g.isBreak,
        groups: g && g.players.map((p) => p.group), ballInHand: S.ballInHand, kitchen: S.kitchen,
        on: S.sim.balls.filter((b) => b.on).map((b) => b.id), lastShot: S.sim.shot,
        over: $('over').classList.contains('show') || S.phase === 'over', overTitle: $('overTitle').textContent,
        stats: g && g.players.map((p) => ({ name: p.name, pots: p.pots, fouls: p.fouls, shots: p.shots })),
        cpuLog: S.cpuLog.slice(-20),
      };
    },
    setSpeed(x) { S.speed = x; },
    // hand the table to a player as-is (no shot), e.g. to let the CPU keep shooting in tests
    forceTurn(n) { if (S.phase !== 'aim' && S.phase !== 'wait') return false; S.game.turn = n; S.ballInHand = false; S.token++; beginTurn(true); return true; },
    layout,
  };
})();
