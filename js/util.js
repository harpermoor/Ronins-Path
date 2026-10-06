'use strict';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// Colors are [r, g, b, a] arrays with components 0-255.
function rgb(r, g, b, a = 255) { return [r, g, b, a]; }
const WHITE = rgb(255, 255, 255);
const BLACK = rgb(0, 0, 0);
function css(c) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + c[3] / 255 + ')'; }

/** Small math / color helpers. */
const U = {
    clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
    lerp(a, b, t) { return a + (b - a) * t; },
    dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); },
    /** Signed shortest angle from a to b, in [-PI, PI]. */
    angDiff(a, b) {
        let d = (b - a) % TAU;
        if (d > Math.PI) d -= TAU;
        if (d < -Math.PI) d += TAU;
        return d;
    },
    turn(cur, target, maxStep) {
        const d = U.angDiff(cur, target);
        if (Math.abs(d) <= maxStep) return target;
        return cur + Math.sign(d) * maxStep;
    },
    segDist(px, py, ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : U.clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
        return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
    },
    alpha(c, a) { return [c[0], c[1], c[2], Math.floor(U.clamp(a * 255, 0, 255))]; },
    mix(a, b, t) {
        t = U.clamp(t, 0, 1);
        return [Math.floor(U.lerp(a[0], b[0], t)), Math.floor(U.lerp(a[1], b[1], t)), Math.floor(U.lerp(a[2], b[2], t)), 255];
    },
    shade(c, f) {
        return [Math.floor(U.clamp(c[0] * f, 0, 255)), Math.floor(U.clamp(c[1] * f, 0, 255)), Math.floor(U.clamp(c[2] * f, 0, 255)), 255];
    },
};

/** Seeded PRNG (mulberry32) standing in for java.util.Random. */
class Rng {
    constructor(seed) {
        seed = Math.floor(Number(seed) || 0);
        const lo = seed | 0, hi = Math.floor(seed / 4294967296) | 0;
        let s = Math.imul(lo ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(hi ^ 0x7f4a7c15, 0xc2b2ae35);
        s ^= s >>> 16;
        this.s = s | 0;
        this.gauss = null;
    }
    nextU32() {
        let t = (this.s = (this.s + 0x6d2b79f5) | 0);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return (t ^ (t >>> 14)) >>> 0;
    }
    nextDouble() { return this.nextU32() / 4294967296; }
    nextInt(n) { return Math.floor(this.nextDouble() * n); }
    nextBoolean() { return (this.nextU32() & 1) === 1; }
    nextGaussian() {
        if (this.gauss !== null) {
            const g = this.gauss;
            this.gauss = null;
            return g;
        }
        let u, v, s;
        do {
            u = this.nextDouble() * 2 - 1;
            v = this.nextDouble() * 2 - 1;
            s = u * u + v * v;
        } while (s >= 1 || s === 0);
        const m = Math.sqrt(-2 * Math.log(s) / s);
        this.gauss = v * m;
        return u * m;
    }
}

// ---------------- canvas helpers ----------------
function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w | 0);
    c.height = Math.max(1, h | 0);
    return c;
}

function setStroke(g, w, round) {
    g.lineWidth = w;
    g.lineCap = round ? 'round' : 'square';
    g.lineJoin = round ? 'round' : 'miter';
}

/** Java-style ellipse from a bounding box. */
function fillEllipse(g, x, y, w, h) {
    g.beginPath();
    g.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, TAU);
    g.fill();
}

function strokeEllipse(g, x, y, w, h) {
    g.beginPath();
    g.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, TAU);
    g.stroke();
}

function fillCircle(g, cx, cy, r) {
    g.beginPath();
    g.arc(cx, cy, Math.abs(r), 0, TAU);
    g.fill();
}

function strokeLine(g, x1, y1, x2, y2) {
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
}

function roundRectPath(g, x, y, w, h, rad) {
    g.beginPath();
    g.moveTo(x + rad, y);
    g.lineTo(x + w - rad, y);
    g.arcTo(x + w, y, x + w, y + rad, rad);
    g.lineTo(x + w, y + h - rad);
    g.arcTo(x + w, y + h, x + w - rad, y + h, rad);
    g.lineTo(x + rad, y + h);
    g.arcTo(x, y + h, x, y + h - rad, rad);
    g.lineTo(x, y + rad);
    g.arcTo(x, y, x + rad, y, rad);
    g.closePath();
}

