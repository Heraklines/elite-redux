//! Shared fail-closed limits for untrusted laboratory artifacts and execution requests.

use std::path::{Component, Path};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::bisect::{GitRevisionV1, HermeticBuildIdentityV1};
use crate::mutation::ProofTargetV1;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UntrustedInputLimitsV1 {
    pub maximum_bytes: usize,
    pub maximum_items: usize,
    pub maximum_depth: usize,
    pub maximum_events: usize,
    pub maximum_decompressed_bytes: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum HermeticExecutionV1 {
    CargoBuild {
        revision: GitRevisionV1,
        build: HermeticBuildIdentityV1,
    },
    CargoTest {
        revision: GitRevisionV1,
        build: HermeticBuildIdentityV1,
        target: ProofTargetV1,
    },
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum LabSecurityErrorV1 {
    #[error("security limit is zero or aggregate quota overflows")]
    Bounds,
    #[error("path is absolute, traversing, malformed, or outside its root")]
    Path,
    #[error("digest or hermetic execution identity is invalid")]
    Identity,
}

impl UntrustedInputLimitsV1 {
    pub fn validate(self) -> Result<(), LabSecurityErrorV1> {
        if self.maximum_bytes == 0
            || self.maximum_items == 0
            || self.maximum_depth == 0
            || self.maximum_events == 0
            || self.maximum_decompressed_bytes == 0
        {
            Err(LabSecurityErrorV1::Bounds)
        } else {
            Ok(())
        }
    }

    pub fn reserve(
        self,
        retained_bytes: usize,
        retained_items: usize,
        new_bytes: usize,
        new_items: usize,
    ) -> Result<(usize, usize), LabSecurityErrorV1> {
        self.validate()?;
        let bytes = retained_bytes
            .checked_add(new_bytes)
            .ok_or(LabSecurityErrorV1::Bounds)?;
        let items = retained_items
            .checked_add(new_items)
            .ok_or(LabSecurityErrorV1::Bounds)?;
        if bytes > self.maximum_bytes || items > self.maximum_items {
            Err(LabSecurityErrorV1::Bounds)
        } else {
            Ok((bytes, items))
        }
    }
}

pub fn validate_registry_path_v1(value: &str) -> Result<(), LabSecurityErrorV1> {
    if value.is_empty()
        || value.len() > 4096
        || value.contains('\\')
        || Path::new(value).is_absolute()
        || Path::new(value)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        Err(LabSecurityErrorV1::Path)
    } else {
        Ok(())
    }
}

pub fn validate_content_digest_v1(value: &str) -> Result<(), LabSecurityErrorV1> {
    let Some(hex) = value.strip_prefix("blake3-v1:") else {
        return Err(LabSecurityErrorV1::Identity);
    };
    if hex.len() == 64
        && hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(LabSecurityErrorV1::Identity)
    }
}

pub fn validate_hermetic_execution_v1(
    request: &HermeticExecutionV1,
) -> Result<(), LabSecurityErrorV1> {
    let (revision, build, target) = match request {
        HermeticExecutionV1::CargoBuild { revision, build } => (revision, build, None),
        HermeticExecutionV1::CargoTest {
            revision,
            build,
            target,
        } => (revision, build, Some(target)),
    };
    let revision_valid = revision.0.len() == 40
        && revision
            .0
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    let fields = [
        &build.toolchain,
        &build.cargo_lock_digest,
        &build.target,
        &build.profile,
        &build.feature_digest,
        &build.environment_digest,
    ];
    let safe_target = target.is_none_or(|target| {
        [&target.package, &target.test_target]
            .into_iter()
            .chain(target.test_name.iter())
            .all(|value| {
                !value.is_empty()
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            })
    });
    if revision_valid
        && fields
            .iter()
            .all(|value| !value.is_empty() && value.as_str() != "UNKNOWN")
        && safe_target
    {
        Ok(())
    } else {
        Err(LabSecurityErrorV1::Identity)
    }
}
