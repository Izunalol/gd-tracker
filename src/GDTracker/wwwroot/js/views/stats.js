// Statistics: your career (all-time completions, hardest beaten, ratings) and activity over a date range
// (playtime per day, a year calendar, most played levels and the latest sessions).
import { state, settings, custom, displayName, pctLabel, isCompleted, hardness, levelDifficulty, diffIconUrl, on } from '../store.js';
import { diffInfo, DIFF_ORDER } from '../data.js';
import { columnChart, calendarHeatmap, meter } from '../charts.js';
import { thumbBox } from '../thumbs.js';
import { icon } from '../icons.js';
import { h, segmented, starsHtml } from '../ui.js';
import { doneTick, rankChip, diffChip } from './gallery.js';
import { esc, num, compact, duration, dayStart, dayLabel, dateTime, shortDate, plural, debounce, absDate } from '../util.js';

const RANGES = [
  { id: '7', label: '7 days', days: 7 },
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
  { id: '365', label: 'Year', days: 365 },
  { id: 'all', label: 'All time', days: null },
];

let root = null, range = '30', unsub = [];

export function mountStats(el) {
  root = el;
  render();
  const rerender = debounce(() => render(true), 100);
  unsub = [on('data', rerender), on('prefs', rerender), on('custom', rerender), on('lists', rerender)];
}
export function unmountStats() { unsub.forEach((u) => u()); unsub = []; root = null; }

const visible = () => [...state.levels.values()].filter((l) => !custom(l.key).hidden || settings().showHidden);

/** Every session of every visible level, flattened. */
function allSessions() {
  const out = [];
  for (const l of visible()) for (const s of l.sessions) out.push({ level: l, s });
  return out.sort((a, b) => b.s.start - a.s.start);
}

/** When a level was first beaten: its first winning session, or null when it was beaten before tracking. */
function completedAt(l) {
  let first = null;
  for (const s of l.sessions) if (s.sum.completions > 0 && (!first || s.start < first)) first = s.start;
  return first;
}

const panel = (title, body, cls = '', actions = '') => h(`<div class="card-panel ${cls}"><div class="panel-head"><h3>${title}</h3><span class="sp"></span>${actions}</div><div class="panel-body">${body}</div></div>`);
const levelLink = (l, inner, cls = '') => `<a class="top-row ${cls}" href="#/level/${encodeURIComponent(l.key)}">${inner}</a>`;

function render(keep = false) {
  if (!root) return;
  const scroller = root.parentElement;
  const top = scroller.scrollTop;
  root.innerHTML = '';
  root.className = 'page stats';
  const levels = visible();
  if (!levels.length) {
    root.append(h(`<div class="empty"><div class="empty-icon">${icon('chart')}</div><h2>No levels yet</h2><p>Statistics appear as you play levels with Death Tracker.</p></div>`));
    return;
  }
  root.append(h('<div class="page-head"><h1>Statistics</h1></div>'));
  career(levels);
  activity();
  if (keep) scroller.scrollTop = top;
}

// ---------------------------------------------------------------- career

