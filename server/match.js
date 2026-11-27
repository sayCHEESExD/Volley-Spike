// One bomb-volleyball court. Owns its slabs, the ball and every decision about it:
// serves, touches (validated against the server's own clock and positions), where each hit
// lands, eliminations, the reshuffle into a smaller rectangle, and the CPU players' brains.
// Three kinds share this engine: 'main' (the real match), 'practice' (nobody is eliminated)
// and 'tutorial' (a scripted lesson for one new player).
import { BALL, SLAB, FLOW, MODIFIERS, ABILITIES, ADRENALINE_SPEED, MOVE } from '../shared/constants.js';
import { formation, cellRect, pointInCell } from '../shared/world.js';
import { ballAt, makeFlight, packFlight } from '../shared/ball.js';
import { newBody, stepBody } from '../shared/move.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const _b = { x: 0, y: 0, z: 0 };

export class Match {
  constructor(room, kind, { cx, cz, id, owner = null }) {
    this.room = room; this.kind = kind; this.id = id; this.cx = cx; this.cz = cz; this.owner = owner;
    this.members = new Map(); // sid -> member
    this.cells = [];
    this.phase = 'idle';
    this.phaseEnd = 0;
    this.ball = { state: 'none', holder: '', traj: null, lastHitter: '', kind: '', skin: 'default', flightId: 0, tossBy: '' };
    this.mod = MODIFIERS[0];
    this.duos = false;
    this.bounty = '';
    this.rally = 0;
    this.tut = null;
    if (kind === 'practice') this.cells = formation(4, cx, cz).map((c) => ({ ...c, sid: '', dead: false }));
  }

  // ------------------------------------------------------------------ helpers
  get now() { return this.room.t; }
  send(type, data) {
    if (this.kind === 'tutorial') { const r = this.room.recs.get(this.owner); if (r) r.client.send(type, { m: this.id, ...data }); return; }
    this.room.broadcast(type, { m: this.id, ...data });
  }
  alive() { return [...this.members.values()].filter((m) => m.alive); }
  cellOf(sid) { const m = this.members.get(sid); return m && m.cell >= 0 ? this.cells[m.cell] : null; }
  regionFor(sid) { const c = this.cellOf(sid); return c ? cellRect(c) : null; }
  cellAt(x, z) { return this.cells.findIndex((c) => !c.gone && pointInCell(c, x, z)); }
  status(text, sub = '') { this.statusText = text; this.statusSub = sub; this.send('mstatus', { text, sub }); }

  // Everything a client needs to draw this court from scratch (join, rejoin, start).
  setupMsg() {
    return {
      kind: this.kind, cells: this.cells.map((c) => ({ x: c.x, z: c.z, w: c.w, d: c.d, sid: c.sid, dead: !!c.dead })),
      members: [...this.members.values()].map((m) => ({ sid: m.sid, alive: m.alive, team: m.team })),
      ball: this.ballMsg(), mod: this.mod.label, duos: this.duos, bounty: this.bounty, status: this.statusText || '', sub: this.statusSub || '', phase: this.phase,
    };
  }
  ballMsg() {
    const b = this.ball;
    return { state: b.state, holder: b.holder, traj: b.traj ? packFlight(b.traj) : null, hitter: b.lastHitter, kind: b.kind, skin: b.skin, id: b.flightId };
  }
  pushBall(extra = {}) { this.send('mball', { ...this.ballMsg(), ...extra }); }

  addMember(rec, cell, team = 0) {
    const m = { sid: rec.sid, rec, cell, alive: true, team, lastHit: -9, brain: rec.isBot ? newBrain(rec) : null, nextFlag: null };
    this.members.set(rec.sid, m);
    if (cell >= 0) this.cells[cell].sid = rec.sid;
    rec.match = this;
    return m;
  }

  placeOnCell(m, rel = null) {
    const c = this.cells[m.cell];
    const r = rel || { u: 0, v: 0.15 };
    const x = c.x + r.u * (c.w / 2 - 1), z = c.z + r.v * (c.d / 2 - 1);
    const yaw = Math.atan2(this.cx - c.x, this.cz - c.z + 1e-3); // face the middle
    this.room.teleport(m.rec, x, z, yaw, cellRect(c));
  }

