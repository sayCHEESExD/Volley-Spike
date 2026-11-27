// One Volley Spike server (up to 6 players): the lobby island, the practice court, the match
// arena (intermission + Solo/Duos vote, then a match topped up with CPU players), tutorial
// courts for new players, and the economy. Positions are client-simulated and checked here;
// the ball, the slabs and every elimination are decided here.
import { Room, CloseCode } from 'colyseus';
import { State, Player } from './schema.js';
import { Match } from './match.js';
import { MAX_PLAYERS, TICK_HZ, SNAP_HZ, MOVE, ABILITIES, ADRENALINE_SPEED, FLOW, MODIFIERS, REWARD, AD_REWARD, AVATAR_SLOTS, PROPORTIONS, BOT_FILL, FAST_FLOW } from '../shared/constants.js';
import { BALLS, EXPLOSIONS } from '../shared/items.js';
import { SPAWN, ARENA, PRACTICE, PRACTICE_PAD, LOBBY_REGIONS, SOLIDS, clampToRegions, tutorialCenter } from '../shared/world.js';
import { newBody } from '../shared/move.js';
import { loadProfile, touch, publicProfile, release as releaseProfile, carryGuestProgress, flush as flushProfiles, freshProfile, topBy, topWeekly } from './profiles.js';
import * as eco from './economy.js';
import { verifyToken, queueScore, flushLeaderboards, verifyAdReward } from './bloxity.js';
import { BadgeBook } from './badges.js';
import { randomOutfit } from './avatarCatalog.js';

const NO_CLIENT = { send() {}, sendBytes() {}, leave() {} };
const isNum = (...a) => a.every((v) => typeof v === 'number' && Number.isFinite(v));
const cleanName = (n) => String(n || '').replace(/[^\w .\-]/g, '').trim().slice(0, 18);
const BOT_NAMES = ['spikeyboi', 'Noodle_77', 'kxra', 'BumpKing', 'lilmango', 'Zeph_On', 'Pixel_Pam', 'tofuwave', 'RallyRex', 'xoBella', 'Captain_Juno', 'grassgod', 'Moxie12', 'jellyroll', 'NetNinja', 'Skye_Rae', 'Tuck_42', 'boomerang', 'Volt_Vee', 'Pebbles'];
const week = () => { const d = new Date(); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };

export class VolleyRoom extends Room {
  maxClients = MAX_PLAYERS;
  autoDispose = true;
  state = new State();

  async onCreate() {
    this.recs = new Map();
    this.t = 0;
    this.badges = new BadgeBook();
    this.practice = new Match(this, 'practice', { cx: PRACTICE.cx, cz: PRACTICE.cz, id: 'prac' });
    this.main = null;
    this.tutorials = new Map(); // sid -> Match
    this.tutSlot = 0;
    this.state.phase = 'wait'; this.state.endsAt = 0; this.state.mode = 'solo'; this.state.board = '{}';
    this.lastSnap = 0; this.acc = 0;
    const dt = 1 / TICK_HZ;
    this.setSimulationInterval((ms) => {
      this.acc += Math.min(0.25, ms / 1000);
      let n = 0;
      while (this.acc >= dt && n < 6) { this.step(dt); this.acc -= dt; n++; }
      if (n === 6) this.acc = 0;
    }, 1000 / TICK_HZ);
    this.registerMessages();
    this.refreshBoards();
  }

  // ------------------------------------------------------------------ lifecycle
  async onAuth(client, options = {}) {
    const legion = options && options.token ? await verifyToken(options.token) : null;
    return { legion };
  }

