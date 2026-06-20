# ER Move Audit Spec — port vs the 2.65 dex

**Goal:** verify every move (vanilla + ER-custom) as it behaves *in the running game*
matches the authoritative ER 2.65 dex. This is the move analogue of the ability
audit. Hand this whole doc to the auditing agent.

## 0. Authoritative source & golden rules

- **Source of truth:** `vendor/elite-redux/v2.65beta.json` → its `moves` array. When
  the port disagrees with the dex, the dex wins and the port is the bug.
- **`lDesc` beats `flags`.** A move's long-description text is authoritative over its
  parsed `flags` array when they disagree (the #449 rule: a move whose `lDesc` says
  "Keen Edge boost" IS a slicing move even if `flags` is empty). Always read `lDesc`.
- **Index the dex by the `id` FIELD, never by array position.** (This is the exact
  trap that produced a wrong mega-ability "fix" — array position ≠ id.) For moves the
  drift is small but real: **3 moves have `id != arrayPosition` (ids 1006, 1007,
  1008)** — still, always key off `m["id"]`.
- **The static transcription is already verified faithful.** `er-moves.ts` (`ER_MOVES`)
  matches the dex with **0 mismatches** on power/accuracy/pp/priority across all 1032
  moves (checked 2026-06-20). So `er-moves.ts` is NOT the audit target — the targets
  are the **runtime** (`allMoves`) and the **effects/behavior** (`attrs`).

## 1. Data model — the five layers

| Layer | Where | What it is |
|---|---|---|
| **Dex** | `vendor/elite-redux/v2.65beta.json` `.moves[]` | truth: `id,name,NAME,pwr,acc,pp,types[],split,prio,target,chance,eff,flags[],arg,desc,lDesc` |
| **ER_MOVES** | `src/data/elite-redux/er-moves.ts` | port's transcription of the dex (id-keyed). Verified faithful on numerics. |
| **id bridge** | `src/data/elite-redux/er-id-map.ts` → `ER_ID_MAP.moves` | dex move id → pokerogue `MoveId` (1032 entries, mostly identity). |
| **Runtime move** | `allMoves[MoveId]` (built in `src/data/moves/move.ts`) | what the game actually uses: `power, accuracy, pp, priority, chance, moveTarget`, `get type/category`, private `flags`+`hasFlag()`, and **`attrs`** (the coded behavior). |
| **ER wiring** | `init-elite-redux-vanilla-move-patches.ts` (patches vanilla moves from `ER_MOVES` + adds attrs), `init-elite-redux-custom-moves.ts` (builds ER-new moves), `er-move-archetypes.ts` (custom-move id → effect primitive, `"bespoke"` = hand-wired), `er-move-details.ts` | the code that makes the runtime match (or not) the dex |

**Flow:** dex → `er-moves.ts` (faithful copy) → the two init files read `ER_MOVES` and
(a) set the runtime move's numeric fields/flags and (b) attach `attrs` for the effect.
A bug is a place where step (b) — or a missed numeric/flag patch — diverges from the dex.

## 2. The two-phase method

### Phase A — automated NUMERIC + FLAG diff (catches mis/un-patched fields)
Run the runtime against the dex by `id`. `er-moves.ts` is faithful, so any runtime
mismatch here is a **patch bug** (a move ER changed but the patch missed, or a flag not
set). Use the starter script `scripts/elite-redux/audit-moves.mjs` pattern (see §5),
or a vitest probe that imports `allMoves` and compares each `ER_ID_MAP.moves[dexId]`:

For every dex move, compare:
- `power` == `pwr`
- `accuracy` == `acc`
- `pp` == `pp`
- `priority` == `prio`
- `type` == `mapErType(types[0])` (see decoder §3); second type rare for moves
- `category` == `splitT[split]` mapped (see decoder §3)
- `chance` == `chance`
- `moveTarget` == `targetT[target]` mapped (see decoder §3)
- for each dex flag in `flags[]`: the runtime `hasFlag(map(flag))` is true (see §3)

