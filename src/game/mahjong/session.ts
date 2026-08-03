/**
 * One level, played. Renderer-free and clock-free: every method that cares
 * about time takes `nowMs` from the caller, so the simulation can play a
 * thousand levels instantly and the scene can pass `performance.now()`.
 *
 * The loop: tap a free tile and it flies to the tray. If the tray already
 * holds that kind the two annihilate and score. Fill all seven tray slots
 * without a match and the level is lost.
 */
import { Board, freePairs, type Tile } from "./board.ts";
import { dealSolvableBoard, reshuffleRemaining } from "./generator.ts";
import { planLevel, type LevelPlan } from "./levels.ts";
import type { NoiseRandom } from "../noiseRandom.ts";
import type { TileKind } from "./tiles.ts";

/** Points for a match before the combo multiplier. */
export const MATCH_BASE_POINTS = 120;
/** Each extra combo step adds this much. */
export const COMBO_STEP_POINTS = 40;
/** Combo stops growing here so a long clean run cannot run away with the score. */
export const MAX_COMBO = 12;
/** Match again inside this window and the combo carries. */
export const COMBO_WINDOW_MS = 4_000;
/** Combo at which the scene shouts "PERFECT". */
export const PERFECT_COMBO = 3;

export type SessionStatus = "playing" | "won" | "lost";

export interface MatchInfo {
    kind: TileKind;
    /** [tile taken from the tray, tile just tapped]. */
    tileIds: [number, number];
    points: number;
    combo: number;
    perfect: boolean;
}

export interface TapResult {
    ok: boolean;
    /** Why the tap did nothing. Present only when `ok` is false. */
    rejected?: "not-free" | "unknown-tile" | "tray-full" | "finished";
    /** The tile that moved to the tray, when no match followed. */
    collected?: number;
    matched?: MatchInfo;
    status: SessionStatus;
}

export interface UndoResult {
    ok: boolean;
    /** Tile returned from the tray to the board. */
    returnedToBoard?: number;
    /** Tile pushed back into the tray, when the undone tap was a match. */
    returnedToTray?: number;
}

/** A move the player could make right now. */
export type Hint =
    | { kind: "board-pair"; tileIds: [number, number] }
    | { kind: "tray-match"; tileId: number; trayTileId: number };

type HistoryEntry =
    | { type: "collect"; tileId: number }
    | {
          type: "match";
          tappedId: number;
          trayId: number;
          points: number;
          comboBefore: number;
          lastMatchAtBefore: number;
      };

export interface SessionTools {
    hints: number;
    undos: number;
    shuffles: number;
}

export class MahjongSession {
    readonly plan: LevelPlan;
    readonly board: Board;
    /** Tiles held, kept sorted by kind so the row reads tidily. */
    readonly tray: Tile[] = [];

    status: SessionStatus = "playing";
    score = 0;
    combo = 0;
    /** Highest combo reached — shown on the results screen. */
    bestCombo = 0;
    matches = 0;
    /** Milliseconds of play, accumulated by `tick`. */
    elapsedMs = 0;
    tools: SessionTools;

    /**
     * A known winning line for the CURRENT board, as tile-id pairs. Kept only
     * so `npm run simulate` can prove every dealt and every shuffled board is
     * finishable; gameplay never reads it, and the hint tool deliberately
     * recomputes from board state instead of leaking this.
     */
    solution: Array<[number, number]>;
    /** Tiles that clear a tray slot, tapped before `solution`. Shuffle only. */
    solutionSingles: number[] = [];

    private lastMatchAt = Number.NEGATIVE_INFINITY;
    private readonly history: HistoryEntry[] = [];
    private readonly random: NoiseRandom;

    constructor(level: number, random: NoiseRandom, tools: SessionTools) {
        this.plan = planLevel(level);
        this.random = random;
        this.tools = { ...tools };
        const deal = dealSolvableBoard(this.plan.layout.slots, random, {
            distinctKinds: this.plan.distinctKinds,
        });
        this.board = new Board(this.plan.layout, deal.kinds);
        this.solution = deal.solution;
    }

    get trayCapacity(): number {
        return this.plan.trayCapacity;
    }

    get trayFull(): boolean {
        return this.tray.length >= this.plan.trayCapacity;
    }

    get tilesRemaining(): number {
        return this.board.remaining;
    }

    /** Advance the play clock. The scene calls this only while unpaused. */
    tick(deltaMs: number): void {
        if (this.status !== "playing") return;
        this.elapsedMs += Math.max(0, deltaMs);
    }

    tileById(id: number): Tile | undefined {
        return this.board.tiles[id];
    }

