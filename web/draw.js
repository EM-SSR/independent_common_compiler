// scope の描き分け。どの関数も kernel が返した値をそのまま形にする。
// 計算はここに置かない。
//
// 座標と色は common_apps/joinrank/svg/draw.py と同じものを使う。
// 同じ図を同じ読み方で見せるため、別の流儀を持ち込まない。

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs, text) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (text !== undefined) n.textContent = text;
  return n;
}

function svgBox(x, y, w, h) {
  const s = el('svg', { viewBox: `${x} ${y} ${w} ${h}`, width: w, height: h });
  s.style.maxWidth = '100%';
  return s;
}

function svg(w, h) { return svgBox(0, 0, w, h); }

function box(title, formula, node) {
  const d = document.createElement('div');
  d.className = 'scopebox';
  if (title) {
    const h = document.createElement('h2');
    h.textContent = title;
    d.appendChild(h);
  }
  if (formula) {
    const f = document.createElement('div');
    f.className = 'formula';
    f.textContent = formula;
    d.appendChild(f);
  }
  if (node) d.appendChild(node);
  return d;
}

function nothing(msg) {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = msg;
  return p;
}

function dyadText(num, d) {
  if (!d) return String(num);
  let n = num, k = d;
  while (k > 0 && n % 2 === 0) { n /= 2; k--; }
  return k === 0 ? String(n) : `${n}/${2 ** k}`;
}

// ===== 層と机（16 §2、19 §4.2）=====
//
// 層 r が行、机の位置 q が列。疎テンソル S(k,q,r) をそのまま平面へ置く。
// 箱は入口の区間 take を取り、出口の区間 give へ置く。ki は素通しの線になる。

function drawChamber(sc) {
  const rows = sc.frontier || [];
  if (!rows.length) return nothing('層がありません。');

  const COL = 46, ROW = 58, PAD = 40, TOP = 26;
  const wide = Math.max(1, ...rows.map(r => Math.max(r.in.length, r.out.length)));
  const W = PAD + wide * COL + 26, H = TOP + rows.length * ROW + 34;
  const s = svg(W, H);
  const x = q => PAD + q * COL + COL / 2;

  s.appendChild(el('text', { x: 4, y: TOP - 10, 'font-size': 9.5 }, 'q'));
  for (let q = 0; q < wide; q++) {
    s.appendChild(el('text', { x: x(q), y: TOP - 10, 'text-anchor': 'middle', 'font-size': 9.5 }, String(q)));
  }

  rows.forEach((row, i) => {
    const y0 = TOP + i * ROW, y1 = y0 + ROW;
    s.appendChild(el('line', { x1: PAD - 10, y1: y0, x2: W - 14, y2: y0, class: 'grid' }));
    s.appendChild(el('text', { x: 4, y: y0 + 16, class: 'lab', 'font-size': 10 }, 'Λ' + row.r));

    (row.put || []).forEach(p => {
      if (p.wire) {
        s.appendChild(el('path', {
          d: `M ${x(p.take[0])} ${y0} C ${x(p.take[0])} ${y0 + 22}, ${x(p.give[0])} ${y1 - 22}, ${x(p.give[0])} ${y1}`,
          class: 'wire'
        }));
        return;
      }
      const hasIn = p.take[1] > p.take[0], hasOut = p.give[1] > p.give[0];
      const xs = [];
      if (hasIn) { xs.push(x(p.take[0]), x(p.take[1] - 1)); }
      if (hasOut) { xs.push(x(p.give[0]), x(p.give[1] - 1)); }
      const bx = Math.min(...xs) - 16, bw = Math.max(...xs) - Math.min(...xs) + 32;
      const by = y0 + 21, bh = 19;
      const col = `var(--${p.cls || 'frame'})`;
      for (let q = p.take[0]; q < p.take[1]; q++) {
        s.appendChild(el('line', { x1: x(q), y1: y0, x2: x(q), y2: by, class: 'wire' }));
      }
      for (let q = p.give[0]; q < p.give[1]; q++) {
        s.appendChild(el('line', { x1: x(q), y1: by + bh, x2: x(q), y2: y1, class: 'wire' }));
      }
      const r = el('rect', { x: bx, y: by, width: bw, height: bh, class: 'box' });
      r.setAttribute('stroke', col);
      s.appendChild(r);
      const t = el('text', { x: bx + bw / 2, y: by + 13.5, 'text-anchor': 'middle', 'font-size': 11 }, p.syl);
      t.setAttribute('fill', col);
      s.appendChild(t);
    });
  });

  const last = rows[rows.length - 1];
  s.appendChild(el('text', { x: 4, y: H - 12, class: 'lab', 'font-size': 10 }, 'Γ⁺'));
  last.out.forEach((w, q) =>
    s.appendChild(el('text', { x: x(q), y: H - 12, 'text-anchor': 'middle', 'font-size': 10 }, w)));
  return s;
}