Output a table of every field-level mismatch → these are concrete bugs to fix first.

### Phase B — semantic EFFECT audit (the hard part, like bespoke abilities)
For each move, confirm the runtime **`attrs`** actually implement the dex `eff` (effect
id, decode via `effT`, 413 effects) AND the `lDesc`. This needs per-move judgment.
**Prioritize, do NOT brute-force all 1032 equally:**
1. **ER-custom moves** (id resolves to a pokerogue id ≥ the custom floor / has an
   `er-move-archetypes.ts` entry) — these are new behavior, highest risk.
2. **Moves ER changed from vanilla** — diff `lDesc` (or `eff`) against the vanilla
   pokerogue move's known behavior; where ER's `lDesc` differs, the port must match ER.
   `init-elite-redux-vanilla-move-patches.ts` is the list of moves ER deliberately
   touched — every move patched there must be verified; every move that SHOULD be
   patched (dex `eff`/`lDesc` differs from vanilla) but ISN'T is a gap.
3. **Anything Phase A flagged.**
4. **`"bespoke"` archetype moves** in `er-move-archetypes.ts` — hand-wired, verify each.

For each, the verdict is: does the coded `attrs` set reproduce the dex `eff`+`lDesc`
effect (power mods, secondary effects + `chance`, stat changes, targeting, recoil,
multi-hit, priority gates, type/category special cases)? If not → bug, with the dex text.

## 3. Decoder tables (dex numeric → port concept)

All decoder arrays live in the dex itself (index = id):
- **`split` → category** via `splitT` = `['PHYSICAL','SPECIAL','STATUS','USE_HIGHEST_OFFENSE','HITS_DEF','USE_HIGHEST_DAMAGE','HITS_SPDEF']`.
  - 0/1/2 map directly to pokerogue `MoveCategory.PHYSICAL/SPECIAL/STATUS`.
  - **3-6 are ER-special** (e.g. `USE_HIGHEST_OFFENSE` = Photon Geyser-style). The port
    represents these as a base category **plus an attr** (e.g. `PhotonGeyserCategoryAttr`).
    Audit: the runtime category + the special attr together must reproduce the split.
- **`types[i]` → `PokemonType`** via dex `typeT` (ER order: Normal,Fighting,Fire,Ice,
  Electric,Bug,Flying,Steel,Grass,Ground,Poison,Dark,Water,Psychic,Rock,Dragon,Ghost,
  Fairy,Mystery(18→none),None(19→none),Stellar(20)). The port's mapping is
  `ER_TYPE_TO_POKEROGUE` (in `init-elite-redux-species.ts`) / `mapErType`. Use it — the
  pokerogue `PokemonType` enum order is DIFFERENT from ER's.
- **`flags[i]` → `MoveFlags`** via dex `flagsT` (18 flags: Makes Contact, High Crit Rate,
  Air/Wing Based, Dance Move, Always Crits, Field Based, Hammer Based, Kick Based,
  Causes Recoil, Horn Based, Drill Based, Sound Based, Bullet Move, Weather Based, Throw
  Based, Bone Based, Lunar Move, Arrow Based). Map each to `src/enums/move-flags.ts`.
  **Some ER flags have no vanilla `MoveFlags` equivalent** (e.g. Kick/Hammer/Drill/Horn
  "based" categories) — those are implemented as ER abilities/attrs or move-flag
  injection (see `er-ability-archetypes` + `archetypes/move-flag-injection.ts`), not a
  raw flag. For those, audit that the *behavior* exists, not a literal flag bit.
- **`target` → `MoveTarget`** via dex `targetT` = `['SELECTED','BOTH','USER','RANDOM',
  'FOES_AND_ALLY','DEPENDS','ALL_BATTLERS','OPPONENTS_FIELD','ALLY','USER_OR_ALLY',...]`.
  Map to the pokerogue `MoveTarget` enum.
