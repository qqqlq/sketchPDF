'use strict';
/* SketchPDF - ブラウザ完結のローカルPDFエディター
 * 座標系: ページ上のオブジェクトは「表示向き(回転適用後)のpt単位・左上原点」で保持する。
 * 書き出し時に pdf-lib の座標(左下原点)へ変換する。 */

const { PDFDocument, rgb, degrees, LineCapStyle } = PDFLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = '../vendor/pdf.worker.min.js';

const $ = (s, r = document) => r.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const PAD = 4;          // テキストの内側余白(pt)
const LH = 1.3;         // テキストの行間(em)
const FM = { asc: 0.88, desc: 0.12 };   // フォントのascent/descent(em)。起動時に実測する
const dpr = window.devicePixelRatio || 1;

let seq = 0;
const nid = () => 'i' + (++seq) + Math.random().toString(36).slice(2, 6);
const clone = o => JSON.parse(JSON.stringify(o));
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------------- 状態 ---------------- */
const S = {
  sources: [],          // {bytes, doc, name}
  pages: [],            // {id, src, num, r0, rot, w0, h0, box, objs[]}  src=-1 は空白ページ
  assets: new Map(),    // id -> {bytes, mime, url}
  sel: null,            // {pid, oid}
  selPages: new Set(),
  cur: 0,
  tool: 'select',
  zoom: 1.2,
  undo: [], redo: [],
  lastKey: null, lastT: 0,
  dirty: false,
  editing: null,
  clip: null,
  name: 'document',
};

const DEF = {
  text:    { fs: 24, color: '#222222', align: 'left', bold: false, bg: null, op: 1 },
  rect:    { fill: '#7c3aed', stroke: '#1f2430', sw: 0, op: 1 },
  ellipse: { fill: '#f59e0b', stroke: '#1f2430', sw: 0, op: 1 },
  hl:      { fill: '#ffe600', stroke: '#1f2430', sw: 0, op: 0.4 },
  line:    { stroke: '#e11d48', sw: 3, op: 1 },
  arrow:   { stroke: '#e11d48', sw: 3, op: 1 },
  pen:     { stroke: '#e11d48', sw: 3, op: 1 },
  image:   { op: 1 },
};
const TOOLS = [
  ['select', '選択', 'V', '<path d="M5 3l14 8-6 2-2 6z"/>'],
  ['text', 'テキスト', 'T', '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'],
  ['image', '画像', 'I', '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5 4 4 3-3 4 4"/>'],
  ['rect', '四角', 'R', '<rect x="4" y="6" width="16" height="12" rx="1"/>'],
  ['ellipse', '円', 'O', '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>'],
  ['line', '線', 'L', '<path d="M5 19L19 5"/>'],
  ['arrow', '矢印', 'A', '<path d="M5 19L19 5M10 5h9v9"/>'],
  ['pen', 'ペン', 'P', '<path d="M4 20l1-4L16 5l3 3L8 19z"/>'],
  ['hl', '蛍光ペン', 'H', '<path d="M9 14l6-8 4 3-6 8zM9 14l-3 5 5-1M14 20h6"/>'],
];

/* ---------------- 幾何ヘルパー ---------------- */
const total = p => (((p.r0 + p.rot) % 360) + 360) % 360;
const vsize = p => (total(p) % 180 ? { w: p.h0, h: p.w0 } : { w: p.w0, h: p.h0 });
const pageById = id => S.pages.find(p => p.id === id);
const pageIndex = id => S.pages.findIndex(p => p.id === id);

function bbox(o) {
  switch (o.type) {
    case 'line': case 'arrow':
      return { x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
    case 'pen': {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of o.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    case 'text': return { x: o.x, y: o.y, w: o.w || 40, h: o.h || 30 };
    default: return { x: o.x, y: o.y, w: o.w, h: o.h };
  }
}

function translate(o, orig, dx, dy) {
  if (o.type === 'line' || o.type === 'arrow') {
    o.x1 = orig.x1 + dx; o.y1 = orig.y1 + dy; o.x2 = orig.x2 + dx; o.y2 = orig.y2 + dy;
  } else if (o.type === 'pen') {
    o.pts = orig.pts.map(([x, y]) => [x + dx, y + dy]);
  } else { o.x = orig.x + dx; o.y = orig.y + dy; }
}

function applyResize(o, orig, h, dx, dy) {
  if (o.type === 'line' || o.type === 'arrow') {
    if (h === 'p1') { o.x1 = orig.x1 + dx; o.y1 = orig.y1 + dy; }
    else { o.x2 = orig.x2 + dx; o.y2 = orig.y2 + dy; }
    return;
  }
  const ob = bbox(orig);
  let x0 = ob.x, y0 = ob.y, x1 = ob.x + ob.w, y1 = ob.y + ob.h;
  if (h.includes('w')) x0 += dx;
  if (h.includes('e')) x1 += dx;
  if (h.includes('n')) y0 += dy;
  if (h.includes('s')) y1 += dy;
  if (o.type === 'text' || o.type === 'image') {
    // 縦横比固定で拡縮(テキストはフォントサイズが変わる)
    const f = clamp(((x1 - x0) / ob.w + (y1 - y0) / ob.h) / 2, 0.05, 50);
    const w = ob.w * f, hh = ob.h * f;
    const ax = h.includes('w') ? ob.x + ob.w : ob.x;
    const ay = h.includes('n') ? ob.y + ob.h : ob.y;
    const nx = h.includes('w') ? ax - w : ax;
    const ny = h.includes('n') ? ay - hh : ay;
    if (o.type === 'text') { o.fs = Math.max(4, orig.fs * f); o.x = nx; o.y = ny; }
    else { o.x = nx; o.y = ny; o.w = w; o.h = hh; }
    return;
  }
  const nx = Math.min(x0, x1), ny = Math.min(y0, y1);
  const nw = Math.max(2, Math.abs(x1 - x0)), nh = Math.max(2, Math.abs(y1 - y0));
  if (o.type === 'pen') {
    const sx = ob.w ? nw / ob.w : 1, sy = ob.h ? nh / ob.h : 1;
    o.pts = orig.pts.map(([x, y]) => [nx + (x - ob.x) * sx, ny + (y - ob.y) * sy]);
  } else { o.x = nx; o.y = ny; o.w = nw; o.h = nh; }
}

/** ページを右に90°回すとき、表示座標のオブジェクトも追従させる。(W,H)は回転前の表示サイズ */
function rotObjCW(o, W, H) {
  const P = (x, y) => [H - y, x];
  switch (o.type) {
    case 'line': case 'arrow':
      [o.x1, o.y1] = P(o.x1, o.y1); [o.x2, o.y2] = P(o.x2, o.y2); break;
    case 'pen': o.pts = o.pts.map(([x, y]) => P(x, y)); break;
    case 'text': case 'image': {
      const w = o.w || 40, h = o.h || 30;
      const [cx, cy] = P(o.x + w / 2, o.y + h / 2);
      o.x = cx - w / 2; o.y = cy - h / 2; break;
    }
    default: {
      const nx = H - (o.y + o.h), ny = o.x;
      [o.w, o.h] = [o.h, o.w]; o.x = nx; o.y = ny;
    }
  }
}

function arrowGeom(o) {
  const dx = o.x2 - o.x1, dy = o.y2 - o.y1, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const hl = Math.min(len * 0.9, Math.max(10, o.sw * 4)), hw = hl * 0.5;
  const bx = o.x2 - ux * hl, by = o.y2 - uy * hl;
  return {
    end: [o.x2 - ux * hl * 0.8, o.y2 - uy * hl * 0.8],
    head: [[o.x2, o.y2], [bx - uy * hw, by + ux * hw], [bx + uy * hw, by - ux * hw]],
  };
}
const penPath = pts => pts.length === 1
  ? `M ${pts[0][0]} ${pts[0][1]} L ${pts[0][0] + 0.01} ${pts[0][1]}`
  : 'M ' + pts.map(p => `${p[0]} ${p[1]}`).join(' L ');

/* ---------------- Undo / Redo ---------------- */
const snapshot = () => JSON.stringify({ pages: S.pages, sel: S.sel });
const structSig = () => S.pages.map(p => p.id + ':' + total(p)).join(',');

function pushUndo(key) {
  const now = Date.now();
  S.dirty = true;
  if (key && key === S.lastKey && now - S.lastT < 1200) { S.lastT = now; return; }
  S.undo.push(snapshot());
  if (S.undo.length > 100) S.undo.shift();
  S.redo = [];
  S.lastKey = key || null; S.lastT = now;
  updateUndoBtns();
}
function restore(json) {
  endEdit(true);
  const before = structSig();
  const st = JSON.parse(json);
  S.pages = st.pages;
  S.sel = st.sel;
  if (S.sel && !(pageById(S.sel.pid)?.objs.some(o => o.id === S.sel.oid))) S.sel = null;
  S.selPages = new Set([...S.selPages].filter(id => pageById(id)));
  S.cur = clamp(S.cur, 0, S.pages.length - 1);
  S.lastKey = null; S.dirty = true;
  if (before !== structSig()) refreshAll(); else { S.pages.forEach(renderOverlay); renderProps(); }
  updateUndoBtns();
}
function undo() { if (!S.undo.length) return; S.redo.push(snapshot()); restore(S.undo.pop()); }
function redo() { if (!S.redo.length) return; S.undo.push(snapshot()); restore(S.redo.pop()); }
function updateUndoBtns() {
  $('#btn-undo').disabled = !S.undo.length;
  $('#btn-redo').disabled = !S.redo.length;
}

/* ---------------- 描画キュー & ページDOM ---------------- */
let pageEls = new Map();   // pid -> {wrap, inner, canvas, ckey, pending, th, tcanvas, tkey, tpending}
let renderChain = Promise.resolve();
const queue = fn => { renderChain = renderChain.then(fn).catch(e => console.warn(e)); };

const stage = $('#stage'), pgsEl = $('#pgs'), thumbsEl = $('#thumbs');
const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) ensureCanvas(en.target.dataset.pid); }),
  { root: stage, rootMargin: '900px 0px' });
