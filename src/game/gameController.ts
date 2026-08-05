/**
 * The level loop.
 *
 * The only file that knows about all four of the engine, the scene, the store
 * and the platform systems. Keeping that in one place is what lets `mahjong/`
 * stay provable and `scene/` stay presentational.
 *
 * Nothing here grants anything on trust: pearls come from a level the engine
 * says was cleared, tool top-ups come from a rewarded video the SDK confirmed
 * completed, and paid stipends come from a live entitlement read.
 */
import { audioManager } from "../audio/audioManager.ts";
import { analytics, FIRST_PLAY_FUNNEL } from "../systems/analytics/analyticsConfig.ts";
import { NoiseRandom } from "./noiseRandom.ts";
import { MahjongSession } from "./mahjong/session.ts";
import { SHUFFLE_UNLOCK_LEVEL } from "./mahjong/levels.ts";
import type { BoardScene } from "./scene/boardScene.ts";
import {
    maybeShowInterstitial,
    recordClearedLevel,
    rewardedAvailable,
    rewardedDevPreview,
    showRewarded,
} from "../systems/ads.ts";
import { ownsLanternKit } from "../systems/commerce.ts";
import { BASE_LEVEL_TOOLS, computePayout, TOOL_PRICES, type ToolId } from "../systems/economy.ts";
import { dailySystems } from "../systems/dailySystems.ts";
import { LANTERN_KIT_STIPEND, PLACEMENT, SECOND_WIND_RELIEF } from "../systems/monetization/config.ts";
import { saveSystem } from "../systems/save.ts";
import { recordAnalytics, triggerHaptic } from "../sdk/runSdk.ts";
import { store, type LevelResult } from "../state/store.ts";

/** How many tools a level starts with, stipend included. */
export function startingTools(): { hints: number; undos: number; shuffles: number } {
    const stipend = ownsLanternKit() ? LANTERN_KIT_STIPEND : { hints: 0, undos: 0, shuffles: 0 };
    return {
        hints: BASE_LEVEL_TOOLS.hints + stipend.hints,
        undos: BASE_LEVEL_TOOLS.undos + stipend.undos,
        shuffles: BASE_LEVEL_TOOLS.shuffles + stipend.shuffles,
    };
}

export class GameController {
    private readonly scene: BoardScene;
    private session: MahjongSession | null = null;
    private disposed = false;
    /** Second Wind is offered at most once per attempt at a level. */
    private secondWindUsed = false;
    /** Seed source for the level's deal. Advanced on every restart. */
    private dealCounter = 0;

    constructor(scene: BoardScene) {
        this.scene = scene;
        this.scene.setReducedMotion(store.get().reducedMotion);
        this.startLevel(store.get().level);
    }

    // -----------------------------------------------------------------
    // Level lifecycle
    // -----------------------------------------------------------------

    startLevel(level: number): void {
        if (this.disposed) return;
        this.dealCounter += 1;
        const seed = (level * 0x9e37 + this.dealCounter * 0x1f13 + store.get().totalPlays * 7) >>> 0;
        const session = new MahjongSession(level, new NoiseRandom(seed), startingTools());
        this.session = session;
        this.secondWindUsed = false;

        // Read BEFORE the write below: once the high-water mark is overwritten,
        // "was this a record?" is unanswerable. A beaten best is the progression
        // beat that predicts a next session, which run_ended alone cannot show.
        if (level > store.get().highestLevel) {
            analytics.event("milestone_reached", {
                milestone: "highest_level",
                value: level,
                previous: store.get().highestLevel,
            });
        }
        store.patch({
            level,
            highestLevel: Math.max(store.get().highestLevel, level),
            phase: "playing",
            overlay: "none",
            totalPlays: store.get().totalPlays + 1,
            shuffleUnlocked: level >= SHUFFLE_UNLOCK_LEVEL,
            lastResult: null,
        });
        this.scene.load(session);
        this.publish();
        void saveSystem.flush();
        void recordAnalytics("level_started", { level, layout: session.plan.layout.id });
        // Steps 2 and 6 share this call site; the once-ever marks make the
        // second start register as "came back for another level" on its own.
        analytics.funnelStep(FIRST_PLAY_FUNNEL, store.get().totalPlays <= 1 ? 2 : 6, { level });
    }

    restartLevel(): void {
        audioManager.play("start");
        this.startLevel(store.get().level);
    }

    /** Called by the results overlay. Advances only after a cleared board. */
    continueFromResults(): void {
        const result = store.get().lastResult;
        const nextLevel = result?.cleared ? store.get().level + 1 : store.get().level;
        store.patch({ overlay: "none" });
        // The interstitial rides the transition the player already expects to
        // wait through, and it is skipped entirely for owners and first sessions.
        void maybeShowInterstitial().finally(() => {
            if (!this.disposed) this.startLevel(nextLevel);
        });
    }

