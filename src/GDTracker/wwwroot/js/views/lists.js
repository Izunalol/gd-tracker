// Community lists (Demonlist, Challenge List, AREDL, Impossible Levels List): every level with your own
// progress, plus each list's player leaderboard. Players and levels open in sheets like the websites'
// profile and level pages.
import { state, settings, setSettings, custom, isCompleted, loadLists, addLevel, on } from '../store.js';
import { baseName, isPlainName } from '../data.js';
import { meter } from '../charts.js';
import { icon } from '../icons.js';
import { h, segmented, toast } from '../ui.js';
import { esc, num, duration, relative, debounce, plural } from '../util.js';
import { doneTick } from './gallery.js';
import { SITES, leaderboard, flag, runText, hasCountries, COUNTRIES, countryName, homeCountry, codeFromNumeric } from '../listsites.js';
import { openPlayer, openListLevel } from './listsheets.js';

let root = null, unsub = [], query = '', lbQuery = '';
let lb = { key: '', rows: [], next: null, busy: false, error: '' };

export function mountLists(el) {
  root = el;
  render();
  const rerender = debounce(() => render(true), 80);
  unsub = [on('lists', rerender), on('data', rerender), on('prefs', rerender)];
}
export function unmountLists() { unsub.forEach((u) => u()); unsub = []; root = null; }

/**
 * Your tracked level for a list entry: by level id; by the placement the level page uses (which includes
 * your corrections); else by name for editor copies and start-pos uploads.
 */
export function matcher() {
  const byId = new Map(), byEntry = new Map(), byName = new Map();
  const names = settings().matchListByName;
  for (const e of state.levels.values()) {
    for (const m of e.members) {
      if (m.lookupId) byId.set(m.lookupId, e);
      if (names && !custom(e.key).noList && (!m.lookupId || !isPlainName(m.rawName))) {
        const n = baseName(m.rawName, true);
        // Short names ("VSC") only for editor copies; an upload needs a more distinctive name.
        if (n.length >= (m.lookupId ? 4 : 3) && !byName.has(n)) byName.set(n, e);
      }
    }
    if (e.list && e.list.source !== 'manual') for (const x of [e.list.entry, e.list.aredl]) if (x?.levelId) byEntry.set(+x.levelId, e);
  }
  return (l) => byId.get(+l.levelId) || byEntry.get(+l.levelId) || (names ? byName.get(baseName(l.name, true)) : null) || null;
}

function render(keep = false) {
  if (!root) return;
  const scroller = root.parentElement;
  const top = scroller.scrollTop;
  const s = settings();
  const tab = SITES[s.listTab] ? s.listTab : 'pointercrate';
  const view = s.listView === 'players' ? 'players' : 'levels';
  root.className = 'page lists';
  root.innerHTML = '';

  const data = state.lists[tab];
  const head = h(`<div class="page-head"><h1>Lists</h1><span class="list-tabs"></span><span class="sp"></span><span class="view-slot"></span>
    <span class="muted fetched"></span><button class="btn ghost icon-only" data-a="refresh" title="Refresh lists">${icon('refresh')}</button></div>`);
  head.querySelector('.list-tabs').append(segmented(Object.entries(SITES).map(([id, x]) => ({ id, label: x.label })), tab, (id) => setSettings({ listTab: id }), 'small'));
  head.querySelector('.view-slot').append(segmented([{ id: 'levels', label: 'Levels', icon: 'list' }, { id: 'players', label: 'Leaderboard', icon: 'trophy' }], view, (id) => setSettings({ listView: id }), 'small'));
  head.querySelector('.fetched').textContent = view === 'levels' && data?.fetched ? `Updated ${relative(data.fetched)}` : '';
  head.querySelector('[data-a=refresh]').onclick = async (e) => {
    if (!s.online || !s.lists) { toast('Online lists are turned off in Settings'); return; }
    e.currentTarget.classList.add('spin');
    if (view === 'players') { lb.key = ''; render(true); return; }
    await loadLists(true);
    toast('Lists refreshed');
  };
  root.append(head);

  if (view === 'players') players(tab);
  else levels(tab, data);
  if (keep) scroller.scrollTop = top;
}

