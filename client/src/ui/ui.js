// HUD and menus (DOM). The game calls the setters every frame; they only touch the DOM when
// something changed. Menus: Inventory (Balls / Abilities / Explosions / Shop), Quests,
// Career (stats / achievements / titles), Daily rewards, Prize wheel, Settings.
import { Bloxity } from '../bloxity.js';
import { ScreenAds } from './screen-ads.js';
import { BALLS, EXPLOSIONS, ABILITY_LIST, PACKS, RARITY, BALL_BY_ID, BOOM_BY_ID, ACHIEVEMENTS, WHEEL_PRIZES, titleUnlocked } from '@shared/items.js';
import { DAILY_LOGIN, ABILITIES, WHEEL_COOLDOWN } from '@shared/constants.js';
import { ballIconURL } from '../render/balls.js';
import { boomIconURL, drawPackArt } from '../render/packart.js';

const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const coin = '<i class="coin"></i>';
const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); const m = Math.floor(s / 60), r = s % 60; return `${m}m ${String(r).padStart(2, '0')}s`; };
const boomIcons = new Map();
const boomIcon = (id) => { if (!boomIcons.has(id)) boomIcons.set(id, boomIconURL(id)); return boomIcons.get(id); };
const MENU_KEYS = { KeyI: 'inventory', KeyJ: 'quests', KeyC: 'career', KeyG: 'store', KeyH: 'daily', KeyK: 'wheel', KeyO: 'settings' };
const MENU_KEY_LABEL = Object.fromEntries(Object.entries(MENU_KEYS).map(([k, id]) => [id, k.slice(3)]));
const ABIL_ICON = { adrenaline: '⚡', magnet: '🧲', superspike: '💥', curveball: '🌀', frozen: '❄️' };

export class UI {
  constructor(root) {
    this.root = root;
    this.profile = null;
    this.menu = null;
    this.cache = {};
    this.ads = new ScreenAds(() => this.panelEl);
    this.build();
  }
  attach(game) { this.game = game; }
  isMenuOpen() { return !!this.menu || !!this.overlayOpen; }
  isTyping() { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && a.type !== 'range'; }

