// The game on screen: renderer, third-person camera, the local player's own movement
// (predicted here, checked by the server), remote players drawn from snapshots, every court
// and its ball (closed-form flights against the shared clock), touches, and the glue to the UI.
import * as THREE from 'three';
import { Input } from './input.js';
import { World } from '../render/world.js';
import { FX } from '../render/fx.js';
import { CourtView } from '../render/court.js';
import { Avatar } from '../render/avatar.js';
import { ballTexture } from '../render/balls.js';
import { loadGrass, TEX } from '../render/textures.js';
import { Bloxity, avatarPayload } from '../bloxity.js';
import { BALL, MOVE, DIVE, SNAP_HZ, INTERP_DELAY, ABILITIES, ADRENALINE_SPEED, AD_REWARD } from '@shared/constants.js';
import { ARENA, PRACTICE, PACK_STANDS, WHEEL, LOBBY_REGIONS, SOLIDS, clampToRegions, formation } from '@shared/world.js';
import { ballAt } from '@shared/ball.js';
import { newBody, stepBody } from '@shared/move.js';
import { BALL_BY_ID, PACKS } from '@shared/items.js';

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _b = { x: 0, y: 0, z: 0 };
const lerpAngle = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * k; };

// One ball on screen (each court has its own).
class BallView {
  constructor(scene) {
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.radius, 28, 18), new THREE.MeshStandardMaterial({ map: ballTexture('default'), roughness: 0.45 }));
    this.mesh.castShadow = true; this.mesh.visible = false;
    scene.add(this.mesh);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: TEX.shadow(), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.visible = false; this.shadow.renderOrder = 1;
    scene.add(this.shadow);
    // trail: a fading ribbon of recent positions
    this.trailN = 18;
    this.trailPos = new Float32Array(this.trailN * 2 * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    const idx = []; for (let i = 0; i < this.trailN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    const alpha = new Float32Array(this.trailN * 2); for (let i = 0; i < this.trailN; i++) alpha[i * 2] = alpha[i * 2 + 1] = 1 - i / (this.trailN - 1);
    g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    this.trailMat = new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color('#ffffff') } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color * vA * 0.9, vA * 0.9); }' });
    this.trail = new THREE.Mesh(g, this.trailMat); this.trail.frustumCulled = false; this.trail.visible = false;
    scene.add(this.trail);
    this.hist = [];
    this.skin = 'default';
  }
  setSkin(id) {
    if (id === this.skin) return;
    this.skin = id;
    this.mesh.material.map = ballTexture(id); this.mesh.material.needsUpdate = true;
    this.trailMat.uniforms.color.value.set((BALL_BY_ID[id] || BALL_BY_ID.default).trail);
  }
  place(p, show, flying, cam) {
    this.mesh.visible = show;
    this.shadow.visible = show && p.y > 0.6;
    if (!show) { this.trail.visible = false; this.hist.length = 0; return; }
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.rotation.x += 0.15; this.mesh.rotation.z += 0.07;
    const s = Math.max(0.5, 1.6 - p.y * 0.05);
    this.shadow.scale.set(s, s, 1); this.shadow.position.set(p.x, 0.05, p.z);
    if (!flying) { this.trail.visible = false; this.hist.length = 0; return; }
    this.hist.unshift({ x: p.x, y: p.y, z: p.z });
    if (this.hist.length > this.trailN) this.hist.length = this.trailN;
    if (this.hist.length < 3) { this.trail.visible = false; return; }
    this.trail.visible = true;
    for (let i = 0; i < this.trailN; i++) {
      const h = this.hist[Math.min(i, this.hist.length - 1)];
      const n = this.hist[Math.min(i + 1, this.hist.length - 1)];
      // ribbon width across the view direction
      _v.set(h.x - n.x, h.y - n.y, h.z - n.z);
      _v2.set(h.x - cam.x, h.y - cam.y, h.z - cam.z).cross(_v).normalize().multiplyScalar(BALL.radius * 0.8 * (1 - i / this.trailN));
      this.trailPos.set([h.x + _v2.x, h.y + _v2.y, h.z + _v2.z, h.x - _v2.x, h.y - _v2.y, h.z - _v2.z], i * 6);
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
  }
}

