//! Exact structural replay-trace vocabulary from the pinned M7 TypeScript oracle.
use std::collections::BTreeMap;

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
#[serde(untagged)]
pub enum OracleReplayModifierArgumentV2 {
    Bool(bool),
    Integer(i64),
    String(String),
    Integers(Vec<i64>),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OracleReplayModifierV2 {
    pub player: bool,
    pub type_id: String,
    pub type_pregen_args: Vec<OracleReplayModifierArgumentV2>,
    pub args: Vec<OracleReplayModifierArgumentV2>,
    pub stack_count: i64,
    pub class_name: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OracleReplayCheckpointV2 {
    pub wave: i64,
    pub seed: String,
    pub party: Vec<OracleReplayPokemonV2>,
    pub modifiers: Vec<OracleReplayModifierV2>,
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

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct OracleReplayTraceOptionsV2 {
    pub difficulty: Option<String>,
    pub challenges: Option<Vec<String>>,
    pub end_state: Option<OracleReplayEndStateV2>,
    pub checkpoint: Option<OracleReplayCheckpointV2>,
}

pub fn make_oracle_replay_trace_v2(
    seed: String,
    game_mode_id: i64,
    options: OracleReplayTraceOptionsV2,
    roster: Vec<OracleReplayPokemonV2>,
    events: Vec<OracleReplayEventV2>,
) -> OracleReplayTraceV2 {
    OracleReplayTraceV2 {
        version: REPLAY_TRACE_VERSION_V2,
        seed,
        game_mode_id,
        difficulty: options.difficulty.unwrap_or_else(|| "youngster".to_owned()),
        challenges: options.challenges.unwrap_or_default(),
        roster,
        events,
        end_state: options.end_state,
        checkpoint: options.checkpoint,
    }
}

pub const REPLAY_RECORDER_WAVE_WINDOW: i64 = 10;

#[derive(Clone, Debug, Eq, PartialEq)]
struct BufferedReplayEventV2 {
    wave: i64,
    event: OracleReplayEventV2,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct OracleReplayRecorderV2 {
    header: Option<OracleReplayTraceV2>,
    buffer: Vec<BufferedReplayEventV2>,
    highest_wave: i64,
    checkpoints: BTreeMap<i64, OracleReplayCheckpointV2>,
}

impl OracleReplayRecorderV2 {
    pub fn is_recording(&self) -> bool {
        self.header.is_some()
    }

    pub fn begin(&mut self, header: OracleReplayTraceV2) {
        if self
            .header
            .as_ref()
            .is_some_and(|current| current.seed == header.seed)
        {
            return;
        }
        self.header = Some(header);
        self.buffer.clear();
        self.highest_wave = 0;
        self.checkpoints.clear();
    }

    pub fn clear(&mut self) {
        self.header = None;
        self.buffer.clear();
        self.highest_wave = 0;
        self.checkpoints.clear();
    }

    pub fn record_checkpoint(&mut self, checkpoint: OracleReplayCheckpointV2) {
        if self.header.is_none() {
            return;
        }
        self.highest_wave = self.highest_wave.max(checkpoint.wave);
        self.checkpoints
            .entry(checkpoint.wave)
            .or_insert(checkpoint);
        self.prune_old_waves();
    }

    pub fn record_command(&mut self, event: OracleReplayEventV2) {
        let OracleReplayEventV2::Command { wave, .. } = event else {
            return;
        };
        if self.header.is_none() {
            return;
        }
        self.highest_wave = self.highest_wave.max(wave);
        self.buffer.push(BufferedReplayEventV2 { wave, event });
        self.prune_old_waves();
    }

    pub fn record_interaction(&mut self, wave: i64, event: OracleReplayEventV2) {
        if self.header.is_none() || !event.is_interaction() {
            return;
        }
        self.highest_wave = self.highest_wave.max(wave);
        self.buffer.push(BufferedReplayEventV2 { wave, event });
        self.prune_old_waves();
    }

    pub fn trace(&self) -> Option<OracleReplayTraceV2> {
        let mut trace = self.header.clone()?;
        trace.events = self
            .buffer
            .iter()
            .map(|entry| entry.event.clone())
            .collect();
        trace.checkpoint = self.window_start_checkpoint().cloned();
        Some(trace)
    }

    fn prune_old_waves(&mut self) {
        let Some(cutoff) = self
            .highest_wave
            .checked_sub(REPLAY_RECORDER_WAVE_WINDOW)
            .and_then(|value| value.checked_add(1))
        else {
            return;
        };
        if cutoff <= 0 {
            return;
        }
        self.buffer.retain(|entry| entry.wave >= cutoff);
        self.checkpoints.retain(|wave, _| *wave >= cutoff);
    }

    fn window_start_checkpoint(&self) -> Option<&OracleReplayCheckpointV2> {
        let window_start = self
            .buffer
            .iter()
            .map(|entry| entry.wave)
            .min()
            .unwrap_or(self.highest_wave);
        self.checkpoints
            .range(..=window_start)
            .next_back()
            .map(|(_, checkpoint)| checkpoint)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OraclePlayerCommandV2 {
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

pub fn player_command_to_replay_kind_v2(
    command: OraclePlayerCommandV2,
) -> OracleReplayCommandKindV2 {
    match command {
        OraclePlayerCommandV2::Move { move_index, target } => {
            OracleReplayCommandKindV2::Move { move_index, target }
        }
        OraclePlayerCommandV2::Switch { party_index } => {
            OracleReplayCommandKindV2::Switch { party_index }
        }
        OraclePlayerCommandV2::Ball { ball_index } => {
            OracleReplayCommandKindV2::Ball { ball_index }
        }
        OraclePlayerCommandV2::Run => OracleReplayCommandKindV2::Run,
    }
}

pub fn capture_single_player_end_state_v2(
    wave_index: i64,
    money: i64,
    party: Vec<OracleReplayPokemonV2>,
) -> OracleReplayEndStateV2 {
    OracleReplayEndStateV2 {
        wave_index,
        money,
        party,
    }
}

pub fn capture_replay_checkpoint_v2(
    wave: i64,
    seed: String,
    party: Vec<OracleReplayPokemonV2>,
    modifiers: Vec<OracleReplayModifierV2>,
    money: i64,
    pokeball_counts: Vec<(String, i64)>,
) -> OracleReplayCheckpointV2 {
    OracleReplayCheckpointV2 {
        wave,
        seed,
        party,
        modifiers,
        money,
        pokeball_counts,
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SinglePlayerReplayRuntimeV2 {
    recording_seed: Option<String>,
    interaction_seq: i64,
}

impl SinglePlayerReplayRuntimeV2 {
    pub fn maybe_begin(
        &mut self,
        recorder: &mut OracleReplayRecorderV2,
        is_coop: bool,
        is_classic: bool,
        trace: OracleReplayTraceV2,
    ) -> bool {
        if is_coop || !is_classic {
            return false;
        }
        if recorder.is_recording() && self.recording_seed.as_ref() == Some(&trace.seed) {
            return false;
        }
        self.recording_seed = Some(trace.seed.clone());
        self.interaction_seq = 0;
        recorder.begin(trace);
        true
    }

    pub fn maybe_capture_checkpoint(
        &self,
        recorder: &mut OracleReplayRecorderV2,
        checkpoint: Option<OracleReplayCheckpointV2>,
    ) -> bool {
        if !recorder.is_recording() {
            return false;
        }
        let Some(checkpoint) = checkpoint else {
            return false;
        };
        recorder.record_checkpoint(checkpoint);
        true
    }

    pub fn record_command(
        &self,
        recorder: &mut OracleReplayRecorderV2,
        is_coop: bool,
        wave: i64,
        turn: i64,
        slot_field_index: i64,
        command: Option<OraclePlayerCommandV2>,
    ) -> bool {
        if is_coop || !recorder.is_recording() {
            return false;
        }
        let Some(command) = command else {
            return false;
        };
        recorder.record_command(OracleReplayEventV2::Command {
            wave,
            turn,
            slot_field_index,
            command: player_command_to_replay_kind_v2(command),
        });
        true
    }

    pub fn record_interaction(
        &mut self,
        recorder: &mut OracleReplayRecorderV2,
        is_coop: bool,
        current_wave: i64,
        kind: String,
        choice: i64,
        data: Option<Vec<i64>>,
    ) -> bool {
        if is_coop || !recorder.is_recording() {
            return false;
        }
        let seq = self.interaction_seq;
        let Some(next_seq) = seq.checked_add(1) else {
            return false;
        };
        recorder.record_interaction(
            current_wave,
            OracleReplayEventV2::Interaction {
                seq,
                kind,
                choice,
                data,
            },
        );
        self.interaction_seq = next_seq;
        true
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
            OracleReplayTraceOptionsV2::default(),
            vec![pokemon()],
            vec![command, interaction],
        );
        assert_eq!(trace.version, REPLAY_TRACE_VERSION_V2);
        assert_eq!(trace.difficulty, "youngster");
        assert!(trace.challenges.is_empty());
        assert!(validate_oracle_replay_trace_v2(&trace).ok);
        let configured = make_oracle_replay_trace_v2(
            "seed".to_owned(),
            0,
            OracleReplayTraceOptionsV2 {
                difficulty: Some("elite".to_owned()),
                challenges: Some(vec!["challenge".to_owned()]),
                ..Default::default()
            },
            trace.roster.clone(),
            trace.events.clone(),
        );
        assert_eq!(configured.difficulty, "elite");
        assert_eq!(configured.challenges, ["challenge"]);
        assert_eq!(configured.roster, trace.roster);
        assert_eq!(configured.events, trace.events);
    }

    #[test]
    fn replay_recorder_is_idempotent_and_wave_bounded() -> Result<(), &'static str> {
        let header = make_oracle_replay_trace_v2(
            "seed".to_owned(),
            0,
            OracleReplayTraceOptionsV2::default(),
            vec![pokemon()],
            Vec::new(),
        );
        let mut recorder = OracleReplayRecorderV2::default();
        recorder.begin(header.clone());
        recorder.begin(header);
        assert!(recorder.is_recording());
        for wave in 1..=12 {
            recorder.record_command(OracleReplayEventV2::Command {
                wave,
                turn: 0,
                slot_field_index: 0,
                command: OracleReplayCommandKindV2::Run,
            });
        }
        let trace = recorder.trace().expect("trace");
        assert_eq!(trace.events.len(), 10);
        let OracleReplayEventV2::Command { wave, .. } = &trace.events[0] else {
            return Err("expected retained command event");
        };
        assert_eq!(*wave, 3);
        recorder.clear();
        assert!(!recorder.is_recording());
        Ok(())
    }

    #[test]
    fn single_player_capture_helpers_preserve_command_and_state() {
        let end = capture_single_player_end_state_v2(12, 500, vec![pokemon()]);
        let checkpoint = capture_replay_checkpoint_v2(
            3,
            "checkpoint".to_owned(),
            vec![pokemon()],
            Vec::new(),
            200,
            vec![("poke-ball".to_owned(), 2)],
        );
        let trace = make_oracle_replay_trace_v2(
            "seed".to_owned(),
            0,
            OracleReplayTraceOptionsV2 {
                end_state: Some(end),
                ..Default::default()
            },
            vec![pokemon()],
            Vec::new(),
        );
        let mut recorder = OracleReplayRecorderV2::default();
        let mut runtime = SinglePlayerReplayRuntimeV2::default();
        assert!(!runtime.maybe_begin(&mut recorder, true, true, trace.clone()));
        assert!(runtime.maybe_begin(&mut recorder, false, true, trace.clone()));
        assert!(!runtime.maybe_begin(&mut recorder, false, true, trace));
        assert!(runtime.maybe_capture_checkpoint(&mut recorder, Some(checkpoint)));
        assert!(runtime.record_command(
            &mut recorder,
            false,
            3,
            0,
            0,
            Some(OraclePlayerCommandV2::Run),
        ));
        assert!(!runtime.record_command(&mut recorder, true, 3, 0, 0, None));
        assert!(runtime.record_interaction(&mut recorder, false, 3, "reward".to_owned(), 1, None,));
        assert!(!runtime.record_interaction(&mut recorder, true, 3, "reward".to_owned(), 2, None,));
        let recorded = recorder.trace().expect("trace");
        assert_eq!(recorded.events.len(), 2);
        assert!(recorded.events[0].is_command());
        assert!(recorded.events[1].is_interaction());
        assert_eq!(recorded.end_state.expect("end").wave_index, 12);
        assert_eq!(recorded.checkpoint.expect("checkpoint").modifiers.len(), 0);
    }
}
