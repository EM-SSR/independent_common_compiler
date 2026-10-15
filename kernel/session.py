# -*- coding: utf-8 -*-
"""セル一つを compile して実行し、scope を組む。

doc: commonc.pipeline casm.lane64.host plain.format

道は一本になる（19 §7.1）。

    .dic + .cmn ──(commonc_lane64.bin on lane64)──▶ lane64 image ──(lane64)──▶ M

compile の受け渡しは toolchain.compile と同じだが、入口が path ではなく文字列で、
commonc の作業領域を捨てずに返す。scope はその作業領域から組む。

CPython でも Pyodide でも同じ code が動く。違うのは commonc の image の場所だけで、
それは start() の引数で決まる。
"""

import hashlib
import os
import sys
import tempfile

import scope

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import lex          # noqa: E402  Python_vCPU から借りる
import toolchain    # noqa: E402
import vcpu         # noqa: E402

WORK = toolchain.WORK               # 本文の作業領域の基底。ワイヤ（語 64+w）の上
DEFAULT_WORDS = WORK + (1 << 13)
DEFAULT_BUDGET = 1 << 24            # block を辿る上限。止まらないセルをここで止める


class CellError(Exception):
    pass


def start(commonc):
    """commonc の image の場所を決める。翻訳は最初の compile のときに一度だけ行う"""
    toolchain.COMMONC = commonc


# ===== compile =====
#
# host が commonc へ渡すもの（19 §3.1）。toolchain.compile と同じ値を置く。
#
#   語 0    N      入力の byte 数（表 + 本文）
#   語 1    IB     入力の基底語番号
#   語 4    B      配列の刻み
#   語 130  LEXB   表の byte 数

# 読み取り専用の場所へ入れても動くように、表は一時フォルダへ書く
_DIC = os.path.join(tempfile.gettempdir(), "common_scope_cell.dic")


def _dic_file(text):
    """採用語彙の表を lex へ渡すために一度だけ file にする"""
    open(_DIC, "w", encoding="utf-8", newline="\n").write(text)
    return _DIC


def compile_text(source, dic=None):
    """平文を image にする。返りは (image, n_need, commonc の作業領域)"""
    table, est, fold = "", len(source) // 2, {}
    if dic and dic.strip():
        path = _dic_file(dic)
        table = lex.lexicon(path)
        est = lex.expanded_syllables(path, source)
        fold = scope.lexicon(lex.entries(path))
    # commonc を正本にする。scope.check は表示用の補助表から行う診断なので、
    # Common 本体より先に文を棄却してはいけない。語彙が増えたときに補助表だけが
    # 古いと、正規の commonc では通る文を notebook だけが拒否してしまうためになる。
    data = (table + source).encode("utf-8")
    n = len(data)
    b = max(n + 80, 4096, 2 * est + 80)
    base = toolchain.IN_MUL * b
    lane = vcpu.Lane(base + n + 4096)
    lane.put_input(list(data), base)
    lane.M[toolchain.W_B] = b
    lane.M[toolchain.W_LEXB] = len(table.encode("utf-8"))
    rep = vcpu.run_lane(toolchain._commonc(), lane)
    if rep != 0:
        # commonc が実際に拒否したときだけ、平文側の診断で理由を細かくする。
        # 診断表が Common の全語彙を知らなくても、成功した文を壊すことはない。
        hit = scope.check(source, fold)
        if hit:
            raise CellError(hit)
        raise CellError("commonc がこの文を読めない（報告 %s）。"
                        "音節表の外の綴りか、机の上が合っていない" % rep)
    imgb, nimg, need = lane.M[1], lane.M[2], lane.M[3]
    if not (imgb and nimg):
        raise CellError("commonc が image を出さない")
    if need > WORK:
        raise CellError("箱が多すぎてワイヤが作業領域に重なる（n_need %d > %d）" % (need, WORK))
    return bytes(v & 255 for v in lane.M[imgb:imgb + nimg]), need, lane.M


# ===== 実行する =====
#
# ワイヤの語を落とす覆い（toolchain.load の wires）は使わない。scope は
# 箱ひとつずつの値を見せるので、語 64+w を全部残す。

def run_image(image, seeds=None, words=DEFAULT_WORDS, budget=DEFAULT_BUDGET):
    tab = vcpu.translate(vcpu.decode(image))[1]
    lane = vcpu.Lane(words)
    for k, v in (seeds or {}).items():
        lane.M[int(k)] = int(v)
    try:
        rep = vcpu.run_lane(tab, lane, budget=budget)
    except RuntimeError:
        raise CellError("block を %d 回辿っても終わりません。Ω の「もう良いか」を見直す" % budget)
    except IndexError:
        raise CellError("語番号が作業領域を越えた（語数 %d）。セルの words を増やす" % words)
    return rep, lane


def cell(source, dic=None, seeds=None, words=DEFAULT_WORDS, budget=DEFAULT_BUDGET):
    """セル一つ。compile して実行し、scope を返す"""
    image, need, cm = compile_text(source, dic)
    rep, lane = run_image(image, seeds, words, budget)

    table = scope.lexicon(lex.entries(_DIC)) if (dic and dic.strip()) else {}
    a = scope.arrays(cm)
    ws = scope.words(a, table)
    bx = scope.boxes(a, lane.M)
    gm = scope.gamma(a)
    depth = {g["word"]: a["opd"][g["box"]] for g in gm}
    return {
        "ok": True,
        "report": rep,
        "source": source,
        "size": {"syl": a["nSyl"] - a["body"], "box": a["nBox"],
                 "need": need, "image": len(image)},
        # 二つの平文が同じチェンバーかを見る hash。image が一致すれば読みも一致する
        "mark": hashlib.sha256(image).hexdigest()[:16],
        "words": ws,
        "frontier": scope.frontier(ws),
        "boxes": bx,
        "align": scope.align(ws, a),
        "gamma": [dict(g, **scope.dyad(lane.M[g["word"]], depth[g["word"]]))
                  for g in gm],
        "image": scope.image(vcpu, image),
        "out": [lane.M[k] for k in range(64)],
        "put": bytes(lane.OUT).decode("latin-1"),
    }


# ===== 接合秩（Common-Lang/1 定理 4.1）=====
#
#   F[α][β] = f(α, β),   ρ = rank_F2 F,   f = ⊕_{r<ρ} p_r(x_A) q_r(x_B)
#
# 階数は common_apps/joinrank の平文が持つ。ここは頂点値の表を作って渡すだけになる。
# 表は同じ image を 2^n 回実行して集める。lane の作業領域は交わらない（20 式 1.2）ので、
# 実行は互いに独立になる。

def vertices(image, inputs, words=DEFAULT_WORDS, budget=DEFAULT_BUDGET, out=0):
    """入力の語へ {0,1}^n を全部当て、語 out の値を頂点値として並べる"""
    n = len(inputs)
    if n > 12:
        raise CellError("入口が %d 本。頂点は 2^n なので 12 本までにする" % n)
    tab = vcpu.translate(vcpu.decode(image))[1]
    tbl = []
    for v in range(1 << n):
        lane = vcpu.Lane(words)
        for k, w in enumerate(inputs):
            lane.M[int(w)] = (v >> k) & 1
        vcpu.run_lane(tab, lane, budget=budget)
        tbl.append(1 if lane.M[out] else 0)
    return tbl
