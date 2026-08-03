import process from "node:process";
import { createServer } from "vite";

const SESSION_COUNT = 600;
const BASE_SEED = 0x5eed1234;

// Execute the same TypeScript source that ships in the game. This keeps the
// headless proof honest without maintaining a second JavaScript implementation.
const sourceLoader = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true },
});
const { NoiseRandom } = await sourceLoader.ssrLoadModule("/src/game/noiseRandom.ts");
await sourceLoader.close();

/** Shared deterministic RNG for simulations, replays, and reproducible tests. */
export function createSeededRandom(seed) {
    const random = new NoiseRandom(seed >>> 0, 0);
    return () => random.nextDouble();
}

/**
 * Neutral risk/reward model used only to demonstrate a headless proof loop.
 * Replace this model with the derived game's real deterministic core.
 */
export function simulateSession(seed) {
    const random = createSeededRandom(seed);
    const turns = 16;
    const targetProgress = 26;
    let progress = 0;
    let score = 0;
    let lives = 3;

    for (let turn = 0; turn < turns && lives > 0 && progress < targetProgress; turn += 1) {
        const remainingTurns = turns - turn;
        const progressNeeded = targetProgress - progress;
        const mustPush = progressNeeded > remainingTurns;
        const push = mustPush || random() < 0.46;
        const pressure = turn / turns;
        const failureChance = (push ? 0.2 : 0.08) + pressure * 0.08;

        if (random() < failureChance) {
            lives -= 1;
            continue;
        }

        const gain = push ? 2 + Math.floor(random() * 3) : 1 + Math.floor(random() * 2);
        progress += gain;
        score += gain * 100 + (push ? 50 : 0);
    }

    return {
        seed,
        won: progress >= targetProgress,
        progress,
        score,
        lives,
    };
}

export function runBatch(count = SESSION_COUNT, baseSeed = BASE_SEED) {
    const results = Array.from({ length: count }, (_, index) => simulateSession((baseSeed + index) >>> 0));
    const wins = results.filter((result) => result.won).length;
    const scores = results.map((result) => result.score);
    return {
        sessions: count,
        baseSeed,
        wins,
        winRate: wins / count,
        averageScore: scores.reduce((sum, score) => sum + score, 0) / count,
        minScore: Math.min(...scores),
        maxScore: Math.max(...scores),
        uniqueScores: new Set(scores).size,
    };
}

function verify() {
    const first = simulateSession(BASE_SEED);
    const replay = simulateSession(BASE_SEED);
    if (JSON.stringify(first) !== JSON.stringify(replay)) {
        throw new Error("Identical seeds must produce identical sessions");
    }

    const summary = runBatch();
    if (summary.winRate < 0.25 || summary.winRate > 0.85) {
        throw new Error(`Reference model win rate ${summary.winRate.toFixed(3)} is outside its review band`);
    }
    if (summary.uniqueScores < 20) {
        throw new Error(`Reference model produced only ${summary.uniqueScores} unique scores`);
    }
    return summary;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    const summary = verify();
    console.log(
        JSON.stringify(
            {
                ...summary,
                winRate: Number(summary.winRate.toFixed(3)),
                averageScore: Math.round(summary.averageScore),
            },
            null,
            2,
        ),
    );
}
