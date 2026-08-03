#!/usr/bin/env node
/**
 * Deterministic headless proof for TIDEGLASS.
 *
 * `src/game/mahjong/` imports no Pixi, no React and no store, so it runs here
 * exactly as it runs in the browser — Node 22+ strips the TypeScript types on
 * import.
 *
 * The thing this file exists to catch: a board that CANNOT BE FINISHED. That
 * failure is invisible on screen — an unwinnable board looks exactly like a
 * hard one until a player has wasted ten minutes on it — so every deal and
 * every shuffle is replayed here through the real session, tap by legal tap,
 * until the board is empty.
 *
 *   npm run simulate    correctness gates
 *   npm run balance     win-rate sweep across the level ladder
 */
import process from "node:process";
import { NoiseRandom } from "../src/game/noiseRandom.ts";
import { Board, freePairs } from "../src/game/mahjong/board.ts";
import { LAYOUTS, layoutBounds } from "../src/game/mahjong/layouts.ts";
import { planLevel } from "../src/game/mahjong/levels.ts";
import { MahjongSession } from "../src/game/mahjong/session.ts";
import { COPIES_PER_KIND, FULL_SET_SIZE, KIND_COUNT, kindName, ALL_KINDS } from "../src/game/mahjong/tiles.ts";

let failures = 0;

function check(condition, message) {
    if (condition) return;
    failures += 1;
    console.error(`  FAIL  ${message}`);
}

// ---------------------------------------------------------------------------
// Tile set
// ---------------------------------------------------------------------------

