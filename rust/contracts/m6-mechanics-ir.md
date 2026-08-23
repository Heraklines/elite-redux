# M6 Mechanics IR V2

## Invariants

IR V2 is immutable, bounded, closed, serializable data. It cannot contain or execute callbacks, source text, arbitrary function names, dynamic trait objects, embedded scripts, untyped JSON, platform APIs, filesystem/network/wall-clock/thread handles, or renderer state.

Every program names all owned `BehaviorUnitId` and `RngSiteId` values. The validator proves exact ownership, reachability, type compatibility, ordering, and budgets before content becomes prepared.

## Hooks and source order

Hooks cover battle load/start; command/action selection; before/after switch and summon; move target, priority, speed, accuracy, critical, power, offensive/defensive stat, effectiveness and damage queries; before/after hit and move; status/tag/item changes; faint/replacement; turn end; weather/terrain/side/arena changes; and scheduled event delivery.

The total source key is:

```text
hook stage
→ authored priority
→ source class rank
→ side and field position
→ active ability then passive slots 0..2 then runtime-extra source ordinal
→ held-item inventory order
→ status/tag/field creation ordinal
→ behavior-unit ordinal
→ stable source identity
→ program, binding, operation ordinal
```

No map iteration or Rust type discovery affects order.

## Conditions V2

V2 retains the V1 DAG and adds typed predicates for:

- ability source kind, passive slot, suppression and unlock;
- held-item state, stack, consumed/preserved/transferable flags and item locks;
- mechanic-instance kind, counter, remaining duration, creation ordinal and owner;
- substitute/proxy state;
- charge/recharge/action lock;
- protect/endure/guard chain;
- trap/pivot/redirect state;
- scheduled-event presence and due turn;
- transform/illusion/form/stance/Mega/Tera overlay;
- move copy/call history and special-damage counters;
- topology capacity, slot adjacency, ally/enemy relation and occupant identity.

Chance remains the only generic condition that draws RNG. It names a declared RNG site. A false condition consumes no later draw.

## Values and queries V2

Values include safe signed/unsigned integers, booleans, exact ratios, typed IDs, topology slots, source/behavior identities, mechanic-instance fields, query input, and explicit JavaScript-number operations.

JavaScript-number operations preserve authored operation and rounding order. No FMA, fast-math, reassociation, saturating fallback, non-finite state, or implicit float serialization.

Query accumulators are closed. Modifier forms include set, add/subtract, multiply/divide exact ratio or JS-number operand, min/max/clamp, cancel, allow/deny, replace type/category/target, ordered target-set transformation, and domain-specific typed values. A query cannot mutate state or schedule events.

## Selectors V2

Selectors return ordered vectors and include:

- actor, source, target, command target, last attacker;
- explicit side/field/party slots and current occupant;
- active, bench, fainted and healthy Pokémon;
- adjacent allies/enemies under explicit topology;
- mechanic owner/target and stored source identity;
- scheduled-event owner/target;
- stable filter, union, intersect, distinct and sort;
- first, last, ordinal, all and audited random one;
- target promotion and explicit redirect replacement.

`RandomOne` names an RNG site and draws only under the site's frozen singleton policy.

## Operations V2

V2 operations cover:

- HP damage/heal/set, substitute/proxy damage, recoil/drain and special-damage counters;
- PP consume/restore/set and move usability;
- status apply/cure/counter and volatile/tag lifecycle;
- stat-stage change/reset/copy/invert;
- ability suppression/restore and passive-source lifecycle;
- held-item create/stack/consume/preserve/transfer/remove and berry ledger;
- weather, terrain, side, arena and positional state;
- charge/recharge/action locks and protect/endure/guard chains;
- field switch, forced switch, pivot, trap and redirect requests;
- transform/illusion/form/stance/Mega/Tera overlay apply/clear;
- move copy/call/selection with closed candidate sets;
- mechanic-instance create/update/remove/transfer;
- scheduled-event create/cancel/deliver;
- presentation cue emission.

Operations stage typed mutations. They never mutate live state, protocol state, UI state, or presentation state directly.

## Scheduled events

A scheduled event has stable ID, source behavior unit, owner/target, creation ordinal, due turn and hook, typed payload, cancellation policy, and RNG-site bindings. Events sort by due turn, hook stage, creation ordinal, and stable ID. Delivery is part of the atomic transition; an event cannot be lost between state and scheduler.

## RNG bindings

Every battle-mechanical draw is bound to one catalog RNG site with closed domain, reason, stream, range semantics, singleton policy, and behavior-unit owner. `Math.random` sites classify as forbidden until proven non-mechanical or replaced by a deterministic boundary.

No unsupported path may consume a draw. Evidence reports the first divergent site, reason, range, result, and before/after fingerprints.

## Budgets

V2 keeps explicit per-program ceilings and adds scheduled events and topology expansion. Pack validation also enforces aggregate ceilings per source, hook, turn, and battle. Exceeding a budget aborts staged execution; it never truncates operations or targets.

## Bespoke mechanics

A bespoke mechanic is a closed enum implemented by one central exhaustive dispatcher. It receives the same typed context, selectors, query API, staged operations, RNG-site bindings, budgets, evidence, and validation as compiled programs. It cannot directly mutate live state.

G24 requires zero pending bespoke gaps and zero unsupported reachable battle content. A bespoke implementation remains acceptable where a declarative program would obscure state or ordering, provided its exact source/behavior-unit mapping and witnesses are frozen.
