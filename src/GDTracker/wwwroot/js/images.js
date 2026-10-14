// Image intake for custom thumbnails and backgrounds: files, clipboard, drag-and-drop from Explorer or a
// web browser, and URLs. Everything is decoded here (WebView2 reads every web format), resized, encoded as
// WebP and handed to the host to store.
import { call } from './rpc.js';

export const imgUrl = (id) => `https://data.gdtracker/images/${encodeURIComponent(id)}`;
export const thumbUrl = (id) => `https://data.gdtracker/images/thumbs/${encodeURIComponent(id)}`;

/** <img> markup for a thumbnail that falls back to the full image if no thumbnail exists. */
export const thumbImg = (id, cls = '', alt = '') =>
  `<img class="${cls}" src="${thumbUrl(id)}" data-full="${imgUrl(id)}" alt="${alt}" loading="lazy" decoding="async" draggable="false" onerror="if(this.dataset.full&&this.src!==this.dataset.full){this.src=this.dataset.full}else{this.onerror=null;this.classList.add('broken')}">`;

const nameFromFile = (n) => String(n || '').replace(/\.[a-z0-9]{2,5}$/i, '');

const FULL_MAX = 2400;
const THUMB_MAX = 800;
const IMAGE_EXT = /\.(png|jpe?g|jfif|gif|webp|avif|bmp|svg|ico|tiff?|heic)(\?|#|$)/i;

async function decode(blob) {
  try {
    return await createImageBitmap(blob);
  } catch {
    // SVG and a few odd formats only decode through <img>.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (!img.naturalWidth) { img.width = 1024; img.height = 1024; }
      return img;
    } catch {
      throw new Error("That file isn't an image GD Tracker can read.");
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }
}

function scaled(src, max) {
  const w = src.naturalWidth || src.width, hgt = src.naturalHeight || src.height;
  const r = Math.min(1, max / Math.max(w, hgt));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * r));
  c.height = Math.max(1, Math.round(hgt * r));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

async function canvasBase64(canvas, quality) {
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', quality));
  if (!blob) throw new Error('Could not encode the image.');
  return blobBase64(blob);
}

function blobBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

/** Stores a Blob/File as an item image and returns its id. */
export async function storeBlob(blob) {
  const src = await decode(blob);
  const [full, thumb] = await Promise.all([canvasBase64(scaled(src, FULL_MAX), 0.9), canvasBase64(scaled(src, THUMB_MAX), 0.84)]);
  src.close?.();
  return call('images.save', { full, thumb, ext: 'webp' });
}

/** Downloads (through the host, so no CORS) and stores an image URL. Web page links use the page's preview image. */
export async function storeUrl(url) {
  let blob;
  if (/^(data|blob):/i.test(url)) blob = await (await fetch(url)).blob();
  else {
    try {
      const r = await call('images.download', { url });
      blob = await (await fetch(r.dataUrl)).blob();
    } catch (e) {
      // Some CDNs refuse our request but allow cross-origin <img> loads; try that before giving up.
      blob = await corsImageBlob(url).catch(() => { throw e; });
    }
  }
  return storeBlob(blob);
}

async function corsImageBlob(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.referrerPolicy = 'no-referrer';
  img.src = url;
  await img.decode();
  const c = scaled(img, FULL_MAX);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  if (!blob) throw new Error('blocked');
  return blob;
}

/** Stores one source from extractSources(). */
export const storeSource = (s) => (s.file ? storeBlob(s.file) : storeUrl(s.url));

export const looksLikeImageUrl = (u) => /^data:image\//i.test(u) || IMAGE_EXT.test(u) ||
  /\/(images?|img|media|photos?|upload|thumbs?|pics?)\//i.test(u) && !/\.(html?|php|aspx?)(\?|$)/i.test(u);

function bestFromSrcset(srcset) {
  let best = null, bestW = 0;
  for (const part of srcset.split(',')) {
    const [u, d] = part.trim().split(/\s+/);
    const w = parseFloat(d) || 1;
    if (u && w >= bestW) { best = u; bestW = w; }
  }
  return best;
}

/** True while dragging something that could contain images (not our own internal drags). */
export function dragHasImages(dt) {
  const types = [...(dt?.types || [])];
  if (types.includes('application/x-gdtracker')) return false;
  return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/html') || types.includes('text/plain');
}

/**
 * Reads everything usable out of a drop / paste. Must be called synchronously inside the event.
 * Returns { sources: [{ file?, url?, name }], pageUrl } — pageUrl is set when the drop was a plain web page link.
 */
export function extractSources(dt) {
  const sources = [];
  const files = [...(dt.files || [])].filter((f) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name));
  if (files.length) return { sources: files.map((f) => ({ file: f, name: nameFromFile(f.name) })), pageUrl: null };

  // Clipboard image data (copy image in a browser) shows up as an item, not a file.
  for (const item of [...(dt.items || [])]) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) sources.push({ file: f, name: '' });
    }
  }
  if (sources.length) return { sources, pageUrl: null };

  let html = '';
  try { html = dt.getData('text/html'); } catch { /* not available */ }
  const uriList = (() => { try { return dt.getData('text/uri-list') || dt.getData('URL'); } catch { return ''; } })();
  const plain = (() => { try { return dt.getData('text/plain'); } catch { return ''; } })();
  const links = (uriList || plain || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#') && /^(https?|data):/i.test(s));

  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const img of doc.querySelectorAll('img')) {
      const set = img.getAttribute('srcset');
      let src = (set && bestFromSrcset(set)) || img.getAttribute('src') || '';
      if (!src) continue;
      try { src = new URL(src, links[0] || undefined).href; } catch { continue; }
      if (/^(https?|data):/i.test(src)) sources.push({ url: src, name: nameFromFile(img.getAttribute('alt') || '') || nameFromUrl(src) });
    }
  }
  if (sources.length) return { sources: dedupe(sources), pageUrl: null };

  const imageLinks = links.filter(looksLikeImageUrl);
  if (imageLinks.length) return { sources: imageLinks.map((u) => ({ url: u, name: nameFromUrl(u) })), pageUrl: null };
  if (links.length === 1) return { sources: [], pageUrl: links[0] };
  return { sources: links.map((u) => ({ url: u, name: '' })), pageUrl: null };
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((s) => (s.url ? !seen.has(s.url) && seen.add(s.url) : true));
}

function nameFromUrl(u) {
  if (u.startsWith('data:')) return '';
  try { return nameFromFile(new URL(u).pathname.split('/').pop() || ''); } catch { return ''; }
}

/** Opens the system file picker for images. */
export function pickImageFiles(multiple = true) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.avif,.heic';
    input.multiple = multiple;
    input.onchange = () => resolve([...input.files].map((f) => ({ file: f, name: nameFromFile(f.name) })));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/** Reads images (or an image URL) from the clipboard via the async Clipboard API. */
export async function readClipboardSources() {
  const out = [];
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) { out.push({ file: await item.getType(type), name: '' }); continue; }
      if (item.types.includes('text/plain')) {
        const text = (await (await item.getType('text/plain')).text()).trim();
        if (/^(https?|data):/i.test(text)) out.push({ url: text, name: nameFromUrl(text) });
      }
    }
  } catch { /* permission or empty clipboard */ }
  return out;
}

