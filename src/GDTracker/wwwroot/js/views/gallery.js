// Home page: every tracked level as a card (or a table row), with search, sort, filters and grouping.
import { state, settings, setSettings, custom, setCustom, displayName, levelInfo, levelDifficulty, pctLabel, isCompleted, allTags, tagColor, on } from '../store.js';
import { diffInfo, DIFF_ORDER, TYPES } from '../data.js';
import { thumbBox } from '../thumbs.js';
import { meter } from '../charts.js';
import { icon } from '../icons.js';
import { h, showMenu, toast } from '../ui.js';
import { esc, num, compact, duration, when, absDate, collator, debounce, plural, toCSV } from '../util.js';
import { dragHasImages, extractSources, storeSource } from '../images.js';
import { levelMenuItems } from './customize.js';
import { call } from '../rpc.js';

export const SORTS = [
  { id: 'recent', label: 'Last played', get: (l) => l.lastPlayed, dir: 'desc' },
  { id: 'attempts', label: 'Attempts', get: (l) => l.attempts, dir: 'desc' },
  { id: 'playtime', label: 'Playtime', get: (l) => l.playtime, dir: 'desc' },
  { id: 'best', label: 'Best %', get: (l) => l.sum.best ?? -1, dir: 'desc' },
  { id: 'name', label: 'Name', get: (l) => displayName(l), dir: 'asc', text: true },
  { id: 'difficulty', label: 'Difficulty', get: (l) => diffInfo(levelDifficulty(l)).rank, dir: 'desc' },
  { id: 'from0', label: 'From-0 attempts', get: (l) => l.sum.from0, dir: 'desc' },
  { id: 'practice', label: 'Practice runs', get: (l) => l.sum.runs, dir: 'desc' },
  { id: 'sessions', label: 'Sessions', get: (l) => l.sessions.length, dir: 'desc' },
  { id: 'completions', label: 'Completions', get: (l) => l.sum.completions, dir: 'desc' },
  { id: 'first', label: 'First played', get: (l) => l.firstPlayed, dir: 'desc' },
];

const GROUPS = [
  { id: 'none', label: 'No grouping' },
  { id: 'difficulty', label: 'Difficulty' },
  { id: 'status', label: 'Completed / in progress' },
  { id: 'type', label: 'Level type' },
  { id: 'tag', label: 'Tag' },
  { id: 'month', label: 'Month last played' },
];

const CARD_STATS = [
  { id: 'attempts', label: 'Attempts', icon: 'refresh', val: (l) => compact(l.attempts) },
  { id: 'playtime', label: 'Playtime', icon: 'clock', val: (l) => (l.playtime > 0 ? duration(l.playtime) : '–') },
  { id: 'best', label: 'Best', icon: 'trophy', val: (l) => pctLabel(l, l.sum.best) },
  { id: 'lastPlayed', label: 'Last played', icon: 'calendar', val: (l) => when(l.lastPlayed) },
  { id: 'from0', label: 'From-0 attempts', icon: 'skull', val: (l) => compact(l.sum.from0) },
  { id: 'practice', label: 'Practice runs', icon: 'flag', val: (l) => compact(l.sum.runs) },
  { id: 'sessions', label: 'Sessions', icon: 'layers', val: (l) => num(l.sessions.length) },
  { id: 'completions', label: 'Completions', icon: 'checkCircle', val: (l) => num(l.sum.completions) },
];
export { CARD_STATS };

let query = '';
let root = null;
let unsub = [];
let scrollMemory = 0;

export function mountGallery(el) {
  root = el;
  render();
  wire();
  const rerender = debounce(() => render(true), 60);
  unsub = [
    on('data', rerender),
    on('info', rerender),
    on('prefs', rerender),
    on('custom', rerender),
  ];
  el.parentElement.scrollTop = scrollMemory;
}

export function unmountGallery() {
  scrollMemory = root?.parentElement?.scrollTop || 0;
  unsub.forEach((u) => u());
  unsub = [];
  root = null;
}

