'use strict';

/** Combat arts, equipment, appearance options and the equipment menu. */
const LOADOUT_KEY = 'roninsPath.loadout';
const BASE_ART_CHARGES = 3;

function artAtk(name, range, arc, dmg, post, pierce) {
    const a = new Attack(name, 0, 0.09, 0, range, arc, dmg, post, 0);
    a.art = true;
    a.heavy = true;
    a.pierce = !!pierce;
    return a;
}

// hits[].t: seconds into the art when the strike lands. blade(t): weapon angle relative to facing. lunge: [from, to, speed].
const ARTS = [
    {
        id: 'whirlwind', name: 'Whirlwind Slash', kanji: '旋風', cost: 2, unlock: 0, color: rgb(170, 230, 255), spin: true,
        desc: 'Spin and cut a wide area around you, twice.', info: 'Wide area  -  2 cuts',
        dur: 0.7, lunge: [0.08, 0.42, 90],
        hits: [{ t: 0.18, atk: artAtk('whirl1', 150, 360, 24, 28) }, { t: 0.36, atk: artAtk('whirl2', 150, 360, 30, 36) }],
        blade: t => 1.4 - U.clamp((t - 0.1) / 0.34, 0, 1) * TAU * 2,
    },
    {
        id: 'ichimonji', name: 'Ichimonji', kanji: '一文字', cost: 2, unlock: 0, color: rgb(255, 220, 150), recover: 35,
        desc: 'One committed overhead cut. Crushes posture and steadies your own.', info: 'Heavy posture damage  -  restores your posture',
        dur: 0.85, lunge: [0.3, 0.42, 260],
        hits: [{ t: 0.38, atk: artAtk('ichimonji', 92, 80, 42, 95), line: true }],
        blade: t => (t < 0.38 ? U.lerp(0.6, 2.9, t / 0.38) : U.lerp(2.9, 0.05, U.clamp((t - 0.38) / 0.07, 0, 1))),
    },
    {
        id: 'nightjar', name: 'Nightjar Slash', kanji: '夜鷹', cost: 2, unlock: 1, color: rgb(200, 170, 255), trail: true, iframes: [0, 0.3],
        desc: 'Leap forward and cut down on landing. Invincible mid-leap.', info: 'Gap closer  -  invincible while leaping',
        dur: 0.72, lunge: [0.02, 0.28, 820],
        hits: [{ t: 0.3, atk: artAtk('nightjar', 96, 150, 38, 52) }],
        blade: t => (t < 0.3 ? 2.0 : U.lerp(1.3, -1.3, U.clamp((t - 0.3) / 0.08, 0, 1))),
    },
    {
        id: 'mortal', name: 'Mortal Draw', kanji: '抜刀', cost: 3, unlock: 3, color: rgb(255, 110, 110), charge: true,
        desc: 'Hold the blade in its sheath, then release a vast draw.', info: 'Huge reach  -  cannot be blocked',
        dur: 1.05,
        hits: [{ t: 0.6, atk: artAtk('mortal', 200, 80, 85, 75, true), line: true }],
        blade: t => (t < 0.6 ? 2.7 : U.lerp(1.2, -1.1, U.clamp((t - 0.6) / 0.07, 0, 1))),
    },
    {
        id: 'spearfall', name: 'Heaven-Piercing Thrust', kanji: '穿', cost: 2, unlock: 0, weapon: 'spear',
        color: rgb(150, 220, 255), motion: 'thrust', trail: true,
        desc: 'Drive forward with a rapid double thrust.', info: 'Two piercing jabs  -  spear only',
        dur: 0.82, lunge: [0.05, 0.52, 220],
        hits: [
            { t: 0.22, atk: artAtk('spearfall1', 148, 28, 32, 28, true) },
            { t: 0.48, atk: artAtk('spearfall2', 174, 24, 46, 42, true), line: true },
        ],
        blade: () => 0,
    },
    {
        id: 'earthshaker', name: 'Earthshaker', kanji: '砕', cost: 2, unlock: 0, weapon: 'hammer',
        color: rgb(255, 190, 115), motion: 'slam',
        desc: 'Wind up and smash the ground with crushing force.', info: 'Massive posture damage  -  hammer only',
        dur: 0.92, recover: 20, lunge: [0.3, 0.46, 125],
        hits: [{ t: 0.48, atk: artAtk('earthshaker', 118, 205, 66, 112) }],
        blade: t => (t < 0.48 ? U.lerp(2.9, -2.2, t / 0.48) : U.lerp(-2.2, 0.15, U.clamp((t - 0.48) / 0.08, 0, 1))),
    },
];

