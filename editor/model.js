// エディタの操作。号の設定(issue)を受け取り、変更した新しい設定を返す純粋関数。
// 置けない操作は理由つきで断る(黙って直さない)。

import { contentBox, linePitch } from '../engine/spec.js';
import { resolveX, itemY } from '../engine/slots.js';
import { mastheadItem } from '../engine/validate.js';
import { round2, rightStops, minWidth } from './snap.js';
import { photoArea } from '../engine/gallery.js';
import { fitPhotos, withNewPhoto, fillSingle } from './photos.js';

const clone = (v) => structuredClone(v);

// 配置物の横位置を「右端からの距離 + 幅」の形にそろえる
export function withX(spec, item, left, right) {
  const { right: R } = contentBox(spec);
  const out = { ...item, right: round2(R - right), width: round2(right - left) };
  delete out.left;
  delete out.x;
  return out;
}

// 配置物の位置: { dan, left, right } と、段の途中まで張り出すときは from・to(字数)
export function rectOf(spec, item) {
  const [left, right] = resolveX(spec, item);
  const r = { dan: [...item.dan], left, right };
  if (item.from) r.from = item.from;
  if (item.to) r.to = item.to;
  return r;
}

// 縦の範囲(dan・from・to)を入れ替える。from・to は dan のすぐ後ろに置く(issue.jsonc で読みやすいように)
function withY(item, rect) {
  const out = {};
  for (const [k, v] of Object.entries(item)) {
    if (k === 'from' || k === 'to') continue;
    if (k !== 'dan') {
      out[k] = v;
      continue;
    }
    out.dan = [...rect.dan];
    if (rect.from) out.from = rect.from;
    if (rect.to) out.to = rect.to;
  }
  return out;
}

// 配置物の大きさ { w, h }(mm)
export function sizeOf(spec, rect) {
  const [top, bottom] = itemY(spec, rect);
  return { w: rect.right - rect.left, h: bottom - top };
}

// ページの配置物(題字を含む)。index は page.items の番号、題字は 'masthead'
export function placedItems(spec, page) {
  const list = (page.items ?? []).map((item, index) => ({ index, item, rect: rectOf(spec, item) }));
  if (page.template === 'front') list.unshift({ index: 'masthead', item: mastheadItem(spec), rect: rectOf(spec, mastheadItem(spec)) });
  return list;
}

function overlap(spec, a, b) {
  const [at, ab] = itemY(spec, a);
  const [bt, bb] = itemY(spec, b);
  return at < bb - 0.05 && bt < ab - 0.05 && a.left < b.right - 0.05 && b.left < a.right - 0.05;
}

// rect を置けるか。exceptIndex は動かしている配置物自身
export function canPlace(spec, page, rect, exceptIndex = null) {
  const box = contentBox(spec);
  if (rect.dan[0] < 1 || rect.dan[1] > spec.dan.count || rect.dan[0] > rect.dan[1]) return { ok: false, reason: '段の範囲が版面の外です。' };
  if (rect.left < box.left - 0.05 || rect.right > box.right + 0.05) return { ok: false, reason: '版面の外には置けません。' };
  if (rect.right - rect.left < minWidth(spec) - 0.05) return { ok: false, reason: '1行ぶんより狭くはできません。' };
  if (rect.dan[0] === rect.dan[1] && rect.from && rect.to) return { ok: false, reason: '段の真ん中に浮かせることはできません(上か下を段の端に付けてください)。' };
  const hit = placedItems(spec, page).find((p) => p.index !== exceptIndex && overlap(spec, rect, p.rect));
  if (hit) return { ok: false, reason: hit.index === 'masthead' ? '題字と重なります。' : 'ほかの配置物と重なります。' };
  return { ok: true };
}

// 写真を座標で置いているパネル(photos)は、パネルの大きさが変わっても写真の縦横比を保ち、
// 一様に伸び縮みさせて写真の範囲の中央に置く(docs/05-proposals.md 2-2)
function scalePhotos(spec, item, before, after) {
  if (!Array.isArray(item.photos)) return item;
  return { ...item, photos: fitPhotos(item.photos, photoArea(spec, item, before.w, before.h), photoArea(spec, item, after.w, after.h)) };
}

