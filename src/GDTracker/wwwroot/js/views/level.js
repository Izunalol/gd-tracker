// Level page: banner, headline numbers, and tabs for the death chart, sessions, practice runs and per-percent table.
import { state, settings, setSettings, custom, setCustom, displayName, levelInfo, pctLabel, isPlatformer, isCompleted, tagColor, fetchHdThumb, on } from '../store.js';
import { TYPES, LENGTHS, percentTable, hardestParts, runGroups } from '../data.js';
import { thumbInner } from '../thumbs.js';
import { columnChart, lineChart, meter } from '../charts.js';
import { icon } from '../icons.js';
import { h, showMenu, segmented, ratingControl, toast } from '../ui.js';
import { openFinder } from './finder.js';
import { levelVideos, videoGrid, openAddVideo } from './videos.js';
import { esc, num, compact, duration, when, absDate, dateTime, shortDate, clockTime, pct, plural, debounce } from '../util.js';
import { diffChip, rankChip, rankText, doneTick } from './gallery.js';
import { openLinkEditor } from './links.js';
import { call } from '../rpc.js';
import { openCustomize, levelMenuItems } from './customize.js';

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'chart' },
  { id: 'sessions', label: 'Sessions', icon: 'calendar' },
  { id: 'practice', label: 'Practice', icon: 'flag' },
  { id: 'percent', label: 'Percentages', icon: 'target' },
  { id: 'notes', label: 'About & notes', icon: 'doc' },
];

let root = null, key = null, tab = 'overview', scope = 'all', unsub = [];
const sessionSort = { col: 'start', dir: -1 };
const practiceSort = { col: 'start', dir: 1 };
const expanded = new Set();

export function mountLevel(el, levelKey, initialTab) {
  root = el;
  if (key !== levelKey) { scope = 'all'; expanded.clear(); }
  key = levelKey;
  tab = TABS.some((t) => t.id === initialTab) ? initialTab : 'overview';
  render();
  const rerender = debounce(() => render(true), 80);
  unsub = [
    on('data', (d) => { if (!d?.keys || d.keys.includes(key)) rerender(); }),
    on('info', rerender),
    on('prefs', rerender),
    on('custom', (k) => { if (k === key) rerender(); }),
  ];
  const level = state.levels.get(key);
  if (level?.onlineId > 0 && settings().autoThumbs && !custom(key).thumb) {
    fetchHdThumb(level.onlineId).then((u) => { if (u && root) root.querySelectorAll('.thumb.hd').forEach((t) => (t.innerHTML = thumbInner(level, { hd: true }))); });
  }
}

export function unmountLevel() {
  unsub.forEach((u) => u());
  unsub = [];
  root = null;
}

// A link may have folded this level into another one since the URL was made; follow it.
const lvl = () => {
  if (!state.levels.has(key) && state.memberOf.has(key)) key = state.memberOf.get(key);
  return state.levels.get(key);
};

/** Data for the current scope: all-time or one session. */
function scoped(level) {
  if (scope === 'all') return { data: level.all, sum: level.sum, label: 'All time', session: null };
  const s = level.sessions.find((x) => String(x.start) === String(scope));
  if (!s) { scope = 'all'; return scoped(level); }
  return { data: s.data, sum: s.sum, label: sessionLabel(s), session: s };
}

const sessionLabel = (s) => `${shortDate(s.start)}, ${clockTime(s.start)} · ${duration(s.playtime)}`;

function render(keep = false) {
  if (!root) return;
  const scroller = root.parentElement;
  const top = scroller.scrollTop;
  const level = lvl();
  root.innerHTML = '';
  root.className = 'page level-page';
  if (!level) {
    root.append(h(`<div class="empty"><div class="empty-icon">${icon('search')}</div><h2>Level not found</h2><p>It may have been removed from the Death Tracker folder.</p><a class="btn" href="#/">Back to levels</a></div>`));
    return;
  }
  const c = custom(key);
  root.style.setProperty('--lvl', c.color || 'var(--accent)');
  // A level added from search with nothing recorded yet: a row of zeros says nothing.
  const hasData = level.sessions.length || level.all.deaths.size || level.all.runs.length || level.adjust;
  root.append(hero(level), ...(hasData ? [tiles(level)] : []), tabsBar());
  const body = h('<div class="tab-body"></div>');
  root.append(body);
  ({ overview, sessions, practice, percent, notes })[tab](body, level);
  if (keep) scroller.scrollTop = top;
}

// ---------------------------------------------------------------- banner