// ===== 箱の DAG（19 §4.2、§4.3）=====

const KINDCLS = {
  Cst: 'dyad', Add: 'dyad', Mul: 'dyad', Neg: 'dyad',
  Load: 'store', Store: 'store', Ok: 'report', EqBr: 'bit', LtBr: 'bit'
};

function drawDag(sc) {
  const bs = sc.boxes || [];
  if (!bs.length) return nothing('箱がありません。');
  if (bs.length > 260) {
    const p = document.createElement('div');
    p.appendChild(nothing(`箱が ${bs.length} 個。名前を省き、種類の色だけで並べます。`));
    p.appendChild(drawSwarm(bs));
    p.appendChild(kindTable(bs));
    return p;
  }

  const h = bs.map(() => 0);
  bs.forEach(b => b.in.forEach(u => { if (u < b.i) h[b.i] = Math.max(h[b.i], h[u] + 1); }));
  const rows = [];
  bs.forEach(b => { (rows[h[b.i]] = rows[h[b.i]] || []).push(b); });

  const CW = 76, RH = 48, PAD = 10;
  const wide = Math.max(...rows.map(r => r.length));
  const W = PAD * 2 + wide * CW, H = PAD * 2 + rows.length * RH;
  const s = svg(W, H);
  const at = {};
  rows.forEach((row, r) => row.forEach((b, k) => {
    at[b.i] = { x: PAD + k * CW + CW / 2, y: PAD + r * RH + 13 };
  }));

  bs.forEach(b => b.in.forEach(u => {
    if (!at[u]) return;
    s.appendChild(el('path', {
      d: `M ${at[u].x} ${at[u].y + 10} C ${at[u].x} ${at[u].y + 28}, ${at[b.i].x} ${at[b.i].y - 20}, ${at[b.i].x} ${at[b.i].y - 10}`,
      class: 'edge'
    }));
  }));
  bs.forEach(b => {
    if (b.to === undefined || !at[b.to]) return;
    const p = el('path', {
      d: `M ${at[b.i].x + 23} ${at[b.i].y} L ${at[b.i].x + 34} ${at[b.i].y} L ${at[b.to].x + 34} ${at[b.to].y} L ${at[b.to].x + 23} ${at[b.to].y}`,
      class: 'edge'
    });
    p.setAttribute('stroke', 'var(--bit)');
    p.setAttribute('stroke-dasharray', '3 2');
    s.appendChild(p);
  });
  bs.forEach(b => {
    const g = at[b.i], col = `var(--${KINDCLS[b.kind] || 'frame'})`;
    const r = el('rect', { x: g.x - 22, y: g.y - 10, width: 44, height: 20, class: 'box' });
    r.setAttribute('stroke', col);
    s.appendChild(r);
    const t = el('text', { x: g.x, y: g.y + 3.5, 'text-anchor': 'middle', 'font-size': 10.5 },
      b.kind === 'Cst' ? String(b.num) : b.kind);
    t.setAttribute('fill', col);
    s.appendChild(t);
    s.appendChild(el('text', { x: g.x, y: g.y + 17, 'text-anchor': 'middle', 'font-size': 9 },
      b.v === undefined ? `#${b.i}` : `#${b.i}  ${dyadText(b.v, b.d)}`));
  });
  return s;
}

// 大きい DAG は名前を省き、種類の色の点だけで並べる。
function drawSwarm(bs) {
  const S = 6, GAP = 1.5, PER = 48;
  const rows = Math.ceil(bs.length / PER);
  const s = svg(PER * (S + GAP) + 4, rows * (S + GAP) + 4);
  bs.forEach((b, k) => {
    const r = el('rect', {
      x: 2 + (k % PER) * (S + GAP), y: 2 + Math.floor(k / PER) * (S + GAP),
      width: S, height: S
    });
    r.setAttribute('fill', `var(--${KINDCLS[b.kind] || 'frame'})`);
    r.setAttribute('opacity', '0.8');
    s.appendChild(r);
  });
  return s;
}

