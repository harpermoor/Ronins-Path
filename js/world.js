'use strict';

/** Procedurally generated open world: biomes, roads, forests, ponds, camps and shrines. */
const WORLD_SIZE = 8000, CELL = 200, CHUNK = 256;

const K = { PINE: 0, SAKURA: 1, MAPLE: 2, BAMBOO: 3, ROCK: 4, POND: 5, TENT: 6, HOUSE: 7, FIRE: 8, SHRINE: 9, POST: 10, LANTERN: 11, BANNER: 12 };
const isTree = o => o.kind <= K.BAMBOO;

const SHRINE_NAMES = ['First Ember Sanctuary', 'Shrine of the Pale Moon', 'Petalfall Reliquary', 'The Broken Belfry',
    'Shrine of the Withered Crown', 'Silent Pilgrim Shrine', 'Stillwater Sanctuary', 'The Last Lantern'];
const ELITES = [['Veyr, the Veiled Knight', 'RONIN'], ['Mourn, the Bell Warden', 'BRUTE'],
    ['Seris of the Thorn Oath', 'SPEAR'], ['Aster, the Fallen Crown', 'RONIN'], ['The Hollow Prior', 'SPEAR']];
const FINAL_BOSS_NAME = 'The Cinder Regent';
const GROUND_BASE = [rgb(76, 91, 70), rgb(105, 78, 48), rgb(58, 78, 59)];

class World {
    constructor(seed) {
        this.seed = seed;
        this.seed32 = new Rng(seed + 1).nextU32() | 0;
        this.rnd = new Rng(seed);
        this.obstacles = [];
        this.fires = [];
        this.camps = [];
        this.shrines = [];
        this.roads = [];
        this.gw = Math.floor(WORLD_SIZE / CELL) + 1;
        this.grid = [];
        for (let i = 0; i < this.gw * this.gw; i++) this.grid.push([]);
        this.stampCounter = 1;
        this.chunks = new Map();
        this.sprites = new Map();
        this.tile = makeCanvas(CHUNK / 4, CHUNK / 4);
        this.tileCtx = this.tile.getContext('2d');
        this.generate();
        this.buildMinimap();
    }

    // ---------------- noise ----------------
    hash(x, y) {
        let h = this.seed32 ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul((y | 0) + 0x3c6ef372, 0x165667b1);
        h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
        h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
        h ^= h >>> 16;
        return (h & 0xffffff) / 0xffffff;
    }

    vnoise(x, y) {
        const xi = Math.floor(x), yi = Math.floor(y);
        const fx = x - xi, fy = y - yi;
        const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
        const a = this.hash(xi, yi), b = this.hash(xi + 1, yi), c = this.hash(xi, yi + 1), d = this.hash(xi + 1, yi + 1);
        return U.lerp(U.lerp(a, b, u), U.lerp(c, d, u), v);
    }

    fbm(x, y) {
        return this.vnoise(x, y) * 0.55 + this.vnoise(x * 2.1 + 17, y * 2.1 + 9) * 0.3 + this.vnoise(x * 4.3 + 41, y * 4.3 + 3) * 0.15;
    }

    /** 0 = sakura fields, 1 = autumn maple, 2 = bamboo. */
    biome(x, y) {
        const n = this.fbm(x / 2200 + 100, y / 2200 + 100);
        if (n < 0.40) return 1;
        if (n > 0.60) return 2;
        return 0;
    }

    biomeName(x, y) {
        switch (this.biome(x, y)) {
            case 1: return 'The Withered March';
            case 2: return 'Pilgrim Graves';
            default: return 'The Gloam Weald';
        }
    }

    groundColor(x, y) {
        const base = GROUND_BASE[this.biome(x, y)];
        const n = this.fbm(x / 140, y / 140);
        return U.shade(base, 0.82 + n * 0.32);
    }

