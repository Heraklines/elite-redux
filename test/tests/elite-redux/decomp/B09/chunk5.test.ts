/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { AbAttr } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { injectionScopeCodec } from "#data/elite-redux/ability-studio/decl/B09/chunk5-codecs";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { MoveFlagInjectionAbAttr } from "#data/elite-redux/archetypes/move-flag-injection";
import { getErHeadCount, type ErMultiHeadedAbAttr } from "#data/elite-redux/archetypes/multi-headed";
import { OverrideMultiHitCountAbAttr } from "#data/elite-redux/archetypes/multi-hit-count-override";
import type { MovingFirstTrapFlinchAbAttr } from "#data/elite-redux/archetypes/moving-first-trap-flinch";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { type AttrSite, allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

// B09 chunk 5 probes for what the shared L1 and L2 cannot see:
//   1. MovingFirstTrapFlinch: the foe-acted flag both ways (original and rebuild), the guards that stop before the gate, the
//      first-strike rule of the flinch roll, and the ORDER of the trap tag and the random draw.
//   2. MoveFlagInjection: all five users read back, original and rebuild agree on every move, and the truth table through the
//      engine function Move.doesFlagEffectApply, including the one-directional Backstreet Boy.
//   3. ErMultiHeaded: the head count of each kind of species (flagged three, flagged two, not flagged, mega only), the hits added,
//      and that a rebuild keeps the class name the rest of the game looks for.
//   4. OverrideMultiHitCount: the Giant Shuriken override, a different move, and a rebuild from other settings.

const sitesOf = (className: string): AttrSite[] => allAttrSites().filter(site => site.className === className);
const moduleOf = (className: string) => declRegistry.get(className)!;

/** The first move that satisfies `test`. */
function firstMove(test: (move: (typeof allMoves)[number]) => boolean, what: string) {
  const move = allMoves.find(m => m != null && m.id !== MoveId.NONE && test(m));
  expect(move, what).toBeDefined();
  return move!;
}

/** A user whose only ability attrs are `attrs`: what Move.doesFlagEffectApply asks. */
const userWith = (...attrs: AbAttr[]) => ({ getAllActiveAbilityAttrs: () => attrs, hasAbilityWithAttr: () => false }) as never;

/** A status move with none of the properties the injections touch, found by its properties (the ER data may rework move ids). */
const plainStatusMove = () =>
  firstMove(
    m => m.category === MoveCategory.STATUS && !m.hasFlag(MoveFlags.DANCE_MOVE) && !m.hasFlag(MoveFlags.SOUND_BASED),
    "a plain status move",
  );

describe("B09 chunk 5 (move property injection, trap and flinch when moving first, hits per head, fixed hit count)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe("MovingFirstTrapFlinch (From the Shadows)", () => {
    const hit = (holder: unknown, foe: unknown, extra: Record<string, unknown> = {}) =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[MoveId.TACKLE],
        hitResult: HitResult.EFFECTIVE,
        damage: 10,
        simulated: false,
        ...extra,
      }) as never;

    it("reads back, and the foe-acted flag decides in the original and in the rebuild", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const sites = sitesOf("MovingFirstTrapFlinchAbAttr");
      expect(sites.map(site => `${site.abilityName} ${site.abilityId} ${site.attrIndex}`)).toEqual(["From the Shadows 5405 0"]);
      const module = moduleOf("MovingFirstTrapFlinchAbAttr");
      const original = sites[0].attr as MovingFirstTrapFlinchAbAttr;
      expect(readDeclParams(module, original)).toEqual({ flinchChance: 20, trapTurns: 4 });
      const rebuilt = recomposeAttr(module, original, 5405, 0) as MovingFirstTrapFlinchAbAttr;
      expect(rebuilt.constructor.name).toBe("MovingFirstTrapFlinchAbAttr");
      expect(rebuilt).not.toBe(original);

      for (const attr of [original, rebuilt]) {
        const which = attr === original ? "original" : "rebuild";
        // The foe has not acted: I moved first.
        foe.turnData.acted = false;
        expect(attr.canApply(hit(holder, foe)), `${which}: foe has not acted`).toBe(true);
        // The foe has acted: I did not move first.
        foe.turnData.acted = true;
        expect(attr.canApply(hit(holder, foe)), `${which}: foe has acted`).toBe(false);
        foe.turnData.acted = false;
        // The guards run before the gate: a status move, a negated hit and a missing target all stop it, and a missing
        // target must not reach the gate (it would read the target's turn data).
        expect(attr.canApply(hit(holder, foe, { move: plainStatusMove() })), `${which}: status move`).toBe(false);
        expect(attr.canApply(hit(holder, foe, { hitResult: HitResult.NO_EFFECT })), `${which}: negated hit`).toBe(false);
        expect(attr.canApply(hit(holder, foe, { hitResult: HitResult.MISS })), `${which}: missed`).toBe(false);
        expect(attr.canApply(hit(holder, undefined)), `${which}: no target`).toBe(false);
      }
      // A staff gate replaces only the gate: always true makes a foe that has acted qualify, the guards still hold.
      const replaced = recomposeAttr(module, original, 5405, 0) as MovingFirstTrapFlinchAbAttr;
      replaced.gateOverride = () => true;
      foe.turnData.acted = true;
      expect(replaced.canApply(hit(holder, foe))).toBe(true);
      expect(replaced.canApply(hit(holder, foe, { move: plainStatusMove() }))).toBe(false);
      foe.turnData.acted = false;
    });

    it("the trap is added on every strike, the flinch roll only on the first, and the trap comes before the draw", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const module = moduleOf("MovingFirstTrapFlinchAbAttr");
      const original = sitesOf("MovingFirstTrapFlinchAbAttr")[0].attr as MovingFirstTrapFlinchAbAttr;
      const rebuilt = recomposeAttr(module, original, 5405, 0) as MovingFirstTrapFlinchAbAttr;
      let log: string[] = [];
      const calls: unknown[][] = [];
      let roll = 0;
      vi.spyOn(foe, "addTag").mockImplementation(((...args: unknown[]) => {
        calls.push(args);
        log.push(args[0] === BattlerTagType.TRAPPED ? "trap" : args[0] === BattlerTagType.FLINCHED ? "flinch" : "other");
        return true;
      }) as never);
      vi.spyOn(holder, "randBattleSeedInt").mockImplementation(((range: number) => {
        log.push(`draw${range}`);
        return roll;
      }) as never);

      const run = (attr: AbAttr, count: number, left: number, drawn: number, simulated = false) => {
        holder.turnData.hitCount = count;
        holder.turnData.hitsLeft = left;
        roll = drawn;
        log = [];
        calls.length = 0;
        attr.apply(hit(holder, foe, { simulated }));
        return [...log];
      };
      for (const attr of [original, rebuilt]) {
        const which = attr === original ? "original" : "rebuild";
        // First strike of a two-hit move, roll 19 < 20: trap, one draw of 0-99, flinch.
        expect(run(attr, 2, 2, 19), `${which}: first strike, roll 19`).toEqual(["trap", "draw100", "flinch"]);
        expect(calls[0], `${which}: trap arguments`).toEqual([BattlerTagType.TRAPPED, 4, undefined, holder.id]);
        expect(calls[1], `${which}: flinch arguments`).toEqual([BattlerTagType.FLINCHED, 1, undefined, holder.id]);
        // Roll 20 is not below 20: trap only.
        expect(run(attr, 2, 2, 20), `${which}: first strike, roll 20`).toEqual(["trap", "draw100"]);
        // Second strike: the trap again, and NO draw at all.
        expect(run(attr, 2, 1, 0), `${which}: second strike`).toEqual(["trap"]);
        // A single-hit move is its own first strike.
        expect(run(attr, 1, 1, 5), `${which}: single hit`).toEqual(["trap", "draw100", "flinch"]);
        // Simulated: nothing happens, nothing is drawn.
        expect(run(attr, 2, 2, 0, true), `${which}: simulated`).toEqual([]);
      }
      vi.restoreAllMocks();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe("MoveFlagInjection (Taekkyeon, Backstreet Boy, Musical Notes, Festivities)", () => {
    const EXPECTED: Record<string, { flag: string; scope: string }> = {
      "Taekkyeon 5435 0": { flag: "DANCE_MOVE", scope: "All my damaging moves" },
      "Festivities 5543 0": { flag: "DANCE_MOVE", scope: "My sound moves" },
      "Festivities 5543 1": { flag: "SOUND_BASED", scope: "My dance moves" },
      "Musical Notes 5612 0": { flag: "SOUND_BASED", scope: "My status moves" },
      "Backstreet Boy 5675 2": { flag: "DANCE_MOVE", scope: "My kicking moves" },
    };
    const keyOf = (site: AttrSite) => `${site.abilityName} ${site.abilityId} ${site.attrIndex}`;

    it("all five users read back, and the rebuild injects exactly like the original on every move", async () => {
      await startWorld(phaserGame);
      const sites = sitesOf("MoveFlagInjectionAbAttr");
      expect(sites.map(keyOf).sort()).toEqual(Object.keys(EXPECTED).sort());
      const module = moduleOf("MoveFlagInjectionAbAttr");
      const flags = [
        MoveFlags.DANCE_MOVE,
        MoveFlags.SOUND_BASED,
        MoveFlags.KICKING_MOVE,
        MoveFlags.MAKES_CONTACT,
        MoveFlags.PUNCHING_MOVE,
      ];
      for (const site of sites) {
        const original = site.attr as MoveFlagInjectionAbAttr;
        expect(readDeclParams(module, original), keyOf(site)).toEqual(EXPECTED[keyOf(site)]);
        const rebuilt = recomposeAttr(module, original, site.abilityId, site.attrIndex) as MoveFlagInjectionAbAttr;
        expect(rebuilt.constructor.name).toBe("MoveFlagInjectionAbAttr");
        expect(rebuilt.showAbility, `${keyOf(site)} showAbility`).toBe(original.showAbility);
        let injected = 0;
        for (const move of allMoves) {
          if (move == null) {
            continue;
          }
          for (const flag of flags) {
            const expected = original.injects(flag, move);
            expect(rebuilt.injects(flag, move), `${keyOf(site)} ${move.name} ${MoveFlags[flag]}`).toBe(expected);
            injected += expected ? 1 : 0;
          }
        }
        expect(injected, `${keyOf(site)} injects for some moves`).toBeGreaterThan(0);
      }
    });

    it("the engine function sees the injected property exactly as each ability says", async () => {
      await startWorld(phaserGame);
      const byKey = (key: string) => sitesOf("MoveFlagInjectionAbAttr").find(site => keyOf(site) === key)!.attr;
      const tackle = allMoves[MoveId.TACKLE];
      const growl = plainStatusMove();
      const swordsDance = firstMove(
        m => m.category === MoveCategory.STATUS && m.hasFlag(MoveFlags.DANCE_MOVE) && !m.hasFlag(MoveFlags.SOUND_BASED),
        "a status dance move",
      );
      const hyperVoice = firstMove(
        m => m.category !== MoveCategory.STATUS && m.hasFlag(MoveFlags.SOUND_BASED) && !m.hasFlag(MoveFlags.DANCE_MOVE),
        "a damaging sound move",
      );
      const kick = firstMove(
        m => m.hasFlag(MoveFlags.KICKING_MOVE) && !m.hasFlag(MoveFlags.DANCE_MOVE) && m.category !== MoveCategory.STATUS,
        "a kicking move that is not a dance",
      );
      expect(tackle.hasFlag(MoveFlags.DANCE_MOVE)).toBe(false);
      expect(growl.category).toBe(MoveCategory.STATUS);
      const asks = (user: never, move: (typeof allMoves)[number], flag: MoveFlags) =>
        move.doesFlagEffectApply({ flag, user });

      // Taekkyeon: every damaging move is a dance, a status move that is not a dance stays what it is.
      const taekkyeon = userWith(byKey("Taekkyeon 5435 0"));
      expect(asks(taekkyeon, tackle, MoveFlags.DANCE_MOVE)).toBe(true);
      expect(asks(taekkyeon, kick, MoveFlags.DANCE_MOVE)).toBe(true);
      expect(asks(taekkyeon, growl, MoveFlags.DANCE_MOVE)).toBe(false);
      expect(asks(taekkyeon, swordsDance, MoveFlags.DANCE_MOVE)).toBe(true); // printed dance
      // Without the ability nothing is injected.
      expect(asks(userWith(), tackle, MoveFlags.DANCE_MOVE)).toBe(false);

      // Musical Notes: status moves are sound moves, damaging moves are not made sound.
      const notes = userWith(byKey("Musical Notes 5612 0"));
      expect(asks(notes, swordsDance, MoveFlags.SOUND_BASED)).toBe(true);
      expect(asks(notes, tackle, MoveFlags.SOUND_BASED)).toBe(false);

      // Festivities: both directions, each only from the PRINTED property.
      const festivities = userWith(byKey("Festivities 5543 0"), byKey("Festivities 5543 1"));
      expect(asks(festivities, hyperVoice, MoveFlags.DANCE_MOVE)).toBe(true);
      expect(asks(festivities, swordsDance, MoveFlags.SOUND_BASED)).toBe(true);
      expect(asks(festivities, tackle, MoveFlags.DANCE_MOVE)).toBe(false);
      expect(asks(festivities, tackle, MoveFlags.SOUND_BASED)).toBe(false);

      // Backstreet Boy: kicking moves are dances, and ONLY that direction is an injection (the open design issue, R-B09-38).
      const backstreet = userWith(byKey("Backstreet Boy 5675 2"));
      expect(asks(backstreet, kick, MoveFlags.DANCE_MOVE)).toBe(true);
      expect(asks(backstreet, tackle, MoveFlags.DANCE_MOVE)).toBe(false);
      expect(asks(backstreet, swordsDance, MoveFlags.KICKING_MOVE)).toBe(false);
      expect(asks(backstreet, kick, MoveFlags.KICKING_MOVE)).toBe(true); // printed kick, not an injection
    });

    it("a rebuild from other settings follows them (the scope words round-trip)", async () => {
      await startWorld(phaserGame);
      const module = moduleOf("MoveFlagInjectionAbAttr");
      const custom = new MoveFlagInjectionAbAttr(MoveFlags.SOUND_BASED, "all-moves");
      expect(readDeclParams(module, custom)).toEqual({ flag: "SOUND_BASED", scope: "All my moves, status moves too" });
      expect(custom.injects(MoveFlags.SOUND_BASED, allMoves[MoveId.TACKLE])).toBe(true);
      expect(custom.injects(MoveFlags.DANCE_MOVE, allMoves[MoveId.TACKLE])).toBe(false);
      for (const [words, scope] of [
        ["All my damaging moves", "all-attacks"],
        ["All my moves, status moves too", "all-moves"],
        ["My sound moves", "sound-moves"],
        ["My dance moves", "dance-moves"],
        ["My kicking moves", "kicking-moves"],
        ["My status moves", "status-moves"],
      ] as const) {
        expect(injectionScopeCodec.toCtor(words)).toBe(scope);
        expect(injectionScopeCodec.fromInstance(scope)).toBe(words);
      }
      expect(() => injectionScopeCodec.toCtor("my feet")).toThrow();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe("ErMultiHeaded (Multi-Headed, Hydra, 3 > 1, Hand Barnacles, Bodhisattva, Strong-Headed)", () => {
    const standIn = (speciesId: SpeciesId, formKey = "") =>
      ({ species: { speciesId }, getFormKey: () => formKey }) as never;

    it("the head count follows the species: three flagged, two flagged, two for an unflagged species, mega only for two", async () => {
      await startWorld(phaserGame);
      // Three-headed in the ROM.
      for (const id of [
        SpeciesId.DUGTRIO,
        SpeciesId.MAGNETON,
        SpeciesId.DODRIO,
        SpeciesId.EXEGGUTOR,
        SpeciesId.HYDREIGON,
        SpeciesId.BARBARACLE,
      ]) {
        expect(getErHeadCount(standIn(id)), SpeciesId[id]).toBe(3);
      }
      // Two-headed in the ROM, and a species the ROM does not flag at all (the default is 2, not 1 and not 3).
      for (const id of [SpeciesId.DODUO, SpeciesId.WEEZING, SpeciesId.GIRAFARIG, SpeciesId.KLINK, SpeciesId.PIKACHU]) {
        expect(getErHeadCount(standIn(id)), SpeciesId[id]).toBe(2);
      }
      // Mawile and Shuckle gain the third head only as a Mega.
      expect(getErHeadCount(standIn(SpeciesId.MAWILE))).toBe(2);
      expect(getErHeadCount(standIn(SpeciesId.MAWILE, SpeciesFormKey.MEGA))).toBe(3);
      expect(getErHeadCount(standIn(SpeciesId.SHUCKLE, SpeciesFormKey.MEGA))).toBe(3);
      // A Mega key on a species that has no mega entry falls back to its own count.
      expect(getErHeadCount(standIn(SpeciesId.DODUO, SpeciesFormKey.MEGA))).toBe(2);
      expect(getErHeadCount(standIn(SpeciesId.DUGTRIO, SpeciesFormKey.MEGA))).toBe(3);
    });

    it("all six users add heads minus one hits; the rebuild is the same class and does the same", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const sites = sitesOf("ErMultiHeadedAbAttr");
      expect(sites.map(site => `${site.abilityName} ${site.abilityId} ${site.attrIndex}`).sort()).toEqual(
        [
          "3 > 1 5717 0",
          "Bodhisattva 6076 0",
          "Hand Barnacles 5668 0",
          "Hydra 5630 0",
          "Multi-Headed 5085 0",
          "Strong-Headed 6087 0",
        ].sort(),
      );
      const module = moduleOf("ErMultiHeadedAbAttr");
      for (const site of sites) {
        const original = site.attr as ErMultiHeadedAbAttr;
        expect(readDeclParams(module, original), site.abilityName).toEqual({});
        const rebuilt = recomposeAttr(module, original, site.abilityId, site.attrIndex) as ErMultiHeadedAbAttr;
        expect(rebuilt.constructor.name, "other code finds it by this name").toBe("ErMultiHeadedAbAttr");
        expect(rebuilt.showAbility).toBe(original.showAbility);
        for (const [id, form, hits] of [
          [SpeciesId.DUGTRIO, "", 3],
          [SpeciesId.DODUO, "", 2],
          [SpeciesId.PIKACHU, "", 2],
          [SpeciesId.MAWILE, SpeciesFormKey.MEGA, 3],
        ] as const) {
          for (const attr of [original, rebuilt]) {
            const hitCount = new NumberHolder(1);
            attr.apply({ pokemon: standIn(id, form), hitCount } as never);
            expect(hitCount.value, `${site.abilityName} ${SpeciesId[id]} ${form}`).toBe(hits);
          }
        }
        // The inherited rule: damaging single-target moves qualify, status moves do not.
        for (const move of [allMoves[MoveId.TACKLE], plainStatusMove(), allMoves[MoveId.EARTHQUAKE]]) {
          const params = { pokemon: holder, opponent: foe, move, hitCount: new NumberHolder(1) } as never;
          expect(rebuilt.canApply(params), `${site.abilityName} ${move.name}`).toBe(original.canApply(params));
        }
        expect(original.canApply({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], hitCount: new NumberHolder(1) } as never)).toBe(true);
        expect(original.canApply({ pokemon: holder, opponent: foe, move: plainStatusMove(), hitCount: new NumberHolder(1) } as never)).toBe(false);
      }
      // The real holder of the harness is a plain species: it gets the default of two hits.
      const hitCount = new NumberHolder(1);
      (sites[0].attr as ErMultiHeadedAbAttr).apply({ pokemon: holder, hitCount } as never);
      expect(hitCount.value).toBe(getErHeadCount(holder));
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe("OverrideMultiHitCount (Giant Shuriken)", () => {
    it("forces the chosen move to the exact count and leaves every other move alone, in the original and in the rebuild", async () => {
      await startWorld(phaserGame);
      const sites = sitesOf("OverrideMultiHitCountAbAttr");
      expect(sites.map(site => `${site.abilityName} ${site.abilityId} ${site.attrIndex}`)).toEqual(["Giant Shuriken 5659 2"]);
      const module = moduleOf("OverrideMultiHitCountAbAttr");
      const original = sites[0].attr as OverrideMultiHitCountAbAttr;
      expect(readDeclParams(module, original)).toEqual({ moveId: "WATER_SHURIKEN", hits: 1 });
      const rebuilt = recomposeAttr(module, original, 5659, 2) as OverrideMultiHitCountAbAttr;
      expect(rebuilt.constructor.name, "the move phase finds it by this name").toBe("OverrideMultiHitCountAbAttr");
      for (const attr of [original, rebuilt]) {
        expect(attr.resolveHits(allMoves[MoveId.WATER_SHURIKEN])).toBe(1);
        expect(attr.resolveHits(allMoves[MoveId.TACKLE])).toBeNull();
        expect(attr.resolveHits(allMoves[MoveId.BULLET_SEED])).toBeNull();
      }
      // Other settings: Bullet Seed always three times.
      const custom = new OverrideMultiHitCountAbAttr({ moveId: MoveId.BULLET_SEED, hits: 3 });
      expect(readDeclParams(module, custom)).toEqual({ moveId: "BULLET_SEED", hits: 3 });
      expect(custom.resolveHits(allMoves[MoveId.BULLET_SEED])).toBe(3);
      expect(custom.resolveHits(allMoves[MoveId.WATER_SHURIKEN])).toBeNull();
      const rebuiltCustom = recomposeAttr(module, custom, 5659, 2) as OverrideMultiHitCountAbAttr;
      expect(rebuiltCustom.resolveHits(allMoves[MoveId.BULLET_SEED])).toBe(3);
    });
  });
});
