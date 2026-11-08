/* Rack & Roll — every sound is synthesised with WebAudio, no files. */
(function (G) {
  'use strict';
  const RR = (G.RR = G.RR || {});
  let ctx = null, master = null, noiseBuf = null;
  let lastClack = 0, lastCush = 0, clacksThisFrame = 0;
  const S = {
    muted: false,
    unlock() {
      try {
        if (!ctx) {
          const AC = G.AudioContext || G.webkitAudioContext;
          if (!AC) return;
          ctx = new AC();
          master = ctx.createGain();
          master.gain.value = S.muted ? 0 : 0.85;
          const comp = ctx.createDynamicsCompressor();
          comp.threshold.value = -14; comp.ratio.value = 4;
          master.connect(comp); comp.connect(ctx.destination);
          noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.8), ctx.sampleRate);
          const d = noiseBuf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended') ctx.resume();
      } catch (e) { /* audio unavailable */ }
    },
    setMuted(m) {
      S.muted = m;
      if (master) master.gain.setTargetAtTime(m ? 0 : 0.85, ctx.currentTime, 0.02);
    },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
    frame() { clacksThisFrame = 0; },
  };

  const ok = () => ctx && !S.muted && ctx.state === 'running';
  function tone(freq, dur, type, vol, freqEnd, delay) {
    const t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, type, freq, q, delay) {
    const t = ctx.currentTime + (delay || 0);
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq || 1000; f.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.3); src.stop(t + dur + 0.02);
  }

  // cue tip on ball: dull leather tock
  S.strike = (p) => {
    if (!ok()) return;
    noise(0.05, 0.25 + p * 0.45, 'bandpass', 1800 + p * 900, 1.2);
    tone(420 + p * 160, 0.07, 'triangle', 0.2 + p * 0.25, 220);
    tone(95, 0.09, 'sine', 0.15 + p * 0.2, 60);
  };
  // ball on ball: the bright phenolic clack
  S.clack = (v) => {
    if (!ok() || v < 6) return;
    const now = ctx.currentTime;
    if (clacksThisFrame > 3 || now - lastClack < 0.012) return;
    lastClack = now; clacksThisFrame++;
    const a = Math.min(0.7, 0.04 + v / 380);
    const f = 2600 + Math.random() * 700;
    tone(f, 0.035, 'sine', a * 0.9, f * 0.92);
    tone(f * 1.52, 0.022, 'sine', a * 0.45);
    noise(0.025, a * 0.9, 'bandpass', 4200, 1.4);
  };
  // ball into rubber cushion: soft thump
  S.cushion = (v) => {
    if (!ok() || v < 10) return;
    const now = ctx.currentTime;
    if (now - lastCush < 0.025) return;
    lastCush = now;
    const a = Math.min(0.55, 0.05 + v / 450);
    tone(150, 0.11, 'sine', a, 70);
    noise(0.06, a * 0.6, 'lowpass', 700, 0.8);
  };
  // pocket: drop, then a couple of rolling knocks in the return
  S.pocket = (v) => {
    if (!ok()) return;
    const a = Math.min(0.6, 0.25 + (v || 0) / 600);
    tone(260, 0.12, 'triangle', a * 0.6, 140);
    noise(0.12, a * 0.55, 'lowpass', 900, 1);
    tone(180, 0.08, 'sine', a * 0.5, 120, 0.13);
    tone(150, 0.07, 'sine', a * 0.35, 110, 0.24);
    noise(0.25, a * 0.25, 'bandpass', 500, 1.5, 0.12);
  };
  S.foul = () => { if (!ok()) return; tone(220, 0.22, 'sawtooth', 0.08, 140); tone(165, 0.3, 'sawtooth', 0.07, 100, 0.12); };
  S.good = () => { if (!ok()) return; tone(784, 0.1, 'triangle', 0.12); tone(1047, 0.14, 'triangle', 0.12, null, 0.07); };
  S.turn = () => { if (!ok()) return; tone(660, 0.07, 'sine', 0.08); tone(880, 0.09, 'sine', 0.07, null, 0.06); };
  S.win = () => { if (!ok()) return; [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, 'triangle', 0.14, null, i * 0.1)); };
  S.lose = () => { if (!ok()) return; [392, 330, 262].forEach((f, i) => tone(f, 0.28, 'triangle', 0.12, null, i * 0.16)); };
  S.tick = () => { if (!ok()) return; tone(2100, 0.015, 'square', 0.025); };
  S.click = () => { if (!ok()) return; tone(1300, 0.03, 'triangle', 0.08, 900); };

  RR.Sound = S;
})(typeof window !== 'undefined' ? window : globalThis);
