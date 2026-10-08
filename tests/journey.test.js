'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ console });
for (const name of ['util', 'preferences', 'draw', 'effects', 'world', 'skills', 'loadout', 'player', 'settings', 'save', 'enemy', 'game', 'coop']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', name + '.js'), 'utf8'), context);
}
const { Game, Player, Enemy, Loadout, SaveGame, Coop, EA, difficultyFor, JOURNEY_DIFFICULTY_ORDER,
    P_PERFECT, P_DEFLECT, P_PERFECT_DODGE, P_IGNORE } = vm.runInContext(
    '({ Game, Player, Enemy, Loadout, SaveGame, Coop, EA, difficultyFor, JOURNEY_DIFFICULTY_ORDER, '
        + 'P_PERFECT, P_DEFLECT, P_PERFECT_DODGE, P_IGNORE })', context);

function journey(tier = 'kachi') {
    const calls = [];
    const shrine = { x: 0, y: 0, name: 'Shrine', discovered: true };
    const game = Object.assign(Object.create(Game.prototype), {
        seed: 123, time: 0, difficultyTier: tier, difficulty: difficultyFor(null, 1, 0, tier),
        coop: null, loadout: new Loadout(), skills: new Set(),
        world: { shrines: [shrine], camps: [], resolve() {} }, lastShrine: shrine,
        enemies: [], kills: 0, elitesSlain: 0, totalElites: 5, ngPlus: 0,
        bossSpawned: false, bossDefeated: false, buddha: false, johnJava: null,
        exp: 73, pointsEarned: 0, skillPoints: 0, deathCount: 0,
        fx: new Proxy({}, { get: (_, name) => (...args) => calls.push([name, args]) }),
        sfx: { play() {} }, banner: (...args) => calls.push(['banner', args]),
        saveSoon: () => calls.push(['save']), shake() {}, slowmo() {}, hitstop() {}, zoomKick() {}, flash() {},
        gainExp() {},
    });
    game.player = new Player(game, 0, 0);
    return { game, calls };
}

const reactionTimes = [];
for (const tier of JOURNEY_DIFFICULTY_ORDER) {
    const { game } = journey(tier);
    const enemy = new Enemy(game, 'RONIN', 100, 0, false, null, 21);
    enemy.st = 'ALERT';
    enemy.aware = true;
    game.enemies = [enemy];
    let elapsed = 0;
    while (enemy.st === 'ALERT' && elapsed < 1) {
        enemy.update(0.01);
        elapsed += 0.01;
    }
    assert.equal(enemy.st, 'ENGAGE');
    reactionTimes.push(elapsed);
    enemy.target = game.player;
    game.player.st = 'HEAL';
    enemy.combos = [[EA.R_DELAY], [EA.R_FAST, EA.R_FAST]];
    enemy.rnd.nextDouble = () => 0.5;
    enemy.rnd.nextInt = () => 0;
    const combo = enemy.pickCombo();
    if (game.difficulty.enemySkill >= 0.6) assert.equal(combo[0], EA.R_FAST, tier + ' punishes the healing opening');
    if (game.difficulty.enemySkill < 0.4) assert.equal(combo[0], EA.R_DELAY, tier + ' does not read the healing opening');
    assert.equal(enemy.isParrySpamming({ spam: 4 }), game.difficulty.enemySkill >= 0.4);
}
for (let i = 1; i < reactionTimes.length; i++) {
    assert(reactionTimes[i] < reactionTimes[i - 1], 'each difficulty tier reacts faster than the last');
}

for (const tier of ['colton', 'buddha']) {
    const { game } = journey(tier);
    const enemy = new Enemy(game, 'RONIN', 100, 0, false, null, 23);
    enemy.st = 'ENGAGE';
    enemy.aware = true;
    enemy.attackRead = 3;
    enemy.lastSwingT = 0;
    enemy.rnd.nextDouble = () => 0.4;
    const hp = enemy.hp;
    enemy.takeHit(game.player, EA.R_A);
    if (tier === 'colton') assert(enemy.hp < hp, 'Colton does not defend against the same repeated attack');
    else {
        assert.equal(enemy.hp, hp, 'Buddha reads and parries the repeated attack');
        assert.equal(game.player.st, 'STAGGER');
    }
}

