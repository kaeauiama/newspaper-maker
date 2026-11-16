// 表の編集の画面(editor/table-editor.js)が扱う表の中身。純粋関数(どれも新しい表を返し、渡した表は変えない)。
// 表: { nRows, nCols, headerRows, cells: [{ r, c, rs, cs, text }], widths: [列ごとの幅(%、合計 100)], preamble: [表の前のメモの行] }
//   cells は升目をすき間なく覆う。結合したセルは rs(行数)・cs(列数)が 2 以上。text の改行は \n
// ファイルは engine/table.js の書き方(「<」で左と、「^」で上と結合)。

import { parsePipeTable } from '../engine/table.js';

const clone = (t) => structuredClone(t);
const round1 = (v) => Math.round(v * 10) / 10;
const even = (n) => Array.from({ length: n }, () => 100 / n);

// 幅の合計を 100 にそろえる
export function normalizeWidths(ws) {
  const sum = ws.reduce((a, b) => a + b, 0);
  return sum > 0 ? ws.map((w) => (w / sum) * 100) : even(ws.length);
}

// 位置ごとのセルの番号
export function gridOf(t) {
  const g = Array.from({ length: t.nRows }, () => Array(t.nCols).fill(-1));
  t.cells.forEach((x, k) => {
    for (let r = x.r; r < x.r + x.rs; r++) for (let c = x.c; c < x.c + x.cs; c++) g[r][c] = k;
  });
  return g;
}

// すき間に空のセルを入れ、読む順(上の行から、左から)に並べる
function tidy(t) {
  const g = gridOf(t);
  for (let r = 0; r < t.nRows; r++) for (let c = 0; c < t.nCols; c++) if (g[r][c] < 0) t.cells.push({ r, c, rs: 1, cs: 1, text: '' });
  t.cells.sort((a, b) => a.r - b.r || a.c - b.c);
  return t;
}

// 表の原稿ファイルから。cols: パネルの列の幅(列の数と合わなければ均等)
export function fromText(text, cols = null) {
  const p = parsePipeTable(text);
  const nCols = Math.max(1, p.cols);
  const preamble = [];
  for (const line of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    if (line.trim().startsWith('|')) break;
    preamble.push(line);
  }
  while (preamble.length && !preamble.at(-1).trim()) preamble.pop();
  const t = {
    nRows: Math.max(1, p.rows.length),
    nCols,
    headerRows: p.headerRows,
    cells: p.cells.map((x) => ({ r: x.r, c: x.c, rs: x.rs, cs: x.cs, text: x.text.split(/<br\s*\/?>/i).join('\n') })),
    widths: Array.isArray(cols) && cols.length === nCols ? normalizeWidths(cols) : even(nCols),
    preamble,
  };
  return tidy(t);
}

const cellText = (s) => {
  const v = s.replace(/\|/g, '｜').split('\n').join('<br>');
  return v === '<' ? '＜' : v === '^' ? '＾' : v;
};

// 表の原稿ファイルへ
export function toText(t) {
  const g = gridOf(t);
  const lines = [...t.preamble];
  const sep = `|${Array(t.nCols).fill('---').join('|')}|`;
  for (let r = 0; r < t.nRows; r++) {
    if (r === t.headerRows && r > 0) lines.push(sep);
    const tokens = [];
    for (let c = 0; c < t.nCols; c++) {
      const x = t.cells[g[r][c]];
      tokens.push(x.r === r && x.c === c ? cellText(x.text) : x.r === r ? '<' : '^');
    }
    lines.push(`| ${tokens.join(' | ')} |`);
  }
  if (t.headerRows >= t.nRows && t.nRows > 0) lines.push(sep);
  return `${lines.join('\n')}\n`;
}

// パネルの cols に書く値(均等なら書かない)
export function colsValue(t) {
  const ws = t.widths.map(round1);
  return ws.every((w) => Math.abs(w - ws[0]) < 0.05) ? undefined : ws;
}

