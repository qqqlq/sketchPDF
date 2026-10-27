#!/usr/bin/env bash
# SketchPDF を起動する。127.0.0.1 と Tailscale IP のみで待ち受け（詳細は serve.py）
# ソースが dist/ より新しければ自動でビルドする
cd "$(dirname "$0")"
PORT="${1:-8765}"
if [ ! -d node_modules ]; then npm install || exit 1; fi
if [ ! -f dist/index.html ] || [ -n "$(find src public index.html package.json -newer dist/index.html -print -quit)" ]; then
  npm run build || exit 1
fi
(command -v xdg-open >/dev/null && sleep 1 && xdg-open "http://127.0.0.1:${PORT}" >/dev/null 2>&1 &)
exec python3 serve.py "$PORT"
