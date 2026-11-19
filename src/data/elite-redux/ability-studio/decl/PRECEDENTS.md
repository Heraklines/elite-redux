<!--
SPDX-FileCopyrightText: 2024-2026 Pagefault Games

SPDX-License-Identifier: AGPL-3.0-only
-->

# Declaration precedents (read this before you write a declaration)

This is the hand-off from the foundation team to the 18 batch agents (B01 to B18). The ten classes in
[`precedents/`](./precedents) were each decomposed by hand and carried to status `verified` through L0, L1 and L2.
Copy the precedent whose shape matches your class. The spec is `~/er-probe/decomposition-spec.md`; where this file and
the spec disagree on a mechanical detail, this file describes what the code does today.

Ground rules that never change:

- **Factor, do not re-implement.** The class stays the single source of behaviour. A declaration describes it.
- **Hand work only.** Scripts may print worklists and lints. Declarations, bindings and probes are written and read by
  a person, one class at a time. A bulk-generated binding encodes the classic mistake (conditions, guards, RNG and
  feasibility mixed up) and L1 cannot always see it.
- **Behaviour must not change.** No reordered `.attr()` calls, no renamed class, no moved or added random draw, no
  changed `showAbility` or message. A bug you find goes into `notes`; you do not fix it in the same change.

## 1. What you write

For class `Foo` in your batch `Bnn`:

| File | Content |
| --- | --- |
| `decl/Bnn/Foo.decl.ts` | `export default defineDecl(Foo, {...})`. The file name is the class name (PascalCase is allowed here by `.ls-lint.yml`). |
| `decl/Bnn/bindings.ts` | One `bindCondition(abilityId, attrIndex, spec, slot)` per constructor closure or Tier B gate of every user of the class. `bindLegacyClosure(abilityId, attrIndex, reason, slot)` when no atom exists. |
| `test/tests/elite-redux/decomp/Bnn/*.test.ts` | Only what the shared L1 and L2 suites cannot see (memory, a stand-in Pokemon for a form you cannot get in a battle, draw order). |
| `requests/Bnn.md` | Atoms, effects, guards or WHENs you need from the librarian (B19). Not code. Create the directory and file yourself if it does not exist; a plain list of id, what it must do and which ability needs it. |

The registry collects `decl/**/*.decl.ts` and `decl/**/bindings.ts` with `import.meta.glob`. You never edit the
registry, `init-abilities.ts`, `apply-ab-attrs.ts` or another batch's files.

`attrIndex` is the position in `ability.attrs`, not the position of the `.attr(...)` line. An ability that builds on
another (Fluffy, Voltron, Ominous Shroud exist under several ids) has the class at a different index in each id.

## 2. Which precedent to copy

| Your class is... | Copy | Tier | Why it is the model |
| --- | --- | --- | --- |
| an effect that happens at a moment, no closure | [`PostSummonWeatherChangeAbAttr`](./precedents/PostSummonWeatherChangeAbAttr.decl.ts) (**event-effect**) | A | One enum param (codec), feasibility stays in the class, nothing to bind. |
| a number the engine asks for, with a constructor closure | [`ReceivedMoveDamageMultiplierAbAttr`](./precedents/ReceivedMoveDamageMultiplierAbAttr.decl.ts) (**calc-modifier**) | A | `buildAttr` calls the real constructor with the compiled closure. 64 bindings in [`bindings.ts`](./precedents/bindings.ts), 3 of them legacy with a written reason. |
| an immunity or block, closure optional | [`AttackTypeImmunityAbAttr`](./precedents/AttackTypeImmunityAbAttr.decl.ts) | A | `optional: true` slot: users without a closure need no binding. This is the "immune to Ground" recipe. |
| a pure flag the engine looks for (`hasAbilityWithAttr`) | [`IgnoreContactAbAttr`](./precedents/IgnoreContactAbAttr.decl.ts) (**while-active**) | C | No moment, no condition, no effect. Label, synonyms, a written `noParamsReason`. |
| a flag or identity the engine QUERIES to decide something | [`FloatAbAttr`](./precedents/FloatAbAttr.decl.ts) (**engine-query**) | C | Counted apart; the foundation owns the `abilityQuery` routing. You do not touch the call sites. |
| a one-off mechanic with shared per-instance state | [`PostSummonCopyAbilityAbAttr`](./precedents/PostSummonCopyAbilityAbAttr.decl.ts) (**package**) | C | Justified in `notes`, "Works as one piece", still has a label, synonyms, example, WHEN. |
| a gate that lives inside `canApply` | [`PostDamageForceSwitchAbAttr`](./precedents/PostDamageForceSwitchAbAttr.decl.ts) | B | The `guards / prepare / gate / residual` split, spec 3.3. Wimp Out and Emergency Exit. |
| a class with two edges (enter and leave) | [`HpThresholdFormChangeAbAttr`](./precedents/HpThresholdFormChangeAbAttr.decl.ts) (**branches**) | B | `branches`, a `not-fainted` guard, an XOR gate spelled out per user. |
| "once per wave / battle" memory | [`BerserkOnThresholdAbAttr`](./precedents/BerserkOnThresholdAbAttr.decl.ts) (**memory**) | B | `time.once-per{wave}` shares the class's own memory; see section 5. Probes in `test/.../precedents/memory.test.ts`. |
| random numbers inside `canApply` | [`PostDefendContactApplyStatusEffectAbAttr`](./precedents/PostDefendContactApplyStatusEffectAbAttr.decl.ts) | B | Draw order written in `flags.rngOrder`; the chance atom sits where the draw sat. Probes in `rng-order.test.ts`. |

