// 原稿テキスト(記事ファイル)の解析と、縦組み用の文字の整え。すべて純粋関数。
//
// 記事ファイルの書き方:
//   # 見出し            見出し枠に入る。複数行書くと枠の中で改行する
//   > リード            日付・会場など。複数行可。行頭の全角スペースは字下げとして残す
//   ▼小見出し           小見出し
//   ・●◆※ などで始まる行 箇条書き(字下げせず、2行目以降を1字下げる)
//   それ以外の行         1 行 = 1 段落。行頭の空白は取り除く(字下げは型で付ける)
//   空行、// で始まる行  無視する(// はメモ用)
// 最後の段落の末尾には「■」を付ける(すでにあれば付けない)。囲み記事では付けない(end: false)。

const BULLETS = /^[・●○◆◇★☆◎※]/;

export function parseArticle(text, { end = true } = {}) {
  const out = { title: [], lead: [], blocks: [] };
  for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    if (/^>/.test(raw)) {
      out.lead.push(raw.replace(/^> ?/, '').replace(/[\s　]+$/, ''));
      continue;
    }
    const line = raw.replace(/^[\s　]+|[\s　]+$/g, '');
    if (!line || line.startsWith('//')) continue;
    if (/^#[ 　]/.test(line)) { out.title.push(line.slice(2).trim()); continue; }
    if (line.startsWith('▼')) { out.blocks.push({ type: 'subhead', text: line }); continue; }
    out.blocks.push({ type: BULLETS.test(line) ? 'li' : 'para', text: line });
  }
  const last = [...out.blocks].reverse().find((b) => b.type === 'para' || b.type === 'li');
  if (end && last && !last.text.endsWith('■')) last.text += '■';
  return out;
}

const FULL_DIGITS = '０１２３４５６７８９';

// テキストノード用のエスケープ(属性には使わない)。数字を含む実体参照を作らないこと。
export function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 縦組みの文字の規則:
//   半角数字 2 桁          → 縦中横
//   半角数字 1 桁・3 桁以上 → 全角数字(1 字ずつ正立)
//   !! !? ?!               → 縦中横
//   ! ?                    → 全角
export function toInlineHtml(text) {
  return escapeText(text).replace(/[0-9]+|[!?]{2}|[!?]/g, (m) => {
    if (/^[0-9]{2}$/.test(m) || /^[!?]{2}$/.test(m)) return `<span class="tcy">${m}</span>`;
    if (m === '!') return '！';
    if (m === '?') return '？';
    return [...m].map((c) => FULL_DIGITS[c]).join('');
  });
}

// 本文の文字数(■ や空白を含む素の文字数)
export function countChars(blocks) {
  return blocks.reduce((n, b) => n + [...b.text].length, 0);
}
