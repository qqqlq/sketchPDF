import type { PointerEvent as RPointerEvent } from 'react'
import { applyResize, translate } from './geom'
import {
  deselect, endEdit, getSel, getState, insertImage, pageById, pageIndex, patchObj, pushUndo, select, set, setCur, setTool, startEdit,
} from './store'
import { pickImage } from './files'
import { nid } from './uid'
import type { Obj, Pt } from './types'

type Mode = 'move' | 'resize' | 'draw'
interface Drag {
  mode: Mode; pid: string; oid: string; wrap: HTMLElement
  start: { x: number; y: number }; orig: Obj; handle?: string; moved: boolean
}
let drag: Drag | null = null

function toPt(e: { clientX: number; clientY: number }, wrap: HTMLElement) {
  const r = wrap.getBoundingClientRect(), z = getState().zoom
  return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z }
}

export function pickAndInsertImage() {
  return pickImage().then(f => { if (f) insertImage(f) })
}

export function chooseTool(t: ReturnType<typeof getState>['tool']) {
  if (t === 'image') { pickAndInsertImage(); return }
  setTool(t)
}

export function stagePointerDown(e: RPointerEvent<HTMLElement>) {
  if (e.button !== 0) return
  const target = e.target as HTMLElement
  const wrap = target.closest<HTMLElement>('.pgwrap')
  if (!wrap) { if (getState().tool === 'select') deselect(); return }
  const p = pageById(wrap.dataset.pid!); if (!p) return
  setCur(pageIndex(p.id))
  if (getState().editing) {
    if (target.closest('.obj.editing')) return
    endEdit()
  }
  const pt = toPt(e, wrap)
  const hd = target.closest<HTMLElement>('.hd')
  const oe = target.closest<HTMLElement>('[data-oid]')
  const { tool, defs } = getState()

  if (tool === 'select') {
    if (hd && getSel()) return startDrag('resize', wrap, p.id, getSel()!.o, pt, hd.dataset.h)
    if (oe) {
      const o = p.objs.find(x => x.id === oe.dataset.oid)
      if (!o) return
      select(p.id, o.id)
      return startDrag('move', wrap, p.id, o, pt)
    }
    deselect()
    return
  }
  if (tool === 'text') {
    if (oe) {
      const o = p.objs.find(x => x.id === oe.dataset.oid)
      if (o?.type === 'text') { select(p.id, o.id); setTimeout(() => startEdit(p.id, o.id)); e.preventDefault(); return }
    }
    e.preventDefault()
    pushUndo()
    const o: Obj = { id: nid(), type: 'text', x: pt.x, y: pt.y, text: 'テキスト', ...defs.text }
    set({ pages: getState().pages.map(q => q.id === p.id ? { ...q, objs: [...q.objs, o] } : q) })
    setTool('select')
    select(p.id, o.id)
    setTimeout(() => startEdit(p.id, o.id))
    return
  }
  if (tool === 'image') return
  e.preventDefault()
  // 図形・線・ペンの描画開始
  pushUndo()
  const id = nid()
  let o: Obj
  if (tool === 'rect' || tool === 'ellipse' || tool === 'hl') o = { id, type: tool, ...defs[tool], x: pt.x, y: pt.y, w: 0, h: 0 }
  else if (tool === 'line' || tool === 'arrow') o = { id, type: tool, ...defs[tool], x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y }
  else o = { id, type: 'pen', ...defs.pen, pts: [[pt.x, pt.y]] }
  set({ pages: getState().pages.map(q => q.id === p.id ? { ...q, objs: [...q.objs, o] } : q) })
  startDrag('draw', wrap, p.id, o, pt)
}

export function stageDoubleClick(e: React.MouseEvent<HTMLElement>) {
  const target = e.target as HTMLElement
  const oe = target.closest<HTMLElement>('[data-oid]')
  if (!oe || getState().tool !== 'select') return
  const p = pageById(target.closest<HTMLElement>('.pgwrap')?.dataset.pid ?? '')
  const o = p?.objs.find(x => x.id === oe.dataset.oid)
  if (p && o?.type === 'text' && !getState().editing) startEdit(p.id, o.id)
}

function startDrag(mode: Mode, wrap: HTMLElement, pid: string, o: Obj, pt: { x: number; y: number }, handle?: string) {
  drag = { mode, pid, oid: o.id, wrap, start: pt, orig: o, handle, moved: mode === 'draw' }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd, { once: true })
}

function onDragMove(e: PointerEvent) {
  const d = drag; if (!d) return
  const cur = pageById(d.pid)?.objs.find(x => x.id === d.oid)
  if (!cur) return
  const pt = toPt(e, d.wrap)
  const dx = pt.x - d.start.x, dy = pt.y - d.start.y
  if (!d.moved) {
    if (Math.hypot(dx, dy) * getState().zoom < 3) return
    d.moved = true; pushUndo()
  }
  let next: Obj
  if (d.mode === 'move') next = translate(d.orig, dx, dy)
  else if (d.mode === 'resize') next = applyResize(d.orig, d.handle!, dx, dy)
  else next = drawStep(cur, d.start, pt, e.shiftKey)
  patchObj(d.pid, d.oid, () => next)
}

function drawStep(o: Obj, start: { x: number; y: number }, pt: { x: number; y: number }, shift: boolean): Obj {
  if (o.type === 'pen') {
    const last = o.pts[o.pts.length - 1]
    return Math.hypot(pt.x - last[0], pt.y - last[1]) >= 0.8 ? { ...o, pts: [...o.pts, [pt.x, pt.y] as Pt] } : o
  }
  if (o.type === 'line' || o.type === 'arrow') {
    let { x, y } = pt
    if (shift) {  // 45°刻み
      const a = Math.round(Math.atan2(y - o.y1, x - o.x1) / (Math.PI / 4)) * (Math.PI / 4), r = Math.hypot(x - o.x1, y - o.y1)
      x = o.x1 + Math.cos(a) * r; y = o.y1 + Math.sin(a) * r
    }
    return { ...o, x2: x, y2: y }
  }
  if (o.type === 'rect' || o.type === 'ellipse' || o.type === 'hl') {
    let w = pt.x - start.x, h = pt.y - start.y
    if (shift) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m }
    return { ...o, x: w < 0 ? start.x + w : start.x, y: h < 0 ? start.y + h : start.y, w: Math.abs(w), h: Math.abs(h) }
  }
  return o
}

function onDragEnd() {
  window.removeEventListener('pointermove', onDragMove)
  const d = drag; drag = null
  if (!d) return
  const o = pageById(d.pid)?.objs.find(x => x.id === d.oid)
  if (!o || d.mode !== 'draw') return
  let fixed: Obj = o
  if (o.type === 'line' || o.type === 'arrow') {
    if (Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 4) fixed = { ...o, x2: o.x1 + 120, y2: o.y1 }
  } else if (o.type === 'rect' || o.type === 'ellipse' || o.type === 'hl') {
    if (o.w < 4 && o.h < 4) {
      const [w, h] = { rect: [140, 90], ellipse: [100, 100], hl: [160, 22] }[o.type]
      fixed = { ...o, w, h }
    }
  }
  if (fixed !== o) patchObj(d.pid, d.oid, () => fixed)
  if (o.type !== 'pen' && o.type !== 'hl') { setTool('select'); select(d.pid, d.oid) }
}
