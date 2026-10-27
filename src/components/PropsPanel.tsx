import { TYPE_LABEL } from '../tools'
import {
  deleteSel, duplicateSel, getSel, reorderSel, setProp, useStore,
} from '../store'
import type { Align, Defaults } from '../types'

const pct = (x: number) => Math.round(x * 100) + '%'
const px = (x: number) => x.toFixed(0)

type Vals = Record<string, unknown>

export function PropsPanel() {
  const obj = useStore(s => getSel(s)?.o ?? null)
  const tool = useStore(s => s.tool)
  const defs = useStore(s => s.defs)
  const target = obj ? { obj, type: obj.type }
    : tool !== 'select' && tool !== 'image' ? { obj: null, type: tool } : null

  if (!target) {
    return (
      <aside id="props">
        <h3>プロパティ</h3>
        <p className="hint">ツールを選ぶか、ページ上のオブジェクトを選択すると、ここで色やサイズを変更できます。</p>
        <p className="hint">
          ・テキストはダブルクリックで編集<br />・Shiftキーで正円/正方形・45°の線<br />・Ctrl+ホイールで拡大縮小<br />
          ・Delete で削除、Ctrl+C/V でコピー<br />・矢印キーで微調整<br />
          ・既存の文字を直すときは、四角(白)で覆ってからテキストを重ねてください
        </p>
      </aside>
    )
  }

  const v = (target.obj ?? defs[target.type]) as Vals
  const fallback = defs[target.type] as Vals
  const num = (k: string, label: string, min: number, max: number, step = 1) => (
    <div className="fld"><label>{label}</label>
      <input type="number" min={min} max={max} step={step} value={+(+(v[k] as number)).toFixed(1)}
        onChange={e => { const n = parseFloat(e.target.value); if (!isNaN(n)) setProp(k, n) }} />
    </div>
  )
  const color = (k: string, label: string) => (
    <div className="fld"><label>{label}</label>
      <input type="color" value={v[k] as string} onChange={e => setProp(k, e.target.value)} />
    </div>
  )
  const ncolor = (k: string, label: string) => {
    const col = (v[k] as string | null) || (fallback[k] as string | null) || '#ffffff'
    return (
      <div className="fld">
        <label><input type="checkbox" checked={!!v[k]} onChange={e => setProp(k, e.target.checked ? col : null)} /> {label}</label>
        <input type="color" value={col} onChange={e => setProp(k, e.target.value)} />
      </div>
    )
  }
  const range = (k: string, label: string, min: number, max: number, step: number, fmt: (n: number) => string) => (
    <div className="fld"><label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={v[k] as number} onChange={e => setProp(k, parseFloat(e.target.value))} />
      <span className="val">{fmt(v[k] as number)}</span>
    </div>
  )

  let fields: React.ReactNode = null
  switch (target.type as keyof Defaults) {
    case 'text': fields = <>
      {num('fs', 'サイズ', 4, 400, 1)}
      <div className="fld"><label>太字</label><input type="checkbox" checked={!!v.bold} onChange={e => setProp('bold', e.target.checked)} /></div>
      <div className="fld"><label>配置</label><span className="seg">
        {(['left', 'center', 'right'] as Align[]).map((a, i) =>
          <button key={a} className={v.align === a ? 'on' : ''} onClick={() => setProp('align', a)}>{['左', '中', '右'][i]}</button>)}
      </span></div>
      {color('color', '文字色')}
      {ncolor('bg', '背景色')}
      {range('op', '不透明度', 0.05, 1, 0.05, pct)}
    </>; break
    case 'rect': case 'ellipse': case 'hl': fields = <>
      {ncolor('fill', '塗りつぶし')}
      {color('stroke', '線の色')}
      {range('sw', '線の太さ', 0, 30, 0.5, px)}
      {range('op', '不透明度', 0.05, 1, 0.05, pct)}
    </>; break
    case 'line': case 'arrow': case 'pen': fields = <>
      {color('stroke', '線の色')}
      {range('sw', '線の太さ', 0.5, 40, 0.5, px)}
      {range('op', '不透明度', 0.05, 1, 0.05, pct)}
    </>; break
    case 'image': fields = range('op', '不透明度', 0.05, 1, 0.05, pct); break
  }

  return (
    <aside id="props">
      <h3>{TYPE_LABEL[target.type]}{target.obj ? '' : '（次に描く設定）'}</h3>
      {fields}
      {target.obj && (
        <div className="actions">
          <button onClick={() => reorderSel(true)}>最前面へ</button>
          <button onClick={() => reorderSel(false)}>最背面へ</button>
          <button onClick={duplicateSel}>複製 (Ctrl+D)</button>
          <button className="danger" onClick={deleteSel}>削除</button>
        </div>
      )}
    </aside>
  )
}
