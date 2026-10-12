// コメント(// と /* */)と末尾のカンマを許す JSON。純粋関数。
// コメントとカンマは空白に置き換えるので、エラー位置は元のテキストの行・列のまま示せる。

export function stripJsonc(text) {
  const src = String(text).replace(/^﻿/, '');
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < n) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      const end = e < 0 ? n : e;
      out += blank(src.slice(i, end));
      i = end;
    } else if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      out += blank(src.slice(i, end));
      i = end;
    } else if (c === ',') {
      let j = i + 1;
      while (j < n && /\s/.test(src[j])) j++;
      out += src[j] === '}' || src[j] === ']' ? ' ' : ',';
      i += 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

export function parseJsonc(text, name = 'issue.jsonc') {
  const cleaned = stripJsonc(text);
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const m = /position (\d+)/.exec(e.message);
    let where = '';
    if (m) {
      const before = cleaned.slice(0, Number(m[1]));
      const line = before.split('\n').length;
      const col = before.length - before.lastIndexOf('\n');
      where = `(${line}行目 ${col}文字目付近)`;
    }
    const err = new Error(`${name} の書き方に誤りがあります${where}: ${e.message}`);
    err.code = 'E_CONFIG_SYNTAX';
    throw err;
  }
}
