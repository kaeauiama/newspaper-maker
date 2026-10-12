// 号の設定と原稿から紙面の DOM を組み立て、本文を流し込み、検査結果を返す。ブラウザ専用。
//
// 手順: 配置物を置く → 各ページのスロットを計算 → 記事ごとに割り当て範囲を決める → 流し込む → 検査する

import { SPEC, danTop, danBottom, linePitch, charPitch } from './spec.js';
import { resolveX, itemRect, computeSlots, assignSlots, unassignedSlots, danRules } from './slots.js';
import { parseArticle, toInlineHtml, escapeText, countChars } from './text.js';
import { parsePipeTable } from './table.js';
import { layoutRows, effectiveDpi, visibleFraction, photoArea, cropPlacement, panelSpacing } from './gallery.js';
import { mastheadItem } from './validate.js';
import { pour, usedLines } from './pour.js';
import { MASTHEAD_FONTS, RULE_WIDTH, defaultPublication } from './publication.js';

const MM_PX = 96 / 25.4;
const mm = (v) => `${+v.toFixed(3)}mm`;
const div = (cls) => Object.assign(document.createElement('div'), { className: cls });

function placeAt(el, rect) {
  Object.assign(el.style, { left: mm(rect.left), top: mm(rect.top), width: mm(rect.right - rect.left), height: mm(rect.bottom - rect.top) });
  return el;
}

// 版面の数値を CSS 変数にする(数値の正は spec.js)
export function applySpecVars(spec, el = document.documentElement) {
  const vars = {
    '--page-w': mm(spec.page.width),
    '--page-h': mm(spec.page.height),
    '--margin-left': mm(spec.margin.left),
    '--margin-right': mm(spec.margin.right),
    '--body-size': `${spec.body.fontSize}pt`,
    '--body-leading': `${spec.body.lineHeight}pt`,
    '--header-top': mm(spec.header.top),
    '--header-size': `${spec.header.fontSize}pt`,
    '--footer-bottom': mm(spec.footer.bottom),
    '--footer-size': `${spec.footer.fontSize}pt`,
    '--frame-width': mm(spec.frame.width),
    '--title-size': `${spec.title.base.frame}pt`,
    '--title-size-reverse': `${spec.title.base.reverse}pt`,
    '--title-size-plain': `${spec.title.base.plain}pt`,
  };
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
}

async function loadImage(url) {
  const im = new Image();
  im.src = url;
  try {
    await im.decode();
    return im;
  } catch {
    return null;
  }
}

const isVector = (src) => /\.svg$/i.test(src);

/**
 * @param {object} o
 * @param {HTMLElement} o.root          ページを入れる要素
 * @param {object} o.issue              issue.jsonc の中身(validateIssue 済み)
 * @param {(p: string) => Promise<string>} o.readText  号フォルダからの相対パスでテキストを読む
 * @param {(p: string) => string} o.assetUrl           号フォルダからの相対パスを URL にする
 * @param {object} [o.publication]                     紙名の設定(validatePublication 済み。engine/publication.js)
 * @param {(p: string) => string} [o.pubUrl]           紙名の設定からの相対パス(題字の画像)を URL にする
 */
