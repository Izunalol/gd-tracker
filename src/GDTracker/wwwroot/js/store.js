// App state: the user's prefs (settings + per-level customisation, persisted by the host as prefs.json),
// the levels read from the Death Tracker folder, linked copies merged into one entity, and cached online
// extras (level info, thumbnails, demon lists).
import { call, on as onHost } from './rpc.js';
import { debounce } from './util.js';
import { buildLevel, applyPlaytime, makeEntity, applyAdjust, findCopies, pickPrimary, baseName, isPlainName, lengthFromTags, diffInfo, LENGTHS } from './data.js';

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
  cardStats: { attempts: true, playtime: true, best: true, lastPlayed: true, from0: false, sessions: false, completions: false, practice: false, enjoyment: false, length: false },
  showProgress: true,
  showDifficulty: true,
  showListRank: true,
  showCreator: true,
  sort: 'recent',
  sortDir: 'desc',
  groupBy: 'none',
  filterType: 'all',
  filterStatus: 'all',
  filterFav: false,
  filterTags: [],
  filterDiff: [],
  filterList: 'all',
  filterLength: [],
  showHidden: false,
  showSummary: true,
  pinFavorites: true,
  // data
  dataPath: '',
  liveRefresh: true,
  playtimeDead: true,
  playtimePaused: false,
  suggestLinks: true,
  // online
  online: true,
  autoThumbs: true,
  lists: true,
  matchListByName: true,
  // formats
  timeFormat: 'hm',
  dateFormat: 'relative',
  clockFormat: 'auto',
  // level page
  chartMetric: 'deaths',
  hideZeroPercent: false,
  // lists page
  listTab: 'pointercrate',
  listShow: 'all',
  listLegacy: false,
};

export const state = {
  prefs: { version: 1, settings: { ...DEFAULT_SETTINGS }, levels: {}, tagColors: {}, links: [], dismissedLinks: [] },
  raw: new Map(), // level key → level as Death Tracker has it
  levels: new Map(), // entity key → what the app shows (linked copies merged, manual numbers added)
  memberOf: new Map(), // raw level key → entity key
  folder: '',
  folderExists: true,
  detectedFolder: '',
  modInstalled: true,
  loaded: false,
  loadError: null,
  info: {}, // online level info by id
  thumbs: {}, // id → url | null (small)
  hdThumbs: {}, // id → url | null
  lists: { pointercrate: null, aredl: null }, // { fetched, levels, error }
  listIndex: { byId: new Map(), byName: new Map() },
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
      links: Array.isArray(p.links) ? p.links : [],
      dismissedLinks: Array.isArray(p.dismissedLinks) ? p.dismissedLinks : [],
    };
  } catch (e) { console.error('bad prefs', e); }
}

export function replacePrefs(p) {
  initPrefs(JSON.stringify(p));
  persist();
  rebuild();
  emit('prefs');
  emit('data');
}

/** Changes settings. Emits 'prefs'; options that change the numbers also rebuild the levels. */
export function setSettings(patch) {
  const s = state.prefs.settings;
  Object.assign(s, patch);
  persist();
  if (['playtimeDead', 'playtimePaused', 'matchListByName'].some((k) => k in patch)) { rebuild(); emit('data'); }
  if ('lists' in patch || 'online' in patch) loadLists();
  emit('prefs', patch);
}

/** Per-level customisation (name, thumb, thumbPos, color, tags, notes, fav, hidden, enjoy, listPos, length, adjust). */
export const custom = (key) => state.prefs.levels[key] || {};

export function setCustom(key, patch) {
  const cur = { ...custom(key), ...patch };
  for (const [k, v] of Object.entries(cur)) {
    if (v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length)) delete cur[k];
  }
  if (Object.keys(cur).length) state.prefs.levels[key] = cur;
  else delete state.prefs.levels[key];
  persist();
  // Numbers that feed the stats need the entity rebuilt.
  if (['adjust', 'listPos', 'noList', 'length'].some((k) => k in patch)) { rebuildOne(key); emit('data', { keys: [key] }); }
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
  let h = 7;
  for (const c of tag) h = (h * 131 + c.charCodeAt(0) * 7) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}
export function setTagColor(tag, color) {
  state.prefs.tagColors[tag] = color;
  persist();
  emit('prefs');
}

// ---------------------------------------------------------------- linking copies

