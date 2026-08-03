/**
 * The shop. Three Run Bits products, and nothing else.
 *
 * Two rules are visible in the markup. A price is either the LIVE catalog price
 * or is labelled PREVIEW — there is no third state where an invented number
 * looks real. And ownership renders from `productView`, which reads verified
 * entitlements only, so a local save can never make a product look owned.
 */
import { useEffect, useState } from "react";
import { audioManager } from "../audio/audioManager.ts";
import { productView, purchaseProduct, refreshCommerce } from "../systems/commerce.ts";
import type { ProductId } from "../systems/monetization/config.ts";
import { store, useStore } from "../state/store.ts";
import SubscreenLayout, { PearlPill } from "./SubscreenLayout.tsx";

const COPY: Readonly<Record<ProductId, { title: string; body: string }>> = {
    lantern_kit: {
        title: "LANTERN KIT",
        body: "Every level from now on starts with one extra hint, one extra undo and one extra shuffle. Permanent, and it never changes a board.",
    },
    still_water: {
        title: "STILL WATER",
        body: "Removes the interstitial between levels, for good. Optional reward videos stay available and are never required.",
    },
    deepwater_bundle: {
        title: "DEEPWATER BUNDLE",
        body: "The Lantern Kit and Still Water together, plus the Abyssal tile finish — black glass that keeps the light it is given.",
    },
};

const ORDER: readonly ProductId[] = ["deepwater_bundle", "lantern_kit", "still_water"];

export default function ShopScreen() {
    const pearls = useStore((s) => s.pearls);
    const levelsCleared = useStore((s) => s.levelsCleared);
    const [busy, setBusy] = useState<ProductId | null>(null);
    // Re-read on mount so a purchase made on another device shows as owned.
    const [, setRefreshed] = useState(0);

    useEffect(() => {
        void refreshCommerce().then(() => setRefreshed((n) => n + 1));
    }, []);

    const buy = async (productId: ProductId) => {
        audioManager.play("tap");
        setBusy(productId);
        const outcome = await purchaseProduct(productId, "shop");
        setBusy(null);
        setRefreshed((n) => n + 1);
        if (!outcome) return;
        if (outcome.status === "confirmed") {
            audioManager.play("reward");
            store.patch({ toast: "PURCHASE CONFIRMED — THANK YOU" });
        } else if (outcome.status === "cancelled") {
            store.patch({ toast: "CHECKOUT CANCELLED" });
        } else if (outcome.status === "unknown") {
            store.patch({ toast: "ORDER STILL PENDING — WE WILL CHECK AGAIN" });
        } else {
            store.patch({ toast: "THE PURCHASE DID NOT GO THROUGH" });
        }
    };

    const views = ORDER.map((id) => ({ id, view: productView(id) })).filter((entry) => entry.view.visible);

    return (
        <SubscreenLayout title="SHOP" trailing={<PearlPill pearls={pearls} />}>
            <p className="notice">
                Nothing here changes a tile, a layout, a score, or how hard a level is. Every board is dealt so it can
                be finished, and every tool can be earned with pearls by playing.
            </p>

            {views.length === 0 && (
                <div className="card">
                    <h3>NOTHING YET</h3>
                    <p>
                        Clear a couple of levels and the shop opens up. You have cleared {levelsCleared}
                        {levelsCleared === 1 ? " level" : " levels"}.
                    </p>
                </div>
            )}

            {views.map(({ id, view }) => (
                <div className="card" key={id}>
                    <div className="card-head">
                        <h3>{COPY[id].title}</h3>
                        <span className="card-price">{view.priceLabel}</span>
                    </div>
                    <p>{COPY[id].body}</p>
                    <span className="tag" data-kind={view.owned ? "owned" : view.preview ? "preview" : undefined}>
                        {view.statusLabel}
                    </span>
                    <button
                        type="button"
                        className={view.owned ? "btn btn-ghost" : "btn btn-amber"}
                        disabled={!view.purchasable || busy !== null}
                        onClick={() => void buy(id)}
                    >
                        {view.owned ? "OWNED" : busy === id ? "OPENING CHECKOUT…" : "BUY"}
                    </button>
                </div>
            ))}
        </SubscreenLayout>
    );
}