export class Game {
  constructor(canvas, net, ui, audio) {
    this.canvas = canvas; this.net = net; this.ui = ui; this.audio = audio;
    this.input = new Input(canvas);
    this.settings = { sens: 1, quality: 'High' };
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#cdeefc', 160, 620);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
    const hemi = new THREE.HemisphereLight('#d6f1ff', '#6b8f4a', 1.25);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#fff6e0', 2.2);
    this.sun.position.set(40, 80, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 220;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.world = new World(this.scene);
    this.fx = new FX(this.scene);
    this.courts = {
      main: { view: new CourtView(this.scene, this.fx, { id: 'main', cx: ARENA.cx, cz: ARENA.cz, idle: 6 }), ball: new BallView(this.scene), members: [], b: null, status: '', sub: '' },
      prac: { view: new CourtView(this.scene, this.fx, { id: 'prac', surface: 'clay', cx: PRACTICE.cx, cz: PRACTICE.cz, idle: 4 }), ball: new BallView(this.scene), members: [], b: null, status: '', sub: '' },
    };
    this.players = new Map();
    this.me = newBody();
    this.seq = 0;
    this.region = null;
    this.camYaw = Math.PI; this.camPitch = 0.32; this.camDist = 5; this.camZoom = 5; // default: fully zoomed in (the wheel zooms out to 24)
    this.time = 0;
    this.sendAcc = 0;
    this.swing = null;
    this.abil = { id: 'adrenaline', until: 0, ready: 0 };
    this.diveReady = 0;
    this.frozenUntil = 0;
    this.falling = null;
    this.spectate = null; // sid
    this.profile = null;
    this.paused = false;
    this.rmb = false;
    this.resize();
    addEventListener('resize', () => this.resize());
    // right-drag to turn the camera while the cursor is free
    canvas.addEventListener('mousedown', (e) => { if (e.button === 2) this.rmb = true; });
    addEventListener('mouseup', (e) => { if (e.button === 2) this.rmb = false; });
    addEventListener('mousemove', (e) => { if (this.rmb && !this.input.locked) { this.input.look.dx += e.movementX; this.input.look.dy += e.movementY; } });
    addEventListener('wheel', (e) => { if (!this.ui.isMenuOpen()) this.camZoom = Math.max(5, Math.min(24, this.camZoom + Math.sign(e.deltaY) * 1.2)); }, { passive: true });
  }

  async init() {
    await loadGrass();
    const net = this.net;
    net.on('snapshot', (s) => this.onSnapshot(s));
    const on = (type, fn) => net.on('msg:' + type, (m) => { try { fn(m); } catch (e) { console.error(type, e); } });
    on('auth', (m) => this.onAuth(m));
    on('profile', (p) => this.setProfile(p));
    on('msetup', (m) => this.onSetup(m));
    on('mball', (m) => this.onBall(m));
    on('mland', (m) => this.onLand(m));
    on('mshuffle', (m) => this.onShuffle(m));
    on('mmembers', (m) => { const c = this.court(m.m); if (c) { c.members = m.members; c.bounty = m.bounty; } });
    on('mstatus', (m) => { const c = this.court(m.m); if (c) { c.status = m.text; c.sub = m.sub; } });
    on('mwin', (m) => this.onWin(m));
    on('mclear', (m) => this.onClear(m));
    on('tut', (m) => this.onTut(m));
    on('fx', (m) => this.onFx(m));
    on('hitq', (m) => this.onHitQuality(m));
    on('feed', (m) => this.ui.feed(m.text, m.kind));
    on('toast', (m) => this.ui.toast(m.text, m.kind));
    on('coins', (m) => { this.ui.coinPop(m.n); this.audio.play('coin', { vol: 0.5 }); });
    on('elimd', (m) => { this.ui.popup(`Eliminated ${m.name}! +${m.coins}`, 'gold'); });
    on('bounty', (m) => this.ui.bountyPop(m));
    on('won', (m) => { this.audio.play('cheer', { vol: 0.8 }); this.audio.play('levelup'); this.ui.popup(`You won! +${m.coins}`, 'gold'); });
    on('spectate', () => this.startSpectate());
    on('deathHide', () => this.closeDeath(true));
    on('missed', () => this.ui.popup('Missed!', 'bad'));
    on('abil', (m) => { this.abil = { id: m.id, until: m.until, ready: m.ready }; if (m.until > this.serverNow()) this.onAbilityFx(this.net.id, m.id); });
    on('pack', (m) => { this.audio.play('cash'); this.ui.packReveal(m); });
    on('spin', (m) => { this.world.spinWheelTo(m.slice); this.ui.wheelSpin(m); });
    on('adResult', (m) => { this.adPending = false; if (m.ok) this.ui.toast(`+${m.coins} coins!`, 'good'); });
    on('chat', (m) => { if (Bloxity.embedded()) return; const p = this.players.get(m.id); if (p) p.av.showChat(m.t); });

    this.emoteClips = new Map();
    Bloxity.emoteCatalog().then((list) => { for (const e of list) if (e && e.id && e.clip) this.emoteClips.set(e.id, e.clip); });
    Bloxity.onEvent('play_emote', (id) => {
      try {
        const clip = this.emoteClips.get(id);
        if (clip && this.mine) this.mine.av.playEmote(clip);
        this.net.send('emote', id);
      } catch (e) { console.warn('[emote]', e); }
    });
    Bloxity.onEvent('respawn_request', () => this.net.send('respawn'));
    // Boxity draws the chat; we only put each message over the sender's head
    this.chatEnabled = true;
    Bloxity.onChat((m) => {
      try {
        if (!m || !this.chatEnabled) return;
        const uid = String(m.userId || '').replace(/^legion_/, '');
        const p = m.isLocalPlayer ? this.mine : [...this.players.values()].find((x) => x.state && x.state.uid && x.state.uid === uid);
        if (p) p.av.showChat(Bloxity.bubbleText(m));
      } catch (e) { console.warn(e); }
    });
    Bloxity.onBreak(() => { this.paused = true; this.audio.setMuted(true); }, () => { this.paused = false; this.audio.setMuted(false); });
    Bloxity.onAvatarChanged(() => this.sendAvatar());
    Bloxity.onProportionsChanged(() => this.sendAvatar());
    this.master = 0.8; this.musicVol = 0.6;
    Bloxity.listenSetting('master_volume', (v) => { this.master = num(v, 80) / 100; this.applyVolumes(); });
    Bloxity.listenSetting('music_volume', (v) => { this.musicVol = num(v, 60) / 100; this.applyVolumes(); });
    Bloxity.listenSetting('camera_sensitivity', (v) => { this.settings.sens = Math.max(0.1, Math.min(5, num(v, 1))); });
    Bloxity.listenSetting('graphics_quality', (v) => this.applyQuality(v || 'High'));
    Bloxity.listenSetting('fullscreen', (v) => Bloxity.setFullscreen(v === 'true'));
    Bloxity.listenSetting('enable_chat', (v) => { this.chatEnabled = v !== 'false'; });
    Bloxity.listenSetting('show_fps', (v) => this.ui.showFps(v === 'true'));
    Bloxity.triggerAllSettings();
  }

  applyVolumes() { this.audio.setVolumes(this.master, this.master * this.musicVol * 0.45); }
  applyQuality(q) {
    this.settings.quality = q;
    const low = /low/i.test(q);
    this.renderer.setPixelRatio(low ? 1 : Math.min(devicePixelRatio, this.input.touch ? 1.5 : 2));
    this.sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.resize();
  }
  sendAvatar() { const look = avatarPayload(); this.net.send('avatar', look); if (this.mine) this.mine.av.setAvatar(look, Bloxity.user() ? Bloxity.skinTextureUrl() : null); }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 80 : 68;
    this.camera.updateProjectionMatrix();
  }

