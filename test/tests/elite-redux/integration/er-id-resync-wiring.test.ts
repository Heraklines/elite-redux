/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allAbilities } from "#data/data-lists";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { ER_ABILITIES } from "#data/elite-redux/er-abilities";
import { ER_ABILITY_ARCHETYPES } from "#data/elite-redux/er-ability-archetypes";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { describe, expect, it } from "vitest";
import dex from "../../../../vendor/elite-redux/v2.65beta.json";

const DRIFTED_ABILITIES = dex.abilities.filter((ability, position) => ability.id !== position);
const DRAFTS_BY_ID = new Map(ER_ABILITIES.map(draft => [draft.id, draft]));

describe("ER ability ids use dex ids rather than array positions", () => {
  it("covers every non-positional dex entry", () => {
    expect(DRIFTED_ABILITIES).toHaveLength(81);
  });

  it.each(DRIFTED_ABILITIES)("$id $name has the matching draft and archetype row", ability => {
    const draft = DRAFTS_BY_ID.get(ability.id);
    const row = ER_ABILITY_ARCHETYPES[ability.id];

    expect(draft?.name).toBe(ability.name);
    expect(draft?.description).toBe(ability.desc);
    expect(row?.erAbilityId).toBe(ability.id);
  });

  it.each(DRIFTED_ABILITIES)("$id $name registers the matching runtime name and attrs", ability => {
    const pokerogueId = ER_ID_MAP.abilities[ability.id];
    const runtime = allAbilities[pokerogueId];
    const row = ER_ABILITY_ARCHETYPES[ability.id];

    expect(runtime?.name).toBe(ability.name);
    expect(row).toBeDefined();

    const dispatched = dispatchArchetype(row.archetype, row.params, ability.id);
    expect(runtime?.attrs.map(attr => attr.constructor.name)).toEqual(
      dispatched.attrs.map(attr => attr.constructor.name),
    );
  });
});
