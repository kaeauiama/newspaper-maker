// 紙名と題字の設定の画面(docs/04-editor.md「紙名と題字の設定」)。紙名の設定(publication.jsonc)の
// 紙名・PDF のファイル名・刷る前に確認していただく人と、題字の中身(画像・文字・線)を作る。
// すべての号で共通の設定なので、号の「元に戻す」とは別に、この画面の中で戻す(Ctrl+Z / Ctrl+Y)。
// 「保存する」で publication.jsonc に書く(画像は足したときに brand/ へ取り込む)。「やめる」と何も変えない。

import { SPEC } from '../engine/spec.js';
import { mastheadPart } from '../engine/render.js';
import { mastheadInner, validatePublication, MASTHEAD_FONTS, MASTHEAD_WEIGHTS, RULE_WIDTH } from '../engine/publication.js';
import { snapPhotoMove, snapPhotoResize, alignedGuides } from './photosnap.js';
import { serializePublication } from './serialize.js';
import { ICON } from './icons.js';

const PX_PER_MM = 96 / 25.4;
const mm = (v) => `${+v.toFixed(3)}mm`;
const r2 = (v) => Math.round(v * 100) / 100;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const div = (cls) => Object.assign(document.createElement('div'), { className: cls });
const SNAP_PX = 8;     // 吸い付く距離(画面の px)
const NUDGE = 0.5;     // 矢印キーで動かす量(mm)。Shift で 4 倍
const ALIGNS = [['start', '先頭'], ['center', '中央'], ['end', '末尾'], ['justify', '均等割り付け']];
const WEIGHT_NAMES = { 400: '標準', 600: 'やや太い', 700: '太い' };
const HINT = 'ドラッグで動かす(枠の端・中心と、ほかの部品の端・中心に吸い付く)。取っ手で大きさを変える(画像は縦横比を保つ)。矢印キーで少しずつ動かす(Shift で大きく)。Delete で消す。Ctrl+Z / Ctrl+Y で元に戻す / やり直す。Esc で選ぶのをやめる。';
const KIND = { image: '画像', text: '文字', rule: '線' };

// 部品の枠(線は太さの分の枠)
export function frameOf(it) {
  if (it.type !== 'rule') return { x: it.x, y: it.y, w: it.w, h: it.h };
  return (it.h ?? 0) > 0 ? { x: it.x, y: it.y, w: RULE_WIDTH, h: it.h } : { x: it.x, y: it.y, w: it.w, h: RULE_WIDTH };
}

function withFrame(it, f) {
  if (it.type !== 'rule') return { ...it, x: f.x, y: f.y, w: f.w, h: f.h };
  return (it.h ?? 0) > 0 ? { ...it, x: f.x, y: f.y, h: f.h } : { ...it, x: f.x, y: f.y, w: f.w };
}

const vertical = (it) => it.type === 'rule' && (it.h ?? 0) > 0;

// 取っ手で辺を動かす(縦横比は保たない)。動く辺は、範囲の端とほかの部品の端に吸い付く
export function resizeFree(orig, handle, p, others, area, tol, min = 2) {
  const lines = (pos, size) => [area[pos], area[pos] + area[size], ...others.flatMap((o) => [o[pos], o[pos] + o[size]])];
  const snap = (v, list) => list.reduce((best, u) => (Math.abs(u - v) <= tol && Math.abs(u - v) < Math.abs(best - v) ? u : best), v);
  const lx = lines('x', 'w');
  const ly = lines('y', 'h');
  let x1 = orig.x;
  let y1 = orig.y;
  let x2 = orig.x + orig.w;
  let y2 = orig.y + orig.h;
  if (handle.includes('w')) x1 = Math.max(area.x, Math.min(snap(p.x, lx), x2 - min));
  if (handle.includes('e')) x2 = Math.min(area.x + area.w, Math.max(snap(p.x, lx), x1 + min));
  if (handle.includes('n')) y1 = Math.max(area.y, Math.min(snap(p.y, ly), y2 - min));
  if (handle.includes('s')) y2 = Math.min(area.y + area.h, Math.max(snap(p.y, ly), y1 + min));
  return { x: r2(x1), y: r2(y1), w: r2(x2 - x1), h: r2(y2 - y1) };
}

