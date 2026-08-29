//! M7.2 warm-path performance ceilings and deterministic attribution evidence.

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LabPerformanceOperationV1 {
    PresetSessionCreate,
    SnapshotRestore,
    ScenarioConstruction,
    NavigationPlanning,
    StateControlQuery,
    TenThousandJsonl,
    ThousandSessionForks,
    IncrementalCompile,
    ContentReload,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LabPerformanceCeilingV1 {
    pub operation: LabPerformanceOperationV1,
    pub maximum_micros: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LabPerformanceMeasurementV1 {
    pub operation: LabPerformanceOperationV1,
    pub runner_class: String,
    pub elapsed_micros: Option<u64>,
    pub deterministic_work: u64,
    pub deterministic_checksum: String,
    pub peak_rss_bytes: Option<u64>,
    pub allocations: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LabPerformanceResultV1 {
    pub operation: LabPerformanceOperationV1,
    pub passed: bool,
    pub maximum_micros: u64,
    pub observed_micros: Option<u64>,
    pub deterministic_work: u64,
    pub deterministic_checksum: String,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum LabPerformanceErrorV1 {
    #[error("performance ceiling, measurement, runner, work, or checksum is invalid")]
    Invalid,
    #[error("performance measurement is missing and cannot be green")]
    Missing,
}

pub fn m72_performance_ceilings_v1() -> Vec<LabPerformanceCeilingV1> {
    vec![
        LabPerformanceCeilingV1 {
            operation: LabPerformanceOperationV1::PresetSessionCreate,
            maximum_micros: 20_000,
        },
        LabPerformanceCeilingV1 {
            operation: LabPerformanceOperationV1::SnapshotRestore,
            maximum_micros: 20_000,
        },
        LabPerformanceCeilingV1 {
            operation: LabPerformanceOperationV1::ScenarioConstruction,
            maximum_micros: 250_000,
        },
        LabPerformanceCeilingV1 {
            operation: LabPerformanceOperationV1::NavigationPlanning,
            maximum_micros: 2_000,
        },
        LabPerformanceCeilingV1 {
            operation: LabPerformanceOperationV1::StateControlQuery,
            maximum_micros: 5_000,
        },
        LabPerformanceCeilingV1 {
            operation: LabPerformanceOperationV1::TenThousandJsonl,
            maximum_micros: 2_000_000,
        },
        LabPerformanceCeilingV1 {
            operation: LabPerformanceOperationV1::ThousandSessionForks,
            maximum_micros: 10_000_000,
        },
    ]
}

pub fn evaluate_performance_v1(
    ceilings: &[LabPerformanceCeilingV1],
    measurements: &[LabPerformanceMeasurementV1],
) -> Result<Vec<LabPerformanceResultV1>, LabPerformanceErrorV1> {
    if ceilings.is_empty()
        || ceilings
            .windows(2)
            .any(|pair| pair[0].operation >= pair[1].operation)
        || ceilings.iter().any(|ceiling| ceiling.maximum_micros == 0)
        || measurements
            .windows(2)
            .any(|pair| pair[0].operation >= pair[1].operation)
    {
        return Err(LabPerformanceErrorV1::Invalid);
    }
    ceilings
        .iter()
        .map(|ceiling| {
            let measurement = measurements
                .iter()
                .find(|measurement| measurement.operation == ceiling.operation)
                .ok_or(LabPerformanceErrorV1::Missing)?;
            if measurement.runner_class.is_empty()
                || measurement.deterministic_work == 0
                || measurement.deterministic_checksum.is_empty()
            {
                return Err(LabPerformanceErrorV1::Invalid);
            }
            let observed = measurement
                .elapsed_micros
                .ok_or(LabPerformanceErrorV1::Missing)?;
            Ok(LabPerformanceResultV1 {
                operation: ceiling.operation,
                passed: observed <= ceiling.maximum_micros,
                maximum_micros: ceiling.maximum_micros,
                observed_micros: Some(observed),
                deterministic_work: measurement.deterministic_work,
                deterministic_checksum: measurement.deterministic_checksum.clone(),
            })
        })
        .collect()
}
