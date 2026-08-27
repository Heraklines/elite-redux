//! Closed M7 run and progression program IR.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::battle_ids::{AbilityId, MoveId, PartyIndex, PokemonId, SpeciesId};
use crate::run_ids::{BiomeId, EncounterId};
use crate::{
    EvolutionId, FactionId, GameBehaviorUnitId, GameControlKindV2, InventoryItemId, ProfileFlagId,
    QuestId, RunFlagId, RunProgramId, ScenarioId,
};

pub const RUN_PROGRAM_SCHEMA_VERSION_V1: u32 = 1;

macro_rules! arena_id {
    ($name:ident) => {
        #[derive(
            Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(pub u32);
    };
}

arena_id!(RunConditionId);
arena_id!(RunSelectorId);
arena_id!(RunValueId);

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunHook {
    ProfileLoaded,
    RunStarted,
    WaveStarted,
    BattleStarted,
    BattleSettled,
    PokemonCaptured,
    PokemonJoinedParty,
    PokemonReleased,
    ExperienceGranted,
    LevelChanged,
    MoveLearned,
    EvolutionEligible,
    EvolutionCompleted,
    RewardGenerated,
    RewardSelected,
    ModifierAdded,
    ModifierRemoved,
    BiomeEntered,
    BiomeExited,
    ScenarioOpened,
    ScenarioChoiceCommitted,
    ScenarioCompleted,
    QuestAdvanced,
    FactionStandingChanged,
    RunWon,
    RunLost,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunHookBinding {
    pub hook: RunHook,
    pub condition: RunConditionId,
    pub first_operation: u32,
    pub operation_count: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum RunCondition {
    Always,
    Never,
    Not(RunConditionId),
    All(Vec<RunConditionId>),
    Any(Vec<RunConditionId>),
    RunFlag(RunFlagId),
    ProfileFlag(ProfileFlagId),
    MoneyAtLeast(RunValueId),
    WaveAtLeast(RunValueId),
    PartyContainsSpecies(SpeciesId),
    SelectorExists(RunSelectorId),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum RunSelector {
    ActivePokemon,
    AllPartyPokemon,
    AllStoragePokemon,
    Pokemon(PokemonId),
    PartySlot(PartyIndex),
    CapturedPokemon,
    ScenarioTarget,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum RunValue {
    Unsigned(u64),
    Signed(i64),
    Ratio { numerator: u32, denominator: u32 },
    RegistryKey(String),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum RunOperation {
    AddMoney {
        amount: RunValueId,
    },
    RemoveMoney {
        amount: RunValueId,
    },
    AddModifier {
        registry_key: String,
        target: Option<RunSelectorId>,
        stacks: u16,
    },
    RemoveModifier {
        registry_key: String,
        stacks: u16,
    },
    GrantExperience {
        target: RunSelectorId,
        amount: RunValueId,
    },
    SetLevel {
        target: RunSelectorId,
        level: u16,
    },
    HealPokemon {
        target: RunSelectorId,
        amount: RunValueId,
    },
    RevivePokemon {
        target: RunSelectorId,
        amount: RunValueId,
    },
    ChangeStatus {
        target: RunSelectorId,
        status: crate::battle_model::StatusKind,
    },
    AddMove {
        target: RunSelectorId,
        move_id: MoveId,
    },
    RemoveMove {
        target: RunSelectorId,
        slot: crate::battle_ids::MoveSlotIndex,
    },
    ReplaceMove {
        target: RunSelectorId,
        slot: crate::battle_ids::MoveSlotIndex,
        move_id: MoveId,
    },
    ChangeAbility {
        target: RunSelectorId,
        ability: AbilityId,
    },
    ChangeNature {
        target: RunSelectorId,
        nature: crate::run_ids::NatureId,
    },
    CapturePokemon {
        target: RunSelectorId,
        ball: InventoryItemId,
    },
    AddPokemonToParty {
        target: RunSelectorId,
    },
    SendPokemonToStorage {
        target: RunSelectorId,
    },
    ReleasePokemon {
        target: RunSelectorId,
    },
    EvolvePokemon {
        target: RunSelectorId,
        evolution: EvolutionId,
    },
    FusePokemon {
        target: RunSelectorId,
        partner: RunSelectorId,
    },
    UnfusePokemon {
        target: RunSelectorId,
    },
    ChangePersistentForm {
        target: RunSelectorId,
        form: u16,
    },
    AddItem {
        item: InventoryItemId,
        count: u32,
    },
    RemoveItem {
        item: InventoryItemId,
        count: u32,
    },
    TransferItem {
        item: InventoryItemId,
        source: RunSelectorId,
        target: RunSelectorId,
    },
    SetBiome {
        biome: BiomeId,
    },
    GenerateEncounter {
        encounter: EncounterId,
    },
    StartBattle {
        encounter: EncounterId,
    },
    SetRunFlag {
        flag: RunFlagId,
        value: bool,
    },
    SetProfileFlag {
        flag: ProfileFlagId,
        value: bool,
    },
    AdvanceQuest {
        quest: QuestId,
        amount: RunValueId,
    },
    ChangeFactionStanding {
        faction: FactionId,
        amount: RunValueId,
    },
    OpenControl {
        control: GameControlKindV2,
    },
    OpenScenario {
        scenario: ScenarioId,
    },
    CompleteScenario {
        scenario: ScenarioId,
    },
    EnterTerminal {
        outcome: crate::run_model::RunOutcome,
    },
    EmitPresentation {
        cue: String,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunProgramBudget {
    pub condition_nodes: u32,
    pub selector_nodes: u32,
    pub value_nodes: u32,
    pub operations: u32,
    pub emitted_presentations: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunProgramV1 {
    pub schema_version: u32,
    pub id: RunProgramId,
    pub source: GameBehaviorUnitId,
    pub hooks: Vec<RunHookBinding>,
    pub conditions: Vec<RunCondition>,
    pub selectors: Vec<RunSelector>,
    pub values: Vec<RunValue>,
    pub operations: Vec<RunOperation>,
    pub budget: RunProgramBudget,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum RunProgramError {
    #[error("RunProgramV1 schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("run program ID cannot be zero")]
    ZeroProgramId,
    #[error("declared budget differs from arena lengths")]
    BudgetMismatch,
    #[error("hook bindings must be sorted and unique")]
    HookOrder,
    #[error("hook references an invalid condition or operation range")]
    HookReference,
    #[error("condition {index} has a forward, empty, or invalid reference")]
    ConditionReference { index: usize },
    #[error("operation {index} references an invalid selector or value")]
    OperationReference { index: usize },
    #[error("ratio denominator cannot be zero")]
    ZeroDenominator,
    #[error("registry keys and presentation cues cannot be empty")]
    EmptyRegistryKey,
}

impl RunProgramV1 {
    pub fn validate(&self) -> Result<(), RunProgramError> {
        if self.schema_version != RUN_PROGRAM_SCHEMA_VERSION_V1 {
            return Err(RunProgramError::SchemaVersion {
                expected: RUN_PROGRAM_SCHEMA_VERSION_V1,
                actual: self.schema_version,
            });
        }
        if self.id == RunProgramId::ZERO {
            return Err(RunProgramError::ZeroProgramId);
        }
        if self.budget.condition_nodes != self.conditions.len() as u32
            || self.budget.selector_nodes != self.selectors.len() as u32
            || self.budget.value_nodes != self.values.len() as u32
            || self.budget.operations != self.operations.len() as u32
        {
            return Err(RunProgramError::BudgetMismatch);
        }
        validate_values(&self.values)?;
        validate_conditions(&self.conditions, self.selectors.len(), self.values.len())?;
        validate_hooks(&self.hooks, self.conditions.len(), self.operations.len())?;
        for (index, operation) in self.operations.iter().enumerate() {
            validate_operation(operation, self.selectors.len(), self.values.len())
                .map_err(|_| RunProgramError::OperationReference { index })?;
        }
        Ok(())
    }
}

fn validate_values(values: &[RunValue]) -> Result<(), RunProgramError> {
    for value in values {
        match value {
            RunValue::Ratio { denominator: 0, .. } => return Err(RunProgramError::ZeroDenominator),
            RunValue::RegistryKey(key) if key.is_empty() => {
                return Err(RunProgramError::EmptyRegistryKey);
            }
            _ => {}
        }
    }
    Ok(())
}

fn validate_conditions(
    conditions: &[RunCondition],
    selector_count: usize,
    value_count: usize,
) -> Result<(), RunProgramError> {
    for (index, condition) in conditions.iter().enumerate() {
        let valid = match condition {
            RunCondition::Not(reference) => reference.0 < index as u32,
            RunCondition::All(references) | RunCondition::Any(references) => {
                !references.is_empty()
                    && references
                        .iter()
                        .all(|reference| reference.0 < index as u32)
            }
            RunCondition::MoneyAtLeast(value) | RunCondition::WaveAtLeast(value) => {
                (value.0 as usize) < value_count
            }
            RunCondition::SelectorExists(selector) => (selector.0 as usize) < selector_count,
            _ => true,
        };
        if !valid {
            return Err(RunProgramError::ConditionReference { index });
        }
    }
    Ok(())
}

fn validate_hooks(
    hooks: &[RunHookBinding],
    condition_count: usize,
    operation_count: usize,
) -> Result<(), RunProgramError> {
    let mut previous = None;
    for hook in hooks {
        if previous.is_some_and(|value| value >= hook.hook) {
            return Err(RunProgramError::HookOrder);
        }
        previous = Some(hook.hook);
        let end = hook
            .first_operation
            .checked_add(hook.operation_count)
            .ok_or(RunProgramError::HookReference)?;
        if hook.condition.0 as usize >= condition_count
            || end as usize > operation_count
            || hook.operation_count == 0
        {
            return Err(RunProgramError::HookReference);
        }
    }
    Ok(())
}

fn validate_operation(
    operation: &RunOperation,
    selectors: usize,
    values: usize,
) -> Result<(), RunProgramError> {
    let selector_valid = |selector: RunSelectorId| (selector.0 as usize) < selectors;
    let value_valid = |value: RunValueId| (value.0 as usize) < values;
    let valid = match operation {
        RunOperation::AddMoney { amount }
        | RunOperation::RemoveMoney { amount }
        | RunOperation::AdvanceQuest { amount, .. }
        | RunOperation::ChangeFactionStanding { amount, .. } => value_valid(*amount),
        RunOperation::GrantExperience { target, amount }
        | RunOperation::HealPokemon { target, amount }
        | RunOperation::RevivePokemon { target, amount } => {
            selector_valid(*target) && value_valid(*amount)
        }
        RunOperation::AddModifier {
            target,
            stacks,
            registry_key,
        } => *stacks > 0 && !registry_key.is_empty() && target.is_none_or(selector_valid),
        RunOperation::RemoveModifier {
            registry_key,
            stacks,
        } => *stacks > 0 && !registry_key.is_empty(),
        RunOperation::SetLevel { target, level } => selector_valid(*target) && *level > 0,
        RunOperation::ChangeStatus { target, .. }
        | RunOperation::AddMove { target, .. }
        | RunOperation::RemoveMove { target, .. }
        | RunOperation::ReplaceMove { target, .. }
        | RunOperation::ChangeAbility { target, .. }
        | RunOperation::ChangeNature { target, .. }
        | RunOperation::CapturePokemon { target, .. }
        | RunOperation::AddPokemonToParty { target }
        | RunOperation::SendPokemonToStorage { target }
        | RunOperation::ReleasePokemon { target }
        | RunOperation::EvolvePokemon { target, .. }
        | RunOperation::UnfusePokemon { target }
        | RunOperation::ChangePersistentForm { target, .. } => selector_valid(*target),
        RunOperation::FusePokemon { target, partner } => {
            selector_valid(*target) && selector_valid(*partner) && target != partner
        }
        RunOperation::AddItem { count, .. } | RunOperation::RemoveItem { count, .. } => *count > 0,
        RunOperation::TransferItem { source, target, .. } => {
            selector_valid(*source) && selector_valid(*target) && source != target
        }
        RunOperation::EmitPresentation { cue } => !cue.is_empty(),
        _ => true,
    };
    valid
        .then_some(())
        .ok_or(RunProgramError::OperationReference { index: 0 })
}

#[cfg(test)]
mod tests {
    use crate::{GameBehaviorUnitId, RunProgramId, SafeU53};

    use super::{
        RUN_PROGRAM_SCHEMA_VERSION_V1, RunCondition, RunConditionId, RunHook, RunHookBinding,
        RunProgramBudget, RunProgramError, RunProgramV1,
    };

    fn program() -> RunProgramV1 {
        RunProgramV1 {
            schema_version: RUN_PROGRAM_SCHEMA_VERSION_V1,
            id: RunProgramId::new(SafeU53::new(1).expect("safe ID")),
            source: GameBehaviorUnitId::parse("a".repeat(64)).expect("behavior ID"),
            hooks: vec![RunHookBinding {
                hook: RunHook::RunStarted,
                condition: RunConditionId(0),
                first_operation: 0,
                operation_count: 1,
            }],
            conditions: vec![RunCondition::Always],
            selectors: Vec::new(),
            values: Vec::new(),
            operations: vec![super::RunOperation::SetRunFlag {
                flag: crate::RunFlagId::new(SafeU53::new(1).expect("safe flag")),
                value: true,
            }],
            budget: RunProgramBudget {
                condition_nodes: 1,
                selector_nodes: 0,
                value_nodes: 0,
                operations: 1,
                emitted_presentations: 0,
            },
        }
    }

    #[test]
    fn valid_program_has_closed_ordered_references() {
        program().validate().expect("valid program");
    }

    #[test]
    fn forward_condition_reference_fails_closed() {
        let mut value = program();
        value.conditions[0] = RunCondition::Not(RunConditionId(0));
        assert!(matches!(
            value.validate(),
            Err(RunProgramError::ConditionReference { index: 0 })
        ));
    }
}