    /** Leave the board for the menu. Progress is kept; the level restarts later. */
    leaveToMenu(): void {
        store.patch({ phase: "menu", menuScreen: "main", overlay: "none" });
        void saveSystem.flush();
    }

    // -----------------------------------------------------------------
    // Scene callbacks
    // -----------------------------------------------------------------

    onTap(result: { matched: boolean; points: number; combo: number; perfect: boolean }): void {
        if (!result.matched) {
            audioManager.play("place");
            void this.haptic("light");
            return;
        }
        audioManager.play(result.perfect ? "perfect" : "match");
        void this.haptic(result.perfect ? "success" : "medium");
        analytics.funnelStep(FIRST_PLAY_FUNNEL, 3);
        dailySystems.recordProgress("matches", 1);
        // "combos" is a high-water task, so it is handed the combo reached
        // rather than an increment.
        dailySystems.recordProgress("combos", result.combo);
    }

    onRejected(reason: string): void {
        if (reason === "not-free") {
            audioManager.play("blocked");
            void this.haptic("warning");
        } else if (reason === "tray-full") {
            audioManager.play("error");
            store.patch({ toast: "THE TRAY IS FULL — UNDO OR SHUFFLE" });
        }
    }

    onFinished(status: "won" | "lost"): void {
        const session = this.session;
        if (!session || this.disposed) return;

        const cleared = status === "won";
        const payout = computePayout(session, cleared);
        const state = store.get();
        const newBest = cleared && payout.totalScore > state.bestScore;

        const result: LevelResult = {
            level: session.plan.level,
            score: payout.totalScore,
            timeMs: session.elapsedMs,
            bestCombo: session.bestCombo,
            matches: session.matches,
            timeBonus: payout.timeBonus,
            toolBonus: payout.toolBonus,
            pearlsEarned: payout.pearls,
            cleared,
            newBest,
        };

        store.patch({
            lastResult: result,
            pearls: state.pearls + payout.pearls,
            bestScore: Math.max(state.bestScore, payout.totalScore),
            levelsCleared: cleared ? state.levelsCleared + 1 : state.levelsCleared,
            // Only a cleared board unlocks the next one, so the ladder cannot be
            // skipped by losing repeatedly.
            highestLevel: cleared ? Math.max(state.highestLevel, session.plan.level + 1) : state.highestLevel,
            overlay: cleared ? "won" : "lost",
            sessionStatus: status,
        });

        if (cleared) {
            recordClearedLevel();
            dailySystems.recordProgress("levels", 1);
            audioManager.play("victory");
            void this.haptic("success");
        } else {
            audioManager.play("defeat");
            void this.haptic("error");
        }

        void saveSystem.flush();
        void recordAnalytics(cleared ? "level_cleared" : "level_lost", {
            level: session.plan.level,
            score: payout.totalScore,
            time_ms: Math.round(session.elapsedMs),
            best_combo: session.bestCombo,
            matches: session.matches,
        });
        if (cleared) {
            analytics.funnelStep(FIRST_PLAY_FUNNEL, 4, { level: session.plan.level, score: payout.totalScore });
            analytics.funnelStep("engagement", store.get().levelsCleared, { level: session.plan.level });
        }
        // Fires on a loss too: the results overlay is where an abandoned first
        // session actually ends, so it must be visible for both outcomes.
        analytics.funnelStep(FIRST_PLAY_FUNNEL, 5, { cleared });
    }

    publish(): void {
        const session = this.session;
        if (!session) return;
        store.patch({
            score: session.score,
            combo: session.combo,
            tilesRemaining: session.tilesRemaining,
            tilesTotal: session.plan.layout.slots.length,
            trayCount: session.tray.length,
            trayCapacity: session.trayCapacity,
            tools: { ...session.tools },
            sessionStatus: session.status,
            elapsedMs: session.elapsedMs,
        });
    }

    // -----------------------------------------------------------------
    // Tools
    // -----------------------------------------------------------------

    spendHint(): void {
        const session = this.session;
        if (!session || session.tools.hints <= 0 || session.status !== "playing") {
            audioManager.play("error");
            return;
        }
        if (!this.scene.showHint()) {
            store.patch({ toast: "NO MOVE LEFT — TRY A SHUFFLE" });
            audioManager.play("error");
            return;
        }
        session.tools.hints -= 1;
        audioManager.play("tool");
        void this.haptic("light");
        this.publish();
    }

    spendUndo(): void {
        const session = this.session;
        if (!session || session.tools.undos <= 0) {
            audioManager.play("error");
            return;
        }
        const result = session.undo();
        if (!result.ok || result.returnedToBoard === undefined) {
            audioManager.play("error");
            return;
        }
        session.tools.undos -= 1;
        this.scene.playUndo(result.returnedToBoard, result.returnedToTray);
        audioManager.play("tool");
        void this.haptic("light");
        store.patch({ overlay: "none" });
        this.publish();
    }

