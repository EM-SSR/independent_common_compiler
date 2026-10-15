// 説明セルの描画。Markdown は marked、数式は KaTeX が描く。
//
//   Markdown   見出し、表、箇条書き、引用、code、画像、動画、素の HTML
//   数式       $…$ と $$…$$、\(…\) と \[…\]
//   画像と動画 assets/ へ置いたものを ![](assets/x.png) や <video> で貼る
//
// 素の HTML を通すので、描く前に許可した tag と属性だけへ落とす。
// 他人の notebook を `.json` で開けるため、この関門は外せない。

const Render = (function () {

const RENDER = { ready: false, base: null };

function loadCss(href) {
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  document.head.appendChild(l);
}

function loadJs(src) {
  return new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => no(new Error(src));
    document.head.appendChild(s);
  });
}

// base は /vendor/web/ か CDN。setup.py が置いていれば手元のコピーを使う
async function startRender(base) {
  RENDER.base = base;
  loadCss(base + 'katex.min.css');
  await loadJs(base + 'marked.umd.js');
  await loadJs(base + 'katex.min.js');
  marked.setOptions({ gfm: true, breaks: false });
  RENDER.ready = true;
}

// ===== 関門 =====

const TAGS = new Set((
  'p br hr h1 h2 h3 h4 h5 h6 strong b em i del s u code pre blockquote ' +
  'ul ol li dl dt dd table thead tbody tfoot tr th td caption ' +
  'a img video audio source track figure figcaption ' +
  'span div sup sub kbd mark small abbr details summary ' +
  'svg g path circle ellipse rect line polyline polygon text tspan defs marker'
).split(' '));

const ATTRS = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
  video: ['src', 'controls', 'width', 'height', 'poster', 'loop', 'muted',
          'playsinline', 'preload', 'autoplay'],
  audio: ['src', 'controls', 'preload', 'loop'],
  source: ['src', 'type'],
  track: ['src', 'kind', 'srclang', 'label', 'default'],
  th: ['colspan', 'rowspan', 'align'],
  td: ['colspan', 'rowspan', 'align'],
  ol: ['start', 'type'],
  details: ['open'],
  svg: ['viewbox', 'width', 'height', 'xmlns', 'preserveaspectratio'],
};
// 図形は形の欄だけ通す
const SHAPE = ['d', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
               'width', 'height', 'points', 'fill', 'stroke', 'stroke-width',
               'stroke-dasharray', 'stroke-linecap', 'opacity', 'transform',
               'text-anchor', 'font-size', 'font-family', 'dominant-baseline'];
const COMMON_ATTRS = ['class', 'align', 'style'];

