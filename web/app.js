// Common scope notebook の表側。
//
// ウィンドウは二形ある。
//   full   notebook と scope を並べる
//   solo   ?pane=<名前> で scope 一枚だけ。別のディスプレイへ出すため
//
// どちらのウィンドウも自分の kernel を持つ。同期するのは平文と初期値だけで、
// 計算はウィンドウごとに回す。lane の作業領域は交わらない（20 式 1.2）ので、
// 同じ平文を何枚実行しても state が混ざらない。

const CDN = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
const MDCDN = 'https://cdn.jsdelivr.net/npm/common-scope-web@0/';  // vendor/web が無いときの逃げ道

const PANES = {
  chamber: ['層と机', 'S(k,q,r) = Atom     r = 層境界音 ka の数、q = 机の位置（16 §2）\nfr(Λ_{r+1}) = fr(Λ_r) の未消費部 ‖ 層 r の出力（19 §4.2）', s => drawChamber(s)],
  dag: ['箱の DAG', 'commonc の OPK / OPA / OPB / OPD をそのまま（19 §3.2）\nδ(Cst(x,d)) = d,  δ(u⊕v) = max,  δ(u⋆v) = δu + δv（19 式 4.2）', s => drawDag(s)],
  tsui: ['ツイ数平面', null, s => drawTsui(s)],
  lane: ['lane64', 'Σ_lane64 = ℤ^(W×L) × ℤ^(W×S) × ℕ × {0,1}^W × ℰ* × Σ_out*（20 式 1.1）\nblock の入口 ℬ = {0} ∪ {i+d_i} ∪ {i+1}（式 7.4）、層 Λ_r = {v | h(v) = r}（式 7.2）', s => drawLane(s)],
  joint: ['接合秩', 'F[α][β] = f(α,β)      ρ = rank_𝔽₂ F\nf = ⊕_{r<ρ} p_r(x_A) q_r(x_B)      （Common-Lang/1 定理 4.1）', () => drawJoint(lastJoint)],
  text: ['音節と箱', null, s => drawText(s)],
};

const solo = new URLSearchParams(location.search).get('pane');
let py = null, nb = null, nbFile = null, dirty = false;
let lastScope = null, lastJoint = null, cur = -1;

// ===== 起動 =====

function log(msg, cls) {
  const li = document.createElement('li');
  li.textContent = msg;
  if (cls) li.className = cls;
  document.getElementById('bootlog').appendChild(li);
}

function loadScript(src) {
  return new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => no(new Error(src));
    document.head.appendChild(s);
  });
}

async function boot() {
  const rt = await (await fetch('/api/runtime')).json();
  if (rt.missing.length) {
    log('配信できないファイル: ' + rt.missing.join(', '), 'bad');
    document.getElementById('bootmsg').textContent =
      'setup.py を実行して runtime/ を揃えてください。';
    return;
  }
  try {
    await startRender(rt.web || MDCDN);
    log('Markdown と KaTeX を読み込みました', 'ok');
  } catch (e) {
    log('Markdown の library を読めません。説明は素のまま出ます', 'bad');
  }
  const index = rt.pyodide || CDN;
  log(rt.pyodide ? 'Pyodide はこのフォルダのコピーを使います' : 'Pyodide を CDN から取ります', 'ok');
  await loadScript(index + 'pyodide.js');
  const pyodide = await loadPyodide({ indexURL: index });
  log('CPython ' + pyodide.version + ' がブラウザの中で動きました', 'ok');

  pyodide.FS.mkdir('/common');
  for (const f of rt.files) {
    const buf = new Uint8Array(await (await fetch('/runtime/' + f)).arrayBuffer());
    pyodide.FS.writeFile('/common/' + f, buf);
  }
  log('lane64 の実行台と commonc の image を読み込みました（' + rt.files.length + ' 個）', 'ok');

  pyodide.runPython(await (await fetch('boot.py')).text());
  pyodide.runPython('ready()');
  py = {
    cell: s => JSON.parse(pyodide.globals.get('cell')(s)),
    joint: s => JSON.parse(pyodide.globals.get('joint')(s)),
  };
  const k = document.getElementById('kernel');
  k.textContent = 'lane64 稼働中';
  k.className = 'tag ok';
  document.getElementById('boot').classList.add('done');
}

