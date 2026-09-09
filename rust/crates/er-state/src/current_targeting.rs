//! Admission retained only by a fresh, explicitly known normal Classic run.
//!
//! This record does not infer ability neutrality. The current battle bridge must
//! resolve the live roster, source capability catalog and shared profile on every
//! offer/command/execution. Historical absence remains unknown and byte preserving.
use er_types::battle_ids::GameModeId;
use er_types::run_ids::GameRunId;
use er_types::SeatId;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CurrentTargetingOriginV1 {
    FreshNormalClassic,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentTargetingV1 {
    pub run_id: GameRunId,
    pub mode: GameModeId,
    pub profile_owner: SeatId,
    pub origin: CurrentTargetingOriginV1,
}

/// Exact shipped content used for the source capability observations. A custom
/// pack carrying the same oracle commit cannot borrow this admission.
pub fn matches_current_target_content(identity: &er_types::GameContentIdentityV2) -> bool {
    identity.oracle_sha.as_str() == "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7"
        && identity.bundle_hash.as_str() == "blake3-v1:e0f6c983166996dff2c0ee4ba3fcf88a262d0b89477f1d02c2c4a19298be4a8c"
        && identity.battle_hash.as_str() == "blake3-v3:93516be1f9dcfc9b19f48b3ca221d56e2c80111cf580f07adf398816f18c2330"
}