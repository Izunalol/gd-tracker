// Reusable UI pieces: sheets, alerts, menus, popovers, toasts, segmented controls, tag fields, suggestion lists.
import { esc } from './util.js';
import { icon } from './icons.js';

const layers = () => document.getElementById('layers');

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ---------------------------------------------------------------- sheets

const stack = [];
export const topSheet = () => stack[stack.length - 1] || null;
export const sheetOpen = () => stack.length > 0;

/**
 * Opens a modal sheet. `onRequestClose` decides what Esc / backdrop clicks do (default: close).
 * Returns { el, close(), requestClose() }.
 */
export function openSheet({ html, cls = '', size = 'md', onRequestClose, onClose, backdropCloses = true }) {
  closeMenu();
  const wrap = h(`<div class="layer"><div class="backdrop"></div><div class="sheet sheet-${size} ${cls}" role="dialog" aria-modal="true">${html}</div></div>`);
  layers().append(wrap);
  const el = wrap.querySelector('.sheet');
  const api = {
    el,
    closed: false,
    close() {
      if (api.closed) return;
      api.closed = true;
      stack.splice(stack.indexOf(api), 1);
      wrap.classList.remove('open');
      wrap.classList.add('closing');
      setTimeout(() => wrap.remove(), 180);
      onClose?.();
    },
    requestClose() { onRequestClose ? onRequestClose() : api.close(); },
  };
  stack.push(api);
  if (backdropCloses) wrap.querySelector('.backdrop').addEventListener('mousedown', () => api.requestClose());
  requestAnimationFrame(() => wrap.classList.add('open'));
  return api;
}

