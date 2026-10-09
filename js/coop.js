'use strict';

const COOP_ENEMY_FIELDS = ['x', 'y', 'facing', 'st', 'stT', 'stDur', 'hp', 'posture', 'lives', 'aware', 'deadT',
    'walkAnim', 'hitFlash', 'blockAnim', 'showBars', 'perilousT', 'beingExecuted'];
const COOP_PLAYER_FIELDS = ['x', 'y', 'facing', 'st', 'stT', 'phase', 'combo', 'guarding', 'guardHeld', 'sprinting',
    'dodgeStartX', 'dodgeStartY',
    'walkAnim', 'scarf', 'swingSign', 'stabAttack', 'hurtFlash', 'invuln', 'vx', 'vy', 'hp', 'maxHp', 'maxGourds', 'maxPosture',
    'posture', 'deflectStreak', 'deflectPost', 'dmgTaken', 'guardWindow', 'stealth', 'dodgeIframes', 'poiseLeft', 'artHitsLeft',
    'buddhaReviveReady', 'buddhaDeathblows'];
const COOP_SYNC_INTERVAL = 0.05;

class Coop {
    constructor(game, link, host, settings, slot) {
        this.game = game;
        this.link = link;
        this.host = host;
        this.settings = sanitizeCoopSettings(settings);
        this.slot = slot | 0;
        // every other player in the party, by slot; the host is always slot 0
        this.bodies = new Map();
        this.sendT = 0;
        this.attackId = 0;
        this.renderPositions = new Map();
        this.lastAttackId = new Map();
        this.deadSeen = new Map();
        if (host) for (const c of link.conns) this.bodyFor(c.idx);
        else this.bodyFor(0);
        this.link.on('coop-player', (d, c) => { if (this.host) this.receivePlayer(d, c); });
        this.link.on('coop-attack', (d, c) => { if (this.host) this.receiveAttack(d, c); });
        this.link.on('coop-reality-tear', (d, c) => {
            if (this.host) {
                const p = c && this.bodies.get(c.idx);
                if (p && this.game.ultimate && p.st === 'ART' && p.art.id === 'reality-tear'
                    && this.game.time >= (p.realityTearReadyAt || 0)) {
                    p.realityTearReadyAt = this.game.time + REALITY_TEAR_ART.dur;
                    this.game.openRealityTear(p);
                }
            } else if (d.owner !== this.slot && d.tear && Number.isFinite(d.tear.x)
                && Number.isFinite(d.tear.y) && Number.isFinite(d.tear.facing)) {
                this.game.addRealityTear({ x: U.clamp(d.tear.x, 0, WORLD_SIZE), y: U.clamp(d.tear.y, 0, WORLD_SIZE),
                    facing: d.tear.facing, range: 300, arc: 110 * DEG, t: 0 });
            }
        });
        this.link.on('coop-ff', (d, c) => { if (this.host) this.receiveFriendlyFire(d, c); });
        this.link.on('coop-mikiri-player', (d, c) => { if (this.host) this.receivePlayerMikiri(d, c); });
        this.link.on('coop-settings', d => { if (!this.host && d && d.s) this.game.applyCoopSettings(d.s); });
        this.link.on('coop-reset', d => { if (!this.host) this.receiveReset(d); });
        this.link.on('coop-world', d => { if (!this.host) this.receiveWorld(d); });
        this.link.on('coop-impact', d => { if (!this.host) this.receiveImpact(d); });
        this.link.onPeerClose = c => this.onPeerClose(c);
        this.link.onClose = () => {
            this.link.close();
            this.game.coop = null;
            this.game.note('Party disconnected. Continuing solo.', false);
        };
        game.coop = this;
    }

    /** Kept for the call sites that only ever expect a single partner. */
    get remote() {
        for (const b of this.bodies.values()) return b;
        return null;
    }

    get party() { return [...this.bodies.values()]; }

    bodyFor(id) {
        if (!Number.isInteger(id) || id < 0 || id >= MAX_MATCH_PLAYERS || id === this.slot) return null;
        const existing = this.bodies.get(id);
        if (existing !== undefined) return existing;
        const g = this.game, b = new Player(g, g.player.x + 45, g.player.y);
        b.g = Object.assign(Object.create(g), { loadout: g.loadout.clone(), onPlayerDeath() {} });
        b.cur = b.comboAtk[0];
        b.curArt = b.art;
        b.time = g.time;
        this.bodies.set(id, b);
        return b;
    }

