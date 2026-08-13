//! Deterministic hosted M3 Battle-kernel workloads.
//!
//! Every player action enters through a physical raw-key event.  The only
//! non-key inputs below are the public presentation-settlement boundary used
//! by a hosted presenter.  The benchmark reports deterministic checksums and
//! operation counts; wall time and RSS are measured by the hosted coordinator.

use std::collections::BTreeMap;
use std::error::Error;
use std::io::{self, Write};
use std::sync::Arc;
use std::time::Instant;

use er_content::pack::{ContentPack, selected_content_pack};
use er_kernel::{
    BattleGameConfig, BattleProtocolConfig, BattleProtocolRoleConfig, BattleStartV1, GameKernel,
    KernelEffect, KernelInput,
};
use er_protocol::{
    AuthorityLogConfig, AuthorityReplicaConfig, BackoffPolicy, PeerBinding, ProposalLeaseConfig,
    RecoveryTransactionConfig,
};
use er_sim::{PairEndpoint, PairOperation, PairStep, SimulatedBattlePairConfig, SimulatedPair};
use er_state::battle::BattleState;
use er_state::snapshot::GameState;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleTargetSelection, CommandAdmissionSource,
    CommandFrontierStatus, ScriptedEnemyBattleCommandV1, ScriptedEnemyPolicyV1,
    player_command_operation_id, scripted_enemy_command_operation_id,
};
use er_types::battle_control::{BattleControl, BattleControlPlan};
use er_types::battle_ids::{
    BattlePresentationEventId, BattleSide, FieldSlot, MoveSlotIndex, PartyIndex,
};
use er_types::battle_model::BattleOutcome;
use er_types::battle_ui::{BattleUiProjection, PresentationSettlementOutcome};
use er_types::{
    ConnectionGeneration, FrameContext, FrameType, InputFocus, MembershipRevision, PhysicalKey,
    RawInputEvent, RunId, SafeU53, SeatId, SessionId, TerminalState, TimeClass,
};
use serde::Serialize;
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const RAW_MENU_EVENTS: u64 = 100_000;
const SIMPLE_TURN_RESOLUTIONS: u64 = 10_000;
const COMPLETE_SHORT_BATTLES: u64 = 1_000;
const TWO_CLIENT_SUPPORTED_TURNS: u64 = 1_000;
const BENCHMARK_SEED: &str = "81985529216486895";
const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

const PHYSICAL_HIT_FIXTURE: &str =
    include_str!("../../../fixtures/m3/oracle/battle-cases/physical-hit.json");
const VICTORY_FIXTURE: &str = include_str!("../../../fixtures/m3/oracle/battle-cases/victory.json");
const DOUBLES_FIXTURE: &str =
    include_str!("../../../fixtures/m3/oracle/battle-cases/doubles-single-target.json");
const CONTENT_PACK_FIXTURE: &str = include_str!("../../../fixtures/m3/oracle/content-pack-v1.json");
const LEGACY_ORACLE_CONTENT_DIGEST: &str =
    "3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";
const LEGACY_ORACLE_CONTENT_HASH: &str =
    "blake3-v1:3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";

#[derive(Clone, Debug, Default, Serialize)]
struct Counts {
    turns: u64,
    battles: u64,
    inputs: u64,
    rng_draws: u64,
}

fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(_) => SafeU53::ZERO,
    }
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn invalid(message: impl Into<String>) -> Box<dyn Error> {
    io::Error::new(io::ErrorKind::InvalidData, message.into()).into()
}

fn elapsed_ns(start: Instant) -> u64 {
    match u64::try_from(start.elapsed().as_nanos()) {
        Ok(value) => value,
        Err(_) => u64::MAX,
    }
}

fn fixture_value(source: &str) -> TestResult<Value> {
    Ok(serde_json::from_str(source)?)
}

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
    let kind = object
        .get(field_name)
        .cloned()
        .ok_or_else(|| invalid(format!("{path}.{field_name} is missing")))?;
    let normalized = match kind {
        Value::String(tag) if tag == "NONE" => json!({"kind": tag}),
        Value::String(tag) => {
            return Err(invalid(format!(
                "{path}.{field_name} has an unsupported legacy tag {tag:?}"
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

fn normalize_legacy_content_conditions(content: &mut Value) -> TestResult {
    let manifest = content
        .get_mut("capability_manifest")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| invalid("content_pack.capability_manifest is not an object"))?;
    let entries = manifest
        .get_mut("entries")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| invalid("content_pack.capability_manifest.entries is not an array"))?;

    for (index, entry) in entries.iter_mut().enumerate() {
        let path = format!("content_pack.capability_manifest.entries[{index}].subject");
        let subject = entry
            .get_mut("subject")
            .ok_or_else(|| invalid(format!("{path} is missing")))?;
        let is_condition = {
            let subject = subject
                .as_object_mut()
                .ok_or_else(|| invalid(format!("{path} is not an object")))?;
            if subject.len() != 2 || !subject.contains_key("kind") || !subject.contains_key("value")
            {
                return Err(invalid(format!(
                    "{path} must contain exactly kind and value"
                )));
            }
            let kind = subject
                .get("kind")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid(format!("{path}.kind is not a string")))?;
            matches!(kind, "WEATHER" | "TERRAIN")
        };
        if is_condition {
            normalize_adjacent_kind(subject, &path, "value")?;
        }
    }
    Ok(())
}

fn normalize_legacy_type_chart(content: &mut Value, selected: &ContentPack) -> TestResult {
    let entries = content
        .get_mut("type_chart")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| invalid("content_pack.type_chart is not an object"))?
        .get_mut("entries")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| invalid("content_pack.type_chart.entries is not an array"))?;
    let expected_entries = serde_json::to_value(&selected.type_chart.entries)?
        .as_array()
        .cloned()
        .ok_or_else(|| invalid("selected type-chart entries are not an array"))?;
    let legacy_entries = entries.clone();
    if legacy_entries.len() != expected_entries.len() {
        return Err(invalid(
            "content_pack.type_chart.entries count differs from selected content",
        ));
    }
    for (index, expected) in expected_entries.iter().enumerate() {
        if legacy_entries
            .iter()
            .filter(|entry| *entry == expected)
            .count()
            != 1
        {
            return Err(invalid(format!(
                "content_pack.type_chart.entries does not contain selected entry at index {index}"
            )));
        }
    }
    *entries = expected_entries;
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
                invalid(format!(
                    "initial_state canonical battle {party_name} is invalid"
                ))
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

fn fixture_content_pack() -> TestResult<Arc<ContentPack>> {
    let wire: Value = serde_json::from_str(CONTENT_PACK_FIXTURE)?;
    let selected = selected_content_pack()?;
    selected.validate()?;

    let provenance = wire
        .get("provenance")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("content-pack fixture provenance is missing"))?;
    let provenance_hash = provenance
        .get("content_pack_hash")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("content-pack fixture provenance hash is missing"))?;
    let provenance_oracle_sha = provenance
        .get("oracle_game_sha")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("content-pack fixture provenance oracle SHA is missing"))?;
    let pack = wire
        .get("content_pack")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("content-pack fixture content_pack is missing"))?;
    let pack_hash = pack
        .get("hash")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("content-pack fixture pack hash is missing"))?;
    let pack_oracle_sha = pack
        .get("oracle_game_sha")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("content-pack fixture pack oracle SHA is missing"))?;
    if pack_hash != LEGACY_ORACLE_CONTENT_HASH
        || provenance_hash != LEGACY_ORACLE_CONTENT_DIGEST
        || pack_oracle_sha != selected.oracle_game_sha
        || provenance_oracle_sha != selected.oracle_game_sha
    {
        return Err(invalid(
            "content-pack fixture is not the exact supported legacy identity",
        ));
    }

    let mut value = Value::Object(pack.clone());
    normalize_legacy_type_chart(&mut value, &selected)?;
    normalize_legacy_content_conditions(&mut value)?;
    value
        .as_object_mut()
        .ok_or_else(|| invalid("content-pack fixture content_pack is not an object"))?
        .insert("hash".to_owned(), Value::String(selected.hash.to_string()));
    let pack: ContentPack = serde_json::from_value(value)?;
    if pack != selected {
        return Err(invalid(
            "legacy content-pack fixture did not normalize to the selected content",
        ));
    }
    Ok(Arc::new(pack))
}

