import { store } from "../../state/store.ts";
import { recordAnalytics, recordFunnelStep } from "../../sdk/runSdk.ts";
import packageJson from "../../../package.json";
import { countedSteps, createAnalytics } from "./analytics.ts";

/**
 * TIDEGLASS funnel registry.
 *
 * The funnel name and step 1 are UNCHANGED from what shipped: `game_loaded`
 * in `tideglass_first_play` already has history, and renaming a live funnel
 * discards its trend line. Steps 2+ are appended to the same funnel, which is
 * all that was ever missing — the old definition could prove the app loaded
 * and nothing else.
 *
 * Everything below step 1 names an event the game was already firing.
 *
 * Step names and numbers are frozen: add new beats at the end, never renumber.
 */
export const analytics = createAnalytics({
    emitEvent: (name, payload) => {
        void recordAnalytics(name, { ...payload, build_version: packageJson.version });
    },
    emitFunnelStep: (step, name, funnel, order) => {
        void recordFunnelStep(step, name, funnel, order);
    },
    funnels: {
        /**
         * The loading phase itself, ahead of the first-run funnel (order 0).
         *
         * The first-run funnel starts at "the game finished loading", so a player
         * who closed the tab during boot never appeared in it at all — a load
         * regression and a retention problem looked identical. Step 1 fires on the
         * first executable line, before any await, and is buffered until the SDK
         * transport is up.
         *
         * A separate funnel rather than steps prepended to the existing one,
         * because shipped step numbers must never be renumbered.
         */
        load: {
            order: 0,
            onceEver: true,
            steps: [
                "load_started", // first line of script execution
                "load_sdk_ready", // host handshake resolved
                "load_save_ready", // progress restored
                "load_assets_ready", // playable frame reachable
            ],
        },
        tideglass_first_play: {
            order: 1,
            onceEver: true,
            steps: [
                "game_loaded", // shipped step 1 — name and number preserved
                "first_level_started", // pressed play
                "first_match", // first core-verb interaction
                "first_level_cleared", // first win — the "I get it" beat
                "first_results_viewed", // saw the results overlay
                "second_level_started", // came back for another level
            ],
        },
        // Repeatable: how deep players get across their first 12 levels.
        engagement: { order: 2, steps: countedSteps("level_cleared_", 12) },
        /**
         * Store conversion. Every step below is an event this game was already
         * firing; without the declaration the dashboard could show that purchases
         * happened but not where the other players dropped out of the flow.
         *
         * Repeatable (not onceEver): a player can buy more than once, and each
         * pass through the store should count.
         */
        purchase: {
            order: 3,
            steps: [
                "monetization_surface_viewed", // the store/offer was actually seen
                "purchase_tapped", // a specific product was chosen
                "checkout_started", // the host purchase sheet was requested
                "checkout_result", // the host returned a verdict
            ],
        },
    },
    enrich: () => {
        const state = store.get();
        return {
            level: state.level,
            highest_level: state.highestLevel,
            total_plays: state.totalPlays,
        };
    },
    marksKey: "tideglass_funnel_marks",
    debug: import.meta.env.DEV,
});

/** The funnel whose steps this game's first session is measured by. */
export const FIRST_PLAY_FUNNEL = "tideglass_first_play";
