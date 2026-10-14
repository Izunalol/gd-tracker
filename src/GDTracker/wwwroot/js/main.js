// App shell: startup, theming, top bar and hash routing (#/ · #/level/<key>[/tab] · #/activity · #/settings).
import { call, hasHost } from './rpc.js';
import { state, settings, initPrefs, loadAll, on, emit } from './store.js';
import { setFormats, debounce, hexToRgb, inkOn } from './util.js';
import { icon } from './icons.js';
import { closeMenu, closePopover, sheetOpen, topSheet, toast } from './ui.js';
import { refreshThumbs, keysForOnlineId } from './thumbs.js';
import { imgUrl } from './images.js';
import { mountGallery, unmountGallery } from './views/gallery.js';
import { mountLevel, unmountLevel } from './views/level.js';
import { mountActivity, unmountActivity } from './views/activity.js';
import { mountSettings, unmountSettings, FONTS } from './views/settings.js';
import { mountLists, unmountLists } from './views/lists.js';

const content = document.getElementById('content');
let current = null;

// ---------------------------------------------------------------- theme

const media = matchMedia('(prefers-color-scheme: dark)');

function isDark() {
  const t = settings().theme;
  return t === 'dark' || (t === 'system' && media.matches);
}

function applyTheme() {
  const s = settings();
  const dark = isDark();
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.density = s.density;
  const rgb = hexToRgb(s.accent) || { r: 61, g: 157, b: 243 };
  root.style.setProperty('--accent', s.accent);
  root.style.setProperty('--accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  root.style.setProperty('--accent-ink', inkOn(s.accent));
  root.style.setProperty('--radius', s.radius + 'px');
  root.style.setProperty('--font', FONTS[s.font]?.css || FONTS.segoe.css);

  const bg = document.getElementById('bg');
  bg.className = `bg-${s.bgType}`;
  if (s.bgType === 'image' && s.bgImage) {
    bg.style.setProperty('--bg-img', `url("${imgUrl(s.bgImage)}")`);
    bg.style.setProperty('--bg-blur', s.bgBlur + 'px');
    bg.style.setProperty('--bg-dim', s.bgDim / 100);
  } else bg.style.removeProperty('--bg-img');

  setFormats(s);
  // Native title bar follows the page background.
  const color = getComputedStyle(root).getPropertyValue('--titlebar').trim() || (dark ? '#111318' : '#f4f5f8');
  if (hasHost) call('app.titleBar', { dark, color }).catch(() => {});
}
media.addEventListener('change', () => settings().theme === 'system' && applyTheme());

// ---------------------------------------------------------------- top bar

function topbar() {
  const el = document.getElementById('topbar');
  el.innerHTML = `
    <a class="brand" href="#/"><span class="logo"></span><span>GD Tracker</span></a>
    <nav>
      <a href="#/" data-nav="levels">${icon('grid')}<span>Levels</span></a>
      <a href="#/lists" data-nav="lists">${icon('trophy')}<span>Lists</span></a>
      <a href="#/activity" data-nav="activity">${icon('chart')}<span>Activity</span></a>
      <a href="#/settings" data-nav="settings">${icon('gear')}<span>Settings</span></a>
    </nav>
    <span class="sp"></span>
    <span class="live" title="Updates automatically when Death Tracker saves"><i></i><span class="live-text"></span></span>
    <button class="btn ghost icon-only" data-a="reload" title="Reload data (F5)">${icon('refresh')}</button>`;
  el.querySelector('[data-a=reload]').onclick = reload;
}

function updateNav(name) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === name));
}

function updateLive() {
  const el = document.querySelector('.live');
  if (!el) return;
  const on = settings().liveRefresh && state.folderExists;
  el.classList.toggle('off', !on);
  el.querySelector('.live-text').textContent = on ? 'Live' : 'Paused';
}

async function reload() {
  const btn = document.querySelector('[data-a=reload]');
  btn?.classList.add('spin');
  await loadAll();
  btn?.classList.remove('spin');
  toast(`Loaded ${state.levels.size} levels`, { timeout: 1800 });
}

// ---------------------------------------------------------------- routing

function route() {
  closeMenu();
  closePopover();
  current?.();
  current = null;
  const hash = decodeURI(location.hash || '#/');
  const parts = hash.replace(/^#\/?/, '').split('/');
  const page = document.createElement('div');
  content.replaceChildren(page);
  content.scrollTop = 0;
  if (parts[0] === 'level' && parts[1]) {
    updateNav('levels');
    mountLevel(page, decodeURIComponent(parts[1]), parts[2]);
    current = unmountLevel;
  } else if (parts[0] === 'activity') {
    updateNav('activity');
    mountActivity(page);
    current = unmountActivity;
  } else if (parts[0] === 'lists') {
    updateNav('lists');
    mountLists(page);
    current = unmountLists;
  } else if (parts[0] === 'settings') {
    updateNav('settings');
    mountSettings(page);
    current = unmountSettings;
  } else {
    updateNav('levels');
    mountGallery(page);
    current = unmountGallery;
  }
}

window.addEventListener('hashchange', () => {
  // Tab switches on the level page rewrite the hash with replaceState, so this only fires on real navigation.
  route();
});

// ---------------------------------------------------------------- keys

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (closeMenu() || closePopover()) return;
    if (sheetOpen()) { topSheet().requestClose(); return; }
    if (location.hash.startsWith('#/level/') && !e.target.matches('input, textarea, select')) { location.hash = '#/'; }
    return;
  }
  if (e.key === 'F5') { e.preventDefault(); reload(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    if (!location.hash || location.hash === '#/' || location.hash === '#') document.querySelector('.search input')?.focus();
    else { location.hash = '#/'; setTimeout(() => document.querySelector('.search input')?.focus(), 50); }
    return;
  }
  if (e.altKey && e.key === 'ArrowLeft') { history.back(); }
});

// Mouse "back" button.
document.addEventListener('mouseup', (e) => { if (e.button === 3) { e.preventDefault(); history.back(); } });

// The default context menu only makes sense in text fields.
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('input, textarea, [contenteditable]')) e.preventDefault();
});

// ---------------------------------------------------------------- events

on('prefs', debounce(() => { applyTheme(); updateLive(); }, 16));
on('custom', (key) => refreshThumbs([key]));
on('thumbs', () => refreshThumbs());
on('thumb', (id) => refreshThumbs(keysForOnlineId(id)));
on('data', updateLive);
on('live', ({ keys }) => {
  const names = keys.map((k) => state.levels.get(k)).filter(Boolean).map((l) => l.rawName);
  if (names.length) toast(`Updated ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2}` : ''}`, { timeout: 2200 });
});

// ---------------------------------------------------------------- start

async function start() {
  topbar();
  if (!hasHost) {
    document.getElementById('content').innerHTML = '<div class="empty"><h2>Open this inside GD Tracker.exe</h2></div>';
    return;
  }
  const init = await call('app.init');
  state.version = init.version;
  state.dataFolder = init.dataFolder;
  state.systemDark = init.systemDark;
  state.detectedFolder = init.detectedFolder;
  state.modInstalled = init.modInstalled;
  initPrefs(init.prefs);
  applyTheme();
  updateLive();
  route();
  await loadAll();
  emit('prefs');
}

start().catch((e) => {
  console.error(e);
  content.innerHTML = `<div class="empty"><h2>Something went wrong</h2><p>${String(e.message || e)}</p></div>`;
});
