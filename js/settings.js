'use strict';

/**
 * Host-chosen rules for online duels and co-op journeys, plus the New Game + curve.
 * Everything here is validated on both sides, because a client must never trust what a host sends.
 */
const MAX_MATCH_PLAYERS = 8;
const NG_PLUS_MAX = 7;
const ARENA_SIZES = { small: 400, medium: 560, large: 760, huge: 980 };
const ARENA_ORDER = ['small', 'medium', 'large', 'huge'];
const DUEL_SETTINGS_KEY = 'roninsPath.duelSettings.v1';
const COOP_SETTINGS_KEY = 'roninsPath.coopSettings.v1';
const JOURNEY_DIFFICULTY_KEY = 'roninsPath.journeyDifficulty.v1';
const JOURNEY_DIFFICULTIES = {
    loser: { name: 'Loser', enemyHp: 0.65, enemyPosture: 0.7, enemyDmg: 0.55 },
    ashigaru: { name: 'Ashigaru', enemyHp: 0.85, enemyPosture: 0.9, enemyDmg: 0.8 },
    kachi: { name: 'Kachi', enemyHp: 1, enemyPosture: 1, enemyDmg: 1 },
    hatamoto: { name: 'Hatamoto', enemyHp: 1.3, enemyPosture: 1.2, enemyDmg: 1.3 },
    daimyo: { name: 'Daimyo', enemyHp: 1.65, enemyPosture: 1.5, enemyDmg: 1.65 },
    buddha: { name: 'Buddha', enemyHp: 12, enemyPosture: 10, enemyDmg: 8 },
};
const JOURNEY_DIFFICULTY_ORDER = ['loser', 'ashigaru', 'kachi', 'hatamoto', 'daimyo', 'buddha'];

function sanitizeJourneyDifficulty(value) {
    return Object.prototype.hasOwnProperty.call(JOURNEY_DIFFICULTIES, value) ? value : 'kachi';
}

const JourneySettings = {
    readDifficulty() {
        try {
            return sanitizeJourneyDifficulty(localStorage.getItem(JOURNEY_DIFFICULTY_KEY));
        } catch (e) {
            return 'kachi';
        }
    },

    saveDifficulty(value) {
        try {
            localStorage.setItem(JOURNEY_DIFFICULTY_KEY, sanitizeJourneyDifficulty(value));
        } catch (e) { /* storage unavailable */ }
    },
};

function settingInt(v, lo, hi, def) {
    const n = typeof v === 'string' ? parseInt(v, 10) : v;
    return Number.isFinite(n) ? U.clamp(Math.round(n), lo, hi) : def;
}

function sanitizeDuelSettings(s) {
    s = s && typeof s === 'object' ? s : {};
    const ffa = s.mode === 'ffa';
    return {
        mode: ffa ? 'ffa' : 'duel',
        maxPlayers: ffa ? settingInt(s.maxPlayers, 2, MAX_MATCH_PLAYERS, 4) : 2,
        rounds: settingInt(s.rounds, 1, 9, 2),
        hp: settingInt(s.hp, 25, 400, 100),
        posture: settingInt(s.posture, 50, 400, 100),
        gourds: settingInt(s.gourds, 0, 5, 1),
        charges: settingInt(s.charges, 0, 8, BASE_ART_CHARGES),
        speed: settingInt(s.speed, 50, 200, 100),
        parry: settingInt(s.parry, 80, 400, Math.round(PERFECT_WINDOW * 1000)),
        arena: ARENA_ORDER.includes(s.arena) ? s.arena : ffa ? 'large' : 'medium',
    };
}

/** Flat stat overrides handed to every fighter in a match, so all of them start perfectly even. */
function duelStatMods(s) {
    return { hp: s.hp, posture: s.posture, gourds: s.gourds, charges: s.charges, speed: s.speed / 100, parry: s.parry / 1000 };
}

function describeDuelSettings(s) {
    return [s.mode === 'ffa' ? 'Free-for-all, up to ' + s.maxPlayers + ' players' : '1v1 Duel',
        'first to ' + s.rounds + (s.rounds === 1 ? ' round' : ' rounds'),
        s.hp + ' HP', s.posture + ' posture', s.gourds + (s.gourds === 1 ? ' gourd' : ' gourds'),
        s.charges + ' art charges', s.speed + '% speed', s.parry + ' ms parry', s.arena + ' map'].join('  -  ');
}

function sanitizeCoopSettings(s) {
    s = s && typeof s === 'object' ? s : {};
    return {
        maxPlayers: settingInt(s.maxPlayers, 2, MAX_MATCH_PLAYERS, 2),
        enemyScale: settingInt(s.enemyScale, 0, 150, 25),
        countScale: settingInt(s.countScale, 0, 150, 25),
        friendlyFire: s.friendlyFire === true,
    };
}

function describeCoopSettings(s) {
    return ['Up to ' + s.maxPlayers + ' players', '+' + s.enemyScale + '% enemy strength per extra player',
        '+' + s.countScale + '% enemy numbers per extra player', 'friendly fire ' + (s.friendlyFire ? 'on' : 'off')].join('  -  ');
}

/**
 * Enemy multipliers for a party of `players` on New Game +`ngPlus`.
 * Co-op settings may be null for a solo journey, where only the New Game + tier matters.
 */
function difficultyFor(coop, players, ngPlus, tier) {
    const extra = Math.max(0, (players | 0) - 1);
    const ng = U.clamp(ngPlus | 0, 0, NG_PLUS_MAX);
    const rank = JOURNEY_DIFFICULTIES[sanitizeJourneyDifficulty(tier)];
    const party = 1 + (coop ? coop.enemyScale / 100 : 0) * extra;
    return {
        ngPlus: ng,
        enemyHp: rank.enemyHp * party * (1 + 0.22 * ng),
        enemyPosture: rank.enemyPosture * party * (1 + 0.14 * ng),
        enemyDmg: rank.enemyDmg * (1 + 0.1 * ng),
        enemyCount: 1 + (coop ? coop.countScale / 100 : 0) * extra + 0.05 * ng,
    };
}

const MatchSettings = {
    read(key, clean) {
        try {
            return clean(JSON.parse(localStorage.getItem(key)));
        } catch (e) {
            return clean(null);
        }
    },

    write(key, s) {
        try {
            localStorage.setItem(key, JSON.stringify(s));
        } catch (e) { /* storage unavailable */ }
    },

    duel() { return MatchSettings.read(DUEL_SETTINGS_KEY, sanitizeDuelSettings); },
    saveDuel(s) { MatchSettings.write(DUEL_SETTINGS_KEY, s); },
    coop() { return MatchSettings.read(COOP_SETTINGS_KEY, sanitizeCoopSettings); },
    saveCoop(s) { MatchSettings.write(COOP_SETTINGS_KEY, s); },
};
