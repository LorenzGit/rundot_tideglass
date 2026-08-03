/**
 * Every platform-side identifier, in one registry.
 *
 * Where each kind of id actually comes from:
 *
 * - `gameId`: written by `rundot init` (also in game.config.prod.json).
 * - Ad placement ids: SELF-AUTHORED plain strings passed as `adDisplayId` to
 *   showRewardedAdAsync/showInterstitialAd. There is no platform-side "create a
 *   placement" step — invent a stable name and ship it.
 * - Shop item / entitlement ids: SELF-AUTHORED in `rundot/shop.config.json`,
 *   which registers the catalog at deploy. These strings must match it exactly.
 *
 * Untouched REPLACE_WITH_ values fail closed: `isConfiguredPlatformId` is false,
 * so the surfaces that depend on them hide rather than offering something the
 * host cannot fulfil. `gameId` is the only one still waiting on `rundot init`.
 */
export const PLATFORM_IDS = Object.freeze({
    gameId: "CWXOeuPkUTKkNf0TRgFt",

    /** Rewarded: double the pearls earned on a cleared level. */
    rewardedTideCache: "tideglass_tide_cache_rewarded",
    /** Rewarded: return the last few tiles to the board after a full tray. */
    rewardedSecondWind: "tideglass_second_wind_rewarded",
    /** Interstitial: between levels, capped and skippable by ownership. */
    interstitialBetweenLevels: "tideglass_between_levels_interstitial",

    /** Shop items. */
    lanternKitItem: "tideglass_lantern_kit",
    stillWaterItem: "tideglass_still_water",
    deepwaterBundleItem: "tideglass_deepwater_bundle",

    /** Entitlements the items grant. */
    lanternKitEntitlement: "tideglass_lantern_kit",
    stillWaterEntitlement: "tideglass_still_water",
    abyssalFinishEntitlement: "tideglass_finish_abyssal",
});

export function isConfiguredPlatformId(value: string): boolean {
    return value.length > 0 && !value.startsWith("REPLACE_WITH_");
}
