// Character movement: run, jump and dive on flat island tops (y = 0). The local client
// simulates its own player with this (instant response); the server re-checks every reported
// position against the same limits; server-side bots move with it too.
import { MOVE, DIVE } from './constants.js';

export const newBody = (x = 0, z = 0, yaw = 0) => ({ x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, grounded: true, diveT: 0, proneT: 0, dx: 0, dz: 0, jumps: 0 });

// input: { wx, wz } world-space wish direction (length <= 1), jump (edge), dive (edge)
// opts: { speedMul, clamp(body) }
export function stepBody(b, input, dt, opts = {}) {
  const speedMul = opts.speedMul || 1;
  const ev = { jumped: false, landed: false, dived: false };
  if (b.diveT > 0) {
    b.diveT -= dt;
    b.vx = b.dx * DIVE.speed * speedMul; b.vz = b.dz * DIVE.speed * speedMul;
    if (b.diveT <= 0) { b.proneT = DIVE.prone; }
  } else if (b.proneT > 0) {
    b.proneT -= dt;
    b.vx *= Math.max(0, 1 - 10 * dt); b.vz *= Math.max(0, 1 - 10 * dt);
  } else {
    const wl = Math.hypot(input.wx, input.wz);
    const wx = wl > 1 ? input.wx / wl : input.wx, wz = wl > 1 ? input.wz / wl : input.wz;
    const tx = wx * MOVE.speed * speedMul, tz = wz * MOVE.speed * speedMul;
    const acc = (b.grounded ? MOVE.accel : MOVE.airAccel) * dt;
    const ddx = tx - b.vx, ddz = tz - b.vz, dl = Math.hypot(ddx, ddz);
    if (dl <= acc) { b.vx = tx; b.vz = tz; } else { b.vx += (ddx / dl) * acc; b.vz += (ddz / dl) * acc; }
    if (wl > 0.05) b.yaw = turn(b.yaw, Math.atan2(wx, wz), 14 * dt);
    if (input.jump && b.grounded) { b.vy = MOVE.jump; b.grounded = false; b.jumps++; ev.jumped = true; }
    if (input.dive) {
      let dx = wx, dz = wz, l = Math.hypot(dx, dz);
      if (l < 0.1) { dx = Math.sin(b.yaw); dz = Math.cos(b.yaw); l = 1; }
      b.dx = dx / l; b.dz = dz / l; b.yaw = Math.atan2(b.dx, b.dz);
      b.diveT = DIVE.time; ev.dived = true;
      if (b.grounded) b.vy = 3.2;
      b.grounded = false;
    }
  }
  b.vy -= MOVE.gravity * dt;
  b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
  if (b.y <= 0) { if (!b.grounded) ev.landed = true; b.y = 0; b.vy = 0; b.grounded = true; }
  if (opts.clamp) opts.clamp(b);
  return ev;
}

export function turn(a, target, max) {
  let d = target - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) <= max ? target : a + Math.sign(d) * max;
}