fn normalize_legacy_content_identity(
    document: &Value,
    state: &mut Value,
    content: &ContentPack,
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
            "battle fixture state content hashes disagree between initial and expected final state",
        ));
    }
    let provenance = document
        .get("provenance")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("battle fixture provenance is missing"))?;
    let provenance_hash = provenance
        .get("content_pack_hash")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("battle fixture provenance hash is missing"))?;
    let provenance_oracle_sha = provenance
        .get("oracle_game_sha")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("battle fixture provenance oracle SHA is missing"))?;
    if provenance_oracle_sha != content.oracle_game_sha {
        return Err(invalid(
            "battle fixture provenance oracle SHA disagrees with selected content",
        ));
    }

    let selected_hash = content.hash.as_str();
    let selected_digest = selected_hash
        .strip_prefix("blake3-v1:")
        .ok_or_else(|| invalid("selected content hash has no blake3-v1 prefix"))?;
    if fixture_hash == selected_hash {
        if provenance_hash != selected_digest {
            return Err(invalid(
                "selected battle fixture content hash disagrees with provenance digest",
            ));
        }
        return Ok(());
    }
    if fixture_hash != LEGACY_ORACLE_CONTENT_HASH || provenance_hash != LEGACY_ORACLE_CONTENT_DIGEST
    {
        return Err(invalid(
            "battle fixture content identity is not the exact supported legacy pair",
        ));
    }
    canonical.insert(
        "content_hash".to_owned(),
        Value::String(selected_hash.to_owned()),
    );
    Ok(())
}

fn canonical_state(fixture: &Value, content: &ContentPack) -> TestResult<GameState> {
    let mut initial_state = fixture
        .get("initial_state")
        .cloned()
        .ok_or_else(|| invalid("battle fixture has no initial_state"))?;
    normalize_legacy_initial_state(&mut initial_state)?;
    normalize_legacy_content_identity(fixture, &mut initial_state, content)?;
    let canonical = initial_state
        .get("canonical")
        .cloned()
        .ok_or_else(|| invalid("battle fixture has no initial canonical state"))?;
    Ok(serde_json::from_value(canonical)?)
}

fn lead_indices(
    battle: &BattleState,
    side: BattleSide,
    capacity: u8,
) -> TestResult<Vec<PartyIndex>> {
    (0..capacity)
        .map(|position| {
            let slot = FieldSlot::new(side, position)?;
            let pokemon_id = battle
                .field
                .occupant(&battle.format, slot)?
                .ok_or_else(|| invalid(format!("{side:?} lead slot {position} is empty")))?;
            let party = match side {
                BattleSide::Player => &battle.player_party,
                BattleSide::Enemy => &battle.enemy_party,
            };
            let index = party
                .iter()
                .position(|pokemon| pokemon.id == pokemon_id)
                .ok_or_else(|| invalid(format!("lead {pokemon_id:?} is not in the party")))?;
            Ok(PartyIndex::try_from(index as u64)?)
        })
        .collect()
}

fn scripted_enemy_policy(battle: &BattleState) -> TestResult<ScriptedEnemyPolicyV1> {
    let mut commands = Vec::new();
    let enemy_capacity = battle.format.enemy_capacity;
    for position in 0..enemy_capacity {
        let field_slot = FieldSlot::new(BattleSide::Enemy, position)?;
        let actor = battle
            .field
            .occupant(&battle.format, field_slot)?
            .ok_or_else(|| invalid(format!("enemy lead slot {position} is empty")))?;
        let target_position = position.min(battle.format.player_capacity.saturating_sub(1));
        let target = FieldSlot::new(BattleSide::Player, target_position)?;
        let command = BattleCommand::fight(
            actor,
            MoveSlotIndex::ZERO,
            BattleTargetSelection::selected(vec![target])?,
        )?;
        let operation_id = scripted_enemy_command_operation_id(
            battle.battle_id,
            battle.wave,
            battle.turn,
            field_slot,
            safe(u64::from(position)),
        )?;
        commands.push(ScriptedEnemyBattleCommandV1::new(
            operation_id,
            battle.battle_id,
            battle.wave,
            battle.turn,
            safe(u64::from(position)),
            actor,
            field_slot,
            command,
        )?);
    }
    Ok(ScriptedEnemyPolicyV1::new(safe(0), commands)?)
}

fn battle_config(
    fixture: &Value,
    content: &ContentPack,
    local_seat: SeatId,
    force_short_victory: bool,
) -> TestResult<BattleGameConfig> {
    let canonical = canonical_state(fixture, content)?;
    let mut battle = canonical
        .battle
        .clone()
        .ok_or_else(|| invalid("battle fixture has no active battle"))?;
    if force_short_victory {
        for pokemon in &mut battle.enemy_party {
            pokemon.hp = 1;
        }
    }

    let mut run_state = canonical;
    run_state.battle = None;
    run_state.next_battle_id = battle.battle_id.clone();
    let player_leads = lead_indices(&battle, BattleSide::Player, battle.format.player_capacity)?;
    let enemy_leads = lead_indices(&battle, BattleSide::Enemy, battle.format.enemy_capacity)?;
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
        local_seat,
        wave_seed: battle.wave_seed.clone(),
        scripted_enemy_policy: scripted_enemy_policy(&battle)?,
    })
}

