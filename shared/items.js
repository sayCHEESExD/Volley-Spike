// Catalogue: balls (what the ball looks like when you hit it), explosions (what a slab you
// destroy blows up as), abilities (key R), packs, quests, achievements and wheel prizes.
// Everything is earned with coins won in game; nothing is sold for money.
import { ABILITIES } from './constants.js';

export const RARITY = {
  common: { label: 'Common', color: '#b9c2cc', weight: 60 },
  rare: { label: 'Rare', color: '#3fa0ff', weight: 28 },
  epic: { label: 'Epic', color: '#b05cff', weight: 10 },
  legendary: { label: 'Legendary', color: '#ffb020', weight: 2 },
};

// look: drawn procedurally by the client (client/src/render/balls.js). trail: trail colour.
export const BALLS = [
  { id: 'default', name: 'Default', rarity: 'common', desc: 'The classic ball every player starts with.', look: 'plain', c: ['#ffffff', '#d8dde3'], trail: '#ffffff' },
  { id: 'volley', name: 'Volley Ball', rarity: 'common', desc: 'Blue and yellow panels.', look: 'panels', c: ['#ffd23a', '#2a62d8', '#ffffff'], trail: '#ffe27a' },
  { id: 'beach', name: 'Beach Ball', rarity: 'common', desc: 'Summer stripes.', look: 'segments', c: ['#ff4747', '#ffd84a', '#3fb8ff', '#ffffff', '#46d36a'], trail: '#ffd84a' },
  { id: 'basket', name: 'Basket Ball', rarity: 'common', desc: 'Grippy and orange.', look: 'seams', c: ['#f07b25', '#2b1a10'], trail: '#ff9a4a' },
  { id: 'soccer', name: 'Foot Ball', rarity: 'common', desc: 'Black patches on white.', look: 'patches', c: ['#ffffff', '#1d1d1d'], trail: '#e8e8e8' },
  { id: 'bowling', name: 'Bowling Ball', rarity: 'rare', desc: 'Heavy-looking marbled purple.', look: 'marble', c: ['#5a2bb5', '#9a6bff', '#28124f'], trail: '#9a6bff' },
  { id: 'ice', name: 'Ice Ball', rarity: 'rare', desc: 'Frosted crystal.', look: 'crystal', c: ['#bff4ff', '#5fd4ff', '#ffffff'], trail: '#9fe9ff' },
  { id: 'barcode', name: 'Barcode Ball', rarity: 'rare', desc: 'Scan to win.', look: 'stripes', c: ['#ececec', '#151515'], trail: '#151515' },
  { id: 'volcanic', name: 'Volcanic Ball', rarity: 'epic', desc: 'Cooling rock with lava cracks.', look: 'cracks', c: ['#2a1c18', '#ff5a1a', '#ffc23a'], trail: '#ff6a2a' },
  { id: 'aurora', name: 'Aurora Ball', rarity: 'epic', desc: 'Northern lights in a sphere.', look: 'gradient', c: ['#22e3a4', '#7a5cff', '#ff6ad5'], trail: '#7affd0' },
  { id: 'neon', name: 'Neon Ring Ball', rarity: 'epic', desc: 'Neon rings that glow.', look: 'rings', c: ['#14112b', '#ff2bd6', '#39f0ff'], trail: '#ff2bd6' },
  { id: 'dragon', name: 'Dragon Ball', rarity: 'legendary', desc: 'Scaled and smouldering.', look: 'scales', c: ['#b3121e', '#ff7a1a', '#3a0508'], trail: '#ff3a1a' },
  { id: 'galaxy', name: 'Galaxy Ball', rarity: 'legendary', desc: 'A night sky you can spike.', look: 'stars', c: ['#0c0f3a', '#5b3cff', '#ffffff'], trail: '#8a6bff' },
  { id: 'golden', name: 'Golden Ball', rarity: 'legendary', desc: 'Solid gold. Probably.', look: 'metal', c: ['#ffcf3a', '#b8860b', '#fff3b0'], trail: '#ffd84a' },
];

