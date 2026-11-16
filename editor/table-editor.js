// 表の編集の画面(docs/04-editor.md「表の編集」)。表のパネルをダブルクリックするか、右の欄の「表を編集…」で開く。
// 升目に直接書き、行・列を足す・消す、セルを結合する(左右・上下)・解く、列の幅を目盛りのドラッグで変える、
// 見出しの行の数と、1列目を見出しにするかを決める。
// 「決定」で、表の原稿ファイルとパネルの設定(列の幅・1列目)を1回の操作として号に当てる(紙面で Ctrl+Z で戻せる。
// ファイルに書くのは号を保存するとき)。この画面の中の変更は、この画面の中で元に戻せる(Ctrl+Z / Ctrl+Y)。

import * as T from './table-model.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const HINT = 'セルをクリックして書きます(Enter で改行、Tab で次のセル)。Shift を押しながらクリックすると範囲を選べます。上の目盛りの境目をドラッグすると列の幅が変わります。Excel などでコピーした表は、セルを選んで Ctrl+V で升目ごと貼れます。Ctrl+Z / Ctrl+Y で元に戻す / やり直す。Ctrl+Enter で決定(Ctrl+S なら決定して号を保存)、Esc でやめる。';
const one = (r, c) => ({ r0: r, c0: c, r1: r, c1: c });
const MM_PX = 96 / 25.4;
const LS = String.fromCharCode(0x2028);   // セルの中の改行の目印(貼り付けで使う)

// 表計算ソフト(Excel・Google スプレッドシートなど)やワープロからコピーした表(HTML)を、貼るものにする。
// 結合(rowspan・colspan)と、あれば列の幅(Excel の <col width>)も読む。文字だけを取り出す(書式は持ち込まない)
export function gridFromHtml(html) {
  const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table');
  if (!table) return null;
  const rows = [...table.rows];
  if (!rows.length) return null;
  const occ = rows.map(() => []);
  const cells = [];
  const textOf = (td) => {
    const el = td.cloneNode(true);
    for (const br of el.querySelectorAll('br')) br.replaceWith(LS);
    return el.textContent.replace(/[\s\xa0]+/g, (m) => (m.includes(LS) ? LS : ' ')).split(LS).map((s) => s.trim()).join('\n').trim();
  };
  rows.forEach((tr, r) => {
    let c = 0;
    for (const td of tr.cells) {
      while (occ[r][c]) c++;
      const rs = Math.max(1, Math.min(td.rowSpan || 1, rows.length - r));
      const cs = Math.max(1, td.colSpan || 1);
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) occ[r + i][c + j] = true;
      cells.push({ r, c, rs, cs, text: textOf(td) });
      c += cs;
    }
  });
  const nCols = Math.max(1, ...occ.map((row) => row.length));
  const widths = [];
  for (const col of table.querySelectorAll('col')) {
    const w = parseFloat(col.getAttribute('width')) || parseFloat(col.style.width) || 0;
    for (let k = 0; k < (Number(col.getAttribute('span')) || 1); k++) widths.push(w);
  }
  return { nRows: rows.length, nCols, cells, widths: widths.length === nCols && widths.every((w) => w > 0) ? widths : null };
}

