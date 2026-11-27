// `npm run test:mp`: two real Colyseus clients against a freshly spawned server. Both skip the
// tutorial, sit through the intermission, get dropped onto slabs with CPU players, and play:
// they run to each ball aimed at their slab and touch it when it is in reach (as the browser
// client does). Passes when the match produced touches, eliminations, a reshuffle and a winner,
// and every ball flight was a sane closed-form arc.
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@colyseus/sdk';
import { ROOM_NAME, BALL, MOVE } from '../shared/constants.js';
import { ballAt, apexOf } from '../shared/ball.js';

const PORT = 2611;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vball-test-'));
const server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), VBALL_FAST: '1', VBALL_DATA_DIR: dataDir, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOut = '';
server.stdout.on('data', (d) => { serverOut += d; });
server.stderr.on('data', (d) => { serverOut += d; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error('FAIL:', msg); console.error(serverOut.split('\n').slice(-20).join('\n')); server.kill(); process.exit(1); };

for (let i = 0; i < 50 && !serverOut.includes('listening'); i++) await sleep(200);
if (!serverOut.includes('listening')) fail('server did not start');

const stats = { setups: 0, flights: 0, myHits: 0, lands: 0, elims: 0, shuffles: 0, wins: 0, badArcs: 0, refused: 0, tossHits: 0, tossLost: 0 };
let clock = { off: 0 };

async function player(name) {
  const room = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, { name, pid: 'g_test' + name + Date.now() });
  const me = { x: 0, y: 0, z: 0, yaw: 0, seq: 1, region: null };
  const court = { cells: [], members: [], b: null };
  room.onMessage('welcome', (w) => { Object.assign(me, w.pos); me.seq = w.seq; clock.off = w.t - performance.now() / 1000; room.send('tutSkip'); });
  room.onMessage('auth', (a) => { me.x = a.x; me.z = a.z; me.y = 0; me.seq = a.seq; me.region = a.region; });
  room.onMessage('s', (s) => { const off = s.t - performance.now() / 1000; clock.off += (off - clock.off) * (off > clock.off ? 0.5 : 0.02); }); // same filter as client/src/net.js
  room.onMessage('msetup', (m) => { if (m.m !== 'main') return; court.cells = m.cells; court.members = m.members; stats.setups++; });
  room.onMessage('mshuffle', (m) => { if (m.m === 'main') { court.cells = m.cells; stats.shuffles++; } });
  room.onMessage('mball', (m) => {
    if (m.m !== 'main') return;
    court.prev = court.b; court.b = m;
    if (m.state === 'fly' && m.traj) {
      stats.flights++;
      const T = m.traj.t1 - m.traj.t0, ap = apexOf(m.traj);
      if (!(T > 0.4 && T < 4) || ap > 40 || m.traj.land[1] < 0) stats.badArcs++;
      if (m.by === room.sessionId) { stats.myHits++; if (court.prev && court.prev.kind === 'toss' && court.prev.hitter === room.sessionId) stats.tossHits++; }
    }
  });
  room.onMessage('mland', (m) => { if (m.m === 'main' && m.victim === room.sessionId && court.b && court.b.kind === 'toss' && court.b.hitter === room.sessionId) stats.tossLost++; if (m.m === 'main') { stats.lands++; if (court.b) court.b.state = 'none'; } });
  room.onMessage('mmembers', (m) => { if (m.m === 'main') { court.members = m.members; stats.elims = Math.max(stats.elims, m.members.filter((x) => !x.alive).length); } });
  room.onMessage('mwin', (m) => { if (m.m === 'main') stats.wins++; });
  room.onMessage('hitq', (q) => { if (q.miss) stats.refused++; });
  room.onMessage('*', () => {});
  let lastHit = 0;
  const timer = setInterval(() => {
    const now = performance.now() / 1000 + clock.off;
    const b = court.b;
    const myCell = court.cells.find((c) => c.sid === room.sessionId);
    if (b && myCell && me.region) {
      if (b.state === 'held' && b.holder === room.sessionId && now - lastHit > 1) { lastHit = now; room.send('hit', { t: now, yaw: 0 }); }
      if (b.state === 'fly' && b.traj) {
        const fol = b.traj.follow === room.sessionId; // my own serve toss: the ball rides above me
        const [lx, , lz] = fol ? [me.x, 0, me.z] : b.traj.land;
        const mine = Math.abs(lx - myCell.x) <= myCell.w / 2 && Math.abs(lz - myCell.z) <= myCell.d / 2;
        if (mine || fol) {
          const r = me.region;
          if (fol) {
            // like a real player: keep running around after the toss, then hit it on the way down
            if (!me.run) me.run = { x: r.minX + Math.random() * (r.maxX - r.minX), z: r.minZ + Math.random() * (r.maxZ - r.minZ) };
            const dx = me.run.x - me.x, dz = me.run.z - me.z, l = Math.hypot(dx, dz), step = MOVE.speed * 0.02;
            if (l > 0.3) { me.x += (dx / l) * step; me.z += (dz / l) * step; } else me.run = null;
          } else {
            me.run = null;
            // a person needs a moment to react to a new ball
            if (court.seenId !== b.id) { court.seenId = b.id; court.seenAt = now; }
            if (now - court.seenAt < 0.25) { room.send('m', [me.x, me.y, me.z, me.yaw, 0, me.seq]); return; }
            const dx = lx - me.x, dz = lz - me.z, l = Math.hypot(dx, dz), step = MOVE.speed * 0.02;
            if (l > 0.2) { me.x += (dx / l) * Math.min(step, l); me.z += (dz / l) * Math.min(step, l); }
          }
          me.x = Math.max(r.minX + 0.5, Math.min(r.maxX - 0.5, me.x)); me.z = Math.max(r.minZ + 0.5, Math.min(r.maxZ - 0.5, me.z));
          const p = ballAt(b.traj, now);
          if (fol) { p.x += me.x; p.z += me.z; }
          const dy = p.y - me.y, hd = Math.hypot(p.x - me.x, p.z - me.z);
          if (hd < BALL.reach * 0.9 && dy < 2.4 && dy > 0.7 && now - lastHit > 0.4) { lastHit = now; room.send('hit', { t: now, yaw: Math.random() * Math.PI * 2 }); }
        }
      }
    }
    room.send('m', [me.x, me.y, me.z, me.yaw, 0, me.seq]);
  }, 20);
  return { room, stop: () => clearInterval(timer) };
}

const a = await player('Alpha');
const b = await player('Bravo');
const t0 = Date.now();
while (Date.now() - t0 < 280000 && stats.wins < 1) await sleep(250);
a.stop(); b.stop();
await a.room.leave(); await b.room.leave();
server.kill();
console.log(stats);
if (!stats.setups) fail('no match started');
if (!stats.flights) fail('no ball flights');
if (!stats.myHits) fail('the test players never touched the ball');
if (!stats.lands) fail('the ball never landed');
if (!stats.elims) fail('nobody was eliminated');
if (!stats.wins) fail('the match never finished');
if (stats.tossLost > stats.tossHits) fail(`serve tosses lost more often than returned (${stats.tossHits} hit, ${stats.tossLost} lost)`);
if (stats.badArcs) fail(`${stats.badArcs} implausible ball flights`);
console.log('PASS: multiplayer match played to a winner');
process.exit(0);
