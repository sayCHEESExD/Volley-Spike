import './ui/style.css';
import { Bloxity, identity, avatarPayload, env } from './bloxity.js';
import { Net } from './net.js';
import { UI } from './ui/ui.js';
import { Audio } from './audio.js';
import { Game } from './game/game.js';

const loading = document.getElementById('loading');
const statusEl = loading.querySelector('.status-l');
const barEl = loading.querySelector('.bar i');
const status = (t, p) => { statusEl.textContent = t; if (p !== undefined) barEl.style.width = `${p}%`; Bloxity.loadingStep(t); };

async function boot() {
  await Bloxity.init(); // must be up before the first matchmaker request
  status('Starting...', 10);
  const net = new Net();
  const ui = new UI(document.getElementById('ui'));
  const audio = new Audio();
  const game = new Game(document.getElementById('game'), net, ui, audio);
  ui.attach(game);
  status('Building the islands...', 30);
  await game.init();
  if (env().env === 'local') window.__game = game; // debugging handle (local only)

  const joinOptions = () => {
    const id = identity();
    return { opts: { pid: id.pid, token: id.token, name: id.name, avatar: avatarPayload() }, userId: id.userId };
  };
  let joinedAs = null;
  const enter = async (room) => {
    const welcome = await new Promise((resolve) => {
      if (net.pendingWelcome) { resolve(net.pendingWelcome); return; }
      net.welcomeWaiter = resolve;
    });
    net.pendingWelcome = null;
    game.bindRoom(room, welcome);
    Bloxity.updateRoom(room.roomId);
  };
  net.on('msg:welcome', (w) => { if (net.welcomeWaiter) { const r = net.welcomeWaiter; net.welcomeWaiter = null; r(w); } else net.pendingWelcome = w; });

  status('Connecting...', 60);
  ui.ads.show('lobby', loading.firstElementChild);
  let j = joinOptions();
  const room = await net.connect(j.opts, (t) => status(t));
  joinedAs = j.userId;
  status('Joining...', 85);
  await enter(room);

  Bloxity.onUser(async (user, changed) => {
    const uid = user ? user._id : null;
    if (!changed || uid === joinedAs || !net.room) return;
    j = joinOptions();
    joinedAs = j.userId;
    ui.toast(user ? `Signed in as ${user.displayName || user.username}` : 'Signed out', 'info');
    try { await enter(await net.rejoinSame(j.opts)); } catch (e) { console.warn('[boot] rejoin failed', e); }
  });
  Bloxity.onEnvironmentChanged(async () => {
    if (!net.room || env().playUrl === net.playUrl) return;
    const old = net.room;
    net.leaving = true;
    try { await old.leave(true); } catch { /* already gone */ }
    try { j = joinOptions(); await enter(await net.connect(j.opts)); } catch (e) { console.warn('[boot] reconnect after environment change failed', e); }
  });
  net.on('leave', async (code) => {
    if (code === 1000) return;
    ui.toast('Connection lost - rejoining...', 'warn');
    for (let i = 0; i < 4; i++) {
      try { j = joinOptions(); await enter(await net.connect(j.opts)); ui.toast('Reconnected', 'good'); return; } catch (e) { console.warn('[boot] reconnect failed', e); }
    }
    loading.classList.remove('done', 'ready');
    status('Lost connection - reloading...', 50);
    Bloxity.gameplayEnd();
    setTimeout(() => location.reload(), 1500);
  });

  let last = performance.now();
  const loop = (now) => {
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)) || 0; // rAF stamps can precede last
    last = now;
    try { game.frame(dt); } catch (e) { console.error(e); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  status('Ready!', 100);
  Bloxity.loadingEnd();
  loading.classList.add('ready');
  ui.ads.show('menu', loading.firstElementChild);
  const play = () => {
    ui.ads.hide('menu');
    loading.classList.add('done');
    audio.unlock();
    game.applyVolumes();
    game.input.requestLock();
    Bloxity.gameplayStart();
    if (game.profile && game.profile.tut) ui.toast(game.input.touch ? 'Left side: move · right side: look · HIT the ball before it lands on your slab!' : 'WASD to move · click to hit · Space jump · E dive · R ability', 'info');
  };
  loading.querySelector('.play').addEventListener('click', play, { once: true });
  game.input.onLockChange = (locked) => {
    if (locked || ui.isMenuOpen() || !loading.classList.contains('done')) return;
    if (Bloxity.embedded() && document.hasFocus()) Bloxity.showMenu();
  };
}

boot().catch((e) => {
  console.error(e);
  status('Could not start the game: ' + (e && e.message ? e.message : e), 100);
});
