/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 - the PS-COMPATIBLE text codec for a set / a team.
//
// The canonical set format is Pokemon-Showdown "importable" text plus two ER extension TAGS carried
// on the header line - `[Stage: <form>]` (which evolution/mega stage is fielded) and `[Shiny: <n>]`
// (the shiny variant tier). This is the preset backbone: Export/Import in the Set Editor (one set) and
// the Team Menu (a blank-line-separated team), and the storage format for named per-species sets.
//
//   Garchomp @ Leftovers  [Stage: Mega Garchomp] [Shiny: 2]
//   Ability: Sand Veil
//   Nature: Jolly
//   - Earthquake
//   - Outrage
//   - Swords Dance
//   - Stone Edge
//
// EXPORT always writes the ER tags (Stage always; Shiny only on a shiny mon, so a non-shiny set omits
// it and re-imports as non-shiny). IMPORT is deliberately TOLERANT: unknown lines are skipped silently
// (the PS fields we have no system for - EVs / Level / Happiness / Tera Type / gender), both hyphen and
// en/em-dash move bullets are accepted, case + whitespace + separators are forgiving, and species /
// move / item / ability / nature are resolved by NORMALIZED NAME through the SAME separator-insensitive
// key the search ranker uses (`collapseSearchKey`). Every unresolved value is reported as a PRECISE,
// per-line error ("line 3: unknown move 'Foo'") so the import UX can name exactly what failed per mon.
//
// This module reads the static game data lists (species / moves / abilities / items / natures) but has
// NO globalScene/Phaser dependency, so it is exercised end-to-end by the ER_SCENARIO unit tests (which
// boot the data lists) exactly like the search-matrix tests.
// =============================================================================