    spendShuffle(): void {
        const session = this.session;
        if (!session || session.tools.shuffles <= 0 || !session.plan.shuffleUnlocked) {
            audioManager.play("error");
            return;
        }
        if (!session.shuffle()) {
            audioManager.play("error");
            return;
        }
        session.tools.shuffles -= 1;
        this.scene.playShuffle();
        audioManager.play("shuffle");
        void this.haptic("medium");
        this.publish();
    }

    /** Buy a tool charge with pearls, mid-level. */
    buyTool(tool: ToolId): boolean {
        const session = this.session;
        const price = TOOL_PRICES[tool];
        const state = store.get();
        if (!session || state.pearls < price) {
            audioManager.play("error");
            store.patch({ toast: "NOT ENOUGH PEARLS" });
            return false;
        }
        session.tools[tool] += 1;
        store.patch({ pearls: state.pearls - price });
        audioManager.play("reward");
        this.publish();
        void saveSystem.flush();
        void recordAnalytics("tool_bought", { tool, price, level: state.level });
        return true;
    }

    // -----------------------------------------------------------------
    // Rewarded videos
    // -----------------------------------------------------------------

    /** Offered on the results screen after a cleared level. */
    canDoublePearls(): boolean {
        const result = store.get().lastResult;
        return result !== null && result.cleared && rewardedAvailable(PLACEMENT.tideCache);
    }

    /** Visible-but-inert in local development, so the offer stays reviewable. */
    doublePearlsIsPreview(): boolean {
        const result = store.get().lastResult;
        return result !== null && result.cleared && rewardedDevPreview(PLACEMENT.tideCache);
    }

    async doublePearls(): Promise<boolean> {
        const result = store.get().lastResult;
        if (!result || !result.cleared) return false;
        const outcome = await showRewarded(PLACEMENT.tideCache);
        // Anything short of a host-verified completion grants nothing.
        if (outcome !== "verified") {
            if (outcome !== "cancelled") store.patch({ toast: "THAT VIDEO IS NOT AVAILABLE RIGHT NOW" });
            return false;
        }
        const bonus = result.pearlsEarned;
        store.patch({
            pearls: store.get().pearls + bonus,
            lastResult: { ...result, pearlsEarned: result.pearlsEarned + bonus },
        });
        audioManager.play("reward");
        void this.haptic("success");
        void saveSystem.flush();
        return true;
    }

    /** Offered on a lost board: hand back the last few tiles and carry on. */
    canTakeSecondWind(): boolean {
        return !this.secondWindUsed && store.get().sessionStatus === "lost" && rewardedAvailable(PLACEMENT.secondWind);
    }

    secondWindIsPreview(): boolean {
        return !this.secondWindUsed && store.get().sessionStatus === "lost" && rewardedDevPreview(PLACEMENT.secondWind);
    }

    async takeSecondWind(): Promise<boolean> {
        const session = this.session;
        if (!session || this.secondWindUsed) return false;
        const outcome = await showRewarded(PLACEMENT.secondWind);
        if (outcome !== "verified") {
            if (outcome !== "cancelled") store.patch({ toast: "THAT VIDEO IS NOT AVAILABLE RIGHT NOW" });
            return false;
        }
        this.secondWindUsed = true;
        // Undo is the mechanism, so the relief is exactly the rule the player
        // already understands rather than a special state only this path knows.
        for (let index = 0; index < SECOND_WIND_RELIEF; index += 1) {
            const undone = session.undo();
            if (!undone.ok || undone.returnedToBoard === undefined) break;
            this.scene.playUndo(undone.returnedToBoard, undone.returnedToTray);
        }
        store.patch({ overlay: "none", sessionStatus: session.status, lastResult: null });
        audioManager.play("reward");
        void this.haptic("success");
        this.publish();
        return true;
    }

    // -----------------------------------------------------------------

    setReducedMotion(reduced: boolean): void {
        this.scene.setReducedMotion(reduced);
    }

    /** The QA harness asks the scene, not the DOM, where the tiles are. */
    freeTileIds(): number[] {
        return this.scene.freeTileIds();
    }

    tilePoint(tileId: number): { x: number; y: number } | null {
        return this.scene.tilePoint(tileId);
    }

    hitTest(clientX: number, clientY: number): number | null {
        return this.scene.hitTest(clientX, clientY);
    }

    currentSession(): MahjongSession | null {
        return this.session;
    }

    private async haptic(style: "light" | "medium" | "success" | "warning" | "error"): Promise<void> {
        if (!store.get().hapticsEnabled) return;
        await triggerHaptic(style);
    }

    dispose(): void {
        this.disposed = true;
        this.session = null;
    }
}

/**
 * The live controller, so React can reach it without threading a ref through
 * the whole tree. Null between scene teardown and the next mount, and every
 * caller must handle that rather than assuming a board exists.
 */
let active: GameController | null = null;

export function setActiveController(controller: GameController | null): void {
    active = controller;
}

export function activeController(): GameController | null {
    return active;
}