export class MastheadEditor {
  constructor(ed) {
    this.ed = ed;
    this.root = document.getElementById('masthead-editor');
    this.draft = null;       // 編集中の紙名の設定
    this.sel = null;         // 選んでいる部品の番号
    this.history = [];
    this.future = [];
    this.session = false;    // 入力欄で書いている間(1回の操作にまとめる)
    this.saved = '';         // 開いたときの中身(変えたかどうかを見る)
    this.zoom = 1;
    this.seq = 0;
    this.sizes = new Map();  // 画像のパス → 元の大きさ { w, h }(px)
    this.view = null;
    this.drag = null;
    this.problems = [];      // 保存しようとしたときの検査の結果
    this.root.innerHTML = `
      <div class="me-box" role="dialog" aria-modal="true" aria-label="紙名と題字の設定">
        <div class="me-bar">
          <strong class="me-title">紙名と題字の設定</strong>
          <span class="hint">すべての号で共通です</span>
          <span class="tsep"></span>
          <span class="tlabel">足す</span>
          <button type="button" data-me="add-image" title="画像を取り込んで題字に置く(紙名の設定のフォルダの brand/ に入る)">${ICON.photo}<span>画像…</span></button>
          <button type="button" data-me="add-text" title="文字を置く">${ICON.text}<span>文字</span></button>
          <button type="button" data-me="add-hrule" title="横線を置く">横線</button>
          <button type="button" data-me="add-vrule" title="縦線を置く">縦線</button>
          <span class="tsep"></span>
          <button type="button" data-me="back" data-need-sel title="ほかの部品の下にする">奥へ</button>
          <button type="button" data-me="front" data-need-sel title="ほかの部品の上にする">手前へ</button>
          <button type="button" data-me="remove" class="danger" data-need-sel>消す</button>
          <span class="tsep"></span>
          <button type="button" data-me="zoom" aria-pressed="false">2倍で見る</button>
          <span class="grow"></span>
          <button type="button" data-me="cancel">やめる</button>
          <button type="button" data-me="save" class="primary">保存する</button>
        </div>
        <div class="me-main">
          <div class="me-body"></div>
          <aside class="me-side" aria-label="設定"></aside>
        </div>
        <p class="me-hint">${HINT}</p>
        <input type="file" class="me-file" accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,.svg" hidden>
      </div>`;
    this.body = this.root.querySelector('.me-body');
    this.side = this.root.querySelector('.me-side');
    this.fileInput = this.root.querySelector('.me-file');
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.root.addEventListener('input', (e) => this.onInput(e));
    this.root.addEventListener('change', (e) => this.onChange(e));
    this.root.addEventListener('focusout', () => { this.session = false; });
    this.fileInput.addEventListener('change', () => {
      const files = [...this.fileInput.files];
      this.fileInput.value = '';
      this.addImages(files, this.pendingReplace);
      this.pendingReplace = null;
    });
    window.addEventListener('resize', () => { if (this.isOpen) this.renderCanvas(); });
  }

  get isOpen() {
    return this.draft != null;
  }

  get dirty() {
    return this.isOpen && JSON.stringify(this.draft) !== this.saved;
  }

  // ---- 開く・閉じる・保存 ----

  async open() {
    this.draft = structuredClone(this.ed.publication);
    this.saved = JSON.stringify(this.draft);
    this.sel = null;
    this.history = [];
    this.future = [];
    this.problems = [];
    this.root.hidden = false;
    await this.ensureSizes();
    this.render();
  }

  close(force = false) {
    if (!this.isOpen) return;
    if (!force && this.dirty && !confirm('保存していない変更を捨てて閉じますか?')) return;
    this.draft = null;
    this.drag?.stop?.();
    this.drag = null;
    this.root.hidden = true;
    this.body.replaceChildren();
  }

  async save() {
    const v = validatePublication(this.draft, SPEC);
    this.problems = [...v.errors.map((x) => ({ ...x, level: 'e' })), ...v.warnings.map((x) => ({ ...x, level: 'w' }))];
    if (v.errors.length) {
      this.sel = null;
      this.renderSide();
      this.ed.toast('紙名の設定に直すところがあります(右の欄)。', { bad: true });
      return;
    }
    try {
      await this.ed.savePublication(serializePublication(this.draft));
    } catch (e) {
      this.ed.toast(`保存できませんでした: ${e.message}`, { bad: true });
      return;
    }
    this.saved = JSON.stringify(this.draft);
    this.close(true);
    this.ed.toast(v.warnings.length ? `紙名と題字の設定を保存しました(注意 ${v.warnings.length}件: ${v.warnings[0].message})。` : '紙名と題字の設定を保存しました。');
  }

