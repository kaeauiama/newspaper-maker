// エントリ: page.html?issue=<号フォルダ(プロジェクトからの相対パス)>
//   build   … PDF 化のときに付ける(自動更新と検査結果の表示をしない)
//   debug   … 最初からスロットと段の枠を表示する(画面で d キーでも切り替え)

import { SPEC } from './spec.js';
import { parseJsonc } from './jsonc.js';
import { validateIssue } from './validate.js';
import { renderIssue } from './render.js';
import { loadPublication, PUBLICATION_FILE } from './publication.js';

const params = new URLSearchParams(location.search);
const issuePath = (params.get('issue') ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
const building = params.has('build');
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
const base = `/${enc(issuePath)}/`;
// 紙名の設定と題字の画像は、号のフォルダの1つ上(ワークスペース)に置く
const parent = issuePath.split('/').slice(0, -1).join('/');
const wsBase = parent ? `/${enc(parent)}/` : '/';
const pubUrl = (p) => wsBase + enc(p);

async function readPublicationText() {
  const res = await fetch(wsBase + PUBLICATION_FILE, { cache: 'no-store' }).catch(() => null);
  return res?.ok ? res.text() : null;
}

async function readText(p) {
  const res = await fetch(base + p, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${p}`);
  return res.text();
}

const assetUrl = (p) => base + p.split('/').map(encodeURIComponent).join('/');

async function main() {
  document.body.classList.add('preview');
  const result = { errors: [], warnings: [], articles: [], pages: 0, number: null, userAgent: navigator.userAgent };
  try {
    if (!issuePath) throw Object.assign(new Error('URL に ?issue=号フォルダ を付けてください(例: ?issue=samples/demo)。'), { code: 'E_NO_ISSUE' });
    let issue;
    try {
      issue = parseJsonc(await readText('issue.jsonc'));
    } catch (e) {
      if (e.code) throw e;
      throw Object.assign(new Error(`${issuePath}/issue.jsonc を読めません。`), { code: 'E_FILE_NOT_FOUND' });
    }
    result.number = issue.number ?? null;
    const pub = loadPublication(await readPublicationText(), SPEC);
    result.publication = { name: pub.publication.name, fileName: pub.publication.fileName, approver: pub.publication.approver };
    result.errors.push(...pub.errors);
    result.warnings.push(...pub.warnings);
    document.title = `${pub.publication.name} 第${issue.number}号`;
    const v = validateIssue(issue, SPEC);
    result.errors.push(...v.errors);
    result.warnings.push(...v.warnings);
    if (!v.errors.length) {
      const r = await renderIssue({ root: document.getElementById('pages'), issue, readText, assetUrl, publication: pub.publication, pubUrl });
      result.errors.push(...r.errors);
      result.warnings.push(...r.warnings);
      result.articles = r.articles;
      result.pages = r.pages;
    }
  } catch (e) {
    result.errors.push({ code: e.code ?? 'E_UNEXPECTED', message: e.message });
  }
  window.YSM = { done: true, result };
  if (!building) {
    showReport(result);
    liveReload();
  }
}

function showReport(r) {
  const el = document.createElement('aside');
  el.id = 'ysm-report';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const li = (x, cls) => `<li class="${cls}"><code>${esc(x.code)}</code> ${esc(x.message)}</li>`;
  const arts = r.articles.map((a) => `<li><b>${esc(a.id)}</b> ${esc(a.range)}・${a.chars}字・${a.overflowChars ? `<span class="e">あふれ ${a.overflowChars}字</span>` : `末尾の空き ${a.emptyLines}行`}</li>`).join('');
  el.innerHTML = `
    <h1>${esc(r.publication?.name ?? '')} ${r.number != null ? `第${r.number}号` : ''}</h1>
    <p class="sum ${r.errors.length ? 'bad' : 'ok'}">エラー ${r.errors.length} ・ 警告 ${r.warnings.length}</p>
    <ul>${r.errors.map((x) => li(x, 'e')).join('')}${r.warnings.map((x) => li(x, 'w')).join('')}</ul>
    ${arts ? `<h2>記事</h2><ul>${arts}</ul>` : ''}
    <p class="hint"><label><input type="checkbox" id="ysm-debug"> 枠を表示(d キー)</label><br>原稿や設定を保存すると自動で更新されます。</p>`;
  document.body.appendChild(el);
  const box = el.querySelector('#ysm-debug');
  const set = (on) => { document.body.classList.toggle('debug', on); box.checked = on; };
  set(params.has('debug'));
  box.addEventListener('change', () => set(box.checked));
  addEventListener('keydown', (e) => { if (e.key === 'd' && !e.ctrlKey && !e.metaKey) set(!document.body.classList.contains('debug')); });
}

// tools/preview.mjs のサーバーから変更の通知を受けたら再読み込みする(ほかのサーバーでは何もしない)
function liveReload() {
  const es = new EventSource('/__events');
  es.onmessage = () => location.reload();
  es.onerror = () => es.close();
}

main();
