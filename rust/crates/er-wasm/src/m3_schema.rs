//! Native/wasm32 schema parity for the frozen M3 foundation DTOs.
//!
//! This module is deliberately only a JSON-string boundary over production
//! types. It does not define a parallel wire envelope, repair malformed input,
//! or reproduce validation outside the crate that owns each DTO.

use std::fmt;

use er_canonical::canonicalize;
use er_content::pack::ContentPack;
use er_rng::audit::{RngAuditState, RngDraw};
use er_rng::battle::BattleRngState;
use er_rng::phaser::{F64Bits, PhaserRdgState, RunRngState};
use er_state::battle::BattleState;
use er_state::pokemon::PokemonState;
use er_state::snapshot::GameState;
use er_state::validation::validate_battle_state;
use er_types::TailProofBody;
use er_types::battle_command::{
    BattleCommand, BattleCommandOffer, BattleCommandProposalV1, BattleReplacementProposalV1,
    CommandCollectionState, ScriptedEnemyBattleCommandV1, ScriptedEnemyPolicyV1,
};
use er_types::battle_control::{BattleControl, BattleControlPlan};
use er_types::battle_ui::{
    BattleMenu, BattlePresentationEvent, BattlePresentationKind, BattleUiProjection,
};
use wasm_bindgen::prelude::*;

/// Version of the evidence-only M3 schema registry.
pub const M3_SCHEMA_PARITY_VERSION: u32 = 1;

/// Closed names accepted by [`round_trip_m3_schema_json`].
///
/// The names are Rust DTO names rather than newly invented wire tags. Nested
/// DTOs are listed so callers can isolate a schema failure without wrapping it
/// in a larger production value.
pub const M3_SCHEMA_TYPES: &[&str] = &[
    "BattleCommand",
    "BattleCommandOffer",
    "BattleCommandProposalV1",
    "BattleControl",
    "BattleControlPlan",
    "BattleMenu",
    "BattlePresentationEvent",
    "BattlePresentationKind",
    "BattleReplacementProposalV1",
    "BattleRngState",
    "BattleState",
    "BattleUiProjection",
    "CommandCollectionState",
    "ContentPack",
    "F64Bits",
    "GameState",
    "PhaserRdgState",
    "PokemonState",
    "RngAuditState",
    "RngDraw",
    "RunRngState",
    "ScriptedEnemyBattleCommandV1",
    "ScriptedEnemyPolicyV1",
    "TailProofBody",
];

/// A failure at the shared typed JSON boundary.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum M3SchemaError {
    UnknownSchema {
        schema: String,
    },
    Decode {
        schema: &'static str,
        stage: &'static str,
        reason: String,
    },
    Validation {
        schema: &'static str,
        stage: &'static str,
        reason: String,
    },
    Canonical {
        schema: &'static str,
        stage: &'static str,
        reason: String,
    },
    NonIdempotent {
        schema: &'static str,
    },
}

impl fmt::Display for M3SchemaError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownSchema { schema } => {
                write!(formatter, "unknown M3 schema type {schema:?}")
            }
            Self::Decode {
                schema,
                stage,
                reason,
            } => write!(
                formatter,
                "could not decode {schema} during {stage}: {reason}"
            ),
            Self::Validation {
                schema,
                stage,
                reason,
            } => write!(
                formatter,
                "{schema} failed validation during {stage}: {reason}"
            ),
            Self::Canonical {
                schema,
                stage,
                reason,
            } => write!(
                formatter,
                "could not canonicalize {schema} during {stage}: {reason}"
            ),
            Self::NonIdempotent { schema } => write!(
                formatter,
                "{schema} changed across a typed canonical JSON round-trip"
            ),
        }
    }
}

impl std::error::Error for M3SchemaError {}

macro_rules! round_trip_typed {
    ($schema:expr, $input:expr, $type:ty) => {{
        let value: $type = serde_json::from_str($input).map_err(|error| M3SchemaError::Decode {
            schema: $schema,
            stage: "input",
            reason: error.to_string(),
        })?;
        let canonical = canonicalize(&value).map_err(|error| M3SchemaError::Canonical {
            schema: $schema,
            stage: "input",
            reason: error.to_string(),
        })?;
        let round_tripped: $type =
            serde_json::from_str(&canonical).map_err(|error| M3SchemaError::Decode {
                schema: $schema,
                stage: "canonical output",
                reason: error.to_string(),
            })?;
        let recanonical =
            canonicalize(&round_tripped).map_err(|error| M3SchemaError::Canonical {
                schema: $schema,
                stage: "canonical output",
                reason: error.to_string(),
            })?;
        if recanonical != canonical {
            Err(M3SchemaError::NonIdempotent { schema: $schema })
        } else {
            Ok(canonical)
        }
    }};
}

