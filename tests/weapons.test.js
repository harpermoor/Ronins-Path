'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = vm.createContext({ console });
for (const name of ['util', 'preferences', 'effects', 'world', 'skills', 'loadout', 'player', 'settings', 'save', 'game', 'coop', 'duel', 'net']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', name + '.js'), 'utf8'), context);
}
const { lo, g, p, shrine, fxEvents } = vm.runInContext(`(() => {
    const lo = new Loadout(), shrine = { x: 0, y: 0, name: 'Starting Shrine', discovered: true };
    const fxEvents = [];
    const fx = new Proxy({}, { get: (_, name) => (...args) => fxEvents.push({ name, args }) });
    const g = { loadout: lo, skills: new Set(), world: { shrines: [shrine], camps: [],
        resolve() {}, solidAt: () => false }, enemies: [], totalElites: 5, lastShrine: shrine,
        rnd: { nextDouble: () => 1 }, fx, sfx: { play() {} }, time: 0,
        deathblowTarget: () => null, enemyInFront: () => false, projectileHitCheck: () => 240,
        playerHitCheck() {}, shake() {}, hitstop() {}, zoomKick() {} };
    return { lo, g, p: new Player(g, 0, 0), shrine, fxEvents };
})()`, context);
const Game = vm.runInContext('Game', context);

assert.equal(p.throws, 5);
assert.equal(vm.runInContext('PLAYER_DAMAGE_SCALE', context), 0.94);
assert.equal(vm.runInContext('computeStats', context)(lo, 100, 3, new Set()).dmg, 0.94);
const progression = vm.runInContext('playerProgression', context);
assert.equal(progression(0, false).baseMaxHp, 100);
assert.equal(progression(0, false).baseGourds, 3);
assert.equal(progression(2, false).baseMaxHp, 140);
assert.equal(progression(2, false).baseGourds, 4);
assert.equal(progression(3, false).baseMaxHp, 150);
assert.equal(progression(3, false).baseGourds, 5);
assert.equal(progression(20, true).baseMaxHp, 180);
assert.equal(progression(20, true).baseGourds, 5);
const cappedStats = vm.runInContext('computeStats', context)(lo, 500, 20, new Set());
assert.equal(cappedStats.maxHp, 180);
assert.equal(cappedStats.gourds, 5);
assert.equal(p.comboAtk[0].damage, vm.runInContext('P_COMBO[0].damage', context) * 0.94);
assert.equal(p.throwAtk.damage, lo.throwableDef().damage * 0.94);
const gourdsBeforeUse = p.gourds;
p.hp = 1;
p.st = 'HEAL';
p.stT = 0.18;
p.healed = false;
p.update(0.01);
assert.equal(p.hp, 1, 'healing does not resolve before the shortened drink time');
p.update(0.07);
assert.equal(p.hp, p.maxHp * 0.5 + 1, 'gourd healing resolves at 0.25 seconds');
assert.equal(p.gourds, gourdsBeforeUse - 1);
p.update(0.2);
assert.equal(p.st, 'FREE', 'gourd use finishes after 0.45 seconds');
const basePosture = p.maxPosture, baseComboDamage = p.comboAtk[0].damage;
const baseComboPosture = p.comboAtk[0].posture, baseComboRange = p.comboAtk[0].range;
const baseComboWindup = p.comboAtk[0].windup, baseComboActive = p.comboAtk[0].active;
const baseComboRecovery = p.comboAtk[0].recovery, baseDodgeDuration = p.dodgeDuration();
const baseStabWindup = p.stabAtk.windup, baseDodgeIframes = p.dodgeIframes;
g.buddha = true;
p.applyLoadout();
assert.equal(p.maxPosture, basePosture, 'Buddha form increases posture damage, not posture capacity');
assert(Math.abs(p.comboAtk[0].damage - baseComboDamage * 5) < 1e-9);
assert(Math.abs(p.comboAtk[0].posture - baseComboPosture * 5) < 1e-9);
assert(Math.abs(p.comboAtk[0].range - baseComboRange * 1.5) < 1e-9);
assert.equal(p.comboAtk[0].windup, baseComboWindup * 0.8, 'Buddha swings have shorter windups');
assert.equal(p.comboAtk[0].active, baseComboActive * 0.8, 'Buddha swings resolve faster');
assert.equal(p.comboAtk[0].recovery, baseComboRecovery * 0.8, 'Buddha swings recover faster');
assert.equal(p.stabAtk.windup, baseStabWindup * 0.8, 'Buddha heavy attacks also start faster');
assert.equal(p.dodgeDuration(), baseDodgeDuration * 0.8, 'Buddha dodges complete faster');
assert.equal(p.dodgeIframes, baseDodgeIframes * 0.8, 'Buddha dodge invulnerability stays proportional to the shorter dodge');
g.statMods = {};
p.applyLoadout();
assert.equal(p.comboAtk[0].damage, baseComboDamage, 'Buddha combat bonuses do not affect stat-modified matches');
delete g.statMods;
g.buddha = false;
p.applyLoadout();
for (const [id, arc, finisherArc] of [['spear', 42, 54], ['hammer', 150, 185], ['axe', 180, 240]]) {
    lo.sword = id;
    p.applyLoadout();
    assert.equal(p.comboAtk[0].arc, arc * Math.PI / 180);
    assert.equal(p.comboAtk[2].arc, finisherArc * Math.PI / 180);
}
for (const id of ['storm-spear', 'serpent-spear', 'war-hammer', 'stone-hammer']) {
    lo.sword = id;
    p.applyLoadout();
    assert.equal(p.sword.id, id);
    assert.equal(p.comboAtk.length, 3);
}
const weaponMenu = new (vm.runInContext('EquipMenu', context))(g);
weaponMenu.tab = 1;
weaponMenu.selectWeaponType(2);
assert(weaponMenu.tabIndices().every(i => vm.runInContext('weaponType(SWORDS[' + i + '])', context) === 'spear'));
assert(weaponMenu.tabIndices().some(i => vm.runInContext('SWORDS[' + i + '].id', context) === 'storm-spear'));
weaponMenu.selectWeaponType(3);
assert(weaponMenu.tabIndices().every(i => vm.runInContext('weaponType(SWORDS[' + i + '])', context) === 'hammer'));
assert(weaponMenu.tabIndices().some(i => vm.runInContext('SWORDS[' + i + '].id', context) === 'stone-hammer'));
for (const id of ['hammer', 'war-hammer', 'stone-hammer', 'axe']) {
    lo.sword = id;
    p.applyLoadout();
    assert.equal(p.stabAtk.name, 'heavy-smash');
    assert.equal(p.stabAtk.perilous, true);
    assert.equal(p.stabAtk.thrust, false);
}
lo.sword = 'spear';
p.applyLoadout();
assert.equal(p.stabAtk.perilous, true);
p.st = 'ATTACK';
p.phase = 0;
p.combo = 0;
p.cur = p.comboAtk[0];
p.stT = p.cur.windup;
p.facing = 0;
p.aimX = 100;
p.aimY = 0;
p.bufParry = 0;
p.bufDodge = 0;
fxEvents.length = 0;
p.attack(0, 0);
assert(fxEvents.some(e => e.name === 'thrust'));
assert(!fxEvents.some(e => e.name === 'slash'));
const effects = new (vm.runInContext('Effects', context))();
effects.thrust(0, 0, 0, 100, 0.2, 14, vm.runInContext('rgb(180, 220, 255)', context));
effects.update(0.1);
assert.equal(effects.thrusts.length, 1);
effects.update(0.11);
assert.equal(effects.thrusts.length, 0);
p.toFree();