// ---------------------------------------------------------------- levels

function levels(tab, data) {
  const s = settings();
  const site = SITES[tab];
  if (!data) { root.append(h('<div class="empty small"><span class="spinner big"></span></div>')); return; }
  if (!data.levels?.length) {
    root.append(h(`<div class="empty small"><div class="empty-icon">${icon('globe')}</div><h2>List not available</h2><p>${esc(data.error || 'Couldn’t download the list.')}${!s.online || !s.lists ? ' Online lists are turned off in Settings.' : ''}</p></div>`));
    return;
  }
  const hasLegacy = site.kind === 'pc' ? data.levels.some((l) => l.position > 150) : data.levels.some((l) => l.legacy);
  const find = matcher();
  let rows = data.levels
    .filter((l) => s.listLegacy || (site.kind === 'pc' ? l.position <= 150 : !l.legacy))
    .map((l) => ({ l, e: find(l) }));
  const scopeAll = rows;
  const q = query.trim().toLowerCase();
  rows = rows.filter(({ l, e }) => {
    const playedIt = e && (e.sum.attempts > 0 || isCompleted(e));
    if (s.listShow === 'played' && !playedIt) return false;
    if (s.listShow === 'completed' && !(e && isCompleted(e))) return false;
    if (s.listShow === 'unplayed' && playedIt) return false;
    if (s.listShow === 'progress' && !(playedIt && !isCompleted(e))) return false;
    return !q || [l.name, l.publisher, l.verifier, `#${l.position}`, ...(l.tags || [])].join(' ').toLowerCase().includes(q);
  });

  // Headline numbers over the whole list (not the filter).
  const played = scopeAll.filter((x) => x.e && (x.e.sum.attempts > 0 || isCompleted(x.e)));
  const beaten = played.filter((x) => isCompleted(x.e));
  const hardest = beaten[0];
  const closest = played.filter((x) => !isCompleted(x.e)).sort((a, b) => (b.e.sum.best ?? 0) - (a.e.sum.best ?? 0))[0];
  root.append(h(`<div class="summary">
    <div class="tile"><div class="tile-label">${site.kind === 'ill' ? 'Beaten' : 'Completed'}</div><div class="tile-value">${num(beaten.length)}<small> / ${num(scopeAll.length)}</small></div></div>
    <div class="tile"><div class="tile-label">Played</div><div class="tile-value">${num(played.length)}</div></div>
    ${hardest ? `<a class="tile link" href="#/level/${encodeURIComponent(hardest.e.key)}"><div class="tile-label">Hardest completed</div><div class="tile-value sm">#${hardest.l.position} ${esc(hardest.l.name)}</div></a>` : ''}
    ${closest ? `<a class="tile link" href="#/level/${encodeURIComponent(closest.e.key)}"><div class="tile-label">Your best</div><div class="tile-value sm">${esc(closest.l.name)} · ${closest.e.sum.best ?? 0}%</div><div class="tile-sub">#${closest.l.position}</div></a>` : ''}
  </div>`));

  const bar = h(`<div class="toolbar">
    <label class="search">${icon('search')}<input type="search" placeholder="Search ${esc(site.label)}…" value="${esc(query)}" spellcheck="false"></label>
    <span class="show-slot"></span>
    ${hasLegacy ? `<label class="check"><input type="checkbox" ${s.listLegacy ? 'checked' : ''} data-a="legacy">Show legacy</label>` : ''}
    <span class="spacer"></span><span class="count">${plural(rows.length, 'level')}</span>
  </div>`);
  bar.querySelector('.show-slot').append(segmented([
    { id: 'all', label: 'All' }, { id: 'played', label: 'Played' }, { id: 'completed', label: 'Completed' },
    { id: 'progress', label: 'In progress' }, { id: 'unplayed', label: 'Not played' },
  ], s.listShow, (id) => setSettings({ listShow: id }), 'small'));
  const input = bar.querySelector('input[type=search]');
  input.addEventListener('input', debounce(() => {
    query = input.value;
    const pos = input.selectionStart;
    render(true);
    const i2 = root.querySelector('.toolbar input[type=search]');
    i2.focus(); i2.setSelectionRange(pos, pos);
  }, 150));
  bar.querySelector('[data-a=legacy]')?.addEventListener('change', (e) => setSettings({ listLegacy: e.target.checked }));
  root.append(bar);

  const showThumbs = s.online && s.autoThumbs;
  const section = (l) => {
    if (site.kind === 'pc') return l.position <= 75 ? 'Main list' : l.position <= 150 ? 'Extended list' : 'Legacy list';
    return l.legacy ? 'Legacy' : null;
  };
  // The Challenge List's requirement is always 100%, so the column says nothing there.
  const showReq = site.kind === 'pc' && data.levels.some((l) => l.requirement != null && l.requirement < 100);
  const cols = site.kind === 'pc' ? (showReq ? ['List %'] : []) : site.kind === 'aredl' ? ['Points', '<span title="Community enjoyment (EDEL), out of 100">Enjoy</span>'] : ['Rating', 'Longest run'];
  let lastSection = null;
  const html = [];
  for (const { l, e } of rows) {
    const i = data.levels.indexOf(l);
    const sec = section(l);
    if (sec && sec !== lastSection && !q) html.push(`<tr class="sec"><td colspan="${6 + cols.length}">${esc(sec)}</td></tr>`);
    lastSection = sec;
    const done = e && isCompleted(e);
    const best = e?.sum.best ?? null;
    const thumb = showThumbs && l.levelId
      ? `<img loading="lazy" src="https://levelthumbs.prevter.me/thumbnail/${+l.levelId}/small" alt="" onerror="this.onerror=null;${l.thumbnail ? `this.src='${esc(l.thumbnail)}'` : 'this.remove()'}">`
      : '';
    const player = (name, id) => (name ? (id != null && site.kind === 'pc' ? `<button class="player-link" data-player="${esc(id)}">${esc(name)}</button>` : esc(name)) : '?');
    const sub = site.kind === 'pc'
      ? `by ${player(l.publisher, l.publisherId)}${l.verifier ? ` · verified by ${player(l.verifier, l.verifierId)}` : ''}${l.fps && l.fps !== 'Any' ? ` · ${esc(l.fps)} fps` : ''}`
      : site.kind === 'ill'
        ? `by ${esc(l.publisher || '?')}${l.seconds ? ` · ${Math.round(l.seconds)}s` : ''}${l.fps ? ` · ${num(l.fps)} fps` : ''}`
        : (l.tags || []).slice(0, 4).map(esc).join(' · ');
    const extra = site.kind === 'pc'
      ? (showReq ? [l.requirement != null ? `${l.requirement}%` : ''] : [])
      : site.kind === 'aredl'
        ? [l.points != null ? num(l.points) : '', +l.enjoyment > 0 ? (+l.enjoyment).toFixed(0) : '']
        : [l.rating != null ? (+l.rating).toFixed(2) : '', longestRun(l)];
    html.push(`<tr class="${done ? 'win' : ''} ${e ? 'mine' : ''}" data-i="${i}" ${e ? `data-key="${esc(e.key)}"` : ''}>
      <td class="pos">#${l.position}</td>
      <td class="name"><div class="row-name"><div class="thumb mini">${thumb}</div><div><div class="rn-title">${esc(l.name)}${done ? doneTick('Completed', 'sm') : ''}</div><div class="rn-sub">${sub}</div></div></div></td>
      <td class="prog">${e ? (done ? `<span class="beat">${e.sum.completions > 1 ? `${e.sum.completions}× ` : ''}completed</span>` : (best != null ? `<span class="best">${best}%</span>${meter(best / 100)}` : `<span class="muted">${e.sum.attempts ? 'Practice only' : 'Added · not played yet'}</span>`)) : `<span class="muted">Not played</span>${l.levelId ? ` <button class="btn sm ghost add-btn" data-add="${i}" title="Add to your levels (to rate it, link videos or mark it completed)">${icon('plus')}Add</button>` : ''}`}</td>
      <td class="num">${e ? num(e.attempts) : ''}</td>
      <td class="num">${e ? duration(e.playtime) : ''}</td>
      ${extra.map((x) => `<td class="num">${x}</td>`).join('')}
      <td class="act"><button class="btn ghost sm" data-info="${i}" title="${site.kind === 'ill' ? 'Record runs' : 'Victors'} and details">${icon('trophy')}</button></td>
    </tr>`);
  }
  const table = h(`<div class="table-wrap"><table class="tbl list-tbl">
    <thead><tr><th>#</th><th>Level</th><th>Your progress</th><th class="num">Attempts</th><th class="num">Playtime</th>${cols.map((c) => `<th class="num">${c}</th>`).join('')}<th></th></tr></thead>
    <tbody>${html.join('') || `<tr><td colspan="${6 + cols.length}" class="muted">No levels match.</td></tr>`}</tbody></table></div>`);
  table.addEventListener('click', (ev) => {
    const p = ev.target.closest('[data-player]');
    if (p) { ev.stopPropagation(); openPlayer(tab, +p.dataset.player); return; }
    const add = ev.target.closest('[data-add]');
    if (add) {
      ev.stopPropagation();
      const l = data.levels[+add.dataset.add];
      addLevel({ id: +l.levelId, name: l.name, creator: l.publisher, difficulty: site.kind === 'ill' ? 0 : 10 });
      toast(`Added ${l.name} to your levels`);
      return;
    }
    const info = ev.target.closest('[data-info]');
    if (info) { ev.stopPropagation(); openListLevel(tab, data.levels[+info.dataset.info]); return; }
    const tr = ev.target.closest('tr[data-i]');
    if (!tr) return;
    // Your own levels open their page; others open the list's level view.
    if (tr.dataset.key) location.hash = `#/level/${encodeURIComponent(tr.dataset.key)}`;
    else openListLevel(tab, data.levels[+tr.dataset.i]);
  });
  root.append(table);
  root.append(h(`<p class="about">Data from ${esc(site.site)}. Your levels are matched by level ID${s.matchListByName ? ', and editor or start-pos copies by name' : ''}. Click a level you haven't played (or ${icon('trophy')}) to see its ${site.kind === 'ill' ? 'record runs' : 'victors'}; click a player to see their profile.</p>`));
}

