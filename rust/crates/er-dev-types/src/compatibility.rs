//! Explicit kernel ABI and mechanical compatibility classification.

use serde::{Deserialize, Serialize};

use crate::{ExecutionIdentityV1, KernelAbiIdentityV1};

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AbiMismatchV1 {
    GameStateSchema,
    KernelInputSchema,
    KernelEffectSchema,
    SnapshotSchema,
    TraceSchema,
    MechanicalIdentity,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AbiMigrationAllowanceV1 {
    pub from_snapshot_schema: u32,
    pub to_snapshot_schema: u32,
    pub from_trace_schema: u32,
    pub to_trace_schema: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AbiCompatibilityReportV1 {
    pub compatible: bool,
    pub migration_required: bool,
    pub mismatches: Vec<AbiMismatchV1>,
}

pub fn compare_kernel_abi_v1(
    current_abi: &KernelAbiIdentityV1,
    candidate_abi: &KernelAbiIdentityV1,
    current_identity: &ExecutionIdentityV1,
    candidate_identity: &ExecutionIdentityV1,
    migrations: &[AbiMigrationAllowanceV1],
) -> AbiCompatibilityReportV1 {
    let mut mismatches = Vec::new();
    if current_abi.game_state_schema != candidate_abi.game_state_schema {
        mismatches.push(AbiMismatchV1::GameStateSchema);
    }
    if current_abi.kernel_input_schema != candidate_abi.kernel_input_schema {
        mismatches.push(AbiMismatchV1::KernelInputSchema);
    }
    if current_abi.kernel_effect_schema != candidate_abi.kernel_effect_schema {
        mismatches.push(AbiMismatchV1::KernelEffectSchema);
    }
    if current_abi.snapshot_schema != candidate_abi.snapshot_schema {
        mismatches.push(AbiMismatchV1::SnapshotSchema);
    }
    if current_abi.trace_schema != candidate_abi.trace_schema {
        mismatches.push(AbiMismatchV1::TraceSchema);
    }
    if !current_identity.mechanically_compatible(candidate_identity) {
        mismatches.push(AbiMismatchV1::MechanicalIdentity);
    }
    mismatches.sort();
    let snapshot_or_trace_only = mismatches.iter().all(|mismatch| {
        matches!(
            mismatch,
            AbiMismatchV1::SnapshotSchema | AbiMismatchV1::TraceSchema
        )
    });
    let migration_allowed = snapshot_or_trace_only
        && migrations.iter().any(|migration| {
            migration.from_snapshot_schema == current_abi.snapshot_schema
                && migration.to_snapshot_schema == candidate_abi.snapshot_schema
                && migration.from_trace_schema == current_abi.trace_schema
                && migration.to_trace_schema == candidate_abi.trace_schema
        });
    AbiCompatibilityReportV1 {
        compatible: mismatches.is_empty() || migration_allowed,
        migration_required: !mismatches.is_empty() && migration_allowed,
        mismatches,
    }
}