// 位置と大きさを変えた配置物(写真パネルの写真は縦横比を保って伸縮する)
// sizes: 写真の元の大きさ(Map)。写真が1枚だけのパネルの大きさが変わったら、写真を範囲いっぱいにする(fillSingle)
function reposition(spec, old, rect, sizes = null) {
  const item = withX(spec, withY(old, rect), rect.left, rect.right);
  const before = sizeOf(spec, rectOf(spec, old));
  const after = sizeOf(spec, rect);
  const resized = Math.abs(before.w - after.w) > 0.01 || Math.abs(before.h - after.h) > 0.01;
  const one = Array.isArray(item.photos) && item.photos.length === 1 ? sizes?.get(item.photos[0].src) : null;
  if (resized && one) return { ...item, photos: [fillSingle(item.photos[0], photoArea(spec, item, after.w, after.h), one)] };
  return scalePhotos(spec, item, before, after);
}

// rect: { dan, left, right, from?, to? }。prepared: 動かす前に差し替える配置物(エディタが rows を「枠 + 切り抜き」に直したものなど)
export function setGeometry(spec, issue, pageIndex, itemIndex, rect, prepared = null, sizes = null) {
  const check = canPlace(spec, issue.pages[pageIndex], rect, itemIndex);
  if (!check.ok) return { issue, error: check.reason };
  const next = clone(issue);
  next.pages[pageIndex].items[itemIndex] = reposition(spec, prepared ?? next.pages[pageIndex].items[itemIndex], rect, sizes);
  return { issue: next };
}

// 配置物を別のページへ移す。rect は移した先での位置。移した先ではいちばん後ろに足し、その番号を index で返す
export function moveToPage(spec, issue, fromPage, itemIndex, toPage, rect, prepared = null, sizes = null) {
  if (toPage === fromPage) {
    const r = setGeometry(spec, issue, fromPage, itemIndex, rect, prepared, sizes);
    return r.error ? r : { ...r, index: itemIndex };
  }
  if (!issue.pages[toPage]) return { issue, error: 'そのページはありません。' };
  const check = canPlace(spec, issue.pages[toPage], rect);
  if (!check.ok) return { issue, error: check.reason };
  const next = clone(issue);
  const item = reposition(spec, prepared ?? next.pages[fromPage].items[itemIndex], rect, sizes);
  next.pages[fromPage].items.splice(itemIndex, 1);
  next.pages[toPage].items = [...(next.pages[toPage].items ?? []), item];
  return { issue: next, index: next.pages[toPage].items.length - 1 };
}

// となりのページ(direction: -1 前、+1 次)で、配置物を置く位置。同じ位置が空いていなければ、同じ大きさの空きを探す
export function adjacentTarget(spec, issue, pageIndex, itemIndex, direction) {
  const to = pageIndex + direction;
  if (!issue.pages[to]) return { error: direction < 0 ? 'これより前のページはありません。' : 'これより後ろのページはありません。' };
  const rect = placeFor(spec, issue.pages[to], rectOf(spec, issue.pages[pageIndex].items[itemIndex]));
  if (!rect) return { error: `${to + 1}面には、この大きさの空きがありません。` };
  return { page: to, rect };
}

// ページ page で、rect と同じ大きさの配置物を置く位置。同じ位置が空いていればそこ、なければ同じ大きさの空きを右上から探す
export function placeFor(spec, page, rect) {
  if (canPlace(spec, page, rect).ok) return rect;
  const lines = Math.round((rect.right - rect.left + 2 * spec.wrapGap) / linePitch(spec));
  const spot = findFreeSpot(spec, page, lines, rect.dan[1] - rect.dan[0] + 1);
  return spot && { ...spot, ...(rect.from ? { from: rect.from } : {}), ...(rect.to ? { to: rect.to } : {}) };
}

