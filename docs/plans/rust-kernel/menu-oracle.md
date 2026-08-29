# Rust kernel menu oracle

This is a pinned source inventory for project `PokéRogue Redux`, task `M0-0B`
(`Rust kernel menu oracle`). It records gameplay UI/menu behavior from game SHA
`3b534099919efae827019d4a3f3c4ab0ecd6d67b` under protocol `er-coop-47`. The
JSON companion is
[`schemas/kernel/source/menu-behaviors-v1.json`](../../../schemas/kernel/source/menu-behaviors-v1.json).

The record is an observation of the TypeScript source. It does not design Rust
types, rename modes, or normalize callback ownership.

## Inventory

The requested `src/ui/handlers/**/*.ts` glob contains 72 tracked files:

- 60 concrete `UiHandler` subclasses are represented in `handler_behaviors`.
- 12 abstract bases, render/input helpers, or debug helpers are explicit
  exclusions in `source_files.explicit_exclusions`.
- `src/ui/settings/*.ts`, `src/ui-inputs.ts`, `src/enums/buttons.ts`,
  `src/enums/ui-mode.ts`, and `src/ui/ui.ts` are direct dependencies because
  they determine cursor routing, mode ownership, actionability, and transitions.
- `ShowdownSyncCommandUiHandler` is only a registry reference outside the
  requested handler glob and is not given an invented record.

The JSON arrays are sorted where they represent file/class inventories. Each
handler record contains the source path, source-observed menu classification,
cursor and wrapping behavior, disabled-option behavior, submit/action behavior,
cancel/back behavior, transitions, owner source, actionability source, and
dependencies.

## Source-observed menu equivalents

The JSON classifies source behavior as Message, Confirm, ChoiceList-like,
Command, Replacement, Interaction, Waiting, or Terminal. These labels are
descriptive groupings only; they are not Rust proposals. The important source
distinctions are:

- Message prompt acceptance is separate from ordinary cursor input. The
  inherited Message predicate is exactly `active && isAwaitingPromptAction()`,
  while several Message-derived screens implement their own local cursor-grid
  `processInput` paths.
- Abstract option lists skip options, optionally delay input, wrap among
  unskipped choices, and use the final unskipped option for CANCEL unless
  `noCancel` is set.
- Command and replacement screens delegate accepted actions to phase callbacks;
  their button meanings are not global.
- Egg hatch is a plain UiHandler: ACTION/CANCEL first try the current
  `EggHatchPhase.trySkip()` and then delegate to the active Message handler.
- ER map picker selects only revealed nodes and has no cancel branch. ER bargain
  and Mystery Encounter have explicit timer/block/phase ownership gates.
- Modal/form and Showdown editor screens may route input through DOM focus,
  pointer callbacks, or nested set/team state rather than a Phaser cursor.

## Ownership and actionability

`src/ui/ui.ts` is the mode-indexed ownership registry and transition authority.
`src/ui-inputs.ts` is a routing layer: touch tries SUBMIT then ACTION, MENU and
cycle buttons use mode/handler whitelists, and fallback paths may open overlays
or settings. The active phase/opener callback owns most accepted gameplay
actions after a handler returns true.

Two registry constructor mismatches are retained exactly as source observations:

1. `ModifierSelectUiHandler` is in the `MODIFIER_SELECT` registry slot but calls
   `super(UiMode.CONFIRM)`.
2. The `POKEDEX_SCAN` registry slot constructs `PokedexScanUiHandler` with
   `UiMode.TEST_DIALOGUE`.

The JSON also preserves the ModifierSelect readiness/actionability mismatch,
the exact MessageUiHandler predicate (`active && isAwaitingPromptAction()`)
separately from each subclass's local `processInput` guard, async state, timer
guards, DOM capture, and co-op/transport ownership as unresolved dynamic
behavior. Plain UiHandler delegation (including EggHatch's phase/message path)
is not classified as Message actionability. No contradictory global
serialized-button meaning was observed; differing meanings are scoped to the
active source handler/mode.

## Verification scope

The worker checks are intentionally static and data-only. No local co-op Vitest
file or co-op gate is run. The required checks are:

1. Parse the JSON with the pinned Node runtime.
2. Enumerate tracked handler files and compare the exact inventory against the
   JSON, reporting the 12 explicit exclusions.
3. Run `git diff --check`.
