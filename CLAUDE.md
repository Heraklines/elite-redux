# Elite Redux — project notes for Claude

Elite Redux (ER) is a PokeRogue fork (TypeScript + Phaser + Vite). This file is
auto-loaded every session — read it and follow it.

## 🔴 AUTHORITATIVE SOURCE — the ER 2.65 Pokédex

**The in-game Pokédex from Elite Redux version 2.65 is the SINGLE SOURCE OF
TRUTH for every move, ability, stat, type, and effect.** When anything in this
port disagrees with the 2.65 dex, the dex wins and the port is the bug. This
overrides the parsed C-source flag arrays, the vanilla PokeRogue values, and any
prior assumption.

- The dex data lives in the repo: `src/data/elite-redux/er-moves.ts`
  (`longDescription`, `description`, `flags`, power/accuracy/pp/type/category),
  `er-abilities.ts`, and `er-ability-rom-descriptions.ts` /
  `er-ability-descriptions.ts`. The human-readable **description text** is
  authoritative even when the parsed `flags` array disagrees (e.g. a move whose
  long description says "Keen Edge boost" IS a slicing move even if its `flags`
  array is empty — see #449).
- When a tester reports a divergence, confirm it against the 2.65 dex text
  FIRST, then fix the port to match. Do not guess from vanilla behavior.
- 🔴 **ER has its own custom weathers / terrains / statuses that are NOT vanilla**
  (Eerie Fog, Toxic Terrain, Bleed, Fear, Enrage, Drench, reworked Infatuation).
  Their authoritative maintainer-written definitions are in
  **`docs/er-custom-mechanics.md`** — READ IT before implementing or auditing
  anything that sets or reacts to them. Setting a *vanilla* weather/terrain/status
  where ER defines its own is a bug (e.g. Fog Machine must set ER **Eerie Fog**, a
  distinct Ghost/Psychic weather with no accuracy debuff — NOT vanilla
  `WeatherType.FOG`).

## 🔴 STANDING RULE — every bug fix gets an in-game test scenario

**Whenever you fix a bug (or change behavior) that is observable in-game, you
MUST add a matching scenario to the in-game dev TEST SUITE** so the maintainer
and the testing team can verify the fix on the testing site by themselves.

This is mandatory, not optional. Do it as part of the fix, in the same batch.

- **Where:** `src/dev-tools/test-suite/scenarios.ts` (tracked). Copy an existing
  block. Give it a short `label`, a `description` (the bug #, what to DO, what to
  EXPECT — testers read this), a `setup()` (party + pre-battle `Overrides`), and
  an optional `onBattleStart()` for mid-combat state (pre-boosted stages via
  `boostPlayer`/`boostEnemy`, etc.). For a **"start in the store, test a specific
  item"** scenario, add `shopItems: [modifierTypes.X]` — those reward options are
  guaranteed in the FIRST shop after the opening battle (e.g.
  `modifierTypes.RARE_CANDY` to evolve a mon, or `modifierTypes.FORM_CHANGE_ITEM`
  which, with a single-mon party, resolves to that mon's mega stone).
- **For any LONG or HARD fight scenario, take the player team/movesets
  DIRECTLY from a WINNING hell-mode run in the ghost pool** (query prod D1:
  `SELECT player_team FROM runs WHERE outcome='victory' AND difficulty='hell'`
  via wrangler, read-only) and bake speciesId/formIndex/level/moves verbatim.
  Maintainer rule — real winning teams, not invented ones.
- **ALWAYS give every party mon an explicit `moveset` in `makeStarter`** (4
  sensible moves incl. whatever the scenario needs). Maintainer rule — starters
  without one spawn with whatever default moves rolled, which makes scenarios
  awkward to test. No memberless movesets, ever.
- **Also** keep adding the vitest regression test under `test/tests/elite-redux/`
  when the behavior is unit-testable — the two are complementary (CI gate +
  human in-game check).
- **Applicability:** combat behavior (abilities, moves, type chart, weather,
  status, stat stages, multi-hit, megas) → always a scenario. Pure data/UI bugs
  that can't be shown in a battle (egg-move legality, reward-pool gating, starter
  grid) → note it in the scenario list as a `(note)` entry pointing at where to
  check instead.
- After adding scenarios, **push to `feat/elite-redux-port` and trigger the
  staging deploy** (see below) so the team can test immediately.

If you ever can't remember the testing workflow: it's all here. Re-read this rule.

## Headless scenario runner (fast, no browser) - test bugs autonomously

🔴 **STANDING RULE — every combat / ability / move change MUST be verified with
this runner before you call it done.** Any addition, rebalance, or bug fix that
touches abilities, innates/passives, moves, the type chart, weather/terrain,
status, stat stages, multi-hit, items-in-battle, or megas/forms has to be
reproduced and confirmed headlessly here (build a `ScenarioSpec` that forces the
exact situation and add an `expect` block that asserts the fixed behavior). "It
should work" / "tsc passes" is NOT verification - run the scenario and show the
green `expect`. This is in addition to (not a replacement for) the in-game test
scenario + vitest regression test required by the standing rules above. Only pure
data/UI changes that can't be expressed as a battle are exempt.

To reproduce / verify a combat bug WITHOUT a browser (Puppeteer is slow and flaky),
play a dev `ScenarioSpec` through the REAL game logic headlessly via the vitest
`GameManager`. All battle phases, ER abilities/innates/moves/AI/RNG run for real;
the game's own `console.*` output is captured to stdout. ~30-50s cold (one-time ER
init) then ~1-2s per scenario - batch scenarios in one run to amortize.

```
node scripts/run-scenario.mjs <ERS1-code | @spec.json | demo> [--turns N] [--move MOVE] [--waves N] [--no-miss] [--no-crit] [--real-rng]
```

- `demo` runs a built-in smoke battle. An `ERS1.` share code (from the in-game
  scenario builder / a bug report) reproduces that exact situation. `@file.json`
  or inline JSON is a raw `ScenarioSpec`.
- **Authoring JSON specs:** use enum NAMES anywhere an id is expected
  (`species:"GRENINJA"`, `ability:"HIGH_TIDE"`, `moves:["SURF"]`, `weather:"RAIN"`).
  Force an arbitrary ability/innate (incl. ER ids) per mon with `ability` /
  `passiveAbility` (player lead + enemy); give the enemy items with `heldItems:
  [{name:"LEFTOVERS"}]` (for `kind:"party"` custom enemies, `status`/`bossSegments`/
  `heldItems` are applied PER MON by party slot; `ability`/`passiveAbility` stay
  side-wide from `party[0]` - an Overrides limit).
- **Scripting the player's turns** with `script:[{...}]`, one entry per turn, per-slot
  suffixes `2`/`3` for doubles/triples (target is a BattlerIndex: 2/3 = enemies).
  Every in-battle interaction is scriptable per slot: `move`/`target` (+ `tera:true`
  to terastallize), `switch:<partyIndex>` (voluntary switch via the real Command
  path), `ball:"<POKEBALL name>"` (capture attempt), `run:true` (flee attempt), and
  ENEMY forcing `enemyMove`/`enemyTarget` (+`enemyMove2/3`) so "the foe used X into Y"
  situations reproduce exactly. Scripted moves that are IN the mon's real moveset go
  through non-destructive `select` (PP depletes, moveset intact - Encore/Choice/PP-out
  interplay is faithful); a move NOT in the moveset falls back to the old
  moveset-replacing `use` (flagged in the turn log). A player faint with a living
  bench auto-sends the first legal bench mon (or the next scripted `switch`) - no
  more 20s timeout hang.
- **Multi-wave runs:** `run.waves: N` (CLI `--waves N`) keeps playing past victory:
  the reward shop is driven headlessly (`rewards: ["<modifierTypes key>"|"FIRST"|"SKIP"]`,
  one per wave; party-target rewards drive the party UI too), level-up move-learn
  prompts default to decline (script `learnMove:{slot}` to accept), evolutions run.
  `items.shop` staging works headlessly now. This unlocks the shop-cancel /
  Rarer-Candy / evolution / switch-timing bug classes.
