//! Bounded causal provenance queries.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use er_dev_types::{CausalEdgeKindV1, CausalEdgeV1, CausalGraphV1, CausalId, CausalNodeV1};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExplainDirectionV1 {
    Causes,
    Consequences,
    Both,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExplainQueryV1 {
    pub target: CausalId,
    pub direction: ExplainDirectionV1,
    pub maximum_nodes: usize,
    pub maximum_edges: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExplainReportV1 {
    pub target: CausalId,
    pub nodes: Vec<CausalNodeV1>,
    pub edges: Vec<CausalEdgeV1>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ExplainErrorV1 {
    #[error("causal graph is invalid: {0}")]
    Graph(String),
    #[error("explain query has a zero bound or unknown target")]
    Query,
}

pub fn explain_causal_graph(
    graph: &CausalGraphV1,
    query: &ExplainQueryV1,
) -> Result<ExplainReportV1, ExplainErrorV1> {
    graph
        .validate()
        .map_err(|error| ExplainErrorV1::Graph(error.to_string()))?;
    if query.maximum_nodes == 0 || query.maximum_edges == 0 {
        return Err(ExplainErrorV1::Query);
    }
    let node_map = graph
        .nodes
        .iter()
        .map(|node| (node.id.clone(), node))
        .collect::<BTreeMap<_, _>>();
    if !node_map.contains_key(&query.target) {
        return Err(ExplainErrorV1::Query);
    }
    let mut queue = VecDeque::from([query.target.clone()]);
    let mut visited = BTreeSet::new();
    let mut selected_edges = BTreeSet::new();
    let mut truncated = graph.truncated;
    while let Some(current) = queue.pop_front() {
        if visited.contains(&current) {
            continue;
        }
        if visited.len() == query.maximum_nodes {
            truncated = true;
            break;
        }
        visited.insert(current.clone());
        for (index, edge) in graph.edges.iter().enumerate() {
            let next = match query.direction {
                ExplainDirectionV1::Causes if edge.to == current => Some(&edge.from),
                ExplainDirectionV1::Consequences if edge.from == current => Some(&edge.to),
                ExplainDirectionV1::Both if edge.to == current => Some(&edge.from),
                ExplainDirectionV1::Both if edge.from == current => Some(&edge.to),
                _ => None,
            };
            if let Some(next) = next {
                if selected_edges.len() == query.maximum_edges {
                    truncated = true;
                    continue;
                }
                selected_edges.insert(index);
                if !visited.contains(next) {
                    queue.push_back(next.clone());
                }
            }
        }
    }
    let mut nodes = visited
        .into_iter()
        .filter_map(|id| node_map.get(&id).map(|node| (*node).clone()))
        .collect::<Vec<_>>();
    nodes.sort_by(|left, right| left.id.cmp(&right.id));
    let mut edges = selected_edges
        .into_iter()
        .filter_map(|index| graph.edges.get(index).cloned())
        .filter(|edge| {
            nodes.iter().any(|node| node.id == edge.from)
                && nodes.iter().any(|node| node.id == edge.to)
        })
        .collect::<Vec<_>>();
    edges.sort_by(|left, right| {
        (&left.from, &left.to, edge_kind_rank(left.edge_kind)).cmp(&(
            &right.from,
            &right.to,
            edge_kind_rank(right.edge_kind),
        ))
    });
    Ok(ExplainReportV1 {
        target: query.target.clone(),
        nodes,
        edges,
        truncated,
    })
}

fn edge_kind_rank(kind: CausalEdgeKindV1) -> u8 {
    match kind {
        CausalEdgeKindV1::Caused => 0,
        CausalEdgeKindV1::Derived => 1,
        CausalEdgeKindV1::Scheduled => 2,
        CausalEdgeKindV1::Applied => 3,
        CausalEdgeKindV1::Presented => 4,
        CausalEdgeKindV1::Installed => 5,
        CausalEdgeKindV1::Transmitted => 6,
        CausalEdgeKindV1::Settled => 7,
    }
}