// ---------------------------------------------------------------- filtering & sorting

function matches(l, q) {
  if (!q) return true;
  const info = levelInfo(l);
  const c = custom(l.key);
  const hay = [displayName(l), l.rawName, l.id, info?.creator, info?.song, ...(c.tags || [])].join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export function visibleLevels() {
  const s = settings();
  const q = query.trim().toLowerCase();
  let list = [...state.levels.values()].filter((l) => {
    const c = custom(l.key);
    if (c.hidden && !s.showHidden) return false;
    if (s.filterType !== 'all' && l.type !== s.filterType) return false;
    if (s.filterStatus === 'completed' && !isCompleted(l)) return false;
    if (s.filterStatus === 'progress' && isCompleted(l)) return false;
    if (s.filterFav && !c.fav) return false;
    if (s.filterDiff.length && !s.filterDiff.includes(levelDifficulty(l))) return false;
    if (s.filterTags.length && !s.filterTags.some((t) => (c.tags || []).includes(t))) return false;
    return matches(l, q);
  });
  const sort = SORTS.find((x) => x.id === s.sort) || SORTS[0];
  const dir = s.sortDir === 'asc' ? 1 : -1;
  list.sort((a, b) => {
    if (s.pinFavorites) {
      const fa = custom(a.key).fav ? 1 : 0, fb = custom(b.key).fav ? 1 : 0;
      if (fa !== fb) return fb - fa;
    }
    const va = sort.get(a), vb = sort.get(b);
    const r = sort.text ? collator.compare(va, vb) : (va ?? 0) - (vb ?? 0);
    return r * dir || collator.compare(displayName(a), displayName(b));
  });
  return list;
}

function groupLevels(list) {
  const g = settings().groupBy;
  if (g === 'none') return [{ title: null, levels: list }];
  const map = new Map();
  const add = (k, title, l, order) => {
    if (!map.has(k)) map.set(k, { title, levels: [], order });
    map.get(k).levels.push(l);
  };
  for (const l of list) {
    if (g === 'difficulty') {
      const d = levelDifficulty(l), di = diffInfo(d);
      add(d, di.name, l, -di.rank);
    } else if (g === 'status') {
      const c = isCompleted(l);
      add(c, c ? 'Completed' : 'In progress', l, c ? 1 : 0);
    } else if (g === 'type') {
      add(l.type, TYPES[l.type], l, Object.keys(TYPES).indexOf(l.type));
    } else if (g === 'tag') {
      const tags = custom(l.key).tags || [];
      if (!tags.length) add('~', 'Untagged', l, 'zzzz');
      for (const t of tags) add('t:' + t, t, l, t.toLowerCase());
    } else if (g === 'month') {
      const d = new Date(l.lastPlayed * 1000);
      add(d.getFullYear() * 12 + d.getMonth(), d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), l, -(d.getFullYear() * 12 + d.getMonth()));
    }
  }
  return [...map.values()].sort((a, b) => (typeof a.order === 'string' ? a.order.localeCompare(b.order) : a.order - b.order));
}

// ---------------------------------------------------------------- render

