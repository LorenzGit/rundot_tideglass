/**
 * The sea-glass slab: one canvas per tile kind, promoted to a Pixi texture.
 *
 * Tiles are drawn ONCE into textures rather than as live Graphics. A board can
 * hold 144 of them and the frosted face is expensive — gradients, streaks and a
 * glyph — so drawing it per frame would cost more than the rest of the game put
 * together. Thirty-six textures cover every tile on screen.
 *
 * Selection, hint and dimming are deliberately NOT baked in here; the scene
 * layers them as tints and overlays, so a state change never needs a re-render.
 */
import { ImageSource, Texture } from "pixi.js";
import { css, PALETTE } from "./palette.ts";
import { finish, type Finish, type FinishId } from "./finishes.ts";
import { drawGlyph } from "./glyphs.ts";
import { ALL_KINDS, type TileKind } from "../mahjong/tiles.ts";

/** Face size in design units. A shade taller than wide, like the real thing. */
export const TILE_FACE_W = 62;
export const TILE_FACE_H = 80;
/** How far the slab's thickness is drawn down and to the right. */
export const TILE_DEPTH = 9;

/**
 * Transparent margin around the slab. The baked drop shadow and the lit halo
 * both bleed past the slab's silhouette; drawn to the canvas edge they would
 * clip to a hard rectangle, so the canvas is padded and the anchors account
 * for it. Input must NOT get this margin — the scene sets an explicit face
 * `hitArea` so a tile's tap target stays exactly its face.
 */
export const TILE_PAD = 16;

/** Full sprite footprint: pad, face, thickness, pad. */
export const TILE_SPRITE_W = TILE_PAD + TILE_FACE_W + TILE_DEPTH + TILE_PAD;
export const TILE_SPRITE_H = TILE_PAD + TILE_FACE_H + TILE_DEPTH + TILE_PAD;

/**
 * Anchor that puts the tile's FACE centre on the sprite's position.
 *
 * The texture is wider and taller than the face because the slab's thickness is
 * drawn down and to the right (and the shadow pad surrounds everything), so a
 * plain 0.5 anchor centres the whole slab instead — which shifts every tile
 * up-left by half the depth, and pushed the outermost column of a full-width
 * board off the edge of the screen.
 */
export const TILE_ANCHOR_X = (TILE_PAD + TILE_FACE_W / 2) / TILE_SPRITE_W;
export const TILE_ANCHOR_Y = (TILE_PAD + TILE_FACE_H / 2) / TILE_SPRITE_H;

const CORNER = 9;

function roundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
): void {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
}

/**
 * Draw one tile at `scale` device pixels per design unit. The face's top-left
 * sits at (TILE_PAD, TILE_PAD); the thickness extends past its bottom-right,
 * and the shadow/halo bleed into the pad.
 *
 * `lit` bakes a bioluminescent halo under the slab — the free-tile variant.
 * The glow is texture-baked (not a filter, not a runtime blend) so switching a
 * tile between free and blocked is a texture swap that costs nothing per frame.
 */
