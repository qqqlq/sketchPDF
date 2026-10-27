import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { sources } from '../docs'

/** IntersectionObserver の root(スクロールするコンテナ) */
export const ScrollRoot = createContext<HTMLElement | null>(null)

const dpr = window.devicePixelRatio || 1

/* pdf.js の描画は1つずつ順番に行う */
let chain: Promise<void> = Promise.resolve()
const queue = (fn: () => Promise<void>) => { chain = chain.then(fn).catch(e => console.warn(e)) }

interface Props {
  src: number; num: number; rot: number
  /** 回転適用後のページ幅(pt) */
  vw: number; vh: number
  /** 1ptあたりの表示px */
  zoom: number
  margin: number
}

/** 画面付近に来たときだけPDFページを描画する。再描画中は古い画像を引き伸ばして見せ続ける */
export function PdfCanvas({ src, num, rot, vw, vh, zoom, margin }: Props) {
  const root = useContext(ScrollRoot)
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)
  const done = useRef({ content: '', zoom: '' })

  useEffect(() => {
    if (!root) return
    const io = new IntersectionObserver(es => es.forEach(en => setNear(en.isIntersecting)), { root, rootMargin: `${margin}px 0px` })
    io.observe(boxRef.current!)
    return () => io.disconnect()
  }, [root, margin])

  const content = `${src}:${num}:${rot}`
  const zkey = zoom.toFixed(3)

  useEffect(() => {
    if (!near || src < 0) return
    if (done.current.content === content && done.current.zoom === zkey) return
    let cancelled = false
    queue(async () => {
      if (cancelled) return
      const pg = await sources[src].doc.getPage(num)
      if (cancelled) return
      let sc = zoom * dpr
      if (vw * vh * sc * sc > 36e6) sc = Math.sqrt(36e6 / (vw * vh))
      const vp = pg.getViewport({ scale: sc, rotation: rot })
      const c = document.createElement('canvas')
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height)
      await pg.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise
      if (cancelled) return
      const vis = canvasRef.current!
      vis.width = c.width; vis.height = c.height
      vis.getContext('2d')!.drawImage(c, 0, 0)
      done.current = { content, zoom: zkey }
    })
    return () => { cancelled = true }
  }, [near, src, num, rot, content, zkey, zoom, vw, vh])

  // 向きやページが変わったら、古い向きの画像は消す
  useEffect(() => {
    if (done.current.content && done.current.content !== content) {
      const c = canvasRef.current!
      c.width = 0; done.current = { content: '', zoom: '' }
    }
  }, [content])

  return <div ref={boxRef} className="pdfbox"><canvas ref={canvasRef} className="base" /></div>
}
