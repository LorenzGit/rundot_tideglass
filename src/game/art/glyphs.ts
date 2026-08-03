/**
 * Every tile face, drawn as code.
 *
 * One generator, three consumers: the Pixi textures, the DOM tile previews in
 * the how-to-play sheet, and the store thumbnail. Authoring the art here rather
 * than as image files is what stops those three from drifting apart — there is
 * no second copy to forget to update.
 *
 * Contract for every draw function: the glyph is centred on (0, 0) and fits
 * inside a box of `size` x `size`. Callers set the transform; glyphs never
 * translate to absolute coordinates and never leave state on the context.
 */
import { css, mix, PALETTE, SUIT_INK } from "./palette.ts";
import { CREATURES, kindRank, kindSuit, type Creature, type TileKind } from "../mahjong/tiles.ts";

type Ctx = CanvasRenderingContext2D;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * A pearl: a small rendered sphere, not an outlined disc.
 *
 * Four passes sell the roundness — a pooled shadow beneath, a body gradient
 * whose light comes from the same up-left corner as the tile's own sheen, a
 * sliver of reflected light along the lower rim, and a crisp specular dot.
 * The old version stroked a heavy outline around a flat fill, which is
 * exactly the "cheap clipart" read the rest of the face has outgrown.
 */
function pearl(ctx: Ctx, x: number, y: number, radius: number, ink: number): void {
    // Contact shadow, pooled slightly below.
    const shadow = ctx.createRadialGradient(x, y + radius * 0.4, radius * 0.2, x, y + radius * 0.5, radius * 1.15);
    shadow.addColorStop(0, css(PALETTE.abyss, 0.3));
    shadow.addColorStop(1, css(PALETTE.abyss, 0));
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(x, y + radius * 0.32, radius * 1.15, 0, Math.PI * 2);
    ctx.fill();

    // Body: lit up-left, falling to a deepened rim down-right.
    const body = ctx.createRadialGradient(x - radius * 0.38, y - radius * 0.42, radius * 0.08, x, y, radius * 1.02);
    body.addColorStop(0, css(mix(ink, 0xffffff, 0.72)));
    body.addColorStop(0.38, css(mix(ink, 0xffffff, 0.22)));
    body.addColorStop(0.78, css(ink));
    body.addColorStop(1, css(mix(ink, PALETTE.abyss, 0.42)));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Reflected light creeping up the lower rim — what makes a sphere read as
    // sitting in luminous water rather than stamped on paper.
    ctx.strokeStyle = css(0xffffff, 0.28);
    ctx.lineWidth = radius * 0.14;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.8, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();

    // Specular kiss.
    ctx.fillStyle = css(0xffffff, 0.95);
    ctx.beginPath();
    ctx.arc(x - radius * 0.34, y - radius * 0.38, radius * 0.18, 0, Math.PI * 2);
    ctx.fill();
}

/**
 * A kelp blade: curved, tapered, and leaning.
 *
 * `lean` rotates the whole blade a few degrees. The blade itself is
 * asymmetric — the tip drifts sideways as though caught in a current — and
 * carries a base-to-tip gradient plus a curved rib. A grid of these reads as
 * a kelp bed; a grid of the old identical upright ovals read as wallpaper.
 */
function strand(ctx: Ctx, x: number, y: number, width: number, height: number, ink: number, lean = 0): void {
    const h = height / 2;
    const w = width;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(lean);

    const tipX = w * 0.26;
    const fill = ctx.createLinearGradient(0, h, tipX, -h);
    fill.addColorStop(0, css(mix(ink, PALETTE.abyss, 0.28)));
    fill.addColorStop(0.5, css(ink));
    fill.addColorStop(1, css(mix(ink, 0xffffff, 0.22)));
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(tipX, -h);
    ctx.bezierCurveTo(-w * 0.58, -h * 0.34, -w * 0.6, h * 0.3, 0, h);
    ctx.bezierCurveTo(w * 0.64, h * 0.26, w * 0.5, -h * 0.3, tipX, -h);
    ctx.closePath();
    ctx.fill();

    // The rib follows the blade's curve toward the drifting tip.
    ctx.strokeStyle = css(0xffffff, 0.32);
    ctx.lineWidth = Math.max(1, w * 0.09);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, h * 0.66);
    ctx.quadraticCurveTo(w * 0.1, 0, tipX * 0.8, -h * 0.62);
    ctx.stroke();

    ctx.restore();
}

