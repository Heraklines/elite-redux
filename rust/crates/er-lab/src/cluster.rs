//! Deterministic failure clustering with bounded representative retention.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::artifact_store::LabArtifactIdV1;
use crate::fingerprint::{FailureFingerprintV1, FingerprintErrorV1};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FailureInstanceV1 {
    pub fingerprint: FailureFingerprintV1,
    pub capsule: LabArtifactIdV1,
    pub event_count: usize,
    pub execution_nanos: u64,
    pub seed: String,
    pub ordinal: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FailureClusterV1 {
    pub fingerprint: FailureFingerprintV1,
    pub count: u64,
    pub first: LabArtifactIdV1,
    pub smallest: LabArtifactIdV1,
    pub smallest_event_count: usize,
    pub fastest: LabArtifactIdV1,
    pub fastest_nanos: u64,
    pub seed_counts: BTreeMap<String, u64>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum FailureClusterErrorV1 {
    #[error("failure cluster bound or instance is invalid")]
    Invalid,
    #[error("failure cluster capacity is exhausted")]
    Capacity,
    #[error("failure fingerprint failed: {0}")]
    Fingerprint(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FailureClusterStoreV1 {
    maximum_clusters: usize,
    maximum_seeds_per_cluster: usize,
    clusters: BTreeMap<String, FailureClusterV1>,
}

impl FailureClusterStoreV1 {
    pub fn new(
        maximum_clusters: usize,
        maximum_seeds_per_cluster: usize,
    ) -> Result<Self, FailureClusterErrorV1> {
        if maximum_clusters == 0 || maximum_seeds_per_cluster == 0 {
            return Err(FailureClusterErrorV1::Invalid);
        }
        Ok(Self {
            maximum_clusters,
            maximum_seeds_per_cluster,
            clusters: BTreeMap::new(),
        })
    }

    pub fn insert(&mut self, instance: FailureInstanceV1) -> Result<String, FailureClusterErrorV1> {
        if instance.capsule.0.is_empty() || instance.seed.is_empty() {
            return Err(FailureClusterErrorV1::Invalid);
        }
        let fingerprint = instance.fingerprint.normalize().map_err(map_fingerprint)?;
        let key = fingerprint.digest().map_err(map_fingerprint)?;
        if let Some(cluster) = self.clusters.get_mut(&key) {
            cluster.count = cluster
                .count
                .checked_add(1)
                .ok_or(FailureClusterErrorV1::Capacity)?;
            if instance.event_count < cluster.smallest_event_count
                || (instance.event_count == cluster.smallest_event_count
                    && instance.capsule < cluster.smallest)
            {
                cluster.smallest = instance.capsule.clone();
                cluster.smallest_event_count = instance.event_count;
            }
            if instance.execution_nanos < cluster.fastest_nanos
                || (instance.execution_nanos == cluster.fastest_nanos
                    && instance.capsule < cluster.fastest)
            {
                cluster.fastest = instance.capsule.clone();
                cluster.fastest_nanos = instance.execution_nanos;
            }
            if let Some(count) = cluster.seed_counts.get_mut(&instance.seed) {
                *count = count
                    .checked_add(1)
                    .ok_or(FailureClusterErrorV1::Capacity)?;
            } else if cluster.seed_counts.len() < self.maximum_seeds_per_cluster {
                cluster.seed_counts.insert(instance.seed, 1);
            }
            return Ok(key);
        }
        if self.clusters.len() == self.maximum_clusters {
            return Err(FailureClusterErrorV1::Capacity);
        }
        let capsule = instance.capsule;
        self.clusters.insert(
            key.clone(),
            FailureClusterV1 {
                fingerprint,
                count: 1,
                first: capsule.clone(),
                smallest: capsule.clone(),
                smallest_event_count: instance.event_count,
                fastest: capsule,
                fastest_nanos: instance.execution_nanos,
                seed_counts: BTreeMap::from([(instance.seed, 1)]),
            },
        );
        Ok(key)
    }

    pub fn clusters(&self) -> &BTreeMap<String, FailureClusterV1> {
        &self.clusters
    }
}

fn map_fingerprint(error: FingerprintErrorV1) -> FailureClusterErrorV1 {
    FailureClusterErrorV1::Fingerprint(error.to_string())
}
