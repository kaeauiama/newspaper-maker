// 紙面エディタ(docs/04-editor.md)。組版は engine/ をそのまま使い、編集結果は号フォルダのファイルに保存する。
// 型(書体・罫・段組み・題字)は編集の対象にしない。配置は段と行のマス目に吸着させる(editor/snap.js)。

import { SPEC, danTop, danBottom, danHeight, linePitch } from '../engine/spec.js';
import { itemY } from '../engine/slots.js';
import { parseJsonc } from '../engine/jsonc.js';
import { validateIssue } from '../engine/validate.js';
import { renderIssue } from '../engine/render.js';
import { parseArticle } from '../engine/text.js';
import { loadPublication } from '../engine/publication.js';
import { snapMove, snapResizeLeft, snapResizeRight, shiftDan, resizeDan, stepMove, stepResize, snapEdgeY, stepEdgeY } from './snap.js';
import * as M from './model.js';
import { materializePanel, arrangePanel } from './photos.js';
import { serializeIssue } from './serialize.js';
import { connectApi } from './api.js';
import { Inspector } from './inspector.js';
import { PanelEditor } from './panel-editor.js';
import { SpreadPreview } from './spread.js';
import { PrintCheck, approvalWarning } from './print-check.js';
import { TextCleanup } from './cleanup-dialog.js';
import { fitCandidates, judgeFit } from './fit.js';
import { Shell } from './shell.js';
import { PageList } from './pagelist.js';
import { GenkoView } from './genko.js';
import { MastheadEditor } from './masthead-editor.js';
import { printPages } from './printing.js';
import { printFiles } from '../engine/print.js';

const $ = (sel) => document.querySelector(sel);
const mm = (v) => `${+v.toFixed(3)}mm`;
const DAN_STEP = danHeight(SPEC) + SPEC.dan.gap;
const TABLE_TEMPLATE = '|  | 見出し | 見出し |\n|---|---|---|\n| 項目 | 内容 | 内容 |\n';
const ARTICLE_TEMPLATE = '# 見出し\n\n▼小見出し\n本文をここに書きます。\n';
const BOX_TEMPLATE = '# お知らせ\n\n・10月○日(○)\u3000○○○○\n・11月○日(○)\u3000○○○○\n※ 詳しくは各支部の指導員まで。\n';
const PHOTO_TYPES = /^image\/(jpeg|png|webp|gif)$/;

// 段の途中まで張り出す枠の from・to(なければ空)
const yOf = (r) => ({ ...(r.from ? { from: r.from } : {}), ...(r.to ? { to: r.to } : {}) });
const sameRect = (a, b) => a.left === b.left && a.right === b.right && a.dan[0] === b.dan[0] && a.dan[1] === b.dan[1]
  && (a.from ?? 0) === (b.from ?? 0) && (a.to ?? 0) === (b.to ?? 0);

// 縦の範囲の表示(例:「段1〜2(段2は上7字まで)」)
function rangeLabel(r) {
  const base = r.dan[0] === r.dan[1] ? `段${r.dan[0]}` : `段${r.dan[0]}〜${r.dan[1]}`;
  const notes = [];
  if (r.from) notes.push(`段${r.dan[0]}は上${r.from}字をあける`);
  if (r.to) notes.push(`段${r.dan[1]}は上${r.to}字まで`);
  return notes.length ? `${base}(${notes.join('、')})` : base;
}

// ページの上端からの位置(mm)がどの段か。段間にあるときは近いほう
function danAt(y) {
  let best = 1;
  for (let d = 1; d <= SPEC.dan.count; d++) {
    const mid = (danTop(SPEC, d) + danBottom(SPEC, d)) / 2;
    if (Math.abs(y - mid) < Math.abs(y - (danTop(SPEC, best) + danBottom(SPEC, best)) / 2)) best = d;
  }
  return best;
}

class Editor {
  constructor(api) {
    this.api = api;
    this.issue = null;
    this.texts = new Map();              // 原稿・表のファイル名 → 中身
    this.saved = { issue: '', texts: new Map() };
    this.selection = null;               // { kind: 'item', page, index } | { kind: 'article', id } | null
    this.history = [];
    this.future = [];
    this.result = null;                  // 直近の組版と検査の結果
    this.renderSeq = 0;
    this.renderTimer = null;
    this.textSession = false;
    this.drag = null;
    this.suppressUntil = 0;              // 自分で書いたファイルの変更通知を無視する期限
    this.pub = null;                    // 紙名の設定の読み込み結果 { publication, errors, warnings }(engine/publication.js)
    this.sizes = new Map();              // 写真のファイル → 元の大きさ { w, h }(px)
    this.freshPhotos = new Set();        // 取り込んだばかりの写真(組んだあとで解像度を知らせる)
    this.pdfBusy = false;                // PDF を作っているところ
    this.lastPdf = null;                 // 作った PDF のアドレス(入稿の画面に「開く」を出す)
    this.inspector = new Inspector($('#inspector'), this);
    this.shell = new Shell(this);        // 上の帯と作業の画面(原稿・紙面・入稿)の切り替え
    this.pageList = new PageList(this);  // 紙面の画面の左の欄
    this.genko = new GenkoView(this);    // 原稿の画面
    this.panelEditor = new PanelEditor(this);
    this.mastheadEditor = new MastheadEditor(this);   // 紙名と題字の設定
    this.spread = new SpreadPreview(this);
    this.printCheck = new PrintCheck(this);
    this.cleanup = new TextCleanup(this);
  }

  // ---- 読み込みと保存 ----

  // 紙名の設定(号のフォルダの1つ上の publication.jsonc)。題字・柱・PDF の名前・刷る前に確認していただく人
  async loadPublication() {
    this.pub = loadPublication(await this.api.readWorkspaceText('publication.jsonc'), SPEC);
  }

  get publication() {
    return this.pub?.publication ?? loadPublication(null, SPEC).publication;
  }

  // 紙名と題字の設定の画面から: publication.jsonc を書いて読み直し、組み直す
  async savePublication(text) {
    this.suppressUntil = Date.now() + 3000;
    await this.api.putWorkspaceFile('publication.jsonc', text);
    await this.loadPublication();
    this.updateStatus();
    this.printCheck.render();
    await this.render();
  }

  async load() {
    const issue = parseJsonc(await this.api.readText('issue.jsonc'));
    const texts = new Map();
    for (const f of this.textFiles(issue)) {
      try {
        texts.set(f, await this.api.readText(f));
      } catch {
        // 読めないファイルは組版の検査が E_FILE_NOT_FOUND で知らせる
      }
    }
    this.issue = issue;
    this.texts = texts;
    this.markSaved();
  }

  textFiles(issue = this.issue) {
    const files = new Set(issue.articles.map((a) => a.file));
    for (const page of issue.pages) {
      for (const it of page.items ?? []) {
        if (it.table) files.add(it.table);
        if (it.type === 'box' && it.file) files.add(it.file);
      }
    }
    return [...files];
  }

  markSaved() {
    this.saved = { issue: serializeIssue(this.issue), texts: new Map(this.texts) };
    this.updateStatus();
  }

  dirtyFiles() {
    const out = [];
    for (const [f, t] of this.texts) if (this.saved.texts.get(f) !== t) out.push(f);
    if (serializeIssue(this.issue) !== this.saved.issue) out.push('issue.jsonc');   // 原稿を先に書き、設定は最後に書く
    return out;
  }

