/**
 * Line icons, inline. No icon font and no sprite sheet: a handful of paths is
 * smaller than either, and they inherit `stroke: currentColor` from the CSS
 * that positions them.
 *
 * The set is drawn to the game's fiction, not to a generic UI kit: menu lines
 * ripple, the settings control is a ship's helm, the shop is a chest from the
 * wreck, and the hint is a lit lantern. Small filled accents opt out of the
 * inherited stroke with their own `fill`/`stroke` attributes.
 */
import type { JSX, ReactNode } from "react";

/**
 * Every icon is decorative: the control around it carries the accessible name,
 * so the glyph is hidden from assistive technology rather than given a title
 * that would be read out twice.
 */
function Glyph({ children }: { children: ReactNode }): JSX.Element {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            {children}
        </svg>
    );
}

/** Back: a chevron with a hint of current in its curve. */
export function IconBack(): JSX.Element {
    return (
        <Glyph>
            <path d="M15 5c-3.1 1.9-5.4 4.2-6.9 7 1.5 2.8 3.8 5.1 6.9 7" />
        </Glyph>
    );
}

/** Menu: three ripples, not three bars. */
export function IconMenu(): JSX.Element {
    return (
        <Glyph>
            <path d="M4 7.2c2.7-1.5 5.3-1.5 8 0s5.3 1.5 8 0" />
            <path d="M4 12c2.7-1.5 5.3-1.5 8 0s5.3 1.5 8 0" />
            <path d="M4 16.8c2.7-1.5 5.3-1.5 8 0s5.3 1.5 8 0" />
        </Glyph>
    );
}

/** Hint: a lit lantern, pearl inside, light spilling out. */
export function IconHint(): JSX.Element {
    return (
        <Glyph>
            <path d="M12 4.4a4.4 4.4 0 0 0-4.4 4.4c0 1.8.9 2.9 1.7 3.8.5.6.8 1 .8 1.4h3.8c0-.4.3-.8.8-1.4.8-.9 1.7-2 1.7-3.8A4.4 4.4 0 0 0 12 4.4Z" />
            <path d="M10.2 17h3.6M10.8 19.8h2.4" />
            <path d="M12 1v1.5M5.4 3.7l1.1 1.1M18.6 3.7l-1.1 1.1M2.9 9.6h1.5M19.6 9.6h1.5" opacity="0.65" />
            <circle cx="12" cy="8.8" r="1.25" fill="currentColor" stroke="none" opacity="0.9" />
        </Glyph>
    );
}

/** Undo: the current curling back on itself. */
export function IconUndo(): JSX.Element {
    return (
        <Glyph>
            <path d="M3.5 12a8.5 8.5 0 1 0 8.5-8.5c-2.5 0-4.8 1.1-6.4 2.7L3.5 8.3" />
            <path d="M3.5 3.5v4.8h4.8" />
        </Glyph>
    );
}

/** Shuffle: two currents crossing and swapping lanes. */
export function IconShuffle(): JSX.Element {
    return (
        <Glyph>
            <path d="M3 7.5h2c3 0 4.4 1.7 5.9 4.5s2.9 4.5 5.9 4.5H19" />
            <path d="M3 16.5h2c3 0 4.4-1.7 5.9-4.5S13.8 7.5 16.8 7.5H19" />
            <path d="m17 4.8 2.7 2.7L17 10.2M17 13.8l2.7 2.7L17 19.2" opacity="0.85" />
        </Glyph>
    );
}

export function IconLock(): JSX.Element {
    return (
        <Glyph>
            <rect x="5" y="10" width="14" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            <path d="M12 13.6v2.8" opacity="0.8" />
        </Glyph>
    );
}

/** Tasks: the expedition log, one entry sounded and struck through. */
export function IconTasks(): JSX.Element {
    return (
        <Glyph>
            <rect x="4" y="4.6" width="16" height="16.4" rx="2.2" />
            <rect x="9" y="2.4" width="6" height="3.6" rx="1.4" />
            <path d="m7.8 11.6 2.5 2.5 5.6-5.6" />
            <path d="M8 17.4h5.4" opacity="0.75" />
        </Glyph>
    );
}

/** Streak: a droplet holding its own small tide. */
export function IconStreak(): JSX.Element {
    return (
        <Glyph>
            <path d="M12 3c3 3.5 5 6 5 9a5 5 0 0 1-10 0c0-3 2-5.5 5-9Z" />
            <path d="M9.3 12.6a2.8 2.8 0 0 0 2 3" opacity="0.75" />
        </Glyph>
    );
}

/** Shop: the chest from the wreck. */
export function IconShop(): JSX.Element {
    return (
        <Glyph>
            <path d="M3.6 10.6V9.2a5.6 5.6 0 0 1 5.6-5.6h5.6a5.6 5.6 0 0 1 5.6 5.6v1.4" />
            <rect x="3.6" y="10.6" width="16.8" height="9" rx="1.8" />
            <path d="M12 10.6v2.2" />
            <circle cx="12" cy="15" r="1.4" />
            <path d="M12 16.4v1.4" opacity="0.8" />
        </Glyph>
    );
}

/** Settings: the ship's helm. */
export function IconSettings(): JSX.Element {
    return (
        <Glyph>
            <circle cx="12" cy="12" r="6" />
            <circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none" opacity="0.9" />
            <path d="M12 3.1v3M12 17.9v3M3.1 12h3M17.9 12h3" />
            <path d="m5.7 5.7 2.1 2.1M16.2 16.2l2.1 2.1M18.3 5.7l-2.1 2.1M7.8 16.2l-2.1 2.1" />
        </Glyph>
    );
}

/** Record: soundings on the depth chart. */
export function IconRecord(): JSX.Element {
    return (
        <Glyph>
            <path d="M5 18.4v-7.4M12 18.4V4.6M19 18.4v-5.4" />
            <path d="M4 21.2h16" opacity="0.6" />
        </Glyph>
    );
}

export function IconPlay(): JSX.Element {
    return (
        <Glyph>
            <path d="M8 5.5 18 12 8 18.5Z" />
        </Glyph>
    );
}

export function IconVideo(): JSX.Element {
    return (
        <Glyph>
            <rect x="3" y="6" width="12" height="12" rx="2" />
            <path d="m15 11 6-3.5v9L15 13Z" />
        </Glyph>
    );
}