/** The link group a raw level belongs to (or null). */
export const linkOf = (key) => state.prefs.links.find((g) => g.members.includes(key)) || null;

/**
 * Links levels into one. The first key (or an existing group's main level) stays the main one, and
 * customisation the main level lacks is taken from the others so no thumbnail or tag is lost.
 */
export function linkLevels(keys, primary) {
  keys = [...new Set(keys)].filter((k) => state.raw.has(k));
  if (keys.length < 2) return;
  const groups = state.prefs.links.filter((g) => g.members.some((m) => keys.includes(m)));
  const members = [...new Set([...groups.flatMap((g) => g.members), ...keys])];
  primary = primary || groups[0]?.primary || keys[0];
  state.prefs.links = state.prefs.links.filter((g) => !groups.includes(g));
  state.prefs.links.push({ primary, members });
  inheritCustom(primary, members.filter((m) => m !== primary));
  persist();
  rebuild();
  emit('data');
  emit('custom', primary);
}

function inheritCustom(primary, others) {
  const c = { ...custom(primary) };
  for (const k of others) {
    const o = custom(k);
    for (const [f, v] of Object.entries(o)) {
      if (f === 'tags') c.tags = [...new Set([...(c.tags || []), ...v])];
      else if (f === 'notes' && c.notes && v && !c.notes.includes(v)) c.notes += '\n\n' + v;
      else if (c[f] == null || c[f] === '') c[f] = v;
    }
  }
  state.prefs.levels[primary] = c;
}

/** Removes one level from its group (the group dissolves when one member is left). */
export function unlinkLevel(key) {
  const g = linkOf(key);
  if (!g) return;
  g.members = g.members.filter((m) => m !== key);
  if (g.primary === key) {
    const next = g.members[0];
    // The group's customisation moves to the new main level; the removed level keeps a copy.
    if (next) state.prefs.levels[next] = { ...custom(key), ...custom(next) };
    g.primary = next;
  }
  if (g.members.length < 2) state.prefs.links = state.prefs.links.filter((x) => x !== g);
  persist();
  rebuild();
  emit('data');
  emit('custom', key);
}

export function setPrimary(key) {
  const g = linkOf(key);
  if (!g || g.primary === key) return;
  state.prefs.levels[key] = { ...custom(key), ...custom(g.primary) };
  g.primary = key;
  persist();
  rebuild();
  emit('data');
}

/**
 * Two online uploads with exactly the same name by different creators are different levels (there are
 * two extreme demons called "Azurite"), as are two levels the lists know as different entries.
 */
