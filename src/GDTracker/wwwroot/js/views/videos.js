// YouTube videos attached to a level: your completion or progress, the verification, other players'
// completions, or a showcase. Stored per level as custom.videos = [{ url, kind, title, author }].
import { custom, setCustom, displayName, levelInfo } from '../store.js';
import { icon } from '../icons.js';
import { h, openSheet, segmented, showMenu, toast } from '../ui.js';
import { esc, debounce } from '../util.js';
import { call } from '../rpc.js';
import { storeUrl } from '../images.js';

// Order is the order they're offered in. 'completion' and 'showcase' keep their original ids.
export const KINDS = {
  completion: 'My completion',
  progress: 'My progress',
  verification: 'Verification',
  other: 'Completion (other player)',
  showcase: 'Showcase',
};
const KIND_ICON = { completion: 'check', progress: 'flag', verification: 'trophy', other: 'checkCircle', showcase: 'play' };
// Words added to the YouTube search for each type.
const KIND_QUERY = { completion: '100%', progress: 'progress', verification: 'verification', other: '100%', showcase: 'showcase' };

/** The 11-character id from any common YouTube link shape (watch, youtu.be, shorts, embed, live). */
export function youtubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (!/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname)) return null;
    if (u.searchParams.get('v')) return u.searchParams.get('v').slice(0, 11);
    const m = /^\/(shorts|embed|live|v)\/([\w-]{11})/.exec(u.pathname);
    return m ? m[2] : null;
  } catch { return null; }
}

export const videoThumb = (url) => {
  const id = youtubeId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
};

export const levelVideos = (key) => custom(key).videos || [];

/** Grid of video tiles for a level (with remove / change type / use as thumbnail on each). */
export function videoGrid(level, { onChange } = {}) {
  const vids = levelVideos(level.key);
  const el = h(`<div class="videos">${vids.map((v, i) => {
    const th = videoThumb(v.url);
    return `<div class="video" data-i="${i}" title="${esc(v.url)}">
      <div class="video-thumb">${th ? `<img src="${th}" alt="" loading="lazy">` : `<span class="video-ph">${icon('play')}</span>`}<span class="video-play">${icon('play')}</span>
        <span class="video-kind ${v.kind}">${icon(KIND_ICON[v.kind] || 'play')}${esc(KINDS[v.kind] || 'Video')}</span></div>
      <div class="video-meta"><span class="video-title">${esc(v.title || v.url)}</span>${v.author ? `<span class="video-author">${esc(v.author)}</span>` : ''}</div>
      <button class="btn ghost icon-only sm video-more" data-more="${i}" title="More">${icon('ellipsis')}</button>
    </div>`;
  }).join('')}</div>`);
  el.addEventListener('click', (e) => {
    const more = e.target.closest('[data-more]');
    const tile = e.target.closest('.video');
    if (!tile) return;
    const i = +tile.dataset.i;
    const v = vids[i];
    if (more) {
      e.stopPropagation();
      const set = (list) => { setCustom(level.key, { videos: list }); onChange?.(); };
      showMenu([
        { label: 'Open video', icon: 'play', action: () => call('app.openUrl', { url: v.url }) },
        { label: 'Type', icon: 'tag', submenu: Object.entries(KINDS).map(([k, label]) => ({
          label, checked: v.kind === k, action: () => set(vids.map((x, j) => (j === i ? { ...x, kind: k } : x))),
        })) },
        ...(videoThumb(v.url) ? [{ label: 'Use as level thumbnail', icon: 'image', action: () => useAsThumbnail(level, v) }] : []),
        { label: 'Copy link', icon: 'link', action: () => { navigator.clipboard.writeText(v.url); toast('Link copied'); } },
        '-',
        { label: 'Remove', icon: 'trash', danger: true, action: () => set(vids.filter((_, j) => j !== i)) },
      ], more, { align: 'end' });
      return;
    }
    call('app.openUrl', { url: v.url });
  });
  return el;
}

