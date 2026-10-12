// ローカルのフォルダを読み書きする(静的ページ版。Chrome・Edge の File System Access API)。
// ワークスペース(号のフォルダを並べたフォルダ。OneDrive の同期フォルダや USB メモリの中でもよい)を開き、その中の号を編集する。
// 書き込みはブラウザが一時ファイルに書いてから置き換える(書きかけのファイルを残さない)。
// 窓口(readText・putFile・url など)は、サーバー版の editor/api.js と同じ形にそろえる。

import { safePhotoName } from './names.js';
import { parseJsonc } from '../engine/jsonc.js';

const DB = 'kikanshi-editor';
const STORE = 'handles';
const IMAGE = /\.(jpe?g|png|webp|gif)$/i;

export function folderSupported() {
  return typeof window.showDirectoryPicker === 'function';
}

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// 前に開いたワークスペースのフォルダを、このブラウザに覚えておく(中身ではなく、フォルダへの参照だけ)
export async function rememberFolder(handle) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, 'workspace');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // 覚えられなくても、その場では開ける
  }
}

export async function recallFolder() {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const q = db.transaction(STORE, 'readonly').objectStore(STORE).get('workspace');
      q.onsuccess = () => resolve(q.result ?? null);
      q.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export function pickFolder() {
  return window.showDirectoryPicker({ id: 'kikanshi-workspace', mode: 'readwrite' });
}

// 読み書きの許可(なければブラウザが尋ねる。ボタンを押したときに呼ぶ)
export async function ensurePermission(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

// ワークスペースの号(issue.jsonc のあるフォルダ): [{ folder, text, modified }]
export async function listFolderIssues(root) {
  const out = [];
  for await (const [name, h] of root.entries()) {
    if (h.kind !== 'directory') continue;
    try {
      const f = await (await h.getFileHandle('issue.jsonc')).getFile();
      out.push({ folder: name, text: await f.text(), modified: f.lastModified });
    } catch {
      // 号のフォルダではない(brand/ など)
    }
  }
  return out;
}

const notFound = (e) => e?.name === 'NotFoundError' || e?.name === 'TypeMismatchError';

// 号を読み取れた範囲で一覧にする: [{ folder, number, date, modified }](新しい号が上)
export function summarizeIssues(raw) {
  return raw.map(({ folder, text, modified }) => {
    let issue = null;
    try {
      issue = parseJsonc(text);
    } catch {
      // 読めない号も一覧には出す(開くと理由が出る)
    }
    return { folder, number: issue?.number ?? null, date: issue?.date ?? '', modified };
  }).sort((a, b) => (Number(b.number) || -1) - (Number(a.number) || -1) || b.modified - a.modified);
}

// ワークスペース(開いたフォルダ)。号の一覧・紙名の設定・新しい号を扱う。号を開くと FolderStorage を返す
export class FolderWorkspace {
  constructor(root) {
    this.kind = 'folder';
    this.root = root;
    this.label = root.name;
  }

  async list() {
    return summarizeIssues(await listFolderIssues(this.root));
  }

  open(folder) {
    return new FolderStorage(this.root, folder);
  }

  async exists(folder) {
    try {
      await this.root.getDirectoryHandle(folder);
      return true;
    } catch (e) {
      if (notFound(e)) return false;
      throw e;
    }
  }

  // 開いたフォルダの見立て(共有フォルダからダウンロードして展開すると、1つ上や1つ下を選びがちなので)。
  // isIssue: 号のフォルダそのもの(issue.jsonc がある)。below: 1つ下の、紙名の設定か号のフォルダがあるフォルダの名前
  async inspect() {
    const has = async (dir, name) => {
      try {
        await dir.getFileHandle(name);
        return true;
      } catch {
        return false;
      }
    };
    const below = [];
    for await (const [name, h] of this.root.entries()) {
      if (h.kind === 'directory' && ((await has(h, 'publication.jsonc')) || (await listFolderIssues(h)).length)) below.push(name);
    }
    return { isIssue: await has(this.root, 'issue.jsonc'), below: below.sort() };
  }

  // 1つ下のフォルダをワークスペースにする
  async child(name) {
    return new FolderWorkspace(await this.root.getDirectoryHandle(name));
  }
}

export class FolderStorage {
  constructor(root, issue) {
    this.kind = 'folder';
    this.root = root;            // ワークスペース(FileSystemDirectoryHandle)
    this.issue = issue;          // 号のフォルダの名前
    this.label = `${root.name} / ${issue}`;
    this.canBuild = false;       // PDF は印刷の画面で作る(editor/printing.js)
    this.urls = new Map();       // 'issue:photos/a.jpg'・'ws:brand/x.png' → 画像の URL(blob:)
    this.stamps = new Map();     // 読み書きしたファイル → 更新日時(外での書き換えに気づくため)
    this.url = (p) => this.urls.get(`issue:${p}`) ?? '';
    this.wsUrl = (p) => this.urls.get(`ws:${p}`) ?? '';
  }

  async dir(parts, create = false) {
    let d = this.root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  }

  async file(path, create = false) {
    const parts = path.split('/');
    const name = parts.pop();
    return (await this.dir(parts, create)).getFileHandle(name, { create });
  }

  async write(path, data) {
    const h = await this.file(path, true);
    const w = await h.createWritable();
    await w.write(data);
    await w.close();
    return (await h.getFile()).lastModified;
  }

  // ---- 号のフォルダ ----

  async readText(name) {
    const f = await (await this.file(`${this.issue}/${name}`)).getFile();
    this.stamps.set(`issue/${name}`, f.lastModified);
    return f.text();
  }

  async putFile(name, text) {
    this.stamps.set(`issue/${name}`, await this.write(`${this.issue}/${name}`, text));
  }

  async uniqueName(dirParts, name) {
    const d = await this.dir(dirParts, true);
    const taken = new Set();
    for await (const [n] of d.entries()) taken.add(n.toLowerCase());
    return safePhotoName(name, taken);
  }

  async uploadPhoto(file) {
    const p = `photos/${await this.uniqueName([this.issue, 'photos'], file.name)}`;
    await this.write(`${this.issue}/${p}`, file);
    this.setUrl(`issue:${p}`, file);
    return p;
  }

  async listPhotos() {
    try {
      const d = await this.dir([this.issue, 'photos']);
      const out = [];
      for await (const [n, h] of d.entries()) if (h.kind === 'file' && IMAGE.test(n)) out.push(`photos/${n}`);
      return out.sort();
    } catch (e) {
      if (notFound(e)) return [];
      throw e;
    }
  }

  // ---- ワークスペース(紙名の設定と題字の画像) ----

  async readWorkspaceText(name) {
    try {
      const f = await (await this.file(name)).getFile();
      this.stamps.set(`workspace/${name}`, f.lastModified);
      return await f.text();
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  }

  async putWorkspaceFile(name, text) {
    this.stamps.set(`workspace/${name}`, await this.write(name, text));
  }

  async uploadBrand(file) {
    const p = `brand/${await this.uniqueName(['brand'], file.name)}`;
    await this.write(p, file);
    this.setUrl(`ws:${p}`, file);
    return p;
  }

  // ---- 画像の URL ----

  setUrl(key, blob) {
    const old = this.urls.get(key);
    if (old) URL.revokeObjectURL(old);
    this.urls.set(key, URL.createObjectURL(blob));
  }

  // 画像を読んで URL を作っておく(組版は URL をすぐに使うので、組む前に呼ぶ)
  async ensureUrls(issuePaths = [], wsPaths = []) {
    const load = async (key, path) => {
      if (this.urls.has(key)) return;
      try {
        this.setUrl(key, await (await this.file(path)).getFile());
      } catch {
        // 読めない画像は、組版の検査が知らせる
      }
    };
    await Promise.all([
      ...issuePaths.map((p) => load(`issue:${p}`, `${this.issue}/${p}`)),
      ...wsPaths.map((p) => load(`ws:${p}`, p)),
    ]);
  }

  // ---- 外での書き換え ----

  // 読み書きしたあとで、ほかで書き換えられたファイル('issue/…'・'workspace/…'。サーバー版の知らせと同じ形)
  async changes() {
    const out = [];
    for (const [key, stamp] of this.stamps) {
      const path = key.startsWith('issue/') ? `${this.issue}/${key.slice(6)}` : key.slice(10);
      try {
        if ((await (await this.file(path)).getFile()).lastModified !== stamp) out.push(key);
      } catch {
        out.push(key);
      }
    }
    return out;
  }

  // ブラウザに戻ってきたとき(ほかのアプリで直したあとなど)に調べる
  watch(onChange) {
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const names = await this.changes();
        if (names.length) onChange(names);
      } finally {
        busy = false;
      }
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  }
}
