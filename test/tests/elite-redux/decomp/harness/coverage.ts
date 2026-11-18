/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// The coverage gate (spec section 4): every attr and every ability lands in exactly one bucket, and
// the three honest numbers are reported at both levels. A ratchet keeps completeness from falling.
//
// Attr buckets
//   full         a declaration exists (decomposed or verified), it is not a package, it has no remaining
//                guards or feasibility lines, it is not Tier C, and every condition slot it declares
//                has a library binding for THIS ability/attr (no legacy-closure, no missing binding).
//   partly       a declaration exists but guards, feasibility, Tier C or an unbound/legacy closure remain.
//   packageOnly  kind "package", or status "exempt" (the reason is lint-checked in notes).
//   engineQuery  kind "engine-query" (routed through abilityQuery; counted apart on purpose).
//   notStarted   no declaration, or status "todo".
//
// Ability buckets: noAttrs (nothing to decompose), full (every attr full), packageOnly (every attr is
// package/engine-query), notStarted (no attr has any progress), partly (everything else).

import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import type { DeclRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { type DeclModule, isAbsentOptional } from "#data/elite-redux/ability-studio/define-decl";
import type { AttrSite } from "./sites";

export type AttrBucket = "full" | "partly" | "packageOnly" | "engineQuery" | "notStarted";
export type AbilityBucket = "full" | "partly" | "packageOnly" | "notStarted" | "noAttrs";

export interface AttrBucketResult {
  readonly bucket: AttrBucket;
  /** Plain-language reasons the attr is not "full" (empty for full). */
  readonly why: readonly string[];
}

export function classifyAttr(site: AttrSite, module: DeclModule | undefined): AttrBucketResult {
  if (module === undefined || module.decl.status === "todo") {
    return { bucket: "notStarted", why: ["no declaration"] };
  }
  const { decl } = module;
  if (decl.kind === "engine-query") {
    return { bucket: "engineQuery", why: ["engine-query"] };
  }
  if (decl.kind === "package" || decl.status === "exempt") {
    return { bucket: "packageOnly", why: [decl.kind === "package" ? "package" : "exempt"] };
  }
  const why: string[] = [];
  if (decl.tier === "C") {
    why.push("Tier C (atomic)");
  }
  if (decl.guards.length > 0) {
    why.push(`guards remain: ${decl.guards.join(", ")}`);
  }
  if (decl.feasibility.length > 0) {
    why.push("feasibility checks stay in the class");
  }
  for (const slot of decl.conditions) {
    if (isAbsentOptional(site.attr, slot)) {
      continue;
    }
    const binding = getBinding(site.abilityId, site.attrIndex, slot.slot);
    if (binding === undefined) {
      why.push(`${slot.slot} has no binding`);
    } else if (binding.legacyClosure !== undefined) {
      why.push(`${slot.slot} is a legacy closure`);
    }
  }
  return { bucket: why.length === 0 ? "full" : "partly", why };
}

export interface ThreeNumbers {
  readonly full: number;
  readonly partly: number;
  readonly packageOnly: number;
  readonly engineQuery: number;
  readonly notStarted: number;
  readonly total: number;
}

export interface CoverageReport {
  readonly attrs: ThreeNumbers;
  readonly abilities: ThreeNumbers & { readonly noAttrs: number };
  /** Per class: declaration state and bucket counts. Sorted by class name. */
  readonly classes: readonly {
    readonly className: string;
    readonly uses: number;
    readonly status: string;
    readonly tier: string;
    readonly kind: string;
    readonly buckets: Readonly<Record<AttrBucket, number>>;
  }[];
  /** Ability id to bucket, ascending by id. */
  readonly abilityBuckets: Readonly<Record<string, AbilityBucket>>;
  /** Classes whose status is "verified". */
  readonly verifiedClasses: readonly string[];
}

function emptyNumbers(): Record<AttrBucket, number> {
  return { full: 0, partly: 0, packageOnly: 0, engineQuery: 0, notStarted: 0 };
}

export function abilityBucket(buckets: readonly AttrBucket[]): AbilityBucket {
  if (buckets.length === 0) {
    return "noAttrs";
  }
  if (buckets.every(b => b === "full")) {
    return "full";
  }
  if (buckets.every(b => b === "packageOnly" || b === "engineQuery")) {
    return "packageOnly";
  }
  if (buckets.every(b => b === "notStarted")) {
    return "notStarted";
  }
  return "partly";
}

export function computeCoverage(
  sites: readonly AttrSite[],
  registry: DeclRegistry,
  /** Every ability id of the game; ids without an attr site count as "noAttrs". */
  abilityIds: readonly number[] = [],
): CoverageReport {
  const attrCounts = emptyNumbers();
  const perClass = new Map<string, Record<AttrBucket, number>>();
  const classUses = new Map<string, number>();
  const perAbility = new Map<number, AttrBucket[]>();
  for (const site of sites) {
    const result = classifyAttr(site, registry.get(site.className));
    attrCounts[result.bucket]++;
    const counts = perClass.get(site.className) ?? emptyNumbers();
    counts[result.bucket]++;
    perClass.set(site.className, counts);
    classUses.set(site.className, (classUses.get(site.className) ?? 0) + 1);
    const list = perAbility.get(site.abilityId) ?? [];
    list.push(result.bucket);
    perAbility.set(site.abilityId, list);
  }
  const abilityCounts = { ...emptyNumbers(), noAttrs: 0 };
  const abilityBuckets: Record<string, AbilityBucket> = {};
  const everyAbility = [...new Set([...perAbility.keys(), ...abilityIds])].sort((a, b) => a - b);
  for (const id of everyAbility) {
    const bucket = abilityBucket(perAbility.get(id) ?? []);
    abilityBuckets[String(id)] = bucket;
    abilityCounts[bucket]++;
  }
  const classes = [...perClass.keys()].sort().map(className => {
    const module = registry.get(className);
    return {
      className,
      uses: classUses.get(className) ?? 0,
      status: module?.decl.status ?? "undeclared",
      tier: module?.decl.tier ?? "-",
      kind: module?.decl.kind ?? "-",
      buckets: perClass.get(className) ?? emptyNumbers(),
    };
  });
  return {
    attrs: { ...attrCounts, total: sites.length },
    abilities: { ...abilityCounts, total: everyAbility.length },
    classes,
    abilityBuckets,
    verifiedClasses: registry
      .all()
      .filter(module => module.decl.status === "verified")
      .map(module => module.className)
      .sort(),
  };
}

export interface Ratchet {
  /** Minimum numbers; completeness may rise, never fall. */
  readonly attrsFull: number;
  readonly attrsPartlyOrBetter: number;
  readonly abilitiesFull: number;
  /** Maximum number of attrs nobody has started on. */
  readonly attrsNotStartedMax: number;
  /** Classes that were verified once and must stay verified (or be exempt with sign-off, never deleted). */
  readonly verifiedClasses: readonly string[];
}

export function ratchetOf(report: CoverageReport): Ratchet {
  return {
    attrsFull: report.attrs.full,
    attrsPartlyOrBetter: report.attrs.full + report.attrs.partly + report.attrs.packageOnly + report.attrs.engineQuery,
    abilitiesFull: report.abilities.full,
    attrsNotStartedMax: report.attrs.notStarted,
    verifiedClasses: report.verifiedClasses,
  };
}

/** Plain-language ratchet violations; empty when completeness did not fall. */
export function ratchetViolations(report: CoverageReport, ratchet: Ratchet): string[] {
  const now = ratchetOf(report);
  const problems: string[] = [];
  if (now.attrsFull < ratchet.attrsFull) {
    problems.push(`fully decomposed attrs fell from ${ratchet.attrsFull} to ${now.attrsFull}`);
  }
  if (now.attrsPartlyOrBetter < ratchet.attrsPartlyOrBetter) {
    problems.push(`started attrs fell from ${ratchet.attrsPartlyOrBetter} to ${now.attrsPartlyOrBetter}`);
  }
  if (now.abilitiesFull < ratchet.abilitiesFull) {
    problems.push(`fully decomposed abilities fell from ${ratchet.abilitiesFull} to ${now.abilitiesFull}`);
  }
  if (now.attrsNotStartedMax > ratchet.attrsNotStartedMax) {
    problems.push(`attrs not started grew from ${ratchet.attrsNotStartedMax} to ${now.attrsNotStartedMax}`);
  }
  for (const className of ratchet.verifiedClasses) {
    if (!now.verifiedClasses.includes(className)) {
      problems.push(`${className} was verified and is no longer`);
    }
  }
  return problems;
}
