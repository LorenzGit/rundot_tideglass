import { getRunCapabilities } from "../sdk/runSdk.ts";
import { hasServerTime, localDayKey, serverNow } from "./serverTime.ts";
import { store } from "../state/store.ts";
import { saveSystem } from "./save.ts";
import { runtimeServices } from "./runtimeServices.ts";

import { returnReminders } from "./retention/retentionConfig.ts";
/**
 * Seven days of pearls. The curve rewards the return rather than the first
 * claim — day seven is worth more than days one to four together, which is the
 * whole point of a streak.
 */
const REWARDS = [40, 60, 90, 130, 180, 260, 420] as const;
const inFlight = new Set<string>();

export interface TimeGate {
    ready: boolean;
    authoritative: boolean;
    day: string | null;
    label: string;
}

/** The three daily tasks. Ids are persisted, so renaming one resets progress. */
export type QuestId = "matches" | "levels" | "combos";

export interface QuestView {
    id: string;
    label: string;
    value: number;
    target: number;
    reward: number;
    claimed: boolean;
    claimable: boolean;
}

function gate(): TimeGate {
    const capabilities = getRunCapabilities();
    // The SDK's browser mock is useful for exercising API shapes, but its
    // clock is not authoritative. Treat it like local development so preview
    // claims remain usable and are labelled non-authoritative.
    const host = capabilities.host && !capabilities.mock;
    if (host && !hasServerTime())
        return { ready: false, authoritative: true, day: null, label: "WAITING FOR TRUSTED RUN TIME" };
    return {
        ready: true,
        authoritative: host,
        day: localDayKey(serverNow()),
        label: host ? "TRUSTED RUN TIME" : "LOCAL DEV FALLBACK · NON-AUTHORITATIVE",
    };
}

function previousDay(day: string): string {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
}

function ensureQuestDay(day: string): void {
    const state = store.get();
    if (state.dailyQuestDay === day) return;
    store.patch({ dailyQuestDay: day, dailyQuestProgress: {} });
    void saveSystem.flush();
}

async function commitGrant(id: string, pearls: number, patch: Parameters<typeof store.patch>[0]): Promise<boolean> {
    if (inFlight.has(id)) return false;
    inFlight.add(id);
    const before = store.get();
    store.patch({ ...patch, pearls: before.pearls + pearls });
    const saved = await saveSystem.flush();
    if (!saved) {
        // A grant that could not be persisted is rolled back rather than
        // left in memory, or a reload would silently take it away again.
        store.patch({
            pearls: before.pearls,
            dailyRewardLastClaimDay: before.dailyRewardLastClaimDay,
            dailyRewardStreak: before.dailyRewardStreak,
            dailyRewardClaimIds: before.dailyRewardClaimIds,
            dailyQuestClaimIds: before.dailyQuestClaimIds,
        });
    }
    inFlight.delete(id);
    return saved;
}

