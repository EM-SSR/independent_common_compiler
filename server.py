# -*- coding: utf-8 -*-
"""Common scope notebook の web server。標準機能だけで書く。

    python server.py                 8787 番で起動し、ブラウザを開く
    python server.py --port 9000 --no-browser

役目は三つ。

  1. web/ の静的 file、notebooks/、assets/ の画像と動画を配る
  2. 実行時のファイル（vcpu.py、toolchain.py、commonc の image…）を /runtime/ で配る。
     ブラウザ側の Pyodide がこれを取り込んで lane64 を動かす
  3. ウィンドウの同期。/events が Server-Sent Events、POST /state が書き込みになる

ウィンドウを分けるのは表示量のためになる。lane の作業領域は交わらない（20 式 1.2）ので、
ウィンドウごとに自分の kernel を持たせても state が混ざらない。同期するのは平文と初期値だけで、
計算はそれぞれのウィンドウが自分で回す。
"""

import json
import os
import sys
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "web")
NOTEBOOKS = os.path.join(HERE, "notebooks")
VENDOR = os.path.join(HERE, "vendor")
ASSETS = os.path.join(HERE, "assets")   # notebook が貼る画像と動画


# ===== 実行時のファイル =====
#
# 場所が二通りある。repository の中では Python_vCPU と builds を直に指し、
# 配布版では runtime/ に写しが揃っている。どちらでも同じ名前で配る。

def runtime_map():
    local = os.path.join(HERE, "runtime")
    names = ("vcpu.py", "vcpu_vec.py", "lex.py", "toolchain.py",
             "commonc_lane64.bin", "joinrank.bin", "anf.bin", "joinrank.dic")
    out = {}
    for n in names:
        p = os.path.join(local, n)
        if os.path.exists(p):
            out[n] = p
    if len(out) == len(names):
        return out

    root = os.path.abspath(os.path.join(HERE, os.pardir, os.pardir, os.pardir))
    vcpu_dir = os.path.join(root, "continuous_republic", "common_systems", "Python_vCPU")
    jr = os.path.join(root, "continuous_republic", "common_apps", "joinrank")
    fall = {
        "vcpu.py": os.path.join(vcpu_dir, "vcpu.py"),
        "vcpu_vec.py": os.path.join(vcpu_dir, "vcpu_vec.py"),
        "lex.py": os.path.join(vcpu_dir, "lex.py"),
        "toolchain.py": os.path.join(vcpu_dir, "toolchain.py"),
        "commonc_lane64.bin": os.path.join(root, "builds", "commonc", "commonc_lane64.bin"),
        "joinrank.bin": os.path.join(jr, "build", "joinrank.bin"),
        "anf.bin": os.path.join(jr, "build", "anf.bin"),
        "joinrank.dic": os.path.join(jr, "joinrank", "joinrank.dic"),
    }
    for n, p in fall.items():
        if n not in out and os.path.exists(p):
            out[n] = p
    for n in ("generators.py", "scope.py", "session.py", "joint.py"):
        out[n] = os.path.join(HERE, "kernel", n)
    return out


def kernel_map():
    return {n: os.path.join(HERE, "kernel", n)
            for n in ("generators.py", "scope.py", "session.py", "joint.py")}


# ===== ウィンドウの同期 =====

class Hub(object):
    """いま編集している平文と種を持ち、繋がっているウィンドウへ配る"""

    def __init__(self):
        self.state = {"rev": 0}
        self.clients = []
        self.lock = threading.Lock()

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def publish(self, patch):
        with self.lock:
            self.state.update(patch)
            self.state["rev"] = self.state.get("rev", 0) + 1
            body = ("data: %s\n\n" % json.dumps(self.state, ensure_ascii=False)).encode("utf-8")
            live = []
            for w in self.clients:
                try:
                    w.write(body)
                    w.flush()
                    live.append(w)
                except Exception:
                    pass
            self.clients = live
            return self.state["rev"]

    def attach(self, w):
        with self.lock:
            self.clients.append(w)
            return ("data: %s\n\n" % json.dumps(self.state, ensure_ascii=False)).encode("utf-8")


HUB = Hub()


# 拡張子から媒体の型を引く。module の import は JavaScript の型でないと browser が断る
_MEDIA = {
    ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
    ".wasm": "application/wasm", ".css": "text/css", ".html": "text/html; charset=utf-8",
    ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".mp4": "video/mp4", ".webm": "video/webm", ".ogv": "video/ogg",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
    ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8",
}


def _media(path):
    return _MEDIA.get(os.path.splitext(path)[1].lower(), "application/octet-stream")


