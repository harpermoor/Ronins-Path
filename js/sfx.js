'use strict';

/** Procedurally synthesized steel-on-steel sound effects (no audio files needed). Audio starts on the first key/mouse press. */
class Sfx {
    constructor() {
        this.RATE = 44100;
        this.ctx = null;
        this.out = null;
        this.buffers = {};
        this.voices = {};
        this.active = {};
        this.rnd = new Rng(7);
        Preferences.listeners.add(() => this.applyVolume());
    }

    applyVolume() {
        if (this.out) this.out.gain.value = Preferences.value.muted ? 0 : 0.85 * Preferences.value.volume / 100;
    }

    unlock() {
        if (!this.ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            try {
                this.ctx = new AC();
                this.out = this.ctx.createGain();
                this.applyVolume();
                if (this.ctx.createDynamicsCompressor) {
                    // Glues rapid overlapping hits together without clipping.
                    const comp = this.ctx.createDynamicsCompressor();
                    comp.threshold.value = -14;
                    comp.knee.value = 8;
                    comp.ratio.value = 5;
                    comp.attack.value = 0.002;
                    comp.release.value = 0.12;
                    this.out.connect(comp);
                    comp.connect(this.ctx.destination);
                } else {
                    this.out.connect(this.ctx.destination);
                }
                this.load();
            } catch (e) {
                console.warn('Sound disabled: ' + e);
                this.ctx = null;
                return;
            }
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    play(s) {
        const buf = this.ctx && this.buffers[s];
        if (!buf) return;
        const list = this.active[s];
        if (list.length >= this.voices[s]) {
            const old = list.shift();
            try { old.stop(); } catch (e) { /* already stopped */ }
        }
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        // Slight pitch variance keeps rapid repeated hits from sounding mechanical (presentation only).
        src.playbackRate.value = 0.95 + Math.random() * 0.1;
        src.connect(this.out);
        src.onended = () => {
            const i = list.indexOf(src);
            if (i >= 0) list.splice(i, 1);
        };
        list.push(src);
        src.start();
    }

    load() {
        this.put('CLANG', this.clang(), 5);
        this.put('PARRY', this.parry(), 3);
        this.put('BLOCK', this.block(), 4);
        this.put('SLASH', this.slash(), 4);
        this.put('HEAVY', this.heavy(), 3);
        this.put('THRUST', this.thrust(), 3);
        this.put('HAMMER_SWING', this.hammerSwing(), 3);
        this.put('HIT', this.hit(), 4);
        this.put('HURT', this.hurt(), 3);
        this.put('DEATHBLOW', this.deathblow(), 2);
        this.put('DODGE', this.dodge(), 3);
        this.put('PERILOUS', this.perilous(), 2);
        this.put('BREAK', this.postureBreak(), 2);
        this.put('HEAL', this.heal(), 2);
        this.put('SHRINE', this.shrine(), 1);
        this.put('IAI', this.iai(), 2);
    }

    put(s, data, voices) {
        const buf = this.ctx.createBuffer(1, data.length, this.RATE);
        buf.getChannelData(0).set(data);
        this.buffers[s] = buf;
        this.voices[s] = voices;
        this.active[s] = [];
    }

    // ---------- synthesis helpers ----------
    buf(sec) { return new Float32Array(Math.floor(sec * this.RATE)); }

    sine(b, f, amp, decay, delay) {
        const start = Math.floor(delay * this.RATE);
        for (let i = start; i < b.length; i++) {
            const t = (i - start) / this.RATE;
            b[i] += amp * Math.sin(TAU * f * t) * Math.exp(-t * decay);
        }
    }

    /** Inharmonic steel partials; each gets a slightly detuned twin so the ring shimmers like struck metal. */
    partials(b, base, ratios, amp, decay, delay) {
        for (let k = 0; k < ratios.length; k++) {
            const f = base * ratios[k];
            if (f > this.RATE * 0.45) continue;
            const a = amp / (1 + k * 0.35);
            const d = decay * (1 + k * 0.45);
            this.sine(b, f, a, d, delay);
            this.sine(b, f * 1.0037, a * 0.45, d * 1.15, delay + 0.0004);
        }
    }

    /** Body thump with a fast exponential pitch drop. */
    thump(b, f0, f1, amp, decay, delay) {
        const start = Math.floor(delay * this.RATE);
        let ph = 0;
        for (let i = start; i < b.length; i++) {
            const t = (i - start) / this.RATE;
            ph += TAU * (f1 + (f0 - f1) * Math.exp(-t * 32)) / this.RATE;
            b[i] += amp * Math.sin(ph) * Math.exp(-t * decay);
        }
    }

    /** Resonant band-passed noise sweeping f0 -> f1: steel scrapes, sheath draws, rattles. */
    band(b, f0, f1, res, amp, o) {
        o = o || {};
        const start = Math.floor((o.delay || 0) * this.RATE);
        const end = o.dur ? Math.min(b.length, start + Math.floor(o.dur * this.RATE)) : b.length;
        const len = Math.max(1, end - start);
        const damp = 1 / res, att = o.attack || 0.002, decay = o.decay || 0, grit = o.grit || 0;
        let low = 0, bp = 0, g = 1, gt = 1;
        for (let i = start; i < end; i++) {
            const p = (i - start) / len, t = (i - start) / this.RATE;
            const fc = Math.min(f0 * Math.pow(f1 / f0, p), this.RATE / 6);
            const f = 2 * Math.sin(Math.PI * fc / this.RATE);
            const hp = (this.rnd.nextDouble() * 2 - 1) - low - damp * bp;
            bp += f * hp;
            low += f * bp;
            if (grit && (i & 127) === 0) gt = 1 - grit * this.rnd.nextDouble();
            g += (gt - g) * 0.02;
            const fade = o.dur ? Math.min(1, (1 - p) * 8) : 1;
            b[i] += amp * damp * 2 * bp * g * Math.min(1, t / att) * Math.exp(-t * decay) * fade;
        }
    }

    noise(b, amp, decay, lp) {
        let y = 0;
        for (let i = 0; i < b.length; i++) {
            const t = i / this.RATE;
            y += lp * ((this.rnd.nextDouble() * 2 - 1) - y);
            b[i] += amp * y * Math.exp(-t * decay);
        }
    }

    transient(b, amp, decay, delay) {
        const start = Math.floor((delay || 0) * this.RATE);
        let last = 0;
        for (let i = start; i < b.length; i++) {
            const t = (i - start) / this.RATE;
            const n = this.rnd.nextDouble() * 2 - 1;
            const hp = n - last * 0.72;
            last = n;
            b[i] += amp * hp * Math.exp(-t * decay);
        }
    }

    whoosh(b, amp, lpLo, lpHi) {
        let y = 0, y2 = 0;
        for (let i = 0; i < b.length; i++) {
            const p = i / b.length;
            let env = Math.sin(Math.PI * Math.pow(p, 0.6));
            env *= env;
            const c = lpLo + (lpHi - lpLo) * Math.sin(Math.PI * p);
            y += c * ((this.rnd.nextDouble() * 2 - 1) - y);
            y2 += c * (y - y2);
            b[i] += amp * env * y2 * 3;
        }
    }

    pcm(b, gain) {
        const out = new Float32Array(b.length);
        for (let i = 0; i < b.length; i++) {
            let v = Math.tanh(b[i] * gain);
            if (i < 32) v *= i / 32;
            const tail = b.length - i;
            if (tail < 512) v *= tail / 512;
            out[i] = v * (30000 / 32768);
        }
        return out;
    }

    // ---------- sounds ----------
    /** Blade meets blade: hard tick, short edge grind, bright inharmonic ring. */
    clang() {
        const b = this.buf(0.55);
        this.transient(b, 1.4, 150);
        this.band(b, 5600, 3400, 6, 0.55, { dur: 0.06, decay: 30, grit: 0.5 });
        this.partials(b, 640, [1, 1.52, 2.17, 2.79, 3.61, 4.48, 5.93], 0.44, 7, 0);
        this.thump(b, 280, 130, 0.28, 32, 0);
        return this.pcm(b, 1.6);
    }

    /** Perfect deflection: brightest strike, blade sliding off in a long shing. */
    parry() {
        const b = this.buf(0.7);
        this.transient(b, 1.5, 190);
        this.band(b, 7200, 3800, 8, 0.55, { delay: 0.002, dur: 0.13, decay: 18, grit: 0.6 });
        this.partials(b, 1180, [1, 1.41, 2.03, 2.68, 3.47, 4.31], 0.42, 4.5, 0);
        this.partials(b, 840, [1, 2.32, 3.9], 0.26, 6, 0.001);
        return this.pcm(b, 1.7);
    }

    /** Guarded impact: duller steel with weight behind it. */
    block() {
        const b = this.buf(0.26);
        this.transient(b, 1.15, 110);
        this.thump(b, 220, 95, 0.7, 26, 0);
        this.noise(b, 0.45, 60, 0.35);
        this.partials(b, 410, [1, 1.58, 2.31, 3.12], 0.3, 18, 0);
        this.band(b, 2600, 1900, 4, 0.3, { dur: 0.05, decay: 40 });
        return this.pcm(b, 1.5);
    }

    /** Fast cut: tight air snap with a singing edge. */
    slash() {
        const b = this.buf(0.18);
        this.whoosh(b, 0.5, 0.25, 0.85);
        this.band(b, 3000, 6400, 10, 0.5, { delay: 0.01, dur: 0.15, attack: 0.03, decay: 6, grit: 0.35 });
        this.partials(b, 3400, [1, 1.33], 0.06, 22, 0.03);
        return this.pcm(b, 1.05);
    }

    /** Weighted cut: lower rush, longer singing edge. */
    heavy() {
        const b = this.buf(0.26);
        this.whoosh(b, 0.7, 0.1, 0.55);
        this.band(b, 1800, 4400, 8, 0.48, { dur: 0.24, attack: 0.05, decay: 6, grit: 0.3 });
        this.partials(b, 2100, [1, 1.41], 0.07, 14, 0.06);
        return this.pcm(b, 1.15);
    }

    /** Spear jab: rising steel hiss that ends in a hard tip snap. */
    thrust() {
        const b = this.buf(0.2);
        this.band(b, 1800, 6500, 7, 0.7, { dur: 0.09, attack: 0.01, decay: 8, grit: 0.5 });
        this.whoosh(b, 0.3, 0.4, 0.95);
        this.transient(b, 0.55, 170, 0.085);
        this.partials(b, 3900, [1, 1.47], 0.09, 25, 0.085);
        return this.pcm(b, 1.2);
    }

    /** Hammer: heavy iron rush with a rattling, humming head. */
    hammerSwing() {
        const b = this.buf(0.36);
        this.whoosh(b, 1.1, 0.05, 0.3);
        this.band(b, 230, 140, 3, 0.45, { attack: 0.1, decay: 4, grit: 0.8 });
        this.band(b, 950, 620, 6, 0.16, { attack: 0.08, decay: 8, grit: 0.9 });
        this.partials(b, 180, [1, 2.76, 5.4], 0.09, 6, 0.04);
        return this.pcm(b, 1.3);
    }

    /** Edge biting into a target: steel tick, then a meaty thud and tear. */
    hit() {
        const b = this.buf(0.22);
        this.transient(b, 1.2, 150);
        this.partials(b, 2300, [1, 1.53, 2.21], 0.22, 38, 0);
        this.thump(b, 190, 55, 0.95, 20, 0);
        this.noise(b, 0.55, 38, 0.18);
        this.band(b, 1200, 480, 2, 0.35, { decay: 30, grit: 0.7 });
        return this.pcm(b, 1.75);
    }

    /** Player struck: armour plates clank and rattle over a body blow. */
    hurt() {
        const b = this.buf(0.3);
        this.transient(b, 1.0, 90);
        this.partials(b, 520, [1, 1.63, 2.42, 3.3], 0.28, 16, 0);
        this.thump(b, 160, 60, 0.8, 16, 0);
        this.noise(b, 0.4, 30, 0.25);
        for (let k = 0; k < 3; k++) {
            this.transient(b, 0.28 - k * 0.06, 220, 0.03 + k * 0.026);
            this.partials(b, 1450 + k * 380, [1, 1.47], 0.05, 45, 0.03 + k * 0.026);
        }
        return this.pcm(b, 1.6);
    }

    /** Finishing blow: massive impact, long grinding scrape, low ringing steel. */
    deathblow() {
        const b = this.buf(1.0);
        this.transient(b, 1.5, 60);
        this.thump(b, 150, 38, 1.3, 5, 0);
        this.partials(b, 330, [1, 1.49, 2.13, 2.87, 3.71, 4.69, 5.82], 0.46, 3.2, 0.002);
        this.band(b, 6000, 1800, 7, 0.5, { delay: 0.01, dur: 0.35, decay: 5, grit: 0.6 });
        this.noise(b, 0.75, 9, 0.2);
        return this.pcm(b, 1.9);
    }

    /** Dodge: cloth snap with a jingle of armour lacing. */
    dodge() {
        const b = this.buf(0.2);
        this.band(b, 900, 1700, 1.5, 0.9, { dur: 0.1, attack: 0.012, decay: 28 });
        this.whoosh(b, 0.35, 0.2, 0.6);
        for (let k = 0; k < 4; k++) {
            this.partials(b, 2600 + k * 730, [1, 1.38], 0.07, 40, 0.02 + k * 0.018);
        }
        return this.pcm(b, 1.6);
    }

    /** Perilous warning: dissonant struck gong. */
    perilous() {
        const b = this.buf(0.6);
        this.transient(b, 0.9, 70);
        this.partials(b, 300, [1, 1.59, 2.14, 2.92, 3.78], 0.36, 4, 0);
        this.partials(b, 318, [1, 2.4], 0.26, 4.5, 0.001);
        this.band(b, 3200, 2200, 9, 0.2, { attack: 0.02, decay: 10 });
        return this.pcm(b, 1.6);
    }

    /** Posture break: heavy steel cracking apart. */
    postureBreak() {
        const b = this.buf(0.95);
        this.transient(b, 1.3, 45);
        this.thump(b, 120, 45, 1.1, 4.5, 0);
        this.partials(b, 190, [1, 1.47, 2.31, 3.06, 4.2], 0.4, 3.6, 0);
        this.transient(b, 0.6, 120, 0.06);
        this.transient(b, 0.45, 140, 0.11);
        this.transient(b, 0.3, 160, 0.17);
        this.band(b, 4000, 1200, 5, 0.4, { decay: 5, grit: 0.9 });
        this.noise(b, 0.55, 12, 0.25);
        return this.pcm(b, 1.75);
    }

    /** Healing: small struck bell. */
    heal() {
        const b = this.buf(0.6);
        this.transient(b, 0.2, 200);
        this.partials(b, 1320, [1, 2.76, 5.4], 0.22, 5, 0);
        this.partials(b, 1980, [1, 2.76], 0.16, 5.5, 0.07);
        return this.pcm(b, 1.1);
    }

    /** Shrine / confirm: temple singing bowl. */
    shrine() {
        const b = this.buf(1.4);
        this.transient(b, 0.5, 150);
        this.partials(b, 523, [1, 2.71, 5.15, 8.1], 0.32, 1.8, 0);
        this.partials(b, 784, [1, 2.71], 0.15, 2.2, 0);
        return this.pcm(b, 1.0);
    }

    /** Iai: blade scraping out of the saya, a click, then a ringing shing. */
    iai() {
        const b = this.buf(0.42);
        this.band(b, 1400, 4800, 9, 0.65, { dur: 0.14, attack: 0.1, grit: 0.55 });
        this.transient(b, 0.8, 180, 0.14);
        this.partials(b, 3600, [1, 1.38, 1.91, 2.52], 0.22, 7, 0.14);
        this.whoosh(b, 0.25, 0.3, 0.9);
        return this.pcm(b, 1.85);
    }
}
