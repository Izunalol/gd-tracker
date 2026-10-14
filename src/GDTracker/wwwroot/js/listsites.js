// The community lists and their live APIs (leaderboards, player profiles, a level's victors), normalised
// to one shape so the Lists page doesn't care which site it's talking to. Requests go through the host
// (lists.api) because the sites don't allow cross-origin calls.
import { call } from './rpc.js';

export const SITES = {
  pointercrate: {
    label: 'Demonlist', site: 'Pointercrate', kind: 'pc', base: 'https://pointercrate.com',
    levelUrl: (l) => `https://pointercrate.com/demonlist/${l.position}/`,
    playerUrl: (id) => `https://pointercrate.com/demonlist/statsviewer/?player=${id}`,
    scoreLabel: 'Score',
  },
  challenge: {
    label: 'Challenge List', site: 'Challenge List', kind: 'pc', base: 'https://challengelist.gd',
    levelUrl: (l) => `https://challengelist.gd/challenges/${l.position}/`,
    playerUrl: () => null, // the site has no public player pages
    scoreLabel: 'Score',
  },
  aredl: {
    label: 'AREDL', site: 'All Rated Extreme Demons List', kind: 'aredl',
    levelUrl: (l) => `https://aredl.net/list/${l.levelId}`,
    playerUrl: (id) => `https://aredl.net/profile/user/${id}`,
    scoreLabel: 'Points',
  },
  ill: {
    label: 'Impossible Levels', site: 'Impossible Levels List', kind: 'ill',
    levelUrl: (l) => `https://impossiblelevels.com/level/${l.id}`,
    playerUrl: (id, slug) => (slug ? `https://impossiblelevels.com/profile/${slug}` : 'https://impossiblelevels.com/leaderboard'),
    scoreLabel: 'Runs',
  },
};

const api = (url) => call('lists.api', { url });
const PAGE = 50;

// ---------------------------------------------------------------- flags

// AREDL stores countries as ISO 3166 numeric codes; flag images want the two-letter code.
const NUMERIC = '4af8al12dz16as20ad24ao28ag31az32ar36au40at44bs48bh50bd51am52bb56be60bm64bt68bo70ba72bw76br84bz90sb96bn100bg104mm108bi112by116kh120cm124ca132cv136ky140cf144lk148td152cl156cn158tw170co174km178cg180cd184ck188cr191hr192cu196cy203cz204bj208dk212dm214do218ec222sv226gq231et232er233ee234fo242fj246fi250fr254gf258pf262dj266ga268ge270gm275ps276de288gh292gi296ki300gr304gl308gd312gp316gu320gt324gn328gy332ht340hn344hk348hu352is356in360id364ir368iq372ie376il380it384ci388jm392jp398kz400jo404ke408kp410kr414kw417kg418la422lb426ls428lv430lr434ly438li440lt442lu446mo450mg454mw458my462mv466ml470mt474mq478mr480mu484mx492mc496mn498md499me504ma508mz512om516na520nr524np528nl531cw533aw540nc548vu554nz558ni562ne566ng578no583fm584mh585pw586pk591pa598pg600py604pe608ph616pl620pt624gw626tl630pr634qa638re642ro643ru646rw659kn662lc670vc674sm678st682sa686sn688rs690sc694sl702sg703sk704vn705si706so710za716zw724es728ss729sd740sr748sz752se756ch760sy762tj764th768tg776to780tt784ae788tn792tr795tm798tv800ug804ua807mk818eg826gb834tz840us850vi854bf858uy860uz862ve882ws887ye894zm';
const numericToAlpha = new Map([...NUMERIC.matchAll(/(\d+)([a-z]{2})/g)].map((m) => [+m[1], m[2]]));

/** <img> flag for a two-letter code (or ISO numeric), '' when unknown. */
export function flag(code, title = '') {
  const cc = typeof code === 'number' ? numericToAlpha.get(code) : String(code || '').toLowerCase();
  if (!cc || !/^[a-z]{2}$/.test(cc)) return '';
  return `<img class="flag" src="https://flagcdn.com/w40/${cc}.png" alt="${cc.toUpperCase()}" title="${title || cc.toUpperCase()}" loading="lazy">`;
}

