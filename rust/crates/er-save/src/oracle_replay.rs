//! Exact structural replay-trace vocabulary from the pinned M7 TypeScript oracle.

use serde::{Deserialize, Serialize};

pub const REPLAY_TRACE_VERSION_V2: u32 = 2;
pub const SUPPORTED_REPLAY_TRACE_VERSIONS: [u32; 2] = [1, 2];

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum OracleReplayCommandKindV2 {
    Move {
        move_index: i64,
        target: Option<i64>,
    },
    Switch {
        party_index: i64,
    },
    Ball {
        ball_index: i64,
    },
    Run,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum OracleReplayEventV2 {
    Command {
        wave: i64,
        turn: i64,
        slot_field_index: i64,
        command: OracleReplayCommandKindV2,
    },
    Interaction {
        seq: i64,
        kind: String,
        choice: i64,
        data: Option<Vec<i64>>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OracleReplayPokemonV2 {
    pub species: i64,
    pub level: i64,
    pub hp: i64,
    pub max_hp: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OracleReplayCheckpointV2 {
    pub wave: i64,
    pub seed: String,
    pub party: Vec<OracleReplayPokemonV2>,
    pub money: i64,
    pub pokeball_counts: Vec<(String, i64)>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OracleReplayEndStateV2 {
    pub wave_index: i64,
    pub money: i64,
    pub party: Vec<OracleReplayPokemonV2>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OracleReplayTraceV2 {
    pub version: u32,
    pub seed: String,
    pub game_mode_id: i64,
    pub difficulty: String,
    pub challenges: Vec<String>,
    pub roster: Vec<OracleReplayPokemonV2>,
    pub events: Vec<OracleReplayEventV2>,
    pub end_state: Option<OracleReplayEndStateV2>,
    pub checkpoint: Option<OracleReplayCheckpointV2>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OracleReplayValidationV2 {
    pub ok: bool,
    pub errors: Vec<String>,
}

impl OracleReplayEventV2 {
    pub const fn is_command(&self) -> bool {
        matches!(self, Self::Command { .. })
    }

    pub const fn is_interaction(&self) -> bool {
        matches!(self, Self::Interaction { .. })
    }
}

impl OracleReplayCommandKindV2 {
    pub const fn structurally_valid(&self) -> bool {
        true
    }
}

pub fn validate_oracle_replay_trace_v2(trace: &OracleReplayTraceV2) -> OracleReplayValidationV2 {
    let mut errors = Vec::new();
    if !SUPPORTED_REPLAY_TRACE_VERSIONS.contains(&trace.version) {
        errors.push(format!("unsupported trace version {}", trace.version));
    }
    if trace.seed.is_empty() {
        errors.push("missing run seed".to_owned());
    }
    if trace.roster.is_empty() {
        errors.push("empty roster".to_owned());
    }
    for (index, event) in trace.events.iter().enumerate() {
        match event {
            OracleReplayEventV2::Command { command, .. } => {
                if !command.structurally_valid() {
                    errors.push(format!("event[{index}] command: malformed command kind"));
                }
            }
            OracleReplayEventV2::Interaction { kind, .. } if kind.is_empty() => {
                errors.push(format!("event[{index}] interaction: kind malformed"));
            }
            OracleReplayEventV2::Interaction { .. } => {}
        }
    }
    if let Some(checkpoint) = &trace.checkpoint {
        if checkpoint.seed.is_empty() {
            errors.push("checkpoint present but missing a valid seed cursor".to_owned());
        }
        if checkpoint.party.is_empty() {
            errors.push("checkpoint present but has an empty party".to_owned());
        }
    }
    OracleReplayValidationV2 {
        ok: errors.is_empty(),
        errors,
    }
}

pub fn make_oracle_replay_trace_v2(
    seed: String,
    game_mode_id: i64,
    difficulty: Option<String>,
    challenges: Option<Vec<String>>,
    roster: Vec<OracleReplayPokemonV2>,
    events: Vec<OracleReplayEventV2>,
    end_state: Option<OracleReplayEndStateV2>,
    checkpoint: Option<OracleReplayCheckpointV2>,
) -> OracleReplayTraceV2 {
    OracleReplayTraceV2 {
        version: REPLAY_TRACE_VERSION_V2,
        seed,
        game_mode_id,
        difficulty: difficulty.unwrap_or_else(|| "youngster".to_owned()),
        challenges: challenges.unwrap_or_default(),
        roster,
        events,
        end_state,
        checkpoint,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pokemon() -> OracleReplayPokemonV2 {
        OracleReplayPokemonV2 {
            species: 1,
            level: 5,
            hp: 20,
            max_hp: 20,
        }
    }

    #[test]
    fn replay_trace_guards_and_validation_match_oracle_contract() {
        let command = OracleReplayEventV2::Command {
            wave: 1,
            turn: 0,
            slot_field_index: 0,
            command: OracleReplayCommandKindV2::Move {
                move_index: 0,
                target: None,
            },
        };
        let interaction = OracleReplayEventV2::Interaction {
            seq: 0,
            kind: "reward".to_owned(),
            choice: 0,
            data: None,
        };
        assert!(command.is_command());
        assert!(interaction.is_interaction());
        let trace = make_oracle_replay_trace_v2(
            "seed".to_owned(),
            0,
            None,
            None,
            vec![pokemon()],
            vec![command, interaction],
            None,
            None,
        );
        assert_eq!(trace.version, REPLAY_TRACE_VERSION_V2);
        assert!(validate_oracle_replay_trace_v2(&trace).ok);
    }
}