function kindTable(bs) {
  const c = {};
  bs.forEach(b => { c[b.kind] = (c[b.kind] || 0) + 1; });
  const t = document.createElement('table');
  t.innerHTML = '<tr><th class="l">種類</th><th>数</th></tr>' +
    Object.keys(c).sort().map(k =>
      `<tr><td class="l" style="color:var(--${KINDCLS[k] || 'frame'})">${k}</td><td>${c[k]}</td></tr>`).join('');
  return t;
}

// ===== ツイ数平面（幾何連合論理集合 Level 3〜5、6b、6d）=====
//
// 平面は O, ±1, i, j が張る有界な正方形になる。絶対値は 1 を越えない。
//
//   実軸  ω⁻ = (−1,0)  ―  O = (0,0)  ―  ω = (1,0)
//   ω 軸  j  = (0,−1)  ―  O          ―  i = (0,1)
//   角    ij = (1,1)   −ij = (−1,1)   ji = (1,−1)   −ji = (−1,−1)
//
// 整数は等間隔に並ばない。整数 1 を得た後、残余 (O, ω) に同じ構成を再帰的に
// 当てるので、各段が残余の半分を取る（Level 3 の 1/2 漸減性）。
//
//   t_n = 1 − 2^(−n)        t_1 = 1/2, t_2 = 3/4, t_3 = 7/8, … → ω
//
// この位置づけを Z[1/2] の全部へ伸ばすと、符号について奇な単調写像になる。
//
//   π(v) = sgn(v) · (1 − 2^(−|v|))        π(n) = t_n、π(±∞) = ω, ω⁻
//
// ω の非対称性（H⁺ 側は稠密、H⁻ 側は空）が i を生み、ij 対角線反転が
// i ↔ ω を対にする（6b）。だから実軸の点を ij 対角線で折り返すと ω 軸の
// 漸減列になり、i に収束する。縦に伸びるのはこの折り返しであって、深さではない。

function tsuiPos(v) {
  if (v === 0) return 0;
  const s = v < 0 ? -1 : 1;
  return s * (1 - Math.pow(2, -Math.abs(v)));
}

