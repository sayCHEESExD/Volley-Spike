// The world as both sides see it: floating islands over the sea, the slab formations, and
// the walkable regions players are kept inside. y = 0 is every walkable top surface.
import { SLAB, MOVE } from './constants.js';

const rect = (minX, maxX, minZ, maxZ) => ({ minX, maxX, minZ, maxZ });

// Layout seen from the spawn (facing -z): leaderboard boards along the front edge, the match
// arena floating to the LEFT (-x), the practice court to the RIGHT (+x). The practice court is
// its own island: the yellow Practice pad on the lobby's right edge teleports you onto it.
export const LOBBY = rect(-30, 30, -22, 24);
export const BRIDGE = null;
export const PRACTICE = { cx: 66, cz: 0, size: SLAB.size }; // 2 x 2 practice cells
export const PRACTICE_RECT = rect(PRACTICE.cx - 14, PRACTICE.cx + 14, -14, 14);
export const PRACTICE_PAD = rect(23, 29.5, -5, 5);
export const SPAWN = { x: 0, z: 9, yaw: Math.PI }; // yaw PI faces -z (towards the boards)

// The match arena floats left of the lobby; tutorial courts far east (one per learner).
export const ARENA = { cx: -68, cz: 0 };
export const tutorialCenter = (k) => ({ cx: 170 + (k % 8) * 70, cz: 90 + Math.floor(k / 8) * 70 });

// Lobby furniture: pack stands (front left), the prize wheel (right, by the Practice pad) and the
// row of five leaderboard boards along the front edge, facing the spawn.
export const PACK_STANDS = [
  { id: 'ball', x: -22, z: 4 },
  { id: 'boom', x: -22, z: 14 },
  { id: 'deluxe', x: -22, z: -6 },
];
export const WHEEL = { x: 22, z: 15 };
export const BOARDS = [
  { id: 'bestStreak', x: -18.4, z: -19, title: 'HIGHEST STREAK', col: 'Streak' },
  { id: 'playSecs', x: -9.2, z: -19.6, title: 'MOST TIME PLAYED', col: 'Time' },
  { id: 'wins', x: 0, z: -19.8, title: 'MOST WINS', col: 'Wins' },
  { id: 'elims', x: 9.2, z: -19.6, title: 'MOST ELIMS', col: 'Elims' },
  { id: 'saves', x: 18.4, z: -19, title: 'MOST SAVES', col: 'Saves' },
];
export const SOLIDS = [
  ...PACK_STANDS.map((s) => ({ minX: s.x - 1.6, maxX: s.x + 1.6, minZ: s.z - 1.6, maxZ: s.z + 1.6 })),
  { minX: WHEEL.x - 0.8, maxX: WHEEL.x + 0.8, minZ: WHEEL.z - 2.2, maxZ: WHEEL.z + 2.2 },
  ...BOARDS.map((b) => ({ minX: b.x - 4.2, maxX: b.x + 4.2, minZ: b.z - 0.5, maxZ: b.z + 0.5 })),
];

export const LOBBY_REGIONS = [LOBBY];

const inside = (r, x, z, m = 0) => x >= r.minX + m && x <= r.maxX - m && z >= r.minZ + m && z <= r.maxZ - m;

// Keep (x, z) inside the union of regions (nearest region wins) and out of the solids.
export function clampToRegions(p, regions, solids = null) {
  const m = MOVE.radius;
  let ok = false;
  for (const r of regions) if (inside(r, p.x, p.z, m)) { ok = true; break; }
  if (!ok) {
    let best = null, bd = Infinity;
    for (const r of regions) {
      const x = Math.max(r.minX + m, Math.min(r.maxX - m, p.x));
      const z = Math.max(r.minZ + m, Math.min(r.maxZ - m, p.z));
      const d = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d < bd) { bd = d; best = { x, z }; }
    }
    if (best) { p.x = best.x; p.z = best.z; }
  }
  if (solids) {
    for (const s of solids) {
      if (p.x > s.minX - m && p.x < s.maxX + m && p.z > s.minZ - m && p.z < s.maxZ + m) {
        // push out along the shallowest axis
        const dl = p.x - (s.minX - m), dr = s.maxX + m - p.x, dn = p.z - (s.minZ - m), df = s.maxZ + m - p.z;
        const mn = Math.min(dl, dr, dn, df);
        if (mn === dl) p.x = s.minX - m; else if (mn === dr) p.x = s.maxX + m; else if (mn === dn) p.z = s.minZ - m; else p.z = s.maxZ + m;
      }
    }
  }
  return p;
}

// Row layout for n players: always a full rectangle (never a ragged or round footprint).
// Rows with fewer cells get wider cells, so the overall shape stays four-sided.
export function rowsFor(n) {
  if (n <= 1) return [1];
  if (n === 2) return [2];
  if (n === 3) return [2, 1];
  if (n === 4) return [2, 2];
  if (n === 5) return [3, 2];
  return [3, 3];
}

// Cells for n players around (cx, cz): [{ x, z, w, d }] (centre + full size), row-major from -z.
export function formation(n, cx, cz) {
  const rows = rowsFor(n);
  const cols = Math.max(...rows);
  const W = cols * SLAB.size, D = rows.length * SLAB.size;
  const cells = [];
  rows.forEach((k, ri) => {
    const w = W / k;
    for (let i = 0; i < k; i++) {
      cells.push({ x: cx - W / 2 + w * (i + 0.5), z: cz - D / 2 + SLAB.size * (ri + 0.5), w, d: SLAB.size });
    }
  });
  return cells;
}

// The rectangle a player standing on `cell` may walk in (inside its white lines).
export const cellRect = (c) => rect(c.x - c.w / 2 + SLAB.gap, c.x + c.w / 2 - SLAB.gap, c.z - c.d / 2 + SLAB.gap, c.z + c.d / 2 - SLAB.gap);

export const pointInCell = (c, x, z) => Math.abs(x - c.x) <= c.w / 2 + 1e-6 && Math.abs(z - c.z) <= c.d / 2 + 1e-6;
