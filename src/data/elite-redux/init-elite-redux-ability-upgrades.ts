/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  DrenchImmunityAbAttr,
  FieldPriorityMoveImmunityAbAttr,
  IntimidateImmunityAbAttr,
  MoveImmunityAbAttr,
  MovePowerBoostAbAttr,
  MoveTypeChangeAbAttr,
  PostAttackApplyBattlerTagAbAttr,
  PostSummonStatStageChangeAbAttr,
  ReceivedTypeDamageMultiplierAbAttr,
} from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import { globalScene } from "#app/global-scene";
import { allAbilities, allMoves } from "#data/data-lists";
import {
  AttackerTypeDamageReductionAbAttr,
  appendAbilityAttrsOnce,
  BreakScreensOnAttackAbAttr,
  ChancePostAttackStealHeldItemAbAttr,
  ExperienceGainMultiplierAbAttr,
  FaintedAllyStatMultiplierAbAttr,
  FieldPoisonWeaknessOnEntryAbAttr,
  FirstTurnDirectDamageMultiplierAbAttr,
  FullHpMoveTypeDamageReductionAbAttr,
  IgnoreOptionalMoveEffectsAbAttr,
  MoveHpCostModifierAbAttr,
  OnceLowHpStatRaiseAbAttr,
  OnDirectFaintRetaliationAbAttr,
  onSuccessfulStatDrop,
  PostDefendAddTagAbAttr,
  PreLeaveFieldRemoveLinkedTailwindAbAttr,
  ReverseNegativeStatChangesAbAttr,
  replaceAbilityAttrsOnce,
  replaceMatchingAbilityAttrOnce,
  SameTypeStabOtherwiseBoostAbAttr,
  TelekineticStruggleOnEntryAbAttr,
  TypeImmunityHigherDefenseStatRaiseAbAttr,
  UserFieldIgnoreOptionalMoveEffectsAbAttr,
} from "#data/elite-redux/ability-upgrades/attrs/index";
import { hasCommandAbilityProvenance } from "#data/elite-redux/ability-upgrades/attrs/innate-slot-suppression";
import { resolveRequestedMoveType } from "#data/elite-redux/ability-upgrades/requested-field-effects";
import { AttackStatSubstituteAbAttr } from "#data/elite-redux/archetypes/attack-stat-substitute";
import {
  ChanceBattlerTagOnAttackAbAttr,
  ChanceBattlerTagOnHitAbAttr,
} from "#data/elite-redux/archetypes/chance-status-on-hit";
import { ConditionalAlwaysHitAbAttr } from "#data/elite-redux/archetypes/conditional-always-hit";
import { CopyMoveByFilterAbAttr } from "#data/elite-redux/archetypes/copy-move-by-filter";
import { CounterAttackOnHitAbAttr } from "#data/elite-redux/archetypes/counter-attack-on-hit";
import { CritDamageMultiplierAbAttr } from "#data/elite-redux/archetypes/crit-mod";
import { DamageReductionAbAttr } from "#data/elite-redux/archetypes/damage-reduction-generic";
import { FirstTurnStatMultiplierAbAttr } from "#data/elite-redux/archetypes/first-turn-stat-multiplier";
import { HitMultiplierAbAttr, HitMultiplierPowerAbAttr } from "#data/elite-redux/archetypes/hit-multiplier";
import { PassiveRecoveryAbAttr } from "#data/elite-redux/archetypes/passive-recovery";
import { PostAttackScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-attack-scripted-move";
import { PostSummonQuashFoesAbAttr } from "#data/elite-redux/archetypes/post-summon-quash-foes";
import { PostSummonScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-summon-scripted-move";
import { PostTurnDrainAbAttr } from "#data/elite-redux/archetypes/post-turn-drain";
import { RepeatMovePowerBoostAbAttr } from "#data/elite-redux/archetypes/repeat-move-power-boost";
import { StabAddAbAttr } from "#data/elite-redux/archetypes/stab-add";
import {
  ActivateOncePerBattleEntryWindowAbAttr,
  TimeLimitedEffectivenessFloorAbAttr,
} from "#data/elite-redux/archetypes/time-limited-effectiveness-floor";
import { TrapDurationModifierAbAttr } from "#data/elite-redux/archetypes/trap-duration-modifier";
import { TypeDamageBoostAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import { WeatherBasedMoveBlockAbAttr } from "#data/elite-redux/archetypes/weather-based-move-block";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";

interface AbilityUpgradeResult {
  applied: number;
  missingDraftIds: number[];
}

const CUSTOM_DESCRIPTIONS: ReadonlyMap<number, string> = new Map([
  [369, "All other Pokemon on the field deal 33% less damage."],
  [
    250,
    "Terrain-based moves use the higher offense. Terrain Pulse gains STAB and chooses the strongest of Psychic, Fairy, Poison, Electric, or Grass.",
  ],
  [411, "On entry, every active Pokemon becomes weak to Poison-type moves until it switches out."],
  [461, "Uses Tickle on entry. After lowering a target's stats, follows up with a 20 BP Covet."],
  [
    511,
    "On entry, eligible opposing Pokemon must use Struggle for one turn. Psychic, Dark, Heavy Metal, and Superheavy Pokemon are immune.",
  ],
  [479, "Ability-provided perfect accuracy is disabled for all Pokemon. The holder can always flee from wild battles."],
  [518, "On contact, steals up to 4 PP from the used move and restores it to one random depleted move."],
  [559, "On fainting, sharply lowers the attacker's Attack and Sp. Atk and lowers those stats for its allies."],
  [611, "Confusion may also infatuate foes. Confusion self-damage dealt to opposing Pokemon restores the holder's HP."],
  [650, "Physical moves deal 20% more damage, may burn or poison on contact, and apply Grip Pincer's binding."],
  [652, "Food-based Pokemon deal half damage to the holder and take 1.5x damage from it."],
  [893, "Creates a Sea of Fire on entry. Pokemon caught in it cannot switch until it ends."],
  [358, "While enraged, damaging moves strike again at 25% power."],
  [278, "Ice, Flying, and Water-type moves get a 1.3x power boost."],
  [478, "Fairy- and Dark-type moves gain STAB. Moonlight restores 75% HP. Takes half damage from Water-type moves."],
  [485, "Cures party status on entry. The holder and each adjacent ally recover 1/16 of their maximum HP each turn."],
  [514, "Casts Powder on entry and is immune to powder moves."],
  [545, "Copies sound moves used by others and is immune to sound-based moves."],
  [546, "Traps opposing Pokemon. If one escapes by any switching method, its replacement is Salt Cured."],
  [557, "Doubles direct move damage on the first turn after entering battle."],
  [591, "Recovers 1/8 of its maximum HP each turn under Misty Terrain."],
  [596, "Sound moves have a 30% disable chance, increased to 100% if the target used a sound move earlier that turn."],
  [603, "Boosts Grass moves by 50% and recovers 1/8 of its maximum HP each turn in Grassy Terrain."],
  [616, "Doubles direct move damage on the first turn, ignores Protect on that turn, and removes screens on entry."],
  [651, "Recovers 1/8 of its maximum HP each turn under Misty Terrain and restores 1/3 HP when switching out."],
  [662, "Priority moves deal 30% more damage."],
  [
    686,
    "Heals its partner by 25% and cures party status on entry. The holder and adjacent allies recover 1/16 HP each turn.",
  ],
  [700, "Same-type attacks get a 1.2x boost, all moves gain STAB, and the user changes type each turn."],
  [711, "Copies moves with Star, Moon, or Lunar in their name and suppresses opposing abilities from those families."],
  [839, "Uses Defog on entry and negates enemy weather-based moves."],
  [848, "Steadfast, blocks phasing moves, and gains Heavy Metal, including halved sound damage."],
  [429, "Retains its retreat trigger and guarantees escape from wild battles."],
  [335, "Curses a direct-damage attacker on fainting. Its attacks also have a 10% chance to Curse."],
  [687, "Punching moves restore 1/4 of the damage dealt."],
  [751, "Horn moves use Sp. Atk, deal 30% more damage, and restore 1/8 of damage dealt."],
  [879, "Counters contact with a 13 BP Icicle Spear. Its attacks also have a 10% chance to badly poison."],
  [892, "Contact has a 30% chance to burn or frostbite, both when attacking and when being hit."],
  [564, "Retains its tactical switch effect and guarantees escape from wild battles."],
  [
    875,
    "Heals for 1/8 of damage dealt, or 1/4 when the target is Electric- or Fire-type. Liquid Ooze reverses this recovery.",
  ],
  [300, "Changes Normal moves to Fighting and grants Scrappy."],
  [304, "Psychic-type attacks also inflict Commanded on the target."],
  [321, "Contact moves add 20% of Defense to Attack, grant paralysis immunity, and break screens."],
  [384, "Uses a 40 BP Feint Attack on entry; Feint Attack has a 30% chance to steal an item."],
  [428, "Uses Scratch on entry; Scratch has a 30% chance to steal an item."],
  [375, "Punching moves gain +1 critical-hit stage, have five times their secondary-effect chance, and break screens."],
  [
    389,
    "Deals 50% more damage to Water-type Pokemon, gains Infiltrator, and takes half damage from Water-type Pokemon.",
  ],
  [463, "Uses Sun Basking while Grassy Terrain is active."],
  [498, "Casts Torment and Quash on opposing Pokemon when entering battle."],
  [504, "Uses Heart Swap on entry and reverses negative stat changes received."],
  [538, "Any attack that hits the holder has a 30% chance to inflict bleed on the attacker."],
  [553, "Counters every direct hit with a 30 BP Bite."],
  [570, "Drains the PP of the move that defeats it and inflicts Torment on the direct-damage attacker."],
  [523, "Every damaging move binds its target for four turns and deals 1/4 maximum HP each turn."],
  [640, "Repeated sound moves gain 20% power per consecutive use."],
  [663, "Damages non-Ghost, non-Dark, and non-Fire Pokemon by 1/4 maximum HP each turn."],
  [717, "Uses a 50 BP Fire Spin on entry; its Fire Spin deals 1/6 maximum HP each turn."],
  [730, "Critical-hit-capable moves gain the Keen Edge boost and critical hits inflict bleed."],
  [731, "Critical-hit-capable moves gain the Keen Edge boost."],
  [780, "Moves activated by Quick Draw or Quick Claw are 20% stronger, including healing pulse moves."],
  [784, "Uses a 50 BP Whirlpool on entry, cannot miss, is immune to Drench, and drains 1/6 max HP from trapped foes."],
  [785, "Retains its Electric and Dark boosts. Full Belly adds Galvanize; Hangry adds Deviate."],
  [808, "Contact attacks trigger a 20 BP Poison Gas follow-up."],
  [812, "Normal moves become sound moves; sound moves trigger a 20 BP Round follow-up."],
  [
    815,
    "Critical hits overrule defensive abilities and resistances, and the holder ignores adjacent attack reductions.",
  ],
  [837, "Every damaging move binds its target for four turns and deals 1/4 maximum HP each turn."],
  [847, "Becomes Charged when hit by an Electric-type move."],
  [869, "Creates harsh sunlight and a three-turn Tailwind with one shared lifetime. Tailwind can restore the sun."],
  [883, "Rock, Steel, and Fighting moves deal 50% more damage."],
  [932, "Weakens the first hit received; at full HP, Dragon-type damage is also halved."],
  [957, "Halves damage at full HP. When hit, has a 50% chance to use Drain Brain with half healing."],
  [954, "On a direct-damage faint, uses Gastro Acid on the attacker."],
  [974, "Follows attacks with a 20 BP Rapid Spin and also counters incoming sound moves with it."],
  [987, "Blocks priority moves and halves special damage while rain is active."],
  [1006, "Uses Ion Deluge when entering battle."],
  [1009, "Using an Ice-type move triggers a 40 BP Breaking Swipe follow-up."],
  [
    1028,
    "Deals 50% more damage to Grass-type Pokemon, gains Infiltrator, and takes half damage from Grass-type Pokemon.",
  ],
]);

function getErAbility(draftId: number): Ability | undefined {
  const runtimeId = ER_ID_MAP.abilities[draftId];
  return runtimeId === undefined ? undefined : allAbilities[runtimeId];
}

function setCustomDescription(ability: Ability, draftId: number): void {
  const description = CUSTOM_DESCRIPTIONS.get(draftId);
  if (description === undefined) {
    return;
  }

  Object.defineProperty(ability, "description", {
    configurable: true,
    enumerable: true,
    value: description,
    writable: false,
  });
}

function setAbilityName(ability: Ability, name: string): void {
  Object.defineProperty(ability, "name", {
    configurable: true,
    enumerable: true,
    value: name,
    writable: false,
  });
}

export function initEliteReduxAbilityUpgrades(): AbilityUpgradeResult {
  const result: AbilityUpgradeResult = { applied: 0, missingDraftIds: [] };

  const patch = (draftId: number, apply: (ability: Ability) => number): void => {
    const ability = getErAbility(draftId);
    if (ability === undefined) {
      result.missingDraftIds.push(draftId);
      return;
    }
    result.applied += apply(ability);
    setCustomDescription(ability, draftId);
  };
  const patchVanilla = (
    id: AbilityId,
    key: string,
    factories: Parameters<typeof appendAbilityAttrsOnce>[2],
    description?: string,
  ): void => {
    const ability = allAbilities[id];
    result.applied += Number(appendAbilityAttrsOnce(ability, key, factories));
    if (description !== undefined) {
      Object.defineProperty(ability, "description", {
        configurable: true,
        enumerable: true,
        value: description,
        writable: false,
      });
    }
  };
  patchVanilla(
    AbilityId.AURA_BREAK,
    "upgrade:aura-break:field-suppression",
    [],
    "Weakens Aura moves by 25% and suppresses opposing Battle Aura and Aura Armor.",
  );

  patch(545, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:parroting:sound-immunity", [
        () =>
          new MoveImmunityAbAttr(
            (pokemon, attacker, move) =>
              pokemon !== attacker && move.doesFlagEffectApply({ flag: MoveFlags.SOUND_BASED, user: attacker }),
          ),
      ]),
    ),
  );
  patch(546, () => 0);
  patch(250, ability => {
    const terrainMoves = [
      MoveId.TERRAIN_PULSE,
      MoveId.EXPANDING_FORCE,
      MoveId.RISING_VOLTAGE,
      MoveId.MISTY_EXPLOSION,
      MoveId.GRASSY_GLIDE,
      MoveId.PSYBLADE,
    ];
    return Number(
      appendAbilityAttrsOnce(ability, "upgrade:mimicry:terrain-offense", [
        () => new AttackStatSubstituteAbAttr({ useHigherOffense: true, moveIds: terrainMoves }),
        () =>
          new MovePowerBoostAbAttr(
            (user, target, move) =>
              move.id === MoveId.TERRAIN_PULSE
              && target !== null
              && !user.isOfType(resolveRequestedMoveType(user, target, move, user.getMoveType(move))),
            1.5,
          ),
      ]),
    );
  });
  patch(652, () => 0);
  patch(711, ability => {
    const lunarMoveIds = allMoves.flatMap(move =>
      move !== undefined && /(?:star|moon|lunar)/i.test(move.name) ? [move.id] : [],
    );
    return Number(
      replaceAbilityAttrsOnce(ability, "upgrade:lunar-affinity:all-lunar-moves", [
        () => new CopyMoveByFilterAbAttr({ moveIds: lunarMoveIds }),
      ]),
    );
  });
  patch(411, ability =>
    Number(
      replaceAbilityAttrsOnce(ability, "upgrade:toxic-spill:field-poison-weakness", [
        () => new FieldPoisonWeaknessOnEntryAbAttr(),
      ]),
    ),
  );
  patch(461, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:monkey-business:covet-follow-up", [
        () =>
          new PostAttackScriptedMoveAbAttr({
            moveId: MoveId.COVET,
            power: 20,
            triggerMoveIds: [MoveId.TICKLE],
            allowVirtualTriggerMoveId: MoveId.TICKLE,
          }),
      ]),
    ),
  );
  patch(511, ability =>
    Number(
      replaceAbilityAttrsOnce(ability, "upgrade:telekinetic:one-turn-struggle", [
        () => new TelekineticStruggleOnEntryAbAttr(),
      ]),
    ),
  );
  patch(479, ability =>
    Number(
      replaceAbilityAttrsOnce(
        ability,
        "upgrade:dust-cloud:accuracy-and-run-away",
        allAbilities[AbilityId.RUN_AWAY].attrs.map(attr => () => attr),
      ),
    ),
  );
  patch(278, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:antarctic-bird:water-boost", [
        () => new TypeDamageBoostAbAttr({ type: PokemonType.WATER, multiplier: 1.3 }),
      ]),
    ),
  );
  patch(478, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:moon-spirit:water-resist", [
        () => new ReceivedTypeDamageMultiplierAbAttr(PokemonType.WATER, 0.5),
      ]),
    ),
  );
  // Soothing Aroma's recovery is part of its canonical dispatcher output so
  // composites such as Butter Up inherit it during recursive resolution.
  patch(485, () => 0);
  patch(686, () => 0);
  patch(839, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:neutralizing-fog:weather-control", [
        () => new WeatherBasedMoveBlockAbAttr(),
      ]),
    ),
  );
  patch(700, ability =>
    Number(appendAbilityAttrsOnce(ability, "upgrade:color-spectrum:mystic-power", [() => new StabAddAbAttr()])),
  );
  patch(662, ability =>
    Number(
      replaceMatchingAbilityAttrOnce(
        ability,
        "upgrade:higher-rank:priority-boost",
        attr => attr instanceof MovePowerBoostAbAttr && attr.getPowerMultiplier() === 1.2,
        () => new MovePowerBoostAbAttr((_user, _target, move) => (move?.priority ?? 0) > 0, 1.3),
      ),
    ),
  );
  patch(603, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:flourish:grassy-recovery", [
        () =>
          new PassiveRecoveryAbAttr({
            healFraction: 1 / 8,
            condition: { kind: "terrain", terrains: [TerrainType.GRASSY] },
          }),
      ]),
    ),
  );
  patch(591, ability =>
    Number(
      replaceMatchingAbilityAttrOnce(
        ability,
        "upgrade:celestial-blessing:recovery",
        attr => {
          if (!(attr instanceof PassiveRecoveryAbAttr)) {
            return false;
          }
          const condition = attr.getRecoveryCondition();
          return condition.kind === "terrain" && condition.terrains.includes(TerrainType.MISTY);
        },
        () =>
          new PassiveRecoveryAbAttr({
            healFraction: 1 / 8,
            condition: { kind: "terrain", terrains: [TerrainType.MISTY] },
          }),
      ),
    ),
  );
  patch(596, ability =>
    Number(
      replaceAbilityAttrsOnce(ability, "upgrade:radio-jam:ordered-disable", [
        () =>
          new ChanceBattlerTagOnAttackAbAttr({
            chance: 30,
            tags: [BattlerTagType.DISABLED],
            filter: { flag: MoveFlags.SOUND_BASED },
            chanceResolver: (_holder, target) => {
              const previousMove = target.getLastXMoves(1)[0];
              return target.turnData.acted
                && previousMove
                && allMoves[previousMove.move]?.hasFlag(MoveFlags.SOUND_BASED)
                ? 100
                : 30;
            },
          }),
      ]),
    ),
  );
  patch(651, () => 0);

  for (const draftId of [557, 616]) {
    patch(draftId, ability =>
      Number(
        replaceMatchingAbilityAttrOnce(
          ability,
          `upgrade:${draftId}:first-turn-direct-damage`,
          attr => attr instanceof FirstTurnStatMultiplierAbAttr && attr.stat === Stat.ATK && attr.multiplier === 2,
          () => new FirstTurnDirectDamageMultiplierAbAttr(2),
        ),
      ),
    );
  }

  patch(514, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:powder-burst:powder-immunity", [
        () =>
          new MoveImmunityAbAttr(
            (pokemon, attacker, move) => pokemon !== attacker && move.hasFlag(MoveFlags.POWDER_MOVE),
          ),
      ]),
    ),
  );

  // Heavy Metal is a canonical Superheavy composite part so every refresh
  // rebuilds the full package instead of relying on a persistent patch marker.
  patch(848, () => 0);
  patch(850, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:lucky-wings:experience", [
        () => new ExperienceGainMultiplierAbAttr(1.2),
      ]),
    ),
  );
  for (const draftId of [429, 564]) {
    patch(draftId, ability =>
      Number(
        appendAbilityAttrsOnce(
          ability,
          `upgrade:${draftId}:run-away`,
          allAbilities[AbilityId.RUN_AWAY].attrs.map(attr => () => attr),
        ),
      ),
    );
  }
  patch(875, () => 0);
  for (const draftId of [335, 687, 751, 879, 892]) {
    patch(draftId, () => 0);
  }

  patchVanilla(
    AbilityId.INTIMIDATE,
    "upgrade:intimidate:successful-drop-fear",
    [],
    "Lowers adjacent foes' Attack on entry; each successful drop has a 10% chance to inflict Fear.",
  );
  result.applied += Number(
    replaceMatchingAbilityAttrOnce(
      allAbilities[AbilityId.INTIMIDATE],
      "upgrade:intimidate:successful-drop-fear:replace",
      attr => attr instanceof PostSummonStatStageChangeAbAttr,
      () =>
        new PostSummonStatStageChangeAbAttr(
          [Stat.ATK],
          -1,
          false,
          true,
          onSuccessfulStatDrop(target => {
            if (target.randBattleSeedInt(100) < 10) {
              target.addTag(BattlerTagType.ER_FEAR, 2);
            }
          }),
        ),
    ),
  );
  patchVanilla(
    AbilityId.IMPOSTER,
    "upgrade:imposter:copied-attacks",
    [],
    "Transforms into the opponent on entry; while transformed, copied attacks deal 30% more damage.",
  );
  patchVanilla(
    AbilityId.SHED_SKIN,
    "upgrade:shed-skin:shed-tail-cost",
    [() => new MoveHpCostModifierAbAttr([MoveId.SHED_TAIL], 1 / 3)],
    "May cure status at the end of each turn. Shed Tail costs 1/3 of maximum HP.",
  );
  patchVanilla(
    AbilityId.GLUTTONY,
    "upgrade:gluttony:contact-berry-steal",
    [
      () =>
        new ChancePostAttackStealHeldItemAbAttr({
          chance: 30,
          berryOnly: true,
          contactRequired: true,
        }),
    ],
    "Uses berries early. Contact attacks have a 30% chance to steal a berry.",
  );
  patchVanilla(
    AbilityId.AROMA_VEIL,
    "upgrade:aroma-veil:optional-secondary-immunity",
    [() => new IgnoreOptionalMoveEffectsAbAttr(), () => new UserFieldIgnoreOptionalMoveEffectsAbAttr()],
    "Protects the holder and its allies from mental effects and non-guaranteed secondary effects.",
  );
  patchVanilla(
    AbilityId.FOREWARN,
    "upgrade:forewarn:two-turn-soothsayer",
    [
      () => new ActivateOncePerBattleEntryWindowAbAttr("upgrade:forewarn:two-turn-soothsayer"),
      () =>
        new TimeLimitedEffectivenessFloorAbAttr({
          turns: 2,
          activeWindowKey: "upgrade:forewarn:two-turn-soothsayer",
        }),
    ],
    "Reveals an opposing move and treats attacks as not very effective for the first two turns once per battle.",
  );
  patchVanilla(
    AbilityId.DEFEATIST,
    "upgrade:defeatist:ten-percent-comeback",
    [
      () =>
        new OnceLowHpStatRaiseAbAttr(
          "requested:defeatist:ten-percent-comeback",
          0.1,
          [Stat.ATK, Stat.SPATK, Stat.SPD],
          2,
        ),
    ],
    "Retains its offensive reductions at low HP. Once per battle, dropping to 10% HP raises Attack, Sp. Atk, and Speed by two stages.",
  );
  patchVanilla(
    AbilityId.RAIN_DISH,
    "upgrade:rain-dish:water-defense-absorb",
    [() => new TypeImmunityHigherDefenseStatRaiseAbAttr(PokemonType.WATER)],
    "Recovers HP in rain. Water-type moves are blocked and raise the holder's higher defensive stat.",
  );

  patch(292, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:avenger:fainted-ally-offenses", [
        () => new FaintedAllyStatMultiplierAbAttr(Stat.ATK),
        () => new FaintedAllyStatMultiplierAbAttr(Stat.SPATK),
      ]),
    ),
  );

  for (const draftId of [358, 721, 755, 790, 961, 999]) {
    patch(draftId, ability => {
      let changed = 0;
      for (const attr of ability.attrs) {
        if (
          (attr instanceof HitMultiplierAbAttr && attr.getExtraStrikes() === 1)
          || (attr instanceof HitMultiplierPowerAbAttr && attr.isExtraStrikesOnly() && attr.getMultiplier() === 0.25)
        ) {
          attr.addCondition(pokemon => pokemon.getTag(BattlerTagType.ER_ENRAGE) != null);
          changed++;
        }
      }
      return changed;
    });
  }

  patch(300, ability => {
    const retained = ability.attrs.filter(attr => attr.constructor.name !== "RemoveScreensOnTypedAttackAbAttr");
    return Number(
      replaceAbilityAttrsOnce(ability, "upgrade:fighting-spirit:scrappy", [
        ...retained.map(attr => () => attr),
        ...allAbilities[AbilityId.SCRAPPY].attrs.map(attr => () => attr),
      ]),
    );
  });
  patch(304, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:magical-dust:commanded", [
        () =>
          new ChanceBattlerTagOnAttackAbAttr({
            chance: 100,
            tags: [BattlerTagType.ER_COMMANDED],
            contactRequired: false,
            filter: { type: PokemonType.PSYCHIC },
          }),
      ]),
    ),
  );
  patch(321, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:juggernaut:break-screens", [
        () => new BreakScreensOnAttackAbAttr({ contactRequired: true }),
      ]),
    ),
  );
  patch(375, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:precise-fist:break-screens", [
        () => new BreakScreensOnAttackAbAttr({ flag: MoveFlags.PUNCHING_MOVE }),
      ]),
    ),
  );
  patch(384, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:low-blow:feint-attack-steal", [
        () => new ChancePostAttackStealHeldItemAbAttr({ chance: 30, moveIds: [MoveId.FEINT_ATTACK] }),
      ]),
    ),
  );
  patch(428, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:cheap-tactics:scratch-steal", [
        () => new ChancePostAttackStealHeldItemAbAttr({ chance: 30, moveIds: [MoveId.SCRATCH] }),
      ]),
    ),
  );
  patch(389, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:marine-apex:water-attacker-resist", [
        () => new AttackerTypeDamageReductionAbAttr(PokemonType.WATER),
      ]),
    ),
  );
  patch(498, ability =>
    Number(appendAbilityAttrsOnce(ability, "upgrade:suppress:quash", [() => new PostSummonQuashFoesAbAttr()])),
  );
  patch(504, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:change-of-heart:reverse-drops", [
        () => new ReverseNegativeStatChangesAbAttr(),
      ]),
    ),
  );
  patch(538, ability =>
    Number(
      replaceAbilityAttrsOnce(ability, "upgrade:voodoo-power:all-attacks", [
        () =>
          new ChanceBattlerTagOnHitAbAttr({
            chance: 30,
            tags: [BattlerTagType.ER_BLEED],
            contactRequired: false,
          }),
      ]),
    ),
  );
  patch(553, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:guard-dog:bite-counter", [
        () => new CounterAttackOnHitAbAttr({ moveId: MoveId.BITE, power: 30 }),
      ]),
    ),
  );
  patch(570, ability => {
    const applied = appendAbilityAttrsOnce(ability, "upgrade:ill-will:torment-attacker", [
      () => new OnDirectFaintRetaliationAbAttr(MoveId.TORMENT),
    ]);
    if (applied) {
      ability.makeBypassFaint();
    }
    return Number(applied);
  });
  patch(523, ability =>
    Number(
      replaceAbilityAttrsOnce(ability, "upgrade:grappler:all-move-binding", [
        () =>
          new ChanceBattlerTagOnAttackAbAttr({
            chance: 100,
            tags: [BattlerTagType.BIND],
            contactRequired: false,
            turns: 4,
            damageDenominator: 4,
          }),
      ]),
    ),
  );
  patch(640, ability =>
    Number(
      replaceMatchingAbilityAttrOnce(
        ability,
        "upgrade:rhythmic:sound-repeat-20",
        attr => attr instanceof RepeatMovePowerBoostAbAttr,
        () => new RepeatMovePowerBoostAbAttr({ bonus: 0.2, flag: MoveFlags.SOUND_BASED }),
      ),
    ),
  );
  patch(717, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:wildfire:fire-spin-sixth", [
        () => new TrapDurationModifierAbAttr({ turns: 4, damageFraction: 1 / 6, moveIds: [MoveId.FIRE_SPIN] }),
      ]),
    ),
  );
  for (const draftId of [730, 731]) {
    patch(draftId, ability =>
      Number(
        appendAbilityAttrsOnce(ability, `upgrade:${draftId}:crit-keen-edge`, [
          () => new CritDamageMultiplierAbAttr({ multiplier: 1.3 }),
        ]),
      ),
    );
  }
  patch(780, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:gunman:quick-proc-boost", [
        () =>
          new MovePowerBoostAbAttr(
            user =>
              hasCommandAbilityProvenance(user, "quick-draw:proc")
              || hasCommandAbilityProvenance(user, "quick-claw:proc"),
            1.2,
          ),
      ]),
    ),
  );
  patch(784, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:poseidon:dominion-riders", [
        () => new DrenchImmunityAbAttr(),
        () => new ConditionalAlwaysHitAbAttr({}),
        () => new PostTurnDrainAbAttr({ fraction: 1 / 6, onlyIfTrapped: true }),
      ]),
    ),
  );
  patch(785, ability => {
    const fullBelly = (user: Pokemon): boolean => user.getFormKey() !== "hangry";
    const hangry = (user: Pokemon): boolean => user.getFormKey() === "hangry";
    const darkStab = new StabAddAbAttr({ targetType: PokemonType.DARK });
    darkStab.addCondition(hangry);
    return Number(
      appendAbilityAttrsOnce(ability, "upgrade:two-faced:form-conversions", [
        () =>
          new MoveTypeChangeAbAttr(
            PokemonType.ELECTRIC,
            (user, _target, move) => fullBelly(user) && move.type === PokemonType.NORMAL,
          ),
        () =>
          new MovePowerBoostAbAttr((user, _target, move) => fullBelly(user) && move.type === PokemonType.NORMAL, 1.2),
        () =>
          new MoveTypeChangeAbAttr(
            PokemonType.DARK,
            (user, _target, move) => hangry(user) && move.type === PokemonType.NORMAL,
          ),
        () => darkStab,
        () =>
          new PostAttackApplyBattlerTagAbAttr(
            false,
            (user, _target, move) =>
              hangry(user) && user.getMoveType(move) === PokemonType.DARK && user.isOfType(PokemonType.DARK) ? 10 : 0,
            BattlerTagType.ER_ENRAGE,
          ),
      ]),
    );
  });
  patch(869, ability =>
    Number(
      replaceAbilityAttrsOnce(ability, "upgrade:blistering-sun:linked-weather-tailwind", [
        ...allAbilities[AbilityId.DESOLATE_LAND].attrs.map(attr => () => attr),
        ...(getErAbility(320)?.attrs ?? []).map(attr => () => attr),
        () => new PreLeaveFieldRemoveLinkedTailwindAbAttr(),
      ]),
    ),
  );
  patch(463, ability => {
    const terrainGate = () => globalScene.arena.terrain?.terrainType === TerrainType.GRASSY;
    const physicalReduction = new DamageReductionAbAttr({
      reduction: 0.5,
      filter: { kind: "category", category: MoveCategory.PHYSICAL },
    });
    physicalReduction.addCondition(terrainGate);
    const priorityBlock = new FieldPriorityMoveImmunityAbAttr();
    priorityBlock.addCondition(terrainGate);
    return Number(
      appendAbilityAttrsOnce(ability, "upgrade:jungle-guard:sun-basking", [
        () => physicalReduction,
        () => priorityBlock,
      ]),
    );
  });
  patch(808, ability =>
    Number(
      replaceAbilityAttrsOnce(ability, "upgrade:malodor:poison-gas-counter", [
        () =>
          new CounterAttackOnHitAbAttr({
            moveId: MoveId.POISON_GAS,
            power: 20,
            category: MoveCategory.SPECIAL,
            filter: { contactRequired: true },
          }),
      ]),
    ),
  );
  patch(812, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:reverberate:round-follow-up", [
        () =>
          new PostAttackScriptedMoveAbAttr({
            moveId: MoveId.ROUND,
            power: 20,
            flagFilter: MoveFlags.SOUND_BASED,
          }),
      ]),
    ),
  );
  patch(815, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:overrule:attack-drop-immunity", [() => new IntimidateImmunityAbAttr()]),
    ),
  );
  patch(837, ability =>
    Number(
      replaceAbilityAttrsOnce(ability, "upgrade:chokehold:all-move-binding", [
        () =>
          new ChanceBattlerTagOnAttackAbAttr({
            chance: 100,
            tags: [BattlerTagType.BIND],
            contactRequired: false,
            turns: 4,
            damageDenominator: 4,
          }),
      ]),
    ),
  );
  patch(847, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:lightning-born:charged", [
        () => new PostDefendAddTagAbAttr(BattlerTagType.CHARGED, PokemonType.ELECTRIC),
      ]),
    ),
  );
  patch(883, ability => {
    let changed = 0;
    for (const type of [PokemonType.ROCK, PokemonType.STEEL, PokemonType.FIGHTING]) {
      changed += Number(
        replaceMatchingAbilityAttrOnce(
          ability,
          `upgrade:warmonger:${type}:fifty-percent`,
          attr => attr instanceof TypeDamageBoostAbAttr && attr.getBoostType() === type,
          () => new TypeDamageBoostAbAttr({ type, multiplier: 1.5 }),
        ),
      );
    }
    return changed;
  });
  patch(932, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:drakelp-head:full-hp-dragon", [
        () => new FullHpMoveTypeDamageReductionAbAttr(PokemonType.DRAGON),
      ]),
    ),
  );
  patch(957, ability => {
    const drainBrainId = ER_ID_MAP.moves[837] as MoveId | undefined;
    if (drainBrainId === undefined) {
      return 0;
    }
    return Number(
      appendAbilityAttrsOnce(ability, "upgrade:brain-mass:drain-brain-counter", [
        () =>
          new CounterAttackOnHitAbAttr({
            moveId: drainBrainId,
            chance: 50,
            healMultiplier: 0.5,
          }),
      ]),
    );
  });
  patch(987, ability => {
    const priorityBlock = new FieldPriorityMoveImmunityAbAttr();
    priorityBlock.addCondition(
      () =>
        !globalScene.arena.weather?.isEffectSuppressed()
        && [WeatherType.RAIN, WeatherType.HEAVY_RAIN].includes(globalScene.arena.weatherType),
    );
    return Number(
      replaceAbilityAttrsOnce(ability, "upgrade:rain-shroud:sand-guard-in-rain", [
        () =>
          new DamageReductionAbAttr({
            reduction: 0.5,
            filter: {
              kind: "category-in-weather",
              category: MoveCategory.SPECIAL,
              weather: WeatherType.RAIN,
            },
          }),
        () => priorityBlock,
        () =>
          new DamageReductionAbAttr({
            reduction: 0.5,
            filter: {
              kind: "category-in-weather",
              category: MoveCategory.SPECIAL,
              weather: WeatherType.HEAVY_RAIN,
            },
          }),
      ]),
    );
  });
  patch(1006, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:electro-booster:ion-deluge", [
        () => new PostSummonScriptedMoveAbAttr({ moveId: MoveId.ION_DELUGE }),
      ]),
    ),
  );
  patch(1009, ability =>
    Number(
      replaceAbilityAttrsOnce(ability, "upgrade:frost-dragon:breaking-swipe", [
        () =>
          new PostAttackScriptedMoveAbAttr({
            moveId: MoveId.BREAKING_SWIPE,
            power: 40,
            typeFilter: [PokemonType.ICE],
          }),
      ]),
    ),
  );
  patch(954, ability => {
    const applied = appendAbilityAttrsOnce(ability, "upgrade:tummyache:gastro-acid-attacker", [
      () => new OnDirectFaintRetaliationAbAttr(MoveId.GASTRO_ACID),
    ]);
    if (applied) {
      ability.makeBypassFaint();
    }
    return Number(applied);
  });
  patch(974, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:break-it-down:sound-counter", [
        () =>
          new CounterAttackOnHitAbAttr({
            moveId: MoveId.RAPID_SPIN,
            power: 20,
            filter: { flag: MoveFlags.SOUND_BASED },
          }),
      ]),
    ),
  );
  patch(1028, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:king-jungle:grass-attacker-resist", [
        () => new AttackerTypeDamageReductionAbAttr(PokemonType.GRASS),
      ]),
    ),
  );
  for (const [draftId, type] of [
    [303, PokemonType.ROCK],
    [337, PokemonType.GRASS],
  ] as const) {
    patch(draftId, ability =>
      Number(
        replaceMatchingAbilityAttrOnce(
          ability,
          `upgrade:${draftId}:same-type-stab-otherwise-boost`,
          attr => attr instanceof TypeDamageBoostAbAttr && attr.getBoostType() === type,
          () => new SameTypeStabOtherwiseBoostAbAttr(type, 1.2),
        ),
      ),
    );
  }
  patch(373, ability =>
    Number(
      appendAbilityAttrsOnce(ability, "upgrade:grip-pincer:grappler-binding", [
        () =>
          new ChanceBattlerTagOnAttackAbAttr({
            chance: 100,
            tags: [BattlerTagType.BIND],
            contactRequired: false,
            turns: 4,
            damageDenominator: 4,
          }),
      ]),
    ),
  );
  patch(650, ability =>
    Number(
      appendAbilityAttrsOnce(
        ability,
        "upgrade:venoblaze-pincers:grip-pincer",
        (getErAbility(373)?.attrs ?? []).map(attr => () => attr),
      ),
    ),
  );
  patch(460, ability => {
    setAbilityName(ability, "Ninja's Blade");
    return 1;
  });

  return result;
}
