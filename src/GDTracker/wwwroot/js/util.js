// Small shared helpers: escaping, ids, number/time/date formatting, CSV.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const plural = (n, one, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** A Date as local YYYY-MM-DD. */
export const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Local midnight (ms) of a unix-seconds timestamp. */
export const dayStart = (unix) => { const d = new Date(unix * 1000); d.setHours(0, 0, 0, 0); return d.getTime(); };

// ---------------------------------------------------------------- formatting
// Formats follow the user's settings; main.js calls setFormats() whenever they change.

const fmt = { time: 'hm', date: 'relative', clock: '24h' };
export function setFormats(s) {
  fmt.time = s.timeFormat || 'hm';
  fmt.date = s.dateFormat || 'relative';
  fmt.clock = s.clockFormat || 'auto';
}

const nf = new Intl.NumberFormat();
const nfCompact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
export const num = (n) => (n == null || isNaN(n) ? '–' : nf.format(Math.round(n)));
export const compact = (n) => (n == null || isNaN(n) ? '–' : n >= 10000 ? nfCompact.format(n) : nf.format(Math.round(n)));
export const pct = (v, digits = 0) => (v == null || isNaN(v) ? '–' : `${(v * 100).toFixed(digits)}%`);

/** Playtime in seconds → "12h 05m" / "12.1h" / "12:05:33" depending on the time format setting. */
export function duration(sec, style = fmt.time) {
  if (sec == null || isNaN(sec)) return '–';
  sec = Math.max(0, sec);
  if (style === 'decimal') {
    if (sec < 60) return `${Math.round(sec)}s`;
    if (sec < 3600) return `${(sec / 60).toFixed(sec < 600 ? 1 : 0)}m`;
    return `${(sec / 3600).toFixed(sec < 36000 ? 1 : 0)}h`;
  }
  if (style === 'clock') {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  if (sec < 60) return `${Math.round(sec)}s`;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h === 0) return `${m}m ${String(Math.floor(sec % 60)).padStart(2, '0')}s`;
  if (h >= 100) return `${nf.format(h)}h`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dateShortFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmts = {};
function timeFmt() {
  const key = fmt.clock;
  if (!timeFmts[key]) {
    timeFmts[key] = new Intl.DateTimeFormat(undefined, key === 'auto' ? { hour: 'numeric', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit', hour12: key === '12h' });
  }
  return timeFmts[key];
}

export const absDate = (unix) => (unix ? dateFmt.format(new Date(unix * 1000)) : '–');
export const shortDate = (unix) => {
  if (!unix) return '–';
  const d = new Date(unix * 1000);
  return d.getFullYear() === new Date().getFullYear() ? dateShortFmt.format(d) : dateFmt.format(d);
};
export const dayLabel = (unix) => weekdayFmt.format(new Date(unix * 1000));
export const clockTime = (unix) => (unix ? timeFmt().format(new Date(unix * 1000)) : '');
export const dateTime = (unix) => (unix ? `${shortDate(unix)}, ${clockTime(unix)}` : '–');

export function relative(unix) {
  if (!unix) return 'never';
  const diff = Date.now() / 1000 - unix;
  if (diff < 90) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.floor((today.getTime() / 1000 - dayStart(unix) / 1000) / 86400 + 0.01);
  if (days <= 0) return `${Math.round(diff / 3600)}h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30.4)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

/** Date per the user's preference (relative "3 days ago" or absolute "11 Oct 2026"). */
export const when = (unix) => (fmt.date === 'relative' ? relative(unix) : shortDate(unix));

// ---------------------------------------------------------------- colour

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

/** Readable text colour (#000/#fff) on top of a background hex. */
export function inkOn(hex) {
  const c = hexToRgb(hex);
  if (!c) return '#fff';
  const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  return lum > 0.6 ? '#111' : '#fff';
}

/** Stable pleasant hue for a string (used for placeholder thumbnails). */
export function hashHue(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Math.abs(h) % 360;
}

// ---------------------------------------------------------------- CSV

export function toCSV(rows) {
  return rows.map((r) => r.map((v) => {
    const s = String(v ?? '');
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}
