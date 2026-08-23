use serde::{Deserialize, Serialize};
use thiserror::Error;

use er_types::mechanics::MechanicQuery;

use crate::{
    ActionOperationKind, BindingKind, FieldEffectKind, HpOperationKind, MechanicOperation,
    MechanicsProgramV1,
};

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MechanicFamily {
    DamageTypeCritical,
    MultiHitRecoilDrain,
    MajorStatus,
    VolatileEffects,
    StatPrioritySpeedAccuracy,
    SwitchingPivot,
    WeatherTerrain,
    HazardsScreensConditions,
    SuppressionImmunityRedirection,
    HeldItemLifecycle,
    Bespoke,
}

pub const ADMITTED_FAMILIES: [MechanicFamily; 11] = [
    MechanicFamily::DamageTypeCritical,
    MechanicFamily::MultiHitRecoilDrain,
    MechanicFamily::MajorStatus,
    MechanicFamily::VolatileEffects,
    MechanicFamily::StatPrioritySpeedAccuracy,
    MechanicFamily::SwitchingPivot,
    MechanicFamily::WeatherTerrain,
    MechanicFamily::HazardsScreensConditions,
    MechanicFamily::SuppressionImmunityRedirection,
    MechanicFamily::HeldItemLifecycle,
    MechanicFamily::Bespoke,
];

pub fn validate_family_program(
    family: MechanicFamily,
    program: &MechanicsProgramV1,
) -> Result<(), FamilyValidationError> {
    program
        .validate()
        .map_err(|_| FamilyValidationError::InvalidProgram)?;
    for binding in &program.bindings {
        if let BindingKind::Query { query, .. } = binding.binding
            && query_family(query) != family
        {
            return Err(FamilyValidationError::WrongQueryFamily { family, query });
        }
        let start = usize::from(binding.operations.start);
        let end = binding
            .operations
            .end()
            .ok_or(FamilyValidationError::InvalidProgram)?;
        for operation in &program.operations[start..end] {
            if !operation_belongs_to(family, operation) {
                return Err(FamilyValidationError::WrongOperationFamily { family });
            }
        }
    }
    Ok(())
}

pub const fn query_family(query: MechanicQuery) -> MechanicFamily {
    match query {
        MechanicQuery::MoveType
        | MechanicQuery::MoveCategory
        | MechanicQuery::CriticalRate
        | MechanicQuery::MovePower
        | MechanicQuery::TypeEffectiveness
        | MechanicQuery::Damage => MechanicFamily::DamageTypeCritical,
        MechanicQuery::HitCount => MechanicFamily::MultiHitRecoilDrain,
        MechanicQuery::ActionPriority
        | MechanicQuery::EffectiveSpeed
        | MechanicQuery::Accuracy
        | MechanicQuery::OffensiveStat
        | MechanicQuery::DefensiveStat => MechanicFamily::StatPrioritySpeedAccuracy,
        MechanicQuery::StatusEligibility => MechanicFamily::MajorStatus,
        MechanicQuery::VolatileEligibility => MechanicFamily::VolatileEffects,
        MechanicQuery::SwitchEligibility => MechanicFamily::SwitchingPivot,
        MechanicQuery::ItemEligibility => MechanicFamily::HeldItemLifecycle,
        MechanicQuery::MoveTarget => MechanicFamily::SuppressionImmunityRedirection,
    }
}

pub fn operation_belongs_to(family: MechanicFamily, operation: &MechanicOperation) -> bool {
    match operation {
        MechanicOperation::Presentation { .. } => true,
        MechanicOperation::Query { .. } => true,
        MechanicOperation::Hp { operation, .. } => match operation {
            HpOperationKind::RecoilFromDamage | HpOperationKind::DrainFromDamage => {
                family == MechanicFamily::MultiHitRecoilDrain
            }
            HpOperationKind::Damage
            | HpOperationKind::IndirectDamage
            | HpOperationKind::Heal
            | HpOperationKind::Set => {
                family == MechanicFamily::DamageTypeCritical
                    || family == MechanicFamily::WeatherTerrain
                    || family == MechanicFamily::VolatileEffects
                    || family == MechanicFamily::HeldItemLifecycle
                    || family == MechanicFamily::Bespoke
            }
        },
        MechanicOperation::Pp { .. } => {
            family == MechanicFamily::VolatileEffects || family == MechanicFamily::HeldItemLifecycle
        }
        MechanicOperation::Status { .. } => family == MechanicFamily::MajorStatus,
        MechanicOperation::StatStage { .. } => family == MechanicFamily::StatPrioritySpeedAccuracy,
        MechanicOperation::FieldEffect { effect, .. } => match effect {
            FieldEffectKind::Weather | FieldEffectKind::Terrain => {
                family == MechanicFamily::WeatherTerrain
            }
            FieldEffectKind::SideCondition | FieldEffectKind::ArenaTag => {
                family == MechanicFamily::HazardsScreensConditions
            }
            FieldEffectKind::BattlerTag | FieldEffectKind::PositionalTag => {
                family == MechanicFamily::VolatileEffects
            }
        },
        MechanicOperation::CreateInstance { .. }
        | MechanicOperation::UpdateInstance { .. }
        | MechanicOperation::RemoveInstance { .. } => {
            matches!(
                family,
                MechanicFamily::VolatileEffects
                    | MechanicFamily::WeatherTerrain
                    | MechanicFamily::HazardsScreensConditions
                    | MechanicFamily::HeldItemLifecycle
                    | MechanicFamily::Bespoke
            )
        }
        MechanicOperation::Switch { .. } => family == MechanicFamily::SwitchingPivot,
        MechanicOperation::Item { .. } => family == MechanicFamily::HeldItemLifecycle,
        MechanicOperation::Action { operation, .. } => match operation {
            ActionOperationKind::AdditionalHit => family == MechanicFamily::MultiHitRecoilDrain,
            ActionOperationKind::Cancel | ActionOperationKind::Flinch => {
                family == MechanicFamily::SuppressionImmunityRedirection
                    || family == MechanicFamily::VolatileEffects
            }
            ActionOperationKind::RetryMove
            | ActionOperationKind::QueueClosedMove
            | ActionOperationKind::DisableMove
            | ActionOperationKind::LockMove
            | ActionOperationKind::ClearMoveLock => {
                family == MechanicFamily::VolatileEffects || family == MechanicFamily::Bespoke
            }
        },
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum FamilyValidationError {
    #[error("mechanic family program is invalid")]
    InvalidProgram,
    #[error("query {query:?} is not admitted by family {family:?}")]
    WrongQueryFamily {
        family: MechanicFamily,
        query: MechanicQuery,
    },
    #[error("operation is not admitted by family {family:?}")]
    WrongOperationFamily { family: MechanicFamily },
}
