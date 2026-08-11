import { globalScene } from "#app/global-scene";
import {
  consumeCurrentMoodyLiveProjection,
  getCurrentMoodyLiveProjection,
} from "#data/elite-redux/moody/moody-runtime-live-adapter";
import { getMoodyModeState } from "#data/elite-redux/moody/moody-state";
import type { MoodyTransitionSection } from "#ui/moody/moody-presentation";

function activeItemSetLines(activeSets: readonly unknown[]): string[] {
  return activeSets.flatMap(activeSet => {
    if (activeSet == null || typeof activeSet !== "object" || Array.isArray(activeSet)) {
      return [];
    }
    const value = activeSet as { name?: unknown; pieceCount?: unknown; tier?: unknown };
    if (typeof value.name !== "string") {
      return [];
    }
    const count = typeof value.pieceCount === "number" ? `${value.pieceCount} pieces` : "active";
    const tier = typeof value.tier === "string" ? `, ${value.tier}` : "";
    return [`${value.name}: ${count}${tier}`];
  });
}

function apexLines(segmentsByPokemon: Readonly<Record<string, readonly number[]>>): string[] {
  return Object.entries(segmentsByPokemon).flatMap(([pokemonId, segments]) => {
    if (segments.length === 0) {
      return [];
    }
    const pokemon = globalScene.getPlayerParty().find(member => String(member.id) === pokemonId);
    const label = pokemon?.getNameToRender() ?? `Pokemon ${pokemonId}`;
    return [`${label}: ${segments.map(fraction => `${Math.round(fraction * 100)}%`).join(" + ")}`];
  });
}

export function parseMoodyItemStackId(itemStackId: string): { pokemonId?: string; itemTypeId: string } {
  const separator = itemStackId.indexOf(":");
  if (separator <= 0 || separator === itemStackId.length - 1) {
    return { itemTypeId: itemStackId };
  }
  return {
    pokemonId: itemStackId.slice(0, separator),
    itemTypeId: itemStackId.slice(separator + 1),
  };
}

function fallbackItemLabel(itemTypeId: string): string {
  return itemTypeId.replace(/[_-]+/g, " ").replace(/\b\w/g, character => character.toUpperCase());
}

export function formatMoodyCursedStackLine(pokemonName: string, itemName: string): string {
  return `${itemName} disabled on ${pokemonName}`;
}

function cursedInventoryLines(cursedStack: { pokemonId: string; itemStackId: string } | null): string[] {
  if (cursedStack == null) {
    return [];
  }
  const parsed = parseMoodyItemStackId(cursedStack.itemStackId);
  const pokemonId = parsed.pokemonId ?? cursedStack.pokemonId;
  const pokemon = globalScene.getPlayerParty().find(member => String(member.id) === pokemonId);
  const pokemonName = pokemon?.getNameToRender() ?? "Unknown Pokemon";
  const modifier = globalScene.modifiers.find(candidate => {
    const heldPokemonId = "pokemonId" in candidate ? String(candidate.pokemonId) : undefined;
    return candidate.type.id === parsed.itemTypeId && (heldPokemonId == null || heldPokemonId === pokemonId);
  });
  const itemName = modifier?.type.name ?? fallbackItemLabel(parsed.itemTypeId);
  return [formatMoodyCursedStackLine(pokemonName, itemName)];
}

export function queueMoodyBiomeTransitionReport(): boolean {
  if (getMoodyModeState() == null) {
    return false;
  }
  const projection = getCurrentMoodyLiveProjection();
  if (projection == null) {
    return false;
  }
  const notifications = consumeCurrentMoodyLiveProjection("notifications") ?? [];
  const sections: MoodyTransitionSection[] = [
    { title: "ACTIVE SETS", lines: activeItemSetLines(projection.progression.activeItemSets) },
    {
      title: "CURSED INVENTORY",
      lines: cursedInventoryLines(projection.progression.cursedStack),
    },
    { title: "APEX SEGMENTS", lines: apexLines(projection.progression.apexSegmentsByPokemon) },
    { title: "MOODY CHANGES", lines: notifications },
  ].filter(section => section.lines.length > 0);
  if (sections.length === 0) {
    return false;
  }
  const lineCount = sections.reduce((count, section) => count + section.lines.length, 0);
  globalScene.ui.pushMoodyTrigger(
    `Biome transition: ${lineCount} Moody change${lineCount === 1 ? "" : "s"}. Details are in the Ledger.`,
  );
  return true;
}
