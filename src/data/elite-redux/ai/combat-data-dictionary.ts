/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allAbilities, allMoves, allSpecies, modifierTypes } from "#data/data-lists";
import { ER_COMBAT_FEATURE_NAMES, ER_COMBAT_FEATURE_SCHEMA_VERSION } from "#data/elite-redux/ai/combat-features";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_RELIC_CONFIG } from "#data/elite-redux/er-relics";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveTarget } from "#enums/move-target";
import { PokemonType } from "#enums/pokemon-type";
import { PositionalTagType } from "#enums/positional-tag-type";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { getModifierType } from "#utils/modifier-utils";
import i18next from "i18next";

export const ER_COMBAT_DATA_DICTIONARY_SCHEMA_VERSION = 3 as const;

interface ErCombatMoveDictionaryEntry {
  readonly id: number;
  readonly erDraftIds: readonly number[];
  readonly name: string;
  readonly types: readonly number[];
  readonly typeNames: readonly string[];
  readonly power: number;
  readonly accuracy: number;
  readonly pp: number;
  readonly priority: number;
  readonly split: number;
  readonly splitName: string;
  readonly target: number;
  readonly targetName: string;
  readonly effectChance: number;
  readonly flags: readonly string[];
  readonly attributes: readonly string[];
  readonly description: string;
}

interface ErCombatAbilityDictionaryEntry {
  readonly id: number;
  readonly erDraftIds: readonly number[];
  readonly name: string;
  readonly description: string;
  readonly generation: number;
  readonly postSummonPriority: number;
  readonly attributes: readonly string[];
  readonly conditionCount: number;
  readonly suppressable: boolean;
  readonly copiable: boolean;
  readonly replaceable: boolean;
  readonly swappable: boolean;
  readonly ignorable: boolean;
}

interface ErCombatItemDictionaryEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly group: string;
  readonly tier: number | null;
  readonly className: string;
}

interface ErCombatSpeciesFormDictionaryEntry {
  readonly id: string;
  readonly speciesId: number;
  readonly form: number;
  readonly name: string;
  readonly formKey: string;
  readonly types: readonly number[];
  readonly baseStats: readonly number[];
  readonly weight: number;
  readonly height: number;
  readonly abilities: readonly number[];
  readonly innates: readonly number[];
}

interface ErCombatRelicDictionaryEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly maxStack: number;
}

export interface ErCombatDataDictionary {
  readonly schemaVersion: typeof ER_COMBAT_DATA_DICTIONARY_SCHEMA_VERSION;
  readonly build: string;
  readonly source: "initialized-game-runtime";
  readonly features: {
    readonly schemaVersion: typeof ER_COMBAT_FEATURE_SCHEMA_VERSION;
    readonly names: typeof ER_COMBAT_FEATURE_NAMES;
  };
  readonly moves: Readonly<Record<number, ErCombatMoveDictionaryEntry>>;
  readonly abilities: Readonly<Record<number, ErCombatAbilityDictionaryEntry>>;
  readonly speciesForms: Readonly<Record<string, ErCombatSpeciesFormDictionaryEntry>>;
  readonly items: Readonly<Record<string, ErCombatItemDictionaryEntry>>;
  /** Canonical modifier-type registry. `items` is retained as the held-item lookup surface. */
  readonly modifiers: Readonly<Record<string, ErCombatItemDictionaryEntry>>;
  readonly relics: Readonly<Record<string, ErCombatRelicDictionaryEntry>>;
  readonly battlerTags: readonly string[];
  readonly arenaTags: readonly string[];
  readonly positionalTags: readonly string[];
  readonly mechanicNamespaces: readonly string[];
}

function invertNumericMap(source: Readonly<Record<number, number>>): Map<number, number[]> {
  const result = new Map<number, number[]>();
  for (const [draftId, runtimeId] of Object.entries(source)) {
    const ids = result.get(runtimeId) ?? [];
    ids.push(Number(draftId));
    result.set(runtimeId, ids);
  }
  for (const ids of result.values()) {
    ids.sort((a, b) => a - b);
  }
  return result;
}

const MOVE_FLAG_VALUES = Object.entries(MoveFlags)
  .filter((entry): entry is [string, MoveFlags] => typeof entry[1] === "number" && entry[1] !== MoveFlags.NONE)
  .sort((a, b) => a[1] - b[1]);

function attributeNames(attributes: readonly object[]): string[] {
  return attributes.map(attribute => attribute.constructor.name);
}

function itemEntry(id: string, factory: ModifierTypeFunc): ErCombatItemDictionaryEntry {
  const item = getModifierType(factory);
  return {
    id,
    name: item.name,
    // Some reward descriptions calculate run-relative values through
    // `globalScene`; the dictionary needs the stable localized template.
    description: i18next.t(`${item.localeKey}.description` as never),
    group: item.group ?? "",
    tier: Number.isFinite(item.tier) ? Number(item.tier) : null,
    className: item.constructor.name,
  };
}