- **`eff` → effect** via dex `effT` (413 entries: Hit, Multi Hit, Pay Day, Burn Hit,
  Paralyze Hit, Bleed Hit, Attack Up 2, ...). This is the move's mechanical effect; the
  port implements it via `attrs`. Phase B maps `eff`+`lDesc` → expected attrs.

## 4. Pitfalls (read before starting)

1. **Index dex by `id`, not position** (ids 1006-1008 drift). Verify `ER_ID_MAP.moves[id]`
   resolves to the intended `MoveId`; cross-check the runtime move's `name`.
2. **`lDesc` is authoritative over `flags`** — never conclude a move lacks an effect just
   because a flag bit is missing; read the text.
3. **ER-special splits (3-6)** need a base category + attr, not a 1:1 category.
4. **ER-only flags** (Kick/Hammer/Drill/Horn/Bone/Lunar/Arrow Based) are behavior, often
   via abilities (e.g. Festivities/Backstreet Boy re-tag) or attrs — not raw `MoveFlags`.
   Don't false-flag these as "missing".
5. **`chance`** is the secondary-effect %, audit it alongside the effect attr.
6. **Custom-move wiring** lives in `er-move-archetypes.ts` (`"bespoke"` = hand-written,
   highest scrutiny) — mirror how the ability audit treated bespoke abilities.
7. **`er-moves.ts` is faithful** — if a numeric mismatch shows in the RUNTIME, the bug is
   in the patch/custom-move init, not the data.

## 5. Output format

Produce a triage table, one row per finding:

`moveId | dex name | dimension (power/acc/pp/type/category/priority/target/chance/flags/effect) | dex value (+lDesc snippet) | port value | severity | fix location`

Severity: P0 = wrong effect/power/type (gameplay-breaking), P1 = wrong secondary/chance/
flag, P2 = cosmetic/text. Fix locations: numeric/flag → `init-elite-redux-vanilla-move-
patches.ts` (vanilla) or `init-elite-redux-custom-moves.ts` (custom); effect/attrs →
those + `er-move-archetypes.ts` / the relevant attr class.

## 5b. Numeric fidelity is CLEAN — and the test-harness trap that hides it

Numerics (power/accuracy/pp/priority/chance) are **already correct in-game**:
`initEliteReduxVanillaRebalance()` (`init-elite-redux-vanilla-rebalance.ts:1322+`,
`target.power/accuracy/pp = draft.X`) applies ER's stats from the dex-faithful
`ER_MOVES`. Verified 2026-06-20: after the full rebalance runs, **0 power / 0
accuracy / 0 priority / 0 chance diffs** vs the dex across all 1031 moves (the
only flag is Airborne Slam `pp=0`, a dex data-hole placeholder).

🔴 **HARNESS TRAP (do not repeat my mistake):** the test harness **re-initializes
`allMoves` to VANILLA after the ER patches run in global setup**. So a naive
`allMoves[id]` read in a probe shows *unpatched vanilla* stats and produces ~280
FALSE mismatches (Fire Punch reads 75, not its real in-game 85). To measure the
real game state you MUST re-run the rebalance first:
`initEliteReduxVanillaRebalance()` then compare — see `er-move-audit.test.ts`.
(`allSpecies` does NOT get re-initialized this way; `allMoves` does — a quirk of
the harness, not the game.) Net: **the numeric phase is DONE/clean; spend the
audit on Phase B (effects/behavior).**

## 7. Runnable Phase-A tool

`test/tests/elite-redux/er-move-audit.test.ts` (committed, `ER_SCENARIO=1`-gated) runs
the runtime-vs-dex numeric diff with the `-1↔0` normalization and logs the report. Run:
`ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-move-audit.test.ts`. Extend it
with the type/category/flags/target decoders (§3) for the full mechanical pass.

## 6. Standing rule

Every fix that is observable in-game gets a dev test-suite scenario in
`src/dev-tools/test-suite/scenarios.ts` (combat-observable) or a `(note)` entry +
a vitest under `test/tests/elite-redux/` (see CLAUDE.md).
