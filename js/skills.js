'use strict';

/** Skill tree data and EXP curve. Each skill's apply() modifies the stats object from computeStats(). */
const SKILL_BRANCHES = [
    { name: 'Bladebound', kanji: 'I', color: rgb(205, 125, 90) },
    { name: 'Oathkeeper', kanji: 'II', color: rgb(205, 180, 110) },
    { name: 'Wayfarer', kanji: 'III', color: rgb(140, 170, 185) },
];

const SKILLS = [
    { id: 'keen', branch: 0, tier: 0, cost: 1, name: 'Keen Edge', kanji: 'I', desc: 'Your cuts bite deeper.', info: 'Damage +10%',
        apply: s => { s.dmg *= 1.1; } },
    { id: 'crush', branch: 0, tier: 1, cost: 1, name: 'Crushing Blows', kanji: 'II', desc: 'Every strike rattles the enemy\'s stance.',
        info: 'Posture damage +20%', apply: s => { s.post *= 1.2; } },
    { id: 'flow', branch: 0, tier: 2, cost: 2, name: 'Flowing Cuts', kanji: 'III', desc: 'One swing melts into the next.',
        info: 'Swings 12% faster', apply: s => { s.spd *= 0.88; } },
    { id: 'mortalblow', branch: 0, tier: 3, cost: 3, name: 'Grave Hunger', kanji: 'IV', desc: 'Take strength from every critical strike.',
        info: 'Critical strikes restore 20% vitality', apply: s => { s.deathblowHeal += 0.2; } },
    { id: 'dragonflash', branch: 0, tier: 4, cost: 4, name: 'Crownfall', kanji: 'V', desc: 'At full resolve, release a cutting wave with G.',
        info: 'New ability: Crownfall', apply: s => { s.dragonFlash = true; } },

    { id: 'stance', branch: 1, tier: 0, cost: 1, name: 'Enduring Oath', kanji: 'I', desc: 'Stand firm when your strength falters.',
        info: 'Posture +20  -  Stamina +15', apply: s => { s.maxPosture += 20; s.maxStamina += 15; } },
    { id: 'instinct', branch: 1, tier: 1, cost: 1, name: 'Raven Instinct', kanji: 'II', desc: 'Read the blade before it moves.',
        info: 'Deflect window +20ms', apply: s => { s.deflect += 0.02; } },
    { id: 'resonance', branch: 1, tier: 2, cost: 2, name: 'Resonant Parry', kanji: 'III', desc: 'Your parries ring through the enemy\'s bones.',
        info: 'Deflects deal +30% posture damage', apply: s => { s.deflectPost *= 1.3; } },
    { id: 'echo', branch: 1, tier: 3, cost: 3, name: 'Spirit Echo', kanji: 'IV', desc: 'Every parry feeds the art within you.',
        info: '+1 art charge  -  Combat Arts +20% damage', apply: s => { s.charges += 1; s.artDmg *= 1.2; } },
    { id: 'unbroken', branch: 1, tier: 4, cost: 4, name: 'Unbroken', kanji: 'V', desc: 'A perfect parry settles your breathing.',
        info: 'Deflect restores 12 posture', apply: s => { s.deflectRecover += 12; } },

    { id: 'vitality', branch: 2, tier: 0, cost: 1, name: 'Vitality', kanji: 'I', desc: 'A hardier body for a longer road.',
        info: 'Vitality +20', apply: s => { s.maxHp += 20; } },
    { id: 'lightstep', branch: 2, tier: 1, cost: 1, name: 'Light Step', kanji: 'II', desc: 'Move like wind through grass.',
        info: 'Move speed +8%', apply: s => { s.move *= 1.08; } },
    { id: 'breath', branch: 2, tier: 2, cost: 2, name: 'Breath of Life', kanji: 'III', desc: 'Carry one more draught of healing.',
        info: '+1 Amber Flask', apply: s => { s.gourds += 1; } },
    { id: 'shadow', branch: 2, tier: 3, cost: 3, name: 'Shadow Step', kanji: 'IV', desc: 'Vanish between heartbeats.',
        info: 'Dodge invincibility +0.08s  -  Quieter footsteps', apply: s => { s.iframes += 0.08; s.stealth *= 0.7; } },
    { id: 'ironwill', branch: 2, tier: 4, cost: 4, name: 'Iron Will', kanji: 'V', desc: 'Refuse the edge of death.',
        info: 'Survive one lethal hit at 1 HP per rest', apply: s => { s.lastStand = true; } },
];

function skillAt(branch, tier) { return SKILLS.find(s => s.branch === branch && s.tier === tier); }

function skillPrereq(sk) { return sk.tier === 0 ? null : skillAt(sk.branch, sk.tier - 1); }

const SKILL_TIERS = 5;

/** EXP needed to earn the next skill point. */
function expForNextPoint(pointsEarned) { return 120 + 45 * pointsEarned; }

function expForKill(e) {
    if (e.boss) return 2500;
    if (e.elite) return 500;
    const base = e.type === 'BRUTE' ? 70 : 35;
    return Math.round(base * (e.vet ? 1.5 : 1));
}
