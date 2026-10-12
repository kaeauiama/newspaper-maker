// ブラウザの印刷の画面で PDF にする(静的ページ版。サーバー版は tools/build.mjs が画面なしの Chrome で作る)。
// いま組み上がっている紙面を写して印刷用の表示に並べ、window.print() で印刷の画面を開く。
// 送信先を「PDF に保存」にすると、tools/build.mjs と同じ Chrome の PDF の機能・同じ設定
// (CSS の用紙の大きさ・余白なし・背景を印刷)で保存される。A3 の面付けは、2ページずつ横に並べて A3 横の用紙にする。

import { printClone } from './thumbs.js';

// title: 保存するファイルの名前(印刷の画面がファイル名に使う)、sides: A3 の面付け([左, 右] のページ番号の並び。なければ A4)
export function printPages({ title, sides = null }) {
  const pages = [...document.querySelectorAll('#pages .page')];
  if (!pages.length) return false;
  const byNo = new Map(pages.map((p) => [Number(p.dataset.page), p]));
  const root = document.createElement('div');
  root.id = 'print-root';
  if (sides) {
    for (const [l, r] of sides) {
      const sheet = document.createElement('div');
      sheet.className = 'sheet';
      sheet.append(printClone(byNo.get(l)), printClone(byNo.get(r)));
      root.appendChild(sheet);
    }
  } else {
    for (const p of pages) root.appendChild(printClone(p));
  }
  const style = document.createElement('style');
  style.id = 'print-style';
  style.textContent = `
    @media screen { #print-root { display: none; } }
    @media print {
      html, body.editor { height: auto !important; overflow: visible !important; background: #fff !important; }
      body.editor { display: block !important; }
      body.editor > *:not(#print-root) { display: none !important; }
      #print-root .page { box-shadow: none !important; margin: 0 !important; }
      ${sides ? `@page { size: 420mm 297mm; margin: 0; }
      #print-root .sheet { display: flex; width: 420mm; height: 297mm; overflow: hidden; break-after: page; }
      #print-root .sheet:last-child { break-after: auto; }
      #print-root .sheet .page { flex: none; break-after: auto !important; }` : ''}
    }`;
  document.head.appendChild(style);
  document.body.appendChild(root);
  const before = document.title;
  document.title = title;
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    root.remove();
    style.remove();
    document.title = before;
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  // 印刷の画面が閉じても afterprint が来ないブラウザのために
  setTimeout(cleanup, 1000);
  return true;
}

// 書き出したテキストを、このパソコンのファイルとして保存する(入稿メモなど)
export function downloadText(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
