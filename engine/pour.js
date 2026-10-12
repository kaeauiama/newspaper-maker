// 本文ブロックを、スロットの箱へ順に流し込む。ブラウザ専用(実際の組版結果を測る)。
//
// 分割位置は「箱の左端からはみ出した最初の文字」= 収まらない最初の行の先頭。
// 行の区切りはブラウザが組んだ結果をそのまま使うので、禁則処理もそのまま引き継がれる。

const overflows = (box) => box.scrollWidth > box.clientWidth + 1;

// 戻り値: 残りの要素(el の後半)、または 'whole'(1 行目から入らない → 要素ごと次の箱へ)
export function splitOverflow(el, box) {
  const limit = box.getBoundingClientRect().left - 0.5;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    for (let i = 0; i < n.length; i++) {
      r.setStart(n, i);
      r.setEnd(n, i + 1);
      const rect = r.getClientRects()[0];
      if (!rect || rect.left >= limit) continue;
      const head = document.createRange();
      head.setStart(el, 0);
      head.setEnd(n, i);
      if (!head.toString().trim()) return 'whole';
      const tail = document.createRange();
      tail.setStart(n, i);
      tail.setEnd(el, el.childNodes.length);
      const rest = el.cloneNode(false);
      rest.appendChild(tail.extractContents());
      el.classList.add('split');        // 前半の最終行も両端揃えのままにする
      rest.classList.add('cont');       // 後半は字下げしない
      return rest;
    }
  }
  return 'whole';
}

// blocks を boxes へ流し込み、入りきらなかったブロックを返す。
// 小見出しは分割せず、箱の最後に小見出しだけが残る場合は次の箱へ送る。
export function pour(blocks, boxes) {
  const queue = [...blocks];
  for (const box of boxes) {
    if (!queue.length) break;
    while (queue.length) {
      const el = queue.shift();
      box.appendChild(el);
      if (!overflows(box)) continue;
      const rest = el.classList.contains('subhead') ? 'whole' : splitOverflow(el, box);
      if (rest === 'whole') {
        box.removeChild(el);
        queue.unshift(el);
        const prev = box.lastElementChild;
        if (prev && prev.classList.contains('subhead')) {
          box.removeChild(prev);
          queue.unshift(prev);
        }
      } else {
        queue.unshift(rest);
      }
      break;
    }
  }
  return queue;
}

// 箱の中で本文が使っている行数(右端から数える)。回り込み用の見えない float(.excl)は数えない
export function usedLines(box, pitchPx) {
  const text = [...box.children].filter((c) => !c.classList.contains('excl'));
  if (!text.length) return 0;
  const r = document.createRange();
  r.setStartBefore(text[0]);
  r.setEndAfter(text.at(-1));
  const content = r.getBoundingClientRect();
  const outer = box.getBoundingClientRect();
  return Math.round((outer.right - content.left) / pitchPx);
}