const tio = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) ensureThumb(en.target.dataset.pid); }),
  { root: thumbsEl, rootMargin: '400px 0px' });

const mainKey = p => `${p.src}:${p.num}:${total(p)}:${S.zoom.toFixed(3)}`;
const thumbKey = p => `${p.src}:${p.num}:${total(p)}`;

function ensureCanvas(pid) {
  const e = pageEls.get(pid), p0 = pageById(pid);
  if (!e || !p0 || p0.src < 0) return;
  const key = mainKey(p0);
  if (e.ckey === key || e.pending === key) return;
  e.pending = key;
  queue(async () => {
    const p = pageById(pid);
    if (pageEls.get(pid) !== e || !p || mainKey(p) !== key) { e.pending = null; return; }
    const pg = await S.sources[p.src].doc.getPage(p.num);
    const { w, h } = vsize(p);
    let sc = S.zoom * dpr;
    if (w * h * sc * sc > 36e6) sc = Math.sqrt(36e6 / (w * h));
    const vp = pg.getViewport({ scale: sc, rotation: total(p) });
    const c = el('canvas', 'base');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const p2 = pageById(pid);
    if (pageEls.get(pid) !== e || !p2 || mainKey(p2) !== key) { e.pending = null; return; }
    if (e.canvas) e.canvas.remove();
    e.wrap.insertBefore(c, e.wrap.firstChild);
    e.canvas = c; e.ckey = key; e.pending = null;
  });
}

