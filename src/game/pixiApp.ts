/**
 * Pixi v8 Application factory. One place owns renderer options so the rest of
 * the game never touches them.
 */
import { Application } from "pixi.js";
import {
    monitorPixiWebGpuDevice,
    ownPixiApplication,
    type RendererLifecycleScope,
} from "../rendering/rendererLifecycle.ts";

type RendererPreference = "webgpu" | "webgl";

function rendererBackend(app: Application): RendererPreference {
    return app.renderer.constructor.name.toLowerCase().includes("webgpu") ? "webgpu" : "webgl";
}

async function initializeRenderer(
    scope: RendererLifecycleScope,
    host: HTMLElement,
    preference: RendererPreference,
): Promise<Application> {
    const app = new Application();
    const ownership = ownPixiApplication(scope, app);
    try {
        await app.init({
            preference,
            resizeTo: host,
            resolution: Math.min(window.devicePixelRatio || 1, 2),
            autoDensity: true,
            backgroundAlpha: 0,
            antialias: true,
        });
        scope.throwIfCancelled();
        const initializedBackend = rendererBackend(app);
        if (initializedBackend !== preference) {
            throw new Error(`Pixi initialized ${initializedBackend} while strict ${preference} was requested`);
        }
        if (initializedBackend === "webgpu") monitorPixiWebGpuDevice(scope, app, "Pixi game");
        return app;
    } catch (error) {
        await ownership.dispose();
        throw error;
    }
}

/**
 * Create and mount a Pixi app inside a host element. The canvas auto-resizes
 * to the host (the playable-frame div), so the game is sized by CSS — the same
 * orientation-aware `--game-w` frame that sizes the DOM UI.
 *
 * @param host element the canvas fills (position: relative/absolute)
 */
export async function createPixiApp(scope: RendererLifecycleScope, host: HTMLElement): Promise<Application> {
    const rendererQuery = new URLSearchParams(window.location.search).get("renderer");
    let app: Application;
    if (rendererQuery === "webgl" || rendererQuery === "webgpu") {
        // Forced modes are strict so QA can prove each backend independently.
        app = await initializeRenderer(scope, host, rendererQuery);
    } else {
        try {
            // Pixi feature detection can pass even when adapter/device creation
            // later fails in a WebView. That failure is not auto-retried.
            app = await initializeRenderer(scope, host, "webgpu");
        } catch (webGpuError) {
            scope.throwIfCancelled();
            console.warn("[renderer] WebGPU initialization failed; retrying with WebGL", webGpuError);
            app = await initializeRenderer(scope, host, "webgl");
        }
    }
    const rendererName = rendererBackend(app);
    document.documentElement.dataset.renderer = rendererName;
    app.canvas.dataset.renderer = rendererName;
    app.canvas.setAttribute("aria-label", "Pixel Foundry game canvas");
    host.appendChild(app.canvas);
    return app;
}
