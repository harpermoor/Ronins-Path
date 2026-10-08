'use strict';

/**
 * Online matches: a 1v1 duel, or a free-for-all for up to eight swordsmen. Every peer runs the same deterministic
 * simulation in lockstep with a small, equal input delay, so nobody has a latency advantage. Guests send their inputs
 * to the host, which relays them to everyone else and also sends periodic state snapshots that guests roll back to,
 * correcting any floating-point drift between browsers.
 * Every fighter uses the identical stats the host chose in the lobby; only cosmetics differ.
 */
const DUEL_SNAP_EVERY = 30;
const DUEL_HISTORY = 240;
const LAG_PAUSE_MS = 250, LAG_RESUME_MS = 170, LAG_SILENCE_MS = 1500, LAG_RESUME_HOLD_MS = 2000, RESUME_COUNTDOWN = 1.5;
const IN_GUARD = 1, IN_SPRINT = 2, IN_ATTACK = 4, IN_PARRY = 8, IN_DODGE = 16, IN_HEAL = 32, IN_IAI = 64, IN_ART = 128,
    IN_DRAGON = 256, IN_READY = 512, IN_STAB = 1024, IN_THROW = 2048;
const NEUTRAL_INPUT = [0, 0, 0, 0, 0];
const DUEL_PHASES = ['COUNTDOWN', 'FIGHT', 'KO', 'MATCH_OVER'];
const PLAYER_STATES = ['FREE', 'ATTACK', 'THROW', 'ART', 'DRAGON', 'DODGE', 'STAGGER', 'HEAL', 'DEATHBLOW', 'MIKIRI', 'IAI', 'DEAD'];
const PLAYER_SYNC = ['x', 'y', 'facing', 'st', 'stT', 'vx', 'vy', 'moveX', 'moveY', 'aimX', 'aimY', 'dodgeStartX', 'dodgeStartY', 'guardHeld', 'bufAttack', 'bufParry',
    'bufDodge', 'bufHeal', 'bufIai', 'bufArt', 'bufDragon', 'artIdx', 'artAtkEnd', 'dragonDone', 'combo', 'swingId', 'phase', 'swingSign',
    'comboGrace', 'guarding', 'guardStart', 'guardWindow', 'spam', 'deflectStreak', 'deflectStreakT', 'guardFlash', 'dodgeDx', 'dodgeDy',
    'dodgeHeld', 'sprinting', 'invuln', 'staggerDur', 'hurtFlash', 'postureCd', 'walkAnim', 'scarf', 'hp', 'posture', 'gourds',
    'artCharges', 'healed', 'ki', 'dbDone', 'iaiSx', 'iaiSy', 'iaiDx', 'iaiDy', 'iaiDone', 'iaiLine', 'deadT', 'beingExecuted', 'brokenT',
    'stabAttack', 'bufThrow', 'throwDone', 'throws', 'gone', 'poiseLeft', 'artHitsLeft'];
const YOU_COLOR = rgb(110, 190, 255), FOE_COLOR = rgb(255, 95, 80);
const FFA_COLORS = [rgb(255, 95, 80), rgb(120, 220, 120), rgb(255, 205, 80), rgb(205, 135, 255), rgb(90, 225, 215), rgb(255, 140, 200),
    rgb(255, 160, 70), rgb(225, 225, 225)];
const NOOP = () => {};
// stands in for fx / sfx while re-simulating frames after a correction, so effects don't play twice
const MUTED = new Proxy({}, { get: () => NOOP });

function inputDelayFor(pingMs) { return U.clamp(Math.ceil(pingMs / 2 / (DT * 1000)) + 2, 3, 8); }

function sanitizeInput(d) {
    if (!Array.isArray(d) || d.length !== 5) return NEUTRAL_INPUT;
    const n = v => (Number.isFinite(v) ? v : 0);
    return [Math.sign(n(d[0])), Math.sign(n(d[1])), Math.round(U.clamp(n(d[2]), -5000, 5000)), Math.round(U.clamp(n(d[3]), -5000, 5000)),
        n(d[4]) & 4095];
}

/** Circular ring-out-proof arena centered on the origin. */
class Arena {
    constructor(r) { this.r = r; }

    resolve(a) {
        const d = Math.hypot(a.x, a.y), m = this.r - a.r;
        if (d > m) {
            a.x = a.x / d * m;
            a.y = a.y / d * m;
        }
    }
}

/** Stands in for Game from one fighter's point of view: every other fighter still in the match is an "enemy". */
class DuelSide {
    constructor(duel, idx, loadout, statMods) {
        this.duel = duel;
        this.idx = idx;
        this.loadout = loadout;
        this.statMods = statMods;
        this.skills = new Set();
        this.self = null;
    }

    get time() { return this.duel.time; }
    get world() { return this.duel.arena; }
    get fx() { return this.duel.fx; }
    get sfx() { return this.duel.sfx; }
    get rnd() { return this.duel.cosRnd; }
    get foes() { return this.duel.players.filter(p => p !== this.self && !p.gone); }
    // only used by the Iai dash to collect victims: a dodging foe slips through it
    get enemies() { return this.foes.filter(f => f.st !== 'DEAD' && !f.invulnerable()); }

    hitstop(s) { this.duel.hitstop(s); }
    slowmo(s) { this.duel.slowmo(s); }
    shake(a) { this.duel.shake(a); }
    zoomKick(z) { this.duel.zoomKick(z); }
    flash(c, a) { this.duel.flash(c, this.idx === this.duel.localIdx ? a : a * 0.4); }
    parryBurst(x, y, k) { this.duel.parryBurst(x, y, k); }

    deathblowTarget() { return this.duel.deathblowTarget(this.self); }

    enemyInFront(p, ang, dist) {
        return this.foes.some(f => f.st !== 'DEAD' && p.distTo(f) < dist + f.r && Math.abs(U.angDiff(ang, p.angleTo(f))) < 0.9);
    }

    playerHitCheck(p, atk) {
        for (const f of this.foes) this.duel.hitCheck(p, f, atk);
    }
    projectileHitCheck(p, atk) {
        const { target, range } = projectileTarget(p, atk, this.foes, this.world);
        if (target !== null) this.duel.hitCheck(p, target, atk);
        return range;
    }
    mikiriCandidate(p, dx, dy) {
        for (const foe of this.foes) {
            if (foe.st !== 'ATTACK' || !foe.cur || !foe.cur.perilous || !foe.cur.thrust) continue;
            const timing = (foe.phase === 0 && foe.cur.windup - foe.stT < 0.32) || foe.phase === 1;
            if (!timing || p.distTo(foe) > foe.cur.range + 80) continue;
            const a = p.angleTo(foe);
            if (dx * Math.cos(a) + dy * Math.sin(a) > 0.5) return foe;
        }
        return null;
    }
    onMikiri(p, foe) { this.duel.onMikiri(p, foe); }
    executeDeathblow(p, e) { this.duel.executeDeathblow(p, e); }
    resolveIai(p, victims) { this.duel.resolveIai(p, victims); }
    onGuardBreak(p) { this.duel.breakPosture(p); }
    onPlayerDeath() { this.duel.onDeath(this.self); }
}

