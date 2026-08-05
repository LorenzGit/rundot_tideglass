/**
 * Purchases and ownership.
 *
 * Two rules run through everything here. Ownership is only ever asserted from
 * an authoritative entitlement read — never from analytics, never from a local
 * flag written after a checkout returned. And a surface whose live price has
 * not resolved shows that it has not resolved, rather than inventing one.
 */
import type { ShopOrderHistoryResponse, ShopPurchaseResponse, StorefrontItem } from "@series-inc/rundot-game-sdk";
import { PLATFORM_IDS } from "../config/platform.ts";
import {
    fetchEntitlements,
    fetchShopCatalog,
    fetchShopOrderHistory,
    getRunCapabilities,
    purchaseShopItem,
} from "../sdk/runSdk.ts";
import { store } from "../state/store.ts";
import { finish, isFinishId } from "../game/art/finishes.ts";
import { DEV_PREVIEW_PRICES, PRODUCT_UNLOCK_LEVELS, type ProductId, products } from "./monetization/config.ts";
import { getMonetizationControls, monetizationTelemetry } from "./monetization/runtime.ts";
import {
    createPurchaseCoordinator,
    type PendingPurchaseIntent,
    type PurchaseOutcome,
} from "./monetization/purchaseCoordinator.ts";
import { saveSystem } from "./save.ts";

import { analytics } from "./analytics/analyticsConfig.ts";
let catalog = new Map<string, StorefrontItem>();
let catalogConfigId: string | null = null;
let entitlementIds = new Set<string>();
/** False whenever ownership could not be read; it never means "owns nothing". */
let entitlementsAuthoritative = false;
let refreshInFlight: Promise<void> | null = null;

export interface ProductView {
    productId: ProductId;
    name: string;
    /** Whether the offer should appear at all. */
    visible: boolean;
    owned: boolean;
    purchasable: boolean;
    priceLabel: string;
    statusLabel: string;
    /** True when the label is a local development preview, not a live price. */
    preview: boolean;
}

async function syncEntitlements(): Promise<void> {
    const entitlements = await fetchEntitlements();
    if (entitlements === null) {
        entitlementsAuthoritative = false;
        entitlementIds = new Set();
        return;
    }
    entitlementsAuthoritative = true;
    entitlementIds = new Set(
        entitlements.filter((entry) => entry.status === "active" && entry.quantity > 0).map((e) => e.entitlementId),
    );
    monetizationTelemetry.record("entitlement_synced", { count: entitlementIds.size });
}

const purchaseCoordinator = createPurchaseCoordinator<ShopPurchaseResponse, ShopOrderHistoryResponse>({
    shop: {
        async purchase(itemId, idempotencyKey) {
            const response = await purchaseShopItem(itemId, idempotencyKey);
            if (!response.success) throw new Error("RUN SHOP DID NOT CONFIRM THE ORDER");
            return response;
        },
        getOrderHistory: fetchShopOrderHistory,
    },
    pending: {
        load: () => {
            const saved = store.get().pendingPurchaseIntent;
            return saved
                ? {
                      intentId: saved.idempotencyKey,
                      productId: saved.productId,
                      catalogItemId: saved.catalogItemId,
                      idempotencyKey: saved.idempotencyKey,
                      createdAtMs: saved.startedAt,
                  }
                : null;
        },
        async save(intent) {
            store.patch({
                pendingPurchaseIntent: {
                    productId: intent.productId,
                    catalogItemId: intent.catalogItemId,
                    idempotencyKey: intent.idempotencyKey,
                    startedAt: intent.createdAtMs,
                },
            });
            // If the intent cannot be persisted, an interrupted checkout would
            // be unrecoverable — refuse to open it at all.
            if (!(await saveSystem.flush())) throw new Error("PURCHASE INTENT COULD NOT BE SAVED");
        },
        async clear() {
            store.patch({ pendingPurchaseIntent: null });
            await saveSystem.flush();
        },
    },
    findConfirmedOrder(history, intent) {
        if (!history.success) return null;
        return (
            history.orders.find(
                (order) =>
                    order.itemId === intent.catalogItemId &&
                    order.idempotencyKey === intent.idempotencyKey &&
                    order.status === "fulfilled",
            ) ?? null
        );
    },
    syncEntitlements,
    classifyError(error) {
        const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        if (message.includes("cancel")) return "cancelled";
        if (message.includes("declin") || message.includes("insufficient") || message.includes("did not confirm")) {
            return "failed";
        }
        // Timeouts and unrecognised host outcomes stay unknown so the intent
        // survives and can be reconciled against order history.
        return "unknown";
    },
});

