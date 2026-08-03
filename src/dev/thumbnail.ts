/**
 * The 512x512 store tile, composed from the game's own art.
 *
 * Not a mock-up: the tiles here are produced by `renderTileCanvas`, the same
 * function the board uses. The store tile therefore cannot drift away from what
 * the game looks like, because it IS what the game looks like.
 *
 * Fully deterministic — no clock, no randomness — so re-running the renderer
 * produces an identical file until the art or this composition actually change.
 */
import { ART } from "../assets/art/index.ts";
import { css, PALETTE } from "../game/art/palette.ts";
import { renderTileCanvas, TILE_SPRITE_H, TILE_SPRITE_W } from "../game/art/tileArt.ts";
import { makeKind } from "../game/mahjong/tiles.ts";

const SIZE = 512;

/**
 * Tiles arranged as a shallow arc BELOW the creature, so the store tile reads
 * as "mahjong, underwater" at 64px: the jellyfish supplies the silhouette and
 * the colour, the tiles supply the genre. A centred stack of tiles alone was
 * legible but generic.
 */
const COMPOSITION = [
    { kind: makeKind("kelp", 3), x: 0.15, y: 0.73, scale: 0.98, rotation: -0.17, dim: 0.5 },
    { kind: makeKind("pearl", 5), x: 0.85, y: 0.73, scale: 0.98, rotation: 0.17, dim: 0.5 },
    { kind: makeKind("fathom", 7), x: 0.33, y: 0.69, scale: 1.1, rotation: -0.07, dim: 0.24 },
    { kind: makeKind("pearl", 1), x: 0.67, y: 0.69, scale: 1.1, rotation: 0.07, dim: 0.24 },
    { kind: makeKind("creature", 2), x: 0.5, y: 0.67, scale: 1.26, rotation: 0, dim: 0 },
] as const;

function loadImage(url: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        // Resolve null rather than reject: a thumbnail without the painted
        // plates is still a usable tile, and the script asserts the byte size.
        image.onerror = () => resolve(null);
        image.src = url;
    });
}

/** `drawImage` with cover semantics, cropped around a normalized focal row. */
function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, size: number, focusY: number): void {
    const scale = Math.max(size / image.width, size / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    const top = Math.max(Math.min(0, size - height), Math.min(0, size / 2 - height * focusY));
    ctx.drawImage(image, (size - width) / 2, top, width, height);
}

export async function renderThumbnail(): Promise<string> {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";

    const [shrine, jelly] = await Promise.all([loadImage(ART.menuBackdrop), loadImage(ART.lanternJelly)]);

    // --- the water ---------------------------------------------------------
    const water = ctx.createLinearGradient(0, 0, 0, SIZE);
    water.addColorStop(0, css(PALETTE.abyss));
    water.addColorStop(0.45, css(PALETTE.deep));
    water.addColorStop(1, css(PALETTE.shelf));
    ctx.fillStyle = water;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // The painted shrine, pushed well back: at store-tile size it must read as
    // depth and texture, never as a competing subject.
    if (shrine) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        drawCover(ctx, shrine, SIZE, 0.3);
        ctx.restore();
        ctx.fillStyle = css(PALETTE.abyss, 0.3);
        ctx.fillRect(0, 0, SIZE, SIZE);
    }

    // A single shaft of light behind the stack, so the tile reads at 64px as
    // "something glowing underwater" even when the faces are too small to see.
    const shaft = ctx.createLinearGradient(SIZE * 0.5, 0, SIZE * 0.5, SIZE);
    shaft.addColorStop(0, css(PALETTE.lumen, 0.3));
    shaft.addColorStop(0.6, css(PALETTE.lumenDim, 0.08));
    shaft.addColorStop(1, css(PALETTE.lumenDim, 0));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(SIZE * 0.32, 0);
    ctx.lineTo(SIZE * 0.68, 0);
    ctx.lineTo(SIZE * 0.92, SIZE);
    ctx.lineTo(SIZE * 0.08, SIZE);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = shaft;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.restore();

    const glow = ctx.createRadialGradient(SIZE * 0.5, SIZE * 0.5, 0, SIZE * 0.5, SIZE * 0.5, SIZE * 0.5);
    glow.addColorStop(0, css(PALETTE.lumen, 0.22));
    glow.addColorStop(0.55, css(PALETTE.lumenDim, 0.06));
    glow.addColorStop(1, css(PALETTE.abyss, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // --- the creature ------------------------------------------------------
    if (jelly) {
        const height = SIZE * 0.68;
        const width = (height * jelly.width) / jelly.height;
        ctx.save();
        ctx.shadowColor = css(PALETTE.amber, 0.45);
        ctx.shadowBlur = SIZE * 0.1;
        ctx.drawImage(jelly, (SIZE - width) / 2, SIZE * 0.02, width, height);
        ctx.restore();
    }

    // --- the tiles ---------------------------------------------------------
    const unit = SIZE / 5.4;
    for (const entry of COMPOSITION) {
        const face = renderTileCanvas(entry.kind, 3, "vitreum");
        const width = unit * entry.scale;
        const height = (width * TILE_SPRITE_H) / TILE_SPRITE_W;

        ctx.save();
        ctx.translate(SIZE * entry.x, SIZE * entry.y);
        ctx.rotate(entry.rotation);
        ctx.shadowColor = css(PALETTE.abyss, 0.75);
        ctx.shadowBlur = SIZE * 0.06;
        ctx.shadowOffsetY = SIZE * 0.02;
        ctx.drawImage(face, -width / 2, -height / 2, width, height);
        ctx.restore();

        // Push the back tiles into the water instead of scaling them smaller:
        // at 64px a size difference is invisible but a value difference is not.
        if (entry.dim > 0) {
            ctx.save();
            ctx.globalCompositeOperation = "source-atop";
            ctx.fillStyle = css(PALETTE.deep, entry.dim);
            ctx.translate(SIZE * entry.x, SIZE * entry.y);
            ctx.rotate(entry.rotation);
            ctx.fillRect(-width / 2, -height / 2, width, height);
            ctx.restore();
        }
    }

    // --- the wordmark ------------------------------------------------------
    const plinth = ctx.createLinearGradient(0, SIZE * 0.78, 0, SIZE);
    plinth.addColorStop(0, css(PALETTE.abyss, 0));
    plinth.addColorStop(0.5, css(PALETTE.abyss, 0.9));
    plinth.addColorStop(1, css(PALETTE.abyss, 0.97));
    ctx.fillStyle = plinth;
    ctx.fillRect(0, SIZE * 0.76, SIZE, SIZE * 0.24);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.round(SIZE * 0.105)}px "Marcellus", Georgia, serif`;
    ctx.letterSpacing = `${Math.round(SIZE * 0.028)}px`;
    ctx.shadowColor = css(PALETTE.lumen, 0.55);
    ctx.shadowBlur = SIZE * 0.07;
    ctx.fillStyle = css(PALETTE.glassTop);
    // The letter-spacing is applied to the right of the last glyph too, so nudge
    // left by half a step to keep the word optically centred.
    ctx.fillText("TIDEGLASS", SIZE * 0.5 - SIZE * 0.013, SIZE * 0.91);
    ctx.shadowBlur = 0;

    return canvas.toDataURL("image/jpeg", 0.92);
}
