//! Bounded deterministic-cost and diagnostic wall-clock attribution.

use std::collections::BTreeMap;

use er_canonical::canonical_bytes;
use er_dev_types::{
    CostEvidenceErrorV1, DeterministicCostEvidenceV1, PerformanceAttributionV1,
    WallClockPerformanceEvidenceV1,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PerformanceAttributionKeyV1(pub String);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PerformanceSampleV1 {
    pub attribution: PerformanceAttributionV1,
    pub deterministic: DeterministicCostEvidenceV1,
    pub wall_clock: WallClockPerformanceEvidenceV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PerformanceAggregateV1 {
    pub attribution: PerformanceAttributionV1,
    pub sample_count: u64,
    pub deterministic: DeterministicCostEvidenceV1,
    pub wall_clock: WallClockPerformanceEvidenceV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PerformanceLedgerSnapshotV1 {
    pub aggregates: BTreeMap<PerformanceAttributionKeyV1, PerformanceAggregateV1>,
    pub deterministic_checksum: String,
    pub retained_samples: usize,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum PerformanceLedgerErrorV1 {
    #[error("performance ledger bound or attribution is invalid")]
    Bounds,
    #[error("performance aggregation overflowed")]
    Overflow,
    #[error("performance checksum failed: {0}")]
    Canonical(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PerformanceLedgerV1 {
    maximum_attributions: usize,
    maximum_samples: usize,
    samples: usize,
    aggregates: BTreeMap<PerformanceAttributionKeyV1, PerformanceAggregateV1>,
}

impl PerformanceLedgerV1 {
    pub fn new(
        maximum_attributions: usize,
        maximum_samples: usize,
    ) -> Result<Self, PerformanceLedgerErrorV1> {
        if maximum_attributions == 0 || maximum_samples == 0 {
            return Err(PerformanceLedgerErrorV1::Bounds);
        }
        Ok(Self {
            maximum_attributions,
            maximum_samples,
            samples: 0,
            aggregates: BTreeMap::new(),
        })
    }

    pub fn record(&mut self, sample: PerformanceSampleV1) -> Result<(), PerformanceLedgerErrorV1> {
        validate_attribution(&sample.attribution)?;
        if self.samples == self.maximum_samples {
            return Err(PerformanceLedgerErrorV1::Bounds);
        }
        let key = attribution_key_v1(&sample.attribution)?;
        if !self.aggregates.contains_key(&key) && self.aggregates.len() == self.maximum_attributions
        {
            return Err(PerformanceLedgerErrorV1::Bounds);
        }
        if let Some(aggregate) = self.aggregates.get_mut(&key) {
            aggregate.deterministic = aggregate
                .deterministic
                .checked_add(&sample.deterministic)
                .map_err(map_cost_error)?;
            aggregate.sample_count = aggregate
                .sample_count
                .checked_add(1)
                .ok_or(PerformanceLedgerErrorV1::Overflow)?;
            aggregate.wall_clock.total_nanos = aggregate
                .wall_clock
                .total_nanos
                .checked_add(sample.wall_clock.total_nanos)
                .ok_or(PerformanceLedgerErrorV1::Overflow)?;
            aggregate.wall_clock.allocations = aggregate
                .wall_clock
                .allocations
                .checked_add(sample.wall_clock.allocations)
                .ok_or(PerformanceLedgerErrorV1::Overflow)?;
            aggregate.wall_clock.bytes_allocated = aggregate
                .wall_clock
                .bytes_allocated
                .checked_add(sample.wall_clock.bytes_allocated)
                .ok_or(PerformanceLedgerErrorV1::Overflow)?;
        } else {
            self.aggregates.insert(
                key,
                PerformanceAggregateV1 {
                    attribution: sample.attribution,
                    sample_count: 1,
                    deterministic: sample.deterministic,
                    wall_clock: sample.wall_clock,
                },
            );
        }
        self.samples += 1;
        Ok(())
    }

    pub fn snapshot(&self) -> Result<PerformanceLedgerSnapshotV1, PerformanceLedgerErrorV1> {
        let deterministic = self
            .aggregates
            .iter()
            .map(|(key, aggregate)| {
                (
                    key,
                    &aggregate.attribution,
                    aggregate.sample_count,
                    &aggregate.deterministic,
                )
            })
            .collect::<Vec<_>>();
        let bytes = canonical_bytes(&("elite-redux/m71/performance/v1", deterministic))
            .map_err(|error| PerformanceLedgerErrorV1::Canonical(error.to_string()))?;
        Ok(PerformanceLedgerSnapshotV1 {
            aggregates: self.aggregates.clone(),
            deterministic_checksum: format!("blake3-v1:{}", blake3::hash(&bytes).to_hex()),
            retained_samples: self.samples,
        })
    }

    pub fn clear(&mut self) {
        self.samples = 0;
        self.aggregates.clear();
    }
}

pub fn attribution_key_v1(
    attribution: &PerformanceAttributionV1,
) -> Result<PerformanceAttributionKeyV1, PerformanceLedgerErrorV1> {
    validate_attribution(attribution)?;
    let bytes = canonical_bytes(&("elite-redux/m71/performance-attribution/v1", attribution))
        .map_err(|error| PerformanceLedgerErrorV1::Canonical(error.to_string()))?;
    Ok(PerformanceAttributionKeyV1(
        blake3::hash(&bytes).to_hex().to_string(),
    ))
}

fn validate_attribution(
    attribution: &PerformanceAttributionV1,
) -> Result<(), PerformanceLedgerErrorV1> {
    if attribution.subsystem.is_empty()
        || [
            attribution.behavior_unit.as_ref(),
            attribution.content_id.as_ref(),
            attribution.operation_id.as_ref(),
            attribution.transition_id.as_ref(),
        ]
        .into_iter()
        .flatten()
        .any(String::is_empty)
    {
        return Err(PerformanceLedgerErrorV1::Bounds);
    }
    Ok(())
}

fn map_cost_error(error: CostEvidenceErrorV1) -> PerformanceLedgerErrorV1 {
    match error {
        CostEvidenceErrorV1::Overflow => PerformanceLedgerErrorV1::Overflow,
        CostEvidenceErrorV1::Attribution => PerformanceLedgerErrorV1::Bounds,
    }
}
