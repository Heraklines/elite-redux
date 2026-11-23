/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 2, PARKED bindings. They belong to the parked declaration MiracleBladeTypeChartAbAttr (see its header). Move the
// calls below into `../bindings.ts` when the declaration is renamed to `.decl.ts`; the registry only collects `bindings.ts`.
//
// Miracle Blade (6064), attr 0 (MiracleBladeTypeChartAbAttr). Gate = [the move has the slicing property (doesFlagEffectApply
// with the attacker), the defending types include Dark]. The second atom (matchup.defender-has-type) is requested as R-B14-2.2.
// Until it exists the gate is a legacy closure:
//
//   bindLegacyClosure(
//     6064,
//     0,
//     "Clause 2 of the gate reads the list of defending types the engine passes to fire(); no library atom reads it (matchup.defender-has-type is requested in requests/B14.md as R-B14-2.2).",
//     "gate",
//   );
//
// After the atom exists:
//
//   bindCondition(6064, 0, { all: [{ id: "move.flag", flag: "SLICING_MOVE" }, { id: "matchup.defender-has-type", type: "DARK" }] }, "gate");
//
// Spiritual Saber (6065) attr 3 and Manifest (6068) attr 0 have no closure and need no binding.
export {};
