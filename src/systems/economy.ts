/**
 * Pearls: the only currency, earned only by playing.
 *
 * Pearls buy tools and the Amber finish. They are NOT sold — the Run Bits
 * products are a permanent tool stipend and a permanent ad-free state, never a
 * bag of currency — so this file is the whole faucet and the whole sink, and
 * the balance between them can be read in one screen.
 */
import type { MahjongSession } from "../game/mahjong/session.ts";

/** Cleared a level: the base payout, before bonuses. */
const CLEAR_BASE = 45;
/** Each level deeper pays a little more, so later boards stay worth playing. */
const CLEAR_PER_LEVEL = 6;
/** A lost board still pays something for the matches that did land. */
const CONSOLATION_PER_MATCH = 2;

/** Tool prices, in pearls. */
export const TOOL_PRICES = {
    hints: 60,
    undos: 45,
    shuffles: 120,
} as const;

export type ToolId = keyof typeof TOOL_PRICES;

/** The Amber finish, the one cosmetic a non-payer can reach. */
export const AMBER_FINISH_COST = 2_400;

/** Tools every level starts with, before any Lantern Kit stipend. */
export const BASE_LEVEL_TOOLS = { hints: 2, undos: 3, shuffles: 1 } as const;

export interface Payout {
    /** Points the board itself scored. */
    boardScore: number;
    timeBonus: number;
    toolBonus: number;
    /** Score plus both bonuses. */
    totalScore: number;
    pearls: number;
}

/**
 * What a finished level is worth. Bonuses reward finishing quickly and
 * finishing WITHOUT spending tools, which is what keeps the tools meaningful:
 * a player who hoards them is paid for it, so spending one is a real decision
 * rather than a free button.
 */
export function computePayout(session: MahjongSession, cleared: boolean): Payout {
    const boardScore = session.score;
    if (!cleared) {
        return {
            boardScore,
            timeBonus: 0,
            toolBonus: 0,
            totalScore: boardScore,
            pearls: session.matches * CONSOLATION_PER_MATCH,
        };
    }

    const bonus = session.completionBonus();
    const totalScore = boardScore + bonus.total;
    const pearls = Math.round(
        CLEAR_BASE + CLEAR_PER_LEVEL * session.plan.level + totalScore / 400 + session.bestCombo * 3,
    );
    return {
        boardScore,
        timeBonus: bonus.timeBonus,
        toolBonus: bonus.toolBonus,
        totalScore,
        pearls,
    };
}

/** Format a duration as m:ss for the results screen. */
export function formatDuration(milliseconds: number): string {
    const total = Math.max(0, Math.round(milliseconds / 1_000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