// ---------------------------------------------------------------- leaderboards

/**
 * One page of a list's player ranking. cursor: opaque paging state (null for the first page).
 * Returns { rows: [{ rank, id, slug, name, score, country, extra }], next }.
 */
export async function leaderboard(listId, { query = '', cursor = null } = {}) {
  const site = SITES[listId];
  if (site.kind === 'pc') {
    const after = cursor ?? 0;
    const data = await api(`${site.base}/api/v1/players/ranking/?limit=${PAGE}&after=${after}${query ? `&name_contains=${encodeURIComponent(query)}` : ''}`);
    const rows = data.map((p) => ({ rank: p.rank, id: p.id, name: p.name, score: p.score, country: p.nationality?.country_code, countryName: p.nationality?.nation }));
    return { rows, next: rows.length === PAGE ? rows[rows.length - 1].rank : null };
  }
  if (site.kind === 'aredl') {
    const page = cursor ?? 1;
    const data = await api(`https://api.aredl.net/v2/api/aredl/leaderboard?page=${page}&per_page=${PAGE}${query ? `&name_filter=${encodeURIComponent(query)}` : ''}`);
    const rows = (data.data || []).map((r) => ({
      rank: r.rank, id: r.user?.id, name: r.user?.global_name || r.user?.username, score: r.total_points, country: r.country ?? r.user?.country,
      extra: `${r.extremes ?? 0} extremes${r.hardest ? ` · hardest ${r.hardest.name}` : ''}`,
    }));
    return { rows, next: page < (data.pages || 0) ? page + 1 : null };
  }
  // Impossible Levels List: one small list, filtered here.
  const data = await api('https://api.impossiblelevels.com/api/Records/leaderboard?includeRecords=false');
  const all = data.map((p, i) => ({ rank: i + 1, id: p.playerName, slug: p.profileSlug, name: p.playerName, score: p.recordCount }));
  const q = query.toLowerCase();
  const rows = q ? all.filter((r) => r.name.toLowerCase().includes(q)) : all;
  const start = cursor ?? 0;
  return { rows: rows.slice(start, start + PAGE), next: start + PAGE < rows.length ? start + PAGE : null };
}

// ---------------------------------------------------------------- player profiles

/**
 * A player's profile: { name, rank, score, country, countryName, url, stats: [[label, value]],
 *   sections: [{ title, items: [{ name, position, progress, video, levelId, listId }] }] }
 * `listId` on an item is the list's own level id (Pointercrate demon id) for opening that level.
 */
