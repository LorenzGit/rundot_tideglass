/**
 * Global UI state.
 *
 * One direction only: the game controller writes, React reads. No React state
 * flows into the Pixi scene and nothing here is updated per frame — the board
 * publishes on events (a match, a tool spend, a level end), not on ticks.
 */
import { useSyncExternalStore } from "react";
import { TRAY_CAPACITY_MAX } from "../game/mahjong/levels.ts";

export type MenuScreen = "main" | "daily-rewards" | "daily-quests" | "shop" | "stats" | "settings";

/** Modals stacked over the board. Only one at a time. */
export type Overlay = "none" | "won" | "lost" | "paused" | "howto" | "settings" | "shop";

export interface LevelResult {
    level: number;
    score: number;
    timeMs: number;
    bestCombo: number;
    matches: number;
    timeBonus: number;
    toolBonus: number;
    pearlsEarned: number;
    /** True when the board was cleared, false when the tray filled. */
    cleared: boolean;
    /** Set once, when this run beats the stored best for the level. */
    newBest: boolean;
}

export interface ToolCounts {
    hints: number;
    undos: number;
    shuffles: number;
}

export interface AppState {
    phase: "loading" | "menu" | "playing";
    loadProgress: number;
    paused: boolean;
    menuScreen: MenuScreen;
    overlay: Overlay;

    /** --- progression, persisted --- */
    level: number;
    highestLevel: number;
    pearls: number;
    totalPlays: number;
    levelsCleared: number;
    bestScore: number;
    tools: ToolCounts;

    /** --- live session, not persisted --- */
    score: number;
    combo: number;
    tilesRemaining: number;
    tilesTotal: number;
    trayCount: number;
    trayCapacity: number;
    shuffleUnlocked: boolean;
    sessionStatus: "playing" | "won" | "lost";
    elapsedMs: number;
    lastResult: LevelResult | null;

    /** --- settings, persisted --- */
    musicEnabled: boolean;
    musicVolume: number;
    sfxEnabled: boolean;
    sfxVolume: number;
    notificationsEnabled: boolean;
    notificationsConsent: "unknown" | "granted" | "denied";
    hapticsEnabled: boolean;
    reducedMotion: boolean;
    locale: string;
    quality: "high" | "low";

    toast: string | null;

    /** --- retention --- */
    dailyRewardLastClaimDay: string | null;
    dailyRewardStreak: number;
    dailyRewardClaimIds: string[];
    dailyQuestDay: string | null;
    dailyQuestProgress: Record<string, number>;
    dailyQuestClaimIds: string[];

    /** --- cosmetics --- */
    /** Finishes bought with pearls. Entitlement finishes are NEVER listed here. */
    ownedFinishes: string[];
    selectedFinish: string;

    /** --- monetization --- */
    /**
     * A checkout that was opened but whose outcome is not yet known. Persisted,
     * because the host's checkout can outlive the page: on the next boot this is
     * reconciled against order history rather than assumed failed.
     */
    pendingPurchaseIntent: {
        productId: string;
        catalogItemId: string;
        idempotencyKey: string;
        startedAt: number;
    } | null;
    runtimeReady: boolean;
    runtimeConfigVersion: string | null;
    trustedTimeReady: boolean;
}

const listeners = new Set<() => void>();

let state: AppState = {
    phase: "loading",
    loadProgress: 0,
    paused: false,
    menuScreen: "main",
    overlay: "none",

    level: 1,
    highestLevel: 1,
    pearls: 0,
    totalPlays: 0,
    levelsCleared: 0,
    bestScore: 0,
    tools: { hints: 3, undos: 3, shuffles: 1 },

    score: 0,
    combo: 0,
    tilesRemaining: 0,
    tilesTotal: 0,
    trayCount: 0,
    trayCapacity: TRAY_CAPACITY_MAX,
    shuffleUnlocked: false,
    sessionStatus: "playing",
    elapsedMs: 0,
    lastResult: null,

    musicEnabled: true,
    // The streamed track is mixed to sit UNDER the game: 20% is the shipped
    // level, and the settings slider moves from there.
    musicVolume: 0.2,
    sfxEnabled: true,
    sfxVolume: 0.7,
    notificationsEnabled: false,
    notificationsConsent: "unknown",
    hapticsEnabled: true,
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    locale: "English",
    quality: "high",

    toast: null,

    dailyRewardLastClaimDay: null,
    dailyRewardStreak: 0,
    dailyRewardClaimIds: [],
    dailyQuestDay: null,
    dailyQuestProgress: {},
    dailyQuestClaimIds: [],

    ownedFinishes: [],
    selectedFinish: "vitreum",

    pendingPurchaseIntent: null,
    runtimeReady: false,
    runtimeConfigVersion: null,
    trustedTimeReady: false,
};

export const store = {
    get(): AppState {
        return state;
    },

    patch(partial: Partial<AppState>): void {
        state = { ...state, ...partial };
        for (const l of listeners) l();
    },

    subscribe(l: () => void): () => void {
        listeners.add(l);
        return () => listeners.delete(l);
    },
};

export function useStore<T = AppState>(selector: (s: AppState) => T = (s) => s as unknown as T): T {
    return useSyncExternalStore(store.subscribe, () => selector(state));
}
