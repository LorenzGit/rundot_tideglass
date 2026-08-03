/**
 * Deal generation with a solvability GUARANTEE.
 *
 * The generator never deals kinds and then hopes: it plays the board backwards.
 * Starting from every slot occupied, it repeatedly pops slots that are free
 * *in the current state* and records the order. That pop order is, by
 * construction, a legal forward clearing order — when the player reaches step
 * N they have removed exactly the tiles the generator had removed, so the
 * tiles it popped at step N are free for them too.
 *
 * The same routine serves the shuffle tool. Tiles already sitting in the tray
 * are modelled as `carriedKinds`: their partners are assigned to the first
 * slots popped, so the tray can always be emptied.
 */
import type { Slot } from "./layouts.ts";
import type { NoiseRandom } from "../noiseRandom.ts";
import { ALL_KINDS, COPIES_PER_KIND, type TileKind } from "./tiles.ts";

interface RemovalPlan {
    /** Slots popped one at a time, to be paired with tiles already in the tray. */
    singles: Slot[];
    /** Slots popped two at a time; each pair shares a kind. */
    pairs: Array<[Slot, Slot]>;
}

interface WorkingSlot {
    slot: Slot;
    present: boolean;
}

/** Free-tile test against a working set — mirrors Board.isFree exactly. */
function isFreeIn(index: Map<string, WorkingSlot>, slot: Slot): boolean {
    const at = (layer: number, hx: number, hy: number): boolean => {
        const found = index.get(`${layer}:${hx}:${hy}`);
        return found !== undefined && found.present;
    };
    const { layer, hx, hy } = slot;
    for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
            if (at(layer + 1, hx + dx, hy + dy)) return false;
        }
    }
    let blockedLeft = false;
    let blockedRight = false;
    for (let dy = -1; dy <= 1; dy += 1) {
        if (at(layer, hx - 2, hy + dy)) blockedLeft = true;
        if (at(layer, hx + 2, hy + dy)) blockedRight = true;
    }
    return !blockedLeft || !blockedRight;
}

/**
 * Pop `carried` slots singly, then the rest in pairs. Returns null when the
 * layout wedges itself — a tower with one tile per layer has exactly one free
 * tile and cannot yield a pair. Callers retry with a fresh seed.
 */
function planRemoval(slots: readonly Slot[], carried: number, random: NoiseRandom): RemovalPlan | null {
    const working: WorkingSlot[] = slots.map((slot) => ({ slot, present: true }));
    const index = new Map<string, WorkingSlot>();
    for (const entry of working) index.set(`${entry.slot.layer}:${entry.slot.hx}:${entry.slot.hy}`, entry);

    const freeNow = (): WorkingSlot[] => working.filter((entry) => entry.present && isFreeIn(index, entry.slot));

    const singles: Slot[] = [];
    const pairs: Array<[Slot, Slot]> = [];
    let left = working.length;

    for (let step = 0; step < carried; step += 1) {
        const free = freeNow();
        const picked = free[random.int(0, free.length)];
        if (!picked) return null;
        picked.present = false;
        singles.push(picked.slot);
        left -= 1;
    }

    while (left > 0) {
        const free = freeNow();
        if (free.length < 2) return null;
        // Removing a free tile can only free more tiles, never block one, so
        // both picks stay legal without recomputing between them.
        const firstAt = random.int(0, free.length);
        let secondAt = random.int(0, free.length - 1);
        if (secondAt >= firstAt) secondAt += 1;
        const first = free[firstAt];
        const second = free[secondAt];
        if (!first || !second) return null;
        first.present = false;
        second.present = false;
        pairs.push([first.slot, second.slot]);
        left -= 2;
    }

    return { singles, pairs };
}

function shuffleInPlace<T>(items: T[], random: NoiseRandom): void {
    for (let index = items.length - 1; index > 0; index -= 1) {
        const swap = random.int(0, index + 1);
        const a = items[index];
        const b = items[swap];
        if (a === undefined || b === undefined) continue;
        items[index] = b;
        items[swap] = a;
    }
}

/**
 * Choose which kinds a fresh board is dealt from.
 *
 * `distinctKinds` is the difficulty dial. Every kind may appear at most twice
 * as a pair (four tiles), so a board of `pairs` pairs needs at least
 * `ceil(pairs / 2)` distinct kinds. Asking for fewer duplicates — more distinct
 * kinds — means fewer interchangeable partners and a tighter board.
 */
function buildKindBag(pairs: number, distinctKinds: number, random: NoiseRandom): TileKind[] {
    const maxPairsPerKind = COPIES_PER_KIND / 2;
    const minimumKinds = Math.ceil(pairs / maxPairsPerKind);
    // Fail here rather than silently dealing `undefined` kinds: an oversized
    // layout is a content bug, and a board of NaN tiles is far harder to trace
    // back than the layout that caused it.
    if (minimumKinds > ALL_KINDS.length) {
        throw new Error(
            `A ${pairs * 2}-tile board needs ${minimumKinds} distinct kinds but only ${ALL_KINDS.length} exist`,
        );
    }
    const wanted = Math.max(minimumKinds, Math.min(distinctKinds, Math.min(ALL_KINDS.length, pairs)));

    const pool = [...ALL_KINDS];
    shuffleInPlace(pool, random);
    const chosen = pool.slice(0, wanted);

    const bag: TileKind[] = [];
    // Round-robin so the duplicate load is spread evenly instead of piling
    // four copies onto the first few kinds.
    for (let round = 0; round < maxPairsPerKind && bag.length < pairs; round += 1) {
        for (const kind of chosen) {
            if (bag.length >= pairs) break;
            bag.push(kind);
        }
    }
    shuffleInPlace(bag, random);
    return bag;
}

