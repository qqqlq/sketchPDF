import { pickPdf, pickPdfs } from '../files'
import { addFiles, fitWidth, openFile, redo, save, setZoom, pendingZoom, undo, useStore } from '../store'

export const openDialog = () => pickPdf().then(f => { if (f) openFile(f) })
const addDialog = () => pickPdfs().then(fs => { if (fs.length) addFiles(fs) })

export function TopBar() {
  const zoom = useStore(s => s.zoom)
  const name = useStore(s => s.name)
  const hasPages = useStore(s => s.pages.length > 0)
  const canUndo = useStore(s => s.undo.length > 0)
  const canRedo = useStore(s => s.redo.length > 0)
  return (
    <header id="top">
      <div className="brand">Sketch<b>PDF</b></div>
      <button className="tb" title="PDFを開く (Ctrl+O)" onClick={openDialog}>開く</button>
      <button className="tb" title="PDFを末尾に追加して結合" onClick={addDialog}>PDFを追加</button>
      <span className="sep" />
      <button className="tb ic" title="元に戻す (Ctrl+Z)" disabled={!canUndo} onClick={undo}>↶</button>
      <button className="tb ic" title="やり直し (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>↷</button>
      <span className="sep" />
      <button className="tb ic" title="縮小" onClick={() => setZoom(pendingZoom() / 1.2)}>−</button>
      <span id="zoomlabel">{Math.round(zoom * 100)}%</span>
      <button className="tb ic" title="拡大" onClick={() => setZoom(pendingZoom() * 1.2)}>＋</button>
      <button className="tb" title="幅に合わせる" onClick={fitWidth}>幅に合わせる</button>
      <span className="grow" />
      <span id="docname">{hasPages ? name + '.pdf' : ''}</span>
      <button className="tb" title="選択中のページだけを別PDFとして保存（分割）" onClick={() => save(true)}>選択ページを保存</button>
      <button className="tb primary" title="PDFとして保存 (Ctrl+S)" onClick={() => save(false)}>PDFを保存</button>
    </header>
  )
}
