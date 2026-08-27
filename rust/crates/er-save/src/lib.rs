//! Versioned canonical M7 save and replay schemas.

use er_canonical::canonical_bytes;
use er_state::m7_state::{GAME_STATE_SCHEMA_VERSION_V5, GameStateV5, ProfileStateV1, RunStateV3};
use er_types::{GameContentBundleHash, GameContentIdentity, RawInputEvent, SafeU53, SaveChecksum};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const GAME_SAVE_SCHEMA_VERSION_V1: u32 = 1;
pub const GAME_REPLAY_SCHEMA_VERSION_V1: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameSaveV1 {
    pub schema_version: u32,
    pub game_content_hash: GameContentBundleHash,
    pub profile: ProfileStateV1,
    pub run: Option<RunStateV3>,
    pub checksum: SaveChecksum,
}

#[derive(Serialize)]
struct SaveChecksumView<'a> {
    schema_version: u32,
    game_content_hash: &'a GameContentBundleHash,
    profile: &'a ProfileStateV1,
    run: &'a Option<RunStateV3>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayEventEnvelopeV1 {
    pub sequence: SafeU53,
    pub event: ReplayEventV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum ReplayEventV1 {
    RawInput(RawInputEvent),
    NetworkFrame {
        peer: er_types::SeatId,
        bytes: Vec<u8>,
    },
    AdvanceTime {
        milliseconds: SafeU53,
    },
    PresentationSettled {
        event_id: String,
        outcome: ReplayPresentationOutcomeV1,
    },
    StorageResult {
        request: SafeU53,
        result: ReplayStorageResultV1,
    },
    TransportChanged {
        peer: er_types::SeatId,
        connected: bool,
    },
    Suspend,
    Resume,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplayPresentationOutcomeV1 {
    Settled,
    IntentionallySkipped,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum ReplayStorageResultV1 {
    Read(Option<Vec<u8>>),
    Written,
    Deleted,
    Slots(Vec<String>),
    Failed(String),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameReplayV1 {
    pub schema_version: u32,
    pub game_content_hash: GameContentBundleHash,
    pub initial_state: GameStateV5,
    pub events: Vec<ReplayEventEnvelopeV1>,
    pub expected_digests: Vec<String>,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReplayDivergenceV1 {
    pub sequence: SafeU53,
    pub expected_digest: String,
    pub actual_digest: String,
    pub event: ReplayEventV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReplayReportV1 {
    pub applied_events: usize,
    pub divergence: Option<ReplayDivergenceV1>,
}

pub trait ReplayMachineV1 {
    type Error: std::fmt::Display;

    fn apply(&mut self, event: &ReplayEventV1) -> Result<(), Self::Error>;
    fn mechanical_digest(&self) -> Result<String, Self::Error>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SaveStorageEffectV1 {
    Read { slot: String },
    Write { slot: String, bytes: Vec<u8> },
    Delete { slot: String },
    ListSlots,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SaveError {
    #[error("save schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("save content hash differs from prepared content")]
    ContentHash,
    #[error("save checksum is invalid")]
    Checksum,
    #[error("save state is invalid: {0}")]
    State(String),
    #[error("canonical save encoding failed: {0}")]
    Canonical(String),
    #[error("save decoding failed: {0}")]
    Decode(String),
    #[error("replay schema, event order, payload, or digest closure is invalid")]
    Replay,
    #[error("replay machine failed: {0}")]
    ReplayMachine(String),
    #[error("storage slot names and failures cannot be empty")]
    StorageKey,
}

impl GameSaveV1 {
    pub fn new(
        content_identity: &GameContentIdentity,
        profile: ProfileStateV1,
        run: Option<RunStateV3>,
    ) -> Result<Self, SaveError> {
        let mut value = Self {
            schema_version: GAME_SAVE_SCHEMA_VERSION_V1,
            game_content_hash: content_identity.content_hash.clone(),
            profile,
            run,
            checksum: SaveChecksum::parse(format!("sha256-v1:{}", "0".repeat(64)))
                .map_err(|error| SaveError::Canonical(error.to_string()))?,
        };
        value.checksum = value.recompute_checksum()?;
        value.validate(content_identity)?;
        Ok(value)
    }

    pub fn validate(&self, content_identity: &GameContentIdentity) -> Result<(), SaveError> {
        if self.schema_version != GAME_SAVE_SCHEMA_VERSION_V1 {
            return Err(SaveError::SchemaVersion {
                expected: GAME_SAVE_SCHEMA_VERSION_V1,
                actual: self.schema_version,
            });
        }
        if self.game_content_hash != content_identity.content_hash {
            return Err(SaveError::ContentHash);
        }
        if self.recompute_checksum()? != self.checksum {
            return Err(SaveError::Checksum);
        }
        GameStateV5 {
            schema_version: GAME_STATE_SCHEMA_VERSION_V5,
            content_identity: content_identity.clone(),
            profile: self.profile.clone(),
            active_run: self.run.clone(),
        }
        .validate()
        .map_err(|error| SaveError::State(error.to_string()))
    }

    pub fn recompute_checksum(&self) -> Result<SaveChecksum, SaveError> {
        let view = SaveChecksumView {
            schema_version: self.schema_version,
            game_content_hash: &self.game_content_hash,
            profile: &self.profile,
            run: &self.run,
        };
        let bytes =
            canonical_bytes(&view).map_err(|error| SaveError::Canonical(error.to_string()))?;
        let digest = Sha256::digest(bytes);
        SaveChecksum::parse(format!("sha256-v1:{digest:x}"))
            .map_err(|error| SaveError::Canonical(error.to_string()))
    }

    pub fn canonical_bytes(&self) -> Result<Vec<u8>, SaveError> {
        canonical_bytes(self).map_err(|error| SaveError::Canonical(error.to_string()))
    }

    pub fn decode_canonical(
        bytes: &[u8],
        content_identity: &GameContentIdentity,
    ) -> Result<Self, SaveError> {
        let value: Self =
            serde_json::from_slice(bytes).map_err(|error| SaveError::Decode(error.to_string()))?;
        if value.canonical_bytes()? != bytes {
            return Err(SaveError::Canonical(
                "input bytes are not canonical".to_owned(),
            ));
        }
        value.validate(content_identity)?;
        Ok(value)
    }
}

impl GameReplayV1 {
    pub fn validate(&self, content_identity: &GameContentIdentity) -> Result<(), SaveError> {
        if self.schema_version != GAME_REPLAY_SCHEMA_VERSION_V1
            || self.game_content_hash != content_identity.content_hash
            || self.expected_digests.len() != self.events.len()
            || self
                .events
                .windows(2)
                .any(|pair| pair[0].sequence >= pair[1].sequence)
            || self.expected_digests.iter().any(|digest| {
                !digest.starts_with("blake3-v1:") || digest.len() != "blake3-v1:".len() + 64
            })
            || self
                .events
                .iter()
                .any(|entry| !replay_event_valid(&entry.event))
        {
            return Err(SaveError::Replay);
        }
        self.initial_state
            .validate()
            .map_err(|error| SaveError::State(error.to_string()))?;
        if self.initial_state.content_identity != *content_identity {
            return Err(SaveError::ContentHash);
        }
        Ok(())
    }
}
pub fn replay_first_divergence_v1<M: ReplayMachineV1>(
    replay: &GameReplayV1,
    content_identity: &GameContentIdentity,
    machine: &mut M,
) -> Result<ReplayReportV1, SaveError> {
    replay.validate(content_identity)?;
    for (index, envelope) in replay.events.iter().enumerate() {
        machine
            .apply(&envelope.event)
            .map_err(|error| SaveError::ReplayMachine(error.to_string()))?;
        let actual = machine
            .mechanical_digest()
            .map_err(|error| SaveError::ReplayMachine(error.to_string()))?;
        let expected = &replay.expected_digests[index];
        if &actual != expected {
            return Ok(ReplayReportV1 {
                applied_events: index + 1,
                divergence: Some(ReplayDivergenceV1 {
                    sequence: envelope.sequence,
                    expected_digest: expected.clone(),
                    actual_digest: actual,
                    event: envelope.event.clone(),
                }),
            });
        }
    }
    Ok(ReplayReportV1 {
        applied_events: replay.events.len(),
        divergence: None,
    })
}

impl SaveStorageEffectV1 {
    pub fn validate(&self) -> Result<(), SaveError> {
        let key = match self {
            Self::Read { slot } | Self::Write { slot, .. } | Self::Delete { slot } => Some(slot),
            Self::ListSlots => None,
        };
        if key.is_some_and(String::is_empty) {
            return Err(SaveError::StorageKey);
        }
        Ok(())
    }
}

fn replay_event_valid(event: &ReplayEventV1) -> bool {
    match event {
        ReplayEventV1::NetworkFrame { bytes, .. } => !bytes.is_empty(),
        ReplayEventV1::PresentationSettled { event_id, .. } => !event_id.is_empty(),
        ReplayEventV1::StorageResult {
            result: ReplayStorageResultV1::Slots(slots),
            ..
        } => {
            slots.windows(2).all(|pair| pair[0] < pair[1])
                && slots.iter().all(|slot| !slot.is_empty())
        }
        ReplayEventV1::StorageResult {
            result: ReplayStorageResultV1::Failed(message),
            ..
        } => !message.is_empty(),
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use er_state::m7_state::{
        DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
    };
    use er_types::battle_ids::WaveIndex;
    use er_types::{
        BattleContentPackHashV3, CatalogHash, GameContentBundleHash, GameContentIdentity,
        OracleSha, SafeU53,
    };

    use super::{GameSaveV1, SaveError};

    fn content_identity() -> GameContentIdentity {
        GameContentIdentity {
            oracle_sha: OracleSha::parse("399d5d368f0b5642ebf8f45bd8a5e73350fa4de7")
                .expect("oracle"),
            content_hash: GameContentBundleHash::parse(format!("blake3-v1:{}", "a".repeat(64)))
                .expect("game hash"),
            battle_content_hash: BattleContentPackHashV3::parse(format!(
                "blake3-v3:{}",
                "b".repeat(64)
            ))
            .expect("battle hash"),
            semantic_catalog_hash: CatalogHash::parse("c".repeat(64)).expect("semantic hash"),
        }
    }

    fn profile() -> ProfileStateV1 {
        ProfileStateV1 {
            schema_version: PROFILE_STATE_SCHEMA_VERSION_V1,
            unlocks: Vec::new(),
            achievements: Vec::new(),
            challenges: Vec::new(),
            flags: Default::default(),
            statistics: ProfileStatistics {
                runs_started: SafeU53::ZERO,
                runs_won: SafeU53::ZERO,
                runs_lost: SafeU53::ZERO,
                battles_won: SafeU53::ZERO,
                pokemon_captured: SafeU53::ZERO,
                highest_wave: WaveIndex::new(SafeU53::new(1).expect("wave"))
                    .expect("positive wave"),
            },
            dex: DexState::default(),
        }
    }

    #[test]
    fn canonical_save_round_trips_with_checksum() {
        let identity = content_identity();
        let save = GameSaveV1::new(&identity, profile(), None).expect("save");
        let bytes = save.canonical_bytes().expect("canonical bytes");
        let decoded = GameSaveV1::decode_canonical(&bytes, &identity).expect("decoded save");
        assert_eq!(decoded, save);
    }

    #[test]
    fn changed_state_with_stale_checksum_fails_closed() {
        let identity = content_identity();
        let mut save = GameSaveV1::new(&identity, profile(), None).expect("save");
        save.profile.statistics.runs_started = SafeU53::new(1).expect("safe statistics counter");
        assert_eq!(save.validate(&identity), Err(SaveError::Checksum));
    }
}
