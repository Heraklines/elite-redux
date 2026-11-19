/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Every (abilityId, attrIndex) of the live game, and the per-batch filter the batch runner uses.
//
// The inventory is read from the LIVE ability list rather than from ~/er-probe/attr-inventory.json,
// so it can never go stale. The batch runner (scripts/decomp/run-batch.mjs) can still take its class
// list from an inventory/worklist file and hands it to the tests as DECOMP_CLASSES.

import type { AbAttr } from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";

export interface AttrSite {
  readonly abilityId: number;
  readonly abilityName: string;
  readonly attrIndex: number;
  readonly attr: AbAttr;
  readonly className: string;
}

/**
 * Ids from here up are harness shadows and test blueprints (rebuild.ts, blueprints.ts), never part of
 * the game inventory. The saved editor abilities (20000-28999) ARE part of the game.
 */
const TEST_ID_FLOOR = 29000;

export function liveAbilities(): Ability[] {
  return (allAbilities as (Ability | undefined)[]).filter(
    (ability): ability is Ability => ability !== undefined && ability.id < TEST_ID_FLOOR,
  );
}

export function allAttrSites(): AttrSite[] {
  const sites: AttrSite[] = [];
  for (const ability of liveAbilities()) {
    ability.attrs.forEach((attr, attrIndex) => {
      sites.push({
        abilityId: ability.id,
        abilityName: ability.name,
        attrIndex,
        attr,
        className: attr.constructor.name,
      });
    });
  }
  return sites;
}

export function sitesByClass(sites: readonly AttrSite[] = allAttrSites()): Map<string, AttrSite[]> {
  const byClass = new Map<string, AttrSite[]>();
  for (const site of sites) {
    const list = byClass.get(site.className);
    if (list === undefined) {
      byClass.set(site.className, [site]);
    } else {
      list.push(site);
    }
  }
  return byClass;
}

/** The distinct class names that appear in the game, sorted. */
export function liveClassNames(sites: readonly AttrSite[] = allAttrSites()): string[] {
  return [...sitesByClass(sites).keys()].sort();
}

/**
 * The per-batch class filter: `DECOMP_CLASSES=A,B,C` (set by run-batch.mjs). Undefined means
 * "everything" (the default for a plain test run).
 */
export function batchClassFilter(): ReadonlySet<string> | undefined {
  const raw = process.env.DECOMP_CLASSES;
  if (raw === undefined || raw.trim() === "") {
    return;
  }
  return new Set(
    raw
      .split(",")
      .map(name => name.trim())
      .filter(name => name.length > 0),
  );
}

/**
 * A studio rule carrier: an attr whose canApply/apply/getCondition were replaced on the instance by the rule
 * runtime (runtime-components.ts). Its behaviour is the composed rule, not the class's own rule, so a plain
 * declaration rebuild of it would drop that rule. Identity and differential checks skip it; the twin run
 * carries it over unchanged (rebuild.ts).
 */
export function isRuleCarrier(attr: AbAttr): boolean {
  return Object.hasOwn(attr, "canApply");
}

/** Sites whose class is in the batch (all sites when no batch is set), without studio rule carriers. */
export function batchSites(sites: readonly AttrSite[] = allAttrSites()): AttrSite[] {
  const filter = batchClassFilter();
  const inBatch = filter === undefined ? [...sites] : sites.filter(site => filter.has(site.className));
  return inBatch.filter(site => !isRuleCarrier(site.attr));
}

/** Distinct ability ids that use at least one class of the batch, ascending. */
export function batchAbilityIds(sites: readonly AttrSite[] = allAttrSites()): number[] {
  return [...new Set(batchSites(sites).map(site => site.abilityId))].sort((a, b) => a - b);
}
