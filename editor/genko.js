// 原稿の画面(docs/04-editor.md「画面の構成」)。記事の一覧(進み具合・メモ・文字数・紙面での収まり)と、
// 選んだ記事の原稿・進み具合・メモ、号の写真の一覧(どのページで使っているか・解像度が足りるか)。
// 紙面は裏で組み直るので、書くそばから「紙面での収まり」が変わる。

import { SPEC } from '../engine/spec.js';
import { STATUS, statusBadge, options, esc } from './inspector.js';
import * as M from './model.js';
import { ICON } from './icons.js';

const FILTERS = [['all', 'すべて'], ['requested', '依頼中'], ['received', '届いた'], ['checking', '確認中'], ['fixed', '確定'], ['none', '未設定']];
const HINT = '# 見出し、> リード、▼小見出し、・や※で始まる行は箇条書き。それ以外の行は1行1段落。書くそばから紙面が組み直ります。';
const statusOf = (a) => a.status || 'none';

export class GenkoView {
  constructor(ed) {
    this.ed = ed;
    this.root = document.getElementById('ws-genko');
    this.current = null;        // 右に出している記事
    this.filter = 'all';
    this.files = null;          // photos/ にある写真(号フォルダからのパス)。読めなければ null
    this.detailKey = null;
    this.photosKey = null;
    this.root.innerHTML = `
      <div class="toolbar">
        <button type="button" class="tool" data-cmd="add-article" title="新しい記事を足す(いまの最後の記事の次から始まる)">${ICON.plus}<span>記事を足す</span></button>
        <button type="button" class="tool" data-gk="import" title="写真を号フォルダの photos/ に取り込む">${ICON.photo}<span>写真を取り込む</span></button>
        <span class="tsep"></span>
        <span class="tlabel">しぼる</span>
        <span class="gk-filters" role="group" aria-label="進み具合でしぼる"></span>
      </div>
      <div class="gk-body">
        <div class="gk-main">
          <section class="card gk-articles" aria-label="記事の一覧"></section>
          <section class="card gk-photos" aria-label="号の写真"></section>
        </div>
        <section class="card gk-detail" aria-label="原稿"></section>
      </div>`;
    this.$ = (sel) => this.root.querySelector(sel);
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.articleProp === 'memo') this.ed.setArticleProp(t.dataset.id, 'memo', t.value);
      else if (t.dataset.text) this.ed.setText(t.dataset.text, t.value);
    });
    this.root.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.articleProp === 'status') this.ed.setArticleProp(t.dataset.id, 'status', t.value);
    });
    this.root.addEventListener('focusout', (e) => { if (e.target.matches('textarea, input')) this.ed.endTextSession(); });
    const photos = this.$('.gk-photos');
    photos.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      photos.classList.add('drop');
    });
    photos.addEventListener('dragleave', (e) => { if (!photos.contains(e.relatedTarget)) photos.classList.remove('drop'); });
    photos.addEventListener('drop', (e) => {
      photos.classList.remove('drop');
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      this.importPhotos([...e.dataTransfer.files]);
    });
  }

  get isOpen() {
    return this.ed.shell.ws === 'genko';
  }

  // 右に出す記事(なければ最初の記事)
  currentArticle() {
    const arts = this.ed.issue.articles;
    if (!arts.some((a) => a.id === this.current)) this.current = arts[0]?.id ?? null;
    return arts.find((a) => a.id === this.current) ?? null;
  }

  // force: 原稿の欄も作り直す(元に戻したとき・画面を開いたときなど、欄の外で原稿が変わったとき)
  update(force = false) {
    if (!this.isOpen || !this.ed.issue) return;
    const a = this.currentArticle();
    this.renderFilters();
    this.renderArticles();
    this.renderPhotos(force);
    const key = a ? `${a.id}|${a.file}` : 'none';
    if (force || key !== this.detailKey) {
      this.detailKey = key;
      this.renderDetail(a);
    } else this.refreshDetail(a);
  }

  // ---- 記事の一覧 ----

  renderFilters() {
    const arts = this.ed.issue.articles;
    const count = (f) => (f === 'all' ? arts.length : arts.filter((a) => statusOf(a) === f).length);
    this.$('.gk-filters').innerHTML = FILTERS
      .filter(([f]) => f === 'all' || count(f) > 0 || this.filter === f)
      .map(([f, label]) => `<button type="button" class="chip" data-gk-filter="${f}" aria-pressed="${this.filter === f}">${label} ${count(f)}</button>`).join('');
  }

  renderArticles() {
    const { issue, result } = this.ed;
    const arts = issue.articles.filter((a) => this.filter === 'all' || statusOf(a) === this.filter);
    const rows = arts.map((a) => {
      const r = result?.articles.find((x) => x.id === a.id);
      return `
        <tr data-gk-row="${esc(a.id)}"${a.id === this.current ? ' class="on"' : ''}>
          <td><button type="button" class="linklike" data-gk-article="${esc(a.id)}">${esc(this.ed.articleTitle(a.id))}</button><span class="file">${esc(a.file)}</span></td>
          <td>${statusBadge(a.status) || '<span class="hint">未設定</span>'}</td>
          <td class="num">${r ? `${r.chars.toLocaleString()}字` : '—'}</td>
          <td>${this.fitHtml(r)}</td>
          <td class="gk-memo">${esc(a.memo ?? '')}</td>
        </tr>`;
    }).join('');
    const empty = issue.articles.length ? 'この進み具合の記事はありません。' : '記事がありません。「記事を足す」で足してください。';
    this.$('.gk-articles').innerHTML = `
      <header class="card-head"><h2>記事 ${issue.articles.length}本</h2><span class="hint">行を選ぶと、右に原稿が出ます</span></header>
      <div class="table-wrap"><table class="gk-table">
        <thead><tr><th>記事</th><th>進み具合</th><th class="num">文字数</th><th>紙面での収まり</th><th>メモ</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="hint">${empty}</td></tr>`}</tbody>
      </table></div>`;
  }

  // 紙面での収まり(どのページか・あふれ・後ろの空き)
  fitHtml(r) {
    if (!r) return '<span class="hint">—</span>';
    const pages = [...new Set(r.boxes.map((b) => b.page))];
    const where = !pages.length ? '紙面に場所がない' : pages.length === 1 ? `${pages[0]}面` : `${pages[0]}〜${pages.at(-1)}面`;
    if (r.overflowChars) return `<span class="fit err">${where} · ${r.overflowChars}字あふれ</span>`;
    if (r.emptyLines > SPEC.underfullLines) return `<span class="fit warn">${where} · 終わりが ${r.emptyLines}行空き</span>`;
    return `<span class="fit ok">${where} · 収まっている</span>`;
  }

  // ---- 選んだ記事の原稿 ----

  renderDetail(a) {
    const el = this.$('.gk-detail');
    if (!a) {
      el.innerHTML = '<p class="hint">記事を選ぶと、ここに原稿が出ます。</p>';
      return;
    }
    el.innerHTML = `
      <header class="card-head gk-dh">
        <div><h2 data-gk-live="title">${esc(this.ed.articleTitle(a.id))}</h2><span class="file">${esc(a.file)}</span></div>
        <button type="button" data-gk="to-shimen" data-id="${esc(a.id)}" title="紙面の画面で、この記事を選ぶ">紙面で見る${ICON.arrowRight}</button>
      </header>
      <div class="gk-fields">
        <label>進み具合<select data-article-prop="status" data-id="${esc(a.id)}">${options(STATUS, a.status ?? '')}</select></label>
        <label class="grow">メモ<input type="text" data-article-prop="memo" data-id="${esc(a.id)}" value="${esc(a.memo)}" placeholder="例: ○○先生に依頼、10/20 締め切り"></label>
      </div>
      <p class="stat" data-gk-live="stat"></p>
      <textarea class="gk-text" data-text="${esc(a.file)}" spellcheck="false" aria-label="原稿">${esc(this.ed.texts.get(a.file) ?? '')}</textarea>
      <p class="hint">${HINT}</p>
      <div class="actions">
        <button type="button" data-gk="cleanup" data-file="${esc(a.file)}" title="メールなどから貼った原稿の、途中の改行・半角カナ・全角数字などを直す">原稿を整える…</button>
        <span class="grow"></span>
        <button type="button" class="danger" data-gk="remove" data-id="${esc(a.id)}" title="原稿ファイル(${esc(a.file)})は消しません">号から外す</button>
      </div>`;
    this.refreshDetail(a);
  }

  refreshDetail(a) {
    if (!a) return;
    const r = this.ed.result?.articles.find((x) => x.id === a.id);
    const stat = this.$('[data-gk-live="stat"]');
    if (stat) {
      const pages = r ? [...new Set(r.boxes.map((b) => b.page))] : [];
      const where = pages.length > 1 ? `${pages[0]}〜${pages.at(-1)}面` : pages.length ? `${pages[0]}面` : '';
      stat.textContent = !r ? '' : r.overflowChars ? `${r.chars}字・${where}で ${r.overflowChars}字あふれています` : `${r.chars}字・${where ? `${where}に収まっている(` : '('}末尾の空き ${r.emptyLines}行)`;
      stat.classList.toggle('bad', !!r?.overflowChars);
    }
    const title = this.$('[data-gk-live="title"]');
    if (title) title.textContent = this.ed.articleTitle(a.id);
  }

  // ---- 号の写真 ----

  async loadFiles() {
    try {
      this.files = await this.ed.api.listPhotos();
      await this.ed.api.ensureUrls?.(this.files);   // 静的ページ版: 縮小表示の画像を読んでおく
    } catch {
      this.files = null;
    }
    this.photosKey = null;
  }

  // photos/ の写真と紙面で使っている写真: [{ src, name, pages: [n面...], dpi }]
  allPhotos() {
    const { issue, result } = this.ed;
    const used = new Map();
    issue.pages.forEach((page, p) => (page.items ?? []).forEach((it) => {
      if (it.type !== 'panel' || it.table) return;
      for (const src of M.photoSources(it)) used.set(src, (used.get(src) ?? new Set()).add(p + 1));
    }));
    const low = new Map((result?.warnings ?? []).filter((w) => w.code === 'W_IMAGE_LOW_DPI' && w.src).map((w) => [w.src, w.dpi]));
    return [...new Set([...(this.files ?? []), ...used.keys()])].sort().map((src) => ({
      src,
      name: src.replace(/^photos\//, ''),
      pages: [...(used.get(src) ?? [])].sort((a, b) => a - b),
      dpi: low.get(src) ?? null,
    }));
  }

  renderPhotos(force = false) {
    const list = this.allPhotos();
    const key = JSON.stringify([list, this.files == null]);
    if (!force && key === this.photosKey) return;   // 変わっていなければ描き直さない(写真がちらつかないように)
    this.photosKey = key;
    const low = list.filter((x) => x.dpi).length;
    const unused = list.filter((x) => !x.pages.length).length;
    const tiles = list.map((x) => `
      <figure class="gk-photo${x.pages.length ? '' : ' unused'}${x.dpi ? ' low' : ''}">
        <span class="img"><img src="${esc(this.ed.api.url(x.src))}" alt="" loading="lazy">${x.dpi ? `<span class="badge">約${x.dpi}dpi</span>` : ''}</span>
        <figcaption><span class="name" title="${esc(x.name)}">${esc(x.name)}</span><span class="hint">${x.pages.length ? x.pages.map((n) => `${n}面`).join('・') : '使っていない'}</span></figcaption>
      </figure>`).join('');
    const notes = [low ? `<span class="warn-text">解像度が低い ${low}</span>` : '', unused ? `使っていない ${unused}` : ''].filter(Boolean).join('・');
    this.$('.gk-photos').innerHTML = `
      <header class="card-head"><h2>写真 ${list.length}枚</h2><span class="hint">${notes}</span></header>
      <div class="gk-grid">${tiles}<button type="button" class="gk-drop" data-gk="import">${ICON.plus}<span>写真を取り込む<br>(ここへドラッグしても)</span></button></div>
      ${this.files == null ? '<p class="hint">photos/ の一覧を読めなかったので、紙面で使っている写真だけを出しています。</p>' : ''}
      <p class="hint">取り込んだ写真は、紙面の写真パネルの「号の写真から…」で置けます。解像度は、紙面に置いた大きさで調べます。</p>`;
  }

  async importPhotos(files) {
    const paths = await this.ed.uploadPhotos(files);
    if (!paths.length) return;
    await this.loadFiles();
    this.update();
    this.ed.toast(`写真を${paths.length}枚取り込みました。紙面の写真パネルの「号の写真から…」で置けます。`);
  }

  // ---- 操作 ----

  onClick(e) {
    const f = e.target.closest('[data-gk-filter]');
    if (f) {
      this.filter = f.dataset.gkFilter;
      this.update();
      return;
    }
    const row = e.target.closest('[data-gk-article], tr[data-gk-row]');
    if (row) {
      const id = row.dataset.gkArticle ?? row.dataset.gkRow;
      if (id !== this.current) {
        this.ed.endTextSession();
        this.current = id;
        this.update();
      }
      return;
    }
    const b = e.target.closest('[data-gk]');
    if (!b) return;
    const act = b.dataset.gk;
    if (act === 'import') document.getElementById('photo-import').click();
    else if (act === 'to-shimen') this.ed.showArticle(b.dataset.id);
    else if (act === 'cleanup') this.ed.cleanup.open(b.dataset.file, this.ed.articleTitle(this.current));
    else if (act === 'remove') this.ed.removeArticle(b.dataset.id);
  }
}
