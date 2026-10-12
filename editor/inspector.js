// 紙面の画面の右の欄。選んでいるもの(配置物・記事)の設定を出す(何も選んでいなければ使い方の手がかり)。
// 入力中の欄を作り直すとカーソルが飛ぶので、作り直すのは選択が変わったときだけにし、
// 字数・大きさ・解像度などは refreshLive() で差し替える。
// 検査の一覧は道具の帯の右のバッジ(editor/shell.js)、記事の進み具合・メモは原稿の画面(editor/genko.js)にある。

import { SPEC } from '../engine/spec.js';
import { photoList } from './model.js';
import { ICON } from './icons.js';

// 記事の進み具合(engine/validate.js の ARTICLE_STATUSES)
export const STATUS = [['', '未設定'], ['requested', '依頼中'], ['received', '届いた'], ['checking', '確認中'], ['fixed', '確定']];
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const options = (list, current) => list.map(([v, label]) => `<option value="${esc(v)}"${String(v) === String(current) ? ' selected' : ''}>${esc(label)}</option>`).join('');
export const statusBadge = (st) => (st ? `<span class="status status-${st}">${STATUS.find(([v]) => v === st)?.[1] ?? st}</span>` : '');
const FOCUS = [['', '中央'], ['50% 0%', '上'], ['50% 100%', '下'], ['0% 50%', '左'], ['100% 50%', '右']];
const TEXT_HINT = '# 見出し、> リード、▼小見出し、・や※で始まる行は箇条書き。それ以外の行は1行1段落。書くそばから紙面が組み直ります。';

const head = (icon, title, sub) => `<div class="ip-head"><span class="ip-icon" aria-hidden="true">${icon}</span><div><h2>${esc(title)}</h2>${sub ? `<p class="hint">${sub}</p>` : ''}</div></div>`;
const card = (title, body) => `<section class="card">${title ? `<h3>${title}</h3>` : ''}${body}</section>`;

export class Inspector {
  constructor(root, ed) {
    this.root = root;
    this.ed = ed;
    this.key = null;
    root.addEventListener('input', (e) => this.onInput(e));
    root.addEventListener('change', (e) => this.onChange(e));
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('focusout', (e) => { if (e.target.matches('textarea, input')) this.ed.endTextSession(); });
  }

  update(force = false) {
    const key = this.ed.selectionKey();
    if (force || key !== this.key || !this.root.firstChild) {
      this.key = key;
      this.build();
    }
    this.refreshLive();
  }

  build() {
    const sel = this.ed.selection;
    if (!sel) this.root.innerHTML = this.noneHtml();
    else if (sel.kind === 'article') this.root.innerHTML = this.articleHtml(sel.id);
    else this.root.innerHTML = this.itemHtml(sel.page, sel.index);
  }

  noneHtml() {
    return `
      <div class="ip-head"><div><h2>選んでいるものはありません</h2></div></div>
      <section class="card ip-tips">
        <p>紙面の配置物か本文をクリックすると、ここに設定が出ます。</p>
        <ul>
          <li>ドラッグで動かす。別のページへも運べます</li>
          <li>端の丸で大きさを変える</li>
          <li>写真パネルはダブルクリックで中身を編集</li>
          <li>写真はエクスプローラーから紙面へドラッグ</li>
        </ul>
        <button type="button" data-cmd="help">操作とショートカットの一覧</button>
      </section>`;
  }

