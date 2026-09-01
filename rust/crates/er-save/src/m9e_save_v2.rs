use er_canonical::canonical_bytes;
use er_state::m9e_state_v6::GameStateV6;
use er_types::{GameContentIdentityV2, SafeU53, SaveChecksum};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
pub const GAME_SAVE_SCHEMA_VERSION_V2: u32 = 2;
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameSaveV2 {
    pub schema_version: u32,
    pub content_identity: GameContentIdentityV2,
    pub generation: SafeU53,
    pub state: GameStateV6,
    pub checksum: SaveChecksum,
}
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum GameSaveV2Error {
    #[error("save V2 is invalid")]
    Invalid,
    #[error("save V2 canonical encoding failed: {0}")]
    Canonical(String),
}
#[derive(Serialize)]
struct ChecksumView<'a> {
    schema_version: u32,
    content_identity: &'a GameContentIdentityV2,
    generation: SafeU53,
    state: &'a GameStateV6,
}
impl GameSaveV2 {
    pub fn new(
        content_identity: GameContentIdentityV2,
        generation: SafeU53,
        state: GameStateV6,
    ) -> Result<Self, GameSaveV2Error> {
        let checksum = checksum(&ChecksumView {
            schema_version: GAME_SAVE_SCHEMA_VERSION_V2,
            content_identity: &content_identity,
            generation,
            state: &state,
        })?;
        let value = Self {
            schema_version: GAME_SAVE_SCHEMA_VERSION_V2,
            content_identity,
            generation,
            state,
            checksum,
        };
        value.validate()?;
        Ok(value)
    }
    pub fn validate(&self) -> Result<(), GameSaveV2Error> {
        if self.schema_version != GAME_SAVE_SCHEMA_VERSION_V2
            || self.generation == SafeU53::ZERO
            || self.state.content_identity != self.content_identity
            || self.checksum
                != checksum(&ChecksumView {
                    schema_version: self.schema_version,
                    content_identity: &self.content_identity,
                    generation: self.generation,
                    state: &self.state,
                })?
        {
            return Err(GameSaveV2Error::Invalid);
        }
        self.state.validate().map_err(|_| GameSaveV2Error::Invalid)
    }
    pub fn encode(&self) -> Result<Vec<u8>, GameSaveV2Error> {
        self.validate()?;
        canonical_bytes(self).map_err(|e| GameSaveV2Error::Canonical(e.to_string()))
    }
    pub fn decode(bytes: &[u8]) -> Result<Self, GameSaveV2Error> {
        let value: Self = serde_json::from_slice(bytes).map_err(|_| GameSaveV2Error::Invalid)?;
        if value.encode()? != bytes {
            return Err(GameSaveV2Error::Invalid);
        }
        Ok(value)
    }
}
fn checksum<T: Serialize>(value: &T) -> Result<SaveChecksum, GameSaveV2Error> {
    let bytes =
        canonical_bytes(value).map_err(|error| GameSaveV2Error::Canonical(error.to_string()))?;
    let digest = Sha256::digest(bytes);
    SaveChecksum::parse(format!("sha256-v1:{digest:x}")).map_err(|_| GameSaveV2Error::Invalid)
}

#[cfg(test)]
mod tests {
    use er_state::{
        m7_state::{DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics},
        m9e_state_v6::{GAME_STATE_SCHEMA_VERSION_V6, GameIdentityAllocatorStateV1, GameStateV6},
    };
    use er_types::{
        BattleContentPackHashV3, CatalogHash, GameContentBundleHash, GameContentIdentityV2,
        OracleSha, SafeU53, battle_ids::WaveIndex,
    };

    use super::{ChecksumView, GAME_SAVE_SCHEMA_VERSION_V2, GameSaveV2, checksum};

    fn safe(value: u64) -> SafeU53 {
        SafeU53::new(value).expect("test value is a safe integer")
    }