  async onJoin(client, options = {}) {
    const legion = client.auth && client.auth.legion;
    const guest = typeof options.pid === 'string' && /^g_[A-Za-z0-9_-]{6,48}$/.test(options.pid) ? options.pid : null;
    const key = legion ? 'lg_' + legion.id : guest || 'anon:' + client.sessionId;
    let carried = false;
    if (legion && legion.carriedFrom && legion.carriedFrom.length) carried = await carryGuestProgress(key, legion.carriedFrom).catch(() => false);
    const name = (legion && cleanName(legion.displayName || legion.username)) || cleanName(options.name) || 'Guest' + Math.floor(1000 + Math.random() * 9000);
    const prof = await loadProfile(key);
    prof.name = name;
    if (this.humanCount() >= MAX_PLAYERS) { client.leave(CloseCode.CONSENTED); return; }
    const s = new Player();
    s.name = name; s.uname = legion ? legion.username : ''; s.uid = legion ? legion.id : '';
    s.av = cleanAvatar(options.avatar); s.wins = prof.stats.wins || 0; s.title = prof.eq.title || ''; s.loc = 'lobby'; s.bot = false; s.afk = false; s.ability = prof.eq.ability;
    this.state.players.set(client.sessionId, s);
    const rec = this.makeRec(client.sessionId, client, key, prof, s, name);
    this.recs.set(client.sessionId, rec);
    const sp = this.spawnPoint();
    rec.body.x = sp.x; rec.body.z = sp.z; rec.body.yaw = sp.yaw;
    client.send('welcome', {
      id: client.sessionId, t: this.t, profile: publicProfile(prof), loggedIn: !!legion, carried,
      pos: { x: sp.x, y: 0, z: sp.z, yaw: sp.yaw }, seq: rec.seq,
      courts: [this.practice.setupMsg() && { id: 'prac', ...this.practice.setupMsg() }, this.main && { id: 'main', ...this.main.setupMsg() }].filter(Boolean),
    });
    this.broadcast('feed', { text: `${name} joined` }, { except: client });
    this.badges.join(rec);
    if (!prof.tut && options.skipTut !== true) this.clock.setTimeout(() => { if (this.recs.has(rec.sid) && !rec.prof.tut) this.startTutorial(rec); }, 600);
  }

  makeRec(sid, client, key, prof, state, name, isBot = false) {
    return { sid, client, key, prof, state, name, isBot, body: newBody(), seq: 1, lastMoveAt: this.t, flags: 0, match: null, abil: null, abilReady: 0, region: null, frozenUntil: 0, rl: new Map(), team: 0, vote: '', week: null };
  }

  spawnPoint() { const a = Math.random() * Math.PI * 2, r = Math.random() * 3; return { x: SPAWN.x + Math.cos(a) * r, z: SPAWN.z + Math.sin(a) * r, yaw: SPAWN.yaw }; }

  humanCount() { let n = 0; for (const r of this.recs.values()) if (!r.isBot) n++; return n; }

  async onLeave(client) {
    const rec = this.recs.get(client.sessionId);
    if (!rec) return;
    this.leaveCourts(rec);
    this.badges.leave(rec.sid);
    this.state.players.delete(rec.sid);
    this.recs.delete(rec.sid);
    touch(rec.key);
    if (![...this.recs.values()].some((r) => r.key === rec.key)) await releaseProfile(rec.key);
  }

  leaveCourts(rec) {
    if (this.practice.members.has(rec.sid)) this.practice.removeMember(rec.sid);
    if (this.main && this.main.members.has(rec.sid)) this.main.removeMember(rec.sid);
    const tut = this.tutorials.get(rec.sid);
    if (tut) this.endTutorial(rec.sid);
  }

  async onDispose() { for (const rec of this.recs.values()) touch(rec.key); await flushProfiles(); }

  onBeforeShutdown() {
    const secs = Math.max(0, Number(process.env.DRAIN_SECONDS ?? 60));
    this.saveAll(); flushProfiles();
    this.broadcast('toast', { text: `Server update: moving you to a fresh server in ${secs} s (your progress is saved)`, kind: 'warn' });
    const close = () => { this.saveAll(); this.disconnect(CloseCode.SERVER_SHUTDOWN).catch(() => {}); };
    if (!secs || this.clients.length === 0) { close(); return; }
    this.clock.setTimeout(close, secs * 1000);
  }
  saveAll() { for (const rec of this.recs.values()) touch(rec.key); }