  // ------------------------------------------------------------------ main match
  startMain(recs, { duos, mod, bountySid }) {
    this.kind = 'main';
    this.duos = duos; this.mod = mod;
    const list = [...recs];
    if (duos) list.sort((a, b) => (a.team ?? 0) - (b.team ?? 0));
    this.cells = formation(list.length, this.cx, this.cz).map((c) => ({ ...c, sid: '', dead: false }));
    list.forEach((rec, i) => { const m = this.addMember(rec, i, duos ? rec.team : i); this.placeOnCell(m); });
    this.bounty = bountySid || '';
    this.phase = 'intro'; this.phaseEnd = this.now + 3;
    this.send('msetup', this.setupMsg());
    this.status('Get ready!', `${duos ? 'Duos' : 'Solo'} | ${mod.label}`);
  }

  // ------------------------------------------------------------------ practice
  // Practice: every human shares slab 0; the other three slabs always hold CPU players.
  practiceJoin(rec) {
    if (this.members.has(rec.sid)) return true;
    const m = this.addMember(rec, 0);
    this.placeOnCell(m, { u: (Math.random() - 0.5) * 1.2, v: (Math.random() - 0.5) * 1.2 });
    this.practiceFill();
    if (this.ball.state === 'none') this.serveFrom(rec.sid, 1.2);
    return true;
  }
  practiceFill() {
    const humans = [...this.members.values()].filter((m) => !m.rec.isBot);
    const bots = [...this.members.values()].filter((m) => m.rec.isBot);
    this.cells[0].sid = humans.length ? humans[0].sid : '';
    if (humans.length) {
      for (let c = 1; c < this.cells.length; c++) {
        if (bots.some((bm) => bm.cell === c)) continue;
        const m = this.addMember(this.room.makeBot('practice', 0.82), c);
        this.placeOnCell(m);
      }
    } else {
      for (const bm of bots) this.removeMember(bm.sid, true);
      this.ball = { ...this.ball, state: 'none', holder: '', traj: null }; this.pushBall();
      this.phase = 'idle';
    }
    if (humans.length && this.ball.state === 'none' && this.phase === 'idle') this.serveFrom(humans[0].sid, 1.2);
    this.send('msetup', this.setupMsg());
  }

  // ------------------------------------------------------------------ tutorial
  startTutorial(rec) {
    this.kind = 'tutorial';
    this.cells = formation(2, this.cx, this.cz).map((c) => ({ ...c, sid: '', dead: false }));
    const me = this.addMember(rec, 0);
    const tutor = this.room.makeBot('tutorial', 1, 'Coach Kit');
    const tm = this.addMember(tutor, 1);
    tm.brain.perfect = true;
    this.placeOnCell(me); this.placeOnCell(tm);
    this.tut = { step: 'toss', at: this.now };
    this.send('msetup', this.setupMsg());
    this.tutStep('toss');
    this.ball = { ...this.ball, state: 'held', holder: rec.sid, traj: null, lastHitter: '', kind: '', skin: rec.prof.eq.ball };
    this.ballHoldUntil = Infinity;
    this.phase = 'rally';
    this.pushBall();
  }
  tutStep(step) {
    this.tut.step = step; this.tut.at = this.now;
    if (step === 'dive') this.tut.wantFar = true;
    const TEXT = {
      toss: ['Toss the ball', 'Click / tap HIT to throw it up'],
      jump: ['Jump', 'Press SPACE while the ball is up'],
      spike: ['Spike!', 'Click / tap HIT in the air to smash it'],
      bump: ['Bump it back', 'Stand in the shadow and click / tap HIT'],
      dive: ['Dive for it', 'Run towards the shadow and press E / DIVE, then HIT'],
      ability: ['Use your Adrenaline ability', 'Press R / the ability button to hit harder'],
      fight: ['Beat the coach!', 'Make the ball land on their slab'],
      done: ["You've learnt everything now!", ''],
    };
    const [text, sub] = TEXT[step];
    this.send('tut', { step, text, sub });
  }

  // ------------------------------------------------------------------ serving
  serveFrom(sid, delay = 1.5) {
    this.ball = { ...this.ball, state: 'wait', holder: sid, traj: null, lastHitter: '', kind: '', tossBy: '' };
    this.serveAt = this.now + delay;
    this.phase = 'serve';
  }
  giveBall(sid) {
    const m = this.members.get(sid);
    if (!m) return;
    this.ball = { ...this.ball, state: 'held', holder: sid, traj: null, lastHitter: '', kind: '', tossBy: '', skin: m.rec.prof.eq.ball || 'default' };
    this.ballHoldUntil = this.tut && sid === this.owner && this.tut.step !== 'fight' ? Infinity : this.now + BALL.serveWait;
    this.phase = 'rally';
    this.rally = 0;
    this.rallyStart = this.now;
    this.pushBall();
    if (this.kind !== 'tutorial') this.status(`${m.rec.name} is serving`, this.kind === 'main' ? `${this.duos ? 'Duos' : 'Solo'} | ${this.mod.label}` : 'Practice');
    if (m.brain) m.brain.tossAt = this.now + rnd(0.8, 1.6);
  }

