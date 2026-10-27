import { useSyncExternalStore } from 'react'
import { clamp, rotObjCW, translate, vsize } from './geom'
import { assets, loadSource, registerImage, resetSources } from './docs'
import { exportPdf } from './exportPdf'
import { nid } from './uid'
import type { Defaults, Obj, Page, Sel, ToolId } from './types'

/* ---------------- 状態 ---------------- */
interface Snap { pages: Page[]; sel: Sel | null }

export interface State {
  pages: Page[]
  sel: Sel | null
  selPages: string[]
  cur: number
  tool: ToolId
  zoom: number
  stageW: number
  undo: Snap[]
  redo: Snap[]
  dirty: boolean
  editing: Sel | null
  clip: Obj | null
  name: string
  defs: Defaults
  busy: boolean
  toast: { id: number; msg: string; err: boolean } | null
  password: { name: string; retry: boolean } | null
  /** ステージに「このページへスクロールして」と伝えるリクエスト */
  scrollReq: { id: number; pid: string } | null
  /** 日本語フォントの読み込み・実測が終わるたびに増える(テキストの寸法を測り直す合図) */
  fontEpoch: number
}

const initialDefs = (): Defaults => ({
  text: { fs: 24, color: '#222222', align: 'left', bold: false, bg: null, op: 1 },
  rect: { fill: '#7c3aed', stroke: '#1f2430', sw: 0, op: 1 },
  ellipse: { fill: '#f59e0b', stroke: '#1f2430', sw: 0, op: 1 },
  hl: { fill: '#ffe600', stroke: '#1f2430', sw: 0, op: 0.4 },
  line: { stroke: '#e11d48', sw: 3, op: 1 },
  arrow: { stroke: '#e11d48', sw: 3, op: 1 },
  pen: { stroke: '#e11d48', sw: 3, op: 1 },
  image: { op: 1 },
})

let state: State = {
  pages: [], sel: null, selPages: [], cur: 0, tool: 'select', zoom: 1.2, stageW: 900,
  undo: [], redo: [], dirty: false, editing: null, clip: null, name: 'document',
  defs: initialDefs(), busy: false, toast: null, password: null, scrollReq: null, fontEpoch: 0,
}
const listeners = new Set<() => void>()
export const getState = () => state
export function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  listeners.forEach(l => l())
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useStore = <T,>(selector: (s: State) => T): T => useSyncExternalStore(subscribe, () => selector(state))

/* ---------------- 参照ヘルパー ---------------- */
export const pageById = (id: string, s = state) => s.pages.find(p => p.id === id)
export const pageIndex = (id: string, s = state) => s.pages.findIndex(p => p.id === id)

export function getSel(s = state) {
  if (!s.sel) return null
  const p = pageById(s.sel.pid, s), o = p?.objs.find(x => x.id === s.sel!.oid)
  return p && o ? { p, o } : null
}

/** プロパティパネルが対象にしているもの(選択中オブジェクト、または次に描くツールの既定値) */
export function propTarget(s: State): { obj: Obj | null; type: keyof Defaults; pid?: string } | null {
  const sel = getSel(s)
  if (sel) return { obj: sel.o, type: sel.o.type, pid: sel.p.id }
  if (s.tool !== 'select' && s.tool !== 'image') return { obj: null, type: s.tool }
  return null
}

function mapObj(pid: string, oid: string, fn: (o: Obj) => Obj): Page[] {
  return state.pages.map(p => p.id !== pid ? p : { ...p, objs: p.objs.map(o => o.id === oid ? fn(o) : o) })
}
/** Undo履歴に積まずにオブジェクトを差し替える(ドラッグ中・テキスト入力中など) */
export function patchObj(pid: string, oid: string, fn: (o: Obj) => Obj) {
  set({ pages: mapObj(pid, oid, fn) })
}
function mapPage(pid: string, fn: (p: Page) => Page): Page[] {
  return state.pages.map(p => p.id === pid ? fn(p) : p)
}

/* ---------------- Undo / Redo ---------------- */
let lastKey: string | null = null, lastT = 0
const snapshot = (): Snap => ({ pages: state.pages, sel: state.sel })

