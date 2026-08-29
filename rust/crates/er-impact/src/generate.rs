//! Deterministic source-to-proof impact graph generation.

use std::collections::{BTreeMap, BTreeSet};

use er_canonical::canonical_bytes;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ImpactNodeKindV1 {
    SourcePath,
    SourceSymbol,
    CatalogIdentity,
    Behavior,
    SemanticGroup,
    RustSymbol,
    ProofTest,
    Fixture,
    Capsule,
    Campaign,
    Benchmark,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ImpactNodeIdV1(pub String);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImpactNodeV1 {
    pub id: ImpactNodeIdV1,
    pub kind: ImpactNodeKindV1,
    pub label: String,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImpactEdgeV1 {
    pub from: ImpactNodeIdV1,
    pub to: ImpactNodeIdV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImpactGraphV1 {
    pub schema_version: u32,
    pub maximum_nodes: usize,
    pub maximum_edges: usize,
    pub nodes: Vec<ImpactNodeV1>,
    pub edges: Vec<ImpactEdgeV1>,
    pub central_source_prefixes: Vec<String>,
    pub global_gate_commands: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImpactRecordV1 {
    pub source_path: String,
    pub source_symbol: Option<String>,
    pub catalog_identity: Option<String>,
    pub behavior: String,
    pub semantic_group: String,
    pub rust_symbol: String,
    pub proof_tests: Vec<String>,
    pub fixtures: Vec<String>,
    pub capsules: Vec<String>,
    pub campaigns: Vec<String>,
    pub benchmarks: Vec<String>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ImpactGraphErrorV1 {
    #[error("impact graph bound is zero or exceeded")]
    Bounds,
    #[error("impact input contains an empty or duplicated identity")]
    Identity,
    #[error("impact graph contains a dangling or cyclic edge")]
    Graph,
    #[error("impact identity encoding failed: {0}")]
    Canonical(String),
}

pub fn generate_impact_graph_v1(
    records: &[ImpactRecordV1],
    mut central_source_prefixes: Vec<String>,
    mut global_gate_commands: Vec<String>,
    maximum_nodes: usize,
    maximum_edges: usize,
) -> Result<ImpactGraphV1, ImpactGraphErrorV1> {
    if maximum_nodes == 0 || maximum_edges == 0 {
        return Err(ImpactGraphErrorV1::Bounds);
    }
    normalize_strings(&mut central_source_prefixes)?;
    normalize_strings(&mut global_gate_commands)?;
    let mut nodes = BTreeMap::<ImpactNodeIdV1, ImpactNodeV1>::new();
    let mut edges = BTreeSet::<ImpactEdgeV1>::new();
    for record in records {
        if record.source_path.is_empty()
            || record.behavior.is_empty()
            || record.semantic_group.is_empty()
            || record.rust_symbol.is_empty()
            || record.proof_tests.is_empty()
        {
            return Err(ImpactGraphErrorV1::Identity);
        }
        let source_path = insert_node(
            &mut nodes,
            ImpactNodeKindV1::SourcePath,
            &record.source_path,
        )?;
        let mut frontier = source_path;
        if let Some(symbol) = &record.source_symbol {
            let next = insert_node(&mut nodes, ImpactNodeKindV1::SourceSymbol, symbol)?;
            edges.insert(ImpactEdgeV1 {
                from: frontier,
                to: next.clone(),
            });
            frontier = next;
        }
        if let Some(catalog) = &record.catalog_identity {
            let next = insert_node(&mut nodes, ImpactNodeKindV1::CatalogIdentity, catalog)?;
            edges.insert(ImpactEdgeV1 {
                from: frontier,
                to: next.clone(),
            });
            frontier = next;
        }
        let behavior = insert_node(&mut nodes, ImpactNodeKindV1::Behavior, &record.behavior)?;
        edges.insert(ImpactEdgeV1 {
            from: frontier,
            to: behavior.clone(),
        });
        let group = insert_node(
            &mut nodes,
            ImpactNodeKindV1::SemanticGroup,
            &record.semantic_group,
        )?;
        edges.insert(ImpactEdgeV1 {
            from: behavior,
            to: group.clone(),
        });
        let rust = insert_node(
            &mut nodes,
            ImpactNodeKindV1::RustSymbol,
            &record.rust_symbol,
        )?;
        edges.insert(ImpactEdgeV1 {
            from: group.clone(),
            to: rust.clone(),
        });
        add_outputs(
            &mut nodes,
            &mut edges,
            &rust,
            ImpactNodeKindV1::ProofTest,
            &record.proof_tests,
        )?;
        add_outputs(
            &mut nodes,
            &mut edges,
            &group,
            ImpactNodeKindV1::Fixture,
            &record.fixtures,
        )?;
        add_outputs(
            &mut nodes,
            &mut edges,
            &group,
            ImpactNodeKindV1::Capsule,
            &record.capsules,
        )?;
        add_outputs(
            &mut nodes,
            &mut edges,
            &group,
            ImpactNodeKindV1::Campaign,
            &record.campaigns,
        )?;
        add_outputs(
            &mut nodes,
            &mut edges,
            &group,
            ImpactNodeKindV1::Benchmark,
            &record.benchmarks,
        )?;
        if nodes.len() > maximum_nodes || edges.len() > maximum_edges {
            return Err(ImpactGraphErrorV1::Bounds);
        }
    }
    let value = ImpactGraphV1 {
        schema_version: 1,
        maximum_nodes,
        maximum_edges,
        nodes: nodes.into_values().collect(),
        edges: edges.into_iter().collect(),
        central_source_prefixes,
        global_gate_commands,
    };
    value.validate()?;
    Ok(value)
}

impl ImpactGraphV1 {
    pub fn validate(&self) -> Result<(), ImpactGraphErrorV1> {
        if self.schema_version != 1
            || self.maximum_nodes == 0
            || self.maximum_edges == 0
            || self.nodes.len() > self.maximum_nodes
            || self.edges.len() > self.maximum_edges
            || self.nodes.iter().any(|node| node.label.is_empty())
            || self.nodes.windows(2).any(|pair| pair[0].id >= pair[1].id)
            || self.edges.windows(2).any(|pair| pair[0] >= pair[1])
            || self.central_source_prefixes.iter().any(String::is_empty)
            || self.global_gate_commands.iter().any(String::is_empty)
        {
            return Err(ImpactGraphErrorV1::Bounds);
        }
        let ids = self
            .nodes
            .iter()
            .map(|node| &node.id)
            .collect::<BTreeSet<_>>();
        if ids.len() != self.nodes.len()
            || self.edges.iter().any(|edge| {
                !ids.contains(&edge.from) || !ids.contains(&edge.to) || edge.from == edge.to
            })
        {
            return Err(ImpactGraphErrorV1::Graph);
        }
        let mut indegree = self
            .nodes
            .iter()
            .map(|node| (node.id.clone(), 0_usize))
            .collect::<BTreeMap<_, _>>();
        for edge in &self.edges {
            let degree = indegree
                .get_mut(&edge.to)
                .ok_or(ImpactGraphErrorV1::Graph)?;
            *degree = degree.checked_add(1).ok_or(ImpactGraphErrorV1::Bounds)?;
        }
        let mut frontier = indegree
            .iter()
            .filter_map(|(id, degree)| (*degree == 0).then_some(id.clone()))
            .collect::<BTreeSet<_>>();
        let mut visited = 0_usize;
        while let Some(id) = frontier.pop_first() {
            visited = visited.checked_add(1).ok_or(ImpactGraphErrorV1::Bounds)?;
            for edge in self.edges.iter().filter(|edge| edge.from == id) {
                let degree = indegree
                    .get_mut(&edge.to)
                    .ok_or(ImpactGraphErrorV1::Graph)?;
                *degree = degree.checked_sub(1).ok_or(ImpactGraphErrorV1::Graph)?;
                if *degree == 0 {
                    frontier.insert(edge.to.clone());
                }
            }
        }
        if visited != self.nodes.len() {
            return Err(ImpactGraphErrorV1::Graph);
        }
        Ok(())
    }
}

fn add_outputs(
    nodes: &mut BTreeMap<ImpactNodeIdV1, ImpactNodeV1>,
    edges: &mut BTreeSet<ImpactEdgeV1>,
    from: &ImpactNodeIdV1,
    kind: ImpactNodeKindV1,
    values: &[String],
) -> Result<(), ImpactGraphErrorV1> {
    let mut sorted = values.to_vec();
    sorted.sort();
    sorted.dedup();
    if sorted.iter().any(String::is_empty) {
        return Err(ImpactGraphErrorV1::Identity);
    }
    for value in sorted {
        let to = insert_node(nodes, kind, &value)?;
        edges.insert(ImpactEdgeV1 {
            from: from.clone(),
            to,
        });
    }
    Ok(())
}

fn insert_node(
    nodes: &mut BTreeMap<ImpactNodeIdV1, ImpactNodeV1>,
    kind: ImpactNodeKindV1,
    label: &str,
) -> Result<ImpactNodeIdV1, ImpactGraphErrorV1> {
    if label.is_empty() {
        return Err(ImpactGraphErrorV1::Identity);
    }
    let bytes = canonical_bytes(&("elite-redux/m71/impact-node/v1", kind, label))
        .map_err(|error| ImpactGraphErrorV1::Canonical(error.to_string()))?;
    let id = ImpactNodeIdV1(blake3::hash(&bytes).to_hex().to_string());
    if let Some(existing) = nodes.get(&id) {
        if existing.kind != kind || existing.label != label {
            return Err(ImpactGraphErrorV1::Identity);
        }
    } else {
        nodes.insert(
            id.clone(),
            ImpactNodeV1 {
                id: id.clone(),
                kind,
                label: label.to_owned(),
            },
        );
    }
    Ok(id)
}

fn normalize_strings(values: &mut Vec<String>) -> Result<(), ImpactGraphErrorV1> {
    if values.iter().any(String::is_empty) {
        return Err(ImpactGraphErrorV1::Identity);
    }
    values.sort();
    values.dedup();
    Ok(())
}
