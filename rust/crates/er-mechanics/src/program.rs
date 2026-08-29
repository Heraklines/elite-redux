use std::collections::VecDeque;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use er_types::mechanics::{
    HookOrdinal, MECHANICS_PROGRAM_VERSION, MechanicHook, MechanicQuery, MechanicSourceId,
    MechanicsProgramId,
};

use crate::condition::{ConditionArena, ConditionNodeError};
use crate::ids::{ConditionNodeId, SelectorNodeId};
use crate::operation::MechanicOperation;
use crate::selector::{SelectorArena, SelectorNodeError};
use crate::value::{QueryValueKind, ValueNode, ValueNodeError};

pub const MAX_HOOK_BINDINGS: usize = 64;
pub const MAX_CONDITION_NODES: usize = 256;
pub const MAX_SELECTOR_NODES: usize = 128;
pub const MAX_VALUE_NODES: usize = 256;
pub const MAX_OPERATIONS: usize = 256;
pub const MAX_CONDITION_DEPTH: usize = 32;
pub const MAX_SELECTOR_DEPTH: usize = 16;
pub const MAX_RNG_DRAWS: u16 = 64;
pub const MAX_SPAWNED_INSTANCES: u16 = 64;
pub const MAX_PRESENTATION_CUES: u16 = 128;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProgramBudget {
    pub hook_bindings: u16,
    pub condition_nodes: u16,
    pub selector_nodes: u16,
    pub value_nodes: u16,
    pub operations: u16,
    pub condition_depth: u8,
    pub selector_depth: u8,
    pub rng_draws: u16,
    pub spawned_instances: u16,
    pub presentation_cues: u16,
}

impl ProgramBudget {
    pub const fn ceiling() -> Self {
        Self {
            hook_bindings: MAX_HOOK_BINDINGS as u16,
            condition_nodes: MAX_CONDITION_NODES as u16,
            selector_nodes: MAX_SELECTOR_NODES as u16,
            value_nodes: MAX_VALUE_NODES as u16,
            operations: MAX_OPERATIONS as u16,
            condition_depth: MAX_CONDITION_DEPTH as u8,
            selector_depth: MAX_SELECTOR_DEPTH as u8,
            rng_draws: MAX_RNG_DRAWS,
            spawned_instances: MAX_SPAWNED_INSTANCES,
            presentation_cues: MAX_PRESENTATION_CUES,
        }
    }

