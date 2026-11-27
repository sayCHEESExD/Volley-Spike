// Boxity platform integration (window.Legion.SDK), centralised in one module.
//  - init + registerFeature('emotes') + leaderboard.define run once, at boot
//  - one onUserChanged subscription is the auth source of truth (user never cached)
//  - one player.onEvent subscription fans out respawn / emote / chat events
//  - every Boxity URL comes from the told environment (env()), never from our hostname
// All calls are optional so the game still runs if the SDK is blocked.
import { GAME_ID, LEADERBOARDS } from '@shared/constants.js';

let sdk = null;
const call = (fn, fb) => { try { return sdk ? fn(sdk) : fb; } catch (e) { console.warn('[bloxity]', e); return fb; } };
const callAsync = async (fn, fb) => { try { return sdk ? await fn(sdk) : fb; } catch (e) { console.warn('[bloxity]', e); return fb; } };

const userListeners = new Set();
const eventListeners = new Map(); // event -> Set<cb>
const chatListeners = new Set();
const breakListeners = { start: new Set(), end: new Set() };
const reservedListeners = new Set();
const settingCbs = new Map(); // key -> Set<cb>
let lastUserId; // undefined until the first onUserChanged

const PROD_ENV = { env: 'prod', apiUrl: 'https://api.bloxity.io', playUrl: 'https://play.bloxity.io', portalUrl: 'https://bloxity.io', staticUrl: 'https://static.bloxity.io' };
const trim = (u) => String(u).replace(/\/+$/, '');

// The told environment. Before/without the SDK: window.BLOXITY_ENV, else prod.
export function env() {
  const told = call((s) => s.environment(), null) || (typeof window !== 'undefined' && window.BLOXITY_ENV) || null;
  const e = told && told.apiUrl ? told : PROD_ENV;
  return { env: e.env || 'prod', apiUrl: trim(e.apiUrl), playUrl: trim(e.playUrl), portalUrl: trim(e.portalUrl), staticUrl: trim(e.staticUrl) };
}

function attach() {
  if (sdk || !(window.Legion && window.Legion.SDK)) return !!sdk;
  sdk = window.Legion.SDK;
  call((s) => s.init({ gameSlug: GAME_ID }));
  // Boot-time declarations (must not wait for assets).
  call((s) => s.game.registerFeature('emotes'));
  call((s) => s.leaderboard.define(LEADERBOARDS));
  // The single auth subscription. Fires immediately, then on every login/logout.
  call((s) => s.auth.onUserChanged((u) => {
    const id = u ? u._id : null;
    const changed = lastUserId !== undefined && id !== lastUserId;
    lastUserId = id;
    for (const cb of userListeners) { try { cb(u || null, changed); } catch (e) { console.warn(e); } }
  }));
  // The single player-event subscription.
  call((s) => s.player.onEvent((event, data) => {
    const set = eventListeners.get(event);
    if (set) for (const cb of set) { try { cb(data); } catch (e) { console.warn(e); } }
  }));
  call((s) => s.ads.onBreakStart(() => { for (const cb of breakListeners.start) { try { cb(); } catch (e) { console.warn(e); } } }));
  call((s) => s.ads.onBreakEnd(() => { for (const cb of breakListeners.end) { try { cb(); } catch (e) { console.warn(e); } } }));
  call((s) => s.ui.onReservedAreasChange((areas) => { for (const cb of reservedListeners) { try { cb(areas); } catch (e) { console.warn(e); } } }));
  console.info('[bloxity] SDK init for', GAME_ID, '| env', env().env, '| embedded', Bloxity.embedded());
  return true;
}