function ensureThumb(pid) {
  const e = pageEls.get(pid), p0 = pageById(pid);
  if (!e || !e.th || !p0 || p0.src < 0) return;
  const key = thumbKey(p0);
  if (e.tkey === key || e.tpending === key) return;
  e.tpending = key;
  queue(async () => {
    const p = pageById(pid);
    if (pageEls.get(pid) !== e || !p || thumbKey(p) !== key) { e.tpending = null; return; }
    const pg = await S.sources[p.src].doc.getPage(p.num);
    const { w } = vsize(p);
    const vp = pg.getViewport({ scale: (118 * dpr) / w, rotation: total(p) });
    const c = el('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    c.style.width = '100%'; c.style.height = '100%';
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const p2 = pageById(pid);
    if (pageEls.get(pid) !== e || !p2 || thumbKey(p2) !== key) { e.tpending = null; return; }
    if (e.tcanvas) e.tcanvas.remove();
    e.tbox.appendChild(c); e.tcanvas = c; e.tkey = key; e.tpending = null;
  });
}

function rebuildStage() {
  const old = pageEls;
  const ratio = old.size && stage.scrollHeight ? (stage.scrollTop + stage.clientHeight / 2) / stage.scrollHeight : null;
  io.disconnect(); tio.disconnect();
  pgsEl.textContent = ''; thumbsEl.textContent = '';
  pageEls = new Map();
  const z = S.zoom;
  S.pages.forEach((p, i) => {
    const prev = old.get(p.id);
    const { w, h } = vsize(p);
    const e = { };
    // メインページ
    const wrap = el('div', 'pgwrap'); wrap.dataset.pid = p.id;
    wrap.style.width = w * z + 'px'; wrap.style.height = h * z + 'px';
    const inner = el('div', 'inner ov');
    inner.style.cssText = `width:${w}px;height:${h}px;transform:scale(${z});--k:${1 / z}`;
    wrap.appendChild(inner);
    e.wrap = wrap; e.inner = inner;
    if (prev?.canvas && prev.ckey === mainKey(p)) { wrap.insertBefore(prev.canvas, inner); e.canvas = prev.canvas; e.ckey = prev.ckey; }
    pgsEl.appendChild(wrap);
    io.observe(wrap);
    // サムネイル
    const tw = 118, th = Math.min(170, tw * h / w), tw2 = th === 170 ? 170 * w / h : tw;
    const t = el('div', 'th'); t.dataset.pid = p.id; t.draggable = true;
    const tc = el('div', 'tc'); const tbox = el('div', 'tbox');
    tbox.style.width = tw2 + 'px'; tbox.style.height = th + 'px';
    tc.appendChild(tbox); t.appendChild(tc);
    const num = el('div', 'num'); num.textContent = i + 1; t.appendChild(num);
    e.th = t; e.tbox = tbox;
    if (prev?.tcanvas && prev.tkey === thumbKey(p)) { tbox.appendChild(prev.tcanvas); e.tcanvas = prev.tcanvas; e.tkey = prev.tkey; }
    thumbsEl.appendChild(t);
    tio.observe(t);
    pageEls.set(p.id, e);
  });
  S.pages.forEach(renderOverlay);
  stage.scrollTop = ratio === null ? 0 : ratio * stage.scrollHeight - stage.clientHeight / 2;
  markThumbs();
  updateIndicator();
}

function refreshAll() {
  $('#empty').hidden = S.pages.length > 0;
  rebuildStage();
  renderProps();
  $('#docname').textContent = S.pages.length ? S.name + '.pdf' : '';
  $('#zoomlabel').textContent = Math.round(S.zoom * 100) + '%';
}

function markThumbs() {
  S.pages.forEach((p, i) => {
    const e = pageEls.get(p.id); if (!e) return;
    e.th.classList.toggle('sel', S.selPages.has(p.id));
    e.th.classList.toggle('cur', i === S.cur);
    e.wrap.classList.toggle('cur', false);
  });
}
function updateIndicator() {
  $('#pageind').textContent = S.pages.length ? `${S.cur + 1} / ${S.pages.length}` : '';
  $('#pageind').hidden = !S.pages.length;
}
function setCur(i, scroll) {
  if (i < 0 || i >= S.pages.length) return;
  const changed = i !== S.cur;
  S.cur = i;
  if (changed) { markThumbs(); updateIndicator(); const t = pageEls.get(S.pages[i].id)?.th; t?.scrollIntoView({ block: 'nearest' }); }
  if (scroll) {
    const w = pageEls.get(S.pages[i].id).wrap;
    stage.scrollTo({ top: w.offsetTop - 24, behavior: 'smooth' });
  }
}

/* ---------------- オブジェクトのDOM ---------------- */
function buildObj(o) {
  const d = el('div', 'obj ' + o.type); d.dataset.oid = o.id;
  if (o.type === 'text') {
    Object.assign(d.style, {
      left: o.x + 'px', top: o.y + 'px', fontSize: o.fs + 'px', color: o.color, textAlign: o.align,
      fontWeight: o.bold ? 700 : 400, opacity: o.op, background: o.bg || 'transparent',
    });
    d.textContent = o.text;
    return d;
  }
  if (o.type === 'image') {
    Object.assign(d.style, { left: o.x + 'px', top: o.y + 'px', width: o.w + 'px', height: o.h + 'px', opacity: o.op });
    const im = new Image(); im.src = S.assets.get(o.asset)?.url || ''; im.draggable = false;
    d.appendChild(im);
    return d;
  }
  const svg = svgEl('svg'); svg.style.opacity = o.op; d.appendChild(svg);
  const stroke = (o.sw > 0 ? o.stroke : 'none');
  switch (o.type) {
    case 'rect': case 'hl':
      svg.appendChild(svgEl('rect', { x: o.x, y: o.y, width: o.w, height: o.h, fill: o.fill || 'none', stroke, 'stroke-width': o.sw }));
      break;
    case 'ellipse':
      svg.appendChild(svgEl('ellipse', { cx: o.x + o.w / 2, cy: o.y + o.h / 2, rx: o.w / 2, ry: o.h / 2, fill: o.fill || 'none', stroke, 'stroke-width': o.sw }));
      break;
    case 'line': case 'arrow': {
      let x2 = o.x2, y2 = o.y2, g = null;
      if (o.type === 'arrow') { g = arrowGeom(o); [x2, y2] = g.end; }
      const common = { x1: o.x1, y1: o.y1, x2, y2, 'stroke-linecap': 'round' };
      svg.appendChild(svgEl('line', { ...common, stroke: o.stroke, 'stroke-width': o.sw }));
      if (g) svg.appendChild(svgEl('polygon', { points: g.head.map(p => p.join(',')).join(' '), fill: o.stroke }));
      svg.appendChild(svgEl('line', { x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2, stroke: 'transparent', 'stroke-width': Math.max(o.sw, 12) }));
      break;
    }
    case 'pen': {
      const dd = penPath(o.pts);
      svg.appendChild(svgEl('path', { d: dd, fill: 'none', stroke: o.stroke, 'stroke-width': o.sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      svg.appendChild(svgEl('path', { d: dd, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(o.sw, 12), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      break;
    }
  }
  return d;
}

function objEl(pid, oid) {
  return pageEls.get(pid)?.inner.querySelector(`[data-oid="${oid}"]`);
}

function renderOverlay(p) {
  const e = pageEls.get(p.id); if (!e) return;
  if (S.editing && S.editing.pid === p.id) { drawSel(p); return; }
  e.inner.textContent = '';
  for (const o of p.objs) e.inner.appendChild(buildObj(o));
  for (const o of p.objs) if (o.type === 'text') {
    const d = objEl(p.id, o.id); o.w = d.offsetWidth; o.h = d.offsetHeight;
  }
  drawSel(p);
}

const HANDLES = {
  corners: ['nw', 'ne', 'se', 'sw'],
  all: ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'],
};
const HPOS = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] };

function drawSel(p) {
  const e = pageEls.get(p.id); if (!e) return;
  e.inner.querySelectorAll('.selbox, .hd').forEach(n => n.remove());
  if (!S.sel || S.sel.pid !== p.id) return;
  const o = p.objs.find(x => x.id === S.sel.oid); if (!o) return;
  if (o.type === 'line' || o.type === 'arrow') {
    for (const [h, x, y] of [['p1', o.x1, o.y1], ['p2', o.x2, o.y2]]) {
      const d = el('div', 'hd'); d.dataset.h = h; d.style.left = x + 'px'; d.style.top = y + 'px';
      e.inner.appendChild(d);
    }
    return;
  }
  const b = bbox(o);
  const box = el('div', 'selbox');
  Object.assign(box.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
  e.inner.appendChild(box);
  if (S.editing) return;
  const hs = (o.type === 'text' || o.type === 'image') ? HANDLES.corners : HANDLES.all;
  for (const h of hs) {
    const d = el('div', 'hd'); d.dataset.h = h;
    d.style.left = HPOS[h][0] + '%'; d.style.top = HPOS[h][1] + '%';
    box.appendChild(d);
  }
}

/* ---------------- 選択 / 編集 ---------------- */
function getSel() {
  if (!S.sel) return null;
  const p = pageById(S.sel.pid); const o = p?.objs.find(x => x.id === S.sel.oid);
  return o ? { p, o } : null;
}
function select(p, o) {
  const prev = S.sel && pageById(S.sel.pid);
  S.sel = o ? { pid: p.id, oid: o.id } : null;
  if (prev && prev !== p) renderOverlay(prev);
  if (p) renderOverlay(p);
  renderProps();
}
function deselect() { if (S.editing) endEdit(); const prev = S.sel && pageById(S.sel.pid); S.sel = null; if (prev) renderOverlay(prev); renderProps(); }

let editInit = null;
function startEdit(p, o) {
  endEdit();
  S.sel = { pid: p.id, oid: o.id };
  pushUndo(); editInit = o.text;
  renderOverlay(p);
  S.editing = { pid: p.id, oid: o.id };
  drawSel(p);   // 編集中はハンドルを隠す
  const d = objEl(p.id, o.id);
  d.classList.add('editing');
  try { d.contentEditable = 'plaintext-only'; } catch (_) { }
  if (d.contentEditable !== 'plaintext-only') d.contentEditable = 'true';
  d.focus();
  const r = document.createRange(); r.selectNodeContents(d);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  d.addEventListener('input', () => {
    o.text = readText(d); o.w = d.offsetWidth; o.h = d.offsetHeight; drawSel(p); S.dirty = true;
  });
  d.addEventListener('blur', () => endEdit());
  d.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.preventDefault(); d.blur(); } });
  renderProps();
}
const readText = d => d.innerText.replace(/\n$/, '');
function endEdit(silent) {
  if (!S.editing) return;
  const { pid, oid } = S.editing; S.editing = null;
  const p = pageById(pid), o = p?.objs.find(x => x.id === oid);
  if (!o) return;
  const d = objEl(pid, oid);
  if (d) o.text = readText(d);
  if (!o.text.trim()) {
    p.objs = p.objs.filter(x => x !== o); S.sel = null;
  } else if (o.text === editInit && S.undo.length) { S.undo.pop(); updateUndoBtns(); }
  if (!silent) { renderOverlay(p); renderProps(); }
}

/* ---------------- ポインタ操作 ---------------- */
function toPt(e, p) {
  const r = pageEls.get(p.id).inner.getBoundingClientRect();
  return { x: (e.clientX - r.left) / S.zoom, y: (e.clientY - r.top) / S.zoom };
}
let drag = null;

stage.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const wrap = e.target.closest('.pgwrap');
  if (!wrap) { if (S.tool === 'select') deselect(); return; }
  const p = pageById(wrap.dataset.pid); if (!p) return;
  setCur(pageIndex(p.id));
  if (S.editing) {
    if (e.target.closest('.obj.editing')) return;
    endEdit();
  }
  const pt = toPt(e, p);
  const hd = e.target.closest('.hd');
  const oe = e.target.closest('[data-oid]');
  const tool = S.tool;

  if (tool === 'select') {
    if (hd && S.sel) {
      const o = getSel().o;
      return startDrag(e, 'resize', p, o, pt, hd.dataset.h);
    }
    if (oe) {
      const o = p.objs.find(x => x.id === oe.dataset.oid);
      select(p, o);
      return startDrag(e, 'move', p, o, pt);
    }
    deselect();
    return;
  }
  if (tool === 'text') {
    if (oe) {
      const o = p.objs.find(x => x.id === oe.dataset.oid);
      if (o?.type === 'text') { select(p, o); setTimeout(() => startEdit(p, o)); e.preventDefault(); return; }
    }
    e.preventDefault();
    pushUndo();
    const o = { id: nid(), type: 'text', x: pt.x, y: pt.y, text: 'テキスト', ...clone(DEF.text) };
    p.objs.push(o);
    setTool('select');
    select(p, o);
    setTimeout(() => startEdit(p, o));
    return;
  }
  e.preventDefault();
  // 図形・線・ペンの描画開始
  pushUndo();
  const base = { id: nid(), type: tool, ...clone(DEF[tool]) };
  let o;
  if (tool === 'rect' || tool === 'ellipse' || tool === 'hl') o = { ...base, x: pt.x, y: pt.y, w: 0, h: 0 };
  else if (tool === 'line' || tool === 'arrow') o = { ...base, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
  else o = { ...base, pts: [[pt.x, pt.y]] };
  p.objs.push(o);
  startDrag(e, 'draw', p, o, pt);
});

function startDrag(e, mode, p, o, pt, handle) {
  drag = { mode, pid: p.id, oid: o.id, start: pt, orig: clone(o), handle, moved: mode === 'draw' };
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd, { once: true });
}

function onDragMove(e) {
  if (!drag) return;
  const p = pageById(drag.pid), o = p?.objs.find(x => x.id === drag.oid);
  if (!o) return;
  const pt = toPt(e, p);
  const dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
  if (!drag.moved) {
    if (Math.hypot(dx, dy) * S.zoom < 3) return;
    drag.moved = true; pushUndo();
  }
  if (drag.mode === 'move') translate(o, drag.orig, dx, dy);
  else if (drag.mode === 'resize') applyResize(o, drag.orig, drag.handle, dx, dy);
  else {
    if (o.type === 'pen') {
      const last = o.pts[o.pts.length - 1];
      if (Math.hypot(pt.x - last[0], pt.y - last[1]) >= 0.8) o.pts.push([pt.x, pt.y]);
    } else if (o.type === 'line' || o.type === 'arrow') {
      let x = pt.x, y = pt.y;
      if (e.shiftKey) {  // 45°刻み
        const a = Math.round(Math.atan2(y - o.y1, x - o.x1) / (Math.PI / 4)) * (Math.PI / 4), r = Math.hypot(x - o.x1, y - o.y1);
        x = o.x1 + Math.cos(a) * r; y = o.y1 + Math.sin(a) * r;
      }
      o.x2 = x; o.y2 = y;
    } else {
      let w = dx, h = dy;
      if (e.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
      o.x = w < 0 ? drag.start.x + w : drag.start.x; o.y = h < 0 ? drag.start.y + h : drag.start.y;
      o.w = Math.abs(w); o.h = Math.abs(h);
    }
  }
  renderOverlay(p);
}

function onDragEnd() {
  window.removeEventListener('pointermove', onDragMove);
  const d = drag; drag = null;
  if (!d) return;
  const p = pageById(d.pid), o = p?.objs.find(x => x.id === d.oid);
  if (!o) return;
  if (d.mode === 'draw') {
    const small = o.type === 'line' || o.type === 'arrow' ? Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 4
      : o.type === 'pen' ? false : (o.w < 4 && o.h < 4);
    if (small) {
      if (o.type === 'line' || o.type === 'arrow') { o.x2 = o.x1 + 120; o.y2 = o.y1; }
      else { const sz = { rect: [140, 90], ellipse: [100, 100], hl: [160, 22] }[o.type]; o.w = sz[0]; o.h = sz[1]; }
    }
    if (o.type !== 'pen' && o.type !== 'hl') { setTool('select'); select(p, o); return; }
    renderOverlay(p);
  }
}

stage.addEventListener('dblclick', e => {
  const oe = e.target.closest('[data-oid]'); if (!oe || S.tool !== 'select') return;
  const p = pageById(e.target.closest('.pgwrap')?.dataset.pid);
  const o = p?.objs.find(x => x.id === oe.dataset.oid);
  if (o?.type === 'text' && !S.editing) startEdit(p, o);
});

/* ---------------- ツール ---------------- */
function buildTools() {
  const nav = $('#tools');
  for (const [id, label, key, path] of TOOLS) {
    const b = el('button', 'tool'); b.dataset.tool = id; b.title = `${label} (${key})`;
    b.innerHTML = `<svg viewBox="0 0 24 24">${path}</svg><span>${label}</span>`;
    b.onclick = () => { if (id === 'image') { $('#f-img').click(); return; } setTool(id); };
    nav.appendChild(b);
  }
}
function setTool(t) {
  if (S.editing) endEdit();
  S.tool = t;
  document.body.className = 'tool-' + t;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  if (t !== 'select' && S.sel) { const p = pageById(S.sel.pid); S.sel = null; if (p) renderOverlay(p); }
  renderProps();
}

/* ---------------- プロパティパネル ---------------- */
function propTarget() {
  const s = getSel();
  if (s) return { obj: s.o, type: s.o.type, page: s.p };
  if (DEF[S.tool] && S.tool !== 'image') return { obj: null, type: S.tool };
  return null;
}
const TYPE_LABEL = { text: 'テキスト', image: '画像', rect: '四角', ellipse: '円', hl: '蛍光ペン', line: '線', arrow: '矢印', pen: 'ペン' };

function renderProps() {
  const box = $('#props'); const t = propTarget();
  if (!t) {
    box.innerHTML = `<h3>プロパティ</h3><p class="hint">ツールを選ぶか、ページ上のオブジェクトを選択すると、ここで色やサイズを変更できます。</p>
      <p class="hint">・テキストはダブルクリックで編集<br>・Shiftキーで正円/正方形・45°の線<br>・Ctrl+ホイールで拡大縮小<br>・Delete で削除、Ctrl+C/V でコピー<br>・矢印キーで微調整<br>・既存の文字を直すときは、四角(白)で覆ってからテキストを重ねてください</p>`;
    return;
  }
  const v = t.obj || DEF[t.type];
  const f = [];
  const num = (k, label, min, max, step = 1) => `<div class="fld"><label>${label}</label><input type="number" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${+(+v[k]).toFixed(1)}"></div>`;
  const color = (k, label) => `<div class="fld"><label>${label}</label><input type="color" data-k="${k}" value="${v[k]}"></div>`;
  const ncolor = (k, label) => `<div class="fld"><label><input type="checkbox" data-on="${k}" ${v[k] ? 'checked' : ''}> ${label}</label><input type="color" data-k="${k}" value="${v[k] || DEF[t.type][k] || '#ffffff'}"></div>`;
  const range = (k, label, min, max, step, fmt) => `<div class="fld"><label>${label}</label><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v[k]}"><span class="val">${fmt(v[k])}</span></div>`;
  const pct = x => Math.round(x * 100) + '%';
  const px = x => (+x).toFixed(0);
  switch (t.type) {
    case 'text':
      f.push(num('fs', 'サイズ', 4, 400, 1));
      f.push(`<div class="fld"><label>太字</label><input type="checkbox" data-k="bold" ${v.bold ? 'checked' : ''}></div>`);
      f.push(`<div class="fld"><label>配置</label><span class="seg">${['left', 'center', 'right'].map((a, i) => `<button data-align="${a}" class="${v.align === a ? 'on' : ''}">${['左', '中', '右'][i]}</button>`).join('')}</span></div>`);
      f.push(color('color', '文字色'));
      f.push(ncolor('bg', '背景色'));
      f.push(range('op', '不透明度', 0.05, 1, 0.05, pct));
      break;
    case 'rect': case 'ellipse': case 'hl':
      f.push(ncolor('fill', '塗りつぶし'));
      f.push(color('stroke', '線の色'));
      f.push(range('sw', '線の太さ', 0, 30, 0.5, px));
      f.push(range('op', '不透明度', 0.05, 1, 0.05, pct));
      break;
    case 'line': case 'arrow': case 'pen':
      f.push(color('stroke', '線の色'));
      f.push(range('sw', '線の太さ', 0.5, 40, 0.5, px));
      f.push(range('op', '不透明度', 0.05, 1, 0.05, pct));
      break;
    case 'image':
      f.push(range('op', '不透明度', 0.05, 1, 0.05, pct));
      break;
  }
  const acts = t.obj ? `<div class="actions">
      <button data-pa="front">最前面へ</button><button data-pa="back">最背面へ</button>
      <button data-pa="dup">複製 (Ctrl+D)</button><button data-pa="del" class="danger">削除</button></div>` : '';
  box.innerHTML = `<h3>${TYPE_LABEL[t.type]}${t.obj ? '' : '（次に描く設定）'}</h3>${f.join('')}${acts}`;
}

function setProp(k, val) {
  const t = propTarget(); if (!t) return;
  if (t.obj) {
    pushUndo('p:' + k + t.obj.id);
    t.obj[k] = val;
    renderOverlay(t.page);
  }
  DEF[t.type][k] = val;
}

$('#props').addEventListener('input', e => {
  const i = e.target; const k = i.dataset.k;
  if (i.dataset.on) {  // 塗りつぶし/背景のON/OFF
    const col = i.parentElement.parentElement.querySelector('input[type=color]').value;
    return setProp(i.dataset.on, i.checked ? col : null);
  }
  if (!k) return;
  let val;
  if (i.type === 'checkbox') val = i.checked;
  else if (i.type === 'color') {
    val = i.value;
    const on = i.parentElement.querySelector('[data-on]');
    if (on && !on.checked) { on.checked = true; }
  } else {
    val = parseFloat(i.value); if (isNaN(val)) return;
    const sp = i.parentElement.querySelector('.val'); if (sp) sp.textContent = k === 'op' ? Math.round(val * 100) + '%' : val.toFixed(0);
  }
  setProp(k, val);
});
$('#props').addEventListener('click', e => {
  const a = e.target.closest('[data-align]');
  if (a) { setProp('align', a.dataset.align); renderProps(); return; }
  const b = e.target.closest('[data-pa]'); if (!b) return;
  const s = getSel(); if (!s) return;
  const act = b.dataset.pa;
  if (act === 'del') deleteSel();
  else if (act === 'dup') duplicateSel();
  else {
    pushUndo();
    s.p.objs = s.p.objs.filter(x => x !== s.o);
    act === 'front' ? s.p.objs.push(s.o) : s.p.objs.unshift(s.o);
    renderOverlay(s.p);
  }
});

function deleteSel() {
  const s = getSel(); if (!s) return;
  pushUndo(); s.p.objs = s.p.objs.filter(x => x !== s.o); S.sel = null;
  renderOverlay(s.p); renderProps();
}
function duplicateSel() {
  const s = getSel(); if (!s) return;
  pushUndo();
  const c = clone(s.o); c.id = nid(); translate(c, clone(c), 14, 14);
  s.p.objs.push(c); select(s.p, c);
}

/* ---------------- ページ操作 ---------------- */
function targetPages() {
  const ids = S.selPages;
  return ids.size ? S.pages.filter(p => ids.has(p.id)) : [S.pages[S.cur]].filter(Boolean);
}

thumbsEl.addEventListener('click', e => {
  const t = e.target.closest('.th'); if (!t) return;
  const id = t.dataset.pid, i = pageIndex(id);
  if (e.ctrlKey || e.metaKey) { S.selPages.has(id) ? S.selPages.delete(id) : S.selPages.add(id); }
  else if (e.shiftKey && S.selPages.size) {
    const last = pageIndex([...S.selPages].pop());
    const [a, b] = [Math.min(last, i), Math.max(last, i)];
    S.selPages = new Set(S.pages.slice(a, b + 1).map(p => p.id));
  } else { S.selPages = new Set([id]); }
  markThumbs();
  setCur(i, true);
});

let dragIds = null;
thumbsEl.addEventListener('dragstart', e => {
  const t = e.target.closest('.th'); if (!t) return;
  dragIds = S.selPages.has(t.dataset.pid) ? S.pages.filter(p => S.selPages.has(p.id)).map(p => p.id) : [t.dataset.pid];
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'pages');
});
thumbsEl.addEventListener('dragover', e => {
  if (!dragIds) return;
  e.preventDefault();
  const t = e.target.closest('.th');
  thumbsEl.querySelectorAll('.dropbefore,.dropafter').forEach(n => n.classList.remove('dropbefore', 'dropafter'));
  if (!t) return;
  const r = t.getBoundingClientRect();
  t.classList.add(e.clientY > r.top + r.height / 2 ? 'dropafter' : 'dropbefore');
});
thumbsEl.addEventListener('drop', e => {
  if (!dragIds) return;
  e.preventDefault();
  const t = e.target.closest('.th');
  const after = t?.classList.contains('dropafter');
  thumbsEl.querySelectorAll('.dropbefore,.dropafter').forEach(n => n.classList.remove('dropbefore', 'dropafter'));
  if (t) movePages(dragIds, t.dataset.pid, after);
  dragIds = null;
});
thumbsEl.addEventListener('dragend', () => {
  dragIds = null;
  thumbsEl.querySelectorAll('.dropbefore,.dropafter').forEach(n => n.classList.remove('dropbefore', 'dropafter'));
});

function movePages(ids, targetId, after) {
  if (ids.includes(targetId)) return;
  pushUndo();
  const moving = S.pages.filter(p => ids.includes(p.id));
  const rest = S.pages.filter(p => !ids.includes(p.id));
  const idx = rest.findIndex(p => p.id === targetId) + (after ? 1 : 0);
  rest.splice(idx, 0, ...moving);
  S.pages = rest; S.cur = pageIndex(ids[0]);
  refreshAll();
}

$('#pages .phead').addEventListener('click', e => {
  const b = e.target.closest('[data-pact]'); if (!b || !S.pages.length) return;
  const act = b.dataset.pact;
  const tg = targetPages();
  if (act === 'all') { S.selPages = new Set(S.pages.map(p => p.id)); markThumbs(); return; }
  if (act === 'rotate') {
    pushUndo();
    for (const p of tg) {
      const { w, h } = vsize(p);
      p.rot = (p.rot + 90) % 360;
      p.objs.forEach(o => rotObjCW(o, w, h));
    }
    refreshAll();
  } else if (act === 'del') {
    if (tg.length >= S.pages.length) return toast('最後の1ページは削除できません', true);
    pushUndo();
    const ids = new Set(tg.map(p => p.id));
    S.pages = S.pages.filter(p => !ids.has(p.id));
    S.selPages.clear(); if (S.sel && ids.has(S.sel.pid)) S.sel = null;
    S.cur = clamp(S.cur, 0, S.pages.length - 1);
    refreshAll();
  } else if (act === 'dup') {
    pushUndo();
    const last = S.pages.indexOf(tg[tg.length - 1]);
    const copies = tg.map(p => { const c = clone(p); c.id = nid(); c.objs.forEach(o => o.id = nid()); return c; });
    S.pages.splice(last + 1, 0, ...copies);
    refreshAll();
  } else if (act === 'blank') {
    pushUndo();
    const ref = S.pages[S.cur], { w, h } = vsize(ref);
    S.pages.splice(S.cur + 1, 0, { id: nid(), src: -1, num: 0, r0: 0, rot: 0, w0: w, h0: h, box: null, objs: [] });
    S.cur++;
    refreshAll(); setCur(S.cur, true);
  }
});

/* ---------------- ファイル入出力 ---------------- */
/* ---- 暗号化PDFの復号 (qpdf-wasm。パスワードを知っているファイルのみ対象) ---- */
let qpdfLoad = null;
const loadQpdf = () => qpdfLoad ||= new Promise((res, rej) => {
  const sc = el('script'); sc.src = '../vendor/qpdf.js';
  sc.onload = res; sc.onerror = () => rej(new Error('復号ライブラリを読み込めませんでした'));
  document.head.appendChild(sc);
});
function isEncrypted(bytes) {
  const dec = new TextDecoder('latin1');
  const n = 16384;
  return dec.decode(bytes.subarray(0, n)).includes('/Encrypt') || dec.decode(bytes.subarray(Math.max(0, bytes.length - n))).includes('/Encrypt');
}
function askPassword(name, retry) {
  return new Promise(resolve => {
    const m = $('#pwmask'), inp = $('#pw-input');
    $('#pw-name').textContent = name;
    $('#pw-err').hidden = !retry;
    inp.value = ''; m.hidden = false; inp.focus();
    const done = v => { m.hidden = true; $('#pw-ok').onclick = $('#pw-cancel').onclick = inp.onkeydown = null; resolve(v); };
    $('#pw-ok').onclick = () => done(inp.value);
    $('#pw-cancel').onclick = () => done(null);
    inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value); else if (e.key === 'Escape') done(null); };
  });
}
async function decryptPdf(bytes, name) {
  await loadQpdf();
  let pw = '', retry = false;
  for (;;) {
    const msgs = [];
    const q = await Module({ locateFile: () => '../vendor/qpdf.wasm', print: s => msgs.push(s), printErr: s => msgs.push(s) });
    q.FS.writeFile('/in.pdf', bytes);
    const code = q.callMain([`--password=${pw}`, '--decrypt', '/in.pdf', '/out.pdf']);
    if (code === 0 || code === 3) return q.FS.readFile('/out.pdf').slice();   // 3 = 警告のみ
    // 終了コード2はエラー。printErrが効かない版があるため、メッセージが取れた場合のみ内容で判別する
    if (code !== 2 || (msgs.length && !msgs.some(m => /invalid password/i.test(m)))) throw new Error('PDFの復号に失敗しました');
    // 空パスワードで開けない = 開くときのパスワードが必要
    const v = await askPassword(name, retry);
    if (v === null) throw new Error('パスワード入力をキャンセルしました');
    pw = v; retry = true;
  }
}

