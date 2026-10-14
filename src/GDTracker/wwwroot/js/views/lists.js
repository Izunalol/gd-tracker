// Community lists (Pointercrate Demonlist, AREDL) with your own progress on each level.
import { state, settings, setSettings, displayName, isCompleted, loadLists, on } from '../store.js';
import { meter } from '../charts.js';
import { icon } from '../icons.js';
import { h, segmented, toast } from '../ui.js';
import { esc, num, duration, relative, debounce, plural } from '../util.js';
import { doneTick } from './gallery.js';
import { call } from '../rpc.js';

const LISTS = {
  pointercrate: { label: 'Demonlist', site: 'Pointercrate', url: (l) => `https://pointercrate.com/demonlist/${l.position}/` },
  aredl: { label: 'AREDL', site: 'All Rated Extreme Demons List', url: (l) => `https://aredl.net/list/${l.levelId}` },
};

let root = null, unsub = [], query = '';

export function mountLists(el) {
  root = el;
  render();
  const rerender = debounce(() => render(true), 80);
  unsub = [on('lists', rerender), on('data', rerender), on('prefs', rerender)];
}
export function unmountLists() { unsub.forEach((u) => u()); unsub = []; root = null; }

/** Your tracked level for a list entry: by level id, else (optionally) by name for editor/start-pos copies. */
function matcher() {
  const byId = new Map(), byEntry = new Map();
  for (const e of state.levels.values()) {
    for (const m of e.members) if (m.lookupId) byId.set(m.lookupId, e);
    // Same matches the level pages use (including name matches and "not a list level" overrides).
    if (e.list && e.list.source !== 'manual') for (const x of [e.list.entry, e.list.aredl]) if (x?.levelId) byEntry.set(+x.levelId, e);
  }
  return (l) => byId.get(+l.levelId) || byEntry.get(+l.levelId) || null;
}

