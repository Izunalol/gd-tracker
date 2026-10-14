// YouTube videos attached to a level: your own completion, or a showcase/verification you like.
// Stored per level as custom.videos = [{ url, kind: 'completion' | 'showcase', title, author }].
import { custom, setCustom } from '../store.js';
import { icon } from '../icons.js';
import { h, openSheet, segmented, showMenu, toast } from '../ui.js';
import { esc } from '../util.js';
import { call } from '../rpc.js';
import { storeUrl } from '../images.js';

export const KINDS = { completion: 'My completion', showcase: 'Showcase' };

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
        <span class="video-kind ${v.kind}">${v.kind === 'completion' ? icon('check') : icon('play')}${esc(KINDS[v.kind] || 'Video')}</span></div>
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
        { label: v.kind === 'completion' ? 'Mark as showcase' : 'Mark as my completion', icon: 'check', action: () => set(vids.map((x, j) => (j === i ? { ...x, kind: x.kind === 'completion' ? 'showcase' : 'completion' } : x))) },
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

/** Sheet to add a video: paste a link, pick the type, and the title fills in from YouTube. */
export function openAddVideo(level, { kind = 'completion', onAdded } = {}) {
  let k = kind, meta = null;
  const s = openSheet({
    size: 'md',
    html: `
      <div class="sheet-head"><h2>Add a video</h2><span class="sheet-sub"></span><button class="btn ghost icon-only" data-a="close">${icon('xmark')}</button></div>
      <div class="sheet-body add-video">
        <label class="lbl">YouTube link</label>
        <input class="field" data-f="url" placeholder="https://www.youtube.com/watch?v=…" spellcheck="false">
        <label class="lbl">Type</label>
        <div class="kind-slot"></div>
        <div class="video-preview"></div>
        <label class="field-row switch-row"><span>Use the video thumbnail as the level thumbnail</span><label class="switch"><input type="checkbox" name="asThumb"><span></span></label></label>
      </div>
      <div class="sheet-foot"><span class="hint">Opens in your browser when clicked.</span><div class="row-btns"><button class="btn" data-a="close">Cancel</button><button class="btn primary" data-a="add" disabled>Add video</button></div></div>`,
  });
  const el = s.el;
  el.querySelector('.sheet-sub').textContent = level.rawName;
  el.querySelectorAll('[data-a=close]').forEach((b) => (b.onclick = () => s.close()));
  el.querySelector('.kind-slot').append(segmented(Object.entries(KINDS).map(([id, label]) => ({ id, label })), k, (id) => (k = id), 'small'));
  const input = el.querySelector('[data-f=url]');
  const add = el.querySelector('[data-a=add]');
  const preview = el.querySelector('.video-preview');
  const update = async () => {
    const url = input.value.trim();
    const valid = /^https?:\/\//i.test(url);
    add.disabled = !valid;
    meta = null;
    const th = valid ? videoThumb(url) : null;
    preview.innerHTML = th ? `<img src="${th}" alt=""><div class="vp-title muted">Looking up title…</div>` : '';
    if (!th) return;
    meta = await call('web.oembed', { url }).catch(() => null);
    if (input.value.trim() !== url) return;
    preview.querySelector('.vp-title').outerHTML = meta ? `<div class="vp-title"><b>${esc(meta.title)}</b><br><span class="muted">${esc(meta.author || '')}</span></div>` : '<div class="vp-title muted">Couldn’t read the title (it’ll show the link instead).</div>';
  };
  input.addEventListener('input', update);
  add.onclick = async () => {
    const url = input.value.trim();
    const v = { url, kind: k, title: meta?.title || '', author: meta?.author || '' };
    setCustom(level.key, { videos: [...levelVideos(level.key), v] });
    if (el.querySelector('input[name=asThumb]').checked && videoThumb(url)) await useAsThumbnail(level, v);
    s.close();
    toast('Video added');
    onAdded?.();
  };
  setTimeout(async () => {
    input.focus();
    // Handy: a YouTube link already on the clipboard gets pasted in.
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (youtubeId(clip)) { input.value = clip; update(); }
    } catch { /* clipboard not available */ }
  }, 40);
}