// ---------------- core game types ----------------
/** Anything with a body in the world. */
class Actor {
    constructor() {
        this.x = 0;
        this.y = 0;
        this.r = 0;
        this.facing = 0;
        this.hp = 0;
        this.maxHp = 0;
        this.posture = 0;
        this.maxPosture = 0;
        this.alive = true;
    }
    move(w, dx, dy) {
        this.x += dx;
        this.y += dy;
        w.resolve(this);
    }
    angleTo(o) { return Math.atan2(o.y - this.y, o.x - this.x); }
    distTo(o) { return U.dist(this.x, this.y, o.x, o.y); }
}

/** Timing and hitbox data for a single swing. Arc given in degrees. */
class Attack {
    constructor(name, windup, active, recovery, range, arcDeg, damage, posture, lunge) {
        this.name = name;
        this.windup = windup;
        this.active = active;
        this.recovery = recovery;
        this.range = range;
        this.arc = arcDeg * DEG;
        this.damage = damage;
        this.posture = posture;
        this.lunge = lunge;
        this.perilous = false;
        this.thrust = false;
        this.sweep = false;
        this.dash = 0;
    }
    markPerilous() { this.perilous = true; return this; }
    markThrust() { this.thrust = true; return this; }
    markSweep() { this.sweep = true; return this; }
    copy(windupMul, dmgMul) {
        const a = new Attack(this.name, this.windup * windupMul, this.active, this.recovery * Math.max(0.6, windupMul), this.range,
            this.arc / DEG, this.damage * dmgMul, this.posture * dmgMul, this.lunge);
        a.perilous = this.perilous;
        a.thrust = this.thrust;
        a.sweep = this.sweep;
        a.dash = this.dash;
        return a;
    }
}

/** Keyboard + mouse state. "hit" flags latch until consumed by the game tick. Mouse buttons: 1 = left, 3 = right. */
class Input {
    constructor(target, onGesture) {
        this.keys = new Set();
        this.keyHit = new Set();
        this.btn = new Array(8).fill(false);
        this.btnHit = new Array(8).fill(false);
        this.btnStarted = new Array(8).fill(0);
        this.mx = 0;
        this.my = 0;
        const blockDefault = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
        const mapBtn = b => (b === 0 ? 1 : b === 1 ? 2 : b === 2 ? 3 : 0);
        window.addEventListener('keydown', e => {
            onGesture();
            if (blockDefault.has(e.code)) e.preventDefault();
            if (!this.keys.has(e.code)) this.keyHit.add(e.code);
            this.keys.add(e.code);
        });
        window.addEventListener('keyup', e => this.keys.delete(e.code));
        target.addEventListener('mousedown', e => {
            onGesture();
            e.preventDefault();
            const b = mapBtn(e.button);
            if (b) {
                this.btn[b] = true;
                this.btnHit[b] = true;
                this.btnStarted[b] = performance.now();
            }
        });
        window.addEventListener('mouseup', e => {
            const b = mapBtn(e.button);
            if (b) {
                this.btn[b] = false;
                this.btnStarted[b] = 0;
            }
        });
        window.addEventListener('mousemove', e => {
            const rc = target.getBoundingClientRect();
            this.mx = e.clientX - rc.left;
            this.my = e.clientY - rc.top;
        });
        target.addEventListener('contextmenu', e => e.preventDefault());
        window.addEventListener('blur', () => this.releaseAll());
    }
    down(k) { return this.keys.has(k); }
    hit(k) { return this.keyHit.has(k); }
    mouseDown(b) { return this.btn[b]; }
    mouseHit(b) { return this.btnHit[b]; }
    mouseHeldFor(b) { return this.btn[b] && this.btnStarted[b] > 0 ? (performance.now() - this.btnStarted[b]) / 1000 : 0; }
    endTick() {
        this.keyHit.clear();
        this.btnHit.fill(false);
    }
    releaseAll() {
        this.keys.clear();
        this.btn.fill(false);
        this.btnStarted.fill(0);
    }
}
