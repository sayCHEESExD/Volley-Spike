// Ball skins: each catalogue ball is painted procedurally onto an equirectangular canvas
// (sphere texture) and reused for 2D icons. No image files.
import * as THREE from 'three';
import { BALL_BY_ID } from '@shared/items.js';

const canvases = new Map();
const textures = new Map();
const R = (a, b) => a + Math.random() * (b - a);

export function ballCanvas(id) {
  if (canvases.has(id)) return canvases.get(id);
  const b = BALL_BY_ID[id] || BALL_BY_ID.default;
  const W = 512, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const [c0, c1, c2] = b.c;
  g.fillStyle = c0; g.fillRect(0, 0, W, H);
  const line = (col, w) => { g.strokeStyle = col; g.lineWidth = w; };
  switch (b.look) {
    case 'plain': {
      // classic volleyball-style seams in grey on white
      line(c1, 7);
      for (const y of [H * 0.33, H * 0.66]) { g.beginPath(); for (let x = 0; x <= W; x += 8) g.lineTo(x, y + Math.sin((x / W) * Math.PI * 6) * 18); g.stroke(); }
      for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo((W / 3) * i + 40, 0); g.bezierCurveTo((W / 3) * i + 120, H * 0.4, (W / 3) * i - 30, H * 0.6, (W / 3) * i + 50, H); g.stroke(); }
      break;
    }
    case 'panels': {
      const cols = [c0, c1, c2];
      for (let i = 0; i < 9; i++) { g.fillStyle = cols[i % 3]; g.beginPath(); g.moveTo((W / 9) * i, 0); g.bezierCurveTo((W / 9) * i + 60, H * 0.35, (W / 9) * i - 30, H * 0.65, (W / 9) * i + 30, H); g.lineTo((W / 9) * (i + 1) + 30, H); g.bezierCurveTo((W / 9) * (i + 1) - 30, H * 0.65, (W / 9) * (i + 1) + 60, H * 0.35, (W / 9) * (i + 1), 0); g.fill(); }
      line('rgba(0,0,0,0.25)', 3); for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo((W / 9) * i, 0); g.bezierCurveTo((W / 9) * i + 60, H * 0.35, (W / 9) * i - 30, H * 0.65, (W / 9) * i + 30, H); g.stroke(); }
      break;
    }
    case 'segments': {
      const n = b.c.length;
      for (let i = 0; i < 6; i++) { g.fillStyle = b.c[i % n]; g.fillRect((W / 6) * i, 0, W / 6 + 1, H); }
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, 22); g.fillRect(0, H - 22, W, 22);
      break;
    }
    case 'seams': {
      line(c1, 6);
      g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
      for (const x of [W / 4, (W * 3) / 4]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      for (const x of [0, W / 2]) { g.beginPath(); g.ellipse(x + W / 4, H / 2, W / 6, H / 2.4, 0, 0, Math.PI * 2); g.stroke(); }
      for (let i = 0; i < 3000; i++) { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
      break;
    }
    case 'patches': {
      g.fillStyle = c1;
      for (let i = 0; i < 12; i++) { const x = (i % 6) * (W / 6) + (Math.floor(i / 6) ? W / 12 : 0) + 30, y = Math.floor(i / 6) ? H * 0.68 : H * 0.3; poly(g, x, y, 26, 5); }
      poly(g, W / 2, 8, 30, 5); poly(g, W / 2, H - 8, 30, 5);
      break;
    }
    case 'marble': case 'gradient': case 'crystal': case 'cracks': case 'stars': case 'scales': case 'rings': case 'metal': case 'stripes':
    default: {
      if (b.look === 'marble') { for (let i = 0; i < 40; i++) { line(i % 2 ? c1 : c2, R(3, 10)); g.globalAlpha = 0.5; g.beginPath(); let x = R(0, W), y = R(0, H); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += R(-60, 60); y += R(-30, 30); g.lineTo(x, y); } g.stroke(); } g.globalAlpha = 1; for (const x of [W * 0.25, W * 0.29, W * 0.27]) { g.fillStyle = '#0a0418'; g.beginPath(); g.arc(x, H * 0.4 + (x - W * 0.25) * 2, 9, 0, 7); g.fill(); } }
      if (b.look === 'gradient') { const gr = g.createLinearGradient(0, 0, W, H); b.c.forEach((col, i) => gr.addColorStop(i / (b.c.length - 1), col)); g.fillStyle = gr; g.fillRect(0, 0, W, H); for (let i = 0; i < 5; i++) { line('rgba(255,255,255,0.35)', R(4, 12)); g.beginPath(); for (let x = 0; x <= W; x += 10) g.lineTo(x, H * (0.2 + i * 0.15) + Math.sin(x / 40 + i) * 14); g.stroke(); } }
      if (b.look === 'crystal') { for (let i = 0; i < 60; i++) { g.fillStyle = [c0, c1, c2][i % 3]; g.globalAlpha = 0.6; g.beginPath(); const x = R(0, W), y = R(0, H); g.moveTo(x, y); g.lineTo(x + R(-40, 40), y + R(-40, 40)); g.lineTo(x + R(-40, 40), y + R(-40, 40)); g.fill(); } g.globalAlpha = 1; }
      if (b.look === 'cracks') { for (let i = 0; i < 26; i++) { line(i % 3 ? c1 : c2, R(3, 7)); g.shadowColor = c2; g.shadowBlur = 10; g.beginPath(); let x = R(0, W), y = R(0, H); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += R(-40, 40); y += R(-25, 25); g.lineTo(x, y); } g.stroke(); } g.shadowBlur = 0; }
      if (b.look === 'stars') { const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, c0); gr.addColorStop(0.5, c1); gr.addColorStop(1, c0); g.fillStyle = gr; g.fillRect(0, 0, W, H); for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,255,255,${R(0.3, 1)})`; const r = R(0.6, 2.4); g.beginPath(); g.arc(R(0, W), R(0, H), r, 0, 7); g.fill(); } }
      if (b.look === 'scales') { for (let y = 0; y < H + 20; y += 18) for (let x = (y / 18) % 2 ? 12 : 0; x < W + 24; x += 24) { g.fillStyle = (x + y) % 3 ? c0 : c2; g.beginPath(); g.arc(x, y, 14, 0, Math.PI); g.fill(); line(c1, 2); g.beginPath(); g.arc(x, y, 14, 0, Math.PI); g.stroke(); } }
      if (b.look === 'rings') { for (let i = 0; i < 8; i++) { line(i % 2 ? c1 : c2, 7); g.shadowColor = i % 2 ? c1 : c2; g.shadowBlur = 14; g.beginPath(); g.moveTo(0, (H / 8) * i + 16); g.lineTo(W, (H / 8) * i + 16); g.stroke(); } g.shadowBlur = 0; }
      if (b.look === 'metal') { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, c2); gr.addColorStop(0.45, c0); gr.addColorStop(1, c1); g.fillStyle = gr; g.fillRect(0, 0, W, H); line('rgba(120,80,0,0.5)', 5); for (const y of [H * 0.33, H * 0.66]) { g.beginPath(); for (let x = 0; x <= W; x += 8) g.lineTo(x, y + Math.sin((x / W) * Math.PI * 6) * 18); g.stroke(); } }
      if (b.look === 'stripes') { for (let x = 0; x < W; x += 16) { g.fillStyle = (x / 16) % 3 === 0 ? c1 : c0; g.fillRect(x, 0, (x / 32) % 2 ? 6 : 10, H); } g.fillStyle = c1; g.fillRect(0, H * 0.45, W, H * 0.1); }
    }
  }
  canvases.set(id, c);
  return c;
}

function poly(g, x, y, r, n) { g.beginPath(); for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 - Math.PI / 2; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.closePath(); g.fill(); }

export function ballTexture(id) {
  if (textures.has(id)) return textures.get(id);
  const t = new THREE.CanvasTexture(ballCanvas(id));
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  textures.set(id, t);
  return t;
}

// A round, shaded 2D icon of a ball (inventory, pack reveals).
export function drawBallIcon(g, id, x, y, r) {
  const src = ballCanvas(id);
  g.save();
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
  g.drawImage(src, 0, 0, src.width / 2, src.height, x - r, y - r, r * 2, r * 2);
  const sh = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  sh.addColorStop(0, 'rgba(255,255,255,0.45)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = sh; g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();
}

export function ballIconURL(id, size = 96) {
  const key = 'icon:' + id + ':' + size;
  if (canvases.has(key)) return canvases.get(key);
  const c = document.createElement('canvas'); c.width = c.height = size;
  drawBallIcon(c.getContext('2d'), id, size / 2, size / 2, size * 0.44);
  const url = c.toDataURL();
  canvases.set(key, url);
  return url;
}
