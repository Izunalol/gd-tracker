// Turns the Death Tracker mod's raw save files into level objects with derived stats.
//
// File semantics (from the mod's source, abb2k/death-tracker):
//   metadata    { levelName, attempts (GD's own counter), difficulty, LinkedLevels, sections, ... }
//   general.dt  all-time data: { deaths, runs, newBests, playtimeGeneral, playtimePaused, playtimeDead }
//   sessions/*.dt  { sessionStartDate, lastPlayed (unix s), data: <same shape as general.dt> }
//   deaths   "<percent>": count — from-0 normal-mode attempts that ended at that percent (100 = completion)
//   runs     "<start>-<end>": count — practice / start-pos attempts
//   newBests percents that were a new best when reached (so its max is the best from 0)
//   playtime nanoseconds, split into from-0 ("playtimeF0") and practice ("playtimeRuns");
//            General = alive, Dead = respawn delay after a death, Paused = pause menu / end screen.

export const DIFFICULTIES = {
  '-1': { name: 'Auto', short: 'Auto', color: '#e8a33b', rank: 0.5 },
  0: { name: 'N/A', short: 'N/A', color: '#8a8f9c', rank: 0 },
  1: { name: 'Easy', short: 'Easy', color: '#4ab4ff', rank: 1 },
  2: { name: 'Normal', short: 'Normal', color: '#48d16c', rank: 2 },
  3: { name: 'Hard', short: 'Hard', color: '#f2c230', rank: 3 },
  4: { name: 'Harder', short: 'Harder', color: '#f27d30', rank: 4 },
  5: { name: 'Insane', short: 'Insane', color: '#f2508c', rank: 5 },
  7: { name: 'Easy Demon', short: 'Easy Demon', color: '#c45bf2', rank: 6 },
  8: { name: 'Medium Demon', short: 'Medium Demon', color: '#e2499f', rank: 7 },
  6: { name: 'Hard Demon', short: 'Hard Demon', color: '#f23d3d', rank: 8 },
  9: { name: 'Insane Demon', short: 'Insane Demon', color: '#d42626', rank: 9 },
  10: { name: 'Extreme Demon', short: 'Extreme Demon', color: '#a3121e', rank: 10 },
};
export const diffInfo = (d) => DIFFICULTIES[d] ?? DIFFICULTIES[0];
/** Difficulties in ascending order, for filters and grouping. */
export const DIFF_ORDER = Object.entries(DIFFICULTIES).sort((a, b) => a[1].rank - b[1].rank).map(([k]) => +k);

// Official levels report no rating to the mod, so use the in-game faces (demons show as Hard Demon).
const MAIN_DIFFICULTY = {
  1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 9: 4, 10: 5, 11: 5, 12: 5, 13: 5, 14: 6, 15: 5, 16: 5,
  17: 4, 18: 6, 19: 4, 20: 6, 21: 5, 22: 5, 5001: 1, 5002: 2, 5003: 3, 4001: 2, 4002: 3, 4003: 4,
};

export const LENGTHS = ['Tiny', 'Short', 'Medium', 'Long', 'XL', 'Platformer'];

export const TYPES = {
  online: 'Online',
  main: 'Main level',
  editor: 'Created / editor',
  daily: 'Daily / weekly',
  gauntlet: 'Gauntlet',
};

const NS = 1e9;

/** Parses a level key ("123", "1-local", "7-editor", "123-daily", "123-gauntlet"). */
export function parseKey(key) {
  const m = /^(-?\d+)(-local|-editor)?(-daily)?(-gauntlet)?$/.exec(key);
  if (!m) return { id: null, type: 'online', onlineId: null };
  const id = +m[1];
  const type = m[2] === '-local' ? 'main' : m[2] === '-editor' ? 'editor' : m[3] ? 'daily' : m[4] ? 'gauntlet' : 'online';
  return {
    id,
    type,
    // Ids we can look up on the GD servers / thumbnail server. Main levels have thumbnails but no server entry.
    onlineId: type === 'editor' ? null : id,
    lookupId: type === 'editor' || type === 'main' ? null : id,
  };
}

function playtimePair(p) {
  return { f0: (+p?.playtimeF0 || 0) / NS, runs: (+p?.playtimeRuns || 0) / NS };
}

/** GeneralData → { deaths: Map<pct,count>, runs: [{s,e,n}], newBests, pt } */
export function parseData(raw) {
  const deaths = new Map();
  for (const [k, v] of Object.entries(raw?.deaths || {})) {
    const p = parseInt(k, 10);
    if (!isNaN(p) && v > 0) deaths.set(p, (deaths.get(p) || 0) + v);
  }
  const runs = [];
  for (const [k, v] of Object.entries(raw?.runs || {})) {
    const m = /^(-?\d+)-(-?\d+)$/.exec(k);
    if (m && v > 0) runs.push({ s: +m[1], e: +m[2], n: v });
  }
  return {
    deaths,
    runs,
    newBests: (raw?.newBests || []).map(Number).filter((n) => !isNaN(n)).sort((a, b) => a - b),
    pt: {
      gen: playtimePair(raw?.playtimeGeneral),
      dead: playtimePair(raw?.playtimeDead),
      paused: playtimePair(raw?.playtimePaused),
    },
  };
}