    // ---------------- generation ----------------
    generate() {
        const rnd = this.rnd, S = WORLD_SIZE;
        // shrines
        const spawn = { x: S / 2, y: S / 2, name: SHRINE_NAMES[0], discovered: true };
        this.shrines.push(spawn);
        for (let tries = 0; tries < 4000 && this.shrines.length < SHRINE_NAMES.length; tries++) {
            const x = 600 + rnd.nextDouble() * (S - 1200), y = 600 + rnd.nextDouble() * (S - 1200);
            let ok = true;
            for (const s of this.shrines) if (U.dist(x, y, s.x, s.y) < 1900) ok = false;
            if (!ok) continue;
            this.shrines.push({ x, y, name: SHRINE_NAMES[this.shrines.length], discovered: false });
        }
        // camps
        for (let tries = 0; tries < 6000 && this.camps.length < 17; tries++) {
            const x = 500 + rnd.nextDouble() * (S - 1000), y = 500 + rnd.nextDouble() * (S - 1000);
            if (U.dist(x, y, spawn.x, spawn.y) < 1100) continue;
            let ok = true;
            for (const c of this.camps) if (U.dist(x, y, c.x, c.y) < 1100) ok = false;
            for (const s of this.shrines) if (U.dist(x, y, s.x, s.y) < 700) ok = false;
            if (!ok) continue;
            this.camps.push({ x, y, r: 240, elite: false, cleared: false, eliteName: null, eliteType: null, members: [] });
        }
        // the five camps farthest from spawn become elite strongholds
        const sorted = this.camps.slice().sort((a, b) => U.dist(b.x, b.y, spawn.x, spawn.y) - U.dist(a.x, a.y, spawn.x, spawn.y));
        for (let i = 0; i < Math.min(ELITES.length, sorted.length); i++) {
            const c = sorted[i];
            c.elite = true;
            c.r = 300;
            c.eliteName = ELITES[i][0];
            c.eliteType = ELITES[i][1];
        }
        this.buildRoads();
        // ponds
        const ponds = [];
        for (let tries = 0; tries < 400 && ponds.length < 16; tries++) {
            const r = 90 + rnd.nextDouble() * 150;
            const x = r + 100 + rnd.nextDouble() * (S - 2 * r - 200), y = r + 100 + rnd.nextDouble() * (S - 2 * r - 200);
            if (this.nearRoad(x, y) < r + 60 || this.nearCamp(x, y) < r + 80 || this.nearShrine(x, y) < r + 220) continue;
            let ok = true;
            for (const p of ponds) if (U.dist(x, y, p.x, p.y) < r + p.r + 100) ok = false;
            if (!ok) continue;
            ponds.push(this.circle(K.POND, x, y, r));
        }
        // forests
        const step = 52;
        for (let gy = 0; gy < S; gy += step) {
            for (let gx = 0; gx < S; gx += step) {
                const x = gx + rnd.nextDouble() * step, y = gy + rnd.nextDouble() * step;
                const dens = this.fbm(x / 650, y / 650);
                const p = dens > 0.58 ? 0.8 : dens > 0.48 ? 0.28 : 0.035;
                if (rnd.nextDouble() > p) continue;
                const b = this.biome(x, y);
                const roll = rnd.nextDouble();
                let k;
                if (b === 1) k = roll < 0.65 ? K.MAPLE : K.PINE;
                else if (b === 2) k = roll < 0.85 ? K.BAMBOO : K.PINE;
                else k = roll < 0.35 ? K.SAKURA : K.PINE;
                const r = k === K.BAMBOO ? 11 : 15;
                if (!this.freeSpot(x, y, r + 30)) continue;
                const o = this.circle(k, x, y, r);
                o.canopy = k === K.BAMBOO ? 30 + rnd.nextDouble() * 10 : 42 + rnd.nextDouble() * 20;
                o.variant = rnd.nextInt(1000);
            }
        }
        // rocks
        for (let i = 0; i < 450; i++) {
            const x = rnd.nextDouble() * S, y = rnd.nextDouble() * S, r = 10 + rnd.nextDouble() * 26;
            if (!this.freeSpot(x, y, r + 30)) continue;
            this.circle(K.ROCK, x, y, r).variant = rnd.nextInt(1000);
        }
        // camp structures
        for (const c of this.camps) {
            this.fires.push(this.circle(K.FIRE, c.x, c.y, 14));
            const tents = c.elite ? 4 : 2 + rnd.nextInt(2);
            const a0 = rnd.nextDouble() * TAU;
            for (let i = 0; i < tents; i++) {
                const a = a0 + i * TAU / tents;
                const tx = c.x + Math.cos(a) * (c.r - 60), ty = c.y + Math.sin(a) * (c.r - 60);
                const house = c.elite && i % 2 === 0;
                this.rect(house ? K.HOUSE : K.TENT, tx, ty, house ? 110 : 64, house ? 80 : 48).variant = rnd.nextInt(1000);
            }
            const banners = c.elite ? 6 : 2;
            for (let i = 0; i < banners; i++) {
                const a = a0 + Math.PI / tents + i * TAU / banners;
                this.circle(K.BANNER, c.x + Math.cos(a) * (c.r - 10), c.y + Math.sin(a) * (c.r - 10), 5).variant = c.elite ? 1 : 0;
            }
        }
        // shrine structures
        for (const s of this.shrines) {
            this.circle(K.SHRINE, s.x, s.y - 10, 24);
            this.circle(K.POST, s.x - 48, s.y + 95, 6);
            this.circle(K.POST, s.x + 48, s.y + 95, 6);
            this.circle(K.LANTERN, s.x - 70, s.y + 10, 9);
            this.circle(K.LANTERN, s.x + 70, s.y + 10, 9);
        }
    }

