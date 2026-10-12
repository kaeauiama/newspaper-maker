// パネル編集画面の吸着(docs/05-proposals.md 2-3)。純粋関数。
// 枠 { x, y, w, h } はパネルの左上からの mm。area は写真を置ける範囲(photoArea)。
//
// 吸い付く先(縦の線・横の線それぞれ):
// - 写真の範囲の端と中心線
// - ほかの写真の端(そろえる)、端から間隔 gap だけ離れた位置(並べる)、中心
// tol は吸い付く距離(mm)。画面の拡大率に合わせて呼ぶ側が決める。

const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const AXES = { x: ['x', 'w'], y: ['y', 'h'] };

// 枠の始めの端・終わりの端・中心が吸い付く先
function targets(area, others, gap, axis) {
  const [pos, size] = AXES[axis];
  const start = [area[pos]];
  const end = [area[pos] + area[size]];
  const mid = [area[pos] + area[size] / 2];
  for (const o of others) {
    const a = o[pos];
    const b = o[pos] + o[size];
    start.push(a, b + gap);
    end.push(b, a - gap);
    mid.push((a + b) / 2);
  }
  return { start, end, mid };
}

// 枠がいま何かにそろっている線(ガイドとして描く)。{ axis: 'x' | 'y', at: mm }
export function alignedGuides(frame, others, area, gap, eps = 0.02) {
  const guides = [];
  for (const axis of ['x', 'y']) {
    const [pos, size] = AXES[axis];
    const t = targets(area, others, gap, axis);
    const edges = [[frame[pos], t.start], [frame[pos] + frame[size], t.end], [frame[pos] + frame[size] / 2, t.mid]];
    for (const [v, list] of edges) {
      if (list.some((u) => Math.abs(u - v) <= eps) && !guides.some((g) => g.axis === axis && Math.abs(g.at - v) <= eps)) guides.push({ axis, at: r2(v) });
    }
  }
  return guides;
}

// 動かす: 縦・横それぞれ、いちばん近い吸い付く先へ寄せてから、範囲の内側に収める
export function snapPhotoMove(frame, others, area, gap, tol) {
  const out = { ...frame };
  for (const axis of ['x', 'y']) {
    const [pos, size] = AXES[axis];
    const t = targets(area, others, gap, axis);
    let best = null;
    const near = (v, list) => {
      for (const u of list) if (Math.abs(u - v) <= tol && (!best || Math.abs(u - v) < Math.abs(best))) best = u - v;
    };
    near(frame[pos], t.start);
    near(frame[pos] + frame[size], t.end);
    near(frame[pos] + frame[size] / 2, t.mid);
    if (best != null) out[pos] = frame[pos] + best;
    out[pos] = r2(clamp(out[pos], area[pos], area[pos] + area[size] - out[size]));
  }
  return { frame: out, guides: alignedGuides(out, others, area, gap) };
}

// 角の取っ手で大きさを変える(縦横比は保つ)。corner: nw・ne・sw・se、p: ポインタ(mm)、aspect: 幅/高さ。
// 動く2辺のうち、吸い付く先に近いほうに合わせる。範囲からはみ出さず、幅 minW より小さくしない
export function snapPhotoResize(frame, corner, p, aspect, others, area, gap, tol, minW = 5) {
  const ax = corner.includes('w') ? frame.x + frame.w : frame.x;
  const ay = corner.includes('n') ? frame.y + frame.h : frame.y;
  const sx = corner.includes('w') ? -1 : 1;
  const sy = corner.includes('n') ? -1 : 1;
  let w = Math.max(sx * (p.x - ax), sy * (p.y - ay) * aspect);
  const tx = targets(area, others, gap, 'x');
  const ty = targets(area, others, gap, 'y');
  let best = null;
  for (const u of sx > 0 ? tx.end : tx.start) {
    const w2 = sx * (u - ax);
    const d = Math.abs(w2 - w);
    if (w2 > 0 && d <= tol && (!best || d < best.d)) best = { d, w: w2 };
  }
  for (const u of sy > 0 ? ty.end : ty.start) {
    const w2 = sy * (u - ay) * aspect;
    const d = Math.abs(w2 - w) / aspect;   // 動く辺どうしの距離(mm)で比べる
    if (w2 > 0 && d <= tol && (!best || d < best.d)) best = { d, w: w2 };
  }
  if (best) w = best.w;
  const roomX = sx > 0 ? area.x + area.w - ax : ax - area.x;
  const roomY = sy > 0 ? area.y + area.h - ay : ay - area.y;
  const maxW = Math.min(roomX, roomY * aspect);
  w = clamp(w, Math.min(minW, maxW), maxW);
  const h = w / aspect;
  const out = { x: r2(sx > 0 ? ax : ax - w), y: r2(sy > 0 ? ay : ay - h), w: r2(w), h: r2(h) };
  return { frame: out, guides: alignedGuides(out, others, area, gap) };
}
