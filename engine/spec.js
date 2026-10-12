// 縦組みの機関紙の「型」のうち、版面の数値定数。ここが唯一の正で、ドキュメントは名前で参照する。
// 書体と色は newsletter.css の :root に置く。
// 出発点は第50号(2026年4月号)の Word 版の設定値。

export const SPEC = Object.freeze({
  page: { width: 210, height: 297 },                   // A4 縦(mm)
  margin: { top: 15, right: 12.7, bottom: 15, left: 12.7 },   // 版面の外側。上下は枠と柱・ノンブルのぶん広い
  dan: { count: 5, gap: 7.5 },                          // 段数、段間(mm)
  body: { fontSize: 11, lineHeight: 18 },               // 本文の文字サイズ、行送り(pt)
  wrapGap: 0.5,                                         // 配置物と本文の間隔(mm)
  frame: { offset: 3, width: 0.35 },                    // 版面を囲む罫: 版面からの距離と太さ(mm)
  danRule: { inset: 1, minLength: 3 },                  // 段間罫: 配置物との間隔、これより短い切れ端は引かない(mm)
  header: { top: 5.2, fontSize: 10.5 },                 // 柱(枠の上): 用紙の上端からの位置(mm)と文字サイズ(pt)
  footer: { bottom: 5.2, fontSize: 9.5 },               // ノンブル(枠の下の中央): 用紙の下端からの位置(mm)と文字サイズ(pt)
  masthead: { dan: [1, 3], right: 0, width: 34.9 },   // 題字の枠。1面の右端に固定。中身は紙名の設定(engine/publication.js)
  // 見出し枠の文字の大きさ(pt): 選べる大きさと、選ばないときの見た目ごとの標準(枠付き・白抜き・文字だけ)
  title: { sizes: [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48], base: { frame: 14, reverse: 14, plain: 19 } },
  box: { padding: 2, band: 6.5 },                       // 囲み記事: 内側の余白、見出しの帯の高さ(mm)
  panel: { padding: 1.0, gap: 1.5, band: 5 },           // 写真パネル: 内側の余白、写真どうしの間、見出し・キャプションの帯の高さ(mm)。地色なし(D-026)
  table: { padding: 1.5, band: 6 },                     // 表のパネル: 内側の余白、見出し・キャプションの帯の高さ(mm)
  underfullLines: 3,                                    // 記事の割り当て範囲の末尾が、この行数を超えて空いたら警告
  partial: { minChars: 4 },                             // 段の途中まで張り出す枠の脇に残る行が、この字数未満なら警告
  dpi: { warn: 200 },                                   // 写真の実効解像度がこれ未満なら警告
  photo: { minVisible: 0.6, aspectTolerance: 0.02 },    // 枠に見えている面積がこの割合未満なら「切り取りすぎ」、枠と切り抜きの縦横比がこの割合を超えてずれたら警告
});

export const PT_MM = 25.4 / 72;

export function contentBox(spec = SPEC) {
  return {
    left: spec.margin.left,
    right: spec.page.width - spec.margin.right,
    top: spec.margin.top,
    bottom: spec.page.height - spec.margin.bottom,
  };
}

export function danHeight(spec = SPEC) {
  const box = contentBox(spec);
  return (box.bottom - box.top - spec.dan.gap * (spec.dan.count - 1)) / spec.dan.count;
}

// d は 1 始まり(段1 が一番上)
export function danTop(spec, d) {
  return spec.margin.top + (d - 1) * (danHeight(spec) + spec.dan.gap);
}

export function danBottom(spec, d) {
  return danTop(spec, d) + danHeight(spec);
}

// 行送り(mm)。縦組みでは 1 行の幅にあたる。
export function linePitch(spec = SPEC) {
  return spec.body.lineHeight * PT_MM;
}

// 本文の1字の送り(mm)。縦組みなので、段の中の縦の位置はこれで数える
export function charPitch(spec = SPEC) {
  return spec.body.fontSize * PT_MM;
}

// 1 段に入る字数(本文の文字サイズで割った切り捨て)
export function charsPerLine(spec = SPEC) {
  return Math.floor(danHeight(spec) / charPitch(spec) + 1e-9);
}