// ===== ウィンドウ間の同期 =====

function publish(patch) {
  fetch('/state', { method: 'POST', body: JSON.stringify(patch) }).catch(() => { });
}

// ===== 本文 =====
//
// 説明セルは Markdown で書く。数式は $…$ と $$…$$。画像と動画は assets/ へ置いて
// ![](assets/x.png) や <video src="assets/x.mp4" controls> で貼る。描くのは render.js。

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

function markInto(el, text) { return renderMarkdown(el, text); }

// 説明の編集欄。書いている間はすぐ下に見え、file を落とすと assets/ へ上がる
function attachEditor(area, get, set, onDone) {
  const live = document.createElement('div');
  live.className = 'md livepreview';
  let timer = null;
  const draw = () => markInto(live, get());
  area.addEventListener('input', () => {
    set(area.value);
    clearTimeout(timer);
    timer = setTimeout(draw, 220);
  });
  area.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    area.classList.add('over');
  });
  area.addEventListener('dragleave', () => area.classList.remove('over'));
  area.addEventListener('drop', async e => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    e.stopPropagation();
    area.classList.remove('over');
    const lines = [];
    for (const f of e.dataTransfer.files) {
      try { lines.push(assetMarkdown(await uploadAsset(f), f)); }
      catch (err) { alert(err.message); }
    }
    const at = area.selectionStart;
    area.value = area.value.slice(0, at) + '\n' + lines.join('\n') + '\n' + area.value.slice(at);
    set(area.value);
    draw();
    touch();
  });
  area.addEventListener('paste', async e => {
    const files = [...(e.clipboardData.files || [])];
    if (!files.length) return;
    e.preventDefault();
    const lines = [];
    for (const f of files) {
      try { lines.push(assetMarkdown(await uploadAsset(f), f)); }
      catch (err) { alert(err.message); }
    }
    const at = area.selectionStart;
    area.value = area.value.slice(0, at) + lines.join('\n') + area.value.slice(at);
    set(area.value);
    draw();
    touch();
  });
  area.addEventListener('blur', () => {
    clearTimeout(timer);
    live.remove();
    onDone();
  });
  const show = () => {
    area.after(live);
    draw();
  };
  return show;
}

// ===== notebook の出し入れ =====
//
// 保存先は server の notebooks/ になる。書きかけは localStorage にも置くので、
// 保存の前にタブを閉じても戻せる。

const DRAFT = 'common-scope-draft:';

function blank() {
  return {
    title: '名前のない notebook',
    lead: '',
    dic: '',
    cells: [{ kind: 'cmn', text: '', source: 'hu hu ka, no ka.' }],
  };
}

function touch() {
  dirty = true;
  try { localStorage.setItem(DRAFT + nbFile, JSON.stringify(nb)); } catch (e) { /* 保存できなくても動く */ }
  const s = document.getElementById('save');
  if (s) s.textContent = '保存 *';
}

function clean() {
  dirty = false;
  try { localStorage.removeItem(DRAFT + nbFile); } catch (e) { /* 同上 */ }
  const s = document.getElementById('save');
  if (s) s.textContent = '保存';
}

async function listNotebooks() {
  window._nbs = await (await fetch('/api/notebooks')).json();
  const pick = document.getElementById('pick');
  pick.innerHTML = '';
  window._nbs.forEach(n => {
    const o = document.createElement('option');
    o.value = n.file; o.textContent = n.title;
    pick.appendChild(o);
  });
  if (nbFile) pick.value = nbFile;
  renderToc();
}

