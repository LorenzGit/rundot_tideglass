/**
 * The shell every subscreen renders inside: a back control, a title, and a
 * scroll region that the visual-QA harness knows how to photograph to the end.
 */
import type { ReactNode } from "react";
import { audioManager } from "../audio/audioManager.ts";
import { saveSystem } from "../systems/save.ts";
import { store } from "../state/store.ts";
import { IconBack } from "./icons.tsx";

export default function SubscreenLayout({
    title,
    trailing,
    children,
}: {
    title: string;
    trailing?: ReactNode;
    children: ReactNode;
}) {
    const back = () => {
        audioManager.play("tap");
        store.patch({ menuScreen: "main" });
        void saveSystem.flush();
    };

    return (
        <main className="subscreen">
            <div className="subscreen-header">
                <button type="button" className="icon-button" onClick={back} aria-label="Back">
                    <IconBack />
                </button>
                <h2>{title}</h2>
                {trailing}
            </div>
            <div className="subscreen-content" data-testid="screen-scroll-region">
                {children}
            </div>
        </main>
    );
}

export function PearlPill({ pearls }: { pearls: number }) {
    return (
        <span className="pill">
            <i className="pearl-glyph" aria-hidden="true" />
            <b>{pearls.toLocaleString()}</b>
        </span>
    );
}
