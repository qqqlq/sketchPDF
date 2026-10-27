# React/TypeScript 移行と UX 改善（2026-10-27）

## 何をしたか
- 素のHTML/JS（`app.js` 約1170行）を Vite + React 19 + TypeScript へ移植（ratio-check と同じ構成）
- 純粋ロジックを `src/geom.ts`・`src/docs.ts`・`src/exportPdf.ts` に型付きで分離
- UIをコンポーネント化。状態は `src/store.ts` の外部ストア（`useSyncExternalStore`）に集約
- 旧版は `public/legacy/` に退避（`/legacy/` で開ける）。`vendor/`・`fonts/` は `public/` へ移動
- ライブラリは pdfjs-dist 3.11.174 / pdf-lib 1.17.1 / @pdf-lib/fontkit 1.1.1 を npm 管理（旧 `vendor/` と同一系列）。qpdf-wasm のみ従来どおり `public/vendor/` から遅延読み込み

## なぜしたか
- 旧版は操作のたびに `rebuildStage()` で全ページのDOMを作り直し、`renderOverlay()` でページ内の全オブジェクトを再生成していた。回転・削除・ズーム・ドラッグでちらつきやスクロールのずれが出ていたため、操作をシームレスにしたかった
- Reactの差分描画と `key` 管理により、変更のあった要素だけが更新される

## 設計メモ
- 状態は不変更新。Undo/Redoは `JSON.stringify` ではなく `{pages, sel}` の参照を積む（コピー不要で高速）。`pushUndo(key)` の1.2秒まとめ打ちは踏襲
- ドラッグ中は `patchObj` でUndo履歴に積まず差し替え、最初に動いたときだけ `pushUndo`
- テキスト編集は contentEditable を React に管理させない（編集中は DOM が正、非編集時のみ `textContent` を同期）。実測サイズは `setTextSize` で履歴に載せず反映
- PDF描画は `PdfCanvas`。画面付近に来たときだけ描画し、再描画中は旧ビットマップを引き伸ばして見せ続ける（ズーム中に白抜けしない）。描画は全体で1つずつ直列
- ズーム/ページ増減時は「基準点(スクロール位置の比率)」を保持して `scrollTop/Left` を補正。Ctrl+ホイール時はカーソル位置を基準にする
- 並べ替え等のアニメーションは `useFlip`（FLIP）。ズーム時は動かさない

## 動作確認
Playwright(Chromium)で、PDFを開く・テキスト/四角/矢印/ペンの追加・Undo/Redo・回転・空白挿入・ズーム（ボタン／Ctrl+ホイール）・サムネイルのドラッグ並べ替え・PDF書き出しを確認。コンソールエラーなし。書き出したPDFを poppler で描画し、回転後もオブジェクトが追従していることを目視確認。

## 既知の問題・TODO
- 未確認: パスワード付きPDFを開く操作（ロジックは旧版そのまま移植。ダイアログはReact化）
- 未確認: タッチ操作（`touch-action: none` は踏襲しているが、ピンチズーム等は未対応）
- ビルド時に pdfjs-dist の `eval("require")` 警告が出る（pdf.js内部のフォールバックで実害なし）
- JSバンドルが約1MB（pdf.js/pdf-lib含む）。必要なら動的 import で分割
- `public/legacy/` は動作比較用。問題なければ削除する（削除は要確認）
- 旧TODOのうち「サムネイルに編集内容が反映されない」は解消。それ以外（注釈・リンクの消失、既存テキスト編集、複数選択、フォントのサブセット化など）は `001-初期実装.md` のとおり未対応