export function pushUndo(key?: string) {
  const now = Date.now()
  if (key && key === lastKey && now - lastT < 1200) { lastT = now; set({ dirty: true }); return }
  const undo = [...state.undo, snapshot()]
  if (undo.length > 100) undo.shift()
  lastKey = key || null; lastT = now
  set({ undo, redo: [], dirty: true })
}

function restore(snap: Snap, undo: Snap[], redo: Snap[]) {
  endEdit()
  let sel = snap.sel
  if (sel && !snap.pages.find(p => p.id === sel!.pid)?.objs.some(o => o.id === sel!.oid)) sel = null
  lastKey = null
  set({
    pages: snap.pages, sel, undo, redo, dirty: true,
    selPages: state.selPages.filter(id => snap.pages.some(p => p.id === id)),
    cur: clamp(state.cur, 0, Math.max(0, snap.pages.length - 1)),
  })
}
export function undo() {
  if (!state.undo.length) return
  const u = state.undo.slice(), snap = u.pop()!
  restore(snap, u, [...state.redo, snapshot()])
}
export function redo() {
  if (!state.redo.length) return
  const r = state.redo.slice(), snap = r.pop()!
  restore(snap, [...state.undo, snapshot()], r)
}

/* ---------------- UI補助 ---------------- */
let toastT: ReturnType<typeof setTimeout> | undefined, toastSeq = 0
export function toast(msg: string, err = false) {
  const id = ++toastSeq
  set({ toast: { id, msg, err } })
  clearTimeout(toastT)
  toastT = setTimeout(() => { if (state.toast?.id === id) set({ toast: null }) }, err ? 5000 : 2500)
}
export async function busy(fn: () => Promise<void>) {
  set({ busy: true })
  try { await fn() } catch (err) { console.error(err); toast(err instanceof Error ? err.message : String(err), true) }
  finally { set({ busy: false }) }
}

let pwResolve: ((v: string | null) => void) | null = null
const askPassword = (name: string, retry: boolean) => new Promise<string | null>(resolve => {
  pwResolve = resolve
  set({ password: { name, retry } })
})
export function answerPassword(v: string | null) {
  set({ password: null })
  pwResolve?.(v); pwResolve = null
}

/* ---------------- ツール / 選択 / 編集 ---------------- */
export function setTool(t: ToolId) {
  if (state.editing) endEdit()
  set({ tool: t, sel: t !== 'select' ? null : state.sel })
}

export function select(pid: string, oid: string) { set({ sel: { pid, oid } }) }
export function deselect() {
  if (state.editing) endEdit()
  set({ sel: null })
}

let editInit: string | null = null
export function startEdit(pid: string, oid: string) {
  endEdit()
  const o = pageById(pid)?.objs.find(x => x.id === oid)
  if (o?.type !== 'text') return
  pushUndo(); editInit = o.text
  set({ sel: { pid, oid }, editing: { pid, oid } })
}
export function endEdit() {
  const ed = state.editing
  if (!ed) return
  set({ editing: null })
  const o = pageById(ed.pid)?.objs.find(x => x.id === ed.oid)
  if (!o || o.type !== 'text') return
  if (!o.text.trim()) {
    set({ pages: mapPage(ed.pid, p => ({ ...p, objs: p.objs.filter(x => x.id !== ed.oid) })), sel: null })
  } else if (o.text === editInit && state.undo.length) {
    set({ undo: state.undo.slice(0, -1) })
  }
}
export function setText(pid: string, oid: string, text: string, w: number, h: number) {
  patchObj(pid, oid, o => o.type === 'text' ? { ...o, text, w, h } : o)
  set({ dirty: true })
}
/** 描画後に測った実寸を反映する(Undo履歴には載せない) */
export function setTextSize(pid: string, oid: string, w: number, h: number) {
  const o = pageById(pid)?.objs.find(x => x.id === oid)
  if (o?.type !== 'text' || (o.w === w && o.h === h)) return
  patchObj(pid, oid, x => x.type === 'text' ? { ...x, w, h } : x)
}

/* ---------------- プロパティ ---------------- */
export function setProp(k: string, val: unknown) {
  const t = propTarget(state); if (!t) return
  if (t.obj && t.pid) {
    pushUndo('p:' + k + t.obj.id)
    patchObj(t.pid, t.obj.id, o => ({ ...o, [k]: val }) as Obj)
  }
  set({ defs: { ...state.defs, [t.type]: { ...state.defs[t.type], [k]: val } } })
}