async function openNotebook(file) {
  if (dirty && !confirm('保存していない変更があります。破棄して開きますか。')) return;
  nbFile = file;
  nb = await (await fetch('/api/notebook/' + file)).json();
  let draft = null;
  try { draft = localStorage.getItem(DRAFT + file); } catch (e) { /* 無ければ保存分を使う */ }
  if (draft && confirm('保存していない書きかけがあります。そちらを開きますか。')) {
    nb = JSON.parse(draft);
    dirty = true;
  } else {
    try { localStorage.removeItem(DRAFT + file); } catch (e) { /* 同上 */ }
    dirty = false;
  }
  nb.cells.forEach(c => { c.result = null; });
  document.getElementById('pick').value = file;
  renderSheet();
  renderToc();
  publish({ notebook: file });
}

function adoptNotebook(file, doc) {
  nbFile = file;
  nb = doc;
  nb.cells = nb.cells || [];
  renderSheet();
  renderToc();
  touch();
}

async function saveNotebook(as) {
  let file = nbFile;
  if (as || !file) {
    const guess = (nb.title || 'notebook').replace(/[^\w一-龠ぁ-んァ-ヶー0-9]+/g, '_');
    file = prompt('保存する名前', (file || guess + '.json').replace(/\.json$/, '') + '.json');
    if (!file) return;
  }
  const body = JSON.parse(JSON.stringify(nb));
  body.cells.forEach(c => { delete c.result; });
  const r = await fetch('/api/notebook/' + encodeURIComponent(file),
    { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) { alert('保存できません: ' + r.status); return; }
  nbFile = (await r.json()).file;
  clean();
  await listNotebooks();
  document.getElementById('pick').value = nbFile;
}

async function deleteNotebook() {
  if (!nbFile || !confirm(nbFile + ' を消しますか。')) return;
  await fetch('/api/notebook/' + encodeURIComponent(nbFile), { method: 'DELETE' });
  try { localStorage.removeItem(DRAFT + nbFile); } catch (e) { /* 同上 */ }
  nbFile = null;
  await listNotebooks();
  if (window._nbs.length) await openNotebook(window._nbs[0].file);
  else { nb = blank(); nbFile = 'notebook.json'; renderSheet(); }
}

function download() {
  const body = JSON.parse(JSON.stringify(nb));
  body.cells.forEach(c => { delete c.result; });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
  a.download = nbFile || 'notebook.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ===== 画面 =====

function renderToc() {
  const t = document.getElementById('toc');
  t.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'head';
  head.textContent = 'NOTEBOOK';
  t.appendChild(head);
  (window._nbs || []).forEach(n => {
    const a = document.createElement('a');
    a.textContent = n.title;
    a.href = '#';
    a.title = n.file;
    if (n.file === nbFile) a.className = 'on';
    a.onclick = e => { e.preventDefault(); openNotebook(n.file); };
    t.appendChild(a);
  });
  const add = document.createElement('a');
  add.textContent = '＋ 新しい notebook';
  add.href = '#';
  add.className = 'add';
  add.onclick = e => {
    e.preventDefault();
    if (dirty && !confirm('保存していない変更があります。破棄しますか。')) return;
    nbFile = 'notebook.json';
    nb = blank();
    dirty = false;
    renderSheet();
    renderToc();
  };
  t.appendChild(add);
}

function button(label, title, fn) {
  const b = document.createElement('button');
  b.textContent = label;
  if (title) b.title = title;
  b.onclick = fn;
  return b;
}

function field(label, value, fn, width) {
  const w = document.createElement('label');
  w.className = 'field';
  w.appendChild(document.createTextNode(label));
  const i = document.createElement('input');
  i.value = value === undefined || value === null ? '' : value;
  if (width) i.style.width = width;
  i.oninput = () => { fn(i.value); touch(); };
  w.appendChild(i);
  return w;
}

function renderSheet() {
  const host = document.getElementById('sheet');
  host.innerHTML = '';

  // ---- 道具立て ----
  const bar = document.createElement('div');
  bar.className = 'toolbar';
  const save = button('保存', 'notebooks/ へ書き込みます', () => saveNotebook(false));
  save.id = 'save';
  if (dirty) save.textContent = '保存 *';
  bar.append(
    button('すべて実行', '上から順に全ての文を実行します', runAll),
    save,
    button('名前を付けて保存', null, () => saveNotebook(true)),
    button('ダウンロード', '.json として手元へ保存します', download),
    button('削除', 'この notebook を消します', deleteNotebook));
  host.appendChild(bar);

  // ---- 表題と説明と採用語彙 ----
  const head = document.createElement('div');
  head.id = 'intro';
  const h1 = document.createElement('input');
  h1.className = 'title';
  h1.value = nb.title || '';
  h1.placeholder = '表題';
  h1.oninput = () => { nb.title = h1.value; touch(); };
  head.appendChild(h1);

  const lead = document.createElement('div');
  lead.className = 'lead md';
  markInto(lead, nb.lead || '');
  const leadEdit = document.createElement('textarea');
  leadEdit.className = 'leadedit';
  leadEdit.value = nb.lead || '';
  leadEdit.placeholder = '説明。$$ で数式、| で表、** で強調';
  leadEdit.hidden = true;
  const showLead = attachEditor(leadEdit, () => leadEdit.value,
    v => { nb.lead = v; touch(); },
    () => { leadEdit.hidden = true; lead.hidden = false; markInto(lead, nb.lead || ''); });
  lead.onclick = () => {
    lead.hidden = true;
    leadEdit.hidden = false;
    leadEdit.style.height = Math.max(140, leadEdit.scrollHeight) + 'px';
    leadEdit.focus();
    showLead();
  };
  lead.title = 'クリックすると書き換えられます';
  head.append(lead, leadEdit);

  const dic = document.createElement('details');
  dic.className = 'settings';
  const sum = document.createElement('summary');
  sum.textContent = '採用語彙（.dic）';
  const dicText = document.createElement('textarea');
  dicText.value = nb.dic || '';
  dicText.placeholder = '見出し ⟨tab⟩ 文。=N で数だけの語\n例:  pepe\t=8';
  dicText.rows = 6;
  dicText.oninput = () => { nb.dic = dicText.value; touch(); };
  dic.append(sum, dicText);
  head.appendChild(dic);
  host.appendChild(head);

  // ---- セル ----
  const cells = document.createElement('div');
  cells.id = 'cells';
  host.appendChild(cells);
  redrawCells();

  host.appendChild(adder(nb.cells.length));
}

function adder(at) {
  const d = document.createElement('div');
  d.className = 'adder';
  d.append(
    button('＋ Common', 'Common の文を書くセルを足します', () => {
      nb.cells.splice(at, 0, { kind: 'cmn', text: '', source: '' });
      touch(); redrawCells();
    }),
    button('＋ 説明', '文章だけのセルを足します', () => {
      nb.cells.splice(at, 0, { kind: 'note', text: '' });
      touch(); redrawCells();
    }));
  return d;
}

function redrawCells() {
  const host = document.getElementById('cells');
  host.innerHTML = '';
  nb.cells.forEach((c, i) => {
    host.appendChild(renderCell(c, i));
    host.appendChild(adder(i + 1));
  });
}

function move(i, d) {
  const j = i + d;
  if (j < 0 || j >= nb.cells.length) return;
  const [c] = nb.cells.splice(i, 1);
  nb.cells.splice(j, 0, c);
  touch(); redrawCells();
}

function renderCell(c, i) {
  const d = document.createElement('div');
  d.className = 'cell' + (c.kind === 'note' ? ' note' : '');

  // 説明。クリックで書き換えに変わる
  const note = document.createElement('div');
  note.className = 'note md';
  if (c.text) markInto(note, c.text);
  else note.innerHTML = '<p class="empty">クリックすると説明を書けます。Markdown と $数式$ が使えます</p>';
  const noteEdit = document.createElement('textarea');
  noteEdit.className = 'noteedit';
  noteEdit.value = c.text || '';
  noteEdit.hidden = true;
  const showNote = attachEditor(noteEdit, () => noteEdit.value,
    v => { c.text = v; touch(); },
    () => {
      noteEdit.hidden = true; note.hidden = false;
      if (c.text) markInto(note, c.text);
      else note.innerHTML = '<p class="empty">クリックすると説明を書けます。Markdown と $数式$ が使えます</p>';
    });
  note.onclick = () => {
    note.hidden = true; noteEdit.hidden = false;
    noteEdit.style.height = Math.max(110, noteEdit.scrollHeight) + 'px';
    noteEdit.focus();
    showNote();
  };
  d.append(note, noteEdit);

  const tools = document.createElement('div');
  tools.className = 'tools';
  tools.append(
    button('↑', '上へ', () => move(i, -1)),
    button('↓', '下へ', () => move(i, 1)),
    button('複製', null, () => {
      nb.cells.splice(i + 1, 0, JSON.parse(JSON.stringify({ ...c, result: null })));
      touch(); redrawCells();
    }),
    button('削除', null, () => {
      const has = (c.source || '').trim() || (c.text || '').trim();
      if (has && !confirm('このセルを消しますか。')) return;
      nb.cells.splice(i, 1);
      touch(); redrawCells();
    }));

  if (c.kind === 'note') {
    d.appendChild(tools);
    return d;
  }

  const row = document.createElement('div');
  row.className = 'row';
  const gut = document.createElement('div');
  gut.className = 'gut';
  gut.textContent = '[' + (i + 1) + ']';
  const ta = document.createElement('textarea');
  ta.className = 'src';
  ta.value = c.source || '';
  ta.spellcheck = false;
  ta.placeholder = 'hu hu ka, no ka.';
  ta.rows = Math.max(2, (c.source || '').split('\n').length);
  ta.oninput = () => { c.source = ta.value; touch(); };
  ta.onkeydown = e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(i); }
  };
  ta.ondragover = e => { e.preventDefault(); ta.classList.add('over'); };
  ta.ondragleave = () => ta.classList.remove('over');
  ta.ondrop = async e => {
    e.preventDefault();
    ta.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (!f) return;
    ta.value = c.source = await f.text();
    ta.rows = Math.max(2, c.source.split('\n').length);
    touch();
    run(i);
  };
  row.append(gut, ta);
  d.appendChild(row);

  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.appendChild(button('Run', 'Ctrl+Enter', () => run(i)));
  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = 'Ctrl+Enter で実行。.cmn をドロップすると差し替えます';
  bar.append(hint, tools);
  d.appendChild(bar);

  // ---- セルの設定 ----
  const set = document.createElement('details');
  set.className = 'settings';
  const sum = document.createElement('summary');
  sum.textContent = 'このセルの設定';
  set.appendChild(sum);
  const grid = document.createElement('div');
  grid.className = 'fields';
  grid.append(
    field('初期値（語=値）', seedText(c.seeds), v => { c.seeds = parseSeeds(v); }, '13em'),
    field('語数', c.words || '', v => { c.words = v ? Number(v) : undefined; }, '7em'),
    field('入力の語（接合秩）', (c.inputs || []).join(','), v => {
      c.inputs = v.trim() ? v.split(',').map(x => Number(x.trim())) : undefined;
    }, '9em'),
    field('カット κ', c.cut === undefined ? '' : c.cut, v => {
      c.cut = v === '' ? undefined : Number(v);
    }, '4em'),
    field('読む語', c.out || '', v => { c.out = v ? Number(v) : undefined; }, '4em'));
  set.appendChild(grid);
  d.appendChild(set);

  const out = document.createElement('div');
  out.className = 'out';
  out.id = 'out' + i;
  d.appendChild(out);
  if (c.result) showResult(i, c.result);
  return d;
}

