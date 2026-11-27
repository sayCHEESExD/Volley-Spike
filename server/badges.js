// Boxity badges. The server declares the list once (retrying every 30 s), asks which badges a
// player already owns when they join, and awards new ones decided ONLY from state this server
// owns (profile, round state, sim events). Boxity draws the popup; the game draws nothing.
// No-op without BLOXITY_REPORT_TOKEN / BLOXITY_GAME_ID (local dev). A failed call never
// disturbs the game.
import { BLOXITY, GAME_HOSTING_ID, REPORT_TOKEN, postJson } from './env.js';

const log = (...a) => console.log('[badges]', ...a);

// key (permanent: never rename or reuse), name, description, icon, rarity, earned(rec, ctx)
export const BADGES = [
  { key: 'welcome', name: 'Welcome to Volley Spike', description: 'Join Volley Spike.', icon: '/badges/welcome.png', rarity: 'common', earned: () => true },
  { key: 'graduate', name: 'Graduate', description: 'Finish the tutorial.', icon: '/badges/graduate.png', rarity: 'common', earned: (r) => !!r.prof.tut },
  { key: 'first_boom', name: 'First Boom', description: 'Eliminate a player in a match.', icon: '/badges/first_boom.png', rarity: 'common', earned: (r) => r.prof.stats.elims >= 1 },
  { key: 'first_win', name: 'Last One Standing', description: 'Win a match.', icon: '/badges/first_win.png', rarity: 'uncommon', earned: (r) => r.prof.stats.wins >= 1 },
  { key: 'keeper', name: 'Keeper', description: 'Make 100 saves.', icon: '/badges/keeper.png', rarity: 'rare', earned: (r) => r.prof.stats.saves >= 100 },
  { key: 'hot_streak', name: 'Hot Streak', description: 'Win 3 matches in a row.', icon: '/badges/hot_streak.png', rarity: 'epic', earned: (r) => (r.prof.stats.bestStreak || 0) >= 3 },
  { key: 'bomber', name: 'Bomber', description: 'Eliminate 100 players.', icon: '/badges/bomber.png', rarity: 'epic', earned: (r) => r.prof.stats.elims >= 100 },
  { key: 'champion', name: 'Champion', description: 'Win 50 matches.', icon: '/badges/champion.png', rarity: 'legendary', earned: (r) => r.prof.stats.wins >= 50 },
];

const enabled = !!(REPORT_TOKEN && GAME_HOSTING_ID);
const SLUG = process.env.BLOXITY_GAME_SLUG || null;
const url = (op) => `${BLOXITY.apiUrl}/v1/game-badges/hosted/${encodeURIComponent(GAME_HOSTING_ID)}/${op}`;
let stopped = false; // dev channel on production answers 403: log once, stop
async function call(op, body) {
  if (!enabled || stopped) return null;
  try {
    const r = await postJson(url(op), SLUG ? { ...body, gameSlug: SLUG } : body, { authorization: `Bearer ${REPORT_TOKEN}` });
    if (r.status === 403) { stopped = true; log(`${op} refused (403, e.g. the dev channel on production): badges off for this process`); return null; }
    if (!r.ok) { log(`${op} ${r.status}`, JSON.stringify(r.body ?? r.error).slice(0, 300)); return null; }
    return r.body;
  } catch (e) { log(op, 'failed', e.message); return null; }
}

// Called once at server start.
export function installBadges() {
  if (!enabled) return;
  const declare = async () => {
    const body = await call('declare', { badges: BADGES.map(({ key, name, description, icon, rarity }) => ({ key, name, description, icon, rarity })) });
    if (body) log('declared', BADGES.length, 'badges'); else if (!stopped) setTimeout(declare, 30e3).unref?.();
  };
  declare();
}

const legionId = (key) => (typeof key === 'string' && key.startsWith('lg_') ? 'legion_' + key.slice(3).split('#m')[0] : null);

// Per player: the badges they own (loaded on join), checked after anything that could earn one.
export class BadgeBook {
  constructor() { this.owned = new Map(); } // sid -> Set | 'loading'

  async join(rec) {
    const uid = legionId(rec.key);
    if (!enabled || !uid || rec.isBot) return;
    this.owned.set(rec.sid, 'loading');
    const body = await call('owned', { userIds: [uid] });
    if (!this.owned.has(rec.sid)) return; // left meanwhile
    const list = body && body.owned ? body.owned[uid] || body.owned[uid.slice(7)] || [] : null;
    if (!list) { this.owned.delete(rec.sid); return; }
    this.owned.set(rec.sid, new Set(list));
    this.check(rec); // award what an existing player already reached
  }

  leave(sid) { this.owned.delete(sid); }

  // ctx: event details (unused so far)
  check(rec, ctx = {}) {
    const set = this.owned.get(rec.sid);
    if (!(set instanceof Set)) return;
    const uid = legionId(rec.key);
    const awards = [];
    for (const b of BADGES) {
      if (set.has(b.key)) continue;
      let ok = false;
      try { ok = b.earned(rec, ctx); } catch { ok = false; }
      if (ok) { set.add(b.key); awards.push({ userId: uid, key: b.key }); } // add first so it is sent once
    }
    if (!awards.length) return;
    call('award', { awards }).then((body) => {
      if (!body) for (const a of awards) set.delete(a.key); // retried on the next check
    });
  }
}
