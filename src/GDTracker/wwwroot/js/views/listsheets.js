// Player profiles and list-level pages for the community lists, shown as sheets that stack: a level's
// victors link to their profiles, a profile's completions link back to levels, like browsing the sites.
import { state, settings, isCompleted, addLevel } from '../store.js';
import { icon } from '../icons.js';
import { h, openSheet, toast } from '../ui.js';
import { esc, num, shortDate } from '../util.js';
import { call } from '../rpc.js';
import { SITES, profile, victors, flag, runText } from '../listsites.js';
import { doneTick } from './gallery.js';
import { matcher } from './lists.js';

const thumbUrl = (id) => (settings().online && settings().autoThumbs && id > 0 ? `https://levelthumbs.prevter.me/thumbnail/${+id}/small` : '');

/** The cached list entry for an item from a profile (by the list's own id, GD level id, or position + name). */
function findLevel(tab, item) {
  const levels = state.lists[tab]?.levels || [];
  return levels.find((l) => item.listId != null && l.id === item.listId)
    || levels.find((l) => item.levelId && +l.levelId === +item.levelId)
    || levels.find((l) => l.position === item.position && l.name === item.name)
    || null;
}

const sheetHead = (title, sub = '') => `<div class="sheet-head"><h2>${title}</h2><span class="sheet-sub">${sub}</span><button class="btn ghost icon-only" data-a="close">${icon('xmark')}</button></div>`;

// ---------------------------------------------------------------- player

