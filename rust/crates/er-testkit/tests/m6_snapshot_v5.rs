//! M6D Snapshot V5 continuation-boundary proof.
//!
//! Every recovery boundary defined by
//! [`recovery_campaign::RecoveryBoundaryKind`] is driven against the real
//! production battle kernel pair (raw physical keys only), snapshotted at the
//! boundary into a complete Snapshot V5 envelope, restored into fresh
//! runtimes, and continued identically to the uninterrupted oracle runtime.
//! Post-restore effects, ordered RNG/audit streams, actions, mutations,
//! presentations, state digests, next controls, and all three endpoint
//! digests must match native continuation exactly, and every tampering
//! vector must fail closed.
//!
//! The campaign engine itself is the owned production module
//! `er_game/src/m6/recovery_campaign.rs`, included here by path so this test
//! exercises exactly that source while `er-testkit` has no direct er-game
//! dependency (the workspace dependency direction reaches er-game through
//! `er-kernel`).

#[path = "../../er-game/src/m6/recovery_campaign.rs"]
pub mod recovery_campaign;

use std::collections::{BTreeSet, VecDeque};
use std::error::Error;
use std::sync::Arc;

use er_canonical::content_digest;
use er_content::m6_catalog::SemanticCatalogV1;
use er_content::pack::m6_pack::{
    BattleContentPackV3, BehaviorClassificationEntryV2, BehaviorClassificationManifestV2,
    BespokeManifestV2, FieldContentV1,
};
use er_content::pack::{ContentPack, selected_content_pack};
use er_content_compiler::m6::{
    SemanticCatalogInput, ValidatedSemanticCatalog, map_routine_catalog,
};
use er_kernel::snapshot::RestorableKernelSnapshotV2;
use er_kernel::snapshot_v3::{
    GameRuntimeSnapshotV3, KernelDeterminismDigestV2, RestorableKernelSnapshotV3,
    GAME_RUNTIME_SNAPSHOT_SCHEMA_VERSION_V3, RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V3,
};
use er_kernel::snapshot_v4::{
    RestorableKernelSnapshotV4, RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V4,
};
use er_kernel::snapshot_v5::RestorableKernelSnapshotV5;
use er_kernel::{
    BattleGameConfig, BattleProtocolConfig, BattleProtocolRoleConfig, BattleStartV1, GameKernel,
    KernelEffect, KernelInput,
};
use er_mechanics::program_v2::MechanicsProgramV2;
use er_protocol::{
    AuthorityLogConfig, AuthorityReplicaConfig, BackoffPolicy, PeerBinding, ProposalLeaseConfig,
    RecoveryTransactionConfig,
};
use er_rng::audit::RngDraw;
use er_state::battle_v2::{BattleParticipationState, BattleSettlementState};
use er_state::digest_v2::MechanicalStateDigestV2 as FrontierMechanicalDigestV2;
use er_state::migration::{
    M3_PARITY_ORACLE_SHA, M3BattleCompanion, M3PokemonCompanion, M3PokemonCompanionKey,
    M3ToM4MigrationContext, M4_ORACLE_SHA, MigrationStateSide,
};
use er_state::migration_v4::M5ToM6MigrationContext;
use er_state::pokemon::PokemonState;
use er_state::pokemon_v2::{Iv, PermanentStatBonuses};
use er_state::run_v2::{
    BiomeId, BiomeRuntimeState, GameRunId, Money, ProgressionQueue, RunCounters,
    RunInteractionSequence, RunOutcome, RunStage, RunStateV2, RunSurfaceId, RunTaskId,
};
use er_state::snapshot::GameState;
use er_types::battle_command::{
    BattleCommand, BattleTargetSelection, ScriptedEnemyBattleCommandV1, ScriptedEnemyPolicyV1,
    scripted_enemy_command_operation_id,
};
use er_types::battle_control::BattleControl;
use er_types::battle_ids::{BattlePresentationEventId, BattleSide, FieldSlot, MoveId, MoveSlotIndex, PartyIndex, TurnIndex};
use er_types::battle_ui::PresentationSettlementOutcome;
use er_types::mechanics::{
    MECHANIC_STATE_SCHEMA_VERSION, MECHANICS_PROGRAM_VERSION, MechanicsProgramId,
};
use er_types::run_ids::{Experience, GrowthRateId, NatureId, RunContentPackHash};
use er_types::{
    BehaviorUnitId, BattleContentPackHashV3, CatalogHash, ConnectionGeneration, FrameContext,
    FrameType, InputFocus, M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION, MembershipRevision,
    NetworkFrame, OracleSha, ProposalMessage, RawFrame, RawInputEvent, RunId, SafeU53, SeatId,
    SessionId, TimeClass, TimerId, TransportState,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use recovery_campaign::{
    CampaignEndpoint, CampaignStep, CapturedFrontierV5, ContinuationStep,
    RECOVERY_BOUNDARY_KINDS, RecoveryBoundaryKind, RecoveryFrontierContexts,
    SnapshotV5TamperVector, SNAPSHOT_V5_TAMPER_VECTORS, apply_snapshot_v5_tamper,
    assert_continuation_identical, campaign, capture_frontier_v5,
    verify_restored_frontier_v5,
};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

/// Envelope wire schema version for the recovery checkpoint.
const RECOVERY_ENVELOPE_SCHEMA_VERSION: u32 = 1;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).unwrap_or(SafeU53::ZERO)
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn invalid(message: impl Into<String>) -> Box<dyn Error> {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message.into()).into()
}

// ---------------------------------------------------------------------------
// Frozen M6 catalog identity (loaded through CARGO_MANIFEST_DIR ancestors).
// ---------------------------------------------------------------------------

struct CompiledIdentity {
    target_content_hash_v3: BattleContentPackHashV3,
    semantic_catalog_hash: CatalogHash,
    target_programs: Vec<MechanicsProgramId>,
    target_behavior_units: Vec<BehaviorUnitId>,
}

fn compiled_identity() -> TestResult<CompiledIdentity> {
    let catalog = SemanticCatalogV1::from_bytes(include_bytes!(
        "../../../fixtures/m6/semantic-catalog-v1.json"
    ))?;
    let raw_hash = CatalogHash::parse(catalog.raw_catalog_hash.clone())?;
    let validated = ValidatedSemanticCatalog::new(SemanticCatalogInput::new(catalog, raw_hash))?;
    let mapped = map_routine_catalog(validated.behavior_units())?;
    assert!(
        !mapped.mapped.is_empty(),
        "frozen semantic catalog produced no routine mapping"
    );

    let mut programs: Vec<Option<MechanicsProgramV2>> = vec![None];
    let mut classifications = Vec::with_capacity(mapped.mapped.len());
    let mut behavior_units = Vec::new();
    for (index, spec) in mapped.mapped.into_iter().enumerate() {
        let id = MechanicsProgramId::try_from_u64(u64::try_from(index)? + 1)?;
        classifications.push(BehaviorClassificationEntryV2 {
            behavior_unit: spec.behavior_unit.clone(),
            kind: er_types::BehaviorClassificationKindV2::Compiled,
            programs: vec![id],
            bespoke: None,
            unsupported_reason: None,
        });
        behavior_units.push(spec.behavior_unit.clone());
        programs.push(Some(spec.build(id)?));
    }
    behavior_units.sort();
    behavior_units.dedup();

    let mut pack = BattleContentPackV3 {
        schema_version: M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION,
        oracle_sha: OracleSha::parse(validated.oracle_sha().to_owned())?,
        raw_catalog_hash: CatalogHash::parse(validated.raw_catalog_hash().to_owned())?,
        semantic_catalog_hash: validated.semantic_catalog_hash().clone(),
        content_hash: BattleContentPackHashV3::parse(format!(
            "{}{}",
            BattleContentPackHashV3::PREFIX,
            "0".repeat(64)
        ))?,
        species: Vec::new(),
        forms: Vec::new(),
        moves: Vec::new(),
        abilities: Vec::new(),
        held_items: Vec::new(),
        field_content: FieldContentV1::default(),
        programs,
        classifications: BehaviorClassificationManifestV2(classifications),
        bespoke: BespokeManifestV2::default(),
        rng_sites: Vec::new(),
        type_chart: er_content::pack::selected_type_chart(),
    };
    pack.content_hash = pack.compute_content_hash()?;
    let classification_count = classifications.len();
    let mut target_programs = Vec::new();
    for ordinal in 1..=classification_count {
        target_programs.push(MechanicsProgramId::try_from_u64(u64::try_from(ordinal)?)?);
    }
    Ok(CompiledIdentity {
        target_content_hash_v3: pack.content_hash,
        semantic_catalog_hash: validated.semantic_catalog_hash().clone(),
        target_programs,
        target_behavior_units: behavior_units,
    })
}

