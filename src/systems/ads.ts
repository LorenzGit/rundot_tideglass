/**
 * Ad placements: two opt-in rewarded videos and one capped interstitial.
 *
 * Eligibility is evaluated here and nowhere else, so the answer to "will an ad
 * play right now" has exactly one implementation. Every gate in DESIGN.md is
 * enforced: unlock thresholds, cooldowns, session and daily caps, first-session
 * exclusion, ad-free ownership, and LiveOps kill switches.
 *
 * Daily caps use RUN trusted time when the host provides it. Outside the host
 * the local day is used and labelled non-authoritative — it gates nothing that
 * costs the player anything, only how often an optional video is offered.
 */
import {
    getRunCapabilities,
    showVerifiedInterstitialAd,
    showVerifiedRewardedAd,
    type VerifiedActionResult,
} from "../sdk/runSdk.ts";
import { store } from "../state/store.ts";
import { ownsAdFree } from "./commerce.ts";
import {
    INTERSTITIAL_LEVEL_INTERVAL,
    PLACEMENT,
    PLACEMENT_DISPLAY_ID,
    type PlacementId,
    placements,
} from "./monetization/config.ts";
import { getMonetizationControls, monetizationTelemetry } from "./monetization/runtime.ts";
import { localDayKey, serverNow } from "./serverTime.ts";

import { analytics } from "./analytics/analyticsConfig.ts";
interface PlacementCounters {
    session: number;
    day: number;
    dayKey: string;
    lastShownAt: number;
}

/** Session counters are intentionally in-memory: a session IS one page life. */
const counters = new Map<PlacementId, PlacementCounters>();
/** Any ad — of any kind — spaces out every other ad. */
let lastAnyAdAt = 0;
const sessionStartedAt = performance.now();
/** Levels cleared since this page loaded, used for first-session exclusion. */
let levelsThisSession = 0;

function countersFor(id: PlacementId): PlacementCounters {
    const today = localDayKey(serverNow());
    const existing = counters.get(id);
    if (existing && existing.dayKey === today) return existing;
    const fresh: PlacementCounters = {
        session: existing?.session ?? 0,
        day: 0,
        dayKey: today,
        lastShownAt: existing?.lastShownAt ?? 0,
    };
    counters.set(id, fresh);
    return fresh;
}

export type AdBlockReason =
    | "ok"
    | "no-host"
    | "disabled"
    | "not-unlocked"
    | "cooldown"
    | "session-cap"
    | "daily-cap"
    | "owns-ad-free"
    | "first-session"
    | "not-due";

export function rewardedEligibility(id: PlacementId): AdBlockReason {
    const placement = placements.require(id);
    // LiveOps saying "on" is not the same as the host being able to serve an
    // ad. Without this check a remote config could put an offer in front of a
    // player on a host with no ad support, where every tap fails and they are
    // told nothing useful.
    if (!getRunCapabilities().ads) return "no-host";
    const controls = getMonetizationControls();
    if (!controls.enabled || !controls.rewardedAdsEnabled) return "disabled";
    if (controls.placements[id]?.enabled !== true) return "disabled";
    if (store.get().levelsCleared < placement.unlock.minCompletedSessions) return "not-unlocked";

    const state = countersFor(id);
    const remote = controls.placements[id];
    const cooldown = Math.max(placement.cooldownSeconds, remote?.cooldownSeconds ?? 0);
    if (cooldown > 0 && performance.now() - state.lastShownAt < cooldown * 1_000) return "cooldown";
    if (state.session >= Math.min(placement.sessionCap, remote?.sessionCap ?? placement.sessionCap)) {
        return "session-cap";
    }
    if (state.day >= Math.min(placement.dailyCap, remote?.dailyCap ?? placement.dailyCap)) return "daily-cap";
    return "ok";
}

/** True when the video can actually be shown. Nothing is offered without it. */
export function rewardedAvailable(id: PlacementId): boolean {
    return rewardedEligibility(id) === "ok";
}

/**
 * True when the offer should be VISIBLE but is not playable: local development,
 * where there is no host to serve an ad.
 *
 * A surface that simply vanishes outside the host is a surface nobody reviews
 * until it reaches production. So the button is drawn, clearly labelled, and
 * inert — it can never grant anything, because the grant paths all require a
 * host-verified completion regardless of what this returns.
 */
export function rewardedDevPreview(id: PlacementId): boolean {
    if (!import.meta.env.DEV) return false;
    const capabilities = getRunCapabilities();
    if (capabilities.ads) return false;
    // Everything except the missing host must still check out, so a preview
    // never appears somewhere the real offer would be gated anyway.
    const placement = placements.require(id);
    return store.get().levelsCleared >= placement.unlock.minCompletedSessions;
}

/**
 * Show a rewarded video. Resolves "verified" ONLY when the SDK confirms the
 * video completed; every other outcome grants nothing.
 */