  // ------------------------------------------------------------------ helpers
  rateOk(rec, type, perSec, burst = perSec) {
    let b = rec.rl.get(type);
    if (!b) { b = { tokens: burst, at: this.t }; rec.rl.set(type, b); }
    b.tokens = Math.min(burst, b.tokens + (this.t - b.at) * perSec); b.at = this.t;
    if (b.tokens < 1) return false;
    b.tokens -= 1; return true;
  }
  toast(rec, text, kind = 'info') { rec.client.send('toast', { text, kind }); }
  sendProfile(rec) { if (!rec.isBot) { touch(rec.key); rec.client.send('profile', publicProfile(rec.prof)); } }

  // Server-decided placement (spawn, court, shuffle). region: a rect the player must stay in, or null = the islands.
  teleport(rec, x, z, yaw, region = null) {
    const b = rec.body;
    b.x = x; b.z = z; b.y = 0; b.vx = b.vy = b.vz = 0; b.yaw = yaw; b.grounded = true; b.diveT = b.proneT = 0;
    rec.region = region;
    rec.seq++;
    rec.lastMoveAt = this.t;
    rec.client.send('auth', { x, y: 0, z, yaw, region, seq: rec.seq });
  }
  toLobby(rec, near = null) {
    const sp = near || this.spawnPoint();
    rec.match = null;
    rec.state.loc = 'lobby';
    this.teleport(rec, sp.x, sp.z, sp.yaw ?? SPAWN.yaw, null);
  }

  stat(rec, key, n = 1) { if (rec.isBot) return; rec.prof.stats[key] = (rec.prof.stats[key] || 0) + n; touch(rec.key); }
  weekly(rec, key) {
    if (rec.isBot) return;
    const p = rec.prof;
    if (!p.week || p.week.id !== week()) p.week = { id: week(), wins: 0, elims: 0 };
    p.week[key]++;
    queueScore(key === 'wins' ? 'weekly_wins' : 'weekly_elims', rec.key, p.week[key]);
  }
  coins(rec, n) { if (!rec.isBot && n) { rec.prof.coins += n; rec.client.send('coins', { n }); } }

  // ------------------------------------------------------------------ bots
  makeBot(kind, skill = 0.8, name = null) {
    const sid = 'b' + Math.random().toString(36).slice(2, 10);
    const used = new Set([...this.recs.values()].map((r) => r.name));
    const nm = name || BOT_NAMES.filter((n) => !used.has(n))[Math.floor(Math.random() * 10)] || 'Player' + Math.floor(Math.random() * 999);
    const s = new Player();
    s.name = nm; s.uname = ''; s.uid = ''; s.av = cleanAvatar(randomOutfit()); s.wins = Math.floor(Math.random() * Math.random() * 40); s.title = ''; s.loc = kind === 'practice' ? 'practice' : 'match'; s.bot = true; s.afk = false; s.ability = 'adrenaline';
    this.state.players.set(sid, s);
    const prof = freshProfile('anon:' + sid);
    prof.eq.ball = BALLS[Math.floor(Math.random() * BALLS.length)].id;
    prof.eq.boom = EXPLOSIONS[Math.floor(Math.random() * EXPLOSIONS.length)].id;
    const rec = this.makeRec(sid, NO_CLIENT, 'anon:' + sid, prof, s, nm, true);
    rec.skill = skill * (0.9 + Math.random() * 0.12);
    rec.botKind = kind;
    this.recs.set(sid, rec);
    return rec;
  }
  dropBot(rec) { if (this.recs.get(rec.sid) === rec) { this.state.players.delete(rec.sid); this.recs.delete(rec.sid); } }

