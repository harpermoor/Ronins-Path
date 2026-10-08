'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = vm.createContext({ console });
for (const name of ['util', 'preferences', 'effects', 'skills', 'settings', 'world', 'loadout', 'player', 'enemy', 'game', 'save']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', name + '.js'), 'utf8'), context);
}
const { Enemy, Game, EA, difficultyFor, ENEMY_DAMAGE_SCALE, NORMAL_ENEMY_HP_SCALE, NORMAL_ENEMY_POSTURE_SCALE,
    NORMAL_ENEMY_DAMAGE_SCALE, NORMAL_ENEMY_SPEED_SCALE } = vm.runInContext(
    '({ Enemy, Game, EA, difficultyFor, ENEMY_DAMAGE_SCALE, NORMAL_ENEMY_HP_SCALE, NORMAL_ENEMY_POSTURE_SCALE, '
        + 'NORMAL_ENEMY_DAMAGE_SCALE, NORMAL_ENEMY_SPEED_SCALE })', context);

assert.equal(vm.runInContext('sanitizeJourneyDifficulty("ronin")', context), 'kachi');
assert.equal(vm.runInContext('JOURNEY_DIFFICULTY_ORDER.includes("ronin")', context), false);
assert.equal(difficultyFor(null, 1, 0, 'colton').enemyHp, 0.65);
assert.equal(difficultyFor(null, 1, 0, 'colton').enemyDmg, 0.55);
assert.equal(vm.runInContext('sanitizeJourneyDifficulty("loser")', context), 'colton');
assert.equal(vm.runInContext('JOURNEY_DIFFICULTY_ORDER[0]', context), 'colton');
assert.equal(vm.runInContext('JOURNEY_DIFFICULTY_ORDER.includes("loser")', context), false);
assert.equal(vm.runInContext('JOURNEY_DIFFICULTIES.colton.name', context), 'Colton');
assert.deepEqual(difficultyFor(null, 1, 0, 'loser'), difficultyFor(null, 1, 0, 'colton'));
assert.equal(difficultyFor(null, 1, 0, 'daimyo').enemyHp, 1.65);
assert.equal(difficultyFor(null, 1, 0, 'daimyo').enemyDmg, 1.65);
assert.equal(vm.runInContext('sanitizeJourneyDifficulty("buddha")', context), 'buddha');
assert.equal(vm.runInContext('JOURNEY_DIFFICULTY_ORDER.at(-1)', context), 'buddha');
const buddhaDifficulty = difficultyFor(null, 1, 0, 'buddha');
assert.equal(buddhaDifficulty.enemyHp, 12);
assert.equal(buddhaDifficulty.enemyPosture, 10);
assert.equal(buddhaDifficulty.enemyDmg, 8);
const buddhaNg = difficultyFor(null, 1, 2, 'buddha');
assert.equal(buddhaNg.enemyHp, 12 * 1.44);
assert.equal(buddhaNg.enemyPosture, 10 * 1.28);
assert.equal(buddhaNg.enemyDmg, 8 * 1.2);

const game = { difficulty: difficultyFor(null, 1, 0) };
for (const elite of [false, true]) {
    const normal = new Enemy(game, 'RONIN', 100, 100, elite, null, 90);
    const extreme = new Enemy({ difficulty: buddhaDifficulty }, 'RONIN', 100, 100, elite, null, 90);
    assert.equal(extreme.maxHp, normal.maxHp * 12);
    assert.equal(extreme.maxPosture, normal.maxPosture * 10);
    assert.equal(extreme.dmgScale, normal.dmgScale * 8);
}
const perfectDodgeEnemy = new Enemy(game, 'RONIN', 100, 100, false, null, 91);
const originalTarget = { x: 0, y: 0, st: 'FREE' };
perfectDodgeEnemy.g = { time: 1, player: originalTarget, fx: { text() {} } };
const shadowTarget = { x: 0, y: 100, expires: 3 };
originalTarget.afterimage = shadowTarget;
const dodger = { x: 0, y: 100, afterimage: shadowTarget,
    angleTo(target) { return Math.atan2(target.y - this.y, target.x - this.x); } };
