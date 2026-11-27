// The static world: sky, sea, the hub island (pack stands, prize wheel, leaderboard boards),
// the plank bridge and the practice island's base. Courts (slabs) are drawn by court.js.
import * as THREE from 'three';
import { TEX, grassTexture, textTexture } from './textures.js';
import { LOBBY, PRACTICE_RECT, PRACTICE_PAD, PACK_STANDS, WHEEL, BOARDS } from '@shared/world.js';
import { PACKS, WHEEL_PRIZES } from '@shared/items.js';
import { drawPackArt } from './packart.js';

export class World {
  constructor(scene) {
    this.scene = scene;
    this.t = 0;
    this.buildSky();
    this.buildSea();
    this.island(LOBBY, { depth: 7 });
    this.buildPracticePad();
    this.island(PRACTICE_RECT, { depth: 6, top: 'clay', topY: -0.03 });
    // a few small floating grass rocks out at sea, as in any island hub
    for (const [x, z, s, y] of [[-62, -28, 5, -1.2], [48, -48, 4, -0.6], [-50, 46, 6, -1.6], [86, 34, 4, -1], [34, 58, 3.5, -0.8]]) this.island({ minX: x - s, maxX: x + s, minZ: z - s * 0.8, maxZ: z + s * 0.8 }, { depth: 4 + s * 0.4, topY: y });
    this.stands = PACK_STANDS.map((s) => this.packStand(s));
    this.buildWheel();
    this.boards = BOARDS.map((b) => this.board(b));
    this.buildSpawn();
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color('#3f9cf0') }, mid: { value: new THREE.Color('#9fd8ff') }, bot: { value: new THREE.Color('#d9f4ff') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h*1.6,0.0,1.0),0.8)) : bot; if (h > 0.0 && h < 0.08) c = mix(bot, mid, h/0.08); gl_FragColor = vec4(c,1.0); }',
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.scene.add(this.sky);
    const cloudMat = new THREE.SpriteMaterial({ map: TEX.cloud(), transparent: true, depthWrite: false, fog: false, opacity: 0.95 });
    this.clouds = [];
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Sprite(cloudMat);
      const a = Math.random() * Math.PI * 2, r = 260 + Math.random() * 380;
      s.position.set(Math.cos(a) * r, 70 + Math.random() * 110, Math.sin(a) * r);
      const k = 70 + Math.random() * 110; s.scale.set(k, k * 0.55, 1);
      this.scene.add(s); this.clouds.push(s);
    }
  }

  buildSea() {
    const t = TEX.sea();
    t.repeat.set(160, 160);
    this.seaTex = t;
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshStandardMaterial({ color: '#7fdcee', map: t, roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.94 }));
    sea.rotation.x = -Math.PI / 2; sea.position.y = -3.2; sea.receiveShadow = true;
    this.scene.add(sea);
    this.sea = sea;
  }

  // A floating block: textured top at topY, dirt sides with a grass lip, a dark underside.
  island(r, { depth = 6, top = 'grass', topY = 0 } = {}) {
    const w = r.maxX - r.minX, d = r.maxZ - r.minZ;
    const side = TEX.dirt().clone(); side.needsUpdate = true; side.repeat.set(w / 8, depth / 8); side.offset.y = 1 - depth / 8;
    const side2 = TEX.dirt().clone(); side2.needsUpdate = true; side2.repeat.set(d / 8, depth / 8); side2.offset.y = 1 - depth / 8;
    const topTex = top === 'clay' ? (() => { const t = TEX.clay().clone(); t.needsUpdate = true; t.repeat.set(w / 6, d / 6); return t; })() : grassTexture(w, d);
    const mats = [
      new THREE.MeshStandardMaterial({ map: side2, roughness: 1 }), new THREE.MeshStandardMaterial({ map: side2, roughness: 1 }),
      new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.95 }), new THREE.MeshStandardMaterial({ color: '#4a2c1a', roughness: 1 }),
      new THREE.MeshStandardMaterial({ map: side, roughness: 1 }), new THREE.MeshStandardMaterial({ map: side, roughness: 1 }),
    ];
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, depth, d), mats);
    m.position.set((r.minX + r.maxX) / 2, topY - depth / 2, (r.minZ + r.maxZ) / 2);
    m.receiveShadow = true; m.castShadow = true;
    this.scene.add(m);
    return m;
  }

  // The yellow Practice pad on the lobby's right edge: stepping on it teleports you to the practice court.
  buildPracticePad() {
    const r = PRACTICE_PAD, w = r.maxX - r.minX, d = r.maxZ - r.minZ;
    const c = document.createElement('canvas'); c.width = 256; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#f6e08a'; x.fillRect(0, 0, 256, 512);
    x.strokeStyle = '#e2c55a'; x.lineWidth = 10; x.strokeRect(5, 5, 246, 502);
    x.save(); x.translate(128, 256); x.rotate(Math.PI / 2);
    x.font = 'bold 84px Fredoka, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 10; x.strokeStyle = '#3a2a10'; x.strokeText('Practice', 0, 0); x.fillStyle = '#fff'; x.fillText('Practice', 0, 0);
    x.restore();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), [null, null, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), null, null, null].map((m) => m || new THREE.MeshStandardMaterial({ color: '#e2c55a' })));
    pad.position.set((r.minX + r.maxX) / 2, 0.02, (r.minZ + r.maxZ) / 2); pad.receiveShadow = true;
    this.scene.add(pad);
    this.padGlow = new THREE.Mesh(new THREE.BoxGeometry(w, 2.2, d), new THREE.MeshBasicMaterial({ color: '#fff3a0', transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.padGlow.position.set(pad.position.x, 1.2, pad.position.z);
    this.scene.add(this.padGlow);
  }

  buildSpawn() {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.18, 40), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }));
    pad.position.set(0, 0.06, 9); pad.receiveShadow = true;
    this.scene.add(pad);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.2, 40), new THREE.MeshStandardMaterial({ color: '#ff8a1f', roughness: 0.5 }));
    inner.position.set(0, 0.08, 9); this.scene.add(inner);
  }

  packStand(s) {
    const pack = PACKS[s.id];
    const g = new THREE.Group();
    g.position.set(s.x, 0, s.z);
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 3.2), new THREE.MeshStandardMaterial({ map: TEX.wood(), roughness: 0.9 }));
    base.position.y = 0.35; base.castShadow = true; base.receiveShadow = true; g.add(base);
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 0.1, 24), new THREE.MeshBasicMaterial({ color: pack.c[1] }));
    glow.position.y = 0.72; g.add(glow);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 5, 24, 1, true), new THREE.MeshBasicMaterial({ color: pack.c[1], transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    beam.position.y = 3.2; g.add(beam);
    const c = document.createElement('canvas'); c.width = 512; c.height = 720;
    drawPackArt(c.getContext('2d'), pack, 512, 720);
    { const x = c.getContext('2d'); x.globalCompositeOperation = 'destination-over'; const gr = x.createLinearGradient(0, 0, 512, 720); gr.addColorStop(0, pack.c[0]); gr.addColorStop(1, pack.c[1]); x.fillStyle = gr; x.fillRect(0, 0, 512, 720); x.globalCompositeOperation = 'source-over'; } // foil fills the whole face
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const card = foilPack(tex, pack.c[1], 3.3, 4.6);
    card.position.y = 3.9; g.add(card);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture([pack.name, `${pack.price} coins`], { w: 512, h: 160, sizes: ['bold 58px Fredoka, sans-serif', 'bold 44px Fredoka, sans-serif'], colors: ['#ffffff', '#ffd23a'] }), transparent: true, depthWrite: false }));
    label.scale.set(6.4, 2.0, 1); label.position.y = 7.4; g.add(label);
    this.scene.add(g);
    return { g, card, id: s.id, x: s.x, z: s.z };
  }

  buildWheel() {
    const g = new THREE.Group();
    g.position.set(WHEEL.x, 0, WHEEL.z);
    g.rotation.y = Math.atan2(-WHEEL.x, 9 - WHEEL.z); // faces the spawn pad
    const legs = new THREE.MeshStandardMaterial({ color: '#2b3a55', roughness: 0.6 });
    for (const x of [-1.8, 1.8]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4.6, 0.6), legs); l.position.set(x, 2.3, 0); l.castShadow = true; g.add(l); }
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const x = c.getContext('2d'), n = WHEEL_PRIZES.length;
    WHEEL_PRIZES.forEach((p, i) => {
      x.fillStyle = i % 2 ? p.c : shade(p.c); x.beginPath(); x.moveTo(256, 256); x.arc(256, 256, 250, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2); x.fill();
      x.save(); x.translate(256, 256); x.rotate(((i + 0.5) / n) * Math.PI * 2); x.fillStyle = '#fff'; x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 6; x.font = 'bold 30px Fredoka, sans-serif'; x.textAlign = 'right'; x.strokeText(p.label, 232, 10); x.fillText(p.label, 232, 10); x.restore();
    });
    x.lineWidth = 12; x.strokeStyle = '#fff'; x.beginPath(); x.arc(256, 256, 248, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#fff'; x.beginPath(); x.arc(256, 256, 36, 0, Math.PI * 2); x.fill();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.wheelDisc = new THREE.Mesh(new THREE.CircleGeometry(1.75, 48), new THREE.MeshBasicMaterial({ map: tex }));
    this.wheelDisc.position.set(0, 3.2, 0.32); g.add(this.wheelDisc);
    const back = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.3, 48), new THREE.MeshStandardMaterial({ color: '#ffd23a', metalness: 0.4, roughness: 0.4 }));
    back.rotation.x = Math.PI / 2; back.position.set(0, 3.2, 0.12); g.add(back);
    const ptr = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 3), new THREE.MeshStandardMaterial({ color: '#ff3a3a' }));
    ptr.position.set(0, 5.2, 0.4); ptr.rotation.z = Math.PI; g.add(ptr);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture('Free Spin!', { w: 512, h: 110, font: 'bold 70px Fredoka, sans-serif', fg: '#7dff9a', stroke: 'rgba(10,60,30,0.85)' }), transparent: true, depthWrite: false }));
    label.scale.set(4.4, 0.82, 1); label.position.set(0, 6.0, 0); g.add(label);
    this.scene.add(g);
    this.wheelGroup = g;
  }

  board(b) {
    const g = new THREE.Group();
    g.position.set(b.x, 0, b.z); g.rotation.y = Math.atan2(-b.x, 9 - b.z) * 0.6; // fanned towards the spawn
    const mat = new THREE.MeshStandardMaterial({ color: '#6d6f73', roughness: 0.85 });
    const trim = new THREE.MeshStandardMaterial({ color: '#4b4d51', roughness: 0.85 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(8.6, 10.8, 0.5), mat); frame.position.y = 6.4; frame.castShadow = true; g.add(frame);
    for (const [w, h, x, y] of [[8.9, 0.35, 0, 11.8], [8.9, 0.35, 0, 1.0], [0.35, 11.1, -4.3, 6.4], [0.35, 11.1, 4.3, 6.4]]) { const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.62), trim); t.position.set(x, y, 0); t.castShadow = true; g.add(t); }
    for (const x of [-3.2, 3.2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.5), new THREE.MeshStandardMaterial({ color: '#d9d9d9' })); p.position.set(x, 0.5, 0); g.add(p); }
    const c = document.createElement('canvas'); c.width = 512; c.height = 640;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(7.8, 9.75), new THREE.MeshBasicMaterial({ map: tex }));
    face.position.set(0, 6.4, 0.26); g.add(face);
    this.scene.add(g);
    const entry = { canvas: c, tex, title: b.title, id: b.id, col: b.col, weekly: b.id === 'wins' || b.id === 'elims' };
    this.drawBoard(entry, []);
    return entry;
  }

  // Light panel in a grey frame: outlined title, All Time / Weekly pills, Rank / Username / value
  // columns, gold #1, silver #2, orange #3, values in yellow.
  drawBoard(e, rows, weekly = false) {
    const x = e.canvas.getContext('2d'), W = 512, H = 640;
    x.fillStyle = '#55585e'; x.fillRect(0, 0, W, H);
    const panel = x.createLinearGradient(0, 0, 0, H); panel.addColorStop(0, '#f1f2f4'); panel.addColorStop(1, '#d9dce1');
    x.fillStyle = panel; x.beginPath(); x.roundRect(14, 12, W - 28, H - 24, 14); x.fill();
    x.fillStyle = '#5d6b86'; x.beginPath(); x.roundRect(22, 20, W - 44, 76, 10); x.fill();
    x.textAlign = 'center'; x.lineJoin = 'round';
    x.font = 'bold 46px Fredoka, sans-serif'; x.lineWidth = 9; x.strokeStyle = '#1c2333'; x.strokeText(e.title, W / 2, 72); x.fillStyle = '#ffffff'; x.fillText(e.title, W / 2, 72);
    // tab pills
    const pill = (label, cx, on) => {
      x.fillStyle = on ? '#2f8cff' : '#3d4a66'; x.beginPath(); x.roundRect(cx - 66, 104, 132, 30, 15); x.fill();
      x.strokeStyle = on ? '#bfe0ff' : '#26304a'; x.lineWidth = 3; x.stroke();
      x.font = 'bold 20px Fredoka, sans-serif'; x.fillStyle = on ? '#fff' : '#b9c4da'; x.fillText(label, cx, 126);
    };
    pill('All Time', W / 2 - 72, !weekly); pill('Weekly', W / 2 + 72, weekly);
    // headers
    x.font = 'bold 26px Fredoka, sans-serif'; x.fillStyle = '#2a3142';
    x.textAlign = 'left'; x.fillText('Rank', 30, 170); x.textAlign = 'center'; x.fillText('Username', W / 2 - 10, 170); x.textAlign = 'right'; x.fillText(e.col || '', W - 30, 170);
    x.fillStyle = '#9aa1ad'; x.fillRect(26, 180, W - 52, 3);
    const fmt = (v) => e.id === 'playSecs' ? `${Math.floor(v / 3600)}h ${Math.floor((v % 3600) / 60)}m` : v >= 1e4 ? `${(v / 1000).toFixed(v >= 1e5 ? 0 : 1)}K` : String(v);
    if (!rows.length) { x.textAlign = 'center'; x.fillStyle = '#6a7180'; x.font = 'bold 26px Fredoka, sans-serif'; x.fillText(weekly ? 'No scores this week yet!' : 'Play to get on the board!', W / 2, 360); }
    const rankCol = ['#e8b100', '#7d8796', '#e0701c'];
    rows.slice(0, 10).forEach((r, i) => {
      const y = 222 + i * 42;
      const top = i < 3;
      x.font = `bold ${top ? 32 : 27}px Fredoka, sans-serif`;
      const stroke = (t, px, col) => { x.lineWidth = 5; x.strokeStyle = 'rgba(20,24,34,0.85)'; x.strokeText(t, px, y); x.fillStyle = col; x.fillText(t, px, y); };
      x.textAlign = 'left'; stroke(`#${i + 1}`, 30, top ? rankCol[i] : '#ffffff');
      let name = String(r.name); while (x.measureText(name).width > 240 && name.length > 3) name = name.slice(0, -1);
      x.textAlign = 'center'; stroke(name, W / 2 - 10, top ? rankCol[i] : '#ffffff');
      x.textAlign = 'right'; stroke(fmt(r.v), W - 30, '#ffd23a');
    });
    e.tex.needsUpdate = true;
  }

  setBoards(json) {
    let d = {}; try { d = JSON.parse(json || '{}'); } catch { d = {}; }
    this.boardData = d;
    for (const e of this.boards) this.drawBoard(e, (e.weekly && this.boardWeekly ? d[e.id + '_week'] : d[e.id]) || [], !!(e.weekly && this.boardWeekly));
  }

  update(dt, camPos) {
    this.t += dt;
    this.seaTex.offset.x = (this.t * 0.004) % 1; this.seaTex.offset.y = (this.t * 0.0025) % 1;
    if (this.boardData && Math.floor(this.t / 8) % 2 !== (this.boardFlip ?? -1)) { this.boardFlip = Math.floor(this.t / 8) % 2; this.boardWeekly = this.boardFlip === 1; for (const e of this.boards) if (e.weekly) this.drawBoard(e, (this.boardWeekly ? this.boardData[e.id + '_week'] : this.boardData[e.id]) || [], this.boardWeekly); }
    if (this.padGlow) this.padGlow.material.opacity = 0.1 + Math.sin(this.t * 3) * 0.05;
    for (const s of this.stands) { s.card.rotation.y = this.t * 0.8; s.card.position.y = 3.9 + Math.sin(this.t * 1.6 + s.x) * 0.18; }
    if (this.wheelSpin) {
      const w = this.wheelSpin; w.t += dt;
      const k = Math.min(1, w.t / w.dur), e = 1 - Math.pow(1 - k, 3);
      this.wheelDisc.rotation.z = w.from + (w.to - w.from) * e;
      if (k >= 1) this.wheelSpin = null;
    }
    if (camPos) this.sky.position.copy(camPos);
  }

  spinWheelTo(slice) {
    const n = WHEEL_PRIZES.length;
    const cur = this.wheelDisc.rotation.z;
    // the pointer is at the top (+y): slice centre angle must end at PI/2
    const target = Math.PI / 2 - ((slice + 0.5) / n) * Math.PI * 2;
    let to = target; while (to < cur + Math.PI * 8) to += Math.PI * 2;
    this.wheelSpin = { from: cur, to, t: 0, dur: 4 };
  }
}

