import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function inspectPng(relativePath) {
    const bytes = fs.readFileSync(path.join(root, relativePath));
    const signature = "89504e470d0a1a0a";
    expect(bytes.subarray(0, 8).toString("hex") === signature, `${relativePath} is not a valid PNG`);
    return {
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
        bitDepth: bytes[24],
        colorType: bytes[25],
        bytes: bytes.length,
    };
}

function expect(condition, message) {
    if (!condition) failures.push(message);
}

function sourceFiles(directory) {
    const absolute = path.join(root, directory);
    return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
        const relative = path.join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(relative);
        return /\.(?:ts|tsx)$/.test(entry.name) ? [relative] : [];
    });
}

function textFiles(directory = ".") {
    const absolute = path.join(root, directory);
    return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
        if (["dist", "node_modules"].includes(entry.name)) return [];
        const relative = path.join(directory, entry.name);
        if (entry.isDirectory()) return textFiles(relative);
        return /(?:^|\/)(?:\.editorconfig|\.gitattributes|\.gitignore)$|\.(?:css|csv|html|js|json|md|mjs|ts|tsx|ya?ml)$/i.test(
            relative,
        )
            ? [relative]
            : [];
    });
}

function containsNamedEntry(directory, name) {
    const absolute = path.join(root, directory);
    return fs.readdirSync(absolute, { withFileTypes: true }).some((entry) => {
        if (entry.name === name) return true;
        if (!entry.isDirectory() || ["dist", "node_modules"].includes(entry.name)) return false;
        return containsNamedEntry(path.join(directory, entry.name), name);
    });
}

function emptyDirectories(directory) {
    const absolute = path.join(root, directory);
    return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
        if (!entry.isDirectory() || ["dist", "node_modules"].includes(entry.name)) return [];
        const relative = path.join(directory, entry.name);
        const children = fs.readdirSync(path.join(root, relative));
        return children.length === 0 ? [relative] : emptyDirectories(relative);
    });
}

const packageJson = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const readme = read("README.md");
const gitignore = read(".gitignore");
const vite = read("vite.config.js");
const catalog = read("src/sdk/capabilityCatalog.ts");
const featureLab = read("src/ui/RunFeaturesScreen.tsx");
const featureLabSdk = read("src/sdk/featureLab.ts");
const audioManager = read("src/audio/audioManager.ts");
const appStyles = read("src/styles/app.css");
const platformIds = read("src/config/platform.ts");
const prodConfig = JSON.parse(read("game.config.prod.json"));
const tsconfig = JSON.parse(read("tsconfig.json"));
const serverTime = read("src/systems/serverTime.ts");
const saveSystem = read("src/systems/save.ts");
const runSdk = read("src/sdk/runSdk.ts");
const main = read("src/main.tsx");
const app = read("src/ui/App.tsx");
const gameCanvas = read("src/game/GameCanvas.tsx");
const pixiApp = read("src/game/pixiApp.ts");
const stage = read("src/game/stage.ts");
const rendererLab = read("src/rendering/createRendererLab.ts");
const rendererLifecycle = read("src/rendering/rendererLifecycle.ts");
const threeReference = read("src/rendering/three/createThreeReference.ts");
const pixiOverlay = read("src/rendering/pixi/createPixiOverlay.ts");
const multiResolution = read("docs/multi-resolution.md");
const monetizationGuide = read("docs/monetization.md");
const renderingArchitecture = read("docs/rendering-architecture.md");
const thirdPartyNotices = read("THIRD_PARTY_NOTICES.md");
const contributing = read("CONTRIBUTING.md");
const localAgents = read("AGENTS.md");
const img2threejsSkill = read(".agents/skills/img2threejs/SKILL.md");
const multiplayerSkill = read(".agents/skills/rundot-multiplayer/SKILL.md");
const multiplayerSources = read(".agents/skills/rundot-multiplayer/references/source-map.md");
const multiplayerCapabilities = read(".agents/skills/rundot-multiplayer/references/capability-map.md");
const developmentPreview = read("src/dev/preview.ts");
const developmentTools = read("src/dev/DevelopmentTools.tsx");
const verificationGuide = read("docs/verification.md");
const deterministicSimulationGuide = read("docs/deterministic-simulation.md");
const randomnessGuide = read("docs/randomness.md");
const visualAssetsGuide = read("docs/visual-assets.md");
const simulation = read("scripts/simulate-demo.mjs");
const noiseRandom = read("src/game/noiseRandom.ts");
const particles = read("src/game/particles.ts");
const assetManifest = read("src/assets/manifest.ts");
const publicAudit = read("scripts/audit-public.mjs");
const e2eSmoke = read("e2e/template.smoke.spec.ts");
const buildCheck = read("scripts/check-build.mjs");
const runtimeServices = read("src/systems/runtimeServices.ts");

