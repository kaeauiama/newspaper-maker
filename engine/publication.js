// 紙名の設定(publication.jsonc)。紙名・PDF のファイル名・刷る前に確認していただく人・題字。
// 号のフォルダの1つ上(ワークスペース)に置き、そこにある号すべてで共通に使う。書き方は docs/02-input-format.md「紙名の設定」。
// 題字の中身(画像・文字・線)の位置と大きさは、題字の枠の内側の左上からの mm。純粋関数(ブラウザと Node の両方で使う)。

import { danTop, danBottom } from './spec.js';
import { parseJsonc } from './jsonc.js';

export const PUBLICATION_FILE = 'publication.jsonc';

export const RULE_WIDTH = 0.3;   // 題字のまわりの罫と、題字の中の線の太さ(mm)

// 題字の文字に使える書体(型の書体。newsletter.css の :root)
export const MASTHEAD_FONTS = {
  mincho: { label: '明朝', css: 'var(--mincho)' },
  gothic: { label: 'ゴシック', css: 'var(--gothic)' },
  gyosho: { label: '行書', css: 'var(--gyosho)' },
  'headline-mincho': { label: '見出しの明朝', css: 'var(--headline-mincho)' },
  'headline-gothic': { label: '見出しのゴシック', css: 'var(--headline-gothic)' },
};
export const MASTHEAD_WEIGHTS = [400, 600, 700];
export const MASTHEAD_ALIGNS = ['start', 'center', 'end', 'justify'];   // justify は均等割り付け(行ごと)
export const MASTHEAD_ITEM_TYPES = ['image', 'text', 'rule'];
const FILE_NAME = /^[A-Za-z0-9_-]{1,40}$/;

// 題字の枠の内側の大きさ(mm)。まわりの罫があれば、その太さの分だけ小さい
export function mastheadInner(spec, frame = true) {
  const b = frame ? 2 * RULE_WIDTH : 0;
  return { w: spec.masthead.width - b, h: danBottom(spec, spec.masthead.dan[1]) - danTop(spec, spec.masthead.dan[0]) - b };
}

// 紙名の設定がないときの仮の設定。題字は紙名を縦に大きく書く
export function defaultPublication(spec, name = '機関紙') {
  const inner = mastheadInner(spec, true);
  const n = Math.max(1, [...name].length);
  const sizeMm = Math.min(18, (inner.h - 16) / n);
  const size = Math.round((sizeMm * 72) / 25.4);
  return {
    name,
    fileName: 'kikanshi',
    approver: '発行責任者',
    masthead: {
      frame: true,
      items: [
        { type: 'text', text: name, dir: 'vertical', font: 'mincho', weight: 700, size, align: 'center', lineHeight: 1,
          x: +((inner.w - sizeMm) / 2).toFixed(3), y: 8, w: +sizeMm.toFixed(3), h: +(inner.h - 16).toFixed(3) },
      ],
    },
  };
}

const num = (v) => typeof v === 'number' && Number.isFinite(v);

// publication.jsonc の中身(なければ null)を読み、検査して既定値で埋める。
// ないときは仮の設定で組み、そのことを警告で知らせる。読めない・誤りがあるときも仮の設定で組み、理由をエラーで返す
export function loadPublication(text, spec) {
  if (text == null) {
    return {
      publication: defaultPublication(spec),
      errors: [],
      warnings: [{ code: 'W_PUB_MISSING', message: `紙名の設定(${PUBLICATION_FILE})が号のフォルダの1つ上にないので、仮の紙名と題字で組んでいます。` }],
    };
  }
  let raw;
  try {
    raw = parseJsonc(text);
  } catch (e) {
    return { publication: defaultPublication(spec), errors: [{ code: 'E_PUB_SYNTAX', message: `紙名の設定(${PUBLICATION_FILE})を読めません: ${e.message}` }], warnings: [] };
  }
  const v = validatePublication(raw, spec);
  return { publication: v.publication ?? defaultPublication(spec), errors: v.errors, warnings: v.warnings, raw };
}

