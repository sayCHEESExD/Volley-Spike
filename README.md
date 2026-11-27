# Volley Spike

Multiplayer bomb-volleyball for Bloxity (up to 6 players per server).

Everyone gets their own grass slab floating over the sea. Keep the ball off your slab: bump it (click), jump and
spike it (Space + click), dive for far balls (E) and use your ability (R). Where you look is where your hit goes.
If the ball lands on your slab it explodes and you're out; the rest reshuffle into a smaller rectangle. Last one
standing wins.

- **Lobby island**: pack stands (Ball, Deluxe Ball, Explosions), the prize wheel, top-wins / top-elims boards.
- **Practice court**: walk over the bridge to rally with CPU players; nobody is eliminated.
- **Tutorial**: new players learn toss, jump, spike, bump, dive and abilities, then win a gentle 4-player game.
- **Matches**: Solo or Duos vote during the intermission, a random round modifier, a bounty on the hottest player.
- **Progression**: coins, balls, explosion effects, abilities (Adrenaline, Magnet, Superspike, Curveball, Frozen),
  daily login calendar, daily quests, achievements and titles, career stats.

## Run locally

```bash
npm install
npm run build
npm start            # http://localhost:2567
```

`npm run dev` runs the server with watch plus Vite on :5173. `npm run test:mp` plays a full match with two headless
clients. Controls on phones (landscape): left thumb moves, right thumb looks, HIT / JUMP / DIVE / ability buttons.