export async function refreshCommerce(): Promise<void> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
        const [nextCatalog] = await Promise.all([fetchShopCatalog(), syncEntitlements()]);
        catalogConfigId = nextCatalog?.configId ?? null;
        catalog = new Map((nextCatalog?.items ?? []).filter((item) => item.active).map((item) => [item.itemId, item]));
        if (import.meta.env.DEV && nextCatalog) {
            const issues = products.validateCatalog(
                nextCatalog.items.map((item) => ({
                    id: item.itemId,
                    active: item.active,
                    price: item.price,
                    entitlements: item.entitlements,
                })),
            );
            for (const issue of issues)
                console.warn(`[commerce] ${issue.severity}: ${issue.productId} ${issue.message}`);
        }
    })().finally(() => {
        refreshInFlight = null;
    });
    return refreshInFlight;
}

function liveItem(productId: ProductId): StorefrontItem | null {
    const definition = products.get(productId);
    return definition ? (catalog.get(definition.catalogItemId) ?? null) : null;
}

function formatLivePrice(item: StorefrontItem): string {
    const price = item.resolvedPrice.finalPrice;
    const unit = price.type.toLowerCase() === "bucks" ? "RB" : price.type.toUpperCase();
    return `${price.value} ${unit}`.trim();
}

export function entitlementsReady(): boolean {
    return entitlementsAuthoritative;
}

export function hasEntitlement(entitlementId: string): boolean {
    return entitlementsAuthoritative && entitlementIds.has(entitlementId);
}

/** True only when ownership has been verified. Used to suppress interstitials. */
export function ownsAdFree(): boolean {
    const stillWater = products.get("still_water");
    const bundle = products.get("deepwater_bundle");
    // The bundle grants Still Water's entitlement directly, so checking the
    // entitlement rather than the item covers both ways of owning it.
    const ids = [...(stillWater?.expectedEntitlementIds ?? []), ...(bundle?.expectedEntitlementIds ?? [])];
    return ids.some((id) => hasEntitlement(id));
}

/** The Lantern Kit's permanent per-level tool stipend. */
export function ownsLanternKit(): boolean {
    const kit = products.get("lantern_kit");
    return (kit?.expectedEntitlementIds ?? []).some((id) => hasEntitlement(id));
}

/**
 * Finish ownership. Vitreum is free, Amber is bought with pearls and recorded
 * locally, and Abyssal exists only as an entitlement — so it is the one that
 * must never be asserted from local state.
 */
export function finishIsOwned(id: string): boolean {
    const skin = finish(id);
    if (skin.id === "vitreum") return true;
    if (skin.id === "abyssal") return hasEntitlement(PLATFORM_IDS.abyssalFinishEntitlement);
    return store.get().ownedFinishes.includes(skin.id);
}