// ---------------------------------------------------------------------------
// Published forced-replacement doubles configuration (proven M3 harness).
// ---------------------------------------------------------------------------

const FORCED_REPLACEMENT_FIXTURE: &str =
    include_str!("../../../fixtures/m3/oracle/battle-cases/forced-replacement.json");
const LEGACY_ORACLE_CONTENT_DIGEST: &str =
    "3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";
const LEGACY_ORACLE_CONTENT_HASH: &str =
    "blake3-v1:3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";

fn normalize_nested_kind(object: &mut Value, path: &str, field_name: &str) -> TestResult {
    let object = object
        .as_object_mut()
        .ok_or_else(|| invalid(format!("{path} is not an object")))?;
    let kind = object
        .get(field_name)
        .cloned()
        .ok_or_else(|| invalid(format!("{path}.{field_name} is missing")))?;
    let normalized = match kind {
        Value::String(_) => kind,
        Value::Object(nested) => {
            if nested.len() != 1 || !nested.contains_key("kind") {
                return Err(invalid(format!(
                    "{path}.{field_name} has an unsupported nested kind shape"
                )));
            }
            let tag = nested
                .get("kind")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid(format!("{path}.{field_name}.kind is not a string")))?;
            Value::String(tag.to_owned())
        }
        other => {
            return Err(invalid(format!(
                "{path}.{field_name} has unsupported value {other}"
            )));
        }
    };
    object.insert(field_name.to_owned(), normalized);
    Ok(())
}

fn normalize_adjacent_kind(object: &mut Value, path: &str, field_name: &str) -> TestResult {
    let object = object
        .as_object_mut()
        .ok_or_else(|| invalid(format!("{path} is not an object")))?;
    if object.len() != 2
        || !object.contains_key(field_name)
        || !object.contains_key("remaining_turns")
    {
        return Err(invalid(format!(
            "{path} must have exactly kind and remaining_turns fields"
        )));
    }
    if object
        .get("remaining_turns")
        .and_then(Value::as_u64)
        .and_then(|value| u16::try_from(value).ok())
        .is_none()
    {
        return Err(invalid(format!(
            "{path}.remaining_turns is not a valid u16"
        )));
    }
    let kind = object
        .get(field_name)
        .cloned()
        .ok_or_else(|| invalid(format!("{path}.{field_name} is missing")))?;
    let normalized = match kind {
        Value::String(tag) if tag == "NONE" => json!({"kind": "NONE"}),
        Value::String(tag) => {
            return Err(invalid(format!(
                "{path}.{field_name} has an unknown legacy tag {tag:?}"
            )));
        }
        Value::Object(nested) => {
            let tag = nested
                .get("kind")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid(format!("{path}.{field_name}.kind is not a string")))?;
            let valid_shape = match tag {
                "NONE" => nested.len() == 1,
                "UNSUPPORTED_ORACLE_CODE" => {
                    nested.len() == 2
                        && nested
                            .get("value")
                            .and_then(Value::as_u64)
                            .is_some_and(|value| u16::try_from(value).is_ok())
                }
                _ => false,
            };
            if !valid_shape {
                return Err(invalid(format!(
                    "{path}.{field_name} has an invalid adjacent kind object"
                )));
            }
            Value::Object(nested)
        }
        other => {
            return Err(invalid(format!(
                "{path}.{field_name} has unsupported value {other}"
            )));
        }
    };
    object.insert(field_name.to_owned(), normalized);
    Ok(())
}

fn normalize_legacy_content_identity(
    document: &Value,
    state: &mut Value,
    selected: &ContentPack,
) -> TestResult {
    let canonical = state
        .get_mut("canonical")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| invalid("initial_state.canonical is not an object"))?;
    let fixture_hash = canonical
        .get("content_hash")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("initial_state.canonical.content_hash is missing"))?
        .to_owned();
    let expected_hash = document
        .get("expected_final_state")
        .and_then(|value| value.get("canonical"))
        .and_then(|value| value.get("content_hash"))
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("expected_final_state.canonical.content_hash is missing"))?;
    if expected_hash != fixture_hash {
        return Err(invalid(
            "published state content hashes disagree between initial and expected final state",
        ));
    }
    let provenance = document
        .get("provenance")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("published fixture provenance is missing"))?;
    let provenance_hash = provenance
        .get("content_pack_hash")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("published fixture provenance hash is missing"))?;
    let provenance_oracle_sha = provenance
        .get("oracle_game_sha")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("published fixture provenance oracle SHA is missing"))?;
    if provenance_oracle_sha != selected.oracle_game_sha {
        return Err(invalid(
            "published fixture provenance oracle SHA disagrees with selected content",
        ));
    }

    let selected_hash = selected.hash.as_str();
    let selected_digest = selected_hash
        .strip_prefix("blake3-v1:")
        .ok_or_else(|| invalid("selected content hash has no blake3-v1 prefix"))?;
    if fixture_hash == selected_hash {
        if provenance_hash != selected_digest {
            return Err(invalid(
                "selected content hash disagrees with provenance digest",
            ));
        }
        return Ok(());
    }
    if fixture_hash != LEGACY_ORACLE_CONTENT_HASH || provenance_hash != LEGACY_ORACLE_CONTENT_DIGEST
    {
        return Err(invalid(
            "fixture content identity is neither the current selected pair nor the exact published legacy pair",
        ));
    }
    canonical.insert(
        "content_hash".to_owned(),
        Value::String(selected_hash.to_owned()),
    );
    Ok(())
}

fn normalize_legacy_initial_state(state: &mut Value) -> TestResult {
    let canonical = state
        .get_mut("canonical")
        .ok_or_else(|| invalid("initial_state.canonical is missing"))?;
    let battle = canonical
        .get_mut("battle")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| invalid("initial_state canonical battle value is invalid"))?;

    let format_slots = battle
        .get("format")
        .and_then(Value::as_object)
        .and_then(|format| format.get("slots"))
        .cloned()
        .ok_or_else(|| invalid("initial_state canonical battle format slots are missing"))?;
    let field_slots = battle
        .get("field")
        .and_then(Value::as_object)
        .and_then(|field| field.get("slots"))
        .cloned()
        .ok_or_else(|| invalid("initial_state canonical battle field slots are missing"))?;
    if !format_slots.is_array() || !field_slots.is_array() {
        return Err(invalid(
            "initial_state canonical format.slots and field.slots must be arrays",
        ));
    }
    if format_slots != field_slots {
        return Err(invalid(
            "initial_state canonical format.slots does not equal field.slots",
        ));
    }
    let format = battle
        .get_mut("format")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| invalid("initial_state canonical battle format is invalid"))?;
    if format.remove("slots").is_none() {
        return Err(invalid(
            "initial_state canonical battle format slots could not be removed",
        ));
    }

    for party_name in ["player_party", "enemy_party"] {
        let party = battle
            .get_mut(party_name)
            .and_then(Value::as_array_mut)
            .ok_or_else(|| {
                invalid(format!("initial_state canonical battle {party_name} is invalid"))
            })?;
        for (index, pokemon) in party.iter_mut().enumerate() {
            let status = pokemon.get_mut("status").ok_or_else(|| {
                invalid(format!(
                    "initial_state canonical battle {party_name}[{index}] status is missing"
                ))
            })?;
            normalize_nested_kind(
                status,
                &format!("initial_state canonical battle {party_name}[{index}] status"),
                "kind",
            )?;
        }
    }
    for condition_name in ["weather", "terrain"] {
        let condition = battle.get_mut(condition_name).ok_or_else(|| {
            invalid(format!(
                "initial_state canonical battle {condition_name} is missing"
            ))
        })?;
        normalize_adjacent_kind(
            condition,
            &format!("initial_state canonical battle {condition_name}"),
            "kind",
        )?;
    }
    Ok(())
}

