// はじめの画面(静的ページ版。docs/04-editor.md「静的ページ版」)。データの置き場(ワークスペース)を開き、号を選ぶか新しく作る。
//   - フォルダを開く: このパソコンのフォルダ(OneDrive・Google ドライブの同期フォルダ、共有フォルダからダウンロードして
//     展開したフォルダ、USB メモリの中でもよい)。Chrome・Edge
//   - OneDrive につなぐ: Microsoft にアプリを登録したときだけ出す(editor/storage-onedrive.js。D-035)
//   - 見本を開く: サイトの見本の号。保存はされない
// サーバー版(npm run edit)では使わない。

import { SPEC } from '../engine/spec.js';
import { defaultPublication } from '../engine/publication.js';
import { serializeIssue, serializePublication } from './serialize.js';
import { issueFolderName } from './names.js';
import { folderSupported, pickFolder, rememberFolder, recallFolder, ensurePermission, FolderWorkspace } from './storage-folder.js';
import { DemoWorkspace } from './storage-demo.js';
import { ICON } from './icons.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ARTICLE_TEMPLATE = '# 見出し\n\n▼小見出し\n本文をここに書きます。\n';

// 新しい号の設定(1面と、残りは中の面。記事は1本)
export function newIssue({ number, date, pages }) {
  return {
    number,
    date,
    pages: Array.from({ length: pages }, (_, p) => ({ template: p === 0 ? 'front' : 'inner', items: [] })),
    articles: [{ id: 'kiji1', file: 'kiji1.txt', start: { page: 1, dan: 1 } }],
  };
}

// 選んだフォルダが1つずれていそうなときの知らせ(look: FolderWorkspace.inspect() の結果)
function guideHtml({ isIssue, below }) {
  if (isIssue) {
    return `
      <section class="st-guide card" role="note">
        <h2>号のフォルダを選んでいます</h2>
        <p>このフォルダには号の設定(issue.jsonc)があります。その1つ上の、紙名の設定(publication.jsonc)と号のフォルダが並んでいるフォルダを選んでください。</p>
        <div class="st-row"><button type="button" data-st="folder" class="primary">フォルダを選び直す</button></div>
      </section>`;
  }
  return `
    <section class="st-guide card" role="note">
      <h2>この中のフォルダを開いてください</h2>
      <p>このフォルダには紙名の設定も号もありませんが、1つ下に機関紙のフォルダがあります(ダウンロードして展開すると、こうなることがよくあります)。</p>
      <div class="st-row">${below.map((n) => `<button type="button" data-st="descend" data-name="${esc(n)}" class="primary">「${esc(n)}」を開く</button>`).join('')}</div>
    </section>`;
}

export class StartScreen {
  // cloud: OneDrive につなぐ部品(設定がなければ null)。samplesBase: 見本の URL
  constructor({ cloud = null, samplesBase }) {
    this.cloud = cloud;
    this.samplesBase = samplesBase;
    this.root = document.getElementById('start');
    this.ws = null;
    this.resolve = null;
  }