    tap(tileId: number, nowMs: number): TapResult {
        if (this.status !== "playing") return { ok: false, rejected: "finished", status: this.status };
        const tile = this.board.tiles[tileId];
        if (!tile) return { ok: false, rejected: "unknown-tile", status: this.status };
        if (!this.board.isFree(tile)) return { ok: false, rejected: "not-free", status: this.status };

        const partnerAt = this.tray.findIndex((held) => held.kind === tile.kind);
        if (partnerAt === -1 && this.trayFull) {
            return { ok: false, rejected: "tray-full", status: this.status };
        }

        this.board.lift(tile);

        if (partnerAt === -1) {
            this.insertIntoTray(tile);
            this.history.push({ type: "collect", tileId });
            // The tray filling up with no match left is the only way to lose.
            if (this.trayFull) this.status = "lost";
            return { ok: true, collected: tileId, status: this.status };
        }

        const partner = this.tray[partnerAt];
        if (!partner) return { ok: false, rejected: "unknown-tile", status: this.status };
        this.tray.splice(partnerAt, 1);

        const comboBefore = this.combo;
        const lastMatchAtBefore = this.lastMatchAt;
        this.combo = nowMs - this.lastMatchAt <= COMBO_WINDOW_MS ? Math.min(MAX_COMBO, this.combo + 1) : 1;
        this.lastMatchAt = nowMs;
        this.bestCombo = Math.max(this.bestCombo, this.combo);

        const points = MATCH_BASE_POINTS + COMBO_STEP_POINTS * (this.combo - 1);
        this.score += points;
        this.matches += 1;
        this.history.push({
            type: "match",
            tappedId: tileId,
            trayId: partner.id,
            points,
            comboBefore,
            lastMatchAtBefore,
        });

        if (this.board.remaining === 0 && this.tray.length === 0) this.status = "won";

        return {
            ok: true,
            matched: {
                kind: tile.kind,
                tileIds: [partner.id, tileId],
                points,
                combo: this.combo,
                perfect: this.combo >= PERFECT_COMBO,
            },
            status: this.status,
        };
    }

    /**
     * Step one tap backwards. Undo is also the escape hatch from a lost board,
     * so it deliberately works after the tray has filled.
     */
    undo(): UndoResult {
        if (this.status === "won") return { ok: false };
        const entry = this.history.pop();
        if (!entry) return { ok: false };
        this.status = "playing";

        if (entry.type === "collect") {
            const tile = this.board.tiles[entry.tileId];
            if (!tile) return { ok: false };
            const at = this.tray.indexOf(tile);
            if (at !== -1) this.tray.splice(at, 1);
            this.board.restore(tile);
            return { ok: true, returnedToBoard: entry.tileId };
        }

        const tapped = this.board.tiles[entry.tappedId];
        const held = this.board.tiles[entry.trayId];
        if (!tapped || !held) return { ok: false };
        this.board.restore(tapped);
        this.insertIntoTray(held);
        this.score = Math.max(0, this.score - entry.points);
        this.combo = entry.comboBefore;
        this.lastMatchAt = entry.lastMatchAtBefore;
        this.matches = Math.max(0, this.matches - 1);
        return { ok: true, returnedToBoard: entry.tappedId, returnedToTray: entry.trayId };
    }

    /**
     * Re-deal the tiles still on the board. The remaining multiset is held
     * fixed and the tray's partners are placed first, so a shuffle always
     * hands back a board that can still be finished.
     */
    shuffle(): boolean {
        if (this.status === "won") return false;
        const live = this.board.tiles.filter((tile) => tile.onBoard);
        if (live.length === 0) return false;
        const result = reshuffleRemaining(
            live.map((tile) => tile.slot),
            live.map((tile) => tile.kind),
            this.tray.map((tile) => tile.kind),
            this.random,
        );
        if (!result) return false;
        this.board.reassign(result.kinds);
        // Re-express the fresh winning line in tile ids, since `live` indices
        // are meaningless to anything outside this call.
        const idAt = (index: number): number => live[index]?.id ?? 0;
        this.solutionSingles = result.singles.map(idAt);
        this.solution = result.solution.map(([a, b]) => [idAt(a), idAt(b)] as [number, number]);
        // A shuffle rescues a lost board only in combination with an undo; on
        // its own it just re-arranges what is left.
        if (this.status === "lost" && !this.trayFull) this.status = "playing";
        // Re-arranging the board is not a skilled match, so the chain ends.
        this.combo = 0;
        this.lastMatchAt = Number.NEGATIVE_INFINITY;
        // Undoing across a shuffle would restore tiles whose kinds have moved,
        // so the shuffle closes the history.
        this.history.length = 0;
        return true;
    }

    /** A legal move, preferring one that empties a tray slot. */
    hint(): Hint | null {
        for (const held of this.tray) {
            const match = this.board.tiles.find((tile) => tile.kind === held.kind && this.board.isFree(tile));
            if (match) return { kind: "tray-match", tileId: match.id, trayTileId: held.id };
        }
        const pair = freePairs(this.board)[0];
        if (pair) return { kind: "board-pair", tileIds: [pair[0].id, pair[1].id] };
        return null;
    }

    /**
     * Completion bonus: finishing under par pays, and every unspent tool pays.
     * Called by the results flow once, on a won level.
     */
    completionBonus(): { timeBonus: number; toolBonus: number; total: number } {
        const seconds = this.elapsedMs / 1_000;
        const spare = Math.max(0, this.plan.parSeconds - seconds);
        const timeBonus = Math.round(spare * 12);
        const toolBonus = (this.tools.hints + this.tools.undos + this.tools.shuffles) * 60;
        return { timeBonus, toolBonus, total: timeBonus + toolBonus };
    }

    private insertIntoTray(tile: Tile): void {
        // Sorted by kind so a tile always lands beside its own suit, which is
        // what makes a nearly-full tray readable at a glance.
        let at = this.tray.length;
        for (let index = 0; index < this.tray.length; index += 1) {
            const held = this.tray[index];
            if (held && held.kind > tile.kind) {
                at = index;
                break;
            }
        }
        this.tray.splice(at, 0, tile);
    }
}