/** Closed smooth curve through points, used for the creature silhouettes. */
function blob(ctx: Ctx, points: ReadonlyArray<readonly [number, number]>): void {
    if (points.length < 3) return;
    const at = (index: number): readonly [number, number] =>
        points[((index % points.length) + points.length) % points.length] ?? [0, 0];
    const midpoint = (a: readonly [number, number], b: readonly [number, number]): [number, number] => [
        (a[0] + b[0]) / 2,
        (a[1] + b[1]) / 2,
    ];
    ctx.beginPath();
    const start = midpoint(at(-1), at(0));
    ctx.moveTo(start[0], start[1]);
    for (let index = 0; index < points.length; index += 1) {
        const current = at(index);
        const end = midpoint(current, at(index + 1));
        ctx.quadraticCurveTo(current[0], current[1], end[0], end[1]);
    }
    ctx.closePath();
}

/**
 * A tapering tentacle/arm along a quadratic curve.
 *
 * The curve is subdivided so the stroke can thin from `width` at the root to
 * half of it at the tip — a limb drawn at one width reads as a bent pipe, and
 * a row of bent pipes is most of why the creatures used to look like clipart.
 */
function limb(
    ctx: Ctx,
    from: readonly [number, number],
    control: readonly [number, number],
    to: readonly [number, number],
    width: number,
): void {
    ctx.lineCap = "round";
    const steps = 8;
    let previousX = from[0];
    let previousY = from[1];
    for (let index = 1; index <= steps; index += 1) {
        const t = index / steps;
        const u = 1 - t;
        const x = u * u * from[0] + 2 * u * t * control[0] + t * t * to[0];
        const y = u * u * from[1] + 2 * u * t * control[1] + t * t * to[1];
        ctx.lineWidth = width * (1 - t * 0.5);
        ctx.beginPath();
        ctx.moveTo(previousX, previousY);
        ctx.lineTo(x, y);
        ctx.stroke();
        previousX = x;
        previousY = y;
    }
}

/**
 * A tapering tendril along a cubic curve — the S-bends a quadratic cannot
 * make. This is what lets a jellyfish tentacle drift with the current instead
 * of hanging straight down.
 */
function tendril(
    ctx: Ctx,
    from: readonly [number, number],
    control1: readonly [number, number],
    control2: readonly [number, number],
    to: readonly [number, number],
    rootWidth: number,
    tipWidth: number,
): void {
    ctx.lineCap = "round";
    const steps = 10;
    let previousX = from[0];
    let previousY = from[1];
    for (let index = 1; index <= steps; index += 1) {
        const t = index / steps;
        const u = 1 - t;
        const x = u * u * u * from[0] + 3 * u * u * t * control1[0] + 3 * u * t * t * control2[0] + t * t * t * to[0];
        const y = u * u * u * from[1] + 3 * u * u * t * control1[1] + 3 * u * t * t * control2[1] + t * t * t * to[1];
        ctx.lineWidth = rootWidth + (tipWidth - rootWidth) * t;
        ctx.beginPath();
        ctx.moveTo(previousX, previousY);
        ctx.lineTo(x, y);
        ctx.stroke();
        previousX = x;
        previousY = y;
    }
}

