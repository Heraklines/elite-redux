//! Current source-ordered pre-hit decisions and deferred defender effects.
//! Both whole turns and retained action chunks enter through execute_move.

use super::*;
use crate::current_defender_abilities::{AbsorbPlan, apply_absorb_heal, pre_hit_absorb};
use er_state::current_battle_source_events::{
    CurrentHitCheckV1, CurrentMoveUseModeV1, CurrentResolvedHitCheckV1,
};

pub(super) struct CurrentMoveContext<'a, 'owner> {
    pub content: &'a PreparedBattleContentV3,
    pub targeting: &'a CurrentTargetExecution<'owner>,
    pub definition: &'a MoveDefinitionV3,
    pub actor: &'a PokemonStateV5,
    pub source_slot: FieldSlot,
    pub source_events: Option<&'a mut Vec<CurrentBattleSourceEventV1>>,
    pub mechanics: &'a MechanicsContextV2<'a>,
}

enum HitCheck {
    Hit(PokemonId),
    Immune(AbsorbPlan),
    Miss,
}

pub(super) fn execute(
    run: &mut RunStateV3,
    input: CurrentMoveContext<'_, '_>,
    targets: Vec<FieldSlot>,
    rng: &mut RngRuntime,
    mutations: &mut Vec<BattleMutation>,
    presentation: &mut Vec<BattlePresentationCueV5>,
    mechanics_evidence: &mut Vec<MechanicsOperationEvidenceV2>,
) -> Result<ActionDisposition, BattleV5Error> {
    let mut source_events = input.source_events;
    if source_events.is_some() {
        // These actual initialized399d moves have MultiHitAttr. The current
        // executor has no source hit-count owner; never certify a fabricated
        // one-hit history. The historical None path remains unchanged.
        match input.definition.id.get().get() {
            61 | 64 | 331 | 458 | 497 | 541 => return Err(BattleV5Error::UnsupportedContent),
            _ => {}
        }
    }
    let status = matches!(input.definition.category, MoveCategory::Status)
        || matches!(input.definition.power, MovePower::None);
    let mut checks = Vec::with_capacity(targets.len());
    let mut resolved_checks = Vec::with_capacity(targets.len());
    // 399d MoveEffectPhase.conductHitChecks: every target's immunity/accuracy
    // decision precedes any target's critical/damage pass. Queued heals do not
    // change HP during this first pass, including the simulated query path.
    for slot in targets {
        let holder = occupant(run, slot).ok_or(BattleV5Error::Target)?;
        let target = pokemon(run, holder).ok_or(BattleV5Error::Target)?;
        if target.fainted || target.hp == 0 {
            if source_events.is_some() {
                return Err(BattleV5Error::Target);
            }
            continue;
        }
        let absorb = pre_hit_absorb(
            input.targeting,
            run,
            input.actor,
            target,
            input.definition,
            true,
        )
        .map_err(|_| BattleV5Error::UnsupportedContent)?;
        if let Some(plan) = absorb {
            let result = if plan.suppress_no_effect_message() {
                CurrentHitCheckV1::NoEffectNoMessage
            } else {
                CurrentHitCheckV1::NoEffect
            };
            resolved_checks.push(CurrentResolvedHitCheckV1 {
                target: holder,
                slot,
                result,
            });
            checks.push((slot, HitCheck::Immune(plan)));
        } else if status || accuracy_hits(input.content, input.mechanics, input.definition, rng)? {
            // Existing status-effect execution remains bounded separately. This
            // preserves its non-damage path; it does not claim full status parity.
            resolved_checks.push(CurrentResolvedHitCheckV1 {
                target: holder,
                slot,
                result: CurrentHitCheckV1::Hit,
            });
            checks.push((slot, HitCheck::Hit(holder)));
        } else {
            resolved_checks.push(CurrentResolvedHitCheckV1 {
                target: holder,
                slot,
                result: CurrentHitCheckV1::Miss,
            });
            checks.push((slot, HitCheck::Miss));
        }
    }
    if let Some(events) = source_events.as_deref_mut() {
        // Actual ordered first-pass decisions, before any damage hook. This
        // records the current execution; unrelated source modifiers remain
        // explicitly outside its qualified damage scope.
        events.push(CurrentBattleSourceEventV1::MoveResolution {
            user: input.actor.id,
            source_slot: input.source_slot,
            move_id: input.definition.id,
            use_mode: CurrentMoveUseModeV1::Direct,
            first_hit: true,
            targets: resolved_checks,
        });
    }

    let mut hit_any = false;
    let mut missed = false;
    let mut total_damage = 0_u64;
    let mut absorbed = Vec::new();
    let mut no_effect_messages = Vec::new();
    for (target_slot, check) in checks {
        match check {
            HitCheck::Miss => {
                missed = true;
            }
            HitCheck::Immune(plan) => {
                if !plan.suppress_no_effect_message() {
                    no_effect_messages.push(plan.holder);
                }
                absorbed.push(plan);
                // Source applies NoEffectAttr even when the message is cancelled.
                // Every currently admitted source row has an empty NoEffectAttr
                // list. New move IDs must explicitly qualify this continuation.
                no_effect_continuation(input.definition)?;
            }
            HitCheck::Hit(holder) => {
                if status {
                    hit_any = true;
                    continue;
                }
                let target = pokemon(run, holder).ok_or(BattleV5Error::Target)?.clone();
                if target.fainted || target.hp == 0 {
                    continue;
                }
                let critical = critical_hits(input.content, input.mechanics, rng)?;
                let calculated = calculate_damage_observed(
                    input.content,
                    input.mechanics,
                    input.definition,
                    input.actor,
                    &target,
                    DamagePolicy { critical, current_source: input.targeting.source_damage() },
                    rng,
                )?;
                let damage = calculated.damage;
                if damage == 0 {
                    continue;
                }
                let target = pokemon_mut(run, holder).ok_or(BattleV5Error::Target)?;
                let before = target.hp;
                target.hp = target.hp.saturating_sub(damage);
                target.fainted = target.hp == 0;
                let after = target.hp;
                mutations.push(BattleMutation::HpChanged {
                    pokemon: holder,
                    before,
                    after,
                });
                presentation.push(BattlePresentationCueV5::HpChanged {
                    pokemon: holder,
                    before,
                    after,
                });
                if target.fainted {
                    presentation.push(BattlePresentationCueV5::Fainted { pokemon: holder });
                }
                let damage_dealt = before - after;
                if let Some(events) = source_events.as_deref_mut() {
                    // In this current direct-hit path the clamped deduction is
                    // the actual damage-hook argument. It is retained here,
                    // not reconstructed from a later final-state HP delta.
                    events.push(CurrentBattleSourceEventV1::MoveDamage {
                        user: input.actor.id,
                        source_slot: input.source_slot,
                        target: holder,
                        target_slot,
                        move_id: input.definition.id,
                        use_mode: CurrentMoveUseModeV1::Direct,
                        damage: damage_dealt,
                        critical,
                        target_hp_before: before,
                        target_hp_after: after,
                        target_max_hp: target.max_hp,
                        super_effective: calculated.super_effective,
                        hit_count: 1,
                        hits_left: 1,
                    });
                }
                total_damage = total_damage
                    .checked_add(u64::from(damage_dealt))
                    .ok_or(BattleV5Error::Overflow)?;
                apply_move_drain_after_damage(
                    run,
                    MoveDamageHit {
                        actor: input.actor.id,
                        move_id: input.definition.id,
                        damage_dealt,
                    },
                    input.content,
                    Some(input.targeting),
                    mutations,
                    presentation,
                    mechanics_evidence,
                )?;
                hit_any = true;
            }
        }
    }
    if !status && hit_any {
        if input.definition.id.get().get() == 165 {
            // 399d RecoilAttr(true, 0.25, true): successful Struggle uses the
            // user's max HP, floors through toDmgValue and ignores recoil blocks.
            // Command admission proves the exact24-source recoil-neutral cohort.
            let actor = pokemon_mut(run, input.actor.id)
                .ok_or(BattleV5Error::InactiveActor(input.actor.id))?;
            if !actor.fainted {
                let before = actor.hp;
                let recoil = (actor.max_hp / 4).max(u32::from(total_damage > 0));
                actor.hp = actor.hp.saturating_sub(recoil);
                actor.fainted = actor.hp == 0;
                // The source achievement hook receives actual clamped damage
                // after damage(), before PostDamage callbacks and recoil text.
                if let Some(events) = source_events {
                    events.push(CurrentBattleSourceEventV1::StruggleRecoilDamage {
                        user: actor.id,
                        source_slot: input.source_slot,
                        move_id: input.definition.id,
                        requested_damage: recoil,
                        damage: before - actor.hp,
                        hp_before: before,
                        hp_after: actor.hp,
                        max_hp: actor.max_hp,
                    });
                }
                mutations.push(BattleMutation::HpChanged {
                    pokemon: actor.id,
                    before,
                    after: actor.hp,
                });
                presentation.push(BattlePresentationCueV5::HpChanged {
                    pokemon: actor.id,
                    before,
                    after: actor.hp,
                });
                // Source recoil text is a child before the deferred Faint phase.
                presentation.push(BattlePresentationCueV5::RecoilMessage { pokemon: actor.id });
                if actor.fainted {
                    presentation.push(BattlePresentationCueV5::Fainted { pokemon: actor.id });
                }
            }
        } else {
            apply_move_recoil_after_damage(
                run,
                input.actor.id,
                input.definition.id,
                total_damage,
                input.content,
                Some(input.targeting),
                mutations,
                presentation,
                mechanics_evidence,
            )?;
        }
        let after_hit = execute_hook_v2(input.content, input.mechanics, MechanicHookV2::AfterHit)
            .map_err(|error| BattleV5Error::Mechanics(error.to_string()))?;
        mechanics_evidence.extend(after_hit.operations);
    }
    // The actual source queued Show/Heal/Hide executes after MoveEffectPhase and
    // before MoveEnd/AfterMove. The request uses the pre-hit maximum; the live HP
    // clamp and holder membership are checked again here, without resurrection.
    for plan in absorbed {
        flush_absorb(run, input.targeting, &plan, mutations, presentation)?;
    }
    for holder in no_effect_messages {
        presentation.push(BattlePresentationCueV5::MoveNoEffect {
            pokemon: holder,
            move_id: input.definition.id,
        });
    }
    let after_move = execute_hook_v2(input.content, input.mechanics, MechanicHookV2::AfterMove)
        .map_err(|error| BattleV5Error::Mechanics(error.to_string()))?;
    mechanics_evidence.extend(after_move.operations);
    Ok(if hit_any {
        ActionDisposition::Executed
    } else if missed {
        ActionDisposition::Missed
    } else {
        ActionDisposition::NoEffect
    })
}