fn doubles_config() -> TestResult<BattleGameConfig> {
    let content = selected_content_pack()?;
    let wire: Value = serde_json::from_str(FORCED_REPLACEMENT_FIXTURE)?;
    let mut initial_state = wire
        .get("initial_state")
        .cloned()
        .ok_or_else(|| invalid("forced-replacement fixture has no initial state"))?;
    normalize_legacy_initial_state(&mut initial_state)?;
    normalize_legacy_content_identity(&wire, &mut initial_state, &content)?;
    let canonical = initial_state
        .get("canonical")
        .cloned()
        .ok_or_else(|| invalid("forced-replacement fixture has no initial canonical state"))?;
    let canonical_state: GameState = serde_json::from_value(canonical)?;
    let battle = canonical_state
        .battle
        .clone()
        .ok_or_else(|| invalid("forced-replacement fixture has no active battle"))?;
    if battle.format.player_capacity != 2 || battle.format.enemy_capacity != 2 {
        return Err(invalid(
            "forced-replacement fixture is not the required two-seat doubles topology",
        ));
    }

    let mut run_state = canonical_state.clone();
    run_state.battle = None;
    run_state.next_battle_id = battle.battle_id;

    let player_leads = (0..battle.format.player_capacity)
        .map(|position| -> TestResult<PartyIndex> {
            let slot = FieldSlot::new(BattleSide::Player, position)?;
            let pokemon_id = battle
                .field
                .occupant(&battle.format, slot)?
                .ok_or_else(|| invalid(format!("player lead slot {position} is empty")))?;
            let party_index = battle
                .player_party
                .iter()
                .position(|pokemon| pokemon.id == pokemon_id)
                .ok_or_else(|| invalid(format!("player lead {pokemon_id} is not in the party")))?;
            Ok(PartyIndex::try_from(party_index as u64)?)
        })
        .collect::<TestResult<Vec<_>>>()?;
    let enemy_leads = (0..battle.format.enemy_capacity)
        .map(|position| -> TestResult<PartyIndex> {
            let slot = FieldSlot::new(BattleSide::Enemy, position)?;
            let pokemon_id = battle
                .field
                .occupant(&battle.format, slot)?
                .ok_or_else(|| invalid(format!("enemy lead slot {position} is empty")))?;
            let party_index = battle
                .enemy_party
                .iter()
                .position(|pokemon| pokemon.id == pokemon_id)
                .ok_or_else(|| invalid(format!("enemy lead {pokemon_id} is not in the party")))?;
            Ok(PartyIndex::try_from(party_index as u64)?)
        })
        .collect::<TestResult<Vec<_>>>()?;

    let next_turn_value = battle
        .turn
        .get()
        .get()
        .checked_add(1)
        .ok_or_else(|| invalid("forced-replacement next turn overflowed"))?;
    let next_turn = TurnIndex::new(safe(next_turn_value))?;
    let mut scripted_commands = Vec::new();
    for (turn_offset, turn) in [battle.turn, next_turn].into_iter().enumerate() {
        for position in 0..battle.format.enemy_capacity {
            let field_slot = FieldSlot::new(BattleSide::Enemy, position)?;
            let actor = battle
                .field
                .occupant(&battle.format, field_slot)?
                .ok_or_else(|| invalid(format!("enemy actor slot {position} is empty")))?;
            let target_position = position.min(battle.format.player_capacity.saturating_sub(1));
            let target = FieldSlot::new(BattleSide::Player, target_position)?;
            let command = BattleCommand::fight(
                actor,
                MoveSlotIndex::ZERO,
                BattleTargetSelection::selected(vec![target])?,
            )?;
            let script_cursor = safe(
                u64::try_from(turn_offset)? * u64::from(battle.format.enemy_capacity)
                    + u64::from(position),
            );
            let operation_id = scripted_enemy_command_operation_id(
                battle.battle_id,
                battle.wave,
                turn,
                field_slot,
                script_cursor,
            )?;
            scripted_commands.push(ScriptedEnemyBattleCommandV1::new(
                operation_id,
                battle.battle_id,
                battle.wave,
                turn,
                script_cursor,
                actor,
                field_slot,
                command,
            )?);
        }
    }

    Ok(BattleGameConfig {
        run_state,
        start: BattleStartV1 {
            schema_version: 1,
            format: battle.format.clone(),
            player_party: battle.player_party.clone(),
            enemy_party: battle.enemy_party.clone(),
            player_leads,
            enemy_leads,
        },
        local_seat: seat(1),
        wave_seed: battle.wave_seed.clone(),
        scripted_enemy_policy: ScriptedEnemyPolicyV1::new(SafeU53::ZERO, scripted_commands)?,
    })
}

fn victory_config() -> TestResult<BattleGameConfig> {
    let mut config = doubles_config()?;
    let player_capacity = usize::from(config.start.format.player_capacity);
    let enemy_capacity = usize::from(config.start.format.enemy_capacity);
    let player_leads = config.start.player_leads.clone();
    if config.start.enemy_party.len() != enemy_capacity
        || config.start.enemy_leads.len() != enemy_capacity
    {
        return Err(invalid(
            "forced-victory fixture must have exactly the active enemy leads and no reserves",
        ));
    }
    if player_leads.len() != player_capacity
        || player_leads.iter().copied().collect::<BTreeSet<_>>().len() != player_capacity
    {
        return Err(invalid(
            "forced-victory fixture must have one distinct player lead per active slot",
        ));
    }

    let status_move = MoveId::try_from_u64(589)?;
    let damaging_move = MoveId::try_from_u64(1)?;
    for lead in player_leads {
        let party_index = usize::from(lead.get());
        let pokemon = config
            .start
            .player_party
            .get_mut(party_index)
            .ok_or_else(|| {
                invalid(format!(
                    "forced-victory player lead {} is outside the party",
                    lead.get()
                ))
            })?;
        let first_move = pokemon.moves[0].map(|slot| slot.move_id);
        let second_move = pokemon.moves[1].map(|slot| slot.move_id);
        if first_move != Some(status_move) || second_move != Some(damaging_move) {
            return Err(invalid(format!(
                "forced-victory player lead {} must retain fixture moves 589 then 1",
                lead.get()
            )));
        }
        pokemon.moves.swap(0, 1);
    }
    for pokemon in &mut config.start.enemy_party {
        pokemon.hp = 1;
        pokemon.fainted = false;
    }
    Ok(config)
}

fn protocol_context(
    sender_seat_id: SeatId,
    authority_seat_id: SeatId,
    connection_generation: ConnectionGeneration,
) -> TestResult<FrameContext> {
    Ok(FrameContext {
        session_id: SessionId::new("m6d-recovery-session")?,
        run_id: RunId::new("m6d-recovery-run")?,
        session_epoch: safe(1),
        seat_map_id: "m6d-recovery-seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id,
        authority_seat_id,
        connection_generation,
    })
}

fn authority_protocol(host: SeatId, guest: SeatId, connection_generation: ConnectionGeneration) -> TestResult<BattleProtocolConfig> {
    Ok(BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Authority {
            log: AuthorityLogConfig {
                local_context: protocol_context(host, host, connection_generation)?,
                peer_bindings: vec![PeerBinding {
                    seat_id: guest,
                    connection_generation,
                }],
                owner_id: "m6d-recovery:authority".to_owned(),
                retain_capacity: safe(32),
                delivery_backoff: BackoffPolicy {
                    initial_ms: safe(1),
                    maximum_ms: safe(64),
                    factor_numerator: safe(2),
                    factor_denominator: safe(1),
                },
                delivery_time_class: TimeClass::Connected,
                max_delivery_attempts: Some(safe(8)),
            },
            proposal_capacity: safe(64),
        },
    })
}

fn replica_protocol(host: SeatId, guest: SeatId, connection_generation: ConnectionGeneration) -> TestResult<BattleProtocolConfig> {
    let guest_context = protocol_context(guest, host, connection_generation)?;
    Ok(BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Replica {
            replica: AuthorityReplicaConfig {
                receipt_context: guest_context.clone(),
                authority_seat_id: host,
                authority_connection_generation: connection_generation,
            },
            proposal_leases: ProposalLeaseConfig {
                owner_prefix: "m6d-recovery:proposal:".to_owned(),
                retry_initial_ms: safe(1),
                retry_maximum_ms: safe(64),
                absolute_ceiling_ms: safe(1_200_000),
            },
            recovery: RecoveryTransactionConfig {
                local_context: guest_context,
                request_timeout_ms: safe(300_000),
                control_timeout_ms: safe(30_000),
                pacing_ms: safe(16),
                timer_owner_id: "m6d-recovery:recovery".to_owned(),
            },
        },
    })
}