/** Two dots that turn any silhouette into a creature. */
function eyes(ctx: Ctx, x: number, y: number, spread: number, radius: number): void {
    ctx.fillStyle = css(0xffffff, 0.92);
    for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(x + side * spread, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.fillStyle = css(PALETTE.abyss, 0.85);
    for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(x + side * spread, y, radius * 0.45, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ---------------------------------------------------------------------------
// Suit: pearl — the classic dot arrangements
// ---------------------------------------------------------------------------

/** Dot layouts in normalized -1..1 space, one entry per rank. */
const PEARL_LAYOUTS: readonly (readonly (readonly [number, number])[])[] = [
    [[0, 0]],
    [
        [0, -0.52],
        [0, 0.52],
    ],
    [
        [-0.55, -0.55],
        [0, 0],
        [0.55, 0.55],
    ],
    [
        [-0.5, -0.5],
        [0.5, -0.5],
        [-0.5, 0.5],
        [0.5, 0.5],
    ],
    [
        [-0.58, -0.58],
        [0.58, -0.58],
        [0, 0],
        [-0.58, 0.58],
        [0.58, 0.58],
    ],
    [
        [-0.5, -0.66],
        [0.5, -0.66],
        [-0.5, 0],
        [0.5, 0],
        [-0.5, 0.66],
        [0.5, 0.66],
    ],
    [
        [0, -0.74],
        [-0.52, -0.4],
        [0.52, -0.4],
        [-0.52, 0.28],
        [0.52, 0.28],
        [-0.52, 0.78],
        [0.52, 0.78],
    ],
    [
        [-0.42, -0.75],
        [0.42, -0.75],
        [-0.42, -0.25],
        [0.42, -0.25],
        [-0.42, 0.25],
        [0.42, 0.25],
        [-0.42, 0.75],
        [0.42, 0.75],
    ],
    [
        [-0.66, -0.66],
        [0, -0.66],
        [0.66, -0.66],
        [-0.66, 0],
        [0, 0],
        [0.66, 0],
        [-0.66, 0.66],
        [0, 0.66],
        [0.66, 0.66],
    ],
];

function drawPearlSuit(ctx: Ctx, size: number, rank: number, ink: number): void {
    const layout = PEARL_LAYOUTS[rank - 1] ?? [];
    const half = size / 2;
    // A single pearl is the classic oversized one; crowded ranks shrink.
    const radius = rank === 1 ? half * 0.54 : half * (rank <= 4 ? 0.3 : rank <= 6 ? 0.255 : 0.205);
    for (const [nx, ny] of layout) {
        pearl(ctx, nx * half * 0.78, ny * half * 0.78, radius, ink);
    }
}

// ---------------------------------------------------------------------------
// Suit: kelp — bamboo-style strand arrangements
// ---------------------------------------------------------------------------

const KELP_LAYOUTS: readonly (readonly (readonly [number, number])[])[] = [
    [],
    [
        [-0.4, 0],
        [0.4, 0],
    ],
    [
        [-0.62, 0],
        [0, 0],
        [0.62, 0],
    ],
    [
        [-0.42, -0.46],
        [0.42, -0.46],
        [-0.42, 0.46],
        [0.42, 0.46],
    ],
    [
        [-0.56, -0.5],
        [0.56, -0.5],
        [0, 0],
        [-0.56, 0.5],
        [0.56, 0.5],
    ],
    [
        [-0.62, -0.46],
        [0, -0.46],
        [0.62, -0.46],
        [-0.62, 0.46],
        [0, 0.46],
        [0.62, 0.46],
    ],
    [
        [0, -0.72],
        [-0.62, 0],
        [0, 0],
        [0.62, 0],
        [-0.62, 0.66],
        [0, 0.66],
        [0.62, 0.66],
    ],
    [
        [-0.42, -0.68],
        [0.42, -0.68],
        [-0.42, -0.22],
        [0.42, -0.22],
        [-0.42, 0.24],
        [0.42, 0.24],
        [-0.42, 0.7],
        [0.42, 0.7],
    ],
    [
        [-0.64, -0.62],
        [0, -0.62],
        [0.64, -0.62],
        [-0.64, 0],
        [0, 0],
        [0.64, 0],
        [-0.64, 0.62],
        [0, 0.62],
        [0.64, 0.62],
    ],
];

function drawKelpSuit(ctx: Ctx, size: number, rank: number, ink: number): void {
    const half = size / 2;

    // Kelp 1 is the odd one out, as bamboo 1 always is: a single holdfast with
    // a long frond, so the rank reads instantly instead of being counted.
    if (rank === 1) {
        ctx.save();
        ctx.strokeStyle = css(ink);
        ctx.lineCap = "round";
        ctx.lineWidth = half * 0.15;
        ctx.beginPath();
        ctx.moveTo(0, half * 0.82);
        ctx.quadraticCurveTo(half * 0.24, half * 0.1, -half * 0.06, -half * 0.5);
        ctx.stroke();
        for (const side of [-1, 1]) {
            for (let index = 0; index < 3; index += 1) {
                const y = half * (0.45 - index * 0.42);
                ctx.save();
                ctx.translate(side * half * 0.12, y);
                ctx.rotate(side * 0.5);
                strand(ctx, side * half * 0.3, 0, half * 0.3, half * 0.62, ink, side * 0.12);
                ctx.restore();
            }
        }
        ctx.restore();
        return;
    }

    const rows = rank >= 7 ? 3 : 2;
    const height = half * (rows === 3 ? 0.56 : 0.8);
    const width = half * (rank >= 8 ? 0.34 : 0.42);
    const layout = KELP_LAYOUTS[rank - 1] ?? [];
    layout.forEach(([nx, ny], index) => {
        // Deterministic per-blade lean: the bed sways together without any two
        // neighbouring blades standing identically. No randomness — the same
        // rank must render the same texture every session.
        const lean = Math.sin(index * 2.39 + rank * 1.7 + nx * 3) * 0.16;
        strand(ctx, nx * half * 0.72, ny * half * 0.78, width, height, ink, lean);
    });
}

// ---------------------------------------------------------------------------
// Suit: fathom — a depth numeral over a sounding wave
// ---------------------------------------------------------------------------

function drawFathomSuit(ctx: Ctx, size: number, rank: number, ink: number): void {
    const half = size / 2;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // A plain numeral beats an invented script here: the fathom suit is the
    // one a new player uses to work out that tiles come in matching pairs.
    ctx.font = `600 ${size * 0.8}px "Marcellus", Georgia, serif`;

    // Letterpress: highlight up-left, shade down-right, ink on top. The two
    // offset passes only survive as sub-pixel rims, which is what makes the
    // numeral look pressed INTO the glass instead of printed on it.
    const numeralY = -half * 0.16;
    const offset = Math.max(1, size * 0.028);
    ctx.fillStyle = css(0xffffff, 0.55);
    ctx.fillText(String(rank), -offset * 0.6, numeralY - offset * 0.7);
    ctx.fillStyle = css(mix(ink, PALETTE.abyss, 0.55), 0.5);
    ctx.fillText(String(rank), offset * 0.7, numeralY + offset * 0.8);
    ctx.fillStyle = css(ink);
    ctx.fillText(String(rank), 0, numeralY);

    // Sounding waves: one swell per depth band, capped so nine does not turn
    // into a barcode. Waves, not rules — a straight underline under a serif
    // numeral reads as a default, and this is the suit of DEPTH.
    const marks = Math.min(3, Math.ceil(rank / 3));
    ctx.lineCap = "round";
    for (let index = 0; index < marks; index += 1) {
        const y = half * (0.56 + index * 0.19);
        const spread = half * (0.5 - index * 0.11);
        const amp = half * 0.055;
        ctx.strokeStyle = css(ink, 0.62 - index * 0.12);
        ctx.lineWidth = half * (0.09 - index * 0.012);
        ctx.beginPath();
        ctx.moveTo(-spread, y);
        ctx.bezierCurveTo(-spread * 0.5, y - amp * 2, -spread * 0.16, y + amp * 2, 0, y);
        ctx.bezierCurveTo(spread * 0.16, y - amp * 2, spread * 0.5, y + amp * 2, spread, y);
        ctx.stroke();
    }
    ctx.restore();
}

// ---------------------------------------------------------------------------
// Suit: creature — the illustrated tiles
// ---------------------------------------------------------------------------

function drawNautilus(ctx: Ctx, r: number, ink: number): void {
    ctx.fillStyle = css(ink);
    ctx.beginPath();
    // A log spiral, closed back along its own outer edge — normalized so the
    // final winding lands exactly on `r`. (It used to overshoot by design and
    // rely on the canvas edge to clip it; inside the medallion frame the
    // whole shell has to fit.)
    const turns = 2.15;
    const steps = 72;
    const grow = 0.29;
    const maxT = turns * Math.PI * 2;
    const unit = r / Math.exp(grow * maxT);
    const outer: Array<[number, number]> = [];
    for (let index = 0; index <= steps; index += 1) {
        const t = (index / steps) * maxT;
        const radius = unit * Math.exp(grow * t);
        outer.push([Math.cos(t) * radius, Math.sin(t) * radius]);
    }
    const first = outer[0] ?? [0, 0];
    ctx.moveTo(first[0], first[1]);
    for (const [x, y] of outer) ctx.lineTo(x, y);
    for (let index = outer.length - 1; index >= 0; index -= 1) {
        const point = outer[index];
        if (point) ctx.lineTo(point[0] * 0.62, point[1] * 0.62);
    }
    ctx.closePath();
    ctx.fill();
    // Chamber walls.
    ctx.strokeStyle = css(0xffffff, 0.42);
    ctx.lineWidth = r * 0.05;
    for (let index = 2; index < 9; index += 1) {
        const t = (index / 9) * maxT;
        const radius = unit * Math.exp(grow * t);
        ctx.beginPath();
        ctx.moveTo(Math.cos(t) * radius * 0.64, Math.sin(t) * radius * 0.64);
        ctx.lineTo(Math.cos(t) * radius, Math.sin(t) * radius);
        ctx.stroke();
    }
}

function drawJellyfish(ctx: Ctx, r: number, ink: number): void {
    // Tentacles first, so the bell overlaps their roots. Every tentacle is a
    // different length and all of them are swept by the same gentle current —
    // the shared drift is what makes it read as swimming rather than as a
    // comb of squiggles hanging off a cap.
    ctx.strokeStyle = css(ink);
    const tentacles: ReadonlyArray<readonly [number, number, number]> = [
        // [root x, length, sideways sweep] in bell radii.
        [-0.44, 0.86, 0.14],
        [-0.15, 1.08, 0.28],
        [0.15, 0.9, 0.36],
        [0.44, 1.12, 0.44],
    ];
    for (const [rootX, length, sway] of tentacles) {
        tendril(
            ctx,
            [rootX * r, -r * 0.12],
            [rootX * r - r * 0.1, r * 0.32],
            [rootX * r + sway * r, r * 0.36],
            [rootX * r + sway * r * 0.92, -r * 0.12 + length * r],
            r * 0.085,
            r * 0.03,
        );
    }
    // Two heavier ruffled oral arms close to the centre line.
    for (const side of [-1, 1] as const) {
        tendril(
            ctx,
            [side * r * 0.16, -r * 0.1],
            [side * r * 0.44, r * 0.2],
            [side * r * 0.02, r * 0.38],
            [side * r * 0.3, r * 0.66],
            r * 0.15,
            r * 0.05,
        );
    }

    // The bell: a dome with a scalloped skirt, shaded like the pearls are —
    // lit from up-left, deepening toward the rim — so the whole suit shares
    // one light.
    const bell = ctx.createRadialGradient(-r * 0.24, -r * 0.64, r * 0.06, 0, -r * 0.42, r * 0.88);
    bell.addColorStop(0, css(mix(ink, 0xffffff, 0.5)));
    bell.addColorStop(0.55, css(ink));
    bell.addColorStop(1, css(mix(ink, PALETTE.abyss, 0.3)));
    ctx.fillStyle = bell;
    ctx.beginPath();
    ctx.moveTo(-r * 0.66, -r * 0.18);
    ctx.bezierCurveTo(-r * 0.76, -r * 0.94, r * 0.76, -r * 0.94, r * 0.66, -r * 0.18);
    // The scalloped skirt, right to left.
    ctx.quadraticCurveTo(r * 0.5, -r * 0.03, r * 0.33, -r * 0.16);
    ctx.quadraticCurveTo(r * 0.165, -r * 0.01, 0, -r * 0.16);
    ctx.quadraticCurveTo(-r * 0.165, -r * 0.01, -r * 0.33, -r * 0.16);
    ctx.quadraticCurveTo(-r * 0.5, -r * 0.03, -r * 0.66, -r * 0.18);
    ctx.closePath();
    ctx.fill();

    // Radial canals inside the bell.
    ctx.strokeStyle = css(0xffffff, 0.3);
    ctx.lineWidth = r * 0.05;
    for (const spread of [-1, 0, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(spread * r * 0.13, -r * 0.76);
        ctx.quadraticCurveTo(spread * r * 0.34, -r * 0.52, spread * r * 0.4, -r * 0.22);
        ctx.stroke();
    }

    // Bioluminescent spots in the skirt's dips, and the wet highlight.
    ctx.fillStyle = css(0xffffff, 0.55);
    for (const x of [-0.49, -0.165, 0.165, 0.49] as const) {
        ctx.beginPath();
        ctx.arc(x * r, -r * 0.08, r * 0.045, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.fillStyle = css(0xffffff, 0.5);
    ctx.beginPath();
    ctx.ellipse(-r * 0.27, -r * 0.62, r * 0.22, r * 0.11, -0.5, 0, Math.PI * 2);
    ctx.fill();
}

function drawSeahorse(ctx: Ctx, r: number, ink: number): void {
    ctx.strokeStyle = css(ink);
    ctx.fillStyle = css(ink);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = r * 0.3;
    ctx.beginPath();
    ctx.moveTo(r * 0.1, -r * 0.5);
    ctx.bezierCurveTo(-r * 0.5, -r * 0.3, r * 0.4, r * 0.05, -r * 0.02, r * 0.42);
    ctx.stroke();
    // Curled tail.
    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    ctx.arc(-r * 0.2, r * 0.6, r * 0.2, -Math.PI * 0.4, Math.PI * 1.25);
    ctx.stroke();
    // Head and snout.
    ctx.beginPath();
    ctx.ellipse(r * 0.14, -r * 0.62, r * 0.24, r * 0.19, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = r * 0.11;
    ctx.beginPath();
    ctx.moveTo(r * 0.3, -r * 0.6);
    ctx.lineTo(r * 0.62, -r * 0.48);
    ctx.stroke();
    // Dorsal fin.
    ctx.beginPath();
    ctx.moveTo(-r * 0.22, -r * 0.3);
    ctx.quadraticCurveTo(-r * 0.6, r * 0.02, -r * 0.16, r * 0.2);
    ctx.fill();
    ctx.fillStyle = css(0xffffff, 0.9);
    ctx.beginPath();
    ctx.arc(r * 0.16, -r * 0.66, r * 0.06, 0, Math.PI * 2);
    ctx.fill();
}

function drawRay(ctx: Ctx, r: number, ink: number): void {
    ctx.fillStyle = css(ink);
    blob(ctx, [
        [0, -r * 0.6],
        [r * 0.55, -r * 0.16],
        [r * 0.92, r * 0.3],
        [r * 0.2, r * 0.24],
        [0, r * 0.42],
        [-r * 0.2, r * 0.24],
        [-r * 0.92, r * 0.3],
        [-r * 0.55, -r * 0.16],
    ]);
    ctx.fill();
    ctx.strokeStyle = css(ink);
    limb(ctx, [0, r * 0.34], [r * 0.16, r * 0.72], [-r * 0.06, r * 0.94], r * 0.08);
    eyes(ctx, 0, -r * 0.34, r * 0.19, r * 0.09);
}

function drawOctopus(ctx: Ctx, r: number, ink: number): void {
    ctx.strokeStyle = css(ink);
    for (let index = 0; index < 5; index += 1) {
        const x = (index - 2) * r * 0.34;
        const curl = index % 2 === 0 ? 1 : -1;
        limb(ctx, [x * 0.7, r * 0.06], [x * 1.25 + curl * r * 0.24, r * 0.56], [x * 1.3, r * 0.9], r * 0.12);
    }
    ctx.fillStyle = css(ink);
    blob(ctx, [
        [0, -r * 0.86],
        [r * 0.62, -r * 0.42],
        [r * 0.6, r * 0.16],
        [0, r * 0.3],
        [-r * 0.6, r * 0.16],
        [-r * 0.62, -r * 0.42],
    ]);
    ctx.fill();
    eyes(ctx, 0, -r * 0.32, r * 0.25, r * 0.13);
}

function drawCrab(ctx: Ctx, r: number, ink: number): void {
    ctx.strokeStyle = css(ink);
    ctx.fillStyle = css(ink);
    // Legs first so the shell overlaps them.
    for (const side of [-1, 1]) {
        for (let index = 0; index < 3; index += 1) {
            const y = r * (0.06 + index * 0.26);
            limb(ctx, [side * r * 0.4, y], [side * r * 0.76, y + r * 0.1], [side * r * 0.86, y + r * 0.3], r * 0.09);
        }
    }
    // Claws.
    for (const side of [-1, 1]) {
        limb(ctx, [side * r * 0.42, -r * 0.12], [side * r * 0.82, -r * 0.4], [side * r * 0.76, -r * 0.66], r * 0.1);
        ctx.beginPath();
        ctx.ellipse(side * r * 0.78, -r * 0.76, r * 0.2, r * 0.14, side * 0.6, 0, Math.PI * 2);
        ctx.fill();
    }
    blob(ctx, [
        [0, -r * 0.44],
        [r * 0.56, -r * 0.16],
        [r * 0.46, r * 0.36],
        [0, r * 0.5],
        [-r * 0.46, r * 0.36],
        [-r * 0.56, -r * 0.16],
    ]);
    ctx.fill();
    eyes(ctx, 0, -r * 0.24, r * 0.21, r * 0.1);
}

function drawAnemone(ctx: Ctx, r: number, ink: number): void {
    ctx.strokeStyle = css(ink);
    for (let index = 0; index < 9; index += 1) {
        const spread = (index - 4) / 4;
        limb(
            ctx,
            [spread * r * 0.16, r * 0.42],
            [spread * r * 0.86, -r * 0.24],
            [spread * r * 1.02, -r * 0.78 + Math.abs(spread) * r * 0.34],
            r * 0.1,
        );
    }
    ctx.fillStyle = css(ink);
    blob(ctx, [
        [0, r * 0.18],
        [r * 0.44, r * 0.5],
        [r * 0.3, r * 0.9],
        [-r * 0.3, r * 0.9],
        [-r * 0.44, r * 0.5],
    ]);
    ctx.fill();
    ctx.fillStyle = css(0xffffff, 0.34);
    for (let index = 0; index < 4; index += 1) {
        ctx.beginPath();
        ctx.arc((index - 1.5) * r * 0.3, -r * 0.62 + (index % 2) * r * 0.2, r * 0.07, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawStarfish(ctx: Ctx, r: number, ink: number): void {
    ctx.fillStyle = css(ink);
    const points: Array<[number, number]> = [];
    for (let index = 0; index < 10; index += 1) {
        const angle = -Math.PI / 2 + (index / 10) * Math.PI * 2;
        const radius = index % 2 === 0 ? r * 0.92 : r * 0.38;
        points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
    blob(ctx, points);
    ctx.fill();
    ctx.fillStyle = css(0xffffff, 0.36);
    for (let index = 0; index < 5; index += 1) {
        const angle = -Math.PI / 2 + (index / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(angle) * r * 0.44, Math.sin(angle) * r * 0.44, r * 0.08, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawTurtle(ctx: Ctx, r: number, ink: number): void {
    ctx.fillStyle = css(ink);
    // Flippers and head, then the shell on top.
    for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * r * 0.66, -r * 0.3, r * 0.26, r * 0.15, side * -0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(side * r * 0.6, r * 0.46, r * 0.22, r * 0.13, side * 0.7, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.7, r * 0.2, r * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, r * 0.74, r * 0.1, r * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.62, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    // Shell plates.
    ctx.strokeStyle = css(0xffffff, 0.4);
    ctx.lineWidth = r * 0.055;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.3, r * 0.34, 0, 0, Math.PI * 2);
    ctx.stroke();
    for (let index = 0; index < 6; index += 1) {
        const angle = (index / 6) * Math.PI * 2 + 0.5;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * r * 0.3, Math.sin(angle) * r * 0.34);
        ctx.lineTo(Math.cos(angle) * r * 0.6, Math.sin(angle) * r * 0.68);
        ctx.stroke();
    }
    eyes(ctx, 0, -r * 0.72, r * 0.09, r * 0.045);
}

const CREATURE_DRAWERS: Readonly<Record<Creature, (ctx: Ctx, r: number, ink: number) => void>> = {
    nautilus: drawNautilus,
    jellyfish: drawJellyfish,
    seahorse: drawSeahorse,
    ray: drawRay,
    octopus: drawOctopus,
    crab: drawCrab,
    anemone: drawAnemone,
    starfish: drawStarfish,
    turtle: drawTurtle,
};

function drawCreatureSuit(ctx: Ctx, size: number, rank: number, ink: number): void {
    const creature = CREATURES[rank - 1];
    if (!creature) return;
    const r = size * 0.48;

    // A pale medallion behind the illustration: a wash of the suit's own ink
    // and a fine double ring. It frames every creature the same way, so nine
    // very different silhouettes still read as one suit — and it makes the
    // face look designed rather than stamped with clipart.
    const wash = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.04);
    wash.addColorStop(0, css(ink, 0.16));
    wash.addColorStop(0.82, css(ink, 0.08));
    wash.addColorStop(1, css(ink, 0));
    ctx.fillStyle = wash;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.04, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = css(ink, 0.3);
    ctx.lineWidth = r * 0.045;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = css(ink, 0.14);
    ctx.lineWidth = r * 0.028;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
    ctx.stroke();

    CREATURE_DRAWERS[creature](ctx, r * 0.82, ink);
}

// ---------------------------------------------------------------------------

/**
 * Draw a tile's glyph centred on (0, 0) inside a `size` x `size` box. The
 * context is saved and restored, so callers keep whatever state they had.
 *
 * `lightenInk` is for dark finishes: the suit inks are chosen to read on pale
 * glass, and on black glass they would vanish. Only the LIGHTNESS moves — the
 * hue that identifies a suit is preserved, so a player who learned the colours
 * on one finish does not have to relearn them on another.
 */
export function drawGlyph(ctx: Ctx, size: number, kind: TileKind, lightenInk = false): void {
    const suit = kindSuit(kind);
    const rank = kindRank(kind);
    const base = SUIT_INK[suit] ?? PALETTE.inkPearl;
    const ink = lightenInk ? mix(base, 0xffffff, 0.62) : base;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (suit === "pearl") drawPearlSuit(ctx, size, rank, ink);
    else if (suit === "kelp") drawKelpSuit(ctx, size, rank, ink);
    else if (suit === "fathom") drawFathomSuit(ctx, size, rank, ink);
    else drawCreatureSuit(ctx, size, rank, ink);
    ctx.restore();
}
