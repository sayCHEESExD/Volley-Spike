// Colyseus connection through Boxity's matchmaker. On EVERY connect we ask
// Legion.SDK.net.resolveEndpoint for a seat and build a NEW Client from the endpoint it
// returns (each endpoint is pinned to one pod). Never connects to <id>.host.bloxity.io.
//   - ?roomId=<colyseusRoomId> (Open Rooms "Join", friend / CrazyGames invites): the room's
//     pod is found in {playUrl}/v1/dir/<id>/list, then joined through its relay.
//   - signing in mid-game: rejoin the SAME room by id through its relay.
//   - unexpected disconnect: resolve again and rejoin.
// The 'local' environment (told by the dev server) falls back to a direct connection.
import { Client, Callbacks } from '@colyseus/sdk';
import { ROOM_NAME, GAME_ID } from '@shared/constants.js';
import { Bloxity, env } from './bloxity.js';

const wsOf = (httpUrl) => httpUrl.replace(/^http/i, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let deepLinkUsed = false;

export class Net {
  constructor() {
    this.handlers = {};
    this.room = null;
    this.relayRoomId = null; // the matchmaker's relay room (pins the pod)
    this.clockOffset = null;
  }
  on(type, fn) { (this.handlers[type] ||= []).push(fn); }
  emit(type, ...a) { for (const fn of this.handlers[type] || []) fn(...a); }

  // One seat from the matchmaker -> { endpoint, relayRoomId }
  async seat() {
    const e = env();
    if (Bloxity.available) {
      try {
        const r = await Bloxity.resolveEndpoint();
        if (r && r.endpoint) return { endpoint: r.endpoint, relayRoomId: r.roomId || null };
      } catch (err) { if (e.env !== 'local') throw err; }
    }
    if (e.env === 'local') return { endpoint: wsOf(e.playUrl), relayRoomId: null };
    throw new Error('Boxity matchmaker unavailable');
  }

  // Look a Colyseus room id up in the cross-pod directory -> { joinUrl, colyseusRoomId } | null
  async locate(roomId) {
    const e = env();
    if (e.env === 'local') return { joinUrl: wsOf(e.playUrl), colyseusRoomId: roomId };
    try {
      const r = await fetch(`${e.playUrl}/v1/dir/${encodeURIComponent(GAME_ID)}/list`, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return null;
      const j = await r.json();
      const room = (j.rooms || []).find((x) => x.colyseusRoomId === roomId || x.relayRoomId === roomId);
      if (!room || room.locked || (room.maxPlayers && room.players >= room.maxPlayers)) return null;
      return { joinUrl: room.joinUrl || `${wsOf(e.playUrl)}/v1/ws/${room.relayRoomId}`, colyseusRoomId: room.colyseusRoomId, relayRoomId: room.relayRoomId };
    } catch { return null; }
  }

  async connect(opts, onStatus = () => {}) {
    this.playUrl = env().playUrl; // the matchmaker this connection belongs to
    // 1) a room picked on Boxity's page / an invite
    const wanted = !deepLinkUsed && new URLSearchParams(location.search).get('roomId');
    deepLinkUsed = true;
    if (wanted && /^[A-Za-z0-9_-]{4,64}$/.test(wanted)) {
      onStatus('Joining your friends…');
      const loc = await this.locate(wanted);
      if (loc) {
        try {
          const room = await new Client(loc.joinUrl).joinById(loc.colyseusRoomId, opts);
          this.relayRoomId = loc.relayRoomId || null;
          this.attach(room);
          return room;
        } catch (e) { console.warn('[net] invited room unavailable, matchmaking instead', e && e.message); }
      }
    }
    // 2) normal matchmaking, retried with backoff (a cold start can take ~45 s)
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      try {
        onStatus(attempt ? `Server is waking up… (retry ${attempt})` : 'Finding a server…');
        const { endpoint, relayRoomId } = await this.seat();
        const room = await new Client(endpoint).joinOrCreate(ROOM_NAME, opts);
        this.relayRoomId = relayRoomId;
        this.attach(room);
        return room;
      } catch (e) {
        console.warn('[net] connect failed', e && e.message);
        if (Date.now() - started > 60000) throw e;
        await sleep(Math.min(8000, 700 * 2 ** Math.min(attempt, 4)));
      }
    }
  }

  // Signed in mid-game: move this player into the SAME room with the new identity.
  async rejoinSame(opts) {
    const old = this.room;
    if (!old) return this.connect(opts);
    const e = env();
    const url = e.env === 'local' || !this.relayRoomId ? (await this.locate(old.roomId))?.joinUrl : `${wsOf(e.playUrl)}/v1/ws/${this.relayRoomId}`;
    const join = () => new Client(url).joinById(old.roomId, opts);
    const leaveOld = async () => { this.leaving = true; try { await old.leave(true); } catch { /* already gone */ } };
    let room = null;
    if (url) {
      // join first (so the room can't empty out and close), then drop the old seat;
      // if the room is full, free our old seat and try once more
      try { room = await join(); await leaveOld(); }
      catch { await leaveOld(); try { room = await join(); } catch (err) { console.warn('[net] same-room rejoin failed', err && err.message); } }
    }
    if (!room) { await leaveOld(); return this.connect(opts); }
    this.attach(room);
    return room;
  }

  attach(room) {
    this.leaving = false;
    this.room = room;
    this.id = room.sessionId;
    this.cb = Callbacks.get(room);
    room.onMessage('s', (snap) => {
      if (room !== this.room) return;
      snap.time = snap.t;
      const now = performance.now() / 1000;
      const off = snap.time - now;
      if (this.clockOffset === null || off > this.clockOffset) this.clockOffset = this.clockOffset === null ? off : this.clockOffset + (off - this.clockOffset) * 0.5;
      else this.clockOffset += (off - this.clockOffset) * 0.02;
      this.emit('snapshot', snap);
    });
    room.onMessage('*', (type, msg) => { if (type !== 's' && room === this.room) this.emit('msg:' + type, msg); });
    room.onLeave((code) => { if (room === this.room && !this.leaving) this.emit('leave', code); });
    room.onError((code, m) => console.warn('[net] room error', code, m));
  }

  serverTime() { return this.clockOffset === null ? 0 : performance.now() / 1000 + this.clockOffset; }
  send(type, data) { try { this.room && this.room.send(type, data); } catch { /* socket closed */ } }
}