- Self-verify with an `expect` block: `playerAbility`/`enemyAbility`,
  `player/enemyStatus`, `player/enemyHp` ({min,max,equals}), `player/enemyStage`
  ({stat,value}), `player/enemyFainted`, per-slot `player2/player3/enemy2/enemy3`
  variants of Hp/Status/Fainted/Stage, `enemyUsedMoves` (ordered subsequence of the
  enemy's actual moves), `weather`, `terrain`, `maxHits`, `outcome`, and
  `logIncludes` / `logExcludes` (substring match on the battle message log, the
  catch-all). A failed `expect` exits nonzero with the exact mismatches.
- More knobs: `run.terrain` (NONE/MISTY/ELECTRIC/GRASSY/PSYCHIC/TOXIC); in
  doubles, `start.player2Stages`/`player2HpPct`/`player2Status` (+ `enemy2*`) set
  the 2nd mon on each side. Flags `--no-miss` (force every move to hit) and
  `--no-crit` (no crits) make damage / stat-stage assertions reproducible.
- **RNG fidelity:** by default the test framework clamps every battle roll to its
  MAX (deterministic, but damage is always max and sub-100% procs never fire; the
  seed does NOT govern battle rolls). `--real-rng` (`ER_RUN_REAL_RNG=1`) restores
  the real seeded `randBattleSeedInt` for probabilistic proc/variance repros.
- Trainer/boss intro dialogue is auto-skipped (no more `kind:"trainer"` hangs), and
  a phase-advance timeout now names the STUCK phase + active UI mode.
- **FULL-RUN AUTOPILOT (entire game via CLI, no browser):** `--to-end` plays wave 1 →
  victory / game-over; every between-wave menu is driven: biome shop (`biomeShops:
  "SKIP" | [{buys}]`), biome pick (`biomePicks: ["VOLCANO",...]`, default first node),
  crossroads (`crossroads: [optionIdx]`), mystery encounters (`run.
  allowMysteryEncounters`, `forceMysteryEncounters: [{wave,type}]`, `meOptions`),
  catch policy (`onCatchFull: "keep"|"release"|{replaceSlot}` + `items.pokeballs`),
  eggs (`eggs: "skip"|"hatch"`), between-wave party management (`betweenWaves`), and
  scripted rewards. `--policy @file.json` merges any of these over the spec;
  `--json-out` writes the machine-readable result (per-wave summaries + timings);
  `--quiet` for speed. **Future-proofing:** any UNKNOWN interactive menu fails
  loudly by name, or `--auto-first` presses through deterministically logging
  `[auto-first] <mode>` - new content can never silently hang a run. A wave that
  can't be won prints a STUCK diagnostic block (enemy party/field/reserves + the
  autopilot's next action) - read it before suspecting the harness. A mid-turn run
  END (wipe → GameOver → Title, or the final-boss credits) is classified as
  `player-wiped`/`victory`, never a stall. Measured: ~1-1.3s/wave after a one-time
  ~30-50s boot (a 94-wave run plays in ~2 min).
- The runner's capability self-check suite (21 cases incl. a 25-wave
  biome+shop+ME+catch+egg integration run) lives in the same file - run it after
  touching the runner: `ER_SCENARIO=1 npx vitest run test/tools/run-scenario.test.ts`.
- Output: a `=== TURN n ===` block per turn with a `STATE {…}` snapshot (each
  side's hp / status / stat stages / ability + weather), interleaved game logs,
  and a final `RESULT {…}`. A thrown error or phase-advance timeout (soft-lock /
  freeze) fails with a nonzero exit + full console - so hangs surface immediately.
- Files: `test/tools/run-scenario.test.ts` (the harness, reuses
  `buildDevScenario` for parity with the in-game launch) + `scripts/run-scenario.mjs`
  (CLI wrapper; also `pnpm er:scenario <args>`). It sets `ER_SCENARIO=1` for you.

For assertion-style regression tests, write a normal vitest test under
`test/tests/elite-redux/` driving `GameManager` directly (see e.g.
`er-anger-point.test.ts`). NOTE: the headless `GameManager` mock lives in
`test/mocks/mock-texture-manager.ts` - if a UI handler calls a Phaser
`scene.add.*` factory method that isn't stubbed there (or a `MockGraphics`
method), every battle test throws during construction; add the stub.

### 🔴 Scenario gotchas (learned the hard way - read before authoring/verifying)
- **Player innates are NOT active in a scenario.** An ability a species/form carries
  as an INNATE (passive) - not as an active ability - does NOTHING on YOUR mon unless
  you force it: a fresh scenario mon lacks the candy unlock that turns innates on.
  ENEMIES always have innates active; the player does not. So to test an innate-driven
  behavior on your side, set `ability:"<NAME>"` (ABILITY_OVERRIDE) to make it the
  ACTIVE ability. Example that bit us: **Mega Vanilluxe's Multi-headed is an innate**
  (its actives are Snow Cloak / Glacial Rage / Mirror Armor) - the mega alone strikes
  ONCE; add `ability:"MULTI_HEADED"` and it strikes 3x. If a "verified" ability/innate
  silently does nothing on the player, this is almost always why - force it active.
- **The #419 elite BST cap swaps your pinned enemy at low waves.** Below the cap
  ladder (it ends ~wave 100) an enemy whose BST tops the wave's ceiling is silently
  devolved/swapped (Skarmory->Clamperl, Snorlax->Munchlax, Exploud->Loudred,
  Porygon-Z->Porygon), so your ability/type test runs against the wrong mon. Set
  `run.wave:145` (past the ladder) for any >420-BST enemy. This is intended balance in
  real runs - do NOT touch the curve, just pick a late wave for the scenario.
- **Megas are permanent here** (evolution-like): spawn straight into the form with
  `formIndex:"mega"` / `formIndexContaining(sp,"mega")` - it sticks at summon, no
  stone/bracelet/manual-evolve. The mega FORM carries the stats + head count, but its
  signature ability is usually an innate, so pair the formIndex with an `ability`
  override (see the innate point above).
- **Give the enemy enough bulk to OBSERVE the effect.** A frail foe faints on hit 1
  and hides a 3-hit / spread follow-up / same-turn cancel. Use a tanky species or
  pre-boost it (`start.enemyStages:[0,6,0,6,0,0,0]` = +6 Def/SpDef).
- **Runner limits:** no in-battle mega-evolve toggle (spawn into the form); `kind:
  "wild"` forces a WILD battle EXCEPT on fixed rival/boss waves (e.g. ~190 rolls the
  rival regardless), and trainers SWITCH (confounds single-enemy / item-lock tests -
  prefer a 1-mon `kind:"party"`). The old mega-form sprite-load crash in the headless
  mock (`this.load.on is not a function`) is FIXED - `test/mocks/mock-loader.ts` now
  stubs `on`/`off`, so megas (incl. ER customs like Mega Vanilluxe) summon cleanly.

## Headless UI runner (non-combat surfaces, no browser, no pixels)

The combat runner's sibling for NON-battle screens. Boots the real game headlessly
and drives a UI handler directly, printing what the screen WOULD render - so the
"visual" bug classes that are really DATA bugs surface without a browser or pixels:
crash-to-black (handler throws), wrong/missing sprite (resolved sprite KEY/atlas
points at the wrong slug, e.g. "Redux Rattata shows Mega Charizard X"), and
blank/wrong fields (handler computes empty/garbled ability text).

```
node scripts/run-ui-scenario.mjs [species,species,...] [--surface S] [--strict]
```

- A species is a `SpeciesId` name, an `ErSpeciesId` NAME (e.g. `RATTATA_REDUX`), or a
  numeric id. Omitted = the surface's built-in demo (vanilla baseline + live repros).