  // ------------------------------------------------------------------ abilities
  useAbility(rec) {
    const id = rec.prof.eq.ability || 'adrenaline';
    const a = ABILITIES[id];
    if (!a || this.t < rec.abilReady) return false;
    rec.abil = { id, until: this.t + a.dur };
    rec.abilReady = this.t + a.cd;
    if (rec.match && rec.match.kind === 'main') this.stat(rec, 'abilities');
    rec.client.send('abil', { id, until: rec.abil.until, ready: rec.abilReady });
    this.broadcast('fx', { k: 'abil', id: rec.sid, a: id }, { except: rec.client });
    return true;
  }

  // ------------------------------------------------------------------ match callbacks
  onTouch(match, m, kind, perfect, weak) {
    const rec = m.rec;
    this.broadcast('fx', { k: 'hit', id: rec.sid, kind, perfect, weak, m: match.id });
    if (rec.isBot) return;
    rec.client.send('hitq', { kind, perfect, weak });
    if (match.kind !== 'main') return;
    if (kind === 'spike') this.stat(rec, 'spikes');
    else if (kind === 'bump') this.stat(rec, 'bumps');
    if (kind !== 'toss' && kind !== 'serve' && match.rally > 1) { this.stat(rec, 'saves'); this.coins(rec, REWARD.save); }
    if (perfect) this.stat(rec, 'perfects');
    this.sendProfile(rec);
    this.badges.check(rec);
  }

  onPracticeMiss(match, humans) { for (const h of humans) h.rec.client.send('missed', {}); }

  onEliminated(match, victim, by) {
    const v = victim.rec;
    const text = by ? `${by.rec.name} eliminated ${v.name}!` : `${v.name} eliminated!`;
    this.send(match, 'feed', { text, kind: 'elim' });
    if (match.kind === 'main') {
      if (!v.isBot) { v.prof.stats.streak = 0; touch(v.key); }
      if (by) {
        this.stat(by.rec, 'elims'); this.weekly(by.rec, 'elims');
        this.coins(by.rec, REWARD.elim);
        if (!by.rec.isBot) { by.rec.client.send('elimd', { name: v.name, coins: REWARD.elim }); this.sendProfile(by.rec); this.badges.check(by.rec); }
      }
    }
    // the victim drops with the slab. CPUs vanish; a person gets the death screen and goes
    // back to the lobby only when they press Continue (after Boxity's ad countdown)
    if (v.isBot) this.clock.setTimeout(() => { if (this.recs.has(v.sid)) this.dropBot(v); }, 1700);
    else if (match.kind === 'main') v.deadIn = match;
  }

  onBounty(match, victim, by) {
    if (by && !by.rec.isBot) { this.coins(by.rec, REWARD.bounty); by.rec.client.send('bounty', { text: 'Target down!', name: victim.rec.name, coins: REWARD.bounty }); this.sendProfile(by.rec); }
    if (!victim.rec.isBot && by) victim.rec.client.send('toast', { text: `${by.rec.name} stole your Bounty!`, kind: 'warn' });
  }

  onWin(match, win) {
    if (match.kind !== 'main') return;
    for (const m of match.members.values()) {
      const rec = m.rec;
      if (rec.isBot) continue;
      this.stat(rec, 'matches');
      this.coins(rec, REWARD.play);
    }
    for (const m of win) {
      const rec = m.rec;
      rec.state.wins = (rec.state.wins || 0) + 1;
      if (rec.isBot) continue;
      const st = rec.prof.stats;
      this.stat(rec, 'wins'); this.weekly(rec, 'wins');
      st.streak = (st.streak || 0) + 1; st.bestStreak = Math.max(st.bestStreak || 0, st.streak);
      this.coins(rec, REWARD.win);
      rec.client.send('won', { coins: REWARD.win });
    }
    for (const m of match.members.values()) if (!m.rec.isBot) { this.sendProfile(m.rec); this.badges.check(m.rec); }
    flushLeaderboards();
  }