export class TableEditor {
  constructor(ed) {
    this.ed = ed;
    this.root = document.getElementById('table-editor');
    this.t = null;            // 編集中の表(editor/table-model.js)
    this.headCol = true;      // 1列目を見出しにする
    this.target = null;       // { page, index, file }
    this.sel = null;          // 選んでいる範囲 { r0, c0, r1, c1 }
    this.anchor = null;       // 範囲の起点 { r, c }
    this.history = [];
    this.future = [];
    this.session = false;     // 1つのセルに書いている間(1回の操作にまとめる)
    this.saved = '';
    this.root.innerHTML = `
      <div class="me-box te-box" role="dialog" aria-modal="true" aria-label="表の編集">
        <div class="me-bar">
          <strong class="me-title">表の編集</strong>
          <span class="tsep"></span>
          <span class="tlabel">行</span>
          <button type="button" data-te="row-above" title="選んでいるセルの上に行を足す">上に足す</button>
          <button type="button" data-te="row-below" title="選んでいるセルの下に行を足す">下に足す</button>
          <button type="button" data-te="row-delete" class="danger" title="選んでいる行を消す">消す</button>
          <span class="tsep"></span>
          <span class="tlabel">列</span>
          <button type="button" data-te="col-left" title="選んでいるセルの左に列を足す">左に足す</button>
          <button type="button" data-te="col-right" title="選んでいるセルの右に列を足す">右に足す</button>
          <button type="button" data-te="col-delete" class="danger" title="選んでいる列を消す">消す</button>
          <span class="tsep"></span>
          <button type="button" data-te="merge" title="選んでいる範囲を1つのセルにする(中の文字は改行でつなぐ)">セルを結合</button>
          <button type="button" data-te="split" title="結合したセルを元に戻す(文字は左上のセルに残す)">結合を解く</button>
          <span class="tsep"></span>
          <button type="button" data-te="undo" title="元に戻す(Ctrl+Z)">元に戻す</button>
          <button type="button" data-te="redo" title="やり直す(Ctrl+Y)">やり直す</button>
          <span class="grow"></span>
          <button type="button" data-te="cancel">やめる</button>
          <button type="button" data-te="done" class="primary" title="紙面の表に当てる(Ctrl+Enter)">決定</button>
        </div>
        <div class="te-main">
          <div class="te-opts">
            <label>見出しの行<select data-te-in="headerRows"></select></label>
            <label class="check"><input type="checkbox" data-te-in="headCol"> 1列目を見出しにする</label>
            <button type="button" data-te="even" title="すべての列を同じ幅にする">列の幅をそろえる</button>
          </div>
          <div class="te-sheet"></div>
        </div>
        <p class="me-hint">${HINT}</p>
      </div>`;
    this.sheet = this.root.querySelector('.te-sheet');
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.root.addEventListener('input', (e) => this.onInput(e));
    this.root.addEventListener('change', (e) => this.onChange(e));
    this.root.addEventListener('focusin', (e) => this.onFocusIn(e));
    this.root.addEventListener('focusout', () => { this.session = false; });
    this.root.addEventListener('paste', (e) => this.onPaste(e));
    window.addEventListener('resize', () => {
      if (!this.isOpen) return;
      this.fitZoom();
      this.updateFit();
    });
  }

  get isOpen() {
    return this.t != null;
  }

  state() {
    return JSON.stringify({ t: this.t, headCol: this.headCol });
  }

  get dirty() {
    return this.isOpen && this.state() !== this.saved;
  }

  // ---- 開く・閉じる・決定 ----

  open(page, index) {
    const item = this.ed.issue.pages[page]?.items?.[index];
    if (!item?.table) return;
    this.target = { page, index, file: item.table };
    this.t = T.fromText(this.ed.texts.get(item.table) ?? '', item.cols);
    // 紙面のパネルの中の、表の範囲の大きさ(mm)
    const wrap = document.querySelector(`#pages .page[data-page="${page + 1}"] .item[data-item="${index}"] .ptable`);
    this.paper = { w: parseFloat(wrap?.style.width) || 100, h: parseFloat(wrap?.style.height) || 40 };
    this.headCol = item.headCol !== false;
    this.saved = this.state();
    this.history = [];
    this.future = [];
    this.session = false;
    this.select(0, 0);
    this.root.hidden = false;
    this.render();
    this.focusCell(0, 0);
  }

  close(force = false) {
    if (!this.isOpen) return;
    if (!force && this.dirty && !confirm('表の変更を捨てて閉じますか?')) return;
    this.t = null;
    this.root.hidden = true;
    this.sheet.replaceChildren();
  }

  done() {
    const { page, index, file } = this.target;
    this.ed.applyTable(page, index, file, T.toText(this.t), { cols: T.colsValue(this.t), headCol: this.headCol ? undefined : false });
    this.close(true);
  }

  // ---- 元に戻す・やり直す ----

  snapshot() {
    return { t: this.t, headCol: this.headCol, sel: this.sel, anchor: this.anchor };
  }

  checkpoint() {
    this.history.push(this.snapshot());
    if (this.history.length > 200) this.history.shift();
    this.future = [];
  }

  restore(s) {
    Object.assign(this, s);
    this.session = false;
    this.render();
    this.focusCell(this.anchor.r, this.anchor.c);
  }

  undo() {
    if (!this.history.length) return;
    this.future.push(this.snapshot());
    this.restore(this.history.pop());
  }

  redo() {
    if (!this.future.length) return;
    this.history.push(this.snapshot());
    this.restore(this.future.pop());
  }

