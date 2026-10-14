// Small dependency-free SVG charts: columns, line/area, calendar heatmap. Each chart re-renders on resize
// and carries a hover layer (per-bar tooltip, crosshair on lines). Marks use --chart-color (defaults to the
// accent), text and grid use theme tokens.
import { esc } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const observers = new WeakMap();

function mount(el, render) {
  el.classList.add('chart');
  const run = () => {
    if (!el.isConnected) return;
    const w = el.clientWidth;
    if (w > 0 && w !== el._lastW) { el._lastW = w; render(w); }
  };
  el._lastW = 0;
  observers.get(el)?.disconnect();
  const ro = new ResizeObserver(run);
  ro.observe(el);
  observers.set(el, ro);
  run();
}

/** Rounded nice step for ~n ticks over [0, max]. */
function niceTicks(max, n = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

/** Path for a column with a rounded top (4px) and a square base. */
function colPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function tipEl(el) {
  let tip = el.querySelector(':scope > .chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    el.append(tip);
  }
  return tip;
}

function showTip(el, html, x, y) {
  const tip = tipEl(el);
  tip.innerHTML = html;
  tip.classList.add('show');
  const w = tip.offsetWidth, cw = el.clientWidth;
  let left = x + 14;
  if (left + w > cw - 4) left = x - w - 14;
  tip.style.left = Math.max(0, left) + 'px';
  tip.style.top = Math.max(0, y - tip.offsetHeight - 8) + 'px';
}
const hideTip = (el) => el.querySelector(':scope > .chart-tip')?.classList.remove('show');

/**
 * Column chart over a numeric x range.
 * opts: { data: [{ x, y, tip }], xMin, xMax, height, yFmt, xTickFmt, xTicks, onClick(d), highlight(d) }
 */
export function columnChart(el, opts) {
  const { data, height = 220, yFmt = (v) => v.toLocaleString(), xTickFmt = (v) => v, onClick } = opts;
  const xMin = opts.xMin ?? Math.min(...data.map((d) => d.x), 0);
  const xMax = opts.xMax ?? Math.max(...data.map((d) => d.x), 1);
  mount(el, (W) => {
    el.querySelector('svg')?.remove();
    const yMax = opts.yMax ?? Math.max(...data.map((d) => d.y), 0);
    const ticks = niceTicks(yMax);
    const top = ticks[ticks.length - 1] || 1;
    const labelW = Math.max(...ticks.map((t) => String(yFmt(t)).length)) * 7 + 10;
    const pad = { l: labelW, r: 8, t: 10, b: 24 };
    const pw = W - pad.l - pad.r, ph = height - pad.t - pad.b;
    const slots = xMax - xMin + 1;
    const slot = pw / slots;
    const bw = Math.max(1, Math.min(24, slot - (slot > 4 ? 2 : 0.5)));
    const X = (x) => pad.l + (x - xMin) * slot + (slot - bw) / 2;
    const Y = (v) => pad.t + ph - (v / top) * ph;

    let svg = `<svg xmlns="${NS}" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">`;
    for (const t of ticks) {
      svg += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(t)}" y2="${Y(t)}"/>`;
      svg += `<text class="ytick" x="${pad.l - 8}" y="${Y(t) + 4}" text-anchor="end">${esc(yFmt(t))}</text>`;
    }
    const xt = opts.xTicks || autoXTicks(xMin, xMax, pw);
    for (const x of xt) svg += `<text class="xtick" x="${X(x) + bw / 2}" y="${height - 6}" text-anchor="middle">${esc(xTickFmt(x))}</text>`;
    svg += '<g class="marks">';
    data.forEach((d, i) => {
      const hgt = ph - (Y(d.y) - pad.t);
      const cls = opts.highlight?.(d) ? 'mark hl' : 'mark';
      if (d.y > 0) svg += `<path class="${cls}" data-i="${i}" d="${colPath(X(d.x), Y(d.y), bw, hgt, Math.min(4, bw / 2))}"/>`;
    });
    svg += '</g><rect class="hover-band" x="0" y="0" width="0" height="0"/></svg>';
    el.insertAdjacentHTML('afterbegin', svg);
    const s = el.querySelector('svg');
    const band = s.querySelector('.hover-band');
    const byX = new Map(data.map((d, i) => [d.x, i]));
    const nearest = (mx) => {
      const x = Math.round((mx - pad.l - slot / 2) / slot) + xMin;
      // Snap to the closest x that has data, within a few slots.
      for (let off = 0; off <= Math.max(2, 8 / slot); off++) {
        if (byX.has(x - off)) return byX.get(x - off);
        if (byX.has(x + off)) return byX.get(x + off);
      }
      return -1;
    };
    s.addEventListener('mousemove', (e) => {
      const r = s.getBoundingClientRect();
      const i = nearest(e.clientX - r.left);
      s.querySelectorAll('.mark.on').forEach((m) => m.classList.remove('on'));
      if (i < 0) { hideTip(el); band.setAttribute('width', 0); return; }
      const d = data[i];
      s.querySelector(`.mark[data-i="${i}"]`)?.classList.add('on');
      band.setAttribute('x', X(d.x) - Math.max(0, (slot - bw) / 2));
      band.setAttribute('y', pad.t);
      band.setAttribute('width', Math.max(slot, bw));
      band.setAttribute('height', ph);
      showTip(el, d.tip ?? `${esc(xTickFmt(d.x))}: <b>${esc(yFmt(d.y))}</b>`, X(d.x) + bw / 2, Y(d.y));
      s.style.cursor = onClick ? 'pointer' : '';
    });
    s.addEventListener('mouseleave', () => { hideTip(el); band.setAttribute('width', 0); s.querySelectorAll('.mark.on').forEach((m) => m.classList.remove('on')); });
    if (onClick) s.addEventListener('click', (e) => {
      const r = s.getBoundingClientRect();
      const i = nearest(e.clientX - r.left);
      if (i >= 0) onClick(data[i]);
    });
  });
}

