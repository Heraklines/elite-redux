/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// EVALUATE (game) side of the effect registry. Event effects reuse the V1 effect runner
// (applyAbilityStudioEffects) and calc effects edit the NumberHolder / BooleanHolder the engine
// passed in, with the same rounding the original attrs use (toDmgValue). Effects that are only
// "planned" in the pure registry have no entry here, and composition validation rejects them.

import { AttackTypeImmunityAbAttr, ForceSwitchOutHelper, type TypeMultiplierAbAttrParams } from "#abilities/ab-attrs";
import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { allAbilities, allMoves } from "#data/data-lists";
import { addCharge, clearCharge, consumeCharge } from "#data/elite-redux/abilities/charge-stack";
import {
  heavyweightMultiplier,
  LAST_EXECUTED_MOVE,
  livingBenchCount,
} from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { ANNOUNCEMENTS } from "#data/elite-redux/ability-studio/decl/B03/codecs";
import { abilityQuery, ENGINE_QUERY } from "#data/elite-redux/ability-studio/runtime-capabilities";
import { claimCommandAbilityProvenance } from "#data/elite-redux/ability-upgrades/attrs/innate-slot-suppression";
import { applyAbilityDrainRecovery } from "#data/elite-redux/archetypes/lifesteal";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import { clearErAilments, hasErAilment } from "#data/elite-redux/er-status-cure";
import { erFieldTurnsWithItems } from "#data/elite-redux/init-elite-redux-vanilla-rebalance";
import { SpeciesFormChangeWeatherTrigger } from "#data/form-change-triggers";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { getStatusEffectHealText } from "#data/status-effect";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { type BattleStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { SwitchType } from "#enums/switch-type";
import { WeatherType } from "#enums/weather-type";
import { MoveUsedEvent } from "#events/battle-scene";
import type { Pokemon } from "#field/pokemon";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import { getMoveTargets } from "#moves/move-utils";
import { resolveTargets } from "#phases/ability-studio-rule-effect-phase";
import { BooleanHolder, toDmgValue } from "#utils/common";
import i18next from "i18next";
import type { AbilityStudioEffect, AbilityStudioTarget } from "../../ability-blueprint";
import { type AbilityStudioRuleContext, applyAbilityStudioEffects } from "../../rule-ab-attrs";
import type { BlockRef } from "../composition-types";
import { getEffect } from "../effects";
import { type ParamValues, withParamDefaults } from "../params";
import { constantName } from "../player-names";
import { abilityIdOf, moveIdOf } from "./conditions";
import { type Frame, holderLikeOf } from "./frame";

/** What an effect needs when it runs: the frame plus the raw engine parameter object. */
export interface EffectRunContext {
  readonly frame: Frame;
  readonly params: Record<string, unknown>;
}

export type EffectRunner = (context: EffectRunContext) => void;

/** An effect-side precondition ("also requires"): runs after the IF list, before the rule chance roll. */
export type EffectFeasibility = (context: EffectRunContext) => boolean;

/** What an effect block compiles to: how it runs, what it also requires, which safety rules it bundles. */
export interface CompiledEffect {
  readonly run: EffectRunner;
  readonly feasible?: EffectFeasibility;
  /** Guard registry ids that run before the IF list. */
  readonly guards: readonly string[];
  /** Instance fields the engine reads outside canApply/apply, set on the composition carrier. */
  readonly carrierFields?: Readonly<Record<string, unknown>>;
}

/** An effect factory returns a bare runner, or the runner plus the parts that go around it. */
type EffectParts =
  | EffectRunner
  | {
      readonly run: EffectRunner;
      readonly feasible?: EffectFeasibility;
      readonly carrierFields?: Readonly<Record<string, unknown>>;
    };

type Resolved = Readonly<Record<string, string | number | boolean>>;
type EffectFactory = (values: Resolved) => EffectParts;

interface NumberHolderLike {
  value: number;
}

function holderField<T>(context: EffectRunContext, field: string): T {
  const holder = context.params[field];
  if (holder === undefined || holder === null) {
    throw new Error(`this trigger did not pass "${field}", so the effect cannot change it`);
  }
  return holder as T;
}

function v1Effect(effect: AbilityStudioEffect): EffectRunner {
  return ({ frame }) =>
    applyAbilityStudioEffects([effect], {
      holder: frame.holder,
      other: frame.other,
      move: frame.move,
      moveSource: frame.moveUser,
      simulated: frame.simulated,
    });
}

// ---- Library completion pass (wave C): helpers ----------------------------------------------------

/** The context the V1 runner's target resolver reads (the same object v1Effect builds). */
function ruleContext(frame: Frame): AbilityStudioRuleContext {
  return {
    holder: frame.holder,
    other: frame.other,
    move: frame.move,
    moveSource: frame.moveUser,
    simulated: frame.simulated,
  };
}

/** Typed list settings ("Attack, Sp. Atk") read back through the player names; throws on an unknown name. */
function namesOf(text: string): string[] {
  return text
    .split(",")
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .map(part => constantName(part));
}

const STAGE_STATS: readonly string[] = ["ATK", "DEF", "SPATK", "SPDEF", "SPD", "ACC", "EVA"];

function statListOf(text: string): BattleStat[] {
  const stats = namesOf(text).map(name => {
    if (!STAGE_STATS.includes(name)) {
      throw new Error(`"${name}" is not a stat that has stages`);
    }
    return Stat[name as keyof typeof Stat] as BattleStat;
  });
  if (stats.length === 0) {
    throw new Error("name at least one stat");
  }
  return stats;
}

/** The statuses of the "my side" cure: the typed list, else the single status setting (ANY = every status). */
function statusListOf(text: string, single: string): StatusEffect[] | undefined {
  const names = namesOf(text);
  if (names.length === 0) {
    return single === "ANY" ? undefined : [StatusEffect[single as keyof typeof StatusEffect]];
  }
  return names.map(name => {
    const status = StatusEffect[name as keyof typeof StatusEffect];
    if (typeof status !== "number" || status === StatusEffect.NONE) {
      throw new Error(`"${name}" is not a status condition`);
    }
    return status;
  });
}

function typesOf(text: string): PokemonType[] {
  return namesOf(text).map(name => {
    const type = PokemonType[name as keyof typeof PokemonType];
    if (typeof type !== "number") {
      throw new Error(`"${name}" is not a type`);
    }
    return type;
  });
}

/** The field effects staff may remove: the screens, the entry hazards, Smokescreen and Tailwind (every shipped user). */
const REMOVABLE_FIELD_EFFECTS: Readonly<Record<string, ArenaTagType>> = {
  REFLECT: ArenaTagType.REFLECT,
  LIGHT_SCREEN: ArenaTagType.LIGHT_SCREEN,
  AURORA_VEIL: ArenaTagType.AURORA_VEIL,
  SMOKESCREEN: ArenaTagType.ER_SMOKESCREEN,
  SPIKES: ArenaTagType.SPIKES,
  TOXIC_SPIKES: ArenaTagType.TOXIC_SPIKES,
  STEALTH_ROCK: ArenaTagType.STEALTH_ROCK,
  STICKY_WEB: ArenaTagType.STICKY_WEB,
  TAILWIND: ArenaTagType.TAILWIND,
};

function fieldEffectsOf(text: string): ArenaTagType[] {
  const tags = namesOf(text).map(name => {
    const tag = REMOVABLE_FIELD_EFFECTS[name];
    if (tag === undefined) {
      throw new Error(`"${name}" is not a field effect this block may remove`);
    }
    return tag;
  });
  if (tags.length === 0) {
    throw new Error("name at least one field effect");
  }
  return tags;
}

/** PostAttackStealHeldItemAbAttr.getTargetHeldItems (ab-attrs.ts). */
function heldItemsOf(target: Pokemon): PokemonHeldItemModifier[] {
  return globalScene.findModifiers(
    m => m instanceof PokemonHeldItemModifier && m.pokemonId === target.id,
    target.isPlayer(),
  ) as PokemonHeldItemModifier[];
}

/** VoidPostTurnStealAbAttr.candidates (bernerd-roster-mechanics.ts:353-366). */
function takeableFoeItems(pokemon: Pokemon): PokemonHeldItemModifier[] {
  return pokemon
    .getOpponents()
    .flatMap(opponent =>
      (
        globalScene.findModifiers(
          modifier =>
            modifier instanceof PokemonHeldItemModifier
            && modifier.pokemonId === opponent.id
            && modifier.isTransferable,
          opponent.isPlayer(),
        ) as PokemonHeldItemModifier[]
      ).filter(modifier => globalScene.canTransferHeldItemModifier(modifier, pokemon)),
    );
}

/** The highest stat of `stats` by a strict scan (`tie: first`) or a `>=` scan (`tie: last`). */
function highestStatOf(pokemon: Pokemon, stats: readonly BattleStat[], tie: string, source: string): BattleStat {
  let bestStat = stats[0];
  let bestValue = -1;
  for (const stat of stats) {
    const value = source === "stored" ? pokemon.getStat(stat as never) : pokemon.getStat(stat as never, false);
    if (tie === "last" ? value >= bestValue : value > bestValue) {
      bestValue = value;
      bestStat = stat;
    }
  }
  return bestStat;
}

function markerList(pokemon: Pokemon, scope: string): string[] {
  switch (scope) {
    case "battle":
      return pokemon.battleData.erAbilityProvenance;
    case "turn":
      return pokemon.turnData.erAbilityProvenance;
    default:
      return pokemon.summonData.erAbilityProvenance;
  }
}

function setMarkerList(pokemon: Pokemon, scope: string, list: string[]): void {
  switch (scope) {
    case "battle":
      pokemon.battleData.erAbilityProvenance = list;
      return;
    case "turn":
      pokemon.turnData.erAbilityProvenance = list;
      return;
    default:
      pokemon.summonData.erAbilityProvenance = list;
  }
}

const RESET_STATS: readonly BattleStat[] = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD, Stat.ACC, Stat.EVA];

