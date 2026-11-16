// 紙面の画面の右の欄(選んだものの設定)の幅を、境目のドラッグで変える(D-038)。幅はこのブラウザに覚えておく。
// 境目をダブルクリックすると元の幅に戻す。境目を選んで ← → でも変えられる。

const KEY = 'ysm-inspector-width';
const MIN = 260;

export function setupPaneResize(body) {
  const handle = document.createElement('div');
  handle.className = 'ws-resize';
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', '右の欄の幅');
  handle.title = 'ドラッグで右の欄の幅を変える(ダブルクリックで元の幅)';
  body.appendChild(handle);

  // 紙面の欄が狭くなりすぎないようにする
  const max = () => Math.max(MIN, Math.min(900, body.clientWidth - 360));
  const current = () => document.getElementById('inspector').getBoundingClientRect().width;
  const set = (w, keep = true) => {
    if (w == null) {
      body.style.removeProperty('--inspector-w');
      try {
        localStorage.removeItem(KEY);
      } catch {
        // 覚えられなくても、いまの画面では効く
      }
      return;
    }
    const v = Math.round(Math.min(max(), Math.max(MIN, w)));
    body.style.setProperty('--inspector-w', `${v}px`);
    if (!keep) return;
    try {
      localStorage.setItem(KEY, String(v));
    } catch {
      // 同上
    }
  };
  let saved = null;
  try {
    saved = Number(localStorage.getItem(KEY)) || null;
  } catch {
    saved = null;
  }
  if (saved) set(saved, false);

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('on');
    const move = (ev) => set(body.getBoundingClientRect().right - ev.clientX);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.classList.remove('on');
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  handle.addEventListener('dblclick', () => set(null));
  handle.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();   // 紙面の配置物を動かすキーにしない
    set(current() + (e.key === 'ArrowLeft' ? 20 : -20));
  });
  // 窓を狭くしたら、覚えている幅のままでも紙面の欄が残るようにする
  window.addEventListener('resize', () => {
    if (body.style.getPropertyValue('--inspector-w') && current() > max()) set(max(), false);
  });
}
