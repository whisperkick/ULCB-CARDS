# ULCB-CARDS

Boilerplate for a **2D reactive multiplayer card RPG** using:

- **Server:** Colyseus + authoritative combat/deck simulation
- **Client:** Phaser 3 + Colyseus state sync + tween-based feedback

## What is implemented

### Reactive (non-turn) combat

- Server simulation loop ticks every `100ms`.
- Monster auto-attacks every `3000ms` on the server.
- If player is idle, monster continues attacking.

### Mana system

- Each player has `mana` and `maxMana` in schema state.
- Server regenerates mana at `+1/sec` (capped by `maxMana`).

### Infinite deck logic (server-authoritative)

- Minimum deck size is `10`.
- Hand size is `5`.
- `drawPile` and `discardPile` are server-side only.
- When `drawPile` is empty, discard is shuffled and recycled into draw.

### Colyseus schema + room

- `server/src/schema/BattleState.ts`:
  - `CardSchema`
  - `PlayerSchema` (`hp`, `mana`, `hand`, etc.)
  - `MonsterSchema`
  - `BattleState`
- `server/src/rooms/BattleRoom.ts`:
  - Simulation update loop (`onUpdate`)
  - Mana regen + monster timer
  - `playCard` validation and damage flow
  - Deck/discard draw replacement behavior

### 2D client (animation-lite)

- `client/src/main.ts`:
  - Battle controller for Colyseus sync
  - UI manager for hand cards + mana bar
  - Tween feedback:
    - player lunge on card play
    - monster shudder on hit
    - screen shake + player fade flash on damage

## Run locally

Install dependencies:

```bash
npm install
```

Run server:

```bash
npm run dev:server
```

Run client:

```bash
npm run dev:client
```

Optional build check:

```bash
npm run build
```

## Environment

- Client expects Colyseus at `ws://localhost:2567` by default.
- Override with:
  - `VITE_COLYSEUS_ENDPOINT=ws://<host>:<port>`
