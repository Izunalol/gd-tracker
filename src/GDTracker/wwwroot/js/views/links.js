// Linking copies of the same level (editor copies, start-pos copies, the online original) into one:
// a review sheet for detected copies, and an editor for one level's links.
import { state, linkSuggestions, linkLevels, unlinkLevel, setPrimary, dismissSuggestion, displayName, on } from '../store.js';
import { baseName, TYPES } from '../data.js';
import { thumbBox } from '../thumbs.js';
import { icon } from '../icons.js';
import { h, openSheet, toast } from '../ui.js';
import { esc, num, duration, when, plural } from '../util.js';

const memberLine = (l) => `${esc(TYPES[l.type])}${l.type !== 'editor' && l.id != null ? ` · ${l.id}` : ''} · ${num(l.attempts)} att · ${duration(l.playtime)} · ${esc(when(l.lastPlayed))}`;

/** Review every detected group of copies: pick members and the main level, then link or dismiss. */
export function openSuggestions() {
  const s = openSheet({
    size: 'lg',
    cls: 'links-sheet',
    html: `
      <div class="sheet-head"><h2>Possible copies</h2><span class="sheet-sub">Linked levels share one card, one thumbnail and combined stats. You can unlink them any time.</span><button class="btn ghost icon-only" data-a="close">${icon('xmark')}</button></div>
      <div class="sheet-body"><div class="sugg-list"></div></div>
      <div class="sheet-foot"><span class="hint">The main level (●) keeps its name and thumbnail; online levels are preferred because they have server info.</span><div class="row-btns"><button class="btn" data-a="close">Done</button><button class="btn primary" data-a="all">Link all</button></div></div>`,
  });
  const listEl = s.el.querySelector('.sugg-list');
  s.el.querySelectorAll('[data-a=close]').forEach((b) => (b.onclick = () => s.close()));

  const picks = new Map(); // sig → { keys:Set, primary }
  const render = () => {
    const sugg = linkSuggestions();
    if (!sugg.length) {
      listEl.innerHTML = `<div class="empty small"><div class="empty-icon">${icon('checkCircle')}</div><div>No more suggestions.</div></div>`;
      s.el.querySelector('[data-a=all]').disabled = true;
      return;
    }
    listEl.innerHTML = '';
    for (const g of sugg) {
      if (!picks.has(g.sig)) picks.set(g.sig, { keys: new Set(g.levels.map((l) => l.key)), primary: g.primary.key });
      const p = picks.get(g.sig);
      const el = h(`<div class="sugg">
        <div class="sugg-head"><b>${esc(displayName(state.levels.get(state.memberOf.get(p.primary)) || g.primary))}</b><span class="muted">${plural(g.levels.length, 'level')}</span><span class="sp"></span>
          <button class="btn ghost sm" data-a="dismiss">Not copies</button><button class="btn sm primary" data-a="link">${icon('link')}Link</button></div>
        <div class="sugg-members">${g.levels.map((l) => {
          const e = state.levels.get(state.memberOf.get(l.key)) || l;
          return `<label class="member ${p.keys.has(l.key) ? '' : 'off'}">
            <input type="checkbox" data-k="${esc(l.key)}" ${p.keys.has(l.key) ? 'checked' : ''}>
            ${thumbBox(e, 'mini')}
            <span class="m-main"><span class="m-name">${esc(l.rawName)}${e.isGroup ? ` <span class="muted">(+${e.members.length - 1} linked)</span>` : ''}</span><span class="m-sub">${memberLine(e)}</span></span>
            <button class="primary-dot ${p.primary === l.key ? 'on' : ''}" data-primary="${esc(l.key)}" title="Make this the main level">${p.primary === l.key ? 'Main' : 'Make main'}</button>
          </label>`;
        }).join('')}</div></div>`);
      el.querySelectorAll('input[data-k]').forEach((cb) => cb.addEventListener('change', () => {
        cb.checked ? p.keys.add(cb.dataset.k) : p.keys.delete(cb.dataset.k);
        cb.closest('.member').classList.toggle('off', !cb.checked);
        if (!p.keys.has(p.primary) && p.keys.size) { p.primary = [...p.keys][0]; render(); }
      }));
      el.querySelectorAll('[data-primary]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); p.primary = b.dataset.primary; p.keys.add(b.dataset.primary); render(); }));
      el.querySelector('[data-a=dismiss]').onclick = () => { dismissSuggestion(g); render(); };
      el.querySelector('[data-a=link]').onclick = () => {
        if (p.keys.size < 2) { toast('Pick at least two levels'); return; }
        link(g, p);
        render();
      };
      listEl.append(el);
    }
  };
  const link = (g, p) => {
    // Members may already be groups of their own; link via their keys so groups merge.
    linkLevels([p.primary, ...[...p.keys].filter((k) => k !== p.primary)], p.primary);
    // Anything left unticked won't be suggested with this group again.
    if (p.keys.size < g.levels.length) dismissSuggestion(g);
  };
  s.el.querySelector('[data-a=all]').onclick = () => {
    const sugg = linkSuggestions();
    let n = 0;
    for (const g of sugg) {
      const p = picks.get(g.sig) || { keys: new Set(g.levels.map((l) => l.key)), primary: g.primary.key };
      if (p.keys.size >= 2) { link(g, p); n++; }
    }
    toast(`Linked ${plural(n, 'group')}`);
    render();
  };
  render();
}

/** Manage one level's links: see members, change the main level, unlink, or add other levels. */
export function openLinkEditor(level) {
  let entityKey = level.key;
  const s = openSheet({
    size: 'md',
    cls: 'links-sheet',
    html: `
      <div class="sheet-head"><h2>Linked copies</h2><span class="sheet-sub"></span><button class="btn ghost icon-only" data-a="close">${icon('xmark')}</button></div>
      <div class="sheet-body">
        <div class="lbl">Linked together</div>
        <div class="members"></div>
        <div class="lbl">Add a copy</div>
        <label class="search wide">${icon('search')}<input type="search" placeholder="Search your levels…" spellcheck="false"></label>
        <div class="candidates"></div>
      </div>
      <div class="sheet-foot"><span class="hint">Stats are combined; each copy's own data is untouched.</span><button class="btn primary" data-a="close">Done</button></div>`,
  });
  s.el.querySelectorAll('[data-a=close]').forEach((b) => (b.onclick = () => s.close()));
  const input = s.el.querySelector('input');
  const entity = () => state.levels.get(entityKey) || state.levels.get(state.memberOf.get(level.key));

  const render = () => {
    const e = entity();
    if (!e) { s.close(); return; }
    entityKey = e.key;
    s.el.querySelector('.sheet-sub').textContent = displayName(e);
    s.el.querySelector('.members').innerHTML = e.members.map((m) => `<div class="member">
      ${thumbBox(m.key === e.key ? e : m, 'mini')}
      <span class="m-main"><span class="m-name">${esc(m.rawName)}</span><span class="m-sub">${memberLine(m)}</span></span>
      ${e.members.length > 1 ? `${m.key === e.key ? '<span class="primary-dot on">Main</span>' : `<button class="primary-dot" data-primary="${esc(m.key)}">Make main</button>`}
      <button class="btn ghost sm" data-unlink="${esc(m.key)}" title="Unlink">${icon('xmark')}</button>` : '<span class="muted">Not linked yet</span>'}
    </div>`).join('');
    s.el.querySelectorAll('[data-primary]').forEach((b) => (b.onclick = () => { setPrimary(b.dataset.primary); entityKey = b.dataset.primary; render(); }));
    s.el.querySelectorAll('[data-unlink]').forEach((b) => (b.onclick = () => { unlinkLevel(b.dataset.unlink); render(); }));
    renderCandidates();
  };
  const renderCandidates = () => {
    const e = entity();
    const q = input.value.trim().toLowerCase();
    const mine = new Set(e.members.map((m) => m.key));
    const base = baseName(e.rawName);
    const cands = [...state.levels.values()].filter((l) => l.key !== e.key && !l.members.some((m) => mine.has(m.key)))
      .map((l) => ({ l, score: l.members.some((m) => baseName(m.rawName) === base) ? 2 : l.members.some((m) => baseName(m.rawName).includes(base) || base.includes(baseName(m.rawName))) ? 1 : 0 }))
      .filter(({ l, score }) => (q ? [displayName(l), ...l.members.map((m) => m.rawName)].join(' ').toLowerCase().includes(q) : score > 0))
      .sort((a, b) => b.score - a.score || b.l.lastPlayed - a.l.lastPlayed)
      .slice(0, 12);
    s.el.querySelector('.candidates').innerHTML = cands.length ? cands.map(({ l, score }) => `<div class="member cand">
      ${thumbBox(l, 'mini')}
      <span class="m-main"><span class="m-name">${esc(displayName(l))}${score === 2 ? ' <span class="chip sm">likely copy</span>' : ''}</span><span class="m-sub">${memberLine(l)}${l.isGroup ? ` · ${l.members.length} linked` : ''}</span></span>
      <button class="btn sm" data-add="${esc(l.key)}">${icon('link')}Link</button></div>`).join('')
      : `<p class="muted">${q ? 'No matching levels.' : 'No similar names found — search to link any level.'}</p>`;
    s.el.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => {
      const other = state.levels.get(b.dataset.add);
      linkLevels([entity().key, ...other.members.map((m) => m.key)], entity().key);
      render();
    }));
  };
  input.addEventListener('input', renderCandidates);
  const unsub = on('data', () => { if (!s.closed) render(); });
  const close = s.close;
  s.close = () => { unsub(); close(); };
  render();
  setTimeout(() => input.focus(), 30);
}
