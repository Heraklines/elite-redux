//! Deterministic semantic-group incremental content compilation.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SemanticGroupIdV1(pub String);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContentFragmentV1 {
    pub group: SemanticGroupIdV1,
    pub source_digest: String,
    pub compiled_digest: String,
    pub compiled_bytes: Vec<u8>,
    pub dependencies: Vec<SemanticGroupIdV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IncrementalCompilePlanV1 {
    pub current_identity: String,
    pub changed_source_digests: BTreeMap<SemanticGroupIdV1, String>,
    pub maximum_groups: usize,
    pub maximum_fragment_bytes: usize,
    pub maximum_total_bytes: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IncrementalCompileReportV1 {
    pub rebuilt_groups: Vec<SemanticGroupIdV1>,
    pub reused_groups: Vec<SemanticGroupIdV1>,
    pub candidate_identity: String,
    pub total_compiled_bytes: usize,
    pub deterministic_checksum: String,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum IncrementalCompileErrorV1 {
    #[error("content compile plan, graph, digest, or bound is invalid")]
    Invalid,
    #[error("content dependency graph contains a cycle or missing group")]
    Graph,
    #[error("content compiler backend failed: {0}")]
    Backend(String),
    #[error("content candidate encoding failed: {0}")]
    Canonical(String),
}

pub trait IncrementalContentBackendV1: std::fmt::Debug {
    fn compile_group(
        &self,
        group: &SemanticGroupIdV1,
        source_digest: &str,
        dependencies: &[ContentFragmentV1],
    ) -> Result<ContentFragmentV1, String>;
    fn assemble_and_validate(&self, fragments: &[ContentFragmentV1]) -> Result<String, String>;
}

pub fn compile_incremental_content_v1<B: IncrementalContentBackendV1>(
    current: &[ContentFragmentV1],
    plan: &IncrementalCompilePlanV1,
    backend: &B,
) -> Result<(Vec<ContentFragmentV1>, IncrementalCompileReportV1), IncrementalCompileErrorV1> {
    validate_fragments(current, plan)?;
    let current_map = current
        .iter()
        .map(|fragment| (fragment.group.clone(), fragment.clone()))
        .collect::<BTreeMap<_, _>>();
    if plan.changed_source_digests.is_empty()
        || plan.changed_source_digests.iter().any(|(group, digest)| {
            group.0.is_empty() || digest.is_empty() || !current_map.contains_key(group)
        })
    {
        return Err(IncrementalCompileErrorV1::Invalid);
    }
    let mut rebuild = plan
        .changed_source_digests
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut queue = VecDeque::from_iter(rebuild.iter().cloned());
    while let Some(changed) = queue.pop_front() {
        for fragment in current {
            if fragment.dependencies.contains(&changed) && rebuild.insert(fragment.group.clone()) {
                queue.push_back(fragment.group.clone());
            }
        }
    }
    let order = topological_order(current)?;
    let mut candidate = BTreeMap::<SemanticGroupIdV1, ContentFragmentV1>::new();
    for group in order {
        let current_fragment = current_map
            .get(&group)
            .ok_or(IncrementalCompileErrorV1::Graph)?;
        if rebuild.contains(&group) {
            let source_digest = plan
                .changed_source_digests
                .get(&group)
                .unwrap_or(&current_fragment.source_digest);
            let dependencies = current_fragment
                .dependencies
                .iter()
                .map(|dependency| {
                    candidate
                        .get(dependency)
                        .cloned()
                        .ok_or(IncrementalCompileErrorV1::Graph)
                })
                .collect::<Result<Vec<_>, _>>()?;
            let fragment = backend
                .compile_group(&group, source_digest, &dependencies)
                .map_err(IncrementalCompileErrorV1::Backend)?;
            candidate.insert(group, fragment);
        } else {
            candidate.insert(group, current_fragment.clone());
        }
    }
    let mut fragments = candidate.into_values().collect::<Vec<_>>();
    fragments.sort_by(|left, right| left.group.cmp(&right.group));
    validate_fragments(&fragments, plan)?;
    let candidate_identity = backend
        .assemble_and_validate(&fragments)
        .map_err(IncrementalCompileErrorV1::Backend)?;
    if candidate_identity.is_empty() || candidate_identity == plan.current_identity {
        return Err(IncrementalCompileErrorV1::Invalid);
    }
    let total_compiled_bytes = fragments
        .iter()
        .map(|fragment| fragment.compiled_bytes.len())
        .sum();
    let bytes = er_canonical::canonical_bytes(&fragments)
        .map_err(|error| IncrementalCompileErrorV1::Canonical(error.to_string()))?;
    let rebuilt_groups = rebuild.iter().cloned().collect::<Vec<_>>();
    let reused_groups = current
        .iter()
        .filter(|fragment| !rebuild.contains(&fragment.group))
        .map(|fragment| fragment.group.clone())
        .collect();
    Ok((
        fragments,
        IncrementalCompileReportV1 {
            rebuilt_groups,
            reused_groups,
            candidate_identity,
            total_compiled_bytes,
            deterministic_checksum: format!("blake3-v1:{}", blake3::hash(&bytes).to_hex()),
        },
    ))
}

fn validate_fragments(
    fragments: &[ContentFragmentV1],
    plan: &IncrementalCompilePlanV1,
) -> Result<(), IncrementalCompileErrorV1> {
    if plan.current_identity.is_empty()
        || plan.maximum_groups == 0
        || plan.maximum_fragment_bytes == 0
        || plan.maximum_total_bytes == 0
        || fragments.is_empty()
        || fragments.len() > plan.maximum_groups
        || fragments
            .windows(2)
            .any(|pair| pair[0].group >= pair[1].group)
    {
        return Err(IncrementalCompileErrorV1::Invalid);
    }
    let groups = fragments
        .iter()
        .map(|fragment| &fragment.group)
        .collect::<BTreeSet<_>>();
    let total = fragments.iter().try_fold(0_usize, |total, fragment| {
        if fragment.group.0.is_empty()
            || fragment.source_digest.is_empty()
            || fragment.compiled_digest.is_empty()
            || fragment.compiled_bytes.is_empty()
            || fragment.compiled_bytes.len() > plan.maximum_fragment_bytes
            || fragment
                .dependencies
                .windows(2)
                .any(|pair| pair[0] >= pair[1])
            || fragment
                .dependencies
                .iter()
                .any(|dependency| !groups.contains(dependency))
            || format!(
                "blake3-v1:{}",
                blake3::hash(&fragment.compiled_bytes).to_hex()
            ) != fragment.compiled_digest
        {
            return None;
        }
        total.checked_add(fragment.compiled_bytes.len())
    });
    if total.is_none_or(|total| total > plan.maximum_total_bytes) {
        return Err(IncrementalCompileErrorV1::Invalid);
    }
    topological_order(fragments)?;
    Ok(())
}

fn topological_order(
    fragments: &[ContentFragmentV1],
) -> Result<Vec<SemanticGroupIdV1>, IncrementalCompileErrorV1> {
    let mut remaining = fragments
        .iter()
        .map(|fragment| {
            (
                fragment.group.clone(),
                fragment
                    .dependencies
                    .iter()
                    .cloned()
                    .collect::<BTreeSet<_>>(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let mut order = Vec::with_capacity(fragments.len());
    while !remaining.is_empty() {
        let ready = remaining
            .iter()
            .filter_map(|(group, dependencies)| dependencies.is_empty().then_some(group.clone()))
            .collect::<Vec<_>>();
        if ready.is_empty() {
            return Err(IncrementalCompileErrorV1::Graph);
        }
        for group in ready {
            remaining.remove(&group);
            for dependencies in remaining.values_mut() {
                dependencies.remove(&group);
            }
            order.push(group);
        }
    }
    Ok(order)
}
