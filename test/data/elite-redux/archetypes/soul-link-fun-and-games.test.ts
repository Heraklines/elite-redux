/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Soul Linker (ER ability 332 = ReflectDamageOnDefend + SelfDamageOnAttack) is
// suppressed ONLY inside the Fun and Games (Wobbuffet) mystery encounter - the
// player taps the Wobbuffet down to a target HP, and Soul Linker's self-recoil /
// reflect would faint the player's mon and break the minigame. It works normally
// everywhere else. The shared SelfDamageOnAttack attr only suppresses the instance
// flagged soulLink:true, so Super Strain / Blood Price (same attr) are untouched.
// =============================================================================

import type { PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import type { BattleScene } from "#app/battle-scene";
import { initGlobalScene } from "#app/global-scene";
import { ReflectDamageOnDefendAbAttr } from "#data/elite-redux/archetypes/reflect-damage-on-defend";
import { SelfDamageOnAttackAbAttr } from "#data/elite-redux/archetypes/self-damage-on-attack";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { Pokemon } from "#field/pokemon";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const scene = { currentBattle: { mysteryEncounter: { encounterType: undefined as MysteryEncounterType | undefined } } };

function setEncounter(type: MysteryEncounterType | undefined): void {
  scene.currentBattle.mysteryEncounter.encounterType = type;
}

/** Params that satisfy the reflect attr's own checks (so non-FunAndGames => applies). */
function defendParams(): PostMoveInteractionAbAttrParams {
  const pokemon = { isFainted: () => false } as unknown as Pokemon;
  const attacker = { isFainted: () => false } as unknown as Pokemon;
  return { simulated: false, damage: 100, opponent: attacker, pokemon } as unknown as PostMoveInteractionAbAttrParams;
}

describe("Soul Linker suppression in Fun and Games (Wobbuffet)", () => {
  beforeAll(() => {
    initGlobalScene(scene as unknown as BattleScene);
  });
  beforeEach(() => {
    setEncounter(undefined);
  });

  it("the defensive reflect (Soul-Linker-only) is OFF in Fun and Games, ON otherwise", () => {
    const attr = new ReflectDamageOnDefendAbAttr();
    setEncounter(MysteryEncounterType.FUN_AND_GAMES);
    expect(attr.canApply(defendParams())).toBe(false);
    setEncounter(undefined);
    expect(attr.canApply(defendParams())).toBe(true);
    // A DIFFERENT encounter must not suppress it.
    setEncounter(MysteryEncounterType.DARK_DEAL);
    expect(attr.canApply(defendParams())).toBe(true);
  });

  it("Soul Linker's offensive self-damage (soulLink:true) is OFF in Fun and Games", () => {
    const soulLink = new SelfDamageOnAttackAbAttr({ basis: "damageDealt", fraction: 1.0, soulLink: true });
    setEncounter(MysteryEncounterType.FUN_AND_GAMES);
    // The soulLink gate short-circuits to false BEFORE the base damaging-move check
    // (so it returns without ever touching the absent stub move).
    expect(soulLink.canApply({ damage: 100 } as unknown as PostMoveInteractionAbAttrParams)).toBe(false);
  });

  it("a non-Soul-Linker SelfDamageOnAttack (Super Strain) is NOT short-circuited by the gate", () => {
    // soulLink defaults false, so the Fun-and-Games early-return never fires; control
    // falls through to the base damaging-move check (which here reads the absent stub
    // move and throws - proving the gate did NOT short-circuit it first).
    const superStrain = new SelfDamageOnAttackAbAttr({ basis: "damageDealt", fraction: 0.25 });
    setEncounter(MysteryEncounterType.FUN_AND_GAMES);
    expect(() => superStrain.canApply({ damage: 100 } as unknown as PostMoveInteractionAbAttrParams)).toThrow();
  });
});
