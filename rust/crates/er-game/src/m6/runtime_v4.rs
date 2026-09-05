//! GameStateV4-native M6 runtime ownership and atomic material application.
//!
//! This module is the production mechanical owner for M6. It never stores a
//! legacy `GameState`, `GameRuntimeSnapshotV2`, or V2 kernel snapshot sidecar.

use std::sync::Arc;

use er_battle::{BattleMutation, resolve_turn};
use er_canonical::canonical_bytes;
use er_content::pack::ContentPack;
use er_content::pack::m6_prepared::PreparedBattleContentV3;
use er_state::battle::BattleState;
use er_state::digest_v4::{MechanicalDigestErrorV4, MechanicalStateDigestV4};
use er_state::migration_v4::{GameStateV4, MigrationV4Error};
use er_state::pokemon::PokemonState;
use er_state::pokemon_v2::PokemonStateV2;
use er_state::snapshot::GameState;
use er_types::battle_command::CommandSet;
use er_types::battle_control::BattleControlPlan;
use er_types::battle_ids::AuthorityEpoch;
use er_types::battle_ui::BattlePresentationEvent;
use er_types::{BattleContentPackHashV3, CatalogHash, OperationId, SafeU53};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const M6_RUNTIME_SNAPSHOT_SCHEMA_VERSION: u32 = 1;
pub const M6_TURN_MATERIAL_SCHEMA_VERSION: u32 = 1;

/// Ordered presentation work retained until the renderer settles it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PendingPresentationV4 {
    pub ordinal: SafeU53,
    pub event: BattlePresentationEvent,
    pub blocks_human_input: bool,
}

/// Complete restorable owner graph of the logical M6 game runtime.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameRuntimeSnapshotV4 {
    pub schema_version: u32,
    pub state: GameStateV4,
    pub control: BattleControlPlan,
    pub revision: SafeU53,
    pub next_presentation_ordinal: SafeU53,
    pub pending_presentations: Vec<PendingPresentationV4>,
}

