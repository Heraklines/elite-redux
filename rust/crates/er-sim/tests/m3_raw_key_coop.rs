use std::collections::VecDeque;
use std::error::Error;
use std::sync::Arc;

use er_content::pack::{ContentPack, selected_content_pack};
use er_kernel::{
    BattleGameConfig, BattleProtocolConfig, BattleProtocolRoleConfig, BattleStartV1, GameKernel,
    KernelEffect, KernelInput,
};
use er_protocol::{
    AuthorityLogConfig, AuthorityReplicaConfig, BackoffPolicy, PeerBinding, ProposalLeaseConfig,
    RecoveryTransactionConfig,
};
use er_state::snapshot::GameState;
use er_types::battle_command::{
    BattleCommand, BattleTargetSelection, ScriptedEnemyBattleCommandV1, ScriptedEnemyPolicyV1,
    scripted_enemy_command_operation_id,
};
use er_types::battle_control::BattleControl;
use er_types::battle_ids::{
    BattlePresentationEventId, BattleSide, FieldSlot, MoveSlotIndex, PartyIndex, TurnIndex,
};
use er_types::battle_ui::PresentationSettlementOutcome;
use er_types::{
    AuthorityEntryBody, AuthorityEntryKind, ConnectionGeneration, FrameContext, FrameType,
    InputFocus, MembershipRevision, NetworkFrame, PhysicalKey, ProposalMessage, RawFrame,
    RawInputEvent, SafeU53, SeatId, SessionId, TimeClass, TransportState,
};
use serde_json::Value;

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const FORCED_REPLACEMENT_FIXTURE: &str =
    include_str!("../../../fixtures/m3/oracle/battle-cases/forced-replacement.json");
const CONTENT_PACK_FIXTURE: &str = include_str!("../../../fixtures/m3/oracle/content-pack-v1.json");
const LEGACY_ORACLE_CONTENT_DIGEST: &str =
    "3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";
const LEGACY_ORACLE_CONTENT_HASH: &str =
    "blake3-v1:3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";

fn invalid(message: impl Into<String>) -> Box<dyn Error> {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message.into()).into()
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
        Value::String(tag) if tag == "NONE" => serde_json::json!({"kind": "NONE"}),
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

fn adapt_legacy_content_condition_kind(value: &mut Value, path: &str) -> TestResult {
    let normalized = match value {
        Value::String(tag) if tag == "NONE" => serde_json::json!({"kind": "NONE"}),
        Value::String(tag) => {
            return Err(invalid(format!(
                "{path} must be the published legacy string \"NONE\", got {tag:?}"
            )));
        }
        Value::Object(kind) => {
            let tag = kind
                .get("kind")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid(format!("{path}.kind is not a string")))?;
            let valid_shape = match tag {
                "NONE" => kind.len() == 1,
                "UNSUPPORTED_ORACLE_CODE" => {
                    kind.len() == 2
                        && kind
                            .get("value")
                            .and_then(Value::as_u64)
                            .is_some_and(|value| u16::try_from(value).is_ok())
                }
                _ => false,
            };
            if !valid_shape {
                return Err(invalid(format!(
                    "{path} is not an exact WeatherKind/TerrainKind shape"
                )));
            }
            Value::Object(kind.clone())
        }
        other => {
            return Err(invalid(format!(
                "{path} must be a legacy string or an exact adjacent kind object, got {other}"
            )));
        }
    };
    *value = normalized;
    Ok(())
}