// 検査。問題は理由コードつきで返し、黙って直さない。publication は既定値で埋めたもの(エラーがあれば null)
export function validatePublication(pub, spec) {
  const errors = [];
  const warnings = [];
  const err = (code, message) => errors.push({ code, message });
  const warn = (code, message) => warnings.push({ code, message });
  if (!pub || typeof pub !== 'object' || Array.isArray(pub)) {
    err('E_PUB_SYNTAX', '紙名の設定(publication.jsonc)は { … } の形で書いてください。');
    return { errors, warnings, publication: null };
  }
  if (typeof pub.name !== 'string' || !pub.name.trim()) err('E_PUB_NAME', '紙名の設定: name(紙名)を書いてください。');
  if (pub.fileName != null && !(typeof pub.fileName === 'string' && FILE_NAME.test(pub.fileName))) {
    err('E_PUB_FILE_NAME', '紙名の設定: fileName(PDF のファイル名の頭)は半角の英数字と - _ で、40字までにしてください。');
  }
  if (pub.approver != null && typeof pub.approver !== 'string') err('E_PUB_APPROVER', '紙名の設定: approver(刷る前に確認していただく人)は文字で書いてください。');
  const m = pub.masthead ?? {};
  if (typeof m !== 'object' || Array.isArray(m)) err('E_PUB_MASTHEAD', '紙名の設定: masthead(題字)は { "frame": true, "items": [ … ] } の形で書いてください。');
  const items = Array.isArray(m.items) ? m.items : [];
  if (m.items != null && !Array.isArray(m.items)) err('E_PUB_MASTHEAD', '紙名の設定: masthead.items は [ … ] の形で書いてください。');
  const inner = mastheadInner(spec, m.frame !== false);
  items.forEach((it, i) => {
    const where = `題字の ${i + 1} 番目`;
    if (!it || !MASTHEAD_ITEM_TYPES.includes(it.type)) {
      err('E_MASTHEAD_TYPE', `${where}: type は image・text・rule のどれかにしてください。`);
      return;
    }
    if (![it.x, it.y].every(num) || (it.type !== 'rule' && !([it.w, it.h].every(num) && it.w > 0 && it.h > 0))) {
      err('E_MASTHEAD_RECT', `${where}: x・y・w・h(mm)を数で書いてください(w・h は 0 より大きく)。`);
      return;
    }
    if (it.type === 'rule' && !(num(it.w ?? 0) && num(it.h ?? 0) && ((it.w ?? 0) > 0) !== ((it.h ?? 0) > 0))) {
      err('E_MASTHEAD_RECT', `${where}: 線は、横線なら w、縦線なら h のどちらか一方に長さ(mm)を書いてください。`);
      return;
    }
    if (it.type === 'image' && !(typeof it.src === 'string' && it.src.trim())) err('E_MASTHEAD_IMAGE', `${where}: src(画像のファイル。例: brand/logo.jpg)を書いてください。`);
    if (it.type === 'text') {
      if (typeof it.text !== 'string') err('E_MASTHEAD_TEXT', `${where}: text(文字)を書いてください。`);
      if (it.font != null && !MASTHEAD_FONTS[it.font]) err('E_MASTHEAD_TEXT', `${where}: font は ${Object.keys(MASTHEAD_FONTS).join('・')} のどれかにしてください。`);
      if (it.size != null && !(num(it.size) && it.size >= 4 && it.size <= 160)) err('E_MASTHEAD_TEXT', `${where}: size(文字の大きさ)は 4〜160(pt)にしてください。`);
      if (it.weight != null && !MASTHEAD_WEIGHTS.includes(it.weight)) err('E_MASTHEAD_TEXT', `${where}: weight は ${MASTHEAD_WEIGHTS.join('・')} のどれかにしてください。`);
      if (it.align != null && !MASTHEAD_ALIGNS.includes(it.align)) err('E_MASTHEAD_TEXT', `${where}: align は start・center・end・justify のどれかにしてください。`);
      if (it.dir != null && !['vertical', 'horizontal'].includes(it.dir)) err('E_MASTHEAD_TEXT', `${where}: dir は vertical か horizontal にしてください。`);
      if (it.lineHeight != null && !(num(it.lineHeight) && it.lineHeight >= 0.8 && it.lineHeight <= 3)) err('E_MASTHEAD_TEXT', `${where}: lineHeight(行の間隔)は 0.8〜3 にしてください。`);
    }
    const w = it.type === 'rule' ? (it.w ?? 0) : it.w;
    const h = it.type === 'rule' ? (it.h ?? 0) : it.h;
    const eps = 0.05;
    if (it.x < -eps || it.y < -eps || it.x + w > inner.w + eps || it.y + h > inner.h + eps) {
      warn('W_MASTHEAD_OUTSIDE', `${where}が題字の枠からはみ出しています(枠の内側は 幅 ${inner.w.toFixed(1)}mm × 高さ ${inner.h.toFixed(1)}mm)。`);
    }
  });
  if (errors.length) return { errors, warnings, publication: null };
  return {
    errors,
    warnings,
    publication: {
      name: pub.name.trim(),
      fileName: pub.fileName ?? 'kikanshi',
      approver: (pub.approver ?? '').trim() || '発行責任者',
      masthead: { frame: m.frame !== false, items },
    },
  };
}