    buildRoads() {
        const nodes = [];
        for (const s of this.shrines) nodes.push([s.x, s.y + 120]);
        for (const c of this.camps) nodes.push([c.x, c.y]);
        const n = nodes.length;
        const inTree = new Array(n).fill(false), best = new Array(n).fill(Infinity), from = new Array(n).fill(0);
        best[0] = 0;
        from[0] = -1;
        for (let it = 0; it < n; it++) {
            let u = -1;
            for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
            inTree[u] = true;
            if (from[u] >= 0) this.addRoad(nodes[from[u]], nodes[u]);
            for (let v = 0; v < n; v++) {
                if (inTree[v]) continue;
                const d = U.dist(nodes[u][0], nodes[u][1], nodes[v][0], nodes[v][1]);
                if (d < best[v]) {
                    best[v] = d;
                    from[v] = u;
                }
            }
        }
    }

    addRoad(a, b) {
        const segs = 8;
        let px = a[0], py = a[1];
        let nx = -(b[1] - a[1]), ny = b[0] - a[0];
        const len = Math.hypot(nx, ny);
        nx /= len;
        ny /= len;
        const wob = this.rnd.nextDouble() * 6;
        for (let i = 1; i <= segs; i++) {
            const t = i / segs;
            const off = i === segs ? 0 : Math.sin(t * TAU + wob) * 120 * Math.sin(t * Math.PI);
            const x = U.lerp(a[0], b[0], t) + nx * off, y = U.lerp(a[1], b[1], t) + ny * off;
            this.roads.push([px, py, x, y]);
            px = x;
            py = y;
        }
    }

    nearRoad(x, y) {
        let best = Infinity;
        for (const s of this.roads) best = Math.min(best, U.segDist(x, y, s[0], s[1], s[2], s[3]));
        return best;
    }

    nearCamp(x, y) {
        let best = Infinity;
        for (const c of this.camps) best = Math.min(best, U.dist(x, y, c.x, c.y) - c.r);
        return best;
    }

    nearShrine(x, y) {
        let best = Infinity;
        for (const s of this.shrines) best = Math.min(best, U.dist(x, y, s.x, s.y));
        return best;
    }

    freeSpot(x, y, pad) {
        if (x < pad || y < pad || x > WORLD_SIZE - pad || y > WORLD_SIZE - pad) return false;
        if (this.nearCamp(x, y) < pad || this.nearShrine(x, y) < 200 + pad) return false;
        if (this.nearRoad(x, y) < 28 + pad) return false;
        for (const o of this.query(x, y, pad)) {
            if (o.kind === K.POND ? U.dist(x, y, o.x, o.y) < o.r + pad : U.dist(x, y, o.x, o.y) < o.r + pad - 10) return false;
        }
        return true;
    }

    newObstacle(kind) {
        return { kind, x: 0, y: 0, r: 0, w: 0, h: 0, canopy: 0, rect: false, variant: 0, stamp: 0 };
    }

    circle(k, x, y, r) {
        const o = this.newObstacle(k);
        o.x = x;
        o.y = y;
        o.r = r;
        this.insert(o, x - r, y - r, x + r, y + r);
        return o;
    }

    rect(k, cx, cy, w, h) {
        const o = this.newObstacle(k);
        o.rect = true;
        o.x = cx - w / 2;
        o.y = cy - h / 2;
        o.w = w;
        o.h = h;
        this.insert(o, o.x, o.y, o.x + w, o.y + h);
        return o;
    }