perfectDodgeEnemy.onPerfectDodge(dodger);
assert.equal(perfectDodgeEnemy.st, 'STUN');
assert.equal(perfectDodgeEnemy.stDur, 0.65);
assert.equal(perfectDodgeEnemy.posture, 18);
assert(perfectDodgeEnemy.kbx > 0, 'perfect dodge knocks the attacker away to create a counter opening');
assert.equal(perfectDodgeEnemy.pickTarget(), shadowTarget, 'attacker locks on to the afterimage');
const secondEnemy = new Enemy(game, 'SPEAR', 120, 100, false, null, 92);
secondEnemy.g = perfectDodgeEnemy.g;
assert.equal(secondEnemy.pickTarget(), shadowTarget, 'other enemies targeting the player also lock on to the afterimage');
perfectDodgeEnemy.g.time = 3;
assert.equal(perfectDodgeEnemy.pickTarget(), originalTarget, 'attacker returns to the player after two seconds');
assert.equal(secondEnemy.pickTarget(), originalTarget, 'other enemies return to the player when the afterimage expires');
for (const elite of [false, true]) {
    for (const [perfect, duration] of [[false, 1.2], [true, 2.4]]) {
        const parriedEnemy = new Enemy(game, 'RONIN', 100, 100, elite, null, 92);
        parriedEnemy.g = { time: 1, fx: { dust() {}, text() {} }, slowmo() {} };
        parriedEnemy.target = { deflectStreak: 1, deflectPost: 1 };
        parriedEnemy.atk = { posture: 0 };
        parriedEnemy.combo = [{}];
        parriedEnemy.comboIdx = 0;
        parriedEnemy.onDeflected(perfect);
        assert.equal(parriedEnemy.st, 'STUN');
        assert.equal(parriedEnemy.stDur, duration, 'perfect parries double the enemy stun duration');
    }
}
const types = [
    ['RONIN', 82, 82, 150, 'backhand'],
    ['SPEAR', 72, 72, 140, 'hook'],
    ['BRUTE', 235, 176, 105, 'uppercut'],
];
for (const [type, hp, posture, speed, move] of types) {
    const enemy = new Enemy(game, type, 100, 100, false, null, 7);
    assert.equal(enemy.maxHp, hp * NORMAL_ENEMY_HP_SCALE);
    assert.equal(enemy.maxPosture, posture * NORMAL_ENEMY_POSTURE_SCALE);
    assert.equal(enemy.speed, speed * NORMAL_ENEMY_SPEED_SCALE);
    assert.equal(enemy.dmgScale, ENEMY_DAMAGE_SCALE * NORMAL_ENEMY_DAMAGE_SCALE);
    assert(enemy.combos.some(combo => combo.some(atk => atk.name === move)));
    assert(enemy.combos.every(combo => combo.every(atk => atk && atk.windup > 0 && atk.recovery > 0)));
    const vet = new Enemy(game, type, 100, 100, false, null, 7, true);
    const elite = new Enemy(game, type, 100, 100, true, null, 7);
    assert(vet.combos.some(combo => combo.some(atk => atk.name === move)));
    assert(elite.combos.some(combo => combo.some(atk => atk.name === move)));
    assert(vet.combos.length > enemy.combos.length);
    assert(elite.combos.length > vet.combos.length);
}
for (const move of [EA.R_BACKHAND, EA.SP_HOOK, EA.BR_UPPERCUT]) {
    assert(move.windup >= 0.35);
    assert(move.arc > 0);
    assert.equal(move.perilous, false);
}

const scaled = { difficulty: difficultyFor({ enemyScale: 25 }, 2, 2) };
const scaledEnemy = new Enemy(scaled, 'SPEAR', 100, 100, false, null, 7);
assert.equal(scaledEnemy.maxHp, 72 * NORMAL_ENEMY_HP_SCALE * scaled.difficulty.enemyHp);
assert.equal(scaledEnemy.maxPosture, 72 * NORMAL_ENEMY_POSTURE_SCALE * scaled.difficulty.enemyPosture);
assert.equal(scaledEnemy.dmgScale, ENEMY_DAMAGE_SCALE * NORMAL_ENEMY_DAMAGE_SCALE * scaled.difficulty.enemyDmg);