- `--surface` selects which handler to drive (default `starter-select`):
  - **`starter-select`** - calls the REAL `setSpeciesDetails`; `STATE {…}` = threw /
    ability / passives / spriteKey / spriteAtlas / iconId. `errors[]` = threw / blank
    ability; `warnings[]` = sprite atlas does not reference the species name token
    (possible wrong sprite; `--strict` makes it a hard error). `getSpriteKey` /
    `getSpriteAtlasPath` route through the ER sprite-redirect, so a redirect /
    id-collision regression shows up directly.
  - **`pokedex`** - calls the REAL `PokedexPageUiHandler.show([species,{}])`; `STATE {…}`
    = threw / crashed / name / form / category / spriteKey. NB the page wraps its
    body in try/catch and logs `[pokedex-page] show() crashed:` instead of throwing,
    so the runner spies `console.error` for that line - `errors[]` = threw OR that
    logged crash (the #113 / #291 crash-to-black class).
  - **`egg-hatch`** - hatches `new Egg({scene, species: id}).generatePlayerPokemon()`,
    wraps it in an `EggHatchData`, and renders the REAL
    `PokemonHatchInfoContainer.showHatchInfo()` (the egg-summary card). `STATE {…}` =
    requested / hatched / threw / name / number / candy / spriteKey; `errors[]` = threw
    (the #110 starterColors-undefined crash-to-black on ER-custom hover). `displayPokemon`
    is stubbed (its async sprite-play can't animate headless); the sprite key is captured
    via getSpriteKey instead. NB eggs hatch the BASE form (#133), so an evolved token
    hatches its root.
  - **`biome-shop`** - starts a battle (for currentBattle + arena), rolls the REAL
    per-biome market stock via `getPlayerShopModifierTypeOptionsForWave(wave,_,true)`, and
    renders the REAL `BiomeShopUiHandler.show(...)`. `STATE {…}` = shown / threw / itemCount
    / items[]; `errors[]` = threw or show() returned false. (Ignores the species list.)
  - **`bargain`** - renders the REAL `ErBargainUiHandler.show(...)` for Giratina's deal,
    args built from the bargain i18next namespace (first 3 Sins + Leave). `STATE {…}` =
    shown / threw / labels[] / offers[] / greeting; `errors[]` = threw or show() returned
    false. **This is the #550 diagnostic:** the handler renders cleanly headless (shown:true,
    no throw), so "never renders in-game" is a phase/encounter-gating issue, NOT a handler
    render bug.
  - **`mystery-encounter`** - tokens are `MysteryEncounterType` NAMES (e.g. `ER_FORTUNE_TELLER`,
    `ER_BOG_WITCH`, `ER_HIGH_NOON`). Starts ONE battle, then per ME assigns the registry
    encounter (`allMysteryEncounters[type]`) onto `currentBattle.mysteryEncounter` and renders
    the REAL `MysteryEncounterUiHandler.show([{}])` option panel. `STATE {…}` = type / threw /
    shown / optionCount / options[] / title; `errors[]` = threw, show() false, or ZERO options.
    NB: assigns the encounter directly because ER gates ME *spawns* by biome/wave (the override
    won't force an ER ME onto an arbitrary wave); ONE GameManager is reused across MEs because
    the prompt-handler interval is a per-test static. **`ER_UI_ME=all` sweeps EVERY registered
    ER MysteryEncounterType** (read live from `allMysteryEncounters` - nothing hardcoded) and
    asserts per ME: no throw, shown, optionCount>0, printing a verdict table. Baseline: 59/59
    ok (skip-list with reasons in-code: ER_THE_BARGAIN is phase-driven, LLM_DIRECTED is
    synthetic). Run it after adding/changing any ER ME.
- Files: `test/tools/run-ui-scenario.test.ts` + `scripts/run-ui-scenario.mjs`. Sets
  `ER_SCENARIO=1` for you. Add a surface by adding a `snap*` + an `it.skipIf(SURFACE
  !== "…")` block (drive the handler, snapshot its computed state + resolved keys).
- **SCOPE:** this is the DATA/STATE tier - it does NOT rasterize (it asserts on the
  resolved sprite KEY, not the pixels). For actual pixels see the Tier 2 rasterizer below.

## Tier 2 - real-pixel sprite checks (`scripts/render-sprite.mjs`)

The pixel companion to the data-tier runners. Decodes a sprite's REAL atlas frame
from the local **er-assets** checkout (`../er-assets/images/pokemon/…`, the exact
bytes the game ships) with `@napi-rs/canvas` (prebuilt, no native build), writes the
cropped frame to a PNG, and analyzes the pixels. Sub-second, no game/Phaser boot.

```
node scripts/render-sprite.mjs <atlas-path | slug | dexNo> [--back] [--black] [--frame N] [--out file.png]
```

- Feed it the `spriteAtlas` value the Tier-1 `pokedex`/`starter-select` surface prints
  (e.g. `elite-redux/rattata_redux/front`), a bare ER slug (`rattata_redux`), or a
  vanilla dex number. `--black` reads the black-shiny atlas (the #393 class); `--back`
  the back-sprite; `--frame N` a specific anim frame.
- Prints `SOURCE <png>` + `ANALYSIS { dims, transparentPct, dominantColor,
  dominantPctOfSprite, cornersOpaqueUniform, verdict }` and writes the PNG under
  `dev-logs/sprite-renders/` (gitignored - eyeball it). `verdict` flags the
  pixel-level visual-bug classes: **EMPTY** (fully transparent - missing sprite,
  #107), **NO TRANSPARENCY / BOXED** (solid or 4-uniform-opaque-corner background -
  the green/dark-box class, #134/#284), **FLAT FILL** (one colour dominates - a
  placeholder / wrong tint, #393), else `ok`.
- For sprite-level pixel checks this is the fastest path (no Phaser boot). For a FULL
  PAGE (layout/alignment/overlap), use the full-page render harness below.
- Dep: `@napi-rs/canvas` (devDependency). Local er-assets checkout required (it's the
  asset source of truth; see the Assets section).

## Tier 2b - full-page render harness (`test/tools/render-ui-page.test.ts`)

Renders a REAL `UiHandler` page to a PNG so you can eyeball any layout/visual bug
(the in-game-only screens included). Core: `test/tools/render-harness.ts`.

🔴 **STANDING RULE — any work that changes what a SCREEN renders MUST go through this
harness, before and after.** This covers: a visual/layout bug (overlap, alignment,
missing/wrong sprite, wrong text, green `__MISSING` box, panel chrome, a wrong
ability/passive/stat shown on a screen); building or restyling a screen; and new content
that surfaces on a screen (a new item/relic icon, a new species/form, a new menu entry).
Required, not optional:
1. **Reproduce first.** Render the affected page and confirm the bug is visible in the PNG
   *before* you change code. If you can't reproduce it here, say so and explain why (it may
   be an interactive/animation/flow/browser bug this harness can't see — see "Out of scope").
2. **Verify after.** Re-render and visually confirm the fix in the PNG. "tsc passes" / "looks
   right in the code" is NOT verification - attach/inspect the actual image.
3. **New screen ⇒ new recipe.** If you add a `UiHandler`/screen, add it to `PAGE_RECIPES`
   in the same change so it (and every future change to it) is renderable. A screen with no
   recipe is treated as incomplete.

This complements - does not replace - the combat scenario runner (for battle/ability/move
behavior) and the in-game test-suite scenario (standing rules above). Use whichever fit; for
UI/visual work this harness is mandatory.

```
ER_SCENARIO=1 ER_RENDER_PAGE=<page> pnpm vitest run test/tools/render-ui-page.test.ts
ER_SCENARIO=1 ER_RENDER_PAGE=all  pnpm vitest run test/tools/render-ui-page.test.ts   # every page, ONE boot
ER_SCENARIO=1 ER_RENDER_PAGE=all  pnpm vitest     test/tools/render-ui-page.test.ts   # + watch (re-render on save)
ER_SCENARIO=1 ER_RENDER_PAGE=bargain ER_SIMULATE_MISSING=1 ...   # repro a missing on-demand sprite
ER_SCENARIO=1 ER_RENDER_PAGE=all ER_UPDATE_BASELINE=1 ...        # accept current renders as the new golden baselines
```

`ER_RENDER_PAGE` takes one page, a comma-list, or `all` (renders every recipe in a SINGLE
GameManager boot - the ~30-50s ER init is paid once, then ~1-3s/page; without `run` you get
watch-mode). **Golden-image gate:** each page pixel-diffs against
`test/tools/ui-baselines/<page>.png` and FAILS on any change beyond the page's tolerance
(0 = exact for static pages; the 2 pages with a live animated battle/hatch sprite use a coarse
tolerance since that sprite is non-deterministic here). On an INTENDED visual change, re-run
with `ER_UPDATE_BASELINE=1` and commit the updated baseline PNGs. A failing diff writes
`dev-logs/ui-pages/<page>-diff.png` (red = changed pixels).

Out: `dev-logs/ui-pages/<page>[-missing].png` (gitignored). ~35 wired pages (see
`RECIPES`) render faithfully, incl. `bargain`, `biome-shop`, `mystery-encounter`, `pokedex`,
`egg-hatch`, `starter-select` (+roster/shiny-lab/coop/nav), `summary`, `party`,
`achievements`, community-challenges (6), `profile`, `ghost-trainer-editor`, `er-map`,
`er-map-picker`, `stormglass-picker`, the ability capsules, `tm-case-party`,
`modifier-select` (the post-battle reward shop), `egg-gacha`, `egg-list`, `save-slot`,
`game-stats`, `run-history`, `challenge-select`, `menu`, `learn-move-batch`, `colosseum`,
`er-quiz`, and the BATTLE screens below. Remaining green `__MISSING` boxes are
genuinely-absent ER-custom icon keys (e.g. `er_icon__*` redux forms), not harness defects.

**BATTLEFIELD RENDERING (`field: true`)**: a recipe flag that draws the full battle FIELD
beneath the page - arena bg + platforms (biome-derived), every on-field pokemon sprite
(real `getBattleSpriteKey`/atlas resolution: forms/shinies/ER customs), trainer sprites,
fresh `PlayerBattleInfo`/`EnemyBattleInfo` HP/EXP bars with real double/triple slot
stacking, and the bottom message bar. Pair with `captureActive` + a `prepare` that drives
a battle to the state you want. Visibility mirrors the LIVE scene graph (a lingering
trainer sprite or a fainted-but-still-shown mon reproduces); positions are the canonical
layout constants + the real slot-offset code (live x/y is untrustworthy headlessly - the
framework tween mock fires onComplete without applying values). Reference recipes:
`battle-command` (full single-battle screen), `battle-field-doubles`, `fight-menu`,
`ball-menu`, `target-select`. Core: `renderBattlefield` in `render-harness.ts`.

**Diagnostics**: every page run prints `[suspect]` lines for VISIBLE sprites drawing wrong
pixels - texture `__MISSING` (a key requested through an unwrapped path) or a whole-sheet
`__BASE` render of a multi-frame atlas (a failed `setFrame`). `ER_RENDER_DUMP=1` dumps
every textured node with its world position to hunt one down. The two-pass injector
handles BOTH TexturePacker JSON shapes (array + hash) with trim data, prioritizes
`images/ui` in the basename index (so e.g. dexnav's `cursor.png` can't shadow the real ui
cursor), and also records keys from post-creation `setTexture` swaps (e.g. `setMini`'s
`pbinfo_*_mini`).

How it works (so you can extend it):
- Boots a normal headless `GameManager` for full DATA + every registered handler, then
  boots a SECOND real Phaser **CANVAS** scene (`@napi-rs/canvas`) - the only thing that
  rasterizes pixels (the GameManager scene is HEADLESS + mock factories, renders nothing).
- `repointGlobalScene` swaps `globalScene`'s RENDER members (add/textures/anims/tweens/
  time/cameras/ui + `loadPokemonAtlas`) onto the CANVAS scene, keeping all data. So the
  real handler renders real pixels at the game's x6 logical->screen scale.
- **Two-pass asset auto-injection**: pass 1 runs the handler and records every texture
  key it requests; those keys are resolved against the local er-assets dirs and injected;
  pass 2 renders for real. Adding a page rarely needs an asset list - it self-configures.
- Phaser's `NineSlice` has NO canvas renderer (WebGL-only), so the harness installs one
  (`patchNineSliceCanvas`) - without it every windowed panel is invisible. `setTint` is
  approximated via an isolated offscreen multiply.
- **`restoreSpriteTextureMethods` (critical)**: the test framework's `MockSprite` ctor
  globally clobbers `Phaser.GameObjects.Sprite.prototype.setTexture/setFrame/setSizeToFrame`
  to no-ops during GameManager boot. In the real CANVAS scene that silently blanks every
  sprite NOT textured via `.play()` (icon grids, shiny stars). `repointGlobalScene` restores
  the genuine impls from the `Components.TextureCrop`/`Size` mixins (which the mock never
  touched). If a new screen's sprites mysteriously don't render, this is the first suspect.
- The asset index walks the WHOLE `images/` tree by basename (first-wins), skipping only the
  huge `images/pokemon` mass (battle sprites load by atlasPath via `loadPokemonAtlas`). Loads
  where the texture KEY != file basename (e.g. `shiny_star`->`ui/shiny.png`) go in
  `KEY_FILE_OVERRIDES`; ER-custom icon keys `er_icon__<slug>` resolve to
  `pokemon/elite-redux/<slug>/icon` (mirrors `loading-scene.ts`) so custom-species grid icons
  render instead of showing `__MISSING`. The 2D `batchSprite` guard skips frames with no
  `canvasData`/source image so an un-injected key can't blank the whole page mid-pass.
- Add a page: a `{ mode, prepare? }` recipe in `PAGE_RECIPES`. `prepare(game)` does run
  setup (e.g. `startBattle`, assign an encounter, flag dex `caughtAttr`) on the ORIGINAL
  scene and returns the handler's `show()` args; the it() body constructs a FRESH
  `new HandlerClass()` (the registered instance's children are MockSprites) and re-points
  rendering only after. A `{ render(game, ctx) }` recipe is also supported for fully custom
  builds. `gs.ui` is a minimal mock (`add`/`bringToTop`/`clearText`/tooltip no-ops/
  `getMessageHandler`) - extend it if a handler calls another UI method.
- Known fidelity gaps: text/sprites render real; remaining `__MISSING` boxes are
  genuinely-absent keys (logged as `unresolved`/`uninitialized-frame`); base (untinted)
  windows render in the window's base colour.

**Input driving (navigation / scroll / menu transitions / input-triggered crashes):**
A recipe may carry `steps: Button[]` - after the page renders, each button is fired at the
currently-active handler (`processInput`), with a `<page>-stepN.png` snapshot after each and
the main PNG ending on the FINAL state. The `gs.ui` surface is stateful: when a press calls
`setMode(...)` to hand off to ANOTHER screen (confirm dialog, option select, sub-menu) it
builds + shows that handler fresh and routes subsequent input there - so this works
**universally for any screen/menu**, including ones you transition INTO. A press that throws
is captured to `<page>-stepN-crash.txt` and **is** the reproduction of an input-triggered
crash/softlock (set `expectThrow: true` on the recipe to assert the crash). Use this for the
cursor/scroll/menu-transition + softlock-to-black class (#135, #237, #438, #553). See the
`starter-select-nav` demo recipe. (Residual: keyboard `Button` input only, not pointer/mouse
hit-tests; very deep cross-handler chains may need extra `gs.ui` methods stubbed.)

**Out of scope (do NOT expect this harness to catch these — use the noted tool instead):**
- **Animation / timing / races** - tweens are force-completed to their end value and timers
  no-op, so the GOLDEN snapshot is a still, not a film. Partial repro: set `frames: N` on a
  recipe (or `ER_FRAMES=N`) to capture N successive LIVE frames as `<page>-frameNN.png` after
  the page is built + input fired - a flip-book for sprite-anim / rapid-cycle-race bugs
  (#140/#144). Tween-driven mid-animation states (fades) are still not stepped, and
  tween-FINAL positions never apply headlessly (the framework tween mock only fires
  onComplete) - positional-drift bugs are invisible; the field renderer uses canonical
  layout constants instead. TITLE / EVOLUTION_SCENE / EGG_HATCH_SCENE are animation-tier
  (a static render is blank/meaningless).
- **Combat BEHAVIOR** still goes through the **combat scenario runner** + in-game test-suite
  (standing rules above). But the mid-battle SCREEN renders fully now: `captureActive: true`
  + `field: true` gives the battlefield + active handler (see the battle recipes above) -
  the old "menu chrome only" limitation is CLOSED.
- **WebGL-exact pixels** - it rasterizes with 2D `@napi-rs` canvas, not WebGL; shader/pipeline
  output, variant **palette-swap colours**, masks, and glow/particle FX are approximated.
  Field-render residuals: fusion second-sprite, weather/fog overlays, substitute doll, and
  the dynamic >2-mon field scale are not drawn.
- **Browser/prod-only** - service-worker/CDN cache staleness, cross-user/device sprite
  variance (#335), audio/BGM (#403), and real save/cloud round-trips can't reproduce headlessly.

## Two-engine co-op harness (`test/tools/coop-duo-harness.ts`) - reproduce CO-OP desyncs headlessly

🔴 **STANDING RULE - any CO-OP sync/desync/softlock bug gets reproduced in the TWO-ENGINE harness
FIRST, then fixed, then kept green.** Co-op bugs are interaction bugs between two REAL clients; a
single client (or a hand-faked partner) cannot exhibit them - that is exactly how the post-battle
softlocks and the TM-reward-shop orphan (#698) slipped through. Before fixing a co-op bug: write a
`coop-duo-*` repro that drives BOTH real engines over the loopback until it hangs/diverges, then make
that repro green. Do NOT diagnose co-op desyncs from live two-client logs alone when the harness can
reproduce them - the harness is the fast, deterministic loop. (Pure combat/ability/move behavior still
goes through the combat scenario runner; this is for the co-op SYNC layer.)

**What it is.** Boots a HOST `BattleScene` (the sole authoritative engine) AND a GUEST `BattleScene`
(a pure renderer) in ONE vitest process, paired over the in-process `LoopbackTransport`
(`createLoopbackPair` - the SAME framing the real WebRTC path uses). Every OTHER co-op test is
single-engine (one `globalScene`; the local client plays the guest; the host is FAKED with
hand-authored `turnResolution` messages). Here BOTH sides are REAL engines, so a real host-vs-guest
divergence surfaces ORGANICALLY in the logs (the spike already surfaced a real turn-1 checksum
mismatch that single-engine tests structurally cannot produce).

**How it works (so you can extend it).** The engine has PROCESS-GLOBAL state that is NOT per-scene, so
the cooperative scheduler swaps a 4-part `ClientCtx` ATOMICALLY (`withClient` / `withClientSync`)
before pumping each client: (1) `globalScene` (`initGlobalScene`), (2) the coop `active` runtime
(`setCoopRuntime` - also installs the authoritative-guest predicate), (3) `Phaser.Math.RND.state()`
(the process-global seeded RNG cursor, saved back per client so they don't bleed), (4) the
`er-ghost-teams` per-run cache (`resetErGhostRunState` boundary). Each `CoopRuntime` is assembled ONCE
(`assembleCoopRuntime` in `coop-runtime.ts` - the additive seam `connectCoopSession` delegates to, so
two runtimes can stand up over one loopback pair WITHOUT `clearCoopRuntime` closing the transport),
then the live one is selected with `setCoopRuntime` - never re-wired. The HOST is a real `GameManager`
(`game.move.select(...)` -> real `MovePhase`/AI/RNG -> `TurnEndPhase.emitCoopTurn`); the GUEST is a
2nd `BattleScene` built directly (`buildGuestScene`) running its real `CoopReplayTurnPhase` ->
`CoopFinalizeTurnPhase` -> `applyCoopCheckpoint`. A no-progress stall THROWS (`driveGuestReplayTurn`,
>16 idle iters) so a regression hangs LOUDLY with both logs already captured.

```
# the duo tests are gated ER_SCENARIO=1 (like every ER engine test):
ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-engine.test.ts        # spike: 1 battle + reach reward shop
ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-multiwave.test.ts     # >=3-wave run + owner/watcher shop + #698 TM-orphan repro
# (PowerShell: $env:ER_SCENARIO="1"; npx vitest run <path>)
```
Both clients' `coop:*` + phase lines stream to `dev-logs/coop-duo/<run>/{host,guest}.log` (gitignored),
flushed even on failure - read these to triage a desync.

**Add a new co-op repro (recipe, from the harness header):**
1. In a fresh `it(...)`, boot the host (`game.classicMode.startBattle(...)`) + `buildDuo(game,
   createLoopbackPair(), setCoopRuntime, toCoop)` to stand up the guest engine + both runtimes over one
   loopback pair (host owns EVEN interaction counters, guest owns ODD); stage with
   `forceItemRewards([...])` / `forceNextMysteryEncounter(type)`.
2. Per wave: `hostPlayWave` (`move.select` both slots -> `TurnEndPhase`) -> `withClient(guestCtx, () =>
   driveGuestReplayTurn(...))` -> `driveHostRewardShopOwner` + `driveGuestRewardWatch` (pick
   owner/watcher by counter parity) -> `phaseInterceptor.to("CommandPhase")` for the host's next wave,
   calling `remirrorWave(rig)` before each new wave.
3. Assert convergence (guest enemies fainted / `interactionCounter()` equal on both / resyncs bounded)
   and that BOTH reach the next wave; a no-progress stall THROWS in `driveGuestReplayTurn`.

**Mystery encounters ARE now drivable** (`coop-duo-mystery.test.ts`): the per-client `ClientCtx` swap
carries the 3 ME pins (`coopMeInteractionStart` / `coopMeBattleInteractionCounter` / `coopMeHostPresentation`)
in `mePins`, so a real two-engine ME is not a harness artifact. `buildDuoForMe` reaches a real
`MysteryEncounterPhase` on the host at a legal ME wave (12) via `runToMysteryEncounter`, then flips to
co-op; `driveGuestMeReplay` runs the guest's REAL `CoopReplayMePhase` (8M present/outcome + 9M terminal,
stall-throws). The test exercises all three authoritative paths and asserts them CORRECT across two real
engines: HOST-OWNED non-battle (host drives its own UI), GUEST-OWNED non-battle (host awaits the guest's
relayed pick index via `coopHostAwaitGuestIndex`), and BATTLE-HANDOFF (the #693 softlock class - a
battle-spawning option fires the 9M terminal with NO trailing 8M `meResync`; the guest must
`finishWithoutLeaving` WITHOUT advancing the counter). One real cross-ctx footgun surfaced + was fixed at
the HARNESS layer (the loopback microtask-flush gotcha #5: send the guest index via `withClientSync` so
the host's await resolves under the host scene; decouple the guest outcome/terminal race so it buffer-hits
under the guest scene) - NOT a production bug.

**Bounded scope - closed vs residual (updated 2026-07-02):**
- **CLOSED - per-client ghost state**: the `er-ghost-teams` cache quartet is now truly
  save/restored per client in the ClientCtx swap (`snapshotErGhostRunState`/
  `restoreErGhostRunState`), and the ghost hooks (`coopGhostFetchSuppressed`/
  `onGhostPoolPublished`) are role-gate-routed per active runtime
  (`installCoopRuntimeGhostHooks`). Ghost-bearing MEs / ghost waves are duo-testable;
  see `coop-duo-ghost-sync.test.ts`.
- **CLOSED - seed-pin launch adoption**: `mirrorHostBattleToGuest` now runs
  `adoptCoopHostRunConfig` (host seed per #658 + money + ball inventory + player-wide
  modifiers), so the wave-start checksum matches EXACTLY with zero resyncs
  (`coop-duo-launch-sync.test.ts`). A wave-start mismatch is now a REAL bug, not a
  harness artifact. (The full SelectStarter->launch handshake is still not driven -
  see the rewrite note below.)
- **CLOSED - live per-event streaming**: `setCoopHarnessLiveEvents(true)` installs the
  real role-gated live emitter over the loopback; `coop-duo-live-events.test.ts` proves
  host-emitted mid-turn events reach + apply on the guest.
- **CLOSED - reward drive**: party-target rewards drive the owner PARTY UI
  (`driveHostPartyRewardOwner`), and `driveGuestRewardWatch` now THROWS on a true
  no-progress stall (like `driveGuestReplayTurn`).
- **KNOWN REAL DESYNC (found by the harness, deliberately NOT papered over): move PP.**
  The per-turn checkpoint reconciles hp/status/stages/tags/weather/terrain/money but NOT
  moveset `ppUsed`; the pure-renderer guest never decrements PP, the checksum hashes PP,
  so every turn a move is used forces a full resync. Repro isolated in
  `coop-duo-launch-sync.test.ts` (strip `moves` from both checksum states -> byte-equal).
  Fix path: carry `[moveId, ppUsed]` in the checkpoint like `money` - OR see below.
- Residual: guest mons skip `Pokemon.init()` (headless `battleInfo` stub - documented in
  the harness header; irrelevant to the sync layer).

**🔴 CO-OP REWRITE NOTE (the netcode is being collapsed to host-authoritative +
session-save snapshot + live cue stream).** The harness is layered to survive that
rewrite - keep the layers separate when extending it:
- Layer A (netcode-blind, KEEP): the two-engine substrate - dual BattleScene boot, the
  atomic ClientCtx swap (globalScene/RNG/ghost caches), `LoopbackTransport` pair,
  per-client logs, stall-throws. Add transport fault-injection (drop/reorder/delay)
  here to prove cue-loss can't desync.
- Layer B (thin protocol drivers, REPLACED by the rewrite): mirror/adopt launch,
  `driveGuestReplayTurn`, reward-alternation drivers. Keep tests calling drivers, not
  netcode seams, so swapping the driver implementation ports every test.
- Layer C (invariants, KEEP): convergence assertions. Prefer a normalized
  `getSessionSaveData()` diff as the comparator - that is the rewrite's own definition
  of correctness (and it makes the PP desync above impossible by construction, since
  `ppUsed` is already in the save).

🔴 **globalScene CITIZENSHIP (vitest runs the ER suite with `isolate: false` - module state, incl.
`globalScene`, is SHARED across files in run order).** Any co-op test that swaps `globalScene` (the
duo files build a 2nd `BattleScene`; the engine-free `coop-*` repros install a partial `makeStubScene`)
MUST restore it in `afterEach`, or the NEXT ER_SCENARIO file's `new GameManager` reuses the leftover
scene and crashes (`this.scene.reset is not a function` for a stub). The pattern: capture
`prevGlobalScene = globalScene` in `beforeEach` BEFORE the swap, `initGlobalScene(prevGlobalScene)` in
`afterEach` (duo files restore the host `game.scene`). It is order-robust: each file restores before the
next file's `beforeEach` captures, so even back-to-back swapping files chain a real scene through. This
only bites full-directory ER_SCENARIO runs (CI's default suite skips these), so it slips a single-file
green - always run the WHOLE `coop/` dir before shipping a new co-op test.

### 🔴 Running the whole `coop/` dir - use the GATE, not a bare `vitest run` (#879)

**Run `pnpm coop:gate` (script: `scripts/run-coop-gate.mjs`). That IS the "run the whole `coop/` dir"
command now - one green run = the co-op dir is shippable.** Do NOT ship off a bare
`ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/`: vitest's default pool spreads the 136 files
across ~one-fork-per-core workers, and with `isolate: false` each fork has its OWN `globalScene`, so the
deterministic sequencer order that keeps the shared-scene chain intact is FRAGMENTED - a fork that gets a
stub-scene file first has no real scene to chain, and 2-17 files fail NONDETERMINISTICALLY (every one
passing solo), plus heavy duo files time out under ~11-fork load (#879).

The gate fixes this with SCHEDULING ONLY (no assertion is weakened). It splits the dir into four lanes -
A (engine-free / light), B (heavy duo + engine), C (soak, harness fidelity), P (production-fidelity soak) -
and runs each in a SINGLE worker with `--no-file-parallelism` (deterministic order, no fork fragmentation),
one lane at a time (no contention). `exit 0 = all gating lanes green`. Flags: `--list` prints the lane
composition, `--lane A|B|C|P` runs one. Files that fail PRE-EXISTINGLY (nonzero even SOLO on a clean HEAD -
not a scheduling issue) live in the script's `QUARANTINE` map and run in a loud NON-GATING pass; fix those
separately, never by weakening the gate. When you add a co-op test, it is auto-categorized by filename +
ER_SCENARIO gate - no gate edit needed.

**LANE P - the GATING production-fidelity soak (#897).** Lane C runs the soaks in the driver's DEFAULT
"harness" fidelity: the driver heals the guest through convenient seams a live client never takes (a full
per-wave re-mirror of the guest player party + `healGuestFromHost`, and guest commands read from the HOST's
authoritative slot), which keeps the soak fast + green but MASKS the "guest replay has DRIFTED" divergence
class live co-op still hits. Lane P runs ONE bounded soak (`coop-soak-fidelity-gate.test.ts`) with
`SOAK_FIDELITY=production` (env supplied by the lane, `SOAK_WAVES=PROD_FIDELITY_GATE_WAVES`): NO harness
heals (the guest heals only via the production checksum-mismatch resync analogue) and guest commands are
sourced from the guest's OWN rendered scene, so a stale guest fails LOUDLY. It is GATING and, crucially,
does NOT swallow a hard invariant: the non-gating *evidence* test `coop-soak-fidelity.test.ts` (also in the
dir) catches a hard LOCKSTEP/NO-PARK/TEARDOWN breach and reports it as a "classified terminal", asserting
only that wave 1 ran (so a breach after wave 1 still passes - the reviewer's finding); the lane-P gate test
lets `SoakInvariantError` throw, so any hard-invariant breach = nonzero exit = GATE RED, and it asserts the
FULL bounded wave count was surveyed (anti-silent-pass-after-wave-1). The SOFTER co-op-fidelity classes
(unhealed DIGEST divergences - the #891 guest money-lag class - and the per-turn production checksum
ASSERTION count) are gated only where they hold CLEAN at the bounded depth on HEAD; a still-open class is
scoped OUT report-only behind a `HONEST_*_GATE` constant with a loud TODO naming it + #891 (honest scoping,
never a weakened assertion). Lane P is bounded to `PROD_FIDELITY_GATE_WAVES` waves to stay wall-clock-cheap;
the long 35/150-wave god soak stays in the evidence test / the nightly job.

## Record -> Replay - a reported bug ships with a replayable trace (#record-replay)

🔴 **The point: a live bug report carries a deterministic `ReplayTrace`, and the harness re-runs that
trace to REPRODUCE the bug headlessly + verify the fix.** Before this, a co-op (or single-player) bug
report had a console ring buffer + a seed but no way to RE-DRIVE the exact run; you triaged from logs.
Now the run is captured as data and replayed through the real engine. Workflow when a trace-bearing
report lands: pull the report -> load its `replayTrace` -> replay it in the duo harness -> watch it
diverge/hang at the same point -> fix -> re-replay until it's green (then it doubles as the regression
test). A run is fully determined by **seed + roster + the ordered events**, because the co-op run-start
is deterministic (#658 pins the guest to the host seed) - so replaying those three reproduces it 1:1.

**The three pieces (all general - co-op today, single-player is a thin future add):**
- **Schema** `src/data/elite-redux/replay-trace.ts` - PURE TYPES, zero runtime (type-only imports).
  `ReplayTrace = { version, seed, gameModeId, difficulty, challenges, roster: PokemonData[], events:
  ReplayEvent[], coop?: { runConfig: CoopRunConfig } }`. An event is either a `ReplayCommandEvent`
  (`{type:"command", wave, turn, slotFieldIndex, command}` where command is move/switch/ball/run) or a
  `ReplayInteractionEvent` (`{type:"interaction", seq, kind, choice, data?}`). Interaction OWNER is
  DERIVED from `seq` parity (even=host, odd=guest), never stored. `makeReplayTrace` / `validateReplayTrace`
  / `isReplayCommandEvent` / `isReplayInteractionEvent` are the builder + guards. The `coop` layer is
  OPTIONAL - omit it and the same trace describes a single-player run.
- **Recorder** `src/data/elite-redux/replay-recorder.ts` - the PRODUCTION capture. A PASSIVE,
  ring-buffered (last `REPLAY_RECORDER_WAVE_WINDOW` = 6 waves) observer. The hot-path gate is a single
  `header != null` read (`isReplayRecording()`): every `record*` returns immediately when not recording,
  so a non-recording run is byte-identical and free (no alloc beyond the small event, no await, no
  network, never touches engine/RNG/command-resolution). `beginReplayRecording(header)` is idempotent
  for the same seed. The ENABLE decision lives at the CALL SITES, not here (the recorder knows nothing
  about co-op). Taps: `command-phase.ts` records own/partner slot commands AFTER the existing
  broadcast/apply (behavior-preserving); `encounter-phase.ts` -> `maybeBeginReplayRecording()` begins it
  at the first `EncounterPhase` of a CO-OP run on the HOST only (the sole authoritative engine; the guest
  never records, so its taps are no-ops); `coop-interaction-relay.ts` records owner-sent + received
  picks after the wire send. **Single-player is a thin add**: call `beginReplayRecording` from the
  classic launch (same taps already fire) - left OFF for now so single-player is provably free.
- **Loader** `replayCoopTrace(game, trace, opts)` in `test/tools/coop-duo-harness.ts` - feeds a trace
  back through the two-engine harness: stands up host+guest from the header (seed/roster/runConfig),
  then drives the ordered events (commands via `move.select`, interactions via the relay) so the run
  re-executes deterministically. A future single-engine loader (drive ONE `GameManager` from the same
  trace, skip the `coop` layer) is the thin add for single-player repros.

**Attach + verify.** `er-bug-report.ts` serializes `getReplayTrace()` onto the report as
`replayTrace: string | null` (try/catch -> null; absent = the run wasn't recording). The closed-loop
test in `coop-duo-replay.test.ts` is the proof + the recipe: drive a real run with the recorder enabled
-> `getReplayTrace()` -> feed it back through `replayCoopTrace` -> assert the same run. Copy that test to
turn any captured trace into a permanent regression.

**SINGLE-PLAYER record→replay is LIVE (2026-07-02).** Recording begins at the first
EncounterPhase of a classic solo run too (not just co-op host). Tapped decisions beyond
commands: reward-shop pick/skip, learn-move — incl. ER's batch level-up panel
(`learn-move-batch-phase.ts`, the REAL solo path; the per-move LearnMovePhase tap alone
never fired), crossroads pick, biome pick, catch decisions. Player bug reports carry the
trace (`er-bug-report.ts` serializes it after the `DEVLOG_REPLAY_TRACE_MARKER` line).
- **Loader**: `replaySingleTrace` in `test/tools/replay-single.test.ts` — rebuilds the run
  from the header (seed + roster) and re-drives every event through the real input paths;
  divergences fail loudly by event index. Closed-loop proof in the same file (record a real
  7-wave run crossing a crossroads → replay 1:1).
- **CLI**: `node scripts/replay-run.mjs <trace.json | bug-report.log>` — extracts the trace
  from a tester's log capture and re-drives the exact run headlessly ("REPLAYED 1:1" or the
  precise divergence).

**Bounds (respect or close before relying beyond them):** only the last 6 waves are kept (a bug older
than that is off the ring buffer - widen `REPLAY_RECORDER_WAVE_WINDOW` if needed). The co-op loader
inherits the duo harness's bounded scope above. The trace captures commands + interactions + seed +
roster - NOT mid-run RNG reseeds or external save/cloud state, so a bug that depends on those is not
fully reproduced by replay alone.

## The in-game dev test suite

- `src/dev-tools/test-suite/` — **TRACKED**. The shared suite: `scenarios.ts`
  (the scenarios) + `index.ts` (the picker menu, the on-screen context banner
  with Pass/Fail/Collapse, and the Send Logs button).
- `src/dev-tools/registry.ts` — **TRACKED** extension point. Lazily loads the
  suite via `import.meta.glob("./{local,test-suite}/**/index.ts")`, gated by
  `import.meta.env.DEV || import.meta.env.VITE_DEV_TOOLS === "1"`.
- `src/dev-tools/local/` — **GITIGNORED** personal scratch area (optional).

### Gating: staging-only, NEVER production
- **Local** (`pnpm start:dev`, mode=development) → `import.meta.env.DEV` true → on.
- **Staging** (`deploy-staging.yml`) → sets `VITE_DEV_TOOLS=1` in
  `.env.standalone.local` before `pnpm build:standalone` → on. The test team uses
  the staging site.
- **Production** (`elite-redux` Cloudflare Pages, built by CF git-integration on
  `main`) → neither flag set → the registry gate is false → no menu, no buttons,
  scenarios never load. Players never see it. **Do not set `VITE_DEV_TOOLS` in
  prod.** (`deploy.yml` is upstream-only — `if: github.repository == 'pagefaultgames/pokerogue'` — and never runs on this fork.)

### In-game flow
Title → **🛠 Dev Scenarios** → short-label list (scrolls, 6 visible) → pick one →
drops into the configured battle with a context banner pinned top-left.
- Banner buttons: **✓ Pass** (records result, removes scenario from the list,
  persisted in `localStorage`), **✗ Fail** (prompts for a reason, records it),
  **Collapse** (shrink to the title bar; click bar to re-expand).
- Menu has **↺ Undo last pass: <name>** (pops only the most recent pass).
- **Send Logs** (top-right) prompts for an optional comment, then writes a full
  capture. Results/logs land under `dev-logs/` (see below).

#### How staff test custom trainers
Title → **🛠 Dev Scenarios** → **👤 Custom Trainers** (top of the list, under the
Scenario Builder) → pick any staff-authored trainer → drop straight into a forced
battle against it with the FULL resolved feature set (sprite + gender, aura, battle
music, intro/victory/defeat lines, weighted-slot + slot-fill rolls, RLA/RLNA moves,
shiny-lab looks, BST bypass) - exactly as a real run fields it. The full loop:
1. Author + **save** the trainer in the balancing editor's Custom Trainers tab -
   that commits the entry into `er-custom-trainers.json`.
2. A **staging deploy** bakes the updated JSON into the game bundle.
3. In-game **Dev Scenarios → Custom Trainers → pick** to fight it. The picker
   force-adjusts the run difficulty + starting wave so the trainer is eligible
   (skipping boss `%10` + fixed-battle waves the install seam rejects) and the dev
   force bypasses the challenge-exclusivity gate; a trainer whose whole floor range
   is boss/fixed waves is reported with a readable message, never a silent wild
   battle. The force is a one-shot (clears on install), so the rest of the run is
   normal. Reuses the round-7 dev force seam (`setErCustomTrainerDevForce`).
4. **Production** only ships the trainer on the MANUAL prod patch - the dev tools
   (incl. this picker) are dead in prod builds.

### Shared progress across the team (cross-account / cross-browser)
So one tester's passes are visible to everyone (nobody re-runs a scenario a
teammate already passed), Pass/Fail/Send-Logs are mirrored to the **save-API
worker** (`workers/er-save-api`) at public routes `GET /devtest/progress` +
`POST /devtest/event` (D1 table `devtest_events`, auto-created on first hit). The
client (`src/dev-tools/test-suite/index.ts`) reads `import.meta.env.VITE_SERVER_URL`
(already wired into the staging build) and calls `${VITE_SERVER_URL}/devtest/*`.
The picker hides scenarios passed by ANYONE; "Undo last pass" posts an `UNPASS`.
It degrades gracefully to local-only `localStorage` when the endpoint is unset
(local `pnpm start:dev`) or unreachable.
- **ACTIVATION (one-time, maintainer only — I can't deploy workers):** redeploy
  the save-API worker so the `/devtest/*` routes go live:
  `cd workers/er-save-api && npx wrangler deploy`. No new env var or KV/D1
  migration is needed (the table self-creates; the URL is the existing
  `VITE_SERVER_URL`). Until then the suite still works, just local-only.

### dev-logs (local dev server, `plugins/vite/dev-log-plugin.ts`)
Nothing is overwritten, and captures are AUTO-TRIAGED by scenario:
- `dev-logs/captures/<scenario-slug>/<timestamp>[__<comment-slug>].log` — one file
  per Send Logs, filed under the scenario it came from (or `no-scenario/`), with
  the comment in the filename. This is how you find "which log was for what" after
  a memory reset — just look at the folder/file names.
- `dev-logs/latest.log` — newest capture (overwrite, convenience).
- `dev-logs/session.log` — cumulative, survives restarts.
- `dev-logs/results.log` — append-only PASS/FAIL ledger (`[time] TEST RESULT:
  PASS/FAIL — <scenario> — <comment>`).
Read these to see what testers verified / where something hung.

### 🔴 Marking a tester log DONE (so it isn't re-triaged)

When a report is RESOLVED / by-design / won't-fix, mark its log file done by
renaming it IN PLACE to insert `.DONE` before the extension:
`<...>__player.log` -> `<...>__player.DONE.log`. The pull script
(`scripts/pull-dev-logs.mjs`) treats a `.DONE.log` twin as already-present, so a
done log is never re-downloaded. When triaging, SKIP any `*.DONE.log` - those are
already handled. (No separate ledger file; the filename is the status.)

### 🔴 Reading REMOTE tester logs (prod/staging "Report a bug" + "Send Logs")

This is the one to use day-to-day — it's how live players' captures reach this PC.
Both the in-game **Report a bug** button (prod + staging) and the dev **Send Logs**
button POST to the er-editor-api worker's `/devlog` sink
(`https://er-editor-api.heraklines.workers.dev/devlog`), which commits each capture
onto the repo's **`dev-logs` branch** (see `src/data/elite-redux/er-bug-report.ts`
and `src/dev-tools/test-suite/index.ts`). To pull them down locally:

```
# from the repo root; needs a GitHub token to read the dev-logs branch
export GH_TOKEN="$(tr -d ' \r\n' < /c/Users/Hafida/Desktop/github_token.txt)"
node scripts/pull-dev-logs.mjs        # one-shot; only downloads NEW files
```

- Files land (gitignored) under `dev-logs/remote/<YYYY-MM-DD>/<timestamp>__<scenario-or-"bug-report">__<tester-or-"player">.log`.
- Each file has a header (`version / url / mode / wave / difficulty / seed / party`),
  a `----- DESCRIPTION -----` (the player's free text), and `----- CONSOLE -----`
  (the console ring buffer — incl. the AI's `Move Pool / Move Scores / Chosen Move`
  lines, asset 404s, stack traces). Grep the descriptions to triage fast:
  `grep -rl -A3 "DESCRIPTION" dev-logs/remote/<date>/`.
- To find what scored/crashed: read the `----- CONSOLE -----` tail of the file.

**Quick peek WITHOUT the pull script (fastest for a one-off triage).** The captures
are plain files committed on the `dev-logs` branch, so read the newest ones straight
from git (no download, works from any worktree):

```
export GH_TOKEN="$(tr -d ' \r\n' < /c/Users/Hafida/Desktop/github_token.txt)"
git -c credential.helper='!f(){ echo "username=x"; echo "password=$GH_TOKEN"; };f' fetch heraklines dev-logs --quiet
git log --pretty='%h %ci %s' -15 heraklines/dev-logs        # newest commit = newest log; "(by <name>)" = the tester
git show --name-only --pretty='' <commit>                   # the file path that commit added
git show heraklines/dev-logs:remote/<YYYY-MM-DD>/<ts>__<scenario>__<tester>.log   # print the capture
```

- The `<tester>` is whatever the in-game `getTesterName()` returned. **Co-op clients
  show up as e.g. `coop-test1` and (unnamed partner) `anon`** - the two clients of ONE
  session land as two back-to-back commits seconds apart, so read BOTH (host + guest).
- Grep just the co-op handshake/sync state across a capture:
  `git show heraklines/dev-logs:<path> | grep -iE "coop-launch|coop-runconfig|coop-fp|role=|bothReady|partnerReady|MISMATCH|EncounterPhase|SAVE_SLOT"`.

### Scraping the Discord bug channels (bulk triage)

For a multi-day sweep of the Discord (`#bugs`, `#bug-reports`, `#suggestions`, etc.),
the scraper lives at `C:\Users\Hafida\discord-bug-bot` (a tsx bot; `.env` holds the
bot token + server id — never print/commit it). Run:

```
cd /c/Users/Hafida/discord-bug-bot
LOOKBACK_DAYS=4 PATCH_NOTES_DIR= npx tsx src/index.ts --once   # last 4 days, skip the patch-notes fixed-check
```

It scrapes → categorizes each message (Codex for text, Claude for images) into
**Bugs / Feature Requests / Suggestions** → writes `reports/<YYYY-MM-DD>.md`.
Override `LOOKBACK_DAYS` (default 1) for the window; leave `PATCH_NOTES_DIR` empty to
skip cross-referencing against patch notes. The two env overrides do NOT touch `.env`
(dotenv won't override an already-set process var).

## Writing rules (maintainer)
- NEVER use an em dash in patch notes or any player-facing text. Use a
  regular hyphen, a comma, or restructure the sentence.

## 🔴 Assets (ER-custom images + audio) - READ BEFORE ADDING ANY

ER-custom art/audio is NOT served from this repo. Every custom image, sprite,
and audio file loads from the **er-assets CDN** (`Heraklines/er-assets` via
jsDelivr). At runtime `globalScene.loadImage(key, "dir", "file.png")` resolves to
`https://cdn.jsdelivr.net/gh/Heraklines/er-assets@<pin>/images/dir/file.png` (the
deploy rewrites `/images/*` etc. to that CDN in `dist/_redirects`). **Putting a
file in `public/images/...` does NOTHING for the deployed build - it 404s.** (I
have lost hours to this: the portrait shipped in-repo but the game fetched it from
the CDN and 404'd. The console error `cdn.jsdelivr.net/gh/Heraklines/er-assets@.../
images/... 404` is the tell.)

To add a custom asset:
1. Copy the file into the er-assets checkout at `../er-assets/images/<path>`
   (local clone: `C:\Users\Hafida\pokerogue\.worktrees\er-assets`, remote
   `Heraklines/er-assets`, push token already baked into its remote URL).
2. `git -C ../er-assets add <file>`, commit, then **rebase onto origin/main before
   pushing** (other agents push there too) and `git push origin HEAD:main`.
3. Re-run the staging deploy. It auto-resolves the jsDelivr pin to er-assets@main
   HEAD (`.github/workflows/deploy-staging.yml` step "Resolve er-assets HEAD"), so
   the new commit's files are served - **no manual pin bump**. jsDelivr caches per
   `@<sha>`, so the new pin is never stale.
4. Load it in `src/loading-scene.ts` via `.loadImage(key, "<dir>", "<file>")` and
   use `key` as the texture in code.

Examples already in-repo (grep `er-assets` in `src/`): relic icons, terrain-seed +
elemental-gem item sprites, Colosseum chrome, black-market shopkeeper, Cynthia BGM.
If the custom asset isn't on er-assets yet, fall back to an EXISTING loaded texture
(as the other ER event intro sprites do) so the screen never shows a missing/green
texture.

## 🔴 Adding new Pokemon (species or forms) — integration checklist

Distilled from the newcomer-patch bug classes. New content touches MANY data paths
that the battle path does NOT cover; verify each with a TEST, never assume. Every
item below has bitten us.

- **Icons resolve on EVERY surface, not just battle.** Battle lazily loads the
  per-slug `er_icon__<slug>` atlas via `ErCustomSpecies.loadAssets`; title-screen
  surfaces (save-slot preview, party, starter-select, egg-summary) do NOT. Preload
  every slug-based custom species icon at boot (`loadEliteReduxCustomIcons` in
  `loading-scene.ts`, driven by a STATIC list — the loader runs BEFORE
  `initializeGame`, so a live registry is empty there). All UI paths funnel through
  `Pokemon.getIconAtlasKey`/`getIconId` → the active species-FORM's override — a
  species-level override is bypassed when `getSpeciesForm()` returns a FORM lacking
  it (#308 class). Test the resolved key for each new id.
- **TM learnsets are a SEPARATE data path** (`tmSpecies` / `speciesTmMoves`) from
  level-up learnsets (`pokemonSpeciesLevelMoves`). A new species id gets NO TMs
  unless explicitly wired (this patch's miss). Wire BOTH tables (item-compat vs
  Pokedex/AI/Showdown). Default: inherit the pre-evo/base's full `speciesTmMoves`
  superset + type-appropriate additions; standalone mons get a hand set. Mega/primal
  FORMS inherit the base species' TM compat for free (`generateCompatibleTms` matches
  a plain `tmSpecies` entry to species id regardless of form). Run the wiring LAST in
  init, after `initEliteReduxPokedexOverrides` finalizes base TM lists. Test: TM list
  non-empty AND a pre-evo/base superset.
- **No-leak is omission-based.** An evolution-only species must NOT get a
  `speciesStarterCosts` entry or a `speciesEggTiers` entry (that's what keeps it out
  of the starter grid / egg pool / wild rolls — #232/#352). Egg-obtainable standalones
  (Regitube) use the custom-mons path and DO get an egg tier. Regression-test both.
- **Sprite slugs must match the PUBLISHED er-assets dir names EXACTLY** (word-order
  drift happened this patch). The atlas contract: frames `0001.png..NNNN`, 10fps
  default, optional cadence block. Verify front + back + shiny atlas keys resolve.
- **Cry is opt-in.** The base ER-custom load path is sprite-only and queues no cry;
  `getCryKey` returns a well-formed key that `playSound` tolerates (silent, not a
  crash). Only wire `cryKey`/`cryFile` when the audio is published. Never let a custom
  id hit the vanilla `getCryKey`/`getExpandedSpeciesName` (they crash on id ≥ 10000).
- **N-typing (3rd+ type) is `setExtraTypes`** on the species OR a specific form
  (per-instance, not keyed by id). `getBaseTypes()` folds the ACTIVE form's extras in,
  so a mega can add a type the base lacks. Author it as `types: [t1, t2, ...extras]`.
- **Forms use the form-injection seam, species use `registerErEditorMon`.** A
  mega/primal/alt form is injected onto its BASE species' `forms[]`
  (`injectNewcomerForms`), NOT registered as a standalone species. Its abilities are
  read from `baseSpecies.forms[formKey]` (the Mega ability-override bug class).
- **Variant/partner CLONES must keep base forms byte-identical.** A partner/alias
  family that grafts onto a base (e.g. partner-Eevee) must not mutate the base species
  or its other forms. Regression-test the base kit stays identical.
- **Verify each surface with a test.** The battle path passing does NOT imply the
  save/party/starter/egg/Pokedex paths pass — they use different accessors. Add a
  handler/data-tier test per surface (see `er-newcomer-integration-sweep.test.ts`).

## Deploy

🔴 **We work and deploy entirely from `feat/elite-redux-port`. NEVER touch `main`.**
`main` only holds CI workflow config and is ~thousands of commits behind feat -
that divergence is EXPECTED and IRRELEVANT. Do not merge feat into main, do not
push main, do not compare against `heraklines/main` to decide what ships. Both
staging AND production build from the HEAD of `feat/elite-redux-port` via
manual-dispatch workflows (the `--branch main` in deploy-prod.yml is just the
Cloudflare Pages production alias, not a git branch we maintain).

- Dev branch / remote: `feat/elite-redux-port` on remote `heraklines`
  (`Heraklines/elite-redux`). Commit + push there.
- **Staging deploy:** `gh workflow run deploy-staging.yml --ref feat/elite-redux-port -R Heraklines/elite-redux`
  (GH token in `C:\Users\Hafida\Desktop\github_token.txt`; set `GH_TOKEN`, never print it). Builds + deploys to `elite-redux-staging.pages.dev`.
- **Production deploy:** `gh workflow run deploy-prod.yml --ref feat/elite-redux-port -R Heraklines/elite-redux`
  (manual dispatch; builds feat HEAD, no dev tools, points at the prod worker, ships to `elite-redux.pages.dev`).
- **Never deploy to production without explicit permission.**
- You are free to push + staging-deploy after making changes.

## Build / checks
- `npx tsc --noEmit` baseline is **277 errors** (pre-existing; re-measured 2026-07-02 -
  the old "267" note was stale). A correct change keeps it at 277 — more = you
  introduced an error.
- ⚠️ Do NOT run bare `pnpm biome` for a scoped change: `--changed` diffs against `main`
  (thousands of commits behind) and reformats ~700 files repo-wide. Use
  `npx biome check --write <your files>`.
- Known red (pre-existing, fails on clean HEAD): the `summary gift-cycle (R) ... (#349)`
  case in `test/tools/render-ui-page.test.ts` - the gift ability id no longer advances
  on R. Possible real regression of the #349 fix; triage separately.
- Two REAL bugs found + FIXED by the full-run harness (2026-07-02, each still owes its
  in-game dev scenario + dedicated vitest per the standing rule):
  1. `game-data.ts addStarterCandy` handed the candy bar the raw speciesId while only
     the evolution-line ROOT bucket is guaranteed (SNORLAX candy lives under MUNCHLAX)
     -> `candyCount` of undefined TypeError on wave-won achievement grants (live
     black-screen class). Fixed: pass `getRootStarterSpeciesId(baseId)`.
  2. Variant-DOUBLE trainer rolled into a SINGLE battle: party gen assigns alternating
     `trainerSlot`s, and FaintPhase + `getPartyMemberMatchupScores`/`getNextSummonIndex`
     slot-gated by the trainer VARIANT, so slot-2 reserves could never be summoned ->
     the fainted lead sat on an empty field, battle unwinnable (the "enemies aren't
     even there" tester class). Fixed: slot-gate only when the BATTLE is a double
     (faint-phase.ts, trainer.ts x2).
- CI gates on **biome** + **vitest** (not tsc). Pre-commit runs biome:staged +
  ls-lint.
- Tests: `npx vitest run <path>`. ER tests live in `test/tests/elite-redux/`.
- `test`-helper note: `game.classicMode.startBattle(SpeciesId.X)` takes a bare
  species (or a tuple), NOT `[SpeciesId.X]` (that widens to `SpeciesId[]` and
  fails tsc).