const SWORDS = [
    { id: 'wanderer', type: 'katana', name: "Wanderer's Katana", kanji: '打刀', unlock: 0, dmg: 1, post: 1, spd: 1, reach: 0, len: 56, color: rgb(210, 215, 230),
        desc: 'A plain, honest blade. Balanced in every way.', info: 'Balanced' },
    { id: 'odachi', type: 'katana', name: 'Crimson Odachi', kanji: '大太刀', unlock: 1, poise: 12, dmg: 1.3, post: 1.2, spd: 1.2, reach: 16, len: 70, color: rgb(235, 170, 165),
        desc: 'Long and heavy. Strikes hard but swings slow, and holds firm mid-swing.', info: 'Damage +30%  -  Reach +16  -  Slower swings' },
    { id: 'wakizashi', type: 'katana', name: 'Mist Raven Wakizashi', kanji: '脇差', unlock: 2, dmg: 0.82, post: 0.9, spd: 0.72, reach: -10, len: 44, color: rgb(175, 210, 245),
        desc: 'Short and light. Chains cuts in a blur.', info: 'Much faster swings  -  Less damage and reach' },
    { id: 'sorrow', type: 'katana', name: 'Blade of Sorrow', kanji: '哀刃', unlock: 4, dmg: 1.35, post: 1.5, spd: 1.05, reach: 6, len: 62, color: rgb(210, 70, 80),
        desc: 'A cursed edge that shatters any guard.', info: 'Damage +35%  -  Posture damage +50%' },
    { id: 'spear', type: 'spear', name: 'Ash Spear', kanji: '槍', unlock: 0, dmg: 0.85, post: 0.85, spd: 1.08, reach: 38, len: 76, color: rgb(205, 220, 225),
        combo: [new Attack('spear1', 0.12, 0.10, 0.25, 112, 42, 15, 12, 150),
            new Attack('spear2', 0.12, 0.10, 0.25, 112, 42, 15, 12, 150),
            new Attack('spear3', 0.20, 0.12, 0.40, 125, 54, 25, 24, 210)],
        desc: 'Keep enemies at a distance with narrow thrusts.', info: 'Reach +38  -  Narrow arc  -  Less posture damage' },
    { id: 'storm-spear', type: 'spear', name: 'Tempest Spear', kanji: '嵐槍', unlock: 1, dmg: 0.92, post: 0.92, spd: 0.9, reach: 48, len: 86, color: rgb(165, 205, 235),
        combo: [new Attack('stormSpear1', 0.11, 0.09, 0.24, 118, 36, 15, 12, 170),
            new Attack('stormSpear2', 0.11, 0.09, 0.24, 118, 36, 15, 12, 170),
            new Attack('stormSpear3', 0.18, 0.12, 0.38, 132, 48, 26, 25, 230)],
        desc: 'A long, quick spear that keeps foes at bay.', info: 'Longer reach  -  Faster thrusts  -  Light hits' },
    { id: 'serpent-spear', type: 'spear', name: 'Serpent Fang Spear', kanji: '蛇槍', unlock: 3, dmg: 1.12, post: 1, spd: 1.18, reach: 30, len: 72, color: rgb(150, 205, 165),
        combo: [new Attack('serpentSpear1', 0.14, 0.11, 0.26, 108, 48, 17, 14, 145),
            new Attack('serpentSpear2', 0.13, 0.10, 0.25, 108, 48, 17, 14, 150),
            new Attack('serpentSpear3', 0.22, 0.14, 0.42, 122, 62, 29, 28, 215)],
        desc: 'A hooked point built for forceful, accurate thrusts.', info: 'Damage +12%  -  Broad thrusts  -  Faster than Ash Spear' },
    { id: 'hammer', type: 'hammer', name: 'Iron Hammer', kanji: '鎚', unlock: 0, poise: 26, dmg: 1.25, post: 1.65, spd: 1.45, reach: -8, len: 58, color: rgb(175, 175, 170),
        combo: [new Attack('hammer1', 0.18, 0.12, 0.32, 84, 150, 17, 20, 120),
            new Attack('hammer2', 0.20, 0.12, 0.32, 84, 150, 17, 20, 120),
            new Attack('hammer3', 0.28, 0.14, 0.52, 96, 185, 27, 32, 170)],
        desc: 'Slow crushing blows break guards and shrug off light hits mid-swing.', info: 'Posture +65%  -  Hard to interrupt  -  Slow' },
    { id: 'war-hammer', type: 'hammer', name: 'Ashen Warhammer', kanji: '戦鎚', unlock: 1, poise: 32, dmg: 1.38, post: 1.82, spd: 1.62, reach: -12, len: 64, color: rgb(195, 160, 125),
        combo: [new Attack('warHammer1', 0.20, 0.12, 0.36, 82, 158, 18, 22, 115),
            new Attack('warHammer2', 0.22, 0.12, 0.36, 82, 158, 18, 22, 115),
            new Attack('warHammer3', 0.31, 0.15, 0.56, 94, 195, 29, 35, 165)],
        desc: 'A massive two-handed head that batters any guard.', info: 'More damage and posture  -  Very slow  -  Short reach' },
    { id: 'stone-hammer', type: 'hammer', name: 'Stone Maul', kanji: '石鎚', unlock: 3, poise: 38, dmg: 1.52, post: 1.95, spd: 1.78, reach: -16, len: 68, color: rgb(185, 185, 175),
        combo: [new Attack('stoneHammer1', 0.23, 0.13, 0.4, 78, 165, 20, 25, 105),
            new Attack('stoneHammer2', 0.24, 0.13, 0.4, 78, 165, 20, 25, 105),
            new Attack('stoneHammer3', 0.34, 0.16, 0.6, 92, 205, 32, 39, 155)],
        desc: 'A stone-headed maul with devastating but deliberate swings.', info: 'High damage and posture  -  Slowest  -  Shortest reach' },
    { id: 'axe', type: 'axe', name: 'Woodsman Axe', kanji: '斧', unlock: 0, poise: 16, dmg: 1.18, post: 1.3, spd: 1.22, reach: -3, len: 52, color: rgb(205, 200, 190),
        combo: [new Attack('axe1', 0.14, 0.11, 0.28, 84, 180, 17, 15, 170),
            new Attack('axe2', 0.14, 0.11, 0.28, 84, 180, 17, 15, 170),
            new Attack('axe3', 0.24, 0.14, 0.45, 98, 240, 27, 27, 220)],
        desc: 'Broad, heavy chops catch groups.', info: 'Damage +18%  -  Wide arc  -  Slower' },
];

const THROWABLES = [
    { id: 'shuriken', name: 'Shuriken', kanji: '手裏剣', unlock: 0, max: 5, range: 250, damage: 12, posture: 10, color: rgb(185, 220, 240),
        desc: 'Quick steel stars for distant targets.', info: '5 throws  -  Fast  -  Refill at shrines' },
    { id: 'kunai', name: 'Kunai', kanji: '苦無', unlock: 0, max: 4, range: 270, damage: 20, posture: 12, color: rgb(225, 205, 170),
        desc: 'A heavier knife with greater reach.', info: '4 throws  -  More damage  -  Refill at shrines' },
    { id: 'throwingaxe', name: 'Throwing Axe', kanji: '飛斧', unlock: 0, max: 3, range: 210, damage: 28, posture: 28, color: rgb(230, 170, 130),
        desc: 'A short throw that batters guards.', info: '3 throws  -  High posture damage  -  Refill at shrines' },
];

