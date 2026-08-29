# M3-00E damage/mechanics oracle

Status: extraction only. This file records the pinned TypeScript oracle behavior and proposed Rust-kernel contract decisions; it does not implement mechanics, fixtures, crates, workflows, or production TypeScript.

## Authority and evidence boundary

- M2 base and the assigned worktree head were verified as `7357166c19bdb5cf0e32c84b0f74f22e79d80798` on branch `wrk/rk-m3-00e-damage`.
- The TypeScript oracle is the exact git object `3b534099919efae827019d4a3f3c4ab0ecd6d67b`; `git cat-file -t` reports `commit`. Oracle paths below mean `git show 3b534099919efae827019d4a3f3c4ab0ecd6d67b:<path>`, never a moving branch.
- The exact M2 tree contains no path matching `m3-slice`, `fixtures/m3`, or `m3-damage` (`git ls-tree -r --name-only 7357166c19bdb5cf0e32c84b0f74f22e79d80798 | Select-String ...` produced no output). Therefore no candidate move, ability, stat fixture, or expected parity vector is frozen by this extraction.

Notation:

- **Observed** means the cited TypeScript object does this.
- **Inference** means a direct consequence of the cited control flow, not a new oracle fact.
- **Proposed** means a contract decision for the Rust slice, pending integration-owner approval.
- **Gap** means the pinned source has an extension point or the M3 content selection is absent; this worker does not fill it with invented data.

All `[O: ...]` citations are exact path and line ranges in the pinned object above.

## Supported-slice boundary

**Observed.** The move categories are `PHYSICAL`, `SPECIAL`, and `STATUS`; only the first two are damage categories. Battle stages cover ATK, DEF, SPATK, SPDEF, SPD, ACC, and EVA, while effective damage stats are ATK, DEF, SPATK, SPDEF, and SPD. `[O: `src/enums/move-category.ts:1-8`; `src/enums/stat.ts:24-37`]`

**Proposed baseline.** A damage case is supported only when its resolved move category is physical or special, its resolved power/type/category are explicit, and no unselected move attribute, ability attribute, held-item modifier, field/weather/terrain modifier, fixed-damage path, OHKO path, type-changing path, Tera/Stellar path, or damage-rewrite hook participates. This is a fail-closed boundary around the ordinary `getBaseDamage`/`getAttackDamage` path: the oracle explicitly dispatches variable power, variable category, type, stat, damage, and defensive hooks. `[O: `src/data/moves/move.ts:1247-1275`; `src/field/pokemon.ts:5324-5358`; `src/field/pokemon.ts:5685-5816`]`

**Observed.** A status-category move returns `[HitResult.STATUS, 0, false]` from `applyMove` before damage calculation; status attributes can still run in the later move-effect stages. `[O: `src/phases/move-effect-phase.ts:762-779`; `src/phases/move-effect-phase.ts:728-739`]`

**Proposed baseline case shape.** Carry resolved numeric state, rather than relying on move/species IDs not present in the pinned M2 manifest: level, category, power, move type, base accuracy, source/target types, effective stats, stages, statuses, current/max HP, target set, PP, and the battle RNG stream. Reject any case that needs a missing content mapping or an unmodeled hook. This preserves the source's resolved-input boundary without pretending that the absent candidate inventory is parity data.

## RNG, gating, and draw semantics

**Observed.** `randBattleSeedInt(range, min)` returns an integer in `[min, min + range - 1]`, returns `min` when `range <= 1`, and delegates to the current battle stream; the inclusive min/max helper calls it with `max - min + 1`. `[O: `src/field/pokemon.ts:7994-8018`; `src/utils/common.ts:96-116`]`

**Observed.** The battle RNG call temporarily swaps in the battle seed state, draws, stores the updated battle state, and restores the prior global Phaser RNG state. `[O: `src/battle.ts:610-633`]`

**Proposed.** Rust must expose the same battle-stream draws and record each draw's purpose and range. Do not substitute an unrelated RNG or consume a draw for a path that the TypeScript control flow skips.

For an ordinary, non-multi-hit baseline move, the draw gates and order are:

