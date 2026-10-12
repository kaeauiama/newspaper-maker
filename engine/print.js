// 印刷・入稿のための純粋関数(docs/04-editor.md「入稿の準備」)。ブラウザ(エディタ)と Node(PDF 作成)の両方で使う。

// 中綴じ(二つ折りの紙を重ねる)の面付け。縦組みの右綴じ。n が 4 の倍数のときだけ作れる(それ以外は null)。
// 戻り値: 刷る順(1枚目の外側、1枚目の内側、2枚目の外側…)に、紙の片面ごとの [左, 右] のページ番号(1 始まり)。
//   4ページ: 外側 [1, 4]、内側 [3, 2](開くと右が 2面、左が 3面)
export function imposition(n) {
  if (!Number.isInteger(n) || n < 4 || n % 4) return null;
  const sides = [];
  for (let s = 0; s < n / 4; s++) {
    sides.push([2 * s + 1, n - 2 * s]);
    sides.push([n - 2 * s - 1, 2 * s + 2]);
  }
  return sides;
}

// 号の中身の指紋。刷る前に確認していただいたあとで中身が変わったかを見るのに使う。
// 紙面に出るもの(号数・発行年月・配置・記事の並び・原稿)だけで作り、進み具合・メモ・確認の記録・刷り方は含めない。
// texts: Map(ファイル名 → 中身)
export function contentFingerprint(issue, texts) {
  const body = JSON.stringify({
    number: issue.number,
    date: issue.date,
    pages: issue.pages,
    articles: (issue.articles ?? []).map((a) => ({ id: a.id, file: a.file, start: a.start ?? null })),
    texts: [...texts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  });
  let h = 0x811c9dc5;   // FNV-1a(32 ビット)
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// 刷り方の既定値(号ごとに issue.jsonc の print で変える)
export const PRINT_DEFAULTS = { copies: 80, paper: '上質紙', color: true };

// 入稿するファイルの名前。prefix は紙名の設定の fileName
export function printFiles(number, prefix = 'kikanshi') {
  const n = String(number).padStart(3, '0');
  return { a4: `${prefix}-${n}.pdf`, a3: `${prefix}-${n}-a3.pdf`, memo: '入稿メモ.txt' };
}

// 入稿メモ(印刷の店に伝えること)。pages: ページ数、today: 'YYYY-MM-DD'、pub: 紙名の設定(name・fileName・approver)
export function printMemo(issue, pages, today, pub = { name: '機関紙', fileName: 'kikanshi', approver: '発行責任者' }) {
  const print = { ...PRINT_DEFAULTS, ...(issue.print ?? {}) };
  const files = printFiles(issue.number, pub.fileName);
  const sides = imposition(pages);
  const lines = [`${pub.name} 第${issue.number}号(${issue.date})入稿メモ`, `作成: ${today}`, ''];
  lines.push('■ 入稿するファイル');
  if (sides) {
    const sheets = sides.length / 2;
    lines.push(`  ${files.a3} … A3 横・${sides.length}ページ(${sheets === 1 ? '1ページ目が紙の外側、2ページ目が内側' : '1枚目の外側・内側、2枚目の外側・内側…の順'})`);
    lines.push(`  ${files.a4} … A4・${pages}ページ(ページの順の確認用)`);
  } else {
    lines.push(`  ${files.a4} … A4・${pages}ページ`);
  }
  lines.push('', '■ 刷り方');
  if (sides) {
    const sheets = sides.length / 2;
    lines.push(`  用紙: A3(${print.paper})${sheets > 1 ? `を ${sheets} 枚` : ''}`);
    lines.push('  両面: 短辺とじ(1ページ目と2ページ目を、1枚の紙の表と裏に)');
    lines.push(`  仕上げ: 中央で二つ折り${sheets > 1 ? '(重ねて中綴じ)' : ''}。縦書きの右綴じ: 外側は左に 1面・右に ${pages}面、開いた内側は左に 3面・右に 2面`);
  } else {
    lines.push(`  用紙: A4(${print.paper})`);
    lines.push(`  両面: 長辺とじ${pages > 2 ? `(${Math.ceil(pages / 2)} 枚。ページの順に重ねる)` : '(1ページ目が表、2ページ目が裏)'}`);
  }
  lines.push(`  色: ${print.color ? 'カラー' : 'モノクロ'}`);
  lines.push(`  部数: ${print.copies}部`);
  lines.push('', '■ 確認');
  lines.push(`  ${pub.approver}の確認: ${issue.approval?.date ? `${issue.approval.date} 済み` : 'まだ'}`);
  return `${lines.join('\n')}\n`;
}