macro_rules! round_trip_validated {
    ($schema:expr, $input:expr, $type:ty, $validator:path) => {{
        let value: $type = serde_json::from_str($input).map_err(|error| M3SchemaError::Decode {
            schema: $schema,
            stage: "input",
            reason: error.to_string(),
        })?;
        $validator(&value).map_err(|error| M3SchemaError::Validation {
            schema: $schema,
            stage: "input",
            reason: error.to_string(),
        })?;
        let canonical = canonicalize(&value).map_err(|error| M3SchemaError::Canonical {
            schema: $schema,
            stage: "input",
            reason: error.to_string(),
        })?;
        let round_tripped: $type =
            serde_json::from_str(&canonical).map_err(|error| M3SchemaError::Decode {
                schema: $schema,
                stage: "canonical output",
                reason: error.to_string(),
            })?;
        $validator(&round_tripped).map_err(|error| M3SchemaError::Validation {
            schema: $schema,
            stage: "canonical output",
            reason: error.to_string(),
        })?;
        let recanonical =
            canonicalize(&round_tripped).map_err(|error| M3SchemaError::Canonical {
                schema: $schema,
                stage: "canonical output",
                reason: error.to_string(),
            })?;
        if recanonical != canonical {
            Err(M3SchemaError::NonIdempotent { schema: $schema })
        } else {
            Ok(canonical)
        }
    }};
}

/// Decode one named production DTO, validate it through its owning crate, and
/// return its compact strict canonical JSON. Re-decoding and canonicalizing the
/// result must be byte-idempotent.
pub fn round_trip_m3_schema_json(schema: &str, input: &str) -> Result<String, M3SchemaError> {
    match schema {
        "BattleCommand" => round_trip_validated!(
            "BattleCommand",
            input,
            BattleCommand,
            BattleCommand::validate
        ),
        "BattleCommandOffer" => round_trip_validated!(
            "BattleCommandOffer",
            input,
            BattleCommandOffer,
            BattleCommandOffer::validate
        ),
        "BattleCommandProposalV1" => round_trip_validated!(
            "BattleCommandProposalV1",
            input,
            BattleCommandProposalV1,
            BattleCommandProposalV1::validate
        ),
        "BattleControl" => round_trip_validated!(
            "BattleControl",
            input,
            BattleControl,
            BattleControl::validate
        ),
        "BattleControlPlan" => round_trip_validated!(
            "BattleControlPlan",
            input,
            BattleControlPlan,
            BattleControlPlan::validate
        ),
        "BattleMenu" => {
            round_trip_validated!("BattleMenu", input, BattleMenu, BattleMenu::validate)
        }
        "BattlePresentationEvent" => {
            round_trip_typed!("BattlePresentationEvent", input, BattlePresentationEvent)
        }
        "BattlePresentationKind" => {
            round_trip_typed!("BattlePresentationKind", input, BattlePresentationKind)
        }
        "BattleReplacementProposalV1" => round_trip_validated!(
            "BattleReplacementProposalV1",
            input,
            BattleReplacementProposalV1,
            BattleReplacementProposalV1::validate
        ),
        "BattleRngState" => round_trip_validated!(
            "BattleRngState",
            input,
            BattleRngState,
            BattleRngState::validate
        ),
        "BattleState" => {
            round_trip_validated!("BattleState", input, BattleState, validate_battle_state)
        }
        "BattleUiProjection" => round_trip_validated!(
            "BattleUiProjection",
            input,
            BattleUiProjection,
            BattleUiProjection::validate
        ),
        "CommandCollectionState" => round_trip_validated!(
            "CommandCollectionState",
            input,
            CommandCollectionState,
            CommandCollectionState::validate
        ),
        "ContentPack" => {
            round_trip_validated!("ContentPack", input, ContentPack, ContentPack::validate)
        }
        "F64Bits" => round_trip_typed!("F64Bits", input, F64Bits),
        "GameState" => {
            round_trip_validated!("GameState", input, GameState, GameState::validate)
        }
        "PhaserRdgState" => round_trip_validated!(
            "PhaserRdgState",
            input,
            PhaserRdgState,
            PhaserRdgState::validate
        ),
        "PokemonState" => {
            round_trip_validated!("PokemonState", input, PokemonState, PokemonState::validate)
        }
        "RngAuditState" => round_trip_validated!(
            "RngAuditState",
            input,
            RngAuditState,
            RngAuditState::validate
        ),
        "RngDraw" => round_trip_validated!("RngDraw", input, RngDraw, RngDraw::validate),
        "RunRngState" => round_trip_typed!("RunRngState", input, RunRngState),
        "ScriptedEnemyBattleCommandV1" => round_trip_validated!(
            "ScriptedEnemyBattleCommandV1",
            input,
            ScriptedEnemyBattleCommandV1,
            ScriptedEnemyBattleCommandV1::validate
        ),
        "ScriptedEnemyPolicyV1" => round_trip_validated!(
            "ScriptedEnemyPolicyV1",
            input,
            ScriptedEnemyPolicyV1,
            ScriptedEnemyPolicyV1::validate
        ),
        "TailProofBody" => round_trip_typed!("TailProofBody", input, TailProofBody),
        _ => Err(M3SchemaError::UnknownSchema {
            schema: schema.to_owned(),
        }),
    }
}

/// wasm-bindgen wrapper over the same native implementation.
#[wasm_bindgen(js_name = roundTripM3SchemaJson)]
pub fn round_trip_m3_schema_json_wasm(schema: &str, input: &str) -> Result<String, JsValue> {
    round_trip_m3_schema_json(schema, input).map_err(|error| JsValue::from_str(&error.to_string()))
}
