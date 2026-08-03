import { Graphics } from "pixi.js";
import { NoiseRandom } from "./noiseRandom.ts";

/**
 * Very small particle burst helper used by the template demo scene.
 *
 * This is intentionally minimal and engine-agnostic:
 * - lightweight data objects
 * - one container-owned render loop
 * - no texture loading required
 */
export interface ParticleDef {
    x: number;
    y: number;
    vx: number;
    vy: number;
    lifeMs: number;
    radius: number;
    hue: number;
}

interface LiveParticle {
    g: Graphics;
    vx: number;
    vy: number;
    life: number;
    lifeMs: number;
    spin: number;
    radius: number;
}

export interface EmitterOptions {
    burst: number;
    spreadPx: number;
    lifeMinMs: number;
    lifeMaxMs: number;
    speedMinPxPerSec: number;
    speedMaxPxPerSec: number;
    radiusMinPx: number;
    radiusMaxPx: number;
    hue?: number;
}

export interface ParticleEmitter {
    burst(x: number, y: number, opts?: Partial<EmitterOptions>): void;
    update(dtSeconds: number): void;
    destroy(): void;
    get activeCount(): number;
}

const DEFAULT_OPTIONS: EmitterOptions = {
    burst: 18,
    spreadPx: 160,
    lifeMinMs: 260,
    lifeMaxMs: 560,
    speedMinPxPerSec: 60,
    speedMaxPxPerSec: 290,
    radiusMinPx: 2,
    radiusMaxPx: 6,
    hue: 210,
};

function hexFromHsl(h: number, s: number, l: number): number {
    const c = (1 - Math.abs((2 * l) / 100 - 1)) * (s / 100);
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l / 100 - c / 2;

    let r = 0;
    let g = 0;
    let b = 0;
    const hh = ((h % 360) + 360) % 360;
    if (hh < 60) [r, g, b] = [c, x, 0];
    else if (hh < 120) [r, g, b] = [x, c, 0];
    else if (hh < 180) [r, g, b] = [0, c, x];
    else if (hh < 240) [r, g, b] = [0, x, c];
    else if (hh < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    const to255 = (v: number): number => Math.round((v + m) * 255);
    return (to255(r) << 16) | (to255(g) << 8) | to255(b);
}

export function createParticleEmitter(
    root: { addChild: (g: Graphics) => void },
    random = new NoiseRandom(),
): ParticleEmitter {
    const particles = new Set<LiveParticle>();

    function spawn(def: ParticleDef): void {
        const g = new Graphics();
        const p: LiveParticle = {
            g,
            vx: def.vx,
            vy: def.vy,
            life: def.lifeMs,
            lifeMs: def.lifeMs,
            spin: random.float(-1.25, 1.25),
            radius: def.radius,
        };

        g.circle(0, 0, def.radius);
        g.fill({ color: hexFromHsl(def.hue, 90, random.float(58, 86)), alpha: 0.95 });
        g.x = def.x;
        g.y = def.y;
        root.addChild(g);
        particles.add(p);
    }

    function randomRange(min: number, max: number): number {
        return random.float(min, Math.max(min + 0.0001, max));
    }

    return {
        burst(x, y, opts) {
            const o = { ...DEFAULT_OPTIONS, ...(opts || {}) };
            const baseHue = Number.isFinite(o.hue as number) ? (o.hue as number) : 210;

            for (let i = 0; i < o.burst; i++) {
                const angle = (Math.PI * 2 * i) / o.burst + random.float(-0.25, 0.25);
                const speed = randomRange(o.speedMinPxPerSec, o.speedMaxPxPerSec);
                const life = randomRange(o.lifeMinMs, o.lifeMaxMs);
                const r = randomRange(o.radiusMinPx, o.radiusMaxPx);
                const hue = baseHue + random.float(-30, 30);

                spawn({
                    x: x + random.float(-1.5, 1.5),
                    y: y + random.float(-1.5, 1.5),
                    vx: (Math.cos(angle) * speed) / 1000,
                    vy: (Math.sin(angle) * speed) / 1000,
                    lifeMs: life,
                    radius: r,
                    hue: hue % 360,
                });
            }
        },

        update(dtSeconds: number) {
            if (!particles.size) return;
            const toRemove: LiveParticle[] = [];
            const dtMs = dtSeconds * 1000;

            for (const p of particles) {
                p.life -= dtMs;
                p.g.x += p.vx * dtMs;
                p.g.y += p.vy * dtMs;
                p.vx *= 0.985;
                p.vy *= 0.985;
                p.vy += 60 * dtSeconds;
                const ratio = Math.max(0, p.life / p.lifeMs);
                p.g.alpha = ratio;
                p.g.scale.set(Math.max(0.01, ratio));
                p.g.rotation += p.spin * dtSeconds;

                if (p.life <= 0) {
                    toRemove.push(p);
                }
            }

            for (const p of toRemove) {
                if (p.g.parent) p.g.parent.removeChild(p.g);
                p.g.destroy();
                particles.delete(p);
            }
        },

        destroy() {
            for (const p of particles) {
                if (p.g.parent) p.g.removeFromParent();
                p.g.destroy();
            }
            particles.clear();
        },

        get activeCount() {
            return particles.size;
        },
    };
}
