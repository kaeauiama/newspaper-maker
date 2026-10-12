// 画面の枠(docs/04-editor.md「画面の構成」)。上の帯(号の名前・保存の状態・作業の画面の切り替え・明るさ・使い方)、
// 紙面の画面の検査のバッジ、それぞれの小窓。作業の画面は 原稿(集める)・紙面(組む)・入稿(仕上げる)の3つ。
// 隠している画面も組版の大きさを測れるように、CSS の visibility で隠す(display: none にはしない。editor.css)。

import { contentFingerprint } from '../engine/print.js';
import * as M from './model.js';
import { ICON } from './icons.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const WORKSPACES = ['genko', 'shimen', 'nyuko'];
const THEME_KEY = 'ysm-theme';

const HELP = `
  <div class="pop-head"><strong>使い方</strong></div>
  <h3>紙面の操作</h3>
  <ul>
    <li>クリックで選ぶ。ドラッグで動かす(別のページへも運べる。紙面の上端・下端の近くでは紙面が送られる)</li>
    <li>端の丸をドラッグして大きさを変える(上下の丸は1字ずつ吸着するので、段の途中まで張り出せる)</li>
    <li>写真パネルはダブルクリックで中身を編集する。写真はエクスプローラーからパネルへドラッグする</li>
    <li>本文をクリックすると記事を選ぶ(右の欄に収まりと原稿が出る)</li>
  </ul>
  <h3>キー</h3>
  <table>
    <tr><th>Ctrl+S</th><td>保存</td></tr>
    <tr><th>Ctrl+Z / Ctrl+Y</th><td>元に戻す / やり直す</td></tr>
    <tr><th>← →</th><td>1行動かす(Shift で幅を変える)</td></tr>
    <tr><th>↑ ↓</th><td>1段動かす(Shift で高さを変える。Alt で下端を1字ずつ)</td></tr>
    <tr><th>Ctrl+D</th><td>複製</td></tr>
    <tr><th>Ctrl+C → Ctrl+V</th><td>別のページへ写す(見ているページに貼る)</td></tr>
    <tr><th>Delete</th><td>消す</td></tr>
    <tr><th>Esc</th><td>選ぶのをやめる・小窓を閉じる</td></tr>
    <tr><th>Alt+1 / 2 / 3</th><td>原稿 / 紙面 / 入稿 の画面へ</td></tr>
  </table>
  <h3>画面</h3>
  <ul>
    <li>原稿: 記事の進み具合・メモ、原稿の編集、号の写真</li>
    <li>紙面: 配置と写真。検査で気になる所は道具の帯の右のバッジから</li>
    <li>入稿: 確認の一覧、刷る前の確認、刷り方、入稿用データ</li>
    <li>右上のボタンで、暗い画面と明るい画面を切り替えられる(このブラウザに覚えておく)</li>
  </ul>`;

