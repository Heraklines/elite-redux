//! Versioned TypeScript golden-fixture loading.

use std::ffi::OsStr;
use std::fs;
use std::path::{Component, Path, PathBuf};

use er_canonical::{CanonicalError, fixture_digest};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

const FIXTURE_VERSION: &str = "v1";
// An embedded NUL cannot name a filesystem entry on supported platforms.
const INVALID_FIXTURE_SENTINEL: &str = "__invalid_fixture_name__\0";
const FIXTURE_SCHEMA_VERSION: u32 = 1;
const FIXTURE_PROJECT_NAME: &str = "PokéRogue Redux";
const FIXTURE_ORACLE_GAME_SHA: &str = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";
const FIXTURE_PROTOCOL_VERSION: &str = "er-coop-48";
const FIXTURE_DIGEST_KIND: &str = "fixture-content-sha256-v1";
const FIXTURE_DIGEST_DEFINITION: &str = "SHA-256 over UTF-8 bytes of stable JSON.stringify(stableValue(payload)); object keys are code-point lexicographic and no trailing newline is included.";

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

fn fixture_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../test/kernel-fixtures")
        .join(FIXTURE_VERSION)
}

pub fn fixture_path(name: &str) -> PathBuf {
    let relative_name = if validate_fixture_name(name).is_ok() {
        PathBuf::from(name)
    } else {
        PathBuf::from(INVALID_FIXTURE_SENTINEL)
    };
    fixture_root().join(relative_name)
}

pub fn load_fixture(name: &str) -> Result<Value, FixtureError> {
    let envelope = load_fixture_envelope::<Value>(name)?;
    let path = fixture_path(name);
    verify_fixture_digest(&path, &envelope.payload, &envelope.canonical_digest)?;
    Ok(envelope.payload)
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
    let envelope = serde_json::from_slice(&bytes).map_err(|source| FixtureError::Json {
        path: path.clone(),
        source,
    })?;
    validate_envelope_metadata(&envelope, &path)?;
    Ok(envelope)
}

fn verify_fixture_digest(path: &Path, payload: &Value, expected: &str) -> Result<(), FixtureError> {
    let actual = fixture_digest(payload).map_err(|source| FixtureError::DigestComputation {
        path: path.to_path_buf(),
        source,
    })?;
    if actual == expected {
        Ok(())
    } else {
        Err(FixtureError::DigestMismatch {
            path: path.to_path_buf(),
            expected: expected.to_owned(),
            actual,
        })
    }
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
            || matches!(
                character,
                '/' | '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*'
            )
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
    validate_source_file(path, &envelope.source_file)?;
    Ok(())
}

fn validate_source_file(path: &Path, source_file: &str) -> Result<(), FixtureError> {
    let invalid_reason = if source_file.is_empty() {
        Some("source_file must be nonempty")
    } else if source_file.chars().any(|character| character.is_control()) {
        Some("source_file must not contain control characters")
    } else if source_file.contains('\\') {
        Some("source_file must use forward slashes")
    } else if source_file.contains(':') {
        Some("source_file must not contain a path prefix")
    } else if source_file.split('/').any(|component| component.is_empty()) {
        Some("source_file must be a normalized relative path")
    } else if source_file
        .split('/')
        .any(|component| matches!(component, "." | ".."))
    {
        Some("source_file must not contain dot or parent components")
    } else {
        let source_path = Path::new(source_file);
        if source_path.is_absolute()
            || source_path.components().any(|component| {
                matches!(
                    component,
                    Component::Prefix(_)
                        | Component::RootDir
                        | Component::CurDir
                        | Component::ParentDir
                )
            })
        {
            Some("source_file must be a relative path without a prefix")
        } else {
            None
        }
    };

    match invalid_reason {
        Some(reason) => Err(FixtureError::InvalidSourceFile {
            path: path.to_path_buf(),
            source_file: source_file.to_owned(),
            reason,
        }),
        None => Ok(()),
    }
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
    #[error("could not compute canonical digest for fixture {path:?}: {source}")]
    DigestComputation {
        path: PathBuf,
        #[source]
        source: CanonicalError,
    },
    #[error("fixture {path:?} canonical digest mismatch: expected {expected:?}, actual {actual:?}")]
    DigestMismatch {
        path: PathBuf,
        expected: String,
        actual: String,
    },
    #[error("fixture envelope {path:?} has invalid source_file {source_file:?}: {reason}")]
    InvalidSourceFile {
        path: PathBuf,
        source_file: String,
        reason: &'static str,
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
    fn existing_fixture_inventory_loads_with_verified_digests() {
        for name in FIXTURE_NAMES {
            assert!(load_fixture(name).is_ok());
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
            assert!(matches!(
                load_fixture(name),
                Err(FixtureError::InvalidName { .. })
            ));
        }
    }

    #[test]
    fn invalid_fixture_paths_use_a_nonexistent_sentinel_under_the_root() {
        let root = fixture_root();
        for name in [
            "",
            ".",
            "..",
            "../schema.json",
            r".\schema.json",
            "C:fixtures.json",
            "schema.json\0",
        ] {
            let path = fixture_path(name);
            assert!(path.starts_with(&root));
            assert_eq!(path.parent(), Some(root.as_path()));
            assert!(!path.exists());
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

    #[test]
    fn rejects_non_normalized_source_file_paths() {
        let mut envelope = FixtureEnvelope {
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

        for source_file in [
            "",
            "source\\file.ts",
            "/source/file.ts",
            "\\source\\file.ts",
            "C:/source/file.ts",
            "C:source.ts",
            "source//file.ts",
            "source/./file.ts",
            "source/../file.ts",
            "source/\0file.ts",
        ] {
            envelope.source_file = source_file.to_owned();
            assert!(matches!(
                validate_envelope_metadata(&envelope, Path::new("fixture.json")),
                Err(FixtureError::InvalidSourceFile { .. })
            ));
        }

        for source_file in ["source.ts", "src/config/source.ts"] {
            envelope.source_file = source_file.to_owned();
            assert!(validate_envelope_metadata(&envelope, Path::new("fixture.json")).is_ok());
        }
    }

    #[test]
    fn digest_mismatch_reports_expected_and_actual_values() {
        let result = verify_fixture_digest(Path::new("fixture.json"), &Value::Null, "incorrect");
        if let Err(FixtureError::DigestMismatch {
            expected, actual, ..
        }) = &result
        {
            assert_eq!(expected, "incorrect");
            assert_ne!(actual, expected);
        }
        assert!(matches!(result, Err(FixtureError::DigestMismatch { .. })));
    }
}
