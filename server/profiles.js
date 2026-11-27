// Player profiles: coins, owned / equipped cosmetics and abilities, career stats, daily login,
// daily quests, achievements and the wheel. Uses Bloxity's managed Mongo (MONGODB_URI) when
// present, otherwise a local JSON file so local development works with zero setup.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AD_REWARD, WHEEL_COOLDOWN } from '../shared/constants.js';
import { QUEST_POOL } from '../shared/items.js';

const DATA_DIR = process.env.VBALL_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const FILE = path.join(DATA_DIR, 'profiles.json');
const cache = new Map();
const dirty = new Set();
let mongo = null;
let fileDb = null;

export const today = () => new Date().toISOString().slice(0, 10);
const STATS = { wins: 0, elims: 0, saves: 0, spikes: 0, perfects: 0, matches: 0, abilities: 0, packs: 0, streak: 0, bestStreak: 0, playSecs: 0, bumps: 0 };

export function rollQuests(seed = Math.random) {
  const pool = [...QUEST_POOL];
  const out = [];
  while (out.length < 3 && pool.length) { const q = pool.splice(Math.floor(seed() * pool.length), 1)[0]; out.push({ id: q.id, stat: q.stat, goal: q.n, coins: q.coins, label: q.label.replace('{n}', q.n), base: 0, claimed: false }); }
  return out;
}

export function freshProfile(key) {
  return {
    _id: key, coins: 0, stats: { ...STATS },
    owned: { balls: ['default'], booms: ['classic'], abilities: ['adrenaline'] },
    eq: { ball: 'default', boom: 'classic', ability: 'adrenaline', title: '' },
    login: { last: '', day: 0 }, // day = index of the NEXT reward (0..6)
    quests: { day: '', list: [], refreshDay: '' },
    ach: [], // claimed "stat:tier"
    wheelAt: WHEEL_COOLDOWN * 0, // playSecs at which the next free spin unlocks (first one is free)
    tut: false, adAt: 0, carriedTo: null, created: Date.now(),
  };
}

function normalize(p, key) {
  const f = freshProfile(key);
  const out = { ...f, ...(p || {}) };
  if (typeof out.coins !== 'number' || !Number.isFinite(out.coins) || out.coins < 0) out.coins = 0;
  out.stats = { ...f.stats, ...(out.stats || {}) };
  out.owned = { ...f.owned, ...(out.owned || {}) };
  for (const k of ['balls', 'booms', 'abilities']) if (!Array.isArray(out.owned[k])) out.owned[k] = f.owned[k];
  out.eq = { ...f.eq, ...(out.eq || {}) };
  out.login = { ...f.login, ...(out.login || {}) };
  out.quests = { ...f.quests, ...(out.quests || {}) };
  if (!Array.isArray(out.ach)) out.ach = [];
  freshenQuests(out);
  return out;
}

// new day: three new quests, measured from the player's stats right now
export function freshenQuests(p) {
  if (p.quests.day === today() && p.quests.list.length) return;
  p.quests.day = today();
  p.quests.list = rollQuests();
  for (const q of p.quests.list) q.base = p.stats[q.stat] || 0;
}