fn context(
    prefix: &str,
    iteration: u64,
    sender_seat_id: SeatId,
    authority_seat_id: SeatId,
    connection_generation: ConnectionGeneration,
) -> TestResult<FrameContext> {
    Ok(FrameContext {
        session_id: SessionId::new(format!("{prefix}-session-{iteration}"))?,
        run_id: RunId::new(format!("{prefix}-run-{iteration}"))?,
        session_epoch: safe(1),
        seat_map_id: format!("{prefix}-seat-map-{iteration}"),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id,
        authority_seat_id,
        connection_generation,
    })
}

fn authority_protocol(
    prefix: &str,
    iteration: u64,
    host: SeatId,
    guest: Option<SeatId>,
    connection_generation: ConnectionGeneration,
) -> TestResult<BattleProtocolConfig> {
    Ok(BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Authority {
            log: AuthorityLogConfig {
                local_context: context(prefix, iteration, host, host, connection_generation)?,
                peer_bindings: guest
                    .into_iter()
                    .map(|seat_id| PeerBinding {
                        seat_id,
                        connection_generation,
                    })
                    .collect(),
                owner_id: format!("{prefix}:authority:{iteration}"),
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

fn replica_protocol(
    prefix: &str,
    iteration: u64,
    host: SeatId,
    guest: SeatId,
    connection_generation: ConnectionGeneration,
) -> TestResult<BattleProtocolConfig> {
    let guest_context = context(prefix, iteration, guest, host, connection_generation)?;
    Ok(BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Replica {
            replica: AuthorityReplicaConfig {
                receipt_context: guest_context.clone(),
                authority_seat_id: host,
                authority_connection_generation: connection_generation,
            },
            proposal_leases: ProposalLeaseConfig {
                owner_prefix: format!("{prefix}:proposal:{iteration}:"),
                retry_initial_ms: safe(1),
                retry_maximum_ms: safe(64),
                absolute_ceiling_ms: safe(1_200_000),
            },
            recovery: RecoveryTransactionConfig {
                local_context: guest_context,
                request_timeout_ms: safe(300_000),
                control_timeout_ms: safe(30_000),
                pacing_ms: safe(16),
                timer_owner_id: format!("{prefix}:recovery:{iteration}"),
            },
        },
    })
}

fn new_local_kernel(
    fixture: &Value,
    content: &Arc<ContentPack>,
    iteration: u64,
) -> TestResult<GameKernel> {
    let local_seat = seat(1);
    let config = battle_config(fixture, content.as_ref(), local_seat, false)?;
    let protocol = authority_protocol(
        "m3-benchmark-local",
        iteration,
        local_seat,
        None,
        ConnectionGeneration::ZERO,
    )?;
    Ok(GameKernel::new_battle(
        config,
        protocol,
        Arc::clone(content),
    )?)
}

fn new_pair(
    fixture: &Value,
    content: &Arc<ContentPack>,
    iteration: u64,
    force_short_victory: bool,
) -> TestResult<SimulatedPair> {
    let host = seat(1);
    let guest = seat(2);
    let generation = ConnectionGeneration::new(safe(1));
    Ok(SimulatedPair::new_battle(SimulatedBattlePairConfig {
        host_game: battle_config(fixture, content.as_ref(), host, force_short_victory)?,
        host_protocol: authority_protocol(
            "m3-benchmark-pair",
            iteration,
            host,
            Some(guest),
            generation,
        )?,
        guest_game: battle_config(fixture, content.as_ref(), guest, force_short_victory)?,
        guest_protocol: replica_protocol("m3-benchmark-pair", iteration, host, guest, generation)?,
        content: Arc::clone(content),
        replay_seed: 0x4c,
        initial_storage: BTreeMap::new(),
    })?)
}

fn key_down(code: PhysicalKey) -> RawInputEvent {
    RawInputEvent::KeyDown {
        code,
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    }
}

fn key_up(code: PhysicalKey) -> RawInputEvent {
    RawInputEvent::KeyUp { code }
}

fn raw_input(local_seat: SeatId, event: RawInputEvent) -> KernelInput {
    KernelInput::RawInput {
        seat: local_seat,
        event,
    }
}

fn absorb<T: Serialize>(checksum: &mut u64, value: &T) -> TestResult {
    for byte in serde_json::to_vec(value)? {
        *checksum ^= u64::from(byte);
        *checksum = checksum.wrapping_mul(FNV_PRIME);
    }
    Ok(())
}

fn assert_no_legacy_success_effects(effects: &[KernelEffect]) {
    assert!(effects.iter().all(|effect| {
        !matches!(
            effect,
            KernelEffect::ApplyAuthorityMaterial { .. }
                | KernelEffect::ProjectAuthorityControl { .. }
                | KernelEffect::UiIntent { .. }
        )
    }));
}

fn count_rng_draws(effects: &[KernelEffect]) -> u64 {
    effects
        .iter()
        .filter_map(|effect| {
            let KernelEffect::SendFrame { frame, .. } = effect else {
                return None;
            };
            if frame.frame_type != FrameType::AuthorityEntry {
                return None;
            }
            frame
                .body
                .get("material")
                .and_then(|material| material.get("payload"))
                .and_then(|payload| payload.get("rng_audit").or_else(|| payload.get("rngAudit")))
                .and_then(Value::as_array)
                .map(|draws| draws.len() as u64)
        })
        .sum()
}

fn run_kernel_input(
    kernel: &mut GameKernel,
    input: KernelInput,
    checksum: &mut u64,
    counts: &mut Counts,
) -> TestResult<Vec<KernelEffect>> {
    counts.inputs = counts.inputs.saturating_add(1);
    let effects = kernel.step(input)?;
    assert_no_legacy_success_effects(&effects);
    counts.rng_draws = counts.rng_draws.saturating_add(count_rng_draws(&effects));
    absorb(checksum, &effects)?;
    absorb(checksum, &kernel.snapshot())?;
    absorb(checksum, &kernel.state_digest())?;
    absorb(checksum, &kernel.battle_ui_projection())?;
    absorb(checksum, &kernel.live_resources())?;
    Ok(effects)
}

fn raw_press_local(
    kernel: &mut GameKernel,
    checksum: &mut u64,
    counts: &mut Counts,
    code: PhysicalKey,
) -> TestResult<Vec<KernelEffect>> {
    let local_seat = seat(1);
    let mut effects = run_kernel_input(
        kernel,
        raw_input(local_seat, key_down(code.clone())),
        checksum,
        counts,
    )?;
    effects.extend(run_kernel_input(
        kernel,
        raw_input(local_seat, key_up(code)),
        checksum,
        counts,
    )?);
    Ok(effects)
}

fn settle_local_presentations(
    kernel: &mut GameKernel,
    checksum: &mut u64,
    counts: &mut Counts,
    effects: &[KernelEffect],
) -> TestResult<()> {
    let mut events = Vec::<BattlePresentationEventId>::new();
    for effect in effects {
        if let KernelEffect::PresentBattle { event, .. } = effect
            && !events.contains(&event.event_id)
        {
            events.push(event.event_id.clone());
        }
    }
    for event_id in events {
        run_kernel_input(
            kernel,
            KernelInput::BattlePresentationOutcome {
                endpoint: seat(1),
                event_id,
                outcome: PresentationSettlementOutcome::Settled,
            },
            checksum,
            counts,
        )?;
    }
    Ok(())
}

fn dispose_local_kernel(kernel: &mut GameKernel, checksum: &mut u64, reason: &str) -> TestResult {
    let effects = kernel.dispose(reason);
    assert_no_legacy_success_effects(&effects);
    absorb(checksum, &effects)?;
    absorb(checksum, &kernel.live_resources())?;
    assert!(kernel.is_disposed());
    assert_eq!(
        kernel.live_resources(),
        er_types::LiveResourceSnapshot::default()
    );
    Ok(())
}

fn assert_zero_pair_resources(snapshot: &er_sim::PairSnapshot) {
    assert_eq!(
        snapshot.host.live_resources,
        er_types::LiveResourceSnapshot::default()
    );
    assert_eq!(
        snapshot.guest.live_resources,
        er_types::LiveResourceSnapshot::default()
    );
    assert!(snapshot.clock_timers.is_empty());
    assert!(snapshot.network.queued_packet_ids.is_empty());
    assert!(snapshot.network.disconnected_endpoints.is_empty());
    assert!(snapshot.network.suspended_endpoints.is_empty());
    assert!(snapshot.network.disposed);
    assert!(snapshot.presenter.pending_event_ids.is_empty());
    assert!(snapshot.presenter.settled_event_ids.is_empty());
    assert!(snapshot.presenter.disposed);
    for endpoint in [&snapshot.host, &snapshot.guest] {
        assert!(endpoint.presenter.pending_event_ids.is_empty());
        assert!(endpoint.presenter.settled_event_ids.is_empty());
        assert!(endpoint.presenter.disposed);
    }
    assert!(snapshot.storage.keys.is_empty());
    assert!(snapshot.storage.pending_request_ids.is_empty());
    assert!(snapshot.storage.disposed);
}

fn pair_endpoint_for_seat(value: SeatId) -> TestResult<PairEndpoint> {
    if value == seat(1) {
        Ok(PairEndpoint::Host)
    } else if value == seat(2) {
        Ok(PairEndpoint::Guest)
    } else {
        Err(invalid(format!("pair effect used unknown seat {value:?}")))
    }
}

fn record_pair_presentations(
    step: &PairStep,
    pending: &mut Vec<(PairEndpoint, BattlePresentationEventId)>,
) -> TestResult {
    for effect in &step.generated_effects {
        if let KernelEffect::PresentBattle { endpoint, event } = effect {
            let key = (pair_endpoint_for_seat(*endpoint)?, event.event_id.clone());
            if !pending.contains(&key) {
                pending.push(key);
            }
        }
    }
    Ok(())
}

#[derive(Default)]
struct TurnEvidence {
    authority_turn_commits: u64,
    replica_turn_commits: u64,
}

fn record_pair_turn_evidence(step: &PairStep, evidence: &mut TurnEvidence) -> TestResult {
    for effect in &step.generated_effects {
        let KernelEffect::SendFrame { from, frame } = effect else {
            continue;
        };
        if frame.frame_type != FrameType::AuthorityEntry {
            continue;
        }
        let kind = frame
            .body
            .get("kind")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("authority-entry frame has no string kind"))?;
        if kind != "TURN_COMMIT" {
            continue;
        }
        if *from == seat(1) {
            evidence.authority_turn_commits = evidence.authority_turn_commits.saturating_add(1);
        } else if *from == seat(2) {
            evidence.replica_turn_commits = evidence.replica_turn_commits.saturating_add(1);
        } else {
            return Err(invalid(format!(
                "TURN_COMMIT frame used unknown sender seat {from:?}"
            )));
        }
    }
    Ok(())
}

fn state_game<'a>(state: &'a Value, label: &str) -> TestResult<&'a Value> {
    let mode = state
        .get("mode")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("{label}.mode is not a string")))?;
    if mode != "BATTLE" {
        return Err(invalid(format!("{label}.mode is {mode}, expected BATTLE")));
    }
    let game = state
        .get("game")
        .ok_or_else(|| invalid(format!("{label} has no canonical game state")))?;
    if !game.is_object() {
        return Err(invalid(format!(
            "{label} canonical game value is not an object"
        )));
    }
    Ok(game)
}

