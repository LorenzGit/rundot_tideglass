/**
 * Screen router. One phase visible at a time; the 'playing' phase stacks the
 * React HUD above the Pixi canvas.
 *
 * #app-frame (styled in styles/app.css) is the playable frame: portrait-first,
 * centred over a full-bleed backdrop. Everything interactive — canvas and DOM
 * UI — lives inside the frame, so safe areas and input never leak into the
 * decorative water at the sides.
 */
import { useEffect } from "react";
import { ART } from "../assets/art/index.ts";
import { store, useStore } from "../state/store.ts";
import GameCanvas from "../game/GameCanvas.tsx";
import Hud from "./Hud.tsx";
import LoadingScreen from "./LoadingScreen.tsx";
import MainMenu from "./MainMenu.tsx";
import Overlays, { HowToOverlay } from "./Overlays.tsx";
import DailyQuestsScreen from "./DailyQuestsScreen.tsx";
import DailyRewardsScreen from "./DailyRewardsScreen.tsx";
import SettingsScreen from "./SettingsScreen.tsx";
import ShopScreen from "./ShopScreen.tsx";
import StatsScreen from "./StatsScreen.tsx";
import { applyRunSafeArea } from "../sdk/runSdk.ts";

function useOrientationSafeArea(): void {
    useEffect(() => {
        const refreshSafeArea = () => {
            applyRunSafeArea();
        };
        window.addEventListener("orientationchange", refreshSafeArea);
        return () => window.removeEventListener("orientationchange", refreshSafeArea);
    }, []);
}

function MenuRoute() {
    const screen = useStore((state) => state.menuScreen);
    if (screen === "daily-rewards") return <DailyRewardsScreen />;
    if (screen === "daily-quests") return <DailyQuestsScreen />;
    if (screen === "shop") return <ShopScreen />;
    if (screen === "stats") return <StatsScreen />;
    if (screen === "settings") return <SettingsScreen />;
    return <MainMenu />;
}

export default function App() {
    useOrientationSafeArea();
    const phase = useStore((s) => s.phase);
    const overlay = useStore((s) => s.overlay);
    const reducedMotion = useStore((s) => s.reducedMotion);

    // The stylesheet stills its own animations off this attribute, so the DOM
    // and the Pixi scene honour reduced motion from the same switch.
    useEffect(() => {
        document.documentElement.dataset.reducedMotion = String(reducedMotion);
    }, [reducedMotion]);

    // The painted shrine is published as a CSS variable once, then switched on
    // and off per phase: the board draws its own seabed in Pixi, and layering a
    // second painted scene behind it would only fight the tiles for attention.
    useEffect(() => {
        document.documentElement.style.setProperty("--shrine-image", `url("${ART.menuBackdrop}")`);
    }, []);

    const backdrop = phase === "playing" ? "none" : "shrine";
    useEffect(() => {
        document.body.dataset.backdrop = backdrop;
    }, [backdrop]);

    return (
        <div id="app-frame" data-backdrop={backdrop}>
            {phase === "loading" && <LoadingScreen />}
            {/*
             * `key` on the phase wrapper is what makes the animation replay:
             * React reuses the element otherwise and the enter animation only
             * ever runs once, on first mount.
             */}
            {phase === "menu" && (
                <div className="absolute inset-0 phase-enter-lift" key="menu">
                    <MenuRoute />
                </div>
            )}
            {phase === "playing" && (
                <div className="absolute inset-0 phase-enter" key="playing">
                    <GameCanvas />
                    <Hud />
                </div>
            )}
            {phase === "playing" && <Overlays />}
            {/* How-to is reachable from Options, which lives outside the board. */}
            {phase === "menu" && overlay === "howto" && <HowToOverlay />}
            <Toast />
        </div>
    );
}

function Toast() {
    const toast = useStore((state) => state.toast);
    useEffect(() => {
        if (!toast) return;
        const timer = window.setTimeout(() => store.patch({ toast: null }), 2_600);
        return () => window.clearTimeout(timer);
    }, [toast]);
    if (!toast) return null;
    return (
        <button type="button" className="toast" onClick={() => store.patch({ toast: null })}>
            {toast}
        </button>
    );
}
