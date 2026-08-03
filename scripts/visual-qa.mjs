#!/usr/bin/env node
/**
 * Headless visual QA.
 *
 * Boots a dev server, drives the game through every screen at real device
 * viewports, and writes PNGs to `tmp/visual-qa/`. It FAILS on any page or
 * console error, because the failure this game is most exposed to — a Pixi
 * scene that throws while building its textures — leaves a blank canvas with
 * the React shell still painted on top, which is invisible to a glance.
 *
 * Two gates here exist because of bugs that actually shipped into development:
 *
 *   1. Taps must LAND. A tile texture built at the wrong resolution rendered
 *      every sprite at twice its size, so each tile covered its neighbours and
 *      swallowed their taps. The board still looked plausible. `hitTest` is
 *      asked, before every tap, whether the tile the engine nominated is really
 *      the tile under that point.
 *   2. Taps must CHANGE something. A harness that taps felt reports success
 *      just as happily as one that plays the game, so the score and the tile
 *      count are compared before and after.
 *
 *   node scripts/visual-qa.mjs            all viewports
 *   node scripts/visual-qa.mjs --phone    just the tall phone
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const root = process.cwd();
const outputDir = path.join(root, "tmp", "visual-qa");
const PORT = 5394;

const VIEWPORTS = [
    { name: "phone-tall", width: 393, height: 852, scale: 2 },
    { name: "phone-short", width: 360, height: 640, scale: 2 },
    { name: "tablet", width: 820, height: 1180, scale: 2 },
    { name: "desktop", width: 1440, height: 900, scale: 1 },
];

const SCREENS = [
    { name: "01-menu", screen: "" },
    { name: "02-shop", screen: "shop", seedProgress: true },
    { name: "03-streak", screen: "daily-rewards" },
    { name: "04-tasks", screen: "daily-quests" },
    { name: "05-record", screen: "stats" },
    { name: "06-options", screen: "settings" },
    { name: "07-howto", screen: "howto" },
];

/**
 * Play real matches. Every move comes from the engine's own hint, is checked
 * against the scene's hit test, and is then dispatched as a pointer pair on the
 * canvas — Pixi pairs pointerdown/pointerup on one root, and a pointerup sent
 * to `window` never becomes a `pointertap`.
 */
const PLAY_MOVES = `(async () => {
    const qa = globalThis.__gameQa;
    if (!qa) return { error: "no qa contract" };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // The canvas is mounted by React when the phase flips to 'playing' and the
    // renderer initializes asynchronously, so it is routinely absent for the
    // first few frames after a navigation.
    let canvas = null;
    for (let attempt = 0; attempt < 60; attempt++) {
        canvas = document.querySelector("canvas");
        if (canvas) break;
        await wait(100);
    }
    if (!canvas) return { error: "no canvas" };
    const tap = (p) => {
        for (const type of ["pointerdown", "pointerup"]) {
            canvas.dispatchEvent(new PointerEvent(type, {
                pointerId: 1, pointerType: "touch", clientX: p.x, clientY: p.y,
                button: 0, buttons: type === "pointerdown" ? 1 : 0,
                bubbles: true, cancelable: true, isPrimary: true,
            }));
        }
    };

    // Wait for the deal-in to settle so the first tap is not chasing a tile.
    for (let attempt = 0; attempt < 40; attempt++) {
        if (qa.freeTilePoints().length > 0) break;
        await wait(150);
    }

    const before = qa.snapshot();
    let missed = 0;
    let played = 0;
    for (let move = 0; move < 8; move++) {
        const next = qa.nextMove();
        if (!next || next.points.length === 0) break;
        for (let index = 0; index < next.points.length; index++) {
            const point = next.points[index];
            // The gate: is the nominated tile actually the topmost thing here?
            if (qa.hitTest(point.x, point.y) !== next.ids[index]) missed++;
            tap(point);
            await wait(360);
        }
        played++;
        await wait(160);
    }
    const after = qa.snapshot();
    return {
        played,
        missed,
        scoreBefore: before.score, scoreAfter: after.score,
        tilesBefore: before.tilesRemaining, tilesAfter: after.tilesRemaining,
        combo: after.combo,
    };
})()`;

/**
 * Clear an entire level and take the next one.
 *
 * Nothing else exercises win detection, the payout, or the level advance — a
 * board that scores fine for eight moves can still fail to notice it is empty,
 * and that bug would only ever surface in front of a player who had just spent
 * five minutes earning it.
 */