function checkTileSet() {
    console.log("Tile set");
    check(KIND_COUNT === 36, `expected 36 kinds, got ${KIND_COUNT}`);
    check(FULL_SET_SIZE === 144, `expected a 144-tile set, got ${FULL_SET_SIZE}`);
    check(COPIES_PER_KIND % 2 === 0, "copies per kind must be even or tiles cannot pair up");
    const names = new Set(ALL_KINDS.map(kindName));
    check(names.size === KIND_COUNT, `tile names collide: ${names.size} names for ${KIND_COUNT} kinds`);
    console.log(`  ${KIND_COUNT} kinds x ${COPIES_PER_KIND} = ${FULL_SET_SIZE} tiles`);
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

function checkLayouts() {
    console.log("Layouts");
    for (const layout of LAYOUTS) {
        const slots = layout.slots;
        check(slots.length % 2 === 0, `${layout.id}: ${slots.length} slots is odd and can never be cleared`);
        check(slots.length >= 24, `${layout.id}: only ${slots.length} slots, too small to be a level`);
        check(
            slots.length <= FULL_SET_SIZE,
            `${layout.id}: ${slots.length} slots exceeds the ${FULL_SET_SIZE}-tile set`,
        );

        const seen = new Set();
        for (const slot of slots) {
            const key = `${slot.layer}:${slot.hx}:${slot.hy}`;
            check(!seen.has(key), `${layout.id}: duplicate slot at ${key}`);
            seen.add(key);
        }

        // Every tile must rest on something: a slot floating over a hole reads
        // as a rendering glitch and blocks the tiles it does not touch.
        for (const slot of slots) {
            if (slot.layer === 0) continue;
            let supported = false;
            for (let dx = -1; dx <= 1 && !supported; dx += 1) {
                for (let dy = -1; dy <= 1 && !supported; dy += 1) {
                    if (seen.has(`${slot.layer - 1}:${slot.hx + dx}:${slot.hy + dy}`)) supported = true;
                }
            }
            check(supported, `${layout.id}: slot ${slot.layer}:${slot.hx}:${slot.hy} floats over nothing`);
        }

        const bounds = layoutBounds(layout);
        const wide = (bounds.maxHx - bounds.minHx) / 2;
        const tall = (bounds.maxHy - bounds.minHy) / 2;
        // The board is drawn into a portrait well; anything wider than it is
        // tall would have to shrink until the faces stop reading.
        check(wide <= 16, `${layout.id}: ${wide} tiles wide will not fit a phone`);
        console.log(
            `  ${layout.id.padEnd(12)} ${String(slots.length).padStart(3)} tiles  ` +
                `${wide}x${tall} tiles  ${bounds.maxLayer + 1} layers`,
        );
    }
}

// ---------------------------------------------------------------------------
// The free-tile rule
// ---------------------------------------------------------------------------

function checkFreeRule() {
    console.log("Free-tile rule");
    const layout = {
        id: "probe",
        name: "probe",
        slots: [
            { layer: 0, hx: 0, hy: 0 }, // 0: middle of a row of three
            { layer: 0, hx: -2, hy: 0 }, // 1: left neighbour
            { layer: 0, hx: 2, hy: 0 }, // 2: right neighbour
            { layer: 1, hx: -2, hy: 0 }, // 3: sits on top of 1
        ],
    };
    const board = new Board(layout, [0, 0, 1, 1]);
    const [middle, left, right, capstone] = board.tiles;

    check(!board.isFree(middle), "a tile with neighbours on both sides must be blocked");
    check(!board.isFree(left), "a covered tile must be blocked");
    check(board.isFree(right), "a tile open on its right must be free");
    check(board.isFree(capstone), "the top of a stack must be free");

    board.lift(capstone);
    check(board.isFree(left), "uncovering a tile must free it");
    board.lift(left);
    check(board.isFree(middle), "removing a side neighbour must free the middle");
    board.restore(left);
    check(!board.isFree(middle), "restoring a neighbour must block the middle again");

    // Half-step overlap: a tile offset by one half-unit still covers.
    const offset = new Board(
        {
            id: "probe2",
            name: "probe2",
            slots: [
                { layer: 0, hx: 0, hy: 0 },
                { layer: 1, hx: 1, hy: 1 },
            ],
        },
        [0, 0],
    );
    check(!offset.isFree(offset.tiles[0]), "a half-step overlapping tile must still count as covering");
}

// ---------------------------------------------------------------------------
// Every board can actually be finished
// ---------------------------------------------------------------------------

/**
 * Replay a session's own winning line through the public tap API. Nothing is
 * reached into: if `tap` rejects a move the line was not legal, and if the
 * session does not end in "won" the board was not finishable.
 */
function replaySolution(session, label) {
    let clock = 0;
    for (const tileId of session.solutionSingles) {
        clock += 900;
        const result = session.tap(tileId, clock);
        if (!result.ok || !result.matched) {
            failures += 1;
            console.error(`  FAIL  ${label}: tray-clearing tap on tile ${tileId} did not match (${result.rejected})`);
            return false;
        }
    }
    for (const [first, second] of session.solution) {
        clock += 900;
        const a = session.tap(first, clock);
        if (!a.ok) {
            failures += 1;
            console.error(`  FAIL  ${label}: solution tap on tile ${first} rejected (${a.rejected})`);
            return false;
        }
        clock += 900;
        const b = session.tap(second, clock);
        if (!b.ok || !b.matched) {
            failures += 1;
            console.error(`  FAIL  ${label}: solution tap on tile ${second} did not match (${b.rejected})`);
            return false;
        }
    }
    if (session.status !== "won") {
        failures += 1;
        console.error(`  FAIL  ${label}: replaying the winning line ended "${session.status}", not "won"`);
        return false;
    }
    return true;
}

function checkSolvability(levels, seedsPerLevel) {
    console.log(`Solvability (${levels} levels x ${seedsPerLevel} seeds, every board played to empty)`);
    let boards = 0;
    for (let level = 1; level <= levels; level += 1) {
        for (let seed = 0; seed < seedsPerLevel; seed += 1) {
            const session = new MahjongSession(level, new NoiseRandom(0x51de_0000 + level * 977 + seed), {
                hints: 3,
                undos: 5,
                shuffles: 1,
            });
            const total = session.plan.layout.slots.length;
            check(
                session.solution.length * 2 === total,
                `level ${level} seed ${seed}: solution covers ${session.solution.length * 2}/${total} tiles`,
            );
            // Every kind must appear an even number of times or a pair is stranded.
            const counts = session.board.remainingKindCounts();
            for (const [kind, count] of counts) {
                check(
                    count % 2 === 0,
                    `level ${level} seed ${seed}: ${kindName(kind)} dealt ${count} times, which cannot pair`,
                );
                check(
                    count <= COPIES_PER_KIND,
                    `level ${level} seed ${seed}: ${kindName(kind)} dealt ${count} times, over the ${COPIES_PER_KIND}-copy limit`,
                );
            }
            if (!replaySolution(session, `level ${level} seed ${seed}`)) return;
            boards += 1;
        }
    }
    console.log(`  ${boards} boards dealt and cleared to empty`);
}

/**
 * A shuffle must hand back a board that can still be finished — including the
 * tiles already committed to the tray. This plays part of a level, holds a few
 * tiles, shuffles, and then proves the fresh line wins from that exact state.
 */
function checkShuffleSolvability(rounds) {
    console.log(`Shuffle solvability (${rounds} part-played boards shuffled and finished)`);
    let shuffled = 0;
    for (let round = 0; round < rounds; round += 1) {
        const level = 3 + (round % 10);
        const random = new NoiseRandom(0x5ecd_0000 + round * 613);
        const session = new MahjongSession(level, random, { hints: 3, undos: 5, shuffles: 3 });

        // Play a while, deliberately leaving unmatched tiles in the tray so the
        // carried-kind path is the one under test.
        let clock = 0;
        const held = Math.min(session.trayCapacity - 2, 1 + (round % 4));
        for (const [first, second] of session.solution.slice(0, 6)) {
            clock += 800;
            session.tap(first, clock);
            clock += 800;
            session.tap(second, clock);
        }
        let placed = 0;
        while (placed < held && session.status === "playing") {
            const free = session.board.freeTiles().filter((tile) => !session.tray.some((t) => t.kind === tile.kind));
            if (free.length === 0) break;
            clock += 800;
            const result = session.tap(free[0].id, clock);
            if (!result.ok) break;
            placed += 1;
        }
        check(session.tray.length > 0, `round ${round}: wanted tiles held in the tray, got none`);

        const trayBefore = session.tray.map((tile) => tile.kind).sort((a, b) => a - b);
        const countsBefore = [...session.board.remainingKindCounts()].sort((a, b) => a[0] - b[0]);

        check(session.shuffle(), `round ${round}: shuffle refused a live board`);

        const countsAfter = [...session.board.remainingKindCounts()].sort((a, b) => a[0] - b[0]);
        check(
            JSON.stringify(countsBefore) === JSON.stringify(countsAfter),
            `round ${round}: shuffle changed which tiles are left, not just where they are`,
        );
        check(
            JSON.stringify(trayBefore) === JSON.stringify(session.tray.map((t) => t.kind).sort((a, b) => a - b)),
            `round ${round}: shuffle disturbed the tray`,
        );
        check(
            session.solutionSingles.length === session.tray.length,
            `round ${round}: ${session.tray.length} tiles held but ${session.solutionSingles.length} partners planned`,
        );

        if (!replaySolution(session, `shuffle round ${round}`)) return;
        shuffled += 1;
    }
    console.log(`  ${shuffled} shuffled boards finished from a part-played state`);
}

// ---------------------------------------------------------------------------
// Session mechanics
// ---------------------------------------------------------------------------

function checkSessionRules() {
    console.log("Session rules");
    const session = new MahjongSession(1, new NoiseRandom(20260726), { hints: 3, undos: 5, shuffles: 1 });

    // A blocked tile is not tappable.
    const blocked = session.board.tiles.find((tile) => !session.board.isFree(tile));
    if (blocked) {
        const rejected = session.tap(blocked.id, 1_000);
        check(!rejected.ok && rejected.rejected === "not-free", "tapping a blocked tile must be rejected");
    }

    // Collect then match: score, combo and tray all move.
    const [first, second] = session.solution[0];
    const collect = session.tap(first, 1_000);
    check(collect.ok && collect.collected === first, "the first tap should land in the tray");
    check(session.tray.length === 1, `tray should hold 1 tile, holds ${session.tray.length}`);
    check(session.score === 0, "collecting a tile must not score");

    const match = session.tap(second, 1_400);
    check(match.ok && match.matched !== undefined, "tapping the partner should match");
    check(session.tray.length === 0, "a match must empty both tray slots");
    check(session.score > 0, "a match must score");
    check(session.combo === 1, `first match should be combo 1, got ${session.combo}`);

    // Combo carries inside the window and resets outside it.
    const [c, d] = session.solution[1];
    session.tap(c, 2_000);
    session.tap(d, 2_400);
    check(session.combo === 2, `a match inside the window should chain to 2, got ${session.combo}`);
    const [e, f] = session.solution[2];
    session.tap(e, 40_000);
    session.tap(f, 40_400);
    check(session.combo === 1, `a match after the window should reset to 1, got ${session.combo}`);

    // Undo unwinds a match exactly.
    const scoreBefore = session.score;
    const undone = session.undo();
    check(undone.ok, "undo should unwind the last match");
    check(session.score < scoreBefore, "undo must take the points back");
    check(session.tray.length === 1, `undo of a match should re-hold one tile, holds ${session.tray.length}`);
    check(session.board.tiles[f].onBoard, "undo must put the tapped tile back on the board");
    check(!session.board.tiles[e].onBoard, "the tray tile must stay off the board after undo");

    // Undo of a collect empties the tray again.
    check(session.undo().ok, "undo should unwind the collect too");
    check(session.tray.length === 0, "undo of a collect must empty the tray");
    check(session.board.tiles[e].onBoard, "undo of a collect must return the tile to the board");
}

function checkLoseCondition() {
    console.log("Lose condition");
    const session = new MahjongSession(12, new NoiseRandom(777), { hints: 0, undos: 3, shuffles: 0 });
    let clock = 0;
    let guard = 0;
    // Deliberately never match: only ever take a tile whose kind is not held.
    while (session.status === "playing" && guard < 500) {
        guard += 1;
        const candidate = session.board.freeTiles().find((tile) => !session.tray.some((t) => t.kind === tile.kind));
        if (!candidate) break;
        clock += 500;
        session.tap(candidate.id, clock);
    }
    check(session.status === "lost", `refusing every match should lose, ended "${session.status}"`);
    check(
        session.tray.length === session.trayCapacity,
        `a lost board should have a full tray, has ${session.tray.length}`,
    );

    const blocked = session.board.freeTiles().find((tile) => !session.tray.some((t) => t.kind === tile.kind));
    if (blocked) {
        const result = session.tap(blocked.id, clock + 500);
        check(!result.ok, "a finished session must reject further taps");
    }

    // Undo is the way out of a full tray.
    check(session.undo().ok, "undo must work on a lost board");
    check(session.status === "playing", "undo must return a lost board to play");
    check(session.tray.length === session.trayCapacity - 1, "undo must free a tray slot");
}

function checkHints() {
    console.log("Hints");
    let checked = 0;
    for (let level = 1; level <= 12; level += 1) {
        const session = new MahjongSession(level, new NoiseRandom(0x81de_0000 + level), {
            hints: 9,
            undos: 9,
            shuffles: 9,
        });
        let clock = 0;
        // A hint must exist at every point of a real playthrough, and it must
        // be a move the session actually accepts.
        for (let step = 0; step < 12 && session.status === "playing"; step += 1) {
            const hint = session.hint();
            check(hint !== null, `level ${level} step ${step}: no hint on a live board`);
            if (!hint) break;
            clock += 700;
            if (hint.kind === "board-pair") {
                const a = session.tap(hint.tileIds[0], clock);
                const b = session.tap(hint.tileIds[1], clock + 300);
                check(a.ok && b.ok && b.matched !== undefined, `level ${level} step ${step}: board-pair hint illegal`);
            } else {
                const result = session.tap(hint.tileId, clock);
                check(
                    result.ok && result.matched !== undefined,
                    `level ${level} step ${step}: tray hint did not match`,
                );
            }
            checked += 1;
        }
        // With a tile deliberately held, the hint must prefer emptying the tray.
        const spare = session.board.freeTiles().find((tile) => !session.tray.some((t) => t.kind === tile.kind));
        if (spare && session.status === "playing") {
            session.tap(spare.id, clock + 1_000);
            const hint = session.hint();
            if (hint && session.board.freeTiles().some((tile) => tile.kind === spare.kind)) {
                check(hint.kind === "tray-match", `level ${level}: hint ignored a clearable tray tile`);
            }
        }
    }
    console.log(`  ${checked} hints offered and played`);
}

function checkDeterminism() {
    console.log("Determinism");
    const play = () => {
        const session = new MahjongSession(7, new NoiseRandom(4242), { hints: 3, undos: 3, shuffles: 3 });
        let clock = 0;
        for (const [a, b] of session.solution.slice(0, 20)) {
            clock += 600;
            session.tap(a, clock);
            clock += 600;
            session.tap(b, clock);
        }
        session.shuffle();
        return JSON.stringify({
            score: session.score,
            kinds: session.board.tiles.map((tile) => tile.kind),
            solution: session.solution,
        });
    };
    const first = play();
    const second = play();
    check(first === second, "the same seed must produce the same board, score and shuffle");
}

// ---------------------------------------------------------------------------
// Balance sweep
// ---------------------------------------------------------------------------

/**
 * A plausible player: clear the tray when you can, otherwise take a pair that
 * is fully exposed, otherwise gamble on a free tile. It does not look ahead,
 * which is the point — the win rate it produces is a floor, not a ceiling.
 */
function playAsHuman(session, random) {
    let clock = 0;
    let guard = 0;
    while (session.status === "playing" && guard < 2_000) {
        guard += 1;
        clock += 800;

        const clearsTray = session.board
            .freeTiles()
            .find((tile) => session.tray.some((held) => held.kind === tile.kind));
        if (clearsTray) {
            session.tap(clearsTray.id, clock);
            continue;
        }

        const pair = freePairs(session.board)[0];
        if (pair) {
            session.tap(pair[0].id, clock);
            session.tap(pair[1].id, clock + 200);
            continue;
        }

        const free = session.board.freeTiles();
        if (free.length === 0) break;
        session.tap(free[random.int(0, free.length)].id, clock);
    }
    return session;
}

function balanceSweep() {
    const seeds = 60;
    console.log(`\nBalance sweep — ${seeds} seeds per level, unaided player (no hints, undos or shuffles)\n`);
    console.log("  lvl  layout        tiles  kinds  wins   avg score  avg matches");
    const rates = [];
    for (let level = 1; level <= 24; level += 1) {
        const plan = planLevel(level);
        let wins = 0;
        let score = 0;
        let matches = 0;
        for (let seed = 0; seed < seeds; seed += 1) {
            const random = new NoiseRandom(0x11ce_0000 + level * 7919 + seed);
            const session = playAsHuman(new MahjongSession(level, random, { hints: 0, undos: 0, shuffles: 0 }), random);
            if (session.status === "won") wins += 1;
            score += session.score;
            matches += session.matches;
        }
        const rate = wins / seeds;
        rates.push({ level, rate });
        console.log(
            `  ${String(level).padStart(3)}  ${plan.layout.id.padEnd(12)} ` +
                `${String(plan.layout.slots.length).padStart(5)}  ${String(plan.distinctKinds).padStart(5)}  ` +
                `${(rate * 100).toFixed(0).padStart(4)}%  ${String(Math.round(score / seeds)).padStart(9)}  ` +
                `${(matches / seeds).toFixed(1).padStart(11)}`,
        );
    }

    // The ladder has to stay a ladder. These bounds are the design intent, not
    // a description of the current numbers: this is a relaxing puzzle game, so
    // even the late boards stay winnable, and the decline has to be real rather
    // than noise. The player also has hints, undos and shuffles, none of which
    // this sweep uses — every figure here is a floor.
    const mean = (entries) => entries.reduce((sum, entry) => sum + entry.rate, 0) / entries.length;
    const early = mean(rates.slice(0, 4));
    const late = mean(rates.slice(-6));
    const worst = rates.reduce((low, entry) => (entry.rate < low.rate ? entry : low));
    console.log("");
    check(early >= 0.9, `levels 1-4 win ${(early * 100).toFixed(0)}% unaided; the opening must be welcoming (>=90%)`);
    check(
        late <= early - 0.05,
        `late levels (${(late * 100).toFixed(0)}%) are no harder than the opening (${(early * 100).toFixed(0)}%)`,
    );
    check(late >= 0.5, `late levels win only ${(late * 100).toFixed(0)}% unaided; that is punishing even with tools`);
    check(
        worst.rate >= 0.35,
        `level ${worst.level} wins ${(worst.rate * 100).toFixed(0)}% unaided — a wall, not a difficulty step`,
    );
}

// ---------------------------------------------------------------------------

const sweep = process.argv.includes("--sweep");

checkTileSet();
checkLayouts();
checkFreeRule();
checkSolvability(sweep ? 24 : 14, sweep ? 6 : 3);
checkShuffleSolvability(sweep ? 40 : 16);
checkSessionRules();
checkLoseCondition();
checkHints();
checkDeterminism();
if (sweep) balanceSweep();

if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
}
console.log("\nAll simulation checks passed.");