fn state_battle<'a>(state: &'a Value, label: &str) -> TestResult<&'a Value> {
    let battle = state_game(state, label)?
        .get("battle")
        .ok_or_else(|| invalid(format!("{label} canonical game has no battle state")))?;
    if !battle.is_object() {
        return Err(invalid(format!(
            "{label} canonical battle value is not an object"
        )));
    }
    Ok(battle)
}

fn state_control<'a>(state: &'a Value, label: &str) -> TestResult<&'a Value> {
    let control = state
        .get("control")
        .ok_or_else(|| invalid(format!("{label} has no battle control plan")))?;
    if !control.is_object() {
        return Err(invalid(format!("{label}.control is not an object")));
    }
    Ok(control)
}

fn state_battle_ui(state: &Value, label: &str) -> TestResult<BattleUiProjection> {
    let projection = state
        .get("ui")
        .ok_or_else(|| invalid(format!("{label} has no Battle UI projection")))?;
    Ok(serde_json::from_value(projection.clone())?)
}

fn state_terminal(state: &Value, label: &str) -> TestResult<TerminalState> {
    let terminal = state
        .get("terminal")
        .filter(|terminal| !terminal.is_null())
        .ok_or_else(|| invalid(format!("{label} has no terminal root")))?;
    Ok(serde_json::from_value(terminal.clone())?)
}

fn state_turn(state: &Value, label: &str) -> TestResult<u64> {
    state_battle(state, label)?
        .get("turn")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            invalid(format!(
                "{label} canonical battle turn is not a non-negative integer"
            ))
        })
}