// poise: heavy weapons keep swinging through light hits, light weapons and perilous attacks still interrupt
g.flash = () => {};
const P_HIT_RESULT = vm.runInContext('P_HIT', context);
const hitDuringSwing = (id, combo, dmg, perilous) => {
    lo.sword = id;
    p.applyLoadout();
    p.hp = p.maxHp;
    p.invuln = 0;
    p.x = 0;
    p.y = 0;
    p.startAttack(combo);
    assert.equal(p.receive(50, 0, dmg, 10, perilous), P_HIT_RESULT);
    const st = p.st;
    p.toFree();
    return st;
};
assert.equal(hitDuringSwing('wanderer', 0, 14, false), 'STAGGER');
assert.equal(hitDuringSwing('spear', 0, 14, false), 'STAGGER');
assert.equal(hitDuringSwing('hammer', 0, 14, false), 'ATTACK');
assert.equal(hitDuringSwing('hammer', 0, 14, true), 'STAGGER');
assert.equal(hitDuringSwing('hammer', 0, 30, false), 'STAGGER');
assert.equal(hitDuringSwing('stone-hammer', 2, 30, false), 'ATTACK');
lo.sword = 'hammer';
p.applyLoadout();
p.startAttack(0);
p.invuln = 0;
p.receive(50, 0, 14, 10, false);
assert.equal(p.st, 'ATTACK');
p.invuln = 0;
p.receive(50, 0, 14, 10, false);
assert.equal(p.st, 'STAGGER');
p.toFree();
// All combat arts withstand two hits; hammer arts retain their extra armor.
const hitDuringArt = (sword, art, dmg, perilous) => {
    lo.sword = sword;
    lo.art = art;
    p.applyLoadout();
    p.hp = p.maxHp;
    p.invuln = 0;
    p.artCharges = p.maxArtCharges = 10;
    p.tryArt(0);
    assert.equal(p.st, 'ART');
    const hp = p.hp;
    assert.equal(p.receive(50, 0, dmg, 10, perilous), P_HIT_RESULT);
    const st = p.st, taken = hp - p.hp;
    p.toFree();
    return [st, taken];
};
assert.equal(hitDuringArt('hammer', 'earthshaker', 30, true)[0], 'ART');
assert.equal(hitDuringArt('hammer', 'earthshaker', 60, false)[0], 'ART');
assert(hitDuringArt('hammer', 'earthshaker', 30, false)[1] < hitDuringArt('hammer', 'whirlwind', 30, false)[1]);
assert.equal(hitDuringArt('hammer', 'whirlwind', 30, false)[0], 'ART');
assert.equal(hitDuringArt('hammer', 'whirlwind', 30, true)[0], 'ART');
assert.equal(hitDuringArt('wanderer', 'whirlwind', 14, false)[0], 'ART');
for (const art of vm.runInContext('ARTS', context)) {
    lo.sword = art.weapon || 'wanderer';
    lo.art = art.id;
    p.applyLoadout();
    p.hp = p.maxHp;
    p.invuln = 0;
    p.artCharges = 10;
    p.tryArt(0);
    p.stT = art.dur - 0.02;
    for (let i = 0; i < 2; i++) {
        p.invuln = 0;
        assert.equal(p.receive(50, 0, 10, 10, true), P_HIT_RESULT);
        assert.equal(p.st, 'ART', art.id + ' resists hits even during recovery');
        assert.equal(p.artHitsLeft, 1 - i);
    }
    assert(p.hp < p.maxHp);
    p.invuln = 0;
    p.receive(50, 0, 10, 10, true);
    assert.equal(p.st, 'STAGGER', art.id + ' has spent its two-hit armor');
    p.toFree();
}
lo.art = 'whirlwind';
const statsFor = id => { lo.sword = id; return vm.runInContext('computeStats', context)(lo, 100, 3, new Set()).poise; };
assert(statsFor('stone-hammer') > statsFor('war-hammer') && statsFor('war-hammer') > statsFor('hammer'));
assert(statsFor('hammer') > statsFor('axe') && statsFor('axe') > statsFor('odachi') && statsFor('odachi') > statsFor('wanderer'));
lo.sword = 'wanderer';
p.applyLoadout();

