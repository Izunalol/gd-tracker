// App state: the user's prefs (settings + per-level customisation, persisted by the host as prefs.json),
// the levels read from the Death Tracker folder, and cached online extras (level info, thumbnails).
import { call, on as onHost } from './rpc.js';
import { debounce } from './util.js';
import { buildLevel, applyPlaytime } from './data.js';

export const DEFAULT_SETTINGS = {
  // appearance
  theme: 'dark',
  accent: '#3d9df3',
  font: 'segoe',
  radius: 14,
  density: 'comfortable',
  bgType: 'gradient',
  bgImage: null,
  bgBlur: 18,
  bgDim: 70,
  levelHeroBlur: true,
  // gallery
  view: 'grid',
  cardSize: 280,
  cardStyle: 'overlay',
  cardAspect: '16/9',
  cardStats: { attempts: true, playtime: true, best: true, lastPlayed: true, from0: false, sessions: false, completions: false, practice: false },
  showProgress: true,
  showDifficulty: true,
  showCreator: true,
  sort: 'recent',
  sortDir: 'desc',
  groupBy: 'none',
  filterType: 'all',
  filterStatus: 'all',
  filterFav: false,
  filterTags: [],
  filterDiff: [],
  showHidden: false,
  showSummary: true,
  pinFavorites: true,
  // data
  dataPath: '',
  liveRefresh: true,
  playtimeDead: true,
  playtimePaused: false,
  // online
  online: true,
  autoThumbs: true,
  // formats
  timeFormat: 'hm',
  dateFormat: 'relative',
  clockFormat: 'auto',
  // level page
  chartMetric: 'deaths',
  hideZeroPercent: false,
};

export const state = {
  prefs: { version: 1, settings: { ...DEFAULT_SETTINGS }, levels: {}, tagColors: {} },
  levels: new Map(),
  folder: '',
  folderExists: true,
  detectedFolder: '',
  modInstalled: true,
  loaded: false,
  loadError: null,
  info: {}, // online level info by id
  thumbs: {}, // id → url | null (small)
  hdThumbs: {}, // id → url | null
  version: '',
  dataFolder: '',
  systemDark: true,
};

export const settings = () => state.prefs.settings;

// ---------------------------------------------------------------- events

const bus = new Map();
export function on(evt, fn) {
  if (!bus.has(evt)) bus.set(evt, new Set());
  bus.get(evt).add(fn);
  return () => bus.get(evt).delete(fn);
}
export function emit(evt, data) {
  (bus.get(evt) || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });
}

// ---------------------------------------------------------------- prefs

const persist = debounce(() => {
  call('prefs.save', { json: JSON.stringify(state.prefs, null, 1) }).catch((e) => console.error('save failed', e));
}, 400);

export function initPrefs(json) {
  if (!json) return;
  try {
    const p = JSON.parse(json);
    state.prefs = {
      version: 1,
      ...p,
      settings: { ...DEFAULT_SETTINGS, ...(p.settings || {}), cardStats: { ...DEFAULT_SETTINGS.cardStats, ...(p.settings?.cardStats || {}) } },
      levels: p.levels || {},
      tagColors: p.tagColors || {},
    };
  } catch (e) { console.error('bad prefs', e); }
}

export function replacePrefs(p) {
  initPrefs(JSON.stringify(p));
  persist();
  recomputePlaytime();
  emit('prefs');
  emit('data');
}

/** Changes settings. Emits 'prefs'; playtime options also recompute the levels. */
export function setSettings(patch) {
  const s = state.prefs.settings;
  Object.assign(s, patch);
  persist();
  if ('playtimeDead' in patch || 'playtimePaused' in patch) { recomputePlaytime(); emit('data'); }
  emit('prefs', patch);
}

/** Per-level customisation (name, thumb, thumbPos, color, tags, notes, fav, hidden). */
export const custom = (key) => state.prefs.levels[key] || {};

export function setCustom(key, patch) {
  const cur = { ...custom(key), ...patch };
  for (const [k, v] of Object.entries(cur)) {
    if (v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length)) delete cur[k];
  }
  if (Object.keys(cur).length) state.prefs.levels[key] = cur;
  else delete state.prefs.levels[key];
  persist();
  emit('custom', key);
}

export function allTags() {
  const set = new Set();
  for (const c of Object.values(state.prefs.levels)) (c.tags || []).forEach((t) => set.add(t));
  return [...set].sort((a, b) => a.localeCompare(b));
}

const TAG_PALETTE = ['#3d9df3', '#48d16c', '#f2c230', '#f27d30', '#f2508c', '#c45bf2', '#2ec4b6', '#8a8f9c'];
export function tagColor(tag) {
  if (state.prefs.tagColors[tag]) return state.prefs.tagColors[tag];
  let h = 0;
  for (const c of tag) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}
export function setTagColor(tag, color) {
  state.prefs.tagColors[tag] = color;
  persist();
  emit('prefs');
}

