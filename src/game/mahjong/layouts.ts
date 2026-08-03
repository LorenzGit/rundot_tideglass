/**
 * Board layouts, expressed as slots in HALF-TILE units.
 *
 * A tile is 2x2 half-units, so a slot at (hx, hy) occupies [hx, hx+2) x
 * [hy, hy+2). Half-unit coordinates are what make the classic Mahjong
 * half-step offsets (the turtle's wings, the staggered shoal) expressible at
 * all — never round these to whole tiles.
 *
 * Layer 0 is the table; higher layers stack on top and cover what they overlap.
 */

export interface Slot {
    layer: number;
    hx: number;
    hy: number;
}

export interface BoardLayout {
    id: string;
    /** Shown on the level banner. */
    name: string;
    slots: readonly Slot[];
}

function rect(layer: number, tilesWide: number, tilesTall: number, hx0: number, hy0: number): Slot[] {
    const slots: Slot[] = [];
    for (let row = 0; row < tilesTall; row += 1) {
        for (let column = 0; column < tilesWide; column += 1) {
            slots.push({ layer, hx: hx0 + column * 2, hy: hy0 + row * 2 });
        }
    }
    return slots;
}

/** A horizontally centred row of `tilesWide` tiles. */
function row(layer: number, tilesWide: number, hy: number, hxCentre = 0): Slot[] {
    const hx0 = hxCentre - tilesWide;
    return Array.from({ length: tilesWide }, (_, index) => ({ layer, hx: hx0 + index * 2, hy }));
}

/** Centred stack of rectangles, each `shrink` tiles narrower/shorter than the last. */
function pyramid(baseWide: number, baseTall: number, layers: number, shrink = 1): Slot[] {
    const slots: Slot[] = [];
    for (let layer = 0; layer < layers; layer += 1) {
        const wide = baseWide - layer * shrink;
        const tall = baseTall - layer * shrink;
        if (wide < 1 || tall < 1) break;
        slots.push(...rect(layer, wide, tall, -wide, -tall));
    }
    return slots;
}

/**
 * The classic turtle, 144 tiles. Eight rows on the table plus the two wings,
 * then 6x6, 4x4, 2x2 and a single capstone.
 */
function turtle(): Slot[] {
    const slots: Slot[] = [];
    const widths = [12, 8, 10, 12, 12, 10, 8, 12];
    widths.forEach((wide, index) => {
        slots.push(...row(0, wide, index * 2));
    });
    // Wings sit half a tile below the row grid, level with the turtle's waist.
    slots.push({ layer: 0, hx: -14, hy: 7 });
    slots.push({ layer: 0, hx: 12, hy: 7 });
    slots.push({ layer: 0, hx: 14, hy: 7 });
    slots.push(...rect(1, 6, 6, -6, 2));
    slots.push(...rect(2, 4, 4, -4, 4));
    slots.push(...rect(3, 2, 2, -2, 6));
    slots.push({ layer: 4, hx: -1, hy: 7 });
    return slots;
}

/**
 * The loose, staggered mound from the reference: a wide base that narrows as
 * it climbs, with every other layer nudged half a tile so edges stay legible.
 */
function driftShoal(): Slot[] {
    const slots: Slot[] = [];
    const plan: readonly (readonly number[])[] = [
        [8, 9, 10, 10, 9, 8],
        [6, 7, 8, 7, 6],
        [4, 5, 6, 5],
        [3, 4, 3],
        [2, 2],
    ];
    plan.forEach((rows, layer) => {
        const hyStart = layer * 2 + 2;
        rows.forEach((wide, index) => {
            // The half-unit nudge is what stops higher layers from hiding the
            // long edges of the layer below, which is what keeps tiles free.
            const nudge = layer % 2 === 0 ? 0 : 1;
            slots.push(...row(layer, wide, hyStart + index * 2, nudge));
        });
    });
    return slots;
}

/** Two pillars, a lintel top and bottom, and a raised block in the doorway. */
function reefGate(): Slot[] {
    const slots: Slot[] = [];
    slots.push(...rect(0, 3, 8, -14, 0)); // left pillar
    slots.push(...rect(0, 3, 8, 8, 0)); // right pillar
    slots.push(...rect(0, 8, 1, -8, 0)); // lintel
    slots.push(...rect(0, 8, 1, -8, 14)); // threshold
    slots.push(...rect(0, 4, 4, -4, 4)); // the block in the doorway
    slots.push(...rect(1, 2, 6, -12, 2));
    slots.push(...rect(1, 2, 6, 8, 2));
    slots.push(...rect(1, 2, 2, -2, 6));
    return slots;
}

/**
 * A dense slab with a hollow well in its second layer. The well matters: a
 * solid upper layer would bury the middle of the slab for most of the level.
 */
