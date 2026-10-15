# -*- coding: utf-8 -*-
"""notebooks/ の全セルを compile して実行する。

    python test_notebook.py

ブラウザを立てずに kernel だけを確かめる。報告が tu でないセルと、語と箱の
対応が崩れたセルを数えて返す。接合秩を宣言したセルは ρ まで取る。
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
for d in ("runtime", "kernel"):
    p = os.path.join(HERE, d)
    if p not in sys.path:
        sys.path.insert(0, p)

import joint as joint_mod   # noqa: E402
import session              # noqa: E402

session.start(os.path.join(HERE, "runtime", "commonc_lane64.bin"))
_J = []


def joint():
    if not _J:
        _J.append(joint_mod.Joint(os.path.join(HERE, "runtime", "joinrank.bin"),
                                  os.path.join(HERE, "runtime", "joinrank.dic"),
                                  os.path.join(HERE, "runtime", "anf.bin")))
    return _J[0]


def gamma(sc):
    if not sc["gamma"]:
        return "(空)"
    return "  ".join("語%d=%s" % (g["word"], g["num"] if g["den"] == 1
                                  else "%d/%d" % (g["num"], g["den"]))
                     for g in sc["gamma"])


def main():
    bad = 0
    for name in sorted(os.listdir(os.path.join(HERE, "notebooks"))):
        if not name.endswith(".json"):
            continue
        nb = json.load(open(os.path.join(HERE, "notebooks", name), encoding="utf-8"))
        print("=== %s  %s" % (name, nb["title"]))
        for i, c in enumerate(nb["cells"]):
            if c.get("kind") != "cmn":
                continue
            head = "  [%d]" % (i + 1)
            try:
                sc = session.cell(c["source"], dic=nb.get("dic"),
                                  seeds=c.get("seeds"),
                                  words=c.get("words") or session.DEFAULT_WORDS)
            except session.CellError as e:
                if c.get("expect") == "fail":
                    print("%s 誤りの見本として止まった: %s" % (head, str(e)[:52]))
                else:
                    print("%s  失敗: %s" % (head, e))
                    bad += 1
                continue
            if c.get("expect") == "fail":
                print("%s  誤りの見本のはずが通った" % head)
                bad += 1
            note = ""
            if sc["report"] != 0:
                note += "  報告 %s" % sc["report"]
                bad += 1
            if not sc["align"]["ok"]:
                note += "  対応なし（%s）" % sc["align"]["why"]
            print("%s %-34s 音節%-4d 箱%-5d %s%s"
                  % (head, gamma(sc), sc["size"]["syl"], sc["size"]["box"],
                     sc["mark"], note))
            if c.get("inputs"):
                image, _n, _m = session.compile_text(c["source"], nb.get("dic"))
                tbl = session.vertices(image, c["inputs"])
                r = joint()(tbl, len(c["inputs"]), c.get("cut", len(c["inputs"]) // 2))
                print("       接合秩 ρ=%d  カット=%d  表=%s" % (r["rho"], r["cut"], tbl))
    # commonc では正しいが、過去に notebook 側の補助語彙だけが古く、
    # scope.check が commonc より先に拒否していた回帰。
    plane = "we re ka, ki sa ka, ki si ka, ki wi ka, gi ka."
    try:
        sc = session.cell(plane)
        if sc["report"] != 0 or sc["out"][:2] != [1, -1]:
            print("  [回帰] ツイ数平面: 実行結果が違う %s" % sc["out"][:2])
            bad += 1
        else:
            print("  [回帰] ツイ数平面: %s → %s" % (plane, sc["out"][:2]))
    except session.CellError as e:
        print("  [回帰] ツイ数平面: 失敗: %s" % e)
        bad += 1

    print("")
    print("閉じなかったセル: %d" % bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