// 配置物の写しを、ページ toPage の rect に置く。表・囲み記事は、写しの原稿ファイル newFile を指すようにする
// (同じファイルを指すと、片方を直すともう片方も変わってしまうため)。戻り値の index は写しの番号
export function duplicateItem(spec, issue, toPage, item, rect, newFile = null) {
  const page = issue.pages[toPage];
  if (!page) return { issue, error: 'そのページはありません。' };
  const check = canPlace(spec, page, rect);
  if (!check.ok) return { issue, error: check.reason };
  const copy = reposition(spec, clone(item), rect);
  if (newFile && copy.table) copy.table = newFile;
  if (newFile && copy.type === 'box') copy.file = newFile;
  const next = clone(issue);
  next.pages[toPage].items = [...(next.pages[toPage].items ?? []), copy];
  return { issue: next, index: next.pages[toPage].items.length - 1 };
}

// 写しのために、中身のファイルを写す必要があるか(表・囲み記事)。あればそのファイル名
export function itemFile(item) {
  if (item.table) return item.table;
  if (item.type === 'box') return item.file ?? null;
  return null;
}

// 配置物を丸ごと差し替える(パネルの写真の並べ直しなど)
export function replaceItem(issue, pageIndex, itemIndex, item) {
  const next = clone(issue);
  next.pages[pageIndex].items[itemIndex] = item;
  return next;
}

// 空いている場所を右上から探す。lines: 幅(行数)、dans: 高さ(段数)
export function findFreeSpot(spec, page, lines, dans) {
  const width = lines * linePitch(spec) - 2 * spec.wrapGap;
  for (let d = 1; d + dans - 1 <= spec.dan.count; d++) {
    for (const right of rightStops(spec)) {
      const rect = { dan: [d, d + dans - 1], left: round2(right - width), right: round2(right) };
      if (canPlace(spec, page, rect).ok) return rect;
    }
  }
  return null;
}

// 新しい配置物の既定の大きさ(行数 × 段数)
const DEFAULT_SIZE = { panel: [14, 2], table: [17, 1], title: [2, 2], lead: [3, 1], box: [12, 1] };

export function addItem(spec, issue, pageIndex, kind, extra = {}) {
  const [lines, dans] = DEFAULT_SIZE[kind];
  const page = issue.pages[pageIndex];
  const rect = extra.rect ?? findFreeSpot(spec, page, lines, dans);
  if (!rect) return { issue, error: `このページに ${lines}行 × ${dans}段 の空きがありません。` };
  const check = canPlace(spec, page, rect);
  if (!check.ok) return { issue, error: check.reason };
  const base = kind === 'table' ? { type: 'panel', title: '表の見出し', table: extra.table }
    : kind === 'panel' ? { type: 'panel', caption: 'キャプション', rows: extra.rows ?? [] }
      : kind === 'box' ? { type: 'box', file: extra.file }
        : { type: kind, article: extra.article };
  const item = withX(spec, { ...base, dan: rect.dan }, rect.left, rect.right);
  const next = clone(issue);
  next.pages[pageIndex].items = [...(next.pages[pageIndex].items ?? []), item];
  return { issue: next, index: next.pages[pageIndex].items.length - 1 };
}

export function removeItem(issue, pageIndex, itemIndex) {
  const next = clone(issue);
  next.pages[pageIndex].items.splice(itemIndex, 1);
  return next;
}