  // ---- 編集の記録 ----

  checkpoint() {
    this.history.push(structuredClone(this.draft));
    if (this.history.length > 100) this.history.shift();
    this.future = [];
  }

  beginSession() {
    if (this.session) return;
    this.checkpoint();
    this.session = true;
  }

  undo() {
    if (!this.history.length) return;
    this.future.push(structuredClone(this.draft));
    this.draft = this.history.pop();
    this.afterRestore();
  }

  redo() {
    if (!this.future.length) return;
    this.history.push(structuredClone(this.draft));
    this.draft = this.future.pop();
    this.afterRestore();
  }

  afterRestore() {
    this.session = false;
    if (this.sel != null && this.sel >= this.draft.masthead.items.length) this.sel = null;
    this.render();
  }

  get items() {
    return this.draft.masthead.items;
  }

  inner() {
    return mastheadInner(SPEC, this.draft.masthead.frame);
  }

  // ---- 描く ----

  render() {
    this.renderCanvas();
    this.renderSide();
  }

  async ensureSizes() {
    await Promise.all(this.items.filter((it) => it.type === 'image' && !this.sizes.has(it.src)).map(async (it) => {
      const im = new Image();
      im.src = this.ed.api.wsUrl(it.src);
      try {
        await im.decode();
        this.sizes.set(it.src, { w: im.naturalWidth, h: im.naturalHeight });
      } catch {
        // 読めない画像は題字に仮の枠が出る
      }
    }));
  }

  async renderCanvas() {
    if (!this.isOpen) return;
    const seq = ++this.seq;
    const frame = this.draft.masthead.frame;
    const inner = this.inner();
    const b = frame ? RULE_WIDTH : 0;
    const W = SPEC.masthead.width;
    const H = inner.h + 2 * b;
    const ctx = { pubUrl: (p) => this.ed.api.wsUrl(p), warnings: [] };
    const parts = await Promise.all(this.items.map((it) => mastheadPart(it, ctx)));
    if (seq !== this.seq || !this.isOpen) return;
    const avail = this.body.getBoundingClientRect();
    const fit = Math.min((avail.height - 48) / (H * PX_PER_MM), (avail.width - 48) / (W * PX_PER_MM));
    const k = Math.max(0.5, fit) * this.zoom;
    const view = div('me-view');
    Object.assign(view.style, { width: `${W * PX_PER_MM * k}px`, height: `${H * PX_PER_MM * k}px` });
    const scaled = div('me-scaled');
    Object.assign(scaled.style, { width: mm(W), height: mm(H), transform: `scale(${k})` });
    scaled.style.setProperty('--px', mm(1 / (PX_PER_MM * k)));
    const mast = div(`masthead me-mast${frame ? '' : ' noframe'}`);
    Object.assign(mast.style, { width: mm(W), height: mm(H) });
    parts.forEach((el, n) => {
      el.dataset.mh = String(n);
      mast.appendChild(el);
    });
    const overlay = div('me-overlay');
    Object.assign(overlay.style, { left: mm(b), top: mm(b), width: mm(inner.w), height: mm(inner.h) });
    scaled.append(mast, overlay);
    view.appendChild(scaled);
    this.view = { k, inner, scaled, overlay, mast, ctx };
    this.body.replaceChildren(view);
    this.drawOverlay();
    if (!this.items.length) {
      const empty = document.createElement('p');
      empty.className = 'pe-empty';
      empty.textContent = '「画像を足す」「文字を足す」で、題字を作ってください。';
      this.body.appendChild(empty);
    }
  }

