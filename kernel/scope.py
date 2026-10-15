# -*- coding: utf-8 -*-
"""commonc の作業領域を画面の形へ写す。

doc: commonc.alloc commonc.stages plain.tensor casm.lane64.block

compile が終わった lane には、commonc が自分で組んだ表がそのまま残っている
（19 §3.2）。この module はその表を読むだけで、計算を足さない。

    語 4    B        配列の刻み
    語 5    n_syl    音節の数
    語 6    n_box    箱の数
    語 132  BODY     本文の最初の音節番号。手前は採用語彙の表
    SYL   1B         音節番号
    OPK   4B         種類  1 Cst 2 Add 3 Mul 4 Neg 5 Store 6 Ok 7 Load 8 EqBr 9 LtBr
    OPA   6B         第一引数の箱番号（Cst では分子）
    OPB   8B         第二引数の箱番号
    OPD  10B         深度 δ
    OPL  12B         分岐先の箱番号

覆いは λ(w) = 語 64 + w（19 式 6.1）なので、実行した後の語 64+w が箱 w の分子になる。
分子と深度の対で二進有理数が決まる。

    値(w) = OPA・OPB から組んだ分子 / 2^OPD[w]                    01 §1
"""

import generators

KIND = {1: "Cst", 2: "Add", 3: "Mul", 4: "Neg", 5: "Store",
        6: "Ok", 7: "Load", 8: "EqBr", 9: "LtBr"}

# 引数の欄を辺として読む種類。Cst の OPA は分子であって箱番号ではない
EDGES = {2: (True, True), 3: (True, True), 4: (True, False),
         5: (True, True), 7: (True, False), 8: (True, True), 9: (True, True)}

WIRE_BASE = 64          # 19 式 6.1


def arrays(M):
    """commonc の表を切り出す。返りは辞書一つ"""
    B = M[4]
    n_syl, n_box = M[5], M[6]
    return {
        "B": B,
        "nSyl": n_syl,
        "nBox": n_box,
        "nNeed": M[3],
        "body": M[132],
        "syl": M[B:B + n_syl],
        "opk": M[4 * B:4 * B + n_box],
        "opa": M[6 * B:6 * B + n_box],
        "opb": M[8 * B:8 * B + n_box],
        "opd": M[10 * B:10 * B + n_box],
        "opl": M[12 * B:12 * B + n_box],
    }


# ===== 第一段：音節列を語と層へ切る（16 §2）=====
#
# 疎テンソル S(k,q,r) は音節列の中に既に入っている。
#
#   r   層境界音 ka の出現回数
#   q   層の中の位置。無声ワイヤ ki が一本ぶん進める
#
# 層の切れ目だけを数えるので、ここに文法解析は現れない。

def words(a, lexicon=None):
    """本文の音節を語へ切り、層番号と位置を付ける。表の区間は落とす"""
    body = generators.read(a["syl"][a["body"]:], lexicon)
    out, r, q = [], 0, 0
    for spelling, symbol, pin, pout, boxes, layer, _n in body:
        if spelling == "ka":
            r += 1
            q = 0
            continue
        out.append({"syl": spelling, "sym": symbol, "pin": pin, "pout": pout,
                    "boxes": boxes, "cls": layer, "r": r, "q": q})
        q += 1
    return out


# ===== 採用語彙の見出し（16 §1.3〜1.5）=====
#
# 見出しは文を引く。Lex ⊆ Σ* × C（16 式 1.5）なので、余域はチェンバーであって
# 原子箱ではない。差し込み（式 1.6）は書かれた位置 q から文の層を置くので、
# 見出しの境界の幅は文を畳めば出る。
#
# 文を畳むときは、机が足りなくなった分を「外から借りた」と数える。
# 借りた本数が Γ⁻ の幅、畳み終えた机の高さが Γ⁺ の幅になる。

def fold(text, table):
    """文ひとつの (pin, pout, 箱の本数)。table は先に畳んだ見出しの表"""
    front, borrowed, boxes = [], 0, 0
    layer = []
    for spelling, _sym, pin, pout, bx, _cls, _n in generators.read(
            generators.stream(text), table):
        if spelling == "ka":
            front, borrowed, boxes = _fold_layer(front, layer, borrowed, boxes)
            layer = []
            continue
        layer.append((spelling, pin, pout, bx))
    front, borrowed, boxes = _fold_layer(front, layer, borrowed, boxes)
    return borrowed, len(front), boxes


