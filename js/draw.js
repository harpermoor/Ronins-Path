'use strict';

/** Shared top-down character rendering. In the rotated frame +x is "forward". */
const Draw = {
    shadow(g, x, y, r) {
        g.fillStyle = 'rgba(0,0,0,0.235)';
        fillEllipse(g, x - r * 1.1 + 4, y - r * 0.9 + 6, r * 2.2, r * 1.9);
    },

    /** Armored silhouettes: visored helm, greathelm, antler crown, or hood. */
    body(g, x, y, r, facing, robe, shoulder, hat, hatStyle, walk) {
        g.save();
        g.translate(x, y);
        g.rotate(facing);
        // feet
        const step = Math.sin(walk * 0.12) * r * 0.45;
        g.fillStyle = 'rgb(30,26,24)';
        fillEllipse(g, step - r * 0.3, -r * 0.7, r * 0.6, r * 0.4);
        fillEllipse(g, -step - r * 0.3, r * 0.3, r * 0.6, r * 0.4);
        // shoulders
        g.fillStyle = css(shoulder);
        roundRectPath(g, -r * 0.55, -r * 1.12, r * 1.05, r * 2.24, r * 0.35);
        g.fill();
        g.strokeStyle = css(U.shade(shoulder, 0.7));
        setStroke(g, 1.5, false);
        strokeLine(g, -r * 0.3, -r * 1.05, -r * 0.3, r * 1.05);
        // torso
        g.fillStyle = css(robe);
        fillEllipse(g, -r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
        g.fillStyle = css(U.shade(shoulder, 0.8));
        roundRectPath(g, -r * 0.48, -r * 0.65, r * 0.75, r * 1.3, r * 0.12);
        g.fill();
        g.strokeStyle = css(U.shade(shoulder, 1.4));
        setStroke(g, 1, false);
        strokeLine(g, -r * 0.25, -r * 0.6, -r * 0.25, r * 0.6);
        // head / hat
        switch (hatStyle) {
            case 0: {
                g.fillStyle = css(hat);
                fillEllipse(g, -r * 0.65, -r * 0.57, r * 1.3, r * 1.14);
                g.fillStyle = css(U.shade(hat, 1.35));
                g.beginPath();
                g.moveTo(-r * 0.5, 0);
                g.lineTo(r * 0.76, -r * 0.36);
                g.lineTo(r * 0.88, 0);
                g.lineTo(r * 0.76, r * 0.36);
                g.closePath();
                g.fill();
                g.strokeStyle = 'rgb(22,24,25)';
                setStroke(g, 2.5, false);
                strokeLine(g, r * 0.58, -r * 0.29, r * 0.58, r * 0.29);
                break;
            }
            case 1: {
                g.fillStyle = css(hat);
                roundRectPath(g, -r * 0.63, -r * 0.64, r * 1.35, r * 1.28, r * 0.15);
                g.fill();
                g.fillStyle = 'rgb(25,27,28)';
                g.fillRect(r * 0.35, -r * 0.48, r * 0.15, r * 0.96);
                g.strokeStyle = 'rgb(188,165,112)';
                setStroke(g, 1.5, false);
                strokeLine(g, -r * 0.53, 0, r * 0.65, 0);
                break;
            }
            case 2: {
                g.fillStyle = css(hat);
                fillEllipse(g, -r * 0.5, -r * 0.5, r, r);
                g.strokeStyle = 'rgb(175,163,132)';
                setStroke(g, r * 0.12, true);
                for (const side of [-1, 1]) {
                    strokeLine(g, 0, side * r * 0.4, -r * 0.8, side * r);
                    strokeLine(g, -r * 0.8, side * r, -r * 0.4, side * r * 1.3);
                    strokeLine(g, -r * 0.55, side * r * 0.8, -r, side * r * 0.65);
                }
                g.fillStyle = 'rgb(255,230,80)';
                fillEllipse(g, r * 0.25, -r * 0.2, r * 0.12, r * 0.12);
                fillEllipse(g, r * 0.25, r * 0.08, r * 0.12, r * 0.12);
                break;
            }
            default:
                g.fillStyle = css(hat);
                fillEllipse(g, -r * 0.62, -r * 0.62, r * 1.24, r * 1.24);
                g.fillStyle = 'rgb(195,177,128)';
                fillEllipse(g, r * 0.3, -r * 0.22, r * 0.14, r * 0.12);
                fillEllipse(g, r * 0.3, r * 0.1, r * 0.14, r * 0.12);
        }
        g.restore();
    },

    mantle(g, x, y, r, facing, c) {
        g.save();
        g.translate(x, y);
        g.rotate(facing);
        g.fillStyle = css(U.alpha(U.shade(c, 0.55), 0.85));
        g.beginPath();
        g.moveTo(-r * 0.5, -r * 0.95);
        g.lineTo(-r * 2, -r * 1.25);
        g.lineTo(-r * 1.65, 0);
        g.lineTo(-r * 2, r * 1.25);
        g.lineTo(-r * 0.5, r * 0.95);
        g.closePath();
        g.fill();
        g.restore();
    },

    shield(g, x, y, r, facing, c, raised) {
        g.save();
        g.translate(x, y);
        g.rotate(facing);
        g.translate(raised ? r * 0.8 : 0, -r * 1.05);
        g.fillStyle = css(U.shade(c, 0.7));
        g.strokeStyle = 'rgb(164,151,116)';
        setStroke(g, 1.5, false);
        g.beginPath();
        g.moveTo(-r * 0.6, -r * 0.5);
        g.lineTo(r * 0.7, -r * 0.5);
        g.lineTo(r * 0.7, r * 0.45);
        g.lineTo(0, r * 0.8);
        g.lineTo(-r * 0.6, r * 0.45);
        g.closePath();
        g.fill();
        g.stroke();
        g.fillStyle = 'rgb(192,174,130)';
        fillCircle(g, 0, 0, r * 0.16);
        g.restore();
    },

    scarf(g, x, y, r, facing, phase, c) {
        this.mantle(g, x, y, r, facing, c);
        const back = facing + Math.PI;
        const sx = x + Math.cos(back) * r * 0.5, sy = y + Math.sin(back) * r * 0.5;
        g.beginPath();
        g.moveTo(sx, sy);
        for (let i = 1; i <= 5; i++) {
            const d = i * 7;
            const w = Math.sin(phase - i * 0.9) * i * 1.6;
            g.lineTo(sx + Math.cos(back) * d + Math.cos(back + Math.PI / 2) * w, sy + Math.sin(back) * d + Math.sin(back + Math.PI / 2) * w);
        }
        setStroke(g, 3, true);
        g.strokeStyle = css(c);
        g.stroke();
    },

    weapon(g, hx, hy, ang, weapon, color) {
        if (weaponType(weapon) === 'spear') return this.spear(g, hx, hy, ang, weapon.len, 26, weapon.id, color || weapon.color);
        if (weaponType(weapon) === 'hammer') return this.club(g, hx, hy, ang, weapon.len, weapon.id, color || weapon.color);
        if (weaponType(weapon) === 'axe') {
            const c = Math.cos(ang), s = Math.sin(ang), x = hx + c * weapon.len, y = hy + s * weapon.len;
            setStroke(g, 4, true);
            g.strokeStyle = 'rgb(100,70,44)';
            strokeLine(g, hx - c * 7, hy - s * 7, x, y);
            g.fillStyle = css(color || weapon.color);
            g.beginPath();
            g.moveTo(x - s * 5, y + c * 5);
            g.lineTo(x + c * 9 - s * 13, y + s * 9 + c * 13);
            g.lineTo(x + c * 9 + s * 13, y + s * 9 - c * 13);
            g.lineTo(x + s * 5, y - c * 5);
            g.closePath();
            g.fill();
            return;
        }
        this.katana(g, hx, hy, ang, weapon.len, color || weapon.color);
    },

    katana(g, hx, hy, ang, len, blade) {
        const c = Math.cos(ang), s = Math.sin(ang);
        setStroke(g, 4.5, true);
        g.strokeStyle = 'rgb(30,22,26)';
        strokeLine(g, hx - c * 4, hy - s * 4, hx + c * 10, hy + s * 10);
        setStroke(g, 3, false);
        g.strokeStyle = 'rgb(200,170,60)';
        strokeLine(g, hx + c * 10 - s * 7, hy + s * 10 + c * 7, hx + c * 10 + s * 7, hy + s * 10 - c * 7);
        g.fillStyle = css(blade);
        g.beginPath();
        g.moveTo(hx + c * 11 - s * 3, hy + s * 11 + c * 3);
        g.lineTo(hx + c * (len - 8) - s * 2.5, hy + s * (len - 8) + c * 2.5);
        g.lineTo(hx + c * len, hy + s * len);
        g.lineTo(hx + c * (len - 8) + s * 2.5, hy + s * (len - 8) - c * 2.5);
        g.lineTo(hx + c * 11 + s * 3, hy + s * 11 - c * 3);
        g.closePath();
        g.fill();
        setStroke(g, 1, false);
        g.strokeStyle = 'rgba(255,255,255,0.784)';
        strokeLine(g, hx + c * 12 - s, hy + s * 12 + c, hx + c * (len - 2) - s, hy + s * (len - 2) + c);
    },

    spear(g, hx, hy, ang, len, back, id, headColor) {
        const c = Math.cos(ang), s = Math.sin(ang);
        setStroke(g, 3.5, true);
        g.strokeStyle = 'rgb(100,70,44)';
        strokeLine(g, hx - c * back, hy - s * back, hx + c * len, hy + s * len);
        g.fillStyle = css(headColor || rgb(210, 210, 220));
        g.beginPath();
        const tip = len + (id === 'serpent-spear' ? 19 : 16), half = id === 'storm-spear' ? 6 : 4;
        g.moveTo(hx + c * tip, hy + s * tip);
        if (id === 'serpent-spear') {
            g.lineTo(hx + c * (len + 8) - s * 8, hy + s * (len + 8) + c * 8);
            g.lineTo(hx + c * (len + 3) - s * 3, hy + s * (len + 3) + c * 3);
            g.lineTo(hx + c * (len + 7) + s * 8, hy + s * (len + 7) - c * 8);
        } else {
            g.lineTo(hx + c * len - s * half, hy + s * len + c * half);
            g.lineTo(hx + c * len + s * half, hy + s * len - c * half);
        }
        g.closePath();
        g.fill();
        g.fillStyle = 'rgb(170,30,30)';
        fillCircle(g, hx + c * (len - 4), hy + s * (len - 4), 3);
    },

    club(g, hx, hy, ang, len, id, headColor) {
        const c = Math.cos(ang), s = Math.sin(ang);
        const cx = hx + c * len * 0.82, cy = hy + s * len * 0.82;
        setStroke(g, 7, true);
        g.strokeStyle = 'rgb(60,44,34)';
        strokeLine(g, hx, hy, cx, cy);
        const along = id === 'stone-hammer' ? 11 : id === 'war-hammer' ? 10 : 8;
        const across = id === 'stone-hammer' ? 18 : id === 'war-hammer' ? 17 : 15;
        g.beginPath();
        g.moveTo(cx - c * along - s * across, cy - s * along + c * across);
        g.lineTo(cx + c * along - s * across, cy + s * along + c * across);
        g.lineTo(cx + c * along + s * across, cy + s * along - c * across);
        g.lineTo(cx - c * along + s * across, cy - s * along - c * across);
        g.closePath();
        g.fillStyle = css(headColor || rgb(140, 145, 145));
        g.strokeStyle = 'rgb(48,45,44)';
        g.lineWidth = 3;
        g.fill();
        g.stroke();
        setStroke(g, 2, false);
        g.strokeStyle = 'rgb(205,205,195)';
        strokeLine(g, cx - c * along - s * (across - 3), cy - s * along + c * (across - 3),
            cx + c * along - s * (across - 3), cy + s * along + c * (across - 3));
    },

    /** Sekiro-style glint: a four-point star. */
    glint(g, x, y, size, c) {
        g.fillStyle = css(U.alpha(c, 0.35));
        fillCircle(g, x, y, size * 0.6);
        g.fillStyle = css(c);
        g.beginPath();
        g.moveTo(x, y - size);
        g.lineTo(x + size * 0.18, y - size * 0.18);
        g.lineTo(x + size, y);
        g.lineTo(x + size * 0.18, y + size * 0.18);
        g.lineTo(x, y + size);
        g.lineTo(x - size * 0.18, y + size * 0.18);
        g.lineTo(x - size, y);
        g.lineTo(x - size * 0.18, y - size * 0.18);
        g.closePath();
        g.fill();
    },

    /** A centered bar that grows outward from the middle (posture). */
    postureBar(g, cx, y, w, h, frac, broken) {
        frac = U.clamp(frac, 0, 1);
        g.fillStyle = 'rgba(0,0,0,0.588)';
        g.fillRect(cx - w / 2 - 1, y - 1, w + 2, h + 2);
        const c = broken ? rgb(255, 60, 40) : U.mix(rgb(240, 210, 80), rgb(255, 90, 30), frac);
        g.fillStyle = css(c);
        g.fillRect(cx - w / 2 * frac, y, w * frac, h);
        g.fillStyle = 'rgba(255,255,255,0.47)';
        g.fillRect(cx - 1, y - 2, 2, h + 4);
    },
};
