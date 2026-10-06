# Ronins-Path
I made a game and this is it lol
Entirely vibecoded it's pretty peak ngl. Opus 5.5 is very tuff.

=====================
The actual game:
https://harpermoor.github.io/Ronins-Path/
=====================
I appreciate all feedback. I want this game to be peak and I can't have alla the ideas myself.
=====================
## Combat controls

Press **C** or **middle mouse** to lock onto the nearest enemy within 550 units; press again to unlock. Locked aim tracks the target until it dies or moves beyond 650 units. Movement remains manual, and lock-on works in solo, co-op, and duels.

Close-range combat arts advance toward nearby enemies in your aim direction. All combat arts can absorb two hits without being interrupted (you still take damage); hammer arts retain their additional poise. Whirlwind Slash now reaches a wider area.

Red sweeps can be deflected, but require a tap within half the normal parry window; holding block will not stop them. Mikiri counters and successful red-sweep deflects trigger a brief full-screen impact effect.

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
