// 見本を開く(静的ページ版)。サイトの samples/ にある見本の号を読むだけで、書いたものはこの画面の中にだけ残る(保存されない)。
// 窓口は editor/api.js と同じ形。

import { safePhotoName } from './names.js';
import { summarizeIssues } from './storage-folder.js';

const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

// 見本のワークスペース(号は samples/demo の1つだけ。新しい号は作れない)
export class DemoWorkspace {
  constructor(base) {
    this.kind = 'demo';
    this.base = base;
    this.label = '見本の号';
    this.readonly = true;
  }

  async list() {
    const r = await fetch(`${this.base}demo/issue.jsonc`, { cache: 'no-store' }).catch(() => null);
    return summarizeIssues(r?.ok ? [{ folder: 'demo', text: await r.text(), modified: 0 }] : []);
  }

  open(folder) {
    return new DemoStorage(this.base, folder);
  }

  async exists() {
    return false;
  }
}

export class DemoStorage {
  // base: samples/ の URL(/ で終わる)、issue: 号のフォルダ
  constructor(base, issue = 'demo') {
    this.kind = 'demo';
    this.base = base;
    this.issue = issue;
    this.label = '見本(保存されません)';
    this.canBuild = false;
    this.mem = new Map();      // 書いた原稿・設定
    this.blobs = new Map();    // 取り込んだ画像 → blob: の URL
    this.added = [];           // 取り込んだ写真
    this.url = (p) => this.blobs.get(`issue:${p}`) ?? `${this.base}${enc(this.issue)}/${enc(p)}`;
    this.wsUrl = (p) => this.blobs.get(`ws:${p}`) ?? `${this.base}${enc(p)}`;
  }

  async readText(name) {
    if (this.mem.has(`issue/${name}`)) return this.mem.get(`issue/${name}`);
    const r = await fetch(`${this.base}${enc(this.issue)}/${enc(name)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${name} を読めません(${r.status})`);
    return r.text();
  }

  async readWorkspaceText(name) {
    if (this.mem.has(`workspace/${name}`)) return this.mem.get(`workspace/${name}`);
    const r = await fetch(`${this.base}${enc(name)}`, { cache: 'no-store' }).catch(() => null);
    return r?.ok ? r.text() : null;
  }

  async putFile(name, text) {
    this.mem.set(`issue/${name}`, text);
  }

  async putWorkspaceFile(name, text) {
    this.mem.set(`workspace/${name}`, text);
  }

  async uploadPhoto(file) {
    const p = `photos/${safePhotoName(file.name, new Set(this.added.map((x) => x.slice(7).toLowerCase())))}`;
    this.blobs.set(`issue:${p}`, URL.createObjectURL(file));
    this.added.push(p);
    return p;
  }

  async uploadBrand(file) {
    const p = `brand/${safePhotoName(file.name, new Set())}`;
    this.blobs.set(`ws:${p}`, URL.createObjectURL(file));
    return p;
  }

  async listPhotos() {
    return [...this.added];
  }

  async ensureUrls() {}

  watch() {}
}