const live = { coop: { settings: {} }, coopSettings: { enemyScale: 25, countScale: 25 },
    difficulty: difficultyFor({ enemyScale: 25, countScale: 25 }, 2, 0), partySize: 2, ngPlus: 0,
    enemies: [new Enemy({ difficulty: difficultyFor({ enemyScale: 25 }, 2, 0) }, 'RONIN', 100, 100, false, null, 7)] };
Game.prototype.applyCoopSettings.call(live, { enemyScale: 50, countScale: 25 });
assert.equal(live.enemies[0].dmgScale, ENEMY_DAMAGE_SCALE * NORMAL_ENEMY_DAMAGE_SCALE * live.difficulty.enemyDmg);
assert(Math.abs(live.enemies[0].maxHp - 82 * NORMAL_ENEMY_HP_SCALE * live.difficulty.enemyHp) < 1e-9);

const rolePlayer = {
    x: 100, y: 100, r: 16, st: 'FREE', facing: 0,
    untargetable: () => false,
    angleTo(target) { return Math.atan2(target.y - this.y, target.x - this.x); },
};
const roleGame = { player: rolePlayer, enemies: [] };
for (const method of ['enemyGroup', 'enemyPressured', 'enemyShouldHangBack', 'requestToken']) {
    roleGame[method] = Game.prototype[method];
}
const lead = new Enemy({ difficulty: game.difficulty }, 'RONIN', 180, 100, false, null, 21);
const support = new Enemy({ difficulty: game.difficulty }, 'SPEAR', 220, 100, false, null, 22);
for (const foe of [lead, support]) {
    foe.g = roleGame;
    foe.target = rolePlayer;
    foe.aware = true;
}
roleGame.enemies = [lead, support];
assert(roleGame.requestToken(lead));
lead.hasToken = true;
assert(!roleGame.requestToken(support));
assert(roleGame.enemyShouldHangBack(support));
support.pressureT = 2;
assert(roleGame.requestToken(support));
assert(!roleGame.enemyShouldHangBack(support));
support.pressureT = 0;
lead.st = 'DEAD';
assert(roleGame.requestToken(support));

