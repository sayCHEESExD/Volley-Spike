// Replicated room state (low-frequency). Positions go through the 's' snapshot message and
// the ball through closed-form flight messages instead.
import { schema, t } from '@colyseus/schema';

export const Player = schema({
  name: t.string(),
  uname: t.string(),
  uid: t.string(), // verified Boxity account id ('' for guests) - chat bubbles match on it
  av: t.string(), // Boxity avatar (equipped ids + proportions) as compact JSON
  wins: t.uint32(),
  title: t.string(),
  loc: t.string(), // 'lobby' | 'practice' | 'match' | 'tutorial'
  bot: t.boolean(),
  afk: t.boolean(),
  ability: t.string(),
}, 'Player');

export const State = schema({
  players: t.map(Player),
  phase: t.string(), // 'wait' (intermission + vote) | 'match'
  endsAt: t.float64(), // server time the intermission ends
  solo: t.uint8(), // votes
  duos: t.uint8(),
  mode: t.string(),
  board: t.string(), // JSON: lobby leaderboard boards
}, 'State');
