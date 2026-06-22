# Headless scenario runner — follow-up gaps (for the runner author)

The headless runner (`scripts/run-scenario.mjs` → `test/tools/run-scenario.test.ts`,
`ScenarioSpec` in `src/dev-tools/test-suite/scenario-spec.ts`) already works and is
great. This lists what's still **missing to test the ER bug-fix backlog headlessly**.
Each gap is grounded in a real scenario we currently CANNOT reproduce in the runner,
so they double as acceptance tests.

## What the spec already supports (no action needed)
species/formIndex/abilitySlot(0–2)/nature/moves/shiny/variant/female; `run`
wave/biome/weather/level/money/**double**/seed/difficulty/challenges; enemy
wild/trainer/**custom party**; `items.held`→STARTING_HELD_ITEMS,
`items.modifiers`→STARTING_MODIFIER (so MEGA_BRACELET already works), `items.shop`;
`start` player/enemy stat-stages + HP% + status. Good coverage.

---

## P0 — blockers (most ER ability/item tests need these)

### 1. Arbitrary ability override (player + enemy), incl. ER ability ids
`abilitySlot` only picks slot 0/1/2 of the mon's **natural** abilities. Almost every ER
ability scenario forces an ability the species does NOT naturally have, via
`Overrides.ABILITY_OVERRIDE = erAbility(ErAbilityId.X)` where the id is an ER ability id
(often ≥5000) cast into `AbilityId`. The runner has no way to express this, so we can't
test High Tide (on Greninja), Liquid Voice (Exploud), Corrosion (Roselia), Retribution
Blow (Snorlax), Decorate's boost side, Locust Swarm (Wispywaspy), Frisk, etc.

- Add to `SpecMon`: `ability?: number` (raw numeric — must accept ER ids ≥5000, do NOT
  validate against the `AbilityId` enum).
- Wire in `buildDevScenario`: player mon[0].ability → `O.ABILITY_OVERRIDE`; wild enemy
  `.ability` → `O.ENEMY_ABILITY_OVERRIDE`. When set, it wins over `abilitySlot`.
- Also add `passiveAbility?: number` → `O.PASSIVE_ABILITY_OVERRIDE` /
  `O.ENEMY_PASSIVE_ABILITY_OVERRIDE`, and a `hasPassive?: boolean` →
  `O.HAS_PASSIVE_ABILITY_OVERRIDE` / `O.ENEMY_HAS_PASSIVE_ABILITY_OVERRIDE` (for innate
  tests like Deadeye, where the relevant ability lives in an innate slot).
- Note: `ABILITY_OVERRIDE` is global, so in doubles it hits both player mons — fine for
  our scenarios, but call it out in the field doc.

### 2. Enemy held items
`SpecEnemyMon` has no held-items field; `buildDevScenario` resets
`O.ENEMY_HELD_ITEMS_OVERRIDE = []` and never sets it. We can't test Frisk (enemy needs
Leftovers + a Sitrus Berry), Knock Off, Trick, Magician, Unburden, etc.

- Add to `SpecEnemyMon`: `heldItems?: SpecItemRow[]`.
- Wire: wild → `O.ENEMY_HELD_ITEMS_OVERRIDE = toModifierOverrides(w.heldItems)`; same for
  each `kind:"party"` member if the enemy-party path supports per-mon held items.
- `SpecItemRow` already carries `{name, count?, type?}`, which is exactly the
  `ENEMY_HELD_ITEMS_OVERRIDE` shape (e.g. `{name:"BERRY", type: BerryType.SITRUS}`).

---

## P1 — needed for interaction + automated assertions

### 3. Per-turn move + target script (player), and forced enemy moves
`--move` forces ONE move every turn for the player, with no target choice. Multi-turn /
positional interactions can't be expressed: "turn 1 Throat Chop enemy-A, turn 2 watch the
cancel", "Water Pulse ONE foe in doubles then watch the spread Surf", "Decorate your
OWN ally to prove it's now blocked".

- Add a per-turn script (spec field `script?: TurnAction[]` or a runner arg), where
  `TurnAction = { move?: number; target?: "enemy1"|"enemy2"|"ally"|"self"|number }`.
  `target` resolves to a `BattlerIndex`; omitted → engine default. Fall back to the first
  usable move when no action for a turn.
- Optional `enemyScript` (force the enemy's move each turn). `ENEMY_MOVESET_OVERRIDE` with
  a single move is already deterministic, so this is lower priority.

### 4. Structured event log + optional `expect` assertions  ← highest leverage
Today you eyeball the transcript. To make scenarios self-verifying (and CI-gating), emit
a machine-readable per-turn event stream and let a spec assert against it. Capture, per
move resolution:
- `move`, `user`, **`useMode`** (NORMAL / INDIRECT / virtual…) — this is what makes an
  ability-triggered FOLLOW-UP visible and distinguishable from the primary move (High
  Tide's Surf, Glacial Rage's Blizzard, Retribution Blow's Hyper Beam, Sludge Spit, etc.);
- `targets` (battler indices) + **`hitCount`** (Multi-headed = 3, multi-hit, spread
  coverage) + per-hit `damage` + `effectiveness` + `crit`;
- form changes (base↔mega/hivemind), **tag add/remove with turn count**
  (THROAT_CHOPPED, ER_ITEM_DISABLED…), stat-stage changes (who/stat/delta), faints,
  held-item applications (Leftovers healed vs suppressed).

Then an optional `expect?: {...}` block (or just assert in a thin vitest wrapper), e.g.:
```jsonc
"expect": {
  "moveHits": { "ICE_BEAM": 3 },                          // Multi-headed mega
  "followUp": { "SURF": { "useMode": "INDIRECT", "targets": 2 } }, // High Tide spread
  "enemyTag": { "THROAT_CHOPPED": true },
  "enemyItemSuppressedTurns": { "LEFTOVERS": 2 },          // Frisk = 2 full turns
  "playerForm": "mega"
}
```
Even without a formal `expect`, just emitting the structured events unblocks regression
tests under `test/tests/elite-redux/` that drive the same harness.

---

## P2 — nice to have
- **Terrain override** (`run.terrain?`) → `O.TERRAIN_OVERRIDE` (we have weather, not
  terrain; several ER abilities key off terrain).
- **Determinism knobs**: `--no-miss` (force accuracy) / guaranteed-or-suppressed secondary
  effects, so assertions don't flake. (`seed` pinning helps but a no-miss toggle is
  cleaner for accuracy-dependent moves like Zap Cannon / Deadeye tests.)
- **Per-mon mid-battle state in doubles**: `applyStages/applyHpPct/status` only touch the
  LEAD (`getPlayerPokemon`/`getEnemyPokemon`); the ally / 2nd enemy can't be pre-set.
- **Arbitrary ability for `kind:"party"` enemies**: extend #1's `ability`/`passiveAbility`
  to `DevEnemyMonSpec` too.

---

## Bugs found while actually using the runner (please fix)
1. **Mega / form scenarios crash**: a party mon with `formIndex` pointing at a Mega
   form (e.g. Vanilluxe `formIndex:1`) throws `TypeError: this.load.on is not a
   function` (run-scenario.test.ts:506) and then `Timed out in waitUntil` — the
   mega-form sprite load hits an unstubbed Phaser loader (`scene.load.on`). Stub
   `load.on`/`load.off`/`load.once` (no-ops) in the headless mock so form/mega
   spawns don't crash. (Blocks the Mega Vanilluxe acceptance test below.)
2. **Can't force wild vs trainer**: `enemy.kind:"wild"` still rolls a TRAINER battle
   at some waves (seen at wave 145 — "Ivy sent out Skarmory"), and trainers SWITCH
   mons mid-fight, which breaks single-target / multi-turn item tests (Frisk: the AI
   switched the frisked Snorlax for a fresh one, resetting the lock, then timed out
   on the switch). Add `run.battleType?: "wild"|"trainer"` → `BATTLE_TYPE_OVERRIDE`
   so a test can pin a clean single wild enemy. (`kind:"party"` with 1 mon also
   pulled in a 2nd wild mon — the custom party isn't fully isolating the enemy field.)
3. **Low default wave re-triggers the #419 BST cap**: with no `run.wave`, specs run at
   wave 1, so any >420-BST enemy is silently devolved/swapped (Skarmory→Clamperl,
   Snorlax→Munchlax) — confusing for ability/type tests. Consider defaulting the
   harness to a high wave (e.g. 145) when an enemy species is explicitly set, or at
   least logging the swap prominently. (Workaround today: set `run.wave: 145`.)

## Acceptance scenarios (should all be expressible + assertable when done)
1. **Mega Vanilluxe Multi-headed**: party Vanilluxe `formIndex:"mega"` → ICE_BEAM hits 3×.
   (Works TODAY via formIndex — use as the smoke test for the event log / hitCount.)
2. **High Tide**: doubles, player `ability:HIGH_TIDE`, Water Pulse one foe → an INDIRECT
   SURF hits BOTH foes (needs #1 + #3 + #4).
3. **Throat Chop**: player THROAT_CHOP on a faster-outsped foe whose only move is a sound
   move → the sound move is cancelled that turn + tag present 2 turns (needs #3 + #4).
4. **Frisk**: player `ability:FRISK`, enemy `heldItems:[LEFTOVERS, SITRUS]` → Leftovers
   suppressed for exactly 2 turn-end heals, Sitrus still works (needs #1 + #2 + #4).
5. **Decorate**: doubles, target your OWN ally → move is NOT selectable / does 0 to ally;
   target a foe → foe damaged + both your mons get +2 Atk/SpAtk (needs #1-ish + #3 + #4).
6. **Corrosion**: player `ability:CORROSION` + Acid Spray vs a Steel foe → super-effective
   (needs #1 + #4 effectiveness).
