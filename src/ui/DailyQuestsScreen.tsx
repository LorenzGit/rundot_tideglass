/**
 * Three daily tasks, reset on the trusted-time day boundary.
 *
 * Tasks describe things a player does anyway — match pairs, clear levels, build
 * a combo — so nothing here pushes a session in a direction the player did not
 * already want to go.
 */
import { useState } from "react";
import { audioManager } from "../audio/audioManager.ts";
import { dailySystems } from "../systems/dailySystems.ts";
import { saveSystem } from "../systems/save.ts";
import { store, useStore } from "../state/store.ts";
import SubscreenLayout, { PearlPill } from "./SubscreenLayout.tsx";

export default function DailyQuestsScreen() {
    const pearls = useStore((s) => s.pearls);
    useStore((s) => s.dailyQuestProgress);
    useStore((s) => s.dailyQuestClaimIds);
    const [busy, setBusy] = useState<string | null>(null);
    const quests = dailySystems.quests();
    const gate = dailySystems.timeGate();

    const claim = async (questId: string) => {
        setBusy(questId);
        const result = await dailySystems.claimQuest(questId);
        setBusy(null);
        if (result.ok) {
            audioManager.play("reward");
            store.patch({ toast: `+${result.pearls} PEARLS` });
            void saveSystem.flush();
        } else {
            audioManager.play("error");
            store.patch({ toast: result.reason });
        }
    };

    return (
        <SubscreenLayout title="DAILY TASKS" trailing={<PearlPill pearls={pearls} />}>
            {quests.map((quest) => {
                const ratio = Math.min(1, quest.value / quest.target);
                return (
                    <div className="card" key={quest.id}>
                        <div className="card-head">
                            <h3>{quest.label}</h3>
                            <span className="card-price">+{quest.reward}</span>
                        </div>
                        <div className="progress-track">
                            <i style={{ width: `${Math.round(ratio * 100)}%` }} />
                        </div>
                        <div className="quest-foot">
                            <span>
                                {Math.min(quest.value, quest.target)} / {quest.target}
                            </span>
                            <button
                                type="button"
                                className={quest.claimable ? "btn btn-amber" : "btn btn-ghost"}
                                disabled={!quest.claimable || busy !== null}
                                onClick={() => void claim(quest.id)}
                                style={{ padding: "0.45rem 1rem" }}
                            >
                                {quest.claimed ? "CLAIMED" : quest.claimable ? "CLAIM" : "IN PROGRESS"}
                            </button>
                        </div>
                    </div>
                );
            })}
            <p className="notice">Tasks reset each day. {gate.label}</p>
        </SubscreenLayout>
    );
}