function render(keepScroll = false) {
  if (!root) return;
  const scroller = root.parentElement;
  const top = scroller.scrollTop;
  const s = settings();
  const list = visibleLevels();
  const total = state.levels.size;

  root.innerHTML = '';
  root.className = `page gallery view-${s.view} card-${s.cardStyle}`;
  root.style.setProperty('--card-min', s.cardSize + 'px');
  root.style.setProperty('--card-aspect', s.cardAspect);

  if (!state.loaded) { root.append(h('<div class="empty"><span class="spinner big"></span></div>')); return; }
  if (state.loadError || !state.folderExists || total === 0) { root.append(emptyState()); return; }

  if (s.showSummary) root.append(summary(list));
  root.append(toolbar(list.length, total));

  if (!list.length) {
    root.append(h(`<div class="empty small"><div class="empty-icon">${icon('search')}</div><div>No levels match.</div>
      <button class="btn" data-a="clear">Clear search & filters</button></div>`));
    root.querySelector('[data-a=clear]').onclick = () => {
      query = '';
      setSettings({ filterType: 'all', filterStatus: 'all', filterFav: false, filterDiff: [], filterTags: [] });
    };
    return;
  }

  if (s.view === 'list') root.append(table(list));
  else {
    for (const g of groupLevels(list)) {
      const sec = h(`<section class="group">${g.title != null ? `<h3 class="group-title">${esc(g.title)}<span>${g.levels.length}</span></h3>` : ''}<div class="grid"></div></section>`);
      sec.querySelector('.grid').innerHTML = g.levels.map(card).join('');
      root.append(sec);
    }
  }
  if (keepScroll) scroller.scrollTop = top;
}

function summary(list) {
  const pt = list.reduce((a, l) => a + l.playtime, 0);
  const att = list.reduce((a, l) => a + l.attempts, 0);
  const done = list.filter(isCompleted).length;
  const recent = list.reduce((a, l) => Math.max(a, l.lastPlayed), 0);
  return h(`<div class="summary">
    <div class="tile"><div class="tile-label">Levels</div><div class="tile-value">${num(list.length)}</div></div>
    <div class="tile"><div class="tile-label">Playtime</div><div class="tile-value">${duration(pt)}</div></div>
    <div class="tile"><div class="tile-label">Attempts</div><div class="tile-value">${compact(att)}</div></div>
    <div class="tile"><div class="tile-label">Completed</div><div class="tile-value">${num(done)}<small> / ${num(list.length)}</small></div></div>
    <div class="tile"><div class="tile-label">Last played</div><div class="tile-value sm">${esc(when(recent))}</div></div>
  </div>`);
}

