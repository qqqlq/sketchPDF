import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { vsize, total } from '../geom'
import { useFlip } from '../hooks'
import {
  addBlankPage, clickThumb, deletePages, duplicatePages, movePages, rotatePages, selectAllPages, useStore,
} from '../store'
import type { Page } from '../types'
import { ObjView } from './ObjView'
import { PdfCanvas, ScrollRoot } from './PdfCanvas'

type Drop = { id: string; after: boolean } | null

const Thumb = memo(function Thumb({ page, index, sel, cur, drop, onDragStart, onDragOver }: {
  page: Page; index: number; sel: boolean; cur: boolean; drop: 'before' | 'after' | null
  onDragStart: (id: string, e: React.DragEvent) => void; onDragOver: (id: string, e: React.DragEvent) => void
}) {
  const { w, h } = vsize(page)
  const tw = 118, th = Math.min(170, tw * h / w), tw2 = th === 170 ? 170 * w / h : tw
  const cls = 'th' + (sel ? ' sel' : '') + (cur ? ' cur' : '') + (drop ? ' drop' + drop : '')
  return (
    <div
      className={cls} data-pid={page.id} draggable
      onClick={e => clickThumb(page.id, e.ctrlKey || e.metaKey, e.shiftKey)}
      onDragStart={e => onDragStart(page.id, e)} onDragOver={e => onDragOver(page.id, e)}
    >
      <div className="tc">
        <div className="tbox" style={{ width: tw2, height: th }}>
          <PdfCanvas src={page.src} num={page.num} rot={total(page)} vw={w} vh={h} zoom={tw2 / w} margin={400} />
          <div className="inner ov" style={{ width: w, height: h, transform: `scale(${tw2 / w})` }}>
            {page.objs.map(o => <ObjView key={o.id} pid={page.id} o={o} editing={false} />)}
          </div>
        </div>
      </div>
      <div className="num">{index + 1}</div>
    </div>
  )
})

export function PageList() {
  const pages = useStore(s => s.pages)
  const selPages = useStore(s => s.selPages)
  const cur = useStore(s => s.cur)
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [drop, setDrop] = useState<Drop>(null)
  const dragIds = useRef<string[] | null>(null)

  const sig = useMemo(() => pages.map(p => p.id + ':' + total(p)).join(','), [pages])
  useFlip(el, '.th', sig, 0)

  // 現在ページのサムネイルが見える位置までリストを動かす
  useEffect(() => {
    el?.querySelectorAll('.th')[cur]?.scrollIntoView({ block: 'nearest' })
  }, [el, cur])

  const onDragStart = (id: string, e: React.DragEvent) => {
    dragIds.current = selPages.includes(id) ? pages.filter(p => selPages.includes(p.id)).map(p => p.id) : [id]
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'pages')
  }
  const onDragOver = (id: string, e: React.DragEvent) => {
    if (!dragIds.current) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    const after = e.clientY > r.top + r.height / 2
    setDrop(d => d && d.id === id && d.after === after ? d : { id, after })
  }
  const end = () => { dragIds.current = null; setDrop(null) }

  return (
    <aside id="pages">
      <div className="phead">
        <button className="mini" title="選択ページを右に90°回転" onClick={rotatePages}>⟳</button>
        <button className="mini" title="複製" onClick={duplicatePages}>⧉</button>
        <button className="mini" title="空白ページを挿入" onClick={addBlankPage}>＋</button>
        <button className="mini" title="削除" onClick={deletePages}>🗑</button>
        <button className="mini" title="全選択" onClick={selectAllPages}>全</button>
      </div>
      <ScrollRoot.Provider value={el}>
        <div
          id="thumbs" ref={setEl}
          onDrop={e => {
            if (!dragIds.current) return
            e.preventDefault()
            if (drop) movePages(dragIds.current, drop.id, drop.after)
            end()
          }}
          onDragEnd={end}
        >
          {pages.map((p, i) => (
            <Thumb
              key={p.id} page={p} index={i} sel={selPages.includes(p.id)} cur={i === cur}
              drop={drop?.id === p.id ? (drop.after ? 'after' : 'before') : null}
              onDragStart={onDragStart} onDragOver={onDragOver}
            />
          ))}
        </div>
      </ScrollRoot.Provider>
    </aside>
  )
}