function hero(level) {
  const c = custom(level.key);
  const info = levelInfo(level);
  const meta = [];
  // Each piece is its own span: inside the flex row, a bare "by " would lose its trailing space.
  if (info?.creator) meta.push(`by <b>${esc(info.creator)}</b>`);
  if (level.type !== 'online') meta.push(esc(TYPES[level.type]));
  if (level.id != null && level.type !== 'editor') meta.push(`ID ${level.id}`);
  if (level.lengthCat != null) meta.push(`${esc(LENGTHS[level.lengthCat])}${level.lengthManual ? ' <small title="Set by you">✎</small>' : ''}`);
  if (level.isGroup) meta.push(`<button class="linkish" data-a="links">${icon('link')}${level.members.length} linked copies</button>`);
  if (info && !info.missing) {
    if (info.song) meta.push(`${icon('play')}${esc(info.song)}${info.songArtist ? ` – ${esc(info.songArtist)}` : ''}`);
  }
  if (displayName(level) !== level.rawName) meta.push(`<span class="muted">originally “${esc(level.rawName)}”</span>`);
  const tags = (c.tags || []).map((t) => `<span class="tag"><i style="background:${tagColor(t)}"></i>${esc(t)}</span>`).join('');
  const completionVideo = levelVideos(level.key).find((v) => v.kind === 'completion');
  const el = h(`<div class="hero ${settings().levelHeroBlur ? 'blur' : ''}">
    <div class="hero-bg thumb hd" data-thumb-key="${esc(level.key)}">${thumbInner(level, { hd: true })}</div>
    <div class="hero-shade"></div>
    <div class="hero-inner">
      <div class="hero-top">
        <a class="btn ghost on-image" href="#/">${icon('chevronLeft')}Levels</a>
        <span class="sp"></span>
        ${completionVideo ? `<button class="btn ghost on-image watch" data-a="watch" title="${esc(completionVideo.title || completionVideo.url)}">${icon('play')}My completion</button>` : ''}
        <button class="btn ghost on-image icon-only ${c.fav ? 'fav-on' : ''}" data-a="fav" title="Favourite">${icon(c.fav ? 'starFill' : 'star')}</button>
        <button class="btn ghost on-image" data-a="customize">${icon('palette')}Customise</button>
        <button class="btn ghost on-image icon-only" data-a="more" title="More">${icon('ellipsis')}</button>
      </div>
      <div class="hero-main">
        <button class="hero-thumb thumb hd" data-thumb-key="${esc(level.key)}" data-a="thumb" title="Change thumbnail">${thumbInner(level, { hd: true })}</button>
        <div class="hero-text">
          <div class="hero-kicker">${diffChip(level)}${level.list ? `<button class="rank-btn" data-a="rank" title="List placement — click to correct">${rankChip(level)}</button>` : ''}${isCompleted(level) ? `<span class="chip done glow">${icon('check')}Completed${level.sum.completions > 1 ? ` ${level.sum.completions}×` : ''}</span>` : ''}${level.error ? `<span class="chip warn" title="${esc(level.error)}">Partially unreadable</span>` : ''}</div>
          <h1>${esc(displayName(level))}</h1>
          <div class="hero-meta">${meta.map((m) => `<span>${m}</span>`).join('<span class="dot">·</span>')}</div>
          <div class="hero-rate"><span class="enjoy-slot"></span><span class="enjoy-lbl">Enjoyment</span></div>
          ${tags ? `<div class="hero-tags">${tags}</div>` : ''}
        </div>
      </div>
    </div>
  </div>`);
  el.querySelector('.enjoy-slot').append(ratingControl(c.enjoy || 0, (v) => setCustom(level.key, { enjoy: v || null }), { size: 'lg' }));
  el.querySelector('[data-a=links]')?.addEventListener('click', () => openLinkEditor(level));
  el.querySelector('[data-a=fav]').onclick = () => setCustom(level.key, { fav: !c.fav });
  el.querySelector('[data-a=customize]').onclick = () => openCustomize(level);
  el.querySelector('[data-a=thumb]').onclick = () => openCustomize(level, { focus: 'thumb' });
  el.querySelector('[data-a=more]').onclick = (e) => showMenu([
    { label: 'Add a video…', icon: 'play', action: () => openAddVideo(level) },
    ...levelMenuItems(level),
  ], e.currentTarget, { align: 'end' });
  el.querySelector('[data-a=watch]')?.addEventListener('click', () => call('app.openUrl', { url: completionVideo.url }));
  el.querySelector('[data-a=rank]')?.addEventListener('click', (e) => rankMenu(level, e.currentTarget));
  return el;
}