    pub fn validate(self) -> Result<(), ProgramValidationError> {
        let ceiling = Self::ceiling();
        for (name, actual, maximum) in [
            (
                "hook_bindings",
                u64::from(self.hook_bindings),
                u64::from(ceiling.hook_bindings),
            ),
            (
                "condition_nodes",
                u64::from(self.condition_nodes),
                u64::from(ceiling.condition_nodes),
            ),
            (
                "selector_nodes",
                u64::from(self.selector_nodes),
                u64::from(ceiling.selector_nodes),
            ),
            (
                "value_nodes",
                u64::from(self.value_nodes),
                u64::from(ceiling.value_nodes),
            ),
            (
                "operations",
                u64::from(self.operations),
                u64::from(ceiling.operations),
            ),
            (
                "condition_depth",
                u64::from(self.condition_depth),
                u64::from(ceiling.condition_depth),
            ),
            (
                "selector_depth",
                u64::from(self.selector_depth),
                u64::from(ceiling.selector_depth),
            ),
            (
                "rng_draws",
                u64::from(self.rng_draws),
                u64::from(ceiling.rng_draws),
            ),
            (
                "spawned_instances",
                u64::from(self.spawned_instances),
                u64::from(ceiling.spawned_instances),
            ),
            (
                "presentation_cues",
                u64::from(self.presentation_cues),
                u64::from(ceiling.presentation_cues),
            ),
        ] {
            if actual > maximum {
                return Err(ProgramValidationError::BudgetAboveCeiling {
                    resource: name,
                    actual,
                    maximum,
                });
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProgramRange {
    pub start: u16,
    pub length: u16,
}

impl ProgramRange {
    pub fn end(self) -> Option<usize> {
        usize::from(self.start).checked_add(usize::from(self.length))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum BindingKind {
    Trigger {
        hook: MechanicHook,
    },
    Query {
        query: MechanicQuery,
        value_kind: QueryValueKind,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HookBinding {
    pub binding: BindingKind,
    pub hook_ordinal: HookOrdinal,
    pub condition_root: Option<ConditionNodeId>,
    pub selector_root: Option<SelectorNodeId>,
    pub operations: ProgramRange,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanicsProgramV1 {
    pub schema_version: u32,
    pub id: MechanicsProgramId,
    pub source: MechanicSourceId,
    pub bindings: Vec<HookBinding>,
    pub conditions: ConditionArena,
    pub selectors: SelectorArena,
    pub values: Vec<ValueNode>,
    pub operations: Vec<MechanicOperation>,
    pub budget: ProgramBudget,
}

impl MechanicsProgramV1 {
    pub fn validate(&self) -> Result<(), ProgramValidationError> {
        if self.schema_version != MECHANICS_PROGRAM_VERSION {
            return Err(ProgramValidationError::SchemaVersion {
                expected: MECHANICS_PROGRAM_VERSION,
                actual: self.schema_version,
            });
        }
        if self.id == MechanicsProgramId::ZERO {
            return Err(ProgramValidationError::ZeroProgramId);
        }
        self.source
            .validate()
            .map_err(|_| ProgramValidationError::InvalidSource)?;
        self.budget.validate()?;
        self.validate_lengths()?;

        let mut condition_roots = Vec::new();
        let mut selector_roots = Vec::new();
        let mut value_roots = Vec::new();
        for (index, binding) in self.bindings.iter().enumerate() {
            let end = binding
                .operations
                .end()
                .ok_or(ProgramValidationError::OperationRangeOverflow { binding: index })?;
            if binding.operations.length == 0 || end > self.operations.len() {
                return Err(ProgramValidationError::InvalidOperationRange { binding: index });
            }
            if let Some(root) = binding.condition_root {
                condition_roots.push(root.index());
            }
            if let Some(root) = binding.selector_root {
                selector_roots.push(root.index());
            }
            for operation in &self.operations[usize::from(binding.operations.start)..end] {
                match binding.binding {
                    BindingKind::Trigger { .. } if operation.is_query() => {
                        return Err(ProgramValidationError::QueryOperationOnTrigger {
                            binding: index,
                        });
                    }
                    BindingKind::Query { .. } if !operation.is_query() => {
                        return Err(ProgramValidationError::MutationOperationOnQuery {
                            binding: index,
                        });
                    }
                    _ => {}
                }
                selector_roots.extend(operation.selector_references().map(SelectorNodeId::index));
                value_roots.extend(operation.value_references().map(|id| id.index()));
            }
        }

        for (index, node) in self.conditions.0.iter().enumerate() {
            node.validate_scalars()
                .map_err(|source| ProgramValidationError::ConditionNode { index, source })?;
            value_roots.extend(node.value_references().map(|id| id.index()));
        }
        for (index, node) in self.selectors.0.iter().enumerate() {
            node.validate_scalars()
                .map_err(|source| ProgramValidationError::SelectorNode { index, source })?;
        }
        for (index, node) in self.values.iter().enumerate() {
            node.validate_scalars()
                .map_err(|source| ProgramValidationError::ValueNode { index, source })?;
        }

        validate_graph(
            "condition",
            self.conditions.len(),
            &condition_roots,
            usize::from(self.budget.condition_depth),
            |index| {
                self.conditions.0[index]
                    .condition_references()
                    .map(|id| id.index())
                    .collect()
            },
        )?;
        validate_graph(
            "selector",
            self.selectors.len(),
            &selector_roots,
            usize::from(self.budget.selector_depth),
            |index| {
                self.selectors.0[index]
                    .references()
                    .map(|id| id.index())
                    .collect()
            },
        )?;
        validate_graph(
            "value",
            self.values.len(),
            &value_roots,
            MAX_CONDITION_DEPTH,
            |index| {
                self.values[index]
                    .references()
                    .map(|id| id.index())
                    .collect()
            },
        )?;
        Ok(())
    }

    fn validate_lengths(&self) -> Result<(), ProgramValidationError> {
        for (resource, actual, declared, maximum) in [
            (
                "hook_bindings",
                self.bindings.len(),
                usize::from(self.budget.hook_bindings),
                MAX_HOOK_BINDINGS,
            ),
            (
                "condition_nodes",
                self.conditions.len(),
                usize::from(self.budget.condition_nodes),
                MAX_CONDITION_NODES,
            ),
            (
                "selector_nodes",
                self.selectors.len(),
                usize::from(self.budget.selector_nodes),
                MAX_SELECTOR_NODES,
            ),
            (
                "value_nodes",
                self.values.len(),
                usize::from(self.budget.value_nodes),
                MAX_VALUE_NODES,
            ),
            (
                "operations",
                self.operations.len(),
                usize::from(self.budget.operations),
                MAX_OPERATIONS,
            ),
        ] {
            if actual > maximum || actual > declared {
                return Err(ProgramValidationError::CollectionExceedsBudget {
                    resource,
                    actual,
                    declared,
                    maximum,
                });
            }
        }
        Ok(())
    }
}

fn validate_graph<F>(
    kind: &'static str,
    node_count: usize,
    roots: &[usize],
    maximum_depth: usize,
    references: F,
) -> Result<(), ProgramValidationError>
where
    F: Fn(usize) -> Vec<usize>,
{
    let mut adjacency = Vec::with_capacity(node_count);
    let mut incoming = vec![0_usize; node_count];
    for index in 0..node_count {
        let edges = references(index);
        for &target in &edges {
            if target >= node_count {
                return Err(ProgramValidationError::NodeReferenceOutOfBounds {
                    kind,
                    node: index,
                    target,
                    node_count,
                });
            }
            incoming[target] += 1;
        }
        adjacency.push(edges);
    }
    for &root in roots {
        if root >= node_count {
            return Err(ProgramValidationError::RootOutOfBounds {
                kind,
                root,
                node_count,
            });
        }
    }

    let mut queue: VecDeque<usize> = incoming
        .iter()
        .enumerate()
        .filter_map(|(index, &count)| (count == 0).then_some(index))
        .collect();
    let mut visited = 0_usize;
    while let Some(index) = queue.pop_front() {
        visited += 1;
        for &target in &adjacency[index] {
            incoming[target] -= 1;
            if incoming[target] == 0 {
                queue.push_back(target);
            }
        }
    }
    if visited != node_count {
        return Err(ProgramValidationError::NodeCycle { kind });
    }

    let mut reachable = vec![false; node_count];
    let mut depths = vec![0_usize; node_count];
    let mut stack: Vec<(usize, usize)> = roots.iter().copied().map(|root| (root, 1)).collect();
    while let Some((index, depth)) = stack.pop() {
        if depth > maximum_depth {
            return Err(ProgramValidationError::NodeDepthExceeded {
                kind,
                actual: depth,
                maximum: maximum_depth,
            });
        }
        if reachable[index] && depths[index] >= depth {
            continue;
        }
        reachable[index] = true;
        depths[index] = depth;
        stack.extend(
            adjacency[index]
                .iter()
                .copied()
                .map(|target| (target, depth + 1)),
        );
    }
    if let Some(index) = reachable.iter().position(|value| !value) {
        return Err(ProgramValidationError::UnreachableNode { kind, index });
    }
    Ok(())
}

#[derive(Debug, Eq, Error, PartialEq)]
pub enum ProgramValidationError {
    #[error("mechanics program schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("mechanics program ID must be positive")]
    ZeroProgramId,
    #[error("mechanics source identity is invalid")]
    InvalidSource,
    #[error("program budget {resource}={actual} exceeds ceiling {maximum}")]
    BudgetAboveCeiling {
        resource: &'static str,
        actual: u64,
        maximum: u64,
    },
    #[error("program {resource} count {actual} exceeds declared {declared} or maximum {maximum}")]
    CollectionExceedsBudget {
        resource: &'static str,
        actual: usize,
        declared: usize,
        maximum: usize,
    },
    #[error("binding {binding} operation range overflows")]
    OperationRangeOverflow { binding: usize },
    #[error("binding {binding} has an empty or out-of-bounds operation range")]
    InvalidOperationRange { binding: usize },
    #[error("binding {binding} is a trigger but contains a query operation")]
    QueryOperationOnTrigger { binding: usize },
    #[error("binding {binding} is a query but contains a mutation operation")]
    MutationOperationOnQuery { binding: usize },
    #[error("condition node {index} is invalid: {source}")]
    ConditionNode {
        index: usize,
        #[source]
        source: ConditionNodeError,
    },
    #[error("selector node {index} is invalid: {source}")]
    SelectorNode {
        index: usize,
        #[source]
        source: SelectorNodeError,
    },
    #[error("value node {index} is invalid: {source}")]
    ValueNode {
        index: usize,
        #[source]
        source: ValueNodeError,
    },
    #[error("{kind} node {node} references {target}, outside node count {node_count}")]
    NodeReferenceOutOfBounds {
        kind: &'static str,
        node: usize,
        target: usize,
        node_count: usize,
    },
    #[error("{kind} root {root} is outside node count {node_count}")]
    RootOutOfBounds {
        kind: &'static str,
        root: usize,
        node_count: usize,
    },
    #[error("{kind} node graph contains a cycle")]
    NodeCycle { kind: &'static str },
    #[error("{kind} node depth {actual} exceeds maximum {maximum}")]
    NodeDepthExceeded {
        kind: &'static str,
        actual: usize,
        maximum: usize,
    },
    #[error("{kind} node {index} is unreachable")]
    UnreachableNode { kind: &'static str, index: usize },
}