// ---------------------------------------------------------------------------
// Virtual network pair of production kernels.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
enum Endpoint {
    Host,
    Guest,
}

impl Endpoint {
    fn seat(self) -> SeatId {
        match self {
            Self::Host => seat(1),
            Self::Guest => seat(2),
        }
    }

    fn peer(self) -> Self {
        match self {
            Self::Host => Self::Guest,
            Self::Guest => Self::Host,
        }
    }

    fn index(self) -> usize {
        match self {
            Self::Host => 0,
            Self::Guest => 1,
        }
    }
}

#[derive(Clone, Debug)]
enum Packet {
    Frame {
        to: Endpoint,
        frame: NetworkFrame,
        raw: RawFrame,
    },
    Proposal {
        to: Endpoint,
        proposal: ProposalMessage,
    },
}

impl Packet {
    fn destination(&self) -> Endpoint {
        match self {
            Self::Frame { to, .. } | Self::Proposal { to, .. } => *to,
        }
    }

    fn is_authority_entry_frame(&self) -> bool {
        matches!(self, Self::Frame { frame, .. } if frame.frame_type == FrameType::AuthorityEntry)
    }
}

/// Deterministic virtual-network checkpoint of the whole pair.
struct PairCheckpoint {
    authority_wire: String,
    replica_wire: String,
    packets: VecDeque<Packet>,
    generation_counter: u64,
    links_connected: [bool; 2],
    ever_connected: bool,
    timers: BTreeSet<(Endpoint, TimerId)>,
    presentations: Vec<(Endpoint, BattlePresentationEventId)>,
    settled_presentations: Vec<(Endpoint, BattlePresentationEventId)>,
    rng_log_len: usize,
    events_log_len: usize,
}

struct BattlePair {
    host: GameKernel,
    guest: GameKernel,
    generation_counter: u64,
    links_connected: [bool; 2],
    ever_connected: bool,
    packets: VecDeque<Packet>,
    timers: BTreeSet<(Endpoint, TimerId)>,
    presentations: Vec<(Endpoint, BattlePresentationEventId)>,
    settled_presentations: Vec<(Endpoint, BattlePresentationEventId)>,
    rng_log: Vec<(Endpoint, RngDraw)>,
    events_log: Vec<(Endpoint, String)>,
}

impl BattlePair {
    fn new(config: BattleGameConfig, content: Arc<ContentPack>) -> TestResult<Self> {
        let host = Endpoint::Host.seat();
        let guest = Endpoint::Guest.seat();
        let generation = ConnectionGeneration::new(safe(1));
        let mut host_config = config.clone();
        host_config.local_seat = host;
        let mut guest_config = config;
        guest_config.local_seat = guest;
        let host_kernel = GameKernel::new_battle(
            host_config,
            authority_protocol(host, guest, generation)?,
            Arc::clone(&content),
        )?;
        let guest_kernel = GameKernel::new_battle(
            guest_config,
            replica_protocol(host, guest, generation)?,
            Arc::clone(&content),
        )?;
        Ok(Self {
            host: host_kernel,
            guest: guest_kernel,
            generation_counter: 1,
            links_connected: [false, false],
            ever_connected: false,
            packets: VecDeque::new(),
            timers: BTreeSet::new(),
            presentations: Vec::new(),
            settled_presentations: Vec::new(),
            rng_log: Vec::new(),
            events_log: Vec::new(),
        })
    }

    fn kernel(&self, endpoint: Endpoint) -> &GameKernel {
        match endpoint {
            Endpoint::Host => &self.host,
            Endpoint::Guest => &self.guest,
        }
    }

    fn kernel_mut(&mut self, endpoint: Endpoint) -> &mut GameKernel {
        match endpoint {
            Endpoint::Host => &mut self.host,
            Endpoint::Guest => &mut self.guest,
        }
    }

    fn step(
        &mut self,
        endpoint: Endpoint,
        input: KernelInput,
    ) -> TestResult<Vec<(Endpoint, KernelEffect)>> {
        let (effects, rng_draws, internal_events) = {
            let kernel = self.kernel_mut(endpoint);
            if kernel.is_disposed() {
                return Ok(Vec::new());
            }
            let effects = kernel.step(input)?;
            let (rng_draws, internal_events) = kernel.m3_trace_audit();
            (effects, rng_draws, internal_events)
        };
        let mut delta = Vec::with_capacity(effects.len());
        for effect in &effects {
            self.observe_effect(endpoint, effect)?;
            delta.push((endpoint, effect.clone()));
        }
        for draw in rng_draws {
            self.rng_log.push((endpoint, draw));
        }
        for event in internal_events {
            self.events_log.push((endpoint, format!("{event:?}")));
        }
        Ok(delta)
    }

    fn observe_effect(&mut self, source: Endpoint, effect: &KernelEffect) -> TestResult {
        match effect {
            KernelEffect::SendFrame { from, frame } => {
                if *from != source.seat() || frame.context.sender_seat_id != *from {
                    return Err(invalid(
                        "SendFrame identity did not match its emitting endpoint",
                    ));
                }
                let raw = RawFrame::JsonValue(serde_json::to_value(frame)?);
                self.packets.push_back(Packet::Frame {
                    to: source.peer(),
                    frame: frame.clone(),
                    raw,
                });
            }
            KernelEffect::SendProposal { proposal } => {
                if proposal.from != source.seat() {
                    return Err(invalid(
                        "SendProposal identity did not match its emitting endpoint",
                    ));
                }
                let to = if proposal.to == Endpoint::Host.seat() {
                    Endpoint::Host
                } else if proposal.to == Endpoint::Guest.seat() {
                    Endpoint::Guest
                } else {
                    return Err(invalid("SendProposal targeted an unknown seat"));
                };
                self.packets
                    .push_back(Packet::Proposal { to, proposal: proposal.clone() });
            }
            KernelEffect::PresentBattle { endpoint, event, .. } => {
                if *endpoint != source.seat() {
                    return Err(invalid("presentation effect named the wrong seat"));
                }
                self.presentations.push((source, event.event_id.clone()));
            }
            KernelEffect::ScheduleTimer { timer_id, .. } => {
                self.timers.insert((source, *timer_id));
            }
            KernelEffect::CancelTimer { timer_id, .. } => {
                self.timers.remove(&(source, *timer_id));
            }
            _ => {}
        }
        Ok(())
    }

    fn transport_change(
        &mut self,
        endpoint: Endpoint,
        connected: bool,
        delta: &mut Vec<(Endpoint, KernelEffect)>,
    ) -> TestResult {
        let index = endpoint.index();
        if connected && !self.links_connected[index] && self.ever_connected {
            self.generation_counter += 1;
        }
        if connected {
            self.ever_connected = true;
        }
        self.links_connected[index] = connected;
        let generation = ConnectionGeneration::new(safe(self.generation_counter));
        let state = if connected {
            TransportState::Connected
        } else {
            TransportState::Disconnected
        };
        for listener in [endpoint.peer(), endpoint] {
            delta.extend(self.step(
                listener,
                KernelInput::TransportChanged {
                    endpoint: listener.peer().seat(),
                    state,
                    generation,
                },
            )?);
        }
        Ok(())
    }

    fn deliver_packet_at(
        &mut self,
        index: usize,
        delta: &mut Vec<(Endpoint, KernelEffect)>,
    ) -> TestResult {
        let packet = self
            .packets
            .remove(index)
            .ok_or_else(|| invalid(format!("no packet at index {index}")))?;
        match packet {
            Packet::Frame { to, raw, .. } => {
                delta.extend(self.step(
                    to,
                    KernelInput::RawNetworkFrame {
                        endpoint: to.seat(),
                        frame: raw,
                    },
                )?);
            }
            Packet::Proposal { to, proposal } => {
                delta.extend(self.step(
                    to,
                    KernelInput::ProposalReceived {
                        endpoint: to.seat(),
                        proposal,
                    },
                )?);
            }
        }
        Ok(())
    }

