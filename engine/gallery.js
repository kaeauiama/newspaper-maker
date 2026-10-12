// 写真パネルの中の並べ方と、写真の切り抜きの計算。純粋関数。

// パネルの余白と帯の高さ。写真パネルと表のパネルで別に決める(SPEC.panel・SPEC.table)
export function panelSpacing(spec, item) {
  return item.table ? spec.table : spec.panel;
}

// パネルの中で写真(表)を置ける範囲(パネルの左上からの mm)。上の見出し・下のキャプションの帯を除く
export function photoArea(spec, item, panelW, panelH) {
  const { padding: pad, band } = panelSpacing(spec, item);
  const top = pad + (item.title ? band : 0);
  const bottom = pad + (item.caption ? band : 0);
  return { x: pad, y: top, w: panelW - 2 * pad, h: panelH - top - bottom };
}

// 切り抜き crop = [左, 上, 幅, 高さ](元の写真に対する 0〜1 の割合)を枠 frame { w, h }(mm)に見せるときの、
// 写真全体の置き方(枠の左上からの mm)。縦横比は変えない。比率がわずかに合わないときは枠を覆うほうに合わせる
export function cropPlacement(frame, crop, natural) {
  const [cx, cy, cw, ch] = crop;
  const s = Math.max(frame.w / (cw * natural.w), frame.h / (ch * natural.h));   // 1px あたりの mm
  const width = natural.w * s;
  const height = natural.h * s;
  return {
    left: -cx * width - (cw * width - frame.w) / 2,
    top: -cy * height - (ch * height - frame.h) / 2,
    width,
    height,
    mmPerPx: s,
  };
}

// 写真を行ごとに並べる(rows)。
// ratios: 行ごとの写真の縦横比(幅/高さ) [[a, b], [c]]、box: { x, y, w, h }(mm)、gap: 写真どうしの間(mm)
// 各行を幅いっぱいに並べ、行の高さを揃えて box の高さいっぱいに伸縮する。
// 縦横比が合わない分は、表示側(object-fit: cover)でトリミングされる。

export function layoutRows(ratios, box, gap) {
  const natural = ratios.map((row) => (box.w - gap * (row.length - 1)) / row.reduce((s, a) => s + a, 0));
  const k = (box.h - gap * (ratios.length - 1)) / natural.reduce((s, h) => s + h, 0);
  const rects = [];
  let y = box.y;
  ratios.forEach((row, i) => {
    const h = natural[i] * k;
    let x = box.x;
    row.forEach((a, j) => {
      const w = a * natural[i];
      rects.push({ row: i, col: j, x, y, w, h });
      x += w + gap;
    });
    y += h + gap;
  });
  return rects;
}

// object-fit: cover で表示したときの実効解像度(dpi)
export function effectiveDpi(naturalW, naturalH, boxWmm, boxHmm) {
  if (!naturalW || !naturalH) return null;
  const mmPerPx = Math.max(boxWmm / naturalW, boxHmm / naturalH);
  return 25.4 / mmPerPx;
}

// object-fit: cover で表示したとき、写真のうち枠に見えている面積の割合(1 = 切り取りなし)
export function visibleFraction(naturalW, naturalH, boxW, boxH) {
  if (!naturalW || !naturalH) return 1;
  const s = Math.max(boxW / naturalW, boxH / naturalH);
  return (boxW * boxH) / (naturalW * s * naturalH * s);
}
