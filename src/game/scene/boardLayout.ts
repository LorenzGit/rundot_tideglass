/**
 * Where every tile goes, in design units.
 *
 * Slots arrive in half-tile units from `mahjong/layouts.ts`; this turns them
 * into positions, and works out the scale that makes a given layout fit the
 * board well on the current screen. Nothing here knows about Pixi.
 */
import { TILE_DEPTH, TILE_FACE_H, TILE_FACE_W } from "../art/tileArt.ts";
import { layoutBounds, type BoardLayout, type Slot } from "../mahjong/layouts.ts";

/**
 * How far each layer is lifted up and to the left. Tiles are extruded down and
 * to the right, so lifting up-left is what makes a stack read as a stack: the
 * tile below stays visible along the two edges the light comes from.
 */
export const LAYER_LIFT_X = 5;
export const LAYER_LIFT_Y = 8;

export interface Point {
    x: number;
    y: number;
}

/** Centre of a slot's FACE, relative to the board's own origin. */
export function slotCentre(slot: Slot): Point {
    return {
        x: (slot.hx / 2) * TILE_FACE_W + TILE_FACE_W / 2 - slot.layer * LAYER_LIFT_X,
        y: (slot.hy / 2) * TILE_FACE_H + TILE_FACE_H / 2 - slot.layer * LAYER_LIFT_Y,
    };
}

/**
 * Painter's order: lower layers first, then back to front within a layer. Two
 * tiles on the same layer never overlap, but a tile's thickness spills onto its
 * down-right neighbour, so row and column order still matter.
 */
export function paintOrder(slots: readonly Slot[]): number[] {
    return slots
        .map((slot, index) => ({ slot, index }))
        .sort((a, b) => a.slot.layer - b.slot.layer || a.slot.hy - b.slot.hy || a.slot.hx - b.slot.hx)
        .map((entry) => entry.index);
}

export interface BoardFit {
    /** Scale to apply to the board container. */
    scale: number;
    /** Board origin offset so the layout is centred in the well. */
    offsetX: number;
    offsetY: number;
    /** Board size in design units after scaling. */
    width: number;
    height: number;
}

/**
 * Fit a layout into a well. The board is scaled uniformly; it is never
 * stretched, because a non-uniform scale would make the tile faces — which are
 * one fixed texture — visibly wrong.
 *
 * `verticalBias` places the board in the well: 0.5 is dead centre, and the
 * default 0.38 sits it slightly high. Short layouts like Tideline are only four
 * rows deep, and centring them in a tall portrait well strands a band of empty
 * water between the tray and the board that reads as a bug. Biasing up keeps
 * the slack in one place, above the toolbar, where it looks deliberate.
 */
export function fitBoard(
    layout: BoardLayout,
    wellWidth: number,
    wellHeight: number,
    maxScale = 1.45,
    verticalBias = 0.38,
): BoardFit {
    const bounds = layoutBounds(layout);
    // The extremes of the drawn art, not just the slot grid: the top layer
    // reaches furthest up-left and the bottom layer's thickness furthest
    // down-right.
    const left = (bounds.minHx / 2) * TILE_FACE_W - bounds.maxLayer * LAYER_LIFT_X;
    const right = (bounds.maxHx / 2) * TILE_FACE_W + TILE_DEPTH;
    const top = (bounds.minHy / 2) * TILE_FACE_H - bounds.maxLayer * LAYER_LIFT_Y;
    const bottom = (bounds.maxHy / 2) * TILE_FACE_H + TILE_DEPTH;

    const rawWidth = right - left;
    const rawHeight = bottom - top;
    const scale = Math.min(maxScale, wellWidth / rawWidth, wellHeight / rawHeight);

    return {
        scale,
        // Centre the drawn extent, then shift into board-origin space.
        offsetX: (wellWidth - rawWidth * scale) / 2 - left * scale,
        offsetY: (wellHeight - rawHeight * scale) * verticalBias - top * scale,
        width: rawWidth * scale,
        height: rawHeight * scale,
    };
}
