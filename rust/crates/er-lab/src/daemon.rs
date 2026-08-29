//! Warm, bounded multi-session laboratory daemon.

use std::collections::BTreeMap;
use std::sync::Arc;

use er_game::m7_content::PreparedGameContentV1;
use er_types::RawInputEvent;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::artifact_store::{LabArtifactIdV1, LabArtifactStoreV1};
use crate::preset::{ScenarioPresetIdV1, ScenarioPresetRegistryV1};
use crate::query::LabSearchIndexV1;
use crate::scenario::{ReproCapsuleIdV1, ScenarioSpecificationV1};

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct LabSessionIdV1(pub u64);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum SessionStartV1 {
    Natural {
        seed: String,
    },
    Scenario {
        specification: Box<ScenarioSpecificationV1>,
    },
    Snapshot {
        artifact: LabArtifactIdV1,
    },
    Capsule {
        capsule: ReproCapsuleIdV1,
    },
    Preset {
        id: ScenarioPresetIdV1,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LabDaemonPolicyV1 {
    pub maximum_sessions: usize,
    pub maximum_cached_snapshots: usize,
    pub maximum_cached_snapshot_bytes: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LabHealthV1 {
    pub open: bool,
    pub content_hash: String,
    pub sessions: usize,
    pub cached_snapshots: usize,
    pub cached_snapshot_bytes: usize,
    pub artifacts: usize,
    pub artifact_bytes: usize,
    pub presets: usize,
    pub search_documents: usize,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum LabDaemonErrorV1 {
    #[error("daemon policy, session identity, or start request is invalid")]
    Invalid,
    #[error("daemon is closed")]
    Closed,
    #[error("daemon capacity is exhausted")]
    Capacity,
    #[error("session does not exist")]
    Missing,
    #[error("session backend failed: {0}")]
    Backend(String),
}

pub trait LabSessionBackendV1: std::fmt::Debug {
    type Session: std::fmt::Debug;

    fn create(
        &self,
        id: LabSessionIdV1,
        start: &SessionStartV1,
        content: Arc<PreparedGameContentV1>,
        presets: &ScenarioPresetRegistryV1,
        artifacts: &LabArtifactStoreV1,
    ) -> Result<Self::Session, String>;
    fn raw_input(
        &self,
        session: &mut Self::Session,
        input: RawInputEvent,
    ) -> Result<Vec<u8>, String>;
    fn advance_time(
        &self,
        session: &mut Self::Session,
        milliseconds: u64,
    ) -> Result<Vec<u8>, String>;
    fn snapshot(&self, session: &Self::Session) -> Result<Vec<u8>, String>;
    fn close(&self, session: &mut Self::Session) -> Result<(), String>;
}

#[derive(Debug)]
pub struct WarmLabDaemonV1<B: LabSessionBackendV1> {
    content: Arc<PreparedGameContentV1>,
    backend: B,
    policy: LabDaemonPolicyV1,
    sessions: BTreeMap<LabSessionIdV1, B::Session>,
    snapshot_cache: BTreeMap<String, Vec<u8>>,
    cached_snapshot_bytes: usize,
    pub presets: ScenarioPresetRegistryV1,
    pub search: LabSearchIndexV1,
    pub artifacts: LabArtifactStoreV1,
    open: bool,
}

impl<B: LabSessionBackendV1> WarmLabDaemonV1<B> {
    pub fn new(
        content: Arc<PreparedGameContentV1>,
        backend: B,
        policy: LabDaemonPolicyV1,
        presets: ScenarioPresetRegistryV1,
        search: LabSearchIndexV1,
        artifacts: LabArtifactStoreV1,
    ) -> Result<Self, LabDaemonErrorV1> {
        if policy.maximum_sessions == 0
            || policy.maximum_cached_snapshots == 0
            || policy.maximum_cached_snapshot_bytes == 0
            || search.content_identity != *content.identity()
        {
            return Err(LabDaemonErrorV1::Invalid);
        }
        Ok(Self {
            content,
            backend,
            policy,
            sessions: BTreeMap::new(),
            snapshot_cache: BTreeMap::new(),
            cached_snapshot_bytes: 0,
            presets,
            search,
            artifacts,
            open: true,
        })
    }

    pub fn create_session(
        &mut self,
        id: LabSessionIdV1,
        start: SessionStartV1,
    ) -> Result<(), LabDaemonErrorV1> {
        self.require_open()?;
        if self.sessions.contains_key(&id) || self.sessions.len() == self.policy.maximum_sessions {
            return Err(if self.sessions.contains_key(&id) {
                LabDaemonErrorV1::Invalid
            } else {
                LabDaemonErrorV1::Capacity
            });
        }
        validate_start(&start)?;
        let session = self
            .backend
            .create(
                id,
                &start,
                Arc::clone(&self.content),
                &self.presets,
                &self.artifacts,
            )
            .map_err(LabDaemonErrorV1::Backend)?;
        self.sessions.insert(id, session);
        Ok(())
    }

    pub fn raw_input(
        &mut self,
        id: LabSessionIdV1,
        input: RawInputEvent,
    ) -> Result<Vec<u8>, LabDaemonErrorV1> {
        self.require_open()?;
        self.backend
            .raw_input(
                self.sessions
                    .get_mut(&id)
                    .ok_or(LabDaemonErrorV1::Missing)?,
                input,
            )
            .map_err(LabDaemonErrorV1::Backend)
    }

    pub fn advance_time(
        &mut self,
        id: LabSessionIdV1,
        milliseconds: u64,
    ) -> Result<Vec<u8>, LabDaemonErrorV1> {
        self.require_open()?;
        self.backend
            .advance_time(
                self.sessions
                    .get_mut(&id)
                    .ok_or(LabDaemonErrorV1::Missing)?,
                milliseconds,
            )
            .map_err(LabDaemonErrorV1::Backend)
    }

    pub fn cache_snapshot(&mut self, id: LabSessionIdV1) -> Result<String, LabDaemonErrorV1> {
        self.require_open()?;
        let bytes = self
            .backend
            .snapshot(self.sessions.get(&id).ok_or(LabDaemonErrorV1::Missing)?)
            .map_err(LabDaemonErrorV1::Backend)?;
        if bytes.is_empty() || bytes.len() > self.policy.maximum_cached_snapshot_bytes {
            return Err(LabDaemonErrorV1::Capacity);
        }
        let digest = format!("blake3-v1:{}", blake3::hash(&bytes).to_hex());
        if self.snapshot_cache.contains_key(&digest) {
            return Ok(digest);
        }
        let projected = self
            .cached_snapshot_bytes
            .checked_add(bytes.len())
            .ok_or(LabDaemonErrorV1::Capacity)?;
        if projected > self.policy.maximum_cached_snapshot_bytes
            || self.snapshot_cache.len() == self.policy.maximum_cached_snapshots
        {
            return Err(LabDaemonErrorV1::Capacity);
        }
        self.cached_snapshot_bytes = projected;
        self.snapshot_cache.insert(digest.clone(), bytes);
        Ok(digest)
    }

    pub fn close_session(&mut self, id: LabSessionIdV1) -> Result<(), LabDaemonErrorV1> {
        self.require_open()?;
        let mut session = self.sessions.remove(&id).ok_or(LabDaemonErrorV1::Missing)?;
        self.backend
            .close(&mut session)
            .map_err(LabDaemonErrorV1::Backend)
    }

    pub fn health(&self) -> LabHealthV1 {
        let (artifacts, artifact_bytes) = self.artifacts.resource_counts();
        LabHealthV1 {
            open: self.open,
            content_hash: self.content.identity().content_hash.as_str().to_owned(),
            sessions: self.sessions.len(),
            cached_snapshots: self.snapshot_cache.len(),
            cached_snapshot_bytes: self.cached_snapshot_bytes,
            artifacts,
            artifact_bytes,
            presets: self.presets.len(),
            search_documents: self.search.document_count(),
        }
    }

    pub fn close(&mut self) -> Result<(), LabDaemonErrorV1> {
        if !self.open {
            return Ok(());
        }
        let mut first_error = None;
        for session in self.sessions.values_mut() {
            if let Err(error) = self.backend.close(session)
                && first_error.is_none()
            {
                first_error = Some(error);
            }
        }
        self.sessions.clear();
        self.snapshot_cache.clear();
        self.cached_snapshot_bytes = 0;
        self.artifacts.clear();
        self.open = false;
        if let Some(error) = first_error {
            Err(LabDaemonErrorV1::Backend(error))
        } else {
            Ok(())
        }
    }

    fn require_open(&self) -> Result<(), LabDaemonErrorV1> {
        if self.open {
            Ok(())
        } else {
            Err(LabDaemonErrorV1::Closed)
        }
    }
}

fn validate_start(start: &SessionStartV1) -> Result<(), LabDaemonErrorV1> {
    let valid = match start {
        SessionStartV1::Natural { seed } => !seed.is_empty(),
        SessionStartV1::Scenario { .. } => true,
        SessionStartV1::Snapshot { artifact } => !artifact.0.is_empty(),
        SessionStartV1::Capsule { capsule } => !capsule.0.is_empty(),
        SessionStartV1::Preset { id } => !id.0.is_empty(),
    };
    if valid {
        Ok(())
    } else {
        Err(LabDaemonErrorV1::Invalid)
    }
}
