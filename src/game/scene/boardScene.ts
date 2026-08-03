/**
 * The playable board.
 *
 * This file is presentational: it owns sprites, motion and input, and it asks
 * `MahjongSession` what any of it means. It never decides whether a tile is
 * free, whether a tap matches, or what a match is worth — that all lives in
 * `mahjong/`, where the simulation can prove it.
 *
 * Two structural choices worth knowing before editing:
 *
 * 1. Tiles are Sprites over prebaked textures. Blocked tiles are shown by TINT,
 *    not by a second texture, so the "which tiles can I take" read costs
 *    nothing to keep current and is refreshed after every board change.
 * 2. Animation is decorative, never authoritative. The session is updated the
 *    instant a tap is accepted; the tile then flies to where the model already
 *    says it is. A player who taps faster than the animation can never desync
 *    the board, and a mid-flight pause cannot lose a move.
 */
import {
    Container,
    FillGradient,
    Graphics,
    Rectangle,
    Sprite,
    Texture,
    TilingSprite,
    type Application,
    type FederatedPointerEvent,
} from "pixi.js";
import type { Stage } from "../stage.ts";
import { createTweenController, ease, type TweenController } from "../tween.ts";
import {
    createTileTextures,
    TILE_ANCHOR_X,
    TILE_ANCHOR_Y,
    TILE_DEPTH,
    TILE_FACE_H,
    TILE_FACE_W,
    TILE_PAD,
    TILE_SPRITE_W,
    type TileTextureSet,
} from "../art/tileArt.ts";
import {
    createBoardPoolTexture,
    createBoardShadowTexture,
    createBubbleTexture,
    createCausticTexture,
    createGlowTexture,
    createGodrayTexture,
    createRingTexture,
    createShardTexture,
    createVignetteTexture,
} from "../art/backdrop.ts";
import { ART } from "../../assets/art/index.ts";
import { mix, PALETTE } from "../art/palette.ts";
import { fitBoard, paintOrder, slotCentre } from "./boardLayout.ts";
import { createVfx, type Vfx } from "./vfx.ts";
import type { MahjongSession } from "../mahjong/session.ts";
import { TRAY_CAPACITY_MAX } from "../mahjong/levels.ts";
import type { Tile } from "../mahjong/board.ts";

/**
 * Vertical budget, in design units.
 *
 * These are FALLBACK minimums: the HUD is DOM and the tray is Pixi, and the DOM
 * side grows with safe-area insets (a phone's island pushes the whole HUD down)
 * while design units do not. So `measureReserves()` reads where the DOM rows
 * actually END on this device and the scene lays out below that — the constants
 * only carry the first frame, before the DOM has settled. `layoutFit()` in the
 * QA contract measures the DOM side on every visual-QA run.
 */
/** Back button row plus the tile-count / combo / pearls row beneath it. */
const TOP_BAR_H = 172;
const TRAY_H = 116;
/** The three tool wells plus their labels. */
const BOTTOM_BAR_H = 156;
/** Water left either side of the board, so tiles never touch the frame. */
const WELL_PADDING_X = 26;

const TRAY_SLOT_W = 74;

/**
 * Taps land on the FACE only. The texture is padded for its baked shadow and
 * halo, so without an explicit hit area every tile would also own its glow
 * margin — and swallow taps meant for the tile beside it.
 */
const FACE_HIT_AREA = new Rectangle(-TILE_FACE_W / 2, -TILE_FACE_H / 2, TILE_FACE_W, TILE_FACE_H);

export interface SceneCallbacks {
    /** A tap was accepted. Carries what happened so audio/haptics can respond. */
    onTap(result: { matched: boolean; points: number; combo: number; perfect: boolean }): void;
    /** The tap could not be played. */
    onRejected(reason: string): void;
    /** The level ended. Fired once, after the closing animation. */
    onFinished(status: "won" | "lost"): void;
    /** Anything the HUD mirrors changed. */
    onStateChanged(): void;
}

export interface BoardScene {
    /** Swap in a new session (new level, or a restart). */
    load(session: MahjongSession): void;
    /** Play the hint animation for the current board. Returns false if none. */
    showHint(): boolean;
    /** Animate an undo that the controller has already applied to the session. */
    playUndo(returnedToBoard: number, returnedToTray: number | undefined): void;
    /** Animate a shuffle that the controller has already applied. */
    playShuffle(): void;
    setReducedMotion(reduced: boolean): void;
    /** Board-space centre of a tile, in CSS pixels. Used by the QA harness. */
    tilePoint(tileId: number): { x: number; y: number } | null;
    /** Ids of every tile the player could legally tap right now. */
    freeTileIds(): number[];
    /** Which tile, if any, a screen point would actually hit. QA only. */
    hitTest(clientX: number, clientY: number): number | null;
    destroy(): void;
}

interface TileView {
    tile: Tile;
    sprite: Sprite;
    /** True while the sprite is animating to the tray. */
    inFlight: boolean;
    /** True while a finger is held on it, so the press state can be released. */
    pressed: boolean;
}