const PLAY_TO_CLEAR = `(async () => {
    const qa = globalThis.__gameQa;
    if (!qa) return { error: "no qa contract" };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // React mounts the canvas when the phase flips to 'playing' and the renderer
    // initializes asynchronously, so it is absent for the first few frames.
    let canvas = null;
    for (let attempt = 0; attempt < 60; attempt++) {
        canvas = document.querySelector("canvas");
        if (canvas && qa.freeTilePoints().length > 0) break;
        await wait(100);
    }
    if (!canvas) return { error: "no canvas" };
    const tap = (p) => {
        for (const type of ["pointerdown", "pointerup"]) {
            canvas.dispatchEvent(new PointerEvent(type, {
                pointerId: 1, pointerType: "touch", clientX: p.x, clientY: p.y,
                button: 0, buttons: type === "pointerdown" ? 1 : 0,
                bubbles: true, cancelable: true, isPrimary: true,
            }));
        }
    };
    const startLevel = qa.snapshot().level;
    for (let move = 0; move < 200; move++) {
        const snapshot = qa.snapshot();
        if (snapshot.tilesRemaining === 0) break;
        const next = qa.nextMove();
        if (!next || next.points.length === 0) return { error: "ran out of legal moves", left: snapshot.tilesRemaining };
        for (const point of next.points) { tap(point); await wait(90); }
        await wait(60);
    }
    // The overlay is raised after the closing animation, so give it a moment.
    await wait(1_200);
    const cleared = qa.snapshot();
    return { startLevel, status: cleared.sessionStatus, overlay: cleared.overlay, left: cleared.tilesRemaining, pearls: cleared.pearls };
})()`;

/**
 * Take a screenshot with animations frozen.
 *
 * `animations: "disabled"` is not cosmetic here: the results card's jellyfish
 * drifts on an infinite CSS animation, and Playwright waits for the page to go
 * quiet before capturing — so an unfrozen infinite animation makes the
 * screenshot hang until it times out. Freezing also makes every capture
 * byte-identical between runs, which is what lets these be diffed by eye.
 */
async function shoot(page, name) {
    await page.screenshot({ path: path.join(outputDir, name), animations: "disabled" });
}

