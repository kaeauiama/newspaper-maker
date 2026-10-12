// 配置物の位置計算と、本文を流すスロットの計算。すべて純粋関数。
//
// 配置物は「段に揃った長方形」: 縦は段の範囲 dan: [始め, 終わり]、横は次のどれかで指定する。
//   right: 版面の右端からの距離(mm) と width
//   left:  版面の左端からの距離(mm) と width
//   x: [左端, 右端](ページ左端からの mm)
// 段の途中まで張り出す枠は、縦をさらに字数で書く(docs/05-proposals.md 2-1):
//   from: 始めの段の上端から何字下で始まるか(枠の上に from 字の行が残る)
//   to:   終わりの段の上端から何字ぶんで終わるか(枠の下に 1行の字数 − to 字の行が残る)
// スロット = 各段から、段を上から下まで覆う配置物の横範囲を引いた残り。読む順(段1→段n、各段は右→左)に並べる。
// 段の一部だけを覆う配置物はスロットを分けず、スロットの excl に「上(下)から何 mm を避けるか」を記録する。

import { contentBox, danTop, danBottom, danHeight, linePitch, charPitch } from './spec.js';

// 枠の上に from 字の行をちょうど入れるための、わずかな余裕(mm)。これがないと計算の誤差で1字減ることがある
const FIT_SLACK = 0.1;

export function resolveX(spec, item) {
  const box = contentBox(spec);
  if (Array.isArray(item.x)) return [item.x[0], item.x[1]];
  const width = item.width ?? box.right - box.left;
  if (item.left != null) return [box.left + item.left, box.left + item.left + width];
  const right = item.right ?? 0;
  return [box.right - right - width, box.right - right];
}

// 配置物の縦の範囲 [上端, 下端](mm)。枠と本文の間は、横と同じく wrapGap だけ空ける
export function itemY(spec, item) {
  const ch = charPitch(spec);
  const top = item.from ? danTop(spec, item.dan[0]) + item.from * ch + spec.wrapGap : danTop(spec, item.dan[0]);
  const bottom = item.to ? danTop(spec, item.dan[1]) + item.to * ch - spec.wrapGap : danBottom(spec, item.dan[1]);
  return [top, bottom];
}

export function itemRect(spec, item) {
  const [left, right] = resolveX(spec, item);
  const [top, bottom] = itemY(spec, item);
  return { left, right, top, bottom };
}

// 配置物が段 d をどう覆うか: 'full'(上から下まで)・'top'(上の一部)・'bottom'(下の一部)・null(覆わない)。
// 1つの段の中で上下とも途中(段の真ん中に浮いている)は検査でエラーにする。本文は段ごと避けておく
export function coverage(item, d) {
  if (d < item.dan[0] || d > item.dan[1]) return null;
  const top = d === item.dan[1] && !!item.to;
  const bottom = d === item.dan[0] && !!item.from;
  if (top && !bottom) return 'top';
  if (bottom && !top) return 'bottom';
  return 'full';
}

// rects: [{ dan: [a, b], x: [左, 右], from?, to? }]
export function computeSlots(spec, rects) {
  const box = contentBox(spec);
  const pitch = linePitch(spec);
  const ch = charPitch(spec);
  const slots = [];
  for (let d = 1; d <= spec.dan.count; d++) {
    let free = [[box.left, box.right]];
    const partial = [];
    for (const r of rects) {
      const c = coverage(r, d);
      if (!c) continue;
      const a = r.x[0] - spec.wrapGap;
      const b = r.x[1] + spec.wrapGap;
      if (c === 'full') free = free.flatMap(([l, rr]) => (b <= l || a >= rr) ? [[l, rr]] : [[l, Math.min(a, rr)], [Math.max(b, l), rr]]);
      else partial.push({ edge: c, x0: a, x1: b, depth: c === 'top' ? r.to * ch : danHeight(spec) - r.from * ch - FIT_SLACK });
    }
    free
      .filter(([l, rr]) => rr - l >= pitch - 1e-6)
      .sort((p, q) => q[1] - p[1])
      .forEach(([l, rr], i) => {
        // このスロットにかかる「一部だけ覆う」範囲(スロットの中に切り詰める)
        const excl = partial
          .filter((q) => q.x1 > l + 1e-6 && q.x0 < rr - 1e-6)
          .map((q) => ({ edge: q.edge, x0: Math.max(q.x0, l), x1: Math.min(q.x1, rr), depth: q.depth }));
        slots.push({
          dan: d,
          index: i + 1,                                    // 段の中で右から何番目か
          left: l,
          right: rr,
          top: danTop(spec, d),
          height: danHeight(spec),
          lines: Math.floor((rr - l) / pitch + 1e-6),
          ...(excl.length ? { excl } : {}),
        });
      });
  }
  return slots;
}

