/**
 * Match feedback: the shard burst, the floating score, the PERFECT shout and
 * the drifting motes that keep the water alive.
 *
 * Every effect honours reduced motion by shortening or stilling itself rather
 * than disappearing — a player who turns motion down still needs to see that
 * their match registered, so the feedback stays and only the travel goes.
 */
import { Container, Sprite, Text, type Texture } from "pixi.js";
import { css, PALETTE } from "../art/palette.ts";
import { UI_FONT, DISPLAY_FONT } from "../art/palette.ts";
import { NoiseRandom } from "../noiseRandom.ts";

interface Particle {
    sprite: Sprite;
    vx: number;
    vy: number;
    spin: number;
    life: number;
    maxLife: number;
    fromScale: number;
    /** Bubbles rise and sway; shards fall. */
    buoyant?: boolean;
}

export interface VfxTextures {
    glow: Texture;
    shard: Texture;
    ring: Texture;
    bubble: Texture;
}

export interface Vfx {
    /** Layer to add under the board (motes, ambient light). */
    ambient: Container;
    /** Layer to add above the board (bursts, popups). */
    foreground: Container;
    burst(x: number, y: number, tint: number, strength: number): void;
    /** A thin expanding shockwave. Reads as force where a soft glow reads as light. */
    shockwave(x: number, y: number, tint: number, strength: number): void;
    /** A fading after-image left behind a tile in flight. */
    trail(x: number, y: number, texture: Texture, scale: number, tint: number): void;
    /** A handful of small bubbles shaken loose — flights, landings, splashes. */
    bubbles(x: number, y: number, count: number, spread?: number): void;
    /** A broad soft flash of light. Reads as radiance where the ring reads as force. */
    bloom(x: number, y: number, tint: number, strength: number): void;
    scorePopup(x: number, y: number, points: number, combo: number): void;
    shout(x: number, y: number, text: string): void;
    ripple(x: number, y: number, tint: number): void;
    /** Seed the ambient motes for a well of this size. */
    resizeAmbient(width: number, height: number): void;
    update(dtSeconds: number): void;
    setReducedMotion(reduced: boolean): void;
    destroy(): void;
}

const MAX_PARTICLES = 220;