  // ワークスペースと号を選んでもらい、その号の窓口(storage)を返す
  run() {
    this.root.hidden = false;
    document.body.classList.add('starting');
    this.renderChoices().then(async () => {
      // OneDrive のサインインから戻ってきたところなら、そのまま号の一覧へ
      if (this.cloud?.error) this.error(this.cloud.error);
      else if (this.cloud?.returned) {
        try {
          await this.showIssues(await this.cloud.connect());
        } catch (e) {
          this.error(e.message);
        }
      }
    });
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  finish(storage) {
    this.root.hidden = true;
    document.body.classList.remove('starting');
    this.resolve?.(storage);
  }

  error(text) {
    const el = this.root.querySelector('.st-error');
    if (el) el.textContent = text;
  }

  async renderChoices() {
    const recent = folderSupported() ? await recallFolder() : null;
    this.root.innerHTML = `
      <div class="st-box">
        <header class="st-head">
          <span class="app-mark" aria-hidden="true">紙</span>
          <div><h1>機関紙エディタ</h1><p>縦組みの機関紙を作る道具です。原稿や写真は、このサイトではなく、あなたが選んだフォルダ(このパソコン、または同期している OneDrive・Google ドライブのフォルダ)に保存します。</p></div>
        </header>
        <div class="st-choices">
          ${recent ? `<button type="button" class="st-choice primary-choice" data-st="recent">${ICON.folder}<span><b>前のフォルダを開く</b><small>${esc(recent.name)}</small></span></button>` : ''}
          <button type="button" class="st-choice" data-st="folder" ${folderSupported() ? '' : 'disabled'}>${ICON.folder}<span><b>フォルダを開く</b><small>${folderSupported() ? 'このパソコンのフォルダ。OneDrive・Google ドライブの同期フォルダ、共有フォルダからダウンロードして展開したフォルダ、USB メモリの中でもよい' : 'このブラウザでは使えません(Chrome か Edge で開いてください)'}</small></span></button>
          ${this.cloud ? `<button type="button" class="st-choice" data-st="cloud">${ICON.page}<span><b>OneDrive につなぐ</b><small>サインインして、OneDrive のこのアプリ用のフォルダを使う</small></span></button>` : ''}
          <button type="button" class="st-choice" data-st="demo">${ICON.spread}<span><b>見本を開く</b><small>試すための見本の号。保存はされません</small></span></button>
        </div>
        <details class="st-tips card">
          <summary>共有フォルダ(OneDrive・Google ドライブ)で使うには</summary>
          <ul>
            <li>開くのは、紙名の設定(publication.jsonc)と号のフォルダ(051 など)が並んでいるフォルダです。</li>
            <li>同期アプリのあるパソコン: 共有フォルダをパソコンに同期して、「フォルダを開く」でその中のフォルダを選びます。保存すると、同期アプリがクラウドへ送ります。</li>
            <li>同期アプリのないパソコン: 共有フォルダのページからフォルダをダウンロードし、展開してから「フォルダを開く」で選びます。終わったら、書き換えたファイルを共有フォルダの同じ場所へ送り(同じ名前のファイルは置き換える)、パソコンに残ったものは消します。</li>
            <li>同じ号を2か所で同時に直さないでください。</li>
          </ul>
        </details>
        <p class="st-error" role="alert"></p>
      </div>`;
    this.root.onclick = (e) => this.onChoice(e, recent);
  }

  async onChoice(e, recent) {
    const b = e.target.closest('[data-st]');
    if (!b || b.disabled) return;
    const act = b.dataset.st;
    this.error('');
    try {
      if (act === 'folder') {
        const handle = await pickFolder();
        if (!(await ensurePermission(handle))) throw new Error('フォルダの読み書きが許可されませんでした。');
        await rememberFolder(handle);
        await this.showIssues(new FolderWorkspace(handle));
      } else if (act === 'recent') {
        if (!(await ensurePermission(recent))) throw new Error('フォルダの読み書きが許可されませんでした。');
        await this.showIssues(new FolderWorkspace(recent));
      } else if (act === 'descend') {
        const ws = await this.ws.child(b.dataset.name);
        await rememberFolder(ws.root);
        await this.showIssues(ws);
      } else if (act === 'cloud') {
        await this.showIssues(await this.cloud.connect());
      } else if (act === 'demo') {
        await this.showIssues(new DemoWorkspace(this.samplesBase));
      } else if (act === 'back') {
        this.renderChoices();
      } else if (act === 'open') {
        this.finish(this.ws.open(b.dataset.folder));
      } else if (act === 'create') {
        await this.createIssue();
      } else if (act === 'create-pub') {
        await this.createPublication();
      } else if (act === 'signout') {
        await this.cloud.signOut();
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;   // フォルダを選ぶ画面で「キャンセル」
      this.error(err.message ?? String(err));
    }
  }

  async showIssues(ws) {
    this.ws = ws;
    const list = await ws.list();
    const pubText = await ws.open('').readWorkspaceText('publication.jsonc');
    const next = Math.max(0, ...list.map((x) => Number(x.number) || 0)) + 1;
    // 紙名の設定も号もないフォルダは、選ぶ場所を1つ間違えていないかを見る。間違えていそうなら、作る欄は出さずに知らせる
    const look = ws.kind === 'folder' && pubText == null && !list.length ? await ws.inspect() : null;
    const misplaced = !!(look && (look.isIssue || look.below.length));
    this.root.innerHTML = `
      <div class="st-box">
        <header class="st-head">
          <span class="app-mark" aria-hidden="true">紙</span>
          <div><h1>号を選ぶ</h1><p class="st-where">${esc(ws.label)}${ws.readonly ? '(見本。保存はされません)' : ''}</p></div>
          <span class="grow"></span>
          ${ws.kind === 'onedrive' ? '<button type="button" data-st="signout">サインアウト</button>' : ''}
          <button type="button" data-st="back">開き方を選び直す</button>
        </header>
        ${misplaced ? guideHtml(look) : ''}
        ${pubText == null && !ws.readonly && !misplaced ? `
          <section class="st-pub card">
            <h2>紙名の設定がありません</h2>
            <p class="hint">このフォルダで作る機関紙の名前を入れてください(題字はあとで「紙名と題字の設定」で作れます)。</p>
            <div class="st-row"><label>紙名<input type="text" data-st-in="pubname" placeholder="例: 道場通信"></label><button type="button" data-st="create-pub" class="primary">作る</button></div>
          </section>` : ''}
        ${misplaced ? '' : `
        <section class="st-list card">
          <h2>号</h2>
          ${list.length ? `<ul>${list.map((x) => `
            <li><button type="button" data-st="open" data-folder="${esc(x.folder)}">
              <b>${x.number != null ? `第${esc(x.number)}号` : esc(x.folder)}</b><span>${esc(x.date)}</span><small>${esc(x.folder)}/</small>
            </button></li>`).join('')}</ul>` : '<p class="hint">まだ号がありません。下で新しい号を作ってください。</p>'}
        </section>`}
        ${ws.readonly || misplaced ? '' : `
          <section class="st-new card">
            <h2>新しい号を作る</h2>
            <div class="st-row">
              <label>号数<input type="number" min="0" data-st-in="number" value="${next}"></label>
              <label>発行年月<input type="text" data-st-in="date" placeholder="例: 令和8年10月"></label>
              <label>ページ<select data-st-in="pages"><option value="2">2ページ</option><option value="4" selected>4ページ</option></select></label>
              <button type="button" data-st="create" class="primary">作る</button>
            </div>
            <p class="hint">号のフォルダ(例: ${esc(issueFolderName(next))}/)を作り、1面と中の面、記事を1本入れておきます。</p>
          </section>`}
        <p class="st-error" role="alert"></p>
      </div>`;
  }

  async createPublication() {
    const name = this.root.querySelector('[data-st-in="pubname"]').value.trim();
    if (!name) throw new Error('紙名を入れてください。');
    await this.ws.open('').putWorkspaceFile('publication.jsonc', serializePublication(defaultPublication(SPEC, name)));
    await this.showIssues(this.ws);
  }

  async createIssue() {
    const v = (k) => this.root.querySelector(`[data-st-in="${k}"]`).value;
    const number = Number(v('number'));
    if (!Number.isInteger(number) || number < 0) throw new Error('号数は 0 以上の整数にしてください。');
    const date = v('date').trim();
    if (!date) throw new Error('発行年月を入れてください(例: 令和8年10月)。');
    const folder = issueFolderName(number);
    if (await this.ws.exists(folder)) throw new Error(`${folder}/ はもうあります。号数を変えてください。`);
    const st = this.ws.open(folder);
    await st.putFile('kiji1.txt', ARTICLE_TEMPLATE);
    await st.putFile('issue.jsonc', serializeIssue(newIssue({ number, date, pages: Number(v('pages')) })));
    this.finish(this.ws.open(folder));
  }
}