  toss(m) {
    const body = m.rec.body;
    const g = BALL.gravity * this.mod.gravity;
    const p0 = [0, body.y + 2.2, 0]; // relative to the tosser: the ball stays above them
    const apex = BALL.tossHeight;
    const vy = Math.sqrt(2 * g * apex);
    const down = p0[1] + apex - BALL.radius;
    const T = vy / g + Math.sqrt((2 * down) / g);
    const traj = makeFlight(p0, [0, BALL.radius, 0], T, [0, -g, 0], this.now);
    traj.follow = m.sid;
    this.ball = { ...this.ball, state: 'fly', holder: '', traj, lastHitter: m.sid, kind: 'toss', tossBy: m.sid, flightId: this.ball.flightId + 1 };
    m.lastHit = this.now;
    this.pushBall();
    if (this.tut && this.tut.step === 'toss') this.tutStep('jump');
    if (m.brain) { m.brain.flight = -1; m.brain.spikeAt = this.now + T * 0.42; }
  }

  // Where the ball is at time t (a followed flight is offset by its player's feet).
  ballPos(t, out = { x: 0, y: 0, z: 0 }) {
    const tr = this.ball.traj;
    ballAt(tr, t, out);
    if (tr.follow) { const f = this.members.get(tr.follow); if (f) { out.x += f.rec.body.x; out.z += f.rec.body.z; } }
    return out;
  }
  landPoint() {
    const tr = this.ball.traj, [x, y, z] = tr.land;
    if (tr.follow) { const f = this.members.get(tr.follow); if (f) return [x + f.rec.body.x, y, z + f.rec.body.z]; }
    return [x, y, z];
  }

  // ------------------------------------------------------------------ touching the ball
  // d: { t (client's server-clock time of the swing), yaw (aim), air, dive }
  tryHit(sid, d) {
    const m = this.members.get(sid);
    if (!m || !m.alive || this.phase !== 'rally') return { ok: false };
    const b = this.ball;
    if (b.state === 'held') { if (b.holder === sid) { this.toss(m); return { ok: true, kind: 'toss' }; } return { ok: false }; }
    if (b.state !== 'fly') return { ok: false };
    const self = b.lastHitter === sid;
    if (self && b.kind !== 'toss') return { ok: false, why: 'self' };
    if (this.now - m.lastHit < 0.3) return { ok: false };
    const body = m.rec.body;
    const abil = m.rec.abil;
    const magnet = abil && abil.id === 'magnet' && abil.until > this.now ? 1.7 : 1;
    const air = !body.grounded && body.y > 0.25;
    const diving = body.diveT > 0 || body.proneT > 0 || !!d.dive;
    // the swing may have been seen a little earlier on the client: search that window
    const tc = Math.max(this.now - BALL.hitGrace, Math.min(this.now, Number.isFinite(d.t) ? d.t : this.now));
    let best = null;
    for (let i = 0; i <= 6; i++) {
      const t = tc + ((this.now - tc) * i) / 6;
      if (t > b.traj.t1) break;
      this.ballPos(t, _b);
      const dy = _b.y - body.y;
      const hd = Math.hypot(_b.x - body.x, _b.z - body.z);
      const low = diving ? -0.2 : BALL.reachLow;
      const high = air ? BALL.reachHighAir : BALL.reachHigh;
      if (hd <= BALL.reach * magnet * (diving ? 1.25 : 1) && dy >= low && dy <= high * (magnet > 1 ? 1.25 : 1)) {
        const score = Math.abs(dy - 1.7) + hd * 0.3;
        if (!best || score < best.score) best = { score, dy, hd };
      }
    }
    if (!best) {
      // too early (or lag): keep the swing alive on the server and retry every tick
      if (!d.retry) { m.swing = { until: this.now + BALL.swingBuffer, d: { yaw: d.yaw, dive: d.dive, retry: true } }; return { ok: false, why: 'buffered' }; }
      return { ok: false, why: 'miss' };
    }
    m.swing = null;
    // quality
    let kind = air && best.dy > 1.0 ? 'spike' : diving ? 'save' : 'bump';
    let perfect = false, weak = false;
    if (kind === 'spike') perfect = best.dy >= 1.2 && best.hd < 2.4;
    else if (kind === 'bump') { perfect = best.dy >= BALL.perfectLow && best.dy <= BALL.perfectHigh && best.hd < 2.3; weak = best.dy < BALL.tooLow; }
    else weak = false;
    if (self && b.kind === 'toss' && kind === 'bump') kind = 'serve';
    this.launch(m, d.yaw, kind, perfect, weak);
    return { ok: true, kind, perfect, weak };
  }