/** The list placement can be wrong (a same-named level); let the user say so or pick the right one. */
function rankMenu(level, anchor) {
  const r = level.list;
  const c = custom(level.key);
  const pos = r.source === 'aredl' ? r.aredlPosition : r.position;
  const site = r.source === 'pointercrate' ? `https://pointercrate.com/demonlist/${r.position}/` : r.entry?.levelId ? `https://aredl.net/list/${r.entry.levelId}` : null;
  showMenu([
    { header: r.source === 'manual' ? `Your placement #${pos}` : `${rankText(r)}${r.entry?.name ? ` · ${r.entry.name}` : ''}${r.by === 'name' ? ' (matched by name)' : r.by === 'chosen' ? ' (chosen by you)' : ''}` },
    ...(r.source !== 'manual' ? [
      { label: 'Not this level', icon: 'xmark', action: () => { setCustom(level.key, { noList: true, listId: null }); toast('List placement removed for this level'); } },
      { label: 'Pick the right list level…', icon: 'search', action: () => openFinder({ query: level.rawName, pick: (entry) => { setCustom(level.key, { listId: +entry.levelId, noList: false }); toast(`Matched to ${entry.name}`); } }) },
    ] : [{ label: 'Remove my placement', icon: 'xmark', action: () => setCustom(level.key, { listPos: null }) }]),
    ...(c.listId ? [{ label: 'Use automatic match', icon: 'undo', action: () => setCustom(level.key, { listId: null }) }] : []),
    ...(site ? ['-', { label: `Open on ${r.source === 'pointercrate' ? 'Pointercrate' : 'AREDL'}`, icon: 'globe', action: () => call('app.openUrl', { url: site }) }] : []),
  ], anchor);
}

function tiles(level) {
  const s = level.sum;
  const best = s.best ?? 0;
  const lastSession = level.sessions[0];
  const longest = s.longest;
  const t = (label, value, sub = '', extra = '') => `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}${extra}</div>`;
  return h(`<div class="tiles">
    ${t('Attempts', num(level.attempts), (level.isGroup ? `across ${level.members.length} copies` : level.gdAttempts ? 'GD attempt counter' : 'tracked attempts') + (level.adjust ? ' · <span title="Includes numbers you added in Customise → Adjust stats">+ manual</span>' : ''))}
    ${level.playtime > 0 || !level.attempts
      ? t('Playtime', duration(level.playtime), `${duration(level.playtimeF0)} from 0 · ${duration(level.playtimeRuns)} practice`)
      : t('Playtime', '–', 'not recorded (older Death Tracker data)')}
    ${t('Best from 0', esc(pctLabel(level, s.best)), s.completions ? plural(s.completions, 'completion') : 'not completed yet', meter(best / 100, s.completions ? 'done' : ''))}
    ${t('From-0 attempts', num(s.from0), s.from0 && level.playtimeF0 ? `≈ ${duration(level.playtimeF0 / s.from0)} each` : '')}
    ${t('Practice runs', num(s.runs), longest ? `longest ${esc(pctLabel(level, longest.s))} → ${esc(pctLabel(level, longest.e))}` : '')}
    ${t('Sessions', num(level.sessions.length), lastSession ? `last ${esc(when(lastSession.last))}` : '', `<div class="tile-sub">since ${esc(absDate(level.firstPlayed))}</div>`)}
  </div>`);
}

function tabsBar() {
  const level = lvl();
  const el = h(`<div class="tabs-bar"></div>`);
  const counts = { sessions: level.sessions.length, practice: runGroups(level.all.runs).length };
  el.append(segmented(TABS.map((t) => ({ ...t, count: counts[t.id] })), tab, (id) => {
    tab = id;
    history.replaceState(null, '', `#/level/${encodeURIComponent(key)}/${id}`);
    render(true);
  }, 'tabs'));
  if (['overview', 'practice', 'percent'].includes(tab) && level.sessions.length) {
    const sel = h(`<label class="scope">${icon('calendar')}<select>
      <option value="all">All time</option>
      ${level.sessions.map((s) => `<option value="${s.start}" ${String(scope) === String(s.start) ? 'selected' : ''}>${esc(sessionLabel(s))}${s.newRecord ? ' ★' : ''}</option>`).join('')}
    </select></label>`);
    sel.querySelector('select').value = String(scope);
    sel.querySelector('select').onchange = (e) => { scope = e.target.value; render(true); };
    el.append(h('<span class="sp"></span>'), sel);
  }
  return el;
}

function videosCard(level) {
  const n = levelVideos(level.key).length;
  const panel = card(`Videos${n ? ` <small>${n}</small>` : ''}`, n ? '' : '<p class="muted">Link your completion or a showcase from YouTube.</p>',
    `<button class="btn sm" data-a="addVideo">${icon('plus')}Add video</button>`, 'wide');
  if (n) panel.querySelector('.panel-body').append(videoGrid(level));
  panel.querySelector('[data-a=addVideo]').onclick = () => openAddVideo(level);
  return panel;
}

const card = (title, body = '', actions = '', cls = '') => h(`<div class="card-panel ${cls}"><div class="panel-head"><h3>${title}</h3><span class="sp"></span>${actions}</div><div class="panel-body">${body}</div></div>`);

// ---------------------------------------------------------------- overview