  async save() {
    this.endTextSession();
    const files = this.dirtyFiles();
    if (!files.length) {
      this.toast('保存する変更はありません。');
      return true;
    }
    this.setStatus('保存中…');
    try {
      this.suppressUntil = Date.now() + 3000;
      for (const f of files) await this.api.putFile(f, f === 'issue.jsonc' ? serializeIssue(this.issue) : this.texts.get(f));
      this.markSaved();
      this.toast(`保存しました(${files.join('、')})。`);
      return true;
    } catch (e) {
      this.toast(`保存できませんでした: ${e.message}`, { bad: true });
      this.updateStatus();
      // OneDrive: 読んだあとでほかのパソコンで書き換えられていた。どちらを残すかを選んでもらう(黙って上書きしない)
      if (e.code === 'E_CONFLICT') {
        this.banner(`${e.message}どちらを残しますか?`, '外の変更を読み込む(こちらの変更は捨てる)', () => this.reloadData(), [
          ['こちらで上書きして保存', () => {
            this.api.overwriteNext(e.key);
            this.hideBanner();
            this.save();
          }],
        ]);
      }
      return false;
    }
  }

  async reloadData() {
    await this.load();
    this.history = [];
    this.future = [];
    this.validateSelection();
    this.inspector.update(true);
    this.hideBanner();
    await this.genko.loadFiles();
    await this.render();
    this.genko.update(true);
  }

  // ---- 元に戻す・やり直す ----

  snapshot() {
    return { issue: structuredClone(this.issue), texts: new Map(this.texts), selection: this.selection && { ...this.selection } };
  }

  checkpoint() {
    this.history.push(this.snapshot());
    if (this.history.length > 200) this.history.shift();
    this.future = [];
  }

  // 文字の入力は、欄を離れるまでをひとまとまりとして元に戻せるようにする
  beginTextChange() {
    if (this.textSession) return;
    this.checkpoint();
    this.textSession = true;
  }

  endTextSession() {
    this.textSession = false;
  }

  restore(s) {
    this.issue = s.issue;
    this.texts = s.texts;
    this.selection = s.selection;
    this.validateSelection();
    this.inspector.update(true);
    this.genko.update(true);
    this.scheduleRender(0);
    this.updateStatus();
  }

  undo() {
    this.endTextSession();
    if (!this.history.length) return;
    this.future.push(this.snapshot());
    this.restore(this.history.pop());
  }

  redo() {
    this.endTextSession();
    if (!this.future.length) return;
    this.history.push(this.snapshot());
    this.restore(this.future.pop());
  }

  // model.js の操作を当てる。断られたら理由を出して何もしない
  apply(fn) {
    this.endTextSession();
    const out = fn(this.issue);
    const r = out && out.pages ? { issue: out } : out;
    if (r.error) {
      this.toast(r.error, { bad: true });
      return null;
    }
    if (r.issue === this.issue) return null;
    this.checkpoint();
    this.issue = r.issue;
    this.validateSelection();
    this.inspector.update(true);
    this.scheduleRender(0);
    this.updateStatus();
    return r;
  }

  // ---- 入力パネルからの変更 ----

  setMeta(key, value) {
    this.beginTextChange();
    const next = structuredClone(this.issue);
    if (key === 'number') {
      const n = Number(value);
      next.number = value !== '' && Number.isInteger(n) ? n : value;   // 整数でなければ検査が知らせる
    } else next.date = value;
    this.issue = next;
    this.scheduleRender();
    this.updateStatus();
  }

  // 原稿を丸ごと差し替える(原稿を整えたときなど)。1回の操作として記録する
  replaceText(file, value) {
    this.endTextSession();
    this.checkpoint();
    this.texts = new Map(this.texts).set(file, value);
    this.inspector.update(true);
    this.genko.update(true);
    this.scheduleRender(0);
    this.updateStatus();
  }

  setText(file, value) {
    this.beginTextChange();
    this.texts = new Map(this.texts).set(file, value);
    this.scheduleRender();
    this.updateStatus();
  }

  setItemProp(prop, value) {
    const sel = this.selection;
    if (sel?.kind !== 'item') return;
    // 選ぶ欄(記事・見出しや囲みの見た目・向き・文字の大きさ)は1回の操作として記録する。既定値は書かない
    if (prop === 'article' || prop === 'look' || prop === 'dir' || prop === 'size') {
      const box = this.issue.pages[sel.page].items[sel.index]?.type === 'box';
      const DEFAULTS = box ? { look: 'gray' } : { look: 'frame', dir: 'vertical', size: '' };
      let v = DEFAULTS[prop] === value ? undefined : value;
      if (prop === 'size' && v !== undefined) v = Number(v);
      this.apply((issue) => M.updateItem(issue, sel.page, sel.index, { [prop]: v }));
      return;
    }
    if (prop === 'caption' || prop === 'title') {
      this.setPanelText(sel.page, sel.index, prop, value);
      return;
    }
    this.beginTextChange();
    this.issue = M.updateItem(this.issue, sel.page, sel.index, { [prop]: value });
    this.scheduleRender();
    this.updateStatus();
  }

  // パネルの見出し・キャプション。帯ができたり消えたりしたら、写真をパネルの中に収め直す
  setPanelText(p, i, prop, value) {
    this.beginTextChange();
    this.issue = M.updatePanelText(SPEC, this.issue, p, i, { [prop]: value }, this.panelSize(p, i), this.sizes);
    this.scheduleRender();
    this.updateStatus();
  }

  setArticleStart(id, start) {
    this.apply((issue) => M.setArticleStart(issue, id, start));
  }

  // 記事の進み具合は1回の操作として、メモは文字の入力として記録する
  setArticleProp(id, prop, value) {
    if (prop === 'status') {
      this.apply((issue) => M.updateArticle(issue, id, { status: value || undefined }));
      return;
    }
    this.beginTextChange();
    this.issue = M.updateArticle(this.issue, id, { [prop]: value });
    this.updateStatus();
  }

  // ---- 選択 ----

  select(sel) {
    this.endTextSession();
    this.selection = sel;
    this.validateSelection();
    this.inspector.update();
    this.decorate();
    if (this.selection?.kind === 'article') this.genko.current = this.selection.id;   // 原稿の画面でも同じ記事を出す
    if (this.pageList.tab === 'articles') this.pageList.refresh();
    // 写真パネルを選んだら、大きさを変えるときに使う写真の元の大きさを先に調べておく
    const item = sel?.kind === 'item' ? this.issue.pages[sel.page]?.items?.[sel.index] : null;
    if (item?.type === 'panel' && !item.table) this.ensureSizes(M.photoSources(item)).then(() => this.inspector.refreshLive());
  }

  validateSelection() {
    const s = this.selection;
    if (s?.kind === 'item' && !this.issue.pages[s.page]?.items?.[s.index]) this.selection = null;
    if (s?.kind === 'article' && !this.issue.articles.some((a) => a.id === s.id)) this.selection = null;
  }

  selectionKey() {
    const s = this.selection;
    if (!s) return 'none';
    return s.kind === 'item' ? `item:${s.page}:${s.index}` : `article:${s.id}`;
  }

  articleTitle(id) {
    const a = this.issue.articles.find((x) => x.id === id);
    if (!a) return id;
    return parseArticle(this.texts.get(a.file) ?? '').title[0] ?? id;
  }

