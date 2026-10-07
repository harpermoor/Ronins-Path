'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const events = new Map(), targetEvents = new Map(), storage = new Map(), warnings = [];
let now = 1000, storageBlocked = false;
const canvas = {
    width: 800, height: 600,
    addEventListener(name, handler) { targetEvents.set(name, handler); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; },
    focus() { context.document.activeElement = canvas; },
};
const context = vm.createContext({
    console: { warn(...args) { warnings.push(args); } },
    performance: { now: () => now },
    window: { addEventListener(name, handler) { events.set(name, handler); } },
    document: { activeElement: canvas },
    localStorage: {
        getItem(key) { if (storageBlocked) throw new Error('Blocked'); return storage.get(key) || null; },
        setItem(key, value) { if (storageBlocked) throw new Error('Blocked'); storage.set(key, value); },
    },
});
for (const name of ['util', 'preferences', 'sfx', 'effects', 'world', 'skills', 'loadout', 'player', 'settings', 'save', 'game', 'net', 'duel']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', name + '.js'), 'utf8'), context);
}
const { Preferences, CONTROL_DEFS, Input, Sfx, Effects, Player, Duel, sanitizePreferences } = vm.runInContext(
    '({ Preferences, CONTROL_DEFS, Input, Sfx, Effects, Player, Duel, sanitizePreferences })', context);
const defaults = JSON.stringify(Preferences.value);
assert.equal(Preferences.read(), true);
assert.equal(JSON.stringify(Preferences.value), defaults);
const sanitized = sanitizePreferences({
    volume: 300, shake: -10, muted: 'yes', particles: false,
    bindings: { attack: ['Invalid'], moveUp: [], heal: ['KeyH', 'KeyH'], guard: ['Mouse4'], art: ['KeyA', 'KeyB', 'KeyC', 'KeyD'] },
});
assert.equal(sanitized.volume, 100);
assert.equal(sanitized.shake, 0);
assert.equal(sanitized.muted, false);
assert.equal(sanitized.particles, false);
assert.equal(sanitized.bindings.attack[0], 'Mouse0');
assert.equal(sanitized.bindings.moveUp.length, 0);
assert.equal(sanitized.bindings.heal.length, 1);
assert.equal(sanitized.bindings.guard[0], 'Mouse4');
assert.equal(sanitized.bindings.art[0], 'KeyR');
assert.equal(sanitizePreferences({ volume: NaN }).volume, 100);
assert.equal(sanitizePreferences(null).volume, 100);

let gestures = 0, prevented = 0;
const input = new Input(canvas, () => gestures++);
const key = (code, type = 'keydown') => events.get(type)({ code, preventDefault() { prevented++; } });
const mouse = (button, type = 'mousedown') => (type === 'mousedown' ? targetEvents : events).get(type)({
    button, clientX: 200, clientY: 100, preventDefault() { prevented++; },
});
key('KeyW');
assert(input.down('moveUp'));
assert(input.hit('moveUp'));
input.endTick();
key('KeyW');
assert(!input.hit('moveUp'), 'keyboard repeats do not generate another hit');
key('KeyW', 'keyup');
key('ArrowUp');
assert(input.down('moveUp'), 'default alternate bindings remain active');
input.releaseAll();
mouse(2);
assert(input.down('guard'));
assert(input.mouseDown(3), 'raw UI mouse methods retain their old numbering');
mouse(2, 'mouseup');

// Every action accepts keyboard and mouse bindings independently, including formerly hard-coded aliases.
for (const action of Object.keys(CONTROL_DEFS)) {
    input.releaseAll();
    Preferences.value.bindings[action] = ['KeyZ'];
    key('KeyZ');
    assert(input.down(action), action + ' can be rebound to a keyboard key');
    assert(input.hit(action));
    now += 400;
    assert(input.heldFor(action) >= 0.4);
    input.consumeHit(action);
    assert(!input.hit(action));
    input.releaseAll();
    Preferences.value.bindings[action] = ['Mouse4'];
    mouse(4);
    assert(input.down(action), action + ' can be rebound to a side mouse button');
    assert(input.hit(action));
    input.consumeHit(action);
    assert(!input.hit(action));
    mouse(4, 'mouseup');
    assert(!input.down(action));
}
Preferences.value = sanitizePreferences(JSON.parse(defaults));
Preferences.value.bindings.moveUp = ['KeyZ'];
key('KeyW');
assert(!input.down('moveUp'), 'rebinding removes the original key');
input.releaseAll();
Preferences.open = true;
key('KeyZ');
mouse(0);
assert(!input.down('moveUp') && !input.hit('attack'), 'settings interaction does not leak into gameplay');
Preferences.open = false;
context.document.activeElement = {};
key('KeyZ');
assert(!input.down('moveUp'), 'typing outside the canvas is ignored');
canvas.focus();
key('KeyZ');
assert(input.hit('moveUp'));
events.get('blur')();
assert(!input.down('moveUp') && !input.hit('moveUp'), 'blur clears held and latched input');
assert(gestures > 0 && prevented > 0);