export function createVfx(textures: VfxTextures, reducedMotion: boolean): Vfx {
    const ambient = new Container();
    const foreground = new Container();
    const moteLayer = new Container();
    ambient.addChild(moteLayer);

    const particles: Particle[] = [];
    const motes: Particle[] = [];
    const fading: Array<{
        node: Container;
        life: number;
        maxLife: number;
        rise: number;
        grow: number;
        /** When set, the node holds this scale instead of popping or growing. */
        hold?: number;
    }> = [];
    const random = new NoiseRandom(0x71de_9105);
    let reduced = reducedMotion;
    let wellWidth = 720;
    let wellHeight = 1_200;

    function spawn(x: number, y: number, tint: number, texture: Texture, scale: number, speed: number): void {
        if (particles.length >= MAX_PARTICLES) return;
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.tint = tint;
        sprite.position.set(x, y);
        sprite.scale.set(scale);
        sprite.blendMode = "add";
        foreground.addChild(sprite);
        const angle = random.float(0, Math.PI * 2);
        particles.push({
            sprite,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - speed * 0.25,
            spin: random.float(-6, 6),
            life: 0,
            maxLife: random.float(0.42, 0.78),
            fromScale: scale,
        });
    }

    function burst(x: number, y: number, tint: number, strength: number): void {
        // Reduced motion still gets a burst, just a tighter and shorter one:
        // the flash is the confirmation that the match counted.
        const count = Math.round((reduced ? 5 : 16) * strength);
        for (let index = 0; index < count; index += 1) {
            spawn(x, y, tint, textures.shard, random.float(0.45, 1.0), reduced ? 60 : random.float(160, 380));
        }
        for (let index = 0; index < (reduced ? 2 : 6); index += 1) {
            spawn(x, y, PALETTE.lumen, textures.glow, random.float(0.5, 1.2), reduced ? 40 : random.float(60, 180));
        }
        // Shattering underwater shakes air loose: bubbles sell the medium in a
        // way shards alone cannot.
        bubbles(x, y, reduced ? 2 : Math.round(5 * strength), 26);
        ripple(x, y, tint);
        bloom(x, y, tint, strength);
        shockwave(x, y, tint, strength);
    }

    function bubbles(x: number, y: number, count: number, spread = 18): void {
        for (let index = 0; index < count; index += 1) {
            if (particles.length >= MAX_PARTICLES) return;
            const sprite = new Sprite(textures.bubble);
            sprite.anchor.set(0.5);
            sprite.position.set(x + random.float(-spread, spread), y + random.float(-spread * 0.5, spread * 0.5));
            sprite.scale.set(random.float(0.14, 0.4));
            sprite.alpha = random.float(0.4, 0.8);
            sprite.blendMode = "add";
            foreground.addChild(sprite);
            particles.push({
                sprite,
                vx: random.float(-24, 24),
                vy: random.float(-120, -40),
                spin: random.float(2, 5),
                life: 0,
                maxLife: random.float(0.5, reduced ? 0.6 : 1.05),
                fromScale: sprite.scale.x,
                buoyant: true,
            });
        }
    }

    function bloom(x: number, y: number, tint: number, strength: number): void {
        const sprite = new Sprite(textures.glow);
        sprite.anchor.set(0.5);
        sprite.tint = tint;
        sprite.position.set(x, y);
        sprite.alpha = 0.55;
        sprite.scale.set(0.6);
        sprite.blendMode = "add";
        foreground.addChild(sprite);
        fading.push({
            node: sprite,
            life: 0,
            maxLife: reduced ? 0.26 : 0.6,
            rise: 0,
            grow: (reduced ? 2 : 4.4) * Math.min(1.5, strength),
        });
    }

    function shockwave(x: number, y: number, tint: number, strength: number): void {
        const sprite = new Sprite(textures.ring);
        sprite.anchor.set(0.5);
        sprite.tint = tint;
        sprite.position.set(x, y);
        sprite.alpha = 0.9;
        sprite.scale.set(0.25);
        sprite.blendMode = "add";
        foreground.addChild(sprite);
        fading.push({
            node: sprite,
            life: 0,
            maxLife: reduced ? 0.2 : 0.46,
            rise: 0,
            grow: (reduced ? 1.6 : 2.6) * Math.min(1.6, strength),
        });
    }

    function trail(x: number, y: number, texture: Texture, scale: number, tint: number): void {
        if (reduced) return;
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.tint = tint;
        sprite.position.set(x, y);
        sprite.alpha = 0.34;
        sprite.scale.set(scale);
        sprite.blendMode = "add";
        foreground.addChild(sprite);
        fading.push({ node: sprite, life: 0, maxLife: 0.3, rise: 0, grow: 0, hold: scale });
    }

    function ripple(x: number, y: number, tint: number): void {
        const sprite = new Sprite(textures.glow);
        sprite.anchor.set(0.5);
        sprite.tint = tint;
        sprite.position.set(x, y);
        sprite.alpha = 0.85;
        sprite.scale.set(0.5);
        sprite.blendMode = "add";
        foreground.addChild(sprite);
        fading.push({ node: sprite, life: 0, maxLife: reduced ? 0.22 : 0.42, rise: 0, grow: reduced ? 1.4 : 3.2 });
    }

    function scorePopup(x: number, y: number, points: number, combo: number): void {
        const label = new Text({
            text: `+${points}`,
            style: {
                fontFamily: UI_FONT,
                fontSize: combo >= 3 ? 44 : 36,
                fontWeight: "700",
                fill: combo >= 3 ? css(PALETTE.amber) : css(PALETTE.lumen),
                stroke: { color: css(PALETTE.abyss, 0.85), width: 5, join: "round" },
                // Baked into the text texture — a glow with no filter pass.
                dropShadow: {
                    color: css(combo >= 3 ? PALETTE.amber : PALETTE.lumen, 0.55),
                    blur: 10,
                    distance: 0,
                    angle: 0,
                    alpha: 0.55,
                },
            },
        });
        label.anchor.set(0.5);
        label.position.set(x, y);
        foreground.addChild(label);
        fading.push({ node: label, life: 0, maxLife: reduced ? 0.7 : 1.0, rise: reduced ? 24 : 74, grow: 0 });
    }

    function shout(x: number, y: number, text: string): void {
        const label = new Text({
            text,
            style: {
                fontFamily: DISPLAY_FONT,
                fontSize: 68,
                fontWeight: "700",
                fill: css(PALETTE.amber),
                stroke: { color: css(PALETTE.abyss, 0.9), width: 8, join: "round" },
                letterSpacing: 3,
                dropShadow: { color: css(PALETTE.amber, 0.5), blur: 14, distance: 0, angle: 0, alpha: 0.5 },
            },
        });
        label.anchor.set(0.5);
        label.position.set(x, y);
        label.scale.set(reduced ? 1 : 0.6);
        foreground.addChild(label);
        fading.push({ node: label, life: 0, maxLife: reduced ? 0.8 : 1.15, rise: reduced ? 0 : 46, grow: 0 });
    }

    function resizeAmbient(width: number, height: number): void {
        wellWidth = width;
        wellHeight = height;
        for (const mote of motes) mote.sprite.destroy();
        motes.length = 0;
        moteLayer.removeChildren();
        // Motes and bubbles are cheap and few; they exist so a still board is
        // never a frozen image, which is what makes a puzzle screen feel dead.
        const count = reduced ? 0 : 30;
        for (let index = 0; index < count; index += 1) {
            // One in four is a bubble rather than a glow. Bubbles rise faster
            // and wobble more, so the two populations read as different things
            // drifting in the same water instead of one uniform snow.
            const isBubble = index % 4 === 3;
            const sprite = new Sprite(isBubble ? textures.bubble : textures.glow);
            sprite.anchor.set(0.5);
            sprite.tint = isBubble ? 0xffffff : index % 5 === 0 ? PALETTE.amber : PALETTE.lumen;
            sprite.alpha = isBubble ? random.float(0.16, 0.4) : random.float(0.05, 0.19);
            sprite.scale.set(isBubble ? random.float(0.16, 0.42) : random.float(0.06, 0.24));
            sprite.position.set(random.float(0, width), random.float(0, height));
            sprite.blendMode = "add";
            moteLayer.addChild(sprite);
            motes.push({
                sprite,
                vx: random.float(-7, 7),
                vy: isBubble ? random.float(-52, -26) : random.float(-19, -5),
                spin: isBubble ? random.float(1.4, 2.6) : 0,
                life: random.float(0, 6),
                maxLife: 0,
                fromScale: sprite.scale.x,
            });
        }
    }

    function update(dtSeconds: number): void {
        const dt = Math.min(0.05, dtSeconds);

        for (let index = particles.length - 1; index >= 0; index -= 1) {
            const particle = particles[index];
            if (!particle) continue;
            particle.life += dt;
            const ratio = particle.life / particle.maxLife;
            if (ratio >= 1) {
                particle.sprite.destroy();
                particles.splice(index, 1);
                continue;
            }
            if (particle.buoyant) {
                // Bubbles accelerate upward and sway; `spin` is the sway rate.
                particle.vy -= 300 * dt;
                particle.sprite.x += (particle.vx + Math.sin(particle.life * particle.spin) * 26) * dt;
                particle.sprite.y += particle.vy * dt;
                particle.sprite.alpha = (1 - ratio * ratio) * 0.8;
                particle.sprite.scale.set(particle.fromScale * (1 + ratio * 0.35));
                continue;
            }
            particle.vy += 520 * dt; // shards fall
            particle.sprite.x += particle.vx * dt;
            particle.sprite.y += particle.vy * dt;
            particle.sprite.rotation += particle.spin * dt;
            particle.sprite.alpha = 1 - ratio * ratio;
            particle.sprite.scale.set(particle.fromScale * (1 - ratio * 0.45));
        }

        for (let index = fading.length - 1; index >= 0; index -= 1) {
            const entry = fading[index];
            if (!entry) continue;
            entry.life += dt;
            const ratio = entry.life / entry.maxLife;
            if (ratio >= 1) {
                entry.node.destroy();
                fading.splice(index, 1);
                continue;
            }
            entry.node.y -= entry.rise * dt;
            entry.node.alpha = ratio < 0.18 ? ratio / 0.18 : 1 - (ratio - 0.18) / 0.82;
            if (entry.hold !== undefined) {
                entry.node.alpha *= 0.34;
            } else if (entry.grow > 0) {
                // Ease out so a shockwave leaves fast and settles, rather than
                // expanding at a constant and obviously linear rate.
                entry.node.scale.set(0.25 + entry.grow * (1 - (1 - ratio) ** 3));
            } else if (!reduced) {
                // A short overshoot on the way in, then hold.
                const pop = ratio < 0.24 ? 0.6 + 0.55 * (ratio / 0.24) : 1.08 - 0.08 * ((ratio - 0.24) / 0.76);
                entry.node.scale.set(pop);
            }
        }

        for (const mote of motes) {
            mote.life += dt;
            // `spin` doubles as the wobble rate for bubbles, which sway far more
            // than a suspended mote does.
            const sway = mote.spin > 0 ? Math.sin(mote.life * mote.spin) * 22 : Math.sin(mote.life * 0.7) * 6;
            mote.sprite.x += (mote.vx + sway) * dt;
            mote.sprite.y += mote.vy * dt;
            if (mote.sprite.y < -20) {
                mote.sprite.y = wellHeight + 20;
                mote.sprite.x = random.float(0, wellWidth);
            }
            if (mote.sprite.x < -20) mote.sprite.x = wellWidth + 20;
            if (mote.sprite.x > wellWidth + 20) mote.sprite.x = -20;
        }
    }

    return {
        ambient,
        foreground,
        burst,
        shockwave,
        trail,
        bubbles,
        bloom,
        scorePopup,
        shout,
        ripple,
        resizeAmbient,
        update,
        setReducedMotion(next: boolean) {
            if (reduced === next) return;
            reduced = next;
            resizeAmbient(wellWidth, wellHeight);
        },
        destroy() {
            for (const particle of particles) particle.sprite.destroy();
            particles.length = 0;
            for (const entry of fading) entry.node.destroy();
            fading.length = 0;
            for (const mote of motes) mote.sprite.destroy();
            motes.length = 0;
            ambient.destroy({ children: true });
            foreground.destroy({ children: true });
        },
    };
}
