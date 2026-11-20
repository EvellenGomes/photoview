/* PhotoView — editor de imagens web (estilo Photoshop) em canvas puro. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const ws = $('#workspace'), stage = $('#stage'), viewCv = $('#view'), overlay = $('#overlay');
  const vctx = viewCv.getContext('2d');
  const octx = overlay.getContext('2d');
  const modal = $('#modal');

  // ---------- utilidades
  const newCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
  const ctxOf = c => c.getContext('2d', { willReadFrequently: true });
  const cloneCanvas = src => { const c = newCanvas(src.width, src.height); ctxOf(c).drawImage(src, 0, 0); return c; };
  const hexToRgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const fg = () => $('#colorFg').value;
  const bg = () => $('#colorBg').value;
  let msgTimer;
  const status = m => { $('#stMsg').textContent = m; clearTimeout(msgTimer); msgTimer = setTimeout(() => $('#stMsg').textContent = '', 3500); };
  const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };

  // ---------- documento e camadas
  const doc = { w: 0, h: 0, layers: [], active: 0, name: 'sem-titulo' };
  let uid = 0, revCounter = 0;
  const active = () => doc.layers[doc.active];
  const touch = L => { L.rev = ++revCounter; };
  const makeLayer = (name, canvas) => ({ id: ++uid, name, canvas: canvas || newCanvas(doc.w, doc.h), visible: true, opacity: 1, blend: 'source-over', mask: null, maskOn: true, maskEdit: false, pid: 0, rev: ++revCounter });
  // a camada nova entra no mesmo grupo (mesmo pai) da camada ativa
  const insertLayer = L => { const A = active(); L.pid = A ? (A.pid || 0) : 0; doc.layers.splice(doc.active + 1, 0, L); doc.active++; };

  const strokeCv = newCanvas(1, 1), scratch = newCanvas(1, 1), maskTmp = newCanvas(1, 1), maskPrev = newCanvas(1, 1);
  const clonePaint = newCanvas(1, 1), cloneOut = newCanvas(1, 1); // carimbo: origem deslocada e resultado recortado
  const adjTmp = newCanvas(1, 1); // camada de ajuste já recortada pela máscara
  const clipA = newCanvas(1, 1), clipB = newCanvas(1, 1), clipC = newCanvas(1, 1); // máscara de recorte: grupo, alfa da base, camada recortada

  function setDocSize(w, h) {
    doc.w = w; doc.h = h;
    for (const c of [viewCv, strokeCv, scratch, maskTmp, maskPrev, clonePaint, cloneOut, adjTmp, clipA, clipB, clipC]) { c.width = w; c.height = h; }
    stage.style.width = w + 'px'; stage.style.height = h + 'px';
    $('#stSize').textContent = `${w} × ${h} px`;
    if (typeof tool !== 'undefined' && tool === 'crop') initCrop(); // documento mudou: caixa volta ao tamanho todo
  }

  // ---------- estilos de camada (não destrutivos, recalculados a partir do conteúdo)
  const FX_DEFAULTS = {
    dropShadow: { on: false, color: '#000000', opacity: 75, angle: 120, distance: 10, spread: 0, size: 10 },
    outerGlow: { on: false, color: '#ffffbe', opacity: 75, spread: 10, size: 15 },
    innerShadow: { on: false, color: '#000000', opacity: 75, angle: 120, distance: 5, size: 5 },
    colorOverlay: { on: false, color: '#ff0000', opacity: 100 },
    gradOverlay: { on: false, style: 'linear', color1: '#ffffff', color2: '#000000', opacity: 100, angle: 90, scale: 100, reverse: 'no' },
    bevel: { on: false, style: 'inner', technique: 'smooth', direction: 'up', depth: 100, size: 8, soften: 1, angle: 120, hlColor: '#ffffff', hlOpacity: 75, shColor: '#000000', shOpacity: 75 },
    stroke: { on: false, color: '#000000', opacity: 100, size: 3, position: 'outside' },
  };
  const hasFx = L => !!L.fx && Object.values(L.fx).some(e => e.on);
  const INF = 1e20;
  function edt1d(f, n, d, v, z) {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const dq = q - v[k]; d[q] = dq * dq + f[v[k]]; }
  }
  // distância euclidiana de cada pixel até o pixel "feature" mais próximo
  function edt(feature, w, h) {
    const n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    const g = new Float64Array(w * h);
    for (let i = 0; i < g.length; i++) g[i] = feature[i] ? 0 : INF;
    for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1d(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
    for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) f[x] = g[o + x]; edt1d(f, w, d, v, z); for (let x = 0; x < w; x++) g[o + x] = Math.sqrt(d[x]); }
    return g;
  }
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  function alphaCanvas(alphaFn, n, color) {
    const img = new ImageData(doc.w, doc.h), d = img.data, [r, g, b] = hexToRgb(color);
    for (let p = 0; p < n; p++) { const a = alphaFn(p); if (a > 0) { const i = p * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a * 255; } }
    const c = newCanvas(doc.w, doc.h); c.getContext('2d').putImageData(img, 0, 0); return c;
  }
  function castShadow(ctx, shape, color, alpha, blur, dx, dy) {
    const [r, g, b] = hexToRgb(color), OFF = shape.width + blur * 4 + Math.abs(dx) + 100;
    ctx.save();
    ctx.shadowColor = `rgba(${r},${g},${b},${alpha})`; ctx.shadowBlur = blur;
    ctx.shadowOffsetX = dx + OFF; ctx.shadowOffsetY = dy;
    ctx.drawImage(shape, -OFF, 0);
    ctx.restore();
  }
  function renderFx(fx, src) {
    const w = doc.w, h = doc.h, n = w * h;
    const a = ctxOf(src).getImageData(0, 0, w, h).data;
    const inside = new Uint8Array(n);
    for (let p = 0; p < n; p++) inside[p] = a[p * 4 + 3] >= 128 ? 1 : 0;
    let distOut = null, distIn = null;
    const dOut = () => distOut || (distOut = edt(inside, w, h));
    const dIn = () => { if (!distIn) { const o = new Uint8Array(n); for (let p = 0; p < n; p++) o[p] = 1 - inside[p]; distIn = edt(o, w, h); } return distIn; };
    const dilated = r => { const d = dOut(); return alphaCanvas(p => inside[p] ? Math.max(a[p * 4 + 3] / 255, 1) : clamp01(r + 0.5 - d[p]), n, '#000000'); };
    const off = e => [-Math.cos(e.angle * Math.PI / 180) * e.distance, Math.sin(e.angle * Math.PI / 180) * e.distance];
    const out = newCanvas(w, h), o = out.getContext('2d');
    const glowLike = (e, dx, dy) => {
      const spread = e.size * e.spread / 100, blur = e.size - spread;
      castShadow(o, spread >= 0.5 ? dilated(spread) : src, e.color, e.opacity / 100, blur, dx, dy);
    };
    if (fx.dropShadow.on) { const [dx, dy] = off(fx.dropShadow); glowLike(fx.dropShadow, dx, dy); }
    if (fx.outerGlow.on) glowLike(fx.outerGlow, 0, 0);
    const st = fx.stroke, half = st.position === 'center' ? st.size / 2 : st.size;
    if (st.on && st.position !== 'inside') {
      const d = dOut(), di = dIn();
      o.globalAlpha = st.opacity / 100;
      // por dentro só uma faixa de ~1,5 px (cobre a borda suavizada sem escurecer áreas semitransparentes)
      o.drawImage(alphaCanvas(p => inside[p] ? (di[p] <= 1.5 ? 1 : 0) : clamp01(half + 0.5 - d[p]), n, st.color), 0, 0);
      o.globalAlpha = 1;
    }
    o.drawImage(src, 0, 0);
    if (fx.innerShadow.on) {
      const e = fx.innerShadow, [dx, dy] = off(e), m = Math.ceil(e.size * 2 + e.distance + 2);
      const inv = newCanvas(w + 2 * m, h + 2 * m), ic = inv.getContext('2d');
      ic.fillRect(0, 0, inv.width, inv.height);
      ic.globalCompositeOperation = 'destination-out'; ic.drawImage(src, m, m);
      const t = newCanvas(w, h), tc = t.getContext('2d');
      castShadow(tc, inv, e.color, e.opacity / 100, e.size, dx - m, dy - m);
      tc.globalCompositeOperation = 'destination-in'; tc.drawImage(src, 0, 0);
      o.drawImage(t, 0, 0);
    }
    if (fx.colorOverlay.on) {
      const t = newCanvas(w, h), tc = t.getContext('2d');
      tc.drawImage(src, 0, 0); tc.globalCompositeOperation = 'source-in';
      tc.fillStyle = fx.colorOverlay.color; tc.fillRect(0, 0, w, h);
      o.globalAlpha = fx.colorOverlay.opacity / 100; o.drawImage(t, 0, 0); o.globalAlpha = 1;
    }
    const go = fx.gradOverlay; // layers antigas podem não ter o efeito
    if (go && go.on) {
      // o degradê é mapeado sobre a caixa dos pixels visíveis da camada e recortado pelo formato dela
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0, p = 3; y < h; y++) for (let x = 0; x < w; x++, p += 4) if (a[p] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 >= 0) {
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1, cx = x0 + bw / 2, cy = y0 + bh / 2, sc = Math.max(0.05, go.scale / 100);
        const ang = go.angle * Math.PI / 180, dx = Math.cos(ang), dy = Math.sin(ang);
        const c1 = go.reverse === 'yes' ? go.color2 : go.color1, c2 = go.reverse === 'yes' ? go.color1 : go.color2;
        const t = newCanvas(w, h), tc = t.getContext('2d');
        tc.drawImage(src, 0, 0); tc.globalCompositeOperation = 'source-in';
        let g;
        if (go.style === 'radial') {
          g = tc.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, Math.hypot(bw, bh) / 2 * sc));
          g.addColorStop(0, c1); g.addColorStop(1, c2);
        } else {
          const half = Math.max(1, (Math.abs(dx) * bw + Math.abs(dy) * bh) / 2 * sc);
          g = tc.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
          if (go.style === 'reflected') { g.addColorStop(0, c2); g.addColorStop(0.5, c1); g.addColorStop(1, c2); }
          else { g.addColorStop(0, c1); g.addColorStop(1, c2); }
        }
        tc.fillStyle = g; tc.fillRect(0, 0, w, h);
        o.globalAlpha = go.opacity / 100; o.drawImage(t, 0, 0); o.globalAlpha = 1;
      }
    }
    const bv = fx.bevel; // layers antigas podem não ter o efeito
    if (bv && bv.on) {
      /* Chanfro e relevo: a altura sobe da borda para dentro (interno), para fora (externo) ou dos dois lados (relevo);
         a luz bate na inclinação da superfície: lado voltado para a luz ganha realce, o oposto ganha sombra. */
      const size = Math.max(1, bv.size), dI = bv.style !== 'outer' ? dIn() : null, dO = bv.style !== 'inner' ? dOut() : null;
      const hmap = new Float32Array(n);
      for (let p = 0; p < n; p++) {
        let hv;
        if (bv.style === 'inner') hv = inside[p] ? Math.min(1, dI[p] / size) : 0;
        else if (bv.style === 'outer') hv = inside[p] ? 1 : Math.max(0, 1 - dO[p] / size);
        else hv = inside[p] ? 0.5 + Math.min(0.5, dI[p] / (2 * size)) : 0.5 - Math.min(0.5, dO[p] / (2 * size));
        hmap[p] = bv.technique === 'chisel' ? hv : Math.sqrt(Math.max(0, 1 - (1 - hv) * (1 - hv))); // suave = quarto de círculo
      }
      if (bv.soften > 0.3) blurFloat(hmap, w, h, bv.soften);
      const ang = bv.angle * Math.PI / 180, lx = Math.cos(ang), ly = -Math.sin(ang);
      const k = bv.depth / 100 * size * 0.5 * (bv.direction === 'down' ? -1 : 1);
      const [hr, hg, hb] = hexToRgb(bv.hlColor), [sr, sg, sb] = hexToRgb(bv.shColor), hlO = bv.hlOpacity / 100, shO = bv.shOpacity / 100;
      const hi = new ImageData(w, h), si = new ImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = y * w + x, af = a[p * 4 + 3] / 255, mk = bv.style === 'inner' ? af : bv.style === 'outer' ? 1 - af : 1;
        if (mk <= 0.004) continue;
        const gx = (hmap[x < w - 1 ? p + 1 : p] - hmap[x > 0 ? p - 1 : p]) * k, gy = (hmap[y < h - 1 ? p + w : p] - hmap[y > 0 ? p - w : p]) * k;
        const sh = -(gx * lx + gy * ly), i = p * 4;
        if (sh > 0.004) { hi.data[i] = hr; hi.data[i + 1] = hg; hi.data[i + 2] = hb; hi.data[i + 3] = Math.min(1, sh) * hlO * mk * 255; }
        else if (sh < -0.004) { si.data[i] = sr; si.data[i + 1] = sg; si.data[i + 2] = sb; si.data[i + 3] = Math.min(1, -sh) * shO * mk * 255; }
      }
      const hc = newCanvas(w, h), sc = newCanvas(w, h);
      hc.getContext('2d').putImageData(hi, 0, 0); sc.getContext('2d').putImageData(si, 0, 0);
      o.save();
      o.globalCompositeOperation = 'multiply'; o.drawImage(sc, 0, 0);
      o.globalCompositeOperation = 'screen'; o.drawImage(hc, 0, 0);
      o.restore();
    }
    if (st.on && st.position !== 'outside') {
      const d = dIn();
      o.globalAlpha = st.opacity / 100;
      o.drawImage(alphaCanvas(p => inside[p] ? clamp01(half + 0.5 - d[p]) * a[p * 4 + 3] / 255 : 0, n, st.color), 0, 0);
      o.globalAlpha = 1;
    }
    return out;
  }
  // camada com efeitos aplicados (com cache enquanto conteúdo e estilo não mudam)
  function styled(L, src, live) {
    if (live) {
      // prévia durante o traço: recalcula no máximo a cada 120 ms para o pincel não travar
      const now = performance.now();
      if (!L._fxLive || now - L._fxLive.t > 120) L._fxLive = { t: now, canvas: renderFx(L.fx, src) };
      if (now - L._fxLive.t > 0) requestRender();
      return L._fxLive.canvas;
    }
    L._fxLive = null;
    const key = `${L.rev}|${doc.w}x${doc.h}|${!!(L.mask && L.maskOn)}|${JSON.stringify(L.fx)}`;
    if (!L._fx || L._fx.key !== key) L._fx = { key, canvas: renderFx(L.fx, src) };
    return L._fx.canvas;
  }

  // ---------- máscaras de camada
  // a máscara é um canvas branco cujo ALFA é a visibilidade (opaco = visível)
  const lum = hex => { const [r, g, b] = hexToRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  const editingMask = () => { const L = active(); return !!(L && L.mask && L.maskEdit); };
  const targetCanvas = () => editingMask() ? active().mask : active().canvas;
  // novo alfa = alfa·(1 − cobertura) + valor  (cinza do pincel = valor/cobertura)
  function maskWrite(mask, cov, covAlpha, val, valAlpha) {
    const c = ctxOf(mask);
    c.save();
    c.globalAlpha = covAlpha; c.globalCompositeOperation = 'destination-out'; c.drawImage(cov, 0, 0);
    c.globalAlpha = valAlpha; c.globalCompositeOperation = 'lighter'; c.drawImage(val, 0, 0);
    c.restore();
  }
  function selCoverage() {
    const c = newCanvas(doc.w, doc.h);
    withSel(c.getContext('2d'), x => { x.fillStyle = '#fff'; x.fillRect(0, 0, doc.w, doc.h); });
    return c;
  }
  function newMask(fill) {
    const m = newCanvas(doc.w, doc.h);
    if (fill) { const c = m.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, doc.w, doc.h); }
    return m;
  }
  // camada já com máscara (cacheada)
  function maskedCached(L) {
    const key = `${L.rev}|${doc.w}x${doc.h}`;
    if (!L._mk || L._mk.key !== key) {
      const t = newCanvas(doc.w, doc.h), c = t.getContext('2d');
      c.drawImage(L.canvas, 0, 0); c.globalCompositeOperation = 'destination-in'; c.drawImage(L.mask, 0, 0);
      L._mk = { key, canvas: t };
    }
    return L._mk.canvas;
  }
  // resultado final da camada: conteúdo → máscara → estilos
  function layerRender(L) {
    let src = L.mask && L.maskOn ? maskedCached(L) : L.canvas;
    if (hasFx(L)) src = styled(L, src, false);
    return src;
  }
  // máscara ↔ imagem em tons de cinza (para filtros e ajustes)
  function maskToGray(img) { const d = img.data; for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = d[i + 3]; d[i + 3] = 255; } }
  function grayToMask(img) { const d = img.data; for (let i = 0; i < d.length; i += 4) { d[i + 3] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = 255; } }

  // ---------- renderização
  let stroke = null; // traço em andamento (pincel, borracha, degradê)
  // assinatura do que já foi composto (para o cache das camadas de ajuste)
  // ---------- grupos de camadas
  // Um grupo é uma camada "cabeçalho" (group:true) com os filhos logo abaixo na pilha (filho.pid = id do grupo).
  // Visibilidade e opacidade do grupo valem para os filhos (opacidade multiplicada); grupos podem ter grupos dentro.
  const pidOf = l => l.pid || 0;
  const groupById = id => id ? doc.layers.find(g => g.id === id && g.group) : null;
  function effVisible(L) { for (let g = groupById(pidOf(L)); g; g = groupById(pidOf(g))) if (!g.visible) return false; return L.visible; }
  function effOpacity(L) { let o = L.opacity; for (let g = groupById(pidOf(L)); g; g = groupById(pidOf(g))) o *= g.opacity; return o; }
  function descendantsOf(G) {
    const out = [], walk = id => { for (const L of doc.layers) if (pidOf(L) === id) { out.push(L); if (L.group) walk(L.id); } };
    walk(G.id); return out;
  }
  const blockOf = L => (L.group ? [...descendantsOf(L), L] : [L]).sort((a, b) => doc.layers.indexOf(a) - doc.layers.indexOf(b));
  const hiddenByCollapse = L => { for (let g = groupById(pidOf(L)); g; g = groupById(pidOf(g))) if (g.collapsed) return true; return false; };
  const depthOf = L => { let d = 0; for (let g = groupById(pidOf(L)); g; g = groupById(pidOf(g))) d++; return d; };
  const multi = new Set(); // ids das camadas selecionadas no painel (Ctrl/Shift+clique)
  const selectedLayers = () => multi.size > 1 ? doc.layers.filter(l => multi.has(l.id)) : [active()];
  let groupCount = 1;
  // reordena a pilha para cada grupo ficar contíguo logo abaixo do seu cabeçalho (irmãos mantêm a ordem atual)
  function normalizeGroups() {
    const act = doc.layers[doc.active], kids = new Map();
    for (const L of doc.layers) {
      if (L.pid && !groupById(L.pid)) L.pid = 0;
      const p = pidOf(L); if (!kids.has(p)) kids.set(p, []); kids.get(p).push(L);
    }
    const out = [], emit = p => { for (const L of (kids.get(p) || [])) { if (L.group) emit(L.id); out.push(L); } };
    emit(0);
    if (out.length === doc.layers.length) doc.layers = out;
    doc.active = Math.max(0, doc.layers.indexOf(act));
  }
  // move um bloco (camada ou grupo inteiro) para logo acima/abaixo de T, no mesmo nível de T
  function placeBlock(block, T, above) {
    const set = new Set(block); doc.layers = doc.layers.filter(l => !set.has(l));
    const tb = T.group ? [T, ...descendantsOf(T)] : [T], pos = tb.map(l => doc.layers.indexOf(l));
    doc.layers.splice(above ? Math.max(...pos) + 1 : Math.min(...pos), 0, ...block);
    block[block.length - 1].pid = pidOf(T);
    normalizeGroups();
  }
  // move um bloco para dentro do grupo G, no topo
  function placeInto(block, G) {
    const set = new Set(block); doc.layers = doc.layers.filter(l => !set.has(l));
    doc.layers.splice(doc.layers.indexOf(G), 0, ...block);
    block[block.length - 1].pid = G.id;
    normalizeGroups();
  }

  // Máscara de recorte: camada com clip:true só aparece onde a camada-base (a primeira não recortada logo abaixo,
  // no mesmo grupo) tem pixels. Devolve o índice da base ou -1.
  function clipBase(i) {
    const L = doc.layers[i];
    if (!L || !L.clip || L.group) return -1;
    for (let j = i - 1; j >= 0; j--) {
      const B = doc.layers[j];
      if (pidOf(B) !== pidOf(L) || B.group || B.adj) return -1;
      if (!B.clip) return j;
    }
    return -1;
  }
  const layerSig = L => `${L.id}.${L.rev}.${+!!L.clip}.${+effVisible(L)}.${effOpacity(L)}.${L.blend}.${+L.maskOn}.${L.fx ? JSON.stringify(L.fx) : ''}.${L.adj ? JSON.stringify(L.adj) : ''}|`;
  // ajuste aplicado sobre tudo o que está abaixo (lido do próprio canvas de destino)
  function adjustedBelow(ctx, L, sig, liveBelow) {
    const useCache = ctx.canvas === viewCv, c = L._adjC, now = performance.now();
    if (useCache && c && c.canvas.width === doc.w && c.canvas.height === doc.h && (c.sig === sig || (liveBelow && now - c.t < 150))) {
      if (c.sig !== sig) requestRender(); // traço em andamento abaixo: atualiza em breve
      return c.canvas;
    }
    const img = ctx.getImageData(0, 0, doc.w, doc.h);
    Filters[L.adj.name](img, L.adj.vals || {});
    const cv = useCache && c && c.canvas.width === doc.w && c.canvas.height === doc.h ? c.canvas : newCanvas(doc.w, doc.h);
    cv.getContext('2d').putImageData(img, 0, 0);
    if (useCache) L._adjC = { sig, t: now, canvas: cv };
    return cv;
  }
  // prévia da máscara enquanto ela é pintada
  function liveMask(L) {
    const m = ctxOf(maskPrev); m.clearRect(0, 0, doc.w, doc.h); m.drawImage(L.mask, 0, 0);
    maskWrite(maskPrev, stroke.cov || strokeCv, stroke.alpha, strokeContent(), stroke.alpha * stroke.gray);
    return maskPrev;
  }
  function composite(ctx, withStroke, clear = true, upTo = Infinity) {
    if (clear) ctx.clearRect(0, 0, doc.w, doc.h);
    if (withStroke && stroke) maskStroke();
    let sig = `${doc.w}x${doc.h}|`, liveBelow = false;
    const layers = doc.layers;
    // pixels finais de uma camada comum (máscara e estilo aplicados); durante o traço mostra a prévia ao vivo
    const sourceOf = (L, live) => {
      let src;
      if (live) {
        // camada sendo editada agora: monta a prévia sem cache
        src = L.canvas;
        let mask = L.mask && L.maskOn ? L.mask : null;
        if (stroke.onMask) {
          if (mask) mask = liveMask(L);
        } else {
          const s = scratch.getContext('2d');
          s.globalAlpha = 1; s.globalCompositeOperation = 'source-over';
          s.clearRect(0, 0, doc.w, doc.h);
          s.drawImage(L.canvas, 0, 0);
          s.globalAlpha = stroke.spot ? 0.45 : stroke.alpha; // manchas: prévia translúcida
          s.globalCompositeOperation = stroke.erase ? 'destination-out' : (L.lockAlpha ? 'source-atop' : 'source-over');
          s.drawImage(strokeContent(), 0, 0);
          s.globalAlpha = 1; s.globalCompositeOperation = 'source-over';
          src = scratch;
        }
        if (mask) {
          const t = maskTmp.getContext('2d');
          t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, doc.w, doc.h); t.drawImage(src, 0, 0);
          t.globalCompositeOperation = 'destination-in'; t.drawImage(mask, 0, 0); t.globalCompositeOperation = 'source-over';
          src = maskTmp;
        }
        if (hasFx(L)) src = styled(L, src, true);
      } else src = layerRender(L);
      return src;
    };
    layers.forEach((L, i) => {
      if (i >= upTo) return;
      if (L.group) { sig += layerSig(L); return; } // cabeçalho de grupo não desenha nada
      const live = withStroke && stroke && i === doc.active;
      const clipped = L.clip && clipBase(i) >= 0; // desenhada junto com a camada-base
      if (L.adj) {
        if (!clipped && effVisible(L)) {
          const adjusted = adjustedBelow(ctx, L, sig + layerSig(L), liveBelow);
          const t = adjTmp.getContext('2d');
          t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, doc.w, doc.h); t.drawImage(adjusted, 0, 0);
          if (L.mask && L.maskOn) { t.globalCompositeOperation = 'destination-in'; t.drawImage(live && stroke.onMask ? liveMask(L) : L.mask, 0, 0); }
          t.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = effOpacity(L);
          // "source-atop" troca as cores sem mexer na transparência do que está abaixo
          ctx.globalCompositeOperation = L.blend === 'source-over' ? 'source-atop' : L.blend;
          ctx.drawImage(adjTmp, 0, 0);
        }
        sig += layerSig(L) + (live ? `live${performance.now()}` : '');
        return;
      }
      sig += layerSig(L);
      if (live) { liveBelow = true; sig += `live${performance.now()}`; }
      if (clipped || !effVisible(L)) return;
      // camadas recortadas logo acima desta (mesmo grupo)
      const clips = [];
      for (let j = i + 1; j < layers.length && j < upTo; j++) { const C = layers[j]; if (!C.clip || C.group || pidOf(C) !== pidOf(L)) break; clips.push(C); }
      if (!clips.length) {
        ctx.globalAlpha = effOpacity(L);
        ctx.globalCompositeOperation = L.blend;
        ctx.drawImage(sourceOf(L, live), 0, 0);
        return;
      }
      // grupo de recorte: a base + as camadas recortadas (só aparecem onde a base tem pixels) viram uma imagem só
      const baseSrc = sourceOf(L, live), w = doc.w, h = doc.h;
      const t = clipA.getContext('2d'), bm = clipB.getContext('2d'), o = clipC.getContext('2d');
      for (const c of [t, bm]) { c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, w, h); c.drawImage(baseSrc, 0, 0); }
      for (const C of clips) {
        if (!C.visible) continue;
        const liveC = withStroke && stroke && layers.indexOf(C) === doc.active;
        o.globalAlpha = 1; o.globalCompositeOperation = 'source-over'; o.clearRect(0, 0, w, h);
        if (C.adj) { // ajuste recortado: muda as cores só dentro da base
          const img = t.getImageData(0, 0, w, h); Filters[C.adj.name](img, C.adj.vals || {}); o.putImageData(img, 0, 0);
          if (C.mask && C.maskOn) { o.globalCompositeOperation = 'destination-in'; o.drawImage(liveC && stroke.onMask ? liveMask(C) : C.mask, 0, 0); }
          t.globalAlpha = C.opacity; t.globalCompositeOperation = C.blend === 'source-over' ? 'source-atop' : C.blend;
        } else {
          o.drawImage(sourceOf(C, liveC), 0, 0);
          o.globalCompositeOperation = 'destination-in'; o.drawImage(clipB, 0, 0);
          t.globalAlpha = C.opacity; t.globalCompositeOperation = C.blend;
        }
        t.drawImage(clipC, 0, 0);
      }
      t.globalAlpha = 1; t.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = effOpacity(L); ctx.globalCompositeOperation = L.blend; ctx.drawImage(clipA, 0, 0);
    });
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  // o que o traço deposita: no pincel são os próprios carimbos; no carimbo é a origem recortada pelos carimbos
  function strokeContent() {
    if (!stroke || !stroke.clone) return strokeCv;
    const o = cloneOut.getContext('2d');
    o.globalCompositeOperation = 'source-over'; o.clearRect(0, 0, doc.w, doc.h);
    o.drawImage(clonePaint, 0, 0);
    o.globalCompositeOperation = 'destination-in'; o.drawImage(strokeCv, 0, 0);
    o.globalCompositeOperation = 'source-over';
    return cloneOut;
  }
  // com seleção por máscara, recorta o traço em andamento (destrutivo, pode repetir)
  function maskStroke() {
    if (!sel || sel.type !== 'mask') return;
    const s = strokeCv.getContext('2d');
    s.save(); s.globalAlpha = 1; s.globalCompositeOperation = 'destination-in'; drawMask(s); s.restore();
  }
  let renderQueued = false;
  function render() { composite(vctx, true); drawOverlay(); }
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }

  // ---------- seleção
  let sel = null; // {type:'rect'|'ellipse', x, y, w, h}
  function selPath(ctx, s) {
    ctx.beginPath();
    if (s.type === 'ellipse') ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.max(.5, s.w / 2), Math.max(.5, s.h / 2), 0, 0, Math.PI * 2);
    else ctx.rect(s.x, s.y, s.w, s.h);
  }
  // seleções de forma (rect/ellipse) usam clip; seleções 'mask' guardam um canvas binário + contorno
  const clipSel = ctx => { if (sel && sel.type !== 'mask') { selPath(ctx, sel); ctx.clip(); } };
  const drawMask = ctx => ctx.drawImage(sel.canvas, sel.x - sel.x0, sel.y - sel.y0);
  // desenha fn(ctx) restrito à seleção
  function withSel(ctx, fn) {
    if (!sel) return fn(ctx);
    if (sel.type !== 'mask') { ctx.save(); clipSel(ctx); fn(ctx); ctx.restore(); return; }
    const t = newCanvas(doc.w, doc.h), tc = t.getContext('2d');
    fn(tc);
    tc.globalCompositeOperation = 'destination-in'; drawMask(tc);
    ctx.drawImage(t, 0, 0);
  }
  // apaga a área selecionada
  function eraseSel(ctx) {
    if (!sel) return;
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'destination-out';
    if (sel.type === 'mask') drawMask(ctx); else { selPath(ctx, sel); ctx.fillStyle = '#000'; ctx.fill(); }
    ctx.restore();
  }
  // seleção atual como canvas de máscara (branco = selecionado)
  function rasterShape(s) {
    const c = newCanvas(doc.w, doc.h), x = c.getContext('2d');
    selPath(x, s); x.fillStyle = '#fff'; x.fill();
    return c;
  }
  function selMaskCanvas() {
    if (sel.type !== 'mask') return rasterShape(sel);
    const c = newCanvas(doc.w, doc.h); drawMask(c.getContext('2d')); return c;
  }
  function outlinePath(bin, w, h, minx, miny, maxx, maxy) {
    const p = new Path2D(), at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h) ? bin[y * w + x] : 0;
    for (let y = miny; y <= maxy + 1; y++) {
      let s = -1;
      for (let x = minx; x <= maxx + 1; x++) {
        const edge = x <= maxx && at(x, y - 1) !== at(x, y);
        if (edge && s < 0) s = x; else if (!edge && s >= 0) { p.moveTo(s, y); p.lineTo(x, y); s = -1; }
      }
    }
    for (let x = minx; x <= maxx + 1; x++) {
      let s = -1;
      for (let y = miny; y <= maxy + 1; y++) {
        const edge = y <= maxy && at(x - 1, y) !== at(x, y);
        if (edge && s < 0) s = y; else if (!edge && s >= 0) { p.moveTo(x, s); p.lineTo(x, y); s = -1; }
      }
    }
    return p;
  }
  // transforma um canvas de máscara em seleção (binariza, calcula limites e contorno)
  function maskSel(cv) {
    const w = doc.w, h = doc.h, img = ctxOf(cv).getImageData(0, 0, w, h), d = img.data, bin = new Uint8Array(w * h);
    let minx = w, miny = h, maxx = -1, maxy = -1;
    for (let p = 0, y = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
      const on = d[p * 4 + 3] >= 128;
      d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = 255; d[p * 4 + 3] = on ? 255 : 0;
      if (on) { bin[p] = 1; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
    }
    if (maxx < 0) return null;
    const mc = newCanvas(w, h); mc.getContext('2d').putImageData(img, 0, 0);
    return { type: 'mask', canvas: mc, path: outlinePath(bin, w, h, minx, miny, maxx, maxy), x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1, x0: minx, y0: miny };
  }
  // combina uma nova máscara com a seleção atual
  function combineSel(newCv, mode) {
    if (mode === 'new' || !sel) { sel = maskSel(newCv); return; }
    const base = selMaskCanvas(), c = base.getContext('2d');
    c.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'sub' ? 'destination-out' : 'destination-in';
    c.drawImage(newCv, 0, 0);
    sel = maskSel(base);
  }
  const selModeFrom = (e, fallback) => e.shiftKey && e.altKey ? 'int' : e.shiftKey ? 'add' : e.altKey ? 'sub' : fallback;
  // região de cor parecida a partir de (px,py): base da varinha mágica e da lata de tinta
  function colorMask(d, w, h, px, py, tol, contiguous) {
    const i0 = (py * w + px) * 4, t0 = d[i0], t1 = d[i0 + 1], t2 = d[i0 + 2], t3 = d[i0 + 3];
    const match = p => { const i = p * 4; return Math.abs(d[i] - t0) <= tol && Math.abs(d[i + 1] - t1) <= tol && Math.abs(d[i + 2] - t2) <= tol && Math.abs(d[i + 3] - t3) <= tol; };
    const mask = new Uint8Array(w * h);
    if (contiguous) {
      const stack = new Int32Array(w * h); let sp = 0;
      stack[sp++] = py * w + px; mask[py * w + px] = 1;
      while (sp) {
        const p = stack[--sp], x = p % w;
        if (x > 0 && !mask[p - 1] && match(p - 1)) { mask[p - 1] = 1; stack[sp++] = p - 1; }
        if (x < w - 1 && !mask[p + 1] && match(p + 1)) { mask[p + 1] = 1; stack[sp++] = p + 1; }
        if (p >= w && !mask[p - w] && match(p - w)) { mask[p - w] = 1; stack[sp++] = p - w; }
        if (p < w * (h - 1) && !mask[p + w] && match(p + w)) { mask[p + w] = 1; stack[sp++] = p + w; }
      }
    } else for (let p = 0; p < w * h; p++) if (match(p)) mask[p] = 1;
    return mask;
  }
  function maskToCanvas(mask, rgb = [255, 255, 255]) {
    const out = new ImageData(doc.w, doc.h), od = out.data;
    for (let p = 0; p < mask.length; p++) if (mask[p]) { const i = p * 4; od[i] = rgb[0]; od[i + 1] = rgb[1]; od[i + 2] = rgb[2]; od[i + 3] = 255; }
    const c = newCanvas(doc.w, doc.h); c.getContext('2d').putImageData(out, 0, 0);
    return c;
  }
  function selBounds() {
    if (!sel) return null;
    const x = Math.max(0, Math.floor(sel.x)), y = Math.max(0, Math.floor(sel.y));
    const x2 = Math.min(doc.w, Math.ceil(sel.x + sel.w)), y2 = Math.min(doc.h, Math.ceil(sel.y + sel.h));
    return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
  }

  // ---------- visualização (zoom / pan) e overlay
  const view = { zoom: 1, x: 0, y: 0 };
  const cursor = { x: 0, y: 0, in: false };
  let antsOffset = 0, gradLine = null, textEdit = null, selDraft = null, lasso = null, qs = null;

  function applyView() {
    stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
    stage.classList.toggle('pixelated', view.zoom >= 2);
    $('#stZoom').textContent = (view.zoom * 100).toFixed(view.zoom < 0.1 ? 1 : 0) + '%';
    if (textEdit) styleTextEditor();
    drawOverlay();
  }
  function fitView(cap = false) {
    const r = ws.getBoundingClientRect();
    let z = Math.min((r.width - 48) / doc.w, (r.height - 48) / doc.h);
    if (cap) z = Math.min(z, 1);
    view.zoom = Math.max(0.02, z);
    view.x = Math.round((r.width - doc.w * view.zoom) / 2);
    view.y = Math.round((r.height - doc.h * view.zoom) / 2);
    applyView();
  }
  function zoomAt(nz, sx, sy) {
    const r = ws.getBoundingClientRect();
    if (sx === undefined) { sx = r.width / 2; sy = r.height / 2; }
    nz = Math.min(64, Math.max(0.02, nz));
    view.x = sx - (sx - view.x) * (nz / view.zoom);
    view.y = sy - (sy - view.y) * (nz / view.zoom);
    view.zoom = nz;
    applyView();
  }
  function resizeOverlay() {
    const r = ws.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    overlay.width = r.width * dpr; overlay.height = r.height * dpr;
    overlay.style.width = r.width + 'px'; overlay.style.height = r.height + 'px';
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawOverlay();
  }
  function drawOverlay() {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    const z = view.zoom, sx = x => view.x + x * z, sy = y => view.y + y * z;
    const ants = (path) => {
      octx.lineWidth = 1; octx.setLineDash([5, 5]);
      octx.strokeStyle = '#000'; octx.lineDashOffset = -antsOffset; path ? octx.stroke(path) : octx.stroke();
      octx.strokeStyle = '#fff'; octx.lineDashOffset = -antsOffset + 5; path ? octx.stroke(path) : octx.stroke();
      octx.setLineDash([]);
    };
    const shapeAnts = s => { selPath(octx, { type: s.type, x: sx(s.x) + .5, y: sy(s.y) + .5, w: s.w * z, h: s.h * z }); ants(); };
    if (sel && sel.type === 'mask') {
      // o Path2D está em coordenadas do documento; transforma-o e usa traço/tracejado em px de tela
      const p = new Path2D(), dpr = devicePixelRatio || 1;
      p.addPath(sel.path, new DOMMatrix([z, 0, 0, z, Math.round(sx(sel.x - sel.x0)) + .5, Math.round(sy(sel.y - sel.y0)) + .5]));
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ants(p);
    } else if (sel) shapeAnts(sel);
    if (selDraft) shapeAnts(selDraft);
    if (tool === 'shape' && drag && drag.sh) { // prévia da forma enquanto arrasta
      const dpr = devicePixelRatio || 1;
      octx.save(); octx.setTransform(dpr * z, 0, 0, dpr * z, dpr * view.x, dpr * view.y); octx.globalAlpha = 0.75; drawShape(octx, drag.sh); octx.restore();
    }
    if (lasso && lasso.pts.length) {
      // rascunho do laço: linha do caminho + fechamento tracejado + vértices (poligonal)
      const pts = lasso.pts.slice(); if (lasso.poly && lasso.cur) pts.push(lasso.cur);
      const path = () => { octx.beginPath(); pts.forEach((q, i) => i ? octx.lineTo(sx(q.x), sy(q.y)) : octx.moveTo(sx(q.x), sy(q.y))); };
      octx.save(); octx.lineJoin = 'round';
      path(); octx.strokeStyle = '#000'; octx.lineWidth = 3; octx.stroke();
      path(); octx.strokeStyle = '#fff'; octx.lineWidth = 1; octx.stroke();
      if (pts.length > 2) { octx.beginPath(); octx.moveTo(sx(pts[pts.length - 1].x), sy(pts[pts.length - 1].y)); octx.lineTo(sx(pts[0].x), sy(pts[0].y)); octx.setLineDash([4, 4]); octx.strokeStyle = '#fff'; octx.lineWidth = 1; octx.stroke(); octx.setLineDash([]); }
      if (lasso.poly) lasso.pts.forEach((q, i) => { const X = sx(q.x), Y = sy(q.y); octx.fillStyle = i ? '#fff' : '#3b82f6'; octx.fillRect(X - 3, Y - 3, 6, 6); octx.strokeStyle = '#000'; octx.lineWidth = 1; octx.strokeRect(X - 3.5, Y - 3.5, 7, 7); });
      octx.restore();
    }
    if (tool === 'crop' && crop) drawCropOverlay(sx, sy);
    if (xf) drawXfOverlay(sx, sy);
    if (gradLine) {
      octx.beginPath(); octx.moveTo(sx(gradLine.a.x), sy(gradLine.a.y)); octx.lineTo(sx(gradLine.b.x), sy(gradLine.b.y));
      octx.strokeStyle = '#000'; octx.lineWidth = 3; octx.stroke();
      octx.strokeStyle = '#fff'; octx.lineWidth = 1; octx.stroke();
    }
    if (isCloneTool() && cloneState.src && !xf) {
      // mira mostrando de onde o carimbo está copiando
      const o = cloneState.offset && (drag || opts[tool].aligned) ? cloneState.offset : null;
      const q = o ? (cursor.in || drag ? { x: cursor.x + o.x, y: cursor.y + o.y } : null) : cloneState.src;
      if (q) {
        const X = sx(q.x), Y = sy(q.y), r = Math.max(4, opts[tool].size / 2 * z);
        octx.beginPath(); octx.arc(X, Y, r, 0, Math.PI * 2);
        octx.moveTo(X - 6, Y); octx.lineTo(X + 6, Y); octx.moveTo(X, Y - 6); octx.lineTo(X, Y + 6);
        octx.setLineDash([3, 3]);
        octx.strokeStyle = 'rgba(0,0,0,.8)'; octx.lineWidth = 2; octx.stroke();
        octx.strokeStyle = 'rgba(255,255,255,.95)'; octx.lineWidth = 1; octx.stroke();
        octx.setLineDash([]);
      }
    }
    if (cursor.in && (tool === 'brush' || tool === 'eraser' || tool === 'spot' || tool === 'quick' || isCloneTool()) && !panning && !xf) {
      const r = Math.max(1, opts[tool].size / 2 * z);
      octx.beginPath(); octx.arc(sx(cursor.x), sy(cursor.y), r, 0, Math.PI * 2);
      octx.strokeStyle = 'rgba(0,0,0,.8)'; octx.lineWidth = 2; octx.stroke();
      octx.strokeStyle = 'rgba(255,255,255,.9)'; octx.lineWidth = 1; octx.stroke();
    }
  }
  setInterval(() => { if (sel || selDraft) { antsOffset = (antsOffset + 1) % 10; drawOverlay(); } }, 90);

  // ---------- histórico (snapshots com reaproveitamento de camadas não alteradas)
  const MAX_HISTORY = 40;
  const history = { states: [], index: -1 };
  function snapshot() {
    const prev = history.states[history.index];
    const prevMap = new Map(prev ? prev.snap.layers.map(l => [l.id, l]) : []);
    return {
      w: doc.w, h: doc.h, active: doc.active,
      layers: doc.layers.map(L => {
        const p = prevMap.get(L.id);
        const same = p && p.rev === L.rev;
        const canvas = same ? p.canvas : cloneCanvas(L.canvas);
        const mask = same ? p.mask : (L.mask ? cloneCanvas(L.mask) : null);
        return { id: L.id, name: L.name, visible: L.visible, opacity: L.opacity, blend: L.blend, fx: L.fx || null, adj: L.adj || null, text: L.text || null, shape: L.shape || null, group: !!L.group, pid: L.pid || 0, collapsed: !!L.collapsed, clip: !!L.clip, lockAlpha: !!L.lockAlpha, lockPixels: !!L.lockPixels, lockPos: !!L.lockPos, maskOn: L.maskOn, maskEdit: L.maskEdit, rev: L.rev, canvas, mask };
      }),
    };
  }
  /* Bloqueios de camada. As ferramentas já recusam editar camadas travadas (layerEditable); esta rede de segurança
     cobre o resto: ao registrar um passo, pixels bloqueados voltam ao que eram e, com a transparência bloqueada,
     o canal alfa volta ao anterior. Mover e transformar são permitidos (lockBypass). */
  let lockBypass = false;
  function enforceLocks() {
    const prev = history.states[history.index];
    if (!prev || lockBypass) return;
    const pm = new Map(prev.snap.layers.map(l => [l.id, l]));
    for (const L of doc.layers) {
      if (L.group || !(L.lockPixels || L.lockAlpha)) continue;
      const p = pm.get(L.id);
      if (!p || p.rev === L.rev || p.canvas.width !== L.canvas.width || p.canvas.height !== L.canvas.height) continue;
      const w = L.canvas.width, h = L.canvas.height, c = ctxOf(L.canvas);
      const cur = c.getImageData(0, 0, w, h), old = ctxOf(p.canvas).getImageData(0, 0, w, h);
      if (L.lockPixels) {
        let diff = false;
        for (let i = 0; i < cur.data.length; i += 4) if (cur.data[i + 3] !== old.data[i + 3] || cur.data[i] !== old.data[i] || cur.data[i + 1] !== old.data[i + 1] || cur.data[i + 2] !== old.data[i + 2]) { diff = true; break; }
        if (diff) { c.putImageData(old, 0, 0); touch(L); status('Pixels bloqueados: a alteração em “' + L.name + '” foi desfeita'); }
        continue;
      }
      let changed = false;
      for (let i = 3; i < cur.data.length; i += 4) if (cur.data[i] !== old.data[i]) { cur.data[i] = old.data[i]; changed = true; }
      if (changed) { c.putImageData(cur, 0, 0); touch(L); }
    }
  }
  function pushHistory(label) {
    enforceLocks();
    const snap = snapshot();
    history.states.splice(history.index + 1);
    history.states.push({ label, snap });
    if (history.states.length > MAX_HISTORY) history.states.shift();
    history.index = history.states.length - 1;
    refreshPanels();
  }
  function restore(s) {
    const resized = s.w !== doc.w || s.h !== doc.h;
    if (resized) { setDocSize(s.w, s.h); sel = null; }
    doc.layers = s.layers.map(l => ({ ...l, canvas: cloneCanvas(l.canvas), mask: l.mask ? cloneCanvas(l.mask) : null }));
    doc.active = Math.min(s.active, doc.layers.length - 1);
    render(); refreshPanels();
    if (resized) fitView(true);
  }
  function goHistory(i) {
    if (i < 0 || i >= history.states.length || i === history.index) return;
    if (xf) cancelTransform(); // clicar no histórico com transformação aberta: cancela antes
    commitText();
    history.index = i;
    restore(history.states[i].snap);
  }

  // ---------- criação / abertura
  function createDoc(w, h, background, { label = 'Novo documento', name = 'sem-titulo', draw } = {}) {
    commitText();
    setDocSize(w, h);
    doc.name = name; doc.layers = []; doc.active = 0; sel = null;
    const L = makeLayer('Fundo');
    const c = ctxOf(L.canvas);
    if (background && background !== 'transparent') { c.fillStyle = background; c.fillRect(0, 0, w, h); }
    if (draw) draw(c);
    doc.layers.push(L);
    history.states = []; history.index = -1;
    pushHistory(label);
    render(); fitView(true);
  }
  function loadImage(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('Formato não suportado'));
      img.src = URL.createObjectURL(file);
    });
  }
  const baseName = f => (f.name || 'imagem').replace(/\.[^.]+$/, '');
  async function openImageFile(file) {
    try {
      const img = await loadImage(file);
      createDoc(img.naturalWidth, img.naturalHeight, 'transparent', { label: 'Abrir', name: baseName(file), draw: c => c.drawImage(img, 0, 0) });
      status(`Aberto: ${file.name}`);
    } catch (e) { status(e.message); }
  }
  async function addImageLayer(file) {
    try {
      const img = await loadImage(file);
      const L = makeLayer(baseName(file));
      // maior que o documento: entra reduzida para caber (as camadas têm o tamanho do documento)
      const k = Math.min(1, doc.w / img.naturalWidth, doc.h / img.naturalHeight);
      const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k), c = ctxOf(L.canvas);
      c.imageSmoothingQuality = 'high';
      c.drawImage(img, Math.round((doc.w - w) / 2), Math.round((doc.h - h) / 2), w, h);
      if (k < 1) status(`Imagem reduzida para ${Math.round(k * 100)}% para caber · use Transformação livre (Ctrl+Alt+T) para ajustar`);
      insertLayer(L); pushHistory('Inserir imagem'); render();
    } catch (e) { status(e.message); }
  }
  // documento intocado (só o estado inicial) → abrir; senão → nova camada
  const pristine = () => history.states.length <= 1 && history.states[0]?.label === 'Novo documento';
  function handleIncomingFile(file) {
    if (/\.pview$/i.test(file.name)) return loadProject(file);
    if (!file.type.startsWith('image/')) return status('Arquivo não é uma imagem');
    return pristine() ? openImageFile(file) : addImageLayer(file);
  }

  // ---------- projeto (.pview = JSON com as camadas em PNG)
  function saveProject() {
    const data = {
      app: 'photoview', version: 1, w: doc.w, h: doc.h, active: doc.active,
      layers: doc.layers.map(L => ({ name: L.name, visible: L.visible, opacity: L.opacity, blend: L.blend, fx: L.fx || null, adj: L.adj || null, text: L.text || null, shape: L.shape || null, id: L.id, group: !!L.group, pid: L.pid || 0, collapsed: !!L.collapsed, clip: !!L.clip, lockAlpha: !!L.lockAlpha, lockPixels: !!L.lockPixels, lockPos: !!L.lockPos, maskOn: L.maskOn, mask: L.mask ? L.mask.toDataURL('image/png') : null, data: L.canvas.toDataURL('image/png') })),
    };
    download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${doc.name}.pview`);
    status('Projeto salvo');
  }
  async function loadProject(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'photoview') throw new Error();
      const loadUrl = url => url ? new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }) : null;
      const imgs = await Promise.all(data.layers.map(l => loadUrl(l.data)));
      const masks = await Promise.all(data.layers.map(l => loadUrl(l.mask)));
      commitText();
      setDocSize(data.w, data.h);
      doc.name = baseName(file); sel = null;
      doc.layers = data.layers.map((l, i) => {
        const L = makeLayer(l.name);
        Object.assign(L, { visible: l.visible, opacity: l.opacity, blend: l.blend, fx: l.fx || null, adj: l.adj || null, text: l.text || null, shape: l.shape || null, maskEdit: !!l.adj, group: !!l.group, collapsed: !!l.collapsed, clip: !!l.clip, lockAlpha: !!l.lockAlpha, lockPixels: !!l.lockPixels, lockPos: !!l.lockPos, _oid: l.id, _opid: l.pid || 0 });
        if (l.group) L.canvas = newCanvas(1, 1);
        ctxOf(L.canvas).drawImage(imgs[i], 0, 0);
        if (masks[i]) { L.mask = newMask(false); ctxOf(L.mask).drawImage(masks[i], 0, 0); L.maskOn = l.maskOn !== false; }
        return L;
      });
      { // ids novos: refaz a ligação filho → grupo
        const byOld = new Map(doc.layers.filter(L => L._oid).map(L => [L._oid, L]));
        for (const L of doc.layers) { const P = byOld.get(L._opid); L.pid = P && P.group ? P.id : 0; delete L._oid; delete L._opid; }
        normalizeGroups();
      }
      doc.active = Math.min(data.active || 0, doc.layers.length - 1);
      history.states = []; history.index = -1;
      pushHistory('Abrir projeto'); render(); fitView(true);
    } catch { status('Projeto inválido'); }
  }

  function flattenCanvas(background) {
    const c = newCanvas(doc.w, doc.h), x = c.getContext('2d');
    if (background) { x.fillStyle = background; x.fillRect(0, 0, doc.w, doc.h); }
    composite(x, false, false);
    return c;
  }
  function exportAs(type, ext) {
    const c = flattenCanvas(type === 'image/jpeg' ? '#ffffff' : null);
    c.toBlob(b => { if (b) { download(b, `${doc.name}.${ext}`); status(`Exportado ${ext.toUpperCase()}`); } else status('Formato não suportado pelo navegador'); }, type, 0.92);
  }

  // ---------- ferramentas
  const opts = {
    brush: { size: 20, opacity: 100, hardness: 90 },
    eraser: { size: 40, opacity: 100, hardness: 90 },
    clone: { size: 40, opacity: 100, hardness: 50, aligned: true, sampleAll: '' },
    heal: { size: 30, opacity: 100, hardness: 70, aligned: true, sampleAll: '' },
    spot: { size: 24, opacity: 100, hardness: 70, sampleAll: '' },
    bucket: { tolerance: 32, contiguous: true, opacity: 100 },
    gradient: { type: 'linear', opacity: 100 },
    marquee: { shape: 'rect', mode: 'new' },
    lasso: { type: 'free', mode: 'new' },
    quick: { size: 40, tolerance: 45, mode: 'add', allLayers: false },
    shape: { kind: 'rect', radius: 0, sides: 5, fillOn: true, strokeOn: false, strokeW: 6 },
    crop: { ratio: 'free' },
    wand: { tolerance: 32, contiguous: true, allLayers: false, mode: 'new' },
    text: { font: 'Arial', size: 48, bold: false },
  };
  const TOOL_NAMES = { move: 'Mover', marquee: 'Letreiro', lasso: 'Laço', quick: 'Seleção rápida', wand: 'Varinha mágica', clone: 'Carimbo', heal: 'Pincel corretivo', spot: 'Corretivo para manchas', brush: 'Pincel', eraser: 'Borracha', bucket: 'Lata de tinta', gradient: 'Degradê', eyedropper: 'Conta-gotas', text: 'Texto', hand: 'Mão', zoom: 'Zoom', crop: 'Recortar', shape: 'Forma' };
  const CURSORS = { move: 'move', marquee: 'crosshair', lasso: 'crosshair', quick: 'none', wand: 'crosshair', clone: 'none', heal: 'none', spot: 'none', brush: 'none', eraser: 'none', bucket: 'crosshair', gradient: 'crosshair', eyedropper: 'crosshair', text: 'text', hand: 'grab', zoom: 'zoom-in', crop: 'crosshair', shape: 'crosshair' };
  let tool = 'brush';
  let spaceDown = false, panning = null, drag = null, lastPoint = null;

  function setTool(t) {
    commitText();
    if (xf) applyTransform(); // trocar de ferramenta confirma a transformação
    lasso = null;
    tool = t;
    if (t === 'crop') initCrop(); else crop = null; // trocar de ferramenta descarta a caixa
    document.querySelectorAll('#toolbar [data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    updateCursor(); buildOptions(); drawOverlay();
  }
  function updateCursor() { ws.style.cursor = spaceDown || panning ? (panning ? 'grabbing' : 'grab') : CURSORS[tool]; }

  // pincel por "carimbos" (dabs) com dureza e pressão
  let dabCv = null;
  function buildDab(o, color) {
    const r = Math.max(0.5, o.size / 2), size = Math.ceil(r * 2) + 2, cx = size / 2;
    dabCv = newCanvas(size, size);
    const c = dabCv.getContext('2d'), hard = o.hardness / 100;
    if (hard >= 0.99) { c.fillStyle = color; c.beginPath(); c.arc(cx, cx, r, 0, Math.PI * 2); c.fill(); }
    else {
      const [R, G, B] = hexToRgb(color), g = c.createRadialGradient(cx, cx, 0, cx, cx, r);
      g.addColorStop(0, `rgba(${R},${G},${B},1)`); g.addColorStop(hard, `rgba(${R},${G},${B},1)`); g.addColorStop(1, `rgba(${R},${G},${B},0)`);
      c.fillStyle = g; c.fillRect(0, 0, size, size);
    }
  }
  function dab(x, y, p) {
    const d = dabCv.width * p;
    strokeCv.getContext('2d').drawImage(dabCv, x - d / 2, y - d / 2, d, d);
    // área já pintada no traço (para os corretivos lerem só essa região)
    const b = stroke.bb || (stroke.bb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    b.x0 = Math.min(b.x0, x - d / 2); b.y0 = Math.min(b.y0, y - d / 2); b.x1 = Math.max(b.x1, x + d / 2); b.y1 = Math.max(b.y1, y + d / 2);
  }
  function strokeTo(x, y, p) {
    const s = stroke, dx = x - s.lx, dy = y - s.ly, dist = Math.hypot(dx, dy);
    if (dist === 0) return;
    const sp = Math.max(0.5, s.size * 0.1 * p);
    let t = sp - s.rem;
    while (t <= dist) { dab(s.lx + dx * t / dist, s.ly + dy * t / dist, p); t += sp; }
    s.rem = dist - (t - sp);
    s.lx = x; s.ly = y;
  }
  const pressureOf = e => e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 1;
  function layerEditable(forMove) { // forMove: mover/transformar só dependem do bloqueio de posição
    const L = active();
    if (L.group) { status('Selecione uma camada dentro do grupo'); return false; }
    if (!effVisible(L)) { status('A camada ativa está oculta'); return false; }
    if (!forMove && !editingMask() && L.lockPixels) { status('Os pixels desta camada estão bloqueados (cadeado no painel de camadas)'); return false; }
    return true;
  }
  const cloneState = { src: null, offset: null }; // origem compartilhada por carimbo e pincel corretivo
  const isCloneTool = () => tool === 'clone' || tool === 'heal';
  function beginStroke(p, e) {
    if (!layerEditable()) return false;
    if (isCloneTool() && !cloneState.src) { status('Alt+clique na imagem para escolher a origem do carimbo'); return false; }
    if (tool === 'eraser' && active().lockAlpha && !editingMask()) { status('A transparência está bloqueada: a borracha não pode apagar'); return false; }
    if (tool === 'spot' && editingMask()) { status('O corretivo para manchas funciona no conteúdo da camada, não na máscara'); return false; }
    const erase = tool === 'eraser', o = opts[tool], onMask = editingMask();
    const s = strokeCv.getContext('2d');
    s.setTransform(1, 0, 0, 1, 0, 0); s.clearRect(0, 0, doc.w, doc.h);
    s.save(); clipSel(s);
    // na máscara: pincel pinta o cinza da cor principal, borracha o da secundária
    stroke = { erase: erase && !onMask, onMask, gray: onMask ? lum(erase ? bg() : fg()) : 1, alpha: o.opacity / 100, size: o.size, lx: p.x, ly: p.y, rem: 0,
      label: onMask ? 'Pintar máscara' : erase ? 'Borracha' : 'Pincel', clipped: true };
    if (isCloneTool()) {
      // destino p copia de p + deslocamento; "alinhado" mantém o deslocamento entre traços
      if (!opts[tool].aligned || !cloneState.offset) cloneState.offset = { x: cloneState.src.x - p.x, y: cloneState.src.y - p.y };
      const base = onMask ? active().mask : opts[tool].sampleAll ? flattenCanvas(null) : active().canvas;
      const cp = clonePaint.getContext('2d');
      cp.clearRect(0, 0, doc.w, doc.h);
      cp.drawImage(base, -Math.round(cloneState.offset.x), -Math.round(cloneState.offset.y));
      // o corretivo mostra a cópia durante o traço e faz a correção de cor/luz ao soltar (na máscara age como carimbo)
      const heal = tool === 'heal' && !onMask;
      Object.assign(stroke, { clone: true, heal, sampleAll: !!opts[tool].sampleAll, gray: 1,
        label: heal ? 'Pincel corretivo' : onMask ? 'Carimbo na máscara' : 'Carimbo' });
    }
    if (tool === 'spot') Object.assign(stroke, { spot: true, sampleAll: !!o.sampleAll, label: 'Corretivo para manchas' });
    buildDab(o, onMask || isCloneTool() ? '#ffffff' : erase || tool === 'spot' ? '#000000' : fg());
    if (e.shiftKey && lastPoint) { stroke.lx = lastPoint.x; stroke.ly = lastPoint.y; dab(lastPoint.x, lastPoint.y, 1); strokeTo(p.x, p.y, 1); }
    else dab(p.x, p.y, pressureOf(e));
    requestRender();
    return true;
  }
  function commitStroke() {
    if (!stroke) return;
    if (stroke.clipped) strokeCv.getContext('2d').restore();
    maskStroke();
    const L = active();
    if (stroke.spot) spotHealCommit(L);
    else if (stroke.heal) healCommit(L);
    else if (stroke.onMask) maskWrite(L.mask, stroke.cov || strokeCv, stroke.alpha, strokeContent(), stroke.alpha * stroke.gray);
    else {
      const c = ctxOf(L.canvas);
      c.save();
      c.globalAlpha = stroke.alpha;
      c.globalCompositeOperation = stroke.erase ? 'destination-out' : (L.lockAlpha ? 'source-atop' : 'source-over');
      c.drawImage(strokeContent(), 0, 0);
      c.restore();
    }
    touch(L);
    const label = stroke.label;
    stroke = null;
    pushHistory(label); render();
  }
  /* Pincel corretivo: usa a TEXTURA da origem e a COR/LUZ do destino.
     A diferença (destino − origem) é medida só num anel logo fora da área pintada e
     interpolada suavemente para dentro (convolução normalizada ≈ membrana de Poisson):
     resultado = origem + diferença interpolada. */
  // retângulo do traço (inteiro, dentro do documento) com uma margem
  function strokeBox(pad) {
    const b = stroke.bb;
    if (!b) return null;
    const x0 = Math.max(0, Math.floor(b.x0) - pad), y0 = Math.max(0, Math.floor(b.y0) - pad);
    const x1 = Math.min(doc.w - 1, Math.ceil(b.x1) + pad), y1 = Math.min(doc.h - 1, Math.ceil(b.y1) + pad);
    return x1 >= x0 && y1 >= y0 ? { x0, y0, x1, y1, W: x1 - x0 + 1, H: y1 - y0 + 1 } : null;
  }
  function healCommit(L) {
    const sigma = Math.max(3, stroke.size / 2), box = strokeBox(Math.ceil(sigma * 3 + 4));
    if (!box) return;
    const { x0, y0, W, H } = box, n = W * H;
    const covD = strokeCv.getContext('2d').getImageData(x0, y0, W, H).data;
    const lctx = ctxOf(L.canvas);
    const layerImg = lctx.getImageData(x0, y0, W, H), out = layerImg.data;
    const dst = stroke.sampleAll ? ctxOf(flattenCanvas(null)).getImageData(x0, y0, W, H).data : new Uint8ClampedArray(out);
    const src = ctxOf(clonePaint).getImageData(x0, y0, W, H).data;
    const cov = new Float32Array(n), inR = new Uint8Array(n);
    let any = false;
    for (let p = 0; p < n; p++) { const a = covD[p * 4 + 3] / 255; cov[p] = a; if (a > 0.004) { inR[p] = 1; any = true; } }
    if (!any) return;
    const dist = edt(inR, W, H);
    const den = new Float32Array(n), num = [0, 1, 2, 3].map(() => new Float32Array(n));
    for (let p = 0; p < n; p++) {
      if (inR[p] || dist[p] > 2.5) continue;
      den[p] = 1;
      for (let c = 0; c < 4; c++) num[c][p] = dst[p * 4 + c] - src[p * 4 + c];
    }
    blurFloat(den, W, H, sigma);
    for (const a of num) blurFloat(a, W, H, sigma);
    for (let p = 0; p < n; p++) {
      if (!inR[p]) continue;
      const k = cov[p] * stroke.alpha, dn = den[p], i = p * 4;
      const hv = c => Math.min(255, Math.max(0, src[i + c] + (dn > 1e-5 ? num[c][p] / dn : 0)));
      const ha = hv(3) / 255, oa = out[i + 3] / 255;
      const A = oa * (1 - k) + ha * k;
      if (A <= 0) { out[i + 3] = 0; continue; }
      for (let c = 0; c < 3; c++) out[i + c] = (out[i + c] * oa * (1 - k) + hv(c) * ha * k) / A;
      out[i + 3] = A * 255;
    }
    lctx.putImageData(layerImg, x0, y0);
  }

  /* Corretivo para manchas: escolhe sozinho uma origem por perto.
     Testa deslocamentos em volta da área pintada e fica com o que tem a borda mais parecida
     com a do destino (sem contar diferença de brilho, que o healCommit corrige) e um miolo
     "limpo" (variação parecida com a da pele/textura ao redor). Depois aplica o pincel corretivo. */
  function spotHealCommit(L) {
    const w = doc.w, h = doc.h, R = 6;
    const box = strokeBox(R);
    if (!box) return;
    const { x0: bx0, y0: by0, x1: bx1, y1: by1, W: BW, H: BH } = box;
    const D = Math.max(BW, BH) - 2 * R;
    // janela de busca: o traço mais o maior deslocamento testado
    const S = Math.ceil(D * 3.4) + 2;
    const wx0 = Math.max(0, bx0 - S), wy0 = Math.max(0, by0 - S), wx1 = Math.min(w - 1, bx1 + S), wy1 = Math.min(h - 1, by1 + S);
    const WW = wx1 - wx0 + 1, WH = wy1 - wy0 + 1;
    const base = stroke.sampleAll ? flattenCanvas(null) : L.canvas;
    const bd = ctxOf(base).getImageData(wx0, wy0, WW, WH).data;
    const lumA = new Float32Array(WW * WH);
    for (let p = 0; p < lumA.length; p++) lumA[p] = 0.299 * bd[p * 4] + 0.587 * bd[p * 4 + 1] + 0.114 * bd[p * 4 + 2];
    // pontos do miolo e do anel (até 6 px fora), amostrados para ficar rápido
    const covD = strokeCv.getContext('2d').getImageData(bx0, by0, BW, BH).data;
    const inR = new Uint8Array(BW * BH);
    for (let q = 0; q < inR.length; q++) inR[q] = covD[q * 4 + 3] > 2 ? 1 : 0;
    const dist = edt(inR, BW, BH);
    let inner = [], ring = [];
    for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
      const q = y * BW + x, P = (y + by0 - wy0) * WW + x + bx0 - wx0;
      if (inR[q]) inner.push(P); else if (dist[q] <= R) ring.push(P);
    }
    if (!inner.length || !ring.length) return;
    const thin = (arr, max) => arr.length <= max ? arr : arr.filter((_, i) => i % Math.ceil(arr.length / max) === 0);
    inner = thin(inner, 2500); ring = thin(ring, 2500);
    let rm = 0; for (const P of ring) rm += lumA[P]; rm /= ring.length;
    let rv = 0; for (const P of ring) rv += (lumA[P] - rm) ** 2; const ringStd = Math.sqrt(rv / ring.length);
    let best = null;
    for (const k of [1.2, 1.7, 2.4, 3.3]) for (let a = 0; a < 16; a++) {
      const ang = a / 16 * Math.PI * 2 + k, dx = Math.round(Math.cos(ang) * D * k), dy = Math.round(Math.sin(ang) * D * k);
      if (bx0 + dx < wx0 || by0 + dy < wy0 || bx1 + dx > wx1 || by1 + dy > wy1) continue;
      const off = dy * WW + dx;
      // borda: diferença sem a média (o brilho é corrigido depois)
      let s = 0, s2 = 0;
      for (const P of ring) { const d = lumA[P] - lumA[P + off]; s += d; s2 += d * d; }
      const ringErr = s2 / ring.length - (s / ring.length) ** 2;
      // miolo: variação parecida com a textura em volta (sem outra mancha dentro)
      let m = 0; for (const P of inner) m += lumA[P + off]; m /= inner.length;
      let v = 0; for (const P of inner) v += (lumA[P + off] - m) ** 2;
      const innerStd = Math.sqrt(v / inner.length);
      const score = ringErr + 2 * (innerStd - ringStd) ** 2 + 0.02 * k * D;
      if (!best || score < best.score) best = { score, dx, dy };
    }
    if (!best) { status('Área grande demais para achar uma origem — use o pincel corretivo'); return; }
    const cp = clonePaint.getContext('2d');
    cp.clearRect(0, 0, w, h); cp.drawImage(base, -best.dx, -best.dy);
    healCommit(L);
  }

  function drawGradient() {
    const s = strokeCv.getContext('2d'), { a, b } = gradLine;
    s.clearRect(0, 0, doc.w, doc.h);
    s.save(); clipSel(s);
    const g = opts.gradient.type === 'radial'
      ? s.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)))
      : s.createLinearGradient(a.x, a.y, b.x, b.y);
    if (stroke && stroke.onMask) { g.addColorStop(0, `rgba(255,255,255,${lum(fg())})`); g.addColorStop(1, `rgba(255,255,255,${lum(bg())})`); }
    else { g.addColorStop(0, fg()); g.addColorStop(1, bg()); }
    s.fillStyle = g; s.fillRect(0, 0, doc.w, doc.h);
    s.restore();
  }

  function floodFill(px, py) {
    const L = active(), w = doc.w, h = doc.h, o = opts.bucket;
    if (editingMask()) {
      const region = maskToCanvas(colorMask(ctxOf(L.mask).getImageData(0, 0, w, h).data, w, h, px, py, o.tolerance, o.contiguous));
      const cov = newCanvas(w, h); withSel(cov.getContext('2d'), x => x.drawImage(region, 0, 0));
      maskWrite(L.mask, cov, o.opacity / 100, cov, o.opacity / 100 * lum(fg()));
      touch(L); pushHistory('Lata de tinta (máscara)'); render();
      return;
    }
    const ctx = ctxOf(L.canvas);
    const d = ctx.getImageData(0, 0, w, h).data;
    const paint = maskToCanvas(colorMask(d, w, h, px, py, o.tolerance, o.contiguous), hexToRgb(fg()));
    ctx.save(); ctx.globalAlpha = o.opacity / 100; withSel(ctx, x => x.drawImage(paint, 0, 0)); ctx.restore();
    touch(L); pushHistory('Lata de tinta'); render();
  }

  function sampleColor(p, toBg) {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return;
    const [r, g, b] = vctx.getImageData(x, y, 1, 1).data;
    const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    $(toBg ? '#colorBg' : '#colorFg').value = hex;
  }

  // ---------- ferramenta de recorte: caixa {cx, cy, w, h, angle} em coordenadas do documento
  let crop = null;
  const rot = (x, y, a) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
  const cropLocal = (p, b = crop) => rot(p.x - b.cx, p.y - b.cy, -b.angle);
  const cropToDoc = (q, b = crop) => { const r = rot(q.x, q.y, b.angle); return { x: b.cx + r.x, y: b.cy + r.y }; };
  const CROP_HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  const CROP_RATIOS = [['free', 'Livre'], ['orig', 'Original'], ['1:1', '1:1 (quadrado)'], ['4:5', '4:5 (retrato)'], ['4:3', '4:3'], ['3:2', '3:2'], ['16:9', '16:9'], ['9:16', '9:16 (story)']];
  function cropRatio() {
    const r = opts.crop.ratio;
    if (r === 'free') return null;
    if (r === 'orig') return doc.w / doc.h;
    const [a, b] = r.split(':').map(Number);
    return a / b;
  }
  function initCrop() {
    const b = selBounds();
    crop = b ? { cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h, angle: 0 } : { cx: doc.w / 2, cy: doc.h / 2, w: doc.w, h: doc.h, angle: 0 };
    setCropBase(); fitCropRatio();
  }
  // ao endireitar, encolhe a caixa (a partir do tamanho-base bw×bh) para não sair da imagem
  function fitRotated() {
    if (!crop) return;
    const bw = crop.bw ?? crop.w, bh = crop.bh ?? crop.h;
    if (!crop.angle) { crop.w = bw; crop.h = bh; return; }
    let s = 1;
    for (const [x, y] of [[-bw / 2, -bh / 2], [bw / 2, -bh / 2], [bw / 2, bh / 2], [-bw / 2, bh / 2]]) {
      const d = rot(x, y, crop.angle);
      if (d.x > 0) s = Math.min(s, (doc.w - crop.cx) / d.x); else if (d.x < 0) s = Math.min(s, crop.cx / -d.x);
      if (d.y > 0) s = Math.min(s, (doc.h - crop.cy) / d.y); else if (d.y < 0) s = Math.min(s, crop.cy / -d.y);
    }
    s = Math.max(0.05, s - 2 / Math.max(bw, bh)); // ~1 px de folga contra cantos transparentes
    crop.w = bw * s; crop.h = bh * s;
  }
  const setCropBase = () => { crop.bw = crop.w; crop.bh = crop.h; };
  function fitCropRatio() {
    const r = cropRatio();
    if (!crop || !r) return;
    // mantém a caixa dentro da área atual, centralizada
    if (crop.w / crop.h > r) crop.w = crop.h * r; else crop.h = crop.w / r;
    setCropBase(); fitRotated();
  }
  // acerto do ponteiro numa caixa girada (usado pelo recorte e pela transformação livre)
  function cropHit(p, b = crop) {
    const q = cropLocal(p, b), tol = 10 / view.zoom, hw = b.w / 2, hh = b.h / 2;
    // 1) as 8 alças têm prioridade
    for (const [hx, hy] of CROP_HANDLES) if (Math.abs(q.x - hx * hw) < tol && Math.abs(q.y - hy * hh) < tol) return { mode: 'resize', sx: hx, sy: hy };
    // 2) bordas inteiras só em caixas grandes; em caixas finas (ex.: uma linha de texto) o meio sempre move
    const inside = Math.abs(q.x) < hw && Math.abs(q.y) < hh;
    const nearX = Math.abs(q.y) <= hh + tol, nearY = Math.abs(q.x) <= hw + tol;
    const sx = hw > tol * 3 && nearX && Math.abs(q.x - hw) < tol / 2 ? 1 : hw > tol * 3 && nearX && Math.abs(q.x + hw) < tol / 2 ? -1 : 0;
    const sy = hh > tol * 3 && nearY && Math.abs(q.y - hh) < tol / 2 ? 1 : hh > tol * 3 && nearY && Math.abs(q.y + hh) < tol / 2 ? -1 : 0;
    if ((sx || sy) && !(inside && (hw <= tol * 3 || hh <= tol * 3))) return { mode: 'resize', sx, sy };
    if (Math.abs(q.x) < hw && Math.abs(q.y) < hh) return { mode: 'move' };
    return { mode: 'rotate' };
  }
  function cropCursor(hit, b = crop) {
    if (hit.mode === 'move') return 'move';
    if (hit.mode === 'rotate') return 'crosshair';
    // direção da alça já considerando o giro da caixa
    const dir = rot(hit.sx, hit.sy, b.angle), a = ((Math.atan2(dir.y, dir.x) * 180 / Math.PI) + 180) % 180;
    return a < 22.5 || a >= 157.5 ? 'ew-resize' : a < 67.5 ? 'nwse-resize' : a < 112.5 ? 'ns-resize' : 'nesw-resize';
  }
  function cropDrag(p, e) {
    const b = drag.box0;
    if (drag.mode === 'move') { crop = { ...b, cx: b.cx + p.x - drag.a.x, cy: b.cy + p.y - drag.a.y }; if (crop.angle) fitRotated(); return; }
    if (drag.mode === 'rotate') {
      const a0 = Math.atan2(drag.a.y - b.cy, drag.a.x - b.cx), a1 = Math.atan2(p.y - b.cy, p.x - b.cx);
      let ang = b.angle + a1 - a0;
      if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12); // Shift: passos de 15°
      crop = { ...b, angle: Math.atan2(Math.sin(ang), Math.cos(ang)) };
      fitRotated();
      return;
    }
    const q = cropLocal(p, b), { sx, sy } = drag;
    let l = -b.w / 2, r = b.w / 2, t = -b.h / 2, bo = b.h / 2;
    if (sx === 1) r = Math.max(l + 1, q.x); if (sx === -1) l = Math.min(r - 1, q.x);
    if (sy === 1) bo = Math.max(t + 1, q.y); if (sy === -1) t = Math.min(bo - 1, q.y);
    const ratio = cropRatio() || (e.shiftKey && sx && sy ? b.w / b.h : null);
    if (ratio) {
      let w = r - l, h = bo - t;
      if (sx && sy) {
        if (w / ratio > h) h = w / ratio; else w = h * ratio;
        if (sx === 1) r = l + w; else l = r - w;
        if (sy === 1) bo = t + h; else t = bo - h;
      } else if (sx) { h = w / ratio; const m = (t + bo) / 2; t = m - h / 2; bo = m + h / 2; }
      else { w = h * ratio; const m = (l + r) / 2; l = m - w / 2; r = m + w / 2; }
    }
    const c = cropToDoc({ x: (l + r) / 2, y: (t + bo) / 2 }, b);
    crop = { ...b, cx: c.x, cy: c.y, w: r - l, h: bo - t };
    setCropBase();
  }
  function applyCrop() {
    if (!crop) return;
    const nw = Math.max(1, Math.round(crop.w)), nh = Math.max(1, Math.round(crop.h)), angle = crop.angle;
    let { cx, cy } = crop;
    if (!angle) { cx = Math.round(cx - nw / 2) + nw / 2; cy = Math.round(cy - nh / 2) + nh / 2; } // sem giro: sem reamostrar
    if (!angle && nw === doc.w && nh === doc.h && cx === doc.w / 2 && cy === doc.h / 2) return status('A caixa cobre a imagem inteira: nada a recortar');
    transformAll(nw, nh, angle ? 'Recortar e endireitar' : 'Recortar', (c, src) => {
      c.translate(nw / 2, nh / 2); c.rotate(-angle); c.translate(-cx, -cy); c.drawImage(src, 0, 0);
    });
    initCrop(); buildOptions(); drawOverlay();
  }
  function drawCropOverlay(sx, sy) {
    const W = overlay.width / (devicePixelRatio || 1), H = overlay.height / (devicePixelRatio || 1);
    const S = q => { const P = cropToDoc(q); return [sx(P.x), sy(P.y)]; };
    const hw = crop.w / 2, hh = crop.h / 2;
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => S({ x, y }));
    octx.save();
    octx.beginPath(); octx.rect(0, 0, W, H);
    octx.moveTo(...corners[0]); corners.slice(1).forEach(c => octx.lineTo(...c)); octx.closePath();
    octx.fillStyle = 'rgba(0,0,0,.55)'; octx.fill('evenodd');
    // regra dos terços
    octx.beginPath();
    for (const f of [-1 / 6, 1 / 6]) {
      octx.moveTo(...S({ x: crop.w * f, y: -hh })); octx.lineTo(...S({ x: crop.w * f, y: hh }));
      octx.moveTo(...S({ x: -hw, y: crop.h * f })); octx.lineTo(...S({ x: hw, y: crop.h * f }));
    }
    octx.strokeStyle = 'rgba(255,255,255,.45)'; octx.lineWidth = 1; octx.stroke();
    octx.beginPath(); octx.moveTo(...corners[0]); corners.slice(1).forEach(c => octx.lineTo(...c)); octx.closePath();
    octx.strokeStyle = '#fff'; octx.lineWidth = 1.5; octx.stroke();
    for (const [hx, hy] of CROP_HANDLES) {
      const [X, Y] = S({ x: hx * hw, y: hy * hh });
      octx.fillStyle = '#fff'; octx.fillRect(X - 4, Y - 4, 8, 8);
      octx.strokeStyle = '#111'; octx.lineWidth = 1; octx.strokeRect(X - 4.5, Y - 4.5, 9, 9);
    }
    const deg = Math.round(crop.angle * 1800 / Math.PI) / 10;
    const label = `${Math.round(crop.w)} × ${Math.round(crop.h)} px${deg ? ` · ${deg}°` : ''}`;
    const top = corners.reduce((a, c) => c[1] < a[1] ? c : a);
    octx.font = '12px system-ui, sans-serif';
    const tw = octx.measureText(label).width;
    const lx = Math.min(W - tw - 12, Math.max(4, top[0] - tw / 2 - 6)), ly = Math.max(4, top[1] - 26);
    octx.fillStyle = 'rgba(0,0,0,.75)'; octx.fillRect(lx, ly, tw + 12, 20);
    octx.fillStyle = '#fff'; octx.fillText(label, lx + 6, ly + 14);
    octx.restore();
  }

  // ---------- transformação livre: escala, giro e posição da camada (ou da área selecionada)
  let xf = null;
  function contentBounds(cv) {
    const d = ctxOf(cv).getImageData(0, 0, doc.w, doc.h).data;
    let x0 = doc.w, y0 = doc.h, x1 = -1, y1 = -1;
    for (let y = 0, p = 3; y < doc.h; y++) for (let x = 0; x < doc.w; x++, p += 4) if (d[p]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function startTransform() {
    if (xf) return;
    commitText();
    if (tool === 'crop') setTool('move');
    const L = active();
    if (!layerEditable(true)) return;
    if (L.lockPos && !editingMask()) return status('A posição desta camada está bloqueada');
    const onMask = editingMask(), target = targetCanvas();
    const r = sel ? selBounds() : contentBounds(target);
    if (!r) return status(sel ? 'A seleção está fora da imagem' : 'A camada está vazia: nada para transformar');
    const base = cloneCanvas(target);
    let float = base, hole = null;
    if (sel) {
      float = newCanvas(doc.w, doc.h); withSel(float.getContext('2d'), x => x.drawImage(base, 0, 0));
      hole = cloneCanvas(base); eraseSel(hole.getContext('2d'));
    }
    // máscara vinculada: transforma junto quando a camada inteira é transformada
    const mask = !onMask && !sel && L.mask ? cloneCanvas(L.mask) : null;
    xf = { L, target, base, float, hole, mask, textOk: !!(L.text && !sel && !onMask && textValid(L)), shapeOk: !!(L.shape && !sel && !onMask && shapeValid(L)), src: r, box: { cx: r.x + r.w / 2, cy: r.y + r.h / 2, w: r.w, h: r.h, angle: 0 }, fx: 1, fy: 1, selWas: sel };
    sel = null;
    renderXf(false); buildOptions(); drawOverlay();
    status('Transformação livre: arraste as alças · Enter aplica · Esc cancela');
  }
  function renderXf(hq) {
    const { target, hole, float, src, box, fx, fy } = xf;
    const place = (c, img, fill) => {
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      if (fill) { c.fillStyle = '#fff'; c.fillRect(0, 0, doc.w, doc.h); } else c.clearRect(0, 0, doc.w, doc.h);
      if (hole && !fill) c.drawImage(hole, 0, 0);
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = hq ? 'high' : 'low';
      c.translate(box.cx, box.cy); c.rotate(box.angle); c.scale(fx, fy);
      if (fill) c.clearRect(-box.w / 2, -box.h / 2, box.w, box.h); // fora da máscara transformada: visível
      c.drawImage(img, src.x, src.y, src.w, src.h, -box.w / 2, -box.h / 2, box.w, box.h);
      c.restore();
    };
    place(ctxOf(target), float, false);
    if (xf.mask) place(ctxOf(xf.L.mask), xf.mask, true);
    touch(xf.L);
    requestRender();
  }
  function applyTransform() {
    if (!xf) return;
    const b = xf.box, s = xf.src;
    const changed = b.angle || xf.fx < 0 || xf.fy < 0 || Math.abs(b.w - s.w) > .01 || Math.abs(b.h - s.h) > .01 || Math.abs(b.cx - (s.x + s.w / 2)) > .01 || Math.abs(b.cy - (s.y + s.h / 2)) > .01;
    if (changed) renderXf(true);
    const xL = xf.L, xT = xL.text, asText = changed && xf.textOk && xT, M = asText ? xfMatrix(xf) : null;
    const xS = xL.shape, asShape = changed && xf.shapeOk && xS, M2 = asShape ? xfMatrix(xf) : null;
    xf = null;
    if (asText) renderTextLayer(xL, { ...xT, m: matMul(M, xT.m || IDENT) });
    if (asShape) renderShapeLayer(xL, { ...xS, m: matMul(M2, xS.m || IDENT) }); // a forma é redesenhada nítida na nova escala/ângulo
    if (changed) { lockBypass = true; pushHistory('Transformação livre'); lockBypass = false; }
    buildOptions(); render();
  }
  function cancelTransform() {
    if (!xf) return;
    const c = ctxOf(xf.target);
    c.clearRect(0, 0, doc.w, doc.h); c.drawImage(xf.base, 0, 0);
    if (xf.mask) { const m = ctxOf(xf.L.mask); m.clearRect(0, 0, doc.w, doc.h); m.drawImage(xf.mask, 0, 0); }
    touch(xf.L);
    sel = xf.selWas; xf = null;
    buildOptions(); render(); status('Transformação cancelada');
  }
  function xfDrag(p, e) {
    const b = drag.box0;
    if (drag.mode === 'move') { xf.box = { ...b, cx: b.cx + p.x - drag.a.x, cy: b.cy + p.y - drag.a.y }; }
    else if (drag.mode === 'rotate') {
      const a0 = Math.atan2(drag.a.y - b.cy, drag.a.x - b.cx), a1 = Math.atan2(p.y - b.cy, p.x - b.cx);
      let ang = b.angle + a1 - a0;
      if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
      xf.box = { ...b, angle: Math.atan2(Math.sin(ang), Math.cos(ang)) };
    } else {
      // cantos mantêm a proporção (Shift solta); Alt redimensiona a partir do centro
      const q = cropLocal(p, b), { sx, sy } = drag;
      let l = -b.w / 2, r = b.w / 2, t = -b.h / 2, bo = b.h / 2;
      if (e.altKey) {
        if (sx) { const hw = Math.max(0.5, Math.abs(q.x)); l = -hw; r = hw; }
        if (sy) { const hh = Math.max(0.5, Math.abs(q.y)); t = -hh; bo = hh; }
      } else {
        if (sx === 1) r = Math.max(l + 1, q.x); if (sx === -1) l = Math.min(r - 1, q.x);
        if (sy === 1) bo = Math.max(t + 1, q.y); if (sy === -1) t = Math.min(bo - 1, q.y);
      }
      if (sx && sy && !e.shiftKey) {
        const ratio = b.w / b.h;
        let w = r - l, h = bo - t;
        if (w / ratio > h) h = w / ratio; else w = h * ratio;
        if (e.altKey) { l = -w / 2; r = w / 2; t = -h / 2; bo = h / 2; }
        else { if (sx === 1) r = l + w; else l = r - w; if (sy === 1) bo = t + h; else t = bo - h; }
      }
      const c = cropToDoc({ x: (l + r) / 2, y: (t + bo) / 2 }, b);
      xf.box = { ...b, cx: c.x, cy: c.y, w: r - l, h: bo - t };
    }
    renderXf(false); drawOverlay();
  }
  function drawXfOverlay(sx, sy) {
    const b = xf.box, S = q => { const P = cropToDoc(q, b); return [sx(P.x), sy(P.y)]; };
    const hw = b.w / 2, hh = b.h / 2;
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => S({ x, y }));
    octx.save();
    const outline = () => { octx.beginPath(); octx.moveTo(...corners[0]); corners.slice(1).forEach(c => octx.lineTo(...c)); octx.closePath(); };
    outline(); octx.strokeStyle = 'rgba(0,0,0,.7)'; octx.lineWidth = 3; octx.stroke();
    outline(); octx.strokeStyle = '#fff'; octx.lineWidth = 1; octx.stroke();
    for (const [hx, hy] of CROP_HANDLES) {
      const [X, Y] = S({ x: hx * hw, y: hy * hh });
      octx.fillStyle = '#fff'; octx.fillRect(X - 4, Y - 4, 8, 8);
      octx.strokeStyle = '#111'; octx.lineWidth = 1; octx.strokeRect(X - 4.5, Y - 4.5, 9, 9);
    }
    const [cx, cy] = S({ x: 0, y: 0 });
    octx.beginPath(); octx.arc(cx, cy, 4, 0, Math.PI * 2); octx.strokeStyle = '#fff'; octx.lineWidth = 1.5; octx.stroke();
    const deg = Math.round(b.angle * 1800 / Math.PI) / 10;
    const label = `${Math.round(b.w / xf.src.w * 100)}% × ${Math.round(b.h / xf.src.h * 100)}%${deg ? ` · ${deg}°` : ''}`;
    const top = corners.reduce((a, c) => c[1] < a[1] ? c : a);
    octx.font = '12px system-ui, sans-serif';
    const tw = octx.measureText(label).width, W = overlay.width / (devicePixelRatio || 1);
    const lx = Math.min(W - tw - 12, Math.max(4, top[0] - tw / 2 - 6)), ly = Math.max(4, top[1] - 26);
    octx.fillStyle = 'rgba(0,0,0,.75)'; octx.fillRect(lx, ly, tw + 12, 20);
    octx.fillStyle = '#fff'; octx.fillText(label, lx + 6, ly + 14);
    octx.restore();
  }

  // ---------- camadas de texto editáveis: o texto fica guardado como dados (conteúdo, fonte, cor, matriz)
  const IDENT = [1, 0, 0, 1, 0, 0];
  // multiplicação de matrizes 2D no formato do canvas [a b c d e f]: aplica B e depois A
  const matMul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  const textFont = t => (t.bold ? 'bold ' : '') + t.size + 'px "' + t.font + '"';
  const measureCtx = newCanvas(1, 1).getContext('2d');
  function textMeasure(t) {
    measureCtx.font = textFont(t);
    const lines = t.content.split('\n');
    return { w: Math.max(1, ...lines.map(l => measureCtx.measureText(l).width)), h: lines.length * t.size * 1.2 };
  }
  function drawText(c, t) {
    c.save(); c.setTransform(...(t.m || IDENT));
    c.font = textFont(t); c.fillStyle = t.color; c.textBaseline = 'top'; c.textAlign = 'left';
    t.content.split('\n').forEach((ln, i) => c.fillText(ln, t.x, t.y + i * t.size * 1.2 + t.size * 0.1));
    c.restore();
  }
  // redesenha a camada a partir dos dados do texto (nítido em qualquer escala ou ângulo)
  function renderTextLayer(L, t) {
    const m = textMeasure(t), nt = { ...t, m: t.m || IDENT.slice(), w: m.w, h: m.h };
    const c = ctxOf(L.canvas); c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, doc.w, doc.h); c.restore();
    drawText(c, nt); touch(L); L.text = nt;
  }
  // o texto só continua editável se os pixels da camada ainda são os dele (senão outra edição o rasterizou)
  function textValid(L) {
    const t = L.text; if (!t) return false;
    const fresh = newCanvas(doc.w, doc.h); drawText(ctxOf(fresh), t);
    const a = ctxOf(L.canvas).getImageData(0, 0, doc.w, doc.h).data, b = ctxOf(fresh).getImageData(0, 0, doc.w, doc.h).data;
    let diff = 0, ink = 0;
    for (let i = 0; i < a.length; i += 4) {
      const ab = b[i + 3]; if (ab > 8) ink++;
      // diferença de transparência, ou de cor onde os dois são opacos (pintar por cima de uma área opaca também rasteriza)
      let bad = Math.abs(a[i + 3] - ab) > 40;
      if (!bad && ab > 200 && a[i + 3] > 200 && (Math.abs(a[i] - b[i]) > 40 || Math.abs(a[i + 1] - b[i + 1]) > 40 || Math.abs(a[i + 2] - b[i + 2]) > 40)) bad = true;
      if (bad) diff++;
    }
    return diff <= Math.max(60, ink * 0.01);
  }
  // camada de texto (de cima para baixo) sob o ponto, ou -1
  function textHit(p) {
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const L = doc.layers[i], t = L.text;
      if (!L.visible || !t) continue;
      const [a, b, c, d, e, f] = t.m || IDENT, det = a * d - b * c;
      if (!det) continue;
      const x = (d * (p.x - e) - c * (p.y - f)) / det, y = (-b * (p.x - e) + a * (p.y - f)) / det, pad = 6 / view.zoom;
      if (x >= t.x - pad && x <= t.x + t.w + pad && y >= t.y - pad && y <= t.y + t.h + pad) return i;
    }
    return -1;
  }
  // matriz que a transformação livre aplicou (origem → destino)
  function xfMatrix(x) {
    const b = x.box, s = x.src, sw = b.w / s.w, sh = b.h / s.h, co = Math.cos(b.angle), si = Math.sin(b.angle);
    const T0 = [1, 0, 0, 1, -(s.x + s.w / 2), -(s.y + s.h / 2)], S = [x.fx * sw, 0, 0, x.fy * sh, 0, 0], R = [co, si, -si, co, 0, 0], T = [1, 0, 0, 1, b.cx, b.cy];
    return matMul(T, matMul(R, matMul(S, T0)));
  }
  const TEXT_FONTS = ['Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Courier New', 'Impact', 'Comic Sans MS', 'system-ui'];
  function editTextLayer(L) {
    if (!L || !L.text) return status('A camada ativa não é de texto');
    if (L.lockPixels) return status('Os pixels desta camada estão bloqueados');
    if (!textValid(L)) { L.text = null; refreshPanels(); return status('Este texto foi rasterizado por outra edição e não pode mais ser editado'); }
    commitText();
    const before = L.text, autoName = L.name === (before.content.trim().split('\n')[0].slice(0, 24) || 'Texto');
    let ta;
    const fonts = TEXT_FONTS.includes(before.font) ? TEXT_FONTS : [before.font, ...TEXT_FONTS];
    const apply = v => { renderTextLayer(L, { ...before, content: v.content, font: v.font, size: v.size, bold: v.bold, color: v.color }); render(); };
    openDialog({
      title: 'Editar texto — ' + L.name, preview: true,
      fields: [
        { key: 'content', type: 'custom', value: before.content, build: (row, notify) => {
          ta = document.createElement('textarea'); ta.value = before.content; ta.rows = 3; ta.spellcheck = false;
          ta.style.cssText = 'width:100%;min-width:300px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:7px 9px;font:inherit;resize:vertical';
          ta.addEventListener('input', notify); ta.addEventListener('keydown', e => e.stopPropagation());
          row.appendChild(ta); return { get: () => ta.value };
        } },
        { key: 'font', label: 'Fonte', type: 'select', value: before.font, options: fonts.map(f => [f, f]) },
        { key: 'size', label: 'Tamanho', type: 'range', min: 4, max: 600, step: 1, value: before.size },
        { key: 'bold', label: 'Negrito', type: 'checkbox', value: before.bold },
        { key: 'color', label: 'Cor', type: 'color', value: before.color },
      ],
      onInput: apply,
      onOk: v => {
        const t = { ...before, content: v.content.replace(/\s+$/, ''), font: v.font, size: v.size, bold: v.bold, color: v.color };
        if (!t.content.trim()) {
          // texto vazio: remove a camada (se não for a única)
          if (doc.layers.length > 1) { const i = doc.layers.indexOf(L); doc.layers.splice(i, 1); doc.active = Math.max(0, Math.min(doc.active, doc.layers.length - 1)); pushHistory('Excluir texto'); render(); return; }
          renderTextLayer(L, before); render(); return;
        }
        renderTextLayer(L, t);
        if (autoName) L.name = t.content.trim().split('\n')[0].slice(0, 24) || 'Texto';
        pushHistory('Editar texto'); render();
      },
      onCancel: () => { renderTextLayer(L, before); render(); },
    });
    setTimeout(() => ta && ta.focus(), 30);
  }

  // ---------- formas vetoriais: guardadas como dados (tipo, retângulo, cores, contorno, matriz) e redesenhadas nítidas
  function shapePath(c, sh) {
    const { kind, x, y, w, h } = sh, cx = x + w / 2, cy = y + h / 2, rx = Math.abs(w) / 2, ry = Math.abs(h) / 2;
    c.beginPath();
    if (kind === 'rect') {
      const r = Math.max(0, Math.min(sh.radius || 0, Math.abs(w) / 2, Math.abs(h) / 2));
      if (r > 0) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
    } else if (kind === 'ellipse') c.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2);
    else if (kind === 'poly' || kind === 'star') {
      const n = Math.max(3, sh.sides | 0), pts = kind === 'star' ? n * 2 : n;
      for (let i = 0; i < pts; i++) {
        const a = -Math.PI / 2 + i * 2 * Math.PI / pts, f = kind === 'star' && i % 2 ? (sh.inner == null ? 45 : sh.inner) / 100 : 1;
        const px = cx + Math.cos(a) * rx * f, py = cy + Math.sin(a) * ry * f;
        if (i) c.lineTo(px, py); else c.moveTo(px, py);
      }
      c.closePath();
    } else if (kind === 'line') { c.moveTo(x, y); c.lineTo(x + w, y + h); }
  }
  function drawShape(c, sh) {
    c.save(); c.transform(...(sh.m || IDENT));
    shapePath(c, sh);
    if (sh.fillOn && sh.kind !== 'line') { c.fillStyle = sh.fill; c.fill(); }
    if (sh.strokeOn || sh.kind === 'line') { c.lineWidth = Math.max(0.5, sh.strokeW || 1); c.strokeStyle = sh.stroke; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(); }
    c.restore();
  }
  function renderShapeLayer(L, sh) {
    const nt = { ...sh, m: sh.m || IDENT.slice() };
    const c = ctxOf(L.canvas); c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, doc.w, doc.h); c.restore();
    drawShape(c, nt); touch(L); L.shape = nt;
  }
  // a forma só continua editável se os pixels da camada ainda são os dela
  function shapeValid(L) {
    const t = L.shape; if (!t) return false;
    const fresh = newCanvas(doc.w, doc.h); drawShape(ctxOf(fresh), t);
    const a = ctxOf(L.canvas).getImageData(0, 0, doc.w, doc.h).data, b = ctxOf(fresh).getImageData(0, 0, doc.w, doc.h).data;
    let diff = 0, ink = 0;
    for (let i = 0; i < a.length; i += 4) {
      const ab = b[i + 3]; if (ab > 8) ink++;
      // diferença de transparência, ou de cor onde os dois são opacos (pintar por cima de uma área opaca também rasteriza)
      let bad = Math.abs(a[i + 3] - ab) > 40;
      if (!bad && ab > 200 && a[i + 3] > 200 && (Math.abs(a[i] - b[i]) > 40 || Math.abs(a[i + 1] - b[i + 1]) > 40 || Math.abs(a[i + 2] - b[i + 2]) > 40)) bad = true;
      if (bad) diff++;
    }
    return diff <= Math.max(60, ink * 0.01);
  }
  function shapeHit(p) {
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const L = doc.layers[i], t = L.shape;
      if (!L.visible || !t) continue;
      const [a, b, c, d, e, f] = t.m || IDENT, det = a * d - b * c;
      if (!det) continue;
      const x = (d * (p.x - e) - c * (p.y - f)) / det, y = (-b * (p.x - e) + a * (p.y - f)) / det, pad = Math.max(6 / view.zoom, (t.strokeW || 0) / 2 + 2);
      const x0 = Math.min(t.x, t.x + t.w), x1 = Math.max(t.x, t.x + t.w), y0 = Math.min(t.y, t.y + t.h), y1 = Math.max(t.y, t.y + t.h);
      if (x >= x0 - pad && x <= x1 + pad && y >= y0 - pad && y <= y1 + pad) return i;
    }
    return -1;
  }
  function makeShapeFrom(o, x, y, w, h) {
    if (o.kind !== 'line') { if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; } }
    const fillOn = o.kind !== 'line' && (o.fillOn || !o.strokeOn); // nunca invisível
    return { kind: o.kind, x, y, w, h, radius: o.radius, sides: o.sides, inner: 45, fillOn, fill: fg(), strokeOn: o.kind === 'line' || !!o.strokeOn, stroke: o.kind === 'line' ? fg() : bg(), strokeW: o.strokeW, m: IDENT.slice() };
  }
  function createShape(sh) {
    const names = { rect: 'Retângulo', ellipse: 'Elipse', poly: 'Polígono', star: 'Estrela', line: 'Linha' };
    const L = makeLayer(names[sh.kind] || 'Forma');
    renderShapeLayer(L, sh); insertLayer(L); pushHistory('Forma'); render();
  }
  function editShapeLayer(L) {
    if (!L || !L.shape) return status('A camada ativa não é uma forma');
    if (L.lockPixels) return status('Os pixels desta camada estão bloqueados');
    if (!shapeValid(L)) { L.shape = null; refreshPanels(); return status('Esta forma foi rasterizada por outra edição e não pode mais ser editada'); }
    commitText();
    const before = L.shape, k = before.kind, fields = [];
    if (k !== 'line') {
      fields.push({ key: 'fillOn', label: 'Preencher', type: 'checkbox', value: before.fillOn });
      fields.push({ key: 'fill', label: 'Cor do preenchimento', type: 'color', value: before.fill });
      fields.push({ key: 'strokeOn', label: 'Contorno', type: 'checkbox', value: before.strokeOn });
    }
    fields.push({ key: 'stroke', label: k === 'line' ? 'Cor da linha' : 'Cor do contorno', type: 'color', value: before.stroke });
    fields.push({ key: 'strokeW', label: 'Espessura', type: 'range', min: 1, max: 100, step: 1, value: before.strokeW || 1 });
    if (k === 'rect') fields.push({ key: 'radius', label: 'Canto arredondado', type: 'range', min: 0, max: Math.max(1, Math.floor(Math.min(Math.abs(before.w), Math.abs(before.h)) / 2)), step: 1, value: Math.min(before.radius || 0, Math.floor(Math.min(Math.abs(before.w), Math.abs(before.h)) / 2)) });
    if (k === 'poly' || k === 'star') fields.push({ key: 'sides', label: 'Lados / pontas', type: 'range', min: 3, max: 24, step: 1, value: before.sides });
    if (k === 'star') fields.push({ key: 'inner', label: 'Profundidade (%)', type: 'range', min: 10, max: 90, step: 1, value: before.inner == null ? 45 : before.inner });
    const apply = v => { const t = { ...before, ...v }; if (t.kind !== 'line' && !t.fillOn && !t.strokeOn) t.fillOn = true; renderShapeLayer(L, t); render(); };
    openDialog({
      title: 'Editar forma — ' + L.name, preview: true, fields,
      onInput: apply,
      onOk: v => { apply(v); pushHistory('Editar forma'); },
      onCancel: () => { renderShapeLayer(L, before); render(); },
    });
  }

  // ---------- texto
  function startText(p) {
    const ta = document.createElement('textarea');
    ta.className = 'text-editor'; ta.spellcheck = false;
    ws.appendChild(ta);
    textEdit = { ta, x: p.x, y: p.y, cancel: false };
    styleTextEditor();
    ta.addEventListener('input', autosizeText);
    ta.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); textEdit.cancel = true; commitText(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitText(); }
    });
    ta.addEventListener('blur', () => commitText());
    setTimeout(() => ta.focus(), 0);
  }
  const fontCss = (size) => `${opts.text.bold ? 'bold ' : ''}${size}px "${opts.text.font}"`;
  function styleTextEditor() {
    const { ta, x, y } = textEdit, z = view.zoom;
    ta.style.left = (view.x + x * z) + 'px';
    ta.style.top = (view.y + y * z) + 'px';
    ta.style.font = fontCss(opts.text.size * z);
    ta.style.lineHeight = '1.2';
    ta.style.color = fg();
    autosizeText();
  }
  function autosizeText() {
    const ta = textEdit?.ta; if (!ta) return;
    ta.style.height = '0'; ta.style.height = ta.scrollHeight + 'px';
    ta.style.width = '0'; ta.style.width = (ta.scrollWidth + opts.text.size * view.zoom * 0.6) + 'px';
  }
  function commitText() {
    if (!textEdit) return;
    const { ta, x, y, cancel } = textEdit;
    textEdit = null;
    const text = ta.value;
    ta.remove();
    if (cancel || !text.trim()) return;
    const L = makeLayer(text.trim().split('\n')[0].slice(0, 24) || 'Texto');
    renderTextLayer(L, { content: text.replace(/\s+$/, ''), font: opts.text.font, size: opts.text.size, bold: opts.text.bold, color: fg(), x, y, m: IDENT.slice() });
    insertLayer(L); pushHistory('Texto'); render();
  }

  // ---------- ponteiro
  const docPt = e => { const r = ws.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.zoom, y: (e.clientY - r.top - view.y) / view.zoom }; };
  const screenPt = e => { const r = ws.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  ws.addEventListener('pointerdown', e => {
    if (e.target.classList.contains('text-editor') || !modal.hidden) return;
    if (textEdit) { commitText(); if (tool === 'text') return; }
    closeMenus();
    e.preventDefault();
    ws.setPointerCapture(e.pointerId);
    if (e.button === 1 || spaceDown || (tool === 'hand' && e.button === 0)) {
      panning = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; updateCursor(); return;
    }
    if (e.button !== 0) return;
    const p = docPt(e);
    if (xf) { drag = { tool: 'xf', a: p, box0: { ...xf.box }, ...cropHit(p, xf.box) }; return; }
    switch (tool) {
      case 'brush': case 'eraser': case 'spot':
        if (beginStroke(p, e)) drag = { tool: 'brush' }; // mesmo fluxo de traço para os três
        break;
      case 'clone': case 'heal':
        if (e.altKey) {
          cloneState.src = { x: Math.round(p.x), y: Math.round(p.y) }; cloneState.offset = null;
          status(`Origem do carimbo: ${cloneState.src.x}, ${cloneState.src.y}`); buildOptions(); drawOverlay();
        } else if (beginStroke(p, e)) drag = { tool: 'brush' };
        break;
      case 'gradient':
        if (!layerEditable()) break;
        gradLine = { a: p, b: p };
        stroke = editingMask()
          ? { erase: false, onMask: true, gray: 1, cov: selCoverage(), alpha: opts.gradient.opacity / 100, label: 'Degradê na máscara', clipped: false }
          : { erase: false, alpha: opts.gradient.opacity / 100, label: 'Degradê', clipped: false };
        drag = { tool };
        break;
      case 'marquee':
        drag = { tool, a: p, moved: false, mode: selModeFrom(e, opts.marquee.mode) };
        break;
      case 'shape': drag = { tool, a: p, moved: false }; break;
      case 'quick': {
        const o = opts.quick, src = o.allLayers ? flattenCanvas(null) : active().canvas;
        qs = { mode: selModeFrom(e, o.mode), base: sel ? selMaskCanvas() : null, seed: newCanvas(doc.w, doc.h), data: ctxOf(src).getImageData(0, 0, doc.w, doc.h).data,
          last: p, bb: { x0: p.x, y0: p.y, x1: p.x, y1: p.y }, t: 0 };
        qsSeedTo(p, p); qsUpdate(); drag = { tool };
        break;
      }
      case 'lasso': {
        const o = opts.lasso;
        if (o.type === 'free') { lasso = { pts: [p], mode: selModeFrom(e, o.mode), poly: false }; drag = { tool }; break; }
        if (!lasso) lasso = { pts: [], mode: selModeFrom(e, o.mode), poly: true, cur: p };
        const f = lasso.pts[0];
        if (f && lasso.pts.length >= 3 && Math.hypot((p.x - f.x) * view.zoom, (p.y - f.y) * view.zoom) < 8) { finishLasso(); break; } // clique no 1º ponto fecha
        const last = lasso.pts[lasso.pts.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) * view.zoom >= 2) lasso.pts.push(p);
        drawOverlay();
        break;
      }
      case 'wand': {
        const px = Math.floor(p.x), py = Math.floor(p.y);
        if (px < 0 || py < 0 || px >= doc.w || py >= doc.h) break;
        const o = opts.wand, src = o.allLayers ? flattenCanvas(null) : active().canvas;
        const d = ctxOf(src).getImageData(0, 0, doc.w, doc.h).data;
        combineSel(maskToCanvas(colorMask(d, doc.w, doc.h, px, py, o.tolerance, o.contiguous)), selModeFrom(e, o.mode));
        status(sel ? `Seleção: ${sel.w} × ${sel.h} px` : 'Seleção vazia');
        drawOverlay();
        break;
      }
      case 'move': {
        if (active().group) { // grupo: move todas as camadas de dentro juntas
          const G = active();
          if (!effVisible(G)) { status('O grupo está oculto'); break; }
          if (G.lockPos) { status('A posição deste grupo está bloqueada'); break; }
          const items = descendantsOf(G).filter(l => !l.group && !l.lockPos).map(l => ({ L: l, base: cloneCanvas(l.canvas), mask: l.mask ? cloneCanvas(l.mask) : null }));
          if (!items.length) { status('O grupo está vazio'); break; }
          drag = { tool, a: p, group: true, items, moved: false };
          break;
        }
        if (!layerEditable(true)) break;
        if (active().lockPos && !editingMask()) { status('A posição desta camada está bloqueada'); break; }
        const tc = targetCanvas(), src = cloneCanvas(tc);
        let float = src, hole = null;
        if (sel) {
          float = newCanvas(doc.w, doc.h);
          withSel(float.getContext('2d'), f => f.drawImage(src, 0, 0));
          hole = cloneCanvas(src);
          eraseSel(hole.getContext('2d'));
        }
        drag = { tool, a: p, float, hole, tc, sel0: sel && { ...sel }, moved: false };
        break;
      }
      case 'bucket':
        if (layerEditable() && p.x >= 0 && p.y >= 0 && p.x < doc.w && p.y < doc.h) floodFill(Math.floor(p.x), Math.floor(p.y));
        break;
      case 'eyedropper':
        sampleColor(p, e.altKey); drag = { tool, alt: e.altKey };
        break;
      case 'text': {
        const hi = textHit(p);
        if (hi >= 0) { doc.active = hi; refreshPanels(); editTextLayer(doc.layers[hi]); } else startText(p);
        break;
      }
      case 'crop':
        if (!crop) initCrop();
        drag = { tool, a: p, box0: { ...crop }, ...cropHit(p) };
        break;
      case 'zoom': {
        const s = screenPt(e);
        zoomAt(view.zoom * (e.altKey ? 0.8 : 1.25), s.x, s.y);
        break;
      }
    }
  });

  ws.addEventListener('pointermove', e => {
    const p = docPt(e);
    cursor.x = p.x; cursor.y = p.y; cursor.in = true;
    $('#stPos').textContent = `${Math.floor(p.x)}, ${Math.floor(p.y)}`;
    if (panning) {
      view.x = panning.vx + e.clientX - panning.sx; view.y = panning.vy + e.clientY - panning.sy;
      applyView(); return;
    }
    if (!drag && xf) { ws.style.cursor = spaceDown ? 'grab' : cropCursor(cropHit(p, xf.box), xf.box); return; }
    if (drag && drag.tool === 'xf') { xfDrag(p, e); return; }
    if (!drag && tool === 'crop' && crop) { ws.style.cursor = spaceDown ? 'grab' : cropCursor(cropHit(p)); return; }
    if (drag && drag.tool === 'crop') { cropDrag(p, e); drawOverlay(); return; }
    if (!drag && tool === 'lasso' && lasso && lasso.poly) { lasso.cur = p; drawOverlay(); return; }
    if (!drag) { if (tool === 'brush' || tool === 'eraser' || tool === 'spot' || tool === 'quick' || isCloneTool()) drawOverlay(); return; }
    switch (drag.tool) {
      case 'brush': case 'eraser': {
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ce of (evs.length ? evs : [e])) { const q = docPt(ce); strokeTo(q.x, q.y, pressureOf(ce)); }
        requestRender();
        break;
      }
      case 'gradient':
        gradLine.b = p; drawGradient(); requestRender();
        break;
      case 'shape': {
        const o = opts.shape; let w = p.x - drag.a.x, h = p.y - drag.a.y;
        if (Math.abs(w) < 2 && Math.abs(h) < 2 && !drag.moved) return;
        drag.moved = true;
        if (e.shiftKey) {
          if (o.kind === 'line') { const ang = Math.round(Math.atan2(h, w) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(w, h); w = Math.cos(ang) * len; h = Math.sin(ang) * len; }
          else { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
        }
        let x = drag.a.x, y = drag.a.y;
        if (e.altKey && o.kind !== 'line') { x -= w; y -= h; w *= 2; h *= 2; } // a partir do centro
        drag.sh = makeShapeFrom(o, x, y, w, h); drawOverlay();
        break;
      }
      case 'quick': {
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ce of (evs.length ? evs : [e])) { const q = docPt(ce); qsSeedTo(qs.last, q); qs.last = q; }
        const now = performance.now();
        if (now - qs.t > 90) { qsUpdate(); qs.t = performance.now(); } // ao vivo, no máximo ~10x por segundo
        drawOverlay();
        break;
      }
      case 'lasso': {
        const l = lasso.pts[lasso.pts.length - 1];
        if (Math.hypot(p.x - l.x, p.y - l.y) * view.zoom >= 1.5) { lasso.pts.push(p); drawOverlay(); }
        break;
      }
      case 'marquee': {
        let w = p.x - drag.a.x, h = p.y - drag.a.y;
        if (e.shiftKey && drag.mode === 'new') { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
        if (Math.abs(w) < 1 && Math.abs(h) < 1 && !drag.moved) return;
        drag.moved = true;
        const x = Math.round(Math.min(drag.a.x, drag.a.x + w)), y = Math.round(Math.min(drag.a.y, drag.a.y + h));
        const shape = { type: opts.marquee.shape, x, y, w: Math.round(Math.abs(w)), h: Math.round(Math.abs(h)) };
        if (drag.mode === 'new') sel = shape; else selDraft = shape;
        drawOverlay();
        break;
      }
      case 'move': {
        const dx = Math.round(p.x - drag.a.x), dy = Math.round(p.y - drag.a.y);
        drag.moved = drag.moved || dx !== 0 || dy !== 0; drag.dx = dx; drag.dy = dy;
        if (drag.group) {
          for (const it of drag.items) {
            const gc = ctxOf(it.L.canvas); gc.clearRect(0, 0, doc.w, doc.h); gc.drawImage(it.base, dx, dy);
            if (it.mask) { const mc = ctxOf(it.L.mask); mc.clearRect(0, 0, doc.w, doc.h); mc.drawImage(it.mask, dx, dy); }
          }
          requestRender(); break;
        }
        const c = ctxOf(drag.tc);
        c.clearRect(0, 0, doc.w, doc.h);
        if (drag.hole) c.drawImage(drag.hole, 0, 0);
        c.drawImage(drag.float, dx, dy);
        if (drag.sel0) sel = { ...drag.sel0, x: drag.sel0.x + dx, y: drag.sel0.y + dy };
        requestRender();
        break;
      }
      case 'eyedropper':
        sampleColor(p, drag.alt);
        break;
    }
  });

  /* Seleção rápida: o pincel marca sementes; a região cresce pelos vizinhos de cor parecida com a
     média das sementes, parando em bordas (salto brusco entre pixels vizinhos). A busca fica numa
     janela em volta do traço para não vazar pela imagem toda. */
  function qsSeedTo(a, b) {
    const c = qs.seed.getContext('2d'), r = opts.quick.size / 2;
    c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = c.fillStyle = '#fff'; c.lineWidth = opts.quick.size;
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    c.beginPath(); c.arc(b.x, b.y, r, 0, Math.PI * 2); c.fill();
    const bb = qs.bb; bb.x0 = Math.min(bb.x0, b.x - r); bb.y0 = Math.min(bb.y0, b.y - r); bb.x1 = Math.max(bb.x1, b.x + r); bb.y1 = Math.max(bb.y1, b.y + r);
  }
  function qsUpdate() {
    if (!qs) return;
    const w = doc.w, h = doc.h, { data, bb } = qs, tol = opts.quick.tolerance, margin = Math.ceil(opts.quick.size * 3 + 10);
    const x0 = Math.max(0, Math.floor(bb.x0 - margin)), y0 = Math.max(0, Math.floor(bb.y0 - margin));
    const x1 = Math.min(w - 1, Math.ceil(bb.x1 + margin)), y1 = Math.min(h - 1, Math.ceil(bb.y1 + margin));
    const W = x1 - x0 + 1, H = y1 - y0 + 1, n = W * H;
    if (W < 1 || H < 1) return;
    const sd = ctxOf(qs.seed).getImageData(x0, y0, W, H).data, vis = new Uint8Array(n), queue = new Int32Array(n);
    let qh = 0, qt = 0, cnt = 0, m0 = 0, m1 = 0, m2 = 0, m3 = 0;
    const px = p => ((y0 + ((p / W) | 0)) * w + x0 + (p % W)) * 4;
    for (let p = 0; p < n; p++) if (sd[p * 4 + 3] > 128) { vis[p] = 1; queue[qt++] = p; const i = px(p); m0 += data[i]; m1 += data[i + 1]; m2 += data[i + 2]; m3 += data[i + 3]; cnt++; }
    if (!cnt) return;
    m0 /= cnt; m1 /= cnt; m2 /= cnt; m3 /= cnt;
    let v = 0; for (let k = 0; k < qt; k++) { const i = px(queue[k]); v += (data[i] - m0) ** 2 + (data[i + 1] - m1) ** 2 + (data[i + 2] - m2) ** 2; }
    const thr = tol * 1.6 + 1.5 * Math.sqrt(v / (cnt * 3)), edge = Math.max(10, tol * 0.55);
    const dist = i => Math.sqrt((data[i] - m0) ** 2 + (data[i + 1] - m1) ** 2 + (data[i + 2] - m2) ** 2 + (data[i + 3] - m3) ** 2);
    const step = (i, j) => Math.max(Math.abs(data[i] - data[j]), Math.abs(data[i + 1] - data[j + 1]), Math.abs(data[i + 2] - data[j + 2]), Math.abs(data[i + 3] - data[j + 3]));
    while (qh < qt) {
      const p = queue[qh++], x = p % W, y = (p / W) | 0, ip = px(p);
      for (let d = 0; d < 4; d++) {
        const nx = d === 0 ? x - 1 : d === 1 ? x + 1 : x, ny = d === 2 ? y - 1 : d === 3 ? y + 1 : y;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx; if (vis[q]) continue;
        const iq = px(q);
        if (dist(iq) <= thr && step(iq, ip) <= edge) { vis[q] = 1; queue[qt++] = q; }
      }
    }
    const mask = new Uint8Array(w * h);
    for (let p = 0; p < n; p++) if (vis[p]) mask[(y0 + ((p / W) | 0)) * w + x0 + (p % W)] = 1;
    const grown = maskToCanvas(mask);
    let out = grown;
    if (qs.mode === 'sub') { if (!qs.base) return; out = cloneCanvas(qs.base); const x = out.getContext('2d'); x.globalCompositeOperation = 'destination-out'; x.drawImage(grown, 0, 0); }
    else if (qs.mode === 'add' && qs.base) { out = cloneCanvas(qs.base); out.getContext('2d').drawImage(grown, 0, 0); }
    sel = maskSel(out);
    drawOverlay();
  }

  /* Refinar seleção: suaviza (desfoque + limiar, arredonda cantos e remove serrilhado) e depois
     expande ou contrai por distância euclidiana. Só processa uma janela em volta da seleção. */
  function refineMask(baseCv, smooth, grow) {
    const w = doc.w, h = doc.h, b = selBounds();
    if (!b) return null;
    const m = Math.ceil(Math.max(Math.abs(grow), smooth * 3) + 6);
    const x0 = Math.max(0, b.x - m), y0 = Math.max(0, b.y - m), x1 = Math.min(w, b.x + b.w + m), y1 = Math.min(h, b.y + b.h + m);
    const W = x1 - x0, H = y1 - y0, n = W * H;
    const d = ctxOf(baseCv).getImageData(x0, y0, W, H).data;
    let inside = new Uint8Array(n);
    for (let p = 0; p < n; p++) inside[p] = d[p * 4 + 3] >= 128 ? 1 : 0;
    if (smooth > 0.3) {
      const f = new Float32Array(n);
      for (let p = 0; p < n; p++) f[p] = inside[p] * 255;
      blurFloat(f, W, H, smooth);
      for (let p = 0; p < n; p++) inside[p] = f[p] >= 127.5 ? 1 : 0;
    }
    if (Math.abs(grow) >= 0.5) {
      const r = Math.abs(grow);
      if (grow > 0) { const dist = edt(inside, W, H); for (let p = 0; p < n; p++) inside[p] = dist[p] <= r ? 1 : 0; }
      else { const out = new Uint8Array(n); for (let p = 0; p < n; p++) out[p] = 1 - inside[p]; const dist = edt(out, W, H); for (let p = 0; p < n; p++) inside[p] = inside[p] && dist[p] > r ? 1 : 0; }
    }
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside[y * W + x]) mask[(y0 + y) * w + x0 + x] = 1;
    return maskSel(maskToCanvas(mask));
  }

  // fecha o laço: preenche o polígono e combina com a seleção conforme o modo
  function finishLasso() {
    if (!lasso) return;
    const l = lasso; lasso = null;
    if (l.pts.length >= 3) {
      const c = newCanvas(doc.w, doc.h), x = c.getContext('2d');
      x.beginPath(); l.pts.forEach((q, i) => i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y)); x.closePath();
      x.fillStyle = '#fff'; x.fill();
      combineSel(c, l.mode);
      status(sel ? `Seleção: ${sel.w} × ${sel.h} px` : 'Seleção vazia');
    } else if (!l.poly && l.mode === 'new') sel = null; // só um clique: desmarca
    drawOverlay();
  }
  function endPointer() {
    if (panning) { panning = null; updateCursor(); return; }
    if (!drag) return;
    const d = drag; drag = null;
    switch (d.tool) {
      case 'brush': case 'eraser':
        lastPoint = { x: stroke.lx, y: stroke.ly };
        commitStroke();
        break;
      case 'gradient':
        if (gradLine && Math.hypot(gradLine.b.x - gradLine.a.x, gradLine.b.y - gradLine.a.y) > 1) commitStroke();
        else stroke = null;
        gradLine = null; render();
        break;
      case 'lasso': finishLasso(); break;
      case 'shape':
        if (d.sh && (d.sh.kind === 'line' ? Math.hypot(d.sh.w, d.sh.h) >= 3 : d.sh.w >= 2 && d.sh.h >= 2)) createShape(d.sh);
        else if (!d.moved) { const hi = shapeHit(d.a); if (hi >= 0) { doc.active = hi; refreshPanels(); editShapeLayer(doc.layers[hi]); } } // clique numa forma: edita
        drawOverlay();
        break;
      case 'quick':
        qsUpdate(); qs = null; drawOverlay();
        status(sel ? 'Seleção: ' + sel.w + ' × ' + sel.h + ' px' : 'Seleção vazia');
        break;
      case 'marquee':
        if (d.mode === 'new') { if (!d.moved || !sel || sel.w < 1 || sel.h < 1) sel = null; }
        else if (selDraft && selDraft.w >= 1 && selDraft.h >= 1) combineSel(rasterShape(selDraft), d.mode);
        selDraft = null;
        drawOverlay();
        break;
      case 'move':
        if (d.moved && d.group) {
          for (const it of d.items) { touch(it.L); if (it.L.text) it.L.text = { ...it.L.text, m: matMul([1, 0, 0, 1, d.dx || 0, d.dy || 0], it.L.text.m || IDENT) };
            if (it.L.shape) it.L.shape = { ...it.L.shape, m: matMul([1, 0, 0, 1, d.dx || 0, d.dy || 0], it.L.shape.m || IDENT) }; }
          lockBypass = true; pushHistory('Mover grupo'); lockBypass = false;
        } else if (d.moved) {
          const L = active(); touch(L);
          if (L.text && d.tc === L.canvas && !d.sel0) L.text = { ...L.text, m: matMul([1, 0, 0, 1, d.dx || 0, d.dy || 0], L.text.m || IDENT) };
          if (L.shape && d.tc === L.canvas && !d.sel0) L.shape = { ...L.shape, m: matMul([1, 0, 0, 1, d.dx || 0, d.dy || 0], L.shape.m || IDENT) };
          lockBypass = true; pushHistory('Mover'); lockBypass = false;
        }
        break;
      case 'crop':
        if (d.mode === 'rotate') buildOptions(); // atualiza o controle de ângulo
        break;
      case 'xf':
        buildOptions(); // atualiza largura/altura/ângulo na barra
        break;
    }
  }
  ws.addEventListener('pointerup', endPointer);
  ws.addEventListener('dblclick', e => { if (tool === 'lasso' && lasso && lasso.poly) return finishLasso(); if (xf && cropHit(docPt(e), xf.box).mode === 'move') return applyTransform(); if (tool === 'crop' && crop && cropHit(docPt(e)).mode === 'move') applyCrop(); });
  ws.addEventListener('pointercancel', endPointer);
  ws.addEventListener('pointerleave', () => { cursor.in = false; drawOverlay(); });

  ws.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const s = screenPt(e);
      zoomAt(view.zoom * Math.exp(-e.deltaY * (e.ctrlKey && Math.abs(e.deltaY) < 50 ? 0.01 : 0.0025)), s.x, s.y);
    } else {
      view.x -= e.shiftKey ? e.deltaY : e.deltaX;
      view.y -= e.shiftKey ? 0 : e.deltaY;
      applyView();
    }
  }, { passive: false });

  // ---------- diálogo genérico
  let dlg = null;
  function openDialog({ title, fields, onInput, onOk, onCancel, okLabel = 'OK', preview = false }) {
    modal.classList.toggle('preview', preview);
    $('#dlgTitle').textContent = title;
    $('#dlgOk').textContent = okLabel;
    const body = $('#dlgBody'); body.innerHTML = '';
    const inputs = {}, outs = {};
    const fire = key => onInput && onInput(values(), set, key);
    for (const f of fields) {
      if (f.type === 'custom') {
        const row = document.createElement('div'); row.className = 'field-custom';
        body.appendChild(row);
        inputs[f.key] = f.build(row, () => fire(f.key));
        continue;
      }
      if (f.type === 'section') {
        const h = document.createElement('label'); h.className = 'dlg-section';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!f.value; cb.dataset.key = f.key;
        h.append(cb, f.label); body.appendChild(h); inputs[f.key] = cb;
        continue;
      }
      const row = document.createElement('div');
      row.className = 'field' + (f.type === 'range' ? '' : ' wide');
      const lab = document.createElement('label'); lab.textContent = f.label;
      let inp;
      if (f.type === 'select') {
        inp = document.createElement('select');
        for (const [v, t] of f.options) { const o = document.createElement('option'); o.value = v; o.textContent = t; inp.appendChild(o); }
        inp.value = f.value;
      } else {
        inp = document.createElement('input'); inp.type = f.type;
        if (f.type === 'checkbox') inp.checked = !!f.value;
        else { for (const k of ['min', 'max', 'step']) if (f[k] !== undefined) inp[k] = f[k]; inp.value = f.value; }
      }
      inp.dataset.key = f.key;
      const id = 'dlg_' + f.key; inp.id = id; lab.htmlFor = id;
      row.append(lab, inp);
      if (f.type === 'range') { const o = document.createElement('output'); o.textContent = f.value; outs[f.key] = o; row.appendChild(o); }
      body.appendChild(row);
      inputs[f.key] = inp;
    }
    const values = () => {
      const v = {};
      for (const [k, i] of Object.entries(inputs)) v[k] = i.get ? i.get() : i.type === 'checkbox' ? i.checked : (i.type === 'range' || i.type === 'number') ? parseFloat(i.value) : i.value;
      return v;
    };
    const syncOuts = () => { for (const [k, o] of Object.entries(outs)) o.textContent = inputs[k].value; };
    const set = (k, val) => { if (inputs[k].type === 'checkbox') inputs[k].checked = !!val; else inputs[k].value = val; syncOuts(); };
    body.oninput = body.onchange = e => { if (!e.target.dataset.key) return; syncOuts(); fire(e.target.dataset.key); };
    dlg = { ok: () => { closeDialog(); onOk && onOk(values()); }, cancel: () => { closeDialog(); onCancel && onCancel(); } };
    modal.hidden = false;
    const first = body.querySelector('input,select'); first && first.focus();
  }
  function closeDialog() { modal.hidden = true; $('#dlgBody').oninput = $('#dlgBody').onchange = null; }
  $('#dialog').addEventListener('submit', e => { e.preventDefault(); dlg && dlg.ok(); });
  $('#dlgCancel').addEventListener('click', () => dlg && dlg.cancel());

  // ---------- filtros e ajustes
  const ADJ = {
    curves: { title: 'Curvas', fields: ctx => [{ key: 'curves', type: 'custom', value: (ctx.value && ctx.value.curves) || defaultCurves(), build: (row, notify) => buildCurvesWidget(row, notify, ctx) }] },
    brightness: { title: 'Brilho/Contraste', fields: [
      { key: 'brightness', label: 'Brilho', type: 'range', min: -100, max: 100, value: 0 },
      { key: 'contrast', label: 'Contraste', type: 'range', min: -100, max: 100, value: 0 }] },
    levels: { title: 'Níveis', fields: [
      { key: 'black', label: 'Preto', type: 'range', min: 0, max: 253, value: 0 },
      { key: 'gamma', label: 'Gama', type: 'range', min: 0.1, max: 3, step: 0.01, value: 1 },
      { key: 'white', label: 'Branco', type: 'range', min: 2, max: 255, value: 255 }] },
    hsl: { title: 'Matiz/Saturação', fields: [
      { key: 'hue', label: 'Matiz', type: 'range', min: -180, max: 180, value: 0 },
      { key: 'saturation', label: 'Saturação', type: 'range', min: -100, max: 100, value: 0 },
      { key: 'lightness', label: 'Luminosidade', type: 'range', min: -100, max: 100, value: 0 }] },
    threshold: { title: 'Limiar', fields: [{ key: 'level', label: 'Nível', type: 'range', min: 1, max: 255, value: 128 }] },
    posterize: { title: 'Posterizar', fields: [{ key: 'levels', label: 'Níveis', type: 'range', min: 2, max: 32, value: 4 }] },
    blur: { title: 'Desfoque gaussiano', fields: [{ key: 'radius', label: 'Raio (px)', type: 'range', min: 0.5, max: 60, step: 0.5, value: 4 }] },
    sharpen: { title: 'Máscara de nitidez', fields: [
      { key: 'amount', label: 'Quantidade %', type: 'range', min: 1, max: 300, value: 80 },
      { key: 'radius', label: 'Raio', type: 'range', min: 0.5, max: 10, step: 0.1, value: 1.5 }] },
    noise: { title: 'Adicionar ruído', fields: [
      { key: 'amount', label: 'Quantidade %', type: 'range', min: 0, max: 100, value: 20 },
      { key: 'mono', label: 'Monocromático', type: 'checkbox', value: true }] },
    pixelate: { title: 'Pixelizar', fields: [{ key: 'size', label: 'Tamanho da célula', type: 'range', min: 2, max: 100, value: 10 }] },
  };
  const FX_LABELS = { invert: 'Inverter', desaturate: 'Dessaturar', sepia: 'Sépia', autolevels: 'Tom automático', emboss: 'Relevo', edges: 'Detectar bordas' };

  // ---------- curvas: gráfico interativo
  const LINEAR = () => [[0, 0], [255, 255]];
  const defaultCurves = () => ({ rgb: LINEAR(), r: LINEAR(), g: LINEAR(), b: LINEAR() });
  const CURVE_PRESETS = [
    ['linear', 'Linear (padrão)', LINEAR()],
    ['s1', 'Contraste médio', [[0, 0], [64, 52], [192, 204], [255, 255]]],
    ['s2', 'Contraste forte', [[0, 0], [64, 38], [192, 218], [255, 255]]],
    ['light', 'Clarear', [[0, 0], [128, 162], [255, 255]]],
    ['dark', 'Escurecer', [[0, 0], [128, 96], [255, 255]]],
    ['fade', 'Desbotado', [[0, 36], [128, 132], [255, 236]]],
    ['neg', 'Negativo', [[0, 255], [255, 0]]],
  ];
  const CH_COLORS = { rgb: '#e5e7eb', r: '#ef4444', g: '#22c55e', b: '#3b82f6' };
  function buildCurvesWidget(row, notify, { orig, isMask, value }) {
    const curves = value && value.curves ? JSON.parse(JSON.stringify(value.curves)) : defaultCurves();
    let ch = 'rgb', dragIdx = -1, removing = false;
    // histogramas (luminosidade e por canal) da imagem original
    const hist = { rgb: new Float32Array(256), r: new Float32Array(256), g: new Float32Array(256), b: new Float32Array(256) };
    const d = ctxOf(orig).getImageData(0, 0, orig.width, orig.height).data;
    for (let i = 0; i < d.length; i += 4) {
      if (isMask) { hist.rgb[d[i + 3]]++; continue; }
      if (d[i + 3] < 8) continue;
      hist.r[d[i]]++; hist.g[d[i + 1]]++; hist.b[d[i + 2]]++;
      hist.rgb[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++;
    }
    // escala pelo percentil 99 para um pico isolado não achatar o resto
    for (const h of Object.values(hist)) {
      const sorted = Array.from(h).sort((a, b) => a - b), top = sorted[252] || 1;
      for (let v = 0; v < 256; v++) h[v] = Math.min(1, h[v] / top);
    }

    const bar = document.createElement('div'); bar.className = 'curves-bar';
    const chSel = document.createElement('select');
    for (const [v, t] of isMask ? [['rgb', 'Cinza']] : [['rgb', 'RGB'], ['r', 'Vermelho'], ['g', 'Verde'], ['b', 'Azul']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; chSel.appendChild(o); }
    const preset = document.createElement('select');
    { const o = document.createElement('option'); o.value = ''; o.textContent = 'Predefinição…'; preset.appendChild(o); }
    for (const [v, t] of CURVE_PRESETS) { const o = document.createElement('option'); o.value = v; o.textContent = t; preset.appendChild(o); }
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'Redefinir';
    bar.append(chSel, preset, reset);

    const SIZE = 256, dpr = devicePixelRatio || 1;
    const cv = document.createElement('canvas'); cv.className = 'curves-canvas';
    cv.width = SIZE * dpr; cv.height = SIZE * dpr; cv.style.width = cv.style.height = SIZE + 'px';
    const c = cv.getContext('2d'); c.scale(dpr, dpr);
    const info = document.createElement('div'); info.className = 'curves-info';
    info.textContent = 'Clique para criar um ponto · arraste para ajustar · arraste para fora ou duplo clique remove';
    row.append(bar, cv, info);

    const px = v => v / 255 * SIZE, py = v => SIZE - v / 255 * SIZE;
    function draw() {
      c.clearRect(0, 0, SIZE, SIZE);
      c.fillStyle = '#141518'; c.fillRect(0, 0, SIZE, SIZE);
      const h = hist[ch];
      c.fillStyle = ch === 'rgb' ? 'rgba(255,255,255,.16)' : CH_COLORS[ch] + '33';
      for (let v = 0; v < 256; v++) { const hh = h[v] * SIZE * 0.95; c.fillRect(px(v), SIZE - hh, SIZE / 256 + .5, hh); }
      c.strokeStyle = 'rgba(255,255,255,.08)'; c.lineWidth = 1;
      for (let i = 1; i < 4; i++) { const p = Math.round(SIZE * i / 4) + .5; c.beginPath(); c.moveTo(p, 0); c.lineTo(p, SIZE); c.moveTo(0, p); c.lineTo(SIZE, p); c.stroke(); }
      c.strokeStyle = 'rgba(255,255,255,.18)'; c.beginPath(); c.moveTo(0, SIZE); c.lineTo(SIZE, 0); c.stroke();
      // curvas dos outros canais em segundo plano
      for (const k of ['r', 'g', 'b', 'rgb']) {
        if (k === ch) continue;
        const pts = curves[k]; if (pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 255 && pts[1][1] === 255) continue;
        plot(k, CH_COLORS[k] + '66', 1);
      }
      plot(ch, CH_COLORS[ch], 2);
      curves[ch].forEach((p, i) => {
        if (removing && i === dragIdx) return;
        c.fillStyle = i === dragIdx ? CH_COLORS[ch] : '#141518'; c.strokeStyle = CH_COLORS[ch]; c.lineWidth = 1.5;
        c.fillRect(px(p[0]) - 4, py(p[1]) - 4, 8, 8); c.strokeRect(px(p[0]) - 4, py(p[1]) - 4, 8, 8);
      });
    }
    function plot(k, color, width) {
      const pts = removing && k === ch ? curves[k].filter((_, i) => i !== dragIdx) : curves[k];
      const lut = curveLUT(pts);
      c.strokeStyle = color; c.lineWidth = width; c.beginPath();
      for (let v = 0; v < 256; v++) v ? c.lineTo(px(v), py(lut[v])) : c.moveTo(px(v), py(lut[v]));
      c.stroke();
    }
    const toVal = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * 255, y: 255 - (e.clientY - r.top) / r.height * 255, oy: e.clientY - r.top, h: r.height }; };
    const near = q => curves[ch].findIndex(p => Math.abs(p[0] - q.x) < 8 && Math.abs(p[1] - q.y) < 8);
    const changed = () => { draw(); notify(); };

    cv.addEventListener('pointerdown', e => {
      const q = toVal(e); let i = near(q);
      if (i < 0) {
        const pts = curves[ch], x = Math.round(Math.min(255, Math.max(0, q.x)));
        if (pts.some(p => Math.abs(p[0] - x) < 3)) return;
        pts.push([x, Math.round(Math.min(255, Math.max(0, q.y)))]); pts.sort((a, b) => a[0] - b[0]);
        i = pts.findIndex(p => p[0] === x);
      }
      dragIdx = i; removing = false;
      try { cv.setPointerCapture(e.pointerId); } catch { /* ponteiro sintético */ }
      changed();
    });
    cv.addEventListener('pointermove', e => {
      const q = toVal(e);
      if (dragIdx < 0) {
        const xi = Math.round(Math.min(255, Math.max(0, q.x)));
        info.textContent = `Entrada ${xi} → Saída ${curveLUT(curves[ch])[xi]}`;
        return;
      }
      const pts = curves[ch], last = pts.length - 1;
      const lo = dragIdx === 0 ? 0 : pts[dragIdx - 1][0] + 1, hi = dragIdx === last ? 255 : pts[dragIdx + 1][0] - 1;
      pts[dragIdx] = [Math.round(Math.min(hi, Math.max(lo, q.x))), Math.round(Math.min(255, Math.max(0, q.y)))];
      removing = dragIdx > 0 && dragIdx < last && (q.oy < -24 || q.oy > q.h + 24);
      info.textContent = removing ? 'Solte para remover o ponto' : `Entrada ${pts[dragIdx][0]} → Saída ${pts[dragIdx][1]}`;
      changed();
    });
    const end = () => {
      if (dragIdx < 0) return;
      if (removing) { curves[ch].splice(dragIdx, 1); info.textContent = 'Ponto removido'; }
      dragIdx = -1; removing = false; changed();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('dblclick', e => {
      const i = near(toVal(e)), pts = curves[ch];
      if (i > 0 && i < pts.length - 1) { pts.splice(i, 1); changed(); }
    });
    chSel.onchange = () => { ch = chSel.value; draw(); };
    preset.onchange = () => {
      const p = CURVE_PRESETS.find(x => x[0] === preset.value);
      if (p) { curves[ch] = p[2].map(q => q.slice()); changed(); }
      preset.value = '';
    };
    reset.onclick = () => { for (const k of Object.keys(curves)) curves[k] = LINEAR(); changed(); };
    draw();
    return { get: () => JSON.parse(JSON.stringify(curves)) };
  }

  function applyFilter(target, orig, name, vals, isMask) {
    const tmp = cloneCanvas(orig), tc = ctxOf(tmp);
    const img = tc.getImageData(0, 0, tmp.width, tmp.height);
    if (isMask) maskToGray(img);
    Filters[name](img, vals || {});
    if (isMask) grayToMask(img);
    tc.putImageData(img, 0, 0);
    const c = ctxOf(target);
    c.clearRect(0, 0, doc.w, doc.h);
    if (!sel) { c.drawImage(tmp, 0, 0); return; }
    c.drawImage(orig, 0, 0);
    eraseSel(c);
    withSel(c, x => x.drawImage(tmp, 0, 0));
  }
  function runAdjust(name) {
    if (!layerEditable()) return;
    const spec = ADJ[name], L = active(), isMask = editingMask(), target = targetCanvas(), orig = cloneCanvas(target);
    const fields = typeof spec.fields === 'function' ? spec.fields({ orig, isMask }) : spec.fields;
    let timer;
    // durante a prévia o rev muda para invalidar caches (máscara/estilo); o histórico só registra no OK
    const preview = v => { clearTimeout(timer); timer = setTimeout(() => { applyFilter(target, orig, name, v, isMask); touch(L); render(); }, 30); };
    const defaults = Object.fromEntries(fields.map(f => [f.key, f.value]));
    openDialog({
      title: spec.title + (isMask ? ' (máscara)' : ''), fields, preview: true,
      onInput: preview,
      onOk: v => { clearTimeout(timer); applyFilter(target, orig, name, v, isMask); touch(L); pushHistory(spec.title); render(); },
      onCancel: () => { clearTimeout(timer); const c = ctxOf(target); c.clearRect(0, 0, doc.w, doc.h); c.drawImage(orig, 0, 0); touch(L); render(); },
    });
    preview(defaults);
  }
  // ---------- camadas de ajuste (não destrutivas: afetam tudo abaixo, editáveis depois)
  const ADJ_LAYER_TYPES = [['curves', 'Curvas'], ['levels', 'Níveis'], ['brightness', 'Brilho/Contraste'], ['hsl', 'Matiz/Saturação'],
    ['desaturate', 'Preto e branco'], ['invert', 'Inverter'], ['sepia', 'Sépia'], ['threshold', 'Limiar'], ['posterize', 'Posterizar']];
  const adjTitle = name => (ADJ_LAYER_TYPES.find(t => t[0] === name) || [, name])[1];
  function adjFields(L) {
    const spec = ADJ[L.adj.name];
    if (!spec) return null;
    // histograma das curvas = imagem composta abaixo desta camada
    const idx = doc.layers.indexOf(L), below = newCanvas(doc.w, doc.h);
    composite(below.getContext('2d'), false, true, idx);
    const raw = typeof spec.fields === 'function' ? spec.fields({ orig: below, isMask: false, value: L.adj.vals }) : spec.fields;
    return raw.map(f => ({ ...f, value: L.adj.vals && L.adj.vals[f.key] !== undefined ? L.adj.vals[f.key] : f.value }));
  }
  function newAdjLayer(name) {
    commitText();
    const L = makeLayer(adjTitle(name));
    L.adj = { name, vals: {} };
    // máscara: a seleção atual (se houver) ou tudo visível
    if (sel) { L.mask = newMask(false); withSel(L.mask.getContext('2d'), x => { x.fillStyle = '#fff'; x.fillRect(0, 0, doc.w, doc.h); }); sel = null; drawOverlay(); }
    else L.mask = newMask(true);
    Object.assign(L, { maskOn: true, maskEdit: true });
    insertLayer(L);
    if (ADJ[name]) editAdj(L, true);
    else { pushHistory(`Camada de ajuste: ${adjTitle(name)}`); render(); }
  }
  function editAdj(L, isNew) {
    const fields = adjFields(L);
    if (!fields) return status('Este ajuste não tem opções');
    if (isNew) L.adj = { name: L.adj.name, vals: Object.fromEntries(fields.map(f => [f.key, f.value])) };
    const before = L.adj, title = adjTitle(L.adj.name);
    let timer;
    openDialog({
      title: `${isNew ? 'Nova camada de ajuste' : 'Camada de ajuste'} — ${title}`, fields, preview: true,
      onInput: v => { clearTimeout(timer); timer = setTimeout(() => { L.adj = { name: before.name, vals: v }; render(); }, 25); },
      onOk: v => { clearTimeout(timer); L.adj = { name: before.name, vals: v }; pushHistory(isNew ? `Camada de ajuste: ${title}` : `Editar ajuste: ${title}`); render(); },
      onCancel: () => {
        clearTimeout(timer);
        if (isNew) { const i = doc.layers.indexOf(L); doc.layers.splice(i, 1); doc.active = Math.max(0, Math.min(doc.active - 1, doc.layers.length - 1)); refreshPanels(); }
        else L.adj = before;
        render();
      },
    });
    render();
  }

  function runInstant(name) {
    if (!layerEditable()) return;
    const L = active(), target = targetCanvas();
    applyFilter(target, cloneCanvas(target), name, null, editingMask());
    touch(L); pushHistory(FX_LABELS[name]); render();
  }

  // ---------- transformações de imagem
  function transformAll(nw, nh, label, draw) {
    commitText();
    for (const L of doc.layers) {
      const nc = newCanvas(nw, nh), c = ctxOf(nc);
      c.imageSmoothingQuality = 'high';
      draw(c, L.canvas);
      L.canvas = nc; L.text = null; L.shape = null; // rotacionar/redimensionar o documento rasteriza o texto
      if (L.mask) {
        // área nova da máscara fica visível (branca), como "revelar tudo"
        const nm = newCanvas(nw, nh), mc = ctxOf(nm);
        mc.fillStyle = '#fff'; mc.fillRect(0, 0, nw, nh);
        const cover = newCanvas(nw, nh);
        draw(cover.getContext('2d'), newMask(true)); // onde cai a área antiga do documento
        mc.globalCompositeOperation = 'destination-out'; mc.drawImage(cover, 0, 0);
        mc.globalCompositeOperation = 'source-over'; mc.imageSmoothingQuality = 'high';
        draw(mc, L.mask);
        L.mask = nm;
      }
      touch(L);
    }
    setDocSize(nw, nh); sel = null;
    pushHistory(label); render(); fitView(true);
  }
  const rotate = (deg) => {
    const swap = deg !== 180, nw = swap ? doc.h : doc.w, nh = swap ? doc.w : doc.h;
    transformAll(nw, nh, deg === 180 ? 'Girar 180°' : 'Girar 90°', (c, src) => {
      if (deg === 90) c.translate(nw, 0); else if (deg === -90) c.translate(0, nh); else c.translate(nw, nh);
      c.rotate(deg * Math.PI / 180); c.drawImage(src, 0, 0);
    });
  };
  const flip = h => transformAll(doc.w, doc.h, h ? 'Espelhar horizontal' : 'Espelhar vertical', (c, src) => {
    if (h) { c.translate(doc.w, 0); c.scale(-1, 1); } else { c.translate(0, doc.h); c.scale(1, -1); }
    c.drawImage(src, 0, 0);
  });

  // ---------- comandos
  const BLENDS = [['source-over', 'Normal'], ['multiply', 'Multiplicação'], ['screen', 'Divisão (Screen)'], ['overlay', 'Sobrepor'], ['darken', 'Escurecer'], ['lighten', 'Clarear'], ['color-dodge', 'Subexposição de cores'], ['color-burn', 'Superexposição de cores'], ['hard-light', 'Luz direta'], ['soft-light', 'Luz suave'], ['difference', 'Diferença'], ['exclusion', 'Exclusão'], ['hue', 'Matiz'], ['saturation', 'Saturação'], ['color', 'Cor'], ['luminosity', 'Luminosidade']];
  let layerCount = 1, fxClipboard = null;
  const FX_FIELDS = [
    ['dropShadow', 'Sombra projetada', [['color', 'Cor', 'color'], ['opacity', 'Opacidade %', 0, 100], ['angle', 'Ângulo °', -180, 180], ['distance', 'Distância', 0, 200], ['spread', 'Espalhamento %', 0, 100], ['size', 'Tamanho', 0, 100]]],
    ['outerGlow', 'Brilho externo', [['color', 'Cor', 'color'], ['opacity', 'Opacidade %', 0, 100], ['spread', 'Espalhamento %', 0, 100], ['size', 'Tamanho', 0, 100]]],
    ['innerShadow', 'Sombra interna', [['color', 'Cor', 'color'], ['opacity', 'Opacidade %', 0, 100], ['angle', 'Ângulo °', -180, 180], ['distance', 'Distância', 0, 100], ['size', 'Tamanho', 0, 100]]],
    ['colorOverlay', 'Sobreposição de cor', [['color', 'Cor', 'color'], ['opacity', 'Opacidade %', 0, 100]]],
    ['gradOverlay', 'Sobreposição de degradê', [
      ['style', 'Estilo', [['linear', 'Linear'], ['radial', 'Radial'], ['reflected', 'Espelhado']]],
      ['color1', 'Cor inicial', 'color'], ['color2', 'Cor final', 'color'],
      ['opacity', 'Opacidade %', 0, 100], ['angle', 'Ângulo ° (0 = esquerda→direita, 90 = cima→baixo)', -180, 180],
      ['scale', 'Escala %', 10, 300], ['reverse', 'Inverter cores', [['no', 'Não'], ['yes', 'Sim']]]]],
    ['bevel', 'Chanfro e relevo', [
      ['style', 'Estilo', [['inner', 'Chanfro interno'], ['outer', 'Chanfro externo'], ['emboss', 'Relevo']]],
      ['technique', 'Técnica', [['smooth', 'Suave'], ['chisel', 'Cinzel']]],
      ['direction', 'Direção', [['up', 'Para cima'], ['down', 'Para baixo']]],
      ['depth', 'Profundidade %', 1, 300], ['size', 'Tamanho', 1, 60], ['soften', 'Suavizar', 0, 16], ['angle', 'Ângulo °', -180, 180],
      ['hlColor', 'Cor do realce', 'color'], ['hlOpacity', 'Opacidade do realce %', 0, 100],
      ['shColor', 'Cor da sombra', 'color'], ['shOpacity', 'Opacidade da sombra %', 0, 100]]],
    ['stroke', 'Traço (contorno)', [['color', 'Cor', 'color'], ['opacity', 'Opacidade %', 0, 100], ['size', 'Tamanho', 1, 100], ['position', 'Posição', [['outside', 'Fora'], ['center', 'Centro'], ['inside', 'Dentro']]]]],
  ];

  const commands = {
    new: () => openDialog({
      title: 'Novo documento', okLabel: 'Criar',
      fields: [
        { key: 'preset', label: 'Predefinição', type: 'select', value: '', options: [['', 'Personalizado'], ['1920x1080', 'Full HD 1920×1080'], ['1080x1080', 'Post quadrado 1080×1080'], ['1080x1920', 'Story 1080×1920'], ['2480x3508', 'A4 300 ppi'], ['800x600', '800×600']] },
        { key: 'w', label: 'Largura (px)', type: 'number', min: 1, max: 12000, value: doc.w },
        { key: 'h', label: 'Altura (px)', type: 'number', min: 1, max: 12000, value: doc.h },
        { key: 'bg', label: 'Fundo', type: 'select', value: 'white', options: [['white', 'Branco'], ['transparent', 'Transparente'], ['secondary', 'Cor secundária']] },
      ],
      onInput: (v, set, k) => { if (k === 'preset' && v.preset) { const [w, h] = v.preset.split('x'); set('w', w); set('h', h); } },
      onOk: v => { layerCount = 1; createDoc(Math.min(12000, Math.max(1, v.w | 0)), Math.min(12000, Math.max(1, v.h | 0)), v.bg === 'white' ? '#ffffff' : v.bg === 'secondary' ? bg() : 'transparent'); },
    }),
    open: () => $('#fileOpen').click(),
    openLayer: () => $('#fileLayer').click(),
    openProject: () => $('#fileProject').click(),
    saveProject,
    exportPNG: () => exportAs('image/png', 'png'),
    exportJPG: () => exportAs('image/jpeg', 'jpg'),
    exportWEBP: () => exportAs('image/webp', 'webp'),

    undo: () => goHistory(history.index - 1),
    redo: () => goHistory(history.index + 1),
    selectAll: () => { sel = { type: 'rect', x: 0, y: 0, w: doc.w, h: doc.h }; drawOverlay(); },
    deselect: () => { sel = null; drawOverlay(); },
    refineSel: () => {
      if (!sel) return status('Faça uma seleção primeiro');
      const base = sel, baseCv = selMaskCanvas();
      let timer;
      const apply = v => { const r = refineMask(baseCv, v.smooth, v.grow); sel = r || base; drawOverlay(); };
      openDialog({
        title: 'Refinar seleção', preview: true,
        fields: [
          { key: 'smooth', label: 'Suavizar (px)', type: 'range', min: 0, max: 40, step: 0.5, value: 0 },
          { key: 'grow', label: 'Expandir (+) / contrair (−)', type: 'range', min: -60, max: 60, step: 1, value: 0 },
        ],
        onInput: v => { clearTimeout(timer); timer = setTimeout(() => apply(v), 30); },
        onOk: v => { clearTimeout(timer); apply(v); status(sel ? 'Seleção: ' + sel.w + ' × ' + sel.h + ' px' : 'A seleção ficou vazia'); },
        onCancel: () => { clearTimeout(timer); sel = base; drawOverlay(); },
      });
    },
    invertSel: () => {
      const c = newCanvas(doc.w, doc.h), x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, doc.w, doc.h);
      if (sel) { x.globalCompositeOperation = 'destination-out'; x.drawImage(selMaskCanvas(), 0, 0); }
      sel = maskSel(c); drawOverlay();
    },
    clear: () => {
      if (!sel) return status('Faça uma seleção primeiro');
      if (!layerEditable()) return;
      const L = active();
      if (editingMask()) { const cov = selCoverage(); maskWrite(L.mask, cov, 1, cov, lum(bg())); }
      else eraseSel(ctxOf(L.canvas));
      touch(L); pushHistory('Limpar'); render();
    },
    fill: () => {
      if (!layerEditable()) return;
      const L = active();
      if (editingMask()) { const cov = selCoverage(); maskWrite(L.mask, cov, 1, cov, lum(fg())); }
      else withSel(ctxOf(L.canvas), x => { x.fillStyle = fg(); x.fillRect(0, 0, doc.w, doc.h); });
      touch(L); pushHistory('Preencher'); render();
    },
    copy: () => {
      const r = selBounds() || { x: 0, y: 0, w: doc.w, h: doc.h };
      const full = newCanvas(doc.w, doc.h);
      withSel(full.getContext('2d'), x => x.drawImage(active().canvas, 0, 0));
      const c = newCanvas(r.w, r.h);
      c.getContext('2d').drawImage(full, -r.x, -r.y);
      c.toBlob(async b => {
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); status('Copiado para a área de transferência'); }
        catch { status('O navegador bloqueou a cópia'); }
      });
    },

    imageSize: () => {
      const ratio = doc.h / doc.w;
      openDialog({
        title: 'Tamanho da imagem',
        fields: [
          { key: 'w', label: 'Largura (px)', type: 'number', min: 1, max: 12000, value: doc.w },
          { key: 'h', label: 'Altura (px)', type: 'number', min: 1, max: 12000, value: doc.h },
          { key: 'lock', label: 'Manter proporção', type: 'checkbox', value: true },
        ],
        onInput: (v, set, k) => {
          if (!v.lock) return;
          if (k === 'w' && v.w > 0) set('h', Math.max(1, Math.round(v.w * ratio)));
          if (k === 'h' && v.h > 0) set('w', Math.max(1, Math.round(v.h / ratio)));
        },
        onOk: v => {
          const nw = Math.min(12000, Math.max(1, v.w | 0)), nh = Math.min(12000, Math.max(1, v.h | 0));
          transformAll(nw, nh, 'Tamanho da imagem', (c, src) => c.drawImage(src, 0, 0, nw, nh));
        },
      });
    },
    canvasSize: () => openDialog({
      title: 'Tamanho da tela',
      fields: [
        { key: 'w', label: 'Largura (px)', type: 'number', min: 1, max: 12000, value: doc.w },
        { key: 'h', label: 'Altura (px)', type: 'number', min: 1, max: 12000, value: doc.h },
        { key: 'anchor', label: 'Âncora', type: 'select', value: '1,1', options: [['0,0', 'Superior esquerda'], ['1,0', 'Superior centro'], ['2,0', 'Superior direita'], ['0,1', 'Centro esquerda'], ['1,1', 'Centro'], ['2,1', 'Centro direita'], ['0,2', 'Inferior esquerda'], ['1,2', 'Inferior centro'], ['2,2', 'Inferior direita']] },
      ],
      onOk: v => {
        const nw = Math.min(12000, Math.max(1, v.w | 0)), nh = Math.min(12000, Math.max(1, v.h | 0));
        const [ax, ay] = v.anchor.split(',').map(Number);
        const ox = Math.round((nw - doc.w) * ax / 2), oy = Math.round((nh - doc.h) * ay / 2);
        transformAll(nw, nh, 'Tamanho da tela', (c, src) => c.drawImage(src, ox, oy));
      },
    }),
    crop: () => {
      const r = selBounds();
      if (!r) return status('Faça uma seleção para cortar');
      transformAll(r.w, r.h, 'Cortar', (c, src) => c.drawImage(src, -r.x, -r.y));
    },
    rotCW: () => rotate(90), rotCCW: () => rotate(-90), rot180: () => rotate(180),
    flipH: () => flip(true), flipV: () => flip(false),

    newLayer: () => { insertLayer(makeLayer(`Camada ${layerCount++}`)); pushHistory('Nova camada'); render(); },
    dupLayer: () => {
      const L = active();
      if (L.group) { // duplica o grupo inteiro
        const block = blockOf(L), map = new Map();
        const copies = block.map(o => {
          const N = makeLayer(o === L ? o.name + ' cópia' : o.name, o.group ? newCanvas(1, 1) : cloneCanvas(o.canvas));
          Object.assign(N, { opacity: o.opacity, blend: o.blend, visible: o.visible, fx: o.fx || null, adj: o.adj || null, text: o.text || null, shape: o.shape || null, mask: o.mask ? cloneCanvas(o.mask) : null, maskOn: o.maskOn, maskEdit: false, group: !!o.group, collapsed: !!o.collapsed, clip: !!o.clip, lockAlpha: !!o.lockAlpha, lockPixels: !!o.lockPixels, lockPos: !!o.lockPos });
          map.set(o.id, N); return N;
        });
        copies.forEach((N, k) => { const o = block[k]; N.pid = o === L ? pidOf(L) : map.get(o.pid).id; });
        doc.layers.splice(doc.layers.indexOf(L) + 1, 0, ...copies);
        normalizeGroups(); doc.active = doc.layers.indexOf(map.get(L.id));
        pushHistory('Duplicar grupo'); render(); return;
      }
      const r = L.adj ? null : selBounds(); // ajuste: duplica a camada inteira
      const N = makeLayer(r ? `${L.name} (cópia da seleção)` : `${L.name} cópia`);
      const c = ctxOf(N.canvas);
      withSel(c, x => x.drawImage(L.canvas, 0, 0));
      if (!r) Object.assign(N, { opacity: L.opacity, blend: L.blend, visible: L.visible, fx: L.fx || null, adj: L.adj || null, text: L.text || null, shape: L.shape || null, clip: !!L.clip, lockAlpha: !!L.lockAlpha, lockPixels: !!L.lockPixels, lockPos: !!L.lockPos, mask: L.mask ? cloneCanvas(L.mask) : null, maskOn: L.maskOn, maskEdit: L.maskEdit });
      insertLayer(N); pushHistory(r ? 'Camada via cópia' : 'Duplicar camada'); render();
    },
    delLayer: () => {
      const A = active();
      if (A.group) { // exclui o grupo e tudo o que está dentro
        const block = blockOf(A);
        if (doc.layers.length - block.length < 1) return status('O documento precisa de ao menos uma camada');
        const lo = doc.layers.indexOf(block[0]);
        doc.layers = doc.layers.filter(l => !block.includes(l));
        doc.active = Math.max(0, Math.min(lo, doc.layers.length - 1));
        normalizeGroups(); pushHistory('Excluir grupo'); render(); return;
      }
      if (doc.layers.length <= 1) return status('O documento precisa de ao menos uma camada');
      doc.layers.splice(doc.active, 1);
      doc.active = Math.max(0, doc.active - 1);
      pushHistory('Excluir camada'); render();
    },
    mergeDown: () => {
      if (active().group) return commands.mergeGroup();
      if (doc.active === 0) return status('Não há camada abaixo');
      const L = active(), B = doc.layers[doc.active - 1];
      if (B.group || pidOf(B) !== pidOf(L)) return status('Não dá para mesclar entre grupos diferentes');
      if (B.lockPixels) return status('A camada de baixo está com os pixels bloqueados');
      if (B.adj) return status('Não dá para mesclar numa camada de ajuste');
      // a camada de baixo vira pixels finais (máscara e estilo aplicados) antes de receber a de cima
      if (B.mask || hasFx(B)) { const baked = B.visible ? cloneCanvas(layerRender(B)) : newCanvas(doc.w, doc.h); Object.assign(B, { canvas: baked, mask: null, maskEdit: false, fx: null, visible: true }); }
      const c = ctxOf(B.canvas);
      if (L.adj) {
        // mesclar um ajuste = aplicar o ajuste só nos pixels da camada de baixo (respeitando máscara e opacidade)
        if (L.visible) {
          const img = c.getImageData(0, 0, doc.w, doc.h); Filters[L.adj.name](img, L.adj.vals || {});
          const t = newCanvas(doc.w, doc.h), tc = t.getContext('2d'); tc.putImageData(img, 0, 0);
          if (L.mask && L.maskOn) { tc.globalCompositeOperation = 'destination-in'; tc.drawImage(L.mask, 0, 0); }
          c.save(); c.globalAlpha = L.opacity; c.globalCompositeOperation = L.blend === 'source-over' ? 'source-atop' : L.blend; c.drawImage(t, 0, 0); c.restore();
        }
      } else if (L.visible) {
        let src = layerRender(L);
        if (L.clip) { // recortada: só vale onde a base tem pixels
          const t = newCanvas(doc.w, doc.h), tc = t.getContext('2d');
          tc.drawImage(src, 0, 0); tc.globalCompositeOperation = 'destination-in'; tc.drawImage(B.canvas, 0, 0); src = t;
        }
        c.save(); c.globalAlpha = L.opacity; c.globalCompositeOperation = L.blend; c.drawImage(src, 0, 0); c.restore();
      }
      touch(B); B.text = null; B.shape = null;
      doc.layers.splice(doc.active, 1); doc.active--;
      pushHistory('Mesclar abaixo'); render();
    },
    layerStyle: () => {
      if (active().group) return status('Grupos não têm estilo de camada');
      if (active().adj) return editAdj(active(), false);
      const L = active(), before = L.fx || null;
      const cur = Object.fromEntries(Object.keys(FX_DEFAULTS).map(k => [k, { ...FX_DEFAULTS[k], ...(before && before[k]) }]));
      const fields = [];
      for (const [id, label, params] of FX_FIELDS) {
        fields.push({ type: 'section', key: `${id}.on`, label, value: cur[id].on });
        for (const [p, pl, a, b] of params) {
          const value = cur[id][p];
          if (a === 'color') fields.push({ key: `${id}.${p}`, label: pl, type: 'color', value });
          else if (Array.isArray(a)) fields.push({ key: `${id}.${p}`, label: pl, type: 'select', value, options: a });
          else fields.push({ key: `${id}.${p}`, label: pl, type: 'range', min: a, max: b, value });
        }
      }
      const toFx = v => {
        const fx = {};
        for (const k of Object.keys(FX_DEFAULTS)) fx[k] = { ...FX_DEFAULTS[k] };
        for (const [key, val] of Object.entries(v)) { const [id, p] = key.split('.'); fx[id][p] = val; }
        return fx;
      };
      let timer;
      openDialog({
        title: `Estilo de camada — ${L.name}`, fields, preview: true,
        onInput: (v, set, key) => {
          // mexer num parâmetro liga o efeito automaticamente
          if (key && !key.endsWith('.on')) { const on = key.split('.')[0] + '.on'; if (!v[on]) { set(on, true); v[on] = true; } }
          clearTimeout(timer);
          timer = setTimeout(() => { L.fx = toFx(v); render(); }, 25);
        },
        onOk: v => { clearTimeout(timer); const fx = toFx(v); L.fx = Object.values(fx).some(e => e.on) ? fx : null; pushHistory('Estilo de camada'); render(); },
        onCancel: () => { clearTimeout(timer); L.fx = before; render(); },
      });
    },
    addMask: () => {
      const L = active();
      if (L.group) return status('Grupos não têm máscara');
      if (L.mask) return status('A camada já tem máscara');
      if (sel) { const m = newMask(false); withSel(m.getContext('2d'), x => { x.fillStyle = '#fff'; x.fillRect(0, 0, doc.w, doc.h); }); L.mask = m; sel = null; drawOverlay(); }
      else L.mask = newMask(true);
      Object.assign(L, { maskOn: true, maskEdit: true });
      touch(L); pushHistory('Adicionar máscara'); render();
    },
    addMaskHide: () => {
      const L = active();
      if (L.mask) return status('A camada já tem máscara');
      Object.assign(L, { mask: newMask(false), maskOn: true, maskEdit: true });
      touch(L); pushHistory('Adicionar máscara (ocultar tudo)'); render();
    },
    deleteMask: () => {
      const L = active();
      if (L.adj) return status('A camada de ajuste precisa da máscara');
      if (!L.mask) return status('A camada não tem máscara');
      Object.assign(L, { mask: null, maskEdit: false });
      touch(L); pushHistory('Excluir máscara'); render();
    },
    applyMask: () => {
      const L = active();
      if (L.adj) return status('A camada de ajuste precisa da máscara');
      if (!L.mask) return status('A camada não tem máscara');
      if (L.maskOn) { const c = ctxOf(L.canvas); c.save(); c.globalCompositeOperation = 'destination-in'; c.drawImage(L.mask, 0, 0); c.restore(); }
      Object.assign(L, { mask: null, maskEdit: false });
      touch(L); pushHistory('Aplicar máscara'); render();
    },
    toggleMask: () => {
      const L = active();
      if (!L.mask) return status('A camada não tem máscara');
      L.maskOn = !L.maskOn;
      touch(L); pushHistory(L.maskOn ? 'Ativar máscara' : 'Desativar máscara'); render();
    },
    maskToSel: () => {
      const L = active();
      if (!L.mask) return status('A camada não tem máscara');
      sel = maskSel(L.mask); drawOverlay();
    },
    editMask: () => { const L = active(); if (!L.mask) return commands.addMask(); L.maskEdit = true; refreshPanels(); },
    editContent: () => { if (active().adj) return status('Camada de ajuste: só a máscara é editável'); active().maskEdit = false; refreshPanels(); },
    cropTool: () => setTool('crop'),
    editText: () => editTextLayer(active()),
    lockAll: () => toggleLock('all'),
    editShape: () => editShapeLayer(active()),
    freeTransform: () => startTransform(),
    newAdjPick: () => openDialog({
      title: 'Nova camada de ajuste', okLabel: 'Criar',
      fields: [{ key: 'type', label: 'Ajuste', type: 'select', value: 'curves', options: ADJ_LAYER_TYPES }],
      onOk: v => newAdjLayer(v.type),
    }),
    editAdjLayer: () => { const L = active(); if (!L.adj) return status('A camada ativa não é de ajuste'); editAdj(L, false); },
    clearStyle: () => {
      const L = active();
      if (!hasFx(L)) return status('A camada não tem estilo');
      L.fx = null; pushHistory('Limpar estilo de camada'); render();
    },
    copyStyle: () => { if (!hasFx(active())) return status('A camada não tem estilo'); fxClipboard = active().fx; status('Estilo copiado'); },
    pasteStyle: () => { if (!fxClipboard) return status('Nenhum estilo copiado'); active().fx = fxClipboard; pushHistory('Colar estilo de camada'); render(); },
    flatten: () => {
      const flat = flattenCanvas('#ffffff');
      const L = makeLayer('Fundo', flat);
      doc.layers = [L]; doc.active = 0;
      pushHistory('Achatar imagem'); render();
    },
    layerUp: () => {
      const A = active(), block = blockOf(A), top = Math.max(...block.map(l => doc.layers.indexOf(l))), above = doc.layers[top + 1];
      if (!above) return;
      const parent = groupById(pidOf(A));
      if (above === parent) placeBlock(block, parent, true); // era o topo do grupo: sai dele
      else { let S = above; while (S && pidOf(S) !== pidOf(A)) S = groupById(pidOf(S)); if (!S) return; placeBlock(block, S, true); }
      doc.active = doc.layers.indexOf(A); pushHistory('Reordenar camada'); render();
    },
    layerDown: () => {
      const A = active(), block = blockOf(A), low = Math.min(...block.map(l => doc.layers.indexOf(l))), below = doc.layers[low - 1];
      if (!below) return;
      let S = below; while (S && pidOf(S) !== pidOf(A)) S = groupById(pidOf(S));
      if (S) placeBlock(block, S, false);
      else { const parent = groupById(pidOf(A)); if (!parent) return; placeBlock(block, parent, false); } // era o fundo do grupo: sai dele
      doc.active = doc.layers.indexOf(A); pushHistory('Reordenar camada'); render();
    },
    clipMask: () => {
      const L = active();
      if (L.group) return status('Grupos não podem ser recortados');
      if (L.clip) { L.clip = false; pushHistory('Soltar máscara de recorte'); render(); return; }
      L.clip = true;
      if (clipBase(doc.active) < 0) { L.clip = false; return status('Precisa de uma camada comum logo abaixo, no mesmo grupo, para recortar'); }
      pushHistory('Criar máscara de recorte'); render();
    },
    groupLayers: () => {
      commitText();
      const sels = selectedLayers();
      if (sels.some(l => pidOf(l) !== pidOf(sels[0]))) return status('Selecione camadas do mesmo nível para agrupar');
      const G = makeLayer('Grupo ' + groupCount++, newCanvas(1, 1)); G.group = true; G.pid = pidOf(sels[0]);
      const top = Math.max(...sels.map(l => doc.layers.indexOf(l)));
      doc.layers.splice(top + 1, 0, G);
      for (const l of sels) l.pid = G.id;
      multi.clear(); normalizeGroups(); doc.active = doc.layers.indexOf(G);
      pushHistory('Agrupar camadas'); render();
    },
    ungroup: () => {
      const G = active();
      if (!G.group) return status('Selecione um grupo');
      for (const l of doc.layers) if (pidOf(l) === G.id) l.pid = pidOf(G);
      const i = doc.layers.indexOf(G); doc.layers.splice(i, 1);
      doc.active = Math.max(0, Math.min(i - 1, doc.layers.length - 1));
      normalizeGroups(); pushHistory('Desagrupar'); render();
    },
    mergeGroup: () => {
      const G = active();
      if (!G.group) return status('Selecione um grupo');
      const block = blockOf(G), saved = doc.layers, pos = Math.min(...block.map(l => saved.indexOf(l)));
      // compõe só o grupo (com opacidade e visibilidade dele) numa camada nova
      doc.layers = block; const savedActive = doc.active; doc.active = -1;
      const cv = newCanvas(doc.w, doc.h); composite(cv.getContext('2d'), false, true);
      doc.layers = saved; doc.active = savedActive;
      const N = makeLayer(G.name, cv); N.pid = pidOf(G);
      doc.layers = saved.filter(l => !block.includes(l)); doc.layers.splice(pos, 0, N);
      doc.active = pos; normalizeGroups(); pushHistory('Mesclar grupo'); render();
    },

    zoomIn: () => zoomAt(view.zoom * 1.25), zoomOut: () => zoomAt(view.zoom * 0.8),
    fit: () => fitView(false),
    actual: () => { const r = ws.getBoundingClientRect(); zoomAt(1, r.width / 2, r.height / 2); },
  };
  function run(cmd) {
    if (xf) {
      // durante a transformação: desfazer cancela; zoom continua; o resto confirma antes
      if (cmd === 'undo') return cancelTransform();
      if (cmd === 'freeTransform') return;
      if (!['zoomIn', 'zoomOut', 'fit', 'actual'].includes(cmd)) applyTransform();
    }
    if (cmd.startsWith('adj:')) return runAdjust(cmd.slice(4));
    if (cmd.startsWith('fx:')) return runInstant(cmd.slice(3));
    if (cmd.startsWith('newAdj:')) return newAdjLayer(cmd.slice(7));
    commands[cmd] && commands[cmd]();
  }

  // ---------- painéis
  const blendSel = $('#blendMode'), opSlider = $('#layerOpacity');
  for (const [v, t] of BLENDS) { const o = document.createElement('option'); o.value = v; o.textContent = t; blendSel.appendChild(o); }
  blendSel.addEventListener('change', () => { active().blend = blendSel.value; pushHistory('Modo de mesclagem'); render(); });
  opSlider.addEventListener('input', () => { active().opacity = opSlider.value / 100; $('#layerOpacityVal').textContent = opSlider.value + '%'; requestRender(); });
  opSlider.addEventListener('change', () => pushHistory('Opacidade da camada'));

  let dragIndex = null, lastPick = null;
  function drawFolderIcon(c) {
    c.fillStyle = '#3a3d43'; c.fillRect(0, 0, 80, 64);
    c.fillStyle = '#d9a63a'; c.beginPath(); c.roundRect(14, 14, 24, 10, 3); c.fill();
    c.fillStyle = '#f4c95d'; c.beginPath(); c.roundRect(14, 20, 52, 32, 4); c.fill();
  }
  function renderLayers() {
    const list = $('#layerList'); list.innerHTML = '';
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const L = doc.layers[i];
      if (hiddenByCollapse(L)) continue;
      const li = document.createElement('li');
      li.className = (i === doc.active ? 'active' : '') + (L.group ? ' group' : '') + (multi.has(L.id) ? ' multi' : '');
      const isClip = L.clip && clipBase(i) >= 0;
      if (isClip) li.className += ' clipped';
      li.style.paddingLeft = (8 + depthOf(L) * 16 + (isClip ? 14 : 0)) + 'px';
      if (isClip) { const m = document.createElement('span'); m.className = 'clipmark'; m.textContent = '↳'; m.title = 'Recortada pela camada de baixo'; li.appendChild(m); }
      li.draggable = true;
      if (L.group) {
        const f = document.createElement('button'); f.className = 'fold'; f.textContent = L.collapsed ? '▸' : '▾'; f.title = 'Recolher / expandir';
        f.onclick = e => { e.stopPropagation(); L.collapsed = !L.collapsed; renderLayers(); };
        li.appendChild(f);
      }
      const eye = document.createElement('button');
      eye.className = 'eye' + (L.visible ? '' : ' off'); eye.textContent = '👁'; eye.title = 'Visibilidade';
      eye.onclick = e => { e.stopPropagation(); L.visible = !L.visible; pushHistory(L.visible ? 'Mostrar camada' : 'Ocultar camada'); render(); };
      const th = newCanvas(80, 64), tc = th.getContext('2d'), k = Math.min(80 / doc.w, 64 / doc.h);
      if (L.group) {
        th.className = 'adj-thumb'; drawFolderIcon(tc);
      } else if (L.adj) {
        // ícone da camada de ajuste (meio círculo claro/escuro)
        th.className = 'adj-thumb';
        tc.fillStyle = '#3a3d43'; tc.fillRect(0, 0, 80, 64);
        tc.beginPath(); tc.arc(40, 32, 18, 0, Math.PI * 2); tc.fillStyle = '#111'; tc.fill();
        tc.beginPath(); tc.arc(40, 32, 18, -Math.PI / 2, Math.PI / 2, true); tc.fillStyle = '#f5f5f5'; tc.fill();
        tc.beginPath(); tc.arc(40, 32, 18, 0, Math.PI * 2); tc.strokeStyle = '#ddd'; tc.lineWidth = 2; tc.stroke();
      } else tc.drawImage(L.canvas, (80 - doc.w * k) / 2, (64 - doc.h * k) / 2, doc.w * k, doc.h * k);
      const name = document.createElement('span'); name.className = 'name'; name.textContent = L.name;
      name.ondblclick = e => {
        e.stopPropagation();
        name.contentEditable = 'true'; name.focus(); document.getSelection().selectAllChildren(name);
        const done = save => { name.contentEditable = 'false'; const v = name.textContent.trim(); if (save && v && v !== L.name) { L.name = v; pushHistory('Renomear camada'); } else name.textContent = L.name; };
        name.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); name.onblur = null; done(true); } if (ev.key === 'Escape') { name.onblur = null; done(false); } };
        name.onblur = () => done(true);
      };
      const meta = document.createElement('span'); meta.className = 'meta';
      meta.textContent = (L.lockAlpha && L.lockPixels && L.lockPos ? '🔒 ' : L.lockAlpha || L.lockPixels || L.lockPos ? '◪ ' : '') + (hasFx(L) ? 'fx ' : '') + (L.opacity < 1 ? Math.round(L.opacity * 100) + '%' : '');
      meta.title = hasFx(L) ? 'Clique duas vezes na miniatura para editar o estilo' : '';
      th.title = L.group ? 'Grupo · duplo clique: recolher/expandir' : 'Conteúdo da camada · duplo clique: estilos de camada';
      th.ondblclick = e => { e.stopPropagation(); if (L.group) { L.collapsed = !L.collapsed; renderLayers(); } else L.adj ? editAdj(L, false) : L.text ? editTextLayer(L) : L.shape ? editShapeLayer(L) : run('layerStyle'); };
      li.append(eye, th);
      let mt = null;
      if (L.mask) {
        mt = newCanvas(80, 64); const mc = mt.getContext('2d');
        mc.fillStyle = '#000'; mc.fillRect(0, 0, 80, 64);
        mc.drawImage(L.mask, (80 - doc.w * k) / 2, (64 - doc.h * k) / 2, doc.w * k, doc.h * k);
        mt.className = 'mask-thumb' + (L.maskOn ? '' : ' off');
        mt.title = 'Máscara · clique: editar máscara · Shift+clique: ativar/desativar';
        th.classList.toggle('target', i === doc.active && !L.maskEdit);
        mt.classList.toggle('target', i === doc.active && L.maskEdit);
        th.onclick = e => { if (L.maskEdit && !L.adj) { e.stopPropagation(); L.maskEdit = false; doc.active = i; refreshPanels(); } };
        mt.onclick = e => {
          e.stopPropagation(); doc.active = i;
          if (e.shiftKey) return run('toggleMask');
          L.maskEdit = true; refreshPanels();
        };
        li.appendChild(mt);
      }
      li.append(name, meta);
      li.onclick = e => {
        if (xf) applyTransform();
        if (e.altKey) { doc.active = i; run('clipMask'); return; } // Alt+clique: cria/solta a máscara de recorte
        if (e.ctrlKey || e.metaKey) { // Ctrl+clique: soma/tira da seleção múltipla
          if (!multi.size) multi.add(doc.layers[doc.active].id);
          if (multi.has(L.id)) multi.delete(L.id); else multi.add(L.id);
          doc.active = i; lastPick = i; renderLayers(); return;
        }
        if (e.shiftKey) { // Shift+clique: intervalo a partir do último clique
          const a = lastPick ?? doc.active; multi.clear();
          for (let q = Math.min(a, i); q <= Math.max(a, i); q++) if (!hiddenByCollapse(doc.layers[q])) multi.add(doc.layers[q].id);
          doc.active = i; renderLayers(); return;
        }
        lastPick = i;
        const hadMulti = multi.size > 0; multi.clear();
        if (doc.active === i && !hadMulti) return;
        doc.active = i;
        if (hadMulti) return renderLayers();
        list.querySelectorAll('li').forEach(x => x.classList.toggle('active', x === li));
        list.querySelectorAll('.target').forEach(x => x.classList.remove('target'));
        if (mt) (L.maskEdit ? mt : th).classList.add('target');
        syncLayerProps();
      };
      li.ondragstart = () => { dragIndex = i; li.classList.add('dragging'); };
      li.ondragend = () => li.classList.remove('dragging');
      li.ondragover = e => e.preventDefault();
      li.ondrop = e => {
        e.preventDefault(); e.stopPropagation();
        if (dragIndex === null || dragIndex === i) return;
        const D = doc.layers[dragIndex], block = blockOf(D);
        dragIndex = null;
        if (block.includes(L)) return; // não dá para soltar um grupo dentro dele mesmo
        if (L.group) placeInto(block, L); else placeBlock(block, L, true); // sobre um grupo: entra nele; sobre uma camada: fica acima dela
        doc.active = doc.layers.indexOf(D);
        pushHistory('Reordenar camada'); render();
      };
      list.appendChild(li);
    }
    syncLayerProps();
  }
  function syncLayerProps() {
    const A = active();
    $('#stTarget').textContent = editingMask() ? `Editando a máscara de “${A.name}” (pinte com preto/branco)` : '';
    blendSel.value = A.blend;
    opSlider.value = Math.round(A.opacity * 100);
    $('#layerOpacityVal').textContent = opSlider.value + '%';
    document.querySelectorAll('#layerLocks [data-lock]').forEach(b => {
      const k = b.dataset.lock;
      b.classList.toggle('on', k === 'all' ? !!(A.lockAlpha && A.lockPixels && A.lockPos) : !!A['lock' + k[0].toUpperCase() + k.slice(1)]);
    });
  }
  // liga/desliga um bloqueio nas camadas selecionadas
  function toggleLock(kind) {
    const ls = selectedLayers(), flags = kind === 'all' ? ['lockAlpha', 'lockPixels', 'lockPos'] : ['lock' + kind[0].toUpperCase() + kind.slice(1)];
    const on = !ls.every(l => flags.every(f => l[f]));
    for (const l of ls) for (const f of flags) l[f] = on;
    pushHistory(on ? 'Bloquear camada' : 'Desbloquear camada'); render();
    status(on ? 'Camada bloqueada' : 'Camada desbloqueada');
  }
  document.querySelectorAll('#layerLocks [data-lock]').forEach(b => b.addEventListener('click', () => toggleLock(b.dataset.lock)));
  function renderHistory() {
    const list = $('#historyList'); list.innerHTML = '';
    history.states.forEach((s, i) => {
      const li = document.createElement('li');
      li.textContent = s.label;
      li.className = i === history.index ? 'current' : i > history.index ? 'future' : '';
      li.onclick = () => goHistory(i);
      list.appendChild(li);
    });
    const cur = list.querySelector('.current'); cur && cur.scrollIntoView({ block: 'nearest' });
  }
  function refreshPanels() { renderLayers(); renderHistory(); }

  // ---------- barra de opções
  const SEL_MODES = [['new', 'Nova seleção'], ['add', 'Adicionar (Shift)'], ['sub', 'Subtrair (Alt)'], ['int', 'Interseção (Shift+Alt)']];
  function buildOptions() {
    const bar = $('#optionsbar'); bar.innerHTML = '';
    const nameEl = document.createElement('span'); nameEl.className = 'tool-name'; nameEl.textContent = xf ? 'Transformação livre' : TOOL_NAMES[tool];
    bar.appendChild(nameEl);
    const o = opts[tool];
    const range = (label, key, min, max, unit = '') => {
      const l = document.createElement('label'); l.textContent = label;
      const i = document.createElement('input'); i.type = 'range'; i.min = min; i.max = max; i.value = o[key];
      const v = document.createElement('span'); v.textContent = o[key] + unit; v.style.minWidth = '42px';
      i.oninput = () => { o[key] = +i.value; v.textContent = i.value + unit; drawOverlay(); };
      l.append(i, v); bar.appendChild(l);
    };
    const select = (label, key, options, onChange) => {
      const l = document.createElement('label'); l.textContent = label;
      const s = document.createElement('select');
      for (const [v, t] of options) { const op = document.createElement('option'); op.value = v; op.textContent = t; s.appendChild(op); }
      s.value = o[key]; s.onchange = () => { o[key] = s.value; onChange && onChange(); };
      l.appendChild(s); bar.appendChild(l);
    };
    const check = (label, key, onChange) => {
      const l = document.createElement('label');
      const i = document.createElement('input'); i.type = 'checkbox'; i.checked = o[key];
      i.onchange = () => { o[key] = i.checked; onChange && onChange(); };
      l.append(i, label); bar.appendChild(l);
    };
    const hint = t => { const s = document.createElement('span'); s.style.color = 'var(--muted)'; s.textContent = t; bar.appendChild(s); };
    const button = (t, fn) => { const b = document.createElement('button'); b.textContent = t; b.onclick = fn; b.style.cssText = 'background:var(--panel-2);border:1px solid var(--border);border-radius:4px;padding:3px 10px'; bar.appendChild(b); };
    if (xf) {
      // barra da transformação: valores numéricos, espelhar, aplicar/cancelar
      const num = (label, get, set, unit, step = 1) => {
        const l = document.createElement('label'); l.textContent = label;
        const i = document.createElement('input'); i.type = 'number'; i.step = step; i.value = get();
        i.onchange = () => { const v = parseFloat(i.value); if (!isNaN(v)) { set(v); renderXf(false); drawOverlay(); buildOptions(); } };
        l.append(i, unit); bar.appendChild(l);
      };
      num('L', () => Math.round(xf.box.w / xf.src.w * 1000) / 10, v => { xf.box.w = Math.max(1, xf.src.w * v / 100); }, '%', 0.1);
      num('A', () => Math.round(xf.box.h / xf.src.h * 1000) / 10, v => { xf.box.h = Math.max(1, xf.src.h * v / 100); }, '%', 0.1);
      num('Ângulo', () => Math.round(xf.box.angle * 1800 / Math.PI) / 10, v => { xf.box.angle = v * Math.PI / 180; }, '°', 0.1);
      button('⇋ Espelhar H', () => { xf.fx *= -1; renderXf(false); });
      button('⇵ Espelhar V', () => { xf.fy *= -1; renderXf(false); });
      button('✓ Aplicar', applyTransform); button('✕ Cancelar', cancelTransform);
      hint('Cantos mantêm a proporção (Shift solta) · Alt = a partir do centro · fora da caixa gira · setas movem');
      return;
    }
    switch (tool) {
      case 'brush': case 'eraser':
        range('Tamanho', 'size', 1, 500, 'px'); range('Opacidade', 'opacity', 1, 100, '%'); range('Dureza', 'hardness', 0, 100, '%');
        hint('[ ] muda o tamanho · Shift+clique traça linha reta');
        break;
      case 'spot':
        range('Tamanho', 'size', 1, 300, 'px'); range('Opacidade', 'opacity', 1, 100, '%'); range('Dureza', 'hardness', 0, 100, '%');
        select('Amostra', 'sampleAll', [['', 'Camada atual'], ['1', 'Todas as camadas']]);
        hint('Pinte sobre a mancha (um pouco maior que ela) · ao soltar, a origem é escolhida sozinha');
        break;
      case 'clone': case 'heal':
        range('Tamanho', 'size', 1, 500, 'px'); range('Opacidade', 'opacity', 1, 100, '%'); range('Dureza', 'hardness', 0, 100, '%');
        check('Alinhado', 'aligned', () => { cloneState.offset = null; drawOverlay(); });
        select('Amostra', 'sampleAll', [['', 'Camada atual'], ['1', 'Todas as camadas']]);
        hint((cloneState.src ? 'Alt+clique muda a origem' : 'Alt+clique para escolher a origem, depois pinte')
          + (tool === 'heal' ? ' · ao soltar, a textura se ajusta à cor e luz do destino' : ''));
        break;
      case 'bucket':
        range('Tolerância', 'tolerance', 0, 255); range('Opacidade', 'opacity', 1, 100, '%'); check('Contíguo', 'contiguous');
        break;
      case 'gradient':
        select('Tipo', 'type', [['linear', 'Linear'], ['radial', 'Radial']]); range('Opacidade', 'opacity', 1, 100, '%');
        hint('Arraste para aplicar · cor principal → secundária');
        break;
      case 'marquee':
        select('Forma', 'shape', [['rect', 'Retangular'], ['ellipse', 'Elíptica']]);
        select('Modo', 'mode', SEL_MODES);
        hint('Shift+arrastar adiciona · Alt subtrai · Ctrl+D desmarca · Ctrl+J camada via cópia');
        break;
      case 'shape':
        select('Forma', 'kind', [['rect', 'Retângulo'], ['ellipse', 'Elipse'], ['poly', 'Polígono'], ['star', 'Estrela'], ['line', 'Linha']], () => buildOptions());
        if (o.kind === 'rect') range('Canto', 'radius', 0, 300, 'px');
        if (o.kind === 'poly' || o.kind === 'star') range('Lados', 'sides', 3, 16);
        if (o.kind !== 'line') check('Preencher (cor principal)', 'fillOn');
        check('Contorno (cor secundária)', 'strokeOn'); range('Espessura', 'strokeW', 1, 60, 'px');
        hint('Arraste para desenhar · Shift = proporção / 45° · Alt = a partir do centro · clique numa forma para editar');
        break;
      case 'quick':
        range('Tamanho', 'size', 3, 300, 'px'); range('Sensibilidade', 'tolerance', 5, 120);
        select('Modo', 'mode', [['add', 'Adicionar'], ['new', 'Nova seleção'], ['sub', 'Subtrair (Alt)']]);
        check('Todas as camadas', 'allLayers');
        hint('Pinte dentro do objeto: a seleção cresce até as bordas · Alt subtrai · [ ] muda o tamanho');
        break;
      case 'lasso':
        select('Tipo', 'type', [['free', 'Mão livre'], ['poly', 'Poligonal']], () => { lasso = null; drawOverlay(); buildOptions(); });
        select('Modo', 'mode', SEL_MODES);
        hint(o.type === 'poly' ? 'Clique para cada vértice · clique no 1º ponto, duplo clique ou Enter fecha · Backspace volta um · Esc cancela' : 'Arraste contornando a área · solte para fechar · Shift adiciona · Alt subtrai');
        break;
      case 'wand':
        select('Modo', 'mode', SEL_MODES);
        range('Tolerância', 'tolerance', 0, 255); check('Contíguo', 'contiguous'); check('Todas as camadas', 'allLayers');
        hint('Shift+clique adiciona · Alt+clique subtrai · Ctrl+Shift+I inverte');
        break;
      case 'text': {
        const restyle = () => textEdit && styleTextEditor();
        select('Fonte', 'font', ['Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Courier New', 'Impact', 'Comic Sans MS', 'system-ui'].map(f => [f, f]), restyle);
        const l = document.createElement('label'); l.textContent = 'Tamanho';
        const n = document.createElement('input'); n.type = 'number'; n.min = 4; n.max = 1000; n.value = o.size;
        n.oninput = () => { o.size = Math.max(4, +n.value || 4); restyle(); };
        l.appendChild(n); bar.appendChild(l);
        check('Negrito', 'bold', restyle);
        hint('Clique na imagem para digitar · Ctrl+Enter confirma · Esc cancela · clique num texto existente para editar');
        break;
      }
      case 'crop': {
        select('Proporção', 'ratio', CROP_RATIOS, () => { fitCropRatio(); drawOverlay(); });
        button('⇄ Girar caixa', () => { if (!crop) return; [crop.w, crop.h] = [crop.h, crop.w]; { const k = Math.min(1, doc.w / crop.w, doc.h / crop.h); crop.w *= k; crop.h *= k; crop.cx = Math.min(doc.w - crop.w / 2, Math.max(crop.w / 2, crop.cx)); crop.cy = Math.min(doc.h - crop.h / 2, Math.max(crop.h / 2, crop.cy)); } setCropBase(); fitRotated(); const r = opts.crop.ratio; if (r.includes(':')) { const [a, b] = r.split(':'); const sw = b + ':' + a; if (CROP_RATIOS.some(x => x[0] === sw)) opts.crop.ratio = sw; } buildOptions(); drawOverlay(); });
        const l = document.createElement('label'); l.textContent = 'Endireitar';
        const i = document.createElement('input'); i.type = 'range'; i.min = -45; i.max = 45; i.step = 0.1; i.value = crop ? (crop.angle * 180 / Math.PI).toFixed(1) : 0;
        const vv = document.createElement('span'); vv.style.minWidth = '42px'; vv.textContent = i.value + '°';
        i.oninput = () => { if (crop) { crop.angle = i.value * Math.PI / 180; fitRotated(); vv.textContent = i.value + '°'; drawOverlay(); } };
        l.append(i, vv); bar.appendChild(l);
        button('✓ Aplicar', applyCrop); button('✕ Cancelar', () => { initCrop(); buildOptions(); drawOverlay(); });
        hint('Enter aplica · Esc cancela · arraste fora da caixa para girar (Shift = 15°) · duplo clique aplica');
        break;
      }
      case 'move': button('⤡ Transformação livre (Ctrl+Alt+T)', () => run('freeTransform')); hint('Arraste para mover a camada ativa (ou só a área selecionada)'); break;
      case 'eyedropper': hint('Clique para pegar a cor principal · Alt+clique pega a secundária'); break;
      case 'hand': case 'zoom':
        button('Ajustar à tela', () => fitView(false)); button('100%', commands.actual);
        if (tool === 'zoom') hint('Clique aproxima · Alt+clique afasta · Ctrl+roda do mouse');
        break;
    }
  }

  // ---------- menus
  const closeMenus = () => document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('.menu > button').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const m = b.parentElement, was = m.classList.contains('open');
      closeMenus(); if (!was) m.classList.add('open');
    });
    b.addEventListener('mouseenter', () => {
      if (document.querySelector('.menu.open') && !b.parentElement.classList.contains('open')) { closeMenus(); b.parentElement.classList.add('open'); }
    });
  });
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-cmd]');
    if (c) { closeMenus(); run(c.dataset.cmd); return; }
    if (!e.target.closest('.menu')) closeMenus();
  });
  document.querySelectorAll('#toolbar [data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

  // ---------- teclado
  const TOOL_KEYS = { v: 'move', m: 'marquee', w: 'wand', l: 'lasso', s: 'clone', j: 'spot', b: 'brush', e: 'eraser', g: 'bucket', i: 'eyedropper', t: 'text', h: 'hand', z: 'zoom', c: 'crop', u: 'shape' };
  window.addEventListener('keydown', e => {
    if (!modal.hidden) { if (e.key === 'Escape') { e.preventDefault(); dlg && dlg.cancel(); } return; }
    if (e.target.matches && e.target.matches('input, textarea, select, [contenteditable="true"]')) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (xf) {
      if (k === 'enter') { e.preventDefault(); return applyTransform(); }
      if (k === 'escape') { e.preventDefault(); return cancelTransform(); }
      const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
      if (arrows[k]) { e.preventDefault(); const st = e.shiftKey ? 10 : 1; xf.box.cx += arrows[k][0] * st; xf.box.cy += arrows[k][1] * st; renderXf(false); drawOverlay(); return; }
    }
    if (lasso) {
      if (k === 'enter') { e.preventDefault(); return finishLasso(); }
      if (k === 'escape') { e.preventDefault(); lasso = null; return drawOverlay(); }
      if (k === 'backspace' && lasso.poly) { e.preventDefault(); lasso.pts.pop(); if (!lasso.pts.length) lasso = null; return drawOverlay(); }
    }
    if (mod && k === 't') { e.preventDefault(); return run('freeTransform'); } // Ctrl+T (se o navegador deixar) e Ctrl+Alt+T
    let cmd = null;
    if (mod) {
      if (k === 'z') cmd = e.shiftKey ? 'redo' : 'undo';
      else if (k === 'y') cmd = 'redo';
      else if (k === 'o') cmd = 'open';
      else if (k === 's') cmd = 'saveProject';
      else if (k === 'e') cmd = e.shiftKey ? 'exportPNG' : 'mergeDown';
      else if (k === 'j') cmd = 'dupLayer';
      else if (k === '/') cmd = 'lockAll';
      else if (k === 'g') cmd = e.shiftKey ? 'ungroup' : e.altKey ? 'clipMask' : 'groupLayers';
      else if (k === 'n' && e.shiftKey) cmd = 'newLayer';
      else if (k === 'a') cmd = 'selectAll';
      else if (k === 'd') cmd = 'deselect';
      else if (k === 'i') cmd = e.altKey ? 'imageSize' : e.shiftKey ? 'invertSel' : 'fx:invert';
      else if (k === 'r' && e.altKey) cmd = 'refineSel';
      else if (k === 'c') cmd = e.altKey ? 'canvasSize' : (window.getSelection().toString() ? null : 'copy');
      else if (k === 'u') cmd = e.shiftKey ? 'fx:desaturate' : 'adj:hsl';
      else if (k === 'l') cmd = 'adj:levels';
      else if (k === 'm') cmd = 'adj:curves';
      else if (k === '\\') cmd = 'editMask';
      else if (k === '2') cmd = 'editContent';
      else if (k === '0') cmd = 'fit';
      else if (k === '1') cmd = 'actual';
      else if (k === '=' || k === '+') cmd = 'zoomIn';
      else if (k === '-') cmd = 'zoomOut';
      else if (k === ']') cmd = 'layerUp';
      else if (k === '[') cmd = 'layerDown';
    } else if (e.key === ' ') {
      if (!spaceDown) { spaceDown = true; updateCursor(); }
      e.preventDefault(); return;
    } else if (k === 'g' && e.shiftKey) { setTool('gradient'); return; }
    else if (k === 'j' && e.shiftKey) { setTool('heal'); return; }
    else if (k === 'w' && e.shiftKey) { setTool('quick'); return; }
    else if (TOOL_KEYS[k] && !e.altKey) { setTool(TOOL_KEYS[k]); return; }
    else if (k === '[' || k === ']') {
      const o = opts[tool]; if (!o || o.size === undefined) return;
      const step = o.size < 10 ? 1 : o.size < 50 ? 5 : 10;
      o.size = Math.min(500, Math.max(1, o.size + (k === ']' ? step : -step)));
      buildOptions(); drawOverlay(); return;
    }
    else if (k === 'x') { const a = fg(); $('#colorFg').value = bg(); $('#colorBg').value = a; return; }
    else if (k === 'd') { $('#colorFg').value = '#000000'; $('#colorBg').value = '#ffffff'; return; }
    else if (k === 'delete' || k === 'backspace') cmd = e.altKey ? 'fill' : 'clear';
    else if (k === 'escape' && tool === 'crop') { initCrop(); buildOptions(); drawOverlay(); return; }
    else if (k === 'enter' && tool === 'crop') { e.preventDefault(); applyCrop(); return; }
    else if (k === 'escape') { sel = null; drawOverlay(); return; }
    if (cmd) { e.preventDefault(); run(cmd); }
  });
  window.addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; updateCursor(); } });
  window.addEventListener('blur', () => { spaceDown = false; updateCursor(); });

  // ---------- arquivos, colar, arrastar
  const onFile = (input, fn) => input.addEventListener('change', () => { const f = input.files[0]; input.value = ''; f && fn(f); });
  onFile($('#fileOpen'), openImageFile);
  onFile($('#fileLayer'), addImageLayer);
  onFile($('#fileProject'), loadProject);
  window.addEventListener('paste', e => {
    if (e.target.matches('input, textarea, [contenteditable="true"]')) return;
    const item = [...e.clipboardData.items].find(i => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); handleIncomingFile(item.getAsFile()); }
  });
  ws.addEventListener('dragover', e => { e.preventDefault(); ws.classList.add('dragover'); });
  ws.addEventListener('dragleave', () => ws.classList.remove('dragover'));
  ws.addEventListener('drop', e => {
    e.preventDefault(); ws.classList.remove('dragover');
    const f = e.dataTransfer.files[0]; f && handleIncomingFile(f);
  });
  window.addEventListener('beforeunload', e => { if (history.states.length > 1) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('resize', resizeOverlay);

  // ---------- início
  resizeOverlay();
  createDoc(1200, 800, '#ffffff');
  setTool('brush');
  window.PhotoView = { doc, history, run, view }; // útil para depuração
})();
