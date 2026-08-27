//! Atomic deterministic execution of ScenarioGraphV1 controls.

use er_state::m7_state::GameStateV5;
use er_types::battle_ids::PokemonId;
use er_types::battle_model::BattleOutcome;
use er_types::{InventoryItemId, RunProgramId, ScenarioNodeId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{PreparedScenarioContentV1, ScenarioNode};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ScenarioActionV1 {
    Advance,
    Choose(usize),
    Branch(bool),
    ProgramApplied,
    BattleCompleted(BattleOutcome),
    PartyTarget(PokemonId),
    ItemTarget(InventoryItemId),
    Complete,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum ScenarioEffectV1 {
    Message(String),
    Choice {
        prompt: String,
        options: Vec<String>,
    },
    EvaluateCondition(er_types::RunConditionId),
    ApplyProgram(RunProgramId),
    StartBattle(String),
    SelectPartyTarget {
        prompt: String,
        allow_fainted: bool,
    },
    SelectItemTarget {
        prompt: String,
        item: InventoryItemId,
    },
    Completed(String),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioTransitionV1 {
    pub after_state: GameStateV5,
    pub before_node: ScenarioNodeId,
    pub after_node: Option<ScenarioNodeId>,
    pub effect: ScenarioEffectV1,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ScenarioRuntimeError {
    #[error("game state is invalid: {0}")]
    State(String),
    #[error("no active scenario or graph exists")]
    NoScenario,
    #[error("scenario action does not match the active node")]
    WrongAction,
    #[error("scenario choice index is outside the option list")]
    Choice,
    #[error("scenario transition targets an unknown node")]
    UnknownNode,
}

pub fn observe_scenario(
    state: &GameStateV5,
    content: &PreparedScenarioContentV1,
) -> Result<ScenarioEffectV1, ScenarioRuntimeError> {
    let runtime = state
        .active_run
        .as_ref()
        .and_then(|run| run.scenario.as_ref())
        .ok_or(ScenarioRuntimeError::NoScenario)?;
    let graph = content
        .graph(runtime.scenario)
        .ok_or(ScenarioRuntimeError::NoScenario)?;
    let entry = graph
        .nodes
        .iter()
        .find(|entry| entry.id == runtime.node)
        .ok_or(ScenarioRuntimeError::UnknownNode)?;
    Ok(effect_for_node(&entry.node))
}

pub fn step_scenario(
    before: &GameStateV5,
    content: &PreparedScenarioContentV1,
    action: ScenarioActionV1,
) -> Result<ScenarioTransitionV1, ScenarioRuntimeError> {
    before
        .validate()
        .map_err(|error| ScenarioRuntimeError::State(error.to_string()))?;
    let runtime = before
        .active_run
        .as_ref()
        .and_then(|run| run.scenario.as_ref())
        .ok_or(ScenarioRuntimeError::NoScenario)?;
    let graph = content
        .graph(runtime.scenario)
        .ok_or(ScenarioRuntimeError::NoScenario)?;
    let entry = graph
        .nodes
        .iter()
        .find(|entry| entry.id == runtime.node)
        .ok_or(ScenarioRuntimeError::UnknownNode)?;
    let next = next_node(&entry.node, action)?;
    let mut after = before.clone();
    let run = after
        .active_run
        .as_mut()
        .ok_or(ScenarioRuntimeError::NoScenario)?;
    let effect = if let Some(next) = next {
        if !graph.nodes.iter().any(|entry| entry.id == next) {
            return Err(ScenarioRuntimeError::UnknownNode);
        }
        let runtime = run
            .scenario
            .as_mut()
            .ok_or(ScenarioRuntimeError::NoScenario)?;
        runtime.node = next;
        runtime.visit_count = runtime
            .visit_count
            .get()
            .checked_add(1)
            .and_then(|value| er_types::SafeU53::new(value).ok())
            .ok_or(ScenarioRuntimeError::WrongAction)?;
        let node = graph
            .nodes
            .iter()
            .find(|entry| entry.id == next)
            .ok_or(ScenarioRuntimeError::UnknownNode)?;
        effect_for_node(&node.node)
    } else {
        let ScenarioNode::Complete(value) = &entry.node else {
            return Err(ScenarioRuntimeError::WrongAction);
        };
        run.scenario = None;
        ScenarioEffectV1::Completed(value.outcome_key.clone())
    };
    after
        .validate()
        .map_err(|error| ScenarioRuntimeError::State(error.to_string()))?;
    Ok(ScenarioTransitionV1 {
        after_state: after,
        before_node: entry.id,
        after_node: next,
        effect,
    })
}

fn effect_for_node(node: &ScenarioNode) -> ScenarioEffectV1 {
    match node {
        ScenarioNode::Message(value) => ScenarioEffectV1::Message(value.message_key.clone()),
        ScenarioNode::Choice(value) => ScenarioEffectV1::Choice {
            prompt: value.prompt_key.clone(),
            options: value
                .choices
                .iter()
                .map(|choice| choice.option_key.clone())
                .collect(),
        },
        ScenarioNode::Conditional(value) => ScenarioEffectV1::EvaluateCondition(value.condition),
        ScenarioNode::ApplyProgram(value) => ScenarioEffectV1::ApplyProgram(value.program),
        ScenarioNode::StartBattle(value) => {
            ScenarioEffectV1::StartBattle(value.encounter_key.clone())
        }
        ScenarioNode::PartyTarget(value) => ScenarioEffectV1::SelectPartyTarget {
            prompt: value.prompt_key.clone(),
            allow_fainted: value.allow_fainted,
        },
        ScenarioNode::ItemTarget(value) => ScenarioEffectV1::SelectItemTarget {
            prompt: value.prompt_key.clone(),
            item: value.item,
        },
        ScenarioNode::Complete(value) => ScenarioEffectV1::Completed(value.outcome_key.clone()),
    }
}

fn next_node(
    node: &ScenarioNode,
    action: ScenarioActionV1,
) -> Result<Option<ScenarioNodeId>, ScenarioRuntimeError> {
    match (node, action) {
        (ScenarioNode::Message(value), ScenarioActionV1::Advance) => Ok(Some(value.next)),
        (ScenarioNode::Choice(value), ScenarioActionV1::Choose(index)) => value
            .choices
            .get(index)
            .map(|choice| Some(choice.next))
            .ok_or(ScenarioRuntimeError::Choice),
        (ScenarioNode::Conditional(value), ScenarioActionV1::Branch(true)) => {
            Ok(Some(value.when_true))
        }
        (ScenarioNode::Conditional(value), ScenarioActionV1::Branch(false)) => {
            Ok(Some(value.when_false))
        }
        (ScenarioNode::ApplyProgram(value), ScenarioActionV1::ProgramApplied) => {
            Ok(Some(value.next))
        }
        (ScenarioNode::StartBattle(value), ScenarioActionV1::BattleCompleted(outcome)) => {
            match outcome {
                BattleOutcome::Victory => Ok(Some(value.after_victory)),
                BattleOutcome::Defeat => Ok(Some(value.after_defeat)),
                BattleOutcome::Ongoing => Err(ScenarioRuntimeError::WrongAction),
            }
        }
        (ScenarioNode::PartyTarget(value), ScenarioActionV1::PartyTarget(_)) => {
            Ok(Some(value.next))
        }
        (ScenarioNode::ItemTarget(value), ScenarioActionV1::ItemTarget(item))
            if item == value.item =>
        {
            Ok(Some(value.next))
        }
        (ScenarioNode::Complete(_), ScenarioActionV1::Complete) => Ok(None),
        _ => Err(ScenarioRuntimeError::WrongAction),
    }
}