// Close-range arts approach a foe without passing through it; Mortal Draw stays planted.
for (const art of vm.runInContext('ARTS.filter(a => a.hits[0].atk.range < 200)', context)) {
    lo.sword = art.weapon || 'wanderer';
    lo.art = art.id;
    p.applyLoadout();
    p.x = p.y = 0;
    p.artCharges = 10;
    p.tryArt(0);
    g.enemies = [{ x: 180, y: 0, r: 15, st: 'ENGAGE' }];
    const before = p.distTo(g.enemies[0]);
    p.stT = 0.1;
    p.artUpdate(0.05, 0);
    assert(p.distTo(g.enemies[0]) < before, art.id + ' moves toward its target');
    p.x = 139;
    p.artUpdate(0.05, 0);
    assert(p.x <= 140, art.id + ' stops short of the enemy body');
    p.toFree();
}
lo.sword = 'wanderer';
lo.art = 'mortal';
p.applyLoadout();
p.x = p.y = 0;
p.artCharges = 10;
p.tryArt(0);
p.stT = 0.1;
p.artUpdate(0.05, 0);
assert.equal(p.x, 0);
p.toFree();
lo.art = 'whirlwind';
p.applyLoadout();
let wideHits = 0;
g.coop = null;
g.enemies = [{ x: -140, y: 0, r: 15, st: 'ENGAGE', takeHit() { wideHits++; } }];
p.facing = 0;
p.hitSet.clear();
Game.prototype.playerHitCheck.call(g, p, p.artAtks[0]);
assert.equal(wideHits, 1, 'Whirlwind hits behind the player beyond its old radius');

// Lock-on is an input-level aim assist, so duels send ordinary synchronized aim coordinates.
const lockInput = { hit: key => key === 'lockOn', mouseHit: () => false, down: () => false,
    mouseDown: () => false, mouseHeldFor: () => 0, endTick() {} };
const nearLock = { x: 100, y: 0, r: 15, st: 'FREE' };
const farLock = { x: 200, y: 0, r: 15, st: 'FREE' };
g.enemies = [farLock, nearLock];
p.readInput(lockInput, -200, 100);
assert.equal(p.lockTarget, nearLock);
assert.equal(p.aimX, 100);
lockInput.hit = () => false;
nearLock.y = 80;
p.readInput(lockInput, -200, 100);
assert.equal(p.aimY, 80);
const DuelForLock = vm.runInContext('Duel', context);
const lockDuel = { input: lockInput, players: [p, nearLock], localIdx: 0, canvas: { width: 800, height: 600 },
    camX: 0, camY: 0, zoom: () => 1, mouseAttackPending: false };
lockInput.mx = lockInput.my = 0;
const lockedSample = DuelForLock.prototype.sampleLocal.call(lockDuel);
assert.equal(lockedSample[2], 100);
assert.equal(lockedSample[3], 80);
lockInput.hit = key => key === 'lockOn';
p.readInput(lockInput, -200, 100);
assert.equal(p.lockTarget, null);
assert.equal(p.aimX, -200);
lockInput.hit = key => key === 'lockOn';
p.readInput(lockInput, 0, 0);
assert.equal(p.lockTarget, nearLock);
lockInput.hit = () => false;
nearLock.st = 'DEAD';
p.readInput(lockInput, 0, 0);
assert.equal(p.lockTarget, null);
p.lockTarget = farLock;
farLock.x = 651;
p.readInput(lockInput, 0, 0);
assert.equal(p.lockTarget, null);
p.lockTarget = nearLock;
g.enemies = [];
p.readInput(lockInput, 0, 0);
assert.equal(p.lockTarget, null, 'Removed targets release the lock');

const artControlsPlayer = new (vm.runInContext('Player', context))(g, 0, 0);
artControlsPlayer.guardHeld = true;
artControlsPlayer.artCharges = artControlsPlayer.maxArtCharges;
artControlsPlayer.bufAttack = 0.22;
artControlsPlayer.free(0, 0);
assert.equal(artControlsPlayer.st, 'ATTACK', 'guard plus attack must not trigger a combat art');
assert.equal(artControlsPlayer.artCharges, artControlsPlayer.maxArtCharges);
artControlsPlayer.toFree();
artControlsPlayer.bufArt = 0.2;
artControlsPlayer.free(0, 0);
assert.equal(artControlsPlayer.st, 'ART', 'the dedicated combat art button still works');

// Red sweeps deflect only in the half-window; thrusts and other perilous moves remain unguardable.
g.parryBurst = () => {};
const defend = (age, perilous, sweep, sourceX = 50, thrust = false) => {
    p.toFree();
    p.x = p.y = 0;
    p.facing = 0;
    p.hp = p.maxHp;
    p.invuln = 0;
    p.posture = 0;
    p.guarding = true;
    p.guardWindow = 0.18;
    g.time = 0;
    p.guardStart = -age;
    fxEvents.length = 0;
    return p.receive(sourceX, 0, 14, 10, perilous, sweep, thrust);
};
const deflectResult = vm.runInContext('P_DEFLECT', context);
const perfectResult = vm.runInContext('P_PERFECT', context);
const perfectParryWindow = vm.runInContext('PERFECT_PARRY_WINDOW', context);
assert.equal(defend(0.09, true, true), deflectResult);
assert(fxEvents.some(e => e.name === 'impact' && e.args[2] === 'sweep'));
assert.equal(defend(0.09001, true, true), P_HIT_RESULT);
assert(!fxEvents.some(e => e.name === 'impact'));
assert.equal(defend(0.19, true, true), P_HIT_RESULT);
assert.equal(defend(0.01, true, false, 50, true), P_HIT_RESULT);
assert.equal(defend(0.01, true, true, -50), P_HIT_RESULT);
assert.equal(defend(0.1, false, false), deflectResult);
assert(!fxEvents.some(e => e.name === 'impact'));
assert.equal(defend(0.19, false, false), vm.runInContext('P_BLOCK', context));
p.ki = 0;
assert.equal(defend(0.03, false, false), perfectResult);
assert.equal(p.ki, 24);
assert.equal(p.posture, 0);
assert(fxEvents.some(e => e.name === 'text' && e.args[0] === 'PERFECT PARRY'));
assert(fxEvents.some(e => e.name === 'impact' && e.args[2] === 'parry'));
assert.equal(defend(perfectParryWindow, false, false), perfectResult);
assert.equal(defend(perfectParryWindow + 0.00001, false, false), deflectResult,
   'a deflect just outside the configured perfect window must not grant a perfect parry');
