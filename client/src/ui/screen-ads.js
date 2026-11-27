// Boxity screen ads ('menu' for the title screen, 'panel' for the toy / house menu).
// Banners sit along the screen edges. For every position we test each banner size
// against the real on-screen rectangles of our UI (the open panel, coins HUD, hints, touch
// buttons) and Boxity's reserved toolbar / chat areas, and only offer sizes that fit
// without covering anything. So on a phone no banner can land on a menu. The layout is
// re-sent only when it changes (resize, panel open / close), never during a rewarded ad.
import { Bloxity } from '../bloxity.js';

const GAP = 6;
const SIZES = {
  'top-center': ['728x90', '320x100', '320x50'],
  'bottom-center': ['728x90', '320x100', '320x50'],
  'middle-left': ['160x600', '300x600', '300x250'],
  'middle-right': ['160x600', '300x600', '300x250'],
  'top-right': ['300x250', '320x100', '320x50'],
  'bottom-left': ['300x250', '320x100', '320x50'],
  'bottom-right': ['300x250', '320x100', '320x50'],
};

function slotRect(pos, w, h, vw, vh) {
  const x = pos.endsWith('left') ? 0 : pos.endsWith('right') ? vw - w : (vw - w) / 2;
  const y = pos.startsWith('top') ? 0 : pos.startsWith('bottom') ? vh - h : (vh - h) / 2;
  return { left: x, top: y, right: x + w, bottom: y + h };
}
const hit = (a, b) => a.left < b.right + GAP && a.right + GAP > b.left && a.top < b.bottom + GAP && a.bottom + GAP > b.top;
const rectOf = (el) => { if (!el || !el.isConnected) return null; const r = el.getBoundingClientRect(); return r.width && r.height ? r : null; };

export class ScreenAds {
  constructor(getPanel) {
    this.getPanel = getPanel; // () => element of the open panel (or null)
    this.type = null;
    this.key = null;
    this.handle = null;
    this.paused = false;
    this.target = null; // centred content of the current screen (title, lobby, results podium)
    let t = 0;
    addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => this.relayout(), 150); }); // relayout() re-sends only if the layout changed
  }

  show(type, target = null) { this.type = type; this.target = target; this.key = null; this.relayout(); }

  hide(type) {
    if (type && this.type !== type) return;
    this.type = null; this.key = null;
    document.documentElement.style.setProperty('--ad-reserve-v', '0px');
    if (this.paused) return; // never touch screens while a rewarded ad is pending
    if (this.handle && this.handle.hide) this.handle.hide(); else Bloxity.hideAdScreen();
    this.handle = null;
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; this.key = null; this.relayout(); } // re-send the current screen

  relayout() {
    if (!this.type || this.paused) return;
    const opts = this.layout();
    const key = this.type + JSON.stringify(opts);
    if (key === this.key) return;
    this.key = key;
    this.handle = Bloxity.adScreen(this.type, opts);
  }

  layout() {
    const vw = innerWidth, vh = innerHeight;
    // mid-height screens: shrink the panel a little so a short banner fits above/below it
    const reserve = this.type === 'panel' && vh >= 430 && vh < 760 ? 56 : 0;
    document.documentElement.style.setProperty('--ad-reserve-v', `${reserve}px`);
    const obstacles = [];
    const add = (r) => { if (r) obstacles.push(r); };
    add(rectOf(this.type === 'panel' ? this.getPanel() : this.target));
    for (const sel of ['.top', '.left', '.hotbar', '.tpad', '.toasts', '.tut', '.spec', '.prompt', '.exitprac', '.adbtn']) document.querySelectorAll(sel).forEach((el) => add(rectOf(el)));
    for (const a of Bloxity.reservedAreas() || []) add({ left: a.left, top: a.top, right: a.left + a.width, bottom: a.top + a.height });
    const skip = ['top-left']; // Boxity's toolbar corner
    const sizes = {};
    for (const [pos, list] of Object.entries(SIZES)) {
      const fit = list.find((s) => {
        const [w, h] = s.split('x').map(Number);
        if (w > vw || h > vh) return false;
        const r = slotRect(pos, w, h, vw, vh);
        return !obstacles.some((o) => hit(r, o));
      });
      if (fit) sizes[pos] = fit; else skip.push(pos);
    }
    // two banners on the same edge must not touch each other either
    const taken = [];
    for (const pos of Object.keys(sizes)) {
      const [w, h] = sizes[pos].split('x').map(Number);
      const r = slotRect(pos, w, h, vw, vh);
      if (taken.some((t) => hit(r, t))) { delete sizes[pos]; skip.push(pos); } else taken.push(r);
    }
    return { skip: skip.sort(), sizes };
  }
}