fn flush_absorb(
    run: &mut RunStateV3,
    targeting: &CurrentTargetExecution<'_>,
    plan: &AbsorbPlan,
    mutations: &mut Vec<BattleMutation>,
    presentation: &mut Vec<BattlePresentationCueV5>,
) -> Result<(), BattleV5Error> {
    let numeric_id = match &plan.source.source {
        BehaviorSourceId::ActiveAbility { numeric_id }
        | BehaviorSourceId::PassiveAbility { numeric_id } => *numeric_id,
        _ => return Err(BattleV5Error::UnsupportedContent),
    };
    let ability = er_types::battle_ids::AbilityId::new(numeric_id);
    presentation.push(BattlePresentationCueV5::AbilityShown {
        pokemon: plan.holder,
        ability,
        innate_slot: plan.source.innate_slot,
    });
    let target = pokemon(run, plan.holder).ok_or(BattleV5Error::Target)?;
    if let Some((before, after)) = apply_absorb_heal(targeting, run, target, plan)
        .map_err(|_| BattleV5Error::UnsupportedContent)?
    {
        let requested_heal = plan.heal_request.ok_or(BattleV5Error::UnsupportedContent)?;
        pokemon_mut(run, plan.holder)
            .ok_or(BattleV5Error::Target)?
            .hp = after;
        mutations.push(BattleMutation::HpChanged {
            pokemon: plan.holder,
            before,
            after,
        });
        presentation.push(BattlePresentationCueV5::AbilityHeal {
            pokemon: plan.holder,
            before,
            after,
            requested_heal,
        });
    }
    presentation.push(BattlePresentationCueV5::AbilityHidden {
        pokemon: plan.holder,
        ability,
        innate_slot: plan.source.innate_slot,
    });
    Ok(())
}

fn no_effect_continuation(definition: &MoveDefinitionV3) -> Result<(), BattleV5Error> {
    // Actual initialized399d catalog observed by the target prerequisite. This
    // explicit empty capability is not a generic ignore-unimplemented handler.
    match definition.id.get().get() {
        10 | 33 | 39 | 40 | 43 | 45 | 57 | 61 | 64 | 78 | 79 | 98 | 103 | 105 | 108 | 110 | 165
        | 230 | 310 | 331 | 336 | 448 | 458 | 497 | 501 | 541 | 580 => Ok(()),
        _ => Err(BattleV5Error::UnsupportedContent),
    }
}
