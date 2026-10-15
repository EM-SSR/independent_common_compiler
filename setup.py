# -*- coding: utf-8 -*-
"""このフォルダだけで動くようにファイルを揃える。標準機能だけで書く。

    python setup.py              runtime/ を揃え、Pyodide をこのフォルダへコピーする
    python setup.py --runtime    runtime/ だけ
    python setup.py --vendor     Pyodide と web の library だけ
    python setup.py --version 314.0.7    版を指定する
    python setup.py --dist <DIR>         配布用フォルダを作る

揃うもの。

    runtime/         lane64 の実行台と commonc の image。server.py がここから配信する
    vendor/pyodide/  ブラウザの中の CPython。約 15 MB
    vendor/web/      marked（Markdown）と KaTeX（数式）。約 0.6 MB

Pyodide の版は npm の registry へ訊く。CDN の `full/` には wheel も揃っているので、
そこから四本と numpy の wheel を取る。numpy は束ねの道（vcpu_vec）が使う。
"""

import json
import os
import shutil
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RUNTIME = os.path.join(HERE, "runtime")
VENDOR = os.path.join(HERE, "vendor", "pyodide")
WEB = os.path.join(HERE, "vendor", "web")
ASSETS = os.path.join(HERE, "assets")

REGISTRY = "https://registry.npmjs.org/pyodide/latest"
CDN = "https://cdn.jsdelivr.net/pyodide/v%s/full/"
CORE = ("pyodide.js", "pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm",
        "python_stdlib.zip", "pyodide-lock.json")

# runtime/ に置く名前と、repository での在り処
SOURCES = (
    ("vcpu.py", "continuous_republic/common_systems/Python_vCPU/vcpu.py"),
    ("vcpu_vec.py", "continuous_republic/common_systems/Python_vCPU/vcpu_vec.py"),
    ("lex.py", "continuous_republic/common_systems/Python_vCPU/lex.py"),
    ("toolchain.py", "continuous_republic/common_systems/Python_vCPU/toolchain.py"),
    ("commonc_lane64.bin", "builds/commonc/commonc_lane64.bin"),
    ("joinrank.dic", "continuous_republic/common_apps/joinrank/joinrank/joinrank.dic"),
)


def root():
    return os.path.abspath(os.path.join(HERE, os.pardir, os.pardir, os.pardir))


def get(url, path):
    print("  %s" % os.path.basename(path))
    with urllib.request.urlopen(url) as r, open(path, "wb") as f:
        shutil.copyfileobj(r, f)


# ===== runtime =====

def runtime():
    os.path.isdir(RUNTIME) or os.makedirs(RUNTIME)
    R = root()
    miss = []
    for name, rel in SOURCES:
        src = os.path.join(R, rel.replace("/", os.sep))
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(RUNTIME, name))
            print("  %s" % name)
        elif not os.path.exists(os.path.join(RUNTIME, name)):
            miss.append(rel)
    for name in ("joinrank.bin", "anf.bin"):
        dst = os.path.join(RUNTIME, name)
        if os.path.exists(dst):
            continue
        built = os.path.join(R, "continuous_republic", "common_apps", "joinrank",
                             "build", name)
        if os.path.exists(built):
            shutil.copyfile(built, dst)
            print("  %s" % name)
        else:
            miss.append("%s（common_apps/joinrank/build.py で作る）" % name)
    if miss:
        print("揃わなかったもの:")
        for m in miss:
            print("  %s" % m)
        return 1
    return 0


# ===== Pyodide =====

def vendor(version=None):
    if version is None:
        with urllib.request.urlopen(REGISTRY) as r:
            version = json.load(r)["version"]
    base = CDN % version
    os.path.isdir(VENDOR) or os.makedirs(VENDOR)
    print("Pyodide %s" % version)
    for n in CORE:
        get(base + n, os.path.join(VENDOR, n))
    lock = json.load(open(os.path.join(VENDOR, "pyodide-lock.json"), encoding="utf-8"))
    wheel = lock["packages"]["numpy"]["file_name"]
    get(base + wheel, os.path.join(VENDOR, wheel))
    open(os.path.join(VENDOR, "version.txt"), "w").write(version)
    return 0


# ===== web の library =====
#
# notebook の説明セルは Markdown と LaTeX で書く。描くのは browser なので、
# marked と KaTeX をこのフォルダへ置く。KaTeX は font を伴う。

