//! Canonical scenario preset manifests and deterministic registry search.

use std::collections::BTreeMap;
use std::path::{Component, Path};

use er_canonical::canonical_bytes;
use er_types::{GameContentIdentity, GameControlKindV2};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::scenario::{GameBehaviorUnitIdV1, ScenarioReachabilityV1, ScenarioSpecificationV1};

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ScenarioPresetIdV1(pub String);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioPresetManifestV1 {
    pub id: ScenarioPresetIdV1,
    pub schema_version: u32,
    pub content_identity: GameContentIdentity,
    pub specification_digest: String,
    pub reachability: ScenarioReachabilityV1,
    pub expected_control: GameControlKindV2,
    pub behaviors: Vec<GameBehaviorUnitIdV1>,
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ScenarioPresetEntryV1 {
    pub manifest: ScenarioPresetManifestV1,
    pub specification: ScenarioSpecificationV1,
    pub canonical_specification: Vec<u8>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum PresetRegistryErrorV1 {
    #[error("preset path, schema, identity, or bound is invalid")]
    Invalid,
    #[error("preset identity already exists")]
    Duplicate,
    #[error("preset content identity does not match the registry")]
    ContentDrift,
    #[error("preset specification digest does not match canonical bytes")]
    Digest,
    #[error("preset canonical encoding failed: {0}")]
    Canonical(String),
}

#[derive(Clone, Debug, PartialEq)]
pub struct ScenarioPresetRegistryV1 {
    content_identity: GameContentIdentity,
    maximum_presets: usize,
    maximum_specification_bytes: usize,
    entries: BTreeMap<ScenarioPresetIdV1, ScenarioPresetEntryV1>,
}

impl ScenarioPresetRegistryV1 {
    pub fn new(
        content_identity: GameContentIdentity,
        maximum_presets: usize,
        maximum_specification_bytes: usize,
    ) -> Result<Self, PresetRegistryErrorV1> {
        if maximum_presets == 0 || maximum_specification_bytes == 0 {
            return Err(PresetRegistryErrorV1::Invalid);
        }
        Ok(Self {
            content_identity,
            maximum_presets,
            maximum_specification_bytes,
            entries: BTreeMap::new(),
        })
    }

    pub fn insert(
        &mut self,
        mut manifest: ScenarioPresetManifestV1,
        specification: ScenarioSpecificationV1,
    ) -> Result<(), PresetRegistryErrorV1> {
        validate_preset_id(&manifest.id)?;
        if manifest.schema_version != 1
            || manifest.content_identity != self.content_identity
            || self.entries.len() == self.maximum_presets
        {
            return if manifest.content_identity != self.content_identity {
                Err(PresetRegistryErrorV1::ContentDrift)
            } else {
                Err(PresetRegistryErrorV1::Invalid)
            };
        }
        manifest.behaviors.sort();
        manifest.behaviors.dedup();
        manifest.tags.sort();
        manifest.tags.dedup();
        if manifest.behaviors.iter().any(|value| value.0.is_empty())
            || manifest.tags.iter().any(String::is_empty)
        {
            return Err(PresetRegistryErrorV1::Invalid);
        }
        let canonical_specification = canonical_bytes(&specification)
            .map_err(|error| PresetRegistryErrorV1::Canonical(error.to_string()))?;
        if canonical_specification.len() > self.maximum_specification_bytes {
            return Err(PresetRegistryErrorV1::Invalid);
        }
        let digest = format!(
            "blake3-v1:{}",
            blake3::hash(&canonical_specification).to_hex()
        );
        if manifest.specification_digest != digest {
            return Err(PresetRegistryErrorV1::Digest);
        }
        let id = manifest.id.clone();
        if self.entries.contains_key(&id) {
            return Err(PresetRegistryErrorV1::Duplicate);
        }
        self.entries.insert(
            id,
            ScenarioPresetEntryV1 {
                manifest,
                specification,
                canonical_specification,
            },
        );
        Ok(())
    }

    pub fn get(
        &self,
        id: &ScenarioPresetIdV1,
    ) -> Result<&ScenarioPresetEntryV1, PresetRegistryErrorV1> {
        self.entries.get(id).ok_or(PresetRegistryErrorV1::Invalid)
    }

    pub fn search(
        &self,
        text: &str,
        tags: &[String],
        maximum: usize,
    ) -> Vec<&ScenarioPresetEntryV1> {
        if maximum == 0 || text.len() > 1024 || tags.iter().any(String::is_empty) {
            return Vec::new();
        }
        let query = text.to_ascii_lowercase();
        self.entries
            .values()
            .filter(|entry| {
                (query.is_empty() || entry.manifest.id.0.to_ascii_lowercase().contains(&query))
                    && tags.iter().all(|tag| entry.manifest.tags.contains(tag))
            })
            .take(maximum)
            .collect()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

pub fn validate_preset_id(id: &ScenarioPresetIdV1) -> Result<(), PresetRegistryErrorV1> {
    if id.0.is_empty() || id.0.len() > 256 || id.0.contains('\\') {
        return Err(PresetRegistryErrorV1::Invalid);
    }
    let path = Path::new(&id.0);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(PresetRegistryErrorV1::Invalid);
    }
    Ok(())
}
