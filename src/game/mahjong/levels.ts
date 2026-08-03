/**
 * The level ladder. Levels are unbounded: the first pass introduces each
 * layout in size order, and afterwards the ladder cycles the layouts while
 * turning the one real difficulty dial — how many distinct kinds a board is
 * dealt from, which decides how many interchangeable partners each tile has.
 */
import { LAYOUTS, layoutById, type BoardLayout } from "./layouts.ts";
import { KIND_COUNT } from "./tiles.ts";

/**
 * Tray slots, and the game's real difficulty dial.
 *
 * Board size and kind variety turn out NOT to control difficulty: a big loose
 * board hands the player more free tiles to work with, and any board past
 * ~120 tiles is forced to use nearly every kind anyway, so that dial is pinned
 * before it can do anything. The tray is what decides how much guessing a
 * player can afford, and the balance sweep in `scripts/simulate.mjs` is what
 * turned that from a hunch into the numbers this table is set to.
 *
 * Narrowing the tray can never make a board unwinnable: the generator's
 * winning line holds at most one tile at a time.
 */
export const TRAY_CAPACITY_MAX = 7;
export const TRAY_CAPACITY_MIN = 5;

/** The widest the tray is ever drawn, so the scene can reserve the space. */
export const TRAY_CAPACITY = TRAY_CAPACITY_MAX;

/** Shuffle stays locked until the player has met a board big enough to need it. */
export const SHUFFLE_UNLOCK_LEVEL = 6;

/**
 * Layout order, sorted by MEASURED difficulty rather than by tile count.
 *
 * Board size turned out to be a poor predictor: the 144-tile turtle is loose
 * and generous, while the 122-tile drift shoal stacks five nudged layers and
 * exposes only a handful of free tiles at a time. The balance sweep ranks them
 * (unaided win rate, easiest first): pyramid, reef-gate, lantern-rig,
 * abyss-slab, turtle, drift-shoal. Re-run `npm run balance` after touching a
 * layout and re-sort these two lists if the ranking moves.
 */

/** Levels 1-5. Small, loose boards while the tray rule is still new. */
const INTRO: readonly string[] = ["tideline", "tideline", "pyramid", "reef-gate", "lantern-rig"];

/**
 * Level 6 onwards, cycled. The pattern deliberately drops an easier board in
 * after each hard one: an unbroken climb reads as a wall, and the breather is
 * what makes the next drift shoal feel like a step up rather than more of the
 * same.
 */
const CYCLE: readonly string[] = [
    "pyramid",
    "abyss-slab",
    "reef-gate",
    "turtle",
    "lantern-rig",
    "drift-shoal",
    "reef-gate",
    "abyss-slab",
    "turtle",
    "drift-shoal",
    "lantern-rig",
    "turtle",
];

/** Levels over which the kind-variety dial travels from loosest to tightest. */
const TIGHTENING_LEVELS = 36;

function layoutIdForLevel(level: number): string {
    const id = level <= INTRO.length ? INTRO[level - 1] : CYCLE[(level - INTRO.length - 1) % CYCLE.length];
    return id ?? "tideline";
}

export interface LevelPlan {
    level: number;
    layout: BoardLayout;
    /** How many kinds the board is dealt from. */
    distinctKinds: number;
    /** Tray slots for this level. The difficulty dial. */
    trayCapacity: number;
    /** Seconds the results screen treats as a clean run. */
    parSeconds: number;
    shuffleUnlocked: boolean;
}

/**
 * The tray narrows as the player learns the game, then holds. Seven slots is
 * an unlosable tutorial; five is where a careless tap actually costs a level.
 */
function trayCapacityForLevel(level: number): number {
    if (level <= 4) return 7;
    if (level <= 11) return 6;
    return TRAY_CAPACITY_MIN;
}

export function planLevel(level: number): LevelPlan {
    const safeLevel = Math.max(1, Math.floor(level));
    const layout = layoutById(layoutIdForLevel(safeLevel));
    const pairs = layout.slots.length / 2;

    // Fewest kinds the board can use — every kind may cover at most two pairs.
    const floor = Math.ceil(pairs / 2);
    const ceiling = Math.min(KIND_COUNT, pairs);
    const tightness = Math.min(1, (safeLevel - 1) / TIGHTENING_LEVELS);
    const distinctKinds = Math.round(floor + (ceiling - floor) * tightness);

    return {
        level: safeLevel,
        layout,
        distinctKinds: Math.max(floor, Math.min(ceiling, distinctKinds)),
        trayCapacity: trayCapacityForLevel(safeLevel),
        parSeconds: Math.round(20 + layout.slots.length * 1.9),
        shuffleUnlocked: safeLevel >= SHUFFLE_UNLOCK_LEVEL,
    };
}

/** Every layout, for the simulation harness and the level-preview art. */
export const ALL_LAYOUT_IDS: readonly string[] = LAYOUTS.map((layout) => layout.id);