assert.equal(defend(0.04, false, false), perfectResult);
assert.equal(defend(0.06, false, false), deflectResult);
assert.equal(defend(perfectParryWindow, true, true), perfectResult);
g.buddha = true;
assert.equal(defend(0.14, true, false, 50, true), vm.runInContext('P_BUDDHA_MIKIRI', context),
    'a perfect Buddha block counters perilous thrusts');
assert.equal(defend(0.14001, true, false, 50, true), P_HIT_RESULT,
    'Buddha thrust counters still require perfect timing');
assert.equal(defend(0.14, true, true), vm.runInContext('P_BUDDHA_SWEEP', context),
    'a perfect Buddha block counters perilous sweeps');
assert.equal(defend(0.14, false, true), vm.runInContext('P_BUDDHA_SWEEP', context),
    'a perfect Buddha block also counters regular sweep attacks');
assert.equal(defend(0.14001, true, true), deflectResult,
    'a non-perfect block deflects, but does not counter, a perilous sweep');
g.buddha = false;
p.guardWindow = 0.05;
p.guardStart = -0.05001;
assert.equal(p.receive(50, 0, 14, 10, false), vm.runInContext('P_BLOCK', context),
   'perfect parries cannot exceed the spam-shortened guard window');
for (const hp of [p.maxHp, 1]) {
    defend(0.19, false, false);
    p.hp = hp;
    p.posture = p.maxPosture - 1;
    assert.equal(p.receive(50, 0, 40, 10, false), vm.runInContext('P_BLOCK', context));
    assert.equal(p.hp, hp, 'guard breaks deal no damage, even at one HP');
    assert.equal(p.st, 'STAGGER');
    assert.equal(p.staggerDur, 1.2, 'guard breaks retain their punishable opening');
    assert.equal(p.guarding, false);
    assert.equal(p.posture, p.maxPosture * 0.6);
    assert.equal(p.receive(50, 0, 0.1, 10, false), P_HIT_RESULT,
       'follow-up attacks still punish a broken guard');
    assert(p.hp < hp);
}
p.toFree();
p.hp = p.maxHp;
p.invuln = 0;
p.guarding = false;

// Impact frames briefly tint the whole scene without hiding the fighters, then expire on real time.
effects.impact(0, 0, 'mikiri');
const fills = [];
const impactCanvas = new Proxy({ fillRect(x, y, w, h) {
   fills.push({ x, y, w, h, color: this.fillStyle, alpha: this.globalAlpha });
} },
   { get: (obj, key) => key in obj ? obj[key] : () => {} });
effects.drawImpact(impactCanvas, 800, 600, 0, 0, 1);
assert(fills.some(f => f.w === 800 && f.h === 600 && f.color === '#fff8e8' && f.alpha > 0 && f.alpha < 1));
effects.updateImpact(0.1);
effects.drawImpact(impactCanvas, 800, 600, 0, 0, 1);
assert(fills.some(f => f.w === 800 && f.h === 600 && f.color === '#080b14'));
effects.updateImpact(0.3);
assert(effects.impactFrame, 'impact frames stay visible for the longer display duration');
effects.updateImpact(0.1);
assert.equal(effects.impactFrame, null);
effects.impact(0, 0, 'parry');
assert.equal(effects.impactFrame.left, vm.runInContext('IMPACT_FRAME_DURATION', context));
effects.updateImpact(0.09);
assert(effects.impactFrame, 'impact frame remains visible through hitstop and its immediate aftermath');
effects.updateImpact(0.3);
assert(effects.impactFrame);
effects.updateImpact(0.1);
assert.equal(effects.impactFrame, null);
g.slowmo = () => {};
g.flash = () => {};
fxEvents.length = 0;
p.toFree();
p.facing = 0;
p.st = 'DODGE';
p.stT = 0.1;
p.dodgeIframes = 0.25;
p.dodgeDx = 1;
p.dodgeDy = 0;
p.guardWindow = 0.18;
p.bufParry = 0.15;
p.bufAttack = 0;
p.update(0.01);
assert.equal(p.st, 'DODGE', 'parrying does not cancel the ongoing dodge');
assert(p.guarding, 'a parry input during a dodge opens a parry window immediately');
assert.equal(p.receive(50, 0, 14, 10, false), perfectResult,
    'a timed parry takes priority over dodge invulnerability');
assert.equal(p.st, 'DODGE', 'a successful parry preserves the dodge');
p.toFree();
p.guarding = false;
p.bufParry = 0;
p.stT = 0;
p.st = 'DODGE';
p.dodgeStartX = 10;
p.dodgeStartY = 20;
p.stT = 0;
p.dodgeIframes = 0.25;
p.ki = 0;
assert.equal(p.receive(50, 0, 14, 10, false), vm.runInContext('P_PERFECT_DODGE', context));
assert.equal(p.ki, 18);
assert.equal(p.afterimage.x, 10);
assert.equal(p.afterimage.y, 20);
assert.equal(p.afterimage.expires, g.time + 2);
assert.equal(p.afterimage.receive(), vm.runInContext('P_IGNORE', context));
assert(fxEvents.some(e => e.name === 'text' && e.args[0] === 'PERFECT DODGE'));
assert(fxEvents.some(e => e.name === 'impact' && e.args[2] === 'dodge'));
p.st = 'DODGE';
p.stT = 0.05;
assert.equal(p.receive(50, 0, 14, 10, false), vm.runInContext('P_PERFECT_DODGE', context),
   'the first 50 ms of a dodge grant a perfect counter');