/** Apple-style alert. buttons: [{ label, value, style: 'cancel' | 'destructive' | 'default' }]. Resolves with value. */
export function alertDialog({ title, message = '', buttons = [{ label: 'OK', value: true, style: 'default' }], iconHtml = '' }) {
  return new Promise((resolve) => {
    const s = openSheet({
      size: 'alert',
      cls: 'alert',
      backdropCloses: false,
      html: `
        <div class="alert-icon">${iconHtml || '<img src="assets/icon.png" alt="">'}</div>
        <div class="alert-title">${esc(title)}</div>
        ${message ? `<div class="alert-msg">${message}</div>` : ''}
        <div class="alert-buttons ${buttons.length > 2 ? 'stacked' : ''}">
          ${buttons.map((b, i) => `<button class="btn ${b.style === 'default' ? 'primary' : b.style === 'destructive' ? 'danger' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}
        </div>`,
      onRequestClose: () => finish(buttons.find((b) => b.style === 'cancel')?.value ?? null),
    });
    const finish = (v) => { s.close(); resolve(v); };
    s.el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => finish(buttons[+b.dataset.i].value)));
    s.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const d = buttons.find((b) => b.style === 'default') ?? buttons.find((b) => b.style === 'destructive');
        if (d) finish(d.value);
      }
    });
    const def = s.el.querySelector('.btn.primary') || s.el.querySelector('.btn.danger') || s.el.querySelector('.btn');
    setTimeout(() => def?.focus(), 30);
  });
}

export const confirmDialog = (title, message, okLabel = 'OK', destructive = false) => alertDialog({
  title, message,
  buttons: [{ label: 'Cancel', value: false, style: 'cancel' }, { label: okLabel, value: true, style: destructive ? 'destructive' : 'default' }],
});

/** Single-field prompt. Resolves with the trimmed string, or null when cancelled. */
export function promptDialog({ title, message = '', value = '', placeholder = '', okLabel = 'OK' }) {
  return new Promise((resolve) => {
    const s = openSheet({
      size: 'alert',
      cls: 'alert',
      backdropCloses: false,
      html: `
        <div class="alert-title">${esc(title)}</div>
        ${message ? `<div class="alert-msg">${message}</div>` : ''}
        <input class="field alert-input" value="${esc(value)}" placeholder="${esc(placeholder)}" spellcheck="false">
        <div class="alert-buttons">
          <button class="btn" data-a="cancel">Cancel</button>
          <button class="btn primary" data-a="ok">${esc(okLabel)}</button>
        </div>`,
      onRequestClose: () => finish(null),
    });
    const input = s.el.querySelector('input');
    const finish = (v) => { s.close(); resolve(v); };
    s.el.querySelector('[data-a=cancel]').onclick = () => finish(null);
    s.el.querySelector('[data-a=ok]').onclick = () => finish(input.value.trim());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(input.value.trim()); } });
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

// ---------------------------------------------------------------- menus

let menuRoot = null;
let menuCleanup = null;

export function closeMenu() {
  if (!menuRoot) return false;
  menuRoot.remove();
  menuRoot = null;
  menuCleanup?.();
  menuCleanup = null;
  return true;
}
export const menuOpen = () => !!menuRoot;

/**
 * items: [{ label, icon, shortcut, action, danger, disabled, checked, submenu: [...], swatch } | '-' | { header }]
 * at: { x, y } or an anchor element (menu opens below it).
 */
export function showMenu(items, at, { align = 'start', minWidth } = {}) {
  closeMenu();
  closePopover();
  menuRoot = document.createElement('div');
  menuRoot.className = 'menu-root';
  layers().append(menuRoot);
  const first = buildMenu(items, 0);
  if (minWidth) first.style.minWidth = minWidth + 'px';
  menuRoot.append(first);
  let x, y, flipY = null;
  if (at instanceof Element) {
    const r = at.getBoundingClientRect();
    x = align === 'end' ? r.right : r.left;
    y = r.bottom + 4;
    flipY = r.top - 4;
    if (align === 'end') first.dataset.alignEnd = '1';
  } else ({ x, y } = at);
  place(first, x, y, flipY);
  first.focus();

  // Only clicks on an actual menu panel count as inside; the root layer itself is click-through.
  const onDown = (e) => {
    if (e.target.closest?.('.menu')) return;
    closeMenu();
    // Like a native menu, the click that dismisses it doesn't also act on what's underneath.
    if (e.button === 0) {
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallow, true), 500);
    }
  };
  const onKey = (e) => menuKey(e);
  const onBlur = () => closeMenu();
  setTimeout(() => {
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
  });
  menuCleanup = () => {
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('resize', onBlur);
  };
}

function place(el, x, y, flipY) {
  const w = el.offsetWidth, hgt = el.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  if (el.dataset.alignEnd) x -= w;
  if (x + w > vw - 6) x = Math.max(6, vw - w - 6);
  if (y + hgt > vh - 6) y = flipY != null && flipY - hgt > 6 ? flipY - hgt : Math.max(6, vh - hgt - 6);
  el.style.left = Math.max(6, x) + 'px';
  el.style.top = y + 'px';
}

function buildMenu(items, depth) {
  const el = document.createElement('div');
  el.className = 'menu';
  el.tabIndex = -1;
  el.dataset.depth = depth;
  const hasChecks = items.some((i) => i && typeof i === 'object' && 'checked' in i);
  items.forEach((it) => {
    if (it === '-') { el.append(h('<div class="menu-sep"></div>')); return; }
    if (it.header) { el.append(h(`<div class="menu-header">${esc(it.header)}</div>`)); return; }
    const row = h(`<div class="mi ${it.danger ? 'danger' : ''} ${it.disabled ? 'disabled' : ''}" role="menuitem">
      ${hasChecks ? `<span class="mi-check">${it.checked ? icon('check') : ''}</span>` : ''}
      ${it.swatch ? `<span class="mi-swatch" style="background:${it.swatch}"></span>` : it.emoji ? `<span class="mi-emoji">${it.emoji}</span>` : it.icon ? `<span class="mi-icon">${icon(it.icon)}</span>` : ''}
      <span class="mi-label">${esc(it.label)}</span>
      ${it.shortcut ? `<span class="mi-key">${esc(it.shortcut)}</span>` : ''}
      ${it.submenu ? `<span class="mi-sub">${icon('chevronRight')}</span>` : ''}
    </div>`);
    row._item = it;
    row.addEventListener('mouseenter', () => activate(el, row));
    row.addEventListener('mouseup', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      choose(row);
    });
    el.append(row);
  });
  return el;
}

function activate(menu, row) {
  menu.querySelectorAll(':scope > .mi.active').forEach((r) => r.classList.remove('active'));
  // Close deeper submenus.
  const depth = +menu.dataset.depth;
  menuRoot.querySelectorAll('.menu').forEach((m) => { if (+m.dataset.depth > depth) m.remove(); });
  if (!row) return;
  row.classList.add('active');
  const it = row._item;
  if (it.submenu && !it.disabled) {
    const sub = buildMenu(it.submenu, depth + 1);
    menuRoot.append(sub);
    const r = row.getBoundingClientRect();
    let x = r.right + 2;
    if (x + sub.offsetWidth > window.innerWidth - 6) x = r.left - sub.offsetWidth - 2;
    place(sub, x, r.top - 5, null);
  }
}

function choose(row) {
  const it = row._item;
  if (!it || it.disabled) return;
  if (it.submenu) { activate(row.parentElement, row); return; }
  closeMenu();
  it.action?.();
}

function menuKey(e) {
  if (!menuRoot) return;
  const menus = [...menuRoot.querySelectorAll('.menu')];
  const menu = menus[menus.length - 1];
  const rows = [...menu.querySelectorAll(':scope > .mi:not(.disabled)')];
  const cur = rows.findIndex((r) => r.classList.contains('active'));
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (e.key === 'Escape') {
    stop();
    if (menus.length > 1) { menu.remove(); return; }
    closeMenu();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    stop();
    const n = rows.length;
    if (!n) return;
    const next = e.key === 'ArrowDown' ? (cur + 1) % n : (cur - 1 + n) % n;
    menu.querySelectorAll(':scope > .mi.active').forEach((r) => r.classList.remove('active'));
    rows[next].classList.add('active');
  } else if (e.key === 'ArrowRight' && cur >= 0 && rows[cur]._item.submenu) {
    stop();
    activate(menu, rows[cur]);
    const sub = menuRoot.querySelector(`.menu[data-depth="${+menu.dataset.depth + 1}"] .mi`);
    sub?.classList.add('active');
  } else if (e.key === 'ArrowLeft' && menus.length > 1) {
    stop();
    menu.remove();
  } else if (e.key === 'Enter' && cur >= 0) {
    stop();
    choose(rows[cur]);
  }
}

// ---------------------------------------------------------------- popovers

let pop = null;
export function closePopover() {
  if (!pop) return false;
  const p = pop;
  pop = null;
  p.cleanup();
  p.el.classList.add('closing');
  setTimeout(() => p.el.remove(), 120);
  p.onClose?.();
  return true;
}
export const popoverOpen = () => !!pop;

/** Shows `content` (element) in a popover with an arrow pointing at `anchor`. */
export function popover(anchor, content, { onClose, width } = {}) {
  closePopover();
  closeMenu();
  const el = h('<div class="popover"><div class="pop-arrow"></div><div class="pop-body"></div></div>');
  if (width) el.style.width = width + 'px';
  el.querySelector('.pop-body').append(content);
  layers().append(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  let x = r.left + r.width / 2 - w / 2;
  x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
  el.style.left = x + 'px';
  el.style.top = r.bottom + 10 + 'px';
  el.querySelector('.pop-arrow').style.left = r.left + r.width / 2 - x + 'px';
  const maxH = window.innerHeight - r.bottom - 24;
  el.querySelector('.pop-body').style.maxHeight = maxH + 'px';
  anchor.classList.add('pressed');

  const onDown = (e) => {
    if (el.contains(e.target) || anchor.contains(e.target) || e.target.closest('.menu-root, .suggest')) return;
    closePopover();
  };
  const onKey = (e) => { if (e.key === 'Escape' && !menuOpen()) { e.stopPropagation(); closePopover(); } };
  setTimeout(() => {
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
  });
  pop = {
    el, onClose,
    cleanup() {
      anchor.classList.remove('pressed');
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    },
  };
  return el;
}

// ---------------------------------------------------------------- toasts

/** Bottom-centre capsule. Returns { update(text), close() }. */
export function toast(text, { action, onAction, timeout = 4500, kind = '', spinner = false } = {}) {
  const host = document.getElementById('toasts');
  const el = h(`<div class="toast ${kind}">${spinner ? '<span class="spinner"></span>' : ''}<span class="toast-text"></span>${action ? `<button class="toast-action">${esc(action)}</button>` : ''}</div>`);
  el.querySelector('.toast-text').textContent = text;
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  requestAnimationFrame(() => el.classList.add('show'));
  let timer;
  const api = {
    update(t) { el.querySelector('.toast-text').textContent = t; return api; },
    done(t, ms = 3000) {
      el.querySelector('.spinner')?.remove();
      if (t) api.update(t);
      clearTimeout(timer);
      timer = setTimeout(api.close, ms);
      return api;
    },
    close() {
      clearTimeout(timer);
      el.classList.remove('show');
      setTimeout(() => el.remove(), 250);
    },
  };
  if (action) el.querySelector('.toast-action').onclick = () => { api.close(); onAction?.(); };
  if (timeout) timer = setTimeout(api.close, timeout);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { if (timeout && !el.querySelector('.spinner')) timer = setTimeout(api.close, 2000); });
  return api;
}

// ---------------------------------------------------------------- controls

/** options: [{ id, label, icon }]. Returns element; onChange(id). */
export function segmented(options, value, onChange, cls = '') {
  const el = h(`<div class="seg ${cls}" role="tablist">${options.map((o) => `
    <button class="seg-btn ${o.id === value ? 'on' : ''}" data-id="${esc(o.id)}" role="tab" title="${esc(o.title || o.label || '')}">
      ${o.icon ? icon(o.icon) : ''}${o.label ? `<span>${esc(o.label)}</span>` : ''}${o.count != null ? `<span class="seg-count">${o.count.toLocaleString()}</span>` : ''}
    </button>`).join('')}</div>`);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    el.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('on', x === b));
    onChange(b.dataset.id);
  });
  return el;
}

export const switchHtml = (name, on) => `<label class="switch"><input type="checkbox" ${name ? `name="${esc(name)}"` : ''} ${on ? 'checked' : ''}><span></span></label>`;

export const spinnerHtml = () => '<span class="spinner"></span>';

// ---------------------------------------------------------------- suggestions & tag field

/**
 * Attaches an autocomplete list to an input.
 * getValues() → strings. onPick(value) defaults to filling the input.
 */
export function attachSuggest(input, getValues, { onPick, showOnFocus = false, max = 8, render } = {}) {
  let box = null, list = [], idx = -1;
  const close = () => { box?.remove(); box = null; idx = -1; };
  const pick = (v) => {
    close();
    if (onPick) onPick(v);
    else { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }
  };
  const update = () => {
    const q = input.value.trim().toLowerCase();
    if (!q && !showOnFocus) { close(); return; }
    const all = getValues();
    list = all.filter((v) => v.toLowerCase() !== q && v.toLowerCase().includes(q))
      .sort((a, b) => (b.toLowerCase().startsWith(q) - a.toLowerCase().startsWith(q)))
      .slice(0, max);
    if (!list.length) { close(); return; }
    if (!box) {
      box = h('<div class="suggest"></div>');
      layers().append(box);
      box.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const r = e.target.closest('[data-i]');
        if (r) pick(list[+r.dataset.i]);
      });
    }
    idx = Math.min(idx, list.length - 1);
    box.innerHTML = list.map((v, i) => `<div class="sg ${i === idx ? 'active' : ''}" data-i="${i}">${render ? render(v) : esc(v)}</div>`).join('');
    const r = input.getBoundingClientRect();
    box.style.left = r.left + 'px';
    box.style.minWidth = Math.max(180, r.width) + 'px';
    const below = window.innerHeight - r.bottom;
    if (below < 220 && r.top > below) { box.style.top = ''; box.style.bottom = window.innerHeight - r.top + 4 + 'px'; }
    else { box.style.bottom = ''; box.style.top = r.bottom + 4 + 'px'; }
  };
  input.addEventListener('input', () => { idx = -1; update(); });
  input.addEventListener('focus', () => { if (showOnFocus) update(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (!box) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      idx = e.key === 'ArrowDown' ? (idx + 1) % list.length : (idx <= 0 ? list.length - 1 : idx - 1);
      update();
    } else if ((e.key === 'Enter' || e.key === 'Tab') && idx >= 0) {
      e.preventDefault();
      e.stopPropagation();
      pick(list[idx]);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });
  return { close, isOpen: () => !!box };
}

/**
 * Token field for tags. colorOf(tag) gives each chip its dot colour.
 * Returns { el, get value(), set value(v), focus() }.
 */
export function tagField({ value = [], placeholder = 'Add tags…', suggestions = () => [], colorOf = () => '#8e8e93', onChange } = {}) {
  let tags = [...value];
  const el = h(`<div class="tagfield"><input class="tf-input" spellcheck="false"></div>`);
  const input = el.querySelector('input');
  const emit = () => onChange?.(tags.slice());
  const render = () => {
    el.querySelectorAll('.chip').forEach((c) => c.remove());
    for (const t of tags) {
      const chip = h(`<span class="chip"><i style="background:${colorOf(t)}"></i>${esc(t)}<button tabindex="-1" title="Remove">${icon('xmark')}</button></span>`);
      chip.querySelector('button').onclick = (e) => { e.stopPropagation(); tags = tags.filter((x) => x !== t); render(); emit(); };
      el.insertBefore(chip, input);
    }
    input.placeholder = tags.length ? '' : placeholder;
  };
  const add = (raw) => {
    let changed = false;
    for (const part of raw.split(/[,;\n]/)) {
      const t = part.replace(/^#/, '').trim();
      if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) { tags.push(t); changed = true; }
    }
    input.value = '';
    if (changed) { render(); emit(); }
  };
  const sg = attachSuggest(input, () => suggestions().filter((s) => !tags.includes(s)), {
    onPick: (v) => { add(v); input.focus(); },
    showOnFocus: true,
    render: (v) => `<i class="sg-dot" style="background:${colorOf(v)}"></i>${esc(v)}`,
  });
  input.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',' || e.key === 'Tab') && input.value.trim() && !sg.isOpen()) {
      e.preventDefault();
      add(input.value);
    } else if (e.key === 'Enter' && input.value.trim()) {
      // handled by suggest
    } else if (e.key === 'Backspace' && !input.value && tags.length) {
      tags.pop(); render(); emit();
    }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (input.value.trim() && document.activeElement !== input) add(input.value); }, 150));
  input.addEventListener('paste', (e) => {
    const t = e.clipboardData.getData('text');
    if (/[,;\n]/.test(t)) { e.preventDefault(); add(t); }
  });
  el.addEventListener('mousedown', (e) => { if (e.target === el) { e.preventDefault(); input.focus(); } });
  render();
  return {
    el,
    get value() { if (input.value.trim()) add(input.value); return tags.slice(); },
    set value(v) { tags = [...v]; render(); },
    focus: () => input.focus(),
  };
}


/**
 * Enjoyment rating: five stars with half steps, value 0–10 (0 = unrated). Click the current value
 * again to clear it. Returns an element with a .value property.
 */
export function ratingControl(value, onChange, { size = '' } = {}) {
  const el = h(`<div class="rating ${size}" role="slider" aria-label="Enjoyment" aria-valuemin="0" aria-valuemax="10" tabindex="0"></div>`);
  let v = +value || 0;
  const render = (hover = 0) => {
    const shown = hover || v;
    el.innerHTML = [1, 2, 3, 4, 5].map((n) => {
      const fill = shown >= n * 2 ? 'full' : shown === n * 2 - 1 ? 'half' : '';
      return `<span class="star ${fill} ${hover ? 'hover' : ''}" data-n="${n}">${icon('star')}<span class="star-fill">${icon('starFill')}</span></span>`;
    }).join('') + `<span class="rating-val">${shown ? (shown / 2).toFixed(shown % 2 ? 1 : 0) : ''}</span>`;
    el.setAttribute('aria-valuenow', v);
  };
  const valueAt = (e) => {
    const s = e.target.closest('.star');
    if (!s) return 0;
    const r = s.getBoundingClientRect();
    return +s.dataset.n * 2 - (e.clientX - r.left < r.width / 2 ? 1 : 0);
  };
  el.addEventListener('click', (e) => {
    const n = valueAt(e);
    if (!n) return;
    v = v === n ? 0 : n;
    render();
    onChange?.(v);
  });
  el.addEventListener('mousemove', (e) => { const n = valueAt(e); if (n) render(n); });
  el.addEventListener('mouseleave', () => render());
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      v = Math.max(0, Math.min(10, v + (e.key === 'ArrowRight' ? 1 : -1)));
      render(); onChange?.(v);
    }
  });
  render();
  Object.defineProperty(el, 'value', { get: () => v, set: (n) => { v = +n || 0; render(); } });
  return el;
}

/** Read-only stars for a 0–10 value. */
export function starsHtml(value) {
  const v = +value || 0;
  return `<span class="stars-ro">${[1, 2, 3, 4, 5].map((n) => `<span class="star ${v >= n * 2 ? 'full' : v === n * 2 - 1 ? 'half' : ''}">${icon('star')}<span class="star-fill">${icon('starFill')}</span></span>`).join('')}</span>`;
}
