// 号の設定(issue.jsonc)の検査。純粋関数。問題は理由コードつきで返し、黙って直さない。

import { contentBox, charsPerLine } from './spec.js';
import { resolveX, itemY } from './slots.js';

const ITEM_TYPES = ['title', 'lead', 'panel', 'box'];
const TEMPLATES = ['front', 'inner'];
export const TITLE_LOOKS = ['frame', 'reverse', 'plain'];   // 枠付き・白抜き・文字だけ
export const TITLE_DIRS = ['vertical', 'horizontal'];
export const BOX_LOOKS = ['gray', 'frame'];                 // 囲み記事: 地色・罫囲み
// 記事の進み具合: 依頼中・届いた・確認中(見てもらっている)・確定
export const ARTICLE_STATUSES = ['requested', 'received', 'checking', 'fixed'];

// 切り抜き [左, 上, 幅, 高さ](0〜1)が写真の内側に収まっているか
export function validCrop(c) {
  return Array.isArray(c) && c.length === 4 && c.every(Number.isFinite)
    && c[0] >= 0 && c[1] >= 0 && c[2] > 0 && c[3] > 0 && c[0] + c[2] <= 1.0001 && c[1] + c[3] <= 1.0001;
}

export function mastheadItem(spec) {
  return { type: 'masthead', dan: spec.masthead.dan, right: spec.masthead.right, width: spec.masthead.width };
}