class Duel {
    constructor(canvas, link, localIdx, delay, looks, settings) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.link = link;
        this.settings = sanitizeDuelSettings(settings);
        this.statMods = duelStatMods(this.settings);
        this.ffa = this.settings.mode === 'ffa';
        this.roundsToWin = this.settings.rounds;
        this.n = U.clamp(looks.length, 2, MAX_MATCH_PLAYERS);
        this.localIdx = U.clamp(localIdx, 0, this.n - 1);
        this.isHost = this.localIdx === 0;
        this.delay = delay;
        this.realSfx = new Sfx();
        this.sfx = this.realSfx;
        this.input = new Input(canvas, () => this.realSfx.unlock());
        PreferencesMenu.attach(this);
        this.mouseAttackPending = false;
        this.realFx = new Effects();
        this.fx = this.realFx;
        this.cosRnd = new Rng(Date.now());
        this.arenaR = ARENA_SIZES[this.settings.arena];
        this.arena = new Arena(this.arenaR);
        this.muted = false;

        // ---- simulation state (identical on every peer) ----
        this.simFrame = 0;
        this.time = 0;
        this.hitstopT = 0;
        this.slowmoT = 0;
        this.timeScale = 1;
        this.phase = 'COUNTDOWN';
        this.phaseT = 0;
        this.round = 1;
        this.score = new Array(this.n).fill(0);
        this.ready = new Array(this.n).fill(false);
        this.lastKo = -1;
        this.sides = [];
        this.players = [];
        for (let i = 0; i < this.n; i++) {
            const lo = new Loadout();
            lo.apply({ look: looks[i] }, 0);
            const side = new DuelSide(this, i, lo, this.statMods);
            const p = new Player(side, 0, 0);
            p.brokenT = 0;
            p.beingExecuted = false;
            p.gone = false;
            p.applyLoadout();
            side.self = p;
            this.sides.push(side);
            this.players.push(p);
        }
        this.player = this.players[this.localIdx];

        this.inputs = [];
        for (let i = 0; i < this.n; i++) {
            const m = new Map();
            for (let f = 0; f < delay; f++) m.set(f, NEUTRAL_INPUT);
            this.inputs.push(m);
        }
        // a peer that left keeps feeding neutral inputs from an agreed frame, so the lockstep never stalls on them
        this.dropFrame = new Array(this.n).fill(-1);
        this.pendingSnaps = new Map();

        // ---- presentation / connection state (local only) ----
        this.realTime = 0;
        this.camX = 0;
        this.camY = 0;
        this.camZ = 1;
        this.shakeAmt = 0;
        this.zoomKickV = 0;
        this.flashA = 0;
        this.flashColor = WHITE;
        this.parryT = 0;
        this.parryX = 0;
        this.parryY = 0;
        this.parryK = 0;
        this.hpGhost = this.players.map(p => p.maxHp);
        this.vignette = null;
        this.redVignette = null;
        this.vigW = 0;
        this.vigH = 0;
        this.lagPaused = false;
        this.resumeT = 0;
        this.goodSince = 0;
        this.stallT = 0;
        this.leaveConfirmT = 0;
        this.lostMsg = null;

