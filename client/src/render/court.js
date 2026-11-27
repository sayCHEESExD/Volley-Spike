// One court on screen: its slabs (grass or clay blocks with white lines between them), the
// landing marker, the red flash and the slab explosion, and the reshuffle glide.
import * as THREE from 'three';
import { TEX, grassTexture } from './textures.js';
import { SLAB } from '@shared/constants.js';
import { formation } from '@shared/world.js';

const LINE_W = 0.28;
const lineMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 });
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const R = (a, b) => a + Math.random() * (b - a);

export class CourtView {
  constructor(scene, fx, { id, surface = 'grass', cx, cz, idle = 0 }) {
    this.scene = scene; this.fx = fx; this.id = id; this.surface = surface; this.cx = cx; this.cz = cz;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.slabs = []; // { cell, g, mesh, mats, lines, flash, breakAt, dead }
    this.chunks = [];
    this.idle = idle;
    this.marker = new THREE.Mesh(new THREE.CircleGeometry(1.75, 40), new THREE.MeshBasicMaterial({ map: TEX.marker(), transparent: true, depthWrite: false }));
    this.marker.rotation.x = -Math.PI / 2; this.marker.visible = false; this.marker.renderOrder = 2;
    scene.add(this.marker);
    this.targetFrame = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 4, 1), new THREE.MeshBasicMaterial({ color: '#ffe14a', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    this.targetFrame.rotation.x = -Math.PI / 2; this.targetFrame.rotation.z = Math.PI / 4; this.targetFrame.visible = false;
    scene.add(this.targetFrame);
    if (idle) this.setCells(formation(idle, cx, cz).map((c) => ({ ...c, sid: '' })));
  }

  topTexture(w, d) {
    if (this.surface === 'clay') { const t = TEX.clay().clone(); t.needsUpdate = true; t.repeat.set(w / 6, d / 6); return t; }
    return grassTexture(w, d);
  }

  makeSlab(cell) {
    const g = new THREE.Group();
    g.position.set(cell.x, 0, cell.z);
    const side = TEX.dirt().clone(); side.needsUpdate = true;
    const top = this.topTexture(cell.w, cell.d);
    const mats = [
      new THREE.MeshStandardMaterial({ map: side, roughness: 1 }), new THREE.MeshStandardMaterial({ map: side, roughness: 1 }),
      new THREE.MeshStandardMaterial({ map: top, roughness: 0.95, emissive: '#ff0000', emissiveIntensity: 0 }), new THREE.MeshStandardMaterial({ color: '#4a2c1a' }),
      new THREE.MeshStandardMaterial({ map: side, roughness: 1 }), new THREE.MeshStandardMaterial({ map: side, roughness: 1 }),
    ];
    const mesh = new THREE.Mesh(unitBox, mats);
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
    const s = { cell: { ...cell }, g, mesh, mats, side, top, lines: new THREE.Group(), flash: -1, breakAt: 0, dead: false };
    g.add(s.lines);
    this.sizeSlab(s, cell.w, cell.d);
    this.group.add(g);
    return s;
  }

  sizeSlab(s, w, d) {
    const depth = SLAB.depth;
    s.mesh.scale.set(w, depth, d);
    s.mesh.position.y = -depth / 2;
    s.side.repeat.set(Math.max(w, d) / 8, depth / 8); s.side.offset.y = 1 - depth / 8;
    if (this.surface === 'clay') s.top.repeat.set(w / 6, d / 6); else s.top.repeat.set(w / 7, d / 7);
  }

  // white lines on the edges shared with a neighbour (never around the outside)
  drawLines(s) {
    s.lines.clear();
    const b = this.bounds;
    const c = s.cell, e = 0.05;
    const add = (x, z, w, d) => { const m = new THREE.Mesh(unitBox, lineMat); m.scale.set(w, 0.04, d); m.position.set(x, 0.02, z); m.receiveShadow = true; s.lines.add(m); };
    if (c.x - c.w / 2 > b.minX + e) add(-c.w / 2 + LINE_W / 4, 0, LINE_W / 2, c.d);
    if (c.x + c.w / 2 < b.maxX - e) add(c.w / 2 - LINE_W / 4, 0, LINE_W / 2, c.d);
    if (c.z - c.d / 2 > b.minZ + e) add(0, -c.d / 2 + LINE_W / 4, c.w, LINE_W / 2);
    if (c.z + c.d / 2 < b.maxZ - e) add(0, c.d / 2 - LINE_W / 4, c.w, LINE_W / 2);
    if (this.surface === 'clay') { // the practice court also has its outer lines
      if (Math.abs(c.x - c.w / 2 - b.minX) < e) add(-c.w / 2 + LINE_W / 2, 0, LINE_W, c.d);
      if (Math.abs(c.x + c.w / 2 - b.maxX) < e) add(c.w / 2 - LINE_W / 2, 0, LINE_W, c.d);
      if (Math.abs(c.z - c.d / 2 - b.minZ) < e) add(0, -c.d / 2 + LINE_W / 2, c.w, LINE_W);
      if (Math.abs(c.z + c.d / 2 - b.maxZ) < e) add(0, c.d / 2 - LINE_W / 2, c.w, LINE_W);
    }
  }

  computeBounds(cells) {
    const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const c of cells) { b.minX = Math.min(b.minX, c.x - c.w / 2); b.maxX = Math.max(b.maxX, c.x + c.w / 2); b.minZ = Math.min(b.minZ, c.z - c.d / 2); b.maxZ = Math.max(b.maxZ, c.z + c.d / 2); }
    this.bounds = b;
  }