  build() {
    const r = this.root;
    r.innerHTML = '';
    // left menu column
    this.left = h('div', 'left');
    this.coinsEl = h('div', 'coins', `${coin}<b>0</b>`);
    this.left.appendChild(this.coinsEl);
    const grid = h('div', 'lgrid');
    const kh = (k) => `<kbd class="kh">${k}</kbd>`;
    const btn = (id, icon, label) => { const b = h('button', 'lbtn', `<img src="ui/${icon}.png" alt=""><span>${label}</span>${kh(MENU_KEY_LABEL[id])}`); b.onclick = () => this.open(id); b.dataset.id = id; grid.appendChild(b); return b; };
    btn('inventory', 'inventory', 'Inventory'); btn('quests', 'daily', 'Quests');
    btn('career', 'trophy', 'Career'); btn('store', 'shop', 'Store');
    this.dailyBtn = btn('daily', 'gift', 'Rewards'); this.wheelBtn = btn('wheel', 'upgrades', 'Wheel');
    this.afkBtn = h('button', 'lbtn small', `<span>AFK</span>${kh('L')}`); this.afkBtn.onclick = () => this.toggleAfk(); grid.appendChild(this.afkBtn);
    const set = h('button', 'lbtn small', `<img src="ui/settings.png" alt="">${kh('O')}`); set.onclick = () => this.open('settings'); grid.appendChild(set);
    this.left.appendChild(grid);
    this.adBtn = h('button', 'adbtn hidden', 'Watch ad'); this.adBtn.onclick = () => this.game && this.game.watchAd();
    this.left.appendChild(this.adBtn);
    r.appendChild(this.left);
    // top centre
    this.top = h('div', 'top');
    this.statusEl = h('div', 'status');
    this.subEl = h('div', 'sub');
    this.feedEl = h('div', 'feed');
    this.bountyEl = h('div', 'bountycard hidden');
    this.voteEl = h('div', 'vote hidden');
    this.top.append(this.statusEl, this.subEl, this.voteEl, this.bountyEl, this.feedEl);
    r.appendChild(this.top);
    this.voteEl.innerHTML = '<div class="vt">Choose Gamemode</div><div class="vbtns"><button data-v="duos" class="vduo"><kbd class="kh">1</kbd>Duos (<b>0</b>)</button><button data-v="solo" class="vsolo"><kbd class="kh">2</kbd>Solo (<b>0</b>)</button></div><div class="vtime"></div>';
    this.voteEl.querySelectorAll('button').forEach((b) => { b.onclick = () => { this.myVote = b.dataset.v; this.game.net.send('vote', b.dataset.v); }; });
    // hotbar
    this.hotbarEl = h('div', 'hotbar');
    this.slotHit = h('div', 'slot', '<div class="ico">🏐</div><div class="key">LMB</div><div class="nm">Bump</div>');
    this.slotDive = h('div', 'slot', '<div class="ico">🤸</div><div class="key">E</div><div class="nm">Dive</div><div class="cd"></div>');
    this.slotAbil = h('div', 'slot', '<div class="ico">⚡</div><div class="key">R</div><div class="nm">Adrenaline</div><div class="cd"></div><div class="cdt"></div>');
    this.slotHit.onclick = () => this.game.pressHit(); this.slotAbil.onclick = () => this.game.useAbility();
    this.hotbarEl.append(this.slotHit, this.slotDive, this.slotAbil);
    r.appendChild(this.hotbarEl);
    // spectate bar
    this.specEl = h('div', 'spec hidden', '<kbd class="kh">Z</kbd><button class="sl">◀</button><span>Spectate</span><button class="sr">▶</button><kbd class="kh">Q</kbd>');
    this.specEl.querySelector('.sl').onclick = () => this.specStep(-1);
    this.specEl.querySelector('.sr').onclick = () => this.specStep(1);
    this.specEl.querySelector('span').onclick = () => { if (this.game.spectate) this.game.stopSpectate(); else this.game.startSpectate(); };
    r.appendChild(this.specEl);
    // practice
    this.pracEl = h('button', 'exitprac hidden', 'Exit Practice <kbd class="kh">X</kbd>');
    this.pracEl.onclick = () => this.game.net.send('exitPractice');
    r.appendChild(this.pracEl);
    // prompt
    this.promptEl = h('button', 'prompt hidden');
    this.promptEl.onclick = () => this.game.usePrompt();
    r.appendChild(this.promptEl);
    // popups / banners / toasts
    this.popEl = h('div', 'pop'); r.appendChild(this.popEl);
    this.bannerEl = h('div', 'banner hidden'); r.appendChild(this.bannerEl);
    this.toastEl = h('div', 'toasts'); r.appendChild(this.toastEl);
    this.coinPopEl = h('div', 'coinpop'); r.appendChild(this.coinPopEl);
    // tutorial
    this.tutEl = h('div', 'tut hidden', '<div class="tt"></div><div class="ts"></div>');
    r.appendChild(this.tutEl);
    this.tutSkip = h('button', 'tutskip hidden', 'Skip tutorial');
    this.tutSkip.onclick = () => { this.game.net.send('tutSkip'); this.tutorial(null); };
    r.appendChild(this.tutSkip);
    // modal panel host
    this.shade = h('div', 'shade hidden');
    this.shade.onclick = (e) => { if (e.target === this.shade) this.close(); };
    r.appendChild(this.shade);
    // touch controls
    if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) {
      document.body.classList.add('touch');
      this.tpad = h('div', 'tpad');
      const tb = (cls, label, code) => {
        const b = h('div', 'tb ' + cls, label);
        b.addEventListener('touchstart', (e) => { e.preventDefault(); this.game.input.press(code); b.classList.add('on'); }, { passive: false });
        const up = (e) => { e.preventDefault(); this.game.input.release(code); b.classList.remove('on'); };
        b.addEventListener('touchend', up, { passive: false }); b.addEventListener('touchcancel', up, { passive: false });
        this.tpad.appendChild(b); return b;
      };
      this.tHit = tb('thit', 'HIT', 'Hit'); tb('tjump', 'JUMP', 'Jump'); tb('tdive', 'DIVE', 'Dive'); tb('tabil', '⚡', 'Abil');
      r.appendChild(this.tpad);
    }
    addEventListener('keydown', (e) => this.onKey(e));
    addEventListener('resize', () => this.layout());
    this.layout();
    Bloxity.onReservedAreas((areas) => this.applyReserved(Bloxity.embedded() ? areas || [] : []));
  }

  // Shortcuts for every HUD button, for PC play with the mouse locked. Never P or Escape
  // (Boxity / CrazyGames own those). Menus ignore them, except a menu's own key closes it.
  onKey(e) {
    const g = this.game;
    if (!g || e.repeat || this.isTyping() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!document.getElementById('loading').classList.contains('done')) return;
    if (this.deathEl) { if ((e.code === 'Space' || e.code === 'Enter') && this.deathBtn && !this.deathBtn.disabled) this.deathBtn.click(); return; }
    if (this.overlayOpen) return;
    const id = MENU_KEYS[e.code];
    if (this.menu) {
      const same = id && (this.menu === id || (id === 'store' && this.menu === 'inventory' && this.tab === 'shop'));
      if (same) { const relock = this.relock; this.close(); if (relock) g.input.requestLock(); }
      return;
    }
    if (id) { this.open(id); return; }
    switch (e.code) {
      case 'KeyL': this.toggleAfk(); break;
      case 'KeyX': { const mc = g.myCourt(); const r = g.region; if ((mc && mc.id === 'prac') || (r && r.minX > 40 && r.maxX < 90)) g.net.send('exitPractice'); break; } // also right after landing on the practice slab
      case 'KeyQ': if (!this.specEl.classList.contains('hidden')) this.specStep(1); break;
      case 'KeyZ': if (!this.specEl.classList.contains('hidden')) this.specStep(-1); break;
      case 'Digit1': case 'Digit2':
        if (!this.voteEl.classList.contains('hidden')) { const v = e.code === 'Digit1' ? 'duos' : 'solo'; this.myVote = v; g.net.send('vote', v); }
        break;
      default:
    }
  }

  // HUD size follows the window: one scale for the clusters, a separate one for the touch pad.
  // The left column is centred but never rises into the top-left corner (Boxity's toolbar).
  layout() {
    const w = innerWidth, hgt = innerHeight;
    const touch = document.body.classList.contains('touch');
    const s = Math.max(0.55, Math.min(1.3, Math.min(w / 1366, hgt / 768) * (touch ? 1.3 : 1)));
    const tp = Math.max(0.7, Math.min(1.25, Math.min(w / 900, hgt / 420)));
    const rs = document.documentElement.style;
    rs.setProperty('--hud', s.toFixed(3));
    rs.setProperty('--tpad', tp.toFixed(3));
    this.hudScale = s;
    const safeTop = Math.max(this.reserveTop || 0, touch ? 56 : 70);
    const colH = this.left.offsetHeight * s;
    const top = Math.max(safeTop, Math.min((hgt - colH) / 2, hgt - colH - 8));
    this.left.style.top = top + 'px';
    // the status / vote block stays top-centre, but drops below the toolbar corner when the screen is narrow
    this.top.style.top = '8px';
    const tr = this.top.getBoundingClientRect();
    const corner = { right: 300, bottom: 64 };
    for (const a of this.reserved || []) if (a.left < w / 2 && a.top < 120) { corner.right = Math.max(corner.right, a.left + a.width + 8); corner.bottom = Math.max(corner.bottom, a.top + a.height + 4); }
    if (tr.left < corner.right) this.top.style.top = corner.bottom + 'px';
    if (this.ads) this.ads.relayout();
  }

  applyReserved(areas) {
    // keep the left column clear of Boxity's toolbar
    let topPad = 0;
    for (const a of areas) if (a.left < 260 && a.top < 120) topPad = Math.max(topPad, a.top + a.height + 6);
    document.documentElement.style.setProperty('--reserve-top', `${topPad}px`);
    this.reserveTop = topPad;
    this.reserved = areas;
    if (this.left) this.layout();
  }

  // ------------------------------------------------------------------ hud setters
  set(key, val, fn) { if (this.cache[key] === val) return; this.cache[key] = val; fn(val); }

  setProfile(p) {
    const first = !this.profile;
    this.profile = p;
    if (!p) return;
    this.coinsEl.querySelector('b').textContent = p.coins.toLocaleString();
    if (this.game) this.game.profileAt = performance.now();
    this.dailyBtn.classList.toggle('ping', !!(p.login && p.login.claimable));
    const questReady = p.quests.some((q) => q.prog >= q.goal && !q.claimed);
    this.left.querySelector('[data-id=quests]').classList.toggle('ping', questReady);
    if (this.menu) this.render();
    if (first && p.login && p.login.claimable && p.tut) setTimeout(() => { if (!this.menu) this.open('daily'); }, 2500);
  }

  coinPop(n) {
    const e = h('div', 'cp', `+${n} ${coin}`);
    const cr = this.coinsEl.getBoundingClientRect();
    this.coinPopEl.style.left = `${cr.right + 6}px`; this.coinPopEl.style.top = `${cr.top}px`;
    this.coinPopEl.appendChild(e);
    setTimeout(() => e.remove(), 1400);
    this.coinsEl.classList.remove('bump'); void this.coinsEl.offsetWidth; this.coinsEl.classList.add('bump');
  }

  status(text, sub) {
    this.set('status', text, (v) => { this.statusEl.textContent = v; });
    this.set('sub', sub, (v) => { this.subEl.textContent = v || ''; });
  }

  feed(text, kind = '') {
    const e = h('div', 'fl ' + kind, esc(text));
    this.feedEl.prepend(e);
    while (this.feedEl.children.length > 4) this.feedEl.lastChild.remove();
    setTimeout(() => { e.classList.add('out'); setTimeout(() => e.remove(), 500); }, 4500);
  }

  toast(text, kind = 'info') {
    const e = h('div', 'toast ' + kind, esc(text));
    this.toastEl.appendChild(e);
    setTimeout(() => { e.classList.add('out'); setTimeout(() => e.remove(), 400); }, 3200);
  }

  popup(text, kind = 'good') {
    const e = h('div', 'pp ' + kind, esc(text));
    e.style.left = `${46 + Math.random() * 8}%`;
    this.popEl.appendChild(e);
    setTimeout(() => e.remove(), 1100);
  }

  banner(text, sub = '', ms = 2500) {
    this.bannerEl.innerHTML = `<div class="bt">${esc(text)}</div>${sub ? `<div class="bs">${esc(sub)}</div>` : ''}`;
    this.bannerEl.classList.remove('hidden', 'show'); void this.bannerEl.offsetWidth; this.bannerEl.classList.add('show');
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => this.bannerEl.classList.add('hidden'), ms);
  }

  bountyPop(m) { this.banner(m.text, `${m.name}'s bounty: +${m.coins} coins`, 2600); }

  vote(v) {
    const key = v.show ? `${v.solo}|${v.duos}|${v.left}|${this.myVote}|${v.afk}` : 'off';
    this.set('vote', key, () => {
      this.voteEl.classList.toggle('hidden', !v.show);
      if (!v.show) { this.myVote = null; return; }
      this.voteEl.querySelector('.vsolo b').textContent = v.solo || 0;
      this.voteEl.querySelector('.vduo b').textContent = v.duos || 0;
      this.voteEl.querySelector('.vsolo').classList.toggle('mine', this.myVote === 'solo');
      this.voteEl.querySelector('.vduo').classList.toggle('mine', this.myVote === 'duos');
      this.voteEl.querySelector('.vtime').textContent = v.afk ? 'You are AFK' : v.left >= 0 ? `Game starting in ${v.left}s` : 'Waiting for players...';
    });
  }

  hotbar(s) {
    this.set('hb-air', s.serving ? 'serve' : s.air ? 'air' : 'ground', (v) => {
      this.slotHit.querySelector('.nm').textContent = v === 'serve' ? 'Toss' : v === 'air' ? 'Spike' : 'Bump';
      this.slotHit.querySelector('.ico').textContent = v === 'air' ? '💥' : '🏐';
      this.slotHit.classList.toggle('hot', v === 'serve');
      if (this.tHit) this.tHit.textContent = v === 'serve' ? 'TOSS' : v === 'air' ? 'SPIKE' : 'BUMP';
    });
    this.set('hb-dive', Math.round(s.dive * 20), (v) => { this.slotDive.querySelector('.cd').style.height = `${v * 5}%`; });
    const a = s.abil;
    this.set('hb-abil', `${a.id}|${Math.round(a.cd * 30)}|${a.active}|${a.left}`, () => {
      this.slotAbil.querySelector('.nm').textContent = a.name;
      this.slotAbil.querySelector('.ico').textContent = ABIL_ICON[a.id] || '⚡';
      this.slotAbil.querySelector('.cd').style.height = `${a.cd * 100}%`;
      this.slotAbil.querySelector('.cdt').textContent = a.cd > 0 && !a.active ? a.left : '';
      this.slotAbil.classList.toggle('active', a.active);
      this.slotAbil.style.setProperty('--ac', a.color);
    });
  }

  practice(on) { this.set('prac', on, (v) => this.pracEl.classList.toggle('hidden', !v)); }
  spectateBar(s) {
    const key = s ? `on|${s.name}` : 'off';
    this.set('spec', key, () => {
      this.specEl.classList.toggle('hidden', !s);
      if (s) this.specEl.querySelector('span').textContent = s.name ? `Spectating ${s.name}` : 'Spectate';
    });
  }
  specStep(d) { if (!this.game.spectate) this.game.startSpectate(); else this.game.nextSpectate(d); }
  bounty(b) {
    this.set('bounty', b ? `${b.name}|${b.me}` : '', () => {
      this.bountyEl.classList.toggle('hidden', !b);
      if (b) this.bountyEl.innerHTML = `<span class="sk">💀</span><div><div class="bh">Bounty</div><div class="bn">${b.me ? 'You have the bounty!' : esc(b.name)}</div></div>`;
    });
  }
  prompt(p) {
    this.set('prompt', p ? p.text : '', () => {
      this.promptEl.classList.toggle('hidden', !p);
      if (p) this.promptEl.innerHTML = `<span class="k">${this.tpad ? 'TAP' : 'E'}</span>${esc(p.text)}${p.price ? ` <i class="coin"></i>${p.price}` : ''}`;
    });
  }
  wheelTimer(secs) { this.set('wheel', secs > 0 ? 'wait' : 'ready', (v) => this.wheelBtn.classList.toggle('ping', v === 'ready')); this.wheelSecs = secs; }
  setAdButton(on, coins) { this.set('ad', on, (v) => { this.adBtn.classList.toggle('hidden', !v); this.layout(); this.adBtn.innerHTML = `▶ Watch ad: +${coins} ${coin}`; }); }

  toggleAfk() {
    const p = this.game.mine;
    const now = !(p && p.state.afk);
    this.game.net.send('afk', now);
    this.afkBtn.classList.toggle('on', now);
    this.toast(now ? 'AFK: you will sit out the next games' : 'Back in! You will join the next game', 'info');
  }

  tutorial(t) {
    if (!t) { this.tutEl.classList.add('hidden'); this.tutSkip.classList.add('hidden'); if (this.tutDone) { this.tutDone.remove(); this.tutDone = null; } return; }
    if (t.done) {
      this.tutEl.classList.add('hidden'); this.tutSkip.classList.add('hidden');
      if (this.tutDone) return;
      this.tutDone = h('div', 'tutdone', `<div class="td">${esc(t.text)}</div><button class="big">PLAY</button>`);
      this.tutDone.querySelector('button').onclick = () => { this.game.net.send('tutLeave'); this.tutDone.remove(); this.tutDone = null; this.overlayOpen = false; this.game.input.requestLock(); };
      this.overlayOpen = true;
      this.game.input.exitLock();
      this.root.appendChild(this.tutDone);
      return;
    }
    this.tutEl.classList.remove('hidden'); this.tutSkip.classList.remove('hidden');
    this.tutEl.querySelector('.tt').textContent = t.text;
    this.tutEl.querySelector('.ts').textContent = this.tpad ? (t.sub || '').replace(/Click \/ tap/g, 'Tap').replace(/Press SPACE/g, 'Tap JUMP').replace(/press E \/ DIVE/g, 'tap DIVE').replace(/Press R \/ the ability button/g, 'Tap ⚡') : (t.sub || '').replace(/Click \/ tap/g, 'Click').replace(/ \/ DIVE/g, '').replace(/ \/ the ability button/g, '');
    this.tutEl.classList.remove('pulse'); void this.tutEl.offsetWidth; this.tutEl.classList.add('pulse');
  }

  // ------------------------------------------------------------------ death screen (centre: Boxity's banners sit on the edges)
  deathCard(d) {
    if (this.deathEl) { this.deathEl.remove(); this.deathEl = null; }
    if (!d) { this.overlayOpen = false; return; }
    const el = h('div', 'death', `<div class="dt">Your slab exploded!</div>${d.by ? `<div class="db">Eliminated by <b>${esc(d.by)}</b></div>` : ''}<div class="dsub">You'll watch the rest of the match from the lobby.</div>`);
    const b = h('button', 'big wait', '...');
    b.onclick = () => d.onContinue();
    el.appendChild(b);
    this.deathBtn = b;
    this.deathEl = el;
    this.root.appendChild(el);
    this.game.input.exitLock();
  }
  deathCountdown(n) {
    const b = this.deathBtn;
    if (!b || !this.deathEl) return;
    b.textContent = n > 0 ? String(n) : 'CONTINUE';
    b.disabled = n > 0;
    b.classList.toggle('wait', n > 0);
  }
  showFps(on) {
    if (!on) { if (this.fpsEl) { this.fpsEl.remove(); this.fpsEl = null; cancelAnimationFrame(this.fpsRaf); } return; }
    if (this.fpsEl) return;
    this.fpsEl = h('div', 'fps', '');
    this.root.appendChild(this.fpsEl);
    let n = 0, t0 = performance.now();
    const tick = () => { n++; const t = performance.now(); if (t - t0 >= 500) { this.fpsEl.textContent = `${Math.round((n * 1000) / (t - t0))} FPS`; n = 0; t0 = t; } this.fpsRaf = requestAnimationFrame(tick); };
    this.fpsRaf = requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------------ menus
  open(id, opts = {}) {
    if (!this.menu) this.relock = !!(this.game && this.game.input.locked);
    if (id === 'store') { id = 'inventory'; opts.tab = 'shop'; }
    this.menu = id;
    this.tab = opts.tab || this.tabFor(id);
    this.game && this.game.input.exitLock();
    this.shade.classList.remove('hidden');
    document.body.classList.add('menu-open');
    this.render();
    this.ads.show('panel');
  }
  tabFor(id) { return { inventory: 'balls', career: 'career' }[id] || ''; }
  close() {
    this.menu = null;
    this.shade.classList.add('hidden');
    document.body.classList.remove('menu-open');
    this.shade.innerHTML = '';
    this.panelEl = null;
    this.ads.hide('panel');
  }

  panel(title, tabs, body, cls = '') {
    this.shade.innerHTML = '';
    const p = h('div', 'panel ' + cls);
    const head = h('div', 'phead');
    if (tabs) {
      const tb = h('div', 'tabs');
      for (const [id, label, icon] of tabs) {
        const b = h('button', 'tab' + (this.tab === id ? ' on' : ''), `${icon ? `<span class="ti">${icon}</span>` : ''}${label}`);
        b.onclick = () => { this.tab = id; this.sel = null; this.render(); };
        tb.appendChild(b);
      }
      head.appendChild(tb);
    } else head.appendChild(h('div', 'ptitle', title));
    const x = h('button', 'px', '✕'); x.onclick = () => this.close();
    head.appendChild(x);
    p.append(head, body);
    this.shade.appendChild(p);
    this.panelEl = p;
  }

  render() {
    const p = this.profile;
    if (!p || !this.menu) return;
    const fn = { inventory: () => this.renderInventory(p), quests: () => this.renderQuests(p), career: () => this.renderCareer(p), daily: () => this.renderDaily(p), wheel: () => this.renderWheel(p), settings: () => this.renderSettings() }[this.menu];
    if (fn) fn();
  }

  renderInventory(p) {
    const tabs = [['balls', 'Balls', '🏐'], ['abilities', 'Abilities', '⚡'], ['explosions', 'Explosions', '💥'], ['shop', 'Shop', '🛒']];
    const body = h('div', 'inv');
    if (this.tab === 'shop') { this.renderShop(p, body); this.panel('', tabs, body, 'wide'); return; }
    const kind = this.tab === 'balls' ? 'ball' : this.tab === 'abilities' ? 'ability' : 'boom';
    const list = kind === 'ball' ? BALLS : kind === 'boom' ? EXPLOSIONS : ABILITY_LIST;
    const owned = kind === 'ball' ? p.owned.balls : kind === 'boom' ? p.owned.booms : p.owned.abilities;
    const eq = kind === 'ball' ? p.eq.ball : kind === 'boom' ? p.eq.boom : p.eq.ability;
    if (!this.sel || !list.some((i) => i.id === this.sel)) this.sel = eq;
    const left = h('div', 'invl');
    const icon = (it) => kind === 'ball' ? `<img src="${ballIconURL(it.id)}">` : kind === 'boom' ? `<img src="${boomIcon(it.id)}">` : `<span class="ai" style="background:${it.color}">${ABIL_ICON[it.id]}</span>`;
    const tile = (it, own) => {
      const rar = RARITY[it.rarity] || { color: it.color || '#888' };
      const t = h('button', 'tile' + (own ? '' : ' un') + (this.sel === it.id ? ' sel' : '') + (eq === it.id ? ' eq' : ''), `${icon(it)}<span class="tn">${esc(it.name)}</span>`);
      t.style.setProperty('--rc', rar.color);
      t.onclick = () => { this.sel = it.id; this.render(); };
      return t;
    };
    const ownedList = list.filter((i) => owned.includes(i.id)), un = list.filter((i) => !owned.includes(i.id));
    const g1 = h('div', 'grid'); ownedList.forEach((i) => g1.appendChild(tile(i, true)));
    left.appendChild(g1);
    if (un.length) { left.appendChild(h('div', 'gh', 'Unowned')); const g2 = h('div', 'grid'); un.forEach((i) => g2.appendChild(tile(i, false))); left.appendChild(g2); }
    const it = list.find((i) => i.id === this.sel) || list[0];
    const own = owned.includes(it.id);
    const right = h('div', 'invr');
    const rar = RARITY[it.rarity];
    right.innerHTML = `<div class="big">${icon(it)}</div><div class="dn">${esc(it.name)}</div>${rar ? `<div class="dr" style="color:${rar.color}">${rar.label}</div>` : ''}<div class="dd">${esc(it.desc)}</div>${kind === 'ability' ? `<div class="dd small">Cooldown ${it.cd}s</div>` : ''}`;
    const b = h('button', 'act');
    if (eq === it.id) { b.textContent = 'EQUIPPED'; b.classList.add('on'); }
    else if (own) { b.textContent = 'EQUIP'; b.onclick = () => this.game.net.send('equip', { kind, id: it.id }); }
    else if (kind === 'ability') { b.innerHTML = `BUY ${coin}${it.price}`; b.classList.add('buy'); b.onclick = () => this.game.net.send('buyAbility', it.id); }
    else { b.textContent = kind === 'ball' ? 'Get it from Ball Packs' : 'Get it from Explosions Packs'; b.classList.add('dim'); b.onclick = () => { this.tab = 'shop'; this.render(); }; }
    right.appendChild(b);
    body.append(left, right);
    this.panel('', tabs, body, 'wide');
  }

  renderShop(p, body) {
    body.classList.add('shop');
    const wrap = h('div', 'packs');
    wrap.appendChild(h('div', 'gh', 'Packs'));
    const row = h('div', 'prow');
    for (const pack of Object.values(PACKS)) {
      const c = h('div', 'pcard');
      const cv = document.createElement('canvas'); cv.width = 180; cv.height = 250;
      drawPackArt(cv.getContext('2d'), pack, 180, 250);
      c.appendChild(cv);
      const odds = Object.entries(pack.odds).filter(([, w]) => w > 0).map(([k, w]) => `<span style="color:${RARITY[k].color}">${w}%</span>`).join(' ');
      c.appendChild(h('div', 'pn', esc(pack.name)));
      c.appendChild(h('div', 'pd', `${esc(pack.desc)}<br>${odds}`));
      const b = h('button', 'act buy', `OPEN ${coin}${pack.price}`);
      b.disabled = p.coins < pack.price;
      b.onclick = () => this.game.net.send('buyPack', pack.id);
      c.appendChild(b);
      row.appendChild(c);
    }
    wrap.appendChild(row);
    wrap.appendChild(h('div', 'gh', 'Abilities'));
    const ar = h('div', 'arow');
    for (const a of ABILITY_LIST) {
      const own = p.owned.abilities.includes(a.id);
      const c = h('div', 'acard', `<span class="ai" style="background:${a.color}">${ABIL_ICON[a.id]}</span><div><div class="pn">${esc(a.name)}</div><div class="pd">${esc(a.desc)}</div></div>`);
      const b = h('button', 'act' + (own ? ' on' : ' buy'), own ? (p.eq.ability === a.id ? 'EQUIPPED' : 'EQUIP') : `${coin}${a.price}`);
      b.onclick = () => own ? this.game.net.send('equip', { kind: 'ability', id: a.id }) : this.game.net.send('buyAbility', a.id);
      c.appendChild(b);
      ar.appendChild(c);
    }
    wrap.appendChild(ar);
    body.appendChild(wrap);
  }

  openPackConfirm(id) { this.open('inventory', { tab: 'shop' }); void id; }

  renderQuests(p) {
    const body = h('div', 'quests');
    p.quests.forEach((q, i) => {
      const done = q.prog >= q.goal;
      const r = h('div', 'q' + (q.claimed ? ' claimed' : ''));
      r.innerHTML = `<div class="ql">${esc(q.label)}</div><div class="qbar"><i style="width:${(q.prog / q.goal) * 100}%"></i><span>${q.prog}/${q.goal}</span></div><div class="qc">${coin}${q.coins}</div>`;
      const b = h('button', 'act small' + (done && !q.claimed ? ' buy' : ' dim'), q.claimed ? '✓' : 'CLAIM');
      b.disabled = !done || q.claimed;
      b.onclick = () => this.game.net.send('claimQuest', i);
      r.appendChild(b);
      body.appendChild(r);
    });
    const ref = h('button', 'act' + (p.questRefresh ? '' : ' dim'), 'Refresh');
    ref.disabled = !p.questRefresh;
    ref.onclick = () => this.game.net.send('refreshQuests');
    const now = new Date(), next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    body.appendChild(h('div', 'qfoot', `New quests in ${Math.floor((next - now) / 3600e3)}h ${Math.floor(((next - now) % 3600e3) / 60e3)}m`));
    body.appendChild(ref);
    this.panel('Daily Quests', null, body, 'narrow');
  }

  renderCareer(p) {
    const tabs = [['career', 'Career'], ['ach', 'Achievements'], ['titles', 'Titles']];
    const body = h('div', 'career');
    const st = p.stats;
    if (this.tab === 'career') {
      const rows = [['Wins', st.wins], ['Eliminations', st.elims], ['Saves', st.saves], ['Spikes', st.spikes], ['Perfect touches', st.perfects], ['Matches played', st.matches], ['Win streak', st.streak], ['Best win streak', st.bestStreak], ['Packs opened', st.packs], ['Time played', `${Math.floor((st.playSecs || 0) / 3600)}h ${Math.floor(((st.playSecs || 0) % 3600) / 60)}m`]];
      const g = h('div', 'stats');
      for (const [k, v] of rows) g.appendChild(h('div', 'stat', `<span>${k}</span><b>${v || 0}</b>`));
      body.appendChild(g);
    } else if (this.tab === 'ach') {
      for (const a of ACHIEVEMENTS) {
        body.appendChild(h('div', 'gh', `${a.title} <small>${st[a.stat] || 0}</small>`));
        const row = h('div', 'achrow');
        a.tiers.forEach((t, i) => {
          const have = (st[a.stat] || 0) >= t.n, claimed = p.ach.includes(`${a.stat}:${i}`);
          const c = h('div', 'ach' + (have ? ' have' : '') + (claimed ? ' claimed' : ''), `<div class="an">${esc(t.name)}</div><div class="ad">Reach ${t.n.toLocaleString()}</div><div class="ac">${coin}${t.coins}</div>`);
          if (have && !claimed) { const b = h('button', 'act small buy', 'CLAIM'); b.onclick = () => this.game.net.send('claimAch', { stat: a.stat, tier: i }); c.appendChild(b); }
          else if (claimed) c.appendChild(h('div', 'ok', '✓ Claimed'));
          row.appendChild(c);
        });
        body.appendChild(row);
      }
    } else {
      body.appendChild(h('div', 'gh', 'Wear a title above your name. Unlock titles with achievements.'));
      const g = h('div', 'titles');
      const none = h('button', 'title' + (!p.eq.title ? ' on' : ''), 'No title'); none.onclick = () => this.game.net.send('equip', { kind: 'title', id: '' }); g.appendChild(none);
      for (const a of ACHIEVEMENTS) for (const t of a.tiers) {
        const ok = titleUnlocked(st, t.name);
        const b = h('button', 'title' + (p.eq.title === t.name ? ' on' : '') + (ok ? '' : ' locked'), ok ? esc(t.name) : `🔒 ${esc(t.name)}`);
        if (ok) b.onclick = () => this.game.net.send('equip', { kind: 'title', id: t.name });
        g.appendChild(b);
      }
      body.appendChild(g);
    }
    this.panel('', tabs, body, 'wide');
  }

  renderDaily(p) {
    const body = h('div', 'daily');
    const day = p.login.day;
    DAILY_LOGIN.forEach((c, i) => {
      const state = i < day ? 'got' : i === day ? (p.login.claimable ? 'now' : 'next') : 'locked';
      const card = h('div', `dcard ${state}${i === 6 ? ' big' : ''}`, `<div class="dh">Day ${i + 1}</div><div class="dcoin">${'🪙'.repeat(i === 6 ? 3 : i > 2 ? 2 : 1)}</div><div class="dv">${c}</div>`);
      if (state === 'now') { const b = h('button', 'act small buy', 'CLAIM'); b.onclick = () => this.game.net.send('claimDaily'); card.appendChild(b); }
      else card.appendChild(h('div', 'ds', state === 'got' ? '✓' : state === 'next' ? 'Tomorrow' : 'Locked'));
      body.appendChild(card);
    });
    this.panel('Daily Login Rewards', null, body, 'mid');
  }

  renderWheel(p) {
    const body = h('div', 'wheelp');
    const cv = document.createElement('canvas'); cv.width = cv.height = 300;
    this.wheelCanvas = cv;
    this.drawWheel(this.wheelAngle || 0);
    const wrap = h('div', 'wwrap'); wrap.appendChild(cv); wrap.appendChild(h('div', 'wptr', '▼'));
    body.appendChild(wrap);
    const secs = this.wheelSecs ?? p.wheelIn;
    const b = h('button', 'act ' + (secs > 0 ? 'dim' : 'buy'), secs > 0 ? `Free spin in ${fmtTime(secs)}` : 'SPIN!');
    b.disabled = secs > 0 || this.spinning;
    b.onclick = () => { b.disabled = true; this.game.net.send('spin'); };
    body.appendChild(b);
    body.appendChild(h('div', 'qfoot', `A free spin every ${WHEEL_COOLDOWN / 60} minutes of play.`));
    this.panel('Prize Wheel', null, body, 'narrow');
    clearInterval(this.wheelTick);
    if (secs > 0) this.wheelTick = setInterval(() => { if (this.menu !== 'wheel') { clearInterval(this.wheelTick); return; } const s = this.wheelSecs; b.textContent = s > 0 ? `Free spin in ${fmtTime(s)}` : 'SPIN!'; if (s <= 0 && !this.spinning) { b.disabled = false; b.className = 'act buy'; } }, 1000);
  }

  drawWheel(angle) {
    const cv = this.wheelCanvas; if (!cv) return;
    const g = cv.getContext('2d'), n = WHEEL_PRIZES.length, R = 146, c = 150;
    g.clearRect(0, 0, 300, 300);
    g.save(); g.translate(c, c); g.rotate(angle);
    WHEEL_PRIZES.forEach((p, i) => {
      g.fillStyle = i % 2 ? p.c : shadeHex(p.c); g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2); g.fill();
      g.save(); g.rotate(((i + 0.5) / n) * Math.PI * 2); g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 4; g.font = 'bold 17px Fredoka, sans-serif'; g.textAlign = 'right'; g.strokeText(p.label, R - 10, 6); g.fillText(p.label, R - 10, 6); g.restore();
    });
    g.restore();
    g.lineWidth = 8; g.strokeStyle = '#fff'; g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(c, c, 18, 0, Math.PI * 2); g.fill();
  }

  wheelSpin(m) {
    if (this.menu !== 'wheel') this.open('wheel');
    const n = WHEEL_PRIZES.length;
    const target = -Math.PI / 2 - ((m.slice + 0.5) / n) * Math.PI * 2;
    let from = this.wheelAngle || 0, to = target;
    while (to < from + Math.PI * 8) to += Math.PI * 2;
    this.spinning = true;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 4000), e = 1 - Math.pow(1 - k, 3);
      this.wheelAngle = from + (to - from) * e;
      this.drawWheel(this.wheelAngle);
      if (k < 1) requestAnimationFrame(step);
      else {
        this.spinning = false;
        this.wheelAngle %= Math.PI * 2;
        this.game.audio.play('levelup');
        if (m.pack) this.packReveal(m.pack); else this.banner(`You won ${m.label}!`, '', 2400);
        this.render();
      }
    };
    requestAnimationFrame(step);
  }

  renderSettings() {
    const body = h('div', 'settings');
    const g = this.game;
    const slider = (label, val, fn) => { const r = h('label', 'srow', `<span>${label}</span>`); const i = h('input'); i.type = 'range'; i.min = 0; i.max = 100; i.value = Math.round(val * 100); i.oninput = () => fn(i.value / 100); r.appendChild(i); body.appendChild(r); };
    slider('Master volume', g.master, (v) => Bloxity.setSetting('master_volume', Math.round(v * 100)));
    slider('Music volume', g.musicVol, (v) => Bloxity.setSetting('music_volume', Math.round(v * 100)));
    slider('Camera sensitivity', g.settings.sens / 3, (v) => Bloxity.setSetting('camera_sensitivity', (Math.max(0.05, v) * 3).toFixed(2)));
    const q = h('div', 'srow', '<span>Graphics</span>');
    for (const lv of ['High', 'Low']) { const b = h('button', 'act small' + (g.settings.quality === lv ? ' on' : ''), lv); b.onclick = () => { Bloxity.setSetting('graphics_quality', lv); this.render(); }; q.appendChild(b); }
    body.appendChild(q);
    const t = h('button', 'act', 'Replay the tutorial');
    t.onclick = () => { this.close(); g.net.send('tutStart'); };
    body.appendChild(t);
    body.appendChild(h('div', 'qfoot', this.tpad ? 'Left: move · Right: look · HIT / JUMP / DIVE / ⚡' : 'WASD move · Mouse look (click to lock, Esc to free) · Click/F hit · Space jump · E or Shift dive · R ability · E use a stand · I inventory · J quests · C career · G store · H rewards · K wheel · O settings · L AFK · X exit practice · Z/Q spectate · 1/2 vote'));
    this.panel('Settings', null, body, 'narrow');
  }

  // ------------------------------------------------------------------ pack reveal
  packReveal(r) {
    const isBall = r.kind === 'ball';
    const list = isBall ? BALLS.filter((b) => b.id !== 'default') : EXPLOSIONS.filter((b) => b.id !== 'classic');
    const item = isBall ? BALL_BY_ID[r.item] : BOOM_BY_ID[r.item];
    const icon = (id) => (isBall ? ballIconURL(id) : boomIcon(id));
    const ov = h('div', 'reveal');
    const reel = h('div', 'reel');
    const N = 34, win = 30;
    for (let i = 0; i < N; i++) {
      const it = i === win ? item : list[Math.floor(Math.random() * list.length)];
      const c = h('div', 'rc', `<img src="${icon(it.id)}">`);
      c.style.setProperty('--rc', RARITY[it.rarity].color);
      reel.appendChild(c);
    }
    const strip = h('div', 'strip'); strip.appendChild(reel); strip.appendChild(h('div', 'rmark'));
    ov.appendChild(h('div', 'rt', esc(PACKS[r.pack].name)));
    ov.appendChild(strip);
    const res = h('div', 'rres hidden', `<img src="${icon(item.id)}"><div class="rn">${esc(item.name)}</div><div class="rr" style="color:${RARITY[item.rarity].color}">${RARITY[item.rarity].label}</div><div class="rd">${r.dup ? `Duplicate: +${r.refund} coins` : 'NEW!'}</div>`);
    res.style.setProperty('--rc', RARITY[item.rarity].color);
    const ok = h('button', 'act buy hidden', 'NICE!');
    const eqb = h('button', 'act hidden', 'EQUIP');
    ok.onclick = () => { ov.remove(); this.overlayOpen = false; };
    eqb.onclick = () => { this.game.net.send('equip', { kind: isBall ? 'ball' : 'boom', id: item.id }); ov.remove(); this.overlayOpen = false; };
    const btns = h('div', 'rbtns'); btns.append(eqb, ok);
    ov.append(res, btns);
    this.root.appendChild(ov);
    this.overlayOpen = true;
    this.game.input.exitLock();
    const cw = 110;
    requestAnimationFrame(() => {
      const offset = win * cw - (strip.clientWidth / 2 - cw / 2) + (Math.random() - 0.5) * 60;
      reel.style.transition = 'transform 3.4s cubic-bezier(.12,.75,.15,1)';
      reel.style.transform = `translateX(${-offset}px)`;
    });
    let ticks = 0;
    const tk = setInterval(() => { if (++ticks > 16) { clearInterval(tk); return; } this.game.audio.synth('zap', { vol: 0.25, size: -1 }); }, 150 + ticks * 20);
    setTimeout(() => {
      res.classList.remove('hidden'); ok.classList.remove('hidden'); if (!r.dup) eqb.classList.remove('hidden');
      this.game.audio.play(item.rarity === 'legendary' || item.rarity === 'epic' ? 'levelup' : 'ding');
    }, 3600);
  }
}

function shadeHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.round(v * 0.85));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