  // Send the ball from where it is now to a slab chosen by the hitter's aim.
  launch(m, yaw, kind, perfect, weak) {
    const b = this.ball;
    const p0 = this.ballPos(this.now);
    p0.y = Math.max(p0.y, BALL.radius + 0.25);
    const body = m.rec.body;
    // candidate slabs: alive opponents (never your own or your teammate's)
    let cands = this.alive().filter((o) => o.sid !== m.sid && o.cell !== m.cell && !(this.duos && o.team === m.team) && o.cell >= 0);
    if (this.kind === 'tutorial' && this.tut && this.tut.step !== 'fight') cands = cands.filter((o) => o.rec.isBot);
    if (!cands.length) cands = this.alive().filter((o) => o.sid !== m.sid);
    if (!cands.length) return;
    let target;
    if (weak) target = pick(cands);
    else {
      const ax = Math.sin(yaw), az = Math.cos(yaw);
      let bestDot = -Infinity;
      for (const o of cands) {
        const c = this.cells[o.cell];
        const dx = c.x - body.x, dz = c.z - body.z, l = Math.hypot(dx, dz) || 1;
        const dot = (dx * ax + dz * az) / l;
        if (dot > bestDot) { bestDot = dot; target = o; }
      }
    }
    const c = this.cells[target.cell];
    // landing spot: power hits go away from the receiver, the rest anywhere near the middle
    const hw = c.w / 2 - 1.2, hd = c.d / 2 - 1.2;
    let lx, lz;
    const tb = target.rec.body;
    const sudden = this.rally > 20; // sudden death: long rallies aim away from the receiver
    if (((perfect || kind === 'spike') && !weak) || sudden) {
      const ux = c.x - tb.x, uz = c.z - tb.z, ul = Math.hypot(ux, uz);
      const sx = ul > 0.5 ? ux / ul : rnd(-1, 1), sz = ul > 0.5 ? uz / ul : rnd(-1, 1);
      const far = sudden ? 0.9 : perfect ? 0.5 : 0.3;
      lx = c.x + sx * hw * far + rnd(-0.25, 0.25) * hw;
      lz = c.z + sz * hd * far + rnd(-0.25, 0.25) * hd;
    } else {
      lx = c.x + rnd(-0.45, 0.45) * hw;
      lz = c.z + rnd(-0.45, 0.45) * hd;
    }
    lx = Math.max(c.x - hw, Math.min(c.x + hw, lx));
    lz = Math.max(c.z - hd, Math.min(c.z + hd, lz));
    const dist = Math.hypot(lx - p0.x, lz - p0.z);
    const abil = m.rec.abil;
    const active = (id) => abil && abil.id === id && abil.until > this.now;
    let T;
    if (kind === 'spike') T = (BALL.spikeTime + dist * BALL.spikePerMetre) * this.mod.spike;
    else if (weak) T = BALL.weakTime + dist * BALL.bumpPerMetre;
    else T = BALL.bumpTime + dist * BALL.bumpPerMetre;
    if (perfect && !weak) T *= 0.88;
    if (kind === 'save') T *= 1.1;
    T *= this.mod.speed;
    // long rallies speed up (3% per touch after the 10th, down to 45%) so every match ends
    if (this.rally > 10) { T *= Math.max(0.3, 1 - 0.035 * (this.rally - 10)); if (this.rally === 11) this.send('mstatus', { text: this.statusText, sub: 'The ball is speeding up!' }); }
    // ability effects (each "next hit" ability is spent here)
    let g = BALL.gravity * this.mod.gravity;
    const a = [0, -g, 0];
    let used = '';
    if (active('adrenaline') && kind === 'spike') T *= 0.85;
    if (active('superspike')) { T *= 0.55; used = 'superspike'; }
    if (active('curveball')) {
      const dx = lx - p0.x, dz = lz - p0.z, l = Math.hypot(dx, dz) || 1, s = Math.random() < 0.5 ? -1 : 1;
      a[0] = (-dz / l) * 9 * s; a[2] = (dx / l) * 9 * s; used = 'curveball';
    }
    if (active('frozen')) { T *= 1.25; a[1] = -g * 1.9; used = 'frozen'; }
    if (used) abil.until = 0;
    T = Math.max(0.5, T);
    const traj = makeFlight([p0.x, p0.y, p0.z], [lx, BALL.radius, lz], T, a, this.now);
    b.state = 'fly'; b.traj = traj; b.lastHitter = m.sid; b.kind = kind; b.skin = m.rec.prof.eq.ball || 'default'; b.flightId++;
    b.target = target.sid; b.perfect = perfect; b.weak = weak; b.used = used;
    m.lastHit = this.now;
    this.rally++;
    this.pushBall({ perfect, weak, used, by: m.sid });
    this.room.onTouch(this, m, kind, perfect, weak);
    for (const o of this.members.values()) if (o.brain) o.brain.flight = -1;
    // tutorial progress
    if (this.tut && !m.rec.isBot) {
      const s = this.tut.step;
      if ((s === 'spike' || s === 'jump') && kind === 'spike') this.tutAfter('bump');
      else if ((s === 'jump' || s === 'spike') && kind !== 'spike') this.tutAfter('bump');
      else if (s === 'bump') this.tutAfter('dive');
      else if (s === 'dive') this.tutAfter('ability');
    }
  }
  tutAfter(step) { this.tut.next = step; }