/** Playtime (seconds) per the user's settings: alive time, plus optionally respawn and pause time. */
export function playtime(pt, opts, part = 'all') {
  const pick = (p) => (part === 'f0' ? p.f0 : part === 'runs' ? p.runs : p.f0 + p.runs);
  return pick(pt.gen) + (opts.playtimeDead ? pick(pt.dead) : 0) + (opts.playtimePaused ? pick(pt.paused) : 0);
}

/** Derived numbers for one GeneralData (all-time or a session). */
export function summarize(d) {
  let from0 = 0, completions = 0, maxDeath = -Infinity;
  for (const [p, n] of d.deaths) {
    from0 += n;
    if (p >= 100) completions += n;
    if (p > maxDeath) maxDeath = p;
  }
  let runs = 0, longest = null, runCompletions = 0;
  for (const r of d.runs) {
    runs += r.n;
    if (r.e >= 100) runCompletions += r.n;
    if (!longest || r.e - r.s > longest.e - longest.s || (r.e - r.s === longest.e - longest.s && r.e > longest.e)) longest = r;
  }
  const nb = d.newBests.length ? d.newBests[d.newBests.length - 1] : -Infinity;
  const best = Math.max(nb, maxDeath);
  return {
    from0,
    runs,
    attempts: from0 + runs,
    completions,
    runCompletions,
    best: isFinite(best) ? best : null,
    longest,
  };
}

/** Builds a level from the host's raw files. `opts` are the playtime settings. */
export function buildLevel(raw, opts) {
  const meta = raw.meta || {};
  const k = parseKey(raw.key);
  const all = parseData(raw.general);
  const sessions = (raw.sessions || []).map((s) => {
    const data = parseData(s.data?.data);
    const start = +s.data?.sessionStartDate || +s.file || 0;
    return {
      start,
      last: Math.max(+s.data?.lastPlayed || 0, start),
      data,
      sum: summarize(data),
    };
  })
    // The mod opens a session as soon as a level loads; ones with nothing in them are just noise.
    .filter((s) => s.start > 0 && (s.sum.attempts > 0 || playtime(s.data.pt, { playtimeDead: true, playtimePaused: true }) >= 1))
    .sort((a, b) => b.start - a.start);

  markRecords(sessions);

  const sum = summarize(all);
  const lastPlayed = sessions.length ? Math.max(...sessions.map((s) => s.last)) : raw.mtime || 0;
  const firstPlayed = sessions.length ? Math.min(...sessions.map((s) => s.start)) : raw.mtime || 0;
  const level = {
    key: raw.key,
    ...k,
    rawName: meta.levelName || 'Unknown level',
    gdAttempts: +meta.attempts || 0,
    difficulty: (k.type === 'main' && !+meta.difficulty ? MAIN_DIFFICULTY[k.id] : +meta.difficulty) || 0,
    linked: Array.isArray(meta.LinkedLevels) ? meta.LinkedLevels : [],
    sections: Array.isArray(meta.sections) ? meta.sections : [],
    all,
    sum,
    sessions,
    lastPlayed,
    firstPlayed,
    error: raw.error || null,
  };
  applyPlaytime(level, opts);
  return level;
}

/** Flags sessions that set a new all-time best (walking oldest → newest). */
export function markRecords(sessions) {
  let running = -Infinity;
  for (const s of [...sessions].sort((a, b) => a.start - b.start)) {
    s.newRecord = s.sum.best != null && s.sum.best > running && s.sum.from0 > 0 && running !== -Infinity;
    if (s.sum.best != null) running = Math.max(running, s.sum.best);
    s.bestSoFar = isFinite(running) ? running : null;
  }
}

/** (Re)computes playtime fields, which depend on settings. */
export function applyPlaytime(level, opts) {
  level.playtime = playtime(level.all.pt, opts);
  level.playtimeF0 = playtime(level.all.pt, opts, 'f0');
  level.playtimeRuns = playtime(level.all.pt, opts, 'runs');
  for (const s of level.sessions) s.playtime = playtime(s.data.pt, opts);
  // GD's own counter if the mod recorded it, else what the mod tracked.
  level.attempts = Math.max(level.gdAttempts, 0) || level.sum.attempts;
}

// ---------------------------------------------------------------- per-percent analysis

/**
 * For each percent with deaths: deaths there, how many runs reached it, and the pass rate
 * (share of runs that reached it and got past it). Percents ≥ 100 are completions.
 */