function drawTsui(sc) {
  const all = (sc.boxes || []).filter(b => b.v !== undefined && b.kind !== 'Ok'
                                           && Number.isFinite(b.v / 2 ** b.d));
  if (!all.length) return nothing('値を持つ箱がありません。');

  const outs = new Set((sc.gamma || []).map(g => g.box));
  const seen = new Map();
  for (const b of all) {
    const key = b.d + ':' + b.v;
    const cur = seen.get(key);
    if (!cur) seen.set(key, { v: b.v, d: b.d, x: b.v / 2 ** b.d, out: outs.has(b.i) });
    else cur.out = cur.out || outs.has(b.i);
  }
  const pts = [...seen.values()];
  const dmax = Math.max(...pts.map(p => p.d));

  const R = 168, PAD = 46;
  const s = svgBox(-R - PAD, -R - PAD - 12, 2 * (R + PAD), 2 * (R + PAD) + 24);
  const P = (u, v) => [R * u, -R * v];

  const line = (a, b, col, w, op, dash) => {
    const e = el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
    e.setAttribute('stroke', col);
    e.setAttribute('stroke-width', w || 1);
    if (op !== undefined) e.setAttribute('opacity', op);
    if (dash) e.setAttribute('stroke-dasharray', dash);
    s.appendChild(e);
  };
  const dot = (p, r, fill, stroke) => {
    const e = el('circle', { cx: p[0], cy: p[1], r: r });
    e.setAttribute('fill', fill || 'none');
    if (stroke) { e.setAttribute('stroke', stroke); e.setAttribute('stroke-width', 1.2); }
    s.appendChild(e);
  };
  const text = (p, str, col, size, anchor) => {
    const t = el('text', { x: p[0], y: p[1], 'font-size': size || 9.5,
                           'text-anchor': anchor || 'middle' }, str);
    t.setAttribute('fill', col);
    s.appendChild(t);
  };

  // ---- 正方形 (ij, −ij, −ji, ji) ----
  const ij = P(1, 1), mij = P(-1, 1), ji = P(1, -1), mji = P(-1, -1);
  const sq = el('path', { d: `M ${ij[0]} ${ij[1]} L ${mij[0]} ${mij[1]} L ${mji[0]} ${mji[1]} L ${ji[0]} ${ji[1]} Z` });
  sq.setAttribute('fill', 'none');
  sq.setAttribute('stroke', 'var(--ring)');
  sq.setAttribute('stroke-width', 1);
  s.appendChild(sq);

  // ---- 二本の対角線 ----
  line(mji, ij, 'var(--ring)', 1, 0.8, '4 4');
  line(mij, ji, 'var(--ring)', 1, 0.8, '4 4');
  text([ij[0] + 4, ij[1] - 6], 'ij', 'var(--label)', 10, 'start');
  text([mij[0] - 4, mij[1] - 6], '−ij', 'var(--label)', 10, 'end');
  text([ji[0] + 4, ji[1] + 13], 'ji', 'var(--label)', 10, 'start');
  text([mji[0] - 4, mji[1] + 13], '−ji', 'var(--label)', 10, 'end');

  // ---- 実軸と ω 軸 ----
  line(P(-1, 0), P(1, 0), 'var(--axis)', 1.2, 0.9);
  line(P(0, -1), P(0, 1), 'var(--axis)', 1.2, 0.9);
  dot(P(1, 0), 3.6, 'var(--acc)');
  dot(P(-1, 0), 3.6, 'var(--acc)');
  dot(P(0, 1), 3.6, 'var(--label)');
  dot(P(0, -1), 3.6, 'var(--label)');
  dot(P(0, 0), 2.6, 'var(--ink)');
  text([R + 8, 4], 'ω', 'var(--acc)', 11, 'start');
  text([-R - 8, 4], 'ω⁻', 'var(--acc)', 11, 'end');
  text([6, -R - 6], 'i', 'var(--label)', 11, 'start');
  text([6, R + 14], 'j', 'var(--label)', 11, 'start');
  text([-9, 13], 'O', 'var(--ink)', 10, 'end');

  // ---- Level 3 の整数。t_n = 1 − 2^(−n) で ω へ漸近する ----
  for (let n = 1; n <= 9; n++) {
    const t = 1 - Math.pow(2, -n);
    for (const sg of [1, -1]) {
      const p = P(sg * t, 0);
      line([p[0], p[1] - 5], [p[0], p[1] + 5], 'var(--acc)', 1, 0.8);
      if (n <= 4) text([p[0], p[1] + 16], String(sg * n), 'var(--acc)', 9);
    }
  }
  text([0, R + 32], '整数 n は t_n = 1 − 2^(−n)。等間隔ではなく ω へ漸近する',
       'var(--axis)', 9);

  // ---- ij 対角線反転。実軸の列を ω 軸へ写し、i へ収束させる（6b）----
  for (let n = 1; n <= 6; n++) {
    const t = 1 - Math.pow(2, -n);
    line(P(t, 0), P(0, t), 'var(--ring)', 0.7, 0.45);
    dot(P(0, t), 2.4, 'none', 'var(--label)');
  }

  // ---- 平文が作った値 ----
  const used = [];
  pts.sort((a, b) => a.x - b.x).forEach(p => {
    const u = tsuiPos(p.x);
    const q = P(u, 0);
    const col = p.out ? 'var(--warn)' : 'var(--mark)';
    line(P(u, 0), P(0, Math.abs(u)), 'var(--ring)', 0.7, 0.35);
    dot(P(0, Math.abs(u)), 2.2, 'none', col);
    dot(q, p.out ? 5 : 3.4, col);
    const label = dyadText(p.v, p.d) + (p.d ? '  δ' + p.d : '');
    const w = label.length * 5.2 + 6;
    let row = 0;
    while (used.some(r => r.row === row && Math.abs(r.x - q[0]) < (r.w + w) / 2)) row++;
    used.push({ row: row, x: q[0], w: w });
    const t = el('text', { x: q[0], y: q[1] - 12 - row * 12, 'text-anchor': 'middle',
                           'font-size': 9.5 }, label);
    t.setAttribute('fill', col);
    if (p.out) t.setAttribute('font-weight', '700');
    s.appendChild(t);
    line([q[0], q[1] - 7], [q[0], q[1] - 9 - row * 12], col, 0.7, 0.5);
  });

  const d = document.createElement('div');
  d.appendChild(s);
  const f = document.createElement('div');
  f.className = 'formula';
  f.textContent =
    '平面は O, ±1, i, j が張る有界な正方形。実軸も ω 軸も絶対値は 1 を越えない。\n' +
    '整数 1 の後、残余 (O, ω) へ同じ構成を再帰的に当てるので各段が残余の半分を取る。\n\n' +
    '    t_n = 1 − 2^(−n)          ω は整数列の収束先の境界点（Level 3）\n' +
    '    π(v) = sgn(v)(1 − 2^(−|v|))     π(n) = t_n、π(±∞) = ω, ω⁻\n\n' +
    '橙の目盛りが整数、青が平文の作った値、赤が出口境界 Γ⁺。\n' +
    'ω 軸へ渡る細線は ij 対角線反転（6b）。実軸の漸減列はこの折り返しで i へ収束する。' +
    (dmax === 0 ? '\nこの文は δ = 0。値は整数だけになる。'
                : '\n最も深い作図は δ = ' + dmax + '。値は x/2^δ で厳密に閉じる。');
  d.appendChild(f);
  return d;
}