/**
 * Re-entrancy latch for the chip-damage effects. `damageAndUpdate` dispatches "after taking damage" again, even for
 * indirect damage, so two holders (or a Liquid Ooze foe) on that trigger would chain until someone faints. While one
 * chip-damage effect runs, no other one starts. The classes have no such latch (integrator note in BUILT-BC.md).
 */
let chipDamageRunning = false;

/** How the move being resolved right now was used, when it is the holder's own move (MoveEffectPhase); else undefined. */
function ownMoveUseMode(holder: Pokemon): MoveUseMode | undefined {
  const phase = globalScene.phaseManager.getCurrentPhase();
  if (!phase?.is("MoveEffectPhase") || phase.getUserPokemon() !== holder) {
    return;
  }
  // `useMode` is protected on MoveEffectPhase; the engine exposes no getter.
  const resolving = phase as unknown as { readonly useMode: MoveUseMode };
  return resolving.useMode;
}

function runChipDamage(body: () => void): void {
  if (chipDamageRunning) {
    return;
  }
  chipDamageRunning = true;
  try {
    body();
  } finally {
    chipDamageRunning = false;
  }
}

/** Calc effects of the completion pass: the same arithmetic and rounding as the classes. */
const COMPLETION_CALC_FACTORIES: Readonly<Record<string, EffectFactory>> = {
  // StatMultiplierAbAttr (ab-attrs.ts:2416-2421): canApply `stat === this.stat`, apply `statVal.value *= multiplier`.
  "effect.multiply-stat": v => {
    const multiplier = Number(v.multiplier);
    const stat = String(v.stat);
    const run: EffectRunner = context => {
      holderField<NumberHolderLike>(context, "statVal").value *= multiplier;
    };
    if (stat === "current") {
      return run;
    }
    const wanted = Stat[stat as keyof typeof Stat];
    return { run, feasible: ({ frame }) => frame.stat === wanted };
  },
  // SpeedBonusToStatAbAttr.apply (speed-bonus-to-stat.ts:139-145); StatBlendAbAttr.apply (stat-blend.ts:64-67).
  "effect.add-stat-share": v => {
    const sourceStat = Stat[String(v.sourceStat) as keyof typeof Stat];
    const share = Number(v.share);
    const replace = v.replace === true;
    const run: EffectRunner = context => {
      const statVal = holderField<NumberHolderLike>(context, "statVal");
      const bonus = Math.floor(context.frame.holder.getStat(sourceStat as never, false) * share);
      statVal.value = replace ? bonus : statVal.value + bonus;
    };
    if (v.stat === "any") {
      return run;
    }
    const wanted = Stat[String(v.stat) as keyof typeof Stat];
    return { run, feasible: ({ frame }) => frame.stat === wanted };
  },
  // FaintedAllyStatMultiplierAbAttr.apply (requested-combat-riders.ts:411-415).
  "effect.multiply-stat-per-fainted-ally": v => {
    const share = Number(v.share);
    return context => {
      const pokemon = context.frame.holder;
      const party = pokemon.isPlayer() ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
      const faintedAllies = party.filter(ally => ally.id !== pokemon.id && ally.isFainted()).length;
      holderField<NumberHolderLike>(context, "statVal").value *= 1 + faintedAllies * share;
    };
  },
  // SetMoveAccuracyAbAttr (ab-attrs.ts:5134-5140): residual `accuracy !== -1 && accuracy < N`, apply `accuracy = N`.
  "effect.set-accuracy": v => {
    const accuracy = Number(v.accuracy);
    return {
      run: context => {
        holderField<NumberHolderLike>(context, "accuracy").value = accuracy;
      },
      feasible: context => {
        const current = holderField<NumberHolderLike>(context, "accuracy").value;
        return current !== -1 && current < accuracy;
      },
    };
  },
  // IgnoreMoveEffectsAbAttr (ab-attrs.ts:1804-1810): canApply `chance > 0`, apply `chance = 0`.
  "effect.ignore-secondary-effects": () => ({
    run: context => {
      holderField<NumberHolderLike>(context, "chance").value = 0;
    },
    feasible: context => holderField<NumberHolderLike>(context, "chance").value > 0,
  }),
  // FanFavoritePowerAbAttr / HeavyweightPowerAbAttr (newcomer-signature-mechanics.ts:608-614, 1098-1141).
  "effect.multiply-power-per-count": v => {
    const percent = Number(v.percent);
    const max = Number(v.max);
    if (v.counter === "weight-classes") {
      return context => {
        const target = context.frame.other;
        if (target !== undefined) {
          holderField<NumberHolderLike>(context, "power").value *= heavyweightMultiplier(
            context.frame.holder,
            target,
            percent,
            max,
          );
        }
      };
    }
    return {
      run: context => {
        holderField<NumberHolderLike>(context, "power").value *=
          1 + livingBenchCount(context.frame.holder, max) * (percent / 100);
      },
      feasible: ({ frame }) => livingBenchCount(frame.holder, max) > 0,
    };
  },
  // FanFavoriteAccuracyAbAttr (newcomer-signature-mechanics.ts:1143-1181): guard `accuracy > 0`, then the multiplier.
  "effect.multiply-accuracy-per-count": v => {
    const percent = Number(v.percent);
    const max = Number(v.max);
    return {
      run: context => {
        holderField<NumberHolderLike>(context, "accuracy").value *=
          1 + livingBenchCount(context.frame.holder, max) * (percent / 100);
      },
      feasible: context => holderField<NumberHolderLike>(context, "accuracy").value > 0,
    };
  },
  // CritUseLowerDefensiveStatAbAttr.apply (ab-attrs.ts:4806-4813): the defender comes from the engine parameters.
  "effect.use-weaker-defense": () => context => {
    const defender = context.params.defender as Pokemon | undefined;
    if (!defender) {
      return;
    }
    const def = defender.getEffectiveStat(Stat.DEF);
    const spDef = defender.getEffectiveStat(Stat.SPDEF);
    holderField<NumberHolderLike>(context, "statHolder").value = def <= spDef ? Stat.DEF : Stat.SPDEF;
  },
  // HitMultiplierAbAttr.apply (hit-multiplier.ts:190): hitCount.value += extraStrikes.
  "effect.hit-n-times": v => {
    const extraStrikes = Number(v.extraStrikes);
    return context => {
      holderField<NumberHolderLike>(context, "hitCount").value += extraStrikes;
    };
  },
  // ArenaTrapAbAttr.apply (ab-attrs.ts:6879); the Ghost / Run Away rule is the bundled safety rule.
  "effect.trap-foe": () => context => {
    holderField<{ value: boolean }>(context, "trapped").value = true;
  },
  // BypassSpeedChanceAbAttr (ab-attrs.ts:7907, 7917), then the optional turn reminder (innate-slot-suppression.ts:105).
  "effect.jump-turn-order": v => {
    const memoName = String(v.memoName).trim();
    return {
      run: ({ frame }) => {
        frame.holder.addTag(BattlerTagType.BYPASS_SPEED);
        if (memoName.length > 0) {
          claimCommandAbilityProvenance(frame.holder, memoName);
        }
      },
      // BypassSpeedChanceAbAttr.canApply refuses a preview first.
      feasible: ({ frame }) => !frame.simulated && frame.holder.canAddTag(BattlerTagType.BYPASS_SPEED),
    };
  },
  // ReflectStatStageChangeAbAttr (ab-attrs.ts:4274-4300): `cancelled` is set even while previewing.
  "effect.reflect-stat-drop": () => ({
    run: context => {
      const source = context.frame.other;
      if (!source) {
        return;
      }
      const cancelled = holderField<{ value: boolean }>(context, "cancelled");
      if (!context.frame.simulated) {
        globalScene.phaseManager.unshiftNew(
          "StatStageChangePhase",
          source.getBattlerIndex(),
          false,
          [context.params.stat as BattleStat],
          context.params.stages as number,
          true,
          true,
          true,
          null,
          true,
        );
      }
      cancelled.value = true;
    },
    feasible: context => !!context.frame.other && !holderField<{ value: boolean }>(context, "cancelled").value,
  }),
};

