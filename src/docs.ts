import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'
import { nid } from './uid'
import type { Page } from './types'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/* PDF本体のバイト列やpdf.jsのドキュメントはReactの状態に載せず、ここで保持する */
export interface Source { bytes: Uint8Array; doc: PDFDocumentProxy; name: string }
export interface Asset { bytes: Uint8Array; mime: string; url: string }

export const sources: Source[] = []
export const assets = new Map<string, Asset>()

export const resetSources = () => { sources.length = 0 }

/* ---- 暗号化PDFの復号 (qpdf-wasm。パスワードを知っているファイルのみ対象) ---- */
interface QpdfModule {
  FS: { writeFile(p: string, d: Uint8Array): void; readFile(p: string): Uint8Array }
  callMain(args: string[]): number
}
declare global {
  // eslint-disable-next-line no-var
  var Module: ((o: { locateFile: () => string; print: (s: string) => void; printErr: (s: string) => void }) => Promise<QpdfModule>) | undefined
}

let qpdfLoad: Promise<void> | null = null
const loadQpdf = () => qpdfLoad ||= new Promise<void>((res, rej) => {
  const sc = document.createElement('script')
  sc.src = 'vendor/qpdf.js'
  sc.onload = () => res()
  sc.onerror = () => { qpdfLoad = null; rej(new Error('復号ライブラリを読み込めませんでした')) }
  document.head.appendChild(sc)
})

function isEncrypted(bytes: Uint8Array) {
  const dec = new TextDecoder('latin1')
  const n = 16384
  return dec.decode(bytes.subarray(0, n)).includes('/Encrypt') || dec.decode(bytes.subarray(Math.max(0, bytes.length - n))).includes('/Encrypt')
}

export type AskPassword = (name: string, retry: boolean) => Promise<string | null>

async function decryptPdf(bytes: Uint8Array, name: string, ask: AskPassword) {
  await loadQpdf()
  let pw = '', retry = false
  for (;;) {
    const msgs: string[] = []
    const q = await globalThis.Module!({ locateFile: () => 'vendor/qpdf.wasm', print: s => msgs.push(s), printErr: s => msgs.push(s) })
    q.FS.writeFile('/in.pdf', bytes)
    const code = q.callMain([`--password=${pw}`, '--decrypt', '/in.pdf', '/out.pdf'])
    if (code === 0 || code === 3) return q.FS.readFile('/out.pdf').slice()   // 3 = 警告のみ
    // 終了コード2はエラー。printErrが効かない版があるため、メッセージが取れた場合のみ内容で判別する
    if (code !== 2 || (msgs.length && !msgs.some(m => /invalid password/i.test(m)))) throw new Error('PDFの復号に失敗しました')
    // 空パスワードで開けない = 開くときのパスワードが必要
    const v = await ask(name, retry)
    if (v === null) throw new Error('パスワード入力をキャンセルしました')
    pw = v; retry = true
  }
}

/** PDFを読み込んでソースに登録し、ページ一覧を返す。復号したときは decrypted を呼ぶ */
export async function loadSource(file: File, ask: AskPassword, decrypted: () => void): Promise<Page[]> {
  let bytes = new Uint8Array(await file.arrayBuffer())
  if (isEncrypted(bytes)) {
    bytes = await decryptPdf(bytes, file.name, ask)
    decrypted()
  }
  let doc: PDFDocumentProxy
  try { doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise }
  catch { throw new Error('PDFを読み込めませんでした') }
  const si = sources.push({ bytes, doc, name: file.name }) - 1
  const pages: Page[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n), v = pg.view
    pages.push({ id: nid(), src: si, num: n, r0: (((pg.rotate || 0) % 360) + 360) % 360, rot: 0, box: v, w0: v[2] - v[0], h0: v[3] - v[1], objs: [] })
  }
  return pages
}

/** 画像ファイルを PNG/JPEG のバイト列として登録し、アセットIDと元サイズを返す */
export async function registerImage(file: File) {
  let bytes: Uint8Array, mime = file.type
  const bmp = await createImageBitmap(file)
  if (mime === 'image/png' || mime === 'image/jpeg') bytes = new Uint8Array(await file.arrayBuffer())
  else {
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height
    c.getContext('2d')!.drawImage(bmp, 0, 0)
    const blob = await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/png'))
    bytes = new Uint8Array(await blob.arrayBuffer()); mime = 'image/png'
  }
  const id = nid()
  assets.set(id, { bytes, mime, url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })) })
  return { id, width: bmp.width, height: bmp.height }
}
