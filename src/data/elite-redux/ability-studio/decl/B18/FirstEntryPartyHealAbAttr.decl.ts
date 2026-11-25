/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
// Pastel Veil and Sweet Veil (P) (Tier B, memory). "When I enter the battle, IF this heal has not fired yet this wave, DO heal
// every living, hurt party member by a share of its max HP".
//
// Source: ability-upgrades/attrs/party-recovery.ts over PostSummonAbAttr (showAbility true). Dispatch:
// applyAbAttrs("PostSummonAbAttr", { pokemon, simulated }) when a Pokemon enters.
//
// canApply, in the ORIGINAL clause order (now gate only; no guards, no draw, no residual):
//   gate   !pokemon.waveData.entryEffectsFired.has(this.key)     the memory: the class's private key, prefixed
//                                                                "ability-upgrade:first-entry-party-heal:" + the ctor key
// apply: unless simulated or the key is already set, writes the key, then for every member of the holder's party (player or
//   enemy party) that is not fainted, has hp > 0 and is not at full HP: heal toDmgValue(maxHp * healFraction); a member that is
//   on the field AND active gets a queued PokemonHealPhase (animation, message), a benched member is healed at once.
import { FirstEntryPartyHealAbAttr } from "#data/elite-redux/ability-upgrades/attrs/party-recovery";

/** The class prefixes the constructor `key` with this text before it uses it as the memory key (party-recovery.ts). */
const KEY_PREFIX = "ability-upgrade:first-entry-party-heal:";

/** key: staff see the plain name, the class stores it with the prefix. */
const keyCodec: ParamCodec = {
  toCtor: value => String(value),
  fromInstance: raw =>
    typeof raw === "string" && raw.startsWith(KEY_PREFIX) ? raw.slice(KEY_PREFIX.length) : undefined,
};

/** healFraction (0 to 1) <-> percent, rounded so 0.1 reads back as 10 and not 10.000000000000002. */
const percentCodec: ParamCodec = {
  toCtor: value => Number(value) / 100,
  fromInstance: raw => (typeof raw === "number" ? Math.round(raw * 10000) / 100 : undefined),
};

export default defineDecl(FirstEntryPartyHealAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Heal the whole party the first time I enter each wave",
  summary: params =>
    `The first time I enter the battle in each wave, every living party member that is hurt heals ${params.healFraction}% of its max HP. Example: 10 heals a tenth. It happens once per wave (it comes back in the next wave).`,
  synonyms: ["pastel veil", "sweet veil", "heal team on entry", "party heal", "heal everyone once", "team recovery"],
  examples: ["Heal my whole party by 10% of their max HP when I first come in, like Pastel Veil"],
  params: [
    {
      id: "key",
      ctorIndex: 0,
      ctorOption: "key",
      path: "key",
      control: "text",
      label: "Memory name that keeps this to once per wave (leave as is)",
      // Not editable: it names the once-per-wave memory the gate binding reads (the bound `time.once-per` repeats the
      // prefixed key as a literal), so changing it would split the gate's memory from the class's own write.
      editable: false,
      default: "party-heal",
      codec: keyCodec,
    },
    {
      id: "healFraction",
      ctorIndex: 0,
      ctorOption: "healFraction",
      path: "healFraction",
      control: "slider",
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      label: "Heal each hurt party member by (% of its max HP)",
      editable: true,
      gateIndependent: true,
      default: 10,
      codec: percentCodec,
    },
  ],
  conditions: [
    // The gate is the single atom time.once-per { scope: wave, key: "ability-upgrade:first-entry-party-heal:<key>" } (bindings.ts).
    { slot: "gate", ctx: "params", lib: "time.once-per", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only party members that are alive and not at full HP are healed",
    "A member on the field is healed with the normal healing animation; a member in the back is healed at once",
    "Nothing is healed while the game is only previewing",
  ],
  effect: { id: "effect.package", params: ["healFraction"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    // The heal only reaches hurt members: full HP, one below full, and half.
    { name: "the holder at and just below full HP", axes: { hp: ["max", "max-1", "50%"] } },
  ],
  status: "decomposed",
  notes:
    "WHY THE EFFECT STAYS ONE PIECE: 'heal every hurt party member by a share of max HP' has no library effect (effect.heal-percent heals the holder, one foe or the holder side as a whole-number percent and queues the same heal phase for every target, but never reaches the benched party members, which this class heals directly, and skips full-HP and fainted members only inside the class); request R-B18-14. The trigger (event.on-entry) and the memory condition are separate blocks: the gate is the library atom time.once-per with scope wave, which reads and writes the very same pokemon.waveData.entryEffectsFired Set under the same key the class uses, so the class's own write in apply and the atom's commit are one memory (the Berserk precedent). The key is the plain name Pastel Veil 'pastel-veil' / Sweet Veil (P) 'sweet-veil'; the class stores it with the prefix, which the codec strips and the binding spells out. The heal share is the only number and is typed (1 to 100 percent). Users: Pastel Veil (257, attr 1, 10%, key pastel-veil), Sweet Veil (P) (175, attr 3, 10%, key sweet-veil). ODDITIES (not fixed): (1) the class comment and the ability text say 'first switch-in of the battle' but the memory is waveData, which only lasts one wave, so the heal comes back every new wave; (2) a member that is fainted or at full HP is skipped, so if nobody is hurt the key is still set and the heal is spent.",
});