// fx: particle style for the slab explosion (client/src/render/fx.js)
export const EXPLOSIONS = [
  { id: 'classic', name: 'Classic', rarity: 'common', desc: 'A good old fireball.', fx: 'fire', c: ['#ff6a1a', '#ffd23a', '#3a2a22'] },
  { id: 'confetti', name: 'Confetti', rarity: 'common', desc: 'Party time.', fx: 'confetti', c: ['#ff4a6e', '#ffd84a', '#3fb8ff', '#46d36a', '#b05cff'] },
  { id: 'water', name: 'Water', rarity: 'common', desc: 'A big splash.', fx: 'splash', c: ['#3fb8ff', '#bff4ff', '#ffffff'] },
  { id: 'hearts', name: 'Hearts', rarity: 'common', desc: 'Eliminated with love.', fx: 'hearts', c: ['#ff4a8e', '#ff9ac0', '#ffffff'] },
  { id: 'fireworks', name: 'Fireworks', rarity: 'rare', desc: 'Rockets and sparks.', fx: 'fireworks', c: ['#ff3a3a', '#3fb8ff', '#ffd84a', '#ffffff'] },
  { id: 'electro', name: 'Zap', rarity: 'rare', desc: 'Crackling blue arcs.', fx: 'electric', c: ['#5fd4ff', '#ffffff', '#2a62d8'] },
  { id: 'crystal', name: 'Crystal', rarity: 'rare', desc: 'Shatters into shards.', fx: 'shards', c: ['#9fe9ff', '#ffffff', '#b05cff'] },
  { id: 'toxic', name: 'Toxic', rarity: 'epic', desc: 'Glowing green fallout.', fx: 'toxic', c: ['#7dff3a', '#2ed16a', '#1b3a10'] },
  { id: 'starburst', name: 'Starburst', rarity: 'epic', desc: 'A burst of golden stars.', fx: 'stars', c: ['#ffd84a', '#ffffff', '#ff9a1f'] },
  { id: 'void', name: 'Void Rift', rarity: 'legendary', desc: 'Pulled into a purple void.', fx: 'void', c: ['#7a2bff', '#160a33', '#ff6ad5'] },
  { id: 'gold', name: 'Gold Rush', rarity: 'legendary', desc: 'Rich people explode differently.', fx: 'gold', c: ['#ffcf3a', '#fff3b0', '#b8860b'] },
];

export const ABILITY_LIST = Object.entries(ABILITIES).map(([id, a]) => ({ id, ...a }));

export const PACKS = {
  ball: { id: 'ball', name: 'Ball Pack', kind: 'ball', price: 100, desc: 'A random ball. Any rarity.', odds: { common: 64, rare: 26, epic: 8, legendary: 2 }, c: ['#2a7bff', '#5fd4ff'] },
  deluxe: { id: 'deluxe', name: 'Deluxe Ball Pack', kind: 'ball', price: 450, desc: 'Rare or better, guaranteed.', odds: { common: 0, rare: 62, epic: 30, legendary: 8 }, c: ['#b05cff', '#ff6ad5'] },
  boom: { id: 'boom', name: 'Explosions Pack', kind: 'boom', price: 100, desc: 'A random explosion effect.', odds: { common: 64, rare: 26, epic: 8, legendary: 2 }, c: ['#ff6a1a', '#ffd23a'] },
};

export const BALL_BY_ID = Object.fromEntries(BALLS.map((b) => [b.id, b]));
export const BOOM_BY_ID = Object.fromEntries(EXPLOSIONS.map((b) => [b.id, b]));

export function rollPack(pack, rand = Math.random) {
  const list = pack.kind === 'ball' ? BALLS.filter((b) => b.id !== 'default') : EXPLOSIONS.filter((b) => b.id !== 'classic');
  const total = Object.values(pack.odds).reduce((a, b) => a + b, 0);
  let r = rand() * total, rarity = 'common';
  for (const [k, w] of Object.entries(pack.odds)) { r -= w; if (r < 0) { rarity = k; break; } }
  const pool = list.filter((i) => i.rarity === rarity);
  const from = pool.length ? pool : list;
  return from[Math.floor(rand() * from.length)];
}

