// 見開きのプレビュー(docs/04-editor.md)。いまの紙面を、印刷したときの見え方(選択や枠の表示なし)で、
// 読む順の見開きに並べて全画面で見る。縦組みの右綴じなので、見開きは「左が後のページ、右が先のページ」。
//   4ページの号: 1面 → 3面|2面 → 4面(A3 二つ折りを開いたときの見え方)

import { printClone } from './thumbs.js';

// n ページの号の見開き。各要素は左から並べるページ番号(1 始まり)
export function spreadsOf(n) {
  if (n < 1) return [];
  const out = [[1]];
  for (let p = 2; p <= n; p += 2) out.push(p + 1 <= n ? [p + 1, p] : [p]);
  return out;
}

const HINT = '← または Space で次の見開き、→ で前の見開き(右綴じなので左へ進みます)。紙面の左半分をクリックしても次へ。Esc で閉じる。';

export class SpreadPreview {
  constructor(ed) {
    this.ed = ed;
    this.root = document.getElementById('spread');
    this.spreads = [];
    this.index = 0;
    this.root.innerHTML = `
      <div class="sp-bar">
        <strong>見開きプレビュー</strong>
        <span class="sp-pos"></span>
        <span class="sp-checks"></span>
        <span class="grow"></span>
        <button type="button" data-sp="next" title="次の見開き(←)">◀ 次へ</button>
        <button type="button" data-sp="prev" title="前の見開き(→)">前へ ▶</button>
        <button type="button" data-sp="full" title="画面いっぱいに表示する">全画面</button>
        <button type="button" data-sp="close" class="primary" title="閉じる(Esc)">閉じる</button>
      </div>
      <div class="sp-stage"></div>
      <p class="sp-hint">${HINT}</p>`;
    this.stage = this.root.querySelector('.sp-stage');
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sp]');
      if (b) {
        const act = b.dataset.sp;
        if (act === 'next') this.go(1);
        else if (act === 'prev') this.go(-1);
        else if (act === 'full') this.fullscreen();
        else if (act === 'close') this.close();
        return;
      }
      // 紙面の左半分で次へ、右半分で前へ(本をめくる向き)
      if (e.target.closest('.sp-stage')) {
        const r = this.stage.getBoundingClientRect();
        this.go(e.clientX < r.left + r.width / 2 ? 1 : -1);
      }
    });
    window.addEventListener('resize', () => { if (this.isOpen) this.render(); });
    document.addEventListener('fullscreenchange', () => {
      if (!this.isOpen) return;
      // 全画面を Esc などで抜けたら、プレビューも閉じる(全画面で開いていたとき)
      if (!document.fullscreenElement && this.wasFull) this.close();
      else this.render();
      this.wasFull = !!document.fullscreenElement;
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  // いま見ているページを含む見開きから開く。full: 全画面にする(ボタンを押したときだけ効く)
  open(page = 1, full = true) {
    const n = document.querySelectorAll('#pages .page').length;
    if (!n) return;
    this.spreads = spreadsOf(n);
    this.index = Math.max(0, this.spreads.findIndex((s) => s.includes(page)));
    this.root.hidden = false;
    this.wasFull = false;
    this.render();
    if (full) this.fullscreen();
  }

  close() {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.stage.replaceChildren();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }

  fullscreen() {
    if (document.fullscreenElement) return;
    // アプリ内のブラウザなどで全画面にできないときは、ウィンドウいっぱいの表示のまま
    this.root.requestFullscreen?.().then(() => { this.wasFull = true; }).catch(() => {});
  }

  go(delta) {
    const i = Math.min(this.spreads.length - 1, Math.max(0, this.index + delta));
    if (i === this.index) return;
    this.index = i;
    this.render();
  }

  render() {
    const pages = [...document.querySelectorAll('#pages .page')];
    if (!pages.length) return;
    const spread = this.spreads[this.index];
    const pw = pages[0].offsetWidth;
    const ph = pages[0].offsetHeight;
    const r = this.stage.getBoundingClientRect();
    // 見開き(2ページ分の幅)が入る大きさにそろえる。1ページだけの面も同じ大きさで見せる
    const k = Math.max(0.1, Math.min((r.width - 48) / (2 * pw), (r.height - 36) / ph));
    const row = document.createElement('div');
    row.className = `sp-spread${spread.length === 2 ? ' two' : ''}`;
    for (const n of spread) {
      const src = pages.find((el) => Number(el.dataset.page) === n);
      if (!src) continue;
      // 編集の表示(選択・案の枠・選んだ記事の色・あふれの赤枠)は外して、印刷の見え方にする
      const page = printClone(src);
      Object.assign(page.style, { transform: `scale(${k})`, transformOrigin: '0 0', margin: '0' });
      const box = document.createElement('div');
      box.className = 'sp-page';
      Object.assign(box.style, { width: `${pw * k}px`, height: `${ph * k}px` });
      const label = document.createElement('span');
      label.className = 'sp-label';
      label.textContent = `${n}面`;
      box.append(page, label);
      row.appendChild(box);
    }
    this.stage.replaceChildren(row);
    const names = spread.map((n) => `${n}面`).join('・');
    this.root.querySelector('.sp-pos').textContent = `${this.index + 1} / ${this.spreads.length}(${names})`;
    const res = this.ed.result;
    const checks = this.root.querySelector('.sp-checks');
    checks.textContent = res ? `検査: エラー ${res.errors.length}・警告 ${res.warnings.length}` : '';
    checks.classList.toggle('bad', !!res?.errors.length);
    this.root.querySelector('[data-sp="next"]').disabled = this.index >= this.spreads.length - 1;
    this.root.querySelector('[data-sp="prev"]').disabled = this.index <= 0;
  }

  // キー(紙面のキー操作の代わりに受ける)
  onKey(e) {
    const k = e.key;
    if (k === 'Escape') this.close();
    else if (k === 'ArrowLeft' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) this.go(1);
    else if (k === 'ArrowRight' || k === 'PageUp' || (k === ' ' && e.shiftKey)) this.go(-1);
    else if (k === 'Home') this.go(-this.spreads.length);
    else if (k === 'End') this.go(this.spreads.length);
    else return;
    e.preventDefault();
  }
}
