# M6 RNG site inventory and ordering

Oracle SHA: `3bb6d49c924293ef79e3ab2f11e10cf4f5b9c6c7`.

## Raw inventory

The pinned static catalog records 250 RNG call sites with exact source path, line, column, callee, and source arguments. The inventory includes both battle mechanics and non-battle run systems. Presence in this inventory is not permission for the battle core to call process-global RNG.

Observed callees include battle-substream calls such as `pokemon.randBattleSeedInt`, generic seeded helpers such as `randSeedInt`, item/shuffle helpers, and five direct `Math.random` sites. Direct `Math.random` is an architectural gap until proven non-mechanical or replaced at a closed deterministic boundary.

## Required site identity

```text
oracle SHA
+ normalized source path
+ line and column
+ call expression
+ ordinal within source file
+ provenance hash
```

Line/column are diagnostics; provenance hash and source ordinal prevent two same-line calls from collapsing.

## Domain classification

Every site must be assigned exactly one closed domain before support:

- `BATTLE_MECHANICAL`;
- `BATTLE_POLICY`;
- `RUN_MECHANICAL`;
- `PRESENTATION_ONLY`;
- `TEST_ONLY`;
- `FORBIDDEN_NONDETERMINISTIC`.

`BATTLE_POLICY` covers scripted or AI choice that is part of the canonical command input but is not a battle formula. A `PRESENTATION_ONLY` site must be proven unable to affect mechanical state, protocol material, control, or later RNG frontier.

## Draw reason classification

Battle-mechanical sites use a closed reason, including:

- accuracy;
- critical hit;
- damage variance;
- speed tie;
- multi-hit count;
- secondary effect;
- target selection;
- move selection;
- ability chance;
- item chance;
- status or volatile behavior;
- form or transform behavior;
- source-identified bespoke mechanic.

The bespoke reason carries a `BehaviorUnitId`; it is not an arbitrary string. This preserves exact replay identity while the behavior is closed during M6C.

## Ordering rules

- Each behavior unit declares its RNG sites in execution order.
- Selector candidates are stably ordered before an index draw.
- Rejected conditions, invalid commands, illegal targets, immunities, and disabled sources consume no downstream draw.
- Query and mutation stages may draw only at a declared site.
- Run and battle streams remain separate.
- Native and Wasm compare every draw, not only the final state.

## Witness requirement

Static classification is provisional until a focused oracle witness reaches the site and records the before state, range, result, after state, behavior-unit identity, and enclosing hook. If the source RNG state changes without a recorded site, fixture generation fails.
