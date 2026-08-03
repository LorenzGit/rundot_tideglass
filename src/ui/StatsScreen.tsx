/**
 * The player's record, plus an honest readout of which platform services are
 * actually attached. In local development that panel is the fastest way to see
 * why a shop or streak surface is behaving the way it is.
 */
import { getRunCapabilities } from "../sdk/runSdk.ts";
import { entitlementsReady } from "../systems/commerce.ts";
import { useStore } from "../state/store.ts";
import SubscreenLayout, { PearlPill } from "./SubscreenLayout.tsx";

export default function StatsScreen() {
    const state = useStore();
    const capabilities = getRunCapabilities();

    return (
        <SubscreenLayout title="YOUR RECORD" trailing={<PearlPill pearls={state.pearls} />}>
            <div className="stat-row">
                <div className="stat">
                    <b>{state.highestLevel}</b>
                    <span>Deepest level</span>
                </div>
                <div className="stat">
                    <b>{state.levelsCleared}</b>
                    <span>Levels cleared</span>
                </div>
                <div className="stat">
                    <b>{state.bestScore.toLocaleString()}</b>
                    <span>Best score</span>
                </div>
            </div>

            <div className="card">
                <div className="card-head">
                    <h3>ALL TIME</h3>
                </div>
                <div className="breakdown">
                    <div>
                        <span>Boards started</span>
                        <b>{state.totalPlays}</b>
                    </div>
                    <div>
                        <span>Pearls in hand</span>
                        <b>{state.pearls.toLocaleString()}</b>
                    </div>
                    <div className="total">
                        <span>Clear rate</span>
                        <b>
                            {state.totalPlays > 0
                                ? `${Math.round((state.levelsCleared / state.totalPlays) * 100)}%`
                                : "—"}
                        </b>
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="card-head">
                    <h3>PLATFORM</h3>
                </div>
                <div className="breakdown">
                    <Row label="RUN host" value={capabilities.host ? (capabilities.mock ? "mock" : "attached") : "—"} />
                    <Row label="Cloud save" value={capabilities.storage ? "on" : "this browser only"} />
                    <Row label="Trusted time" value={state.trustedTimeReady ? "on" : "local clock"} />
                    <Row label="Shop" value={capabilities.shop ? "on" : "—"} />
                    <Row label="Ownership" value={entitlementsReady() ? "verified" : "not read"} />
                    <Row label="Ads" value={capabilities.ads ? "on" : "—"} />
                </div>
            </div>

            <p className="notice">
                Anything reading “—” is a service this host does not offer. The game stays fully playable without it;
                only the surfaces that depend on it are hidden.
            </p>
        </SubscreenLayout>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <span>{label}</span>
            <b>{value}</b>
        </div>
    );
}
