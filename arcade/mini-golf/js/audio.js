/* Pocket Putt — tiny WebAudio sound kit, every sound synthesised in code. */
(function (G) {
  'use strict';
  const MG = (G.MG = G.MG || {});
  let ctx = null, master = null, noiseBuf = null, lastClink = 0;
  const S = {
    muted: false,
    unlock() {
      try {
        if (!ctx) {
          const AC = G.AudioContext || G.webkitAudioContext;
          if (!AC) return;
          ctx = new AC();
          master = ctx.createGain();
          master.gain.value = S.muted ? 0 : 0.8;
          master.connect(ctx.destination);
          noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
          const d = noiseBuf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended') ctx.resume();
      } catch (e) { /* audio unavailable */ }
    },
    setMuted(m) {
      S.muted = m;
      if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.02);
    },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
  };

  function ok() { return ctx && !S.muted && ctx.state === 'running'; }
  function tone(freq, dur, type, vol, freqEnd, delay) {
    const t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, type, freq, q, delay) {
    const t = ctx.currentTime + (delay || 0);
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq || 1000; f.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  S.putt = (p) => { if (!ok()) return; noise(0.05, 0.25 + p * 0.3, 'highpass', 2500, 0.7); tone(900 + p * 500, 0.06, 'triangle', 0.25, 500); };
  S.clink = (speed) => {
    if (!ok()) return;
    const now = ctx.currentTime;
    if (now - lastClink < 0.05 || speed < 30) return;
    lastClink = now;
    const v = Math.min(0.35, 0.05 + speed / 2200);
    tone(1500 + Math.random() * 300, 0.07, 'triangle', v, 1100);
    noise(0.04, v * 0.7, 'bandpass', 3000, 2);
  };
  S.bumper = () => { if (!ok()) return; tone(520, 0.12, 'square', 0.12, 780); tone(780, 0.1, 'sine', 0.15, 1040, 0.03); };
  S.mover = () => { if (!ok()) return; tone(260, 0.1, 'triangle', 0.25, 160); noise(0.06, 0.2, 'lowpass', 800, 1); };
  S.lip = () => { if (!ok()) return; tone(700, 0.05, 'triangle', 0.18, 450); tone(500, 0.06, 'triangle', 0.14, 300, 0.05); };
  S.plop = () => {
    if (!ok()) return;
    tone(420, 0.16, 'sine', 0.5, 110);
    noise(0.12, 0.25, 'lowpass', 600, 1);
    tone(1300, 0.05, 'triangle', 0.12, 900, 0.1);
    tone(1100, 0.05, 'triangle', 0.08, 800, 0.17);
  };
  S.cheer = (good) => {
    if (!ok()) return;
    const notes = good ? [523, 659, 784, 1046] : [523, 659];
    notes.forEach((f, i) => tone(f, 0.18, 'triangle', 0.16, null, 0.18 + i * 0.09));
  };
  S.splash = () => { if (!ok()) return; noise(0.45, 0.4, 'lowpass', 1400, 0.8); noise(0.25, 0.25, 'bandpass', 3500, 1.5, 0.05); tone(300, 0.2, 'sine', 0.2, 90); };
  S.tick = () => { if (!ok()) return; tone(1800, 0.02, 'square', 0.04); };

  MG.Sound = S;
})(typeof window !== 'undefined' ? window : globalThis);