class Handler(SimpleHTTPRequestHandler):

    def __init__(self, *a, **k):
        SimpleHTTPRequestHandler.__init__(self, *a, directory=WEB, **k)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        # 直した web/ がそのまま反映されるように、静的 file もキャッシュさせない
        if "Cache-Control" not in self._headers_buffer_names():
            self.send_header("Cache-Control", "no-store")
        SimpleHTTPRequestHandler.end_headers(self)

    def _headers_buffer_names(self):
        return b"".join(getattr(self, "_headers_buffer", []) or []).decode("latin-1")

    # ---- 送る ----

    def _json(self, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path, ctype):
        try:
            data = open(path, "rb").read()
        except OSError:
            self.send_error(404, "無い: %s" % os.path.basename(path))
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        p = self.path.split("?")[0]

        if p == "/api/runtime":
            files = runtime_map()
            files.update(kernel_map())
            missing = [n for n, q in files.items() if not os.path.exists(q)]
            local = os.path.isfile(os.path.join(VENDOR, "pyodide", "pyodide.js"))
            web = os.path.isfile(os.path.join(VENDOR, "web", "marked.umd.js"))
            self._json({"files": sorted(files), "missing": missing,
                        "pyodide": "/vendor/pyodide/" if local else None,
                        "web": "/vendor/web/" if web else None})
            return

        if p.startswith("/runtime/"):
            name = p[len("/runtime/"):]
            files = runtime_map()
            files.update(kernel_map())
            if name not in files:
                self.send_error(404, "配信の表に無い: %s" % name)
                return
            self._file(files[name], "application/octet-stream")
            return

        if p == "/api/notebooks":
            if not os.path.isdir(NOTEBOOKS):
                self._json([])
                return
            out = []
            for n in sorted(os.listdir(NOTEBOOKS)):
                if n.endswith(".json"):
                    d = json.load(open(os.path.join(NOTEBOOKS, n), encoding="utf-8"))
                    out.append({"file": n, "title": d.get("title", n)})
            self._json(out)
            return

        if p.startswith("/api/notebook/"):
            self._file(self._nb_path(p), "application/json; charset=utf-8")
            return

        if p == "/api/state":
            self._json(HUB.snapshot())
            return

        if p == "/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            try:
                self.wfile.write(HUB.attach(self.wfile))
                self.wfile.flush()
            except Exception:
                return
            # 接続は publish が書けなくなるまで開けたままにする
            while True:
                with HUB.lock:
                    alive = self.wfile in HUB.clients
                if not alive:
                    return
                time.sleep(0.5)

        if p == "/api/assets":
            os.path.isdir(ASSETS) or os.makedirs(ASSETS)
            self._json(sorted(os.listdir(ASSETS)))
            return

        if p.startswith("/assets/"):
            q = os.path.join(ASSETS, os.path.basename(p[len("/assets/"):]))
            self._file(q, _media(q))
            return

        if p.startswith("/vendor/"):
            q = os.path.join(VENDOR, p[len("/vendor/"):].replace("/", os.sep))
            if not os.path.abspath(q).startswith(VENDOR):
                self.send_error(403)
                return
            self._file(q, _media(q))
            return

        SimpleHTTPRequestHandler.do_GET(self)

    # ---- notebook の保存と削除 ----
    #
    # 書き込める場所は notebooks/ の直下だけにする。名前は basename を取り、
    # 拡張子を .json に固定するので、上の階層へは出られない。

    def _nb_path(self, p):
        name = os.path.basename(p.split("/api/notebook/")[-1])
        if not name.endswith(".json"):
            name += ".json"
        return os.path.join(NOTEBOOKS, name)

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n).decode("utf-8"))

    def do_POST(self):
        p = self.path.split("?")[0]
        if p == "/state":
            try:
                patch = self._body()
            except ValueError:
                self.send_error(400, "JSON ではありません")
                return
            self._json({"rev": HUB.publish(patch)})
            return
        if p.startswith("/assets/"):
            name = os.path.basename(p[len("/assets/"):])
            if not name:
                self.send_error(400, "名前がありません")
                return
            n = int(self.headers.get("Content-Length", 0))
            if n > 64 * 1024 * 1024:
                self.send_error(413, "64 MB を越えています")
                return
            os.path.isdir(ASSETS) or os.makedirs(ASSETS)
            with open(os.path.join(ASSETS, name), "wb") as f:
                f.write(self.rfile.read(n))
            self._json({"path": "assets/" + name})
            return

        if p.startswith("/api/notebook/"):
            try:
                doc = self._body()
            except ValueError:
                self.send_error(400, "JSON ではありません")
                return
            os.path.isdir(NOTEBOOKS) or os.makedirs(NOTEBOOKS)
            path = self._nb_path(p)
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                json.dump(doc, f, ensure_ascii=False, indent=2)
                f.write("\n")
            self._json({"file": os.path.basename(path)})
            return
        self.send_error(404)

    def do_DELETE(self):
        p = self.path.split("?")[0]
        if not p.startswith("/api/notebook/"):
            self.send_error(404)
            return
        path = self._nb_path(p)
        if os.path.exists(path):
            os.remove(path)
        self._json({"file": os.path.basename(path)})


def main(argv):
    port, open_browser = 8787, True
    it = iter(argv)
    for a in it:
        if a == "--port":
            port = int(next(it))
        elif a == "--no-browser":
            open_browser = False
        else:
            print(__doc__)
            return 2
    files = runtime_map()
    files.update(kernel_map())
    missing = [n for n, p in files.items() if not os.path.exists(p)]
    if missing:
        print("配れないファイル: %s" % ", ".join(missing))
        print("  setup.py を実行するか、runtime/ へコピーを置く")
    url = "http://127.0.0.1:%d/" % port
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    srv.daemon_threads = True
    print("Common scope notebook  %s" % url)
    print("  パネルを別ウィンドウで開く: %s?pane=dag  ?pane=chamber  ?pane=tsui  ?pane=lane  ?pane=joint" % url)
    if open_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