// ===== lane64 の image（20 §7）=====

function drawLane(sc) {
  const im = sc.image;
  if (!im) return nothing('image がありません。');
  const d = document.createElement('div');

  const t = document.createElement('table');
  t.innerHTML = '<tr><th class="l">項目</th><th>値</th></tr>' +
    `<tr><td class="l">image</td><td>${im.bytes} byte</td></tr>` +
    `<tr><td class="l">命令</td><td>${im.insns}</td></tr>` +
    `<tr><td class="l">block</td><td>${im.blocks.length}</td></tr>` +
    Object.keys(im.kinds).sort().map(k => `<tr><td class="l">${k}</td><td>${im.kinds[k]}</td></tr>`).join('');
  d.appendChild(t);

  const bl = im.blocks, RH = 16, PAD = 6, LAB = 96, BARW = 250;
  const maxw = Math.max(1, ...bl.map(b => Math.max(1, ...(b.layers.length ? b.layers : [1]))));
  const s = svg(LAB + BARW + 10, PAD * 2 + bl.length * RH);
  bl.forEach((b, i) => {
    const y = PAD + i * RH;
    s.appendChild(el('text', { x: 2, y: y + 10, 'font-size': 9.5 }, 'pc ' + b.pc));
    const term = el('text', { x: 54, y: y + 10, 'font-size': 9.5 }, b.term);
    term.setAttribute('fill', 'var(--acc)');
    s.appendChild(term);
    let x = LAB;
    for (const w of b.layers) {
      const px = Math.max(3, (w / maxw) * 44);
      if (x + px > LAB + BARW) break;
      const r = el('rect', { x: x, y: y + 3, width: px, height: 9 });
      r.setAttribute('fill', 'var(--mark)');
      r.setAttribute('opacity', '0.6');
      s.appendChild(r);
      x += px + 2;
    }
  });
  const wrap = document.createElement('div');
  wrap.style.marginTop = '8px';
  wrap.appendChild(s);
  d.appendChild(box(null, '横棒 1 本が block の中の 1 層。並んだ棒は順序を入れ替えてよい箱の束。', wrap));
  return d;
}

// ===== 接合秩（Common-Lang/2 定義 4.1、Common-Lang/1 定理 4.1）=====
//
// 座標は common_apps/joinrank/svg/draw.py と同じ。
//
//   r(T)     = 1 − 2^(−|T|)                      次数が環の番号になる
//   θ(T)     = π Σ_{k∈T} 2^(−(k+1))              二進符号が偏角になる   上半平面 Π_i
//   y の点   r = 1/2, θ = −π/2                                          下半平面 Π_j
//   カット   θ_κ = π 2^(−κ) の直径が [n] = A ⊔ B を扇へ分ける
//
// 辺は二種類（Common-Lang/2 §3）。
//
//   E_star = {(T \ max T, T)}      経路を保持する。Π_i の中の弦。直線
//   E_plus = {(T, y) : a_T = 1}    経路を忘れる。実軸を一度だけ渡る弧
//
// 分離積は p_r と q_r の台へ細線を引き、二つの集約点の間に太い弦を一本渡す。
// カットを渡る太弦はちょうど ρ 本になる。

const TAU = Math.PI;

function popcount(t) { let c = 0; while (t) { c += t & 1; t >>= 1; } return c; }
function radiusOf(t) { return 1 - 2 ** (-popcount(t)); }
function angleOf(t, n) {
  let a = 0;
  for (let k = 0; k < n; k++) if ((t >> k) & 1) a += 2 ** (-(k + 1));
  return TAU * a;
}
function polar(r, th, R) { return [R * r * Math.cos(th), -R * r * Math.sin(th)]; }
function topBit(t, n) { let m = 0; for (let k = 0; k < n; k++) if ((t >> k) & 1) m = k; return m; }

function chainClosure(support, n) {
  const seen = new Set([0]);
  for (let t of support) {
    while (t && !seen.has(t)) { seen.add(t); t &= ~(1 << topBit(t, n)); }
  }
  return [...seen].sort((a, b) => a - b);
}

