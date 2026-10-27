import { useEffect, useState } from 'react'
import { FM } from './geom'
import { chooseTool } from './interaction'
import { pickPdf } from './files'
import {
  addFiles, copySel, deleteSel, deselect, duplicateSel, getSel, getState, insertImage, nudgeSel, openFile,
  pasteClip, redo, save, set, setTool, undo,
} from './store'
import { TOOLS } from './tools'
import { PageList } from './components/PageList'
import { PropsPanel } from './components/PropsPanel'
import { Stage } from './components/Stage'
import { Tools } from './components/Tools'
import { TopBar } from './components/TopBar'
import { Busy, DropMask, EmptyState, PageIndicator, PasswordDialog, Toast } from './components/Overlays'

const isTyping = () => !!getState().editing || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '')

function measureFont() {
  const c = document.createElement('canvas').getContext('2d')!
  c.font = '400 100px "BIZ UDPGothic"'
  const m = c.measureText('あ')
  if (m.fontBoundingBoxAscent) { FM.asc = m.fontBoundingBoxAscent / 100; FM.desc = m.fontBoundingBoxDescent / 100 }
}

/** キーボード・貼り付け・ファイルドロップなど、画面全体にかかる操作 */
function useGlobalHandlers(setDropActive: (v: boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = getState()
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase()
      if (mod && k === 's') { e.preventDefault(); save(false); return }
      if (mod && k === 'o') { e.preventDefault(); pickPdf().then(f => { if (f) openFile(f) }); return }
      if (isTyping() && !(mod && ['z', 'y'].includes(k) && !st.editing)) return
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (mod && k === 'y') { e.preventDefault(); redo(); return }
      if (mod && k === 'd') { e.preventDefault(); duplicateSel(); return }
      if (mod && k === 'c') { copySel(); return }
      if (mod) return
      const s = getSel()
      if ((e.key === 'Delete' || e.key === 'Backspace') && s) { e.preventDefault(); deleteSel(); return }
      if (e.key === 'Escape') { if (st.tool !== 'select') setTool('select'); else deselect(); return }
      if (s && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        nudgeSel(({ ArrowLeft: -step, ArrowRight: step } as Record<string, number>)[e.key] || 0, ({ ArrowUp: -step, ArrowDown: step } as Record<string, number>)[e.key] || 0)
        return
      }
      const t = TOOLS.find(t => t[2].toLowerCase() === k)
      if (t && st.pages.length) chooseTool(t[0])
    }

    const onPaste = (e: ClipboardEvent) => {
      if (isTyping()) return
      const img = [...(e.clipboardData?.files ?? [])].find(f => f.type.startsWith('image/'))
      if (img) { e.preventDefault(); insertImage(img); return }
      pasteClip()
    }

    let depth = 0
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files')
    const onEnter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setDropActive(true) } }
    const onLeave = (e: DragEvent) => { if (hasFiles(e) && --depth <= 0) { depth = 0; setDropActive(false) } }
    const onOver = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault() }
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault(); depth = 0; setDropActive(false)
      const files = [...e.dataTransfer!.files]
      const pdfs = files.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
      if (pdfs.length) await addFiles(pdfs)
      for (const f of files.filter(f => f.type.startsWith('image/'))) await insertImage(f)
    }
    const onUnload = (e: BeforeUnloadEvent) => { if (getState().dirty) e.preventDefault() }

    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [setDropActive])
}

export function App() {
  const [dropActive, setDropActive] = useState(false)
  useGlobalHandlers(setDropActive)

  // 日本語フォントの読み込みが終わったら行高を実測し、テキストの寸法を測り直させる
  useEffect(() => {
    Promise.all([document.fonts.load('400 20px "BIZ UDPGothic"', 'あA'), document.fonts.load('700 20px "BIZ UDPGothic"', 'あA')])
      .catch(() => { })
      .then(() => { measureFont(); set({ fontEpoch: getState().fontEpoch + 1 }) })
  }, [])

  return (
    <>
      <TopBar />
      <div id="main">
        <Tools />
        <PageList />
        <Stage />
        <PropsPanel />
      </div>
      <EmptyState />
      <PageIndicator />
      <Busy />
      <Toast />
      <PasswordDialog />
      <DropMask active={dropActive} />
    </>
  )
}
