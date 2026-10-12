// 収める手伝い(docs/04-editor.md)。記事があふれた(後ろが空きすぎた)ときの直し方の候補を作る。純粋関数。
// 候補は「号の設定を少しだけ変えたもの」。本当に効くかは、エディタが試しに組んで確かめてから出す。

import { linePitch, charsPerLine } from '../engine/spec.js';
import { snapResizeLeft, snapResizeRight, snapMove } from './snap.js';
import { rectOf, setGeometry, setArticleStart } from './model.js';

function kindName(item) {
  if (item.type === 'panel') return item.table ? '表' : '写真パネル';
  return { box: '囲み記事', title: '見出し枠', lead: 'リード' }[item.type] ?? '配置物';
}

const danName = (dan) => (dan[0] === dan[1] ? `段${dan[0]}` : `段${dan[0]}〜${dan[1]}`);

// result: いまの組版の結果(articles・slots)。戻り値: [{ label, issue, cost }] を cost(変える量)の小さい順に
export function fitCandidates(spec, issue, result, articleId) {
  const art = result.articles.find((a) => a.id === articleId);
  if (!art) return [];
  const over = art.overflowChars > 0;
  const pitch = linePitch(spec);
  const cpl = charsPerLine(spec);
  const out = [];
  const add = (label, r, cost) => { if (r && !r.error && r.issue !== issue) out.push({ label, issue: r.issue ?? r, cost }); };

  // 1. 記事が流れるページの配置物を、狭く(あふれ)・広く(空きすぎ)する、横へずらす、上か下を縮める(あふれ)
  const pages = [...new Set(art.boxes.map((b) => b.page - 1))];
  for (const p of pages) {
    (issue.pages[p]?.items ?? []).forEach((item, i) => {
      if ((item.type === 'title' || item.type === 'lead') && item.article !== articleId) return;   // ほかの記事の見出し・リードは触らない
      const r = rectOf(spec, item);
      const name = `${p + 1}面の${kindName(item)}(${danName(r.dan)})`;
      for (const lines of [1, 2, 3]) {
        const d = (over ? 1 : -1) * lines * pitch;
        const fromLeft = { ...r, ...snapResizeLeft(spec, r, r.left + d) };
        const fromRight = { ...r, ...snapResizeRight(spec, r, r.right - d) };
        const verb = over ? '狭く' : '広く';
        if (fromLeft.left !== r.left) add(`${name}を左から${lines}行${verb}する`, setGeometry(spec, issue, p, i, fromLeft), lines);
        if (fromRight.right !== r.right) add(`${name}を右から${lines}行${verb}する`, setGeometry(spec, issue, p, i, fromRight), lines);
      }
      for (const lines of [1, 2]) {
        for (const dir of [-1, 1]) {
          const moved = { ...r, ...snapMove(spec, r, dir * lines * pitch) };
          if (moved.left !== r.left) add(`${name}を${dir < 0 ? '左' : '右'}へ${lines}行ずらす`, setGeometry(spec, issue, p, i, moved), lines + 0.5);
        }
      }
      // 上か下を字数で縮める(段をまたぐ配置物だけ。段の真ん中に浮かせない)
      if (over && r.dan[1] > r.dan[0]) {
        for (const chars of [3, 6]) {
          if (!r.to) add(`${name}の下を${chars}字縮める`, setGeometry(spec, issue, p, i, { ...r, to: cpl - chars }), 1 + chars / 3);
          if (!r.from) add(`${name}の上を${chars}字縮める`, setGeometry(spec, issue, p, i, { ...r, from: chars }), 1 + chars / 3);
        }
      }
    });
  }

  // 2. 記事の始まりを1枠ずらす(スロットの読む順で)
  const slots = result.slots ?? [];
  const at = (a) => {
    const s = a.start ?? { page: 1, dan: 1 };
    return slots.findIndex((x) => x.page === s.page && x.dan === s.dan && x.index === (s.slot ?? 1));
  };
  const toStart = (s) => ({ page: s.page, dan: s.dan, slot: s.index });
  const k = issue.articles.findIndex((a) => a.id === articleId);
  const next = issue.articles[k + 1];
  const prev = k > 0 ? issue.articles[k - 1] : null;
  if (next) {
    const i = at(next);
    const j = i + (over ? 1 : -1);
    if (i >= 0 && slots[j]) add(`次の記事「${next.id}」の始まりを1枠${over ? '後ろ' : '前'}へ`, setArticleStart(issue, next.id, toStart(slots[j])), 1);
  }
  if (over && prev) {
    const i = at(issue.articles[k]);
    if (i > 0) add(`この記事の始まりを1枠前へ(前の記事「${prev.id}」の後ろを使う)`, setArticleStart(issue, articleId, toStart(slots[i - 1])), 1);
  }
  return out.sort((a, b) => a.cost - b.cost);
}

// 試しに組んだ結果から、その直し方が効いたか。効いたら { fixed, emptyLines } を返す
// base: いまの結果、trial: 直し方を当てて組んだ結果
export function judgeFit(base, trial, articleId, underfullLines) {
  const a = trial.articles.find((x) => x.id === articleId);
  const was = base.articles.find((x) => x.id === articleId);
  if (!a || !was) return null;
  const over = was.overflowChars > 0;
  const fixed = over ? a.overflowChars === 0 : a.emptyLines <= underfullLines;
  if (!fixed) return null;
  // ほかの記事やほかの所を悪くしない: この記事のあふれを除いたエラーの数、ほかの記事の「空きすぎ」の数が増えない
  const errs = (r) => r.errors.filter((e) => !(e.code === 'E_ARTICLE_OVERFLOW' && e.message.includes(`「${articleId}」`))).length;
  const loose = (r) => r.articles.filter((x) => x.id !== articleId && x.emptyLines > underfullLines).length;
  const warns = (r) => r.warnings.filter((w) => w.code !== 'W_ARTICLE_UNDERFULL').length;   // 見出しが入らない、写真が粗くなる、など
  if (errs(trial) > errs(base) || loose(trial) > loose(base) || warns(trial) > warns(base)) return null;
  return { emptyLines: a.emptyLines };
}