  // 表の操作を当てる。断られたら理由を出して何もしない。at: そのあとで選ぶセル
  change(next, at = null) {
    if (!next || next.error) {
      if (next?.error) this.ed.toast(next.error, { bad: true });
      return;
    }
    this.session = false;
    this.checkpoint();
    this.t = next;
    const r = Math.min(at?.r ?? this.anchor.r, next.nRows - 1);
    const c = Math.min(at?.c ?? this.anchor.c, next.nCols - 1);
    this.select(r, c);
    this.render();
    this.focusCell(r, c);
  }

  // ---- 選ぶ ----

  select(r, c) {
    this.anchor = { r, c };
    this.sel = this.t ? T.expandRect(this.t, one(r, c)) : one(r, c);
  }

  extendTo(r, c) {
    const a = this.anchor;
    this.sel = T.expandRect(this.t, { r0: Math.min(a.r, r), c0: Math.min(a.c, c), r1: Math.max(a.r, r), c1: Math.max(a.c, c) });
    this.paintSel();
  }

  focusCell(r, c) {
    const x = T.cellAt(this.t, r, c);
    const el = this.sheet.querySelector(`.te-cell[data-r="${x.r}"][data-c="${x.c}"]`);
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }

  // ---- 描く ----

  render() {
    const { t } = this;
    const g = T.gridOf(t);
    const rows = [];
    for (let r = 0; r < t.nRows; r++) {
      const tds = [];
      for (let c = 0; c < t.nCols; c++) {
        const x = t.cells[g[r][c]];
        if (x.r !== r || x.c !== c) continue;
        const head = r < t.headerRows || (this.headCol && c === 0);
        const tag = head ? 'th' : 'td';
        tds.push(`<${tag} data-r="${r}" data-c="${c}"${x.rs > 1 ? ` rowspan="${x.rs}"` : ''}${x.cs > 1 ? ` colspan="${x.cs}"` : ''}>`
          + `<div class="te-cell" contenteditable="plaintext-only" spellcheck="false" data-r="${r}" data-c="${c}" aria-label="${r + 1}行目・${c + 1}列目">${esc(x.text)}</div></${tag}>`);
      }
      rows.push(`<tr>${tds.join('')}</tr>`);
    }
    // 紙面のパネルの表の範囲と同じ大きさ(mm)で、紙面と同じ規則(newsletter.css の .panel の表)で組み、画面に合わせて拡大する。
    // 折り返しも紙面と同じになる
    this.sheet.innerHTML = `<div class="te-ruler" aria-label="列の幅"></div>
      <div class="te-paper"><div class="te-area panel" style="width:${this.paper.w}mm;height:${this.paper.h}mm">
        <table class="te-grid"><colgroup>${t.widths.map(() => '<col>').join('')}</colgroup><tbody>${rows.join('')}</tbody></table></div></div>
      <p class="te-fit" role="status"></p>`;
    this.fitZoom();
    this.renderWidths();
    const hr = this.root.querySelector('[data-te-in="headerRows"]');
    hr.innerHTML = Array.from({ length: Math.min(t.nRows, 4) + 1 }, (_, n) => `<option value="${n}"${n === t.headerRows ? ' selected' : ''}>${n === 0 ? 'なし' : `上の${n}行`}</option>`).join('');
    this.root.querySelector('[data-te-in="headCol"]').checked = this.headCol;
    this.paintSel();
  }

  // 列の幅(目盛りと列)。ドラッグの間は作り直さずに、これだけを直す
  renderWidths() {
    const { widths } = this.t;
    this.sheet.querySelectorAll('.te-grid col').forEach((col, k) => { col.style.width = `${widths[k]}%`; });
    let left = 0;
    this.sheet.querySelector('.te-ruler').innerHTML = widths.map((w, k) => {
      const html = `<span class="te-w" style="left:${left}%;width:${w}%">${Math.round(w)}%</span>`
        + (k < widths.length - 1 ? `<span class="te-h" data-k="${k}" style="left:${left + w}%" title="ドラッグで列の幅を変える"></span>` : '');
      left += w;
      return html;
    }).join('');
    this.updateFit();
  }