export async function showRewarded(id: PlacementId): Promise<VerifiedActionResult> {
    if (!rewardedAvailable(id)) return "unavailable";
    const placement = placements.require(id);
    monetizationTelemetry.record("ad_requested", { placement_id: id, format: "rewarded" });

    // Offered vs complete: one without the other separates a weak reward from
    // missing inventory. Only a confirmed result earned the reward.
    analytics.event("rewarded_ad_offered", { ad_display_id: String(PLACEMENT_DISPLAY_ID[id]) });
    const result = await showVerifiedRewardedAd(PLACEMENT_DISPLAY_ID[id], placement.displayName);
    if (result === "verified")
        analytics.event("rewarded_ad_complete", { ad_display_id: String(PLACEMENT_DISPLAY_ID[id]) });
    monetizationTelemetry.record("ad_result", { placement_id: id, format: "rewarded", result });

    if (result === "verified" || result === "cancelled") {
        const state = countersFor(id);
        state.session += 1;
        state.day += 1;
        state.lastShownAt = performance.now();
        lastAnyAdAt = performance.now();
    }
    return result;
}

/**
 * The interstitial. It has exactly one trigger — dismissing the level-results
 * overlay — and it must clear every gate below before it fires.
 */
export function interstitialEligibility(): AdBlockReason {
    const placement = placements.require(PLACEMENT.betweenLevels);
    if (placement.type !== "interstitial") return "disabled";
    if (!getRunCapabilities().ads) return "no-host";
    const controls = getMonetizationControls();
    if (!controls.enabled || !controls.interstitialAdsEnabled) return "disabled";
    if (controls.placements[PLACEMENT.betweenLevels]?.enabled !== true) return "disabled";
    if (ownsAdFree()) return "owns-ad-free";

    const state = store.get();
    if (state.levelsCleared < placement.unlock.minCompletedSessions) return "not-unlocked";
    // "First session" is the run of play that begins at boot. If every level
    // this player has ever cleared happened since this page loaded, they are
    // still in their first session and see no interstitial at all.
    if (placement.excludeFirstSession && levelsThisSession >= state.levelsCleared) return "first-session";
    if (state.levelsCleared % INTERSTITIAL_LEVEL_INTERVAL !== 0) return "not-due";

    const counter = countersFor(PLACEMENT.betweenLevels);
    const remote = controls.placements[PLACEMENT.betweenLevels];
    const cooldown = Math.max(placement.cooldownSeconds, remote?.cooldownSeconds ?? 0);
    // Spacing is measured against ANY ad, so a rewarded video the player just
    // opted into cannot be immediately followed by a mandatory one.
    if (performance.now() - Math.max(counter.lastShownAt, lastAnyAdAt) < cooldown * 1_000) return "cooldown";
    if (counter.session >= Math.min(placement.sessionCap, remote?.sessionCap ?? placement.sessionCap)) {
        return "session-cap";
    }
    if (counter.day >= Math.min(placement.dailyCap, remote?.dailyCap ?? placement.dailyCap)) return "daily-cap";
    // Never in the first 20 seconds of a session, whatever the counters say.
    if (performance.now() - sessionStartedAt < 20_000) return "cooldown";
    return "ok";
}

/** Called once per cleared level, before eligibility is next evaluated. */
export function recordClearedLevel(): void {
    levelsThisSession += 1;
}

export async function maybeShowInterstitial(): Promise<VerifiedActionResult> {
    const reason = interstitialEligibility();
    if (reason !== "ok") {
        monetizationTelemetry.record("ad_result", {
            placement_id: PLACEMENT.betweenLevels,
            format: "interstitial",
            result: "skipped",
            reason,
        });
        return "unavailable";
    }

    const placement = placements.require(PLACEMENT.betweenLevels);
    monetizationTelemetry.record("ad_requested", { placement_id: PLACEMENT.betweenLevels, format: "interstitial" });
    const result = await showVerifiedInterstitialAd(
        PLACEMENT_DISPLAY_ID[PLACEMENT.betweenLevels],
        placement.displayName,
    );
    // Interstitial load is the number to weigh against D1 when tuning ads.
    if (result === "verified")
        analytics.event("interstitial_shown", { ad_display_id: String(PLACEMENT_DISPLAY_ID[PLACEMENT.betweenLevels]) });
    monetizationTelemetry.record("ad_result", {
        placement_id: PLACEMENT.betweenLevels,
        format: "interstitial",
        result,
    });

    if (result === "verified") {
        const counter = countersFor(PLACEMENT.betweenLevels);
        counter.session += 1;
        counter.day += 1;
        counter.lastShownAt = performance.now();
        lastAnyAdAt = performance.now();
    }
    return result;
}

/** Development-only readout used by the diagnostics panel. */
export function adDiagnostics(): Record<string, string | number> {
    return {
        tide_cache: rewardedEligibility(PLACEMENT.tideCache),
        second_wind: rewardedEligibility(PLACEMENT.secondWind),
        interstitial: interstitialEligibility(),
        levels_this_session: levelsThisSession,
    };
}
