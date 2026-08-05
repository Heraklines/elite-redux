//! Versioned TypeScript golden-fixture loading.

use std::fs;
use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FixtureEnvelope<T> {
    pub canonical_digest: String,
    pub digest_definition: String,
    pub digest_kind: String,
    pub oracle_game_sha: String,
    pub payload: T,
    pub project_name: String,
    pub protocol_version: String,
    pub schema_version: u32,
    pub source_file: String,
}

pub fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../test/kernel-fixtures/v1")
        .join(name)
}

pub fn load_fixture(name: &str) -> Result<Value, FixtureError> {
    load_fixture_envelope::<Value>(name).map(|envelope| envelope.payload)
}

pub fn load_fixture_envelope<T: DeserializeOwned>(
    name: &str,
) -> Result<FixtureEnvelope<T>, FixtureError> {
    if name.is_empty() || name.contains('/') || name.contains('\\') {
        return Err(FixtureError::InvalidName {
            name: name.to_owned(),
        });
    }
    let path = fixture_path(name);
    let bytes = fs::read(&path).map_err(|source| FixtureError::Read {
        path: path.clone(),
        source,
    })?;
    serde_json::from_slice(&bytes).map_err(|source| FixtureError::Json { path, source })
}

#[derive(Debug, Error)]
pub enum FixtureError {
    #[error("fixture name is not a single safe path component: {name}")]
    InvalidName { name: String },
    #[error("could not read fixture {path:?}: {source}")]
    Read {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("could not parse fixture {path:?}: {source}")]
    Json {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },
}
