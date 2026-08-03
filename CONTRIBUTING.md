# Contributing

## Before you change anything

Run the checks. `npm run check` covers formatting, lint, the simulation, the
public-repo audit and both production builds.

```sh
npm run check
npm run visual-qa    # needs a browser; not part of `check`
```

## Where a change belongs

- **A rule** — `src/game/mahjong/`. This directory imports no Pixi, no React and
  no store, and it must stay that way: it is the only reason `npm run simulate`
  can prove anything.
- **Something you can see** — `src/game/scene/` for the board, `src/ui/` for the
  React shell, `src/game/art/` for the pixels.
- **Anything that touches the platform** — behind the facade in
  `src/sdk/runSdk.ts`. Nothing outside it may call `RundotGameAPI` directly.

## Rules that are not negotiable

- **Never `Math.random()` in game logic.** Use `src/game/noiseRandom.ts` so a
  board can be reproduced from its seed. Security identifiers use Web Crypto.
- **Never grant anything on trust.** Pearls come from a level the engine says
  was cleared, ad rewards from a host-verified completion, and entitlements from
  a live entitlement read — never from a local flag or a save file.
- **Never simulate a successful purchase, ad reward or entitlement.**

## If you touch a layout or the difficulty

Re-run `npm run balance` and re-sort the layout order in
`src/game/mahjong/levels.ts` if the measured win rates have moved. The ladder is
ordered by measured difficulty, not by tile count, and the sweep asserts the
curve still declines.

## If you touch the tile art or the painted plates

Re-run `npm run thumbnail`. The store tile composites the painted plates with
real tile faces from the same generator the board uses, so any art change must
be re-baked or the store tile drifts away from the game.

New painted art goes through the `codex-image-gen` skill, then
`bg-removal-softshadows` (chroma engine) for anything needing an alpha channel,
then a despill pass — green spill on thin edges survives a plain key. Backdrops
ship as JPEG because they are opaque; only cutouts need PNG.

## Reporting a security issue

See `SECURITY.md`. Never include real credentials, tokens, player records or RUN
session files.
