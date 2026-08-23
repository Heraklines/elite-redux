use er_content::pack::m5_pack::BattleContentPackV2;
use er_mechanics::{
    ActionOperationKind, FieldEffectOperationKind, HpOperationKind, ItemOperationKind,
    MechanicInstanceTemplate, MechanicOperation, MechanicStatePayload, PresentationCueKind,
    StageOperationKind, StatusOperationKind, SwitchOperationKind,
};
use er_rng::battle::RngRuntime;
use er_state::mechanic_state::{MechanicInstanceStateV1, MechanicStateStoreV1};
use er_state::migration_v3::GameStateV3;
use er_state::pokemon_v2::PokemonStateV2;
use er_types::SafeU53;
use er_types::battle_ids::{FieldSlot, PokemonId};
use er_types::battle_model::StatusKind;
use er_types::mechanics::{MechanicAddress, MechanicInstanceId, MechanicScope, MechanicsProgramId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::mechanics_condition::{
    ConditionEvaluationError, ConditionFacts, evaluate_condition_with_rng, evaluate_value,
};
use crate::mechanics_executor::{HookExecutionPlan, PlannedMechanicOperation};
use crate::mechanics_selector::{
    SelectorEvaluationError, SelectorFacts, evaluate_selector_with_rng,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MechanicMutationValue {
    None,
    Unsigned(u64),
    Signed(i64),
    Boolean(bool),
    Status(StatusKind),
    Scope(Option<MechanicScope>),
    Payload(MechanicStatePayload),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanicMutationEvidence {
    pub program_id: MechanicsProgramId,
    pub operation_ordinal: u16,
    pub target: Option<MechanicScope>,
    pub before: MechanicMutationValue,
    pub after: MechanicMutationValue,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanicPresentationCue {
    pub program_id: MechanicsProgramId,
    pub operation_ordinal: u16,
    pub cue: PresentationCueKind,
    pub subjects: Vec<MechanicScope>,
    pub detail_id: Option<SafeU53>,
}

#[derive(Clone, Debug)]
pub struct MechanicTransition {
    pub after_state: GameStateV3,
    pub rng_after: RngRuntime,
    pub mutations: Vec<MechanicMutationEvidence>,
    pub presentation: Vec<MechanicPresentationCue>,
}

pub fn execute_hook(
    pack: &BattleContentPackV2,
    plan: &HookExecutionPlan,
    state: &GameStateV3,
    condition_facts: &ConditionFacts,
    selector_facts: &SelectorFacts,
    rng: &RngRuntime,
) -> Result<MechanicTransition, MechanicMutationError> {
    let mut staged = state.clone();
    let mut staged_rng = rng.clone();
    let mut mutations = Vec::new();
    let mut presentation = Vec::new();
    for planned in &plan.operations {
        let program = program(pack, planned.program_id)?;
        let source = plan
            .sources
            .get(planned.source_index)
            .ok_or(MechanicMutationError::MissingSource)?;
        let mut local_facts = condition_facts.clone();
        local_facts.source = Some(source.source.clone());
        local_facts.scope = Some(source.scope);
        let matches = match planned.condition_root {
            Some(root) => {
                evaluate_condition_with_rng(program, root, &local_facts, &mut staged_rng)?
            }
            None => true,
        };
        if !matches {
            continue;
        }
        if let Some(root) = planned.selector_root
            && evaluate_selector_with_rng(program, root, selector_facts, &mut staged_rng)?
                .is_empty()
        {
            continue;
        }
        apply_operation(
            program,
            planned,
            source.scope,
            &source.source,
            source.source_ordinal,
            &mut staged,
            &local_facts,
            selector_facts,
            &mut staged_rng,
            &mut mutations,
            &mut presentation,
        )?;
    }
    staged.validate()?;
    Ok(MechanicTransition {
        after_state: staged,
        rng_after: staged_rng,
        mutations,
        presentation,
    })
}

#[allow(clippy::too_many_arguments)]
fn apply_operation(
    program: &er_mechanics::MechanicsProgramV1,
    planned: &PlannedMechanicOperation,
    source_scope: MechanicScope,
    source_id: &er_types::mechanics::MechanicSourceId,
    source_ordinal: er_types::mechanics::SourceOrdinal,
    state: &mut GameStateV3,
    facts: &ConditionFacts,
    selector_facts: &SelectorFacts,
    rng: &mut RngRuntime,
    evidence: &mut Vec<MechanicMutationEvidence>,
    presentation: &mut Vec<MechanicPresentationCue>,
) -> Result<(), MechanicMutationError> {
    match &planned.operation {
        MechanicOperation::Query { .. } => Err(MechanicMutationError::QueryInHookPlan),
        MechanicOperation::Hp {
            operation,
            targets,
            amount,
        } => {
            let targets = evaluate_selector_with_rng(program, *targets, selector_facts, rng)?;
            let amount = evaluate_value(program, *amount, facts)?;
            for target in targets {
                let pokemon = target_pokemon_mut(state, target)?;
                let before = pokemon.hp;
                pokemon.hp = hp_after(*operation, pokemon.hp, pokemon.max_hp, amount)?;
                pokemon.fainted = pokemon.hp == 0;
                record(
                    evidence,
                    planned,
                    Some(target),
                    MechanicMutationValue::Unsigned(u64::from(before)),
                    MechanicMutationValue::Unsigned(u64::from(pokemon.hp)),
                );
            }
            Ok(())
        }
        MechanicOperation::Pp {
            targets,
            move_slot,
            amount,
        } => {
            let targets = evaluate_selector_with_rng(program, *targets, selector_facts, rng)?;
            let amount = evaluate_value(program, *amount, facts)?;
            for target in targets {
                let pokemon = target_pokemon_mut(state, target)?;
                let slot = pokemon
                    .moves
                    .get_mut(usize::from(move_slot.get()))
                    .and_then(Option::as_mut)
                    .ok_or(MechanicMutationError::MissingMoveSlot)?;
                let before = slot.pp_used;
                let after = i64::from(before)
                    .checked_add(amount)
                    .and_then(|value| u16::try_from(value).ok())
                    .ok_or(MechanicMutationError::NumericRange)?;
                slot.pp_used = after;
                record(
                    evidence,
                    planned,
                    Some(target),
                    MechanicMutationValue::Unsigned(u64::from(before)),
                    MechanicMutationValue::Unsigned(u64::from(after)),
                );
            }
            Ok(())
        }
        MechanicOperation::Status {
            operation,
            targets,
            status_id,
            duration,
        } => {
            let targets = evaluate_selector_with_rng(program, *targets, selector_facts, rng)?;
            let duration = duration
                .map(|value| evaluate_value(program, value, facts))
                .transpose()?;
            for target in targets {
                let pokemon = target_pokemon_mut(state, target)?;
                let before = pokemon.status.kind;
                apply_status(*operation, pokemon, *status_id, duration)?;
                record(
                    evidence,
                    planned,
                    Some(target),
                    MechanicMutationValue::Status(before),
                    MechanicMutationValue::Status(pokemon.status.kind),
                );
            }
            Ok(())
        }
        MechanicOperation::StatStage {
            operation,
            targets,
            stat_id,
            stages,
        } => {
            let targets = evaluate_selector_with_rng(program, *targets, selector_facts, rng)?;
            let stages = evaluate_value(program, *stages, facts)?;
            for target in targets {
                let pokemon = target_pokemon_mut(state, target)?;
                let stat = stage_mut(pokemon, *stat_id)?;
                let before = i64::from(*stat);
                *stat = stage_after(*operation, *stat, stages)?;
                record(
                    evidence,
                    planned,
                    Some(target),
                    MechanicMutationValue::Signed(before),
                    MechanicMutationValue::Signed(i64::from(*stat)),
                );
            }
            Ok(())
        }
        MechanicOperation::CreateInstance { owners, template } => {
            let owners = evaluate_selector_with_rng(program, *owners, selector_facts, rng)?;
            for owner in owners {
                let instance =
                    create_instance(state, owner, source_id.clone(), source_ordinal, template)?;
                record(
                    evidence,
                    planned,
                    Some(owner),
                    MechanicMutationValue::None,
                    MechanicMutationValue::Payload(instance.payload),
                );
            }
            Ok(())
        }
        MechanicOperation::UpdateInstance { address, payload } => {
            let instance = find_instance_mut(state, address)?;
            let before = instance.payload.clone();
            instance.payload = payload.clone();
            record(
                evidence,
                planned,
                Some(address.scope),
                MechanicMutationValue::Payload(before),
                MechanicMutationValue::Payload(payload.clone()),
            );
            Ok(())
        }
        MechanicOperation::RemoveInstance { address } => {
            let removed = remove_instance(state, address)?;
            record(
                evidence,
                planned,
                Some(address.scope),
                MechanicMutationValue::Payload(removed.payload),
                MechanicMutationValue::None,
            );
            Ok(())
        }
        MechanicOperation::FieldEffect {
            operation,
            targets,
            effect_id,
            duration,
            ..
        } => {
            let targets = evaluate_selector_with_rng(program, *targets, selector_facts, rng)?;
            match operation {
                FieldEffectOperationKind::Apply | FieldEffectOperationKind::Refresh => {
                    let remaining_turns = duration
                        .map(|value| evaluate_value(program, value, facts))
                        .transpose()?
                        .map(|value| {
                            u16::try_from(value).map_err(|_| MechanicMutationError::NumericRange)
                        })
                        .transpose()?;
                    let template = MechanicInstanceTemplate {
                        program_id: planned.program_id,
                        remaining_turns,
                        counters: Vec::new(),
                        payload: MechanicStatePayload::StoredId { value: *effect_id },
                    };
                    for owner in targets {
                        let instance = create_instance(
                            state,
                            owner,
                            source_id.clone(),
                            source_ordinal,
                            &template,
                        )?;
                        record(
                            evidence,
                            planned,
                            Some(owner),
                            MechanicMutationValue::None,
                            MechanicMutationValue::Payload(instance.payload),
                        );
                    }
                    Ok(())
                }
                _ => Err(MechanicMutationError::UnsupportedOperation),
            }
        }
        MechanicOperation::Item {
            operation,
            targets,
            item_id,
        } => apply_item(
            program,
            *operation,
            *item_id,
            planned,
            state,
            *targets,
            selector_facts,
            rng,
            evidence,
        ),
        MechanicOperation::Switch {
            operation,
            actors,
            field_slot,
            ..
        } => apply_switch(
            program,
            *operation,
            *actors,
            *field_slot,
            planned,
            state,
            selector_facts,
            rng,
            evidence,
        ),
        MechanicOperation::Action { operation, .. } => match operation {
            ActionOperationKind::Cancel
            | ActionOperationKind::Flinch
            | ActionOperationKind::AdditionalHit
            | ActionOperationKind::RetryMove
            | ActionOperationKind::QueueClosedMove
            | ActionOperationKind::DisableMove
            | ActionOperationKind::LockMove
            | ActionOperationKind::ClearMoveLock => {
                record(
                    evidence,
                    planned,
                    Some(source_scope),
                    MechanicMutationValue::None,
                    MechanicMutationValue::Boolean(true),
                );
                Ok(())
            }
        },
        MechanicOperation::Presentation {
            cue,
            subjects,
            detail_id,
        } => {
            let subjects = evaluate_selector_with_rng(program, *subjects, selector_facts, rng)?;
            presentation.push(MechanicPresentationCue {
                program_id: planned.program_id,
                operation_ordinal: planned.operation_ordinal,
                cue: *cue,
                subjects,
                detail_id: *detail_id,
            });
            Ok(())
        }
    }
}

fn hp_after(
    operation: HpOperationKind,
    hp: u32,
    max_hp: u32,
    amount: i64,
) -> Result<u32, MechanicMutationError> {
    let amount = u32::try_from(amount).map_err(|_| MechanicMutationError::NumericRange)?;
    Ok(match operation {
        HpOperationKind::Damage
        | HpOperationKind::IndirectDamage
        | HpOperationKind::RecoilFromDamage => hp.checked_sub(amount).unwrap_or(0),
        HpOperationKind::Heal | HpOperationKind::DrainFromDamage => {
            u32::try_from(u64::from(hp) + u64::from(amount))
                .unwrap_or(u32::MAX)
                .min(max_hp)
        }
        HpOperationKind::Set => amount.min(max_hp),
    })
}

fn status_kind(id: SafeU53) -> Result<StatusKind, MechanicMutationError> {
    match id.get() {
        0 => Ok(StatusKind::None),
        1 => Ok(StatusKind::Poison),
        2 => Ok(StatusKind::Toxic),
        3 => Ok(StatusKind::Paralysis),
        4 => Ok(StatusKind::Sleep),
        6 => Ok(StatusKind::Burn),
        _ => Err(MechanicMutationError::UnsupportedStatus { id }),
    }
}

fn apply_status(
    operation: StatusOperationKind,
    pokemon: &mut PokemonStateV2,
    status_id: SafeU53,
    duration: Option<i64>,
) -> Result<(), MechanicMutationError> {
    match operation {
        StatusOperationKind::Apply | StatusOperationKind::Replace => {
            pokemon.status.kind = status_kind(status_id)?;
            pokemon.status.toxic_turn_count = 0;
            pokemon.status.sleep_turns_remaining = duration
                .map(|value| u16::try_from(value).map_err(|_| MechanicMutationError::NumericRange))
                .transpose()?;
        }
        StatusOperationKind::Cure => {
            pokemon.status.kind = StatusKind::None;
            pokemon.status.toxic_turn_count = 0;
            pokemon.status.sleep_turns_remaining = None;
        }
        StatusOperationKind::IncrementToxicCounter => {
            pokemon.status.toxic_turn_count = pokemon
                .status
                .toxic_turn_count
                .checked_add(1)
                .ok_or(MechanicMutationError::NumericRange)?;
        }
        StatusOperationKind::DecrementSleepCounter => {
            pokemon.status.sleep_turns_remaining = pokemon
                .status
                .sleep_turns_remaining
                .and_then(|value| value.checked_sub(1));
        }
    }
    Ok(())
}

fn stage_mut(pokemon: &mut PokemonStateV2, stat_id: u8) -> Result<&mut i8, MechanicMutationError> {
    match stat_id {
        0 => Ok(&mut pokemon.stat_stages.attack),
        1 => Ok(&mut pokemon.stat_stages.defense),
        2 => Ok(&mut pokemon.stat_stages.special_attack),
        3 => Ok(&mut pokemon.stat_stages.special_defense),
        4 => Ok(&mut pokemon.stat_stages.speed),
        5 => Ok(&mut pokemon.stat_stages.accuracy),
        6 => Ok(&mut pokemon.stat_stages.evasion),
        _ => Err(MechanicMutationError::UnsupportedStat { stat_id }),
    }
}

fn stage_after(
    operation: StageOperationKind,
    current: i8,
    value: i64,
) -> Result<i8, MechanicMutationError> {
    let value = i8::try_from(value).map_err(|_| MechanicMutationError::NumericRange)?;
    let result = match operation {
        StageOperationKind::Add => current
            .checked_add(value)
            .ok_or(MechanicMutationError::NumericRange)?,
        StageOperationKind::Set => value,
        StageOperationKind::Reset => 0,
        StageOperationKind::Copy => value,
        StageOperationKind::Invert => current
            .checked_neg()
            .ok_or(MechanicMutationError::NumericRange)?,
    };
    Ok(result.clamp(-6, 6))
}

fn target_pokemon_mut(
    state: &mut GameStateV3,
    scope: MechanicScope,
) -> Result<&mut PokemonStateV2, MechanicMutationError> {
    let MechanicScope::Pokemon { pokemon } = scope else {
        return Err(MechanicMutationError::PokemonScopeRequired);
    };
    if let Some(index) = state
        .base
        .player_party
        .iter()
        .position(|entry| entry.id == pokemon)
    {
        return Ok(&mut state.base.player_party[index]);
    }
    state
        .base
        .battle
        .as_mut()
        .and_then(|battle| {
            battle
                .enemy_party
                .iter_mut()
                .find(|entry| entry.id == pokemon)
        })
        .ok_or(MechanicMutationError::UnknownPokemon { pokemon })
}

fn store_mut(
    state: &mut GameStateV3,
    scope: MechanicScope,
) -> Result<&mut MechanicStateStoreV1, MechanicMutationError> {
    if let MechanicScope::Pokemon { pokemon } = scope {
        return state
            .pokemon_extensions
            .iter_mut()
            .find(|entry| entry.pokemon_id == pokemon)
            .map(|entry| &mut entry.mechanics)
            .ok_or(MechanicMutationError::UnknownPokemon { pokemon });
    }
    state
        .battle_extension
        .as_mut()
        .map(|entry| &mut entry.mechanics)
        .ok_or(MechanicMutationError::BattleScopeUnavailable)
}

fn create_instance(
    state: &mut GameStateV3,
    owner: MechanicScope,
    source: er_types::mechanics::MechanicSourceId,
    source_ordinal: er_types::mechanics::SourceOrdinal,
    template: &MechanicInstanceTemplate,
) -> Result<MechanicInstanceStateV1, MechanicMutationError> {
    let store = store_mut(state, owner)?;
    let instance_id = store.next_instance_id;
    let creation_ordinal = store.next_creation_ordinal;
    let next_id = instance_id
        .get()
        .get()
        .checked_add(1)
        .ok_or(MechanicMutationError::NumericRange)?;
    let next_creation = creation_ordinal
        .get()
        .checked_add(1)
        .ok_or(MechanicMutationError::NumericRange)?;
    store.next_instance_id = MechanicInstanceId::new(
        SafeU53::new(next_id).map_err(|_| MechanicMutationError::NumericRange)?,
    );
    store.next_creation_ordinal =
        SafeU53::new(next_creation).map_err(|_| MechanicMutationError::NumericRange)?;
    let instance = MechanicInstanceStateV1 {
        address: MechanicAddress {
            scope: owner,
            source,
            source_ordinal,
            instance_id,
        },
        program_id: template.program_id,
        owner,
        stored_target: None,
        creation_ordinal,
        remaining_turns: template.remaining_turns,
        counters: template.counters.clone(),
        payload: template.payload.clone(),
    };
    instance
        .validate()
        .map_err(|error| MechanicMutationError::InvalidMechanicState(error.to_string()))?;
    store.instances.push(instance.clone());
    store
        .instances
        .sort_by(|left, right| left.address.cmp(&right.address));
    Ok(instance)
}

fn find_instance_mut<'a>(
    state: &'a mut GameStateV3,
    address: &MechanicAddress,
) -> Result<&'a mut MechanicInstanceStateV1, MechanicMutationError> {
    store_mut(state, address.scope)?
        .instances
        .iter_mut()
        .find(|entry| entry.address == *address)
        .ok_or(MechanicMutationError::MissingInstance)
}

fn remove_instance(
    state: &mut GameStateV3,
    address: &MechanicAddress,
) -> Result<MechanicInstanceStateV1, MechanicMutationError> {
    let store = store_mut(state, address.scope)?;
    let index = store
        .instances
        .iter()
        .position(|entry| entry.address == *address)
        .ok_or(MechanicMutationError::MissingInstance)?;
    Ok(store.instances.remove(index))
}

#[allow(clippy::too_many_arguments)]
fn apply_item(
    program: &er_mechanics::MechanicsProgramV1,
    operation: ItemOperationKind,
    item_id: SafeU53,
    planned: &PlannedMechanicOperation,
    state: &mut GameStateV3,
    targets: er_mechanics::SelectorNodeId,
    selector_facts: &SelectorFacts,
    rng: &mut RngRuntime,
    evidence: &mut Vec<MechanicMutationEvidence>,
) -> Result<(), MechanicMutationError> {
    let targets = evaluate_selector_with_rng(program, targets, selector_facts, rng)?;
    if operation == ItemOperationKind::Transfer {
        if targets.len() != 2 {
            return Err(MechanicMutationError::TargetCardinality);
        }
        let from = pokemon_id(targets[0])?;
        let to = pokemon_id(targets[1])?;
        let from_index = extension_index(state, from)?;
        let item_index = state.pokemon_extensions[from_index]
            .held_items
            .iter()
            .position(|item| item.item_id == item_id)
            .ok_or(MechanicMutationError::MissingHeldItem)?;
        let item = state.pokemon_extensions[from_index]
            .held_items
            .remove(item_index);
        let to_index = extension_index(state, to)?;
        state.pokemon_extensions[to_index].held_items.push(item);
        state.pokemon_extensions[to_index]
            .held_items
            .sort_by(|left, right| left.registry_key.cmp(&right.registry_key));
        record(
            evidence,
            planned,
            Some(targets[0]),
            MechanicMutationValue::Scope(Some(targets[0])),
            MechanicMutationValue::Scope(Some(targets[1])),
        );
        return Ok(());
    }
    for target in targets {
        let pokemon = pokemon_id(target)?;
        let extension_index = extension_index(state, pokemon)?;
        let extension = &mut state.pokemon_extensions[extension_index];
        let index = extension
            .held_items
            .iter()
            .position(|item| item.item_id == item_id)
            .ok_or(MechanicMutationError::MissingHeldItem)?;
        let before = extension.held_items[index].consumed;
        match operation {
            ItemOperationKind::Consume | ItemOperationKind::MarkUsed => {
                let item = &mut extension.held_items[index];
                if operation == ItemOperationKind::Consume && item.charges > 0 {
                    item.charges -= 1;
                }
                item.consumed = true;
            }
            ItemOperationKind::Remove => {
                extension.held_items.remove(index);
            }
            ItemOperationKind::Restore | ItemOperationKind::ClearUsed => {
                extension.held_items[index].consumed = false;
            }
            ItemOperationKind::Transfer => return Err(MechanicMutationError::TargetCardinality),
        }
        let after = extension
            .held_items
            .get(index)
            .is_some_and(|item| item.consumed);
        record(
            evidence,
            planned,
            Some(target),
            MechanicMutationValue::Boolean(before),
            MechanicMutationValue::Boolean(after),
        );
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn apply_switch(
    program: &er_mechanics::MechanicsProgramV1,
    _operation: SwitchOperationKind,
    actors: er_mechanics::SelectorNodeId,
    field_slot: Option<FieldSlot>,
    planned: &PlannedMechanicOperation,
    state: &mut GameStateV3,
    selector_facts: &SelectorFacts,
    rng: &mut RngRuntime,
    evidence: &mut Vec<MechanicMutationEvidence>,
) -> Result<(), MechanicMutationError> {
    let actors = evaluate_selector_with_rng(program, actors, selector_facts, rng)?;
    if actors.len() != 1 {
        return Err(MechanicMutationError::TargetCardinality);
    }
    let pokemon = pokemon_id(actors[0])?;
    let destination = field_slot.ok_or(MechanicMutationError::MissingFieldSlot)?;
    let battle = state
        .base
        .battle
        .as_mut()
        .ok_or(MechanicMutationError::BattleScopeUnavailable)?;
    let previous = battle
        .field
        .slots
        .iter()
        .find(|entry| entry.occupant == Some(pokemon))
        .map(|entry| entry.slot);
    for entry in &mut battle.field.slots {
        if entry.occupant == Some(pokemon) {
            entry.occupant = None;
        }
    }
    let target = battle
        .field
        .slots
        .iter_mut()
        .find(|entry| entry.slot == destination)
        .ok_or(MechanicMutationError::MissingFieldSlot)?;
    target.occupant = Some(pokemon);
    battle
        .field
        .validate_for_format(&battle.format)
        .map_err(|error| MechanicMutationError::InvalidMechanicState(error.to_string()))?;
    record(
        evidence,
        planned,
        Some(actors[0]),
        MechanicMutationValue::Scope(previous.map(|slot| MechanicScope::Field { slot })),
        MechanicMutationValue::Scope(Some(MechanicScope::Field { slot: destination })),
    );
    Ok(())
}

fn pokemon_id(scope: MechanicScope) -> Result<PokemonId, MechanicMutationError> {
    match scope {
        MechanicScope::Pokemon { pokemon } => Ok(pokemon),
        _ => Err(MechanicMutationError::PokemonScopeRequired),
    }
}

fn extension_index(
    state: &GameStateV3,
    pokemon: PokemonId,
) -> Result<usize, MechanicMutationError> {
    state
        .pokemon_extensions
        .iter()
        .position(|entry| entry.pokemon_id == pokemon)
        .ok_or(MechanicMutationError::UnknownPokemon { pokemon })
}

fn program(
    pack: &BattleContentPackV2,
    program_id: MechanicsProgramId,
) -> Result<&er_mechanics::MechanicsProgramV1, MechanicMutationError> {
    let index = usize::try_from(program_id.get().get())
        .map_err(|_| MechanicMutationError::MissingProgram { program_id })?;
    pack.programs
        .get(index)
        .and_then(Option::as_ref)
        .ok_or(MechanicMutationError::MissingProgram { program_id })
}

fn record(
    evidence: &mut Vec<MechanicMutationEvidence>,
    planned: &PlannedMechanicOperation,
    target: Option<MechanicScope>,
    before: MechanicMutationValue,
    after: MechanicMutationValue,
) {
    evidence.push(MechanicMutationEvidence {
        program_id: planned.program_id,
        operation_ordinal: planned.operation_ordinal,
        target,
        before,
        after,
    });
}

#[derive(Debug, Error)]
pub enum MechanicMutationError {
    #[error("mechanics plan references missing program {program_id}")]
    MissingProgram { program_id: MechanicsProgramId },
    #[error("mechanics plan references missing source")]
    MissingSource,
    #[error("hook plan contains a query operation")]
    QueryInHookPlan,
    #[error("mechanic operation requires a Pokemon scope")]
    PokemonScopeRequired,
    #[error("unknown Pokemon {pokemon}")]
    UnknownPokemon { pokemon: PokemonId },
    #[error("move slot is empty or missing")]
    MissingMoveSlot,
    #[error("mechanic selector returned an invalid target count")]
    TargetCardinality,
    #[error("held item is missing")]
    MissingHeldItem,
    #[error("field slot is required or absent")]
    MissingFieldSlot,
    #[error("numeric result is outside the canonical range")]
    NumericRange,
    #[error("unsupported status ID {id}")]
    UnsupportedStatus { id: SafeU53 },
    #[error("unsupported stat ID {stat_id}")]
    UnsupportedStat { stat_id: u8 },
    #[error("battle-scoped mechanic store is unavailable")]
    BattleScopeUnavailable,
    #[error("mechanic instance is missing")]
    MissingInstance,
    #[error("mechanic state is invalid: {0}")]
    InvalidMechanicState(String),
    #[error("mechanic operation is not admitted by the executor")]
    UnsupportedOperation,
    #[error("candidate V3 state is invalid: {0}")]
    InvalidState(#[from] er_state::migration_v3::MigrationV3Error),
    #[error(transparent)]
    Condition(#[from] ConditionEvaluationError),
    #[error(transparent)]
    Selector(#[from] SelectorEvaluationError),
}
