/**
 * Background platform services: LiveOps, trusted time, notification re-arming
 * and analytics.
 *
 * Ads and purchases are deliberately NOT here. `systems/ads.ts` and
 * `systems/commerce.ts` own those, and a second path through this module would
 * be a second set of caps and gates to keep in step with the first.
 */
import packageJson from "../../package.json";
import {
    fetchLiveOps,
    getRunCapabilities,
    rearmLocalNotification,
    recordAnalytics,
    recordFunnelStep,
    triggerHaptic,
    type HapticStyle,
} from "../sdk/runSdk.ts";
import { applyMonetizationLiveOps } from "./monetization/runtime.ts";
import { refreshServerTime } from "./serverTime.ts";
import { store } from "../state/store.ts";
import { t } from "./localization.ts";

export interface RuntimeConfig {
    dailyRewardsEnabled: boolean;
    dailyQuestsEnabled: boolean;
    notificationDelaySeconds: number;
}

const DEFAULTS: Readonly<RuntimeConfig> = Object.freeze({
    dailyRewardsEnabled: true,
    dailyQuestsEnabled: true,
    notificationDelaySeconds: 86_400,
});

const RETURN_REMINDER_ID = "tideglass-return-reminder";

let config: RuntimeConfig = { ...DEFAULTS };
let nextRefreshTimer = 0;

function clearScheduledRefresh(): void {
    if (!nextRefreshTimer) return;
    window.clearTimeout(nextRefreshTimer);
    nextRefreshTimer = 0;
}

function normalize(values: Record<string, unknown>): RuntimeConfig {
    // `rundot/liveops.config.json` namespaces this game's values under
    // `tideglass_runtime`; the bare `runtime` key and the flat root are
    // accepted as fallbacks so a hand-edited config still applies.
    const section = values.tideglass_runtime ?? values.runtime;
    const root = section && typeof section === "object" ? (section as Record<string, unknown>) : values;
    const delay = Number(root.notificationDelaySeconds);
    return {
        dailyRewardsEnabled: typeof root.dailyRewardsEnabled === "boolean" ? root.dailyRewardsEnabled : true,
        dailyQuestsEnabled: typeof root.dailyQuestsEnabled === "boolean" ? root.dailyQuestsEnabled : true,
        notificationDelaySeconds: Number.isFinite(delay) ? Math.max(3_600, Math.min(delay, 604_800)) : 86_400,
    };
}

async function refreshLiveOps(): Promise<void> {
    clearScheduledRefresh();
    const snapshot = await fetchLiveOps();
    if (!snapshot) {
        config = { ...DEFAULTS };
        // No reachable config means monetization stays dark, which is the
        // correct fail-closed default.
        applyMonetizationLiveOps(null);
        store.patch({ runtimeReady: true, runtimeConfigVersion: null });
        return;
    }
    config = normalize(snapshot.values);
    applyMonetizationLiveOps(snapshot.values);
    store.patch({ runtimeReady: true, runtimeConfigVersion: snapshot.configVersion });
    if (snapshot.nextChangeAt) {
        const delay = Math.max(1_000, Math.min(snapshot.nextChangeAt - Date.now() + 500, 2_147_000_000));
        nextRefreshTimer = window.setTimeout(() => startRefreshCycle(), delay);
    }
}

async function refreshTime(): Promise<void> {
    store.patch({ trustedTimeReady: await refreshServerTime() });
}

async function rearmNotifications(): Promise<void> {
    const state = store.get();
    if (!state.notificationsEnabled || state.notificationsConsent !== "granted") return;
    await rearmLocalNotification({
        id: RETURN_REMINDER_ID,
        title: t("NotificationTitle"),
        body: t("NotificationReEngagementBody"),
        delaySeconds: config.notificationDelaySeconds,
    });
}

async function refreshRuntime(): Promise<void> {
    await Promise.allSettled([refreshTime(), refreshLiveOps()]);
    await rearmNotifications();
}

function startRefreshCycle(): void {
    void refreshRuntime().catch((error) => {
        console.warn("[runtime] background refresh failed", error);
    });
}

export const runtimeServices = {
    get config(): Readonly<RuntimeConfig> {
        return config;
    },
    bootstrap(): void {
        startRefreshCycle();
        this.track("game_boot", { version: packageJson.version, host: getRunCapabilities().host });
    },
    resume(): void {
        startRefreshCycle();
    },
    rearmNotifications(): void {
        void rearmNotifications().catch((error) => {
            console.warn("[runtime] notification refresh failed", error);
        });
    },
    track(eventName: string, payload: Record<string, unknown> = {}): void {
        void recordAnalytics(eventName, { ...payload, build_version: packageJson.version });
    },
    funnel(step: number, name: string, funnel: string, funnelOrder = 0): void {
        void recordFunnelStep(step, name, funnel, funnelOrder);
    },
    async haptic(style: HapticStyle): Promise<boolean> {
        return store.get().hapticsEnabled ? triggerHaptic(style) : false;
    },
};
