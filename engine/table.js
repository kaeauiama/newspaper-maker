// パイプ区切りの表。純粋関数。
//
//   |          | 優勝 | 準優勝 |
//   |---|---|---|              ← 区切り行。これより上が見出し行
//   | 男子 容(型)試合 | … | … |
//   | 大会会長賞 | ○○ | < |    ← セルが「<」だけなら左のセルと結合する
//   | ^ | … | … |              ← セルが「^」だけなら上のセルと結合する(D-037)
// セルの中の <br> は改行になる。行の頭の「|」で始まらない行(// のメモなど)は読まない。
// エディタは表の編集の画面(editor/table-editor.js)で書くので、ふつうは手で書かなくてよい。

const SEPARATOR = /^:?-{3,}:?$/;

// 表の行(「|」で始まる行)を、セルの文字の並びにする。区切り行の位置が見出しの行数
export function pipeRows(text) {
  const grid = [];
  let headerRows = 0;
  for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.length && cells.every((c) => SEPARATOR.test(c))) {
      headerRows = grid.length;
      continue;
    }
    grid.push(cells);
  }
  return { grid, headerRows };
}

// 戻り値: { rows: [[{ lines, colspan, rowspan, col }]](HTML の行ごと。結合で隠れる位置は入れない),
//          headerRows, cols(いちばん長い行の列の数), cells: [{ r, c, rs, cs, text }], problems: [{ code, message }] }
export function parsePipeTable(text) {
  const { grid, headerRows } = pipeRows(text);
  const problems = [];
  // 位置ごとに、どのセルに属するか(「<」は左、「^」は上のセルに属する)
  const owner = grid.map((row) => row.map(() => -1));
  const cells = [];
  grid.forEach((row, r) => row.forEach((t, c) => {
    const left = c > 0 ? owner[r][c - 1] : -1;
    const up = r > 0 && c < owner[r - 1].length ? owner[r - 1][c] : -1;
    if (t === '<' && left >= 0) owner[r][c] = left;
    else if (t === '^' && up >= 0) owner[r][c] = up;
    else {
      owner[r][c] = cells.length;
      cells.push({ r, c, rs: 1, cs: 1, text: t });
    }
  }));
  // 結合は長方形でなければならない。そうでなければ知らせて、そのセルの結合をやめる
  const spots = cells.map(() => []);
  grid.forEach((row, r) => row.forEach((_, c) => spots[owner[r][c]].push([r, c])));
  const extra = [];
  cells.forEach((cell, k) => {
    const rs = Math.max(...spots[k].map(([r]) => r)) - cell.r + 1;
    const cs = Math.max(...spots[k].map(([, c]) => c)) - cell.c + 1;
    let ok = spots[k].length === rs * cs;
    for (let r = cell.r; ok && r < cell.r + rs; r++) for (let c = cell.c; ok && c < cell.c + cs; c++) ok = owner[r]?.[c] === k;
    if (ok) {
      cell.rs = rs;
      cell.cs = cs;
      return;
    }
    problems.push({ code: 'W_TABLE_MERGE', message: `表の ${cell.r + 1}行目・${cell.c + 1}列目から始まる結合が長方形になっていないので、結合しないで組みます。「<」と「^」の位置を確かめてください。` });
    for (const [r, c] of spots[k]) if (r !== cell.r || c !== cell.c) extra.push({ r, c, rs: 1, cs: 1, text: '' });
  });
  const all = [...cells, ...extra];
  const rows = grid.map((_, r) => all.filter((x) => x.r === r).sort((a, b) => a.c - b.c)
    .map((x) => ({ lines: x.text.split(/<br\s*\/?>/i), colspan: x.cs, rowspan: x.rs, col: x.c })));
  return { rows, headerRows, cols: Math.max(0, ...grid.map((row) => row.length)), cells: all, problems };
}