  onMatchOver(match) {
    if (match.kind === 'tutorial') {
      const rec = this.recs.get(match.owner);
      match.phase = 'done';
      if (rec) {
        rec.prof.tut = true;
        this.coins(rec, 50);
        this.sendProfile(rec);
        match.tutStep('done');
        this.badges.check(rec);
      }
      return;
    }
    for (const m of match.members.values()) {
      const rec = m.rec;
      if (rec.isBot) { this.dropBot(rec); continue; }
      if (rec.deadIn === match) { rec.deadIn = null; rec.client.send('deathHide', {}); } // round over while dead: no respawn
      if (this.recs.has(rec.sid) && rec.match === match) this.toLobby(rec);
    }
    this.main = null;
    this.broadcast('mclear', { m: 'main' });
    this.state.phase = 'wait';
    this.state.endsAt = 0;
    this.state.solo = 0; this.state.duos = 0;
    for (const r of this.recs.values()) r.vote = '';
    this.refreshBoards();
  }

  send(match, type, data) { if (match.kind === 'tutorial') { const r = this.recs.get(match.owner); if (r) r.client.send(type, data); } else this.broadcast(type, data); }

  // ------------------------------------------------------------------ tutorial
  startTutorial(rec) {
    if (this.tutorials.has(rec.sid)) return;
    if (this.practice.members.has(rec.sid)) this.practice.removeMember(rec.sid);
    const c = tutorialCenter(this.tutSlot++);
    const m = new Match(this, 'tutorial', { cx: c.cx, cz: c.cz, id: 'tut', owner: rec.sid });
    this.tutorials.set(rec.sid, m);
    rec.state.loc = 'tutorial';
    m.startTutorial(rec);
  }
  endTutorial(sid, toLobby = false) {
    const m = this.tutorials.get(sid);
    if (!m) return;
    this.tutorials.delete(sid);
    for (const mem of [...m.members.values()]) if (mem.rec.isBot) this.dropBot(mem.rec);
    const rec = this.recs.get(sid);
    if (rec) { rec.client.send('mclear', { m: 'tut' }); if (toLobby) this.toLobby(rec); }
  }

  // ------------------------------------------------------------------ matchmaking
  eligible() {
    return [...this.recs.values()].filter((r) => !r.isBot && r.prof.tut && !r.state.afk && (r.state.loc === 'lobby' || r.state.loc === 'practice'));
  }

  startMain() {
    const humans = this.eligible().slice(0, MAX_PLAYERS);
    if (!humans.length) return;
    const duosVotes = this.state.duos, soloVotes = this.state.solo;
    let total = Math.min(MAX_PLAYERS, Math.max(humans.length, BOT_FILL));
    const duos = duosVotes > soloVotes && total >= 4;
    if (duos && total % 2) total = Math.min(MAX_PLAYERS, total + 1);
    for (const r of humans) if (this.practice.members.has(r.sid)) this.practice.removeMember(r.sid);
    const recs = [...humans];
    while (recs.length < total) recs.push(this.makeBot('match', 0.62 + Math.random() * 0.3));
    if (duos) { recs.sort(() => Math.random() - 0.5); recs.forEach((r, i) => { r.team = Math.floor(i / 2); }); }
    const mod = MODIFIERS[Math.floor(Math.random() * MODIFIERS.length)];
    // bounty: the human on the longest win streak, if anyone has one
    const hot = humans.filter((r) => (r.prof.stats.streak || 0) >= 1).sort((a, b) => b.prof.stats.streak - a.prof.stats.streak)[0];
    const match = new Match(this, 'main', { cx: ARENA.cx, cz: ARENA.cz, id: 'main' });
    this.main = match;
    for (const r of recs) r.state.loc = 'match';
    match.startMain(recs, { duos, mod, bountySid: hot ? hot.sid : '' });
    this.state.phase = 'match';
    this.state.mode = duos ? 'duos' : 'solo';
    this.broadcast('feed', { text: `${duos ? 'Duos' : 'Solo'} gamemode is selected!` });
  }