function seedText(s) {
  return s ? Object.entries(s).map(([k, v]) => k + '=' + v).join(' ') : '';
}

function parseSeeds(v) {
  const out = {};
  for (const t of v.split(/[\s,]+/)) {
    const m = t.match(/^(\d+)=(-?\d+)$/);
    if (m) out[m[1]] = Number(m[2]);
  }
  return Object.keys(out).length ? out : undefined;
}

// ===== 実行 =====

function specOf(c) {
  return {
    source: c.source, dic: nb.dic || null, seeds: c.seeds || null,
    words: c.words || null, budget: c.budget || null,
  };
}

function viewOf(c) {
  return { inputs: c.inputs || null, cut: c.cut === undefined ? null : c.cut, out: c.out || 0 };
}

function run(i) {
  if (!py) return;
  const c = nb.cells[i];
  const spec = specOf(c);
  lastScope = py.cell(JSON.stringify(spec));
  lastJoint = null;
  cur = i;
  c.result = lastScope;
  showResult(i, lastScope);
  if (usesJoint()) runJoint(c);
  renderGrid();
  publish({ cell: i, notebook: nbFile, spec: spec, view: viewOf(c) });
}

function runAll() {
  nb.cells.forEach((c, i) => { if (c.kind !== 'note' && (c.source || '').trim()) run(i); });
}

