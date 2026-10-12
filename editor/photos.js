// 写真パネルの中身の操作(写真の「枠 + 切り抜き」)。純粋関数(docs/05-proposals.md 2-2)。
//
// 写真は { src, x, y, w, h, crop: [左, 上, 幅, 高さ] } で持つ。x・y・w・h はパネルの左上からの mm、
// crop は元の写真に対する 0〜1 の割合。枠の縦横比は、いつも切り抜きの縦横比と同じにする。
// sizes: Map(src → { w, h }) 元の写真の大きさ(px)

import { photoArea, layoutRows } from '../engine/gallery.js';

const r4 = (v) => Math.round(v * 10000) / 10000;
const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

// "50% 20%" → [0.5, 0.2](なければ中央)
export function parseFocus(focus) {
  const m = /^\s*(-?[\d.]+)%\s+(-?[\d.]+)%\s*$/.exec(focus ?? '');
  return m ? [Number(m[1]) / 100, Number(m[2]) / 100] : [0.5, 0.5];
}

// 枠いっぱいに見せる(はみ出す分を切る)ときの切り抜き。focus は切るときの中心
export function coverCrop(frame, size, focus) {
  const s = Math.max(frame.w / size.w, frame.h / size.h);
  const cw = Math.min(1, frame.w / (size.w * s));
  const ch = Math.min(1, frame.h / (size.h * s));
  const [fx, fy] = parseFocus(focus);
  return [r4((1 - cw) * fx), r4((1 - ch) * fy), r4(cw), r4(ch)];
}

// 切り抜いた写真の縦横比(幅/高さ)
export function aspectOf(photo, size) {
  const [, , cw, ch] = photo.crop ?? [0, 0, 1, 1];
  return (cw * size.w) / (ch * size.h);
}

// rows や、切り抜きを持たない photos を、見た目を変えずに「枠 + 切り抜き」に直す。大きさの分からない写真は全体を見せる
export function materializePanel(spec, item, panelW, panelH, sizes) {
  const area = photoArea(spec, item, panelW, panelH);
  const crop = (frame, src, focus) => (sizes.has(src) ? coverCrop(frame, sizes.get(src), focus) : [0, 0, 1, 1]);
  let photos;
  if (Array.isArray(item.photos)) {
    photos = item.photos.map((ph) => {
      if (ph.crop) return ph;
      const { focus, ...rest } = ph;
      return { ...rest, crop: crop(ph, ph.src, focus) };
    });
  } else {
    const flat = (item.rows ?? []).flat().map((p) => (typeof p === 'string' ? { src: p } : p));
    let k = 0;
    const ratios = (item.rows ?? []).map((row) => row.map(() => {
      const size = sizes.get(flat[k++].src);
      return size ? size.w / size.h : 1.5;
    }));
    const rects = flat.length ? layoutRows(ratios, area, spec.panel.gap) : [];
    photos = flat.map((p, i) => {
      const r = rects[i];
      return { src: p.src, x: r2(r.x), y: r2(r.y), w: r2(r.w), h: r2(r.h), crop: crop(r, p.src, p.focus) };
    });
  }
  const out = { ...item, photos };
  delete out.rows;
  return out;
}

// 写真が1枚だけのパネル: 写真を写真の範囲いっぱいに置く。切り抜きは範囲と同じ縦横比にし、いまの切り抜きの中心を保って、
// 写真からはみ出さない範囲でいちばん大きくする(なるべく切らない)。size: 元の写真の大きさ(px)
export function fillSingle(photo, area, size) {
  const [cx, cy, cw, ch] = photo.crop ?? [0, 0, 1, 1];
  const k = (area.w / area.h) * (size.h / size.w);   // 0〜1 の座標での 幅/高さ
  let w = 1;
  let h = 1 / k;
  if (h > 1) {
    h = 1;
    w = k;
  }
  const x = clamp(cx + cw / 2 - w / 2, 0, 1 - w);
  const y = clamp(cy + ch / 2 - h / 2, 0, 1 - h);
  return { ...photo, x: r2(area.x), y: r2(area.y), w: r2(area.w), h: r2(area.h), crop: [x, y, w, h].map(r4) };
}

// パネルの大きさが変わったとき: 写真を縦横比を保ったまま一様に伸び縮みさせ、新しい範囲の中央に置く
export function fitPhotos(photos, oldArea, newArea) {
  const k = Math.min(newArea.w / oldArea.w, newArea.h / oldArea.h);
  const dx = newArea.x + (newArea.w - oldArea.w * k) / 2;
  const dy = newArea.y + (newArea.h - oldArea.h * k) / 2;
  return photos.map((ph) => ({ ...ph, x: r2(dx + (ph.x - oldArea.x) * k), y: r2(dy + (ph.y - oldArea.y) * k), w: r2(ph.w * k), h: r2(ph.h * k) }));
}

