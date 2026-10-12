// エディタのサーバー(tools/edit.mjs)との通信。書き込みには起動ごとの合言葉を付ける。
// 静的ページ版の窓口(editor/storage-folder.js・storage-onedrive.js・storage-demo.js)も同じ形にそろえる:
//   kind・label・canBuild、号のフォルダ readText・putFile・uploadPhoto・listPhotos・url、
//   ワークスペース readWorkspaceText・putWorkspaceFile・uploadBrand・wsUrl

async function fail(res) {
  let msg = `${res.status}`;
  try {
    msg = (await res.json()).error ?? msg;
  } catch { /* JSON でない */ }
  throw new Error(msg);
}

export async function connectApi() {
  const res = await fetch('/__api/session', { cache: 'no-store' });
  if (!res.ok) throw new Error('エディタのサーバーにつながりません。npm run edit -- <号フォルダ> で開いてください。');
  const { token, issue } = await res.json();
  const auth = { 'X-YSM-Token': token };
  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
  const base = `/${enc(issue)}/`;
  // ワークスペース(号のフォルダの1つ上): 紙名の設定と題字の画像
  const parent = issue.split('/').slice(0, -1).join('/');
  const wsBase = parent ? `/${enc(parent)}/` : '/';
  return {
    kind: 'server',
    label: issue,
    canBuild: true,   // PDF はサーバーが画面なしの Chrome で作る
    issue,
    base,
    url: (p) => base + enc(p),
    wsUrl: (p) => wsBase + enc(p),
    // ワークスペースのテキスト(なければ null)
    async readWorkspaceText(name) {
      const r = await fetch(wsBase + enc(name), { cache: 'no-store' }).catch(() => null);
      return r?.ok ? r.text() : null;
    },
    async readText(name) {
      const r = await fetch(base + encodeURIComponent(name), { cache: 'no-store' });
      if (!r.ok) throw new Error(`${name} を読めません(${r.status})`);
      return r.text();
    },
    async putFile(name, text) {
      const r = await fetch(`/__api/file?name=${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { ...auth, 'content-type': 'text/plain; charset=utf-8' },
        body: text,
      });
      if (!r.ok) await fail(r);
    },
    // ワークスペースの紙名の設定(publication.jsonc)を書く
    async putWorkspaceFile(name, text) {
      const r = await fetch(`/__api/workspace-file?name=${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { ...auth, 'content-type': 'text/plain; charset=utf-8' },
        body: text,
      });
      if (!r.ok) await fail(r);
    },
    // 題字の画像をワークスペースの brand/ に取り込む。戻り値はワークスペースからのパス
    async uploadBrand(file) {
      const r = await fetch(`/__api/brand?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: auth, body: file });
      if (!r.ok) await fail(r);
      return (await r.json()).path;
    },
    // 号フォルダの photos/ にある写真(号フォルダからのパス)
    async listPhotos() {
      const r = await fetch('/__api/photos', { headers: auth, cache: 'no-store' });
      if (!r.ok) await fail(r);
      return (await r.json()).files;
    },
    async uploadPhoto(file) {
      const r = await fetch(`/__api/photo?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: auth, body: file });
      if (!r.ok) await fail(r);
      return (await r.json()).path;
    },
    // final: 入稿用(A3 の面付け PDF と入稿メモも作る)
    async build({ final = false } = {}) {
      const r = await fetch(`/__api/build${final ? '?final=1' : ''}`, { method: 'POST', headers: auth });
      if (!r.ok) await fail(r);
      return r.json();
    },
  };
}