const eliteNames = vm.runInContext('ELITES', context);
const supers = vm.runInContext('ELITE_SUPERS', context);
assert.equal(new Set(supers.map(atk => atk.name)).size, eliteNames.length);
for (const [i, [name, type]] of eliteNames.entries()) {
    const elite = new Enemy(game, type, 4000, 4000, true, name, 7);
    const superCombos = elite.combos.filter(combo => combo.some(atk => atk.name === supers[i].name));
    assert(elite.combos.length >= new Enemy(game, type, 4000, 4000, true, null, 7).combos.length + 2);
    assert(superCombos.length >= 2);
    assert(elite.gap.some(combo => combo.some(atk => atk.name === supers[i].name)));
    assert(superCombos.every(combo => combo.length >= 2));
    const attack = superCombos[0].find(atk => atk.name === supers[i].name);
    assert(attack.perilous && attack.windup > 0.7 && attack.recovery > 0.6);
    const events = [];
    elite.g = { fx: { text: (...args) => events.push(['text', args]), ring: (...args) => events.push(['ring', args]) },
        sfx: { play: name => events.push(['sound', name]) } };
    elite.combo = [attack];
    elite.comboIdx = 0;
    elite.beginAttack(0.55);
    assert(elite.stDur >= attack.windup * 0.88);
    assert(events.some(([kind, args]) => kind === 'text' && args[0] === attack.name.toUpperCase()));
    assert(events.some(([kind, name]) => kind === 'sound' && name === 'PERILOUS'));
}
const daimyo = new Enemy(game, 'RONIN', 4000, 4000, true, 'The Ashen Daimyo', 7, true, true);
assert(daimyo.combos.some(combo => combo.some(atk => atk.name === EA.DAIMYO_ASHFALL.name)));
assert(daimyo.gap.some(combo => combo.some(atk => atk.name === EA.DAIMYO_ASHFALL.name)));
assert(EA.DAIMYO_ASHFALL.perilous && !EA.DAIMYO_ASHFALL.thrust);
assert(daimyo.dodgeChance > 0);
const respawnElite = new Enemy(game, 'RONIN', 4000, 4000, true, eliteNames[0][0], 8);
const respawnBoss = new Enemy(game, 'RONIN', 4000, 4000, true, 'The Ashen Daimyo', 9, true, true);
const defeatedElite = new Enemy(game, 'SPEAR', 5000, 5000, true, eliteNames[1][0], 10);
const camp = { members: [], cleared: false };
const campDefender = new Enemy(game, 'RONIN', 100, 100, false, null, 11);
const quietDefender = new Enemy(game, 'SPEAR', 150, 100, false, null, 12);
const defeatedDefender = new Enemy(game, 'BRUTE', 200, 100, false, null, 13);
for (const foe of [campDefender, quietDefender, defeatedDefender]) {
    foe.camp = camp;
    camp.members.push(foe);
    foe.hp = 1;
    foe.posture = 20;
}
campDefender.x = 300;
campDefender.y = 350;
campDefender.aware = true;
campDefender.st = 'WINDUP';
campDefender.combo = [EA.R_A];
campDefender.atk = EA.R_A;
campDefender.hasToken = true;
campDefender.dodgeAfterimage = shadowTarget;
defeatedDefender.hp = 0;
defeatedDefender.st = 'DEAD';
defeatedDefender.alive = false;
defeatedDefender.x = 500;
defeatedDefender.y = 550;
respawnElite.hp = 1;
respawnElite.lives = 1;
respawnElite.posture = 20;
respawnBoss.hp = 1;
respawnBoss.lives = 1;
respawnBoss.posture = 20;
respawnBoss.aware = true;
defeatedElite.st = 'DEAD';
const respawnGame = { player: { respawn() {} }, lastShrine: { x: 0, y: 0 },
    enemies: [respawnElite, respawnBoss, defeatedElite, ...camp.members],
    coop: null, boss: respawnBoss, banner() {}, saveSoon() {} };
Game.prototype.respawn.call(respawnGame);
assert.equal(respawnElite.hp, respawnElite.maxHp);
assert.equal(respawnElite.lives, 2);
assert.equal(respawnElite.posture, 0);
assert.equal(respawnBoss.hp, respawnBoss.maxHp);
assert.equal(respawnBoss.lives, 3);
assert.equal(respawnBoss.posture, 0);
assert.equal(defeatedElite.st, 'DEAD');
assert.equal(respawnGame.boss, null);
assert.equal(respawnGame.enemies.length, 6, 'resurrection must not remove camp defenders');
assert.equal(camp.members.length, 3);
assert.equal(camp.cleared, false);
for (const foe of [campDefender, quietDefender]) {
    assert.equal(foe.x, foe.homeX);
    assert.equal(foe.y, foe.homeY);
    assert.equal(foe.hp, foe.maxHp, 'all surviving camp defenders heal, even if unaware');
    assert.equal(foe.posture, 0);
    assert.equal(foe.st, 'IDLE');
    assert.equal(foe.alive, true);
}
assert.equal(campDefender.x, campDefender.homeX, 'camp survivors return to their original camp positions');
assert.equal(campDefender.y, campDefender.homeY);
assert.equal(campDefender.wanderX, campDefender.homeX);
assert.equal(campDefender.wanderY, campDefender.homeY);
assert.equal(campDefender.hasToken, false);
assert.equal(campDefender.combo, null);
assert.equal(campDefender.atk, null);
assert.equal(campDefender.dodgeAfterimage, null);
assert.equal(defeatedDefender.st, 'DEAD');
assert.equal(defeatedDefender.hp, 0);
assert.equal(defeatedDefender.alive, false);
assert.equal(defeatedDefender.x, 500, 'dead camp enemies remain where they died');
assert.equal(defeatedDefender.y, 550);

