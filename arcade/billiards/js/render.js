/* Rack & Roll — drawing: the table (cached), and rolling 3D-looking balls.
   Each ball keeps a 3x3 orientation matrix. Its sprite is painted per pixel
   (stripe band, number disc, cue-ball dots) only when the ball has turned,
   then the number is drawn on the disc with an affine map so it foreshortens
   as it rolls over the top. Shading and the highlight are a shared overlay. */
(function (root) {
  'use strict';
  const RR = (root.RR = root.RR || {});
  const P = RR.PHYS;
  const { W, L, R } = P;
  const RAIL = 9.5;            // total rail width beyond the cushion noses (world units)

  const COLORS = {
    1: '#f4c21b', 2: '#1d4fcf', 3: '#d9262b', 4: '#5a2b8c', 5: '#f2761c', 6: '#0f8a4b', 7: '#8b1d22', 8: '#141414',
  };
  const IVORY = [246, 241, 228];
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const RGB = {};
  for (let i = 1; i <= 15; i++) RGB[i] = hex(COLORS[i > 8 ? i - 8 : i]);

  function hash01(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  /* ---------------- table ---------------- */
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  function drawTable(c) {
    const C = P.CUSH;
    // drop shadow under the whole table
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = 14; c.shadowOffsetY = 5;
    roundRect(c, -RAIL, -RAIL, W + RAIL * 2, L + RAIL * 2, 5.5);
    c.fillStyle = '#3a2214'; c.fill();
    c.restore();

    // wood rails
    const wood = c.createLinearGradient(-RAIL, 0, W + RAIL, 0);
    wood.addColorStop(0, '#4b2a17'); wood.addColorStop(0.08, '#6e3f22'); wood.addColorStop(0.5, '#7a4727');
    wood.addColorStop(0.92, '#6e3f22'); wood.addColorStop(1, '#4b2a17');
    roundRect(c, -RAIL, -RAIL, W + RAIL * 2, L + RAIL * 2, 5.5);
    c.fillStyle = wood; c.fill();
    // wood grain
    c.save();
    roundRect(c, -RAIL, -RAIL, W + RAIL * 2, L + RAIL * 2, 5.5); c.clip();
    c.lineWidth = 0.35;
    for (let i = 0; i < 70; i++) {
      const y = -RAIL + hash01(i) * (L + RAIL * 2);
      c.strokeStyle = `rgba(30,12,4,${0.08 + hash01(i + 40) * 0.12})`;
      c.beginPath(); c.moveTo(-RAIL, y);
      c.bezierCurveTo(W * 0.3, y + (hash01(i + 7) - 0.5) * 6, W * 0.7, y + (hash01(i + 9) - 0.5) * 6, W + RAIL, y + (hash01(i + 3) - 0.5) * 4);
      c.stroke();
    }
    c.restore();
    // bevel highlight on the outer edge
    roundRect(c, -RAIL + 0.4, -RAIL + 0.4, W + RAIL * 2 - 0.8, L + RAIL * 2 - 0.8, 5.2);
    c.strokeStyle = 'rgba(255,214,170,0.22)'; c.lineWidth = 0.7; c.stroke();

    // felt bed (extends under the cushions)
    const fx = -C, fy = -C, fw = W + C * 2, fh = L + C * 2;
    const felt = c.createRadialGradient(W / 2, L / 2, 10, W / 2, L / 2, L * 0.62);
    felt.addColorStop(0, '#1f8f86'); felt.addColorStop(0.65, '#177a72'); felt.addColorStop(1, '#0f5e58');
    c.fillStyle = felt; c.fillRect(fx, fy, fw, fh);
    // cloth nap speckle
    c.save(); c.beginPath(); c.rect(fx, fy, fw, fh); c.clip();
    for (let i = 0; i < 900; i++) {
      c.fillStyle = hash01(i * 3) > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)';
      c.fillRect(fx + hash01(i) * fw, fy + hash01(i + 5000) * fh, 0.45, 0.45);
    }
    c.restore();

    // markings: head string, spots
    c.save();
    c.strokeStyle = 'rgba(255,255,255,0.13)'; c.lineWidth = 0.35; c.setLineDash([1.6, 1.6]);
    c.beginPath(); c.moveTo(0, P.HEAD_Y); c.lineTo(W, P.HEAD_Y); c.stroke();
    c.setLineDash([]);
    c.fillStyle = 'rgba(255,255,255,0.22)';
    for (const s of [P.FOOT, P.HEAD]) { c.beginPath(); c.arc(s.x, s.y, 0.75, 0, Math.PI * 2); c.fill(); }
    c.restore();

    // pockets: leather liner on the wood, then the hole
    for (const pk of P.pockets) {
      const g = c.createRadialGradient(pk.cx, pk.cy, pk.r * 0.6, pk.cx, pk.cy, pk.r + 2.2);
      g.addColorStop(0, '#1a120c'); g.addColorStop(1, '#2b1d14');
      c.beginPath(); c.arc(pk.cx, pk.cy, pk.r + 2.2, 0, Math.PI * 2); c.fillStyle = g; c.fill();
    }
    // felt in the pocket mouths (between the jaws) so the cloth runs into the hole
    for (const pk of P.pockets) {
      const [a1, b1, a2, b2] = pk.jaws;
      c.beginPath(); c.moveTo(a1.x, a1.y); c.lineTo(b1.x, b1.y); c.lineTo(b2.x, b2.y); c.lineTo(a2.x, a2.y); c.closePath();
      c.fillStyle = '#145f59'; c.fill();
    }
    for (const pk of P.pockets) {
      const g = c.createRadialGradient(pk.cx - pk.r * 0.2, pk.cy - pk.r * 0.25, 0.5, pk.cx, pk.cy, pk.r);
      g.addColorStop(0, '#000'); g.addColorStop(0.75, '#060404'); g.addColorStop(1, '#1d1611');
      c.beginPath(); c.arc(pk.cx, pk.cy, pk.r, 0, Math.PI * 2); c.fillStyle = g; c.fill();
    }

    // cushions (rubber with cloth)
    for (const poly of P.cushionPolys) {
      c.beginPath(); c.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) c.lineTo(poly[i].x, poly[i].y);
      c.closePath();
      c.fillStyle = '#12665f'; c.fill();
      // shading toward the nose
      c.save(); c.clip();
      const n0 = poly[0], n1 = poly[1], b0 = poly[3];
      const gx = c.createLinearGradient(n0.x, n0.y, b0.x + (n1.x - n1.x), b0.y);
      gx.addColorStop(0, 'rgba(255,255,255,0.10)'); gx.addColorStop(0.35, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,0.28)');
      c.fillStyle = gx; c.fill();
      c.restore();
      // nose line
      c.beginPath(); c.moveTo(n0.x, n0.y); c.lineTo(n1.x, n1.y);
      c.strokeStyle = 'rgba(0,30,26,0.55)'; c.lineWidth = 0.45; c.stroke();
    }
    // inner shadow where cushion meets wood
    c.save();
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 0.6;
    c.strokeRect(-C, -C, W + C * 2, L + C * 2);
    c.restore();

    // sights (diamonds) on the rails
    const mid = C + (RAIL - C) / 2;
    const sights = [];
    for (const f of [0.25, 0.5, 0.75]) { sights.push([W * f, -mid]); sights.push([W * f, L + mid]); }
    for (const f of [0.125, 0.25, 0.375, 0.625, 0.75, 0.875]) { sights.push([-mid, L * f]); sights.push([W + mid, L * f]); }
    for (const [x, y] of sights) {
      c.save(); c.translate(x, y); c.rotate(Math.PI / 4);
      c.fillStyle = '#efe6cf'; c.fillRect(-0.85, -0.85, 1.7, 1.7);
      c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillRect(-0.85, -0.85, 1.7, 0.5);
      c.restore();
    }
  }

  /* ---------------- balls ---------------- */
  function mat3() { return new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]); }
  function rotate(M, ax, ay, az, ang) {
    // M = Rot(axis, ang) * M  (Rodrigues)
    const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    const r00 = t * ax * ax + c, r01 = t * ax * ay - s * az, r02 = t * ax * az + s * ay;
    const r10 = t * ax * ay + s * az, r11 = t * ay * ay + c, r12 = t * ay * az - s * ax;
    const r20 = t * ax * az - s * ay, r21 = t * ay * az + s * ax, r22 = t * az * az + c;
    for (let col = 0; col < 3; col++) {
      const m0 = M[col], m1 = M[3 + col], m2 = M[6 + col];
      M[col] = r00 * m0 + r01 * m1 + r02 * m2;
      M[3 + col] = r10 * m0 + r11 * m1 + r12 * m2;
      M[6 + col] = r20 * m0 + r21 * m1 + r22 * m2;
    }
  }
  function orthonormalize(M) {
    // Gram-Schmidt on columns
    let x0 = M[0], x1 = M[3], x2 = M[6];
    let n = Math.hypot(x0, x1, x2); x0 /= n; x1 /= n; x2 /= n;
    let y0 = M[1], y1 = M[4], y2 = M[7];
    const d = x0 * y0 + x1 * y1 + x2 * y2;
    y0 -= d * x0; y1 -= d * x1; y2 -= d * x2;
    n = Math.hypot(y0, y1, y2); y0 /= n; y1 /= n; y2 /= n;
    const z0 = x1 * y2 - x2 * y1, z1 = x2 * y0 - x0 * y2, z2 = x0 * y1 - x1 * y0;
    M[0] = x0; M[3] = x1; M[6] = x2; M[1] = y0; M[4] = y1; M[7] = y2; M[2] = z0; M[5] = z1; M[8] = z2;
  }
  // number disc facing the viewer, text upright, with a little random tilt
  function faceUp(M, jitter) {
    M.set([0, -1, 0, 0, 0, -1, 1, 0, 0]);
    // columns: localX -> (0,0,1) viewer; localY -> (-1,0,0); localZ -> (0,-1,0)
    if (jitter) {
      rotate(M, 0, 0, 1, (Math.random() - 0.5) * 0.9);
      rotate(M, Math.random() - 0.5, Math.random() - 0.5, 0, (Math.random() - 0.5) * 0.5);
      orthonormalize(M);
    }
  }

  class BallArt {
    constructor() {
      this.rot = []; this.sprites = []; this.dirty = []; this.imgs = []; this.rp = 0;
      for (let i = 0; i < 16; i++) {
        this.rot.push(mat3()); faceUp(this.rot[i], true);
        const cv = document.createElement('canvas');
        this.sprites.push(cv); this.dirty.push(true);
      }
      this.shade = document.createElement('canvas');
      this.shadow = document.createElement('canvas');
    }
    resetOrientation() { for (let i = 0; i < 16; i++) { faceUp(this.rot[i], true); this.dirty[i] = true; } }
    setRadius(rp) {
      if (Math.abs(rp - this.rp) < 0.01) return;
      this.rp = rp;
      const size = Math.ceil(rp * 2) + 2;
      for (let i = 0; i < 16; i++) { this.sprites[i].width = this.sprites[i].height = size; this.dirty[i] = true; }
      this.buildShade(size);
    }
    roll(i, dx, dy) {
      const d = Math.hypot(dx, dy);
      if (d < 1e-4) return;
      const M = this.rot[i];
      rotate(M, -dy / d, dx / d, 0, d / R);
      if (Math.random() < 0.05) orthonormalize(M);
      this.dirty[i] = true;
    }
    buildShade(size) {
      const rp = this.rp, c0 = size / 2;
      this.shade.width = this.shade.height = size;
      const c = this.shade.getContext('2d');
      c.clearRect(0, 0, size, size);
      c.save();
      c.beginPath(); c.arc(c0, c0, rp, 0, Math.PI * 2); c.clip();
      let g = c.createRadialGradient(c0 - rp * 0.28, c0 - rp * 0.32, rp * 0.1, c0, c0, rp * 1.02);
      g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(0.55, 'rgba(0,0,0,0)');
      g.addColorStop(0.85, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
      c.fillStyle = g; c.fillRect(0, 0, size, size);
      // bounce light from the cloth
      g = c.createRadialGradient(c0 + rp * 0.4, c0 + rp * 0.5, 0, c0 + rp * 0.4, c0 + rp * 0.5, rp * 0.6);
      g.addColorStop(0, 'rgba(120,255,230,0.14)'); g.addColorStop(1, 'rgba(120,255,230,0)');
      c.fillStyle = g; c.fillRect(0, 0, size, size);
      // specular highlight
      g = c.createRadialGradient(c0 - rp * 0.34, c0 - rp * 0.4, 0, c0 - rp * 0.34, c0 - rp * 0.4, rp * 0.42);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, size, size);
      c.restore();
      // soft contact shadow
      const ss = Math.ceil(rp * 3.2);
      this.shadow.width = this.shadow.height = ss;
      const s = this.shadow.getContext('2d');
      g = s.createRadialGradient(ss / 2, ss / 2, rp * 0.4, ss / 2, ss / 2, ss / 2);
      g.addColorStop(0, 'rgba(0,10,8,0.5)'); g.addColorStop(0.6, 'rgba(0,10,8,0.22)'); g.addColorStop(1, 'rgba(0,10,8,0)');
      s.fillStyle = g; s.fillRect(0, 0, ss, ss);
    }
    paint(i) {
      const cv = this.sprites[i], size = cv.width, rp = this.rp, c0 = size / 2;
      const c = cv.getContext('2d');
      // reuse the pixel buffer: pixels outside the disc are never written, so they stay clear
      let img = this.imgs[i];
      if (!img || img.width !== size) img = this.imgs[i] = c.createImageData(size, size);
      const d = img.data;
      const M = this.rot[i];
      const base = i === 0 ? IVORY : RGB[i];
      const stripe = i > 8;
      const cue = i === 0;
      const inv = 1 / rp, aa = 1.6 / rp; // anti-alias width in normalised units
      const SPOT = 0.865, BAND = 0.5;
      for (let y = 0; y < size; y++) {
        const ny = (y + 0.5 - c0) * inv;
        for (let x = 0; x < size; x++) {
          const nx = (x + 0.5 - c0) * inv;
          const r2 = nx * nx + ny * ny;
          if (r2 > 1.08) continue;
          const r = Math.sqrt(r2);
          const alpha = Math.max(0, Math.min(1, (1 - r) * rp + 0.5));
          if (alpha <= 0) continue;
          const nz = r2 < 1 ? Math.sqrt(1 - r2) : 0;
          const lx = M[0] * nx + M[3] * ny + M[6] * nz;
          const ly = M[1] * nx + M[4] * ny + M[7] * nz;
          const lz = M[2] * nx + M[5] * ny + M[8] * nz;
          let cr = base[0], cg = base[1], cb = base[2];
          if (cue) {
            // small red registration dots so you can see it roll
            const m = Math.max(Math.abs(lx), Math.abs(ly));
            const t = Math.max(0, Math.min(1, (m - 0.955) / aa + 0.5));
            cr += (200 - cr) * t; cg += (40 - cg) * t; cb += (45 - cb) * t;
          } else {
            let w = 0; // weight of ivory
            if (stripe) w = Math.max(0, Math.min(1, (Math.abs(lz) - BAND) / aa + 0.5));
            const sp = Math.max(0, Math.min(1, (Math.abs(lx) - SPOT) / aa + 0.5));
            w = Math.max(w, sp);
            cr += (IVORY[0] - cr) * w; cg += (IVORY[1] - cg) * w; cb += (IVORY[2] - cb) * w;
          }
          // gentle diffuse term so the sprite has form even before the overlay
          const lum = 0.78 + 0.22 * (nz * 0.8 - nx * 0.3 - ny * 0.35);
          const k = (y * size + x) * 4;
          d[k] = cr * lum; d[k + 1] = cg * lum; d[k + 2] = cb * lum; d[k + 3] = alpha * 255;
        }
      }
      c.putImageData(img, 0, 0);
      if (!cue) {
        // the number, drawn on each visible disc with an affine (orthographic) map
        c.save();
        c.beginPath(); c.arc(c0, c0, rp, 0, Math.PI * 2); c.clip();
        c.fillStyle = '#121212';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        const label = String(i);
        const fs = label.length > 1 ? 9.2 : 10.5;
        c.font = `800 ${fs}px ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif`;
        for (const sgn of [1, -1]) {
          const ez = M[6] * sgn;
          if (ez < 0.18) continue;
          const ex = M[0] * sgn, ey = M[3] * sgn;
          const k = rp / 17;
          const rx = -M[1] * sgn, ry = -M[4] * sgn;   // text right
          const dx = -M[2], dy = -M[5];               // text down
          c.setTransform(rx * k, ry * k, dx * k, dy * k, c0 + ex * rp, c0 + ey * rp);
          c.fillText(label, 0, 0.6);
        }
        c.restore();
      }
      this.dirty[i] = false;
    }
    // draw ball i centred at device-pixel coords (x,y)
    draw(ctx, i, x, y, scale) {
      if (this.dirty[i]) this.paint(i);
      const cv = this.sprites[i], size = cv.width;
      const s = scale || 1;
      ctx.drawImage(cv, x - (size / 2) * s, y - (size / 2) * s, size * s, size * s);
      ctx.drawImage(this.shade, x - (size / 2) * s, y - (size / 2) * s, size * s, size * s);
    }
    drawShadow(ctx, x, y) {
      const ss = this.shadow.width, rp = this.rp;
      ctx.drawImage(this.shadow, x - ss / 2 + rp * 0.28, y - ss / 2 + rp * 0.42);
    }
  }

  // A small flat icon of ball i (for the HUD), as a data URL.
  function ballIconURL(i, px) {
    const cv = document.createElement('canvas');
    const dpr = Math.min(3, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
    const size = Math.round(px * dpr);
    cv.width = cv.height = size;
    const c = cv.getContext('2d');
    const r = size / 2 - 0.5;
    c.save();
    c.beginPath(); c.arc(size / 2, size / 2, r, 0, Math.PI * 2); c.clip();
    c.fillStyle = i > 8 ? '#f6f1e4' : COLORS[i] || '#f6f1e4'; c.fillRect(0, 0, size, size);
    if (i > 8) { c.fillStyle = COLORS[i - 8]; c.fillRect(0, size * 0.24, size, size * 0.52); }
    c.fillStyle = '#f6f1e4'; c.beginPath(); c.arc(size / 2, size / 2, r * 0.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#111'; c.font = `800 ${Math.round(r * (i > 9 ? 0.62 : 0.72))}px ui-rounded, system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(i), size / 2, size / 2 + r * 0.04);
    const g = c.createRadialGradient(size * 0.35, size * 0.3, 0, size / 2, size / 2, r);
    g.addColorStop(0, 'rgba(255,255,255,0.45)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
    c.fillStyle = g; c.fillRect(0, 0, size, size);
    c.restore();
    return cv.toDataURL();
  }

  RR.Render = { RAIL, COLORS, drawTable, BallArt, ballIconURL, roundRect };
})(typeof window !== 'undefined' ? window : globalThis);
