// エディタの吸着の規則。純粋関数(docs/04-editor.md「マス目」)。
//
// 縦は段単位(動かすとき)と、段の中の字のマス目(上端・下端を引っぱるとき)。
// 横は版面の右端から行送りごとに引いた線(g0 = 右端、g1 = 右端 − 行送り、…)を使い、
//   配置物の右端 → 線 − 間隔(wrapGap)   … その右側の本文の枠がちょうど整数行になる
//   配置物の左端 → 線 + 間隔(wrapGap)   … 左隣の配置物との間の枠も整数行になる
// に吸着させる。版面の左右の端にも吸着する。

import { contentBox, linePitch, danTop, danBottom, charPitch, charsPerLine } from '../engine/spec.js';

export const round2 = (v) => Math.round(v * 100) / 100;

export function rightStops(spec) {
  const { left: L, right: R } = contentBox(spec);
  const p = linePitch(spec);
  const stops = [R];
  for (let k = 1; R - k * p - spec.wrapGap > L + 1e-6; k++) stops.push(R - k * p - spec.wrapGap);
  return stops;
}

export function leftStops(spec) {
  const { left: L, right: R } = contentBox(spec);
  const p = linePitch(spec);
  const stops = [L];
  for (let k = 1; R - k * p + spec.wrapGap > L + 1e-6; k++) stops.push(R - k * p + spec.wrapGap);
  return stops;
}

const nearest = (stops, x) => stops.reduce((best, s) => (Math.abs(s - x) < Math.abs(best - x) ? s : best), stops[0]);

// いちばん狭い配置物の幅(1行ぶん)
export const minWidth = (spec) => linePitch(spec) - 2 * spec.wrapGap;

// 幅を保ったまま横に動かす。右端・左端のどちらかをマス目に合わせ、元の位置からのずれが小さいほうを採る。
export function snapMove(spec, rect, dx) {
  const { left: L, right: R } = contentBox(spec);
  const w = rect.right - rect.left;
  const byRight = nearest(rightStops(spec), rect.right + dx);
  const byLeft = nearest(leftStops(spec), rect.left + dx);
  const cands = [
    { left: byRight - w, right: byRight },
    { left: byLeft, right: byLeft + w },
  ].filter((c) => c.left >= L - 1e-6 && c.right <= R + 1e-6);
  if (!cands.length) return { left: rect.left, right: rect.right };
  const target = rect.left + dx;
  cands.sort((a, b) => Math.abs(a.left - target) - Math.abs(b.left - target));
  return { left: round2(cands[0].left), right: round2(cands[0].right) };
}

// 左端を動かして幅を変える(右端は固定)
export function snapResizeLeft(spec, rect, rawLeft) {
  const stops = leftStops(spec).filter((s) => rect.right - s >= minWidth(spec) - 1e-6);
  if (!stops.length) return { ...rect };
  return { left: round2(nearest(stops, rawLeft)), right: rect.right };
}

// 右端を動かして幅を変える(左端は固定)
export function snapResizeRight(spec, rect, rawRight) {
  const stops = rightStops(spec).filter((s) => s - rect.left >= minWidth(spec) - 1e-6);
  if (!stops.length) return { ...rect };
  return { left: rect.left, right: round2(nearest(stops, rawRight)) };
}

// 段の範囲を丸ごとずらす(はみ出さないように止める)
export function shiftDan(spec, dan, delta) {
  const d = Math.max(1 - dan[0], Math.min(spec.dan.count - dan[1], delta));
  return [dan[0] + d, dan[1] + d];
}

// 段の範囲の片端を動かす
export function resizeDan(spec, dan, edge, delta) {
  if (edge === 'start') return [Math.max(1, Math.min(dan[1], dan[0] + delta)), dan[1]];
  return [dan[0], Math.max(dan[0], Math.min(spec.dan.count, dan[1] + delta))];
}

// ---- 縦: 段の中の字のマス目(段の途中まで張り出す枠。docs/05-proposals.md 2-1) ----
//
// 上端の置き場所: 段の上端、または上端から k 字下(k = 1〜1行の字数−1。枠の上に k 字の行が残る)
// 下端の置き場所: 段の下端、または上端から k 字ぶん(枠の下に 1行の字数−k 字の行が残る)
// 1つの段の中で上下とも途中には置かない(段の真ん中に浮かせない)。y は枠の端の位置(mm)

function bottomStops(spec, rect) {
  const ch = charPitch(spec);
  const stops = [];
  for (let d = rect.dan[0]; d <= spec.dan.count; d++) {
    if (!(d === rect.dan[0] && rect.from)) {
      for (let k = 1; k < charsPerLine(spec); k++) stops.push({ d, k, y: danTop(spec, d) + k * ch - spec.wrapGap });
    }
    stops.push({ d, k: null, y: danBottom(spec, d) });
  }
  return stops;
}

function topStops(spec, rect) {
  const ch = charPitch(spec);
  const stops = [];
  for (let d = 1; d <= rect.dan[1]; d++) {
    stops.push({ d, k: null, y: danTop(spec, d) });
    if (!(d === rect.dan[1] && rect.to)) {
      for (let k = 1; k < charsPerLine(spec); k++) stops.push({ d, k, y: danTop(spec, d) + k * ch + spec.wrapGap });
    }
  }
  return stops;
}

const withEdge = (rect, edge, s) => {
  const out = { dan: edge === 'b' ? [rect.dan[0], s.d] : [s.d, rect.dan[1]] };
  const from = edge === 't' ? s.k : rect.from;
  const to = edge === 'b' ? s.k : rect.to;
  if (from) out.from = from;
  if (to) out.to = to;
  return out;
};

// 下端(edge 'b')か上端(edge 't')を、y(mm)にいちばん近い置き場所へ吸着させる。戻り値は { dan, from?, to? }
export function snapEdgeY(spec, rect, edge, y) {
  const stops = edge === 'b' ? bottomStops(spec, rect) : topStops(spec, rect);
  const s = stops.reduce((best, c) => (Math.abs(c.y - y) < Math.abs(best.y - y) ? c : best), stops[0]);
  return withEdge(rect, edge, s);
}

// 下端を字のマス目で1つ動かす(Alt + ↑↓)。direction: +1 = 下へ、-1 = 上へ
export function stepEdgeY(spec, rect, direction) {
  const stops = bottomStops(spec, rect);
  const cur = stops.findIndex((s) => s.d === rect.dan[1] && (s.k ?? null) === (rect.to ?? null));
  const next = stops[cur + direction];
  return cur < 0 || !next ? withEdge(rect, 'b', { d: rect.dan[1], k: rect.to }) : withEdge(rect, 'b', next);
}

// 1行ぶん横に動かす(矢印キー)。direction: +1 = 右、-1 = 左
export function stepMove(spec, rect, direction) {
  return snapMove(spec, rect, direction * linePitch(spec));
}

// 左端を1行ぶん動かして幅を変える(Shift + 矢印キー)。direction: +1 = 狭く、-1 = 広く
export function stepResize(spec, rect, direction) {
  const next = snapResizeLeft(spec, rect, rect.left + direction * linePitch(spec));
  return next.left === rect.left ? rect : next;
}
