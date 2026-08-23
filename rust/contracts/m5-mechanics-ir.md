# M5 mechanics IR

## Invariants

The IR is immutable data. It cannot execute callbacks, call platform APIs, name Rust functions, use dynamic dispatch, or contain untyped JSON. Every node and operation is closed, versioned, bounded, serializable, and valid on native and Wasm.

## Program budgets

Each program declares limits no greater than the pack ceiling:

| Resource | Program ceiling |
|---|---:|
| Hook bindings | 64 |
| Condition nodes | 256 |
| Selector nodes | 128 |
| Value nodes | 256 |
| Operations | 256 |
| Maximum condition depth | 32 |
| Maximum selector depth | 16 |
| Maximum selected targets | battle format field capacity plus party capacity |
| RNG draws per invocation | 64 |
| Spawned mechanic instances | 64 |
| Presentation cues | 128 |

A validator walks every arena iteratively, detects cycles, verifies reachability and references, and rejects a declared budget above the ceiling. Runtime decrements the declared budget and fails the staged transaction if compiled code exceeds it.

## Conditions

`ConditionArena` is an indexed DAG. Nodes include constants; boolean composition; source/target identity and side; HP, PP, level, turn, wave, hit and counter comparisons; move type/category/flag/target; status/volatile/ability/item presence; grounded/adjacent/active/fainted state; weather, terrain, side and arena conditions; stat-stage comparisons; effectiveness/result checks; first/last/ordinal predicates; and an explicit chance node.

Chance is the only condition node that draws RNG. It carries `RngReason`, numerator, denominator, and stream. Invalid numerator/denominator or an unavailable stream is a validation error. No unsupported condition evaluates to false as a fallback.

## Selectors

`SelectorArena` is an indexed DAG. Nodes select self, actor, target, command target, attacker, last attacker, ally/foe sides, field slots, active battlers, party, bench, source owner, mechanic owner, or an explicit stored target. Combinators filter active/fainted/adjacent/grounded/type/status/tag, union, intersect, stable distinct, stable sort, first, all, and random one.

Every multi-target selector defines canonical ordering before `RandomOne`. Random selection consumes exactly one draw only when the candidate count is greater than one unless the oracle hook explicitly consumes for a singleton.

## Values and exact arithmetic

Values are signed safe integers, unsigned safe integers, booleans, IDs, exact ratios, query inputs, state fields, and bounded arithmetic nodes. Ratios have signed numerator and positive nonzero denominator. Evaluation uses checked integer operations and explicit JavaScript-compatible conversion nodes at frozen rounding points.

No evaluator uses saturating arithmetic, FMA, algebraic reassociation, or implicit float serialization. An operation that requires JavaScript `Number` uses the existing `js_math` functions and records the exact conversion point.

## Queries

Query types are closed and carry a matching accumulator type. Modifier forms are `Set`, `Add`, `MultiplyRatio`, `Minimum`, `Maximum`, `Cancel`, `ReplaceType`, `ReplaceCategory`, `ReplaceTarget`, and closed domain-specific results. The program validator rejects a modifier that does not match its query accumulator.

Query evidence records source address, hook, program and operation ordinal, before value, modifier, after value, and whether a condition rejected the operation.

## Operations

Trigger operations include:

- HP damage/heal/set and recoil/drain relationships;
- PP consume/restore/set;
- major status apply/cure and status counters;
- stat-stage change/reset/copy/invert;
- mechanic-instance create/update/remove/transfer with typed state;
- weather, terrain, side, arena, battler, and positional state changes;
- field switch, forced switch, pivot, replacement and target redirection requests;
- item consume/transfer/remove and lifecycle flags;
- move/action cancellation, retry, additional hit and scripted closed move request;
- presentation cue emission.

Every operation declares legal hook classes and selector cardinality. State mutation happens only in the staged executor. Operations never mutate presentation or protocol state directly.

## Source collection and ordering

The executor collects sources into `OrderedMechanicSource` values. The sort key is:

1. frozen hook source-class rank;
2. side rank and field position;
3. active ability before stored passive slot order;
4. held-item stable inventory order;
5. major status then volatile creation order;
6. weather/terrain/side/arena creation order;
7. source ordinal;
8. program ID;
9. hook ordinal;
10. operation ordinal.

A family contract may define a narrower source-class order for one hook, but may not rely on map iteration. The complete ordered source list is transition evidence.

## Bespoke mechanics

A bespoke mechanic is a closed enum value implemented in one central exhaustive match. It uses the same context, transaction, RNG audit, mutation evidence, presentation policy, and budgets as compiled programs. It cannot mutate live state directly. The bespoke manifest records source identities, justification, implementation symbol, tests, and removal/admission status.
