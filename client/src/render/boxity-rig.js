// The player's Boxity avatar on the standard Boxity rig (player.glb). Wears the equipped
// skin texture, body parts, hat / hair / mask, back item and accessories, applies
// proportions, and is posed procedurally (walk, hold, ragdoll) or by Boxity emote clips.
// All assets come from {staticUrl}/avatars and {apiUrl} of the told environment.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { env, Bloxity } from '../bloxity.js';

export const RIG_HEIGHT = 6.4; // player.glb units, feet at 0, facing +z
const isEq = (id) => id !== undefined && id !== null && id !== '' && id !== '-1' && id !== 'undefined';
const CDN = () => `${env().staticUrl}/avatars`;

// ---------------------------------------------------------------- asset caches
let basePromise = null;
export function loadBaseRig() {
  return (basePromise ||= new Promise((resolve) => {
    new GLTFLoader().load(`${CDN()}/player.glb`, (g) => resolve(g), undefined, (e) => { console.warn('[avatar] player.glb failed, using fallback body', e); resolve(null); });
  }));
}
const texCache = new Map();
function texture(url) {
  if (!texCache.has(url)) {
    texCache.set(url, new Promise((resolve) => new THREE.TextureLoader().load(url, (t) => {
      t.flipY = false; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; resolve(t);
    }, undefined, () => resolve(null))));
  }
  return texCache.get(url);
}
function plainTexture(url) {
  if (!texCache.has('p:' + url)) {
    texCache.set('p:' + url, new Promise((resolve) => new THREE.TextureLoader().load(url, (t) => {
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; resolve(t);
    }, undefined, () => resolve(null))));
  }
  return texCache.get('p:' + url);
}
const objCache = new Map();
function obj(url) {
  if (!objCache.has(url)) objCache.set(url, new Promise((resolve) => new OBJLoader().load(url, resolve, undefined, () => resolve(null))));
  return objCache.get(url);
}
const glbCache = new Map();
function glb(url) {
  if (!glbCache.has(url)) glbCache.set(url, new Promise((resolve) => new GLTFLoader().load(url, resolve, undefined, () => resolve(null))));
  return glbCache.get(url);
}

// Uploaded custom character (eq.characterId): its own GLB on the Boxity bone names, with its
// own materials, rig height and accessory frames (as Cut a Rock does). null = standard rig.
const charCache = new Map();
export function loadCharacter(eq) {
  const id = eq && eq.characterId;
  if (!isEq(id) || id === '0') return Promise.resolve(null);
  if (!charCache.has(id)) {
    charCache.set(id, (async () => {
      try {
        const ch = await Bloxity.characterFor(eq);
        if (!ch || !ch.glbUrl) return null;
        const g = await glb(ch.glbUrl);
        return g ? { character: ch, gltf: g } : null;
      } catch (e) { console.warn('[avatar] character failed', e); return null; }
    })());
  }
  return charCache.get(id);
}

// Skin texture with the worn face / shirt / pants drawn on (built for any player).
export function skinTextureUrl(eq) {
  const skin = isEq(eq.skinId) ? eq.skinId : '0';
  const pn = isEq(eq.pantsId) ? `_pn${eq.pantsId}` : '';
  const sh = isEq(eq.shirtId) ? `_sh${eq.shirtId}` : '';
  const fc = isEq(eq.faceId) ? `_fc${eq.faceId}` : '';
  if (!pn && !sh && !fc) return `${CDN()}/skins/${skin}.png`;
  return `${env().apiUrl}/v1/avatar/skin-texture/s${skin}${pn}${sh}${fc}.png`;
}