fn assert_local_victory_terminal(kernel: &GameKernel, label: &str) -> TestResult {
    let snapshot = kernel.snapshot();
    let outcome = state_battle(&snapshot.state, label)?
        .get("outcome")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("{label} canonical battle outcome is not a string")))?;
    if outcome != "VICTORY" {
        return Err(invalid(format!(
            "{label} canonical battle outcome is {outcome}, expected VICTORY"
        )));
    }
    let projection = kernel
        .battle_ui_projection()
        .ok_or_else(|| invalid(format!("{label} has no Battle UI projection")))?;
    if projection.actionable {
        return Err(invalid(format!(
            "{label} remained actionable after terminal victory"
        )));
    }
    if !matches!(
        &projection.seat_control.control,
        BattleControl::Complete(BattleOutcome::Victory)
    ) {
        return Err(invalid(format!(
            "{label} control did not reach Complete(Victory)"
        )));
    }
    if !kernel.live_resources().battle_presentations.is_empty() {
        return Err(invalid(format!(
            "{label} retained unsettled battle presentations"
        )));
    }
    Ok(())
}

fn assert_frontier_at_turn(state: &Value, expected_turn: u64, label: &str) -> TestResult {
    let battle: BattleState = serde_json::from_value(state_battle(state, label)?.clone())?;
    battle.field.validate_for_format(&battle.format)?;
    battle.command_state.validate()?;
    if battle.turn.get().get() != expected_turn {
        return Err(invalid(format!(
            "{label} canonical battle turn is {}, expected {expected_turn}",
            battle.turn
        )));
    }
    if battle.outcome != BattleOutcome::Ongoing {
        return Err(invalid(format!(
            "{label} canonical battle outcome is {:?}, expected ONGOING",
            battle.outcome
        )));
    }

    let expected_slots = battle
        .field
        .slots
        .iter()
        .filter_map(|entry| entry.occupant.map(|_| entry.slot))
        .collect::<Vec<_>>();
    let expected_human_pending = expected_slots
        .iter()
        .filter(|slot| slot.side == BattleSide::Player)
        .count();
    let expected_scripted_enemy = expected_slots
        .iter()
        .filter(|slot| slot.side == BattleSide::Enemy)
        .count();
    if expected_human_pending == 0 || expected_scripted_enemy == 0 {
        return Err(invalid(format!(
            "{label} canonical battle has no complete occupied player/enemy frontier"
        )));
    }

    let expected_fragment = format!("/turn/{expected_turn}/");
    let mut actual_slots = Vec::with_capacity(battle.command_state.frontier.len());
    let mut human_pending = 0_usize;
    let mut scripted_enemy_admitted = 0_usize;
    for (index, entry) in battle.command_state.frontier.iter().enumerate() {
        let operation_id = entry.operation_id.as_str();
        if !operation_id.contains(expected_fragment.as_str()) {
            return Err(invalid(format!(
                "{label}.frontier[{index}] is {operation_id}, expected turn {expected_turn}"
            )));
        }
        actual_slots.push(entry.field_slot);
        match (entry.field_slot.side, entry.owner_seat, &entry.status) {
            (BattleSide::Player, Some(owner), CommandFrontierStatus::Pending) => {
                let expected_owner =
                    er_state::format::owner_seat_for(&battle.format, entry.field_slot)?
                        .ok_or_else(|| {
                            invalid(format!("{label}.frontier[{index}] has no human owner"))
                        })?;
                if owner != expected_owner {
                    return Err(invalid(format!(
                        "{label}.frontier[{index}] owner {owner} does not match {expected_owner}"
                    )));
                }
                let expected_operation = player_command_operation_id(
                    battle.battle_id,
                    battle.wave,
                    battle.turn,
                    entry.field_slot,
                    owner,
                )?;
                if entry.operation_id != expected_operation {
                    return Err(invalid(format!(
                        "{label}.frontier[{index}] human operation ID is not canonical"
                    )));
                }
                human_pending = human_pending.saturating_add(1);
            }
            (
                BattleSide::Enemy,
                None,
                CommandFrontierStatus::Admitted {
                    command:
                        AcceptedBattleCommand::ScriptedEnemy {
                            command: scripted, ..
                        },
                    source: CommandAdmissionSource::ScriptedEnemy,
                },
            ) => {
                let expected_operation = scripted_enemy_command_operation_id(
                    battle.battle_id,
                    battle.wave,
                    battle.turn,
                    entry.field_slot,
                    scripted.script_cursor,
                )?;
                if entry.operation_id != expected_operation {
                    return Err(invalid(format!(
                        "{label}.frontier[{index}] scripted operation ID is not canonical"
                    )));
                }
                scripted_enemy_admitted = scripted_enemy_admitted.saturating_add(1);
            }
            _ => {
                return Err(invalid(format!(
                    "{label}.frontier[{index}] has unsupported side/owner/status {:?}/{:?}/{:?}",
                    entry.field_slot.side, entry.owner_seat, entry.status
                )));
            }
        }
    }
    if actual_slots != expected_slots {
        return Err(invalid(format!(
            "{label} command frontier does not exactly cover occupied battle slots"
        )));
    }
    if human_pending != expected_human_pending {
        return Err(invalid(format!(
            "{label} has {human_pending} pending human entries, expected {expected_human_pending}"
        )));
    }
    if scripted_enemy_admitted != expected_scripted_enemy {
        return Err(invalid(format!(
            "{label} has {scripted_enemy_admitted} admitted scripted enemy entries, expected {expected_scripted_enemy}"
        )));
    }
    Ok(())
}

fn assert_supported_turn_transition(before: &Value, after: &Value, label: &str) -> TestResult {
    let before_turn = state_turn(before, &format!("{label} before"))?;
    let expected_turn = before_turn
        .checked_add(1)
        .ok_or_else(|| invalid(format!("{label} turn counter exhausted")))?;
    let after_turn = state_turn(after, &format!("{label} after"))?;
    if after_turn != expected_turn {
        return Err(invalid(format!(
            "{label} advanced from turn {before_turn} to {after_turn}, expected exactly one turn"
        )));
    }
    assert_frontier_at_turn(before, before_turn, &format!("{label} before"))?;
    assert_frontier_at_turn(after, after_turn, &format!("{label} after"))?;
    Ok(())
}

fn assert_pair_mechanical_convergence(snapshot: &er_sim::PairSnapshot) -> TestResult {
    let host_game = state_game(&snapshot.host.kernel.state, "two-client host state")?;
    let guest_game = state_game(&snapshot.guest.kernel.state, "two-client guest state")?;
    if host_game != guest_game {
        return Err(invalid(
            "two-client supported turn host/guest canonical game state does not converge",
        ));
    }
    Ok(())
}