    fn identity(fill: char) -> GameContentIdentityV2 {
        let hash = fill.to_string().repeat(64);
        GameContentIdentityV2 {
            oracle_sha: OracleSha::parse("399d5d368f0b5642ebf8f45bd8a5e73350fa4de7")
                .expect("test oracle is valid"),
            bundle_hash: GameContentBundleHash::parse(format!("blake3-v1:{hash}"))
                .expect("test bundle hash is valid"),
            battle_hash: BattleContentPackHashV3::parse(format!("blake3-v3:{hash}"))
                .expect("test battle hash is valid"),
            run_hash: CatalogHash::parse(hash.clone()).expect("test run hash is valid"),
            progression_hash: CatalogHash::parse(hash.clone())
                .expect("test progression hash is valid"),
            world_hash: CatalogHash::parse(hash.clone()).expect("test world hash is valid"),
            scenario_hash: CatalogHash::parse(hash.clone()).expect("test scenario hash is valid"),
            ai_hash: CatalogHash::parse(hash.clone()).expect("test AI hash is valid"),
            bootstrap_hash: CatalogHash::parse(hash.clone()).expect("test bootstrap hash is valid"),
            presentation_hash: CatalogHash::parse(hash.clone())
                .expect("test presentation hash is valid"),
            semantic_catalog_hash: CatalogHash::parse(hash)
                .expect("test semantic catalog hash is valid"),
        }
    }

    fn state(content_identity: GameContentIdentityV2) -> GameStateV6 {
        GameStateV6 {
            schema_version: GAME_STATE_SCHEMA_VERSION_V6,
            content_identity,
            identities: GameIdentityAllocatorStateV1 {
                next_run_id: safe(1),
                next_pokemon_id: safe(1),
                next_battle_id: safe(1),
                next_storage_slot_id: safe(1),
                next_modifier_instance_id: safe(1),
                next_scenario_instance_id: safe(1),
                next_platform_request_id: safe(1),
            },
            profile: ProfileStateV1 {
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
                    highest_wave: WaveIndex::new(safe(1)).expect("test wave is positive"),
                },
                dex: DexState::default(),
            },
            active_run: None,
        }
    }

    fn save() -> GameSaveV2 {
        let content_identity = identity('1');
        GameSaveV2::new(content_identity.clone(), safe(1), state(content_identity))
            .expect("test save is valid")
    }

    #[test]
    fn checksum_is_canonical_sha256_and_round_trip_is_stable() {
        let save = save();
        let expected = checksum(&ChecksumView {
            schema_version: GAME_SAVE_SCHEMA_VERSION_V2,
            content_identity: &save.content_identity,
            generation: save.generation,
            state: &save.state,
        })
        .expect("checksum is computable");
        assert_eq!(save.checksum, expected);
        assert!(save.checksum.as_str().starts_with("sha256-v1:"));
        assert_eq!(save.checksum.as_str().len(), "sha256-v1:".len() + 64);

        let first = save.encode().expect("save encodes");
        let decoded = GameSaveV2::decode(&first).expect("save decodes");
        assert_eq!(decoded, save);
        assert_eq!(decoded.encode().expect("decoded save encodes"), first);
    }

    #[test]
    fn rejects_corruption_wrong_identity_zero_generation_and_unknown_fields() {
        let save = save();
        let bytes = save.encode().expect("save encodes");

        let mut corrupt: serde_json::Value =
            serde_json::from_slice(&bytes).expect("canonical save is JSON");
        corrupt["generation"] = serde_json::json!(2);
        assert!(GameSaveV2::decode(&serde_json::to_vec(&corrupt).expect("JSON encodes")).is_err());

        let mut wrong_identity = save.clone();
        wrong_identity.content_identity = identity('2');
        assert!(wrong_identity.validate().is_err());

        assert!(
            GameSaveV2::new(
                save.content_identity.clone(),
                SafeU53::ZERO,
                save.state.clone()
            )
            .is_err()
        );

        let mut unknown: serde_json::Value =
            serde_json::from_slice(&bytes).expect("canonical save is JSON");
        unknown
            .as_object_mut()
            .expect("save is an object")
            .insert("unknown".into(), serde_json::json!(true));
        assert!(GameSaveV2::decode(&serde_json::to_vec(&unknown).expect("JSON encodes")).is_err());
        assert!(
            GameSaveV2::decode(&serde_json::to_vec_pretty(&save).expect("JSON encodes")).is_err()
        );
    }
}