const ARMORS = [
    { id: 'traveler', name: "Traveler's Garb", kanji: '旅装', unlock: 0, def: 1, move: 1, posture: 0, stealth: 1, shoulder: rgb(150, 32, 38),
        desc: 'Worn cloth and a red mantle. Nothing to slow you down.', info: 'No modifiers' },
    { id: 'shinobi', name: 'Shinobi Garb', kanji: '忍装束', unlock: 1, def: 1.1, move: 1.1, posture: -10, stealth: 0.6, shoulder: rgb(38, 38, 46),
        desc: 'Dark, silent and light. Made for those who strike unseen.', info: 'Move +10%  -  Quieter  -  Damage taken +10%' },
    { id: 'lamellar', name: 'Ashina Lamellar', kanji: '具足', unlock: 2, def: 0.78, move: 0.9, posture: 25, stealth: 1.2, shoulder: rgb(120, 104, 84),
        desc: 'Lacquered plates that turn aside the blade.', info: 'Damage taken -22%  -  Posture +25  -  Slower, louder' },
    { id: 'ashigaru', name: 'Ashigaru Cuirass', kanji: '足軽胴', unlock: 1, def: 0.9, move: 1.06, posture: 5, stealth: 1, shoulder: rgb(70, 92, 118),
        affinity: 'spear', bonus: { reach: 10, spd: 0.92 },
        desc: 'A trim spearman\'s cuirass. Light on the feet, free at the arms.',
        info: 'Damage taken -10%  -  Move +6%  -  Spear: reach +10, thrusts 8% faster' },
    { id: 'oyoroi', name: 'Iron Oyoroi', kanji: '大鎧', unlock: 2, def: 0.7, move: 0.86, posture: 35, stealth: 1.35, shoulder: rgb(84, 80, 78),
        affinity: 'hammer', bonus: { poise: 14, post: 1.12 },
        desc: 'Heavy iron plate made to wade through blows behind a maul.',
        info: 'Damage taken -30%  -  Posture +35  -  Slow  -  Hammer: poise +14, posture damage +12%' },
];

const CHARMS = [
    { id: 'none', name: 'No Charm', kanji: '無', unlock: 0, desc: 'Nothing hangs from your belt.', info: '-' },
    { id: 'gourdseed', name: 'Gourd Seed', kanji: '瓢', unlock: 0, gourds: 1,
        desc: 'A seed that swells into another healing gourd.', info: '+1 Healing Gourd (refilled at shrines)' },
    { id: 'feather', name: "Kite's Feather", kanji: '羽', unlock: 1, deflect: 0.035,
        desc: 'Light as the wind. Your guard meets blades sooner.', info: 'Deflect window +35ms' },
    { id: 'bell', name: 'Spirit Bell', kanji: '鈴', unlock: 1, charges: 1,
        desc: 'Its chime holds the echo of every clash.', info: '+1 max Combat Art charge' },
    { id: 'ironheart', name: 'Iron Heart', kanji: '鉄心', unlock: 2, posture: 30,
        desc: 'A cold stone that keeps your stance unbroken.', info: 'Posture +30' },
    { id: 'onimask', name: 'Oni Mask', kanji: '鬼', unlock: 3, dmg: 1.2, def: 1.2,
        desc: 'Wear the demon, fight as the demon.', info: 'Damage dealt +20%  -  Damage taken +20%' },
];

const EQUIP_SLOTS = [
    { field: 'art', label: 'Combat Art', list: ARTS },
    { field: 'sword', label: 'Weapon', list: SWORDS },
    { field: 'throwable', label: 'Throw', list: THROWABLES },
    { field: 'armor', label: 'Armor', list: ARMORS },
    { field: 'charm', label: 'Charm', list: CHARMS },
];

const WEAPON_TYPES = [
    { id: 'all', label: 'All', name: 'weapon' },
    { id: 'katana', label: 'Katanas', name: 'katana' },
    { id: 'spear', label: 'Spears', name: 'spear' },
    { id: 'hammer', label: 'Hammers', name: 'hammer' },
    { id: 'axe', label: 'Axes', name: 'axe' },
];

const LOOKS = [
    { key: 'robe', label: 'Robe', colors: [rgb(40, 45, 72), rgb(28, 28, 32), rgb(96, 30, 34), rgb(38, 68, 48), rgb(112, 100, 80), rgb(205, 205, 210), rgb(72, 42, 94)] },
    { key: 'scarf', label: 'Scarf', colors: [rgb(200, 30, 40), rgb(230, 200, 90), rgb(240, 240, 240), rgb(60, 120, 200), rgb(40, 40, 40), rgb(90, 180, 110), rgb(220, 120, 180)] },
    { key: 'hatStyle', label: 'Headwear', names: ['Kasa', 'Jingasa', 'Oni Horns', 'Hood'] },
    { key: 'hat', label: 'Headwear Color', colors: [rgb(206, 176, 116), rgb(64, 52, 40), rgb(38, 38, 46), rgb(150, 40, 40), rgb(210, 210, 200), rgb(70, 90, 60)] },
];

function findItem(list, id) { return list.find(i => i.id === id) || list[0]; }
function weaponType(weapon) { return weapon.type || 'katana'; }
function artMatchesWeapon(art, weapon) { return !art.weapon || art.weapon === weaponType(weapon); }
function armorFitsWeapon(armor, weapon) { return !!armor.affinity && armor.affinity === weaponType(weapon); }
function weaponTypeName(type) { return WEAPON_TYPES.find(t => t.id === type).name; }

class Loadout {
    constructor() {
        this.art = ARTS[0].id;
        this.sword = SWORDS[0].id;
        this.throwable = THROWABLES[0].id;
        this.armor = ARMORS[0].id;
        this.charm = CHARMS[0].id;
        this.look = { robe: 0, scarf: 0, hatStyle: 0, hat: 0 };
    }

    clone() {
        const c = new Loadout();
        Object.assign(c, this);
        c.look = Object.assign({}, this.look);
        return c;
    }

    artDef() { return findItem(ARTS, this.art); }
    swordDef() { return findItem(SWORDS, this.sword); }
    throwableDef() { return findItem(THROWABLES, this.throwable); }
    armorDef() { return findItem(ARMORS, this.armor); }
    charmDef() { return findItem(CHARMS, this.charm); }
    color(key) { return LOOKS.find(l => l.key === key).colors[this.look[key]]; }

    save() {
        try {
            localStorage.setItem(LOADOUT_KEY, JSON.stringify(this.toData()));
        } catch (e) { /* storage unavailable */ }
    }

    toData() {
        return { art: this.art, sword: this.sword, throwable: this.throwable, armor: this.armor, charm: this.charm, look: Object.assign({}, this.look) };
    }

    /** Last-used gear and look, used when starting a fresh game (only gear that needs no elite kills). */
    load() {
        let d;
        try {
            d = JSON.parse(localStorage.getItem(LOADOUT_KEY));
        } catch (e) {
            return;
        }
        this.apply(d, 0);
    }