def _fold_layer(front, layer, borrowed, boxes):
    cur, out = 0, []
    for spelling, pin, pout, bx in layer:
        if bx is None:
            boxes = None
        elif boxes is not None:
            boxes += bx
        take = 1 if spelling == "ki" else pin
        for _ in range(take):
            if cur >= len(front):
                front = front + ["Γ⁻"]
                borrowed += 1
            if spelling == "ki":
                out.append(front[cur])
            cur += 1
        if spelling != "ki":
            out += [spelling] * pout
    return out + front[cur:], borrowed, boxes


def lexicon(entries):
    """`.dic` の行を順に畳む。後の行は前の見出しを引ける"""
    table = {}
    for _n, name, body in entries:
        try:
            table[name] = fold(body, table)
        except ValueError:
            table[name] = (0, 0, None)
    return table


# ===== 第二段：層ごとの frontier（19 §4.2）=====
#
# 箱は現在位置 q から消費する。無声ワイヤ ki が一本を素通しして位置を一つ進める。
#
#   fr(Λ_{r+1}) = fr(Λ_r) の未消費部 ‖ 層 r の出力
#
# 位置 0 が机の上になる。hu は机の上へ置き、ki hu は一つ奥へ差し込む。

def frontier(ws):
    """層ごとの机と、箱が机のどこを取ってどこへ置いたか。

    返りの一行は

        r      層番号
        in     入口の机。欄は語の綴り
        out    出口の机
        put    [{syl, take, give, at}]  take は入口の区間、give は出口の区間
    """
    rows, front = [], []
    for r in range(max((w["r"] for w in ws), default=-1) + 1):
        layer = [w for w in ws if w["r"] == r]
        if not layer:
            continue
        cur, out, put = 0, [], []
        for w in layer:
            if w["syl"] == "ki":
                if cur < len(front):
                    out.append(front[cur])
                put.append({"syl": "ki", "take": [cur, cur + 1],
                            "give": [len(out) - 1, len(out)], "wire": True})
                cur += 1
                continue
            at = len(out)
            out += [w["syl"]] * w["pout"]
            put.append({"syl": w["syl"], "cls": w["cls"],
                        "take": [cur, cur + w["pin"]],
                        "give": [at, at + w["pout"]], "wire": False})
            cur += w["pin"]
        rest = front[cur:]
        for k in range(len(rest)):
            put.append({"syl": rest[k], "take": [cur + k, cur + k + 1],
                        "give": [len(out) + k, len(out) + k + 1], "wire": True})
        rows.append({"r": r, "in": list(front), "out": out + rest, "put": put})
        front = out + rest
    return rows


# ===== 第三段：箱の DAG（19 §4.2、§4.3）=====

def boxes(a, wire=None):
    """箱を節点、OPA と OPB を辺として並べる。

    wire は実行した後の作業領域。渡すと語 64+w を分子として添える。
    """
    opk, opa, opb, opd, opl = a["opk"], a["opa"], a["opb"], a["opd"], a["opl"]
    out = []
    for i in range(a["nBox"]):
        k = opk[i]
        ua, ub = EDGES.get(k, (False, False))
        node = {"i": i, "kind": KIND.get(k, str(k)), "d": opd[i],
                "in": [x for x, use in ((opa[i], ua), (opb[i], ub)) if use]}
        if k == 1:
            node["num"] = opa[i]
        if k in (8, 9):
            node["to"] = opl[i]
        if wire is not None and WIRE_BASE + i < len(wire):
            node["v"] = wire[WIRE_BASE + i]
        out.append(node)
    return out


def gamma(a):
    """出口境界 Γ⁺。末尾の Cst と Store の連なりが語 0.. を埋める（19 §2.1）"""
    opk, opa = a["opk"], a["opa"]
    i = a["nBox"] - 1
    out = []
    while i >= 0 and opk[i] in (1, 5, 6):
        if opk[i] == 5 and opk[opa[i]] == 1 and opa[opa[i]] < WIRE_BASE:
            out.append({"word": opa[opa[i]], "box": a["opb"][i]})
        i -= 1
    return sorted(out, key=lambda x: x["word"])


def align(ws, a):
    """語と箱を並べて突き合わせる。

    生成元ごとに開く箱の本数は 16 §5 の表で決まる。読みの順に数えて合えば、
    画面の語と DAG の節点が一対一で結べる。判定値 Q の語は本数が固定でないので、
    その場合は結ばずに ok = False を返す。
    """
    n, spans = 0, []
    for w in ws:
        if w["boxes"] is None:
            return {"ok": False, "why": "箱の本数が固定でない語がある", "spans": []}
        spans.append([n, n + w["boxes"]])
        n += w["boxes"]
    tail = a["nBox"] - n
    if tail < 0:
        return {"ok": False, "why": "箱が語の総和に足りない", "spans": []}
    return {"ok": True, "spans": spans, "tail": [n, a["nBox"]]}


