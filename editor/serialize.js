// 号の設定(issue)を issue.jsonc の文字列にする。純粋関数。
// 配置物と記事は1行に1つ。座標で置いた写真(photos)は1枚1行。

const HEADER = '// 号の設定。紙面エディタ(npm run edit)で保存すると書き直され、コメントは消える。\n// 書き方は docs/02-input-format.md。\n';

function inlineValue(v) {
  if (Array.isArray(v)) return `[${v.map(inlineValue).join(', ')}]`;
  if (v && typeof v === 'object') return `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inlineValue(x)}`).join(', ')} }`;
  return JSON.stringify(v);
}

function itemLines(item, indent) {
  if (!Array.isArray(item.photos) || !item.photos.length) return [`${indent}${inlineValue(item)}`];
  const { photos, ...rest } = item;
  const head = inlineValue(rest).replace(/ \}$/, ',');
  return [
    `${indent}${head} "photos": [`,
    ...photos.map((ph, i) => `${indent}    ${inlineValue(ph)}${i < photos.length - 1 ? ',' : ''}`),
    `${indent}  ] }`,
  ];
}

export function serializeIssue(issue) {
  const { number, date, pages = [], articles = [], ...others } = issue;
  const out = ['{'];
  out.push(`  "number": ${JSON.stringify(number)},`);
  out.push(`  "date": ${JSON.stringify(date)},`);
  for (const [k, v] of Object.entries(others)) out.push(`  ${JSON.stringify(k)}: ${inlineValue(v)},`);
  out.push('  "pages": [');
  pages.forEach((page, p) => {
    const { template, items = [], ...rest } = page;
    out.push('    {');
    out.push(`      "template": ${JSON.stringify(template)},`);
    for (const [k, v] of Object.entries(rest)) out.push(`      ${JSON.stringify(k)}: ${inlineValue(v)},`);
    if (!items.length) out.push('      "items": []');
    else {
      out.push('      "items": [');
      items.forEach((item, i) => {
        const lines = itemLines(item, '        ');
        if (i < items.length - 1) lines[lines.length - 1] += ',';
        out.push(...lines);
      });
      out.push('      ]');
    }
    out.push(`    }${p < pages.length - 1 ? ',' : ''}`);
  });
  out.push('  ],');
  out.push('  "articles": [');
  articles.forEach((a, i) => out.push(`    ${inlineValue(a)}${i < articles.length - 1 ? ',' : ''}`));
  out.push('  ]');
  out.push('}');
  return `${HEADER}${out.join('\n')}\n`;
}

const PUB_HEADER = '// 紙名の設定(この号のフォルダを並べたフォルダで共通)。紙面エディタの「紙名と題字の設定」で保存すると書き直され、コメントは消える。\n// 書き方は docs/02-input-format.md「紙名の設定」。題字の中の位置と大きさは、題字の枠の内側の左上からの mm。\n';

// 紙名の設定(publication)を publication.jsonc の文字列にする。題字の部品は1行に1つ
export function serializePublication(pub) {
  const { name, fileName, approver, masthead = {}, ...others } = pub;
  const { frame = true, items = [], ...mrest } = masthead;
  const out = ['{'];
  out.push(`  "name": ${JSON.stringify(name)},`);
  if (fileName != null) out.push(`  "fileName": ${JSON.stringify(fileName)},`);
  if (approver != null) out.push(`  "approver": ${JSON.stringify(approver)},`);
  for (const [k, v] of Object.entries(others)) out.push(`  ${JSON.stringify(k)}: ${inlineValue(v)},`);
  out.push('  "masthead": {');
  for (const [k, v] of Object.entries(mrest)) out.push(`    ${JSON.stringify(k)}: ${inlineValue(v)},`);
  out.push(`    "frame": ${JSON.stringify(frame)},`);
  if (!items.length) out.push('    "items": []');
  else {
    out.push('    "items": [');
    items.forEach((it, i) => out.push(`      ${inlineValue(it)}${i < items.length - 1 ? ',' : ''}`));
    out.push('    ]');
  }
  out.push('  }');
  out.push('}');
  return `${PUB_HEADER}${out.join('\n')}\n`;
}
