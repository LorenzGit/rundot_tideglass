import { store, type MenuScreen } from "../state/store.ts";

const MENU_SCREENS = new Set<MenuScreen>(["main", "daily-rewards", "daily-quests", "shop", "stats", "settings"]);

/**
 * Development-only deep link for visual review and automated browser checks.
 *
 * `?screen=` changes local in-memory navigation only; it never bypasses a RUN
 * permission, purchase, ad, entitlement, or other authoritative outcome. The
 * visual-QA harness drives every screen through this.
 */
export function applyDevelopmentScreenPreview(): void {
    if (!import.meta.env.DEV) return;
    const requested = new URLSearchParams(window.location.search).get("screen");
    if (!requested) return;
    if (requested === "game" || requested === "board") {
        store.patch({ phase: "playing", menuScreen: "main", overlay: "none", paused: false });
        return;
    }
    if (requested === "howto") {
        store.patch({ phase: "menu", menuScreen: "settings", overlay: "howto", paused: false });
        return;
    }
    if (MENU_SCREENS.has(requested as MenuScreen)) {
        store.patch({ phase: "menu", menuScreen: requested as MenuScreen, paused: false });
        return;
    }
    console.warn(`[dev] Unknown screen preview "${requested}".`);
}