fn assert_pair_control_convergence(snapshot: &er_sim::PairSnapshot) -> TestResult {
    let host_control = state_control(&snapshot.host.kernel.state, "two-client host state")?;
    let guest_control = state_control(&snapshot.guest.kernel.state, "two-client guest state")?;
    if host_control != guest_control {
        return Err(invalid(
            "two-client supported turn host/guest battle control plan does not converge",
        ));
    }
    let plan: BattleControlPlan = serde_json::from_value(host_control.clone())?;
    let host_ui = state_battle_ui(&snapshot.host.kernel.state, "two-client host state")?;
    let guest_ui = state_battle_ui(&snapshot.guest.kernel.state, "two-client guest state")?;
    if host_ui.schema_version != guest_ui.schema_version
        || host_ui.battle_id != guest_ui.battle_id
        || host_ui.wave != guest_ui.wave
        || host_ui.turn != guest_ui.turn
        || host_ui.actionable != guest_ui.actionable
    {
        return Err(invalid(
            "two-client host/guest Battle UI projection boundary does not converge",
        ));
    }
    for (label, projection, expected_seat) in [
        ("two-client host", &host_ui, seat(1)),
        ("two-client guest", &guest_ui, seat(2)),
    ] {
        if projection.battle_id != plan.battle_id
            || projection.wave != plan.wave
            || projection.turn != plan.turn
        {
            return Err(invalid(format!(
                "{label} Battle UI coordinates differ from the canonical control plan"
            )));
        }
        let expected_control = plan
            .seats
            .iter()
            .find(|entry| entry.seat == expected_seat)
            .ok_or_else(|| {
                invalid(format!(
                    "{label} canonical control plan omits seat {expected_seat}"
                ))
            })?;
        if &projection.seat_control != expected_control {
            return Err(invalid(format!(
                "{label} Battle UI does not exactly project seat {expected_seat} control"
            )));
        }
    }
    Ok(())
}

fn assert_terminal_control_plan(state: &Value, label: &str) -> TestResult {
    let plan: BattleControlPlan = serde_json::from_value(state_control(state, label)?.clone())?;
    plan.validate()?;

    let expected_seats = [seat(1), seat(2)];
    if plan.seats.len() != expected_seats.len() {
        return Err(invalid(format!(
            "{label} terminal control plan has {} seats, expected {}",
            plan.seats.len(),
            expected_seats.len()
        )));
    }
    for (entry, expected_seat) in plan.seats.iter().zip(expected_seats) {
        if entry.seat != expected_seat {
            return Err(invalid(format!(
                "{label} terminal control seat {} is not canonical seat {expected_seat}",
                entry.seat
            )));
        }
        if !matches!(
            &entry.control,
            BattleControl::Complete(BattleOutcome::Victory)
        ) {
            return Err(invalid(format!(
                "{label} seat {expected_seat} did not reach Complete(Victory)"
            )));
        }
    }
    Ok(())
}

fn assert_pair_victory_terminal(
    snapshot: &er_sim::PairSnapshot,
    evidence: &TurnEvidence,
) -> TestResult {
    let terminal_reason = snapshot
        .terminal_reason
        .as_deref()
        .filter(|reason| !reason.is_empty())
        .ok_or_else(|| invalid("complete co-op battle has no shared terminal reason"))?;

    assert_pair_mechanical_convergence(snapshot)?;
    assert_pair_control_convergence(snapshot)?;
    if evidence.authority_turn_commits != 1 || evidence.replica_turn_commits != 0 {
        return Err(invalid(format!(
            "complete co-op battle authority/replica TURN_COMMIT evidence was {}/{}; expected 1/0",
            evidence.authority_turn_commits, evidence.replica_turn_commits
        )));
    }

    let host_terminal = state_terminal(&snapshot.host.kernel.state, "complete co-op host")?;
    let guest_terminal = state_terminal(&snapshot.guest.kernel.state, "complete co-op guest")?;
    if host_terminal != guest_terminal || host_terminal.reason != terminal_reason {
        return Err(invalid(
            "complete co-op battle host/guest terminal roots do not equal the shared terminal",
        ));
    }

    for (label, endpoint, expected_seat) in [
        ("complete co-op host", &snapshot.host, seat(1)),
        ("complete co-op guest", &snapshot.guest, seat(2)),
    ] {
        let outcome = state_battle(&endpoint.kernel.state, label)?
            .get("outcome")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid(format!("{label} canonical battle outcome is not a string")))?;
        if outcome != "VICTORY" {
            return Err(invalid(format!(
                "{label} canonical battle outcome is {outcome}, expected VICTORY"
            )));
        }
        assert_terminal_control_plan(&endpoint.kernel.state, label)?;
        let projection = state_battle_ui(&endpoint.kernel.state, label)?;
        if projection.actionable
            || projection.seat_control.seat != expected_seat
            || !matches!(
                &projection.seat_control.control,
                BattleControl::Complete(BattleOutcome::Victory)
            )
        {
            return Err(invalid(format!(
                "{label} did not project non-actionable Complete(Victory) Battle UI for seat {expected_seat}"
            )));
        }
    }
    Ok(())
}

fn assert_two_client_supported_turn(
    before: &er_sim::PairSnapshot,
    after: &er_sim::PairSnapshot,
    evidence: &TurnEvidence,
) -> TestResult {
    assert_supported_turn_transition(
        &before.host.kernel.state,
        &after.host.kernel.state,
        "two-client host",
    )?;
    assert_supported_turn_transition(
        &before.guest.kernel.state,
        &after.guest.kernel.state,
        "two-client guest",
    )?;
    if state_turn(&after.host.kernel.state, "two-client host after")?
        != state_turn(&after.guest.kernel.state, "two-client guest after")?
    {
        return Err(invalid(
            "two-client supported turn host/guest turn counters differ after delivery",
        ));
    }
    if after.terminal_reason.is_some() {
        return Err(invalid(
            "two-client supported turn reached terminal state instead of a supported next control",
        ));
    }
    assert_pair_mechanical_convergence(after)?;
    assert_pair_control_convergence(after)?;
    if evidence.authority_turn_commits != 1 || evidence.replica_turn_commits != 0 {
        return Err(invalid(format!(
            "two-client supported turn authority/replica TURN_COMMIT evidence was {}/{}; expected 1/0",
            evidence.authority_turn_commits, evidence.replica_turn_commits
        )));
    }
    Ok(())
}

fn run_pair_operation(
    pair: &mut SimulatedPair,
    operation: PairOperation,
    checksum: &mut u64,
    counts: &mut Counts,
    pending: &mut Vec<(PairEndpoint, BattlePresentationEventId)>,
    evidence: &mut TurnEvidence,
) -> TestResult<PairStep> {
    counts.inputs = counts.inputs.saturating_add(1);
    let step = pair.apply(operation)?;
    assert_no_legacy_success_effects(&step.generated_effects);
    counts.rng_draws = counts
        .rng_draws
        .saturating_add(count_rng_draws(&step.generated_effects));
    absorb(checksum, &step)?;
    record_pair_presentations(&step, pending)?;
    record_pair_turn_evidence(&step, evidence)?;
    Ok(step)
}