  // The last lesson: a real 4-player game against gentle CPUs. The learner cannot lose it.
  // The last lesson: a real game against the coach alone (no extra CPUs). The learner cannot lose it.
  startTutorialFight() {
    const me = this.members.get(this.owner);
    const coach = [...this.members.values()].find((m) => m.rec.isBot);
    const recs = [me.rec, coach.rec];
    this.members.clear();
    this.cells = formation(2, this.cx, this.cz).map((c) => ({ ...c, sid: '', dead: false }));
    recs.forEach((rec, i) => { const m = this.addMember(rec, i, i); if (m.brain) m.brain.skill = 0.5; this.placeOnCell(m); });
    this.ball = { ...this.ball, state: 'none', holder: '', traj: null };
    this.send('msetup', this.setupMsg());
    this.tutStep('fight');
    this.serveFrom(this.owner, 1.2);
  }

  // ------------------------------------------------------------------ landing
  land() {
    const b = this.ball;
    const [lx, , lz] = this.landPoint();
    const ci = this.cellAt(lx, lz);
    b.state = 'none';
    const owner = ci >= 0 ? this.cells[ci].sid : '';
    const victim = owner ? this.members.get(owner) : null;
    const by = b.lastHitter && b.lastHitter !== owner ? this.members.get(b.lastHitter) : null;
    this.send('mland', { cell: ci, x: lx, z: lz, victim: owner, by: by ? by.sid : '', boom: by ? by.rec.prof.eq.boom : 'classic', practice: this.kind !== 'main' });
    if (this.kind === 'practice') {
      if (ci >= 0) this.cells[ci].flash = this.now;
      this.phase = 'serve';
      const next = victim && victim.alive ? victim.sid : (by ? by.sid : pick([...this.members.keys()]));
      this.room.onPracticeMiss(this, [...this.members.values()].filter((x) => x.cell === ci && !x.rec.isBot));
      if (next) this.serveFrom(next, 1.6); else this.phase = 'idle';
      return;
    }
    if (this.kind === 'tutorial' && (this.tut.step !== 'fight' || owner === this.owner)) {
      if (this.tut.step === 'fight') { if (ci >= 0) this.cells[ci].flash = this.now; this.serveFrom(this.owner, 1.4); return; }
      // a drill went wrong: the coach gives the ball back
      const me = this.members.get(this.owner);
      this.phase = 'serve';
      const step = this.tut.step;
      if (step === 'toss' || step === 'jump' || step === 'spike') { this.tutStep('toss'); this.serveFrom(this.owner, 1.2); }
      else { const coach = [...this.members.values()].find((x) => x.rec.isBot); this.serveFrom(coach ? coach.sid : this.owner, 1.4); this.tutStep(step); }
      void me;
      return;
    }
    // main match / tutorial fight: the slab under the ball explodes
    this.phase = 'break';
    this.phaseEnd = this.now + FLOW.postElim;
    if (ci >= 0) { this.cells[ci].dead = true; this.cells[ci].diedAt = this.now; }
    if (victim && victim.alive) this.eliminate(victim, by);
  }

