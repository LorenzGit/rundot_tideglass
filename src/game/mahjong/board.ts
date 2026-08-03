/**
 * Board state and the free-tile rule. Renderer-free on purpose: `npm run
 * simulate` plays thousands of boards through this file with no Pixi, no DOM
 * and no timers, which is the only way the solvability guarantee is worth
 * anything.
 */
import type { BoardLayout, Slot } from "./layouts.ts";
import type { TileKind } from "./tiles.ts";

export interface Tile {
    id: number;
    kind: TileKind;
    slot: Slot;
    /** False once the tile has left the board for the tray. */
    onBoard: boolean;
}

export class Board {
    readonly layout: BoardLayout;
    readonly tiles: Tile[];

    /** `layer:hx:hy` -> tile, maintained for O(1) neighbour probing. */
    private readonly occupancy = new Map<string, Tile>();

    constructor(layout: BoardLayout, kinds: readonly TileKind[]) {
        if (kinds.length !== layout.slots.length) {
            throw new Error(`Board needs ${layout.slots.length} kinds, received ${kinds.length}`);
        }
        this.layout = layout;
        this.tiles = layout.slots.map((slot, index) => ({
            id: index,
            kind: kinds[index] ?? 0,
            slot,
            onBoard: true,
        }));
        for (const tile of this.tiles) this.occupancy.set(key(tile.slot), tile);
    }

    get remaining(): number {
        let count = 0;
        for (const tile of this.tiles) if (tile.onBoard) count += 1;
        return count;
    }

    tileAt(layer: number, hx: number, hy: number): Tile | null {
        const tile = this.occupancy.get(`${layer}:${hx}:${hy}`);
        return tile && tile.onBoard ? tile : null;
    }

    /**
     * A tile is free when nothing rests on top of it AND at least one of its
     * long sides is open. Both halves matter: covered tiles cannot be lifted,
     * and a tile wedged between two neighbours cannot slide out either.
     */
    isFree(tile: Tile): boolean {
        if (!tile.onBoard) return false;
        const { layer, hx, hy } = tile.slot;

        // Covered? Anything on the layer above whose 2x2 footprint overlaps.
        for (let dx = -1; dx <= 1; dx += 1) {
            for (let dy = -1; dy <= 1; dy += 1) {
                if (this.tileAt(layer + 1, hx + dx, hy + dy)) return false;
            }
        }

        // Same-layer neighbours overlap vertically when their hy differs by
        // less than a full tile, which is what the dy loop covers.
        let blockedLeft = false;
        let blockedRight = false;
        for (let dy = -1; dy <= 1; dy += 1) {
            if (this.tileAt(layer, hx - 2, hy + dy)) blockedLeft = true;
            if (this.tileAt(layer, hx + 2, hy + dy)) blockedRight = true;
        }
        return !blockedLeft || !blockedRight;
    }

    freeTiles(): Tile[] {
        return this.tiles.filter((tile) => this.isFree(tile));
    }

    /** Lift a tile off the board. Returns false if it was not actually free. */
    lift(tile: Tile): boolean {
        if (!this.isFree(tile)) return false;
        tile.onBoard = false;
        return true;
    }

    /** Put a lifted tile back — the exact inverse of `lift`, used by undo. */
    restore(tile: Tile): void {
        tile.onBoard = true;
    }

    /**
     * Kinds still on the board, counted. Used by the shuffle tool and by the
     * dead-end detector.
     */
    remainingKindCounts(): Map<TileKind, number> {
        const counts = new Map<TileKind, number>();
        for (const tile of this.tiles) {
            if (!tile.onBoard) continue;
            counts.set(tile.kind, (counts.get(tile.kind) ?? 0) + 1);
        }
        return counts;
    }

    /**
     * Reassign the kinds of the tiles still on the board. The multiset is
     * preserved, so a shuffle can never make the board unwinnable by changing
     * what is left — only where it sits.
     */
    reassign(kinds: readonly TileKind[]): void {
        const live = this.tiles.filter((tile) => tile.onBoard);
        if (kinds.length !== live.length) {
            throw new Error(`reassign needs ${live.length} kinds, received ${kinds.length}`);
        }
        live.forEach((tile, index) => {
            tile.kind = kinds[index] ?? tile.kind;
        });
    }
}

function key(slot: Slot): string {
    return `${slot.layer}:${slot.hx}:${slot.hy}`;
}

/**
 * Pairs of free tiles that share a kind — the moves a player could make right
 * now without touching the tray. The hint tool shows the first one.
 */
export function freePairs(board: Board): Array<[Tile, Tile]> {
    const free = board.freeTiles();
    const byKind = new Map<TileKind, Tile[]>();
    for (const tile of free) {
        const bucket = byKind.get(tile.kind);
        if (bucket) bucket.push(tile);
        else byKind.set(tile.kind, [tile]);
    }
    const pairs: Array<[Tile, Tile]> = [];
    for (const bucket of byKind.values()) {
        for (let index = 0; index + 1 < bucket.length; index += 2) {
            const first = bucket[index];
            const second = bucket[index + 1];
            if (first && second) pairs.push([first, second]);
        }
    }
    return pairs;
}