1. First-failure checks run before usage text and PP deduction; the source checks PP before the paralysis check. `[O: `src/phases/move-phase.ts:264-310`]`
2. If paralysis activates, the source draws `randBattleSeedInt(4)` and cancels the move when the result is zero; no accuracy, critical, or damage draw follows. `[O: `src/phases/move-phase.ts:535-553`]`
3. If the first checks pass, ordinary PP is deducted before the second-failure check. A charging move deducts on the charging turn, not the release turn. `[O: `src/phases/move-phase.ts:203-218`; `src/phases/move-phase.ts:239-245`]`
4. Hit checking computes type effectiveness before accuracy; an immunity returns a no-effect result before any accuracy draw. `[O: `src/phases/move-effect-phase.ts:444-459`; `src/phases/move-effect-phase.ts:521-540`]`
5. After a successful hit, the critical-hit decision is made before the stat-change-before-damage hook and damage calculation. `[O: `src/phases/move-effect-phase.ts:789-812`]`
6. Real damage uses the 85–100 inclusive variance draw only after the path has passed the immunity return. `[O: `src/field/pokemon.ts:5407-5415`; `src/field/pokemon.ts:5539-5551`]`

## Accuracy

**Observed: base accuracy.** Battle accuracy starts from the move's `accuracy`, then applies variable-move, target, user, and biome hooks. `-1` returns immediately and bypasses the standard accuracy roll. OHKO accuracy skips the ordinary accuracy booster and gravity/biome transformations. Gravity floors `accuracy * 1.67`; an active biome rule floors `accuracy * biomeAcc` after composing its multipliers. `[O: `src/data/moves/move.ts:1168-1237`]`

**Observed: stage multiplier.** The user's ACC stage is capped at `+6`; the target's EVA stage is not symmetrically capped in this method. With no bypass/exposed-stage or ability modifiers, the difference is capped at six and the multiplier is `(3 + difference) / 3` when ACC is higher, otherwise `3 / (3 + difference)`. The final return also applies any source/target ability multipliers and tactical zoom multiplier. `[O: `src/field/pokemon.ts:4954-5046`]`

**Observed: roll.** After type effectiveness succeeds, a normal move calls `user.randBattleSeedInt(100)` and hits when `rand < moveAccuracy * accuracyMultiplier`; there is no floor or round on that product. `-1`, bypass-accuracy, and later multi-hit exceptions return hit without this draw. `[O: `src/phases/move-effect-phase.ts:542-569`]`

**Proposed supported accuracy contract.** For a selected ordinary move, preserve the source order exactly: resolve base accuracy and its allowed modifiers; apply ACC/EVA ratio; draw one integer in `[0,99]`; compare the integer to the unrounded Number product. Record whether the draw was skipped because of immunity, paralysis, `-1`, or an explicit bypass. No candidate move accuracy or modifier is frozen here, so no probability result is asserted.

## Critical hits

**Observed.** Critical stage is assembled by `getCritStage` from move/ability/tag/field attributes. The resulting stage is clamped to `[0,3]`, selecting chance denominators `[24, 8, 2, 1]`. If not already guaranteed, the oracle draws `randBattleSeedInt(critChance)` and accepts exactly result zero; a later crit-block hook can clear the result. `[O: `src/field/pokemon.ts:1902-1948`; `src/field/pokemon.ts:5862-5892`]`

**Inference.** With stage zero and no guarantee/block/override attributes, the ordinary critical probability is one draw from 24 values with success only at zero (1/24). This is an inference from the table and roll, not a selected fixture result. `[O: `src/field/pokemon.ts:5871-5890`]`

**Observed.** Signature follow-up and fixed-damage moves never crit. The ordinary critical multiplier is `1.5`, subject to a source ability hook. `[O: `src/field/pokemon.ts:5862-5869`; `src/field/pokemon.ts:5539-5543`]`

**Observed.** During effective-stat calculation, a critical hit changes the offensive stage used for ATK/SPATK to at least zero and the defensive stage used for DEF/SPDEF to at most zero; stored stages are not mutated by this adjustment. `[O: `src/field/pokemon.ts:4907-4918`]`

**Proposed.** The supported critical contract is one post-hit decision, one `[0,24)` draw at stage zero unless the selected case explicitly supplies another stage, then the `1.5` multiplier at its exact position in the damage chain. Critical-block, guaranteed-crit, fixed/OHKO, and custom critical multipliers are unsupported unless selected and mapped explicitly.

## Physical/special base damage and modifiers