function paintTile(ctx: CanvasRenderingContext2D, kind: TileKind, scale: number, skin: Finish, lit: boolean): void {
    const w = TILE_FACE_W;
    const h = TILE_FACE_H;
    const d = TILE_DEPTH;

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(TILE_PAD, TILE_PAD);

    // --- lit halo: light leaking out from under a tile that can be taken ---
    if (lit) {
        // Layered expanding fills instead of a blur: cheap, deterministic, and
        // identical on every canvas implementation.
        const layers = [
            { grow: 3, alpha: 0.16 },
            { grow: 6, alpha: 0.11 },
            { grow: 9, alpha: 0.07 },
            { grow: 12, alpha: 0.045 },
            { grow: 15, alpha: 0.025 },
        ];
        for (const layer of layers) {
            ctx.fillStyle = css(PALETTE.lumen, layer.alpha);
            roundedRect(ctx, -layer.grow, -layer.grow, w + layer.grow * 2, h + d + layer.grow * 2, CORNER + layer.grow);
            ctx.fill();
        }
    }

    // --- ambient shadow pooling under the slab, so it sits IN the water ----
    for (const layer of [
        { grow: 1, alpha: 0.26 },
        { grow: 4, alpha: 0.16 },
        { grow: 7, alpha: 0.09 },
        { grow: 10, alpha: 0.05 },
    ]) {
        ctx.fillStyle = css(PALETTE.abyss, layer.alpha);
        roundedRect(
            ctx,
            d - layer.grow * 0.6,
            d + 2 - layer.grow * 0.4,
            w + layer.grow * 1.4,
            h + layer.grow * 1.2,
            CORNER + layer.grow,
        );
        ctx.fill();
    }

    // --- the slab's thickness, offset down-right ---------------------------
    const edge = ctx.createLinearGradient(0, 0, d, h + d);
    edge.addColorStop(0, css(skin.edge));
    edge.addColorStop(1, css(skin.edgeDark));
    ctx.fillStyle = edge;
    roundedRect(ctx, d * 0.35, d * 0.35, w, h, CORNER);
    ctx.fill();
    roundedRect(ctx, d, d, w, h, CORNER);
    ctx.fill();

    // --- the face ----------------------------------------------------------
    const face = ctx.createLinearGradient(0, 0, w * 0.25, h);
    face.addColorStop(0, css(skin.top));
    face.addColorStop(0.55, css(skin.top, 0.94));
    face.addColorStop(1, css(skin.bottom));
    ctx.fillStyle = face;
    roundedRect(ctx, 0, 0, w, h, CORNER);
    ctx.fill();

    // Frost: a few soft diagonal streaks, clipped to the face. This is what
    // stops the tile reading as flat white plastic.
    ctx.save();
    roundedRect(ctx, 0, 0, w, h, CORNER);
    ctx.clip();
    ctx.globalAlpha = 0.5 * skin.frost;
    for (let index = 0; index < 4; index += 1) {
        const streak = ctx.createLinearGradient(0, index * 22 - 10, w, index * 22 + 14);
        streak.addColorStop(0, css(0xffffff, 0));
        streak.addColorStop(0.5, css(0xffffff, index % 2 === 0 ? 0.5 : 0.24));
        streak.addColorStop(1, css(0xffffff, 0));
        ctx.fillStyle = streak;
        ctx.fillRect(0, index * 22 - 12, w, 13);
    }
    ctx.globalAlpha = 1;

    // A cool cast pooling at the bottom, as though lit from above the water.
    const pool = ctx.createLinearGradient(0, h * 0.55, 0, h);
    pool.addColorStop(0, css(skin.bottom, 0));
    pool.addColorStop(1, css(skin.rim, 0.55));
    ctx.fillStyle = pool;
    ctx.fillRect(0, h * 0.55, w, h * 0.45);

    // Glass sheen: a soft diagonal wash falling from the lit corner. This is
    // what separates "frosted glass" from "matte plastic" — the frost streaks
    // give texture, the sheen gives curvature.
    const sheen = ctx.createLinearGradient(0, 0, w * 0.9, h * 0.75);
    sheen.addColorStop(0, css(0xffffff, skin.invertInk ? 0.16 : 0.34));
    sheen.addColorStop(0.42, css(0xffffff, skin.invertInk ? 0.05 : 0.1));
    sheen.addColorStop(0.72, css(0xffffff, 0));
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // --- the glyph ---------------------------------------------------------
    // Clipped to the face: some glyphs (the nautilus spiral) deliberately
    // overshoot and rely on being cut off at the glass edge. Before the canvas
    // was padded, its own bounds did this clipping by accident.
    ctx.save();
    roundedRect(ctx, 0, 0, w, h, CORNER);
    ctx.clip();
    ctx.translate(w / 2, h / 2);
    drawGlyph(ctx, Math.min(w, h) * 0.84, kind, skin.invertInk);
    ctx.restore();

    // --- rim and bevel -----------------------------------------------------
    ctx.strokeStyle = css(skin.rim, 0.85);
    ctx.lineWidth = 1.6;
    roundedRect(ctx, 0.8, 0.8, w - 1.6, h - 1.6, CORNER - 1);
    ctx.stroke();

    // Bevel highlight on the two lit edges only — a full outline would flatten it.
    ctx.strokeStyle = css(0xffffff, skin.invertInk ? 0.3 : 0.85);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(2.5, h - CORNER);
    ctx.lineTo(2.5, CORNER);
    ctx.arcTo(2.5, 2.5, CORNER, 2.5, CORNER - 2);
    ctx.lineTo(w - CORNER, 2.5);
    ctx.stroke();

    ctx.restore();
}