  serverNow() { return this.net.serverTime(); }
  court(id) { if (id === 'tut') return this.courts.tut || null; return this.courts[id] || null; }

  // ------------------------------------------------------------------ room binding
  bindRoom(room, welcome) {
    this.room = room;
    this.boundAt = this.time;
    for (const p of this.players.values()) { this.scene.remove(p.av.root); p.av.dispose(); }
    this.players.clear();
    if (this.net.clockOffset === null) this.net.clockOffset = welcome.t - performance.now() / 1000;
    this.setProfile(welcome.profile);
    this.onAuth({ ...welcome.pos, seq: welcome.seq, region: null });
    for (const c of welcome.courts || []) this.onSetup({ m: c.id, ...c });
    const cb = this.net.cb;
    const add = (s, sid) => this.addPlayer(sid, s);
    cb.onAdd('players', (s, sid) => add(s, sid));
    cb.onRemove('players', (s, sid) => this.removePlayer(sid));
    cb.listen('board', (v) => this.world.setBoards(v));
    if (welcome.carried) this.ui.toast('Your guest progress was moved to your account!', 'good');
  }

  addPlayer(sid, s) {
    if (this.players.has(sid)) return;
    const local = sid === this.net.id;
    const av = new Avatar({ name: s.name, av: s.av, local });
    if (local) av.setAvatar(avatarPayload(), Bloxity.user() ? Bloxity.skinTextureUrl() : null);
    this.scene.add(av.root);
    const p = { sid, state: s, av, snaps: [], x: 0, y: 0, z: 0, yaw: 0, flags: 0, local, speed: 0, lastF: 0 };
    this.players.set(sid, p);
    if (local) this.mine = p;
    else if (s.uname && !s.bot) { if (this.time - (this.boundAt || 0) > 2) Bloxity.playerJoined(s.uname); else Bloxity.playerInRoom(s.uname); }
  }
  removePlayer(sid) {
    const p = this.players.get(sid);
    if (!p) return;
    this.scene.remove(p.av.root); p.av.dispose();
    this.players.delete(sid);
    if (this.spectate === sid) this.nextSpectate(1);
  }

  setProfile(p) {
    this.profile = p;
    this.ui.setProfile(p);
    if (p && p.eq) this.abil.id = p.eq.ability;
  }

  onAuth(m) {
    const b = this.me;
    const far = Math.hypot(m.x - b.x, m.z - b.z) > 25;
    b.x = m.x; b.y = m.y || 0; b.z = m.z; b.vx = b.vy = b.vz = 0; b.yaw = m.yaw ?? b.yaw; b.diveT = b.proneT = 0; b.grounded = true;
    this.seq = m.seq;
    this.region = m.region || null;
    this.falling = null;
    this.dead = false;
    // a new place (spawn, a court, a reshuffle): face where the player faces
    if (m.yaw !== undefined && far) this.camYaw = m.yaw;
  }

  onSnapshot(s) {
    for (const row of s.p) {
      const [sid, x, y, z, yaw, f] = row;
      const p = this.players.get(sid);
      if (!p) continue;
      p.snaps.push({ t: s.t, x, y, z, yaw, f });
      if (p.snaps.length > 30) p.snaps.shift();
    }
  }

