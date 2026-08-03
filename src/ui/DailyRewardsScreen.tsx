/**
 * The seven-day streak.
 *
 * The day boundary comes from RUN trusted time when the host provides it. It
 * says so on screen either way: a local-clock day is honest about being
 * non-authoritative rather than quietly pretending to be a server date.
 */
import { useState } from "react";
import { audioManager } from "../audio/audioManager.ts";
import { dailySystems } from "../systems/dailySystems.ts";
import { useStore, store } from "../state/store.ts";
import SubscreenLayout, { PearlPill } from "./SubscreenLayout.tsx";

const DAY_LABELS = ["1", "2", "3", "4", "5", "6", "7"] as const;

export default function DailyRewardsScreen() {
    const pearls = useStore((s) => s.pearls);
    useStore((s) => s.dailyRewardClaimIds);
    const streak = useStore((s) => s.dailyRewardStreak);
    const [busy, setBusy] = useState(false);
    const view = dailySystems.rewardView();

    const claim = async () => {
        setBusy(true);
        const result = await dailySystems.claimDailyReward();
        setBusy(false);
        if (result.ok) {
            audioManager.play("reward");
            store.patch({ toast: `+${result.pearls} PEARLS` });
        } else {
            audioManager.play("error");
            store.patch({ toast: result.reason });
        }
    };

    const currentDay = ((Math.max(1, view.streak) - 1) % 7) + 1;

    return (
        <SubscreenLayout title="STREAK" trailing={<PearlPill pearls={pearls} />}>
            <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
                <div className="reward-line" style={{ fontSize: "1.6rem", width: "100%" }}>
                    <i className="pearl-glyph" aria-hidden="true" />
                    <b>{view.reward}</b>
                </div>
                <p>
                    {view.claimed
                        ? `Claimed for today. Come back tomorrow for day ${((streak % 7) + 1).toString()}.`
                        : `Day ${currentDay} of the tide. Seven days running pays the most.`}
                </p>
                <button
                    type="button"
                    className="btn btn-primary"
                    disabled={view.claimed || !view.ready || busy}
                    onClick={() => void claim()}
                    style={{ width: "100%" }}
                >
                    {view.claimed ? "CLAIMED" : busy ? "CLAIMING…" : "CLAIM"}
                </button>
            </div>

            <div className="streak-row">
                {DAY_LABELS.map((label, index) => {
                    const day = index + 1;
                    const state = view.claimed && day <= currentDay ? "claimed" : day === currentDay ? "today" : "idle";
                    return (
                        <div className="streak-day" key={label} data-state={state}>
                            <span>DAY</span>
                            <b>{label}</b>
                        </div>
                    );
                })}
            </div>

            <p className="notice">{view.label}</p>
        </SubscreenLayout>
    );
}