export function cellAt(t, r, c) {
  return t.cells[gridOf(t)[r][c]];
}

// 範囲を、かかっている結合セルを全部含むまで広げる
export function expandRect(t, rect) {
  let { r0, c0, r1, c1 } = rect;
  for (let changed = true; changed;) {
    changed = false;
    for (const x of t.cells) {
      if (x.r > r1 || x.r + x.rs - 1 < r0 || x.c > c1 || x.c + x.cs - 1 < c0) continue;
      const nr0 = Math.min(r0, x.r), nc0 = Math.min(c0, x.c), nr1 = Math.max(r1, x.r + x.rs - 1), nc1 = Math.max(c1, x.c + x.cs - 1);
      if (nr0 !== r0 || nc0 !== c0 || nr1 !== r1 || nc1 !== c1) {
        [r0, c0, r1, c1] = [nr0, nc0, nr1, nc1];
        changed = true;
      }
    }
  }
  return { r0, c0, r1, c1 };
}

const inRect = (x, q) => x.r >= q.r0 && x.c >= q.c0 && x.r + x.rs - 1 <= q.r1 && x.c + x.cs - 1 <= q.c1;

// 範囲のセルを1つに結合する。中の文字は消さず、読む順に改行でつなぐ。戻り値: 表か { error }
export function merge(t, rect) {
  const q = expandRect(t, rect);
  const inside = t.cells.filter((x) => inRect(x, q));
  if (inside.length < 2) return { error: '結合するセルを2つ以上選んでください(Shift を押しながらクリックすると範囲を選べます)。' };
  const next = clone(t);
  next.cells = next.cells.filter((x) => !inRect(x, q));
  next.cells.push({ r: q.r0, c: q.c0, rs: q.r1 - q.r0 + 1, cs: q.c1 - q.c0 + 1, text: inside.map((x) => x.text).filter((s) => s.trim()).join('\n') });
  return tidy(next);
}

// 結合を解く(文字は左上のセルに残す)
export function split(t, r, c) {
  const next = clone(t);
  const x = cellAt(next, r, c);
  x.rs = 1;
  x.cs = 1;
  return tidy(next);
}

export function setText(t, r, c, text) {
  const next = clone(t);
  cellAt(next, r, c).text = text;
  return next;
}

// at 行目の前に空の行を足す。またいでいる結合セルは1行伸ばす
export function insertRow(t, at) {
  const next = clone(t);
  for (const x of next.cells) {
    if (x.r >= at) x.r += 1;
    else if (x.r + x.rs > at) x.rs += 1;
  }
  next.nRows += 1;
  if (at < next.headerRows) next.headerRows += 1;   // 見出しの行の間に足したら、見出しの行
  return tidy(next);
}

export function deleteRow(t, row) {
  if (t.nRows <= 1) return { error: '最後の1行は消せません。' };
  const next = clone(t);
  next.cells = next.cells.filter((x) => !(x.r === row && x.rs === 1));
  for (const x of next.cells) {
    if (x.r > row) x.r -= 1;
    else if (x.r + x.rs > row) x.rs -= 1;
  }
  next.nRows -= 1;
  if (row < next.headerRows) next.headerRows -= 1;
  return tidy(next);
}

// at 列目の前に空の列を足す(幅はほかの列の平均。全体を 100% にそろえ直す)
export function insertCol(t, at) {
  const next = clone(t);
  for (const x of next.cells) {
    if (x.c >= at) x.c += 1;
    else if (x.c + x.cs > at) x.cs += 1;
  }
  next.nCols += 1;
  next.widths.splice(at, 0, 100 / t.nCols);
  next.widths = normalizeWidths(next.widths);
  return tidy(next);
}