  async refreshBoards() {
    const keys = ['bestStreak', 'playSecs', 'wins', 'elims', 'saves'];
    const lists = await Promise.all(keys.map((k) => topBy(k, 10)));
    const [ww, we] = await Promise.all([topWeekly('wins', week()), topWeekly('elims', week())]);
    this.state.board = JSON.stringify({ ...Object.fromEntries(keys.map((k, i) => [k, lists[i]])), wins_week: ww, elims_week: we });
  }

  // ------------------------------------------------------------------ main loop
  step(dt) {
    this.t += dt;
    const t = this.t;
    // intermission + vote
    if (this.state.phase === 'wait') {
      const n = this.eligible().length;
      if (n < FLOW.minHumans) this.state.endsAt = 0;
      else if (!this.state.endsAt) this.state.endsAt = t + (FAST_FLOW ? 6 : FLOW.intermission);
      else if (t >= this.state.endsAt) this.startMain();
    }
    if (this.main) this.main.step(dt);
    this.practice.step(dt);
    for (const m of this.tutorials.values()) m.step(dt);
    // the Practice pad: stepping on it teleports you onto the practice court (humans share one slab vs 3 CPUs)
    const P = PRACTICE_PAD;
    for (const rec of this.recs.values()) {
      if (rec.isBot || rec.state.loc !== 'lobby') continue;
      const b = rec.body;
      if (b.x >= P.minX && b.x <= P.maxX && b.z >= P.minZ && b.z <= P.maxZ && this.practice.practiceJoin(rec)) rec.state.loc = 'practice';
    }
    // play time (wheel) once a second
    if (Math.floor(t) !== Math.floor(t - dt)) {
      for (const rec of this.recs.values()) {
        if (rec.isBot) continue;
        rec.prof.stats.playSecs = (rec.prof.stats.playSecs || 0) + 1;
        if (rec.prof.stats.playSecs % 60 === 0) this.sendProfile(rec);
      }
      if (Math.floor(t) % 60 === 0) this.refreshBoards();
    }
    if (t - this.lastSnap >= 1 / SNAP_HZ - 1e-6 && this.recs.size) {
      this.lastSnap = t;
      const p = [];
      for (const r of this.recs.values()) {
        const b = r.body;
        let f = r.isBot ? (b.grounded ? 0 : 1) | (r.match && r.match.members.get(r.sid) && t - r.match.members.get(r.sid).lastHit < 0.35 ? 8 : 0) : r.flags;
        if (r.abil && r.abil.until > t) f |= 16;
        p.push([r.sid, Math.round(b.x * 100) / 100, Math.round(b.y * 100) / 100, Math.round(b.z * 100) / 100, Math.round(b.yaw * 100) / 100, f]);
      }
      this.broadcast('s', { t: Math.round(t * 1000) / 1000, p });
    }
  }