export class Shell {
  constructor(ed) {
    this.ed = ed;
    this.ws = document.body.dataset.ws || 'shimen';
    this.open = null;           // 開いている小窓: 'issue' | 'help' | 'checks' | 'photos'
    this.pops = { issue: $('#issue-pop'), help: $('#help-pop'), checks: $('#checks-pop'), photos: $('#photo-pop') };
    this.triggers = { issue: $('#issue-btn'), help: $('#appbar [data-cmd="help"]'), checks: $('#checks-btn'), photos: null };
    this.checkList = [];
    this.pickList = [];
    this.pops.help.innerHTML = HELP;
    this.pops.issue.addEventListener('input', (e) => {
      const k = e.target.dataset.meta;
      if (k) this.ed.setMeta(k, e.target.value);
    });
    this.pops.issue.addEventListener('focusout', () => this.ed.endTextSession());
    this.pops.checks.addEventListener('click', (e) => {
      const b = e.target.closest('[data-check]');
      if (!b) return;
      this.close();
      this.locate(this.checkList[Number(b.dataset.check)]);
    });
    this.pops.photos.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      const sel = this.ed.selection;
      if (!b || sel?.kind !== 'item') return;
      this.close();
      this.ed.addPhotosTo([this.pickList[Number(b.dataset.pick)].src], { page: sel.page, index: sel.index });
    });
    // 小窓の外を押したら閉じる
    document.addEventListener('pointerdown', (e) => {
      if (!this.open) return;
      if (this.pops[this.open].contains(e.target) || this.triggers[this.open]?.contains(e.target)) return;
      this.close();
    });
    window.addEventListener('resize', () => { if (this.open) this.place(this.open); });
    this.syncTheme();
  }

  // ---- 作業の画面 ----

  setWorkspace(ws) {
    if (!WORKSPACES.includes(ws) || ws === this.ws) return;
    this.close();
    this.ed.endTextSession();
    // 隠す画面の入力欄にカーソルを残さない
    const active = document.activeElement;
    if (active && active !== document.body && active.closest('.ws')) active.blur();
    this.ws = ws;
    document.body.dataset.ws = ws;
    this.updateNav();
    if (ws === 'genko') this.ed.genko.update(true);
    else if (ws === 'nyuko') this.ed.printCheck.render();
    else {
      this.ed.inspector.update(true);
      this.ed.pageList.refresh();
    }
  }

  // ---- 上の帯 ----

  updateNav() {
    const { issue, result, texts } = this.ed;
    if (!issue) return;
    for (const b of document.querySelectorAll('#ws-nav [data-ws]')) {
      const on = b.dataset.ws === this.ws;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    const n = issue.articles.length;
    const fixed = issue.articles.filter((a) => a.status === 'fixed').length;
    this.sub('genko', n ? `確定 ${fixed}/${n}` : '記事なし', '');
    const errors = result?.errors.length ?? 0;
    const warnings = result?.warnings.length ?? 0;
    this.sub('shimen', errors ? `エラー ${errors}` : warnings ? `注意 ${warnings}` : '問題なし', errors ? 'err' : warnings ? 'warn' : '');
    const ap = issue.approval;
    const who = this.ed.publication.approver;
    const same = !!ap?.fingerprint && ap.fingerprint === contentFingerprint(issue, texts);
    this.sub('nyuko', !ap ? `${who}の確認 まだ` : same ? `${who}の確認 済み` : '確認のあとに変更あり', ap && !same ? 'warn' : '');
    $('#issue-title').textContent = `${this.ed.publication.name} 第${issue.number}号`;
    // 上の帯の印は紙名の1字目(見本通信なら「見」)
    $('#appbar .app-mark').textContent = [...this.ed.publication.name][0] ?? '紙';
    $('#issue-date').textContent = issue.date ?? '';
  }

  sub(ws, text, cls) {
    const el = document.querySelector(`[data-ws-sub="${ws}"]`);
    el.textContent = text;
    el.className = `ws-sub ${cls}`;
  }

  // 組み直したあと: 上の帯と検査のバッジ(一覧を開いていれば一覧も)
  update() {
    this.updateNav();
    this.updateChecks();
    if (this.open === 'checks') this.renderChecks();
  }

  // ---- 明るさ(暗い画面が既定。このブラウザに覚えておく) ----

  theme() {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  }

  toggleTheme() {
    const next = this.theme() === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // 覚えられなくても、いまの画面は切り替わる
    }
    this.syncTheme();
  }

  syncTheme() {
    const b = $('#appbar [data-cmd="theme"]');
    const light = this.theme() === 'light';
    b.innerHTML = light ? ICON.moon : ICON.sun;
    const label = light ? '暗い画面にする' : '明るい画面にする';
    b.setAttribute('aria-label', label);
    b.title = label;
  }

  // ---- 小窓 ----

  toggle(name, anchor = null) {
    if (this.open === name && (!anchor || anchor === this.triggers[name])) {
      this.close();
      return;
    }
    this.close();
    if (anchor) this.triggers[name] = anchor;
    if (name === 'issue') this.fillIssue();
    else if (name === 'checks') this.renderChecks();
    this.open = name;
    this.pops[name].hidden = false;
    this.place(name);
    this.triggers[name]?.setAttribute('aria-expanded', 'true');
    if (name === 'issue') this.pops.issue.querySelector('input')?.focus();
  }

  close() {
    if (!this.open) return;
    this.pops[this.open].hidden = true;
    this.triggers[this.open]?.setAttribute('aria-expanded', 'false');
    this.open = null;
  }

  // 押したボタンの下に出す(下に入りきらなければ上。ボタンが画面の右半分にあれば右をそろえる)
  place(name) {
    const t = this.triggers[name];
    const pop = this.pops[name];
    if (!t) return;
    const r = t.getBoundingClientRect();
    const h = pop.offsetHeight;
    const below = r.bottom + 6;
    pop.style.top = `${Math.round(below + h > innerHeight - 8 ? Math.max(8, r.top - 6 - h) : below)}px`;
    if (r.left + r.width / 2 > innerWidth / 2) {
      pop.style.left = 'auto';
      pop.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`;
    } else {
      pop.style.right = 'auto';
      pop.style.left = `${Math.max(8, Math.round(r.left))}px`;
    }
  }

  fillIssue() {
    const { issue, api } = this.ed;
    const where = { server: 'このパソコンのフォルダ(エディタのサーバー)', folder: 'このパソコンのフォルダ', onedrive: 'OneDrive', demo: '見本(保存されません)' }[api.kind] ?? '';
    $('#storage-where').textContent = `保存先: ${where} ${api.label ?? ''}`;
    this.pops.issue.querySelector('[data-meta="number"]').value = issue.number ?? '';
    this.pops.issue.querySelector('[data-meta="date"]').value = issue.date ?? '';
  }

  // キー: Esc で小窓を閉じる、Alt+1/2/3 で画面を切り替える。受けたら true
  handleKey(e) {
    if (e.key === 'Escape' && this.open) {
      e.preventDefault();
      this.close();
      return true;
    }
    const m = /^Digit([123])$/.exec(e.code);
    if (m && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      this.setWorkspace(WORKSPACES[Number(m[1]) - 1]);
      return true;
    }
    return false;
  }

  // ---- 検査のバッジと一覧 ----

  updateChecks() {
    const r = this.ed.result;
    const b = this.triggers.checks;
    const e = r?.errors.length ?? 0;
    const w = r?.warnings.length ?? 0;
    b.innerHTML = e || w
      ? `${e ? `<span class="cb err"><span class="dot"></span>エラー ${e}</span>` : ''}${w ? `<span class="cb warn"><span class="dot"></span>注意 ${w}</span>` : ''}${ICON.chevron}`
      : `<span class="cb ok">${ICON.check}問題なし</span>`;
    b.classList.toggle('has-err', e > 0);
  }

  renderChecks() {
    const r = this.ed.result;
    const list = [...(r?.errors ?? []).map((x) => ({ ...x, level: 'e' })), ...(r?.warnings ?? []).map((x) => ({ ...x, level: 'w' }))];
    this.checkList = list;
    const rows = list.map((x, i) => `
      <li class="${x.level}"><button type="button" data-check="${i}" title="押すと、その場所へ移ります">
        <span class="tag">${x.level === 'e' ? 'エラー' : '注意'}</span><span class="msg">${esc(x.message)}<br><code>${esc(x.code)}</code></span>
      </button></li>`).join('');
    this.pops.checks.innerHTML = `
      <div class="pop-head"><strong>検査</strong>${list.length ? '<span class="hint">押すと、その場所へ移ります</span>' : ''}</div>
      ${list.length ? `<ul class="check-list">${rows}</ul>` : '<p class="hint">問題はありません。</p>'}
      <div class="pop-foot"><button type="button" class="link" data-ws="nyuko">入稿の画面で確認の一覧を見る →</button></div>`;
  }

  // 検査の問題の場所へ: 写真ならそのパネル、記事ならその記事、「n面」で始まればそのページ
  locate(x) {
    if (!x) return;
    const ed = this.ed;
    if (x.src) {
      for (const [p, page] of ed.issue.pages.entries()) {
        const i = (page.items ?? []).findIndex((it) => it.type === 'panel' && !it.table && M.photoSources(it).includes(x.src));
        if (i >= 0) {
          ed.showItem(p, i);
          return;
        }
      }
    }
    const art = /記事「([^」]+)」/.exec(x.message);
    if (art && ed.issue.articles.some((a) => a.id === art[1])) {
      ed.showArticle(art[1]);
      return;
    }
    const page = /^(\d+)面/.exec(x.message);
    if (page) ed.showPage(Number(page[1]) - 1);
    else this.setWorkspace('shimen');
  }

  // ---- 号の写真から選んで、選んでいる写真パネルに足す ----

  openPhotoPicker(anchor) {
    const sel = this.ed.selection;
    if (sel?.kind !== 'item') return;
    this.pickList = this.ed.genko.allPhotos();
    const tiles = this.pickList.map((x, i) => `
      <button type="button" data-pick="${i}" title="${esc(x.name)}">
        <img src="${esc(this.ed.api.url(x.src))}" alt="" loading="lazy">
        <span class="name">${esc(x.name)}</span>
        <span class="hint">${x.pages.length ? x.pages.map((n) => `${n}面`).join('・') : '使っていない'}</span>
      </button>`).join('');
    this.pops.photos.innerHTML = `
      <div class="pop-head"><strong>号の写真から追加</strong>${tiles ? '<span class="hint">押すと、このパネルに足します</span>' : ''}</div>
      ${tiles ? `<div class="pick-grid">${tiles}</div>` : '<p class="hint">号の写真はまだありません。原稿の画面の「写真を取り込む」か、エクスプローラーからパネルへドラッグしてください。</p>'}`;
    this.toggle('photos', anchor);
  }
}