function toolbar(shown, total) {
  const s = settings();
  const sort = SORTS.find((x) => x.id === s.sort) || SORTS[0];
  const filterCount = (s.filterType !== 'all') + (s.filterStatus !== 'all') + s.filterFav + (s.filterDiff.length > 0) + (s.filterTags.length > 0) + s.showHidden;
  const el = h(`<div class="toolbar">
    <label class="search">${icon('search')}<input type="search" placeholder="Search levels, creators, tags…" value="${esc(query)}" spellcheck="false"></label>
    <button class="btn ghost ${filterCount ? 'active' : ''}" data-a="filter">${icon('filter')}<span>Filter${filterCount ? ` · ${filterCount}` : ''}</span></button>
    <div class="btn-group">
      <button class="btn ghost" data-a="sort">${icon('sort')}<span>${esc(sort.label)}</span></button>
      <button class="btn ghost icon-only" data-a="dir" title="${s.sortDir === 'asc' ? 'Ascending' : 'Descending'}">${icon(s.sortDir === 'asc' ? 'arrowUp' : 'arrowDown')}</button>
    </div>
    <button class="btn ghost ${s.groupBy !== 'none' ? 'active' : ''}" data-a="group">${icon('layers')}<span>${s.groupBy === 'none' ? 'Group' : esc(GROUPS.find((g) => g.id === s.groupBy).label)}</span></button>
    <span class="spacer"></span>
    <span class="count">${shown === total ? plural(total, 'level') : `${num(shown)} of ${plural(total, 'level')}`}</span>
    ${s.view === 'grid' ? `<input class="size-slider" type="range" min="180" max="480" step="10" value="${s.cardSize}" title="Card size">` : ''}
    <div class="seg small">
      <button class="seg-btn ${s.view === 'grid' ? 'on' : ''}" data-view="grid" title="Gallery">${icon('grid')}</button>
      <button class="seg-btn ${s.view === 'list' ? 'on' : ''}" data-view="list" title="Table">${icon('list')}</button>
    </div>
    <button class="btn ghost icon-only" data-a="more" title="More">${icon('ellipsis')}</button>
  </div>`);
  const input = el.querySelector('input[type=search]');
  input.addEventListener('input', debounce(() => { query = input.value; renderKeepFocus(); }, 120));
  el.querySelector('[data-a=filter]').onclick = (e) => filterMenu(e.currentTarget);
  el.querySelector('[data-a=sort]').onclick = (e) => showMenu(SORTS.map((x) => ({
    label: x.label, checked: x.id === s.sort,
    action: () => setSettings({ sort: x.id, sortDir: x.id === s.sort ? s.sortDir : x.dir }),
  })), e.currentTarget);
  el.querySelector('[data-a=dir]').onclick = () => setSettings({ sortDir: s.sortDir === 'asc' ? 'desc' : 'asc' });
  el.querySelector('[data-a=group]').onclick = (e) => showMenu(GROUPS.map((g) => ({
    label: g.label, checked: g.id === s.groupBy, action: () => setSettings({ groupBy: g.id }),
  })), e.currentTarget);
  el.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => setSettings({ view: b.dataset.view })));
  const slider = el.querySelector('.size-slider');
  if (slider) {
    slider.addEventListener('input', () => root.style.setProperty('--card-min', slider.value + 'px'));
    slider.addEventListener('change', () => setSettings({ cardSize: +slider.value }));
  }
  el.querySelector('[data-a=more]').onclick = (e) => showMenu([
    { label: 'Show summary', checked: s.showSummary, action: () => setSettings({ showSummary: !s.showSummary }) },
    { label: 'Favourites first', checked: s.pinFavorites, action: () => setSettings({ pinFavorites: !s.pinFavorites }) },
    { label: 'Card style', submenu: [
      { label: 'Text on image', checked: s.cardStyle === 'overlay', action: () => setSettings({ cardStyle: 'overlay' }) },
      { label: 'Text below image', checked: s.cardStyle === 'below', action: () => setSettings({ cardStyle: 'below' }) },
      { label: 'Compact', checked: s.cardStyle === 'compact', action: () => setSettings({ cardStyle: 'compact' }) },
    ] },
    { label: 'Card shape', submenu: [
      { label: 'Widescreen (16:9)', checked: s.cardAspect === '16/9', action: () => setSettings({ cardAspect: '16/9' }) },
      { label: 'Classic (4:3)', checked: s.cardAspect === '4/3', action: () => setSettings({ cardAspect: '4/3' }) },
      { label: 'Square', checked: s.cardAspect === '1/1', action: () => setSettings({ cardAspect: '1/1' }) },
      { label: 'Cinematic (21:9)', checked: s.cardAspect === '21/9', action: () => setSettings({ cardAspect: '21/9' }) },
    ] },
    { label: 'Stats on cards', submenu: CARD_STATS.map((c) => ({
      label: c.label, checked: !!s.cardStats[c.id],
      action: () => setSettings({ cardStats: { ...s.cardStats, [c.id]: !s.cardStats[c.id] } }),
    })) },
    '-',
    { label: 'Export table as CSV…', icon: 'download', action: exportCsv },
  ], e.currentTarget, { align: 'end' });
  return el;
}

function renderKeepFocus() {
  const pos = root.querySelector('.search input')?.selectionStart;
  render(true);
  const input = root.querySelector('.search input');
  if (input) { input.focus(); input.setSelectionRange(pos, pos); }
}

