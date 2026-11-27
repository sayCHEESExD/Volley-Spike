// Textures: the supplied grass image (every grass surface) plus small procedural canvases
// for dirt sides, the clay practice court, the sea, clouds, faces and text labels.
import * as THREE from 'three';

const cache = new Map();
let grassImg = null;
const grassWaiters = [];

function canvasTex(key, size, draw, { repeat = false, srgb = true } = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

const noise = (g, s, n, colors, r0 = 0.6, r1 = 2) => {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(Math.random() * colors.length) | 0];
    const r = r0 + Math.random() * r1;
    g.fillRect(Math.random() * s, Math.random() * s, r, r);
  }
};

// The supplied grass (client/public/textures/grass.png), tiled every `tile` metres.
export function grassTexture(w, d, tile = 7) {
  const t = new THREE.Texture();
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.repeat.set(w / tile, d / tile);
  const apply = (img) => { t.image = img; t.needsUpdate = true; };
  if (grassImg) apply(grassImg); else grassWaiters.push(apply);
  return t;
}
export function loadGrass() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { grassImg = img; for (const f of grassWaiters.splice(0)) f(img); resolve(true); };
    img.onerror = () => resolve(false);
    img.src = 'textures/grass.png';
  });
}

export const TEX = {
  dirt: () => canvasTex('dirt', 256, (g, s) => {
    g.fillStyle = '#7a4a2c'; g.fillRect(0, 0, s, s);
    noise(g, s, 2600, ['#6a3e24', '#86553a', '#5c3520', '#8f5f40', '#734429']);
    g.fillStyle = 'rgba(40,20,10,0.25)'; for (let y = 30; y < s; y += 46) g.fillRect(0, y + Math.random() * 8, s, 3);
    // grass lip along the top edge
    g.fillStyle = '#3f9a2a'; g.fillRect(0, 0, s, 10);
    for (let x = 0; x < s; x += 3) { g.fillStyle = Math.random() < 0.5 ? '#2f8420' : '#4cad33'; g.fillRect(x, 8, 3, 3 + Math.random() * 9); }
  }, { repeat: true }),
  dirtPlain: () => canvasTex('dirtPlain', 256, (g, s) => {
    g.fillStyle = '#7a4a2c'; g.fillRect(0, 0, s, s);
    noise(g, s, 2600, ['#6a3e24', '#86553a', '#5c3520', '#8f5f40']);
  }, { repeat: true }),
  clay: () => canvasTex('clay', 256, (g, s) => {
    g.fillStyle = '#8a4a2a'; g.fillRect(0, 0, s, s);
    noise(g, s, 9000, ['#7a3f22', '#9a5634', '#6c351c', '#a5603c', '#5e2e17'], 0.5, 1.6);
  }, { repeat: true }),
  wood: () => canvasTex('wood', 128, (g, s) => {
    g.fillStyle = '#a8794a'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) { g.fillStyle = 'rgba(60,35,15,0.5)'; g.fillRect(0, y, s, 2); }
    noise(g, s, 500, ['#94653a', '#b88a58'], 0.5, 1);
  }, { repeat: true }),
  sea: () => canvasTex('sea', 256, (g, s) => {
    g.fillStyle = '#6fd3e6'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      g.strokeStyle = `rgba(255,255,255,${0.12 + Math.random() * 0.25})`; g.lineWidth = 1 + Math.random() * 1.5;
      const x = Math.random() * s, y = Math.random() * s, l = 6 + Math.random() * 18;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y - 2, x + l, y); g.stroke();
    }
  }, { repeat: true }),
  cloud: () => canvasTex('cloud', 128, (g, s) => {
    for (let i = 0; i < 14; i++) {
      const x = s * (0.2 + Math.random() * 0.6), y = s * (0.45 + Math.random() * 0.2), r = s * (0.1 + Math.random() * 0.16);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }),
  shadow: () => canvasTex('shadow', 128, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.7, 'rgba(0,0,0,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }),
  marker: () => canvasTex('marker', 256, (g, s) => {
    g.fillStyle = 'rgba(10,30,20,0.42)'; g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 5; g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2); g.stroke();
  }),
  ring: () => canvasTex('ring', 128, (g, s) => {
    g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 8, 0, Math.PI * 2); g.stroke();
  }),
  spark: () => canvasTex('spark', 64, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }),
  face: () => canvasTex('face', 128, (g, s) => {
    g.clearRect(0, 0, s, s); g.fillStyle = '#1b1b1b';
    g.fillRect(s * 0.3, s * 0.35, s * 0.1, s * 0.16); g.fillRect(s * 0.6, s * 0.35, s * 0.1, s * 0.16);
    g.lineWidth = s * 0.05; g.strokeStyle = '#1b1b1b'; g.beginPath(); g.arc(s / 2, s * 0.55, s * 0.2, 0.2, Math.PI - 0.2); g.stroke();
  }),
};

// Text on a transparent canvas (name tags, signs). lines: string | string[]
export function textTexture(lines, { w = 512, h = 128, bg = null, fg = '#fff', font = 'bold 52px Fredoka, Nunito, sans-serif', stroke = 'rgba(0,0,0,0.6)', radius = 24, sizes = null, colors = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, radius); g.fill(); }
  const arr = Array.isArray(lines) ? lines : [lines];
  g.textAlign = 'center'; g.textBaseline = 'middle';
  arr.forEach((line, i) => {
    g.font = sizes && sizes[i] ? sizes[i] : font;
    const y = h * ((i + 0.5) / arr.length);
    if (stroke) { g.lineWidth = 8; g.strokeStyle = stroke; g.lineJoin = 'round'; g.strokeText(line, w / 2, y); }
    g.fillStyle = colors && colors[i] ? colors[i] : fg; g.fillText(line, w / 2, y);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