expect(/^\d+\.\d+\.\d+$/.test(packageJson.version), "package version must be semver");
expect(packageJson.name === "rundot_template", "package name must match the repository identity");
expect(lock.version === packageJson.version, "package-lock root version must match package.json");
expect(lock.packages?.[""]?.version === packageJson.version, "package-lock package version must match package.json");
expect(packageJson.private === true, "template must prevent accidental npm publication");
expect(packageJson.license === "SEE LICENSE IN LICENSE.md", "package metadata must point to LICENSE.md");
expect(packageJson.engines?.node === ">=22.0.0", "supported Node.js baseline must remain explicit");
expect(packageJson.dependencies?.react === "19.2.4", "React must match the SDK 5.24 embedded-library version");
expect(
    packageJson.dependencies?.["react-dom"] === "19.2.4",
    "React DOM must match the SDK 5.24 embedded-library version",
);
expect(packageJson.dependencies?.three === "^0.185.1", "Three.js renderer reference must remain versioned");
expect(packageJson.devDependencies?.["@types/three"] === "^0.185.1", "Three.js types must match the runtime package");
expect(
    packageJson.devDependencies?.["@playwright/test"] === "^1.62.0",
    "responsive browser verification must remain versioned",
);
expect(
    lock.packages?.["node_modules/@playwright/test"]?.version === "1.62.0",
    "Playwright lockfile version changed without review",
);
expect(
    packageJson.scripts?.simulate === "node scripts/simulate-demo.mjs",
    "deterministic simulation command is missing",
);
expect(packageJson.scripts?.["audit:public"] === "node scripts/audit-public.mjs", "public audit command is missing");
expect(packageJson.scripts?.["test:e2e"] === "playwright test", "responsive browser test command is missing");
expect(packageJson.allowScripts?.["esbuild@0.25.12"] === true, "reviewed esbuild install script must remain pinned");
expect(
    packageJson.allowScripts?.["@series-inc/rundot-game-sdk@5.24.0"] === true,
    "reviewed SDK install hint must remain pinned",
);
expect(
    packageJson.allowScripts?.["@firebase/util"] === false,
    "Firebase install-time network configuration must stay disabled",
);
expect(packageJson.allowScripts?.fsevents === false, "prebuilt fsevents must not invoke an implicit native build");
expect(packageJson.allowScripts?.protobufjs === false, "unneeded protobuf install script must stay disabled");
expect(
    /^\d+\.\d+\.\d+$/.test(packageJson.dependencies?.firebase ?? ""),
    "Firebase must remain pinned for SDK 5.24 Playground dynamic imports",
);
expect(
    read("src/ui/MainMenu.tsx").includes("packageJson.version"),
    "visible template version must come from package.json",
);
expect(readme.startsWith("# rundot_template\n"), "README heading must match the repository name");
expect(
    readme.includes("git clone https://github.com/LorenzGit/rundot_template.git"),
    "README clone command must use the current repository URL",
);
expect(
    readme.includes("Run Bits monetization") &&
        /Direct-fiat products and subscriptions are\s+optional additions/.test(readme),
    "README must state that Run Bits purchases and ads are the required ship-track channels",
);
expect(
    localAgents.includes("product priced in **RB (Run Bits)**") &&
        localAgents.includes('price.type: "bucks"') &&
        localAgents.includes("do not replace the Run Bits requirement"),
    "AGENTS.md must require a Run Bits Shop product rather than generic purchase monetization",
);
expect(
    monetizationGuide.includes("## What counts as Run Bits monetization") &&
        monetizationGuide.includes("rundot/shop.config.json") &&
        monetizationGuide.includes('"price": { "type": "bucks", "value": "100" }') &&
        monetizationGuide.includes("## Ship-track definition of done"),
    "monetization guide must define the complete Run Bits vertical slice",
);
expect(
    featureLabSdk.includes("RUN BITS") && !featureLabSdk.includes("RUNBUCKS"),
    "player-facing monetization terminology must say Run Bits, not RunBucks",
);
expect(
    !/RUN Pixi WebGPU template/i.test(`${readme}\n${contributing}`),
    "public documentation still uses the retired Pixi-only template identity",
);
expect(!/Current template version:/i.test(readme), "README must not carry a manually duplicated current version");

for (const dependency of Object.keys(packageJson.dependencies)) {
    const version = lock.packages?.[`node_modules/${dependency}`]?.version;
    expect(
        typeof version === "string" && thirdPartyNotices.includes(`| \`${dependency}\` | ${version} |`),
        `third-party notice is missing the locked ${dependency} version`,
    );
}