function filterMenu(anchor) {
  const s = settings();
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const tags = allTags();
  showMenu([
    { header: 'Type' },
    { label: 'All levels', checked: s.filterType === 'all', action: () => setSettings({ filterType: 'all' }) },
    ...Object.entries(TYPES).filter(([k]) => [...state.levels.values()].some((l) => l.type === k))
      .map(([k, v]) => ({ label: v, checked: s.filterType === k, action: () => setSettings({ filterType: k }) })),
    '-',
    { header: 'Status' },
    { label: 'Any', checked: s.filterStatus === 'all', action: () => setSettings({ filterStatus: 'all' }) },
    { label: 'Completed', checked: s.filterStatus === 'completed', action: () => setSettings({ filterStatus: 'completed' }) },
    { label: 'In progress', checked: s.filterStatus === 'progress', action: () => setSettings({ filterStatus: 'progress' }) },
    '-',
    { label: 'Difficulty', submenu: [
      ...DIFF_ORDER.slice().reverse().map((d) => ({
        label: diffInfo(d).name, swatch: diffInfo(d).color, checked: s.filterDiff.includes(d),
        action: () => setSettings({ filterDiff: toggle(s.filterDiff, d) }),
      })),
      '-',
      { label: 'Any difficulty', action: () => setSettings({ filterDiff: [] }) },
    ] },
    { label: 'Tags', disabled: !tags.length, submenu: tags.length ? [
      ...tags.map((t) => ({ label: t, swatch: tagColor(t), checked: s.filterTags.includes(t), action: () => setSettings({ filterTags: toggle(s.filterTags, t) }) })),
      '-',
      { label: 'Any tag', action: () => setSettings({ filterTags: [] }) },
    ] : [] },
    '-',
    { label: 'Favourites only', checked: s.filterFav, action: () => setSettings({ filterFav: !s.filterFav }) },
    { label: 'Show hidden levels', checked: s.showHidden, action: () => setSettings({ showHidden: !s.showHidden }) },
    '-',
    { label: 'Reset filters', action: () => setSettings({ filterType: 'all', filterStatus: 'all', filterFav: false, filterDiff: [], filterTags: [], showHidden: false }) },
  ], anchor);
}

export function diffChip(level, cls = '') {
  const diff = levelDifficulty(level);
  if (diff === 0 && level.type === 'editor') return ''; // unrated by definition, the badge says nothing
  const d = diffInfo(diff);
  const info = levelInfo(level);
  const stars = info && !info.missing && info.stars ? `<span class="stars">${info.stars}${icon('starFill')}</span>` : '';
  return `<span class="diff ${cls}" style="--d:${d.color}"><i></i>${esc(d.name)}${stars}</span>`;
}

function card(l) {
  const s = settings();
  const c = custom(l.key);
  const info = levelInfo(l);
  const best = l.sum.best ?? 0;
  const done = isCompleted(l);
  const creator = s.showCreator && info?.creator ? `<span>by ${esc(info.creator)}</span>` : l.type === 'editor' ? '<span>Editor level</span>' : l.type === 'main' ? '<span>Main level</span>' : '';
  const stats = CARD_STATS.filter((x) => s.cardStats[x.id]).map((x) =>
    `<span class="cs" title="${esc(x.label)}">${icon(x.icon)}${esc(x.val(l))}</span>`).join('');
  const color = c.color ? `--lvl:${c.color};` : '';
  return `<a class="card ${done ? 'done' : ''} ${c.hidden ? 'is-hidden' : ''}" href="#/level/${encodeURIComponent(l.key)}" data-key="${esc(l.key)}" style="${color}" draggable="false">
    <div class="card-media">
      ${thumbBox(l)}
      <div class="card-badges">
        ${s.showDifficulty ? diffChip(l) : ''}
        <span class="sp"></span>
        ${c.hidden ? `<span class="badge-ic" title="Hidden">${icon('eyeSlash')}</span>` : ''}
        <button class="fav ${c.fav ? 'on' : ''}" data-fav title="${c.fav ? 'Remove from favourites' : 'Add to favourites'}">${icon(c.fav ? 'starFill' : 'star')}</button>
      </div>
      ${done ? `<span class="done-badge" title="Completed">${icon('check')}</span>` : ''}
    </div>
    <div class="card-info">
      <div class="card-title" title="${esc(displayName(l))}">${esc(displayName(l))}</div>
      ${creator ? `<div class="card-sub">${creator}</div>` : ''}
      ${stats ? `<div class="card-stats">${stats}</div>` : ''}
    </div>
    ${s.showProgress ? `<div class="card-progress" title="Best from 0: ${esc(pctLabel(l, l.sum.best))}">${meter(best / 100, done ? 'done' : '')}</div>` : ''}
  </a>`;
}