for (const tier of ['colton', 'buddha']) {
    const { game } = journey(tier);
    const scout = new Enemy(game, 'RONIN', 100, 0, false, null, 25);
    const ally = new Enemy(game, 'SPEAR', 700, 0, false, null, 26);
    game.enemies = [scout, ally];
    scout.alert(true);
    assert.equal(ally.aware, tier === 'buddha', 'higher tiers share alerts with more distant allies');
}

const deterministic = [journey('buddha').game, journey('buddha').game];
for (const game of deterministic) {
    const enemy = new Enemy(game, 'RONIN', 100, 0, false, null, 24);
    enemy.st = 'ENGAGE';
    enemy.aware = true;
    game.enemies = [enemy];
    for (let i = 0; i < 90; i++) {
        game.time += 1 / 60;
        enemy.update(1 / 60);
    }
}
assert.equal(JSON.stringify(deterministic[0].enemies.map(e => [e.x, e.y, e.st, e.stT, e.rnd.s])),
    JSON.stringify(deterministic[1].enemies.map(e => [e.x, e.y, e.st, e.stT, e.rnd.s])),
    'new tactical decisions remain deterministic for the same seed and input');

for (const tier of JOURNEY_DIFFICULTY_ORDER) {
    const { game } = journey(tier);
    const group = [0, 1, 2, 3].map(i => new Enemy(game, 'RONIN', 100 + 20 * i, 0, false, null, 30 + i));
    for (const e of group) e.aware = true;
    game.enemies = group.slice(0, 2);
    group[0].hasToken = true;
    assert.equal(game.requestToken(group[1]), game.difficulty.enemySkill >= 0.6, tier + ' pair pressure');
    game.enemies = group;
    group[1].hasToken = true;
    assert.equal(game.requestToken(group[2]), game.difficulty.enemySkill >= 0.8, tier + ' coordinated group pressure');
    group[2].x = 0;
    group[2].y = 100;
    assert.equal(game.enemyFlankDirection(group[2]) !== 0, game.difficulty.enemySkill >= 0.6, tier + ' flanking');
}

const { game, calls } = journey();
const defender = new Enemy(game, 'RONIN', 100, 0, false, null, 99);
defender.hasToken = true;
game.enemies = [defender];
for (let i = 0; i < 3; i++) game.onPlayerDeath();
assert.equal(game.exp, 73, 'repeated deaths preserve all EXP');
assert.equal(game.deathCount, 3);
assert.equal(defender.hasToken, false);

const boss = new Enemy(game, 'RONIN', 100, 0, true, 'The Ashen Daimyo', 100, true, true);
boss.st = 'DEAD';
game.enemies = [boss];
game.onEnemyKilled(boss);
assert.equal(game.bossDefeated, true);
assert(game.johnJava, 'boss victory creates John Java');
assert.equal(game.johnJava.t, 0, 'John Java begins above the player');
assert.equal(game.buddha, false, 'the blessing waits for John Java to arrive');
const john = game.johnJava;
game.beginJohnJava();
assert.equal(game.johnJava, john, 'only one John Java exists');
game.updateJohnJava(2.99);
assert.equal(game.buddha, false);
game.updateJohnJava(0.01);
assert.equal(game.buddha, true);
const saves = calls.filter(c => c[0] === 'save').length;
game.updateJohnJava(20);
assert.equal(calls.filter(c => c[0] === 'save').length, saves, 'the blessing is awarded and saved only once');

const p = game.player;
function parry(age) {
    p.toFree();
    p.invuln = 0;
    p.facing = 0;
    p.guardStart = -age;
    p.guardWindow = 0.18;
    p.guarding = true;
    return p.receive(100, 0, 10, 10, false);
}
assert.equal(parry(0.14), P_PERFECT);
assert.equal(parry(0.14001), P_DEFLECT);
game.buddha = false;
assert.equal(parry(0.14), P_DEFLECT, 'ordinary fighters do not receive Buddha timing');
game.buddha = true;
game.statMods = {};
assert.equal(parry(0.14), P_DEFLECT, 'duels do not receive Buddha advantages');
delete game.statMods;