impl GameRuntimeSnapshotV4 {
    pub fn validate(&self) -> Result<(), M6RuntimeError> {
        if self.schema_version != M6_RUNTIME_SNAPSHOT_SCHEMA_VERSION {
            return Err(M6RuntimeError::SnapshotSchema {
                expected: M6_RUNTIME_SNAPSHOT_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        self.state.validate()?;
        if self.next_presentation_ordinal == SafeU53::ZERO {
            return Err(M6RuntimeError::ZeroPresentationOrdinal);
        }
        let mut previous = None;
        for pending in &self.pending_presentations {
            if pending.ordinal == SafeU53::ZERO
                || previous.is_some_and(|value| pending.ordinal <= value)
                || pending.ordinal >= self.next_presentation_ordinal
            {
                return Err(M6RuntimeError::PresentationOrder);
            }
            previous = Some(pending.ordinal);
        }
        Ok(())
    }
}

/// Canonical material applied through the same path on authority and replica.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M6TurnMaterialV4 {
    pub schema_version: u32,
    pub revision: SafeU53,
    pub battle_content_hash_v3: BattleContentPackHashV3,
    pub semantic_catalog_hash: CatalogHash,
    pub before_digest: MechanicalStateDigestV4,
    pub after_digest: MechanicalStateDigestV4,
    pub after_state: GameStateV4,
    pub mutations: Vec<BattleMutation>,
    pub presentation: Vec<BattlePresentationEvent>,
    pub next_control: BattleControlPlan,
}

impl M6TurnMaterialV4 {
    pub fn canonical_bytes(&self) -> Result<Vec<u8>, M6RuntimeError> {
        Ok(canonical_bytes(self)?)
    }

    pub fn decode_canonical(bytes: &[u8]) -> Result<Self, M6RuntimeError> {
        let material: Self = serde_json::from_slice(bytes)?;
        let encoded = material.canonical_bytes()?;
        if encoded != bytes {
            return Err(M6RuntimeError::NonCanonicalMaterial);
        }
        Ok(material)
    }
}

/// Sole M6 logical-game owner. Prepared content is derived immutable runtime
/// state; snapshots carry only its frozen identity through `GameStateV4`.
#[derive(Clone, Debug)]
pub struct GameRuntimeV4 {
    state: GameStateV4,
    content: Arc<PreparedBattleContentV3>,
    control: BattleControlPlan,
    revision: SafeU53,
    next_presentation_ordinal: SafeU53,
    pending_presentations: Vec<PendingPresentationV4>,
}

impl GameRuntimeV4 {
    pub fn new(
        state: GameStateV4,
        content: Arc<PreparedBattleContentV3>,
        control: BattleControlPlan,
    ) -> Result<Self, M6RuntimeError> {
        state.validate()?;
        validate_content_identity(&state, &content)?;
        let runtime = Self {
            state,
            content,
            control,
            revision: SafeU53::ZERO,
            next_presentation_ordinal: SafeU53::new(1)
                .map_err(|_| M6RuntimeError::RevisionOverflow)?,
            pending_presentations: Vec::new(),
        };
        runtime.validate()?;
        Ok(runtime)
    }

    pub fn from_snapshot(
        snapshot: GameRuntimeSnapshotV4,
        content: Arc<PreparedBattleContentV3>,
    ) -> Result<Self, M6RuntimeError> {
        snapshot.validate()?;
        validate_content_identity(&snapshot.state, &content)?;
        let runtime = Self {
            state: snapshot.state,
            content,
            control: snapshot.control,
            revision: snapshot.revision,
            next_presentation_ordinal: snapshot.next_presentation_ordinal,
            pending_presentations: snapshot.pending_presentations,
        };
        runtime.validate()?;
        Ok(runtime)
    }

    pub fn snapshot(&self) -> GameRuntimeSnapshotV4 {
        GameRuntimeSnapshotV4 {
            schema_version: M6_RUNTIME_SNAPSHOT_SCHEMA_VERSION,
            state: self.state.clone(),
            control: self.control.clone(),
            revision: self.revision,
            next_presentation_ordinal: self.next_presentation_ordinal,
            pending_presentations: self.pending_presentations.clone(),
        }
    }

    pub fn state(&self) -> &GameStateV4 {
        &self.state
    }

    pub fn content(&self) -> &PreparedBattleContentV3 {
        &self.content
    }

    pub fn control(&self) -> &BattleControlPlan {
        &self.control
    }

    pub fn revision(&self) -> SafeU53 {
        self.revision
    }

    pub fn pending_presentations(&self) -> &[PendingPresentationV4] {
        &self.pending_presentations
    }

    pub fn mechanical_digest(&self) -> Result<MechanicalStateDigestV4, M6RuntimeError> {
        Ok(MechanicalStateDigestV4::compute(&self.state)?)
    }

    /// Authority-only preparation. The live runtime remains unchanged until
    /// the returned canonical bytes pass the common material applier.
    pub fn prepare_material(
        &self,
        after_state: GameStateV4,
        mutations: Vec<BattleMutation>,
        presentation: Vec<BattlePresentationEvent>,
        next_control: BattleControlPlan,
    ) -> Result<M6TurnMaterialV4, M6RuntimeError> {
        self.validate()?;
        after_state.validate()?;
        validate_content_identity(&after_state, &self.content)?;
        let revision = next_safe(self.revision)?;
        Ok(M6TurnMaterialV4 {
            schema_version: M6_TURN_MATERIAL_SCHEMA_VERSION,
            revision,
            battle_content_hash_v3: after_state.battle_content_hash_v3.clone(),
            semantic_catalog_hash: after_state.semantic_catalog_hash.clone(),
            before_digest: self.mechanical_digest()?,
            after_digest: MechanicalStateDigestV4::compute(&after_state)?,
            after_state,
            mutations,
            presentation,
            next_control,
        })
    }

    /// Resolve one admitted turn against an ephemeral M3 mechanics view, then
    /// merge the exact resulting battle fields back into the sole V4 owner.
    /// The projection is never stored or snapshotted.
    pub fn prepare_resolved_turn(
        &self,
        commands: &CommandSet,
        authority_epoch: AuthorityEpoch,
        material_operation_id: &OperationId,
        legacy_content: &ContentPack,
        next_control: BattleControlPlan,
    ) -> Result<M6TurnMaterialV4, M6RuntimeError> {
        let legacy_before = project_legacy_state(&self.state)?;
        let transition = resolve_turn(
            &legacy_before,
            commands,
            authority_epoch,
            material_operation_id,
            legacy_content,
        )
        .map_err(|error| M6RuntimeError::LegacyResolver(error.to_string()))?;
        let after_state = merge_legacy_state(self.state.clone(), transition.after_state)?;
        self.prepare_material(
            after_state,
            transition.mutations,
            transition.presentation,
            next_control,
        )
    }

    /// Role-neutral atomic material application. Authority and replica both
    /// call this method with the exact canonical bytes.
    pub fn apply_material_bytes(&mut self, bytes: &[u8]) -> Result<(), M6RuntimeError> {
        let material = M6TurnMaterialV4::decode_canonical(bytes)?;
        let mut staged = self.clone();
        staged.apply_material(material)?;
        staged.validate()?;
        *self = staged;
        Ok(())
    }

    fn apply_material(&mut self, material: M6TurnMaterialV4) -> Result<(), M6RuntimeError> {
        if material.schema_version != M6_TURN_MATERIAL_SCHEMA_VERSION {
            return Err(M6RuntimeError::MaterialSchema {
                expected: M6_TURN_MATERIAL_SCHEMA_VERSION,
                actual: material.schema_version,
            });
        }
        if material.revision != next_safe(self.revision)? {
            return Err(M6RuntimeError::RevisionMismatch {
                expected: next_safe(self.revision)?,
                actual: material.revision,
            });
        }
        if material.battle_content_hash_v3 != self.state.battle_content_hash_v3
            || material.semantic_catalog_hash != self.state.semantic_catalog_hash
        {
            return Err(M6RuntimeError::MaterialContentMismatch);
        }
        material.before_digest.verify(&self.state)?;
        material.after_state.validate()?;
        validate_content_identity(&material.after_state, &self.content)?;
        material.after_digest.verify(&material.after_state)?;

        let mut next_ordinal = self.next_presentation_ordinal;
        let mut pending = self.pending_presentations.clone();
        for event in material.presentation {
            pending.push(PendingPresentationV4 {
                ordinal: next_ordinal,
                event,
                blocks_human_input: true,
            });
            next_ordinal = next_safe(next_ordinal)?;
        }

        self.state = material.after_state;
        self.control = material.next_control;
        self.revision = material.revision;
        self.next_presentation_ordinal = next_ordinal;
        self.pending_presentations = pending;
        Ok(())
    }

    pub fn settle_presentation(&mut self, ordinal: SafeU53) -> Result<(), M6RuntimeError> {
        let Some(index) = self
            .pending_presentations
            .iter()
            .position(|pending| pending.ordinal == ordinal)
        else {
            return Err(M6RuntimeError::UnknownPresentation { ordinal });
        };
        self.pending_presentations.remove(index);
        self.validate()?;
        Ok(())
    }

    pub fn validate(&self) -> Result<(), M6RuntimeError> {
        self.state.validate()?;
        validate_content_identity(&self.state, &self.content)?;
        self.snapshot().validate()
    }
}

fn project_pokemon(pokemon: &PokemonStateV2) -> PokemonState {
    PokemonState {
        id: pokemon.id,
        owner_seat: pokemon.owner_seat,
        species_id: pokemon.species_id,
        form_index: pokemon.form_index,
        level: pokemon.level,
        types: pokemon.types,
        stats: pokemon.stats,
        hp: pokemon.hp,
        max_hp: pokemon.max_hp,
        status: pokemon.status,
        stat_stages: pokemon.stat_stages,
        moves: pokemon.moves,
        abilities: pokemon.abilities,
        fainted: pokemon.fainted,
    }
}

fn project_legacy_state(state: &GameStateV4) -> Result<GameState, M6RuntimeError> {
    let base = &state.base;
    let battle = base.battle.as_ref().map(|battle| BattleState {
        battle_id: battle.battle_id,
        wave: battle.wave,
        wave_seed: battle.wave_seed.clone(),
        turn: battle.turn,
        format: battle.format.clone(),
        authority_seat: battle.authority_seat,
        player_party: base.player_party.iter().map(project_pokemon).collect(),
        enemy_party: battle.enemy_party.iter().map(project_pokemon).collect(),
        field: battle.field.clone(),
        weather: battle.weather.clone(),
        terrain: battle.terrain.clone(),
        arena_conditions: battle.arena_conditions.clone(),
        global_ability_suppression: battle.global_ability_suppression.clone(),
        battle_rng: battle.battle_rng.clone(),
        command_state: battle.command_state.clone(),
        faint_queue: battle.faint_queue.clone(),
        next_faint_occurrence: battle.next_faint_occurrence,
        outcome: battle.outcome,
    });
    let projected = GameState {
        schema_version: er_state::snapshot::GAME_STATE_SCHEMA_VERSION,
        content_hash: base.battle_content_hash.clone(),
        mode: base.mode,
        wave: base.run.wave,
        next_battle_id: base.run.next_battle_id,
        run_rng: base.run.run_rng.clone(),
        battle,
    };
    projected
        .validate()
        .map_err(|error| M6RuntimeError::LegacyProjection(error.to_string()))?;
    Ok(projected)
}

fn merge_pokemon(target: &mut PokemonStateV2, source: &PokemonState) -> Result<(), M6RuntimeError> {
    if target.id != source.id {
        return Err(M6RuntimeError::LegacyMergeIdentity);
    }
    target.owner_seat = source.owner_seat;
    target.species_id = source.species_id;
    target.form_index = source.form_index;
    target.level = source.level;
    target.types = source.types;
    target.stats = source.stats;
    target.hp = source.hp;
    target.max_hp = source.max_hp;
    target.status = source.status;
    target.stat_stages = source.stat_stages;
    target.moves = source.moves;
    target.abilities = source.abilities;
    target.fainted = source.fainted;
    target
        .validate()
        .map_err(|error| M6RuntimeError::LegacyMerge(error.to_string()))
}

fn merge_legacy_state(
    mut target: GameStateV4,
    source: GameState,
) -> Result<GameStateV4, M6RuntimeError> {
    target.base.mode = source.mode;
    target.base.run.wave = source.wave;
    target.base.run.next_battle_id = source.next_battle_id;
    target.base.run.run_rng = source.run_rng;

    match (target.base.battle.as_mut(), source.battle) {
        (None, None) => {}
        (Some(target_battle), Some(source_battle)) => {
            if target_battle.battle_id != source_battle.battle_id
                || target.base.player_party.len() != source_battle.player_party.len()
                || target_battle.enemy_party.len() != source_battle.enemy_party.len()
            {
                return Err(M6RuntimeError::LegacyMergeIdentity);
            }
            for (target_pokemon, source_pokemon) in target
                .base
                .player_party
                .iter_mut()
                .zip(&source_battle.player_party)
            {
                merge_pokemon(target_pokemon, source_pokemon)?;
            }
            for (target_pokemon, source_pokemon) in target_battle
                .enemy_party
                .iter_mut()
                .zip(&source_battle.enemy_party)
            {
                merge_pokemon(target_pokemon, source_pokemon)?;
            }
            target_battle.wave = source_battle.wave;
            target_battle.wave_seed = source_battle.wave_seed;
            target_battle.turn = source_battle.turn;
            target_battle.format = source_battle.format;
            target_battle.authority_seat = source_battle.authority_seat;
            target_battle.field = source_battle.field;
            target_battle.weather = source_battle.weather;
            target_battle.terrain = source_battle.terrain;
            target_battle.arena_conditions = source_battle.arena_conditions;
            target_battle.global_ability_suppression = source_battle.global_ability_suppression;
            target_battle.battle_rng = source_battle.battle_rng;
            target_battle.command_state = source_battle.command_state;
            target_battle.faint_queue = source_battle.faint_queue;
            target_battle.next_faint_occurrence = source_battle.next_faint_occurrence;
            target_battle.outcome = source_battle.outcome;
        }
        _ => return Err(M6RuntimeError::LegacyMergeIdentity),
    }
    target.validate()?;
    Ok(target)
}

fn validate_content_identity(
    state: &GameStateV4,
    content: &PreparedBattleContentV3,
) -> Result<(), M6RuntimeError> {
    if &state.battle_content_hash_v3 != content.content_hash()
        || &state.semantic_catalog_hash != content.semantic_catalog_hash()
    {
        return Err(M6RuntimeError::PreparedContentMismatch);
    }
    Ok(())
}

fn next_safe(value: SafeU53) -> Result<SafeU53, M6RuntimeError> {
    SafeU53::new(
        value
            .get()
            .checked_add(1)
            .ok_or(M6RuntimeError::RevisionOverflow)?,
    )
    .map_err(|_| M6RuntimeError::RevisionOverflow)
}

#[derive(Debug, Error)]
pub enum M6RuntimeError {
    #[error("runtime snapshot schema version must be {expected}, got {actual}")]
    SnapshotSchema { expected: u32, actual: u32 },
    #[error("turn material schema version must be {expected}, got {actual}")]
    MaterialSchema { expected: u32, actual: u32 },
    #[error("GameStateV4 is invalid: {0}")]
    State(#[from] MigrationV4Error),
    #[error("legacy mechanics projection failed: {0}")]
    LegacyProjection(String),
    #[error("legacy mechanics resolver failed: {0}")]
    LegacyResolver(String),
    #[error("legacy mechanics result could not merge into V4: {0}")]
    LegacyMerge(String),
    #[error("legacy mechanics result changed stable party or battle identity")]
    LegacyMergeIdentity,
    #[error("prepared content identity does not match GameStateV4")]
    PreparedContentMismatch,
    #[error("material content identity does not match the current frontier")]
    MaterialContentMismatch,
    #[error("material revision mismatch: expected {expected:?}, got {actual:?}")]
    RevisionMismatch { expected: SafeU53, actual: SafeU53 },
    #[error("revision or ordinal space exhausted")]
    RevisionOverflow,
    #[error("pending presentation ordinals are invalid or out of order")]
    PresentationOrder,
    #[error("next presentation ordinal must be positive")]
    ZeroPresentationOrdinal,
    #[error("unknown pending presentation ordinal {ordinal:?}")]
    UnknownPresentation { ordinal: SafeU53 },
    #[error("mechanical digest failed: {0}")]
    Digest(#[from] MechanicalDigestErrorV4),
    #[error("canonical material encoding failed: {0}")]
    Canonical(#[from] er_canonical::CanonicalError),
    #[error("material JSON decoding failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("material bytes are not the exact canonical encoding")]
    NonCanonicalMaterial,
}
