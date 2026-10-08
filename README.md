# Ronins-Path
I made a game and this is it lol
Entirely vibecoded it's pretty peak ngl. Opus 5.5 is very tuff.

=====================
The actual game:
https://harpermoor.github.io/Ronins-Path/
=====================
I appreciate all feedback. I want this game to be peak and I can't have alla the ideas myself.
=====================
## Recent updates

The main menu loads recent updates directly from `CHANGELOG.md` without caching the request. To publish an update, add a plain `- ` bullet under `## Unreleased`; the latest nonempty `## ` section is displayed automatically on the next page load. Keep sections newest-first. No build step or duplicated HTML list is needed. The `.nojekyll` marker keeps GitHub Pages serving the Markdown source unchanged.

## Combat controls

### Settings and custom controls

Open **Settings** from the main menu, the in-game Settings button, or **F10** (default). The journey pause menu also has a Settings button. Sound settings include master volume and mute. Graphics settings control decorative particles, ambient petals, screen-shake strength, full-screen flashes/impact effects, and the vignette; attack trails and gameplay indicators stay visible.

Every keyboard action has up to three editable bindings, including movement, combat, equipment/shrine navigation, pause shortcuts, co-op host controls, and duel rematch controls. Select a binding and press any supported keyboard key or mouse button, or use **Clear** to remove it. Escape is assignable; use **Cancel binding** to cancel capture. Shared bindings are allowed with a warning, and trigger all applicable actions in their active context. The attack binding retains tap-to-attack and hold-to-heavy behavior even when rebound to a keyboard key; immediate light attack has a separate binding. Aiming and pointer navigation remain mouse-driven. Browser and operating system shortcuts can intercept some keys.

Preferences apply immediately, persist separately from journey saves and match rules, and can be restored to defaults. Solo play pauses while Settings is open; online play continues with your movement and combat inputs released. The clickable Settings button remains available even if its shortcut is cleared. Controls described below are the defaults.

Press **C** or **middle mouse** to lock onto the nearest enemy within 550 units; press again to unlock. Locked aim tracks the target until it dies or moves beyond 650 units. Movement remains manual, and lock-on works in solo, co-op, and duels.

Close-range combat arts advance toward nearby enemies in your aim direction. All combat arts can absorb two hits without being interrupted (you still take damage); hammer arts retain their additional poise. Whirlwind Slash now reaches a wider area.

Red sweeps can be deflected, but require a tap within half the normal parry window; holding block will not stop them. Mikiri counters and successful red-sweep deflects trigger a brief full-screen impact effect.

After a solo death, resurrecting at a shrine fully heals surviving camp defenders, restores their posture, and returns them to their original camp positions. Defeated enemies stay dead. Death never removes EXP. In co-op, individual resurrections leave the shared encounter unchanged.

Journey difficulty also changes enemy tactics. Colton enemies react slowly, use short attack chains, and attack one at a time. Each higher tier improves reactions, defensive reads, and awareness of your openings. Hatamoto enemies flank and coordinate attacks in pairs; Daimyo and Buddha enemies can coordinate three attackers. These decisions use the world's seeded RNG; stat multipliers still apply.

After defeating the Ashen Daimyo, **John Java** descends from the heavens and grants a **Buddha form** with a golden glow. Its perfect parry window is **140 ms** and its perfect dodge window is **100 ms**. The blessing preserves normal guard-spam penalties and dodge invulnerability limits, persists through saving and New Game +, and is shared by the co-op party. Duels never receive the blessing's advantages. This reward is separate from the extreme difficulty named Buddha.

## Shrine and pause menus

**Buddha** is an extreme solo journey difficulty, far beyond Daimyo: enemies have **12x health, 10x posture, and 8x damage** relative to Kachi, with New Game+ multipliers applied on top. Select it under Journey difficulty before entering your journey.

Press **E** at a safe shrine to rest, upgrade skills, or fast travel to another discovered shrine. Skill points can only be spent through the shrine menu; the equipment skill tree is view-only elsewhere. Fast travel is blocked when enemies threaten either shrine and does not reset the shared world or other players.

The shrine menu separates **Sanctuary** (rest and skill upgrades) from **Fast Travel**, which shows destinations as cards with discovery and safety status. Additional destinations are paged rather than shrinking the menu. Buttons highlight on hover and react on press. Use **arrow keys** and **Enter**, or click, to navigate shrine and pause menus. **Escape** closes the menu; closing the shrine skill tree returns to the shrine menu. Both menus scale to fit smaller screens.

**Colton** is the easiest journey difficulty: enemies have reduced health, posture, and damage. Older saves and preferences using its former name automatically retain the same difficulty.

## Multiplayer relay

https://ronins-path-relay.onrender.com/

Online rooms use a hosted WebSocket relay instead of PeerJS or direct peer connections. The room's short **port ID** is a relay-side room identifier: every browser makes an outbound connection to the relay, which forwards messages between the host and guests. No router configuration or inbound port forwarding is required. The host browser remains authoritative for the co-op world and duel simulation.

### Run the game and relay locally

Install Node.js 20 or later, then run:

```sh
npm install
npm start
```

Open `http://localhost:3000`. The server serves the game and its WebSocket endpoint at `/ws`. `PORT` and `HOST` can be set for local environments. Other people outside your network cannot reach a local-only server unless it is deployed to a public host.

### Deploy a public relay

Deploy this repository as a Node web service on a host that supports WebSockets (the included `render.yaml` is a Render Blueprint). The service serves both the game and relay from one HTTPS origin; open that service URL, host a room, and share its generated invite link or port ID. The deployment platform forwards HTTPS/WebSocket traffic to the Node process port, so the host does not need to configure their home router.

If you keep using the GitHub Pages copy of the game, deploy the relay separately and enter its WebSocket URL (for example, `wss://your-service.example.com/ws`) in the **Relay server** field on both devices. Invite links include the relay URL automatically. The relay URL is also remembered in that browser.

Room IDs are temporary connection identifiers, not reserved TCP/UDP ports. Anyone who has the ID can attempt to join until the host starts the match; share it only with intended players. The relay forwards gameplay messages but does not run or persist game state.