function runJoint(c) {
  lastJoint = (py && c && c.inputs)
    ? py.joint(JSON.stringify(Object.assign(specOf(c), viewOf(c)))) : null;
}

function showResult(i, sc) {
  const host = document.getElementById('out' + i);
  if (!host) return;
  if (!sc.ok) {
    const want = nb.cells[i] && nb.cells[i].expect === 'fail';
    host.innerHTML = '<div class="' + (want ? 'expected' : 'err') + '">'
      + (want ? '読み手が止めた: ' : '') + esc(sc.error) + '</div>';
    return;
  }
  const tag = sc.report === 0 ? 'tu（成功）' : sc.report === 42 ? 'te（失敗）' : '報告なし';
  const vals = sc.gamma.length
    ? sc.gamma.map(g => `語${g.word} = ${g.den === 1 ? g.num : g.num + '/' + g.den}`).join('　')
    : '出口境界は空';
  host.innerHTML =
    '<div class="val">' + vals + '</div>' +
    (sc.put ? '<div>Put: ' + esc(sc.put) + '</div>' : '') +
    '<div class="dim">' + tag + '　音節 ' + sc.size.syl + '　箱 ' + sc.size.box +
    '　image ' + sc.size.image + ' byte / ' + sc.image.insns + ' 命令　block ' +
    sc.image.blocks.length + '　hash ' + sc.mark + '</div>';
}