/** Event effects of the completion pass. Each runs nothing while the game only previews, as its class does. */
const COMPLETION_EVENT_FACTORIES: Readonly<Record<string, EffectFactory>> = {
  // Post-summon scripted move (post-summon-scripted-move.ts:157-200); move targets (FPM:2275-2284); a partner of the
  // other Pokemon with a share of the used move's power (FPM:976-984); the first standing foe (FPM:1470-1476).
  "effect.scripted-move-at": v => {
    const usedMove = v.usedMove === true;
    const fixedMove = usedMove ? undefined : (moveIdOf(String(v.moveId)) as MoveId);
    const power = Number(v.power);
    const powerShare = Number(v.powerShare);
    const aim = String(v.aim);
    const alwaysHit = v.alwaysHit === true;
    const livingFoes = (pokemon: Pokemon): Pokemon[] => pokemon.getOpponents().filter(o => !o.isFainted());
    const run: EffectRunner = ({ frame }) => {
      if (frame.simulated) {
        return;
      }
      const moveId = usedMove ? frame.move?.id : fixedMove;
      if (moveId === undefined) {
        return;
      }
      let castPower: number | undefined;
      if (powerShare > 0) {
        const base = usedMove ? frame.move : allMoves[moveId];
        if (base === undefined) {
          return;
        }
        castPower = Math.max(1, Math.floor(base.power * powerShare));
      } else if (power > 0) {
        castPower = power;
      }
      let targets: number[];
      switch (aim) {
        case "holder":
          targets = [frame.holder.getBattlerIndex()];
          break;
        case "move-targets":
          targets = getMoveTargets(frame.holder, moveId).targets;
          break;
        case "neighbour-ally": {
          const ally = frame.other?.getAdjacentAllies().find(candidate => !candidate.isFainted());
          targets = ally ? [ally.getBattlerIndex()] : [];
          break;
        }
        case "other":
          targets = frame.other ? [frame.other.getBattlerIndex()] : [];
          break;
        default: {
          const opponents = livingFoes(frame.holder);
          targets =
            aim === "every-living-foe"
              ? opponents.map(o => o.getBattlerIndex())
              : opponents.slice(0, 1).map(o => o.getBattlerIndex());
        }
      }
      if (targets.length === 0) {
        return;
      }
      globalScene.phaseManager.unshiftNew(
        "MovePhase",
        frame.holder,
        targets,
        scriptedPokemonMove(moveId, castPower, { alwaysHit }),
        aim === "holder" ? MoveUseMode.FOLLOW_UP : MoveUseMode.INDIRECT,
      );
    };
    // Never start from a follow-up: the effect's own INDIRECT cast (or the FOLLOW_UP self cast) dispatches the same
    // "after a hit" triggers again, and without this a rule would answer its own follow-up forever (the same rule as
    // effect.scripted-move). Moments without a useMode ("after taking damage": recoil, Rough Skin chip) are refused
    // while the move being resolved is the holder's own INDIRECT or FOLLOW_UP move. Entry, end of turn, knockout and
    // faint run outside a move of the holder, so their lifts are unchanged.
    const notFromFollowUp = ({ frame, params }: EffectRunContext): boolean => {
      const useMode =
        params.useMode === undefined ? ownMoveUseMode(frame.holder) : (params.useMode as MoveUseMode | undefined);
      return useMode !== MoveUseMode.INDIRECT && useMode !== MoveUseMode.FOLLOW_UP;
    };
    if (aim === "first-living-foe" || aim === "every-living-foe") {
      return {
        run,
        feasible: context => notFromFollowUp(context) && livingFoes(context.frame.holder).length > 0,
      };
    }
    if (aim === "other") {
      return {
        run,
        feasible: context =>
          !context.frame.holder.isFainted()
          && context.frame.other !== undefined
          && !context.frame.other.isFainted()
          && notFromFollowUp(context),
      };
    }
    return { run, feasible: notFromFollowUp };
  },
  // PostVictoryClearRechargeAbAttr.apply (post-victory-clear-recharge.ts:50-58).
  "effect.cancel-recharge":
    () =>
    ({ frame }) => {
      if (frame.simulated) {
        return;
      }
      frame.holder.removeTag(BattlerTagType.RECHARGING);
      const queue = frame.holder.getMoveQueue();
      if (queue.length > 0 && queue[0].move === MoveId.NONE) {
        queue.shift();
      }
    },
  // PostAttackRemoveTargetTypeAbAttr: ab-attrs.ts:2802-2836 (Tera rules, UNKNOWN) and
  // archetypes/post-attack-remove-target-type.ts:69-76 (NORMAL, plain getTypes()).
  "effect.remove-type": v => {
    const who = String(v.who);
    const type = PokemonType[String(v.type) as keyof typeof PokemonType];
    const fallback = PokemonType[String(v.fallback) as keyof typeof PokemonType];
    const teraRules = v.teraRules === true;
    const run: EffectRunner = ({ frame }) => {
      const pokemon = holderLikeOf(frame, who);
      if (frame.simulated || pokemon === undefined) {
        return;
      }
      const kept = (teraRules ? pokemon.getTypes(true) : pokemon.getTypes()).filter(t => t !== type);
      pokemon.summonData.types = kept.length > 0 ? kept : [fallback];
      pokemon.updateInfo();
    };
    if (!teraRules) {
      return run;
    }
    return {
      run,
      feasible: ({ frame }) => {
        const pokemon = holderLikeOf(frame, who);
        return pokemon !== undefined && !(pokemon.isTerastallized && pokemon.getTeraType() === type);
      },
    };
  },
  // PostAttackChangeTargetTypeAbAttr.apply (post-attack-change-target-type.ts): one type, or the move user's move type.
  "effect.change-own-type": v => {
    const who = String(v.who);
    const moveType = v.type === "move-type";
    const fixed = PokemonType[String(v.type) as keyof typeof PokemonType];
    return ({ frame }) => {
      const pokemon = holderLikeOf(frame, who);
      if (frame.simulated || pokemon === undefined) {
        return;
      }
      let type: PokemonType = fixed;
      if (moveType) {
        if (frame.moveUser === undefined || frame.move === undefined) {
          return;
        }
        type = frame.moveUser.getMoveType(frame.move);
      }
      pokemon.summonData.types = [type];
      pokemon.updateInfo();
    };
  },
  // SelfHighestStatBoostOnSummonAbAttr.apply (self-highest-stat-boost-on-summon.ts:88-102): strict scan on in-battle
  // stats; the `>=` and stored-stat forms are plusle-minun.ts:380 and type-immunity-highest-attack-stat-stage.ts:50-51.
  "effect.stat-stage-on-highest": v => {
    const stats = statListOf(String(v.stats));
    const stages = Number(v.stages);
    const toOther = v.target === "other";
    const tie = String(v.tie);
    const source = String(v.source);
    return ({ frame }) => {
      const pokemon = toOther ? frame.other : frame.holder;
      if (frame.simulated || pokemon === undefined) {
        return;
      }
      const stat = highestStatOf(pokemon, stats, tie, source);
      globalScene.phaseManager.unshiftNew("StatStageChangePhase", pokemon.getBattlerIndex(), !toOther, [stat], stages);
    };
  },
  // PostTurnDrainAbAttr (post-turn-drain.ts:71-94): the check scans every foe, the drain only the adjacent ones.
  "effect.drain-adjacent-foes": v => {
    const fraction = Number(v.fraction);
    const onlyTrapped = v.onlyTrapped === true;
    return {
      run: ({ frame }) => {
        const pokemon = frame.holder;
        if (frame.simulated) {
          return;
        }
        runChipDamage(() => {
          for (const opp of pokemon.getAdjacentOpponents()) {
            if (!opp || opp.isFainted() || opp.hp <= 0 || (onlyTrapped && !opp.isTrapped())) {
              continue;
            }
            const dmg = toDmgValue(opp.getMaxHp() * fraction);
            const before = opp.hp;
            opp.damageAndUpdate(dmg, { result: HitResult.INDIRECT });
            const amount = before - opp.hp;
            if (amount <= 0) {
              continue;
            }
            const message = i18next.t("abilityTriggers:postTurnHeal", {
              pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
              abilityName: pokemon.getAbility()?.name ?? "",
            });
            applyAbilityDrainRecovery(pokemon, opp, amount, message);
          }
        });
      },
      feasible: ({ frame }) =>
        !chipDamageRunning
        && frame.holder.getOpponents().some(o => o && !o.isFainted() && o.hp > 0 && (!onlyTrapped || o.isTrapped())),
    };
  },
  // PostDamageForceAttackerOutAbAttr residual and apply (post-damage-force-attacker-out.ts); its once-per-switch-in
  // memory is not part of this block.
  "effect.force-other-out": () => {
    const helper = new ForceSwitchOutHelper(SwitchType.SWITCH);
    return {
      run: ({ frame }) => {
        if (frame.simulated || !frame.other) {
          return;
        }
        helper.switchOutLogic(frame.other);
      },
      // The class's guard (post-damage-force-attacker-out.ts:57) also refuses a fainted attacker.
      feasible: ({ frame }) =>
        frame.other !== undefined
        && !frame.other.isFainted()
        && helper.getSwitchOutCondition(frame.other, frame.holder),
    };
  },
  // erAbilityProvenance markers (FPM:2154 push, innate-slot-suppression.ts:86-91 deduped claim).
  "effect.set-marker": v => {
    const scope = String(v.scope);
    const key = String(v.key);
    const unique = v.unique === true;
    return ({ frame }) => {
      if (frame.simulated) {
        return;
      }
      const list = markerList(frame.holder, scope);
      if (unique && list.includes(key)) {
        return;
      }
      list.push(key);
    };
  },
  // BallasterResetAbAttr / BallasterAbAttr (FPM:273, 326): filter the key out.
  "effect.clear-marker": v => {
    const scope = String(v.scope);
    const key = String(v.key);
    return ({ frame }) => {
      if (frame.simulated) {
        return;
      }
      setMarkerList(
        frame.holder,
        scope,
        markerList(frame.holder, scope).filter(entry => entry !== key),
      );
    };
  },
  // charge-stack.ts:36-63.
  "effect.change-charge-stacks": v => {
    const mode = String(v.mode);
    const amount = Number(v.amount);
    return ({ frame }) => {
      if (frame.simulated) {
        return;
      }
      if (mode === "add") {
        addCharge(frame.holder, amount);
      } else if (mode === "spend") {
        consumeCharge(frame.holder, amount);
      } else {
        clearCharge(frame.holder);
      }
    };
  },
  // PpReductionOnContactAbAttr (pp-reduction-on-contact.ts:122-137), OnFaintEffect attacker PP drain
  // (on-faint-effect.ts:528-563), FoulHarvestAbAttr (newcomer-signature-mechanics.ts:319-339).
  "effect.drain-pp": v => {
    const which = String(v.which);
    const amount = Number(v.amount);
    if (which === "used-move-all") {
      return {
        run: ({ frame }) => {
          const attacker = frame.other;
          const move = frame.move;
          if (frame.simulated || attacker === undefined || move === undefined) {
            return;
          }
          const movesetMove = attacker.getMoveset().find(m => m.moveId === move.id);
          if (movesetMove === undefined) {
            return;
          }
          const prevPpUsed = movesetMove.ppUsed;
          movesetMove.ppUsed = movesetMove.getMovePp();
          const reduction = movesetMove.ppUsed - prevPpUsed;
          if (reduction <= 0) {
            return;
          }
          globalScene.eventTarget.dispatchEvent(
            new MoveUsedEvent(attacker.id, movesetMove.getMove(), movesetMove.ppUsed),
          );
          globalScene.phaseManager.queueMessage(
            i18next.t("battle:ppReduced", {
              targetName: getPokemonNameWithAffix(attacker),
              moveName: movesetMove.getName(),
              reduction,
            }),
          );
        },
        feasible: ({ frame }) => {
          const attacker = frame.other;
          const move = frame.move;
          if (attacker === undefined || move === undefined) {
            return false;
          }
          const movesetMove = attacker.getMoveset().find(m => m.moveId === move.id);
          return movesetMove !== undefined && movesetMove.getPpRatio() > 0;
        },
      };
    }
    if (which === "last-used-else-random") {
      return ({ frame }) => {
        const opponent = frame.other;
        if (frame.simulated || opponent === undefined) {
          return;
        }
        const moveset = opponent.getMoveset().filter(move => move.moveId !== MoveId.NONE);
        if (moveset.length === 0) {
          return;
        }
        const recentName = LAST_EXECUTED_MOVE.get(opponent);
        const selected =
          (recentName ? moveset.find(move => move.getMove().name === recentName) : undefined)
          ?? moveset[frame.holder.randBattleSeedInt(moveset.length)];
        if (!selected || selected.isOutOfPp()) {
          return;
        }
        selected.ppUsed = Math.min(selected.ppUsed + amount, selected.getMovePp());
        globalScene.phaseManager.queueMessage(
          `${opponent.getNameToRender()}'s ${selected.getName()} lost ${amount} PP!`,
        );
      };
    }
    return {
      run: ({ frame }) => {
        const attacker = frame.other;
        const move = frame.move;
        if (frame.simulated || attacker === undefined || move === undefined) {
          return;
        }
        const movesetMove = attacker.moveset.find(m => m.moveId === move.id);
        if (movesetMove === undefined) {
          return;
        }
        movesetMove.usePp(amount);
      },
      feasible: ({ frame }) =>
        frame.other !== undefined
        && frame.move !== undefined
        && frame.other.moveset.some(m => m.moveId === frame.move?.id),
    };
  },
  // PostSummonFormChangeByWeatherAbAttr (ab-attrs.ts:4031-4052).
  "effect.match-weather-form": () => ({
    run: ({ frame }) => {
      if (!frame.simulated) {
        globalScene.triggerPokemonFormChange(frame.holder, SpeciesFormChangeWeatherTrigger);
      }
    },
    feasible: ({ frame }) =>
      !!pokemonFormChanges[frame.holder.species.speciesId]?.some(
        fc => fc.findTrigger(SpeciesFormChangeWeatherTrigger) && fc.canChange(frame.holder),
      ),
  }),
  // PostAttackAbilityGiveAbAttr (ab-attrs.ts:2777-2785) and PostDefendAbilityGiveAbAttr (ab-attrs.ts:1620-1637).
  "effect.give-ability": v => {
    const ability = abilityIdOf(String(v.ability));
    const whenHit = v.giver === "when-hit";
    return {
      run: ({ frame }) => {
        if (!frame.simulated && frame.other) {
          frame.other.setTempAbility(allAbilities[ability]);
        }
      },
      feasible: ({ frame }) => {
        const target = frame.other;
        if (target === undefined) {
          return false;
        }
        if (!whenHit) {
          return target.getAbility().suppressable && !target.getAbility().hasAttr("PostAttackAbilityGiveAbAttr");
        }
        const mummyFamily =
          [AbilityId.MUMMY, AbilityId.LINGERING_AROMA].includes(ability)
          && (target.hasAbility(AbilityId.MUMMY)
            || target.hasAbility(AbilityId.LINGERING_AROMA)
            || abilityQuery(target, ENGINE_QUERY.WANDERING_SPIRIT_SWAP));
        return (
          target.getAbility().suppressable
          && !target.getAbility().hasAttr("PostDefendAbilityGiveAbAttr")
          && !mummyFamily
        );
      },
    };
  },
  // PostSummonRemoveArenaTagAbAttr (ab-attrs.ts:3268-3279); the other Pokemon's side: BreakScreensOnAttackAbAttr
  // (requested-combat-riders.ts:172-179).
  "effect.remove-arena-tags": v => {
    const tags = fieldEffectsOf(String(v.tags));
    const side = String(v.side);
    const run: EffectRunner = ({ frame }) => {
      if (frame.simulated) {
        return;
      }
      let arenaSide: ArenaTagSide;
      if (side === "target-side") {
        if (!frame.other) {
          return;
        }
        arenaSide = frame.other.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
      } else if (side === "holder-side") {
        arenaSide = frame.holder.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
      } else if (side === "opposing-side") {
        arenaSide = frame.holder.isPlayer() ? ArenaTagSide.ENEMY : ArenaTagSide.PLAYER;
      } else {
        arenaSide = ArenaTagSide.BOTH;
      }
      globalScene.arena.removeTagsOnSide(tags, arenaSide);
    };
    if (v.onlyWhenPresent !== true) {
      return run;
    }
    return { run, feasible: () => globalScene.arena.hasTag(tags as [ArenaTagType, ...ArenaTagType[]]) };
  },
  // EntryTailwindClearWeatherAbAttr (B09-20: a mutable weather only) or PostSummonClearWeatherAbAttr /
  // PreLeaveFieldClearWeatherAbAttr.apply (ab-attrs.ts:4021-4024, 4214-4217: any weather).
  "effect.clear-weather": v => {
    const keepExtreme = v.keepExtreme === true;
    return ({ frame }) => {
      if (frame.simulated) {
        return;
      }
      if (keepExtreme) {
        if (globalScene.arena.weather && !globalScene.arena.weather.isImmutable()) {
          globalScene.arena.trySetWeather(WeatherType.NONE);
        }
        return;
      }
      globalScene.arena.trySetWeather(WeatherType.NONE);
    };
  },
  // ClearOpponentStatBuffsOnSummonAbAttr (init-elite-redux-vanilla-rebalance.ts:1942-1964).
  "effect.reset-stat-stages": v => {
    const target = String(v.target);
    const onlyRaised = v.onlyRaised === true;
    const run: EffectRunner = ({ frame }) => {
      if (frame.simulated) {
        return;
      }
      const targets =
        target === "adjacent-foes"
          ? frame.holder.getAdjacentOpponents()
          : resolveTargets(target as AbilityStudioTarget, ruleContext(frame));
      for (const opp of targets) {
        if (!opp || opp.isFainted()) {
          continue;
        }
        for (const stat of RESET_STATS) {
          const stage = opp.getStatStage(stat);
          if (onlyRaised ? stage > 0 : stage !== 0) {
            opp.setStatStage(stat, 0);
          }
        }
        opp.updateInfo();
      }
    };
    if (target !== "adjacent-foes") {
      return run;
    }
    return { run, feasible: ({ frame }) => frame.holder.getOpponents().length > 0 };
  },
  // PostTurnHurtNonTypedAbAttr (post-turn-hurt-non-typed.ts:121-126, 160-167, 194-246).
  "effect.hurt-percent-of-max-hp": v => {
    const fieldWide = v.targets === "everyone-else";
    const fraction = Number(v.fraction);
    const spared = typesOf(String(v.sparedTypes));
    const poisonHealRecovers = v.poisonHealRecovers === true;
    const targetsOf = (pokemon: Pokemon): Pokemon[] =>
      fieldWide ? globalScene.getField(true).filter(p => p !== pokemon) : pokemon.getOpponents();
    const isValidTarget = (opp: Pokemon): boolean =>
      !(opp.switchOutStatus || opp.isFainted()) && !spared.some(t => opp.isOfType(t));
    return {
      run: ({ frame }) => {
        if (frame.simulated) {
          return;
        }
        runChipDamage(() => {
          for (const opp of targetsOf(frame.holder)) {
            if (!isValidTarget(opp)) {
              continue;
            }
            const amount = toDmgValue(opp.getMaxHp() * fraction);
            if (poisonHealRecovers && abilityQuery(opp, ENGINE_QUERY.POISON_HEAL_RECOVERY)) {
              if (!opp.isFullHp()) {
                globalScene.phaseManager.unshiftNew(
                  "PokemonHealPhase",
                  opp.getBattlerIndex(),
                  amount,
                  i18next.t("abilityTriggers:poisonHeal", {
                    pokemonName: getPokemonNameWithAffix(opp),
                    abilityName: allAbilities[AbilityId.POISON_HEAL].name,
                  }),
                  true,
                );
              }
              continue;
            }
            const cancelled = new BooleanHolder(false);
            applyAbAttrs("BlockNonDirectDamageAbAttr", { pokemon: opp, simulated: false, cancelled });
            if (cancelled.value) {
              continue;
            }
            opp.damageAndUpdate(amount, { result: HitResult.INDIRECT });
            globalScene.phaseManager.queueMessage(
              i18next.t("battle:hurtByItem", { pokemonNameWithAffix: getPokemonNameWithAffix(opp) }),
            );
          }
        });
      },
      feasible: ({ frame }) => !chipDamageRunning && targetsOf(frame.holder).some(isValidTarget),
    };
  },
  // PostSummonAllyHealAbAttr (ab-attrs.ts:3509-3525) for my adjacent allies; one heal step per Pokemon otherwise.
  "effect.heal-fraction-of-max-hp": v => {
    const target = String(v.target);
    const denominator = Number(v.denominator);
    const basedOnHolder = v.basedOn === "holder";
    const skipAnim = v.showAnimation !== true;
    if (target === "adjacent-allies") {
      return {
        run: ({ frame }) => {
          const pokemon = frame.holder;
          if (frame.simulated) {
            return;
          }
          for (const ally of pokemon.getAdjacentAllies().filter(a => a.isActive(true))) {
            globalScene.phaseManager.unshiftNew(
              "PokemonHealPhase",
              ally.getBattlerIndex(),
              toDmgValue((basedOnHolder ? pokemon : ally).getMaxHp() / denominator),
              i18next.t("abilityTriggers:postSummonAllyHeal", {
                pokemonNameWithAffix: getPokemonNameWithAffix(ally),
                pokemonName: pokemon.name,
              }),
              true,
              skipAnim,
            );
          }
        },
        feasible: ({ frame }) => frame.holder.getAdjacentAllies().some(ally => ally.isActive(true)),
      };
    }
    return ({ frame }) => {
      if (frame.simulated) {
        return;
      }
      for (const pokemon of resolveTargets(target as AbilityStudioTarget, ruleContext(frame))) {
        globalScene.phaseManager.unshiftNew(
          "PokemonHealPhase",
          pokemon.getBattlerIndex(),
          toDmgValue((basedOnHolder ? frame.holder : pokemon).getMaxHp() / denominator),
          null,
          true,
          skipAnim,
        );
      }
    };
  },
  // PostSummonStatStageChangeAbAttr.apply (ab-attrs.ts:3424-3486) for me and every adjacent foe (with the Intimidate
  // rules as a setting); PostDefendStatStageChangeAbAttr.apply (ab-attrs.ts:924-955) for the other and every other
  // adjacent Pokemon.
  "effect.stat-stages": v => {
    const stats = statListOf(String(v.stats));
    const stages = Number(v.stages);
    const target = String(v.target);
    const intimidate = v.intimidateRules === true;
    return ({ frame }) => {
      const pokemon = frame.holder;
      if (frame.simulated) {
        return;
      }
      if (target === "me") {
        globalScene.phaseManager.unshiftNew("StatStageChangePhase", pokemon.getBattlerIndex(), true, stats, stages);
        return;
      }
      if (target === "the other Pokemon") {
        if (frame.other) {
          globalScene.phaseManager.unshiftNew(
            "StatStageChangePhase",
            frame.other.getBattlerIndex(),
            false,
            stats,
            stages,
          );
        }
        return;
      }
      if (target === "every other adjacent Pokemon") {
        for (const other of [...pokemon.getAdjacentOpponents(), ...pokemon.getAdjacentAllies()]) {
          globalScene.phaseManager.unshiftNew("StatStageChangePhase", other.getBattlerIndex(), false, stats, stages);
        }
        return;
      }
      const arrangement = globalScene.currentBattle?.arrangement;
      for (const opponent of pokemon.getOpponentsGenerator()) {
        if (
          arrangement
          && !arrangement.isAdjacent(
            arrangement.locate(pokemon.getBattlerIndex()),
            arrangement.locate(opponent.getBattlerIndex()),
          )
        ) {
          continue;
        }
        const cancelled = new BooleanHolder(false);
        if (intimidate) {
          const params = {
            pokemon: opponent,
            cancelled,
            simulated: false,
            incomingStats: stats,
            incomingStages: stages,
          };
          applyAbAttrs("IntimidateImmunityAbAttr", params);
          applyAbAttrs("PostIntimidateStatStageChangeAbAttr", params);
          if (opponent.getTag(BattlerTagType.SUBSTITUTE)) {
            cancelled.value = true;
          }
        }
        if (!cancelled.value) {
          globalScene.phaseManager.unshiftNew(
            "StatStageChangePhase",
            opponent.getBattlerIndex(),
            false,
            stats,
            stages,
            true,
            false,
            true,
            null,
          );
        }
      }
    };
  },
  // Steal from the other Pokemon: PostAttackStealHeldItemAbAttr (ab-attrs.ts), the draw happens in the check and is
  // reused by the run. From any foe: VoidPostTurnStealAbAttr (bernerd-roster-mechanics.ts:368-381), one draw only when
  // something can be taken.
  "effect.steal-item": v => {
    if (v.from === "any-foe") {
      return {
        run: ({ frame }) => {
          if (frame.simulated) {
            return;
          }
          const candidates = takeableFoeItems(frame.holder);
          if (candidates.length === 0) {
            return;
          }
          globalScene.tryTransferHeldItemModifier(
            candidates[frame.holder.randBattleSeedInt(candidates.length)],
            frame.holder,
            false,
          );
        },
        feasible: ({ frame }) => frame.simulated || takeableFoeItems(frame.holder).length > 0,
      };
    }
    let stolenItem: PokemonHeldItemModifier | undefined;
    return {
      run: ({ frame }) => {
        const opponent = frame.other;
        if (opponent === undefined) {
          return;
        }
        const heldItems = heldItemsOf(opponent).filter(i => i.isTransferable);
        if (!stolenItem) {
          stolenItem = heldItems[frame.holder.randBattleSeedInt(heldItems.length)];
        }
        if (globalScene.tryTransferHeldItemModifier(stolenItem, frame.holder, false)) {
          globalScene.phaseManager.queueMessage(
            i18next.t("abilityTriggers:postAttackStealHeldItem", {
              pokemonNameWithAffix: getPokemonNameWithAffix(frame.holder),
              defenderName: opponent.name,
              stolenItemType: stolenItem.type.name,
            }),
          );
        }
        stolenItem = undefined;
      },
      feasible: ({ frame }) => {
        const opponent = frame.other;
        if (!frame.simulated && opponent !== undefined) {
          const heldItems = heldItemsOf(opponent).filter(i => i.isTransferable);
          if (heldItems.length > 0) {
            stolenItem = heldItems[frame.holder.randBattleSeedInt(heldItems.length)];
            if (globalScene.canTransferHeldItemModifier(stolenItem, frame.holder)) {
              return true;
            }
          }
        }
        stolenItem = undefined;
        return false;
      },
    };
  },
  // PostSummonMessageAbAttr.apply with the rebuilt built-in announcement (decl/B03/codecs.ts ANNOUNCEMENTS), or
  // PostSummonUnnamedMessageAbAttr.apply for typed text.
  "effect.message": v => {
    const announcement = String(v.announcement);
    const text = String(v.text);
    const build = announcement === "none" ? undefined : ANNOUNCEMENTS[announcement]?.build();
    if (announcement !== "none" && build === undefined) {
      throw new Error(`"${announcement}" is not a built-in announcement`);
    }
    return ({ frame }) => {
      if (!frame.simulated) {
        globalScene.phaseManager.queueMessage(build === undefined ? text : build(frame.holder));
      }
    };
  },
};