export function createBoardScene(app: Application, stage: Stage, callbacks: SceneCallbacks): BoardScene {
    const root = new Container();
    stage.root.addChild(root);

    const tweens: TweenController = createTweenController();
    const textures: TileTextureSet = createTileTextures(Math.min(3, Math.ceil(app.renderer.resolution)));
    const glowTexture = createGlowTexture();
    const shardTexture = createShardTexture();
    const ringTexture = createRingTexture();
    const bubbleTexture = createBubbleTexture();
    const causticTexture = createCausticTexture();
    const boardShadowTexture = createBoardShadowTexture();
    const godrayTexture = createGodrayTexture();
    const poolTexture = createBoardPoolTexture();
    const vignetteTexture = createVignetteTexture();

    let reducedMotion = false;
    const vfx: Vfx = createVfx(
        { glow: glowTexture, shard: shardTexture, ring: ringTexture, bubble: bubbleTexture },
        reducedMotion,
    );

    // --- layers, back to front ---------------------------------------------
    /**
     * The painted seabed. `assets/preload.ts` has already put it in Pixi's
     * cache, so this lookup is synchronous and the sprite can be sized
     * immediately; `seabedReady` guards the case where the load failed, in
     * which case the CSS gradient behind the canvas shows through instead.
     */
    const seabedTexture = Texture.from(ART.boardBackdrop);
    const seabedReady = seabedTexture.width > 1 && seabedTexture.height > 1;
    const seabed = new Sprite(seabedTexture);
    seabed.alpha = seabedReady ? 1 : 0;

    /**
     * Two caustic sheets drifting in opposite directions at different scales.
     * One alone reads as a moving texture; two crossing each other read as
     * light refracted through a surface, which is the whole illusion.
     */
    const caustics = new Container();
    const causticSheets = [0, 1].map((index) => {
        const sheet = new TilingSprite({ texture: causticTexture, width: 10, height: 10 });
        // Deliberately very faint. Caustics are ATMOSPHERE, not decoration: at
        // the alpha that makes them pretty in isolation they read as a bright
        // rippling pattern that competes with the tile faces for attention, and
        // the board becomes hard to scan. If they are obvious, they are wrong.
        sheet.alpha = index === 0 ? 0.05 : 0.032;
        sheet.blendMode = "add";
        sheet.tint = index === 0 ? PALETTE.lumen : PALETTE.glassTop;
        caustics.addChild(sheet);
        return sheet;
    });

    /**
     * Godrays: three shafts of surface light falling through the water at
     * different widths and phases. They sway a few degrees in the tick — light
     * through water is never still, and the sway is most of what makes the
     * backdrop read as water rather than a dark wall.
     */
    const godrayLayer = new Container();
    const godrays = [
        { xFrac: 0.24, widthFrac: 0.5, alpha: 0.34, baseRotation: -0.1, speed: 0.14, phase: 0.0 },
        { xFrac: 0.55, widthFrac: 0.72, alpha: 0.46, baseRotation: 0.03, speed: 0.11, phase: 2.1 },
        { xFrac: 0.82, widthFrac: 0.42, alpha: 0.28, baseRotation: 0.12, speed: 0.17, phase: 4.4 },
    ].map((ray) => {
        const sprite = new Sprite(godrayTexture);
        sprite.anchor.set(0.5, 0);
        sprite.blendMode = "screen";
        sprite.alpha = ray.alpha;
        sprite.rotation = ray.baseRotation;
        godrayLayer.addChild(sprite);
        return { sprite, ...ray };
    });

    /** A pool of lighter water under the board, so the play area glows. */
    const boardPool = new Sprite(poolTexture);
    boardPool.anchor.set(0.5);
    boardPool.blendMode = "screen";
    boardPool.alpha = 0.5;

    /** The shadow the whole board casts, so it rests on the seabed. */
    const boardShadow = new Sprite(boardShadowTexture);
    boardShadow.anchor.set(0.5);
    boardShadow.alpha = 0.7;

    /** Darkened screen edges. Sits UNDER the board so tiles keep their light. */
    const vignette = new Sprite(vignetteTexture);

    const boardLayer = new Container();
    const trayLayer = new Container();
    const flightLayer = new Container();

    root.addChild(
        seabed,
        caustics,
        godrayLayer,
        vfx.ambient,
        boardPool,
        boardShadow,
        vignette,
        boardLayer,
        trayLayer,
        vfx.foreground,
        flightLayer,
    );

    // --- tray ---------------------------------------------------------------
    const trayFrame = new Graphics();
    const traySlots = new Container();
    trayLayer.addChild(trayFrame, traySlots);

    let session: MahjongSession | null = null;
    let views: TileView[] = [];
    /** Sprites currently parked in the tray, in tray order. */
    let trayViews: TileView[] = [];
    let boardFitScale = 1;
    /** Where layoutBoard put the board; the water sway drifts around this. */
    let boardBase = { x: 0, y: 0 };
    let inputLocked = false;
    let finishedNotified = false;
    let elapsedSinceStart = 0;
    /** Keeps the sway and godrays moving while input is locked or paused. */
    let ambientClock = 0;
    let gleamCursor = 0;
    let nextGleamAt = 900;
    let trayGeometry: {
        x: number;
        y: number;
        slotW: number;
        slotH: number;
        totalW: number;
        capacity: number;
        tileScale: number;
    } | null = null;
    let lastTrayDanger = -1;
    /** 1 when a tile just landed in the tray; decays in the tick. */
    let trayFlash = 0;
    let lastTrayFlash = 0;
    /** Measured bottom of the DOM HUD / top of the DOM toolbar, design units. */
    let topReserve = TOP_BAR_H;
    let bottomReserve = BOTTOM_BAR_H;

    // ---------------------------------------------------------------------
    // Geometry
    // ---------------------------------------------------------------------

    /**
     * Read where the DOM HUD actually ends and the DOM toolbar actually
     * begins, in design units. The DOM rows are pushed down by safe-area
     * insets (a notch, an island, a home bar) that the Pixi side cannot know
     * from constants — on tall phones the fixed budget put the pill row ON the
     * tray frame. Falls back to the constants while the DOM is still mounting.
     */
    function measureReserves(): void {
        const scale = stage.scale();
        if (scale <= 0) return;
        const canvasTop = app.canvas.getBoundingClientRect();
        const hudTop = document.querySelector(".hud-meta");
        const toolbar = document.querySelector(".toolbar");
        if (hudTop) {
            const bottom = (hudTop.getBoundingClientRect().bottom - canvasTop.top) / scale;
            if (bottom > 40) topReserve = Math.max(TOP_BAR_H, bottom + 14);
        }
        if (toolbar) {
            const top = (toolbar.getBoundingClientRect().top - canvasTop.top) / scale;
            const reserve = stage.designHeight() - top + 12;
            if (reserve > 40) bottomReserve = Math.max(BOTTOM_BAR_H, reserve);
        }
    }

    function wellRect(): { x: number; y: number; width: number; height: number } {
        const width = stage.designWidth();
        const height = stage.designHeight();
        const top = topReserve + TRAY_H;
        return {
            x: WELL_PADDING_X,
            y: top,
            width: width - WELL_PADDING_X * 2,
            height: Math.max(200, height - top - bottomReserve),
        };
    }

    function layoutStatic(): void {
        measureReserves();
        const width = stage.designWidth();
        const height = stage.designHeight();

        // Cover, never stretch: the seabed is a painted plate and a non-uniform
        // scale would visibly smear its grain.
        if (seabedReady) {
            const cover = Math.max(width / seabedTexture.width, height / seabedTexture.height);
            seabed.width = seabedTexture.width * cover;
            seabed.height = seabedTexture.height * cover;
            seabed.position.set((width - seabed.width) / 2, (height - seabed.height) / 2);
        }

        for (const sheet of causticSheets) {
            sheet.width = width;
            sheet.height = height;
        }

        for (const ray of godrays) {
            // The texture is a trapezoid that starts narrow; keep that neck
            // above the screen, or the gaps between rays read as dark teeth
            // along the top edge.
            ray.sprite.position.set(width * ray.xFrac, -height * 0.34);
            ray.sprite.width = width * ray.widthFrac;
            ray.sprite.height = height * 1.24;
        }

        vignette.width = width;
        vignette.height = height;

        vfx.ambient.position.set(0, 0);
        vfx.resizeAmbient(width, height);

        layoutTray();
        layoutBoard();
    }

    function layoutTray(): void {
        const width = stage.designWidth();
        const capacity = session?.trayCapacity ?? TRAY_CAPACITY_MAX;
        const slotW = Math.min(TRAY_SLOT_W, (width - 80) / capacity);
        // The tile in a slot is scaled so its face AND its drawn thickness fit
        // inside the slot pitch. Scaling by face width alone left the depth
        // extrusion spilling onto the neighbouring slot, so parked tiles
        // visibly overlapped each other and poked out of the frame.
        const tileScale = (slotW - 6) / (TILE_FACE_W + TILE_DEPTH);
        const slotH = (TILE_FACE_H + TILE_DEPTH) * tileScale + 6;
        const totalW = slotW * capacity + 16;
        const x = (width - totalW) / 2;
        const y = topReserve + (TRAY_H - slotH) / 2 - 8;

        // Remember the geometry so the danger pulse can redraw without
        // recomputing the layout every frame.
        trayGeometry = { x, y, slotW, slotH, totalW, capacity, tileScale };
        paintTray(0, trayFlash);

        traySlots.position.set(x + 8, y);
        traySlots.scale.set(tileScale);
        reflowTray(true);
    }

    /**
     * Draw the tray. `danger` 0..1 drives the warning: as the last slots fill,
     * the frame warms toward red and the remaining empty slots glow. `flash`
     * 0..1 is the landing pulse — the shelf lights for a beat when a tile
     * arrives, so the eye is pulled to what just changed.
     *
     * The danger ramp is the ONLY warning before a full tray ends the level,
     * so it has to be visible in peripheral vision — a player watching the
     * board should feel the tray closing without having to look up and count.
     */
    function paintTray(danger: number, flash = 0): void {
        const geometry = trayGeometry;
        if (!geometry) return;
        const { x, y, slotW, slotH, totalW, capacity } = geometry;
        const edge = mix(mix(PALETTE.lumenDim, PALETTE.lumen, flash), PALETTE.danger, danger);

        // A glass shelf, not a box: vertical gradient, lit top edge, dark base.
        const surface = new FillGradient({
            type: "linear",
            start: { x: 0, y: 0 },
            end: { x: 0, y: 1 },
            colorStops: [
                { offset: 0, color: mix(PALETTE.shelf, 0x3a1420, danger * 0.7) },
                { offset: 0.4, color: mix(PALETTE.feltDark, 0x2c0f19, danger * 0.7) },
                { offset: 1, color: mix(PALETTE.abyss, 0x1d0a11, danger * 0.7) },
            ],
            textureSpace: "local",
        });

        trayFrame.clear();
        trayFrame
            .roundRect(x - 10, y - 12, totalW + 20, slotH + 24, 20)
            .fill({ fill: surface, alpha: 0.9 })
            .stroke({ color: edge, width: 2 + danger * 1.5, alpha: 0.45 + flash * 0.35 + danger * 0.45 });
        // The lit rim along the top, where the water's light catches the glass.
        trayFrame
            .moveTo(x + 6, y - 11)
            .lineTo(x + totalW - 6, y - 11)
            .stroke({ color: PALETTE.glassTop, width: 1.2, alpha: 0.16 + flash * 0.2 });

        const used = session?.tray.length ?? 0;
        for (let index = 0; index < capacity; index += 1) {
            const slotX = x + 8 + index * slotW;
            const empty = index >= used;
            const last = index >= capacity - 2;
            // Empty slots are what the player is counting, so they carry the
            // colour; filled ones hold a tile and need no decoration. The last
            // two slots only warm toward red AS danger rises — permanently
            // dark "warning" cells just read as broken UI while the tray is
            // safe.
            const color = last ? mix(PALETTE.lumen, PALETTE.danger, Math.min(1, danger * 2)) : PALETTE.lumen;
            const alpha = empty ? 0.05 + danger * (last ? 0.34 : 0.1) : 0.03;
            trayFrame
                .roundRect(slotX + 3, y + 3, slotW - 6, slotH - 6, 9)
                .fill({ color, alpha })
                .stroke({ color, width: 1, alpha: empty ? 0.1 + danger * 0.2 : 0.04 });
        }
    }

    function traySlotPosition(index: number): { x: number; y: number } {
        const geometry = trayGeometry;
        if (!geometry) return { x: 0, y: 0 };
        // Centre of the slot's FACE: the face+depth block is centred in the
        // slot cell, and the face centre sits half a depth up-left of that.
        const slotCentreX = geometry.x + 8 + (index + 0.5) * geometry.slotW;
        const slotCentreY = geometry.y + geometry.slotH / 2;
        return {
            x: slotCentreX - (TILE_DEPTH / 2) * geometry.tileScale,
            y: slotCentreY - (TILE_DEPTH / 2) * geometry.tileScale,
        };
    }

    function layoutBoard(): void {
        if (!session) return;
        const well = wellRect();
        const fit = fitBoard(session.plan.layout, well.width, well.height, 1.32, 0.34);
        boardFitScale = fit.scale;
        boardLayer.scale.set(fit.scale);
        boardBase = { x: well.x + fit.offsetX, y: well.y + fit.offsetY };
        boardLayer.position.set(boardBase.x, boardBase.y);

        // Ground the light and the shadow on the FITTED board, not the well —
        // a short layout in a tall well otherwise gets a stray dark blob
        // floating in empty water below it.
        const centreX = well.x + fit.offsetX + fit.width / 2;
        const centreY = well.y + fit.offsetY + fit.height / 2;
        boardShadow.position.set(centreX, centreY + fit.height * 0.06);
        boardShadow.width = fit.width * 1.4;
        boardShadow.height = fit.height * 1.3;
        boardPool.position.set(centreX, centreY);
        boardPool.width = fit.width * 1.9;
        boardPool.height = fit.height * 1.7;
    }

    // ---------------------------------------------------------------------
    // Board building
    // ---------------------------------------------------------------------

    function clearBoard(): void {
        for (const view of views) view.sprite.destroy();
        views = [];
        trayViews = [];
        boardLayer.removeChildren();
        flightLayer.removeChildren();
        traySlots.removeChildren();
    }

    function load(next: MahjongSession): void {
        tweens.clear();
        clearBoard();
        session = next;
        finishedNotified = false;
        inputLocked = false;
        elapsedSinceStart = 0;
        nextGleamAt = 1_400;

        const order = paintOrder(next.plan.layout.slots);
        views = new Array<TileView>(next.board.tiles.length);

        order.forEach((tileIndex) => {
            const tile = next.board.tiles[tileIndex];
            if (!tile) return;
            const sprite = new Sprite(textures.get(tile.kind));
            sprite.anchor.set(TILE_ANCHOR_X, TILE_ANCHOR_Y);
            sprite.hitArea = FACE_HIT_AREA;
            const centre = slotCentre(tile.slot);
            sprite.position.set(centre.x, centre.y);
            sprite.eventMode = "static";
            sprite.cursor = "pointer";
            sprite.on("pointertap", (event: FederatedPointerEvent) => {
                event.stopPropagation();
                handleTap(tile.id);
            });
            attachPressFeedback(sprite, tile.id);
            boardLayer.addChild(sprite);

            const view: TileView = { tile, sprite, inFlight: false, pressed: false };
            views[tile.id] = view;

            // Deal-in: tiles sink into place from above with a small sideways
            // sway, staggered diagonally across the board — a tide rolling in,
            // rather than 56 sprites on one conveyor.
            if (!reducedMotion) {
                sprite.alpha = 0;
                const from = centre.y - 110;
                const swayPhase = tile.slot.hx * 0.7 + tile.slot.layer * 1.3;
                const delayMs = Math.min(760, (tile.slot.hx + tile.slot.hy) * 11 + tile.slot.layer * 110);
                tweens.addTween(
                    (value) => {
                        sprite.y = from + (centre.y - from) * value;
                        sprite.x = centre.x + Math.sin(value * Math.PI * 1.6 + swayPhase) * 7 * (1 - value);
                        sprite.rotation = Math.sin(swayPhase) * 0.05 * (1 - value);
                        sprite.alpha = Math.min(1, value * 1.7);
                    },
                    0,
                    1,
                    ease.outCubic,
                    () => {
                        sprite.position.set(centre.x, centre.y);
                        sprite.rotation = 0;
                    },
                    { durationMs: 430, delayMs },
                );
            }
        });

        layoutBoard();
        layoutTray();
        refreshBlockedTint();
        publish();
    }

    /**
     * A tile that is being held sinks slightly and brightens.
     *
     * Without this a tap has no acknowledgement until the tile has already
     * left, which on a slow frame feels like the game missed the input. The
     * press state is released on up AND on out, or dragging off a tile would
     * leave it stuck depressed.
     */
    function attachPressFeedback(sprite: Sprite, tileId: number): void {
        const down = () => {
            const view = views[tileId];
            if (!view || view.inFlight || !session || !session.board.isFree(view.tile)) return;
            view.pressed = true;
            sprite.scale.set(0.93);
            sprite.tint = 0xffffff;
        };
        const up = () => {
            const view = views[tileId];
            if (!view || !view.pressed) return;
            view.pressed = false;
            if (!view.inFlight) sprite.scale.set(1);
            refreshBlockedTint();
        };
        sprite.on("pointerdown", down);
        sprite.on("pointerup", up);
        sprite.on("pointerupoutside", up);
        sprite.on("pointercancel", up);
    }

    /**
     * A glint travelling across a playable tile.
     *
     * Only a few tiles gleam at a time and only free ones do, so the effect
     * doubles as the "you can take this" affordance — the eye is drawn to
     * exactly the tiles that can be tapped, without adding another permanent
     * highlight competing with the tile faces.
     */
    function gleam(view: TileView): void {
        if (reducedMotion || !view.tile.onBoard) return;
        const centre = boardToDesign(view.sprite.x, view.sprite.y);
        const spark = new Sprite(glowTexture);
        spark.anchor.set(0.5);
        spark.tint = PALETTE.glassTop;
        spark.blendMode = "add";
        spark.alpha = 0;
        spark.rotation = -0.9;
        const width = TILE_FACE_W * boardFitScale;
        const height = TILE_FACE_H * boardFitScale;
        spark.scale.set((width * 0.34) / glowTexture.width, (height * 1.5) / glowTexture.height);
        vfx.foreground.addChild(spark);

        const travel = width * 1.1;
        tweens.addTween(
            (value) => {
                spark.x = centre.x - travel / 2 + travel * value;
                spark.y = centre.y - height * 0.1 + height * 0.2 * value;
                spark.alpha = Math.sin(value * Math.PI) * 0.5;
            },
            0,
            1,
            ease.inOutSine,
            () => spark.destroy(),
            { durationMs: 620 },
        );
    }

    /** Send a glint across a couple of random free tiles. */
    function scheduleGleams(): void {
        if (!session || reducedMotion || session.status !== "playing") return;
        const free = session.board.freeTiles();
        if (free.length === 0) return;
        const count = Math.min(2, free.length);
        for (let index = 0; index < count; index += 1) {
            const pick = free[Math.floor(gleamCursor + index * 0.37 * free.length) % free.length];
            const view = pick ? views[pick.id] : undefined;
            if (view && !view.inFlight) gleam(view);
        }
        // Walk the cursor by an irrational-ish step so successive rounds pick
        // different tiles without needing a random source in the render loop.
        gleamCursor = (gleamCursor + free.length * 0.618) % Math.max(1, free.length);
    }

    /**
     * Repaint the "can I take this?" read. Free tiles get the lit texture —
     * the baked bioluminescent halo — and full brightness; blocked tiles are
     * nudged toward the water's colour, gently enough that they still read as
     * sea glass rather than dead slate. Called after every board change,
     * because a single lift can free a dozen tiles.
     */
    function refreshBlockedTint(): void {
        if (!session) return;
        for (const view of views) {
            if (!view || !view.tile.onBoard || view.inFlight) continue;
            const free = session.board.isFree(view.tile);
            view.sprite.texture = textures.get(view.tile.kind, free);
            view.sprite.tint = free ? 0xffffff : 0xa9c6ca;
            view.sprite.alpha = free ? 1 : 0.96;
            if (!view.pressed) view.sprite.scale.set(1);
        }
    }

    function publish(): void {
        callbacks.onStateChanged();
    }

    // ---------------------------------------------------------------------
    // Input
    // ---------------------------------------------------------------------

    function handleTap(tileId: number): void {
        if (!session || inputLocked) return;
        const result = session.tap(tileId, elapsedSinceStart);
        if (!result.ok) {
            const view = views[tileId];
            if (view && result.rejected === "not-free") nudge(view);
            callbacks.onRejected(result.rejected ?? "unknown");
            return;
        }

        if (result.matched) {
            animateMatch(
                result.matched.tileIds[0],
                result.matched.tileIds[1],
                result.matched.points,
                result.matched.combo,
                result.matched.perfect,
            );
        } else if (result.collected !== undefined) {
            animateToTray(result.collected);
        }

        refreshBlockedTint();
        publish();
        callbacks.onTap({
            matched: result.matched !== undefined,
            points: result.matched?.points ?? 0,
            combo: result.matched?.combo ?? 0,
            perfect: result.matched?.perfect ?? false,
        });

        if (result.status !== "playing" && !finishedNotified) {
            finishedNotified = true;
            inputLocked = true;
            const status = result.status;
            // Let the closing animation land before the overlay covers it.
            window.setTimeout(() => callbacks.onFinished(status), reducedMotion ? 260 : 720);
        }
    }

    /** A blocked tile shivers instead of moving. Silent rejection reads as a bug. */
    function nudge(view: TileView): void {
        if (reducedMotion) {
            view.sprite.tint = PALETTE.danger;
            window.setTimeout(() => refreshBlockedTint(), 160);
            return;
        }
        const baseX = view.sprite.x;
        tweens.addTween(
            (value) => {
                view.sprite.x = baseX + Math.sin(value * Math.PI * 5) * 5 * (1 - value);
            },
            0,
            1,
            ease.linear,
            () => {
                view.sprite.x = baseX;
            },
            { durationMs: 300 },
        );
    }

    // ---------------------------------------------------------------------
    // Motion
    // ---------------------------------------------------------------------

    /** Board-container point -> the shared design space the tray lives in. */
    function boardToDesign(x: number, y: number): { x: number; y: number } {
        return { x: boardLayer.x + x * boardFitScale, y: boardLayer.y + y * boardFitScale };
    }

    function animateToTray(tileId: number): void {
        const view = views[tileId];
        if (!view || !session) return;
        const trayIndex = session.tray.findIndex((tile) => tile.id === tileId);
        if (trayIndex === -1) return;

        trayViews.splice(trayIndex, 0, view);
        flyToTray(view, trayIndex);
        reflowTray(false);
    }

    function flyToTray(view: TileView, trayIndex: number): void {
        const start = boardToDesign(view.sprite.x, view.sprite.y);
        const target = traySlotPosition(trayIndex);
        const trayScale = traySlots.scale.x;

        view.inFlight = true;
        view.sprite.eventMode = "none";
        view.sprite.tint = 0xffffff;
        view.sprite.alpha = 1;
        // Reparent to the flight layer so the tile passes OVER the board and
        // the tray frame rather than under whichever one it started beneath.
        flightLayer.addChild(view.sprite);
        view.sprite.position.set(start.x, start.y);
        view.sprite.scale.set(boardFitScale);

        // The tile banks into its travel direction and rights itself as it
        // lands — lifted through water, not slid across glass.
        const tiltDirection = target.x >= start.x ? 1 : -1;
        const duration = reducedMotion ? 110 : 380;
        let lastBubbleAt = 0;
        tweens.addTween(
            (value) => {
                // A shallow arc: tiles are lifted out of the stack, not dragged.
                const lift = reducedMotion ? 0 : Math.sin(value * Math.PI) * 52;
                view.sprite.x = start.x + (target.x - start.x) * value;
                view.sprite.y = start.y + (target.y - start.y) * value - lift;
                view.sprite.scale.set(boardFitScale + (trayScale - boardFitScale) * value);
                view.sprite.rotation = reducedMotion ? 0 : Math.sin(value * Math.PI) * 0.13 * tiltDirection;
                if (!reducedMotion && value - lastBubbleAt > 0.22) {
                    lastBubbleAt = value;
                    vfx.bubbles(view.sprite.x, view.sprite.y + 10, 1, 6);
                }
            },
            0,
            1,
            ease.outCubic,
            () => {
                view.inFlight = false;
                view.sprite.position.set(target.x, target.y);
                view.sprite.scale.set(trayScale);
                view.sprite.rotation = 0;
                // The shelf lights up where the tile settles.
                trayFlash = 1;
                if (!reducedMotion) vfx.bubbles(target.x, target.y + 14, 3, 14);
            },
            { durationMs: duration },
        );
    }

    /** Re-seat tray sprites after an insertion or a removal. */
    function reflowTray(immediate: boolean): void {
        lastTrayDanger = -1;
        trayViews.forEach((view, index) => {
            if (view.inFlight) return;
            const target = traySlotPosition(index);
            view.sprite.scale.set(traySlots.scale.x);
            if (immediate || reducedMotion) {
                view.sprite.position.set(target.x, target.y);
                return;
            }
            const fromX = view.sprite.x;
            const fromY = view.sprite.y;
            if (Math.abs(fromX - target.x) < 0.5 && Math.abs(fromY - target.y) < 0.5) return;
            tweens.addTween(
                (value) => {
                    view.sprite.x = fromX + (target.x - fromX) * value;
                    view.sprite.y = fromY + (target.y - fromY) * value;
                },
                0,
                1,
                ease.outCubic,
                undefined,
                { durationMs: 180 },
            );
        });
    }

    function animateMatch(
        trayTileId: number,
        tappedTileId: number,
        points: number,
        combo: number,
        perfect: boolean,
    ): void {
        const trayView = views[trayTileId];
        const tappedView = views[tappedTileId];
        if (!trayView || !tappedView) return;

        const at = trayViews.indexOf(trayView);
        if (at !== -1) trayViews.splice(at, 1);

        // The tapped tile flies to where its partner is waiting, and both
        // shatter there. Matching at the tray — not on the board — is what
        // teaches the tray rule without a tutorial.
        const meetingPoint = { x: trayView.sprite.x, y: trayView.sprite.y };
        const start = boardToDesign(tappedView.sprite.x, tappedView.sprite.y);

        tappedView.inFlight = true;
        tappedView.sprite.eventMode = "none";
        tappedView.sprite.tint = 0xffffff;
        flightLayer.addChild(tappedView.sprite);
        tappedView.sprite.position.set(start.x, start.y);
        tappedView.sprite.scale.set(boardFitScale);

        const trayScale = traySlots.scale.x;
        const duration = reducedMotion ? 100 : 280;
        const tiltDirection = meetingPoint.x >= start.x ? 1 : -1;
        // Past a modest combo the tile leaves a wake. It costs nothing when the
        // player is going slowly and makes a hot streak feel like one.
        const leavesTrail = combo >= 3 && !reducedMotion;
        let lastTrailAt = 0;

        // The waiting tile leans toward its partner: anticipation, so the
        // meeting reads as two halves of one event rather than a collision.
        if (!reducedMotion) {
            const waitingScale = trayView.sprite.scale.x;
            tweens.addTween(
                (value) => {
                    trayView.sprite.scale.set(waitingScale * (1 + Math.sin(value * Math.PI) * 0.1));
                },
                0,
                1,
                ease.inOutSine,
                undefined,
                { durationMs: duration },
            );
        }

        tweens.addTween(
            (value) => {
                const lift = reducedMotion ? 0 : Math.sin(value * Math.PI) * 44;
                tappedView.sprite.x = start.x + (meetingPoint.x - start.x) * value;
                tappedView.sprite.y = start.y + (meetingPoint.y - start.y) * value - lift;
                tappedView.sprite.scale.set(boardFitScale + (trayScale - boardFitScale) * value);
                tappedView.sprite.rotation = reducedMotion ? 0 : Math.sin(value * Math.PI) * 0.16 * tiltDirection;
                if (leavesTrail && value - lastTrailAt > 0.16) {
                    lastTrailAt = value;
                    vfx.trail(
                        tappedView.sprite.x,
                        tappedView.sprite.y,
                        tappedView.sprite.texture,
                        tappedView.sprite.scale.x,
                        PALETTE.lumen,
                    );
                }
            },
            0,
            1,
            ease.outCubic,
            () => {
                tappedView.inFlight = false;
                tappedView.sprite.rotation = 0;
                shatter(tappedView, meetingPoint, points, combo, perfect);
                shatter(trayView, meetingPoint, 0, 0, false);
                reflowTray(false);
            },
            { durationMs: duration },
        );
    }

    function shatter(
        view: TileView,
        at: { x: number; y: number },
        points: number,
        combo: number,
        perfect: boolean,
    ): void {
        const sprite = view.sprite;
        if (points > 0) {
            vfx.burst(at.x, at.y, PALETTE.lumen, Math.min(2, 0.8 + combo * 0.14));
            // Matches happen AT the tray, which sits directly under the HUD, so
            // a popup rising from the match point lands on top of the score and
            // the pills. It floats up from BELOW the tray instead, clamped clear
            // of both frame edges so a match in an end slot is not half
            // off-screen.
            const margin = 76;
            vfx.scorePopup(
                Math.max(margin, Math.min(stage.designWidth() - margin, at.x)),
                wellRect().y - 6,
                points,
                combo,
            );
            if (perfect) vfx.shout(stage.designWidth() / 2, wellRect().y + 96, combo >= 6 ? "FLAWLESS" : "PERFECT");
        }
        const fromScale = sprite.scale.x;
        tweens.addTween(
            (value) => {
                sprite.alpha = 1 - value;
                sprite.scale.set(fromScale * (1 + value * 0.45));
                sprite.rotation = value * 0.22;
            },
            0,
            1,
            ease.outCubic,
            () => {
                sprite.destroy();
            },
            { durationMs: reducedMotion ? 110 : 230 },
        );
        // The view keeps its (now destroyed) sprite reference only until the
        // next load; nothing reads a matched tile again.
    }

    // ---------------------------------------------------------------------
    // Tools
    // ---------------------------------------------------------------------

    function showHint(): boolean {
        if (!session) return false;
        const hint = session.hint();
        if (!hint) return false;
        const ids = hint.kind === "board-pair" ? hint.tileIds : [hint.tileId];
        for (const id of ids) {
            const view = views[id];
            if (!view || !view.tile.onBoard) continue;
            const point = boardToDesign(view.sprite.x, view.sprite.y);
            vfx.ripple(point.x, point.y, PALETTE.amber);
            const sprite = view.sprite;
            const baseScale = sprite.scale.x;
            tweens.addTween(
                (value) => {
                    const pulse = 1 + Math.sin(value * Math.PI * 3) * 0.08 * (1 - value);
                    sprite.scale.set(baseScale * pulse);
                    sprite.tint = value < 0.85 ? PALETTE.amber : 0xffffff;
                },
                0,
                1,
                ease.linear,
                () => {
                    sprite.scale.set(baseScale);
                    refreshBlockedTint();
                },
                { durationMs: reducedMotion ? 500 : 1_100 },
            );
        }
        if (hint.kind === "tray-match") {
            const trayView = trayViews.find((view) => view.tile.id === hint.trayTileId);
            if (trayView) vfx.ripple(trayView.sprite.x, trayView.sprite.y, PALETTE.amber);
        }
        return true;
    }

    function playUndo(returnedToBoard: number, returnedToTray: number | undefined): void {
        if (!session) return;
        finishedNotified = false;
        inputLocked = false;

        const boardView = views[returnedToBoard];
        if (boardView) {
            const at = trayViews.indexOf(boardView);
            if (at !== -1) trayViews.splice(at, 1);
            const home = slotCentre(boardView.tile.slot);
            boardView.sprite.eventMode = "static";
            boardLayer.addChild(boardView.sprite);
            const startX = boardView.sprite.x;
            const startY = boardView.sprite.y;
            // The sprite may be coming from the tray (design space) or already
            // be on the board; converting both into board space keeps one path.
            const startInBoard =
                boardView.sprite.parent === boardLayer
                    ? { x: startX, y: startY }
                    : { x: (startX - boardLayer.x) / boardFitScale, y: (startY - boardLayer.y) / boardFitScale };
            boardView.sprite.position.set(startInBoard.x, startInBoard.y);
            boardView.sprite.scale.set(1);
            reorderBoardChild(boardView);
            tweens.addTween(
                (value) => {
                    // The same lifted arc as the outbound flight, reversed —
                    // an undo should look like the move played backwards.
                    const lift = reducedMotion ? 0 : Math.sin(value * Math.PI) * 34 * (1 / boardFitScale);
                    boardView.sprite.x = home.x + (startInBoard.x - home.x) * (1 - value);
                    boardView.sprite.y = home.y + (startInBoard.y - home.y) * (1 - value) - lift;
                },
                0,
                1,
                ease.outCubic,
                () => {
                    boardView.sprite.position.set(home.x, home.y);
                    if (!reducedMotion) {
                        const settle = boardToDesign(home.x, home.y);
                        vfx.bubbles(settle.x, settle.y + 8, 2, 10);
                    }
                },
                { durationMs: reducedMotion ? 90 : 280 },
            );
        }

        // Undoing a match resurrects the tile that had been sitting in the tray.
        if (returnedToTray !== undefined) {
            const tile = session.board.tiles[returnedToTray];
            if (!tile) return;
            const revived = rebuildSprite(tile);
            const index = session.tray.findIndex((held) => held.id === returnedToTray);
            trayViews.splice(Math.max(0, index), 0, revived);
            revived.sprite.position.set(traySlotPosition(Math.max(0, index)).x, traySlotPosition(Math.max(0, index)).y);
            revived.sprite.scale.set(traySlots.scale.x);
            flightLayer.addChild(revived.sprite);
        }

        reflowTray(false);
        refreshBlockedTint();
        publish();
    }

    /**
     * Rebuild a sprite for a tile whose old one was destroyed by a match. Undo
     * has to be able to bring those back, and reviving a destroyed Pixi object
     * is not possible.
     */
    function rebuildSprite(tile: Tile): TileView {
        const sprite = new Sprite(textures.get(tile.kind));
        sprite.anchor.set(TILE_ANCHOR_X, TILE_ANCHOR_Y);
        sprite.hitArea = FACE_HIT_AREA;
        sprite.eventMode = "static";
        sprite.cursor = "pointer";
        sprite.on("pointertap", (event: FederatedPointerEvent) => {
            event.stopPropagation();
            handleTap(tile.id);
        });
        attachPressFeedback(sprite, tile.id);
        const view: TileView = { tile, sprite, inFlight: false, pressed: false };
        views[tile.id] = view;
        return view;
    }

    /** Put a returned tile back at the right depth in the paint order. */
    function reorderBoardChild(view: TileView): void {
        const children = boardLayer.children;
        let insertAt = children.length;
        for (let index = 0; index < children.length; index += 1) {
            const other = views.find((candidate) => candidate?.sprite === children[index]);
            if (!other) continue;
            const a = view.tile.slot;
            const b = other.tile.slot;
            if (a.layer < b.layer || (a.layer === b.layer && (a.hy < b.hy || (a.hy === b.hy && a.hx < b.hx)))) {
                insertAt = index;
                break;
            }
        }
        boardLayer.setChildIndex(view.sprite, Math.min(insertAt, children.length - 1));
    }

    function playShuffle(): void {
        if (!session) return;
        finishedNotified = false;
        inputLocked = false;
        // Kinds have moved, so every board sprite needs its texture swapped.
        // A quick flip sells that the faces changed rather than the positions;
        // staggering the flip diagonally turns 50 simultaneous flips into one
        // wave washing across the board. The new face (and its lit/blocked
        // state) is applied at each tile's own flip midpoint — a global
        // refreshBlockedTint here would reveal every new face on frame one and
        // reduce the flip to decoration.
        for (const view of views) {
            if (!view || !view.tile.onBoard) continue;
            const sprite = view.sprite;
            const free = session.board.isFree(view.tile);
            const texture = textures.get(view.tile.kind, free);
            const applyFace = () => {
                sprite.texture = texture;
                sprite.tint = free ? 0xffffff : 0xa9c6ca;
                sprite.alpha = free ? 1 : 0.96;
            };
            if (reducedMotion) {
                applyFace();
                continue;
            }
            let swapped = false;
            tweens.addTween(
                (value) => {
                    const flip = Math.abs(Math.cos(value * Math.PI));
                    sprite.scale.x = flip;
                    sprite.scale.y = 1 + (1 - flip) * 0.06;
                    if (value >= 0.5 && !swapped) {
                        swapped = true;
                        applyFace();
                    }
                },
                0,
                1,
                ease.inOutSine,
                () => {
                    sprite.scale.set(1);
                    applyFace();
                },
                { durationMs: 420, delayMs: (view.tile.slot.hx + view.tile.slot.hy) * 9 },
            );
        }
        publish();
    }

    // ---------------------------------------------------------------------
    // Frame loop
    // ---------------------------------------------------------------------

    /** Screen point (CSS px) of a tile's face centre. */
    function tilePointOf(view: TileView): { x: number; y: number } {
        const point = boardToDesign(view.sprite.x, view.sprite.y);
        const scale = stage.scale();
        const rect = app.canvas.getBoundingClientRect();
        return { x: rect.left + point.x * scale, y: rect.top + point.y * scale };
    }

    const tick = (): void => {
        const dtSeconds = app.ticker.deltaMS / 1_000;
        tweens.update(dtSeconds);
        vfx.update(dtSeconds);
        // The ambient clock never pauses: water that freezes the moment an
        // overlay opens or the level ends is what makes a scene feel like a
        // screenshot of itself.
        ambientClock += dtSeconds;
        if (session && session.status === "playing" && !inputLocked) {
            elapsedSinceStart += app.ticker.deltaMS;
            session.tick(app.ticker.deltaMS);
            if (elapsedSinceStart >= nextGleamAt) {
                nextGleamAt = elapsedSinceStart + 1_600;
                scheduleGleams();
            }
        }

        // Danger ramps over the last two slots and breathes once full, so a
        // nearly-lost tray is unmistakable without a modal interruption; the
        // flash is the landing pulse decaying. One repaint covers both.
        if (session) {
            const spare = session.trayCapacity - session.tray.length;
            const base = spare <= 0 ? 1 : spare === 1 ? 0.75 : spare === 2 ? 0.4 : 0;
            const pulse = base > 0 && !reducedMotion ? 0.78 + Math.sin(elapsedSinceStart / 190) * 0.22 : 1;
            const danger = base * pulse;
            trayFlash = Math.max(0, trayFlash - dtSeconds * 2.4);
            if (Math.abs(danger - lastTrayDanger) > 0.01 || Math.abs(trayFlash - lastTrayFlash) > 0.02) {
                lastTrayDanger = danger;
                lastTrayFlash = trayFlash;
                paintTray(danger, trayFlash);
            }
        }

        if (!reducedMotion) {
            const t = ambientClock;

            // The whole board rides a slow figure-eight, a couple of design
            // units at most: enough for the stack to feel suspended in water,
            // small enough that no tap can miss because of it.
            boardLayer.position.set(boardBase.x + Math.sin(t * 0.42) * 2.4, boardBase.y + Math.sin(t * 0.61 + 1.4) * 3);

            // Godrays sway and breathe out of phase with each other.
            for (const ray of godrays) {
                ray.sprite.rotation = ray.baseRotation + Math.sin(t * ray.speed * Math.PI * 2 + ray.phase) * 0.045;
                ray.sprite.alpha = ray.alpha * (0.82 + Math.sin(t * 0.5 + ray.phase * 2) * 0.18);
            }

            // Drift the two caustic sheets. Cheap, and it is what stops the
            // backdrop reading as a flat image behind a still board.
            const first = causticSheets[0];
            const second = causticSheets[1];
            if (first) {
                first.tilePosition.set(t * 9, t * 14);
                first.tileScale.set(1.55 + Math.sin(t * 0.21) * 0.1);
                first.alpha = 0.055 + Math.sin(t * 0.37) * 0.018;
            }
            if (second) {
                // Opposite drift and a different scale, so the two never lock
                // into a single moiré pattern.
                second.tilePosition.set(-t * 6, -t * 9);
                second.tileScale.set(2.4 + Math.cos(t * 0.17) * 0.16);
                second.alpha = 0.036 + Math.cos(t * 0.29) * 0.012;
            }

            // The pool of light under the board breathes with the rays.
            boardPool.alpha = 0.5 + Math.sin(t * 0.44 + 0.8) * 0.08;
        }
    };
    app.ticker.add(tick);

    const offResize = stage.onResize(() => layoutStatic());
    layoutStatic();
    // The first layout can run before web fonts and safe-area padding have
    // settled the DOM HUD's height; measure once more shortly after.
    const remeasureTimer = window.setTimeout(() => layoutStatic(), 450);

    return {
        load,
        showHint,
        playUndo,
        playShuffle,
        setReducedMotion(reduced) {
            reducedMotion = reduced;
            vfx.setReducedMotion(reduced);
            // Park the sway wherever its home is, or the board freezes off-centre.
            if (reduced) boardLayer.position.set(boardBase.x, boardBase.y);
        },
        tilePoint(tileId) {
            const view = views[tileId];
            if (!view || !view.tile.onBoard) return null;
            return tilePointOf(view);
        },
        freeTileIds() {
            if (!session) return [];
            return session.board.freeTiles().map((tile) => tile.id);
        },
        hitTest(clientX, clientY) {
            // Walk the interactive tile sprites in reverse paint order, which is
            // the order Pixi's own hit test uses: the last thing drawn wins.
            const rect = app.canvas.getBoundingClientRect();
            const x = clientX - rect.left;
            const y = clientY - rect.top;
            const ordered = [...boardLayer.children, ...flightLayer.children].reverse();
            for (const child of ordered) {
                const view = views.find((candidate) => candidate?.sprite === child);
                if (!view || view.sprite.eventMode === "none") continue;
                // Match the sprite's face-only `hitArea`, not its texture
                // bounds — the texture is padded for its shadow and halo, and
                // testing the full bounds would report taps the sprite itself
                // will not accept.
                const bounds = view.sprite.getBounds();
                const unit = bounds.width / TILE_SPRITE_W;
                const faceX = bounds.x + TILE_PAD * unit;
                const faceY = bounds.y + TILE_PAD * unit;
                const faceW = TILE_FACE_W * unit;
                const faceH = TILE_FACE_H * unit;
                if (x >= faceX && x <= faceX + faceW && y >= faceY && y <= faceY + faceH) {
                    return view.tile.id;
                }
            }
            return null;
        },
        destroy() {
            offResize();
            window.clearTimeout(remeasureTimer);
            app.ticker.remove(tick);
            tweens.clear();
            clearBoard();
            vfx.destroy();
            textures.destroy();
            glowTexture.destroy(true);
            shardTexture.destroy(true);
            ringTexture.destroy(true);
            bubbleTexture.destroy(true);
            causticTexture.destroy(true);
            boardShadowTexture.destroy(true);
            godrayTexture.destroy(true);
            poolTexture.destroy(true);
            vignetteTexture.destroy(true);
            root.destroy({ children: true });
        },
    };
}
