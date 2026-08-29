//! Canonical M7.2 new-run material shared by authority and replica.

use std::collections::BTreeMap;

use er_canonical::{canonical_bytes, content_digest};
use er_rng::audit::RngDraw;
use er_state::m7_state::GameStateV5;
use er_types::GameControlPlanV2;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::m7_content::PreparedGameContentV1;
use crate::m72_bootstrap::{RunBootstrapMachineV1, RunBootstrapSelectionsV1, RunBootstrapStageV1};

pub const NEW_RUN_MATERIAL_SCHEMA_VERSION_V1: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewRunMaterialV1 {
    pub schema_version: u32,
    pub profile_digest: String,
    pub bootstrap_digest: String,
    pub selections: RunBootstrapSelectionsV1,
    pub rng_audit: Vec<RngDraw>,
    pub initial_state: GameStateV5,
    pub initial_control: GameControlPlanV2,
    pub after_digest: String,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum NewRunMaterialErrorV1 {
    #[error("bootstrap is not complete or is invalid")]
    Bootstrap,
    #[error("new-run constructor failed: {0}")]
    Constructor(String),
    #[error("new-run material schema, state, control, or identity is invalid")]
    Invalid,
    #[error("new-run material canonical encoding failed: {0}")]
    Canonical(String),
    #[error("new-run material JSON is malformed or noncanonical: {0}")]
    Json(String),
    #[error("live profile or content differs from the material frontier")]
    Frontier,
    #[error("new-run material identity was reused with different bytes")]
    Conflict,
}

impl NewRunMaterialV1 {
    pub fn prepare<F>(
        bootstrap: &RunBootstrapMachineV1,
        content: &PreparedGameContentV1,
        construct: F,
    ) -> Result<Self, NewRunMaterialErrorV1>
    where
        F: FnOnce(
            &RunBootstrapSelectionsV1,
            &PreparedGameContentV1,
        ) -> Result<(GameStateV5, GameControlPlanV2, Vec<RngDraw>), String>,
    {
        bootstrap
            .validate()
            .map_err(|_| NewRunMaterialErrorV1::Bootstrap)?;
        if bootstrap.stage != RunBootstrapStageV1::Complete {
            return Err(NewRunMaterialErrorV1::Bootstrap);
        }
        let (initial_state, initial_control, rng_audit) = construct(&bootstrap.selections, content)
            .map_err(NewRunMaterialErrorV1::Constructor)?;
        let value = Self {
            schema_version: NEW_RUN_MATERIAL_SCHEMA_VERSION_V1,
            profile_digest: digest(&bootstrap.profile)?,
            bootstrap_digest: digest(bootstrap)?,
            selections: bootstrap.selections.clone(),
            rng_audit,
            after_digest: digest(&initial_state)?,
            initial_state,
            initial_control,
        };
        value.validate(content)?;
        Ok(value)
    }

    pub fn validate(&self, content: &PreparedGameContentV1) -> Result<(), NewRunMaterialErrorV1> {
        if self.schema_version != NEW_RUN_MATERIAL_SCHEMA_VERSION_V1
            || self.profile_digest.is_empty()
            || self.bootstrap_digest.is_empty()
            || self.after_digest.is_empty()
            || self.selections.mode.is_none()
            || self.selections.starters.is_empty()
            || self.selections.difficulty.is_none()
            || self.selections.save_slot.is_none()
            || self.initial_state.active_run.is_none()
            || self.initial_state.content_identity != *content.identity()
        {
            return Err(NewRunMaterialErrorV1::Invalid);
        }
        self.initial_state
            .validate()
            .map_err(|_| NewRunMaterialErrorV1::Invalid)?;
        self.initial_control
            .validate()
            .map_err(|_| NewRunMaterialErrorV1::Invalid)?;
        let run = self
            .initial_state
            .active_run
            .as_ref()
            .ok_or(NewRunMaterialErrorV1::Invalid)?;
        if run.control != self.initial_control
            || run.mode != self.selections.mode.ok_or(NewRunMaterialErrorV1::Invalid)?
            || digest(&self.initial_state)? != self.after_digest
            || digest(&self.initial_state.profile)? != self.profile_digest
        {
            return Err(NewRunMaterialErrorV1::Invalid);
        }
        Ok(())
    }

    pub fn encode(&self) -> Result<Vec<u8>, NewRunMaterialErrorV1> {
        canonical_bytes(self).map_err(|error| NewRunMaterialErrorV1::Canonical(error.to_string()))
    }

    pub fn decode_canonical(bytes: &[u8]) -> Result<Self, NewRunMaterialErrorV1> {
        let value: Self = serde_json::from_slice(bytes)
            .map_err(|error| NewRunMaterialErrorV1::Json(error.to_string()))?;
        let canonical = value.encode()?;
        if canonical != bytes {
            return Err(NewRunMaterialErrorV1::Json(
                "material bytes are not canonical".to_owned(),
            ));
        }
        Ok(value)
    }
}

pub fn apply_serialized_new_run_material_v1(
    live: &mut GameStateV5,
    content: &PreparedGameContentV1,
    bytes: &[u8],
    applied: &mut BTreeMap<String, Vec<u8>>,
) -> Result<bool, NewRunMaterialErrorV1> {
    let material = NewRunMaterialV1::decode_canonical(bytes)?;
    material.validate(content)?;
    if let Some(existing) = applied.get(&material.bootstrap_digest) {
        return if existing == bytes {
            Ok(false)
        } else {
            Err(NewRunMaterialErrorV1::Conflict)
        };
    }
    if live.active_run.is_some()
        || live.content_identity != material.initial_state.content_identity
        || digest(&live.profile)? != material.profile_digest
    {
        return Err(NewRunMaterialErrorV1::Frontier);
    }
    let replacement = material.initial_state;
    replacement
        .validate()
        .map_err(|_| NewRunMaterialErrorV1::Invalid)?;
    applied.insert(material.bootstrap_digest, bytes.to_vec());
    *live = replacement;
    Ok(true)
}

fn digest<T: Serialize>(value: &T) -> Result<String, NewRunMaterialErrorV1> {
    let digest = content_digest(value)
        .map_err(|error| NewRunMaterialErrorV1::Canonical(error.to_string()))?;
    Ok(format!("blake3-v1:{digest}"))
}