const FACTORIES: Readonly<Record<string, EffectFactory>> = {
  // Calc effects: same arithmetic and rounding as the original attrs.
  "effect.multiply-power": v => context => {
    holderField<NumberHolderLike>(context, "power").value *= Number(v.multiplier);
  },
  "effect.multiply-damage-taken": v => context => {
    const damage = holderField<NumberHolderLike>(context, "damage");
    damage.value = toDmgValue(damage.value * Number(v.multiplier));
  },
  "effect.multiply-damage-dealt": v => context => {
    const damage = holderField<NumberHolderLike>(context, "damage");
    damage.value = toDmgValue(damage.value * Number(v.multiplier));
  },
  // "Be immune to {type} moves": the SAME class Levitate uses, constructed once and consulted for both questions
  // ("may it block this move" = canApply, "block it" = apply). Nothing is re-implemented here.
  "effect.immune-to-type": v => {
    const type = String(v.type);
    const immuneType = (PokemonType as unknown as Record<string, number>)[type];
    if (typeof immuneType !== "number") {
      throw new Error(`"${type}" is not a known type`);
    }
    const delegate = new AttackTypeImmunityAbAttr(immuneType as PokemonType);
    return {
      run: context => delegate.apply(context.params as unknown as TypeMultiplierAbAttrParams),
      feasible: context => delegate.canApply(context.params as unknown as TypeMultiplierAbAttrParams),
      // TypeImmunityAbAttr.getImmuneType() is read by the engine (a Water immunity blocks Soak-style checks).
      carrierFields: { immuneType, condition: null },
    };
  },
  "effect.change-priority": v => context => {
    holderField<NumberHolderLike>(context, "priority").value += Number(v.amount);
  },

  // ---- Librarian pass (B19): calc effects with the exact arithmetic of the classes ---------------
  // BonusCritAbAttr.apply: critStage.value += stages
  "effect.raise-crit-stage": v => context => {
    holderField<NumberHolderLike>(context, "critStage").value += Number(v.stages);
  },
  // MultCritAbAttr: canApply is `critMult.value > 1` (only critical hits change), apply is `critMult.value *= multiplier`.
  "effect.multiply-crit-damage": v => ({
    run: context => {
      holderField<NumberHolderLike>(context, "critMult").value *= Number(v.multiplier);
    },
    feasible: context => holderField<NumberHolderLike>(context, "critMult").value > 1,
  }),
  // MoveEffectChanceMultiplierAbAttr: canApply is `!(chance <= 0 || move is Order Up or Electro Shot)`, apply multiplies
  // and caps the chance at 100.
  "effect.multiply-effect-chance": v => ({
    run: context => {
      const chance = holderField<NumberHolderLike>(context, "chance");
      chance.value *= Number(v.multiplier);
      chance.value = Math.min(chance.value, 100);
    },
    feasible: context => {
      const chance = holderField<NumberHolderLike>(context, "chance");
      const move = context.frame.move;
      return !(
        chance.value <= 0
        || (move !== undefined && (move.id === MoveId.ORDER_UP || move.id === MoveId.ELECTRO_SHOT))
      );
    },
  }),

  // Event effects: reuse the V1 effect runner.
  "effect.stat-stage": v =>
    v1Effect({
      kind: "stat-stage",
      target: v.target as never,
      stat: v.stat as never,
      stages: Number(v.stages),
    }),
  "effect.inflict-status": v => v1Effect({ kind: "status", target: v.target as never, status: v.status as never }),
  // The default settings run the V1 effect exactly as before; each new setting runs its own branch.
  "effect.cure-status": v => {
    if (v.alsoErAilments === true) {
      // PreSwitchOutResetStatusAbAttr (ab-attrs.ts:4123-4135): every status and every ER ailment, at once.
      const target = String(v.target) as AbilityStudioTarget;
      return {
        run: ({ frame }) => {
          if (frame.simulated) {
            return;
          }
          for (const pokemon of resolveTargets(target, ruleContext(frame))) {
            pokemon.resetStatus();
            clearErAilments(pokemon);
            pokemon.updateInfo();
          }
        },
        feasible: ({ frame }) =>
          resolveTargets(target, ruleContext(frame)).some(p => p.status != null || hasErAilment(p)),
      };
    }
    if (v.scope === "my-side") {
      // PostSummonUserFieldRemoveStatusEffectAbAttr (ab-attrs.ts:3863-3881): my side, with the cure message.
      const listed = statusListOf(String(v.statuses), String(v.status));
      return {
        run: ({ frame }) => {
          if (frame.simulated) {
            return;
          }
          for (const partyPokemon of frame.holder.getAlliesGenerator()) {
            if (partyPokemon.status && (listed === undefined || listed.includes(partyPokemon.status.effect))) {
              globalScene.phaseManager.queueMessage(
                getStatusEffectHealText(partyPokemon.status.effect, getPokemonNameWithAffix(partyPokemon)),
              );
              partyPokemon.resetStatus(false);
              partyPokemon.updateInfo();
            }
          }
        },
        feasible: ({ frame }) => {
          const party = frame.holder.isPlayer() ? globalScene.getPlayerField() : globalScene.getEnemyField();
          return party.filter(p => p.isAllowedInBattle()).length > 0;
        },
      };
    }
    return v1Effect({ kind: "cure-status", target: v.target as never, status: v.status as never });
  },
  "effect.heal-percent": v => {
    if (v.instant !== true) {
      return v1Effect({ kind: "heal-percent", target: v.target as never, percent: Number(v.percent) });
    }
    // PreSwitchOutHealAbAttr (ab-attrs.ts:4142-4153): heal at once; 33 / 100 === 0.33, so the arithmetic matches.
    const target = String(v.target) as AbilityStudioTarget;
    const percent = Number(v.percent);
    return {
      run: ({ frame }) => {
        if (frame.simulated) {
          return;
        }
        for (const pokemon of resolveTargets(target, ruleContext(frame))) {
          pokemon.heal(toDmgValue(pokemon.getMaxHp() * (percent / 100)));
          pokemon.updateInfo();
        }
      },
      feasible: ({ frame }) => resolveTargets(target, ruleContext(frame)).some(p => !p.isFullHp()),
    };
  },
  "effect.set-weather": v => {
    const turns = Number(v.turns);
    if (!(turns > 0)) {
      return v1Effect({ kind: "set-weather", weather: v.weather as never });
    }
    // ErWeatherSummonAbAttr: the inherited PostSummonWeatherChangeAbAttr.canApply (ab-attrs.ts), then its apply
    // (init-elite-redux-vanilla-rebalance.ts:2270-2281): set, then overwrite the turns.
    const weather = WeatherType[v.weather as keyof typeof WeatherType];
    return {
      run: ({ frame }) => {
        if (frame.simulated) {
          return;
        }
        globalScene.arena.trySetWeather(weather, frame.holder);
        const arenaWeather = globalScene.arena.weather;
        if (arenaWeather && arenaWeather.weatherType === weather && arenaWeather.turnsLeft > 0) {
          const lasting = erFieldTurnsWithItems(frame.holder, turns);
          arenaWeather.turnsLeft = lasting;
          arenaWeather.maxDuration = lasting;
        }
      },
      feasible: () => {
        const weatherReplaceable =
          weather === WeatherType.HEAVY_RAIN
          || weather === WeatherType.HARSH_SUN
          || weather === WeatherType.STRONG_WINDS
          || weather === WeatherType.NONE
          || !globalScene.arena.weather?.isImmutable();
        return weatherReplaceable && globalScene.arena.canSetWeather(weather);
      },
    };
  },
  "effect.set-terrain": v => {
    const turns = Number(v.turns);
    if (!(turns > 0)) {
      return v1Effect({ kind: "set-terrain", terrain: v.terrain as never });
    }
    // ErTerrainSummonAbAttr: the inherited PostSummonTerrainChangeAbAttr.canApply (`arena.canSetTerrain`), then its
    // apply (init-elite-redux-vanilla-rebalance.ts:2328-2338): set, then overwrite the turns.
    const terrain = TerrainType[v.terrain as keyof typeof TerrainType];
    return {
      run: ({ frame }) => {
        if (frame.simulated) {
          return;
        }
        globalScene.arena.trySetTerrain(terrain, false, frame.holder);
        const arenaTerrain = globalScene.arena.terrain;
        if (arenaTerrain && arenaTerrain.turnsLeft > 0) {
          arenaTerrain.turnsLeft = erFieldTurnsWithItems(frame.holder, turns);
        }
      },
      feasible: () => globalScene.arena.canSetTerrain(terrain),
    };
  },

  // "Switch out": the same helper Wimp Out and Emergency Exit use. Its guards and feasibility are bundled by the
  // effect definition (effects.ts), so a rule that only says "switch out" keeps every safety rule.
  "effect.force-switch-out": () => {
    const helper = new ForceSwitchOutHelper(SwitchType.SWITCH);
    return {
      // The original ignores `simulated` (a TODO in PostDamageForceSwitchAbAttr.apply); so does this.
      run: ({ frame }) => helper.switchOutLogic(frame.holder),
      feasible: ({ frame }) =>
        frame.holder.getOpponents().every(opponent => helper.getSwitchOutCondition(frame.holder, opponent)),
    };
  },

  // "Use {moveId} with {power} power": queues the scripted follow-up the way every ER scripted-move attr does
  // (scripted-move-util.ts), as an indirect move aimed at the foe.
  "effect.scripted-move": v => {
    // A vanilla move or an Elite Redux custom move (moveIdOf throws for an unknown name).
    const move = moveIdOf(String(v.moveId));
    const power = Number(v.power);
    return {
      run: ({ frame }) => {
        if (frame.simulated || frame.other === undefined) {
          return;
        }
        globalScene.phaseManager.unshiftNew(
          "MovePhase",
          frame.holder,
          [frame.other.getBattlerIndex()],
          scriptedPokemonMove(move as MoveId, power),
          MoveUseMode.INDIRECT,
        );
      },
      // An indirect move (including this effect's own follow-up) never triggers another follow-up: without this a
      // Water follow-up would answer itself forever. Same rule as the counter-attack archetype.
      feasible: ({ frame, params }) =>
        !frame.holder.isFainted()
        && frame.other !== undefined
        && !frame.other.isFainted()
        && params.useMode !== MoveUseMode.INDIRECT,
    };
  },
  ...COMPLETION_CALC_FACTORIES,
  ...COMPLETION_EVENT_FACTORIES,
};

export function compileEffect(ref: BlockRef): CompiledEffect {
  const def = getEffect(ref.block);
  if (def === undefined) {
    throw new Error(`there is no effect called "${ref.block}"`);
  }
  const factory = FACTORIES[def.id];
  if (factory === undefined) {
    throw new Error(`the effect "${def.id}" cannot run yet; it is not wired to the game code`);
  }
  const parts = factory(withParamDefaults(def.params, ref.params as ParamValues | undefined) as Resolved);
  const guards = def.guards ?? [];
  return typeof parts === "function" ? { run: parts, guards } : { ...parts, guards };
}

export function compileEffectBlock(ref: BlockRef): EffectRunner {
  return compileEffect(ref).run;
}

export function implementedEffectIds(): string[] {
  return Object.keys(FACTORIES).sort();
}
