//! Closed M7.2 warm-laboratory JSONL method registry.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LabAgentMethodV1 {
    ContentSearch,
    ContentDescribe,
    BehaviorSearch,
    BehaviorDescribe,
    StateInspect,
    StateQuery,
    StateDelta,
    ControlDescribe,
    ControlExplain,
    ControlExplainOption,
    ControlPlanNavigation,
    ScenarioSearch,
    ScenarioDescribe,
    ScenarioValidate,
    LabHealth,
    LabResources,
    ExperimentRun,
    ExploreRun,
    CounterfactualRun,
    ReproBisect,
    CorpusReplay,
    MutationRun,
    ContentReloadPreflight,
}

pub fn parse_lab_method_v1(method: &str) -> Option<LabAgentMethodV1> {
    match method {
        "content.search" => Some(LabAgentMethodV1::ContentSearch),
        "content.describe" => Some(LabAgentMethodV1::ContentDescribe),
        "behavior.search" => Some(LabAgentMethodV1::BehaviorSearch),
        "behavior.describe" => Some(LabAgentMethodV1::BehaviorDescribe),
        "state.inspect" => Some(LabAgentMethodV1::StateInspect),
        "state.query" => Some(LabAgentMethodV1::StateQuery),
        "state.delta" => Some(LabAgentMethodV1::StateDelta),
        "control.describe" => Some(LabAgentMethodV1::ControlDescribe),
        "control.explain" => Some(LabAgentMethodV1::ControlExplain),
        "control.explain_option" => Some(LabAgentMethodV1::ControlExplainOption),
        "control.plan_navigation" => Some(LabAgentMethodV1::ControlPlanNavigation),
        "scenario.search" => Some(LabAgentMethodV1::ScenarioSearch),
        "scenario.describe" => Some(LabAgentMethodV1::ScenarioDescribe),
        "scenario.validate" => Some(LabAgentMethodV1::ScenarioValidate),
        "lab.health" => Some(LabAgentMethodV1::LabHealth),
        "lab.resources" => Some(LabAgentMethodV1::LabResources),
        "experiment.run" => Some(LabAgentMethodV1::ExperimentRun),
        "explore.run" => Some(LabAgentMethodV1::ExploreRun),
        "counterfactual.run" => Some(LabAgentMethodV1::CounterfactualRun),
        "repro.bisect" => Some(LabAgentMethodV1::ReproBisect),
        "corpus.replay" => Some(LabAgentMethodV1::CorpusReplay),
        "mutation.run" => Some(LabAgentMethodV1::MutationRun),
        "content.reload_preflight" => Some(LabAgentMethodV1::ContentReloadPreflight),
        _ => None,
    }
}