The staff-facing recipes that prove the pieces recombine live in `test/tests/elite-redux/decomp/harness/recipes.ts`
(switch out below 35% HP, immune to Ground, half damage at full HP, 50 BP Steam Eruption after a Fire or Water move).
They run in real battles and are the proof that a staff-built rule equals a shipped ability.

## 3. The tier decides how the class is touched

- **Tier A** (the condition is a constructor closure or field): do not edit the class. `buildAttr` calls the real
  constructor; each closure becomes a binding.
- **Tier B** (the gate is inside `canApply`): split `canApply` into `guards`, `prepare`, `gate` and `residual`, in the
  ORIGINAL clause order, using `gatedCanApply` from `gate-residual.ts`. Add `public declare gateOverride`. Keep every
  short-circuit: the order of the clauses is the order of the random draws and of the side effects. The split is the
  only edit a batch may make to a class, and it must be a pure move of code. See the three Tier B classes' diffs in
  the commit "Add the ten golden precedent declarations" (`git log --grep 'golden precedent'`).
- **Tier C** (atomic): one block with typed params, guards bundled, extra IFs can only be ANDed on top.

A clause is exactly one of: a **condition** (a rule staff may change: below 50% HP), a **guard** (a rule whose removal
is a bug: not while fainted), **feasibility** (the effect cannot happen: a switch target exists, `canSetStatus`), an
**RNG draw**, or **effect-side** code. When unsure, ask "if staff removed this, would players call it a different
ability, or would the game break?" Different ability = condition. Break = guard.

## 4. Per-class checklist (spec section 6, as it played out here)

1. Read the class, its bases, every user (`~/er-probe/attr-inventory.json`) and every dispatch call site.
2. Dump the live instances. Do not trust the source text of a closure: the game mutates and wraps attrs after
   construction (`ab.attrs.push(new ...)`, multipliers rewritten, `addCondition`). The quickest honest dump is a
   throwaway vitest that loops `allAttrSites()` and prints `String(closure)` plus the fields; delete it afterwards.
3. Pick the WHEN (`vocabulary/when-registry.ts`). None fits: write it in `requests/Bnn.md`, do not invent one.
4. Classify every clause (section 3). Write the exact expression and the source line in the atom or guard you map it to.
5. Map each condition to an atom that calls the SAME engine predicate (`isFullHp()`, `doesFlagEffectApply`,
   `hasActiveGravity()`, ...), or request one. If it cannot map, `bindLegacyClosure` with a reason of at least ten
   characters that says what is missing.
6. Keep clause order and write down every random draw in `flags.rngOrder`.
7. Write the declaration: params with ranges (`path` on every param so a live instance can be read back), conditions,
   guards, feasibility, effect, `reusableAlone`, `flags`, `probes`, `notes`. Labels, summaries, synonyms (3 or more) and
   examples must not show the class name.
8. Write every binding.
9. Run the tests of section 6. Read the L2 trace diff by eye when it fails. Run a mutation: break one binding on
   purpose and watch L1 fail (see pitfall 14).
10. Set `status: "decomposed"`. A second agent reviews and sets `verified`, with `notes` saying who checked what.

## 5. Vocabulary notes you will want

- `{ all: [] }` is an always-true condition (`() => true`).
- `hp.crossed-below` has two roundings that are NOT interchangeable: `exact` is Wimp Out's float test with the Shell Bell
  term, `floor-half` is Berserk's `hp <= floor(max * r) && hp + damage > floor(max * r)`.
- `hp.at-most` with `exact` is `hp * 100 <= maxHp * pct`. For a whole-number percent it equals a float
  `hp / maxHp <= pct / 100` (proved over every HP of several max-HP values in `precedents/branches.test.ts`), so it is
  the faithful atom for classes that compare a ratio. Do not use it for a non-integer percent.
