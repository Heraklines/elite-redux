/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Systemic audit: a Pokémon's ACTIVE ability (ability1/2/hidden) should never be
// the same as one of its INNATES (passive slots). When it is, the in-battle
// "Ability" line duplicates an innate (Eiscue showed Ice Face as both; Gyarados
// showed Intimidate). The root cause was multi-form species whose forms kept
// vanilla abilities instead of the ER actives. This audit asserts the active
// slots and innate slots are disjoint across every species AND every form.
import { allAbilities, allSpecies } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const nm = (id: number): string => allAbilities[id]?.name ?? `#${id}`;

describe.skipIf(!RUN)("ER active-ability vs innate disjointness audit", () => {
  it("no species/form has an active ability that is also one of its innates", () => {
    const offenders: string[] = [];

    for (const species of allSpecies) {
      if (!species) {
        continue;
      }
      const forms = species.forms.length > 0 ? species.forms : [null];
      for (let i = 0; i < forms.length; i++) {
        const form = forms[i];
        const holder = form ?? species;
        const actives = [holder.ability1, holder.ability2, holder.abilityHidden].filter(a => a !== AbilityId.NONE);
        const innates = species.getPassiveAbilities(form ? i : species.formIndex).filter(a => a !== AbilityId.NONE);
        const dup = actives.find(a => innates.includes(a));
        if (dup !== undefined) {
          const label = form ? `${species.name}[${form.formKey || "base"}]` : species.name;
          offenders.push(`${label}: active ${nm(dup)} is also an innate`);
        }
      }
    }

    expect(offenders, `${offenders.length} active==innate overlaps:\n${offenders.slice(0, 40).join("\n")}`).toEqual([]);
  });
});
