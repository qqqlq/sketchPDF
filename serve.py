#!/usr/bin/env python3
"""SketchPDF 用の簡易サーバー。
待ち受けは 127.0.0.1 と Tailscale のIP(100.x)のみ。0.0.0.0 では待ち受けないため、
LAN・公衆回線側には公開されず、tailnet内の端末からだけアクセスできる。"""
import functools, subprocess, sys, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
addrs = ["127.0.0.1"]
try:
    ts = subprocess.run(["tailscale", "ip", "-4"], capture_output=True, text=True, timeout=5).stdout.split()
    addrs += [a for a in ts if a.startswith("100.")]
except (OSError, subprocess.SubprocessError):
    pass

handler = functools.partial(SimpleHTTPRequestHandler, directory=".")
servers = []
for a in addrs:
    try:
        servers.append(ThreadingHTTPServer((a, port), handler))
        print(f"SketchPDF: http://{a}:{port}")
    except OSError as e:
        print(f"  {a}:{port} で待ち受けできません: {e}", file=sys.stderr)
if not servers:
    sys.exit(1)
print("Ctrl+C で終了")
for s in servers[1:]:
    threading.Thread(target=s.serve_forever, daemon=True).start()
try:
    servers[0].serve_forever()
except KeyboardInterrupt:
    pass
