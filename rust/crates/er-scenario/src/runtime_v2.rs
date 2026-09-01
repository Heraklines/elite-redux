//! Deterministic runtime and production factory for ScenarioContentPackV2 graphs.

use std::sync::Arc;

use er_types::{GameBehaviorUnitId, ScenarioId, ScenarioNodeId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::content_v2::{
    PreparedScenarioContentV2, ScenarioDefinitionV2, ScenarioNodeV2, ScenarioOptionDefinitionV2,
    ScenarioOptionProgramV2,
};

pub const SCENARIO_RUNTIME_SCHEMA_VERSION_V2: u32 = 2;

#[derive(Clone, Debug)]
pub struct ScenarioDomainFactoryV2 {
    content: Arc<PreparedScenarioContentV2>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioRuntimeV2 {
    pub schema_version: u32,
    pub scenario: ScenarioId,
    pub current_node: ScenarioNodeId,
    pub selected_option: Option<u8>,
    pub completed_outcome: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ScenarioControlV2<'a> {
    Message {
        message_key: &'a str,
    },
    Choice {
        prompt_key: &'a str,
        options: Vec<&'a ScenarioOptionDefinitionV2>,
    },
    ExecuteOption {
        option: &'a ScenarioOptionDefinitionV2,
        behavior_units: &'a [GameBehaviorUnitId],
        primary_party_target: bool,
        secondary_party_target: bool,
        nested_battle: bool,
    },
    Complete {
        outcome_key: &'a str,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ScenarioInputV2 {
    AcknowledgeMessage,
    Choose(u8),
    OptionApplied,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ScenarioRuntimeV2Error {
    #[error("scenario V2 is unknown or runtime state is invalid")]
    Invalid,
    #[error("scenario V2 input does not match the current control")]
    Input,
}

impl ScenarioDomainFactoryV2 {
    pub fn new(content: PreparedScenarioContentV2) -> Self {
        Self {
            content: Arc::new(content),
        }
    }

    pub fn start(&self, scenario: ScenarioId) -> Result<ScenarioRuntimeV2, ScenarioRuntimeV2Error> {
        let definition = self
            .content
            .scenario(scenario)
            .ok_or(ScenarioRuntimeV2Error::Invalid)?;
        Ok(ScenarioRuntimeV2 {
            schema_version: SCENARIO_RUNTIME_SCHEMA_VERSION_V2,
            scenario,
            current_node: definition.entry,
            selected_option: None,
            completed_outcome: None,
        })
    }

    pub fn restore(
        &self,
        runtime: ScenarioRuntimeV2,
    ) -> Result<ScenarioRuntimeV2, ScenarioRuntimeV2Error> {
        self.control(&runtime)?;
        Ok(runtime)
    }

    pub fn control<'a>(
        &'a self,
        runtime: &ScenarioRuntimeV2,
    ) -> Result<ScenarioControlV2<'a>, ScenarioRuntimeV2Error> {
        if runtime.schema_version != SCENARIO_RUNTIME_SCHEMA_VERSION_V2 {
            return Err(ScenarioRuntimeV2Error::Invalid);
        }
        let definition = self.definition(runtime)?;
        let node = node(definition, runtime.current_node)?;
        let control = match node {
            ScenarioNodeV2::Message { message_key, .. } => {
                ScenarioControlV2::Message { message_key }
            }
            ScenarioNodeV2::Choice { prompt_key, edges } => ScenarioControlV2::Choice {
                prompt_key,
                options: edges
                    .iter()
                    .map(|edge| option(definition, edge.option_index))
                    .collect::<Result<Vec<_>, _>>()?,
            },
            ScenarioNodeV2::ExecuteOption {
                option_index,
                behavior_units,
                primary_party_target,
                secondary_party_target,
                nested_battle,
                ..
            } => ScenarioControlV2::ExecuteOption {
                option: option(definition, *option_index)?,
                behavior_units,
                primary_party_target: *primary_party_target,
                secondary_party_target: *secondary_party_target,
                nested_battle: *nested_battle,
            },
            ScenarioNodeV2::Complete { outcome_key } => ScenarioControlV2::Complete { outcome_key },
        };
        Ok(control)
    }

    pub fn program<'a>(
        &'a self,
        runtime: &ScenarioRuntimeV2,
    ) -> Result<&'a ScenarioOptionProgramV2, ScenarioRuntimeV2Error> {
        let definition = self.definition(runtime)?;
        let ScenarioNodeV2::ExecuteOption { option_index, .. } =
            node(definition, runtime.current_node)?
        else {
            return Err(ScenarioRuntimeV2Error::Input);
        };
        self.content
            .option_program(definition.id, *option_index)
            .ok_or(ScenarioRuntimeV2Error::Invalid)
    }

    pub fn apply(
        &self,
        runtime: &mut ScenarioRuntimeV2,
        input: ScenarioInputV2,
    ) -> Result<(), ScenarioRuntimeV2Error> {
        let definition = self.definition(runtime)?;
        let current = node(definition, runtime.current_node)?;
        let next = match (current, input) {
            (ScenarioNodeV2::Message { next, .. }, ScenarioInputV2::AcknowledgeMessage) => *next,
            (ScenarioNodeV2::Choice { edges, .. }, ScenarioInputV2::Choose(option_index)) => {
                let edge = edges
                    .iter()
                    .find(|edge| edge.option_index == option_index)
                    .ok_or(ScenarioRuntimeV2Error::Input)?;
                runtime.selected_option = Some(option_index);
                edge.target
            }
            (
                ScenarioNodeV2::ExecuteOption {
                    next, option_index, ..
                },
                ScenarioInputV2::OptionApplied,
            ) if runtime.selected_option == Some(*option_index) => *next,
            _ => return Err(ScenarioRuntimeV2Error::Input),
        };
        runtime.current_node = next;
        if let ScenarioNodeV2::Complete { outcome_key } = node(definition, next)? {
            runtime.completed_outcome = Some(outcome_key.clone());
        }
        Ok(())
    }

    fn definition<'a>(
        &'a self,
        runtime: &ScenarioRuntimeV2,
    ) -> Result<&'a ScenarioDefinitionV2, ScenarioRuntimeV2Error> {
        self.content
            .scenario(runtime.scenario)
            .ok_or(ScenarioRuntimeV2Error::Invalid)
    }
}

fn node(
    scenario: &ScenarioDefinitionV2,
    id: ScenarioNodeId,
) -> Result<&ScenarioNodeV2, ScenarioRuntimeV2Error> {
    scenario
        .nodes
        .iter()
        .find(|entry| entry.id == id)
        .map(|entry| &entry.node)
        .ok_or(ScenarioRuntimeV2Error::Invalid)
}

fn option(
    scenario: &ScenarioDefinitionV2,
    option_index: u8,
) -> Result<&ScenarioOptionDefinitionV2, ScenarioRuntimeV2Error> {
    scenario
        .options
        .iter()
        .find(|option| option.option_index == option_index)
        .ok_or(ScenarioRuntimeV2Error::Invalid)
}
