// Per-level customisation: thumbnail (file / paste / URL / drop / online), focal point, display name,
// colour, tags, notes, favourite and hidden. Changes save as you make them.
import { state, custom, setCustom, allTags, tagColor, levelInfo, LIST_NAMES, autoListRank, on } from '../store.js';
import { LENGTHS } from '../data.js';
import { openLinkEditor } from './links.js';
import { thumbInner, thumbSource } from '../thumbs.js';
import { icon } from '../icons.js';
import { openSheet, toast, promptDialog, tagField, switchHtml, ratingControl } from '../ui.js';
import { esc } from '../util.js';
import { pickImageFiles, readClipboardSources, storeSource, extractSources, dragHasImages } from '../images.js';
import { call } from '../rpc.js';

export const SWATCHES = ['#3d9df3', '#2ec4b6', '#48d16c', '#a3e635', '#f2c230', '#f27d30', '#f2508c', '#e11d48', '#c45bf2', '#7c6cf2', '#94a3b8', '#ffffff'];

/** Context-menu items shared by gallery cards and the level page. */
export function levelMenuItems(level, { open = false } = {}) {
  const c = custom(level.key);
  const info = levelInfo(level);
  return [
    ...(open ? [{ label: 'Open', icon: 'chevronRight', action: () => (location.hash = `#/level/${encodeURIComponent(level.key)}`) }, '-'] : []),
    { label: c.fav ? 'Remove from favourites' : 'Add to favourites', icon: c.fav ? 'starFill' : 'star', action: () => setCustom(level.key, { fav: !c.fav }) },
    { label: 'Change thumbnail…', icon: 'image', action: () => pickThumbnail(level) },
    { label: 'Customise…', icon: 'palette', action: () => openCustomize(level) },
    { label: level.isGroup ? `Linked copies (${level.members.length})…` : 'Link copies…', icon: 'link', action: () => openLinkEditor(level) },
    { label: c.hidden ? 'Show in gallery' : 'Hide from gallery', icon: c.hidden ? 'eye' : 'eyeSlash', action: () => setCustom(level.key, { hidden: !c.hidden }) },
    '-',
    ...(level.type !== 'editor' && level.id != null ? [
      { label: 'Copy level ID', icon: 'duplicate', action: () => { navigator.clipboard.writeText(String(level.id)); toast(`Copied ${level.id}`); } },
    ] : []),
    ...(level.lookupId ? [
      { label: 'View on GDBrowser', icon: 'globe', action: () => call('app.openUrl', { url: `https://gdbrowser.com/${level.lookupId}` }) },
    ] : []),
    ...(info?.creator ? [{ label: `More by ${info.creator}`, icon: 'search', action: () => call('app.openUrl', { url: `https://gdbrowser.com/search/${encodeURIComponent(info.creator)}?user` }) }] : []),
  ];
}

const adjValue = (adj, k) => {
  if (!adj) return '';
  if (k === 'playtimeH') return adj.playtime ? +(adj.playtime / 3600).toFixed(2) : '';
  return adj[k] ?? '';
};

/** Quick thumbnail picker (file dialog). */
export async function pickThumbnail(level) {
  const files = await pickImageFiles(false);
  if (!files.length) return;
  await setThumbFrom(level, files[0]);
}

async function setThumbFrom(level, source) {
  const t = toast('Saving image…', { spinner: true, timeout: 0 });
  try {
    const id = await storeSource(source);
    setCustom(level.key, { thumb: id, thumbPos: 50, noOnlineThumb: false });
    t.done('Thumbnail updated', 2000);
    return id;
  } catch (e) {
    t.done(e.message, 5000);
    return null;
  }
}