        link.on('in', (d, c) => this.onRemoteInput(d, c));
        link.on('snap', d => this.onSnap(d));
        link.on('lag', d => this.onLag(d));
        link.on('drop', d => this.onDropMsg(d));
        link.on('bye', (d, c) => this.onBye(c));
        link.onPeerClose = c => this.onPeerGone(c);
        link.onClose = () => {
            if (!this.isHost) this.onLost('Connection to the host was lost.');
            else if (this.aliveCount() < 2) this.onLost('Everyone else left the match.');
        };

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        window.addEventListener('resize', resize);
        resize();
        this.resetRound();
    }

    /** Fighters still connected to the match, however badly they are doing. */
    aliveCount() { return this.players.reduce((n, p) => n + (p.gone ? 0 : 1), 0); }

    colorOf(i) { return i === this.localIdx ? YOU_COLOR : this.ffa ? FFA_COLORS[i % FFA_COLORS.length] : FOE_COLOR; }

    nameOf(i) { return i === this.localIdx ? 'You' : this.ffa ? 'Player ' + (i + 1) : 'Opponent'; }

    /** A peer index that has left but whose neutral inputs have not started yet still blocks the lockstep. */
    inputFor(i, f) {
        const m = this.inputs[i];
        if (m.has(f)) return m.get(f);
        if (this.dropFrame[i] >= 0 && f >= this.dropFrame[i]) return NEUTRAL_INPUT;
        return null;
    }

    // ================= loop =================
    run() {
        let last = performance.now(), acc = 0;
        const frame = now => {
            const el = Math.min(0.1, (now - last) / 1000);
            last = now;
            this.realTime += el;
            this.handleMeta(el);
            this.updateLag(now, el);
            if (this.lostMsg !== null || this.lagPaused || this.resumeT > 0) {
                acc = 0;
                this.stallT = 0;
                this.input.endTick();
            } else {
                acc = Math.min(acc + el, DT * 6);
                let stalled = false;
                while (acc >= DT) {
                    const f = this.simFrame;
                    if (!this.frameReady(f)) {
                        stalled = true;
                        break;
                    }
                    const mine = this.sampleLocal();
                    this.inputs[this.localIdx].set(f + this.delay, mine);
                    const msg = { t: 'in', i: this.localIdx, f: f + this.delay, d: mine };
                    this.link.send(msg);
                    this.simulate(f);
                    acc -= DT;
                }
                this.stallT = stalled ? this.stallT + el : 0;
            }
            this.updatePresentation(el);
            this.render();
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }

    handleMeta(el) {
        const inp = this.input;
        this.leaveConfirmT -= el;
        if (inp.hit('settings')) PreferencesMenu.open();
        if (Preferences.open) return;
        if (this.lostMsg !== null) {
            if (inp.hit('ready') || inp.hit('pause') || inp.mouseHit(1)) this.leave(false);
            return;
        }
        if (inp.hit('pause')) {
            inp.consumeHit('pause');
            if (this.leaveConfirmT > 0) this.leave(true);
            else this.leaveConfirmT = 3;
        }
    }

    leave(notify) {
        if (notify) this.link.send({ t: 'bye', i: this.localIdx });
        setTimeout(() => {
            this.link.close();
            location.replace(location.href.split(/[?#]/)[0]);
        }, notify ? 200 : 0);
    }

    // ================= networking =================
    sampleLocal() {
        const inp = this.input, z = this.zoom();
        const p = this.players[this.localIdx];
        const aim = p.lockAim(inp, (inp.mx - this.canvas.width / 2) / z + this.camX,
            (inp.my - this.canvas.height / 2) / z + this.camY, this.players);
        const wx = aim.x, wy = aim.y;
        let mx = 0, my = 0, b = 0;
        if (inp.down('moveUp')) my -= 1;
        if (inp.down('moveDown')) my += 1;
        if (inp.down('moveLeft')) mx -= 1;
        if (inp.down('moveRight')) mx += 1;
        if (inp.down('guard')) b |= IN_GUARD;
        if (inp.down('dodge')) b |= IN_SPRINT;
        if (inp.hit('quickAttack')) b |= IN_ATTACK;
        if (inp.hit('attack')) this.mouseAttackPending = true;
        if (this.mouseAttackPending && inp.heldFor('attack') >= HEAVY_STAB_HOLD) {
            this.mouseAttackPending = false;
            b |= IN_STAB;
        } else if (this.mouseAttackPending && !inp.down('attack')) {
            this.mouseAttackPending = false;
            b |= IN_ATTACK;
        }
        if (inp.hit('guard')) b |= IN_PARRY;
        if (inp.hit('dodge')) b |= IN_DODGE;
        if (inp.hit('heal')) b |= IN_HEAL;
        if (inp.hit('iai')) b |= IN_IAI;
        if (inp.hit('art')) b |= IN_ART;
        if (inp.hit('dragon')) b |= IN_DRAGON;
        if (inp.hit('throw')) b |= IN_THROW;
        if (inp.hit('ready')) b |= IN_READY;
        inp.endTick();
        return sanitizeInput([mx, my, wx, wy, b]);
    }

    /** Every fighter must have supplied this frame before anyone may simulate it. */
    frameReady(f) {
        for (let i = 0; i < this.n; i++) if (this.inputFor(i, f) === null) return false;
        return true;
    }

    onRemoteInput(d, from) {
        if (!Number.isInteger(d.f) || !Number.isInteger(d.i) || d.i < 0 || d.i >= this.n) return;
        if (d.i === this.localIdx || d.f < this.simFrame || d.f > this.simFrame + 600) return;
        // a guest may only speak for itself; the host is the only peer allowed to forward other people's inputs
        if (this.isHost && from && from.idx !== d.i) return;
        const m = this.inputs[d.i];
        if (m.has(d.f)) return;
        const clean = sanitizeInput(d.d);
        m.set(d.f, clean);
        if (this.isHost) this.link.relay({ t: 'in', i: d.i, f: d.f, d: clean }, from);
    }

    /** The host decides, on a frame everyone can agree on, that a fighter has left. */
    onPeerGone(c) {
        if (!this.isHost || !c || !Number.isInteger(c.idx) || c.idx < 0 || c.idx >= this.n) return;
        const f = this.simFrame + this.delay;
        this.link.send({ t: 'drop', i: c.idx, f });
        this.dropAt(c.idx, f);
    }

    onBye(c) {
        if (this.isHost) this.onPeerGone(c);
        else if (!this.ffa) this.onLost('Your opponent left the duel.');
    }

    onDropMsg(d) {
        if (this.isHost || !Number.isInteger(d.i) || !Number.isInteger(d.f) || d.i < 0 || d.i >= this.n) return;
        this.dropAt(d.i, Math.max(d.f, 0));
    }

    dropAt(i, f) {
        if (this.dropFrame[i] >= 0) return;
        this.dropFrame[i] = f;
        if (!this.ffa) this.onLost('Your opponent left the duel.');
    }

    onSnap(d) {
        if (this.isHost || !Number.isInteger(d.f) || d.f < 0) return;
        if (d.f + 1 <= this.simFrame) this.correct(d.f, d.s);
        else if (this.pendingSnaps.size < 32) this.pendingSnaps.set(d.f, d.s);
    }

    /** Adopt the host's state for frame f, then quietly re-simulate forward to where we were. */
    correct(f, s) {
        const target = this.simFrame;
        for (let i = f + 1; i < target; i++) if (!this.frameReady(i)) return;
        if (!this.deserialize(s)) return;
        this.simFrame = f + 1;
        this.muted = true;
        this.fx = MUTED;
        this.sfx = MUTED;
        try {
            while (this.simFrame < target) this.simulate(this.simFrame);
        } finally {
            this.muted = false;
            this.fx = this.realFx;
            this.sfx = this.realSfx;
        }
    }

    onLag(d) {
        if (this.isHost) return;
        const on = !!d.on;
        if (this.lagPaused && !on) this.resumeT = RESUME_COUNTDOWN;
        this.lagPaused = on;
    }

    /** The host decides when the connection is too poor to play and pauses both sides until it recovers. */
    updateLag(now, el) {
        if (this.resumeT > 0) this.resumeT -= el;
        if (!this.isHost || this.lostMsg !== null) return;
        const ping = this.link.ping(), silent = now - this.link.lastHeard;
        if (!this.lagPaused) {
            if (ping > LAG_PAUSE_MS || silent > LAG_SILENCE_MS) {
                this.lagPaused = true;
                this.goodSince = 0;
                this.link.send({ t: 'lag', on: true });
            }
        } else if (ping < LAG_RESUME_MS && silent < 600) {
            if (this.goodSince === 0) this.goodSince = now;
            else if (now - this.goodSince > LAG_RESUME_HOLD_MS) {
                this.lagPaused = false;
                this.resumeT = RESUME_COUNTDOWN;
                this.link.send({ t: 'lag', on: false });
            }
        } else this.goodSince = 0;
    }

    onLost(msg) {
        if (this.lostMsg === null) this.lostMsg = msg;
        this.lagPaused = false;
    }

    // ================= simulation =================
    simulate(f) {
        for (let i = 0; i < this.n; i++) {
            if (this.dropFrame[i] >= 0 && f >= this.dropFrame[i] && !this.players[i].gone) this.removePlayer(i);
            this.applyInput(i, this.inputFor(i, f) || NEUTRAL_INPUT);
        }
        this.step(DT);
        this.simFrame = f + 1;
        if (this.isHost) {
            if (this.simFrame % DUEL_SNAP_EVERY === 0) this.link.send({ t: 'snap', f, s: this.serialize() });
        } else if (this.pendingSnaps.has(f)) {
            const s = this.pendingSnaps.get(f);
            this.pendingSnaps.delete(f);
            if (this.deserialize(s)) this.simFrame = f + 1;
        }
        for (let i = 0; i < this.n; i++) this.inputs[i].delete(f - DUEL_HISTORY);
    }

    removePlayer(i) {
        const p = this.players[i];
        p.gone = true;
        p.beingExecuted = false;
        p.brokenT = 0;
        p.hp = 0;
        if (p.st !== 'DEAD') {
            p.st = 'DEAD';
            p.stT = 0;
            p.deadT = 0;
        }
        for (const q of this.players) {
            q.hitSet.delete(p);
            if (q.dbTarget === p) q.dbTarget = null;
        }
    }

    applyInput(i, d) {
        const p = this.players[i];
        if (p.gone) return;
        if (this.phase === 'COUNTDOWN' || this.phase === 'MATCH_OVER') {
            if (this.phase === 'MATCH_OVER' && (d[4] & IN_READY)) this.ready[i] = !this.ready[i];
            p.moveX = p.moveY = 0;
            p.guardHeld = p.dodgeHeld = false;
            const look = this.nearestFoe(p);
            p.aimX = look !== null ? look.x : p.x + Math.cos(p.facing) * 60;
            p.aimY = look !== null ? look.y : p.y + Math.sin(p.facing) * 60;
            return;
        }
        const l = Math.hypot(d[0], d[1]);
        p.moveX = l > 0 ? d[0] / l : 0;
        p.moveY = l > 0 ? d[1] / l : 0;
        p.aimX = d[2];
        p.aimY = d[3];
        const b = d[4];
        p.guardHeld = (b & IN_GUARD) !== 0;
        p.dodgeHeld = (b & IN_SPRINT) !== 0;
        if (b & IN_ATTACK) p.bufAttack = 0.22;
        if (b & IN_PARRY) p.bufParry = 0.15;
        if (b & IN_DODGE) p.bufDodge = 0.18;
        if (b & IN_HEAL) p.bufHeal = 0.12;
        if (b & IN_IAI) p.bufIai = 0.15;
        if (b & IN_ART) p.bufArt = 0.2;
        if (b & IN_DRAGON) p.bufDragon = 0.15;
        if (b & IN_STAB) p.bufStab = 0.2;
        if (b & IN_THROW) p.bufThrow = 0.2;
    }

    nearestFoe(p) {
        let best = null, bd = Infinity;
        for (const q of this.players) {
            if (q === p || q.gone || q.st === 'DEAD') continue;
            const d = p.distTo(q);
            if (d < bd) {
                bd = d;
                best = q;
            }
        }
        return best;
    }

    standing() { return this.players.filter(p => !p.gone && p.st !== 'DEAD'); }

    step(dt) {
        if (this.hitstopT > 0) {
            this.hitstopT -= dt;
            return;
        }
        if (this.slowmoT > 0) {
            this.slowmoT -= dt;
            this.timeScale = 0.3;
        } else this.timeScale = U.lerp(this.timeScale, 1, 1 - Math.exp(-dt * 8));
        const sdt = dt * this.timeScale;
        this.time += sdt;
        this.phaseT += dt;
        if (this.phase === 'COUNTDOWN' && this.phaseT >= 3) {
            this.phase = 'FIGHT';
            this.phaseT = 0;
            this.sfx.play('CLANG');
        } else if (this.phase === 'KO' && this.phaseT >= 2.6) {
            if (Math.max(...this.score) >= this.roundsToWin || this.aliveCount() < 2) {
                this.phase = 'MATCH_OVER';
                this.phaseT = 0;
                this.ready.fill(false);
            } else {
                this.round++;
                this.resetRound();
                return;
            }
        } else if (this.phase === 'MATCH_OVER' && this.rematchAgreed()) {
            this.resetMatch();
            return;
        }

        for (const p of this.players) {
            // a fighter being executed is held in place until the blow lands
            if (!p.gone && p.beingExecuted && p.st !== 'DEAD') {
                p.st = 'STAGGER';
                p.staggerDur = p.stT + 1;
                p.vx = p.vy = 0;
            }
        }
        for (const p of this.players) if (!p.gone) p.update(sdt);
        for (const p of this.players) {
            if (!p.gone && p.brokenT > 0 && (p.st !== 'STAGGER' || (p.brokenT -= sdt) <= 0)) {
                p.brokenT = 0;
                if (p.st !== 'DEAD') p.posture = p.maxPosture * 0.5;
            }
        }
        this.separate();
        if (this.phase === 'FIGHT') {
            const live = this.standing();
            if (live.length <= 1) {
                this.phase = 'KO';
                this.phaseT = 0;
                this.lastKo = live.length === 1 ? this.players.indexOf(live[0]) : -1;
                if (this.lastKo >= 0) this.score[this.lastKo]++;
                this.slowmo(0.9);
            }
        }
        this.fx.update(sdt);
    }

    /** Everyone still connected has to want the rematch. */
    rematchAgreed() {
        let any = false;
        for (let i = 0; i < this.n; i++) {
            if (this.players[i].gone) continue;
            if (!this.ready[i]) return false;
            any = true;
        }
        return any && this.aliveCount() >= 2;
    }

    resetRound() {
        const r = this.arenaR * 0.62;
        for (let i = 0; i < this.n; i++) {
            const p = this.players[i];
            if (p.gone) continue;
            const a = i / this.n * TAU, x = Math.cos(a) * r, y = Math.sin(a) * r;
            p.respawn(x, y);
            p.invuln = 0;
            p.facing = a + Math.PI;
            p.aimX = -x;
            p.aimY = -y;
            p.moveX = p.moveY = 0;
            p.guardHeld = p.dodgeHeld = p.guarding = p.sprinting = false;
            p.bufAttack = p.bufParry = p.bufDodge = p.bufHeal = p.bufIai = p.bufArt = p.bufDragon = p.bufStab = p.bufThrow = 0;
            p.stabAttack = false;
            p.brokenT = 0;
            p.beingExecuted = false;
            p.dbTarget = null;
            p.combo = -1;
            p.cur = null;
            p.artAtk = null;
            p.hitSet.clear();
            p.iaiVictims.length = 0;
            p.deflectStreak = 0;
            p.deflectStreakT = 0;
            p.spam = 0;
            p.hurtFlash = 0;
            p.postureCd = 0;
            p.comboGrace = 0;
            p.guardStart = -99;
            p.deadT = 0;
        }
        this.phase = 'COUNTDOWN';
        this.phaseT = 0;
        this.hitstopT = 0;
        this.slowmoT = 0;
        this.timeScale = 1;
    }

    resetMatch() {
        this.score.fill(0);
        this.ready.fill(false);
        this.round = 1;
        this.lastKo = -1;
        this.resetRound();
    }

    separate() {
        const through = p => p.st === 'IAI' || p.st === 'DEATHBLOW' || p.st === 'DODGE';
        for (let i = 0; i < this.n; i++) {
            const a = this.players[i];
            if (a.gone || a.st === 'DEAD' || through(a)) continue;
            for (let j = i + 1; j < this.n; j++) {
                const b = this.players[j];
                if (b.gone || b.st === 'DEAD' || through(b)) continue;
                const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r;
                if (d < min && d > 0.01) {
                    const push = (min - d) / 2;
                    a.x -= dx / d * push;
                    a.y -= dy / d * push;
                    b.x += dx / d * push;
                    b.y += dy / d * push;
                    this.arena.resolve(a);
                    this.arena.resolve(b);
                }
            }
        }
    }

    // ================= combat =================
    hitstop(s) { this.hitstopT = Math.max(this.hitstopT, s); }

    slowmo(s) { this.slowmoT = Math.max(this.slowmoT, s); }

    shake(a) { if (!this.muted) this.shakeAmt = Math.max(this.shakeAmt, a); }

    zoomKick(z) { if (!this.muted) this.zoomKickV = Math.max(this.zoomKickV, z); }

    flash(c, a) {
        if (this.muted) return;
        this.flashColor = c;
        this.flashA = Math.max(this.flashA, a);
    }

    parryBurst(x, y, k) {
        if (this.muted) return;
        this.parryT = 0.2;
        this.parryX = x;
        this.parryY = y;
        this.parryK = k;
    }

    zoom() { return this.camZ * (1 + this.zoomKickV); }

    deathblowTarget(p) {
        let best = null, bd = Infinity;
        for (const foe of this.players) {
            if (foe === p || foe.gone || foe.brokenT <= 0 || foe.st === 'DEAD' || foe.beingExecuted) continue;
            const d = p.distTo(foe);
            if (d < 105 + foe.r && d < bd) {
                bd = d;
                best = foe;
            }
        }
        return best;
    }

    hitCheck(p, foe, atk) {
        if (foe.st === 'DEAD' || p.hitSet.has(foe)) return;
        const d = p.distTo(foe);
        if (d > atk.range + foe.r) return;
        const tol = atk.arc / 2 + Math.asin(Math.min(1, foe.r / Math.max(d, 1)));
        if (Math.abs(U.angDiff(p.facing, p.angleTo(foe))) > tol) return;
        // piercing attacks (Mortal Draw, Dragon Flash) cannot be guarded, like perilous enemy attacks
        const res = foe.receive(p.x, p.y, atk.damage, atk.posture, !!atk.pierce);
        if (res === P_IGNORE) return;
        p.hitSet.add(foe);
        if (res === P_DEFLECT || res === P_PERFECT) this.onDeflected(p, foe, atk, res === P_PERFECT);
        else if (res === P_PERFECT_DODGE) {
            foe.dodgeAfterimage = p.afterimage || null;
            foe.posture += 18;
            foe.postureCd = 1.0;
            if (foe.posture >= foe.maxPosture) this.breakPosture(foe);
            else {
                foe.recoil(foe.angleTo(p));
                this.fx.text('COUNTER OPENING', foe.x, foe.y - 40, rgb(190, 235, 255), 14);
            }
        }
        else if (res === P_HIT) {
            p.ki = Math.min(100, p.ki + 4);
            this.fx.text(String(Math.trunc(foe.lastDmgTaken)), foe.x, foe.y - 30, WHITE, 13);
            if (foe.st !== 'DEAD' && foe.posture >= foe.maxPosture) this.breakPosture(foe);
        }
    }

    onMikiri(p, foe) {
        if (foe.st === 'DEAD' || !foe.cur || !foe.cur.perilous || !foe.cur.thrust) return;
        const a = p.angleTo(foe);
        foe.posture += foe.maxPosture * 0.5;
        foe.postureCd = 1.0;
        foe.st = 'STAGGER';
        foe.stT = 0;
        foe.staggerDur = 1.1;
        foe.vx = Math.cos(a) * 260;
        foe.vy = Math.sin(a) * 260;
        p.ki = Math.min(100, p.ki + 25);
        p.gainArtCharge();
        this.fx.sparks((p.x + foe.x) / 2, (p.y + foe.y) / 2, a + Math.PI, 3, 40, 600, rgb(140, 220, 255));
        this.fx.text('MIKIRI COUNTER', p.x, p.y - 48, rgb(140, 220, 255), 20);
        this.sfx.play('CLANG');
        this.hitstop(0.12);
        this.shake(11);
        this.slowmo(0.35);
        this.flash(rgb(180, 230, 255), 0.2);
        this.fx.impact((p.x + foe.x) / 2, (p.y + foe.y) / 2, 'mikiri');
        if (foe.posture >= foe.maxPosture) this.breakPosture(foe);
    }

    /** The defender deflected: the attacker's posture takes the punishment, and heavy swings leave an opening. */
    onDeflected(att, def, atk, perfect) {
        const chain = 1 + 0.08 * Math.min(def.deflectStreak - 1, 5);
        att.posture += (atk.posture * (perfect ? 2 : 1.3) + (perfect ? 12 : 6)) * chain;
        att.postureCd = 1.0;
        const away = def.angleTo(att);
        att.move(this.arena, Math.cos(away) * 12, Math.sin(away) * 12);
        if (att.posture >= att.maxPosture) this.breakPosture(att);
        else if (perfect || atk.heavy) {
            att.recoil(away);
            this.fx.text(perfect ? 'PERFECT OPENING' : 'OPENING', att.x, att.y - 40, rgb(255, 235, 170), 15);
        }
    }

    breakPosture(p) {
        if (p.st === 'DEAD') return;
        p.posture = p.maxPosture;
        p.brokenT = 1.3;
        p.st = 'STAGGER';
        p.stT = 0;
        p.staggerDur = 1.3;
        p.guarding = false;
        p.vx *= 0.3;
        p.vy *= 0.3;
        this.sfx.play('BREAK');
        this.hitstop(0.1);
        this.slowmo(0.3);
        this.shake(8);
        this.fx.ring(p.x, p.y, 10, 100, 0.5, 5, rgb(255, 60, 40));
        this.fx.sparks(p.x, p.y, 0, TAU, 24, 380, rgb(255, 120, 60));
        this.fx.text('POSTURE BROKEN', p.x, p.y - 44, rgb(255, 90, 60), 16);
    }

    executeDeathblow(p, e) {
        e.beingExecuted = false;
        if (e.st === 'DEAD') return;
        const fx = this.fx, a = p.angleTo(e);
        fx.blood(e.x, e.y, a, 45, 480);
        fx.sparks(e.x, e.y, a, 1.0, 20, 650, WHITE);
        fx.line(e.x - Math.cos(a + 0.8) * 70, e.y - Math.sin(a + 0.8) * 70, e.x + Math.cos(a + 0.8) * 70, e.y + Math.sin(a + 0.8) * 70, 0.5, 5,
            rgb(255, 80, 80));
        fx.line(e.x - Math.cos(a - 0.8) * 60, e.y - Math.sin(a - 0.8) * 60, e.x + Math.cos(a - 0.8) * 60, e.y + Math.sin(a - 0.8) * 60, 0.6, 4,
            rgb(255, 220, 220));
        fx.ring(e.x, e.y, 10, 130, 0.6, 6, rgb(255, 50, 40));
        fx.text('DEATHBLOW', e.x, e.y - 50, rgb(255, 70, 60), 22);
        this.sfx.play('DEATHBLOW');
        this.hitstop(0.16);
        this.shake(14);
        this.slowmo(0.45);
        this.zoomKick(0.12);
        this.flash(rgb(255, 200, 200), 0.3);
        e.brokenT = 0;
        e.hp = 0;
        e.die();
    }

    resolveIai(p, victims) {
        this.sfx.play('DEATHBLOW');
        this.flash(p.enlightened() ? rgb(255, 225, 145) : rgb(200, 230, 255), 0.25);
        if (victims.length === 0) return;
        this.hitstop(0.12);
        this.shake(12);
        for (const e of victims) {
            if (e.st === 'DEAD') continue;
            const a = p.angleTo(e) + Math.PI / 2;
            this.fx.line(e.x - Math.cos(a) * 55, e.y - Math.sin(a) * 55, e.x + Math.cos(a) * 55, e.y + Math.sin(a) * 55, 0.6, 4,
                p.enlightened() ? rgb(255, 205, 75) : rgb(170, 210, 255));
            this.fx.sparks(e.x, e.y, a, 1.0, 14, 500,
                p.enlightened() ? rgb(255, 205, 75) : rgb(170, 210, 255));
            this.fx.blood(e.x, e.y, a, 14, 300);
            const dmg = IAI_FLASH_DAMAGE * e.dmgTaken;
            this.fx.text(String(Math.trunc(dmg)), e.x, e.y - 30, rgb(255, 230, 120), 15);
            e.hp -= dmg;
            e.posture = Math.min(e.maxPosture, e.posture + 70);
            e.postureCd = 1.0;
            e.hurtFlash = 0.3;
            e.guarding = false;
            e.st = 'STAGGER';
            e.stT = 0;
            e.staggerDur = 0.45;
            if (e.hp <= 0) e.die();
            else if (e.posture >= e.maxPosture) this.breakPosture(e);
        }
    }

    onDeath(p) {
        this.sfx.play('BREAK');
        this.shake(12);
        this.fx.ring(p.x, p.y, 10, 140, 0.8, 5, rgb(255, 60, 50));
    }

    // ================= snapshots =================
    serialize() {
        return {
            t: this.time, h: this.hitstopT, s: this.slowmoT, ts: this.timeScale, ph: this.phase, pt: this.phaseT, r: this.round,
            sc: this.score.slice(), rd: this.ready.slice(), k: this.lastKo, p: this.players.map(p => this.packPlayer(p)),
        };
    }

    packPlayer(p) {
        const a = PLAYER_SYNC.map(k => p[k]), idx = q => this.players.indexOf(q);
        a.push(p.artAtk !== null, [...p.hitSet].map(idx).filter(i => i >= 0), p.dbTarget !== null ? idx(p.dbTarget) : -1,
            p.iaiVictims.map(idx).filter(i => i >= 0));
        return a;
    }

    deserialize(s) {
        const num = v => typeof v === 'number' && Number.isFinite(v);
        if (!s || typeof s !== 'object' || !Array.isArray(s.p) || s.p.length !== this.n || !DUEL_PHASES.includes(s.ph)) return false;
        if (![s.t, s.h, s.s, s.ts, s.pt, s.r, s.k].every(num) || !Array.isArray(s.sc) || !Array.isArray(s.rd)) return false;
        for (const a of s.p) if (!Array.isArray(a) || a.length !== PLAYER_SYNC.length + 4) return false;
        this.time = s.t;
        this.hitstopT = s.h;
        this.slowmoT = s.s;
        this.timeScale = s.ts;
        this.phase = s.ph;
        this.phaseT = s.pt;
        this.round = s.r;
        this.lastKo = s.k;
        for (let i = 0; i < this.n; i++) {
            this.score[i] = num(s.sc[i]) ? s.sc[i] : this.score[i];
            this.ready[i] = !!s.rd[i];
            this.unpackPlayer(this.players[i], s.p[i]);
        }
        return true;
    }

    unpackPlayer(p, a) {
        const n = PLAYER_SYNC.length;
        for (let i = 0; i < n; i++) {
            const k = PLAYER_SYNC[i], v = a[i];
            if (typeof v !== typeof p[k] || (typeof v === 'number' && !Number.isFinite(v))) continue;
            if (k === 'st' && !PLAYER_STATES.includes(v)) continue;
            p[k] = k === 'artHitsLeft' ? U.clamp(Math.floor(v), 0, 2) : v;
        }
        const at = i => (Number.isInteger(i) && i >= 0 && i < this.n ? this.players[i] : null);
        p.cur = p.stabAttack ? p.stabAtk : (p.combo >= 0 && p.combo < p.comboAtk.length ? p.comboAtk[p.combo] : null);
        p.curArt = p.art;
        p.curArtAtks = p.artAtks;
        p.artAtk = a[n] && p.artIdx > 0 ? p.artAtks[p.artIdx - 1] || null : null;
        p.hitSet.clear();
        if (Array.isArray(a[n + 1])) for (const i of a[n + 1]) {
            const q = at(i);
            if (q !== null) p.hitSet.add(q);
        }
        p.dbTarget = at(a[n + 2]);
        p.iaiVictims = Array.isArray(a[n + 3]) ? a[n + 3].map(at).filter(q => q !== null) : [];
        if ((p.st === 'ATTACK' && p.cur === null) || (p.st === 'DEATHBLOW' && p.dbTarget === null) || p.st === 'DRAGON') p.toFree();
    }

    // ================= presentation =================
    updatePresentation(el) {
        const p = this.player, sw = this.canvas.width, sh = this.canvas.height;
        let tx = p.x, ty = p.y, tz = 0.95;
        if (!this.ffa) {
            const f = this.players[1 - this.localIdx];
            tx = (p.x + f.x) / 2;
            ty = (p.y + f.y) / 2;
            tz = U.clamp(Math.min(sw / (Math.abs(p.x - f.x) + 460), sh / (Math.abs(p.y - f.y) + 380)), 0.55, 1.15);
        } else {
            // a crowded arena follows you, but pulls back a little when someone is closing in
            const near = this.nearestFoe(p);
            if (near !== null) {
                tx = p.x * 0.72 + near.x * 0.28;
                ty = p.y * 0.72 + near.y * 0.28;
                tz = U.clamp(Math.min(sw / (Math.abs(p.x - near.x) + 620), sh / (Math.abs(p.y - near.y) + 520)), 0.6, 1.0);
            }
        }
        const k = 1 - Math.exp(-el * 5);
        this.camX += (tx - this.camX) * k;
        this.camY += (ty - this.camY) * k;
        this.camZ += (tz - this.camZ) * k;
        this.shakeAmt *= Math.exp(-el * 9);
        this.parryT -= el;
        this.zoomKickV *= Math.exp(-el * 5);
        this.flashA = Math.max(0, this.flashA - el * 2.5);
        this.realFx.updateImpact(el);
        for (let i = 0; i < this.n; i++) {
            const q = this.players[i];
            this.hpGhost[i] = this.hpGhost[i] > q.hp ? Math.max(q.hp, this.hpGhost[i] - el * 40) : q.hp;
        }
        const z = this.zoom();
        this.realFx.ambient(this.camX, this.camY, sw / z, sh / z, el, Math.sin(this.realTime * 0.2) * 20);
    }

    render() {
        const g = this.ctx, sw = this.canvas.width, sh = this.canvas.height;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = '#000';
        g.fillRect(0, 0, sw, sh);
        const z = this.zoom();
        const shx = (Math.random() - 0.5) * 2 * this.shakeAmt, shy = (Math.random() - 0.5) * 2 * this.shakeAmt;
        const shake = Preferences.value.shake / 100;
        g.save();
        g.translate(sw / 2, sh / 2);
        g.scale(z, z);
        g.translate(-this.camX + shx * shake, -this.camY + shy * shake);
        const l = this.camX - sw / 2 / z - 40, t = this.camY - sh / 2 / z - 40, r = this.camX + sw / 2 / z + 40, b = this.camY + sh / 2 / z + 40;
        this.drawArena(g, l, t, r, b);
        this.realFx.drawDecals(g);
        for (const p of this.players) {
            if (p.gone) continue;
            const c = this.colorOf(this.players.indexOf(p));
            setStroke(g, 2.5, false);
            g.strokeStyle = css(U.alpha(c, p.st === 'DEAD' ? 0.25 : 0.7));
            strokeEllipse(g, p.x - p.r - 8, p.y - p.r * 0.6 + 6, (p.r + 8) * 2, (p.r * 0.6 + 2) * 2);
        }
        const order = this.players.filter(p => !p.gone).sort((p, q) => (q.st === 'DEAD') - (p.st === 'DEAD') || p.y - q.y);
        for (const p of order) {
            p.drawAfterimage(g, this.time);
            p.draw(g, this.time);
        }
        this.realFx.drawWorld(g);
        this.realFx.drawPetals(g);
        for (const p of order) this.drawTag(g, p);
        this.realFx.drawTexts(g);
        this.players[this.localIdx].drawLock(g, this.realTime);
        g.restore();

        if (Preferences.value.flashes) this.drawParryBurst(g, sw, sh, z);
        if (Preferences.value.vignette) this.drawVignette(g, sw, sh);
        if (Preferences.value.flashes && this.flashA > 0) {
            g.fillStyle = css(U.alpha(this.flashColor, this.flashA * 0.6));
            g.fillRect(0, 0, sw, sh);
        }
        this.drawHud(g, sw, sh);
        this.realFx.drawImpact(g, sw, sh, this.camX, this.camY, z);
    }

    drawArena(g, l, t, r, b) {
        const R = this.arenaR;
        g.fillStyle = 'rgb(38,52,34)';
        g.fillRect(l, t, r - l, b - t);
        g.fillStyle = 'rgb(84,70,48)';
        fillCircle(g, 0, 0, R + 30);
        const grad = g.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
        grad.addColorStop(0, 'rgb(196,178,136)');
        grad.addColorStop(1, 'rgb(160,140,100)');
        g.fillStyle = grad;
        fillCircle(g, 0, 0, R);
        setStroke(g, 1.5, false);
        g.strokeStyle = 'rgba(110,92,62,0.28)';
        for (let rr = 70; rr < R; rr += 55) {
            g.beginPath();
            g.arc(0, 0, rr, 0, TAU);
            g.stroke();
        }
        // one starting mark per fighter, around the ring
        setStroke(g, 6, false);
        g.strokeStyle = 'rgba(245,240,225,0.75)';
        for (let i = 0; i < this.n; i++) {
            const a = i / this.n * TAU, sx = Math.cos(a) * R * 0.62, sy = Math.sin(a) * R * 0.62;
            strokeLine(g, sx - Math.sin(a) * 34, sy + Math.cos(a) * 34, sx + Math.sin(a) * 34, sy - Math.cos(a) * 34);
        }
        // sacred rope
        setStroke(g, 7, true);
        g.strokeStyle = 'rgb(232,222,196)';
        g.beginPath();
        g.arc(0, 0, R + 6, 0, TAU);
        g.stroke();
        g.fillStyle = 'rgb(250,250,245)';
        for (let i = 0; i < 24; i++) {
            const a = i / 24 * TAU, x = Math.cos(a) * (R + 6), y = Math.sin(a) * (R + 6);
            g.beginPath();
            g.moveTo(x - 4, y);
            g.lineTo(x + 4, y + 6);
            g.lineTo(x - 3, y + 12);
            g.lineTo(x + 3, y + 18);
            g.lineTo(x - 2, y + 18);
            g.closePath();
            g.fill();
        }
        // stone lanterns
        for (let i = 0; i < 8; i++) {
            const a = (i + 0.5) / 8 * TAU, x = Math.cos(a) * (R + 90), y = Math.sin(a) * (R + 90);
            const glow = g.createRadialGradient(x, y, 0, x, y, 90);
            glow.addColorStop(0, css(rgb(255, 190, 110, Math.trunc(80 + 20 * Math.sin(this.realTime * 3 + i)))));
            glow.addColorStop(1, 'rgba(255,190,110,0)');
            g.fillStyle = glow;
            fillCircle(g, x, y, 90);
            g.fillStyle = 'rgb(110,110,104)';
            g.fillRect(x - 13, y - 13, 26, 26);
            g.fillStyle = 'rgb(255,214,140)';
            g.fillRect(x - 6, y - 6, 12, 12);
            g.fillStyle = 'rgb(80,80,76)';
            g.fillRect(x - 17, y - 19, 34, 7);
        }
    }

    drawTag(g, p) {
        if (p.st === 'DEAD' || p.gone) return;
        const i = this.players.indexOf(p), you = i === this.localIdx;
        g.font = 'bold 12px sans-serif';
        this.text(g, you ? 'YOU' : this.ffa ? 'P' + (i + 1) : 'FOE', p.x, p.y - p.r - 22, this.colorOf(i), true);
        if (p.brokenT > 0) {
            const pulse = 0.6 + 0.4 * Math.sin(this.realTime * 14);
            g.fillStyle = css(rgb(220, 20, 20, Math.trunc(255 * pulse)));
            fillCircle(g, p.x, p.y - p.r - 44, 9);
            setStroke(g, 2, false);
            g.strokeStyle = 'rgba(255,255,255,0.9)';
            g.beginPath();
            g.arc(p.x, p.y - p.r - 44, 12, 0, TAU);
            g.stroke();
        }
    }

    drawFighterBars(g, p, x, y, w, label, color, wins, right) {
        g.font = 'bold 18px serif';
        this.text(g, label, right ? x + w - g.measureText(label).width : x, y - 8, color, false);
        for (let i = 0; i < Math.min(this.roundsToWin, 9); i++) {
            const cx = right ? x + 10 + i * 20 : x + w - 10 - i * 20;
            g.fillStyle = i < wins ? 'rgb(255,210,90)' : 'rgba(0,0,0,0.6)';
            fillCircle(g, cx, y - 14, 7);
            setStroke(g, 1.5, false);
            g.strokeStyle = 'rgb(255,225,160)';
            g.beginPath();
            g.arc(cx, y - 14, 7, 0, TAU);
            g.stroke();
        }
        const idx = this.players.indexOf(p);
        const fill = (frac, c) => {
            const fw = Math.trunc(w * U.clamp(frac, 0, 1));
            g.fillStyle = c;
            g.fillRect(right ? x + w - fw : x, y, fw, 12);
        };
        g.fillStyle = 'rgba(0,0,0,0.667)';
        g.fillRect(x - 2, y - 2, w + 4, 16);
        fill(this.hpGhost[idx] / p.maxHp, 'rgb(230,220,200)');
        fill(p.hp / p.maxHp, 'rgb(190,30,34)');
        Draw.postureBar(g, x + w / 2, y + 26, w, 6, p.posture / p.maxPosture, p.brokenT > 0);
        g.fillStyle = 'rgba(0,0,0,0.667)';
        g.fillRect(x - 2, y + 40, w + 4, 7);
        g.fillStyle = p.ki >= 100 ? 'rgb(150,210,255)' : 'rgb(70,120,210)';
        const kw = Math.trunc(w * p.ki / 100);
        g.fillRect(right ? x + w - kw : x, y + 42, kw, 3);
    }

    /** Free-for-all replaces the opponent bar with a compact standings list. */
    drawScoreboard(g, sw) {
        const w = 150, x = sw - 28 - w;
        g.font = 'bold 14px serif';
        this.text(g, 'FIRST TO ' + this.roundsToWin, x, 40, rgb(230, 220, 205), false);
        for (let i = 0; i < this.n; i++) {
            const p = this.players[i], y = 58 + i * 24, out = p.gone;
            const c = out ? rgb(120, 115, 110) : this.colorOf(i);
            g.font = SMALL_FONT;
            this.text(g, this.nameOf(i) + (out ? '  (left)' : ''), x, y, c, false);
            this.text(g, String(this.score[i]), sw - 28 - g.measureText(String(this.score[i])).width, y, rgb(255, 210, 90), false);
            g.fillStyle = 'rgba(0,0,0,0.6)';
            g.fillRect(x, y + 4, w, 5);
            if (!out) {
                g.fillStyle = p.st === 'DEAD' ? 'rgb(90,30,30)' : 'rgb(190,30,34)';
                g.fillRect(x, y + 4, Math.trunc(w * U.clamp(p.hp / p.maxHp, 0, 1)), 5);
            }
        }
    }

    drawHud(g, sw, sh) {
        const me = this.player, w = Math.min(380, sw / 2 - 150);
        this.drawFighterBars(g, me, 28, 44, w, 'You', YOU_COLOR, this.score[this.localIdx], false);
        if (this.ffa) this.drawScoreboard(g, sw);
        else {
            const foeIdx = 1 - this.localIdx;
            this.drawFighterBars(g, this.players[foeIdx], sw - 28 - w, 44, w, 'Opponent', FOE_COLOR, this.score[foeIdx], true);
        }
        g.font = 'bold 20px serif';
        this.text(g, 'ROUND ' + this.round, sw / 2, 40, rgb(245, 235, 215), true);
        const ping = Math.round(this.link.ping());
        g.font = SMALL_FONT;
        this.text(g, 'Ping ' + ping + ' ms   -   input delay ' + Math.round(this.delay * DT * 1000) + ' ms', sw / 2, 60,
            ping > LAG_PAUSE_MS * 0.8 ? rgb(255, 150, 110) : rgb(190, 180, 165), true);
        if (this.ffa) {
            g.font = SMALL_FONT;
            this.text(g, this.standing().length + ' still standing', sw / 2, 78, rgb(210, 200, 185), true);
        }

        // own resources
        const hx = 28, hy = sh - 70;
        for (let i = 0; i < me.maxGourds; i++) {
            const have = i < me.gourds, gx = hx + i * 24;
            g.fillStyle = have ? 'rgb(220,130,50)' : 'rgb(70,70,70)';
            fillEllipse(g, gx, hy + 6, 16, 16);
            fillEllipse(g, gx + 3, hy, 10, 10);
        }
        g.font = SMALL_FONT;
        this.text(g, '[' + Preferences.label('heal') + '] heal', hx + me.maxGourds * 24 + 8, hy + 18, rgb(220, 200, 170), false);
        this.text(g, '[' + Preferences.label('throw') + '] Shuriken ' + me.throws + '/' + me.maxThrows, hx, hy + 42,
            me.throws ? me.throwable.color : rgb(150, 140, 130), false);
        const art = me.art, canArt = me.artCharges >= art.cost;
        g.font = 'bold 15px serif';
        this.text(g, art.name + '  ' + me.artCharges + '/' + art.cost
            + (canArt ? '  READY  [' + Preferences.label('art') + '] / Block + Attack' : '  (deflect to charge)'),
            hx, hy - 16, canArt ? art.color : rgb(150, 140, 130), false);
        if (me.ki >= 100) {
            g.font = HUD_FONT;
            this.text(g, '[' + Preferences.label('iai') + '] IAI FLASH READY', hx, hy - 38, rgb(170, 220, 255), false);
        }
        g.font = SMALL_FONT;
        const help = Preferences.label('attack') + ' attack | ' + Preferences.label('guard') + ' deflect / block | '
            + Preferences.label('dodge') + ' dodge / sprint | ' + Preferences.label('pause') + ' twice to leave';
        this.text(g, help, sw - 28 - g.measureText(help).width, sh - 20, rgb(180, 170, 150), false);
        if (me.deflectStreak >= 2) {
            g.font = 'bold 26px serif';
            this.text(g, me.deflectStreak + ' DEFLECT CHAIN', sw / 2, sh - 100, rgb(255, 215, 100), true);
        }
        if (this.phase === 'FIGHT' && me.st !== 'DEAD' && this.deathblowTarget(me) !== null) {
            g.font = 'bold 20px serif';
            this.text(g, '[' + Preferences.label('attack') + ']  DEATHBLOW', sw / 2, sh - 70, rgb(255, 90, 80), true);
        }
        this.drawPhase(g, sw, sh);
        if (this.leaveConfirmT > 0 && this.lostMsg === null) {
            g.font = HUD_FONT;
            this.text(g, 'Press ' + Preferences.label('pause') + ' again to leave the match', sw / 2, 112, rgb(255, 150, 120), true);
        }
        this.drawConnection(g, sw, sh);
    }

    drawPhase(g, sw, sh) {
        const cy = sh / 2 - 60;
        if (this.phase === 'COUNTDOWN') {
            const n = Math.max(1, Math.ceil(3 - this.phaseT));
            g.font = TITLE_FONT;
            this.text(g, 'ROUND ' + this.round, sw / 2, cy - 40, rgb(245, 235, 215), true);
            g.font = BIG_KANJI;
            this.text(g, String(n), sw / 2, cy + 110, rgb(255, 220, 150), true);
        } else if (this.phase === 'FIGHT' && this.phaseT < 0.9) {
            const a = U.clamp(1 - this.phaseT / 0.9, 0, 1);
            g.font = BIG_KANJI;
            this.text(g, '\u65ac', sw / 2, cy + 60, U.alpha(rgb(230, 50, 40), a), true);
            g.font = TITLE_FONT;
            this.text(g, 'FIGHT', sw / 2, cy + 120, U.alpha(WHITE, a), true);
        } else if (this.phase === 'KO') {
            const a = U.clamp(this.phaseT * 3, 0, 1);
            const won = this.lastKo === this.localIdx, draw = this.lastKo === -1;
            const lost = !won && !draw;
            g.fillStyle = css(rgb(0, 0, 0, Math.trunc(110 * a)));
            g.fillRect(0, cy - 60, sw, 90);
            g.font = TITLE_FONT;
            const msg = draw ? 'DOUBLE KO' : won ? 'ROUND WON' : this.ffa ? this.nameOf(this.lastKo) + ' TAKES THE ROUND' : 'ROUND LOST';
            this.text(g, msg, sw / 2, cy, U.alpha(draw ? WHITE : won ? rgb(255, 215, 120) : rgb(230, 70, 60), a), true);
            if (lost && this.ffa) {
                g.font = SUB_FONT;
                this.text(g, 'Next round starts shortly', sw / 2, cy + 36, U.alpha(rgb(220, 210, 200), a), true);
            }
        } else if (this.phase === 'MATCH_OVER') {
            const best = Math.max(...this.score);
            const won = this.score[this.localIdx] === best && this.score.filter(s => s === best).length === 1;
            g.fillStyle = 'rgba(0,0,0,0.55)';
            g.fillRect(0, 0, sw, sh);
            g.font = BIG_KANJI;
            this.text(g, won ? '\u52dd' : '\u6557', sw / 2, cy + 30, won ? rgb(255, 205, 100) : rgb(200, 30, 30), true);
            g.font = TITLE_FONT;
            this.text(g, won ? 'VICTORY' : 'DEFEAT', sw / 2, cy + 100, WHITE, true);
            g.font = SUB_FONT;
            this.text(g, this.score.map((s, i) => this.nameOf(i) + ' ' + s).join('   -   '), sw / 2, cy + 136, rgb(230, 220, 210), true);
            const meReady = this.ready[this.localIdx];
            const waiting = this.players.reduce((n, p, i) => n + (!p.gone && !this.ready[i] ? 1 : 0), 0);
            g.font = HUD_FONT;
            this.text(g, meReady ? 'Waiting for ' + waiting + ' more...  (' + Preferences.label('ready') + ' to cancel)'
                : 'Press ' + Preferences.label('ready') + ' for a rematch', sw / 2, cy + 180,
                rgb(255, 220, 150, Math.trunc(160 + 90 * Math.sin(this.realTime * 4))), true);
            g.font = SMALL_FONT;
            this.text(g, Preferences.label('pause') + ' twice to return to the main menu', sw / 2, cy + 212, rgb(190, 180, 165), true);
        }
    }

    drawConnection(g, sw, sh) {
        if (this.lostMsg !== null) {
            g.fillStyle = 'rgba(10,8,8,0.85)';
            g.fillRect(0, 0, sw, sh);
            g.font = TITLE_FONT;
            this.text(g, 'DUEL ENDED', sw / 2, sh / 2 - 20, rgb(230, 60, 50), true);            g.font = SUB_FONT;
            this.text(g, this.lostMsg, sw / 2, sh / 2 + 20, rgb(230, 220, 210), true);
            g.font = HUD_FONT;
            this.text(g, 'Press ' + Preferences.label('ready') + ' to return to the main menu', sw / 2, sh / 2 + 60, rgb(255, 220, 150), true);
            return;
        }
        if (this.lagPaused || this.resumeT > 0) {
            g.fillStyle = 'rgba(0,0,0,0.6)';
            g.fillRect(0, 0, sw, sh);
            g.font = TITLE_FONT;
            if (this.lagPaused) {
                this.text(g, 'CONNECTION UNSTABLE', sw / 2, sh / 2 - 10, rgb(255, 150, 110), true);
                g.font = SUB_FONT;
                this.text(g, 'The duel is paused until the connection recovers  -  ping ' + Math.round(this.link.ping()) + ' ms', sw / 2,
                    sh / 2 + 30, rgb(230, 220, 210), true);
            } else {
                this.text(g, 'Resuming in ' + this.resumeT.toFixed(1), sw / 2, sh / 2, rgb(200, 235, 190), true);
            }
        } else if (this.stallT > 0.35) {
            g.font = HUD_FONT;
            this.text(g, 'Waiting for opponent...', sw / 2, 90, rgb(255, 180, 120), true);
        }
    }
}

// shared screen-space drawing helpers
for (const m of ['text', 'drawParryBurst', 'drawVignette', 'makeVignette']) Duel.prototype[m] = Game.prototype[m];