async function loadSource(file) {
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (isEncrypted(bytes)) {
    bytes = await decryptPdf(bytes, file.name);
    toast('パスワードを解除して開きました（保存したPDFにはパスワードは付きません）');
  }
  let doc;
  try { doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise; }
  catch (err) { throw new Error('PDFを読み込めませんでした'); }
  const si = S.sources.push({ bytes, doc, name: file.name }) - 1;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n), v = pg.view;
    pages.push({ id: nid(), src: si, num: n, r0: (((pg.rotate || 0) % 360) + 360) % 360, rot: 0, box: v, w0: v[2] - v[0], h0: v[3] - v[1], objs: [] });
  }
  return pages;
}

function resetDoc(pages, name) {
  endEdit(true);
  S.pages = pages; S.sel = null; S.selPages.clear(); S.cur = 0;
  S.undo = []; S.redo = []; S.lastKey = null; S.dirty = false; S.name = name;
  pageEls = new Map();
  updateUndoBtns();
  fitWidth(true);
  refreshAll();
  setTool('select');
}

async function openFile(file) {
  if (S.dirty && !confirm('未保存の変更があります。破棄して開きますか？')) return;
  await busy(async () => {
    S.sources = [];
    const pages = await loadSource(file);
    resetDoc(pages, file.name.replace(/\.pdf$/i, ''));
  });
}
async function addFiles(files) {
  if (!S.pages.length) return openFile(files[0]);
  await busy(async () => {
    const all = [];
    for (const f of files) all.push(...await loadSource(f));
    pushUndo();
    S.pages.push(...all);
    refreshAll();
    toast(`${all.length}ページを追加しました`);
  });
}
function newBlank() {
  S.sources = [];
  resetDoc([{ id: nid(), src: -1, num: 0, r0: 0, rot: 0, w0: 595.28, h0: 841.89, box: null, objs: [] }], '新規');
}

