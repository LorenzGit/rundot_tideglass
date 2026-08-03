/**
 * The water the board sits in: a silted gradient, slow light shafts and a
 * drifting bloom.
 *
 * Everything soft here is baked into a GRADIENT, never a blur filter. A Pixi
 * filter forces its own composite pass, which silently discards the sprite's
 * blend mode — so a screen-blended godray behind a filter stops screening and
 * turns into a grey rectangle. Gradients keep the blend modes working.
 */
import { Texture } from "pixi.js";
import { css, PALETTE } from "./palette.ts";

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
    return { canvas, ctx: canvas.getContext("2d") };
}

/**
 * The seabed. Rendered at a low resolution and stretched: it is all smooth
 * gradient, so a 256-wide texture is indistinguishable from a full-size one
 * and costs a fraction of the upload.
 */
export function createSeabedTexture(): Texture {
    const width = 256;
    const height = 512;
    const { canvas, ctx } = canvasOf(width, height);
    if (!ctx) return Texture.WHITE;

    const water = ctx.createLinearGradient(0, 0, 0, height);
    water.addColorStop(0, css(PALETTE.abyss));
    water.addColorStop(0.34, css(PALETTE.deep));
    water.addColorStop(0.72, css(PALETTE.shelf));
    water.addColorStop(1, css(PALETTE.silt));
    ctx.fillStyle = water;
    ctx.fillRect(0, 0, width, height);

    // Vignette, so the board's own glow has something to sit against.
    const vignette = ctx.createRadialGradient(
        width / 2,
        height * 0.42,
        width * 0.12,
        width / 2,
        height * 0.5,
        height * 0.72,
    );
    vignette.addColorStop(0, css(PALETTE.shelf, 0.34));
    vignette.addColorStop(0.55, css(PALETTE.abyss, 0));
    vignette.addColorStop(1, css(PALETTE.abyss, 0.72));
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    return Texture.from(canvas);
}

/**
 * A soft light shaft. Drawn as a tall trapezoid of gradient rather than a
 * blurred rectangle — see the note at the top about filters and blend modes.
 */
export function createGodrayTexture(): Texture {
    const width = 128;
    const height = 512;
    const { canvas, ctx } = canvasOf(width, height);
    if (!ctx) return Texture.WHITE;

    const fade = ctx.createLinearGradient(0, 0, 0, height);
    fade.addColorStop(0, css(PALETTE.lumen, 0.4));
    fade.addColorStop(0.45, css(PALETTE.lumenDim, 0.16));
    fade.addColorStop(1, css(PALETTE.lumenDim, 0));

    // Horizontal falloff via a clip that narrows toward the bottom, with the
    // edges feathered by a second gradient pass.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(width * 0.36, 0);
    ctx.lineTo(width * 0.64, 0);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    const feather = ctx.createLinearGradient(0, 0, width, 0);
    feather.addColorStop(0, css(PALETTE.abyss, 1));
    feather.addColorStop(0.22, css(PALETTE.abyss, 0));
    feather.addColorStop(0.78, css(PALETTE.abyss, 0));
    feather.addColorStop(1, css(PALETTE.abyss, 1));
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = feather;
    ctx.fillRect(0, 0, width, height);

    return Texture.from(canvas);
}

/** A round soft glow. The workhorse behind selections, bursts and motes. */
export function createGlowTexture(size = 128): Texture {
    const { canvas, ctx } = canvasOf(size, size);
    if (!ctx) return Texture.WHITE;
    const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    glow.addColorStop(0, css(0xffffff, 1));
    glow.addColorStop(0.35, css(0xffffff, 0.45));
    glow.addColorStop(0.7, css(0xffffff, 0.1));
    glow.addColorStop(1, css(0xffffff, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    return Texture.from(canvas);
}

/**
 * A tileable caustic web — the moving light the water casts on everything.
 *
 * Built from summed sine waves rather than noise: interference between three
 * wave sets at different angles produces exactly the branching bright filaments
 * real caustics have, and because the wave numbers are whole numbers the result
 * tiles seamlessly, so two of these can drift across the screen forever without
 * a visible seam.
 */
export function createCausticTexture(size = 256): Texture {
    const { canvas, ctx } = canvasOf(size, size);
    if (!ctx) return Texture.WHITE;

    const image = ctx.createImageData(size, size);
    const data = image.data;
    const waves = [
        { kx: 3, ky: 2, phase: 0 },
        { kx: -2, ky: 4, phase: 1.7 },
        { kx: 5, ky: -3, phase: 3.1 },
    ];
    const tau = Math.PI * 2;

    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const u = x / size;
            const v = y / size;
            let sum = 0;
            for (const wave of waves) {
                sum += Math.sin(tau * (wave.kx * u + wave.ky * v) + wave.phase);
            }
            // Fold the interference toward zero-crossings and sharpen: the thin
            // bright ridges are where the waves cancel, not where they peak.
            const ridge = 1 - Math.min(1, Math.abs(sum) / 1.6);
            const intensity = ridge ** 3.2;
            const index = (y * size + x) * 4;
            data[index] = 255;
            data[index + 1] = 255;
            data[index + 2] = 255;
            data[index + 3] = Math.round(intensity * 235);
        }
    }
    ctx.putImageData(image, 0, 0);
    return Texture.from(canvas);
}