async function useAsThumbnail(level, v) {
  const id = youtubeId(v.url);
  const t = toast('Saving thumbnail…', { spinner: true, timeout: 0 });
  try {
    // maxresdefault doesn't exist for every video; fall back to the always-present hqdefault.
    let img;
    try { img = await storeUrl(`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`); }
    catch { img = await storeUrl(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`); }
    setCustom(level.key, { thumb: img, thumbPos: 50 });
    t.done('Thumbnail updated');
  } catch (e) { t.done(e.message, 4000); }
}


/**
 * Sheet to add a video: search YouTube from inside the app (pre-filled with the level name and type) or
 * paste a link. Pick the type; titles fill in automatically.
 */
export function openAddVideo(level, { kind = 'completion', onAdded } = {}) {
  let k = kind, mode = 'search', meta = null, picked = null, results = [], edited = false;
  const info = levelInfo(level);
  const suggest = () => [displayName(level), info?.creator && k === 'verification' ? info.creator : '', 'geometry dash', KIND_QUERY[k]].filter(Boolean).join(' ');
  const s = openSheet({
    size: 'lg',
    cls: 'add-video-sheet',
    html: `
      <div class="sheet-head"><h2>Add a video</h2><span class="sheet-sub"></span><button class="btn ghost icon-only" data-a="close">${icon('xmark')}</button></div>
      <div class="av-top">
        <div class="kind-slot"></div>
        <div class="mode-slot"></div>
      </div>
      <div class="sheet-body add-video">
        <div class="av-search">
          <div class="av-bar"><label class="search wide">${icon('search')}<input type="search" data-f="q" spellcheck="false"></label><button class="btn" data-a="go">Search</button></div>
          <div class="yt-results"></div>
        </div>
        <div class="av-link" hidden>
          <label class="lbl">YouTube link</label>
          <input class="field" data-f="url" placeholder="https://www.youtube.com/watch?v=…" spellcheck="false">
          <div class="video-preview"></div>
        </div>
      </div>
      <div class="sheet-foot"><label class="field-row switch-row"><span>Also use as the level thumbnail</span><label class="switch"><input type="checkbox" name="asThumb"><span></span></label></label><div class="row-btns"><button class="btn" data-a="close">Cancel</button><button class="btn primary" data-a="add" disabled>Add video</button></div></div>`,
  });
  const el = s.el;
  const $ = (sel) => el.querySelector(sel);
  $('.sheet-sub').textContent = displayName(level);
  el.querySelectorAll('[data-a=close]').forEach((b) => (b.onclick = () => s.close()));
  const q = $('[data-f=q]'), urlInput = $('[data-f=url]'), add = $('[data-a=add]'), list = $('.yt-results'), preview = $('.video-preview');
  q.value = suggest();

  const refreshAdd = () => { add.disabled = mode === 'search' ? !picked : !/^https?:\/\//i.test(urlInput.value.trim()); };

  // ---- search
  let seq = 0;
  const search = async () => {
    const query = q.value.trim();
    if (!query) return;
    const mine = ++seq;
    picked = null;
    refreshAdd();
    list.innerHTML = '<div class="empty small"><span class="spinner big"></span></div>';
    try {
      results = await call('youtube.search', { query });
    } catch (e) {
      if (mine === seq) list.innerHTML = `<div class="empty small"><p>${esc(e.message)}</p><p class="muted">You can still paste a link instead.</p></div>`;
      return;
    }
    if (mine !== seq) return;
    const have = new Set(levelVideos(level.key).map((v) => youtubeId(v.url)));
    list.innerHTML = results.length ? results.map((r, i) => `
      <div class="yt-result ${have.has(r.id) ? 'added' : ''}" data-i="${i}" title="${esc(r.title)}" tabindex="0">
        <span class="yt-thumb"><img src="https://i.ytimg.com/vi/${esc(r.id)}/mqdefault.jpg" alt="" loading="lazy">${r.duration ? `<span class="yt-dur">${esc(r.duration)}</span>` : ''}${have.has(r.id) ? `<span class="yt-have">${icon('check')}Added</span>` : ''}</span>
        <span class="yt-title">${esc(r.title)}</span>
        <span class="yt-sub">${esc([r.channel, r.views, r.published].filter(Boolean).join(' · '))}</span>
        <button class="yt-open" data-open="${i}" title="Watch on YouTube first">${icon('globe')}</button>
      </div>`).join('') : '<div class="empty small"><p class="muted">No videos found. Try different words.</p></div>';
  };
  list.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { e.stopPropagation(); call('app.openUrl', { url: `https://www.youtube.com/watch?v=${results[+open.dataset.open].id}` }); return; }
    const b = e.target.closest('.yt-result');
    if (!b) return;
    list.querySelectorAll('.yt-result.on').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    picked = results[+b.dataset.i];
    refreshAdd();
  });
  list.addEventListener('dblclick', (e) => { if (e.target.closest('.yt-result') && picked) add.click(); });
  q.addEventListener('input', () => { edited = true; });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
  $('[data-a=go]').onclick = search;

  // ---- paste a link
  const lookup = debounce(async () => {
    const url = urlInput.value.trim();
    meta = null;
    const th = /^https?:\/\//i.test(url) ? videoThumb(url) : null;
    preview.innerHTML = th ? `<img src="${th}" alt=""><div class="vp-title muted">Looking up title…</div>` : '';
    if (!th) return;
    meta = await call('web.oembed', { url }).catch(() => null);
    if (urlInput.value.trim() !== url) return;
    preview.querySelector('.vp-title').outerHTML = meta
      ? `<div class="vp-title"><b>${esc(meta.title)}</b><br><span class="muted">${esc(meta.author || '')}</span></div>`
      : '<div class="vp-title muted">Couldn’t read the title (it’ll show the link instead).</div>';
  }, 250);
  urlInput.addEventListener('input', () => { refreshAdd(); lookup(); });

  // ---- type and mode
  $('.kind-slot').append(segmented(Object.entries(KINDS).map(([id, label]) => ({ id, label })), k, (id) => {
    k = id;
    // The search follows the type, unless you've typed your own words.
    if (!edited) { q.value = suggest(); if (mode === 'search') search(); }
  }, 'small kinds'));
  $('.mode-slot').append(segmented([{ id: 'search', label: 'Search YouTube', icon: 'search' }, { id: 'link', label: 'Paste a link', icon: 'link' }], mode, (id) => {
    mode = id;
    $('.av-search').hidden = id !== 'search';
    $('.av-link').hidden = id !== 'link';
    refreshAdd();
    (id === 'search' ? q : urlInput).focus();
  }, 'small'));

  add.onclick = async () => {
    const v = mode === 'search'
      ? { url: `https://www.youtube.com/watch?v=${picked.id}`, kind: k, title: picked.title, author: picked.channel || '' }
      : { url: urlInput.value.trim(), kind: k, title: meta?.title || '', author: meta?.author || '' };
    if (levelVideos(level.key).some((x) => youtubeId(x.url) && youtubeId(x.url) === youtubeId(v.url))) { toast('That video is already on this level'); return; }
    setCustom(level.key, { videos: [...levelVideos(level.key), v] });
    if ($('input[name=asThumb]').checked && videoThumb(v.url)) await useAsThumbnail(level, v);
    s.close();
    toast(`Added ${KINDS[k].toLowerCase()} video`);
    onAdded?.();
  };

  setTimeout(async () => {
    // A YouTube link already on the clipboard? Start on the link tab with it filled in.
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (youtubeId(clip) && !levelVideos(level.key).some((v) => youtubeId(v.url) === youtubeId(clip))) {
        el.querySelector('.mode-slot .seg-btn[data-id=link]').click();
        urlInput.value = clip;
        refreshAdd();
        lookup();
        return;
      }
    } catch { /* clipboard not available */ }
    q.focus();
    search();
  }, 40);
}
