/**
 * DEEP SEA VITREUM — the art direction, in one file.
 *
 * The fiction: a drowned mahjong set, its tiles worn to frosted sea-glass and
 * lit from below by something bioluminescent. Everything is cool and dim
 * EXCEPT the tile faces, which are pale and warm-ish by comparison — that
 * contrast is the whole readability strategy, so resist tinting the faces
 * toward the background however tempting it looks in isolation.
 *
 * Colours are plain numbers so Pixi and Canvas2D can share them without
 * conversion. `css()` is the only place a `#rrggbb` string is made.
 */

export const PALETTE = {
    /** Backdrop, deepest to shallowest. */
    abyss: 0x03101a,
    deep: 0x072330,
    shelf: 0x0b3440,
    silt: 0x11454f,

    /** The felt the board rests on. */
    feltDark: 0x07242e,
    feltLight: 0x0e3b44,

    /** Tile body — frosted sea glass. */
    glassTop: 0xf1fbf7,
    glassBottom: 0xc3e0d9,
    glassRim: 0x8fbcb5,
    /** The extruded thickness under the face. */
    glassEdge: 0x6a9b98,
    glassEdgeDark: 0x47726f,

    /** Ink colours, one per suit. */
    inkPearl: 0x1c6a88,
    inkKelp: 0x2b7d59,
    inkFathom: 0x0d4a5e,
    inkCreature: 0xd94f75,

    /** Bioluminescence: selection, hints, particles. */
    lumen: 0x63f2da,
    lumenDim: 0x2fa79a,
    coral: 0xff7ea3,
    amber: 0xf3b45c,
    amberDeep: 0xc9873a,

    /** UI surfaces. */
    panel: 0x0d2e38,
    panelEdge: 0x1d5563,
    ink: 0xe8f6f2,
    inkSoft: 0x9dc2c0,
    danger: 0xff6b6b,
} as const;

export type PaletteColor = (typeof PALETTE)[keyof typeof PALETTE];

/** `0x1c6a88` -> `"#1c6a88"`. */
export function css(color: number, alpha = 1): string {
    const hex = `#${(color >>> 0).toString(16).padStart(6, "0")}`;
    if (alpha >= 1) return hex;
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Blend two colours. `amount` 0 returns `from`, 1 returns `to`. */
export function mix(from: number, to: number, amount: number): number {
    const t = Math.max(0, Math.min(1, amount));
    const r = Math.round(((from >> 16) & 0xff) * (1 - t) + ((to >> 16) & 0xff) * t);
    const g = Math.round(((from >> 8) & 0xff) * (1 - t) + ((to >> 8) & 0xff) * t);
    const b = Math.round((from & 0xff) * (1 - t) + (to & 0xff) * t);
    return (r << 16) | (g << 8) | b;
}

/** Ink for a suit. Kept here so tile art and UI legends cannot disagree. */
export const SUIT_INK: Readonly<Record<string, number>> = {
    pearl: PALETTE.inkPearl,
    kelp: PALETTE.inkKelp,
    fathom: PALETTE.inkFathom,
    creature: PALETTE.inkCreature,
};

/** The display face. Loaded in index.html; see `fontStack` for the fallback. */
export const DISPLAY_FONT = '"Marcellus", "Trajan Pro", Georgia, serif';
export const UI_FONT = '"Outfit", "Avenir Next", system-ui, sans-serif';