function career(levels) {
  const done = levels.filter(isCompleted);
  const demons = done.filter((l) => diffInfo(levelDifficulty(l)).rank >= 6);
  const dl = done.filter((l) => l.list?.source === 'pointercrate');
  const listed = done.filter((l) => l.list && l.list.source !== 'manual');
  const rated = levels.filter((l) => custom(l.key).enjoy);
  const avgEnjoy = rated.length ? rated.reduce((a, l) => a + custom(l.key).enjoy, 0) / rated.length : 0;
  const pt = levels.reduce((a, l) => a + l.playtime, 0);
  const att = levels.reduce((a, l) => a + l.attempts, 0);

  root.append(h('<h2 class="section-title">Career</h2>'));
  root.append(h(`<div class="summary">
    <div class="tile"><div class="tile-label">Levels completed</div><div class="tile-value">${num(done.length)}<small> / ${num(levels.length)}</small></div></div>
    <div class="tile"><div class="tile-label">Demons beaten</div><div class="tile-value">${num(demons.length)}</div><div class="tile-sub">${num(listed.length)} on a list${dl.length ? ` · ${num(dl.length)} Demonlist top 150` : ''}</div></div>
    <div class="tile"><div class="tile-label">Total playtime</div><div class="tile-value">${duration(pt)}</div></div>
    <div class="tile"><div class="tile-label">Total attempts</div><div class="tile-value">${compact(att)}</div></div>
    <div class="tile"><div class="tile-label">Average enjoyment</div><div class="tile-value">${rated.length ? (avgEnjoy / 2).toFixed(1) : '–'}<small>${rated.length ? ' / 5' : ''}</small></div><div class="tile-sub">${rated.length ? plural(rated.length, 'rated level') : 'rate levels on their page'}</div></div>
  </div>`));

  // Hardest completions
  const hardest = done.slice().sort((a, b) => hardness(b) - hardness(a)).slice(0, 10);
  root.append(panel(`Hardest completions <small>top ${hardest.length}</small>`, hardest.length ? `<div class="toplist ranked">${hardest.map((l, i) => {
    const at = completedAt(l);
    return levelLink(l, `<span class="place">${i + 1}</span>${thumbBox(l, 'mini')}
      <span class="top-main"><span class="top-name">${esc(displayName(l))}${doneTick('Completed', 'xs')}</span><span class="top-sub chips">${diffChip(l, 'flat')}${rankChip(l, 'flat')}</span></span>
      <span class="top-v">${at ? esc(shortDate(at)) : '<span class="muted">before tracking</span>'}<small>${num(l.attempts)} att${custom(l.key).enjoy ? ` · ${starsHtml(custom(l.key).enjoy)}` : ''}</small></span>`);
  }).join('')}</div>` : '<p class="muted">No completions yet.</p>', 'wide'));

  const row = h('<div class="panel-row"></div>');
  root.append(row);

  // Completions by difficulty
  const byDiff = DIFF_ORDER.slice().reverse().map((d) => ({ d, n: done.filter((l) => levelDifficulty(l) === d).length })).filter((x) => x.n);
  const maxN = Math.max(1, ...byDiff.map((x) => x.n));
  row.append(panel('Completions by difficulty', byDiff.length ? `<div class="diff-bars">${byDiff.map(({ d, n }) => {
    const info = diffInfo(d);
    const face = diffIconUrl(d);
    return `<div class="diff-bar"><span class="db-k">${face ? `<img src="${face}" alt="">` : `<i style="background:${info.color}"></i>`}${esc(info.name)}</span>
      <span class="db-bar"><i style="width:${(n / maxN) * 100}%;background:${info.color}"></i></span><span class="db-v">${num(n)}</span></div>`;
  }).join('')}</div>` : '<p class="muted">No completions yet.</p>'));

  // Completions per month
  const months = new Map();
  for (const l of done) {
    const at = completedAt(l);
    if (!at) continue;
    const d = new Date(at * 1000);
    const k = d.getFullYear() * 12 + d.getMonth();
    if (!months.has(k)) months.set(k, []);
    months.get(k).push(l);
  }
  const timeline = panel('Completions over time', '<div class="chart-slot"></div>');
  row.append(timeline);
  if (months.size) {
    const keys = [...months.keys()];
    const hi = Math.max(...keys), lo = Math.min(...keys, hi - 5);
    const label = (k) => new Date(Math.floor(k / 12), k % 12, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    columnChart(timeline.querySelector('.chart-slot'), {
      height: 200, xMin: lo, xMax: hi,
      data: keys.map((k) => ({ x: k, y: months.get(k).length, tip: `<div class="tt-title">${esc(label(k))}</div>${months.get(k).slice(0, 8).map((l) => esc(displayName(l))).join('<br>')}${months.get(k).length > 8 ? '<br>…' : ''}` })),
      yFmt: (v) => num(v), xTickFmt: label,
    });
    const untracked = done.length - [...months.values()].reduce((a, x) => a + x.length, 0);
    if (untracked) timeline.querySelector('.panel-body').append(h(`<p class="hint">${plural(untracked, 'completion')} happened before Death Tracker recorded sessions, so ${untracked === 1 ? 'it has' : 'they have'} no date.</p>`));
  } else timeline.querySelector('.panel-body').innerHTML = '<p class="muted">Completion dates come from Death Tracker sessions.</p>';

  const row2 = h('<div class="panel-row"></div>');
  root.append(row2);

  // Most attempts to beat
  const grinds = done.filter((l) => l.attempts > 0).sort((a, b) => b.attempts - a.attempts).slice(0, 8);
  const maxA = grinds[0]?.attempts || 1;
  row2.append(panel('Most attempts to beat', grinds.length ? `<div class="toplist">${grinds.map((l) => levelLink(l, `${thumbBox(l, 'mini')}
    <span class="top-main"><span class="top-name">${esc(displayName(l))}</span>${meter(l.attempts / maxA, 'done')}</span>
    <span class="top-v">${num(l.attempts)}<small>${duration(l.playtime)}</small></span>`)).join('')}</div>` : '<p class="muted">No completions yet.</p>'));

  // Closest to beating
  const close = levels.filter((l) => !isCompleted(l) && l.sum.best > 0).sort((a, b) => b.sum.best - a.sum.best || hardness(b) - hardness(a)).slice(0, 8);
  row2.append(panel('Closest to beating', close.length ? `<div class="toplist">${close.map((l) => levelLink(l, `${thumbBox(l, 'mini')}
    <span class="top-main"><span class="top-name">${esc(displayName(l))}</span>${meter(l.sum.best / 100)}</span>
    <span class="top-v">${esc(pctLabel(l, l.sum.best))}<small>${num(l.attempts)} att</small></span>`)).join('')}</div>` : '<p class="muted">Nothing in progress.</p>'));

  // Favourites by enjoyment
  if (rated.length) {
    const fav = rated.sort((a, b) => custom(b.key).enjoy - custom(a.key).enjoy || hardness(b) - hardness(a)).slice(0, 8);
    root.append(panel('Highest rated', `<div class="toplist cols">${fav.map((l) => levelLink(l, `${thumbBox(l, 'mini')}
      <span class="top-main"><span class="top-name">${esc(displayName(l))}${isCompleted(l) ? doneTick('Completed', 'xs') : ''}</span><span class="top-sub">${starsHtml(custom(l.key).enjoy)}</span></span>`)).join('')}</div>`, 'wide'));
  }
}

// ---------------------------------------------------------------- activity (date range)

function activity() {
  const sessions = allSessions();
  const head = h('<div class="section-head"><h2 class="section-title">Activity</h2><span class="sp"></span></div>');
  head.append(segmented(RANGES.map((x) => ({ id: x.id, label: x.label })), range, (id) => { range = id; render(true); }, 'small'));
  root.append(head);
  if (!sessions.length) {
    root.append(h('<p class="muted">Sessions appear as you play levels with Death Tracker.</p>'));
    return;
  }
  const r = RANGES.find((x) => x.id === range);
  const rangeLabel = r.days ? `last ${r.label.toLowerCase()}` : 'all time';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const oldest = sessions[sessions.length - 1].s.start;
  const startMs = r.days ? addDays(today, -(r.days - 1)) : dayStart(oldest);
  const inRange = sessions.filter((x) => dayStart(x.s.start) >= startMs);

  // Headline numbers
  const pt = inRange.reduce((a, x) => a + x.s.playtime, 0);
  const att = inRange.reduce((a, x) => a + x.s.sum.attempts, 0);
  const levels = new Set(inRange.map((x) => x.level.key));
  const days = new Map();
  for (const x of inRange) { const d = dayStart(x.s.start); days.set(d, (days.get(d) || 0) + x.s.playtime); }
  const records = inRange.filter((x) => x.s.newRecord).length;
  const comps = inRange.reduce((a, x) => a + x.s.sum.completions, 0);
  root.append(h(`<div class="summary">
    <div class="tile"><div class="tile-label">Playtime</div><div class="tile-value">${duration(pt)}</div><div class="tile-sub">${days.size ? `${duration(pt / days.size)} per active day` : ''}</div></div>
    <div class="tile"><div class="tile-label">Attempts</div><div class="tile-value">${compact(att)}</div><div class="tile-sub">${plural(inRange.length, 'session')}</div></div>
    <div class="tile"><div class="tile-label">Levels played</div><div class="tile-value">${num(levels.size)}</div></div>
    <div class="tile"><div class="tile-label">Active days</div><div class="tile-value">${num(days.size)}</div><div class="tile-sub">${streakText(sessions)}</div></div>
    <div class="tile"><div class="tile-label">Completions</div><div class="tile-value">${num(comps)}</div><div class="tile-sub">${records ? plural(records, 'new best') : ''}</div></div>
  </div>`));

  // Playtime per day
  const nDays = daysBetween(startMs, today.getTime()) + 1;
  const useWeeks = nDays > 120;
  const bucket = useWeeks ? 7 : 1;
  const buckets = [];
  for (let i = 0; i < Math.ceil(nDays / bucket); i++) buckets.push({ t: addDays(new Date(startMs), i * bucket), v: 0, att: 0, lv: new Set() });
  for (const x of inRange) {
    const i = Math.floor(daysBetween(startMs, dayStart(x.s.start)) / bucket);
    if (buckets[i]) { buckets[i].v += x.s.playtime; buckets[i].att += x.s.sum.attempts; buckets[i].lv.add(x.level.key); }
  }
  const chartPanel = panel(`Playtime per ${useWeeks ? 'week' : 'day'}`, '<div class="chart-slot"></div>', 'wide');
  root.append(chartPanel);
  const unit = Math.max(...buckets.map((b) => b.v)) >= 5400 ? 3600 : 60;
  columnChart(chartPanel.querySelector('.chart-slot'), {
    height: 230, xMin: 0, xMax: buckets.length - 1,
    data: buckets.map((b, i) => ({
      x: i, y: b.v / unit,
      tip: `<div class="tt-title">${useWeeks ? `Week of ${esc(absDate(b.t / 1000))}` : esc(dayLabel(b.t / 1000))}</div><b>${duration(b.v)}</b> · ${num(b.att)} attempts<br>${plural(b.lv.size, 'level')}`,
    })),
    yFmt: (v) => (unit === 3600 ? `${v}h` : `${v}m`),
    xTickFmt: (i) => new Date(buckets[i]?.t ?? 0).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  });

  // Calendar
  const cal = panel('Last 12 months', '<div class="chart-slot"></div>', 'wide', '<span class="hm-legend">Less <i class="hm0"></i><i class="hm1"></i><i class="hm2"></i><i class="hm3"></i><i class="hm4"></i> More</span>');
  root.append(cal);
  const yearDays = new Map();
  for (const x of sessions) { const d = dayStart(x.s.start); yearDays.set(d, (yearDays.get(d) || 0) + x.s.playtime); }
  calendarHeatmap(cal.querySelector('.chart-slot'), {
    values: yearDays,
    tip: (t, v) => `<div class="tt-title">${esc(dayLabel(t / 1000))}</div>${v ? `<b>${duration(v)}</b> played` : 'No play'}`,
  });

  // Top levels & recent sessions
  const row = h('<div class="panel-row"></div>');
  root.append(row);
  const perLevel = new Map();
  for (const x of inRange) {
    const p = perLevel.get(x.level.key) || { level: x.level, pt: 0, att: 0 };
    p.pt += x.s.playtime; p.att += x.s.sum.attempts;
    perLevel.set(x.level.key, p);
  }
  const top = [...perLevel.values()].sort((a, b) => b.pt - a.pt).slice(0, 8);
  const maxPt = top[0]?.pt || 1;
  row.append(panel(`Most played <small>${esc(rangeLabel)}</small>`, `<div class="toplist">${top.map((p) => levelLink(p.level, `${thumbBox(p.level, 'mini')}
      <span class="top-main"><span class="top-name">${esc(displayName(p.level))}</span>${meter(p.pt / maxPt)}</span>
      <span class="top-v">${duration(p.pt)}<small>${r.days && Math.abs(p.level.playtime - p.pt) > 60 ? `of ${duration(p.level.playtime)} all-time` : `${compact(p.att)} att`}</small></span>`)).join('')}</div>
    ${r.days ? `<p class="hint">Playtime within the selected range (${esc(rangeLabel)}). A level page shows its all-time total.</p>` : ''}`));

  const recent = inRange.slice(0, 12);
  row.append(panel(`Recent sessions <small>${esc(rangeLabel)}</small>`, `<div class="toplist">${recent.map((x) => `<a class="top-row ${x.s.sum.completions ? 'win' : ''}" href="#/level/${encodeURIComponent(x.level.key)}/sessions">
      ${thumbBox(x.level, 'mini')}
      <span class="top-main"><span class="top-name">${esc(displayName(x.level))}${x.s.sum.completions ? doneTick('Completed this session', 'xs') : x.s.newRecord ? ` <span class="chip rec sm" title="New best">${icon('trophy')}</span>` : ''}</span><span class="top-sub">${esc(dateTime(x.s.start))}</span></span>
      <span class="top-v">${duration(x.s.playtime)}<small>${num(x.s.sum.attempts)} att${x.s.sum.best != null ? ` · best ${esc(pctLabel(x.level, x.s.sum.best))}` : ''}</small></span></a>`).join('')}</div>`));
}

// Calendar-day arithmetic that stays on local midnight across daylight-saving changes.
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); d.setHours(0, 0, 0, 0); return d.getTime(); }
const daysBetween = (a, b) => Math.round((b - a) / 86400000);

function streakText(sessions) {
  const days = new Set(sessions.map((x) => dayStart(x.s.start)));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let t = today.getTime();
  if (!days.has(t)) t = addDays(new Date(t), -1); // a streak survives until the end of today
  let n = 0;
  while (days.has(t)) { n++; t = addDays(new Date(t), -1); }
  return n > 1 ? `${n}-day streak` : '';
}
