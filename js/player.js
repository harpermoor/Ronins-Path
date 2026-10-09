'use strict';

const P_IGNORE = 0, P_DEFLECT = 1, P_BLOCK = 2, P_HIT = 3, P_PERFECT = 4, P_PERFECT_DODGE = 5,
    P_BUDDHA_MIKIRI = 6, P_BUDDHA_SWEEP = 7;
const PERFECT_WINDOW = 0.18, DODGE_TIME = 0.34, DODGE_IFRAMES = 0.25;
const BUDDHA_SPEED = 0.8;
const PERFECT_PARRY_WINDOW = 0.05;
const PERFECT_DODGE_WINDOW = 0.06;
const BUDDHA_PARRY_WINDOW = 0.14, BUDDHA_DODGE_WINDOW = 0.1;
const HEAVY_STAB_HOLD = 0.36;
const GOURD_HEAL_TIME = 0.25, GOURD_HEAL_END = 0.45;
const DEATHBLOW_TIMINGS = {
    katana: { impact: 0.13, duration: 0.55 },
    spear: { impact: 0.24, duration: 0.68 },
    hammer: { impact: 0.38, duration: 0.85 },
    axe: { impact: 0.3, duration: 0.75 },
};
const P_COMBO = [
    new Attack('cut1', 0.08, 0.09, 0.20, 84, 150, 14, 12, 190),
    new Attack('cut2', 0.07, 0.09, 0.20, 84, 150, 14, 12, 190),
    new Attack('cut3', 0.15, 0.11, 0.34, 98, 230, 24, 22, 280),
];
const P_STAB = new Attack('heavy-stab', 0.72, 0.18, 0.68, 126, 34, 30, 14, 560).markPerilous().markThrust();

function projectileTarget(p, atk, foes, world) {
    const dx = Math.cos(p.facing), dy = Math.sin(p.facing);
    let target = null, range = atk.range;
    for (const foe of foes) {
        if (foe.st === 'DEAD') continue;
        const vx = foe.x - p.x, vy = foe.y - p.y, along = vx * dx + vy * dy;
        const across = vx * dy - vy * dx, radius = foe.r + 3;
        if (along < p.r || along > range + radius || Math.abs(across) > radius) continue;
        const hit = along - Math.sqrt(radius * radius - across * across);
        if (hit < range) {
            target = foe;
            range = Math.max(p.r, hit);
        }
    }
    if (world.solidAt) for (let d = p.r + 4; d <= range; d += 6) {
        if (world.solidAt(p.x + dx * d, p.y + dy * d)) return { target: null, range: d };
    }
    return { target, range };
}

// Player states: 'FREE' | 'ATTACK' | 'THROW' | 'ART' | 'DRAGON' | 'DODGE' | 'STAGGER' | 'HEAL' | 'DEATHBLOW' | 'MIKIRI' | 'IAI' | 'DEAD'
class Player extends Actor {
    constructor(g, x, y) {
        super();
        this.g = g;
        this.x = x;
        this.y = y;
        this.r = 15;
        this.maxHp = this.hp = 100;
        this.maxPosture = 100;
        this.facing = -Math.PI / 2;
        this.st = 'FREE';
        this.stT = 0;
        this.speed = 245;
        this.vx = 0;
        this.vy = 0;
        // input snapshot
        this.moveX = 0;
        this.moveY = 0;
        this.aimX = 0;
        this.aimY = 0;
        this.guardHeld = false;
        this.bufAttack = 0;
        this.bufParry = 0;
        this.bufDodge = 0;
        this.bufHeal = 0;
        this.bufIai = 0;
        this.bufArt = 0;
        this.bufDragon = 0;
        this.bufStab = 0;
        this.bufThrow = 0;
        this.throwDone = false;
        this.mouseAttackPending = false;
        // combat art
        this.curArt = null;
        this.curArtAtks = null;
        this.artIdx = 0;
        this.artAtk = null;
        this.artAtkEnd = 0;
        this.dragonAtk = null;
        this.dragonDone = false;
        // attack
        this.combo = -1;
        this.stabAttack = false;
        this.stabAtk = null;
        this.swingId = 0;
        this.phase = 0;
        this.swingSign = 1;
        this.cur = null;
        this.hitSet = new Set();
        this.comboGrace = 0;
        this.poise = 0;
        this.poiseLeft = 0;
        this.artHitsLeft = 0;
        this.lockTarget = null;
        this.lastDmgTaken = 0;
        // guard / deflect
        this.guarding = false;
        this.guardStart = -99;
        this.guardWindow = PERFECT_WINDOW;
        this.spam = 0;
        this.deflectStreak = 0;
        this.deflectStreakT = 0;
        this.guardFlash = 0;
        // misc
        this.dodgeDx = 0;
        this.dodgeDy = 0;
        this.dodgeStartX = x;
        this.dodgeStartY = y;
        this.afterimage = null;
        this.dodgeHeld = false;
        this.sprinting = false;
        this.invuln = 0;
        this.staggerDur = 0;
        this.hurtFlash = 0;
        this.postureCd = 0;
        this.walkAnim = 0;
        this.scarf = 0;
        this.baseMaxHp = 100;
        this.baseGourds = 3;
        this.gourds = 0;
        this.throws = 0;
        this.artCharges = 0;
        this.healed = false;
        this.ki = 0;
        this.lastStandUsed = false;
        this.buddhaReviveReady = false;
        this.buddhaDeathblows = 0;
        this.dbTarget = null;
        this.dbDone = false;
        this.iaiSx = 0;
        this.iaiSy = 0;
        this.iaiDx = 0;
        this.iaiDy = 0;
        this.iaiDone = false;
        this.iaiLine = false;
        this.iaiVictims = [];
        this.deadT = 0;
        this.applyLoadout();
        this.hp = this.maxHp;
        this.gourds = this.maxGourds;
        this.throws = this.maxThrows;
    }

    /** Recompute stats and attacks from the equipped gear and learned skills. */
    applyLoadout() {
        const lo = this.g.loadout, s = computeStats(lo, this.baseMaxHp, this.baseGourds, this.g.skills);
        // an online match hands every fighter the same host-chosen stats, so gear and skills never decide a duel
        const mods = this.g.statMods;
        if (mods) {
            s.maxHp = mods.hp;
            s.maxPosture = mods.posture;
            s.gourds = mods.gourds;
            s.charges = mods.charges;
            s.move *= mods.speed;
            s.deflect = mods.parry;
        } else {
            const blessing = 1 + 0.1 * (this.g.javaBlessings || 0);
            s.dmg *= blessing;
            s.post *= blessing;
        }
        const enlightened = this.enlightened();
        const buddhaPower = this.buddhaPower();
        if (buddhaPower) {
            s.dmg *= 5;
            s.post *= 5;
        }
        this.maxHp = s.maxHp;
        this.hp = Math.min(this.hp, this.maxHp);
        this.maxPosture = s.maxPosture;
        this.maxGourds = s.gourds;
        this.gourds = Math.min(this.gourds, this.maxGourds);
        this.throwable = lo.throwableDef();
        this.maxThrows = this.throwable.max;
        this.throws = Math.min(this.throws, this.maxThrows);
        this.maxArtCharges = s.charges;
        this.artCharges = Math.min(this.artCharges, this.maxArtCharges);
        this.speed = 245 * s.move;
        this.perfectWindow = s.deflect;
        this.guardWindow = s.deflect;
        this.dmgTaken = s.def;
        this.stealth = s.stealth;
        this.deathblowHeal = s.deathblowHeal;
        this.deflectPost = s.deflectPost;
        this.deflectRecover = s.deflectRecover;
        this.dodgeIframes = s.iframes * (enlightened ? BUDDHA_SPEED : 1);
        this.dragonFlash = s.dragonFlash;
        this.lastStand = s.lastStand;
        this.poise = s.poise;
        this.dragonDamage = 58 * s.dmg * s.artDmg;
        this.sword = lo.swordDef();
        this.comboAtk = (this.sword.combo || P_COMBO).map((a, i) => {
            const b = scaledAttack(a, s);
            if (enlightened) {
                b.windup *= BUDDHA_SPEED;
                b.active *= BUDDHA_SPEED;
                b.recovery *= BUDDHA_SPEED;
            }
            b.heavy = i === 2;
            return b;
        });
        const heavy = weaponType(this.sword) === 'hammer' || weaponType(this.sword) === 'axe'
            ? new Attack('heavy-smash', 0.72, 0.18, 0.68, 110, 110, 36, 38, 350).markPerilous() : P_STAB;
        this.stabAtk = scaledAttack(heavy, s);
        if (enlightened) {
            this.stabAtk.windup *= BUDDHA_SPEED;
            this.stabAtk.active *= BUDDHA_SPEED;
            this.stabAtk.recovery *= BUDDHA_SPEED;
        }
        this.throwAtk = new Attack(this.throwable.id, 0, 0, 0, this.throwable.range, 0,
            this.throwable.damage * s.dmg, this.throwable.posture * s.post, 0);
        const realityRendEquipped = lo.art === REALITY_TEAR_ART.id;
        this.art = realityRendEquipped
            ? (this.g.ultimate === true && !this.g.statMods ? REALITY_TEAR_ART : ARTS[0])
            : lo.artDef();
        const artStats = Object.assign({}, s, { dmg: s.dmg * s.artDmg });
        this.artAtks = this.art.hits.map(h => scaledAttack(h.atk, artStats));
        if (enlightened) for (const atk of [...this.comboAtk, this.stabAtk, ...this.artAtks]) atk.range *= 1.5;
    }