function overview(body, level) {
  const sc = scoped(level);
  const s = settings();
  const metric = s.chartMetric || 'deaths';
  const platformer = isPlatformer(level);

  if (levelVideos(level.key).length) body.append(videosCard(level));
  // A level added from search: nothing from Death Tracker to chart yet.
  if (!level.sessions.length && !level.all.deaths.size && !level.all.runs.length) {
    body.append(card('No Death Tracker data yet', `<p class="muted">${isCompleted(level) ? 'Marked as completed. ' : ''}Play this level with the Death Tracker mod and its deaths, sessions and runs will appear here.${level.adjust ? ' The numbers above include stats you added by hand.' : ''}</p>
      <div class="row-btns"><button class="btn" data-a="video">${icon('play')}Add a video</button><button class="btn" data-a="cust">${icon('palette')}Rate, mark completed or adjust stats</button></div>`, '', 'wide'));
    body.querySelector('[data-a=video]').onclick = () => openAddVideo(level);
    body.querySelector('[data-a=cust]').onclick = () => openCustomize(level);
    return;
  }

  const chartCard = card(`Deaths by ${platformer ? 'checkpoint' : 'percent'} <small>${esc(sc.label)} · from 0</small>`, '<div class="chart-slot"></div>', '', 'wide');
  const seg = segmented([
    { id: 'deaths', label: 'Deaths' },
    { id: 'rate', label: 'Death rate' },
    { id: 'reach', label: 'Reached' },
  ], metric, (id) => setSettings({ chartMetric: id }), 'small');
  chartCard.querySelector('.panel-head').append(seg);
  body.append(chartCard);
  drawDeathChart(chartCard.querySelector('.chart-slot'), level, sc.data, metric);

  const row = h('<div class="panel-row"></div>');
  body.append(row);

  // Hardest parts
  const hard = hardestParts(sc.data.deaths, 6);
  row.append(card('Hardest parts', hard.length ? `<div class="rank">${hard.map((r) => `
      <div class="rank-row" title="${num(r.deaths)} deaths out of ${num(r.reached)} runs that reached it">
        <span class="rank-k">${esc(pctLabel(level, r.p))}</span>
        <span class="rank-bar">${meter(1 - r.passRate, 'hot')}</span>
        <span class="rank-v">${pct(1 - r.passRate)} <small>die here</small></span>
      </div>`).join('')}</div>
      <p class="hint">Percents where the largest share of runs that got there died.</p>`
    : '<p class="muted">Not enough from-0 attempts yet.</p>'));

  // Progress over sessions
  const prog = card('Best per session', '<div class="chart-slot"></div>');
  row.append(prog);
  const chron = [...level.sessions].reverse().filter((x) => x.sum.from0 > 0);
  if (chron.length >= 2) {
    lineChart(prog.querySelector('.chart-slot'), {
      height: 200,
      yMin: 0, yMax: 100, yTicks: [0, 25, 50, 75, 100],
      yFmt: (v) => `${v}%`,
      xFmt: (x) => shortDate(chron[x].start),
      points: chron.map((x, i) => ({
        x: i, y: x.sum.best ?? 0, hl: x.newRecord, cls: x.sum.completions ? 'win' : '',
        tip: `<div class="tt-title">${esc(dateTime(x.start))}</div>${x.sum.completions ? `<span class="tt-win">${icon('check')}Completed${x.sum.completions > 1 ? ` ${x.sum.completions}×` : ''}</span><br>` : ''}Best <b>${esc(pctLabel(level, x.sum.best))}</b>${x.newRecord && !x.sum.completions ? ' · new record' : ''}<br>${num(x.sum.from0)} from-0 attempts · ${duration(x.playtime)}`,
      })),
      onClick: (p) => { scope = String(chron[p.x].start); tab = 'overview'; render(true); },
    });
  } else prog.querySelector('.panel-body').innerHTML = '<p class="muted">Play a couple of sessions from 0 to see your progress here.</p>';

  // Playtime breakdown
  const pt = sc.data.pt;
  const segs = [
    { label: 'From 0', v: pt.gen.f0, c: 'var(--lvl)' },
    { label: 'Practice', v: pt.gen.runs, c: 'var(--series-2)' },
    { label: 'Respawning', v: pt.dead.f0 + pt.dead.runs, c: 'var(--series-3)' },
    { label: 'Paused', v: pt.paused.f0 + pt.paused.runs, c: 'var(--series-4)' },
  ];
  const tot = segs.reduce((a, x) => a + x.v, 0) || 1;
  body.append(card(`Where the time went <small>${esc(sc.label)}</small>`, `
    <div class="stack">${segs.filter((x) => x.v > 0).map((x) => `<i style="flex:${x.v};background:${x.c}" title="${x.label}: ${duration(x.v)}"></i>`).join('')}</div>
    <div class="legend">${segs.map((x) => `<span><i style="background:${x.c}"></i>${x.label} <b>${duration(x.v)}</b> <small>${pct(x.v / tot)}</small></span>`).join('')}</div>
    <p class="hint">Playtime elsewhere in the app ${s.playtimeDead ? 'includes' : 'excludes'} respawn time and ${s.playtimePaused ? 'includes' : 'excludes'} paused time (change in Settings).</p>`, '', 'wide'));

  // Linked copies
  if (level.isGroup) {
    const panel = card('Linked copies <small>stats above combine all of them</small>', `<div class="links">${level.members.map((m) => `<div class="link-chip">${esc(m.rawName)}${m.key === level.key ? ' <span class="chip sm">main</span>' : ''}<small>${esc(TYPES[m.type])} · ${num(m.attempts)} att · ${duration(m.playtime)} · best ${esc(pctLabel(level, m.sum.best))}</small></div>`).join('')}</div>`, `<button class="btn sm" data-a="links">${icon('link')}Manage</button>`, 'wide');
    panel.querySelector('[data-a=links]').onclick = () => openLinkEditor(level);
    body.append(panel);
  }
}

