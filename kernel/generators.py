# -*- coding: utf-8 -*-
"""音節と生成元の対応表。

doc: plain.format commonc.generators casm.generators

音節番号は生成順で決まる（19 式 2.1）。

    idx(cv) = 5 ord(c) + ord(v)
    C = (k s t n h m y r w g z d b p),  V = (a i u e o)

commonc の SYL 配列（19 §3.2）はこの番号をそのまま並べる。表はそこから引く。

範囲は三つに分かれる。

    idx <= 59      一音節の生成元
    idx 60..69     見出しの字母 Σ_V = {be bo pa pi pu pe po}（06 §17）
    ku + 二音節    三音節の生成元。領域の語（region.cam）

pin と pout は境界語を一段動かす幅（13 式 1.2）。boxes は Desc が開く MBox の本数
（16 §5）で、0 の語は実行費用を持たない。
"""

CONSONANT = "kstnhmyrwgzdbp"
VOWEL = "aiueo"


def name(idx):
    """音節番号から綴りを返す"""
    return CONSONANT[idx // 5] + VOWEL[idx % 5]


def index(syl):
    """綴りから音節番号を返す"""
    return 5 * CONSONANT.index(syl[0]) + VOWEL.index(syl[1])


# 欄は (記号, pin, pout, 開く箱の本数, 層) になる。
#
# 層は画面の色分けにだけ使う。
#   frame   文の区切り。層境界と無声ワイヤ
#   dyad    二進有理数 Z[1/2] の上の演算
#   bit     二値
#   store   作業領域
#   omega   閉包 Ω_a
#   judge   判定値 Q。非可換 quantale（GCLS 定理 3.3）
#   region  幾何の領域と鎖
#   report  報告
#   letter  見出しの字母
ATOM = {
    "ka": ("層境界", 0, 0, 0, "frame"),
    "ki": ("id", 1, 1, 0, "frame"),
    "ku": ("零標示 z_e", 0, 0, 0, "frame"),

    "hu": ("one", 0, 1, 1, "dyad"),
    "no": ("⊕", 2, 1, 1, "dyad"),
    "ha": ("⊖", 1, 1, 1, "dyad"),
    "ti": ("⋆", 2, 1, 1, "dyad"),
    "se": ("β", 1, 1, 4, "dyad"),
    "he": ("Δ", 1, 2, 0, "dyad"),
    "ho": ("!", 1, 0, 0, "dyad"),

    "so": ("φ∂", 1, 1, 8, "bit"),
    "hi": ("≤", 2, 1, 8, "bit"),
    "mo": ("π", 1, 1, 0, "bit"),

    "mi": ("Load", 1, 1, 1, "store"),
    "mu": ("Store", 2, 0, 1, "store"),

    "ya": ("Ω 開き", 0, 0, 0, "omega"),
    "yi": ("Ω 閉じ", 1, 0, 1, "omega"),

    "to": ("整合対", 2, 1, None, "judge"),
    "na": ("原型 1 と整合", 1, 1, None, "judge"),
    "ni": ("原型 0 と整合", 1, 1, None, "judge"),
    "nu": ("⋆_Q", 2, 1, None, "judge"),
    "ne": ("所属", 1, 1, None, "judge"),
    "yu": ("⋁", 2, 1, None, "judge"),
    "ye": ("↘", 2, 1, None, "judge"),
    "yo": ("↙", 2, 1, None, "judge"),
    "ra": ("≤_Q", 2, 1, None, "judge"),
    "ri": ("hom", 2, 1, None, "judge"),
    "ru": ("π_Q", 1, 1, None, "judge"),
    "go": ("Θ", 1, 1, None, "judge"),

    "bi": ("∂", 1, 1, 0, "region"),
    "bu": ("⊕ 鎖", 2, 1, 0, "region"),

    # ツイ数平面。型名 T/P/R はそれぞれ複数の lane64 語で表す。
    #   Trace T      = 4 語
    #   Point P      = 2 語
    #   Reflection R = 1 語
    # pin/pout は抽象オブジェクトの個数ではなく、この境界語の本数になる。
    # 箱数は commonc の正規化で生成元単位に固定できないため None とする。
    "re": ("trace", 0, 4, None, "plane"),
    "sa": ("i", 4, 4, None, "plane"),
    "si": ("j", 4, 4, None, "plane"),
    "ke": ("id", 4, 4, None, "plane"),
    "su": ("⊖ trace", 4, 4, None, "plane"),
    "ro": ("ρ⁻", 4, 4, None, "plane"),
    "wa": ("ρ⁺", 4, 4, None, "plane"),
    "wi": ("endpoint", 4, 2, None, "plane"),
    "ko": ("id coord", 2, 2, None, "plane"),
    "ta": ("⊕ coord", 4, 2, None, "plane"),
    "de": ("実成分", 2, 2, None, "plane"),
    "do": ("無限成分", 2, 2, None, "plane"),
    "wu": ("E", 0, 1, None, "plane"),
    "we": ("R_r", 0, 1, None, "plane"),
    "wo": ("R_ij", 0, 1, None, "plane"),
    "ga": ("合成", 2, 1, None, "plane"),
    "gi": ("act", 3, 2, None, "plane"),

    "me": ("Ok", 0, 0, 1, "report"),
    "di": ("Ko", 0, 0, 1, "report"),
    "du": ("Put", 1, 0, 1, "report"),
}

# ku を頭に置く三音節の生成元（region.cam）
TRIPLE = {
    "kukeke": ("領域", 1, 1, 0, "region"),
    "kukeko": ("共通部", 2, 1, 0, "region"),
    "kukesa": ("合わせ", 2, 1, 0, "region"),
    "kukesi": ("外側", 2, 1, 0, "region"),
    "kukesu": ("境界 ∂", 1, 1, 0, "region"),
    "kukese": ("含まれる", 2, 1, 1, "region"),
    "kukeso": ("重なり", 2, 1, 1, "region"),
    "kuketa": ("隣接", 2, 1, 1, "region"),
    "kuketi": ("道", 1, 1, 1, "region"),
}

# 見出しの字母（06 §17）。採用語彙の名前だけに使い、生成元ではない
LETTERS = ("be", "bo", "pa", "pi", "pu", "pe", "po")

LAYER_BOUNDARY = 0          # ka
IDENTITY = 1                # ki
ZERO_MARK = 2               # ku


def stream(text):
    """filter_Σ（16 §1.1、19 式 4.1）。音節表の外の字を落として番号の列にする。

    ＡＳＣＩＩ 小文字が音節へ切れない所は誤りになる。
    """
    keep = [c for c in text if "a" <= c <= "z"]
    if len(keep) % 2:
        raise ValueError("音節の途中で切れている: ...%s" % "".join(keep[-5:]))
    out = []
    for k in range(0, len(keep), 2):
        c, v = keep[k], keep[k + 1]
        if c not in CONSONANT or v not in VOWEL:
            raise ValueError("音節表に無い綴り: %s%s" % (c, v))
        out.append(5 * CONSONANT.index(c) + VOWEL.index(v))
    return out


def look(spelling):
    """綴りから (記号, pin, pout, 箱, 層) を返す。表に無い綴りは None"""
    return TRIPLE.get(spelling) or ATOM.get(spelling)


def read(syl, lexicon=None):
    """SYL の番号列を語へ切る。返りは (綴り, 記号, pin, pout, 箱, 層, 長さ)。

    ku で始まる三音節は一語にまとめる。見出しの字母が続く区間も一語にまとめる
    ので、採用語彙の見出しがそのまま画面に出る。

    lexicon は {見出し: (pin, pout, 箱)}。見出しは文を差し込む（16 式 1.6）ので、
    境界の幅は差し込む文が決める。渡さないと幅 0 として置く。
    """
    lexicon = lexicon or {}
    out = []
    i = 0
    n = len(syl)
    while i < n:
        s = name(syl[i])
        if s == "ku" and i + 2 < n:
            t = s + name(syl[i + 1]) + name(syl[i + 2])
            hit = TRIPLE.get(t)
            if hit:
                out.append((t,) + hit + (3,))
                i += 3
                continue
        if s in LETTERS:
            j = i
            word = ""
            while j < n and name(syl[j]) in LETTERS:
                word += name(syl[j])
                j += 1
            pin, pout, bx = lexicon.get(word, (0, 0, None))
            out.append((word, "見出し", pin, pout, bx, "letter", j - i))
            i = j
            continue
        hit = ATOM.get(s)
        if hit:
            out.append((s,) + hit + (1,))
        else:
            out.append((s, "未登録", 0, 0, None, "unknown", 1))
        i += 1
    return out
