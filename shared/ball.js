// Ball flights are closed-form: a start point, a start velocity and a constant acceleration
// (gravity plus an optional sideways curve). The server decides each flight and sends it once;
// every client evaluates the same formula against the shared clock, so the ball moves
// smoothly and identically everywhere with no per-frame position traffic.

// traj: { p: [x,y,z], v: [x,y,z], a: [x,y,z], t0, t1, land: [x,y,z] }
export function ballAt(traj, t, out = { x: 0, y: 0, z: 0 }) {
  const s = Math.max(0, Math.min(t, traj.t1) - traj.t0);
  out.x = traj.p[0] + traj.v[0] * s + 0.5 * traj.a[0] * s * s;
  out.y = traj.p[1] + traj.v[1] * s + 0.5 * traj.a[1] * s * s;
  out.z = traj.p[2] + traj.v[2] * s + 0.5 * traj.a[2] * s * s;
  return out;
}

export function ballVel(traj, t, out = { x: 0, y: 0, z: 0 }) {
  const s = Math.max(0, Math.min(t, traj.t1) - traj.t0);
  out.x = traj.v[0] + traj.a[0] * s;
  out.y = traj.v[1] + traj.a[1] * s;
  out.z = traj.v[2] + traj.a[2] * s;
  return out;
}

// A flight from p0 that lands exactly on p1 after T seconds under acceleration a.
export function makeFlight(p0, p1, T, a, t0) {
  const v = [0, 1, 2].map((i) => (p1[i] - p0[i]) / T - 0.5 * a[i] * T);
  return { p: [...p0], v, a: [...a], t0, t1: t0 + T, land: [...p1] };
}

// Highest point of a flight (for camera framing / sanity checks).
export function apexOf(traj) {
  const vy = traj.v[1], ay = traj.a[1];
  if (ay >= 0 || vy <= 0) return traj.p[1];
  const s = Math.min(traj.t1 - traj.t0, -vy / ay);
  return traj.p[1] + vy * s + 0.5 * ay * s * s;
}

export const round3 = (x) => Math.round(x * 1000) / 1000;
export const packFlight = (f) => ({ p: f.p.map(round3), v: f.v.map(round3), a: f.a.map(round3), t0: round3(f.t0), t1: round3(f.t1), land: f.land.map(round3) });