function shade(hex) { const c = new THREE.Color(hex); c.offsetHSL(0, 0, -0.08); return '#' + c.getHexString(); }

// A 3D foil packet: two puffed faces (art on both), crimped seals top and bottom, a shiny rim.
function foilPack(tex, rim, w, h) {
  const g = new THREE.Group();
  const seg = 24;
  const face = (sign) => {
    const geo = new THREE.PlaneGeometry(w, h, seg, seg);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / (w / 2), v = p.getY(i) / (h / 2);
      const puff = Math.cos(u * Math.PI / 2) * Math.cos(Math.max(-1, Math.min(1, v * 1.08)) * Math.PI / 2);
      p.setZ(i, sign * (0.03 + 0.42 * Math.max(0, puff)));
      p.setX(i, p.getX(i) * (1 - 0.05 * Math.max(0, puff))); // the sides pull in where it bulges
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.28, metalness: 0.35, side: sign > 0 ? THREE.FrontSide : THREE.BackSide }));
    if (sign < 0) m.scale.x = -1; // back reads the right way round too
    m.castShadow = true;
    return m;
  };
  g.add(face(1), face(-1));
  const sealMat = new THREE.MeshStandardMaterial({ color: '#e9edf2', roughness: 0.3, metalness: 0.6 });
  for (const y of [h / 2, -h / 2]) {
    const n = 18, cw = w / n;
    for (let i = 0; i < n; i++) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(cw * 0.9, 0.34, 0.07 + (i % 2) * 0.04), sealMat);
      t.position.set(-w / 2 + cw * (i + 0.5), y - Math.sign(y) * 0.08, 0);
      g.add(t);
    }
  }
  const edge = new THREE.MeshStandardMaterial({ color: rim, roughness: 0.3, metalness: 0.5 });
  for (const x of [w / 2, -w / 2]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.05, h - 0.3, 0.1), edge); e.position.set(x * 0.995, 0, 0); g.add(e); }
  return g;
}
