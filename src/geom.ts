import { isLine, type Obj, type Page, type Pt } from './types'

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export const PAD = 4          // テキストの内側余白(pt)
export const LH = 1.3         // テキストの行間(em)
/** フォントのascent/descent(em)。起動時に実測して上書きする */
export const FM = { asc: 0.88, desc: 0.12 }

export const total = (p: Pick<Page, 'r0' | 'rot'>) => (((p.r0 + p.rot) % 360) + 360) % 360
export const vsize = (p: Pick<Page, 'r0' | 'rot' | 'w0' | 'h0'>) =>
  (total(p) % 180 ? { w: p.h0, h: p.w0 } : { w: p.w0, h: p.h0 })

export interface Box { x: number; y: number; w: number; h: number }

export function bbox(o: Obj): Box {
  switch (o.type) {
    case 'line': case 'arrow':
      return { x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) }
    case 'pen': {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const [x, y] of o.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    }
    case 'text': return { x: o.x, y: o.y, w: o.w || 40, h: o.h || 30 }
    default: return { x: o.x, y: o.y, w: o.w, h: o.h }
  }
}

/** orig を (dx,dy) だけ動かした新しいオブジェクトを返す */
export function translate(orig: Obj, dx: number, dy: number): Obj {
  if (isLine(orig)) {
    return { ...orig, x1: orig.x1 + dx, y1: orig.y1 + dy, x2: orig.x2 + dx, y2: orig.y2 + dy }
  }
  if (orig.type === 'pen') return { ...orig, pts: orig.pts.map(([x, y]): Pt => [x + dx, y + dy]) }
  return { ...orig, x: orig.x + dx, y: orig.y + dy }
}

/** ハンドル h を (dx,dy) 動かしたときの新しいオブジェクトを返す */
export function applyResize(orig: Obj, h: string, dx: number, dy: number): Obj {
  if (isLine(orig)) {
    return h === 'p1'
      ? { ...orig, x1: orig.x1 + dx, y1: orig.y1 + dy }
      : { ...orig, x2: orig.x2 + dx, y2: orig.y2 + dy }
  }
  const ob = bbox(orig)
  let x0 = ob.x, y0 = ob.y, x1 = ob.x + ob.w, y1 = ob.y + ob.h
  if (h.includes('w')) x0 += dx
  if (h.includes('e')) x1 += dx
  if (h.includes('n')) y0 += dy
  if (h.includes('s')) y1 += dy
  if (orig.type === 'text' || orig.type === 'image') {
    // 縦横比固定で拡縮(テキストはフォントサイズが変わる)
    const f = clamp(((x1 - x0) / ob.w + (y1 - y0) / ob.h) / 2, 0.05, 50)
    const w = ob.w * f, hh = ob.h * f
    const ax = h.includes('w') ? ob.x + ob.w : ob.x
    const ay = h.includes('n') ? ob.y + ob.h : ob.y
    const nx = h.includes('w') ? ax - w : ax
    const ny = h.includes('n') ? ay - hh : ay
    if (orig.type === 'text') return { ...orig, fs: Math.max(4, orig.fs * f), x: nx, y: ny }
    return { ...orig, x: nx, y: ny, w, h: hh }
  }
  const nx = Math.min(x0, x1), ny = Math.min(y0, y1)
  const nw = Math.max(2, Math.abs(x1 - x0)), nh = Math.max(2, Math.abs(y1 - y0))
  if (orig.type === 'pen') {
    const sx = ob.w ? nw / ob.w : 1, sy = ob.h ? nh / ob.h : 1
    return { ...orig, pts: orig.pts.map(([x, y]): Pt => [nx + (x - ob.x) * sx, ny + (y - ob.y) * sy]) }
  }
  return { ...orig, x: nx, y: ny, w: nw, h: nh }
}

/** ページを右に90°回すとき、表示座標のオブジェクトも追従させる。(W,H)は回転前の表示サイズ */
export function rotObjCW(o: Obj, H: number): Obj {
  const P = (x: number, y: number): Pt => [H - y, x]
  switch (o.type) {
    case 'line': case 'arrow': {
      const [x1, y1] = P(o.x1, o.y1), [x2, y2] = P(o.x2, o.y2)
      return { ...o, x1, y1, x2, y2 }
    }
    case 'pen': return { ...o, pts: o.pts.map(([x, y]) => P(x, y)) }
    case 'text': case 'image': {
      const w = o.w || 40, h = o.h || 30
      const [cx, cy] = P(o.x + w / 2, o.y + h / 2)
      return { ...o, x: cx - w / 2, y: cy - h / 2 }
    }
    default:
      return { ...o, w: o.h, h: o.w, x: H - (o.y + o.h), y: o.x }
  }
}

export function arrowGeom(o: { x1: number; y1: number; x2: number; y2: number; sw: number }) {
  const dx = o.x2 - o.x1, dy = o.y2 - o.y1, len = Math.hypot(dx, dy) || 1
  const ux = dx / len, uy = dy / len
  const hl = Math.min(len * 0.9, Math.max(10, o.sw * 4)), hw = hl * 0.5
  const bx = o.x2 - ux * hl, by = o.y2 - uy * hl
  return {
    end: [o.x2 - ux * hl * 0.8, o.y2 - uy * hl * 0.8] as Pt,
    head: [[o.x2, o.y2], [bx - uy * hw, by + ux * hw], [bx + uy * hw, by - ux * hw]] as Pt[],
  }
}

export const penPath = (pts: Pt[]) => pts.length === 1
  ? `M ${pts[0][0]} ${pts[0][1]} L ${pts[0][0] + 0.01} ${pts[0][1]}`
  : 'M ' + pts.map(p => `${p[0]} ${p[1]}`).join(' L ')