    playerOf(id) { return id === this.slot ? this.game.player : this.bodies.get(id) || null; }

    connFor(id) { return this.link.conns.find(c => c.idx === id) || null; }

    onPeerClose(c) {
        if (!this.host || !c || !Number.isInteger(c.idx)) return;
        this.bodies.delete(c.idx);
        this.game.note('A friend left the journey.', false);
    }

    static fields(obj, names) {
        const out = {};
        for (const key of names) out[key] = obj[key];
        return out;
    }

    static playerData(p) {
        return Object.assign(Coop.fields(p, COOP_PLAYER_FIELDS),
            { sword: p.g.loadout.sword, throwable: p.g.loadout.throwable, art: p.g.loadout.art, armor: p.g.loadout.armor });
    }

    static syncGear(p, data) {
        if (!data || typeof data !== 'object') return;
        const lo = p.g.loadout;
        const weapon = SWORDS.find(w => w.id === data.sword);
        const throwable = THROWABLES.find(w => w.id === data.throwable);
        const armor = ARMORS.find(a => a.id === data.armor);
        const nextWeapon = weapon || lo.swordDef();
        const art = ARTS.find(a => a.id === data.art);
        const nextArt = art && artMatchesWeapon(art, nextWeapon) ? art.id
            : !artMatchesWeapon(lo.artDef(), nextWeapon) ? ARTS[0].id : lo.art;
        if ((weapon && lo.sword !== weapon.id) || (throwable && lo.throwable !== throwable.id) || lo.art !== nextArt
            || (armor && lo.armor !== armor.id)) {
            if (weapon) lo.sword = weapon.id;
            if (throwable) lo.throwable = throwable.id;
            if (armor) lo.armor = armor.id;
            lo.art = nextArt;
            p.applyLoadout();
        }
    }

    static apply(obj, data, names) {
        if (!data || typeof data !== 'object') return;
        for (const key of names) {
            if (key === 'st') {
                if (typeof data[key] === 'string' && data[key].length < 20) obj[key] = data[key];
            } else if (Number.isFinite(data[key])) obj[key] = key === 'artHitsLeft' ? U.clamp(Math.floor(data[key]), 0, 2) : data[key];
            else if (typeof obj[key] === 'boolean' && typeof data[key] === 'boolean') obj[key] = data[key];
        }
    }

    tick(dt) {
        this.sendT -= dt;
        if (this.sendT > 0) return;
        this.sendT = COOP_SYNC_INTERVAL;
        if (this.host) {
            const game = this.game, p = game.player, party = this.party;
            const near = (x, y) => U.dist(x, y, p.x, p.y) <= 2200 || party.some(b => U.dist(x, y, b.x, b.y) <= 2200);
            const players = [[this.slot, Coop.playerData(p)]];
            const health = [];
            for (const [id, b] of this.bodies) {
                players.push([id, Coop.playerData(b)]);
                health.push([id, { hp: b.hp, posture: b.posture, st: b.st === 'DEAD' ? 'DEAD' : null }]);
            }
            this.link.send({ t: 'coop-world', settings: game.coopSettings, players, health, enemies: game.enemies.map((e, i) => {
                if (e.st !== 'DEAD' && !near(e.x, e.y)) return null;
                const state = Coop.fields(e, COOP_ENEMY_FIELDS);
                state.id = i;
                state.atk = e.atk ? e.atk.name : null;
                return state;
            }).filter(Boolean), dead: game.enemies.flatMap((e, i) => e.st === 'DEAD' ? [i] : []),
            kills: game.kills, elites: game.elitesSlain, boss: game.bossSpawned, defeated: game.bossDefeated,
            buddha: game.buddha === true, ultimate: game.ultimate === true,
            javaBlessings: game.javaBlessings || 0,
            ultimatePending: !!game.johnJava && game.johnJava.ultimate === true && !game.ultimate, ng: game.ngPlus,
            camps: game.world.camps.map(c => c.cleared), shrines: game.world.shrines.map(s => s.discovered) });
        } else {
            const p = this.game.player;
            this.link.send({ t: 'coop-player', player: Coop.playerData(p),
                gourds: p.gourds, throws: p.throws, guardAge: this.game.time - p.guardStart,
                shrines: this.game.world.shrines.map(s => s.discovered) });
        }
    }