function monoLabel(t, n) {
  if (!t) return '1';
  let s = '';
  for (let k = 0; k < n; k++) if ((t >> k) & 1) s += 'x' + k;
  return s;
}

// 中点を水平へ寄せた制御点。B_y が t の一次式に落ちるので実軸との交点が一意に決まる。
function midCtrl(p0, p1, h) { return [(p0[0] + p1[0]) / 2 + h, (p0[1] + p1[1]) / 2]; }

function bez(p0, c, p1, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * t * u * c[0] + t * t * p1[0],
          u * u * p0[1] + 2 * t * u * c[1] + t * t * p1[1]];
}

// f は線形。f(B(t)) = a t² + b t + c の [0,1] の根の像を返す。
function crossAt(p0, c, p1, f) {
  const eps = 1e-9, f0 = f(p0), fc = f(c), f1 = f(p1);
  const a = f0 - 2 * fc + f1, b = 2 * (fc - f0), c0 = f0;
  let ts = [];
  if (Math.abs(a) < eps) { if (Math.abs(b) > eps) ts = [-c0 / b]; }
  else {
    const d = b * b - 4 * a * c0;
    if (d >= 0) { const s = Math.sqrt(d); ts = [(-b - s) / (2 * a), (-b + s) / (2 * a)]; }
  }
  ts = ts.filter(t => t >= -eps && t <= 1 + eps);
  return ts.length ? bez(p0, c, p1, Math.min(Math.max(ts[0], 0), 1)) : null;
}

function fAxis(p) { return p[1]; }
function fCut(th) {
  const dx = Math.cos(th), dy = -Math.sin(th);
  return p => p[0] * dy - p[1] * dx;
}

function meanAngle(sup, n, lo, hi) {
  if (!sup || !sup.length) return (lo + hi) / 2;
  const a = sup.reduce((s, t) => s + angleOf(t, n), 0) / sup.length;
  return Math.min(Math.max(a, lo + 0.08 * (hi - lo)), lo + 0.92 * (hi - lo));
}