function table(list) {
  const s = settings();
  const cols = [
    { id: 'name', label: 'Level', cls: 'name' },
    { id: 'difficulty', label: 'Difficulty' },
    { id: 'attempts', label: 'Attempts', num: true },
    { id: 'playtime', label: 'Playtime', num: true },
    { id: 'best', label: 'Best', num: true },
    { id: 'from0', label: 'From 0', num: true },
    { id: 'practice', label: 'Practice', num: true },
    { id: 'completions', label: 'Done', num: true },
    { id: 'sessions', label: 'Sessions', num: true },
    { id: 'recent', label: 'Last played', num: true },
  ];
  const row = (l) => {
    const c = custom(l.key);
    const info = levelInfo(l);
    return `<tr data-key="${esc(l.key)}" class="${c.hidden ? 'is-hidden' : ''}">
      <td class="name"><div class="row-name">${thumbBox(l, 'mini')}<div><div class="rn-title">${c.fav ? `<span class="fav-dot">${icon('starFill')}</span>` : ''}${esc(displayName(l))}</div>
        <div class="rn-sub">${info?.creator ? `by ${esc(info.creator)} · ` : ''}${esc(TYPES[l.type])}${l.id != null && l.type !== 'editor' ? ` · ${l.id}` : ''}</div></div></div></td>
      <td>${diffChip(l, 'flat')}</td>
      <td class="num">${num(l.attempts)}</td>
      <td class="num">${duration(l.playtime)}</td>
      <td class="num">${pctLabel(l, l.sum.best)}</td>
      <td class="num">${num(l.sum.from0)}</td>
      <td class="num">${num(l.sum.runs)}</td>
      <td class="num">${num(l.sum.completions)}</td>
      <td class="num">${num(l.sessions.length)}</td>
      <td class="num" title="${esc(absDate(l.lastPlayed))}">${esc(when(l.lastPlayed))}</td>
    </tr>`;
  };
  const el = h(`<div class="table-wrap"><table class="tbl levels">
    <thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''} ${c.cls || ''} ${s.sort === c.id ? 'sorted ' + s.sortDir : ''}" data-sort="${c.id}">${esc(c.label)}${s.sort === c.id ? icon(s.sortDir === 'asc' ? 'chevronUp' : 'chevronDown') : ''}</th>`).join('')}</tr></thead>
    <tbody>${list.map(row).join('')}</tbody></table></div>`);
  el.querySelectorAll('th[data-sort]').forEach((th) => (th.onclick = () => {
    const id = th.dataset.sort;
    const def = SORTS.find((x) => x.id === id);
    setSettings({ sort: id, sortDir: s.sort === id ? (s.sortDir === 'asc' ? 'desc' : 'asc') : def.dir });
  }));
  return el;
}

// ---------------------------------------------------------------- interaction

function wire() {
  root.addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      e.preventDefault();
      e.stopPropagation();
      const key = fav.closest('[data-key]').dataset.key;
      setCustom(key, { fav: !custom(key).fav });
      return;
    }
    const tr = e.target.closest('tr[data-key]');
    if (tr) location.hash = `#/level/${encodeURIComponent(tr.dataset.key)}`;
  });
  root.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('[data-key]');
    if (!el) return;
    e.preventDefault();
    const level = state.levels.get(el.dataset.key);
    if (level) showMenu(levelMenuItems(level, { open: true }), { x: e.clientX, y: e.clientY });
  });
  wireDrops();
}