export async function initProfiles() {
  const uri = process.env.MONGODB_URI;
  if (uri) {
    try {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
      await client.connect();
      mongo = { client, col: client.db().collection('profiles') };
      console.log('[profiles] using managed Mongo');
      return;
    } catch (e) { console.warn('[profiles] Mongo unavailable, falling back to file store:', e.message); }
  }
  try { fileDb = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { fileDb = {}; }
  console.log('[profiles] using file store', FILE);
}

export const persistent = (key) => typeof key === 'string' && !key.startsWith('anon:');

export async function loadProfile(key) {
  if (cache.has(key)) return cache.get(key);
  let raw = null;
  if (persistent(key)) {
    try { raw = mongo ? await mongo.col.findOne({ _id: key }) : fileDb[key] || null; } catch (e) { console.warn('[profiles] load failed', e.message); }
  }
  const p = normalize(raw, key);
  Object.defineProperty(p, '_stored', { value: !!raw, enumerable: false, writable: true });
  cache.set(key, p);
  return p;
}

const statDirty = new Set();
const lastKnown = new Map();
export function touch(key) { if (persistent(key)) { dirty.add(key); statDirty.add(key); } }
export function takeStatDirty() {
  const rows = [];
  for (const k of statDirty) { const p = cache.get(k) || lastKnown.get(k); if (p) rows.push({ key: k, profile: p }); }
  statDirty.clear(); lastKnown.clear();
  return rows;
}
export function requeueStats(keys) { for (const k of keys) statDirty.add(k); }

export function hasNoProgress(p) {
  return !p._stored && !p.coins && !(p.stats && (p.stats.matches || p.stats.wins)) && !p.tut;
}

// Copy a Boxity guest's saved progress into a fresh account, once.
export async function carryGuestProgress(accountKey, guestIds) {
  const acc = await loadProfile(accountKey);
  if (!hasNoProgress(acc)) return false;
  for (const gid of guestIds.slice(0, 1)) {
    const gkey = 'g_bx_' + gid;
    const g = await loadProfile(gkey);
    if (!g._stored || g.carriedTo) { cache.delete(gkey); continue; }
    for (const f of ['coins', 'stats', 'owned', 'eq', 'login', 'quests', 'ach', 'wheelAt', 'tut']) acc[f] = JSON.parse(JSON.stringify(g[f]));
    g.carriedTo = accountKey;
    touch(gkey); touch(accountKey);
    await flush();
    cache.delete(gkey);
    return true;
  }
  return false;
}

export async function flush() {
  if (!dirty.size) return;
  const keys = [...dirty]; dirty.clear();
  try {
    if (mongo) await Promise.all(keys.map((k) => { const p = cache.get(k); return p ? mongo.col.replaceOne({ _id: k }, p, { upsert: true }) : null; }));
    else {
      for (const k of keys) { const p = cache.get(k); if (p) fileDb[k] = p; }
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE + '.tmp', JSON.stringify(fileDb));
      fs.renameSync(FILE + '.tmp', FILE);
    }
  } catch (e) {
    console.warn('[profiles] flush failed', e.message);
    for (const k of keys) dirty.add(k);
  }
}

export async function release(key) { await flush(); const p = cache.get(key); if (p && statDirty.has(key)) lastKnown.set(key, p); cache.delete(key); }

// Top players by a stat across stored profiles (file store: all; Mongo: one query).
export async function topBy(stat, n = 8) {
  try {
    if (mongo) {
      const rows = await mongo.col.find({ [`stats.${stat}`]: { $gt: 0 } }, { projection: { name: 1, [`stats.${stat}`]: 1 } }).sort({ [`stats.${stat}`]: -1 }).limit(n).toArray();
      return rows.map((r) => ({ name: r.name || 'Player', v: r.stats[stat] }));
    }
    const all = new Map(Object.entries(fileDb || {}));
    for (const [k, p] of cache) all.set(k, p);
    return [...all.values()].filter((p) => p.name && (p.stats?.[stat] || 0) > 0).sort((a, b) => b.stats[stat] - a.stats[stat]).slice(0, n).map((p) => ({ name: p.name, v: p.stats[stat] }));
  } catch { return []; }
}

// This week's top players by a weekly counter (week.wins / week.elims), current week only.
export async function topWeekly(key, weekId, n = 10) {
  try {
    if (mongo) {
      const field = 'week.' + key;
      const rows = await mongo.col.find({ 'week.id': weekId, [field]: { $gt: 0 } }, { projection: { name: 1, week: 1 } }).sort({ [field]: -1 }).limit(n).toArray();
      return rows.map((r) => ({ name: r.name || 'Player', v: r.week[key] }));
    }
    const all = new Map(Object.entries(fileDb || {}));
    for (const [k, p] of cache) all.set(k, p);
    return [...all.values()].filter((p) => p.name && p.week && p.week.id === weekId && (p.week[key] || 0) > 0).sort((a, b) => b.week[key] - a.week[key]).slice(0, n).map((p) => ({ name: p.name, v: p.week[key] }));
  } catch { return []; }
}

const timer = setInterval(() => { flush(); }, 5000);
timer.unref?.();

export function publicProfile(p) {
  freshenQuests(p);
  const st = p.stats;
  return {
    coins: Math.floor(p.coins), stats: { ...st }, owned: p.owned, eq: p.eq,
    login: { day: p.login.day % 7, claimable: p.login.last !== today() },
    quests: p.quests.list.map((q) => ({ label: q.label, goal: q.goal, coins: q.coins, prog: Math.min(q.goal, (st[q.stat] || 0) - q.base), claimed: q.claimed })),
    questRefresh: p.quests.refreshDay !== today(),
    ach: p.ach,
    wheelIn: Math.max(0, Math.ceil((p.wheelAt || 0) - (st.playSecs || 0))),
    tut: !!p.tut,
    adWait: Math.max(0, Math.ceil(((p.adAt || 0) + AD_REWARD.cooldown * 1000 - Date.now()) / 1000)),
  };
}
