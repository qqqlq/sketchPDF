import { useEffect, useRef, useState } from 'react'
import { answerPassword, newBlank, useStore } from '../store'
import { openDialog } from './TopBar'

export function EmptyState() {
  const has = useStore(s => s.pages.length > 0)
  if (has) return null
  return (
    <div id="empty">
      <div className="card">
        <h1>Sketch<b>PDF</b></h1>
        <p>PDFをここにドロップ、またはボタンで開く</p>
        <div className="row">
          <button className="tb primary big" onClick={openDialog}>PDFを開く</button>
          <button className="tb big" onClick={newBlank}>空白のPDFから始める</button>
        </div>
        <small>ファイルはブラウザ内だけで処理され、外部には送信されません</small>
      </div>
    </div>
  )
}

export function PageIndicator() {
  const cur = useStore(s => s.cur)
  const n = useStore(s => s.pages.length)
  if (!n) return null
  return <div id="pageind">{cur + 1} / {n}</div>
}

export function Busy() {
  const busy = useStore(s => s.busy)
  return busy ? <div id="busy"><div>処理中…</div></div> : null
}

export function Toast() {
  const t = useStore(s => s.toast)
  return t ? <div id="toast" className={t.err ? 'err' : ''} key={t.id}>{t.msg}</div> : null
}

export function DropMask({ active }: { active: boolean }) {
  return active ? <div id="dropmask">ドロップして開く</div> : null
}

export function PasswordDialog() {
  const pw = useStore(s => s.password)
  const [value, setValue] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (pw) { setValue(''); input.current?.focus() } }, [pw])
  if (!pw) return null
  return (
    <div id="pwmask">
      <div className="card">
        <h2>パスワードが必要です</h2>
        <p id="pw-name">{pw.name}</p>
        <input
          ref={input} type="password" autoComplete="off" placeholder="パスワード" value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') answerPassword(value); else if (e.key === 'Escape') answerPassword(null) }}
        />
        {pw.retry && <p id="pw-err">パスワードが違います。もう一度入力してください。</p>}
        <div className="row">
          <button className="tb" onClick={() => answerPassword(null)}>キャンセル</button>
          <button className="tb primary" onClick={() => answerPassword(value)}>開く</button>
        </div>
      </div>
    </div>
  )
}