    fn deliver_all(&mut self, delta: &mut Vec<(Endpoint, KernelEffect)>) -> TestResult {
        for _ in 0..256 {
            if self.packets.is_empty() {
                return Ok(());
            }
            self.deliver_packet_at(0, delta)?;
        }
        Err(invalid("deterministic pair pump exceeded its packet bound"))
    }

    fn settle_pending_presentations(
        &mut self,
        delta: &mut Vec<(Endpoint, KernelEffect)>,
    ) -> TestResult {
        let pending = self
            .presentations
            .iter()
            .filter(|event| !self.settled_presentations.contains(event))
            .cloned()
            .collect::<Vec<_>>();
        for (endpoint, event_id) in pending {
            delta.extend(self.step(
                endpoint,
                KernelInput::BattlePresentationOutcome {
                    endpoint: endpoint.seat(),
                    event_id: event_id.clone(),
                    outcome: PresentationSettlementOutcome::Settled,
                },
            )?);
            self.settled_presentations.push((endpoint, event_id));
        }
        self.deliver_all(delta)
    }

    fn fire_scheduled_timers(
        &mut self,
        endpoint: Endpoint,
        delta: &mut Vec<(Endpoint, KernelEffect)>,
    ) -> TestResult {
        let due: Vec<TimerId> = self
            .timers
            .iter()
            .filter(|entry| entry.0 == endpoint)
            .map(|entry| entry.1)
            .collect();
        for timer_id in due {
            self.timers.remove(&(endpoint, timer_id));
            delta.extend(self.step(
                endpoint,
                KernelInput::TimerFired {
                    endpoint: endpoint.seat(),
                    timer_id,
                },
            )?);
        }
        Ok(())
    }

    fn dispose_endpoints(&mut self, delta: &mut Vec<(Endpoint, KernelEffect)>) -> TestResult {
        for endpoint in [Endpoint::Host, Endpoint::Guest] {
            let effects = self
                .kernel_mut(endpoint)
                .dispose("m6d-recovery/terminal-teardown");
            for effect in &effects {
                self.observe_effect(endpoint, effect)?;
            }
            delta.extend(effects.into_iter().map(|effect| (endpoint, effect)));
        }
        Ok(())
    }

    fn apply(&mut self, step: CampaignStep) -> TestResult<Vec<(Endpoint, KernelEffect)>> {
        let mut delta = Vec::new();
        let endpoint_of = |endpoint: CampaignEndpoint| match endpoint {
            CampaignEndpoint::Authority => Endpoint::Host,
            CampaignEndpoint::Replica => Endpoint::Guest,
        };
        match step {
            CampaignStep::KeyDown {
                endpoint,
                code,
                printable,
            } => {
                let endpoint = endpoint_of(endpoint);
                delta.extend(self.step(endpoint, KernelInput::RawInput {
                    seat: endpoint.seat(),
                    event: RawInputEvent::KeyDown {
                        code,
                        printable,
                        browser_repeat: false,
                        focus: InputFocus::Game,
                    },
                })?);
            }
            CampaignStep::KeyUp { endpoint, code } => {
                let endpoint = endpoint_of(endpoint);
                delta.extend(self.step(endpoint, KernelInput::RawInput {
                    seat: endpoint.seat(),
                    event: RawInputEvent::KeyUp { code },
                })?);
            }
            CampaignStep::Press {
                endpoint,
                code,
                printable,
            } => {
                let endpoint = endpoint_of(endpoint);
                delta.extend(self.step(endpoint, KernelInput::RawInput {
                    seat: endpoint.seat(),
                    event: RawInputEvent::KeyDown {
                        code: code.clone(),
                        printable,
                        browser_repeat: false,
                        focus: InputFocus::Game,
                    },
                })?);
                delta.extend(self.step(endpoint, KernelInput::RawInput {
                    seat: endpoint.seat(),
                    event: RawInputEvent::KeyUp { code },
                })?);
            }
            CampaignStep::DeliverPackets { count } => {
                let bound = count.min(256);
                for _ in 0..bound {
                    if self.packets.is_empty() {
                        break;
                    }
                    self.deliver_packet_at(0, &mut delta)?;
                }
            }
            CampaignStep::DeliverNonAuthorityPackets => {
                for _ in 0..256 {
                    let next = self.packets.iter().position(|packet| {
                        !(packet.destination() == Endpoint::Guest
                            && packet.is_authority_entry_frame())
                    });
                    let Some(index) = next else {
                        break;
                    };
                    self.deliver_packet_at(index, &mut delta)?;
                }
            }
            CampaignStep::TransportChange {
                endpoint,
                connected,
            } => {
                self.transport_change(endpoint_of(endpoint), connected, &mut delta)?;
            }
            CampaignStep::FireScheduledTimers { endpoint } => {
                self.fire_scheduled_timers(endpoint_of(endpoint), &mut delta)?;
            }
            CampaignStep::SettlePendingPresentations => {
                self.settle_pending_presentations(&mut delta)?;
            }
            CampaignStep::DisposeEndpoints => {
                self.dispose_endpoints(&mut delta)?;
            }
        }
        Ok(delta)
    }

    fn checkpoint(&self) -> PairCheckpoint {
        let authority = self.kernel(Endpoint::Host).snapshot_v2().expect("authority snapshot");
        let replica = self.kernel(Endpoint::Guest).snapshot_v2().expect("replica snapshot");
        PairCheckpoint {
            authority_wire: serde_json::to_string(&authority).expect("serialize authority wire"),
            replica_wire: serde_json::to_string(&replica).expect("serialize replica wire"),
            packets: self.packets.clone(),
            generation_counter: self.generation_counter,
            links_connected: self.links_connected,
            ever_connected: self.ever_connected,
            timers: self.timers.clone(),
            presentations: self.presentations.clone(),
            settled_presentations: self.settled_presentations.clone(),
            rng_log_len: self.rng_log.len(),
            events_log_len: self.events_log.len(),
        }
    }

    fn from_checkpoint(checkpoint: &PairCheckpoint, content: Arc<ContentPack>) -> TestResult<Self> {
        let authority: RestorableKernelSnapshotV2 =
            serde_json::from_str(&checkpoint.authority_wire)?;
        let replica: RestorableKernelSnapshotV2 = serde_json::from_str(&checkpoint.replica_wire)?;
        let host = GameKernel::from_snapshot(authority, Arc::clone(&content))
            .map_err(|error| invalid(format!("authority restore failed closed: {error}")))?;
        let guest = GameKernel::from_snapshot(replica, content)
            .map_err(|error| invalid(format!("replica restore failed closed: {error}")))?;
        Ok(Self {
            host,
            guest,
            generation_counter: checkpoint.generation_counter,
            links_connected: checkpoint.links_connected,
            ever_connected: checkpoint.ever_connected,
            packets: checkpoint.packets.clone(),
            timers: checkpoint.timers.clone(),
            presentations: checkpoint.presentations.clone(),
            settled_presentations: checkpoint.settled_presentations.clone(),
            rng_log: Vec::new(),
            events_log: Vec::new(),
        })
    }

    fn observe(
        &self,
        rng_baseline: usize,
        events_baseline: usize,
        label: &str,
        delta: &[(Endpoint, KernelEffect)],
    ) -> TestResult<ContinuationStep> {
        let delta_wire: Vec<(u8, &KernelEffect)> = delta
            .iter()
            .map(|(endpoint, effect)| (*endpoint as u8, effect))
            .collect();
        let effects_wire = serde_json::to_vec(&delta_wire)?;
        let rng_slice: Vec<(u8, &RngDraw)> = self.rng_log[rng_baseline..]
            .iter()
            .map(|(endpoint, draw)| (*endpoint as u8, draw))
            .collect();
        let rng_audit_wire = serde_json::to_vec(&rng_slice)?;
        let internal_events: Vec<String> = self.events_log[events_baseline..]
            .iter()
            .map(|(_, event)| event.clone())
            .collect();
        let mut next_control_wire = Vec::new();
        let mut endpoint_snapshot_wire = Vec::new();
        for endpoint in [Endpoint::Host, Endpoint::Guest] {
            let snapshot = self.kernel(endpoint).snapshot_v2()?;
            next_control_wire.extend(serde_json::to_vec(&snapshot.game.current_control)?);
            endpoint_snapshot_wire.extend(serde_json::to_vec(&snapshot)?);
        }
        Ok(ContinuationStep {
            label: label.to_owned(),
            effects_wire,
            rng_audit_wire,
            internal_events,
            state_digest_authority: self.kernel(Endpoint::Host).state_digest(),
            state_digest_replica: self.kernel(Endpoint::Guest).state_digest(),
            next_control_wire,
            endpoint_snapshot_wire,
        })
    }

