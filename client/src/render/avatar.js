// A player on screen: their Boxity avatar (boxity-rig.js) with a run cycle, jump pose and the
// volleyball moves (bump, spike, dive, serve hold), a tumbling ragdoll when their slab blows
// up, Boxity emotes, and a name tag with their wins and title.
import * as THREE from 'three';
import { textTexture } from './textures.js';
import { loadBaseRig, loadCharacter, RigBody, RIG_HEIGHT } from './boxity-rig.js';
import { Bloxity } from '../bloxity.js';

export const AVATAR_HEIGHT = 1.95;
const parseAv = (s) => { try { return s ? JSON.parse(s) : { eq: {}, pr: {} }; } catch { return { eq: {}, pr: {} }; } };
const AX = new THREE.Vector3(1, 0, 0), AZ = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const Rx = (a) => _q.setFromAxisAngle(AX, a);
const RxRz = (ax, az) => _q.setFromAxisAngle(AX, ax).multiply(_q2.setFromAxisAngle(AZ, az));

export class Avatar {
  constructor({ name, av, local = false }) {
    this.root = new THREE.Group();
    this.inner = new THREE.Group();
    this.root.add(this.inner);
    this.local = local;
    this.name = name;
    this.phase = 0; this.flail = 0;
    this.action = null; // { kind, t }
    this.look = typeof av === 'string' ? parseAv(av) : av || { eq: {}, pr: {} };
    this.avKey = typeof av === 'string' ? av : null;
    // stand-in body until the rig arrives
    this.blocky = new THREE.Group();
    const m = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
    const part = (w, h, d, c, x, y) => { const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(c)); p.position.set(x, y, 0); p.castShadow = true; this.blocky.add(p); };
    part(0.8, 0.75, 0.42, '#3a6fc4', 0, 1.18); part(0.46, 0.44, 0.44, '#f5c99b', 0, 1.78);
    part(0.36, 0.8, 0.4, '#2c3e50', -0.2, 0.4); part(0.36, 0.8, 0.4, '#2c3e50', 0.2, 0.4);
    part(0.28, 0.75, 0.34, '#f5c99b', -0.56, 1.18); part(0.28, 0.75, 0.34, '#f5c99b', 0.56, 1.18);
    this.inner.add(this.blocky);
    this.wins = -1; this.title = null;
    this.disposed = false;
    this.buildRig();
  }

  buildRig() {
    const want = (this.look && this.look.eq && this.look.eq.characterId) || null;
    this.rigChar = want;
    Promise.all([loadBaseRig(), loadCharacter(this.look && this.look.eq)]).then(([g, c]) => {
      if (this.disposed || this.rigChar !== want) return;
      const src = c ? c.gltf : g;
      if (!src) return;
      const rig = new RigBody(src, AVATAR_HEIGHT / RIG_HEIGHT, c ? c.character : null);
      rig.setLook(this.look, this.skinUrl);
      if (this.rig) this.rig.dispose();
      this.rig = rig;
      this.inner.add(rig.model);
      this.blocky.visible = false;
    });
  }

  setAvatar(look, skinUrl = null) {
    this.look = look; this.skinUrl = skinUrl;
    const ch = (look && look.eq && look.eq.characterId) || null;
    if (ch !== this.rigChar) this.buildRig();
    else if (this.rig) this.rig.setLook(look, skinUrl);
  }
  setAvString(av) { if (av !== this.avKey) { this.avKey = av; this.setAvatar(parseAv(av)); } }

  // tag: [title], "N Wins", name
  setTag(name, wins, title) {
    if (this.local && this.tag) return;
    if (name === this.name && wins === this.wins && title === this.title && this.tag) return;
    this.name = name; this.wins = wins; this.title = title;
    if (this.tag) { this.root.remove(this.tag); this.tag.material.map.dispose(); this.tag.material.dispose(); }
    const lines = [], sizes = [], colors = [];
    if (title) { lines.push(title); sizes.push('bold 34px Fredoka, sans-serif'); colors.push('#d9a6ff'); }
    lines.push(`${wins} Wins`); sizes.push('bold 34px Fredoka, sans-serif'); colors.push('#ffd23a');
    lines.push(name); sizes.push('bold 48px Fredoka, sans-serif'); colors.push('#ffffff');
    const h = 50 * lines.length + 20;
    const t = textTexture(lines, { w: 512, h, sizes, colors });
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
    this.tag.scale.set(2.8, (2.8 * h) / 512, 1);
    this.tag.position.y = 2.95 + this.tag.scale.y / 2 - 0.2;
    this.tag.renderOrder = 5;
    this.root.add(this.tag);
  }

  setSkull(on) {
    if (on && !this.skull) {
      this.skull = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture('💀', { w: 128, h: 128, font: '96px sans-serif', stroke: null }), transparent: true, depthWrite: false }));
      this.skull.scale.set(1.1, 1.1, 1); this.root.add(this.skull);
    }
    if (this.skull) { this.skull.visible = !!on; this.skull.position.y = (this.tag ? this.tag.position.y + this.tag.scale.y / 2 : 3) + 0.55; }
  }

  showChat(text) { if (Bloxity.available) Bloxity.attachBubble(THREE, this.root, text, { height: 3.4 }); }
  playEmote(clip) { if (this.rig) this.rig.startEmote(clip); }
  get emoting() { return !!(this.rig && this.rig.emote); }

  act(kind) { this.action = { kind, t: 0 }; if (this.rig && this.rig.emote) this.rig.startEmote(null); }

  // st: { speed, grounded, dive, prone, hold, rag, dt }
  animate(st) {
    // one bad number (NaN speed or dt) would stick in phase forever and break every limb bone
    const dt = Number.isFinite(st.dt) && st.dt > 0 ? st.dt : 0;
    if (!Number.isFinite(st.speed)) st.speed = 0;
    this.phase = Number.isFinite(this.phase) ? (this.phase + dt * (4 + st.speed * 1.4)) % (Math.PI * 200) : 0;
    if (!Number.isFinite(this.flail)) this.flail = 0;
    st.dt = dt;
    if (st.rag) this.flail += dt * 8;
    const a = this.action;
    if (a) { a.t += dt; if (a.t > (a.kind === 'spike' ? 0.45 : 0.38)) this.action = null; }
    // whole-body tilt: diving / lying flat
    const lay = st.dive ? 1 : st.prone ? 1 : 0;
    this.layK = (this.layK || 0) + (lay - (this.layK || 0)) * Math.min(1, dt * 16);
    this.inner.rotation.x = -1.35 * this.layK;
    this.inner.position.y = 0.35 * this.layK;
    if (!this.rig) {
      this.blocky.rotation.z = st.rag ? this.flail : 0;
      return;
    }
    if (st.speed > 1.2 && this.rig.emote) this.rig.startEmote(null); // moving cancels an emote
    this.rig.pose({ mode: st.rag ? 'rag' : 'walk', speed: st.speed, grounded: st.grounded || lay > 0.5, crouch: false, pitch: 0, holding: false, phase: this.phase, flail: this.flail, dt, ground: st.rag ? null : undefined, blend: 0 });
    if (st.rag) return;
    const r = this.rig;
    if (lay > 0.5) { r.charRot('ArmL1', RxRz(-2.9, 0.15)); r.charRot('ArmR1', RxRz(-2.9, -0.15)); r.charRot('LegL1', Rx(0.2)); r.charRot('LegR1', Rx(0.1)); }
    else if (a && a.kind === 'bump') {
      const k = Math.sin(Math.min(1, a.t / 0.38) * Math.PI);
      r.charRot('ArmL1', RxRz(-0.3 - 1.0 * k, 0.35 * k)); r.charRot('ArmR1', RxRz(-0.3 - 1.0 * k, -0.35 * k));
      r.charRot('LegL1', Rx(-0.5 * k)); r.charRot('LegR1', Rx(-0.5 * k)); r.charRot('LegL2', Rx(0.8 * k)); r.charRot('LegR2', Rx(0.8 * k));
    } else if (a && (a.kind === 'spike' || a.kind === 'toss')) {
      const k = Math.min(1, a.t / 0.45);
      const ang = a.kind === 'toss' ? -2.6 * Math.sin(k * Math.PI) : k < 0.35 ? -3.0 : -3.0 + (k - 0.35) / 0.65 * 2.6;
      r.charRot('ArmR1', RxRz(ang, -0.2));
      r.charRot('ArmL1', RxRz(a.kind === 'toss' ? -0.4 : -1.6, 0.3));
    } else if (st.hold) {
      r.charRot('ArmL1', RxRz(-2.7, 0.25)); r.charRot('ArmR1', RxRz(-0.6, -0.2));
    }
  }

  dispose() {
    this.disposed = true;
    if (this.rig) this.rig.dispose();
    this.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    if (this.tag) this.tag.material.map.dispose();
  }
}