/** The gates a screenshot cannot cover. */
async function checkBehaviour(page, problems) {
    const note = (message) => problems.push(`behaviour: ${message}`);

    await page.goto(`http://localhost:${PORT}/?screen=board&qa=1`, { waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__gameQa !== undefined, null, { timeout: 10_000 });

    // --- audio starts, and muting actually silences the music track ---------
    await page.evaluate(() => globalThis.__gameQa.unlockAudio());
    await page.waitForTimeout(1_200);
    let audio = (await page.evaluate(() => globalThis.__gameQa.snapshot())).audio;
    if (audio.contextState !== "running") note(`audio context is "${audio.contextState}", expected running`);
    if (!audio.musicRunning) note("the music track is not playing after unlocking");
    {
        const timeBefore = audio.musicTimeSeconds;
        await page.waitForTimeout(700);
        const timeAfter = (await page.evaluate(() => globalThis.__gameQa.snapshot())).audio.musicTimeSeconds;
        if (!(timeAfter > timeBefore)) note("music playback time is not advancing");
    }

    await page.evaluate(() => globalThis.__gameQa.setSetting("musicEnabled", false));
    await page.waitForTimeout(500);
    const before = (await page.evaluate(() => globalThis.__gameQa.snapshot())).audio.musicTimeSeconds;
    await page.waitForTimeout(700);
    const after = (await page.evaluate(() => globalThis.__gameQa.snapshot())).audio.musicTimeSeconds;
    if (after !== before) note(`muting music did not stop playback (${before}s → ${after}s)`);
    if ((await page.evaluate(() => globalThis.__gameQa.snapshot())).audio.musicRunning) {
        note("the music track is still playing while muted");
    }
    await page.evaluate(() => globalThis.__gameQa.setSetting("musicEnabled", true));

    // --- host lifecycle: hiding the page must suspend audio -----------------
    await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(500);
    audio = (await page.evaluate(() => globalThis.__gameQa.snapshot())).audio;
    if (audio.contextState === "running") note("audio kept running while the page was hidden");
    await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
        Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
        document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(500);
    audio = (await page.evaluate(() => globalThis.__gameQa.snapshot())).audio;
    if (audio.contextState !== "running") note(`audio did not resume when the page came back (${audio.contextState})`);

    // --- settings survive a reload -----------------------------------------
    await page.evaluate(async () => {
        await globalThis.__gameQa.setSetting("reducedMotion", true);
        await globalThis.__gameQa.setSetting("hapticsEnabled", false);
        await globalThis.__gameQa.setSetting("sfxVolume", 0.35);
    });
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__gameQa !== undefined, null, { timeout: 10_000 });
    const restored = await page.evaluate(() => globalThis.__gameQa.snapshot());
    if (restored.reducedMotion !== true) note("reduced motion did not persist across a reload");

    // --- the board is still playable with reduced motion on -----------------
    await page.goto(`http://localhost:${PORT}/?screen=board&qa=1`, { waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__gameQa !== undefined, null, { timeout: 10_000 });
    const reduced = await page.evaluate(PLAY_MOVES);
    if (reduced.error) note(`reduced motion: ${reduced.error}`);
    else if (!(reduced.scoreAfter > reduced.scoreBefore)) note("no match scored with reduced motion enabled");
    await shoot(page, "12-reduced-motion.png");

    await page.evaluate(async () => {
        await globalThis.__gameQa.setSetting("reducedMotion", false);
        await globalThis.__gameQa.setSetting("hapticsEnabled", true);
        await globalThis.__gameQa.setSetting("sfxVolume", 0.7);
    });

    // --- a whole level, cleared, and the next one dealt --------------------
    await page.goto(`http://localhost:${PORT}/?screen=board&qa=1`, { waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__gameQa !== undefined, null, { timeout: 10_000 });
    const run = await page.evaluate(PLAY_TO_CLEAR);
    if (run.error) {
        note(`could not clear a level: ${run.error}${run.left === undefined ? "" : ` (${run.left} tiles left)`}`);
    } else {
        if (run.left !== 0) note(`the board was not emptied (${run.left} tiles left)`);
        if (run.status !== "won") note(`clearing every tile ended "${run.status}", not "won"`);
        if (run.overlay !== "won") note(`the results overlay did not open (overlay="${run.overlay}")`);
        if (!(run.pearls > 0)) note("clearing a level paid no pearls");
        await shoot(page, "13-level-cleared.png");

        // Taking the next level must actually deal a different, playable board.
        await page.evaluate(() => {
            const button = [...document.querySelectorAll(".overlay-actions .btn-primary")][0];
            button?.click();
        });
        await page.waitForTimeout(2_000);
        const next = await page.evaluate(() => globalThis.__gameQa.snapshot());
        if (next.level !== run.startLevel + 1)
            note(`continuing went to level ${next.level}, expected ${run.startLevel + 1}`);
        if (!(next.tilesRemaining > 0)) note("the next level dealt an empty board");
        if (next.overlay !== "none") note(`the results overlay stayed up on the next level ("${next.overlay}")`);
        await shoot(page, "14-next-level.png");
        console.log(`  cleared level ${run.startLevel} -> dealt level ${next.level} (${next.tilesRemaining} tiles)`);
    }
}

const onlyPhone = process.argv.includes("--phone");
const viewports = onlyPhone ? VIEWPORTS.slice(0, 1) : VIEWPORTS;

fs.mkdirSync(outputDir, { recursive: true });

const server = await createServer({
    configFile: path.join(root, "vite.config.js"),
    logLevel: "silent",
    server: { port: PORT, strictPort: true },
});
await server.listen();

let browser;
const problems = [];
let shots = 0;

try {
    // Headless Chromium blocks audio until a user gesture, and there is no real
    // gesture here. Allowing autoplay is what makes the audio assertions above
    // measure the actual synth graph rather than a permanently locked context.
    browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });

    for (const viewport of viewports) {
        const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: viewport.scale,
        });
        const page = await context.newPage();
        page.on("pageerror", (error) => problems.push(`${viewport.name}: page error: ${error.message}`));
        page.on("console", (message) => {
            if (message.type() !== "error") return;
            problems.push(`${viewport.name}: console error: ${message.text()}`);
        });

        for (const shot of SCREENS) {
            const query = shot.screen ? `?screen=${shot.screen}&qa=1` : "?qa=1";
            await page.goto(`http://localhost:${PORT}/${query}`, { waitUntil: "load" });
            await page.waitForFunction(() => globalThis.__gameQa !== undefined, null, { timeout: 10_000 });
            // Value-gated surfaces hide themselves for a brand-new player, so a
            // default profile would photograph an empty shop on every run and
            // the real product cards would never be reviewed at all.
            if (shot.seedProgress) {
                await page.evaluate(() => globalThis.__gameQa.seedProgress(6, 3_200));
                await page.waitForTimeout(400);
            }
            await page.waitForTimeout(800);
            await shoot(page, `${viewport.name}-${shot.name}.png`);
            shots += 1;

            // Long screens hide their tail below the fold, and the tail is where
            // the fair-play notes and the finish picker live. Photograph the
            // bottom too, or half of a scrolling screen is never reviewed.
            const scrolled = await page.evaluate(() => {
                const region = document.querySelector("[data-testid='screen-scroll-region']");
                if (!region || region.scrollHeight <= region.clientHeight + 8) return false;
                region.scrollTop = region.scrollHeight;
                return true;
            });
            if (scrolled) {
                await page.waitForTimeout(300);
                await shoot(page, `${viewport.name}-${shot.name}-end.png`);
                shots += 1;
            }
        }

        // --- the board, dealt and played ------------------------------------
        await page.goto(`http://localhost:${PORT}/?screen=board&qa=1`, { waitUntil: "load" });
        await page.waitForFunction(() => globalThis.__gameQa !== undefined, null, { timeout: 10_000 });
        await page.waitForTimeout(900);
        await shoot(page, `${viewport.name}-08-board-dealt.png`);
        shots += 1;

        const result = await page.evaluate(PLAY_MOVES);
        if (result.error) {
            problems.push(`${viewport.name}: could not drive the board (${result.error})`);
        } else {
            if (result.missed > 0) {
                problems.push(
                    `${viewport.name}: ${result.missed} tap(s) would have hit the wrong tile — sprites are covering their neighbours`,
                );
            }
            if (!(result.scoreAfter > result.scoreBefore)) {
                problems.push(`${viewport.name}: taps did not score (${result.scoreBefore} → ${result.scoreAfter})`);
            }
            if (!(result.tilesAfter < result.tilesBefore)) {
                problems.push(
                    `${viewport.name}: taps did not clear tiles (${result.tilesBefore} → ${result.tilesAfter})`,
                );
            }
            console.log(
                `  ${viewport.name}: played ${result.played} moves, score ${result.scoreAfter}, combo ${result.combo}`,
            );
        }
        await shoot(page, `${viewport.name}-09-board-played.png`);
        shots += 1;

        // Prove the renderer actually produced a frame.
        //
        // Reading the canvas back in-page does NOT work: without
        // preserveDrawingBuffer a WebGL/WebGPU canvas is empty to drawImage,
        // which would report a false blank on a perfectly good frame. Compare
        // compressed screenshot sizes instead — a genuinely blank region is a
        // flat colour and compresses to almost nothing, while a board of frosted
        // tiles cannot.
        const clip = {
            x: viewport.width * 0.1,
            y: viewport.height * 0.35,
            width: viewport.width * 0.8,
            height: viewport.height * 0.25,
        };
        const region = await page.screenshot({ clip, animations: "disabled" });
        if (region.length < 3_000) {
            problems.push(`${viewport.name}: the board looks blank (${region.length} bytes of detail)`);
        }

        // Nothing may overflow the frame. The toolbar is three fixed-width tool
        // wells and the display titles are set in a serif that is wider than it
        // looks; both have overflowed a 360-wide phone during development.
        const fits = await page.evaluate(() => globalThis.__gameQa?.layoutFit() ?? []);
        if (fits.length === 0) problems.push(`${viewport.name}: no layout fit report`);
        for (const entry of fits) {
            if (entry.width > entry.viewport) {
                problems.push(
                    `${viewport.name}: "${entry.name}" is ${entry.width}px wide in a ${entry.viewport}px frame`,
                );
            }
        }

        // Both result overlays, seeded so they are reviewed on every run rather
        // than only when someone happens to finish a level by hand.
        for (const cleared of [true, false]) {
            await page.evaluate((won) => globalThis.__gameQa.showResult(won), cleared);
            await page.waitForTimeout(400);
            await shoot(page, `${viewport.name}-${cleared ? "10-result-won" : "11-result-lost"}.png`);
            shots += 1;
            const overflow = await page.evaluate(() => globalThis.__gameQa.layoutFit());
            for (const entry of overflow) {
                if (entry.width > entry.viewport) {
                    problems.push(
                        `${viewport.name}: result overlay "${entry.name}" is ${entry.width}px in a ${entry.viewport}px frame`,
                    );
                }
            }
        }

        const snapshot = await page.evaluate(() => globalThis.__gameQa?.snapshot() ?? null);
        if (!snapshot) problems.push(`${viewport.name}: QA contract did not install`);
        else console.log(`  ${viewport.name}: renderer=${snapshot.renderer} phase=${snapshot.phase}`);

        // The behaviour gates only need running once; the phone viewport is the
        // one that matters and repeating them just costs wall clock.
        if (viewport === viewports[0]) await checkBehaviour(page, problems);

        await context.close();
    }
} finally {
    await browser?.close();
    await server.close();
}

console.log(`\nWrote ${shots} screenshots to ${path.relative(root, outputDir)}`);
if (problems.length > 0) {
    console.error(`\nVisual QA failed (${problems.length}):`);
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
}
console.log("Visual QA passed: every screen rendered, every tap landed, and every match scored.");