function longestRun(l) {
  let best = null;
  for (const r of l.records || []) if (!best || r.end - r.start > best.end - best.start) best = r;
  return best ? `<span title="${esc(best.player || '')}">${runText([best.start, best.end])}</span>` : '<span class="muted">–</span>';
}

// ---------------------------------------------------------------- leaderboard

function players(tab) {
  const site = SITES[tab];
  const country = hasCountries(tab) ? settings().lbCountry || '' : '';
  const key = `${tab}|${lbQuery}|${country}`;
  const home = homeCountry();
  const countLabel = lb.key === key && lb.rows.length
    ? (lb.total ? plural(lb.total, 'player') : plural(lb.rows.length, 'player') + (lb.next ? '+' : ''))
    : '';
  const bar = h(`<div class="toolbar">
    <label class="search">${icon('search')}<input type="search" placeholder="Find a player…" value="${esc(lbQuery)}" spellcheck="false"></label>
    ${hasCountries(tab) ? `<label class="country-pick">${country ? flag(country) : icon('globe')}<select data-a="country">
      <option value="">All countries</option>
      ${home ? `<option value="${home}" ${country === home ? 'selected' : ''}>${esc(countryName(home))} (you)</option><option disabled>──────────</option>` : ''}
      ${COUNTRIES.map((c) => `<option value="${c.code}" ${country === c.code && c.code !== home ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
    </select></label>` : ''}
    <span class="spacer"></span><span class="count">${countLabel}</span>
  </div>`);
  bar.querySelector('[data-a=country]')?.addEventListener('change', (e) => setSettings({ lbCountry: e.target.value }));
  const input = bar.querySelector('input');
  input.addEventListener('input', debounce(() => {
    lbQuery = input.value.trim();
    render(true);
    const i2 = root.querySelector('.toolbar input[type=search]');
    i2.focus(); i2.setSelectionRange(i2.value.length, i2.value.length);
  }, 350));
  root.append(bar);
  if (!settings().online || !settings().lists) {
    root.append(h(`<div class="empty small"><div class="empty-icon">${icon('globe')}</div><p>Online lists are turned off in Settings.</p></div>`));
    return;
  }

  const wrap = h('<div class="lb"></div>');
  root.append(wrap);
  const draw = () => {
    if (lb.error) { wrap.innerHTML = `<div class="empty small"><p>${esc(lb.error)}</p></div>`; return; }
    if (!lb.rows.length) { wrap.innerHTML = lb.busy ? '<div class="empty small"><span class="spinner big"></span></div>' : '<div class="empty small"><p class="muted">No players found.</p></div>'; return; }
    const extraCol = lb.rows.some((r) => r.extra);
    // Filtered to a country: the in-country position leads, the global rank follows.
    const local = country && lb.rows.some((r) => r.localRank != null);
    const medal = (r) => (local ? r.localRank : r.rank);
    wrap.innerHTML = `<div class="table-wrap"><table class="tbl lb-tbl">
      <thead><tr><th>${local ? `${esc(countryName(country))}` : 'Rank'}</th>${local ? '<th class="num">Global</th>' : ''}<th>Player</th><th class="num">${esc(site.scoreLabel)}</th>${extraCol ? '<th></th>' : ''}</tr></thead>
      <tbody>${lb.rows.map((r, i) => `<tr data-r="${i}" class="${medal(r) <= 3 ? `top${medal(r)}` : ''}">
        <td class="pos">${local ? (r.localRank != null ? `#${num(r.localRank)}` : '') : r.rank != null ? `#${num(r.rank)}` : ''}</td>
        ${local ? `<td class="num muted">${r.rank != null ? `#${num(r.rank)}` : ''}</td>` : ''}
        <td><span class="lb-name">${r.country && !country ? `<button class="flag-btn" data-cc="${esc(typeof r.country === 'number' ? '' : String(r.country).toLowerCase())}" data-num="${typeof r.country === 'number' ? r.country : ''}" title="Only ${esc(r.countryName || 'this country')}">${flag(r.country, r.countryName)}</button>` : flag(r.country, r.countryName)}<b>${esc(r.name)}</b></span></td>
        <td class="num">${typeof r.score === 'number' ? (site.kind === 'ill' ? num(r.score) : r.score >= 100 ? num(r.score) : r.score.toFixed(2)) : ''}</td>
        ${extraCol ? `<td class="muted lb-extra">${esc(r.extra || '')}</td>` : ''}
      </tr>`).join('')}</tbody></table></div>
      ${lb.next != null ? `<div class="more-row"><button class="btn" data-a="more" ${lb.busy ? 'disabled' : ''}>${lb.busy ? 'Loading…' : 'Load more'}</button></div>` : ''}`;
    wrap.querySelector('tbody').addEventListener('click', (e) => {
      // A flag filters the leaderboard to that country.
      const f = e.target.closest('.flag-btn');
      if (f) {
        e.stopPropagation();
        const cc = f.dataset.cc || codeFromNumeric(+f.dataset.num);
        if (cc) setSettings({ lbCountry: cc });
        return;
      }
      const tr = e.target.closest('tr[data-r]');
      if (tr) { const r = lb.rows[+tr.dataset.r]; openPlayer(tab, r.id, r.slug, { rank: r.rank, score: r.score }); }
    });
    wrap.querySelector('[data-a=more]')?.addEventListener('click', () => load(true));
  };
  const load = async (more = false) => {
    if (lb.busy) return;
    lb.busy = true;
    if (!more) { lb = { key, rows: [], next: null, busy: true, error: '' }; }
    draw();
    try {
      const res = await leaderboard(tab, { query: lbQuery, cursor: more ? lb.next : null, country });
      if (lb.key !== key) return;
      lb.rows = [...lb.rows, ...res.rows];
      lb.next = res.next;
      lb.total = res.total;
    } catch (e) { lb.error = e.message; }
    lb.busy = false;
    if (root && settings().listView === 'players') render(true);
  };
  if (lb.key !== key) load(); else draw();
}
