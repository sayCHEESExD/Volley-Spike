---
gameSlug: volley-spike
hostingId: volley-spike
clientDir: client
buildCommand: npm run build
distDir: client/dist
multiplayer: true
roomSize: 6 # deployed as seatCap (hosting.bloxity.io/docs)
canDie: true
hasScore: true
rewards: true
badges: true
store: false
leaderboards:
  - id: weekly_wins
    label: Wins this week
    order: desc
    mode: best
    format: number
    reset: weekly
    submittedBy: server
  - id: weekly_elims
    label: Eliminations this week
    order: desc
    mode: best
    format: number
    reset: weekly
    submittedBy: server
rewardedAds:
  - placement: bonus-coins
    reward: 100 coins, server-verified token, once per 5 minutes per player
screenAds: [menu, lobby, results, panel]
notApplicable:
  gems: Nothing is sold (developer's decision); coins are earned in game only.
  store: Nothing is sold (developer's decision).
  partyApi: Hosted on Boxity and connected through the Boxity matchmaker, so party seating is automatic.
  playWithFriendsOwnRooms: Uses Boxity's matchmaker rooms (no own private-room logic).
---

# Boxity integration notes

- **hasScore** - two server-submitted boards: `weekly_wins` and `weekly_elims`.
- **Stats** (server-owned): Wins, Eliminations, Saves, Spikes, Coins, Best Win Streak.
- **rewards** - "Watch ad: +100 coins" under the left menu, only while `ads.isAvailable()`; the server verifies the
  token with Boxity and pays once per 5 minutes.
- **Screen ads** - `menu` on the title screen, `lobby` while connecting, `results` while the winner banner shows, `panel` while a menu is open. Layouts avoid
  every HUD element.
- **Badges** (server/badges.js, pictures in client/public/badges): Welcome, Graduate, First Boom, Last One Standing,
  Keeper, Hot Streak, Bomber, Champion. Decided from server-owned state only.
- **canDie: true** (confirmed by the developer) - being eliminated (your slab explodes) is a death. After the fall, a centred card shows who got you and a Continue button that counts down with `deathScreen.onCountdown`; only `respawn() === true` sends the player back to the lobby to spectate (server message `continue`). If the match ends first, the server sends `deathHide` and the game calls `deathScreen.hide()`. Boxity's Reset Character (`respawn_request`) stays instant.
- **Ad breaks** pause the frame loop and mute all audio. Rewarded ads pause screen-ad layout calls while pending and report each non-completed status.
- **Party / Play with friends / Open Rooms**: case A (hosted on Boxity, matchmaker via `Legion.SDK.net.resolveEndpoint`, SDK script tag before the game code, maxClients 6, next match in the same room, `?roomId=` resolved through `{playUrl}/v1/dir/<id>/list`, sign-in mid-game rejoins the same room). No own private rooms, so no `play_with_friends` feature registration.
- **Chat**: bubbles only (`chat.onMessage` + `attachBubble`, matched on the verified account id, `legion_` prefix stripped); honours the `enable_chat` setting. No chat box.
- **Settings** registered: master_volume, music_volume, camera_sensitivity, graphics_quality, fullscreen, enable_chat, show_fps.
- **Deploy** sends `roomSize: 6` (never seatCap); prod + opt-in stage matrix.
- **Emotes**: `registerFeature('emotes')`; Boxity's emote wheel plays clips on the avatar rig and replicates them.
- Room reporter for "Open Rooms": `server/legion-room-reporter.js` (no-op locally).