    insert(o, x0, y0, x1, y1) {
        this.obstacles.push(o);
        const cx0 = this.cell(x0), cy0 = this.cell(y0), cx1 = this.cell(x1), cy1 = this.cell(y1);
        for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) this.grid[cy * this.gw + cx].push(o);
    }

    cell(v) { return Math.floor(U.clamp(v / CELL, 0, this.gw - 1)); }

    query(x, y, r) {
        const out = [];
        const stamp = this.stampCounter++;
        const cx0 = this.cell(x - r), cy0 = this.cell(y - r), cx1 = this.cell(x + r), cy1 = this.cell(y + r);
        for (let cy = cy0; cy <= cy1; cy++) {
            for (let cx = cx0; cx <= cx1; cx++) {
                for (const o of this.grid[cy * this.gw + cx]) {
                    if (o.stamp === stamp) continue;
                    o.stamp = stamp;
                    out.push(o);
                }
            }
        }
        return out;
    }

    /** Push an actor out of every obstacle it overlaps. */
    resolve(a) {
        for (let iter = 0; iter < 2; iter++) {
            for (const o of this.query(a.x, a.y, a.r + 2)) {
                if (o.kind === K.BANNER) continue;
                if (o.rect) {
                    const cx = U.clamp(a.x, o.x, o.x + o.w), cy = U.clamp(a.y, o.y, o.y + o.h);
                    const dx = a.x - cx, dy = a.y - cy, d = Math.hypot(dx, dy);
                    if (d < a.r) {
                        if (d < 0.001) {
                            a.y = o.y - a.r;
                        } else {
                            a.x = cx + dx / d * a.r;
                            a.y = cy + dy / d * a.r;
                        }
                    }
                } else {
                    let dx = a.x - o.x, d = Math.hypot(dx, a.y - o.y);
                    const dy = a.y - o.y, min = a.r + o.r;
                    if (d < min) {
                        if (d < 0.001) {
                            dx = 1;
                            d = 1;
                        }
                        a.x = o.x + dx / d * min;
                        a.y = o.y + dy / d * min;
                    }
                }
            }
        }
        a.x = U.clamp(a.x, a.r, WORLD_SIZE - a.r);
        a.y = U.clamp(a.y, a.r, WORLD_SIZE - a.r);
    }

    /** True if a projectile at this point would hit something solid (water does not block). */
    solidAt(x, y) {
        if (x < 0 || y < 0 || x > WORLD_SIZE || y > WORLD_SIZE) return true;
        for (const o of this.query(x, y, 1)) {
            if (o.kind === K.POND || o.kind === K.BANNER) continue;
            if (o.rect ? (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) : U.dist(x, y, o.x, o.y) < o.r) return true;
        }
        return false;
    }

    // ---------------- rendering ----------------
    chunk(cx, cy) {
        const key = cx + ',' + cy;
        let img = this.chunks.get(key);
        if (img) {
            this.chunks.delete(key);
            this.chunks.set(key, img);
            return img;
        }
        img = makeCanvas(CHUNK, CHUNK);
        const g = img.getContext('2d');
        const ox = cx * CHUNK, oy = cy * CHUNK, N = CHUNK / 4;
        const id = this.tileCtx.createImageData(N, N), px = id.data;
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                const c = this.groundColor(ox + x * 4, oy + y * 4), i = (y * N + x) * 4;
                px[i] = c[0];
                px[i + 1] = c[1];
                px[i + 2] = c[2];
                px[i + 3] = 255;
            }
        }
        this.tileCtx.putImageData(id, 0, 0);
        g.imageSmoothingEnabled = false;
        g.drawImage(this.tile, 0, 0, CHUNK, CHUNK);
        g.imageSmoothingEnabled = true;
        const r = new Rng((Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) + this.seed32);
        setStroke(g, 1, false);
        for (let i = 0; i < 140; i++) {
            const x = r.nextInt(CHUNK), y = r.nextInt(CHUNK);
            const c = this.groundColor(ox + x, oy + y);
            g.strokeStyle = css(r.nextBoolean() ? U.shade(c, 1.25) : U.shade(c, 0.75));
            strokeLine(g, x + 0.5, y + 0.5, x + r.nextInt(3) - 1 + 0.5, y - 3 - r.nextInt(3) + 0.5);
        }
        // flowers
        const b = this.biome(ox + CHUNK / 2, oy + CHUNK / 2);
        g.fillStyle = b === 1 ? 'rgb(163,122,72)' : b === 2 ? 'rgb(148,153,139)' : 'rgb(193,169,148)';
        for (let i = 0; i < 6; i++) fillEllipse(g, r.nextInt(CHUNK), r.nextInt(CHUNK), 3, 3);
        g.translate(-ox, -oy);
        // camp dirt & shrine plazas
        for (const c of this.camps) {
            if (Math.abs(c.x - ox - CHUNK / 2) > c.r + CHUNK || Math.abs(c.y - oy - CHUNK / 2) > c.r + CHUNK) continue;
            g.fillStyle = 'rgba(87,83,70,0.85)';
            fillCircle(g, c.x, c.y, c.r);
            g.fillStyle = 'rgba(61,62,56,0.7)';
            fillCircle(g, c.x, c.y, c.r * 0.6);
            g.strokeStyle = 'rgba(161,147,110,0.3)';
            setStroke(g, 2, false);
            g.beginPath();
            g.arc(c.x, c.y, c.r * 0.68, 0, TAU);
            g.stroke();
            if (c.elite) {
                for (let i = 0; i < 8; i++) {
                    const a = i * TAU / 8, d = c.r * 0.72;
                    g.fillStyle = 'rgba(176,157,111,0.4)';
                    g.fillRect(c.x + Math.cos(a) * d - 5, c.y + Math.sin(a) * d - 5, 10, 10);
                }
            }
        }
        for (const s of this.shrines) {
            if (Math.abs(s.x - ox - CHUNK / 2) > 250 + CHUNK || Math.abs(s.y - oy - CHUNK / 2) > 250 + CHUNK) continue;
            g.fillStyle = 'rgb(150,146,136)';
            fillEllipse(g, s.x - 110, s.y - 90, 220, 190);
            g.fillStyle = 'rgb(170,166,156)';
            g.fillRect(s.x - 30, s.y + 60, 60, 80);
            g.strokeStyle = 'rgb(120,116,108)';
            setStroke(g, 1, false);
            for (let i = 0; i < 6; i++) strokeLine(g, s.x - 110, s.y - 60 + i * 30, s.x + 110, s.y - 60 + i * 30);
        }
        // roads
        const near = this.roads.filter(s => this.segNearChunk(s, ox, oy));
        if (near.length) {
            const path = () => {
                g.beginPath();
                for (const s of near) {
                    g.moveTo(s[0], s[1]);
                    g.lineTo(s[2], s[3]);
                }
                g.stroke();
            };
            setStroke(g, 48, true);
            g.strokeStyle = 'rgb(90,85,68)';
            path();
            setStroke(g, 34, true);
            g.strokeStyle = 'rgb(120,111,88)';
            path();
        }
        this.chunks.set(key, img);
        if (this.chunks.size > 160) this.chunks.delete(this.chunks.keys().next().value);
        return img;
    }

    segNearChunk(s, ox, oy) {
        const pad = 40;
        return Math.max(s[0], s[2]) > ox - pad && Math.min(s[0], s[2]) < ox + CHUNK + pad && Math.max(s[1], s[3]) > oy - pad
            && Math.min(s[1], s[3]) < oy + CHUNK + pad;
    }

    drawGround(g, l, t, r, b) {
        const cx0 = Math.floor(Math.max(0, l) / CHUNK), cy0 = Math.floor(Math.max(0, t) / CHUNK);
        const cx1 = Math.floor(Math.min(WORLD_SIZE - 1, r) / CHUNK), cy1 = Math.floor(Math.min(WORLD_SIZE - 1, b) / CHUNK);
        // +1px overlap hides seams between chunks when the camera sits on sub-pixel positions
        for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) g.drawImage(this.chunk(cx, cy), cx * CHUNK, cy * CHUNK, CHUNK + 1, CHUNK + 1);
    }

    visible(l, t, r, b) {
        const cx = (l + r) / 2, cy = (t + b) / 2;
        return this.query(cx, cy, Math.max(r - l, b - t) / 2 + 80).filter(o => {
            const pad = Math.max(o.canopy, o.r) + (o.rect ? Math.max(o.w, o.h) : 0) + 20;
            return !(o.x + pad < l || o.x - pad > r || o.y + pad < t || o.y - pad > b);
        });
    }

    drawPonds(g, vis, time) {
        for (const o of vis) {
            if (o.kind !== K.POND) continue;
            const r = o.r;
            g.fillStyle = 'rgb(98,106,94)';
            fillCircle(g, o.x, o.y, r + 12);
            g.fillStyle = 'rgb(30,49,60)';
            fillCircle(g, o.x, o.y, r);
            g.fillStyle = 'rgb(43,68,75)';
            fillEllipse(g, o.x - r * 0.75, o.y - r * 0.8, r * 1.4, r * 1.35);
            g.strokeStyle = 'rgba(200,230,255,0.275)';
            setStroke(g, 2, false);
            for (let i = 0; i < 5; i++) {
                const a = time * 0.3 + i * 1.3;
                const px = o.x + Math.cos(a + i) * r * 0.45, py = o.y + Math.sin(a * 0.7 + i * 2) * r * 0.45;
                strokeLine(g, px - 12, py, px + 12, py);
            }
            // lily pads
            const rr = new Rng(Math.floor(o.x * 7 + o.y));
            for (let i = 0; i < 5; i++) {
                const a = rr.nextDouble() * 6.28, d = r * (0.3 + rr.nextDouble() * 0.55);
                const px = o.x + Math.cos(a) * d, py = o.y + Math.sin(a) * d;
                g.fillStyle = 'rgb(70,130,60)';
                g.beginPath();
                g.moveTo(px, py);
                g.arc(px, py, 8, 30 * DEG, 330 * DEG);
                g.closePath();
                g.fill();
                if (i === 0) {
                    g.fillStyle = 'rgb(255,200,220)';
                    fillCircle(g, px, py, 3);
                }
            }
        }
    }

    spriteKey(o, layer) {
        return layer + '|' + o.kind + '|' + (o.variant % 12) + '|' + Math.floor(o.canopy / 5);
    }

    /** Trunk + ground shadow, centered on the trunk. */
    baseSprite(o) {
        const key = this.spriteKey(o, 0);
        let img = this.sprites.get(key);
        if (img) return img;
        const cr = Math.floor(o.canopy / 5) * 5 + 2.5;
        const size = Math.floor(cr * 2 + 50);
        img = makeCanvas(size, size);
        const g = img.getContext('2d');
        g.translate(size / 2, size / 2);
        if (o.kind === K.BAMBOO) {
            g.fillStyle = 'rgba(0,0,0,0.25)';
            fillEllipse(g, -16, -4, 40, 24);
            g.fillStyle = 'rgb(89,95,85)';
            g.fillRect(-13, -9, 26, 18);
        } else {
            g.fillStyle = 'rgba(0,0,0,0.196)';
            fillEllipse(g, -cr * 0.8 + 14, -cr * 0.6 + 18, cr * 1.6, cr * 1.3);
            g.fillStyle = 'rgb(82,58,40)';
            fillCircle(g, 0, 0, o.r);
        }
        this.sprites.set(key, img);
        return img;
    }

    canopySprite(o) {
        const key = this.spriteKey(o, 1);
        let img = this.sprites.get(key);
        if (img) return img;
        const cr = Math.floor(o.canopy / 5) * 5 + 2.5;
        const size = Math.floor(cr * 2 + 50);
        img = makeCanvas(size, size);
        const g = img.getContext('2d');
        g.translate(size / 2, size / 2);
        const v = o.variant % 12;
        if (o.kind === K.BAMBOO) {
            g.fillStyle = 'rgb(107,115,108)';
            roundRectPath(g, -10, -23, 20, 32, 8);
            g.fill();
            g.fillStyle = 'rgb(53,63,57)';
            g.fillRect(-2, -18, 4, 17);
            g.fillRect(-7, -13, 14, 3);
            g.strokeStyle = 'rgb(145,149,133)';
            setStroke(g, 1, false);
            strokeLine(g, -8, -5, -4, 5);
            this.sprites.set(key, img);
            return img;
        }
        let base;
        switch (o.kind) {
            case K.SAKURA: base = rgb(154, 145, 120); break;
            case K.MAPLE: base = v % 3 === 0 ? rgb(176, 119, 48) : rgb(157, 69, 48); break;
            case K.BAMBOO: base = rgb(83, 119, 67); break;
            default: base = rgb(44, 68, 51);
        }
        const rr = new Rng(v * 31 + o.kind);
        const blobs = o.kind === K.BAMBOO ? 4 : 6;
        const crown = (x, y, radius) => {
            g.beginPath();
            for (let i = 0; i < 18; i++) {
                const a = i * TAU / 18, d = radius * (i % 2 === 0 ? 1 : 0.72 + rr.nextDouble() * 0.12);
                const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
                if (i === 0) g.moveTo(px, py);
                else g.lineTo(px, py);
            }
            g.closePath();
            g.fill();
        };
        g.fillStyle = css(U.shade(base, 0.75));
        crown(0, 0, cr);
        for (let i = 0; i < blobs; i++) {
            const ang = rr.nextDouble() * 6.28, dd = cr * 0.45 * rr.nextDouble();
            const br = cr * (0.45 + rr.nextDouble() * 0.25);
            const bx = Math.cos(ang) * dd, by = Math.sin(ang) * dd - 4;
            g.fillStyle = css(U.shade(base, 0.9 + rr.nextDouble() * 0.25));
            crown(bx, by, br);
        }
        g.strokeStyle = css(U.shade(base, 0.45));
        setStroke(g, 3, true);
        for (let i = 0; i < 5; i++) {
            const a = i * TAU / 5 + v;
            const bx = Math.cos(a) * cr * 0.7, by = Math.sin(a) * cr * 0.7;
            strokeLine(g, 0, 0, bx, by);
            strokeLine(g, bx * 0.7, by * 0.7, bx - Math.sin(a) * 10, by + Math.cos(a) * 10);
        }
        g.fillStyle = css(U.alpha(U.shade(base, 1.3), 0.25));
        crown(-cr * 0.2, -cr * 0.25, cr * 0.45);
        if (o.kind === K.SAKURA) {
            g.fillStyle = 'rgb(203,193,157)';
            for (let i = 0; i < 14; i++) {
                const ang = rr.nextDouble() * 6.28, dd = cr * 0.85 * Math.sqrt(rr.nextDouble());
                fillCircle(g, Math.cos(ang) * dd, Math.sin(ang) * dd, 1.5);
            }
        }
        this.sprites.set(key, img);
        return img;
    }

    drawObstacles(g, vis, time) {
        for (const o of vis) {
            switch (o.kind) {
                case K.PINE: case K.SAKURA: case K.MAPLE: case K.BAMBOO: {
                    const img = this.baseSprite(o);
                    g.drawImage(img, Math.round(o.x - img.width / 2), Math.round(o.y - img.height / 2));
                    break;
                }
                case K.ROCK:
                    g.fillStyle = 'rgba(0,0,0,0.235)';
                    fillCircle(g, o.x + 5, o.y + 7, o.r);
                    g.fillStyle = 'rgb(112,112,108)';
                    fillCircle(g, o.x, o.y, o.r);
                    g.fillStyle = 'rgb(140,140,134)';
                    fillEllipse(g, o.x - o.r * 0.8, o.y - o.r * 0.85, o.r * 1.3, o.r * 1.2);
                    g.fillStyle = 'rgba(90,120,70,0.588)';
                    fillEllipse(g, o.x - o.r * 0.3, o.y - o.r * 0.9, o.r * 0.7, o.r * 0.5);
                    break;
                case K.TENT:
                    g.fillStyle = 'rgba(0,0,0,0.235)';
                    g.fillRect(o.x + 6, o.y + 8, o.w, o.h);
                    g.fillStyle = 'rgb(92,92,83)';
                    g.fillRect(o.x, o.y, o.w, o.h);
                    g.fillStyle = 'rgb(66,69,63)';
                    g.fillRect(o.x, o.y + o.h / 2, o.w, o.h / 2);
                    g.strokeStyle = 'rgb(134,127,107)';
                    setStroke(g, 2, false);
                    strokeLine(g, o.x, o.y + o.h / 2, o.x + o.w, o.y + o.h / 2);
                    for (let i = 1; i < 4; i++) strokeLine(g, o.x + o.w * i / 4, o.y, o.x + o.w * i / 4, o.y + o.h);
                    g.fillStyle = 'rgb(38,42,39)';
                    g.fillRect(o.x + 10, o.y + 8, o.w - 20, o.h - 16);
                    g.fillStyle = 'rgb(124,117,98)';
                    g.fillRect(o.x + 4, o.y - 3, 14, 14);
                    g.fillRect(o.x + o.w - 17, o.y + o.h - 10, 13, 13);
                    break;
                case K.HOUSE:
                    g.fillStyle = 'rgba(0,0,0,0.275)';
                    g.fillRect(o.x + 8, o.y + 10, o.w, o.h);
                    g.fillStyle = 'rgb(76,78,72)';
                    g.fillRect(o.x - 6, o.y - 6, o.w + 12, o.h + 12);
                    g.fillStyle = 'rgb(115,112,98)';
                    g.fillRect(o.x, o.y, o.w, o.h / 2);
                    g.fillStyle = 'rgb(90,90,79)';
                    g.fillRect(o.x, o.y + o.h / 2, o.w, o.h / 2);
                    g.strokeStyle = 'rgb(58,60,54)';
                    setStroke(g, 2, false);
                    for (let i = 1; i < 8; i++) strokeLine(g, o.x + o.w * i / 8, o.y, o.x + o.w * i / 8, o.y + o.h);
                    setStroke(g, 4, false);
                    g.strokeStyle = 'rgb(160,146,109)';
                    strokeLine(g, o.x - 6, o.y + o.h / 2, o.x + o.w + 6, o.y + o.h / 2);
                    g.fillStyle = 'rgb(34,39,36)';
                    for (let i = 1; i <= 3; i++) {
                        roundRectPath(g, o.x + i * o.w / 4 - 7, o.y + 7, 14, o.h - 14, 7);
                        g.fill();
                    }
                    g.fillStyle = 'rgb(137,133,116)';
                    g.fillRect(o.x - 8, o.y - 8, 20, 20);
                    g.fillRect(o.x + o.w - 12, o.y - 8, 20, 20);
                    break;
                case K.FIRE: {
                    g.fillStyle = 'rgb(80,80,80)';
                    fillCircle(g, o.x, o.y, 18);
                    const fl = 0.8 + 0.2 * Math.sin(time * 17 + o.x);
                    g.fillStyle = 'rgba(255,120,30,0.353)';
                    fillCircle(g, o.x, o.y, 40 * fl);
                    g.fillStyle = 'rgb(255,140,40)';
                    fillCircle(g, o.x, o.y, 11 * fl);
                    g.fillStyle = 'rgb(255,230,120)';
                    fillCircle(g, o.x, o.y, 5 * fl);
                    break;
                }
                case K.SHRINE: {
                    g.fillStyle = 'rgba(0,0,0,0.275)';
                    g.fillRect(o.x - 30, o.y - 22, 70, 60);
                    g.fillStyle = 'rgb(87,88,77)';
                    g.fillRect(o.x - 36, o.y - 30, 72, 58);
                    g.fillStyle = 'rgb(122,119,101)';
                    g.fillRect(o.x - 30, o.y - 24, 60, 22);
                    g.fillStyle = 'rgb(102,102,87)';
                    g.fillRect(o.x - 30, o.y - 2, 60, 22);
                    g.fillStyle = 'rgb(170,156,112)';
                    fillEllipse(g, o.x - 12, o.y - 22, 24, 30);
                    g.strokeStyle = 'rgb(75,76,66)';
                    setStroke(g, 2, false);
                    strokeLine(g, o.x, o.y - 18, o.x, o.y + 4);
                    strokeLine(g, o.x - 6, o.y - 10, o.x + 6, o.y - 10);
                    const glow = 0.6 + 0.4 * Math.sin(time * 2);
                    g.fillStyle = css(rgb(255, 210, 120, Math.floor(120 * glow)));
                    fillCircle(g, o.x, o.y + 32, 35);
                    g.fillStyle = 'rgb(229,200,129)';
                    fillEllipse(g, o.x - 4, o.y + 16, 8, 24);
                    Draw.glint(g, o.x, o.y + 30, 7 + glow * 4, rgb(255, 229, 166));
                    break;
                }
                case K.POST:
                    g.fillStyle = 'rgb(145,139,119)';
                    g.fillRect(o.x - o.r, o.y - o.r, o.r * 2, o.r * 2);
                    break;
                case K.LANTERN: {
                    g.fillStyle = 'rgb(130,128,120)';
                    g.fillRect(o.x - 9, o.y - 9, 18, 18);
                    const glow = 0.7 + 0.3 * Math.sin(time * 3 + o.x);
                    g.fillStyle = css(rgb(255, 200, 100, Math.floor(60 * glow)));
                    fillCircle(g, o.x, o.y, 28);
                    g.fillStyle = 'rgb(255,220,140)';
                    g.fillRect(o.x - 4, o.y - 4, 8, 8);
                    break;
                }
            }
        }
    }

    /** Drawn above characters. Canopies close to the player fade so you can still see yourself. */
    drawCanopies(g, vis, px, py, time) {
        for (const o of vis) {
            if (isTree(o)) {
                const near = U.dist(px, py, o.x, o.y) < o.canopy + 20;
                const sway = Math.sin(time * 1.2 + o.variant) * 2;
                const img = this.canopySprite(o);
                if (near) g.globalAlpha = 0.35;
                g.drawImage(img, Math.round(o.x + sway - img.width / 2), Math.round(o.y - img.height / 2));
                if (near) g.globalAlpha = 1;
            } else if (o.kind === K.BANNER) {
                const wave = Math.sin(time * 4 + o.x * 0.1) * 4;
                g.fillStyle = 'rgb(60,40,30)';
                fillCircle(g, o.x, o.y, 3);
                g.fillStyle = o.variant === 1 ? 'rgb(95,82,65)' : 'rgb(104,54,47)';
                g.beginPath();
                g.moveTo(o.x, o.y - 2);
                g.lineTo(o.x + 26 + wave, o.y - 6);
                g.lineTo(o.x + 24 + wave, o.y + 10);
                g.lineTo(o.x + 16 + wave, o.y + 4);
                g.lineTo(o.x + 13 + wave, o.y + 11);
                g.lineTo(o.x, o.y + 6);
                g.closePath();
                g.fill();
            }
        }
        // Weathered stone lintels above the sanctuary entrance.
        for (const s of this.shrines) {
            if (Math.abs(s.x - px) > 1400 || Math.abs(s.y - py) > 1000) continue;
            g.fillStyle = 'rgb(119,115,98)';
            g.fillRect(s.x - 72, s.y + 86, 144, 12);
            g.fillStyle = 'rgb(71,74,65)';
            g.fillRect(s.x - 80, s.y + 80, 160, 7);
            g.fillStyle = 'rgb(185,163,103)';
            g.fillRect(s.x - 4, s.y + 84, 8, 10);
        }
    }

    drawAtmosphere(g, l, t, r, b, time) {
        g.save();
        g.fillStyle = 'rgba(12,19,26,0.16)';
        g.fillRect(l, t, r - l, b - t);
        const w = r - l, h = b - t;
        for (let i = 0; i < 2; i++) {
            const x = l + w * (0.25 + i * 0.5) + Math.sin(time * 0.05 + i) * 80;
            const y = t + h * (0.3 + i * 0.4);
            const fog = g.createRadialGradient(x, y, 0, x, y, w * 0.5);
            fog.addColorStop(0, 'rgba(147,161,157,0.07)');
            fog.addColorStop(1, 'rgba(147,161,157,0)');
            g.fillStyle = fog;
            g.fillRect(l, t, w, h);
        }
        g.restore();
    }

    buildMinimap() {
        const M = 200;
        this.minimap = makeCanvas(M, M);
        const g = this.minimap.getContext('2d');
        const sc = WORLD_SIZE / M;
        const id = g.createImageData(M, M), px = id.data;
        for (let y = 0; y < M; y++) {
            for (let x = 0; x < M; x++) {
                const c = U.shade(this.groundColor(x * sc, y * sc), 0.8), i = (y * M + x) * 4;
                px[i] = c[0];
                px[i + 1] = c[1];
                px[i + 2] = c[2];
                px[i + 3] = 255;
            }
        }
        g.putImageData(id, 0, 0);
        g.scale(1 / sc, 1 / sc);
        g.fillStyle = 'rgba(20,50,30,0.235)';
        for (const o of this.obstacles) if (isTree(o)) fillCircle(g, o.x, o.y, 40);
        g.strokeStyle = 'rgb(150,130,90)';
        setStroke(g, 50, false);
        g.beginPath();
        for (const s of this.roads) {
            g.moveTo(s[0], s[1]);
            g.lineTo(s[2], s[3]);
        }
        g.stroke();
        g.fillStyle = 'rgb(50,100,140)';
        for (const o of this.obstacles) if (o.kind === K.POND) fillCircle(g, o.x, o.y, o.r);
    }
}