**Observed.** `getBaseDamage` selects ATK for physical and SPATK for special, and DEF for physical and SPDEF for special. It computes the level factor as `(2 * level) / 5 + 2`, obtains resolved battle power, obtains effective source/target stats, and returns:

```text
baseDamage = (levelMultiplier * power * sourceAtk.value) / targetDef.value / 50 + 2
```

There is no floor between the multiplications/divisions and the return. `[O: `src/field/pokemon.ts:5066-5089`; `src/field/pokemon.ts:5138-5208`]`

**Observed.** Status moves resolve battle power as `-1`; non-status moves begin from the move's stored power but variable power and ability hooks can change it. `[O: `src/data/moves/move.ts:1247-1275`]`

**Proposed.** The Rust slice should receive a resolved power and category and evaluate the displayed formula in `f64` operation order. It must not infer a move's power from an absent ID or algebraically rearrange the expression.

**Observed: pre-chain gates.** `getAttackDamage` resolves effective type and category, combines the type multiplier with the arena attack-type multiplier, and returns zero before fixed/OHKO/base damage, critical variance, or STAB when the move is cancelled or the combined multiplier is zero. `[O: `src/field/pokemon.ts:5324-5374`; `src/field/pokemon.ts:5376-5415`]`

**Observed: target count.** The source computes `targetMultiplier = 0.75` when a resolved multi-target move has more than one target; otherwise it is `1`. `[O: `src/field/pokemon.ts:5475-5494`]`

**Observed: exact ordinary multiplier order.** After base damage and target count, the source multiplies in this order: multi-strike enhancement, arena type multiplier, Glaive Rush multiplier, critical multiplier, random multiplier, STAB, type effectiveness, burn multiplier, frostbite, fear, safe passage, screen, hit-tag, Misty Terrain, relic, relic defender, and library multipliers. It then calls `toDmgValue`; it calls `toDmgValue` again after the requested field damage multiplier. Later ability/move/item/defender hooks may rewrite or cap the result. `[O: `src/field/pokemon.ts:5533-5566`; `src/field/pokemon.ts:5680-5816`]`

**Proposed neutral baseline chain.** When the selected case proves every unselected factor is neutral, preserve this exact reduced chain:

```text
toDmgValue(
  baseDamage
  * targetMultiplier
  * criticalMultiplier
  * randomMultiplier
  * stabMultiplier
  * typeMultiplier
  * burnMultiplier
)
```

Then apply the second `toDmgValue` call with a requested field multiplier of `1`. This reduction is a contract proposal under the neutral-factor precondition, not a claim that the full source formula has only these factors. `[O: `src/field/pokemon.ts:5685-5706`]`

**Observed: variance.** A real, non-simulated calculation uses one `randBattleSeedIntRange(85, 100) / 100` draw, so the possible multipliers are exactly `0.85, 0.86, ..., 1.00`. Simulated calls use `1`, and a forced multiplier can be supplied by recursive suppression logic. `[O: `src/field/pokemon.ts:5545-5562`; `src/field/pokemon.ts:5725-5742`]`

**Observed: integer conversion and HP.** `toDmgValue(value)` is `Math.max(Math.floor(value), 1)`. Type immunity returns zero before this conversion; a non-immune ordinary damaging calculation therefore has a minimum converted damage of one. HP application caps damage at current HP, subtracts it, and returns the applied amount; an already fainted target returns zero. `[O: `src/utils/common.ts:393-405`; `src/field/pokemon.ts:5407-5415`; `src/field/pokemon.ts:5906-5916`; `src/field/pokemon.ts:5965-6015`]`

## STAB

**Observed.** STAB resolves the requested move type, checks the source's base types against `source.getMoveType(move)`, adds `0.5` for a matching non-Stellar move, applies dual-type/pledge/ability/Tera additions, and caps the result at `2.25`. Typeless moves return `1`. `[O: `src/field/pokemon.ts:5221-5274`]`

**Proposed neutral STAB contract.** With no typeless, dual-type, Tera, relic, or ability path, use `1.5` only when the resolved source move type matches a source type and `1` otherwise. Preserve the source's distinction between the `moveType` used for resolution and `source.getMoveType(move)` used for the base-type match. `[O: `src/field/pokemon.ts:5246-5255`]`

## Type effectiveness and immunity

