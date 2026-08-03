/**
 * In-board HUD: a React overlay above the Pixi canvas.
 *
 * The overlay is pointer-events-none so taps fall through to the board; each
 * control opts back in. Everything shown here is mirrored from the store by the
 * controller — the HUD never queries the engine.
 *
 * A tool with no charges left shows its PEARL PRICE instead of a dead button.
 * A disabled control that says nothing is the fastest way to make a player think
 * the game is broken.
 */
import { audioManager } from "../audio/audioManager.ts";
import { activeController } from "../game/gameController.ts";
import { SHUFFLE_UNLOCK_LEVEL } from "../game/mahjong/levels.ts";
import { TOOL_PRICES, type ToolId } from "../systems/economy.ts";
import { store, useStore } from "../state/store.ts";
import { IconBack, IconHint, IconLock, IconMenu, IconShuffle, IconUndo } from "./icons.tsx";

export default function Hud() {
    const score = useStore((s) => s.score);
    const combo = useStore((s) => s.combo);
    const remaining = useStore((s) => s.tilesRemaining);
    const total = useStore((s) => s.tilesTotal);
    const level = useStore((s) => s.level);
    const tools = useStore((s) => s.tools);
    const pearls = useStore((s) => s.pearls);
    const shuffleUnlocked = useStore((s) => s.shuffleUnlocked);
    const overlay = useStore((s) => s.overlay);

    const leave = () => {
        audioManager.play("tap");
        activeController()?.leaveToMenu();
    };

    const pause = () => {
        audioManager.play("tap");
        store.patch({ overlay: "paused" });
    };

    // The overlays own the screen while they are up; a live HUD underneath
    // would let a player spend a tool on a finished board.
    const interactive = overlay === "none";

    return (
        <div className="hud">
            <div>
                <div className="hud-top">
                    <button
                        type="button"
                        className="icon-button"
                        onClick={leave}
                        aria-label="Back to menu"
                        disabled={!interactive}
                    >
                        <IconBack />
                    </button>
                    <div className="hud-score" role="status" aria-label={`Score ${score}`}>
                        <b>{score.toLocaleString()}</b>
                        <span>Level {level}</span>
                    </div>
                    <button
                        type="button"
                        className="icon-button"
                        onClick={pause}
                        aria-label="Options"
                        disabled={!interactive}
                    >
                        <IconMenu />
                    </button>
                </div>
                <div className="hud-meta">
                    <span className="pill">
                        {remaining}/{total} TILES
                    </span>
                    {combo >= 2 && <span className="pill hud-combo">COMBO ×{combo}</span>}
                    <span className="pill">
                        <i className="pearl-glyph" aria-hidden="true" />
                        {pearls.toLocaleString()}
                    </span>
                </div>
            </div>

            <div className="toolbar">
                <Tool
                    id="shuffles"
                    label="Shuffle"
                    charges={tools.shuffles}
                    locked={!shuffleUnlocked}
                    lockLabel={`Lv. ${SHUFFLE_UNLOCK_LEVEL}`}
                    interactive={interactive}
                    onUse={() => activeController()?.spendShuffle()}
                >
                    <IconShuffle />
                </Tool>
                <Tool
                    id="hints"
                    label="Hint"
                    charges={tools.hints}
                    interactive={interactive}
                    onUse={() => activeController()?.spendHint()}
                >
                    <IconHint />
                </Tool>
                <Tool
                    id="undos"
                    label="Undo"
                    charges={tools.undos}
                    interactive={interactive}
                    onUse={() => activeController()?.spendUndo()}
                >
                    <IconUndo />
                </Tool>
            </div>
        </div>
    );
}

function Tool({
    id,
    label,
    charges,
    locked = false,
    lockLabel,
    interactive,
    onUse,
    children,
}: {
    id: ToolId;
    label: string;
    charges: number;
    locked?: boolean;
    lockLabel?: string;
    interactive: boolean;
    onUse: () => void;
    children: React.ReactNode;
}) {
    const price = TOOL_PRICES[id];
    const empty = charges <= 0;
    const pearls = useStore((s) => s.pearls);
    const affordable = pearls >= price;

    const press = () => {
        if (locked) {
            store.patch({ toast: `SHUFFLE UNLOCKS AT LEVEL ${SHUFFLE_UNLOCK_LEVEL}` });
            audioManager.play("error");
            return;
        }
        // Out of charges: the same button buys one, so the player never has to
        // leave the board to keep playing.
        if (empty) {
            if (activeController()?.buyTool(id)) onUse();
            return;
        }
        onUse();
    };

    return (
        <button
            type="button"
            className="tool"
            onClick={press}
            disabled={!interactive || (empty && !affordable && !locked)}
            aria-label={
                locked
                    ? `${label}, locked until level ${SHUFFLE_UNLOCK_LEVEL}`
                    : empty
                      ? `Buy a ${label} for ${price} pearls`
                      : `${label}, ${charges} left`
            }
        >
            <span className="tool-well">{children}</span>
            {locked ? (
                <span className="tool-lock">
                    <IconLock />
                </span>
            ) : (
                <span className="tool-badge" data-empty={empty ? "true" : undefined}>
                    {empty ? price : charges}
                </span>
            )}
            <small>{locked ? lockLabel : label}</small>
        </button>
    );
}
