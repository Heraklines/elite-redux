//! Fixed cross-platform deterministic parity corpus and comparison.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DeterminismPlatformV1 {
    LinuxX64,
    LinuxArm64,
    WindowsX64,
    MacOsArm64,
    Wasm32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlatformEvidenceV1 {
    pub event_digests: Vec<String>,
    pub final_mechanical_digest: String,
    pub save_digest: Option<String>,
    pub resource_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CrossPlatformCaseV1 {
    pub id: String,
    pub capsule_digest: String,
    pub required_platforms: Vec<DeterminismPlatformV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CrossPlatformCorpusV1 {
    pub schema_version: u32,
    pub maximum_cases: usize,
    pub cases: Vec<CrossPlatformCaseV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlatformDivergenceV1 {
    pub platform: DeterminismPlatformV1,
    pub event: Option<usize>,
    pub field: String,
    pub expected: String,
    pub actual: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CrossPlatformReportV1 {
    pub case_id: String,
    pub identical: bool,
    pub divergences: Vec<PlatformDivergenceV1>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CrossPlatformErrorV1 {
    #[error("cross-platform corpus, evidence, order, or bound is invalid")]
    Invalid,
    #[error("required platform evidence is missing")]
    Missing,
}

impl CrossPlatformCorpusV1 {
    pub fn validate(&self) -> Result<(), CrossPlatformErrorV1> {
        if self.schema_version != 1
            || self.maximum_cases == 0
            || self.cases.is_empty()
            || self.cases.len() > self.maximum_cases
            || self.cases.windows(2).any(|pair| pair[0].id >= pair[1].id)
            || self.cases.iter().any(|case| {
                case.id.is_empty()
                    || case.capsule_digest.is_empty()
                    || case.required_platforms.len() < 2
                    || case
                        .required_platforms
                        .windows(2)
                        .any(|pair| pair[0] >= pair[1])
            })
        {
            return Err(CrossPlatformErrorV1::Invalid);
        }
        Ok(())
    }
}

pub fn compare_platform_evidence_v1(
    case: &CrossPlatformCaseV1,
    evidence: &BTreeMap<DeterminismPlatformV1, PlatformEvidenceV1>,
) -> Result<CrossPlatformReportV1, CrossPlatformErrorV1> {
    if case.id.is_empty()
        || case.required_platforms.len() < 2
        || case
            .required_platforms
            .windows(2)
            .any(|pair| pair[0] >= pair[1])
        || case
            .required_platforms
            .iter()
            .any(|platform| !evidence.contains_key(platform))
    {
        return Err(CrossPlatformErrorV1::Missing);
    }
    let baseline_platform = case.required_platforms[0];
    let baseline = evidence
        .get(&baseline_platform)
        .ok_or(CrossPlatformErrorV1::Missing)?;
    validate_evidence(baseline)?;
    let mut divergences = Vec::new();
    for platform in case.required_platforms.iter().copied().skip(1) {
        let actual = evidence
            .get(&platform)
            .ok_or(CrossPlatformErrorV1::Missing)?;
        validate_evidence(actual)?;
        if let Some(event) = first_event_divergence(&baseline.event_digests, &actual.event_digests)
        {
            divergences.push(PlatformDivergenceV1 {
                platform,
                event: Some(event),
                field: "event_digest".to_owned(),
                expected: baseline
                    .event_digests
                    .get(event)
                    .cloned()
                    .unwrap_or_default(),
                actual: actual.event_digests.get(event).cloned().unwrap_or_default(),
            });
            continue;
        }
        for (field, expected, found) in [
            (
                "mechanical",
                baseline.final_mechanical_digest.clone(),
                actual.final_mechanical_digest.clone(),
            ),
            (
                "save",
                baseline.save_digest.clone().unwrap_or_default(),
                actual.save_digest.clone().unwrap_or_default(),
            ),
            (
                "resources",
                baseline.resource_digest.clone(),
                actual.resource_digest.clone(),
            ),
        ] {
            if expected != found {
                divergences.push(PlatformDivergenceV1 {
                    platform,
                    event: None,
                    field: field.to_owned(),
                    expected,
                    actual: found,
                });
                break;
            }
        }
    }
    Ok(CrossPlatformReportV1 {
        case_id: case.id.clone(),
        identical: divergences.is_empty(),
        divergences,
    })
}

fn validate_evidence(evidence: &PlatformEvidenceV1) -> Result<(), CrossPlatformErrorV1> {
    if evidence.event_digests.iter().any(String::is_empty)
        || evidence.final_mechanical_digest.is_empty()
        || evidence.resource_digest.is_empty()
        || evidence.save_digest.as_ref().is_some_and(String::is_empty)
    {
        Err(CrossPlatformErrorV1::Invalid)
    } else {
        Ok(())
    }
}

fn first_event_divergence(expected: &[String], actual: &[String]) -> Option<usize> {
    expected
        .iter()
        .zip(actual)
        .position(|(expected, actual)| expected != actual)
        .or_else(|| (expected.len() != actual.len()).then_some(expected.len().min(actual.len())))
}
