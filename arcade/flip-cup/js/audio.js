// Tiny synthesized sound effects (no files).
const Sfx = (() => {
  let ctx = null, muted = localStorage.getItem('flipcup.muted') === '1';
  function ac() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type = 'sine', vol = 0.25, slide = 0, delay = 0) {
    const c = ac(); if (!c || muted) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol = 0.2, hp = 800, delay = 0) {
    const c = ac(); if (!c || muted) return;
    const t = c.currentTime + delay;
    const len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'bandpass'; f.frequency.value = hp; f.Q.value = 0.8;
    g.gain.value = vol; s.buffer = buf;
    s.connect(f).connect(g).connect(c.destination); s.start(t);
  }
  return {
    unlock() { ac(); },
    get muted() { return muted; },
    toggle() { muted = !muted; localStorage.setItem('flipcup.muted', muted ? '1' : '0'); return muted; },
    whoosh(p) { noise(0.28, 0.18 + p * 0.2, 500 + p * 900); },
    clack() { tone(180, 0.08, 'triangle', 0.35, -60); noise(0.05, 0.25, 2200); },
    thud() { tone(110, 0.14, 'sine', 0.4, -50); noise(0.08, 0.2, 400); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.22, 0, i * 0.07)); },
    bigwin() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.22, 'square', 0.12, 0, i * 0.08)); },
    fail() { tone(300, 0.3, 'sawtooth', 0.12, -180); },
    arm() { tone(880, 0.06, 'sine', 0.12); },
  };
})();