export function percentTable(deaths) {
  const pts = [...deaths.entries()].sort((a, b) => a[0] - b[0]);
  const total = pts.reduce((a, [, n]) => a + n, 0);
  let reached = total;
  const rows = [];
  for (const [p, n] of pts) {
    rows.push({
      p,
      deaths: n,
      reached,
      reachRate: total ? reached / total : 0,
      passRate: reached ? (reached - n) / reached : 0,
      share: total ? n / total : 0,
      completion: p >= 100,
    });
    reached -= n;
  }
  return { rows, total };
}

/** The percents that stop you most often, among ones reached often enough to mean something. */
export function hardestParts(deaths, count = 5) {
  const { rows, total } = percentTable(deaths);
  const minReach = Math.max(5, total * 0.01);
  return rows.filter((r) => !r.completion && r.reached >= minReach && r.p > 0)
    .sort((a, b) => a.passRate - b.passRate || b.deaths - a.deaths)
    .slice(0, count);
}

/** Practice / start-pos runs grouped by start percent. */
export function runGroups(runs) {
  const map = new Map();
  for (const r of runs) {
    if (!map.has(r.s)) map.set(r.s, { start: r.s, count: 0, bestEnd: r.e, totalEnd: 0, completions: 0, runs: [] });
    const g = map.get(r.s);
    g.count += r.n;
    g.bestEnd = Math.max(g.bestEnd, r.e);
    g.totalEnd += r.e * r.n;
    if (r.e >= 100) g.completions += r.n;
    g.runs.push(r);
  }
  for (const g of map.values()) {
    g.avgEnd = g.count ? g.totalEnd / g.count : 0;
    g.runs.sort((a, b) => b.e - a.e);
  }
  return [...map.values()].sort((a, b) => a.start - b.start);
}

/** Merges several GeneralData (used for a "selected sessions" view). */
export function mergeData(list) {
  const out = { deaths: new Map(), runs: [], newBests: [], pt: { gen: { f0: 0, runs: 0 }, dead: { f0: 0, runs: 0 }, paused: { f0: 0, runs: 0 } } };
  const runMap = new Map();
  for (const d of list) {
    for (const [p, n] of d.deaths) out.deaths.set(p, (out.deaths.get(p) || 0) + n);
    for (const r of d.runs) runMap.set(`${r.s}-${r.e}`, { s: r.s, e: r.e, n: (runMap.get(`${r.s}-${r.e}`)?.n || 0) + r.n });
    for (const k of ['gen', 'dead', 'paused']) { out.pt[k].f0 += d.pt[k].f0; out.pt[k].runs += d.pt[k].runs; }
    out.newBests.push(...d.newBests);
  }
  out.runs = [...runMap.values()];
  out.newBests = [...new Set(out.newBests)].sort((a, b) => a - b);
  return out;
}

// ---------------------------------------------------------------- entities: linked copies + manual adjustments

/**
 * What the app shows as one "level": a tracked level, or several linked copies of the same level
 * (an editor copy, a start-pos copy and the online original, say) merged into one.
 * `primary` owns the name and customisation; online info comes from whichever member is an online level.
 */
export function makeEntity(primary, others, opts) {
  const members = [primary, ...others];
  let e;
  if (!others.length) {
    e = { ...primary, members };
  } else {
    const all = mergeData(members.map((m) => m.all));
    const sessions = members.flatMap((m) => m.sessions.map((s) => ({ ...s, member: m.key })))
      .sort((a, b) => b.start - a.start);
    markRecords(sessions);
    // Server info (creator, song…) comes from the original: a start-pos upload has its own uploader.
    const online = members.find((m) => m.lookupId && isPlainName(m.rawName))
      || (isPlainName(primary.rawName) ? null : members.find((m) => m.lookupId));
    const rated = members.slice().sort((a, b) => diffInfo(b.difficulty).rank - diffInfo(a.difficulty).rank)[0];
    e = {
      ...primary,
      onlineId: online?.onlineId ?? (primary.onlineId > 0 ? primary.onlineId : null),
      lookupId: online?.lookupId ?? null,
      difficulty: rated.difficulty,
      gdAttempts: members.reduce((a, m) => a + m.gdAttempts, 0),
      all,
      sum: summarize(all),
      sessions,
      lastPlayed: Math.max(...members.map((m) => m.lastPlayed)),
      firstPlayed: Math.min(...members.map((m) => m.firstPlayed).filter(Boolean)),
      members,
      error: members.map((m) => m.error).filter(Boolean)[0] || null,
    };
  }
  e.isGroup = others.length > 0;
  applyPlaytime(e, opts);
  return e;
}

/**
 * Manual numbers added on top of what Death Tracker recorded (for practice done before installing the mod).
 * adj: { attempts, playtime (s), from0, runs, completions, best }
 */