  articleHtml(id) {
    const a = this.ed.issue.articles.find((x) => x.id === id);
    if (!a) return '';
    const title = this.ed.articleTitle(id);
    return `
      ${head(ICON.text, title, `記事(${esc(a.file)})`)}
      ${card('', '<p class="stat" data-live="stat"></p><div class="fits" data-live="fits"></div>')}
      ${card('始まる位置', '<div class="row start" data-live="start"></div>')}
      ${card('原稿', `
        <textarea data-text="${esc(a.file)}" spellcheck="false" aria-label="原稿">${esc(this.ed.texts.get(a.file) ?? '')}</textarea>
        <p class="hint">${TEXT_HINT}</p>
        <div class="actions">
          <button type="button" data-act="cleanup" data-file="${esc(a.file)}" data-title="${esc(title)}" title="メールなどから貼った原稿の、途中の改行・半角カナ・全角数字などを直す">原稿を整える…</button>
          <button type="button" data-act="open-genko" data-id="${esc(id)}" title="原稿の画面で、進み具合・メモと一緒に開く">原稿の画面で開く</button>
        </div>`)}
      <div class="actions">
        <button type="button" data-act="add-title-for" data-id="${esc(id)}">${ICON.title}見出し枠を置く</button>
        <button type="button" data-act="add-lead-for" data-id="${esc(id)}">${ICON.lead}リードを置く</button>
      </div>`;
  }

