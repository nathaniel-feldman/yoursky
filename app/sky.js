// Particle rendering: sand planets, the solar system, and sand effects.
// Everything is Canvas 2D with grains batched by brightness level to keep fill-style changes low.
(function () {
  'use strict';
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const motion = { reduced: mq.matches };
  if (mq.addEventListener) mq.addEventListener('change', (e) => (motion.reduced = e.matches));
  const DPR = () => Math.min(window.devicePixelRatio || 1, 2);
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (dt, rate) => 1 - Math.exp(-dt * rate);

  function rng(seed) {
    let a = seed >>> 0 || 1;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  // Turn a school color into a gentle metal tint (multipliers around 1).
  function tintFromHex(hex) {
    const n = parseInt(hex, 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const avg = (c[0] + c[1] + c[2]) / 3 || 1;
    return c.map((v) => clamp(1 + (v / avg - 1) * 0.5, 0.6, 1.5));
  }

  // ---- Metal palettes ----------------------------------------------------
  const LEVELS = 16;
  const STOPS = [[0, [20, 22, 26]], [0.22, [62, 66, 74]], [0.45, [128, 133, 143]], [0.7, [192, 196, 205]], [0.92, [236, 238, 243]], [1.2, [255, 255, 255]]];
  function metal(b) {
    for (let i = 1; i < STOPS.length; i++) {
      if (b <= STOPS[i][0]) {
        const [b0, c0] = STOPS[i - 1], [b1, c1] = STOPS[i], t = (b - b0) / (b1 - b0);
        return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
      }
    }
    return [255, 255, 255];
  }
  function paletteColors(tint, alpha) {
    const out = [];
    for (let i = 0; i < LEVELS; i++) {
      const b = (i / (LEVELS - 1)) * 1.2, c = metal(b);
      const k = 1 - clamp((b - 0.8) / 0.4, 0, 1);
      const r = clamp(c[0] * (1 + (tint[0] - 1) * k * 1.7), 0, 255) | 0;
      const g = clamp(c[1] * (1 + (tint[1] - 1) * k * 1.7), 0, 255) | 0;
      const bl = clamp(c[2] * (1 + (tint[2] - 1) * k * 1.7), 0, 255) | 0;
      out.push(`rgba(${r},${g},${bl},${alpha})`);
    }
    return out;
  }

  class Painter {
    constructor() { this.pals = {}; }
    palette(key, tint, alpha = 1) {
      const colors = paletteColors(tint, alpha);
      if (!this.pals[key]) this.pals[key] = colors.map((c) => ({ c, x: new Float32Array(256), y: new Float32Array(256), s: new Float32Array(256), n: 0 }));
      else this.pals[key].forEach((bk, i) => (bk.c = colors[i]));
    }
    add(key, b, x, y, s) {
      const lv = b <= 0 ? 0 : b >= 1.2 ? LEVELS - 1 : ((b / 1.2) * (LEVELS - 1)) | 0;
      const bk = this.pals[key][lv];
      if (bk.n >= bk.x.length) {
        const grow = (a) => { const n = new Float32Array(a.length * 2); n.set(a); return n; };
        bk.x = grow(bk.x); bk.y = grow(bk.y); bk.s = grow(bk.s);
      }
      bk.x[bk.n] = x; bk.y[bk.n] = y; bk.s[bk.n] = s; bk.n++;
    }
    flush(ctx) {
      for (const key in this.pals) {
        for (const bk of this.pals[key]) {
          if (!bk.n) continue;
          ctx.fillStyle = bk.c;
          for (let i = 0; i < bk.n; i++) { const s = bk.s[i]; ctx.fillRect(bk.x[i] - s * 0.5, bk.y[i] - s * 0.5, s, s); }
          bk.n = 0;
        }
      }
    }
  }

  function spherePoints(n, rand) {
    const p = new Float32Array(n * 3), ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - ((i + 0.5) / n) * 2, r = Math.sqrt(1 - y * y), th = i * ga + rand() * 0.5;
      p[i * 3] = Math.cos(th) * r; p[i * 3 + 1] = y + (rand() - 0.5) * 0.015; p[i * 3 + 2] = Math.sin(th) * r;
    }
    return p;
  }

  // Sunflower points filling a unit disc, with sphere z for shading (no crowding at the rim).
  function discPoints(n, rand) {
    const p = new Float32Array(n * 3), ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const r = Math.min(0.995, Math.sqrt((i + 0.5) / n) + (rand() - 0.5) * 0.04), th = i * ga + (rand() - 0.5) * 0.3;
      p[i * 3] = Math.cos(th) * r; p[i * 3 + 1] = Math.sin(th) * r; p[i * 3 + 2] = Math.sqrt(1 - r * r);
    }
    return p;
  }

  // Shade a grain: normal (nx,ny,nz), light (lx,ly,lz) normalized, half-vector (hx,hy,hz).
  function shade(nx, ny, nz, lx, ly, lz, hx, hy, hz, shine) {
    const d = nx * lx + ny * ly + nz * lz;
    const diff = d > 0 ? d : 0;
    let sp = nx * hx + ny * hy + nz * hz;
    sp = sp > 0 ? sp * sp : 0; sp *= sp; sp *= sp; sp *= sp; // ^16
    const rim = (1 - nz) * (1 - nz) * 0.18;
    return 0.07 + diff * 0.62 + sp * shine + rim;
  }

  // ---- Planet (the student) ---------------------------------------------
  class Planet {
    constructor(seed = 7, grains = 1500) {
      const r = rng(seed);
      this.n = grains;
      this.pts = spherePoints(grains, r);
      this.jit = new Float32Array(grains * 2);
      this.gsz = new Float32Array(grains);
      this.keep = new Float32Array(grains);
      this.lat = new Float32Array(grains);
      this.lon = new Float32Array(grains);
      for (let i = 0; i < grains; i++) {
        const a = r() * TAU, m = Math.sqrt(r());
        this.jit[i * 2] = Math.cos(a) * m; this.jit[i * 2 + 1] = Math.sin(a) * m;
        this.gsz[i] = 0.8 + r() * 0.55;
        this.keep[i] = r() * 0.6;
        this.lat[i] = Math.asin(this.pts[i * 3 + 1]);
        this.lon[i] = Math.atan2(this.pts[i * 3 + 2], this.pts[i * 3]);
      }
      this.ringN = 760; this.ring = new Float32Array(this.ringN * 4);
      for (let i = 0; i < this.ringN; i++) {
        const g = (r() + r() + r()) / 3;
        this.ring[i * 4] = r() * TAU; this.ring[i * 4 + 1] = 1.42 + g * 0.75; this.ring[i * 4 + 2] = (r() - 0.5) * 0.04; this.ring[i * 4 + 3] = r();
      }
      this.haloN = 420; this.halo = new Float32Array(this.haloN * 4);
      for (let i = 0; i < this.haloN; i++) {
        this.halo[i * 4] = Math.acos(r() * 2 - 1); this.halo[i * 4 + 1] = r() * TAU; this.halo[i * 4 + 2] = 1.12 + Math.pow(r(), 1.6) * 0.95; this.halo[i * 4 + 3] = 0.05 + r() * 0.2;
      }
      this.moonPts = spherePoints(110, r);
      this.nameStr = ''; this.nameN = 0; this.namePts = new Float32Array(0);
      this.sweep = 2; this.oldTint = [1, 1, 1];
      this.p = { scale: 1, nameAmt: 0, bands: 0, bandAmp: 0, warp: 0, sA: 0, sB: 0, ring: 0, ringScatter: 0, halo: 0, moonR: 0, moonVis: 0, light: -40, tint: [1, 1, 1], sunness: 0 };
      this.t = JSON.parse(JSON.stringify(this.p));
      this.disturb = 0; this.ripples = []; this.pulses = []; this.spin = 0; this.time = 0; this.moonA = 0;
      this.palKey = 'p' + seed;
    }
    set(k, v) { if (k === 'tint') this.setTint(v); else this.t[k] = v; }
    // A new metal sweeps across the planet as a bright front instead of fading or scattering.
    setTint(t) {
      if (this.t.tint.every((v, i) => Math.abs(v - t[i]) < 1e-3)) return;
      this.oldTint = this.p.tint.slice(); this.t.tint = t.slice(); this.p.tint = t.slice();
      this.sweep = motion.reduced ? 2 : 0;
    }
    // The student's name, written in bright sand across the face of the planet.
    setName(name) {
      name = (name || '').trim();
      if (name === this.nameStr) return;
      this.nameStr = name;
      if (!name) { this.t.nameAmt = 0; return; }
      const c = document.createElement('canvas'); c.width = 600; c.height = 200;
      const g = c.getContext('2d');
      let fs = 150; g.font = `italic 400 ${fs}px "Instrument Serif", Georgia, serif`;
      const w = g.measureText(name).width;
      if (w > 540) { fs *= 540 / w; g.font = `italic 400 ${fs}px "Instrument Serif", Georgia, serif`; }
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, 300, 100);
      const img = g.getImageData(0, 0, 600, 200).data, pts = [];
      for (let y = 0; y < 200; y += 2) for (let x = 0; x < 600; x += 2) if (img[(y * 600 + x) * 4 + 3] > 120) pts.push((x - 300) / 300, (y - 100) / 300);
      const n = pts.length / 2, idx = [...Array(n).keys()];
      for (let i = n - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [idx[i], idx[j]] = [idx[j], idx[i]]; }
      const N = Math.min(n, 2600), out = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) { out[i * 2] = pts[idx[i] * 2]; out[i * 2 + 1] = pts[idx[i] * 2 + 1]; }
      this.namePts = out; this.nameN = N; this.p.nameAmt = 0; this.t.nameAmt = 1;
    }
    pulse() { if (!motion.reduced && this.pulses.length < 3) this.pulses.push({ t: 0 }); }
    kick(a = 0.6) { if (!motion.reduced) this.disturb = Math.min(1, this.disturb + a); }
    ripple() {
      if (motion.reduced || this.ripples.length > 4) return;
      const a = Math.random() * TAU, m = Math.random() * 0.6;
      const ox = Math.cos(a) * m, oy = Math.sin(a) * m;
      this.ripples.push({ t: 0, ox, oy, oz: Math.sqrt(Math.max(0, 1 - ox * ox - oy * oy)) });
    }
    update(dt) {
      const k = motion.reduced ? 1 : ease(dt, 4);
      for (const key of ['scale', 'nameAmt', 'bands', 'bandAmp', 'warp', 'sA', 'sB', 'ring', 'ringScatter', 'halo', 'moonR', 'moonVis', 'sunness']) this.p[key] = lerp(this.p[key], this.t[key], k);
      let dA = ((this.t.light - this.p.light + 540) % 360) - 180;
      this.p.light += dA * k;
      if (this.sweep < 2) this.sweep += dt / 1.1;
      this.disturb *= Math.exp(-dt * 2.2);
      this.ripples.forEach((r) => (r.t += dt));
      this.ripples = this.ripples.filter((r) => r.t < 1.5);
      this.pulses.forEach((p) => (p.t += dt));
      this.pulses = this.pulses.filter((p) => p.t < 1.2);
      if (!motion.reduced) { this.spin += dt * 0.16; this.moonA += dt * lerp(0.9, 0.35, clamp((this.p.moonR - 1.2) / 1.4, 0, 1)); }
      this.time += dt;
    }
    // Draw at (cx, cy) with radius R (device px).
    draw(painter, ctx, cx, cy, R, dpr) {
      const P = this.p, key = this.palKey;
      R *= P.scale;
      painter.palette(key, P.tint, 1);
      painter.palette(key + 'd', P.tint, 0.45);
      const sweeping = this.sweep < 1, edge = -2.6 + Math.min(1, this.sweep) * 5.2, keyO = key + 'o';
      if (sweeping) painter.palette(keyO, this.oldTint, 1);
      // Which palette a point uses during a sweep, and a glint along the front.
      const sw = (xr, yr) => { const q = xr * 0.8 + yr * 0.6 - edge; return q > 0 ? 1 : q > -0.09 ? 2 : 0; };
      const sun = P.sunness;
      const la = (P.light * Math.PI) / 180, lxy = lerp(0.78, 0.3, sun);
      let lx = Math.cos(la) * lxy, ly = Math.sin(la) * lxy, lz = lerp(0.55, 0.95, sun);
      const ln = Math.hypot(lx, ly, lz); lx /= ln; ly /= ln; lz /= ln;
      let hx = lx, hy = ly, hz = lz + 1; const hn = Math.hypot(hx, hy, hz); hx /= hn; hy /= hn; hz /= hn;
      const cs = Math.cos(this.spin), sn = Math.sin(this.spin), tilt = 0.38, ct = Math.cos(tilt), st = Math.sin(tilt);
      const gs = dpr * (R > 80 * dpr ? 1.7 : R > 30 * dpr ? 1.35 : 1.1);
      const step = (R < 14 * dpr ? 3 : R < 28 * dpr ? 2 : 1) + (quality.level < 0.8 ? 1 : 0);
      const shine = lerp(0.95, 0.5, sun);
      const ringCount = (P.ring * this.ringN) | 0, haloCount = (P.halo * this.haloN) | 0;
      const ringTilt = 0.3, rct = Math.cos(ringTilt), rst = Math.sin(ringTilt);

      // Back layers: halo and ring behind the planet.
      const drawRing = (front) => {
        for (let i = 0; i < ringCount; i += step) {
          const a = this.ring[i * 4] + this.spin * 0.6, rr = this.ring[i * 4 + 1];
          let x = Math.cos(a) * rr, z = Math.sin(a) * rr, y = this.ring[i * 4 + 2];
          const y2 = y * rct - z * rst, z2 = y * rst + z * rct;
          if ((z2 > 0) !== front) continue;
          const sc = P.ringScatter * (0.5 + this.ring[i * 4 + 3]) * 1.4;
          const sx = cx + (x + Math.cos(a * 7.3 + i) * sc) * R, sy = cy + (y2 + Math.sin(a * 5.1 + i) * sc) * R;
          const shadow = !front && Math.hypot(x, y2) < 1 ? 0.3 : 1;
          const st2 = sweeping ? sw(x, y2) : 0;
          painter.add(st2 === 1 ? keyO : key, (0.35 + 0.55 * this.ring[i * 4 + 3] + (front ? 0.15 : 0)) * shadow * (1 - P.ringScatter * 0.5) + (st2 === 2 ? 0.6 : 0), sx, sy, gs * 0.9);
        }
      };
      const drawHalo = (front) => {
        for (let i = 0; i < haloCount; i += step) {
          const th = this.halo[i * 4], ph = this.halo[i * 4 + 1] + this.time * this.halo[i * 4 + 3], hr = this.halo[i * 4 + 2];
          const x = Math.sin(th) * Math.cos(ph) * hr, z = Math.sin(th) * Math.sin(ph) * hr, y = Math.cos(th) * hr;
          if ((z > 0) !== front) continue;
          if (!front && x * x + y * y < 1) continue;
          painter.add(key + 'd', 0.5 + (front ? 0.35 : 0), cx + x * R, cy + y * R, gs * 0.8);
        }
      };
      const moonX = Math.cos(this.moonA) * P.moonR, moonZ = Math.sin(this.moonA), moonY = Math.sin(this.moonA) * P.moonR * 0.32 - P.moonR * 0.12;
      const drawMoon = () => {
        if (P.moonVis < 0.05) return;
        const mr = 0.17 * P.moonVis, mcx = cx + moonX * R, mcy = cy + moonY * R;
        for (let i = 0; i < 110; i++) {
          const x = this.moonPts[i * 3], y = this.moonPts[i * 3 + 1], z = this.moonPts[i * 3 + 2];
          if (z < 0) continue;
          const st3 = sweeping ? sw(moonX + x * mr, moonY + y * mr) : 0;
          painter.add(st3 === 1 ? keyO : key, shade(x, y, z, lx, ly, lz, hx, hy, hz, 0.8) + (st3 === 2 ? 0.6 : 0), mcx + x * mr * R, mcy + y * mr * R, gs * 0.9);
        }
      };

      drawHalo(false); drawRing(false);
      if (moonZ < 0) drawMoon();
      painter.flush(ctx);

      let flash = 0;
      for (const pl of this.pulses) flash += Math.exp(-pl.t * 5) * 0.35;
      const bands = P.bands, bAmp = P.bandAmp, warp = P.warp, sA = P.sA, sB = P.sB;
      const dist = this.disturb * R * 0.85;
      for (let i = 0; i < this.n; i += step) {
        const px = this.pts[i * 3], py = this.pts[i * 3 + 1], pz = this.pts[i * 3 + 2];
        const x1 = px * cs + pz * sn, z1 = -px * sn + pz * cs;
        const y2 = py * ct - z1 * st, z2 = py * st + z1 * ct;
        if (z2 < this.keep[i]) continue;
        let b = shade(x1, y2, z2, lx, ly, lz, hx, hy, hz, shine) * (1 - P.nameAmt * (Math.abs(y2) < 0.2 ? 0.45 : 0.15)) + flash;
        if (bAmp > 0.01) {
          const lon = this.lon[i];
          const band = 0.5 + 0.5 * Math.sin(this.lat[i] * bands * 2.2 + warp * (Math.sin(lon * 2 + sA) * 0.8 + Math.sin(lon * 5 + sB) * 0.35));
          b *= 1 - bAmp * 0.78 * (1 - band);
          b += bAmp * 0.1 * band;
        }
        let sx = cx + x1 * R, sy = cy + y2 * R;
        if (dist > 0.3) { sx += this.jit[i * 2] * dist * this.gsz[i]; sy += this.jit[i * 2 + 1] * dist * this.gsz[i]; }
        for (const rp of this.ripples) {
          const d = clamp(x1 * rp.ox + y2 * rp.oy + z2 * rp.oz, -1, 1);
          const ang = Math.acos(d), front = rp.t * 2.4, w = (ang - front) / 0.25;
          const amp = 0.08 * (1 - rp.t / 1.5) * Math.exp(-w * w);
          sx += x1 * amp * R; sy += y2 * amp * R; b += amp * 3;
        }
        if (sweeping) { const st = sw(x1, y2); painter.add(st === 1 ? keyO : key, st === 2 ? b + 0.7 : b, sx, sy, gs * this.gsz[i]); }
        else painter.add(key, b, sx, sy, gs * this.gsz[i]);
      }
      if (P.nameAmt > 0.02 && R > 34 * dpr && this.nameN) {
        const count = (Math.pow(P.nameAmt, 1.4) * this.nameN) | 0;
        for (let i = 0; i < count; i++) {
          const X = Math.sin(this.namePts[i * 2] * 0.9 * 1.1) / 1.1, Y = this.namePts[i * 2 + 1] * 0.9;
          let sx = cx + X * R, sy = cy + Y * R;
          if (dist > 0.3) { sx += this.jit[(i % this.n) * 2] * dist; sy += this.jit[(i % this.n) * 2 + 1] * dist; }
          painter.add(key, 1.15, sx, sy, dpr * 1.1);
        }
      }
      painter.flush(ctx);
      drawRing(true); drawHalo(true);
      if (moonZ >= 0) drawMoon();
      for (const pl of this.pulses) {
        const u = pl.t / 1.2, rr = R * (1.05 + u * 1.9), a = 1 - u;
        for (let i = 0; i < 140; i++) {
          const ang = (i / 140) * TAU + Math.sin(i * 3.7) * 0.02, jit = Math.sin(i * 12.9 + pl.t * 8) * 2 * dpr;
          painter.add(a > 0.5 ? key : key + 'd', 0.6 + a * 0.6, cx + Math.cos(ang) * (rr + jit), cy + Math.sin(ang) * (rr + jit) * 0.9, gs * (0.6 + a * 0.6));
        }
      }
      painter.flush(ctx);
    }
  }

  // ---- Sky: the solar system ------------------------------------------
  const glowCache = {};
  function glowSprite(size) {
    const k = Math.max(8, Math.round(size / 8) * 8);
    if (glowCache[k]) return glowCache[k];
    const c = document.createElement('canvas'); c.width = c.height = k * 2;
    const g = c.getContext('2d'), gr = g.createRadialGradient(k, k, 0, k, k, k);
    gr.addColorStop(0, 'rgba(235,238,245,0.22)'); gr.addColorStop(0.35, 'rgba(200,205,215,0.08)'); gr.addColorStop(1, 'rgba(200,205,215,0)');
    g.fillStyle = gr; g.fillRect(0, 0, k * 2, k * 2);
    return (glowCache[k] = c);
  }

  class Body {
    constructor(s) {
      const r = rng(s.id);
      this.s = s; this.id = s.id;
      this.angle = r() * TAU; this.r = 1.15 + r() * 0.2; this.rT = this.r; this.belt = 1.06 + r() * 0.22;
      this.mass = 0; this.massT = 0; this.alpha = 0; this.alphaT = 1;
      this.sizeF = clamp((Math.log10(s.size || 2000) - 3) / 1.6, 0, 1);
      this.nMax = (44 + this.sizeF * 80) | 0;
      this.pts = discPoints(this.nMax, r);
      this.spin = r() * TAU; this.spinV = 0.2 + r() * 0.4;
      this.disturb = 0; this.home = 0; this.homeT = 0; this.homeX = 0;
      this.labA = 0; this.labOn = 0; this.labSpot = -1; this.labHold = 0;
      this.fit = 0; this.label = false; this.sx = 0; this.sy = 0; this.sr = 0; this.depth = 0;
    }
  }

  class Sky {
    constructor(canvas, opts = {}) {
      this.c = canvas; this.ctx = canvas.getContext('2d');
      this.painter = new Painter();
      this.painter.palette('silver', [1, 1, 1], 1);
      this.painter.palette('dust', [1, 1, 1], 0.5);
      this.painter.palette('hi', [1.02, 1.02, 1.05], 1);
      this.bodies = new Map();
      this.sun = opts.sun || null; this.friendSun = null;
      this.view = { sx: 0.5, sy: 0.5, sr: 40, orbit: 1, orbitAlpha: 1, labels: 5, tilt: 0.46, ox: 0.5, oy: 0.5, spread: 1, binary: 0, pscale: 1, dim: 0 };
      this.cur = Object.assign({}, this.view);
      this.ambient = opts.ambient ? this.makeAmbient(140) : null;
      this.selected = null; this.sunText = ''; this.friendText = ''; this.colorize = false;
      this.visible = true; this.w = 0; this.h = 0;
      this.resize();
    }
    makeAmbient(n) {
      const r = rng(99), a = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { a[i * 4] = r(); a[i * 4 + 1] = r(); a[i * 4 + 2] = 0.2 + r() * 0.8; a[i * 4 + 3] = r(); }
      return a;
    }
    resize() {
      const d = DPR(), w = this.c.clientWidth, h = this.c.clientHeight;
      if (!w || !h) return;
      this.c.width = Math.round(w * d); this.c.height = Math.round(h * d);
      this.w = w; this.h = h; this.dpr = d;
    }
    setSchools(list) {
      for (const s of list) if (!this.bodies.has(s.id)) this.bodies.set(s.id, new Body(s));
    }
    // fits: [{id, fit}] sorted any order. opts.focus: how many become planets; opts.only: restrict to these ids.
    setFits(fits, opts = {}) {
      const focus = opts.focus || 36, only = opts.only ? new Set(opts.only) : null;
      const sorted = fits.filter((f) => !only || only.has(f.id)).sort((a, b) => b.fit - a.fit);
      const top = sorted.slice(0, focus);
      const hi = top.length ? top[0].fit : 100, lo = top.length ? top[top.length - 1].fit : 0;
      const span = Math.max(8, hi - lo);
      const inTop = new Map(top.map((f, i) => [f.id, i]));
      for (const b of this.bodies.values()) {
        const f = fits.find((x) => x.id === b.id);
        b.fit = f ? f.fit : 0;
        if (only && !only.has(b.id)) { b.massT = 0; b.alphaT = 0; b.label = false; continue; }
        b.alphaT = 1;
        const idx = inTop.get(b.id);
        let rT;
        if (idx != null) {
          const norm = (hi - b.fit) / span, rank = top.length > 1 ? idx / (top.length - 1) : 0;
          rT = 0.2 + (norm * 0.55 + rank * 0.45) * 0.76; b.massT = 1; b.label = idx < (opts.labels ?? this.view.labels);
        } else { rT = b.belt; b.massT = 0; b.label = false; }
        b.rT = rT;
        if (opts.homes) b.homeT = opts.homes.get(b.id) ?? 0;
      }
    }
    setView(v) { Object.assign(this.view, v); }
    snap() { Object.assign(this.cur, this.view); for (const b of this.bodies.values()) { b.r = b.rT; b.mass = b.massT; b.alpha = b.alphaT; b.homeX = b.homeT; } }
    // Name written across a sun, sized to fit inside it.
    sunWord(text, x, y, R) {
      if (!text || R < 12 * this.dpr) return;
      const ctx = this.ctx, d = this.dpr;
      let fs = Math.min(R * 0.62, 30 * d);
      ctx.font = `italic 400 ${fs}px "Instrument Serif", Georgia, serif`;
      const w = ctx.measureText(text).width;
      if (w > R * 1.7) { fs *= (R * 1.7) / w; ctx.font = `italic 400 ${fs}px "Instrument Serif", Georgia, serif`; }
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 6 * d;
      ctx.fillStyle = `rgba(255,255,255,${0.95 * Math.min(1, this.cur.orbitAlpha + 0.2)})`;
      ctx.fillText(text, x, y + fs * 0.04);
      ctx.restore();
    }
    pick(x, y) {
      let best = null, bd = 1e9;
      for (const b of this.bodies.values()) {
        if (b.mass < 0.5 || b.alpha < 0.5) continue;
        const d = Math.hypot(b.sx - x, b.sy - y);
        if (d < Math.max(22, b.sr + 14) && d < bd) { bd = d; best = b; }
      }
      return best;
    }
    frame(dt) {
      if (!this.visible || !this.w) return;
      const ctx = this.ctx, d = this.dpr, W = this.c.width, H = this.c.height, V = this.view, C = this.cur;
      const k = motion.reduced ? 1 : ease(dt, 3);
      for (const key in V) C[key] = typeof V[key] === 'number' ? lerp(C[key], V[key], k) : V[key];
      ctx.clearRect(0, 0, W, H);
      const P = this.painter;

      if (this.ambient) {
        const a = this.ambient, t = performance.now() / 1000;
        for (let i = 0; i < a.length / 4; i++) {
          const x = ((a[i * 4] + (motion.reduced ? 0 : t * 0.004 * a[i * 4 + 2])) % 1) * W;
          const y = ((a[i * 4 + 1] + Math.sin(t * 0.2 + i) * 0.003) % 1) * H;
          P.add('dust', 0.35 + a[i * 4 + 3] * 0.6, x, y, d * (0.8 + a[i * 4 + 2] * 0.8));
        }
        P.flush(ctx);
      }

      const RX = Math.min(W * 0.47, (H * 0.46) / C.tilt) * C.orbit, RY = RX * C.tilt;
      const scx = C.sx * W, scy = C.sy * H, sr = C.sr * d;
      const ocx = C.ox * W, ocy = C.oy * H;
      const centers = [
        [ocx - C.binary * RX * 0.55, ocy], [ocx + C.binary * RX * 0.55, ocy], [ocx, ocy],
      ];
      const unit = Math.min(W, H) / 100;

      // Orbit guides: engraved ellipses.
      if (C.orbitAlpha > 0.02 && C.binary < 0.5 && C.dim < 0.5) {
        for (const g of [0.2, 0.48, 0.72, 0.96]) {
          ctx.beginPath(); ctx.ellipse(ocx, ocy + d, g * RX, g * RY, 0, 0, TAU);
          ctx.strokeStyle = `rgba(0,0,0,${0.35 * C.orbitAlpha})`; ctx.lineWidth = d; ctx.stroke();
          ctx.beginPath(); ctx.ellipse(ocx, ocy, g * RX, g * RY, 0, 0, TAU);
          ctx.strokeStyle = `rgba(220,225,235,${0.075 * C.orbitAlpha})`; ctx.stroke();
        }
      }

      const back = [], front = [];
      for (const b of this.bodies.values()) {
        const prevR = b.r;
        b.r = lerp(b.r, b.rT, motion.reduced ? 1 : ease(dt, 1.6));
        const vel = Math.abs(b.r - prevR) / Math.max(dt, 1e-3);
        b.disturb += ((motion.reduced ? 0 : Math.min(0.3, vel * 1.1)) - b.disturb) * ease(dt, 4);
        b.mass = lerp(b.mass, b.massT, motion.reduced ? 1 : ease(dt, 2.2));
        b.alpha = lerp(b.alpha, b.alphaT, motion.reduced ? 1 : ease(dt, 3));
        b.homeX = lerp(b.homeX, b.homeT, motion.reduced ? 1 : ease(dt, 2));
        if (b.alpha < 0.02) { b.sr = 0; continue; }
        if (!motion.reduced) { b.angle += dt * (0.05 / Math.pow(b.r + 0.25, 1.5)) * C.spread; b.spin += dt * b.spinV; }
        const hc = centers[Math.round(b.homeX)] || centers[0];
        const hcx = lerp(centers[0][0], hc[0], 1), hcy = hc[1];
        const shrink = C.binary > 0.5 && Math.round(b.homeX) !== 2 ? 0.5 : 1;
        const sa = Math.sin(b.angle);
        b.sx = (hcx + Math.cos(b.angle) * b.r * RX * shrink) / d;
        b.sy = (hcy + sa * b.r * RY * shrink) / d;
        b.depth = sa;
        (sa < 0 ? back : front).push(b);
      }
      const drawBodies = (list) => {
        for (const b of list) {
          const persp = 1 + b.depth * 0.14;
          const R = (1.1 + b.mass * (1.6 + b.sizeF * 2.4)) * unit * 0.55 * persp * (0.75 + 0.25 * C.orbit) * C.pscale;
          const x = b.sx * d, y = b.sy * d;
          b.sr = R / d;
          if (b.mass < 0.08) { P.add('dust', (0.6 * b.alpha + 0.2) * (1 - 0.6 * C.dim), x, y, d * 1.2); continue; }
          const n = Math.max(3, (b.nMax * b.mass * quality.level) | 0);
          let lx = ocx - x, ly = (ocy - y) / C.tilt, lz = 0.45 * Math.hypot(lx, ly) / (RX * 0.5 + 1) + 0.25;
          const ln = Math.hypot(lx, ly, lz) || 1; lx /= ln; ly /= ln; lz /= ln;
          let hx = lx, hy = ly, hz = lz + 1; const hn = Math.hypot(hx, hy, hz); hx /= hn; hy /= hn; hz /= hn;
          let pal = b === this.selected ? 'hi' : 'silver';
          if (pal === 'silver' && this.colorize && b.s.col) { pal = 'c' + b.id; if (!P.pals[pal]) P.palette(pal, tintFromHex(b.s.col), 1); }
          const disp = b.disturb * R * 2.2;
          for (let i = 0; i < n; i++) {
            const x1 = b.pts[i * 3], py = b.pts[i * 3 + 1], z1 = b.pts[i * 3 + 2];
            let sx = x + x1 * R, sy = y + py * R;
            if (disp > 0.3) { sx += Math.sin(i * 12.9898 + b.id) * disp; sy += Math.cos(i * 78.233 + b.id) * disp; }
            P.add(pal, (0.1 + shade(x1, py, z1, lx, ly, lz, hx, hy, hz, 0.9)) * (0.35 + 0.65 * b.alpha) * (1 - 0.72 * C.dim), sx, sy, d * (R > 5 * d ? 1.35 : 1.15));
          }
        }
        P.flush(ctx);
      };
      drawBodies(back);
      if (this.sun && sr > 2) {
        const R = sr, gx = scx - C.binary * RX * 0.55;
        ctx.drawImage(glowSprite(R * 3.2), gx - R * 3.2, scy - R * 3.2, R * 6.4, R * 6.4);
        this.sun.draw(P, ctx, gx, scy, R, d);
        this.sunWord(this.sunText, gx, scy, R);
      }
      if (this.friendSun && C.binary > 0.05) {
        const R = sr * C.binary, gx = scx + C.binary * RX * 0.55;
        ctx.drawImage(glowSprite(R * 3.2), gx - R * 3.2, scy - R * 3.2, R * 6.4, R * 6.4);
        this.friendSun.draw(P, ctx, gx, scy, R, d);
        this.sunWord(this.friendText, gx, scy, R);
      }
      drawBodies(front);

      // Selection ring
      if (this.selected && this.selected.sr) {
        const b = this.selected;
        ctx.beginPath(); ctx.arc(b.sx * d, b.sy * d, (b.sr + 7) * d, 0, TAU);
        ctx.strokeStyle = 'rgba(240,242,246,0.75)'; ctx.lineWidth = d; ctx.stroke();
      }
      // Labels: previously shown labels keep priority and their spot, and fade instead of popping.
      if (C.orbitAlpha > 0.3) {
        ctx.font = `500 ${11 * d}px "Geist Mono", ui-monospace, monospace`;
        ctx.textBaseline = 'middle';
        const sunX = scx - C.binary * RX * 0.55, fX = scx + C.binary * RX * 0.55;
        const placed = [[sunX - sr * 1.3, scy - sr * 1.3, sr * 2.6, sr * 2.6]];
        if (C.binary > 0.5) placed.push([fX - sr * 1.3, scy - sr * 1.3, sr * 2.6, sr * 2.6]);
        const ok = (b) => b.label && b.alpha > 0.5 && b.mass > 0.6;
        const cands = [...this.bodies.values()].filter((b) => b.labA > 0.01 || ok(b)).sort((a, b) => b.labOn - a.labOn || b.fit - a.fit);
        const hits = (r) => placed.some((p) => r[0] < p[0] + p[2] && r[0] + r[2] > p[0] && r[1] < p[1] + p[3] && r[1] + r[3] > p[1]);
        for (const b of cands) {
          const txt = this.labelFn ? this.labelFn(b) : b.s.n;
          if (txt !== b.labTxt) { b.labTxt = txt; b.labW = ctx.measureText(txt).width; }
          const tw = b.labW, bx = b.sx * d, by = b.sy * d, off = (b.sr + 6) * d;
          const rectFor = (k) => {
            const p = [[bx + off, by], [bx - off - tw, by], [bx - tw / 2, by - off - 6 * d], [bx - tw / 2, by + off + 6 * d]][k];
            return [p[0] - 3 * d, p[1] - 8 * d, tw + 6 * d, 16 * d, p[0], p[1]];
          };
          let rect = null;
          if (ok(b)) {
            const order = b.labSpot >= 0 ? [b.labSpot, 3, 0, 1, 2] : [3, 0, 1, 2];
            for (const k of order) {
              const r = rectFor(k);
              if (r[0] < 2 * d || r[0] + r[2] > W - 2 * d || r[1] < 2 * d || r[1] + r[3] > H - 2 * d || hits(r)) continue;
              rect = r; b.labSpot = k; break;
            }
            if (rect) b.labHold = 0;
            else if (b.labOn && b.labSpot >= 0 && (b.labHold += dt) < 0.8) rect = rectFor(b.labSpot);
          }
          b.labOn = rect ? 1 : 0;
          b.labA += ((rect ? 1 : 0) - b.labA) * (motion.reduced ? 1 : ease(dt, 6));
          if (rect) placed.push(rect);
          if (b.labA < 0.02 || b.labSpot < 0) continue;
          const r = rect || rectFor(b.labSpot), a = b.labA * C.orbitAlpha;
          ctx.fillStyle = `rgba(12,13,16,${0.55 * a})`; ctx.fillRect(r[0], r[1], r[2], r[3]);
          ctx.fillStyle = `rgba(232,235,240,${0.92 * a})`; ctx.fillText(txt, r[4], r[5] + 0.5 * d);
        }
      }
    }
  }

  // ---- Sand effects overlay ---------------------------------------------
  // Maps a point in an element's own box to the screen, including its current CSS transform.
  function liveMap(el) {
    const cs = getComputedStyle(el), m = cs.transform && cs.transform !== 'none' ? new DOMMatrix(cs.transform) : new DOMMatrix();
    const [ox, oy] = cs.transformOrigin.split(' ').map(parseFloat);
    const par = el.offsetParent ? el.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
    const bx = par.left + el.offsetLeft, by = par.top + el.offsetTop;
    return {
      w: el.offsetWidth, h: el.offsetHeight,
      at: (lx, ly) => [bx + ox + m.a * (lx - ox) + m.c * (ly - oy) + m.e, by + oy + m.b * (lx - ox) + m.d * (ly - oy) + m.f],
    };
  }

  class SandFX {
    constructor(canvas) {
      this.c = canvas; this.ctx = canvas.getContext('2d');
      const N = 7000; this.N = N; this.n = 0;
      this.x = new Float32Array(N); this.y = new Float32Array(N); this.vx = new Float32Array(N); this.vy = new Float32Array(N);
      this.life = new Float32Array(N); this.max = new Float32Array(N); this.sz = new Float32Array(N); this.b = new Float32Array(N);
      this.tx = new Float32Array(N); this.ty = new Float32Array(N); this.mode = new Uint8Array(N); this.delay = new Float32Array(N);
      this.painter = new Painter(); this.painter.palette('s', [1, 1, 1], 1); this.painter.palette('m', [1, 1, 1], 0.55); this.painter.palette('f', [1, 1, 1], 0.25);
      this.holding = false; this.erosions = []; this.comets = [];
      this.resize();
    }
    resize() { const d = DPR(); this.c.width = innerWidth * d; this.c.height = innerHeight * d; this.dpr = d; }
    // Completion must not depend on animation frames: hidden or throttled tabs pause rAF.
    guard(fn, duration) {
      let called = false;
      const once = () => { if (!called) { called = true; fn && fn(); } };
      setTimeout(once, duration + 250);
      return once;
    }
    get busy() { return this.n > 0 || this.erosions.length > 0 || this.comets.length > 0; }
    // A comet leaves (x0,y0), arcs up, swings around (x1,y1) and dissolves into it. CSS px.
    comet(x0, y0, x1, y1, done) {
      if (motion.reduced) { done && done(); return; }
      const side = Math.random() < 0.5 ? -1 : 1, rise = Math.abs(y1 - y0);
      const p1 = [x0 + side * (60 + Math.random() * 60), y0 - rise * (0.3 + Math.random() * 0.15)];
      const p2 = [x1 + side * (90 + Math.random() * 70), y1 - (15 + Math.random() * 40)];
      this.comets.push({ t: 0, dur: 1.25, done, p: [[x0, y0], p1, p2, [x1, y1]] });
    }
    spawn(x, y, o) {
      if (this.n >= this.N) return;
      const i = this.n++;
      this.x[i] = x; this.y[i] = y; this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0;
      this.life[i] = 0; this.max[i] = o.life || 1; this.sz[i] = o.sz || 1.3; this.b[i] = o.b ?? 0.5 + Math.random() * 0.7;
      this.tx[i] = o.tx || 0; this.ty[i] = o.ty || 0; this.mode[i] = o.mode || 0; this.delay[i] = o.delay || 0;
    }
    // Erode an element along a direction, spawning grains at the moving front.
    // dir: 'right' | 'left' | 'up'. target: {x,y} to stream grains toward, or null to drift.
    erode(el, { dir = 'right', duration = 650, target = null, gravity = 0, done } = {}) {
      const rect = el.getBoundingClientRect();
      if (motion.reduced) { el.style.opacity = '0'; done && done(); return; }
      this.erosions.push({ el, rect, rects: [rect], dir, duration, target, gravity, t: 0, done: this.guard(done, duration), last: 0, live: true });
      el.style.willChange = 'mask-image';
    }
    // Erode a whole screen: grains spawn only over its text and controls.
    erodeScreen(root, opts = {}) {
      const sel = 'h1,h2,h3,p,button,label,.chip,.opt,.fieldline,.planet-caption,input,.eyebrow';
      const rects = [...root.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight);
      const rect = root.getBoundingClientRect();
      if (motion.reduced) { opts.done && opts.done(); return; }
      const duration = opts.duration || 560;
      this.erosions.push({ el: root, rect, rects, dir: opts.dir || 'up', duration, target: null, gravity: -20, t: 0, done: this.guard(opts.done, duration), last: 0, sparse: true });
    }
    // Form grains into text, then release them.
    formText(lines, { duration = 1300 } = {}) {
      if (!this.c.width || !this.c.height) this.resize();
      if (motion.reduced || !this.c.width || !this.c.height) return Promise.resolve();
      const d = this.dpr, off = document.createElement('canvas');
      off.width = this.c.width; off.height = this.c.height;
      const g = off.getContext('2d');
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      for (const el of lines) {
        const range = document.createRange(); range.selectNodeContents(el);
        const r = range.getBoundingClientRect(), cs = getComputedStyle(el);
        g.font = `${cs.fontStyle} ${cs.fontWeight} ${parseFloat(cs.fontSize) * d}px ${cs.fontFamily}`;
        if ('letterSpacing' in g) g.letterSpacing = parseFloat(cs.letterSpacing || 0) * d + 'px';
        const m = g.measureText(el.textContent);
        const base = r.top * d + (r.height * d - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
        g.fillText(el.textContent, r.left * d, base);
      }
      const img = g.getImageData(0, 0, off.width, off.height).data;
      const pts = [], stepPx = Math.max(2, Math.round(2.2 * d));
      for (let y = 0; y < off.height; y += stepPx) for (let x = 0; x < off.width; x += stepPx) if (img[(y * off.width + x) * 4 + 3] > 140) pts.push(x, y);
      const count = pts.length / 2, keep = Math.min(1, 2400 / count);
      for (let i = 0; i < count; i++) {
        if (Math.random() > keep) continue;
        const a = Math.random() * TAU, rr = (20 + Math.random() * 90) * d;
        this.spawn(pts[i * 2] + Math.cos(a) * rr, pts[i * 2 + 1] + Math.sin(a) * rr * 0.6 + 30 * d, { mode: 2, tx: pts[i * 2], ty: pts[i * 2 + 1], life: duration / 1000 + 10, sz: 1.25 * d, delay: (pts[i * 2] / this.c.width) * 0.35 });
      }
      this.holding = true;
      return new Promise((res) => setTimeout(res, duration));
    }
    sift(rect) {
      if (motion.reduced) return;
      const d = this.dpr, inset = Math.min(rect.height / 2, 22);
      for (let i = 0; i < 70; i++) {
        const x = rect.left + inset + Math.random() * (rect.width - inset * 2);
        this.spawn(x * d, (rect.top + 3) * d, { mode: 5, vx: (Math.random() - 0.5) * 12 * d, vy: (10 + Math.random() * 50) * d, ty: (rect.bottom - 4 - Math.random() * 6) * d, life: 1.1 + Math.random() * 0.4, sz: (1 + Math.random() * 0.8) * d, delay: Math.random() * 0.35, b: 0.8 + Math.random() * 0.45 });
      }
    }
    release(fast) {
      for (let i = 0; i < this.n; i++) if (this.mode[i] === 2) { this.mode[i] = 4; this.life[i] = 0; this.max[i] = fast ? 0.15 + Math.random() * 0.15 : 0.45 + Math.random() * 0.35; this.vx[i] = 0; this.vy[i] = 0; }
      this.holding = false;
    }
    burst(x, y, n = 40) {
      if (motion.reduced) return;
      const d = this.dpr;
      for (let i = 0; i < n; i++) { const a = Math.random() * TAU, s = (30 + Math.random() * 120) * d; this.spawn(x * d, y * d, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.6, sz: 1.3 * d }); }
    }
    frame(dt) {
      const ctx = this.ctx, d = this.dpr, P = this.painter;
      ctx.clearRect(0, 0, this.c.width, this.c.height);
      // Erosions: advance the mask front and spawn grains along it.
      for (const e of this.erosions) {
        e.t += dt * 1000;
        const p = clamp(e.t / e.duration, 0, 1), pe = p * 1.16 - 0.08;
        const grad = e.dir === 'left' ? 'to left' : e.dir === 'up' ? 'to top' : 'to right';
        const m = `linear-gradient(${grad}, transparent ${(pe * 100).toFixed(1)}%, #000 ${((pe + 0.08) * 100).toFixed(1)}%)`;
        e.el.style.webkitMaskImage = m; e.el.style.maskImage = m;
        const r = e.rect, frontFrac = clamp(pe + 0.03, 0, 1);
        const map = e.live && e.el.isConnected ? liveMap(e.el) : null;
        const per = e.sparse ? 90 : Math.min(260, (r.width * r.height) / 900);
        const toSpawn = Math.round(per * (p - e.last) * 10);
        e.last = p;
        for (let i = 0; i < toSpawn; i++) {
          let x, y;
          if (map) {
            const lx = (e.dir === 'left' ? 1 - frontFrac : frontFrac) * map.w + (Math.random() - 0.5) * 8, ly = Math.random() * map.h;
            [x, y] = map.at(lx, ly);
          } else if (e.dir === 'up') { y = r.bottom - frontFrac * r.height + (Math.random() - 0.5) * 10; x = r.left + Math.random() * r.width; }
          else { x = e.dir === 'left' ? r.right - frontFrac * r.width : r.left + frontFrac * r.width; x += (Math.random() - 0.5) * 8; y = r.top + Math.random() * r.height; }
          if (e.sparse && !e.rects.some((q) => x >= q.left && x <= q.right && y >= q.top - 2 && y <= q.bottom + 2)) continue;
          if (e.target) this.spawn(x * d, y * d, { mode: 1, tx: e.target.x * d, ty: e.target.y * d, life: 1.6, sz: (1 + Math.random() * 0.8) * d, vx: (Math.random() * 120 + 60) * d * (e.dir === 'left' ? -1 : 1), vy: (Math.random() - 0.7) * 160 * d, delay: 0 });
          else this.spawn(x * d, y * d, { life: 0.7 + Math.random() * 0.8, sz: (0.9 + Math.random() * 0.9) * d, vx: (e.dir === 'left' ? -1 : e.dir === 'right' ? 1 : (Math.random() - 0.5)) * (40 + Math.random() * 90) * d, vy: (e.dir === 'up' ? -(30 + Math.random() * 80) : (Math.random() - 0.5) * 50) * d, b: 0.45 + Math.random() * 0.75 });
        }
        if (p >= 1 && !e.finished) { e.finished = true; e.done && e.done(); }
      }
      this.erosions = this.erosions.filter((e) => !e.finished);

      for (const c of this.comets) {
        c.t += dt;
        const u = Math.min(1, c.t / c.dur), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2, [a, b, cc, dd] = c.p, m = 1 - e;
        const x = m * m * m * a[0] + 3 * m * m * e * b[0] + 3 * m * e * e * cc[0] + e * e * e * dd[0];
        const y = m * m * m * a[1] + 3 * m * m * e * b[1] + 3 * m * e * e * cc[1] + e * e * e * dd[1];
        const lx = c.lx ?? x, ly = c.ly ?? y, seg = Math.hypot(x - lx, y - ly); c.lx = x; c.ly = y;
        const fade = u > 0.88 ? (1 - u) / 0.12 : 1, steps = Math.min(40, Math.ceil(seg / 1.5));
        // Lay grains evenly along the stretch just travelled so the tail is a continuous line of sand.
        for (let k = 0; k < steps * fade; k++) {
          const f = k / Math.max(1, steps), sx = lx + (x - lx) * f, sy = ly + (y - ly) * f;
          this.spawn((sx + (Math.random() - 0.5) * 2.5) * d, (sy + (Math.random() - 0.5) * 2.5) * d, { mode: 3, vx: (Math.random() - 0.5) * 14 * d, vy: (Math.random() - 0.5) * 14 * d, life: 0.45 + Math.random() * 0.45, sz: (0.9 + Math.random() * 0.9) * d, b: 0.75 + Math.random() * 0.45 });
        }
        for (let k = 0; k < 12; k++) { const ang = k * 2.4, rr = Math.sqrt(k / 12) * 3.6 * fade; P.add('s', 1.2, (x + Math.cos(ang) * rr) * d, (y + Math.sin(ang) * rr) * d, d * 2.2); }
        if (u >= 1 && !c.finished) { c.finished = true; this.burst(x, y, 36); c.done && c.done(); }
      }
      this.comets = this.comets.filter((c) => !c.finished);
      const t = performance.now() / 1000;
      let w = 0;
      for (let i = 0; i < this.n; i++) {
        if (this.delay[i] > 0) { this.delay[i] -= dt; }
        else {
          this.life[i] += dt;
          const md = this.mode[i];
          if (md === 5) {
            this.vy[i] += 1100 * d * dt;
            if (this.y[i] >= this.ty[i]) { this.y[i] = this.ty[i]; this.vy[i] *= -0.22; this.vx[i] *= 0.5; }
          } else if (md === 0 || md === 3) {
            const nx = Math.sin(this.y[i] * 0.012 + t * 1.3) * 40 * d, ny = Math.cos(this.x[i] * 0.012 + t) * 30 * d;
            this.vx[i] += nx * dt; this.vy[i] += ny * dt + (md === 0 ? 30 * d * dt : 0);
            this.vx[i] *= 0.985; this.vy[i] *= 0.985;
          } else {
            const dx = this.tx[i] - this.x[i], dy = this.ty[i] - this.y[i];
            if (md === 2 || md === 4) {
              // Critically damped settle: no overshoot, no jitter.
              const kk = 1 - Math.exp(-dt * 7);
              this.x[i] += dx * kk; this.y[i] += dy * kk; this.vx[i] = 0; this.vy[i] = 0;
            } else {
              this.vx[i] += dx * 9 * dt; this.vy[i] += dy * 9 * dt;
              this.vx[i] *= 0.93; this.vy[i] *= 0.93;
            }
            if (md === 1 && dx * dx + dy * dy < 100 * d * d) this.life[i] = this.max[i];
          }
          this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt;
        }
        if (this.life[i] >= this.max[i]) continue;
        const fade = this.mode[i] === 2 ? 1 : 1 - this.life[i] / this.max[i];
        const key = fade > 0.66 ? 's' : fade > 0.33 ? 'm' : 'f';
        if (this.delay[i] <= 0) P.add(key, this.b[i], this.x[i], this.y[i], this.sz[i]);
        if (w !== i) {
          this.x[w] = this.x[i]; this.y[w] = this.y[i]; this.vx[w] = this.vx[i]; this.vy[w] = this.vy[i];
          this.life[w] = this.life[i]; this.max[w] = this.max[i]; this.sz[w] = this.sz[i]; this.b[w] = this.b[i];
          this.tx[w] = this.tx[i]; this.ty[w] = this.ty[i]; this.mode[w] = this.mode[i]; this.delay[w] = this.delay[i];
        }
        w++;
      }
      this.n = w;
      P.flush(ctx);
    }
  }

  // ---- A single animation loop shared by all renderers -------------------
  // Drops grain counts if frames run slow for a couple of seconds (mid-range phones).
  const quality = { level: 1, ema: 1 / 60, slow: 0 };
  const loop = {
    items: new Set(), running: false, last: 0,
    add(fn) { this.items.add(fn); this.start(); },
    remove(fn) { this.items.delete(fn); },
    start() {
      if (this.running) return;
      this.running = true; this.last = performance.now();
      const tick = (now) => {
        if (!this.running) return;
        const raw = (now - this.last) / 1000, dt = Math.min(0.05, raw); this.last = now;
        if (raw < 0.2) {
          quality.ema += (raw - quality.ema) * 0.05;
          quality.slow = quality.ema > 0.026 ? quality.slow + raw : 0;
          if (quality.slow > 2 && quality.level > 0.5) { quality.level = Math.max(0.5, quality.level - 0.25); quality.slow = 0; }
        }
        for (const fn of this.items) fn(dt);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    stop() { this.running = false; },
  };
  document.addEventListener('visibilitychange', () => (document.hidden ? loop.stop() : loop.start()));

  // Render a small static planet portrait for cards and lists.
  function portrait(seed, size, opts = {}) {
    const d = DPR(), c = document.createElement('canvas');
    c.width = c.height = size * d; c.style.width = c.style.height = size + 'px';
    const ctx = c.getContext('2d'), P = new Painter();
    P.palette('x', opts.tint || [1, 1, 1], 1);
    const r = rng(seed), n = opts.grains || 520, pts = spherePoints(n, r);
    const R = size * d * 0.42, cx = size * d / 2, cy = size * d / 2;
    let lx = -0.55, ly = -0.6, lz = 0.58; const ln = Math.hypot(lx, ly, lz); lx /= ln; ly /= ln; lz /= ln;
    let hx = lx, hy = ly, hz = lz + 1; const hn = Math.hypot(hx, hy, hz); hx /= hn; hy /= hn; hz /= hn;
    const bands = 2 + (seed % 5), ph = (seed % 97) / 15;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
      if (z < 0) continue;
      let b = shade(x, y, z, lx, ly, lz, hx, hy, hz, 1);
      b *= 0.78 + 0.22 * Math.sin(Math.asin(y) * bands * 2 + ph + Math.sin(Math.atan2(z, x) * 3 + ph) * 0.6);
      P.add('x', b, cx + x * R, cy + y * R, d * 1.25);
    }
    P.flush(ctx);
    return c;
  }

  // ---- Sand slider: a groove of grains under a transparent native range input -------
  // The native input stays on top (invisible) so keyboard, touch and screen readers work as usual.
  const OFF = 14;
  class SandTrack {
    constructor(input) {
      this.input = input;
      const wrap = document.createElement('div'); wrap.className = 'ss';
      input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
      if (input.hidden) { input.hidden = false; wrap.hidden = true; }
      this.wrap = wrap;
      this.c = document.createElement('canvas'); this.c.setAttribute('aria-hidden', 'true'); wrap.insertBefore(this.c, input);
      this.ctx = this.c.getContext('2d');
      this.P = new Painter(); this.P.palette('t', [1, 1, 1], 1); this.P.palette('d', [1, 1, 1], 0.55);
      this.loose = []; this.focus = false; this.down = false; this.last = null; this.idle = 0; this.n = 0;
      this.fn = (dt) => this.frame(dt);
      input.addEventListener('input', () => { this.kick(); this.refresh(); });
      input.addEventListener('focus', () => { this.focus = true; this.refresh(); });
      input.addEventListener('blur', () => { this.focus = false; this.refresh(); });
      input.addEventListener('pointerdown', () => { this.down = true; this.refresh(); });
      const up = () => { this.down = false; this.refresh(); };
      input.addEventListener('pointerup', up); input.addEventListener('pointercancel', up);
      if (window.ResizeObserver) new ResizeObserver(() => { this.resize(); this.refresh(); }).observe(wrap);
      this.refresh();
    }
    refresh() { this.idle = 0; loop.add(this.fn); }
    resize() {
      const d = DPR(), w = this.c.clientWidth, h = this.c.clientHeight;
      if (!w || !h) return;
      this.c.width = Math.round(w * d); this.c.height = Math.round(h * d); this.d = d; this.w = w; this.h = h;
      const n = Math.max(24, Math.floor((w - 2 * OFF - 28) / 4.5));
      if (n !== this.n) { this.n = n; this.y = new Float32Array(n); this.v = new Float32Array(n); this.j = Float32Array.from({ length: n }, () => (Math.random() - 0.5) * 2.4); }
    }
    v01() { const i = this.input, mn = +i.min || 0, mx = +i.max || 100; return (i.value - mn) / (mx - mn || 1); }
    // The canvas overhangs the input by OFF px on each side; the bead tracks the native thumb (28px wide).
    tx() { return OFF + 14 + this.v01() * (this.w - 2 * OFF - 28); }
    kick() {
      if (!this.w) return;
      const x = this.tx(), dx = this.last == null ? 0 : x - this.last;
      this.last = x;
      if (motion.reduced) return;
      for (let i = 0; i < this.n; i++) {
        const gx = OFF + 14 + (i / (this.n - 1)) * (this.w - 2 * OFF - 28), f = Math.exp(-(((gx - x) / 20) ** 2));
        this.v[i] -= f * Math.min(70, Math.abs(dx) * 5 + 10);
      }
      const spill = Math.min(5, Math.abs(dx) / 3 + 1);
      for (let k = 0; k < spill; k++) this.loose.push({ x: x + (Math.random() - 0.5) * 12, y: this.h / 2 - 4, vx: -dx * 3 + (Math.random() - 0.5) * 40, vy: -50 - Math.random() * 70, life: 0 });
    }
    frame(dt) {
      if (!this.c.isConnected) { loop.remove(this.fn); return; }
      if (!this.w) this.resize();
      if (!this.w) return;
      const ctx = this.ctx, d = this.d, P = this.P, cy = this.h / 2, x = this.tx(), unset = this.input.classList.contains('unset');
      this.last = x;
      ctx.clearRect(0, 0, this.c.width, this.c.height);
      let energy = 0;
      for (let i = 0; i < this.n; i++) {
        this.v[i] += (-this.y[i] * 180 - this.v[i] * 10) * dt; this.y[i] += this.v[i] * dt;
        energy += Math.abs(this.v[i]) + Math.abs(this.y[i]);
        const gx = OFF + 14 + (i / (this.n - 1)) * (this.w - 2 * OFF - 28), on = gx <= x && !unset, near = Math.exp(-(((gx - x) / 30) ** 2));
        P.add('t', on ? 0.72 + near * 0.4 : 0.2 + near * 0.18, gx * d, (cy + this.j[i] + this.y[i]) * d, d * (on ? 2.1 : 1.6));
      }
      this.loose = this.loose.filter((p) => (p.life += dt) < 0.8);
      for (const p of this.loose) {
        p.vy += 300 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.y > cy + 2) { p.y = cy + 2; p.vy *= -0.3; p.vx *= 0.6; }
        P.add('d', 0.95, p.x * d, p.y * d, d * 1.6);
      }
      P.flush(ctx);
      const R = (this.down ? 13 : 11) * d, bx = x * d, by = cy * d;
      const g = ctx.createRadialGradient(bx - R * 0.35, by - R * 0.4, R * 0.1, bx, by, R);
      if (unset) { g.addColorStop(0, '#8d9199'); g.addColorStop(1, '#3a3d43'); }
      else { g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, '#e3e5e9'); g.addColorStop(0.75, '#9aa0a8'); g.addColorStop(1, '#5f646c'); }
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 6 * d; ctx.shadowOffsetY = 2 * d;
      ctx.beginPath(); ctx.arc(bx, by, R, 0, TAU); ctx.fillStyle = g; ctx.fill();
      ctx.restore();
      if (this.focus) { ctx.beginPath(); ctx.arc(bx, by, R + 4 * d, 0, TAU); ctx.strokeStyle = 'rgba(244,245,247,0.9)'; ctx.lineWidth = 2 * d; ctx.stroke(); }
      if (energy < 0.5 && !this.loose.length && !this.down) { if ((this.idle += dt) > 0.3) loop.remove(this.fn); } else this.idle = 0;
    }
  }

  // ---- Scenes: full-screen sand that takes over the sky around the student's planet ----
  // kind: 'size' (classmates around you), 'distance' (your radius), 'vibe' (study circles vs an orbital race),
  // 'track' (a skyline of jobs vs research orbits). region() returns {cx, cy, rx, ry, r0} in CSS px.
  class Scene {
    constructor(canvas, region) {
      this.c = canvas; this.ctx = canvas.getContext('2d'); this.region = region;
      this.P = new Painter(); this.P.palette('t', [1, 1, 1], 1); this.P.palette('m', [1, 1, 1], 0.5); this.P.palette('f', [1, 1, 1], 0.2);
      const N = 320; this.N = N;
      this.x = new Float32Array(N); this.y = new Float32Array(N); this.a = new Float32Array(N); this.rk = Float32Array.from({ length: N }, () => Math.random());
      this.kind = null; this.getV = () => 0; this.alpha = 0; this.kAlpha = 1; this.next = null; this.t = 0; this.fresh = true;
      this.fn = (dt) => this.frame(dt);
      this.resize();
    }
    resize() { const d = DPR(); this.c.width = Math.round(innerWidth * d); this.c.height = Math.round(innerHeight * d); this.d = d; }
    set(kind, getV) {
      if (kind && this.kind && kind !== this.kind && this.alpha > 0.05 && !motion.reduced) { this.next = { kind, getV }; this.on = true; }
      else {
        if (kind && kind !== this.kind) { this.fresh = true; this.kAlpha = 0; }
        this.next = null; this.kind = kind || this.kind; this.on = !!kind; if (getV) this.getV = getV;
      }
      loop.add(this.fn);
    }
    wake() { loop.add(this.fn); }
    static classSize(v) { return Math.round(Math.exp(Math.log(12) + v * (Math.log(300) - Math.log(12)))); }
    // Points on a tilted ellipse around the sun.
    ell(R, ang, tilt) { const g = this.g.sky; return [g.cx + Math.cos(ang) * R, g.cy + Math.sin(ang) * R * tilt]; }
    // Seats for a class of n, as an amphitheater in the band facing up toward you.
    seats(n, B) {
      const cx = B.x + B.w / 2, cy = B.y - B.h * 0.3, maxDx = B.w / 2 - 10, bottom = B.y + B.h - 5, top = B.y + 5;
      let out = [];
      for (let sp = 14; sp >= 4.2; sp -= 0.4) {
        out = [];
        for (let k = 0; k < 60; k++) {
          const R = B.h * 0.5 + k * sp * 1.05;
          if (cy + R * Math.cos(Math.asin(Math.min(1, maxDx / R))) > bottom && R > bottom - cy + sp * 6) break;
          const aMax = Math.min(Math.asin(Math.min(1, maxDx / R)), Math.acos(clamp((top - cy) / R, -1, 1)));
          const aMin = R > bottom - cy ? Math.acos(clamp((bottom - cy) / R, -1, 1)) : 0;
          if (aMax <= aMin) continue;
          const row = [];
          for (let a = aMin + (aMin ? 0 : sp / R / 2); a <= aMax; a += sp / R) { row.push(a); if (a > 0) row.push(-a); }
          row.sort((x, y) => Math.abs(x) - Math.abs(y));
          for (const a of row) out.push([cx + Math.sin(a) * R, cy + Math.cos(a) * R]);
          if (out.length >= n) break;
        }
        if (out.length >= n) break;
      }
      return out.slice(0, n);
    }
    // Points along a branching tree, ordered trunk-first so a partial count reads as a tree growing.
    treePts(B) {
      const key = `${B.w}x${B.h}`;
      if (this._treeKey === key) return this._tree;
      const pts = [], rnd = rng(42), base = [B.x + B.w * 0.75, B.y + B.h - 5];
      const grow = (x, y, ang, len, depth) => {
        const ex = x + Math.cos(ang) * len, ey = y - Math.sin(ang) * len, n = Math.max(2, Math.round(len / 5.5));
        for (let k = 1; k <= n; k++) pts.push([x + (ex - x) * (k / n), y + (ey - y) * (k / n), depth + k / n / 2, depth]);
        if (depth >= 4) { for (let k = 0; k < 3; k++) pts.push([ex + (rnd() - 0.5) * 9, ey + (rnd() - 0.5) * 7, depth + 0.9, depth + 1]); return; }
        const spread = 0.42 + rnd() * 0.2;
        grow(ex, ey, ang + spread, len * 0.7, depth + 1);
        grow(ex, ey, ang - spread * (0.8 + rnd() * 0.4), len * 0.7, depth + 1);
      };
      grow(base[0], base[1], Math.PI / 2, B.h * 0.32, 0);
      pts.sort((p1, p2) => p1[2] - p2[2]);
      const ox = base[0] - B.x, oy = base[1] - B.y;
      this._tree = pts.map((q) => [q[0] - B.x - ox, q[1] - B.y - oy, q[3]]);
      this._treeKey = key;
      return this._tree;
    }
    targets(v) {
      const B = this.g.band, S = this.g.sky, T = new Array(this.N), t = this.t;
      const home = [S.cx, S.cy, 0];
      if (!B || this.next) { for (let i = 0; i < this.N; i++) T[i] = home; return T; }
      if (this.kind === 'size') {
        const n = Scene.classSize(v), seats = this.seats(n, B);
        for (let i = 0; i < this.N; i++) T[i] = i < seats.length ? [seats[i][0], seats[i][1], 1] : home;
      } else if (this.kind === 'vibe') {
        // Left: four study circles. Right: a race in four lanes toward a finish line.
        const e = v * v * (3 - 2 * v), n = 24;
        for (let i = 0; i < n; i++) {
          const g = i % 4, k = (i / 4) | 0;
          const ca = (k / 6) * TAU + t * 0.45 * (g % 2 ? 1 : -1);
          const A = [B.x + B.w * (0.14 + g * 0.24) + Math.cos(ca) * 17, B.y + B.h / 2 + Math.sin(ca) * 17];
          const speed = 0.08 + this.rk[i] * 0.16, u = (this.rk[i + 24] + t * speed) % 1;
          const Bp = [B.x + 30 + u * (B.w - 50), B.y + B.h * (0.2 + g * 0.2)];
          T[i] = [A[0] + (Bp[0] - A[0]) * e, A[1] + (Bp[1] - A[1]) * e, Math.min(1, Math.min(u, 1 - u) * 14 + (1 - e)), u, g, speed];
        }
        for (let i = n; i < this.N; i++) T[i] = home;
      } else if (this.kind === 'track') {
        // Left: a skyline of jobs. Right: research orbiting an idea.
        const tree = this.treePts(B), n = Math.min(120, tree.length + 10), work = Math.round((1 - v) * n), hts = [6, 10, 7, 13, 8, 11, 5], cols = hts.length;
        const colW = (B.w * 0.42) / cols, base = B.y + B.h - 8;
        let wi = 0;
        for (let i = 0; i < n; i++) {
          if (i < work) {
            const slot = wi++; let c = 0, acc = 0;
            for (c = 0; c < cols; c++) { const cap = hts[c] * 2; if (slot < acc + cap) break; acc += cap; }
            c = Math.min(c, cols - 1);
            const j = slot - acc, row = (j / 2) | 0, col = j % 2;
            T[i] = [B.x + 10 + c * colW + col * 5.5, base - row * 5.5, 1];
          } else {
            const j = Math.min(i - work, tree.length - 1), q = tree[j], sway = Math.sin(t * 1.3 + q[2]) * q[2] * 0.6;
            T[i] = [B.x + B.w * 0.75 + q[0] + sway, B.y + B.h - 5 + q[1], 1];
          }
        }
        for (let i = n; i < this.N; i++) T[i] = home;
      }
      return T;
    }
    frame(dt) {
      const k = motion.reduced ? 1 : ease(dt, 4);
      this.alpha += ((this.on ? 1 : 0) - this.alpha) * k;
      const ctx = this.ctx, d = this.d, P = this.P, links = this.links ? this.links() : [];
      ctx.clearRect(0, 0, this.c.width, this.c.height);
      if (!this.on && this.alpha < 0.02 && !links.length) { loop.remove(this.fn); this.kind = null; return; }
      this.t += motion.reduced ? 0 : dt;
      this.g = this.region();
      const g = this.g.sky;
      // Streams of sand from picked answers into the student's planet.
      for (let li = 0; li < links.length; li++) {
        const [lx, ly] = links[li], dx = g.cx - lx, dy = g.cy - ly, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
        for (let j = 0; j < 22; j++) {
          const u = (this.rk[(j * 7 + li * 31) % this.N] + this.t * 0.4) % 1, bend = Math.sin(u * Math.PI) * 14 * (li % 2 ? 1 : -1);
          P.add(u < 0.12 || u > 0.88 ? 'f' : 'm', 1, (lx + dx * u + nx * bend) * d, (ly + dy * u + ny * bend) * d, d * 1.8);
        }
      }
      if (this.next) { this.kAlpha -= dt * 2.6; if (this.kAlpha <= 0) { this.kind = this.next.kind; this.getV = this.next.getV; this.next = null; this.fresh = true; this.kAlpha = 0; } }
      else this.kAlpha = Math.min(1, this.kAlpha + dt * 2.4);
      if (!this.kind || this.alpha < 0.02) { P.flush(ctx); return; }
      const v = this.getV(), tilt = g.ry / g.rx, A = this.alpha * (motion.reduced ? 1 : this.kAlpha);
      const lvl = (a) => (a * A > 0.66 ? 't' : a * A > 0.33 ? 'm' : 'f');
      if (this.kind === 'distance') {
        const R = g.r0 + 16 + (g.rx - g.r0 - 16) * v;
        ctx.save(); ctx.globalAlpha = A;
        for (let i = 0; i < 150; i++) {
          const ang = (i / 150) * TAU + this.t * 0.06, p = this.ell(R + Math.sin(i * 7.1 + this.t) * 1.5, ang, tilt);
          P.add('t', 0.55 + 0.5 * Math.abs(Math.sin(ang * 3 + this.t)), p[0] * d, p[1] * d, d * 2);
        }
        for (let i = 0; i < 60; i++) {
          const u = (this.rk[i] + this.t * (0.25 + this.rk[i] * 0.2)) % 1, ang = this.rk[i + 60] * TAU, p = this.ell(g.r0 + (R - g.r0) * u, ang, tilt);
          P.add(u > 0.8 ? 'f' : 'm', 0.9, p[0] * d, p[1] * d, d * 1.6);
        }
        P.flush(ctx);
        ctx.restore();
        return;
      }
      const T = this.targets(v), kk = this.fresh || motion.reduced ? 1 : ease(dt, 5);
      if (this.fresh) { for (let i = 0; i < this.N; i++) { this.x[i] = g.cx; this.y[i] = g.cy; this.a[i] = 0; } this.fresh = false; }
      const kp = motion.reduced ? 1 : ease(dt, 5);
      const B = this.g.band;
      if (this.kind === 'track' && B) {
        ctx.save(); ctx.lineWidth = d;
        ctx.strokeStyle = `rgba(225,230,238,${0.2 * A})`;
        ctx.beginPath(); ctx.moveTo((B.x + 4) * d, (B.y + B.h - 4) * d); ctx.lineTo((B.x + B.w - 4) * d, (B.y + B.h - 4) * d); ctx.stroke();
        ctx.restore();
      }
      if (this.kind === 'vibe' && B) {
        const e = v * v * (3 - 2 * v);
        ctx.save(); ctx.lineWidth = d;
        if (e > 0.15) {
          for (let ln = 0; ln < 4; ln++) { const y = (B.y + B.h * (0.2 + ln * 0.2)) * d; ctx.strokeStyle = `rgba(225,230,238,${0.16 * e * A})`; ctx.beginPath(); ctx.moveTo((B.x + 8) * d, y); ctx.lineTo((B.x + B.w - 14) * d, y); ctx.stroke(); }
          ctx.strokeStyle = `rgba(245,246,248,${0.85 * e * A})`; ctx.lineWidth = 2 * d; ctx.setLineDash([3 * d, 3 * d]);
          ctx.beginPath(); ctx.moveTo((B.x + B.w - 14) * d, (B.y + 4) * d); ctx.lineTo((B.x + B.w - 14) * d, (B.y + B.h - 4) * d); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.restore();
      }
      for (let i = 0; i < this.N; i++) {
        const tg = T[i]; if (!tg) continue;
        const kq = motion.reduced ? 1 : ease(dt, 2.5 + this.rk[i] * 5);
        this.x[i] += (tg[0] - this.x[i]) * kq; this.y[i] += (tg[1] - this.y[i]) * kq; this.a[i] += (tg[2] - this.a[i]) * kk;
        if (this.a[i] < 0.04) continue;
        const sz = this.kind === 'size' ? 3.2 : this.kind === 'vibe' ? 5 : 3.6;
        const tw = this.kind === 'track' && this.rk[i] > 0.82 ? 0.35 * (0.5 + 0.5 * Math.sin(this.t * 3 + i * 1.7)) : 0;
        P.add(lvl(this.a[i]), this.kind === 'vibe' ? 1.05 + this.rk[i] * 0.15 : 0.75 + this.rk[i] * 0.4 + tw, this.x[i] * d, this.y[i] * d, d * sz);
        if (this.kind === 'vibe' && tg[3] != null && v > 0.45 && B) {
          for (let tr = 1; tr <= 7; tr++) P.add(tr < 3 ? 'm' : 'f', 1, (this.x[i] - tr * 3.5 * (0.6 + tg[5] * 5)) * d, (this.y[i] + Math.sin(this.t * 9 + i + tr) * 0.8) * d, d * (4 - tr * 0.4));
        }
      }
      if (this.kind === 'vibe' && v < 0.6 && B) {
        const e = v * v * (3 - 2 * v);
        for (let g = 0; g < 4; g++) {
          let mx = 0, my = 0; for (let k2 = 0; k2 < 6; k2++) { mx += this.x[g + k2 * 4]; my += this.y[g + k2 * 4]; }
          mx /= 6; my /= 6;
          for (let q = 0; q < 6; q++) { const a = q * 2.4, r = Math.sqrt(q / 6) * 3.2; P.add(lvl(1 - e), 1.1, (mx + Math.cos(a) * r) * d, (my + Math.sin(a) * r) * d, d * 2.2); }
          const u = (this.t * 0.6 + g * 0.21) % 1, k2 = Math.floor(u * 6), f = u * 6 - k2, a1 = g + k2 * 4, a2 = g + ((k2 + 1) % 6) * 4;
          P.add(lvl(1 - e), 1.25, (this.x[a1] + (this.x[a2] - this.x[a1]) * f) * d, (this.y[a1] + (this.y[a2] - this.y[a1]) * f) * d, d * 2.8);
        }
      }
      P.flush(ctx);
    }
  }

  // ---- Scroll sand: results animations driven purely by scroll position, so they rewind going back up ----
  // kinds: 'heading' (letters gather from sand), 'wipe' (content sweeps in behind a front of glinting grains),
  // 'count' (number climbs), 'prog' (sets --p), 'bar' (sand fills a bar, spilling at its edge), 'line' (sand trickles down a timeline)
  const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  class ScrollSand {
    constructor(canvas) {
      this.c = canvas; this.ctx = canvas.getContext('2d');
      this.P = new Painter(); this.P.palette('t', [1, 1, 1], 1); this.P.palette('m', [1, 1, 1], 0.55); this.P.palette('f', [1, 1, 1], 0.22);
      this.items = []; this.t = 0; this.idle = 0; this.lastChange = 0;
      this.fn = (dt) => this.frame(dt);
      this.resize();
      addEventListener('scroll', () => this.wake(), { passive: true });
      addEventListener('resize', () => { this.resize(); this.items.forEach((it) => (it.pts = null)); this.wake(); });
    }
    resize() { const d = DPR(); this.c.width = Math.round(innerWidth * d); this.c.height = Math.round(innerHeight * d); this.d = d; }
    wake() { this.idle = 0; if (this.items.length) loop.add(this.fn); }
    clear() {
      for (const it of this.items) { it.el.style.maskImage = ''; it.el.style.webkitMaskImage = ''; it.el.style.opacity = ''; }
      this.items = []; this.ctx.clearRect(0, 0, this.c.width, this.c.height);
    }
    scan(root) {
      this.items = this.items.filter((it) => it.el.isConnected);
      const add = (el, kind, o = {}) => { if (!this.items.some((it) => it.el === el && it.kind === kind)) this.items.push(Object.assign({ el, kind, p: -1, i: this.items.length }, o)); };
      root.querySelectorAll('.r-h').forEach((e) => add(e, 'heading'));
      root.querySelectorAll('[data-rv]').forEach((e) => add(e, 'wipe'));
      root.querySelectorAll('[data-count]').forEach((e) => add(e, 'count', { end: +e.dataset.count }));
      root.querySelectorAll('.balance').forEach((e) => add(e, 'prog'));
      root.querySelectorAll('.crow').forEach((e) => add(e, 'bar'));
      root.querySelectorAll('.timeline').forEach((e) => add(e, 'line'));
      this.wake();
    }
    sample(it, r) {
      const d = this.d, cs = getComputedStyle(it.el), c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(r.width * d)); c.height = Math.max(1, Math.ceil(r.height * d));
      const g = c.getContext('2d');
      g.font = `${cs.fontStyle} ${cs.fontWeight} ${parseFloat(cs.fontSize) * d}px ${cs.fontFamily}`;
      g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(it.el.textContent, 0, c.height / 2);
      const img = g.getImageData(0, 0, c.width, c.height).data, pts = [], step = Math.max(2, Math.round(2 * d));
      for (let y = 0; y < c.height; y += step) for (let x = 0; x < c.width; x += step) if (img[(y * c.width + x) * 4 + 3] > 120) pts.push(x / d, y / d);
      it.pts = pts;
    }
    frame(dt) {
      this.t += dt;
      const vh = innerHeight, d = this.d, P = this.P, ctx = this.ctx, t = this.t;
      ctx.clearRect(0, 0, this.c.width, this.c.height);
      let changed = false, partial = false, headPartial = false;
      const docH = document.documentElement.scrollHeight, endBoost = clamp(1 - (docH - (scrollY + vh)) / 140, 0, 1);
      for (const it of this.items) {
        if (!it.el.isConnected) continue;
        const r = it.el.getBoundingClientRect();
        const enter = it.kind === 'heading' ? 0.92 : 0.97, span = it.kind === 'heading' ? 0.3 : it.kind === 'bar' ? 0.42 : 0.3;
        let p = motion.reduced ? 1 : clamp((vh * enter - r.top) / (vh * span), 0, 1);
        if (it.kind === 'line') p = motion.reduced ? 1 : clamp((vh * 0.78 - r.top) / r.height, 0, 1);
        if (r.top < vh) p = Math.max(p, endBoost);
        if (p !== it.p) { changed = true; it.p = p; it.dirty = true; }
        if (p > 0 && p < 1) partial = true;
        const onScreen = r.bottom > -40 && r.top < vh + 40;
        if (it.kind === 'wipe') {
          if (it.dirty) {
            const f = p * 1.15 - 0.06, m = p >= 1 ? '' : `linear-gradient(90deg, #000 ${((f - 0.05) * 100).toFixed(1)}%, transparent ${(f * 100).toFixed(1)}%)`;
            it.el.style.maskImage = m; it.el.style.webkitMaskImage = m;
          }
          if (p > 0 && p < 1 && onScreen) {
            const f = p * 1.15 - 0.06, fx = r.left + f * r.width, n = Math.min(70, Math.max(10, r.height / 2));
            for (let k = 0; k < n; k++) {
              const h1 = hash(it.i * 97 + k), h2 = hash(it.i * 31 + k * 7);
              const y = r.top + h1 * r.height, x = fx + (h2 - 0.5) * 8 + Math.sin(t * 5 + k) * 1.5;
              P.add(k % 3 ? 'm' : 't', 0.8 + h2 * 0.45, x * d, y * d, d * (1.2 + h1));
              if (k % 4 === 0) P.add('f', 1, (fx + 6 + h2 * 26 + ((t * 30 + k * 5) % 14)) * d, (y + Math.sin(t * 2 + k) * 3) * d, d * 1.3);
            }
          }
        } else if (it.kind === 'heading') {
          const e = smooth(p);
          if (it.dirty) it.el.style.opacity = clamp((e - 0.82) / 0.18, 0, 1).toFixed(3);
          if (e < 1 && e > 0 && onScreen) {
            headPartial = true;
            if (!it.pts) this.sample(it, r);
            const pts = it.pts;
            for (let k = 0, j = 0; k < pts.length; k += 2, j++) {
              const h1 = hash(j + it.i * 1000), h2 = hash(j * 3 + 7), ei = smooth(p * 1.5 - h1 * 0.5);
              if (ei >= 1 && e > 0.97) continue;
              const ang = h2 * TAU + (1 - ei) * 1.6, dist = (40 + h1 * 160) * (1 - ei);
              const drift = 1 - ei, x = r.left + pts[k] + Math.cos(ang) * dist + Math.sin(t * 1.3 + j) * 4 * drift, y = r.top + pts[k + 1] + Math.sin(ang) * dist * 0.6 + drift * 50 + Math.cos(t * 1.1 + j * 0.7) * 3 * drift;
              P.add(ei > 0.66 ? 't' : ei > 0.25 ? 'm' : 'f', 0.85 + h2 * 0.35, x * d, y * d, d * 1.4);
            }
          }
        } else if (it.kind === 'count') {
          if (it.dirty) it.el.textContent = Math.round(it.end * smooth(p));
        } else if (it.kind === 'prog') {
          if (it.dirty) it.el.style.setProperty('--p', smooth(p).toFixed(3));
        } else if (it.kind === 'bar') {
          if (it.dirty) it.el.style.setProperty('--p', smooth(p).toFixed(3));
          if (p > 0 && p < 1 && onScreen) {
            const est = it.est || (it.est = it.el.querySelector('.cbar .est'));
            const br = est.getBoundingClientRect(), ex = br.right, ey = br.top + br.height / 2;
            for (let k = 0; k < 18; k++) {
              const h1 = hash(it.i * 13 + k), u = (h1 + t * 0.9) % 1;
              P.add(u < 0.7 ? 'm' : 'f', 1, (ex + 2 + h1 * 6) * d, (ey - 6 + u * 22) * d, d * 1.5);
            }
            for (let k = 0; k < 10; k++) P.add('t', 1.1, (ex - 1 + (hash(k + it.i) - 0.5) * 4) * d, (ey + (hash(k * 5) - 0.5) * br.height) * d, d * 1.6);
          }
        } else if (it.kind === 'line') {
          const tipY = r.top + p * r.height, lx = r.left + 76.5;
          if (it.dirty) {
            it.el.style.setProperty('--tl', p.toFixed(3));
            it.el.querySelectorAll('.tl').forEach((li) => { const dot = li.querySelector('.tl-dot').getBoundingClientRect(); li.classList.toggle('lit', dot.top + 4 <= tipY); });
          }
          if (p > 0 && p < 1 && onScreen) {
            const len = p * r.height;
            for (let k = 0; k < 40; k++) { const u = (hash(k) + t * (0.25 + hash(k * 3) * 0.2)) % 1; P.add(u > 0.85 ? 'f' : 'm', 1, (lx + (hash(k * 7) - 0.5) * 2.5) * d, (r.top + u * len) * d, d * 1.5); }
            for (let k = 0; k < 16; k++) { const a = hash(k * 11) * Math.PI, rr = hash(k * 5) * 7; P.add('t', 1.1, (lx + Math.cos(a) * rr) * d, (tipY - Math.sin(a) * rr * 0.4) * d, d * 1.6); }
          }
        }
        it.dirty = false;
      }
      P.flush(ctx);
      if (changed) this.lastChange = t;
      if (!changed && !headPartial && (!partial || t - this.lastChange > 1.2)) { if ((this.idle += dt) > 0.3) { loop.remove(this.fn); ctx.clearRect(0, 0, this.c.width, this.c.height); } }
      else this.idle = 0;
    }
  }

  // ---- Sand pile: the only fill a chosen pill gets. Grains fall from the top edge and pile up on the floor. ----
  const PILE_COLORS = ['rgba(232,236,242,0.72)', 'rgba(196,202,212,0.5)', 'rgba(165,171,182,0.38)'];
  class SandPile {
    constructor(btn) {
      this.btn = btn; btn._pile = this;
      this.c = document.createElement('canvas'); this.c.className = 'pile'; this.c.setAttribute('aria-hidden', 'true');
      btn.insertBefore(this.c, btn.firstChild);
      this.ctx = this.c.getContext('2d'); this.bake = document.createElement('canvas'); this.bctx = this.bake.getContext('2d');
      this.falling = []; this.toSpawn = 0; this.on = false; this.fn = (dt) => this.frame(dt);
    }
    size() {
      const d = DPR(), w = this.btn.clientWidth, h = this.btn.clientHeight;
      if (!w || !h) return false;
      if (w !== this.w || h !== this.h) {
        this.w = w; this.h = h; this.d = d;
        this.c.width = this.bake.width = Math.round(w * d); this.c.height = this.bake.height = Math.round(h * d);
        this.cols = new Float32Array(Math.ceil(w / 2)); this.bctx.clearRect(0, 0, this.bake.width, this.bake.height);
      }
      return true;
    }
    // Floor of the pill at x (its rounded ends curve up), in CSS px.
    floor(x) {
      const r = Math.min(this.h / 2, this.w / 2), h = this.h;
      if (x < r) return r + Math.sqrt(Math.max(0, r * r - (r - x) * (r - x))) - 3;
      if (x > this.w - r) { const dx = x - (this.w - r); return r + Math.sqrt(Math.max(0, r * r - dx * dx)) - 3; }
      return h - 3;
    }
    settle(x, y, sz, b) {
      const g = this.bctx, d = this.d;
      g.fillStyle = PILE_COLORS[b]; g.fillRect((x - sz / 2) * d, (y - sz / 2) * d, sz * d, sz * d);
    }
    target() { return Math.min(1500, Math.round(this.w * 4.2)); }
    set(on, instant) {
      if (on === this.on && !instant) return;
      this.on = on;
      if (!this.size()) { requestAnimationFrame(() => this.set(on, instant)); this.on = !on; return; }
      if (on) {
        this.c.style.opacity = '1';
        this.cols.fill(0); this.bctx.clearRect(0, 0, this.bake.width, this.bake.height); this.falling = [];
        if (instant || motion.reduced) {
          for (let i = 0; i < this.target(); i++) this.drop(Math.random() * this.w, true);
          this.draw();
        } else { this.toSpawn = this.target(); loop.add(this.fn); }
      } else {
        this.toSpawn = 0; this.falling = [];
        this.c.style.opacity = '0';
        setTimeout(() => { if (!this.on) { this.cols.fill(0); this.bctx.clearRect(0, 0, this.bake.width, this.bake.height); this.ctx.clearRect(0, 0, this.c.width, this.c.height); } }, 380);
      }
    }
    // Land a grain at column x, sliding toward a lower neighbor like real sand.
    drop(x, place) {
      const n = this.cols.length;
      let c = clamp(Math.floor(x / 2), 0, n - 1);
      for (let k = 0; k < 3; k++) {
        const l = c > 0 ? this.cols[c - 1] : 1e9, r = c < n - 1 ? this.cols[c + 1] : 1e9;
        if (Math.min(l, r) + 1.6 < this.cols[c]) c = l < r ? c - 1 : c + 1; else break;
      }
      const gx = c * 2 + 1, y = this.floor(gx) - this.cols[c];
      if (y < this.h * 0.7) return false;
      this.cols[c] += 0.9;
      if (place) this.settle(gx + (Math.random() - 0.5), y, 1.5 + Math.random() * 0.7, Math.random() < 0.35 ? 0 : Math.random() < 0.6 ? 1 : 2);
      return { x: gx, y };
    }
    draw() {
      const ctx = this.ctx, d = this.d;
      ctx.clearRect(0, 0, this.c.width, this.c.height);
      ctx.drawImage(this.bake, 0, 0);
      for (const g of this.falling) { ctx.fillStyle = PILE_COLORS[g.b]; ctx.fillRect((g.x - g.sz / 2) * d, (g.y - g.sz / 2) * d, g.sz * d, g.sz * d); }
    }
    frame(dt) {
      if (!this.btn.isConnected || !this.on) { loop.remove(this.fn); return; }
      const inset = Math.min(this.h / 2, 24);
      const per = Math.ceil(this.target() / 42);
      for (let k = 0; k < per && this.toSpawn > 0; k++, this.toSpawn--) {
        this.falling.push({ x: inset + Math.random() * (this.w - inset * 2), y: 2 + Math.random() * 3, vy: 20 + Math.random() * 50, vx: (Math.random() - 0.5) * 14, sz: 1.5 + Math.random() * 0.7, b: Math.random() < 0.35 ? 0 : Math.random() < 0.6 ? 1 : 2 });
      }
      const keep = [];
      for (const g of this.falling) {
        g.vy += 1100 * dt; g.y += g.vy * dt; g.x = clamp(g.x + g.vx * dt, 1, this.w - 1);
        const c = clamp(Math.floor(g.x / 2), 0, this.cols.length - 1), fl = this.floor(c * 2 + 1) - this.cols[c];
        if (g.y >= fl) { const spot = this.drop(g.x, false); if (spot) this.settle(spot.x + (Math.random() - 0.5), spot.y, g.sz, g.b); }
        else keep.push(g);
      }
      this.falling = keep;
      this.draw();
      if (!this.falling.length && this.toSpawn <= 0) loop.remove(this.fn);
    }
  }
  const isOn = (b) => ['aria-checked', 'aria-pressed', 'aria-selected'].some((a) => b.getAttribute(a) === 'true');
  // Give every choice pill under root a sand pile; selection changes anywhere drive it.
  function piles(root, sel) {
    root.querySelectorAll(sel).forEach((b) => { if (!b._pile) { new SandPile(b); if (isOn(b)) b._pile.set(true, true); } });
  }
  new MutationObserver((ms) => { for (const m of ms) { const b = m.target; if (b._pile) b._pile.set(isOn(b)); } })
    .observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['aria-checked', 'aria-pressed', 'aria-selected'] });

  window.SKY = { Planet, Sky, SandFX, SandTrack, Scene, ScrollSand, Painter, piles, loop, motion, portrait, hashStr, DPR, quality, tintFromHex };
})();
