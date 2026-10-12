// ファイルの名前の決まり(ブラウザと Node の両方で使う純粋関数)。

// 取り込んだ写真・画像の名前: 使えない文字を - にし、大文字小文字の違いでも、いまあるものと重ならないようにする
export function safePhotoName(name, taken) {
  const m = /^(.*?)(\.[^.\\/]+)?$/.exec(name);
  const ext = (m[2] ?? '').toLowerCase();
  const stem = m[1].replace(/[\\/:*?"<>|\s\u0000-\u001f]+/g, '-').replace(/^[-.]+|-+$/g, '') || 'photo';
  let out = `${stem}${ext}`;
  for (let i = 2; taken.has(out.toLowerCase()); i++) out = `${stem}-${i}${ext}`;
  return out;
}

// 号のフォルダの名前(ワークスペースの中)。号数を3桁にそろえる(例: 51 → 051)
export function issueFolderName(number) {
  return Number.isInteger(number) && number >= 0 ? String(number).padStart(3, '0') : String(number);
}

export const PHOTO_TYPES = /^image\/(jpeg|png|webp|gif)$/;
export const BRAND_TYPES = /^image\/(jpeg|png|webp|gif|svg\+xml)$/;

// 名前の拡張子から画像の種類を決める(わからなければ '')。<img> で SVG を出すには image/svg+xml が要る
const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
export function imageType(name) {
  const m = /\.[^.\\/]+$/.exec(name);
  return (m && IMAGE_TYPES[m[0].toLowerCase()]) || '';
}