  itemHtml(p, i) {
    const item = this.ed.issue.pages[p]?.items?.[i];
    if (!item) return '';
    const where = `${p + 1}面`;
    const size = card('位置と大きさ', '<p class="hint" data-live="size"></p>');
    const pageCount = this.ed.issue.pages.length;
    const move = (p > 0 ? `<button type="button" data-act="to-prev-page" title="同じ位置が空いていなければ、同じ大きさの空きへ">${p}面へ移す</button>` : '')
      + (p + 1 < pageCount ? `<button type="button" data-act="to-next-page" title="同じ位置が空いていなければ、同じ大きさの空きへ">${p + 2}面へ移す</button>` : '');
    const foot = `<div class="actions ip-foot"><button type="button" data-act="duplicate" title="同じページの空いている所に写しを置く(Ctrl+D)。Ctrl+C → Ctrl+V なら別のページへも">${ICON.copy}複製</button>${move}<span class="grow"></span><button type="button" class="danger" data-act="remove-item" title="この配置物を消す(Delete)">消す</button></div>`;
    if (item.type === 'title' || item.type === 'lead') {
      const arts = this.ed.issue.articles.map((a) => [a.id, this.ed.articleTitle(a.id)]);
      const what = item.type === 'title' ? '見出し枠' : 'リード';
      const line = item.type === 'title' ? '# の行' : '> の行';
      const looks = item.type !== 'title' ? '' : `
        <div class="row"><label>見た目</label><select data-prop="look">${options([['frame', '枠付き'], ['reverse', '白抜き(黒地)'], ['plain', '文字だけ']], item.look ?? 'frame')}</select></div>
        <div class="row"><label>向き</label><select data-prop="dir">${options([['vertical', '縦書き'], ['horizontal', '横書き']], item.dir ?? 'vertical')}</select></div>
        <div class="row"><label>文字の大きさ</label><select data-prop="size">${options([['', `標準(${SPEC.title.base[item.look ?? 'frame']}pt)`], ...SPEC.title.sizes.map((s) => [s, `${s}pt`])], item.size ?? '')}</select></div>`;
      return `
        ${head(item.type === 'title' ? ICON.title : ICON.lead, what, where)}
        ${size}
        ${card('設定', `
          <div class="row"><label>記事</label><select data-prop="article">${options(arts, item.article)}</select></div>${looks}
          <p class="hint">文字は原稿の ${line} で書きます。</p>
          <div class="actions"><button type="button" data-act="select-article" data-id="${esc(item.article)}">原稿を開く</button></div>`)}
        ${foot}`;
    }
    if (item.type === 'box') {
      return `
        ${head(ICON.box, '囲み記事', where)}
        ${size}
        ${card('見た目', `<div class="row"><label>見た目</label><select data-prop="look">${options([['gray', '地色(薄い灰色)'], ['frame', '罫で囲む']], item.look ?? 'gray')}</select></div>`)}
        ${card('原稿', `
          <textarea data-text="${esc(item.file)}" spellcheck="false" style="min-height:200px" aria-label="囲み記事の原稿">${esc(this.ed.texts.get(item.file) ?? '')}</textarea>
          <p class="hint"># の行が上の帯の見出し。・や ※ で始まる行は箇条書き(字下げしない)、▼ は小見出し、それ以外の行は1行1段落。最後に ■ は付かない。</p>
          <div class="actions"><button type="button" data-act="cleanup" data-file="${esc(item.file)}" data-title="囲み記事">原稿を整える…</button></div>`)}
        ${foot}`;
    }
    if (item.table) {
      return `
        ${head(ICON.table, '表のパネル', where)}
        ${size}
        ${card('文字', `
          <label class="field">上の見出し<input type="text" data-prop="title" value="${esc(item.title)}"></label>
          <label class="field">キャプション<input type="text" data-prop="caption" value="${esc(item.caption)}"></label>`)}
        ${card('表', `
          <textarea data-text="${esc(item.table)}" spellcheck="false" style="min-height:160px" aria-label="表">${esc(this.ed.texts.get(item.table) ?? '')}</textarea>
          <p class="hint">| で区切って書きます。|---| の行より上が見出し行。セルが「&lt;」だけなら左と結合、&lt;br&gt; で改行。</p>`)}
        ${foot}`;
    }
    const photos = photoList(item);
    const rows = Math.max(1, ...photos.map((ph) => (ph.row ?? 0) + 1)) + 1;
    const rowOptions = Array.from({ length: rows }, (_, r) => [r, `${r + 1}行目`]);
    const list = photos.map((ph, n) => `
      <li>
        <img src="${esc(this.ed.api.url(ph.src))}" alt="">
        <div>
          <div class="name">${esc(ph.src.replace(/^photos\//, ''))}</div>
          <div class="hint" data-live-photo="${esc(ph.src)}"></div>
          <div class="ctrl">
            ${ph.row == null ? '' : `<select data-photo-row="${n}" aria-label="並べる行">${options(rowOptions, ph.row)}</select>`}
            ${ph.cropped ? '' : `<select data-photo-focus="${n}" title="切り取るときの中心" aria-label="切り取るときの中心">${options(FOCUS, ph.focus)}</select>`}
            <button type="button" class="small" data-act="photo-up" data-photo="${n}" title="${item.photos ? '後ろへ(ほかの写真の下になる)' : '前へ'}" aria-label="${item.photos ? '後ろへ' : '前へ'}">↑</button>
            <button type="button" class="small" data-act="photo-down" data-photo="${n}" title="${item.photos ? '手前へ(ほかの写真の上になる)' : '後ろへ'}" aria-label="${item.photos ? '手前へ' : '後ろへ'}">↓</button>
            <button type="button" class="small danger" data-act="photo-remove" data-photo="${n}" title="パネルから外す(写真のファイルは消さない)">外す</button>
          </div>
        </div>
      </li>`).join('');
    const mode = item.photos
      ? '<p class="hint">写真を枠と切り抜きで置いています。パネルの大きさを変えても写真の縦横比は保たれます。余白が気になるときは「自動で並べる」を押してください。</p>'
      : '<p class="hint">写真は行ごとにパネルいっぱいに並び、はみ出す分は切り取られます。パネルの大きさを変えると、いまの見え方のまま枠と切り抜きの置き方に切り替わります。</p>';
    return `
      ${head(ICON.photo, '写真パネル', where)}
      ${size}
      ${card('文字', `
        <label class="field">キャプション<input type="text" data-prop="caption" value="${esc(item.caption)}"></label>
        <label class="field">上の見出し<input type="text" data-prop="title" value="${esc(item.title)}" placeholder="なし"></label>`)}
      ${card(`写真 ${photos.length}枚`, `
        <ul class="photos">${list || '<li class="hint">まだ写真がありません。</li>'}</ul>
        <div class="actions">
          <button type="button" class="primary" data-act="edit-panel" title="写真の配置と切り抜きを、大きな画面で編集する(パネルをダブルクリックしても開く)">パネルを編集…</button>
          ${photos.length ? '<button type="button" data-act="auto-arrange" title="見えている範囲のまま、縦横比を保って敷き詰める">自動で並べる</button>' : ''}
        </div>
        <div class="actions">
          <button type="button" data-act="pick-photo" title="原稿の画面で取り込んだ写真や、ほかのパネルの写真から選んで足す">号の写真から…</button>
          <button type="button" data-act="add-photo" title="パソコンの写真を選んで取り込み、このパネルに足す">写真を追加…</button>
        </div>
        ${mode}
        <p class="hint">エクスプローラーから写真をこのパネルへドラッグしても追加できます。パネルから外しても、写真のファイルは消しません。</p>`)}
      ${foot}`;
  }

