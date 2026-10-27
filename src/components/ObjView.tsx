import { memo, useLayoutEffect, useRef, type CSSProperties } from 'react'
import { arrowGeom, bbox, penPath } from '../geom'
import { assetUrl, endEdit, setText, setTextSize, useStore } from '../store'
import type { Obj, TextObj } from '../types'

const readText = (d: HTMLElement) => d.innerText.replace(/\n$/, '')

function TextView({ pid, o, editing }: { pid: string; o: TextObj; editing: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const fontEpoch = useStore(s => s.fontEpoch)

  // 非編集時はここでDOMへ反映する。編集中はcontentEditableのDOMが正なので触らない
  useLayoutEffect(() => {
    const d = ref.current!
    if (!editing && d.textContent !== o.text) d.textContent = o.text
  }, [o.text, editing])

  // 描画後の実寸(選択枠・ハンドル・回転で使う)
  useLayoutEffect(() => {
    const d = ref.current!
    setTextSize(pid, o.id, d.offsetWidth, d.offsetHeight)
  }, [pid, o.id, o.text, o.fs, o.bold, fontEpoch])

  useLayoutEffect(() => {
    if (!editing) return
    const d = ref.current!
    d.focus()
    const r = document.createRange(); r.selectNodeContents(d)
    const s = getSelection()!; s.removeAllRanges(); s.addRange(r)
  }, [editing])

  const style: CSSProperties = {
    left: o.x, top: o.y, fontSize: o.fs, color: o.color, textAlign: o.align,
    fontWeight: o.bold ? 700 : 400, opacity: o.op, background: o.bg || 'transparent',
  }
  return (
    <div
      ref={ref} className={'obj text' + (editing ? ' editing' : '')} data-oid={o.id} style={style}
      contentEditable={editing ? 'plaintext-only' : undefined} suppressContentEditableWarning
      onInput={editing ? e => setText(pid, o.id, readText(e.currentTarget), e.currentTarget.offsetWidth, e.currentTarget.offsetHeight) : undefined}
      onBlur={editing ? () => endEdit() : undefined}
      onKeyDown={editing ? e => { if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur() } } : undefined}
    />
  )
}

const Shape = ({ o }: { o: Exclude<Obj, { type: 'text' | 'image' }> }) => {
  switch (o.type) {
    case 'rect': case 'hl':
      return <rect x={o.x} y={o.y} width={o.w} height={o.h} fill={o.fill || 'none'} stroke={o.sw > 0 ? o.stroke : 'none'} strokeWidth={o.sw} />
    case 'ellipse':
      return <ellipse cx={o.x + o.w / 2} cy={o.y + o.h / 2} rx={o.w / 2} ry={o.h / 2} fill={o.fill || 'none'} stroke={o.sw > 0 ? o.stroke : 'none'} strokeWidth={o.sw} />
    case 'line': case 'arrow': {
      const g = o.type === 'arrow' ? arrowGeom(o) : null
      const [x2, y2] = g ? g.end : [o.x2, o.y2]
      return <>
        <line x1={o.x1} y1={o.y1} x2={x2} y2={y2} stroke={o.stroke} strokeWidth={o.sw} strokeLinecap="round" />
        {g && <polygon points={g.head.map(p => p.join(',')).join(' ')} fill={o.stroke} />}
        <line x1={o.x1} y1={o.y1} x2={o.x2} y2={o.y2} stroke="transparent" strokeWidth={Math.max(o.sw, 12)} strokeLinecap="round" />
      </>
    }
    case 'pen': {
      const d = penPath(o.pts)
      return <>
        <path d={d} fill="none" stroke={o.stroke} strokeWidth={o.sw} strokeLinecap="round" strokeLinejoin="round" />
        <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(o.sw, 12)} strokeLinecap="round" strokeLinejoin="round" />
      </>
    }
  }
}

/** オブジェクト1つ。参照が変わらない限り再描画されない */
export const ObjView = memo(function ObjView({ pid, o, editing }: { pid: string; o: Obj; editing: boolean }) {
  if (o.type === 'text') return <TextView pid={pid} o={o} editing={editing} />
  if (o.type === 'image') {
    return (
      <div className="obj image" data-oid={o.id} style={{ left: o.x, top: o.y, width: o.w, height: o.h, opacity: o.op }}>
        <img src={assetUrl(o.asset)} draggable={false} alt="" />
      </div>
    )
  }
  return (
    <div className={'obj ' + o.type} data-oid={o.id}>
      <svg style={{ opacity: o.op }}><Shape o={o} /></svg>
    </div>
  )
})

const HANDLES = {
  corners: ['nw', 'ne', 'se', 'sw'],
  all: ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'],
}
const HPOS: Record<string, [number, number]> = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] }

/** 選択枠とリサイズハンドル */
export function SelOverlay({ o, editing }: { o: Obj; editing: boolean }) {
  if (o.type === 'line' || o.type === 'arrow') {
    return <>
      {([['p1', o.x1, o.y1], ['p2', o.x2, o.y2]] as const).map(([h, x, y]) =>
        <div key={h} className="hd" data-h={h} style={{ left: x, top: y }} />)}
    </>
  }
  const b = bbox(o)
  const hs = o.type === 'text' || o.type === 'image' ? HANDLES.corners : HANDLES.all
  return (
    <div className="selbox" style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
      {!editing && hs.map(h => <div key={h} className="hd" data-h={h} style={{ left: HPOS[h][0] + '%', top: HPOS[h][1] + '%' }} />)}
    </div>
  )
}