fn raw_press_pair(
    pair: &mut SimulatedPair,
    endpoint: PairEndpoint,
    checksum: &mut u64,
    counts: &mut Counts,
    pending: &mut Vec<(PairEndpoint, BattlePresentationEventId)>,
    evidence: &mut TurnEvidence,
    code: PhysicalKey,
) -> TestResult {
    for event in [key_down(code.clone()), key_up(code)] {
        run_pair_operation(
            pair,
            PairOperation::RawInput { endpoint, event },
            checksum,
            counts,
            pending,
            evidence,
        )?;
    }
    Ok(())
}

fn settle_pair_presentations(
    pair: &mut SimulatedPair,
    checksum: &mut u64,
    counts: &mut Counts,
    pending: &mut Vec<(PairEndpoint, BattlePresentationEventId)>,
    evidence: &mut TurnEvidence,
) -> TestResult {
    let mut cursor = 0;
    while cursor < pending.len() {
        let (endpoint, event_id) = pending[cursor].clone();
        run_pair_operation(
            pair,
            PairOperation::BattlePresentationOutcome {
                endpoint,
                event_id,
                outcome: PresentationSettlementOutcome::Settled,
            },
            checksum,
            counts,
            pending,
            evidence,
        )?;
        cursor += 1;
    }
    Ok(())
}

fn report(
    scenario_id: &str,
    seed: &str,
    iterations: u64,
    steps: u64,
    checksum: u64,
    content_load_elapsed_ns: u64,
    execution_elapsed_ns: u64,
    counts: &Counts,
    details: Value,
) -> TestResult {
    assert_ne!(checksum, FNV_OFFSET, "benchmark checksum must include work");
    let marker = json!({
        "scenario_id": scenario_id,
        "seed": seed,
        "iterations": iterations,
        "schedules": 0,
        "steps": steps,
        "checksum": format!("{checksum:016x}"),
        "success": true,
        "content_load_elapsed_ns": content_load_elapsed_ns,
        "execution_elapsed_ns": execution_elapsed_ns,
        "counts": counts,
        "turns": counts.turns,
        "battles": counts.battles,
        "inputs": counts.inputs,
        "rng_draws": counts.rng_draws,
        "details": details,
    });
    let mut stdout = io::stdout().lock();
    writeln!(
        stdout,
        "M3_BENCHMARK_RESULT {}",
        serde_json::to_string(&marker)?
    )?;
    stdout.flush()?;
    Ok(())
}

#[test]
fn m3_raw_menu_events() -> TestResult {
    let content_started = Instant::now();
    let content = fixture_content_pack()?;
    let content_load_elapsed_ns = elapsed_ns(content_started);
    let fixture = fixture_value(PHYSICAL_HIT_FIXTURE)?;
    let execution_started = Instant::now();
    let mut checksum = FNV_OFFSET;
    let mut counts = Counts::default();
    let mut kernel = new_local_kernel(&fixture, &content, RAW_MENU_EVENTS)?;
    for index in 0..RAW_MENU_EVENTS {
        let cycle = index / 4;
        let code = if index % 4 < 2 {
            if cycle % 2 == 0 {
                PhysicalKey::Enter
            } else {
                PhysicalKey::Backspace
            }
        } else if cycle % 2 == 0 {
            PhysicalKey::ArrowDown
        } else {
            PhysicalKey::ArrowUp
        };
        let event = if index % 2 == 0 {
            key_down(code)
        } else {
            key_up(code)
        };
        run_kernel_input(
            &mut kernel,
            raw_input(seat(1), event),
            &mut checksum,
            &mut counts,
        )?;
    }
    dispose_local_kernel(&mut kernel, &mut checksum, "m3 raw menu events teardown")?;
    report(
        "raw-menu-events",
        BENCHMARK_SEED,
        0,
        RAW_MENU_EVENTS,
        checksum,
        content_load_elapsed_ns,
        elapsed_ns(execution_started),
        &counts,
        json!({
            "input_architecture": "raw physical keydown/keyUp events",
            "fixture": "physical-hit",
        }),
    )
}

#[test]
fn m3_simple_turn_resolutions() -> TestResult {
    let content_started = Instant::now();
    let content = fixture_content_pack()?;
    let content_load_elapsed_ns = elapsed_ns(content_started);
    let fixture = fixture_value(PHYSICAL_HIT_FIXTURE)?;
    let execution_started = Instant::now();
    let mut checksum = FNV_OFFSET;
    let mut counts = Counts::default();
    for iteration in 0..SIMPLE_TURN_RESOLUTIONS {
        let mut kernel = new_local_kernel(&fixture, &content, iteration)?;
        let before = kernel.snapshot().state;
        let mut effects =
            raw_press_local(&mut kernel, &mut checksum, &mut counts, PhysicalKey::Enter)?;
        effects.extend(raw_press_local(
            &mut kernel,
            &mut checksum,
            &mut counts,
            PhysicalKey::Enter,
        )?);
        settle_local_presentations(&mut kernel, &mut checksum, &mut counts, &effects)?;
        let after = kernel.snapshot().state;
        assert_supported_turn_transition(&before, &after, "simple local")?;
        counts.turns = counts.turns.saturating_add(1);
        counts.battles = counts.battles.saturating_add(1);
        dispose_local_kernel(&mut kernel, &mut checksum, "m3 simple turn teardown")?;
    }
    assert_eq!(counts.turns, SIMPLE_TURN_RESOLUTIONS);
    assert_eq!(counts.battles, SIMPLE_TURN_RESOLUTIONS);
    report(
        "simple-turn-resolutions",
        BENCHMARK_SEED,
        SIMPLE_TURN_RESOLUTIONS,
        0,
        checksum,
        content_load_elapsed_ns,
        elapsed_ns(execution_started),
        &counts,
        json!({
            "input_architecture": "raw physical keydown/keyUp plus presentation settlement",
            "fixture": "physical-hit",
        }),
    )
}

