// 紙面の画面の左の欄(docs/04-editor.md「画面の構成」): ページの縮小表示(押すとそのページへ)と、
// 記事の一覧(押すとその記事を選ぶ)。紙面を組み直したあとで描き直す。あふれた記事のあるページには赤い点を付ける。

import { SPEC } from '../engine/spec.js';
import { pageThumb } from './thumbs.js';
import { ICON } from './icons.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const THUMB_W = 112;

export class PageList {
  constructor(ed) {
    this.ed = ed;
    this.root = document.getElementById('pagelist');
    this.tab = 'pages';
    this.timer = null;
    this.root.innerHTML = `
      <div class="seg" role="group" aria-label="左の欄に出すもの">
        <button type="button" data-pl-tab="pages" aria-pressed="true">ページ</button>
        <button type="button" data-pl-tab="articles" aria-pressed="false">記事</button>
      </div>
      <div class="pl-list"></div>
      <button type="button" class="dashed" data-cmd="add-page" title="最後にページを足す">${ICON.plus}<span>ページを足す</span></button>`;
    this.list = this.root.querySelector('.pl-list');
    this.root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-pl-tab]');
      if (t) {
        this.setTab(t.dataset.plTab);
        return;
      }
      const p = e.target.closest('[data-pl-page]');
      if (p) {
        this.ed.showPage(Number(p.dataset.plPage));
        return;
      }
      const a = e.target.closest('[data-pl-article]');
      if (a) this.ed.showArticle(a.dataset.plArticle);
    });
    // 紙面を送ったら、いま見ているページに印を付け直す
    let raf = 0;
    document.getElementById('canvas').addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        this.markCurrent();
      });
    });
  }

  setTab(tab) {
    this.tab = tab;
    for (const b of this.root.querySelectorAll('[data-pl-tab]')) b.setAttribute('aria-pressed', String(b.dataset.plTab === tab));
    this.refresh();
  }

  // 組み直しが続くときは、落ち着いてから描き直す
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), 150);
  }

  refresh() {
    clearTimeout(this.timer);
    if (this.tab === 'pages') this.renderPages();
    else this.renderArticles();
  }

  renderPages() {
    const frag = document.createDocumentFragment();
    for (const src of document.querySelectorAll('#pages .page')) {
      const n = Number(src.dataset.page);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pl-page';
      b.dataset.plPage = String(n - 1);
      b.title = `${n}面へ`;
      b.appendChild(pageThumb(src, THUMB_W));
      const label = document.createElement('span');
      label.className = 'pl-label';
      label.textContent = `${n}面`;
      b.appendChild(label);
      if (src.querySelector('.overflow')) {
        const dot = document.createElement('span');
        dot.className = 'pl-dot';
        dot.title = 'あふれている記事があります';
        b.appendChild(dot);
      }
      frag.appendChild(b);
    }
    this.list.replaceChildren(frag);
    this.markCurrent();
  }

  renderArticles() {
    const { issue, result, selection } = this.ed;
    if (!issue) return;
    this.list.innerHTML = issue.articles.map((a) => {
      const r = result?.articles.find((x) => x.id === a.id);
      const fit = !r ? '' : r.overflowChars ? `<span class="fit err">${r.overflowChars}字あふれ</span>`
        : r.emptyLines > SPEC.underfullLines ? `<span class="fit warn">終わりが ${r.emptyLines}行空き</span>` : '<span class="fit ok">収まっている</span>';
      const on = selection?.kind === 'article' && selection.id === a.id;
      return `<button type="button" class="pl-article${on ? ' on' : ''}" data-pl-article="${esc(a.id)}"><span class="t">${esc(this.ed.articleTitle(a.id))}</span>${fit}</button>`;
    }).join('') || '<p class="hint">記事はまだありません。原稿の画面で足せます。</p>';
  }

  markCurrent() {
    if (this.tab !== 'pages') return;
    const p = this.ed.visiblePage();
    for (const b of this.list.querySelectorAll('.pl-page')) b.classList.toggle('current', Number(b.dataset.plPage) === p);
  }
}
