# Elite Redux — project notes for Claude

Elite Redux (ER) is a PokeRogue fork (TypeScript + Phaser + Vite). This file is
auto-loaded every session — read it and follow it.

## 🔴 STANDING RULE — every bug fix gets an in-game test scenario

**Whenever you fix a bug (or change behavior) that is observable in-game, you
MUST add a matching scenario to the in-game dev TEST SUITE** so the maintainer
and the testing team can verify the fix on the testing site by themselves.

This is mandatory, not optional. Do it as part of the fix, in the same batch.

- **Where:** `src/dev-tools/test-suite/scenarios.ts` (tracked). Copy an existing
  block. Give it a short `label`, a `description` (the bug #, what to DO, what to
  EXPECT — testers read this), a `setup()` (party + pre-battle `Overrides`), and
  an optional `onBattleStart()` for mid-combat state (pre-boosted stages via
  `boostPlayer`/`boostEnemy`, etc.).
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

## Deploy
- Dev branch / remote: `feat/elite-redux-port` on remote `heraklines`
  (`Heraklines/elite-redux`). Commit + push there.
- **Staging deploy:** `gh workflow run deploy-staging.yml --ref feat/elite-redux-port -R Heraklines/elite-redux`
  (GH token in `C:\Users\Hafida\Desktop\github_token.txt`; set `GH_TOKEN`, never print it). Builds + deploys to `elite-redux-staging.pages.dev`.
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