MARKED = "https://cdn.jsdelivr.net/npm/marked@%s/lib/marked.umd.js"
KATEX = "https://cdn.jsdelivr.net/npm/katex@%s/dist/%s"
KATEX_FONTS = (
    "KaTeX_AMS-Regular", "KaTeX_Caligraphic-Bold", "KaTeX_Caligraphic-Regular",
    "KaTeX_Fraktur-Bold", "KaTeX_Fraktur-Regular", "KaTeX_Main-Bold",
    "KaTeX_Main-BoldItalic", "KaTeX_Main-Italic", "KaTeX_Main-Regular",
    "KaTeX_Math-BoldItalic", "KaTeX_Math-Italic", "KaTeX_SansSerif-Bold",
    "KaTeX_SansSerif-Italic", "KaTeX_SansSerif-Regular", "KaTeX_Script-Regular",
    "KaTeX_Size1-Regular", "KaTeX_Size2-Regular", "KaTeX_Size3-Regular",
    "KaTeX_Size4-Regular", "KaTeX_Typewriter-Regular",
)


def latest(name):
    with urllib.request.urlopen("https://registry.npmjs.org/%s/latest" % name) as r:
        return json.load(r)["version"]


def web(marked_v=None, katex_v=None):
    marked_v = marked_v or latest("marked")
    katex_v = katex_v or latest("katex")
    os.path.isdir(os.path.join(WEB, "fonts")) or os.makedirs(os.path.join(WEB, "fonts"))
    print("marked %s / KaTeX %s" % (marked_v, katex_v))
    get(MARKED % marked_v, os.path.join(WEB, "marked.umd.js"))
    for n in ("katex.min.js", "katex.min.css"):
        get(KATEX % (katex_v, n), os.path.join(WEB, n))
    get(KATEX % (katex_v, "contrib/auto-render.min.js"),
        os.path.join(WEB, "auto-render.min.js"))
    for f in KATEX_FONTS:
        get(KATEX % (katex_v, "fonts/" + f + ".woff2"),
            os.path.join(WEB, "fonts", f + ".woff2"))
    open(os.path.join(WEB, "version.txt"), "w").write(
        "marked %s\nkatex %s\n" % (marked_v, katex_v))
    return 0


# ===== 配布用フォルダ =====
#
# repository の外へ出しても動く形にまとめる。runtime/ と vendor/ を抱えるので、
# 受け取った側は展開して server.py を動かすだけでよい。
#
# 例題の .cmn は tools/independent_compile_test の examples をそのまま使う。
# セルへドロップして実行できる。

APP = ("server.py", "setup.py", "test_notebook.py", "README.md")
TREES = ("kernel", "web", "notebooks", "vscode", "runtime", "vendor", "assets")
EXAMPLES = "tools/independent_compile_test/examples"



def dist(dst):
    if runtime():
        return 1
    if not os.path.isdir(VENDOR):
        print("vendor/ がありません。先に python setup.py --vendor を実行してください")
        return 1
    os.path.isdir(dst) or os.makedirs(dst)
    for n in APP:
        shutil.copyfile(os.path.join(HERE, n), os.path.join(dst, n))
    for n in TREES:
        src = os.path.join(HERE, n)
        if not os.path.isdir(src):
            continue
        shutil.copytree(src, os.path.join(dst, n), dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "_cell.dic"))
    ex = os.path.join(root(), *EXAMPLES.split("/"))
    if os.path.isdir(ex):
        shutil.copytree(ex, os.path.join(dst, "examples"), dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    open(os.path.join(dst, "start.ps1"), "w", encoding="utf-8", newline="\r\n").write(
        "# Common scope notebook を起動する\n"
        "$here = Split-Path -Parent $MyInvocation.MyCommand.Path\n"
        "python \"$here\\server.py\"\n")
    open(os.path.join(dst, "start.sh"), "w", encoding="utf-8", newline="\n").write(
        "#!/bin/sh\n"
        "# Common scope notebook を起動する\n"
        'exec python3 "$(dirname "$0")/server.py" "$@"\n')
    n = sum(len(f) for _b, _d, f in os.walk(dst))
    size = sum(os.path.getsize(os.path.join(b, f))
               for b, _d, fs in os.walk(dst) for f in fs)
    print("%s   %d ファイル   %.1f MB" % (dst, n, size / 1e6))
    return 0


def main(argv):
    do_rt = do_ve = True
    version = None
    it = iter(argv)
    for a in it:
        if a == "--runtime":
            do_ve = False
        elif a == "--vendor":
            do_rt = False
        elif a == "--version":
            version = next(it)
        elif a == "--dist":
            return dist(os.path.abspath(next(it)))
        else:
            print(__doc__)
            return 2
    bad = 0
    if do_rt:
        print("runtime/ を揃えます")
        bad |= runtime()
    if do_ve:
        try:
            vendor(version)
            web()
        except Exception as e:                    # noqa: BLE001
            print("library を取れません: %s" % e)
            print("  network が無い場所では、別の PC で --vendor を実行して vendor/ をコピーします")
            bad = 1
    if not bad:
        print("")
        print("起動:  python server.py")
    return bad


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
