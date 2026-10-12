// 入稿の画面(docs/04-editor.md「画面の構成」)。印刷の店に出す前の確認と、入稿用の PDF(A4・A3 の面付け)と入稿メモを作る。
// 刷る前の確認(紙名の設定の approver)は必須。確認していただいたときの中身の指紋を残し、そのあとで中身が変わったら知らせる。
// 記事の進み具合・写真の解像度・そのほかの警告は、確かめるための一覧(入稿は止めない)。

import { contentFingerprint, imposition, printMemo, printFiles, PRINT_DEFAULTS } from '../engine/print.js';
import * as M from './model.js';
import { pageThumb, pageElement } from './thumbs.js';
import { downloadText } from './printing.js';
import { ICON } from './icons.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const today = () => new Date().toLocaleDateString('sv-SE');   // YYYY-MM-DD
const STATUS_NAMES = { requested: '依頼中', received: '届いた', checking: '確認中', fixed: '確定' };
const SHEET_THUMB = 92;

export class PrintCheck {
  constructor(ed) {
    this.ed = ed;
    this.root = document.getElementById('print-check');
    this.output = null;     // 入稿用データを作った結果
    this.building = false;
    this.pending = false;   // 入力中だったので描き直しを待っている
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pc]');
      if (!b || b.disabled) return;
      const act = b.dataset.pc;
      if (act === 'build') this.build();
      else if (act === 'print-a3') this.ed.printPdf(this.state().sides);
      else if (act === 'print-a4') this.ed.printPdf();
      else if (act === 'memo') this.saveMemo();
      else if (act === 'copy') this.copyMemo(this.output?.memo);
      else if (act === 'copy-preview') this.copyMemo(this.memoText());
      else if (act === 'locate') this.ed.shell.locate(this.state().errors[Number(b.dataset.n)]);
    });
    this.root.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.pcIn === 'approve') this.setApproval(t.checked);
      else if (t.dataset.pcIn === 'date' && this.ed.issue.approval) this.setApproval(true, t.value);
      else if (t.dataset.pcIn) this.setPrint();
    });
    this.root.addEventListener('focusout', () => {
      if (!this.pending) return;
      setTimeout(() => { if (!this.typing()) this.render(); }, 0);
    });
  }

  get isOpen() {
    return this.ed.shell.ws === 'nyuko';
  }

  open() {
    this.ed.shell.setWorkspace('nyuko');
  }

  close() {
    this.ed.shell.setWorkspace('shimen');
  }

  // 部数・用紙を打っている途中か(描き直すと打っている字が消える)
  typing() {
    const a = document.activeElement;
    return !!a && this.root.contains(a) && a.matches('input[type="text"], input[type="number"]');
  }

  // いまの状態から、確認の項目をまとめる
  state() {
    const { issue, texts, result } = this.ed;
    const fingerprint = contentFingerprint(issue, texts);
    const approval = issue.approval ?? null;
    const errors = result?.errors ?? [];
    const warnings = result?.warnings ?? [];
    const lowPhotos = warnings.filter((w) => w.code === 'W_IMAGE_LOW_DPI' && w.src);
    return {
      fingerprint,
      approval,
      approved: !!approval && approval.fingerprint === fingerprint,
      changed: !!approval && approval.fingerprint !== fingerprint,
      errors,
      lowPhotos,
      others: warnings.filter((w) => !(w.code === 'W_IMAGE_LOW_DPI' && w.src) && w.code !== 'W_APPROVAL_CHANGED'),
      notFixed: issue.articles.filter((a) => a.status !== 'fixed'),
      pages: issue.pages.length,
      sides: imposition(issue.pages.length),
      print: { ...PRINT_DEFAULTS, ...(issue.print ?? {}) },
      files: printFiles(issue.number, this.ed.publication.fileName),
    };
  }

  memoText() {
    return printMemo(this.ed.issue, this.ed.issue.pages.length, today(), this.ed.publication);
  }

  render() {
    if (!this.isOpen || !this.ed.issue) return;
    if (this.typing()) {
      this.pending = true;
      return;
    }
    this.pending = false;
    const { issue, pdfBusy, lastPdf } = this.ed;
    const ap = this.ed.publication.approver;
    const s = this.state();
    const ready = !s.errors.length && s.approved && !this.building;
    const format = s.sides ? `A3 二つ折り(${s.sides.length / 2}枚)` : `A4 両面(${Math.ceil(s.pages / 2)}枚)`;
    const mark = (state, n) => (state === 'ok' ? `<span class="step-mark ok" aria-label="済み">${ICON.check}</span>`
      : state === 'ng' ? '<span class="step-mark ng" aria-label="要対応">!</span>' : `<span class="step-mark">${n}</span>`);
    const item = (key, ok, title, body, required = false) => `
      <li class="${ok ? 'ok' : required ? 'ng' : 'warn'}" data-pc-item="${key}">
        <span class="mark" aria-hidden="true">${ok ? '✔' : required ? '✖' : '!'}</span>
        <div><b>${title}</b>${body}</div>
      </li>`;
    const list = (xs) => (xs.length ? `<ul class="nk-sub">${xs.join('')}</ul>` : '');
    const warnCount = s.lowPhotos.length + s.others.length + (s.notFixed.length ? 1 : 0);
    const checksChip = s.errors.length ? `<span class="chip-s err">エラー ${s.errors.length}</span>`
      : warnCount ? `<span class="chip-s warn">確かめたい所 ${warnCount}</span>` : '<span class="chip-s ok">問題なし</span>';
    const approvalNote = s.approved ? `<p class="nk-note">${esc(s.approval.date)} に確認していただきました。</p>`
      : s.changed ? `<p class="nk-note bad">${esc(s.approval.date)} に確認していただいたあとで、紙面の中身(配置・原稿)が変わっています。変わった所を確かめていただいてから、もう一度チェックしてください。</p>`
        : `<p class="nk-note">${esc(ap)}に、印刷したものを読んで確認していただいてから、チェックしてください。</p>`;
    const why = s.errors.length ? `エラーが ${s.errors.length}件あるため、まだ作れません。紙面で直してください。`
      : !s.approved ? (s.changed ? `${esc(ap)}に確認していただいたあとで中身が変わっています。もう一度確認していただいてください。` : `${esc(ap)}の確認をチェックすると作れます。`)
        : this.building ? '作っています…' : `A4 の PDF${s.sides ? '・A3 の面付け PDF' : ''}・入稿メモを作ります(保存していない変更は先に保存します)。`;
    const files = [
      ...(s.sides ? [`<li>${ICON.page}<code>${esc(s.files.a3)}</code><span class="hint">A3 横・${s.sides.length}ページ(印刷の店へ)</span></li>`] : []),
      `<li>${ICON.page}<code>${esc(s.files.a4)}</code><span class="hint">A4・${s.pages}ページ${s.sides ? '(ページの順の確認用)' : '(印刷の店へ)'}</span></li>`,
      `<li>${ICON.text}<code>${esc(s.files.memo)}</code><span class="hint">刷り方と${esc(ap)}の確認</span></li>`,
    ].join('');
    const sheets = s.sides
      ? s.sides.map(([l, r], i) => {
        const which = s.sides.length > 2 ? `${Math.floor(i / 2) + 1}枚目の${i % 2 ? '内側' : '外側'}` : i % 2 ? '内側' : '外側';
        return `<figure class="nk-sheet"><div class="nk-pair" data-sheet="${l},${r}"></div><figcaption>${which}(左 ${l}面・右 ${r}面)</figcaption></figure>`;
      }).join('')
      : Array.from({ length: s.pages }, (_, i) => `<figure class="nk-sheet"><div class="nk-pair" data-sheet="${i + 1}"></div><figcaption>${Math.floor(i / 2) + 1}枚目の${i % 2 ? '裏' : '表'}(${i + 1}面)</figcaption></figure>`).join('');

    this.root.innerHTML = `
      <div class="nk-title"><h1>入稿</h1><span class="hint">第${esc(issue.number)}号(${esc(issue.date)})・${s.pages}ページ → ${format}</span></div>
      <div class="nk">
        <div class="nk-main">
          <section class="card nk-step" aria-label="確認の一覧">
            <header class="card-head">${mark(s.errors.length ? 'ng' : warnCount ? '' : 'ok', 1)}<h2>確認の一覧</h2>${checksChip}</header>
            <ul class="nk-list">
              ${item('errors', !s.errors.length, s.errors.length ? `エラーが ${s.errors.length} 件あります(直すまで入稿用データは作れません)` : 'エラーはありません',
    list(s.errors.map((e, n) => `<li><code>${esc(e.code)}</code>${esc(e.message)}<button type="button" class="small" data-pc="locate" data-n="${n}">紙面で直す</button></li>`)), true)}
              ${item('status', !s.notFixed.length, s.notFixed.length ? `「確定」になっていない記事が ${s.notFixed.length} 本あります` : '記事はすべて「確定」です',
    list(s.notFixed.map((a) => `<li>${esc(this.ed.articleTitle(a.id))}(${STATUS_NAMES[a.status] ?? '進み具合は未設定'})</li>`)))}
              ${item('photos', !s.lowPhotos.length, s.lowPhotos.length ? `解像度の低い写真が ${s.lowPhotos.length} 枚あります(印刷で粗く見えるおそれ)` : '写真の解像度は足りています',
    s.lowPhotos.length ? `<div class="nk-thumbs">${s.lowPhotos.map((w) => `<figure><img src="${esc(this.ed.api.url(w.src))}" alt=""><figcaption>${esc(w.src.replace(/^photos\//, ''))}<br>約${w.dpi}dpi</figcaption></figure>`).join('')}</div>` : '')}
              ${item('others', !s.others.length, s.others.length ? `そのほかの警告が ${s.others.length} 件あります` : 'そのほかの警告はありません',
    s.others.length ? `<details><summary>一覧</summary>${list(s.others.map((w) => `<li><code>${esc(w.code)}</code>${esc(w.message)}</li>`))}</details>` : '')}
            </ul>
          </section>

          <section class="card nk-step" aria-label="${esc(ap)}の確認">
            <header class="card-head">${mark(s.approved ? 'ok' : s.changed ? 'ng' : '', 2)}<h2>${esc(ap)}の確認(必須)</h2>
              <span class="chip-s${s.approved ? ' ok' : s.changed ? ' warn' : ''}">${s.approved ? '済み' : s.changed ? '確認のあとに変更あり' : 'まだ'}</span></header>
            <p class="nk-text">PDF を作って印刷し、${esc(ap)}にお渡しします。確認していただいたら、チェックを入れて日付を残します。そのあとで原稿や配置が変わると、ここと上の帯で知らせます。</p>
            <div class="nk-row">
              <button type="button" data-cmd="pdf" ${pdfBusy ? 'disabled' : ''}>${ICON.page}<span>${pdfBusy ? 'PDFを作成中…' : `PDF を作る(A4・${s.pages}ページ)`}</span></button>
              ${lastPdf ? `<a href="${esc(lastPdf)}?t=${Date.now()}" target="_blank">作った PDF を開く</a>` : ''}
            </div>
            <ul class="nk-list">
              ${item('approval', s.approved, `${esc(ap)}に確認していただいた`, `
                <div class="nk-row">
                  <label><input type="checkbox" data-pc-in="approve" ${s.approved ? 'checked' : ''}> 確認していただいた</label>
                  <label>日付 <input type="date" data-pc-in="date" value="${esc(s.approval?.date ?? today())}"></label>
                </div>${approvalNote}`, true)}
            </ul>
          </section>

          <section class="card nk-step" aria-label="刷り方">
            <header class="card-head">${mark('', 3)}<h2>刷り方</h2><span class="chip-s">${esc(s.print.copies)}部 · ${esc(s.print.paper)} · ${s.print.color ? 'カラー' : 'モノクロ'}</span></header>
            <div class="nk-print">
              <label>部数 <input type="number" min="1" data-pc-in="copies" value="${esc(s.print.copies)}"> 部</label>
              <label>用紙 <input type="text" data-pc-in="paper" value="${esc(s.print.paper)}" placeholder="例: 上質紙 90kg"></label>
              <label><input type="checkbox" data-pc-in="color" ${s.print.color ? 'checked' : ''}> カラー</label>
            </div>
            <p class="hint">${s.sides ? `${s.pages}ページなので A3 に面付けし、両面(短辺とじ)で刷って中央で二つ折りにします。` : `${s.pages}ページなので A4 の両面(長辺とじ)で刷ります。`}</p>
          </section>

          <section class="card nk-step" aria-label="入稿用データ">
            <header class="card-head">${mark(this.output?.pdf ? 'ok' : '', 4)}<h2>入稿用データ</h2></header>
            <p class="nk-why${ready || this.building ? '' : ' bad'}">${why}</p>
            <ul class="nk-files">${files}</ul>
            ${this.ed.api.canBuild ? `
            <div class="nk-row">
              <button type="button" class="primary" data-pc="build" ${ready ? '' : 'disabled'}>${this.building ? '作っています…' : '入稿用データを作る'}</button>
            </div>
            ${this.output ? this.resultHtml() : ''}` : `
            <p class="hint">印刷の画面が開きます。送信先を「PDF に保存」にして、倍率や余白は変えずに保存してください(ファイル名は上の名前になっています)。</p>
            <div class="nk-row">
              ${s.sides ? `<button type="button" class="primary" data-pc="print-a3" ${ready ? '' : 'disabled'}>${ICON.printer}<span>A3 の面付けを PDF に保存…</span></button>` : ''}
              <button type="button" ${s.sides ? '' : 'class="primary"'} data-pc="print-a4" ${ready ? '' : 'disabled'}>${ICON.printer}<span>A4 の PDF を保存…</span></button>
              <button type="button" data-pc="memo" ${ready ? '' : 'disabled'}>${ICON.text}<span>入稿メモを保存</span></button>
            </div>`}
          </section>
        </div>

        <div class="nk-side">
          <section class="card" aria-label="紙の折り方">
            <header class="card-head"><h2>紙の折り方</h2></header>
            <div class="nk-sheets">${sheets}</div>
            <p class="hint">${s.sides ? '縦書きの右綴じ。両面(短辺とじ)で刷り、点線で二つ折りにすると、1面から順に読めます。' : '縦書きの右綴じ。両面で刷り、ページの順に重ねます。'}</p>
            <div class="nk-row"><button type="button" data-cmd="spread">${ICON.spread}<span>見開きで見る</span></button></div>
          </section>
          <section class="card" aria-label="入稿メモ">
            <header class="card-head"><h2>入稿メモ</h2><span class="hint">作られる内容</span><span class="grow"></span><button type="button" class="small" data-pc="copy-preview">写す</button></header>
            <pre class="nk-memo">${esc(this.memoText())}</pre>
          </section>
        </div>
      </div>`;
    this.fillSheets();
  }

  // 紙の折り方の縮小表示(いま組み上がっているページの写し)
  fillSheets() {
    for (const box of this.root.querySelectorAll('[data-sheet]')) {
      const nums = box.dataset.sheet.split(',').map(Number);
      const parts = [];
      nums.forEach((n, i) => {
        if (i) parts.push(Object.assign(document.createElement('span'), { className: 'fold' }));
        const el = pageElement(n);
        if (el) parts.push(pageThumb(el, SHEET_THUMB));
      });
      box.replaceChildren(...parts);
    }
  }

  resultHtml() {
    const r = this.output;
    if (!r.pdf) {
      return `<div class="nk-result bad">作れませんでした: ${esc((r.errors ?? []).map((x) => x.message).join(' / ') || r.error || '')}</div>`;
    }
    const link = (href, label) => `<a href="${esc(href)}?t=${Date.now()}" target="_blank">${esc(label)}</a>`;
    return `
      <div class="nk-result">
        <p><b>できました。</b> ${r.a3 ? `${link(r.a3, 'A3 の面付け PDF')}・` : ''}${link(r.pdf, 'A4 の PDF')}(号フォルダの out/ にもあります)</p>
        <p class="hint">入稿メモ(out/入稿メモ.txt)は、印刷の店に伝えるときに使ってください。</p>
        <button type="button" data-pc="copy">入稿メモを写す</button>
      </div>`;
  }

  setApproval(on, date) {
    const s = this.state();
    const approval = on ? { by: this.ed.publication.approver, date: date || this.root.querySelector('[data-pc-in="date"]')?.value || today(), fingerprint: s.fingerprint } : undefined;
    this.ed.apply((issue) => M.setIssueProp(issue, 'approval', approval));
    this.render();
  }

  setPrint() {
    const v = (k) => this.root.querySelector(`[data-pc-in="${k}"]`);
    const copies = Number(v('copies').value);
    const print = { copies: Number.isInteger(copies) && copies > 0 ? copies : PRINT_DEFAULTS.copies, paper: v('paper').value.trim() || PRINT_DEFAULTS.paper, color: v('color').checked };
    this.ed.apply((issue) => M.setIssueProp(issue, 'print', print));
    this.render();
  }

  async build() {
    if (this.ed.dirtyFiles().length && !(await this.ed.save())) return;
    this.building = true;
    this.output = null;
    this.render();
    try {
      this.output = await this.ed.api.build({ final: true });
    } catch (e) {
      this.output = { error: e.message };
    } finally {
      this.building = false;
      this.render();
    }
  }

  // 静的ページ版: 入稿メモを号のフォルダの out/ に書く(見本はこのパソコンに保存する)
  async saveMemo() {
    const text = this.memoText();
    const name = printFiles(this.ed.issue.number, this.ed.publication.fileName).memo;
    try {
      if (this.ed.api.kind === 'demo') {
        downloadText(name, text);
        return;
      }
      await this.ed.api.putFile(`out/${name}`, text);
      this.ed.toast(`入稿メモを号のフォルダの out/${name} に保存しました。`);
    } catch (e) {
      this.ed.toast(`入稿メモを保存できませんでした: ${e.message}`, { bad: true });
    }
  }

  async copyMemo(text) {
    try {
      await navigator.clipboard.writeText(text ?? '');
      this.ed.toast('入稿メモを写しました。');
    } catch {
      this.ed.toast('写せませんでした。out/入稿メモ.txt を開いて使ってください。', { bad: true });
    }
  }
}

// エディタの検査結果に足す: 刷る前の確認のあとで中身が変わったら知らせる
export function approvalWarning(issue, texts, pub = null) {
  if (!issue.approval?.fingerprint || issue.approval.fingerprint === contentFingerprint(issue, texts)) return null;
  const who = pub?.approver ?? issue.approval.by ?? '発行責任者';
  return { code: 'W_APPROVAL_CHANGED', message: `${who}に確認していただいた(${issue.approval.date})あとで、紙面の中身が変わっています。入稿の前に、変わった所を確かめていただいてください。` };
}

export { printMemo };
