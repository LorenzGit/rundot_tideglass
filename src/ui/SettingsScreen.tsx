/**
 * Options: audio, motion, haptics, notifications, the tile finish, and the
 * rules.
 *
 * Every control writes through the store and flushes the save immediately, so a
 * setting a player changes is a setting that survives the next reload — which
 * the visual-QA harness asserts by reloading the page.
 */
import { audioManager } from "../audio/audioManager.ts";
import { FINISH_IDS, FINISHES, type FinishId } from "../game/art/finishes.ts";
import { activeController } from "../game/gameController.ts";
import { finishIsOwned } from "../systems/commerce.ts";
import { AMBER_FINISH_COST } from "../systems/economy.ts";
import { saveSystem } from "../systems/save.ts";
import { setNotificationPreference } from "../sdk/runSdk.ts";
import { store, useStore } from "../state/store.ts";
import SubscreenLayout, { PearlPill } from "./SubscreenLayout.tsx";
import TilePreview from "./TilePreview.tsx";
import { makeKind } from "../game/mahjong/tiles.ts";

const SAMPLE = makeKind("creature", 9);

export default function SettingsScreen() {
    const state = useStore();

    const set = (patch: Parameters<typeof store.patch>[0]) => {
        store.patch(patch);
        void saveSystem.flush();
    };

    const toggleNotifications = async () => {
        const next = !state.notificationsEnabled;
        const result = await setNotificationPreference(next);
        if (result === "enabled") set({ notificationsEnabled: true, notificationsConsent: "granted" });
        else if (result === "disabled") set({ notificationsEnabled: false, notificationsConsent: "denied" });
        else store.patch({ toast: "NOTIFICATIONS ARE NOT AVAILABLE HERE" });
    };

    const chooseFinish = (id: FinishId) => {
        if (finishIsOwned(id)) {
            audioManager.play("tap");
            set({ selectedFinish: id });
            return;
        }
        if (id === "amber") {
            if (state.pearls < AMBER_FINISH_COST) {
                audioManager.play("error");
                store.patch({ toast: `AMBER COSTS ${AMBER_FINISH_COST.toLocaleString()} PEARLS` });
                return;
            }
            audioManager.play("reward");
            set({
                pearls: state.pearls - AMBER_FINISH_COST,
                ownedFinishes: [...state.ownedFinishes, "amber"],
                selectedFinish: "amber",
            });
            return;
        }
        audioManager.play("error");
        store.patch({ toast: "ABYSSAL COMES WITH THE DEEPWATER BUNDLE" });
    };

    return (
        <SubscreenLayout title="OPTIONS" trailing={<PearlPill pearls={state.pearls} />}>
            <Toggle
                label="Music"
                detail="A slow tide under the board"
                on={state.musicEnabled}
                onChange={(on) => set({ musicEnabled: on })}
            />
            <Slider
                label="Music volume"
                value={state.musicVolume}
                onChange={(value) => set({ musicVolume: value })}
                disabled={!state.musicEnabled}
            />
            <Toggle
                label="Sound"
                detail="Glass, water and shards"
                on={state.sfxEnabled}
                onChange={(on) => {
                    set({ sfxEnabled: on });
                    if (on) audioManager.play("match");
                }}
            />
            <Slider
                label="Sound volume"
                value={state.sfxVolume}
                onChange={(value) => set({ sfxVolume: value })}
                disabled={!state.sfxEnabled}
            />
            <Toggle
                label="Haptics"
                detail="A tap on match and on a blocked tile"
                on={state.hapticsEnabled}
                onChange={(on) => set({ hapticsEnabled: on })}
            />
            <Toggle
                label="Reduced motion"
                detail="Tiles move directly; feedback stays"
                on={state.reducedMotion}
                onChange={(on) => {
                    set({ reducedMotion: on });
                    document.documentElement.dataset.reducedMotion = String(on);
                    activeController()?.setReducedMotion(on);
                }}
            />
            <Toggle
                label="Notifications"
                detail="A nudge when the daily streak is ready"
                on={state.notificationsEnabled}
                onChange={() => void toggleNotifications()}
            />

            <div className="card">
                <div className="card-head">
                    <h3>TILE FINISH</h3>
                </div>
                <p>The glass only. Every finish reads the same on the board.</p>
                <div className="finish-row">
                    {FINISH_IDS.map((id) => {
                        const owned = finishIsOwned(id);
                        return (
                            <button
                                type="button"
                                key={id}
                                className="finish"
                                data-selected={state.selectedFinish === id ? "true" : "false"}
                                data-owned={owned ? "true" : "false"}
                                onClick={() => chooseFinish(id)}
                            >
                                <TilePreview kind={SAMPLE} finish={id} />
                                <strong>{FINISHES[id].name}</strong>
                                <small>
                                    {owned
                                        ? state.selectedFinish === id
                                            ? "IN USE"
                                            : "OWNED"
                                        : id === "amber"
                                          ? `${AMBER_FINISH_COST.toLocaleString()} ◦`
                                          : "BUNDLE"}
                                </small>
                            </button>
                        );
                    })}
                </div>
            </div>

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

            <p className="notice">
                Progress is stored with your RUN profile when the host provides one, and in this browser otherwise.
            </p>
        </SubscreenLayout>
    );
}

function Toggle({
    label,
    detail,
    on,
    onChange,
}: {
    label: string;
    detail: string;
    on: boolean;
    onChange: (on: boolean) => void;
}) {
    return (
        <div className="setting-row">
            <div>
                <strong>{label}</strong>
                <small>{detail}</small>
            </div>
            <button
                type="button"
                className="toggle"
                role="switch"
                aria-checked={on}
                aria-label={label}
                data-on={on ? "true" : "false"}
                onClick={() => onChange(!on)}
            />
        </div>
    );
}

function Slider({
    label,
    value,
    onChange,
    disabled,
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    disabled?: boolean;
}) {
    return (
        <div className="setting-row">
            <div>
                <strong>{label}</strong>
                <small>{Math.round(value * 100)}%</small>
            </div>
            <input
                className="slider"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={value}
                disabled={disabled}
                aria-label={label}
                onChange={(event) => onChange(Number(event.target.value))}
            />
        </div>
    );
}
