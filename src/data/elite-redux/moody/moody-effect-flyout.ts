import { MOODY_BOONS, MOODY_CURSES } from "#data/elite-redux/moody/moody-catalog.generated";
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

/**
 * Only effects with a discrete, player-visible proc belong here. Persistent stat, damage, type, weather,
 * formation, and economy modifiers remain available in the Moody drawer without stalling the phase queue.
 */
const DISCRETE_COMBAT_FLYOUT_IDS = new Set<string>([
  "rotating-spotlight",
  "survivor-s-pride",
  "copycat-heart",
  "mithridatism",
  "parting-gift",
  "counterrotation",
  "tag-combo",
  "hold-the-line",
  "revenge-entry",
  "turntable",
  "countermelody",
  "conservation-law",
  "failure-is-data",
  "overdraft",
  "final-draft",
  "prismatic-opening",
  "elemental-dividend",
  "microclimate",
  "eye-of-the-storm",
  "terrain-weaver",
  "four-seasons",
  "battlefield-memory",
  "shared-antibodies",
  "status-bank",
  "volatile-memory",
  "purge-pulse",
  "aftercare",
  "overflow-ward",
  "shared-cup",
  "damage-ceiling",
  "emergency-shell",
  "guarded-setup",
  "rest-cycle",
  "last-rites",
  "no-one-left-behind",
  "phoenix-clause",
  "dead-man-s-action",
  "slow-to-warm",
  "fading-momentum",
  "exposed-flank",
  "public-enemy",
  "nemesis-protocol",
  "blood-moon",
  "entropy",
  "feedback-loop",
]);

/**
 * Every catalog entry is classified. Only discrete combat procs use the trainer flyout; continuous and
 * non-combat state changes stay in the Moody drawer.
 */
export const MOODY_EFFECT_FLYOUT_POLICY: Readonly<Record<string, MoodyEffectFlyoutPolicy>> = Object.freeze(
  Object.fromEntries(
    [...MOODY_BOONS, ...MOODY_CURSES].map(
      definition => [definition.id, DISCRETE_COMBAT_FLYOUT_IDS.has(definition.id) ? "flyout" : "drawer-only"] as const,
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