const dodgeKi = p.ki;
fxEvents.length = 0;
for (const age of [vm.runInContext('PERFECT_DODGE_WINDOW', context) + 0.00001, 0.21]) {
   p.stT = age;
   assert.equal(p.receive(50, 0, 14, 10, false), vm.runInContext('P_IGNORE', context),
      'later dodge invulnerability must not grant a perfect counter');
}
assert.equal(p.ki, dodgeKi);
assert(!fxEvents.some(e => e.name === 'impact'));
p.toFree();
const mikiriFoe = { x: 100, y: 0, posture: 0, maxPosture: 100, releaseToken() {}, setSt(st) { this.st = st; } };
g.resolveCounter = Game.prototype.resolveCounter;
fxEvents.length = 0;
Game.prototype.onMikiri.call(g, p, mikiriFoe);
assert(fxEvents.some(e => e.name === 'impact' && e.args[2] === 'mikiri'));
const sweepCounterFoe = { x: 100, y: 0, posture: 0, maxPosture: 100, releaseToken() {}, setSt(st) { this.st = st; } };
fxEvents.length = 0;
Game.prototype.onSweepCounter.call(g, p, sweepCounterFoe);
assert.equal(sweepCounterFoe.posture, 50);
assert.equal(sweepCounterFoe.st, 'STUN');
assert(fxEvents.some(e => e.name === 'text' && e.args[0] === 'SWEEP COUNTER'));
assert(fxEvents.some(e => e.name === 'impact' && e.args[2] === 'sweep'));
delete g.resolveCounter;
let guestMikiri = false;
g.coop = { host: false, settings: { friendlyFire: false }, action() { guestMikiri = true; } };
fxEvents.length = 0;
Game.prototype.onMikiri.call(g, p, mikiriFoe);
assert(guestMikiri);
assert(fxEvents.some(e => e.name === 'impact' && e.args[2] === 'mikiri'));
g.coop = null;

// weapon-tuned armor: bonuses only apply with the matching weapon type
const stats = () => vm.runInContext('computeStats', context)(lo, 100, 3, new Set());
lo.armor = 'ashigaru';
lo.sword = 'spear';
const spearStats = stats();
lo.armor = 'traveler';
const plainSpear = stats();
assert.equal(spearStats.reach, plainSpear.reach + 10);
assert(spearStats.spd < plainSpear.spd);
assert(spearStats.move > plainSpear.move);
lo.armor = 'ashigaru';
lo.sword = 'wanderer';
assert.equal(stats().reach, 0);
lo.armor = 'oyoroi';
lo.sword = 'hammer';
const hammerStats = stats();
assert.equal(hammerStats.poise, 26 + 14);
assert(hammerStats.post > 1.65);
assert(hammerStats.def < 0.78 && hammerStats.maxPosture === 135);
lo.sword = 'spear';
assert.equal(stats().poise, 0);
const CoopForArmor = vm.runInContext('Coop', context);
lo.armor = 'traveler';
lo.sword = 'wanderer';
p.applyLoadout();
CoopForArmor.syncGear(p, { sword: 'stone-hammer', armor: 'oyoroi' });
assert.equal(lo.armor, 'oyoroi');
assert.equal(p.poise, 38 + 14);
CoopForArmor.syncGear(p, { armor: 'not-real' });
assert.equal(lo.armor, 'oyoroi');
lo.armor = 'traveler';
lo.sword = 'wanderer';
p.applyLoadout();

const arts = vm.runInContext('ARTS', context);
const spearArt = arts.find(a => a.id === 'spearfall');
const hammerArt = arts.find(a => a.id === 'earthshaker');
const matchesWeapon = vm.runInContext('artMatchesWeapon', context);
assert.equal(spearArt.weapon, 'spear');
assert.equal(hammerArt.weapon, 'hammer');
assert.equal(spearArt.motion, 'thrust');
assert.equal(hammerArt.motion, 'slam');
assert(matchesWeapon(spearArt, vm.runInContext('findItem(SWORDS, "spear")', context)));
assert(matchesWeapon(spearArt, vm.runInContext('findItem(SWORDS, "storm-spear")', context)));
assert(matchesWeapon(spearArt, vm.runInContext('findItem(SWORDS, "serpent-spear")', context)));
assert(!matchesWeapon(spearArt, vm.runInContext('findItem(SWORDS, "hammer")', context)));
assert(matchesWeapon(hammerArt, vm.runInContext('findItem(SWORDS, "war-hammer")', context)));
assert(matchesWeapon(hammerArt, vm.runInContext('findItem(SWORDS, "stone-hammer")', context)));
assert(matchesWeapon(arts.find(a => a.id === 'whirlwind'), vm.runInContext('findItem(SWORDS, "hammer")', context)));

lo.sword = 'spear';
lo.art = hammerArt.id;
p.applyLoadout();
p.artCharges = 3;
p.tryArt(0);
assert.equal(p.st, 'FREE');
assert.equal(p.artCharges, 3);
lo.art = spearArt.id;
p.applyLoadout();
p.artCharges = 3;
p.tryArt(0);
assert.equal(p.st, 'ART');
fxEvents.length = 0;
p.stT = spearArt.hits[0].t;
p.artUpdate(0, 0);
assert(fxEvents.some(e => e.name === 'thrust'));
p.toFree();

lo.sword = 'hammer';
lo.art = hammerArt.id;
p.applyLoadout();
p.artCharges = 3;
p.tryArt(0);
assert.equal(p.st, 'ART');
fxEvents.length = 0;
p.stT = hammerArt.hits[0].t;
p.artUpdate(0, 0);
assert(fxEvents.some(e => e.name === 'slash'));
assert(fxEvents.some(e => e.name === 'ring'));
p.toFree();

lo.throwable = 'throwingaxe';
p.applyLoadout();
assert.equal(p.maxThrows, 3);
assert.equal(p.throws, 3);
p.aimX = 240;
p.aimY = 0;
p.bufThrow = 0.2;
for (let i = 0; i < 25; i++) p.update(1 / 60);
assert.equal(p.throws, 2);
assert.equal(p.st, 'FREE');
assert.equal(p.throwDone, false);