export function validateIssue(issue, spec) {
  const errors = [];
  const warnings = [];
  const err = (code, message) => errors.push({ code, message });
  const warn = (code, message) => warnings.push({ code, message });

  if (!issue || typeof issue !== 'object') {
    err('E_CONFIG_EMPTY', 'issue.jsonc が空か、オブジェクトになっていません。');
    return { errors, warnings };
  }
  if (!Number.isInteger(issue.number) || issue.number < 0) err('E_CONFIG_NUMBER', '号数 number は 0 以上の整数で書いてください。');
  if (typeof issue.date !== 'string' || !issue.date.trim()) err('E_CONFIG_DATE', '発行年月 date を文字列で書いてください(例: "令和8年10月")。');

  const articles = Array.isArray(issue.articles) ? issue.articles : [];
  if (!articles.length) err('E_CONFIG_ARTICLES', '記事 articles が1本もありません。');
  const ids = new Set();
  articles.forEach((a, i) => {
    const where = `記事${i + 1}`;
    if (typeof a.id !== 'string' || !a.id) err('E_ARTICLE_ID', `${where}: id を書いてください。`);
    else if (ids.has(a.id)) err('E_ARTICLE_ID', `${where}: id「${a.id}」が重複しています。`);
    else ids.add(a.id);
    if (typeof a.file !== 'string' || !a.file) err('E_ARTICLE_FILE', `${where}: 原稿ファイル file を書いてください。`);
    if (a.status != null && !ARTICLE_STATUSES.includes(a.status)) err('E_ARTICLE_STATUS', `${where}: status(進み具合)は ${ARTICLE_STATUSES.join(' / ')} のどれかです。`);
  });

  const pages = Array.isArray(issue.pages) ? issue.pages : [];
  if (!pages.length) err('E_CONFIG_PAGES', 'ページ pages が1枚もありません。');
  else if (pages.length % 2 === 1) warn('W_PAGE_COUNT_ODD', `ページ数が ${pages.length} です。両面印刷なので偶数ページにすると裏面が空きません。`);
  // 刷り方と刷る前の確認の記録(入稿の画面で書く)
  const pr = issue.print;
  if (pr != null && (typeof pr !== 'object' || (pr.copies != null && !(Number.isInteger(pr.copies) && pr.copies > 0)) || (pr.paper != null && typeof pr.paper !== 'string') || (pr.color != null && typeof pr.color !== 'boolean'))) {
    err('E_CONFIG_PRINT', 'print(刷り方)は { "copies": 部数, "paper": "用紙", "color": true/false } で書いてください。');
  }
  const ap = issue.approval;
  if (ap != null && (typeof ap !== 'object' || typeof ap.date !== 'string')) err('E_CONFIG_APPROVAL', 'approval(刷る前の確認の記録)は { "by": "確認していただいた人", "date": "YYYY-MM-DD", "fingerprint": "…" } で書いてください。');

  const box = contentBox(spec);
  const cpl = charsPerLine(spec);
  pages.forEach((page, p) => {
    const pn = `${p + 1}面`;
    if (!TEMPLATES.includes(page.template)) err('E_CONFIG_TEMPLATE', `${pn}: template は ${TEMPLATES.join(' / ')} のどちらかです。`);
    if (page.template === 'front' && p !== 0) warn('W_FRONT_POSITION', `${pn}: 題字つきの front は通常 1 面だけに使います。`);
    const items = Array.isArray(page.items) ? page.items : [];
    const placed = page.template === 'front' ? [{ item: mastheadItem(spec), label: '題字' }] : [];
    items.forEach((it, k) => {
      const label = `${pn}の配置物${k + 1}(${it.type ?? '種類なし'})`;
      if (!ITEM_TYPES.includes(it.type)) { err('E_ITEM_TYPE', `${label}: type は ${ITEM_TYPES.join(' / ')} のどれかです。`); return; }
      const d = it.dan;
      if (!Array.isArray(d) || d.length !== 2 || !d.every(Number.isInteger) || d[0] < 1 || d[1] > spec.dan.count || d[0] > d[1]) {
        err('E_ITEM_DAN', `${label}: dan は [始めの段, 終わりの段](1〜${spec.dan.count})で書いてください。`);
        return;
      }
      const [l, r] = resolveX(spec, it);
      if (!(r > l) || l < box.left - 0.05 || r > box.right + 0.05) {
        err('E_ITEM_X', `${label}: 横位置が版面(左 ${box.left}〜右 ${box.right}mm)からはみ出しています(${l.toFixed(1)}〜${r.toFixed(1)}mm)。`);
        return;
      }
      // 段の途中まで張り出す枠(from・to は字数)
      const charsOk = (v, min) => v == null || (Number.isInteger(v) && v >= min && v < cpl);
      if (!charsOk(it.from, 0) || !charsOk(it.to, 1)) {
        err('E_ITEM_FROM_TO', `${label}: from・to は段の上端からの字数で、from は 0〜${cpl - 1}、to は 1〜${cpl - 1} の整数で書いてください(段の下端までなら書かない)。`);
        return;
      }
      if (it.dan[0] === it.dan[1] && it.from && it.to) {
        err('E_ITEM_FLOAT', `${label}: 段の真ん中に浮かせることはできません。枠の上端か下端を段の端に付けてください(from か to のどちらかを外す)。`);
        return;
      }
      const min = spec.partial.minChars;
      if (it.to && cpl - it.to < min) warn('W_SHORT_LINES', `${label}: 段${it.dan[1]} で枠の下に残る行が${cpl - it.to}字しかありません。短い行は字間が空きやすいので、${min}字以上残すことをすすめます。`);
      if (it.from && it.from < min) warn('W_SHORT_LINES', `${label}: 段${it.dan[0]} で枠の上に残る行が${it.from}字しかありません。短い行は字間が空きやすいので、${min}字以上残すことをすすめます。`);
      if ((it.type === 'title' || it.type === 'lead') && !ids.has(it.article)) {
        err('E_ITEM_ARTICLE', `${label}: article に記事の id を書いてください(「${it.article ?? ''}」は見つかりません)。`);
      }
      if (it.type === 'title' && it.look != null && !TITLE_LOOKS.includes(it.look)) err('E_ITEM_LOOK', `${label}: look は ${TITLE_LOOKS.join(' / ')} のどれかです。`);
      if (it.type === 'title' && it.dir != null && !TITLE_DIRS.includes(it.dir)) err('E_ITEM_DIR', `${label}: dir は ${TITLE_DIRS.join(' / ')} のどちらかです。`);
      if (it.type === 'title' && it.size != null && !spec.title.sizes.includes(it.size)) err('E_ITEM_SIZE', `${label}: size(文字の大きさ)は ${spec.title.sizes.join('・')}(pt)のどれかです。`);
      if (it.type === 'box') {
        if (typeof it.file !== 'string' || !it.file) err('E_BOX_FILE', `${label}: 囲み記事の原稿ファイル file を書いてください。`);
        if (it.look != null && !BOX_LOOKS.includes(it.look)) err('E_ITEM_LOOK', `${label}: look は ${BOX_LOOKS.join(' / ')} のどちらかです。`);
      }
      if (it.type === 'panel') {
        const n = [it.photos, it.rows, it.table].filter((v) => v != null).length;
        if (n === 0) err('E_PANEL_EMPTY', `${label}: photos・rows・table のどれかを書いてください。`);
        if (it.photos && it.rows) err('E_PANEL_BOTH', `${label}: photos と rows は同時に使えません。`);
        for (const ph of Array.isArray(it.photos) ? it.photos : []) {
          if (ph.crop != null && !validCrop(ph.crop)) {
            err('E_PHOTO_CROP', `${label}: 写真 ${ph.src} の crop は [左, 上, 幅, 高さ](元の写真に対する 0〜1 の割合)で、写真の外にはみ出さないように書いてください。`);
          }
        }
      }
      placed.push({ item: it, label });
    });
    for (let a = 0; a < placed.length; a++) {
      for (let b = a + 1; b < placed.length; b++) {
        const A = placed[a], B = placed[b];
        const [at, ab] = itemY(spec, A.item);
        const [bt, bb] = itemY(spec, B.item);
        const [al, ar] = resolveX(spec, A.item);
        const [bl, br] = resolveX(spec, B.item);
        if (at < bb - 0.05 && bt < ab - 0.05 && al < br - 0.05 && bl < ar - 0.05) warn('W_ITEM_OVERLAP', `${A.label}と${B.label}が重なっています。`);
      }
    }
  });

  articles.forEach((a, i) => {
    const s = a.start ?? { page: 1, dan: 1 };
    const ok = Number.isInteger(s.page) && s.page >= 1 && s.page <= pages.length
      && Number.isInteger(s.dan) && s.dan >= 1 && s.dan <= spec.dan.count
      && (s.slot == null || (Number.isInteger(s.slot) && s.slot >= 1));
    if (!ok) err('E_ARTICLE_START', `記事${i + 1}(${a.id ?? ''}): start は { "page": 面, "dan": 段, "slot": 右から何番目か(省略時 1) } で書いてください。`);
  });

  return { errors, warnings };
}
