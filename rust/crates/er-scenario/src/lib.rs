//! Closed deterministic M7 scenario graphs.
pub mod party_requirements;
pub mod runtime;
pub mod training_session;

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::Arc;

use er_types::{
    CatalogHash, GameBehaviorUnitId, InventoryItemId, OracleSha, RunConditionId, RunProgramId,
    ScenarioId, ScenarioNodeId,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const SCENARIO_GRAPH_SCHEMA_VERSION_V1: u32 = 1;
pub const SCENARIO_CONTENT_PACK_SCHEMA_VERSION_V1: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioGraphV1 {
    pub schema_version: u32,
    pub id: ScenarioId,
    pub source: GameBehaviorUnitId,
    pub entry: ScenarioNodeId,
    pub nodes: Vec<ScenarioNodeEntryV1>,
    pub intentionally_unreachable: Vec<ScenarioNodeId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioNodeEntryV1 {
    pub id: ScenarioNodeId,
    pub node: ScenarioNode,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum ScenarioNode {
    Message(MessageNode),
    Choice(ChoiceNode),
    Conditional(ConditionalNode),
    ApplyProgram(ApplyProgramNode),
    StartBattle(StartBattleNode),
    PartyTarget(PartyTargetNode),
    ItemTarget(ItemTargetNode),
    Complete(CompleteNode),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MessageNode {
    pub message_key: String,
    pub next: ScenarioNodeId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChoiceNode {
    pub prompt_key: String,
    pub choices: Vec<ScenarioChoiceV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioChoiceV1 {
    pub option_key: String,
    pub next: ScenarioNodeId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConditionalNode {
    pub condition: RunConditionId,
    pub when_true: ScenarioNodeId,
    pub when_false: ScenarioNodeId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApplyProgramNode {
    pub program: RunProgramId,
    pub next: ScenarioNodeId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StartBattleNode {
    pub encounter_key: String,
    pub after_victory: ScenarioNodeId,
    pub after_defeat: ScenarioNodeId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PartyTargetNode {
    pub prompt_key: String,
    pub allow_fainted: bool,
    pub next: ScenarioNodeId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ItemTargetNode {
    pub prompt_key: String,
    pub item: InventoryItemId,
    pub next: ScenarioNodeId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompleteNode {
    pub outcome_key: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioContentPackV1 {
    pub schema_version: u32,
    pub oracle_sha: OracleSha,
    pub content_hash: CatalogHash,
    pub graphs: Vec<ScenarioGraphV1>,
}

#[derive(Clone, Debug)]
pub struct PreparedScenarioContentV1 {
    pack: Arc<ScenarioContentPackV1>,
    graph_indexes: BTreeMap<ScenarioId, usize>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ScenarioError {
    #[error("{kind} schema version must be {expected}, got {actual}")]
    SchemaVersion {
        kind: &'static str,
        expected: u32,
        actual: u32,
    },
    #[error("scenario and node IDs must be positive")]
    ZeroId,
    #[error("scenario graphs or nodes are not sorted and unique")]
    NotSortedUnique,
    #[error("scenario entry or edge targets an unknown node")]
    UnknownNode,
    #[error("choice nodes require sorted unique nonempty option keys")]
    ChoiceClosure,
    #[error("scenario registry keys cannot be empty")]
    EmptyKey,
    #[error("unreachable nodes require exact explicit classification")]
    Reachability,
    #[error("scenario pack is empty")]
    EmptyPack,
}

impl ScenarioGraphV1 {
    pub fn validate(&self) -> Result<(), ScenarioError> {
        require_schema(
            "ScenarioGraphV1",
            self.schema_version,
            SCENARIO_GRAPH_SCHEMA_VERSION_V1,
        )?;
        if self.id == ScenarioId::ZERO || self.entry == ScenarioNodeId::ZERO {
            return Err(ScenarioError::ZeroId);
        }
        let mut indexes = BTreeMap::new();
        let mut previous = None;
        for (index, entry) in self.nodes.iter().enumerate() {
            if entry.id == ScenarioNodeId::ZERO
                || previous.is_some_and(|id| entry.id <= id)
                || indexes.insert(entry.id, index).is_some()
            {
                return Err(ScenarioError::NotSortedUnique);
            }
            previous = Some(entry.id);
            validate_node_shape(&entry.node)?;
        }
        if !indexes.contains_key(&self.entry) {
            return Err(ScenarioError::UnknownNode);
        }
        for entry in &self.nodes {
            for target in node_targets(&entry.node) {
                if !indexes.contains_key(&target) {
                    return Err(ScenarioError::UnknownNode);
                }
            }
        }
        if self
            .intentionally_unreachable
            .windows(2)
            .any(|pair| pair[0] >= pair[1])
            || self
                .intentionally_unreachable
                .iter()
                .any(|id| !indexes.contains_key(id))
        {
            return Err(ScenarioError::NotSortedUnique);
        }
        let reachable = reachable_nodes(self.entry, &self.nodes, &indexes);
        let actual_unreachable: Vec<_> = self
            .nodes
            .iter()
            .map(|entry| entry.id)
            .filter(|id| !reachable.contains(id))
            .collect();
        if actual_unreachable != self.intentionally_unreachable {
            return Err(ScenarioError::Reachability);
        }
        Ok(())
    }
}

impl ScenarioContentPackV1 {
    pub fn validate(&self) -> Result<(), ScenarioError> {
        require_schema(
            "ScenarioContentPackV1",
            self.schema_version,
            SCENARIO_CONTENT_PACK_SCHEMA_VERSION_V1,
        )?;
        if self.graphs.is_empty() {
            return Err(ScenarioError::EmptyPack);
        }
        let mut previous = None;
        for graph in &self.graphs {
            if previous.is_some_and(|id| graph.id <= id) {
                return Err(ScenarioError::NotSortedUnique);
            }
            graph.validate()?;
            previous = Some(graph.id);
        }
        Ok(())
    }
}

impl PreparedScenarioContentV1 {
    pub fn prepare(pack: Arc<ScenarioContentPackV1>) -> Result<Self, ScenarioError> {
        pack.validate()?;
        let graph_indexes = pack
            .graphs
            .iter()
            .enumerate()
            .map(|(index, graph)| (graph.id, index))
            .collect();
        Ok(Self {
            pack,
            graph_indexes,
        })
    }

    pub fn pack(&self) -> &Arc<ScenarioContentPackV1> {
        &self.pack
    }

    pub fn graph(&self, id: ScenarioId) -> Option<&ScenarioGraphV1> {
        self.graph_indexes
            .get(&id)
            .and_then(|index| self.pack.graphs.get(*index))
    }
}

fn validate_node_shape(node: &ScenarioNode) -> Result<(), ScenarioError> {
    match node {
        ScenarioNode::Message(value) => nonempty(&value.message_key),
        ScenarioNode::Choice(value) => {
            nonempty(&value.prompt_key)?;
            if value.choices.is_empty()
                || value
                    .choices
                    .iter()
                    .any(|choice| choice.option_key.is_empty())
                || value
                    .choices
                    .windows(2)
                    .any(|pair| pair[0].option_key >= pair[1].option_key)
            {
                return Err(ScenarioError::ChoiceClosure);
            }
            Ok(())
        }
        ScenarioNode::StartBattle(value) => nonempty(&value.encounter_key),
        ScenarioNode::PartyTarget(value) => nonempty(&value.prompt_key),
        ScenarioNode::ItemTarget(value) => nonempty(&value.prompt_key),
        ScenarioNode::Complete(value) => nonempty(&value.outcome_key),
        ScenarioNode::Conditional(_) | ScenarioNode::ApplyProgram(_) => Ok(()),
    }
}

fn nonempty(value: &str) -> Result<(), ScenarioError> {
    if value.is_empty() {
        return Err(ScenarioError::EmptyKey);
    }
    Ok(())
}

fn node_targets(node: &ScenarioNode) -> Vec<ScenarioNodeId> {
    match node {
        ScenarioNode::Message(value) => vec![value.next],
        ScenarioNode::Choice(value) => value.choices.iter().map(|choice| choice.next).collect(),
        ScenarioNode::Conditional(value) => vec![value.when_true, value.when_false],
        ScenarioNode::ApplyProgram(value) => vec![value.next],
        ScenarioNode::StartBattle(value) => vec![value.after_victory, value.after_defeat],
        ScenarioNode::PartyTarget(value) => vec![value.next],
        ScenarioNode::ItemTarget(value) => vec![value.next],
        ScenarioNode::Complete(_) => Vec::new(),
    }
}

fn reachable_nodes(
    entry: ScenarioNodeId,
    nodes: &[ScenarioNodeEntryV1],
    indexes: &BTreeMap<ScenarioNodeId, usize>,
) -> BTreeSet<ScenarioNodeId> {
    let mut reachable = BTreeSet::new();
    let mut pending = VecDeque::from([entry]);
    while let Some(id) = pending.pop_front() {
        if !reachable.insert(id) {
            continue;
        }
        if let Some(node) = indexes.get(&id).and_then(|index| nodes.get(*index)) {
            pending.extend(node_targets(&node.node));
        }
    }
    reachable
}

fn require_schema(kind: &'static str, actual: u32, expected: u32) -> Result<(), ScenarioError> {
    if actual != expected {
        return Err(ScenarioError::SchemaVersion {
            kind,
            expected,
            actual,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use er_types::{GameBehaviorUnitId, SafeU53, ScenarioId, ScenarioNodeId};

    use super::{
        CompleteNode, MessageNode, SCENARIO_GRAPH_SCHEMA_VERSION_V1, ScenarioError,
        ScenarioGraphV1, ScenarioNode, ScenarioNodeEntryV1,
    };

    fn id(value: u64) -> ScenarioNodeId {
        ScenarioNodeId::new(SafeU53::new(value).expect("safe ID"))
    }

    fn graph() -> ScenarioGraphV1 {
        ScenarioGraphV1 {
            schema_version: SCENARIO_GRAPH_SCHEMA_VERSION_V1,
            id: ScenarioId::new(SafeU53::new(1).expect("safe scenario")),
            source: GameBehaviorUnitId::parse("a".repeat(64)).expect("behavior ID"),
            entry: id(1),
            nodes: vec![
                ScenarioNodeEntryV1 {
                    id: id(1),
                    node: ScenarioNode::Message(MessageNode {
                        message_key: "scenario.start".to_owned(),
                        next: id(2),
                    }),
                },
                ScenarioNodeEntryV1 {
                    id: id(2),
                    node: ScenarioNode::Complete(CompleteNode {
                        outcome_key: "scenario.complete".to_owned(),
                    }),
                },
            ],
            intentionally_unreachable: Vec::new(),
        }
    }

    #[test]
    fn reachable_closed_graph_validates() {
        graph().validate().expect("valid graph");
    }

    #[test]
    fn unknown_edge_fails_closed() {
        let mut value = graph();
        value.nodes[0].node = ScenarioNode::Message(MessageNode {
            message_key: "scenario.start".to_owned(),
            next: id(3),
        });
        assert_eq!(value.validate(), Err(ScenarioError::UnknownNode));
    }
}
