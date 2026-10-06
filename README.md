# Ronins-Path
I made a game and this is it lol
Entirely vibecoded it's pretty peak ngl. Opus 5.5 is very tuff.

=====================
The actual game:
https://harpermoor.github.io/Ronins-Path/
=====================
I appreciate all feedback. I want this game to be peak and I can't have alla the ideas myself.
=====================
## The long dusk overhaul

The whole journey now takes place in an original dark-fantasy realm, not just a new menu. Explore the Gloam Weald, Withered March, and Pilgrim Graves through ash, fog, tombstones, ruined chapels, and golden shrines. Plated armor, shields, mantles, renamed gear, stamina combat, and recoverable death echoes reshape the adventure.

Five oathbound lords—Veyr, the Veiled Knight; Mourn, the Bell Warden; Seris of the Thorn Oath; Aster, the Fallen Crown; and the Hollow Prior—stand before the Cinder Regent. Lords have one health bar, die when it empties, and enter a second phase at half health with new attacks. Criticals deal 30% of their maximum HP (20% for backstabs), rather than refilling boss lives.

## Combat controls

| Input | Action |
| --- | --- |
| WASD / arrows; mouse | Move; aim |
| Click LMB / J | Light attack |
| Hold LMB | Heavy strike |
| RMB / K | Hold to guard; tap at the right moment to parry |
| Space / L | Tap to roll; hold while moving to sprint |
| C / middle mouse | Toggle lock-on |
| Q | Drink an Amber Flask |
| R | Weapon art (requires art focus and 25 stamina) |
| F | Wraith Step (full resolve) |
| G | Crownfall (learned skill, full resolve) |
| T | Throwing weapon |
| E | Rest, reclaim fallen echoes, or respawn |
| Tab; Esc | Equipment and skills; pause and full controls |

You start with **100 stamina**. Attacks, rolls, sprinting, and blocking spend it; lower your guard to recover faster. Light attacks cost 16 stamina for swords, 18 for spears, 28 for hammers, and 22 for axes; finishers cost 1.25× and heavy strikes 1.65×. Rolls cost 24; critical attacks cost 20. Sprinting drains 22 per second; recovery is 32 per second after a delay, reduced while guarding.

Backstabs require positioning behind the target, including in co-op. Duel criticals remove 60% of maximum health rather than instantly killing a full-health opponent.

Commit to your swings: windups cannot be canceled, and another action can interrupt only after 65% of recovery. Light armor gives faster rolls with longer invincibility; heavy plate does the opposite. Rolling without movement backsteps; it no longer automatically counters thrusts. Red attacks usually need evasion, though red sweeps allow a narrowly timed parry—not a held block.

Lock-on selects the nearest enemy within 550 units and tracks it until death or beyond 650 units. Movement remains manual. The same stamina combat and lock-on work in solo, co-op, and duels.

## Shrines, echoes, and progress

Rest at a **safe shrine** with E to restore health, flasks, throwing weapons, stamina, and weapon-art focus. Ordinary foes return; defeated lords stay dead. Learn skills through Tab while at a safe shrine.

Death drops **all currently unconverted experience, displayed as echoes**, at one fall site. Earned skill points and learned skills remain safe. Return within 65 units and press E to reclaim the echoes once. Any second death replaces the old fall site—even if you die with zero echoes—so retrieve them before falling again.

Reloading directly after death performs the shrine respawn, restoring weapon-art focus and reviving ordinary foes.

Reset Map keeps held echoes, gear, and skills but abandons fallen echoes. Save version 4 preserves stamina and the fall site; older version 1–3 saves remain supported, with existing equipment IDs and world layouts preserved. In co-op, each player's death echoes are local session state; the host saves only their own. The host controls shared foe revival, including valid guest shrine rests.

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

**Redeploy the hosted relay alongside the updated client.** This overhaul uses multiplayer protocol **12** in both `js/net.js` and `server/server.js`; older clients are rejected, and the updated client cannot use an older relay.