function render(keep = false) {
  if (!root) return;
  const scroller = root.parentElement;
  const top = scroller.scrollTop;
  const s = settings();
  const tab = LISTS[s.listTab] ? s.listTab : 'pointercrate';
  const data = state.lists[tab];
  root.className = 'page lists';
  root.innerHTML = '';

  const head = h(`<div class="page-head"><h1>Lists</h1><span class="sp"></span><span class="muted fetched"></span>
    <button class="btn ghost icon-only" data-a="refresh" title="Refresh lists">${icon('refresh')}</button></div>`);
  head.insertBefore(segmented(Object.entries(LISTS).map(([id, x]) => ({ id, label: x.label })), tab, (id) => setSettings({ listTab: id }), 'small'), head.querySelector('.sp'));
  head.querySelector('.fetched').textContent = data?.fetched ? `Updated ${relative(data.fetched)}` : '';
  head.querySelector('[data-a=refresh]').onclick = async (e) => {
    if (!s.online || !s.lists) { toast('Online lists are turned off in Settings'); return; }
    e.currentTarget.classList.add('spin');
    await loadLists(true);
    toast('Lists refreshed');
  };
  root.append(head);

  if (!data) { root.append(h('<div class="empty small"><span class="spinner big"></span></div>')); return; }
  if (!data.levels?.length) {
    root.append(h(`<div class="empty small"><div class="empty-icon">${icon('globe')}</div><h2>List not available</h2><p>${esc(data.error || 'Couldn’t download the list.')}${!s.online || !s.lists ? ' Online lists are turned off in Settings.' : ''}</p></div>`));
    return;
  }

  const find = matcher();
  let levels = data.levels.filter((l) => tab !== 'pointercrate' || s.listLegacy || l.position <= 150)
    .filter((l) => tab !== 'aredl' || s.listLegacy || !l.legacy)
    .map((l) => ({ l, e: find(l) }));
  const scopeAll = levels;
  const q = query.trim().toLowerCase();
  levels = levels.filter(({ l, e }) => {
    if (s.listShow === 'played' && !e) return false;
    if (s.listShow === 'completed' && !(e && isCompleted(e))) return false;
    if (s.listShow === 'unplayed' && e) return false;
    if (s.listShow === 'progress' && !(e && !isCompleted(e))) return false;
    return !q || [l.name, l.publisher, l.verifier, `#${l.position}`, ...(l.tags || [])].join(' ').toLowerCase().includes(q);
  });

  // Headline numbers over the whole list (not the filter).
  const played = scopeAll.filter((x) => x.e);
  const beaten = played.filter((x) => isCompleted(x.e));
  const hardest = beaten[0];
  const closest = played.filter((x) => !isCompleted(x.e)).sort((a, b) => (b.e.sum.best ?? 0) - (a.e.sum.best ?? 0))[0];
  root.append(h(`<div class="summary">
    <div class="tile"><div class="tile-label">Completed</div><div class="tile-value">${num(beaten.length)}<small> / ${num(scopeAll.length)}</small></div></div>
    <div class="tile"><div class="tile-label">Played</div><div class="tile-value">${num(played.length)}</div></div>
    ${hardest ? `<a class="tile link" href="#/level/${encodeURIComponent(hardest.e.key)}"><div class="tile-label">Hardest completed</div><div class="tile-value sm">#${hardest.l.position} ${esc(hardest.l.name)}</div></a>` : ''}
    ${closest ? `<a class="tile link" href="#/level/${encodeURIComponent(closest.e.key)}"><div class="tile-label">Closest to beating</div><div class="tile-value sm">${esc(closest.l.name)} · ${closest.e.sum.best ?? 0}%</div><div class="tile-sub">#${closest.l.position}</div></a>` : ''}
  </div>`));

  const bar = h(`<div class="toolbar">
    <label class="search">${icon('search')}<input type="search" placeholder="Search ${esc(LISTS[tab].label)}…" value="${esc(query)}" spellcheck="false"></label>
    <span class="show-slot"></span>
    <label class="check"><input type="checkbox" ${s.listLegacy ? 'checked' : ''} data-a="legacy">Show legacy</label>
    <span class="spacer"></span><span class="count">${plural(levels.length, 'level')}</span>
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
  bar.querySelector('[data-a=legacy]').addEventListener('change', (e) => setSettings({ listLegacy: e.target.checked }));
  root.append(bar);

  const showThumbs = s.online && s.autoThumbs;
  const section = (l) => {
    if (tab === 'pointercrate') return l.position <= 75 ? 'Main list' : l.position <= 150 ? 'Extended list' : 'Legacy list';
    return l.legacy ? 'Legacy' : null;
  };
  let lastSection = null;
  const rows = [];
  for (const { l, e } of levels) {
    const sec = section(l);
    if (sec && sec !== lastSection && !q) rows.push(`<tr class="sec"><td colspan="7">${esc(sec)}</td></tr>`);
    lastSection = sec;
    const done = e && isCompleted(e);
    const best = e?.sum.best ?? null;
    const thumb = showThumbs && l.levelId
      ? `<img loading="lazy" src="https://levelthumbs.prevter.me/thumbnail/${+l.levelId}/small" alt="" onerror="this.onerror=null;${l.thumbnail ? `this.src='${esc(l.thumbnail)}'` : 'this.remove()'}">`
      : '';
    const sub = tab === 'pointercrate'
      ? `by ${esc(l.publisher || '?')}${l.verifier ? ` · verified by ${esc(l.verifier)}` : ''}`
      : (l.tags || []).slice(0, 4).map(esc).join(' · ');
    rows.push(`<tr class="${done ? 'win' : ''} ${e ? 'mine' : ''}" data-i="${data.levels.indexOf(l)}" ${e ? `data-key="${esc(e.key)}"` : ''}>
      <td class="pos">#${l.position}</td>
      <td class="name"><div class="row-name"><div class="thumb mini">${thumb}</div><div><div class="rn-title">${esc(l.name)}${done ? doneTick('Completed', 'sm') : ''}</div><div class="rn-sub">${sub}</div></div></div></td>
      <td class="prog">${e ? (done ? `<span class="beat">${e.sum.completions > 1 ? `${e.sum.completions}× ` : ''}completed</span>` : (best != null ? `<span class="best">${best}%</span>${meter(best / 100)}` : '<span class="muted">Practice only</span>')) : '<span class="muted">Not played</span>'}</td>
      <td class="num">${e ? num(e.attempts) : ''}</td>
      <td class="num">${e ? duration(e.playtime) : ''}</td>
      <td class="num">${tab === 'pointercrate' ? (l.requirement != null ? `${l.requirement}%` : '') : l.points != null ? num(l.points) : ''}</td>
      <td class="num">${tab === 'aredl' && +l.enjoyment > 0 ? (+l.enjoyment).toFixed(0) : e && e.key && e.list?.by === 'name' ? '<span class="muted" title="Matched by name">≈</span>' : ''}</td>
    </tr>`);
  }
  const table = h(`<div class="table-wrap"><table class="tbl list-tbl">
    <thead><tr><th>#</th><th>Level</th><th>Your progress</th><th class="num">Attempts</th><th class="num">Playtime</th>
      <th class="num">${tab === 'pointercrate' ? 'List %' : 'Points'}</th><th class="num">${tab === 'aredl' ? '<span title="Community enjoyment (EDEL), out of 100">Enjoy</span>' : ''}</th></tr></thead>
    <tbody>${rows.join('') || '<tr><td colspan="7" class="muted">No levels match.</td></tr>'}</tbody></table></div>`);
  table.addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr[data-i]');
    if (!tr) return;
    if (tr.dataset.key) { location.hash = `#/level/${encodeURIComponent(tr.dataset.key)}`; return; }
    const l = data.levels[+tr.dataset.i];
    call('app.openUrl', { url: LISTS[tab].url(l) });
  });
  root.append(table);
  root.append(h(`<p class="about">Data from ${esc(LISTS[tab].site)}. Your levels are matched by level ID${s.matchListByName ? ', and editor or start-pos copies by name' : ''}. Click a level you haven't played to open it on the list's website.</p>`));
  if (keep) scroller.scrollTop = top;
}
