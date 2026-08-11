import { MOODY_BOONS, MOODY_CURSES } from "#data/elite-redux/moody/moody-catalog.generated";
import {
  MOODY_RUNTIME_FIELD_BOON_IDS,
  MOODY_RUNTIME_FIELD_CURSE_IDS,
} from "#data/elite-redux/moody/moody-runtime-field";
import { MOODY_FORMATION_BOON_IDS } from "#data/elite-redux/moody/moody-runtime-formation";
import type { MoodyModeSaveData } from "#data/elite-redux/moody/moody-types";

export type MoodyEffectKind = "boon" | "curse";
export type MoodyEffectSide = "player" | "enemy";

export interface MoodyEffectFlyoutCue {
  readonly effectId: string;
  readonly name: string;
  readonly kind: MoodyEffectKind;
  readonly side: MoodyEffectSide;
}

export type MoodyEffectFlyoutPolicy = "flyout" | "drawer-only";

const COMBAT_TRIGGER_EFFECT_IDS = new Set<string>([
  ...MOODY_FORMATION_BOON_IDS,
  ...MOODY_RUNTIME_FIELD_BOON_IDS,
  ...MOODY_RUNTIME_FIELD_CURSE_IDS,
]);

/**
 * Every catalog entry is classified. Combat effects use the trainer flyout when their runtime emits a
 * discrete trigger; economy, drafting, and other non-combat state changes stay in the Moody drawer.
 */
export const MOODY_EFFECT_FLYOUT_POLICY: Readonly<Record<string, MoodyEffectFlyoutPolicy>> = Object.freeze(
  Object.fromEntries(
    [...MOODY_BOONS, ...MOODY_CURSES].map(
      definition => [definition.id, COMBAT_TRIGGER_EFFECT_IDS.has(definition.id) ? "flyout" : "drawer-only"] as const,
    ),
  ),
);

export function shouldShowMoodyEffectFlyout(effectId: string): boolean {
  return MOODY_EFFECT_FLYOUT_POLICY[effectId] === "flyout";
}

export function getMoodyEffectFlyoutCue(
  state: Pick<MoodyModeSaveData, "boons" | "curses">,
  effectId: string,
  side: MoodyEffectSide = "player",
): MoodyEffectFlyoutCue {
  const boon = state.boons.find(instance => instance.boonId === effectId);
  if (boon != null) {
    const definition = MOODY_BOONS.find(candidate => candidate.id === effectId);
    const evolution = definition?.evolutions.find(candidate => candidate.id === boon.evolutionId);
    const rank = boon.rank === 2 ? " II" : boon.rank === 3 ? " III" : "";
    return {
      effectId,
      name: `${evolution?.name ?? definition?.name ?? effectId}${rank}`,
      kind: "boon",
      side,
    };
  }

  const definition = MOODY_CURSES.find(candidate => candidate.id === effectId);
  return {
    effectId,
    name: definition?.name ?? effectId,
    kind: "curse",
    side,
  };
}