    receivePlayer(d, c) {
        const id = c ? c.idx : -1, r = this.bodies.get(id);
        if (r === undefined) return;
        const p = d.player;
        const atShrine = p && Number.isFinite(p.x) && Number.isFinite(p.y)
            && this.game.world.nearShrine(p.x, p.y) < 120;
        const sawDead = this.deadSeen.get(id) === true;
        const respawning = r.st === 'DEAD' && sawDead && p && p.st === 'FREE' && atShrine;
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)
            || (!respawning && U.dist(p.x, p.y, r.x, r.y) > 200)
            || p.x < 0 || p.y < 0 || p.x > WORLD_SIZE || p.y > WORLD_SIZE) return;
        if (r.st === 'DEAD' && p.st === 'DEAD') this.deadSeen.set(id, true);
        if (r.st === 'DEAD' && p.st !== 'DEAD' && !sawDead) return;
        const oldGourds = r.gourds;
        const oldHp = r.hp;
        Coop.syncGear(r, p);
        Coop.apply(r, p, COOP_PLAYER_FIELDS);
        r.cur = r.stabAttack ? r.stabAtk : (r.comboAtk[U.clamp(r.combo, 0, 2)] || r.comboAtk[0]);
        r.curArt = r.art;
        if (oldHp === 0 && r.st !== 'DEAD') {
            this.deadSeen.set(id, false);
            r.hp = U.clamp(p.hp, 1, r.maxHp);
            r.posture = 0;
            r.gourds = U.clamp(d.gourds, 0, r.maxGourds);
        } else if (r.st !== 'DEAD' && Number.isInteger(d.gourds) && d.gourds < oldGourds && d.gourds >= 0) {
            r.gourds = d.gourds;
            r.hp = Math.min(r.maxHp, Math.max(oldHp, p.hp));
        } else if (r.st !== 'DEAD' && atShrine && p.st === 'FREE'
            && !this.game.enemies.some(e => e.st !== 'DEAD' && U.dist(e.x, e.y, p.x, p.y) < 480)) {
            r.hp = Math.max(oldHp, Math.min(r.maxHp, p.hp));
            r.posture = Math.min(r.posture, p.posture);
        } else if (r.st !== 'DEAD') r.hp = Math.min(oldHp, r.hp);
        if (Number.isInteger(d.gourds) && d.gourds > r.gourds && d.gourds <= r.maxGourds
            && this.game.world.nearShrine(r.x, r.y) < 120) r.gourds = d.gourds;
        if (Number.isInteger(d.throws) && d.throws >= 0 && d.throws <= r.maxThrows
            && (d.throws <= r.throws || (atShrine && p.st === 'FREE'
                && !this.game.enemies.some(e => e.st !== 'DEAD' && U.dist(e.x, e.y, p.x, p.y) < 480)))) r.throws = d.throws;
        if (Number.isFinite(d.guardAge)) r.guardStart = this.game.time - Math.max(0, d.guardAge);
        if (Array.isArray(d.shrines)) this.game.world.shrines.forEach((s, i) => { if (d.shrines[i] === true) s.discovered = true; });
    }

    receiveWorld(d) {
        if (!Array.isArray(d.enemies) || !Array.isArray(d.dead) || d.enemies.length > 300) return;
        const game = this.game;
        if (d.settings) game.applyCoopSettings(d.settings);
        if (d.boss && !game.bossSpawned) game.spawnFinalBoss();
        if (Array.isArray(d.players)) {
            const seen = new Set();
            for (const entry of d.players) {
                if (!Array.isArray(entry) || entry.length !== 2 || entry[0] === this.slot) continue;
                const b = this.bodyFor(entry[0]);
                if (b === null) continue;
                seen.add(entry[0]);
                Coop.syncGear(b, entry[1]);
                Coop.apply(b, entry[1], COOP_PLAYER_FIELDS);
                b.cur = b.stabAttack ? b.stabAtk : (b.comboAtk[U.clamp(b.combo, 0, 2)] || b.comboAtk[0]);
                b.curArt = b.art;
                this.updateRenderPosition(b);
            }
            for (const id of [...this.bodies.keys()]) if (!seen.has(id)) this.bodies.delete(id);
        }
        if (Array.isArray(d.health)) {
            for (const entry of d.health) {
                if (!Array.isArray(entry) || entry[0] !== this.slot) continue;
                const h = entry[1], p = game.player;
                if (!h || !Number.isFinite(h.hp)) continue;
                if (h.st === 'DEAD' && p.st !== 'DEAD') p.die();
                else if (p.st !== 'DEAD') {
                    p.hp = U.clamp(h.hp, 0, p.maxHp);
                    if (Number.isFinite(h.posture)) p.posture = U.clamp(h.posture, 0, p.maxPosture);
                }
            }
        }
        const newlyDead = [];
        for (const state of d.enemies) {
            const e = Number.isInteger(state.id) ? game.enemies[state.id] : null;
            if (!e) continue;
            if (e.st !== 'DEAD' && state.st === 'DEAD') newlyDead.push(e);
            Coop.apply(e, state, COOP_ENEMY_FIELDS);
            e.atk = state.atk ? Object.values(EA).find(a => a.name === state.atk) || null : null;
            this.updateRenderPosition(e);
        }
        for (const id of d.dead) {
            const e = Number.isInteger(id) ? game.enemies[id] : null;
            if (!e || e.st === 'DEAD') continue;
            newlyDead.push(e);
            e.st = 'DEAD';
            e.hp = 0;
        }
        for (const e of newlyDead) {
            game.gainExp(expForKill(e), e.x, e.y);
        }
        if (Number.isInteger(d.kills)) game.kills = d.kills;
        if (Number.isInteger(d.ng)) game.ngPlus = U.clamp(d.ng, 0, NG_PLUS_MAX);
        if (Number.isInteger(d.elites) && (d.elites > game.elitesSlain || (d.defeated && !game.bossDefeated))) {
            const reward = d.elites > game.elitesSlain || (d.defeated && !game.bossDefeated);
            game.elitesSlain = d.elites;
            Object.assign(game.player, playerProgression(d.elites, d.defeated));
            game.player.applyLoadout();
            if (reward) {
                game.player.hp = game.player.maxHp;
                game.player.gourds = game.player.maxGourds;
            }
        }
        const victory = d.defeated === true && !game.bossDefeated;
        game.bossDefeated = d.defeated === true;
        if ((d.ultimatePending === true || (victory && d.ultimate === true))
            && game.buddha && !game.ultimate) game.beginUltimateAscension();
        else if (victory) game.beginJohnJava();
        if (d.buddha === true) {
            game.grantBuddha();
        }
        if (d.ultimate === true && d.buddha === true) game.grantUltimatePower();
        if (Number.isSafeInteger(d.javaBlessings) && d.javaBlessings >= 0
            && game.javaBlessings !== d.javaBlessings) {
            game.javaBlessings = d.javaBlessings;
            game.player.applyLoadout();
            for (const p of this.party) p.applyLoadout();
        }
        if (Array.isArray(d.camps)) game.world.camps.forEach((c, i) => { if (d.camps[i]) c.cleared = true; });
        if (Array.isArray(d.shrines)) game.world.shrines.forEach((s, i) => { if (d.shrines[i]) s.discovered = true; });
    }

    receiveReset(d) {
        if (!d || !Number.isFinite(d.seed) || !Number.isInteger(d.ngPlus) || !d.settings) return;
        this.game.applyCoopSettings(d.settings);
        this.game.resetMap(d.seed, d.ngPlus, true);
        this.game.note('The host reset the journey map.', true);
    }

    /** Host-only: tell one guest what just happened to their own body. */
    impact(p, result, sourceX, sourceY, perilous = false) {
        let id = -1;
        for (const [k, b] of this.bodies) if (b === p) id = k;
        const c = this.connFor(id);
        if (c === null) return;
        c.send({ t: 'coop-impact', result, hp: p.hp, posture: p.posture, ki: p.ki,
            artCharges: p.artCharges, st: p.st, stT: p.stT, staggerDur: p.staggerDur, guarding: p.guarding,
            vx: p.vx, vy: p.vy, invuln: p.invuln, poiseLeft: p.poiseLeft, artHitsLeft: p.artHitsLeft, deflectStreak: p.deflectStreak,
            sourceX, sourceY, perilous });
    }

    receiveImpact(d) {
        const p = this.game.player;
        if (p.st === 'DEAD' || !Number.isFinite(d.hp) || !Number.isFinite(d.posture)) return;
        p.hp = U.clamp(d.hp, 0, p.maxHp);
        p.posture = U.clamp(d.posture, 0, p.maxPosture);
        if (Number.isFinite(d.ki)) p.ki = U.clamp(d.ki, 0, 100);
        if (Number.isFinite(d.artCharges)) p.artCharges = U.clamp(d.artCharges, 0, p.maxArtCharges);
        if (Number.isFinite(d.vx)) p.vx = U.clamp(d.vx, -1000, 1000);
        if (Number.isFinite(d.vy)) p.vy = U.clamp(d.vy, -1000, 1000);
        if (typeof d.guarding === 'boolean') p.guarding = d.guarding;
        if (Number.isFinite(d.deflectStreak)) p.deflectStreak = U.clamp(d.deflectStreak, 0, 6);
        if (d.result === P_DEFLECT || d.result === P_PERFECT) {
            p.guardFlash = 0.25;
            const ang = Number.isFinite(d.sourceX) && Number.isFinite(d.sourceY)
                ? Math.atan2(d.sourceY - p.y, d.sourceX - p.x) : p.facing;
            const cx = p.x + Math.cos(ang) * (p.r + 12), cy = p.y + Math.sin(ang) * (p.r + 12);
            const k = Math.min(p.deflectStreak || 1, 6);
            this.game.fx.sparks(cx, cy, ang, 2.8, 36 + k * 8, 620 + k * 50, rgb(255, 200, 80));
            this.game.fx.sparks(cx, cy, ang + Math.PI / 2, 0.6, 8 + k, 460, WHITE);
            this.game.fx.sparks(cx, cy, ang - Math.PI / 2, 0.6, 8 + k, 460, WHITE);
            this.game.fx.ring(cx, cy, 4, 50 + k * 8, 0.25, 4, rgb(255, 240, 180));
            this.game.fx.ring(cx, cy, 2, 100 + k * 14, 0.4, 2, rgb(255, 255, 255));
            this.game.parryBurst(cx, cy, k);
            this.game.hitstop(0.1 + k * 0.012);
            this.game.shake(8 + k * 1.2);
            this.game.zoomKick(0.035 + k * 0.008);
            this.game.flash(rgb(255, 235, 180), 0.14 + k * 0.02);
            this.game.sfx.play('PARRY');
            if (d.perilous) this.game.fx.impact(cx, cy, 'sweep');
            const perfect = d.result === P_PERFECT;
            const text = perfect ? 'PERFECT PARRY' : p.deflectStreak > 1 ? 'DEFLECT x' + p.deflectStreak : 'DEFLECT';
            this.game.fx.text(text, p.x, p.y - 42, perfect ? rgb(255, 250, 200) : rgb(255, 215, 90),
                (perfect ? 20 : 16) + k * 3);
            if (perfect) this.game.fx.impact(cx, cy, 'parry');
        } else if (d.result === P_BUDDHA_MIKIRI || d.result === P_BUDDHA_SWEEP) {
            const ang = Number.isFinite(d.sourceX) && Number.isFinite(d.sourceY)
                ? Math.atan2(d.sourceY - p.y, d.sourceX - p.x) : p.facing;
            const cx = p.x + Math.cos(ang) * (p.r + 12), cy = p.y + Math.sin(ang) * (p.r + 12);
            const sweep = d.result === P_BUDDHA_SWEEP;
            this.game.fx.sparks(cx, cy, ang, 3, 40, 600, rgb(140, 220, 255));
            this.game.fx.ring(cx, cy, 5, 90, 0.4, 5, rgb(180, 230, 255));
            this.game.fx.text(sweep ? 'SWEEP COUNTER' : 'MIKIRI COUNTER', p.x, p.y - 48, rgb(140, 220, 255), 20);
            this.game.fx.impact(cx, cy, sweep ? 'sweep' : 'mikiri');
            this.game.hitstop(0.12);
            this.game.slowmo(0.35);
            this.game.flash(rgb(180, 230, 255), 0.2);
        } else if (d.result === P_PERFECT_DODGE) {
            p.leaveDodgeAfterimage();
            const ang = Number.isFinite(d.sourceX) && Number.isFinite(d.sourceY)
                ? Math.atan2(d.sourceY - p.y, d.sourceX - p.x) : p.facing;
            const cx = p.x + Math.cos(ang) * (p.r + 12), cy = p.y + Math.sin(ang) * (p.r + 12);
            this.game.fx.sparks(cx, cy, ang, 2.2, 24, 520, rgb(160, 220, 255));
            this.game.fx.ring(cx, cy, 8, 105, 0.22, 4, rgb(190, 235, 255));
            this.game.fx.text('PERFECT DODGE', p.x, p.y - 42, rgb(190, 235, 255), 20);
            this.game.fx.impact(cx, cy, 'dodge');
            this.game.hitstop(0.075);
            this.game.slowmo(0.14);
            this.game.flash(rgb(180, 230, 255), 0.16);
        } else if (d.result === P_BLOCK) {
            const ang = Number.isFinite(d.sourceX) && Number.isFinite(d.sourceY)
                ? Math.atan2(d.sourceY - p.y, d.sourceX - p.x) : p.facing;
            this.game.fx.sparks(p.x + Math.cos(ang) * (p.r + 12), p.y + Math.sin(ang) * (p.r + 12),
                ang, 1.8, 10, 280, rgb(255, 150, 60));
            if (d.st === 'STAGGER') {
                this.game.fx.text('GUARD BROKEN', p.x, p.y - 42, rgb(255, 80, 60), 18);
                this.game.sfx.play('BREAK');
                this.game.shake(10);
            } else {
                this.game.sfx.play('BLOCK');
                this.game.shake(3);
                this.game.hitstop(0.035);
            }
        } else {
            p.hurtFlash = 0.3;
            p.invuln = U.clamp(d.invuln, 0, 2);
            const ang = Number.isFinite(d.sourceX) && Number.isFinite(d.sourceY)
                ? Math.atan2(d.sourceY - p.y, d.sourceX - p.x) : p.facing;
            this.game.fx.blood(p.x, p.y, ang + Math.PI, 12, 260);
            this.game.sfx.play('HURT');
            if (Number.isFinite(d.poiseLeft)) p.poiseLeft = U.clamp(Math.min(p.poiseLeft, d.poiseLeft), 0, p.poise * 5);
            if (Number.isFinite(d.artHitsLeft)) p.artHitsLeft = U.clamp(Math.floor(Math.min(p.artHitsLeft, d.artHitsLeft)), 0, 2);
            if (d.st === 'ATTACK' || d.st === 'ART') {
                this.game.fx.sparks(p.x + Math.cos(ang) * (p.r + 12), p.y + Math.sin(ang) * (p.r + 12),
                    ang, 1.2, 10, 300, rgb(255, 170, 90));
                this.game.fx.ring(p.x, p.y, p.r, p.r + 16, 0.2, 3, rgb(255, 190, 120));
                this.game.fx.text('UNFLINCHING', p.x, p.y - 42, rgb(255, 190, 120), 14);
                this.game.shake(5);
                this.game.hitstop(0.04);
                this.game.flash(rgb(200, 0, 0), 0.12);
            } else {
                this.game.shake(d.perilous ? 14 : 9);
                this.game.hitstop(0.06);
                this.game.flash(rgb(200, 0, 0), 0.25);
            }
        }
        if (d.st === 'DEAD') p.die();
        else if (d.st === 'STAGGER') {
            p.st = 'STAGGER';
            p.stT = Number.isFinite(d.stT) ? U.clamp(d.stT, 0, 3) : 0;
            p.staggerDur = Number.isFinite(d.staggerDur) ? U.clamp(d.staggerDur, 0.1, 3) : 0.4;
        }
    }

    playerMikiri(p, attacker) {
        let attackerId = -1;
        for (const [id, body] of this.bodies) if (body === attacker) attackerId = id;
        if (attackerId < 0) return;
        if (this.host) this.resolvePlayerMikiri(p, attacker);
        else this.link.send({ t: 'coop-mikiri-player', attacker: attackerId });
    }

    receivePlayerMikiri(d, c) {
        if (!c || !Number.isInteger(d.attacker) || !this.settings.friendlyFire) return;
        const attacker = this.playerOf(d.attacker), p = this.playerOf(c.idx);
        if (attacker && p) this.resolvePlayerMikiri(p, attacker);
    }

    resolvePlayerMikiri(p, attacker) {
        if (attacker.st === 'DEAD' || !attacker.cur || !attacker.cur.perilous || !attacker.cur.thrust
            || p.st === 'DEAD' || p.distTo(attacker) > attacker.cur.range + 100) return;
        const a = p.angleTo(attacker);
        attacker.posture += attacker.maxPosture * 0.5;
        attacker.postureCd = 1.0;
        attacker.st = 'STAGGER';
        attacker.stT = 0;
        attacker.staggerDur = 1.1;
        attacker.vx = Math.cos(a) * 260;
        attacker.vy = Math.sin(a) * 260;
        p.ki = Math.min(100, p.ki + 25);
        p.gainArtCharge();
        this.game.fx.sparks((p.x + attacker.x) / 2, (p.y + attacker.y) / 2, a + Math.PI, 3, 40, 600, rgb(140, 220, 255));
        this.game.fx.text('MIKIRI COUNTER', p.x, p.y - 48, rgb(140, 220, 255), 20);
        this.game.fx.impact((p.x + attacker.x) / 2, (p.y + attacker.y) / 2, 'mikiri');
        this.game.sfx.play('CLANG');
        this.game.hitstop(0.12);
        this.game.shake(11);
        if (attacker.posture >= attacker.maxPosture) attacker.posture = attacker.maxPosture;
    }

    /** Blades do not care whose side you are on once the host turns friendly fire on. */
    friendlyHitCheck(p, atk) {
        for (const [id, b] of this.bodies) {
            if (b.st === 'DEAD' || p.hitSet.has(b)) continue;
            const d = p.distTo(b);
            if (d > atk.range + b.r) continue;
            const tol = atk.arc / 2 + Math.asin(Math.min(1, b.r / Math.max(d, 1)));
            if (Math.abs(U.angDiff(p.facing, p.angleTo(b))) > tol) continue;
            p.hitSet.add(b);
            this.friendlyStrike(p, b, atk);
        }
    }

    friendlyStrike(p, b, atk) {
        if (this.host) this.resolveFriendlyFire(p, b, atk);
        else {
            const id = [...this.bodies].find(([, body]) => body === b)?.[0];
            if (id !== undefined) this.link.send({ t: 'coop-ff', id, atk: {
                damage: atk.damage, posture: atk.posture, range: atk.range, arc: atk.arc } });
        }
    }

    resolveFriendlyFire(att, target, atk) {
        const res = target.receive(att.x, att.y, atk.damage, atk.posture, false);
        if (res === P_IGNORE) return;
        if (res === P_HIT) {
            this.game.fx.text(String(Math.trunc(atk.damage * target.dmgTaken)), target.x, target.y - 30, rgb(255, 160, 120), 13);
        } else if (res === P_PERFECT_DODGE) {
            att.recoil(target.angleTo(att));
            this.game.fx.text('COUNTER OPENING', att.x, att.y - 40, rgb(190, 235, 255), 14);
        }
        if (target !== this.game.player) this.impact(target, res, att.x, att.y);
    }

    receiveFriendlyFire(d, c) {
        if (!this.settings.friendlyFire || !c) return;
        const att = this.bodies.get(c.idx), target = this.playerOf(d.id), a = d.atk;
        if (att === undefined || target === null || target === att || att.st === 'DEAD' || target.st === 'DEAD') return;
        if (!a || !Number.isFinite(a.damage) || !Number.isFinite(a.posture) || !Number.isFinite(a.range) || !Number.isFinite(a.arc)
            || a.damage < 0 || a.damage > 120 || a.posture < 0 || a.posture > 140 || a.range < 0 || a.range > 280
            || a.arc < 0 || a.arc > TAU || att.distTo(target) > a.range + target.r + 30) return;
        this.resolveFriendlyFire(att, target, a);
    }

    strike(e, atk) {
        this.action('strike', e, { damage: atk.damage, posture: atk.posture, range: atk.range,
            arc: atk.arc, pierce: !!atk.pierce, art: !!atk.art, heavy: !!atk.heavy });
    }

    action(kind, e, atk) {
        const id = this.game.enemies.indexOf(e);
        if (id < 0) return;
        this.link.send({ t: 'coop-attack', id, kind, atk, seq: ++this.attackId });
    }

    receiveAttack(d, c) {
        const game = this.game, e = Number.isInteger(d.id) ? game.enemies[d.id] : null;
        const p = c ? this.bodies.get(c.idx) : undefined, last = c ? this.lastAttackId.get(c.idx) || -1 : -1;
        if (!e || p === undefined || e.st === 'DEAD' || !Number.isInteger(d.seq) || d.seq <= last
            || p.st === 'DEAD' || U.dist(p.x, p.y, e.x, e.y) > 320) return;
        this.lastAttackId.set(c.idx, d.seq);
        if (d.kind === 'strike') {
            const a = d.atk;
            if (!a || !Number.isFinite(a.damage) || !Number.isFinite(a.posture) || !Number.isFinite(a.range)
                || !Number.isFinite(a.arc) || a.damage < 0 || a.damage > 120 || a.posture < 0 || a.posture > 140
                || a.range < 0 || a.range > 280 || a.arc < 0 || a.arc > TAU
                || p.distTo(e) > a.range + e.r + 30
                || Math.abs(U.angDiff(p.facing, p.angleTo(e))) > a.arc / 2
                    + Math.asin(Math.min(1, e.r / Math.max(p.distTo(e), 1))) + 0.5) return;
            e.takeHit(p, a);
        } else if (d.kind === 'deathblow' && (e.st === 'BROKEN' || game.stealthable(e)) && p.distTo(e) < 120 + e.r) {
            game.executeDeathblow(p, e);
        } else if (d.kind === 'mikiri' && e.atk && e.atk.thrust && p.distTo(e) < e.atk.range + 80) {
            game.onMikiri(p, e);
        } else if (d.kind === 'buddha-mikiri' && p.buddhaPower() && e.atk && e.atk.perilous && e.atk.thrust
            && (e.st === 'ACTIVE' || (e.st === 'WINDUP' && e.stDur - e.stT < 0.32))
            && p.distTo(e) < e.atk.range + 80) {
            game.onBuddhaMikiri(p, e);
        } else if (d.kind === 'sweep-counter' && p.buddhaPower() && e.atk && e.atk.sweep
            && (e.st === 'ACTIVE' || (e.st === 'WINDUP' && e.stDur - e.stT < 0.32))
            && p.distTo(e) < e.atk.range + 80) {
            game.onSweepCounter(p, e);
        } else if (d.kind === 'iai' && p.distTo(e) < 310) e.takeRaw(IAI_FLASH_DAMAGE, 70, p.angleTo(e));
    }

    draw(g) {
        for (const [id, b] of this.bodies) {
            this.drawEntity(b, () => {
                b.drawAfterimage(g, this.game.time);
                b.draw(g, this.game.time);
                g.font = 'bold 13px Georgia, serif';
                this.game.text(g, 'P' + (id + 1), b.x, b.y - 35, rgb(120, 225, 220), true);
            });
        }
    }

    updateRenderPosition(entity) {
        const now = performance.now(), old = this.renderPositions.get(entity);
        if (!old) {
            this.renderPositions.set(entity, {
                x: entity.x, y: entity.y, facing: entity.facing,
                fromX: entity.x, fromY: entity.y, fromFacing: entity.facing, started: now,
            });
            return;
        }
        const t = U.clamp((now - old.started) / (COOP_SYNC_INTERVAL * 1000), 0, 1);
        const x = U.lerp(old.fromX, old.x, t), y = U.lerp(old.fromY, old.y, t);
        const facing = old.fromFacing + U.angDiff(old.fromFacing, old.facing) * t;
        old.fromX = x;
        old.fromY = y;
        old.fromFacing = facing;
        old.x = entity.x;
        old.y = entity.y;
        old.facing = entity.facing;
        old.started = now;
    }

    drawEntity(entity, draw) {
        const state = this.renderPositions.get(entity);
        if (!state) {
            draw();
            return;
        }
        const t = U.clamp((performance.now() - state.started) / (COOP_SYNC_INTERVAL * 1000), 0, 1);
        const x = entity.x, y = entity.y, facing = entity.facing;
        entity.x = U.lerp(state.fromX, state.x, t);
        entity.y = U.lerp(state.fromY, state.y, t);
        entity.facing = state.fromFacing + U.angDiff(state.fromFacing, state.facing) * t;
        try {
            draw();
        } finally {
            entity.x = x;
            entity.y = y;
            entity.facing = facing;
        }
    }

    drawStatus(g, sw) {
        const party = [...this.bodies.entries()].map(([id, b]) => 'P' + (id + 1) + ' ' + Math.ceil(Math.max(0, b.hp)));
        g.font = 'bold 14px Georgia, serif';
        this.game.text(g, 'CO-OP  |  ' + (party.length > 0 ? party.join('   ') : 'alone')
            + (this.settings.friendlyFire ? '  |  friendly fire ON' : ''), sw / 2, 25, rgb(125, 230, 215), true);
    }
}