    /** Restore from untrusted data; gear is only accepted if unlocked with the given elite count. */
    apply(d, elites) {
        if (!d || typeof d !== 'object') return;
        for (const s of EQUIP_SLOTS) {
            const it = s.list.find(i => i.id === d[s.field]);
            if (it && it.unlock <= elites) this[s.field] = it.id;
        }
        if (d.look && typeof d.look === 'object') {
            for (const l of LOOKS) {
                const v = d.look[l.key], n = (l.colors || l.names).length;
                if (Number.isInteger(v) && v >= 0 && v < n) this.look[l.key] = v;
            }
        }
    }
}

const PLAYER_DAMAGE_SCALE = 0.94;
const MAX_PLAYER_HP = 180;
const MAX_PLAYER_GOURDS = 5;

function playerProgression(elites, bossDefeated) {
    const count = Number.isFinite(elites) ? Math.max(0, Math.trunc(elites)) : 0;
    const eliteHp = Math.min(count, 2) * 20 + Math.max(0, count - 2) * 10;
    const eliteGourds = Math.ceil(count / 2);
    return {
        baseMaxHp: Math.min(MAX_PLAYER_HP, 100 + eliteHp + (bossDefeated ? 40 : 0)),
        baseGourds: Math.min(MAX_PLAYER_GOURDS, 3 + eliteGourds + (bossDefeated ? 1 : 0)),
    };
}

function computeStats(lo, baseHp, baseGourds, skills) {
    const sw = lo.swordDef(), ar = lo.armorDef(), ch = lo.charmDef();
    const s = {
        maxHp: Math.min(baseHp, MAX_PLAYER_HP),
        maxPosture: 100 + ar.posture + (ch.posture || 0),
        gourds: Math.min(MAX_PLAYER_GOURDS, baseGourds + (ch.gourds || 0)),
        charges: BASE_ART_CHARGES + (ch.charges || 0),
        dmg: sw.dmg * (ch.dmg || 1) * PLAYER_DAMAGE_SCALE,
        post: sw.post,
        spd: sw.spd,
        reach: sw.reach,
        poise: sw.poise || 0,
        def: ar.def * (ch.def || 1),
        move: ar.move,
        deflect: PERFECT_WINDOW + (ch.deflect || 0),
        stealth: ar.stealth,
        artDmg: 1,
        deathblowHeal: 0,
        deflectPost: 1,
        deflectRecover: 0,
        iframes: DODGE_IFRAMES,
        dragonFlash: false,
        lastStand: false,
    };
    if (armorFitsWeapon(ar, sw)) {
        const b = ar.bonus;
        s.reach += b.reach || 0;
        s.spd *= b.spd || 1;
        s.poise += b.poise || 0;
        s.post *= b.post || 1;
    }
    if (skills) for (const sk of SKILLS) if (skills.has(sk.id)) sk.apply(s);
    return s;
}

function scaledAttack(a, s) {
    const b = new Attack(a.name, a.windup * s.spd, a.active, a.recovery * s.spd, a.range + s.reach, a.arc / DEG, a.damage * s.dmg,
        a.posture * s.post, a.lunge);
    b.perilous = !!a.perilous;
    b.thrust = !!a.thrust;
    b.sweep = !!a.sweep;
    b.art = !!a.art;
    b.heavy = !!a.heavy;
    b.pierce = !!a.pierce;
    return b;
}

function drawRonin(g, x, y, r, facing, lo, time) {
    const sw = lo.swordDef();
    Draw.shadow(g, x, y, r);
    Draw.scarf(g, x, y, r, facing, time * 5, lo.color('scarf'));
    Draw.body(g, x, y, r, facing, lo.color('robe'), lo.armorDef().shoulder, lo.color('hat'), lo.look.hatStyle, 0);
    Draw.weapon(g, x + Math.cos(facing + 0.9) * r * 0.9, y + Math.sin(facing + 0.9) * r * 0.9, facing + 0.55, sw);
}

const STAT_ROWS = [
    ['Vitality', s => s.maxHp, v => Math.round(v), 1],
    ['Posture', s => s.maxPosture, v => Math.round(v), 1],
    ['Healing Gourds', s => s.gourds, v => v, 1],
    ['Art Charges', s => s.charges, v => v, 1],
    ['Attack', s => s.dmg * 100, v => Math.round(v) + '%', 1],
    ['Posture Damage', s => s.post * 100, v => Math.round(v) + '%', 1],
    ['Swing Speed', s => 100 / s.spd, v => Math.round(v) + '%', 1],
    ['Poise', s => s.poise, v => Math.round(v), 1],
    ['Damage Taken', s => s.def * 100, v => Math.round(v) + '%', -1],
    ['Move Speed', s => s.move * 100, v => Math.round(v) + '%', 1],
    ['Deflect Window', s => s.deflect * 1000, v => Math.round(v) + 'ms', 1],
    ['Art Damage', s => s.artDmg * 100, v => Math.round(v) + '%', 1],
    ['Dodge I-frames', s => s.iframes * 1000, v => Math.round(v) + 'ms', 1],
];

const LOOK_TAB = EQUIP_SLOTS.length;
const SKILL_TAB = EQUIP_SLOTS.length + 1;

/** Pause-screen menu for combat arts, gear, appearance and the skill tree. */
class EquipMenu {
    constructor(game) {
        this.g = game;
        this.open = false;
        this.tab = 0;
        this.weaponTypeTab = 0;
        this.sel = new Array(EQUIP_SLOTS.length + 2).fill(0);
        this.scroll = new Array(EQUIP_SLOTS.length + 2).fill(0);
        this.rects = { tab: -1, tabs: [], subtabs: [], rows: [], swatches: [] };
        this.lastMx = -1;
        this.lastMy = -1;
        this.msg = null;
        this.msgT = 0;
    }

    show() {
        const lo = this.g.loadout;
        this.open = true;
        EQUIP_SLOTS.forEach((s, i) => { this.sel[i] = Math.max(0, s.list.findIndex(it => it.id === lo[s.field])); });
        this.weaponTypeTab = Math.max(0, WEAPON_TYPES.findIndex(t => t.id === weaponType(lo.swordDef())));
    }

    unlocked(it) { return this.g.elitesSlain >= it.unlock; }

