// SF Symbols–style line icons (24×24, 1.8 stroke). icon('star') → inline <svg>.

function gearPath() {
  // 8-tooth gear outline, generated so it stays crisp at every size.
  const teeth = 8, rOut = 9.2, rIn = 7.2, pts = [];
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / 2;
    const r = (i % 4 === 0 || i % 4 === 1) ? rOut : rIn;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `<path d="M${pts.join('L')}Z"/><circle cx="12" cy="12" r="3"/>`;
}

const P = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r=".9" fill="currentColor"/><circle cx="4.8" cy="12" r=".9" fill="currentColor"/><circle cx="4.8" cy="17.5" r=".9" fill="currentColor"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  sort: '<path d="M7.5 4.5v15M4 8l3.5-3.5L11 8M16.5 19.5v-15M13 16l3.5 3.5L20 16"/>',
  filter: '<path d="M4 7h16M7 12h10M10 17h4"/>',
  tag: '<path d="M3.8 12.1V5.1c0-.7.6-1.3 1.3-1.3h7c.35 0 .68.14.92.38l7.3 7.3c.5.5.5 1.33 0 1.84l-7 7a1.3 1.3 0 0 1-1.84 0l-7.3-7.3a1.3 1.3 0 0 1-.38-.92z"/><circle cx="8.2" cy="8.2" r="1.3"/>',
  folder: '<path d="M3.5 7.3c0-1 .8-1.8 1.8-1.8h4.1l2 2h7.3c1 0 1.8.8 1.8 1.8v8.4c0 1-.8 1.8-1.8 1.8H5.3c-1 0-1.8-.8-1.8-1.8z"/>',
  star: '<path d="m12 3.8 2.5 5.1 5.6.8-4 3.95.94 5.6L12 16.6l-5.04 2.65.94-5.6-4-3.95 5.6-.8z"/>',
  starFill: '<path fill="currentColor" d="m12 3.8 2.5 5.1 5.6.8-4 3.95.94 5.6L12 16.6l-5.04 2.65.94-5.6-4-3.95 5.6-.8z"/>',
  heart: '<path d="M12 19.5s-7.5-4.4-7.5-10a4.2 4.2 0 0 1 7.5-2.6 4.2 4.2 0 0 1 7.5 2.6c0 5.6-7.5 10-7.5 10z"/>',
  heartFill: '<path fill="currentColor" d="M12 19.5s-7.5-4.4-7.5-10a4.2 4.2 0 0 1 7.5-2.6 4.2 4.2 0 0 1 7.5 2.6c0 5.6-7.5 10-7.5 10z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  xmark: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  clock: '<circle cx="12" cy="12" r="8.3"/><path d="M12 7.5V12l3 2"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6.5V5c0-.8.6-1.4 1.4-1.4h2.2c.8 0 1.4.6 1.4 1.4v1.5M6.5 6.5l.9 12.1c.1 1 .9 1.8 1.9 1.8h5.4c1 0 1.8-.8 1.9-1.8l.9-12.1M10 10.5v6M14 10.5v6"/>',
  photo: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.6"/><circle cx="9" cy="9.6" r="1.6"/><path d="m4 17.3 4.6-4.5 3.4 3.3 2.6-2.5 5.4 5.2"/>',
  photos: '<rect x="6.5" y="6.5" width="14" height="13" rx="2.4"/><path d="M17.5 6.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v8A2.5 2.5 0 0 0 6 16.5h.5"/><path d="m7 17.6 3.6-3.4 2.6 2.4 2-1.8 4.8 4.2"/>',
  link: '<path d="M10.2 13.8a3.9 3.9 0 0 0 5.5 0l3-3a3.9 3.9 0 0 0-5.5-5.5l-1.1 1.1M13.8 10.2a3.9 3.9 0 0 0-5.5 0l-3 3a3.9 3.9 0 0 0 5.5 5.5l1.1-1.1"/>',
  gear: gearPath(),
  chart: '<path d="M4 20h16"/><rect x="5.5" y="11" width="3" height="6.5" rx="1"/><rect x="10.5" y="5.5" width="3" height="12" rx="1"/><rect x="15.5" y="8.5" width="3" height="9" rx="1"/>',
  sparkles: '<path d="M11 3.8l1.7 4.9 4.9 1.7-4.9 1.7L11 17l-1.7-4.9-4.9-1.7 4.9-1.7z"/><path d="M18 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  stack: '<rect x="3.5" y="7.5" width="13" height="13" rx="2.6"/><path d="M7.5 4.5h10a3 3 0 0 1 3 3v10"/>',
  tray: '<path d="M3.5 13.5 6 5.9c.2-.7.8-1.1 1.5-1.1h9c.7 0 1.3.4 1.5 1.1l2.5 7.6v4.8c0 .9-.7 1.6-1.6 1.6H5.1c-.9 0-1.6-.7-1.6-1.6z"/><path d="M3.5 13.5h4.6l1.4 2.4h5l1.4-2.4h4.6"/>',
  chevronLeft: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
  chevronRight: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  chevronDown: '<path d="m5.5 9.5 6.5 6.5 6.5-6.5"/>',
  chevronUp: '<path d="m5.5 14.5 6.5-6.5 6.5 6.5"/>',
  ellipsis: '<circle cx="6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18" cy="12" r="1.3" fill="currentColor"/>',
  ellipsisCircle: '<circle cx="12" cy="12" r="8.5"/><circle cx="8.2" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="15.8" cy="12" r="1" fill="currentColor"/>',
  pencil: '<path d="M4.5 19.5h3.8L19 8.8a2.7 2.7 0 0 0-3.8-3.8L4.5 15.7z"/><path d="m13.7 6.5 3.8 3.8"/>',
  duplicate: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  undo: '<path d="M9 14.5 4.5 10 9 5.5"/><path d="M4.5 10h10a5 5 0 0 1 0 10H11"/>',
  redo: '<path d="M15 14.5 19.5 10 15 5.5"/><path d="M19.5 10h-10a5 5 0 0 0 0 10H13"/>',
  share: '<path d="M12 14.5V3.8M8.2 7.6 12 3.8l3.8 3.8"/><path d="M8.5 10.5H7.3a2.5 2.5 0 0 0-2.5 2.5v5a2.5 2.5 0 0 0 2.5 2.5h9.4a2.5 2.5 0 0 0 2.5-2.5v-5a2.5 2.5 0 0 0-2.5-2.5h-1.2"/>',
  download: '<path d="M12 3.8v10.7M8.2 10.7 12 14.5l3.8-3.8"/><path d="M4.5 15.5v2.2a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-2.2"/>',
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.6"/><path d="M9.5 4.5v15M5.8 8h1.6M5.8 11h1.6"/>',
  bag: '<path d="M5.2 8.5h13.6l-1 10.4a1.8 1.8 0 0 1-1.8 1.6H8a1.8 1.8 0 0 1-1.8-1.6z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
  doc: '<path d="M6.8 3.5h6.7l4.2 4.2v11.1c0 .9-.8 1.7-1.7 1.7H6.8c-.9 0-1.7-.8-1.7-1.7V5.2c0-.9.8-1.7 1.7-1.7z"/><path d="M13.5 3.5v4.2h4.2M8.5 13h7M8.5 16.5h5"/>',
  clipboard: '<rect x="5.5" y="4.8" width="13" height="15.7" rx="2.2"/><path d="M9 4.8V4.3c0-.6.5-1 1-1h4c.5 0 1 .4 1 1v.5c0 .6-.5 1-1 1h-4c-.5 0-1-.4-1-1z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.4 5.4 3.4 8.5s-1 6.1-3.4 8.5c-2.4-2.4-3.4-5.4-3.4-8.5s1-6.1 3.4-8.5z"/>',
  archive: '<rect x="3.5" y="4" width="17" height="4.6" rx="1.3"/><path d="M5 8.6v9.9c0 .9.7 1.5 1.5 1.5h11c.8 0 1.5-.6 1.5-1.5V8.6M10 12.5h4"/>',
  expand: '<path d="M4.5 9V4.5H9M19.5 9V4.5H15M4.5 15v4.5H9M19.5 15v4.5H15"/>',
  circle: '<circle cx="12" cy="12" r="8.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.3 2.6 2.6 5-5.3"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  wand: '<path d="m4.5 19.5 10-10M13 8l3 3"/><path d="M17.5 3.8l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6zM8.5 4l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1L7 5.5l1.1-.4zM19 12.5l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4z"/>',
  location: '<path d="M12 20.5s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="9.5" r="2.3"/>',
  calendar: '<rect x="3.8" y="5" width="16.4" height="15" rx="2.5"/><path d="M3.8 9.5h16.4M8 3.5v3M16 3.5v3"/>',
  box: '<path d="M12 3.5 20 7.5v9L12 20.5 4 16.5v-9z"/><path d="M4 7.5 12 11.5l8-4M12 11.5v9"/>',
  square: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/>',
  portrait: '<rect x="6" y="3.5" width="12" height="17" rx="2.6"/>',
  layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  keyboard: '<rect x="2.8" y="6" width="18.4" height="12" rx="2.4"/><path d="M6.5 9.5h.01M10 9.5h.01M14 9.5h.01M17.5 9.5h.01M7.5 14.5h9"/>',
  broom: '<path d="M14.5 3.5 11 10.5"/><path d="M7.5 10.5h7l2 4.5c.6 1.3-.1 2.8-1.5 3.1l-6.2 1.5c-1.6.4-3-.9-2.8-2.5z"/><path d="M9.5 16.5l-.8 3"/>',
  rename: '<path d="M4 7.5h9M4 12h6M4 16.5h5"/><path d="M13 19.5h2.3L21 13.8a1.7 1.7 0 0 0-2.3-2.3L13 17.2z"/>',
  move: '<path d="M3.5 7.3c0-1 .8-1.8 1.8-1.8h4.1l2 2h7.3c1 0 1.8.8 1.8 1.8v8.4c0 1-.8 1.8-1.8 1.8H5.3c-1 0-1.8-.8-1.8-1.8z"/><path d="M9.5 13.5h5.5M13 11.2l2.3 2.3-2.3 2.3"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1 0 1.6-.8 1.6-1.6 0-1.1-.9-1.4-.9-2.4 0-.9.7-1.6 1.6-1.6h2.1a4.1 4.1 0 0 0 4.1-4.1c0-4.2-3.8-7.3-8.5-7.3z"/><circle cx="7.8" cy="11" r="1.1" fill="currentColor"/><circle cx="10.5" cy="7.5" r="1.1" fill="currentColor"/><circle cx="15" cy="7.8" r="1.1" fill="currentColor"/>',
  skull: '<path d="M12 3.5a7.5 7.5 0 0 0-7.5 7.5c0 2.5 1.2 4.4 3 5.6v2.4c0 .6.4 1 1 1h7c.6 0 1-.4 1-1v-2.4c1.8-1.2 3-3.1 3-5.6A7.5 7.5 0 0 0 12 3.5z"/><circle cx="9" cy="11.5" r="1.7" fill="currentColor"/><circle cx="15" cy="11.5" r="1.7" fill="currentColor"/><path d="M10.5 20v-2.2M13.5 20v-2.2"/>',
  trophy: '<path d="M7.5 4.5h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6.5H4.5v1a3 3 0 0 0 3 3M16.5 6.5h3v1a3 3 0 0 1-3 3M12 14v3.5M8.5 20h7M9.5 17.5h5"/>',
  eye: '<path d="M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeSlash: '<path d="M9.9 6.1A9.4 9.4 0 0 1 12 5.8c5.8 0 9.2 6.2 9.2 6.2a16 16 0 0 1-2.6 3.3M6.5 7.6C4.1 9.3 2.8 12 2.8 12s3.4 6.2 9.2 6.2c1.6 0 3-.5 4.2-1.1M4 4l16 16"/><path d="M10 10.1a2.8 2.8 0 0 0 3.9 3.9"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4.2h-4.2"/>',
  play: '<path d="M7.5 5.2v13.6c0 .8.9 1.3 1.6.8l10-6.8c.6-.4.6-1.2 0-1.6l-10-6.8c-.7-.5-1.6 0-1.6.8z"/>',
  flag: '<path d="M5.5 20.5V4.5M5.5 4.5h11l-2.2 4 2.2 4h-11"/>',
  bolt: '<path d="M13 3.5 5.5 13.5h6l-1 7 7.5-10h-6z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.6"/><circle cx="9" cy="9.6" r="1.6"/><path d="m4 17.3 4.6-4.5 3.4 3.3 2.6-2.5 5.4 5.2"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

