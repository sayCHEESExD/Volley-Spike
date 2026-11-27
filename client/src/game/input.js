// Keyboard + mouse (pointer lock) and touch (virtual stick, look pad, buttons).
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.look = { dx: 0, dy: 0 };
    this.wheel = 0;
    this.pressed = new Set(); // edge-triggered key/button presses this frame
    this.released = new Set();
    this.mouse = { left: false, right: false };
    this.stick = { x: 0, y: 0 };
    this.touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.locked = false;
    this.enabled = true; // false while a menu captures input
    this.held = new Set(); // touch buttons held

    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Tab') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (e.code === 'Space' && this.locked) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); this.released.add(e.code); });
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      if (this.touch && e.sourceCapabilities?.firesTouchEvents) return;
      if (!this.locked && this.enabled) { this.requestLock(); return; }
      if (e.button === 0) { this.mouse.left = true; this.pressed.add('Mouse0'); }
      if (e.button === 2) { this.mouse.right = true; this.pressed.add('Mouse2'); }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.mouse.left) { this.mouse.left = false; this.released.add('Mouse0'); }
      if (e.button === 2 && this.mouse.right) { this.mouse.right = false; this.released.add('Mouse2'); }
    });
    addEventListener('mousemove', (e) => { if (this.locked) { this.look.dx += e.movementX; this.look.dy += e.movementY; } });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.mouse.left = this.mouse.right = false; }
      this.onLockChange && this.onLockChange(this.locked);
    });
    if (this.touch) this.setupTouch();
  }

  requestLock() {
    if (this.touch) return;
    const fallback = () => { try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch { /* ignore */ } };
    try { const p = this.canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(fallback); } catch { fallback(); }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  setupTouch() {
    // left half: movement stick; right half: look drag. Buttons call press()/release().
    const zone = this.canvas;
    let stickId = null, lookId = null, sx = 0, sy = 0, lx = 0, ly = 0;
    const base = document.createElement('div'); base.className = 'stick-base';
    const knob = document.createElement('div'); knob.className = 'stick-knob'; base.appendChild(knob);
    document.body.appendChild(base);
    this.stickEl = base;
    zone.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.42 && stickId === null) {
          stickId = t.identifier; sx = t.clientX; sy = t.clientY;
          base.style.left = sx - 60 + 'px'; base.style.top = sy - 60 + 'px'; base.classList.add('on');
        } else if (lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
      }
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          let dx = t.clientX - sx, dy = t.clientY - sy; const l = Math.hypot(dx, dy), m = 55;
          if (l > m) { dx *= m / l; dy *= m / l; }
          this.stick.x = dx / m; this.stick.y = dy / m;
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
        } else if (t.identifier === lookId) {
          this.look.dx += (t.clientX - lx) * 1.6; this.look.dy += (t.clientY - ly) * 1.6; lx = t.clientX; ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) { stickId = null; this.stick.x = this.stick.y = 0; knob.style.transform = ''; base.classList.remove('on'); }
        if (t.identifier === lookId) lookId = null;
      }
    };
    zone.addEventListener('touchend', end); zone.addEventListener('touchcancel', end);
  }

  // touch buttons
  press(code) { if (!this.held.has(code)) this.pressed.add(code); this.held.add(code); }
  release(code) { if (this.held.delete(code)) this.released.add(code); }

  down(code) { return this.enabled && (this.keys.has(code) || this.held.has(code)); }
  hit(code) { return this.enabled && this.pressed.has(code); }
  up(code) { return this.released.has(code); }

  axes() {
    if (!this.enabled) return { x: 0, z: 0 };
    let x = 0, z = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    x += this.stick.x; z -= this.stick.y;
    return { x: Math.max(-1, Math.min(1, x)), z: Math.max(-1, Math.min(1, z)) };
  }

  endFrame() { this.pressed.clear(); this.released.clear(); this.look.dx = this.look.dy = 0; this.wheel = 0; }
}