    weaponIndices() {
        const type = WEAPON_TYPES[this.weaponTypeTab].id;
        return SWORDS.flatMap((weapon, i) => type === 'all' || weaponType(weapon) === type ? [i] : []);
    }

    tabIndices() {
        if (this.tab < EQUIP_SLOTS.length) {
            return this.tab === 1 ? this.weaponIndices() : EQUIP_SLOTS[this.tab].list.map((_, i) => i);
        }
        return LOOKS.map((_, i) => i);
    }

    count() { return this.tabIndices().length; }

    moveSelection(delta) {
        const indices = this.tabIndices(), current = indices.indexOf(this.sel[this.tab]);
        const pos = current < 0 ? 0 : (current + delta + indices.length) % indices.length;
        this.sel[this.tab] = indices[pos];
    }

    selectWeaponType(i) {
        this.weaponTypeTab = i;
        const indices = this.weaponIndices();
        if (!indices.includes(this.sel[1])) this.sel[1] = indices[0];
    }

    note(s) {
        this.msg = s;
        this.msgT = 2;
    }

    tick(inp, dt) {
        this.msgT -= dt;
        if (inp.hit('Tab') || inp.hit('KeyI') || inp.hit('Escape')) {
            this.open = false;
            return;
        }
        const nTabs = EQUIP_SLOTS.length + 2, prevTab = this.tab;
        if (inp.hit('KeyQ')) this.tab = (this.tab + nTabs - 1) % nTabs;
        if (inp.hit('KeyE')) this.tab = (this.tab + 1) % nTabs;
        const appearance = this.tab === LOOK_TAB, skillsTab = this.tab === SKILL_TAB;
        if (this.tab === 1) {
            if (inp.hit('KeyA') || inp.hit('ArrowLeft')) {
                this.selectWeaponType((this.weaponTypeTab + WEAPON_TYPES.length - 1) % WEAPON_TYPES.length);
            }
            if (inp.hit('KeyD') || inp.hit('ArrowRight')) {
                this.selectWeaponType((this.weaponTypeTab + 1) % WEAPON_TYPES.length);
            }
        }
        if (skillsTab) {
            let b = Math.floor(this.sel[SKILL_TAB] / SKILL_TIERS), t = this.sel[SKILL_TAB] % SKILL_TIERS;
            if (inp.hit('KeyW') || inp.hit('ArrowUp')) t = (t + SKILL_TIERS - 1) % SKILL_TIERS;
            if (inp.hit('KeyS') || inp.hit('ArrowDown')) t = (t + 1) % SKILL_TIERS;
            if (inp.hit('KeyA') || inp.hit('ArrowLeft')) b = (b + 2) % 3;
            if (inp.hit('KeyD') || inp.hit('ArrowRight')) b = (b + 1) % 3;
            this.sel[SKILL_TAB] = b * SKILL_TIERS + t;
            if (inp.hit('Enter') || inp.hit('NumpadEnter') || inp.hit('Space')) this.learn(this.sel[SKILL_TAB]);
        } else {
            const n = this.count();
            if (inp.hit('KeyW') || inp.hit('ArrowUp')) this.moveSelection(-1);
            if (inp.hit('KeyS') || inp.hit('ArrowDown')) this.moveSelection(1);
            if (appearance) {
                if (inp.hit('KeyA') || inp.hit('ArrowLeft')) this.cycleLook(this.sel[this.tab], -1);
                if (inp.hit('KeyD') || inp.hit('ArrowRight')) this.cycleLook(this.sel[this.tab], 1);
            } else if (inp.hit('Enter') || inp.hit('NumpadEnter') || inp.hit('Space')) this.equip(this.sel[this.tab]);
        }

        const mx = inp.mx, my = inp.my, moved = mx !== this.lastMx || my !== this.lastMy, click = inp.mouseHit(1);
        this.lastMx = mx;
        this.lastMy = my;
        if (this.tab !== prevTab || this.rects.tab !== this.tab) return;
        const inside = r => mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h;
        if (click) {
            for (const r of this.rects.tabs) if (inside(r)) {
                this.tab = r.i;
                return;
            }
            for (const r of this.rects.subtabs) if (inside(r)) {
                this.selectWeaponType(r.i);
                return;
            }
            for (const r of this.rects.swatches) if (inside(r)) {
                this.sel[this.tab] = r.row;
                this.setLook(r.row, r.val);
                return;
            }
        }
        for (const r of this.rects.rows) {
            if (!inside(r)) continue;
            if (skillsTab) {
                // skills cost points, so a click selects and a second click on the same node learns it
                if (click) {
                    if (this.sel[SKILL_TAB] === r.i) this.learn(r.i);
                    else this.sel[SKILL_TAB] = r.i;
                }
                continue;
            }
            if (moved || click) this.sel[this.tab] = r.i;
            if (click && !appearance) this.equip(r.i);
        }
    }

    learn(i) {
        const g = this.g, p = g.player, sk = skillAt(Math.floor(i / SKILL_TIERS), i % SKILL_TIERS), pre = skillPrereq(sk);
        if (g.skills.has(sk.id)) return;
        if (pre !== null && !g.skills.has(pre.id)) {
            this.note('Learn ' + pre.name + ' first');
            g.sfx.play('BLOCK');
            return;
        }
        if (g.skillPoints < sk.cost) {
            this.note('Not enough skill points  -  earn EXP by defeating enemies');
            g.sfx.play('BLOCK');
            return;
        }
        const hp0 = p.maxHp, gourds0 = p.maxGourds;
        g.skillPoints -= sk.cost;
        g.skills.add(sk.id);
        p.applyLoadout();
        p.hp += Math.max(0, p.maxHp - hp0);
        p.gourds += Math.max(0, p.maxGourds - gourds0);
        g.saveSoon();
        g.sfx.play('SHRINE');
        this.note(sk.name + ' learned');
    }

    previewSkills() {
        const skills = this.g.skills;
        if (this.tab !== SKILL_TAB) return skills;
        const sk = skillAt(Math.floor(this.sel[SKILL_TAB] / SKILL_TIERS), this.sel[SKILL_TAB] % SKILL_TIERS);
        return skills.has(sk.id) ? skills : new Set([...skills, sk.id]);
    }

