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
node scripts/run-scenario.mjs <ERS1-code | @spec.json | demo> [--turns N] [--move MOVE]
```

- `demo` runs a built-in smoke battle. An `ERS1.` share code (from the in-game
  scenario builder / a bug report) reproduces that exact situation. `@file.json`
  or inline JSON is a raw `ScenarioSpec`.
- **Authoring JSON specs:** use enum NAMES anywhere an id is expected
  (`species:"GRENINJA"`, `ability:"HIGH_TIDE"`, `moves:["SURF"]`, `weather:"RAIN"`).
  Force an arbitrary ability/innate (incl. ER ids) per mon with `ability` /
  `passiveAbility` (player lead + enemy); give the enemy items with `heldItems:
  [{name:"LEFTOVERS"}]`. Script the player's turns with `script:[{move,target,
  move2,target2}]` (target is a BattlerIndex: 2/3 = enemies). Self-verify with an
  `expect` block: `playerAbility`/`enemyAbility`, `player/enemyStatus`,
  `player/enemyHp` ({min,max,equals}), `player/enemyStage` ({stat,value}),
  `player/enemyFainted`, `weather`, `terrain`, `maxHits`, `outcome`, and
  `logIncludes` / `logExcludes` (substring match on the battle message log, the
  catch-all). A failed `expect` exits nonzero with the exact mismatches.
- More knobs: `run.terrain` (NONE/MISTY/ELECTRIC/GRASSY/PSYCHIC/TOXIC); in
  doubles, `start.player2Stages`/`player2HpPct`/`player2Status` (+ `enemy2*`) set
  the 2nd mon on each side. Flags `--no-miss` (force every move to hit) and
  `--no-crit` (no crits) make damage / stat-stage assertions reproducible.
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
node scripts/run-ui-scenario.mjs [species,species,...] [--strict]
```

- A species is a `SpeciesId` name, an `ErSpeciesId` NAME (e.g. `RATTATA_REDUX`), or a
  numeric id. Omitted = a built-in demo (vanilla baseline + live wrong-sprite / crash
  repros). `--strict` promotes the sprite-mismatch WARNING to a hard error.
- Per species it prints a `STATE {…}` (threw / ability / passives / spriteKey /
  spriteAtlas / iconId) then a `RESULT {…}` with `errors[]` (threw / blank ability -
  fail the run) and `warnings[]` (sprite atlas does not reference the species name
  token - possible wrong sprite). `getSpriteKey`/`getSpriteAtlasPath` route through the
  ER sprite-redirect, so a redirect / id-collision regression shows up directly.
- Files: `test/tools/run-ui-scenario.test.ts` (currently the STARTER_SELECT handler -
  it calls the REAL `setSpeciesDetails`) + `scripts/run-ui-scenario.mjs`. Sets
  `ER_SCENARIO=1` for you.
- **SCOPE:** this is the DATA/STATE tier - it does NOT rasterize. True pixel checks
  (alignment / colour / transparency / green-box) need a separate `CANVAS` +
  node-canvas harness (`renderer.snapshot()` -> PNG diff); not built yet. It extends
  to the pokedex / egg-hatch / shop / mystery-encounter handlers the same way: drive
  the handler, snapshot its computed state + the keys it resolves.

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
- `npx tsc --noEmit` baseline is **267 errors** (pre-existing). A correct change
  keeps it at 267 — more = you introduced an error.
- CI gates on **biome** + **vitest** (not tsc). Pre-commit runs biome:staged +
  ls-lint.
- Tests: `npx vitest run <path>`. ER tests live in `test/tests/elite-redux/`.
- `test`-helper note: `game.classicMode.startBattle(SpeciesId.X)` takes a bare
  species (or a tuple), NOT `[SpeciesId.X]` (that widens to `SpeciesId[]` and
  fails tsc).