const target = vm.runInContext('projectileTarget', context);
const near = { x: 120, y: 0, r: 15, st: 'FREE' };
const far = { x: 180, y: 0, r: 15, st: 'FREE' };
assert.equal(target(p, p.throwAtk, [far, near], g.world).target, near);
g.world.solidAt = x => x >= 60 && x <= 70;
assert.equal(target(p, p.throwAtk, [near], g.world).target, null);
g.world.solidAt = () => false;
let struck = 0;
near.takeHit = () => { struck++; };
g.enemies = [near, far];
Game.prototype.projectileHitCheck.call(g, p, p.throwAtk);
assert.equal(struck, 1);
g.world.solidAt = x => x >= 60 && x <= 70;
Game.prototype.projectileHitCheck.call(g, p, p.throwAtk);
assert.equal(struck, 1);
g.world.solidAt = () => false;
g.enemies = [];

const Coop = vm.runInContext('Coop', context);
const remote = new (vm.runInContext('Player', context))(g, 0, 0);
remote.g = Object.assign(Object.create(g), { loadout: lo.clone() });
Coop.syncGear(remote, { sword: 'axe', throwable: 'kunai' });
assert.equal(remote.sword.id, 'axe');
assert.equal(remote.throwable.id, 'kunai');
Coop.syncGear(remote, { sword: 'storm-spear', art: 'spearfall' });
assert.equal(remote.sword.id, 'storm-spear');
assert.equal(remote.art.id, 'spearfall');
Coop.syncGear(remote, { sword: 'hammer', art: 'spearfall' });
assert.equal(remote.sword.id, 'hammer');
assert.equal(remote.art.id, 'whirlwind');
Coop.syncGear(remote, { sword: 'invalid', throwable: 'invalid' });
assert.equal(remote.sword.id, 'hammer');
assert.equal(Coop.playerData(remote).art, 'whirlwind');

const SaveGame = vm.runInContext('SaveGame', context);
Object.assign(g, { seed: 123, kills: 0, elitesSlain: 0, ngPlus: 0, bossSpawned: false,
    bossDefeated: false, exp: 0, pointsEarned: 0, player: p });
const save = SaveGame.serialize(g);
assert.equal(save.player.throws, 2);
p.throws = 0;
SaveGame.apply(g, save);
assert.equal(p.throws, 2);
save.player.throws = 999;
SaveGame.apply(g, save);
assert.equal(p.throws, 3);
delete save.player.throws;
p.throws = 0;
SaveGame.apply(g, save);
assert.equal(p.throws, 3);