// 写真を順に rows 行へ分ける。各行の縦横比の和がなるべく等しくなるようにし、どの行にも1枚は残す
export function partition(aspects, rows) {
  const groups = [];
  let i = 0;
  for (let r = rows; r >= 1; r--) {
    if (r === 1) {
      groups.push(aspects.slice(i).map((_, k) => i + k));
      break;
    }
    const target = aspects.slice(i).reduce((s, a) => s + a, 0) / r;
    const g = [i];
    let sum = aspects[i];
    i += 1;
    while (aspects.length - i > r - 1 && Math.abs(sum + aspects[i] - target) <= Math.abs(sum - target)) {
      sum += aspects[i];
      g.push(i);
      i += 1;
    }
    groups.push(g);
  }
  return groups;
}

// 自動で並べる: 縦横比を保ったまま行ごとに敷き詰め、範囲に収まるよう一様に縮めて中央に置く。
// 行数は、範囲をいちばん広く覆うものを選ぶ。戻り値は aspects の順の枠 [{ x, y, w, h }]
export function autoLayout(aspects, area, gap) {
  if (!aspects.length) return [];
  let best = null;
  for (let rows = 1; rows <= aspects.length; rows++) {
    const groups = partition(aspects, rows);
    const heights = groups.map((g) => (area.w - gap * (g.length - 1)) / g.reduce((s, i) => s + aspects[i], 0));
    const sumH = heights.reduce((s, h) => s + h, 0);
    const k = Math.min(1, (area.h - gap * (groups.length - 1)) / sumH);
    const covered = groups.reduce((s, g, gi) => s + g.reduce((t, i) => t + aspects[i] * (heights[gi] * k) ** 2, 0), 0);
    if (!best || covered > best.covered + 1e-9) best = { groups, heights, k, covered };
  }
  const { groups, heights, k } = best;
  const totalH = heights.reduce((s, h) => s + h * k, 0) + gap * (groups.length - 1);
  let y = area.y + (area.h - totalH) / 2;
  const frames = [];
  groups.forEach((g, gi) => {
    const h = heights[gi] * k;
    const rowW = g.reduce((s, i) => s + aspects[i] * h, 0) + gap * (g.length - 1);
    let x = area.x + (area.w - rowW) / 2;
    for (const i of g) {
      const w = aspects[i] * h;
      frames[i] = { x: r2(x), y: r2(y), w: r2(w), h: r2(h) };
      x += w + gap;
    }
    y += h + gap;
  });
  return frames;
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// 新しい写真の置き場所: 重ならない所を左上から探す(大きめから順に試す)。見つからなければ中央
export function placeNew(area, frames, aspect, gap) {
  for (const frac of [0.5, 0.4, 0.3, 0.22]) {
    let w = area.w * frac;
    let h = w / aspect;
    if (h > area.h) {
      h = area.h * frac * 1.6;
      w = h * aspect;
    }
    for (let y = area.y; y + h <= area.y + area.h + 1e-6; y += 2) {
      for (let x = area.x; x + w <= area.x + area.w + 1e-6; x += 2) {
        const padded = { x: x - gap, y: y - gap, w: w + 2 * gap, h: h + 2 * gap };
        if (!frames.some((f) => overlaps(padded, f))) return { x: r2(x), y: r2(y), w: r2(w), h: r2(h) };
      }
    }
  }
  const w = area.w * 0.4;
  const h = w / aspect;
  return { x: r2(area.x + (area.w - w) / 2), y: r2(area.y + (area.h - h) / 2), w: r2(w), h: r2(h) };
}

// ---- パネル編集画面(E2b)の操作。どれも配置物(パネル)を受け取り、新しい配置物を返す ----

// 自動で並べる: いま見えている範囲(切り抜き)のまま、縦横比を保って敷き詰める。panel: パネルの大きさ { w, h }(mm)
export function arrangePanel(spec, item, panel, sizes) {
  const area = photoArea(spec, item, panel.w, panel.h);
  const aspects = item.photos.map((ph) => (sizes.has(ph.src) ? aspectOf(ph, sizes.get(ph.src)) : ph.w / ph.h));
  const frames = autoLayout(aspects, area, spec.panel.gap);
  return { ...item, photos: item.photos.map((ph, k) => ({ ...ph, ...frames[k] })) };
}

// 写真全体を見せる枠で、ほかの写真と重ならない所に足す。size: 元の写真の大きさ { w, h }(px)
export function withNewPhoto(spec, item, src, size, panel) {
  const photos = item.photos ?? [];
  const frame = placeNew(photoArea(spec, item, panel.w, panel.h), photos, size.w / size.h, spec.panel.gap);
  const out = { ...item, photos: [...photos, { src, ...frame, crop: [0, 0, 1, 1] }] };
  delete out.rows;
  return out;
}

export function updatePhoto(item, n, patch) {
  return { ...item, photos: item.photos.map((ph, k) => (k === n ? { ...ph, ...patch } : ph)) };
}

export function removePhotoAt(item, n) {
  return { ...item, photos: item.photos.filter((_, k) => k !== n) };
}

// 重なりの順番を変える。to: +1 手前へ、-1 奥へ。戻り値の index は動かした写真の新しい番号
export function restack(item, n, to) {
  const j = clamp(n + to, 0, item.photos.length - 1);
  if (j === n) return { item, index: n };
  const photos = [...item.photos];
  const [ph] = photos.splice(n, 1);
  photos.splice(j, 0, ph);
  return { item: { ...item, photos }, index: j };
}

// 切り抜きの比率の選択肢(写真の上での 幅/高さ。null は自由)
export const CROP_RATIOS = [
  ['free', '自由', null],
  ['4:3', '横 4:3', 4 / 3],
  ['3:2', '横 3:2', 3 / 2],
  ['1:1', '正方形 1:1', 1],
  ['3:4', '縦 3:4', 3 / 4],
  ['2:3', '縦 2:3', 2 / 3],
];

// 切り抜きを比率 ratio に合わせる。中心と面積をなるべく保ち、写真からはみ出さないように縮める
export function cropToRatio(crop, size, ratio) {
  const [cx, cy, cw, ch] = crop;
  const k = (ratio * size.h) / size.w;   // 0〜1 の座標での 幅/高さ
  let w = Math.sqrt(cw * ch * k);
  let h = w / k;
  const s = Math.min(1, 1 / w, 1 / h);
  w *= s;
  h *= s;
  return [clamp(cx + cw / 2 - w / 2, 0, 1 - w), clamp(cy + ch / 2 - h / 2, 0, 1 - h), w, h].map(r4);
}

// 切り抜きを動かす(写真の外には出さない)。dx・dy は 0〜1 の座標
export function moveCrop(crop, dx, dy) {
  const [cx, cy, cw, ch] = crop;
  return [clamp(cx + dx, 0, 1 - cw), clamp(cy + dy, 0, 1 - ch), cw, ch].map(r4);
}

// 切り抜きの角か辺をドラッグする。handle: n・s・e・w・ne・nw・se・sw、p: ポインタ(0〜1 の座標)。
// ratio があれば比率を保つ(角だけ。辺は比率が自由のときだけ動かせる)。min: いちばん小さい幅・高さ(0〜1)
export function resizeCrop(crop, handle, p, ratio, size, min = 0.05) {
  const [cx, cy, cw, ch] = crop;
  const corner = handle.length === 2;
  if (!corner && ratio) return crop;
  // 動かない側の端
  const ax = handle.includes('w') ? cx + cw : cx;
  const ay = handle.includes('n') ? cy + ch : cy;
  const sx = handle.includes('w') ? -1 : 1;
  const sy = handle.includes('n') ? -1 : 1;
  const roomX = sx > 0 ? 1 - ax : ax;
  const roomY = sy > 0 ? 1 - ay : ay;
  let w = cw;
  let h = ch;
  if (ratio) {
    const k = (ratio * size.h) / size.w;
    const maxW = Math.min(roomX, roomY * k);
    w = clamp(Math.max(sx * (p.x - ax), sy * (p.y - ay) * k), Math.min(min, maxW), maxW);
    h = w / k;
  } else {
    if (handle.includes('e') || handle.includes('w')) w = clamp(sx * (p.x - ax), Math.min(min, roomX), roomX);
    if (handle.includes('n') || handle.includes('s')) h = clamp(sy * (p.y - ay), Math.min(min, roomY), roomY);
  }
  const x = handle.includes('e') || handle.includes('w') ? (sx > 0 ? ax : ax - w) : cx;
  const y = handle.includes('n') || handle.includes('s') ? (sy > 0 ? ay : ay - h) : cy;
  return [x, y, w, h].map(r4);
}

// 切り抜きを変えたときの枠。写真の縮尺はそのままにして(切り落とした分だけ枠が小さくなる。Word の切り抜きと同じ)、
// 枠の中心は動かさない。写真の範囲からはみ出すときは、範囲に収まるよう縮めて寄せる。size: 元の写真の大きさ(px)
export function reframeCrop(frame, oldCrop, newCrop, size, area) {
  const mmPerPx = Math.sqrt((frame.w * frame.h) / (oldCrop[2] * size.w * oldCrop[3] * size.h));
  let w = newCrop[2] * size.w * mmPerPx;
  let h = newCrop[3] * size.h * mmPerPx;
  const s = Math.min(1, area.w / w, area.h / h);
  w *= s;
  h *= s;
  const x = clamp(frame.x + frame.w / 2 - w / 2, area.x, area.x + area.w - w);
  const y = clamp(frame.y + frame.h / 2 - h / 2, area.y, area.y + area.h - h);
  return { x: r2(x), y: r2(y), w: r2(w), h: r2(h) };
}
