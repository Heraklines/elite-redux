//! Versioned TypeScript golden-fixture loading.

use std::ffi::OsStr;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

const FIXTURE_VERSION: &str = "v1";
const FIXTURE_SCHEMA_VERSION: u32 = 1;
const FIXTURE_PROJECT_NAME: &str = "PokéRogue Redux";
const FIXTURE_ORACLE_GAME_SHA: &str = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";
const FIXTURE_PROTOCOL_VERSION: &str = "er-coop-47";
const FIXTURE_DIGEST_KIND: &str = "fixture-content-sha256-v1";
const FIXTURE_DIGEST_DEFINITION: &str =
    "SHA-256 over UTF-8 bytes of stable JSON.stringify(stableValue(payload)); object keys are code-point lexicographic and no trailing newline is included.";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
        .join("../../../test/kernel-fixtures")
        .join(FIXTURE_VERSION)
        .join(name)
}

pub fn load_fixture(name: &str) -> Result<Value, FixtureError> {
    load_fixture_envelope::<Value>(name).map(|envelope| envelope.payload)
}

pub fn load_fixture_envelope<T: DeserializeOwned>(
    name: &str,
) -> Result<FixtureEnvelope<T>, FixtureError> {
    validate_fixture_name(name)?;
    let path = fixture_path(name);
    let bytes = fs::read(&path).map_err(|source| FixtureError::Read {
        path: path.clone(),
        source,
    })?;
    let envelope = serde_json::from_slice(&bytes)
        .map_err(|source| FixtureError::Json { path: path.clone(), source })?;
    validate_envelope_metadata(&envelope, &path)?;
    Ok(envelope)
}

fn validate_fixture_name(name: &str) -> Result<(), FixtureError> {
    let path = Path::new(name);
    let mut components = path.components();
    let is_single_normal_component = matches!(
        (components.next(), components.next()),
        (Some(Component::Normal(component)), None) if component == OsStr::new(name)
    );
    let has_forbidden_character = name.chars().any(|character| {
        character.is_control()
            || matches!(character, '/' | '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*')
    });
    let has_ambiguous_windows_suffix = matches!(name.chars().last(), Some('.' | ' '));
    if name.is_empty()
        || has_forbidden_character
        || has_ambiguous_windows_suffix
        || is_reserved_windows_device_name(name)
        || !is_single_normal_component
    {
        return Err(FixtureError::InvalidName {
            name: name.to_owned(),
        });
    }
    Ok(())
}

fn is_reserved_windows_device_name(name: &str) -> bool {
    let stem = match name.split('.').next() {
        Some(value) => value.to_ascii_uppercase(),
        None => return false,
    };
    matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn validate_envelope_metadata<T>(
    envelope: &FixtureEnvelope<T>,
    path: &Path,
) -> Result<(), FixtureError> {
    validate_metadata_field(
        path,
        "schema_version",
        FIXTURE_SCHEMA_VERSION.to_string(),
        envelope.schema_version.to_string(),
    )?;
    validate_metadata_field(
        path,
        "project_name",
        FIXTURE_PROJECT_NAME.to_owned(),
        envelope.project_name.clone(),
    )?;
    validate_metadata_field(
        path,
        "oracle_game_sha",
        FIXTURE_ORACLE_GAME_SHA.to_owned(),
        envelope.oracle_game_sha.clone(),
    )?;
    validate_metadata_field(
        path,
        "protocol_version",
        FIXTURE_PROTOCOL_VERSION.to_owned(),
        envelope.protocol_version.clone(),
    )?;
    validate_metadata_field(
        path,
        "digest_kind",
        FIXTURE_DIGEST_KIND.to_owned(),
        envelope.digest_kind.clone(),
    )?;
    validate_metadata_field(
        path,
        "digest_definition",
        FIXTURE_DIGEST_DEFINITION.to_owned(),
        envelope.digest_definition.clone(),
    )?;
    Ok(())
}

fn validate_metadata_field(
    path: &Path,
    field: &'static str,
    expected: String,
    actual: String,
) -> Result<(), FixtureError> {
    if expected == actual {
        Ok(())
    } else {
        Err(FixtureError::UnsupportedMetadata {
            path: path.to_path_buf(),
            field,
            expected,
            actual,
        })
    }
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
    #[error(
        "fixture envelope {path:?} has unsupported {field}: expected {expected:?}, got {actual:?}"
    )]
    UnsupportedMetadata {
        path: PathBuf,
        field: &'static str,
        expected: String,
        actual: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE_NAMES: &[&str] = &[
        "authority-entry-kinds.json",
        "buttons.json",
        "checkpoints.json",
        "input-maps.json",
        "manifest.json",
        "next-controls.json",
        "protocol.json",
        "receipts.json",
        "replay-traces.json",
        "schema.json",
    ];

    #[test]
    fn existing_fixture_inventory_loads_from_versioned_directory() {
        for name in FIXTURE_NAMES {
            assert!(load_fixture_envelope::<Value>(name).is_ok());
        }
    }

    #[test]
    fn rejects_names_that_are_not_safe_single_components() {
        for name in [
            "",
            ".",
            "..",
            "../schema.json",
            r".\schema.json",
            "schema.json/..",
            "schema.json\0",
            "C:fixtures.json",
            "schema*.json",
            "schema.json.",
            "schema.json ",
            "CON",
            "NUL.txt",
        ] {
            assert!(load_fixture(name).is_err());
        }
    }

    #[test]
    fn rejects_unknown_envelope_fields() {
        let parsed = serde_json::from_str::<FixtureEnvelope<Value>>(
            r#"{
                "canonical_digest":"digest",
                "digest_definition":"definition",
                "digest_kind":"kind",
                "oracle_game_sha":"oracle",
                "payload":null,
                "project_name":"project",
                "protocol_version":"protocol",
                "schema_version":1,
                "source_file":"source.ts",
                "future_metadata":true
            }"#,
        );
        assert!(parsed.is_err());
    }

    #[test]
    fn validates_all_supported_metadata_values() {
        let envelope = FixtureEnvelope {
            canonical_digest: String::from("digest"),
            digest_definition: FIXTURE_DIGEST_DEFINITION.to_owned(),
            digest_kind: FIXTURE_DIGEST_KIND.to_owned(),
            oracle_game_sha: FIXTURE_ORACLE_GAME_SHA.to_owned(),
            payload: Value::Null,
            project_name: FIXTURE_PROJECT_NAME.to_owned(),
            protocol_version: FIXTURE_PROTOCOL_VERSION.to_owned(),
            schema_version: FIXTURE_SCHEMA_VERSION,
            source_file: String::from("source.ts"),
        };
        assert!(validate_envelope_metadata(&envelope, Path::new("fixture.json")).is_ok());

        let mut invalid = envelope;
        invalid.protocol_version = String::from("unsupported");
        assert!(validate_envelope_metadata(&invalid, Path::new("fixture.json")).is_err());
    }
}