function abyssSlab(): Slot[] {
    const slots: Slot[] = [];
    slots.push(...rect(0, 10, 9, -10, 0));
    const ring = new Set<string>();
    for (const slot of rect(1, 8, 7, -8, 2)) ring.add(`${slot.hx}:${slot.hy}`);
    for (const slot of rect(1, 4, 3, -4, 6)) ring.delete(`${slot.hx}:${slot.hy}`);
    for (const key of ring) {
        const parts = key.split(":");
        slots.push({ layer: 1, hx: Number(parts[0]), hy: Number(parts[1]) });
    }
    return slots;
}

/**
 * The opener: a shallow shelf with one raised bank. Deliberately the easiest
 * board in the game, but not the smallest it could be — a four-row layout left
 * most of a portrait screen empty, and a first level that looks unfinished is a
 * worse first impression than one that is slightly too generous.
 */
function tideline(): Slot[] {
    const slots: Slot[] = [];
    // Even widths only. `row` centres on hx = -width, so an odd width lands on
    // odd half-units and an even one on even half-units — mixing them staggers
    // every other row by half a tile and makes a tidy board look ragged.
    slots.push(...row(0, 6, 0));
    slots.push(...row(0, 8, 2));
    slots.push(...row(0, 10, 4));
    slots.push(...row(0, 10, 6));
    slots.push(...row(0, 8, 8));
    slots.push(...row(0, 6, 10));
    slots.push(...rect(1, 4, 2, -4, 4));
    return slots;
}

/** Mid-size lattice with four raised corners. */
function lanternRig(): Slot[] {
    const slots: Slot[] = [];
    slots.push(...rect(0, 10, 7, -10, 0));
    slots.push(...rect(1, 2, 2, -8, 2));
    slots.push(...rect(1, 2, 2, 4, 2));
    slots.push(...rect(1, 2, 2, -8, 8));
    slots.push(...rect(1, 2, 2, 4, 8));
    slots.push(...rect(1, 4, 3, -4, 4));
    return slots;
}

function sortedLayout(id: string, name: string, slots: Slot[]): BoardLayout {
    // Deduplicate defensively: an overlapping pair would make one tile
    // permanently unreachable and quietly break solvability.
    const seen = new Set<string>();
    const unique: Slot[] = [];
    for (const slot of slots) {
        const key = `${slot.layer}:${slot.hx}:${slot.hy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(slot);
    }
    // Boards deal in pairs, so an odd slot count cannot be filled. Drop the
    // last slot rather than shipping a board that can never be cleared.
    if (unique.length % 2 === 1) unique.pop();
    unique.sort((a, b) => a.layer - b.layer || a.hy - b.hy || a.hx - b.hx);
    return { id, name, slots: unique };
}

export const LAYOUTS: readonly BoardLayout[] = [
    sortedLayout("tideline", "Tideline", tideline()),
    sortedLayout("lantern-rig", "Lantern Rig", lanternRig()),
    sortedLayout("drift-shoal", "Drift Shoal", driftShoal()),
    sortedLayout("reef-gate", "Reef Gate", reefGate()),
    sortedLayout("pyramid", "Sunken Step", sortedPyramid()),
    sortedLayout("abyss-slab", "Abyss Slab", abyssSlab()),
    sortedLayout("turtle", "Old Turtle", turtle()),
];

function sortedPyramid(): Slot[] {
    // Shrink by two per layer so each step is inset a full tile on every side:
    // shrinking by one leaves the upper layer flush with an edge, which looks
    // like a mistake and buries the row beneath it.
    return pyramid(8, 7, 4, 2);
}

export function layoutById(id: string): BoardLayout {
    const found = LAYOUTS.find((layout) => layout.id === id) ?? LAYOUTS[0];
    if (!found) throw new Error("No board layouts are defined");
    return found;
}

/** Bounding box in half-units, used by the scene to fit the board on screen. */
export function layoutBounds(layout: BoardLayout): {
    minHx: number;
    maxHx: number;
    minHy: number;
    maxHy: number;
    maxLayer: number;
} {
    let minHx = Number.POSITIVE_INFINITY;
    let maxHx = Number.NEGATIVE_INFINITY;
    let minHy = Number.POSITIVE_INFINITY;
    let maxHy = Number.NEGATIVE_INFINITY;
    let maxLayer = 0;
    for (const slot of layout.slots) {
        minHx = Math.min(minHx, slot.hx);
        maxHx = Math.max(maxHx, slot.hx + 2);
        minHy = Math.min(minHy, slot.hy);
        maxHy = Math.max(maxHy, slot.hy + 2);
        maxLayer = Math.max(maxLayer, slot.layer);
    }
    return { minHx, maxHx, minHy, maxHy, maxLayer };
}