    equip(i) {
        const g = this.g, slot = EQUIP_SLOTS[this.tab], it = slot.list[i];
        if (!this.unlocked(it)) {
            this.note('Locked  -  slay ' + it.unlock + ' elite' + (it.unlock > 1 ? 's' : '') + ' to unlock');
            g.sfx.play('BLOCK');
            return;
        }
        if (slot.field === 'art' && !artMatchesWeapon(it, g.loadout.swordDef())) {
            this.note(it.name + ' requires a ' + weaponTypeName(it.weapon));
            g.sfx.play('BLOCK');
            return;
        }
        if (g.loadout[slot.field] === it.id) return;
        g.loadout[slot.field] = it.id;
        let artReset = false;
        if (slot.field === 'sword' && !artMatchesWeapon(g.loadout.artDef(), it)) {
            g.loadout.art = ARTS[0].id;
            artReset = true;
        }
        g.player.applyLoadout();
        if (slot.field === 'throwable') this.note(it.name + ' equipped  -  rest at a shrine to refill');
        else this.note(it.name + ' equipped' + (artReset ? '  -  switched to ' + ARTS[0].name : ''));
        g.loadout.save();
        g.saveSoon();
        g.sfx.play('SLASH');
    }

    setLook(row, v) {
        const g = this.g;
        g.loadout.look[LOOKS[row].key] = v;
        g.loadout.save();
        g.saveSoon();
        g.sfx.play('DODGE');
    }

    cycleLook(row, d) {
        const l = LOOKS[row], n = (l.colors || l.names).length;
        this.setLook(row, (this.g.loadout.look[l.key] + d + n) % n);
    }

    previewLoadout() {
        const lo = this.g.loadout;
        if (this.tab >= EQUIP_SLOTS.length) return lo;
        const slot = EQUIP_SLOTS[this.tab], p = lo.clone(), idx = this.sel[this.tab];
        p[slot.field] = slot.list[idx].id;
        return p;
    }

    rightText(g, s, x, y, c) {
        this.g.text(g, s, x - g.measureText(s).width, y, c, false);
    }

    draw(g, sw, sh) {
        const game = this.g;
        const W = Math.min(1000, sw - 40), H = Math.min(640, sh - 40), X = Math.round((sw - W) / 2), Y = Math.round((sh - H) / 2);
        const R = this.rects = { tab: this.tab, tabs: [], subtabs: [], rows: [], swatches: [] };
        g.fillStyle = 'rgba(0,0,0,0.65)';
        g.fillRect(0, 0, sw, sh);
        roundRectPath(g, X, Y, W, H, 10);
        g.fillStyle = 'rgba(22,16,15,0.96)';
        g.fill();
        setStroke(g, 2, false);
        g.strokeStyle = 'rgb(150,110,60)';
        g.stroke();

        g.font = 'bold 28px serif';
        const skillsTab = this.tab === SKILL_TAB;
        game.text(g, skillsTab ? 'SKILL TREE' : 'EQUIPMENT', X + 24, Y + 40, rgb(235, 200, 140), false);
        g.font = 'bold 24px ' + KANJI_FAMILY;
        game.text(g, skillsTab ? '技' : '装備', X + (skillsTab ? 200 : 196), Y + 40, rgb(200, 60, 50), false);
        if (this.msgT > 0 && this.msg !== null) {
            g.font = 'bold 15px serif';
            this.rightText(g, this.msg, X + W - 24, Y + 38, rgb(255, 220, 150));
        }

        const labels = EQUIP_SLOTS.map(s => s.label).concat('Appearance', game.skillPoints > 0 ? 'Skills (' + game.skillPoints + ')' : 'Skills');
        const tw = (W - 48) / labels.length;
        labels.forEach((l, i) => {
            const r = { x: X + 24 + i * tw, y: Y + 58, w: tw - 6, h: 34, i };
            R.tabs.push(r);
            roundRectPath(g, r.x, r.y, r.w, r.h, 5);
            g.fillStyle = i === this.tab ? 'rgb(130,32,32)' : 'rgb(46,36,33)';
            g.fill();
            g.font = 'bold 15px serif';
            game.text(g, l, r.x + r.w / 2, r.y + 22, i === this.tab ? rgb(255, 235, 210) : rgb(190, 175, 160), true);
        });

        const top = Y + 108, bottom = Y + H - 44;
        const preview = this.previewLoadout();
        this.drawPreview(g, X + 24, top, 300, 200, preview);
        this.drawStats(g, X + 24, top + 222, 300, preview, this.previewSkills());
        const lx = X + 344, lw = W - 368;
        if (this.tab < EQUIP_SLOTS.length) this.drawList(g, lx, top, lw, bottom - top, R);
        else if (skillsTab) this.drawSkills(g, lx, top, lw, bottom - top, R);
        else this.drawLooks(g, lx, top, lw, R);

        g.font = SMALL_FONT;
        const hint = this.tab === 1 ? 'W/S select     A/D weapon type     Enter / Click equip     Q/E menu tab     Tab close'
            : this.tab < EQUIP_SLOTS.length ? 'W/S select     Enter / Click equip     Q/E switch tab     Tab close'
            : skillsTab ? 'WASD select     Click to select, click again or Enter to learn     Q/E switch tab     Tab close'
                : 'W/S select     A/D or click to change     Q/E switch tab     Tab close';
        game.text(g, hint, X + W / 2, Y + H - 16, rgb(180, 165, 145), true);
    }

    drawPreview(g, x, y, w, h, lo) {
        const t = this.g.realTime;
        g.save();
        roundRectPath(g, x, y, w, h, 8);
        g.fillStyle = 'rgb(44,52,36)';
        g.fill();
        g.clip();
        g.fillStyle = 'rgba(255,215,140,0.08)';
        fillCircle(g, x + w / 2, y + h / 2, 80);
        g.translate(x + w / 2, y + h / 2 + 4);
        g.scale(3.2, 3.2);
        drawRonin(g, 0, 0, 15, t * 0.7, lo, t);
        g.restore();
        const art = lo.artDef();
        g.font = 'bold 30px ' + KANJI_FAMILY;
        this.g.text(g, art.kanji, x + 12, y + 38, U.alpha(art.color, 0.8), false);
    }

