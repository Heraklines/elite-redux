use er_canonical::{canonical_bytes, content_digest};
use er_state::m9e_state_v6::GameStateV6;
use er_types::{
    GameActionV1, GameContentIdentityV2, GameControlPlanV2, OperationId, SafeU53, SeatId,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const GAME_MATERIAL_SCHEMA_VERSION_V6: u32 = 6;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GameActionDomainV2 {
    NewRun,
    BattleTurn,
    BattleReplacement,
    RunProgram,
    Capture,
    Party,
    Progression,
    MoveLearning,
    Evolution,
    Fusion,
    Inventory,
    Reward,
    World,
    Scenario,
    SaveControl,
    Terminal,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameMutationEvidenceV2 {
    pub ordinal: u32,
    pub before_digest: String,
    pub after_digest: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameTransitionMaterialV6 {
    pub schema_version: u32,
    pub domain: GameActionDomainV2,
    pub operation_id: OperationId,
    pub authority_seat: SeatId,
    pub authority_revision: SafeU53,
    pub content_identity: GameContentIdentityV2,
    pub accepted_action: Option<GameActionV1>,
    pub before_digest: String,
    pub after_digest: String,
    pub mutations: Vec<GameMutationEvidenceV2>,
    pub rng_audit_bytes: Vec<u8>,
    pub after_state: GameStateV6,
    pub next_control: GameControlPlanV2,
    pub presentation_bytes: Vec<Vec<u8>>,
    pub platform_effect_bytes: Vec<Vec<u8>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GameMaterialV6 {
    NewRun(GameTransitionMaterialV6),
    BattleTurn(GameTransitionMaterialV6),
    BattleReplacement(GameTransitionMaterialV6),
    GameAction(GameTransitionMaterialV6),
    Terminal(GameTransitionMaterialV6),
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum GameMaterialV6Error {
    #[error("material V6 is invalid")]
    Invalid,
    #[error("material V6 canonical encoding failed: {0}")]
    Canonical(String),
    #[error("material V6 frontier differs")]
    Frontier,
}

impl GameMaterialV6 {
    pub fn transition(&self) -> &GameTransitionMaterialV6 {
        match self {
            Self::NewRun(v)
            | Self::BattleTurn(v)
            | Self::BattleReplacement(v)
            | Self::GameAction(v)
            | Self::Terminal(v) => v,
        }
    }
    pub fn canonical_bytes(&self) -> Result<Vec<u8>, GameMaterialV6Error> {
        self.validate()?;
        canonical_bytes(self).map_err(|e| GameMaterialV6Error::Canonical(e.to_string()))
    }
    pub fn decode(bytes: &[u8]) -> Result<Self, GameMaterialV6Error> {
        let value: Self =
            serde_json::from_slice(bytes).map_err(|_| GameMaterialV6Error::Invalid)?;
        if value.canonical_bytes()? != bytes {
            return Err(GameMaterialV6Error::Invalid);
        }
        Ok(value)
    }
    pub fn validate(&self) -> Result<(), GameMaterialV6Error> {
        let v = self.transition();
        if v.schema_version != GAME_MATERIAL_SCHEMA_VERSION_V6
            || v.operation_id.as_str().is_empty()
            || v.after_state.content_identity != v.content_identity
            || digest(&v.after_state)? != v.after_digest
            || v.presentation_bytes.iter().any(Vec::is_empty)
            || v.platform_effect_bytes.iter().any(Vec::is_empty)
        {
            return Err(GameMaterialV6Error::Invalid);
        }
        v.after_state
            .validate()
            .map_err(|_| GameMaterialV6Error::Invalid)
    }
}

pub fn apply_game_material_v6(
    live: &mut GameStateV6,
    bytes: &[u8],
) -> Result<bool, GameMaterialV6Error> {
    let material = GameMaterialV6::decode(bytes)?;
    let v = material.transition();
    if digest(live)? != v.before_digest {
        return Err(GameMaterialV6Error::Frontier);
    }
    *live = v.after_state.clone();
    Ok(true)
}
fn digest<T: Serialize>(value: &T) -> Result<String, GameMaterialV6Error> {
    content_digest(value)
        .map(|v| format!("blake3-v1:{v}"))
        .map_err(|e| GameMaterialV6Error::Canonical(e.to_string()))
}