for (const required of [
    ".agents/skills/img2threejs/LICENSE",
    ".agents/skills/img2threejs/SKILL.md",
    ".agents/skills/img2threejs/forge/stage1_intake/probe_image.py",
    ".agents/skills/img2threejs/forge/stage2_spec/validate_sculpt_spec.py",
    ".agents/skills/img2threejs/forge/stage3_build/generate_threejs_factory.py",
    ".agents/skills/img2threejs/forge/stage4_review/divine_eye.py",
    ".agents/skills/img2threejs/grimoire/build/geometry_patterns.md",
    ".agents/skills/img2threejs/grimoire/feedback/render_capture.md",
    ".agents/skills/img2threejs/grimoire/intake/validation_rubric.md",
    ".agents/skills/rundot-multiplayer/SKILL.md",
    ".agents/skills/rundot-multiplayer/agents/openai.yaml",
    ".agents/skills/rundot-multiplayer/references/capability-map.md",
    ".agents/skills/rundot-multiplayer/references/security-and-authority.md",
    ".agents/skills/rundot-multiplayer/references/source-map.md",
    ".agents/skills/rundot-multiplayer/references/syncplay.md",
    ".agents/skills/rundot-multiplayer/references/testing-and-operations.md",
    ".gitattributes",
    ".github/workflows/ci.yml",
    ".gitignore",
    ".npmignore",
    "AGENTS.md",
    "CONTRIBUTING.md",
    "LICENSE.md",
    "SECURITY.md",
    "THIRD_PARTY_NOTICES.md",
    "docs/audio.md",
    "docs/deterministic-simulation.md",
    "docs/monetization.md",
    "docs/multi-resolution.md",
    "docs/randomness.md",
    "docs/rendering-architecture.md",
    "docs/run-capabilities.md",
    "docs/rundot-cli.md",
    "docs/runtime.md",
    "docs/verification.md",
    "docs/visual-assets.md",
    "e2e/fixtures.ts",
    "e2e/template.smoke.spec.ts",
    "playwright.config.ts",
    "scripts/audit-public.mjs",
    "scripts/check-build.mjs",
    "scripts/simulate-demo.mjs",
    "scripts/test-noise-random.mjs",
    "additional_features/README.md",
    "additional_features/client/commerce.ts",
    "additional_features/client/navigation.ts",
    "additional_features/client/runtime.ts",
    "additional_features/client/assets.ts",
    "additional_features/client/notifications.ts",
    "additional_features/client/content.ts",
    "additional_features/client/generation.ts",
    "additional_features/client/guards.ts",
    "additional_features/client/progression.ts",
    "additional_features/multiplayer/realtimeClient.ts",
    "additional_features/client/moderation.ts",
    "additional_features/multiplayer/realtimeServer.ts",
    "additional_features/multiplayer/syncplay.ts",
    "additional_features/config/leaderboard.config.json",
    "additional_features/config/liveops.config.json",
    "additional_features/config/rooms.syncplay.config.json",
    "additional_features/config/shop.config.json",
    "additional_features/config/simulation/entities.json",
    "additional_features/config/simulation/lifecycle.json",
    "additional_features/config/simulation/recipes.json",
    "rundot/realtime.config.json",
    "src/assets/strings.csv",
    "src/assets/art/pixel-foundry-backdrop-portrait.png",
    "src/assets/art/pixel-foundry-backdrop-wide.png",
    "src/dev/DevelopmentTools.tsx",
    "src/dev/preview.ts",
    "src/game/particles.ts",
    "src/game/noiseRandom.ts",
    "src/game/tween.ts",
    "src/rendering/createRendererLab.ts",
    "src/rendering/pixi/createPixiOverlay.ts",
    "src/rendering/rendererLifecycle.ts",
    "src/rendering/three/createThreeReference.ts",
    "src/sdk/featureLab.ts",
    "src/systems/serverTime.ts",
    "src/ui/RenderingLabScreen.tsx",
    "src/ui/RunFeaturesScreen.tsx",
    "tsconfig.additional-features.json",
]) {
    expect(fs.existsSync(path.join(root, required)), `required reference is missing: ${required}`);
}

