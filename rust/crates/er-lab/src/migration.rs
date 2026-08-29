//! Explicit schema migration followed by exact deterministic replay verification.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use er_dev_types::ExternalTraceInputV7;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SnapshotMigrationEdgeV1 {
    pub from_schema: u32,
    pub to_schema: u32,
    pub migration_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionMigrationPlanV1 {
    pub from_schema: u32,
    pub to_schema: u32,
    pub snapshot_bytes: Vec<u8>,
    pub trace: Vec<ExternalTraceInputV7>,
    pub expected_digests: Vec<String>,
    pub edges: Vec<SnapshotMigrationEdgeV1>,
    pub maximum_snapshot_bytes: usize,
    pub maximum_trace_events: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionMigrationReportV1 {
    pub migration_path: Vec<String>,
    pub migrated_snapshot_digest: String,
    pub replayed_events: usize,
    pub compatible: bool,
    pub first_divergent_event: Option<usize>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SessionMigrationErrorV1 {
    #[error("migration plan, graph, snapshot, trace, or bound is invalid")]
    Invalid,
    #[error("no supported migration path exists")]
    NoPath,
    #[error("migration backend failed: {0}")]
    Backend(String),
}

pub trait SessionMigrationBackendV1: std::fmt::Debug {
    fn migrate_step(
        &self,
        migration_id: &str,
        snapshot: &[u8],
        maximum_bytes: usize,
    ) -> Result<Vec<u8>, String>;
    fn replay(
        &self,
        snapshot: &[u8],
        trace: &[ExternalTraceInputV7],
    ) -> Result<Vec<String>, String>;
}

pub fn migrate_and_replay_v1<B: SessionMigrationBackendV1>(
    plan: &SessionMigrationPlanV1,
    backend: &B,
) -> Result<SessionMigrationReportV1, SessionMigrationErrorV1> {
    validate_plan(plan)?;
    let path = migration_path(plan)?;
    let mut snapshot = plan.snapshot_bytes.clone();
    for edge in &path {
        snapshot = backend
            .migrate_step(&edge.migration_id, &snapshot, plan.maximum_snapshot_bytes)
            .map_err(SessionMigrationErrorV1::Backend)?;
        if snapshot.is_empty() || snapshot.len() > plan.maximum_snapshot_bytes {
            return Err(SessionMigrationErrorV1::Invalid);
        }
    }
    let actual = backend
        .replay(&snapshot, &plan.trace)
        .map_err(SessionMigrationErrorV1::Backend)?;
    let first_divergent_event = plan
        .expected_digests
        .iter()
        .zip(&actual)
        .position(|(expected, actual)| expected != actual)
        .or_else(|| {
            (plan.expected_digests.len() != actual.len())
                .then_some(actual.len().min(plan.expected_digests.len()))
        });
    Ok(SessionMigrationReportV1 {
        migration_path: path.iter().map(|edge| edge.migration_id.clone()).collect(),
        migrated_snapshot_digest: format!("blake3-v1:{}", blake3::hash(&snapshot).to_hex()),
        replayed_events: actual.len(),
        compatible: first_divergent_event.is_none(),
        first_divergent_event,
    })
}

fn validate_plan(plan: &SessionMigrationPlanV1) -> Result<(), SessionMigrationErrorV1> {
    if plan.from_schema == 0
        || plan.to_schema == 0
        || plan.from_schema == plan.to_schema
        || plan.snapshot_bytes.is_empty()
        || plan.maximum_snapshot_bytes == 0
        || plan.maximum_trace_events == 0
        || plan.snapshot_bytes.len() > plan.maximum_snapshot_bytes
        || plan.trace.len() > plan.maximum_trace_events
        || plan.expected_digests.len() != plan.trace.len()
        || plan.expected_digests.iter().any(String::is_empty)
        || plan.edges.iter().any(|edge| {
            edge.from_schema == 0
                || edge.to_schema == 0
                || edge.from_schema == edge.to_schema
                || edge.migration_id.is_empty()
        })
    {
        return Err(SessionMigrationErrorV1::Invalid);
    }
    let unique = plan
        .edges
        .iter()
        .map(|edge| (edge.from_schema, edge.to_schema))
        .collect::<BTreeSet<_>>();
    if unique.len() != plan.edges.len() {
        return Err(SessionMigrationErrorV1::Invalid);
    }
    Ok(())
}

fn migration_path(
    plan: &SessionMigrationPlanV1,
) -> Result<Vec<SnapshotMigrationEdgeV1>, SessionMigrationErrorV1> {
    let outgoing = plan.edges.iter().fold(
        BTreeMap::<u32, Vec<&SnapshotMigrationEdgeV1>>::new(),
        |mut map, edge| {
            map.entry(edge.from_schema).or_default().push(edge);
            map
        },
    );
    let mut queue = VecDeque::from([plan.from_schema]);
    let mut parent = BTreeMap::<u32, (u32, SnapshotMigrationEdgeV1)>::new();
    parent.insert(
        plan.from_schema,
        (
            plan.from_schema,
            SnapshotMigrationEdgeV1 {
                from_schema: plan.from_schema,
                to_schema: plan.from_schema,
                migration_id: String::new(),
            },
        ),
    );
    while let Some(schema) = queue.pop_front() {
        if schema == plan.to_schema {
            break;
        }
        let mut edges = outgoing.get(&schema).cloned().unwrap_or_default();
        edges.sort_by(|left, right| {
            (left.to_schema, &left.migration_id).cmp(&(right.to_schema, &right.migration_id))
        });
        for edge in edges {
            if let std::collections::btree_map::Entry::Vacant(entry) = parent.entry(edge.to_schema)
            {
                entry.insert((schema, edge.clone()));
                queue.push_back(edge.to_schema);
            }
        }
    }
    if !parent.contains_key(&plan.to_schema) {
        return Err(SessionMigrationErrorV1::NoPath);
    }
    let mut reversed = Vec::new();
    let mut schema = plan.to_schema;
    while schema != plan.from_schema {
        let (previous, edge) = parent
            .get(&schema)
            .cloned()
            .ok_or(SessionMigrationErrorV1::NoPath)?;
        reversed.push(edge);
        schema = previous;
    }
    reversed.reverse();
    Ok(reversed)
}