/**
 * Build the ML join dictionary from the same initialized registries combat uses.
 * This deliberately runs after `initializeGame()`: draft ER ids are not runtime
 * ids, and hand-authored abilities do not exist in the generated ER tables.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Runtime registries require independent fail-closed coverage checks.
export function buildErCombatDataDictionary(build: string): ErCombatDataDictionary {
  if (
    allMoves.length === 0
    || allAbilities.length === 0
    || allSpecies.length === 0
    || Object.keys(modifierTypes).length === 0
  ) {
    throw new Error("combat data dictionary requires initialized game registries");
  }

  const moveDraftIds = invertNumericMap(ER_ID_MAP.moves);
  const abilityDraftIds = invertNumericMap(ER_ID_MAP.abilities);
  const moves: Record<number, ErCombatMoveDictionaryEntry> = {};
  const abilities: Record<number, ErCombatAbilityDictionaryEntry> = {};
  const speciesForms: Record<string, ErCombatSpeciesFormDictionaryEntry> = {};
  const items: Record<string, ErCombatItemDictionaryEntry> = {};

  for (const move of allMoves) {
    if (!move) {
      continue;
    }
    moves[move.id] = {
      id: move.id,
      erDraftIds: moveDraftIds.get(move.id) ?? [],
      name: move.name,
      types: [move.type],
      typeNames: [PokemonType[move.type] ?? String(move.type)],
      power: move.power,
      accuracy: move.accuracy,
      pp: move.pp,
      priority: move.priority,
      split: move.category,
      splitName: MoveCategory[move.category] ?? String(move.category),
      target: move.moveTarget,
      targetName: MoveTarget[move.moveTarget] ?? String(move.moveTarget),
      effectChance: move.chance,
      flags: MOVE_FLAG_VALUES.filter(([, flag]) => move.hasFlag(flag)).map(([name]) => name),
      attributes: attributeNames(move.attrs),
      description: move.descriptionOverride ?? move.effect,
    };
  }

  for (const ability of allAbilities) {
    if (!ability) {
      continue;
    }
    abilities[ability.id] = {
      id: ability.id,
      erDraftIds: abilityDraftIds.get(ability.id) ?? [],
      name: ability.name,
      description: ability.description,
      generation: ability.generation,
      postSummonPriority: ability.postSummonPriority,
      attributes: attributeNames(ability.attrs),
      conditionCount: ability.conditions.length,
      suppressable: ability.suppressable,
      copiable: ability.copiable,
      replaceable: ability.replaceable,
      swappable: ability.swappable,
      ignorable: ability.ignorable,
    };
  }

  for (const species of allSpecies) {
    const forms = species.forms.length > 0 ? species.forms : [species];
    for (const form of forms) {
      const id = `${species.speciesId}:${form.formIndex}`;
      speciesForms[id] = {
        id,
        speciesId: species.speciesId,
        form: form.formIndex,
        name: species.getName(form.formIndex),
        formKey: "formKey" in form && typeof form.formKey === "string" ? form.formKey : "",
        types: [...new Set([form.type1, ...(form.type2 == null ? [] : [form.type2]), ...form.getExtraTypes()])],
        baseStats: [...form.baseStats],
        weight: form.weight,
        height: form.height,
        abilities: [form.ability1, form.ability2, form.abilityHidden].filter(abilityId => abilityId > 0),
        innates: [...form.getPassiveAbilities()].filter(abilityId => abilityId > 0),
      };
    }
  }

  for (const [id, factory] of Object.entries(modifierTypes).sort(([a], [b]) => a.localeCompare(b))) {
    items[id] = itemEntry(id, factory as ModifierTypeFunc);
  }

  return {
    schemaVersion: ER_COMBAT_DATA_DICTIONARY_SCHEMA_VERSION,
    build,
    source: "initialized-game-runtime",
    features: {
      schemaVersion: ER_COMBAT_FEATURE_SCHEMA_VERSION,
      names: ER_COMBAT_FEATURE_NAMES,
    },
    moves,
    abilities,
    speciesForms,
    items,
    modifiers: items,
    relics: Object.fromEntries(
      Object.entries(ER_RELIC_CONFIG)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, config]) => [
          id,
          { id, name: config.name, description: config.description, maxStack: config.maxStack },
        ]),
    ),
    battlerTags: Object.values(BattlerTagType).sort(),
    arenaTags: Object.values(ArenaTagType).sort(),
    positionalTags: Object.values(PositionalTagType).sort(),
    mechanicNamespaces: [
      "ability-suppression",
      "ability-state",
      "battle",
      "deferred",
      "entry",
      "entry-fired",
      "entry-window",
      "innate-slot-suppression",
      "item-restore",
      "move-history",
      "move-prime",
      "move-queue",
      "relation",
      "relic-state",
      "summon",
      "summon-provenance",
      "turn",
      "turn-provenance",
      "wave",
    ],
  };
}
