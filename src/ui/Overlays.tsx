/**
 * The modals stacked over the board: results, a full tray, pause, and how to
 * play.
 *
 * The rewarded-video offers live here. Both follow the same rule — the button
 * appears only when the placement is genuinely eligible, and nothing is granted
 * until the SDK confirms the video actually completed. A player who declines,
 * or whose host has no fill, loses nothing they had.
 */
import { useState } from "react";
import { audioManager } from "../audio/audioManager.ts";
import { ART } from "../assets/art/index.ts";
import { activeController } from "../game/gameController.ts";
import { makeKind } from "../game/mahjong/tiles.ts";
import { formatDuration } from "../systems/economy.ts";
import { saveSystem } from "../systems/save.ts";
import { runtimeServices } from "../systems/runtimeServices.ts";
import { store, useStore } from "../state/store.ts";
import TilePreview from "./TilePreview.tsx";
import { IconVideo } from "./icons.tsx";

export default function Overlays() {
    const hostPaused = useStore((s) => s.paused);
    const overlay = useStore((s) => s.overlay);
    if (hostPaused) return <HostPauseOverlay />;
    if (overlay === "none") return null;
    if (overlay === "won" || overlay === "lost") return <ResultsOverlay />;
    if (overlay === "paused") return <PauseOverlay />;
    if (overlay === "howto") return <HowToOverlay />;
    return null;
}

function HostPauseOverlay() {
    return (
        <button
            type="button"
            className="overlay host-pause-overlay"
            onClick={() => {
                store.patch({ paused: false });
                audioManager.setPaused(false);
                runtimeServices.resume();
            }}
        >
            <span>
                <strong>PAUSED</strong>
                <small>TAP TO RESUME</small>
            </span>
        </button>
    );
}

/** Headline for a cleared level. Deeper boards earn a bigger word. */
function verdict(bestCombo: number, cleared: boolean): string {
    if (!cleared) return "THE TRAY IS FULL";
    if (bestCombo >= 9) return "UNCANNY";
    if (bestCombo >= 6) return "KEEN EYE";
    if (bestCombo >= 3) return "WELL READ";
    return "BOARD CLEARED";
}

