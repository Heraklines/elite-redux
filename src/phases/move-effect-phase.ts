import type { PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { applyAbAttrs, applyFilteredAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { ConditionalProtectTag } from "#data/arena-tag";
import { MoveAnim } from "#data/battle-anims";
import { ProtectedTag, SemiInvulnerableTag, SubstituteTag, TypeBoostTag } from "#data/battler-tags";
import { erBatch3OnTargetHit } from "#data/elite-redux/abilities/batch3-on-hit";
import { erBatch4OnTargetHit } from "#data/elite-redux/abilities/batch4-on-hit";
import { consumeDualTypePrimeOnUse, dualTypePrimeApplies } from "#data/elite-redux/abilities/dual-type-move";
import { erCapacitorBankConsumeOnElectricUse } from "#data/elite-redux/abilities/electivire";
import {
  ConditionalAlwaysHitAbAttr,
  erMoveAlwaysHitsForUserType,
} from "#data/elite-redux/archetypes/conditional-always-hit";
import {
  bypassesOpponentMultiHitSuppression,
  suppressesOpponentDamageBoosts,
} from "#data/elite-redux/archetypes/post-defend-suppress-opponent-damage-boost";
import {
  erRecordAchievementMoveDamage,
  erRecordAchievementMoveResolution,
} from "#data/elite-redux/er-achievement-tracker";
import { erApplyCommunityOnHitItems } from "#data/elite-redux/er-community-items";
import { erApplyReactiveOnHit } from "#data/elite-redux/er-reactive-items";
import { applyErLifeOrbRecoil, applyErRockyHelmet } from "#data/elite-redux/er-recreated-items";
import {
  erApplyBlunderPolicyOnMiss,
  erApplyTacticalSwitchOnHit,
  erApplyThroatSprayOnUse,
  erCovertCloakGuards,
  erPopAirBalloonOnHit,
  erTransferStickyBarbOnHit,
} from "#data/elite-redux/er-tactical-items";
import { SpeciesFormChangePostMoveTrigger } from "#data/form-change-triggers";
import type { TypeDamageMultiplier } from "#data/type";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import type { BattlerIndex } from "#enums/battler-index";
import { BattlerTagLapseType } from "#enums/battler-tag-lapse-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitCheckResult } from "#enums/hit-check-result";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveEffectTrigger } from "#enums/move-effect-trigger";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveTarget } from "#enums/move-target";
import { isReflected, MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";

/**
 * Elite Redux: scan ALL of the user's active ability attrs (primary ability +
 * every eligible innate slot) for a `ConditionalAlwaysHitAbAttr` whose predicate
 * matches the current move. Returns true if at least one matches.
 *
 * Uses `getAllActiveAbilityAttrs()` (innate-aware): the previous version only
 * walked `getAbility()` + `getPassiveAbility()` (innate slot 0), so a
 * conditional-always-hit ability living in innate slot 1-2 (e.g. Deadeye on
 * Porygon-Z, whose Zap Cannon kept missing) was invisible and its moves could
 * still miss.
 */
function erUserHasConditionalAlwaysHit(user: Pokemon, move: import("#moves/move").Move, target: Pokemon): boolean {
  for (const attr of user.getAllActiveAbilityAttrs()) {
    if (attr instanceof ConditionalAlwaysHitAbAttr && attr.matches(move, user, target)) {
      return true;
    }
  }
  return false;
}

import {
  ContactHeldItemTransferChanceModifier,
  DamageMoneyRewardModifier,
  EnemyAttackStatusEffectChanceModifier,
  EnemyEndureChanceModifier,
  FlinchChanceModifier,
  HitHealModifier,
  PokemonMultiHitModifier,
} from "#modifiers/modifier";
import { applyFilteredMoveAttrs, applyMoveAttrs } from "#moves/apply-attrs";
import type { Move, MoveAttr } from "#moves/move";
import { isFieldTargeted } from "#moves/move-utils";
import { PokemonPhase } from "#phases/pokemon-phase";
import { DamageAchv } from "#system/achv";
import type { nil } from "#types/common";
import type { DamageResult } from "#types/damage-result";
import type { TurnMove } from "#types/turn-move";
import { BooleanHolder, NumberHolder } from "#utils/common";
import i18next from "i18next";

export type HitCheckEntry = [HitCheckResult, TypeDamageMultiplier];

/**
 * Type representing the resolved status of a move's damage processing.
 */
type MoveDamageTuple = readonly [
  /** The {@linkcode HitResult} of the interaction. */
  result: HitResult,
  /** The final amount of damage that was dealt. */
  damage: number,
  /** Whether the attack was a critical hit. */
  wasCritical: boolean,
];

export class MoveEffectPhase extends PokemonPhase {
  public readonly phaseName = "MoveEffectPhase";
  public move: Move;
  protected targets: BattlerIndex[];
  protected useMode: MoveUseMode;

  /** The result of the hit check against each target */
  private hitChecks: HitCheckEntry[];

  /**
   * Log to be entered into the user's move history once the move result is resolved.

   * Note that `result` logs whether the move was successfully
   * used in the sense of "Does it have an effect on the user?".
   */
  private moveHistoryEntry: TurnMove;

  /** Is this the first strike of a move? */
  private firstHit: boolean;
  /** Is this the last strike of a move? */
  private lastHit: boolean;
  /**
   * ER Negative Feedback (5923): whether the user was ALREADY dual-type-primed
   * when this move began. Snapshotted so the move that SETS the prime (in its own
   * PostAttack) does not also consume it — only a move that started primed does.
   */
  private erStartedPrimed = false;

  /**
   * @param useMode - The {@linkcode MoveUseMode} corresponding to how this move was used.
   */
  constructor(battlerIndex: BattlerIndex, targets: BattlerIndex[], move: Move, useMode: MoveUseMode) {
    super(battlerIndex);
    this.move = move;
    this.useMode = useMode;

    /**
     * In double battles, if the right Pokemon selects a spread move and the left Pokemon dies
     * with no party members available to switch in, then the right Pokemon takes the index
     * of the left Pokemon and gets hit unless this is checked.
     */
    if (targets.includes(battlerIndex) && this.move.moveTarget === MoveTarget.ALL_NEAR_OTHERS) {
      const i = targets.indexOf(battlerIndex);
      targets.splice(i, i + 1);
    }
    this.targets = targets;

    this.hitChecks = new Array(this.targets.length).fill([HitCheckResult.PENDING, 0]);
  }

  public override start(): void {
    super.start();

    /** The Pokemon using this phase's invoked move */
    const user = this.getUserPokemon();
    if (!user) {
      super.end();
      return;
    }

    /** If an enemy used this move, set this as last enemy that used move or ability */
    if (user.isPlayer()) {
      globalScene.currentBattle.lastPlayerInvolved = this.fieldIndex;
    } else {
      globalScene.currentBattle.lastEnemyInvolved = this.fieldIndex;
    }

    const move = this.move;

    // ER Negative Feedback (5923): snapshot whether the user began this move
    // already dual-type-primed, so only a move that STARTED primed consumes it.
    this.erStartedPrimed = dualTypePrimeApplies(user, move);

    /**
     * Does an effect from this move override other effects on this turn?
     * e.g. Charging moves (Fly, etc.) on their first turn of use.
     */
    const overridden = new BooleanHolder(false);

    // Apply effects to override a move effect.
    // Assuming single target here works as this is (currently)
    // only used for Future Sight, calling and Pledge moves.
    // TODO: change if any other move effect overrides are introduced
    applyMoveAttrs("OverrideMoveEffectAttr", user, this.getFirstTarget() ?? null, move, overridden, this.useMode);

    // If other effects were overriden, stop this phase before they can be applied
    if (overridden.value) {
      this.end();
      return;
    }

    // Lapse `MOVE_EFFECT` effects (i.e. semi-invulnerability) when applicable
    user.lapseTags(BattlerTagLapseType.MOVE_EFFECT);

    /**
     * If this phase is for the first hit of the invoked move,
     * resolve the move's total hit count. This block combines the
     * effects of the move itself, Parental Bond, and Multi-Lens to do so.
     */
    if (user.turnData.hitsLeft === -1) {
      const hitCount = new NumberHolder(1);
      const opponent = this.getFirstTarget();
      const suppressesMultiHitAbilities =
        opponent != null
        && !move.doesFlagEffectApply({ flag: MoveFlags.IGNORE_ABILITIES, user, target: opponent })
        && suppressesOpponentDamageBoosts(opponent);
      // Assume single target for multi hit
      applyMoveAttrs("MultiHitAttr", user, opponent ?? null, move, hitCount, suppressesMultiHitAbilities);
      // If Parental Bond is applicable, add another hit
      const addStrikeParams = { pokemon: user, move, hitCount, opponent };
      if (suppressesMultiHitAbilities) {
        applyFilteredAbAttrs("AddSecondStrikeAbAttr", addStrikeParams, bypassesOpponentMultiHitSuppression);
      } else {
        applyAbAttrs("AddSecondStrikeAbAttr", addStrikeParams);
      }
      // ER Unrelenting (994): turn an eligible single-hit move into a 2-5-hit move.
      if (!suppressesMultiHitAbilities) {
        applyAbAttrs("AllAttacksMultiHitAbAttr", { pokemon: user, move, hitCount, opponent });
      }
      // If Multi-Lens is applicable, add hits equal to the number of held Multi-Lenses
      globalScene.applyModifiers(PokemonMultiHitModifier, user.isPlayer(), user, move.id, hitCount);
      // ER multi-hit COUNT override (Giant Shuriken 960: Water Shuriken hits
      // exactly once). Scanned by name — registration-free, same pattern as the
      // MoveCategoryOverrideAbAttr scan in Pokemon.getAttackDamage. Runs LAST
      // (after native multi-hit + Parental Bond + Multi-Lens) so the forced count
      // wins.
      for (const attr of user.getAllActiveAbilityAttrs()) {
        if (attr?.constructor?.name === "OverrideMultiHitCountAbAttr") {
          const forced = (attr as unknown as { resolveHits: (m: typeof move) => number | null }).resolveHits(move);
          if (forced != null) {
            hitCount.value = forced;
          }
        }
      }
      // Set the user's relevant turnData fields to reflect the final hit count
      user.turnData.hitCount = hitCount.value;
      user.turnData.hitsLeft = hitCount.value;
    }

    this.moveHistoryEntry = {
      move: this.move.id,
      targets: this.targets,
      result: MoveResult.PENDING,
      useMode: this.useMode,
    };

    const fieldMove = isFieldTargeted(move);

    const targets = this.conductHitChecks(user, fieldMove);

    this.firstHit = user.turnData.hitCount === user.turnData.hitsLeft;
    this.lastHit = user.turnData.hitsLeft === 1 || !targets.some(t => t.isActive(true));
    // ER Capacitor Bank (5925): the holder's Electric moves consume ONE charge
    // stack per move (guarded to the first strike so a multi-hit move spends one).
    if (this.firstHit) {
      erCapacitorBankConsumeOnElectricUse(user, move);
    }
    erRecordAchievementMoveResolution(user, move, targets, this.hitChecks, this.useMode, this.firstHit);

    // Play the animation if the move was successful against any of its targets or it has a POST_TARGET effect (like self destruct)
    if (
      this.moveHistoryEntry.result === MoveResult.SUCCESS
      || move.getAttrs("MoveEffectAttr").some(attr => attr.trigger === MoveEffectTrigger.POST_TARGET)
    ) {
      const moveTargets = this.getTargets();
      const targetsForAnimation = moveTargets.length > 0 ? moveTargets : [user];
      let animationsLeft = targetsForAnimation.length;

      for (const target of targetsForAnimation) {
        new MoveAnim(
          move.id as MoveId,
          user,
          target.getBattlerIndex(),
          // Some moves used in mystery encounters should be played even on an empty field
          globalScene.currentBattle?.mysteryEncounter?.hasBattleAnimationsWithoutTargets ?? false,
        ).play(move.hitsSubstitute(user, target), () => {
          animationsLeft--;
          if (animationsLeft === 0) {
            this.postAnimCallback(user, targets);
          }
        });
      }
      return;
    }
    this.postAnimCallback(user, targets);
  }

  /**
   * Compute targets and the results of hit checks of the invoked move against all targets,
   * organized by battler index.
   *
   * **This is *not* a pure function**; it has the following side effects
   * - `this.hitChecks` - The results of the hit checks against each target
   * - `this.moveHistoryEntry` - Sets success or failure based on the hit check results
   * - user.turnData.hitCount and user.turnData.hitsLeft - Both set to 1 if the
   *   move was unsuccessful against all targets
   *
   * @returns The targets of the invoked move
   * @see {@linkcode hitCheck}
   */
  private conductHitChecks(user: Pokemon, fieldMove: boolean): Pokemon[] {
    /** All Pokemon targeted by this phase's invoked move */
    /** Whether any hit check ended in a success */
    let anySuccess = false;
    /** Whether the attack missed all of its targets */
    let allMiss = true;

    let targets = this.getTargets();

    // For field targeted moves, we only look for the first target that may magic bounce

    for (const [i, target] of targets.entries()) {
      const hitCheck = this.hitCheck(target);
      // If the move bounced and was a field targeted move,
      // then immediately stop processing other targets
      if (fieldMove && hitCheck[0] === HitCheckResult.REFLECTED) {
        targets = [target];
        this.hitChecks = [hitCheck];
        break;
      }
      if (hitCheck[0] === HitCheckResult.HIT) {
        anySuccess = true;
      } else {
        allMiss ||= hitCheck[0] === HitCheckResult.MISS;
      }
      this.hitChecks[i] = hitCheck;
    }

    if (anySuccess) {
      this.moveHistoryEntry.result = MoveResult.SUCCESS;
    } else {
      user.turnData.hitCount = 1;
      user.turnData.hitsLeft = 1;
      this.moveHistoryEntry.result = allMiss ? MoveResult.MISS : MoveResult.FAIL;
    }

    return targets;
  }

  /**
   * Callback to be called after the move animation is played
   */
  private postAnimCallback(user: Pokemon, targets: Pokemon[]) {
    // Add to the move history entry
    if (this.firstHit && this.useMode !== MoveUseMode.DELAYED_ATTACK) {
      user.pushMoveHistory(this.moveHistoryEntry);
      applyAbAttrs("ExecutedMoveAbAttr", { pokemon: user });
    }

    try {
      this.applyToTargets(user, targets);
    } catch (e) {
      console.warn(e.message || "Unexpected error in move effect phase");
      this.end();
      return;
    }

    const moveType = user.getMoveType(this.move, true);
    if (this.move.category !== MoveCategory.STATUS && !user.stellarTypesBoosted.includes(moveType)) {
      user.stellarTypesBoosted.push(moveType);
    }

    if (this.lastHit) {
      this.triggerMoveEffects(MoveEffectTrigger.POST_TARGET, user, null);
    }

    this.updateSubstitutes();
    this.end();
  }

  /**
   * Apply the move to each of the resolved targets.
   * @param targets - The resolved set of targets of the move
   * @throws Error if there was an unexpected hit check result
   */
  private applyToTargets(user: Pokemon, targets: Pokemon[]): void {
    let firstHit = true;
    for (const [i, target] of targets.entries()) {
      const [hitCheckResult, effectiveness] = this.hitChecks[i];
      switch (hitCheckResult) {
        case HitCheckResult.HIT:
          this.applyMoveEffects(target, effectiveness, firstHit);
          firstHit = false;
          if (isFieldTargeted(this.move)) {
            // Stop processing other targets if the move is a field move
            return;
          }
          break;
        // biome-ignore lint/suspicious/noFallthroughSwitchClause: The fallthrough is intentional
        case HitCheckResult.NO_EFFECT:
          globalScene.phaseManager.queueMessage(
            i18next.t(this.move.id === MoveId.SHEER_COLD ? "battle:hitResultImmune" : "battle:hitResultNoEffect", {
              pokemonName: getPokemonNameWithAffix(target),
            }),
          );
        case HitCheckResult.NO_EFFECT_NO_MESSAGE:
        case HitCheckResult.PROTECTED:
        case HitCheckResult.TARGET_NOT_ON_FIELD:
          applyMoveAttrs("NoEffectAttr", user, target, this.move);
          break;
        case HitCheckResult.MISS:
          globalScene.phaseManager.queueMessage(
            i18next.t("battle:attackMissed", { pokemonNameWithAffix: getPokemonNameWithAffix(target) }),
          );
          applyMoveAttrs("MissEffectAttr", user, target, this.move);
          // ER Blunder Policy: an accuracy miss sharply raises the user's Speed.
          erApplyBlunderPolicyOnMiss(user);
          break;
        case HitCheckResult.REFLECTED:
          globalScene.phaseManager.unshiftNew("MoveReflectPhase", target, user, this.move);
          break;
        case HitCheckResult.PENDING:
        case HitCheckResult.ERROR:
          throw new Error("Unexpected hit check result");
      }
    }
  }

  /**
   * Conduct the hit check and type effectiveness for this move against the target
   *
   * Checks occur in the following order:
   * 1. if the move is self-target
   * 2. if the target is on the field
   * 3. if the target is hidden by the effects of its commander ability
   * 4. if the target is in an applicable semi-invulnerable state
   * 5. if the target has an applicable protection effect
   * 6. if the move is reflected by magic coat or magic bounce
   * 7. type effectiveness calculation, including immunities from abilities and typing
   * 9. if accuracy is checked, whether the roll passes the accuracy check
   * @param target - The {@linkcode Pokemon} targeted by the invoked move
   * @returns a {@linkcode HitCheckEntry} containing the attack's {@linkcode HitCheckResult}
   *  and {@linkcode TypeDamageMultiplier | effectiveness} against the target.
   */
  public hitCheck(target: Pokemon): HitCheckEntry {
    const user = this.getUserPokemon();
    const move = this.move;

    // Moves targeting the user bypass all checks
    if (move.moveTarget === MoveTarget.USER) {
      return [HitCheckResult.HIT, 1];
    }

    // Elite Redux — Trepidation's Despair: while the ER_DESPAIR tag is active on
    // the USER, every Psychic-type move it uses misses (for the tag's 3 turns).
    // No vanilla "miss a specific type" primitive exists, so force the miss here.
    if (user.getTag(BattlerTagType.ER_DESPAIR) && user.getMoveType(move) === PokemonType.PSYCHIC) {
      return [HitCheckResult.MISS, 0];
    }

    const fieldTargeted = isFieldTargeted(move);

    if (!target.isActive(true) && !fieldTargeted) {
      return [HitCheckResult.TARGET_NOT_ON_FIELD, 0];
    }

    // Commander causes moves used against the target to miss (any multi format + ANY
    // ally - was `double` + first-ally-only, so a hidden Tatsugiri was hittable in triples)
    if (
      !fieldTargeted
      && globalScene.currentBattle.getBattlerCount() > 1
      && target.getAllies().some(ally => ally.getTag(BattlerTagType.COMMANDED)?.getSourcePokemon() === target)
    ) {
      return [HitCheckResult.MISS, 0];
    }

    /** Whether both accuracy and invulnerability checks can be skipped */
    const bypassAccAndInvuln = fieldTargeted || this.checkBypassAccAndInvuln(target);
    const semiInvulnerableTag = target.getTag(SemiInvulnerableTag);

    if (semiInvulnerableTag && !bypassAccAndInvuln && !this.checkBypassSemiInvuln(semiInvulnerableTag)) {
      return [HitCheckResult.MISS, 0];
    }

    if (!fieldTargeted && this.protectedCheck(user, target)) {
      return [HitCheckResult.PROTECTED, 0];
    }

    // Reflected moves cannot be reflected again
    if (isMoveReflectableBy(this.move, target, this.useMode)) {
      return [HitCheckResult.REFLECTED, 0];
    }

    // After the magic bounce check, field targeted moves are always successful
    if (fieldTargeted) {
      return [HitCheckResult.HIT, 1];
    }

    // Elite Redux — Prismatic Fur's "Color Change" half: change the TARGET's type
    // to one that resists/is immune to the incoming move BEFORE effectiveness is
    // computed below, so the swap actually reduces the damage taken. Gated to
    // holders of PreHitResistTypeChangeAbAttr (only Prismatic Fur), so it is a
    // no-op for everything else.
    applyAbAttrs("PreHitResistTypeChangeAbAttr", { pokemon: target, opponent: user, move });

    const cancelNoEffectMessage = new BooleanHolder(false);

    /**
     * The effectiveness of the move against the given target.
     * Accounts for type and move immunities from defensive typing, abilities, and other effects.
     */
    // Mold Breaker / Teravolt / Turboblaze / Sunsteel Strike / Photon Geyser /
    // Mycelium Might etc. must be able to punch through type-immunity abilities
    // (Levitate, Flash Fire, Water/Volt Absorb, Sap Sipper, …). `doesFlagEffectApply`
    // evaluates the user's MoveAbilityBypassAbAttr (including its per-move
    // condition) and the move's IGNORE_ABILITIES flag, so feed that into the
    // effectiveness check rather than hardcoding `false`.
    const ignoreDefAbility = move.doesFlagEffectApply({ flag: MoveFlags.IGNORE_ABILITIES, user, target });
    const effectiveness = target.getMoveEffectiveness(user, move, ignoreDefAbility, false, cancelNoEffectMessage);
    if (effectiveness === 0) {
      return [
        cancelNoEffectMessage.value ? HitCheckResult.NO_EFFECT_NO_MESSAGE : HitCheckResult.NO_EFFECT,
        effectiveness,
      ];
    }

    const moveAccuracy = move.calculateBattleAccuracy(user, target);

    // Strikes after the first in a multi-strike move are guaranteed to hit,
    // unless the move is flagged to check all hits and the user does not have Skill Link.
    if (
      user.turnData.hitsLeft < user.turnData.hitCount
      && (!move.hasFlag(MoveFlags.CHECK_ALL_HITS) || user.hasAbilityWithAttr("MaxMultiHitAbAttr"))
    ) {
      return [HitCheckResult.HIT, effectiveness];
    }

    const bypassAccuracy =
      bypassAccAndInvuln
      || target.getTag(BattlerTagType.ALWAYS_GET_HIT)
      || (target.getTag(BattlerTagType.TELEKINESIS) && !this.move.hasAttr("OneHitKOAttr"));

    if (moveAccuracy === -1 || bypassAccuracy) {
      return [HitCheckResult.HIT, effectiveness];
    }

    const accuracyMultiplier = user.getAccuracyMultiplier(target, this.move);
    const rand = user.randBattleSeedInt(100);

    if (rand < moveAccuracy * accuracyMultiplier) {
      return [HitCheckResult.HIT, effectiveness];
    }

    return [HitCheckResult.MISS, 0];
  }

  /**
   * Check whether the move should bypass *both* the accuracy *and* semi-invulnerable states.
   * @param target - The {@linkcode Pokemon} targeted by the invoked move
   * @returns `true` if the move should bypass accuracy and semi-invulnerability
   *
   * Accuracy and semi-invulnerability can be bypassed by:
   * - An ability like {@linkcode AbilityId.NO_GUARD | No Guard}
   * - A poison type using {@linkcode MoveId.TOXIC | Toxic}
   * - A move like {@linkcode MoveId.LOCK_ON | Lock-On}.
   * - A field-targeted move like spikes
   *
   * Does *not* check against effects {@linkcode MoveId.GLAIVE_RUSH | Glaive Rush} status (which
   * should not bypass semi-invulnerability), or interactions like Earthquake hitting against Dig,
   * (which should not bypass the accuracy check).
   *
   * @see {@linkcode hitCheck}
   */
  public checkBypassAccAndInvuln(target: Pokemon) {
    const user = this.getUserPokemon();
    if (user.hasAbilityWithAttr("AlwaysHitAbAttr") || target.hasAbilityWithAttr("AlwaysHitAbAttr")) {
      return true;
    }
    // Elite Redux: per-move conditional always-hit (Hypnotist on Hypnosis,
    // Roundhouse on KICKING_MOVE, Artillery on PULSE_MOVE, Sweeping Edge on
    // SLICING_MOVE, Gifted Mind on status moves, Angel's Wrath on specific
    // move IDs). See src/data/elite-redux/archetypes/conditional-always-hit.ts.
    if (erUserHasConditionalAlwaysHit(user, this.move, target)) {
      return true;
    }
    if (this.move.hasAttr("ToxicAccuracyAttr") && user.isOfType(PokemonType.POISON)) {
      return true;
    }
    // Elite Redux: move-intrinsic "never misses if user is <Type>-type" clause
    // (Leech Seed/Grass, Thunder Wave/Electric, Will-O-Wisp/Fire, Flash Freeze/Ice).
    if (erMoveAlwaysHitsForUserType(this.move, user)) {
      return true;
    }
    // TODO: Fix lock on check to belong to the battler tag - this is really ugly
    // NOTE: Mind Reader is an Elite Redux protect move (no longer a lock-on),
    // so only Lock-On still grants the IGNORE_ACCURACY bypass here.
    if (
      user.getTag(BattlerTagType.IGNORE_ACCURACY)
      && user
        .getLastXMoves(-1)
        .find(m => m.move === MoveId.LOCK_ON)
        ?.targets?.includes(target.getBattlerIndex())
    ) {
      return true;
    }
    if (isFieldTargeted(this.move)) {
      return true;
    }
  }

  /**
   * Check whether the move is able to ignore the given `semiInvulnerableTag`
   * @param semiInvulnerableTag - The semiInvulnerable tag to check against
   * @returns `true` if the move can ignore the semi-invulnerable state
   */
  public checkBypassSemiInvuln(semiInvulnerableTag: SemiInvulnerableTag | nil): boolean {
    if (!semiInvulnerableTag) {
      return false;
    }
    const move = this.move;
    return move.getAttrs("HitsTagAttr").some(hta => hta.tagType === semiInvulnerableTag.tagType);
  }

  /**
   * Check whether the target is protected by protect or a relevant conditional protection.
   * @param user - The {@linkcode Pokemon} using this phase's invoked move
   * @param target - The target {@linkcode Pokemon} to check for protection
   * @returns Whether the target was protected
   */
  private protectedCheck(user: Pokemon, target: Pokemon): boolean {
    /** The {@linkcode ArenaTagSide} to which the target belongs */
    const targetSide = target.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
    /** Has the invoked move been cancelled by conditional protection (e.g Quick Guard)? */
    const hasConditionalProtectApplied = new BooleanHolder(false);
    /** Does the applied conditional protection bypass Protect-ignoring effects? */
    const bypassIgnoreProtect = new BooleanHolder(false);
    /** If the move is not targeting a Pokemon on the user's side, try to apply conditional protection effects */
    if (!this.move.isAllyTarget()) {
      globalScene.arena.applyTagsForSide(
        ConditionalProtectTag,
        targetSide,
        false,
        hasConditionalProtectApplied,
        user,
        target,
        this.move.id,
        bypassIgnoreProtect,
      );
    }

    const protectionTags = target.findTags(t => t instanceof ProtectedTag);
    const isStatusMove = this.move.category === MoveCategory.STATUS;

    // TODO: Break up this chunky boolean to make it more palatable
    return (
      ![MoveTarget.ENEMY_SIDE, MoveTarget.BOTH_SIDES].includes(this.move.moveTarget)
      && (bypassIgnoreProtect.value || !this.move.doesFlagEffectApply({ flag: MoveFlags.IGNORE_PROTECT, user, target }))
      && (hasConditionalProtectApplied.value
        || protectionTags.some(
          t =>
            (!isStatusMove || t.blockStatus)
            && t.protectsAgainstMove(this.move, user, target)
            && target.lapseTag(t.tagType),
        ))
    );
  }

  /**
   * Triggers move effects of the given move effect trigger.
   * @param triggerType The {@linkcode MoveEffectTrigger} being applied
   * @param user The {@linkcode Pokemon} using the move
   * @param target The {@linkcode Pokemon} targeted by the move
   * @param firstTarget Whether the target is the first to be hit by the current strike
   * @param selfTarget If defined, limits the effects triggered to either self-targeted
   *  effects (if set to `true`) or targeted effects (if set to `false`).
   */
  protected triggerMoveEffects(
    triggerType: MoveEffectTrigger,
    user: Pokemon,
    target: Pokemon | null,
    firstTarget?: boolean | null,
    selfTarget?: boolean,
  ): void {
    applyFilteredMoveAttrs(
      (attr: MoveAttr) =>
        attr.is("MoveEffectAttr")
        && attr.trigger === triggerType
        && (selfTarget == null || attr.selfTarget === selfTarget)
        && (!attr.firstHitOnly || this.firstHit)
        && (!attr.lastHitOnly || this.lastHit)
        && (!attr.firstTargetOnly || (firstTarget ?? true)),
      user,
      target,
      this.move,
    );
  }

  /**
   * Applies all move effects that trigger in the event of a successful hit:
   *
   * - {@linkcode MoveEffectTrigger.PRE_APPLY | PRE_APPLY} effects
   * - Applying damage to the target
   * - {@linkcode MoveEffectTrigger.POST_APPLY | POST_APPLY} effects
   * - Invoking {@linkcode applyOnTargetEffects} if the move does not hit a substitute
   * - Triggering form changes and emergency exit / wimp out if this is the last hit
   *
   * @param target - the {@linkcode Pokemon} hit by this phase's move.
   * @param effectiveness - The effectiveness of the move (as previously evaluated in {@linkcode hitCheck})
   * @param firstTarget - Whether this is the first target successfully struck by the move
   */
  protected applyMoveEffects(target: Pokemon, effectiveness: TypeDamageMultiplier, firstTarget: boolean): void {
    const user = this.getUserPokemon();

    this.triggerMoveEffects(MoveEffectTrigger.PRE_APPLY, user, target);

    const result = this.applyMove(user, target, effectiveness);

    // Apply effects to the user (always) and the target (if not blocked by substitute).
    this.triggerMoveEffects(MoveEffectTrigger.POST_APPLY, user, target, firstTarget, true);
    if (!this.move.hitsSubstitute(user, target)) {
      this.applyOnTargetEffects(user, target, firstTarget, result);
    }
    if (this.lastHit) {
      // ER Negative Feedback (5923) prime: consume the holder's dual-type prime
      // once its (physical) move has fully resolved — but ONLY if the move began
      // primed (not the move that just SET the prime in its own PostAttack).
      if (this.erStartedPrimed) {
        consumeDualTypePrimeOnUse(user, this.move);
      }
      globalScene.triggerPokemonFormChange(user, SpeciesFormChangePostMoveTrigger);

      // Multi-hit check for Wimp Out/Emergency Exit
      if (user.turnData.hitCount > 1) {
        // TODO: Investigate why 0 is being passed for damage amount here
        // and then determing if refactoring `applyMove` to return the damage dealt is appropriate.
        applyAbAttrs("PostDamageAbAttr", { pokemon: target, damage: 0, source: user });
      }
    }
  }

  /**
   * Apply the result of this phase's move to the given target.
   * @param user - The {@linkcode Pokemon} using this phase's invoked move
   * @param target - The {@linkcode Pokemon} struck by the move
   * @param effectiveness - The effectiveness of the move against the target
   * @returns A {@linkcode MoveDamageTuple} containing the results of damage application.
   */
  protected applyMove(user: Pokemon, target: Pokemon, effectiveness: TypeDamageMultiplier): MoveDamageTuple {
    const moveCategory = user.getMoveCategory(target, this.move);

    if (moveCategory === MoveCategory.STATUS) {
      return [HitResult.STATUS, 0, false];
    }

    const result = this.applyMoveDamage(user, target, effectiveness);

    if (user.turnData.hitsLeft === 1 || target.isFainted()) {
      this.queueHitResultMessage(result[0]);
    }

    if (target.isFainted()) {
      this.onFaintTarget(user, target);
    }

    return result;
  }

  /**
   * Sub-method of {@linkcode applyMove} that applies damage to the target.
   * @param user - The {@linkcode Pokemon} using this phase's invoked move
   * @param target - The {@linkcode Pokemon} targeted by the move
   * @param effectiveness - The type effectiveness of the move against the target
   * @returns A {@linkcode MoveDamageTuple} containing the results of damage application.
   */
  protected applyMoveDamage(user: Pokemon, target: Pokemon, effectiveness: TypeDamageMultiplier): MoveDamageTuple {
    const isCritical = target.getCriticalHitResult(user, this.move);

    /*
     * Apply stat changes from {@linkcode move} and gives it to {@linkcode source}
     * before damage calculation
     */
    applyMoveAttrs("StatChangeBeforeDmgCalcAttr", user, target, this.move);

    // Mold Breaker & co. also ignore the target's damage-MODIFYING abilities
    // (Multiscale, Thick Fat, Filter/Solid Rock, Fluffy, Heatproof, Ice Scales,
    // Punk Rock, …), not just type immunities. Mirror the hitCheck computation.
    const ignoreDefAbility = this.move.doesFlagEffectApply({ flag: MoveFlags.IGNORE_ABILITIES, user, target });
    const { result, damage: initialDmg } = target.getAttackDamage({
      source: user,
      move: this.move,
      ignoreAbility: ignoreDefAbility,
      ignoreSourceAbility: false,
      ignoreAllyAbility: false,
      ignoreSourceAllyAbility: false,
      simulated: false,
      effectiveness,
      isCritical,
    });

    // TODO: Verify if flash fire/charge are consumed if damage is prevented
    const typeBoost = user.findTag(
      (t): t is TypeBoostTag => t instanceof TypeBoostTag && t.boostedType === user.getMoveType(this.move),
    );
    if (typeBoost?.oneUse) {
      user.removeTag(typeBoost.tagType);
    }

    if (initialDmg <= 0) {
      return [result, 0, false];
    }

    const isOneHitKo = result === HitResult.ONE_HIT_KO;
    const targetHpBefore = target.hp;
    target.lapseTags(BattlerTagLapseType.HIT);

    const substitute = target.getTag(SubstituteTag);
    const isBlockedBySubstitute = !!substitute && this.move.hitsSubstitute(user, target);
    if (isBlockedBySubstitute) {
      user.turnData.totalDamageDealt += Math.min(initialDmg, substitute.hp);
      substitute.hp -= initialDmg;
    } else if (!target.isPlayer() && initialDmg >= target.hp) {
      globalScene.applyModifiers(EnemyEndureChanceModifier, false, target);
    }

    const finalDmg = isBlockedBySubstitute
      ? 0
      : target.damageAndUpdate(initialDmg, {
          // Type assertion is OK as all non-damaging HitResults will have returned by now
          result: result as DamageResult,
          ignoreFaintPhase: true,
          ignoreSegments: isOneHitKo,
          isCritical,
          source: user,
        });

    // Co-op host turn recorder (#633, animation-replay redesign - Step 2): the post-hit `hp` event is
    // now recorded at the UNIVERSAL damage chokepoint (Pokemon.damage), so a move hit, a status / weather
    // chip, recoil, and an entry hazard all emit it uniformly - this move-only recorder is removed. A
    // substitute hit stays excluded there too (it mutates substitute.hp directly, never calling damage()).

    if (isCritical) {
      globalScene.phaseManager.queueMessage(i18next.t("battle:hitResultCriticalHit"));
    }

    if (finalDmg <= 0) {
      return [result, 0, isCritical];
    }

    if (user.isPlayer()) {
      globalScene.validateAchvs(DamageAchv, new NumberHolder(finalDmg));

      if (finalDmg > globalScene.gameData.gameStats.highestDamage) {
        globalScene.gameData.gameStats.highestDamage = finalDmg;
      }
    }

    user.turnData.totalDamageDealt += finalDmg;
    user.turnData.singleHitDamageDealt = finalDmg;
    target.battleData.hitCount++;
    target.turnData.damageTaken += finalDmg;

    // ER recreated held items: Life Orb recoil on the attacker, Rocky Helmet
    // contact damage from the target. Both gated on damage actually dealt.
    // ER Sheer Force (125): moves it power-boosts (those with a secondary effect,
    // move.chance >= 1) do NOT incur Life Orb recoil.
    const sheerForceSuppressesRecoil = user.hasAbility(AbilityId.SHEER_FORCE) && this.move.chance >= 1;
    if (!sheerForceSuppressesRecoil) {
      applyErLifeOrbRecoil(user, finalDmg);
    }
    applyErRockyHelmet(user, target, this.move, finalDmg);

    target.turnData.attacksReceived.unshift({
      move: this.move.id,
      result: result as DamageResult,
      damage: finalDmg,
      critical: isCritical,
      sourceId: user.id,
      sourceBattlerIndex: user.getBattlerIndex(),
    });

    if (user.isPlayer() && target.isEnemy()) {
      globalScene.applyModifiers(DamageMoneyRewardModifier, true, user, new NumberHolder(finalDmg));
    }

    erRecordAchievementMoveDamage(
      user,
      target,
      this.move,
      this.useMode,
      finalDmg,
      isCritical,
      targetHpBefore,
      result === HitResult.SUPER_EFFECTIVE,
    );

    return [result, finalDmg, isCritical];
  }

  /**
   * Sub-method of {@linkcode applyMove} that queues the hit-result message
   * on the final strike of the move against a target
   * @param result - The {@linkcode HitResult} of the move
   */
  protected queueHitResultMessage(result: HitResult) {
    let msg: string | undefined;
    switch (result) {
      case HitResult.SUPER_EFFECTIVE:
        msg = i18next.t("battle:hitResultSuperEffective");
        break;
      case HitResult.NOT_VERY_EFFECTIVE:
        msg = i18next.t("battle:hitResultNotVeryEffective");
        break;
      case HitResult.ONE_HIT_KO:
        msg = i18next.t("battle:hitResultOneHitKo");
        break;
    }
    if (msg) {
      globalScene.phaseManager.queueMessage(msg);
    }
  }

  /**
   * Sub-method of {@linkcode applyMove} that handles the event of a target fainting.
   * @param user - The {@linkcode Pokemon} using this phase's invoked move
   * @param target - The {@linkcode Pokemon} that fainted
   */
  protected onFaintTarget(user: Pokemon, target: Pokemon): void {
    // Co-op host turn recorder (#633, animation-replay redesign - Step 2): the `faint` event is now
    // recorded at the UNIVERSAL damage chokepoint (Pokemon.damage, where the hit that drops a mon to 0
    // emits it), so a KO from ANY source animates on the guest - not only a direct move hit. This
    // move-only recorder is removed; `damage()` already emitted the faint before this runs.

    globalScene.phaseManager.queueFaintPhase(target.getBattlerIndex(), false, user);

    target.destroySubstitute();
    target.lapseTag(BattlerTagType.COMMANDED);

    // Force `lastHit` to be true if this is a multi hit move with hits left
    // `hitsLeft` must be left as-is in order for the message displaying the number of hits
    // to display the proper number.
    // Note: When Dragon Darts' smart targeting is implemented, this logic may need to be adjusted.
    if (!this.lastHit && user.turnData.hitsLeft > 1) {
      this.lastHit = true;
    }
  }

  /**
   * Sub-method of {@linkcode applyMoveEffects} that applies all effects aimed at the move's target.
   * To be used when the target is successfully and directly hit by the move.
   * @param user - The {@linkcode Pokemon} using the move
   * @param target - The {@linkcode Pokemon} targeted by the move
   * @param firstTarget - `true` if the target is the first Pokemon hit by the attack
   * @param dmgTuple - A {@linkcode MoveDamageTuple} containing the results of damage application
   */
  protected applyOnTargetEffects(
    user: Pokemon,
    target: Pokemon,
    firstTarget: boolean,
    dmgTuple: MoveDamageTuple,
  ): void {
    const [hitResult, damage] = dmgTuple;
    /** Does {@linkcode hitResult} indicate that damage was dealt to the target? */
    const dealsDamage = [
      HitResult.EFFECTIVE,
      HitResult.SUPER_EFFECTIVE,
      HitResult.NOT_VERY_EFFECTIVE,
      HitResult.ONE_HIT_KO,
    ].includes(hitResult);

    this.triggerMoveEffects(MoveEffectTrigger.POST_APPLY, user, target, firstTarget, false);
    this.applyHeldItemFlinchCheck(user, target, dealsDamage);
    this.applyOnGetHitAbEffects(user, target, dmgTuple);
    applyAbAttrs("PostAttackAbAttr", { pokemon: user, opponent: target, move: this.move, hitResult, damage });

    // ER Batch 3 same-turn "linked/aligned pair" effects (Rendezvous heal,
    // Synchronized Current paralysis, Closed Circuit extra hit) + turn-attack
    // ledger recording. Runs after PostAttack so second-actor triggers see the
    // first actor's already-recorded hit.
    if (this.move.is("AttackMove")) {
      erBatch3OnTargetHit(user, target, this.move, dealsDamage);
      erBatch4OnTargetHit(user, target, this.move, dealsDamage);
    }

    // We assume only enemy Pokemon are able to have the EnemyAttackStatusEffectChanceModifier from tokens
    if (!user.isPlayer() && this.move.is("AttackMove")) {
      globalScene.applyShuffledModifiers(EnemyAttackStatusEffectChanceModifier, false, target);
    }

    // Apply Grip Claw's chance to steal an item from the target
    if (this.move.is("AttackMove")) {
      globalScene.applyModifiers(ContactHeldItemTransferChanceModifier, this.player, user, target);
    }

    // ER community status items (#387): Chili Sample / Rusty Claw / Spiked
    // Knuckles / Copper Rod proc after a damaging hit, on BOTH sides (the
    // vanilla status-token path above is enemy-only).
    if (dealsDamage && this.move.is("AttackMove")) {
      const makesContact = this.move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user, target });
      erApplyCommunityOnHitItems(user, target, makesContact);
      // ER reactive held items (Cell Battery / Absorb Bulb / Snowball / Luminous
      // Moss / Weakness Policy): the struck holder raises a stat once, then it's
      // consumed.
      erApplyReactiveOnHit(target, user.getMoveType(this.move), hitResult, dealsDamage);
      // ER Air Balloon: a struck holder's balloon pops (not a switch, so it can
      // co-fire with an eject) - checked BEFORE the switch items.
      erPopAirBalloonOnHit(target, dealsDamage);
      // ER Sticky Barb: on a contact hit, the barb may latch onto the attacker.
      erTransferStickyBarbOnHit(user, target, makesContact, dealsDamage);
      // ER tactical switch items (Eject Button / Red Card): the surviving struck
      // holder switches out / drags the attacker out, then the item is consumed.
      // Last strike of a multi-hit move only.
      erApplyTacticalSwitchOnHit(user, target, dealsDamage);
    }

    // ER Throat Spray: a successful sound-based move raises the user's Sp. Atk
    // once (fired once per move, on the first resolved target).
    if (firstTarget) {
      erApplyThroatSprayOnUse(user, this.move);
    }
  }

  /**
   * Sub-method of {@linkcode applyOnTargetEffects} that applies reactive effects that occur when a Pokémon is hit.
   * (i.e. Effect Spore, Disguise, Liquid Ooze, Beak Blast)
   * @param user - The {@linkcode Pokemon} using this phase's invoked move
   * @param target - {@linkcode Pokemon} the current target of this phase's invoked move
   * @param hitResult - The {@linkcode HitResult} of the attempted move
   * @param damage - The amount of damage dealt by the attack
   * @param wasCritical - `true` if the move was a critical hit
   */
  protected applyOnGetHitAbEffects(
    user: Pokemon,
    target: Pokemon,
    [hitResult, damage, wasCritical]: MoveDamageTuple,
  ): void {
    const { move } = this;
    const params: PostMoveInteractionAbAttrParams = {
      pokemon: target,
      opponent: user,
      move,
      hitResult,
      damage,
    };
    applyAbAttrs("PostDefendAbAttr", params);

    if (wasCritical) {
      applyAbAttrs("PostReceiveCritStatStageChangeAbAttr", params);
    }
    target.lapseTags(BattlerTagLapseType.AFTER_HIT);
  }

  /**
   * Sub-method of {@linkcode applyOnTargetEffects} that handles checking for and applying flinches.
   * @param user - The {@linkcode Pokemon} using this phase's invoked move
   * @param target - {@linkcode Pokemon} the current target of this phase's invoked move
   * @param dealsDamage - `true` if the attempted move successfully dealt damage
   */
  protected applyHeldItemFlinchCheck(user: Pokemon, target: Pokemon, dealsDamage: boolean): void {
    if (this.move.hasAttr("FlinchAttr")) {
      return;
    }

    if (
      dealsDamage
      && !target.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr") // ER Covert Cloak: the held-item flinch (King's Rock class) is an // additional effect inflicted on the holder - the cloak blocks it, like // Shield Dust on the line above.
      && !erCovertCloakGuards(target)
      && !this.move.hitsSubstitute(user, target)
    ) {
      const flinched = new BooleanHolder(false);
      globalScene.applyModifiers(FlinchChanceModifier, user.isPlayer(), user, flinched);
      if (flinched.value) {
        target.addTag(BattlerTagType.FLINCHED, undefined, this.move.id, user.id);
      }
    }
  }

  public override end(): void {
    const user = this.getUserPokemon();

    /**
     * If this phase isn't for the invoked move's last strike (and we still have something to hit),
     * unshift another MoveEffectPhase for the next strike before ending this phase.
     */
    if (--user.turnData.hitsLeft >= 1 && this.getFirstTarget()) {
      this.addNextHitPhase();
      super.end();
      return;
    }

    /**
     * All hits of the move have resolved by now.
     * Queue message for multi-strike moves before applying Shell Bell heals.
     */
    const hitsTotal = user.turnData.hitCount - Math.max(user.turnData.hitsLeft, 0);
    if (hitsTotal > 1 || user.turnData.hitsLeft > 0) {
      // Queue message if multiple hits occurred or were slated to occur (such as a Triple Axel miss)
      globalScene.phaseManager.queueMessage(i18next.t("battle:attackHitsCount", { count: hitsTotal }));
    }

    globalScene.applyModifiers(HitHealModifier, this.player, user);
    this.getTargets().forEach(target => {
      target.turnData.moveEffectiveness = null;
    });
    super.end();
  }

  // #region Helpers

  /**
   * @returns The {@linkcode Pokemon} using this phase's invoked move.
   *
   * @remarks
   * The returned Pokémon is guaranteed to be defined during move execution itself, as the `start` method
   * ends this phase immediately if a source is missing.
   */
  // TODO: Delete in favor of using `getPokemon` from the inherited `PokemonPhase` class
  public getUserPokemon(): Pokemon {
    return super.getPokemon();
  }

  /**
   * @returns An array of {@linkcode Pokemon} that are:
   * - On-field and active
   * - Non-fainted
   * - Targeted by this phase's invoked move
   */
  public getTargets(): Pokemon[] {
    return globalScene.getField(true).filter(p => this.targets.indexOf(p.getBattlerIndex()) > -1);
  }

  /** @returns The first active, non-fainted target of this phase's invoked move. */
  public getFirstTarget(): Pokemon | undefined {
    return this.getTargets()[0];
  }

  /**
   * Remove the given {@linkcode Pokemon} from this phase's target list
   * @param target - The Pokémon to be removed
   */
  protected removeTarget(target: Pokemon): void {
    const targetIndex = this.targets.indexOf(target.getBattlerIndex());
    if (targetIndex !== -1) {
      this.targets.splice(targetIndex, 1);
    }
  }

  /**
   * Prevents subsequent strikes of this phase's invoked move from occurring
   * @param target - If defined, only stop subsequent strikes against this {@linkcode Pokemon}
   */
  public stopMultiHit(target?: Pokemon): void {
    // If given a specific target, remove the target from subsequent strikes
    if (target) {
      this.removeTarget(target);
    }
    const user = this.getUserPokemon();
    // If no target specified, or the specified target was the last of this move's
    // targets, completely cancel all subsequent strikes.
    if (!target || this.targets.length === 0) {
      user.turnData.hitCount = 1;
      user.turnData.hitsLeft = 1;
    }
  }

  /**
   * Unshifts a new `MoveEffectPhase` with the same properties as this phase.
   * Used to queue the next hit of multi-strike moves.
   */
  protected addNextHitPhase(): void {
    globalScene.phaseManager.unshiftNew("MoveEffectPhase", this.battlerIndex, this.targets, this.move, this.useMode);
  }

  /** Remove all substitutes that were broken by this phase's invoked move. */
  protected updateSubstitutes(): void {
    const targets = this.getTargets();
    for (const target of targets) {
      const substitute = target.getTag(SubstituteTag);
      if (!substitute || substitute.hp > 0) {
        continue;
      }
      target.removeTag(BattlerTagType.SUBSTITUTE);
    }
  }

  // # endregion Helpers
}

/**
 * Check whether a given Move is able to be reflected.
 * @see {@link https://bulbapedia.bulbagarden.net/wiki/Magic_Bounce_(Ability)}
 * @see {@link https://bulbapedia.bulbagarden.net/wiki/Magic_Coat_(move)}
 * @param move - The {@linkcode Move} being used
 * @param target - The targeted {@linkcode Pokemon} attempting to reflect the move
 * @param useMode - The {@linkcode MoveUseMode} dictating how the move was used
 * @returns Whether `target` can reflect `move`.
 * @remarks
 * To be reflectable, this requires that:
 * 1. `move` is both reflectable and was not just reflected
 * 2. `target` is not semi invulnerable
 * 3. `target` has a valid reflection effect active
 */
function isMoveReflectableBy(move: Move, target: Pokemon, useMode: MoveUseMode): boolean {
  return (
    !isReflected(useMode)
    && !target.getTag(SemiInvulnerableTag)
    && move.hasFlag(MoveFlags.REFLECTABLE)
    && (!!target.getTag(BattlerTagType.MAGIC_COAT) || target.hasAbilityWithAttr("ReflectStatusMoveAbAttr"))
  );
}
