import React from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App.tsx";
import ErrorBoundary from "./ui/ErrorBoundary.tsx";
import { store } from "./state/store.ts";
import { applyRunSafeArea, initSdk, registerLifecycles, requestHostExit } from "./sdk/runSdk.ts";
import { warmAssets } from "./assets/preload.ts";
import { saveSystem } from "./systems/save.ts";
import { restoreLocale } from "./systems/localization.ts";
import { audioManager } from "./audio/audioManager.ts";
import { runtimeServices } from "./systems/runtimeServices.ts";
import { enforceOwnedSelection, reconcilePendingPurchase, refreshCommerce } from "./systems/commerce.ts";
import { installBrowserQaContract } from "./qa/browserContract.ts";
import "./styles/app.css";

/**
 * Boot sequence. The ORDER here matters — it's the pattern from a shipped RUN
 * game. Keep the numbered steps in this order; add your own work at the
 * marked points.
 */
async function boot() {
    // 1. SDK first. Nothing may call RundotGameAPI before this resolves.
    //    Resolves even if init fails (local dev outside the RUN host).
    await initSdk();
    applyRunSafeArea();

    // 2. Restore versioned progress/settings before the first render.
    await saveSystem.load();
    document.documentElement.dataset.reducedMotion = String(store.get().reducedMotion);
    document.documentElement.dataset.quality = store.get().quality;
    restoreLocale();
    audioManager.bind();

    // 3. Mount React. `phase` starts at 'loading', so this paints the
    //    loading screen (progress bar at 0%).
    const rootElement = document.getElementById("root");
    if (!rootElement) throw new Error("Missing required #root mount element");
    createRoot(rootElement).render(
        <React.StrictMode>
            <ErrorBoundary>
                <App />
            </ErrorBoundary>
        </React.StrictMode>,
    );

    // 4. Lift the boot cover once the loading screen has actually painted
    //    (double-rAF = after the next rendered frame). Asset warming continues
    //    behind it — the player watches the progress bar, not a black screen.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const cover = document.getElementById("boot-cover");
            if (!cover) return;
            cover.classList.add("hidden");
            setTimeout(() => cover.remove(), 400); // matches the CSS transition
        });
    });

    // 5. Warm all critical assets (see src/assets/manifest.ts). Deferred
    //    assets keep loading in the background after this resolves.
    await warmAssets((p) => store.patch({ loadProgress: p }));

    // 6. Loading done — hand over to the menu.
    store.patch({ phase: "menu" });
    if (import.meta.env.DEV) {
        const { applyDevelopmentScreenPreview } = await import("./dev/preview.ts");
        applyDevelopmentScreenPreview();
    }

    // 7. Host lifecycle hooks. Register AFTER boot so handlers never race
    //    half-initialized state.
    //    Lifecycle rules: persist on onSleep, never rely on
    //    onQuit firing, and never fire fresh SDK RPCs (e.g. scheduling
    //    notifications) from onSleep/onQuit — a hard close kills the runtime
    //    before they land.
    registerLifecycles({
        onPause: () => {
            store.patch({ paused: true });
            audioManager.setPaused(true);
            void saveSystem.flush();
        },
        onResume: () => {
            store.patch({ paused: false });
            audioManager.setPaused(false);
            runtimeServices.resume();
        },
        onSleep: () => {
            store.patch({ paused: true });
            audioManager.setPaused(true);
            void saveSystem.flush();
        },
        onAwake: () => {
            store.patch({ paused: false });
            audioManager.setPaused(false);
            runtimeServices.resume();
        },
        onQuit: () => {
            void saveSystem.flush();
        },
        onIdentityChanged: (event) => {
            // Never flush the old account's in-memory state after the host has
            // switched identities. Reload and read the new identity's scope.
            if (event.idChanged) window.location.reload();
            else runtimeServices.resume();
        },
        onBackButton: () => {
            const state = store.get();
            if (state.phase === "playing" && state.overlay !== "none") {
                store.patch({ overlay: "none" });
            } else if (state.phase === "playing") {
                store.patch({ phase: "menu", menuScreen: "main", overlay: "none", paused: false });
                void saveSystem.flush();
            } else if (state.overlay !== "none") {
                store.patch({ overlay: "none" });
            } else if (state.menuScreen !== "main") {
                store.patch({ menuScreen: "main" });
            } else {
                void requestHostExit();
            }
        },
    });

    // 8. Post-boot, fire-and-forget: LiveOps, trusted time, notification
    //    re-arming, the shop catalog, and reconciling any checkout that was
    //    interrupted last session. None of it blocks or throws into boot.
    runtimeServices.bootstrap();
    void refreshCommerce()
        .then(() => reconcilePendingPurchase())
        .then(() => enforceOwnedSelection())
        .catch((error) => console.warn("[boot] commerce refresh failed", error));
    runtimeServices.funnel(1, "game_loaded", "tideglass_first_play", 1);
    installBrowserQaContract();
}

function preventBrowserChrome(event: Event): void {
    event.preventDefault();
}

document.addEventListener("selectstart", preventBrowserChrome);
document.addEventListener("contextmenu", preventBrowserChrome);
document.addEventListener("dragstart", preventBrowserChrome);

// RUN treats an unhandled rejection as fatal. Every known async boundary is
// handled locally; this official last-resort guard protects against a missed
// third-party thenable while keeping the failure visible to developers.
window.addEventListener("unhandledrejection", (event) => {
    console.warn("[runtime] guarded unhandled rejection", event.reason);
    event.preventDefault();
});

function start(): void {
    void boot().catch((error) => {
        console.error("[boot] fatal startup failure", error);
        const root = document.getElementById("root");
        if (!root) return;
        const message = document.createElement("main");
        message.className = "fatal-error";
        message.setAttribute("role", "alert");
        const heading = document.createElement("h1");
        heading.textContent = "Unable to start";
        const guidance = document.createElement("p");
        guidance.textContent = "Reload to try again.";
        message.append(heading, guidance);
        root.replaceChildren(message);
    });
}

if (document.readyState === "complete") start();
else window.addEventListener("load", start, { once: true });
