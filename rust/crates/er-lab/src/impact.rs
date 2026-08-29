//! M7.2 scenario, preset, capsule, experiment, and mutation impact integration.

use er_impact::{
    ImpactGraphErrorV1, ImpactGraphV1, ImpactQueryErrorV1, ImpactQueryResultV1, ImpactRecordV1,
    SourceChangeV1, generate_impact_graph_v1, query_affected_tests_v1,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LabImpactEntryV1 {
    pub source_path: String,
    pub source_symbol: Option<String>,
    pub catalog_identity: Option<String>,
    pub behavior: String,
    pub semantic_group: String,
    pub rust_symbol: String,
    pub proof_targets: Vec<String>,
    pub presets: Vec<String>,
    pub capsules: Vec<String>,
    pub experiments: Vec<String>,
    pub benchmarks: Vec<String>,
}

pub fn generate_lab_impact_graph_v1(
    entries: &[LabImpactEntryV1],
    central_source_prefixes: Vec<String>,
    global_gates: Vec<String>,
    maximum_nodes: usize,
    maximum_edges: usize,
) -> Result<ImpactGraphV1, ImpactGraphErrorV1> {
    let records = entries
        .iter()
        .map(|entry| ImpactRecordV1 {
            source_path: entry.source_path.clone(),
            source_symbol: entry.source_symbol.clone(),
            catalog_identity: entry.catalog_identity.clone(),
            behavior: entry.behavior.clone(),
            semantic_group: entry.semantic_group.clone(),
            rust_symbol: entry.rust_symbol.clone(),
            proof_tests: entry.proof_targets.clone(),
            fixtures: entry.presets.clone(),
            capsules: entry.capsules.clone(),
            campaigns: entry.experiments.clone(),
            benchmarks: entry.benchmarks.clone(),
        })
        .collect::<Vec<_>>();
    generate_impact_graph_v1(
        &records,
        central_source_prefixes,
        global_gates,
        maximum_nodes,
        maximum_edges,
    )
}

pub fn query_lab_impact_v1(
    graph: &ImpactGraphV1,
    changes: &[SourceChangeV1],
    maximum_visited_nodes: usize,
) -> Result<ImpactQueryResultV1, ImpactQueryErrorV1> {
    query_affected_tests_v1(graph, changes, maximum_visited_nodes)
}