/**
 * Rendered faces, keyed by finish + scale + kind.
 *
 * Painting a face is not cheap — four gradients, clipped frost streaks and a
 * glyph — and the same faces are wanted by the loading screen, the board, the
 * menu and the how-to sheet. Caching means each one is painted once per
 * session instead of once per consumer, which is what lets the loading bar
 * warm the board's textures rather than faking progress against nothing.
 */
const canvasCache = new Map<string, HTMLCanvasElement>();

function cacheKey(kind: TileKind, scale: number, finishId: FinishId, lit: boolean): string {
    return `${finishId}:${scale}:${kind}:${lit ? "lit" : "dim"}`;
}

/**
 * Render one tile to a canvas. Exported for the store thumbnail, the how-to
 * sheet and the menu, which need bitmaps rather than Pixi textures.
 *
 * The returned canvas is SHARED. Callers must not draw on it; `TilePreview`
 * only ever inserts it into the DOM, and a canvas element can live in exactly
 * one place, so previews clone it.
 */
export function renderTileCanvas(
    kind: TileKind,
    scale = 2,
    finishId: FinishId = "vitreum",
    lit = false,
): HTMLCanvasElement {
    const key = cacheKey(kind, scale, finishId, lit);
    const cached = canvasCache.get(key);
    if (cached) return cached;

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(TILE_SPRITE_W * scale);
    canvas.height = Math.ceil(TILE_SPRITE_H * scale);
    const ctx = canvas.getContext("2d");
    if (ctx) paintTile(ctx, kind, scale, finish(finishId), lit);
    canvasCache.set(key, canvas);
    return canvas;
}

/** A private copy of a tile face, safe to insert into the DOM. */
export function cloneTileCanvas(kind: TileKind, scale = 2, finishId: FinishId = "vitreum"): HTMLCanvasElement {
    const source = renderTileCanvas(kind, scale, finishId);
    const copy = document.createElement("canvas");
    copy.width = source.width;
    copy.height = source.height;
    copy.getContext("2d")?.drawImage(source, 0, 0);
    return copy;
}

/**
 * Paint every face for a finish, yielding to the event loop between tiles so
 * the loading screen keeps animating instead of freezing for the whole batch.
 */
export async function warmTileArt(
    finishId: FinishId,
    scale: number,
    onProgress: (progress: number) => void = () => {},
): Promise<void> {
    const total = ALL_KINDS.length * 2;
    for (let index = 0; index < total; index += 1) {
        const kind = ALL_KINDS[index % ALL_KINDS.length];
        if (kind !== undefined) renderTileCanvas(kind, scale, finishId, index >= ALL_KINDS.length);
        onProgress((index + 1) / total);
        if (index % 6 === 5) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
}

export interface TileTextureSet {
    /** `lit` selects the free-tile variant with the baked halo. */
    get(kind: TileKind, lit?: boolean): Texture;
    destroy(): void;
}

/**
 * Build every tile texture, in both the plain and the lit variant. `scale`
 * should track the renderer resolution so the frosted detail survives on a 3x
 * phone without wasting memory on a 1x desktop.
 */
export function createTileTextures(scale = 2, finishId: FinishId = "vitreum"): TileTextureSet {
    const plain = new Map<TileKind, Texture>();
    const litSet = new Map<TileKind, Texture>();
    const clamped = Math.max(1, Math.min(3, scale));
    for (const kind of ALL_KINDS) {
        // The resolution MUST be passed when the source is constructed.
        // Assigning `texture.source.resolution` after `Texture.from(canvas)`
        // silently does nothing — the frame has already been computed from the
        // raw pixel size — so every tile rendered at `scale`x its design size,
        // overlapping its neighbours and swallowing their taps.
        for (const [lit, map] of [
            [false, plain],
            [true, litSet],
        ] as const) {
            const source = new ImageSource({
                resource: renderTileCanvas(kind, clamped, finishId, lit),
                resolution: clamped,
            });
            map.set(kind, new Texture({ source }));
        }
    }
    const fallback = plain.get(0) ?? Texture.EMPTY;
    return {
        get: (kind, lit = false) => (lit ? litSet : plain).get(kind) ?? fallback,
        destroy() {
            for (const texture of plain.values()) texture.destroy(true);
            for (const texture of litSet.values()) texture.destroy(true);
            plain.clear();
            litSet.clear();
        },
    };
}
