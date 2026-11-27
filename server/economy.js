// Every coin, pack, equip, quest, achievement and wheel decision. Server-side only; the
// client asks, this answers, and the private profile goes back to its owner.
import { DAILY_LOGIN, ABILITIES, PACK_DUP_REFUND, WHEEL_COOLDOWN } from '../shared/constants.js';
import { PACKS, rollPack, BALL_BY_ID, BOOM_BY_ID, ACHIEVEMENTS, WHEEL_PRIZES, titleUnlocked } from '../shared/items.js';
import { today, rollQuests } from './profiles.js';

const yesterday = () => new Date(Date.now() - 86400e3).toISOString().slice(0, 10);

export function openPack(p, packId, free = false) {
  const pack = PACKS[packId];
  if (!pack) return { error: 'Unknown pack' };
  if (!free && p.coins < pack.price) return { error: `You need ${pack.price} coins` };
  if (!free) p.coins -= pack.price;
  const item = rollPack(pack);
  const list = pack.kind === 'ball' ? p.owned.balls : p.owned.booms;
  const dup = list.includes(item.id);
  let refund = 0;
  if (dup) { refund = Math.round((pack.price || 100) * PACK_DUP_REFUND); p.coins += refund; } else list.push(item.id);
  p.stats.packs = (p.stats.packs || 0) + 1;
  return { pack: pack.id, kind: pack.kind, item: item.id, dup, refund };
}

export function equip(p, { kind, id } = {}) {
  if (kind === 'ball' && p.owned.balls.includes(id) && BALL_BY_ID[id]) p.eq.ball = id;
  else if (kind === 'boom' && p.owned.booms.includes(id) && BOOM_BY_ID[id]) p.eq.boom = id;
  else if (kind === 'ability' && p.owned.abilities.includes(id) && ABILITIES[id]) p.eq.ability = id;
  else if (kind === 'title' && (id === '' || titleUnlocked(p.stats, id))) p.eq.title = String(id).slice(0, 24);
  else return { error: 'Not owned' };
  return { ok: true };
}

export function buyAbility(p, id) {
  const a = ABILITIES[id];
  if (!a) return { error: 'Unknown ability' };
  if (p.owned.abilities.includes(id)) return { error: 'Already owned' };
  if (p.coins < a.price) return { error: `You need ${a.price} coins` };
  p.coins -= a.price;
  p.owned.abilities.push(id);
  p.eq.ability = id;
  return { ok: true, text: `${a.name} unlocked and equipped!` };
}

export function claimDaily(p) {
  if (p.login.last === today()) return { error: 'Come back tomorrow!' };
  if (p.login.last && p.login.last !== yesterday()) p.login.day = 0; // streak broken
  const day = p.login.day % 7;
  const coins = DAILY_LOGIN[day];
  p.coins += coins;
  p.login.last = today();
  p.login.day = (day + 1) % 7;
  return { ok: true, coins, text: `Day ${day + 1} reward: +${coins} coins` };
}

export function claimQuest(p, i) {
  const q = p.quests.list[i | 0];
  if (!q || q.claimed) return { error: 'Nothing to claim' };
  if ((p.stats[q.stat] || 0) - q.base < q.goal) return { error: 'Not finished yet' };
  q.claimed = true;
  p.coins += q.coins;
  return { ok: true, coins: q.coins, text: `Quest complete: +${q.coins} coins` };
}

export function refreshQuests(p) {
  if (p.quests.refreshDay === today()) return { error: 'One refresh a day' };
  p.quests.refreshDay = today();
  const keep = p.quests.list.filter((q) => q.claimed);
  const fresh = rollQuests().filter((q) => !keep.some((k) => k.id === q.id)).slice(0, 3 - keep.length);
  for (const q of fresh) q.base = p.stats[q.stat] || 0;
  p.quests.list = [...keep, ...fresh];
  return { ok: true, text: 'New quests!' };
}

export function claimAchievement(p, { stat, tier } = {}) {
  const a = ACHIEVEMENTS.find((x) => x.stat === stat);
  const t = a && a.tiers[tier | 0];
  if (!t) return { error: 'Unknown achievement' };
  const key = `${stat}:${tier | 0}`;
  if (p.ach.includes(key)) return { error: 'Already claimed' };
  if ((p.stats[stat] || 0) < t.n) return { error: 'Not reached yet' };
  p.ach.push(key);
  p.coins += t.coins;
  return { ok: true, coins: t.coins, text: `${t.name}: +${t.coins} coins (title unlocked)` };
}

export function spinWheel(p) {
  if ((p.stats.playSecs || 0) < (p.wheelAt || 0)) return { error: 'No free spin yet' };
  const total = WHEEL_PRIZES.reduce((a, b) => a + b.w, 0);
  let r = Math.random() * total, slice = 0;
  for (let i = 0; i < WHEEL_PRIZES.length; i++) { r -= WHEEL_PRIZES[i].w; if (r < 0) { slice = i; break; } }
  const prize = WHEEL_PRIZES[slice];
  p.wheelAt = (p.stats.playSecs || 0) + WHEEL_COOLDOWN;
  let pack = null;
  if (prize.coins) p.coins += prize.coins;
  if (prize.pack) pack = openPack(p, prize.pack, true);
  return { ok: true, slice, label: prize.label, coins: prize.coins || 0, pack };
}