fn adapt_legacy_content_conditions(content: &mut Value) -> TestResult {
    let manifest = content
        .get_mut("capability_manifest")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| invalid("content_pack.capability_manifest is not an object"))?;
    let entries = manifest
        .get_mut("entries")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| invalid("content_pack.capability_manifest.entries is not an array"))?;

    for (index, entry) in entries.iter_mut().enumerate() {
        let subject = entry.get_mut("subject").ok_or_else(|| {
            invalid(format!(
                "content_pack.capability_manifest.entries[{index}].subject is missing"
            ))
        })?;
        let subject = subject.as_object_mut().ok_or_else(|| {
            invalid(format!(
                "content_pack.capability_manifest.entries[{index}].subject is not an object"
            ))
        })?;
        if subject.len() != 2 || !subject.contains_key("kind") || !subject.contains_key("value") {
            return Err(invalid(format!(
                "content_pack.capability_manifest.entries[{index}].subject must contain exactly kind and value"
            )));
        }
        let is_condition = matches!(
            subject.get("kind").and_then(Value::as_str),
            Some("WEATHER" | "TERRAIN")
        );
        if subject.get("kind").and_then(Value::as_str).is_none() {
            return Err(invalid(format!(
                "content_pack.capability_manifest.entries[{index}].subject.kind is not a string"
            )));
        }
        if is_condition {
            let value = subject.get_mut("value").ok_or_else(|| {
                invalid(format!(
                    "content_pack.capability_manifest.entries[{index}].subject.value is missing"
                ))
            })?;
            adapt_legacy_content_condition_kind(
                value,
                &format!("content_pack.capability_manifest.entries[{index}].subject.value"),
            )?;
        }
    }
    Ok(())
}

fn normalize_legacy_type_chart(content_pack: &mut Value, selected: &ContentPack) -> TestResult {
    let expected_entries = serde_json::to_value(&selected.type_chart.entries)?
        .as_array()
        .cloned()
        .ok_or_else(|| invalid("selected type chart entries are not an array"))?;
    let type_chart = content_pack
        .get_mut("type_chart")
        .ok_or_else(|| invalid("published content pack type_chart is missing"))?;
    let entries = type_chart
        .get_mut("entries")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| invalid("published type chart entries are not an array"))?;
    let legacy_entries = entries.clone();
    if legacy_entries.len() != expected_entries.len() {
        return Err(invalid(
            "published type chart entry count differs from selected content",
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
                "published type chart does not contain selected entry at index {index}"
            )));
        }
    }
    *entries = expected_entries;
    Ok(())
}

fn normalize_legacy_content_pack(artifact: &mut Value, selected: &ContentPack) -> TestResult {
    selected.validate()?;
    let (provenance_hash, provenance_oracle_sha) = {
        let provenance = artifact
            .get("provenance")
            .and_then(Value::as_object)
            .ok_or_else(|| invalid("published content artifact provenance is missing"))?;
        let hash = provenance
            .get("content_pack_hash")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("published content provenance hash is missing"))?;
        let oracle_sha = provenance
            .get("oracle_game_sha")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("published content provenance oracle SHA is missing"))?;
        (hash.to_owned(), oracle_sha.to_owned())
    };
    let (pack_hash, pack_oracle_sha) = {
        let pack = artifact
            .get("content_pack")
            .and_then(Value::as_object)
            .ok_or_else(|| invalid("published content artifact content_pack is missing"))?;
        let hash = pack
            .get("hash")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("published content pack hash is missing"))?;
        let oracle_sha = pack
            .get("oracle_game_sha")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("published content pack oracle SHA is missing"))?;
        (hash.to_owned(), oracle_sha.to_owned())
    };
    if pack_hash != LEGACY_ORACLE_CONTENT_HASH
        || provenance_hash != LEGACY_ORACLE_CONTENT_DIGEST
        || pack_oracle_sha != selected.oracle_game_sha
        || provenance_oracle_sha != selected.oracle_game_sha
    {
        return Err(invalid(
            "published content artifact is not the exact supported legacy identity",
        ));
    }

    let pack = artifact
        .get_mut("content_pack")
        .ok_or_else(|| invalid("published content artifact content_pack is missing"))?;
    normalize_legacy_type_chart(pack, selected)?;
    adapt_legacy_content_conditions(pack)?;
    pack.as_object_mut()
        .ok_or_else(|| invalid("published content pack is not an object"))?
        .insert("hash".to_owned(), Value::String(selected.hash.to_string()));
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

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).unwrap_or(SafeU53::ZERO)
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn generation(value: u64) -> ConnectionGeneration {
    ConnectionGeneration::new(safe(value))
}