  // 部品を選ぶための当たり・選んだ部品の枠と取っ手
  drawOverlay(guides = []) {
    const o = this.view?.overlay;
    if (!o) return;
    const hits = this.items.map((it, n) => {
      const f = frameOf(it);
      const pad = it.type === 'rule' ? 0.8 : 0;   // 線は細いので、つかみやすく当たりを広げる
      return `<div class="me-hit${n === this.sel ? ' on' : ''}" data-n="${n}" title="${KIND[it.type]}" style="left:${mm(f.x - pad)};top:${mm(f.y - pad)};width:${mm(f.w + 2 * pad)};height:${mm(f.h + 2 * pad)}"></div>`;
    }).join('');
    let sel = '';
    if (this.sel != null && this.items[this.sel]) {
      const it = this.items[this.sel];
      const f = frameOf(it);
      const handles = it.type === 'image' ? ['nw', 'ne', 'sw', 'se'] : it.type === 'text' ? ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] : vertical(it) ? ['n', 's'] : ['w', 'e'];
      sel = `<div class="me-sel" style="left:${mm(f.x)};top:${mm(f.y)};width:${mm(f.w)};height:${mm(f.h)}">${handles.map((h) => `<span class="pe-h me-h" data-h="${h}"></span>`).join('')}</div>`;
    }
    const lines = guides.map((g) => (g.axis === 'x'
      ? `<div class="pe-guide x" style="left:${mm(g.at)};top:0;height:100%"></div>`
      : `<div class="pe-guide y" style="top:${mm(g.at)};left:0;width:100%"></div>`)).join('');
    o.innerHTML = hits + sel + lines;
  }

  // ドラッグ中: 動かしている部品だけを置き直す
  async placePart(n) {
    const it = this.items[n];
    const old = this.view?.mast.querySelector(`[data-mh="${n}"]`);
    if (!old) return;
    if (it.type === 'image' && Array.isArray(it.crop)) {
      const el = await mastheadPart(it, this.view.ctx);
      el.dataset.mh = String(n);
      if (old.isConnected) old.replaceWith(el);
      return;
    }
    const f = frameOf(it);
    Object.assign(old.style, { left: mm(f.x), top: mm(f.y), width: mm(f.w), height: mm(f.h) });
  }

  renderSide() {
    if (!this.isOpen) return;
    for (const btn of this.root.querySelectorAll('[data-need-sel]')) btn.disabled = this.sel == null;
    const it = this.sel != null ? this.items[this.sel] : null;
    const inner = this.inner();
    const num = (key, label, value, step = 0.1) => `<label>${label}<input type="number" step="${step}" data-me-geo="${key}" value="${r2(value)}"></label>`;
    const geo = (x) => {
      const f = frameOf(x);
      const fields = x.type === 'rule'
        ? [num('x', '左', f.x), num('y', '上', f.y), vertical(x) ? num('h', '長さ', f.h) : num('w', '長さ', f.w)]
        : [num('x', '左', f.x), num('y', '上', f.y), num('w', '幅', f.w), num('h', '高さ', f.h)];
      return `<h3>位置と大きさ(mm)</h3><div class="me-grid">${fields.join('')}</div>`;
    };
    if (!it) {
      const d = this.draft;
      const problems = this.problems.length ? `<div class="me-problems">${this.problems.map((p) => `<p class="${p.level === 'e' ? 'err-text' : 'warn-text'}"><code>${esc(p.code)}</code> ${esc(p.message)}</p>`).join('')}</div>` : '';
      this.side.innerHTML = `
        ${problems}
        <h3>紙名の設定</h3>
        <label class="field">紙名(柱・画面・PDF の題)<input type="text" data-me-pub="name" value="${esc(d.name)}"></label>
        <label class="field">PDF のファイル名の頭(半角の英数字と - _)<input type="text" data-me-pub="fileName" value="${esc(d.fileName)}" placeholder="例: kaiho"></label>
        <p class="hint">例: ${esc(d.fileName || 'kikanshi')}-051.pdf</p>
        <label class="field">刷る前に確認していただく人<input type="text" data-me-pub="approver" value="${esc(d.approver)}" placeholder="例: 会長"></label>
        <label class="check"><input type="checkbox" data-me-pub="frame" ${d.masthead.frame ? 'checked' : ''}> 題字のまわりの罫</label>
        <h3>題字の部品</h3>
        ${this.items.length ? `<ol class="me-parts">${this.items.map((x, n) => `<li><button type="button" data-me-pick="${n}">${KIND[x.type]}<span class="hint">${esc(x.type === 'image' ? x.src : x.type === 'text' ? x.text.replace(/\n/g, ' / ') : vertical(x) ? '縦' : '横')}</span></button></li>`).join('')}</ol>` : '<p class="hint">まだありません。</p>'}
        <p class="hint">題字の枠の内側は 幅 ${inner.w.toFixed(1)}mm × 高さ ${inner.h.toFixed(1)}mm です。位置は内側の左上からの mm です。</p>`;
      return;
    }
    if (it.type === 'text') {
      const opt = (list, cur) => list.map(([v, label]) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`).join('');
      this.side.innerHTML = `
        <h3>文字</h3>
        <textarea data-me-prop="text" rows="4" spellcheck="false" aria-label="文字">${esc(it.text)}</textarea>
        <p class="hint">改行で行を分けます。均等割り付けは行ごとに枠の幅いっぱいに広げます。</p>
        <div class="me-grid">
          <label>書体<select data-me-prop="font">${opt(Object.entries(MASTHEAD_FONTS).map(([k, f]) => [k, f.label]), it.font ?? 'mincho')}</select></label>
          <label>大きさ(pt)<input type="number" step="0.5" min="4" max="160" data-me-prop="size" value="${it.size ?? 10.5}"></label>
          <label>太さ<select data-me-prop="weight">${opt(MASTHEAD_WEIGHTS.map((w) => [w, WEIGHT_NAMES[w]]), it.weight ?? 400)}</select></label>
          <label>向き<select data-me-prop="dir">${opt([['horizontal', '横書き'], ['vertical', '縦書き']], it.dir ?? 'horizontal')}</select></label>
          <label>そろえ方<select data-me-prop="align">${opt(ALIGNS, it.align ?? 'start')}</select></label>
          <label>行の間隔<input type="number" step="0.05" min="0.8" max="3" data-me-prop="lineHeight" value="${it.lineHeight ?? 1.4}"></label>
        </div>
        ${geo(it)}`;
      return;
    }
    if (it.type === 'image') {
      const px = this.sizes.get(it.src);
      this.side.innerHTML = `
        <h3>画像</h3>
        <p><code>${esc(it.src)}</code>${px ? `<br><span class="hint">${px.w}×${px.h}px</span>` : ''}</p>
        <div class="actions">
          <button type="button" data-me="replace">画像を差し替える…</button>
          <button type="button" data-me="aspect" ${px ? '' : 'disabled'} title="幅はそのまま、高さを画像の縦横比に合わせる">元の縦横比に戻す</button>
        </div>
        ${geo(it)}`;
      return;
    }
    this.side.innerHTML = `<h3>${vertical(it) ? '縦線' : '横線'}</h3><p class="hint">太さは ${RULE_WIDTH}mm(まわりの罫と同じ)です。</p>${geo(it)}`;
  }

  // ドラッグ中などに、右の欄の数だけを差し替える
  refreshNumbers() {
    const it = this.sel != null ? this.items[this.sel] : null;
    if (!it) return;
    const f = frameOf(it);
    for (const input of this.side.querySelectorAll('[data-me-geo]')) {
      if (document.activeElement !== input) input.value = r2(f[input.dataset.meGeo]);
    }
  }

  // ---- 操作 ----

  select(n) {
    this.sel = n;
    this.session = false;
    this.drawOverlay();
    this.renderSide();
  }

  setItem(n, it) {
    this.draft.masthead.items[n] = it;
  }

  // 新しい部品は、いまある部品のいちばん下の続き(入らなければ上のほう)に置く
  freeY(h) {
    const inner = this.inner();
    const bottom = Math.max(0, ...this.items.map((x) => { const f = frameOf(x); return f.y + f.h; }));
    return r2(bottom + 2 + h <= inner.h ? bottom + 2 : Math.max(0, Math.min(10, inner.h - h)));
  }

  add(it) {
    this.checkpoint();
    this.items.push(it);
    this.sel = this.items.length - 1;
    this.render();
  }

  async addImages(files, replace = null) {
    const inner = this.inner();
    for (const f of files) {
      let src;
      try {
        src = await this.ed.api.uploadBrand(f);
      } catch (e) {
        this.ed.toast(`${f.name}: ${e.message}`, { bad: true });
        continue;
      }
      if (!this.isOpen) return;
      await this.ensureSizes();
      const im = new Image();
      im.src = this.ed.api.wsUrl(src);
      try {
        await im.decode();
        this.sizes.set(src, { w: im.naturalWidth || 1, h: im.naturalHeight || 1 });
      } catch {
        this.sizes.set(src, { w: 1, h: 1 });
      }
      const px = this.sizes.get(src);
      if (replace != null && this.items[replace]?.type === 'image') {
        const old = this.items[replace];
        this.checkpoint();
        const { crop, ...rest } = old;
        void crop;
        this.setItem(replace, { ...rest, src, h: r2(old.w * (px.h / px.w)) });
        this.render();
        continue;
      }
      // 幅 24mm(入らなければ枠いっぱい)で、縦横比のまま左右の中央に置く
      const aspect = px.w / px.h;
      let w = Math.min(inner.w - 4, 24);
      let h = w / aspect;
      if (h > inner.h - 4) {
        h = inner.h - 4;
        w = h * aspect;
      }
      this.add({ type: 'image', src, x: r2((inner.w - w) / 2), y: this.freeY(h), w: r2(w), h: r2(h) });
    }
  }

  onClick(e) {
    const pick = e.target.closest('[data-me-pick]');
    if (pick) {
      this.select(Number(pick.dataset.mePick));
      return;
    }
    const b = e.target.closest('[data-me]');
    if (!b || b.disabled) return;
    const act = b.dataset.me;
    const inner = this.inner();
    if (act === 'cancel') this.close();
    else if (act === 'save') this.save();
    else if (act === 'add-image') this.fileInput.click();
    else if (act === 'replace') {
      this.pendingReplace = this.sel;
      this.fileInput.click();
    } else if (act === 'add-text') {
      this.add({ type: 'text', text: '文字', font: 'mincho', weight: 400, size: 12, dir: 'horizontal', align: 'center', lineHeight: 1.4, x: 3, y: this.freeY(8), w: r2(inner.w - 6), h: 8 });
    } else if (act === 'add-hrule') this.add({ type: 'rule', x: 0, y: this.freeY(RULE_WIDTH), w: r2(inner.w) });
    else if (act === 'add-vrule') this.add({ type: 'rule', x: r2(inner.w / 2), y: this.freeY(30), h: 30 });
    else if (act === 'remove') this.removeSelected();
    else if (act === 'front' || act === 'back') this.restack(act === 'front' ? 1 : -1);
    else if (act === 'aspect') {
      const it = this.items[this.sel];
      const px = this.sizes.get(it.src);
      if (!px) return;
      this.checkpoint();
      const { crop, ...rest } = it;
      void crop;
      this.setItem(this.sel, { ...rest, h: r2(Math.min(inner.h - it.y, it.w * (px.h / px.w))) });
      this.render();
    } else if (act === 'zoom') {
      this.zoom = this.zoom === 1 ? 2 : 1;
      b.setAttribute('aria-pressed', String(this.zoom !== 1));
      b.textContent = this.zoom === 1 ? '2倍で見る' : '全体を見る';
      this.renderCanvas();
    }
  }

  removeSelected() {
    if (this.sel == null) return;
    this.checkpoint();
    this.items.splice(this.sel, 1);
    this.sel = null;
    this.render();
  }

  restack(dir) {
    const n = this.sel;
    const m = n + dir;
    if (n == null || m < 0 || m >= this.items.length) return;
    this.checkpoint();
    [this.items[n], this.items[m]] = [this.items[m], this.items[n]];
    this.sel = m;
    this.render();
  }

  onInput(e) {
    const t = e.target;
    if (t.dataset.mePub && t.type !== 'checkbox') {
      this.beginSession();
      this.draft[t.dataset.mePub] = t.value;
      if (t.dataset.mePub === 'fileName') this.side.querySelector('.field + .hint').textContent = `例: ${t.value || 'kikanshi'}-051.pdf`;
      return;
    }
    if (this.sel == null) return;
    const it = this.items[this.sel];
    if (t.dataset.meProp === 'text') {
      this.beginSession();
      this.setItem(this.sel, { ...it, text: t.value });
      this.renderCanvas();
    } else if (t.dataset.meGeo || (t.dataset.meProp && t.type === 'number')) {
      const v = Number(t.value);
      if (!Number.isFinite(v) || t.value === '') return;
      this.beginSession();
      if (t.dataset.meGeo) this.setItem(this.sel, withFrame(it, { ...frameOf(it), [t.dataset.meGeo]: v }));
      else this.setItem(this.sel, { ...it, [t.dataset.meProp]: v });
      this.renderCanvas();
    }
  }

  onChange(e) {
    const t = e.target;
    if (t.dataset.mePub === 'frame') {
      this.checkpoint();
      this.draft.masthead.frame = t.checked;
      this.renderCanvas();
      return;
    }
    if (this.sel == null || t.tagName !== 'SELECT' || !t.dataset.meProp) return;
    this.checkpoint();
    const value = t.dataset.meProp === 'weight' ? Number(t.value) : t.value;
    this.setItem(this.sel, { ...this.items[this.sel], [t.dataset.meProp]: value });
    this.renderCanvas();
  }

  // ---- ドラッグ ----

  pointer(e) {
    const r = this.view.overlay.getBoundingClientRect();
    const k = PX_PER_MM * this.view.k;
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  }

  onPointerDown(e) {
    if (e.button !== 0 || !this.view) return;
    if (this.drag) {
      this.drag.stop();
      this.drag = null;
    }
    const handle = e.target.closest('.me-h');
    const hit = e.target.closest('.me-hit');
    if (!handle && !hit) {
      if (e.target.closest('.me-body')) this.select(null);
      return;
    }
    e.preventDefault();
    const n = handle ? this.sel : Number(hit.dataset.n);
    if (n !== this.sel) this.select(n);
    const it = this.items[n];
    const d = { n, mode: handle ? 'resize' : 'move', handle: handle?.dataset.h, p0: this.pointer(e), orig: frameOf(it), before: structuredClone(this.draft), moved: false };
    const move = (ev) => this.onDragMove(ev);
    const up = () => {
      d.stop();
      this.onDragEnd();
    };
    d.stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    this.drag = d;
  }

  onDragMove(e) {
    const d = this.drag;
    if (!d || !this.view) return;
    const p = this.pointer(e);
    const dx = p.x - d.p0.x;
    const dy = p.y - d.p0.y;
    if (!d.moved && Math.hypot(dx, dy) * PX_PER_MM * this.view.k < 3) return;
    d.moved = true;
    const it = this.items[d.n];
    const others = this.items.filter((_, i) => i !== d.n).map(frameOf);
    const inner = this.view.inner;
    const area = { x: 0, y: 0, w: inner.w, h: inner.h };
    const tol = SNAP_PX / (PX_PER_MM * this.view.k);
    let f;
    let guides;
    if (d.mode === 'move') ({ frame: f, guides } = snapPhotoMove({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy }, others, area, 0, tol));
    else if (it.type === 'image') ({ frame: f, guides } = snapPhotoResize(d.orig, d.handle, p, d.orig.w / d.orig.h, others, area, 0, tol, 2));
    else {
      f = resizeFree(d.orig, d.handle, p, others, area, tol, it.type === 'rule' ? 1 : 2);
      guides = alignedGuides(f, others, area, 0);
    }
    // 吸着の計算で丸めただけの差(動かしていない向き)は、元の値のままにする
    for (const k of ['x', 'y', 'w', 'h']) if (Math.abs(f[k] - d.orig[k]) < 0.006) f[k] = d.orig[k];
    this.setItem(d.n, withFrame(it, f));
    this.placePart(d.n);
    this.drawOverlay(guides);
    this.refreshNumbers();
  }

  onDragEnd() {
    const d = this.drag;
    this.drag = null;
    if (!d?.moved) {
      this.drawOverlay();
      return;
    }
    this.history.push(d.before);
    this.future = [];
    this.render();
  }

  // ---- キー(エディタのキー操作の代わりに受ける) ----

  onKey(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const typing = e.target.closest?.('input, textarea, select');
    if (ctrl && key === 's') {
      e.preventDefault();
      this.save();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (typing) e.target.blur();
      else if (this.sel != null) this.select(null);
      else this.close();
      return;
    }
    if (typing) return;
    if (ctrl && (key === 'z' || key === 'y')) {
      e.preventDefault();
      if (key === 'y' || e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (this.sel == null) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.removeSelected();
      return;
    }
    const step = e.shiftKey ? NUDGE * 4 : NUDGE;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!delta) return;
    e.preventDefault();
    const it = this.items[this.sel];
    const f = frameOf(it);
    const inner = this.inner();
    const x = r2(Math.min(Math.max(0, f.x + delta[0]), inner.w - f.w));
    const y = r2(Math.min(Math.max(0, f.y + delta[1]), inner.h - f.h));
    if (x === f.x && y === f.y) return;
    this.checkpoint();
    this.setItem(this.sel, withFrame(it, { ...f, x, y }));
    this.placePart(this.sel);
    this.drawOverlay();
    this.refreshNumbers();
  }
}