assert.equal(vm.runInContext('sanitizeInput', context)([0, 0, 0, 0, 2048])[4], 2048);
assert(vm.runInContext('PLAYER_SYNC', context).includes('throws'));
assert(vm.runInContext('PLAYER_SYNC', context).includes('poiseLeft'));
assert(vm.runInContext('COOP_PLAYER_FIELDS', context).includes('poiseLeft'));
assert(vm.runInContext('PLAYER_SYNC', context).includes('artHitsLeft'));
assert(vm.runInContext('COOP_PLAYER_FIELDS', context).includes('artHitsLeft'));
assert.equal(vm.runInContext('NET_VERSION', context), 13);
assert.equal(vm.runInContext('COOP_SYNC_INTERVAL', context), 0.05);
const Duel = vm.runInContext('Duel', context);
const duel = { n: 1, players: [p] };
p.st = 'THROW';
p.throwDone = true;
p.throws = 1;
p.artHitsLeft = 1;
const packed = Duel.prototype.packPlayer.call(duel, p);
p.throwDone = false;
p.throws = 0;
p.artHitsLeft = 0;
Duel.prototype.unpackPlayer.call(duel, p, packed);
assert.equal(p.throwDone, true);
assert.equal(p.throws, 1);
assert.equal(p.artHitsLeft, 1);
p.toFree();
p.throws = 0;
g.nearShrine = () => shrine;
g.findRestBlockers = () => [];
g.banner = () => {};
g.saveNow = () => {};
for (const name of ['restAtShrine', 'canUseShrine', 'activateShrineAction']) g[name] = Game.prototype[name];
g.player = p;
g.note = () => {};
g.shrineMenu = null;
p.hp = 1;
p.gourds = 0;
p.posture = 50;
Game.prototype.interact.call(g, false);
assert.equal(g.shrineMenu, null, 'quick rest does not open the shrine menu');
assert.equal(p.hp, p.maxHp);
assert.equal(p.gourds, p.maxGourds);
assert.equal(p.throws, p.maxThrows);
assert.equal(p.posture, 0);
assert.equal(g.lastShrine, shrine);
g.buddha = true;
p.buddhaReviveReady = false;
p.buddhaDeathblows = 4;
Game.prototype.restAtShrine.call(g, shrine);
assert.equal(p.buddhaReviveReady, true, 'resting at a shrine restores the Buddha revive');
assert.equal(p.buddhaDeathblows, 0);
g.buddha = false;
g.findRestBlockers = () => [{ x: 10, y: 10 }];
p.hp = 1;
Game.prototype.interact.call(g, false);
assert.equal(p.hp, 1, 'quick rest is blocked by nearby enemies');
assert.equal(g.shrineMenu, null);
g.findRestBlockers = () => [];
g.nearShrine = () => null;
Game.prototype.interact.call(g, false);
assert.equal(p.hp, 1, 'quick rest requires a nearby shrine');
g.nearShrine = () => shrine;
p.st = 'ATTACK';
Game.prototype.interact.call(g, false);
assert.equal(p.hp, 1, 'quick rest requires the player to be free');
p.st = 'DEAD';
p.deadT = 2;
Game.prototype.interact.call(g, false);
assert.equal(p.st, 'DEAD', 'quick rest is not a resurrection shortcut');
p.toFree();
Game.prototype.interact.call(g);
assert.equal(p.throws, 3);
assert.equal(g.shrineMenu, shrine);
assert.equal(g.shrineCategory, 'sanctuary');
g.skillPoints = 3;
g.saveSoon = () => {};
weaponMenu.atShrine = false;
weaponMenu.learn(0);
assert(!g.skills.has('keen'), 'equipment must not spend skill points');
assert.equal(g.skillPoints, 3);
weaponMenu.show(true);
weaponMenu.learn(0);
assert(g.skills.has('keen'), 'safe shrine menu can learn skills');
assert.equal(g.skillPoints, 2);
g.findRestBlockers = () => [{}];
weaponMenu.learn(1);
assert(!g.skills.has('crush'), 'unsafe shrine must reject skill upgrades');
assert.equal(g.skillPoints, 2);
g.findRestBlockers = () => [];
const destination = { x: 1200, y: 800, name: 'Travel Shrine', discovered: false };
g.world.shrines.push(destination);
g.activateShrineAction('travel:1');
assert.equal(g.shrineMenu, shrine, 'undiscovered destinations are locked');
destination.discovered = true;
g.findRestBlockers = s => s === destination ? [{}] : [];
g.activateShrineAction('travel:1');
assert.equal(g.shrineMenu, shrine, 'unsafe destinations are locked');
g.findRestBlockers = () => [];
g.activateShrineAction('travel:1');
assert.equal(p.x, destination.x);
assert.equal(p.y, destination.y + 60);
assert.equal(g.lastShrine, destination);
assert.equal(g.shrineMenu, destination);
assert.equal(p.hp, p.maxHp);
assert.equal(g.camX, p.x);
g.activateShrineAction('leave');
assert.equal(g.shrineMenu, null);
weaponMenu.learn(1);
assert(!g.skills.has('crush'), 'closing a shrine revokes upgrade access');
g.skills.delete('keen');
g.world.shrines.pop();
const menuCanvas = new Proxy({
   measureText: s => ({ width: s.length * 7 }),
   createLinearGradient: () => ({ addColorStop() {} }),
}, { get: (obj, key) => key in obj ? obj[key] : () => {} });
const menuGame = Object.assign(Object.create(Game.prototype), g, {
   text() {}, coop: null, guestJourney: false, pauseSelection: 0,
   resetMapConfirmT: 0, newGameConfirmT: 0, shrineMenu: shrine, shrineSelection: 0,
   player: Object.assign(Object.create(p), { x: shrine.x, y: shrine.y + 60, st: 'FREE' }),
});
for (const [width, height] of [[1280, 720], [640, 360], [360, 640]]) {
   menuGame.drawPauseMenu(menuCanvas, width, height);
   const pauseRects = menuGame.pauseRects;
   for (const category of ['sanctuary', 'travel']) {
      menuGame.activateShrineAction('category:' + category);
      menuGame.drawShrineMenu(menuCanvas, width, height);
      assert.equal(menuGame.pauseRects, pauseRects, 'shrine rendering must not replace pause hit targets');
      assert.equal(menuGame.shrineRects.some(r => r.action === 'rest'), category === 'sanctuary');
      assert.equal(menuGame.shrineRects.some(r => r.action.startsWith('travel:')), category === 'travel');
      for (const rect of [...menuGame.pauseRects, ...menuGame.shrineRects]) {
         assert(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= width && rect.y + rect.h <= height,
            'menu buttons must fit the viewport');
      }
   }
}
const extraShrines = Array.from({ length: 12 }, (_, i) => ({
   x: 1000 + i * 500, y: 1000, name: 'Destination ' + i, discovered: i !== 1,
}));
g.world.shrines.push(...extraShrines);
menuGame.findRestBlockers = s => s === extraShrines[2] ? [{}] : [];
menuGame.activateShrineAction('category:travel');
menuGame.drawShrineMenu(menuCanvas, 640, 360);
assert.equal(menuGame.shrineRects.filter(r => r.action.startsWith('travel:')).length, 6);
assert(menuGame.shrineRects.find(r => r.action === 'travel:0').disabled, 'current destination is disabled');
assert(menuGame.shrineRects.find(r => r.action === 'travel:2').disabled, 'undiscovered destination is disabled');
assert(menuGame.shrineRects.find(r => r.action === 'travel:3').disabled, 'unsafe destination is disabled');
assert(menuGame.shrineRects.find(r => r.action === 'travel-prev').disabled);
const nextRect = menuGame.shrineRects.find(r => r.action === 'travel-next');
const menuInput = { mx: nextRect.x + nextRect.w / 2, my: nextRect.y + nextRect.h / 2,
   hit: () => false, mouseHit: () => true, mouseDown: () => true };
menuGame.navigateMenu(menuInput, menuGame.shrineRects, 'shrineSelection', action => menuGame.activateShrineAction(action));
assert.equal(menuGame.shrinePage, 1, 'scaled next-page button activates on mouse press');
menuGame.activateShrineAction('travel-next');
menuGame.activateShrineAction('travel-next');
assert.equal(menuGame.shrinePage, 2, 'pages clamp to available destinations');
menuGame.drawShrineMenu(menuCanvas, 640, 360);
assert.equal(menuGame.shrineRects.filter(r => r.action.startsWith('travel:')).length, 1);
assert(menuGame.shrineRects.find(r => r.action === 'travel-next').disabled);
menuGame.findRestBlockers = () => [{}];
menuGame.activateShrineAction('category:sanctuary');
menuGame.drawShrineMenu(menuCanvas, 640, 360);
assert(menuGame.shrineRects.find(r => r.action === 'rest').disabled);
assert(menuGame.shrineRects.find(r => r.action === 'skills').disabled);
assert(!menuGame.shrineRects.find(r => r.action === 'leave').disabled);
g.world.shrines.splice(1);
menuGame.findRestBlockers = () => [];
menuGame.drawShrineMenu(menuCanvas, 640, 360);
const restRect = menuGame.shrineRects.find(r => r.action === 'rest');
menuGame.input = { mx: restRect.x + 1, my: restRect.y + 1, mouseDown: () => false };
const shrineButtonFills = [];
menuCanvas.fill = () => shrineButtonFills.push(menuCanvas.fillStyle);
menuGame.drawShrineMenu(menuCanvas, 640, 360);
assert(shrineButtonFills.includes('rgb(76,57,39)'), 'hover is visibly highlighted');
shrineButtonFills.length = 0;
menuGame.input.mouseDown = () => true;
menuGame.drawShrineMenu(menuCanvas, 640, 360);
assert(shrineButtonFills.includes('rgb(111,76,40)'), 'held button gives immediate pressed feedback');
let activated = null;
const input = { hit: key => key === 'listNext', mouseHit: () => false };
menuGame.navigateMenu(input, [{ action: 'a' }, { action: 'locked', disabled: true }, { action: 'b' }],
   'pauseSelection', action => { activated = action; });