const URL_OK = /^(https?:|mailto:|assets\/|\.\/|\/(?!\/)|#|data:image\/(png|jpeg|gif|webp|svg\+xml);base64,)/i;
// style は文字揃えだけ許す。表の列揃えに marked が使う
const STYLE_OK = /^text-align:\s*(left|right|center)\s*;?$/i;

function sanitize(node) {
  for (const child of [...node.children]) {
    const tag = child.tagName.toLowerCase();
    if (!TAGS.has(tag)) {
      child.replaceWith(...child.childNodes);
      continue;
    }
    const allow = new Set([...(ATTRS[tag] || []), ...COMMON_ATTRS]);
    if (tag === 'svg' || child.closest('svg')) SHAPE.forEach(a => allow.add(a));
    for (const at of [...child.attributes]) {
      const name = at.name.toLowerCase();
      if (!allow.has(name)) { child.removeAttribute(at.name); continue; }
      if (name === 'style' && !STYLE_OK.test(at.value)) child.removeAttribute(at.name);
      if ((name === 'src' || name === 'href') && !URL_OK.test(at.value.trim())) {
        child.removeAttribute(at.name);
      }
    }
    sanitize(child);
  }
}

// ===== 数式 =====
//
// Markdown より先に数式を抜く。marked は行末の逆斜線二つを「escape した逆斜線」として
// 畳むので、後から当てると aligned の改行が消える。抜いた跡へ印を置き、Markdown の
// 後で戻す。
//
//   $$ … $$   \[ … \]     別行
//   $ … $     \( … \)     行の中。開いた直後と閉じる直前に空白を置かない
//
// ` と ``` の中は数式として読まない。

// 印は私用領域の二文字で挟む。CommonMark は U+0000 を U+FFFD へ置き換える決まりなので、
// NUL を印に使うと Markdown を通った時点で消える
const OPEN = String.fromCharCode(0xE000);
const SHUT = String.fromCharCode(0xE001);
const BS = '\\';
const BLANK = /\n\s*\n/;
const AFTER_OPEN = /[\s$]/;

function takeMath(src) {
  const found = [];
  let out = '', i = 0;
  const push = (tex, display) => {
    out += OPEN + found.length + SHUT;
    found.push({ tex: tex, display: display });
  };
  while (i < src.length) {
    // code fence と code span は素通しする
    if (src.startsWith('```', i)) {
      const end = src.indexOf('```', i + 3);
      const to = end < 0 ? src.length : end + 3;
      out += src.slice(i, to); i = to; continue;
    }
    if (src[i] === '`') {
      const end = src.indexOf('`', i + 1);
      const to = end < 0 ? src.length : end + 1;
      out += src.slice(i, to); i = to; continue;
    }
    if (src[i] === BS && (src[i + 1] === '[' || src[i + 1] === '(')) {
      const close = BS + (src[i + 1] === '[' ? ']' : ')');
      const end = src.indexOf(close, i + 2);
      if (end > 0) {
        push(src.slice(i + 2, end), src[i + 1] === '[');
        i = end + 2; continue;
      }
    }
    if (src.startsWith('$$', i)) {
      const end = src.indexOf('$$', i + 2);
      if (end > 0) { push(src.slice(i + 2, end), true); i = end + 2; continue; }
    }
    if (src[i] === '$' && !AFTER_OPEN.test(src[i + 1] || ' ')) {
      const end = src.indexOf('$', i + 1);
      const body = end > 0 ? src.slice(i + 1, end) : null;
      if (body !== null && !/\s$/.test(body) && !BLANK.test(body)) {
        push(body, false); i = end + 1; continue;
      }
    }
    out += src[i]; i++;
  }
  return { text: out, found: found };
}

// Markdown が終わった後、印を KaTeX の出力へ戻す
function putMath(root, found) {
  if (!found.length) return;
  const re = new RegExp(OPEN + '([0-9]+)' + SHUT);
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (re.test(n.nodeValue)) hits.push(n);
  }
  for (const node of hits) {
    const frag = document.createDocumentFragment();
    let rest = node.nodeValue, m;
    while ((m = re.exec(rest))) {
      if (m.index) frag.appendChild(document.createTextNode(rest.slice(0, m.index)));
      const item = found[Number(m[1])];
      const holder = document.createElement(item.display ? 'div' : 'span');
      try {
        holder.innerHTML = katex.renderToString(item.tex, {
          displayMode: item.display, throwOnError: false, errorColor: 'var(--te)',
        });
      } catch (e) {
        holder.textContent = item.tex;
        holder.style.color = 'var(--te)';
      }
      frag.appendChild(holder);
      rest = rest.slice(m.index + m[0].length);
    }
    if (rest) frag.appendChild(document.createTextNode(rest));
    node.replaceWith(frag);
  }
}

// ===== 描く =====

const MOVIE = /\.(mp4|webm|ogv|mov)$/i;
const SOUND = /\.(mp3|wav|m4a|ogg)$/i;

function mediaFix(root) {
  for (const img of [...root.querySelectorAll('img')]) {
    const src = img.getAttribute('src') || '';
    if (MOVIE.test(src)) {
      const v = document.createElement('video');
      v.src = src; v.controls = true; v.preload = 'metadata';
      img.replaceWith(v);
    } else if (SOUND.test(src)) {
      const a = document.createElement('audio');
      a.src = src; a.controls = true;
      img.replaceWith(a);
    }
  }
  for (const a of root.querySelectorAll('a[href^="http"]')) {
    a.target = '_blank';
    a.rel = 'noreferrer noopener';
  }
}

// 説明セルの本文を el へ描く。library が無い場合は素のまま出す
function renderMarkdown(el, text) {
  const src = String(text || '');
  if (!RENDER.ready) {
    el.textContent = src;
    return el;
  }
  const cut = takeMath(src);
  el.innerHTML = marked.parse(cut.text);
  sanitize(el);
  mediaFix(el);
  putMath(el, cut.found);
  return el;
}

// ===== assets =====
//
// 画像と動画は server の assets/ へ置く。返りの path をそのまま Markdown に書ける。

async function uploadAsset(file) {
  const name = file.name.replace(/[^\w.\-]+/g, '_');
  const r = await fetch('/assets/' + encodeURIComponent(name),
    { method: 'POST', body: file });
  if (!r.ok) throw new Error('置けません: ' + r.status);
  return (await r.json()).path;
}

// 貼り付けた file を Markdown の一行にする
function assetMarkdown(path, file) {
  if (MOVIE.test(path)) return '<video src="' + path + '" controls width="100%"></video>';
  if (SOUND.test(path)) return '<audio src="' + path + '" controls></audio>';
  return '![' + file.name + '](' + path + ')';
}

return { start: startRender, markdown: renderMarkdown,
         upload: uploadAsset, mark: assetMarkdown, state: RENDER };

})();

// app.js から呼ぶ名前。中身は Render の中にある
const startRender = Render.start;
const renderMarkdown = Render.markdown;
const uploadAsset = Render.upload;
const assetMarkdown = Render.mark;