const PART_MESH = { head: 'default_head', arm_L: 'default_arm_L', arm_R: 'default_arm_R', leg_L: 'default_leg_L', leg_R: 'default_leg_R', torso: 'default_torso' };
const PART_SLOT = { head: ['headId', 'head', ''], arm_L: ['armLId', 'arms', '_L'], arm_R: ['armRId', 'arms', '_R'], leg_L: ['legLId', 'legs', '_L'], leg_R: ['legRId', 'legs', '_R'], torso: ['torsoId', 'torso', ''] };
// accessories: slot -> bone, origin (rig units); hand / shoes are mirrored pairs
const ACCESSORIES = {
  neckId: { dir: 'neck', bone: 'Spine2', origin: [0, 4.8, 0] },
  chestId: { dir: 'chest', bone: 'Spine2', origin: [0, 3.6, 0] },
  waistId: { dir: 'waist', bone: 'Spine1', origin: [0, 2.4, 0] },
  handId: { dir: 'hand', bone: 'ArmL2_leaf', mirror: 'ArmR2_leaf', origin: [0, 0, 0], pair: true },
  shoesId: { dir: 'shoes', bone: 'LegL2_leaf', mirror: 'LegR2_leaf', origin: [0, 0, 0], pair: true },
};
const smooth = (s) => s * s * (3 - 2 * s);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const AX = new THREE.Vector3(1, 0, 0), AZ = new THREE.Vector3(0, 0, 1);
const _rq1 = new THREE.Quaternion(), _rq2 = new THREE.Quaternion(), _rq3 = new THREE.Quaternion(), _rq4 = new THREE.Quaternion(), _rq5 = new THREE.Quaternion();
const _rv1 = new THREE.Vector3(), _rv2 = new THREE.Vector3(), _rv3 = new THREE.Vector3(), _rv4 = new THREE.Vector3();

export class RigBody {
  constructor(gltf, scale, character = null) {
    this.model = SkeletonUtils.clone(gltf.scene);
    this.character = character;
    this.characterId = character ? character.id ?? character.characterId ?? true : null;
    const rh = character && character.rig && character.rig.height;
    this.baseScale = character ? scale * RIG_HEIGHT / Math.max(1, rh || RIG_HEIGHT) : scale;
    this.props = {};
    this.eq = {};
    this.bones = {};
    this.rest = {};
    this.restModel = {}; // bone -> model-space rest matrix
    this.parentRestQ = {}; // bone -> model-space rest rotation of its parent
    this.partMeshes = {}; this.origGeos = {};
    this.items = {}; this.pairs = [];
    this.skeletons = [];
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    this.model.traverse((c) => {
      if (c.isSkinnedMesh) {
        if (!character) c.material = this.material;
        c.castShadow = true; c.frustumCulled = false;
        if (!this.skeletons.includes(c.skeleton)) this.skeletons.push(c.skeleton);
        for (const [slot, name] of Object.entries(PART_MESH)) if (c.name.toLowerCase() === name.toLowerCase()) { this.partMeshes[slot] = c; this.origGeos[slot] = c.geometry; }
      }
      else if (c.isMesh && character) { c.castShadow = true; c.frustumCulled = false; }
      if (c.isBone) this.bones[c.name] = c;
    });
    this.model.updateMatrixWorld(true);
    for (const [name, b] of Object.entries(this.bones)) {
      this.rest[name] = { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() };
      this.restModel[name] = b.matrixWorld.clone(); // model root is identity here
    }
    for (const [name, b] of Object.entries(this.bones)) {
      const pm = b.parent && b.parent.isBone ? this.restModel[b.parent.name] : new THREE.Matrix4();
      this.parentRestQ[name] = new THREE.Quaternion().setFromRotationMatrix(pm);
    }
    const sk = this.skeletons[0];
    const i = sk ? sk.bones.findIndex((b) => b.name === 'Neck_Offset') : -1;
    this.neckOffsetBindY = i >= 0 ? sk.boneInverses[i].clone().invert().elements[13] : 0;
    this.model.rotation.y = Math.PI; // rig faces +z; our characters face -z
    this.applyScale();
    this.emote = null;
  }

  applyScale() { const h = this.props.height ?? 1; this.model.scale.set(this.baseScale, this.baseScale * h, this.baseScale); }

  // Proportions move and scale the bones themselves (as Cut a Rock does), so skin and
  // accessories follow. (Editing skeleton.boneMatrices instead works in WORLD space and pulls
  // arms off the body once the character is scaled, turned or moved.)
  computeBase() {
    const p = this.props;
    const h = p.height ?? 1, al = p.armLength ?? 1, hs = p.headScale ?? 1, nh = p.neckHeight ?? 1;
    const sw = p.shoulderWidth ?? 1, ts = p.torsoScaleX ?? 1, lo = p.legOffsetX ?? 1;
    this.base = {};
    for (const [name, r] of Object.entries(this.rest)) {
      const bp = r.p.clone(), bs = r.s.clone();
      if (/^Arm[LR]1$/.test(name)) bs.y *= al; // upper arm only (children inherit it)
      if (name === 'ArmL_Offset' || name === 'ArmR_Offset') bp.x *= 1 + (sw - 1) * 0.8;
      if (name === 'LegL_Offset' || name === 'LegR_Offset') bp.x *= 1 + (lo - 1) * 0.6;
      if (name === 'Spine2') bs.x *= ts;
      if (name === 'Neck_Offset') bp.y += (h - hs) * r.p.y + this.neckOffsetBindY * (nh - 1) * 0.8;
      if (name === 'Neck1') bs.set(bs.x * hs, bs.y * (hs / h), bs.z * hs);
      this.base[name] = { p: bp, s: bs };
    }
  }