// 号の欄(刷る前の確認の記録 approval・刷り方 print など)を変える。undefined なら消す
export function setIssueProp(issue, key, value) {
  const next = clone(issue);
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

export function updateItem(issue, pageIndex, itemIndex, patch) {
  const next = clone(issue);
  const item = { ...next.pages[pageIndex].items[itemIndex], ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined || v === '') delete item[k];
  next.pages[pageIndex].items[itemIndex] = item;
  return next;
}

// パネルの見出し・キャプションを変える。帯ができたり消えたりして写真の範囲が変わるときは、
// 写真を縦横比を保ったまま新しい範囲に収める。panel: パネルの大きさ { w, h }(mm)
export function updatePanelText(spec, issue, pageIndex, itemIndex, patch, panel, sizes = null) {
  const before = issue.pages[pageIndex].items[itemIndex];
  const next = updateItem(issue, pageIndex, itemIndex, patch);
  const item = next.pages[pageIndex].items[itemIndex];
  if (Array.isArray(item.photos)) {
    const a = photoArea(spec, before, panel.w, panel.h);
    const b = photoArea(spec, item, panel.w, panel.h);
    const one = item.photos.length === 1 ? sizes?.get(item.photos[0].src) : null;
    if (a.y !== b.y || a.h !== b.h) item.photos = one ? [fillSingle(item.photos[0], b, one)] : fitPhotos(item.photos, a, b);
  }
  return next;
}

// 写真を「枠 + 切り抜き」のパネルに足す。写真全体を縦横比どおりの枠で、ほかの写真と重ならない所に置く。
// size: 元の写真の大きさ { w, h }(px)、panel: パネルの大きさ { w, h }(mm)
export function addPhotoFrame(spec, issue, pageIndex, itemIndex, src, size, panel) {
  const next = clone(issue);
  next.pages[pageIndex].items[itemIndex] = withNewPhoto(spec, next.pages[pageIndex].items[itemIndex], src, size, panel);
  return next;
}

// 写真を rows のパネルに足す(最後の行へ。3枚を超えたら新しい行)。「枠 + 切り抜き」のパネルには addPhotoFrame を使う
export function addPhoto(issue, pageIndex, itemIndex, src) {
  const item = issue.pages[pageIndex].items[itemIndex];
  if (Array.isArray(item.photos)) return { issue, error: '写真を座標で置いているパネルには、写真の大きさを調べてから足します(addPhotoFrame)。' };
  const next = clone(issue);
  const rows = next.pages[pageIndex].items[itemIndex].rows ?? [];
  if (!rows.length || rows.at(-1).length >= 3) rows.push([src]);
  else rows.at(-1).push(src);
  next.pages[pageIndex].items[itemIndex].rows = rows;
  return next;
}

// rows の写真を平らに並べたときの番号で扱う
function flatRows(rows) {
  return rows.flatMap((row, r) => row.map((ph) => ({ ph, row: r })));
}
function buildRows(flat) {
  const rows = [];
  for (const { ph, row } of flat) (rows[row] ??= []).push(ph);
  return rows.filter((r) => r && r.length);
}

export function removePhoto(issue, pageIndex, itemIndex, photoIndex) {
  const next = clone(issue);
  const item = next.pages[pageIndex].items[itemIndex];
  if (Array.isArray(item.photos)) item.photos.splice(photoIndex, 1);
  else item.rows = buildRows(flatRows(item.rows ?? []).filter((_, i) => i !== photoIndex));
  return next;
}

// 写真の順番を前後に動かす(direction: -1 = 前へ、+1 = 後ろへ)
export function movePhoto(issue, pageIndex, itemIndex, photoIndex, direction) {
  const next = clone(issue);
  const item = next.pages[pageIndex].items[itemIndex];
  const list = Array.isArray(item.photos) ? item.photos : flatRows(item.rows ?? []);
  const j = photoIndex + direction;
  if (j < 0 || j >= list.length) return issue;
  [list[photoIndex], list[j]] = [list[j], list[photoIndex]];
  if (!Array.isArray(item.photos)) {
    // 行の割り当ては位置についていくので、入れ替えた2枚の行も入れ替えて元に戻す
    [list[photoIndex].row, list[j].row] = [list[j].row, list[photoIndex].row];
    item.rows = buildRows(list);
  }
  return next;
}

// 写真を何行目に置くか(0 始まり)。rows のパネルだけ
export function setPhotoRow(issue, pageIndex, itemIndex, photoIndex, row) {
  const next = clone(issue);
  const item = next.pages[pageIndex].items[itemIndex];
  if (!Array.isArray(item.rows)) return issue;
  const flat = flatRows(item.rows);
  flat[photoIndex].row = row;
  flat.sort((a, b) => a.row - b.row);
  item.rows = buildRows(flat);
  return next;
}

// 切り取りの中心。focus は "50% 20%" のような CSS の object-position
export function setPhotoFocus(issue, pageIndex, itemIndex, photoIndex, focus) {
  const next = clone(issue);
  const item = next.pages[pageIndex].items[itemIndex];
  const apply = (ph) => {
    const obj = typeof ph === 'string' ? { src: ph } : { ...ph };
    if (focus) obj.focus = focus;
    else delete obj.focus;
    return obj;
  };
  if (Array.isArray(item.photos)) {
    item.photos[photoIndex] = apply(item.photos[photoIndex]);
  } else {
    const flat = flatRows(item.rows ?? []);
    const obj = apply(flat[photoIndex].ph);
    flat[photoIndex].ph = Object.keys(obj).length === 1 ? obj.src : obj;   // 中心の指定がなければファイル名だけに戻す
    item.rows = buildRows(flat);
  }
  return next;
}

// パネルの写真の一覧(表示用)。cropped: 枠 + 切り抜きで持っているか
export function photoList(item) {
  if (Array.isArray(item.photos)) return item.photos.map((ph) => ({ src: ph.src, focus: ph.focus ?? '', row: null, cropped: Array.isArray(ph.crop) }));
  return flatRows(item.rows ?? []).map(({ ph, row }) => ({ src: typeof ph === 'string' ? ph : ph.src, focus: typeof ph === 'string' ? '' : ph.focus ?? '', row, cropped: false }));
}

// パネルに使っている写真のファイル
export function photoSources(item) {
  if (Array.isArray(item.photos)) return item.photos.map((ph) => ph.src);
  return (item.rows ?? []).flat().map((p) => (typeof p === 'string' ? p : p.src));
}

export function addPage(issue) {
  const next = clone(issue);
  next.pages.push({ template: 'inner', items: [] });
  return next;
}

// ページを消す。そのページから始まる記事があれば断る
export function removePage(issue, pageIndex) {
  const n = pageIndex + 1;
  const starting = issue.articles.filter((a) => (a.start?.page ?? 1) === n);
  if (starting.length) return { issue, error: `このページから始まる記事(${starting.map((a) => a.id).join('、')})があります。先に記事の開始位置を移してください。` };
  if (issue.pages.length <= 1) return { issue, error: '最後の1ページは消せません。' };
  const next = clone(issue);
  next.pages.splice(pageIndex, 1);
  for (const a of next.articles) if (a.start && a.start.page > n) a.start.page -= 1;
  return { issue: next };
}

export function addArticle(issue, id, file, start) {
  const next = clone(issue);
  next.articles.push({ id, file, start });
  return next;
}

// 記事を号から外す(原稿ファイルは消さない)。その記事の見出し枠・リードも外す
export function removeArticle(issue, id) {
  const next = clone(issue);
  next.articles = next.articles.filter((a) => a.id !== id);
  for (const page of next.pages) page.items = (page.items ?? []).filter((it) => !((it.type === 'title' || it.type === 'lead') && it.article === id));
  return next;
}

// 記事の欄(進み具合 status・メモ memo など)を変える。空にした欄は消す
export function updateArticle(issue, id, patch) {
  const next = clone(issue);
  const a = next.articles.find((x) => x.id === id);
  if (!a) return issue;
  Object.assign(a, patch);
  for (const [k, v] of Object.entries(patch)) if (v === undefined || v === '') delete a[k];
  return next;
}

export function setArticleStart(issue, id, start) {
  const next = clone(issue);
  const a = next.articles.find((x) => x.id === id);
  a.start = { page: start.page, dan: start.dan, ...(start.slot > 1 ? { slot: start.slot } : {}) };
  return next;
}

// ほかと重ならない名前を作る(記事の id、ファイル名、写真のファイル名に使う)
export function uniqueName(base, taken, ext = '') {
  const clean = base.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
  let name = `${clean}${ext}`;
  for (let i = 2; taken.has(name); i++) name = `${clean}-${i}${ext}`;
  return name;
}
