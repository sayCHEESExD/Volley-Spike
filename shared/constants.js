// Shared tuning. Server and client both import this file, so a number changed here
// changes behaviour on both sides at once. Units are metres and seconds.

export const GAME_TITLE = 'Volley Spike';
export const GAME_ID = 'volley-spike'; // Boxity game id (hosting id) and SDK gameSlug
export const ROOM_NAME = 'vball';
export const MAX_PLAYERS = 6; // the Colyseus room's maxClients (SEAT_CAP in .github/workflows/deploy.yml)

// ---- network
export const TICK_HZ = 60; // server simulation
export const SNAP_HZ = 20; // player snapshots
export const INTERP_DELAY = 0.1; // remote players are drawn this far behind the server clock

// ---- the player (client-simulated, server-validated)
export const MOVE = {
  speed: 10.5,
  accel: 80,
  airAccel: 26,
  gravity: 24,
  jump: 8.6,
  radius: 0.45,
  height: 1.95,
  maxSpeedCheck: 26, // server: horizontal m/s allowed (adrenaline + dive + slack)
};

export const DIVE = { speed: 18, time: 0.32, prone: 0.42, cooldown: 2.2 };

// ---- the ball
export const BALL = {
  radius: 0.6,
  gravity: 17, // base downward acceleration (round modifiers scale it)
  bumpTime: 1.85, // seconds of flight for a bump (lob) across one slab
  bumpPerMetre: 0.022, // extra seconds per metre of distance
  spikeTime: 1.1,
  spikePerMetre: 0.012,
  weakTime: 2.25, // a "Too low" hit floats
  tossHeight: 4.2, // the serve toss, above the server's head
  serveWait: 7, // seconds before the server auto-tosses
  // where a player can touch the ball: a capsule around the body, measured from the feet
  reach: 3.4, // horizontal
  reachLow: -0.4, // lowest point above the feet (diving: 0)
  reachHigh: 4.4, // highest point above the feet on the ground
  reachHighAir: 5.6, // when airborne (spike)
  perfectLow: 0.9, // sweet spot (height above the feet)
  perfectHigh: 3.0,
  tooLow: 0.1, // contact below this is "Too low" (a weak pop-up)
  hitGrace: 0.4,
  swingBuffer: 0.6, // a click that is a little early keeps trying on the server this long // server accepts a touch the client saw up to this long ago
  landPad: 0.02,
};

// ---- slabs / arena
export const SLAB = {
  size: 12, // metres per player cell
  gap: 0.22, // the white line between slabs
  depth: 5, // block height (top at y = 0)
  breakTime: 0.55, // slab flashes red this long before it explodes
  shuffleTime: 1.4, // remaining slabs glide into the new formation
};

// ---- match flow
export const FLOW = {
  intermission: 20, // seconds between matches (mode vote runs during it)
  minHumans: 1, // a match starts when this many humans are in the lobby
  countdown: 5, // "Game starting in N"
  postElim: 2.2, // pause after an elimination before the shuffle
  postShuffle: 1.1,
  winnerShow: 5,
  botFill: 4, // top a match up with bots to this many players
};

// round modifiers (one picked per match, shown under the status line)
export const MODIFIERS = [
  { id: 'classic', label: 'Classic', gravity: 1, speed: 1, spike: 1 },
  { id: 'heavy', label: '+20% Gravity', gravity: 1.2, speed: 1, spike: 1 },
  { id: 'floaty', label: '-20% Gravity', gravity: 0.8, speed: 0.92, spike: 1 },
  { id: 'fast', label: '+15% Ball Speed', gravity: 1, speed: 0.87, spike: 1 },
  { id: 'spiky', label: '+25% Spike Power', gravity: 1, speed: 1, spike: 0.8 },
];

// ---- abilities (key R). cd = cooldown seconds, dur = active seconds
export const ABILITIES = {
  adrenaline: { name: 'Adrenaline', desc: 'Boost your speed, spikes and dives for a short time.', cd: 22, dur: 4, price: 0, color: '#ff4a6e' },
  magnet: { name: 'Magnet', desc: 'Reach balls from much further away for 5 seconds.', cd: 26, dur: 5, price: 600, color: '#9b6bff' },
  superspike: { name: 'Superspike', desc: 'Your next hit flies twice as fast.', cd: 24, dur: 8, price: 900, color: '#ff9a1f' },
  curveball: { name: 'Curveball', desc: 'Your next hit bends sideways in the air.', cd: 20, dur: 8, price: 750, color: '#21c7a8' },
  frozen: { name: 'Frozen', desc: 'Your next hit slows the ball for the receiver... then it drops fast.', cd: 26, dur: 8, price: 1200, color: '#5fd4ff' },
};
export const ADRENALINE_SPEED = 1.55;

// ---- economy / progression
export const REWARD = { elim: 14, win: 60, play: 8, save: 1, bounty: 25, perfect: 0 };
export const PACK_DUP_REFUND = 0.25; // share of the pack price back for a duplicate
export const DAILY_LOGIN = [30, 50, 80, 150, 300, 500, 800];
export const WHEEL_COOLDOWN = 15 * 60; // seconds of play between free spins
export const QUEST_REFRESH_COOLDOWN = 20 * 3600;

// ---- Boxity platform features
export const AD_REWARD = { coins: 100, cooldown: 300, placement: 'bonus-coins' };
export const LEADERBOARDS = [
  { id: 'weekly_wins', label: 'Wins this week', order: 'desc', mode: 'best', format: 'number', reset: 'weekly' },
  { id: 'weekly_elims', label: 'Eliminations this week', order: 'desc', mode: 'best', format: 'number', reset: 'weekly' },
];

// Avatar slots replicated to other players (Boxity equipped ids) and proportion ranges.
export const AVATAR_SLOTS = ['hatId', 'backId', 'skinId', 'headId', 'armLId', 'armRId', 'legLId', 'legRId', 'torsoId', 'hairId', 'maskId', 'neckId', 'chestId', 'waistId', 'handId', 'shoesId', 'faceId', 'pantsId', 'shirtId', 'characterId'];
export const PROPORTIONS = {
  height: [0.5, 1.6], shoulderWidth: [0.5, 1.5], armLength: [0.05, 3], legOffsetX: [-0.7, 5],
  torsoScaleX: [0.3, 2], neckHeight: [0.94, 1.2], headScale: [0.3, 2.6],
};

const envNum = (k) => (typeof process !== 'undefined' && process.env && process.env[k] !== undefined ? Number(process.env[k]) : NaN);
export const BOT_FILL = Number.isFinite(envNum('BOT_FILL')) ? envNum('BOT_FILL') : FLOW.botFill;
export const FAST_FLOW = typeof process !== 'undefined' && process.env && process.env.VBALL_FAST === '1';
