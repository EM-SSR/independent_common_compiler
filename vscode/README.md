# Common scope — VS Code 拡張

## 入れ方

`.vsix` は要らない。このフォルダをコピーするだけで入る。

Windows（PowerShell）:

```powershell
Copy-Item -Recurse vscode "$env:USERPROFILE\.vscode\extensions\common-scope"
```

macOS / Linux:

```sh
cp -r vscode ~/.vscode/extensions/common-scope
```

VS Code を再起動する。`.cmn` を開いて音節に色が付けば入っている。

## 使い方

コマンドパレット（`Ctrl+Shift+P`、macOS は `Cmd+Shift+P`）から呼ぶ。

| コマンド | |
|---|---|
| `Common scope: notebook を開く` | `server.py` を起動して VS Code の中に出す |
| `Common scope: このファイルを全パネルへ送る` | `Ctrl+Enter` でも同じ |
| `Common scope: パネルを一枚開く` | 層・DAG・ツイ数平面・lane64・接合秩 から選ぶ |
| `Common scope: server を止める` | |

## 設定

`server.py` が見つからないと言われたら、フォルダを絶対パスで書く。

```json
"commonScope.root": "C:\\tools\\common_scope_notebook"
```

| 設定 | 既定 | |
|---|---|---|
| `commonScope.root` | 空 | `common_scope_notebook` のフォルダ。空なら workspace から探す |
| `commonScope.port` | 8787 | `server.py` の port |
| `commonScope.python` | `python` | `server.py` を動かす実行ファイル |
