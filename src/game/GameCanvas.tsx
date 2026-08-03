/**
 * React ↔ Pixi boundary. React owns WHEN the board exists (mount/unmount with
 * the 'playing' phase); Pixi owns everything inside the canvas. No React state
 * flows in per frame — game → UI communication goes through the store.
 *
 * StrictMode-safe: the realm-wide renderer lifecycle queue serializes the
 * mount/cleanup/mount sequence, including initialization itself.
 */
import { useEffect, useRef } from "react";
import type { Application } from "pixi.js";
import { createPixiApp } from "./pixiApp.ts";
import { createStage, type Stage } from "./stage.ts";
import { createBoardScene, type BoardScene } from "./scene/boardScene.ts";
import { activeController, GameController, setActiveController } from "./gameController.ts";
import { store, useStore } from "../state/store.ts";
import {
    acquireRendererRuntime,
    type RendererLease,
    type RendererLifecycleScope,
} from "../rendering/rendererLifecycle.ts";

interface GameRenderer {
    app: Application;
}

async function initializeGameRenderer(scope: RendererLifecycleScope, host: HTMLElement): Promise<GameRenderer> {
    const app = await createPixiApp(scope, host);
    scope.throwIfCancelled();

    const stage: Stage = createStage(app);
    scope.manage(() => stage.destroy());

    // The controller is created after the scene but needs to answer the
    // scene's callbacks, so the callbacks read it through a mutable binding
    // rather than capturing a value that does not exist yet.
    let controller: GameController | null = null;
    const scene: BoardScene = createBoardScene(app, stage, {
        onTap: (result) => controller?.onTap(result),
        onRejected: (reason) => controller?.onRejected(reason),
        onFinished: (status) => controller?.onFinished(status),
        onStateChanged: () => controller?.publish(),
    });
    scope.manage(() => scene.destroy());

    controller = new GameController(scene);
    setActiveController(controller);
    scope.manage(() => {
        controller?.dispose();
        setActiveController(null);
    });

    if (store.get().paused || document.hidden) app.ticker.stop();
    return { app };
}

export default function GameCanvas() {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const appRef = useRef<Application | null>(null);
    const paused = useStore((s) => s.paused);
    const reducedMotion = useStore((s) => s.reducedMotion);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const abortController = new AbortController();
        let lease: RendererLease<GameRenderer> | null = null;

        void acquireRendererRuntime("pixi-game", abortController.signal, (scope) => initializeGameRenderer(scope, host))
            .then((nextLease) => {
                lease = nextLease;
                appRef.current = nextLease.value.app;
            })
            .catch((error: unknown) => {
                if (abortController.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
                    return;
                }
                console.error("[renderer] Pixi initialization failed", error);
                store.patch({
                    phase: "menu",
                    menuScreen: "main",
                    toast: "RENDERER UNAVAILABLE — TRY A DIFFERENT DEVICE",
                });
            });

        return () => {
            abortController.abort();
            appRef.current = null;
            void lease?.release();
        };
    }, []);

    // A settings change mid-board must take effect on the board, not only on
    // the next level.
    useEffect(() => {
        activeController()?.setReducedMotion(reducedMotion);
    }, [reducedMotion]);

    // Host lifecycle pause/resume → freeze/unfreeze the whole ticker.
    useEffect(() => {
        const app = appRef.current;
        if (!app) return;
        if (paused || document.hidden) app.ticker.stop();
        else app.ticker.start();
    }, [paused]);

    // Browser visibility is a second lifecycle source outside the RUN host.
    // Keep it independent from `paused` so a visibility event cannot clear a
    // host-owned pause overlay.
    useEffect(() => {
        const syncVisibility = () => {
            const app = appRef.current;
            if (!app) return;
            if (document.hidden || store.get().paused) app.ticker.stop();
            else app.ticker.start();
        };
        document.addEventListener("visibilitychange", syncVisibility);
        return () => document.removeEventListener("visibilitychange", syncVisibility);
    }, []);

    return <div ref={hostRef} className="absolute inset-0" />;
}
