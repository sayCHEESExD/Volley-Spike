// Game server entry: Colyseus (WebSocket) + Express (health, static client for local play).
// Bloxity injects PORT, CLIENT_ORIGIN, MONGODB_URI, BLOXITY_GAME_ID etc. at deploy time.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { defineServer, defineRoom, WebSocketTransport, matchMaker } from 'colyseus';
import { VolleyRoom } from './room.js';
import { ROOM_NAME } from '../shared/constants.js';
import { initProfiles, flush, takeStatDirty, requeueStats } from './profiles.js';
import { installStatReporter, installLeaderboardReporter } from './bloxity.js';
import { installRoomReporter } from './legion-room-reporter.js';
import { loadAvatarCatalog } from './avatarCatalog.js';
import { installBadges } from './badges.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'client', 'dist');
const PORT = Number(process.env.PORT || 2567);

await initProfiles();
loadAvatarCatalog(); // real Boxity outfits for CPU players (in the background)

const server = defineServer({
  transport: new WebSocketTransport({ maxPayload: 32 * 1024, pingInterval: 5000 }),
  rooms: { [ROOM_NAME]: defineRoom(VolleyRoom) },
  express: (app) => {
    app.get('/health', (req, res) => res.status(200).json({ ok: true }));
    app.get('/api/rooms', async (req, res) => {
      res.set('Access-Control-Allow-Origin', process.env.CLIENT_ORIGIN || '*');
      try {
        const rooms = await matchMaker.query({ name: ROOM_NAME });
        res.json(rooms.map((r) => ({ id: r.roomId, clients: r.clients, max: r.maxClients })));
      } catch { res.json([]); }
    });
    if (fs.existsSync(DIST)) {
      // Local play only: tell the page it runs in the 'local' Boxity environment (the
      // production image never serves the client; Boxity hosting serves it and injects its own).
      if (process.env.NODE_ENV !== 'production') {
        const LOCAL_ENV = { env: 'local', apiUrl: 'http://localhost:4000', playUrl: `http://localhost:${PORT}`, portalUrl: 'http://localhost:3000', staticUrl: 'https://static.bloxity.io' };
        app.get(['/', '/index.html'], (req, res) => {
          const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
            .replace('<head>', `<head><script>window.BLOXITY_ENV = ${JSON.stringify(LOCAL_ENV)};</script>`);
          res.set('Cache-Control', 'no-cache').type('html').send(html);
        });
      }
      app.use(express.static(DIST, {
        setHeaders: (res, file) => {
          if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
          else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }));
    }
  },
});

// Boxity reporting (each is a no-op without BLOXITY_REPORT_TOKEN / BLOXITY_GAME_ID).
const stats = installStatReporter({ collect: takeStatDirty, requeue: requeueStats });
const boards = installLeaderboardReporter();
installBadges();

// Deploys send SIGTERM: persist every profile before Colyseus disconnects players.
server.onBeforeShutdown(async () => {
  try {
    const rooms = await matchMaker.query({ name: ROOM_NAME });
    for (const r of rooms) {
      const room = matchMaker.getLocalRoomById?.(r.roomId);
      if (room && typeof room.saveAll === 'function') room.saveAll();
    }
  } catch (e) { console.warn('[shutdown] save failed', e.message); }
  await flush();
  await Promise.all([stats.flush(), boards.flush()]);
});

server.listen(PORT).then(() => {
  installRoomReporter();
  console.log(`[volley-spike] listening on :${PORT}${fs.existsSync(DIST) ? ' (serving client/dist)' : ''}`);
});