export function productView(productId: ProductId): ProductView {
    const definition = products.get(productId);
    if (!definition) throw new Error(`Unknown commerce product ${productId}`);

    const capabilities = getRunCapabilities();
    const controls = getMonetizationControls();
    const enabled = controls.enabled && controls.purchasesEnabled && controls.products[productId]?.enabled === true;
    const item = liveItem(productId);
    const hostReady = enabled && capabilities.shop && !capabilities.mock && item !== null;

    // Local development has no catalog at all; showing the offer with a clearly
    // marked preview price is what makes the surface reviewable without ever
    // presenting an unverified number as live.
    const devPreview = import.meta.env.DEV && (!capabilities.host || capabilities.mock);

    const cleared = store.get().levelsCleared;
    const required = PRODUCT_UNLOCK_LEVELS[productId];
    const eligible = cleared >= required;
    const owned = entitlementsAuthoritative && definition.expectedEntitlementIds.every((id) => entitlementIds.has(id));

    return {
        productId,
        name: item?.name ?? PRODUCT_NAMES[productId],
        visible: owned || eligible,
        owned,
        purchasable: eligible && !owned && hostReady,
        preview: !item && devPreview,
        priceLabel: item
            ? formatLivePrice(item)
            : devPreview
              ? // Marked inline, not only in the status line: the status line is
                // often busy saying what unlocks the offer, and an unmarked
                // number is indistinguishable from a resolved catalog price.
                `${DEV_PREVIEW_PRICES[productId]} · PREVIEW`
              : eligible
                ? "PRICE NOT SYNCED"
                : `AFTER ${required} LEVEL${required === 1 ? "" : "S"}`,
        statusLabel: owned
            ? "OWNED"
            : !eligible
              ? `CLEAR ${required} LEVEL${required === 1 ? "" : "S"}`
              : devPreview
                ? "PREVIEW · NOT PURCHASABLE HERE"
                : hostReady
                  ? "PERMANENT"
                  : "UNAVAILABLE",
    };
}

const PRODUCT_NAMES: Readonly<Record<ProductId, string>> = {
    lantern_kit: "LANTERN KIT",
    still_water: "STILL WATER",
    deepwater_bundle: "DEEPWATER BUNDLE",
};

export async function purchaseProduct(
    productId: ProductId,
    placement = "shop",
): Promise<PurchaseOutcome<ShopPurchaseResponse> | null> {
    const view = productView(productId);
    const definition = products.get(productId);
    if (!view.purchasable || !definition) return null;

    analytics.funnelStep("purchase", 2);
    monetizationTelemetry.record("purchase_tapped", { product_id: productId, placement });
    analytics.funnelStep("purchase", 3);
    monetizationTelemetry.record("checkout_started", { product_id: productId, placement });
    const outcome = await purchaseCoordinator.purchase(productId, definition.catalogItemId);
    analytics.funnelStep("purchase", 4);
    monetizationTelemetry.record("checkout_result", {
        product_id: productId,
        placement,
        result: outcome.status,
    });
    if (outcome.status === "confirmed") enforceOwnedSelection();
    return outcome;
}

/** Called on resume: an interrupted checkout must not stay in limbo. */
export async function reconcilePendingPurchase(): Promise<void> {
    const pending: PendingPurchaseIntent | null = purchaseCoordinator.pendingIntent();
    if (!pending) return;
    const outcome = await purchaseCoordinator.reconcilePending();
    if (!outcome) return;
    monetizationTelemetry.record("checkout_result", {
        product_id: pending.productId,
        placement: "resume_reconciliation",
        result: outcome.status,
    });
    if (outcome.status === "confirmed") enforceOwnedSelection();
}

/**
 * A finish the player no longer owns (revoked entitlement, refund, or a save
 * edited by hand) quietly reverts to Vitreum rather than rendering glass they
 * do not have.
 */
export function enforceOwnedSelection(): void {
    const selected = store.get().selectedFinish;
    if (isFinishId(selected) && finishIsOwned(selected)) return;
    store.patch({ selectedFinish: "vitreum" });
    void saveSystem.flush();
}

export interface CommerceDiagnostics {
    catalogConfigId: string | null;
    catalogItemIds: readonly string[];
    entitlementIds: readonly string[];
    authoritative: boolean;
}

export function commerceDiagnostics(): CommerceDiagnostics {
    return {
        catalogConfigId,
        catalogItemIds: [...catalog.keys()].sort(),
        entitlementIds: [...entitlementIds].sort(),
        authoritative: entitlementsAuthoritative,
    };
}