// ===== scope のパネル配置 =====
//
// パネルは二分木で持つ。
//
//   {t:'leaf', pane}
//   {t:'split', dir:'row'|'col', a, b, ratio}
//
// 上のタブをパネルへドロップすると、落とした縁で分かれる。中央なら差し替える。
// パネル名を掴んで別のパネルへ落とすと入れ替わる。ヘッダのボタンでも分けられる。

const KEY = 'common-scope-layout';
let layout = null, dragPane = null, dragFrom = null;

function defaultLayout() {
  return {
    t: 'split', dir: 'col', ratio: 0.5,
    a: { t: 'leaf', pane: 'chamber' },
    b: { t: 'leaf', pane: 'dag' },
  };
}

function loadLayout() {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return JSON.parse(s);
  } catch (e) { /* localStorage が無い環境では既定の配置で始める */ }
  return defaultLayout();
}

function saveLayout() {
  try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch (e) { /* 保存できなくても動く */ }
}

function usesJoint() {
  let hit = false;
  (function walk(n) {
    if (!n) return;
    if (n.t === 'leaf') { if (n.pane === 'joint') hit = true; return; }
    walk(n.a); walk(n.b);
  })(layout);
  return hit || solo === 'joint';
}

function renderPalette() {
  const p = document.getElementById('palette');
  p.innerHTML = '';
  const h = document.createElement('span');
  h.className = 'hint';
  h.textContent = 'パネルへドロップすると分かれます';
  p.appendChild(h);
  for (const key in PANES) {
    const c = document.createElement('span');
    c.className = 'tab';
    c.textContent = PANES[key][0];
    c.draggable = true;
    c.title = 'ドラッグしてパネルへ';
    c.ondragstart = e => {
      dragPane = key; dragFrom = null;
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', key);
    };
    p.appendChild(c);
  }
  const reset = document.createElement('span');
  reset.className = 'tab';
  reset.textContent = '既定に戻す';
  reset.style.marginLeft = 'auto';
  reset.onclick = () => { layout = defaultLayout(); saveLayout(); renderGrid(); };
  p.appendChild(reset);
}