  eliminate(victim, by) {
    victim.alive = false;
    this.lastElimBy = by ? by.sid : '';
    this.room.onEliminated(this, victim, by);
    if (this.bounty && victim.sid === this.bounty) {
      const nb = by && by.alive ? by.sid : '';
      this.room.onBounty(this, victim, by);
      this.bounty = nb;
    }
    this.send('mmembers', { members: [...this.members.values()].map((m) => ({ sid: m.sid, alive: m.alive, team: m.team })), bounty: this.bounty });
  }

  winners() {
    const alive = this.alive();
    if (this.duos) { const teams = new Set(alive.map((m) => m.team)); return teams.size <= 1 ? alive : null; }
    return alive.length <= 1 ? alive : null;
  }

  // Remaining slabs glide into the smallest rectangle that fits everyone left.
  shuffle() {
    const alive = this.alive().filter((m) => m.cell >= 0);
    const old = alive.map((m) => ({ m, c: this.cells[m.cell] }));
    old.sort((a, b) => (this.duos ? a.m.team - b.m.team : 0) || a.c.z - b.c.z || a.c.x - b.c.x);
    const cells = formation(old.length, this.cx, this.cz).map((c) => ({ ...c, sid: '', dead: false }));
    const moves = [];
    old.forEach(({ m, c }, i) => {
      const nc = cells[i];
      nc.sid = m.sid;
      const body = m.rec.body;
      const rel = { u: (body.x - c.x) / (c.w / 2), v: (body.z - c.z) / (c.d / 2) };
      moves.push({ m, from: { x: body.x, z: body.z }, to: { x: nc.x + rel.u * (nc.w / 2 - 0.6), z: nc.z + rel.v * (nc.d / 2 - 0.6) }, oldIdx: this.cells.indexOf(c) });
      m.cell = i;
    });
    for (const m of this.members.values()) if (!m.alive) m.cell = -1;
    const prev = this.cells;
    this.cells = cells;
    this.shuffleMoves = moves;
    this.phase = 'shuffle';
    this.phaseEnd = this.now + SLAB.shuffleTime;
    this.shuffleStart = this.now;
    for (const mv of moves) mv.m.rec.frozenUntil = this.phaseEnd;
    this.send('mshuffle', { cells: cells.map((c) => ({ x: c.x, z: c.z, w: c.w, d: c.d, sid: c.sid })), from: moves.map((mv) => ({ sid: mv.m.sid, old: mv.oldIdx })), prevCount: prev.length, time: SLAB.shuffleTime });
    this.status('Shuffling...', `${alive.length} players left`);
  }

  removeMember(sid, silent = false) {
    const m = this.members.get(sid);
    if (!m) return;
    if (m.cell >= 0 && this.cells[m.cell] && this.kind !== 'practice') this.cells[m.cell].sid = this.cells[m.cell].sid;
    this.members.delete(sid);
    if (m.rec.match === this) m.rec.match = null;
    if (m.rec.isBot) this.room.dropBot(m.rec);
    if (this.kind === 'main' && m.alive) {
      m.alive = false;
      if (m.cell >= 0) this.cells[m.cell].dead = true;
      this.send('mmembers', { members: [...this.members.values()].map((x) => ({ sid: x.sid, alive: x.alive, team: x.team })), bounty: this.bounty, left: sid });
      if (this.ball.holder === sid || (this.ball.state === 'wait' && this.ball.holder === sid)) { this.phase = 'break'; this.phaseEnd = this.now + 0.6; this.ball.state = 'none'; this.pushBall(); }
    }
    if (this.kind === 'practice') {
      if (this.ball.holder === sid) { this.ball.state = 'none'; this.ball.holder = ''; this.pushBall(); this.phase = 'idle'; }
      if (!silent) this.practiceFill();
    }
  }

