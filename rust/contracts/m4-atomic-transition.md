# M4 atomic transition contract

One external `KernelInput` enters the deterministic FIFO and runs internal work to quiescence under an M4-specific event budget.

## Transaction owner

`RunKernelTransaction` clones game, protocol, scheduler, UI, input router, terminal, pending presentations and barriers, and pending effects. Pure `er-run` work executes only against the clone.

## Commit order

1. Validate external input, seat, menu instance, surface address, ordinal, and proposal fingerprint.
2. Clone deterministic live owners.
3. Preflight the complete progression/surface/encounter transition, including unsupported content and evolution.
4. Execute pure mechanics and explicit RNG draws on the clone.
5. Construct typed material and all evidence.
6. Canonical encode, canonical decode, and compare the decoded material to the prepared candidate.
7. Apply decoded material through the common production applier.
8. Prepare the Authority entry without mutating the live log.
9. Install exact logical control and allocate every timer on the clone.
10. Validate state, protocol, UI, scheduler, digests, counters, resource ownership, and the prepared entry.
11. Publish the prepared entry into the cloned Authority log. Publication allocates the exact revision and stages retention, local receipts, outbound delivery, and presentation effects in that order; no external effect is released yet.
12. Validate the published cloned owner graph and require its revision, retained entry, control, timers, and staged effects to match the prepared evidence.
13. Swap the complete clone into the live kernel.
14. Emit staged external effects in preserved order.

Any error before step 13 discards the clone. No revision, retained entry, receipt, delivery, RNG cursor, money, EXP, level, modifier, surface, biome, encounter, timer, menu, presentation, or effect escapes. A publish failure cannot burn a revision.

## Failure injection

The hosted atomicity suite injects at progression preparation, modifier application, RNG generation, material encode/decode/apply, log prepare, log publication, receipt staging, delivery staging, control projection, timer allocation, and both final validations. Every case proves complete live-owner equality and zero leaked effects.

## Internal events

M4 adds typed internal events for battle settlement, wave advance, progression, surface open/action, and encounter preparation. Encounter generation plus `BattleStartV2` is folded into the same prepared run transition and Authority material that closes the predecessor boundary; it never receives a second revision. Internal events never cross the simulator/browser boundary and never contain callbacks.

## FIFO dispatch

The exact event payloads are declared in `m4-api.md`. Dispatch order is:

| Event | Handler | Allowed ordered successors | Material |
|---|---|---|---|
| `Button` | input/UI reducer | zero or one `Ui` | none |
| `Ui` | game control reducer | zero or one `Game` | none |
| `Game` | game runtime | one prepared battle/run event or typed rejection | none |
| `BattleResolved` | transaction coordinator | `AuthorityEntryReady` | TURN/REPLACEMENT |
| `BattleSettled` | `er-run::settle_battle` | `RunPrepared` | none |
| `ProgressionAction` | `er-run::apply_progression_decision` | `RunPrepared` | none |
| `SurfaceOpened` | `er-run::open_run_surface` | `RunPrepared` | none |
| `SurfaceAction` | `er-run::apply_surface_action` | `RunPrepared` | none |
| `EncounterPrepared` | game runtime | `RunPrepared` with complete `BattleStateV2` | none |
| `RunPrepared` | transaction coordinator | `AuthorityEntryReady` | WAVE/INTERACTION/TERMINAL selected by evidence; the after-state may already be `RunStage::Battle` |
| `AuthorityEntryReady` | common canonical codec/applier | `MaterialInstalled` | exact prepared kind |
| `MaterialInstalled` | protocol/control coordinator | `ControlInstalled` | none |
| `ControlInstalled` | presentation coordinator | external effects only | none |
| `TerminalPrepared` | transaction coordinator | `AuthorityEntryReady` | TERMINAL |

A handler cannot enqueue an unlisted event, reorder successors, or process a successor recursively outside the FIFO. The queue is quiescent only when empty after control installation and staged effect creation. The budget is exactly 4096 internal events per external input.