#[test]
fn m3_complete_short_battles() -> TestResult {
    let content_started = Instant::now();
    let content = fixture_content_pack()?;
    let content_load_elapsed_ns = elapsed_ns(content_started);
    let fixture = fixture_value(VICTORY_FIXTURE)?;
    let execution_started = Instant::now();
    let mut checksum = FNV_OFFSET;
    let mut counts = Counts::default();
    for iteration in 0..COMPLETE_SHORT_BATTLES {
        let mut kernel = new_local_kernel(&fixture, &content, iteration)?;
        let mut effects =
            raw_press_local(&mut kernel, &mut checksum, &mut counts, PhysicalKey::Enter)?;
        effects.extend(raw_press_local(
            &mut kernel,
            &mut checksum,
            &mut counts,
            PhysicalKey::Enter,
        )?);
        settle_local_presentations(&mut kernel, &mut checksum, &mut counts, &effects)?;
        assert_local_victory_terminal(&kernel, "m3 short battle")?;
        counts.turns = counts.turns.saturating_add(1);
        counts.battles = counts.battles.saturating_add(1);
        dispose_local_kernel(&mut kernel, &mut checksum, "m3 short battle teardown")?;
    }
    assert_eq!(counts.turns, COMPLETE_SHORT_BATTLES);
    assert_eq!(counts.battles, COMPLETE_SHORT_BATTLES);
    report(
        "complete-short-battles",
        BENCHMARK_SEED,
        COMPLETE_SHORT_BATTLES,
        0,
        checksum,
        content_load_elapsed_ns,
        elapsed_ns(execution_started),
        &counts,
        json!({
            "input_architecture": "raw physical keydown/keyUp plus presentation settlement",
            "fixture": "victory",
            "terminal": "victory",
        }),
    )
}

#[test]
fn m3_two_client_supported_turns() -> TestResult {
    let content_started = Instant::now();
    let content = fixture_content_pack()?;
    let content_load_elapsed_ns = elapsed_ns(content_started);
    let fixture = fixture_value(DOUBLES_FIXTURE)?;
    let execution_started = Instant::now();
    let mut checksum = FNV_OFFSET;
    let mut counts = Counts::default();
    for iteration in 0..TWO_CLIENT_SUPPORTED_TURNS {
        let mut pair = new_pair(&fixture, &content, iteration, false)?;
        let mut pending = Vec::new();
        let mut setup_evidence = TurnEvidence::default();
        run_pair_operation(
            &mut pair,
            PairOperation::Reconnect {
                endpoint: PairEndpoint::Host,
            },
            &mut checksum,
            &mut counts,
            &mut pending,
            &mut setup_evidence,
        )?;
        let before = pair.snapshot()?;
        let mut evidence = TurnEvidence::default();
        for endpoint in [PairEndpoint::Host, PairEndpoint::Guest] {
            for _ in 0..3 {
                raw_press_pair(
                    &mut pair,
                    endpoint,
                    &mut checksum,
                    &mut counts,
                    &mut pending,
                    &mut evidence,
                    PhysicalKey::Enter,
                )?;
            }
        }
        run_pair_operation(
            &mut pair,
            PairOperation::AdvanceTime { delta_ms: safe(2) },
            &mut checksum,
            &mut counts,
            &mut pending,
            &mut evidence,
        )?;
        settle_pair_presentations(
            &mut pair,
            &mut checksum,
            &mut counts,
            &mut pending,
            &mut evidence,
        )?;
        let snapshot = pair.snapshot()?;
        assert_two_client_supported_turn(&before, &snapshot, &evidence)?;
        counts.turns = counts.turns.saturating_add(1);
        counts.battles = counts.battles.saturating_add(1);
        let snapshot = pair.teardown("m3 supported turn teardown")?;
        absorb(&mut checksum, &snapshot)?;
    }
    assert_eq!(counts.turns, TWO_CLIENT_SUPPORTED_TURNS);
    assert_eq!(counts.battles, TWO_CLIENT_SUPPORTED_TURNS);
    report(
        "two-client-supported-turns",
        BENCHMARK_SEED,
        TWO_CLIENT_SUPPORTED_TURNS,
        0,
        checksum,
        content_load_elapsed_ns,
        elapsed_ns(execution_started),
        &counts,
        json!({
            "input_architecture": "two authority/replica endpoints driven by raw physical keydown/keyUp",
            "fixture": "doubles-single-target",
            "endpoints": ["host", "guest"],
        }),
    )
}

#[test]
fn m3_complete_supported_coop_battle() -> TestResult {
    let content_started = Instant::now();
    let content = fixture_content_pack()?;
    let content_load_elapsed_ns = elapsed_ns(content_started);
    let fixture = fixture_value(DOUBLES_FIXTURE)?;
    let mut pair = new_pair(&fixture, &content, 1, true)?;
    let mut setup_checksum = FNV_OFFSET;
    let mut setup_counts = Counts::default();
    let mut setup_pending = Vec::new();
    let mut setup_evidence = TurnEvidence::default();
    run_pair_operation(
        &mut pair,
        PairOperation::Reconnect {
            endpoint: PairEndpoint::Host,
        },
        &mut setup_checksum,
        &mut setup_counts,
        &mut setup_pending,
        &mut setup_evidence,
    )?;

    // Content/fixture decoding, pair construction, and the initial reconnect
    // are initialization and intentionally stay outside the elapsed interval.
    let execution_started = Instant::now();
    let mut checksum = FNV_OFFSET;
    let mut counts = Counts::default();
    let mut pending = Vec::new();
    let mut evidence = TurnEvidence::default();
    for endpoint in [PairEndpoint::Host, PairEndpoint::Guest] {
        for press in 0..3 {
            if endpoint == PairEndpoint::Guest && press == 2 {
                raw_press_pair(
                    &mut pair,
                    endpoint,
                    &mut checksum,
                    &mut counts,
                    &mut pending,
                    &mut evidence,
                    PhysicalKey::ArrowRight,
                )?;
            }
            raw_press_pair(
                &mut pair,
                endpoint,
                &mut checksum,
                &mut counts,
                &mut pending,
                &mut evidence,
                PhysicalKey::Enter,
            )?;
        }
    }
    run_pair_operation(
        &mut pair,
        PairOperation::AdvanceTime { delta_ms: safe(2) },
        &mut checksum,
        &mut counts,
        &mut pending,
        &mut evidence,
    )?;
    settle_pair_presentations(
        &mut pair,
        &mut checksum,
        &mut counts,
        &mut pending,
        &mut evidence,
    )?;
    let snapshot = pair.snapshot()?;
    assert_pair_victory_terminal(&snapshot, &evidence)?;
    absorb(&mut checksum, &snapshot)?;
    let teardown_snapshot = pair.teardown("m3 complete co-op battle teardown")?;
    assert_zero_pair_resources(&teardown_snapshot);
    absorb(&mut checksum, &teardown_snapshot)?;
    counts.turns = 1;
    counts.battles = 1;
    let execution_elapsed_ns = elapsed_ns(execution_started);
    report(
        "complete-supported-coop-battle",
        BENCHMARK_SEED,
        1,
        0,
        checksum,
        content_load_elapsed_ns,
        execution_elapsed_ns,
        &counts,
        json!({
            "input_architecture": "two authority/replica endpoints driven by raw physical keydown/keyUp",
            "fixture": "doubles-single-target with deterministic short-battle enemy boundary",
            "initialization_excluded": true,
            "terminal": "shared victory terminal with converged canonical/control/UI state",
        }),
    )
}