**Observed: chart.** The baseline single-type chart returns only `0`, `0.5`, `1`, or `2`; unknown types return `1`. The target's dual types are iterated and their multipliers are multiplied without an intermediate round. Move-specific chart overrides and immunity-bypass checks can change the result. `[O: `src/data/type.ts:8-37`; `src/data/type.ts:40-55`; `src/field/pokemon.ts:3841-3885`]`

**Observed: status distinction.** For a status-category move, `getMoveEffectiveness` returns `1` unless the move has `RespectAttackTypeImmunityAttr`; damaging moves use the attack type chart. Separately, status application checks the status-specific immunities in `canSetStatus`. `[O: `src/field/pokemon.ts:3693-3705`; `src/field/pokemon.ts:7041-7073`]`

**Observed: defensive ability hook.** `TypeImmunityAbAttr` applies only when its move-type condition matches and sets the type multiplier to zero; `AttackTypeImmunityAbAttr` additionally excludes status-category moves and moves marked to neutralize Flying immunity. `[O: `src/data/abilities/ab-attrs.ts:423-480`]`

**Observed: causal gate.** Type effectiveness is computed before accuracy. A zero type/arena product returns `NO_EFFECT`/zero damage before the accuracy draw, critical decision, and variance draw. `[O: `src/phases/move-effect-phase.ts:521-569`; `src/field/pokemon.ts:5372-5415`]`

**Proposed.** Support the ordinary chart and dual-type product only when the case explicitly supplies target types and no chart override, inverse/challenge/room, groundedness exception, type-changing move, or immunity ability is active. If the M3 case requires the requested defensive/immunity ability, the primary owner must name its exact pinned ability construction and expected event/result; this worker does not choose an ability ID from the unprovided manifest.

## Stat stages and effective stats

**Observed: storage.** Stat stages are forcibly clamped to `[-6, +6]`; the battle-stage set includes the five effective stats plus ACC and EVA. `[O: `src/field/pokemon.ts:1884-1900`; `src/enums/stat.ts:34-45`]`

**Observed: multiplier.** Unless an ignore-stage hook applies, the stage multiplier is:

```text
max(2, 2 + stage) / max(2, 2 - stage)
```

The result is capped at `4`, with no floor or integer conversion at this point. On a critical hit, only the temporary offensive/defensive adjustments described above are made before this calculation. `[O: `src/field/pokemon.ts:4889-4941`]`

**Observed: effective-stat operation order.** The oracle starts from the stat value, applies stat/field/ally modifiers, multiplies by the stage multiplier, applies stat-specific effects, and returns `max(floor(ret), 1)`. For SPD, paralysis applies `ret >>= 1` after the stage multiplier and before the final floor; this is JavaScript bitwise coercion/truncation, not floating-point division by two. `[O: `src/field/pokemon.ts:1981-2063`; `src/field/pokemon.ts:2102-2133`]`

**Observed: stage mutation.** A stat-stage change phase clamps relative levels to `[-6,+6]`, calls `setStatStage`, then records/dispatches post-change hooks. The co-op recorder, when active, records the new absolute value only after the mutation. `[O: `src/phases/stat-stage-change-phase.ts:248-305`]`

**Observed: stat-change move effects.** A `StatStageChangeAttr` computes its move chance and, when guaranteed or when `randBattleSeedInt(100) < moveChance`, unshifts a `StatStageChangePhase`; the phase performs the stage mutation and post-change effects later. `[O: `src/data/moves/move.ts:4869-4948`; `src/phases/stat-stage-change-phase.ts:137-155`]`

**Proposed.** Rust should store stages as signed integers, clamp each mutation, compute the ratio in `f64`, apply critical-stage rules before the ratio, apply the paralysis SPD bitwise-equivalent truncation at the source position, and floor only at the final effective-stat conversion. Do not floor the ratio or mutate stages merely because a critical calculation ignores them.

## Burn, Poison, and Paralysis

### Status application

**Observed.** A status-effect move attribute obtains its move chance; it succeeds without a draw for chance `< 0` or `100`, otherwise draws `randBattleSeedInt(100)` and compares `< moveChance`. A successful check calls `trySetStatus`. `[O: `src/data/moves/move.ts:3491-3512`]`