function drawDeathChart(el, level, data, metric) {
  const { rows, total } = percentTable(data.deaths);
  if (!total) { el.innerHTML = '<p class="muted pad">No from-0 attempts recorded in this range.</p>'; return; }
  const hideZero = settings().hideZeroPercent;
  const maxP = Math.max(100, ...rows.map((r) => r.p));
  const pl = (p) => pctLabel(level, p);
  if (metric === 'reach') {
    // Share of from-0 attempts that got at least this far.
    const pts = [];
    let i = 0;
    for (let p = 0; p <= maxP; p++) {
      while (i < rows.length && rows[i].p < p) i++;
      const reached = rows.slice(i).reduce((a, r) => a + r.deaths, 0);
      pts.push({ x: p, y: (reached / total) * 100, tip: `<div class="tt-title">${esc(pl(p))}</div>Reached by <b>${pct(reached / total, 1)}</b> of attempts (${num(reached)})` });
    }
    lineChart(el, { points: pts, height: 260, yMin: 0, yMax: 100, yTicks: [0, 25, 50, 75, 100], yFmt: (v) => `${v}%`, xFmt: (x) => pl(x), xTicks: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], step: true, dots: false });
    return;
  }
  const list = rows.filter((r) => !(hideZero && r.p === 0));
  const tip = (r) => `<div class="tt-title">${esc(pl(r.p))}${r.completion ? ' · completion' : ''}</div>
    <b>${num(r.deaths)}</b> ${r.completion ? 'completions' : 'deaths'} (${pct(r.share, 1)} of attempts)<br>
    Reached ${num(r.reached)}× · ${r.completion ? '' : `${pct(1 - r.passRate, 1)} died here`}`;
  columnChart(el, {
    height: 260,
    xMin: 0, xMax: maxP,
    data: list.map((r) => ({ x: r.p, y: metric === 'rate' ? (r.completion ? 0 : (1 - r.passRate) * 100) : r.deaths, tip: tip(r), completion: r.completion })),
    yFmt: metric === 'rate' ? (v) => `${v}%` : (v) => compact(v),
    xTickFmt: (x) => pl(x),
    highlight: (d) => d.completion,
    yMax: metric === 'rate' ? 100 : undefined,
  });
}

// ---------------------------------------------------------------- sessions