  disposeSlab(s) { this.group.remove(s.g); for (const m of s.mats) m.dispose(); s.top.dispose(); s.side.dispose(); }

  // Rebuild from a cell list (setup / join). Dead cells are left out.
  setCells(cells) {
    for (const s of this.slabs) this.disposeSlab(s);
    this.slabs = [];
    this.tween = null;
    const live = cells.filter((c) => !c.dead);
    this.computeBounds(cells.length ? cells : live);
    this.slabs = cells.map((c) => (c.dead ? null : this.makeSlab(c)));
    for (const s of this.slabs) if (s) this.drawLines(s);
  }

  slabOf(sid) { return this.slabs.find((s) => s && s.cell.sid === sid) || null; }

  // The ball landed on cell i: flash red; in a real match it then blows up and falls away.
  land(i, boom, practice) {
    const s = this.slabs[i];
    if (!s) return;
    s.flash = 0;
    if (practice) { this.fx.explode('classic', new THREE.Vector3(s.cell.x, 0, s.cell.z), s.cell.w * 0.4, s.cell.d * 0.4); s.practice = true; return; }
    s.breakAt = SLAB.breakTime; s.boom = boom;
  }

  breakSlab(s) {
    const { x, z, w, d } = s.cell;
    this.fx.explode(s.boom || 'classic', new THREE.Vector3(x, 0, z), w, d);
    // the block splits into chunks that tumble into the sea
    const n = 3, cw = w / n, cd = d / n;
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(unitBox, [s.mats[0], s.mats[1], new THREE.MeshStandardMaterial({ color: '#ff3b2f', emissive: '#ff2200', emissiveIntensity: 0.6 }), s.mats[3], s.mats[4], s.mats[5]]);
      m.scale.set(cw * 0.96, SLAB.depth * R(0.5, 1), cd * 0.96);
      m.position.set(x - w / 2 + cw * (i + 0.5), -SLAB.depth / 2, z - d / 2 + cd * (k + 0.5));
      m.castShadow = true;
      this.scene.add(m);
      const ox = m.position.x - x, oz = m.position.z - z;
      this.chunks.push({ m, vx: ox * 0.9 + R(-1, 1), vy: R(4, 9), vz: oz * 0.9 + R(-1, 1), rx: R(-3, 3), rz: R(-3, 3), life: 3.2 });
    }
    s.dead = true;
    this.group.remove(s.g);
  }

  // Remaining slabs glide into the new formation. from: [{ sid, old }] (old cell index)
  shuffle(cells, time) {
    const next = [];
    const start = [];
    for (const c of cells) {
      let s = this.slabs.find((x) => x && !x.dead && x.cell.sid === c.sid);
      if (!s) s = this.makeSlab({ ...c, x: c.x, z: c.z });
      start.push({ s, x: s.cell.x, z: s.cell.z, w: s.cell.w, d: s.cell.d, to: c });
      next.push(s);
    }
    for (const s of this.slabs) if (s && !next.includes(s)) { if (!s.dead) this.breakSlab(s); }
    for (const s of next) s.lines.clear();
    this.slabs = next;
    this.tween = { t: 0, time, start, cells };
  }

  // landing marker + the slab the local player is aiming at
  showMarker(pos) {
    if (!pos) { this.marker.visible = false; return; }
    this.marker.visible = true;
    this.marker.position.set(pos[0], 0.06, pos[2]);
  }
  showTarget(cell) {
    if (!cell) { this.targetFrame.visible = false; return; }
    this.targetFrame.visible = true;
    this.targetFrame.position.set(cell.x, 0.07, cell.z);
    const r = Math.SQRT1_2;
    this.targetFrame.scale.set((cell.w / 2) / r * 0.98, (cell.d / 2) / r * 0.98, 1);
  }

  update(dt) {
    for (const s of this.slabs) {
      if (!s || s.dead) continue;
      if (s.flash >= 0) {
        s.flash += dt;
        const top = s.mats[2];
        if (s.practice) {
          top.emissiveIntensity = Math.max(0, 0.8 - s.flash * 1.2);
          if (s.flash > 0.8) { s.flash = -1; s.practice = false; top.emissiveIntensity = 0; }
        } else {
          top.emissiveIntensity = 0.55 + Math.sin(s.flash * 30) * 0.3;
          top.color.set('#ff6a5a');
        }
      }
      if (s.breakAt > 0) { s.breakAt -= dt; if (s.breakAt <= 0) this.breakSlab(s); }
    }
    if (this.tween) {
      const tw = this.tween;
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.time), e = k * k * (3 - 2 * k);
      for (const st of tw.start) {
        const c = st.to;
        const x = st.x + (c.x - st.x) * e, z = st.z + (c.z - st.z) * e, w = st.w + (c.w - st.w) * e, d = st.d + (c.d - st.d) * e;
        st.s.g.position.set(x, 0, z);
        this.sizeSlab(st.s, w, d);
      }
      if (k >= 1) {
        this.tween = null;
        this.computeBounds(tw.cells);
        for (const st of tw.start) { st.s.cell = { ...st.to }; this.drawLines(st.s); }
      }
    }
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.life -= dt;
      c.vy -= 22 * dt;
      c.m.position.x += c.vx * dt; c.m.position.y += c.vy * dt; c.m.position.z += c.vz * dt;
      c.m.rotation.x += c.rx * dt; c.m.rotation.z += c.rz * dt;
      if (c.life <= 0 || c.m.position.y < -30) { this.scene.remove(c.m); c.m.material[2].dispose(); this.chunks.splice(i, 1); }
    }
    if (this.marker.visible) this.marker.material.opacity = 0.8 + Math.sin(performance.now() / 120) * 0.2;
  }

  // the cell under a world point (for the local player's own clamp and the aim preview)
  cellAt(x, z) { return this.slabs.find((s) => s && !s.dead && Math.abs(x - s.cell.x) <= s.cell.w / 2 && Math.abs(z - s.cell.z) <= s.cell.d / 2) || null; }

  dispose() {
    for (const s of this.slabs) if (s) this.disposeSlab(s);
    for (const c of this.chunks) this.scene.remove(c.m);
    this.scene.remove(this.group, this.marker, this.targetFrame);
  }
}