export function deleteCol(t, col) {
  if (t.nCols <= 1) return { error: '最後の1列は消せません。' };
  const next = clone(t);
  next.cells = next.cells.filter((x) => !(x.c === col && x.cs === 1));
  for (const x of next.cells) {
    if (x.c > col) x.c -= 1;
    else if (x.c + x.cs > col) x.cs -= 1;
  }
  next.nCols -= 1;
  next.widths.splice(col, 1);
  next.widths = normalizeWidths(next.widths);
  return tidy(next);
}

// 列の境目 k(k 列目と k+1 列目の間)を、左端からの位置 pos(%)へ動かす。どちらの列も min(%)より狭くしない
export function moveBoundary(t, k, pos, min = 5) {
  const next = clone(t);
  const left = next.widths.slice(0, k).reduce((a, b) => a + b, 0);
  const pair = next.widths[k] + next.widths[k + 1];
  const a = Math.min(Math.max(pos - left, min), pair - min);
  next.widths[k] = a;
  next.widths[k + 1] = pair - a;
  return next;
}

export function evenWidths(t) {
  return { ...clone(t), widths: even(t.nCols) };
}

export function setHeaderRows(t, n) {
  return { ...clone(t), headerRows: Math.max(0, Math.min(n, t.nRows)) };
}

// ---- 貼り付け(Excel・Google スプレッドシートなどからのコピー) ----
// 貼るもの: { nRows, nCols, cells: [{ r, c, rs, cs, text }], widths: [列の幅の比] | null }

// タブ区切り(表計算ソフトからの、文字だけのコピー)を升目にする。" で囲んだセルの中の改行・タブはセルの中のもの
export function parseTsv(text) {
  const s = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const rows = [];
  let row = [];
  let cur = '';
  let start = true;    // セルの頭
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
      continue;
    }
    if (ch === '"' && start) {
      quoted = true;
      start = false;
    } else if (ch === '\t' || ch === '\n') {
      row.push(cur);
      cur = '';
      start = true;
      if (ch === '\n') {
        rows.push(row);
        row = [];
      }
    } else {
      cur += ch;
      start = false;
    }
  }
  row.push(cur);
  rows.push(row);
  const nCols = Math.max(...rows.map((r) => r.length));
  const cells = [];
  rows.forEach((r, i) => { for (let c = 0; c < nCols; c++) cells.push({ r: i, c, rs: 1, cs: 1, text: (r[c] ?? '').trim() }); });
  return { nRows: rows.length, nCols, cells, widths: null };
}

// 列の幅も貼るか: 左端の列から、表の列をすべて覆うように貼り、貼るものに幅があるとき
export const pasteTakesWidths = (t, c0, g) => c0 === 0 && !!g.widths && g.widths.length === g.nCols && Math.max(t.nCols, g.nCols) === g.nCols;

// (r0, c0) を左上にして貼る。足りない行・列は足し、範囲にかかる結合は解いてから、貼るもののセル(結合も)に置き換える
export function pasteGrid(t, r0, c0, g) {
  let next = clone(t);
  while (next.nRows < r0 + g.nRows) next = insertRow(next, next.nRows);
  while (next.nCols < c0 + g.nCols) next = insertCol(next, next.nCols);
  const q = { r0, c0, r1: r0 + g.nRows - 1, c1: c0 + g.nCols - 1 };
  next = clone(next);
  for (const x of next.cells) {
    if (x.r > q.r1 || x.r + x.rs - 1 < q.r0 || x.c > q.c1 || x.c + x.cs - 1 < q.c0) continue;
    x.rs = 1;
    x.cs = 1;
  }
  tidy(next);
  next.cells = next.cells.filter((x) => !inRect(x, q));
  for (const x of g.cells) {
    next.cells.push({ r: x.r + r0, c: x.c + c0, rs: Math.max(1, Math.min(x.rs, g.nRows - x.r)), cs: Math.max(1, Math.min(x.cs, g.nCols - x.c)), text: x.text });
  }
  if (pasteTakesWidths(t, c0, g)) next.widths = normalizeWidths(g.widths);
  return tidy(next);
}
