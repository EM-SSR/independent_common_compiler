# Common scope notebook

Common 言語の平文を書き、commonc が組んだ内部表現を横で見るブラウザのアプリケーション。

---

## 1. 動かす

必要なのは Python 3.8 以上。

### Get Started

```
python server.py
```

Windows は `start.ps1`、macOS と Linux は `start.sh` でも同じ。ブラウザが開くはず。

### repository から動かす場合

```
python setup.py        初回実行したい場合。runtime/ と vendor/pyodide/ を揃える（約 15 MB を取得）
python server.py
```

二回目からは `server.py` だけでよい。

| したいこと | |
|---|---|
| port を変える | `python server.py --port 9000` |
| ブラウザを開かない | `python server.py --no-browser` |
| 動作を確かめる | `python test_notebook.py` |
| 図と動画を作り直す | `python figures.py`（matplotlib と ffmpeg を使う） |
| 配布版フォルダを作る | `python setup.py --dist <出力先>` |

network の無い PC へ入れるときは、別の PC で `python setup.py --vendor` を実行し、
`vendor/` ごとコピーする。

---

## 2. VS Code 拡張を入れる

`vscode/` フォルダを拡張の置き場へコピーする。

**1. コピーする。**

Windows（PowerShell）:

```powershell
Copy-Item -Recurse vscode "$env:USERPROFILE\.vscode\extensions\common-scope"
```

macOS / Linux:

```sh
cp -r vscode ~/.vscode/extensions/common-scope
```

**2. VS Code を再起動する。**

`.cmn` を開いて音節に色が付けば入っている。それ以上の機能がまだない...

**3. コマンドパレット（Windows と Linux は `Ctrl+Shift+P`、macOS は `Cmd+Shift+P`）から呼ぶ。**

| コマンド | |
|---|---|
| `Common scope: notebook を開く` | `server.py` を起動して VS Code の中に出す |
| `Common scope: このファイルを全パネルへ送る` | `Ctrl+Enter` でも同じ |
| `Common scope: パネルを一枚開く` | 層・DAG・ツイ数平面・lane64・接合秩 から選ぶ |
| `Common scope: server を止める` | |

### server.py が見つからないと言われたとき

拡張は開いている workspace の下から `common_scope_notebook/server.py` を探す。
別の場所へ置いたときは、設定にフォルダを絶対パスで書く。

```json
"commonScope.root": "C:\\tools\\common_scope_notebook"
```

| 設定 | 既定 | |
|---|---|---|
| `commonScope.root` | 空 | `common_scope_notebook` のフォルダ |
| `commonScope.port` | 8787 | `server.py` の port |
| `commonScope.python` | `python` | `server.py` を動かす実行ファイル |
