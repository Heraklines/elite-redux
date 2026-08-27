//! Canonical full-game M7 state.

use std::collections::{BTreeMap, BTreeSet};

use er_rng::battle::BattleRngState;
use er_rng::phaser::RunRngState;
use er_types::battle_command::CommandCollectionState;
use er_types::battle_ids::{
    BattleFormat, BattleId, BattleSide, FaintOccurrenceId, GameModeId, PokemonId, SpeciesId,
    TurnIndex, WaveIndex,
};
use er_types::battle_model::{
    ArenaConditionState, BattleOutcome, FaintOccurrence, GlobalAbilitySuppressionState,
    PokemonType, TerrainState, WeatherState,
};
use er_types::run_ids::{BiomeId, Experience, GameRunId, Money, RouteNodeId};
use er_types::run_model::RunOutcome;
use er_types::{
    AchievementId, ChallengeId, EvolutionId, FactionId, GameContentIdentity, GameControlKindV2,
    GameControlPlanV2, HeldItemInstanceId, InventoryItemId, ProfileFlagId, QuestId, RunFlagId,
    RunModifierInstanceId, SafeU53, ScenarioId, ScenarioNodeId, SeatId, StorageSlotId, UnlockId,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::field::FieldState;
use crate::mechanic_state_v2::MechanicStateStoreV2;
use crate::pokemon::{
    AbilityLoadout, BattleStats, MoveSlotState, PokemonTyping, StatStages, StatusState,
    validate_ability_loadout, validate_move_slot_metadata, validate_stat_stages,
    validate_status_state, validate_typing,
};
use crate::pokemon_v2::{Iv, PermanentStatBonuses};
use er_types::mechanics::SourceOrdinal;

pub const GAME_STATE_SCHEMA_VERSION_V5: u32 = 5;
pub const RUN_STATE_SCHEMA_VERSION_V3: u32 = 3;
pub const POKEMON_STATE_SCHEMA_VERSION_V5: u32 = 5;
pub const BATTLE_STATE_SCHEMA_VERSION_V5: u32 = 5;
pub const PROFILE_STATE_SCHEMA_VERSION_V1: u32 = 1;
pub const INVENTORY_STATE_SCHEMA_VERSION_V1: u32 = 1;
pub const WORLD_STATE_SCHEMA_VERSION_V1: u32 = 1;
pub const SCENARIO_RUNTIME_SCHEMA_VERSION_V1: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AchievementProgress {
    pub id: AchievementId,
    pub progress: SafeU53,
    pub complete: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChallengeProgress {
    pub id: ChallengeId,
    pub progress: SafeU53,
    pub complete: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileStatistics {
    pub runs_started: SafeU53,
    pub runs_won: SafeU53,
    pub runs_lost: SafeU53,
    pub battles_won: SafeU53,
    pub pokemon_captured: SafeU53,
    pub highest_wave: WaveIndex,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DexEntryState {
    pub species: SpeciesId,
    pub seen: SafeU53,
    pub caught: SafeU53,
    pub forms_seen: Vec<u16>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DexState {
    pub entries: Vec<DexEntryState>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileStateV1 {
    pub schema_version: u32,
    pub unlocks: Vec<UnlockId>,
    pub achievements: Vec<AchievementProgress>,
    pub challenges: Vec<ChallengeProgress>,
    pub flags: BTreeMap<ProfileFlagId, bool>,
    pub statistics: ProfileStatistics,
    pub dex: DexState,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureMetadataV1 {
    pub ball: InventoryItemId,
    pub wave: WaveIndex,
    pub original_owner_seat: Option<SeatId>,
    pub original_trainer_id: Option<SafeU53>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FusionStateV1 {
    pub partner_species: SpeciesId,
    pub partner_form: u16,
    pub partner_ability: er_types::battle_ids::AbilityId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvolutionStateV1 {
    pub last_completed: Option<EvolutionId>,
    pub cancelled: Vec<EvolutionId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HeldItemOwnershipStateV1 {
    pub instance_id: HeldItemInstanceId,
    pub registry_key: String,
    pub source_ordinal: SourceOrdinal,
    pub stack_count: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PokemonStateV5 {
    pub schema_version: u32,
    pub id: PokemonId,
    pub owner_seat: Option<SeatId>,
    pub species_id: SpeciesId,
    pub form_index: u16,
    pub level: u16,
    pub experience: Experience,
    pub types: PokemonTyping,
    pub stats: BattleStats,
    pub hp: u32,
    pub max_hp: u32,
    pub status: StatusState,
    pub stat_stages: StatStages,
    pub moves: [Option<MoveSlotState>; 4],
    pub abilities: AbilityLoadout,
    pub ivs: [Iv; 6],
    pub nature: er_types::run_ids::NatureId,
    pub effective_nature: er_types::run_ids::NatureId,
    pub friendship: u16,
    pub permanent_bonuses: PermanentStatBonuses,
    pub pause_evolutions: bool,
    pub held_items: Vec<HeldItemOwnershipStateV1>,
    pub mechanics: MechanicStateStoreV2,
    pub fusion: Option<FusionStateV1>,
    pub evolution: EvolutionStateV1,
    pub tera_type: Option<PokemonType>,
    pub shiny: bool,
    pub variant: u8,
    pub capture: Option<CaptureMetadataV1>,
    pub fainted: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InventoryEntryV1 {
    pub item: InventoryItemId,
    pub registry_key: String,
    pub count: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InventoryStateV1 {
    pub schema_version: u32,
    pub entries: Vec<InventoryEntryV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunModifierInstanceV2 {
    pub id: RunModifierInstanceId,
    pub registry_key: String,
    pub stack_count: u32,
    pub tier: u8,
    pub mechanics: MechanicStateStoreV2,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorldStateV1 {
    pub schema_version: u32,
    pub biome: BiomeId,
    pub route: RouteNodeId,
    pub visited_routes: Vec<RouteNodeId>,
    pub encounter_sequence: SafeU53,
    pub mode_counters: BTreeMap<String, SafeU53>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioRuntimeStateV1 {
    pub schema_version: u32,
    pub scenario: ScenarioId,
    pub node: ScenarioNodeId,
    pub flags: BTreeMap<RunFlagId, bool>,
    pub visit_count: SafeU53,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QuestStateV1 {
    pub progress: BTreeMap<QuestId, SafeU53>,
    pub completed: BTreeSet<QuestId>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FactionStateV1 {
    pub standing: BTreeMap<FactionId, i64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProgressionTaskV2 {
    pub sequence: SafeU53,
    pub pokemon: PokemonId,
    pub kind: ProgressionTaskKindV2,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum ProgressionTaskKindV2 {
    GrantExperience(Experience),
    LearnMove(er_types::battle_ids::MoveId),
    Evolve(EvolutionId),
    ChangeForm(u16),
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProgressionQueueV2 {
    pub next_sequence: SafeU53,
    pub tasks: Vec<ProgressionTaskV2>,
    pub active_index: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleStateV5 {
    pub schema_version: u32,
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    pub wave_seed: String,
    pub turn: TurnIndex,
    pub format: BattleFormat,
    pub authority_seat: SeatId,
    pub enemy_party: Vec<PokemonStateV5>,
    pub field: FieldState,
    pub weather: WeatherState,
    pub terrain: TerrainState,
    pub arena_conditions: Vec<ArenaConditionState>,
    pub global_ability_suppression: GlobalAbilitySuppressionState,
    pub battle_rng: BattleRngState,
    pub command_state: CommandCollectionState,
    pub mechanics: MechanicStateStoreV2,
    pub faint_queue: Vec<FaintOccurrence>,
    pub next_faint_occurrence: FaintOccurrenceId,
    pub outcome: BattleOutcome,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StoredPokemonV1 {
    pub slot: StorageSlotId,
    pub pokemon: PokemonStateV5,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunStateV3 {
    pub schema_version: u32,
    pub run_id: GameRunId,
    pub seed: String,
    pub mode: GameModeId,
    pub wave: WaveIndex,
    pub run_rng: RunRngState,
    pub party: Vec<PokemonStateV5>,
    pub storage: Vec<StoredPokemonV1>,
    pub inventory: InventoryStateV1,
    pub modifiers: Vec<RunModifierInstanceV2>,
    pub money: Money,
    pub world: WorldStateV1,
    pub scenario: Option<ScenarioRuntimeStateV1>,
    pub quests: QuestStateV1,
    pub factions: FactionStateV1,
    pub progression_queue: ProgressionQueueV2,
    pub battle: Option<BattleStateV5>,
    pub control: GameControlPlanV2,
    pub flags: BTreeMap<RunFlagId, bool>,
    pub outcome: RunOutcome,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameStateV5 {
    pub schema_version: u32,
    pub content_identity: GameContentIdentity,
    pub profile: ProfileStateV1,
    pub active_run: Option<RunStateV3>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum M7StateError {
    #[error("{state} schema version must be {expected}, got {actual}")]
    SchemaVersion {
        state: &'static str,
        expected: u32,
        actual: u32,
    },
    #[error("collection {0} is not sorted and unique")]
    NotSortedUnique(&'static str),
    #[error("Pokémon {pokemon:?} is invalid: {reason}")]
    Pokemon { pokemon: PokemonId, reason: String },
    #[error("Pokémon identity {0:?} occurs more than once")]
    DuplicatePokemon(PokemonId),
    #[error("storage slot identity occurs more than once")]
    DuplicateStorageSlot,
    #[error("field occupant {pokemon:?} is absent from its owning party")]
    UnknownFieldOccupant { pokemon: PokemonId },
    #[error("battle field is invalid: {0}")]
    Field(String),
    #[error("battle RNG is invalid: {0}")]
    BattleRng(String),
    #[error("run RNG is invalid: {0}")]
    RunRng(String),
    #[error("control is invalid: {0}")]
    Control(String),
    #[error("inventory entries must have nonzero counts and nonempty registry keys")]
    InventoryEntry,
    #[error("modifier entries must have nonzero stacks and nonempty registry keys")]
    ModifierEntry,
    #[error("progression queue is invalid")]
    ProgressionQueue,
    #[error("active battle wave differs from run wave")]
    BattleWave,
    #[error("run outcome and complete control disagree")]
    OutcomeControl,
}

impl PokemonStateV5 {
    pub fn validate(&self) -> Result<(), M7StateError> {
        require_schema(
            "PokemonStateV5",
            self.schema_version,
            POKEMON_STATE_SCHEMA_VERSION_V5,
        )?;
        if self.hp > self.max_hp || self.fainted != (self.hp == 0) || self.max_hp == 0 {
            return Err(M7StateError::Pokemon {
                pokemon: self.id,
                reason: "HP/faint invariant".to_owned(),
            });
        }
        if self.level == 0 {
            return Err(M7StateError::Pokemon {
                pokemon: self.id,
                reason: "level invariant".to_owned(),
            });
        }
        validate_typing(&self.types).map_err(|error| M7StateError::Pokemon {
            pokemon: self.id,
            reason: error.to_string(),
        })?;
        validate_status_state(&self.status).map_err(|error| M7StateError::Pokemon {
            pokemon: self.id,
            reason: error.to_string(),
        })?;
        validate_stat_stages(&self.stat_stages).map_err(|error| M7StateError::Pokemon {
            pokemon: self.id,
            reason: error.to_string(),
        })?;
        validate_ability_loadout(&self.abilities).map_err(|error| M7StateError::Pokemon {
            pokemon: self.id,
            reason: error.to_string(),
        })?;
        for slot in self.moves.iter().flatten() {
            validate_move_slot_metadata(slot).map_err(|error| M7StateError::Pokemon {
                pokemon: self.id,
                reason: error.to_string(),
            })?;
        }
        self.mechanics
            .validate()
            .map_err(|error| M7StateError::Pokemon {
                pokemon: self.id,
                reason: error.to_string(),
            })?;
        let mut previous_item = None;
        for item in &self.held_items {
            if item.registry_key.is_empty()
                || item.stack_count == 0
                || previous_item.is_some_and(|id| item.instance_id <= id)
            {
                return Err(M7StateError::Pokemon {
                    pokemon: self.id,
                    reason: "held-item identity/order invariant".to_owned(),
                });
            }
            previous_item = Some(item.instance_id);
        }
        Ok(())
    }
}

impl BattleStateV5 {
    pub fn validate(&self, player_party: &[PokemonStateV5]) -> Result<(), M7StateError> {
        require_schema(
            "BattleStateV5",
            self.schema_version,
            BATTLE_STATE_SCHEMA_VERSION_V5,
        )?;
        if self.turn != self.battle_rng.turn {
            return Err(M7StateError::BattleRng("turn frontier mismatch".to_owned()));
        }
        self.battle_rng
            .validate()
            .map_err(|error| M7StateError::BattleRng(error.to_string()))?;
        self.field
            .validate_for_format(&self.format)
            .map_err(|error| M7StateError::Field(error.to_string()))?;
        self.mechanics
            .validate()
            .map_err(|error| M7StateError::Field(error.to_string()))?;
        let player_ids: BTreeSet<_> = player_party.iter().map(|pokemon| pokemon.id).collect();
        let enemy_ids: BTreeSet<_> = self.enemy_party.iter().map(|pokemon| pokemon.id).collect();
        if enemy_ids.len() != self.enemy_party.len()
            || player_ids.iter().any(|id| enemy_ids.contains(id))
        {
            return Err(M7StateError::DuplicatePokemon(PokemonId::ZERO));
        }
        for pokemon in &self.enemy_party {
            pokemon.validate()?;
        }
        for slot in &self.field.slots {
            let Some(pokemon) = slot.occupant else {
                continue;
            };
            let known = match slot.slot.side {
                BattleSide::Player => player_ids.contains(&pokemon),
                BattleSide::Enemy => enemy_ids.contains(&pokemon),
            };
            if !known {
                return Err(M7StateError::UnknownFieldOccupant { pokemon });
            }
        }
        Ok(())
    }
}

impl RunStateV3 {
    pub fn validate(&self) -> Result<(), M7StateError> {
        require_schema(
            "RunStateV3",
            self.schema_version,
            RUN_STATE_SCHEMA_VERSION_V3,
        )?;
        self.run_rng
            .rdg
            .validate()
            .map_err(|error| M7StateError::RunRng(error.to_string()))?;
        self.control
            .validate()
            .map_err(|error| M7StateError::Control(error.to_string()))?;
        require_schema(
            "InventoryStateV1",
            self.inventory.schema_version,
            INVENTORY_STATE_SCHEMA_VERSION_V1,
        )?;
        require_schema(
            "WorldStateV1",
            self.world.schema_version,
            WORLD_STATE_SCHEMA_VERSION_V1,
        )?;
        if let Some(scenario) = &self.scenario {
            require_schema(
                "ScenarioRuntimeStateV1",
                scenario.schema_version,
                SCENARIO_RUNTIME_SCHEMA_VERSION_V1,
            )?;
        }
        let mut ids = BTreeSet::new();
        for pokemon in &self.party {
            pokemon.validate()?;
            if !ids.insert(pokemon.id) {
                return Err(M7StateError::DuplicatePokemon(pokemon.id));
            }
        }
        let mut storage_slots = BTreeSet::new();
        for stored in &self.storage {
            stored.pokemon.validate()?;
            if !storage_slots.insert(stored.slot) {
                return Err(M7StateError::DuplicateStorageSlot);
            }
            if !ids.insert(stored.pokemon.id) {
                return Err(M7StateError::DuplicatePokemon(stored.pokemon.id));
            }
        }
        validate_inventory(&self.inventory)?;
        validate_modifiers(&self.modifiers)?;
        validate_progression(&self.progression_queue, &ids)?;
        if let Some(battle) = &self.battle {
            if battle.wave != self.wave {
                return Err(M7StateError::BattleWave);
            }
            battle.validate(&self.party)?;
        }
        let terminal = !matches!(self.outcome, RunOutcome::InProgress);
        if terminal != matches!(self.control.kind, GameControlKindV2::Complete) {
            return Err(M7StateError::OutcomeControl);
        }
        Ok(())
    }
}

impl GameStateV5 {
    pub fn validate(&self) -> Result<(), M7StateError> {
        require_schema(
            "GameStateV5",
            self.schema_version,
            GAME_STATE_SCHEMA_VERSION_V5,
        )?;
        require_schema(
            "ProfileStateV1",
            self.profile.schema_version,
            PROFILE_STATE_SCHEMA_VERSION_V1,
        )?;
        validate_profile(&self.profile)?;
        if let Some(run) = &self.active_run {
            run.validate()?;
        }
        Ok(())
    }
}

fn require_schema(state: &'static str, actual: u32, expected: u32) -> Result<(), M7StateError> {
    if actual != expected {
        return Err(M7StateError::SchemaVersion {
            state,
            expected,
            actual,
        });
    }
    Ok(())
}

fn validate_profile(profile: &ProfileStateV1) -> Result<(), M7StateError> {
    validate_sorted_unique(&profile.unlocks, "profile unlocks")?;
    validate_sorted_unique_by(&profile.achievements, "achievements", |entry| entry.id)?;
    validate_sorted_unique_by(&profile.challenges, "challenges", |entry| entry.id)?;
    validate_sorted_unique_by(&profile.dex.entries, "dex entries", |entry| entry.species)?;
    for entry in &profile.dex.entries {
        validate_sorted_unique(&entry.forms_seen, "dex forms")?;
    }
    Ok(())
}

fn validate_inventory(inventory: &InventoryStateV1) -> Result<(), M7StateError> {
    let mut previous = None;
    for entry in &inventory.entries {
        if entry.registry_key.is_empty()
            || entry.count == 0
            || previous.is_some_and(|id| entry.item <= id)
        {
            return Err(M7StateError::InventoryEntry);
        }
        previous = Some(entry.item);
    }
    Ok(())
}

fn validate_modifiers(modifiers: &[RunModifierInstanceV2]) -> Result<(), M7StateError> {
    let mut previous = None;
    for modifier in modifiers {
        if modifier.registry_key.is_empty()
            || modifier.stack_count == 0
            || previous.is_some_and(|id| modifier.id <= id)
        {
            return Err(M7StateError::ModifierEntry);
        }
        modifier
            .mechanics
            .validate()
            .map_err(|_| M7StateError::ModifierEntry)?;
        previous = Some(modifier.id);
    }
    Ok(())
}

fn validate_progression(
    progression: &ProgressionQueueV2,
    pokemon_ids: &BTreeSet<PokemonId>,
) -> Result<(), M7StateError> {
    if usize::try_from(progression.active_index.unwrap_or(0))
        .ok()
        .is_some_and(|index| progression.active_index.is_some() && index >= progression.tasks.len())
    {
        return Err(M7StateError::ProgressionQueue);
    }
    let mut previous = None;
    for task in &progression.tasks {
        if !pokemon_ids.contains(&task.pokemon)
            || previous.is_some_and(|sequence| task.sequence <= sequence)
            || task.sequence >= progression.next_sequence
        {
            return Err(M7StateError::ProgressionQueue);
        }
        previous = Some(task.sequence);
    }
    Ok(())
}

fn validate_sorted_unique<T: Ord>(values: &[T], label: &'static str) -> Result<(), M7StateError> {
    if values.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(M7StateError::NotSortedUnique(label));
    }
    Ok(())
}

fn validate_sorted_unique_by<T, K: Ord>(
    values: &[T],
    label: &'static str,
    key: impl Fn(&T) -> K,
) -> Result<(), M7StateError> {
    if values.windows(2).any(|pair| key(&pair[0]) >= key(&pair[1])) {
        return Err(M7StateError::NotSortedUnique(label));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use er_types::{
        BattleContentPackHashV3, CatalogHash, GameContentBundleHash, GameContentIdentity,
        OracleSha, SafeU53, UnlockId,
    };

    use super::{
        DexState, GAME_STATE_SCHEMA_VERSION_V5, GameStateV5, M7StateError,
        PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
    };

    fn content_identity() -> GameContentIdentity {
        GameContentIdentity {
            oracle_sha: OracleSha::parse("399d5d368f0b5642ebf8f45bd8a5e73350fa4de7")
                .expect("valid oracle"),
            content_hash: GameContentBundleHash::parse(format!("blake3-v1:{}", "1".repeat(64)))
                .expect("valid game content hash"),
            battle_content_hash: BattleContentPackHashV3::parse(format!(
                "blake3-v3:{}",
                "2".repeat(64)
            ))
            .expect("valid battle content hash"),
            semantic_catalog_hash: CatalogHash::parse("3".repeat(64)).expect("valid semantic hash"),
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
                highest_wave: er_types::battle_ids::WaveIndex::new(
                    SafeU53::new(1).expect("safe wave"),
                )
                .expect("positive wave"),
            },
            dex: DexState::default(),
        }
    }

    #[test]
    fn profile_only_game_state_validates_without_an_active_run() {
        let state = GameStateV5 {
            schema_version: GAME_STATE_SCHEMA_VERSION_V5,
            content_identity: content_identity(),
            profile: profile(),
            active_run: None,
        };
        state.validate().expect("profile state validates");
    }

    #[test]
    fn duplicate_profile_identity_fails_closed() {
        let mut state = GameStateV5 {
            schema_version: GAME_STATE_SCHEMA_VERSION_V5,
            content_identity: content_identity(),
            profile: profile(),
            active_run: None,
        };
        let unlock = UnlockId::new(SafeU53::new(1).expect("safe identity"));
        state.profile.unlocks = vec![unlock, unlock];
        assert!(matches!(
            state.validate(),
            Err(M7StateError::NotSortedUnique("profile unlocks"))
        ));
    }

    #[test]
    fn wrong_game_schema_fails_before_nested_state() {
        let state = GameStateV5 {
            schema_version: GAME_STATE_SCHEMA_VERSION_V5 + 1,
            content_identity: content_identity(),
            profile: profile(),
            active_run: None,
        };
        assert!(matches!(
            state.validate(),
            Err(M7StateError::SchemaVersion {
                state: "GameStateV5",
                ..
            })
        ));
    }
}