const mapBoss = new Enemy(game, 'RONIN', 5000, 6000, true, 'The Ashen Daimyo', 11, true, true);
const mapFillStyles = [];
const mapContext = {
    fillRect() {}, drawImage() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() { mapFillStyles.push(this.fillStyle); }, stroke() {}, strokeRect() {},
};
Game.prototype.drawMinimap.call({ world: { minimap: {}, camps: [], shrines: [] }, player: { x: 3000, y: 3000, facing: 0 },
    enemies: [mapBoss], lastShrine: null, coop: null, camX: 3000, camY: 3000 }, mapContext, 800, 600);
assert(mapFillStyles.includes('rgb(255,80,60)'));
const ordinary = new Enemy(game, 'RONIN', 4000, 4000, false, null, 7);
for (const foe of [daimyo, ...eliteNames.map(([name, type]) => new Enemy(game, type, 4000, 4000, true, name, 7))]) {
    foe.rnd.nextDouble = () => 0;
    foe.target = { st: 'HEAL', guarding: false };
    assert.equal(foe.pickCombo()[0].windup,
        Math.min(...foe.combos.filter(c => c.length > 1).map(c => c[0].windup)));
    assert(foe.pickGap().length > 1);
    foe.target = { st: 'FREE', guarding: true };
    assert(foe.pickCombo().some(atk => atk.perilous));
    foe.target.guarding = false;
    foe.lives = 1;
    const signature = foe.boss ? EA.DAIMYO_ASHFALL : supers[foe.eliteStyle];
    assert.equal(foe.pickCombo().at(-1).name, signature.name);
}
ordinary.rnd.nextDouble = () => 0;
ordinary.target = { st: 'HEAL', guarding: true };
assert.equal(ordinary.pickCombo()[0].windup,
    Math.min(...ordinary.combos.filter(c => c.length > 1).map(c => c[0].windup)));
assert(ordinary.pickGap().length > 1);
for (const type of ['RONIN', 'SPEAR', 'BRUTE']) {
    const foe = new Enemy(game, type, 4000, 4000, false, null, 7);
    foe.target = { st: 'FREE', guarding: false, spam: 3 };
    assert(foe.isParrySpamming(foe.target));
    assert(foe.pickCombo().some(atk => atk.perilous), type + ' should punish parry spam with an unparryable attack');
    foe.target.spam = 2.49;
    assert(!foe.isParrySpamming(foe.target));
}

function spawnFixture() {
    const world = { camps: [
        { x: 4000, y: 4000, r: 300, elite: true, eliteType: 'RONIN', eliteName: eliteNames[0][0], members: [], cleared: false },
        { x: 6000, y: 6000, r: 240, elite: false, members: [], cleared: false },
    ], shrines: [{ x: 250, y: 250 }], resolve() {},
    nearCamp: () => Infinity, nearShrine: () => Infinity };
    const fixture = { world, rnd: vm.runInContext('new Rng(19)', context), enemies: [], totalElites: 0,
        difficulty: difficultyFor(null, 1, 0), addEnemy: Game.prototype.addEnemy,
        randomGrunt: Game.prototype.randomGrunt, pickType: Game.prototype.pickType };
    Game.prototype.spawnEnemies.call(fixture);
    return fixture;
}
const spawned = spawnFixture();
assert.equal(spawned.totalElites, 1);
assert.equal(spawned.world.camps[0].members.length, 1);
assert(spawned.world.camps[0].members[0].elite);
assert.equal(spawned.enemies[0].legacyIndex, 0);
assert.equal(spawned.enemies[1].legacyIndex, 2);
assert.equal(spawned.enemies[1].previousIndex, 1);
assert(spawned.world.camps[1].members.length >= 1 && spawned.world.camps[1].members.length <= 2);
assert(spawned.world.camps[1].members.every(e => e.vet));
const wanderers = spawned.enemies.filter(e => e.camp === null);
assert(wanderers.length > 0);
assert(spawned.world.camps[1].members.length < wanderers[0].legacyIndex - 2);
assert(wanderers.every(e =>
    Math.hypot(e.x - 4000, e.y - 4000) >= 1050));

