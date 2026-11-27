// Particle effects: one additive spark pool, one solid confetti/shard pool (instanced quads),
// sprite icons (hearts, stars) and expanding shock rings. Every explosion style in the
// catalogue is a recipe over these.
import * as THREE from 'three';
import { TEX, textTexture } from './textures.js';
import { BOOM_BY_ID } from '@shared/items.js';

const MAXP = 1400, MAXQ = 500;
const _c = new THREE.Color(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const R = (a, b) => a + Math.random() * (b - a);

export class FX {
  constructor(scene) {
    this.scene = scene;
    // additive glowing points
    const g = new THREE.BufferGeometry();
    this.pp = new Float32Array(MAXP * 3); this.pc = new Float32Array(MAXP * 3); this.ps = new Float32Array(MAXP);
    g.setAttribute('position', new THREE.BufferAttribute(this.pp, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.pc, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.ps, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: TEX.spark() }, scale: { value: 400 } },
      vertexShader: 'attribute float size; attribute vec3 color; varying vec3 vC; uniform float scale; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.a, t.a); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false;
    scene.add(this.points);
    this.parts = [];
    // solid quads (confetti, shards, droplets)
    this.quads = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true }), MAXQ);
    this.quads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXQ * 3), 3);
    this.quads.frustumCulled = false; this.quads.count = 0;
    scene.add(this.quads);
    this.qs = [];
    this.sprites = [];
    this.rings = [];
    this.iconTex = {};
  }

  spark(pos, vel, color, size, life, drag = 0.98, grav = -6) {
    if (this.parts.length >= MAXP) this.parts.shift();
    this.parts.push({ x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z, c: new THREE.Color(color), size, life, max: life, drag, grav });
  }
  quad(pos, vel, color, size, life, grav = -9) {
    if (this.qs.length >= MAXQ) this.qs.shift();
    this.qs.push({ x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z, c: new THREE.Color(color), size, life, max: life, grav, rx: R(0, 6), ry: R(0, 6), rz: R(0, 6), sx: R(-9, 9), sy: R(-9, 9) });
  }
  icon(kind, pos, vel, color, size, life) {
    const key = kind + color;
    if (!this.iconTex[key]) this.iconTex[key] = textTexture(kind === 'heart' ? '♥' : '★', { w: 128, h: 128, font: 'bold 110px sans-serif', fg: color, stroke: null });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.iconTex[key], transparent: true, depthWrite: false }));
    s.position.copy(pos); s.scale.setScalar(size);
    this.scene.add(s);
    this.sprites.push({ s, vel: vel.clone(), life, max: life, size });
  }
  ring(pos, color, radius, life = 0.6, y = 0.1) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2; m.position.set(pos.x, pos.y + y, pos.z);
    this.scene.add(m);
    this.rings.push({ m, life, max: life, radius });
  }

  // A slab being destroyed: the catalogue explosion `boomId`, centred at pos, slab size w x d.
  explode(boomId, pos, w = 12, d = 12) {
    const b = BOOM_BY_ID[boomId] || BOOM_BY_ID.classic;
    const c = b.c;
    const base = new THREE.Vector3(pos.x, pos.y + 0.6, pos.z);
    const rv = (h, up) => new THREE.Vector3(R(-h, h), R(up * 0.4, up), R(-h, h));
    const spread = () => new THREE.Vector3(pos.x + R(-w / 2, w / 2) * 0.8, pos.y + 0.3, pos.z + R(-d / 2, d / 2) * 0.8);
    this.ring(pos, c[0], Math.max(w, d) * 0.9, 0.7);
    switch (b.fx) {
      case 'confetti': for (let i = 0; i < 220; i++) this.quad(spread(), rv(7, 16), c[i % c.length], R(0.25, 0.45), R(2, 3.2), -7); for (let i = 0; i < 60; i++) this.spark(base, rv(10, 12), '#ffffff', 1.4, 0.6); break;
      case 'hearts': for (let i = 0; i < 26; i++) this.icon('heart', spread(), rv(3, 9), c[i % 2], R(1, 2.2), R(1.4, 2.2)); for (let i = 0; i < 120; i++) this.spark(spread(), rv(6, 10), c[i % 3], 2, 0.9); break;
      case 'stars': case 'gold': for (let i = 0; i < 26; i++) this.icon('star', spread(), rv(4, 11), c[i % 2], R(1, 2.4), R(1.2, 2)); for (let i = 0; i < 260; i++) this.spark(spread(), rv(8, 12), c[i % 3], b.fx === 'gold' ? 1.4 : 2.4, R(0.8, 1.6), 0.97, b.fx === 'gold' ? -3 : -6); break;
      case 'splash': for (let i = 0; i < 200; i++) this.quad(spread(), rv(5, 18), c[i % 3], R(0.2, 0.4), R(1, 1.6), -22); this.ring(pos, '#ffffff', w * 1.2, 0.9); break;
      case 'fireworks': for (let k = 0; k < 5; k++) { const o = new THREE.Vector3(pos.x + R(-w / 3, w / 3), pos.y + R(6, 12), pos.z + R(-d / 3, d / 3)); for (let i = 0; i < 70; i++) { const v = new THREE.Vector3(R(-1, 1), R(-1, 1), R(-1, 1)).normalize().multiplyScalar(R(5, 9)); this.spark(o, v, c[k % c.length], 2.2, R(1, 1.6), 0.96, -4); } } break;
      case 'electric': for (let i = 0; i < 300; i++) { const v = rv(14, 6); this.spark(spread(), v, c[i % 3], R(1.2, 2.6), R(0.25, 0.7), 0.9, 0); } this.ring(pos, c[0], w * 1.4, 0.4); break;
      case 'shards': for (let i = 0; i < 180; i++) this.quad(spread(), rv(9, 14), c[i % 3], R(0.3, 0.8), R(1.4, 2.2), -16); for (let i = 0; i < 80; i++) this.spark(base, rv(12, 12), '#ffffff', 2, 0.6); break;
      case 'toxic': for (let i = 0; i < 320; i++) this.spark(spread(), rv(3, 9), c[i % 3], R(2, 4.5), R(1.2, 2.4), 0.95, 1.5); break;
      case 'void': for (let i = 0; i < 360; i++) { const p = spread(); const v = new THREE.Vector3(pos.x - p.x, R(2, 6), pos.z - p.z).multiplyScalar(1.4); this.spark(p, v, c[i % 3], R(2, 4), R(0.8, 1.4), 0.93, 0); } this.ring(pos, c[2], w * 1.6, 1.1); break;
      case 'fire': default:
        for (let i = 0; i < 380; i++) this.spark(spread(), rv(5, 15), i % 4 === 3 ? c[1] : c[0], R(2.5, 5.5), R(0.7, 1.5), 0.94, -2);
        for (let i = 0; i < 70; i++) this.quad(spread(), rv(5, 12), c[2], R(0.3, 0.6), R(1.2, 2), -14);
    }
  }

  // small burst when the ball is touched
  hit(pos, color = '#ffffff', big = false) {
    for (let i = 0; i < (big ? 40 : 16); i++) this.spark(pos, new THREE.Vector3(R(-6, 6), R(-2, 7), R(-6, 6)), color, big ? 1.6 : 1.1, R(0.25, 0.5), 0.9, -6);
    if (big) this.ring({ x: pos.x, y: pos.y - 0.2, z: pos.z }, color, 3, 0.35, 0);
  }

  update(dt) {
    let n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.vy += p.grav * dt; p.vx *= p.drag; p.vy *= p.drag; p.vz *= p.drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    for (const p of this.parts) {
      const k = p.life / p.max;
      this.pp[n * 3] = p.x; this.pp[n * 3 + 1] = p.y; this.pp[n * 3 + 2] = p.z;
      this.pc[n * 3] = p.c.r * k; this.pc[n * 3 + 1] = p.c.g * k; this.pc[n * 3 + 2] = p.c.b * k;
      this.ps[n] = p.size * (0.4 + 0.6 * k);
      n++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;
    // quads
    let q = 0;
    for (let i = this.qs.length - 1; i >= 0; i--) { const p = this.qs[i]; p.life -= dt; if (p.life <= 0 || p.y < -3.5) this.qs.splice(i, 1); }
    for (const p of this.qs) {
      p.vy += p.grav * dt; p.vx *= 0.985; p.vz *= 0.985; if (p.grav > -10) { p.vy = Math.max(p.vy, -3.5); }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rx += p.sx * dt; p.ry += p.sy * dt;
      const k = Math.min(1, p.life / 0.4);
      _m.compose(_p.set(p.x, p.y, p.z), _q.setFromEuler(_e.set(p.rx, p.ry, p.rz)), _s.setScalar(p.size * k));
      this.quads.setMatrixAt(q, _m);
      this.quads.setColorAt(q, _c.copy(p.c));
      q++;
    }
    this.quads.count = q;
    if (q) { this.quads.instanceMatrix.needsUpdate = true; this.quads.instanceColor.needsUpdate = true; }
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const s = this.sprites[i];
      s.life -= dt;
      if (s.life <= 0) { this.scene.remove(s.s); s.s.material.dispose(); this.sprites.splice(i, 1); continue; }
      s.vel.y -= 4 * dt; s.s.position.addScaledVector(s.vel, dt);
      s.s.material.opacity = Math.min(1, s.life / 0.5);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) { this.scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); this.rings.splice(i, 1); continue; }
      const k = 1 - r.life / r.max;
      r.m.scale.setScalar(0.2 + k * r.radius);
      r.m.material.opacity = 0.9 * (1 - k);
    }
  }
}