// ---------------------------------------------------------------- level helpers

export function displayName(level) {
  return custom(level.key).name || level.rawName;
}

export const levelInfo = (level) => (level.lookupId ? state.info[level.lookupId] : null);

/** Difficulty, preferring fresh server info (the mod only updates it when you play the level). */
export function levelDifficulty(level) {
  const info = levelInfo(level);
  return info && !info.missing ? info.difficulty : level.difficulty;
}

export const isPlatformer = (level) => levelInfo(level)?.length === 5;

/** "73%" for classic levels; platformer progress is checkpoint-based. */
export function pctLabel(level, p) {
  if (p == null) return '–';
  return isPlatformer(level) ? `CP ${p}` : `${p}%`;
}

export const isCompleted = (level) => level.sum.completions > 0 || level.sum.best >= 100;

// ---------------------------------------------------------------- loading

const opts = () => ({ playtimeDead: settings().playtimeDead, playtimePaused: settings().playtimePaused });

function recomputePlaytime() {
  for (const l of state.levels.values()) applyPlaytime(l, opts());
}

export async function loadAll() {
  try {
    const res = await call('dt.load', { path: settings().dataPath || '' });
    state.folder = res.folder;
    state.folderExists = res.exists;
    state.levels = new Map(res.levels.map((raw) => [raw.key, buildLevel(raw, opts())]));
    state.loadError = null;
  } catch (e) {
    state.loadError = e.message;
    state.levels = new Map();
  }
  state.loaded = true;
  emit('data');
  fetchOnline();
}

export async function reloadKeys(keys, all) {
  if (all) return loadAll();
  const res = await call('dt.loadLevels', { keys });
  for (const raw of res.levels) state.levels.set(raw.key, buildLevel(raw, opts()));
  for (const k of res.removed || []) state.levels.delete(k);
  emit('data', { keys });
  emit('live', { keys });
  fetchOnline();
}

onHost('dt.changed', ({ keys, all }) => {
  if (!settings().liveRefresh) return;
  reloadKeys(keys || [], all).catch((e) => console.error(e));
});

// ---------------------------------------------------------------- online extras

let onlineBusy = false;
export async function fetchOnline(force = false) {
  // Cached info is shown even when online lookups are off.
  if (!Object.keys(state.info).length) {
    try { state.info = await call('online.cached'); emit('info'); } catch { /* ignore */ }
  }
  fetchThumbs();
  if (!settings().online || onlineBusy) return;
  const ids = [...state.levels.values()].map((l) => l.lookupId).filter((id) => id > 0);
  const missing = force ? ids : ids.filter((id) => !state.info[id]);
  if (!missing.length) return;
  onlineBusy = true;
  try {
    state.info = await call('online.info', { ids: missing, force });
    emit('info');
    emit('data');
  } catch (e) { console.warn('online info', e); }
  finally { onlineBusy = false; }
}

const thumbQueue = [];
let thumbWorkers = 0;

/** Ensures small thumbnails for every online level (cached first, then downloaded a few at a time). */
export async function fetchThumbs() {
  if (!settings().autoThumbs) return;
  const ids = [...new Set([...state.levels.values()].map((l) => l.onlineId).filter((id) => id > 0))];
  const unknown = ids.filter((id) => !(id in state.thumbs));
  if (!unknown.length) return;
  try {
    const cached = await call('thumbs.cached', { ids: unknown, hd: false });
    Object.assign(state.thumbs, cached);
    if (Object.keys(cached).length) emit('thumbs');
  } catch { return; }
  if (!settings().online) return;
  for (const id of unknown) if (!(id in state.thumbs) && !thumbQueue.includes(id)) thumbQueue.push(id);
  while (thumbWorkers < 4 && thumbQueue.length) runThumbWorker();
}

async function runThumbWorker() {
  thumbWorkers++;
  try {
    while (thumbQueue.length) {
      const id = thumbQueue.shift();
      try {
        state.thumbs[id] = await call('thumbs.fetch', { id, hd: false });
      } catch {
        continue; // offline / server error: left unknown so a later refresh retries it
      }
      emit('thumb', id);
    }
  } finally { thumbWorkers--; }
}

/** Full-resolution thumbnail for the level page banner. */
export async function fetchHdThumb(id) {
  if (id in state.hdThumbs) return state.hdThumbs[id];
  try {
    const cached = await call('thumbs.cached', { ids: [id], hd: true });
    if (id in cached) return (state.hdThumbs[id] = cached[id]);
    if (!settings().online) return null;
    return (state.hdThumbs[id] = await call('thumbs.fetch', { id, hd: true }));
  } catch { return null; }
}

export async function clearThumbCache() {
  await call('thumbs.clearCache');
  state.thumbs = {};
  state.hdThumbs = {};
  emit('thumbs');
  fetchThumbs();
}