function sessions(body, level) {
  if (!level.sessions.length) { body.append(card('Sessions', '<p class="muted">No sessions recorded.</p>')); return; }
  const cols = [
    { id: 'start', label: 'Session', get: (s) => s.start },
    { id: 'playtime', label: 'Played', get: (s) => s.playtime, num: true },
    { id: 'attempts', label: 'Attempts', get: (s) => s.sum.attempts, num: true },
    { id: 'from0', label: 'From 0', get: (s) => s.sum.from0, num: true },
    { id: 'runs', label: 'Practice', get: (s) => s.sum.runs, num: true },
    { id: 'best', label: 'Best', get: (s) => s.sum.best ?? -1, num: true },
    { id: 'longest', label: 'Longest run', get: (s) => (s.sum.longest ? s.sum.longest.e - s.sum.longest.s : -1), num: true },
  ];
  const sorted = [...level.sessions].sort((a, b) => {
    const col = cols.find((c) => c.id === sessionSort.col);
    return (col.get(a) - col.get(b)) * sessionSort.dir;
  });
  const totals = level.sessions.reduce((a, s) => ({ pt: a.pt + s.playtime, att: a.att + s.sum.attempts }), { pt: 0, att: 0 });
  const panel = card(`Sessions <small>${plural(level.sessions.length, 'session')} · avg ${duration(totals.pt / level.sessions.length)} · ${num(totals.att / level.sessions.length)} attempts each</small>`, '', '', 'wide flush');
  const tbl = h(`<table class="tbl sessions">
    <thead><tr><th class="exp"></th>${cols.map((c) => `<th class="${c.num ? 'num' : ''} ${sessionSort.col === c.id ? 'sorted' : ''}" data-sort="${c.id}">${c.label}${sessionSort.col === c.id ? icon(sessionSort.dir > 0 ? 'chevronUp' : 'chevronDown') : ''}</th>`).join('')}<th></th></tr></thead>
    <tbody></tbody></table>`);
  const tb = tbl.querySelector('tbody');
  for (const s of sorted) {
    const open = expanded.has('s' + s.start);
    const win = s.sum.completions > 0;
    const copy = level.isGroup ? level.members.find((m) => m.key === s.member) : null;
    const tr = h(`<table><tr class="srow ${open ? 'open' : ''} ${win ? 'win' : ''}" data-s="${s.start}">
      <td class="exp">${icon(open ? 'chevronDown' : 'chevronRight')}</td>
      <td><div class="s-date">${esc(dateTime(s.start))}${win ? `<span class="chip done glow sm-chip">${icon('check')}Completed${s.sum.completions > 1 ? ` ${s.sum.completions}×` : ''}</span>` : s.newRecord ? `<span class="chip rec" title="New all-time best this session">${icon('trophy')}New best</span>` : ''}</div>
        <div class="s-sub">${s.last - s.start > 60 ? `${esc(clockTime(s.start))} – ${esc(clockTime(s.last))}` : ''}${copy ? `<span class="copy-tag" title="Played on this copy">${esc(copy.rawName)}</span>` : ''}</div></td>
      <td class="num">${duration(s.playtime)}</td>
      <td class="num">${num(s.sum.attempts)}</td>
      <td class="num">${num(s.sum.from0)}</td>
      <td class="num">${num(s.sum.runs)}</td>
      <td class="num">${s.sum.best != null ? esc(pctLabel(level, s.sum.best)) : '–'}</td>
      <td class="num">${s.sum.longest ? `${esc(pctLabel(level, s.sum.longest.s))}→${esc(pctLabel(level, s.sum.longest.e))}` : '–'}</td>
      <td class="act"><button class="btn ghost sm" data-view="${s.start}" title="Show this session in the charts">${icon('chart')}</button></td>
    </tr></table>`).querySelector('tr');
    tb.append(tr);
    if (open) {
      const det = h(`<table><tr class="sdetail"><td colspan="${cols.length + 2}"><div class="sd">
        <div class="sd-chart"><div class="sd-title">Deaths from 0</div><div class="chart-slot"></div></div>
        <div class="sd-runs"><div class="sd-title">Top practice runs</div>${runList(level, s.data.runs, 8)}</div>
      </div></td></tr></table>`).querySelector('tr');
      tb.append(det);
      requestAnimationFrame(() => {
        const slot = det.querySelector('.chart-slot');
        const { rows, total } = percentTable(s.data.deaths);
        if (!total) { slot.innerHTML = '<p class="muted">No from-0 attempts this session.</p>'; return; }
        columnChart(slot, {
          height: 150, xMin: 0, xMax: Math.max(100, ...rows.map((r) => r.p)),
          data: rows.map((r) => ({ x: r.p, y: r.deaths, completion: r.completion, tip: `<div class="tt-title">${esc(pctLabel(level, r.p))}</div><b>${num(r.deaths)}</b> ${r.completion ? 'completions' : 'deaths'}` })),
          yFmt: compact, xTickFmt: (x) => pctLabel(level, x), highlight: (d) => d.completion,
        });
      });
    }
  }
  tbl.querySelectorAll('th[data-sort]').forEach((th) => (th.onclick = () => {
    const id = th.dataset.sort;
    sessionSort.dir = sessionSort.col === id ? -sessionSort.dir : (id === 'start' ? -1 : -1);
    sessionSort.col = id;
    render(true);
  }));
  tb.addEventListener('click', (e) => {
    const v = e.target.closest('[data-view]');
    if (v) { scope = v.dataset.view; tab = 'overview'; history.replaceState(null, '', `#/level/${encodeURIComponent(key)}/overview`); render(); return; }
    const tr = e.target.closest('tr.srow');
    if (!tr) return;
    const k = 's' + tr.dataset.s;
    expanded.has(k) ? expanded.delete(k) : expanded.add(k);
    render(true);
  });
  panel.querySelector('.panel-body').append(h('<div class="table-wrap"></div>'));
  panel.querySelector('.table-wrap').append(tbl);
  body.append(panel);
}

function runList(level, runs, n) {
  if (!runs.length) return '<p class="muted">None.</p>';
  const top = [...runs].sort((a, b) => (b.e - b.s) - (a.e - a.s) || b.e - a.e).slice(0, n);
  return `<div class="runs">${top.map((r) => `<div class="run ${r.e >= 100 ? 'win' : ''}" title="${num(r.n)}×">
    <span class="run-k">${esc(pctLabel(level, r.s))} → ${esc(pctLabel(level, r.e))}${r.e >= 100 ? doneTick('Ran to the end', 'xs') : ''}</span>
    <span class="run-bar"><i style="left:${r.s}%;width:${Math.max(1, r.e - r.s)}%"></i></span>
    <span class="run-n">×${num(r.n)}</span></div>`).join('')}</div>`;
}