    fn first_proposal_index(&self) -> Option<usize> {
        self.packets
            .iter()
            .position(|packet| matches!(packet, Packet::Proposal { .. }))
    }

    fn queued_authority_frame_index(&self) -> Option<usize> {
        self.packets
            .iter()
            .position(|packet| packet.is_authority_entry_frame())
    }

    fn control(&self, endpoint: Endpoint) -> TestResult<BattleControl> {
        let projection = self
            .kernel(endpoint)
            .battle_ui_projection()
            .ok_or_else(|| invalid("battle kernel has no UI projection"))?;
        Ok(projection.seat_control.control.clone())
    }

    fn fence_state(&self, endpoint: Endpoint) -> TestResult<String> {
        let state = self.kernel(endpoint).snapshot().state;
        Ok(state["protocol"]["recoveryFence"]["state"]
            .as_str()
            .unwrap_or("absent")
            .to_owned())
    }

    fn mechanical_state(&self, endpoint: Endpoint) -> TestResult<GameState> {
        Ok(self.kernel(endpoint).snapshot_v2()?.game.state)
    }
}

// ---------------------------------------------------------------------------
// Snapshot V5 envelope capture.
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RecoveryEnvelope {
    schema_version: u32,
    kernel: RestorableKernelSnapshotV2,
    frontier: RestorableKernelSnapshotV5,
    frontier_digest: String,
    prepared_identity_digest: String,
}

fn capture_endpoint_envelope(
    kernel: &GameKernel,
    contexts: &RecoveryFrontierContexts,
) -> TestResult<(String, CapturedFrontierV5)> {
    let v2 = kernel.snapshot_v2()?;
    assert!(
        v2.prepared_transaction.is_none(),
        "public snapshots are quiescent"
    );
    let captured = capture_frontier_v5(&v2.game.state, contexts)
        .map_err(|error| invalid(error.to_string()))?;

    let mechanical =
        FrontierMechanicalDigestV2::compute(&captured.game_v4.base).map_err(|error| {
            invalid(format!("canonical mechanical digest failed: {error}"))
        })?;
    let determinism_preimage = json!({
        "domain": "pokerogue-redux/m6/recovery/kernel-determinism/v1",
        "schema_version": RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V3,
        "mechanical_digest": mechanical.as_str(),
        "presentation_plan_digest": v2.presentation_plan_digest.as_str(),
    });
    let determinism_hex = content_digest(&determinism_preimage)
        .map_err(|error| invalid(format!("determinism preimage digest failed: {error}")))?;
    let kernel_determinism =
        KernelDeterminismDigestV2::new(format!("blake3-v1:{determinism_hex}"))
            .map_err(|error| invalid(format!("kernel determinism digest rejected: {error}")))?;

    let game_v3_snapshot = GameRuntimeSnapshotV3 {
        schema_version: GAME_RUNTIME_SNAPSHOT_SCHEMA_VERSION_V3,
        state: captured.game_v4.base.clone(),
        current_control: v2.game.current_control.clone(),
        control_history: v2.game.control_history.clone(),
        command_admission: v2.game.command_admission.clone(),
        scripted_enemy_policy: v2.game.scripted_enemy_policy.clone(),
        menu_allocators: v2.game.menu_allocators.clone(),
        completed: v2.game.completed,
        progression: captured.game_v4.base.run.progression.clone(),
        active_surface: captured.game_v4.base.run.active_surface.clone(),
        counters: captured.game_v4.base.run.counters.clone(),
        surface_digest: None,
    };
    let base_v3 = RestorableKernelSnapshotV3 {
        schema_version: RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V3,
        content_hash: v2.content_hash.clone(),
        run_content_hash: captured.game_v4.base.run_content_hash.clone(),
        runtime_identity: v2.runtime_identity.clone(),
        input_router: v2.input_router.clone(),
        ui: v2.ui.clone(),
        scheduler: v2.scheduler.clone(),
        protocol: v2.protocol.clone(),
        game: game_v3_snapshot,
        pending_presentations: v2.pending_presentations.clone(),
        terminal: v2.terminal.clone(),
        disposed: v2.disposed,
        prepared_transaction: None,
        mechanical_digest: er_kernel::snapshot_v3::MechanicalStateDigestV2::new(
            mechanical.as_str().to_owned(),
        )
        .map_err(|error| invalid(format!("mechanical digest wrapper rejected: {error}")))?,
        kernel_determinism_digest: kernel_determinism,
        presentation_plan_digest: v2.presentation_plan_digest.clone(),
        surface_digest: None,
    };
    base_v3
        .validate()
        .map_err(|error| invalid(format!("assembled V3 base snapshot is invalid: {error}")))?;
    let base_v4 = RestorableKernelSnapshotV4 {
        schema_version: RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V4,
        mechanics_program_version: MECHANICS_PROGRAM_VERSION,
        mechanic_state_schema_version: MECHANIC_STATE_SCHEMA_VERSION,
        battle_content_hash_v2: contexts.battle_content_hash_v2.clone(),
        base: base_v3,
        game_v3: captured.game_v3.clone(),
    };
    base_v4
        .validate()
        .map_err(|error| invalid(format!("assembled V4 base snapshot is invalid: {error}")))?;
    let frontier = RestorableKernelSnapshotV5::new(base_v4, captured.game_v4.clone())
        .map_err(|error| invalid(format!("Snapshot V5 construction failed closed: {error}")))?;
    frontier
        .validate()
        .map_err(|error| invalid(format!("Snapshot V5 frontier is invalid: {error}")))?;

    let envelope = RecoveryEnvelope {
        schema_version: RECOVERY_ENVELOPE_SCHEMA_VERSION,
        kernel: v2,
        frontier,
        frontier_digest: captured.frontier_digest.clone(),
        prepared_identity_digest: captured.prepared_identity_digest.clone(),
    };
    let wire = serde_json::to_string(&envelope)?;
    let decoded: RecoveryEnvelope = serde_json::from_str(&wire)?;
    assert_eq!(
        decoded, envelope,
        "Snapshot V5 envelope JSON round trip changed canonical bytes"
    );
    Ok((wire, captured))
}

// ---------------------------------------------------------------------------
// Frontier migration contexts over the live mechanical frontier.
// ---------------------------------------------------------------------------

fn m3_companion(
    side: BattleSide,
    index: usize,
    pokemon: &PokemonState,
) -> TestResult<M3PokemonCompanion> {
    let index = u8::try_from(index)?;
    Ok(M3PokemonCompanion {
        key: M3PokemonCompanionKey {
            fixture_id: "m6d-recovery".to_owned(),
            state_side: MigrationStateSide::Final,
            party_side: side,
            pokemon_id: pokemon.id,
        },
        source_party_index: index,
        stable_roster_index: index,
        owner_seat: pokemon.owner_seat,
        experience: Experience::new(safe(1234)),
        growth_rate: GrowthRateId::new(3),
        ivs: [Iv::new(31)?; 6],
        nature: NatureId::new(0),
        effective_nature: NatureId::new(0),
        friendship: 42,
        permanent_bonuses: PermanentStatBonuses {
            hp: 0,
            attack: 0,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: 0,
        },
        pause_evolutions: false,
    })
}

