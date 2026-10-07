# Copilot instructions
After each prompt, let the user know what files were changed.

## Project structure and architecture

Ronin's Path is a browser game with no build step: `index.html` loads classic JavaScript files in dependency order, and their top-level declarations share the global scope. Keep that order correct when adding or moving scripts; later files rely on classes and constants defined earlier.

The single-player runtime is centered on `Game` in `js/game.js`. It owns the update/render loop and coordinates `Player`, `Enemy`, `World`, effects, input, and the equipment menu. `js/world.js` creates the seeded procedural world; `js/player.js` and `js/enemy.js` hold combat behavior; `js/draw.js` and `js/effects.js` provide canvas rendering and effects. The startup and online lobby screens are DOM in `index.html`, wired by `js/menu.js`; in-game HUDs and overlays are mostly drawn on the canvas.

Online play has two paths. `js/net.js` wraps WebSocket connections to the Node relay in `server/server.js`; short room IDs route messages without inbound router ports. The relay forwards gameplay messages but does not simulate or persist game state. `js/coop.js` uses the host as authority for shared world/enemy state. `js/duel.js` runs a deterministic, delayed-input simulation with periodic state correction. `js/settings.js` validates host-selected match rules. A change to synchronized state should be checked against the corresponding serialized/synchronized field lists and protocol version, not just the local gameplay code.

## Data and code conventions

- Save data is a compact snapshot, not a serialized world: `js/save.js` rebuilds the world from its seed, then applies progress. Validate and clamp persisted or received data before applying it. Bump `SAVE_VERSION` when changing the save format incompatibly.
- Equipment/loadout preferences and match settings use separate `localStorage` keys and have their own sanitization paths (`js/loadout.js`, `js/settings.js`); keep those concerns separate from journey progress.
- Procedural generation and duel synchronization depend on deterministic random/state evolution. Preserve seeded RNG use and deterministic update order in code that affects the world or multiplayer combat.
- Browser JavaScript uses `'use strict'`, semicolons, and browser-native globals rather than imports/exports or a package-managed module system. The Node relay uses CommonJS and the `ws` dependency. Shared helpers such as clamping, geometry, and seeded randomness live in `js/util.js`.
- Record user-visible changes as plain `- ` bullets under `## Unreleased` in `CHANGELOG.md`. The main-menu Recent updates panel loads the latest nonempty `## ` section from this file; do not maintain a separate list in HTML.

## Build, test, and lint

The browser game has no build step or configured lint script. Use Node.js 20 or later and run commands from the repository root:

```sh
npm install
npm start
npm test
```

`npm start` serves the game and WebSocket relay at `http://localhost:3000` (the server also accepts `HOST` and `PORT` environment variables). `npm test` runs these checks in sequence:

```sh
node tests/enemies.test.js
node tests/weapons.test.js
node tests/relay.test.js
node tests/changelog.test.js
```

Run one of those commands to target a single test file. Syntax-check an individual browser script with `node --check js/<file>.js`. Test fixtures are partial `Game` stand-ins, so guard new `Game` hooks called from `Enemy` or `Player` code.

For browser-level exploration, `.vscode/mcp.json` configures the Playwright MCP server. Start the local game with `npm start` and browse to `http://localhost:3000`.
