// パネル編集画面(docs/04-editor.md)。紙面の写真パネルをダブルクリックすると開く。
// 写真は「枠 + 切り抜き」で扱う(editor/photos.js)。rows のパネルは、最初に何か変えたときに見え方を変えずに変換する。
// 変更は1操作ごとに ed.apply を通すので、元に戻す・やり直すは紙面と共通。開いている間も、紙面は裏で組み直る。

import { SPEC } from '../engine/spec.js';
import { photoArea, cropPlacement } from '../engine/gallery.js';
import { renderPanel } from '../engine/render.js';
import {
  materializePanel, arrangePanel, withNewPhoto, updatePhoto, removePhotoAt, restack,
  CROP_RATIOS, cropToRatio, moveCrop, resizeCrop, reframeCrop,
} from './photos.js';
import { snapPhotoMove, snapPhotoResize } from './photosnap.js';
import * as M from './model.js';

const PX_PER_MM = 96 / 25.4;
const mm = (v) => `${+v.toFixed(3)}mm`;
const pct = (v) => `${+(v * 100).toFixed(4)}%`;
const CORNERS = ['nw', 'ne', 'sw', 'se'];
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const SNAP_PX = 8;       // 吸い付く距離(画面の px)
const NUDGE = 0.5;       // 矢印キーで動かす量(mm)。Shift で 4 倍
const HINT = 'ドラッグで動かす(パネルの端と中心・ほかの写真の端と中心・写真どうしの間隔に吸い付く)。角の取っ手で大きさを変える(縦横比はそのまま)。写真をダブルクリックすると切り抜き。Delete で外す、矢印キーで少しずつ動かす(Shift で大きく)。Ctrl+Z で元に戻す。Esc で閉じる。';
const CROP_HINT = '明るい所が紙面に出る範囲です。枠の中をドラッグして動かし、角と辺の取っ手で大きさを変えます。決定すると、写真の大きさ(縮尺)はそのままで、切り落とした分だけ枠が小さくなります。Enter で決定、Esc でやめる。';