export const dailySystems = {
    timeGate(): TimeGate {
        return gate();
    },

    rewardView() {
        const time = gate();
        const state = store.get();
        if (!time.ready || !time.day)
            return { ...time, claimed: false, streak: state.dailyRewardStreak, reward: REWARDS[0] };
        const claimId = `daily-reward:${time.day}`;
        const claimed = state.dailyRewardClaimIds.includes(claimId);
        const nextStreak = state.dailyRewardLastClaimDay === previousDay(time.day) ? state.dailyRewardStreak + 1 : 1;
        const rewardIndex = (Math.max(1, nextStreak) - 1) % REWARDS.length;
        return {
            ...time,
            claimed,
            streak: claimed ? state.dailyRewardStreak : nextStreak,
            reward: REWARDS[rewardIndex] ?? REWARDS[0],
        };
    },

    async claimDailyReward(): Promise<{ ok: boolean; reason: string; pearls: number }> {
        const view = this.rewardView();
        if (!runtimeServices.config.dailyRewardsEnabled) return { ok: false, reason: "DISABLED BY LIVEOPS", pearls: 0 };
        if (!view.ready || !view.day) return { ok: false, reason: view.label, pearls: 0 };
        const claimId = `daily-reward:${view.day}`;
        if (view.claimed || store.get().dailyRewardClaimIds.includes(claimId))
            return { ok: false, reason: "ALREADY CLAIMED", pearls: 0 };
        const state = store.get();
        const ok = await commitGrant(claimId, view.reward, {
            dailyRewardLastClaimDay: view.day,
            dailyRewardStreak: view.streak,
            dailyRewardClaimIds: [...state.dailyRewardClaimIds, claimId].slice(-90),
        });
        if (ok)
            runtimeServices.track("daily_reward_claimed", {
                streak: view.streak,
                pearls: view.reward,
                authoritative: view.authoritative,
            });
        // Kill switch: the 24h reminder promises this reward. Leaving it scheduled
        // pings the player about something they just claimed, which is exactly how
        // a useful notification becomes a muted one.
        void returnReminders.cancel("d1");
        return { ok, reason: ok ? "CLAIMED" : "SAVE FAILED", pearls: ok ? view.reward : 0 };
    },

    recordProgress(id: QuestId, amount = 1): void {
        const time = gate();
        if (!time.ready || !time.day || !runtimeServices.config.dailyQuestsEnabled) return;
        ensureQuestDay(time.day);
        const state = store.get();
        // The combo task tracks a HIGH-WATER mark, not a total: "reach a 5
        // combo" must not be satisfiable by five separate 1-combos.
        const previous = state.dailyQuestProgress[id] ?? 0;
        const next = id === "combos" ? Math.max(previous, amount) : previous + amount;
        const progress = { ...state.dailyQuestProgress, [id]: Math.max(0, next) };
        store.patch({ dailyQuestProgress: progress });
        void saveSystem.flush();
    },

    quests(): QuestView[] {
        const time = gate();
        const state = store.get();
        const definitions: Array<{ id: QuestId; label: string; target: number; reward: number }> = [
            { id: "matches", label: "MATCH 30 PAIRS", target: 30, reward: 45 },
            { id: "levels", label: "CLEAR 2 LEVELS", target: 2, reward: 80 },
            { id: "combos", label: "REACH A 5 COMBO", target: 5, reward: 120 },
        ];
        return definitions.map((quest) => {
            const claimId = `daily-quest:${time.day ?? "untrusted"}:${quest.id}`;
            const value = state.dailyQuestProgress[quest.id] ?? 0;
            const claimed = state.dailyQuestClaimIds.includes(claimId);
            return { ...quest, value, claimed, claimable: time.ready && !claimed && value >= quest.target };
        });
    },

    async claimQuest(questId: string): Promise<{ ok: boolean; reason: string; pearls: number }> {
        const time = gate();
        if (!runtimeServices.config.dailyQuestsEnabled) return { ok: false, reason: "DISABLED BY LIVEOPS", pearls: 0 };
        if (!time.ready || !time.day) return { ok: false, reason: time.label, pearls: 0 };
        const quest = this.quests().find((entry) => entry.id === questId);
        if (!quest || !quest.claimable)
            return { ok: false, reason: quest?.claimed ? "ALREADY CLAIMED" : "NOT COMPLETE", pearls: 0 };
        const claimId = `daily-quest:${time.day}:${quest.id}`;
        const state = store.get();
        const ok = await commitGrant(claimId, quest.reward, {
            dailyQuestClaimIds: [...state.dailyQuestClaimIds, claimId].slice(-180),
        });
        if (ok)
            runtimeServices.track("daily_quest_claimed", {
                quest_id: quest.id,
                pearls: quest.reward,
                authoritative: time.authoritative,
            });
        return { ok, reason: ok ? "CLAIMED" : "SAVE FAILED", pearls: ok ? quest.reward : 0 };
    },
};