assert.equal(menuGame.pauseSelection, 1);
input.hit = key => key === 'listConfirm';
assert(menuGame.navigateMenu(input, [{ action: 'a' }, { action: 'locked', disabled: true }, { action: 'b' }],
   'pauseSelection', action => { activated = action; }));
assert.equal(activated, 'b', 'keyboard selection skips disabled actions');
const hoverRects = [{ action: 'a', x: 0, y: 0, w: 40, h: 40 }, { action: 'b', x: 50, y: 0, w: 40, h: 40 }];
const hoverInput = { mx: 60, my: 20, hit: () => false, mouseHit: () => false };
menuGame.navigateMenu(hoverInput, hoverRects, 'shrineSelection', () => {});
assert.equal(menuGame.shrineSelection, 1, 'moving the pointer selects the hovered button');
hoverInput.hit = key => key === 'listPrevious';
menuGame.navigateMenu(hoverInput, hoverRects, 'shrineSelection', () => {});
assert.equal(menuGame.shrineSelection, 0);
hoverInput.hit = () => false;
menuGame.navigateMenu(hoverInput, hoverRects, 'shrineSelection', () => {});
assert.equal(menuGame.shrineSelection, 0, 'stationary pointer must not steal keyboard focus');

const pointerEvents = {}, canvasEvents = {};
context.window = { addEventListener: (name, fn) => { pointerEvents[name] = fn; } };
context.performance = { now: () => 100 };
const Input = vm.runInContext('Input', context);
const pointerInput = new Input({ width: 1280, height: 720,
   focus() {},
   getBoundingClientRect: () => ({ left: 20, top: 30, width: 640, height: 360 }),
   addEventListener: (name, fn) => { canvasEvents[name] = fn; },
}, () => {});
canvasEvents.mousedown({ button: 0, clientX: 120, clientY: 80, preventDefault() {} });
assert.equal(pointerInput.mx, 200, 'press coordinates account for CSS canvas scaling without requiring mouse movement');
assert.equal(pointerInput.my, 100);
assert(pointerInput.mouseHit(1));
pointerEvents.mousemove({ clientX: 220, clientY: 180 });
assert.equal(pointerInput.mx, 400);
assert.equal(pointerInput.my, 300);
p.throws = 0;
p.respawn(shrine.x, shrine.y);
assert.equal(p.throws, 3);

g.player = p;
Object.assign(g, { parryBurst() {}, hitstop() {}, shake() {}, zoomKick() {}, flash() {} });
fxEvents.length = 0;
Coop.prototype.receiveImpact.call({ game: g }, {
    result: vm.runInContext('P_DEFLECT', context), hp: p.hp, posture: p.posture, ki: p.ki,
    artCharges: p.artCharges, st: p.st, deflectStreak: 2, sourceX: p.x + 20, sourceY: p.y, perilous: true,
});
assert(p.guardFlash > 0);
assert(fxEvents.some(e => e.name === 'sparks'));
assert(fxEvents.some(e => e.name === 'ring'));
assert(fxEvents.some(e => e.name === 'text'));
assert(fxEvents.some(e => e.name === 'impact' && e.args[2] === 'sweep'));
p.st = 'ART';
p.artHitsLeft = 2;
Coop.prototype.receiveImpact.call({ game: g }, {
    result: vm.runInContext('P_HIT', context), hp: p.hp - 10, posture: p.posture,
    st: 'ART', invuln: 0.2, artHitsLeft: 1, sourceX: p.x + 20, sourceY: p.y,
});
assert.equal(p.st, 'ART');
assert.equal(p.artHitsLeft, 1);
const armorState = { artHitsLeft: 0 };
Coop.apply(armorState, { artHitsLeft: 500 }, ['artHitsLeft']);
assert.equal(armorState.artHitsLeft, 2);
Coop.apply(armorState, { artHitsLeft: -1 }, ['artHitsLeft']);
assert.equal(armorState.artHitsLeft, 0);
Coop.prototype.receiveImpact.call({ game: g }, {
    result: vm.runInContext('P_HIT', context), hp: p.hp - 10, posture: p.posture + 5, ki: p.ki,
    artCharges: p.artCharges, st: 'STAGGER', stT: 0.08, staggerDur: 0.55, guarding: false,
    vx: -230, vy: 40, invuln: 0.35, poiseLeft: p.poiseLeft, sourceX: p.x + 20, sourceY: p.y,
});
assert.equal(p.st, 'STAGGER');
assert.equal(p.stT, 0.08);
assert.equal(p.staggerDur, 0.55);
assert.equal(p.vx, -230);
assert.equal(p.vy, 40);

let now = 0;
context.performance = { now: () => now };
const coop = { renderPositions: new Map() }, entity = { x: 0, y: 0, facing: 0 };
Coop.prototype.updateRenderPosition.call(coop, entity);
entity.x = 100;
entity.y = 50;
Coop.prototype.updateRenderPosition.call(coop, entity);
now = 25;
let renderedX = 0, renderedY = 0;
Coop.prototype.drawEntity.call(coop, entity, () => { renderedX = entity.x; renderedY = entity.y; });
assert.equal(renderedX, 50);
assert.equal(renderedY, 25);
assert.equal(entity.x, 100);
assert.equal(entity.y, 50);
console.log('Weapon and throwable checks passed');
