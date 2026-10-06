'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const storage = new Map();
const context = vm.createContext({
    console,
    localStorage: {
        getItem: key => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key),
    },
});
for (const name of ['util', 'world', 'skills', 'loadout', 'player', 'settings', 'enemy', 'save', 'game', 'coop', 'duel', 'net']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', name + '.js'), 'utf8'), context);
}
const { Game, Player, Enemy, Loadout, SaveGame, Coop, Duel, EquipMenu, EA, ELITES, PHASE_SUPERS,
    PLAYER_SYNC, COOP_PLAYER_FIELDS, COOP_ENEMY_FIELDS, difficultyFor, P_BLOCK, P_HIT } = vm.runInContext(
    '({ Game, Player, Enemy, Loadout, SaveGame, Coop, Duel, EquipMenu, EA, ELITES, PHASE_SUPERS, '
        + 'PLAYER_SYNC, COOP_PLAYER_FIELDS, COOP_ENEMY_FIELDS, difficultyFor, P_BLOCK, P_HIT })', context);
const fx = new Proxy({}, { get: () => () => {} });

function fixture() {
    const g = Object.assign(Object.create(Game.prototype), {
        seed: 37, loadout: new Loadout(), skills: new Set(), time: 0,
        difficulty: difficultyFor(null, 1, 0), fx, sfx: { play() {} },
        rnd: vm.runInContext('new Rng(37)', context),
        enemies: [], coop: null, guestJourney: false, totalElites: 5, elitesSlain: 0,
        kills: 0, ngPlus: 0, exp: 0, pointsEarned: 0, skillPoints: 0, lastExpLoss: 0, deathEcho: null,
        boss: null, bossSpawned: false, bossDefeated: false, autosaveT: 30, restBlockers: [],
        world: { shrines: [{ x: 500, y: 500, name: 'Test Sanctuary', discovered: true }], camps: [],
            resolve() {}, solidAt: () => false },
        hitstop() {}, slowmo() {}, shake() {}, zoomKick() {}, flash() {}, parryBurst() {}, banner() {},
    });
    g.lastShrine = g.world.shrines[0];
    g.player = new Player(g, 500, 560);
    return g;
}

const g = fixture(), p = g.player;
assert.equal(p.artCharges, p.maxArtCharges, 'New journeys start with usable weapon arts');
p.stamina = 10;
p.startAttack(0);
assert.equal(p.st, 'FREE', 'No attack can start without its full stamina cost');
assert.equal(p.stamina, 10);
p.startDodge();
assert.equal(p.st, 'FREE');
p.stamina = 100;
p.startAttack(0);
assert.equal(p.stamina, 84);
p.bufDodge = p.bufParry = 0.2;
p.stT = 0.03;
p.attack(0.01, 0);
assert.equal(p.st, 'ATTACK', 'Windup cannot be cancelled into a roll or guard');
p.phase = 2;
p.stT = 0.01;
p.attack(0.01, 0);
assert.equal(p.st, 'ATTACK', 'Early recovery is committed too');
p.stT = p.cur.recovery * 0.7;
p.bufParry = 0;
p.attack(0.01, 0);
assert.equal(p.st, 'DODGE', 'A late-recovery roll is allowed');
assert.equal(p.stamina, 60);
p.toFree();
p.guarding = p.guardHeld = p.dodgeHeld = p.sprinting = false;
p.moveX = p.moveY = 0;
p.bufParry = p.bufDodge = 0;
p.stamina = 40;
p.staminaCd = 0.5;
p.update(0.25);
assert.equal(p.stamina, 40, 'Stamina regeneration respects the recovery delay');
p.update(0.3);
assert(p.stamina > 40 && p.stamina < p.maxStamina);
p.stamina = 99;
p.staminaCd = 0;
p.update(1);
assert.equal(p.stamina, p.maxStamina);