export function deleteSel() {
  const s = getSel(); if (!s) return
  pushUndo()
  set({ pages: mapPage(s.p.id, p => ({ ...p, objs: p.objs.filter(x => x.id !== s.o.id) })), sel: null })
}
export function duplicateSel() {
  const s = getSel(); if (!s) return
  pushUndo()
  const c = { ...translate(s.o, 14, 14), id: nid() } as Obj
  set({ pages: mapPage(s.p.id, p => ({ ...p, objs: [...p.objs, c] })), sel: { pid: s.p.id, oid: c.id } })
}
export function reorderSel(toFront: boolean) {
  const s = getSel(); if (!s) return
  pushUndo()
  set({ pages: mapPage(s.p.id, p => {
    const rest = p.objs.filter(x => x.id !== s.o.id)
    return { ...p, objs: toFront ? [...rest, s.o] : [s.o, ...rest] }
  }) })
}
export function copySel() { const s = getSel(); if (s) set({ clip: s.o }) }
export function pasteClip() {
  const { clip, pages, cur } = state
  if (!clip || !pages.length) return
  const p = pages[cur]; pushUndo()
  const c = { ...translate(clip, 16, 16), id: nid() } as Obj
  set({ clip: c, pages: mapPage(p.id, q => ({ ...q, objs: [...q.objs, c] })), sel: { pid: p.id, oid: c.id } })
}
export function nudgeSel(dx: number, dy: number) {
  const s = getSel(); if (!s) return
  pushUndo('nudge' + s.o.id)
  patchObj(s.p.id, s.o.id, o => translate(o, dx, dy))
}

/* ---------------- ページ・表示 ---------------- */
export function setCur(i: number, scroll = false) {
  const { pages } = state
  if (i < 0 || i >= pages.length) return
  set({ cur: i, ...(scroll ? { scrollReq: { id: (state.scrollReq?.id ?? 0) + 1, pid: pages[i].id } } : {}) })
}

export function targetPages(s = state) {
  return s.selPages.length ? s.pages.filter(p => s.selPages.includes(p.id)) : [s.pages[s.cur]].filter(Boolean)
}

export function clickThumb(id: string, ctrl: boolean, shift: boolean) {
  const { selPages, pages } = state, i = pageIndex(id)
  let next: string[]
  if (ctrl) next = selPages.includes(id) ? selPages.filter(x => x !== id) : [...selPages, id]
  else if (shift && selPages.length) {
    const last = pageIndex(selPages[selPages.length - 1])
    const [a, b] = [Math.min(last, i), Math.max(last, i)]
    next = pages.slice(a, b + 1).map(p => p.id)
  } else next = [id]
  set({ selPages: next })
  setCur(i, true)
}

export function selectAllPages() { set({ selPages: state.pages.map(p => p.id) }) }

export function rotatePages() {
  if (!state.pages.length) return
  const ids = new Set(targetPages().map(p => p.id)); pushUndo()
  set({ pages: state.pages.map(p => {
    if (!ids.has(p.id)) return p
    const { h } = vsize(p)
    return { ...p, rot: (p.rot + 90) % 360, objs: p.objs.map(o => rotObjCW(o, h)) }
  }) })
}
export function deletePages() {
  if (!state.pages.length) return
  const tg = targetPages()
  if (tg.length >= state.pages.length) return toast('最後の1ページは削除できません', true)
  pushUndo()
  const ids = new Set(tg.map(p => p.id))
  const pages = state.pages.filter(p => !ids.has(p.id))
  set({
    pages, selPages: [], sel: state.sel && ids.has(state.sel.pid) ? null : state.sel,
    cur: clamp(state.cur, 0, pages.length - 1),
  })
}
export function duplicatePages() {
  if (!state.pages.length) return
  const tg = targetPages(); pushUndo()
  const last = state.pages.indexOf(tg[tg.length - 1])
  const copies = tg.map(p => ({ ...p, id: nid(), objs: p.objs.map(o => ({ ...o, id: nid() }) as Obj) }))
  const pages = [...state.pages]
  pages.splice(last + 1, 0, ...copies)
  set({ pages })
}
export function addBlankPage() {
  if (!state.pages.length) return
  pushUndo()
  const { w, h } = vsize(state.pages[state.cur])
  const page: Page = { id: nid(), src: -1, num: 0, r0: 0, rot: 0, w0: w, h0: h, box: null, objs: [] }
  const pages = [...state.pages]
  pages.splice(state.cur + 1, 0, page)
  set({ pages })
  setCur(state.cur + 1, true)
}
export function movePages(ids: string[], targetId: string, after: boolean) {
  if (ids.includes(targetId)) return
  pushUndo()
  const moving = state.pages.filter(p => ids.includes(p.id))
  const rest = state.pages.filter(p => !ids.includes(p.id))
  const idx = rest.findIndex(p => p.id === targetId) + (after ? 1 : 0)
  rest.splice(idx, 0, ...moving)
  set({ pages: rest, cur: rest.findIndex(p => p.id === ids[0]) })
}

