// 紙面の写しと縮小表示(紙面の画面のページの一覧・入稿の画面の紙の折り方・見開きプレビュー)。
// 組み上がったページを写し、編集の表示(選択・案の枠・選んだ記事の色・あふれの赤枠)を外して、印刷の見え方にする。

export function printClone(src) {
  const page = src.cloneNode(true);
  page.querySelectorAll('.sel, .ghost').forEach((x) => x.remove());
  page.querySelectorAll('.chosen, .overflow, .drop-target').forEach((x) => x.classList.remove('chosen', 'overflow', 'drop-target'));
  return page;
}

// 幅 width(px)の縮小表示。高さはページの縦横比どおり
export function pageThumb(src, width) {
  const k = width / src.offsetWidth;
  const box = document.createElement('span');
  box.className = 'thumb';
  Object.assign(box.style, { width: `${width}px`, height: `${Math.round(src.offsetHeight * k)}px` });
  const page = printClone(src);
  Object.assign(page.style, { transform: `scale(${k})`, transformOrigin: '0 0', margin: '0' });
  box.appendChild(page);
  return box;
}

// いま組み上がっている n 面(1 始まり)
export function pageElement(n) {
  return document.querySelector(`#pages .page[data-page="${n}"]`);
}
