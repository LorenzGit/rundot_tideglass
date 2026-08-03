/**
 * Versioned save. RUN app storage when the host offers it, localStorage
 * otherwise, and the game is fully playable either way.
 *
 * Everything read back is re-validated rather than trusted: a save is player-
 * adjacent data, and a hand-edited one must degrade to sane defaults instead of
 * putting the game into a state no code path expects. Note especially that
 * ENTITLEMENTS ARE NEVER SAVED — ownership is only ever asserted from a live
 * entitlement read, so a copied save cannot grant paid content.
 */
import { getRunCapabilities, readAppStorage, writeAppStorage } from "../sdk/runSdk.ts";
import { FINISH_IDS } from "../game/art/finishes.ts";
import { store, type AppState } from "../state/store.ts";

const SAVE_KEY = "tideglass-save";
export const SAVE_VERSION = 1;

export interface GameSaveV1 {
    version: 1;
    settings: Pick<
        AppState,
        | "musicEnabled"
        | "musicVolume"
        | "sfxEnabled"
        | "sfxVolume"
        | "notificationsEnabled"
        | "notificationsConsent"
        | "hapticsEnabled"
        | "reducedMotion"
        | "locale"
        | "quality"
    >;
    progress: Pick<AppState, "level" | "highestLevel" | "pearls" | "totalPlays" | "levelsCleared" | "bestScore"> & {
        tools: AppState["tools"];
    };
    cosmetics: Pick<AppState, "ownedFinishes" | "selectedFinish">;
    retention: Pick<
        AppState,
        | "dailyRewardLastClaimDay"
        | "dailyRewardStreak"
        | "dailyRewardClaimIds"
        | "dailyQuestDay"
        | "dailyQuestProgress"
        | "dailyQuestClaimIds"
    >;
    commerce: Pick<AppState, "pendingPurchaseIntent">;
}

export type SaveSource = "run" | "local" | "defaults";

function clamp01(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(number))) : fallback;
}

function dayKeyOrNull(value: unknown): string | null {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function recentStrings(value: unknown, limit: number): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === "string" && entry.length <= 160).slice(-limit);
}

function snapshot(): GameSaveV1 {
    const state = store.get();
    return {
        version: SAVE_VERSION,
        settings: {
            musicEnabled: state.musicEnabled,
            musicVolume: state.musicVolume,
            sfxEnabled: state.sfxEnabled,
            sfxVolume: state.sfxVolume,
            notificationsEnabled: state.notificationsEnabled,
            notificationsConsent: state.notificationsConsent,
            hapticsEnabled: state.hapticsEnabled,
            reducedMotion: state.reducedMotion,
            locale: state.locale,
            quality: state.quality,
        },
        progress: {
            level: state.level,
            highestLevel: state.highestLevel,
            pearls: state.pearls,
            totalPlays: state.totalPlays,
            levelsCleared: state.levelsCleared,
            bestScore: state.bestScore,
            tools: state.tools,
        },
        cosmetics: {
            ownedFinishes: state.ownedFinishes,
            selectedFinish: state.selectedFinish,
        },
        retention: {
            dailyRewardLastClaimDay: state.dailyRewardLastClaimDay,
            dailyRewardStreak: state.dailyRewardStreak,
            dailyRewardClaimIds: state.dailyRewardClaimIds,
            dailyQuestDay: state.dailyQuestDay,
            dailyQuestProgress: state.dailyQuestProgress,
            dailyQuestClaimIds: state.dailyQuestClaimIds,
        },
        commerce: { pendingPurchaseIntent: state.pendingPurchaseIntent },
    };
}