/* ---------------- ズーム ---------------- */
export function fitWidth() {
  const { pages, stageW } = state
  if (!pages.length) return
  const mw = Math.max(...pages.map(p => vsize(p).w))
  set({ zoom: clamp((stageW - 90) / mw, 0.3, 2.5) })
}
let zoomRaf = 0, zoomTarget = 0
export function setZoom(z: number) {
  zoomTarget = clamp(z, 0.25, 4)
  if (zoomRaf) return
  zoomRaf = requestAnimationFrame(() => { zoomRaf = 0; set({ zoom: zoomTarget }) })
}
export const pendingZoom = () => zoomRaf ? zoomTarget : state.zoom

/* ---------------- ファイル入出力 ---------------- */
function resetDoc(pages: Page[], name: string) {
  endEdit()
  lastKey = null
  set({
    pages, sel: null, selPages: [], cur: 0, undo: [], redo: [], dirty: false, name, tool: 'select', editing: null,
    scrollReq: { id: (state.scrollReq?.id ?? 0) + 1, pid: pages[0].id },
  })
  fitWidth()
}

const load = (f: File) => loadSource(f, askPassword, () => toast('パスワードを解除して開きました（保存したPDFにはパスワードは付きません）'))

export async function openFile(file: File) {
  if (state.dirty && !confirm('未保存の変更があります。破棄して開きますか？')) return
  await busy(async () => {
    resetSources()
    const pages = await load(file)
    resetDoc(pages, file.name.replace(/\.pdf$/i, ''))
  })
}
export async function addFiles(files: File[]) {
  if (!state.pages.length) return openFile(files[0])
  await busy(async () => {
    const all: Page[] = []
    for (const f of files) all.push(...await load(f))
    pushUndo()
    set({ pages: [...state.pages, ...all] })
    toast(`${all.length}ページを追加しました`)
  })
}
export function newBlank() {
  resetSources()
  resetDoc([{ id: nid(), src: -1, num: 0, r0: 0, rot: 0, w0: 595.28, h0: 841.89, box: null, objs: [] }], '新規')
}

export async function insertImage(file: File) {
  if (!state.pages.length) return toast('先にPDFを開いてください', true)
  await busy(async () => {
    const { id: asset, width, height } = await registerImage(file)
    const p = state.pages[state.cur], { w: pw, h: ph } = vsize(p)
    let w = width * 0.75, h = height * 0.75
    const f = Math.min(1, (pw * 0.6) / w, (ph * 0.6) / h); w *= f; h *= f
    pushUndo()
    const o: Obj = { id: nid(), type: 'image', asset, x: (pw - w) / 2, y: (ph - h) / 2, w, h, ...state.defs.image }
    set({ pages: mapPage(p.id, q => ({ ...q, objs: [...q.objs, o] })), tool: 'select', sel: { pid: p.id, oid: o.id } })
  })
}

function download(bytes: Uint8Array, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' })); a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
export async function save(partial: boolean) {
  if (!state.pages.length) return
  endEdit()
  const pages = partial ? targetPages() : state.pages
  await busy(async () => {
    const bytes = await exportPdf(pages)
    download(bytes, `${state.name}${partial ? '-part' : '-edited'}.pdf`)
    if (!partial) set({ dirty: false })
    toast(`${pages.length}ページを書き出しました`)
  })
}

export const assetUrl = (id: string) => assets.get(id)?.url || ''