    drawStats(g, x, y, w, preview, previewSkills) {
        const game = this.g, p = game.player;
        const cur = computeStats(game.loadout, p.baseMaxHp, p.baseGourds, game.skills);
        const nxt = computeStats(preview, p.baseMaxHp, p.baseGourds, previewSkills);
        let yy = y;
        for (const [label, fn, fmt, better] of STAT_ROWS) {
            const a = fn(cur), b = fn(nxt);
            g.font = SMALL_FONT;
            this.g.text(g, label, x + 4, yy, rgb(200, 190, 175), false);
            g.font = HUD_FONT;
            if (Math.abs(a - b) < 0.01) this.rightText(g, String(fmt(a)), x + w - 4, yy, rgb(240, 230, 215));
            else {
                const up = (b - a) * better > 0;
                const s = String(fmt(b));
                this.rightText(g, s, x + w - 4, yy, up ? rgb(120, 230, 120) : rgb(240, 100, 90));
                g.font = SMALL_FONT;
                this.rightText(g, fmt(a) + '  \u2192', x + w - 12 - g.measureText(s).width - 8, yy, rgb(160, 150, 140));
            }
            yy += 19;
        }
    }

    drawList(g, x, y, w, h, R) {
        const game = this.g, lo = game.loadout, slot = EQUIP_SLOTS[this.tab];
        const indices = this.tabIndices(), list = indices.map(i => slot.list[i]);
        if (this.tab === 1) {
            const gap = 5, tabW = (w - gap * (WEAPON_TYPES.length - 1)) / WEAPON_TYPES.length;
            WEAPON_TYPES.forEach((type, i) => {
                const r = { x: x + i * (tabW + gap), y, w: tabW, h: 32, i };
                R.subtabs.push(r);
                roundRectPath(g, r.x, r.y, r.w, r.h, 5);
                g.fillStyle = i === this.weaponTypeTab ? 'rgb(130,32,32)' : 'rgb(46,36,33)';
                g.fill();
                g.font = 'bold 13px serif';
                this.g.text(g, type.label, r.x + r.w / 2, r.y + 21,
                    i === this.weaponTypeTab ? rgb(255, 235, 210) : rgb(190, 175, 160), true);
            });
            y += 42;
            h -= 42;
        }
        const rowH = 70, gap = 6, vis = Math.max(1, Math.floor((h + gap) / (rowH + gap)));
        const selectedIndex = indices.indexOf(this.sel[this.tab]), sel = selectedIndex < 0 ? 0 : selectedIndex;
        let first = this.scroll[this.tab];
        if (sel < first) first = sel;
        if (sel >= first + vis) first = sel - vis + 1;
        first = U.clamp(first, 0, Math.max(0, list.length - vis));
        this.scroll[this.tab] = first;
        for (let k = 0; k < vis && first + k < list.length; k++) {
            const i = indices[first + k], it = list[first + k], ry = y + k * (rowH + gap);
            R.rows.push({ x, y: ry, w, h: rowH, i });
            const weaponLocked = slot.field === 'art' && !artMatchesWeapon(it, lo.swordDef());
            const locked = !this.unlocked(it) || weaponLocked, equipped = lo[slot.field] === it.id;
            roundRectPath(g, x, ry, w, rowH, 6);
            g.fillStyle = i === sel ? 'rgb(72,50,40)' : 'rgb(38,30,28)';
            g.fill();
            if (equipped) {
                setStroke(g, 2, false);
                g.strokeStyle = 'rgb(230,180,90)';
                g.stroke();
            }
            const dim = locked ? 0.4 : 1;
            g.font = 'bold ' + (it.kanji.length > 2 ? 17 : 24) + 'px ' + KANJI_FAMILY;
            game.text(g, it.kanji, x + 40, ry + 44, U.alpha(it.color || rgb(220, 90, 70), dim), true);
            g.font = 'bold 17px serif';
            game.text(g, it.name, x + 84, ry + 24, U.alpha(rgb(245, 235, 215), dim), false);
            g.font = SMALL_FONT;
            game.text(g, it.desc, x + 84, ry + 44, U.alpha(rgb(200, 190, 175), dim), false);
            g.font = '12px sans-serif';
            game.text(g, it.info, x + 84, ry + 62, U.alpha(rgb(140, 210, 200), dim), false);
            g.font = 'bold 13px sans-serif';
            if (!this.unlocked(it)) this.rightText(g, 'Slay ' + it.unlock + ' elite' + (it.unlock > 1 ? 's' : ''), x + w - 12, ry + 24, rgb(200, 120, 110));
            else if (weaponLocked) this.rightText(g, 'Requires ' + weaponTypeName(it.weapon), x + w - 12, ry + 24, rgb(220, 160, 110));
            else if (slot.field === 'armor' && it.affinity) {
                const fits = armorFitsWeapon(it, lo.swordDef());
                const tag = fits ? WEAPON_TYPES.find(t => t.id === it.affinity).label.replace(/s$/, '') + ' bonus active' : 'Best with a ' + weaponTypeName(it.affinity);
                this.rightText(g, (equipped ? 'EQUIPPED  -  ' : '') + tag, x + w - 12, ry + 24,
                    fits ? rgb(130, 225, 140) : equipped ? rgb(240, 200, 110) : rgb(170, 160, 150));
            } else if (equipped) this.rightText(g, 'EQUIPPED', x + w - 12, ry + 24, rgb(240, 200, 110));
            if (it.cost !== undefined) {
                this.rightText(g, 'Costs ' + it.cost + ' art charges', x + w - 12, ry + 62, U.alpha(rgb(255, 215, 110), dim));
            }
        }
        g.font = HUD_FONT;
        if (first > 0) game.text(g, '\u25b2', x + w / 2, y - 4, rgb(220, 200, 160), true);
        if (first + vis < list.length) game.text(g, '\u25bc', x + w / 2, y + vis * (rowH + gap) + 8, rgb(220, 200, 160), true);
    }

