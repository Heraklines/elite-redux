/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 2. "The first time I enter, open a named timed window" (the first half of Forewarn's two-turn Soothsayer shield).
//
// Source: src/data/elite-redux/archetypes/time-limited-effectiveness-floor.ts, ActivateOncePerBattleEntryWindowAbAttr (extends
// PostSummonAbAttr). Constructor: `(key)`, a non-empty name; `super(true)`. Clauses, in the original order (Tier B):
//   canApply  `!pokemon.waveData.entryEffectsFired.has(key)`                              GATE (replaceable): the window was not opened yet
//                                                                                         in this wave
//   apply     skipped when `simulated` OR when the key is already present (second guard, same test as the gate); then
//               1. `pokemon.waveData.entryEffectsFired.add(key)`                 remember "opened" for the rest of the wave
//               2. `pokemon.tempSummonData.abilityEntryWindows.add(key)`         open the window (reset when I switch out)
// The window is read by TimeLimitedEffectivenessFloorAbAttr (its `activeWindowKey`). No random draw.
//
// Tier B and package for the effect only: no library effect opens a named window (request R-B12-15) and no atom reads one (R-B12-16).
// The trigger is the shared WHEN and the gate is the replaceable condition; the key is a typed setting.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { ActivateOncePerBattleEntryWindowAbAttr } from "#data/elite-redux/archetypes/time-limited-effectiveness-floor";

export default defineDecl(ActivateOncePerBattleEntryWindowAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.on-entry",
  label: "Open a timed window the first time I enter",
  summary: params =>
    `The first time I enter in a wave, a window named "${params.key}" opens for as long as I stay out. Other abilities can check for that window. It does not open again in the same wave.`,
  synonyms: [
    "entry window",
    "first entry only",
    "start a timer on entry",
    "open a time window",
    "once per wave on entry",
    "temporary shield window",
    "forewarn",
  ],
  examples: ["The first time I enter, start a window that a shield ability can use, like Forewarn"],
  params: [
    {
      id: "key",
      ctorIndex: 0,
      path: "key",
      control: "text",
      label: "Name of the window (any short text; abilities that read the window use the same name)",
      editable: true,
      default: "entry-window",
    },
  ],
  // The name is also the memory key of the gate (the library once-per atom), so a moved setting must move the gate's key.
  gateParams: [{ param: "key", block: "time.once-per", field: "key" }],
  conditions: [
    // The gate: "the window has not been opened in this wave yet". The library once-per atom (wave) reads and writes the same set,
    // but writes BEFORE this class's apply runs, which then returns early; see notes. Legacy-closure until R-B12-15 exists.
    { slot: "gate", ctx: "params", lib: "time.once-per", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Nothing happens when the game only previews the move",
    "The window closes when I leave the field and cannot reopen in the same wave",
  ],
  effect: { id: "effect.package", params: ["key"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [{ name: "first entry, then a second entry in the same wave", axes: {} }],
  l2StaticReason:
    "The only user's gate is a legacy-closure, so the shared L2 has no rebuilt attr to twin. B12's own test (B12/chunk2.test.ts) drives the original attr through two entries, a simulated entry and a gate replaced by the library once-per atom.",
  status: "decomposed",
  notes:
    "legacy-closure-pending-request. Package for the effect only: opening a NAMED window (an entry-local flag in `tempSummonData.abilityEntryWindows` that resets on switch, plus the per-wave 'already opened' memory) has no library effect (R-B12-15) and the window has no reading atom (R-B12-16: `time.in-entry-window{key}`). 1 attr: Forewarn (108 attr 1, key 'upgrade:forewarn:two-turn-soothsayer', the shipped upgrade that gives Forewarn a two-turn Soothsayer; attr 0 is EntryEffectAbAttr, attr 2 TimeLimitedEffectivenessFloorAbAttr). The gate is `canApply` moved into `gate` (Tier B split, pure move of code). Its natural library form is time.once-per { wave, key }, which reads and writes the same Set (`waveData.entryEffectsFired`), BUT the carrier writes the key right BEFORE this class's `apply` runs, and `apply` returns early when the key is already present, so the window would never open (a test in B12/chunk2.test.ts proves it). So the user's gate stays a legacy-closure until the library offers either the window effect (R-B12-15) or a once-per whose write waits until after the effect. Oddities, not fixed: (a) the name says 'once per battle' but the memory is `waveData`, which is reset every wave, so the window opens once per WAVE; (b) `apply` re-tests the key although the dispatcher already ran `canApply`, which is harmless but is what makes the library atom unusable; (c) a simulated call neither opens the window nor remembers the key.",
});
