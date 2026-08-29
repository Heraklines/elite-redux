# M7.1 causal evidence and diagnostic digest audit

## Existing provenance

M7 battle transitions/material already carry mechanics behavior unit, program, hook, operation ordinal, mutation, presentation, and RNG evidence. Run execution carries behavior, run program, hook, operation ordinal, and operation. Authority materials carry operation identity, revision, before/after digest, material digest, control, and presentation. Kernel/protocol snapshots retain timer, proposal, recovery, connection, pending material/control, and terminal ownership.

The developer plane must adapt these records. It must not rerun mechanics, parse presentation text, or infer source from stack traces.

## Missing first-class attribution

The following currently fold into larger evidence records and need causal nodes/edges: kernel internal events, query/selector results, presentation settlement, timer creation/firing, network queue/delivery, storage request/result, recovery fences, terminal installation, model request/response, and adapter render/platform evidence.

## Deterministic causal address

```text
session root
external event sequence
operation ID or material digest
evidence kind
ordinal path
```

The canonical BLAKE3 preimage is versioned and encoded by `er-canonical`. IDs do not depend on retained evidence profile. Pair endpoint and environment identity are explicit ordinal segments, not random salts.

Required closure:

```text
unattributed selected-campaign mutations = 0
duplicate causal IDs = 0
dangling edges = 0
```

## Frozen mechanical digest

The M7 mechanical digest and material before/after digests remain opaque and unchanged. M7.1 adds a separate diagnostic root.

Major state paths:

```text
profile
run
run.party / pokemon(id)
run.storage / storage-slot(id)
run.inventory / item(id)
run.modifiers / modifier(id)
run.world
run.scenario
run.progression
run.battle
battle.field / field-slot(side,position)
battle.mechanics / mechanic-instance(id)
battle.rng
protocol
ui
input
scheduler
presentation
terminal
```

Full profile may add typed leaf segments for HP, status, stages, moves, abilities, ownership, counters, material/control frontiers, timers, and queued effects. Player/Agent profiles expose none of the hidden digest tree.

## Localization

Nodes are sorted by typed path. Each node hashes a domain/version, path, canonical local value, and sorted child digests. Diff first compares diagnostic roots, then descends mismatching children until the deepest available mismatch under the requested node/byte budget. It returns all retained mismatches plus `truncated`; no string-path parsing is allowed.

## Required tests

* causal IDs identical across None/Causal/Full and native/Wasm;
* exact source attribution for battle, run, Authority, terminal, timer, network, and storage chains;
* one-field test mutation localizes to the smallest typed path;
* diagnostic tree creation never changes mechanical digest/material/save/RNG/control;
* bounded graph/tree truncation is deterministic;
* presentation nodes derive from material/core causes;
* no duplicate or dangling identity survives validation.