- `time.once-per` with scope `wave` reads and writes `pokemon.waveData.entryEffectsFired` with the plain key, the same
  Set the ER once-per-wave archetypes use (berserk-on-threshold, self-switch-on-stat-lower, entry-effect,
  time-limited-effectiveness-floor, party-recovery). A class that keeps its own flag in that Set and its library form
  therefore share one memory, which is what makes the rebuild identical. The other scopes use a WeakMap keyed by
  `battleData`. Writes wait until the rule applies and never happen when simulated.
- `rng.chance` evaluates at the position you put it in the list and answers true without a draw when `simulated`.
  Put it exactly where the original drew.
- `field.gravity` is `arena.hasActiveGravity()` (the tag AND not suppressed), not the bare tag.
- `tag.has` takes the `BattlerTagType` name. `GroundedTag` is `IGNORE_FLYING`.
- Atoms added by the precedents: `time.acted`, `mon.opposite-gender`. Guard added: `not-fainted`.
- For defending hooks the frame's `holder` is the target and `other` / `moveUser` is the attacker. `mon.has-type` with
  `who: "other"` is `attacker.isOfType(...)`.

## 6. How to run it

```
# L0 lint, fast, every commit
npx vitest run test/tests/elite-redux/decomp/harness/l0-lint.test.ts
# L1 over the state grid (about 30 s)
DECOMP_CLASSES=Foo,Bar npx vitest run test/tests/elite-redux/decomp/harness/l1.test.ts
# L2 battle twins (one ability per distinct param signature, a few minutes)
DECOMP_CLASSES=Foo,Bar npx vitest run test/tests/elite-redux/decomp/harness/l2-twin.test.ts
# your own probes
npx vitest run test/tests/elite-redux/decomp/Bnn
# coverage ratchet (raise it only after real progress)
ER_WRITE_COVERAGE=1 npx vitest run test/tests/elite-redux/decomp/harness/coverage.test.ts
```

Run one vitest process at a time. Strip colours from a log with `sed 's/\x1b\[[0-9;]*m//g'`.

Probe axes you may use (`KNOWN_AXES`): `hp`, `foeHp`, `foeMove`, `weather`, `status`, `stage`. HP values are `"max"`,
`"max-1"`, a number, or `"50%"`, `"50%+1"`, `"50%-1"`. L1 uses EVERY hp value you list; L2 takes the first six
combinations of a probe (so put the boundaries first).

## 7. Pitfalls we hit (so you do not)

1. **An `hp: 1` probe kills the holder in L2.** The enemy's Tackle faints it and the run ends in GameOver
   ("did not reach its target ... GameOverPhase"). L1 already tries 1 HP for every grid; keep 1 out of L2 probes of
   hit-driven WHENs (or make sure it is past the first six combinations).
2. **A typo in an `attrIndex` shows up as two lints**: "bound, but X has no declaration" and "ctor:0 has neither a
   binding nor a legacy-closure note". Ominous Shroud has the class at attr 0 under one id and attr 2 under another.
3. **Attr-level conditions (`AbAttr.addCondition`, set by composed abilities and upgrades) are not constructor
   arguments.** `recomposeAttr` copies `extraCondition` onto the rebuild; without that, Unlocked Potential and Going
   Berserk came out `different` in the L1 identity check (`hasCondition`).
4. **The same predicate, not a lookalike.** Levitate's closure uses `arena.hasActiveGravity()`, which also checks
   suppression. The first `field.gravity` used the bare tag and would have drifted under Clueless. Read the engine
   function the closure calls and make the atom call it.
5. **Do not give a class a param it cannot read back.** `path` is how the harness reads the live value; a param without
   one is an L0 failure unless it is in `fixedCtorArgs` (for example `showAbility`).
6. **Optional closures**: set `optional: true` on the slot and `path` to the field. A user whose field is `null` then
   needs no binding; do not bind a fake "always true".