import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { speciesStarterCosts } from "#balance/starters";
import { allAbilities, allMoves, allSpecies, modifierTypes } from "#data/data-lists";
import { erMegaTargetToBaseSpeciesId } from "#data/elite-redux/er-generic-pool-bans";
import { isMegaStage, listMegaStages } from "#data/elite-redux/showdown/showdown-evolutions";
import { SHOWDOWN_ITEM_POOL, type ShowdownItemKey } from "#data/elite-redux/showdown/showdown-item-pool";
import { collapseSearchKey } from "#data/elite-redux/showdown/showdown-search-normalize";
import { MEGA_STONE_ITEM, type ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { getNatureName } from "#data/nature";
import { Nature } from "#enums/nature";
import type { SpeciesId } from "#enums/species-id";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** The IV every showdown mon is forced to (fairness); the codec always reconstructs a flat 31 spread. */
const FORCED_IV = 31;
const IV_COUNT = 6;
/** Every showdown mon is fielded at level 100. */
const SHOWDOWN_LEVEL = 100;
/** Item fielded when a set names none (mirrors `starterToManifest`'s DEFAULT_ITEM). */
const DEFAULT_ITEM = SHOWDOWN_ITEM_POOL[0];
const MAX_MOVES = 4;

// ---- public types -----------------------------------------------------------------------------

/** One precise codec error. `line` is 1-based over the WHOLE input text when known. */
export interface ShowdownCodecError {
  line?: number;
  message: string;
}

/** The outcome of importing ONE set block. */
export interface ShowdownSetParseResult {
  /** The reconstructed wire manifest, or null when the SPECIES could not be resolved (fatal for the mon). */
  manifest: ShowdownMonManifest | null;
  /** Precise per-line errors (unknown move / item / ability / nature / stage). */
  errors: ShowdownCodecError[];
}

/** The outcome of importing a whole team (blank-line-separated sets). */
export interface ShowdownTeamParseResult {
  /** One entry per non-empty set block, in paste order. */
  sets: ShowdownSetParseResult[];
  /** Every reconstructed manifest whose species resolved (a null-species block is dropped here). */
  manifests: ShowdownMonManifest[];
  /** All errors across all blocks flattened (each carries its own line number). */
  errors: ShowdownCodecError[];
}

// ---- lazily-built normalized name -> id lookups -----------------------------------------------
// Built from the live data lists on first use (the lists are populated once ER inits). First-wins on
// a name collision (regional formes share a display name) so the canonical/base entry is preferred.

let speciesByName: Map<string, number> | null = null;
let moveByName: Map<string, number> | null = null;
let itemByName: Map<string, ShowdownItemKey> | null = null;
let natureByName: Map<string, number> | null = null;

function getSpeciesByName(): Map<string, number> {
  if (speciesByName == null) {
    speciesByName = new Map();
    for (const sp of allSpecies) {
      if (sp?.name) {
        const key = collapseSearchKey(sp.name);
        if (!speciesByName.has(key)) {
          speciesByName.set(key, sp.speciesId);
        }
      }
    }
  }
  return speciesByName;
}

function getMoveByName(): Map<string, number> {
  if (moveByName == null) {
    moveByName = new Map();
    allMoves.forEach((move, id) => {
      if (move?.name) {
        const key = collapseSearchKey(move.name);
        if (!moveByName!.has(key)) {
          moveByName!.set(key, id);
        }
      }
    });
  }
  return moveByName;
}

function resolvedItemName(key: ShowdownItemKey): string {
  const modType = modifierTypes[key];
  return modType == null ? String(key) : (getModifierType(modType).name ?? String(key));
}

function getItemByName(): Map<string, ShowdownItemKey> {
  if (itemByName == null) {
    itemByName = new Map();
    for (const key of SHOWDOWN_ITEM_POOL) {
      // Map both the display name ("Leftovers") and the raw pool key ("LEFTOVERS") so either resolves.
      const nameKey = collapseSearchKey(resolvedItemName(key));
      if (!itemByName.has(nameKey)) {
        itemByName.set(nameKey, key);
      }
      const rawKey = collapseSearchKey(String(key));
      if (!itemByName.has(rawKey)) {
        itemByName.set(rawKey, key);
      }
    }
  }
  return itemByName;
}

function getNatureByName(): Map<string, number> {
  if (natureByName == null) {
    natureByName = new Map();
    for (const nature of Object.values(Nature)) {
      if (typeof nature !== "number") {
        continue;
      }
      // Map BOTH the localized display name AND the canonical enum name, so an English PS paste resolves
      // on a localized client (natures are universal) and vice-versa.
      const localized = collapseSearchKey(getNatureName(nature as Nature));
      const enumName = collapseSearchKey(Nature[nature]);
      if (!natureByName.has(localized)) {
        natureByName.set(localized, nature);
      }
      if (!natureByName.has(enumName)) {
        natureByName.set(enumName, nature);
      }
    }
  }
  return natureByName;
}

/** Reset the memoized lookups. For tests only (the maps are otherwise stable once the data lists init). */
export function _resetShowdownCodecCaches(): void {
  speciesByName = null;
  moveByName = null;
  itemByName = null;
  natureByName = null;
}

// ---- shared helpers ---------------------------------------------------------------------------

function speciesName(speciesId: number): string {
  return getPokemonSpecies(speciesId as SpeciesId)?.name ?? String(speciesId);
}

/** The fielded stage's export label: a mega/primal form's own name, else "Base" (non-mega form 0). */
function stageLabel(speciesId: number, formIndex: number): string {
  if (isMegaStage(speciesId, formIndex)) {
    const form = getPokemonSpecies(speciesId as SpeciesId)?.forms?.[formIndex];
    return form?.formName || "Mega";
  }
  return "Base";
}

/** The mon's fielded ACTIVE ability name (index into the fielded species' 3 active slots). */
function activeAbilityName(mon: ShowdownMonManifest): string {
  const sp = getPokemonSpecies(mon.speciesId as SpeciesId);
  if (sp == null) {
    return "-";
  }
  const actives = [sp.ability1, sp.ability2, sp.abilityHidden];
  const id = actives[mon.abilityIndex] ?? actives[0];
  return allAbilities[id]?.name ?? "-";
}

/** Walk to the line's collection ROOT (mirrors buildUnlockSnapshot's `starterRoot`). */
function resolveRoot(speciesId: number): number {
  let cur = erMegaTargetToBaseSpeciesId(speciesId) ?? speciesId;
  const seen = new Set<number>();
  while (pokemonPrevolutions[cur] !== undefined && !seen.has(cur)) {
    seen.add(cur);
    cur = pokemonPrevolutions[cur];
  }
  return cur;
}

// ---- EXPORT -----------------------------------------------------------------------------------

/**
 * Serialize ONE manifest to the PS-compatible set text (ER tags always). A mega mon omits the `@ item`
 * (the `[Stage: <mega>]` tag implies the locked stone); a non-shiny mon omits the `[Shiny]` tag.
 */
export function exportShowdownSet(mon: ShowdownMonManifest): string {
  const isMega = mon.item === MEGA_STONE_ITEM || isMegaStage(mon.speciesId, mon.formIndex);
  let header = speciesName(mon.speciesId);
  if (!isMega) {
    header += ` @ ${resolvedItemName(mon.item as ShowdownItemKey)}`;
  }
  const tags = [`[Stage: ${stageLabel(mon.speciesId, mon.formIndex)}]`];
  if (mon.shiny) {
    tags.push(`[Shiny: ${mon.variant}]`);
  }
  header += `  ${tags.join(" ")}`;

  const lines = [
    header,
    `Ability: ${activeAbilityName(mon)}`,
    `Nature: ${getNatureName((mon.nature ?? Nature.HARDY) as Nature)}`,
  ];
  for (const moveId of mon.moveset) {
    const move = allMoves[moveId];
    if (move) {
      lines.push(`- ${move.name}`);
    }
  }
  return lines.join("\n");
}

/** Serialize a team of manifests to PS text: sets joined by a blank line (PS convention), no trailing NL. */
export function exportShowdownTeam(mons: ShowdownMonManifest[]): string {
  return mons.map(exportShowdownSet).join("\n\n");
}

// ---- IMPORT -----------------------------------------------------------------------------------

interface NumberedLine {
  n: number;
  text: string;
}

/** Group the raw text into blocks (separated by one or more blank lines), each carrying line numbers. */
function toBlocks(text: string): NumberedLine[][] {
  const blocks: NumberedLine[][] = [];
  let current: NumberedLine[] | null = null;
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((raw, i) => {
      if (raw.trim() === "") {
        current = null;
        return;
      }
      if (current == null) {
        current = [];
        blocks.push(current);
      }
      current.push({ n: i + 1, text: raw });
    });
  return blocks;
}

const MOVE_BULLET = /^[-–—~•]\s*/;

/** Parse a single set BLOCK (already grouped, with line numbers) into a manifest + precise errors. */
function parseSetBlock(block: NumberedLine[]): ShowdownSetParseResult {
  const errors: ShowdownCodecError[] = [];
  const header = block[0];

  // --- header: pull the ER tags out, then split "<species> @ <item>" ---
  const tags = new Map<string, string>();
  const headerNoTags = header.text
    .replace(/\[([^\]]*)\]/g, (_full, inner: string) => {
      const idx = inner.indexOf(":");
      if (idx > 0) {
        tags.set(inner.slice(0, idx).trim().toLowerCase(), inner.slice(idx + 1).trim());
      }
      return "";
    })
    .trim();

  let speciesPart = headerNoTags;
  let itemPart: string | null = null;
  const atIdx = headerNoTags.indexOf(" @ ");
  if (atIdx >= 0) {
    speciesPart = headerNoTags.slice(0, atIdx).trim();
    itemPart = headerNoTags.slice(atIdx + 3).trim() || null;
  }
  // Strip a trailing gender marker "(M)"/"(F)", then unwrap a "Nickname (Species)" form.
  speciesPart = speciesPart.replace(/\s*\((?:M|F)\)\s*$/i, "").trim();
  const nick = speciesPart.match(/\(([^)]+)\)\s*$/);
  const resolvedSpeciesName = (nick ? nick[1] : speciesPart).trim();

  const speciesId0 = getSpeciesByName().get(collapseSearchKey(resolvedSpeciesName));
  if (speciesId0 === undefined) {
    errors.push({ line: header.n, message: `line ${header.n}: unknown species '${resolvedSpeciesName}'` });
    return { manifest: null, errors };
  }

  // --- body lines: ability / nature / moves; everything else (EVs/Level/IVs/...) skipped ---
  let abilityRaw: string | null = null;
  let abilityLine = header.n;
  let natureRaw: string | null = null;
  let natureLine = header.n;
  let shinyLineValue: string | null = null;
  const moveTokens: NumberedLine[] = [];
  for (let i = 1; i < block.length; i++) {
    const { n, text } = block[i];
    const line = text.trim();
    const ability = line.match(/^ability\s*:\s*(.*)$/i);
    if (ability) {
      abilityRaw = ability[1].trim();
      abilityLine = n;
      continue;
    }
    const nature = line.match(/^nature\s*:\s*(.*)$/i);
    if (nature) {
      natureRaw = nature[1].trim();
      natureLine = n;
      continue;
    }
    const shiny = line.match(/^shiny\s*:\s*(.*)$/i);
    if (shiny) {
      shinyLineValue = shiny[1].trim();
      continue;
    }
    if (MOVE_BULLET.test(line)) {
      moveTokens.push({ n, text: line.replace(MOVE_BULLET, "").trim() });
    }
    // Any other line (EVs / IVs / Level / Happiness / Tera Type / a bare nickname) is skipped silently.
  }

  // --- STAGE: resolve the fielded species + form from the [Stage] tag (default = base, form 0) ---
  const root = resolveRoot(speciesId0);
  let speciesId = speciesId0;
  let formIndex = 0;
  const stageRaw = tags.get("stage");
  if (stageRaw && collapseSearchKey(stageRaw) !== "base") {
    const megas = listMegaStages(root);
    const key = collapseSearchKey(stageRaw);
    let stage = megas.find(m => collapseSearchKey(m.formName) === key);
    if (stage == null && /mega|primal|origin/.test(key)) {
      // A generic "Mega" label: prefer a mega on the NAMED species, else the line's first mega.
      stage = megas.find(m => m.speciesId === speciesId0) ?? megas[0];
    }
    if (stage == null) {
      errors.push({ line: header.n, message: `line ${header.n}: unknown stage '${stageRaw}'` });
    } else {
      speciesId = stage.speciesId;
      formIndex = stage.formIndex;
    }
  }
  const isMega = isMegaStage(speciesId, formIndex);

  // --- ITEM: mega -> the locked stone sentinel; else resolve the named item, defaulting on miss ---
  let item: string;
  if (isMega) {
    item = MEGA_STONE_ITEM;
  } else if (itemPart) {
    const key = getItemByName().get(collapseSearchKey(itemPart));
    if (key == null) {
      errors.push({ line: header.n, message: `line ${header.n}: unknown item '${itemPart}'` });
      item = DEFAULT_ITEM;
    } else {
      item = key;
    }
  } else {
    item = DEFAULT_ITEM;
  }

  // --- ABILITY: match the name against the fielded species' 3 active slots (default 0 on miss) ---
  let abilityIndex = 0;
  if (abilityRaw) {
    const sp = getPokemonSpecies(speciesId as SpeciesId);
    const actives = sp ? [sp.ability1, sp.ability2, sp.abilityHidden] : [];
    const key = collapseSearchKey(abilityRaw);
    const idx = actives.findIndex(
      id => id != null && allAbilities[id] && collapseSearchKey(allAbilities[id].name) === key,
    );
    if (idx >= 0) {
      abilityIndex = idx;
    } else {
      errors.push({ line: abilityLine, message: `line ${abilityLine}: unknown ability '${abilityRaw}'` });
    }
  }

  // --- NATURE: universal name -> Nature (default Hardy on miss/absent) ---
  let nature: number = Nature.HARDY;
  if (natureRaw) {
    const resolved = getNatureByName().get(collapseSearchKey(natureRaw));
    if (resolved === undefined) {
      errors.push({ line: natureLine, message: `line ${natureLine}: unknown nature '${natureRaw}'` });
    } else {
      nature = resolved;
    }
  }

  // --- MOVES: resolve each bullet; dedup silently; cap at 4; report each unknown precisely ---
  const moveset: number[] = [];
  for (const token of moveTokens) {
    if (moveset.length >= MAX_MOVES) {
      break;
    }
    const id = getMoveByName().get(collapseSearchKey(token.text));
    if (id === undefined) {
      errors.push({ line: token.n, message: `line ${token.n}: unknown move '${token.text}'` });
    } else if (!moveset.includes(id)) {
      moveset.push(id);
    }
  }

  // --- SHINY: the [Shiny: n] tag wins; a bare `Shiny: Yes` line is honored otherwise ---
  let shiny = false;
  let variant = 0;
  const shinyTag = tags.get("shiny");
  if (shinyTag !== undefined) {
    const v = Number.parseInt(shinyTag, 10);
    if (Number.isFinite(v)) {
      shiny = true;
      variant = Math.max(0, Math.min(2, v));
    } else if (/^(yes|true)$/i.test(shinyTag)) {
      shiny = true;
    }
  } else if (shinyLineValue != null && /^(yes|true|1)$/i.test(shinyLineValue)) {
    shiny = true;
  }

  const manifest: ShowdownMonManifest = {
    speciesId,
    formIndex,
    level: SHOWDOWN_LEVEL,
    shiny,
    variant,
    abilityIndex,
    nature,
    ivs: new Array(IV_COUNT).fill(FORCED_IV),
    moveset,
    item,
    rootSpeciesId: root,
    erBlackShiny: false,
    baseCost: speciesStarterCosts[root] ?? 4,
  };
  return { manifest, errors };
}

/** Import ONE set from PS text (the first non-empty block; trailing blocks ignored). */
export function importShowdownSet(text: string): ShowdownSetParseResult {
  const blocks = toBlocks(text);
  if (blocks.length === 0) {
    return { manifest: null, errors: [{ message: "No set found in the pasted text." }] };
  }
  return parseSetBlock(blocks[0]);
}

/** Import a whole team (blank-line-separated sets). Species-unresolvable blocks are dropped from `manifests`. */
export function importShowdownTeam(text: string): ShowdownTeamParseResult {
  const sets = toBlocks(text).map(parseSetBlock);
  const manifests: ShowdownMonManifest[] = [];
  const errors: ShowdownCodecError[] = [];
  for (const set of sets) {
    errors.push(...set.errors);
    if (set.manifest != null) {
      manifests.push(set.manifest);
    }
  }
  return { sets, manifests, errors };
}
