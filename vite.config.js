import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { rundotGameLibrariesPlugin, rundotGamePlaygroundPlugin } from "@series-inc/rundot-game-sdk/vite";

const playgroundEnabled = process.env.RUNDOT_PLAYGROUND === "1";

const plugins = [rundotGameLibrariesPlugin(), react(), tailwindcss()];

// Playground talks to real RUN services and gates the page behind a Google
// sign-in, so it must never ambush ordinary `npm run dev`. Purchases made there
// are REAL and persistent.
if (playgroundEnabled) plugins.push(rundotGamePlaygroundPlugin());

export default defineConfig({
    // REQUIRED for RUN: deployed builds are served from a subdirectory, so all
    // asset URLs must be relative. Do not change this.
    base: "./",
    plugins,
    server: {
        allowedHosts: true,
        port: 5183,
    },
    build: {
        // Top-level await in the RUN SDK needs a modern target.
        target: "es2022",
        chunkSizeWarningLimit: 600,
        rollupOptions: {
            output: {
                /**
                 * Split the vendors that dominate the bundle into their own
                 * chunks. Without this the `bundled` build (which inlines the
                 * libraries the RUN host would otherwise provide) puts Firebase,
                 * React and the SDK together in one 620 kB entry chunk, which
                 * blows the build budget and re-downloads all of it on every
                 * game update. Each of these changes on its own cadence.
                 *
                 * Firebase is deliberately NOT listed: the SDK bundles it
                 * internally, so a `firebase` bucket only ever produces an empty
                 * chunk and a build warning.
                 */
                manualChunks(id) {
                    if (!id.includes("node_modules")) return undefined;
                    const after = id.split("node_modules/").pop() ?? "";
                    if (after.startsWith("pixi.js/")) return "pixi";
                    if (
                        after.startsWith("react/") ||
                        after.startsWith("react-dom/") ||
                        after.startsWith("scheduler/")
                    ) {
                        return "react";
                    }
                    if (after.startsWith("@series-inc/")) return "rundot";
                    return undefined;
                },
            },
        },
    },
    esbuild: { target: "es2022" },
    optimizeDeps: {
        esbuildOptions: {
            target: "es2022",
        },
    },
});