export function openPlayer(tab, id, slug, hint = {}) {
  const site = SITES[tab];
  const s = openSheet({
    size: 'lg',
    cls: 'list-sheet',
    html: `${sheetHead(`${esc(site.label)} player`)}<div class="sheet-body"><div class="empty small"><span class="spinner big"></span></div></div>
      <div class="sheet-foot"><span class="hint">From ${esc(site.site)}.</span><div class="row-btns"><button class="btn" data-a="web" hidden>${icon('globe')}Open on website</button><button class="btn primary" data-a="close">Done</button></div></div>`,
  });
  s.el.querySelectorAll('[data-a=close]').forEach((b) => (b.onclick = () => s.close()));
  const body = s.el.querySelector('.sheet-body');
  profile(tab, id, slug).then((p) => {
    if (s.closed) return;
    // Some sites leave rank/score off the profile; the leaderboard row we came from has them.
    p.rank ??= hint.rank;
    if (!p.score && hint.score) p.score = hint.score;
    s.el.querySelector('h2').innerHTML = `${flag(p.country, p.countryName)}${esc(p.name)}`;
    s.el.querySelector('.sheet-sub').textContent = [p.rank ? `#${num(p.rank)} on the ${site.label}` : '', p.countryName || ''].filter(Boolean).join(' · ');
    if (p.url) {
      const web = s.el.querySelector('[data-a=web]');
      web.hidden = false;
      web.onclick = () => call('app.openUrl', { url: p.url });
    }
    const find = matcher();
    const tile = (label, value) => `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div></div>`;
    const scoreText = typeof p.score === 'number' ? (site.kind === 'ill' ? num(p.score) : p.score >= 100 ? num(p.score) : p.score.toFixed(2)) : '–';
    body.innerHTML = `<div class="summary">${p.rank ? tile('Rank', `#${num(p.rank)}`) : ''}${site.kind !== 'ill' ? tile(site.scoreLabel, scoreText) : ''}${p.stats.map(([k, v]) => tile(k, num(v))).join('')}</div>
      ${p.sections.filter((sec) => sec.items.length).map((sec, si) => `
        <div class="pl-section"><h3>${esc(sec.title)} <small>${num(sec.items.length)}</small></h3>
        <div class="pl-items">${sec.items.map((it, ii) => {
          const lvl = findLevel(tab, it);
          const mine = lvl ? find(lvl) : null;
          const beat = mine && isCompleted(mine);
          return `<button class="pl-item ${beat ? 'beat' : ''}" data-s="${si}" data-i="${ii}" title="${esc(it.name || '')}${beat ? ' — you’ve beaten this too' : ''}">
            ${it.position != null ? `<span class="pl-pos">#${it.position}</span>` : ''}<span class="pl-name">${esc(it.name || '?')}</span>
            ${it.run ? `<span class="pl-prog">${runText(it.run)}</span>` : it.progress != null && it.progress < 100 ? `<span class="pl-prog">${it.progress}%</span>` : ''}
            ${beat ? doneTick('You’ve beaten this too', 'xs') : ''}
            ${it.video ? `<span class="pl-video" data-video="${esc(it.video)}" title="Watch">${icon('play')}</span>` : ''}
          </button>`;
        }).join('')}</div></div>`).join('') || '<p class="muted">No records.</p>'}`;
    body.addEventListener('click', (e) => {
      const v = e.target.closest('[data-video]');
      if (v) { e.stopPropagation(); call('app.openUrl', { url: v.dataset.video }); return; }
      const b = e.target.closest('.pl-item');
      if (!b) return;
      const it = p.sections[+b.dataset.s].items[+b.dataset.i];
      const lvl = findLevel(tab, it);
      if (lvl) openListLevel(tab, lvl);
      else if (it.video) call('app.openUrl', { url: it.video });
      else toast('That level isn’t in the downloaded list (it may be legacy or removed).');
    });
  }).catch((e) => { if (!s.closed) body.innerHTML = `<div class="empty small"><p>${esc(e.message)}</p></div>`; });
}

// ---------------------------------------------------------------- list level

export function openListLevel(tab, level) {
  const site = SITES[tab];
  const mine = matcher()(level);
  const th = thumbUrl(level.levelId);
  const verb = site.kind === 'ill' ? 'Record runs' : 'Victors';
  const s = openSheet({
    size: 'lg',
    cls: 'list-sheet',
    html: `${sheetHead(`#${level.position} ${esc(level.name)}`, esc(site.label))}
      <div class="sheet-body">
        <div class="ll-top">
          ${th ? `<div class="ll-thumb"><img src="${th}" alt="" onerror="this.parentElement.remove()"></div>` : ''}
          <div class="ll-info">
            <div class="ll-meta"></div>
            <div class="ll-mine"></div>
            <div class="row-btns ll-btns"></div>
          </div>
        </div>
        <div class="ll-creators"></div>
        <h3 class="ll-h">${verb} <small class="ll-count"></small></h3>
        <div class="victors"><div class="empty small"><span class="spinner big"></span></div></div>
      </div>
      <div class="sheet-foot"><span class="hint">From ${esc(site.site)}.</span><button class="btn primary" data-a="close">Done</button></div>`,
  });
  const el = s.el;
  el.querySelectorAll('[data-a=close]').forEach((b) => (b.onclick = () => s.close()));
  const playerBtn = (name, id) => (name ? (id != null && site.kind === 'pc' ? `<button class="player-link" data-player="${esc(id)}">${esc(name)}</button>` : `<b>${esc(name)}</b>`) : '?');

  const facts = [];
  if (site.kind === 'pc') {
    facts.push(`Published by ${playerBtn(level.publisher, level.publisherId)}`);
    if (level.verifier) facts.push(`Verified by ${playerBtn(level.verifier, level.verifierId)}`);
    if (level.requirement != null) facts.push(`List% ${level.requirement}%`);
    if (level.fps && level.fps !== 'Any') facts.push(`${esc(level.fps)} fps`);
  } else if (site.kind === 'aredl') {
    if (level.points != null) facts.push(`${num(level.points)} points`);
    if (+level.enjoyment > 0) facts.push(`Enjoyment ${(+level.enjoyment).toFixed(0)}/100`);
    if (level.gddlTier != null) facts.push(`GDDL tier ${(+level.gddlTier).toFixed(1).replace(/\.0$/, '')}`);
    if (level.tags?.length) facts.push(level.tags.map(esc).join(' · '));
  } else {
    facts.push(`Uploaded by <b>${esc(level.publisher || '?')}</b>`);
    if (level.rating != null) facts.push(`Rating ${(+level.rating).toFixed(2)}`);
    if (level.seconds) facts.push(`${Math.round(level.seconds)}s long`);
    if (level.fps) facts.push(`${num(level.fps)} fps`);
  }
  if (level.levelId) facts.push(`ID ${level.levelId}`);
  el.querySelector('.ll-meta').innerHTML = facts.map((f) => `<span>${f}</span>`).join('');

  el.querySelector('.ll-mine').innerHTML = mine
    ? `<div class="ll-you ${isCompleted(mine) ? 'win' : ''}">${isCompleted(mine) ? `${doneTick('Completed', 'sm')} You've completed this` : `Your best: <b>${mine.sum.best ?? 0}%</b>`} · ${num(mine.attempts)} attempts</div>`
    : '<div class="ll-you muted">You haven’t played this level.</div>';
  const btns = el.querySelector('.ll-btns');
  btns.innerHTML = `${mine ? `<a class="btn" href="#/level/${encodeURIComponent(mine.key)}" data-a="mine">${icon('chevronRight')}Open in GD Tracker</a>`
    : level.levelId ? `<button class="btn" data-a="add">${icon('plus')}Add to my levels</button>` : ''}
    ${level.video ? `<button class="btn" data-a="video">${icon('play')}${site.kind === 'ill' ? 'Showcase' : 'Verification'}</button>` : ''}
    <button class="btn ghost" data-a="web">${icon('globe')}Open on website</button>`;
  btns.querySelector('[data-a=mine]')?.addEventListener('click', closeAllListSheets);
  btns.querySelector('[data-a=add]')?.addEventListener('click', (e) => {
    addLevel({ id: +level.levelId, name: level.name, creator: level.publisher, difficulty: site.kind === 'ill' ? 0 : 10 });
    toast(`Added ${level.name} to your levels`);
    e.currentTarget.outerHTML = '<span class="muted">Added to your levels</span>';
  });
  btns.querySelector('[data-a=video]')?.addEventListener('click', () => call('app.openUrl', { url: level.video }));
  btns.querySelector('[data-a=web]').onclick = () => call('app.openUrl', { url: site.levelUrl(level) });

  const list = el.querySelector('.victors');
  let items = [], next = null, busy = false;
  const draw = () => {
    el.querySelector('.ll-count').textContent = items.length ? num(items.length) + (next ? '+' : '') : '';
    list.innerHTML = items.length ? `<div class="vic">${items.map((v) => `
      <div class="vic-row ${v.progress >= 100 ? 'full' : ''}">
        <span class="vic-name">${flag(v.country)}${v.playerId != null ? `<button class="player-link" data-pid="${esc(v.playerId)}" data-slug="${esc(v.slug || '')}">${esc(v.player || '?')}</button>` : esc(v.player || '?')}</span>
        <span class="vic-prog">${v.run ? runText(v.run) : v.progress >= 100 ? 'Completed' : `${v.progress}%`}</span>
        <span class="vic-date">${v.date ? esc(shortDate(Date.parse(v.date) / 1000)) : ''}</span>
        ${v.video ? `<button class="btn ghost icon-only sm" data-video="${esc(v.video)}" title="Watch">${icon('play')}</button>` : '<span></span>'}
      </div>`).join('')}</div>
      ${next != null ? `<div class="more-row"><button class="btn" data-a="more" ${busy ? 'disabled' : ''}>${busy ? 'Loading…' : 'Load more'}</button></div>` : ''}`
      : `<p class="muted">${busy ? 'Loading…' : site.kind === 'ill' ? 'No record runs yet.' : 'No victors yet.'}</p>`;
    list.querySelector('[data-a=more]')?.addEventListener('click', () => load());
  };
  const load = async () => {
    if (busy) return;
    busy = true;
    draw();
    try {
      const res = await victors(tab, level, next);
      items = [...items, ...res.items];
      next = res.next;
      if (res.extra?.creators?.length && site.kind === 'pc') {
        el.querySelector('.ll-creators').innerHTML = `<span class="muted">Creators</span> ${res.extra.creators.map((c) => playerBtn(c.name, c.id)).join('')}`;
      }
    } catch (e) { list.innerHTML = `<p class="muted">${esc(e.message)}</p>`; busy = false; return; }
    busy = false;
    if (!s.closed) draw();
  };
  el.querySelector('.sheet-body').addEventListener('click', (e) => {
    const v = e.target.closest('[data-video]');
    if (v) { call('app.openUrl', { url: v.dataset.video }); return; }
    const p = e.target.closest('[data-player]');
    if (p) { openPlayer(tab, +p.dataset.player); return; }
    const q = e.target.closest('[data-pid]');
    if (q) openPlayer(tab, site.kind === 'pc' ? +q.dataset.pid : q.dataset.pid, q.dataset.slug || undefined);
  });
  load();
}

/** Leaving for a level page closes the whole stack of list sheets. */
function closeAllListSheets() {
  document.querySelectorAll('.layer .list-sheet').forEach((sheet) => sheet.closest('.layer')?.querySelector('.backdrop')?.dispatchEvent(new MouseEvent('mousedown')));
}
