# -*- coding: utf-8 -*-
"""Pyodide の中の入口。JavaScript はこの三つだけを呼ぶ。

    ready()               commonc の image を翻訳して待機に入る
    cell(spec)            セル一つ。返りは scope の JSON 文字列
    joint(spec)           接合秩。返りは JSON 文字列

受け渡しは JSON の文字列で統一する。proxy を跨いで辞書を渡すと、型の対応で
取りこぼしが出るので、境界は文字列一本にする。
"""

import json
import sys
import traceback

sys.path.insert(0, "/common")

import session   # noqa: E402
import joint as joint_mod   # noqa: E402

_JOINT = [None]


def ready():
    session.start("/common/commonc_lane64.bin")
    return json.dumps({"ok": True})


def _fail(e):
    return json.dumps({"ok": False, "error": str(e),
                       "trace": traceback.format_exc()[-1200:]}, ensure_ascii=False)


def cell(spec):
    s = json.loads(spec)
    try:
        out = session.cell(
            s["source"],
            dic=s.get("dic"),
            seeds=s.get("seeds"),
            words=int(s.get("words") or session.DEFAULT_WORDS),
            budget=int(s.get("budget") or session.DEFAULT_BUDGET))
        return json.dumps(out, ensure_ascii=False)
    except Exception as e:                       # noqa: BLE001  画面へ出す
        return _fail(e)


def joint(spec):
    """入力の語へ {0,1}^n を当てて頂点値の表を作り、接合秩を取る"""
    s = json.loads(spec)
    try:
        image, _need, _cm = session.compile_text(s["source"], s.get("dic"))
        words = int(s.get("words") or session.DEFAULT_WORDS)
        tbl = session.vertices(image, s["inputs"], words=words, out=int(s.get("out") or 0))
        if _JOINT[0] is None:
            _JOINT[0] = joint_mod.Joint("/common/joinrank.bin", "/common/joinrank.dic",
                                        "/common/anf.bin")
        n = len(s["inputs"])
        cut = int(s.get("cut") or (n // 2))
        out = _JOINT[0](tbl, n, cut)
        out["table"] = tbl
        out["inputs"] = s["inputs"]
        out["ok"] = True
        return json.dumps(out, ensure_ascii=False)
    except Exception as e:                       # noqa: BLE001
        return _fail(e)