export async function renderIssue({ root, issue, spec = SPEC, readText, assetUrl, publication = null, pubUrl = assetUrl }) {
  const errors = [];
  const warnings = [];
  const pub = publication ?? defaultPublication(spec);
  const ctx = { spec, readText, assetUrl, pubUrl, errors, warnings };
  applySpecVars(spec);

  // 1. 原稿
  const articles = new Map();
  for (const a of issue.articles) {
    let text = '';
    try {
      text = await readText(a.file);
    } catch {
      errors.push({ code: 'E_FILE_NOT_FOUND', message: `記事「${a.id}」の原稿 ${a.file} を読めません。` });
    }
    articles.set(a.id, { ...a, parsed: parseArticle(text) });
  }

  // 2. ページと配置物
  const pages = [];
  const titles = [];   // 見出し枠の位置(記事の割り当てで、見出しの右を前の記事に回すのに使う)
  for (const [p, page] of issue.pages.entries()) {
    const pageNo = p + 1;
    const el = div('page');
    el.dataset.page = String(pageNo);
    el.appendChild(header(issue, pub));
    const f = spec.frame.offset;
    el.appendChild(placeAt(div('frame'), { left: spec.margin.left - f, right: spec.page.width - spec.margin.right + f, top: spec.margin.top - f, bottom: spec.page.height - spec.margin.bottom + f }));
    const folio = div('folio');
    folio.textContent = `― ${pageNo} ―`;
    el.appendChild(folio);
    for (let d = 1; d <= spec.dan.count; d++) {
      el.appendChild(placeAt(div('guide'), { left: spec.margin.left, right: spec.page.width - spec.margin.right, top: danTop(spec, d), bottom: danBottom(spec, d) }));
    }
    root.appendChild(el);
    // data-item は page.items の番号(題字は 'masthead')。エディタが選択に使う
    const entries = (page.items ?? []).map((it, index) => ({ it, key: String(index) }));
    if (page.template === 'front') entries.unshift({ it: mastheadItem(spec), key: 'masthead' });
    const items = entries.map((e) => e.it);
    for (const { it, key } of entries) {
      const rect = itemRect(spec, it);
      if (it.type === 'title') titles.push({ article: it.article, page: pageNo, dan: it.dan, left: rect.left, right: rect.right });
      let node = null;
      let fill = null;   // 紙面に置いてから行う処理(囲み記事の流し込みは、置いてからでないと測れない)
      if (it.type === 'masthead') node = await masthead(rect, pub, ctx);
      else if (it.type === 'title') node = titleBox(rect, articles.get(it.article), it);
      else if (it.type === 'lead') node = leadBox(rect, articles.get(it.article));
      else if (it.type === 'panel') node = await panelBox(it, rect, ctx, pageNo);
      else if (it.type === 'box') ({ node, fill } = await boxItem(it, rect, ctx, pageNo));
      node.dataset.item = key;
      el.appendChild(node);
      fill?.();
    }
    fitTitles(el, warnings, pageNo);
    checkBoxes(el, spec, warnings, pageNo);
    const rects = items.map((it) => ({ dan: it.dan, x: resolveX(spec, it), from: it.from, to: it.to }));
    for (const r of danRules(spec, rects)) {
      const rule = placeAt(div('dan-rule'), { left: r.left, right: r.right, top: r.y, bottom: r.y });
      el.insertBefore(rule, el.querySelector('.item'));
    }
    pages.push({ el, rects });
  }

  // 3. スロットと割り当て
  const slots = pages.flatMap((pg, p) => computeSlots(spec, pg.rects).map((s) => ({ ...s, page: p + 1 })));
  const { owners, ranges, errors: rangeErrors } = assignSlots(slots, issue.articles, titles);
  errors.push(...rangeErrors);
  for (const s of unassignedSlots(slots, owners)) {
    warnings.push({ code: 'W_SLOT_UNASSIGNED', message: `${s.page}面 段${s.dan} の右から${s.index}番目の枠(${s.lines}行分)には、どの記事も流れません。` });
  }

  // 4. 流し込み
  const pitchPx = linePitch(spec) * MM_PX;
  const report = [];
  for (const [k, r] of ranges.entries()) {
    const art = articles.get(r.id);
    const boxes = slots.filter((_, i) => owners[i] === k).map((s) => {
      const box = placeAt(div('slot'), { left: s.left, right: s.right, top: s.top, bottom: s.top + s.height });
      addExclusions(box, s);
      box.dataset.article = r.id;
      pages[s.page - 1].el.appendChild(box);
      return { s, box };
    });
    const blocks = art.parsed.blocks.map((b) => {
      const p = document.createElement('p');
      p.className = b.type;
      p.innerHTML = toInlineHtml(b.text);
      return p;
    });
    const leftover = pour(blocks, boxes.map((b) => b.box));
    const where = (s) => `${s.page}面段${s.dan}`;
    const entry = {
      id: r.id,
      range: boxes.length ? `${where(boxes[0].s)}〜${where(boxes.at(-1).s)}` : '(なし)',
      chars: countChars(art.parsed.blocks),
      overflowChars: 0,
      emptyLines: 0,
      boxes: boxes.map(({ s, box }) => {
        const t = box.textContent;
        return { page: s.page, dan: s.dan, index: s.index, lines: s.lines, chars: [...t].length, head: [...t].slice(0, 6).join(''), tail: [...t].slice(-6).join('') };
      }),
    };
    if (leftover.length) {
      const rest = leftover.map((e) => e.textContent).join('');
      entry.overflowChars = [...rest].length;
      boxes.at(-1)?.box.classList.add('overflow');
      errors.push({
        code: 'E_ARTICLE_OVERFLOW',
        message: `記事「${r.id}」が入りきりません(あと約${entry.overflowChars}字。「${[...rest].slice(0, 12).join('')}…」から)。写真を小さくする、原稿を削る、次の記事の開始位置を後ろにずらす、のどれかで調整してください。`,
      });
    } else {
      const lastUsed = boxes.findLastIndex((b) => b.box.querySelector('p'));
      entry.emptyLines = boxes.reduce((n, b, i) => n + (i > lastUsed ? b.s.lines : i === lastUsed ? Math.max(0, b.s.lines - usedLines(b.box, pitchPx)) : 0), 0);
      if (entry.emptyLines > spec.underfullLines) {
        warnings.push({ code: 'W_ARTICLE_UNDERFULL', message: `記事「${r.id}」の後ろが約${entry.emptyLines}行空いています。` });
      }
    }
    report.push(entry);
  }

  // 本文の枠の一覧(エディタが記事の開始位置の候補に使う)
  const slotList = slots.map((s, i) => ({ page: s.page, dan: s.dan, index: s.index, lines: s.lines, left: s.left, right: s.right, article: owners[i] >= 0 ? ranges[owners[i]].id : null }));

  return { errors, warnings, articles: report, pages: issue.pages.length, slots: slotList };
}