export interface DealOptions {
    /** How many different tile kinds the board draws from. Higher is harder. */
    distinctKinds: number;
    /** Retries before giving up on a layout. Only pathological layouts retry. */
    attempts?: number;
}

export interface Deal {
    /** Kinds parallel to the slots handed in. */
    kinds: TileKind[];
    /**
     * The winning line the generator walked backwards, as slot-index pairs in
     * the order they may be cleared. The simulation replays this through a real
     * session, which is what turns "solvable by construction" into a fact the
     * build actually checks.
     */
    solution: Array<[number, number]>;
}

/** Deal a fresh, guaranteed-solvable board. */
export function dealSolvableBoard(slots: readonly Slot[], random: NoiseRandom, options: DealOptions): Deal {
    const attempts = options.attempts ?? 24;
    const indexOfSlot = new Map<string, number>();
    slots.forEach((slot, index) => {
        indexOfSlot.set(slotKey(slot), index);
    });

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const plan = planRemoval(slots, 0, random);
        if (!plan) continue;
        const bag = buildKindBag(plan.pairs.length, options.distinctKinds, random);
        const kinds = new Array<TileKind>(slots.length).fill(0);
        const solution: Array<[number, number]> = [];
        plan.pairs.forEach(([first, second], index) => {
            const kind = bag[index] ?? 0;
            const a = indexOfSlot.get(slotKey(first)) ?? 0;
            const b = indexOfSlot.get(slotKey(second)) ?? 0;
            kinds[a] = kind;
            kinds[b] = kind;
            solution.push([a, b]);
        });
        return { kinds, solution };
    }
    throw new Error(`Could not deal a solvable board for ${slots.length} slots — the layout wedges itself`);
}

/**
 * Re-deal the kinds still on the board so the board is solvable again, holding
 * the multiset of remaining kinds fixed. `carriedKinds` are the tray's tiles:
 * each is distinct (a second copy would have matched on arrival) and each gets
 * a partner among the first slots the plan frees.
 */
export interface Reshuffle {
    /** Kinds parallel to the slots handed in. */
    kinds: TileKind[];
    /** Slot indices whose tiles clear a tray tile, in the order to tap them. */
    singles: number[];
    /** Slot-index pairs to clear afterwards, in order. */
    solution: Array<[number, number]>;
}

export function reshuffleRemaining(
    slots: readonly Slot[],
    remainingKinds: readonly TileKind[],
    carriedKinds: readonly TileKind[],
    random: NoiseRandom,
    attempts = 24,
): Reshuffle | null {
    if (slots.length !== remainingKinds.length) {
        throw new Error("reshuffleRemaining: slot and kind counts differ");
    }
    const counts = new Map<TileKind, number>();
    for (const kind of remainingKinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    // Spend one copy of each carried kind on its tray partner; whatever is left
    // must pair up exactly, which it does because tiles only ever leave in twos.
    for (const kind of carriedKinds) {
        const available = counts.get(kind) ?? 0;
        if (available < 1) return null;
        counts.set(kind, available - 1);
    }
    const pairBag: TileKind[] = [];
    for (const [kind, count] of counts) {
        if (count % 2 !== 0) return null;
        for (let index = 0; index < count / 2; index += 1) pairBag.push(kind);
    }

    const indexOfSlot = new Map<string, number>();
    slots.forEach((slot, index) => {
        indexOfSlot.set(slotKey(slot), index);
    });

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const plan = planRemoval(slots, carriedKinds.length, random);
        if (!plan || plan.pairs.length !== pairBag.length) continue;
        const bag = [...pairBag];
        shuffleInPlace(bag, random);
        const carried = [...carriedKinds];
        shuffleInPlace(carried, random);

        const kinds = new Array<TileKind>(slots.length).fill(0);
        const singles: number[] = [];
        const solution: Array<[number, number]> = [];
        plan.singles.forEach((slot, index) => {
            const at = indexOfSlot.get(slotKey(slot)) ?? 0;
            kinds[at] = carried[index] ?? 0;
            singles.push(at);
        });
        plan.pairs.forEach(([first, second], index) => {
            const kind = bag[index] ?? 0;
            const a = indexOfSlot.get(slotKey(first)) ?? 0;
            const b = indexOfSlot.get(slotKey(second)) ?? 0;
            kinds[a] = kind;
            kinds[b] = kind;
            solution.push([a, b]);
        });
        return { kinds, singles, solution };
    }
    return null;
}

function slotKey(slot: Slot): string {
    return `${slot.layer}:${slot.hx}:${slot.hy}`;
}