  // ------------------------------------------------------------------ messages
  registerMessages() {
    const on = (type, fn) => this.onMessage(type, (client, data) => {
      const rec = this.recs.get(client.sessionId);
      if (!rec) return;
      try { fn(rec, data); } catch (e) { console.warn(`[room] ${type} failed`, e); }
    });
    on('m', (rec, d) => this.onMove(rec, d));
    on('ping', (rec, d) => rec.client.send('pong', d));
    on('hit', (rec, d) => {
      if (!this.rateOk(rec, 'hit', 8, 4) || !d || typeof d !== 'object') return;
      const match = rec.match;
      if (!match) return;
      const r = match.tryHit(rec.sid, { t: Number(d.t), yaw: isNum(d.yaw) ? d.yaw : rec.body.yaw, air: !!d.air, dive: !!d.dive });
      if (!r.ok && r.why === 'miss') rec.client.send('hitq', { miss: true });
    });
    on('abil', (rec) => { if (this.rateOk(rec, 'abil', 2, 2)) { if (!this.useAbility(rec)) rec.client.send('abil', { id: rec.prof.eq.ability, until: rec.abil ? rec.abil.until : 0, ready: rec.abilReady }); } });
    on('vote', (rec, d) => {
      if (this.state.phase !== 'wait' || (d !== 'solo' && d !== 'duos') || !this.rateOk(rec, 'vote', 2, 3)) return;
      rec.vote = d;
      let s = 0, du = 0; for (const r of this.recs.values()) { if (r.vote === 'solo') s++; if (r.vote === 'duos') du++; }
      this.state.solo = s; this.state.duos = du;
    });
    on('afk', (rec, d) => { if (this.rateOk(rec, 'afk', 1, 3)) rec.state.afk = !!d; });
    on('exitPractice', (rec) => {
      if (!this.practice.members.has(rec.sid)) return;
      this.practice.removeMember(rec.sid);
      this.toLobby(rec, { x: PRACTICE_PAD.minX - 3, z: (Math.random() - 0.5) * 4, yaw: -Math.PI / 2 });
    });
    on('continue', (rec) => {
      const match = rec.deadIn;
      if (!match || rec.match !== match) return;
      rec.deadIn = null;
      this.toLobby(rec);
      rec.client.send('spectate', { m: match.id });
    });
    on('tutSkip', (rec) => { rec.prof.tut = true; touch(rec.key); this.endTutorial(rec.sid, true); this.sendProfile(rec); });
    on('tutLeave', (rec) => { if (rec.prof.tut) this.endTutorial(rec.sid, true); });
    on('tutStart', (rec) => { if (!this.tutorials.has(rec.sid) && rec.state.loc !== 'match' && this.rateOk(rec, 'tut', 0.2, 1)) this.startTutorial(rec); });
    // economy
    const ecoMsg = (type, fn) => on(type, (rec, d) => {
      if (!this.rateOk(rec, 'eco', 4, 6)) return;
      const r = fn(rec.prof, d);
      if (r && r.error) this.toast(rec, r.error, 'warn');
      else if (r && r.text) this.toast(rec, r.text, 'good');
      if (r && !r.error) { rec.state.title = rec.prof.eq.title; rec.state.ability = rec.prof.eq.ability; }
      this.sendProfile(rec);
      return r;
    });
    on('buyPack', (rec, id) => {
      if (!this.rateOk(rec, 'eco', 4, 6)) return;
      const r = eco.openPack(rec.prof, String(id));
      if (r.error) { this.toast(rec, r.error, 'warn'); return; }
      rec.client.send('pack', r);
      this.sendProfile(rec);
    });
    on('spin', (rec) => {
      if (!this.rateOk(rec, 'eco', 4, 6)) return;
      const r = eco.spinWheel(rec.prof);
      if (r.error) { this.toast(rec, r.error, 'warn'); return; }
      rec.client.send('spin', r);
      this.sendProfile(rec);
    });
    ecoMsg('equip', (p, d) => eco.equip(p, d || {}));
    ecoMsg('buyAbility', (p, d) => eco.buyAbility(p, String(d)));
    ecoMsg('claimDaily', (p) => eco.claimDaily(p));
    ecoMsg('claimQuest', (p, d) => eco.claimQuest(p, d));
    ecoMsg('refreshQuests', (p) => eco.refreshQuests(p));
    ecoMsg('claimAch', (p, d) => eco.claimAchievement(p, d || {}));
    on('adReward', (rec, token) => this.onAdReward(rec, token));
    on('avatar', (rec, d) => { if (this.rateOk(rec, 'avatar', 1, 3)) rec.state.av = cleanAvatar(d); });
    on('emote', (rec, d) => {
      if (typeof d !== 'string' || !/^[A-Za-z0-9]{6,40}$/.test(d) || !this.rateOk(rec, 'emote', 2, 3)) return;
      this.broadcast('fx', { k: 'emote', id: rec.sid, e: d }, { except: rec.client });
    });
    on('respawn', (rec) => { if (rec.state.loc === 'lobby' && this.rateOk(rec, 'respawn', 0.3, 1)) this.toLobby(rec); });
    on('chat', (rec, d) => {
      const text = String(d || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 90);
      if (!text || !this.rateOk(rec, 'chat', 1, 2)) return;
      this.broadcast('chat', { id: rec.sid, t: text });
    });
  }