  // 画面の幅に合わせて拡大する(紙面と同じ大きさで組んだものを、そのまま大きく見せる)
  fitZoom() {
    const paper = this.sheet.querySelector('.te-paper');
    if (!paper) return;
    const w = this.paper.w * MM_PX;
    this.zoom = Math.max(1, Math.min(4, (this.sheet.clientWidth - 8) / w));
    paper.style.zoom = String(this.zoom);
    this.sheet.querySelector('.te-ruler').style.width = `${w * this.zoom}px`;
  }

  // 表がパネルの表の範囲(点線)に入りきるか
  updateFit() {
    const area = this.sheet.querySelector('.te-area');
    const table = this.sheet.querySelector('.te-grid');
    const note = this.sheet.querySelector('.te-fit');
    if (!area || !table || !note) return;
    const over = table.getBoundingClientRect().height > area.getBoundingClientRect().height + 1;
    area.classList.toggle('over', over);
    note.classList.toggle('bad', over);
    note.textContent = over
      ? '表がパネルに入りきりません(紙面では表がパネルからはみ出します)。列の幅を変えるか、文字を減らすか、紙面でパネルを大きくしてください。'
      : `紙面と同じ大きさ・同じ文字で組んで、${this.zoom.toFixed(1)}倍に拡大しています(折り返しも紙面と同じ)。点線がパネルの中の表の範囲です。`;
  }

  paintSel() {
    const q = this.sel;
    for (const td of this.sheet.querySelectorAll('.te-grid :is(td, th)[data-r]')) {
      const r = Number(td.dataset.r);
      const c = Number(td.dataset.c);
      td.classList.toggle('te-sel', r >= q.r0 && r <= q.r1 && c >= q.c0 && c <= q.c1);
    }
    const x = T.cellAt(this.t, this.anchor.r, this.anchor.c);
    // 範囲にいくつのセルがあるか(結合したセル1つだけなら「解く」が使える)
    const many = this.t.cells.filter((y) => y.r >= q.r0 && y.c >= q.c0 && y.r + y.rs - 1 <= q.r1 && y.c + y.cs - 1 <= q.c1).length > 1;
    const merged = !many && (x.rs > 1 || x.cs > 1);
    const btn = (k) => this.root.querySelector(`[data-te="${k}"]`);
    btn('merge').disabled = !many || T.merge(this.t, q).error != null;
    btn('split').disabled = !merged;
    btn('row-delete').disabled = this.t.nRows - (q.r1 - q.r0 + 1) < 1;
    btn('col-delete').disabled = this.t.nCols - (q.c1 - q.c0 + 1) < 1;
    btn('undo').disabled = !this.history.length;
    btn('redo').disabled = !this.future.length;
  }

  // ---- 操作 ----

  onFocusIn(e) {
    const el = e.target.closest('.te-cell');
    if (!el) return;
    this.select(Number(el.dataset.r), Number(el.dataset.c));
    this.paintSel();
  }

  onPointerDown(e) {
    const h = e.target.closest('.te-h');
    if (h) {
      this.dragWidth(e, Number(h.dataset.k));
      return;
    }
    const td = e.target.closest('.te-grid :is(td, th)[data-r]');
    if (td && e.shiftKey) {
      // Shift+クリックは範囲を広げる(クリックしたセルには移らない)
      e.preventDefault();
      this.extendTo(Number(td.dataset.r), Number(td.dataset.c));
    } else if (td && e.target === td) {
      // セルの余白(文字の外)を押しても、そのセルに書けるようにする
      e.preventDefault();
      this.focusCell(Number(td.dataset.r), Number(td.dataset.c));
    }
  }