  // ------------------------------------------------------------------ courts
  onSetup(m) {
    let c = this.court(m.m);
    if (!c && m.m === 'tut') {
      c = this.courts.tut = { view: new CourtView(this.scene, this.fx, { id: 'tut', cx: 0, cz: 0 }), ball: new BallView(this.scene), members: [], b: null, status: '', sub: '' };
    }
    if (!c) return;
    c.kind = m.kind; c.members = m.members; c.mod = m.mod; c.duos = m.duos; c.bounty = m.bounty; c.status = m.status; c.sub = m.sub;
    c.cells = m.cells;
    c.view.setCells(m.cells);
    if ((m.m === 'main' || m.m === 'tut') && m.members.some((x) => x.sid === this.net.id)) { this.ui.close(); this.stopSpectate(); }
    this.onBall({ m: m.m, ...m.ball, quiet: true });
  }
  onBall(m) {
    const c = this.court(m.m);
    if (!c) return;
    c.b = m;
    c.ball.setSkin(m.skin || 'default');
    if (m.by && !m.quiet) {
      const p = this.players.get(m.by);
      if (p && m.traj) { this.fx.hit(new THREE.Vector3(m.traj.p[0], m.traj.p[1], m.traj.p[2]), (BALL_BY_ID[m.skin] || BALL_BY_ID.default).trail, m.kind === 'spike' || m.perfect); }
    }
    if (m.state === 'fly' && m.traj) this.audio.play(m.kind === 'spike' ? 'spike' : 'bump', { pos: { x: m.traj.p[0], y: m.traj.p[1], z: m.traj.p[2] }, vol: m.kind === 'spike' ? 1 : 0.8, rate: m.kind === 'spike' ? 0.85 : 1 });
  }
  onLand(m) {
    const c = this.court(m.m);
    if (!c) return;
    if (c.b) c.b.state = 'none';
    c.view.land(m.cell, m.boom, m.practice);
    const pos = { x: m.x, y: 0, z: m.z };
    this.audio.synth('thud', { pos, vol: 0.9 });
    if (!m.practice) {
      setTimeout(() => { this.audio.play('boom', { pos, vol: 1 }); this.audio.synth('boom', { pos, vol: 0.6 }); this.shake = 0.5; }, 550);
      if (m.victim) {
        const p = this.players.get(m.victim);
        if (p) setTimeout(() => { p.falling = { t: 0, vy: 9, x: p.x, y: p.y, z: p.z, spin: (Math.random() - 0.5) * 8 }; if (p.local) this.falling = p.falling; }, 550);
        if (m.victim === this.net.id && m.m === 'main') { this.dead = true; this.deathBy = m.by ? this.players.get(m.by)?.state.name || '' : ''; }
        if (m.victim === this.net.id) this.ui.banner('Your slab exploded!', m.by ? `${this.players.get(m.by)?.state.name || 'Someone'} got you` : '', 1800);
      }
    } else if (m.victim === this.net.id) this.ui.popup('Missed!', 'bad');
  }
  onShuffle(m) {
    const c = this.court(m.m);
    if (!c) return;
    c.cells = m.cells;
    c.view.shuffle(m.cells, m.time);
    if (m.cells.some((x) => x.sid === this.net.id)) this.frozenUntil = performance.now() / 1000 + m.time + 0.2;
    this.audio.synth('whoosh', { vol: 0.8 });
  }
  onWin(m) {
    const c = this.court(m.m);
    const mine = m.sids.includes(this.net.id);
    if (m.m === 'tut') return;
    this.ui.banner(`${m.names} ${m.sids.length > 1 ? 'have' : 'has'} won!`, mine ? 'Victory!' : '', 4200);
    if (!this.ui.menu && !this.adPending && !this.death) { this.ui.ads.show('results', this.ui.bannerEl); clearTimeout(this.resultsAdT); this.resultsAdT = setTimeout(() => this.ui.ads.hide('results'), 4500); }
    this.audio.play('cheer', { vol: mine ? 1 : 0.6 });
    for (const sid of m.sids) { const p = this.players.get(sid); if (p) for (let i = 0; i < 3; i++) setTimeout(() => this.fx.explode('confetti', new THREE.Vector3(p.x, p.y + 1, p.z), 6, 6), i * 350); }
    void c;
  }
  onClear(m) {
    if (m.m === 'tut') {
      const c = this.courts.tut;
      if (c) { c.view.dispose(); for (const o of [c.ball.mesh, c.ball.shadow, c.ball.trail]) this.scene.remove(o); delete this.courts.tut; }
      this.ui.tutorial(null);
      return;
    }
    const c = this.court(m.m);
    if (!c) return;
    c.members = []; c.b = null; c.status = ''; c.sub = ''; c.bounty = '';
    c.view.setCells(formation(6, ARENA.cx, ARENA.cz).map((x) => ({ ...x, sid: '' })));
    this.stopSpectate();
  }
  onTut(m) {
    if (m.step === 'done') { this.ui.tutorial({ done: true, text: m.text }); this.audio.play('levelup'); return; }
    this.ui.tutorial({ text: m.text, sub: m.sub, step: m.step });
    if (m.step === 'fight') this.audio.play('ding');
  }
  onFx(m) {
    if (m.k === 'hit') {
      const p = this.players.get(m.id);
      if (p && !p.local) p.av.act(m.kind === 'spike' || m.kind === 'toss' ? m.kind : 'bump');
    } else if (m.k === 'abil') this.onAbilityFx(m.id, m.a);
    else if (m.k === 'emote') { const p = this.players.get(m.id); const clip = this.emoteClips && this.emoteClips.get(m.e); if (p && clip) p.av.playEmote(clip); }
  }
  onAbilityFx(sid, id) {
    const p = this.players.get(sid);
    if (!p) return;
    const a = ABILITIES[id];
    this.fx.ring({ x: p.x, y: p.y, z: p.z }, a ? a.color : '#fff', 4, 0.5);
    for (let i = 0; i < 30; i++) this.fx.spark(new THREE.Vector3(p.x, p.y + 1, p.z), new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 6, (Math.random() - 0.5) * 8), a ? a.color : '#fff', 1.4, 0.6);
    this.audio.synth('zap', { pos: { x: p.x, y: p.y, z: p.z }, vol: 0.8, size: 1 });
  }
  onHitQuality(m) {
    if (m.miss) { this.ui.popup('Miss!', 'bad'); return; }
    if (m.kind === 'toss') return;
    if (m.weak) this.ui.popup('TOO LOW', 'bad');
    else if (m.perfect) { this.ui.popup('PERFECT!', 'gold'); this.audio.play('ding', { vol: 0.6 }); }
    else if (m.kind === 'save') this.ui.popup('SAVE!', 'good');
    else if (m.kind === 'spike') this.ui.popup('SPIKE!', 'good');
  }

  // which court the local player stands on (and their cell)
  myCourt() {
    for (const id of ['tut', 'main', 'prac']) {
      const c = this.courts[id];
      if (c && c.members && c.members.some((x) => x.sid === this.net.id && x.alive)) return { id, c };
    }
    return null;
  }

  // ------------------------------------------------------------------ spectating
  mainAlive() { const c = this.courts.main; return c.members.filter((m) => m.alive && this.players.has(m.sid)).map((m) => m.sid); }
  startSpectate() { const a = this.mainAlive(); this.spectate = a.length ? a[0] : null; }
  stopSpectate() { this.spectate = null; }
  nextSpectate(d) {
    const a = this.mainAlive();
    if (!a.length) { this.spectate = null; return; }
    const i = a.indexOf(this.spectate);
    this.spectate = a[(i + d + a.length) % a.length];
  }

  // ------------------------------------------------------------------ actions
  pressHit() {
    if (!this.mine || this.falling || this.dead) return;
    const mc = this.myCourt();
    const b = this.me;
    const air = !b.grounded;
    if (mc && mc.c.b && mc.c.b.state === 'held' && mc.c.b.holder === this.net.id) {
      this.net.send('hit', { t: this.serverNow(), yaw: this.camYaw, air });
      this.mine.av.act('toss');
      this.audio.synth('whoosh', { vol: 0.4 });
      return;
    }
    this.mine.av.act(air ? 'spike' : 'bump');
    if (!mc || !mc.c.b || mc.c.b.state !== 'fly') return;
    this.swing = { until: this.time + 0.6, court: mc.c }; // an early click waits for the ball
  }

  reachable(traj, t) {
    const b = this.me;
    ballAt(traj, t, _b);
    if (t > traj.t1) return false;
    const dy = _b.y - b.y, hd = Math.hypot(_b.x - b.x, _b.z - b.z);
    const magnet = this.abil.id === 'magnet' && this.abil.until > this.serverNow() ? 1.7 : 1;
    const diving = b.diveT > 0 || b.proneT > 0;
    const air = !b.grounded && b.y > 0.25;
    return hd <= BALL.reach * magnet * (diving ? 1.25 : 1) * 0.97 && dy >= (diving ? -0.2 : BALL.reachLow) && dy <= (air ? BALL.reachHighAir : BALL.reachHigh) * (magnet > 1 ? 1.25 : 1);
  }

  updateSwing() {
    const s = this.swing;
    if (!s) return;
    const b = s.court.b;
    const now = this.serverNow();
    if (!b || b.state !== 'fly') { this.swing = null; return; }
    if (this.reachable(b.traj, now)) {
      const me = this.me;
      this.net.send('hit', { t: now, yaw: this.camYaw, air: !me.grounded, dive: me.diveT > 0 || me.proneT > 0 });
      this.swing = null;
      return;
    }
    if (this.time > s.until) { this.net.send('hit', { t: now, yaw: this.camYaw, air: !this.me.grounded }); this.swing = null; }
  }

  useAbility() { if (this.serverNow() >= this.abil.ready) this.net.send('abil'); else this.ui.popup('Not ready yet', 'bad'); }

  // pack stands / wheel: what the player is standing next to
  nearbyPrompt() {
    if (this.region) return null;
    const b = this.me;
    for (const s of PACK_STANDS) if (Math.hypot(b.x - s.x, b.z - s.z) < 4.2) return { kind: 'pack', id: s.id, text: `Open ${PACKS[s.id].name}`, price: PACKS[s.id].price };
    if (Math.hypot(b.x - WHEEL.x, b.z - WHEEL.z) < 4.6) return { kind: 'wheel', text: 'Spin the Prize Wheel' };
    return null;
  }
  usePrompt() {
    const p = this.nearbyPrompt();
    if (!p) return;
    if (p.kind === 'pack') this.ui.openPackConfirm(p.id);
    else this.ui.open('wheel');
  }

  // ------------------------------------------------------------------ frame
  frame(dt) {
    dt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    if (this.paused) { this.input.endFrame(); return; } // Boxity ad break: everything waits
    this.time += dt;
    const input = this.input;
    const ui = this.ui;
    const menu = ui.isMenuOpen();
    input.enabled = !menu && !ui.isTyping();
    const now = this.serverNow();
    // camera look
    const sens = 0.0024 * this.settings.sens;
    this.camYaw -= input.look.dx * sens;
    this.camPitch = Math.max(-0.35, Math.min(1.2, this.camPitch + input.look.dy * sens));
    // actions
    if (input.hit('Mouse0') || input.hit('Hit') || input.hit('KeyF')) this.pressHit();
    if (input.hit('KeyR') || input.hit('Abil')) this.useAbility();
    if (input.hit('KeyE') && this.nearbyPrompt()) this.usePrompt();
    if (this.spectate && !this.dead && (input.hit('KeyW') || input.hit('KeyA') || input.hit('KeyS') || input.hit('KeyD') || Math.hypot(input.stick.x, input.stick.y) > 0.4)) this.stopSpectate();
    this.updateSwing();
    // local movement
    const b = this.me;
    const tNow = performance.now() / 1000;
    if (this.dead && !this.falling) {
      // eliminated: wait on the death screen, watching the match
    } else if (this.falling) {
      const f = this.falling;
      f.t += dt; f.vy -= 24 * dt;
      b.y += f.vy * dt; b.x += Math.sin(b.yaw) * -2 * dt;
      if (b.y < -40) b.y = -40;
    } else if (this.frozenUntil > tNow) {
      // reshuffling: ride the slab (the server moves us; follow our own snapshots)
      const p = this.mine && this.interp(this.mine, now - INTERP_DELAY * 0.5);
      if (p) { b.x = p.x; b.z = p.z; }
    } else {
      const ax = input.axes();
      const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
      let wx = -Math.cos(this.camYaw) * ax.x + fx * ax.z;
      let wz = Math.sin(this.camYaw) * ax.x + fz * ax.z;
      if (this.spectate) { wx = 0; wz = 0; }
      const jump = input.hit('Space') || input.hit('Jump');
      let dive = false;
      if ((input.hit('KeyE') && !this.nearbyPrompt()) || input.hit('Dive') || input.hit('ShiftLeft')) { if (this.time >= this.diveReady && b.diveT <= 0 && b.proneT <= 0) { dive = true; this.diveReady = this.time + DIVE.cooldown; } }
      const speedMul = this.abil.id === 'adrenaline' && this.abil.until > now ? ADRENALINE_SPEED : 1;
      const region = this.region;
      const ev = stepBody(b, { wx, wz, jump, dive }, dt, {
        speedMul,
        clamp: (bb) => {
          if (region) { const m = MOVE.radius; bb.x = Math.max(region.minX + m, Math.min(region.maxX - m, bb.x)); bb.z = Math.max(region.minZ + m, Math.min(region.maxZ - m, bb.z)); }
          else clampToRegions(bb, LOBBY_REGIONS, SOLIDS);
        },
      });
      if (ev.jumped) this.audio.play('jump', { vol: 0.5 });
      if (ev.dived) { this.audio.synth('whoosh', { vol: 0.6 }); this.mine && this.mine.av.act('dive'); }
      if (b.grounded && Math.hypot(b.vx, b.vz) > 2 && this.time - (this.stepAt || 0) > 0.32) { this.stepAt = this.time; this.audio.play('walk', { vol: 0.25 }); }
    }
    // never let a bad number stick to the player (it would hide the whole body)
    if (![b.x, b.y, b.z, b.vx, b.vy, b.vz, b.yaw].every(Number.isFinite)) { const l = this.lastGood || { x: 0, y: 0, z: 9, yaw: Math.PI }; b.x = l.x; b.y = l.y; b.z = l.z; b.yaw = l.yaw; b.vx = b.vy = b.vz = 0; }
    else this.lastGood = { x: b.x, y: b.y, z: b.z, yaw: b.yaw };
    if (!Number.isFinite(this.camYaw)) this.camYaw = b.yaw;
    if (!Number.isFinite(this.camPitch)) this.camPitch = 0.32;
    // send our position
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / SNAP_HZ && this.room) {
      this.sendAcc = 0;
      const f = (b.grounded ? 0 : 1) | (b.diveT > 0 ? 2 : 0) | (b.proneT > 0 ? 4 : 0) | (this.mine && this.mine.av.action ? 8 : 0);
      if (!this.falling && !this.dead) this.net.send('m', [Math.round(b.x * 1000) / 1000, Math.round(b.y * 1000) / 1000, Math.round(b.z * 1000) / 1000, Math.round(b.yaw * 1000) / 1000, f, this.seq]);
    }
    // players
    const rt = now - INTERP_DELAY;
    for (const p of this.players.values()) this.updatePlayer(p, dt, rt, now);
    // courts and balls
    const camPos = this.camera.position;
    const mc = this.myCourt();
    for (const [id, c] of Object.entries(this.courts)) {
      c.view.update(dt);
      const bm = c.b;
      let show = false, flying = false;
      if (bm && bm.state === 'held') {
        const h = this.players.get(bm.holder);
        if (h) { _b.x = h.x + Math.sin(h.yaw) * 0.35; _b.y = h.y + 2.35 + Math.sin(this.time * 4) * 0.06; _b.z = h.z + Math.cos(h.yaw) * 0.35; show = true; }
      } else if (bm && bm.state === 'fly' && bm.traj) {
        ballAt(bm.traj, now, _b); show = true; flying = true;
      }
      c.ball.place(_b, show, flying, camPos);
      c.view.showMarker(flying && bm.kind !== 'toss' ? bm.traj.land : null);
      // aim preview: the slab your next hit goes to
      let target = null;
      if (mc && mc.id === id && bm && (bm.state === 'held' ? bm.holder === this.net.id : bm.state === 'fly')) target = this.aimCell(c);
      c.view.showTarget(target);
    }
    // ui
    this.updateHud(now, mc);
    // camera
    this.updateCamera(dt);
    this.world.update(dt, this.camera.position);
    this.fx.update(dt);
    this.audio.listener = { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z };
    this.renderer.render(this.scene, this.camera);
    input.endFrame();
  }

  // the cell our aim picks (same rule as the server)
  aimCell(c) {
    const me = this.net.id;
    const myTeam = (c.members.find((m) => m.sid === me) || {}).team;
    const mine = (x) => Math.abs(this.me.x - x.x) <= x.w / 2 && Math.abs(this.me.z - x.z) <= x.d / 2; // the slab we stand on (shared in practice)
    const cells = (c.cells || []).filter((x) => x.sid && x.sid !== me && !x.dead && !mine(x) && c.members.some((m) => m.sid === x.sid && m.alive && !(c.duos && m.team === myTeam)));
    let best = null, bd = -Infinity;
    const ax = Math.sin(this.camYaw), az = Math.cos(this.camYaw);
    for (const cell of cells) {
      const dx = cell.x - this.me.x, dz = cell.z - this.me.z, l = Math.hypot(dx, dz) || 1;
      const d = (dx * ax + dz * az) / l;
      if (d > bd) { bd = d; best = cell; }
    }
    return best;
  }

  interp(p, t) {
    const s = p.snaps;
    if (!s.length) return null;
    if (t <= s[0].t) return s[0];
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i].t <= t) {
        const a = s[i], b = s[i + 1];
        if (!b) {
          return a; // newest: hold (no extrapolation keeps stops crisp)
        }
        const k = (t - a.t) / Math.max(1e-3, b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, yaw: lerpAngle(a.yaw, b.yaw, k), f: b.f };
      }
    }
    return s[s.length - 1];
  }

  updatePlayer(p, dt, rt, now) {
    const s = p.state;
    p.av.setTag(s.name, s.wins, s.title);
    if (!p.local) p.av.setAvString(s.av);
    const ox = p.x, oz = p.z;
    let flags = 0;
    if (p.falling) {
      const f = p.falling;
      f.t += dt; f.vy -= 24 * dt; f.y += f.vy * dt;
      p.x = f.x; p.y = f.y; p.z = f.z;
      p.av.root.rotation.x += f.spin * dt * 0.3;
      if (f.t > 1.6) { p.falling = null; p.av.root.rotation.x = 0; if (p.local) { this.falling = null; if (this.dead) this.openDeath(this.deathBy); } }
    } else if (p.local) {
      p.x = this.me.x; p.y = this.me.y; p.z = this.me.z; p.yaw = this.me.yaw;
      flags = (this.me.grounded ? 0 : 1) | (this.me.diveT > 0 ? 2 : 0) | (this.me.proneT > 0 ? 4 : 0);
    } else {
      const q = this.interp(p, rt);
      if (q) {
        // a long jump between snapshots is a teleport: snap rather than slide
        if (Math.hypot(q.x - p.x, q.z - p.z) > 12) { p.x = q.x; p.z = q.z; }
        p.x = q.x; p.y = q.y; p.z = q.z; p.yaw = q.yaw; flags = q.f;
        if ((flags & 8) && !(p.lastF & 8) && !p.av.action) p.av.act(flags & 1 ? 'spike' : 'bump');
        p.lastF = flags;
      }
    }
    let sp = dt > 0 ? Math.hypot(p.x - ox, p.z - oz) / dt : 0;
    if (!Number.isFinite(sp)) sp = 0;
    if (!Number.isFinite(p.speed)) p.speed = 0;
    p.speed += (Math.min(14, sp) - p.speed) * Math.min(1, dt * 10);
    p.av.root.position.set(p.x, p.y, p.z);
    p.av.root.rotation.y = p.yaw + Math.PI;
    // serving: holding the ball overhead
    let hold = false;
    for (const c of Object.values(this.courts)) if (c.b && c.b.state === 'held' && c.b.holder === p.sid) hold = true;
    p.av.animate({ speed: p.speed, grounded: !(flags & 1), dive: !!(flags & 2), prone: !!(flags & 4), hold, rag: !!p.falling, dt });
    // bounty skull
    const main = this.courts.main;
    p.av.setSkull(main.bounty === p.sid && main.members.some((m) => m.sid === p.sid && m.alive));
    // eliminated players have no slab left: hide them until they are back in the lobby
    const goneHere = !p.falling && main.members.some((m) => m.sid === p.sid && !m.alive) && Math.hypot(p.x - ARENA.cx, p.z - ARENA.cz) < 40;
    p.av.root.visible = !goneHere && !(p.local && this.dead && !p.falling);
    // the local player is hidden when the camera is inside them
    if (p.local && p.av.root.visible) p.av.root.visible = this.camDist > 2.2 && !this.spectate;
    // adrenaline glow
    if (flags & 16 && Math.random() < 0.4) this.fx.spark(new THREE.Vector3(p.x + (Math.random() - 0.5), p.y + Math.random() * 2, p.z + (Math.random() - 0.5)), new THREE.Vector3(0, 2, 0), '#ff4a6e', 0.9, 0.5);
  }

  updateCamera(dt) {
    let tx, ty, tz;
    const sp = this.spectate && this.players.get(this.spectate);
    if (sp) { tx = sp.x; ty = sp.y; tz = sp.z; }
    else { tx = this.me.x; ty = this.falling ? Math.max(this.me.y, -6) : this.me.y; tz = this.me.z; }
    this.camDist += (this.camZoom - this.camDist) * Math.min(1, dt * 10);
    const d = this.camDist;
    const cp = Math.cos(this.camPitch), spch = Math.sin(this.camPitch);
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const look = _v.set(tx, ty + 2.1, tz);
    let cy = look.y + spch * d;
    if (cy < -2.5) cy = -2.5;
    this.camera.position.set(look.x - fx * cp * d, cy, look.z - fz * cp * d);
    if (this.shake > 0) { this.shake -= dt; const k = this.shake * 0.35; this.camera.position.x += (Math.random() - 0.5) * k; this.camera.position.y += (Math.random() - 0.5) * k; }
    this.camera.lookAt(look);
    // shadows follow the action
    this.sun.position.set(tx + 40, 80, tz + 30); this.sun.target.position.set(tx, 0, tz);
  }

  updateHud(now, mc) {
    const ui = this.ui;
    const st = this.room && this.room.state;
    const main = this.courts.main;
    const inMain = mc && mc.id === 'main';
    const inPrac = mc && mc.id === 'prac';
    const inTut = mc && mc.id === 'tut';
    // status line
    let status = '', sub = '';
    if (inTut) { status = ''; }
    else if (mc) { status = mc.c.status; sub = mc.c.sub; }
    else if (main.members.length && main.status) { status = main.status; sub = main.sub; }
    ui.status(status, sub);
    // intermission vote
    if (st && st.phase === 'wait' && !inTut && this.profile && this.profile.tut) {
      const left = st.endsAt ? Math.max(0, Math.ceil(st.endsAt - now)) : -1;
      ui.vote({ show: true, solo: st.solo, duos: st.duos, left, afk: this.mine && this.mine.state.afk });
    } else ui.vote({ show: false });
    // hotbar
    const b = this.me;
    const abilDef = ABILITIES[this.abil.id] || ABILITIES.adrenaline;
    ui.hotbar({
      air: !b.grounded,
      dive: Math.max(0, Math.min(1, (this.diveReady - this.time) / DIVE.cooldown)),
      abil: { id: this.abil.id, name: abilDef.name, color: abilDef.color, cd: Math.max(0, Math.min(1, (this.abil.ready - now) / abilDef.cd)), active: this.abil.until > now, left: Math.max(0, Math.ceil(this.abil.ready - now)) },
      serving: !!(mc && mc.c.b && mc.c.b.state === 'held' && mc.c.b.holder === this.net.id),
    });
    ui.practice(!!inPrac);
    const spectating = !mc && main.members.length > 0 && this.mainAlive().length > 0;
    ui.spectateBar(spectating ? { name: this.spectate ? this.players.get(this.spectate)?.state.name : null } : null);
    const bounty = main.bounty && this.players.get(main.bounty);
    ui.bounty(main.members.length && bounty ? { name: bounty.state.name, me: main.bounty === this.net.id } : null);
    ui.prompt(this.nearbyPrompt());
    if (this.profile) ui.wheelTimer(Math.max(0, (this.profile.wheelIn || 0) - Math.floor((performance.now() - (this.profileAt || performance.now())) / 1000)));
    if (this.time - (this.adUiAt || 0) > 0.5) { this.adUiAt = this.time; ui.setAdButton(Bloxity.adsAvailable() && !this.adPending, AD_REWARD.coins); }
  }

  // Boxity death screen: our own centred card + Continue button that waits for Boxity's countdown
  openDeath(by) {
    if (this.death) return;
    const d = Bloxity.deathShow();
    this.death = d;
    this.ui.deathCard({ by, onContinue: () => {
      if (!this.death || !this.death.respawn()) return; // only once the countdown has run out
      this.closeDeath(false);
      this.net.send('continue');
    } });
    try { this.deathUnsub = d.onCountdown((n) => this.ui.deathCountdown(n)); } catch (e) { console.warn(e); this.ui.deathCountdown(0); }
    this.startSpectate();
  }
  closeDeath(hideSdk) {
    if (!this.death) return;
    if (hideSdk) Bloxity.deathHide();
    try { if (typeof this.deathUnsub === 'function') this.deathUnsub(); } catch { /* cosmetic */ }
    this.death = null; this.deathUnsub = null;
    this.ui.deathCard(null);
  }

  async watchAd() {
    if (this.adPending || !Bloxity.adsAvailable()) return;
    this.adPending = true;
    let r;
    this.ui.ads.pause(); // no screen-ad calls while a rewarded ad is pending
    try { r = await Bloxity.showRewarded(AD_REWARD.placement); } catch (e) { r = { status: 'error', error: String(e) }; }
    this.ui.ads.resume();
    if (r && r.status === 'completed' && r.rewardToken) { this.net.send('adReward', r.rewardToken); return; }
    this.adPending = false;
    console.info('[ads] rewarded result', r);
    const st = r && r.status;
    const msg = { skipped: 'Ad skipped - no reward this time', 'no-fill': 'No ad available right now, try again later', blocked: 'Ads are blocked in this browser', denied: 'Ad not allowed right now' + (r && r.reason ? ': ' + r.reason : ''), disabled: 'Ads are not available here', error: 'The ad could not be played' }[st];
    if (msg) this.ui.toast(msg, 'warn');
    else if (st === 'completed') this.ui.toast('The ad finished but no reward token came back', 'warn');
  }
}