function paneBody(key) {
  const [, formula, make] = PANES[key];
  if (!lastScope) return nothing('セルを実行してください。');
  if (!lastScope.ok) return nothing(lastScope.error);
  const d = document.createElement('div');
  if (formula) {
    const f = document.createElement('div');
    f.className = 'formula';
    f.textContent = formula;
    d.appendChild(f);
  }
  d.appendChild(make(lastScope));
  if (key === 'chamber' && !lastScope.align.ok) {
    d.appendChild(nothing('音節と箱の対応: ' + lastScope.align.why));
  }
  return d;
}

function makeLeaf(node, parent) {
  const d = document.createElement('div');
  d.className = 'leaf';

  const head = document.createElement('header');
  head.draggable = true;
  head.ondragstart = e => {
    dragPane = node.pane; dragFrom = node;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', node.pane);
  };
  const sel = document.createElement('select');
  sel.className = 'name';
  for (const k in PANES) {
    const o = document.createElement('option');
    o.value = k; o.textContent = PANES[k][0];
    sel.appendChild(o);
  }
  sel.value = node.pane;
  sel.onchange = () => { node.pane = sel.value; renderGrid(); };
  const sp = document.createElement('span');
  sp.className = 'sp';
  head.append(sel, sp,
    button('⊟', '横に分ける', () => { dropInto(node, node.pane, 'bottom'); renderGrid(); }),
    button('⊞', '縦に分ける', () => { dropInto(node, node.pane, 'right'); renderGrid(); }),
    button('⧉', '別ウィンドウで開く', () => window.open('?pane=' + node.pane, '_blank')),
    button('✕', 'このパネルを閉じる', () => { removeNode(node); renderGrid(); }));
  if (!parent) head.lastChild.disabled = true;

  const body = document.createElement('div');
  body.className = 'body';
  body.appendChild(paneBody(node.pane));
  d.append(head, body);

  // ドロップ。落とした縁で分ける
  const hint = document.createElement('div');
  hint.className = 'dropmark';
  hint.hidden = true;
  d.appendChild(hint);
  const zoneOf = e => {
    const r = d.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
    const m = Math.min(u, 1 - u, v, 1 - v);
    if (m > 0.28) return 'center';
    if (m === u) return 'left';
    if (m === 1 - u) return 'right';
    return m === v ? 'top' : 'bottom';
  };
  d.ondragover = e => {
    if (!dragPane) return;
    e.preventDefault();
    const s = { left: [0, 0, '50%', '100%'], right: ['50%', 0, '50%', '100%'],
                top: [0, 0, '100%', '50%'], bottom: [0, '50%', '100%', '50%'],
                center: [0, 0, '100%', '100%'] }[zoneOf(e)];
    hint.hidden = false;
    hint.style.left = typeof s[0] === 'number' ? s[0] + 'px' : s[0];
    hint.style.top = typeof s[1] === 'number' ? s[1] + 'px' : s[1];
    hint.style.width = s[2];
    hint.style.height = s[3];
  };
  d.ondragleave = () => { hint.hidden = true; };
  d.ondrop = e => {
    e.preventDefault();
    hint.hidden = true;
    if (!dragPane) return;
    const z = zoneOf(e), moved = dragPane;
    if (dragFrom && dragFrom !== node) removeNode(dragFrom);
    dropInto(node, moved, z);
    dragPane = dragFrom = null;
    renderGrid();
  };
  return d;
}

