/**
 * A real tile, in the DOM.
 *
 * The menu, the how-to sheet and the finish picker all show tiles. They render
 * them through the SAME generator the board uses, so a change to the glass or a
 * glyph shows up everywhere at once and the marketing art can never disagree
 * with the game.
 */
import { useEffect, useRef } from "react";
import { cloneTileCanvas } from "../game/art/tileArt.ts";
import type { FinishId } from "../game/art/finishes.ts";
import { kindName, type TileKind } from "../game/mahjong/tiles.ts";

interface TilePreviewProps {
    kind: TileKind;
    finish?: FinishId;
    /** Device-pixel scale. 2 is right for everything at these sizes. */
    scale?: number;
    className?: string;
}

export default function TilePreview({ kind, finish = "vitreum", scale = 2, className }: TilePreviewProps) {
    const hostRef = useRef<HTMLSpanElement | null>(null);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        // Cloned: the cached canvas is shared, and a DOM node can only be in
        // one place at a time.
        const canvas = cloneTileCanvas(kind, scale, finish);
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", kindName(kind));
        host.replaceChildren(canvas);
        return () => host.replaceChildren();
    }, [kind, finish, scale]);

    return <span ref={hostRef} className={className} />;
}