const portraitBackdrop = inspectPng("src/assets/art/pixel-foundry-backdrop-portrait.png");
const wideBackdrop = inspectPng("src/assets/art/pixel-foundry-backdrop-wide.png");
expect(
    portraitBackdrop.width === 1024 && portraitBackdrop.height === 1536,
    "portrait backdrop must preserve its reviewed 2:3 source dimensions",
);
expect(
    wideBackdrop.width === 1536 && wideBackdrop.height === 1024,
    "wide backdrop must preserve its reviewed 3:2 source dimensions",
);
for (const [name, metadata] of [
    ["portrait", portraitBackdrop],
    ["wide", wideBackdrop],
]) {
    expect(metadata.bitDepth === 8 && metadata.colorType === 2, `${name} backdrop must remain an 8-bit RGB PNG`);
    expect(metadata.bytes <= 2_500_000, `${name} backdrop exceeds the reviewed 2.5 MB source budget`);
}
expect(
    assetManifest.includes('window.matchMedia("(orientation: landscape)")') &&
        assetManifest.includes("menu-backdrop-active") &&
        assetManifest.includes("menu-backdrop-alternate"),
    "asset manifest must preload the active backdrop and defer its orientation alternate",
);
expect(
    appStyles.includes('url("../assets/art/pixel-foundry-backdrop-portrait.png")') &&
        appStyles.includes('url("../assets/art/pixel-foundry-backdrop-wide.png")') &&
        appStyles.includes("background-size:") &&
        appStyles.includes("cover"),
    "stylesheet must select both original backdrop compositions without stretching",
);
expect(
    visualAssetsGuide.includes("real, original PNG artwork") &&
        visualAssetsGuide.includes("calm central 45%") &&
        visualAssetsGuide.includes("separate compositions") &&
        visualAssetsGuide.includes("Never stretch one image"),
    "visual asset provenance, crop safety, and aspect-ratio guidance are incomplete",
);
expect(
    localAgents.includes("original portrait and landscape PNG art") &&
        localAgents.includes("docs/visual-assets.md") &&
        localAgents.includes("document crop-safe regions"),
    "AGENTS.md must preserve the authored-art quality and aspect-ratio workflow",
);

