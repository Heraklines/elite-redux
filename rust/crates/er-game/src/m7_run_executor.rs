//! Atomic execution of closed RunProgramV1 operations.

use std::sync::Arc;

use er_state::m7_state::{
    GameStateV5, InventoryEntryV1, RunModifierInstanceV2, RunStateV3,
    SCENARIO_RUNTIME_SCHEMA_VERSION_V1, ScenarioRuntimeStateV1, StoredPokemonV1,
};
use er_state::mechanic_state_v2::MechanicStateStoreV2;
use er_types::battle_ids::PokemonId;
use er_types::run_ids::Money;
use er_types::{
    GameControlKindV2, RunCondition, RunConditionId, RunHook, RunOperation, RunProgramId,
    RunProgramV1, RunSelector, RunSelectorId, RunValue, RunValueId, SafeU53, StorageSlotId,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::m7_content::PreparedGameContentV1;
use crate::m9e_content_v2::PreparedGameContentV2;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct RunExecutionContextV1 {
    pub pokemon: Option<PokemonId>,
    pub scenario_target: Option<PokemonId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunExecutionTransitionV1 {
    pub after_state: GameStateV5,
    pub evidence: Vec<RunOperationEvidenceV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunOperationEvidenceV1 {
    pub program: er_types::RunProgramId,
    pub source: er_types::GameBehaviorUnitId,
    pub hook: RunHook,
    pub operation_ordinal: u32,
    pub operation: RunOperation,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum RunExecutionError {
    #[error("game state is invalid: {0}")]
    State(String),
    #[error("run program {0} does not exist")]
    UnknownProgram(RunProgramId),
    #[error("run program condition, selector, value, or operation reference is invalid")]
    Reference,
    #[error("run operation cannot apply to the current state")]
    Operation,
    #[error("run operation numeric calculation overflowed")]
    Overflow,
    #[error("run operation was not rejected during content preparation")]
    UnreachableOperation,
}

pub trait RunExecutionContentV1 {
    fn run_programs(&self) -> &[RunProgramV1];
    fn run_program(&self, id: RunProgramId) -> Option<&RunProgramV1>;
    fn scenario_entry(&self, id: er_types::ScenarioId) -> Option<er_types::ScenarioNodeId>;
}

impl RunExecutionContentV1 for PreparedGameContentV1 {
    fn run_programs(&self) -> &[RunProgramV1] {
        &self.run.pack().programs
    }

    fn run_program(&self, id: RunProgramId) -> Option<&RunProgramV1> {
        self.run.program(id)
    }

    fn scenario_entry(&self, id: er_types::ScenarioId) -> Option<er_types::ScenarioNodeId> {
        self.scenarios.graph(id).map(|graph| graph.entry)
    }
}

impl RunExecutionContentV1 for PreparedGameContentV2 {
    fn run_programs(&self) -> &[RunProgramV1] {
        &self.run.pack().programs
    }

    fn run_program(&self, id: RunProgramId) -> Option<&RunProgramV1> {
        self.run.program(id)
    }

    fn scenario_entry(&self, id: er_types::ScenarioId) -> Option<er_types::ScenarioNodeId> {
        self.scenarios.scenario(id).map(|scenario| scenario.entry)
    }
}

impl<T: RunExecutionContentV1> RunExecutionContentV1 for Arc<T> {
    fn run_programs(&self) -> &[RunProgramV1] {
        self.as_ref().run_programs()
    }

    fn run_program(&self, id: RunProgramId) -> Option<&RunProgramV1> {
        self.as_ref().run_program(id)
    }

    fn scenario_entry(&self, id: er_types::ScenarioId) -> Option<er_types::ScenarioNodeId> {
        self.as_ref().scenario_entry(id)
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct RunOperationDispatcherV1;

impl RunOperationDispatcherV1 {
    fn execute<C: RunExecutionContentV1>(
        program: &RunProgramV1,
        operation: &RunOperation,
        state: &mut GameStateV5,
        context: &RunExecutionContextV1,
        content: &C,
    ) -> Result<(), RunExecutionError> {
        dispatch_operation(program, operation, state, context, content)
    }
}

pub fn execute_run_hook_v1<C: RunExecutionContentV1>(
    before: &GameStateV5,
    content: &C,
    hook: RunHook,
    context: RunExecutionContextV1,
) -> Result<RunExecutionTransitionV1, RunExecutionError> {
    before
        .validate()
        .map_err(|error| RunExecutionError::State(error.to_string()))?;
    let mut after = before.clone();
    let mut evidence = Vec::new();
    for program in content.run_programs() {
        execute_program_bindings(program, hook, &context, content, &mut after, &mut evidence)?;
    }
    finish_transition(after, evidence)
}

/// Executes one content-selected program through the same closed IR interpreter as global hooks.
///
/// Menus bind an option to a numeric `RunProgramId`; adapters only deliver raw input and never
/// interpret the selected program.
pub fn execute_run_program_hook_v1<C: RunExecutionContentV1>(
    before: &GameStateV5,
    content: &C,
    program_id: RunProgramId,
    hook: RunHook,
    context: RunExecutionContextV1,
) -> Result<RunExecutionTransitionV1, RunExecutionError> {
    before
        .validate()
        .map_err(|error| RunExecutionError::State(error.to_string()))?;
    let program = content
        .run_program(program_id)
        .ok_or(RunExecutionError::UnknownProgram(program_id))?;
    let mut after = before.clone();
    let mut evidence = Vec::new();
    execute_program_bindings(program, hook, &context, content, &mut after, &mut evidence)?;
    finish_transition(after, evidence)
}

fn execute_program_bindings<C: RunExecutionContentV1>(
    program: &RunProgramV1,
    hook: RunHook,
    context: &RunExecutionContextV1,
    content: &C,
    after: &mut GameStateV5,
    evidence: &mut Vec<RunOperationEvidenceV1>,
) -> Result<(), RunExecutionError> {
    for binding in program.hooks.iter().filter(|binding| binding.hook == hook) {
        if !evaluate_condition(program, binding.condition, after, context)? {
            continue;
        }
        let start = binding.first_operation as usize;
        let end = binding
            .first_operation
            .checked_add(binding.operation_count)
            .map(|value| value as usize)
            .ok_or(RunExecutionError::Reference)?;
        let operations = program
            .operations
            .get(start..end)
            .ok_or(RunExecutionError::Reference)?;
        for (offset, operation) in operations.iter().enumerate() {
            RunOperationDispatcherV1::execute(program, operation, after, context, content)?;
            evidence.push(RunOperationEvidenceV1 {
                program: program.id,
                source: program.source.clone(),
                hook,
                operation_ordinal: u32::try_from(start + offset)
                    .map_err(|_| RunExecutionError::Overflow)?,
                operation: operation.clone(),
            });
        }
    }
    Ok(())
}

fn finish_transition(
    after: GameStateV5,
    evidence: Vec<RunOperationEvidenceV1>,
) -> Result<RunExecutionTransitionV1, RunExecutionError> {
    after
        .validate()
        .map_err(|error| RunExecutionError::State(error.to_string()))?;
    Ok(RunExecutionTransitionV1 {
        after_state: after,
        evidence,
    })
}

fn evaluate_condition(
    program: &RunProgramV1,
    id: RunConditionId,
    state: &GameStateV5,
    context: &RunExecutionContextV1,
) -> Result<bool, RunExecutionError> {
    let condition = program
        .conditions
        .get(id.0 as usize)
        .ok_or(RunExecutionError::Reference)?;
    let run = state.active_run.as_ref();
    match condition {
        RunCondition::Always => Ok(true),
        RunCondition::Never => Ok(false),
        RunCondition::Not(inner) => Ok(!evaluate_condition(program, *inner, state, context)?),
        RunCondition::All(values) => values.iter().try_fold(true, |result, value| {
            Ok(result && evaluate_condition(program, *value, state, context)?)
        }),
        RunCondition::Any(values) => values.iter().try_fold(false, |result, value| {
            Ok(result || evaluate_condition(program, *value, state, context)?)
        }),
        RunCondition::RunFlag(flag) => Ok(run
            .and_then(|run| run.flags.get(flag))
            .copied()
            .unwrap_or(false)),
        RunCondition::ProfileFlag(flag) => {
            Ok(state.profile.flags.get(flag).copied().unwrap_or(false))
        }
        RunCondition::MoneyAtLeast(value) => {
            let required = unsigned_value(program, *value)?;
            Ok(run.is_some_and(|run| run.money.get().get() >= required))
        }
        RunCondition::WaveAtLeast(value) => {
            let required = unsigned_value(program, *value)?;
            Ok(run.is_some_and(|run| run.wave.get().get() >= required))
        }
        RunCondition::PartyContainsSpecies(species) => Ok(run.is_some_and(|run| {
            run.party
                .iter()
                .any(|pokemon| pokemon.species_id == *species)
        })),
        RunCondition::SelectorExists(selector) => {
            Ok(!select(program, *selector, state, context)?.is_empty())
        }
    }
}

fn dispatch_operation<C: RunExecutionContentV1>(
    program: &RunProgramV1,
    operation: &RunOperation,
    state: &mut GameStateV5,
    context: &RunExecutionContextV1,
    content: &C,
) -> Result<(), RunExecutionError> {
    match operation {
        RunOperation::AddMoney { amount } => {
            let amount = unsigned_value(program, *amount)?;
            let run = state
                .active_run
                .as_mut()
                .ok_or(RunExecutionError::Operation)?;
            run.money = Money::new(
                run.money
                    .get()
                    .get()
                    .checked_add(amount)
                    .and_then(|value| SafeU53::new(value).ok())
                    .ok_or(RunExecutionError::Overflow)?,
            );
        }
        RunOperation::RemoveMoney { amount } => {
            let amount = unsigned_value(program, *amount)?;
            let run = state
                .active_run
                .as_mut()
                .ok_or(RunExecutionError::Operation)?;
            let remaining = run
                .money
                .get()
                .get()
                .checked_sub(amount)
                .ok_or(RunExecutionError::Operation)?;
            run.money =
                Money::new(SafeU53::new(remaining).map_err(|_| RunExecutionError::Overflow)?);
        }
        RunOperation::AddModifier {
            registry_key,
            stacks,
            ..
        } => add_modifier(state, registry_key, *stacks)?,
        RunOperation::RemoveModifier {
            registry_key,
            stacks,
        } => remove_modifier(state, registry_key, *stacks)?,
        RunOperation::AddItem { item, count } => add_item(state, *item, *count)?,
        RunOperation::RemoveItem { item, count } => remove_item(state, *item, *count)?,
        RunOperation::SetRunFlag { flag, value } => {
            state
                .active_run
                .as_mut()
                .ok_or(RunExecutionError::Operation)?
                .flags
                .insert(*flag, *value);
        }
        RunOperation::SetProfileFlag { flag, value } => {
            state.profile.flags.insert(*flag, *value);
        }
        RunOperation::SetBiome { biome } => {
            state
                .active_run
                .as_mut()
                .ok_or(RunExecutionError::Operation)?
                .world
                .biome = *biome;
        }
        RunOperation::HealPokemon { target, amount } => {
            let pokemon = select(program, *target, state, context)?;
            let amount = u32::try_from(unsigned_value(program, *amount)?)
                .map_err(|_| RunExecutionError::Overflow)?;
            let run = state
                .active_run
                .as_mut()
                .ok_or(RunExecutionError::Operation)?;
            for id in pokemon {
                let target = persistent_pokemon_mut(run, id).ok_or(RunExecutionError::Operation)?;
                target.hp = target
                    .hp
                    .checked_add(amount)
                    .unwrap_or(target.max_hp)
                    .min(target.max_hp);
                target.fainted = target.hp == 0;
            }
        }
        RunOperation::SetLevel { target, level } => {
            if *level == 0 {
                return Err(RunExecutionError::Operation);
            }
            let pokemon = select(program, *target, state, context)?;
            let run = state
                .active_run
                .as_mut()
                .ok_or(RunExecutionError::Operation)?;
            for id in pokemon {
                persistent_pokemon_mut(run, id)
                    .ok_or(RunExecutionError::Operation)?
                    .level = *level;
            }
        }
        RunOperation::SendPokemonToStorage { target } => {
            let pokemon = select(program, *target, state, context)?;
            let run = state
                .active_run
                .as_mut()
                .ok_or(RunExecutionError::Operation)?;
            for id in pokemon {
                let index = run
                    .party
                    .iter()
                    .position(|candidate| candidate.id == id)
                    .ok_or(RunExecutionError::Operation)?;
                let stored = run.party.remove(index);
                let next_slot = run
                    .storage
                    .iter()
                    .map(|entry| entry.slot.get().get())
                    .max()
                    .map_or(0, |value| value.checked_add(1).unwrap_or(u64::MAX));
                let slot = StorageSlotId::new(
                    SafeU53::new(next_slot).map_err(|_| RunExecutionError::Overflow)?,
                );
                run.storage.push(StoredPokemonV1 {
                    slot,
                    pokemon: stored,
                });
                run.storage.sort_by_key(|entry| entry.slot);
            }
        }
        RunOperation::AdvanceQuest { quest, amount } => {
            let amount = unsigned_value(program, *amount)?;
            let run = state
                .active_run
                .as_mut()
                .ok_or(RunExecutionError::Operation)?;
            let previous = run
                .quests
                .progress
                .get(quest)
                .copied()
                .unwrap_or(SafeU53::ZERO);
            let next = previous
                .get()
                .checked_add(amount)
                .and_then(|value| SafeU53::new(value).ok())
                .ok_or(RunExecutionError::Overflow)?;
            run.quests.progress.insert(*quest, next);
        }
        RunOperation::ChangeFactionStanding { faction, amount } => {
            let amount = signed_value(program, *amount)?;
            let run = state
                .active_run
                .as_mut()
                .ok_or(RunExecutionError::Operation)?;
            let previous = run.factions.standing.get(faction).copied().unwrap_or(0);
            run.factions.standing.insert(
                *faction,
                previous
                    .checked_add(amount)
                    .ok_or(RunExecutionError::Overflow)?,
            );
        }
        RunOperation::OpenControl { control } => {
            let run = state
                .active_run
                .as_mut()
                .ok_or(RunExecutionError::Operation)?;
            run.control.kind = *control;
            run.control.actionable = false;
            run.control.action_context = None;
            run.control.menu = None;
        }
        RunOperation::OpenScenario { scenario } => {
            let entry = content
                .scenario_entry(*scenario)
                .ok_or(RunExecutionError::Operation)?;
            state
                .active_run
                .as_mut()
                .ok_or(RunExecutionError::Operation)?
                .scenario = Some(ScenarioRuntimeStateV1 {
                schema_version: SCENARIO_RUNTIME_SCHEMA_VERSION_V1,
                scenario: *scenario,
                node: entry,
                flags: Default::default(),
                visit_count: SafeU53::ZERO,
            });
        }
        RunOperation::CompleteScenario { scenario } => {
            let run = state
                .active_run
                .as_mut()
                .ok_or(RunExecutionError::Operation)?;
            if run.scenario.as_ref().map(|value| value.scenario) != Some(*scenario) {
                return Err(RunExecutionError::Operation);
            }
            run.scenario = None;
        }
        RunOperation::EnterTerminal { outcome } => {
            let run = state
                .active_run
                .as_mut()
                .ok_or(RunExecutionError::Operation)?;
            run.outcome = *outcome;
            run.control.kind = GameControlKindV2::Complete;
            run.control.actionable = false;
            run.control.action_context = None;
            run.control.menu = None;
        }
        RunOperation::EmitPresentation { .. }
        | RunOperation::GenerateEncounter { .. }
        | RunOperation::StartBattle { .. }
        | RunOperation::GrantExperience { .. }
        | RunOperation::RevivePokemon { .. }
        | RunOperation::ChangeStatus { .. }
        | RunOperation::AddMove { .. }
        | RunOperation::RemoveMove { .. }
        | RunOperation::ReplaceMove { .. }
        | RunOperation::ChangeAbility { .. }
        | RunOperation::ChangeNature { .. }
        | RunOperation::CapturePokemon { .. }
        | RunOperation::AddPokemonToParty { .. }
        | RunOperation::ReleasePokemon { .. }
        | RunOperation::EvolvePokemon { .. }
        | RunOperation::FusePokemon { .. }
        | RunOperation::UnfusePokemon { .. }
        | RunOperation::ChangePersistentForm { .. }
        | RunOperation::TransferItem { .. } => {
            let _ = context;
            return Err(RunExecutionError::UnreachableOperation);
        }
    }
    Ok(())
}

fn add_modifier(
    state: &mut GameStateV5,
    registry_key: &str,
    stacks: u16,
) -> Result<(), RunExecutionError> {
    let run = state
        .active_run
        .as_mut()
        .ok_or(RunExecutionError::Operation)?;
    if let Some(modifier) = run
        .modifiers
        .iter_mut()
        .find(|modifier| modifier.registry_key == registry_key)
    {
        modifier.stack_count = modifier
            .stack_count
            .checked_add(u32::from(stacks))
            .ok_or(RunExecutionError::Overflow)?;
        return Ok(());
    }
    let next = run
        .modifiers
        .last()
        .map_or(1, |modifier| modifier.id.get().get() + 1);
    let id = er_types::RunModifierInstanceId::new(
        SafeU53::new(next).map_err(|_| RunExecutionError::Overflow)?,
    );
    run.modifiers.push(RunModifierInstanceV2 {
        id,
        registry_key: registry_key.to_owned(),
        stack_count: u32::from(stacks),
        tier: 0,
        mechanics: MechanicStateStoreV2::default(),
    });
    run.modifiers.sort_by_key(|modifier| modifier.id);
    Ok(())
}

fn remove_modifier(
    state: &mut GameStateV5,
    registry_key: &str,
    stacks: u16,
) -> Result<(), RunExecutionError> {
    let run = state
        .active_run
        .as_mut()
        .ok_or(RunExecutionError::Operation)?;
    let index = run
        .modifiers
        .iter()
        .position(|modifier| modifier.registry_key == registry_key)
        .ok_or(RunExecutionError::Operation)?;
    if run.modifiers[index].stack_count < u32::from(stacks) {
        return Err(RunExecutionError::Operation);
    }
    run.modifiers[index].stack_count -= u32::from(stacks);
    if run.modifiers[index].stack_count == 0 {
        run.modifiers.remove(index);
    }
    Ok(())
}

fn add_item(
    state: &mut GameStateV5,
    item: er_types::InventoryItemId,
    count: u32,
) -> Result<(), RunExecutionError> {
    let run = state
        .active_run
        .as_mut()
        .ok_or(RunExecutionError::Operation)?;
    if let Some(entry) = run
        .inventory
        .entries
        .iter_mut()
        .find(|entry| entry.item == item)
    {
        entry.count = entry
            .count
            .checked_add(count)
            .ok_or(RunExecutionError::Overflow)?;
    } else {
        run.inventory.entries.push(InventoryEntryV1 {
            item,
            registry_key: format!("item/{}", item.get()),
            count,
        });
        run.inventory.entries.sort_by_key(|entry| entry.item);
    }
    Ok(())
}

fn remove_item(
    state: &mut GameStateV5,
    item: er_types::InventoryItemId,
    count: u32,
) -> Result<(), RunExecutionError> {
    let run = state
        .active_run
        .as_mut()
        .ok_or(RunExecutionError::Operation)?;
    let index = run
        .inventory
        .entries
        .iter()
        .position(|entry| entry.item == item)
        .ok_or(RunExecutionError::Operation)?;
    if run.inventory.entries[index].count < count {
        return Err(RunExecutionError::Operation);
    }
    run.inventory.entries[index].count -= count;
    if run.inventory.entries[index].count == 0 {
        run.inventory.entries.remove(index);
    }
    Ok(())
}

fn persistent_pokemon_mut(
    run: &mut RunStateV3,
    id: PokemonId,
) -> Option<&mut er_state::m7_state::PokemonStateV5> {
    if let Some(index) = run.party.iter().position(|pokemon| pokemon.id == id) {
        return run.party.get_mut(index);
    }
    run.storage
        .iter_mut()
        .find(|stored| stored.pokemon.id == id)
        .map(|stored| &mut stored.pokemon)
}

fn select(
    program: &RunProgramV1,
    id: RunSelectorId,
    state: &GameStateV5,
    context: &RunExecutionContextV1,
) -> Result<Vec<PokemonId>, RunExecutionError> {
    let selector = program
        .selectors
        .get(id.0 as usize)
        .ok_or(RunExecutionError::Reference)?;
    let run = state
        .active_run
        .as_ref()
        .ok_or(RunExecutionError::Operation)?;
    Ok(match selector {
        RunSelector::ActivePokemon => context.pokemon.into_iter().collect(),
        RunSelector::AllPartyPokemon => run.party.iter().map(|pokemon| pokemon.id).collect(),
        RunSelector::AllStoragePokemon => {
            run.storage.iter().map(|stored| stored.pokemon.id).collect()
        }
        RunSelector::Pokemon(id) => vec![*id],
        RunSelector::PartySlot(slot) => run
            .party
            .get(usize::from(slot.get()))
            .map(|pokemon| vec![pokemon.id])
            .unwrap_or_default(),
        RunSelector::CapturedPokemon | RunSelector::ScenarioTarget => {
            context.scenario_target.into_iter().collect()
        }
    })
}

fn unsigned_value(program: &RunProgramV1, id: RunValueId) -> Result<u64, RunExecutionError> {
    match program.values.get(id.0 as usize) {
        Some(RunValue::Unsigned(value)) => Ok(*value),
        Some(RunValue::Signed(value)) => {
            u64::try_from(*value).map_err(|_| RunExecutionError::Operation)
        }
        _ => Err(RunExecutionError::Reference),
    }
}

fn signed_value(program: &RunProgramV1, id: RunValueId) -> Result<i64, RunExecutionError> {
    match program.values.get(id.0 as usize) {
        Some(RunValue::Signed(value)) => Ok(*value),
        Some(RunValue::Unsigned(value)) => {
            i64::try_from(*value).map_err(|_| RunExecutionError::Overflow)
        }
        _ => Err(RunExecutionError::Reference),
    }
}