# ===== 第四段：lane64 の image（20 §7）=====

def image(vcpu, img):
    """block への分け方（式 7.4）と、block の中の層（式 7.1、7.2）"""
    prog = vcpu.decode(img)
    _ent, _idx, bl = vcpu.blocks(prog)
    out = []
    for pc, body, term, _stop in bl:
        lay = vcpu.layers(prog, body)
        out.append({"pc": pc, "n": len(body),
                    "term": vcpu.NAME[prog[term][0]] if term is not None else "落ちる",
                    "layers": [len(x) for x in lay]})
    kinds = {}
    for ins in prog:
        kinds[vcpu.NAME[ins[0]]] = kinds.get(vcpu.NAME[ins[0]], 0) + 1
    return {"bytes": len(img), "insns": len(prog), "blocks": out, "kinds": kinds}


# ===== 二進有理数（01 §1、20 §0.3）=====

def dyad(num, d):
    """x/2^δ を約分して (分子, 分母, 十進) にする"""
    while d > 0 and num % 2 == 0:
        num //= 2
        d -= 1
    den = 1 << d
    return {"num": num, "den": den, "dec": num / den if den else 0.0}


# ===== 読む前の診断 =====
#
# commonc は誤りを全部「報告 42」で返す。どこを直せばよいかが分からないので、
# 平文の側で分かる範囲を先に見る。ここで見るのは三つだけになる。
#
#   1. 音節表の外の綴り          19 式 4.1
#   2. 机が足りない              平文は Γ⁻ = I から始まる（16 §1.1）
#   3. 型の食い違い              Bit を語へ書く、Ω の閉じへ Dyad を渡す
#
# 断定できない所は黙る。commonc の判定を上書きしない。

# 語が出す値の型。分からない語は None にして、その先の判定をやめる
_CLASS = {
    "hu": "dyad", "no": "dyad", "ha": "dyad", "ti": "dyad", "se": "dyad",
    "mi": "dyad", "mo": "dyad",
    "hi": "bit", "so": "bit", "ne": "bit", "ra": "bit", "go": "bit",
    "to": "judge", "nu": "judge", "yu": "judge", "ye": "judge", "yo": "judge",
    "ri": "judge", "ru": "judge", "na": "judge", "ni": "judge",
    "re": "trace", "sa": "trace", "si": "trace", "ke": "trace",
    "su": "trace", "ro": "trace", "wa": "trace",
    "wi": "point", "ko": "point", "ta": "point", "de": "point", "do": "point",
    "wu": "reflection", "we": "reflection", "wo": "reflection", "ga": "reflection",
    "gi": "point",
}

_TYPE_NAME = {"dyad": "数", "bit": "判定", "judge": "判定値 𝒬"}


def check(text, table=None):
    """平文を読む前に見る。直す場所が分かる文言を返す。問題が無ければ None"""
    try:
        syl = generators.stream(text)
    except ValueError as e:
        return str(e)

    front, layer = [], []
    for spelling, _sym, pin, pout, _bx, _cls, _n in generators.read(syl, table or {}):
        if spelling == "ka":
            msg, front = _check_layer(front, layer)
            if msg:
                return msg
            layer = []
            continue
        layer.append((spelling, pin, pout))
    msg, _front = _check_layer(front, layer)
    return msg


def _check_layer(front, layer):
    cur, out = 0, []
    for spelling, pin, pout in layer:
        take = 1 if spelling == "ki" else pin
        got = []
        for _ in range(take):
            if cur >= len(front):
                return ("机に置いた物が足りない。「%s」は %d つ取るが、机にはそれだけ無い。"
                        "平文は空の机から始まるので、足りない分は hu で立てる" % (spelling, take)), front
            got.append(front[cur])
            cur += 1
        if spelling == "mu" and len(got) == 2 and got[1] in ("bit", "judge"):
            return ("%s を語へ書けない。mu が取る値は数でなければならない。"
                    "mo を挟んで数へ戻す" % _TYPE_NAME[got[1]]), front
        if spelling == "yi" and got and got[0] == "dyad":
            return ("Ω の閉じ yi は判定を取る。いま机の上にあるのは数なので、"
                    "hi などの判定をそのまま渡す"), front
        if spelling == "ki":
            out += got
        else:
            out += [_CLASS.get(spelling, None)] * pout
    return None, out + front[cur:]