  // 字数・大きさ・開始位置の選択肢・写真の解像度を差し替える
  refreshLive() {
    const { result, selection: sel } = this.ed;
    if (sel?.kind === 'article') {
      const a = result?.articles.find((x) => x.id === sel.id);
      const stat = this.root.querySelector('[data-live="stat"]');
      if (stat) {
        stat.textContent = !a ? '' : a.overflowChars ? `${a.chars}字・${a.overflowChars}字あふれています` : `${a.chars}字・末尾の空き ${a.emptyLines}行`;
        stat.classList.toggle('bad', !!a?.overflowChars);
      }
      const start = this.root.querySelector('[data-live="start"]');
      if (start && !start.contains(document.activeElement)) start.innerHTML = this.startHtml(sel.id);
      const fits = this.root.querySelector('[data-live="fits"]');
      if (fits) fits.innerHTML = this.fitsHtml(sel.id, a);
    }
    // 写真の元の大きさと、置いた大きさでの解像度(低いものは赤く)
    for (const el of this.root.querySelectorAll('[data-live-photo]')) {
      const src = el.dataset.livePhoto;
      const px = this.ed.sizes.get(src);
      const low = (result?.warnings ?? []).find((w) => w.code === 'W_IMAGE_LOW_DPI' && w.src === src);
      el.textContent = [px ? `${px.w}×${px.h}px` : '', low ? `約${low.dpi}dpi(低め)` : ''].filter(Boolean).join('・');
      el.classList.toggle('bad', !!low);
    }
    if (sel?.kind === 'item') {
      const size = this.root.querySelector('[data-live="size"]');
      const g = this.ed.itemGeometry(sel.page, sel.index);
      if (size && g) size.textContent = `${g.label}、幅 ${g.lines}行ぶん(${g.width.toFixed(1)}mm)`;
    }
  }

  // 収める手伝い: あふれ・空きすぎのときにボタン、探したあとは直し方の一覧
  fitsHtml(id, a) {
    const f = this.ed.currentFits(id);
    const over = !!a?.overflowChars;
    const loose = !!a && !over && a.emptyLines > SPEC.underfullLines;
    if (!f) {
      if (!over && !loose) return '';
      return `<button type="button" data-act="find-fits" data-id="${esc(id)}" title="配置物の幅・位置・高さや記事の始まりを少しずつ変えて試しに組み、効くものを探す">${over ? '収める直し方を探す' : '空きを埋める直し方を探す'}</button>`;
    }
    if (f.status === 'searching') return '<p class="hint">探しています…(試しに組んで確かめています)</p>';
    if (!f.list.length) {
      return `<p class="hint">1か所の直しでは見つかりませんでした。写真パネルを小さくする、原稿を削る(足す)などで調整してください。</p>
        <button type="button" data-act="find-fits" data-id="${esc(id)}">もう一度探す</button>`;
    }
    const result = (x) => (over ? `収まる・末尾の空き ${x.emptyLines}行` : `末尾の空き ${x.emptyLines}行`);
    return `<p class="hint">試しに組んで効いた直し方(変える量の少ない順):</p>
      <ol class="fit-list">${f.list.map((x, n) => `<li><span>${esc(x.label)}</span><span class="hint">(${result(x)})</span><br>
        <button type="button" class="small" data-act="apply-fit" data-id="${esc(id)}" data-n="${n}">この直し方にする</button></li>`).join('')}</ol>`;
  }