  // ---------------------------------------------------------------- look
  setLook(look, skinUrl = null) {
    const eq = look.eq || {};
    this.props = this.character ? {} : { ...(look.pr || {}) };
    this.applyScale();
    this.computeBase();
    const prev = this.eq;
    this.eq = { ...eq };
    const skinKey = this.character ? this.skinKey : skinUrl || skinTextureUrl(eq);
    if (skinKey !== this.skinKey) {
      this.skinKey = skinKey;
      const base = `${CDN()}/skins/${isEq(eq.skinId) ? eq.skinId : '0'}.png`;
      // if the clothed texture can't be had, fall back to the plain skin rather than white
      texture(skinKey).then((t) => t || (skinKey !== base ? texture(base) : null)).then((t) => { if (t && this.skinKey === skinKey) { this.material.map = t; this.material.needsUpdate = true; } });
    }
    if (!this.character) for (const [slot, [field, dir, suffix]] of Object.entries(PART_SLOT)) if (eq[field] !== prev[field]) this.swapPart(slot, eq[field], dir, suffix);
    for (const field of ['hatId', 'hairId', 'maskId']) if (eq[field] !== prev[field]) this.headItem(field, eq[field]);
    if (eq.backId !== prev.backId) this.backItem(eq.backId);
    for (const [field, def] of Object.entries(ACCESSORIES)) if (eq[field] !== prev[field]) this.accessory(field, def, eq[field]);
  }

  swapPart(slot, id, dir, suffix) {
    const target = this.partMeshes[slot];
    if (!target) return;
    if (!isEq(id)) { target.geometry = this.origGeos[slot]; return; }
    glb(`${CDN()}/parts/${dir}/${id}${suffix}.glb`).then((g) => {
      if (!g || this.eq[PART_SLOT[slot][0]] !== id) return;
      let sm = null, rm = null;
      g.scene.traverse((c) => { if (c.isSkinnedMesh && !sm) sm = c; else if (c.isMesh && !rm) rm = c; });
      if (!sm) { if (rm) target.geometry = rm.geometry; return; }
      const geo = sm.geometry.clone();
      const nameIdx = new Map(target.skeleton.bones.map((b, i) => [b.name, i]));
      const map = new Map(); sm.skeleton.bones.forEach((b, i) => { const ci = nameIdx.get(b.name); if (ci !== undefined) map.set(i, ci); });
      const si = geo.getAttribute('skinIndex');
      if (si) { for (let i = 0; i < si.array.length; i++) { const m = map.get(si.array[i]); if (m !== undefined) si.array[i] = m; } si.needsUpdate = true; }
      target.geometry = geo;
    });
  }

