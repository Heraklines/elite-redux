//! Bounded semantic content/behavior/scenario search and immutable state queries.

use std::collections::BTreeMap;

use er_canonical::canonical_bytes;
use er_state::m7_state::{GameStateV5, ProfileStateV1, RunStateV3};
use er_types::battle_ids::PokemonId;
use er_types::{GameContentIdentity, GameControlPlanV2};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SearchDocumentKindV1 {
    Species,
    Move,
    Ability,
    Item,
    Behavior,
    Scenario,
    Preset,
    Control,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchDocumentV1 {
    pub kind: SearchDocumentKindV1,
    pub stable_id: String,
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub detail: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchQueryV1 {
    pub kind: Option<SearchDocumentKindV1>,
    pub text: String,
    pub tags: Vec<String>,
    pub maximum_results: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchResultV1 {
    pub kind: SearchDocumentKindV1,
    pub stable_id: String,
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum LabQueryErrorV1 {
    #[error("search index identity, document, or bound is invalid")]
    Invalid,
    #[error("search document does not exist")]
    Missing,
    #[error("state query path does not exist")]
    StatePath,
    #[error("query canonical encoding failed: {0}")]
    Canonical(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LabSearchIndexV1 {
    pub content_identity: GameContentIdentity,
    maximum_documents: usize,
    maximum_results: usize,
    documents: BTreeMap<(SearchDocumentKindV1, String), SearchDocumentV1>,
}

impl LabSearchIndexV1 {
    pub fn new(
        content_identity: GameContentIdentity,
        mut documents: Vec<SearchDocumentV1>,
        maximum_documents: usize,
        maximum_results: usize,
    ) -> Result<Self, LabQueryErrorV1> {
        if maximum_documents == 0 || maximum_results == 0 || documents.len() > maximum_documents {
            return Err(LabQueryErrorV1::Invalid);
        }
        for document in &mut documents {
            document.tags.sort();
            document.tags.dedup();
            if document.stable_id.is_empty()
                || document.name.is_empty()
                || document.description.is_empty()
                || document.tags.iter().any(String::is_empty)
                || document.detail.len() > 1_048_576
            {
                return Err(LabQueryErrorV1::Invalid);
            }
        }
        documents.sort_by(|left, right| {
            (left.kind, &left.stable_id).cmp(&(right.kind, &right.stable_id))
        });
        if documents
            .windows(2)
            .any(|pair| pair[0].kind == pair[1].kind && pair[0].stable_id == pair[1].stable_id)
        {
            return Err(LabQueryErrorV1::Invalid);
        }
        Ok(Self {
            content_identity,
            maximum_documents,
            maximum_results,
            documents: documents
                .into_iter()
                .map(|document| ((document.kind, document.stable_id.clone()), document))
                .collect(),
        })
    }

    pub fn search(&self, mut query: SearchQueryV1) -> Result<Vec<SearchResultV1>, LabQueryErrorV1> {
        if query.text.len() > 4096 || query.maximum_results == 0 {
            return Err(LabQueryErrorV1::Invalid);
        }
        query.tags.sort();
        query.tags.dedup();
        if query.tags.iter().any(String::is_empty) {
            return Err(LabQueryErrorV1::Invalid);
        }
        let maximum = query.maximum_results.min(self.maximum_results);
        let needle = query.text.to_ascii_lowercase();
        Ok(self
            .documents
            .values()
            .filter(|document| query.kind.is_none_or(|kind| kind == document.kind))
            .filter(|document| query.tags.iter().all(|tag| document.tags.contains(tag)))
            .filter(|document| {
                needle.is_empty()
                    || document.name.to_ascii_lowercase().contains(&needle)
                    || document.stable_id.to_ascii_lowercase().contains(&needle)
                    || document.description.to_ascii_lowercase().contains(&needle)
            })
            .take(maximum)
            .map(|document| SearchResultV1 {
                kind: document.kind,
                stable_id: document.stable_id.clone(),
                name: document.name.clone(),
                description: document.description.clone(),
                tags: document.tags.clone(),
            })
            .collect())
    }

    pub fn describe(
        &self,
        kind: SearchDocumentKindV1,
        stable_id: &str,
    ) -> Result<&SearchDocumentV1, LabQueryErrorV1> {
        self.documents
            .get(&(kind, stable_id.to_owned()))
            .ok_or(LabQueryErrorV1::Missing)
    }

    pub fn document_count(&self) -> usize {
        self.documents.len()
    }

    pub fn maximum_documents(&self) -> usize {
        self.maximum_documents
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum StateQueryV1 {
    Profile,
    Run,
    Party,
    Pokemon(PokemonId),
    Battle,
    Control,
    World,
    Progression,
    Scenario,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StateQueryResultV1 {
    pub query: StateQueryV1,
    pub canonical_bytes: Vec<u8>,
    pub digest: String,
}

pub fn query_state_v1(
    state: &GameStateV5,
    query: StateQueryV1,
    maximum_bytes: usize,
) -> Result<StateQueryResultV1, LabQueryErrorV1> {
    query_state_parts_v1(
        &state.profile,
        state.active_run.as_ref(),
        state.active_run.as_ref().map(|run| &run.control),
        query,
        maximum_bytes,
    )
}

/// Select immutable shared fields without converting a current V6 state to V5.
/// The caller chooses the actual control for its lifecycle; this function does
/// not reconstruct a control, run, content identity, allocator, or kernel.
pub fn query_state_parts_v1(
    profile: &ProfileStateV1,
    active_run: Option<&RunStateV3>,
    control: Option<&GameControlPlanV2>,
    query: StateQueryV1,
    maximum_bytes: usize,
) -> Result<StateQueryResultV1, LabQueryErrorV1> {
    if maximum_bytes == 0 {
        return Err(LabQueryErrorV1::Invalid);
    }
    let bytes = match &query {
        StateQueryV1::Profile => canonical_bytes(profile),
        StateQueryV1::Run => canonical_bytes(&active_run),
        StateQueryV1::Party => {
            canonical_bytes(&active_run.ok_or(LabQueryErrorV1::StatePath)?.party)
        }
        StateQueryV1::Pokemon(id) => {
            let pokemon = active_run
                .and_then(|run| run.party.iter().find(|pokemon| pokemon.id == *id))
                .ok_or(LabQueryErrorV1::StatePath)?;
            canonical_bytes(pokemon)
        }
        StateQueryV1::Battle => {
            canonical_bytes(&active_run.ok_or(LabQueryErrorV1::StatePath)?.battle)
        }
        StateQueryV1::Control => canonical_bytes(control.ok_or(LabQueryErrorV1::StatePath)?),
        StateQueryV1::World => {
            canonical_bytes(&active_run.ok_or(LabQueryErrorV1::StatePath)?.world)
        }
        StateQueryV1::Progression => {
            canonical_bytes(&active_run.ok_or(LabQueryErrorV1::StatePath)?.progression_queue)
        }
        StateQueryV1::Scenario => {
            canonical_bytes(&active_run.ok_or(LabQueryErrorV1::StatePath)?.scenario)
        }
    }
    .map_err(|error| LabQueryErrorV1::Canonical(error.to_string()))?;
    if bytes.len() > maximum_bytes {
        return Err(LabQueryErrorV1::Invalid);
    }
    Ok(StateQueryResultV1 {
        query,
        digest: format!("blake3-v1:{}", blake3::hash(&bytes).to_hex()),
        canonical_bytes: bytes,
    })
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlDescriptionV1 {
    pub kind: String,
    pub actionable: bool,
    pub menu_instance: Option<u64>,
    pub selected_option: Option<String>,
    pub visible_options: Vec<String>,
}

pub fn describe_control_v1(
    control: &GameControlPlanV2,
) -> Result<ControlDescriptionV1, LabQueryErrorV1> {
    control.validate().map_err(|_| LabQueryErrorV1::Invalid)?;
    Ok(ControlDescriptionV1 {
        kind: format!("{:?}", control.kind),
        actionable: control.actionable,
        menu_instance: control
            .menu
            .as_ref()
            .map(|menu| menu.instance_id.get().get()),
        selected_option: control
            .menu
            .as_ref()
            .map(|menu| menu.selected_option_id.as_str().to_owned()),
        visible_options: control
            .menu
            .as_ref()
            .map(|menu| {
                menu.options
                    .iter()
                    .filter(|option| option.visible)
                    .map(|option| option.option_id.as_str().to_owned())
                    .collect()
            })
            .unwrap_or_default(),
    })
}
