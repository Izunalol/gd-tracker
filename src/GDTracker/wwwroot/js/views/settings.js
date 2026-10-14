// Settings: appearance, gallery cards, data source, online extras, formats, backup.
import { state, settings, setSettings, loadAll, fetchOnline, clearThumbCache, replacePrefs, DEFAULT_SETTINGS, diffIconUrl, on } from '../store.js';
import { CARD_STATS } from './gallery.js';
import { openSuggestions } from './links.js';
import { SWATCHES } from './customize.js';
import { icon } from '../icons.js';
import { toast, confirmDialog } from '../ui.js';
import { esc, debounce } from '../util.js';
import { call } from '../rpc.js';
import { pickImageFiles, storeSource, imgUrl } from '../images.js';

export const FONTS = {
  segoe: { label: 'Segoe UI (default)', css: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif' },
  bahn: { label: 'Bahnschrift', css: 'Bahnschrift, "Segoe UI", sans-serif' },
  trebuchet: { label: 'Trebuchet', css: '"Trebuchet MS", "Segoe UI", sans-serif' },
  verdana: { label: 'Verdana', css: 'Verdana, "Segoe UI", sans-serif' },
  georgia: { label: 'Georgia', css: 'Georgia, "Times New Roman", serif' },
  mono: { label: 'Cascadia Mono', css: '"Cascadia Mono", Consolas, monospace' },
};

let root = null, unsub = [];

export function mountSettings(el) {
  root = el;
  render();
  // Only re-render for changes that alter the page layout; re-rendering mid-drag would drop the slider.
  const structural = ['bgType', 'bgImage', 'dataPath', 'online', 'lists'];
  const rerender = debounce(() => render(true), 50);
  unsub = [on('prefs', (patch) => { if (!patch || structural.some((k) => k in patch) || patch.accent === undefined && Object.keys(patch).length > 3) rerender(); })];
}
export function unmountSettings() { unsub.forEach((u) => u()); unsub = []; root = null; }

function render(keep = false) {
  if (!root) return;
  const scroller = root.parentElement;
  const top = scroller.scrollTop;
  const s = settings();
  root.className = 'page settings';
  root.innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>

    <section class="set-group">
      <h2>${icon('palette')}Appearance</h2>
      ${row('Theme', '', select('theme', s.theme, { dark: 'Dark', light: 'Light', system: 'Match Windows' }))}
      ${row('Accent colour', 'Used for highlights, charts and buttons.', `<div class="swatches">${SWATCHES.map((x) => `<button class="sw ${s.accent === x ? 'on' : ''}" data-accent="${x}" style="--sw:${x}"></button>`).join('')}
        <label class="sw custom ${!SWATCHES.includes(s.accent) ? 'on' : ''}" style="--sw:${esc(s.accent)}"><input type="color" data-k="accent" value="${esc(s.accent)}"></label></div>`)}
      ${row('Font', '', select('font', s.font, Object.fromEntries(Object.entries(FONTS).map(([k, v]) => [k, v.label]))))}
      ${row('Corner roundness', '', `<input type="range" min="0" max="24" step="1" data-k="radius" data-num value="${s.radius}"><span class="val">${s.radius}px</span>`)}
      ${row('Density', '', select('density', s.density, { comfortable: 'Comfortable', compact: 'Compact' }))}
      ${row('Background', '', select('bgType', s.bgType, { none: 'Plain', gradient: 'Accent glow', image: 'Custom image' }))}
      ${s.bgType === 'image' ? `
        ${row('Background image', '', `<div class="bg-pick">${s.bgImage ? `<img src="${imgUrl(s.bgImage)}" alt="">` : ''}<button class="btn" data-a="bgImage">${icon('image')}${s.bgImage ? 'Change…' : 'Choose…'}</button></div>`)}
        ${row('Blur', '', `<input type="range" min="0" max="40" data-k="bgBlur" data-num value="${s.bgBlur}"><span class="val">${s.bgBlur}px</span>`)}
        ${row('Dim', '', `<input type="range" min="0" max="95" data-k="bgDim" data-num value="${s.bgDim}"><span class="val">${s.bgDim}%</span>`)}` : ''}
      ${row('Blurred banner on level pages', 'Uses the level thumbnail behind the title.', toggle('levelHeroBlur', s.levelHeroBlur))}
    </section>

    <section class="set-group">
      <h2>${icon('grid')}Gallery</h2>
      ${row('Card style', '', select('cardStyle', s.cardStyle, { overlay: 'Text on image', below: 'Text below image', compact: 'Compact' }))}
      ${row('Card shape', '', select('cardAspect', s.cardAspect, { '16/9': 'Widescreen (16:9)', '4/3': 'Classic (4:3)', '1/1': 'Square', '21/9': 'Cinematic (21:9)' }))}
      ${row('Card size', '', `<input type="range" min="180" max="480" step="10" data-k="cardSize" data-num value="${s.cardSize}"><span class="val">${s.cardSize}px</span>`)}
      ${row('Stats on cards', '', `<div class="checks">${CARD_STATS.map((c) => `<label class="check"><input type="checkbox" data-stat="${c.id}" ${s.cardStats[c.id] ? 'checked' : ''}>${icon(c.icon)}${esc(c.label)}</label>`).join('')}</div>`)}
      ${row('Best-% progress bar', '', toggle('showProgress', s.showProgress))}
      ${row('Difficulty badge', '', toggle('showDifficulty', s.showDifficulty))}
      ${row('Use Geometry Dash difficulty faces', state.gdIcons?.available
        ? 'Shows the in-game face instead of “Extreme Demon” etc. Taken from your own Geometry Dash install.'
        : 'Needs Geometry Dash installed through Steam — the faces are read from your game files.',
        `${state.gdIcons?.available ? `<span class="face-preview">${[3, 5, 7, 10].map((d) => `<img src="${diffIconUrl(d)}" alt="">`).join('')}</span>` : ''}<label class="switch"><input type="checkbox" data-k="diffIcons" ${s.diffIcons ? 'checked' : ''} ${state.gdIcons?.available ? '' : 'disabled'}><span></span></label>`)}
      ${row('List placement chip', 'Shows #position from the Demonlist or AREDL on cards.', toggle('showListRank', s.showListRank))}
      ${row('Creator name', '', toggle('showCreator', s.showCreator))}
      ${row('Summary tiles above the gallery', '', toggle('showSummary', s.showSummary))}
      ${row('Favourites first', 'Keep starred levels at the top whatever the sort.', toggle('pinFavorites', s.pinFavorites))}
      ${row('Show hidden levels', '', toggle('showHidden', s.showHidden))}
    </section>

    <section class="set-group">
      <h2>${icon('skull')}Death Tracker data</h2>
      ${row('Levels folder', s.dataPath ? 'Custom folder.' : 'Detected automatically from the mod’s settings.', `<div class="path"><code title="${esc(state.folder)}">${esc(state.folder || state.detectedFolder)}</code></div>
        <div class="row-btns"><button class="btn" data-a="pickFolder">${icon('folder')}Change…</button>${s.dataPath ? `<button class="btn ghost" data-a="autoFolder">Use detected</button>` : ''}<button class="btn ghost" data-a="openFolder">Open</button></div>`)}
      ${row('Live refresh', 'Update the app as you play (the mod writes when you leave a level).', toggle('liveRefresh', s.liveRefresh))}
      ${row('Count respawn time as playtime', 'The short pause after each death.', toggle('playtimeDead', s.playtimeDead))}
      ${row('Count paused time as playtime', 'Time in the pause menu and on the level-complete screen.', toggle('playtimePaused', s.playtimePaused))}
      ${row('Suggest linking copies', 'Spot levels that look like copies of each other (start-pos, editor copies…).', `${toggle('suggestLinks', s.suggestLinks)}<button class="btn" data-a="reviewLinks">${icon('link')}Review now</button>`)}
      ${row('Forget dismissed suggestions', `${state.prefs.dismissedLinks.length} dismissed.`, `<button class="btn" data-a="resetDismissed" ${state.prefs.dismissedLinks.length ? '' : 'disabled'}>Reset</button>`)}
      ${row('Hide 0% deaths in charts', 'Instant restarts often pile up at 0%.', toggle('hideZeroPercent', s.hideZeroPercent))}
      ${row('', '', `<button class="btn" data-a="reload">${icon('refresh')}Reload data now</button>`)}
    </section>

    <section class="set-group">
      <h2>${icon('globe')}Online extras</h2>
      ${row('Level info', 'Creator, stars, song and length from the Geometry Dash servers.', toggle('online', s.online))}
      ${row('Demon lists', 'Placements from Pointercrate (top 150) and AREDL, used for difficulty sorting and the Lists page.', toggle('lists', s.lists))}
      ${row('Match copies to list levels by name', 'Lets editor and start-pos copies (which have their own IDs) pick up the original level’s placement.', toggle('matchListByName', s.matchListByName))}
      ${row('Automatic thumbnails', 'From the Level Thumbnails mod’s server, for levels without a custom image.', toggle('autoThumbs', s.autoThumbs))}
      ${row('', '', `<div class="row-btns"><button class="btn" data-a="refreshInfo" ${s.online ? '' : 'disabled'}>${icon('refresh')}Refresh level info</button><button class="btn ghost" data-a="clearThumbs">${icon('trash')}Clear thumbnail cache</button></div>`)}
    </section>

    <section class="set-group">
      <h2>${icon('clock')}Formats</h2>
      ${row('Playtime', '', select('timeFormat', s.timeFormat, { hm: '12h 05m', decimal: '12.1h', clock: '12:05:33' }))}
      ${row('Dates', '', select('dateFormat', s.dateFormat, { relative: '3 days ago', absolute: '11 Oct 2026' }))}
      ${row('Clock', '', select('clockFormat', s.clockFormat, { auto: 'System default', '24h': '24-hour', '12h': '12-hour' }))}
    </section>

    <section class="set-group">
      <h2>${icon('archive')}Backup</h2>
      ${row('Your customisation', 'Thumbnails, names, tags, notes and settings. Death Tracker’s own data is never changed.', `<div class="row-btns">
        <button class="btn" data-a="export">${icon('download')}Export backup…</button>
        <button class="btn" data-a="import">${icon('share')}Import…</button>
        <button class="btn ghost" data-a="dataFolder">${icon('folder')}Open app data</button></div>`)}
      ${row('Clean up images', 'Delete custom images no level uses any more.', `<button class="btn" data-a="collect">${icon('broom')}Clean up</button>`)}
      ${row('Reset settings', 'Restores default settings. Level customisation is kept.', `<button class="btn danger" data-a="resetSettings">Reset</button>`)}
    </section>

    <p class="about">GD Tracker ${esc(state.version)} · reads data from the <b>Death Tracker</b> Geode mod by abb2k.</p>`;
  wire();
  if (keep) scroller.scrollTop = top;
}

const row = (label, hint, control) => `<div class="set-row"><div class="set-label">${label ? `<div>${label}</div>` : ''}${hint ? `<div class="set-hint">${hint}</div>` : ''}</div><div class="set-ctl">${control}</div></div>`;
const toggle = (k, on) => `<label class="switch"><input type="checkbox" data-k="${k}" ${on ? 'checked' : ''}><span></span></label>`;
const select = (k, v, opts) => `<select class="field sel" data-k="${k}">${Object.entries(opts).map(([val, label]) => `<option value="${esc(val)}" ${String(v) === val ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;

function wire() {
  const s = settings();
  root.querySelectorAll('[data-k]').forEach((el) => {
    const k = el.dataset.k;
    if (el.type === 'checkbox') el.addEventListener('change', () => setSettings({ [k]: el.checked }));
    else if (el.type === 'range') {
      el.addEventListener('input', () => {
        el.nextElementSibling.textContent = el.value + (k === 'bgDim' ? '%' : 'px');
        setSettings({ [k]: +el.value });
      });
    } else if (el.type === 'color') el.addEventListener('input', debounce(() => { el.parentElement.style.setProperty('--sw', el.value); setSettings({ [k]: el.value }); markAccent(el.value); }, 60));
    else el.addEventListener('change', () => setSettings({ [k]: el.value }));
  });
  const markAccent = (v) => root.querySelectorAll('.swatches .sw').forEach((b) => b.classList.toggle('on', b.dataset.accent === v || (b.classList.contains('custom') && !SWATCHES.includes(v))));
  root.querySelectorAll('[data-accent]').forEach((b) => (b.onclick = () => { setSettings({ accent: b.dataset.accent }); markAccent(b.dataset.accent); }));
  root.querySelectorAll('[data-stat]').forEach((cb) => cb.addEventListener('change', () => setSettings({ cardStats: { ...s.cardStats, [cb.dataset.stat]: cb.checked } })));

  const act = (name, fn) => { const b = root.querySelector(`[data-a=${name}]`); if (b) b.onclick = fn; };
  act('bgImage', async () => {
    const f = await pickImageFiles(false);
    if (!f.length) return;
    const t = toast('Saving image…', { spinner: true, timeout: 0 });
    try { setSettings({ bgImage: await storeSource(f[0]) }); t.done('Background set', 1500); } catch (e) { t.done(e.message, 4000); }
  });
  act('pickFolder', async () => {
    const p = await call('dt.pickFolder');
    if (p) { setSettings({ dataPath: p }); await loadAll(); render(true); }
  });
  act('autoFolder', async () => { setSettings({ dataPath: '' }); await loadAll(); render(true); });
  act('openFolder', () => call('dt.openFolder'));
  act('reload', async () => { await loadAll(); toast(`Loaded ${state.levels.size} levels`); });
  act('refreshInfo', async () => {
    const t = toast('Refreshing level info…', { spinner: true, timeout: 0 });
    await fetchOnline(true);
    t.done('Level info updated');
  });
  act('clearThumbs', async () => { await clearThumbCache(); toast('Thumbnail cache cleared — re-downloading'); });
  act('export', async () => {
    const p = await call('backup.export', { json: JSON.stringify(state.prefs, null, 1) });
    if (p) toast('Backup saved');
  });
  act('import', async () => {
    let json;
    try { json = await call('backup.import'); } catch (e) { toast(e.message); return; }
    if (!json) return;
    if (!(await confirmDialog('Replace your customisation?', 'Thumbnails, names, tags, notes and settings will be replaced by the backup’s.', 'Replace', true))) return;
    replacePrefs(JSON.parse(json));
    toast('Backup restored');
  });
  act('dataFolder', () => call('app.openDataFolder'));
  act('reviewLinks', () => openSuggestions());
  act('resetDismissed', () => { state.prefs.dismissedLinks = []; setSettings({}); render(true); toast('Suggestions reset'); });
  act('collect', async () => {
    const keep = Object.values(state.prefs.levels).map((c) => c.thumb).filter(Boolean);
    if (s.bgImage) keep.push(s.bgImage);
    const n = await call('images.collect', { keep });
    toast(n ? `Removed ${n} unused image${n === 1 ? '' : 's'}` : 'Nothing to clean up (images younger than a week are kept)');
  });
  act('resetSettings', async () => {
    if (!(await confirmDialog('Reset all settings?', 'Your level thumbnails, names, tags and notes are kept.', 'Reset', true))) return;
    const keep = { dataPath: s.dataPath, bgImage: s.bgImage };
    setSettings({ ...structuredClone(DEFAULT_SETTINGS), ...keep });
  });
}
