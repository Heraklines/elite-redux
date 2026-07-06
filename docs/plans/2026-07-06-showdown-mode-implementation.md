# Showdown Mode (1v1 PvP) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A 1v1 PvP mode with wagered collection unlocks (design: `docs/plans/2026-07-06-showdown-mode-design.md` in the main worktree), bootstrapped from the co-op authoritative netcode.

**Architecture:** Host-authoritative battle reusing the co-op transport/streamer/replay/checksum stack verbatim; a showdown branch in starter-select for teambuilding; a stake-escrow ledger in `er-save-api` with dual-attestation settlement applied client-side (saves are opaque encrypted blobs — the server records outcomes, honest clients apply them).

**Tech Stack:** TypeScript + Phaser (client), Cloudflare Workers + D1 (escrow), vitest (all tests). Worktree: `C:/Users/Hafida/pokerogue/.worktrees/showdown`, **detached HEAD at `coop-me-authoritative` tip — NO new branches, NO pushes.**

**Ground rules from project CLAUDE.md (binding):**
- `npx tsc --noEmit` baseline on THIS branch tip is **285 errors** (measured; the project CLAUDE.md's 267 is stale for this branch). More than 285 = you broke something.
- Any screen change goes through the render harness (`test/tools/render-ui-page.test.ts`) — reproduce before, verify after, new screen ⇒ new `PAGE_RECIPES` entry.
- Any sync-layer code gets a two-engine repro in `test/tools/coop-duo-harness.ts` patterns.
- ER engine tests are gated `ER_SCENARIO=1`. PowerShell: `$env:ER_SCENARIO="1"; npx vitest run <path>`.
- Co-op tests that swap `globalScene` MUST restore it in `afterEach` (`initGlobalScene`).
- Never use `as any` / `@ts-ignore`. Never touch `main`.

**Key facts (from exploration, verified against this worktree):**
- `GameModes` enum: `src/enums/game-modes.ts` (append-only numeric ids; `COOP` is last).
- `GameMode.isCoop`: `src/game-mode.ts:73`; mode construction switch ~`:611`.
- Title menu options: `src/phases/title-phase.ts:128-141`; co-op lobby launcher `openCoopLobby` `:251-338`.
- Wire union `CoopMessage`: `src/data/elite-redux/coop/coop-transport.ts:532-803` — additive; unknown `t` ignored. `CoopTransport` interface `:806`; `LoopbackTransport` `:895`; `createLoopbackPair()` `:988`.
- Host command relay template: `CoopBattleSync.requestPartnerCommand` (`coop-battle-sync.ts:115`) — host sends `commandRequest`, awaits `command`, AI fallback on timeout.
- Streaming/replay: `CoopBattleStreamer` (`coop-battle-stream.ts:95`), `TurnEndPhase.emitCoopTurn` (`src/phases/turn-end-phase.ts:170`), `CoopReplayTurnPhase` (`src/phases/coop-replay-turn-phase.ts:39`), `CoopFinalizeTurnPhase` + checksum verify (`src/phases/coop-replay-phases.ts:698,736`), resync heal loop (`:1020`).
- Enemy from serialized mon: `buildCoopEnemy` (`coop-enemy-builder.ts:43`); host capture `captureCoopEnemies` (`coop-battle-engine.ts:847`); guest adopt `EncounterPhase.adoptCoopHostEnemyParty` (`src/phases/encounter-phase.ts:192`).
- Checksum: pure `checksumState` (`coop-battle-checksum.ts:215`).
- Lifecycle/grace: `CoopLifecycle`, `COOP_DISCONNECT_GRACE_MS = 120_000` (`coop-lifecycle.ts`).
- Starter select: `src/ui/handlers/starter-select-ui-handler.ts` (6676 lines). Branches by `globalScene.gameMode.isCoop`, NOT a mode enum: `getValueLimit()` `:3935`, `getPartySizeLimit()` `:3963`. Base-forms-only filter ~`:4192`. Party build `addToParty` `:3639`; handoff `Starter[]` via callback (`save-data.ts:186` for the `Starter` interface). Cost: `gameData.getSpeciesStarterValue` (`game-data.ts:2852`), table `speciesStarterCosts` (`src/data/balance/starters.ts:35`, range 1–10).
- Shiny model: `DexAttr` bigint bits (`src/enums/dex-attr.ts`): `SHINY=2n`, `DEFAULT_VARIANT=16n`, `VARIANT_2=32n`, `VARIANT_3=64n`. ER black shiny = `StarterDataEntry.erBlackShiny` (separate bool). Candy: `starterData[id].candyCount`, grant via `addStarterCandy` (`game-data.ts:2615`); transfer pattern in `er-redux-dex-redirect.ts:146`.
- **Megas are permanent-by-form in this fork**: spawn directly into the mega `formIndex` (no in-battle toggle). Mega data: `ER_MEGA_FORMS` (`er-mega-forms.ts`), reverse map `erMegaTargetToBaseSpeciesId` (`er-generic-pool-bans.ts:72`), stones `ER_MEGA_STONE_ITEMS` (`er-mega-stones.ts`).
- Held item registry: `modifierTypes` (`src/modifier/modifier-type.ts` ~2200). No existing PvP whitelist.
- Workers: `er-save-api` has HMAC auth (`signToken`/`verifyToken`/`authUser` at `index.ts:188/194/268`), atomic `env.DB.batch([...])` (`:749`), conditional-write guard (`:518`), `ON CONFLICT DO NOTHING` idempotency (`:879`). `er-coop-api handleLobbyPick` (`index.ts:384-427`) shows the conditional-UPDATE-claim + rollback race pattern. **Saves are opaque client-encrypted blobs — the server CANNOT edit a save.** **No worker test setup exists; `vitest.config.ts` include globs cover `./test/**` and `./scripts/**` only.**
- `test/tools/coop-fault-transport.ts` / `coop-soak-driver.ts` do NOT exist on this branch (other agents' worktrees). Extend `coop-duo-harness.ts` only.

**Settlement reality check (drives Phase D):** since saves are opaque, "server transfers the shiny" is impossible. Instead: the server keeps an authoritative **settlement ledger** (match, stakes, outcome). Clients apply mutations locally and re-upload saves; `GET /showdown/pending` lets an honest client self-apply anything unapplied at login. Cheat ceiling is consistent with host-authoritative trust: a hacked client can dodge its own loss locally, but the ledger records it, and it can never *take* what wasn't awarded.

---

## Phase A — Pure foundations (no UI, no netcode, no ER_SCENARIO gate)

### Task A1: Stake tiers (`showdown-stakes.ts`)

**Files:**
- Create: `src/data/elite-redux/showdown/showdown-stakes.ts`
- Test: `test/tests/elite-redux/showdown/showdown-stakes.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  type StakeOffer,
  stakeTier,
  stakesMatch,
} from "#app/data/elite-redux/showdown/showdown-stakes";

const nonShiny = (cost: number): StakeOffer => ({
  speciesId: 1, shiny: false, variant: 0, erBlackShiny: false, cost,
});
const shiny = (variant: 0 | 1 | 2, cost = 5): StakeOffer => ({
  speciesId: 1, shiny: true, variant, erBlackShiny: false, cost,
});

describe("stakeTier", () => {
  it("ranks non-shinies by starter cost, below every shiny", () => {
    expect(stakeTier(nonShiny(1))).toBeLessThan(stakeTier(nonShiny(10)));
    expect(stakeTier(nonShiny(10))).toBeLessThan(stakeTier(shiny(0, 1)));
  });
  it("ranks shiny variants as sub-tiers", () => {
    expect(stakeTier(shiny(0))).toBeLessThan(stakeTier(shiny(1)));
    expect(stakeTier(shiny(1))).toBeLessThan(stakeTier(shiny(2)));
  });
  it("ranks ER black shiny above variant 3", () => {
    expect(stakeTier(shiny(2))).toBeLessThan(
      stakeTier({ ...shiny(2), erBlackShiny: true }),
    );
  });
});

describe("stakesMatch", () => {
  it("matches same-tier offers only", () => {
    expect(stakesMatch(nonShiny(8), nonShiny(8))).toBe(true);
    expect(stakesMatch(nonShiny(10), shiny(0))).toBe(false);
    expect(stakesMatch(shiny(1), shiny(1, 10))).toBe(true); // shiny tier ignores cost
    expect(stakesMatch(shiny(1), shiny(2))).toBe(false);
  });
});
```

**Step 2: Run it — expect FAIL (module not found)**

`npx vitest run test/tests/elite-redux/showdown/showdown-stakes.test.ts`

**Step 3: Implement**

```ts
/**
 * Showdown stake valuation. Pure, engine-free.
 * Rule (design doc): shinies rank STRICTLY above every non-shiny.
 * Non-shiny tier = starter cost (1-10). Shiny tiers start at 100 + variant,
 * ER black shiny above all. Two offers may be wagered against each other
 * only when their tiers are EQUAL.
 */
export interface StakeOffer {
  speciesId: number;
  shiny: boolean;
  /** 0 | 1 | 2 — DexAttr DEFAULT_VARIANT / VARIANT_2 / VARIANT_3 */
  variant: number;
  erBlackShiny: boolean;
  /** speciesStarterCosts value for the line (only meaningful when !shiny) */
  cost: number;
}

const SHINY_TIER_BASE = 100;
const BLACK_SHINY_TIER = SHINY_TIER_BASE + 10;

export function stakeTier(offer: StakeOffer): number {
  if (offer.erBlackShiny) {
    return BLACK_SHINY_TIER;
  }
  if (offer.shiny) {
    return SHINY_TIER_BASE + offer.variant;
  }
  return offer.cost;
}

export function stakesMatch(a: StakeOffer, b: StakeOffer): boolean {
  return stakeTier(a) === stakeTier(b);
}
```

**Step 4: Run — expect PASS. Step 5: `npx tsc --noEmit` still 267. Step 6: checkpoint commit** (`git add -A; git commit -m "feat(showdown): stake tier valuation"` — local detached-HEAD checkpoint, never pushed).

### Task A2: Held-item whitelist (`showdown-item-pool.ts`)

**Files:**
- Create: `src/data/elite-redux/showdown/showdown-item-pool.ts`
- Test: `test/tests/elite-redux/showdown/showdown-item-pool.test.ts`

**Step 1: Failing test** — every whitelisted key must exist in `modifierTypes` (guards against typos/renames):

```ts
import { describe, expect, it } from "vitest";
import { SHOWDOWN_ITEM_POOL } from "#app/data/elite-redux/showdown/showdown-item-pool";
import { modifierTypes } from "#app/modifier/modifier-type";

describe("SHOWDOWN_ITEM_POOL", () => {
  it("contains only real modifierTypes keys", () => {
    for (const key of SHOWDOWN_ITEM_POOL) {
      expect(modifierTypes[key], `unknown modifier key ${String(key)}`).toBeDefined();
    }
  });
  it("has no duplicates", () => {
    expect(new Set(SHOWDOWN_ITEM_POOL).size).toBe(SHOWDOWN_ITEM_POOL.length);
  });
});
```

**Step 2: implement** — a single curated array (one-line balance tweaks, per design):

```ts
import type { modifierTypes } from "#app/modifier/modifier-type";

export type ShowdownItemKey = keyof typeof modifierTypes;

/** Curated held items legal in showdown (one per mon). Balance edits happen HERE only. */
export const SHOWDOWN_ITEM_POOL: readonly ShowdownItemKey[] = [
  "LEFTOVERS",
  "SHELL_BELL",
  "FOCUS_BAND",
  "QUICK_CLAW",
  "KINGS_ROCK",
  "TOXIC_ORB",
  "FLAME_ORB",
  "FROSTBITE_ORB",
  "BATON",
] as const;
```

(If a key fails the test because this branch names it differently, fix the LIST, not the test.)

**Steps 3-5:** run, tsc, checkpoint commit.

### Task A3: Team manifest + `validateShowdownTeam()`

**Files:**
- Create: `src/data/elite-redux/showdown/showdown-team.ts`
- Test: `test/tests/elite-redux/showdown/showdown-team.test.ts`

The manifest is what crosses the wire and what BOTH clients validate (own team at ready-up, opponent's on receipt). Keep it engine-free: collection legality takes an injected `UnlockSnapshot` so tests need no `GameData`.

**Step 1: Failing tests** covering, at minimum:
- exactly 6 mons, all level 100, else `teamSize` / `level` violations;
- every mon's item ∈ `SHOWDOWN_ITEM_POOL` (or mega-stone sentinel), exactly one item, else `item`;
- ≤1 mega/primal per team (`isMegaForm(speciesId, formIndex)` predicate injected), else `megaLimit`;
- a mega mon's item MUST be `"MEGA_STONE"` sentinel (locked slot) and a non-mega must NOT carry it, else `megaItem`;
- species must be in the unlock snapshot (root line unlocked), shiny/variant claimed must be unlocked, ability/nature/egg-move indices within unlocked masks, else `collection`;
- duplicate species (species clause) rejected, else `duplicate`.

Shape sketch for the test file:

```ts
import { describe, expect, it } from "vitest";
import {
  type ShowdownMonManifest,
  type UnlockSnapshot,
  validateShowdownTeam,
} from "#app/data/elite-redux/showdown/showdown-team";

const mon = (over: Partial<ShowdownMonManifest> = {}): ShowdownMonManifest => ({
  speciesId: 6, formIndex: 0, level: 100, shiny: false, variant: 0,
  abilityIndex: 0, nature: 0, ivs: [31, 31, 31, 31, 31, 31],
  moveset: [1, 2, 3, 4], item: "LEFTOVERS", rootSpeciesId: 4,
  ...over,
});
const team = (n = 6, over: Partial<ShowdownMonManifest> = {}) =>
  Array.from({ length: n }, (_, i) => mon({ speciesId: 100 + i, rootSpeciesId: 100 + i, ...over }));
const allUnlocked: UnlockSnapshot = {
  isRootUnlocked: () => true, isShinyUnlocked: () => true,
  isAbilityUnlocked: () => true, isNatureUnlocked: () => true,
  isMoveLegal: () => true,
};
const noMegas = () => false;

describe("validateShowdownTeam", () => {
  it("accepts a legal team", () => {
    expect(validateShowdownTeam(team(), allUnlocked, noMegas)).toEqual([]);
  });
  it("rejects wrong team size", () => {
    expect(validateShowdownTeam(team(5), allUnlocked, noMegas)).toContainEqual(
      expect.objectContaining({ rule: "teamSize" }),
    );
  });
  // ... one it() per rule above, including the two-megas case with
  // isMega = (id: number) => id === 100 || id === 101
});
```

**Step 2: implement.** `validateShowdownTeam(team, unlocks, isMegaForm): ShowdownRuleViolation[]` returning `{ rule, slot?, message }[]`; `MEGA_STONE_ITEM = "MEGA_STONE"` sentinel exported. ~80 lines of straight checks. No engine imports (types only).

**Steps 3-5:** run, tsc, checkpoint commit.

### Task A4: Wire messages (additive `CoopMessage` variants)

**Files:**
- Modify: `src/data/elite-redux/coop/coop-transport.ts` (append to the `CoopMessage` union, ~line 803)
- Test: `test/tests/elite-redux/showdown/showdown-wire.test.ts`

New variants (all prefixed `showdown*`; unknown `t` is ignored by old clients, so this is backward-safe):

```ts
| { t: "showdownStakeOffer"; offer: ShowdownStakeOfferWire }        // ante lobby: my staked unlock
| { t: "showdownStakeLock"; matchId: string; tier: number }         // I accept; includes computed tier for cross-check
| { t: "showdownTeam"; manifest: ShowdownMonManifestWire[] }        // post-teambuild exchange
| { t: "showdownReady"; teamHash: string }                          // both ready => battle starts
| { t: "showdownCommand"; turn: number; command: SerializedCommand } // guest's per-turn command for its own side
| { t: "showdownCommandRequest"; turn: number }                     // host asks guest for its command
| { t: "showdownResult"; matchId: string; winner: CoopRole; reason: "victory" | "forfeit" | "timeout" }
| { t: "showdownVoid"; matchId: string; reason: "checksum" | "illegalTeam" | "earlyDisconnect" }
```

Wire types (`ShowdownStakeOfferWire`, `ShowdownMonManifestWire`) live in `coop-transport.ts` next to `CoopSerializedStarter` (`:87`) and structurally mirror `StakeOffer` / `ShowdownMonManifest` (transport must not import from `showdown/` — keep the dependency one-way, matching how `coop-transport.ts` is imported by everything).

**Test:** round-trip each new message through `createLoopbackPair()` (pattern: `coop-webrtc-transport.test.ts`'s framing tests — JSON encode/decode, `onMessage` fires with the same payload). No engine, no ER_SCENARIO gate.

**Steps:** failing test → implement → run → tsc (267) → checkpoint commit.

---

## Phase B — Game mode + teambuilder (render-harness rule applies)

### Task B1: `GameModes.SHOWDOWN` + `GameMode.isShowdown`

**Files:**
- Modify: `src/enums/game-modes.ts` (append `SHOWDOWN` after `COOP` — ids are append-only, saved as modeId)
- Modify: `src/game-mode.ts` — mirror every `case GameModes.COOP:` decision (lines ~371, 394, 467, 484, 506, 517, 552, 611) with a SHOWDOWN case; add `public isShowdown: boolean` beside `isCoop` (`:73`) and a `GameModeConfig.isShowdown?` (`:49`). Mode deltas: starting level **100**, single battle (no waves — see Task C3), no shop, no exp.
- Test: `test/tests/elite-redux/showdown/showdown-game-mode.test.ts` — construct the mode object (pattern: any existing game-mode test, or assert via `getGameMode(GameModes.SHOWDOWN)`): `isShowdown === true`, `getStartingLevel() === 100`.

Check how `getStartingLevel` is actually implemented in `game-mode.ts` before editing (grep `getStartingLevel`); add the SHOWDOWN branch there.

**Steps:** failing test → implement → run → tsc → checkpoint commit.

### Task B2: Starter-select showdown branch — limits + evolved forms

**Files:**
- Modify: `src/ui/handlers/starter-select-ui-handler.ts`
- Test: extend `test/tools/render-ui-page.test.ts` `PAGE_RECIPES` with `starter-select-showdown` (CLAUDE.md standing rule) + a data-level vitest for the pure helpers you extract.

Changes, each anchored:
1. `getValueLimit()` (`:3935`): `if (globalScene.gameMode.isShowdown) return 999;` (cost ceiling deferred by design).
2. `getPartySizeLimit()` (`:3963`): showdown → 6 (`PLAYER_PARTY_MAX_SIZE`).
3. Base-forms-only grid filter (~`:4192`, "ER: only BASE forms are selectable starters"): keep the GRID showing base starters (collection is keyed by root), but in showdown mode `addToParty` (`:3639`) resolves the FIELDED species through a new **stage picker** (Task B3).
4. Starting level: showdown teams are built at level 100 — no handler change needed if B1's `getStartingLevel()` returns 100 (the phase applies it); verify in C3's test.

**Render-harness protocol:** render `starter-select` BEFORE touching anything (baseline sanity), make changes, add the `starter-select-showdown` recipe (a `prepare(game)` that sets the game mode to SHOWDOWN — mirror how the co-op baseline recipe flips `isCoop`), render, eyeball `dev-logs/ui-pages/starter-select-showdown.png`, commit the new baseline PNG via `ER_UPDATE_BASELINE=1`.

**Steps:** extract pure decisions (`showdownValueLimit`, `showdownPartyLimit` are trivial — test via the handler branch directly in the render recipe) → implement → render before/after → tsc → checkpoint commit.

### Task B3: Evolution-stage picker

**Files:**
- Create: `src/data/elite-redux/showdown/showdown-evolutions.ts` (pure resolution)
- Modify: `src/ui/handlers/starter-select-ui-handler.ts` (UI hook)
- Test: `test/tests/elite-redux/showdown/showdown-evolutions.test.ts`

**Pure core first (TDD):** `listEvolutionStages(rootSpeciesId): SpeciesId[]` — walk `pokemonEvolutions` (`src/data/balance/pokemon-evolutions.ts:333`) forward from the root, breadth-first, dedup (branching lines like Eevee return all branches). Include mega stages via `ER_MEGA_FORMS` filtered to the line (each entry gives `targetErId` + `formKey`). Test with known lines: Charmander → [Charmander, Charmeleon, Charizard, + mega X/Y entries], Eevee → all eeveelutions.

**UI hook:** in showdown mode, selecting a starter opens an option list (reuse the existing option-select sub-menu pattern the handler already uses for ability/nature cycling — grep `OptionSelect` usage inside the handler) listing `listEvolutionStages(...)`; the picked stage is stored on the pending `Starter` as `showdownSpeciesId` + `showdownFormIndex` (new optional fields on `Starter` in `src/@types/save-data.ts:186` — optional so save-compat is untouched).

**Steps:** failing pure test → implement pure → pass → UI hook → render-harness `steps:` drive (recipe input steps to open the picker; snapshot) → tsc → checkpoint commit.

### Task B4: Held-item picker + mega slot rule

**Files:**
- Modify: `src/ui/handlers/starter-select-ui-handler.ts`, `src/@types/save-data.ts` (add `showdownItem?: ShowdownItemKey | "MEGA_STONE"` to `Starter`)
- Test: pure rule tests already exist (A3); render-harness step-drive for the picker UI.

Behavior: a new option in the starter sub-menu ("Held Item") listing `SHOWDOWN_ITEM_POOL`; picking a mega stage in B3 force-sets `showdownItem = "MEGA_STONE"` and the item option renders locked/greyed; picking a second mega is rejected at `addToParty` with the existing error-toast pattern (grep how cost-cap rejection is surfaced in `tryUpdateValue` ~`:6065` and reuse it). Enforcement source of truth stays `validateShowdownTeam` (A3) at confirm.

**Steps:** render-drive failing (picker absent) → implement → render-drive pass → tsc → checkpoint commit.

### Task B5: Confirm handoff → manifest

**Files:**
- Modify: `src/ui/handlers/starter-select-ui-handler.ts` (`tryStart` `:6274`)
- Create: `src/data/elite-redux/showdown/showdown-manifest.ts` — `starterToManifest(starter: Starter, gameData): ShowdownMonManifest` + `buildUnlockSnapshot(gameData): UnlockSnapshot`
- Test: `test/tests/elite-redux/showdown/showdown-manifest.test.ts` (ER_SCENARIO-gated if it needs `GameManager`; prefer stubbing `gameData` fields directly to stay ungated)

In showdown mode `tryStart` runs `validateShowdownTeam(manifests, buildUnlockSnapshot(gameData), isMegaForm)` and refuses start on violations (toast the first violation message). `isMegaForm` implementation: species/form in `ER_MEGA_FORMS` targets or vanilla `SpeciesFormKey.MEGA*`/primal form keys.

**Steps:** failing test (manifest mapping incl. shiny/variant/egg-move bits) → implement → pass → tsc → checkpoint commit.

---

## ⚠️ ARCHITECTURE RESET (2026-07-06, maintainer briefing) — READ BEFORE ANY PHASE C/D WORK

The worktree is now synced to `heraklines/feat/elite-redux-port` (tip ee9370293) — the single
source of truth. The co-op netcode was REWRITTEN since the June-30 base this plan was first
written against. New tsc baseline on this base: **303 errors** (bare tip = with-stack = 303).
Multiple agents land co-op commits on this branch daily — re-fetch + re-rebase before finalizing.

**Current architecture (binding):**
- **Full-state turn replication** (c18da4fb7 onward): host streams `CoopAuthoritativeBattleStateV1`
  every turn — both parties as `PokemonData[]` in authoritative order (live state on summonData),
  seating-only `field[]`, arena, money, modifiers. Guest applies wholesale keyed by `Pokemon.id`,
  mutating in place — **the guest derives NOTHING**. Any guest-side re-computation of structural
  state is dead architecture.
- **Rendezvous barriers** (`coop-rendezvous.ts`): two-sided pacing points with cross-point release
  + 60s anti-hang. Showdown sync points MUST use this primitive — do not invent another.
- **Interaction counters hardened**: every interaction pins `coopInteractionStart`; unpinned
  `advanceInteraction` is refused loudly. Never bump asymmetrically.
- **ui-mirror machinery** (#818/#815): watcher never runs an engine; bespoke screens mirror via
  the ui-mirror session machinery with live cursor mirroring. Showdown's wager/ready screens go
  through `coop-ui-registry.ts`.
- **New messages**: register kinds in `coop-transport.ts` AND seq bands in `coop-seq-registry.ts`
  per existing conventions. Unregistered surfaces fail the soak completeness backstop loudly.
- **DELETED**: netcodeMode, lockstep, pump-watcher (M3/M6 sweeps). Any reference = removed code.
- **Do not regress**: party-order transposition (host-faint replacement checkpoints), enemy
  switch-in absolute positioning, berry-counter pin, empty-enemy-party crossing skip.
- **Account writes**: default-deny gates (#806) — wager settlement must be server-verified,
  never client-asserted.
- Required reading: `docs/plans/2026-07-05-coop-full-state-phase-0-design.md`,
  `docs/plans/2026-07-06-coop-sync-gap-and-soak-coverage-audit.md`,
  `docs/plans/2026-07-05-coop-refactor-resume-and-pacing-barriers.md`, the duo-harness header.

**ADDENDUM — Showdown-specific deltas (maintainer):**
1. **The enemy-side command relay is NEW, not reuse.** Co-op relays guest commands for a
   player-side slot; the enemy side is AI. Showdown needs the host's EnemyCommandPhase (or
   equivalent) to await a relayed human command — that interception point does not exist yet.
   Small and clean to build (message shapes carry over), but it is BUILT, not found.
2. **The guest needs a perspective flip.** A pure renderer of the host's world would show the
   guest's own team on top as "enemies." Each player sees their team on the bottom — a
   render-mapping layer (presentation-only side swap). Co-op never needed it; nothing exists.
3. **Hidden information + host trust — accept explicitly.** The state stream sends the FULL
   opposing party (movesets/items/bench) to the other client, and the host runs the engine — a
   motivated host can cheat. Fine for friendlies; with permanent mon loss it must be a conscious,
   DOCUMENTED decision. Minimum bar: settlement server-verified via the #806 gates. Full
   server-refereed battles are a different project. State the trust model in the design doc.
4. **Do-NOT-drag-in list**: interaction alternation, merged-party/3-mon-cap rules, coopOwner
   tags, wave/shop/ME/biome machinery, inter-wave pacing barriers. Reusable core: transport +
   lobby/matchmaking + session roles; authoritative engine + state stream + checksum/resync;
   record→replay; ui-mirror (wager/ready screens); rendezvous primitive (ready-up). Showdown is
   a NEW SESSION KIND on those seams. Team select = each player picks freely from their own box.

**Hard rules**: deploy/PR only against feat/elite-redux-port; NEVER touch main/prod; solo and
co-op byte-identical when showdown is off; every sync behavior proven in the duo harness
(fails-before/passes-after); tsc zero-new (303); biome clean; in-game dev-suite scenario per
standing rule.

**Status after reset**: Phases A+B survived the rebase intact (15 commits, 96/96 tests, 0 new
tsc). v1 C1 commit dropped (built on deleted netcodeMode); v1 C2 draft salvaged to scratchpad.
The v1 Phase C below is SUPERSEDED as written — task GOALS remain valid (title entry, team
exchange, battle bootstrap, command relay, result/void, duo test); mechanisms follow the new
seams per this briefing + the architecture-map exploration.

## Trust model (Showdown 1v1) — explicit, deliberate (addendum #3)

Showdown is host-authoritative on the SAME co-op full-state stack. That buys a shared,
byte-identical battle for free, and it carries the co-op trust properties forward — stated
here so no one mistakes friendly-match trust for tournament-grade trust:

- **The host runs the engine → the host can cheat.** All battle resolution (RNG, damage,
  AI-vs-relayed commands, faints) happens on ONE client (the session host). A modified host
  can bias its own rolls. This is acceptable for FRIENDLY matches; it is NOT a
  server-refereed battle. Full server simulation is a different project (explicitly deferred).
- **Full opposing party is visible to the other client.** The authoritative state stream
  sends BOTH parties as complete `PokemonData[]` (movesets, items, bench, IVs) every turn —
  that is how the guest renders without deriving anything. So there is NO hidden information:
  a motivated client can read the opponent's full team/bench off the wire. Accepted; showdown
  is open-team by design (each player already exchanges a full manifest at C2 ready-up).
- **Cross-client team validation is FORMAT-only.** At C2 each client validates the OPPONENT's
  manifest against STRUCTURAL rules only (team size, level 100, one item, ≤1 mega, mega-item
  lock, IV bounds, duplicates) using an all-permissive `UnlockSnapshot` — a client cannot see
  the opponent's collection, so COLLECTION legality (root/shiny/ability/nature/move unlocks)
  is enforced by the opponent's OWN client at team-build (against its own unlocks) and, in
  Phase D, by the server. The `showdownReady{teamHash}` fnv1a64 commit is an anti-tamper
  cross-check (ready hash must equal the hash of the manifest actually sent), not a
  collection proof.
- **Settlement is server-verified (Phase D), never client-asserted.** Permanent mon
  gain/loss rides on the #806/#807 account-write gates + the escrow ledger: the server records
  the outcome and honest clients apply it; a hacked client can dodge its OWN local loss but the
  ledger records it and it can never TAKE an unlock that was not awarded. Until Phase D lands,
  matches are FRIENDLY (`matchId: null`, no stakes) — a permanent free-play mode.

Bottom line: friendlies are fun and fair-enough between cooperating players; stakes are only
as safe as the Phase-D server verification, and the battle engine itself remains host-trusted.

## Phase C (v1 — SUPERSEDED mechanisms; goals only; do not execute as written)

### Task C1: Title menu entry + showdown pairing

**Files:**
- Modify: `src/phases/title-phase.ts` (`showOptions` `:128`; new `openShowdownLobby` modeled on `openCoopLobby` `:251` — netcode pinned `"authoritative"`, launches `GameModes.SHOWDOWN`)
- Test: `test/tests/elite-redux/showdown/showdown-session.test.ts` — session-controller-level test over `createLoopbackPair()` (pattern: `coop-session-controller` tests), asserting role assignment + netcode pin; UI entry verified via render-harness title recipe if one exists, else note.

Reuse `CoopLobbyController` as-is (it's mode-agnostic HTTP matchmaking). The only showdown difference at this layer: after `onConnected(runtime)`, the flow goes to the ANTE LOBBY (D3) instead of straight to battle — for now (until D3), skip ante and proceed to teambuild so the mode is playable end-to-end without stakes ("friendly" path, which remains a permanent free-play option).

**Steps:** failing session test → implement → pass → tsc → checkpoint commit.

### Task C2: Manifest exchange + ready gate

**Files:**
- Create: `src/data/elite-redux/showdown/showdown-session.ts` — small controller owning: send my `showdownTeam`, await opponent's, validate BOTH (A3), exchange `showdownReady` with `teamHash` (FNV-1a via `fnv1a64` from `coop-battle-checksum.ts` over the canonical manifest JSON), resolve when both ready or reject on violation.
- Test: extend `test/tests/elite-redux/showdown/showdown-session.test.ts` — two controllers over a loopback pair; cases: legal/legal → both ready; illegal team → rejection surfaces on BOTH sides; hash mismatch → reject.

**Steps:** failing test → implement → pass → tsc → checkpoint commit.

### Task C3: Battle bootstrap — opponent team as enemy side, single battle

**Files:**
- Modify: `src/phases/encounter-phase.ts` (beside `adoptCoopHostEnemyParty` `:192` — add showdown branch: HOST builds enemy party from the opponent manifest via a new `buildShowdownEnemyParty`)
- Create: `src/data/elite-redux/showdown/showdown-enemy.ts` — `manifestToSerializedMon(m: ShowdownMonManifest): CoopSerializedPokemon` then `buildCoopEnemy(data, 100, slot)` per mon (reuses `coop-enemy-builder.ts:43` verbatim; megas arrive as permanent `formIndex`, no stone modifier needed at runtime — the item-slot cost was paid in teambuilding, per fork's permamega semantics)
- Modify: `src/game-mode.ts` — SHOWDOWN `isWaveFinal`/equivalent returns true for wave 1 (single battle; find the exact wave-progression predicate the COOP case uses at `:467-552` and mirror)
- Test: `test/tests/elite-redux/showdown/showdown-battle.test.ts` (ER_SCENARIO-gated, `GameManager`-driven): start a showdown battle with a 2-mon manifest each side; assert enemy party species/level/item match the manifest and battle reaches `CommandPhase`.

**Steps:** failing test → implement → pass → tsc → checkpoint commit.

### Task C4: Per-turn command relay (guest drives the enemy side)

**Files:**
- Create: `src/data/elite-redux/showdown/showdown-command-relay.ts` — class modeled 1:1 on `CoopBattleSync` (`coop-battle-sync.ts:77`): host sends `showdownCommandRequest {turn}`, awaits `showdownCommand {turn, command}` keyed by turn with an inbox race buffer; **timeout 60_000 ms** (design: turn timer) → fallback = engine AI move for that side (the existing `CoopBattleSync` AI-fallback path is the template).
- Modify: the host's enemy-command decision point — find where enemy commands are resolved for the authoritative co-op host (grep `requestPartnerCommand` call sites / `turn-start-phase` enemy AI hand-off) and branch: in showdown, enemy-side commands come from the relay instead of AI.
- Modify: guest side — in showdown the guest's `CommandPhase` runs normally for its own team but SHIPS the command (`showdownCommand`) instead of executing locally, then waits for the turn stream (exact pattern: co-op guest own-slot behavior, `broadcastCoopOwnSlotCommand` `coop-runtime.ts:622` + the authoritative-guest divert in `command-phase.ts` — grep `isCoopAuthoritativeGuest` there).
- Test: `test/tests/elite-redux/showdown/showdown-command-relay.test.ts` — engine-free relay unit tests over loopback (request/response, out-of-order buffering, timeout→null) mirroring `coop-interaction-relay.test.ts`; plus a duo-level test in C6.

**Steps:** failing relay unit test → implement relay → pass → wire into phases → tsc → checkpoint commit.

### Task C5: Result + checksum tripwire

**Files:**
- Create: `src/data/elite-redux/showdown/showdown-outcome.ts` — outcome detection (all 6 of one side fainted → `showdownResult`; received `showdownVoid` or local checksum-mismatch-give-up → void state) and a minimal result phase `src/phases/showdown-result-phase.ts` (message + return to title; pattern: `game-over-phase.ts` structure).
- Modify: `src/phases/coop-replay-phases.ts` `verifyChecksum` (`:751`) — in showdown mode, after the existing resync give-up cap (`COOP_RESYNC_RESUMMON_GIVE_UP = 2`, `:986`) is exhausted, emit `showdownVoid {reason:"checksum"}` (stakes safety per design: no payout rides on a diverged battle).
- Test: extend `showdown-battle.test.ts` — drive a battle to a KO sweep, assert `showdownResult` emitted with correct winner; unit-test the void path by faking the give-up counter.

**Steps:** failing tests → implement → pass → tsc → checkpoint commit.

### Task C6: Two-engine showdown test (duo harness)

**Files:**
- Modify: `test/tools/coop-duo-harness.ts` — add `buildShowdownDuo(...)` beside `buildDuo` (`:542`): both runtimes over one loopback pair, game mode SHOWDOWN, host enemy party from guest manifest, guest replay wiring.
- Test: `test/tests/elite-redux/showdown/showdown-duo.test.ts` (ER_SCENARIO-gated) — full loopback match: both engines, host plays a turn, guest command relayed, guest replays via `driveGuestReplayTurn` (`:644`), checksums converge, KO sweep → both sides observe the same `showdownResult`. **Restore `globalScene` in `afterEach`** (`initGlobalScene(prevScene)` — the citizenship rule).

This is the standing-rule gate for the whole sync layer: run the WHOLE `test/tests/elite-redux/showdown/` + `test/tests/elite-redux/coop/` dirs under `ER_SCENARIO=1` before calling Phase C done (co-op must stay green — we touched shared files).

**Steps:** write duo test (will fail/hang loudly) → fix until green → full coop+showdown dir run green → tsc → checkpoint commit.

---

### Task C-REBASE: move the stack onto feat/elite-redux-port (added 2026-07-06, CORRECTION)

DISCOVERY: `coop-me-authoritative` is stale — only 3 unique commits (ER version bump + 2
shiny-lab commits). ALL co-op work plus 233 newer commits live on `feat/elite-redux-port`,
including the complete **Ghost Trainer Editor** (main menu → Profile → ghost customization):
`src/data/elite-redux/er-ghost-profile.ts` (GhostTrainerProfile: displayName, title,
dialogue.intro / .defeatPlayer / .defeated), `src/data/elite-redux/er-trainer-fx.ts`
(entrance + aura trainer FX, achievement-point purchases),
`src/ui/handlers/{profile-ui-handler,ghost-trainer-editor-ui-handler}.ts`, snapshot
`presentation` field (uploaded via `runs.presentation`, sanitized on upload AND re-sanitized on
apply, applied to ghost trainers at battle setup ~er-ghost-teams.ts:1210).

After C1-C6 lands + reviews close: cherry-pick the showdown stack onto a detached HEAD at
`feat/elite-redux-port` tip (no branches, no pushes). Re-run ALL gates (showdown suite, coop
ER_SCENARIO regression, tsc baseline RE-MEASURED on the new base, render baselines re-verified).
Reconcile the 2 stray shiny-lab commits (check for equivalents on the new base first).

### Task C7: Opponent presentation in showdown — REUSE the Ghost Trainer profile (rewritten)

Runs AFTER the rebase, against the real system. NO new customization features — pure reuse:

- Wire: the player's `sanitizeGhostProfile(gameData.ghostProfile)` + per-mon `erShinyLab` looks
  cross the transport with the team exchange (additive field(s) on the showdown team/ready
  messages, mirroring the ghost snapshot's `presentation` + `GhostMember.erShinyLab` shapes).
- Receipt: ALWAYS re-run `sanitizeGhostProfile` on the received profile (same rule the ghost
  path enforces), then apply through the SAME code path ghost battles use for trainer
  presentation (intro line at battle start, entrance/aura trainer FX, name/title plate) and the
  Shiny Lab per-mon restore (`erShinyLab` + `erShinyLabSuppressLocal`).
- Result lines: winner sees the loser's `dialogue.defeated`; loser sees the winner's
  `dialogue.defeatPlayer` — fire them in the showdown result phase, mirroring ghost-battle
  victory/defeat line handling.
- Both clients render the opponent presentation (host side + guest replay side).
- Verification: render-harness/scenario per standing rules; a duo-level assertion that the
  profile survives the wire round-trip sanitized.

## Phase D — Escrow + settlement

### Task D1: Escrow domain logic (pure) + worker endpoints

**Files:**
- Create: `workers/er-save-api/src/showdown-escrow.ts` — PURE domain module (no `env`, no fetch): state machine `registerMatch`, `applyResultReport`, `resolveSettlement` over plain records; exported types `ShowdownMatchRow`, `SettlementDecision`.
- Modify: `workers/er-save-api/src/index.ts` — routes `POST /showdown/match`, `POST /showdown/result`, `GET /showdown/pending` (authed via existing `authUser` `:268`); D1 writes via `env.DB.batch` (pattern `:749`); stake-hold claim via conditional `UPDATE ... WHERE hold IS NULL` + `meta.changes` check (pattern: `er-coop-api handleLobbyPick` `:413`); idempotent match insert via `ON CONFLICT(id) DO NOTHING` (pattern `:879`).
- Modify: `workers/er-save-api/schema.sql` — tables `showdown_matches (id PK, host_uid, guest_uid, host_stake_json, guest_stake_json, state, host_report, guest_report, created_at, resolved_at)` + `showdown_settlements (id, match_id, uid, mutation_json, applied_at NULL)`; runtime `ensureShowdownTables` following `ensureNotificationsTable` (`:935`).
- Test: `test/tests/elite-redux/showdown/showdown-escrow.test.ts` — **plain vitest importing the PURE module by relative path** (this is the new worker-test pattern; `vitest.config.ts` include `./test/**` already covers the test file; the module itself has zero CF dependencies so it imports cleanly). Cases: register → held; second register with same stake → rejected; two agreeing reports → settle (loser mutation = clear unlock, winner mutation = grant-or-candy); conflicting reports → void + holds released; single report + timeout → per design (void pre-battle, forfeit-win if battle-phase-entered flag set); double-settle idempotent.

Settlement decisions produce **mutation records** (`{kind:"removeUnlock"|"grantUnlock"|"grantCandy", speciesId, dexAttrBits?, candy?}`) — the server stores them in `showdown_settlements`; clients fetch-and-apply (D2). Server never edits saves (opaque blobs).

**Steps:** failing pure tests → implement pure module → pass → wire routes (manual smoke via `wrangler dev` is optional and NOT required for done) → tsc → checkpoint commit.

### Task D2: Client settlement application

**Files:**
- Create: `src/data/elite-redux/showdown/showdown-settlement.ts` — `applySettlementMutations(mutations, gameData)`: `removeUnlock` clears the specific `DexAttr` bits from `dexEntry.caughtAttr` (shiny stake: clear `SHINY|VARIANT_*` bits per staked variant; species stake: clear `caughtAttr` entirely + zero `candyCount` — mirror `er-redux-dex-redirect.ts:146` transfer idiom); `grantUnlock` ORs bits + seeds `createStarterDataEntry` if missing; `grantCandy` via `addStarterCandy` (`game-data.ts:2615`). Then trigger save upload.
- Modify: login/save-load path — after save load, `GET /showdown/pending` and apply (find the post-load hook in `game-data.ts` load flow; the devtest progress fetch in `dev-tools/test-suite/index.ts` shows the `VITE_SERVER_URL` fetch pattern).
- Test: `test/tests/elite-redux/showdown/showdown-settlement.test.ts` — stub `gameData` with real `dexData`/`starterData` shapes; assert exact bit surgery for: shiny variant-2 stake lost (bits cleared, base unlock kept), species stake lost (entry cleared), win grant on unowned (bits set), win grant on owned (candy path).

**Steps:** failing tests → implement → pass → tsc → checkpoint commit.

### Task D3: Wager screen with full team preview (UPDATED 2026-07-06, maintainer)

**FLOW REORDER (maintainer requirement):** the ante is bet with full knowledge of the matchup.
New order: pair → teambuild → team exchange (C2) → **WAGER SCREEN** → stake lock →
`/showdown/match` escrow → battle. (The old pairing→ante→teambuild order is dead: you must
see what you're up against before betting.) "Friendly (no stakes)" remains always offered.

**The screen (single screen, both players, polished within the game's pixel-UI idiom):**
- **Team preview, both sides**: your 6 and the opponent's 6 on one screen — species icons
  (the same icon pipeline the party/starter UIs use), with shiny/variant tint, held-item
  mini-icon, and mega indicator per mon. Opponent name + title from their ghost profile (C7).
- **Stake area**: your stake picker (owned shinies / high-cost unlocks, tier shown) + the
  opponent's offered stake with tier; a tier-match indicator (match = lockable, mismatch =
  which side is over/under); lock-in status lamps for both players.
- Both-locked → rendezvous point (`showdown-wager-commit`) → escrow POST → battle.
- **ui-mirror rules apply**: classify the new UiMode in `coop-ui-registry.ts`; the screen is
  driven by local choice + wire-synced offer state (showdownStakeOffer/StakeLock), NOT a
  mirrored cursor session (each player interacts with their own copy; only offers/locks sync).
- **UI quality bar (maintainer: "make the ui nice")**: composed layout, no text collisions at
  the game's x6 scale, readable tier/stake labels, consistent with existing panel chrome.
  Render-harness `PAGE_RECIPES` entry `showdown-wager` with step-drives (pick stake → offer
  shown → both lock) is MANDATORY; eyeball the PNGs; commit baselines.

**Files:**
- Create: `src/ui/handlers/showdown-wager-ui-handler.ts` + UiMode registration + ui-registry
  classification.
- Modify: title-phase showdown flow (the `// D3 ante lobby inserts here` seam moves to
  post-teambuild per the reorder) + showdown-session.ts (wager step after ready, before battle).
- Test: render-harness recipe + step-drive; stake tier-match logic already covered (A1);
  offer/lock wire round-trip test over loopback.

**Steps:** render-drive failing → implement → render pass + baseline → tsc → checkpoint commit.

### Task D4: Disconnect / forfeit / void rules

**Files:**
- Create: `src/data/elite-redux/showdown/showdown-lifecycle.ts` — wraps `CoopLifecycle` (grace window is already 120_000 ms — exactly the design value): tracks `battleTurn`; on `abandoned`: turn < 3 → local void (`showdownVoid {reason:"earlyDisconnect"}` best-effort + report void to server), turn ≥ 3 → survivor reports `showdownResult {reason:"timeout"}` (server accepts lone report only after its own silence timer, per D1 rules).
- Modify: pause/forfeit menu — add "Forfeit" in showdown (grep the in-battle menu options handler); sends `showdownResult {reason:"forfeit"}` + reports loss.
- Test: `test/tests/elite-redux/showdown/showdown-lifecycle.test.ts` — pure, time-injected like `coop-lifecycle` tests: disconnect at turn 2 → void; at turn 5 → forfeit-win path; reconnect within grace → resume (resync path already exists via `stateSync`).

**Steps:** failing tests → implement → pass → tsc → checkpoint commit.

---

### Task B6: Teambuilder pick restrictions (added 2026-07-06, maintainer)

Field-legality rules (STAKES UNAFFECTED — black shinies remain the top stake tier):
- **Black shinies cannot be fielded** (`erBlackShiny` mons excluded from team selection).
- **Base cost 10 and above: banned entirely.**
- **At most ONE mon of base cost 8-9 per team**; all others must be cost ≤ 7.
- Cost = `speciesStarterCosts` base value of the LINE (same value the teambuilder shows).

Enforcement in BOTH layers:
1. `validateShowdownTeam` — new rules `blackShiny`, `costCap`, `highCostLimit` (manifest gains
   whatever fields the checks need, e.g. `erBlackShiny: boolean`, `baseCost: number`; wire
   mirror updated; opponent manifests re-checked, so a hacked client can't field a banned mon).
2. Starter-select pick-time UX — attempting to add a banned/over-limit mon is REJECTED with a
   clear message (reuse the cost-cap rejection toast pattern): "Black Shinies can't enter
   Showdown", "Cost-10 Pokémon can't enter Showdown", "Only one Pokémon of cost 8+ allowed".
   Grid grey-out for banned mons in showdown mode where the existing affordability grey-out
   supports it cheaply.

### Task D5: Battle telemetry (added 2026-07-06, maintainer — "record everything")

Purpose: balance analytics — what wins, what loses, item/move/species performance.

**Storage decision (maintainer-approved):** a NEW dedicated D1 database (e.g. `er-telemetry`)
— NOT er-saves (which is at ~402MB of its 500MB free-tier per-DB cap; that pressure is a
separate ops issue flagged to the maintainer). Free-tier envelope: 500MB/DB, 5GB/account,
100k row-writes/day — comfortably ~100k+ battles of runway at the sizes below.

**What is recorded per match (host-side, at result/void time):**
1. **Full replayable trace** (the cheap "everything"): both manifests + seed + ordered per-turn
   commands + outcome — the existing `ReplayTrace` shape; battles are deterministic, so EVERY
   future statistic is derivable offline by replaying. Gzip (reuse the `GZ1:` compressSave
   pattern) → ~2-5KB per match, stored as a blob column.
2. **Denormalized summary row** for direct SQL: matchId?, both usernames (or uids), winner,
   reason (victory/forfeit/timeout/void+why), turn count, duration, per-side species/form/item
   sixes, per-mon KOs dealt/received, damage dealt totals, switches, relay timeouts, checksum
   resyncs, client versions.
3. **Aggregate upserts** (optional v1.5): per-species and per-item usage/win counters for
   zero-replay dashboards.

**Pieces:** `showdown_battles` + `showdown_battle_stats` schema in a new `workers/er-telemetry`
worker (or a new DB binding on er-save-api — decide by deploy simplicity, document); ingestion
endpoint POST /telemetry/battle (authed, size-capped, rate-limited per account); client
recorder riding the host's authoritative engine (begin at battle start, seal at result/void);
pure-module tests + worker-logic tests per the D1 escrow test pattern.

## Completion gate (before calling the feature done)

1. `npx tsc --noEmit` → exactly 285 errors (branch baseline).
2. Full ungated suite: `npx vitest run test/tests/elite-redux/showdown/`.
3. `ER_SCENARIO=1` full `coop/` + `showdown/` dirs green (globalScene citizenship).
4. Render-harness: `starter-select`, `starter-select-showdown`, `showdown-ante` baselines committed and diff-clean.
5. Duo showdown match test green (C6).
6. Design doc updated with any decisions that changed during implementation (notably: settlement is ledger + client-applied, not server-side save surgery).

## Explicitly deferred (do NOT build)

- Cost ceiling; dual-lockstep/server sim; rankings/matchmaking; multi-item stakes; spectating; `wrangler` deploy of the new endpoints (maintainer does deploys — the code ships, activation is a maintainer step, same as the devtest routes precedent).