let dropWired = false;
function wireDrops() {
  if (dropWired) return;
  dropWired = true;
  // Dropping an image (file or from a browser) onto a card makes it that level's thumbnail.
  document.addEventListener('dragover', (e) => {
    if (!root || !dragHasImages(e.dataTransfer)) return;
    const cardEl = e.target.closest?.('.card, tr[data-key]');
    document.querySelectorAll('.drop-target').forEach((x) => x !== cardEl && x.classList.remove('drop-target'));
    if (!cardEl || document.querySelector('.layer')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    cardEl.classList.add('drop-target');
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) document.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
  });
  document.addEventListener('drop', async (e) => {
    if (!root || document.querySelector('.layer')) return;
    const cardEl = e.target.closest?.('.card, tr[data-key]');
    document.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
    if (!cardEl) return;
    e.preventDefault();
    const { sources, pageUrl } = extractSources(e.dataTransfer);
    const src = sources[0] || (pageUrl ? { url: pageUrl } : null);
    if (!src) return;
    const key = cardEl.dataset.key;
    const t = toast('Setting thumbnail…', { spinner: true, timeout: 0 });
    try {
      const id = await storeSource(src);
      setCustom(key, { thumb: id, thumbPos: 50 });
      t.done(`Thumbnail set for ${displayName(state.levels.get(key))}`);
    } catch (err) {
      t.done(err.message, 5000);
    }
  });
}

async function exportCsv() {
  const list = visibleLevels();
  const rows = [['Level', 'ID', 'Type', 'Difficulty', 'Creator', 'Attempts', 'Playtime (h)', 'Best %', 'From-0 attempts', 'Practice runs', 'Completions', 'Sessions', 'First played', 'Last played', 'Tags']];
  for (const l of list) {
    const info = levelInfo(l);
    rows.push([displayName(l), l.id, TYPES[l.type], diffInfo(levelDifficulty(l)).name, info?.creator || '', l.attempts, (l.playtime / 3600).toFixed(2),
      l.sum.best ?? '', l.sum.from0, l.sum.runs, l.sum.completions, l.sessions.length,
      l.firstPlayed ? new Date(l.firstPlayed * 1000).toISOString().slice(0, 10) : '', l.lastPlayed ? new Date(l.lastPlayed * 1000).toISOString().slice(0, 10) : '',
      (custom(l.key).tags || []).join('; ')]);
  }
  const path = await call('file.saveText', { name: 'GD levels.csv', filter: 'CSV (*.csv)|*.csv', content: toCSV(rows), bom: true });
  if (path) toast('Exported ' + plural(list.length, 'level'));
}

function emptyState() {
  const notInstalled = !state.modInstalled && !settings().dataPath;
  const el = h(`<div class="empty">
    <div class="empty-icon">${icon('skull')}</div>
    <h2>${notInstalled ? 'Death Tracker data not found' : state.folderExists ? 'No levels tracked yet' : 'Folder not found'}</h2>
    <p>${notInstalled
      ? 'GD Tracker reads the save files of the <b>Death Tracker</b> Geode mod. Install it from the Geode mod index, play a level, and it will show up here.'
      : state.folderExists
        ? 'Play a level with the Death Tracker mod enabled and it will show up here automatically.'
        : `GD Tracker looked in <code>${esc(state.folder)}</code>.`}</p>
    ${state.loadError ? `<p class="err">${esc(state.loadError)}</p>` : ''}
    <div class="row-btns"><button class="btn primary" data-a="pick">${icon('folder')}Choose folder…</button><button class="btn" data-a="retry">${icon('refresh')}Retry</button></div>
  </div>`);
  el.querySelector('[data-a=pick]').onclick = async () => {
    const p = await call('dt.pickFolder');
    if (p) { setSettings({ dataPath: p }); (await import('../store.js')).loadAll(); }
  };
  el.querySelector('[data-a=retry]').onclick = async () => (await import('../store.js')).loadAll();
  return el;
}
