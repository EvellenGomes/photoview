/* PhotoView — filtros de pixel. Cada função recebe um ImageData e o modifica no lugar. */
(function () {
  const clamp = v => v < 0 ? 0 : v > 255 ? 255 : v;

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  function hslToRgb(h, s, l) {
    if (s === 0) { const v = l * 255; return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
  }

  // ---- desfoque gaussiano aproximado (3 passes de box blur, alfa pré-multiplicado)
  function boxesForGauss(sigma, n) {
    const wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
    let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
    const wu = wl + 2;
    const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
    const m = Math.round(mIdeal);
    const sizes = [];
    for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
    return sizes;
  }
  function boxBlurH(src, dst, w, h, r) {
    const iarr = 1 / (r + r + 1);
    for (let i = 0; i < h; i++) {
      for (let c = 0; c < 4; c++) {
        let ti = i * w, li = ti, ri = ti + r;
        const fv = src[ti * 4 + c], lv = src[(ti + w - 1) * 4 + c];
        let val = (r + 1) * fv;
        for (let j = 0; j < r; j++) val += src[(ti + Math.min(j, w - 1)) * 4 + c];
        for (let j = 0; j <= r; j++) { val += src[ri * 4 + c] - fv; ri++; dst[ti * 4 + c] = val * iarr; ti++; }
        for (let j = r + 1; j < w - r; j++) { val += src[ri * 4 + c] - src[li * 4 + c]; ri++; li++; dst[ti * 4 + c] = val * iarr; ti++; }
        for (let j = Math.max(w - r, r + 1); j < w; j++) { val += lv - src[li * 4 + c]; li++; dst[ti * 4 + c] = val * iarr; ti++; }
      }
    }
  }
  function boxBlurT(src, dst, w, h, r) {
    const iarr = 1 / (r + r + 1);
    for (let i = 0; i < w; i++) {
      for (let c = 0; c < 4; c++) {
        let ti = i, li = ti, ri = ti + r * w;
        const fv = src[ti * 4 + c], lv = src[(ti + w * (h - 1)) * 4 + c];
        let val = (r + 1) * fv;
        for (let j = 0; j < r; j++) val += src[(ti + Math.min(j, h - 1) * w) * 4 + c];
        for (let j = 0; j <= r; j++) { val += src[ri * 4 + c] - fv; ri += w; dst[ti * 4 + c] = val * iarr; ti += w; }
        for (let j = r + 1; j < h - r; j++) { val += src[ri * 4 + c] - src[li * 4 + c]; li += w; ri += w; dst[ti * 4 + c] = val * iarr; ti += w; }
        for (let j = Math.max(h - r, r + 1); j < h; j++) { val += lv - src[li * 4 + c]; li += w; dst[ti * 4 + c] = val * iarr; ti += w; }
      }
    }
  }
  function gaussianBlur(img, sigma) {
    if (sigma < 0.3) return;
    const { data, width: w, height: h } = img;
    const a = new Float32Array(data.length), b = new Float32Array(data.length);
    for (let i = 0; i < data.length; i += 4) {
      const al = data[i + 3] / 255;
      a[i] = data[i] * al; a[i + 1] = data[i + 1] * al; a[i + 2] = data[i + 2] * al; a[i + 3] = data[i + 3];
    }
    for (const size of boxesForGauss(sigma, 3)) {
      const r = Math.min((size - 1) / 2, Math.floor((Math.min(w, h) - 1) / 2));
      if (r < 1) continue;
      boxBlurH(a, b, w, h, r);
      boxBlurT(b, a, w, h, r);
    }
    for (let i = 0; i < data.length; i += 4) {
      const al = a[i + 3];
      const k = al > 0 ? 255 / al : 0;
      data[i] = clamp(a[i] * k); data[i + 1] = clamp(a[i + 1] * k); data[i + 2] = clamp(a[i + 2] * k); data[i + 3] = clamp(al);
    }
  }

  // desfoque gaussiano aproximado para um canal em ponto flutuante (no lugar)
  function boxH1(src, dst, w, h, r) {
    const iarr = 1 / (r + r + 1);
    for (let i = 0; i < h; i++) {
      let ti = i * w, li = ti, ri = ti + r;
      const fv = src[ti], lv = src[ti + w - 1];
      let val = (r + 1) * fv;
      for (let j = 0; j < r; j++) val += src[ti + j];
      for (let j = 0; j <= r; j++) { val += src[ri++] - fv; dst[ti++] = val * iarr; }
      for (let j = r + 1; j < w - r; j++) { val += src[ri++] - src[li++]; dst[ti++] = val * iarr; }
      for (let j = w - r; j < w; j++) { val += lv - src[li++]; dst[ti++] = val * iarr; }
    }
  }
  function boxT1(src, dst, w, h, r) {
    const iarr = 1 / (r + r + 1);
    for (let i = 0; i < w; i++) {
      let ti = i, li = ti, ri = ti + r * w;
      const fv = src[ti], lv = src[ti + w * (h - 1)];
      let val = (r + 1) * fv;
      for (let j = 0; j < r; j++) val += src[ti + j * w];
      for (let j = 0; j <= r; j++) { val += src[ri] - fv; dst[ti] = val * iarr; ri += w; ti += w; }
      for (let j = r + 1; j < h - r; j++) { val += src[ri] - src[li]; dst[ti] = val * iarr; li += w; ri += w; ti += w; }
      for (let j = h - r; j < h; j++) { val += lv - src[li]; dst[ti] = val * iarr; li += w; ti += w; }
    }
  }
  function blurFloat(arr, w, h, sigma) {
    const tmp = new Float32Array(arr.length), maxR = Math.floor((Math.min(w, h) - 1) / 2);
    for (const size of boxesForGauss(sigma, 3)) {
      const r = Math.min((size - 1) / 2, maxR);
      if (r < 1) continue;
      boxH1(arr, tmp, w, h, r); boxT1(tmp, arr, w, h, r);
    }
  }

  function convolve(img, kernel, bias = 0) {
    const { data, width: w, height: h } = img;
    const src = new Uint8ClampedArray(data);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, k = 0;
        for (let ky = -1; ky <= 1; ky++) {
          const yy = Math.min(h - 1, Math.max(0, y + ky));
          for (let kx = -1; kx <= 1; kx++) {
            const xx = Math.min(w - 1, Math.max(0, x + kx));
            const i = (yy * w + xx) * 4, kv = kernel[k++];
            r += src[i] * kv; g += src[i + 1] * kv; b += src[i + 2] * kv;
          }
        }
        const o = (y * w + x) * 4;
        data[o] = clamp(r + bias); data[o + 1] = clamp(g + bias); data[o + 2] = clamp(b + bias);
      }
    }
  }

  // curva por pontos [[entrada, saída], ...] → tabela de 256 valores (spline cúbica monotônica, sem "ondas")
  function curveLUT(points) {
    const pts = points.slice().sort((a, b) => a[0] - b[0]);
    const n = pts.length, lut = new Uint8ClampedArray(256);
    if (n === 1) { lut.fill(pts[0][1]); return lut; }
    const x = pts.map(p => p[0]), y = pts.map(p => p[1]);
    const d = [], m = new Array(n);
    for (let k = 0; k < n - 1; k++) d[k] = (y[k + 1] - y[k]) / Math.max(1e-6, x[k + 1] - x[k]);
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
    for (let k = 0; k < n - 1; k++) {
      if (d[k] === 0) { m[k] = 0; m[k + 1] = 0; continue; }
      const a = m[k] / d[k], b = m[k + 1] / d[k], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[k] = t * a * d[k]; m[k + 1] = t * b * d[k]; }
    }
    let k = 0;
    for (let v = 0; v < 256; v++) {
      if (v <= x[0]) { lut[v] = y[0]; continue; }
      if (v >= x[n - 1]) { lut[v] = y[n - 1]; continue; }
      while (v > x[k + 1]) k++;
      const h = x[k + 1] - x[k], t = (v - x[k]) / h, t2 = t * t, t3 = t2 * t;
      lut[v] = (2 * t3 - 3 * t2 + 1) * y[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * y[k + 1] + (t3 - t2) * h * m[k + 1];
    }
    return lut;
  }

  const F = {
    curves(img, { curves }) {
      const all = curveLUT(curves.rgb), r = curveLUT(curves.r), g = curveLUT(curves.g), b = curveLUT(curves.b);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) { d[i] = all[r[d[i]]]; d[i + 1] = all[g[d[i + 1]]]; d[i + 2] = all[b[d[i + 2]]]; }
    },
    brightness(img, { brightness = 0, contrast = 0 }) {
      const d = img.data, b = brightness * 2.55;
      const c = contrast * 2.55, f = (259 * (c + 255)) / (255 * (259 - c));
      for (let i = 0; i < d.length; i += 4) {
        d[i] = clamp(f * (d[i] + b - 128) + 128);
        d[i + 1] = clamp(f * (d[i + 1] + b - 128) + 128);
        d[i + 2] = clamp(f * (d[i + 2] + b - 128) + 128);
      }
    },
    levels(img, { black = 0, white = 255, gamma = 1 }) {
      const lut = new Uint8ClampedArray(256), range = Math.max(1, white - black);
      for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(Math.min(1, Math.max(0, (v - black) / range)), 1 / gamma);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    },
    hsl(img, { hue = 0, saturation = 0, lightness = 0 }) {
      const d = img.data, hs = hue / 360, sm = saturation / 100, lm = lightness / 100;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        let [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        h = (h + hs + 1) % 1;
        s = sm >= 0 ? s + (1 - s) * sm * s : s * (1 + sm);
        l = lm >= 0 ? l + (1 - l) * lm : l * (1 + lm);
        const [r, g, b] = hslToRgb(h, Math.min(1, Math.max(0, s)), l);
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
    },
    threshold(img, { level = 128 }) {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) >= level ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    },
    posterize(img, { levels = 4 }) {
      const d = img.data, n = Math.max(2, levels) - 1;
      for (let i = 0; i < d.length; i += 4)
        for (let c = 0; c < 3; c++) d[i + c] = Math.round(Math.round(d[i + c] / 255 * n) / n * 255);
    },
    invert(img) {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
    },
    desaturate(img) {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) { const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = v; }
    },
    sepia(img) {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        d[i] = clamp(r * .393 + g * .769 + b * .189);
        d[i + 1] = clamp(r * .349 + g * .686 + b * .168);
        d[i + 2] = clamp(r * .272 + g * .534 + b * .131);
      }
    },
    autolevels(img) {
      const d = img.data, hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
      let count = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 8) continue; count++; for (let c = 0; c < 3; c++) hist[c][d[i + c]]++; }
      if (!count) return;
      const clip = count * 0.005;
      const luts = hist.map(hh => {
        let lo = 0, hi = 255, acc = 0;
        while (lo < 255 && (acc += hh[lo]) <= clip) lo++;
        acc = 0;
        while (hi > 0 && (acc += hh[hi]) <= clip) hi--;
        const lut = new Uint8ClampedArray(256), range = Math.max(1, hi - lo);
        for (let v = 0; v < 256; v++) lut[v] = (v - lo) / range * 255;
        return lut;
      });
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = luts[c][d[i + c]];
    },
    blur(img, { radius = 4 }) { gaussianBlur(img, radius); },
    sharpen(img, { amount = 80, radius = 1.5 }) {
      const orig = new Uint8ClampedArray(img.data);
      gaussianBlur(img, radius);
      const d = img.data, k = amount / 100;
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) d[i + c] = clamp(orig[i + c] + (orig[i + c] - d[i + c]) * k);
        d[i + 3] = orig[i + 3];
      }
    },
    noise(img, { amount = 20, mono = true }) {
      const d = img.data, a = amount * 2.55;
      for (let i = 0; i < d.length; i += 4) {
        if (mono) { const n = (Math.random() - .5) * a; d[i] = clamp(d[i] + n); d[i + 1] = clamp(d[i + 1] + n); d[i + 2] = clamp(d[i + 2] + n); }
        else for (let c = 0; c < 3; c++) d[i + c] = clamp(d[i + c] + (Math.random() - .5) * a);
      }
    },
    pixelate(img, { size = 10 }) {
      const { data: d, width: w, height: h } = img, s = Math.max(1, size | 0);
      for (let by = 0; by < h; by += s) for (let bx = 0; bx < w; bx += s) {
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        const ey = Math.min(h, by + s), ex = Math.min(w, bx + s);
        for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const i = (y * w + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; n++; }
        r /= n; g /= n; b /= n; a /= n;
        for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; }
      }
    },
    emboss(img) { convolve(img, [-2, -1, 0, -1, 1, 1, 0, 1, 2]); },
    edges(img) { convolve(img, [-1, -1, -1, -1, 8, -1, -1, -1, -1]); },
  };

  window.Filters = F;
  window.curveLUT = curveLUT;
  window.blurFloat = blurFloat;
})();
