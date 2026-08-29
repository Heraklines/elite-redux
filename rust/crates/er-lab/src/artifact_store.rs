//! Bounded in-memory content-addressed artifact store.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct LabArtifactIdV1(pub String);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LabArtifactV1 {
    pub id: LabArtifactIdV1,
    pub media_type: String,
    pub bytes: Vec<u8>,
    pub pinned: bool,
    pub insertion_ordinal: u64,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ArtifactStoreErrorV1 {
    #[error("artifact store bound, media type, or payload is invalid")]
    Invalid,
    #[error("artifact store has no legal eviction")]
    Capacity,
    #[error("content digest collision has different bytes")]
    Collision,
    #[error("artifact does not exist")]
    Missing,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LabArtifactStoreV1 {
    maximum_bytes: usize,
    maximum_artifacts: usize,
    retained_bytes: usize,
    next_ordinal: u64,
    artifacts: BTreeMap<LabArtifactIdV1, LabArtifactV1>,
}

impl LabArtifactStoreV1 {
    pub fn new(
        maximum_bytes: usize,
        maximum_artifacts: usize,
    ) -> Result<Self, ArtifactStoreErrorV1> {
        if maximum_bytes == 0 || maximum_artifacts == 0 {
            return Err(ArtifactStoreErrorV1::Invalid);
        }
        Ok(Self {
            maximum_bytes,
            maximum_artifacts,
            retained_bytes: 0,
            next_ordinal: 0,
            artifacts: BTreeMap::new(),
        })
    }

    pub fn insert(
        &mut self,
        media_type: String,
        bytes: Vec<u8>,
        pinned: bool,
    ) -> Result<(LabArtifactIdV1, bool), ArtifactStoreErrorV1> {
        if media_type.is_empty() || bytes.is_empty() || bytes.len() > self.maximum_bytes {
            return Err(ArtifactStoreErrorV1::Invalid);
        }
        let id = LabArtifactIdV1(format!("blake3-v1:{}", blake3::hash(&bytes).to_hex()));
        if let Some(existing) = self.artifacts.get(&id) {
            if existing.bytes != bytes || existing.media_type != media_type {
                return Err(ArtifactStoreErrorV1::Collision);
            }
            return Ok((id, false));
        }
        let required = bytes.len();
        let mut victims = self
            .artifacts
            .values()
            .filter(|artifact| !artifact.pinned)
            .map(|artifact| {
                (
                    artifact.insertion_ordinal,
                    artifact.id.clone(),
                    artifact.bytes.len(),
                )
            })
            .collect::<Vec<_>>();
        victims.sort_by_key(|entry| entry.0);
        let mut projected_bytes = self
            .retained_bytes
            .checked_add(required)
            .ok_or(ArtifactStoreErrorV1::Capacity)?;
        let mut projected_count = self.artifacts.len() + 1;
        let mut evict = Vec::new();
        for (_, victim, size) in victims {
            if projected_bytes <= self.maximum_bytes && projected_count <= self.maximum_artifacts {
                break;
            }
            projected_bytes = projected_bytes
                .checked_sub(size)
                .ok_or(ArtifactStoreErrorV1::Capacity)?;
            projected_count = projected_count
                .checked_sub(1)
                .ok_or(ArtifactStoreErrorV1::Capacity)?;
            evict.push(victim);
        }
        if projected_bytes > self.maximum_bytes || projected_count > self.maximum_artifacts {
            return Err(ArtifactStoreErrorV1::Capacity);
        }
        for victim in evict {
            self.artifacts.remove(&victim);
        }
        let ordinal = self.next_ordinal;
        self.next_ordinal = self
            .next_ordinal
            .checked_add(1)
            .ok_or(ArtifactStoreErrorV1::Capacity)?;
        self.retained_bytes = projected_bytes;
        self.artifacts.insert(
            id.clone(),
            LabArtifactV1 {
                id: id.clone(),
                media_type,
                bytes,
                pinned,
                insertion_ordinal: ordinal,
            },
        );
        Ok((id, true))
    }

    pub fn get(&self, id: &LabArtifactIdV1) -> Result<&LabArtifactV1, ArtifactStoreErrorV1> {
        self.artifacts.get(id).ok_or(ArtifactStoreErrorV1::Missing)
    }

    pub fn resource_counts(&self) -> (usize, usize) {
        (self.artifacts.len(), self.retained_bytes)
    }

    pub fn clear(&mut self) {
        self.artifacts.clear();
        self.retained_bytes = 0;
    }
}