  // ------------------------------------------------------------------ tick
  step(dt) {
    const now = this.now;
    const b = this.ball;
    if (this.phase === 'intro' && now >= this.phaseEnd) this.serveFrom(pick(this.alive()).sid, 0.3);
    if (this.phase === 'serve' && b.state === 'wait' && now >= this.serveAt) {
      if (this.members.has(b.holder) && this.members.get(b.holder).alive) this.giveBall(b.holder);
      else { const a = this.alive(); if (a.length) this.giveBall(pick(a).sid); }
    }
    if (b.state === 'held' && now >= this.ballHoldUntil) { const m = this.members.get(b.holder); if (m) this.toss(m); }
    if (b.state === 'fly' && now >= b.traj.t1) this.land();
    if (this.phase === 'break' && now >= this.phaseEnd) {
      const win = this.winners();
      if (win) this.finish(win);
      else if (this.kind === 'main' || (this.tut && this.tut.step === 'fight')) {
        const deadCells = this.cells.some((c) => c.dead);
        if (deadCells) this.shuffle(); else this.serveFrom(pick(this.alive()).sid, 0.5);
      }
    }
    if (this.phase === 'shuffle') {
      const k = Math.min(1, (now - this.shuffleStart) / SLAB.shuffleTime), e = k * k * (3 - 2 * k);
      for (const mv of this.shuffleMoves) {
        const body = mv.m.rec.body;
        body.x = mv.from.x + (mv.to.x - mv.from.x) * e; body.z = mv.from.z + (mv.to.z - mv.from.z) * e;
      }
      if (now >= this.phaseEnd) {
        for (const mv of this.shuffleMoves) this.room.teleport(mv.m.rec, mv.to.x, mv.to.z, mv.m.rec.body.yaw, cellRect(this.cells[mv.m.cell]));
        this.phase = 'post'; this.phaseEnd = now + FLOW.postShuffle;
      }
    }
    if (this.phase === 'post' && now >= this.phaseEnd) {
      // the player who destroyed the last slab serves next if still in, else anyone
      const a = this.alive();
      const last = this.lastElimBy && this.members.get(this.lastElimBy);
      this.serveFrom(last && last.alive ? last.sid : pick(a).sid, 0.2);
    }
    if (this.phase === 'end' && now >= this.phaseEnd) this.room.onMatchOver(this);
    // tutorial pacing
    if (this.tut) this.tutTick();
    // buffered swings: retry until the ball is in reach or the window closes
    for (const m of this.members.values()) {
      if (!m.swing) continue;
      if (now > m.swing.until || !m.alive) { m.swing = null; if (!m.rec.isBot) m.rec.client.send('hitq', { miss: true }); continue; }
      if (this.ball.state === 'fly') this.tryHit(m.sid, { ...m.swing.d, t: now });
    }
    // CPU players
    for (const m of this.members.values()) if (m.brain && m.alive) this.think(m, dt);
  }

  finish(win) {
    this.phase = 'end';
    this.phaseEnd = this.now + FLOW.winnerShow;
    this.ball.state = 'none'; this.pushBall();
    const names = win.map((m) => m.rec.name).join(' & ');
    this.send('mwin', { sids: win.map((m) => m.sid), names });
    this.status(`${names} ${win.length > 1 ? 'have' : 'has'} won!`, '');
    this.room.onWin(this, win);
  }

  tutTick() {
    const t = this.tut;
    const me = this.members.get(this.owner);
    if (!me) return;
    if (t.step === 'jump' && !me.rec.body.grounded) this.tutStep('spike');
    if (t.next && this.ball.state !== 'fly') {
      // the coach's return is in the air when the step changes: wait for the land/hit
    }
    if (t.next) {
      const n = t.next; t.next = null;
      this.tutStep(n);
    }
    if (t.step === 'ability' && me.rec.abil && me.rec.abil.until > this.now && !t.fightAt) {
      t.next = null; t.fightAt = this.now + 1.2;
      this.send('tut', { step: 'nice', text: 'Nice work!', sub: 'Now for a real game...' });
    }
    if (t.fightAt && this.now >= t.fightAt) { t.fightAt = 0; this.startTutorialFight(); }
  }