expect(
    /^name:\s*img2threejs$/m.test(img2threejsSkill) && /^\s+version:\s*["']1\.3\.0["']$/m.test(img2threejsSkill),
    "vendored img2threejs skill identity or reviewed version changed",
);
expect(
    localAgents.includes(".agents/skills/img2threejs/SKILL.md") && localAgents.includes("not a runtime dependency"),
    "AGENTS.md must route and scope the project-local img2threejs skill",
);
expect(
    localAgents.includes("NoiseRandom") && localAgents.includes("Math.random()") && localAgents.includes("ctx.random"),
    "AGENTS.md must require NoiseRandom while preserving the SyncPlay RNG authority boundary",
);
expect(
    randomnessGuide.includes("NoiseRandom.randomize(seed, position, salt)") &&
        randomnessGuide.includes("Do not use `Math.random()`") &&
        randomnessGuide.includes("ctx.random"),
    "deterministic randomness guidance is incomplete",
);
expect(
    noiseRandom.includes("Math.imul") &&
        noiseRandom.includes("0xb529_7a4d") &&
        noiseRandom.includes("0x68e3_1da4") &&
        noiseRandom.includes("0x1b56_c4e9"),
    "NoiseRandom must preserve the reviewed C# uint32 noise constants and multiplication semantics",
);
expect(
    particles.includes('import { NoiseRandom } from "./noiseRandom.ts"') &&
        particles.includes("random = new NoiseRandom()"),
    "template particle randomness must use NoiseRandom",
);
for (const sourceFile of sourceFiles("src")) {
    expect(!read(sourceFile).includes("Math.random("), `${sourceFile} must use NoiseRandom instead of Math.random()`);
}
expect(
    thirdPartyNotices.includes("7b1c62ccf34957ac5d68b7863718af9eab777c7e") &&
        thirdPartyNotices.includes(".agents/skills/img2threejs/LICENSE"),
    "third-party notices must pin and license the vendored img2threejs skill",
);
expect(
    !containsNamedEntry(".agents/skills/img2threejs", ".git"),
    "vendored skills must not contain nested Git metadata",
);
expect(/^name:\s*rundot-multiplayer$/m.test(multiplayerSkill), "project-local multiplayer skill identity changed");
for (const feature of [
    "persistent worlds",
    "SeasonSchedule",
    "broadcastDelta",
    "shared economy",
    "TurnManager",
    "matchmakeRoom",
    "room chat",
    "SyncPlay",
]) {
    expect(
        multiplayerSkill.toLowerCase().includes(feature.toLowerCase()) ||
            multiplayerCapabilities.toLowerCase().includes(feature.toLowerCase()),
        `multiplayer knowledge is missing ${feature}`,
    );
}
expect(
    multiplayerSources.includes("node_modules/@series-inc/rundot-game-sdk") &&
        multiplayerSources.includes("https://series-1.gitbook.io/rundot-docs/readme/multiplayer") &&
        multiplayerSources.includes("advanced-multiplayer"),
    "multiplayer source map must route installed and live official documentation",
);
for (const document of [
    "MULTIPLAYER.md",
    "ADVANCED-MULTIPLAYER.md",
    "SYNCPLAY.md",
    "SYNCPLAY-SECRETS.md",
    "SYNCPLAY-PHYSICS.md",
    "SYNCPLAY-MOVEMENT.md",
    "SYNCPLAY-PATHFINDING.md",
    "SYNCPLAY-BOTS.md",
    "SYNCPLAY-ANIMATION.md",
    "SYNCPLAY-LAG-COMPENSATION.md",
    "SERVER_AUTHORITATIVE.md",
    "SIMULATION_CONFIG.md",
]) {
    expect(multiplayerSources.includes(document), `multiplayer source map is missing ${document}`);
}
expect(
    localAgents.includes(".agents/skills/rundot-multiplayer/SKILL.md"),
    "AGENTS.md must route the project-local multiplayer skill",
);
for (const unnecessary of ["README.md", "CHANGELOG.md", "INSTALLATION_GUIDE.md", "QUICK_REFERENCE.md"]) {
    expect(
        !fs.existsSync(path.join(root, ".agents/skills/rundot-multiplayer", unnecessary)),
        `multiplayer skill contains unnecessary file: ${unnecessary}`,
    );
}

for (const option of [
    "strict",
    "exactOptionalPropertyTypes",
    "noFallthroughCasesInSwitch",
    "noImplicitReturns",
    "noUncheckedIndexedAccess",
    "noUnusedLocals",
    "noUnusedParameters",
]) {
    expect(tsconfig.compilerOptions?.[option] === true, `tsconfig must enable ${option}`);
}

const expectedCapabilities = [
    "host",
    "access",
    "lifecycle",
    "app",
    "profile",
    "system",
    "feature-gates",
    "numbers",
    "navigation",
    "popups",
    "logging",
    "storage",
    "shared-storage",
    "files",
    "cdn",
    "asset-loader",
    "preloader",
    "analytics",
    "attribution",
    "liveops",
    "time",
    "notifications",
    "haptics",
    "gamepad",
    "audio-generation",
    "ads",
    "shop",
    "iap",
    "entitlements",
    "creator-credits",
    "stats",
    "leaderboards",
    "collectibles",
    "simulation",
    "social",
    "clips",
    "ugc",
    "video",
    "text-generation",
    "image-generation",
    "sprite-generation",
    "video-generation",
    "3d-generation",
    "avatar-3d",
    "multiplayer",
    "syncplay",
];
for (const id of expectedCapabilities) {
    expect(new RegExp(`id:\\s*["']${id}["']`).test(catalog), `capability catalog is missing: ${id}`);
}

for (const match of catalog.matchAll(/source:\s*["']([^"']+)["']/g)) {
    expect(fs.existsSync(path.join(root, match[1])), `catalog source does not exist: ${match[1]}`);
}

const deprecated = [
    ["initializeAsync(", "manual SDK initialization"],
    ["scheduleAsync(", "deprecated notification scheduling"],
    ["scheduleRCSAsync(", "deprecated RCS scheduling"],
    [".rooms.", "deprecated rooms V1"],
    ["getCurrentProfile(", "deprecated profile accessor"],
    ["getExperiment(", "deprecated platform experiment accessor"],
];
for (const file of [...sourceFiles("src"), ...sourceFiles("additional_features")]) {
    const contents = read(file);
    for (const [needle, label] of deprecated) {
        expect(!contents.includes(needle), `${file} uses ${label}`);
    }
}

expect(prodConfig.gameId.startsWith("REPLACE_WITH_"), "template production game ID must remain fail-closed");
expect(prodConfig.orientation === "Both", "responsive template production orientation must remain Both");
expect(Array.isArray(prodConfig.keywords), "template production keywords field must remain explicit");
expect(prodConfig.kitId === null, "template production kitId field must remain explicit");
expect(vite.includes("rundotGameLibrariesPlugin()"), "RUN embedded-library plugin must be enabled");
expect(vite.includes('three: ["three/webgpu"]'), "Three renderer reference must remain in its own lazy build chunk");
expect(/process\.env\.RUNDOT_PLAYGROUND\s*===\s*["']1["']/.test(vite), "Playground must remain explicit opt-in");
expect(
    /process\.env\.RUNDOT_MULTIPLAYER\s*===\s*["']1["']/.test(vite),
    "multiplayer server must remain explicit opt-in",
);
expect(/process\.env\.RUNDOT_SYNCPLAY\s*===\s*["']1["']/.test(vite), "Syncplay checker must remain explicit opt-in");
expect(
    /screen:\s*["']run-features["']/.test(read("src/ui/MainMenu.tsx")),
    "RUN Feature Lab must remain visible from the main menu",
);
expect(
    app.includes('lazy(() => import("./RenderingLabScreen.tsx"))') && app.includes('screen === "rendering-lab"'),
    "Rendering Lab must remain a lazy route",
);
expect(runSdk.includes("RundotGameAPI.triggerHapticAsync"), "haptics must use the SDK root trigger");
expect(!/sdkNamespace\(["']haptics["']\)/.test(runSdk), "haptics must not probe a nonexistent runtime namespace");
expect(runSdk.includes("RundotGameAPI.requestTimeAsync()"), "trusted time must use the SDK 5.24 root API");
expect(!/sdkNamespace\(["']time["']\)/.test(runSdk), "trusted time must not probe a nonexistent runtime namespace");
expect(serverTime.includes("performance.now()"), "trusted-time deltas must use a monotonic clock");
expect(
    featureLabSdk.includes("RundotGameAPI.getFutureTimeAsync") &&
        featureLabSdk.includes("RundotGameAPI.formatTime(serverTime, {})"),
    "Feature Lab must exercise trusted future time with the required formatting options",
);
expect(runSdk.includes("analytics.trackFunnelStep"), "portfolio funnel analytics must have an executable facade");
expect(runSdk.includes("RundotGameAPI.requestPopOrQuit"), "root Android back must delegate to the host");
expect(
    main.includes("onBackButton") && main.includes("requestHostExit"),
    "the active demo must register Android back navigation",
);
expect(
    main.includes('state.menuScreen === "rendering-lab"') && main.includes('menuScreen: "run-features"'),
    "Android back must return the nested Rendering Lab to RUN Features",
);
expect(
    main.includes("unhandledrejection") && main.includes("event.preventDefault()"),
    "host crashes need a final rejection guard",
);
expect(
    pixiApp.includes('initializeRenderer(scope, host, "webgpu")') &&
        pixiApp.includes('initializeRenderer(scope, host, "webgl")'),
    "default Pixi initialization must explicitly retry WebGL after a WebGPU device failure",
);
expect(
    gameCanvas.includes('acquireRendererRuntime("pixi-game"') &&
        rendererLab.includes('acquireRendererRuntime("renderer-lab"'),
    "every renderer composition must acquire the realm-wide lifecycle queue",
);
expect(
    rendererLifecycle.includes('Symbol.for("rundot.renderer-lifecycle")') &&
        rendererLifecycle.includes("maximumConcurrentInitializations") &&
        rendererLifecycle.includes('scope.signal.aborted || info.reason === "destroyed"'),
    "renderer lifecycle must remain realm-stable, observable, and device-loss aware",
);
for (const sourceFile of sourceFiles("src")) {
    if (sourceFile === "src/rendering/rendererLifecycle.ts") continue;
    const contents = read(sourceFile);
    expect(
        !contents.includes("app.destroy("),
        `${sourceFile} destroys a Pixi Application outside the lifecycle manager`,
    );
    expect(
        !contents.includes("renderer.dispose("),
        `${sourceFile} destroys a Three renderer outside the lifecycle manager`,
    );
}
expect(
    rendererLab.includes('import("./three/createThreeReference.ts")') &&
        rendererLab.includes('import("./pixi/createPixiOverlay.ts")'),
    "renderer references must remain lazy-loaded by composition",
);
expect(
    rendererLab.includes("requestAnimationFrame(tick)") &&
        !threeReference.includes("requestAnimationFrame") &&
        !pixiOverlay.includes("requestAnimationFrame"),
    "hybrid rendering must use one coordinator-owned animation loop",
);
expect(
    threeReference.includes("new THREE.WebGPURenderer") &&
        threeReference.includes("forceWebGL") &&
        threeReference.includes("renderer.clearDepth()") &&
        threeReference.includes('requestedBackend === "webgpu"') &&
        threeReference.includes("strict WebGPU QA mode"),
    "Three-only reference must include WebGPU/WebGL selection and a Three-rendered UI pass",
);
expect(
    pixiOverlay.includes("backgroundAlpha: 0") &&
        pixiOverlay.includes("autoStart: false") &&
        pixiOverlay.includes("app.render()"),
    "hybrid Pixi UI must be transparent and coordinator-driven",
);
expect(
    saveSystem.includes("pendingSave") && saveSystem.includes("flushInFlight"),
    "save writes must remain serialized and coalesced",
);
expect(
    runSdk.includes("legacyIds") &&
        runtimeServices.includes('const RETURN_REMINDER_ID = "rundot-template-return-reminder"') &&
        runtimeServices.includes('const LEGACY_RETURN_REMINDER_ID = "template-pixi-return-reminder"'),
    "notification identity changes must cancel the legacy reminder before scheduling the current one",
);
expect(featureLab.includes("RUN_CAPABILITIES.map"), "Feature Lab must render the complete capability catalog");
expect(
    featureLab.includes("TRY REWARDED +100") && featureLab.includes("TRY INTERSTITIAL"),
    "Feature Lab must expose both ad flows",
);
expect(featureLab.includes("OPEN RENDERING LAB"), "Feature Lab must expose the renderer references");
expect(
    /\[["']light["'],\s*["']success["'],\s*["']warning["']\]/.test(featureLab),
    "Feature Lab must expose the haptic palette",
);
for (const action of [
    "HOST SNAPSHOT",
    "PLAYER DATA",
    "MEMBER SIGN-IN",
    "LOADER + TOAST",
    "RELEASE NOTES",
    "COMMUNITY UI",
    "ADD TO HOME",
    "SHARE SCORE",
    "COMPOSE POST",
    "COPY STATUS",
]) {
    expect(featureLab.includes(action), `Feature Lab must expose ${action}`);
}
expect(
    audioManager.includes("MENU_PATTERN") && audioManager.includes("PLAY_PATTERN"),
    "procedural music must define menu and play motifs",
);
expect(
    audioManager.includes("lastCueAt") && audioManager.includes("suppressedSfx"),
    "procedural cues must remain rate-limited and observable",
);
expect(
    /rewardedResultsBonus:\s*["']template_results_bonus_rewarded["']/.test(platformIds),
    "rewarded ad flow needs a stable self-authored placement ID",
);
expect(
    /\.subscreen\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0/s.test(appStyles),
    "subscreens must be constrained to the game viewport",
);
expect(
    /\.subscreen-content\s*\{[^}]*min-height:\s*0[^}]*flex:\s*1[^}]*overflow-y:\s*auto/s.test(appStyles),
    "subscreen content must remain an independently scrollable flex child",
);
expect(
    /\.subscreen-content\s*\{[^}]*touch-action:\s*pan-y[^}]*-webkit-overflow-scrolling:\s*touch/s.test(appStyles),
    "subscreen content must allow momentum touch scrolling",
);
expect(
    /@media\s*\(orientation:\s*landscape\)[\s\S]*--game-w:\s*min\(100vw,\s*calc\(100dvh\s*\*\s*2\.2\)\)/.test(
        appStyles,
    ),
    "landscape must expand into a wide playable frame",
);
expect(
    /@media\s*\(orientation:\s*landscape\)[\s\S]*grid-template-areas:[\s\S]*"identity navigation"/.test(appStyles),
    "landscape menu must use its dedicated two-column composition",
);
expect(
    /@media\s*\(orientation:\s*landscape\)[\s\S]*\.menu-tile:last-child\s*\{[^}]*grid-column:\s*auto/s.test(appStyles),
    "all six landscape menu actions must remain balanced in the grid",
);
expect(
    stage.includes("app.screen.height / DESIGN_SHORT_EDGE") &&
        stage.includes("designWidth: () => _designWidth") &&
        stage.includes("designHeight: () => _designHeight"),
    "Pixi stage must adapt its fixed short edge across orientation changes",
);
for (const requirement of [
    "Full-viewport backdrop",
    "Playable frame",
    "Safe interactive area",
    "env(safe-area-inset-*)",
    "10 CSS pixels",
    "44×44 CSS pixels",
    "DPR 1, 2, and 3",
    "portrait → landscape → portrait",
]) {
    expect(multiResolution.includes(requirement), `multi-resolution guidance is missing: ${requirement}`);
}
for (const requirement of [
    "Pixi only",
    "Three only",
    "Three + Pixi",
    "npm run dev",
    "one frame clock",
    "Serialized renderer ownership",
    "?renderer=webgpu",
    "GPUDevice.lost",
    "10 CSS pixels",
    "Derive; do not copy",
]) {
    expect(renderingArchitecture.includes(requirement), `renderer guidance is missing: ${requirement}`);
}
expect(
    readme.includes("docs/rendering-architecture.md") && localAgents.includes("docs/rendering-architecture.md"),
    "README and agent guidance must route renderer selection to the architecture contract",
);
expect(
    runSdk.includes("if (!_ready) return area;"),
    "local browser safe-area environment fallbacks must not be overwritten with zero",
);
expect(
    app.includes('window.addEventListener("orientationchange", refreshSafeArea)') &&
        app.includes('window.removeEventListener("orientationchange", refreshSafeArea)') &&
        app.includes("applyRunSafeArea();"),
    "orientation changes must re-read safe areas with StrictMode-safe listener cleanup",
);
expect(
    main.includes("if (import.meta.env.DEV)") &&
        main.includes('await import("./dev/preview.ts")') &&
        developmentPreview.includes('new URLSearchParams(window.location.search).get("screen")'),
    "direct screen previews must remain development-only and query-driven",
);
expect(
    app.includes('import.meta.env.DEV ? lazy(() => import("../dev/DevelopmentTools.tsx")) : null') &&
        developmentTools.includes("requestAnimationFrame(update)") &&
        developmentTools.includes("SIMULATED INSET"),
    "development diagnostics must remain lazy, useful, and production-gated",
);
for (const marker of ["Development diagnostics", "RESET SESSION TUNING", "safeAreaRefreshCount"]) {
    expect(buildCheck.includes(marker), `production build check is missing development marker: ${marker}`);
}
for (const viewport of ["320, height: 568", "568, height: 320", "844, height: 390", "1440, height: 900"]) {
    expect(e2eSmoke.includes(viewport), `browser smoke matrix is missing viewport: ${viewport}`);
}
for (const browserContract of [
    "orientationchange",
    "data-safe-area-refresh-count",
    "screen-scroll-region",
    "screen-end",
    "smallestText",
]) {
    expect(e2eSmoke.includes(browserContract), `browser smoke coverage is missing: ${browserContract}`);
}
expect(
    simulation.includes("createSeededRandom") &&
        simulation.includes('ssrLoadModule("/src/game/noiseRandom.ts")') &&
        simulation.includes("Identical seeds must produce identical sessions") &&
        deterministicSimulationGuide.includes("cannot prove"),
    "deterministic simulation must preserve reproducibility and honest limits",
);
expect(
    publicAudit.includes("git") &&
        publicAudit.includes("credential-shaped value") &&
        verificationGuide.includes("npm run audit:public"),
    "public repository audit or its documentation is incomplete",
);
expect(
    readme.includes("docs/verification.md") &&
        readme.includes("docs/deterministic-simulation.md") &&
        localAgents.includes("docs/verification.md"),
    "README and agent guidance must route the lightweight verification tools",
);
for (const edge of ["top", "right", "bottom", "left"]) {
    expect(
        appStyles.includes(`--safe-${edge}: env(safe-area-inset-${edge}, 0px)`),
        `browser safe-area fallback is missing: ${edge}`,
    );
}

for (const ignored of [
    "node_modules/",
    "dist/",
    ".env",
    "game.config.playground.json",
    ".rundot/",
    "player-snapshot*",
    "campaign-state*",
    "coverage/",
    "test-results/",
]) {
    expect(gitignore.includes(ignored), `.gitignore is missing ${ignored}`);
}

const activeRundotFiles = fs.existsSync(path.join(root, "rundot"))
    ? fs.readdirSync(path.join(root, "rundot")).sort()
    : [];
expect(
    activeRundotFiles.length === 1 && activeRundotFiles[0] === "realtime.config.json",
    "only the SDK-required realtime config may be active under rundot/",
);

expect(!fs.existsSync(path.join(root, "start-game.bat")), "redundant browser-opening launcher must stay removed");
expect(!fs.existsSync(path.join(root, "examples")), "legacy examples/ directory must stay removed");
expect(!fs.existsSync(path.join(root, "tsconfig.examples.json")), "legacy examples tsconfig must stay removed");
expect(!fs.existsSync(path.join(root, "src/helpers")), "unused copied helper library must stay removed");
expect(!fs.existsSync(path.join(root, "public/images")), "unused placeholder image directory must stay removed");
expect(!containsNamedEntry(".", ".DS_Store"), "macOS .DS_Store metadata must not be committed");
for (const directory of ["additional_features", "docs", "public", "rundot", "scripts", "src"]) {
    for (const empty of emptyDirectories(directory)) failures.push(`empty directory must be removed: ${empty}`);
}

for (const file of textFiles()) {
    if (["scripts/check-template.mjs", "scripts/audit-public.mjs"].includes(file)) continue;
    const contents = read(file);
    expect(!/(?:\/Users\/|\/root\/|\\Users\\)/.test(contents), `${file} contains a developer-specific path`);
    expect(!/\.codex\//.test(contents), `${file} contains a private Codex path`);
    expect(!/\bgame-bot\b/i.test(contents), `${file} contains a private source reference`);
}

if (failures.length > 0) {
    console.error(`Template checks failed (${failures.length}):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
} else {
    console.log(`Template checks passed: ${expectedCapabilities.length} SDK capabilities mapped.`);
}