const sfx = new Sfx();
sfx.out = { gain: { value: 0 } };
Preferences.value.volume = 40;
Preferences.value.shake = 23;
Preferences.value.flashes = false;
assert(Preferences.save());
assert.equal(sfx.out.gain.value, 0.85 * 0.4);
Preferences.value.muted = true;
assert(Preferences.save());
assert.equal(sfx.out.gain.value, 0);
Preferences.value = sanitizePreferences(null);
assert(Preferences.read());
assert.equal(Preferences.value.volume, 40);
assert.equal(Preferences.value.shake, 23);
assert.equal(Preferences.value.flashes, false);
assert.equal(Preferences.value.bindings.moveUp[0], 'KeyZ');
storageBlocked = true;
assert.equal(Preferences.save(), false);
assert.equal(Preferences.read(), false);
assert.equal(warnings.length, 2, 'storage failures are explicitly logged');
storageBlocked = false;
storage.set('ronins-path-preferences', '{broken');
assert.equal(Preferences.read(), false);

// Tap/hold attacks use the same editable action in solo play and duel input packets.
Preferences.value = sanitizePreferences(null);
Preferences.value.bindings.attack = ['KeyV'];
const loadout = vm.runInContext('new Loadout()', context);
const game = { loadout, skills: new Set(), time: 0, enemies: [], world: { resolve() {} } };
const player = new Player(game, 0, 0);
const duel = { input, players: [player], localIdx: 0, canvas, camX: 0, camY: 0, zoom: () => 1, mouseAttackPending: false };
const attackBit = vm.runInContext('IN_ATTACK', context), stabBit = vm.runInContext('IN_STAB', context);
input.releaseAll();
key('KeyV');
player.readInput(input, 100, 0);
assert(player.mouseAttackPending);
assert.equal(Duel.prototype.sampleLocal.call(duel)[4] & (attackBit | stabBit), 0);
now += 50;
key('KeyV', 'keyup');
player.readInput(input, 100, 0);
assert.equal(player.bufAttack, 0.22);
assert(Duel.prototype.sampleLocal.call(duel)[4] & attackBit);
player.bufAttack = 0;
key('KeyV');
player.readInput(input, 100, 0);
Duel.prototype.sampleLocal.call(duel);
now += 500;
player.readInput(input, 100, 0);
assert(player.bufStab > 0);
assert.equal(player.bufAttack, 0);
assert(Duel.prototype.sampleLocal.call(duel)[4] & stabBit);
key('KeyV', 'keyup');
assert.equal(Duel.prototype.sampleLocal.call(duel)[4] & (attackBit | stabBit), 0, 'heavy release does not add a light attack');
Preferences.value.bindings.guard = ['KeyB'];
key('KeyB');
player.readInput(input, 100, 0);
assert(player.guardHeld && player.bufParry > 0);
const guardBit = vm.runInContext('IN_GUARD', context), parryBit = vm.runInContext('IN_PARRY', context);
assert.equal(Duel.prototype.sampleLocal.call(duel)[4] & (guardBit | parryBit), guardBit | parryBit);
input.releaseAll();

const fx = new Effects();
fx.impact(0, 0, 'sweep');
fx.petals.push({});
Preferences.value.flashes = false;
Preferences.value.petals = false;
fx.drawImpact({}, 800, 600, 0, 0, 1);
fx.drawPetals({});
assert(fx.impactFrame, 'graphics choices do not change effect state or gameplay');

// Catch accidental new hard-coded keyboard actions in runtime code.
for (const name of ['player', 'game', 'duel', 'loadout']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', name + '.js'), 'utf8');
    for (const match of source.matchAll(/inp\.(?:down|hit)\('([^']+)'\)/g)) {
        assert(Object.hasOwn(CONTROL_DEFS, match[1]), name + ': missing customizable action ' + match[1]);
    }
}
console.log('Settings persistence, customizable inputs, sound, graphics, and solo/duel attack checks passed');