function dodge(age) {
    p.st = 'DODGE';
    p.stT = age;
    p.invuln = 0;
    p.guarding = false;
    p.dodgeIframes = 0.25;
    return p.receive(100, 0, 10, 10, false);
}
assert.equal(dodge(0.1), P_PERFECT_DODGE);
assert.equal(dodge(0.10001), P_IGNORE);
game.buddha = false;
assert.equal(dodge(0.1), P_IGNORE);
game.buddha = true;
game.statMods = {};
assert.equal(dodge(0.1), P_IGNORE, 'duel perfect dodges remain unchanged');
delete game.statMods;
p.toFree();

const drawCalls = [];
const johnLabelY = [];
const canvas = new Proxy({
    createRadialGradient() { drawCalls.push('glow'); return { addColorStop() {} }; },
    fillText(text, x, y) {
        drawCalls.push(text);
        if (text === 'John Java') johnLabelY.push(y);
    },
}, { get: (obj, key) => key in obj ? obj[key] : () => {} });
p.draw(canvas, 0);
assert(drawCalls.includes('glow'), 'Buddha form draws its golden glow');
game.johnJava.t = 0;
game.drawJohnJava(canvas);
game.johnJava.t = 3;
game.drawJohnJava(canvas);
assert(drawCalls.includes('John Java'), 'the descending NPC is visibly named');
assert.equal(johnLabelY[1] - johnLabelY[0], 420, 'John Java visibly descends from above to ground level');

const saved = SaveGame.serialize(game);
assert.equal(saved.buddha, true);
const resumed = journey().game;
SaveGame.apply(resumed, saved);
assert.equal(resumed.buddha, true);
assert.equal(resumed.player.enlightened(), true);
assert.equal(resumed.johnJava.t, 3, 'a completed blessing restores the NPC without replaying the descent');
const ngSave = { ...saved, bossDefeated: false, ngPlus: 1 };
SaveGame.apply(resumed, ngSave);
assert.equal(resumed.buddha, true, 'Buddha form survives a New Game + save');
context.document = { createElement() {
    return { getContext() { return new Proxy({
        createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
    }, { get: (obj, key) => key in obj ? obj[key] : () => {} }); } };
} };
const reborn = journey().game;
reborn.bossDefeated = reborn.buddha = true;
reborn.saveNow = () => {};
reborn.resetMap(456);
assert.equal(reborn.ngPlus, 1);
assert.equal(reborn.bossDefeated, false);
assert.equal(reborn.buddha, true, 'resetting the map retains the earned blessing');
assert.equal(reborn.player.enlightened(), true);
const pending = { ...saved, buddha: false, blessingPending: true };
const waiting = journey().game;
SaveGame.apply(waiting, pending);
assert.equal(waiting.buddha, false);
assert.equal(waiting.johnJava.t, 0, 'saving during descent resumes the blessing');
waiting.updateJohnJava(3);
assert.equal(waiting.buddha, true);
const earlyReset = journey().game;
earlyReset.bossDefeated = true;
earlyReset.beginJohnJava();
earlyReset.saveNow = () => {};
earlyReset.resetMap(789);
assert.equal(earlyReset.buddha, false, 'an early map reset cannot skip the descent');
assert(earlyReset.johnJava);
earlyReset.updateJohnJava(3);
assert.equal(earlyReset.buddha, true, 'an early map reset does not lose the pending blessing');
const oldSave = { ...saved };
delete oldSave.buddha;
delete oldSave.blessingPending;
const legacy = journey().game;
SaveGame.apply(legacy, oldSave);
assert.equal(legacy.buddha, false);
assert(legacy.johnJava, 'existing completed journeys can receive John Java’s blessing');
const invalid = journey().game;
SaveGame.apply(invalid, { ...saved, buddha: 'true', bossDefeated: false });
assert.equal(invalid.buddha, false, 'saved blessing flags require a boolean');

const guest = journey().game;
guest.coop = { host: false };
const coop = { game: guest, slot: 1, bodies: new Map() };
Coop.prototype.receiveWorld.call(coop, { enemies: [], dead: [], defeated: true, buddha: false });
assert(guest.johnJava, 'co-op guests see John Java after host victory');
guest.updateJohnJava(3);
assert.equal(guest.buddha, false, 'co-op guests must wait for the host to grant the blessing');
Coop.prototype.receiveWorld.call(coop, { enemies: [], dead: [], defeated: true, buddha: true });
assert.equal(guest.buddha, true, 'co-op guests receive the shared blessing');

console.log('Difficulty tactics, EXP retention, John Java, and persistent Buddha rewards passed');