function ResultsOverlay() {
    const result = useStore((s) => s.lastResult);
    const [busy, setBusy] = useState(false);
    const [doubled, setDoubled] = useState(false);
    const controller = activeController();
    if (!result) return null;

    const canDouble = !doubled && controller?.canDoublePearls() === true;
    const canSecondWind = controller?.canTakeSecondWind() === true;
    // Shown but inert outside a host, so the offer is reviewable in development
    // without ever being able to grant anything.
    const doublePreview = !doubled && !canDouble && controller?.doublePearlsIsPreview() === true;
    const secondWindPreview = !canSecondWind && controller?.secondWindIsPreview() === true;

    const watchForPearls = async () => {
        setBusy(true);
        const granted = (await controller?.doublePearls()) ?? false;
        setDoubled(granted);
        setBusy(false);
    };

    const watchForSecondWind = async () => {
        setBusy(true);
        await controller?.takeSecondWind();
        setBusy(false);
    };

    return (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Level results">
            {/*
             * The herald is a SIBLING of the card, not a child: the card scrolls
             * its own overflow, so a child hanging off the top by a negative
             * margin gets clipped exactly where the artwork matters most.
             */}
            <div className="overlay-stage">
                {result.cleared && <img className="overlay-herald" src={ART.lanternJelly} alt="" aria-hidden="true" />}
                <div className="overlay-card">
                    <h2 className={`overlay-title ${result.cleared ? "win" : "lose"}`}>
                        {verdict(result.bestCombo, result.cleared)}
                    </h2>
                    <p className="overlay-subtitle">
                        {result.cleared
                            ? `Level ${result.level} cleared${result.newBest ? " · new best score" : ""}`
                            : `Level ${result.level} — no room left to hold a tile`}
                    </p>

                    <div className="stat-row">
                        <div className="stat">
                            <b>{formatDuration(result.timeMs)}</b>
                            <span>Time</span>
                        </div>
                        <div className="stat">
                            <b>{result.score.toLocaleString()}</b>
                            <span>Score</span>
                        </div>
                        <div className="stat">
                            <b>×{result.bestCombo}</b>
                            <span>Best combo</span>
                        </div>
                    </div>

                    {result.cleared && (
                        <div className="breakdown">
                            <div>
                                <span>Matches</span>
                                <b>{result.matches}</b>
                            </div>
                            <div>
                                <span>Under par</span>
                                <b>+{result.timeBonus.toLocaleString()}</b>
                            </div>
                            <div>
                                <span>Tools unspent</span>
                                <b>+{result.toolBonus.toLocaleString()}</b>
                            </div>
                            <div className="total">
                                <span>Total</span>
                                <b>{result.score.toLocaleString()}</b>
                            </div>
                        </div>
                    )}

                    <div className="reward-line">
                        <i className="pearl-glyph" aria-hidden="true" />
                        <span>
                            {result.pearlsEarned.toLocaleString()} pearls{doubled ? " (doubled)" : ""}
                        </span>
                    </div>

                    <div className="overlay-actions">
                        {(canDouble || doublePreview) && (
                            <button
                                type="button"
                                className="btn btn-amber btn-video"
                                disabled={busy || doublePreview}
                                onClick={watchForPearls}
                            >
                                <IconVideo />
                                <span>{doublePreview ? "DOUBLE THE PEARLS · PREVIEW" : "DOUBLE THE PEARLS"}</span>
                            </button>
                        )}
                        {(canSecondWind || secondWindPreview) && (
                            <button
                                type="button"
                                className="btn btn-amber btn-video"
                                disabled={busy || secondWindPreview}
                                onClick={watchForSecondWind}
                            >
                                <IconVideo />
                                <span>{secondWindPreview ? "SECOND WIND · PREVIEW" : "SECOND WIND — TAKE 3 BACK"}</span>
                            </button>
                        )}
                        <button
                            type="button"
                            className="btn btn-primary"
                            disabled={busy}
                            onClick={() => {
                                audioManager.play("tap");
                                controller?.continueFromResults();
                            }}
                        >
                            {result.cleared ? `LEVEL ${result.level + 1}` : "TRY AGAIN"}
                        </button>
                        <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={busy}
                            onClick={() => {
                                audioManager.play("tap");
                                controller?.leaveToMenu();
                            }}
                        >
                            BACK TO THE SURFACE
                        </button>
                    </div>
                    {(canDouble || canSecondWind || doublePreview || secondWindPreview) && (
                        <p className="ad-note">
                            {doublePreview || secondWindPreview
                                ? "Preview only — no ad host is attached in local development."
                                : "Videos are optional and never required to finish a level."}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}

function PauseOverlay() {
    const controller = activeController();
    const close = () => {
        audioManager.play("tap");
        store.patch({ overlay: "none" });
    };
    return (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Paused">
            <div className="overlay-card">
                <h2 className="overlay-title">PAUSED</h2>
                <div className="overlay-actions">
                    <button type="button" className="btn btn-primary" onClick={close}>
                        RESUME
                    </button>
                    <button
                        type="button"
                        className="btn"
                        onClick={() => {
                            audioManager.play("tap");
                            store.patch({ overlay: "howto" });
                        }}
                    >
                        HOW TO PLAY
                    </button>
                    <button
                        type="button"
                        className="btn"
                        onClick={() => {
                            audioManager.play("tap");
                            store.patch({ overlay: "none", phase: "menu", menuScreen: "settings" });
                            void saveSystem.flush();
                        }}
                    >
                        OPTIONS
                    </button>
                    <button
                        type="button"
                        className="btn"
                        onClick={() => {
                            store.patch({ overlay: "none" });
                            controller?.restartLevel();
                        }}
                    >
                        RESTART LEVEL
                    </button>
                    <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                            audioManager.play("tap");
                            controller?.leaveToMenu();
                        }}
                    >
                        BACK TO THE SURFACE
                    </button>
                </div>
            </div>
        </div>
    );
}

export function HowToOverlay() {
    const finish = useStore((s) => s.selectedFinish);
    const back = () => {
        audioManager.play("tap");
        store.patch({ overlay: store.get().phase === "playing" ? "paused" : "none" });
    };
    return (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="How to play">
            <div className="overlay-card">
                <h2 className="overlay-title">HOW TO PLAY</h2>

                <div className="howto-step">
                    <TilePreview kind={makeKind("creature", 5)} finish={finish as never} />
                    <p>
                        Tap any tile that is <b>not covered</b> and has a free left or right side. It lifts into the
                        tray at the top.
                    </p>
                </div>
                <div className="howto-step">
                    <TilePreview kind={makeKind("pearl", 3)} finish={finish as never} />
                    <p>
                        Two of the <b>same tile</b> in the tray shatter and score. Match quickly and the combo carries.
                    </p>
                </div>
                <div className="howto-step">
                    <TilePreview kind={makeKind("kelp", 7)} finish={finish as never} />
                    <p>
                        Fill every tray slot without a match and the level ends. Undo, hint and shuffle are there to
                        stop that.
                    </p>
                </div>

                <div className="suit-legend">
                    <div>
                        <TilePreview kind={makeKind("pearl", 4)} finish={finish as never} />
                        <small>Pearl</small>
                    </div>
                    <div>
                        <TilePreview kind={makeKind("kelp", 4)} finish={finish as never} />
                        <small>Kelp</small>
                    </div>
                    <div>
                        <TilePreview kind={makeKind("fathom", 4)} finish={finish as never} />
                        <small>Fathom</small>
                    </div>
                    <div>
                        <TilePreview kind={makeKind("creature", 4)} finish={finish as never} />
                        <small>Creature</small>
                    </div>
                </div>

                <p className="notice">
                    Every board is dealt so it can be finished. Nothing you buy changes a tile, a layout, or a score.
                </p>

                <button type="button" className="btn btn-primary" onClick={back}>
                    GOT IT
                </button>
            </div>
        </div>
    );
}