p.stamina = 0.1;
p.moveX = 1;
p.dodgeHeld = true;
p.free(0.1, 0);
assert.equal(p.stamina, 0);
assert.equal(p.sprinting, false);
assert.equal(p.sprintExhausted, true, 'An empty bar cannot stutter-sprint every regeneration tick');
p.dodgeHeld = false;
p.moveX = 0;
p.toFree();
p.staminaCd = 0;
p.update(1);
assert.equal(p.sprintExhausted, false);

const rolls = [];
for (const armor of ['shinobi', 'traveler', 'oyoroi']) {
    g.loadout.armor = armor;
    p.applyLoadout();
    rolls.push({ time: p.rollTime, iframes: p.dodgeIframes, speed: p.rollSpeed });
}
assert(rolls[0].time < rolls[1].time && rolls[1].time < rolls[2].time);
assert(rolls[0].iframes > rolls[1].iframes && rolls[1].iframes > rolls[2].iframes);
assert(rolls[0].speed > rolls[1].speed && rolls[1].speed > rolls[2].speed);
p.stamina = 100;
p.moveX = p.moveY = 0;
p.facing = 0;
p.startDodge();
assert.equal(p.dodgeDx, -1, 'A stationary dodge retreats rather than countering a thrust automatically');
p.stT = p.dodgeIframes + 0.01;
assert.equal(p.invulnerable(), false);

p.toFree();
p.hp = p.maxHp;
p.invuln = 0;
p.facing = 0;
p.guarding = true;
p.guardStart = -99;
p.stamina = 5;
assert.equal(p.receive(p.x + 50, p.y, 10, 20, false), P_BLOCK);
assert.equal(p.st, 'STAGGER', 'An exhausted shield guard breaks');
assert.equal(p.stamina, 0);
p.toFree();
p.invuln = 0;
p.guarding = true;
assert.equal(p.receive(p.x + 50, p.y, 10, 20, false), P_HIT, 'An empty bar cannot block');

const lesser = new Enemy(g, 'RONIN', 800, 800, false, null, 4);
const lord = new Enemy(g, ELITES[0][1], 1800, 1800, true, ELITES[0][0], 5);
lesser.st = lord.st = 'DEAD';
lesser.hp = lord.hp = 0;
g.enemies = [lesser, lord];
p.stamina = 0;
p.staminaCd = 0.65;
p.exhaustedT = 0.8;
p.sprintExhausted = p.sprinting = true;
p.respawn(500, 560);
assert.equal(p.stamina, p.maxStamina, 'Respawning restores stamina without requiring a second rest');
assert.equal(p.staminaCd, 0);
assert.equal(p.exhaustedT, 0);
assert.equal(p.sprintExhausted, false);
assert.equal(p.sprinting, false);
p.hp = 20;
p.stamina = 1;
p.artCharges = 0;
p.gourds = 0;
g.interact();
assert.equal(p.hp, p.maxHp);
assert.equal(p.stamina, p.maxStamina);
assert.equal(p.gourds, p.maxGourds);
assert.equal(p.artCharges, p.maxArtCharges);
assert.equal(lesser.st, 'IDLE', 'Rest revives ordinary foes');
assert.equal(lord.st, 'DEAD', 'Defeated lords remain defeated');
lesser.st = 'DEAD';

p.x = 1100;
p.y = 1200;
g.exp = 90;
p.die();
assert.equal(g.exp, 0);
assert.equal(g.deathEcho.amount, 90);
assert.equal(g.deathEcho.x, 1100);
const deathSave = SaveGame.read();
assert.equal(deathSave.deathEcho.amount, 90, 'The fall site is saved immediately');
assert.equal(deathSave.player.hp, p.maxHp, 'Loading a death save resumes safely at the shrine');
assert.equal(deathSave.player.artCharges, p.maxArtCharges);
assert.equal(deathSave.player.fallen, true);
const reloaded = fixture();
reloaded.enemies = [
    new Enemy(reloaded, 'RONIN', 800, 800, false, null, 4),
    new Enemy(reloaded, ELITES[0][1], 1800, 1800, true, ELITES[0][0], 5),
];
SaveGame.apply(reloaded, deathSave);
assert.equal(reloaded.deathEcho.amount, 90);
assert.equal(reloaded.enemies[0].st, 'IDLE', 'Loading directly after death revives ordinary foes');
assert.equal(reloaded.enemies[1].st, 'DEAD', 'Death-save reloads preserve defeated lords');
g.respawn();
assert.equal(g.deathEcho.amount, 90);
p.x = 1100;
p.y = 1200;
g.interact();
assert.equal(g.exp, 90);
assert.equal(g.deathEcho, null);
assert.equal(SaveGame.read().deathEcho, null, 'A reclaimed fall site cannot be loaded for duplicate experience');