function distinctLevels(a, b) {
  if (!(a.lookupId > 0 && b.lookupId > 0) || a.lookupId === b.lookupId) return false;
  const la = state.listIndex.byId.get(a.lookupId), lb = state.listIndex.byId.get(b.lookupId);
  if (la && lb) return true;
  const ia = state.info[a.lookupId], ib = state.info[b.lookupId];
  const norm = (n) => String(n || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  // Start-pos copies are uploaded by all sorts of people, so this only applies to plain names.
  return norm(a.rawName) === norm(b.rawName) && isPlainName(a.rawName) && isPlainName(b.rawName) && !!ia?.creator && !!ib?.creator && ia.creator.toLowerCase() !== ib.creator.toLowerCase();
}

const sig = (keys) => keys.slice().sort().join('|');

/** Copy groups the user hasn't linked or dismissed yet. */
export function linkSuggestions() {
  const raws = [...state.raw.values()];
  const dismissed = new Set(state.prefs.dismissedLinks);
  return findCopies(raws, distinctLevels)
    .map((group) => {
      // Drop members already linked together; suggest only what would add something new.
      const byEntity = new Map();
      for (const l of group) {
        const ek = state.memberOf.get(l.key) || l.key;
        if (!byEntity.has(ek)) byEntity.set(ek, l);
      }
      const levels = [...byEntity.values()];
      return { levels, primary: pickPrimary(levels, (l) => !!state.listIndex.byId.get(l.lookupId)), name: baseName(levels[0].rawName), sig: sig(group.map((l) => l.key)) };
    })
    .filter((s) => s.levels.length > 1 && !dismissed.has(s.sig))
    .sort((a, b) => b.levels.length - a.levels.length || a.name.localeCompare(b.name));
}

export function dismissSuggestion(s) {
  state.prefs.dismissedLinks.push(s.sig);
  persist();
  emit('links');
}

// ---------------------------------------------------------------- level helpers

export function displayName(level) {
  return custom(level.key).name || level.rawName;
}

export const levelInfo = (level) => (level.lookupId ? state.info[level.lookupId] : null);

/** GD difficulty face, preferring fresh server info (the mod only updates it when you play the level). */
export function levelDifficulty(level) {
  const info = levelInfo(level);
  const d = info && !info.missing ? info.difficulty : level.difficulty;
  // A list level copied into the editor has no rating of its own, but we know what it is.
  if (diffInfo(d).rank < 6 && level.list && level.list.source !== 'manual') return 10;
  return d;
}

export const isPlatformer = (level) => level.lengthCat === 5;

/** "73%" for classic levels; platformer progress is checkpoint-based. */
export function pctLabel(level, p) {
  if (p == null) return '–';
  return isPlatformer(level) ? `CP ${p}` : `${p}%`;
}

export const isCompleted = (level) => level.sum.completions > 0 || level.sum.best >= 100;

/**
 * Hardness for sorting: list placement beats everything (lower position = harder), then the GD face.
 * Returns a number where bigger = harder.
 */
export function hardness(level) {
  if (level.list) return 100000 - level.list.position;
  return diffInfo(levelDifficulty(level)).rank;
}

export const LIST_NAMES = { pointercrate: 'Demonlist', aredl: 'AREDL', manual: 'Manual' };

// ---------------------------------------------------------------- loading

const opts = () => ({ playtimeDead: settings().playtimeDead, playtimePaused: settings().playtimePaused });

/** Recomputes every entity from the raw levels, links, manual adjustments and lists. */
export function rebuild() {
  for (const l of state.raw.values()) applyPlaytime(l, opts());
  const levels = new Map();
  const memberOf = new Map();
  const used = new Set();
  for (const g of state.prefs.links) {
    const members = g.members.filter((k) => state.raw.has(k) && !used.has(k));
    if (!members.length) continue;
    const primaryKey = members.includes(g.primary) ? g.primary : members[0];
    const primary = state.raw.get(primaryKey);
    const others = members.filter((k) => k !== primaryKey).map((k) => state.raw.get(k));
    levels.set(primaryKey, finish(makeEntity(primary, others, opts())));
    for (const k of members) { memberOf.set(k, primaryKey); used.add(k); }
  }
  for (const [k, l] of state.raw) {
    if (used.has(k)) continue;
    levels.set(k, finish(makeEntity(l, [], opts())));
    memberOf.set(k, k);
  }
  state.levels = levels;
  state.memberOf = memberOf;
}

function rebuildOne(key) {
  const ek = state.memberOf.get(key) || key;
  const e = state.levels.get(ek);
  if (!e) return;
  const [primary, ...others] = e.members;
  state.levels.set(ek, finish(makeEntity(primary, others, opts())));
}

/** Adds the things that come from outside Death Tracker: manual numbers, list placement, length. */
function finish(e) {
  const c = custom(e.key);
  applyAdjust(e, c.adjust);
  e.list = listRank(e, c);
  const info = e.lookupId ? state.info[e.lookupId] : null;
  const aredl = e.list?.aredl;
  e.lengthCat = c.length != null && c.length !== '' ? +c.length
    : info && !info.missing && info.length != null ? info.length
    : lengthFromTags(aredl?.tags);
  e.lengthManual = c.length != null && c.length !== '';
  // Editor and start-pos copies of a list level can borrow its thumbnail.
  if (!(e.onlineId > 0) && e.list?.entry?.levelId > 0) e.onlineId = +e.list.entry.levelId;
  return e;
}

/**
 * Where a level sits on the community lists: Pointercrate for the top 150, else AREDL, else the user's
 * own placement. Matched by level id, or by name for copies (editor/start-pos levels have their own ids).
 */
function listRank(e, c) {
  if (c.noList) return null;
  if (c.listPos) return { source: 'manual', position: +c.listPos };
  const idx = state.listIndex;
  const ids = e.members.map((m) => m.lookupId).filter(Boolean);
  if (e.lookupId) ids.unshift(e.lookupId);
  let hit = null, by = 'id';
  for (const id of ids) { hit = idx.byId.get(id); if (hit) break; }
  if (!hit && settings().matchListByName) {
    for (const m of e.members) {
      // A plain-named online level that isn't on the list by id is usually just another level with the same
      // name — unless the servers say it's an Extreme Demon. Editor levels and start-pos uploads are copies.
      if (m.lookupId && isPlainName(m.rawName) && state.info[m.lookupId]?.difficulty !== 10) continue;
      const n = baseName(m.rawName, true);
      hit = n.length >= 4 ? idx.byName.get(n) : null;
      if (hit) { by = 'name'; break; }
    }
  }
  if (!hit) return null;
  const pc = hit.pointercrate, ar = hit.aredl;
  if (pc && pc.position <= 150) return { source: 'pointercrate', position: pc.position, by, entry: pc, aredl: ar };
  if (ar && !ar.legacy) return { source: 'aredl', position: Math.max(151, ar.position), aredlPosition: ar.position, by, entry: ar, aredl: ar };
  return null;
}

/** List placement ignoring the user's own override (shown next to the manual field). */
export const autoListRank = (e) => listRank(e, {});

function indexLists() {
  const byId = new Map(), byName = new Map();
  const add = (src, l) => {
    const id = +l.levelId;
    if (id > 0) {
      if (!byId.has(id)) byId.set(id, {});
      byId.get(id)[src] = l;
    }
    const n = baseName(l.name, true);
    if (n.length >= 4) {
      if (!byName.has(n)) byName.set(n, {});
      // Keep the hardest entry when names collide.
      if (!byName.get(n)[src] || byName.get(n)[src].position > l.position) byName.get(n)[src] = l;
    }
  };
  for (const l of state.lists.pointercrate?.levels || []) add('pointercrate', l);
  for (const l of state.lists.aredl?.levels || []) add('aredl', l);
  state.listIndex = { byId, byName };
}

export async function loadAll() {
  try {
    const res = await call('dt.load', { path: settings().dataPath || '' });
    state.folder = res.folder;
    state.folderExists = res.exists;
    state.raw = new Map(res.levels.map((raw) => [raw.key, buildLevel(raw, opts())]));
    state.loadError = null;
  } catch (e) {
    state.loadError = e.message;
    state.raw = new Map();
  }
  rebuild();
  state.loaded = true;
  emit('data');
  fetchOnline();
  loadLists();
}

export async function reloadKeys(keys, all) {
  if (all) return loadAll();
  const res = await call('dt.loadLevels', { keys });
  for (const raw of res.levels) state.raw.set(raw.key, buildLevel(raw, opts()));
  for (const k of res.removed || []) state.raw.delete(k);
  rebuild();
  const entityKeys = keys.map((k) => state.memberOf.get(k) || k);
  emit('data', { keys: entityKeys });
  emit('live', { keys: entityKeys });
  fetchOnline();
}

onHost('dt.changed', ({ keys, all }) => {
  if (!settings().liveRefresh) return;
  reloadKeys(keys || [], all).catch((e) => console.error(e));
});

// ---------------------------------------------------------------- demon lists

let listsBusy = null;
export function loadLists(force = false) {
  if (listsBusy && !force) return listsBusy;
  listsBusy = (async () => {
    const online = settings().online && settings().lists;
    await Promise.all(['pointercrate', 'aredl'].map(async (name) => {
      try { state.lists[name] = await call('lists.get', { name, force, online }); }
      catch (e) { state.lists[name] = { fetched: 0, levels: [], error: e.message }; }
    }));
    indexLists();
    rebuild();
    emit('lists');
    emit('data');
    fetchThumbs();
  })().finally(() => { listsBusy = null; });
  return listsBusy;
}

// ---------------------------------------------------------------- online extras

let onlineBusy = false;
export async function fetchOnline(force = false) {
  // Cached info is shown even when online lookups are off.
  if (!Object.keys(state.info).length) {
    try { state.info = await call('online.cached'); rebuild(); emit('info'); } catch { /* ignore */ }
  }
  fetchThumbs();
  if (!settings().online || onlineBusy) return;
  const ids = [...new Set([...state.raw.values()].map((l) => l.lookupId).filter((id) => id > 0))];
  const missing = force ? ids : ids.filter((id) => !state.info[id]);
  if (!missing.length) return;
  onlineBusy = true;
  try {
    state.info = await call('online.info', { ids: missing, force });
    rebuild();
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

export { LENGTHS };