export const Bloxity = {
  // The SDK <script> is blocking; if it was slow or blocked, retry briefly without holding up the game.
  init() {
    if (attach()) return Promise.resolve(true);
    return new Promise((resolve) => {
      let n = 0;
      const t = setInterval(() => { if (attach() || ++n > 40) { clearInterval(t); resolve(!!sdk); } }, 75);
    });
  },
  get available() { return !!sdk; },
  env,
  onEnvironmentChanged: (cb) => call((s) => s.onEnvironmentChanged(cb), null),

  // ---- auth (read live, never cached)
  onUser(cb) { userListeners.add(cb); if (sdk) { try { cb(call((s) => s.auth.getUser(), null), false); } catch (e) { console.warn(e); } } return () => userListeners.delete(cb); },
  user: () => call((s) => s.auth.getUser(), null),
  token: () => call((s) => s.auth.getToken(), null),
  guest: () => call((s) => s.auth.getGuest(), null),
  // Only for pages Boxity does not embed: inside Boxity the toolbar handles accounts.
  login: () => callAsync((s) => s.auth.showAuthPopup(), null),

  // ---- lifecycle / rooms
  loadingStep: (t) => call((s) => s.game.loadingStep(t)),
  loadingEnd: () => call((s) => s.game.loadingEnd()),
  gameplayStart: () => call((s) => s.game.gameplayStart()),
  gameplayEnd: () => call((s) => s.game.gameplayEnd()),
  updateRoom: (id) => call((s) => s.game.updateRoom(id || '')),
  playerJoined: (u) => u && call((s) => s.game.playerJoined(u)),
  playerInRoom: (u) => u && call((s) => s.game.playerInRoom(u)),

  // ---- matchmaker: seat on a pod; returns { endpoint, roomId (relay), cold }
  resolveEndpoint: (opts) => callAsync((s) => s.net.resolveEndpoint(GAME_ID, opts), null),

  // ---- player events ('respawn_request', 'play_emote', 'chat_message_sent', 'pointer_lock_changed')
  onEvent(event, cb) { if (!eventListeners.has(event)) eventListeners.set(event, new Set()); eventListeners.get(event).add(cb); return () => eventListeners.get(event).delete(cb); },

  // ---- chat (Boxity draws the chat UI; we only draw bubbles)
  onChat(cb) {
    chatListeners.add(cb);
    if (chatListeners.size === 1) call((s) => s.chat.onMessage((m) => { for (const c of chatListeners) { try { c(m); } catch (e) { console.warn(e); } } }));
    return () => chatListeners.delete(cb);
  },
  bubbleText: (m) => call((s) => s.chat.bubbleText(m), m && (m.isGif ? 'sent a GIF' : String(m.text || '').slice(0, 80))),
  attachBubble: (THREE, root, text, opts) => call((s) => s.chat.attachBubble(THREE, root, text, opts), null),
  get bubbleSeconds() { return call((s) => s.chat.bubbleSeconds, 4); },

  // ---- settings (string values). listen() also adds the control to the portal menu.
  listenSetting(key, cb) {
    if (!settingCbs.has(key)) settingCbs.set(key, new Set());
    settingCbs.get(key).add(cb);
    return call((s) => s.settings.listen(key, cb), null);
  },
  setSetting: (key, value) => {
    if (sdk) return call((s) => s.settings.set({ [key]: String(value) }));
    for (const cb of settingCbs.get(key) || []) cb(String(value)); // no SDK: apply locally
  },
  triggerAllSettings: () => call((s) => s.settings.triggerAll()),

  // ---- avatar
  equipped: () => call((s) => s.avatar.getEquipped(), null),
  proportions: () => call((s) => s.avatar.getProportions(), null),
  characterId: () => call((s) => s.avatar.getCharacterId && s.avatar.getCharacterId(), null),
  characterFor: (eq) => call((s) => (s.avatar.getCharacterFor ? s.avatar.getCharacterFor(eq) : null), null),
  accessoryMatrix: (ch, bone) => call((s) => (s.avatar.characterAccessoryMatrix ? s.avatar.characterAccessoryMatrix(ch, bone) : null), null),
  onAvatarChanged: (cb) => call((s) => s.avatar.onAvatarChanged(cb), null),
  onProportionsChanged: (cb) => call((s) => s.avatar.onProportionsChanged(cb), null),
  skinTextureUrl: () => call((s) => s.avatar.getSkinTextureUrl(), null),
  emoteCatalog: async () => {
    const viaSdk = await callAsync((s) => (s.avatar.getEmoteCatalog ? s.avatar.getEmoteCatalog() : null), null);
    if (Array.isArray(viaSdk) && viaSdk.length) return viaSdk;
    try { const r = await fetch(`${env().apiUrl}/v1/avatar/emotes`); const j = await r.json(); return Array.isArray(j?.emotes) ? j.emotes : []; } catch { return []; }
  },

  // ---- ads
  onBreak(start, end) { breakListeners.start.add(start); breakListeners.end.add(end); },
  adsAvailable: () => !!call((s) => s.ads.isAvailable(), false),
  showRewarded: (placement) => callAsync((s) => s.ads.showRewarded(placement), { status: 'disabled' }),
  adScreen: (type, opts) => call((s) => s.ads.screen(type, opts), null),
  hideAdScreen: () => call((s) => s.ads.hideScreen()),
  reservedAreas: () => call((s) => s.ui.reservedAreas(), []),
  onReservedAreas(cb) { reservedListeners.add(cb); cb(Bloxity.reservedAreas() || []); return () => reservedListeners.delete(cb); },

  // ---- leaderboards (scores are submitted by the server)
  openLeaderboard: (id) => !!call((s) => s.leaderboard.open(id), false),

  // ---- portal
  embedded: () => !!call((s) => s.portal.isEmbeddedInLegion(), false),
  // the 'fullscreen' setting: the portal toggles it when embedded, the page itself otherwise
  setFullscreen(on) {
    try {
      if (sdk) { call((s) => (on ? s.portal.requestFullscreen() : s.portal.exitFullscreen())); return; }
      if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } catch { /* needs a user gesture outside Boxity; harmless */ }
  },
  showMenu: () => call((s) => s.portal.showMenu(true)),

  // ---- death screen: Boxity runs the ad countdown; outside Boxity it is 0 at once
  deathShow() {
    const d = call((s) => (s.deathScreen ? s.deathScreen.show() : null), null);
    if (d) return d;
    return { onCountdown: (cb) => { cb(0); return () => {}; }, respawn: () => true, ready: Promise.resolve() };
  },
  deathHide: () => call((s) => s.deathScreen && s.deathScreen.hide()),
};