  async meshItem(meshUrl, texUrl) {
    const [o, t] = await Promise.all([obj(meshUrl), plainTexture(texUrl)]);
    if (!o) return null;
    const c = o.clone();
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 });
    c.traverse((x) => { if (x.isMesh) { x.material = m; x.castShadow = true; } });
    return c;
  }

  // Local matrix (in the bone's frame) for an accessory whose model-space origin is `origin`.
  accLocal(bone, origin, mirror = false) {
    const restP = this.restModel[bone].elements[13];
    if (this.character && !mirror) {
      const M = Bloxity.accessoryMatrix(this.character, bone);
      if (M) return new THREE.Matrix4().fromArray(M).multiply(new THREE.Matrix4().makeTranslation(0, origin[1] - restP, 0));
    }
    const local = this.restModel[bone].clone().invert();
    if (mirror) local.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
    return local.multiply(new THREE.Matrix4().makeTranslation(origin[0], origin[1], origin[2]));
  }
  attach(o, bone, origin) { o.matrixAutoUpdate = false; o.matrix.copy(this.accLocal(bone, origin)); this.bones[bone].add(o); }

  clearItem(key) { const it = this.items[key]; if (it) { for (const o of [].concat(it)) o.removeFromParent(); delete this.items[key]; } this.pairs = this.pairs.filter((p) => p.key !== key); }

  // hats, hair and masks: /items/hats on Neck1 at (0, 0.8, 0)
  headItem(field, id) {
    this.clearItem(field);
    if (!isEq(id)) return;
    this.meshItem(`${CDN()}/items/hats/${id}.obj`, `${CDN()}/textures/hats/${id}.png`).then((o) => {
      if (!o || this.eq[field] !== id || !this.bones.Neck1) return;
      this.clearItem(field);
      this.attach(o, 'Neck1', [0, 5.6, 0]); this.items[field] = o;
    });
  }

  backItem(id) {
    this.clearItem('backId');
    if (!isEq(id)) return;
    this.meshItem(`${CDN()}/items/back/${id}.obj`, `${CDN()}/textures/back/${id}.png`).then((o) => {
      if (!o || this.eq.backId !== id || !this.bones.Spine2) return;
      this.clearItem('backId');
      this.attach(o, 'Spine2', [0, 4.2, 0]); this.items.backId = o;
    });
  }

  accessory(field, def, id) {
    this.clearItem(field);
    if (!isEq(id)) return;
    this.meshItem(`${CDN()}/items/${def.dir}/${id}.obj`, `${CDN()}/textures/${def.dir}/${id}.png`).then((o) => {
      if (!o || this.eq[field] !== id || !this.bones[def.bone]) return;
      this.clearItem(field);
      if (!def.pair) { this.attach(o, def.bone, def.origin); this.items[field] = o; return; }
      // pair: follows position + rotation of each leaf bone (not its scale)
      const left = o, right = o.clone();
      for (const [mesh, bone, mirror, side] of [[left, def.bone, false, 1], [right, def.mirror, true, -1]]) {
        mesh.matrixAutoUpdate = false;
        const local = this.accLocal(bone, def.origin, mirror);
        this.model.add(mesh);
        this.pairs.push({ key: field, mesh, bone, local, side, kind: def.dir });
      }
      this.items[field] = [left, right];
    });
  }

  // ---------------------------------------------------------------- posing
  // Rotate a bone by R expressed in the character's (model) space, on top of its rest pose.
  charRot(name, R) {
    const b = this.bones[name]; if (!b) return;
    const pq = this.parentRestQ[name];
    _q2.copy(pq).invert().multiply(R).multiply(pq);
    b.quaternion.copy(_q2).multiply(this.rest[name].q);
  }

  startEmote(clip) { this.emote = clip ? { clip, t: 0, w: 0 } : null; }

  // st: { mode, speed, grounded, crouch, pitch, holding, phase, flail, dt }
  pose(st) {
    const p = this.props;
    if (!this.base) this.computeBase();
    for (const [name, b] of Object.entries(this.bones)) {
      const r = this.rest[name], bb = this.base[name];
      b.position.copy(bb.p); b.quaternion.copy(r.q); b.scale.copy(bb.s);
    }
    const Rx = (a) => _q.setFromAxisAngle(AX, a);
    const RxRz = (ax, az) => _q.setFromAxisAngle(AX, ax).multiply(_q2.setFromAxisAngle(AZ, az));
    if (st.mode === 'rag') {
      this.ragPose(st);
      this.saveRagPose();
    } else {
      if (this.rag) for (const L of this.rag) L.init = false;
      const sp = Math.min(1, st.speed / 9);
      const swing = st.grounded ? Math.sin(st.phase) * 0.8 * sp : 0;
      const crouch = st.crouch ? 0.7 : 0;
      this.charRot('LegL1', Rx(st.grounded ? -swing - crouch : -0.5));
      this.charRot('LegR1', Rx(st.grounded ? swing - crouch : 0.3));
      if (crouch) { this.charRot('LegL2', Rx(crouch * 1.6)); this.charRot('LegR2', Rx(crouch * 1.6)); }
      this.charRot('ArmL1', st.grounded ? Rx(swing * 0.8) : RxRz(-2.6, 0.3));
      if (st.holding) this.charRot('ArmR1', Rx(-(Math.PI / 2 + (st.pitch || 0))));
      else this.charRot('ArmR1', st.grounded ? Rx(-swing * 0.8) : RxRz(-2.6, -0.3));
      this.charRot('Neck1', Rx(-(st.pitch || 0) * 0.5));
    }
    // just stood up: fade from the last ragdoll pose into this one
    if (st.mode !== 'rag' && st.blend > 0 && this.ragSaved) for (const [name, q] of this.ragSaved) { const b = this.bones[name]; if (b) b.quaternion.slerp(q, st.blend); }
    // Boxity emote clip: degree deltas over the bind pose (euler XYZ, right-multiplied),
    // smoothstep between keys, clamped, looping on t % len; blended in over 0.1 s.
    const em = this.emote;
    if (em) {
      if (st.mode !== 'walk') this.emote = null;
      else {
        em.t += st.dt; em.w = Math.min(1, em.w + st.dt / 0.1);
        const c = em.clip, len = c.len || 1;
        if (!c.loop && em.t > len) this.emote = null;
        else {
          const t = c.loop ? em.t % len : Math.min(em.t, len);
          for (const [bone, keys] of Object.entries(c.tracks || {})) {
            const b = this.bones[bone];
            if (!b || !Array.isArray(keys) || !keys.length) continue;
            let k0 = keys[0], k1 = keys[keys.length - 1];
            if (t <= k0[0]) k1 = k0; else if (t >= k1[0]) k0 = k1;
            else for (let i = 0; i < keys.length - 1; i++) if (t >= keys[i][0] && t <= keys[i + 1][0]) { k0 = keys[i]; k1 = keys[i + 1]; break; }
            const s = k1[0] > k0[0] ? smooth((t - k0[0]) / (k1[0] - k0[0])) : 0;
            const d = (i) => { const v = (Number(k0[i]) + (Number(k1[i]) - Number(k0[i])) * s) * Math.PI / 180; return Number.isFinite(v) ? v : 0; };
            _q.copy(this.rest[bone].q).multiply(_q2.setFromEuler(_e.set(d(1), d(2), d(3), 'XYZ')));
            b.quaternion.slerp(_q, em.w);
          }
        }
      }
    }
    // safety net: a bone that picked up a NaN goes back to its rest pose instead of vanishing
    for (const [name, b] of Object.entries(this.bones)) { const q = b.quaternion; if (!(Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w))) q.copy(this.rest[name].q); }
    // accessories that follow bones without inheriting their scale
    this.model.updateMatrixWorld(true);
    _m.copy(this.model.matrixWorld).invert();
    for (const pr of this.pairs) {
      const b = this.bones[pr.bone];
      _m2.multiplyMatrices(_m, b.matrixWorld).decompose(_p, _q, _s);
      pr.mesh.matrix.compose(_p, _q, _s.set(1, 1, 1)).multiply(pr.local);
      pr.mesh.matrixWorldNeedsUpdate = true;
    }

  }

  // ---------------------------------------------------------------- ragdoll limbs
  // Each limb is a verlet chain in WORLD space hanging from its joint on the tumbling body:
  // gravity, the body's own motion (linear and spin) and the floor act on it, and the bone
  // rotations are solved back from the chain. Limbs trail, flop and splay like a real ragdoll
  // without any extra network traffic.
  buildRag() {
    const pos = (n) => (this.restModel[n] ? new THREE.Vector3().setFromMatrixPosition(this.restModel[n]) : null);
    const chain = (bones, leaf, stiff, relax) => {
      const pts = bones.map(pos).concat([pos(leaf)]);
      if (pts.some((p) => !p)) return null;
      const segs = [];
      for (let i = 0; i < bones.length; i++) segs.push({ bone: bones[i], restDir: pts[i + 1].clone().sub(pts[i]).normalize(), len: pts[i + 1].distanceTo(pts[i]) });
      return { joint: pts[0], segs, stiff, relax, p: segs.map(() => new THREE.Vector3()), prev: segs.map(() => new THREE.Vector3()), init: false };
    };
    const has = (n) => !!this.bones[n];
    const limbs = [];
    for (const side of ['L', 'R']) {
      const arm = has(`Arm${side}2`) ? chain([`Arm${side}1`, `Arm${side}2`], `Arm${side}2_leaf`, 0.9, side === 'L' ? 1 : -1) : chain([`Arm${side}1`], `Arm${side}2_leaf`, 0.9, side === 'L' ? 1 : -1);
      const leg = has(`Leg${side}2`) ? chain([`Leg${side}1`, `Leg${side}2`], `Leg${side}2_leaf`, 1.6, 0) : chain([`Leg${side}1`], `Leg${side}2_leaf`, 1.6, 0);
      if (arm) limbs.push(arm); if (leg) limbs.push(leg);
    }
    if (this.restModel.Neck1) {
      const j = pos('Neck1');
      limbs.push({ joint: j, segs: [{ bone: 'Neck1', restDir: new THREE.Vector3(0, 1, 0), len: 1.0 }], stiff: 14, relax: 0, p: [new THREE.Vector3()], prev: [new THREE.Vector3()], init: false, head: true });
    }
    return limbs;
  }

  saveRagPose() {
    this.ragSaved ||= new Map();
    for (const L of this.rag || []) for (const sg of L.segs) { const b = this.bones[sg.bone]; if (b) (this.ragSaved.get(sg.bone) || this.ragSaved.set(sg.bone, new THREE.Quaternion()).get(sg.bone)).copy(b.quaternion); }
  }

  ragPose(st) {
    const limbs = (this.rag ||= this.buildRag());
    this.model.updateWorldMatrix(true, false);
    const mw = this.model.matrixWorld;
    const mq = this.model.getWorldQuaternion(_rq1);
    const imq = _rq2.copy(mq).invert();
    const sc = this.model.scale.x;
    const frame = Math.min(0.1, Math.max(0.001, st.dt));
    const steps = Math.max(1, Math.min(6, Math.ceil(frame / (1 / 120)))); // fixed small steps: smooth at any frame rate
    const dt = frame / steps;
    const grav = -24 * dt * dt;
    const ground = st.ground;
    for (const L of limbs) {
      const joint = _rv1.copy(L.joint).applyMatrix4(mw);
      // the body jumped (respawn, late snapshot): start the limbs fresh instead of stretching them across the gap
      if (L.init && L.lastJoint && L.lastJoint.distanceToSquared(joint) > 2.5 * 2.5) L.init = false;
      (L.lastJoint ||= new THREE.Vector3()).copy(joint);
      if (!L.init) {
        let at = _rv2.copy(joint);
        L.segs.forEach((sg, i) => { at.addScaledVector(_rv3.copy(sg.restDir).applyQuaternion(mq), sg.len * sc); L.p[i].copy(at); L.prev[i].copy(at); });
        L.init = true;
      }
      // integrate the chain in small steps (positions only), then solve the bones once
      for (let s = 0; s < steps; s++) {
        let b0 = _rv2.copy(joint);
        L.segs.forEach((sg, i) => {
          const p = L.p[i], prev = L.prev[i], len = sg.len * sc;
          const vx = (p.x - prev.x) * 0.985, vy = (p.y - prev.y) * 0.985, vz = (p.z - prev.z) * 0.985;
          prev.copy(p);
          p.x += vx; p.y += vy + (L.head ? 0 : grav); p.z += vz;
          const relax = _rv3.copy(sg.restDir);
          if (L.relax && i === 0) relax.x += 0.55 * L.relax;
          relax.normalize().applyQuaternion(mq).multiplyScalar(len).add(b0);
          p.lerp(relax, Math.min(1, L.stiff * dt));
          const d = _rv4.subVectors(p, b0); const l = d.length() || 1;
          p.copy(b0).addScaledVector(d, len / l);
          if (ground !== undefined && ground !== null && p.y < ground + 0.06) { p.y = ground + 0.06; prev.y = p.y; prev.x += (p.x - prev.x) * 0.25; prev.z += (p.z - prev.z) * 0.25; }
          b0 = _rv2.copy(p);
        });
      }
      let base = _rv2.copy(joint);
      const accum = _rq3.identity();
      L.segs.forEach((sg, i) => {
        const p = L.p[i], prev = L.prev[i], len = sg.len * sc;
        // a weak pull towards a relaxed pose (arms slightly out); the head is held up firmly
        const relax = _rv3.copy(sg.restDir);
        if (L.relax && i === 0) relax.x += 0.55 * L.relax;
        relax.normalize().applyQuaternion(mq).multiplyScalar(len).add(base);
        p.lerp(relax, Math.min(1, L.stiff * dt));
        // keep the segment length
        const d = _rv4.subVectors(p, base); const l = d.length() || 1;
        p.copy(base).addScaledVector(d, len / l);
        // floor contact with a bit of friction
        if (ground !== undefined && ground !== null && p.y < ground + 0.06) { p.y = ground + 0.06; prev.y = p.y; prev.x += (p.x - prev.x) * 0.4; prev.z += (p.z - prev.z) * 0.4; }
        // solve the bone rotation (model space), relative to what the parent segment already turned
        const dirM = _rv4.subVectors(p, base).normalize().applyQuaternion(imq);
        const want = _rq4.setFromUnitVectors(sg.restDir, dirM);
        const local = _rq5.copy(accum).invert().multiply(want);
        this.charRot(sg.bone, local);
        accum.copy(want);
        base = _rv2.copy(p);
      });
    }
  }

  handWorld(out) { const b = this.bones.ArmR2_leaf; return b ? b.getWorldPosition(out) : null; }

  dispose() { this.model.removeFromParent(); }
}
