/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. The shape of blocks.json (one entry per class declaration) and
// instances.json (one entry per (abilityId, attrIndex)), and the stable block id of a class. The game-side
// builders live in ../catalog.ts; this file only holds what the editor, worker and AI server also read.

import type { ParamControl, ParamValue } from "./params";
import type { SlotId } from "./slots";

export const CATALOG_SCHEMA_VERSION = 1;

/** `PostDamageForceSwitchAbAttr` -> `block.post-damage-force-switch`. Stable, readable and unique per class name. */
export function blockIdForClass(className: string): string {
  const kebab = className
    .replace(/AbAttr$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `block.${kebab}`;
}

export interface BlockParamJson {
  readonly id: string;
  readonly label: string;
  readonly control: ParamControl;
  readonly default: ParamValue;
  readonly editable: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly options?: readonly string[];
  readonly integer?: boolean;
  /** Tier B: the gate binding never repeats this param, so editing it needs no gateParams entry. */
  readonly gateIndependent?: boolean;
}

/** Tier B: an editable param that the gate binding repeats as a literal; the editor writes the live value into the gate. */
export interface BlockGateParamJson {
  readonly param: string;
  readonly block: string;
  readonly field: string;
  readonly scale?: number;
}

export interface BlockConditionJson {
  readonly slot: string;
  readonly lib?: string;
  readonly removable: boolean;
  readonly editable: boolean;
  readonly optional: boolean;
}

export interface BlockEffectJson {
  readonly id: string;
  readonly params: readonly string[];
}

export interface BlockBranchJson {
  readonly label: string;
  readonly conditions: readonly string[];
  readonly effect: BlockEffectJson;
}

export interface BlockJson {
  readonly id: string;
  /** The class the block describes (the game keeps it as the single source of behaviour). */
  readonly className: string;
  /** Plain-language name, never the class name. */
  readonly label: string;
  /** The summary sentence rendered with the default params. */
  readonly summary: string;
  readonly tier: "A" | "B" | "C";
  readonly kind: "event-effect" | "calc-modifier" | "while-active" | "engine-query" | "package" | "trigger-source";
  readonly status: "todo" | "decomposed" | "verified" | "exempt";
  /** The WHEN_REGISTRY id the class hangs on, with its plain label. */
  readonly when: string;
  readonly whenLabel: string;
  readonly synonyms: readonly string[];
  readonly examples: readonly string[];
  readonly params: readonly BlockParamJson[];
  readonly conditions: readonly BlockConditionJson[];
  /** Locked "Safety rule" lines (guard registry ids). */
  readonly guards: readonly string[];
  /** Locked "Also requires" lines. */
  readonly feasibility: readonly string[];
  readonly gateParams?: readonly BlockGateParamJson[];
  readonly effect?: BlockEffectJson;
  readonly branches?: readonly BlockBranchJson[];
  readonly reusableAlone: { readonly when: boolean; readonly if: boolean; readonly do: boolean };
  readonly provides?: readonly SlotId[];
  readonly requires?: readonly SlotId[];
  /** Why the class is a package or exempt ("Works as one piece"); absent for every other kind. */
  readonly packageReason?: string;
  /** How many (ability, attr) sites use the class. */
  readonly uses: number;
}

export interface BlocksJson {
  readonly schemaVersion: number;
  readonly vocabularyHash: string;
  readonly hash: string;
  readonly blocks: readonly BlockJson[];
}

export interface InstanceJson {
  readonly abilityId: number;
  readonly attrIndex: number;
  readonly block: string;
  /** Every declared param with its live value (or the default when the class has no way to read it back). */
  readonly params: Readonly<Record<string, ParamValue>>;
  /** Library IF tree per condition slot (`ctor:0`, `gate`, ...). */
  readonly conditions: Readonly<Record<string, unknown>>;
  /** Slots whose closure stays opaque, with the written reason. */
  readonly legacyClosures: Readonly<Record<string, string>>;
  readonly summary: string;
  /** Coverage bucket (spec section 4): full, partly, packageOnly, engineQuery. */
  readonly bucket: string;
}

export interface InstancesJson {
  readonly schemaVersion: number;
  readonly vocabularyHash: string;
  readonly blocksHash: string;
  readonly coverage: Readonly<Record<string, number>>;
  /** Classes without a declaration yet. Reported, never an error (the batches are still running). */
  readonly undeclared: {
    readonly classCount: number;
    readonly attrCount: number;
    readonly classes: readonly { readonly className: string; readonly uses: number }[];
  };
  readonly instances: readonly InstanceJson[];
}