g.exp = 55;
p.die();
g.respawn();
g.exp = 12;
p.x = 1300;
p.die();
assert.equal(g.deathEcho.amount, 12, 'A second death replaces the old echoes');
assert.equal(g.deathEcho.x, 1300);
g.respawn();
g.exp = 0;
p.die();
assert.equal(g.deathEcho, null, 'Even a zero-experience death destroys the old fall site');
g.respawn();

for (const version of [1, 2, 3, 4]) assert(SaveGame.valid({ v: version, seed: 37, player: {} }));
const clean = fixture();
SaveGame.apply(clean, { v: 4, player: { stamina: -400 }, deathEcho: { x: -10, y: 90000, amount: 90000000 } });
assert.equal(clean.player.stamina, 0);
assert.equal(clean.deathEcho.x, 0);
assert.equal(clean.deathEcho.y, 8000);
assert.equal(clean.deathEcho.amount, 1e7);
SaveGame.apply(clean, { v: 4, player: { stamina: NaN }, deathEcho: { x: NaN, y: 3, amount: 10 } });
assert.equal(clean.player.stamina, clean.player.maxStamina);
assert.equal(clean.deathEcho, null);
SaveGame.apply(clean, { v: 3, player: {} });
assert.equal(clean.player.stamina, clean.player.maxStamina, 'Old saves receive a full stamina bar');

const backstabGame = fixture();
const sentry = new Enemy(backstabGame, 'RONIN', 1000, 1000, false, null, 10);
sentry.facing = 0;
backstabGame.player.x = 1050;
backstabGame.player.y = 1000;
assert.equal(backstabGame.stealthable(sentry), false, 'An unaware foe cannot be backstabbed from the front');
backstabGame.player.x = 950;
assert.equal(backstabGame.stealthable(sentry), true);
const guestAttacker = { x: 1050, y: 1000 };
assert.equal(backstabGame.stealthable(sentry, guestAttacker), false, 'Co-op backstabs use the actual attacker');
backstabGame.player.stamina = 19;
backstabGame.player.startDeathblow(sentry);
assert.equal(backstabGame.player.st, 'FREE');
assert.equal(sentry.beingExecuted, false);
backstabGame.player.stamina = 100;
backstabGame.player.startDeathblow(sentry);
assert.equal(backstabGame.player.stamina, 80);

const reclaim = fixture();
reclaim.exp = 100;
reclaim.deathEcho = { x: 500, y: 560, amount: 80 };
reclaim.interact();
assert.equal(reclaim.skillPoints, 1, 'Reclaimed echoes can cross a skill-point threshold');
assert.equal(reclaim.exp, 60);
reclaim.interact();
assert.equal(reclaim.skillPoints, 1);
assert.equal(reclaim.exp, 60, 'A second interaction cannot award the same fall site again');

