// 貼り付けた原稿を整える(docs/04-editor.md)。純粋関数。
// 直し方ごとに、何か所あるかと例を出し、選んだ直し方だけを当てる(黙って直さない)。

// 書き方の印で始まる行(見出し・リード・小見出し・メモ・箇条書き)は、前の行とつながない
const MARK = /^[\s　]*(#[ 　]|>|▼|\/\/|[・●○◆◇★☆◎※])/;
// 文の終わり。ここで改行している行は段落の終わりとみなす
const END = /[。．.！？!?」』）)】〕…‥・：:■]$/;
const EMOJI = /\p{Extended_Pictographic}️?/gu;

// 前後の文字を少し添えた例
function around(text, index, length, replaced) {
  const from = Math.max(0, index - 6);
  const to = Math.min(text.length, index + length + 6);
  const show = (s) => s.replace(/\n/g, '⏎');
  return { before: show(text.slice(from, to)), after: show(text.slice(from, index) + replaced + text.slice(index + length, to)) };
}

// 文字の置き換えで直すもの
function replacer(pattern, to) {
  return {
    find(text) {
      const hits = [];
      for (const m of text.matchAll(pattern)) hits.push(around(text, m.index, m[0].length, to(m[0])));
      return hits;
    },
    apply: (text) => text.replace(pattern, to),
  };
}

export const FIXES = [
  {
    id: 'join',
    label: '文の途中の改行をつなぐ(メールの折り返しや、PDF から写した文章の改行)',
    on: true,
    find(text) {
      const lines = text.split('\n');
      const hits = [];
      let pos = 0;
      for (let i = 0; i < lines.length - 1; i++) {
        const a = lines[i].replace(/[\s　]+$/, '');
        const b = lines[i + 1];
        if (a && b.trim() && !MARK.test(a) && !MARK.test(b) && !END.test(a)) {
          hits.push(around(text, pos + lines[i].length, 1, joinSpace(a, b)));
        }
        pos += lines[i].length + 1;
      }
      return hits;
    },
    apply(text) {
      const lines = text.split('\n');
      const out = [lines[0]];
      for (let i = 1; i < lines.length; i++) {
        const a = out[out.length - 1].replace(/[\s　]+$/, '');
        const b = lines[i];
        if (a && b.trim() && !MARK.test(a) && !MARK.test(b) && !END.test(a)) out[out.length - 1] = a + joinSpace(a, b) + b.replace(/^[\s　]+/, '');
        else out.push(b);
      }
      return out.join('\n');
    },
  },
  { id: 'kana', label: '半角カタカナを全角にする', on: true, ...replacer(/[｡-ﾟ]+/g, (m) => m.normalize('NFKC')) },
  { id: 'digits', label: '全角の数字を半角にする(2桁の数字が縦中横になるように)', on: true, ...replacer(/[０-９]+/g, (m) => m.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))) },
  { id: 'paren', label: '半角のかっこ ( ) を全角の（ ）にする(縦書きで正しい向きになるように)', on: true, ...replacer(/[()]/g, (m) => (m === '(' ? '（' : '）')) },
  { id: 'tilde', label: '半角の ~ を「〜」にする(3月22日~23日 など)', on: true, ...replacer(/~/g, () => '〜') },
  { id: 'dots', label: '「...」「・・・」「。。。」や1つだけの「…」を「……」にする', on: true, ...replacer(/\.{3,}|・{3,}|。{3,}|(?<!…)…(?!…)/g, () => '……') },
  { id: 'emoji', label: '絵文字を取り除く(印刷では色つきのまま出る)', on: false, ...replacer(EMOJI, () => '') },
];

// 英数字どうしをつなぐときは半角の空白を入れる(日本語どうしは入れない)
function joinSpace(a, b) {
  return /[A-Za-z0-9]$/.test(a) && /^[\s　]*[A-Za-z0-9]/.test(b) ? ' ' : '';
}

// 直し方ごとの見つかった数と例(最初の3つ)。見つからない直し方は返さない
export function analyze(text) {
  return FIXES.map((f) => {
    const hits = f.find(text);
    return { id: f.id, label: f.label, on: f.on, count: hits.length, examples: hits.slice(0, 3) };
  }).filter((x) => x.count > 0);
}

// 選んだ直し方を、上の並びの順に当てる
export function applyFixes(text, ids) {
  return FIXES.filter((f) => ids.includes(f.id)).reduce((t, f) => f.apply(t), text);
}