  // d: [x, y, z, yaw, flags, seq]
  onMove(rec, d) {
    if (!Array.isArray(d) || d.length < 6 || !isNum(d[0], d[1], d[2], d[3], d[4], d[5])) return;
    if (d[5] !== rec.seq) return; // from before the last teleport
    const b = rec.body;
    rec.flags = d[4] & 255;
    b.yaw = d[3];
    if (rec.frozenUntil > this.t) { rec.lastMoveAt = this.t; return; }
    const dt = Math.max(0.05, Math.min(1, this.t - rec.lastMoveAt));
    const fast = rec.abil && rec.abil.id === 'adrenaline' && rec.abil.until > this.t - 0.5 ? ADRENALINE_SPEED : 1;
    const horiz = Math.hypot(d[0] - b.x, d[2] - b.z);
    if (horiz > MOVE.maxSpeedCheck * fast * dt + 1.2 || d[1] < -0.5 || d[1] > 4.5) { this.correct(rec); return; }
    const p = { x: d[0], z: d[2] };
    if (rec.region) {
      const r = rec.region, m = MOVE.radius;
      p.x = Math.max(r.minX + m, Math.min(r.maxX - m, p.x)); p.z = Math.max(r.minZ + m, Math.min(r.maxZ - m, p.z));
    } else clampToRegions(p, LOBBY_REGIONS, SOLIDS);
    if (Math.hypot(p.x - d[0], p.z - d[2]) > 0.6) { b.x = p.x; b.z = p.z; this.correct(rec); return; }
    b.x = p.x; b.y = Math.max(0, d[1]); b.z = p.z;
    b.grounded = !(rec.flags & 1);
    b.diveT = rec.flags & 2 ? 0.1 : 0; b.proneT = rec.flags & 4 ? 0.1 : 0;
    rec.lastMoveAt = this.t;
  }
  correct(rec) { const b = rec.body; this.teleport(rec, b.x, b.z, b.yaw, rec.region); }

  async onAdReward(rec, token) {
    if (rec.isBot || !this.rateOk(rec, 'adReward', 0.2, 2)) return;
    const wait = Math.ceil(((rec.prof.adAt || 0) + AD_REWARD.cooldown * 1000 - Date.now()) / 1000);
    if (wait > 0) { rec.client.send('adResult', { ok: false, wait }); return; }
    const ok = await verifyAdReward(token);
    if (!this.recs.has(rec.sid)) return;
    if (!ok) { rec.client.send('adResult', { ok: false, error: 'not verified' }); return; }
    rec.prof.adAt = Date.now();
    this.coins(rec, AD_REWARD.coins);
    rec.client.send('adResult', { ok: true, coins: AD_REWARD.coins, wait: AD_REWARD.cooldown });
    this.sendProfile(rec);
  }
}

function cleanAvatar(a) {
  if (!a || typeof a !== 'object') return '';
  const eq = {}, pr = {};
  for (const k of AVATAR_SLOTS) {
    const v = a.eq && a.eq[k];
    if (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) && v !== '-1' && v !== 'undefined') eq[k] = v;
  }
  for (const [k, [lo, hi]] of Object.entries(PROPORTIONS)) {
    const v = a.pr && a.pr[k];
    if (typeof v === 'number' && Number.isFinite(v) && v !== 1) pr[k] = Math.max(lo, Math.min(hi, +v.toFixed(3)));
  }
  return JSON.stringify({ eq, pr }).slice(0, 1500);
}
