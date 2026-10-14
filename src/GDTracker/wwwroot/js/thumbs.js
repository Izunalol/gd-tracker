// What a level's picture is: the user's custom image, the online thumbnail (Level Thumbnails server),
// or a generated placeholder. Thumbnail elements carry data-thumb-key so they can be refreshed in place.
import { state, settings, custom, displayName, levelDifficulty } from './store.js';
import { imgUrl, thumbUrl } from './images.js';
import { diffInfo } from './data.js';
import { esc, hashHue } from './util.js';

const DATA_HOST = 'https://data.gdtracker/';

/** { src, full, kind } for a level ('custom' | 'online' | 'none'). */
export function thumbSource(level, hd = false) {
  const c = custom(level.key);
  if (c.thumb) return { kind: 'custom', src: hd ? imgUrl(c.thumb) : thumbUrl(c.thumb), full: imgUrl(c.thumb) };
  if (!c.noOnlineThumb && settings().autoThumbs && level.onlineId > 0) {
    const hdUrl = hd ? state.hdThumbs[level.onlineId] : null;
    const small = state.thumbs[level.onlineId];
    if (hdUrl) return { kind: 'online', src: DATA_HOST + hdUrl };
    if (small) return { kind: 'online', src: DATA_HOST + small };
  }
  return { kind: 'none', src: null };
}

/** Inner markup of a thumbnail box. */
export function thumbInner(level, { hd = false } = {}) {
  const t = thumbSource(level, hd);
  const pos = custom(level.key).thumbPos ?? 50;
  if (t.src) {
    return `<img src="${esc(t.src)}" alt="" draggable="false" decoding="async" ${hd ? '' : 'loading="lazy"'} style="object-position:50% ${pos}%" onerror="this.onerror=null;this.remove()">`;
  }
  return placeholder(level);
}

/** A generated cover: hue from the name, tinted by difficulty, with the level's initials. */
export function placeholder(level) {
  const name = displayName(level);
  const hue = hashHue(name);
  const d = diffInfo(levelDifficulty(level));
  const initials = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return `<div class="ph" style="--ph-h:${hue};--ph-d:${d.color}"><span class="ph-grid"></span><span class="ph-txt">${esc(initials)}</span></div>`;
}

export function thumbBox(level, cls = '') {
  return `<div class="thumb ${cls}" data-thumb-key="${esc(level.key)}">${thumbInner(level)}</div>`;
}

/** Re-renders every thumbnail on screen for the given level keys (or all). */
export function refreshThumbs(keys) {
  const sel = keys ? keys.map((k) => `[data-thumb-key="${CSS.escape(k)}"]`).join(',') : '[data-thumb-key]';
  if (!sel) return;
  document.querySelectorAll(sel).forEach((el) => {
    const level = state.levels.get(el.dataset.thumbKey);
    if (level) el.innerHTML = thumbInner(level, { hd: el.classList.contains('hd') });
  });
}

/** Keys of levels using an online id (several keys can share one, e.g. a level and its daily copy). */
export const keysForOnlineId = (id) => [...state.levels.values()].filter((l) => l.onlineId === id).map((l) => l.key);