  // ------------------------------------------------------------------ CPU players
  think(m, dt) {
    const br = m.brain, body = m.rec.body, b = this.ball, now = this.now;
    if (m.rec.frozenUntil > now) return;
    const c = m.cell >= 0 ? this.cells[m.cell] : null;
    if (!c) return;
    let gx = c.x, gz = c.z, jump = false;
    if (b.state === 'held' && b.holder === m.sid && now >= (br.tossAt || 0)) this.toss(m);
    if (b.state === 'fly') {
      const [lx, , lz] = this.landPoint();
      const mine = pointInCell(c, lx, lz);
      const selfToss = b.kind === 'toss' && b.lastHitter === m.sid;
      if (br.flight !== b.flightId) {
        // new flight: decide how well this bot will play it
        br.flight = b.flightId;
        let p = br.skill;
        if (b.kind === 'spike') p *= 0.84;
        if (b.perfect) p *= 0.9;
        if (b.used) p *= 0.85;
        if (this.kind === 'tutorial' && this.tut && this.tut.step !== 'fight') p = 1;
        if (selfToss) p = 0.985;
        br.will = Math.random() < p;
        br.err = (1 - br.skill) * 2.2;
        br.ex = rnd(-br.err, br.err); br.ez = rnd(-br.err, br.err);
        br.react = now + rnd(0.12, 0.3) * (1.4 - br.skill);
        br.spikeTry = selfToss || Math.random() < 0.35;
      }
      if ((mine || selfToss) && now >= br.react) {
        gx = lx + (br.will ? br.ex * 0.3 : br.ex + Math.sign(br.ex || 1) * 1.6);
        gz = lz + (br.will ? br.ez * 0.3 : br.ez + Math.sign(br.ez || 1) * 1.6);
        if (selfToss) { gx = body.x; gz = body.z; }
        this.ballPos(now, _b);
        const left = b.traj.t1 - now;
        const dy = _b.y - body.y, hd = Math.hypot(_b.x - body.x, _b.z - body.z);
        // jump to spike a high ball now and then
        if (br.will && br.spikeTry && body.grounded && left < 0.62 && left > 0.4 && hd < 2.2 && _b.y > 2.6) jump = true;
        const target = body.grounded ? rnd(1.3, 2.0) : 2.0;
        if (br.will && hd < BALL.reach * 0.9 && dy < target + 0.25 && dy > 0.6 && now - m.lastHit > 0.3 && (b.lastHitter !== m.sid || b.kind === 'toss')) {
          const opp = this.alive().filter((o) => o.sid !== m.sid && o.cell !== m.cell && !(this.duos && o.team === m.team) && (!this.tut || this.tut.step === 'fight' || !o.rec.isBot));
          if (opp.length) {
            let tgt = pick(opp);
            if (this.tut && this.tut.wantFar) tgt = this.members.get(this.owner) || tgt;
            const tc = this.cells[tgt.cell];
            const yaw = Math.atan2(tc.x - body.x, tc.z - body.z);
            if (this.kind === 'main' && Math.random() < 0.06) this.room.useAbility(m.rec);
            const r = this.tryHit(m.sid, { t: now, yaw, air: !body.grounded, retry: true });
            if (r.ok && this.tut && this.tut.wantFar) {
              // the dive drill: send it to the far corner of the learner's slab
              const t = this.ball.traj;
              const me = this.members.get(this.owner);
              const mc = this.cells[me.cell], mb = me.rec.body;
              const fx = mc.x - Math.sign(mb.x - mc.x || 1) * (mc.w / 2 - 1.3), fz = mc.z - Math.sign(mb.z - mc.z || 1) * (mc.d / 2 - 1.3);
              this.ball.traj = makeFlight(t.p, [fx, BALL.radius, fz], 1.25, t.a, t.t0);
              this.ball.flightId++;
              this.pushBall({ by: m.sid });
              this.tut.wantFar = false;
            }
          }
        }
      }
    }
    // move
    const dx = gx - body.x, dz = gz - body.z, dl = Math.hypot(dx, dz);
    const sp = dl > 0.35 ? Math.min(1, dl / 1.2) : 0;
    const wx = dl > 0.01 ? (dx / dl) * sp : 0, wz = dl > 0.01 ? (dz / dl) * sp : 0;
    const abil = m.rec.abil;
    const speedMul = abil && abil.id === 'adrenaline' && abil.until > now ? ADRENALINE_SPEED : 1;
    const r = cellRect(c);
    stepBody(body, { wx, wz, jump, dive: false }, dt, { speedMul: speedMul * br.speed, clamp: (bb) => { bb.x = Math.max(r.minX + MOVE.radius, Math.min(r.maxX - MOVE.radius, bb.x)); bb.z = Math.max(r.minZ + MOVE.radius, Math.min(r.maxZ - MOVE.radius, bb.z)); } });
    if (dl < 0.4 && b.state === 'fly') body.yaw = Math.atan2(this.cx - body.x, this.cz - body.z);
  }
}

function newBrain(rec) {
  return { skill: rec.skill ?? 0.8, speed: 0.92 + Math.random() * 0.1, flight: -1, will: true, ex: 0, ez: 0, react: 0, tossAt: 0 };
}

export { newBody, ABILITIES };