/** A rising bubble: a ring with a highlight, not a filled disc. */
export function createBubbleTexture(size = 48): Texture {
    const { canvas, ctx } = canvasOf(size, size);
    if (!ctx) return Texture.WHITE;
    const radius = size * 0.4;
    const rim = ctx.createRadialGradient(size / 2, size / 2, radius * 0.55, size / 2, size / 2, radius);
    rim.addColorStop(0, css(0xffffff, 0));
    rim.addColorStop(0.72, css(0xffffff, 0.1));
    rim.addColorStop(0.9, css(0xffffff, 0.62));
    rim.addColorStop(1, css(0xffffff, 0));
    ctx.fillStyle = rim;
    ctx.fillRect(0, 0, size, size);
    // The specular kiss that makes it read as a bubble rather than a ring.
    const spark = ctx.createRadialGradient(size * 0.38, size * 0.34, 0, size * 0.38, size * 0.34, radius * 0.34);
    spark.addColorStop(0, css(0xffffff, 0.85));
    spark.addColorStop(1, css(0xffffff, 0));
    ctx.fillStyle = spark;
    ctx.fillRect(0, 0, size, size);
    return Texture.from(canvas);
}

/** A thin expanding ring, thrown outward when a pair shatters. */
export function createRingTexture(size = 128): Texture {
    const { canvas, ctx } = canvasOf(size, size);
    if (!ctx) return Texture.WHITE;
    const ring = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    ring.addColorStop(0, css(0xffffff, 0));
    ring.addColorStop(0.62, css(0xffffff, 0));
    ring.addColorStop(0.82, css(0xffffff, 0.9));
    ring.addColorStop(0.95, css(0xffffff, 0.22));
    ring.addColorStop(1, css(0xffffff, 0));
    ctx.fillStyle = ring;
    ctx.fillRect(0, 0, size, size);
    return Texture.from(canvas);
}

/** A soft dark ellipse: the shadow the whole board casts on the seabed. */
export function createBoardShadowTexture(size = 256): Texture {
    const { canvas, ctx } = canvasOf(size, size);
    if (!ctx) return Texture.WHITE;
    const shadow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    shadow.addColorStop(0, css(PALETTE.abyss, 0.85));
    shadow.addColorStop(0.45, css(PALETTE.abyss, 0.6));
    shadow.addColorStop(1, css(PALETTE.abyss, 0));
    ctx.fillStyle = shadow;
    ctx.fillRect(0, 0, size, size);
    return Texture.from(canvas);
}

/**
 * Darkened edges over the whole scene, drawn once and stretched. Focuses the
 * eye on the board and hides where the seabed plate's grain gives out; a
 * gradient texture, never a filter, for the blend-mode reason above.
 */
export function createVignetteTexture(size = 256): Texture {
    const { canvas, ctx } = canvasOf(size, size);
    if (!ctx) return Texture.WHITE;
    const vignette = ctx.createRadialGradient(size / 2, size * 0.46, size * 0.22, size / 2, size * 0.5, size * 0.74);
    vignette.addColorStop(0, css(PALETTE.abyss, 0));
    vignette.addColorStop(0.62, css(PALETTE.abyss, 0.08));
    vignette.addColorStop(1, css(PALETTE.abyss, 0.55));
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, size, size);
    return Texture.from(canvas);
}

/** A small shard, thrown when a pair shatters. */
export function createShardTexture(size = 32): Texture {
    const { canvas, ctx } = canvasOf(size, size);
    if (!ctx) return Texture.WHITE;
    ctx.fillStyle = css(0xffffff, 0.95);
    ctx.beginPath();
    ctx.moveTo(size * 0.5, size * 0.06);
    ctx.lineTo(size * 0.86, size * 0.46);
    ctx.lineTo(size * 0.56, size * 0.94);
    ctx.lineTo(size * 0.16, size * 0.62);
    ctx.closePath();
    ctx.fill();
    return Texture.from(canvas);
}

/** The felt the tiles rest on: a soft elliptical pool of lighter water. */
export function createBoardPoolTexture(size = 256): Texture {
    const { canvas, ctx } = canvasOf(size, size);
    if (!ctx) return Texture.WHITE;
    const pool = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    pool.addColorStop(0, css(PALETTE.feltLight, 0.92));
    pool.addColorStop(0.6, css(PALETTE.feltDark, 0.6));
    pool.addColorStop(1, css(PALETTE.feltDark, 0));
    ctx.fillStyle = pool;
    ctx.fillRect(0, 0, size, size);
    return Texture.from(canvas);
}