  dragWidth(e, k) {
    e.preventDefault();
    const ruler = this.sheet.querySelector('.te-ruler');
    const box = ruler.getBoundingClientRect();
    this.session = false;
    this.checkpoint();
    const move = (ev) => {
      this.t = T.moveBoundary(this.t, k, ((ev.clientX - box.left) / box.width) * 100);
      this.renderWidths();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.paintSel();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  onInput(e) {
    const el = e.target.closest('.te-cell');
    if (!el) return;
    if (!this.session) {
      this.checkpoint();
      this.session = true;
    }
    this.t = T.setText(this.t, Number(el.dataset.r), Number(el.dataset.c), el.innerText.replace(/\n+$/, ''));
    this.paintSel();
  }

  onChange(e) {
    const k = e.target.dataset.teIn;
    if (k === 'headerRows') this.change(T.setHeaderRows(this.t, Number(e.target.value)));
    else if (k === 'headCol') {
      this.checkpoint();
      this.headCol = e.target.checked;
      this.render();
    }
  }

  // 選んでいる行(列)を、下(右)から順に消す
  deleteLines(kind) {
    const q = this.sel;
    let t = this.t;
    const [from, to] = kind === 'row' ? [q.r0, q.r1] : [q.c0, q.c1];
    for (let i = to; i >= from; i--) {
      t = kind === 'row' ? T.deleteRow(t, i) : T.deleteCol(t, i);
      if (t.error) break;
    }
    this.change(t, { r: kind === 'row' ? Math.max(0, q.r0 - 1) : q.r0, c: kind === 'col' ? Math.max(0, q.c0 - 1) : q.c0 });
  }

  onClick(e) {
    const b = e.target.closest('[data-te]');
    if (!b || b.disabled) return;
    const q = this.sel;
    const act = b.dataset.te;
    if (act === 'row-above') this.change(T.insertRow(this.t, q.r0), { r: q.r0, c: q.c0 });
    else if (act === 'row-below') this.change(T.insertRow(this.t, q.r1 + 1), { r: q.r1 + 1, c: q.c0 });
    else if (act === 'row-delete') this.deleteLines('row');
    else if (act === 'col-left') this.change(T.insertCol(this.t, q.c0), { r: q.r0, c: q.c0 });
    else if (act === 'col-right') this.change(T.insertCol(this.t, q.c1 + 1), { r: q.r0, c: q.c1 + 1 });
    else if (act === 'col-delete') this.deleteLines('col');
    else if (act === 'merge') this.change(T.merge(this.t, q), { r: q.r0, c: q.c0 });
    else if (act === 'split') this.change(T.split(this.t, this.anchor.r, this.anchor.c));
    else if (act === 'even') this.change(T.evenWidths(this.t));
    else if (act === 'undo') this.undo();
    else if (act === 'redo') this.redo();
    else if (act === 'cancel') this.close();
    else if (act === 'done') this.done();
  }

  // セルに貼る。表(Excel などからのコピー)なら、そのセルを左上にして升目ごと貼る(足りない行・列は足す)。
  // 1つのセルの文字なら、文字として貼る
  onPaste(e) {
    const el = e.target.closest?.('.te-cell');
    if (!el || !e.clipboardData) return;
    const html = e.clipboardData.getData('text/html');
    const g = (html && gridFromHtml(html)) || T.parseTsv(e.clipboardData.getData('text/plain'));
    e.preventDefault();
    if (g.nRows === 1 && g.nCols === 1) {
      document.execCommand('insertText', false, g.cells[0]?.text ?? '');
      return;
    }
    const at = { r: Number(el.dataset.r), c: Number(el.dataset.c) };
    const widths = T.pasteTakesWidths(this.t, at.c, g);
    this.change(T.pasteGrid(this.t, at.r, at.c, g), at);
    const merged = g.cells.some((x) => x.rs > 1 || x.cs > 1);
    this.ed.toast(`${g.nRows}行×${g.nCols}列を貼り付けました${merged ? '(結合も)' : ''}${widths ? '。列の幅もコピー元に合わせました' : ''}。Ctrl+Z で戻せます。`);
  }

  // 次(前)のセルへ。読む順(上の行から、左から)
  step(dir) {
    const order = this.t.cells.map((x) => [x.r, x.c]);
    const x = T.cellAt(this.t, this.anchor.r, this.anchor.c);
    const i = order.findIndex(([r, c]) => r === x.r && c === x.c);
    const next = order[i + dir];
    if (!next) return;
    this.select(next[0], next[1]);
    this.paintSel();
    this.focusCell(next[0], next[1]);
  }

  onKey(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    } else if (ctrl && (key === 'z' || key === 'y')) {
      e.preventDefault();
      if (key === 'y' || e.shiftKey) this.redo();
      else this.undo();
    } else if (ctrl && e.key === 'Enter') {
      e.preventDefault();
      this.done();
    } else if (ctrl && key === 's') {
      // 決定して、号を保存する
      e.preventDefault();
      this.done();
      this.ed.save();
    } else if (e.key === 'Tab' && e.target.closest?.('.te-cell')) {
      e.preventDefault();
      this.step(e.shiftKey ? -1 : 1);
    }
  }
}
