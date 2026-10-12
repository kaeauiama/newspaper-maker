// 画面のアイコン(線の絵)。文字のラベルと一緒に使い、アイコンだけのボタンには aria-label を付ける。
// editor.html に直接書いたアイコンも、ここと同じ形にそろえる。

const svg = (body) => `<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  photo: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5L5 20"/>'),
  table: svg('<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M3 15h18M10 4v16"/>'),
  box: svg('<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9h16"/>'),
  title: svg('<rect x="8" y="3" width="8" height="18" rx="1"/><path d="M12 7v10"/>'),
  lead: svg('<path d="M17 4v16M12 4v11M7 4v13"/>'),
  page: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'),
  pageAdd: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M12 11v6M9 14h6"/>'),
  text: svg('<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  spread: svg('<path d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2z"/><path d="M12 6v14"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  checkCircle: svg('<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
  alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.3v.1"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  arrowRight: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'),
  folder: svg('<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>'),
  printer: svg('<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="1.5"/><path d="M7 14h10v7H7z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>'),
};
