// Finding levels you don't have Death Tracker data for: search the GD servers (like the in-game search,
// a number finds that ID) or the Demonlist / AREDL, then add them to your levels. The same sheet picks
// "which list level is this?" for a level whose automatic match was wrong.
import { state, settings, addLevel, displayName, isCompleted, on } from '../store.js';
import { diffInfo, LENGTHS } from '../data.js';
import { icon } from '../icons.js';
import { h, openSheet, segmented, toast } from '../ui.js';
import { esc, num, debounce } from '../util.js';
import { call } from '../rpc.js';

const SOURCES = [
  { id: 'gd', label: 'GD servers' },
  { id: 'pointercrate', label: 'Demonlist' },
  { id: 'aredl', label: 'AREDL' },
];

/** Tracked entity for a GD level id (including linked copies and added levels). */
function owned(id) {
  const k = state.memberOf.get(String(id));
  if (k) return state.levels.get(k);
  for (const e of state.levels.values()) if (e.members.some((m) => m.lookupId === +id)) return e;
  return null;
}

const thumb = (id) => (settings().online && settings().autoThumbs && id > 0
  ? `<img loading="lazy" src="https://levelthumbs.prevter.me/thumbnail/${+id}/small" alt="" onerror="this.remove()">` : '');

/**
 * opts.pick: (listLevel) => void — choose-a-list-level mode (lists only, one button per row).
 * opts.query: initial search text.
 */
export function openFinder({ pick = null, query = '', title } = {}) {
  let source = pick ? (settings().listTab === 'aredl' ? 'aredl' : 'pointercrate') : 'gd';
  let page = 0, results = [], busy = false, error = '';
  const s = openSheet({
    size: 'lg',
    cls: 'finder',
    html: `
      <div class="sheet-head"><h2>${esc(title || (pick ? 'Which list level is this?' : 'Find a level'))}</h2><span class="sheet-sub">${pick ? 'Pick the right entry from the Demonlist or AREDL.' : 'Add levels you haven’t played with Death Tracker, to rate them, link videos or mark them completed.'}</span><button class="btn ghost icon-only" data-a="close">${icon('xmark')}</button></div>
      <div class="finder-bar"><label class="search wide">${icon('search')}<input type="search" placeholder="Level name or ID…" spellcheck="false" value="${esc(query)}"></label><span class="src-slot"></span></div>
      <div class="sheet-body"><div class="results"></div></div>
      <div class="sheet-foot"><span class="hint status"></span><button class="btn" data-a="more" hidden>More results</button><button class="btn primary" data-a="close">Done</button></div>`,
  });
  const el = s.el;
  const input = el.querySelector('input');
  const out = el.querySelector('.results');
  const status = el.querySelector('.status');
  const more = el.querySelector('[data-a=more]');
  el.querySelectorAll('[data-a=close]').forEach((b) => (b.onclick = () => s.close()));
  el.querySelector('.src-slot').append(segmented(SOURCES.filter((x) => !pick || x.id !== 'gd'), source, (id) => { source = id; page = 0; run(); }, 'small'));

  const listResults = (q) => {
    const list = state.lists[source]?.levels || [];
    const n = q.toLowerCase();
    const byId = /^\d+$/.test(q) ? +q : null;
    return list.filter((l) => (byId ? +l.levelId === byId || l.position === byId : l.name.toLowerCase().includes(n) || (l.publisher || '').toLowerCase().includes(n)))
      .slice(0, 60)
      .map((l) => ({ id: +l.levelId, name: l.name, creator: l.publisher, difficulty: 10, listPos: l.position, legacy: l.legacy || (source === 'pointercrate' && l.position > 150), entry: l }));
  };

  const render = () => {
    if (busy && !results.length) { out.innerHTML = '<div class="empty small"><span class="spinner big"></span></div>'; return; }
    if (error) { out.innerHTML = `<div class="empty small"><div class="empty-icon">${icon('globe')}</div><p>${esc(error)}</p></div>`; return; }
    if (!results.length) {
      out.innerHTML = `<div class="empty small"><p class="muted">${input.value.trim() ? 'No levels found.' : source === 'gd' ? 'Type a level name or ID and press Enter.' : 'Type to search the list.'}</p></div>`;
      return;
    }
    out.innerHTML = results.map((r, i) => {
      const mine = owned(r.id);
      const d = diffInfo(r.difficulty ?? 0);
      const bits = [r.creator ? `by ${esc(r.creator)}` : '', r.listPos ? `#${r.listPos}${r.legacy ? ' (legacy)' : ''}` : '', d.name, r.stars ? `${r.stars}★` : '', r.length != null ? LENGTHS[r.length] : '', r.id ? `ID ${r.id}` : ''].filter(Boolean);
      const action = pick
        ? `<button class="btn sm primary" data-pick="${i}">This one</button>`
        : mine
          ? `<a class="btn sm ghost" href="#/level/${encodeURIComponent(mine.key)}" data-open>${isCompleted(mine) ? '✓ ' : ''}In your levels${mine.added ? '' : ''}</a>`
          : `<button class="btn sm" data-add="${i}">${icon('plus')}Add</button>`;
      return `<div class="member find-row">
        <div class="thumb mini">${thumb(r.id)}</div>
        <span class="m-main"><span class="m-name">${esc(r.name)}${mine && !pick ? ` <span class="muted">· ${esc(displayName(mine))}</span>` : ''}</span><span class="m-sub">${bits.join(' · ')}</span></span>
        ${action}</div>`;
    }).join('');
    out.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => {
      const r = results[+b.dataset.add];
      addLevel({ id: r.id, name: r.name, creator: r.creator, difficulty: r.difficulty, stars: r.stars, length: r.length });
      toast(`Added ${r.name} to your levels`);
      render();
    }));
    out.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => { pick(results[+b.dataset.pick].entry); s.close(); }));
    out.querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', () => s.close()));
  };

  const run = async (append = false) => {
    const q = input.value.trim();
    error = '';
    more.hidden = true;
    if (!q) { results = []; status.textContent = ''; render(); return; }
    if (source !== 'gd') {
      if (!state.lists[source]?.levels?.length) { error = 'The list hasn’t been downloaded (check Settings → Online extras).'; render(); return; }
      results = listResults(q);
      status.textContent = `${results.length}${results.length === 60 ? '+' : ''} matches`;
      render();
      return;
    }
    if (!settings().online) { error = 'Online lookups are turned off in Settings.'; render(); return; }
    busy = true;
    if (!append) results = [];
    render();
    try {
      const found = await call('online.search', { query: q, page });
      results = append ? [...results, ...found] : found;
      status.textContent = `${num(results.length)} result${results.length === 1 ? '' : 's'}${found.length >= 10 ? ' so far' : ''}`;
      more.hidden = found.length < 10;
    } catch (e) { error = e.message; }
    busy = false;
    render();
  };
  more.onclick = () => { page++; run(true); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); page = 0; run(); } });
  input.addEventListener('input', debounce(() => { if (source !== 'gd') run(); }, 150));
  const unsub = on('data', () => { if (!s.closed) render(); });
  const close = s.close;
  s.close = () => { unsub(); close(); };
  if (query) run(); else render();
  setTimeout(() => input.focus(), 30);
  return s;
}