  itemGeometry(p, i) {
    const item = this.issue.pages[p]?.items?.[i];
    if (!item) return null;
    const r = M.rectOf(SPEC, item);
    const { w: width, h: height } = M.sizeOf(SPEC, r);
    return { ...r, width, height, label: rangeLabel(r), lines: Math.round(((width + 2 * SPEC.wrapGap) / linePitch(SPEC)) * 10) / 10 };
  }

  // ---- 写真の大きさと「枠 + 切り抜き」 ----

  async ensureSizes(srcs) {
    await this.api.ensureUrls?.(srcs.filter((s) => !this.sizes.has(s)));
    await Promise.all(srcs.filter((s) => !this.sizes.has(s)).map(async (src) => {
      const im = new Image();
      im.src = this.api.url(src);
      try {
        await im.decode();
        this.sizes.set(src, { w: im.naturalWidth, h: im.naturalHeight });
      } catch {
        // 読めない写真は組版の検査が知らせる
      }
    }));
    return this.sizes;
  }

  // 写真パネルのうち、まだ「枠 + 切り抜き」になっていない写真があるもの(rows、切り抜きのない photos)
  needsMaterialize(item) {
    if (item?.type !== 'panel' || item.table) return false;
    return !(Array.isArray(item.photos) && item.photos.every((ph) => Array.isArray(ph.crop)));
  }

  panelSize(p, i) {
    const g = this.itemGeometry(p, i);
    return { w: g.width, h: g.height };
  }

  // パネルの写真を「枠 + 切り抜き」で持つ形にした配置物を返す(見た目は変えない)
  async materialized(p, i) {
    const item = this.issue.pages[p].items[i];
    const sizes = await this.ensureSizes(M.photoSources(item));
    const { w, h } = this.panelSize(p, i);
    return materializePanel(SPEC, item, w, h, sizes);
  }

  // 位置と大きさを確定する。写真パネルの大きさが変わるときは、先に「枠 + 切り抜き」に直して縦横比を保つ
  // toPage を渡すと、そのページへ移す(移した先で選び直し、見える所まで送る)
  async commitGeometry(p, i, next, toPage = p) {
    const g = this.itemGeometry(p, i);
    const size = M.sizeOf(SPEC, next);
    const resized = Math.abs(size.w - g.width) > 0.01 || Math.abs(size.h - g.height) > 0.01;
    const item = this.issue.pages[p].items[i];
    if (resized && item.type === 'panel' && !item.table) await this.ensureSizes(M.photoSources(item));   // 写真が1枚なら範囲いっぱいにするため
    const prepared = resized && this.needsMaterialize(item) ? await this.materialized(p, i) : null;
    const r = this.apply((issue) => M.moveToPage(SPEC, issue, p, i, toPage, next, prepared, this.sizes));
    if (r && toPage !== p) {
      this.reveal = { page: toPage, index: r.index };
      this.select({ kind: 'item', page: toPage, index: r.index });
    }
  }

  // 選んでいる配置物を、となりのページへ移す(direction: -1 前、+1 次)
  moveSelectedToPage(direction) {
    const s = this.selection;
    if (s?.kind !== 'item') return;
    const t = M.adjacentTarget(SPEC, this.issue, s.page, s.index, direction);
    if (t.error) {
      this.toast(t.error, { bad: true });
      return;
    }
    this.commitGeometry(s.page, s.index, t.rect, t.page);
  }

  // 自動で並べる: いま見えている範囲(切り抜き)のまま、写真を縦横比を保って敷き詰める
  async autoArrange() {
    const s = this.selection;
    if (s?.kind !== 'item') return;
    const mat = await this.materialized(s.page, s.index);
    if (!mat.photos?.length) {
      this.toast('並べる写真がありません。', { bad: true });
      return;
    }
    this.apply((issue) => M.replaceItem(issue, s.page, s.index, arrangePanel(SPEC, mat, this.panelSize(s.page, s.index), this.sizes)));
  }

  // ---- 収める手伝い ----

  // 記事があふれた(空きすぎた)とき、直し方の候補を試しに組んで、効くものだけを残す
  async findFits(articleId) {
    await this.render();
    const base = this.result;
    const baseIssue = this.issue;
    const baseTexts = this.texts;
    this.fits = { articleId, status: 'searching', list: [], baseIssue, baseTexts };
    this.inspector.refreshLive();
    const list = [];
    for (const c of fitCandidates(SPEC, baseIssue, base, articleId).slice(0, 40)) {
      if (this.issue !== baseIssue || this.texts !== baseTexts) return;   // 探している間に直したら、やめる
      const r = await this.trialRender(c.issue);
      const ok = r && judgeFit(base, r, articleId, SPEC.underfullLines);
      if (ok) list.push({ ...c, ...ok });
      if (list.length >= 8) break;
    }
    // 空きすぎにならないものを先に、そのなかで変える量の少ない順
    const snug = (x) => (x.emptyLines > SPEC.underfullLines ? 1 : 0);
    list.sort((a, b) => snug(a) - snug(b) || a.cost - b.cost || a.emptyLines - b.emptyLines);
    this.fits = { ...this.fits, status: 'done', list: list.slice(0, 5) };
    this.inspector.refreshLive();
  }

  // 探した直し方が、いまの設定に対するものか(探したあとで直していたら使えない)
  currentFits(articleId) {
    const f = this.fits;
    if (!f || f.articleId !== articleId) return null;
    if (f.baseIssue !== this.issue || f.baseTexts !== this.texts) {
      this.fits = null;
      return null;
    }
    return f;
  }

  applyFit(articleId, n) {
    const f = this.currentFits(articleId);
    const fit = f?.list[n];
    if (!fit) return;
    this.fits = null;
    this.apply(() => fit.issue);
  }

  // 紙面を見えない所で試しに組み、結果だけを返す(画面の紙面は変えない)
  async trialRender(issue) {
    const v = validateIssue(issue, SPEC);
    if (v.errors.length) return null;
    const stage = document.createElement('div');
    stage.className = 'stage';
    $('#canvas').appendChild(stage);
    try {
      const r = await renderIssue({
        root: stage,
        issue,
        readText: async (f) => {
          if (this.texts.has(f)) return this.texts.get(f);
          throw new Error(f);
        },
        assetUrl: this.api.url,
        publication: this.publication,
        pubUrl: this.api.wsUrl,
      });
      return { ...r, errors: [...v.errors, ...r.errors], warnings: [...v.warnings, ...r.warnings] };
    } catch {
      return null;
    } finally {
      stage.remove();
    }
  }

  // ---- 組版 ----