export class PanelEditor {
  constructor(ed) {
    this.ed = ed;
    this.root = document.getElementById('panel-editor');
    this.target = null;   // { page, index }
    this.sel = null;      // 選んでいる写真の番号
    this.crop = null;     // 切り抜き中: { n, crop, ratio }
    this.drag = null;
    this.seq = 0;
    this.root.innerHTML = `
      <div class="pe-box" role="dialog" aria-modal="true" aria-label="写真パネルの編集">
        <div class="pe-bar">
          <strong class="pe-title"></strong>
          <span class="pe-tools">
            <button type="button" data-pe="add">写真を追加…</button>
            <button type="button" data-pe="arrange">自動で並べる</button>
            <span class="sep"></span>
            <button type="button" data-pe="front" data-need-sel>手前へ</button>
            <button type="button" data-pe="back" data-need-sel>奥へ</button>
            <button type="button" data-pe="crop" data-need-sel>切り抜き</button>
            <button type="button" data-pe="remove" class="danger" data-need-sel>外す</button>
          </span>
          <span class="pe-croptools" hidden>
            <label>比率 <select data-pe-ratio>${CROP_RATIOS.map(([v, label]) => `<option value="${v}">${label}</option>`).join('')}</select></label>
            <button type="button" data-pe="crop-full">全体に戻す</button>
            <button type="button" data-pe="crop-cancel">やめる</button>
            <button type="button" data-pe="crop-ok" class="primary">決定</button>
          </span>
          <span class="grow"></span>
          <button type="button" data-pe="close" class="primary">閉じる</button>
        </div>
        <div class="pe-body"></div>
        <div class="pe-foot">
          <div class="pe-fields">
            <label>上の見出し <input type="text" data-pe-prop="title" placeholder="なし"></label>
            <label>キャプション <input type="text" data-pe-prop="caption" placeholder="なし"></label>
          </div>
          <p class="pe-hint"></p>
        </div>
        <input type="file" class="pe-file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden>
      </div>`;
    this.body = this.root.querySelector('.pe-body');
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.root.addEventListener('dblclick', (e) => this.onDblClick(e));
    this.root.addEventListener('input', (e) => {
      const prop = e.target.dataset.peProp;
      if (prop) this.ed.setPanelText(this.target.page, this.target.index, prop, e.target.value);
    });
    this.root.addEventListener('focusout', (e) => { if (e.target.dataset.peProp) this.ed.endTextSession(); });
    this.root.addEventListener('change', (e) => {
      if (e.target.matches('[data-pe-ratio]')) this.setRatio(e.target.value);
      else if (e.target.matches('.pe-file')) {
        this.addFiles([...e.target.files]);
        e.target.value = '';
      }
    });
    this.root.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    this.root.addEventListener('drop', (e) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      this.addFiles([...e.dataTransfer.files]);
    });
    window.addEventListener('resize', () => { if (this.isOpen) this.renderView(); });
  }

  get isOpen() {
    return this.target != null;
  }

  // ---- 開く・閉じる ----

  async open(page, index) {
    const raw = this.ed.issue.pages[page]?.items?.[index];
    if (raw?.type !== 'panel' || raw.table) return;
    await this.ed.ensureSizes(M.photoSources(raw));
    this.target = { page, index };
    this.sel = null;
    this.crop = null;
    this.ed.select({ kind: 'item', page, index });
    this.root.hidden = false;
    this.root.querySelector('.pe-title').textContent = `写真パネルの編集(${page + 1}面)`;
    this.syncFields(true);
    await this.renderView();
  }

  close() {
    if (!this.isOpen) return;
    this.ed.endTextSession();
    this.target = null;
    this.drag = null;
    this.crop = null;
    this.root.hidden = true;
    this.body.replaceChildren();
    this.ed.inspector.update(true);
    this.ed.decorate();
  }

  // 紙面が組み直ったとき(元に戻した後なども)に、いまの設定で描き直す
  refresh() {
    if (!this.isOpen || this.drag) return;
    const raw = this.ed.issue.pages[this.target.page]?.items?.[this.target.index];
    if (raw?.type !== 'panel' || raw.table) {
      this.close();
      return;
    }
    const n = this.item().photos.length;
    if (this.sel != null && this.sel >= n) this.sel = null;
    if (this.crop && this.crop.n >= n) this.crop = null;
    this.syncFields(false);
    this.renderView();
  }

  // ---- いまのパネル ----

  // 編集の対象(rows のパネルは「枠 + 切り抜き」に直した形。見え方は同じ)
  item() {
    const { page, index } = this.target;
    const raw = this.ed.issue.pages[page].items[index];
    if (!this.ed.needsMaterialize(raw)) return raw;
    const { w, h } = this.ed.panelSize(page, index);
    return materializePanel(SPEC, raw, w, h, this.ed.sizes);
  }

  size() {
    return this.ed.panelSize(this.target.page, this.target.index);
  }

  area(item = this.item()) {
    const { w, h } = this.size();
    return photoArea(SPEC, item, w, h);
  }

  commit(item) {
    const { page, index } = this.target;
    return this.ed.apply((issue) => M.replaceItem(issue, page, index, item));
  }

  syncFields(force) {
    const raw = this.ed.issue.pages[this.target.page].items[this.target.index];
    for (const input of this.root.querySelectorAll('[data-pe-prop]')) {
      if (force || document.activeElement !== input) input.value = raw[input.dataset.peProp] ?? '';
    }
  }

  // ---- 描く ----

  async renderView() {
    const seq = ++this.seq;
    const item = this.item();
    const { w: W, h: H } = this.size();
    const cropping = !!this.crop;
    this.root.querySelector('.pe-tools').hidden = cropping;
    this.root.querySelector('.pe-croptools').hidden = !cropping;
    this.root.querySelector('.pe-hint').textContent = cropping ? CROP_HINT : HINT;
    for (const b of this.root.querySelectorAll('[data-need-sel]')) b.disabled = this.sel == null;
    this.root.querySelector('[data-pe="arrange"]').disabled = !item.photos.length;
    const avail = this.body.getBoundingClientRect();
    if (cropping) {
      this.body.replaceChildren(this.cropView(item, avail));
      return;
    }
    const { el } = await renderPanel({ item, width: W, height: H, assetUrl: this.ed.api.url });
    if (seq !== this.seq) return;
    const k = Math.min((avail.width - 48) / (W * PX_PER_MM), (avail.height - 48) / (H * PX_PER_MM), 4);
    const view = document.createElement('div');
    view.className = 'pe-view';
    Object.assign(view.style, { width: `${W * PX_PER_MM * k}px`, height: `${H * PX_PER_MM * k}px` });
    const scaled = document.createElement('div');
    scaled.className = 'pe-scaled';
    Object.assign(scaled.style, { width: mm(W), height: mm(H), transform: `scale(${k})` });
    scaled.style.setProperty('--px', mm(1 / (PX_PER_MM * k)));
    const overlay = document.createElement('div');
    overlay.className = 'pe-overlay';
    const a = this.area(item);
    overlay.innerHTML = `<div class="pe-area" style="left:${mm(a.x)};top:${mm(a.y)};width:${mm(a.w)};height:${mm(a.h)}"></div>`
      + item.photos.map((ph, n) => `<div class="pe-photo" data-n="${n}" style="left:${mm(ph.x)};top:${mm(ph.y)};width:${mm(ph.w)};height:${mm(ph.h)}"></div>`).join('')
      + (this.sel == null ? '' : this.selBoxHtml(item.photos[this.sel]));
    scaled.append(el, overlay);
    view.appendChild(scaled);
    this.view = { scaled, panel: el, overlay, k, W, H };
    this.body.replaceChildren(view);
    if (!item.photos.length) {
      const empty = document.createElement('p');
      empty.className = 'pe-empty';
      empty.textContent = '写真をここへドラッグするか、「写真を追加…」で選んでください。';
      this.body.appendChild(empty);
    }
  }

  selBoxHtml(ph) {
    return `<div class="pe-sel" style="left:${mm(ph.x)};top:${mm(ph.y)};width:${mm(ph.w)};height:${mm(ph.h)}">${CORNERS.map((c) => `<span class="pe-h" data-corner="${c}"></span>`).join('')}</div>`;
  }

  cropView(item, avail) {
    const ph = item.photos[this.crop.n];
    const size = this.ed.sizes.get(ph.src) ?? { w: 4, h: 3 };
    const k = Math.min((avail.width - 64) / size.w, (avail.height - 64) / size.h);
    const wrap = document.createElement('div');
    wrap.className = 'pe-cropview';
    Object.assign(wrap.style, { width: `${size.w * k}px`, height: `${size.h * k}px` });
    const [cx, cy, cw, ch] = this.crop.crop;
    const ratio = CROP_RATIOS.find(([v]) => v === this.crop.ratio)?.[2];
    const handles = HANDLES.filter((h) => !ratio || h.length === 2);
    wrap.innerHTML = `<img src="${this.ed.api.url(ph.src)}" alt="" draggable="false">
      <div class="pe-cropbox" style="left:${pct(cx)};top:${pct(cy)};width:${pct(cw)};height:${pct(ch)}">${handles.map((h) => `<span class="pe-h" data-handle="${h}"></span>`).join('')}</div>`;
    return wrap;
  }

  // ---- ボタン ----

  onClick(e) {
    const b = e.target.closest('[data-pe]');
    if (!b || b.disabled) return;
    const act = b.dataset.pe;
    const item = this.item();
    if (act === 'close') this.close();
    else if (act === 'add') this.root.querySelector('.pe-file').click();
    else if (act === 'arrange') this.commit(arrangePanel(SPEC, item, this.size(), this.ed.sizes));
    else if (act === 'front' || act === 'back') {
      const r = restack(item, this.sel, act === 'front' ? 1 : -1);
      if (r.item !== item) {
        this.sel = r.index;
        this.commit(r.item);
      }
    } else if (act === 'remove') this.removeSelected();
    else if (act === 'crop') this.startCrop(this.sel);
    else if (act === 'crop-full') {
      const ratio = CROP_RATIOS.find(([v]) => v === this.crop.ratio)?.[2];
      const size = this.cropSize();
      this.crop.crop = ratio ? cropToRatio([0, 0, 1, 1], size, ratio) : [0, 0, 1, 1];
      this.renderView();
    } else if (act === 'crop-cancel') this.endCrop(false);
    else if (act === 'crop-ok') this.endCrop(true);
  }

  removeSelected() {
    if (this.sel == null) return;
    const item = removePhotoAt(this.item(), this.sel);
    this.sel = null;
    this.commit(item);
  }

  async addFiles(files) {
    const paths = await this.ed.uploadPhotos(files);
    if (!paths.length || !this.isOpen) return;
    const sizes = await this.ed.ensureSizes(paths);
    let item = this.item();
    for (const src of paths) item = withNewPhoto(SPEC, item, src, sizes.get(src) ?? { w: 4, h: 3 }, this.size());
    this.sel = item.photos.length - 1;
    this.commit(item);
  }

  // ---- 切り抜き ----

  cropSize() {
    return this.ed.sizes.get(this.item().photos[this.crop.n].src) ?? { w: 4, h: 3 };
  }

  startCrop(n) {
    if (n == null) return;
    this.sel = n;
    this.crop = { n, crop: [...(this.item().photos[n].crop ?? [0, 0, 1, 1])], ratio: 'free' };
    this.root.querySelector('[data-pe-ratio]').value = 'free';
    this.renderView();
  }

  setRatio(value) {
    this.crop.ratio = value;
    const ratio = CROP_RATIOS.find(([v]) => v === value)?.[2];
    if (ratio) this.crop.crop = cropToRatio(this.crop.crop, this.cropSize(), ratio);
    this.renderView();
  }

  endCrop(apply) {
    const c = this.crop;
    const size = this.cropSize();
    this.crop = null;
    const item = this.item();
    const ph = item.photos[c.n];
    const same = ph.crop && ph.crop.every((v, k) => Math.abs(v - c.crop[k]) < 1e-4);
    if (!apply || same) {
      this.renderView();
      return;
    }
    this.commit(updatePhoto(item, c.n, { crop: c.crop, ...reframeCrop(ph, ph.crop ?? [0, 0, 1, 1], c.crop, size, this.area(item)) }));
  }

  // ---- ドラッグ ----

  toMm(e) {
    const r = this.view.scaled.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * this.view.W, y: ((e.clientY - r.top) / r.height) * this.view.H };
  }

  onPointerDown(e) {
    if (e.button !== 0 || !this.isOpen) return;
    if (this.crop) {
      const box = e.target.closest('.pe-cropbox');
      if (!box) return;
      e.preventDefault();
      const img = this.body.querySelector('.pe-cropview').getBoundingClientRect();
      this.startDrag(e, { kind: 'crop', handle: e.target.closest('.pe-h')?.dataset.handle ?? null, img, start: [...this.crop.crop], x0: e.clientX, y0: e.clientY });
      return;
    }
    if (!e.target.closest('.pe-view')) return;
    const corner = e.target.closest('.pe-h')?.dataset.corner;
    const photo = e.target.closest('.pe-photo');
    if (!corner && !photo) {
      if (this.sel != null) {
        this.sel = null;
        this.renderView();
      }
      return;
    }
    e.preventDefault();
    const n = corner ? this.sel : Number(photo.dataset.n);
    if (n !== this.sel) {
      this.sel = n;
      this.view.overlay.querySelector('.pe-sel')?.remove();
      this.view.overlay.insertAdjacentHTML('beforeend', this.selBoxHtml(this.item().photos[n]));
      for (const b of this.root.querySelectorAll('[data-need-sel]')) b.disabled = false;
    }
    const item = this.item();
    const ph = item.photos[n];
    this.startDrag(e, {
      kind: corner ? 'resize' : 'move',
      corner,
      n,
      item,
      orig: { x: ph.x, y: ph.y, w: ph.w, h: ph.h },
      p0: this.toMm(e),
      others: item.photos.filter((_, k) => k !== n),
      area: this.area(item),
      tol: SNAP_PX / (PX_PER_MM * this.view.k),
    });
  }

  startDrag(e, d) {
    this.drag?.stop();   // 前のドラッグの「離した」を受け取りそこねていたら捨てる
    const move = (ev) => this.onDragMove(ev);
    const up = () => {
      this.drag?.stop();
      this.onDragEnd();
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    this.drag = { ...d, moved: false, stop };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  onDragMove(e) {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'crop') {
      const p = { x: (e.clientX - d.img.left) / d.img.width, y: (e.clientY - d.img.top) / d.img.height };
      const ratio = CROP_RATIOS.find(([v]) => v === this.crop.ratio)?.[2];
      this.crop.crop = d.handle
        ? resizeCrop(d.start, d.handle, p, ratio, this.cropSize())
        : moveCrop(d.start, (e.clientX - d.x0) / d.img.width, (e.clientY - d.y0) / d.img.height);
      d.moved = true;
      const [cx, cy, cw, ch] = this.crop.crop;
      Object.assign(this.body.querySelector('.pe-cropbox').style, { left: pct(cx), top: pct(cy), width: pct(cw), height: pct(ch) });
      return;
    }
    const p = this.toMm(e);
    if (!d.moved && Math.hypot(p.x - d.p0.x, p.y - d.p0.y) < d.tol / 3) return;
    d.moved = true;
    const ph = d.item.photos[d.n];
    const r = d.kind === 'move'
      ? snapPhotoMove({ ...d.orig, x: d.orig.x + p.x - d.p0.x, y: d.orig.y + p.y - d.p0.y }, d.others, d.area, SPEC.panel.gap, d.tol)
      : snapPhotoResize(d.orig, d.corner, p, d.orig.w / d.orig.h, d.others, d.area, SPEC.panel.gap, d.tol);
    d.frame = r.frame;
    this.showFrame(d.n, ph, r.frame);
    this.showGuides(r.guides);
  }

  // ドラッグ中の見た目: 写真と選択の枠をその場で動かす(確定は指を離したとき)
  showFrame(n, ph, f) {
    const { panel, overlay } = this.view;
    const node = panel.querySelector(`[data-photo="${n}"]`);
    const box = { left: mm(f.x), top: mm(f.y), width: mm(f.w), height: mm(f.h) };
    for (const el of [node, overlay.querySelector(`.pe-photo[data-n="${n}"]`), overlay.querySelector('.pe-sel')]) if (el) Object.assign(el.style, box);
    const im = node?.querySelector('img');
    if (im && ph.crop) {
      const pl = cropPlacement({ w: f.w, h: f.h }, ph.crop, { w: im.naturalWidth, h: im.naturalHeight });
      Object.assign(im.style, { left: mm(pl.left), top: mm(pl.top), width: mm(pl.width), height: mm(pl.height) });
    }
  }

  showGuides(guides) {
    const { overlay, W, H } = this.view;
    overlay.querySelectorAll('.pe-guide').forEach((g) => g.remove());
    for (const g of guides) {
      const el = document.createElement('div');
      el.className = `pe-guide ${g.axis}`;
      Object.assign(el.style, g.axis === 'x' ? { left: mm(g.at), top: '0', height: mm(H) } : { top: mm(g.at), left: '0', width: mm(W) });
      overlay.appendChild(el);
    }
  }

  onDragEnd() {
    const d = this.drag;
    this.drag = null;
    if (!d?.moved || d.kind === 'crop') return;
    this.view.overlay.querySelectorAll('.pe-guide').forEach((g) => g.remove());
    const o = d.orig;
    const f = d.frame;
    if (!f || (f.x === o.x && f.y === o.y && f.w === o.w && f.h === o.h)) return;
    this.commit(updatePhoto(d.item, d.n, f));
  }

  onDblClick(e) {
    if (this.crop) return;
    const photo = e.target.closest('.pe-photo, .pe-sel');
    if (photo) this.startCrop(photo.dataset.n != null ? Number(photo.dataset.n) : this.sel);
  }

  // ---- キー(紙面のキー操作の代わりに受ける) ----

  onKey(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (this.crop) {
      if (e.key === 'Escape') this.endCrop(false);
      else if (e.key === 'Enter') this.endCrop(true);
      else return;
      e.preventDefault();
      return;
    }
    if (ctrl && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.ed.redo();
      else this.ed.undo();
      return;
    }
    if (ctrl && key === 'y') {
      e.preventDefault();
      this.ed.redo();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.sel != null) {
        this.sel = null;
        this.renderView();
      } else this.close();
      return;
    }
    if (this.sel == null) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.removeSelected();
      return;
    }
    const step = NUDGE * (e.shiftKey ? 4 : 1);
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!delta) return;
    e.preventDefault();
    const item = this.item();
    const ph = item.photos[this.sel];
    const a = this.area(item);
    const x = Math.round(Math.min(Math.max(ph.x + delta[0], a.x), a.x + a.w - ph.w) * 100) / 100;
    const y = Math.round(Math.min(Math.max(ph.y + delta[1], a.y), a.y + a.h - ph.h) * 100) / 100;
    if (x !== ph.x || y !== ph.y) this.commit(updatePhoto(item, this.sel, { x, y }));
  }
}
