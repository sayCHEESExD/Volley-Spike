// 2D art for packs and explosion icons (pack stands in the world, shop cards, reveals).
import { drawBallIcon } from './balls.js';
import { BOOM_BY_ID } from '@shared/items.js';

export function drawPackArt(g, pack, W, H) {
  g.clearRect(0, 0, W, H);
  // foil packet with crimped top and bottom
  const gr = g.createLinearGradient(0, 0, W, H);
  gr.addColorStop(0, pack.c[0]); gr.addColorStop(1, pack.c[1]);
  g.fillStyle = gr;
  g.beginPath(); g.roundRect(W * 0.06, H * 0.05, W * 0.88, H * 0.9, 18); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  for (let x = W * 0.08; x < W * 0.92; x += 10) { g.fillRect(x, H * 0.05, 5, H * 0.05); g.fillRect(x, H * 0.9, 5, H * 0.05); }
  // shine
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.moveTo(W * 0.15, H * 0.1); g.lineTo(W * 0.38, H * 0.1); g.lineTo(W * 0.2, H * 0.9); g.lineTo(W * 0.06, H * 0.9); g.fill();
  // emblem
  const cx = W / 2, cy = H * 0.47, r = W * 0.27;
  if (pack.kind === 'ball') {
    drawBallIcon(g, pack.id === 'deluxe' ? 'galaxy' : 'volley', cx, cy, r);
    if (pack.id === 'deluxe') star(g, cx + r * 0.9, cy - r * 0.9, r * 0.35, '#ffd23a');
  } else {
    burst(g, cx, cy, r * 1.15, ['#ffd23a', '#ff6a1a', '#ff3a3a']);
  }
  g.textAlign = 'center'; g.lineJoin = 'round';
  const title = pack.name.toUpperCase().replace(' PACK', '');
  g.font = `bold ${Math.round(W * 0.15)}px Fredoka, sans-serif`;
  g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.strokeText(title, cx, H * 0.2);
  g.fillStyle = '#fff'; g.fillText(title, cx, H * 0.2);
  g.font = `bold ${Math.round(W * 0.12)}px Fredoka, sans-serif`;
  g.strokeText('PACK', cx, H * 0.82); g.fillStyle = '#ffd23a'; g.fillText('PACK', cx, H * 0.82);
}

export function star(g, x, y, r, col) {
  g.fillStyle = col; g.beginPath();
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath(); g.fill();
}

export function burst(g, x, y, r, cols) {
  cols.forEach((col, k) => {
    const rr = r * (1 - k * 0.28);
    g.fillStyle = col; g.beginPath();
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2, q = i % 2 ? rr * 0.62 : rr; g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); }
    g.closePath(); g.fill();
  });
}

// Icon for an explosion effect, by style.
export function boomIconURL(id, size = 96) {
  const b = BOOM_BY_ID[id] || BOOM_BY_ID.classic;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const x = size / 2, y = size / 2, r = size * 0.42;
  const bg = g.createRadialGradient(x, y, 0, x, y, r * 1.2); bg.addColorStop(0, b.c[0]); bg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = bg; g.fillRect(0, 0, size, size);
  switch (b.fx) {
    case 'confetti': for (let i = 0; i < 28; i++) { g.fillStyle = b.c[i % b.c.length]; g.save(); g.translate(x + (Math.random() - 0.5) * r * 1.8, y + (Math.random() - 0.5) * r * 1.8); g.rotate(Math.random() * 3); g.fillRect(-3, -6, 6, 12); g.restore(); } break;
    case 'hearts': for (let i = 0; i < 5; i++) heart(g, x + Math.cos(i * 1.3) * r * 0.5, y + Math.sin(i * 1.3) * r * 0.5, r * (i ? 0.28 : 0.45), b.c[i % 2]); break;
    case 'stars': case 'gold': for (let i = 0; i < 6; i++) star(g, x + Math.cos(i) * r * 0.55, y + Math.sin(i) * r * 0.55, r * (i ? 0.25 : 0.5), b.c[i % 2]); star(g, x, y, r * 0.45, b.c[0]); break;
    case 'electric': g.strokeStyle = b.c[1]; g.lineWidth = 3; for (let k = 0; k < 6; k++) { g.beginPath(); let px = x, py = y; g.moveTo(px, py); for (let i = 0; i < 5; i++) { px += Math.cos(k) * r * 0.2 + (Math.random() - 0.5) * 10; py += Math.sin(k) * r * 0.2 + (Math.random() - 0.5) * 10; g.lineTo(px, py); } g.stroke(); } break;
    case 'shards': for (let i = 0; i < 10; i++) { g.fillStyle = b.c[i % 3]; g.beginPath(); const a = i * 0.63; g.moveTo(x, y); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.lineTo(x + Math.cos(a + 0.25) * r * 0.6, y + Math.sin(a + 0.25) * r * 0.6); g.fill(); } break;
    case 'void': for (let i = 4; i > 0; i--) { g.fillStyle = b.c[i % 3]; g.beginPath(); g.arc(x, y, (r * i) / 4, 0, 7); g.fill(); } break;
    case 'splash': for (let i = 0; i < 9; i++) { g.fillStyle = b.c[i % 3]; g.beginPath(); g.ellipse(x + Math.cos(i * 0.7 - 2.6) * r * 0.6, y + Math.sin(i * 0.7 - 2.6) * r * 0.6, 6, 12, i * 0.7 - 1, 0, 7); g.fill(); } break;
    default: burst(g, x, y, r, b.c);
  }
  return c.toDataURL();
}

function heart(g, x, y, s, col) {
  g.fillStyle = col; g.beginPath();
  g.moveTo(x, y + s * 0.6);
  g.bezierCurveTo(x - s * 1.2, y - s * 0.2, x - s * 0.5, y - s * 1.1, x, y - s * 0.4);
  g.bezierCurveTo(x + s * 0.5, y - s * 1.1, x + s * 1.2, y - s * 0.2, x, y + s * 0.6);
  g.fill();
}