for (const [i, [name, type]] of ELITES.entries()) {
    const e = new Enemy(g, type, 1500, 1500, true, name, 10 + i);
    assert.equal(e.lives, 1);
    assert(e.phaseCombos.some(combo => combo.some(a => a.name === PHASE_SUPERS[i].name)));
    e.hp = e.maxHp * 0.49;
    e.update(0.01);
    assert.equal(e.bossPhase, 2);
    assert.equal(e.st, 'STUN');
    e.rnd.nextDouble = () => 0;
    assert(e.pickCombo().some(a => a.name === PHASE_SUPERS[i].name));
    e.resetToHome();
    assert.equal(e.bossPhase, 1);
    e.hp = 1;
    e.takeRaw(2, 0, 0);
    assert.equal(e.st, 'DEAD', 'Health damage alone can defeat a lord');
}
const regent = new Enemy(g, 'RONIN', 1600, 1600, true, 'The Cinder Regent', 99, true, true);
assert(regent.phaseCombos.some(combo => combo.some(a => a.name === EA.CINDER_TIDE.name)));
assert.equal(EA.CINDER_TIDE.arc, Math.PI * 2);
const radialTarget = { x: regent.x - 210, y: regent.y, r: 15, st: 'FREE', receive: () => P_HIT };
regent.atk = EA.CINDER_TIDE;
regent.combo = [regent.atk];
regent.comboIdx = 0;
regent.st = 'ACTIVE';
regent.stT = 0;
regent.stDur = regent.atk.active;
regent.facing = 0;
regent.activeSt(0, 210, Math.PI, radialTarget);
assert.equal(regent.atkHit, true, 'The radial phase attack reaches behind the boss inside its telegraphed radius');
regent.atkHit = false;
regent.activeSt(0, 241, Math.PI, radialTarget);
assert.equal(regent.atkHit, false, 'Targets outside range plus their radius are not hit');
g.enemies = [regent];
regent.hp = regent.maxHp * 0.8;
regent.aware = true;
g.executeDeathblow(p, regent);
assert(Math.abs(regent.hp / regent.maxHp - 0.5) < 1e-9, 'Boss critical strikes remove health, not a refillable life');

for (const field of ['stamina', 'staminaCd', 'sprintExhausted']) {
    assert(PLAYER_SYNC.includes(field));
    assert(COOP_PLAYER_FIELDS.includes(field));
}
assert(PLAYER_SYNC.includes('bufStab'), 'Heavy-attack buffers participate in duel correction');
assert(COOP_ENEMY_FIELDS.includes('bossPhase'));
const duel = { n: 1, players: [p] };
p.stamina = 37;
p.staminaCd = 0.6;
p.bufStab = 0.12;
p.sprintExhausted = true;
const packed = Duel.prototype.packPlayer.call(duel, p);
p.stamina = 100;
p.staminaCd = p.bufStab = 0;
p.sprintExhausted = false;
Duel.prototype.unpackPlayer.call(duel, p, packed);
assert.equal(p.stamina, 37);
assert.equal(p.staminaCd, 0.6);
assert.equal(p.bufStab, 0.12);
assert.equal(p.sprintExhausted, true);
Coop.apply(p, { stamina: -100, staminaCd: 90, rollTime: 0.1, rollSpeed: 99999 }, COOP_PLAYER_FIELDS);
assert.equal(p.stamina, 0);
assert.equal(p.staminaCd, 2);
assert.equal(p.rollTime, 0.3);
assert.equal(p.rollSpeed, 900);

const duelTargetGame = fixture(), duelTarget = duelTargetGame.player;
const criticalDuel = { fx, sfx: g.sfx, hitstop() {}, slowmo() {}, shake() {}, zoomKick() {}, flash() {} };
Duel.prototype.executeDeathblow.call(criticalDuel, p, duelTarget);
assert.equal(duelTarget.hp, duelTarget.maxHp * 0.4, 'A duel critical is dangerous but not a full-health instant kill');
assert.equal(duelTarget.st, 'STAGGER');
Duel.prototype.executeDeathblow.call(criticalDuel, p, duelTarget);
assert.equal(duelTarget.st, 'DEAD', 'A critical can finish an already wounded duelist');

const learner = fixture();
learner.skillPoints = 2;
const equipment = new EquipMenu(learner);
learner.player.x = 2000;
equipment.learn(0);
assert.equal(learner.skills.size, 0, 'Leveling requires a safe shrine');
learner.player.x = 500;
equipment.learn(0);
assert(learner.skills.has('keen'));
assert.equal(learner.skillPoints, 1);

console.log('Stamina, death echoes, shrine loops, boss phases and synchronized-state checks passed');