async function insertImage(file) {
  if (!S.pages.length) return toast('先にPDFを開いてください', true);
  await busy(async () => {
    let bytes, mime = file.type;
    const bmp = await createImageBitmap(file);
    if (mime === 'image/png' || mime === 'image/jpeg') bytes = new Uint8Array(await file.arrayBuffer());
    else {
      const c = el('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      bytes = new Uint8Array(await blob.arrayBuffer()); mime = 'image/png';
    }
    const aid = nid();
    S.assets.set(aid, { bytes, mime, url: URL.createObjectURL(new Blob([bytes], { type: mime })) });
    const p = S.pages[S.cur], { w: pw, h: ph } = vsize(p);
    let w = bmp.width * 0.75, h = bmp.height * 0.75;
    const f = Math.min(1, (pw * 0.6) / w, (ph * 0.6) / h); w *= f; h *= f;
    pushUndo();
    const o = { id: nid(), type: 'image', asset: aid, x: (pw - w) / 2, y: (ph - h) / 2, w, h, ...clone(DEF.image) };
    p.objs.push(o);
    setTool('select'); select(p, o);
  });
}

let fontCache = {};
async function loadFontBytes(bold) {
  const k = bold ? 'b' : 'r';
  if (!fontCache[k]) fontCache[k] = await (await fetch(`../fonts/BIZUDPGothic-${bold ? 'Bold' : 'Regular'}.ttf`)).arrayBuffer();
  return fontCache[k];
}
const hex = h => { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

async function exportPdf(pages) {
  const out = await PDFDocument.create();
  out.registerFontkit(window.fontkit?.default || window.fontkit);
  const libDocs = new Map(), fonts = {}, imgs = new Map();
  const getFont = async bold => fonts[bold] ||= await out.embedFont(await loadFontBytes(bold), { subset: false });

  for (const p of pages) {
    const { w: vw, h: vh } = vsize(p);
    const page = out.addPage([vw, vh]);
    if (p.src >= 0) {
      if (!libDocs.has(p.src)) libDocs.set(p.src, await PDFDocument.load(S.sources[p.src].bytes, { ignoreEncryption: true }));
      const sp = libDocs.get(p.src).getPage(p.num - 1);
      const [l, b, r, t] = p.box;
      const emb = await out.embedPage(sp, { left: l, bottom: b, right: r, top: t });
      const tr = total(p);
      const pos = { 0: [0, 0], 90: [0, p.w0], 180: [p.w0, p.h0], 270: [p.h0, 0] }[tr];
      const rot = { 0: 0, 90: -90, 180: 180, 270: 90 }[tr];
      page.drawPage(emb, { x: pos[0], y: pos[1], rotate: degrees(rot) });
    }
    for (const o of p.objs) {
      const Y = y => vh - y;
      const stroke = o.sw > 0 ? hex(o.stroke || '#000000') : undefined;
      switch (o.type) {
        case 'text': {
          const font = await getFont(!!o.bold);
          const cs = new Set(font.getCharacterSet());
          const lines = o.text.split('\n').map(l => [...l].filter(c => cs.has(c.codePointAt(0))).join(''));
          const fs = o.fs, lh = fs * LH;
          const widths = lines.map(l => font.widthOfTextAtSize(l, fs));
          const bw = Math.max(0, ...widths) + PAD * 2, bh = lines.length * lh + PAD * 2;
          if (o.bg) page.drawRectangle({ x: o.x, y: Y(o.y + bh), width: bw, height: bh, color: hex(o.bg), opacity: o.op });
          lines.forEach((l, i) => {
            if (!l) return;
            const off = o.align === 'center' ? (bw - PAD * 2 - widths[i]) / 2 : o.align === 'right' ? bw - PAD * 2 - widths[i] : 0;
            const base = o.y + PAD + i * lh + (lh - (FM.asc + FM.desc) * fs) / 2 + FM.asc * fs;
            page.drawText(l, { x: o.x + PAD + off, y: Y(base), size: fs, font, color: hex(o.color), opacity: o.op });
          });
          break;
        }
        case 'image': {
          const a = S.assets.get(o.asset);
          if (!imgs.has(o.asset)) imgs.set(o.asset, a.mime === 'image/png' ? await out.embedPng(a.bytes) : await out.embedJpg(a.bytes));
          page.drawImage(imgs.get(o.asset), { x: o.x, y: Y(o.y + o.h), width: o.w, height: o.h, opacity: o.op });
          break;
        }
        case 'rect': case 'hl':
          if (!o.fill && !stroke) break;
          page.drawRectangle({ x: o.x, y: Y(o.y + o.h), width: o.w, height: o.h, color: o.fill ? hex(o.fill) : undefined, opacity: o.op, borderColor: stroke, borderWidth: stroke ? o.sw : 0, borderOpacity: o.op });
          break;
        case 'ellipse':
          if (!o.fill && !stroke) break;
          page.drawEllipse({ x: o.x + o.w / 2, y: Y(o.y + o.h / 2), xScale: o.w / 2, yScale: o.h / 2, color: o.fill ? hex(o.fill) : undefined, opacity: o.op, borderColor: stroke, borderWidth: stroke ? o.sw : 0, borderOpacity: o.op });
          break;
        case 'line': case 'arrow': {
          let [x2, y2] = [o.x2, o.y2], g = null;
          if (o.type === 'arrow') { g = arrowGeom(o); [x2, y2] = g.end; }
          page.drawLine({ start: { x: o.x1, y: Y(o.y1) }, end: { x: x2, y: Y(y2) }, thickness: o.sw, color: hex(o.stroke), opacity: o.op, lineCap: LineCapStyle.Round });
          if (g) page.drawSvgPath(`M ${g.head[0].join(' ')} L ${g.head[1].join(' ')} L ${g.head[2].join(' ')} Z`, { x: 0, y: vh, color: hex(o.stroke), opacity: o.op });
          break;
        }
        case 'pen':
          page.drawSvgPath(penPath(o.pts), { x: 0, y: vh, borderColor: hex(o.stroke), borderWidth: o.sw, borderOpacity: o.op, borderLineCap: LineCapStyle.Round });
          break;
      }
    }
  }
  return out.save();
}

function download(bytes, name) {
  const a = el('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function save(partial) {
  if (!S.pages.length) return;
  endEdit();
  const pages = partial ? targetPages() : S.pages;
  await busy(async () => {
    const bytes = await exportPdf(pages);
    download(bytes, `${S.name}${partial ? '-part' : '-edited'}.pdf`);
    if (!partial) S.dirty = false;
    toast(`${pages.length}ページを書き出しました`);
  });
}

/* ---------------- UI補助 ---------------- */
async function busy(fn) {
  $('#busy').hidden = false;
  try { await fn(); } catch (err) { console.error(err); toast(err.message || String(err), true); }
  finally { $('#busy').hidden = true; }
}
let toastT;
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, err ? 5000 : 2500);
}

function fitWidth(noRebuild) {
  if (!S.pages.length) return;
  const mw = Math.max(...S.pages.map(p => vsize(p).w));
  S.zoom = clamp((stage.clientWidth - 90) / mw, 0.3, 2.5);
  if (!noRebuild) refreshAll();
}
let zoomRaf = 0, zoomTarget = 0;
function setZoom(z) {
  zoomTarget = clamp(z, 0.25, 4);
  if (zoomRaf) return;
  zoomRaf = requestAnimationFrame(() => { zoomRaf = 0; S.zoom = zoomTarget; refreshAll(); });
}

$('#top').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act);
});
$('#empty').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act);
});
function act(a) {
  switch (a) {
    case 'open': $('#f-open').click(); break;
    case 'add': $('#f-add').click(); break;
    case 'new': newBlank(); break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'zoomin': setZoom(S.zoom * 1.2); break;
    case 'zoomout': setZoom(S.zoom / 1.2); break;
    case 'fit': fitWidth(); break;
    case 'save': save(false); break;
    case 'savesel': save(true); break;
  }
}
$('#f-open').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) openFile(f); };
$('#f-add').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) addFiles(fs); };
$('#f-img').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) insertImage(f); };