fn recovery_contexts(
    content: &ContentPack,
    state: &GameState,
    identity: &CompiledIdentity,
) -> TestResult<RecoveryFrontierContexts> {
    let battle = state
        .battle
        .as_ref()
        .ok_or_else(|| invalid("campaign frontier has no active battle"))?;

    let mut companions = Vec::new();
    for (side, party) in [
        (BattleSide::Player, &battle.player_party),
        (BattleSide::Enemy, &battle.enemy_party),
    ] {
        for (index, pokemon) in party.iter().enumerate() {
            companions.push(m3_companion(side, index, pokemon)?);
        }
    }

    let mut participants = Vec::new();
    for position in 0..battle.format.player_capacity {
        let slot = FieldSlot::new(BattleSide::Player, position)?;
        if let Some(id) = battle.field.occupant(&battle.format, slot)? {
            participants.push(id);
        }
    }

    let m3_to_m4 = M3ToM4MigrationContext {
        m3_parity_oracle_sha: M3_PARITY_ORACLE_SHA.to_owned(),
        m4_oracle_sha: M4_ORACLE_SHA.to_owned(),
        battle_content_hash: state.content_hash.clone(),
        run_content_hash: RunContentPackHash::new(format!("blake3-v1:{}", "b".repeat(64)))?,
        run: RunStateV2 {
            schema_version: 1,
            run_id: GameRunId::new(safe(1)),
            seed: "m6d-recovery".to_owned(),
            wave: state.wave,
            next_battle_id: state.next_battle_id,
            run_rng: state.run_rng.clone(),
            stage: RunStage::Battle,
            outcome: RunOutcome::InProgress,
            money: Money::ZERO,
            modifiers: Vec::new(),
            progression: ProgressionQueue {
                schema_version: 1,
                tasks: Vec::new(),
                active_index: None,
                next_task_id: RunTaskId::new(safe(1)),
            },
            active_surface: None,
            biome: BiomeRuntimeState {
                biome: BiomeId::new(safe(1)),
                source_wave: state.wave,
                route_node: None,
                previous_biome: None,
                recent_biomes: [None, None],
                structure_start_wave: state.wave,
                structure_length: None,
                leave_biome_now: false,
                overstay_anchor_wave: None,
            },
            counters: RunCounters {
                interaction: RunInteractionSequence::new(safe(0)),
                pending_remote_interaction: None,
                next_surface_id: RunSurfaceId::new(safe(1)),
                per_stream_action_ordinals: Vec::new(),
            },
        },
        fixture_id: "m6d-recovery".to_owned(),
        state_side: MigrationStateSide::Final,
        companions,
        battle: Some(M3BattleCompanion {
            fixture_id: "m6d-recovery".to_owned(),
            state_side: MigrationStateSide::Final,
            participation: BattleParticipationState {
                player_participants: participants,
                defeated_enemies: Vec::new(),
            },
            settlement: BattleSettlementState {
                source_battle_id: battle.battle_id,
                settled: false,
                scattered_money: Money::ZERO,
                wave_reward_evidence: Vec::new(),
            },
        }),
    };

    let m5_to_m6 = M5ToM6MigrationContext {
        source_content_hash_v2: content.hash.as_str().to_owned(),
        target_content_hash_v3: identity.target_content_hash_v3.clone(),
        semantic_catalog_hash: identity.semantic_catalog_hash.clone(),
        bindings: Vec::new(),
        target_programs: identity.target_programs.clone(),
        target_behavior_units: identity.target_behavior_units.clone(),
        held_item_registry_keys: Vec::new(),
    };

    Ok(RecoveryFrontierContexts {
        m3_to_m4,
        battle_content_hash_v2: content.hash.as_str().to_owned(),
        m5_to_m6,
    })
}

// ---------------------------------------------------------------------------
// Boundary / tail assertions and the shared campaign runner.
// ---------------------------------------------------------------------------

fn assert_boundary_state(pair: &BattlePair, boundary: RecoveryBoundaryKind) -> TestResult {
    match boundary {
        RecoveryBoundaryKind::HeldKey => {
            let snapshot = pair.kernel(Endpoint::Host).snapshot_v2()?;
            assert_eq!(snapshot.input_router.pressed.len(), 1);
            assert!(!snapshot.input_router.held_buttons.is_empty());
            assert!(
                snapshot
                    .scheduler
                    .timers
                    .iter()
                    .any(|timer| timer.registration.owner.owner_id == "input-router"),
                "held key must own a live repeat timer"
            );
        }
        RecoveryBoundaryKind::CollectedCommand => {
            assert!(matches!(
                pair.control(Endpoint::Guest)?,
                BattleControl::Waiting(_)
            ));
            assert!(
                pair.first_proposal_index().is_some(),
                "collected-command boundary must hold queued proposals"
            );
        }
        RecoveryBoundaryKind::AdmittedProposal => {
            assert_ne!(
                pair.kernel(Endpoint::Host).state_digest(),
                pair.kernel(Endpoint::Guest).state_digest(),
            );
            assert!(pair.packets.is_empty());
            assert!(
                matches!(
                    pair.control(Endpoint::Guest)?,
                    BattleControl::Waiting(_)
                ),
                "replica must wait behind its admitted proposal"
            );
        }
        RecoveryBoundaryKind::DelayedMaterialControl => {
            assert_ne!(
                pair.kernel(Endpoint::Host).state_digest(),
                pair.kernel(Endpoint::Guest).state_digest(),
            );
            assert!(
                pair.queued_authority_frame_index().is_some(),
                "delayed-material boundary must stage committed material in the network"
            );
        }
        RecoveryBoundaryKind::ReplacementSelection => {
            assert!(matches!(
                pair.control(Endpoint::Host)?,
                BattleControl::ReplacementSelect(_)
            ));
        }
        RecoveryBoundaryKind::RecoveryFence => {
            assert_eq!(pair.fence_state(Endpoint::Guest)?, "held");
        }
        RecoveryBoundaryKind::PendingPresentation => {
            let host_pending = pair.kernel(Endpoint::Host).snapshot_v2()?.pending_presentations;
            let guest_pending = pair.kernel(Endpoint::Guest).snapshot_v2()?.pending_presentations;
            assert!(
                !host_pending.pending_barrier_ids.is_empty()
                    || !guest_pending.pending_barrier_ids.is_empty(),
                "pending-presentation boundary must retain a live barrier"
            );
        }
        RecoveryBoundaryKind::TerminalTeardown => {
            let host = pair.kernel(Endpoint::Host).snapshot_v2()?;
            let guest = pair.kernel(Endpoint::Guest).snapshot_v2()?;
            assert!(host.disposed && guest.disposed);
            assert!(host.game.completed || host.terminal.is_some());
            assert_eq!(pair.kernel(Endpoint::Host).live_resources(), Default::default());
            assert_eq!(pair.kernel(Endpoint::Guest).live_resources(), Default::default());
        }
    }
    Ok(())
}

fn assert_tail_state(pair: &BattlePair, boundary: RecoveryBoundaryKind) -> TestResult {
    match boundary {
        RecoveryBoundaryKind::RecoveryFence => {
            assert_eq!(pair.fence_state(Endpoint::Guest)?, "open");
        }
        RecoveryBoundaryKind::DelayedMaterialControl => {
            assert_eq!(
                pair.kernel(Endpoint::Host).state_digest(),
                pair.kernel(Endpoint::Guest).state_digest(),
            );
        }
        RecoveryBoundaryKind::TerminalTeardown => {
            assert!(pair.host.is_disposed() && pair.guest.is_disposed());
            assert_eq!(pair.host.live_resources(), Default::default());
            assert_eq!(pair.guest.live_resources(), Default::default());
        }
        _ => {}
    }
    Ok(())
}

fn assert_pair_observation_equal(
    left: &BattlePair,
    right: &BattlePair,
    content: &ContentPack,
    label: &str,
) -> TestResult {
    for endpoint in [Endpoint::Host, Endpoint::Guest] {
        let left_v2 = left.kernel(endpoint).snapshot_v2()?;
        let right_v2 = right.kernel(endpoint).snapshot_v2()?;
        left_v2.validate_for_content(content)?;
        right_v2.validate_for_content(content)?;
        assert_eq!(
            serde_json::to_vec(&left_v2)?,
            serde_json::to_vec(&right_v2)?,
            "complete endpoint snapshot bytes diverged after {label} at {endpoint:?}",
        );
        assert_eq!(
            left_v2.mechanical_digest, right_v2.mechanical_digest,
            "mechanical digest diverged after {label} at {endpoint:?}",
        );
        assert_eq!(
            left_v2.kernel_determinism_digest, right_v2.kernel_determinism_digest,
            "kernel determinism digest diverged after {label} at {endpoint:?}",
        );
        assert_eq!(
            left_v2.presentation_plan_digest, right_v2.presentation_plan_digest,
            "presentation plan digest diverged after {label} at {endpoint:?}",
        );
        assert_eq!(
            left.kernel(endpoint).state_digest(),
            right.kernel(endpoint).state_digest(),
            "state digest diverged after {label} at {endpoint:?}",
        );
        assert_eq!(
            left.kernel(endpoint).live_resources(),
            right.kernel(endpoint).live_resources(),
            "live resources diverged after {label} at {endpoint:?}",
        );
        assert_eq!(
            left.kernel(endpoint).battle_ui_projection(),
            right.kernel(endpoint).battle_ui_projection(),
            "UI projection diverged after {label} at {endpoint:?}",
        );
    }
    Ok(())
}

