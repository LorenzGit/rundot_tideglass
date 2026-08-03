/**
 * TIDEGLASS's monetization decisions, in code.
 *
 * Nothing else in the game may invent a placement id, a cap, a product id or an
 * unlock gate — if it is not here, it does not exist.
 *
 * The promise this whole model is built around: no purchase and no ad ever
 * changes a board, a tile, a score, or how hard a level is. Boards are dealt
 * solvable for everyone. What money buys is a standing supply of the same tools
 * a player already earns by playing, and the right not to watch an interstitial.
 */
import { PLATFORM_IDS } from "../../config/platform.ts";
import { createMonetizationPlan } from "./monetizationPlan.ts";
import { createPlacementRegistry } from "./placementRegistry.ts";
import { createProductRegistry } from "./productRegistry.ts";

export const monetizationPlan = createMonetizationPlan({
    model: "hybrid",
    nonPayerPromise:
        "Every board is dealt solvable, and no purchase changes a tile, a layout, a score or a difficulty. Hints, undos and shuffles are all earned with pearls by playing. The only ad a non-payer cannot decline is one interstitial after every third cleared level, never in their first session.",
    purchaseArchitecture: "shop-entitlements",
    architectureRationale:
        "A permanent tool stipend and a permanent ad-free state must survive a device change, which needs the platform's ownership record and order ledger; a client-owned flag would be lost the first time a player reinstalled.",
    firstExposure: {
        valueMoment:
            "The player has cleared a level, spent at least one tool, and seen the results screen tell them what their remaining tools were worth.",
        minCompletedSessions: 2,
        minProgression: 2,
    },
    primaryKpis: ["game_payer_conversion", "rewarded_completion_rate"],
    guardrails: {
        retention: "D1/D7 retention split by first-interstitial exposure cohort",
        sessionHealth: "levels attempted per session before and after the first interstitial",
        economyHealth: "share of tools obtained from rewarded videos versus pearls",
        reliability: "purchase and ad error rate excluding player cancellation",
    },
});

export const PLACEMENT = {
    tideCache: "tide_cache",
    secondWind: "second_wind",
    betweenLevels: "between_levels",
} as const;

export type PlacementId = (typeof PLACEMENT)[keyof typeof PLACEMENT];

/** Placement id → the self-authored `adDisplayId` handed to the SDK. */
export const PLACEMENT_DISPLAY_ID: Readonly<Record<PlacementId, string>> = {
    [PLACEMENT.tideCache]: PLATFORM_IDS.rewardedTideCache,
    [PLACEMENT.secondWind]: PLATFORM_IDS.rewardedSecondWind,
    [PLACEMENT.betweenLevels]: PLATFORM_IDS.interstitialBetweenLevels,
};

export const placements = createPlacementRegistry([
    {
        id: PLACEMENT.tideCache,
        displayName: "Tide Cache",
        type: "rewarded",
        enabledByDefault: false,
        unlock: { minCompletedSessions: 1, minProgression: 1, requireValueMoment: true },
        cooldownSeconds: 0,
        sessionCap: 4,
        dailyCap: 12,
        subscriberPolicy: "same-as-free",
        noAdFallback: "disable-with-message",
        rewardId: "pearls_double",
        rewardAmount: 1,
    },
    {
        id: PLACEMENT.secondWind,
        displayName: "Second Wind",
        type: "rewarded",
        // Offered on a lost board, so it is gated a level later than the
        // cache: a player who loses their very first board should be told to
        // try again, not sold a rescue.
        enabledByDefault: false,
        unlock: { minCompletedSessions: 2, minProgression: 2, requireValueMoment: true },
        cooldownSeconds: 45,
        sessionCap: 2,
        dailyCap: 6,
        subscriberPolicy: "same-as-free",
        noAdFallback: "disable-with-message",
        rewardId: "tray_relief",
        rewardAmount: 3,
    },
    {
        id: PLACEMENT.betweenLevels,
        displayName: "Between Levels",
        type: "interstitial",
        enabledByDefault: false,
        unlock: { minCompletedSessions: 3, minProgression: 3, requireValueMoment: true },
        cooldownSeconds: 90,
        sessionCap: 2,
        dailyCap: 5,
        subscriberPolicy: "skip",
        noAdFallback: "hide",
        naturalBreak: "The player dismisses the results overlay and the next level is about to deal",
        excludeFirstSession: true,
    },
]);

/** Only every Nth cleared level may show the interstitial. */
export const INTERSTITIAL_LEVEL_INTERVAL = 3;

/** How many tiles Second Wind returns to the board. */
export const SECOND_WIND_RELIEF = 3;

export const products = createProductRegistry([
    {
        id: "lantern_kit",
        catalogItemId: PLATFORM_IDS.lanternKitItem,
        kind: "durable",
        expectedEntitlementIds: [PLATFORM_IDS.lanternKitEntitlement],
        unique: true,
        unlockDescription: "Offered once the player has cleared two levels and spent a tool",
    },
    {
        id: "still_water",
        catalogItemId: PLATFORM_IDS.stillWaterItem,
        kind: "durable",
        expectedEntitlementIds: [PLATFORM_IDS.stillWaterEntitlement],
        unique: true,
        unlockDescription: "Offered once the player has actually seen an interstitial break",
    },
    {
        id: "deepwater_bundle",
        catalogItemId: PLATFORM_IDS.deepwaterBundleItem,
        kind: "bundle",
        expectedEntitlementIds: [
            PLATFORM_IDS.lanternKitEntitlement,
            PLATFORM_IDS.stillWaterEntitlement,
            PLATFORM_IDS.abyssalFinishEntitlement,
        ],
        unique: true,
        unlockDescription: "Offered alongside its components once either one is eligible",
    },
]);

export type ProductId = "lantern_kit" | "still_water" | "deepwater_bundle";

/**
 * Shown in local development only, where no live catalog exists. These mirror
 * `rundot/shop.config.json` and the UI always labels them PREVIEW so they can
 * never be mistaken for a resolved live price.
 */
export const DEV_PREVIEW_PRICES: Readonly<Record<ProductId, string>> = {
    lantern_kit: "179 RB",
    still_water: "299 RB",
    deepwater_bundle: "429 RB",
};

/** Levels cleared before a product is offered at all. */
export const PRODUCT_UNLOCK_LEVELS: Readonly<Record<ProductId, number>> = {
    lantern_kit: 2,
    still_water: 3,
    deepwater_bundle: 3,
};

/** Extra tools handed out at the start of every level by the Lantern Kit. */
export const LANTERN_KIT_STIPEND = { hints: 1, undos: 1, shuffles: 1 } as const;
