/**
 * The Tideglass tile set: 36 kinds x 4 copies = 144 tiles, the classic Mahjong
 * count. Two tiles match only when they are the SAME kind — there is no
 * "flower group" wildcard, because the tray mechanic already supplies all the
 * forgiveness this game needs and a group match would make the tray unreadable.
 *
 * Suits are the sea's four registers, and they map onto the classic suits so
 * the shapes stay legible to anyone who has played Mahjong before:
 *
 *   pearl    (circles) — bubbles/pearls in the classic dot arrangements
 *   kelp     (bamboo)  — vertical kelp strands
 *   fathom   (characters) — depth marks in a carved numeral script
 *   creature (honours) — nine sea animals, the illustrated tiles
 */

export const SUITS = ["pearl", "kelp", "fathom", "creature"] as const;
export type Suit = (typeof SUITS)[number];

/** Ranks run 1..9 in every suit, so a kind is fully described by suit+rank. */
export const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type Rank = (typeof RANKS)[number];

/** A tile kind, encoded as a small integer 0..35 for cheap comparison. */
export type TileKind = number;

export const KIND_COUNT = SUITS.length * RANKS.length;
export const COPIES_PER_KIND = 4;
export const FULL_SET_SIZE = KIND_COUNT * COPIES_PER_KIND;

export function makeKind(suit: Suit, rank: Rank): TileKind {
    return SUITS.indexOf(suit) * RANKS.length + (rank - 1);
}

export function kindSuit(kind: TileKind): Suit {
    return SUITS[Math.floor(kind / RANKS.length)] ?? "pearl";
}

export function kindRank(kind: TileKind): Rank {
    return ((kind % RANKS.length) + 1) as Rank;
}

/** Every kind, in a stable order. Used by generators and the art preview. */
export const ALL_KINDS: readonly TileKind[] = Array.from({ length: KIND_COUNT }, (_, index) => index);

/** The nine creatures, in rank order. Rank is only an identity here. */
export const CREATURES = [
    "nautilus",
    "jellyfish",
    "seahorse",
    "ray",
    "octopus",
    "crab",
    "anemone",
    "starfish",
    "turtle",
] as const;
export type Creature = (typeof CREATURES)[number];

export function kindCreature(kind: TileKind): Creature | null {
    return kindSuit(kind) === "creature" ? (CREATURES[kindRank(kind) - 1] ?? null) : null;
}

const SUIT_LABEL: Readonly<Record<Suit, string>> = {
    pearl: "Pearl",
    kelp: "Kelp",
    fathom: "Fathom",
    creature: "",
};

const CREATURE_LABEL: Readonly<Record<Creature, string>> = {
    nautilus: "Nautilus",
    jellyfish: "Jellyfish",
    seahorse: "Seahorse",
    ray: "Ray",
    octopus: "Octopus",
    crab: "Crab",
    anemone: "Anemone",
    starfish: "Starfish",
    turtle: "Turtle",
};

/** Human-readable name, used by accessibility labels and daily-task copy. */
export function kindName(kind: TileKind): string {
    const creature = kindCreature(kind);
    if (creature) return CREATURE_LABEL[creature];
    return `${SUIT_LABEL[kindSuit(kind)]} ${kindRank(kind)}`;
}