**Observed.** In the ordinary non-override path, `canSetStatus` blocks an existing status or pending status. Poison and Toxic are type-immune on Poison and Steel unless a source bypass applies; paralysis is type-immune on Electric unless its bypass flag is supplied; burn is type-immune on Fire unless its bypass applies. `[O: `src/field/pokemon.ts:7019-7073`; `src/field/pokemon.ts:7092-7119`]`

**Observed.** `trySetStatus` performs feasibility checks, stores a pending status, and unshifts `ObtainStatusEffectPhase`; that phase calls `doSetStatus`, updates the display, plays the status animation, queues the obtain message, and then runs post-status hooks. `[O: `src/field/pokemon.ts:7171-7243`; `src/phases/obtain-status-effect-phase.ts:51-78`]`

### Burn

**Observed.** Burn halves physical damage unless the move or a source ability bypasses burn reduction; special damage is not changed by this branch. The multiplier is applied in the main damage chain after type effectiveness. `[O: `src/field/pokemon.ts:5564-5586`; `src/field/pokemon.ts:5685-5705`]`

**Observed.** At post-turn status resolution, burn damage is `toDmgValue(maxHP / 16)` before any burn-damage reduction ability hook, then the target is damaged with `preventEndure = true`. `[O: `src/phases/post-turn-status-effect-phase.ts:19-60`]`

### Poison

**Observed.** Ordinary Poison post-turn damage is `toDmgValue(maxHP / 8)`; Toxic uses the separate escalating `maxHP * toxicTurnCount / 16` expression. The status turn counter is incremented before the residual calculation, and Poison/Toxic/Burn are the statuses marked as post-turn. `[O: `src/phases/post-turn-status-effect-phase.ts:19-52`; `src/data/status-effect.ts:6-30`]`

**Proposed.** Include ordinary Poison in this M3 slice only if the selected case explicitly excludes Toxic. Toxic escalation is a separate capability and should fail closed until selected with a fixture.

### Paralysis

**Observed.** Paralysis halves effective SPD through `ret >>= 1`, at the source operation position. Before a move executes, a paralyzed user draws `randBattleSeedInt(4)`; result zero triggers the paralysis status presentation and cancels the move. `[O: `src/field/pokemon.ts:2102-2116`; `src/phases/move-phase.ts:535-553`]`

**Proposed.** Model paralysis as both a stat consequence and a move-failure consequence, while preserving the source order: PP availability is checked before the paralysis roll, but actual PP deduction occurs only after all first-failure checks pass. A full-paralysis cancellation consumes no PP because `usePP` has not run. `[O: `src/phases/move-phase.ts:264-310`; `src/phases/move-phase.ts:203-218`]`

## PP timing and mutation

**Observed.** `PokemonMove.isUsable` rejects an unresolved move, `MoveId.NONE`/`(N)` unimplemented moves, and out-of-PP moves unless PP is ignored. `usePp` clamps `ppUsed` to `getMovePp()`, and max PP is `basePP + ppUp * toDmgValue(basePP / 5)` unless overridden. `[O: `src/data/moves/pokemon-move.ts:47-90`; `src/data/moves/pokemon-move.ts:96-119`]`

**Observed.** The MovePhase comments and flags distinguish a move that fails but still uses PP (`failed`) from a cancelled move that retains PP (`cancelled`). First-failure checks occur before usage text and PP deduction; after they pass, ordinary PP is deducted, then the second-failure check may still end the move. `[O: `src/phases/move-phase.ts:61-64`; `src/phases/move-phase.ts:264-310`; `src/phases/move-phase.ts:203-245`]`

**Observed.** `usePP` deducts one PP plus the target-derived Pressure increment unless the use mode ignores PP, then dispatches `MoveUsedEvent` after mutating the move's PP. `[O: `src/phases/move-phase.ts:694-704`]`

**Proposed.** The Rust transaction boundary is: validate/select move; run first-failure checks; if cancelled, retain PP; otherwise deduct exactly once before second-failure and hit resolution; record the post-deduction PP and any Pressure increment. Charging/release and virtual/ignore-PP modes remain unsupported unless selected.

## Recoil and drain (conditional capability)

No candidate move manifest is present in the exact M2 tree, so no candidate move is identified as requiring recoil or drain; the following is an extraction, not an assertion that either mechanic belongs in the minimum case.