function dropInto(node, pane, zone) {
  if (zone === 'center') { node.pane = pane; return; }
  const fresh = { t: 'leaf', pane: pane };
  const here = { t: 'leaf', pane: node.pane };
  const dir = (zone === 'left' || zone === 'right') ? 'row' : 'col';
  const first = (zone === 'left' || zone === 'top') ? fresh : here;
  node.t = 'split';
  node.dir = dir;
  node.ratio = 0.5;
  node.a = first;
  node.b = first === fresh ? here : fresh;
  delete node.pane;
}

function removeNode(target) {
  const parent = findParent(layout, target);
  if (!parent) return;
  const other = parent.a === target ? parent.b : parent.a;
  Object.keys(parent).forEach(k => delete parent[k]);
  Object.assign(parent, other);
}

function findParent(n, target) {
  if (!n || n.t !== 'split') return null;
  if (n.a === target || n.b === target) return n;
  return findParent(n.a, target) || findParent(n.b, target);
}

function makeNode(node, parent) {
  if (node.t === 'leaf') return makeLeaf(node, parent);
  const d = document.createElement('div');
  d.className = 'node ' + node.dir;
  const a = makeNode(node.a, node), b = makeNode(node.b, node);
  a.style.flex = node.ratio + ' 1 0';
  b.style.flex = (1 - node.ratio) + ' 1 0';
  const gap = document.createElement('div');
  gap.className = 'gap';
  gap.onmousedown = e => {
    e.preventDefault();
    const rect = d.getBoundingClientRect();
    const move = ev => {
      const r = node.dir === 'row'
        ? (ev.clientX - rect.left) / rect.width
        : (ev.clientY - rect.top) / rect.height;
      node.ratio = Math.min(0.88, Math.max(0.12, r));
      a.style.flex = node.ratio + ' 1 0';
      b.style.flex = (1 - node.ratio) + ' 1 0';
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      saveLayout();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  d.append(a, gap, b);
  return d;
}

function renderGrid() {
  if (solo) {
    const host = document.getElementById('soloScope');
    host.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'solobody';
    d.appendChild(paneBody(solo));
    host.appendChild(d);
    return;
  }
  const host = document.getElementById('grid');
  host.innerHTML = '';
  host.appendChild(makeNode(layout, null));
  saveLayout();
}

// ===== 入口 =====

async function main() {
  document.body.dataset.mode = solo ? 'solo' : 'full';
  layout = solo ? null : loadLayout();
  if (solo) {
    document.getElementById('solo').hidden = false;
    document.getElementById('soloHead').textContent =
      (PANES[solo] ? PANES[solo][0] : solo) +
      ' — メインウィンドウが送る平文を、このウィンドウの kernel が実行します';
  }
  await boot();

  if (!solo) {
    await listNotebooks();
    document.getElementById('pick').onchange = e => openNotebook(e.target.value);
    renderPalette();
    renderGrid();
    if (window._nbs.length) await openNotebook(window._nbs[0].file);
    else { nbFile = 'notebook.json'; nb = blank(); renderSheet(); renderToc(); }

    // .json を落とすと開く。.cmn を落とすとセルが増える
    const sheet = document.getElementById('sheet');
    sheet.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
    sheet.addEventListener('drop', async e => {
      const f = e.dataTransfer.files[0];
      if (!f) return;
      e.preventDefault();
      const text = await f.text();
      if (f.name.endsWith('.json')) adoptNotebook(f.name, JSON.parse(text));
      else if (f.name.endsWith('.dic')) { nb.dic = text; touch(); renderSheet(); }
      else { nb.cells.push({ kind: 'cmn', text: '', source: text }); touch(); renderSheet(); }
    });
    window.addEventListener('beforeunload', e => { if (dirty) e.preventDefault(); });
  } else {
    renderGrid();
  }

  new EventSource('/events').onmessage = ev => {
    const st = JSON.parse(ev.data);
    if (!solo || !py || !st.spec) return;
    lastScope = py.cell(JSON.stringify(st.spec));
    lastJoint = null;
    if (solo === 'joint' && st.view && st.view.inputs) {
      lastJoint = py.joint(JSON.stringify(Object.assign({}, st.spec, st.view)));
    }
    renderGrid();
  };
}

main();
