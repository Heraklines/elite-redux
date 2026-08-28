//! Visibility-checked Player, Agent, Debug, and Forensic observations.

use er_types::battle_ids::MenuInstanceId;
use er_types::ui_menu::NavigationDirection;
use er_types::{MenuOptionId, SafeU53, SeatId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{ObservationProfile, causal::CausalGraphV1, digest::DiagnosticDigestTreeV1};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlayerVisibleStateV1 {
    pub seat: SeatId,
    pub canonical_visible_bytes: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlayerObservationV1 {
    pub sequence: SafeU53,
    pub virtual_time_ms: SafeU53,
    pub visible_state: PlayerVisibleStateV1,
    pub control_kind: Option<String>,
    pub presentation: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentMenuOptionV1 {
    pub option_id: MenuOptionId,
    pub enabled: bool,
    pub selected: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MenuNavigationEdgeV1 {
    pub from: MenuOptionId,
    pub direction: NavigationDirection,
    pub to: MenuOptionId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PhysicalInputPatternV1 {
    pub physical_key: String,
    pub effect: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StateDeltaV1 {
    pub from_sequence: SafeU53,
    pub to_sequence: SafeU53,
    pub visible_changed_paths: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentObservationV1 {
    pub player: PlayerObservationV1,
    pub menu_instance: Option<MenuInstanceId>,
    pub selected_option: Option<MenuOptionId>,
    pub options: Vec<AgentMenuOptionV1>,
    pub navigation: Vec<MenuNavigationEdgeV1>,
    pub accepted_physical_inputs: Vec<PhysicalInputPatternV1>,
    pub actionable_owner: Option<SeatId>,
    pub delta_from_sequence: Option<StateDeltaV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DebugObservationV1 {
    pub agent: AgentObservationV1,
    pub canonical_state_bytes: Vec<u8>,
    pub protocol_bytes: Option<Vec<u8>>,
    pub scheduler_bytes: Vec<u8>,
    pub rng_audit_bytes: Vec<u8>,
    pub pending_material_bytes: Vec<Vec<u8>>,
    pub live_resource_bytes: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ForensicObservationV1 {
    pub debug: DebugObservationV1,
    pub causal_graph: CausalGraphV1,
    pub diagnostic_digest_tree: DiagnosticDigestTreeV1,
    pub retained_external_events: Vec<Vec<u8>>,
    pub retained_internal_events: Vec<Vec<u8>>,
    pub performance_bytes: Vec<u8>,
    pub provenance: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(
    rename_all = "SCREAMING_SNAKE_CASE",
    tag = "profile",
    content = "observation"
)]
pub enum DeveloperObservationV1 {
    Player(PlayerObservationV1),
    Agent(AgentObservationV1),
    Debug(DebugObservationV1),
    Forensic(ForensicObservationV1),
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ObservationErrorV1 {
    #[error("requested observation profile exceeds session policy")]
    ProfileDenied,
    #[error("hidden-state observation requires explicit permission")]
    HiddenStateDenied,
    #[error("observation contains malformed sequence or navigation")]
    Invalid,
}

pub fn authorize_observation_v1(
    requested: ObservationProfile,
    maximum: ObservationProfile,
    allow_hidden_state: bool,
) -> Result<(), ObservationErrorV1> {
    if requested > maximum {
        return Err(ObservationErrorV1::ProfileDenied);
    }
    if requested >= ObservationProfile::Debug && !allow_hidden_state {
        return Err(ObservationErrorV1::HiddenStateDenied);
    }
    Ok(())
}
