// 原稿を整える画面(docs/04-editor.md)。見つかった直し方を、数と例(前 → 後)つきで並べ、選んだものだけを当てる。
// 当てるのは1回の操作として記録するので、Ctrl+Z で元に戻せる。

import { analyze, applyFixes } from './cleanup.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export class TextCleanup {
  constructor(ed) {
    this.ed = ed;
    this.root = document.getElementById('cleanup');
    this.file = null;
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cl]');
      if (!b) return;
      if (b.dataset.cl === 'apply') this.apply();
      else this.close();
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  open(file, title) {
    const found = analyze(this.ed.texts.get(file) ?? '');
    if (!found.length) {
      this.ed.toast('整えるところは見つかりませんでした。');
      return;
    }
    this.file = file;
    const ex = (x) => `<li><span class="before">${esc(x.before)}</span> → <span class="after">${esc(x.after)}</span></li>`;
    this.root.innerHTML = `
      <div class="dlg-box" role="dialog" aria-modal="true" aria-label="原稿を整える">
        <div class="dlg-head"><strong>原稿を整える</strong><span class="dlg-sub">${esc(title)}(${esc(file)})</span><span class="grow"></span><button type="button" data-cl="close">やめる</button></div>
        <ul class="dlg-list">
          ${found.map((f) => `
            <li>
              <input type="checkbox" data-fix="${f.id}" ${f.on ? 'checked' : ''} aria-label="${esc(f.label)}">
              <div><b>${esc(f.label)}</b>(${f.count}か所)<ul class="cl-ex">${f.examples.map(ex).join('')}</ul></div>
            </li>`).join('')}
        </ul>
        <div class="dlg-actions">
          <button type="button" class="primary" data-cl="apply">チェックしたものを直す</button>
          <span class="dlg-why">⏎ は改行です。直したあとでも Ctrl+Z で元に戻せます。</span>
        </div>
      </div>`;
    this.root.hidden = false;
  }

  close() {
    this.root.hidden = true;
    this.root.replaceChildren();
    this.file = null;
  }

  apply() {
    const ids = [...this.root.querySelectorAll('[data-fix]:checked')].map((c) => c.dataset.fix);
    const file = this.file;
    this.close();
    if (!ids.length) return;
    const text = this.ed.texts.get(file) ?? '';
    const next = applyFixes(text, ids);
    if (next === text) return;
    this.ed.replaceText(file, next);
    this.ed.toast('原稿を整えました。Ctrl+Z で元に戻せます。');
  }

  onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }
}
