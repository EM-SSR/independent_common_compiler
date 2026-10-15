// Common scope の VS Code 拡張。
//
// web 版と同じ server.py を使う。拡張が足すのは三つだけになる。
//
//   1. server.py の起動と停止
//   2. notebook を webview で開く
//   3. 編集中の .cmn を hub へ送り、開いている全パネルを更新する
//
// 計算は拡張の中に無い。平文は server の /state へ渡り、各ウィンドウの
// kernel がそれぞれ実行する。lane の作業領域は交わらない（20 式 1.2）ので、
// 何枚開いても state が混ざらない。

const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

let server = null;      // 起動した server.py の process
let out = null;         // その標準出力を写す channel

function cfg(key) {
  return vscode.workspace.getConfiguration('commonScope').get(key);
}

// ===== server.py の場所 =====
//
// 設定が空なら、開いている folder の下から common_scope_notebook/server.py を探す。

function findRoot() {
  const set = cfg('root');
  if (set) return set;
  const rel = path.join('continuous_republic', 'common_apps', 'common_scope_notebook');
  for (const f of vscode.workspace.workspaceFolders || []) {
    for (const c of [path.join(f.uri.fsPath, rel), f.uri.fsPath]) {
      if (fs.existsSync(path.join(c, 'server.py'))) return c;
    }
  }
  return null;
}

function url(pathname) {
  return `http://127.0.0.1:${cfg('port')}${pathname || '/'}`;
}

function alive() {
  return new Promise(ok => {
    const req = http.get(url('/api/state'), r => { r.resume(); ok(r.statusCode === 200); });
    req.on('error', () => ok(false));
    req.setTimeout(400, () => { req.destroy(); ok(false); });
  });
}

async function ensureServer() {
  if (await alive()) return true;
  const root = findRoot();
  if (!root) {
    vscode.window.showErrorMessage(
      'common_scope_notebook が見つかりません。設定 commonScope.root にフォルダを書いてください。');
    return false;
  }
  out = out || vscode.window.createOutputChannel('Common scope');
  server = cp.spawn(cfg('python'),
    [path.join(root, 'server.py'), '--port', String(cfg('port')), '--no-browser'],
    { cwd: root });
  server.stdout.on('data', d => out.append(d.toString()));
  server.stderr.on('data', d => out.append(d.toString()));
  server.on('exit', c => { out.appendLine(`server 終了 (${c})`); server = null; });

  for (let k = 0; k < 40; k++) {
    await new Promise(r => setTimeout(r, 250));
    if (await alive()) return true;
  }
  out.show(true);
  vscode.window.showErrorMessage('server.py が起動しません。出力を確認してください。');
  return false;
}

// ===== hub へ送る =====

function post(body) {
  return new Promise((ok, no) => {
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(url('/state'),
      { method: 'POST', headers: { 'Content-Length': data.length } },
      r => { r.resume(); ok(r.statusCode); });
    req.on('error', no);
    req.end(data);
  });
}

// 同じフォルダに .dic があれば採用語彙として一緒に送る
function dicBeside(file) {
  const dir = path.dirname(file);
  const own = path.join(dir, path.basename(file, '.cmn') + '.dic');
  if (fs.existsSync(own)) return fs.readFileSync(own, 'utf8');
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.dic')) return fs.readFileSync(path.join(dir, f), 'utf8');
  }
  return null;
}

async function send() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !ed.document.fileName.endsWith('.cmn')) {
    vscode.window.showWarningMessage('.cmn を開いてから実行してください。');
    return;
  }
  if (!(await ensureServer())) return;
  await post({
    notebook: path.basename(ed.document.fileName),
    spec: { source: ed.document.getText(), dic: dicBeside(ed.document.fileName),
            seeds: null, words: null, budget: null },
    view: { inputs: null, cut: null, out: 0 },
  });
}

// ===== webview =====

function panel(title, pathname) {
  const p = vscode.window.createWebviewPanel('commonScope', title,
    vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
  const src = url(pathname);
  p.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>html,body,iframe{margin:0;padding:0;height:100%;width:100%;border:0}</style>
</head><body><iframe src="${src}"></iframe></body></html>`;
  return p;
}

const PANES = {
  '層と机': 'chamber', '箱の DAG': 'dag', 'ツイ数平面': 'tsui',
  'lane64': 'lane', '接合秩': 'joint', '音節と箱': 'text',
};

function activate(ctx) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('commonScope.open', async () => {
      if (await ensureServer()) panel('Common scope notebook', '/');
    }),
    vscode.commands.registerCommand('commonScope.send', send),
    vscode.commands.registerCommand('commonScope.pane', async () => {
      const pick = await vscode.window.showQuickPick(Object.keys(PANES),
        { placeHolder: '開くパネル' });
      if (!pick) return;
      if (await ensureServer()) panel(pick, '/?pane=' + PANES[pick]);
    }),
    vscode.commands.registerCommand('commonScope.stop', () => {
      if (server) { server.kill(); server = null; }
    }));
}

function deactivate() {
  if (server) server.kill();
}

module.exports = { activate, deactivate };