const SaveGame = vm.runInContext('SaveGame', context);
assert(SaveGame.valid({ v: 1, seed: 19, player: {} }));
assert(SaveGame.valid({ v: 2, seed: 19, player: {} }));
assert(SaveGame.valid({ v: 3, seed: 19, player: {} }));
const savedGame = spawnFixture();
savedGame.player = { maxHp: 100, maxGourds: 3, maxThrows: 5, x: 0, y: 0, applyLoadout() {} };
savedGame.loadout = { apply() {} };
savedGame.skills = new Set();
savedGame.world.resolve = () => {};
SaveGame.apply(savedGame, { v: 1, dead: [0, 1, 2], camps: [false, false], player: {} });
assert.equal(savedGame.enemies[0].st, 'DEAD');
assert.equal(savedGame.enemies[1].st, 'DEAD');
assert(savedGame.world.camps[0].cleared);
const currentGame = spawnFixture();
currentGame.player = { maxHp: 100, maxGourds: 3, maxThrows: 5, x: 0, y: 0, applyLoadout() {} };
currentGame.loadout = { apply() {} };
currentGame.skills = new Set();
const shifted = currentGame.enemies.find((e, i) => e.previousIndex !== i);
assert(shifted);
SaveGame.apply(currentGame, { v: 2, dead: [shifted.previousIndex], player: {} });
assert.notEqual(currentGame.enemies[0].st, 'DEAD');
assert.equal(shifted.st, 'DEAD');
const latestGame = spawnFixture();
latestGame.player = { maxHp: 100, maxGourds: 3, maxThrows: 5, x: 0, y: 0, applyLoadout() {} };
latestGame.loadout = { apply() {} };
latestGame.skills = new Set();
SaveGame.apply(latestGame, { v: 3, dead: [1], player: {} });
assert.notEqual(latestGame.enemies[0].st, 'DEAD');
assert.equal(latestGame.enemies[1].st, 'DEAD');
assert.equal(vm.runInContext('SAVE_VERSION', context), 3);

const combatGame = { difficulty: difficultyFor(null, 1, 0), time: 0,
    fx: new Proxy({}, { get: () => () => {} }), sfx: { play() {} },
    hitstop() {}, shake() {}, slowmo() {}, onEnemyKilled() {}, onPostureBreak() {} };
const attacker = { x: 70, y: 100, ki: 0, angleTo: target => Math.atan2(target.y - 100, target.x - 70) };
const strike = { damage: 12, posture: 5, art: false, heavy: false, pierce: false };
for (const type of ['RONIN', 'SPEAR', 'BRUTE']) {
    const foe = new Enemy(combatGame, type, 100, 100, false, null, 7);
    foe.aware = true;
    foe.startCombo([foe.combos[0][0], foe.combos[0][0]], 1);
    const hp = foe.hp, dur = foe.stDur;
    foe.takeHit(attacker, strike);
    assert.equal(foe.st, 'WINDUP');
    assert.equal(foe.stDur, dur);
    assert.equal(foe.hp, hp - strike.damage);
    foe.comboIdx = 1;
    foe.beginAttack(1);
    assert.equal(foe.attackHitsTaken, 0);
    foe.takeHit(attacker, strike);
    assert.equal(foe.st, 'WINDUP');
}
const ronin = new Enemy(combatGame, 'RONIN', 100, 100, false, null, 7);
ronin.aware = true;
ronin.startCombo([ronin.combos[0][0]], 1);
ronin.takeHit(attacker, strike);
ronin.takeHit(attacker, strike);
assert.equal(ronin.st, 'STUN');
const active = new Enemy(combatGame, 'SPEAR', 100, 100, false, null, 7);
active.aware = true;
active.startCombo([active.combos[0][0]], 1);
active.setSt('ACTIVE');
active.takeHit(attacker, strike);
assert.equal(active.st, 'ACTIVE');
active.takeHit(attacker, strike);
assert.equal(active.st, 'STUN');
const recovering = new Enemy(combatGame, 'RONIN', 100, 100, false, null, 7);
recovering.aware = true;
recovering.startCombo([recovering.combos[0][0]], 1);
recovering.setSt('RECOVER');
recovering.takeHit(attacker, strike);
assert.equal(recovering.st, 'STUN');
const broken = new Enemy(combatGame, 'RONIN', 100, 100, false, null, 7);
broken.aware = true;
broken.startCombo([broken.combos[0][0]], 1);
broken.posture = broken.maxPosture - 2;
broken.takeHit(attacker, strike);
assert.equal(broken.st, 'BROKEN');
const fatal = new Enemy(combatGame, 'SPEAR', 100, 100, false, null, 7);
fatal.aware = true;
fatal.startCombo([fatal.combos[0][0]], 1);
fatal.hp = strike.damage;
fatal.takeHit(attacker, strike);
assert.equal(fatal.st, 'DEAD');