function header(issue, pub) {
  const h = div('header');
  h.innerHTML = `<span>${escapeText(issue.date)}</span><span class="name">${escapeText(pub.name)}</span><span>第${issue.number}号</span>`;
  return h;
}

// 題字。中身(画像・文字・線)は紙名の設定の masthead で決める。位置は題字の枠の内側の左上からの mm
async function masthead(rect, pub, ctx) {
  const el = placeAt(div(`item masthead${pub.masthead.frame ? '' : ' noframe'}`), rect);
  for (const [n, it] of pub.masthead.items.entries()) {
    const node = await mastheadPart(it, ctx);
    node.dataset.mh = String(n);
    el.appendChild(node);
  }
  return el;
}

// 題字の中の1つ(パネル編集画面のように、題字の編集画面でも使う)
export async function mastheadPart(it, ctx) {
  if (it.type === 'rule') {
    const vertical = (it.h ?? 0) > 0;
    return placeAt(div(`mh mh-rule${vertical ? ' v' : ''}`), { left: it.x, top: it.y, right: it.x + (vertical ? RULE_WIDTH : it.w), bottom: it.y + (vertical ? it.h : RULE_WIDTH) });
  }
  const box = placeAt(div(`mh mh-${it.type}`), { left: it.x, top: it.y, right: it.x + it.w, bottom: it.y + it.h });
  if (it.type === 'text') {
    box.classList.add(it.dir === 'vertical' ? 'v' : 'h', `al-${it.align ?? 'start'}`);
    Object.assign(box.style, {
      fontFamily: (MASTHEAD_FONTS[it.font] ?? MASTHEAD_FONTS.mincho).css,
      fontSize: `${it.size ?? 10.5}pt`,
      fontWeight: String(it.weight ?? 400),
      lineHeight: String(it.lineHeight ?? 1.4),
    });
    for (const line of String(it.text ?? '').split('\n')) {
      const ln = div('ln');
      ln.textContent = line || ' ';
      box.appendChild(ln);
    }
    return box;
  }
  // 画像: 切り抜き(crop)があれば写真と同じように枠に合わせる。なければ枠いっぱいに縦横比のまま
  const im = await loadImage(ctx.pubUrl(it.src));
  if (!im) {
    box.classList.add('placeholder');
    box.textContent = `${it.src}(画像なし)`;
    ctx.warnings.push({ code: 'W_MASTHEAD_IMAGE', message: `題字の画像 ${it.src} を読めないので、仮の枠を表示しています。紙名の設定と同じフォルダの ${it.src} に置いてください。` });
    return box;
  }
  im.alt = '';
  im.dataset.src = it.src;
  if (Array.isArray(it.crop)) {
    const pl = cropPlacement({ w: it.w, h: it.h }, it.crop, { w: im.naturalWidth, h: im.naturalHeight });
    Object.assign(im.style, { left: mm(pl.left), top: mm(pl.top), width: mm(pl.width), height: mm(pl.height) });
  } else {
    im.classList.add('fit');
  }
  box.appendChild(im);
  return box;
}