function drawJoint(j) {
  if (!j) return nothing('このセルは入力の語を指定していません。notebook の cell に inputs と cut を書くと出ます。');
  if (!j.ok) return nothing(j.error || '接合秩を取れません。');

  const n = j.n, cut = j.cut, rho = j.rho, R = 150, PAD = 58;
  const support = j.anf || [];
  const nodes = chainClosure(support, n);
  const thc = TAU * 2 ** (-cut);
  const s = svgBox(-R - PAD, -R - PAD, 2 * (R + PAD), 2 * (R + PAD));

  const put = (tag, at, fill, stroke, w, op) => {
    const e = el(tag, at);
    if (fill) e.setAttribute('fill', fill); else e.setAttribute('fill', 'none');
    if (stroke) { e.setAttribute('stroke', stroke); e.setAttribute('stroke-width', w || 1); }
    if (op !== undefined) e.setAttribute('opacity', op);
    s.appendChild(e);
    return e;
  };
  const line = (p, q, col, w, op, dash) => {
    const e = put('line', { x1: p[0], y1: p[1], x2: q[0], y2: q[1] }, null, col, w, op);
    e.setAttribute('stroke-linecap', 'round');
    if (dash) e.setAttribute('stroke-dasharray', dash);
  };
  const text = (p, str, col, size, anchor, op) => {
    const t = el('text', { x: p[0], y: p[1], 'font-size': size || 9.5,
                           'text-anchor': anchor || 'middle' }, str);
    t.setAttribute('fill', col);
    if (op !== undefined) t.setAttribute('opacity', op);
    s.appendChild(t);
  };
  const wedge = (a0, a1, col) => {
    const p0 = polar(1, a0, R), p1 = polar(1, a1, R);
    const big = Math.abs(a1 - a0) > TAU ? 1 : 0;
    put('path', { d: `M 0 0 L ${p0[0]} ${p0[1]} A ${R} ${R} 0 ${big} 0 ${p1[0]} ${p1[1]} Z` },
      col, null, 0, 0.06);
  };

  // カットが分ける扇
  wedge(thc, TAU, 'var(--mark)');
  wedge(0, thc, 'var(--sub)');

  // 環。r = 1 − 2^(−|T|)
  for (let k = 0; k <= n; k++) {
    put('circle', { cx: 0, cy: 0, r: R * (1 - 2 ** (-k)) }, null, 'var(--ring)', 0.7, 0.55);
  }
  const om = put('circle', { cx: 0, cy: 0, r: R }, null, 'var(--ring)', 1.1, 0.9);
  om.setAttribute('stroke-dasharray', '5 4');
  text([R + 9, -3], 'ω', 'var(--ring)', 10, 'start');

  // 実軸。Π_i と Π_j の共通境界
  line([-R - 22, 0], [R + 22, 0], 'var(--axis)', 1, 0.85);
  text([-R - 26, -7], 'Π_i', 'var(--axis)', 9.5, 'start');
  text([-R - 26, 15], 'Π_j', 'var(--axis)', 9.5, 'start');

  // カットの直径
  const cp = polar(1.1, thc, R), cq = polar(1.1, thc + TAU, R);
  line(cp, cq, 'var(--acc)', 1.3, 0.95, '7 5');
  text([cp[0], cp[1] - 9], 'κ = ' + cut, 'var(--acc)', 10);
  text(polar(1.2, (thc + TAU) / 2, R), 'A', 'var(--mark)', 11);
  text(polar(1.2, thc / 2, R), 'B', 'var(--sub)', 11);

  const fac = new Set([].concat(...(j.psup || []), ...(j.qsup || [])));
  const raw = fac.size ? 0.26 : 1.0;

  // E_star。Π_i の中の弦
  for (const t of nodes) {
    if (!t) continue;
    const a = t & ~(1 << topBit(t, n));
    line(polar(radiusOf(a), angleOf(a, n), R), polar(radiusOf(t), angleOf(t, n), R),
      'var(--mark)', 1.3, raw);
  }

  // E_plus。実軸を一度だけ渡る弧と、その交点の丸
  const yout = polar(0.5, -TAU / 2, R);
  put('circle', { cx: yout[0], cy: yout[1], r: 6 }, 'var(--label)', null, 0, raw);
  text([yout[0], yout[1] + 20], 'y', 'var(--label)', 10, 'middle', raw);
  for (const t of support) {
    const pa = polar(radiusOf(t), angleOf(t, n), R);
    const ctl = midCtrl(pa, yout, pa[0] >= 0 ? 24 : -24);
    const e = put('path', { d: `M ${pa[0]} ${pa[1]} Q ${ctl[0]} ${ctl[1]} ${yout[0]} ${yout[1]}` },
      null, 'var(--sub)', 1.5, raw);
    e.setAttribute('stroke-linecap', 'round');
    const x = crossAt(pa, ctl, yout, fAxis);
    if (x) put('circle', { cx: x[0], cy: x[1], r: 2.8 }, 'var(--sub)', null, 0, raw);
  }

  // 単項式の点
  for (const t of nodes) {
    const p = polar(radiusOf(t), angleOf(t, n), R);
    const on = support.includes(t);
    const op = fac.has(t) ? 1 : raw;
    put('circle', { cx: p[0], cy: p[1], r: on ? 4.6 : 2.8 },
      on ? 'var(--ink)' : 'var(--bg)', 'var(--ink)', 1.1, op);
    const right = angleOf(t, n) < TAU / 2;
    text([p[0] + (right ? 10 : -10), p[1] - 8], monoLabel(t, n), 'var(--label)', 9,
      right ? 'start' : 'end', op);
  }

  // 分離積。カットを渡る太弦はちょうど ρ 本
  let ncross = 0;
  const fc = fCut(thc);
  for (let r = 0; r < rho; r++) {
    const rr = 0.40 + 0.22 * (r + 1) / (rho + 1);
    const ap = meanAngle((j.psup || [])[r], n, thc, TAU);
    const aq = meanAngle((j.qsup || [])[r], n, 0, thc);
    const pp = polar(rr, ap, R), pq = polar(rr, aq, R);
    for (const t of ((j.psup || [])[r] || [])) line(polar(radiusOf(t), angleOf(t, n), R), pp, 'var(--warn)', 0.8, 0.55);
    for (const t of ((j.qsup || [])[r] || [])) line(polar(radiusOf(t), angleOf(t, n), R), pq, 'var(--warn)', 0.8, 0.55);
    line(pq, pp, 'var(--warn)', 2.3, 1);
    const x = crossAt(pq, midCtrl(pq, pp, 0), pp, fc);
    if (x) { ncross++; put('circle', { cx: x[0], cy: x[1], r: 3.6 }, 'var(--acc)', 'var(--warn)', 1.2); }
    put('circle', { cx: pp[0], cy: pp[1], r: 5 }, 'var(--warn)');
    put('circle', { cx: pq[0], cy: pq[1], r: 5 }, 'var(--warn)');
    text([pp[0], pp[1] - 10], 'p' + r, 'var(--warn)', 9);
    text([pq[0], pq[1] - 10], 'q' + r, 'var(--warn)', 9);
  }

  const d = document.createElement('div');
  d.appendChild(s);
  const f = document.createElement('div');
  f.className = 'formula';
  f.textContent =
    `n = ${n}   A = {${j.inputs.slice(0, cut).join(', ')}}   B = {${j.inputs.slice(cut).join(', ')}}\n` +
    `ρ = rank_𝔽₂ F = ${rho}        カットを渡る太弦 ${ncross} 本\n` +
    `台 ${support.length} 点        環 ${n + 1} 本`;
  d.appendChild(f);
  d.appendChild(jointLegend());
  d.appendChild(jointTable(j));
  return d;
}

