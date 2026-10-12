// OneDrive につなぐ(静的ページ版。docs/06-hosting.md)。Microsoft アカウントでサインインし、
// OneDrive の「アプリ」フォルダの中の、このアプリ用のフォルダをワークスペースにする(権限は Files.ReadWrite.AppFolder。
// ほかのファイルには触れない)。
//   - サインインは認可コード + PKCE(パスワードはこのページを通らない。秘密のキーも使わない)
//   - トークンはこのタブの sessionStorage にだけ置く(タブを閉じると消える)。共用のパソコンでは、
//     終わったら「サインアウト」で、ブラウザに残る Microsoft のサインインも終える
//   - 保存するときは、読んだときから OneDrive の中身が変わっていないかを確かめ(If-Match)、
//     ほかのパソコンで書き換えられていたら上書きせずに知らせる(E_CONFLICT)
// 依存パッケージなし(MSAL を使わず、OAuth と Microsoft Graph の REST を fetch で呼ぶ)。窓口は editor/api.js と同じ形。

import { CONFIG } from './config.js';
import { safePhotoName, imageType } from './names.js';
import { summarizeIssues } from './storage-folder.js';

const TOKEN_KEY = 'ysm-onedrive-token';
const FLOW_KEY = 'ysm-onedrive-flow';
const IMAGE = /\.(jpe?g|png|webp|gif)$/i;
const CHUNK = 320 * 1024 * 10;   // 分けて送るときの1回の大きさ(320KiB の倍数)

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function challengeOf(verifier) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(d));
}

// ID トークンから、サインインしたアカウントの名前を取り出す(表示だけに使う)
function accountOf(idToken) {
  try {
    const b = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(Uint8Array.from(atob(b + '==='.slice((b.length + 3) % 4)), (c) => c.charCodeAt(0)));
    const p = JSON.parse(json);
    return p.preferred_username || p.name || '';
  } catch {
    return '';
  }
}

// テストでは、自動操作の側から window.YSM_CONFIG_OVERRIDE で差し替える(URL などからは変えられない)
function settings() {
  return { ...CONFIG.onedrive, ...(globalThis.YSM_CONFIG_OVERRIDE?.onedrive ?? {}) };
}

export class OneDriveConnector {
  // 設定を読み、サインインから戻ってきたところならトークンを受け取る
  static async fromConfig() {
    const c = new OneDriveConnector(settings());
    await c.handleRedirect();
    return c;
  }

  constructor(cfg) {
    this.cfg = cfg;
    this.configured = !!cfg.clientId;
    this.redirectUri = cfg.redirectUri || `${location.origin}${location.pathname}`;
    this.returned = false;   // サインインから戻ってきたところ
    this.error = '';
  }

  get signedIn() {
    return !!this.tokens();
  }

  get account() {
    return this.tokens()?.account ?? '';
  }

  tokens() {
    try {
      return JSON.parse(sessionStorage.getItem(TOKEN_KEY));
    } catch {
      return null;
    }
  }