// ---- daily quests (3 a day from this pool)
export const QUEST_POOL = [
  { id: 'win', label: 'Win {n} rounds', stat: 'wins', n: 2, coins: 300 },
  { id: 'play', label: 'Play {n} matches', stat: 'matches', n: 3, coins: 90 },
  { id: 'pack', label: 'Open {n} pack', stat: 'packs', n: 1, coins: 60 },
  { id: 'spike', label: 'Spike the ball {n} times', stat: 'spikes', n: 20, coins: 70 },
  { id: 'save', label: 'Make {n} saves', stat: 'saves', n: 15, coins: 70 },
  { id: 'elim', label: 'Eliminate {n} players', stat: 'elims', n: 5, coins: 120 },
  { id: 'perfect', label: 'Hit {n} perfect touches', stat: 'perfects', n: 10, coins: 80 },
  { id: 'ability', label: 'Use your ability {n} times', stat: 'abilities', n: 8, coins: 60 },
];

// ---- achievements (career tab). Each tier pays once.
export const ACHIEVEMENTS = [
  { stat: 'saves', title: 'Saves', tiers: [{ n: 10, name: 'Safe Hands', coins: 25 }, { n: 100, name: 'Brick Wall', coins: 100 }, { n: 1000, name: 'Iron Dome', coins: 400 }] },
  { stat: 'elims', title: 'Eliminations', tiers: [{ n: 5, name: 'First Blood', coins: 25 }, { n: 100, name: 'Bomber', coins: 120 }, { n: 1000, name: 'Demolition Expert', coins: 500 }] },
  { stat: 'wins', title: 'Wins', tiers: [{ n: 1, name: 'Winner', coins: 50 }, { n: 25, name: 'Champion', coins: 200 }, { n: 250, name: 'Legend', coins: 1000 }] },
  { stat: 'spikes', title: 'Spikes', tiers: [{ n: 20, name: 'Spiker', coins: 25 }, { n: 300, name: 'Hammer', coins: 120 }, { n: 3000, name: 'Thunder Arm', coins: 500 }] },
  { stat: 'perfects', title: 'Perfect Touches', tiers: [{ n: 10, name: 'Clean Hands', coins: 25 }, { n: 200, name: 'Surgeon', coins: 150 }, { n: 2000, name: 'Flawless', coins: 600 }] },
  { stat: 'bestStreak', title: 'Win Streak', tiers: [{ n: 2, name: 'Double Up', coins: 40 }, { n: 5, name: 'Unstoppable', coins: 250 }, { n: 10, name: 'Untouchable', coins: 800 }] },
];
// Titles are the achievement tier names; the player can wear any one they unlocked.
export const titleUnlocked = (stats, name) => ACHIEVEMENTS.some((a) => a.tiers.some((t) => t.name === name && (stats[a.stat] || 0) >= t.n));

// ---- prize wheel (free spin every WHEEL_COOLDOWN seconds of play)
export const WHEEL_PRIZES = [
  { label: '20 Coins', coins: 20, w: 26, c: '#ffd23a' },
  { label: '50 Coins', coins: 50, w: 22, c: '#ff9a1f' },
  { label: 'Ball Pack', pack: 'ball', w: 14, c: '#2a7bff' },
  { label: '80 Coins', coins: 80, w: 16, c: '#ffd23a' },
  { label: 'Boom Pack', pack: 'boom', w: 12, c: '#ff4a6e' },
  { label: '150 Coins', coins: 150, w: 7, c: '#ff9a1f' },
  { label: 'Deluxe Pack', pack: 'deluxe', w: 2, c: '#b05cff' },
  { label: '400 Coins', coins: 400, w: 1, c: '#46d36a' },
];