function autoXTicks(min, max, pw) {
  const span = max - min;
  const want = Math.max(2, Math.floor(pw / 60));
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find((s) => span / s <= want) || Math.ceil(span / want);
  const ticks = [];
  for (let x = Math.ceil(min / step) * step; x <= max; x += step) ticks.push(x);
  return ticks;
}

/**
 * Line chart (optionally with an area wash and dots).
 * opts: { points: [{ x, y, tip }], height, yMin, yMax, yFmt, xFmt, xTicks: [x], area, dots, step }
 * x may be any number (timestamps, indices).
 */
export function lineChart(el, opts) {
  const { points, height = 220, yFmt = (v) => v, xFmt = (v) => v, area = true, dots = true } = opts;
  mount(el, (W) => {
    el.querySelector('svg')?.remove();
    if (!points.length) return;
    const ys = points.map((p) => p.y);
    const yMin = opts.yMin ?? Math.min(0, ...ys);
    let yMax = opts.yMax ?? Math.max(...ys);
    const ticks = opts.yTicks || niceTicks(yMax - yMin).map((t) => t + yMin);
    if (opts.yMax == null) yMax = ticks[ticks.length - 1];
    const labelW = Math.max(...ticks.map((t) => String(yFmt(t)).length)) * 7 + 10;
    const pad = { l: labelW, r: 14, t: 12, b: 24 };
    const pw = W - pad.l - pad.r, ph = height - pad.t - pad.b;
    const xs = points.map((p) => p.x);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const X = (x) => pad.l + (xMax === xMin ? pw / 2 : ((x - xMin) / (xMax - xMin)) * pw);
    const Y = (v) => pad.t + ph - ((v - yMin) / (yMax - yMin || 1)) * ph;

    let svg = `<svg xmlns="${NS}" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">`;
    for (const t of ticks) {
      svg += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(t)}" y2="${Y(t)}"/>`;
      svg += `<text class="ytick" x="${pad.l - 8}" y="${Y(t) + 4}" text-anchor="end">${esc(yFmt(t))}</text>`;
    }
    const xt = opts.xTicks || pickXTicks(points, pw);
    for (const x of xt) svg += `<text class="xtick" x="${X(x)}" y="${height - 6}" text-anchor="middle">${esc(xFmt(x))}</text>`;
    const pts = points.map((p) => [X(p.x), Y(p.y)]);
    let d = '';
    pts.forEach(([x, y], i) => {
      if (i === 0) d += `M${x},${y}`;
      else if (opts.step) d += `H${x}V${y}`;
      else d += `L${x},${y}`;
    });
    if (area && pts.length > 1) svg += `<path class="area" d="${d}V${Y(yMin)}H${pts[0][0]}Z"/>`;
    svg += `<path class="line" d="${d}"/>`;
    if (dots && pts.length <= 120) {
      points.forEach((p, i) => {
        svg += `<circle class="dot ${p.hl ? 'hl' : ''}" cx="${pts[i][0]}" cy="${pts[i][1]}" r="${p.hl ? 5 : 3.5}"/>`;
      });
    }
    svg += `<line class="crosshair" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ph}" visibility="hidden"/><circle class="focus" r="5" visibility="hidden"/></svg>`;
    el.insertAdjacentHTML('afterbegin', svg);
    const s = el.querySelector('svg');
    const ch = s.querySelector('.crosshair'), focus = s.querySelector('.focus');
    s.addEventListener('mousemove', (e) => {
      const r = s.getBoundingClientRect();
      const mx = e.clientX - r.left;
      let best = 0;
      pts.forEach(([x], i) => { if (Math.abs(x - mx) < Math.abs(pts[best][0] - mx)) best = i; });
      const [x, y] = pts[best];
      ch.setAttribute('x1', x); ch.setAttribute('x2', x); ch.setAttribute('visibility', 'visible');
      focus.setAttribute('cx', x); focus.setAttribute('cy', y); focus.setAttribute('visibility', 'visible');
      const p = points[best];
      showTip(el, p.tip ?? `${esc(xFmt(p.x))}: <b>${esc(yFmt(p.y))}</b>`, x, y);
    });
    s.addEventListener('mouseleave', () => { hideTip(el); ch.setAttribute('visibility', 'hidden'); focus.setAttribute('visibility', 'hidden'); });
    if (opts.onClick) s.addEventListener('click', (e) => {
      const r = s.getBoundingClientRect();
      const mx = e.clientX - r.left;
      let best = 0;
      pts.forEach(([x], i) => { if (Math.abs(x - mx) < Math.abs(pts[best][0] - mx)) best = i; });
      opts.onClick(points[best]);
    });
  });
}

