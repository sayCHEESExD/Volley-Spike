// Real Boxity outfits for bots, ported from the [FPS] Fling server.
// Bots should look like the people around them, and players wear Boxity avatars, so a
// bot wears real catalogue items (skins, shirts, pants, faces, hair, hats, back items,
// masks), weighted by how many players own them. Loaded once at startup from the told
// environment's API; if it can't be reached, a short list of known items is used.
import { BLOXITY } from './env.js';

const POOL = { skin: 80, shirt: 50, pants: 50, face: 40, hair: 70, hat: 70, back: 25, mask: 10 };
const FALLBACK = {
  skin: ['69cb00f6c3c4aac219abd8c3', '6a64132cc15c92a8d8f7e0fc', '6a33eae79e8362499889c351'],
  shirt: [], pants: [], face: [],
  hair: ['69ca60fc2ef6dd0130f58d9a', '69c816d53ecd845acf8231fd'],
  hat: ['69c816be3ecd845acf82310d', '6a444a35093f2bbfc2cee1a3', '69c816bd3ecd845acf8230f9', '69c816be3ecd845acf82310a'],
  back: ['69c816de3ecd845acf823254', '69c816df3ecd845acf823260', '69c816e13ecd845acf823272'],
  mask: ['69c816c63ecd845acf823161'],
};
const pools = Object.fromEntries(Object.entries(FALLBACK).map(([k, ids]) => [k, ids.map((id) => ({ id, weight: 1 }))]));

async function load(slot) {
  const res = await fetch(`${BLOXITY.apiUrl}/v1/avatar/items?type=${slot}&limit=200`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  const items = (body.items || [])
    .filter((it) => typeof it.id === 'string' && /^[0-9a-f]{24}$/i.test(it.id) && it.type === slot && it.disabled !== true && it.approved !== false)
    .map((it) => ({ id: it.id, weight: Math.max(1, Number(it.stats && it.stats.owned) || 1) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, POOL[slot]);
  if (items.length) pools[slot] = items;
}

let loading = null;
// Fetch once (never throws; the fallback lists stay on failure).
export function loadAvatarCatalog() {
  return (loading ||= (async () => {
    const slots = Object.keys(POOL);
    const results = await Promise.allSettled(slots.map(load));
    const failed = results.filter((r) => r.status === 'rejected').length;
    const sizes = slots.map((s) => `${s} ${pools[s].length}`).join(', ');
    console.log(`[bots] avatar catalogue ${failed ? `partly unavailable (${failed}/${slots.length}), fallbacks in use` : 'loaded'}: ${sizes}`);
  })());
}

// sqrt-weighted: popular items show up most without everyone wearing the same one
function draw(slot, random) {
  const pool = pools[slot];
  if (!pool.length) return '';
  let total = 0;
  for (const p of pool) total += Math.sqrt(p.weight);
  let roll = random() * total;
  for (const p of pool) { roll -= Math.sqrt(p.weight); if (roll < 0) return p.id; }
  return pool[pool.length - 1].id;
}

// A plausible player outfit: { eq, pr } in the same shape players send.
export function randomOutfit(random = Math.random) {
  const eq = {};
  const maybe = (p, slot, field) => { if (random() < p) { const id = draw(slot, random); if (id) eq[field] = id; } };
  maybe(0.5, 'skin', 'skinId');
  maybe(0.75, 'shirt', 'shirtId');
  maybe(0.75, 'pants', 'pantsId');
  maybe(0.55, 'face', 'faceId');
  maybe(0.65, 'hair', 'hairId');
  maybe(0.3, 'hat', 'hatId');
  maybe(0.12, 'back', 'backId');
  maybe(0.06, 'mask', 'maskId');
  return { eq, pr: {} };
}