**Observed: recoil.** `RecoilAttr` is a last-hit-only, self-targeted effect. Its default ratio is `0.25`; with `useHp = false`, the base is `user.turnData.totalDamageDealt`, otherwise it is the user's max HP. It applies ability multipliers, converts with `toDmgValue`, uses minimum zero when the move dealt no damage (otherwise minimum one), then calls `damageAndUpdate` and records indirect damage. `[O: `src/data/moves/move.ts:2460-2526`]`

**Observed: drain.** `HitHealAttr` is a self-targeted post-apply effect. Its default ratio is `0.5`; ordinary drain starts from `toDmgValue(user.turnData.singleHitDamageDealt * healRatio)`, then applies the source ability multiplier and final `Math.floor(healAmount * multiplier * healMultiplier)`, and queues `PokemonHealPhase`. Reverse Drain prevents the heal path. `[O: `src/data/moves/move.ts:3193-3238`; `src/data/moves/move.ts:3256-3266`]`

**Observed: effect order.** On a successful hit, the source runs PRE_APPLY effects, damage/status resolution, user POST_APPLY effects, then target POST_APPLY/on-target effects. Last-hit-only recoil therefore follows the damage result, while drain's exact phase behavior is determined by its queued heal phase. `[O: `src/phases/move-effect-phase.ts:694-713`; `src/phases/move-effect-phase.ts:728-753`]`

**Proposed.** Add recoil/drain only as an explicitly selected attribute with its exact ratio, `useHp`/last-hit behavior, and suppression hooks. Do not silently implement a generic “recoil” or “drain” shortcut.

## Presentation and mutation causal order

**Observed: move-level order.** `MoveEffectPhase` resolves hit checks and records pending/success/miss state, plays the move animation when required, then invokes `postAnimCallback`; that callback pushes move history and applies target effects. `[O: `src/phases/move-effect-phase.ts:262-307`; `src/phases/move-effect-phase.ts:323-381`]`

**Observed: hit-check order.** For a target, the documented order is self-target/field presence/commander concealment/semi-invulnerability/protection/reflection, then type effectiveness/immunity, then accuracy. Miss and no-effect branches queue their presentation messages and apply their corresponding attributes without entering damage. `[O: `src/phases/move-effect-phase.ts:444-459`; `src/phases/move-effect-phase.ts:401-440`]`

**Observed: successful-hit order.** A hit runs PRE_APPLY attributes; `applyMove` returns immediately for status category or calls damage for a damaging category; user POST_APPLY then target POST_APPLY/on-target effects run. `[O: `src/phases/move-effect-phase.ts:728-779`]`

**Observed: damage mutation order.** A damaging hit rolls critical, applies stat changes marked before damage, calculates damage with `simulated: false`, consumes a one-use type boost, skips HP mutation if initial damage is zero, calls `damageAndUpdate`, queues critical presentation, updates total/single-hit damage and target ledgers, then runs post-damage recoil/contact hooks. `[O: `src/phases/move-effect-phase.ts:789-910`]`

**Observed: HP/faint order.** `damage` no-ops on an already fainted target, applies survival hooks, caps to current HP, subtracts HP, conditionally records co-op HP/faint events, and queues a host FaintPhase unless `ignoreFaintPhase` is set. Direct move damage passes `ignoreFaintPhase: true` and later queues the move's faint handling; post-turn status damage uses the default and passes `preventEndure: true`. `[O: `src/field/pokemon.ts:5906-6015`; `src/phases/move-effect-phase.ts:826-848`; `src/phases/post-turn-status-effect-phase.ts:54-60`]`

**Observed: status/stat mutation order.** Status application first creates a pending status and an `ObtainStatusEffectPhase`, whose start mutates `status` before animation/message/post-status hooks. Stat-stage resolution clamps relative stages, mutates each stage, records the new absolute stage when co-op recording is active, and only then runs post-stage hooks. `[O: `src/field/pokemon.ts:7171-7243`; `src/phases/obtain-status-effect-phase.ts:51-78`; `src/phases/stat-stage-change-phase.ts:248-305`]`

