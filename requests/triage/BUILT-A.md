<!--
SPDX-FileCopyrightText: 2024-2026 Pagefault Games

SPDX-License-Identifier: AGPL-3.0-only
-->

# Wave A built: condition atoms

Files: `V/conditions-library.ts` (23 new atoms), `V/conditions.ts` (options on `mon.has-type`, `mon.has-ability`,
`party.ally-ability`), `EV/conditions.ts` (factories, `abilityIdOf`), `V/texts-conditions.ts` (summaries, categories).
Tests: `test/tests/elite-redux/decomp/library-completion-wave-a.test.ts` (prefix "wave A: ..."). No declaration was changed.

| # | Id | Kind | Requests answered | Formula source | Classes / abilities that can now use it | Test |
|---|---|---|---|---|---|---|
| A1 | `move.type-is-mine{includeTera}` | atom | R-B11-C5-01 | `ER/archetypes/stab-add.ts:138-140`; `stab-suppress-aura.ts:59-60` | StabAdd (59 abilities), StabSuppressAura (Relic Stone, Titan) | move and type atoms › move.type-is-mine ... |
| A2 | `stat.is{stats}` | atom | B04 8-21, R-B11-C5-03, R-B15-28 | `A:4327`; `ER/abilities/pressure-vessel.ts:92` | StatBlend, Pressure Vessel, World in Pieces, FaintedAllyStatMultiplier, `cancel.stat-*` rules (with C1/C2) | stat atoms › stat.is reads the stat slot ... |
| A3 | `stat.is-highest{stats}` | atom | R-B18-23, R-B11-C4-01 | RCR:446-453; `self-highest-stat-multiplier.ts:96-106` | SelfHighestStatMultiplier (Solar Power, Sand Force, Whiteout, Big Leaves, ...), HigherStatMultiplier | stat atoms › stat.is-highest is HigherStatMultiplierAbAttr.gate ... |
| A4 | `mon.tera-type{who, type}` | atom | R-B14-5.6 | RAI:123 | MoveTypeChange (B02-14, 13 abilities) + Electrodynamics riders | Pokemon atoms › mon.tera-type and mon.species ... |
| A5 | `mon.species{who, species}` | atom | R-B14-5.7 | RAI:124; `pokemon.ts:2605`; names: `SpeciesId` first, then `ErSpeciesId` (`speciesIdOf`) | same as A4 | Pokemon atoms › mon.tera-type and mon.species ... |
| A6 | `move.type-counts-as{type}` | atom | R-B10-c3-07 | `ER/archetypes/post-attack-scripted-move.ts:162-170` | PostAttackScriptedMove (Volcano Rage, Frost Burn, High Tide, Ebb and Flow, Glacial Rage, Frost Dragon, Lunar Wrath) | move and type atoms › move.type-counts-as ... |
| A7 | `status.asleep-or-comatose{who}` | atom | R-B10-23 | `A:8459-8463` (`isComatoseLike`, called) | Sweet Dreams, Peaceful Slumber, Bad Dreams foe filter | Pokemon atoms › status.asleep-or-comatose ... |
| A8 | `move.accuracy{cmp, n}` | atom | (B-list A8) | `ER/archetypes/priority-modifier.ts:227` | PriorityModifier `maxAccuracy` (Sighting System, Iron Barrage) | move and type atoms › move.accuracy: boundaries ... |
| A9 | `time.hits-taken{who, cmp, n}` | atom | R-B11-C2-01 | `src/data/pokemon/pokemon-data.ts:537` | Lucky Halo | time atoms › time.hits-taken: boundaries ... |
| A10 | `time.last-move-type{who, type}` | atom | R-B11-C2-12 | `ER/archetypes/recharge-on-electric-terrain.ts:68-71` (`RechargeChargedOnElectricKoAbAttr.gate`); `requests/B11.md:83` | Energized | time atoms › time.last-move-type answers like RechargeChargedOnElectricKoAbAttr.gate |
| A11 | `move.sets-weather` | atom | R-B11-C1-07 | `move.ts:397` hasAttr("WeatherChangeAttr") | Forecast follow-up gate (full only with C32) | move and type atoms › move.sets-weather and move.spread ... |
| A12 | `move.spread` | atom | R-B13-39 | `move.ts:484-498`; NSM:1334-1336 | CenterSpreadReduction (0 abilities) | move and type atoms › move.sets-weather and move.spread ... |
| A13 | `move.can-be-multi-strike-enhanced` (requires `move`, `moveUser`) | atom | B17 R30 | `A:2012-2013`, `A:2067-2068` | HitMultiplier, AddSecondStrike (with C8) | move and type atoms › move.can-be-multi-strike-enhanced answers like AddSecondStrikeAbAttr.canApply for the move user |
| A14 | `time.acted-before{order: holder-first \| other-first}` | atom | R-B15-36 | `ER/abilities/relativity.ts:53-62` (helper called) | RelativityDefenseReduction | time atoms › time.acted-before calls the exported pokemonActedBefore helper |
| A15 | `foe.average-defense-not-higher` | atom (includes feasibility) | B03 c3-41 | `A:3618-3650` | DownloadAbAttr (Download) | stat atoms › foe.average-defense-not-higher is DownloadAbAttr canApply ... and gate |
| A16 | `field.aura-on-field{aura}` | atom | B03 c2-29 | `init-abilities.ts:1350, 1356, 1362-1365` | Aura Break (3 attrs), Nihil Blaster (once the `extra` slot exists) | field and party atoms › field.aura-on-field ... |
| A17 | `mon.has-type` option `originalIfStellar` | option on live atom | B04 11-31 | `pokemon.ts:2880-2886` | Flower Veil, Jungle's Guard | options on the live atoms › mon.has-type ... |
| A18 | `mon.has-ability` / `party.ally-ability`: Elite Redux names + option `current` | resolver widening + option | R-B11-C4-13, R-B11-14, R-B14-5.3 | `pokemon.ts:3853`; `ER/abilities/fakemon-pitch-abilities.ts:68-69` | Soul Linker (2 classes), Temporal Rupture (3 attrs), Psionic/Electrodynamics riders, Overloaded | options on the live atoms › current ...; abilityIdOf ... |
| A19 | `move.chosen-is-damaging` | atom | R-B18-3 | `A:7900-7904` | BypassSpeedChance (Quick Draw) + ER provenance class (with B1, C38, D4) | move and type atoms › move.chosen-is-damaging answers like Quick Draw's clause ... |
| A20a | `party.any-ally-active` | atom | R-B14-5.8 | PM:111-113 | SynchronizedCurrentBothAttackPower | field and party atoms › party.any-ally-active ... |
| A20b | `party.active-ally-chose-damaging-move` | atom | R-B14-5.9 | PM:75-87, :111-113 | SynchronizedCurrentBothAttackPower | field and party atoms › party.active-ally-chose-damaging-move ... |
| A21 | `time.attacked-this-turn{who}` | atom | R-B14-5.10 | PM:102-108 | SynchronizedCurrentHeal gate | time atoms › time.attacked-this-turn ... |
| A22 | `mon.charge-stacks{who, cmp, n}` | atom | R-B14-6.2 | `ER/abilities/charge-stack.ts:31-33` (`getCharge`, called) | Overloaded (Power, Priority, Chip), CapacitorBank (with C37 + A18) | Pokemon atoms › mon.charge-stacks: boundaries ... |
| A23 | `mon.mega-evolved{who}` | atom | (B-list A23) | FPM:1367 | Bejeweled condition (with A24 + `mon.terastallized`), Stellarize | Pokemon atoms › mon.mega-evolved and mon.gigantamax-form ... |
| A24 | `mon.gigantamax-form{who}` | atom | (B-list A24) | FPM:1367 | as A23 | Pokemon atoms › mon.mega-evolved and mon.gigantamax-form ... |
| A25 | `time.max-uses-per-wave{key, max}` | atom (read only) | R-B10-c5-01 | `ER/archetypes/post-summon-scripted-move.ts:109-117, 137-141` | PostSummonScriptedMove count cap (Wishmaker, Daydreamer); 0 alone, the `key#n` write stays in the class | time atoms › time.max-uses-per-wave ... PostSummonScriptedMoveAbAttr.gate |

