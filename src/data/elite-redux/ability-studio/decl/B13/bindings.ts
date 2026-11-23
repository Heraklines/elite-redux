/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B13 (chunk 1): the library form of every constructor closure (slot "ctor:N") and every
// Tier B gate (slot "gate") of Final Season (5972), Foul Harvest (5973) and Porous (5974), keyed by
// (abilityId, attrIndex). "attr N" is the position in `ability.attrs`.
//
// Every line was written by hand from the class source and then checked by the L1 differential over the state grid.
// A line that says legacy-closure names the library atom that is missing; the matching request is in
// requests/B13.md.
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

// ---------------------------------------------------------------------------------------------
// Final Season (5972)
// ---------------------------------------------------------------------------------------------

// FinalSeasonEntryAbAttr (attr 0), gate: `VOLUNTARY_ENTRY.has(holder)`.
bindLegacyClosure(
  5972,
  0,
  "Final Season entry: VOLUNTARY_ENTRY.has(holder), a private set filled by markGenuineVoluntaryEntry when the switch was a deliberate party command; needs the atom entry.voluntary-switch-in (R-B13-1)",
  "gate",
);

// FinalSeasonFogAbAttr (attr 1), gate: `FINAL_SEASON_PENDING_FOG.has(holder)`.
bindLegacyClosure(
  5972,
  1,
  "Final Season fog: FINAL_SEASON_PENDING_FOG.has(holder), a private set filled by the entry effect (a flag set by the switch-in effect); needs the atom time.armed (R-B13-2)",
  "gate",
);

// FinalSeasonPowerAbAttr (attr 2), gate = clauses 3 and 4 of the original closure, in order:
//   arena.weatherType === EERIE_FOG
//   && [DARK, FLYING].includes(holder.getMoveType(move))
// Clauses 1 and 2 (the fog is my own, still the same Weather instance) are the class's `guards`, see its declaration.
bindCondition(
  5972,
  2,
  {
    all: [
      { id: "field.weather", weather: "EERIE_FOG" },
      {
        any: [
          { id: "move.type", type: "DARK" },
          { id: "move.type", type: "FLYING" },
        ],
      },
    ],
  },
  "gate",
);

// ---------------------------------------------------------------------------------------------
// Foul Harvest (5973)
// ---------------------------------------------------------------------------------------------

// FoulHarvestAbAttr (attr 0), ctor:0 = the base class's default attack condition `move.category !== STATUS`.
bindCondition(5973, 0, { id: "move.damaging" }, "ctor:0");

// FoulHarvestAbAttr (attr 0), gate = clauses 2 to 4 of canApply, in order:
//   damage > 0 && hitResult < NO_EFFECT && my last move record exists and is not the one already counted
bindLegacyClosure(
  5973,
  0,
  "Foul Harvest: damage > 0, hitResult < NO_EFFECT and 'my last move record is new' (a per-Pokemon memory of the last counted move); needs hit.dealt-damage, hit.not-blocked and time.new-move-of-mine (R-B13-3, R-B13-4, R-B13-5)",
  "gate",
);

// ---------------------------------------------------------------------------------------------
// Porous (5974). PorousResetAbAttr (attr 0) has no condition at all, so there is nothing to bind.
// ---------------------------------------------------------------------------------------------

// PorousSoundReductionAbAttr (attr 1), gate: `move.doesFlagEffectApply({ flag: SOUND_BASED, user: attacker })`.
bindCondition(5974, 1, { id: "move.flag", flag: "SOUND_BASED" }, "gate");

// PorousChargeAbAttr (attr 2), gate: `damage > 0 && hitResult < NO_EFFECT && POROUS[holder].lastMoveRecord !== the foe's last record`.
bindLegacyClosure(
  5974,
  2,
  "Porous charge: damage > 0, hitResult < NO_EFFECT and 'the foe's last move record is not the one already counted' (a per-Pokemon memory); needs hit.dealt-damage, hit.not-blocked and time.new-move-of-foe (R-B13-3, R-B13-4, R-B13-6)",
  "gate",
);

// PorousPowerAbAttr (attr 3), gate = clause 1 of the original closure: `holder.getMoveType(move) === GROUND`.
// Clause 2 (a charge is stored) is the class's `residual`, see its declaration.
bindCondition(5974, 3, { id: "move.type", type: "GROUND" }, "gate");
