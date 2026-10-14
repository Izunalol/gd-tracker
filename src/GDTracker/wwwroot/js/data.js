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

  // Running all-time best through the sessions, oldest first, to flag sessions that set a new best.
  let running = -Infinity;
  for (const s of [...sessions].reverse()) {
    s.newRecord = s.sum.best != null && s.sum.best > running && s.sum.from0 > 0 && running !== -Infinity;
    if (s.sum.best != null) running = Math.max(running, s.sum.best);
    s.bestSoFar = isFinite(running) ? running : null;
  }

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
  }
  out.runs = [...runMap.values()];
  return out;
}