Comparison basis (after review CompletionReviewA):
- Real class or engine helper: A1 (`StabAddAbAttr` default off-type closure; the spy proves `getTypes(false, false)` /
  `getTypes(true, false)`), A3 (`HigherStatMultiplierAbAttr.gate`), A6 (`PostAttackScriptedMoveAbAttr.gate` with
  `typeFilter`), A8 lt (`PriorityModifierAbAttr.matchesFilter({ maxAccuracy })`), A10
  (`RechargeChargedOnElectricKoAbAttr.gate`), A13 (`AddSecondStrikeAbAttr.canApply`, holder side and defender side),
  A14 (`pokemonActedBefore`), A15 (`DownloadAbAttr.canApply && gate`), A19 (`BypassSpeedChanceAbAttr.canApply`, roll and
  tag passing), A23/A24 (`StellarizePowerAbAttr` default condition, each piece isolated), A25
  (`PostSummonScriptedMoveAbAttr.gate`), A7 (`isComatoseLike`), A11/A12 (real moves).
- Hand tables, the originals being module-private: A4, A5, A20, A21. Boundary tests: A8 (every comparison, and a real
  never-miss move), A9, A22, A25, A3 ties, A15 rounding.

Recursion latches (review items 1-2): `move.type-is-mine` and `foe.average-defense-not-higher` each hold a module
`WeakSet` keyed by the holder while `getMoveType` / `getEffectiveStat` runs; a re-entrant ask for the same holder
answers no, and the latch is released in `finally`. Outer answers are unchanged. Tests: "move.type-is-mine does not
recurse when getMoveType runs the same rule again (calc.move-type)" and "foe.average-defense-not-higher does not
recurse when getEffectiveStat runs the same rule again (stat triggers)" (one holder, and two holders facing each other).
The pre-existing `move.type` atom (`effective: true`) on `calc.move-type` has the same hazard and was not touched
(not a wave A block).