function migrate(raw: unknown): GameSaveV1 | null {
    if (!raw || typeof raw !== "object") return null;
    const candidate = raw as Partial<GameSaveV1> & { version?: number };
    if (candidate.version !== SAVE_VERSION || !candidate.settings || !candidate.progress) return null;
    const defaults = snapshot();
    const progress = candidate.progress;
    const cosmetics = candidate.cosmetics ?? defaults.cosmetics;
    const retention = candidate.retention ?? defaults.retention;
    const pending = candidate.commerce?.pendingPurchaseIntent ?? null;

    const highestLevel = Math.max(1, nonNegativeInteger(progress.highestLevel, 1));

    return {
        version: SAVE_VERSION,
        settings: {
            musicEnabled: booleanOr(candidate.settings.musicEnabled, defaults.settings.musicEnabled),
            musicVolume: clamp01(candidate.settings.musicVolume, defaults.settings.musicVolume),
            sfxEnabled: booleanOr(candidate.settings.sfxEnabled, defaults.settings.sfxEnabled),
            sfxVolume: clamp01(candidate.settings.sfxVolume, defaults.settings.sfxVolume),
            hapticsEnabled: booleanOr(candidate.settings.hapticsEnabled, defaults.settings.hapticsEnabled),
            reducedMotion: booleanOr(candidate.settings.reducedMotion, defaults.settings.reducedMotion),
            locale: enumOr(
                candidate.settings.locale,
                ["English", "PortugueseBR", "SpanishLA"] as const,
                defaults.settings.locale,
            ),
            quality: enumOr(candidate.settings.quality, ["high", "low"] as const, defaults.settings.quality),
            notificationsConsent: enumOr(
                candidate.settings.notificationsConsent,
                ["unknown", "granted", "denied"] as const,
                defaults.settings.notificationsConsent,
            ),
            // Notifications stay off unless consent was actually granted, so a
            // save cannot re-enable them behind a player who said no.
            notificationsEnabled:
                candidate.settings.notificationsConsent === "granted" &&
                candidate.settings.notificationsEnabled === true,
        },
        progress: {
            // The current level can never exceed the furthest reached, which is
            // what stops an edited save from skipping the ladder.
            level: Math.min(highestLevel, Math.max(1, nonNegativeInteger(progress.level, 1))),
            highestLevel,
            pearls: nonNegativeInteger(progress.pearls),
            totalPlays: nonNegativeInteger(progress.totalPlays),
            levelsCleared: nonNegativeInteger(progress.levelsCleared),
            bestScore: nonNegativeInteger(progress.bestScore),
            tools: {
                hints: Math.min(99, nonNegativeInteger(progress.tools?.hints, 2)),
                undos: Math.min(99, nonNegativeInteger(progress.tools?.undos, 3)),
                shuffles: Math.min(99, nonNegativeInteger(progress.tools?.shuffles, 1)),
            },
        },
        cosmetics: {
            // Only pearl-bought finishes live in the save; Abyssal is an
            // entitlement and is filtered out even if someone writes it here.
            ownedFinishes: recentStrings(cosmetics.ownedFinishes, 16).filter((id) => id === "amber"),
            selectedFinish: enumOr(cosmetics.selectedFinish, FINISH_IDS, "vitreum"),
        },
        retention: {
            dailyRewardLastClaimDay: dayKeyOrNull(retention.dailyRewardLastClaimDay),
            dailyRewardStreak: nonNegativeInteger(retention.dailyRewardStreak),
            dailyRewardClaimIds: recentStrings(retention.dailyRewardClaimIds, 90),
            dailyQuestDay: dayKeyOrNull(retention.dailyQuestDay),
            dailyQuestProgress:
                retention.dailyQuestProgress && typeof retention.dailyQuestProgress === "object"
                    ? Object.fromEntries(
                          Object.entries(retention.dailyQuestProgress)
                              .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
                              .slice(0, 12)
                              .map(([key, value]) => [key.slice(0, 40), nonNegativeInteger(value)]),
                      )
                    : {},
            dailyQuestClaimIds: recentStrings(retention.dailyQuestClaimIds, 180),
        },
        commerce: {
            pendingPurchaseIntent:
                pending &&
                typeof pending.productId === "string" &&
                typeof pending.catalogItemId === "string" &&
                typeof pending.idempotencyKey === "string"
                    ? {
                          productId: pending.productId.slice(0, 80),
                          catalogItemId: pending.catalogItemId.slice(0, 80),
                          idempotencyKey: pending.idempotencyKey.slice(0, 120),
                          startedAt: nonNegativeInteger(pending.startedAt),
                      }
                    : null,
        },
    };
}

function parse(raw: string | null): GameSaveV1 | null {
    if (!raw) return null;
    try {
        return migrate(JSON.parse(raw));
    } catch {
        return null;
    }
}

function apply(save: GameSaveV1): void {
    store.patch({
        ...save.settings,
        ...save.progress,
        ...save.cosmetics,
        ...save.retention,
        ...save.commerce,
    });
}

let lastSaved = "";
let pendingSave: string | null = null;
let flushInFlight: Promise<boolean> | null = null;

function usesRunStorage(): boolean {
    const capabilities = getRunCapabilities();
    return capabilities.host && !capabilities.mock;
}

async function persist(serialized: string): Promise<boolean> {
    if (usesRunStorage()) return writeAppStorage(SAVE_KEY, serialized);
    try {
        window.localStorage.setItem(SAVE_KEY, serialized);
        return true;
    } catch (error) {
        console.warn("[save] local fallback write failed", error);
        return false;
    }
}

export const saveSystem = {
    async load(): Promise<SaveSource> {
        if (!usesRunStorage()) {
            let stored: string | null = null;
            try {
                stored = window.localStorage.getItem(SAVE_KEY);
            } catch (error) {
                console.warn("[save] local fallback read failed", error);
            }
            const save = parse(stored);
            if (save) apply(save);
            lastSaved = JSON.stringify(snapshot());
            return save ? "local" : "defaults";
        }

        const remote = await readAppStorage(SAVE_KEY);
        const save = remote.ok ? parse(remote.value) : null;
        if (save) apply(save);
        lastSaved = JSON.stringify(snapshot());
        return save ? "run" : "defaults";
    },

    async flush(): Promise<boolean> {
        const serialized = JSON.stringify(snapshot());
        if (serialized === lastSaved && pendingSave === null) return true;
        pendingSave = serialized;
        if (flushInFlight) return flushInFlight;

        // Remote writes are serialized and rapid changes coalesced, so an older
        // slower RPC can never land after and overwrite a newer one.
        flushInFlight = (async () => {
            let allSucceeded = true;
            while (pendingSave !== null) {
                const next = pendingSave;
                pendingSave = null;
                if (next === lastSaved) continue;
                const saved = await persist(next);
                if (saved) lastSaved = next;
                else allSucceeded = false;
            }
            return allSucceeded;
        })().finally(() => {
            flushInFlight = null;
        });
        return flushInFlight;
    },
};
