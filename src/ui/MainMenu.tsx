/**
 * The hub. One dominant action — play the level you are on — with everything
 * else demoted to a row of small tiles beneath it.
 */
import type { ReactNode } from "react";
import { audioManager } from "../audio/audioManager.ts";
import { GAME_NAME, GAME_TAGLINE } from "../game/constants.ts";
import type { FinishId } from "../game/art/finishes.ts";
import { makeKind } from "../game/mahjong/tiles.ts";
import { dailySystems } from "../systems/dailySystems.ts";
import { saveSystem } from "../systems/save.ts";
import { store, useStore, type MenuScreen } from "../state/store.ts";
import TilePreview from "./TilePreview.tsx";
import { IconRecord, IconSettings, IconShop, IconStreak, IconTasks } from "./icons.tsx";

const HERO_TILES = [makeKind("creature", 1), makeKind("pearl", 5), makeKind("creature", 8), makeKind("kelp", 3)];

export default function MainMenu() {
    const level = useStore((s) => s.level);
    const highestLevel = useStore((s) => s.highestLevel);
    const pearls = useStore((s) => s.pearls);
    const finish = useStore((s) => s.selectedFinish) as FinishId;
    // Subscribing to the retention state keeps the badges honest after a claim.
    useStore((s) => s.dailyRewardClaimIds);
    useStore((s) => s.dailyQuestClaimIds);

    const streakClaimable = !dailySystems.rewardView().claimed;
    const questsClaimable = dailySystems.quests().some((quest) => quest.claimable);

    const go = (screen: MenuScreen) => {
        audioManager.play("tap");
        store.patch({ menuScreen: screen });
    };

    const play = () => {
        // The first tap of a session is also the audio unlock gesture — every
        // browser requires one, and this is the only guaranteed one.
        void audioManager.unlock();
        audioManager.play("start");
        store.patch({ phase: "playing", overlay: "none" });
        void saveSystem.flush();
    };

    return (
        <main className="menu-shell">
            <div className="menu-top">
                <span className="pill">
                    <i className="pearl-glyph" aria-hidden="true" />
                    <b>{pearls.toLocaleString()}</b>
                </span>
                <span className="pill">DEEPEST · {highestLevel}</span>
            </div>

            <div className="menu-brand">
                <div className="menu-tiles-row" aria-hidden="true">
                    {HERO_TILES.map((kind) => (
                        <TilePreview key={kind} kind={kind} finish={finish} scale={3} />
                    ))}
                </div>
                <h1 className="menu-title">{GAME_NAME}</h1>
                <p className="menu-subtitle">{GAME_TAGLINE}</p>
            </div>

            <div className="menu-play">
                <button type="button" className="btn btn-primary" onClick={play}>
                    LEVEL {level}
                </button>
                <p className="menu-progress">
                    {level < highestLevel
                        ? `Replaying — deepest reached ${highestLevel}`
                        : "Tap a free tile to lift it"}
                </p>
            </div>

            <nav className="menu-grid" aria-label="Menu">
                <MenuTile label="Tasks" badge={questsClaimable} onClick={() => go("daily-quests")}>
                    <IconTasks />
                </MenuTile>
                <MenuTile label="Streak" badge={streakClaimable} onClick={() => go("daily-rewards")}>
                    <IconStreak />
                </MenuTile>
                <MenuTile label="Shop" onClick={() => go("shop")}>
                    <IconShop />
                </MenuTile>
                <MenuTile label="Options" onClick={() => go("settings")}>
                    <IconSettings />
                </MenuTile>
            </nav>

            <button type="button" className="btn btn-ghost menu-record" onClick={() => go("stats")}>
                <IconRecord />
                <span>YOUR RECORD</span>
            </button>
        </main>
    );
}

function MenuTile({
    label,
    badge,
    onClick,
    children,
}: {
    label: string;
    badge?: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button type="button" className="menu-tile" data-badge={badge ? "true" : undefined} onClick={onClick}>
            {children}
            <span>{label}</span>
        </button>
    );
}
