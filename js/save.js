'use strict';

/**
 * Persistent save data. The game runs from a local file (file://), so progress lives in the browser's localStorage,
 * with export/import of a .json save file as a backup that survives clearing browser data or switching browsers.
 */
const SAVE_KEY = 'roninsPath.save.v1';
const SAVE_VERSION = 3;
const SAVE_FILE_NAME = 'ronins-path-save.json';
const MAX_SAVE_FILE_BYTES = 1000000;

const SaveGame = {
    read() {
        try {
            const d = JSON.parse(localStorage.getItem(SAVE_KEY));
            return SaveGame.valid(d) ? d : null;
        } catch (e) {
            return null;
        }
    },

    write(d) {
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(d));
            return true;
        } catch (e) {
            return false;
        }
    },

    clear() {
        try {
            localStorage.removeItem(SAVE_KEY);
        } catch (e) { /* storage unavailable */ }
    },

    valid(d) {
        return !!d && typeof d === 'object' && (d.v === 1 || d.v === 2 || d.v === SAVE_VERSION)
            && Number.isFinite(d.seed) && !!d.player && typeof d.player === 'object';
    },

    serialize(game) {
        const p = game.player, world = game.world, sp = game.lastShrine, dead = p.st === 'DEAD';
        const deadEnemies = [];
        game.enemies.forEach((e, i) => { if (e.st === 'DEAD') deadEnemies.push(i); });
        return {
            v: SAVE_VERSION,
            seed: game.seed,
            savedAt: Date.now(),
            player: {
                x: dead ? sp.x : p.x,
                y: dead ? sp.y + 60 : p.y,
                hp: dead ? p.maxHp : p.hp,
                gourds: dead ? p.maxGourds : p.gourds,
                throws: dead ? p.maxThrows : p.throws,
                artCharges: dead ? 0 : p.artCharges,
                ki: dead ? 0 : p.ki,
            },
            lastShrine: world.shrines.indexOf(sp),
            shrines: world.shrines.map(s => s.discovered),
            camps: world.camps.map(c => c.cleared),
            dead: deadEnemies,
            kills: game.kills,
            elitesSlain: game.elitesSlain,
            ngPlus: game.ngPlus,
            bossSpawned: game.bossSpawned,
            bossDefeated: game.bossDefeated,
            buddha: game.buddha === true,
            blessingPending: !!game.johnJava && !game.buddha,
            exp: game.exp,
            pointsEarned: game.pointsEarned,
            skills: [...game.skills],
            loadout: game.loadout.toData(),
        };
    },

    /** Apply untrusted save data to a freshly built game with the same seed. Every value is type-checked and clamped. */
    apply(game, d) {
        const world = game.world, p = game.player;
        const num = (v, lo, hi, def) => (Number.isFinite(v) ? U.clamp(v, lo, hi) : def);
        if (Array.isArray(d.shrines)) world.shrines.forEach((s, i) => { if (d.shrines[i] === true) s.discovered = true; });
        if (Number.isInteger(d.lastShrine) && d.lastShrine >= 0 && d.lastShrine < world.shrines.length) game.lastShrine = world.shrines[d.lastShrine];
        if (Array.isArray(d.camps)) world.camps.forEach((c, i) => { c.cleared = d.camps[i] === true; });
        if (Array.isArray(d.dead)) {
            for (const i of d.dead) {
                const e = Number.isInteger(i) ? (d.v === 1
                    ? game.enemies.find(enemy => enemy.legacyIndex === i)
                    : d.v === 2 ? game.enemies.find(enemy => enemy.previousIndex === i) : game.enemies[i]) : undefined;
                if (e === undefined) continue;
                e.hp = 0;
                e.alive = false;
                e.releaseToken();
                e.setSt('DEAD');
                e.deadT = 999;
            }
            if (d.v < SAVE_VERSION) for (const c of world.camps) {
                if (c.members.every(e => e.st === 'DEAD')) c.cleared = true;
            }
        }
        game.kills = Math.trunc(num(d.kills, 0, 1e7, 0));
        game.elitesSlain = Math.trunc(num(d.elitesSlain, 0, game.totalElites, 0));
        game.ngPlus = Math.trunc(num(d.ngPlus, 0, NG_PLUS_MAX, 0));
        game.bossDefeated = d.bossDefeated === true;
        game.buddha = d.buddha === true;
        if (d.bossSpawned === true && !game.bossDefeated) game.spawnFinalBoss();
        game.loadout.apply(d.loadout, game.elitesSlain);
        game.pointsEarned = Math.trunc(num(d.pointsEarned, 0, 1000, 0));
        game.exp = num(d.exp, 0, expForNextPoint(game.pointsEarned) - 1, 0);
        // only keep skills whose prerequisites are learned and that fit in the points earned
        const wanted = new Set(Array.isArray(d.skills) ? d.skills.filter(id => typeof id === 'string') : []);
        let spent = 0;
        game.skills.clear();
        for (const sk of [...SKILLS].sort((a, b) => a.tier - b.tier)) {
            const pre = skillPrereq(sk);
            if (!wanted.has(sk.id) || (pre !== null && !game.skills.has(pre.id)) || spent + sk.cost > game.pointsEarned) continue;
            game.skills.add(sk.id);
            spent += sk.cost;
        }
        game.skillPoints = game.pointsEarned - spent;
        // elite rewards are derived from progress rather than trusted from the file
        Object.assign(p, playerProgression(game.elitesSlain, game.bossDefeated));
        p.applyLoadout();
        const s = d.player;
        p.hp = num(s.hp, 1, p.maxHp, p.maxHp);
        p.gourds = Math.trunc(num(s.gourds, 0, p.maxGourds, p.maxGourds));
        p.throws = Math.trunc(num(s.throws, 0, p.maxThrows, p.maxThrows));
        p.artCharges = Math.trunc(num(s.artCharges, 0, p.maxArtCharges, 0));
        p.ki = num(s.ki, 0, 100, 0);
        p.x = num(s.x, 0, WORLD_SIZE, p.x);
        p.y = num(s.y, 0, WORLD_SIZE, p.y);
        world.resolve(p);
        game.camX = p.x;
        game.camY = p.y;
        if (game.bossDefeated || d.blessingPending === true) {
            game.beginJohnJava();
            if (game.buddha) {
                game.johnJava.t = 3;
                game.johnJava.finished = true;
            }
        }
    },

    exportFile(game) {
        const blob = new Blob([JSON.stringify(SaveGame.serialize(game))], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = SAVE_FILE_NAME;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    /** Opens a file picker; a valid save replaces the current one and the game reloads into it. */
    importFile(onError) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener('change', () => {
            const f = input.files && input.files[0];
            if (!f) return;
            if (f.size > MAX_SAVE_FILE_BYTES) {
                onError('That file is too large to be a save');
                return;
            }
            const r = new FileReader();
            r.onload = () => {
                let d = null;
                try {
                    d = JSON.parse(String(r.result));
                } catch (e) { /* handled below */ }
                if (!SaveGame.valid(d)) onError('Not a valid Ronin\'s Path save file');
                else if (!SaveGame.write(d)) onError('This browser blocked local storage - cannot load saves');
                else location.replace(location.pathname);
            };
            r.onerror = () => onError('Could not read that file');
            r.readAsText(f);
        });
        input.click();
    },
};
