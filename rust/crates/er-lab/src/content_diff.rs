//! Semantic-group content diff and affected-closure graph.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::incremental::{ContentFragmentV1, SemanticGroupIdV1};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum ContentGroupChangeV1 {
    Added { group: SemanticGroupIdV1 },
    Removed { group: SemanticGroupIdV1 },
    SourceChanged { group: SemanticGroupIdV1 },
    CompiledChanged { group: SemanticGroupIdV1 },
    DependenciesChanged { group: SemanticGroupIdV1 },
}

impl ContentGroupChangeV1 {
    pub fn group(&self) -> &SemanticGroupIdV1 {
        match self {
            Self::Added { group }
            | Self::Removed { group }
            | Self::SourceChanged { group }
            | Self::CompiledChanged { group }
            | Self::DependenciesChanged { group } => group,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContentDiffReportV1 {
    pub current_identity: String,
    pub candidate_identity: String,
    pub changes: Vec<ContentGroupChangeV1>,
    pub affected_groups: Vec<SemanticGroupIdV1>,
    pub deterministic_checksum: String,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ContentDiffErrorV1 {
    #[error("content diff identity, ordering, or bound is invalid")]
    Invalid,
    #[error("content diff encoding failed: {0}")]
    Canonical(String),
}

pub fn diff_content_v1(
    current_identity: String,
    current: &[ContentFragmentV1],
    candidate_identity: String,
    candidate: &[ContentFragmentV1],
    maximum_groups: usize,
) -> Result<ContentDiffReportV1, ContentDiffErrorV1> {
    if current_identity.is_empty()
        || candidate_identity.is_empty()
        || current_identity == candidate_identity
        || maximum_groups == 0
        || current.len() > maximum_groups
        || candidate.len() > maximum_groups
        || current
            .windows(2)
            .any(|pair| pair[0].group >= pair[1].group)
        || candidate
            .windows(2)
            .any(|pair| pair[0].group >= pair[1].group)
    {
        return Err(ContentDiffErrorV1::Invalid);
    }
    let current_map = current
        .iter()
        .map(|fragment| (&fragment.group, fragment))
        .collect::<BTreeMap<_, _>>();
    let candidate_map = candidate
        .iter()
        .map(|fragment| (&fragment.group, fragment))
        .collect::<BTreeMap<_, _>>();
    let groups = current_map
        .keys()
        .chain(candidate_map.keys())
        .map(|group| (*group).clone())
        .collect::<BTreeSet<_>>();
    let mut changes = Vec::new();
    for group in groups {
        match (current_map.get(&group), candidate_map.get(&group)) {
            (None, Some(_)) => changes.push(ContentGroupChangeV1::Added { group }),
            (Some(_), None) => changes.push(ContentGroupChangeV1::Removed { group }),
            (Some(left), Some(right)) => {
                if left.source_digest != right.source_digest {
                    changes.push(ContentGroupChangeV1::SourceChanged {
                        group: group.clone(),
                    });
                }
                if left.compiled_digest != right.compiled_digest {
                    changes.push(ContentGroupChangeV1::CompiledChanged {
                        group: group.clone(),
                    });
                }
                if left.dependencies != right.dependencies {
                    changes.push(ContentGroupChangeV1::DependenciesChanged { group });
                }
            }
            (None, None) => return Err(ContentDiffErrorV1::Invalid),
        }
    }
    changes.sort_by(|left, right| {
        left.group()
            .cmp(right.group())
            .then_with(|| change_rank(left).cmp(&change_rank(right)))
    });
    let mut affected = changes
        .iter()
        .map(|change| change.group().clone())
        .collect::<BTreeSet<_>>();
    let mut queue = VecDeque::from_iter(affected.iter().cloned());
    while let Some(group) = queue.pop_front() {
        for fragment in current.iter().chain(candidate) {
            if fragment.dependencies.contains(&group) && affected.insert(fragment.group.clone()) {
                queue.push_back(fragment.group.clone());
            }
        }
    }
    let affected_groups = affected.into_iter().collect::<Vec<_>>();
    let bytes = er_canonical::canonical_bytes(&(&changes, &affected_groups))
        .map_err(|error| ContentDiffErrorV1::Canonical(error.to_string()))?;
    Ok(ContentDiffReportV1 {
        current_identity,
        candidate_identity,
        changes,
        affected_groups,
        deterministic_checksum: format!("blake3-v1:{}", blake3::hash(&bytes).to_hex()),
    })
}

fn change_rank(change: &ContentGroupChangeV1) -> u8 {
    match change {
        ContentGroupChangeV1::Added { .. } => 0,
        ContentGroupChangeV1::Removed { .. } => 1,
        ContentGroupChangeV1::SourceChanged { .. } => 2,
        ContentGroupChangeV1::CompiledChanged { .. } => 3,
        ContentGroupChangeV1::DependenciesChanged { .. } => 4,
    }
}