function jointLegend() {
  const rows = [
    ['ring', '環  r = 1 − 2^(−|T|)', '相互作用の次数 |T|'],
    ['mark', '青い弦  E_star', '経路の保持。角度差 π2^(−k) が x_k'],
    ['sub', '緑の弧  E_plus', '実軸を渡る合算。丸が経路を忘れる一点'],
    ['acc', '橙の直径', 'カット θ_κ = π 2^(−κ)'],
    ['warn', '赤の太弦', 'カットを渡る独立影響。本数が接合秩'],
  ];
  const t = document.createElement('table');
  t.innerHTML = rows.map(([c, a, b]) =>
    `<tr><td class="l" style="color:var(--${c})">${a}</td><td class="l">${b}</td></tr>`).join('');
  return t;
}

function jointTable(j) {
  const na = 1 << j.cut, nb = 1 << (j.n - j.cut);
  const t = document.createElement('table');
  let html = '<tr><th class="l">F</th>';
  for (let b = 0; b < nb; b++) html += `<th>β${b}</th>`;
  html += '</tr>';
  for (let a = 0; a < na; a++) {
    html += `<tr><th class="l">α${a}</th>`;
    for (let b = 0; b < nb; b++) html += `<td>${j.table[a + na * b]}</td>`;
    html += '</tr>';
  }
  t.innerHTML = html;
  const d = document.createElement('div');
  d.appendChild(t);
  const f = document.createElement('div');
  f.className = 'formula';
  f.textContent = 'f(x_A, x_B) = ⊕_{r<ρ} p_r(x_A) q_r(x_B)\n' +
    j.p.map((pr, r) => `  r=${r}   p = [${pr.join('')}]   q = [${j.q[r].join('')}]`).join('\n');
  d.appendChild(f);
  return d;
}

// ===== 音節と箱の表 =====

function drawText(sc) {
  const d = document.createElement('div');
  const w = document.createElement('table');
  w.innerHTML = '<tr><th>r</th><th>q</th><th class="l">音節</th><th class="l">生成元</th><th>pin</th><th>pout</th><th>箱</th></tr>' +
    sc.words.map(x => `<tr><td>${x.r}</td><td>${x.q}</td>` +
      `<td class="l" style="color:var(--${x.cls})">${x.syl}</td>` +
      `<td class="l">${x.sym}</td><td>${x.pin}</td><td>${x.pout}</td>` +
      `<td>${x.boxes === null ? '—' : x.boxes}</td></tr>`).join('');
  d.appendChild(box('音節 → 生成元', 'idx(cv) = 5 ord(c) + ord(v)      C = (k s t n h m y r w g z d b p),  V = (a i u e o)', w));

  const b = document.createElement('table');
  b.innerHTML = '<tr><th>#</th><th class="l">種類</th><th class="l">引数</th><th>δ</th><th>語 64+w</th><th class="l">x/2^δ</th></tr>' +
    sc.boxes.slice(0, 400).map(x =>
      `<tr><td>${x.i}</td>` +
      `<td class="l" style="color:var(--${KINDCLS[x.kind] || 'frame'})">${x.kind}${x.kind === 'Cst' ? ' ' + x.num : ''}</td>` +
      `<td class="l">${x.in.join(', ')}${x.to !== undefined ? ' → ' + x.to : ''}</td>` +
      `<td>${x.d}</td><td>${x.v === undefined ? '' : x.v}</td>` +
      `<td class="l">${x.v === undefined ? '' : dyadText(x.v, x.d)}</td></tr>`).join('');
  d.appendChild(box('箱', 'commonc の OPK / OPA / OPB / OPD / OPL をそのまま（19 §3.2）', b));
  return d;
}
