// Activity across all levels: playtime per day, a year calendar, top levels and the latest sessions.
import { state, settings, custom, displayName, pctLabel, on } from '../store.js';
import { columnChart, calendarHeatmap, meter } from '../charts.js';
import { thumbBox } from '../thumbs.js';
import { icon } from '../icons.js';
import { h, segmented } from '../ui.js';
import { esc, num, compact, duration, dayStart, dayLabel, dateTime, plural, debounce, absDate } from '../util.js';

const RANGES = [
  { id: '7', label: '7 days', days: 7 },
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
  { id: '365', label: 'Year', days: 365 },
  { id: 'all', label: 'All time', days: null },
];

let root = null, range = '30', unsub = [];

export function mountActivity(el) {
  root = el;
  render();
  const rerender = debounce(render, 100);
  unsub = [on('data', rerender), on('prefs', rerender), on('custom', rerender)];
}
export function unmountActivity() { unsub.forEach((u) => u()); unsub = []; root = null; }

/** Every session of every visible level, flattened. */
function allSessions() {
  const out = [];
  for (const l of state.levels.values()) {
    if (custom(l.key).hidden && !settings().showHidden) continue;
    for (const s of l.sessions) out.push({ level: l, s });
  }
  return out.sort((a, b) => b.s.start - a.s.start);
}

function render() {
  if (!root) return;
  root.innerHTML = '';
  root.className = 'page activity';
  const sessions = allSessions();
  if (!sessions.length) {
    root.append(h(`<div class="empty"><div class="empty-icon">${icon('calendar')}</div><h2>No sessions yet</h2><p>Sessions appear as you play levels with Death Tracker.</p></div>`));
    return;
  }
  const r = RANGES.find((x) => x.id === range);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const oldest = sessions[sessions.length - 1].s.start;
  const startMs = r.days ? addDays(today, -(r.days - 1)) : dayStart(oldest);
  const inRange = sessions.filter((x) => dayStart(x.s.start) >= startMs);

  const head = h(`<div class="page-head"><h1>Activity</h1><span class="sp"></span></div>`);
  head.append(segmented(RANGES.map((x) => ({ id: x.id, label: x.label })), range, (id) => { range = id; render(); }, 'small'));
  root.append(head);

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
    <div class="tile"><div class="tile-label">New bests</div><div class="tile-value">${num(records)}</div><div class="tile-sub">${comps ? plural(comps, 'completion') : ''}</div></div>
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
  const chartPanel = h(`<div class="card-panel wide"><div class="panel-head"><h3>Playtime per ${useWeeks ? 'week' : 'day'}</h3></div><div class="panel-body"><div class="chart-slot"></div></div></div>`);
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
  const cal = h(`<div class="card-panel wide"><div class="panel-head"><h3>Last 12 months</h3><span class="sp"></span><span class="hm-legend">Less <i class="hm0"></i><i class="hm1"></i><i class="hm2"></i><i class="hm3"></i><i class="hm4"></i> More</span></div><div class="panel-body"><div class="chart-slot"></div></div></div>`);
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
  row.append(h(`<div class="card-panel"><div class="panel-head"><h3>Most played</h3></div><div class="panel-body">
    <div class="toplist">${top.map((p) => `<a class="top-row" href="#/level/${encodeURIComponent(p.level.key)}">
      ${thumbBox(p.level, 'mini')}
      <span class="top-main"><span class="top-name">${esc(displayName(p.level))}</span>${meter(p.pt / maxPt)}</span>
      <span class="top-v">${duration(p.pt)}<small>${compact(p.att)} att</small></span></a>`).join('')}</div>
  </div></div>`));

  const recent = inRange.slice(0, 12);
  row.append(h(`<div class="card-panel"><div class="panel-head"><h3>Recent sessions</h3></div><div class="panel-body">
    <div class="toplist">${recent.map((x) => `<a class="top-row" href="#/level/${encodeURIComponent(x.level.key)}/sessions">
      ${thumbBox(x.level, 'mini')}
      <span class="top-main"><span class="top-name">${esc(displayName(x.level))}${x.s.newRecord ? ` <span class="chip rec sm">${icon('trophy')}</span>` : ''}</span><span class="top-sub">${esc(dateTime(x.s.start))}</span></span>
      <span class="top-v">${duration(x.s.playtime)}<small>${num(x.s.sum.attempts)} att${x.s.sum.best != null ? ` · best ${esc(pctLabel(x.level, x.s.sum.best))}` : ''}</small></span></a>`).join('')}</div>
  </div></div>`));
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
