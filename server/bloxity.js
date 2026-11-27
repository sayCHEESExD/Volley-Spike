// Server-side Boxity integration. Every URL comes from the told environment (env.js).
//  - verifyToken(): verifies a player's Boxity JWT (never trust a client-sent account id)
//  - installStatReporter(): "Only in this game" profile stats, from server-owned profiles
//  - leaderboard: queues scores and reports them in batches (server-owned state only)
//  - verifyAdReward(): checks a rewarded-ad token before granting anything
import { GAME_ID, LEADERBOARDS } from '../shared/constants.js';
import { BLOXITY, GAME_HOSTING_ID, REPORT_TOKEN, postJson } from './env.js';

const log = (...a) => console.log('[bloxity]', ...a);
const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

// ---------------------------------------------------------------- identity
const tokenCache = new Map(); // token -> { result, until }

function normUser(body) {
  const u = body && typeof body === 'object' ? (body.user && typeof body.user === 'object' ? body.user : body) : null;
  const id = u && (u._id || u.id || u.userId);
  if (!id || !ID_RE.test(String(id))) return null;
  const carried = Array.isArray(body && body.carriedFrom) ? body.carriedFrom.map(String).filter((x) => ID_RE.test(x)).slice(0, 5) : [];
  return {
    id: String(id),
    username: typeof u.username === 'string' ? u.username.slice(0, 32) : '',
    displayName: typeof u.displayName === 'string' ? u.displayName.slice(0, 32) : '',
    carriedFrom: carried,
  };
}

// Returns { id, username, displayName, carriedFrom } for a valid Boxity token, otherwise null.
export async function verifyToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) return null;
  const hit = tokenCache.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  let r = await postJson(`${BLOXITY.apiUrl}/v1/auth/game-token/verify`, { gameSlug: GAME_ID }, { authorization: `Bearer ${token}` });
  let user = r.ok && (r.body?.valid !== false) ? normUser(r.body) : null;
  if (!user && r.status && r.status !== 401) {
    // older tokens: fall back to /auth/me
    try {
      const res = await fetch(`${BLOXITY.apiUrl}/v1/auth/me`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
      if (res.ok) user = normUser(await res.json());
    } catch { /* treat as guest */ }
  }
  if (r.status === 0 && !user) return null; // network trouble: don't cache
  tokenCache.set(token, { user, until: Date.now() + (user ? 10 * 60e3 : 30e3) });
  if (tokenCache.size > 5000) tokenCache.clear();
  return user;
}

// Profile key "lg_<id>" (optionally "#m…" mode suffix) -> "legion_<id>", or null for guests.
export function legionUserId(key) {
  if (typeof key !== 'string' || !key.startsWith('lg_')) return null;
  const id = key.slice(3).split('#m')[0];
  return ID_RE.test(id) ? 'legion_' + id : null;
}