// Identity sent when joining. Signed-in players send their token (verified by the server).
// Guests use their Boxity guest id when there is one (so their progress can follow them when
// they sign in), otherwise a stable per-device id. Test override: ?name=…&pid=… (local only).
export function identity() {
  const u = Bloxity.user();
  const token = Bloxity.token();
  const g = Bloxity.guest();
  const gid = g && (g._id || g.id);
  let pid = null, name = null;
  try {
    pid = localStorage.getItem('vb_pid');
    if (!pid) { pid = 'g_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem('vb_pid', pid); }
    name = localStorage.getItem('vb_name');
    if (!name) {
      const a = ['Spiker', 'Bumper', 'Setter', 'Volley', 'Blocker', 'Noodle', 'Pickle', 'Waffle', 'Gizmo', 'Sprout'];
      name = a[Math.floor(Math.random() * a.length)] + Math.floor(10 + Math.random() * 90);
      localStorage.setItem('vb_name', name);
    }
  } catch { pid = 'g_' + Math.random().toString(36).slice(2, 14); name = 'Guest'; }
  if (gid && /^[A-Za-z0-9_-]{6,40}$/.test(String(gid))) pid = 'g_bx_' + gid;
  if (g && g.username) name = String(g.displayName || g.username).slice(0, 18);
  if (env().env === 'local') {
    const q = new URLSearchParams(location.search);
    if (q.get('name')) name = q.get('name').slice(0, 16);
    if (q.get('pid') && /^[A-Za-z0-9_-]{6,40}$/.test(q.get('pid'))) pid = 'g_' + q.get('pid');
  }
  return { pid, token: u && token ? token : null, name: (u && (u.displayName || u.username)) || name, username: u ? u.username : null, userId: u ? u._id : null };
}

// The player's current Boxity look, in the compact form the server replicates.
// Signed-in players: avatar.getEquipped() / getProportions(). Guests have no account avatar,
// so (as Cut a Rock does) read the guest's own Boxity avatar from auth.getGuest().avatar.
export function avatarPayload() {
  let eq = null, pr = null;
  if (Bloxity.user()) { eq = { ...(Bloxity.equipped() || {}) }; pr = Bloxity.proportions(); const ch = Bloxity.characterId(); if (ch && !eq.characterId) eq.characterId = ch; }
  else { const g = Bloxity.guest(); if (g && g.avatar) { eq = g.avatar; pr = g.avatar.proportions; } }
  const out = { eq: {}, pr: {} };
  for (const [k, v] of Object.entries(eq || {})) if (k.endsWith('Id') && v !== undefined && v !== null) out.eq[k] = String(v);
  for (const [k, v] of Object.entries(pr || {})) if (Number.isFinite(+v)) out.pr[k] = +v;
  return out;
}
