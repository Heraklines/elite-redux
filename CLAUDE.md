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