Notes for the rebinding pass:
- A1 reads `frame.holder` (the class reads the holder's `getMoveType`), not `moveUser`.
- A2 sees only the first stat on multi-stat WHENs (`EV/frame.ts:113`).
- A13 now requires `moveUser` and reads it (the source's `pokemon` is the attacker; `calc.hit-count` names the holder
  as move user), with the target being the other side of the move.
- A19: Quick Draw's order is `!simulated`, roll, this atom, `canAddTag`; a rule must keep the roll before this atom.
- A25: the class passes a preview before reading memory; a rule must put the preview check (B1 `not-simulated`) first.
- A15 includes the class's feasibility (a foe exists, both averages > 0); both outcomes of Download act, so the rule
  needs the atom plus its negation guarded by the same feasibility.

## Live blocks changed (defaults = today)

- `mon.has-type`: new boolean `originalIfStellar`, default `false` → `isOfType(type)` exactly as before; `true` →
  `isOfType(type, true, true)`. The test spies the call arguments.
- `mon.has-ability`, `party.ally-ability`: new boolean `current`, default `false` → `hasAbility(id)` as before (the test
  spies the argument); `true` → `getAbility().id === id` (source `ER/archetypes/set-target-ability-on-move.ts:69`).
  The name resolver is now `abilityIdOf`: the old `enumValue(AbilityId, …)` first (unchanged result for every name
  that resolved; the test checks every `AbilityId` name), then `ErAbilityId`, then the registered abilities by
  runtime reverse key or by in-game name (Ninja's Blade, key `KUNOICHI_S_BLADE`). Each step tries the name as written,
  `constantName`, and the `abilityNameToEnumKey` spelling ("Jungle's Guard", "Olé!", "3 > 1"); a typed " (N)" / " (P)"
  marker is ignored, and spellings with no ASCII letter or digit are dropped (so "!!!" is "not a known ability", not a
  false "names N different abilities"). After the vanilla step (which still returns at once, unchanged), every match
  is collected, the ErAbilityId table included, and a name matching several abilities throws "names N different
  abilities" instead of picking one: As One, Embody Aspect, and the nine partner-composite pairs (Keen Edge 5009/5952,
  Self Sufficient, Short Circuit, Ominous Shroud, Stainless Steel, Komodo, Dragonfruit, Voltron, Waterborne), including
  their ErAbilityId keys. Test: every unique Elite Redux display name (partner composites included) resolves to its
  own id (vanilla-named ones keep the vanilla id); every ErAbilityId key resolves to its own id or is refused with its
  id listed. Digit strings and unknown names are still refused.
- Formula text of these three live entries was updated to describe the options (generated JSON changes once the
  integrator regenerates).

## Final staff review (FinalStaff) text and data fixes

- Labels: `mon.charge-stacks` "{who}'s electric charges are {cmp} {n}" (the effects' word); `mon.species`
  "{who}'s species is {species}"; `time.max-uses-per-wave` "Uses of counter {key} this wave are below {max} (advanced)";
  `time.hits-taken` "The number of times {who} was hit this battle is {cmp} {n}" (both plural-safe at 1);
  `field.aura-on-field` choices "the Dark Aura ability" / "the Fairy Aura ability" / "the Dark Aura or Fairy Aura
  ability".
- `time.acted-before`: the two Pokemon pickers (which could both pick the owner) became one `order` choice, "I moved
  before the other Pokemon" / "The other Pokemon moved before me". New block, no binding names its settings.
- `party.ally-active` (live) relabelled "My first ally can still fight (advanced)", label and summary only;
  `party.any-ally-active` summary states the triple-battle difference.
- `time.marker-set` (live) label and setting labels say "reminder" like the effects; behaviour unchanged.
- Synonyms: "same type as me", "faster", "went first", "electric charge", "reminder".
- `mon.species` also resolves `ErSpeciesId` names (vanilla `SpeciesId` first; the test checks every vanilla name keeps
  its id; Grotom, Phantowl, "Grotom Glass" resolve).
- `mon.mega-evolved` / `mon.gigantamax-form` default `who` is now the ability owner (new blocks, no bindings).
- `time.max-uses-per-wave` summary says only the built-in ability adds to the count.

## Skipped (need a decision)

- A26 `matchup.defender-has-type`: needs new slot `defenderTypes` (D2).
- A27 `move.effect-chance-between`: needs new slot `effectChance` (D3).

## Test counts

`library-completion-wave-a.test.ts` 30/30 pass; `evaluate-conditions.test.ts` 34/34, `l0-lint.test.ts` 10/10 and
`vocabulary-naming.test.ts` 6/6 pass.
