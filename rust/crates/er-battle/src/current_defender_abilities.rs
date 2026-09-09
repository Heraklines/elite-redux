//! Current pre-hit Poison Absorb over the canonical current target owner.
//!
//! Source 399d dispatcher case344 / TypeAbsorbHealAbAttr: effective Poison
//! immunity, then a deferred quarter-max-HP heal for a wounded actual holder.
//! The existing FreshNormalClassic origin owns the ordinary global context;
//! represented unsupported healing/guard state is rejected, never neutralized.
//! The shared current resolver and immutable query use this same decision. Its
//! source observation is qualified separately from the Rust integration tests.

use er_content::pack::m6_pack::MoveDefinitionV3;
use er_state::m7_state::{PokemonStateV5, RunStateV3};
use er_types::BehaviorSourceId;
use er_types::battle_ids::PokemonId;
use er_types::battle_model::{MoveFlag, MoveTarget, PokemonType};
use thiserror::Error;

use crate::current_target_execution::CurrentTargetExecution;

pub(crate) const POISON_ABSORB: u64 = 5082;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DefenderAbilitySource {
    pub source: BehaviorSourceId,
    /// None is the active ability. Some(0..=2) is the actual admitted innate slot.
    pub innate_slot: Option<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AbsorbPlan {
    pub holder: PokemonId,
    pub source: DefenderAbilitySource,
    /// The source queues this request before hit checks return, but executes the
    /// actual heal after the move's hit effects. Full-HP admission queues nothing.
    pub heal_request: Option<u32>,
}

impl AbsorbPlan {
    pub(crate) fn suppress_no_effect_message(&self) -> bool {
        self.heal_request.is_some()
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("current defender effect lacks supported source ownership or healing state")]
pub(crate) struct CurrentDefenderAbilityError;

/// Read-only decision, also used by the current simulated damage query. Merely
/// querying this plan does not display the ability, apply HP or update a ledger.
/// Do not feed its sources into the attacker's offensive mechanics context.
pub(crate) fn pre_hit_absorb(
    owner: &CurrentTargetExecution<'_>,
    run: &RunStateV3,
    attacker: &PokemonStateV5,
    defender: &PokemonStateV5,
    definition: &MoveDefinitionV3,
) -> Result<Option<AbsorbPlan>, CurrentDefenderAbilityError> {
    // validate_run alone does not admit a move definition for the query path.
    // The shared source plan proves its closed ID/target catalog before any
    // defender predicate; it consumes no RNG and does not replace retained targets.
    owner
        .plan(run, attacker.id, definition)
        .map_err(|_| CurrentDefenderAbilityError)?;
    if attacker.id == defender.id
        || definition.move_type != PokemonType::Poison
        || matches!(
            definition.target,
            MoveTarget::UserSide | MoveTarget::EnemySide | MoveTarget::BothSides
        )
        || definition.flags.contains(&MoveFlag::IgnoreAbilities)
    {
        return Ok(None);
    }
    // TypeAbsorbHeal inherits TypeImmunityAbAttr.canApply, including the exact
    // attacker != holder condition (399d ab-attrs.ts:468-474). The source plan
    // above also rejects Struggle before its TypelessAttr could be coerced.
    let sources = owner
        .ability_sources_with_slots(run, defender)
        .map_err(|_| CurrentDefenderAbilityError)?;
    let Some((source, innate_slot)) = sources.into_iter().find(|(source, _)| {
        matches!(source,
            BehaviorSourceId::ActiveAbility { numeric_id }
            | BehaviorSourceId::PassiveAbility { numeric_id }
            if numeric_id.get() == POISON_ABSORB)
    }) else {
        return Ok(None);
    };
    if defender.fainted || defender.hp == 0 || defender.max_hp == 0 || defender.hp > defender.max_hp
    {
        return Err(CurrentDefenderAbilityError);
    }
    validate_ordinary_defender(defender)?;
    let battle = run.battle.as_ref().ok_or(CurrentDefenderAbilityError)?;
    if !battle
        .field
        .slots
        .iter()
        .any(|slot| slot.occupant == Some(defender.id))
    {
        return Err(CurrentDefenderAbilityError);
    }
    Ok(Some(AbsorbPlan {
        holder: defender.id,
        source: DefenderAbilitySource {
            source,
            innate_slot,
        },
        heal_request: (defender.hp < defender.max_hp).then(|| (defender.max_hp / 4).max(1)),
    }))
}

/// Recheck the actual holder at deferred application. This is deliberately not
/// `hp += max_hp / 4`: the request belongs to the pre-hit phase, while the clamp
/// belongs to the later actual heal. A caller applies this returned pair through
/// the existing transaction's HP mutation/cue seam, with its source ability cue.
pub(crate) fn apply_absorb_heal(
    owner: &CurrentTargetExecution<'_>,
    run: &RunStateV3,
    defender: &PokemonStateV5,
    plan: &AbsorbPlan,
) -> Result<Option<(u32, u32)>, CurrentDefenderAbilityError> {
    owner
        .validate_run(run)
        .map_err(|_| CurrentDefenderAbilityError)?;
    if plan.holder != defender.id {
        return Err(CurrentDefenderAbilityError);
    }
    let Some(request) = plan.heal_request else {
        return Ok(None);
    };
    validate_ordinary_defender(defender)?;
    let battle = run.battle.as_ref().ok_or(CurrentDefenderAbilityError)?;
    // PokemonHealPhase checks the live field/HP again and harmlessly declines a
    // heal after departure/faint. It does not resurrect or target another owner.
    if defender.fainted
        || defender.hp == 0
        || !battle
            .field
            .slots
            .iter()
            .any(|slot| slot.occupant == Some(defender.id))
    {
        return Ok(None);
    }
    let missing = defender
        .max_hp
        .checked_sub(defender.hp)
        .ok_or(CurrentDefenderAbilityError)?;
    let after = defender
        .hp
        .checked_add(request.min(missing))
        .ok_or(CurrentDefenderAbilityError)?;
    Ok((after != defender.hp).then_some((defender.hp, after)))
}

fn validate_ordinary_defender(
    defender: &PokemonStateV5,
) -> Result<(), CurrentDefenderAbilityError> {
    let state = &defender.mechanics;
    // HealBlock, Bleed, protect and other volatile behavior need their exact
    // source handlers before these represented states can be admitted here.
    // Allocation highwaters/history-only counters are not reset or rewritten.
    if !state.instances.is_empty()
        || !state.scheduled_events.is_empty()
        || state.guard_chain_depth != 0
        || state.action_lock_active
        || state.redirect_active
        || state.transform_overlay.active
        || state.transform_overlay.overlay_species.is_some()
        || state.transform_overlay.overlay_form_key.is_some()
    {
        return Err(CurrentDefenderAbilityError);
    }
    Ok(())
}