    sneaking() { return this.st === 'FREE' && this.guarding && Math.hypot(this.vx, this.vy) < 160; }

    enlightened() { return this.g.buddha === true && !this.g.statMods; }

    buddhaPower() { return this.enlightened() && this.g.difficultyTier === 'buddha'; }

    dodgeDuration() { return DODGE_TIME * (this.enlightened() ? BUDDHA_SPEED : 1); }

    guardDuration() { return this.guardWindow * (this.buddhaPower() ? 5 / 3 : 1); }

    refillBuddhaRevive() {
        if (!this.buddhaPower()) return;
        this.buddhaReviveReady = true;
        this.buddhaDeathblows = 0;
    }

    recordDeathblow() {
        if (!this.buddhaPower() || this.buddhaReviveReady) return;
        this.buddhaDeathblows++;
        if (this.buddhaDeathblows >= 5) {
            this.refillBuddhaRevive();
            this.g.fx.text('BUDDHA REVIVE READY', this.x, this.y - 64, rgb(255, 235, 150), 16);
            this.g.fx.ring(this.x, this.y, 10, 75, 0.5, 4, rgb(255, 225, 120));
        }
    }

    /** Enemies hold off while a deathblow plays out. */
    untargetable() { return this.st === 'DEATHBLOW'; }

    invulnerable() {
        const st = this.st;
        const art = this.curArt;
        return this.g.devGodMode === true || this.invuln > 0 || st === 'DEATHBLOW' || st === 'MIKIRI' || st === 'IAI'
            || (st === 'DODGE' && this.stT < this.dodgeIframes)
            || (st === 'ART' && art.iframes !== undefined && this.stT >= art.iframes[0] && this.stT < art.iframes[1]);
    }

    readInput(inp, wx, wy) {
        const aim = this.lockAim(inp, wx, wy, this.g.enemies);
        wx = aim.x;
        wy = aim.y;
        let mx = 0, my = 0;
        if (inp.down('moveUp')) my -= 1;
        if (inp.down('moveDown')) my += 1;
        if (inp.down('moveLeft')) mx -= 1;
        if (inp.down('moveRight')) mx += 1;
        const l = Math.hypot(mx, my);
        this.moveX = l > 0 ? mx / l : 0;
        this.moveY = l > 0 ? my / l : 0;
        this.aimX = wx;
        this.aimY = wy;
        this.guardHeld = inp.down('guard');
        this.dodgeHeld = inp.down('dodge');
        if (inp.hit('quickAttack')) this.bufAttack = 0.22;
        if (inp.hit('attack')) this.mouseAttackPending = true;
        if (this.mouseAttackPending && inp.heldFor('attack') >= HEAVY_STAB_HOLD) {
            this.mouseAttackPending = false;
            this.bufStab = 0.2;
        } else if (this.mouseAttackPending && !inp.down('attack')) {
            this.mouseAttackPending = false;
            this.bufAttack = 0.22;
        }
        if (inp.hit('guard')) this.bufParry = 0.15;
        if (inp.hit('dodge')) this.bufDodge = 0.18;
        if (inp.hit('heal')) this.bufHeal = 0.12;
        if (inp.hit('iai')) this.bufIai = 0.15;
        if (inp.hit('art')) this.bufArt = 0.2;
        if (inp.hit('dragon')) this.bufDragon = 0.15;
        if (inp.hit('throw')) this.bufThrow = 0.2;
    }

    lockAim(inp, wx, wy, foes) {
        const valid = e => e !== this && e.st !== 'DEAD' && !e.gone && !e.beingExecuted && this.distTo(e) <= 650;
        if (this.st === 'DEAD' || (this.lockTarget && (!foes.includes(this.lockTarget) || !valid(this.lockTarget)))) this.lockTarget = null;
        if (this.st !== 'DEAD' && inp.hit('lockOn')) {
            if (this.lockTarget) this.lockTarget = null;
            else {
                let nearest = 550;
                for (const e of foes) {
                    const d = this.distTo(e);
                    if (valid(e) && d < nearest) {
                        nearest = d;
                        this.lockTarget = e;
                    }
                }
            }
        }
        return this.lockTarget || { x: wx, y: wy };
    }