// ---------------------------------------------------------------- stats
export const STAT_DEFINITIONS = [
  { key: 'wins', label: 'Wins', type: 'number', sortOrder: 1 },
  { key: 'elims', label: 'Eliminations', type: 'number', sortOrder: 2 },
  { key: 'saves', label: 'Saves', type: 'number', sortOrder: 3 },
  { key: 'spikes', label: 'Spikes', type: 'number', sortOrder: 4 },
  { key: 'coins', label: 'Coins', type: 'currency', sortOrder: 5 },
  { key: 'best_streak', label: 'Best Win Streak', type: 'number', sortOrder: 6 },
];
const CEILING = { number: 1e9, seconds: 31536000000, currency: 1e12, percent: 100 };
const TYPE_OF = Object.fromEntries(STAT_DEFINITIONS.map((d) => [d.key, d.type]));
const validStat = (k, v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= CEILING[TYPE_OF[k]];

export function statValues(p) {
  const raw = {
    wins: p.stats?.wins || 0,
    elims: p.stats?.elims || 0,
    saves: p.stats?.saves || 0,
    spikes: p.stats?.spikes || 0,
    coins: Math.floor(p.coins || 0),
    best_streak: p.stats?.bestStreak || 0,
  };
  const values = {};
  for (const [k, v] of Object.entries(raw)) if (validStat(k, v)) values[k] = v;
  return values;
}

// collect(): [{ key, profile }] of profiles that changed since the last flush (server state only)
// requeue(keys): put keys back after a failed request
export function installStatReporter({ collect, requeue, intervalMs = Number(process.env.BLOXITY_STATS_INTERVAL_MS) || 60e3 }) {
  if (!REPORT_TOKEN || !GAME_HOSTING_ID) return { flush: async () => {}, stop: () => {} };
  const url = `${BLOXITY.apiUrl}/v1/games/${encodeURIComponent(GAME_HOSTING_ID)}/stats`;
  let running = null;
  const flush = () => {
    if (running) return running;
    running = (async () => {
      let rows = [];
      try { rows = collect(); } catch (e) { log('stat collect failed', e.message); return; }
      const players = [], keys = [];
      for (const { key, profile } of rows) {
        const userId = legionUserId(key);
        if (!userId || !profile) continue;
        const values = statValues(profile);
        if (!Object.keys(values).length) continue;
        players.push({ userId, values }); keys.push(key);
      }
      for (let i = 0; i < players.length; i += 200) {
        const r = await postJson(url, { definitions: STAT_DEFINITIONS, players: players.slice(i, i + 200) }, { authorization: `Bearer ${REPORT_TOKEN}` });
        log(`stats ${r.status}`, typeof r.body === 'object' ? JSON.stringify(r.body) : String(r.body ?? r.error).slice(0, 300));
        if (!r.ok && (r.status === 0 || r.status >= 500)) requeue(keys.slice(i, i + 200));
      }
    })().catch((e) => log('stats flush error', e.message)).finally(() => { running = null; });
    return running;
  };
  const timer = setInterval(flush, intervalMs); timer.unref?.();
  log('stat reporter installed for', GAME_HOSTING_ID);
  return { flush, stop: () => clearInterval(timer) };
}

// ---------------------------------------------------------------- leaderboards
const pendingScores = new Map(); // `${board}|${userId}` -> score (best kept per batch)
export function queueScore(board, key, score) {
  const userId = legionUserId(key);
  if (!userId || typeof score !== 'number' || !Number.isFinite(score) || score < 0) return;
  const k = `${board}|${userId}`;
  pendingScores.set(k, Math.max(pendingScores.get(k) ?? 0, Math.floor(score)));
}
let flushBoards = null;
// Report queued scores now (e.g. at round end). No-op without the reporter.
export function flushLeaderboards() { if (flushBoards) flushBoards(); }
export function installLeaderboardReporter({ intervalMs = Number(process.env.BLOXITY_LEADERBOARD_INTERVAL_MS) || 15e3 } = {}) {
  if (!REPORT_TOKEN || !GAME_HOSTING_ID) return { flush: async () => {}, stop: () => {} };
  const url = `${BLOXITY.apiUrl}/v1/leaderboards/hosted/${encodeURIComponent(GAME_HOSTING_ID)}/report`;
  let running = null;
  const flush = () => {
    if (running) return running;
    running = (async () => {
      if (!pendingScores.size) return;
      const scores = [...pendingScores.entries()].map(([k, score]) => { const [board, userId] = k.split('|'); return { board, userId, score }; });
      pendingScores.clear();
      for (let i = 0; i < scores.length; i += 200) {
        const batch = scores.slice(i, i + 200);
        const r = await postJson(url, { boards: LEADERBOARDS, scores: batch }, { authorization: `Bearer ${REPORT_TOKEN}` });
        log(`leaderboard ${r.status}`, typeof r.body === 'object' ? JSON.stringify(r.body) : String(r.body ?? r.error).slice(0, 300));
        if (!r.ok && (r.status === 0 || r.status >= 500)) for (const s of batch) queueScore(s.board, 'lg_' + s.userId.slice(7), s.score);
      }
    })().catch((e) => log('leaderboard flush error', e.message)).finally(() => { running = null; });
    return running;
  };
  flushBoards = flush;
  const timer = setInterval(flush, intervalMs); timer.unref?.();
  return { flush, stop: () => clearInterval(timer) };
}

// ---------------------------------------------------------------- rewarded ads
// true only when Boxity confirms the token (single use, this game, within 5 minutes).
export async function verifyAdReward(rewardToken) {
  if (typeof rewardToken !== 'string' || rewardToken.length < 8 || rewardToken.length > 4096) return false;
  const r = await postJson(`${BLOXITY.apiUrl}/v1/ads/reward/verify`, { gameSlug: GAME_ID, rewardToken });
  if (!r.ok || !(r.body && r.body.valid === true)) log('ad reward verify', r.status, JSON.stringify(r.body ?? r.error).slice(0, 200));
  return !!(r.ok && r.body && r.body.valid === true);
}