export function applyAdjust(e, adj) {
  if (!adj || !Object.values(adj).some((v) => v)) return e;
  const n = (v) => Math.max(0, +v || 0);
  e.adjust = adj;
  e.playtime += n(adj.playtime);
  e.attempts += n(adj.attempts);
  e.sum = {
    ...e.sum,
    from0: e.sum.from0 + n(adj.from0),
    runs: e.sum.runs + n(adj.runs),
    attempts: e.sum.attempts + n(adj.from0) + n(adj.runs),
    completions: e.sum.completions + n(adj.completions),
    best: adj.best != null && adj.best !== '' ? Math.max(e.sum.best ?? 0, +adj.best) : e.sum.best,
  };
  if (n(adj.completions) > 0) e.sum.best = Math.max(e.sum.best ?? 0, 100);
  return e;
}

// ---------------------------------------------------------------- copy detection

// Words people add to practice copies. GD cuts names at 20 characters, so "Sakupen Hell StartPo" is
// "Sakupen Hell StartPos": a trailing fragment of any of these counts too.
const COPY_WORDS = ['startpos', 'startposition', 'start', 'pos', 'sp', 'copy', 'practice', 'prac', 'ldm', 'nong', 'fixed', 'fix', 'bugfix', 'noclip', 'unlisted', 'remake'];
// Matching against the community lists is stricter: practice levels ("Ship Prac 1") are their own levels.
const STRICT_COPY_WORDS = ['startpos', 'startposition', 'start', 'pos', 'sp', 'copy', 'ldm', 'nong', 'fixed', 'fix', 'bugfix', 'unlisted'];

/** Name reduced to what copies have in common: lower-case, no punctuation, no "startpos"/"copy" tails. */
export function baseName(name, strict = false) {
  const list = strict ? STRICT_COPY_WORDS : COPY_WORDS;
  let words = String(name || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
  const isCopyWord = (w, last) => list.includes(w) || (last && w.length >= 2 && list.some((c) => c.length > w.length && c.startsWith(w)));
  // Strip copy words from the end (keeping at least one word), and a copy number like "startpos 2".
  for (let i = 0; i < 4 && words.length > 1; i++) {
    const last = words[words.length - 1];
    if (isCopyWord(last, true)) { words.pop(); continue; }
    if (/^\d+$/.test(last) && words.length > 2 && isCopyWord(words[words.length - 2], false)) { words.pop(); continue; }
    break;
  }
  return words.join(' ');
}

/**
 * Groups of tracked levels that look like copies of one another (same base name, or linked in Death Tracker).
 * `distinct(a, b)` vetoes a pair known to be different levels.
 */
export function findCopies(levels, distinct = () => false) {
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) k = parent.get(k); return k; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  const byName = new Map();
  for (const l of levels) {
    parent.set(l.key, l.key);
    const b = baseName(l.rawName);
    if (b.length < 3) continue;
    if (!byName.has(b)) byName.set(b, []);
    byName.get(b).push(l);
  }
  // Within a name, a level joins the first cluster it isn't known to differ from (so two different
  // "Azurite"s stay apart even though a start-pos copy matches both).
  for (const bucket of byName.values()) {
    const clusters = [];
    for (const l of bucket) {
      const c = clusters.find((cl) => cl.every((x) => !distinct(x, l)));
      if (c) { c.push(l); union(c[0].key, l.key); } else clusters.push([l]);
    }
  }
  for (const l of levels) for (const k of l.linked || []) if (parent.has(k)) union(l.key, k);
  const groups = new Map();
  for (const l of levels) {
    const r = find(l.key);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(l);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** True when a name has no "startpos"/"copy" tail, i.e. it looks like the original level. */
export const isPlainName = (name) => baseName(name).replace(/ /g, '') === String(name || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Best member to own a linked group: the level on a list, then a plain-named online level, then any
 * plain-named level (an editor copy called "Acheron" beats an upload called "Acheron StartPos"), then the most played.
 */
export function pickPrimary(levels, isListed = () => false) {
  const score = (l) => (isListed(l) ? 8 : 0) + (isPlainName(l.rawName) ? 4 : 0) + (l.type === 'online' || l.type === 'main' ? 2 : 0);
  return levels.slice().sort((a, b) => score(b) - score(a) || b.playtime - a.playtime)[0];
}

// ---------------------------------------------------------------- lists

/** Length category from GD info, an AREDL tag or the user's choice (index into LENGTHS). */
export function lengthFromTags(tags) {
  if (!Array.isArray(tags)) return null;
  if (tags.some((t) => t === 'XXL' || t === 'XXL+')) return 4; // AREDL splits XL further; GD calls all of it XL
  const i = LENGTHS.findIndex((l) => tags.includes(l));
  return i >= 0 ? i : null;
}
