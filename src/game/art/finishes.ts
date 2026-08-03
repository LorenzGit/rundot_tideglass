/**
 * Tile finishes — the game's only cosmetic, and its only paid content.
 *
 * A finish changes the GLASS, never the glyph: suit inks are fixed in
 * `palette.ts` so a tile is equally readable in every finish. That constraint is
 * what lets a finish be sold or earned without touching fairness — a player in
 * Abyssal sees exactly the same board as a player in Vitreum.
 */
import { PALETTE } from "./palette.ts";

export const FINISH_IDS = ["vitreum", "amber", "abyssal"] as const;
export type FinishId = (typeof FINISH_IDS)[number];

export interface Finish {
    id: FinishId;
    name: string;
    /** One line shown under the name in Settings. */
    detail: string;
    /** Face gradient, top to bottom. */
    top: number;
    bottom: number;
    rim: number;
    /** The extruded thickness. */
    edge: number;
    edgeDark: number;
    /** How strongly the frost streaks read, 0..1. */
    frost: number;
    /** Glyphs are re-inked only when the glass is too dark for the suit inks. */
    invertInk: boolean;
}

export const FINISHES: Readonly<Record<FinishId, Finish>> = {
    vitreum: {
        id: "vitreum",
        name: "VITREUM",
        detail: "Sea glass, worn smooth by forty years of tide.",
        top: PALETTE.glassTop,
        bottom: PALETTE.glassBottom,
        rim: PALETTE.glassRim,
        edge: PALETTE.glassEdge,
        edgeDark: PALETTE.glassEdgeDark,
        frost: 1,
        invertInk: false,
    },
    amber: {
        id: "amber",
        name: "AMBER",
        detail: "Lamp-glass from the wreck, still warm.",
        top: 0xfdf1dc,
        bottom: 0xe6c894,
        rim: 0xb99257,
        edge: 0xa9803f,
        edgeDark: 0x74562a,
        frost: 0.75,
        invertInk: false,
    },
    abyssal: {
        id: "abyssal",
        name: "ABYSSAL",
        detail: "Black glass that keeps the light it is given.",
        top: 0x1b3b45,
        bottom: 0x0a1f28,
        rim: 0x39707a,
        edge: 0x11333d,
        edgeDark: 0x061319,
        frost: 0.45,
        invertInk: true,
    },
};

export function finish(id: string): Finish {
    return FINISHES[id as FinishId] ?? FINISHES.vitreum;
}

export function isFinishId(value: unknown): value is FinishId {
    return typeof value === "string" && (FINISH_IDS as readonly string[]).includes(value);
}