const parrier = new Enemy(combatGame, 'RONIN', 100, 100, false, null, 8);
const spammer = Object.assign({}, attacker, {
    x: 70, y: 100, st: 'ATTACK', guarding: false,
    recoilCalls: 0,
    recoil() { this.recoilCalls++; },
});
parrier.aware = true;
parrier.setSt('ENGAGE');
parrier.rnd.nextDouble = () => 0;
const parryStrike = Object.assign({}, strike, { arc: 2 });
parrier.takeHit(spammer, parryStrike);
assert.equal(parrier.blockStreak, 1);
parrier.setSt('ENGAGE');
combatGame.time = 0.2;
parrier.takeHit(spammer, parryStrike);
assert.equal(spammer.recoilCalls, 1);
assert.equal(parrier.st, 'WINDUP');
assert.equal(parrier.hasToken, true);
assert.equal(parrier.attackRead, 0);

assert(EA.R_SWEEP.sweep && EA.R_SWEEP.copy(1, 1).sweep);
assert(!EA.R_THRUST.sweep);
for (const [attack, oldRange, oldArc, oldActive] of [
    [EA.BR_PER, 130, 300, 0.25],
    [EA.R_SWEEP, 92, 220, 0.16],
    [EA.GOZU_QUAKE, 145, 300, 0.25],
    [EA.RYUSEI_CROSS, 110, 310, 0.20],
    [EA.OKAMI_CRESCENT, 132, 320, 0.22],
    [EA.DAIMYO_ASHFALL, 152, 280, 0.23],
]) {
    assert(attack.range <= oldRange * 0.76, attack.name + ' reach shrinks by at least 24%');
    assert(attack.arc <= oldArc * Math.PI / 180 * 0.64, attack.name + ' arc shrinks by at least 36%');
    assert(attack.active <= oldActive * 0.4, attack.name + ' active time shrinks by at least 60%');
    assert(attack.active >= 0.06 && attack.active <= 0.07);
}