// ---------------------------------------------------------------- practice

function practice(body, level) {
  const sc = scoped(level);
  const groups = runGroups(sc.data.runs);
  if (!groups.length) { body.append(card('Practice & start-pos runs', `<p class="muted">No practice runs ${scope === 'all' ? 'recorded' : 'in this session'}.</p>`)); return; }
  const cols = [
    { id: 'start', label: 'Start', get: (g) => g.start },
    { id: 'count', label: 'Runs', get: (g) => g.count, num: true },
    { id: 'bestEnd', label: 'Best end', get: (g) => g.bestEnd, num: true },
    { id: 'avgEnd', label: 'Average end', get: (g) => g.avgEnd, num: true },
    { id: 'completions', label: 'To the end', get: (g) => g.completions, num: true },
  ];
  groups.sort((a, b) => {
    const col = cols.find((c) => c.id === practiceSort.col);
    return (col.get(a) - col.get(b)) * practiceSort.dir;
  });
  const panel = card(`Runs by start position <small>${esc(sc.label)} · ${plural(sc.sum.runs, 'run')}</small>`, '', '', 'wide flush');
  const tbl = h(`<table class="tbl practice">
    <thead><tr><th class="exp"></th>${cols.map((c) => `<th class="${c.num ? 'num' : ''} ${practiceSort.col === c.id ? 'sorted' : ''}" data-sort="${c.id}">${c.label}${practiceSort.col === c.id ? icon(practiceSort.dir > 0 ? 'chevronUp' : 'chevronDown') : ''}</th>`).join('')}<th class="range-col">Range</th></tr></thead>
    <tbody></tbody></table>`);
  const tb = tbl.querySelector('tbody');
  for (const g of groups) {
    const open = expanded.has('p' + g.start);
    tb.append(h(`<table><tr class="prow ${open ? 'open' : ''} ${g.completions ? 'win' : ''}" data-p="${g.start}">
      <td class="exp">${icon(open ? 'chevronDown' : 'chevronRight')}</td>
      <td><b>${esc(pctLabel(level, g.start))}</b></td>
      <td class="num">${num(g.count)}</td>
      <td class="num">${esc(pctLabel(level, g.bestEnd))}</td>
      <td class="num">${g.avgEnd.toFixed(1)}${isPlatformer(level) ? '' : '%'}</td>
      <td class="num">${g.completions ? `${num(g.completions)}${doneTick('Ran to the end from here', 'sm')}` : '–'}</td>
      <td class="range-col"><span class="run-bar"><i class="avg" style="left:${g.start}%;width:${Math.max(0.5, g.avgEnd - g.start)}%"></i><i style="left:${g.start}%;width:${Math.max(0.5, g.bestEnd - g.start)}%"></i></span></td>
    </tr></table>`).querySelector('tr'));
    if (open) {
      const det = h(`<table><tr class="sdetail"><td colspan="${cols.length + 2}"><div class="sd single"><div class="sd-title">Where runs from ${esc(pctLabel(level, g.start))} ended</div><div class="chart-slot"></div></div></td></tr></table>`).querySelector('tr');
      tb.append(det);
      requestAnimationFrame(() => {
        const ends = new Map();
        for (const r of g.runs) ends.set(r.e, (ends.get(r.e) || 0) + r.n);
        columnChart(det.querySelector('.chart-slot'), {
          height: 150, xMin: g.start, xMax: Math.max(g.bestEnd, Math.min(100, g.start + 10)),
          data: [...ends].map(([e, n]) => ({ x: e, y: n, completion: e >= 100, tip: `<div class="tt-title">${esc(pctLabel(level, g.start))} → ${esc(pctLabel(level, e))}</div><b>${num(n)}</b> runs (${pct(n / g.count, 1)})` })),
          yFmt: compact, xTickFmt: (x) => pctLabel(level, x), highlight: (d) => d.completion,
        });
      });
    }
  }
  tbl.querySelectorAll('th[data-sort]').forEach((th) => (th.onclick = () => {
    const id = th.dataset.sort;
    practiceSort.dir = practiceSort.col === id ? -practiceSort.dir : (id === 'start' ? 1 : -1);
    practiceSort.col = id;
    render(true);
  }));
  tb.addEventListener('click', (e) => {
    const tr = e.target.closest('tr.prow');
    if (!tr) return;
    const k = 'p' + tr.dataset.p;
    expanded.has(k) ? expanded.delete(k) : expanded.add(k);
    render(true);
  });
  panel.querySelector('.panel-body').append(h('<div class="table-wrap"></div>'));
  panel.querySelector('.table-wrap').append(tbl);
  body.append(panel);
  body.append(card('Longest runs', runList(level, sc.data.runs, 12), '', 'wide'));
}

// ---------------------------------------------------------------- per-percent table

