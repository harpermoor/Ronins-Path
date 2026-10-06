# Changelog

## Unreleased

- Overhauled the full journey into an original dark-fantasy realm: the Gloam Weald, Withered March, and Pilgrim Graves feature ash, fog, jagged canopies, tombstones, ruined chapels, and golden shrines. Reworked the opening screen, world palette, plated characters, shields, mantles, and equipment names.
- Added shared stamina combat for solo, co-op, and duels: attacks, rolls, sprinting, guards, and weapon arts consume stamina; armor weight changes roll speed and invincibility. Attack windups cannot be canceled, with cancels available only after 65% of recovery. Stationary rolls backstep instead of automatically countering thrusts.
- Critical attacks cost 20 stamina, and backstabs require actual rear positioning, including for co-op guests. Duel criticals remove 60% of maximum health instead of instantly killing full-health players.
- Replaced the old lord roster with Veyr, the Veiled Knight; Mourn, the Bell Warden; Seris of the Thorn Oath; Aster, the Fallen Crown; the Hollow Prior; and the final Cinder Regent. Lords now use a single health bar, die on HP depletion, and unlock new attacks in a second phase at half health. Criticals remove 30% of maximum lord HP (20% for backstabs).
- Safe shrine rests restore health, Amber Flasks, throwing weapons, stamina, and weapon-art focus, while reviving ordinary foes but not defeated lords. Learning skills requires a safe shrine; the co-op host owns shared foe revival, including valid guest rests.
- Death leaves all current unconverted experience as recoverable echoes at one fall site; earned skill points and skills remain safe. Press E nearby to reclaim them once. Every subsequent death replaces the previous fall site, including deaths with zero held echoes. Reset Map retains held echoes, gear, and skills but abandons fallen echoes.
- Save version 4 persists stamina and death echoes while accepting versions 1–3. Reloading a death save performs a real shrine respawn, restoring weapon-art focus and reviving ordinary foes. Existing equipment IDs and procedural world positions remain compatible. Co-op echoes remain local player/session state; host saves include only the host's fall site.
- Updated deterministic duel correction and co-op synchronization for stamina combat; co-op guests now see the boss HUD for nearby synchronized lords. Multiplayer protocol 12 must match in the browser and relay; redeploy the hosted relay with the client update. Older clients are rejected.
- Added `tests/soulslike.test.js` to the test suite for stamina, shrine, echo recovery, save compatibility, and boss behavior.
- Removed sword clashing, including the elite blade-lock QTE and its related combat states, UI, and tutorial text.
- Updated the Oni's heavy sweeping attack VFX to match its hitbox reach and arc.
