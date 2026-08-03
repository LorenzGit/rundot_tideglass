/**
 * The live monetization controls.
 *
 * Everything monetization-related asks this module first, and this module fails
 * closed: with no LiveOps config reachable, `normalizeMonetizationLiveOps`
 * returns all-disabled and every surface hides itself. That is the correct
 * default, but it also means `rundot/liveops.config.json` MUST ship with the
 * enable flags or the game launches with monetization silently dark.
 */
import { recordAnalytics } from "../../sdk/runSdk.ts";
import {
    type MonetizationLiveOps,
    type MonetizationLiveOpsInput,
    normalizeMonetizationLiveOps,
} from "./monetizationLiveOps.ts";
import { createMonetizationTelemetry } from "./monetizationTelemetry.ts";

let controls: MonetizationLiveOps = normalizeMonetizationLiveOps(null);

export function getMonetizationControls(): Readonly<MonetizationLiveOps> {
    return controls;
}

/**
 * Feed the `tideglass_monetization` section of a LiveOps snapshot. Anything
 * unrecognised is discarded by the normalizer rather than trusted.
 */
export function applyMonetizationLiveOps(values: Record<string, unknown> | null | undefined): void {
    const section = values?.tideglass_monetization;
    controls = normalizeMonetizationLiveOps(
        section && typeof section === "object" ? (section as MonetizationLiveOpsInput) : null,
    );
}

export const monetizationTelemetry = createMonetizationTelemetry({
    analytics: { recordCustomEvent: (name, payload) => recordAnalytics(name, payload) },
    debug: import.meta.env.DEV,
});