stage.addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  setZoom((zoomRaf ? zoomTarget : S.zoom) * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });

let scrollRaf = 0;
stage.addEventListener('scroll', () => {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    const r = stage.getBoundingClientRect(), mid = r.top + r.height / 2;
    let best = 0, bd = Infinity;
    S.pages.forEach((p, i) => {
      const b = pageEls.get(p.id)?.wrap.getBoundingClientRect(); if (!b) return;
      const d = Math.abs((b.top + b.bottom) / 2 - mid) - (b.top <= mid && b.bottom >= mid ? 1e9 : 0);
      if (d < bd) { bd = d; best = i; }
    });
    setCur(best);
  });
});

/* ファイルのドラッグ&ドロップ */
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; $('#dropmask').hidden = false; } });
window.addEventListener('dragleave', e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; $('#dropmask').hidden = true; } });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', async e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $('#dropmask').hidden = true;
  const files = [...e.dataTransfer.files];
  const pdfs = files.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (pdfs.length) await addFiles(pdfs);
  for (const f of files.filter(f => f.type.startsWith('image/'))) await insertImage(f);
});

/* クリップボード */
window.addEventListener('paste', e => {
  if (S.editing || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  const img = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
  if (img) { e.preventDefault(); insertImage(img); return; }
  if (S.clip && S.pages.length) {
    const p = S.pages[S.cur]; pushUndo();
    const c = clone(S.clip); c.id = nid(); translate(c, clone(c), 16, 16); S.clip = clone(c);
    p.objs.push(c); select(p, c);
  }
});

/* キーボード */
window.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  const typing = S.editing || /INPUT|TEXTAREA|SELECT/.test(tag);
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); return; }
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#f-open').click(); return; }
  if (typing && !(mod && ['z', 'y'].includes(e.key.toLowerCase()) && !S.editing)) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); return; }
  if (mod && e.key.toLowerCase() === 'c') { const s = getSel(); if (s) S.clip = clone(s.o); return; }
  if (mod) return;
  const s = getSel();
  if ((e.key === 'Delete' || e.key === 'Backspace') && s) { e.preventDefault(); deleteSel(); return; }
  if (e.key === 'Escape') { if (S.tool !== 'select') setTool('select'); else deselect(); return; }
  if (s && e.key.startsWith('Arrow')) {
    e.preventDefault();
    const st = e.shiftKey ? 10 : 1;
    const dx = { ArrowLeft: -st, ArrowRight: st }[e.key] || 0, dy = { ArrowUp: -st, ArrowDown: st }[e.key] || 0;
    pushUndo('nudge' + s.o.id); translate(s.o, clone(s.o), dx, dy); renderOverlay(s.p); return;
  }
  const t = TOOLS.find(t => t[2].toLowerCase() === e.key.toLowerCase());
  if (t && S.pages.length) { t[0] === 'image' ? $('#f-img').click() : setTool(t[0]); }
});

window.addEventListener('beforeunload', e => { if (S.dirty) e.preventDefault(); });
window.addEventListener('resize', () => { /* ズームは維持 */ });

/* ---------------- 起動 ---------------- */
function measureFont() {
  const c = el('canvas').getContext('2d');
  c.font = '400 100px "BIZ UDPGothic"';
  const m = c.measureText('あ');
  if (m.fontBoundingBoxAscent) { FM.asc = m.fontBoundingBoxAscent / 100; FM.desc = m.fontBoundingBoxDescent / 100; }
}
buildTools();
setTool('select');
updateUndoBtns();
Promise.all([document.fonts.load('400 20px "BIZ UDPGothic"', 'あA'), document.fonts.load('700 20px "BIZ UDPGothic"', 'あA')])
  .catch(() => { })
  .then(() => { measureFont(); S.pages.forEach(renderOverlay); });