const sweepFxCalls = [];
const sweepEffects = vm.runInContext('new Effects()', context);
const slash = sweepEffects.slash.bind(sweepEffects);
sweepEffects.slash = (...args) => { sweepFxCalls.push(args); slash(...args); };
const sweepGame = { difficulty: game.difficulty, fx: sweepEffects, sfx: { play() {} }, world: { resolve() {} } };
const oni = new Enemy(sweepGame, 'BRUTE', 100, 100, false, null, 9);
oni.atk = EA.BR_SWEEP;
oni.stDur = oni.atk.windup;
oni.stT = oni.stDur;
oni.windup(0, 0, 0, { r: 16 });
assert.equal(sweepFxCalls[0][2], EA.BR_SWEEP.range);
assert.equal(sweepFxCalls[0][4], -EA.BR_SWEEP.arc);
for (const attack of [EA.BR_SMASH, EA.BR_SWEEP, EA.BR_UPPERCUT, EA.BR_PER, EA.GOZU_QUAKE, EA.BR_SWEEP.copy(1, 1)]) {
    oni.atk = attack;
    oni.facing = 0.4;
    oni.stDur = attack.windup;
    oni.stT = oni.stDur;
    sweepEffects.slashes = [];
    oni.windup(0, 0, oni.facing, { r: 16 });
    const trail = sweepEffects.slashes[0];
    assert.equal(trail.r, attack.range, 'every Oni heavy effect must show the actual attack reach');
    assert(trail.max >= attack.active, 'the sweep remains visible throughout its damage window');
    oni.x += 7;
    oni.y += 3;
    const arcs = [];
    const canvas = new Proxy({ arc(...args) { arcs.push(args); } }, { get: (obj, key) => key in obj ? obj[key] : () => {} });
    sweepEffects.drawWorld(canvas);
    assert.equal(arcs[0][0], oni.x, 'heavy effects follow the lunge');
    assert.equal(arcs[0][1], oni.y);
    assert.equal(arcs[0][2], attack.range);
    assert.equal(arcs[0][3], oni.facing + attack.arc / 2);
    assert(Math.abs(arcs[0][4] - (oni.facing - attack.arc / 2)) < 1e-10,
        'the entire damaging sector is visible immediately');

    const radius = 16;
    for (const [distance, angle, expected] of [
        [attack.range + radius - 1, 0, true],
        [attack.range + radius + 1, 0, false],
        [attack.range * 0.8, attack.arc / 2 - 0.01, true],
        [attack.range * 0.8, -attack.arc / 2 + 0.01, true],
        [attack.range * 0.8, attack.arc / 2 + Math.asin(radius / (attack.range * 0.8)) - 0.01, true],
        [attack.range * 0.8, attack.arc / 2 + Math.asin(radius / (attack.range * 0.8)) + 0.01, false],
        [attack.range + radius - 1, attack.arc / 2 + Math.asin(radius / (attack.range + radius - 1)) - 0.01, false],
    ]) {
        oni.stT = 0;
        oni.stDur = attack.active;
        let hits = 0;
        const victim = { x: oni.x + Math.cos(oni.facing + angle) * distance,
            y: oni.y + Math.sin(oni.facing + angle) * distance, r: radius, st: 'FREE',
            receive() { hits++; return 3; } };
        oni.atkHit = false;
        oni.activeSt(0, distance, oni.facing + angle, victim);
        assert.equal(hits > 0, expected, attack.name + ' collision must respect the shown range and sector');
    }
}
for (const attack of [EA.BR_PER, EA.R_SWEEP, EA.GOZU_QUAKE, EA.RYUSEI_CROSS, EA.OKAMI_CRESCENT, EA.DAIMYO_ASHFALL]) {
    oni.atk = attack;
    oni.stT = oni.stDur = attack.windup;
    sweepEffects.slashes = [];
    oni.windup(0, 0, oni.facing, { r: 16 });
    assert.equal(sweepEffects.slashes[0].max, attack.active, 'special sweep trail ends with the hit window');
    oni.combo = [attack];
    oni.comboIdx = 0;
    let hits = 0;
    const victim = { x: oni.x, y: oni.y, r: 16, st: 'FREE', receive() { hits++; return 3; } };
    oni.stT = attack.active;
    oni.atkHit = false;
    oni.activeSt(0, 0, oni.facing, victim);
    assert.equal(hits, 0, attack.name + ' cannot hit at or after its active window expires');
    assert.equal(oni.st, 'RECOVER');
}
oni.atk = EA.BR_SMASH;
oni.facing = 0;
oni.stT = 0;
oni.stDur = oni.atk.active;
oni.atkHit = false;
let lungeHits = 0;
const lungeVictim = { x: oni.x + oni.atk.range + 20, y: oni.y, r: 16, st: 'FREE',
    receive() { lungeHits++; return 3; } };
oni.activeSt(0.05, oni.distTo(lungeVictim), oni.angleTo(lungeVictim), lungeVictim);
assert.equal(lungeHits, 1, 'collision uses the position after lunging, not stale pre-lunge distance');

const eliteAttacker = Object.assign({}, attacker, { st: 'ATTACK', facing: 0 });
const duelist = new Enemy(combatGame, 'RONIN', 100, 100, true, null, 9);
duelist.aware = true;
duelist.facing = Math.PI;
duelist.startCombo([EA.R_BACKHAND], 1);
duelist.setSt('ACTIVE');
const hpBefore = duelist.hp;
duelist.takeHit(eliteAttacker, parryStrike);
assert.equal(duelist.hp, hpBefore - parryStrike.damage);
assert.equal(duelist.st, 'ACTIVE');

console.log('Enemy variation and scaling checks passed');