  startHtml(id) {
    const { issue, result } = this.ed;
    const a = issue.articles.find((x) => x.id === id);
    const s = { page: 1, dan: 1, slot: 1, ...a.start };
    const pages = issue.pages.map((_, p) => [p + 1, `${p + 1}面`]);
    const dans = Array.from({ length: 5 }, (_, d) => [d + 1, `段${d + 1}`]);
    const slotCount = (result?.slots ?? []).filter((x) => x.page === s.page && x.dan === s.dan).length;
    const slots = Array.from({ length: Math.max(1, slotCount) }, (_, k) => [k + 1, `右から${k + 1}番目の枠`]);
    return `<select data-start="page" aria-label="始まる面">${options(pages, s.page)}</select>
      <select data-start="dan" aria-label="始まる段">${options(dans, s.dan)}</select>
      <select data-start="slot" aria-label="始まる枠">${options(slots, s.slot ?? 1)}</select>`;
  }

  onInput(e) {
    const t = e.target;
    if (t.dataset.text) this.ed.setText(t.dataset.text, t.value);
    else if (t.dataset.prop && t.tagName === 'INPUT') this.ed.setItemProp(t.dataset.prop, t.value);
  }

  onChange(e) {
    const t = e.target;
    if (t.dataset.start) {
      const box = t.closest('[data-live="start"]');
      const get = (k) => Number(box.querySelector(`[data-start="${k}"]`).value);
      const start = { page: get('page'), dan: get('dan'), slot: t.dataset.start === 'slot' ? get('slot') : 1 };
      this.ed.setArticleStart(this.ed.selection.id, start);
    } else if (t.dataset.prop && t.tagName === 'SELECT') this.ed.setItemProp(t.dataset.prop, t.value);
    else if (t.dataset.photoRow != null) this.ed.photoAction('row', Number(t.dataset.photoRow), Number(t.value));
    else if (t.dataset.photoFocus != null) this.ed.photoAction('focus', Number(t.dataset.photoFocus), t.value);
  }

  onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const id = b.dataset.id;
    const n = Number(b.dataset.photo);
    if (act === 'select-article') this.ed.select({ kind: 'article', id });
    else if (act === 'open-genko') this.ed.openInGenko(id);
    else if (act === 'remove-item') this.ed.removeSelected();
    else if (act === 'duplicate') this.ed.duplicateSelected();
    else if (act === 'to-prev-page') this.ed.moveSelectedToPage(-1);
    else if (act === 'to-next-page') this.ed.moveSelectedToPage(1);
    else if (act === 'add-title-for') this.ed.addItem('title', id);
    else if (act === 'add-lead-for') this.ed.addItem('lead', id);
    else if (act === 'add-photo') this.ed.pickPhotos();
    else if (act === 'pick-photo') this.ed.shell.openPhotoPicker(b);
    else if (act === 'cleanup') this.ed.cleanup.open(b.dataset.file, b.dataset.title);
    else if (act === 'find-fits') this.ed.findFits(id);
    else if (act === 'apply-fit') this.ed.applyFit(id, Number(b.dataset.n));
    else if (act === 'auto-arrange') this.ed.autoArrange();
    else if (act === 'edit-panel') this.ed.panelEditor.open(this.ed.selection.page, this.ed.selection.index);
    else if (act === 'photo-up') this.ed.photoAction('move', n, -1);
    else if (act === 'photo-down') this.ed.photoAction('move', n, +1);
    else if (act === 'photo-remove') this.ed.photoAction('remove', n);
  }
}