    drawLock(g2, time) {
        const e = this.lockTarget;
        if (!e || e.st === 'DEAD' || e.gone || this.st === 'DEAD') return;
        const r = e.r + 12 + Math.sin(time * 6) * 2;
        g2.save();
        g2.strokeStyle = '#ffe0a0';
        g2.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2 + Math.PI / 4;
            g2.beginPath();
            g2.arc(e.x, e.y, r, a - 0.2, a + 0.2);
            g2.stroke();
        }
        g2.fillStyle = '#ffe0a0';
        fillCircle(g2, e.x, e.y - r - 8, 3);
        g2.restore();
    }

    update(dt) {
        const g = this.g;
        this.stT += dt;
        this.bufAttack -= dt;
        this.bufParry -= dt;
        this.bufDodge -= dt;
        this.bufHeal -= dt;
        this.bufIai -= dt;
        this.bufArt -= dt;
        this.bufDragon -= dt;
        this.bufStab -= dt;
        this.bufThrow -= dt;
        this.invuln -= dt;
        this.hurtFlash -= dt;
        this.guardFlash -= dt;
        this.comboGrace -= dt;
        this.postureCd -= dt;
        if ((this.deflectStreakT -= dt) <= 0) this.deflectStreak = 0;
        this.spam = Math.max(0, this.spam - dt * 2.2);
        this.ki = U.clamp(this.ki, 0, 100);
        if (this.st === 'DEAD') {
            this.deadT += dt;
            return;
        }
        if (this.postureCd <= 0 && this.st !== 'STAGGER') {
            const rate = (this.guarding ? 34 : 17) * (0.4 + 0.6 * this.hp / this.maxHp);
            this.posture = Math.max(0, this.posture - rate * dt);
        }
        const aimAng = Math.atan2(this.aimY - this.y, this.aimX - this.x);
        this.scarf += dt * (4 + Math.hypot(this.vx, this.vy) / 40);
        if (this.st !== 'FREE') this.sprinting = false;
        switch (this.st) {
            case 'FREE': this.free(dt, aimAng); break;
            case 'ATTACK': this.attack(dt, aimAng); break;
            case 'THROW': this.throwUpdate(); break;
            case 'ART': this.artUpdate(dt, aimAng); break;
            case 'DRAGON': this.dragonUpdate(dt); break;
            case 'DODGE': {
                const dodgeTime = this.dodgeDuration();
                const t = this.stT / dodgeTime;
                const sp = 660 * Math.pow(Math.max(0, 1 - t), 1.4) + 40;
                this.vx = this.dodgeDx * sp;
                this.vy = this.dodgeDy * sp;
                this.move(g.world, this.vx * dt, this.vy * dt);
                if (this.stT > dodgeTime * (0.2 / DODGE_TIME) && this.bufAttack > 0) {
                    this.bufAttack = 0;
                    this.beginAttackOrDeathblow(0);
                } else if (this.bufParry > 0) {
                    this.bufParry = 0;
                    this.startGuard();
                } else if (this.stT >= dodgeTime) this.toFree();
                break;
            }
            case 'MIKIRI':
                if (this.stT < 0.1) this.move(g.world, Math.cos(this.facing) * 200 * dt, Math.sin(this.facing) * 200 * dt);
                if (this.stT > 0.3 && this.bufAttack > 0) {
                    this.bufAttack = 0;
                    this.beginAttackOrDeathblow(0);
                } else if (this.stT >= 0.45) this.toFree();
                break;
            case 'STAGGER': {
                this.move(g.world, this.vx * dt, this.vy * dt);
                const k = Math.exp(-dt * 8);
                this.vx *= k;
                this.vy *= k;
                if (this.stT >= this.staggerDur) this.toFree();
                break;
            }
            case 'HEAL':
                this.facing = U.turn(this.facing, aimAng, dt * 10);
                this.vx = U.lerp(this.vx, this.moveX * this.speed * 0.35, 1 - Math.exp(-dt * 16));
                this.vy = U.lerp(this.vy, this.moveY * this.speed * 0.35, 1 - Math.exp(-dt * 16));
                this.move(g.world, this.vx * dt, this.vy * dt);
                if (this.stT >= GOURD_HEAL_TIME && !this.healed) {
                    this.healed = true;
                    this.gourds--;
                    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.5);
                    g.fx.heal(this.x, this.y);
                    g.sfx.play('HEAL');
                }
                if (this.stT >= GOURD_HEAL_END) this.toFree();
                break;
            case 'DEATHBLOW': {
                const e = this.dbTarget;
                const type = weaponType(this.sword), timing = DEATHBLOW_TIMINGS[type];
                this.facing = this.angleTo(e);
                const tx = e.x - Math.cos(this.facing) * (e.r + this.r + 6), ty = e.y - Math.sin(this.facing) * (e.r + this.r + 6);
                const k = 1 - Math.exp(-dt * 25);
                this.x += (tx - this.x) * k;
                this.y += (ty - this.y) * k;
                g.world.resolve(this);
                if (this.stT >= timing.impact && !this.dbDone) {
                    this.dbDone = true;
                    if (type === 'spear') g.fx.thrust(this.x, this.y, this.facing,
                        this.distTo(e) + e.r, 0.3, 14, this.sword.color);
                    else if (type === 'hammer') {
                        g.fx.ring(e.x, e.y, 8, 100, 0.4, 6, this.sword.color);
                        g.fx.dust(e.x, e.y, 16);
                    } else if (type === 'axe') g.fx.slash(this.x, this.y, this.distTo(e) + e.r,
                        this.facing + 1.2, -2.4, 0.3, 14, this.sword.color);
                    g.executeDeathblow(this, e);
                }
                if (this.stT >= timing.duration) this.toFree();
                break;
            }
            case 'IAI': this.iai(dt); break;
        }
    }

    toFree() {
        this.st = 'FREE';
        this.stT = 0;
        this.throwDone = false;
    }
    free(dt, aimAng) {
        const g = this.g;
        this.facing = U.turn(this.facing, aimAng, dt * 22);
        if (this.bufParry > 0) {
            this.bufParry = 0;
            this.startGuard();
        }
        this.guarding = this.guardHeld || (g.time - this.guardStart < this.guardDuration());
        // holding the dodge button while moving sprints; tapping it still rolls
        this.sprinting = this.dodgeHeld && !this.guarding && (this.moveX !== 0 || this.moveY !== 0);
        const sp = this.speed * (this.guarding ? 0.5 : this.sprinting ? 1.5 : 1);
        this.vx = U.lerp(this.vx, this.moveX * sp, 1 - Math.exp(-dt * 16));
        this.vy = U.lerp(this.vy, this.moveY * sp, 1 - Math.exp(-dt * 16));
        this.move(g.world, this.vx * dt, this.vy * dt);
        this.walkAnim += Math.hypot(this.vx, this.vy) * dt;
        if (this.sprinting && g.rnd.nextDouble() < dt * 12) {
            g.fx.dust(this.x - Math.cos(this.facing) * this.r * 0.6, this.y - Math.sin(this.facing) * this.r * 0.6, 1);
        }
        if (this.bufAttack > 0) {
            this.bufAttack = 0;
            this.beginAttackOrDeathblow(this.comboGrace > 0 && this.combo >= 0 && this.combo < 2 ? this.combo + 1 : 0);
        } else if (this.bufThrow > 0) {
            this.bufThrow = 0;
            if (this.throws > 0) {
                this.st = 'THROW';
                this.stT = 0;
                this.throwDone = false;
                this.facing = aimAng;
                this.guarding = false;
                this.hitSet.clear();
            } else g.fx.text('Throwing weapons empty', this.x, this.y - 40, rgb(200, 200, 200), 13);
        } else if (this.bufStab > 0) {
            this.bufStab = 0;
            this.startStab(aimAng);
        } else if (this.bufArt > 0) {
            this.bufArt = 0;
            this.tryArt(aimAng);
        } else if (this.bufDodge > 0) {
            this.bufDodge = 0;
            this.startDodge();
        } else if (this.bufHeal > 0) {
            this.bufHeal = 0;
            if (this.gourds > 0 && this.hp < this.maxHp) {
                this.st = 'HEAL';
                this.stT = 0;
                this.healed = false;
                this.guarding = false;
            } else if (this.gourds <= 0) g.fx.text('Gourd empty', this.x, this.y - 40, rgb(200, 200, 200), 13);
        } else if (this.bufIai > 0) {
            this.bufIai = 0;
            if (this.ki >= 100) this.startIai(aimAng);
            else g.fx.text('Ki not full', this.x, this.y - 40, rgb(140, 180, 255), 13);
        } else if (this.bufDragon > 0) {
            this.bufDragon = 0;
            this.startDragon(aimAng);
        }
    }

    startGuard() {
        this.spam += 1;
        this.guardWindow = U.clamp(this.perfectWindow - Math.max(0, this.spam - 1.2) * 0.04, 0.05, this.perfectWindow);
        this.guardStart = this.g.time;
        this.guarding = true;
    }

    throwUpdate() {
        if (this.stT >= 0.14 && !this.throwDone) {
            this.throwDone = true;
            this.throws--;
            const t = this.throwable, g = this.g, dx = Math.cos(this.facing), dy = Math.sin(this.facing);
            const reach = g.projectileHitCheck(this, this.throwAtk);
            g.fx.line(this.x + dx * this.r, this.y + dy * this.r, this.x + dx * reach, this.y + dy * reach,
                0.22, t.id === 'throwingaxe' ? 5 : 2, t.color);
            g.sfx.play('SLASH');
        }
        if (this.stT >= 0.36) this.toFree();
    }

    beginAttackOrDeathblow(idx) {
        const t = this.g.deathblowTarget();
        if (t !== null) this.startDeathblow(t);
        else this.startAttack(idx);
    }

    startAttack(i) {
        this.st = 'ATTACK';
        this.stT = 0;
        this.phase = 0;
        this.combo = i;
        this.stabAttack = false;
        this.swingId++;
        this.cur = this.comboAtk[i];
        // heavy weapons keep swinging through hits worth up to this much damage; the finisher holds firmer
        this.poiseLeft = this.poise * (i === 2 ? 1.5 : 1);
        this.hitSet.clear();
        this.swingSign = i === 1 ? -1 : 1;
        this.guarding = false;
        this.facing = U.turn(this.facing, Math.atan2(this.aimY - this.y, this.aimX - this.x), 1.2);
    }

    startStab(aimAng) {
        this.st = 'ATTACK';
        this.stT = 0;
        this.phase = 0;
        this.combo = -1;
        this.stabAttack = true;
        this.swingId++;
        this.cur = this.stabAtk;
        this.poiseLeft = this.poise * 1.5;
        this.hitSet.clear();
        this.swingSign = 1;
        this.guarding = false;
        this.facing = aimAng;
    }

    attack(dt, aimAng) {
        const g = this.g, cur = this.cur;
        if (this.phase === 0) this.facing = U.turn(this.facing, aimAng, dt * 14);
        if (this.phase <= 1 && !(this.stabAttack && this.phase === 0)) {
            const sp = this.phase === 0 ? cur.lunge * 0.35 : cur.lunge * (1 - this.stT / cur.active);
            if (!g.enemyInFront(this, this.facing, this.r + 26)) this.move(g.world, Math.cos(this.facing) * sp * dt, Math.sin(this.facing) * sp * dt);
        }
        if (this.phase === 0) {
            if (this.bufParry > 0) {
                this.bufParry = 0;
                this.toFree();
                this.startGuard();
            } else if (this.bufDodge > 0) {
                this.bufDodge = 0;
                this.startDodge();
            } else if (this.stT >= cur.windup) {
                this.phase = 1;
                this.stT = 0;
                const swingSound = weaponType(this.sword) === 'spear' ? 'THRUST'
                    : weaponType(this.sword) === 'hammer' ? 'HAMMER_SWING'
                        : cur.perilous || this.combo === 2 ? 'HEAVY' : 'SLASH';
                g.sfx.play(swingSound);
                if (cur.thrust) {
                    const fx = Math.cos(this.facing), fy = Math.sin(this.facing);
                    const tx = this.x + fx * (cur.range + 10), ty = this.y + fy * (cur.range + 10);
                    g.fx.line(this.x + fx * this.r, this.y + fy * this.r, tx, ty, 0.24, 7, rgb(255, 55, 40));
                    g.fx.line(this.x + fx * (this.r + 8) - fy * 5, this.y + fy * (this.r + 8) + fx * 5,
                        tx - fy * 5, ty + fx * 5, 0.18, 2, rgb(255, 220, 170));
                    g.fx.sparks(tx, ty, this.facing + Math.PI, 1.4, 20, 520, rgb(255, 120, 55));
                    g.fx.ring(tx, ty, 4, 42, 0.28, 4, rgb(255, 80, 45));
                    g.fx.text('\u5371', this.x, this.y - this.r - 34, rgb(255, 40, 30), 26);
                    g.hitstop(0.045);
                    g.shake(8);
                    g.zoomKick(0.06);
                } else {
                    if (weaponType(this.sword) === 'spear') {
                        const fx = Math.cos(this.facing), fy = Math.sin(this.facing);
                        g.fx.thrust(this.x + fx * this.r, this.y + fy * this.r, this.facing,
                            cur.range * 0.82, 0.2, this.combo === 2 ? 20 : 14, rgb(180, 220, 255));
                    } else {
                        const start = this.facing + this.swingSign * cur.arc / 2;
                        g.fx.slash(this.x, this.y, cur.range * 0.82, start, -this.swingSign * cur.arc, 0.2,
                            this.combo === 2 ? 9 : 6, rgb(180, 220, 255));
                    }
                }
            }
        } else if (this.phase === 1) {
            g.playerHitCheck(this, cur);
            if (this.stT >= cur.active) {
                this.phase = 2;
                this.stT = 0;
            }
        } else {
            if (this.stT > 0.04 && this.bufArt > 0) {
                this.bufArt = 0;
                this.tryArt(aimAng);
            } else if (!this.stabAttack && this.stT > 0.04 && this.bufAttack > 0 && this.combo < 2) {
                this.bufAttack = 0;
                this.beginAttackOrDeathblow(this.combo + 1);
            } else if (this.bufParry > 0) {
                this.bufParry = 0;
                this.toFree();
                this.startGuard();
                this.comboGrace = 0.45;
            } else if (this.bufDodge > 0) {
                this.bufDodge = 0;
                this.startDodge();
            } else if (this.stT >= cur.recovery) {
                this.toFree();
                this.comboGrace = 0.4;
            }
        }
    }

    tryArt(aimAng) {
        const g = this.g, a = this.art;
        if (!artMatchesWeapon(a, this.sword)) {
            g.fx.text(a.name + ' requires the ' + findItem(SWORDS, a.weapon).name, this.x, this.y - 40, rgb(255, 190, 115), 13);
            g.sfx.play('BLOCK');
            return;
        }
        if (this.artCharges < a.cost) {
            g.fx.text('Deflect attacks to charge ' + a.name, this.x, this.y - 40, rgb(255, 215, 110), 13);
            return;
        }
        this.artCharges -= a.cost;
        this.swingId++;
        this.curArt = a;
        this.curArtAtks = this.artAtks;
        this.st = 'ART';
        this.stT = 0;
        this.artIdx = 0;
        this.artAtk = null;
        this.guarding = false;
        this.facing = aimAng;
        this.poiseLeft = this.artPoise(a);
        this.artHitsLeft = 2;
        g.fx.text(a.name, this.x, this.y - 50, a.color, 17);
        g.fx.ring(this.x, this.y, 8, 60, 0.3, 3, a.color);
        g.sfx.play('DODGE');
    }

    /** Hammers carry their weight through combat arts; the hammer's own art is near-unstoppable. */
    artPoise(a) {
        if (weaponType(this.sword) !== 'hammer') return 0;
        return this.poise * (a.weapon === 'hammer' ? 5 : 2.5);
    }

    /** Every art withstands two hits; hammers can carry on using their remaining poise. */
    artArmored(perilous) {
        const a = this.curArt;
        if (this.st !== 'ART' || !a || this.stT >= a.dur) return false;
        if (this.artHitsLeft > 0) return true;
        if (this.poiseLeft <= 0) return false;
        if (perilous && a.weapon !== 'hammer') return false;
        const last = a.hits[a.hits.length - 1];
        return this.stT <= last.t + 0.1;
    }

    gainArtCharge() {
        if (this.artCharges >= this.maxArtCharges) return;
        this.artCharges++;
        if (this.artCharges === this.art.cost) {
            this.g.fx.text(this.art.name + ' ready', this.x, this.y - 64, this.art.color, 15);
            this.g.fx.ring(this.x, this.y, 10, 50, 0.35, 3, this.art.color);
        }
    }

    artUpdate(dt, aimAng) {
        const g = this.g, a = this.curArt, t = this.stT;
        let approach = null;
        if (t < a.hits[0].t && a.hits[0].atk.range < 200) {
            let nearest = 360;
            for (const e of (g.foes || g.enemies)) {
                if (e.st === 'DEAD' || e.gone || e.beingExecuted) continue;
                const d = this.distTo(e);
                if (d < nearest && Math.abs(U.angDiff(aimAng, this.angleTo(e))) < 1.2) {
                    nearest = d;
                    approach = e;
                }
            }
            if (approach) aimAng = this.angleTo(approach);
        }
        if (t < a.hits[0].t) this.facing = U.turn(this.facing, aimAng, dt * 9);
        if (approach && !g.enemyInFront(this, this.facing, this.r + 20)) {
            const step = Math.min(Math.max(420, a.lunge ? a.lunge[2] : 0) * dt,
                Math.max(0, this.distTo(approach) - this.r - approach.r - 10));
            this.move(g.world, Math.cos(this.facing) * step, Math.sin(this.facing) * step);
            if (a.trail) g.fx.wisp(this.x, this.y, a.color);
        } else if (!approach && a.lunge && t >= a.lunge[0] && t < a.lunge[1] && !g.enemyInFront(this, this.facing, this.r + 20)) {
            this.move(g.world, Math.cos(this.facing) * a.lunge[2] * dt, Math.sin(this.facing) * a.lunge[2] * dt);
            if (a.trail) g.fx.wisp(this.x, this.y, a.color);
        }
        while (this.artIdx < a.hits.length && t >= a.hits[this.artIdx].t) {
            const h = a.hits[this.artIdx], atk = this.curArtAtks[this.artIdx];
            this.artIdx++;
            if (a.id === 'reality-tear') {
                g.openRealityTear(this);
                continue;
            }
            this.artAtk = atk;
            this.artAtkEnd = h.t + atk.active;
            this.hitSet.clear();
            g.sfx.play(a.motion === 'thrust' ? 'THRUST' : a.motion === 'slam' ? 'HAMMER_SWING' : 'HEAVY');
            const sweep = Math.min(atk.arc, TAU), f = this.facing;
            if (a.motion === 'thrust') {
                g.fx.thrust(this.x + Math.cos(f) * this.r, this.y + Math.sin(f) * this.r,
                    f, atk.range * 0.9, 0.24, 19, a.color);
                if (h.line) g.fx.sparks(this.x + Math.cos(f) * atk.range, this.y + Math.sin(f) * atk.range,
                    f + Math.PI, 0.45, 14, 420, a.color);
            } else if (a.motion === 'slam') {
                g.fx.slash(this.x, this.y, atk.range * 0.78, f + sweep / 2, -sweep, 0.3, 15, a.color);
                g.fx.ring(this.x + Math.cos(f) * 34, this.y + Math.sin(f) * 34, 8, atk.range, 0.42, 6, a.color);
                g.fx.sparks(this.x + Math.cos(f) * 48, this.y + Math.sin(f) * 48, f + Math.PI / 2,
                    2.2, 18, 300, rgb(225, 205, 165));
                g.shake(10);
                g.hitstop(0.085);
                g.zoomKick(0.05);
            } else {
                g.fx.slash(this.x, this.y, atk.range * 0.85, f + sweep / 2, -sweep, 0.25, 9, a.color);
            }
            if (h.line && a.motion !== 'thrust') {
                g.fx.line(this.x, this.y, this.x + Math.cos(f) * atk.range, this.y + Math.sin(f) * atk.range, 0.3, 4, a.color);
            }
            if (a.recover) this.posture = Math.max(0, this.posture - a.recover);
            if (a.motion !== 'slam') g.shake(a.motion === 'thrust' ? 3 : 5);
        }
        if (this.artAtk !== null) {
            if (t < this.artAtkEnd) g.playerHitCheck(this, this.artAtk);
            else this.artAtk = null;
        }
        if (t > a.hits[a.hits.length - 1].t + 0.14 && this.bufDodge > 0) {
            this.bufDodge = 0;
            this.artAtk = null;
            this.startDodge();
        } else if (t >= a.dur) this.toFree();
    }

    startDodge() {
        const g = this.g;
        this.dodgeStartX = this.x;
        this.dodgeStartY = this.y;
        let dx = this.moveX, dy = this.moveY;
        if (dx === 0 && dy === 0) {
            dx = Math.cos(this.facing);
            dy = Math.sin(this.facing);
        }
        this.dodgeDx = dx;
        this.dodgeDy = dy;
        this.st = 'DODGE';
        this.stT = 0;
        this.guarding = false;
        g.sfx.play('DODGE');
        g.fx.dust(this.x, this.y, 6);
        const m = g.mikiriCandidate(this, dx, dy);
        if (m !== null) {
            this.st = 'MIKIRI';
            this.stT = 0;
            this.facing = this.angleTo(m);
            g.onMikiri(this, m);
        }
    }

    leaveDodgeAfterimage() {
        const g = this.g;
        const image = {
            x: this.dodgeStartX,
            y: this.dodgeStartY,
            facing: this.facing,
            r: this.r,
            st: 'FREE',
            swingId: -1,
            guarding: false,
            spam: 0,
            stealth: 1,
            vx: 0,
            vy: 0,
            curArt: { spin: false },
            expires: g.time + 2,
            distTo(target) { return U.dist(this.x, this.y, target.x, target.y); },
            angleTo(target) { return Math.atan2(target.y - this.y, target.x - this.x); },
            untargetable() { return false; },
            sneaking() { return true; },
            receive() { return P_IGNORE; },
            recoil() {},
        };
        this.afterimage = image;
        return image;
    }

    drawAfterimage(g2, time) {
        const image = this.afterimage, remaining = image ? image.expires - this.g.time : 0;
        if (!image || remaining <= 0) return;
        const lo = this.g.loadout, x = image.x, y = image.y, r = this.r;
        g2.save();
        g2.globalAlpha = 0.32 * U.clamp(remaining / 0.3, 0, 1);
        Draw.shadow(g2, x, y, r);
        Draw.scarf(g2, x, y, r, image.facing, this.scarf, lo.color('scarf'));
        Draw.body(g2, x, y, r, image.facing, lo.color('robe'), lo.armorDef().shoulder,
            lo.color('hat'), lo.look.hatStyle, this.walkAnim);
        const hx = x + Math.cos(image.facing + 0.9) * r * 0.9;
        const hy = y + Math.sin(image.facing + 0.9) * r * 0.9;
        Draw.weapon(g2, hx, hy, image.facing + 0.55, this.sword, rgb(175, 225, 255));
        g2.restore();
    }

    startDeathblow(e) {
        this.st = 'DEATHBLOW';
        this.stT = 0;
        this.dbTarget = e;
        this.dbDone = false;
        e.beingExecuted = true;
        this.guarding = false;
        this.facing = this.angleTo(e);
    }

    startIai(ang) {
        const g = this.g;
        const color = this.enlightened() ? rgb(255, 205, 75) : rgb(150, 200, 255);
        this.ki = 0;
        this.st = 'IAI';
        this.stT = 0;
        this.iaiSx = this.x;
        this.iaiSy = this.y;
        this.iaiDx = Math.cos(ang);
        this.iaiDy = Math.sin(ang);
        this.facing = ang;
        this.iaiVictims.length = 0;
        this.iaiDone = false;
        this.iaiLine = false;
        this.guarding = false;
        g.sfx.play('IAI');
        g.zoomKick(0.08);
        g.fx.ring(this.x, this.y, 10, 70, 0.3, 4, color);
    }

    startDragon(ang) {
        const g = this.g;
        if (!this.dragonFlash) {
            g.fx.text('Learn Dragon Flash in the Skill Tree', this.x, this.y - 40, rgb(150, 190, 255), 13);
            return;
        }
        if (this.ki < 100) {
            g.fx.text('Ki not full', this.x, this.y - 40, rgb(140, 180, 255), 13);
            return;
        }
        this.ki = 0;
        this.st = 'DRAGON';
        this.stT = 0;
        this.facing = ang;
        this.dragonDone = false;
        const a = new Attack('dragonflash', 0, 0.1, 0, 260 * (this.enlightened() ? 1.5 : 1), 42,
            this.dragonDamage, 70 * (this.buddhaPower() ? 5 : 1), 0);
        a.art = true;
        a.heavy = true;
        a.pierce = true;
        this.dragonAtk = a;
        this.hitSet.clear();
        this.guarding = false;
        g.sfx.play('IAI');
        g.zoomKick(0.1);
        g.fx.ring(this.x, this.y, 12, 95, 0.35, 4, rgb(170, 230, 255));
        g.fx.text('DRAGON FLASH', this.x, this.y - 54, rgb(180, 235, 255), 20);
    }

    dragonUpdate(dt) {
        const g = this.g;
        if (this.stT >= 0.2 && !this.dragonDone) {
            this.dragonDone = true;
            g.playerHitCheck(this, this.dragonAtk);
            const f = this.facing;
            g.fx.line(this.x, this.y, this.x + Math.cos(f) * this.dragonAtk.range, this.y + Math.sin(f) * this.dragonAtk.range,
                0.55, 6, rgb(170, 230, 255));
            g.fx.sparks(this.x + Math.cos(f) * 110, this.y + Math.sin(f) * 110, f, 0.4, 26, 640, rgb(185, 235, 255));
            g.hitstop(0.12);
            g.shake(12);
        }
        if (this.stT >= 0.62) this.toFree();
    }

    iai(dt) {
        const g = this.g;
        const color = this.enlightened() ? rgb(255, 205, 75) : rgb(170, 210, 255);
        if (this.stT < 0.16) {
            this.move(g.world, this.iaiDx * 2100 * dt, this.iaiDy * 2100 * dt);
            g.fx.wisp(this.x, this.y, color);
            for (const e of g.enemies) {
                if (e.st === 'DEAD' || this.iaiVictims.includes(e)) continue;
                if (U.segDist(e.x, e.y, this.iaiSx, this.iaiSy, this.x, this.y) < e.r + 45) this.iaiVictims.push(e);
            }
        } else if (!this.iaiLine) {
            this.iaiLine = true;
            g.fx.line(this.iaiSx, this.iaiSy, this.x, this.y, 0.9, 5, color);
        }
        if (this.stT >= 0.5 && !this.iaiDone) {
            this.iaiDone = true;
            g.resolveIai(this, this.iaiVictims);
        }
        if (this.stT >= 0.7) this.toFree();
    }

    /** Called when an attack reaches the player; returns a P_* result for attack resolution. */
    receive(sx, sy, dmg, post, perilous, sweep = false, thrust = false) {
        const g = this.g;
        if (this.st === 'DEAD') return P_IGNORE;
        const ang = Math.atan2(sy - this.y, sx - this.x);
        const front = Math.abs(U.angDiff(this.facing, ang)) < 105 * DEG;
        const guardAge = g.time - this.guardStart;
        const guardWindow = this.guardDuration();
        const sweepParry = perilous && sweep && guardAge >= 0 && guardAge <= guardWindow * 0.5;
        const buddhaPerfect = this.buddhaPower() && guardAge >= 0
            && guardAge <= Math.min(BUDDHA_PARRY_WINDOW, guardWindow * (sweepParry ? 0.5 : 1));
        const buddhaMikiri = perilous && thrust && buddhaPerfect;
        const buddhaSweep = sweep && (!perilous || sweepParry) && buddhaPerfect;
        const dodgeParry = this.st === 'DODGE' && this.guarding && front && guardAge >= 0
            && guardAge <= guardWindow && (!perilous || sweepParry || buddhaMikiri);
        if (this.st === 'DODGE' && this.stT < this.dodgeIframes && !dodgeParry) {
            if (this.stT <= (this.buddhaPower() ? BUDDHA_DODGE_WINDOW : PERFECT_DODGE_WINDOW)) {
                const cx = this.x + Math.cos(ang) * (this.r + 12), cy = this.y + Math.sin(ang) * (this.r + 12);
                this.leaveDodgeAfterimage();
                this.ki = Math.min(100, this.ki + 18);
                this.gainArtCharge();
                g.fx.sparks(cx, cy, ang, 2.2, 24, 520, rgb(160, 220, 255));
                g.fx.ring(cx, cy, 8, 105, 0.22, 4, rgb(190, 235, 255));
                g.fx.text('PERFECT DODGE', this.x, this.y - 42, rgb(190, 235, 255), 20);
                g.fx.impact(cx, cy, 'dodge');
                g.sfx.play('CLANG');
                g.hitstop(0.075);
                g.slowmo(0.14);
                g.flash(rgb(180, 230, 255), 0.16);
                return P_PERFECT_DODGE;
            }
            return P_IGNORE;
        }
        if (this.invulnerable() && !dodgeParry) return P_IGNORE;
        dmg *= this.dmgTaken;
        const cx = this.x + Math.cos(ang) * (this.r + 12), cy = this.y + Math.sin(ang) * (this.r + 12);
        if ((!perilous || sweepParry || buddhaMikiri) && (this.st === 'FREE' || dodgeParry) && this.guarding && front) {
            if (guardAge <= guardWindow * (sweepParry ? 0.5 : 1)) {
                const perfect = guardAge >= 0
                    && guardAge <= Math.min(this.buddhaPower() ? BUDDHA_PARRY_WINDOW : PERFECT_PARRY_WINDOW,
                        guardWindow * (sweepParry ? 0.5 : 1));
                this.posture = Math.min(this.maxPosture - 1, this.posture + (perfect ? 0 : post * 0.12));
                this.spam = 0;
                this.deflectStreak++;
                this.deflectStreakT = 1.6;
                this.ki = Math.min(100, this.ki + (perfect ? 24 : 12));
                this.gainArtCharge();
                if (perfect) this.gainArtCharge();
                if (this.deflectRecover > 0) this.posture = Math.max(0, this.posture - this.deflectRecover);
                this.guardFlash = 0.25;
                const k = Math.min(this.deflectStreak, 6);
                g.fx.sparks(cx, cy, ang, 2.8, 36 + k * 8, 620 + k * 50, rgb(255, 200, 80));
                g.fx.sparks(cx, cy, ang + Math.PI / 2, 0.6, 8 + k, 460, WHITE);
                g.fx.sparks(cx, cy, ang - Math.PI / 2, 0.6, 8 + k, 460, WHITE);
                g.fx.ring(cx, cy, 4, 50 + k * 8, 0.25, 4, rgb(255, 240, 180));
                g.fx.ring(cx, cy, 2, 100 + k * 14, 0.4, 2, rgb(255, 255, 255));
                for (let i = 0; i < 7; i++) {
                    const a = ang + (i - 3) * 0.32 + (Math.random() - 0.5) * 0.15, l0 = 10, l1 = 44 + k * 7 + Math.random() * 16;
                    g.fx.line(cx + Math.cos(a) * l0, cy + Math.sin(a) * l0, cx + Math.cos(a) * l1, cy + Math.sin(a) * l1, 0.14, 2.5, rgb(255, 245, 210));
                }
                g.sfx.play('CLANG');
                g.sfx.play('PARRY');
                g.hitstop(0.1 + k * 0.012);
                g.shake(8 + k * 1.2);
                g.zoomKick(0.035 + k * 0.008);
                g.flash(rgb(255, 235, 180), 0.14 + k * 0.02);
                g.parryBurst(cx, cy, k);
                if (perfect) g.fx.impact(cx, cy, 'parry');
                if (sweepParry) g.fx.impact(cx, cy, 'sweep');
                const s = perfect ? 'PERFECT PARRY' : this.deflectStreak > 1 ? 'DEFLECT x' + this.deflectStreak : 'DEFLECT';
                g.fx.text(s, this.x, this.y - 42, perfect || this.deflectStreak >= 4 ? rgb(255, 250, 200) : rgb(255, 215, 90),
                    perfect ? 20 + k * 3 : 16 + k * 3);
                if (perfect && buddhaMikiri) return P_BUDDHA_MIKIRI;
                if (perfect && buddhaSweep) return P_BUDDHA_SWEEP;
                return perfect ? P_PERFECT : P_DEFLECT;
            }
            this.posture += post;
            this.postureCd = 1.0;
            this.move(g.world, -Math.cos(ang) * 10, -Math.sin(ang) * 10);
            g.fx.sparks(cx, cy, ang, 1.8, 10, 280, rgb(255, 150, 60));
            g.sfx.play('BLOCK');
            g.shake(3);
            g.hitstop(0.035);
            this.deflectStreak = 0;
            if (this.posture >= this.maxPosture) {
                this.posture = this.maxPosture * 0.6;
                this.st = 'STAGGER';
                this.stT = 0;
                this.staggerDur = 1.2;
                this.guarding = false;
                this.vx = -Math.cos(ang) * 200;
                this.vy = -Math.sin(ang) * 200;
                g.fx.text('GUARD BROKEN', this.x, this.y - 42, rgb(255, 80, 60), 18);
                g.sfx.play('BREAK');
                g.shake(10);
                if (g.onGuardBreak) g.onGuardBreak(this);
            }
            return P_BLOCK;
        }
        const artArmor = this.artArmored(perilous);
        if (artArmor && this.curArt.weapon === 'hammer') dmg *= 0.7;
        this.lastDmgTaken = dmg;
        this.hp -= dmg;
        this.posture = Math.min(this.maxPosture, this.posture + post * (artArmor ? 0.2 : 0.35));
        this.postureCd = 1.0;
        this.hurtFlash = 0.3;
        this.deflectStreak = 0;
        // poise: a heavy weapon mid-windup or mid-swing takes the blow and keeps going (perilous attacks still interrupt)
        const swingPoise = !perilous && this.st === 'ATTACK' && this.phase <= 1;
        if ((artArmor && (this.artHitsLeft > 0 || dmg <= this.poiseLeft))
            || (swingPoise && this.poiseLeft > 0 && dmg <= this.poiseLeft)) {
            if (artArmor) this.artHitsLeft = Math.max(0, this.artHitsLeft - 1);
            this.poiseLeft = Math.max(0, this.poiseLeft - dmg);
            this.invuln = 0.2;
            this.move(g.world, -Math.cos(ang) * 4, -Math.sin(ang) * 4);
            g.fx.blood(this.x, this.y, ang + Math.PI, 7, 200);
            g.fx.sparks(cx, cy, ang, 1.2, 10, 300, rgb(255, 170, 90));
            g.fx.ring(this.x, this.y, this.r, this.r + 16, 0.2, 3, rgb(255, 190, 120));
            g.fx.text('UNFLINCHING', this.x, this.y - 42, rgb(255, 190, 120), 14);
            g.sfx.play('HURT');
            g.shake(5);
            g.hitstop(0.04);
            g.flash(rgb(200, 0, 0), 0.12);
            if (this.hp <= 0) this.die();
            return P_HIT;
        }
        this.invuln = 0.35;
        this.guarding = false;
        this.st = 'STAGGER';
        this.stT = 0;
        this.staggerDur = perilous ? 0.55 : 0.3;
        this.vx = -Math.cos(ang) * (perilous ? 380 : 230);
        this.vy = -Math.sin(ang) * (perilous ? 380 : 230);
        g.fx.blood(this.x, this.y, ang + Math.PI, 12, 260);
        g.sfx.play('HURT');
        g.shake(perilous ? 14 : 9);
        g.hitstop(0.06);
        g.flash(rgb(200, 0, 0), 0.25);
        if (this.hp <= 0) this.die();
        return P_HIT;
    }

    /** An enemy parried our swing. */
    recoil(awayAng) {
        this.st = 'STAGGER';
        this.stT = 0;
        this.staggerDur = 0.45;
        this.posture = Math.min(this.maxPosture - 1, this.posture + 15);
        this.postureCd = 1.0;
        this.vx = Math.cos(awayAng) * 260;
        this.vy = Math.sin(awayAng) * 260;
    }

    die() {
        if (this.lastStand && !this.lastStandUsed) {
            this.lastStandUsed = true;
            this.hp = 1;
            this.posture = 0;
            this.invuln = 1.2;
            this.st = 'STAGGER';
            this.stT = 0;
            this.staggerDur = 0.25;
            this.g.fx.text('IRON WILL', this.x, this.y - 54, rgb(180, 220, 255), 22);
            this.g.fx.ring(this.x, this.y, 8, 90, 0.6, 5, rgb(180, 220, 255));
            this.g.sfx.play('BREAK');
            return;
        }
        if (this.buddhaPower() && this.buddhaReviveReady) {
            this.buddhaReviveReady = false;
            this.buddhaDeathblows = 0;
            this.hp = this.maxHp * 0.5;
            this.posture = 0;
            this.invuln = 2;
            this.st = 'STAGGER';
            this.stT = 0;
            this.staggerDur = 0.6;
            this.vx = this.vy = 0;
            this.g.fx.text('BUDDHA REBORN', this.x, this.y - 54, rgb(255, 235, 150), 22);
            this.g.fx.ring(this.x, this.y, 8, 120, 0.7, 5, rgb(255, 225, 120));
            this.g.sfx.play('SHRINE');
            this.g.hitstop(0.1);
            this.g.flash(rgb(255, 245, 190), 0.25);
            this.g.saveSoon();
            return;
        }
        this.hp = 0;
        this.st = 'DEAD';
        this.stT = 0;
        this.deadT = 0;
        this.g.onPlayerDeath();
    }

    respawn(sx, sy) {
        this.lockTarget = null;
        this.artHitsLeft = 0;
        this.x = sx;
        this.y = sy;
        this.hp = this.maxHp;
        this.posture = 0;
        this.gourds = this.maxGourds;
        this.throws = this.maxThrows;
        this.artCharges = 0;
        this.st = 'FREE';
        this.stT = 0;
        this.throwDone = false;
        this.vx = this.vy = 0;
        this.invuln = 1.5;
        this.ki = 0;
        this.lastStandUsed = false;
    }

    // ---------------- rendering ----------------
    draw(g2, time) {
        const x = this.x, y = this.y, r = this.r, facing = this.facing, st = this.st, lo = this.g.loadout;
        if (st === 'DEAD') {
            g2.save();
            g2.translate(x, y);
            g2.rotate(facing);
            g2.fillStyle = css(lo.color('robe'));
            fillEllipse(g2, -r * 1.3, -r * 0.8, r * 2.6, r * 1.6);
            g2.restore();
            return;
        }
        if (this.enlightened()) {
            g2.save();
            const glow = g2.createRadialGradient(x, y, r * 0.4, x, y, r * 3);
            glow.addColorStop(0, 'rgba(255,235,130,0.5)');
            glow.addColorStop(1, 'rgba(255,220,80,0)');
            g2.fillStyle = glow;
            fillCircle(g2, x, y, r * 3);
            g2.strokeStyle = 'rgba(255,235,140,0.75)';
            g2.lineWidth = 2;
            g2.beginPath();
            g2.arc(x, y, r + 9 + Math.sin(time * 3) * 2, 0, TAU);
            g2.stroke();
            g2.restore();
        }
        let handRel = 0.9, handForward = 0, bodyLeanX = 0, bodyLeanY = 0;
        let blade = facing + 0.55, bodyFacing = facing;
        if (st === 'ATTACK') {
            const cur = this.cur, ss = this.swingSign;
            const a0 = ss * cur.arc / 2, a1 = -ss * cur.arc / 2;
            if (weaponType(this.sword) === 'spear') {
                handRel = 0;
                blade = facing;
                const extension = this.combo === 2 ? 46 : 30;
                if (this.phase === 0) {
                    const t = U.clamp(this.stT / cur.windup, 0, 1);
                    handForward = -18 * (1 - t * t * (3 - 2 * t));
                } else if (this.phase === 1) {
                    const t = U.clamp(this.stT / cur.active, 0, 1);
                    handForward = extension * t * t * (3 - 2 * t);
                } else {
                    const t = U.clamp(this.stT / Math.min(cur.recovery, 0.3), 0, 1);
                    handForward = extension * (1 - t * t * (3 - 2 * t));
                }
                const bodyDrive = handForward > 0 ? U.clamp(handForward / extension, 0, 1) : 0;
                bodyLeanX = Math.cos(facing) * bodyDrive * (this.combo === 2 ? 7 : 4);
                bodyLeanY = Math.sin(facing) * bodyDrive * (this.combo === 2 ? 7 : 4);
            } else if (weaponType(this.sword) === 'hammer') {
                let rel;
                const finisher = this.combo === 2;
                if (this.phase === 0) {
                    const t = U.clamp(this.stT / cur.windup, 0, 1);
                    rel = U.lerp(ss * (finisher ? 2.9 : 2.5), a0, t * t * (3 - 2 * t));
                } else if (this.phase === 1) {
                    const t = U.clamp(this.stT / cur.active, 0, 1);
                    const swing = t * t * (3 - 2 * t);
                    rel = U.lerp(a0, a1, swing) - ss * (finisher ? 0.48 : 0.2) * Math.sin(Math.PI * t);
                } else rel = a1;
                blade = facing + rel;
                handRel = rel * 0.58;
                bodyFacing = facing + rel * 0.2;
                let lean;
                if (this.phase === 0) lean = 0;
                else if (this.phase === 1) {
                    const t = U.clamp(this.stT / cur.active, 0, 1);
                    lean = Math.sin(Math.PI * t) * 0.65 + t * 0.35;
                } else {
                    const t = U.clamp(this.stT / Math.min(cur.recovery, 0.3), 0, 1);
                    lean = 0.35 * (1 - t * t * (3 - 2 * t));
                }
                const tangent = blade - ss * Math.PI / 2;
                const weight = finisher ? 13 : 10;
                bodyLeanX = Math.cos(tangent) * lean * weight;
                bodyLeanY = Math.sin(tangent) * lean * weight;
            } else {
                const finisher = this.combo === 2;
                let rel;
                if (this.phase === 0) {
                    const t = U.clamp(this.stT / cur.windup, 0, 1);
                    rel = a0 + ss * (finisher ? 0.45 : 0.35) * (1 - t);
                } else if (this.phase === 1) {
                    const t = U.clamp(this.stT / cur.active, 0, 1);
                    const swing = finisher ? t * t * (3 - 2 * t) : t;
                    rel = U.lerp(a0, a1, swing) - ss * (finisher ? 0.35 : 0) * Math.sin(Math.PI * t);
                } else {
                    const t = U.clamp(this.stT / Math.min(cur.recovery, 0.25), 0, 1);
                    rel = a1 - ss * (finisher ? 0.35 * (1 - t * t * (3 - 2 * t)) : 0);
                }
                blade = facing + rel;
                handRel = rel * 0.6;
                if (finisher) {
                    let lean;
                    if (this.phase === 0) lean = 0;
                    else if (this.phase === 1) {
                        const t = U.clamp(this.stT / cur.active, 0, 1);
                        lean = Math.sin(Math.PI * t) * 0.55 + t * 0.25;
                    } else {
                        const t = U.clamp(this.stT / Math.min(cur.recovery, 0.25), 0, 1);
                        lean = 0.25 * (1 - t * t * (3 - 2 * t));
                    }
                    const tangent = blade - ss * Math.PI / 2;
                    bodyLeanX = Math.cos(tangent) * lean * 7;
                    bodyLeanY = Math.sin(tangent) * lean * 7;
                }
            }
        } else if (st === 'ART') {
            const a = this.curArt, rel = a.blade(this.stT);
            if (a.motion === 'thrust') {
                handRel = 0;
                blade = facing;
                const jab = this.artIdx > 0 && this.stT >= a.hits[1].t - 0.14 ? 1 : 0;
                const cycleT = jab ? U.clamp((this.stT - (a.hits[1].t - 0.14)) / 0.16, 0, 1)
                    : U.clamp(this.stT / 0.22, 0, 1);
                handForward = U.lerp(-18, 48, cycleT * cycleT * (3 - 2 * cycleT));
                bodyLeanX = Math.cos(facing) * 6 * U.clamp(handForward / 48, 0, 1);
                bodyLeanY = Math.sin(facing) * 6 * U.clamp(handForward / 48, 0, 1);
            } else if (a.motion === 'slam') {
                blade = facing + rel;
                handRel = rel * 0.58;
                bodyFacing = facing + rel * 0.22;
                const drive = this.stT < a.hits[0].t ? 0 : U.clamp((this.stT - a.hits[0].t) / 0.12, 0, 1);
                bodyLeanX = Math.cos(facing) * drive * 14;
                bodyLeanY = Math.sin(facing) * drive * 14;
            } else {
                blade = facing + rel;
                handRel = a.spin ? rel : rel * 0.6;
                if (a.spin) bodyFacing = facing + rel - 0.9;
            }
        } else if (st === 'FREE' && this.guarding) {
            handRel = 0.15;
            blade = facing - 1.4;
        } else if (st === 'IAI' || st === 'MIKIRI' || st === 'DRAGON') {
            handRel = 0.3;
            blade = facing + (st === 'IAI' && this.stT > 0.16 ? 2.6 : st === 'DRAGON' ? 0.2 + this.stT * 4 : 0.1);
        } else if (st === 'DEATHBLOW') {
            const type = weaponType(this.sword), timing = DEATHBLOW_TIMINGS[type];
            const strike = U.clamp((this.stT - timing.impact + 0.1) / 0.1, 0, 1);
            if (type === 'spear') {
                const withdraw = U.clamp((this.stT - timing.impact - 0.12)
                    / (timing.duration - timing.impact - 0.12), 0, 1);
                handRel = 0;
                handForward = U.lerp(U.lerp(-16, 26, strike), -10, withdraw);
                blade = facing;
                bodyLeanX = Math.cos(facing) * strike * (1 - withdraw) * 12;
                bodyLeanY = Math.sin(facing) * strike * (1 - withdraw) * 12;
            } else if (type === 'hammer') {
                handRel = U.lerp(-1.2, 0.2, strike);
                blade = facing + U.lerp(-2.5, 0.4, strike);
                bodyFacing = facing - (1 - strike) * 0.6;
                handForward = strike * 12;
            } else if (type === 'axe') {
                handRel = U.lerp(1.1, -0.6, strike);
                blade = facing + U.lerp(2.2, -1.2, strike);
                bodyFacing = facing + U.lerp(0.6, -0.4, strike);
            } else {
                handRel = 0;
                blade = facing + U.lerp(1.4, -0.6, strike);
            }
        } else if (st === 'STAGGER') {
            blade = facing + 1.6;
        } else if (st === 'THROW') {
            handRel = this.stT < 0.14 ? -1.1 : 0.2;
            blade = facing + 0.6;
        }

        Draw.shadow(g2, x, y, r);
        const bodyX = x + bodyLeanX, bodyY = y + bodyLeanY;
        Draw.scarf(g2, bodyX, bodyY, r, bodyFacing, this.scarf, lo.color('scarf'));
        let robe = lo.color('robe'), shoulder = lo.armorDef().shoulder;
        if (this.hurtFlash > 0.15) {
            robe = WHITE;
            shoulder = WHITE;
        }
        const flicker = this.invuln > 0 && st === 'FREE' && Math.trunc(time * 20) % 2 === 0;
        if (flicker) robe = U.shade(robe, 1.8);
        if (st === 'DODGE' || (st === 'ART' && this.curArt.trail && this.invulnerable())) {
            g2.fillStyle = st === 'DODGE' ? 'rgba(160,190,255,0.235)' : css(U.alpha(this.curArt.color, 0.3));
            fillCircle(g2, x - this.vx * 0.03, y - this.vy * 0.03, r * 1.4);
        }
        Draw.body(g2, bodyX, bodyY, r, bodyFacing, robe, shoulder, lo.color('hat'), lo.look.hatStyle, this.walkAnim);

        const hx = bodyX + Math.cos(facing + handRel) * r * 0.9 + Math.cos(facing) * handForward;
        const hy = bodyY + Math.sin(facing + handRel) * r * 0.9 + Math.sin(facing) * handForward;
        const sword = this.sword;
        Draw.weapon(g2, hx, hy, blade, sword, this.guardFlash > 0 ? rgb(255, 230, 150) : sword.color);
        if (st === 'FREE' && this.guarding && this.g.time - this.guardStart <= this.guardDuration()) {
            g2.fillStyle = 'rgba(255,240,200,0.353)';
            fillCircle(g2, hx, hy, 14);
        }
        if (st === 'ART' && this.curArt.charge) {
            const left = this.curArt.hits[0].t - this.stT;
            if (left > 0 && left < 0.3) Draw.glint(g2, hx, hy, 8 + (0.3 - left) * 40, rgb(255, 225, 225));
        }
        if (st === 'ATTACK' && this.cur !== null && this.cur.perilous && this.phase === 0) {
            const pulse = 0.7 + 0.3 * Math.sin(this.g.time * 10);
            g2.fillStyle = 'rgba(120,0,0,' + (0.55 * pulse) + ')';
            fillCircle(g2, x, y - r - 34, 12 * pulse);
            g2.fillStyle = 'rgb(255,40,30)';
            g2.font = 'bold 26px ' + KANJI_FAMILY;
            g2.textAlign = 'center';
            g2.textBaseline = 'middle';
            g2.fillText('\u5371', x, y - r - 34);
            g2.textAlign = 'left';
            g2.textBaseline = 'alphabetic';
        }
    }
}
