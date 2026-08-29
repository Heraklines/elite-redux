//! Conservative affected-test selection over the frozen impact graph.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    AffectedTestReportV1,
    generate::{ImpactGraphErrorV1, ImpactGraphV1, ImpactNodeIdV1, ImpactNodeKindV1},
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceChangeV1 {
    pub path: String,
    pub symbol: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImpactQueryResultV1 {
    pub report: AffectedTestReportV1,
    pub global_escalation: bool,
    pub unknown_changes: Vec<SourceChangeV1>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ImpactQueryErrorV1 {
    #[error("impact graph is invalid: {0}")]
    Graph(String),
    #[error("impact query bound is zero or exceeded")]
    Bounds,
    #[error("impact query contains an empty source path")]
    Change,
}

pub fn query_affected_tests_v1(
    graph: &ImpactGraphV1,
    changes: &[SourceChangeV1],
    maximum_visited_nodes: usize,
) -> Result<ImpactQueryResultV1, ImpactQueryErrorV1> {
    graph.validate().map_err(map_graph_error)?;
    if maximum_visited_nodes == 0 || changes.len() > maximum_visited_nodes {
        return Err(ImpactQueryErrorV1::Bounds);
    }
    if changes.iter().any(|change| {
        change.path.is_empty() || change.symbol.as_ref().is_some_and(String::is_empty)
    }) {
        return Err(ImpactQueryErrorV1::Change);
    }
    let nodes = graph
        .nodes
        .iter()
        .map(|node| (&node.id, node))
        .collect::<BTreeMap<_, _>>();
    let outgoing = graph.edges.iter().fold(
        BTreeMap::<&ImpactNodeIdV1, Vec<&ImpactNodeIdV1>>::new(),
        |mut map, edge| {
            map.entry(&edge.from).or_default().push(&edge.to);
            map
        },
    );
    let mut queue = VecDeque::new();
    let mut unknown_changes = Vec::new();
    let mut global_escalation = false;
    for change in changes {
        if graph
            .central_source_prefixes
            .iter()
            .any(|prefix| change.path.starts_with(prefix))
        {
            global_escalation = true;
        }
        let path_nodes = graph
            .nodes
            .iter()
            .filter(|node| node.kind == ImpactNodeKindV1::SourcePath && node.label == change.path);
        let mut matched = false;
        for path_node in path_nodes {
            if let Some(symbol) = &change.symbol {
                let matching_symbol = outgoing
                    .get(&path_node.id)
                    .into_iter()
                    .flatten()
                    .filter_map(|id| nodes.get(id).copied())
                    .find(|node| {
                        node.kind == ImpactNodeKindV1::SourceSymbol && node.label == *symbol
                    });
                if let Some(node) = matching_symbol {
                    queue.push_back(node.id.clone());
                    matched = true;
                }
            } else {
                queue.push_back(path_node.id.clone());
                matched = true;
            }
        }
        if !matched {
            unknown_changes.push(change.clone());
            global_escalation = true;
        }
    }
    unknown_changes
        .sort_by(|left, right| (&left.path, &left.symbol).cmp(&(&right.path, &right.symbol)));
    unknown_changes.dedup();

    let mut visited = BTreeSet::new();
    let mut tests = BTreeSet::new();
    let mut behaviors = BTreeSet::new();
    let mut capsules = BTreeSet::new();
    let mut benchmarks = BTreeSet::new();
    let mut fixtures_campaigns = BTreeSet::new();
    while let Some(id) = queue.pop_front() {
        if visited.contains(&id) {
            continue;
        }
        if visited.len() == maximum_visited_nodes {
            global_escalation = true;
            break;
        }
        visited.insert(id.clone());
        if let Some(node) = nodes.get(&id) {
            match node.kind {
                ImpactNodeKindV1::Behavior | ImpactNodeKindV1::SemanticGroup => {
                    behaviors.insert(node.label.clone());
                }
                ImpactNodeKindV1::ProofTest => {
                    tests.insert(node.label.clone());
                }
                ImpactNodeKindV1::Capsule => {
                    capsules.insert(node.label.clone());
                }
                ImpactNodeKindV1::Benchmark => {
                    benchmarks.insert(node.label.clone());
                }
                ImpactNodeKindV1::Fixture | ImpactNodeKindV1::Campaign => {
                    fixtures_campaigns.insert(node.label.clone());
                }
                _ => {}
            }
        }
        if let Some(next) = outgoing.get(&id) {
            queue.extend(next.iter().map(|id| (*id).clone()));
        }
    }
    let mandatory_commands = if global_escalation {
        graph.global_gate_commands.clone()
    } else {
        tests.iter().cloned().collect()
    };
    Ok(ImpactQueryResultV1 {
        report: AffectedTestReportV1 {
            mandatory_commands,
            focused_commands: tests.into_iter().collect(),
            broader_commands: fixtures_campaigns.into_iter().collect(),
            affected_behaviors: behaviors.into_iter().collect(),
            affected_capsules: capsules.into_iter().collect(),
            affected_benchmarks: benchmarks.into_iter().collect(),
        },
        global_escalation,
        unknown_changes,
    })
}

fn map_graph_error(error: ImpactGraphErrorV1) -> ImpactQueryErrorV1 {
    ImpactQueryErrorV1::Graph(error.to_string())
}