function titleBox(rect, art, it) {
  const el = placeAt(div(`item titlebox look-${it.look ?? 'frame'} dir-${it.dir === 'horizontal' ? 'h' : 'v'}`), rect);
  if (it.size) {
    // 文字の大きさを選んだ見出しは、その大きさを守る(入りきらなくても縮めず、検査で知らせる)
    el.style.fontSize = `${it.size}pt`;
    el.dataset.size = String(it.size);
  }
  const t = div('titletext');
  t.innerHTML = (art?.parsed.title ?? []).map(toInlineHtml).join('<br>');
  el.appendChild(t);
  return el;
}

function leadBox(rect, art) {
  const el = placeAt(div('item lead'), rect);
  el.innerHTML = (art?.parsed.lead ?? []).map((l) => `<p>${toInlineHtml(l)}</p>`).join('');
  return el;
}

// 段の一部だけを覆う配置物を、本文に避けさせる(docs/05-proposals.md 2-1、spike/03-partial-dan.html)。
// スロットの頭(上)と尻(下)に見えない float を置き、覆われた横の範囲だけを shape-outside の「くし形」の多角形で示す。
// 範囲の両端はわずかに内へ寄せ、隣の行(枠に接しているだけの行)を短くしない
const EDGE_INSET = 0.05;
function addExclusions(box, s) {
  for (const edge of ['top', 'bottom']) {
    const parts = (s.excl ?? []).filter((q) => q.edge === edge).sort((a, b) => a.x0 - b.x0);
    if (!parts.length) continue;
    const h = Math.max(...parts.map((q) => q.depth));
    const near = edge === 'top' ? 0 : h;
    const pts = parts.flatMap((q) => {
      const x0 = mm(q.x0 - s.left + EDGE_INSET);
      const x1 = mm(q.x1 - s.left - EDGE_INSET);
      const far = mm(edge === 'top' ? q.depth : h - q.depth);
      return [`${x0} ${mm(near)}`, `${x0} ${far}`, `${x1} ${far}`, `${x1} ${mm(near)}`];
    });
    const f = div('excl');
    Object.assign(f.style, { float: edge === 'top' ? 'inline-start' : 'inline-end', width: mm(s.right - s.left), height: mm(h), shapeOutside: `polygon(${pts.join(', ')})` });
    box.appendChild(f);
  }
}

// 囲み記事(行事予定・お知らせなど): 地色か罫で囲み、上に見出し(原稿の # 行)の帯を置き、
// 中は囲みが覆う段ごとに列を作って本文を流す(本文の組み方は記事と同じ。最後に ■ は付けない)
async function boxItem(it, rect, ctx, pageNo) {
  const { spec, readText, errors } = ctx;
  const node = placeAt(div(`item box look-${it.look ?? 'gray'}`), rect);
  let parsed = { title: [], blocks: [] };
  try {
    parsed = parseArticle(await readText(it.file), { end: false });
  } catch {
    errors.push({ code: 'E_FILE_NOT_FOUND', message: `${pageNo}面: 囲み記事のファイル ${it.file} を読めません。` });
  }
  const W = rect.right - rect.left;
  const { padding: pad, band } = spec.box;
  const head = parsed.title.length ? band : 0;
  if (head) {
    const h = placeAt(div('bhead'), { left: 0, right: W, top: 0, bottom: head });
    h.innerHTML = parsed.title.map(toInlineHtml).join('　');
    node.appendChild(h);
  }
  const cols = [];
  for (let d = it.dan[0]; d <= it.dan[1]; d++) {
    const top = Math.max(rect.top, danTop(spec, d)) + (d === it.dan[0] ? head : 0) + pad;
    const bottom = Math.min(rect.bottom, danBottom(spec, d)) - pad;
    if (bottom - top < charPitch(spec)) continue;   // 1字も入らない列は作らない
    cols.push(node.appendChild(placeAt(div('bcol'), { left: pad, right: W - pad, top: top - rect.top, bottom: bottom - rect.top })));
  }
  const fill = () => {
    const blocks = parsed.blocks.map((b) => {
      const p = document.createElement('p');
      p.className = b.type;
      p.innerHTML = toInlineHtml(b.text);
      return p;
    });
    const rest = pour(blocks, cols);
    if (!rest.length) return;
    const chars = [...rest.map((e) => e.textContent).join('')].length;
    errors.push({ code: 'E_BOX_OVERFLOW', message: `${pageNo}面: 囲み記事「${parsed.title[0] ?? it.file}」の本文が入りきりません(あと約${chars}字)。囲みを広げるか、文章を削ってください。` });
    cols.at(-1)?.classList.add('overflow');
  };
  return { node, fill };
}