7. **Options-object constructors** (`new X({ a, b })`): give every param the same `ctorIndex` and its own `ctorOption`.
8. **Rest-argument constructors** (`constructor(chance, ...effects)`): `spread: true` with a list codec.
9. **Booleans that mean two things** (`formAboveThreshold`) become a `select` with a codec so staff read words.
10. **A param repeated as a literal in a gate binding** (Wimp Out's `hpRatio` and its gate's `ratio`, Static's
    `chance` and the gate's `pct`, Ape Shift's `threshold` and `pct`, `formKey` and `key`): list it in the
    declaration's `gateParams` (`{ param, block, field, scale? }`). `recomposeAttr` then writes the live param into
    that field of every matching atom in the bound gate, so a moved slider moves the compiled gate. L0 refuses an
    editable param of a gated class that is neither in `gateParams`, nor `gateIndependent: true` (only the effect
    reads it), nor `editable: false` (HpThreshold's `direction`, which changes the SHAPE of the gate).
    `test/.../precedents/gate-params.test.ts` proves it for the three classes. A param that changes the gate's shape
    cannot be a `gateParams` entry; make it non-editable.
11. **`simulated`**: record what the class really does (`"ignores"` for the PostDamage and contact-status classes).
    Where the atom and the class differ for simulated calls, say so in `notes`; do not paper over it.
12. **Flags and engine queries are never dispatched**, so no trace event shows them "evaluated". The L2 harness treats a
    declaration whose WHEN has no dispatch key as presence-only: it compares the whole battle (template
    `while-active-flags`) and skips the "was this attr evaluated" check.
13. **A scenario must be able to reach the trigger.** The L2 template of `event.after-taking-damage` keeps a teammate
    ready and answers the switch prompt, otherwise Wimp Out is evaluated but can never switch.
14. **Prove the proof.** Change one binding on purpose (a threshold, a clause order, a `rounding`) and confirm L1 or L2
    goes red. Every precedent was mutation-checked this way; do the same for yours.
15. **State your grid cannot reach** (a form the holder does not have, memory that needs two hits) is proven in your own
    test with a stand-in or by driving the attr directly. See `branches.test.ts`, `memory.test.ts`, `rng-order.test.ts`.
16. **Hook formatting**: `.ls-lint.yml` allows PascalCase file names under `decl/` only. `lint/style/noDefaultExport`
    warnings on `*.decl.ts` are expected (the registry needs default exports) and are not errors.
17. **Do not list a precedent's behaviour as yours.** Subclasses (`EffectSporeAbAttr`, `ReceivedTypeDamageMultiplierAbAttr`,
    the archetype reductions) are separate classes with their own declaration even when they call `super.canApply`.
18. **A grid with one max HP hides rounding bugs.** `floor(max / 2)` and `max / 2` only differ for an EVEN max HP, and the
    default holder's is odd, so a Berserk binding with the wrong `rounding` passed L1 until the grid also ran at max HP 100
    and 101. The grid now does; keep boundary probes (`"50%"`, `"50%-1"`) in your `probes` so they exist at every size.
19. **L1 is memory hungry** (about 4 GB near the limit). If a bigger grid dies with "heap out of memory", reduce states
    or run with `NODE_OPTIONS=--max-old-space-size=8192`; do not retry in a loop. Set a long test timeout (the live
    differential has 10 minutes).
20. **L2 skips attrs that cannot be rebuilt** (legacy-closure or unbound): an ability whose only declared attr is legacy
    has nothing to twin and is left out instead of failing.
21. **Foe moves in L2 probes must be able to hurt the holder**: the default holder is a Normal type, so Ghost moves do
    nothing, and abilities with their own immunities (Prismatic Fur) never reach a calc hook for Normal, Ground or
    Electric moves. Use Water Gun, Bite and Ember for damage-calc classes.

## 8. What a finished class looks like to the gates

L0 clean (labels, synonyms, ctor indices, requires within provides, every closure bound or marked legacy); L1 identical
for every attr of every user and equal over the grid, draws included; L2 one twin per distinct param signature with the
original shown to evaluate the rebuilt attr; `notes` that say who reviewed what; the coverage ratchet did not fall.


## The catalog your declaration feeds (editor, worker, AI)

Every declaration you commit shows up, with no extra work, in three generated files and in the AI builder:

| File | What it holds |
| --- | --- |
| `editor/data/vocabulary.json` | The pure vocabulary (triggers, conditions, effects, safety rules, slots) and its hash. |
| `editor/data/blocks.json` | One entry per declaration: label, summary, synonyms, examples, params, conditions, guards, `gateParams`. The block id is `blockIdForClass(className)`, for example `block.post-damage-force-switch`. |
| `editor/data/instances.json` | One entry per declared `(abilityId, attrIndex)`: block id, live param values, bindings, coverage bucket. It also lists the classes that have no declaration yet (reported, never an error). |

The AI container (`workers/er-ability-ai/container`) searches `vocabulary.json` and `blocks.json` by label, synonyms and
examples first, so **your synonyms and examples are what lets staff find your block**. Write them in staff words ("eject",
"half damage"), never class or ability names. The editor worker validates `composition` with the same validator
(`vocabulary/validate-core.ts`) against the bundled `vocabulary.json`.

Regenerate after you add or change a declaration (it writes only the catalog, nothing else in `editor/data`):

```
ER_WRITE_CATALOG=1 npx vitest run test/tests/elite-redux/tools/dump-catalog.test.ts
```

`test/tests/elite-redux/decomp/catalog.test.ts` fails when `blocks.json` or a container copy no longer matches the live
declarations, and when the bundled vocabulary hash differs from the one the game computes. Commit the regenerated files
with your batch. If two batches both regenerate, resolve the conflict by regenerating, never by hand.

`test/tests/elite-redux/decomp/ai/` is the AI regression set (the four audited failures plus staff phrases). It does not
need a declaration from you, but when you add a vocabulary entry that a phrase should use, add the phrase there.