function percent(body, level) {
  const sc = scoped(level);
  const { rows, total } = percentTable(sc.data.deaths);
  if (!total) { body.append(card('Percentages', '<p class="muted">No from-0 attempts in this range.</p>')); return; }
  const maxDeaths = Math.max(...rows.map((r) => r.deaths));
  const panel = card(`Every percent you died at <small>${esc(sc.label)} · ${plural(total, 'attempt')} from 0</small>`, '', '', 'wide flush');
  panel.querySelector('.panel-body').append(h(`<div class="table-wrap"><table class="tbl pcts">
    <thead><tr><th>${isPlatformer(level) ? 'Checkpoint' : 'Percent'}</th><th class="num">Deaths</th><th class="bar-col"></th><th class="num">Reached</th><th class="num">Reach rate</th><th class="num">Died here</th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="${r.completion ? 'completion' : ''}">
      <td><b>${esc(pctLabel(level, r.p))}</b>${r.completion ? ` <span class="chip done sm">${icon('check')}complete</span>` : ''}</td>
      <td class="num">${num(r.deaths)}</td>
      <td class="bar-col">${meter(r.deaths / maxDeaths, r.completion ? 'done' : '')}</td>
      <td class="num">${num(r.reached)}</td>
      <td class="num">${pct(r.reachRate, 1)}</td>
      <td class="num">${r.completion ? '–' : pct(1 - r.passRate, 1)}</td>
    </tr>`).join('')}</tbody></table></div>`));
  body.append(panel);
}

// ---------------------------------------------------------------- notes

function notes(body, level) {
  const info = levelInfo(level);
  const panel = card('Your notes', `<textarea class="field notes big" placeholder="Strategies, goals, which start positions to grind…" spellcheck="true">${esc(custom(level.key).notes || '')}</textarea><p class="hint">Saved automatically.</p>`, '', 'wide');
  const ta = panel.querySelector('textarea');
  ta.addEventListener('input', debounce(() => setCustom(level.key, { notes: ta.value }), 300));
  body.append(panel);
  body.append(videosCard(level));
  const r = level.list;
  const pc = r?.source === 'pointercrate' ? r.entry : null;
  const ar = r?.aredl || (r?.source === 'aredl' ? r.entry : null);
  if (r) {
    const facts = [
      ['Placement', rankText(r) + (r.by === 'name' ? ' — matched by name' : '')],
      pc ? ['Demonlist', `${pc.position <= 75 ? 'Main list' : 'Extended list'} · list% ${pc.requirement ?? '–'}%`] : null,
      pc?.verifier ? ['Verifier', pc.verifier] : null,
      pc?.publisher ? ['Publisher', pc.publisher] : null,
      ar ? ['AREDL', `#${ar.position}${ar.points ? ` · ${num(ar.points)} points` : ''}${ar.legacy ? ' · legacy' : ''}`] : null,
      +ar?.enjoyment > 0 ? ['Community enjoyment', `${(+ar.enjoyment).toFixed(1)} / 100 (EDEL)`] : null,
      ar?.gddlTier != null ? ['GDDL tier', `Tier ${(+ar.gddlTier).toFixed(1).replace(/\.0$/, '')}`] : null,
      ar?.tags?.length ? ['Tags', ar.tags.join(', ')] : null,
    ].filter(Boolean);
    const video = pc?.video;
    const listCard = card('On the lists', `<dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${r.source === 'manual' ? '<p class="hint">This is your own placement (set in Customise).</p>' : ''}`,
      video ? `<button class="btn sm" data-a="video">${icon('play')}Verification</button>` : '', 'wide');
    listCard.querySelector('[data-a=video]')?.addEventListener('click', () => call('app.openUrl', { url: video }));
    body.append(listCard);
  }
  if (info && !info.missing) {
    const facts = [
      ['Creator', info.creator], ['Stars', info.stars || '–'], ['Length', LENGTHS[level.lengthCat ?? info.length]],
      ['Song', info.song ? `${info.song}${info.songArtist ? ` – ${info.songArtist}` : ''}` : null],
      ['Downloads', num(info.downloads)], ['Likes', num(info.likes)], ['Objects', info.objects ? num(info.objects) : null],
      ['Coins', info.coins ? `${info.coins}${info.verifiedCoins ? ' (verified)' : ''}` : null],
      ['Rating', info.epic === 3 ? 'Mythic' : info.epic === 2 ? 'Legendary' : info.epic === 1 ? 'Epic' : info.featured > 0 ? 'Featured' : info.stars ? 'Rated' : 'Unrated'],
    ].filter(([, v]) => v != null && v !== '');
    body.append(card('About this level', `
      ${info.description ? `<p class="desc">${esc(info.description)}</p>` : ''}
      <dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <p class="hint">From the Geometry Dash servers, fetched ${esc(when(info.fetched))}.</p>`, '', 'wide'));
  }
}