// 写真パネル1つだけを、外形 width × height(mm)で左上を原点にして組む(エディタのパネル編集画面用)
export async function renderPanel({ item, width, height, spec = SPEC, assetUrl, readText = async () => '' }) {
  const errors = [];
  const warnings = [];
  const el = await panelBox(item, { left: 0, right: width, top: 0, bottom: height }, { spec, assetUrl, readText, errors, warnings }, 0);
  return { el, errors, warnings };
}

async function panelBox(it, rect, ctx, pageNo) {
  const { spec, assetUrl, readText, errors, warnings } = ctx;
  const el = placeAt(div('item panel'), rect);
  const W = rect.right - rect.left;
  const H = rect.bottom - rect.top;
  const { padding: pad, band } = panelSpacing(spec, it);
  const { gap } = spec.panel;
  const inner = photoArea(spec, it, W, H);

  if (it.title) {
    const t = div('ptitle');
    t.textContent = it.title;
    Object.assign(t.style, { top: mm(pad), height: mm(band) });
    el.appendChild(t);
  }
  if (it.caption) {
    const c = div('cap');
    c.textContent = it.caption;
    Object.assign(c.style, { bottom: mm(pad), height: mm(band) });
    el.appendChild(c);
  }
  if (it.table) {
    const wrap = placeAt(div('ptable'), { left: inner.x, right: inner.x + inner.w, top: inner.y, bottom: inner.y + inner.h });
    try {
      wrap.appendChild(tableElement(parsePipeTable(await readText(it.table))));
    } catch {
      errors.push({ code: 'E_FILE_NOT_FOUND', message: `${pageNo}面: 表のファイル ${it.table} を読めません。` });
    }
    el.appendChild(wrap);
  }

  const photos = [];
  if (Array.isArray(it.photos)) {
    for (const ph of it.photos) {
      if (![ph.x, ph.y, ph.w, ph.h].every(Number.isFinite)) {
        errors.push({ code: 'E_PHOTO_RECT', message: `${pageNo}面: 写真 ${ph.src} の位置 x・y・w・h(パネル左上からの mm)が足りません。` });
        continue;
      }
      photos.push({ ph, rect: ph, im: await loadImage(assetUrl(ph.src)) });
    }
  }
  if (Array.isArray(it.rows)) {
    const rows = it.rows.map((row) => row.map((p) => (typeof p === 'string' ? { src: p } : p)));
    const flat = rows.flat();
    const ims = await Promise.all(flat.map((p) => loadImage(assetUrl(p.src))));
    let k = 0;
    const ratios = rows.map((row) => row.map(() => {
      const im = ims[k++];
      return im && im.naturalHeight ? im.naturalWidth / im.naturalHeight : 1.5;
    }));
    const rects = layoutRows(ratios, inner, gap);
    flat.forEach((ph, i) => photos.push({ ph, rect: rects[i], im: ims[i] }));
  }
  for (const [n, { ph, rect: r, im }] of photos.entries()) {
    if (!im) {
      errors.push({ code: 'E_FILE_NOT_FOUND', message: `${pageNo}面: 写真 ${ph.src} を読めません。` });
      continue;
    }
    im.alt = '';
    let node = im;
    let dpi;
    if (Array.isArray(ph.crop)) {
      // 枠 + 切り抜き: 枠の中に、切り抜いた範囲がちょうど収まるよう写真全体を置く(縦横比は変えない)
      node = div('ph');
      const pl = cropPlacement({ w: r.w, h: r.h }, ph.crop, { w: im.naturalWidth, h: im.naturalHeight });
      Object.assign(im.style, { left: mm(pl.left), top: mm(pl.top), width: mm(pl.width), height: mm(pl.height) });
      node.appendChild(im);
      dpi = 25.4 / pl.mmPerPx;
      const cropAspect = (ph.crop[2] * im.naturalWidth) / (ph.crop[3] * im.naturalHeight);
      if (Math.abs(r.w / r.h / cropAspect - 1) > spec.photo.aspectTolerance) {
        warnings.push({ code: 'W_PHOTO_ASPECT', message: `${pageNo}面: 写真 ${ph.src} の枠と切り抜きの縦横比が合っていません。枠からはみ出す分は切り取って表示します(エディタの「自動で並べる」で直せます)。` });
      }
    } else {
      // 切り抜きの指定がない写真は、枠いっぱいに見せてはみ出す分を切る
      if (ph.focus) im.style.objectPosition = ph.focus;
      dpi = effectiveDpi(im.naturalWidth, im.naturalHeight, r.w, r.h);
      const shown = visibleFraction(im.naturalWidth, im.naturalHeight, r.w, r.h);
      if (shown < spec.photo.minVisible) {
        warnings.push({ code: 'W_PHOTO_CROP', message: `${pageNo}面: 写真 ${ph.src} は枠に合わせて約${Math.round((1 - shown) * 100)}%が切り取られています。並べ方(rows)か枠の大きさを見直してください。` });
      }
    }
    node.dataset.photo = String(n);
    if (ph.shadow) node.classList.add('shadow');
    Object.assign(node.style, { left: mm(r.x), top: mm(r.y), width: mm(r.w), height: mm(r.h) });
    el.appendChild(node);
    if (!isVector(ph.src) && dpi && dpi < spec.dpi.warn) {
      warnings.push({ code: 'W_IMAGE_LOW_DPI', src: ph.src, dpi: Math.round(dpi), message: `${pageNo}面: 写真 ${ph.src} の解像度が約${Math.round(dpi)}dpi です(目安 ${spec.dpi.warn}dpi 以上)。印刷で粗く見えるおそれがあります。` });
    }
  }
  return el;
}