**Observed: end-of-turn order.** The phase manager queues WeatherEffect, PositionalTag, Berry, CheckStatusEffect, and TurnEnd in that order. CheckStatusEffect iterates active post-turn statuses in speed order and unshifts their residual phases; each residual phase increments the status counter, checks cancellation, queues status text, applies damage, updates info, and plays the residual animation. `[O: `src/phase-manager.ts:333-340`; `src/phase-manager.ts:918-923`; `src/phases/check-status-effect-phase.ts:6-16`; `src/phases/post-turn-status-effect-phase.ts:19-62`]`

**Observed: recorder limits.** Co-op HP/faint events are emitted at the universal `damage` chokepoint only while recording; status events are emitted after `status` is assigned and only for on-field recording; stat-stage events are emitted after mutation and only while recording. These conditional calls do not constitute a complete canonical event log for every solo presentation path. `[O: `src/field/pokemon.ts:5965-6008`; `src/field/pokemon.ts:7338-7347`; `src/phases/stat-stage-change-phase.ts:272-291`]`

**Proposed presentation contract.** Emit semantic, ordered events (for example, hit-check result, move-animation boundary, message key, PP mutation, critical result, HP mutation, status mutation, stat-stage mutation, recoil/drain, and faint) at the source causal points. Keep localized strings, Phaser animation objects, and renderer callbacks out of the Rust authority state. A final-state-only comparison is insufficient for cases where the oracle mutates state and queues presentation in separate phases.

## JavaScript Number and rounding ledger

The following points are required for parity in the supported path:

| Source operation | Exact behavior | Oracle |
| --- | --- | --- |
| Integer RNG | Inclusive integer range; `range <= 1` returns `min` | `[O: `src/utils/common.ts:96-116`; `src/field/pokemon.ts:7994-8018`]` |
| Accuracy gravity/biome | `Math.floor` is applied at each stated accuracy transformation | `[O: `src/data/moves/move.ts:1211-1233`]` |
| Accuracy roll | Compare integer draw to unrounded `moveAccuracy * accuracyMultiplier` | `[O: `src/phases/move-effect-phase.ts:562-569`]` |
| Stage ratio | Floating-point ratio, capped at 4; no floor | `[O: `src/field/pokemon.ts:4934-4941`]` |
| Effective stat | Final `Math.max(Math.floor(ret), 1)` only | `[O: `src/field/pokemon.ts:2126-2133`]` |
| Paralysis SPD | JavaScript `>>= 1` at the SPD branch, before final floor | `[O: `src/field/pokemon.ts:2111-2116`]` |
| Base damage | No intermediate floor in the level/power/offense/defense expression | `[O: `src/field/pokemon.ts:5066-5208`]` |
| Damage chain | Preserve listed multiplication order, then `toDmgValue`; apply a second conversion after requested field multiplier | `[O: `src/field/pokemon.ts:5685-5706`]` |
| Damage conversion | `Math.max(Math.floor(value), minValue)`, default min `1` | `[O: `src/utils/common.ts:393-405`]` |
| HP application | `Math.min(damage, hp)` before subtraction; return actual applied damage | `[O: `src/field/pokemon.ts:5965-6015`]` |
| Residual Poison/Burn | `toDmgValue(maxHP / 8)` or `toDmgValue(maxHP / 16)` | `[O: `src/phases/post-turn-status-effect-phase.ts:40-50`]` |
| PP max/use | `toDmgValue(basePP / 5)` in max PP; `Math.min(ppUsed + count, maxPP)` on use | `[O: `src/data/moves/pokemon-move.ts:96-107`]` |
| Recoil | Ratio and ability multiplication precede `toDmgValue`; minimum is 0 or 1 based on total damage | `[O: `src/data/moves/move.ts:2497-2512`]` |
| Drain | `toDmgValue(singleHitDamage * ratio)`, then final `Math.floor` after multipliers | `[O: `src/data/moves/move.ts:3256-3266`]` |

**Proposed.** Use `f64` for Number-valued arithmetic, keep the source expression and phase order, implement JavaScript-compatible integer coercion for the selected `>>` operations, and do not use algebraic simplification, fused multiply-add, saturating arithmetic, or an untracked random draw. The table is a parity ledger, not permission to broaden the slice beyond the boundary above.

## Unsupported behavior and unresolved gaps