// 全ページのスロット(読む順)に対して、各記事の開始位置から次の記事の開始位置の手前までを割り当てる。
// slots: [{ page, dan, index, ... }]、articles: [{ id, start: { page, dan, slot? } }](号の中の順)
// 戻り値: { ranges: [{ id, from, to }](to は含まない), errors: [{ code, message }] }
export function assignRanges(slots, articles) {
  const errors = [];
  const starts = articles.map((a) => {
    const s = a.start ?? { page: 1, dan: 1 };
    const at = slots.findIndex((x) => x.page === s.page && x.dan === s.dan && x.index === (s.slot ?? 1));
    if (at < 0) {
      errors.push({
        code: 'E_START_NOT_FOUND',
        message: `記事「${a.id}」の開始位置(${s.page}面 段${s.dan} スロット${s.slot ?? 1})に本文を流せる場所がありません。配置物で埋まっていないか確認してください。`,
      });
    }
    return at;
  });
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] >= 0 && starts[i - 1] >= 0 && starts[i] <= starts[i - 1]) {
      errors.push({
        code: 'E_START_ORDER',
        message: `記事「${articles[i].id}」の開始位置が、前の記事「${articles[i - 1].id}」より前にあります。記事は読む順に並べてください。`,
      });
    }
  }
  if (errors.length) return { ranges: [], errors };
  const ranges = articles.map((a, i) => ({ id: a.id, from: starts[i], to: i + 1 < starts.length ? starts[i + 1] : slots.length }));
  return { ranges, errors };
}

// 各スロットがどの記事のものかを決める。基本は assignRanges(開始位置から次の記事の手前まで)。
// そのうえで新聞の組み方に合わせ、見出しが複数の段をぶち抜いているとき、見出しの2段目以降で見出しより右にある
// スロットは、前の記事のものにする(記事は見出しの左から始まり、見出しの右は前の記事が続く)。
// この直しは、記事の開始位置が見出しの1段目・見出しの左にあるときだけ行う。
// titles: [{ article, page, dan: [a, b], left, right }](見出し枠の位置)
// 戻り値: { owners: [記事の番号 | -1](スロットごと), ranges, errors }
export function assignSlots(slots, articles, titles = []) {
  const { ranges, errors } = assignRanges(slots, articles);
  const owners = slots.map(() => -1);
  ranges.forEach((r, k) => { for (let i = r.from; i < r.to; i++) owners[i] = k; });
  const EPS = 0.5;
  ranges.forEach((r, k) => {
    if (k === 0 || r.from >= slots.length) return;
    const start = slots[r.from];
    const t = titles.find((x) => x.article === r.id && x.page === start.page && x.dan[0] === start.dan && x.dan[1] > x.dan[0] && start.right <= x.left + EPS);
    if (!t) return;
    slots.forEach((s, i) => {
      if (owners[i] === k && s.page === t.page && s.dan > t.dan[0] && s.dan <= t.dan[1] && s.left >= t.right - EPS) owners[i] = k - 1;
    });
  });
  return { owners, ranges, errors };
}

// 段間罫: 段と段のあいだの中央に引く細い罫。上下の段にまたがる配置物のところは切る。
// rects: [{ dan: [a, b], x: [左, 右] }]  戻り値: [{ y, left, right }](mm)
export function danRules(spec, rects) {
  const box = contentBox(spec);
  const rules = [];
  for (let d = 1; d < spec.dan.count; d++) {
    const y = (danBottom(spec, d) + danTop(spec, d + 1)) / 2;
    let segs = [[box.left, box.right]];
    for (const r of rects) {
      if (!(r.dan[0] <= d && r.dan[1] >= d + 1)) continue;
      const a = r.x[0] - spec.danRule.inset;
      const b = r.x[1] + spec.danRule.inset;
      segs = segs.flatMap(([l, rr]) => (b <= l || a >= rr) ? [[l, rr]] : [[l, Math.min(a, rr)], [Math.max(b, l), rr]]);
    }
    for (const [l, rr] of segs) if (rr - l >= spec.danRule.minLength) rules.push({ y, left: l, right: rr });
  }
  return rules;
}

// どの記事にも割り当てられていないスロット(本文が入らず空白になる)。owners は assignSlots の戻り値
export function unassignedSlots(slots, owners) {
  return slots.filter((_, i) => owners[i] < 0);
}
