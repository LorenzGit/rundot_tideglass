/**
 * The development-only browser contract the headless QA harness drives.
 *
 * It exists because of one specific failure mode: a harness that taps guessed
 * screen coordinates passes happily while hitting nothing but felt. So the
 * harness never guesses — it asks the SCENE where the tiles are, plays the move
 * the engine says is legal, and then asserts the score actually moved.
 *
 * Never present in production: gated on both `import.meta.env.DEV` and `?qa=1`.
 */
import packageJson from "../../package.json";
import { audioManager } from "../audio/audioManager.ts";
import { activeController } from "../game/gameController.ts";
import { getRunCapabilities } from "../sdk/runSdk.ts";
import { saveSystem } from "../systems/save.ts";
import { rendererLifecycleSnapshot } from "../rendering/rendererLifecycle.ts";
import { store, type AppState } from "../state/store.ts";

interface Point {
    x: number;
    y: number;
}

interface TideglassQa {
    snapshot(): Record<string, unknown>;
    /** Screen points for a legal matching move, in the order to tap them. */
    nextMovePoints(): Point[];
    /** The same move, with the tile ids and kinds, for diagnosing a miss. */
    nextMove(): { kind: string; ids: number[]; points: Point[]; tray: number[] } | null;
    /** Screen points for every tile the player could tap right now. */
    freeTilePoints(): Point[];
    setSetting(key: keyof AppState, value: unknown): Promise<void>;
    unlockAudio(): Promise<boolean>;
    /** Seed a results overlay so it can be photographed without a full playthrough. */
    showResult(cleared: boolean): void;
    /** Widths of the elements most likely to overflow a narrow phone. */
    layoutFit(): Array<{ name: string; width: number; viewport: number }>;
    /**
     * Which tile a screen point actually hits: the tile id, -1 for some other
     * display object, or null for nothing. This is what proves a tap the
     * harness is about to make can land, rather than discovering later that it
     * was swallowed by a neighbour's sprite.
     */
    hitTest(x: number, y: number): number | null;
    /**
     * Give the player some history so value-gated surfaces are reviewable.
     * This moves LOCAL progression only — it cannot grant an entitlement, so a
     * seeded shop still shows unowned products at their real gate.
     */
    seedProgress(levelsCleared: number, pearls: number): Promise<void>;
}

declare global {
    var __gameQa: TideglassQa | undefined;
}

export function installBrowserQaContract(): void {
    if (!import.meta.env.DEV || new URLSearchParams(window.location.search).get("qa") !== "1") return;
    document.documentElement.dataset.qaContract = "ready";

    globalThis.__gameQa = {
        snapshot() {
            const state = store.get();
            const session = activeController()?.currentSession() ?? null;
            return {
                version: packageJson.version,
                phase: state.phase,
                menuScreen: state.menuScreen,
                overlay: state.overlay,
                paused: state.paused,
                level: state.level,
                score: state.score,
                pearls: state.pearls,
                combo: state.combo,
                matches: session?.matches ?? 0,
                tilesRemaining: state.tilesRemaining,
                tilesTotal: state.tilesTotal,
                trayCount: state.trayCount,
                trayCapacity: state.trayCapacity,
                sessionStatus: state.sessionStatus,
                reducedMotion: state.reducedMotion,
                selectedFinish: state.selectedFinish,
                renderer: document.documentElement.dataset.renderer ?? "pending",
                rendererLifecycle: rendererLifecycleSnapshot(),
                host: getRunCapabilities().host,
                audio: audioManager.debugSnapshot(),
            };
        },

        nextMovePoints() {
            const controller = activeController();
            const session = controller?.currentSession();
            if (!controller || !session) return [];
            // The engine decides what is legal; the harness only carries it out.
            const hint = session.hint();
            if (!hint) return [];
            const ids = hint.kind === "board-pair" ? hint.tileIds : [hint.tileId];
            const points: Point[] = [];
            for (const id of ids) {
                const point = controller.tilePoint(id);
                if (point) points.push(point);
            }
            return points;
        },

        nextMove() {
            const controller = activeController();
            const session = controller?.currentSession();
            if (!controller || !session) return null;
            const hint = session.hint();
            if (!hint) return null;
            const ids = hint.kind === "board-pair" ? [...hint.tileIds] : [hint.tileId];
            return {
                kind: hint.kind,
                ids,
                points: ids.map((id) => controller.tilePoint(id)).filter((p): p is Point => p !== null),
                tray: session.tray.map((tile) => tile.kind),
            };
        },

        freeTilePoints() {
            const controller = activeController();
            if (!controller) return [];
            const points: Point[] = [];
            for (const id of controller.freeTileIds()) {
                const point = controller.tilePoint(id);
                if (point) points.push(point);
            }
            return points;
        },

        async setSetting(key, value) {
            store.patch({ [key]: value } as Partial<AppState>);
            if (key === "reducedMotion") {
                document.documentElement.dataset.reducedMotion = String(value);
                activeController()?.setReducedMotion(value === true);
            }
            await saveSystem.flush();
        },

        async unlockAudio() {
            return audioManager.unlock();
        },

        showResult(cleared) {
            store.patch({
                overlay: cleared ? "won" : "lost",
                sessionStatus: cleared ? "won" : "lost",
                lastResult: {
                    level: store.get().level,
                    score: 13_640,
                    timeMs: 262_000,
                    bestCombo: 9,
                    matches: 61,
                    timeBonus: 1_440,
                    toolBonus: 240,
                    pearlsEarned: 118,
                    cleared,
                    newBest: cleared,
                },
            });
        },

        async seedProgress(levelsCleared, pearls) {
            store.patch({
                levelsCleared,
                pearls,
                totalPlays: Math.max(store.get().totalPlays, levelsCleared),
                highestLevel: Math.max(store.get().highestLevel, levelsCleared + 1),
            });
            await saveSystem.flush();
        },

        hitTest(x, y) {
            return activeController()?.hitTest(x, y) ?? null;
        },

        layoutFit() {
            const frame = document.getElementById("app-frame");
            const viewport = frame?.clientWidth ?? window.innerWidth;
            const measured: Array<{ name: string; width: number; viewport: number }> = [];
            // The two elements that have actually overflowed in development:
            // the toolbar (three 74px tools plus gaps) and the display title.
            for (const [name, selector] of [
                ["toolbar", ".toolbar"],
                ["title", ".menu-title"],
                ["overlay-title", ".overlay-title"],
                ["hud-meta", ".hud-meta"],
            ] as const) {
                const element = document.querySelector(selector);
                if (!element) continue;
                measured.push({ name, width: Math.ceil(element.getBoundingClientRect().width), viewport });
            }
            return measured;
        },
    };
}
