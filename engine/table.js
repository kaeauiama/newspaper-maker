// パイプ区切りの表。純粋関数。
//
//   |          | 優勝 | 準優勝 |
//   |---|---|---|              ← 区切り行。これより上が見出し行
//   | 男子 容(型)試合 | … | … |
//   | 大会会長賞 | ○○ | < |    ← セルが「<」だけなら左のセルと結合する
// セルの中の <br> は改行になる。

export function parsePipeTable(text) {
  const rows = [];
  let headerRows = 0;
  for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.length && cells.every((c) => /^:?-{3,}:?$/.test(c))) {
      headerRows = rows.length;
      continue;
    }
    const row = [];
    for (const c of cells) {
      if (c === '<' && row.length) row[row.length - 1].colspan += 1;
      else row.push({ lines: c.split(/<br\s*\/?>/i), colspan: 1 });
    }
    rows.push(row);
  }
  return { rows, headerRows };
}