    drawSkills(g, x, y, w, h, R) {
        const game = this.g, skills = game.skills, t = game.realTime;
        const selIdx = this.sel[SKILL_TAB], selSk = skillAt(Math.floor(selIdx / SKILL_TIERS), selIdx % SKILL_TIERS);
        const need = expForNextPoint(game.pointsEarned);
        // EXP bar and points
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fillRect(x, y + 2, 240, 8);
        g.fillStyle = 'rgb(120,210,190)';
        g.fillRect(x, y + 2, 240 * U.clamp(game.exp / need, 0, 1), 8);
        g.font = SMALL_FONT;
        game.text(g, 'EXP ' + Math.floor(game.exp) + ' / ' + need + '  to next point', x, y + 26, rgb(170, 225, 210), false);
        g.font = 'bold 17px serif';
        this.rightText(g, 'Skill Points: ' + game.skillPoints, x + w - 6, y + 14,
            game.skillPoints > 0 ? rgb(255, 215, 110) : rgb(170, 160, 150));

        const colW = w / 3, nodeR = 20, y0 = y + 92, gap = 52;
        SKILL_BRANCHES.forEach((br, b) => {
            const cx = x + colW * (b + 0.5);
            g.font = 'bold 22px ' + KANJI_FAMILY;
            game.text(g, br.kanji, cx, y + 54, br.color, true);
            g.font = 'bold 13px serif';
            game.text(g, br.name, cx, y + 72, rgb(220, 205, 185), true);
            for (let tier = 0; tier < SKILL_TIERS; tier++) {
                const sk = skillAt(b, tier), cy = y0 + tier * gap, i = b * SKILL_TIERS + tier;
                const owned = skills.has(sk.id), pre = skillPrereq(sk);
                const open = !owned && (pre === null || skills.has(pre.id));
                if (tier > 0) {
                    setStroke(g, 3, false);
                    g.strokeStyle = owned ? css(br.color) : 'rgb(70,60,54)';
                    strokeLine(g, cx, cy - gap + nodeR, cx, cy - nodeR);
                }
                g.fillStyle = owned ? css(br.color) : open ? 'rgb(64,50,42)' : 'rgb(32,27,25)';
                fillCircle(g, cx, cy, nodeR);
                setStroke(g, 2, false);
                const pulse = open && game.skillPoints >= sk.cost ? 0.55 + 0.45 * Math.sin(t * 5) : 1;
                g.strokeStyle = open ? css(U.alpha(br.color, pulse)) : owned ? 'rgb(255,245,220)' : 'rgb(80,70,64)';
                g.beginPath();
                g.arc(cx, cy, nodeR, 0, TAU);
                g.stroke();
                if (i === selIdx) {
                    setStroke(g, 2, false);
                    g.strokeStyle = 'rgb(255,255,255)';
                    g.beginPath();
                    g.arc(cx, cy, nodeR + 6, 0, TAU);
                    g.stroke();
                }
                g.font = 'bold 20px ' + KANJI_FAMILY;
                game.text(g, sk.kanji, cx, cy + 7, owned ? rgb(40, 24, 18) : open ? br.color : rgb(100, 90, 84), true);
                if (!owned) {
                    g.font = 'bold 11px sans-serif';
                    game.text(g, sk.cost + ' pt', cx + nodeR + 16, cy + 4, open ? rgb(230, 215, 190) : rgb(110, 100, 94), true);
                }
                R.rows.push({ x: cx - nodeR, y: cy - nodeR, w: nodeR * 2, h: nodeR * 2, i });
            }
        });

        const dy = y0 + (SKILL_TIERS - 1) * gap + nodeR + 14, dh = h - (dy - y);
        roundRectPath(g, x, dy, w, dh, 6);
        g.fillStyle = 'rgb(38,30,28)';
        g.fill();
        const br = SKILL_BRANCHES[selSk.branch], owned = skills.has(selSk.id), pre = skillPrereq(selSk);
        g.font = 'bold 18px serif';
        game.text(g, selSk.name, x + 16, dy + 28, rgb(245, 235, 215), false);
        g.font = 'bold 13px serif';
        this.rightText(g, br.name, x + w - 14, dy + 26, br.color);
        g.font = SMALL_FONT;
        game.text(g, selSk.desc, x + 16, dy + 50, rgb(200, 190, 175), false);
        game.text(g, selSk.info, x + 16, dy + 72, rgb(140, 210, 200), false);
        g.font = 'bold 14px sans-serif';
        let status, c;
        if (owned) {
            status = 'LEARNED';
            c = rgb(240, 200, 110);
        } else if (pre !== null && !skills.has(pre.id)) {
            status = 'Requires ' + pre.name;
            c = rgb(200, 120, 110);
        } else if (game.skillPoints < selSk.cost) {
            status = 'Costs ' + selSk.cost + ' skill point' + (selSk.cost > 1 ? 's' : '') + '  -  not enough points';
            c = rgb(200, 120, 110);
        } else {
            status = 'Costs ' + selSk.cost + ' skill point' + (selSk.cost > 1 ? 's' : '') + '  -  Enter or click again to learn';
            c = rgb(150, 235, 150);
        }
        if (dh > 100) game.text(g, status, x + 16, dy + 98, c, false);
    }

    drawLooks(g, x, y, w, R) {
        const game = this.g, look = game.loadout.look, sel = this.sel[this.tab];
        LOOKS.forEach((l, row) => {
            const ry = y + row * 92, rh = 84;
            R.rows.push({ x, y: ry, w, h: rh, i: row });
            roundRectPath(g, x, ry, w, rh, 6);
            g.fillStyle = row === sel ? 'rgb(72,50,40)' : 'rgb(38,30,28)';
            g.fill();
            g.font = 'bold 17px serif';
            game.text(g, l.label, x + 16, ry + 26, rgb(245, 235, 215), false);
            if (row === sel) {
                g.font = SMALL_FONT;
                this.rightText(g, '\u25c0 A     D \u25b6', x + w - 14, ry + 24, rgb(220, 200, 160));
            }
            const opts = l.colors || l.names;
            for (let j = 0; j < opts.length; j++) {
                const cw = l.colors ? 36 : 104, r = { x: x + 16 + j * (cw + 10), y: ry + 38, w: cw, h: 34, row, val: j };
                R.swatches.push(r);
                roundRectPath(g, r.x, r.y, r.w, r.h, 5);
                g.fillStyle = l.colors ? css(opts[j]) : 'rgb(56,44,40)';
                g.fill();
                if (!l.colors) {
                    g.font = 'bold 14px serif';
                    game.text(g, opts[j], r.x + r.w / 2, r.y + 22, rgb(235, 225, 210), true);
                }
                if (look[l.key] === j) {
                    setStroke(g, 3, false);
                    g.strokeStyle = 'rgb(255,220,140)';
                    g.stroke();
                }
            }
        });
    }
}
