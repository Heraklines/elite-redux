<!--
SPDX-FileCopyrightText: 2024-2026 Pagefault Games

SPDX-License-Identifier: AGPL-3.0-only
-->

# Per-request triage (completes B19 section 8)

`LIBRARY-DECISIONS.md` section 8 says the librarian classified the unnumbered and table entries of B03, B04, B10, B11,
B14 and B16, and the tails of B13 to B18, by heading only. These files give every one of those entries its own decision
with evidence (file:line), read line by line on 2026-11-25 (one reader per file). Nothing was built: the
justified-unbuilt blocks are input for the completion pass, which rebinds legacy closures and wires effects.

| File | Entries | Implemented | Alias | Planned | Justified-unbuilt | Deferred | Rejected | Harness | Info |
|---|---|---|---|---|---|---|---|---|---|
| B03 | 67 | 17 | 3 | 4 | 9 | 12 | 11 | 9 | 2 |
| B04 | 48 | 5 | 4 | 4 | 9 | 10 | 3 | 7 | 6 |
| B10 | 63 | 8 | 3 | 4 | 12 | 13 | 18 | 4 | 1 |
| B11 | 65 | 7 | 5 | 3 | 18 | 6 | 13 | 9 | 4 |
| B13 | 80 | 7 | 2 | 4 | 7 | 5 | 48 | 2 | 5 |
| B14 | 94 | 16 | 10 | 3 | 17 | 11 | 20 | 7 | 10 |
| B15 | 50 | 10 | 1 | 0 | 3 | 15 | 19 | 1 | 1 |
| B16 | 55 | 12 | 2 | 1 | 5 | 5 | 7 | 0 | 23 |
| B17 | 45 | 11 | 5 | 5 | 8 | 3 | 8 | 2 | 3 |
| B18 | 45 | 3 | 3 | 0 | 9 | 18 | 5 | 5 | 2 |

Each file ends with "Disagreements with LIBRARY-DECISIONS.md" and a ranking of the justified-unbuilt blocks.

## Read before the completion pass rebinds anything

Several aliases and planned effects in `LIBRARY-DECISIONS.md` are NOT the same formula as the class; rebinding a class to
them would change battle behaviour (details and evidence in the file named):

- Shield Dust / IgnoreMoveEffects is not `effect.multiply-effect-chance` with 0: the effect skips Order Up and Electro
  Shot, the class does not (B10, B18).
- Two-Faced recoil (R-B13-24) can never faint the holder; `effect.hurt-percent-of-max-hp` can (B13). Overloaded's HP loss
  has the same problem while that effect writes `damageTaken` (B14 D7).
- Anneal (R-B13-15) is not a user of `effect.stat-stages` (B13).
- `effect.clear-weather` keeps extreme weather; the B04 classes clear it on purpose (B04 D2).
- Planned R21 / R34 effects as written would also wipe lowered stats / set instead of add the hit count (B17).
- Lingering Musk's marker is not in the memory `time.marker-set` reads (B17 R3).
- `party.ally-active` checks the first ally only; B14-5.8 asks for any active ally (B14 D5).
- Natural Cure / Regenerator stand-in effects do not match the class formulas (B04 D8); `effect.reset-stat-stages`
  expresses neither B03 class (B04 D9); `effect.add-type` cannot compile on Photovoltaic's entry trigger (B14 D3).

## Decisions B19 got wrong in the other direction (worth building)

- Marker memory (`time.armed`, `effect.set-marker`, `effect.reset-memory`) is the public `erAbilityProvenance` array that
  `time.marker-set` already reads, not private memory (B10, B14 D9, B16, B17).
- Several "single-user" rejections have 3-10 users: `effect.trap-foe` (6 attrs), `effect.drain-pp`, per-count power and
  accuracy (B13); R-B15-38 (6 users); weather/terrain turns R-B16-13/19 (10 and 5); B14 charge stacks (shared store).
- Engine moments rejected as "no dispatch site" that do have one call site (B15: 10 moments, Deferred not Rejected).
- Biggest gains by abilities that become fully decomposed: "move type is one of my types (+Tera)" 61 (B11);
  `effect.scripted-move` target choice ~46 attrs (B10/B11); add a share of a stat 17 (B11); `mon.tera-type` +
  `mon.species` ~14 (B14); hit-count family ~10 (B17); set-weather/terrain turns 10 and 5 (B16).
- Already rebindable with existing atoms: nine B03 abilities (Stench, Frostmaw, Deep Cuts, Sharp Talons, Puncture,
  Wrestle Showman, Hollow Ice Zone, Grip Pincer, Venoblaze Pincers) and B18 20/30/33.

## Disputed and kept as is

- `event.on-ko` wording ("When I knock out a Pokemon"): the engine dispatches `PostKnockOutAbAttr` to every Pokemon on
  the field, but composed rules on this trigger are gated to the holder's own knockout
  (`vocabulary/evaluate/compile-composition.ts` MOMENT_GATES, `rule-ab-attrs.ts` AbilityStudioPostKnockOutRuleAbAttr), so
  the picker wording is right for what staff build. The class blocks on that dispatch (Soul-Heart's
  PostKnockOutStatStageChange) carry their own label "whenever a Pokemon faints".