  scheduleRender(delay = 150) {
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => this.render(), delay);
  }

  // issue を渡すと、確定前の配置(ドラッグ中の案)で組む
  // 組むのに使う画像(号の写真と題字の画像)。静的ページ版は、組む前に読み込んで URL を作っておく
  assetPaths(issue = this.issue) {
    const photos = new Set();
    for (const page of issue.pages ?? []) {
      for (const it of page.items ?? []) if (it.type === 'panel' && !it.table) for (const s of M.photoSources(it)) photos.add(s);
    }
    const ws = this.publication.masthead.items.filter((it) => it.type === 'image').map((it) => it.src);
    return { photos: [...photos], ws };
  }

  async render(issue = this.issue) {
    clearTimeout(this.renderTimer);
    const seq = ++this.renderSeq;
    if (this.api.ensureUrls) {
      const { photos, ws } = this.assetPaths(issue);
      await this.api.ensureUrls(photos, ws);
      if (seq !== this.renderSeq) return;
    }
    const v = validateIssue(issue, SPEC);
    if (v.errors.length) {
      // 設定に誤りがある間は、前の紙面を残して理由だけ出す
      this.result = { errors: v.errors, warnings: v.warnings, articles: [], slots: this.result?.slots ?? [] };
      this.afterRender();
      return;
    }
    // 見えない場所で組んでから差し替える(組版の測り方は PDF と同じ)
    const stage = document.createElement('div');
    stage.className = 'stage';
    $('#canvas').appendChild(stage);
    let r;
    try {
      r = await renderIssue({
        root: stage,
        issue,
        readText: async (f) => {
          if (this.texts.has(f)) return this.texts.get(f);
          throw new Error(f);
        },
        assetUrl: this.api.url,
        publication: this.publication,
        pubUrl: this.api.wsUrl,
      });
    } catch (e) {
      stage.remove();
      this.toast(`組版に失敗しました: ${e.message}`, { bad: true });
      return;
    }
    if (seq !== this.renderSeq) {
      stage.remove();
      return;
    }
    const changed = approvalWarning(issue, this.texts, this.publication);
    const pub = this.pub ?? { errors: [], warnings: [] };
    this.result = { ...r, errors: [...pub.errors, ...v.errors, ...r.errors], warnings: [...pub.warnings, ...v.warnings, ...r.warnings, ...(changed ? [changed] : [])] };
    const pages = document.createElement('div');
    pages.id = 'pages';
    for (const pageEl of [...stage.children].filter((n) => n.classList.contains('page'))) {
      const n = Number(pageEl.dataset.page);
      const wrap = document.createElement('div');
      wrap.className = 'pagewrap';
      const label = document.createElement('div');
      label.className = 'pagelabel';
      label.innerHTML = `<span>${n}面${issue.pages[n - 1].template === 'front' ? '(題字つき)' : ''}</span><button type="button" data-page-remove="${n - 1}">このページを消す</button>`;
      wrap.append(label, pageEl);
      pages.appendChild(wrap);
    }
    stage.remove();
    $('#pages').replaceWith(pages);
    this.afterRender();
  }

  afterRender() {
    this.decorate();
    this.inspector.update();
    this.updateStatus();
    this.shell.update();
    this.pageList.schedule();
    this.genko.update();
    this.panelEditor.refresh();
    this.printCheck.render();
    this.checkFreshPhotos();
    // ドラッグ中なら、差し替わった紙面に案の枠を描き直す
    const d = this.drag;
    if (d) {
      d.pageEl = this.pageEl(d.target) ?? d.pageEl;
      if (d.next) this.showGhost(d.pageEl, d.next, d.check);
    }
    // 別のページへ移したら、移した先が見えるように送る
    if (this.reveal) {
      const el = this.pageEl(this.reveal.page)?.querySelector(`.item[data-item="${this.reveal.index}"]`);
      this.reveal = null;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }

  // ドラッグ中の案で組み直す。組んでいる途中なら、終わってから最新の案で組む
  async preview(issue) {
    this.pendingPreview = issue;
    if (this.previewing) return;
    this.previewing = true;
    while (this.pendingPreview) {
      const next = this.pendingPreview;
      this.pendingPreview = null;
      await this.render(next);
    }
    this.previewing = false;
  }

  pageEl(p) {
    return document.querySelector(`#pages .page[data-page="${p + 1}"]`);
  }

  placeRect(el, rect) {
    const [top, bottom] = itemY(SPEC, rect);
    Object.assign(el.style, { left: mm(rect.left), top: mm(top), width: mm(rect.right - rect.left), height: mm(bottom - top) });
  }

  // 選択の枠と取っ手、選んだ記事の本文の枠
  decorate() {
    document.querySelectorAll('#pages .sel').forEach((n) => n.remove());
    document.querySelectorAll('#pages .slot.chosen').forEach((n) => n.classList.remove('chosen'));
    const s = this.selection;
    if (s?.kind === 'item' && !this.drag) {
      const pageEl = this.pageEl(s.page);
      const g = this.itemGeometry(s.page, s.index);
      if (!pageEl || !g) return;
      const box = document.createElement('div');
      box.className = 'sel';
      this.placeRect(box, g);
      box.innerHTML = ['l', 'r', 't', 'b'].map((e) => `<span class="handle" data-edge="${e}"></span>`).join('');
      pageEl.appendChild(box);
    } else if (s?.kind === 'article') {
      document.querySelectorAll(`#pages .slot[data-article="${CSS.escape(s.id)}"]`).forEach((n) => n.classList.add('chosen'));
    }
  }

  // ---- 紙面の上の操作 ----

  bindEvents() {
    const canvas = $('#canvas');
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('click', (e) => {
      const b = e.target.closest('[data-page-remove]');
      if (b) this.removePage(Number(b.dataset.pageRemove));
    });
    canvas.addEventListener('dblclick', (e) => {
      if (e.target.closest('.item.masthead')) {
        this.mastheadEditor.open();
        return;
      }
      const panel = this.photoPanelAt(e.target);
      if (panel) this.panelEditor.open(panel.page, panel.index);
    });
    canvas.addEventListener('dragover', (e) => this.onDragOver(e));
    canvas.addEventListener('dragleave', (e) => { if (!canvas.contains(e.relatedTarget)) this.setDropTarget(null); });
    canvas.addEventListener('drop', (e) => this.onDrop(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('beforeunload', (e) => {
      if (this.dirtyFiles().length && !this.leaving) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    // 画面のどこのボタンでも: data-ws は作業の画面の切り替え、data-cmd は命令(上の帯・道具の帯・各画面のボタン)
    document.addEventListener('click', (e) => {
      const ws = e.target.closest('button[data-ws]');
      if (ws) {
        this.shell.setWorkspace(ws.dataset.ws);
        return;
      }
      const b = e.target.closest('[data-cmd]');
      if (b && !b.disabled) this.command(b.dataset.cmd);
    });
    $('#debug').addEventListener('change', (e) => document.body.classList.toggle('debug', e.target.checked));
    $('#photo-input').addEventListener('change', (e) => {
      const s = this.selection;
      if (s?.kind === 'item') this.uploadAndAdd([...e.target.files], { page: s.page, index: s.index });
      e.target.value = '';
    });
    $('#photo-import').addEventListener('change', (e) => {
      this.genko.importPhotos([...e.target.files]);
      e.target.value = '';
    });
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    const pageEl = e.target.closest('.page');
    if (!pageEl) return;
    const p = Number(pageEl.dataset.page) - 1;
    const handle = e.target.closest('.handle');
    if (handle && this.selection?.kind === 'item') {
      this.startDrag(e, pageEl, p, this.selection.index, 'resize', handle.dataset.edge);
      return;
    }
    const itemEl = e.target.closest('.item[data-item]');
    if (itemEl?.dataset.item === 'masthead') {
      this.select(null);
      this.toast('題字は「紙名と題字の設定」で作ります(題字をダブルクリックすると開きます)。');
      return;
    }
    if (itemEl) {
      const i = Number(itemEl.dataset.item);
      if (this.selectionKey() !== `item:${p}:${i}`) this.select({ kind: 'item', page: p, index: i });
      this.startDrag(e, pageEl, p, i, 'move');
      return;
    }
    const slot = e.target.closest('.slot');
    if (slot?.dataset.article) this.select({ kind: 'article', id: slot.dataset.article });
    else this.select(null);
  }

  startDrag(e, pageEl, p, i, mode, edge = null) {
    const orig = this.itemGeometry(p, i);
    if (!orig) return;
    e.preventDefault();
    // 前のドラッグの「離した」を受け取りそこねていたら(ウィンドウの外で離したなど)、それは捨てる
    if (this.drag) {
      this.drag.stop();
      this.drag = null;
      document.querySelectorAll('#pages .ghost').forEach((n) => n.remove());
      this.scheduleRender(0);   // 途中の案を見せていたら、確定している配置に戻す
    }
    const r = pageEl.getBoundingClientRect();
    const k = 210 / r.width;
    // grab: 配置物の左上から、つかんだ所までの距離(mm)。別のページへ運ぶときに使う
    const grab = { x: (e.clientX - r.left) * k - orig.left, y: (e.clientY - r.top) * k - itemY(SPEC, orig)[0] };
    const d = { mode, edge, page: p, target: p, index: i, pageEl, x0: e.clientX, y0: e.clientY, k, grab, orig, next: null, check: null, moved: false, prepared: null, last: null };
    this.drag = d;
    // 写真パネルの大きさを変えるときは、「枠 + 切り抜き」に直したもので案を組む(確定したときと同じ見え方にする)
    if (mode === 'resize' && this.needsMaterialize(this.issue.pages[p].items[i])) {
      this.materialized(p, i).then((m) => { d.prepared = m; });
    }
    const canvas = $('#canvas');
    const move = (ev) => {
      d.last = ev;
      this.onDragMove(ev);
    };
    const scrolled = () => { if (d.last) this.onDragMove(d.last); };   // ホイールや自動の送りで紙面が動いたとき
    const up = () => {
      d.stop();
      this.onDragEnd();
    };
    d.stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      canvas.removeEventListener('scroll', scrolled);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    canvas.addEventListener('scroll', scrolled);
    if (mode === 'move') this.autoScroll(d);
  }

  // 動かしている間、ポインタが紙面の上端・下端の近くにあれば紙面を送る(別のページへ運べるように)
  autoScroll(d) {
    const canvas = $('#canvas');
    const EDGE = 56;
    const step = () => {
      if (this.drag !== d) return;
      if (d.last && d.moved) {
        const r = canvas.getBoundingClientRect();
        const y = d.last.clientY;
        const over = y < r.top + EDGE ? y - (r.top + EDGE) : y > r.bottom - EDGE ? y - (r.bottom - EDGE) : 0;
        if (over) canvas.scrollTop += Math.sign(over) * Math.min(28, 4 + Math.abs(over) / 2);
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // 画面の縦の位置 y にあるページの番号(ページの間なら null)
  pageIndexAt(y) {
    for (const el of document.querySelectorAll('#pages .page')) {
      const r = el.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) return Number(el.dataset.page) - 1;
    }
    return null;
  }

  onDragMove(e) {
    const d = this.drag;
    if (!d) return;
    const dx = (e.clientX - d.x0) * d.k;
    const dy = (e.clientY - d.y0) * d.k;
    if (!d.moved && Math.hypot(dx, dy) < 1.2) return;   // わずかな動きはクリックとみなす
    d.moved = true;
    const o = d.orig;
    let next;
    if (d.mode === 'move') {
      // ポインタの下のページへ運ぶ(ページの間にいるときは、さっきまでのページ)。位置はそのページの上で測る
      const target = this.pageIndexAt(e.clientY) ?? d.target;
      if (target !== d.target) {
        document.querySelectorAll('#pages .ghost').forEach((n) => n.remove());
        d.target = target;
        d.pageEl = this.pageEl(target);
      }
      const pr = d.pageEl.getBoundingClientRect();
      const left = (e.clientX - pr.left) * d.k - d.grab.x;
      const top = (e.clientY - pr.top) * d.k - d.grab.y;
      const steps = Math.round((top - itemY(SPEC, o)[0]) / DAN_STEP);
      next = { ...snapMove(SPEC, o, left - o.left), dan: shiftDan(SPEC, o.dan, steps), ...yOf(o) };
    } else if (d.edge === 'l') next = { ...snapResizeLeft(SPEC, o, o.left + dx), dan: o.dan, ...yOf(o) };
    else if (d.edge === 'r') next = { ...snapResizeRight(SPEC, o, o.right + dx), dan: o.dan, ...yOf(o) };
    else {
      // 上端・下端は段の中の字のマス目に吸着する(段の途中まで張り出せる)
      const [top, bottom] = itemY(SPEC, o);
      next = { left: o.left, right: o.right, ...snapEdgeY(SPEC, o, d.edge, (d.edge === 't' ? top : bottom) + dy) };
    }
    const key = `${d.target}|${next.left}|${next.right}|${next.dan}|${next.from}|${next.to}`;
    d.next = next;
    d.check = M.canPlace(SPEC, this.issue.pages[d.target], next, d.target === d.page ? d.index : null);
    document.querySelectorAll('#pages .sel').forEach((n) => n.remove());
    this.showGhost(d.pageEl, next, d.check);
    // 置ける案なら、その配置で本文を組み直して見せる(確定は指を離したとき)
    if (d.check.ok && key !== d.lastKey) {
      d.lastKey = key;
      this.preview(M.moveToPage(SPEC, this.issue, d.page, d.index, d.target, next, d.prepared, this.sizes).issue);
    }
  }

  onDragEnd() {
    const d = this.drag;
    this.drag = null;
    document.querySelectorAll('#pages .ghost').forEach((n) => n.remove());
    if (!d?.moved || !d.next) {
      this.decorate();
      return;
    }
    const same = d.target === d.page && sameRect(d.next, d.orig);
    if (!d.check.ok || same) {
      if (!d.check.ok) this.toast(d.check.reason, { bad: true });
      if (d.lastKey) this.scheduleRender(0);   // 途中の案を見せていたら元の配置に戻す
      else this.decorate();
      return;
    }
    this.commitGeometry(d.page, d.index, d.next, d.target);
  }

  showGhost(pageEl, rect, check) {
    let g = pageEl.querySelector('.ghost');
    if (!g) {
      g = document.createElement('div');
      g.className = 'ghost';
      g.innerHTML = '<span class="info"></span>';
      pageEl.appendChild(g);
    }
    this.placeRect(g, rect);
    g.classList.toggle('bad', !check.ok);
    const lines = Math.round(((rect.right - rect.left + 2 * SPEC.wrapGap) / linePitch(SPEC)) * 10) / 10;
    g.firstChild.textContent = check.ok ? `${rangeLabel(rect)}・幅 ${lines}行` : check.reason;
  }

  onKey(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (this.mastheadEditor.isOpen) {
      this.mastheadEditor.onKey(e);
      return;
    }
    if (ctrl && key === 's') {
      e.preventDefault();
      this.save();
      return;
    }
    if (this.spread.isOpen) {
      this.spread.onKey(e);
      return;
    }
    if (!this.panelEditor.isOpen && this.shell.handleKey(e)) return;   // Esc で小窓を閉じる・Alt+1/2/3 で画面を切り替える
    if (this.cleanup.isOpen) {
      this.cleanup.onKey(e);
      return;
    }
    if (e.target.closest('input, textarea, select')) return;   // 入力欄の中は入力欄に任せる
    if (this.panelEditor.isOpen) {
      this.panelEditor.onKey(e);
      return;
    }
    if (ctrl && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (ctrl && key === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    if (this.shell.ws !== 'shimen') return;   // 配置物の操作は紙面の画面でだけ
    if (e.key === 'Escape') {
      this.select(null);
      return;
    }
    if (ctrl && key === 'v' && this.clipboard) {
      e.preventDefault();
      this.paste();
      return;
    }
    const s = this.selection;
    if (s?.kind !== 'item') return;
    if (ctrl && (key === 'c' || key === 'd')) {
      e.preventDefault();
      if (key === 'c') this.copySelected();
      else this.duplicateSelected();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.removeSelected();
      return;
    }
    const g = this.itemGeometry(s.page, s.index);
    let next = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      next = { ...(e.shiftKey ? stepResize(SPEC, g, dir) : stepMove(SPEC, g, dir)), dan: g.dan, ...yOf(g) };
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      if (e.altKey) next = { left: g.left, right: g.right, ...stepEdgeY(SPEC, g, dir) };   // 下端を1字ずつ
      else next = { left: g.left, right: g.right, dan: e.shiftKey ? resizeDan(SPEC, g.dan, 'end', dir) : shiftDan(SPEC, g.dan, dir), ...yOf(g) };
    }
    if (!next) return;
    e.preventDefault();
    if (sameRect(next, g)) return;
    const check = M.canPlace(SPEC, this.issue.pages[s.page], next, s.index);
    if (!check.ok) {
      this.toast(check.reason, { bad: true });
      return;
    }
    this.commitGeometry(s.page, s.index, next);
  }

  // ---- 写真のドロップ ----

  setDropTarget(el) {
    document.querySelectorAll('#pages .drop-target').forEach((n) => { if (n !== el) n.classList.remove('drop-target'); });
    el?.classList.add('drop-target');
  }

  photoPanelAt(target) {
    const panel = target.closest('.item.panel[data-item]');
    if (!panel) return null;
    const p = Number(panel.closest('.page').dataset.page) - 1;
    const i = Number(panel.dataset.item);
    return this.issue.pages[p].items[i].table ? null : { page: p, index: i, el: panel };
  }

  onDragOver(e) {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    this.setDropTarget(this.photoPanelAt(e.target)?.el ?? null);
  }

  onDrop(e) {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    this.setDropTarget(null);
    const files = [...e.dataTransfer.files];
    const panel = this.photoPanelAt(e.target);
    if (panel) {
      this.uploadAndAdd(files, panel);
      return;
    }
    const pageEl = e.target.closest('.page');
    if (!pageEl) return;
    // 空きへ落としたら、その段に 10行 × 1段 の写真パネルを作る。置けなければ同じページの空きを探す
    const p = Number(pageEl.dataset.page) - 1;
    const r = pageEl.getBoundingClientRect();
    const k = 210 / r.width;
    const x = (e.clientX - r.left) * k;
    const d = danAt((e.clientY - r.top) * k);
    const width = 10 * linePitch(SPEC) - 2 * SPEC.wrapGap;
    let rect = { ...snapMove(SPEC, { left: x - width / 2, right: x + width / 2 }, 0), dan: [d, d] };
    if (!M.canPlace(SPEC, this.issue.pages[p], rect).ok) rect = M.findFreeSpot(SPEC, this.issue.pages[p], 10, 1);
    if (!rect) {
      this.toast('このページには写真パネルを置く空きがありません。', { bad: true });
      return;
    }
    this.uploadAndAdd(files, { page: p, rect });
  }

  pickPhotos() {
    $('#photo-input').click();
  }

  // 写真を photos/ に送る。戻り値は号フォルダからのパス(送れなかったものは理由を出して飛ばす)
  async uploadPhotos(files) {
    const paths = [];
    for (const f of files) {
      if (!PHOTO_TYPES.test(f.type)) {
        this.toast(`${f.name}: 写真は jpg・png・webp・gif にしてください。`, { bad: true });
        continue;
      }
      try {
        this.suppressUntil = Date.now() + 3000;
        paths.push(await this.api.uploadPhoto(f));
      } catch (err) {
        this.toast(`${f.name}: ${err.message}`, { bad: true });
      }
    }
    // 取り込んだ写真の解像度は、パネルに置いて組んだあとで調べて知らせる(afterRender)
    for (const p of paths) this.freshPhotos.add(p);
    return paths;
  }

  // 取り込んだばかりの写真のうち、置いた大きさで解像度が足りないものを知らせる
  checkFreshPhotos() {
    if (!this.freshPhotos.size || !this.result) return;
    const low = this.result.warnings.filter((w) => w.code === 'W_IMAGE_LOW_DPI' && this.freshPhotos.has(w.src));
    this.freshPhotos.clear();
    if (!low.length) return;
    const list = low.map((w) => `${w.src.replace(/^photos\//, '')}(約${w.dpi}dpi)`).join('、');
    this.toast(`取り込んだ写真の解像度が低めです: ${list}。この大きさでは印刷で粗く見えるおそれがあります(目安 ${SPEC.dpi.warn}dpi)。LINE などで送られて小さくなった写真なら、元の写真をもらうときれいに刷れます。`, { bad: true, ms: 12000 });
  }

  // 写真を photos/ に送ってから、パネルに足す(target.index があればそのパネル、なければ target.rect に新しいパネル)
  async uploadAndAdd(files, target) {
    const paths = await this.uploadPhotos(files);
    if (!paths.length) return;
    this.genko.loadFiles().then(() => this.genko.update());
    await this.addPhotosTo(paths, target);
  }

  // 号フォルダにある写真(paths)をパネルに足す
  async addPhotosTo(paths, target) {
    if (target.index != null) {
      const { page: p, index: i } = target;
      let fn = (issue) => paths.reduce((acc, src) => M.addPhoto(acc, p, i, src), issue);
      if (Array.isArray(this.issue.pages[p].items[i].photos)) {
        // 写真を座標で置いているパネル: 写真全体を縦横比どおりの枠で、ほかの写真と重ならない所に置く
        const sizes = await this.ensureSizes(paths);
        const panel = this.panelSize(p, i);
        fn = (issue) => paths.reduce((acc, src) => M.addPhotoFrame(SPEC, acc, p, i, src, sizes.get(src) ?? { w: 4, h: 3 }, panel), issue);
      }
      if (this.apply(fn)) this.select({ kind: 'item', page: p, index: i });
      return;
    }
    const out = this.apply((issue) => M.addItem(SPEC, issue, target.page, 'panel', { rect: target.rect, rows: [paths] }));
    if (out) this.select({ kind: 'item', page: target.page, index: out.index });
  }

  photoAction(kind, n, value) {
    const s = this.selection;
    if (s?.kind !== 'item') return;
    const { page: p, index: i } = s;
    if (kind === 'move') this.apply((issue) => M.movePhoto(issue, p, i, n, value));
    else if (kind === 'remove') this.apply((issue) => M.removePhoto(issue, p, i, n));
    else if (kind === 'row') this.apply((issue) => M.setPhotoRow(issue, p, i, n, value));
    else if (kind === 'focus') this.apply((issue) => M.setPhotoFocus(issue, p, i, n, value));
  }

  // ---- 足す・消す ----

  // いま見ているページ(選んでいるものがあればそのページ)
  currentPage() {
    const s = this.selection;
    if (s?.kind === 'item') return s.page;
    if (s?.kind === 'article') {
      const a = this.issue.articles.find((x) => x.id === s.id);
      return (a?.start?.page ?? 1) - 1;
    }
    return this.visiblePage();
  }

  // 紙面の画面でいちばん大きく見えているページ
  visiblePage() {
    const view = $('#canvas').getBoundingClientRect();
    let best = 0;
    let bestArea = -1;
    document.querySelectorAll('#pages .page').forEach((el) => {
      const r = el.getBoundingClientRect();
      const area = Math.max(0, Math.min(r.bottom, view.bottom) - Math.max(r.top, view.top));
      if (area > bestArea) {
        bestArea = area;
        best = Number(el.dataset.page) - 1;
      }
    });
    return best;
  }

  articleForPage(p) {
    const s = this.selection;
    if (s?.kind === 'article') return s.id;
    const slot = (this.result?.slots ?? []).find((x) => x.page === p + 1 && x.article);
    return slot?.article ?? this.issue.articles[0]?.id ?? null;
  }

  addItem(kind, articleId = null) {
    let p = this.currentPage();
    const extra = {};
    if (kind === 'title' || kind === 'lead') {
      extra.article = articleId ?? this.articleForPage(p);
      if (!extra.article) {
        this.toast('先に記事を足してください。', { bad: true });
        return;
      }
      if (articleId) p = (this.issue.articles.find((a) => a.id === articleId)?.start?.page ?? p + 1) - 1;
    }
    // 表と囲み記事は、中身を書く .txt を号フォルダに作る(保存したときに書き出す)
    let newFile = null;
    if (kind === 'table' || kind === 'box') {
      newFile = M.uniqueName(kind === 'table' ? 'hyo' : 'kakomi', new Set(this.texts.keys()), '.txt');
      if (kind === 'table') extra.table = newFile;
      else extra.file = newFile;
    }
    const out = this.apply((issue) => M.addItem(SPEC, issue, p, kind, extra));
    if (!out) return;
    if (newFile) this.texts = new Map(this.texts).set(newFile, kind === 'table' ? TABLE_TEMPLATE : BOX_TEMPLATE);
    this.select({ kind: 'item', page: p, index: out.index });
  }

  // 新しい記事は、最後の記事の本文が終わった次の枠から始める
  nextStart() {
    const slots = this.result?.slots ?? [];
    if (!slots.length) return null;
    const last = this.issue.articles.at(-1);
    const a = this.result.articles.find((x) => x.id === last?.id);
    let idx = slots.length - 1;
    const lastBox = a ? [...a.boxes].reverse().find((b) => b.chars > 0) : null;
    if (lastBox) {
      const k = slots.findIndex((s) => s.page === lastBox.page && s.dan === lastBox.dan && s.index === lastBox.index);
      if (k >= 0 && k + 1 < slots.length) idx = k + 1;
    }
    const s = slots[idx];
    return { page: s.page, dan: s.dan, ...(s.index > 1 ? { slot: s.index } : {}) };
  }

  addArticle() {
    const start = this.nextStart();
    if (!start) {
      this.toast('記事を始める場所がありません。ページを足してください。', { bad: true });
      return;
    }
    const id = M.uniqueName('kiji', new Set(this.issue.articles.map((a) => a.id)));
    const file = M.uniqueName(id, new Set([...this.texts.keys(), ...this.issue.articles.map((a) => a.file)]), '.txt');
    const out = this.apply((issue) => M.addArticle(issue, id, file, start));
    if (!out) return;
    this.texts = new Map(this.texts).set(file, ARTICLE_TEMPLATE);
    this.select({ kind: 'article', id });
    this.genko.update(true);
  }

  // ---- 場所へ移る(左の欄・検査の一覧・原稿の画面から) ----

  showPage(p) {
    this.shell.setWorkspace('shimen');
    this.pageEl(p)?.scrollIntoView({ block: 'start' });
    this.pageList.markCurrent();
  }

  showItem(p, i) {
    this.shell.setWorkspace('shimen');
    this.select({ kind: 'item', page: p, index: i });
    this.pageEl(p)?.querySelector(`.item[data-item="${i}"]`)?.scrollIntoView({ block: 'center' });
  }

  showArticle(id) {
    this.shell.setWorkspace('shimen');
    this.select({ kind: 'article', id });
    document.querySelector(`#pages .slot[data-article="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' });
  }

  // 原稿の画面で、その記事を開く
  openInGenko(id) {
    this.genko.current = id;
    this.shell.setWorkspace('genko');
    this.genko.update(true);
  }

  removeSelected() {
    const s = this.selection;
    if (s?.kind !== 'item') return;
    if (this.apply((issue) => M.removeItem(issue, s.page, s.index))) this.select(null);
  }

  // ---- 写し(Ctrl+C・Ctrl+V・Ctrl+D) ----

  // 選んでいる配置物を、エディタの中の写し置き場に入れる(表・囲み記事は中身の原稿も)
  copySelected() {
    const s = this.selection;
    if (s?.kind !== 'item') return false;
    const item = this.issue.pages[s.page].items[s.index];
    const file = M.itemFile(item);
    this.clipboard = { item: structuredClone(item), text: file ? this.texts.get(file) ?? '' : null };
    this.toast('写しました。Ctrl+V で、見ているページに貼り付けます。');
    return true;
  }

  // 写しを貼る。同じ位置が空いていればそこへ、なければ同じ大きさの空きへ
  paste(page = this.currentPage()) {
    const c = this.clipboard;
    if (!c) return;
    const rect = M.placeFor(SPEC, this.issue.pages[page], M.rectOf(SPEC, c.item));
    if (!rect) {
      this.toast(`${page + 1}面には、この大きさの空きがありません。`, { bad: true });
      return;
    }
    let newFile = null;
    if (c.text != null) newFile = M.uniqueName(c.item.table ? 'hyo' : 'kakomi', new Set(this.texts.keys()), '.txt');
    const r = this.apply((issue) => M.duplicateItem(SPEC, issue, page, c.item, rect, newFile));
    if (!r) return;
    if (newFile) this.texts = new Map(this.texts).set(newFile, c.text);
    this.reveal = { page, index: r.index };
    this.select({ kind: 'item', page, index: r.index });
  }

  duplicateSelected() {
    const s = this.selection;
    if (s?.kind !== 'item') return;
    const keep = this.clipboard;
    if (!this.copySelected()) return;
    this.paste(s.page);
    this.clipboard = keep;   // 複製は写し置き場を変えない
  }

  removeArticle(id) {
    if (!confirm(`記事「${this.articleTitle(id)}」を号から外します(原稿ファイルは残ります)。よろしいですか?`)) return;
    if (this.apply((issue) => M.removeArticle(issue, id))) this.select(null);
  }

  removePage(p) {
    if (!confirm(`${p + 1}面を消します。載っている配置物も消えます。よろしいですか?`)) return;
    if (this.apply((issue) => M.removePage(issue, p))) this.select(null);
  }

  // ---- 命令(上の帯・道具の帯・各画面のボタン) ----

  command(cmd) {
    if (cmd === 'save') this.save();
    else if (cmd === 'theme') this.shell.toggleTheme();
    else if (cmd === 'help') this.shell.toggle('help');
    else if (cmd === 'issue') this.shell.toggle('issue');
    else if (cmd === 'switch-issue') location.reload();   // 静的ページ版: はじめの画面へ(保存していない変更があればブラウザが尋ねる)
    else if (cmd === 'signout') {
      // トークンを先に消すので、ブラウザの「このサイトを離れますか」で止められると保存できなくなる。ここで先に尋ねる
      if (this.dirtyFiles().length && !confirm('保存していない変更があります。捨ててサインアウトしますか?')) return;
      this.leaving = true;
      this.api.signOut?.();
    }
    else if (cmd === 'publication') {
      this.shell.close();
      this.mastheadEditor.open();
    }
    else if (cmd === 'checks') this.shell.toggle('checks');
    else if (cmd === 'undo') this.undo();
    else if (cmd === 'redo') this.redo();
    else if (cmd === 'add-panel') this.addItem('panel');
    else if (cmd === 'add-table') this.addItem('table');
    else if (cmd === 'add-box') this.addItem('box');
    else if (cmd === 'add-title') this.addItem('title');
    else if (cmd === 'add-lead') this.addItem('lead');
    else if (cmd === 'add-article') this.addArticle();
    else if (cmd === 'add-page') this.apply((issue) => M.addPage(issue));
    else if (cmd === 'pdf') this.buildPdf();
    else if (cmd === 'spread') this.spread.open((this.shell.ws === 'shimen' ? this.currentPage() : 0) + 1);
    else if (cmd === 'print-check') this.printCheck.open();
  }

  // 刷る前に確認していただく版などの、ふつうの PDF(A4)。入稿の画面のボタンから
  async buildPdf() {
    if (this.pdfBusy) return;
    if (!this.api.canBuild) {
      // 静的ページ版: 印刷の画面で「PDF に保存」を選んでもらう
      this.printPdf();
      return;
    }
    if (this.dirtyFiles().length && !(await this.save())) return;
    this.pdfBusy = true;
    this.printCheck.render();
    try {
      const r = await this.api.build();
      if (r.pdf) {
        this.lastPdf = r.pdf;
        const link = document.createElement('a');
        link.href = `${r.pdf}?t=${Date.now()}`;
        link.target = '_blank';
        link.textContent = '開く';
        this.toast(`PDFを作りました(${r.pages}ページ)。`, { link, ms: 15000 });
      } else {
        this.toast(`PDFを作れませんでした: ${r.errors.map((x) => x.message).join(' / ')}`, { bad: true, ms: 15000 });
      }
    } catch (e) {
      this.toast(`PDFを作れませんでした: ${e.message}`, { bad: true });
    } finally {
      this.pdfBusy = false;
      this.printCheck.render();
    }
  }

  // 静的ページ版の PDF: 印刷の画面を開く(A3 の面付けは sides を渡す)
  printPdf(sides = null) {
    const files = printFiles(this.issue.number, this.publication.fileName);
    const title = (sides ? files.a3 : files.a4).replace(/\.pdf$/, '');
    this.toast('印刷の画面で、送信先を「PDF に保存」にして保存してください(倍率・余白は変えずに)。', { ms: 8000 });
    printPages({ title, sides });
  }

  // ---- 表示 ----

  setStatus(text) {
    $('#status').textContent = text;
  }

  updateStatus() {
    if (!this.issue) return;
    const dirty = this.dirtyFiles().length > 0;
    const st = $('#status');
    st.textContent = dirty ? '未保存の変更があります' : '保存済み';
    st.className = `savestate${dirty ? ' dirty' : ''}`;
    document.querySelector('[data-cmd="save"]').disabled = !dirty;
    document.querySelector('[data-cmd="undo"]').disabled = !this.history.length;
    document.querySelector('[data-cmd="redo"]').disabled = !this.future.length;
    document.title = `${dirty ? '● ' : ''}${this.publication.name} 第${this.issue.number}号 エディタ`;
    this.shell.updateNav();
  }

  toast(text, { bad = false, link = null, ms = 4000 } = {}) {
    const t = $('#toast');
    t.textContent = text;
    if (link) {
      t.append(' ');
      t.appendChild(link);
    }
    t.className = bad ? 'bad' : '';
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  // more: ほかのボタン [[ラベル, 押したときの処理], …]
  banner(text, action, fn, more = []) {
    const b = $('#banner');
    b.textContent = text;
    const button = (label, onClick) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.addEventListener('click', onClick);
      return btn;
    };
    b.append(button(action, fn), ...more.map(([label, onClick]) => button(label, onClick)), button('閉じる', () => this.hideBanner()));
    b.hidden = false;
  }

  hideBanner() {
    $('#banner').hidden = true;
  }

  // 号のファイルが外で書き換えられたら読み直す(保存していない変更があれば聞く)
  // ファイルが外で書き換えられたときの知らせを受ける(サーバー版は /__events、静的ページ版は窓口が調べる)
  listen() {
    if (this.api.kind !== 'server') {
      this.api.watch?.((names) => this.onExternalChange(names));
      return;
    }
    const es = new EventSource('/__events');
    es.onmessage = (ev) => this.onExternalChange(ev.data.split('\n'));
  }

  // names: 'issue/…'(号のフォルダ)・'workspace/…'(紙名の設定と題字の画像)・'engine/…'・'editor/…'
  onExternalChange(names) {
    if (names.some((n) => n.startsWith('engine/') || n.startsWith('editor/'))) {
      this.banner('エディタや型のファイルが更新されました。', '再読み込み', () => location.reload());
    }
    // 紙名の設定と題字の画像(号のフォルダの1つ上)
    if (names.some((n) => n === 'workspace/publication.jsonc' || n.startsWith('workspace/brand/'))) {
      this.loadPublication().then(() => {
        this.updateStatus();
        this.scheduleRender(0);
      });
    }
    if (names.some((n) => n.startsWith('issue/photos/'))) {
      this.genko.loadFiles().then(() => this.genko.update());
    }
    if (names.some((n) => n.startsWith('issue/') && !n.startsWith('issue/photos/')) && Date.now() > this.suppressUntil) {
      if (this.dirtyFiles().length) this.banner('号のファイルが外で書き換えられました。保存していない変更があります。', '外の変更を読み込む(こちらの変更は捨てる)', () => this.reloadData());
      else this.reloadData();
    }
  }
}

// 静的ページ版で OneDrive につなぐ部品。Microsoft にアプリを登録していなければ(editor/config.js にクライアント ID がなければ)
// null にして、はじめの画面にも出さない(D-035。共有フォルダは「フォルダを開く」で使う)
async function cloudConnector() {
  try {
    const { OneDriveConnector } = await import('./storage-onedrive.js');
    const c = await OneDriveConnector.fromConfig();
    return c.configured ? c : null;
  } catch {
    return null;
  }
}

async function main() {
  let api = null;
  try {
    api = await connectApi();
  } catch {
    // サーバーがない(GitHub Pages などの静的ページ): はじめの画面で、データの置き場と号を選ぶ
  }
  if (!api) {
    const { StartScreen } = await import('./start.js');
    const start = new StartScreen({ cloud: await cloudConnector(), samplesBase: new URL('../samples/', location.href).href });
    window.YSM_START = start;   // 画面から状態を調べるため(テスト)
    api = await start.run();
  }
  document.body.dataset.storage = api.kind ?? 'server';
  const ed = new Editor(api);
  window.YSM_EDITOR = ed;   // 画面から状態を調べるため
  try {
    await ed.loadPublication();
    await ed.load();
  } catch (e) {
    document.body.innerHTML = `<p style="padding:24px;color:#fff;font-size:15px">${api.issue}/issue.jsonc を読めません: ${e.message}</p>`;
    return;
  }
  ed.bindEvents();
  ed.inspector.update(true);
  ed.updateStatus();
  await ed.genko.loadFiles();
  await ed.render();
  ed.listen();
  if (api.kind === 'demo') ed.banner('見本を開いています。直したものは保存されません(ページを閉じると消えます)。', 'はじめの画面へ', () => location.reload());
}

main();