fn assert_pair_step_snapshots_equal(
    left: &BattlePair,
    right: &BattlePair,
    label: &str,
) -> TestResult {
    for endpoint in [Endpoint::Host, Endpoint::Guest] {
        let left_v2 = left.kernel(endpoint).snapshot_v2()?;
        let right_v2 = right.kernel(endpoint).snapshot_v2()?;
        assert_eq!(
            serde_json::to_vec(&left_v2)?,
            serde_json::to_vec(&right_v2)?,
            "complete endpoint snapshot bytes diverged during {label} at {endpoint:?}",
        );
    }
    Ok(())
}

fn run_recovery_campaign(boundary: RecoveryBoundaryKind) -> TestResult {
    let content = Arc::new(selected_content_pack()?);
    let config = if boundary == RecoveryBoundaryKind::TerminalTeardown {
        victory_config()?
    } else {
        doubles_config()?
    };
    let script = campaign(boundary);
    for step in &script.setup {
        native.apply(step.clone())?;
    }
    assert_boundary_state(&native, boundary)?;

    let identity = compiled_identity()?;
    let contexts = recovery_contexts(
        &content,
        &native.mechanical_state(Endpoint::Host)?,
        &identity,
    )?;
    let (authority_envelope_wire, authority_captured) =
        capture_endpoint_envelope(&native.host, &contexts)?;
    let (replica_envelope_wire, replica_captured) =
        capture_endpoint_envelope(&native.guest, &contexts)?;
    let checkpoint = native.checkpoint();

    for (name, wire) in [
        ("authority", &authority_envelope_wire),
        ("replica", &replica_envelope_wire),
    ] {
        let decoded: RecoveryEnvelope = serde_json::from_str(wire)?;
        decoded.frontier.validate().map_err(|error| {
            invalid(format!("{name} Snapshot V5 frontier failed validation: {error}"))
        })?;
    }

    let mut restored = BattlePair::from_checkpoint(&checkpoint, Arc::clone(&content))?;
    assert_pair_observation_equal(&native, &restored, &content, "restore-at-boundary")?;
    verify_restored_frontier_v5(
        &restored.mechanical_state(Endpoint::Host)?,
        &authority_captured,
        &contexts,
    )
    .map_err(|error| invalid(error.to_string()))?;
    verify_restored_frontier_v5(
        &restored.mechanical_state(Endpoint::Guest)?,
        &replica_captured,
        &contexts,
    )
    .map_err(|error| invalid(error.to_string()))?;

    let mut native_steps = Vec::new();
    let mut restored_steps = Vec::new();
    for (index, step) in script.continuation.iter().enumerate() {
        let label = format!("{}/continuation/{index}", script.id);
        let native_delta = native.apply(step.clone())?;
        native_steps.push(native.observe(
            checkpoint.rng_log_len,
            checkpoint.events_log_len,
            &label,
            &native_delta,
        )?);
        let restored_delta = restored.apply(step.clone())?;
        restored_steps.push(restored.observe(0, 0, &label, &restored_delta)?);
        assert_pair_step_snapshots_equal(&native, &restored, &label)?;
    }
    assert_continuation_identical(&native_steps, &restored_steps)
        .map_err(|mismatch| invalid(mismatch.to_string()))?;
    assert_tail_state(&native, boundary)?;
    assert_tail_state(&restored, boundary)?;
    Ok(())
}

fn held_key_envelope_wire() -> TestResult<String> {
    let content = Arc::new(selected_content_pack()?);
    let script = campaign(RecoveryBoundaryKind::HeldKey);
    for step in &script.setup {
        pair.apply(step.clone())?;
    }
    let identity = compiled_identity()?;
    let contexts = recovery_contexts(
        &selected_content_pack()?,
        &pair.mechanical_state(Endpoint::Host)?,
        &identity,
    )?;
    let (wire, _) = capture_endpoint_envelope(&pair.host, &contexts)?;
    Ok(wire)
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

#[test]
fn campaign_catalog_covers_every_boundary_once() {
    let campaigns = recovery_campaign::recovery_campaigns();
    assert_eq!(campaigns.len(), RECOVERY_BOUNDARY_KINDS.len());
    let mut seen = BTreeSet::new();
    for script in &campaigns {
        assert!(seen.insert(script.boundary), "duplicate boundary campaign");
        assert!(!script.continuation.is_empty());
        assert!(!script.setup.is_empty());
    }
    for boundary in RECOVERY_BOUNDARY_KINDS {
        assert!(seen.contains(&boundary));
    }
}

#[test]
fn held_key_boundary_restores_and_continues_identically() -> TestResult {
    run_recovery_campaign(RecoveryBoundaryKind::HeldKey)
}

#[test]
fn collected_command_boundary_restores_and_continues_identically() -> TestResult {
    run_recovery_campaign(RecoveryBoundaryKind::CollectedCommand)
}

#[test]
fn admitted_proposal_boundary_restores_and_continues_identically() -> TestResult {
    run_recovery_campaign(RecoveryBoundaryKind::AdmittedProposal)
}

#[test]
fn delayed_material_control_boundary_restores_and_continues_identically() -> TestResult {
    run_recovery_campaign(RecoveryBoundaryKind::DelayedMaterialControl)
}

#[test]
fn replacement_selection_boundary_restores_and_continues_identically() -> TestResult {
    run_recovery_campaign(RecoveryBoundaryKind::ReplacementSelection)
}

#[test]
fn recovery_fence_boundary_restores_and_continues_identically() -> TestResult {
    run_recovery_campaign(RecoveryBoundaryKind::RecoveryFence)
}

#[test]
fn pending_presentation_boundary_restores_and_continues_identically() -> TestResult {
    run_recovery_campaign(RecoveryBoundaryKind::PendingPresentation)
}

#[test]
fn terminal_teardown_boundary_restores_absorbing_and_resource_free() -> TestResult {
    run_recovery_campaign(RecoveryBoundaryKind::TerminalTeardown)
}

#[test]
fn tampered_snapshot_v5_envelopes_fail_closed() -> TestResult {
    let content = Arc::new(selected_content_pack()?);
    let wire = held_key_envelope_wire()?;
    let envelope_value: Value = serde_json::from_str(&wire)?;

    // Positive control: the untampered envelope validates and restores.
    let positive: RecoveryEnvelope = serde_json::from_str(&wire)?;
    positive
        .frontier
        .validate()
        .expect("untampered frontier validates");
    GameKernel::from_snapshot(positive.kernel, Arc::clone(&content))
        .expect("untampered kernel snapshot restores");

    for vector in SNAPSHOT_V5_TAMPER_VECTORS {
        let tampered = apply_snapshot_v5_tamper(&envelope_value, vector)
            .map_err(|error| invalid(error.to_string()))?;
        let decoded: Result<RecoveryEnvelope, _> = serde_json::from_value(tampered);
        match vector {
            SnapshotV5TamperVector::KernelEndpointSchema => {
                let decoded = decoded.map_err(|error| {
                    invalid(format!("kernel tamper broke decoding: {error}"))
                })?;
                decoded
                    .frontier
                    .validate()
                    .expect("frontier stays valid under kernel tamper");
                assert!(
                    GameKernel::from_snapshot(decoded.kernel, Arc::clone(&content)).is_err(),
                    "tampered kernel endpoint snapshot must fail closed"
                );
            }
            _ => {
                let fail_closed = match decoded {
                    Err(_) => true,
                    Ok(envelope) => envelope.frontier.validate().is_err(),
                };
                assert!(
                    fail_closed,
                    "tamper vector {:?} was accepted; envelopes must fail closed",
                    vector
                );
            }
        }
    }
    Ok(())
}