fn context(
    sender_seat_id: SeatId,
    authority_seat_id: SeatId,
    connection_generation: ConnectionGeneration,
) -> TestResult<FrameContext> {
    Ok(FrameContext {
        session_id: SessionId::new("m3c10-raw-coop-session")?,
        run_id: er_types::RunId::new("m3c10-raw-coop-run")?,
        session_epoch: safe(1),
        seat_map_id: "m3c10-raw-coop-seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id,
        authority_seat_id,
        connection_generation,
    })
}

fn authority_protocol(
    host: SeatId,
    guest: SeatId,
    connection_generation: ConnectionGeneration,
) -> TestResult<BattleProtocolConfig> {
    Ok(BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Authority {
            log: AuthorityLogConfig {
                local_context: context(host, host, connection_generation)?,
                peer_bindings: vec![PeerBinding {
                    seat_id: guest,
                    connection_generation,
                }],
                owner_id: "m3c10-raw-coop:authority".to_owned(),
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
    host: SeatId,
    guest: SeatId,
    connection_generation: ConnectionGeneration,
) -> TestResult<BattleProtocolConfig> {
    let guest_context = context(guest, host, connection_generation)?;
    Ok(BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Replica {
            replica: AuthorityReplicaConfig {
                receipt_context: guest_context.clone(),
                authority_seat_id: host,
                authority_connection_generation: connection_generation,
            },
            proposal_leases: ProposalLeaseConfig {
                owner_prefix: "m3c10-raw-coop:proposal:".to_owned(),
                retry_initial_ms: safe(1),
                retry_maximum_ms: safe(64),
                absolute_ceiling_ms: safe(1_200_000),
            },
            recovery: RecoveryTransactionConfig {
                local_context: guest_context,
                request_timeout_ms: safe(300_000),
                control_timeout_ms: safe(30_000),
                pacing_ms: safe(16),
                timer_owner_id: "m3c10-raw-coop:recovery".to_owned(),
            },
        },
    })
}

fn forced_doubles_config() -> TestResult<BattleGameConfig> {
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
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

#[derive(Clone, Debug)]
struct AuthorityEntryEvidence {
    sender: Endpoint,
    body: AuthorityEntryBody,
}

// `er_sim::SimulatedPair` is the legacy KernelConfig harness. This Battle-mode
// pump performs no semantic work: it only queues emitted transport effects and
// feeds their public proposal or serialized raw-frame forms to the peer kernel.
struct BattlePair {
    host: GameKernel,
    guest: GameKernel,
    connection_generation: ConnectionGeneration,
    packets: VecDeque<Packet>,
    effects: Vec<(Endpoint, KernelEffect)>,
    authority_entries: Vec<AuthorityEntryEvidence>,
    presentations: Vec<(Endpoint, BattlePresentationEventId)>,
    settled_presentations: Vec<(Endpoint, BattlePresentationEventId)>,
}

impl BattlePair {
    fn new(
        config: BattleGameConfig,
        connection_generation: ConnectionGeneration,
    ) -> TestResult<Self> {
        let host = Endpoint::Host.seat();
        let guest = Endpoint::Guest.seat();
        let mut host_config = config.clone();
        host_config.local_seat = host;
        let mut guest_config = config;
        guest_config.local_seat = guest;

        let selected = selected_content_pack()?;
        let mut content_wire: Value = serde_json::from_str(CONTENT_PACK_FIXTURE)?;
        normalize_legacy_content_pack(&mut content_wire, &selected)?;
        let content_value = content_wire
            .get("content_pack")
            .cloned()
            .ok_or_else(|| invalid("content-pack fixture has no content_pack payload"))?;
        let content: ContentPack = serde_json::from_value(content_value)?;
        if content != selected {
            return Err(invalid(
                "published legacy content pack did not normalize to the current selected content",
            ));
        }
        let content = Arc::new(content);
        let host_kernel = GameKernel::new_battle(
            host_config,
            authority_protocol(host, guest, connection_generation)?,
            Arc::clone(&content),
        )?;
        let guest_kernel = GameKernel::new_battle(
            guest_config,
            replica_protocol(host, guest, connection_generation)?,
            Arc::clone(&content),
        )?;

        Ok(Self {
            host: host_kernel,
            guest: guest_kernel,
            connection_generation,
            packets: VecDeque::new(),
            effects: Vec::new(),
            authority_entries: Vec::new(),
            presentations: Vec::new(),
            settled_presentations: Vec::new(),
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

    fn step(&mut self, endpoint: Endpoint, input: KernelInput) -> TestResult<Vec<KernelEffect>> {
        let effects = {
            let kernel = self.kernel_mut(endpoint);
            kernel.step(input)?
        };
        for effect in &effects {
            self.observe_effect(endpoint, effect)?;
            self.effects.push((endpoint, effect.clone()));
        }
        Ok(effects)
    }

    fn observe_effect(&mut self, source: Endpoint, effect: &KernelEffect) -> TestResult {
        match effect {
            KernelEffect::SendFrame { from, frame } => {
                if *from != source.seat() || frame.context.sender_seat_id != *from {
                    return Err(invalid(
                        "SendFrame identity did not match its emitting endpoint",
                    ));
                }
                if frame.frame_type == FrameType::AuthorityEntry {
                    let body: AuthorityEntryBody = serde_json::from_value(frame.body.clone())?;
                    self.authority_entries.push(AuthorityEntryEvidence {
                        sender: source,
                        body,
                    });
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
                let to = match proposal.to {
                    value if value == Endpoint::Host.seat() => Endpoint::Host,
                    value if value == Endpoint::Guest.seat() => Endpoint::Guest,
                    _ => return Err(invalid("SendProposal targeted an unknown seat")),
                };
                self.packets.push_back(Packet::Proposal {
                    to,
                    proposal: proposal.clone(),
                });
            }
            KernelEffect::BattleUiChanged { endpoint, .. }
            | KernelEffect::PresentBattle { endpoint, .. } => {
                if *endpoint != source.seat() {
                    return Err(invalid(
                        "battle presentation/UI effect named the wrong seat",
                    ));
                }
                if let KernelEffect::PresentBattle { event, .. } = effect {
                    self.presentations.push((source, event.event_id.clone()));
                }
            }
            KernelEffect::ScheduleTimer { .. }
            | KernelEffect::CancelTimer { .. }
            | KernelEffect::UiChanged { .. }
            | KernelEffect::UiIntent { .. }
            | KernelEffect::Present { .. }
            | KernelEffect::Persist { .. }
            | KernelEffect::ApplyAuthorityMaterial { .. }
            | KernelEffect::ProjectAuthorityControl { .. }
            | KernelEffect::EnterSharedTerminal { .. } => {}
        }
        Ok(())
    }

    fn connect(&mut self) -> TestResult {
        self.step(
            Endpoint::Host,
            KernelInput::TransportChanged {
                endpoint: Endpoint::Guest.seat(),
                state: TransportState::Connected,
                generation: self.connection_generation,
            },
        )?;
        self.step(
            Endpoint::Guest,
            KernelInput::TransportChanged {
                endpoint: Endpoint::Host.seat(),
                state: TransportState::Connected,
                generation: self.connection_generation,
            },
        )?;
        self.deliver_all()
    }

    fn raw_press(&mut self, endpoint: Endpoint, code: PhysicalKey) -> TestResult {
        self.step(
            endpoint,
            KernelInput::RawInput {
                seat: endpoint.seat(),
                event: RawInputEvent::KeyDown {
                    code: code.clone(),
                    printable: false,
                    browser_repeat: false,
                    focus: InputFocus::Game,
                },
            },
        )?;
        self.step(
            endpoint,
            KernelInput::RawInput {
                seat: endpoint.seat(),
                event: RawInputEvent::KeyUp { code },
            },
        )?;
        Ok(())
    }

    fn deliver_packet_at(&mut self, index: usize) -> TestResult {
        let packet = self
            .packets
            .remove(index)
            .ok_or_else(|| invalid(format!("no packet at index {index}")))?;
        match packet {
            Packet::Frame { to, raw, .. } => {
                self.step(
                    to,
                    KernelInput::RawNetworkFrame {
                        endpoint: to.seat(),
                        frame: raw,
                    },
                )?;
            }
            Packet::Proposal { to, proposal } => {
                self.step(
                    to,
                    KernelInput::ProposalReceived {
                        endpoint: to.seat(),
                        proposal,
                    },
                )?;
            }
        }
        Ok(())
    }

    fn deliver_all(&mut self) -> TestResult {
        for _ in 0..256 {
            if self.packets.is_empty() {
                return Ok(());
            }
            self.deliver_packet_at(0)?;
        }
        Err(invalid("deterministic pair pump exceeded its packet bound"))
    }

    fn packet_at(&self, index: usize) -> TestResult<Packet> {
        self.packets
            .get(index)
            .cloned()
            .ok_or_else(|| invalid(format!("no packet at index {index}")))
    }

    fn queue_front(&mut self, packet: Packet) {
        self.packets.push_front(packet);
    }

    fn first_proposal_index(&self) -> Option<usize> {
        self.packets
            .iter()
            .position(|packet| matches!(packet, Packet::Proposal { .. }))
    }

    fn first_authority_frame_index(&self) -> Option<usize> {
        self.packets.iter().position(|packet| {
            matches!(
                packet,
                Packet::Frame { frame, .. } if frame.frame_type == FrameType::AuthorityEntry
            )
        })
    }

    fn mechanical_control(&self, endpoint: Endpoint) -> TestResult<(Value, Value)> {
        let state = self.kernel(endpoint).snapshot().state;
        let game = state
            .get("game")
            .cloned()
            .ok_or_else(|| invalid("Battle snapshot has no game state"))?;
        let control = state
            .get("control")
            .cloned()
            .ok_or_else(|| invalid("Battle snapshot has no control plan"))?;
        Ok((game, control))
    }

    fn authority_entry_count(&self, sender: Endpoint, kind: AuthorityEntryKind) -> usize {
        self.authority_entries
            .iter()
            .filter(|entry| entry.sender == sender && entry.body.kind == kind)
            .count()
    }

    fn authority_entry(&self, kind: AuthorityEntryKind) -> TestResult<AuthorityEntryBody> {
        self.authority_entries
            .iter()
            .find(|entry| entry.sender == Endpoint::Host && entry.body.kind == kind)
            .map(|entry| entry.body.clone())
            .ok_or_else(|| invalid(format!("missing authority {:?} entry", kind)))
    }

    fn settle_all_presentations(&mut self) -> TestResult<usize> {
        let pending = self
            .presentations
            .iter()
            .filter(|event| !self.settled_presentations.contains(event))
            .cloned()
            .collect::<Vec<_>>();
        for (endpoint, event_id) in &pending {
            let before = self.mechanical_control(*endpoint)?;
            self.step(
                *endpoint,
                KernelInput::BattlePresentationOutcome {
                    endpoint: endpoint.seat(),
                    event_id: event_id.clone(),
                    outcome: PresentationSettlementOutcome::Settled,
                },
            )?;
            let after = self.mechanical_control(*endpoint)?;
            assert_eq!(
                before, after,
                "presentation settlement changed mechanics at {endpoint:?}"
            );
            self.settled_presentations
                .push((*endpoint, event_id.clone()));
        }
        self.deliver_all()?;
        Ok(pending.len())
    }

    fn assert_no_forbidden_effects(&self) {
        let forbidden = self.effects.iter().find(|(_, effect)| {
            matches!(
                effect,
                KernelEffect::UiChanged { .. }
                    | KernelEffect::UiIntent { .. }
                    | KernelEffect::Present { .. }
                    | KernelEffect::Persist { .. }
                    | KernelEffect::ApplyAuthorityMaterial { .. }
                    | KernelEffect::ProjectAuthorityControl { .. }
                    | KernelEffect::EnterSharedTerminal { .. }
            )
        });
        assert!(
            forbidden.is_none(),
            "forbidden legacy/cosmetic effect was emitted: {forbidden:?}"
        );
    }
}

fn assert_material_matches_snapshots(
    pair: &BattlePair,
    kind: AuthorityEntryKind,
    entry: &AuthorityEntryBody,
) -> TestResult {
    assert_eq!(entry.kind, kind);
    let after_state = entry
        .material
        .payload
        .get("after_state")
        .cloned()
        .ok_or_else(|| invalid("typed battle material has no after_state"))?;
    let next_control = entry
        .material
        .payload
        .get("next_control")
        .cloned()
        .ok_or_else(|| invalid("typed battle material has no next_control"))?;

    for endpoint in [Endpoint::Host, Endpoint::Guest] {
        let (game, control) = pair.mechanical_control(endpoint)?;
        assert_eq!(after_state, game, "material/game diverged at {endpoint:?}");
        assert_eq!(
            next_control, control,
            "material/control diverged at {endpoint:?}"
        );
    }
    Ok(())
}

#[test]
fn raw_key_forced_doubles_authority_replica_campaign() -> TestResult {
    let config = forced_doubles_config()?;
    let mut pair = BattlePair::new(config, generation(1))?;
    pair.connect()?;

    let initial = pair.mechanical_control(Endpoint::Host)?;
    assert_eq!(initial, pair.mechanical_control(Endpoint::Guest)?);

    for endpoint in [Endpoint::Host, Endpoint::Guest] {
        for _ in 0..3 {
            pair.raw_press(endpoint, PhysicalKey::Enter)?;
        }
    }

    let proposal_index = pair
        .first_proposal_index()
        .ok_or_else(|| invalid("guest raw keys did not emit a proposal"))?;
    let proposal_packet = pair.packet_at(proposal_index)?;
    assert_eq!(pair.authority_entries.len(), 0);
    let delayed_guest_state = pair.mechanical_control(Endpoint::Guest)?;
    pair.deliver_packet_at(proposal_index)?;
    pair.queue_front(proposal_packet);
    pair.deliver_packet_at(0)?;
    assert_eq!(
        pair.authority_entry_count(Endpoint::Host, AuthorityEntryKind::TurnCommit),
        1
    );
    assert_eq!(
        pair.authority_entry_count(Endpoint::Guest, AuthorityEntryKind::TurnCommit),
        0
    );
    assert_eq!(
        delayed_guest_state,
        pair.mechanical_control(Endpoint::Guest)?
    );
    assert_ne!(
        pair.mechanical_control(Endpoint::Host)?,
        pair.mechanical_control(Endpoint::Guest)?,
        "guest advanced before the TURN frame was delivered"
    );

    let turn_frame_index = pair
        .first_authority_frame_index()
        .ok_or_else(|| invalid("authority did not emit a TURN authority frame"))?;
    let turn_frame = pair.packet_at(turn_frame_index)?;
    pair.deliver_packet_at(turn_frame_index)?;
    let guest_after_turn = pair.mechanical_control(Endpoint::Guest)?;
    pair.queue_front(turn_frame);
    pair.deliver_packet_at(0)?;
    assert_eq!(
        guest_after_turn,
        pair.mechanical_control(Endpoint::Guest)?,
        "duplicate TURN frame changed the guest mechanics"
    );
    let turn_entry = pair.authority_entry(AuthorityEntryKind::TurnCommit)?;
    assert_material_matches_snapshots(&pair, AuthorityEntryKind::TurnCommit, &turn_entry)?;
    let turn_presentations = pair.settle_all_presentations()?;
    assert!(
        turn_presentations > 0,
        "TURN did not emit a presentation plan"
    );
    assert_eq!(
        guest_after_turn,
        pair.mechanical_control(Endpoint::Guest)?,
        "presentation settlement changed guest mechanics"
    );

    let projection = pair
        .host
        .battle_ui_projection()
        .ok_or_else(|| invalid("host Battle kernel has no UI projection"))?;
    assert!(projection.actionable);
    assert!(matches!(
        &projection.seat_control.control,
        BattleControl::ReplacementSelect(_)
    ));

    let replacement_control = match &projection.seat_control.control {
        BattleControl::ReplacementSelect(control) => control,
        _ => unreachable!("replacement projection was checked above"),
    };
    let selected_option = replacement_control
        .menu
        .option(replacement_control.menu.selected_option_id.clone())
        .ok_or_else(|| invalid("replacement projection selected option is absent"))?;
    assert!(
        selected_option.visibility.is_visible() && selected_option.enabled,
        "replacement projection did not select an enabled visible party option"
    );

    // The runtime has already normalized the typed replacement graph to its
    // first enabled visible party option.  Two raw Enter presses then follow
    // ReplacementSelect -> PartyOptionSelect -> Send Out; walking Down would
    // intentionally land on disabled active/cancel nodes.
    for _ in 0..2 {
        pair.raw_press(Endpoint::Host, PhysicalKey::Enter)?;
    }

    let replacement_frame_index = pair
        .first_authority_frame_index()
        .ok_or_else(|| invalid("authority did not emit a REPLACEMENT authority frame"))?;
    let replacement_frame = pair.packet_at(replacement_frame_index)?;
    assert_eq!(
        guest_after_turn,
        pair.mechanical_control(Endpoint::Guest)?,
        "delayed REPLACEMENT frame changed the guest mechanics"
    );
    assert_ne!(
        pair.mechanical_control(Endpoint::Host)?,
        pair.mechanical_control(Endpoint::Guest)?,
        "guest advanced before the REPLACEMENT frame was delivered"
    );
    pair.deliver_packet_at(replacement_frame_index)?;
    let guest_after_replacement = pair.mechanical_control(Endpoint::Guest)?;
    pair.queue_front(replacement_frame);
    pair.deliver_packet_at(0)?;
    assert_eq!(
        guest_after_replacement,
        pair.mechanical_control(Endpoint::Guest)?,
        "duplicate REPLACEMENT frame changed the guest mechanics"
    );
    let replacement_entry = pair.authority_entry(AuthorityEntryKind::ReplacementCommit)?;
    assert_material_matches_snapshots(
        &pair,
        AuthorityEntryKind::ReplacementCommit,
        &replacement_entry,
    )?;
    let replacement_presentations = pair.settle_all_presentations()?;
    assert!(
        replacement_presentations > 0,
        "REPLACEMENT did not emit a presentation plan"
    );

    assert_eq!(
        pair.authority_entry_count(Endpoint::Host, AuthorityEntryKind::TurnCommit),
        1
    );
    assert_eq!(
        pair.authority_entry_count(Endpoint::Host, AuthorityEntryKind::ReplacementCommit),
        1
    );
    assert_eq!(
        pair.authority_entry_count(Endpoint::Guest, AuthorityEntryKind::TurnCommit),
        0
    );
    assert_eq!(
        pair.authority_entry_count(Endpoint::Guest, AuthorityEntryKind::ReplacementCommit),
        0
    );
    assert_eq!(
        pair.authority_entries.len(),
        2,
        "the authority emitted more than one TURN and one REPLACEMENT resolution"
    );
    assert!(
        pair.authority_entries
            .iter()
            .all(|entry| entry.sender == Endpoint::Host),
        "the replica emitted an authority entry"
    );
    assert_eq!(
        pair.mechanical_control(Endpoint::Host)?,
        pair.mechanical_control(Endpoint::Guest)?
    );
    pair.assert_no_forbidden_effects();
    Ok(())
}
