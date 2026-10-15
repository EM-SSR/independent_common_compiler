# -*- coding: utf-8 -*-
"""接合秩。

doc: joinrank matrix.reduce

Common-Lang/1 定理 4.1。入力の分割 [n] = A ⊔ B と値の行列

    F[α][β] = f(α, β)          α ∈ {0,1}^A,  β ∈ {0,1}^B

に対し、F2 上の階数 ρ = rank F が

    f(x_A, x_B) = ⊕_{r=1}^{ρ} p_r(x_A) q_r(x_B)

の分離積の最小本数になる。ρ が「カットを渡る独立影響の本数」であり、
分解が立つとき縮約行列はテンソル積へ割れる。

    M_f = M_g (M_{h_A} ⊗ M_{h_B})

階数は掃き出しで取らない。ピボットの選び方は文に現れない量になるので、⊕ 閉包の
高さで取る（common_apps/joinrank/joinrank/rank.cmn）。

    V_0 = {0},   V_{α+1} = V_α ∪ (V_α ⊕ R_α),   ρ = log2 |V|

この module は表を語へ置いて image を実行し、出た語を読むだけになる。
"""

import os

import lex
import vcpu

_HERE = os.path.dirname(os.path.abspath(__file__))
_B = {}


def _addresses(dic):
    if dic not in _B:
        _B[dic] = lex.addresses(dic)
    return _B[dic]


class Joint(object):
    """接合秩の image ひとつ。実行に要る語数は辞書の帯が決める。

    image は二本。`joinrank` が ρ と分離積、`anf` が正規形の台だけを返す。
    台は同心円の図（Common-Lang/2 定義 4.1）で p_r と q_r がどの単項式を読むかを
    引くために要る。
    """

    def __init__(self, image_path, dic_path, anf_path=None):
        a = _addresses(dic_path)
        self.NIN, self.KUT = a["pebobe"], a["pebobo"]
        self.NAA, self.NBB = a["pebopa"], a["pebopi"]
        self.RHO, self.NVT, self.OVF = a["pebopu"], a["pebopo"], a["pepabe"]
        self.TAB, self.WIT, self.PCO = a["pepube"], a["pepupu"], a["pepupe"]
        self.ANF = a["pobepu"]
        self.RHOMAX, self.STRIDE = a["pebebo"], a["pebepa"]
        self.words = a["pobepu"] + (1 << 14) + 262144
        self.tab = vcpu.translate(vcpu.decode(open(image_path, "rb").read()))[1]
        self.anf_tab = None
        if anf_path:
            self.anf_tab = vcpu.translate(vcpu.decode(open(anf_path, "rb").read()))[1]

    def _run(self, tab, table, n, cut=None):
        lane = vcpu.Lane(self.words)
        lane.M[self.NIN] = n
        if cut is not None:
            lane.M[self.KUT] = cut
        for v, b in enumerate(table):
            if b:
                lane.M[self.TAB + v] = 1
        if vcpu.run_lane(tab, lane) != 0:
            raise ValueError("接合秩の文が失敗しました")
        return lane.M

    def support(self, table, n):
        """正規形の台。a_T = ⊕_{R⊆T} f(R)（R1 のメビウス変換）"""
        if self.anf_tab is None:
            return []
        M = self._run(self.anf_tab, table, n)
        return [t for t in range(1 << n) if M[self.ANF + t]]

    def __call__(self, table, n, cut):
        """頂点値の表とカットから ρ、分離積、そして図に要る台を返す。

        psup[r] は p_r の台。添字はそのまま [n] の番号になる。
        qsup[r] は q_r の台。B 側の番号なので κ だけ左へずらす。
        """
        M = self._run(self.tab, table, n, cut)
        if M[self.OVF]:
            raise ValueError("接合秩が語の容量 %d を越えた" % (self.RHOMAX - 1))
        rho, na, nb = M[self.RHO], M[self.NAA], M[self.NBB]
        q = [[M[self.WIT + self.STRIDE * r + b] for b in range(nb)] for r in range(rho)]
        p = [[M[self.PCO + self.RHOMAX * x + r] for x in range(na)] for r in range(rho)]
        out = {"n": n, "cut": cut, "rho": rho, "p": p, "q": q,
               "anf": [t for t in range(1 << n) if M[self.ANF + t]]}
        out["psup"] = [self.support(p[r], cut) for r in range(rho)]
        out["qsup"] = [[s << cut for s in self.support(q[r], n - cut)] for r in range(rho)]
        return out