  saveTokens(t) {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t));
  }

  // Microsoft のサインインの画面へ移る(戻ってくるとページが読み直され、handleRedirect が続きをする)
  async signIn() {
    const verifier = randomString(48);
    const state = randomString(16);
    sessionStorage.setItem(FLOW_KEY, JSON.stringify({ verifier, state }));
    const q = new URLSearchParams({
      client_id: this.cfg.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      response_mode: 'query',
      scope: this.cfg.scopes.join(' '),
      code_challenge: await challengeOf(verifier),
      code_challenge_method: 'S256',
      state,
      prompt: 'select_account',
    });
    location.assign(`${this.cfg.authority}/oauth2/v2.0/authorize?${q}`);
    return new Promise(() => {});   // ページを移るので、ここから先には進まない
  }

  async handleRedirect() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return;
    let flow = null;
    try {
      flow = JSON.parse(sessionStorage.getItem(FLOW_KEY));
    } catch {
      flow = null;
    }
    sessionStorage.removeItem(FLOW_KEY);
    history.replaceState(null, '', location.pathname);   // URL に残った認可コードを消す
    if (q.has('error')) {
      this.error = `サインインできませんでした: ${q.get('error_description') ?? q.get('error')}`;
      return;
    }
    if (!flow || q.get('state') !== flow.state) {
      this.error = 'サインインの確かめができませんでした(state が違います)。もう一度やり直してください。';
      return;
    }
    try {
      this.saveTokens(await this.tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: this.redirectUri, code_verifier: flow.verifier }));
      this.returned = true;
    } catch (e) {
      this.error = e.message;
    }
  }

  async tokenRequest(params) {
    const body = new URLSearchParams({ client_id: this.cfg.clientId, scope: this.cfg.scopes.join(' '), ...params });
    const r = await fetch(`${this.cfg.authority}/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`サインインできませんでした: ${j.error_description ?? j.error ?? r.status}`);
    return { access: j.access_token, refresh: j.refresh_token ?? null, expires: Date.now() + (j.expires_in ?? 3600) * 1000, account: j.id_token ? accountOf(j.id_token) : (this.account || '') };
  }

  // 有効なアクセストークン(切れかけていれば更新する)
  async accessToken(force = false) {
    const t = this.tokens();
    if (!t) throw Object.assign(new Error('OneDrive にサインインしていません。はじめの画面からつなぎ直してください。'), { code: 'E_SIGNED_OUT' });
    if (!force && t.expires - Date.now() > 120000) return t.access;
    if (!t.refresh) throw Object.assign(new Error('OneDrive のサインインの期限が切れました。はじめの画面からつなぎ直してください。'), { code: 'E_SIGNED_OUT' });
    const n = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh });
    this.saveTokens({ ...n, refresh: n.refresh ?? t.refresh, account: n.account || t.account });
    return n.access;
  }

  // トークンを消し、Microsoft のサインインも終えてから、このページに戻る
  signOut() {
    sessionStorage.removeItem(TOKEN_KEY);
    location.assign(`${this.cfg.authority}/oauth2/v2.0/logout?${new URLSearchParams({ post_logout_redirect_uri: this.redirectUri })}`);
    return new Promise(() => {});
  }

  async connect() {
    if (!this.signedIn) await this.signIn();
    const graph = new Graph(this);
    await graph.ensureRoot();
    return new OneDriveWorkspace(graph);
  }
}

// Microsoft Graph(アプリ用のフォルダ)
class Graph {
  constructor(conn) {
    this.conn = conn;
    this.base = `${conn.cfg.graph}/me/drive/special/approot`;
  }

  url(path, suffix = '') {
    return path ? `${this.base}:/${encPath(path)}:${suffix}` : `${this.base}${suffix}`;
  }

  async request(url, init = {}, tries = 3) {
    const token = await this.conn.accessToken(init.forceToken);
    const { forceToken, ...rest } = init;
    void forceToken;
    const r = await fetch(url, { ...rest, headers: { ...(rest.headers ?? {}), authorization: `Bearer ${token}` } });
    if (r.status === 401 && tries > 1) return this.request(url, { ...init, forceToken: true }, tries - 1);
    if ((r.status === 429 || r.status === 503) && tries > 1) {
      await sleep(Math.min(10, Number(r.headers.get('retry-after')) || 2) * 1000);
      return this.request(url, init, tries - 1);
    }
    return r;
  }

  async fail(r, what) {
    let msg = `${r.status}`;
    try {
      msg = (await r.json()).error?.message ?? msg;
    } catch {
      // JSON でない
    }
    return Object.assign(new Error(`OneDrive の${what}: ${msg}`), { status: r.status });
  }

  async json(url, what) {
    const r = await this.request(url);
    if (r.status === 404) return null;
    if (!r.ok) throw await this.fail(r, what);
    return r.json();
  }

  // アプリ用のフォルダ(初めてなら OneDrive が作る)
  async ensureRoot() {
    await this.json(this.base, 'アプリ用のフォルダを開けません');
  }

  async children(path) {
    const out = [];
    let next = `${this.url(path, '/children')}?$select=name,folder,file,lastModifiedDateTime,eTag,cTag`;
    while (next) {
      const j = await this.json(next, `フォルダ ${path || '(一番上)'} を読めません`);
      if (!j) return out;
      out.push(...j.value);
      next = j['@odata.nextLink'] ?? null;
    }
    return out;
  }

  meta(path) {
    return this.json(`${this.url(path)}?$select=name,eTag,cTag,size,lastModifiedDateTime`, `${path} を調べられません`);
  }

  // 中身と、読んだときの版(なければ null)。ブラウザからは /content の転送(302)をたどれないので
  // (Microsoft Graph の説明「Downloading files in JavaScript apps」)、認証の要らない一時的な URL を聞いてから読む。
  // 版を先に聞くので、その間に書き換えられても、保存のときに E_CONFLICT になる側に倒れる
  async download(path) {
    const what = `${path} を調べられません`;
    let meta = await this.json(`${this.url(path)}?select=id,eTag,cTag,@microsoft.graph.downloadUrl`, what);
    if (meta && !meta['@microsoft.graph.downloadUrl']) meta = await this.json(this.url(path), what);
    if (!meta) return null;
    const url = meta['@microsoft.graph.downloadUrl'];
    if (!url) throw new Error(`OneDrive の ${path} はファイルではありません。`);
    const res = await fetch(url);   // 認証は URL に含まれているので、トークンは付けない
    if (!res.ok) throw await this.fail(res, `${path} を読めません`);
    return { res, meta };
  }

  // 書く。ifMatch(読んだときの eTag)があれば、そのあとで書き換えられていたら書かずに E_CONFLICT
  async upload(path, data, { ifMatch = null, type = 'application/octet-stream' } = {}) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const cond = ifMatch ? { 'if-match': ifMatch } : {};
    if (blob.size <= this.conn.cfg.smallUpload) {
      const r = await this.request(this.url(path, '/content'), { method: 'PUT', headers: { 'content-type': blob.type || type, ...cond }, body: blob });
      if (r.status === 412) throw conflict(path);
      if (!r.ok) throw await this.fail(r, `${path} に書けません`);
      return r.json();
    }
    const s = await this.request(this.url(path, '/createUploadSession'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cond },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
    });
    if (s.status === 412) throw conflict(path);
    if (!s.ok) throw await this.fail(s, `${path} を送れません`);
    const { uploadUrl } = await s.json();
    for (let start = 0; start < blob.size; start += CHUNK) {
      const end = Math.min(blob.size, start + CHUNK);
      // 分けて送る先の URL には認証が含まれているので、トークンは付けない
      const r = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-range': `bytes ${start}-${end - 1}/${blob.size}` }, body: blob.slice(start, end) });
      if (!r.ok && r.status !== 202) throw await this.fail(r, `${path} を送れません`);
      if (end === blob.size) return r.json();
    }
    return null;
  }
}

function conflict(path) {
  return Object.assign(new Error(`OneDrive の ${path} が、読んだあとでほかの所で書き換えられています。`), { code: 'E_CONFLICT', path });
}

// アプリ用のフォルダ(ワークスペース): 号の一覧・新しい号・号を開く
class OneDriveWorkspace {
  constructor(graph) {
    this.kind = 'onedrive';
    this.graph = graph;
    const who = graph.conn.account;
    this.label = `OneDrive のこのアプリ用のフォルダ${who ? `(${who})` : ''}`;
  }

  async list() {
    const items = await this.graph.children('');
    const out = [];
    for (const it of items.filter((x) => x.folder)) {
      const d = await this.graph.download(`${it.name}/issue.jsonc`);
      if (d) out.push({ folder: it.name, text: await d.res.text(), modified: Date.parse(it.lastModifiedDateTime) || 0 });
    }
    return summarizeIssues(out);
  }

  open(folder) {
    return new OneDriveStorage(this.graph, folder);
  }

  async exists(folder) {
    return !!(await this.graph.meta(folder));
  }
}

export class OneDriveStorage {
  constructor(graph, issue) {
    this.kind = 'onedrive';
    this.graph = graph;
    this.issue = issue;          // 号のフォルダの名前('' はワークスペースの一番上)
    const who = graph.conn.account;
    this.label = `${who ? `${who} の ` : ''}OneDrive / ${issue}`;
    this.canBuild = false;       // PDF は印刷の画面で作る(editor/printing.js)
    this.urls = new Map();       // 'issue:photos/a.jpg'・'ws:brand/x.png' → blob: の URL
    this.tags = new Map();       // 'issue/…'・'workspace/…' → { eTag, cTag }(読んだときの版)
    this.force = new Set();      // 次の保存では版を確かめずに上書きするもの
    this.url = (p) => this.urls.get(`issue:${p}`) ?? '';
    this.wsUrl = (p) => this.urls.get(`ws:${p}`) ?? '';
  }

  path(key) {
    return key.startsWith('issue/') ? [this.issue, key.slice(6)].filter(Boolean).join('/') : key.slice(10);
  }

  async readAt(key) {
    const d = await this.graph.download(this.path(key));
    if (!d) return null;
    this.tags.set(key, { eTag: d.meta.eTag, cTag: d.meta.cTag });
    return d.res.text();
  }

  async writeAt(key, data, type) {
    const ifMatch = this.force.has(key) ? null : this.tags.get(key)?.eTag ?? null;
    let item;
    try {
      item = await this.graph.upload(this.path(key), data, { ifMatch, type });
    } catch (e) {
      if (e.code === 'E_CONFLICT') e.key = key;
      throw e;
    }
    this.force.delete(key);
    if (item) this.tags.set(key, { eTag: item.eTag, cTag: item.cTag });
  }

  // ほかで書き換えられていても、次の保存では上書きする(画面で「上書き」を選んだとき)。key は E_CONFLICT の key
  overwriteNext(key) {
    this.force.add(key);
  }

  // ---- 号のフォルダ ----

  async readText(name) {
    const text = await this.readAt(`issue/${name}`);
    if (text == null) throw new Error(`${name} を読めません(OneDrive にありません)`);
    return text;
  }

  putFile(name, text) {
    return this.writeAt(`issue/${name}`, text, 'text/plain; charset=utf-8');
  }

  async uniqueName(dir, name) {
    const taken = new Set((await this.graph.children(dir)).map((x) => x.name.toLowerCase()));
    return safePhotoName(name, taken);
  }

  async uploadPhoto(file) {
    const p = `photos/${await this.uniqueName([this.issue, 'photos'].filter(Boolean).join('/'), file.name)}`;
    await this.writeAt(`issue/${p}`, file);
    this.setUrl(`issue:${p}`, file);
    return p;
  }

  async listPhotos() {
    const items = await this.graph.children([this.issue, 'photos'].filter(Boolean).join('/'));
    return items.filter((x) => x.file && IMAGE.test(x.name)).map((x) => `photos/${x.name}`).sort();
  }

  // ---- ワークスペース(紙名の設定と題字の画像) ----

  readWorkspaceText(name) {
    return this.readAt(`workspace/${name}`);
  }

  putWorkspaceFile(name, text) {
    return this.writeAt(`workspace/${name}`, text, 'text/plain; charset=utf-8');
  }

  async uploadBrand(file) {
    const p = `brand/${await this.uniqueName('brand', file.name)}`;
    await this.writeAt(`workspace/${p}`, file);
    this.setUrl(`ws:${p}`, file);
    return p;
  }

  // ---- 画像の URL ----

  setUrl(key, blob) {
    const old = this.urls.get(key);
    if (old) URL.revokeObjectURL(old);
    this.urls.set(key, URL.createObjectURL(blob));
  }

  // 画像を落として URL を作っておく(組版は URL をすぐに使うので、組む前に呼ぶ)。同時に4つまで
  async ensureUrls(issuePaths = [], wsPaths = []) {
    const jobs = [
      ...issuePaths.map((p) => [`issue:${p}`, [this.issue, p].filter(Boolean).join('/')]),
      ...wsPaths.map((p) => [`ws:${p}`, p]),
    ].filter(([key]) => !this.urls.has(key));
    const run = async () => {
      for (let job = jobs.shift(); job; job = jobs.shift()) {
        const [key, path] = job;
        try {
          // OneDrive が返す種類は当てにせず、名前から決める(種類のない SVG は <img> で出ない)
          const d = await this.graph.download(path);
          if (d) this.setUrl(key, new Blob([await d.res.arrayBuffer()], { type: imageType(path) || d.res.headers.get('content-type') || '' }));
        } catch {
          // 読めない画像は、組版の検査が知らせる
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, run));
  }

  // ---- ほかでの書き換え ----

  async changes() {
    const out = [];
    for (const [key, tag] of this.tags) {
      const m = await this.graph.meta(this.path(key)).catch(() => null);
      if (!m || m.cTag !== tag.cTag) out.push(key);
    }
    return out;
  }

  // ブラウザに戻ってきたときに、ほかのパソコンで書き換えられていないかを調べる
  watch(onChange) {
    let busy = false;
    const check = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const names = await this.changes();
        if (names.length) onChange(names);
      } catch {
        // つながらないときは、次に戻ってきたときにまた調べる
      } finally {
        busy = false;
      }
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
  }

  signOut() {
    return this.graph.conn.signOut();
  }
}