function pickXTicks(points, pw) {
  const n = Math.max(2, Math.min(points.length, Math.floor(pw / 90)));
  if (points.length <= n) return points.map((p) => p.x);
  const out = [];
  for (let i = 0; i < n; i++) out.push(points[Math.round((i * (points.length - 1)) / (n - 1))].x);
  return [...new Set(out)];
}

/**
 * GitHub-style calendar: one column per week, one row per weekday, cells shaded by value
 * (single-hue sequential: the chart colour at increasing opacity).
 * opts: { values: Map<dayStartMs, number>, weeks, tip(dayMs, v), onClick(dayMs) }
 */
export function calendarHeatmap(el, opts) {
  const { values, weeks = 53 } = opts;
  mount(el, (W) => {
    el.querySelector('svg')?.remove();
    const labelW = 28, gap = 3;
    const cell = Math.max(8, Math.min(18, Math.floor((W - labelW) / weeks) - gap));
    const H = 7 * (cell + gap) + 20;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    // Weeks start on Monday.
    const dow = (today.getDay() + 6) % 7;
    const start = new Date(today); start.setDate(start.getDate() - dow - (weeks - 1) * 7);
    const max = Math.max(1, ...values.values());
    const level = (v) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
    let svg = `<svg xmlns="${NS}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
    ['Mon', '', 'Wed', '', 'Fri', '', ''].forEach((d, i) => {
      if (d) svg += `<text class="ytick" x="0" y="${16 + i * (cell + gap) + cell - 2}">${d}</text>`;
    });
    let lastMonth = -1;
    const cells = [];
    const d = new Date(start);
    for (let w = 0; w < weeks; w++) {
      for (let r = 0; r < 7; r++) {
        if (d > today) break;
        const t = d.getTime();
        const v = values.get(t) || 0;
        const x = labelW + w * (cell + gap), y = 16 + r * (cell + gap);
        if (r === 0 && d.getMonth() !== lastMonth && w < weeks - 1) {
          lastMonth = d.getMonth();
          svg += `<text class="xtick" x="${x}" y="10">${d.toLocaleDateString(undefined, { month: 'short' })}</text>`;
        }
        cells.push({ t, v });
        svg += `<rect class="hm hm${level(v)}" data-i="${cells.length - 1}" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3"/>`;
        d.setDate(d.getDate() + 1);
      }
    }
    svg += '</svg>';
    el.insertAdjacentHTML('afterbegin', svg);
    const s = el.querySelector('svg');
    s.addEventListener('mousemove', (e) => {
      const rect = e.target.closest('rect.hm');
      if (!rect) { hideTip(el); return; }
      const c = cells[+rect.dataset.i];
      const r = s.getBoundingClientRect(), rr = rect.getBoundingClientRect();
      showTip(el, opts.tip(c.t, c.v), rr.left - r.left + rr.width / 2, rr.top - r.top);
    });
    s.addEventListener('mouseleave', () => hideTip(el));
    if (opts.onClick) s.addEventListener('click', (e) => {
      const rect = e.target.closest('rect.hm');
      if (rect) opts.onClick(cells[+rect.dataset.i].t);
    });
  });
}

/** Thin horizontal meter (e.g. best % on a card). */
export const meter = (frac, cls = '') => `<div class="meter ${cls}"><i style="width:${Math.max(0, Math.min(1, frac)) * 100}%"></i></div>`;