export function openCustomize(level, { focus } = {}) {
  level = state.levels.get(state.memberOf.get(level.key) || level.key) || level;
  const key = level.key;
  const auto = autoListRank(level);
  const c = () => custom(key);
  const s = openSheet({
    size: 'lg',
    cls: 'customize',
    html: `
      <div class="sheet-head"><h2>Customise</h2><span class="sheet-sub">${esc(level.rawName)}</span><button class="btn ghost icon-only close" data-a="close" title="Close">${icon('xmark')}</button></div>
      <div class="sheet-body cust">
        <div class="cust-preview">
          <div class="cust-thumb" title="Drop an image here">
            <div class="thumb hd" data-thumb-key="${esc(key)}">${thumbInner(level, { hd: true })}</div>
            <div class="cust-drop">${icon('image')}<span>Drop image</span></div>
          </div>
          <div class="cust-thumb-btns">
            <button class="btn" data-a="file">${icon('folder')}Choose…</button>
            <button class="btn" data-a="paste">${icon('clipboard')}Paste</button>
            <button class="btn" data-a="url">${icon('link')}URL…</button>
            <button class="btn ghost" data-a="reset" title="Remove the custom image">${icon('trash')}</button>
          </div>
          <label class="field-row"><span>Focus</span><input type="range" min="0" max="100" value="${c().thumbPos ?? 50}" data-f="thumbPos" title="Which part of the image shows when it's cropped"></label>
          <label class="field-row switch-row ${level.onlineId > 0 ? '' : 'disabled'}"><span>Use online thumbnail when there's no custom one</span>${switchHtml('online', !c().noOnlineThumb)}</label>
          <p class="hint">Tip: you can also drop an image straight onto a card in the gallery.</p>
        </div>
        <div class="cust-fields">
          <label class="lbl">Display name</label>
          <div class="input-with-btn"><input class="field" data-f="name" value="${esc(c().name || '')}" placeholder="${esc(level.rawName)}" spellcheck="false"><button class="btn ghost icon-only" data-a="resetName" title="Use the original name">${icon('undo')}</button></div>
          <label class="lbl">Enjoyment</label>
          <div class="enjoy-slot"></div>
          <label class="lbl">Difficulty placement</label>
          <div class="placement">
            <span class="auto-rank">${auto ? `${esc(LIST_NAMES[auto.source])} #${auto.source === 'aredl' ? auto.aredlPosition : auto.position}${auto.by === 'name' ? ' <small>matched by name</small>' : ''}` : '<span class="muted">Not on the Demonlist top 150 or AREDL</span>'}</span>
            <span class="sp"></span>
            <input class="field num-field" data-f="listPos" type="number" min="1" step="1" value="${esc(c().listPos || '')}" placeholder="Own #" title="Your own placement (overrides the lists). Sorts like a list position: lower = harder.">
          </div>
          <label class="field-row switch-row"><span>Not a list level <small>(ignore any list match)</small></span>${switchHtml('noList', !!c().noList)}</label>
          <label class="lbl">Length</label>
          <select class="field" data-f="length">
            <option value="">Automatic${level.lengthCat != null && !level.lengthManual ? ` (${LENGTHS[level.lengthCat]})` : ''}</option>
            ${LENGTHS.map((n, i) => `<option value="${i}" ${c().length !== undefined && +c().length === i ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
          <label class="lbl">Colour</label>
          <div class="swatches">
            <button class="sw auto ${!c().color ? 'on' : ''}" data-color="" title="App accent">${icon('xmark')}</button>
            ${SWATCHES.map((x) => `<button class="sw ${c().color === x ? 'on' : ''}" data-color="${x}" style="--sw:${x}" title="${x}"></button>`).join('')}
            <label class="sw custom ${c().color && !SWATCHES.includes(c().color) ? 'on' : ''}" title="Custom colour" style="--sw:${esc(c().color || '#888888')}"><input type="color" value="${esc(c().color || '#3d9df3')}"></label>
          </div>
          <label class="lbl">Tags</label>
          <div class="tags-slot"></div>
          <label class="lbl">Notes</label>
          <textarea class="field notes" data-f="notes" rows="5" placeholder="Strategies, goals, which start positions to grind…">${esc(c().notes || '')}</textarea>
          <label class="field-row switch-row"><span>${icon('star')}Favourite</span>${switchHtml('fav', !!c().fav)}</label>
          <label class="field-row switch-row"><span>${icon('eyeSlash')}Hide from gallery</span>${switchHtml('hidden', !!c().hidden)}</label>
          <button class="btn ghost links-btn" data-a="links">${icon('link')}${level.isGroup ? `${level.members.length} linked copies…` : 'Link copies of this level…'}</button>
          <details class="adjust" ${c().adjust ? 'open' : ''}>
            <summary>Adjust stats</summary>
            <p class="hint">Numbers added on top of what Death Tracker recorded — for practice you did before installing the mod.</p>
            <div class="adjust-grid">
              ${[['attempts', 'Attempts'], ['playtimeH', 'Playtime (hours)'], ['from0', 'From-0 attempts'], ['runs', 'Practice runs'], ['completions', 'Completions'], ['best', 'Best % from 0']].map(([k, label]) => `
                <label><span>${label}</span><input class="field" type="number" min="0" step="${k === 'playtimeH' ? '0.1' : '1'}" ${k === 'best' ? 'max="100"' : ''} data-adj="${k}" value="${esc(adjValue(c().adjust, k))}"></label>`).join('')}
            </div>
          </details>
        </div>
      </div>
      <div class="sheet-foot"><span class="hint">Changes are saved automatically.</span><button class="btn primary" data-a="close">Done</button></div>`,
  });
  const el = s.el;
  const q = (sel) => el.querySelector(sel);
  el.querySelectorAll('[data-a=close]').forEach((b) => (b.onclick = () => s.close()));

  const tf = tagField({
    value: c().tags || [],
    suggestions: allTags,
    colorOf: tagColor,
    onChange: (tags) => setCustom(key, { tags }),
  });
  q('.tags-slot').append(tf.el);

  q('.enjoy-slot').append(ratingControl(c().enjoy || 0, (v) => setCustom(key, { enjoy: v || null })));
  q('[data-f=listPos]').addEventListener('change', (e) => setCustom(key, { listPos: Math.max(0, Math.round(+e.target.value)) || null }));
  q('input[name=noList]').addEventListener('change', (e) => setCustom(key, { noList: e.target.checked }));
  q('[data-f=length]').addEventListener('change', (e) => setCustom(key, { length: e.target.value === '' ? null : +e.target.value }));
  q('[data-a=links]').onclick = () => { s.close(); openLinkEditor(level); };
  el.querySelectorAll('[data-adj]').forEach((inp) => inp.addEventListener('change', () => {
    const adj = {};
    el.querySelectorAll('[data-adj]').forEach((x) => {
      if (x.value === '') return;
      const v = Math.max(0, +x.value);
      if (x.dataset.adj === 'playtimeH') adj.playtime = Math.round(v * 3600);
      else adj[x.dataset.adj] = x.dataset.adj === 'best' ? Math.min(100, v) : Math.round(v);
    });
    setCustom(key, { adjust: Object.keys(adj).length ? adj : null });
  }));

  q('[data-f=name]').addEventListener('input', (e) => setCustom(key, { name: e.target.value.trim() }));
  q('[data-a=resetName]').onclick = () => { q('[data-f=name]').value = ''; setCustom(key, { name: '' }); };
  q('[data-f=notes]').addEventListener('input', (e) => setCustom(key, { notes: e.target.value }));
  const pos = q('[data-f=thumbPos]');
  pos.addEventListener('input', () => {
    q('.cust-thumb img')?.style.setProperty('object-position', `50% ${pos.value}%`);
    setCustom(key, { thumbPos: +pos.value === 50 ? null : +pos.value });
  });
  q('input[name=online]').addEventListener('change', (e) => setCustom(key, { noOnlineThumb: !e.target.checked }));
  q('input[name=fav]').addEventListener('change', (e) => setCustom(key, { fav: e.target.checked }));
  q('input[name=hidden]').addEventListener('change', (e) => setCustom(key, { hidden: e.target.checked }));

  const markColor = (v) => el.querySelectorAll('.sw').forEach((b) => b.classList.toggle('on', b.matches(`[data-color="${v}"]`) || (b.classList.contains('custom') && v && !SWATCHES.includes(v))));
  el.querySelectorAll('[data-color]').forEach((b) => (b.onclick = () => { setCustom(key, { color: b.dataset.color }); markColor(b.dataset.color); }));
  const ci = q('.sw.custom input');
  ci.addEventListener('input', () => { q('.sw.custom').style.setProperty('--sw', ci.value); setCustom(key, { color: ci.value }); markColor(ci.value); });

  const refreshThumb = () => { q('.cust-thumb .thumb').innerHTML = thumbInner(state.levels.get(key) || level, { hd: true }); pos.value = c().thumbPos ?? 50; };
  const apply = async (src) => { if (src && await setThumbFrom(level, src)) refreshThumb(); };
  q('[data-a=file]').onclick = async () => { const f = await pickImageFiles(false); if (f.length) apply(f[0]); };
  q('[data-a=paste]').onclick = async () => {
    const list = await readClipboardSources();
    if (!list.length) { toast('No image on the clipboard'); return; }
    apply(list[0]);
  };
  q('[data-a=url]').onclick = async () => {
    const url = await promptDialog({ title: 'Image from URL', message: 'Paste a link to an image (or a page with a preview image, like a YouTube video).', placeholder: 'https://…', okLabel: 'Use image' });
    if (url) apply({ url });
  };
  q('[data-a=reset]').onclick = () => { setCustom(key, { thumb: null, thumbPos: null }); refreshThumb(); };
  q('[data-a=reset]').disabled = thumbSource(level).kind !== 'custom';

  // Drop / paste straight into the sheet.
  const drop = q('.cust-thumb');
  el.addEventListener('dragover', (e) => { if (dragHasImages(e.dataTransfer)) { e.preventDefault(); drop.classList.add('over'); } });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) drop.classList.remove('over'); });
  el.addEventListener('drop', (e) => {
    drop.classList.remove('over');
    if (!dragHasImages(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    const { sources, pageUrl } = extractSources(e.dataTransfer);
    apply(sources[0] || (pageUrl ? { url: pageUrl } : null));
  });
  el.addEventListener('paste', (e) => {
    if (e.target.matches('input, textarea')) return;
    const { sources } = extractSources(e.clipboardData);
    if (sources[0]) { e.preventDefault(); apply(sources[0]); }
  });

  const unsub = [on('custom', (k) => { if (k === key) q('[data-a=reset]').disabled = !c().thumb; })];
  const origClose = s.close;
  s.close = () => { unsub.forEach((u) => u()); origClose(); };

  if (focus === 'thumb') setTimeout(() => q('[data-a=file]').focus(), 30);
  else setTimeout(() => q('[data-f=name]').focus(), 30);
  return s;
}
