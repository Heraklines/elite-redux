/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - custom mega/primal stones (#207).
//
// ER models ~284 megas/primals as SEPARATE species, but the base mon keeps a
// vanilla 'mega' form, so a held form-change item triggers it the normal way.
// 54 ER stones reuse a vanilla FormChangeItem (already in the engine); the 227
// here are ER-only, appended to form-change-item.ts as real enum values so the
// reward pool offers them (Mega-Bracelet gated) and holding one triggers the
// base mon's mega form.
//
// Icons: the decomp only ships art for standard + ~9 custom stones, so we REUSE
// existing in-atlas item icons - the base vanilla stone for variants of vanilla
// megas (e.g. ABOMASITE_S -> abomasite), else a generic stone icon.
// =============================================================================

import { FormChangeItem } from "#enums/form-change-item";

/** [ER stone enum name, existing items-atlas icon frame to reuse]. */
const ER_STONE_DEFS: ReadonlyArray<readonly [string, string]> = [
  ["ABOMASITE_S", "abomasite"],
  ["ABSOLITE_Z", "absolite"],
  ["ADAMANT_ORB", "lucarionite"],
  ["AEGISLASHITE_R", "lucarionite"],
  ["AGGRONITE_R", "aggronite"],
  ["ALAKAZITE_R", "alakazite"],
  ["ALCREMITE", "lucarionite"],
  ["ALTARIANITE_R", "altarianite"],
  ["AMPHYBUZZITE", "lucarionite"],
  ["ARBOKITE", "lucarionite"],
  ["ARCANITE", "lucarionite"],
  ["ARCANITE_H", "lucarionite"],
  ["ARCANITE_R", "lucarionite"],
  ["ARTICUNITE", "lucarionite"],
  ["BARBARACITE", "lucarionite"],
  ["BAXCALIBRITE", "lucarionite"],
  ["BEEDRILLITE_R", "beedrillite"],
  ["BLASTOISINITE_X", "blastoisinite"],
  ["BRELOOMITE", "lucarionite"],
  ["BUTTERFRENITE", "lucarionite"],
  ["CARBONIXITE", "lucarionite"],
  ["CENTISKITE", "lucarionite"],
  ["CHANDELURITE", "lucarionite"],
  ["CHANDELURITE_R", "lucarionite"],
  ["CHANDELURITE_Y", "lucarionite"],
  ["CHARIZARDITE_Z", "lucarionite"],
  ["CHESNAUGHTITE", "lucarionite"],
  ["CHIEN_PAOITE", "lucarionite"],
  ["CHIMECHITE", "lucarionite"],
  ["CINDERACEITE", "lucarionite"],
  ["CLEFABLITE", "lucarionite"],
  ["CLEFABLITE_R", "lucarionite"],
  ["CLEFABLITE_Y", "lucarionite"],
  ["CLODSITE", "lucarionite"],
  ["COALOSSITE", "lucarionite"],
  ["COPPERAJITE", "lucarionite"],
  ["CORMOTHITE", "lucarionite"],
  ["CORVINITE", "lucarionite"],
  ["CRABOMINITE", "lucarionite"],
  ["CROBATITE", "lucarionite"],
  ["DARKRANITE", "lucarionite"],
  ["DECIDUITE", "lucarionite"],
  ["DECIDUITE_H", "lucarionite"],
  ["DELPHOXITE", "lucarionite"],
  ["DEWGONGITE", "lucarionite"],
  ["DRACOVISHITE", "lucarionite"],
  ["DRAGALGITE", "lucarionite"],
  ["DRAGAPULTITE", "lucarionite"],
  ["DRAGONINITE", "lucarionite"],
  ["DRAGONINITE_Y", "lucarionite"],
  ["DRAMPANITE", "lucarionite"],
  ["DREDNAWITE", "lucarionite"],
  ["DUDUDUNITE", "lucarionite"],
  ["DYNAMAX_ORB", "lucarionite"],
  ["EELEKTROSSITE", "lucarionite"],
  ["EEVITE", "lucarionite"],
  ["EMBOARITE", "lucarionite"],
  ["EMPOLEONITE", "lucarionite"],
  ["EMPOLEONITE_R", "lucarionite"],
  ["EXCADRITE", "lucarionite"],
  ["FALINKSITE", "lucarionite"],
  ["FERALIGITE_X", "lucarionite"],
  ["FERALIGITE_Y", "lucarionite"],
  ["FLOETTITE", "lucarionite"],
  ["FLYGONITE", "lucarionite"],
  ["FLYGONITE_R", "lucarionite"],
  ["FLYGONITE_R_B", "lucarionite"],
  ["FROSLASSITE", "lucarionite"],
  ["FROSLASSITE_R", "lucarionite"],
  ["FROSLASSITE_Y", "lucarionite"],
  ["GALACTIC_ORB", "lucarionite"],
  ["GALLADITE_R", "galladite"],
  ["GARBODORITE", "lucarionite"],
  ["GARCHOMPITE_R", "garchompite"],
  ["GARCHOMPITE_Z", "garchompite"],
  ["GARDEVOIRITE_R", "gardevoirite"],
  ["GENGARITE_X", "gengarite"],
  ["GLALITITE_R", "glalitite"],
  ["GLIMMORANITE", "lucarionite"],
  ["GOLISOPITE", "lucarionite"],
  ["GOLISOPITE_Y", "lucarionite"],
  ["GOLURKITE", "lucarionite"],
  ["GOODRITE", "lucarionite"],
  ["GOODRITE_H", "lucarionite"],
  ["GOTHITITE", "lucarionite"],
  ["GRANBULLITE", "lucarionite"],
  ["GRENINJITE", "lucarionite"],
  ["GRIMMSNARLITE", "lucarionite"],
  ["GRISEOUS_ORB", "lucarionite"],
  ["GYARADEATHITE_X", "lucarionite"],
  ["GYARADEATHITE_Y", "lucarionite"],
  ["GYARADOSITE_Y", "gyaradosite"],
  ["HARIYAMITE", "lucarionite"],
  ["HATTERENITE", "lucarionite"],
  ["HAWLUCHANITE", "lucarionite"],
  ["HAXORUSITE", "lucarionite"],
  ["HEATRANITE", "lucarionite"],
  ["HERACREUSITE", "lucarionite"],
  ["HITMONCHANITE", "lucarionite"],
  ["HITMONLEENITE", "lucarionite"],
  ["HITMONTOPITE", "lucarionite"],
  ["HOUNDOOMINITE_R", "houndoominite"],
  ["HYDREIGONITE", "lucarionite"],
  ["HYDREIGONITE_R", "lucarionite"],
  ["INCINERITE", "lucarionite"],
  ["INFERNAPENITE", "lucarionite"],
  ["INFERNAPENITE_R", "lucarionite"],
  ["INTELEONITE", "lucarionite"],
  ["KILOZUNITE", "lucarionite"],
  ["KINGAMBITITE_R", "lucarionite"],
  ["KINGDRANITE", "lucarionite"],
  ["KINGLERITE", "lucarionite"],
  ["KINGLERITE_R", "lucarionite"],
  ["KLEAVITE", "lucarionite"],
  ["KLEAVITE_R", "lucarionite"],
  ["KROOKODILENITE", "lucarionite"],
  ["LANTURNITE", "lucarionite"],
  ["LAPRASITE_X", "lucarionite"],
  ["LAPRASITE_Y", "lucarionite"],
  ["LUCARIONITE_Z", "lucarionite"],
  ["LUSTROUS_ORB", "lucarionite"],
  ["LUXRAYNITE", "lucarionite"],
  ["LUXRAYNITE_R", "lucarionite"],
  ["LUXZERITE", "lucarionite"],
  ["MACHAMPITE", "lucarionite"],
  ["MACHAMPITE_R", "lucarionite"],
  ["MAGEARNITE", "lucarionite"],
  ["MAGNEZONITE", "lucarionite"],
  ["MALAMARITE", "lucarionite"],
  ["MAMOSWINITE_R", "lucarionite"],
  ["MAWILITE_R", "mawilite"],
  ["MAWILITE_R_B", "mawilite"],
  ["MEGANIUMITE", "lucarionite"],
  ["MELMETALITE", "lucarionite"],
  ["MEOWSCARADITE", "lucarionite"],
  ["MEOWSTICITE", "lucarionite"],
  ["MEOWTHITE", "lucarionite"],
  ["MIENSHAOITE", "lucarionite"],
  ["MILOTICITE", "lucarionite"],
  ["MOLTRESITE", "lucarionite"],
  ["NIDOKINGITE", "lucarionite"],
  ["NIDOQUEENITE", "lucarionite"],
  ["ORBEETITE", "lucarionite"],
  ["ORICORIONITE", "lucarionite"],
  ["PHANTOM_METEOR", "lucarionite"],
  ["PIKANITE", "lucarionite"],
  ["POPCORMITE", "lucarionite"],
  ["PRIMARINITE", "lucarionite"],
  ["PURPLE_ORB", "lucarionite"],
  ["PYROARITE", "lucarionite"],
  ["QUAGSIRENITE", "lucarionite"],
  ["QUAQUAVITE", "lucarionite"],
  ["RAICHUNITE_X", "lucarionite"],
  ["RAICHUNITE_Y", "lucarionite"],
  ["RAPIDASHITE", "lucarionite"],
  ["RAPIDASHITE_G", "lucarionite"],
  ["RELICANTHITE", "lucarionite"],
  ["REUNICLUSITE", "lucarionite"],
  ["REUNICLUSITE_R", "lucarionite"],
  ["RIBOMBITE", "lucarionite"],
  ["RIBOMBITE_R", "lucarionite"],
  ["RILLABOOMITE", "lucarionite"],
  ["ROSERADEITE", "lucarionite"],
  ["SABLENITE_R", "sablenite"],
  ["SAMUROTTITE", "lucarionite"],
  ["SAMUROTTITE_H", "lucarionite"],
  ["SANDACONDITE", "lucarionite"],
  ["SANDSLASHITE", "lucarionite"],
  ["SANDSLASHITE_A", "lucarionite"],
  ["SCIZORITE_R", "scizorite"],
  ["SCOLIPITE", "lucarionite"],
  ["SCOVILLAINITE", "lucarionite"],
  ["SCRAFTINITE", "lucarionite"],
  ["SCYTHERITE", "lucarionite"],
  ["SCYTHERITE_R", "lucarionite"],
  ["SERPERIORITE", "lucarionite"],
  ["SHEDINJITE", "lucarionite"],
  ["SHUCKLENITE", "lucarionite"],
  ["SKARMORITE", "lucarionite"],
  ["SKARMORITE_R", "lucarionite"],
  ["SKARMORITE_Y", "lucarionite"],
  ["SKELEDIRGEITE", "lucarionite"],
  ["SLAKINGITE", "lucarionite"],
  ["SLOWBRONITE_G", "slowbronite"],
  ["SLOWKINGITE", "lucarionite"],
  ["SLOWKINGITE_G", "lucarionite"],
  ["SNEASLERITE", "lucarionite"],
  ["SNORLAXITE", "lucarionite"],
  ["SNORLAXITE_R", "lucarionite"],
  ["SNORLAX_ORB", "lucarionite"],
  ["STARAPTITE", "lucarionite"],
  ["STARMINITE", "lucarionite"],
  ["SWALOTITE", "lucarionite"],
  ["SWAMPAGEITE", "lucarionite"],
  ["TALONFLAMEITE", "lucarionite"],
  ["TATSUGIRINITE", "lucarionite"],
  ["TEAL_MASK", "lucarionite"],
  ["TERA_ORB", "lucarionite"],
  ["TINKATITE", "lucarionite"],
  ["TINKATITE_R", "lucarionite"],
  ["TORTERRANITE", "lucarionite"],
  ["TORTERRANITE_R", "lucarionite"],
  ["TOUCANNONITE", "lucarionite"],
  ["TOXTRICITITE", "lucarionite"],
  ["TOXTRICITITE_R", "lucarionite"],
  ["TSAREENITE", "lucarionite"],
  ["TSAREENITE_R", "lucarionite"],
  ["TYPHLOSIONITE", "lucarionite"],
  ["TYPHLOSIONITE_H", "lucarionite"],
  ["TYRANITARITE_R", "tyranitarite"],
  ["ULTRANECROZIUM_P", "lucarionite"],
  ["URSALUNITE", "lucarionite"],
  ["URSHIFITE", "lucarionite"],
  ["VANILLUXEITE", "lucarionite"],
  ["VANILLUXEITE_R", "lucarionite"],
  ["VENUSAURITE_X", "venusaurite"],
  ["VICTINI_ORB", "lucarionite"],
  ["VICTREEBELITE", "lucarionite"],
  ["WEAVILEITE", "lucarionite"],
  ["WEAVILEITE_R", "lucarionite"],
  ["WIGGLITUFF_ORB", "lucarionite"],
  ["WIGGLYTUFFITE", "lucarionite"],
  ["WIGGLYTUFFITE_X", "lucarionite"],
  ["YVELTALITE", "lucarionite"],
  ["ZAPDOSITE", "lucarionite"],
  ["ZERAORITE", "lucarionite"],
  ["ZYGARDITE", "lucarionite"],
  // Newcomer-patch fakemon stones + primal orbs (placeholder icon until art lands).
  ["HYDREIGONITE_X", "lucarionite"],
  ["XERNEASITE", "lucarionite"],
  ["SHUCKLITE_Y", "lucarionite"],
  ["DRAGONINITE_Z", "lucarionite"],
  ["PARASECTITE", "lucarionite"],
  ["ELECTIVIRITE_X", "lucarionite"],
  ["MINUNITE", "lucarionite"],
  ["PLUSLEITE", "lucarionite"],
  ["JUMPLUFFITE", "lucarionite"],
  ["PLANETARY_ORB", "lucarionite"],
  ["EMBRYONIC_ORB", "lucarionite"],
];

type FcRecord = Record<string, number>;

/** ER-only FormChangeItem ids (the custom mega/primal stones). */
export const ER_MEGA_STONE_ITEMS: ReadonlySet<FormChangeItem> = new Set<FormChangeItem>(
  ER_STONE_DEFS.map(([name]) => (FormChangeItem as FcRecord)[name]).filter(
    (v): v is FormChangeItem => v !== undefined,
  ),
);

/** ER stone id -> the existing items-atlas icon frame it reuses. */
const ER_STONE_ICON_BY_ITEM: ReadonlyMap<FormChangeItem, string> = new Map(
  ER_STONE_DEFS.map(([name, icon]) => [(FormChangeItem as FcRecord)[name] as FormChangeItem, icon] as const).filter(
    ([item]) => item !== undefined,
  ),
);

/** True if the FormChangeItem is one of the ER-only custom stones. */
export function isErMegaStone(item: FormChangeItem): boolean {
  return ER_MEGA_STONE_ITEMS.has(item);
}

/** The reused items-atlas icon frame for an ER stone (undefined for vanilla). */
export function erMegaStoneIconFrame(item: FormChangeItem): string | undefined {
  return ER_STONE_ICON_BY_ITEM.get(item);
}

/**
 * Resolve an ER mega/primal requirement const (ITEM_VENUSAURITE, ITEM_BUTTERFRENITE,
 * ...) to its FormChangeItem - the vanilla enum value when the name matches, else
 * the appended ER-custom value. Undefined if the stone name is unknown to the enum.
 */
export function resolveErStoneFormChangeItem(requirement: string | undefined | null): FormChangeItem | undefined {
  if (!requirement || !requirement.startsWith("ITEM_")) {
    return undefined;
  }
  const name = requirement.slice("ITEM_".length);
  const v = (FormChangeItem as FcRecord)[name];
  return typeof v === "number" ? (v as FormChangeItem) : undefined;
}