export async function profile(listId, id, slug) {
  const site = SITES[listId];
  const byPos = (a, b) => (a.position ?? 1e9) - (b.position ?? 1e9);
  if (site.kind === 'pc') {
    const { data: p } = await api(`${site.base}/api/v1/players/${id}/`);
    const recs = (p.records || []).map((r) => ({ name: r.demon?.name, position: r.demon?.position, listId: r.demon?.id, progress: r.progress, video: r.video }));
    const lvl = (x) => ({ name: x.name, position: x.position, listId: x.id });
    return {
      name: p.name, rank: p.rank, score: p.score, country: p.nationality?.country_code, countryName: p.nationality?.nation,
      url: site.playerUrl(p.id),
      stats: [['Completions', recs.filter((r) => r.progress >= 100).length], ['Verified', (p.verified || []).length], ['Progress records', recs.filter((r) => r.progress < 100).length]],
      sections: [
        { title: 'Completions', items: recs.filter((r) => r.progress >= 100).sort(byPos) },
        { title: 'Verified', items: (p.verified || []).map(lvl).sort(byPos) },
        { title: 'Progress', items: recs.filter((r) => r.progress < 100).sort(byPos) },
        { title: 'Published', items: (p.published || []).map(lvl).sort(byPos) },
        { title: 'Created', items: (p.created || []).map(lvl).sort(byPos) },
      ],
    };
  }
  if (site.kind === 'aredl') {
    const p = await api(`https://api.aredl.net/v2/api/aredl/profile/${id}`);
    const recs = (p.records || []).map((r) => ({ name: r.level?.name, position: r.level?.position, levelId: r.level?.level_id, progress: 100, video: r.video_url, verification: r.is_verification, date: r.achieved_at, points: r.level?.points }));
    const lvl = (x) => ({ name: x.name, position: x.position, levelId: x.level_id, points: x.points });
    return {
      name: p.global_name || p.username, rank: p.rank?.rank, score: p.rank?.total_points, country: p.country,
      url: site.playerUrl(p.id),
      stats: [['Extremes', p.rank?.extremes ?? recs.length], ['Verified', recs.filter((r) => r.verification).length], ['Packs', (p.packs || []).length]],
      sections: [
        { title: 'Completions', items: recs.filter((r) => !r.verification).sort(byPos) },
        { title: 'Verified', items: recs.filter((r) => r.verification).sort(byPos) },
        { title: 'Published', items: (p.published || []).map(lvl).sort(byPos) },
        { title: 'Created', items: (p.created || []).map(lvl).sort(byPos) },
      ],
    };
  }
  const data = await api(`https://api.impossiblelevels.com/api/Records/player/${encodeURIComponent(id)}`);
  const runs = data.map((x) => ({
    name: x.level?.name, position: x.level?.rank, listId: x.level?.id, levelId: +x.level?.levelId || null,
    run: [x.record?.startDistance, x.record?.endDistance], video: x.record?.videoUrl,
  })).sort(byPos);
  return {
    name: id, rank: null, score: runs.length, url: site.playerUrl(id, slug || data[0]?.record?.playerProfileSlug),
    stats: [['Record runs', runs.length], ['Levels', new Set(runs.map((r) => r.listId)).size]],
    sections: [{ title: 'Record runs', items: runs }],
  };
}

// ---------------------------------------------------------------- a level's victors

/**
 * Victors / records of one list level. Returns { items: [{ player, playerId, slug, progress, run, video, country, date }],
 * extra: { creators: [{ id, name }] }, next }.
 */
export async function victors(listId, level, cursor = null) {
  const site = SITES[listId];
  if (site.kind === 'pc') {
    const { data } = await api(`${site.base}/api/v2/demons/${level.id}/`);
    const items = (data.records || []).filter((r) => r.status !== 'rejected')
      .map((r) => ({ player: r.player?.name, playerId: r.player?.id, progress: r.progress, video: r.video, country: r.nationality?.country_code }))
      .sort((a, b) => b.progress - a.progress);
    return { items, extra: { creators: data.creators || [] }, next: null };
  }
  if (site.kind === 'aredl') {
    const page = cursor ?? 1;
    const data = await api(`https://api.aredl.net/v2/api/aredl/levels/${level.levelId}/records?page=${page}&per_page=${PAGE}`);
    const items = (data.data || []).map((r) => ({
      player: r.submitted_by?.global_name || r.submitted_by?.username, playerId: r.submitted_by?.id, progress: 100,
      video: r.video_url, country: r.submitted_by?.country, date: r.achieved_at,
    }));
    return { items, extra: { count: data.count }, next: page < (data.pages || 0) ? page + 1 : null };
  }
  // Impossible Levels List: runs come with the cached list.
  const items = (level.records || []).map((r) => ({ player: r.player, playerId: r.player, slug: r.slug, run: [r.start, r.end], video: r.video, date: r.date }))
    .sort((a, b) => (b.run[1] - b.run[0]) - (a.run[1] - a.run[0]));
  return { items, extra: {}, next: null };
}

/** "45%–78%" for an impossible-level run. */
export const runText = (run) => (run ? `${+(+run[0]).toFixed(1)}%–${+(+run[1]).toFixed(1)}%` : '');
