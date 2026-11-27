# Volley Spike

Bomb-volleyball party game for Bloxity, up to 6 per room: every player stands on their own grass slab; when the
ball lands on your slab it explodes and you are out; the remaining slabs reshuffle into a smaller rectangle until one
player (or Duos team) is left. Plain-JS ES modules, Three.js client, Colyseus 0.18 server.

The engine shell (Bloxity SDK bridge `client/src/bloxity.js`, matchmaker networking `client/src/net.js`, token auth,
profiles, avatar rig `client/src/render/boxity-rig.js`, badges, stat / leaderboard / room reporters, deploy) is
forked from `D:\Roblox Games\Fling Battle`. Do NOT use `Hoops` as a reference (the developer says it is buggy).

Reference video (an existing game, used for the genre, flow and HUD placement only):
`C:\Users\kavin\AppData\Local\Packages\Microsoft.ScreenSketch_8wekyb3d8bbwe\TempState\Recordings\20261127-0651-48.5903656.mp4`
(ffmpeg: `imageio_ffmpeg` in the user's Python). Names, logo, lobby layout, item names and art here are original.

## Commands

```bash
npm run build      # client (vite) + 12 MB size gate (~4.2 MB, 1.9 MB of it music)
npm start          # server on :2567, serves client/dist locally
npm run dev        # server (watch) + vite on :5173
npm run check      # node --check every server / shared / tools module
npm run test:mp    # two real clients + CPUs play a whole match on a spawned server (VBALL_FAST=1)
```

Env: `VBALL_FAST=1` (6 s intermission), `VBALL_DATA_DIR` (profile file store), `BOT_FILL` (CPU top-up, default 4).
Debug handle (local env only): `window.__game`. When the preview pane is hidden, rAF is throttled: drive frames with
`game.frame(dt)` from a MessageChannel loop.

## Rules

- Room `vball`, game id `volley-spike`, 6 per room (`MAX_PLAYERS`; sent as `roomSize` by deploy.yml, never seatCap). Port 2567.
- **Ball = closed-form flights** (`shared/ball.js`): the server sends `{p, v, a, t0, t1, land}` once per touch; every
  client evaluates it against the shared clock (`Net.serverTime`). No per-frame ball traffic, no jitter. A flight always
  lands exactly on `land`, inside an alive opponent's slab (`Match.launch`).
- **Touches are server-validated** (`Match.tryHit`): the client sends its swing time; the server searches the last
  `BALL.hitGrace` s of the flight against the player's reported body for reach / height. Ground = bump, airborne =
  spike, diving = save; height decides Perfect / Too low. Aim = camera yaw -> the alive opponent slab most in front.
- **Movement** is client-simulated (`shared/move.js`) and checked in `VolleyRoom.onMove` (speed, region clamp). On a
  court a player is held inside their slab (`region` sent with every `auth`). `seq` increments on every teleport;
  stale moves are ignored.
- **Slab formations** (`shared/world.js` `formation`/`rowsFor`): always a full rectangle; rows with fewer cells get
  wider cells (5 players = 3 + 2). Never a ragged or round footprint. Reshuffle keeps relative order (`Match.shuffle`).
- Map (seen from the spawn): five leaderboard boards along the front edge, the match arena (`main`) floating to the
  LEFT, the clay practice court (`prac`) to the RIGHT. The yellow Practice pad on the lobby's right edge teleports you
  onto it. Practice: ALL humans share slab 0, the other three slabs always hold CPUs; nobody is eliminated.
- Courts: `main`, `prac` and `tut` (one per learner, far east; scripted toss -> jump -> spike -> bump -> dive ->
  ability -> a 4-player game the learner cannot lose). One `Match` class runs all three.
- Match flow (`room.js` step): intermission + Solo/Duos vote while >= 1 eligible human (tutorial done, not AFK), then
  humans + CPUs (`BOT_FILL`) on slabs; random round modifier; bounty on the human with the best win streak.
  Eliminated players are back in the lobby after 1.7 s and can spectate (arrows / Q).
- Economy is server-only (`server/economy.js`): packs (Ball / Deluxe / Explosions), abilities bought with coins,
  7-day login calendar, 3 daily quests (+1 refresh/day), achievement tiers (= titles), prize wheel every 15 min of play.
  Nothing is sold for money.
- Grass surfaces use the supplied `client/public/textures/grass.png`. No trees/benches/fountains in the world.
- `client/src/bloxity.js` is the only module touching `window.Legion.SDK`. Nothing in the top-left HUD corner. Never
  bind P or Escape. See BLOXITY_CODE_METADATA.md.
- PC shortcuts (`UI.onKey`, only while no menu/overlay is open; a menu's own key closes it and re-locks the mouse):
  I inventory, J quests, C career, G store, H rewards, K wheel, O settings, L AFK, X exit practice, Z/Q spectate,
  1/2 vote, Space/Enter on the death card; in play LMB/F hit, Space jump, E/Shift dive, R ability, E use a stand.
  Key badges show on PC only. Never bind P or Escape.
- HUD scale: `UI.layout()` sets `--hud` (clusters) and `--tpad` (touch buttons) from the window size; each cluster
  scales from its own anchor. The left column and the status block never enter the top-left toolbar zone
  (300x64, or Boxity's reported reserved area when embedded).
