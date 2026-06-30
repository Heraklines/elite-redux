# Multi-format battles (triples now, future-proof for N-per-side / >2 sides / parallel)

Status: IN PROGRESS. Owner: triple-battles effort.
Branch: `feat/elite-redux-port` (the normal working branch — NO separate branch).
Base commit before any triple work: `ee43a6c65` (`feat(fusion-lab): 4 new fusion strategies…`).

## Goal

Add **triple battles** with **mainline positional adjacency** (in a line of 3, the
center reaches all foes; a wing reaches the directly-opposed foe + the center, NOT
the far diagonal). Build it so the foundation **generalizes** to 4v4, battle royale
(>2 sides), and "parallel battles" later — NOT a one-off triple hack.

Scope for this effort: **wild AND trainer triples**, fully verified **headlessly**
(combat scenario runner + vitest GameManager). Co-op triples are GATED OFF initially
(co-op's slot model is binary; see Phase 6).

## Reversibility + gating (the user's hard requirement)

- All work lands on `feat/elite-redux-port` as **discrete, revertible commits**.
- Everything sits behind a **feature flag**. When the flag is OFF, battle format is
  resolved only to `single`/`double` and is **byte-identical to today**. Production
  builds keep the flag off → players never see triples until we say so.
- The flag lives at the SINGLE format-resolution point (`resolveBattleFormat`, the
  replacement for `checkIsDouble` in `battle-scene.ts:1950`), plus an
  `Overrides.BATTLE_FORMAT_OVERRIDE` for headless scenarios/dev.
- Downstream code is ALWAYS format-driven (so doubles exercise the new code paths and
  the existing test suite covers them), but the resolver can only PRODUCE a >2-wide
  format when the flag is on.
- **Revert recipe:** `git revert` the triple commits (they are self-contained), or
  simply leave the flag off. Nothing else depends on these changes. Base = `ee43a6c65`.

### Commit trail (newest last; `git revert` in reverse to undo)
1. `2f374bb91` foundation: battle-format arrangement model + 13 unit tests (no wiring).
2. `6fa6405bc` Battle.double backed by the format arrangement; field accessors +
   getBattlerIndex route through it (binary byte-identical).
3. `bd253960b` Pokemon.getAllies(); getAlly() = getAllies()[0] (binary byte-identical).
   (further commits appended as phases land)

## Chosen data model (from the architecture consult)

Keep the **flat integer `BattlerIndex` as the canonical wire/save/`turnCommands`/`targets`
key** (zero churn to keying). A `BattleFormat` owns the per-side layout + adjacency; a
`BattleArrangement` registry maps flat-index ↔ `{side, position}`. Legacy `single`/`double`
formats are AUTHORED to reproduce today's exact numbers (enemy base index stays 2), so every
binary battle is byte-identical and the migration is a behavior-preserving refactor.

```ts
interface BattlerId { side: number; position: number }
const enum SideKind { PLAYER, ENEMY, ALLY_TRAINER, OTHER }

interface BattleSideSpec { kind: SideKind; capacity: number; baseIndex: number; team?: number }
interface BattleFormat {
  id: "single" | "double" | "triple" | string;
  sides: BattleSideSpec[];          // ordered; array index = side number
  localPlayerSide: number;          // 0
  adjacency: AdjacencyMatrix;       // reachability over flat indices
}
interface AdjacencyMatrix { reaches(a: BattlerId, b: BattlerId): boolean }

interface BattleArrangement {
  format: BattleFormat;
  sideOffset(side: number): number;          // AUTHORED per format (single/double pin enemy=2)
  indexOf(id: BattlerId): BattlerIndex;       // sideOffset(side) + position
  locate(index: BattlerIndex): BattlerId;     // inverse
  ownerOf(index: BattlerIndex): SideKind;
  areAllies(a: BattlerIndex, b: BattlerIndex): boolean;  // same side (or same team for royale)
  isAdjacent(a: BattlerId, b: BattlerId): boolean;
  capacityOf(side: number): number;
  activeIndices(): BattlerIndex[];            // for incrementTurn / turnCommands keys
}
```

- `Battle.double` and `getBattlerCount()` become DERIVED getters off the format
  (`double` = local side capacity===2; `getBattlerCount()` = local side capacity).
  The 16 `getBattlerCount()` callers stay untouched. AUDIT them for player-vs-enemy
  width asymmetry (symmetric in binary; matters for "1 vs horde" later).
- `getMoveTargets` builds `opponents`+allies as today, then **filters the NEAR_* cases
  by `arrangement.isAdjacent`**, leaves non-NEAR (ALL_ENEMIES etc.) unfiltered. In binary,
  `isAdjacent` is true for every pair → byte-identical.
- `getAlly()` (single) → `getAllies(): Pokemon[]` (a triple center has TWO allies);
  `getAlly()` kept as `getAllies()[0]` shim during migration.

## The real landmines (grep-audit by hand — binary tests CANNOT catch these)

"2 per side" is encoded as `x % 2`, not as `BattlerIndex`. Ranked by danger:
- `src/phases/pokemon-phase.ts:34` `this.fieldIndex = battlerIndex % 2` — base class for most
  combat phases. Enemy triple indices 3/4/5 → `%2` = 1/0/1 (WRONG). Most dangerous line.
- `src/phases/turn-start-phase.ts:224` `targets[0] % 2` → AttemptCapturePhase enemy field index.
- `src/phases/show-ability-phase.ts:65,68` `% 2` for lastPlayer/lastEnemyInvolved (single int,
  can't track which of 3 — see `battle.ts:88-90`, already "abhorrently janky").
- Trainer-slot `% 2`: `switch-summon-phase.ts:57,100,336`, `summon-phase.ts:103`,
  `pokemon-data.ts:190`, `trainer.ts:461,511`. `TrainerSlot` (NONE/TRAINER/TRAINER_PARTNER)
  has NO third seat — 3-wide trainer side needs a real seat model.
- UI cursor `% 2`: `target-select-ui-handler.ts:122,127` (where true triple adjacency must
  surface to the human), `battle-info.ts:200`, `command-ui-handler.ts:346`, `battle-flyout.ts:91`.
- Field plumbing literals: `battle-scene.ts:1011-1015` getField `new Array(4)`+`splice(2,…)`;
  `965-997` `?2:1`; `battle.ts:198` incrementTurn keys off the fixed enum (needs activeIndices()).
- Offset arithmetic: `turn-init-phase.ts:102` `i - ENEMY`, `enemy-command-phase.ts:51,114,133`
  `fieldIndex + ENEMY`, `attempt-capture-phase.ts:44`, `coop-battle-engine.ts:345`.
- `getAlly()` single-ally — 53 occurrences / 15 files (Commander, redirection, Symbiosis/Instruct,
  AI spread penalty, Revival Blessing, faint redirect, Helping Hand, NEAR_ALLY).

## Blind spots (verify in the test matrix)

- `ArenaTagSide` is PLAYER/ENEMY/BOTH only — FINE for triples (still 2 sides), HARD BLOCKER for
  royale (Reflect/Screens/Tailwind/Safeguard + hazards can't name a 3rd side). Weather/terrain/Trick
  Room are field-wide and safe. Verify hazard application loops per summoning mon (3× in a 3-wide summon).
- EXP/money split: confirm denominators use live participant count, not implicit /2
  (`victory-phase`, `exp-phase`, `party-exp-phase`). Money scatter is amount-based (safe).
- Damage spread 0.75x gated on `targets.length>1` → 3 still qualifies (safe); verify nothing gates ===2.
- i18n: grep `src/locales/**` for "both"/"two"/"twin"/two-trainer double-battle strings; `getOpponentDescriptor`.
- Co-op RNG order: any new per-battler RNG draw MUST iterate `arrangement.activeIndices()` in canonical
  order on both clients (prior unseeded-order desyncs exist).
- Held items keyed by pokemonId (safe); only the modifier BAR is 2-sided (cosmetic, gateable).

## Phase plan (each phase independently green via headless runners)

- **P0 — Registry refactor, ZERO behavior change.** Add `BattleArrangement`+helpers reproducing
  binary numbers exactly. Replace every `%2`-as-fieldindex, `ENEMY±x` offset, getField splice,
  trainer-slot `%2`; add `getAllies()` (+ `getAlly()` shim). Verify: full vitest + scenario suite
  byte-identical. (LARGE, low behavior risk — do first and big.) → task #223
- **P1 — `BattleFormat` object; `double`/`getBattlerCount`/`checkIsDouble`/field accessors route
  through it, still only emit single/double.** Split the 16 callers into player/enemy width where
  asymmetric. → task #223
- **P2 — Adjacency in `getMoveTargets` + target-select picker.** Binary=all-adjacent → identical.
  Land `getAllies()` BEFORE this. → task #224
- **P3 — N>2 field plumbing behind the flag** (off in prod): capacity-driven field accessors,
  incrementTurn off activeIndices(), summon/switch loops, generic FieldPosition→offset. → task #224
- **P4 — Vertical slice (model proof):** flag-on triple WILD battle in run-scenario.mjs — 3 enemies
  summon, center can target all 3, a wing CANNOT target the far diagonal, spread hits adjacent, full
  turn resolves no soft-lock. → task #224
- **P5 — trainer triples + save forward-compat.** Real 3rd trainer seat; optional
  `battleFormat?`/`activePlayerCount?`/`activeEnemyCount?` on SessionSaveData (absent→derive as today).
  → tasks #225
- **P6+ (deferred):** UI/camera/HP-bar polish (#226); `ArenaTagSide`→N (royale blocker); co-op
  (COOP_SEQ_STRIDE + protocol-version handshake; seat→role map). Triples need none of these.
- **P5/test — comprehensive headless matrix + blind-spot sweep.** → task #227

## Headless verification anchors

- Regression: existing doubles tests (`test/tests/elite-redux/er-doubles-*.test.ts`) + the
  combat-scenario suite must stay green at EVERY commit with the flag off.
- New: triple wild + trainer scenarios (spread 0.75, single-target adjacency, ally-target moves,
  redirection/Follow Me, Counter/Mirror Coat, faint+switch refill, win/lose), dev-suite scenario(s),
  vitest regressions. All gated behind the flag.
