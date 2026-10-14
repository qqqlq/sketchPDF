#!/usr/bin/env bash
# SketchPDF を起動する。127.0.0.1 と Tailscale IP のみで待ち受け（詳細は serve.py）
cd "$(dirname "$0")"
PORT="${1:-8765}"
(command -v xdg-open >/dev/null && sleep 1 && xdg-open "http://127.0.0.1:${PORT}" >/dev/null 2>&1 &)
exec python3 serve.py "$PORT"