1. **Content selection gap.** No exact M3 candidate move/ability/fixture manifest exists at the requested M2 object, so no move ID, ability ID, base power, accuracy, type pairing, or expected damage value is asserted. `[GIT: exact-tree query stated in Authority and evidence boundary]`
2. **Open-ended hooks.** Variable power/category, type-chart overrides, STAB boosts, damage boosts/reductions, immunity abilities, stat modifiers, status bypasses, and item/field modifiers are dispatched through extensible attributes/modifiers. They must be selected and mapped, or rejected. `[O: `src/data/moves/move.ts:1247-1275`; `src/field/pokemon.ts:5324-5358`; `src/field/pokemon.ts:5685-5816`]`
3. **Fixed/OHKO/multi-hit/charging modes.** Fixed damage and OHKO have early branches; multi-hit changes target/hit accounting and can bypass later accuracy checks; charging moves have distinct PP timing. These are not part of the neutral ordinary-move contract without a selected case. `[O: `src/field/pokemon.ts:5417-5473`; `src/phases/move-effect-phase.ts:544-551`; `src/phases/move-phase.ts:206-218`]`
4. **Type-changing and special typing gap.** Stellar, Tera, dual-type moves, inverse/challenge/room changes, groundedness-specific immunities, and move chart overrides are present but not frozen for this worker. `[O: `src/field/pokemon.ts:3841-3885`; `src/field/pokemon.ts:5246-5273`; `src/data/type.ts:21-37`]`
5. **Status breadth gap.** Toxic escalation, status bypass abilities, terrain/weather status blockers, sleep/freeze/frostbite, and status-specific move exceptions are broader than the requested Burn/Poison/Paralysis baseline. `[O: `src/field/pokemon.ts:7019-7130`; `src/data/status-effect.ts:6-30`; `src/phases/post-turn-status-effect-phase.ts:40-52`]`
6. **Ability identity gap.** The generic defensive immunity behavior is observable, but the requested single defensive/immunity ability is not identified by an exact M3 selection. Do not substitute a familiar ability name or infer its trigger from the generic class. `[O: `src/data/abilities/ab-attrs.ts:423-480`]`
7. **Presentation topology gap.** The source uses phase queues, localized messages, animation callbacks, and conditional co-op recording; a Rust contract needs an explicit semantic event schema and snapshot points rather than a final HP/status snapshot alone. `[O: `src/phases/move-effect-phase.ts:282-307`; `src/phases/obtain-status-effect-phase.ts:51-78`; `src/field/pokemon.ts:5965-6008`]`

## Proposed contract decisions for integration review

These are proposals, not additional oracle observations:

- Freeze the ordinary physical/special, non-fixed, non-OHKO, non-type-changing path first, with a resolved input record and a deterministic battle RNG stream.
- Require an explicit capability bit and fixture for every non-neutral hook. Unknown move attributes, ability attributes, item/field modifiers, status bypasses, or special move modes fail closed with a structured unsupported reason; they do not become silent no-ops.
- Compare the RNG draw ledger, hit/crit/type decisions, operation-order trace, PP/status/stage/HP mutations, presentation-event order, and final state. This follows the source's separate hit-check, animation, effect, damage, and recorder stages. `[O: `src/phases/move-effect-phase.ts:323-381`; `src/phases/move-effect-phase.ts:728-910`]`
- Use the neutral multiplier chain and the rounding ledger above; preserve all `toDmgValue` boundaries and the JavaScript-compatible paralysis shift.
- Treat immunity as an early terminal branch: no accuracy, critical, variance, or HP damage draw/mutation after a zero type/arena product. `[O: `src/phases/move-effect-phase.ts:521-569`; `src/field/pokemon.ts:5407-5415`]`
- Treat PP as a transaction after first-failure checks and before second-failure/hit resolution; dispatch or emit the post-mutation PP event at that point. `[O: `src/phases/move-phase.ts:203-245`; `src/phases/move-phase.ts:694-704`]`
- Keep Burn physical reduction, Poison residual, and Paralysis SPD/full-paralysis behavior as separate capabilities so their distinct timing and rounding cannot be collapsed into one generic status modifier. `[O: `src/field/pokemon.ts:5567-5586`; `src/phases/post-turn-status-effect-phase.ts:40-60`; `src/phases/move-phase.ts:535-553`]`
- Do not approve a claimed “supported one defensive/immunity ability” until the primary owner supplies the exact pinned ability construction, trigger condition, selected move/type pairing, and expected causal events. `[O: `src/data/abilities/ab-attrs.ts:433-480`]`
