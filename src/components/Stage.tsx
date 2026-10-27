import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { total } from '../geom'
import { useFlip } from '../hooks'
import { stageDoubleClick, stagePointerDown } from '../interaction'
import { pendingZoom, set, setCur, setZoom, useStore } from '../store'
import { PageView } from './PageView'
import { ScrollRoot } from './PdfCanvas'

export function Stage() {
  const pages = useStore(s => s.pages)
  const zoom = useStore(s => s.zoom)
  const tool = useStore(s => s.tool)
  const sel = useStore(s => s.sel)
  const editing = useStore(s => s.editing)
  const scrollReq = useStore(s => s.scrollReq)
  const [el, setEl] = useState<HTMLElement | null>(null)
  // 拡大縮小・ページ増減のあとも「この点」が同じ位置に見えるよう、基準点を覚えておく
  const anchor = useRef<{ fx: number; fy: number; cx: number; cy: number } | null>(null)
  const setAnchor = (cx: number, cy: number) => {
    if (!el || !el.scrollWidth || !el.scrollHeight) return
    anchor.current = { fx: (el.scrollLeft + cx) / el.scrollWidth, fy: (el.scrollTop + cy) / el.scrollHeight, cx, cy }
  }

  // ステージ幅(幅に合わせる用)
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(() => set({ stageW: el.clientWidth }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])

  // Ctrl+ホイールで拡大縮小
  useEffect(() => {
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      setAnchor(e.clientX - r.left, e.clientY - r.top)
      setZoom(pendingZoom() * (e.deltaY < 0 ? 1.1 : 1 / 1.1))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [el])

  const sig = useMemo(() => zoom + '|' + pages.map(p => p.id + ':' + total(p)).join(','), [zoom, pages])
  useLayoutEffect(() => {
    const a = anchor.current
    if (!el || !a) return
    el.scrollTop = a.fy * el.scrollHeight - a.cy
    el.scrollLeft = a.fx * el.scrollWidth - a.cx
  }, [el, sig])
  useFlip(el, '.pgwrap', sig, zoom)

  // スクロール位置から現在ページを決める
  const raf = useRef(0)
  const onScroll = () => {
    if (!el) return
    setAnchor(el.clientWidth / 2, el.clientHeight / 2)
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      const r = el.getBoundingClientRect(), mid = r.top + r.height / 2
      let best = 0, bd = Infinity
      el.querySelectorAll<HTMLElement>('.pgwrap').forEach((w, i) => {
        const b = w.getBoundingClientRect()
        const d = Math.abs((b.top + b.bottom) / 2 - mid) - (b.top <= mid && b.bottom >= mid ? 1e9 : 0)
        if (d < bd) { bd = d; best = i }
      })
      setCur(best)
    })
  }

  // サムネイルのクリックなどによる「このページへ移動」
  useEffect(() => {
    if (!el || !scrollReq) return
    const w = el.querySelector<HTMLElement>(`.pgwrap[data-pid="${scrollReq.pid}"]`)
    if (w) el.scrollTo({ top: w.offsetTop - 24, behavior: 'smooth' })
  }, [el, scrollReq])

  return (
    <section id="stage" ref={setEl} className={'tool-' + tool} onScroll={onScroll} onPointerDown={stagePointerDown} onDoubleClick={stageDoubleClick}>
      <ScrollRoot.Provider value={el}>
        <div id="pgs">
          {pages.map(p => (
            <PageView
              key={p.id} page={p} zoom={zoom}
              selOid={sel?.pid === p.id ? sel.oid : null}
              editingOid={editing?.pid === p.id ? editing.oid : null}
            />
          ))}
        </div>
      </ScrollRoot.Provider>
    </section>
  )
}
