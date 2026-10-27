import { memo, type CSSProperties } from 'react'
import { vsize } from '../geom'
import type { Page } from '../types'
import { ObjView, SelOverlay } from './ObjView'
import { PdfCanvas } from './PdfCanvas'

interface Props { page: Page; zoom: number; selOid: string | null; editingOid: string | null }

/** ステージ上の1ページ。自分のページに関係する状態が変わったときだけ再描画される */
export const PageView = memo(function PageView({ page, zoom, selOid, editingOid }: Props) {
  const { w, h } = vsize(page)
  const sel = selOid ? page.objs.find(o => o.id === selOid) : null
  const innerStyle = { width: w, height: h, transform: `scale(${zoom})`, '--k': 1 / zoom } as CSSProperties
  return (
    <div className="pgwrap" data-pid={page.id} style={{ width: w * zoom, height: h * zoom }}>
      <PdfCanvas src={page.src} num={page.num} rot={(((page.r0 + page.rot) % 360) + 360) % 360} vw={w} vh={h} zoom={zoom} margin={900} />
      <div className="inner ov" style={innerStyle}>
        {page.objs.map(o => <ObjView key={o.id} pid={page.id} o={o} editing={o.id === editingOid} />)}
        {sel && <SelOverlay o={sel} editing={sel.id === editingOid} />}
      </div>
    </div>
  )
})
