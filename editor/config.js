// 静的ページ版の設定(docs/06-hosting.md)。
// OneDrive につなぐには、Microsoft にこのアプリを登録して得た「アプリケーション (クライアント) ID」を clientId に入れる。
// クライアント ID は秘密の情報ではない(ページを開いた人なら誰でも見られる前提の値)。秘密のキーはこのアプリでは使わない。

export const CONFIG = {
  onedrive: {
    clientId: '',
    // 個人の Microsoft アカウントでサインインする
    authority: 'https://login.microsoftonline.com/consumers',
    graph: 'https://graph.microsoft.com/v1.0',
    // OneDrive の「アプリ」フォルダの中の、このアプリ用のフォルダだけを読み書きする(ほかのファイルには触れない)
    scopes: ['openid', 'profile', 'offline_access', 'Files.ReadWrite.AppFolder'],
    // これより大きいファイル(写真など)は、分けて送る(Microsoft Graph の1回で送れる大きさは 4MB まで)
    smallUpload: 3.5 * 1024 * 1024,
  },
};