function tableElement(t) {
  const table = document.createElement('table');
  t.rows.forEach((row, i) => {
    const tr = table.insertRow();
    row.forEach((cell, j) => {
      const c = document.createElement(i < t.headerRows || j === 0 ? 'th' : 'td');
      c.colSpan = cell.colspan;
      c.innerHTML = cell.lines.map(escapeText).join('<br>');
      tr.appendChild(c);
    });
  });
  return table;
}

// 見出し枠: 入りきらなければ字間 → 文字サイズの順に詰める。文字の大きさを選んだ見出しは、字間だけ詰める
function fitTitles(pageEl, warnings, pageNo) {
  for (const box of pageEl.querySelectorAll('.titlebox')) {
    const over = () => box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1;
    const cs = getComputedStyle(box);
    let spacing = parseFloat(cs.letterSpacing) / parseFloat(cs.fontSize);
    let size = parseFloat(cs.fontSize);
    const minSize = box.dataset.size ? size : size * 0.8;
    while (over() && spacing > 0) {
      spacing = Math.max(0, spacing - 0.06);
      box.style.letterSpacing = `${spacing.toFixed(2)}em`;
    }
    while (over() && size > minSize) {
      size -= 0.5;
      box.style.fontSize = `${size}px`;
    }
    if (!over()) continue;
    const fix = box.dataset.size ? `枠を広げるか、文字を小さくしてください(いまは ${box.dataset.size}pt)` : '枠を広げるか、見出しを 2 行にしてください';
    warnings.push({ code: 'W_TITLE_FIT', message: `${pageNo}面: 見出し「${box.textContent}」が枠に入りきりません。${fix}。` });
  }
}

// リード・表・題字の画像を、置いた後で検査する
function checkBoxes(pageEl, spec, warnings, pageNo) {
  for (const lead of pageEl.querySelectorAll('.lead')) {
    if (lead.scrollWidth > lead.clientWidth + 1 || lead.scrollHeight > lead.clientHeight + 1) {
      warnings.push({ code: 'W_LEAD_OVERFLOW', message: `${pageNo}面: リード「${lead.textContent.slice(0, 12)}…」が枠からはみ出しています。` });
    }
  }
  for (const t of pageEl.querySelectorAll('.ptable')) {
    if (t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1) {
      warnings.push({ code: 'W_TABLE_OVERFLOW', message: `${pageNo}面: 表がパネルからはみ出しています。パネルを広げてください。` });
    }
  }
  for (const im of pageEl.querySelectorAll('.masthead img')) {
    const wmm = im.getBoundingClientRect().width / MM_PX;
    const dpi = im.naturalWidth / (wmm / 25.4);
    const name = im.dataset.src ?? decodeURIComponent(im.src.split('/').pop());
    if (!isVector(name) && dpi < spec.dpi.warn) {
      warnings.push({ code: 'W_IMAGE_LOW_DPI', message: `${pageNo}面: 題字の画像 ${name} の解像度が約${Math.round(dpi)}dpi です(目安 ${spec.dpi.warn}dpi 以上)。高解像度版に差し替えてください。` });
    }
  }
}
