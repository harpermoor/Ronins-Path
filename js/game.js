'use strict';

/**
 * RONIN'S PATH - a top-down open world samurai game.
 * HTML5 canvas port of the Java version. Add ?seed=123 to the URL for a fixed world.
 */
const DT = 1 / 60;

const HUD_FONT = 'bold 14px sans-serif';
const SMALL_FONT = '13px sans-serif';
const TITLE_FONT = 'bold 46px serif';
const SUB_FONT = 'italic 20px serif';
const KANJI_FAMILY = "'Yu Mincho','MS Mincho','Hiragino Mincho ProN','Noto Serif JP','Noto Serif CJK JP',serif";
const KANJI_FONT = 'bold 26px ' + KANJI_FAMILY;
const BIG_KANJI = 'bold 150px ' + KANJI_FAMILY;
// Living enemies inside this radius of a shrine prevent resting; aware enemies hunting the player block from further out.
const REST_SAFE_R = 480;
const REST_HUNT_R = 900;
class Game {
    constructor(seed, canvas, save, opts) {
        const o = opts || {};
        this.seed = seed;
        this.canvas = canvas;
        this.pauseFeedback = document.getElementById('pause-feedback');
        this.ctx = canvas.getContext('2d');
        this.sfx = new Sfx();
        this.input = new Input(canvas, () => this.sfx.unlock());
        this.fx = new Effects();
        this.rnd = new Rng(seed);
        this.world = new World(seed);
        this.enemies = [];
        this.coop = null;
        this.coopSettings = o.coopSettings || null;
        this.partySize = U.clamp(o.partySize || 1, 1, MAX_MATCH_PLAYERS);
        this.ngPlus = U.clamp(o.ngPlus || (save && Number.isInteger(save.ngPlus) ? save.ngPlus : 0), 0, NG_PLUS_MAX);
        this.difficulty = difficultyFor(this.coopSettings, this.partySize, this.ngPlus);

        this.time = 0;
        this.realTime = 0;
        this.timeScale = 1;
        this.shakeAmt = 0;
        this.zoomKickV = 0;
        this.hitstopT = 0;
        this.slowmoT = 0;
        this.flashA = 0;
        this.hpGhost = 100;
        this.flashColor = WHITE;
        this.paused = false;
        this.pauseRects = [];
        this.kills = 0;
        this.elitesSlain = 0;
        this.totalElites = 0;
        this.bannerBig = null;
        this.bannerSmall = null;
        this.bannerColor = WHITE;
        this.bannerT = 0;
        this.boss = null;
        this.bossSpawned = false;
        this.bossDefeated = false;
        this.vignette = null;
        this.redVignette = null;
        this.vigW = 0;
        this.vigH = 0;
        this.wardShrine = null;
        this.restBlockers = [];

        this.loadout = new Loadout();
        this.loadout.load();
        this.menu = new EquipMenu(this);
        this.skills = new Set();
        this.exp = 0;
        this.pointsEarned = 0;
        this.skillPoints = 0;
        this.lastExpLoss = 0;
        this.parryT = 0;
        this.parryX = 0;
        this.parryY = 0;
        this.parryK = 0;
        this.lastShrine = this.world.shrines[0];
        this.player = new Player(this, this.lastShrine.x, this.lastShrine.y + 60);
        this.camX = this.player.x;
        this.camY = this.player.y;
        this.spawnEnemies();

        this.hasSave = save !== null;
        this.autosaveT = 30;
        this.saveNote = null;
        this.saveNoteOk = true;
        this.saveNoteT = 0;
        this.newGameConfirmT = 0;
        this.resetMapConfirmT = 0;
        if (save !== null) {
            SaveGame.apply(this, save);
            this.banner('Journey Resumed', this.lastShrine.name, rgb(255, 220, 150));
        }
        const saveOnExit = () => this.saveNow(false);
        window.addEventListener('pagehide', saveOnExit);
        window.addEventListener('beforeunload', saveOnExit);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveOnExit(); });

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        window.addEventListener('resize', resize);
        resize();
    }

    spawnEnemies() {
        const world = this.world, rnd = this.rnd, mul = this.difficulty.enemyCount;
        const scale = n => Math.max(1, Math.round(n * mul));
        let s = 1, legacyIndex = 0, previousIndex = 0;
        for (const c of world.camps) {
            if (c.elite) {
                this.totalElites++;
                const elite = new Enemy(this, c.eliteType, c.x + 70, c.y, true, c.eliteName, s++);
                elite.legacyIndex = legacyIndex++;
                elite.previousIndex = previousIndex++;
                this.addEnemy(elite, c);
                // Keep old seed/slot progression so v1 and v2 saves still identify defeated enemies.
                for (let i = 0; i < scale(1); i++) {
                    this.randomGrunt(c, s++, false);
                    legacyIndex++;
                }
            } else {
                const n = scale(2 + rnd.nextInt(2)), defenders = Math.max(1, Math.ceil(n / 2));
                const brute = rnd.nextDouble() < 0.3;
                for (let i = 0; i < n; i++) {
                    const e = this.randomGrunt(c, s++, brute && i === 0);
                    e.legacyIndex = legacyIndex++;
                    e.previousIndex = previousIndex++;
                    if (i < defenders) this.addEnemy(e, c);
                }
            }
        }
        const sp = world.shrines[0];
        const maxWanderers = Math.round(30 * mul);
        let wanderers = 0;
        for (let tries = 0; tries < 2000 && wanderers < maxWanderers; tries++) {
            const x = 300 + rnd.nextDouble() * (WORLD_SIZE - 600), y = 300 + rnd.nextDouble() * (WORLD_SIZE - 600);
            if (U.dist(x, y, sp.x, sp.y) < 900 || world.nearCamp(x, y) < 300 || world.nearShrine(x, y) < 400) continue;
            const group = rnd.nextDouble() < 0.4 ? 2 : 1;
            for (let i = 0; i < group; i++) {
                const t = this.pickType();
                const e = new Enemy(this, t, x + i * 40, y + i * 30, false, null, 1000 + tries * 3 + i);
                e.legacyIndex = legacyIndex++;
                if (!world.camps.some(c => c.elite && U.dist(e.x, e.y, c.x, c.y) < 1050)) {
                    e.previousIndex = previousIndex++;
                    this.addEnemy(e, null);
                }
            }
            wanderers++;
        }
    }

    pickType() {
        const r = this.rnd.nextDouble();
        return r < 0.6 ? 'RONIN' : 'SPEAR';
    }

    /** Camp defenders are veterans: tougher, with extra moves and dodges. */
    randomGrunt(c, seed, brute) {
        const a = this.rnd.nextDouble() * TAU, d = 60 + this.rnd.nextDouble() * (c.r - 110);
        return new Enemy(this, brute ? 'BRUTE' : this.pickType(), c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, false, null, seed, true);
    }

    addEnemy(e, c) {
        this.world.resolve(e);
        e.homeX = e.x;
        e.homeY = e.y;
        e.camp = c;
        if (c !== null) c.members.push(e);
        this.enemies.push(e);
    }

    /** The finale is map-local: clearing this map's elite strongholds summons the Daimyo. */
    spawnFinalBoss(camp) {
        if (this.bossSpawned || this.bossDefeated) return null;
        const c = camp || this.world.camps.find(x => x.elite) || { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
        const e = new Enemy(this, 'RONIN', c.x, c.y, true, 'The Ashen Daimyo', 900000 + this.rnd.nextInt(99999), true, true);
        this.addEnemy(e, null);
        this.bossSpawned = true;
        this.banner('THE ASHEN DAIMYO', 'The last sword has answered your challenge', rgb(255, 110, 80));
        this.fx.ring(e.x, e.y, 30, 240, 1.2, 7, rgb(255, 80, 50));
        this.sfx.play('PERILOUS');
        return e;
    }

    // ================= loop =================
    run() {
        let last = performance.now(), acc = 0;
        const frame = now => {
            acc += (now - last) / 1000;
            last = now;
            if (acc > 0.2) acc = 0.2;
            let ticked = false;
            while (acc >= DT) {
                this.tick(DT);
                this.input.endTick();
                acc -= DT;
                ticked = true;
            }
            if (ticked) this.render();
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }

    // ================= feedback API =================
    hitstop(s) { this.hitstopT = Math.max(this.hitstopT, s); }

    shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }

    slowmo(s) { this.slowmoT = Math.max(this.slowmoT, s); }

    zoomKick(z) { this.zoomKickV = Math.max(this.zoomKickV, z); }

    /** Screen-space impact lines radiating from a deflect. */
    parryBurst(x, y, k) {
        this.parryT = 0.2;
        this.parryX = x;
        this.parryY = y;
        this.parryK = k;
    }

    gainExp(n, x, y) {
        this.exp += n;
        this.fx.text('+' + n + ' EXP', x, y - 20, rgb(140, 225, 205), 13);
        let need = expForNextPoint(this.pointsEarned);
        while (this.exp >= need) {
            this.exp -= need;
            this.pointsEarned++;
            this.skillPoints++;
            need = expForNextPoint(this.pointsEarned);
            const p = this.player;
            this.fx.text('SKILL POINT', p.x, p.y - 70, rgb(255, 225, 120), 22);
            this.fx.ring(p.x, p.y, 10, 90, 0.6, 4, rgb(255, 225, 120));
            this.sfx.play('SHRINE');
            this.note('Skill point earned  -  spend it in [Tab] > Skills', true);
        }
    }

    flash(c, a) {
        this.flashColor = c;
        this.flashA = Math.max(this.flashA, a);
    }

    banner(big, small, c) {
        this.bannerBig = big;
        this.bannerSmall = small;
        this.bannerColor = c;
        this.bannerT = 3.2;
    }

    // ================= saving =================
    saveNow(announce) {
        if (this.guestJourney) {
            this.autosaveT = 30;
            return false;
        }
        const ok = SaveGame.write(SaveGame.serialize(this));
        this.hasSave = this.hasSave || ok;
        this.autosaveT = 30;
        if (announce || !ok) this.note(ok ? 'Game saved' : 'Save failed - browser storage blocked. Use Export in the pause menu.', ok);
        return ok;
    }

    saveSoon() { this.autosaveT = Math.min(this.autosaveT, 0.5); }

    note(s, ok) {
        this.saveNote = s;
        this.saveNoteOk = ok;
        this.saveNoteT = ok ? 2.2 : 5;
    }

    activatePauseAction(action) {
        if (action === 'resume') {
            this.paused = false;
        } else if (action === 'equipment') {
            this.paused = false;
            this.menu.show();
        } else if (action === 'save' && !this.guestJourney) {
            this.saveNow(true);
        } else if (action === 'export' && !this.guestJourney) {
            SaveGame.exportFile(this);
            this.note('Save file exported: ' + SAVE_FILE_NAME, true);
        } else if (action === 'import' && !this.guestJourney) {
            SaveGame.importFile(msg => this.note(msg, false));
        } else if (action === 'main-menu') {
            this.saveNow(false);
            location.replace(location.href.split(/[?#]/)[0]);
        } else if (action === 'new-game' && !this.guestJourney && !this.coop) {
            if (this.newGameConfirmT > 0) {
                SaveGame.clear();
                this.hasSave = false;
                // stop exit handlers from re-saving the old run during reload
                this.saveNow = () => false;
                location.replace(location.pathname);
            } else {
                this.newGameConfirmT = 3;
                this.note('Select Start New Game again to ERASE your save', false);
            }
        } else if (action === 'reset' && (!this.coop || this.coop.host)) {
            if (this.resetMapConfirmT > 0) {
                this.resetMapConfirmT = 0;
                this.resetMap();
            } else {
                this.resetMapConfirmT = 3;
                this.note('Select Reset Map again to confirm (keeps gear, skills & EXP)', true);
            }
        } else if (this.coop && this.coop.host) {
            const s = this.coopSettings;
            if (action === 'friendly-fire') this.setCoopSettings({ friendlyFire: !s.friendlyFire });
            if (action === 'enemy-down') this.setCoopSettings({ enemyScale: s.enemyScale - 5 });
            if (action === 'enemy-up') this.setCoopSettings({ enemyScale: s.enemyScale + 5 });
            if (action === 'count-down') this.setCoopSettings({ countScale: s.countScale - 5 });
            if (action === 'count-up') this.setCoopSettings({ countScale: s.countScale + 5 });
        }
    }

    // ================= update =================
    zoom() { return 1.0 + this.zoomKickV; }

    tick(dt) {
        const inp = this.input, player = this.player, world = this.world, fx = this.fx;
        this.realTime += dt;
        fx.updateImpact(dt);
        this.pauseFeedback.hidden = !this.paused;
        this.saveNoteT -= dt;
        this.newGameConfirmT -= dt;
        this.resetMapConfirmT -= dt;
        if (this.paused) {
            if (inp.hit('Tab') || inp.hit('KeyI')) {
                this.activatePauseAction('equipment');
                return;
            }
            if (inp.hit('KeyS')) this.activatePauseAction('save');
            if (inp.hit('KeyX')) this.activatePauseAction('export');
            if (inp.hit('KeyL')) this.activatePauseAction('import');
            if (inp.hit('KeyQ')) {
                this.activatePauseAction('main-menu');
                return;
            }
            if (inp.hit('KeyM')) this.activatePauseAction('reset');
            if (inp.hit('KeyN')) this.activatePauseAction('new-game');
            if (this.coop && this.coop.host) {
                if (inp.hit('KeyO')) this.activatePauseAction('friendly-fire');
                if (inp.hit('BracketLeft')) this.activatePauseAction('enemy-down');
                if (inp.hit('BracketRight')) this.activatePauseAction('enemy-up');
                if (inp.hit('Semicolon')) this.activatePauseAction('count-down');
                if (inp.hit('Quote')) this.activatePauseAction('count-up');
            }
            if (inp.mouseHit(1)) {
                const hit = this.pauseRects.find(r => inp.mx >= r.x && inp.mx <= r.x + r.w && inp.my >= r.y && inp.my <= r.y + r.h);
                if (hit && !hit.disabled) {
                    this.activatePauseAction(hit.action);
                    return;
                }
            }
        }
        if (this.menu.open) {
            this.menu.tick(inp, dt);
            return;
        }
        if ((inp.hit('Tab') || inp.hit('KeyI')) && !this.paused && player.st !== 'DEAD') {
            this.menu.show();
            return;
        }
        if (inp.hit('Escape')) this.paused = !this.paused;
        if (this.paused) return;

        const sw = this.canvas.width, sh = this.canvas.height;
        const z = this.zoom();
        const wx = (inp.mx - sw / 2) / z + this.camX, wy = (inp.my - sh / 2) / z + this.camY;
        player.readInput(inp, wx, wy);
        if (inp.hit('KeyE')) this.interact();

        this.shakeAmt *= Math.exp(-dt * 9);
        this.parryT -= dt;
        this.zoomKickV *= Math.exp(-dt * 5);
        this.flashA = Math.max(0, this.flashA - dt * 2.5);
        this.bannerT -= dt;
        this.hpGhost = this.hpGhost > player.hp ? Math.max(player.hp, this.hpGhost - dt * 40) : player.hp;

        if (this.hitstopT > 0) {
            this.hitstopT -= dt;
            if (this.coop) this.coop.tick(dt);
            return;
        }
        if ((this.autosaveT -= dt) <= 0 && player.st !== 'DEAD') this.saveNow(false);
        if (this.slowmoT > 0) {
            this.slowmoT -= dt;
            this.timeScale = 0.3;
        } else this.timeScale = U.lerp(this.timeScale, 1, 1 - Math.exp(-dt * 8));
        const sdt = dt * this.timeScale;
        this.time += sdt;

        player.update(sdt);
        if (!this.coop || this.coop.host) {
            const party = this.coop ? this.coop.party : [];
            for (const e of this.enemies) {
                if (e.st === 'DEAD' || e.st === 'RETURN' || U.dist(e.x, e.y, player.x, player.y) < 1800
                    || party.some(b => U.dist(e.x, e.y, b.x, b.y) < 1800)) e.update(sdt);
            }
        }
        if (!this.coop || this.coop.host) this.separate();
        if (this.coop) this.coop.tick(dt);
        fx.update(sdt);
        const vw = sw / z, vh = sh / z;
        fx.ambient(this.camX, this.camY, vw, vh, sdt, Math.sin(this.time * 0.2) * 20);
        for (const f of world.fires) {
            if (Math.abs(f.x - player.x) < 900 && Math.abs(f.y - player.y) < 700 && this.rnd.nextDouble() < sdt * 14) fx.ember(f.x, f.y);
        }
        for (const s of world.shrines) {
            if (!s.discovered && U.dist(s.x, s.y, player.x, player.y) < 380) {
                s.discovered = true;
                this.banner('Shrine Discovered', s.name, rgb(255, 215, 120));
                this.sfx.play('SHRINE');
            }
        }
        this.wardShrine = null;
        for (const s of world.shrines) {
            if (U.dist(s.x, s.y, player.x, player.y) < REST_SAFE_R + 160) {
                this.wardShrine = s;
                break;
            }
        }
        this.restBlockers = this.wardShrine !== null ? this.findRestBlockers(this.wardShrine) : [];
        const boss = this.boss;
        if (boss !== null && (boss.st === 'DEAD' || boss.st === 'RETURN' || boss.st === 'IDLE' || boss.distTo(player) > 1300)) this.boss = null;

        const tx = player.x + (wx - player.x) * 0.18, ty = player.y + (wy - player.y) * 0.18;
        const k = 1 - Math.exp(-dt * 6);
        this.camX += (tx - this.camX) * k;
        this.camY += (ty - this.camY) * k;
        this.camX = U.clamp(this.camX, vw / 2, WORLD_SIZE - vw / 2);
        this.camY = U.clamp(this.camY, vh / 2, WORLD_SIZE - vh / 2);
    }

    interact() {
        const player = this.player;
        if (player.st === 'DEAD') {
            if (player.deadT > 1.2) this.respawn();
            return;
        }
        const s = this.nearShrine();
        if (s !== null && player.st === 'FREE') {
            const blockers = this.findRestBlockers(s);
            if (blockers.length > 0) {
                this.sfx.play('BLOCK');
                this.fx.text('Cannot rest  -  enemies nearby', player.x, player.y - 46, rgb(255, 90, 70), 16);
                this.fx.ring(s.x, s.y, 20, REST_SAFE_R, 0.6, 3, rgb(255, 70, 50));
                for (const e of blockers) this.fx.text('!', e.x, e.y - 36, rgb(255, 80, 60), 22);
                return;
            }
            this.lastShrine = s;
            s.discovered = true;
            player.hp = player.maxHp;
            player.gourds = player.maxGourds;
            player.throws = player.maxThrows;
            player.posture = 0;
            player.lastStandUsed = false;
            this.sfx.play('SHRINE');
            this.fx.ring(s.x, s.y, 20, 160, 1.0, 4, rgb(255, 220, 140));
            this.fx.heal(player.x, player.y);
            this.banner('Rested', s.name + '  -  HP, gourds & throws restored', rgb(255, 220, 140));
            this.saveNow(true);
        }
    }

    findRestBlockers(s) {
        const p = this.player, out = [];
        for (const e of this.enemies) {
            if (e.st === 'DEAD') continue;
            const near = U.dist(e.x, e.y, s.x, s.y) < REST_SAFE_R;
            const hunting = e.aware && e.st !== 'RETURN' && e.distTo(p) < REST_HUNT_R;
            if (near || hunting) out.push(e);
        }
        return out;
    }

    nearShrine() {
        for (const s of this.world.shrines) if (U.dist(s.x, s.y + 20, this.player.x, this.player.y) < 110) return s;
        return null;
    }

    respawn() {
        const player = this.player;
        player.respawn(this.lastShrine.x, this.lastShrine.y + 60);
        if (!this.coop) for (const e of this.enemies) if (e.aware || e.elite) e.resetToHome();
        this.boss = null;
        this.camX = player.x;
        this.camY = player.y;
        this.banner('Resurrection', this.lastShrine.name, rgb(230, 200, 200));
        this.saveSoon();
    }

    /** Regenerates the world layout. Keeps gear, skills, EXP and elites slain. Resetting the map after the Ashen
     * Daimyo has fallen advances the journey one New Game + tier, up to +7, which permanently toughens enemies. */
    setCoopSettings(changes) {
        if (!this.coop || !this.coop.host) return;
        this.applyCoopSettings(Object.assign({}, this.coopSettings, changes));
        this.coop.link.send({ t: 'coop-settings', s: this.coopSettings });
        this.note('Co-op settings updated  -  enemy numbers apply on the next map reset', true);
    }

    applyCoopSettings(settings) {
        if (!this.coop) return;
        const previous = this.difficulty;
        this.coopSettings = sanitizeCoopSettings(settings);
        this.coop.settings = this.coopSettings;
        this.difficulty = difficultyFor(this.coopSettings, this.partySize, this.ngPlus);
        const hpRatio = this.difficulty.enemyHp / previous.enemyHp;
        const postureRatio = this.difficulty.enemyPosture / previous.enemyPosture;
        for (const e of this.enemies) {
            e.maxHp *= hpRatio;
            e.hp = Math.min(e.maxHp, e.hp * hpRatio);
            e.maxPosture *= postureRatio;
            e.posture = Math.min(e.maxPosture, e.posture * postureRatio);
            e.dmgScale = ENEMY_DAMAGE_SCALE * (e.elite ? 1 : NORMAL_ENEMY_DAMAGE_SCALE) * this.difficulty.enemyDmg;
        }
    }

    resetMap(seedOverride, ngOverride, remote) {
        const player = this.player, newSeed = Number.isFinite(seedOverride) ? seedOverride : Math.floor(Math.random() * 2 ** 48);
        const ascend = ngOverride === undefined && this.bossDefeated && this.ngPlus < NG_PLUS_MAX;
        if (Number.isInteger(ngOverride)) this.ngPlus = U.clamp(ngOverride, 0, NG_PLUS_MAX);
        else if (ascend) this.ngPlus++;
        this.difficulty = difficultyFor(this.coopSettings, this.partySize, this.ngPlus);
        this.seed = newSeed;
        this.rnd = new Rng(newSeed);
        this.world = new World(newSeed);
        this.enemies = [];
        this.boss = null;
        this.bossSpawned = false;
        this.bossDefeated = false;
        this.wardShrine = null;
        this.restBlockers = [];
        this.totalElites = 0;
        this.spawnEnemies();
        this.lastShrine = this.world.shrines[0];
        player.respawn(this.lastShrine.x, this.lastShrine.y + 60);
        this.world.resolve(player);
        this.camX = player.x;
        this.camY = player.y;
        this.paused = false;
        if (this.ngPlus > 0) {
            this.banner('NEW GAME +' + this.ngPlus, ascend ? 'A harsher land awaits  -  your strength remains'
                : 'The land is reborn at the same trial', rgb(255, 150, 110));
        } else this.banner('New Horizons', 'The land is reborn  -  your strength remains', rgb(160, 220, 255));
        this.sfx.play('SHRINE');
        if (this.coop && this.coop.host && !remote) {
            this.coop.link.send({ t: 'coop-reset', seed: this.seed, ngPlus: this.ngPlus, settings: this.coopSettings });
        }
        if (!remote) this.saveNow(true);
    }

    separate() {
        const p = this.player, world = this.world, enemies = this.enemies;
        const passThrough = p.st === 'IAI' || p.st === 'DEATHBLOW' || p.st === 'DODGE';
        for (let i = 0; i < enemies.length; i++) {
            const a = enemies[i];
            if (a.st === 'DEAD' || Math.abs(a.x - p.x) > 1200 || Math.abs(a.y - p.y) > 1200) continue;
            for (let j = i + 1; j < enemies.length; j++) {
                const b = enemies[j];
                if (b.st === 'DEAD') continue;
                const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r + 2;
                if (d < min && d > 0.01) {
                    const push = (min - d) / 2;
                    a.x -= dx / d * push;
                    a.y -= dy / d * push;
                    b.x += dx / d * push;
                    b.y += dy / d * push;
                    world.resolve(a);
                    world.resolve(b);
                }
            }
            if (!passThrough) {
                const dx = a.x - p.x, dy = a.y - p.y, d = Math.hypot(dx, dy), min = a.r + p.r;
                if (d < min && d > 0.01) {
                    const push = min - d;
                    a.x += dx / d * push * 0.7;
                    a.y += dy / d * push * 0.7;
                    p.x -= dx / d * push * 0.3;
                    p.y -= dy / d * push * 0.3;
                    world.resolve(a);
                    world.resolve(p);
                }
            }
        }
    }

    // ================= combat API =================
    enemyGroup(e) {
        const p = e.target || this.player;
        return this.enemies.filter(o => !o.elite && o.aware && o.st !== 'DEAD'
            && o.distTo(p) < 700 && o.distTo(e) < 650);
    }

    enemyPressured(e) {
        if (e.pressureT > 0) return true;
        const p = e.target || this.player, d = e.distTo(p);
        if (d > 190 + e.r || p.st === 'DEAD' || p.untargetable()) return false;
        return Math.abs(U.angDiff(p.facing, p.angleTo(e))) < 0.9
            && (p.st === 'ATTACK' || p.st === 'ART' || p.st === 'THROW');
    }

    enemyShouldHangBack(e) {
        if (e.elite || e.hasToken || this.enemyPressured(e)) return false;
        const group = this.enemyGroup(e);
        return group.length === 2 && group.some(o => o !== e && o.hasToken);
    }

    requestToken(e) {
        if (e.elite) return true;
        const group = this.enemyGroup(e);
        const attackers = group.filter(o => o !== e && o.hasToken);
        if (group.length === 2 && attackers.length > 0) return this.enemyPressured(e);
        return attackers.length < 2;
    }

    engageBoss(e) {
        this.boss = e;
        this.banner(e.name, 'An elite warrior blocks your path', rgb(200, 140, 255));
    }

    stealthable(e) { return !e.aware && e.st === 'IDLE'; }

    deathblowTarget() {
        let best = null, bd = Infinity;
        for (const e of this.enemies) {
            if (e.st === 'DEAD' || e.beingExecuted) continue;
            const broken = e.st === 'BROKEN';
            if (!broken && !this.stealthable(e)) continue;
            const d = e.distTo(this.player);
            if (d < (broken ? 105 : 75) + e.r && d < bd) {
                bd = d;
                best = e;
            }
        }
        return best;
    }

    enemyInFront(p, ang, dist) {
        for (const e of this.enemies) {
            if (e.st === 'DEAD') continue;
            const d = p.distTo(e);
            if (d < dist + e.r && Math.abs(U.angDiff(ang, p.angleTo(e))) < 0.9) return true;
        }
        return false;
    }

    playerHitCheck(p, atk) {
        for (const e of this.enemies) {
            if (e.st === 'DEAD' || p.hitSet.has(e)) continue;
            const d = p.distTo(e);
            if (d > atk.range + e.r) continue;
            const tol = atk.arc / 2 + Math.asin(Math.min(1, e.r / Math.max(d, 1)));
            if (Math.abs(U.angDiff(p.facing, p.angleTo(e))) <= tol) {
                p.hitSet.add(e);
                if (this.coop && !this.coop.host) this.coop.strike(e, atk);
                else e.takeHit(p, atk);
            }
        }
        if (this.coop !== null && this.coop.settings.friendlyFire) this.coop.friendlyHitCheck(p, atk);
    }

    projectileHitCheck(p, atk) {
        const foes = this.coop && this.coop.settings.friendlyFire ? this.enemies.concat(this.coop.party) : this.enemies;
        const { target, range } = projectileTarget(p, atk, foes, this.world);
        if (target !== null) {
            if (target instanceof Player) this.coop.friendlyStrike(p, target, atk);
            else if (this.coop && !this.coop.host) this.coop.strike(target, atk);
            else target.takeHit(p, atk);
        }
        return range;
    }

    mikiriCandidate(p, dx, dy) {
        for (const e of this.enemies) {
            if (e.atk === null || !e.atk.perilous || !e.atk.thrust) continue;
            const timing = (e.st === 'WINDUP' && e.stDur - e.stT < 0.32) || e.st === 'ACTIVE';
            if (!timing) continue;
            const d = p.distTo(e);
            if (d > e.atk.range + 80) continue;
            const a = p.angleTo(e);
            if (dx * Math.cos(a) + dy * Math.sin(a) > 0.5) return e;
        }
        if (this.coop !== null && this.coop.settings.friendlyFire) {
            for (const e of this.coop.party) {
                if (e.st !== 'ATTACK' || !e.cur || !e.cur.perilous || !e.cur.thrust) continue;
                const timing = (e.phase === 0 && e.cur.windup - e.stT < 0.32) || e.phase === 1;
                if (!timing || p.distTo(e) > e.cur.range + 80) continue;
                const a = p.angleTo(e);
                if (dx * Math.cos(a) + dy * Math.sin(a) > 0.5) return e;
            }
        }
        return null;
    }

    onMikiri(p, e) {
        this.fx.impact((p.x + e.x) / 2, (p.y + e.y) / 2, 'mikiri');
        if (this.coop && this.coop.settings.friendlyFire && this.coop.party.includes(e)) {
            this.coop.playerMikiri(p, e);
            return;
        }
        if (this.coop && !this.coop.host) {
            this.coop.action('mikiri', e);
            p.ki = Math.min(100, p.ki + 25);
            p.gainArtCharge();
            return;
        }
        const fx = this.fx;
        const a = p.angleTo(e);
        const cx = (p.x + e.x) / 2, cy = (p.y + e.y) / 2;
        e.posture += e.maxPosture * 0.5;
        e.lastDamageT = this.time;
        e.showBars = 3;
        e.perilousT = 0;
        e.releaseToken();
        e.setSt('STUN');
        e.stDur = 1.1;
        e.kbx = Math.cos(a) * 260;
        e.kby = Math.sin(a) * 260;
        p.ki = Math.min(100, p.ki + 25);
        p.gainArtCharge();
        fx.sparks(cx, cy, a + Math.PI, 3.0, 40, 600, rgb(140, 220, 255));
        fx.ring(cx, cy, 5, 90, 0.4, 5, rgb(180, 230, 255));
        fx.dust(p.x, p.y, 12);
        fx.text('MIKIRI COUNTER', p.x, p.y - 48, rgb(140, 220, 255), 20);
        this.sfx.play('CLANG');
        this.sfx.play('BLOCK');
        this.hitstop(0.12);
        this.shake(11);
        this.slowmo(0.35);
        this.flash(rgb(180, 230, 255), 0.2);
        if (e.posture >= e.maxPosture) e.breakPosture();
    }

    onPostureBreak(e) {
        this.sfx.play('BREAK');
        this.hitstop(0.1);
        this.slowmo(0.3);
        this.shake(8);
        this.fx.ring(e.x, e.y, 10, 100, 0.5, 5, rgb(255, 60, 40));
        this.fx.sparks(e.x, e.y, 0, TAU, 24, 380, rgb(255, 120, 60));
        this.fx.text('POSTURE BROKEN', e.x, e.y - 44, rgb(255, 90, 60), 16);
    }

    executeDeathblow(p, e) {
        if (this.coop && !this.coop.host) {
            this.coop.action('deathblow', e);
            p.ki = Math.min(100, p.ki + 20);
            e.beingExecuted = false;
            return;
        }
        const fx = this.fx;
        const a = p.angleTo(e);
        const stealth = !e.aware;
        e.beingExecuted = false;
        fx.blood(e.x, e.y, a, 45, 480);
        fx.sparks(e.x, e.y, a, 1.0, 20, 650, WHITE);
        fx.line(e.x - Math.cos(a + 0.8) * 70, e.y - Math.sin(a + 0.8) * 70, e.x + Math.cos(a + 0.8) * 70, e.y + Math.sin(a + 0.8) * 70, 0.5, 5,
            rgb(255, 80, 80));
        fx.line(e.x - Math.cos(a - 0.8) * 60, e.y - Math.sin(a - 0.8) * 60, e.x + Math.cos(a - 0.8) * 60, e.y + Math.sin(a - 0.8) * 60, 0.6, 4,
            rgb(255, 220, 220));
        fx.ring(e.x, e.y, 10, 130, 0.6, 6, rgb(255, 50, 40));
        this.sfx.play('DEATHBLOW');
        this.hitstop(0.16);
        this.shake(14);
        this.slowmo(0.45);
        this.zoomKick(0.12);
        this.flash(rgb(255, 200, 200), 0.3);
        p.ki = Math.min(100, p.ki + 20);
        fx.text(stealth ? 'STEALTH DEATHBLOW' : 'DEATHBLOW', e.x, e.y - 50, rgb(255, 70, 60), 22);
        if (p.deathblowHeal > 0) {
            p.hp = Math.min(p.maxHp, p.hp + p.maxHp * p.deathblowHeal);
            fx.heal(p.x, p.y);
        }
        if (e.elite && e.lives > 1) {
            e.lives--;
            e.hp = e.maxHp;
            e.posture = 0;
            if (!e.aware) e.alert(true);
            e.setSt('STUN');
            e.stDur = 1.4;
            fx.text(e.lives + ' life remains', e.x, e.y - 26, rgb(220, 180, 255), 14);
        } else {
            e.die(a);
        }
    }

    resolveIai(p, victims) {
        if (this.coop && !this.coop.host) {
            for (const e of victims) this.coop.action('iai', e);
            return;
        }
        this.sfx.play('DEATHBLOW');
        this.flash(rgb(200, 230, 255), 0.25);
        if (victims.length === 0) return;
        this.hitstop(0.12);
        this.shake(12);
        for (const e of victims) {
            if (e.st === 'DEAD') continue;
            const a = this.rnd.nextDouble() * Math.PI;
            this.fx.line(e.x - Math.cos(a) * 55, e.y - Math.sin(a) * 55, e.x + Math.cos(a) * 55, e.y + Math.sin(a) * 55, 0.6, 4,
                rgb(170, 210, 255));
            this.fx.sparks(e.x, e.y, a, 1.0, 14, 500, rgb(170, 210, 255));
            e.beingExecuted = false;
            e.takeRaw(45 * PLAYER_DAMAGE_SCALE, 70, a);
        }
    }

    onEnemyKilled(e) {
        const player = this.player;
        this.kills++;
        player.ki = Math.min(100, player.ki + 10);
        this.gainExp(expForKill(e), e.x, e.y);
        if (e.boss) {
            this.bossDefeated = true;
            this.boss = null;
            Object.assign(player, playerProgression(this.elitesSlain, this.bossDefeated));
            player.applyLoadout();
            player.hp = player.maxHp;
            player.gourds = player.maxGourds;
            this.banner('THE LAND IS AT PEACE', 'The Ashen Daimyo has fallen. You are the last sword standing.', rgb(255, 215, 120));
            this.saveSoon();
        } else if (e.elite) {
            this.elitesSlain++;
            Object.assign(player, playerProgression(this.elitesSlain, this.bossDefeated));
            this.saveSoon();
            player.applyLoadout();
            player.hp = player.maxHp;
            player.gourds = player.maxGourds;
            if (this.boss === e) this.boss = null;
            const unlocked = EQUIP_SLOTS.some(s => s.list.some(it => it.unlock === this.elitesSlain));
            // "elitesSlain" is lifetime data, so the finale depends on the actual current map.
            const allElitesDeadHere = this.enemies.filter(x => x.elite && !x.boss).every(x => x.st === 'DEAD');
            if (allElitesDeadHere) {
                this.spawnFinalBoss(e.camp);
            } else this.banner('ELITE SLAIN', e.name + '  -  Vitality up, +1 Healing Gourd' + (unlocked ? '  -  New gear unlocked [Tab]' : ''),
                rgb(255, 90, 70));
        }
        const c = e.camp;
        if (c !== null && !c.cleared) {
            if (c.members.every(m => m.st === 'DEAD')) {
                c.cleared = true;
                this.saveSoon();
                if (!e.elite) this.banner('Camp Cleared', 'The bandits here will trouble no one again', rgb(230, 230, 200));
                if (player.gourds < player.maxGourds) {
                    player.gourds++;
                    this.fx.text('+1 Gourd', player.x, player.y - 50, rgb(255, 180, 90), 15);
                }
            }
        }
    }

    onPlayerDeath() {
        this.sfx.play('BREAK');
        this.slowmo(1.0);
        this.shake(12);
        this.boss = null;
        // as in Sekiro, death costs half of the EXP not yet turned into a skill point
        this.lastExpLoss = Math.floor(this.exp / 2);
        this.exp -= this.lastExpLoss;
        for (const e of this.enemies) e.releaseToken();
    }

    // ================= render =================
    render() {
        const g = this.ctx, sw = this.canvas.width, sh = this.canvas.height, world = this.world, player = this.player;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = '#000';
        g.fillRect(0, 0, sw, sh);
        const z = this.zoom();
        const shx = (this.rnd.nextDouble() - 0.5) * 2 * this.shakeAmt, shy = (this.rnd.nextDouble() - 0.5) * 2 * this.shakeAmt;
        g.save();
        g.translate(sw / 2, sh / 2);
        g.scale(z, z);
        g.translate(-this.camX + shx, -this.camY + shy);
        const l = this.camX - sw / 2 / z - 20, t = this.camY - sh / 2 / z - 20, r = this.camX + sw / 2 / z + 20, b = this.camY + sh / 2 / z + 20;

        world.drawGround(g, l, t, r, b);
        const vis = world.visible(l, t, r, b);
        world.drawPonds(g, vis, this.time);
        this.fx.drawDecals(g);
        this.drawShrineWard(g);
        world.drawObstacles(g, vis, this.time);
        const visEnemies = this.enemies.filter(e => e.x > l - 100 && e.x < r + 100 && e.y > t - 100 && e.y < b + 100);
        for (const e of visEnemies) if (e.st === 'DEAD') {
            const draw = () => e.draw(g, this.time);
            if (this.coop !== null) this.coop.drawEntity(e, draw);
            else draw();
        }
        for (const e of visEnemies) if (e.st !== 'DEAD') {
            const draw = () => e.draw(g, this.time);
            if (this.coop !== null) this.coop.drawEntity(e, draw);
            else draw();
        }
        if (this.coop !== null) this.coop.draw(g);
        player.draw(g, this.time);
        this.fx.drawWorld(g);
        world.drawCanopies(g, vis, player.x, player.y, this.time);
        this.fx.drawPetals(g);
        const db = this.deathblowTarget();
        for (const e of visEnemies) {
            const draw = () => e.drawOverlay(g, this.time, KANJI_FONT, e === db && this.stealthable(e));
            if (this.coop !== null) this.coop.drawEntity(e, draw);
            else draw();
        }
        this.fx.drawTexts(g);
        player.drawLock(g, this.realTime);
        g.restore();

        this.drawParryBurst(g, sw, sh, z);
        this.drawVignette(g, sw, sh);
        if (this.flashA > 0) {
            g.fillStyle = css(U.alpha(this.flashColor, this.flashA * 0.6));
            g.fillRect(0, 0, sw, sh);
        }
        this.drawHud(g, sw, sh, db);
        if (this.coop) this.coop.drawStatus(g, sw);
        if (this.menu.open) this.menu.draw(g, sw, sh);
        this.fx.drawImpact(g, sw, sh, this.camX, this.camY, z);
    }

    /** Ground ring around the nearby shrine: gold when it is safe to rest, red with enemy markers when not. */
    drawShrineWard(g) {
        const s = this.wardShrine;
        if (s === null) return;
        const p = this.player, blockers = this.restBlockers, safe = blockers.length === 0;
        const fade = U.clamp((REST_SAFE_R + 160 - U.dist(s.x, s.y, p.x, p.y)) / 160, 0, 1);
        const pulse = 0.5 + 0.5 * Math.sin(this.realTime * (safe ? 2.5 : 6));
        const c = safe ? rgb(255, 215, 120) : rgb(255, 60, 45);
        const glow = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, 150);
        glow.addColorStop(0, css(U.alpha(c, (0.28 + 0.12 * pulse) * fade)));
        glow.addColorStop(1, css(U.alpha(c, 0)));
        g.fillStyle = glow;
        fillCircle(g, s.x, s.y, 150);
        g.setLineDash([22, 16]);
        g.lineDashOffset = -this.realTime * (safe ? 12 : 40);
        setStroke(g, 3, false);
        g.strokeStyle = css(U.alpha(c, (0.22 + 0.25 * pulse) * fade));
        g.beginPath();
        g.arc(s.x, s.y, REST_SAFE_R, 0, TAU);
        g.stroke();
        g.setLineDash([]);
        if (safe) return;
        setStroke(g, 2.5, false);
        g.strokeStyle = css(U.alpha(c, 0.5 + 0.4 * pulse));
        for (const e of blockers) {
            g.beginPath();
            g.arc(e.x, e.y, e.r + 9 + pulse * 3, 0, TAU);
            g.stroke();
        }
    }

    drawParryBurst(g, sw, sh, z) {
        if (this.parryT <= 0) return;
        const f = this.parryT / 0.2, k = this.parryK;
        const sx = (this.parryX - this.camX) * z + sw / 2, sy = (this.parryY - this.camY) * z + sh / 2;
        const n = 18 + k * 3, reach = (1 - f) * (260 + k * 50);
        setStroke(g, 2 + k * 0.4, true);
        g.strokeStyle = css(rgb(255, 245, 215, Math.trunc(220 * f)));
        g.beginPath();
        for (let i = 0; i < n; i++) {
            const a = i / n * TAU + (i % 2) * 0.08;
            const r0 = 40 + reach * (i % 3 === 0 ? 0.6 : 0.9), r1 = r0 + 30 + reach * 0.5;
            g.moveTo(sx + Math.cos(a) * r0, sy + Math.sin(a) * r0);
            g.lineTo(sx + Math.cos(a) * r1, sy + Math.sin(a) * r1);
        }
        g.stroke();
        const glow = g.createRadialGradient(sx, sy, 0, sx, sy, 90 + k * 12);
        glow.addColorStop(0, css(rgb(255, 250, 225, Math.trunc(200 * f))));
        glow.addColorStop(1, 'rgba(255,220,140,0)');
        g.fillStyle = glow;
        fillCircle(g, sx, sy, 90 + k * 12);
    }

    drawVignette(g, sw, sh) {
        if (this.vignette === null || this.vigW !== sw || this.vigH !== sh) {
            this.vigW = sw;
            this.vigH = sh;
            this.vignette = this.makeVignette(sw, sh, rgb(0, 0, 0, 170));
            this.redVignette = this.makeVignette(sw, sh, rgb(160, 0, 0, 200));
        }
        g.drawImage(this.vignette, 0, 0);
        const p = this.player;
        const hpFrac = p.hp / p.maxHp;
        if (hpFrac < 0.35 && p.st !== 'DEAD') {
            g.globalAlpha = U.clamp((0.35 - hpFrac) / 0.35 * (0.7 + 0.3 * Math.sin(this.realTime * 6)), 0, 1);
            g.drawImage(this.redVignette, 0, 0);
            g.globalAlpha = 1;
        }
    }

    makeVignette(w, h, edge) {
        const img = makeCanvas(w, h);
        const g = img.getContext('2d');
        const rad = Math.max(w, h) * 0.75;
        const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, rad);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(0.5, 'rgba(0,0,0,0)');
        grad.addColorStop(1, css(edge));
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
        return img;
    }

    text(g, s, x, y, c, center) {
        g.textAlign = center ? 'center' : 'left';
        g.fillStyle = 'rgba(0,0,0,0.706)';
        g.fillText(s, x + 2, y + 2);
        g.fillStyle = css(c);
        g.fillText(s, x, y);
        g.textAlign = 'left';
    }

    drawHud(g, sw, sh, db) {
        const p = this.player, world = this.world;
        // --- vitality ---
        const hx = 28, hy = sh - 86;
        const hpW = Math.min(460, p.maxHp * 2.6);
        g.fillStyle = 'rgba(0,0,0,0.667)';
        g.fillRect(hx - 2, hy - 2, Math.trunc(hpW) + 4, 16);
        g.fillStyle = 'rgb(230,220,200)';
        g.fillRect(hx, hy, Math.trunc(hpW * U.clamp(this.hpGhost / p.maxHp, 0, 1)), 12);
        g.fillStyle = 'rgb(190,30,34)';
        g.fillRect(hx, hy, Math.trunc(hpW * U.clamp(p.hp / p.maxHp, 0, 1)), 12);
        g.font = HUD_FONT;
        this.text(g, Math.trunc(Math.max(0, p.hp)) + ' / ' + Math.trunc(p.maxHp), hx + 6, hy - 6, rgb(240, 230, 220), false);
        // --- ki ---
        const ky = hy + 20;
        g.fillStyle = 'rgba(0,0,0,0.667)';
        g.fillRect(hx - 2, ky - 2, 204, 10);
        const full = p.ki >= 100;
        g.fillStyle = full ? css(rgb(150, 210, 255, Math.trunc(180 + 75 * Math.sin(this.realTime * 8)))) : 'rgb(70,120,210)';
        g.fillRect(hx, ky, Math.trunc(200 * p.ki / 100), 6);
        g.font = SMALL_FONT;
        if (full) {
            this.text(g, '[F] IAI FLASH READY', hx + 212, ky + 8, rgb(170, 220, 255), false);
            if (p.dragonFlash) this.text(g, '[G] DRAGON FLASH', hx + 212, ky + 25, rgb(180, 235, 255), false);
        }
        // --- gourds ---
        for (let i = 0; i < p.maxGourds; i++) {
            const gx = hx + i * 24, gy = ky + 16;
            const have = i < p.gourds;
            g.fillStyle = have ? 'rgb(220,130,50)' : 'rgb(70,70,70)';
            fillEllipse(g, gx, gy + 6, 16, 16);
            fillEllipse(g, gx + 3, gy, 10, 10);
            g.fillStyle = have ? 'rgb(120,60,30)' : 'rgb(40,40,40)';
            g.fillRect(gx + 6, gy - 3, 4, 4);
        }
        g.font = SMALL_FONT;
        this.text(g, '[Q] heal', hx + p.maxGourds * 24 + 6, ky + 32, rgb(220, 200, 170), false);
        this.text(g, '[T] ' + p.throwable.name + ' ' + p.throws + '/' + p.maxThrows,
            hx, ky + 54, p.throws ? p.throwable.color : rgb(150, 140, 130), false);

        // --- combat art charges (earned by deflecting) ---
        const ay = hy - 28, art = p.art, canArt = p.artCharges >= art.cost;
        const pulse = canArt ? 0.75 + 0.25 * Math.sin(this.realTime * 6) : 1;
        for (let i = 0; i < p.maxArtCharges; i++) {
            const cx = hx + 6 + i * 16;
            g.beginPath();
            g.moveTo(cx, ay - 13);
            g.lineTo(cx + 6, ay - 6);
            g.lineTo(cx, ay + 1);
            g.lineTo(cx - 6, ay - 6);
            g.closePath();
            g.fillStyle = i < p.artCharges ? css(U.alpha(canArt ? art.color : rgb(255, 215, 110), pulse)) : 'rgba(40,36,34,0.8)';
            g.fill();
            setStroke(g, 1, false);
            g.strokeStyle = i < art.cost ? 'rgb(255,225,160)' : 'rgb(110,100,90)';
            g.stroke();
        }
        const tx = hx + p.maxArtCharges * 16 + 8;
        g.font = 'bold 15px ' + KANJI_FAMILY;
        this.text(g, art.kanji, tx, ay, canArt ? art.color : rgb(110, 110, 110), false);
        const kw = g.measureText(art.kanji).width;
        g.font = 'bold 15px serif';
        const label = canArt ? art.name + '  READY' : art.name + '  ' + p.artCharges + '/' + art.cost;
        this.text(g, label, tx + 8 + kw, ay, canArt ? rgb(255, 235, 190) : rgb(150, 140, 130), false);
        const lw = g.measureText(label).width;
        g.font = SMALL_FONT;
        this.text(g, canArt ? '[Block + Attack] or [R]' : 'Deflect to charge', tx + 20 + kw + lw, ay, rgb(180, 170, 150), false);

        // --- player posture (center) ---
        if (p.posture > 0.5) Draw.postureBar(g, sw / 2, sh - 44, 380, 9, p.posture / p.maxPosture, false);

        // --- prompts ---
        let prompt = null, promptColor = rgb(255, 220, 150);
        if (p.st !== 'DEAD') {
            const ns = this.nearShrine();
            if (db !== null) {
                prompt = this.stealthable(db) ? '[LMB]  STEALTH DEATHBLOW' : '[LMB]  DEATHBLOW';
                promptColor = rgb(255, 90, 80);
            } else if (ns !== null) {
                const n = this.restBlockers.length;
                if (n === 0) prompt = '[E]  Rest at ' + ns.name;
                else {
                    prompt = 'Cannot rest  -  ' + n + (n === 1 ? ' enemy' : ' enemies') + ' nearby';
                    promptColor = rgb(255, 90, 70);
                }
            }
        }
        if (prompt !== null) {
            g.font = 'bold 20px serif';
            this.text(g, prompt, sw / 2, sh - 70, promptColor, true);
        }

        // --- top-left info ---
        const cleared = world.camps.filter(c => c.cleared).length;
        g.font = 'bold 22px serif';
        this.text(g, world.biomeName(p.x, p.y) + (this.ngPlus > 0 ? '   -   NG+' + this.ngPlus : ''), 24, 36, rgb(245, 235, 215), false);
        g.font = SMALL_FONT;
        this.text(g, 'Elites slain ' + this.elitesSlain + '/' + this.totalElites + '     Camps cleared ' + cleared + '/' + world.camps.length
            + '     Kills ' + this.kills, 24, 58, rgb(220, 210, 190), false);
        this.text(g, '[Tab] equipment & skills   [Esc] pause & controls', 24, 78, rgb(180, 170, 150), false);
        const need = expForNextPoint(this.pointsEarned);
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fillRect(24, 88, 204, 7);
        g.fillStyle = 'rgb(120,210,190)';
        g.fillRect(26, 90, Math.trunc(200 * U.clamp(this.exp / need, 0, 1)), 3);
        this.text(g, 'EXP ' + Math.floor(this.exp) + '/' + need, 24, 112, rgb(160, 220, 205), false);
        if (this.skillPoints > 0) {
            g.font = 'bold 13px sans-serif';
            this.text(g, this.skillPoints + ' skill point' + (this.skillPoints > 1 ? 's' : '') + ' [Tab]', 130, 112,
                rgb(255, 220, 120, Math.trunc(170 + 85 * Math.sin(this.realTime * 4))), false);
        }
        if (p.deflectStreak >= 2) {
            g.font = 'bold 26px serif';
            this.text(g, p.deflectStreak + ' DEFLECT CHAIN', sw / 2, sh - 100, rgb(255, 215, 100), true);
        }

        this.drawBoss(g, sw);
        this.drawMinimap(g, sw, sh);
        // --- banner ---
        if (this.bannerT > 0 && this.bannerBig !== null) {
            const a = U.clamp(Math.min(this.bannerT, 3.2 - this.bannerT) * 2.5, 0, 1);
            g.fillStyle = css(rgb(0, 0, 0, Math.trunc(120 * a)));
            g.fillRect(0, sh / 2 - 150, sw, 90);
            g.font = TITLE_FONT;
            this.text(g, this.bannerBig, sw / 2, sh / 2 - 95, U.alpha(this.bannerColor, a), true);
            if (this.bannerSmall !== null) {
                g.font = SUB_FONT;
                this.text(g, this.bannerSmall, sw / 2, sh / 2 - 68, U.alpha(rgb(235, 225, 210), a), true);
            }
        }

        // --- death ---
        if (p.st === 'DEAD') {
            const a = U.clamp(p.deadT / 1.2, 0, 1);
            g.fillStyle = css(rgb(20, 0, 0, Math.trunc(170 * a)));
            g.fillRect(0, 0, sw, sh);
            g.font = BIG_KANJI;
            this.text(g, '\u6b7b', sw / 2, sh / 2 + 30, U.alpha(rgb(200, 20, 20), a), true);
            g.font = TITLE_FONT;
            this.text(g, 'DEATH', sw / 2, sh / 2 + 100, U.alpha(rgb(220, 200, 200), a), true);
            if (p.deadT > 1.2) {
                g.font = SUB_FONT;
                this.text(g, 'Press E to resurrect at ' + this.lastShrine.name, sw / 2, sh / 2 + 140, rgb(230, 220, 210), true);
                if (this.lastExpLoss > 0) {
                    g.font = HUD_FONT;
                    this.text(g, 'Lost ' + this.lastExpLoss + ' EXP', sw / 2, sh / 2 + 168, rgb(200, 140, 140), true);
                }
            }
        }

        if (this.paused) this.drawPauseMenu(g, sw, sh);
        if (this.saveNoteT > 0 && this.saveNote !== null) {
            g.font = HUD_FONT;
            const a = U.clamp(this.saveNoteT * 2, 0, 1);
            this.text(g, this.saveNote, sw / 2, 112, U.alpha(this.saveNoteOk ? rgb(200, 235, 190) : rgb(255, 110, 90), a), true);
        }
    }

    pauseButton(g, action, title, copy, x, y, w, h, opts) {
        const o = opts || {}, disabled = !!o.disabled;
        this.pauseRects.push({ action, x, y, w, h, disabled });
        roundRectPath(g, x, y, w, h, 6);
        g.fillStyle = disabled ? 'rgba(30,25,23,0.72)' : o.primary ? 'rgb(91,38,31)' : o.danger ? 'rgb(54,27,25)' : 'rgb(46,36,32)';
        g.fill();
        setStroke(g, 1, false);
        g.strokeStyle = disabled ? 'rgb(57,49,44)' : o.primary ? 'rgb(164,79,59)' : o.danger ? 'rgb(112,54,47)' : 'rgb(84,66,54)';
        g.stroke();
        g.save();
        g.beginPath();
        g.rect(x + 4, y, w - 8, h);
        g.clip();
        const fit = (s, base, min, style, maxW) => {
            let px = base;
            g.font = style + px + 'px ' + (style ? 'serif' : 'sans-serif');
            while (px > min && g.measureText(s).width > maxW) { px--; g.font = style + px + 'px ' + (style ? 'serif' : 'sans-serif'); }
        };
        fit(title, 16, 11, 'bold ', w - 28 - (o.key ? 30 : 0));
        this.text(g, title, x + 14, y + 22, disabled ? rgb(113,103,94) : rgb(244,233,216), false);
        fit(copy, 12, 8, '', w - 28);
        this.text(g, copy, x + 14, y + 41, disabled ? rgb(90,83,78) : rgb(177,161,145), false);
        g.restore();
        if (o.key) {
            g.font = 'bold 12px monospace';
            this.text(g, o.key, x + w - 14, y + 22, disabled ? rgb(90,83,78) : rgb(214,183,133), true);
        }
    }

    drawPauseMenu(g, sw, sh) {
        this.pauseRects = [];
        g.fillStyle = 'rgba(5,4,4,0.82)';
        g.fillRect(0, 0, sw, sh);
        const sideGap = 18, minW = 800;
        let W = Math.min(940, sw - 28), H = Math.min(650, sh - 28);
        let X = Math.floor((sw - W) / 2);
        const Y = Math.floor((sh - H) / 2);
        // keybinds sit in the free space left of the panel; the panel never shrinks below minW (its button text needs it)
        const free = sw - 28 - sideGap;
        let sideW = 0;
        if (free - 940 >= 280) {
            W = 940;
            sideW = U.clamp(Math.floor((sw - W) / 2) - sideGap - 14, 280, 340);
        } else if (free - minW >= 220) {
            sideW = Math.min(280, free - minW);
            W = free - sideW;
        }
        if (sideW > 0) {
            if (X < sideW + sideGap + 14) X = 14 + sideW + sideGap + Math.floor((free - sideW - W) / 2);
            this.drawPauseKeybinds(g, X - sideGap - sideW, Y, sideW, H);
        }
        const grad = g.createLinearGradient(X, Y, X + W, Y + H);
        grad.addColorStop(0, 'rgba(30,23,20,0.98)');
        grad.addColorStop(1, 'rgba(15,13,12,0.98)');
        roundRectPath(g, X, Y, W, H, 10);
        g.fillStyle = grad;
        g.fill();
        setStroke(g, 1, false);
        g.strokeStyle = 'rgb(84,64,50)';
        g.stroke();

        g.fillStyle = 'rgb(184,73,54)';
        g.fillRect(X + 28, Y + 24, 48, 3);
        g.fillStyle = 'rgb(112,84,58)';
        g.fillRect(X + 82, Y + 24, 28, 3);
        g.font = 'bold 34px serif';
        this.text(g, "RONIN'S PATH", X + 28, Y + 68, rgb(226,211,188), false);
        g.font = 'bold 18px ' + KANJI_FAMILY;
        this.text(g, '\u4e00\u6642\u505c\u6b62', X + 28, Y + 94, rgb(168,139,101), false);
        g.font = 'bold 13px sans-serif';
        const pauseStatus = 'JOURNEY PAUSED';
        this.text(g, pauseStatus, X + W - 28 - g.measureText(pauseStatus).width / 2, Y + 54, rgb(213,91,70), true);
        g.font = '12px sans-serif';
        const pauseHint = 'Esc resumes the game';
        this.text(g, pauseHint, X + W - 28 - g.measureText(pauseHint).width / 2, Y + 76, rgb(157,143,130), true);

        const pad = 28, gap = 18, top = Y + 116;
        const colW = (W - pad * 2 - gap) / 2;
        const lx = X + pad, rx = lx + colW + gap;
        const section = (title, copy, x, y) => {
            g.font = 'bold 15px serif';
            this.text(g, title.toUpperCase(), x, y, rgb(214,185,135), false);
            g.font = '12px sans-serif';
            this.text(g, copy, x, y + 19, rgb(146,133,121), false);
        };
        section('Return to the path', 'Continue playing or prepare your ronin.', lx, top);
        section('Journey data', this.guestJourney ? 'Journey saves are managed by the host.' : 'Manage progress stored in this browser.', rx, top);
        let y = top + 32;
        this.pauseButton(g, 'resume', 'Resume Journey', 'Return to the world.', lx, y, colW, 52, { primary: true, key: 'ESC' });
        this.pauseButton(g, 'save', 'Save Now', this.guestJourney ? 'Unavailable to co-op guests.' : 'Write your current progress to this browser.',
            rx, y, colW, 52, { key: 'S', disabled: this.guestJourney });
        y += 60;
        this.pauseButton(g, 'equipment', 'Equipment & Skills', 'Change gear, appearance, combat arts, and skills.', lx, y, colW, 52, { key: 'TAB' });
        this.pauseButton(g, 'export', 'Export Save File', this.guestJourney ? 'Unavailable to co-op guests.' : 'Create a portable backup of your journey.',
            rx, y, colW, 52, { key: 'X', disabled: this.guestJourney });
        y += 60;
        this.pauseButton(g, 'main-menu', 'Return to Main Menu', 'Save progress and leave the current journey.', lx, y, colW, 52, { danger: true, key: 'Q' });
        this.pauseButton(g, 'import', 'Import Save File', this.guestJourney ? 'Unavailable to co-op guests.' : 'Restore a previously exported journey.',
            rx, y, colW, 52, { key: 'L', disabled: this.guestJourney });

        y += 82;
        section(this.coop && this.coop.host ? 'Co-op rules' : 'World options',
            this.coop && !this.coop.host ? 'Only the host can alter this shared world.' : 'Changes here affect the current journey.', lx, y);
        y += 32;
        const resetDisabled = this.coop && !this.coop.host;
        const resetTitle = this.resetMapConfirmT > 0 ? 'Confirm Reset Map' : 'Reset Map';
        const resetCopy = resetDisabled ? 'Only the co-op host can reset the map.'
            : this.resetMapConfirmT > 0 ? 'Select again to rebuild the world; gear and progress remain.' : 'Rebuild the world while keeping gear, skills, and EXP.';
        this.pauseButton(g, 'reset', resetTitle, resetCopy, lx, y, colW, 52,
            { danger: true, key: 'M', disabled: resetDisabled });
        this.pauseButton(g, 'new-game', this.newGameConfirmT > 0 ? 'Confirm New Game' : 'Start New Game',
            this.guestJourney ? 'Unavailable to co-op guests.'
                : this.newGameConfirmT > 0 ? 'Select again to ERASE your save and start over.' : 'Erase this save and begin a fresh journey.',
            rx, y, colW, 52, { danger: true, key: 'N', disabled: !!this.guestJourney || !!this.coop });

        if (this.coop && this.coop.host) {
            y += 60;
            const s = this.coopSettings, smallGap = 9, smallW = (W - pad * 2 - smallGap * 4) / 5;
            this.pauseButton(g, 'friendly-fire', 'Friendly Fire', s.friendlyFire ? 'Enabled' : 'Disabled', lx, y, smallW, 50, { key: 'O' });
            this.pauseButton(g, 'enemy-down', 'Strength -5%', 'Now ' + s.enemyScale + '%', lx + (smallW + smallGap), y, smallW, 50, { key: '[' });
            this.pauseButton(g, 'enemy-up', 'Strength +5%', 'Now ' + s.enemyScale + '%', lx + (smallW + smallGap) * 2, y, smallW, 50, { key: ']' });
            this.pauseButton(g, 'count-down', 'Numbers -5%', 'Now ' + s.countScale + '%', lx + (smallW + smallGap) * 3, y, smallW, 50, { key: ';' });
            this.pauseButton(g, 'count-up', 'Numbers +5%', 'Now ' + s.countScale + '%', lx + (smallW + smallGap) * 4, y, smallW, 50, { key: "'" });
        }

        g.font = '11px sans-serif';
        this.text(g, 'Progress autosaves in this browser. Exporting creates a portable backup.', X + pad, Y + H - 18, rgb(124,113,103), false);
    }

    drawBoss(g, sw) {
        const e = this.boss;
        if (e === null) return;
        const bw = 520, bx = Math.trunc(sw / 2 - bw / 2), by = 46;
        g.font = 'bold 20px serif';
        this.text(g, e.name, bx, by - 8, rgb(225, 200, 255), false);
        g.fillStyle = 'rgb(200,30,30)';
        for (let i = 0; i < e.lives; i++) fillEllipse(g, bx + bw - 14 - i * 18, by - 22, 12, 12);
        g.fillStyle = 'rgba(0,0,0,0.667)';
        g.fillRect(bx - 2, by - 2, bw + 4, 14);
        g.fillStyle = 'rgb(170,30,40)';
        g.fillRect(bx, by, Math.trunc(bw * U.clamp(e.hp / e.maxHp, 0, 1)), 10);
        Draw.postureBar(g, sw / 2, by + 16, bw, 6, e.posture / e.maxPosture, e.st === 'BROKEN');
    }

    drawMinimap(g, sw, sh) {
        const world = this.world, player = this.player;
        const M = 200, mx = sw - M - 16, my = 16;
        const sc = M / WORLD_SIZE;
        g.fillStyle = 'rgba(0,0,0,0.627)';
        g.fillRect(mx - 4, my - 4, M + 8, M + 8);
        g.drawImage(world.minimap, mx, my);
        for (const c of world.camps) {
            const cx = mx + Math.trunc(c.x * sc), cy = my + Math.trunc(c.y * sc);
            if (c.elite) {
                g.beginPath();
                g.moveTo(cx, cy - 6);
                g.lineTo(cx + 6, cy);
                g.lineTo(cx, cy + 6);
                g.lineTo(cx - 6, cy);
                g.closePath();
                g.fillStyle = c.cleared ? 'rgb(90,90,90)' : 'rgb(170,60,230)';
                g.fill();
                setStroke(g, 1, false);
                g.strokeStyle = '#000';
                g.stroke();
            } else {
                g.fillStyle = c.cleared ? 'rgb(90,90,90)' : 'rgb(210,50,40)';
                fillEllipse(g, cx - 4, cy - 4, 8, 8);
            }
        }
        for (const s of world.shrines) {
            const cx = mx + Math.trunc(s.x * sc), cy = my + Math.trunc(s.y * sc);
            g.fillStyle = s.discovered ? 'rgb(255,210,90)' : 'rgb(150,130,90)';
            g.fillRect(cx - 3, cy - 3, 7, 7);
            if (s === this.lastShrine) {
                setStroke(g, 1, false);
                g.strokeStyle = '#fff';
                g.strokeRect(cx - 5 + 0.5, cy - 5 + 0.5, 10, 10);
            }
        }
        g.fillStyle = 'rgb(255,80,60)';
        for (const e of this.enemies) {
            if (e.st === 'DEAD' || !e.aware) continue;
            if (U.dist(e.x, e.y, player.x, player.y) > 1500) continue;
            g.fillRect(mx + Math.trunc(e.x * sc) - 1, my + Math.trunc(e.y * sc) - 1, 3, 3);
        }
        const finalBoss = this.enemies.find(e => e.boss && e.st !== 'DEAD');
        if (finalBoss) {
            const bx = mx + Math.trunc(finalBoss.x * sc), by = my + Math.trunc(finalBoss.y * sc);
            g.beginPath();
            g.moveTo(bx, by - 7);
            g.lineTo(bx + 7, by);
            g.lineTo(bx, by + 7);
            g.lineTo(bx - 7, by);
            g.closePath();
            g.fillStyle = 'rgb(255,80,60)';
            g.fill();
            setStroke(g, 1, false);
            g.strokeStyle = '#fff';
            g.stroke();
        }
        if (this.coop) {
            const slot = this.coop.slot;
            for (const [id, b] of this.coop.bodies) {
                if (!b || b === player || id === slot) continue;
                const bx = mx + U.clamp(b.x * sc, 0, M), by = my + U.clamp(b.y * sc, 0, M), bf = b.facing || 0;
                const dead = b.st === 'DEAD';
                g.beginPath();
                g.moveTo(bx + Math.cos(bf) * 7, by + Math.sin(bf) * 7);
                g.lineTo(bx + Math.cos(bf + 2.5) * 5, by + Math.sin(bf + 2.5) * 5);
                g.lineTo(bx + Math.cos(bf - 2.5) * 5, by + Math.sin(bf - 2.5) * 5);
                g.closePath();
                g.fillStyle = dead ? 'rgb(120,120,120)' : 'rgb(90,220,255)';
                g.fill();
                setStroke(g, 1, false);
                g.strokeStyle = '#000';
                g.stroke();
                g.font = 'bold 10px sans-serif';
                g.textAlign = 'center';
                g.textBaseline = 'bottom';
                g.fillStyle = dead ? 'rgb(150,150,150)' : 'rgb(170,240,255)';
                g.fillText('P' + (id + 1), bx, by - 6);
                g.textAlign = 'left';
                g.textBaseline = 'alphabetic';
            }
        }
        const px = mx + player.x * sc, py = my + player.y * sc, f = player.facing;
        g.beginPath();
        g.moveTo(px + Math.cos(f) * 7, py + Math.sin(f) * 7);
        g.lineTo(px + Math.cos(f + 2.5) * 5, py + Math.sin(f + 2.5) * 5);
        g.lineTo(px + Math.cos(f - 2.5) * 5, py + Math.sin(f - 2.5) * 5);
        g.closePath();
        g.fillStyle = '#fff';
        g.fill();
        setStroke(g, 1, false);
        g.strokeStyle = 'rgba(255,255,255,0.235)';
        g.strokeRect(mx + Math.trunc((this.camX - sw / 2) * sc) + 0.5, my + Math.trunc((this.camY - sh / 2) * sc) + 0.5,
            Math.trunc(sw * sc), Math.trunc(sh * sc));
    }

    drawPauseKeybinds(g, x, y, w, h) {
        roundRectPath(g, x, y, w, h, 10);
        g.fillStyle = 'rgba(20,16,14,0.95)';
        g.fill();
        setStroke(g, 1, false);
        g.strokeStyle = 'rgb(84,64,50)';
        g.stroke();
        g.fillStyle = 'rgb(184,73,54)';
        g.fillRect(x + 20, y + 22, 36, 3);
        g.font = 'bold 20px serif';
        this.text(g, 'Keybinds', x + 20, y + 52, rgb(226, 211, 188), false);
        const rows = [
            ['WASD', 'Move'],
            ['Mouse', 'Aim'],
            ['C / Middle mouse', 'Toggle lock-on'],
            ['LMB / J', 'Attack (3-hit combo)'],
            ['Hold LMB', 'Heavy strike'],
            ['RMB / K', 'Tap: deflect   Hold: block'],
            ['Space / L', 'Tap: dodge   Hold: sprint'],
            ['Dodge into thrust', 'Mikiri counter'],
            ['Red sweep', 'Deflect with a tighter tap'],
            ['Block + Atk / R', 'Combat Art'],
            ['F', 'Iai Flash (full Ki)'],
            ['G', 'Dragon Flash (full Ki)'],
            ['T', 'Throw weapon'],
            ['Q', 'Drink healing gourd'],
            ['E', 'Rest at shrine / revive'],
            ['Block + walk', 'Sneak (stealth deathblow)'],
            ['Tab / I', 'Equipment & skills'],
            ['Esc', 'Pause / resume'],
        ];
        // measure everything so text stays inside the panel: wrap long descriptions, shrink the font if still too tall
        const pad = 18, innerW = w - pad * 2, top = y + 74, bottom = y + h - 14;
        const wrap = (s, maxW) => {
            const lines = [];
            let line = '';
            for (const word of s.split(/\s+/)) {
                const next = line ? line + ' ' + word : word;
                if (line && g.measureText(next).width > maxW) {
                    lines.push(line);
                    line = word;
                } else line = next;
            }
            if (line) lines.push(line);
            return lines;
        };
        let layout = null;
        for (let size = 13; size >= 9; size--) {
            g.font = 'bold ' + size + 'px monospace';
            const keyW = Math.min(innerW * 0.5, Math.max(...rows.map(r => g.measureText(r[0]).width)) + 12);
            const keyLines = rows.map(r => wrap(r[0], keyW - 8));
            g.font = size + 'px sans-serif';
            const descLines = rows.map(r => wrap(r[1], innerW - keyW));
            const lineH = size + 4, gap = Math.max(3, size - 6);
            const total = rows.reduce((sum, r, i) => sum + Math.max(keyLines[i].length, descLines[i].length) * lineH + gap, 0);
            layout = { size, keyW, keyLines, descLines, lineH, gap, total };
            if (total <= bottom - top) break;
        }
        const L = layout, spare = Math.max(0, bottom - top - L.total);
        const extra = Math.min(10, spare / rows.length);
        g.save();
        roundRectPath(g, x, y, w, h, 10);
        g.clip();
        let ry = top + L.size;
        for (let i = 0; i < rows.length; i++) {
            g.font = 'bold ' + L.size + 'px monospace';
            L.keyLines[i].forEach((s, j) => this.text(g, s, x + pad, ry + j * L.lineH, rgb(214, 183, 133), false));
            g.font = L.size + 'px sans-serif';
            L.descLines[i].forEach((s, j) => this.text(g, s, x + pad + L.keyW, ry + j * L.lineH, rgb(205, 192, 176), false));
            ry += Math.max(L.keyLines[i].length, L.descLines[i].length) * L.lineH + L.gap + extra;
        }
        g.restore();
    }
}

// ---------------- boot (called from the main menu) ----------------
function startJourney(canvas) {
    const params = new URLSearchParams(location.search);
    const save = SaveGame.read();
    let seed;
    if (params.has('seed') && Number.isFinite(Number(params.get('seed')))) seed = Number(params.get('seed'));
    else if (save !== null) seed = save.seed;
    else seed = Math.floor(Math.random() * 2 ** 48);
    new Game(seed, canvas, save !== null && save.seed === seed ? save : null).run();
}
