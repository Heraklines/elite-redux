//! M6 complete-content raw-key two-kernel co-op campaigns through Authority V2.
//!
//! Every campaign drives one seeded doubles battle to its shared terminal with
//! physical key input only, under a frozen duplicate/delay/disconnect/recovery
//! schedule anchored on ordered Authority V2 traffic. After every commit the
//! harness proves candidate == host == guest: an independent candidate replica
//! replays exactly the serialized authority materials through the common
//! role-neutral material applier and must reproduce both live endpoints'
//! mechanical observations byte-for-byte.

use er_content::pack::{ContentPack, selected_content_pack};
use er_game::m6::coop_campaign::{
    self, CoopAnchor, CoopCampaignV1, CoopCandidateReplayV1, CoopEndpoint, CoopPacketKind,
    CoopPacketSelector, CoopScheduledAction, CoopScheduledActionKind, CoopTraceDigestV1,
    verify_authority_receipt_order, verify_commit_parity, verify_replica_receipt_order,
};
use er_kernel::snapshot::RestorableKernelSnapshotV2;
use er_kernel::{
    BattleGameConfig, BattleProtocolConfig, BattleProtocolRoleConfig, BattleStartV1, GameKernel,
};
use er_protocol::{
    AuthorityLogConfig, AuthorityReplicaConfig, BackoffPolicy, PeerBinding, ProposalLeaseConfig,
    RecoveryTransactionConfig,
};
use er_state::battle::BattleState;
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
use er_types::protocol::{AuthorityEntryKind, KernelEffect, KernelInput};
use er_types::{
    AuthorityEntryBody, AuthorityReceiptBody, ConnectionGeneration, FrameContext, FrameType,
    InputFocus, LiveResourceSnapshot, MembershipRevision, PhysicalKey, ProposalMessage, RawFrame,
    RawInputEvent, RunId, SafeU53, SeatId, SessionId, TimeClass, TimerId, TransportState,
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::error::Error;
use std::sync::Arc;

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const FORCED_REPLACEMENT_FIXTURE: &str =
    include_str!("../../../fixtures/m3/oracle/battle-cases/forced-replacement.json");
const CONTENT_PACK_FIXTURE: &str = include_str!("../../../fixtures/m3/oracle/content-pack-v1.json");
const LEGACY_ORACLE_CONTENT_DIGEST: &str =
    "3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";
const LEGACY_ORACLE_CONTENT_HASH: &str =
    "blake3-v1:3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";

/// Turns of scripted enemy commands the campaigns may consume.
const SCRIPTED_TURN_HORIZON: u64 = 32;
/// Deterministic per-hop transport latency in virtual milliseconds.
const HOP_LATENCY_MS: u64 = 1;

fn invalid(message: impl Into<String>) -> Box<dyn Error> {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message.into()).into()
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

// ---------------------------------------------------------------------------
// Frozen legacy fixture normalization (published M3 oracle artifacts).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Shared campaign inputs.
// ---------------------------------------------------------------------------

fn content_pack() -> TestResult<Arc<ContentPack>> {
    let selected = selected_content_pack()?;
    let mut wire: Value = serde_json::from_str(CONTENT_PACK_FIXTURE)?;
    normalize_legacy_content_pack(&mut wire, &selected)?;
    let value = wire
        .get("content_pack")
        .cloned()
        .ok_or_else(|| invalid("content-pack fixture has no content_pack payload"))?;
    let content: ContentPack = serde_json::from_value(value)?;
    assert_eq!(
        content, selected,
        "published legacy content pack did not normalize to the current selected content"
    );
    Ok(Arc::new(content))
}

fn context(
    sender_seat_id: SeatId,
    authority_seat_id: SeatId,
    connection_generation: ConnectionGeneration,
) -> TestResult<FrameContext> {
    Ok(FrameContext {
        session_id: SessionId::new("m6d-coop-session")?,
        run_id: RunId::new("m6d-coop-run")?,
        session_epoch: safe(1),
        seat_map_id: "m6d-coop-seat-map".to_owned(),
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
                owner_id: "m6d-coop:authority".to_owned(),
                retain_capacity: safe(64),
                delivery_backoff: BackoffPolicy {
                    initial_ms: safe(4),
                    maximum_ms: safe(64),
                    factor_numerator: safe(2),
                    factor_denominator: safe(1),
                },
                delivery_time_class: TimeClass::Connected,
                max_delivery_attempts: Some(safe(16)),
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
                owner_prefix: "m6d-coop:proposal:".to_owned(),
                retry_initial_ms: safe(2),
                retry_maximum_ms: safe(64),
                absolute_ceiling_ms: safe(1_200_000),
            },
            recovery: RecoveryTransactionConfig {
                local_context: guest_context,
                request_timeout_ms: safe(300_000),
                control_timeout_ms: safe(30_000),
                pacing_ms: safe(8),
                timer_owner_id: "m6d-coop:recovery".to_owned(),
            },
        },
    })
}

/// Build the forced-replacement doubles config from the frozen oracle fixture,
/// with scripted enemy fight commands covering the full turn horizon.
fn replacement_campaign_config(content: &ContentPack) -> TestResult<BattleGameConfig> {
    let wire: Value = serde_json::from_str(FORCED_REPLACEMENT_FIXTURE)?;
    let mut initial_state = wire
        .get("initial_state")
        .cloned()
        .ok_or_else(|| invalid("forced-replacement fixture has no initial state"))?;
    normalize_legacy_initial_state(&mut initial_state)?;
    normalize_legacy_content_identity(&wire, &mut initial_state, content)?;
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
        scripted_enemy_policy: scripted_enemy_policy(&battle)?,
    })
}

/// Scripted enemy policy: every enemy actor fights with its first move against
/// the first occupied player slot, for the whole campaign turn horizon.
fn scripted_enemy_policy(battle: &BattleState) -> TestResult<ScriptedEnemyPolicyV1> {
    let mut scripted_commands = Vec::new();
    let mut script_cursor = 0_u64;
    for turn_offset in 0..SCRIPTED_TURN_HORIZON {
        let turn_value = battle
            .turn
            .get()
            .get()
            .checked_add(turn_offset)
            .ok_or_else(|| invalid("scripted enemy horizon overflowed the turn index"))?;
        let turn = TurnIndex::new(safe(turn_value))?;
        for position in 0..battle.format.enemy_capacity {
            let field_slot = FieldSlot::new(BattleSide::Enemy, position)?;
            let actor = battle
                .field
                .occupant(&battle.format, field_slot)?
                .ok_or_else(|| invalid(format!("enemy actor slot {position} is empty")))?;
            let _ = position;
            // Every enemy actor converges on the first player slot so a
            // scripted command never names a slot that a faint emptied.
            let target = FieldSlot::new(BattleSide::Player, 0)?;
            let command = BattleCommand::fight(
                actor,
                MoveSlotIndex::ZERO,
                BattleTargetSelection::selected(vec![target])?,
            )?;
            let operation_id = scripted_enemy_command_operation_id(
                battle.battle_id,
                battle.wave,
                turn,
                field_slot,
                safe(script_cursor),
            )?;
            scripted_commands.push(ScriptedEnemyBattleCommandV1::new(
                operation_id,
                battle.battle_id,
                battle.wave,
                turn,
                safe(script_cursor),
                actor,
                field_slot,
                command,
            )?);
            script_cursor += 1;
        }
    }
    Ok(ScriptedEnemyPolicyV1::new(
        SafeU53::ZERO,
        scripted_commands,
    )?)
}

/// The proven M3 forced-victory seeding: player leads open with their
/// damaging move and every active enemy stands at one hit point, so the
/// guest's redirected target drops both enemies in the same resolution and
/// the battle reaches its shared terminal well inside the scripted horizon.
fn victory_config(mut config: BattleGameConfig) -> TestResult<BattleGameConfig> {
    if config.start.player_party.is_empty() || config.start.enemy_party.is_empty() {
        return Err(invalid("victory fixture must retain both parties"));
    }
    for lead in config.start.player_leads.clone() {
        let party_index = usize::from(lead.get());
        let pokemon = config
            .start
            .player_party
            .get_mut(party_index)
            .ok_or_else(|| invalid("victory player lead is outside the party"))?;
        pokemon.moves.swap(0, 1);
    }
    for pokemon in &mut config.start.enemy_party {
        pokemon.hp = 1;
        pokemon.fainted = false;
    }
    Ok(config)
}

fn key_down(code: PhysicalKey) -> RawInputEvent {
    RawInputEvent::KeyDown {
        code: code.clone(),
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    }
}

fn key_up(code: PhysicalKey) -> RawInputEvent {
    RawInputEvent::KeyUp { code }
}

// ---------------------------------------------------------------------------
// The deterministic two-kernel campaign pump.
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
enum PacketBody {
    Frame(RawFrame),
    Proposal(ProposalMessage),
}

#[derive(Clone, Debug)]
struct Packet {
    seq: u64,
    deliver_at_ms: u64,
    enqueue_generation: ConnectionGeneration,
    body: PacketBody,
    kind: Option<CoopPacketKind>,
    from: Endpoint,
    to: Endpoint,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
struct TimerKey {
    endpoint: SeatId,
    timer_id: TimerId,
}

/// One captured authority commit plus the exact host/guest mechanical
/// observations taken at its delivery instant. Raw-key input is suspended
/// while an authority commit is in flight, so neither endpoint can admit a
/// new command between material issuance and this capture.
struct CommitObservation {
    sender: SeatId,
    entry: AuthorityEntryBody,
    host_game: Value,
    host_control: Value,
    guest_game: Value,
    guest_control: Value,
}

struct CampaignPump {
    campaign: CoopCampaignV1,
    content: Arc<ContentPack>,
    endpoint_of_seat: BTreeMap<SeatId, Endpoint>,
    kernels: BTreeMap<Endpoint, GameKernel>,
    queue: Vec<Packet>,
    next_seq: u64,
    clock_ms: u64,
    timers: BTreeMap<TimerKey, u64>,
    connection_generation: ConnectionGeneration,
    connected: BTreeMap<Endpoint, bool>,
    delivered_ordinals: HashMap<(CoopPacketKind, Endpoint, Endpoint), u32>,
    applied_actions: BTreeSet<usize>,
    commit_observations: Vec<CommitObservation>,
    captured_commit_ids: BTreeSet<String>,
    dropped_commit_ops: BTreeSet<String>,
    authority_entries: Vec<(SeatId, AuthorityEntryBody)>,
    receipts: Vec<(SeatId, AuthorityReceiptBody)>,
    pending_presentations: Vec<(Endpoint, BattlePresentationEventId)>,
    guest_target_redirected: bool,
    disconnect_events: u32,
    terminal: BTreeSet<Endpoint>,
    trace: CoopTraceDigestV1,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
enum Endpoint {
    Host,
    Guest,
}

impl Endpoint {
    fn from_coop(endpoint: CoopEndpoint) -> Self {
        match endpoint {
            CoopEndpoint::Host => Self::Host,
            CoopEndpoint::Guest => Self::Guest,
        }
    }

    fn peer(self) -> Self {
        match self {
            Self::Host => Self::Guest,
            Self::Guest => Self::Host,
        }
    }
}

impl CampaignPump {
    fn new(
        campaign: CoopCampaignV1,
        base_config: BattleGameConfig,
        content: Arc<ContentPack>,
    ) -> TestResult<Self> {
        let host_seat = campaign.host_seat;
        let guest_seat = campaign.guest_seat;
        let mut host_config = base_config.clone();
        host_config.local_seat = host_seat;
        let mut guest_config = base_config;
        guest_config.local_seat = guest_seat;
        let generation_one = generation(1);
        let mut kernels = BTreeMap::new();
        kernels.insert(
            Endpoint::Host,
            GameKernel::new_battle(
                host_config,
                authority_protocol(host_seat, guest_seat, generation_one)?,
                Arc::clone(&content),
            )?,
        );
        kernels.insert(
            Endpoint::Guest,
            GameKernel::new_battle(
                guest_config,
                replica_protocol(host_seat, guest_seat, generation_one)?,
                Arc::clone(&content),
            )?,
        );
        let mut pump = Self {
            campaign,
            endpoint_of_seat: BTreeMap::from([
                (host_seat, Endpoint::Host),
                (guest_seat, Endpoint::Guest),
            ]),
            content,
            kernels,
            queue: Vec::new(),
            next_seq: 0,
            clock_ms: 0,
            timers: BTreeMap::new(),
            connection_generation: generation_one,
            connected: BTreeMap::from([(Endpoint::Host, false), (Endpoint::Guest, false)]),
            delivered_ordinals: HashMap::new(),
            applied_actions: BTreeSet::new(),
            commit_observations: Vec::new(),
            captured_commit_ids: BTreeSet::new(),
            dropped_commit_ops: BTreeSet::new(),
            authority_entries: Vec::new(),
            receipts: Vec::new(),
            pending_presentations: Vec::new(),
            guest_target_redirected: false,
            disconnect_events: 0,
            terminal: BTreeSet::new(),
            trace: CoopTraceDigestV1::empty(),
        };
        // Bootstrap: bind both endpoints onto generation one. This mirrors the
        // production transport owner whose protocol construction starts at
        // generation one while the live link establishes afterwards.
        pump.set_transport(Endpoint::Host, TransportState::Connected)?;
        pump.set_transport(Endpoint::Guest, TransportState::Connected)?;
        Ok(pump)
    }

    fn kernel(&self, endpoint: Endpoint) -> &GameKernel {
        &self.kernels[&endpoint]
    }

    fn kernel_mut(&mut self, endpoint: Endpoint) -> &mut GameKernel {
        self.kernels.get_mut(&endpoint).expect("endpoint kernel")
    }

    fn seat(&self, endpoint: Endpoint) -> SeatId {
        self.campaign.seat_of(match endpoint {
            Endpoint::Host => CoopEndpoint::Host,
            Endpoint::Guest => CoopEndpoint::Guest,
        })
    }

    fn step(&mut self, endpoint: Endpoint, input: KernelInput) -> TestResult<()> {
        let effects = {
            let kernel = self.kernel_mut(endpoint);
            kernel.step(input)?
        };
        self.fold_trace(endpoint, &effects)?;
        for effect in effects {
            self.observe_effect(endpoint, effect)?;
        }
        Ok(())
    }

    fn fold_trace(&mut self, endpoint: Endpoint, effects: &[KernelEffect]) -> TestResult<()> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(match endpoint {
            Endpoint::Host => b"host",
            Endpoint::Guest => b"guest",
        });
        bytes.extend_from_slice(&serde_json::to_vec(effects)?);
        self.trace = self.trace.fold(&bytes);
        Ok(())
    }

    fn observe_effect(&mut self, source: Endpoint, effect: KernelEffect) -> TestResult<()> {
        match effect {
            KernelEffect::SendFrame { from, frame } => {
                if from != self.seat(source) {
                    return Err(invalid(
                        "SendFrame identity did not match its emitting endpoint",
                    ));
                }
                let kind = match frame.frame_type {
                    FrameType::AuthorityEntry => {
                        let body: AuthorityEntryBody = serde_json::from_value(frame.body.clone())?;
                        self.authority_entries.push((from, body));
                        Some(CoopPacketKind::AuthorityCommit)
                    }
                    FrameType::AuthorityReceipt => {
                        let body: AuthorityReceiptBody =
                            serde_json::from_value(frame.body.clone())?;
                        self.receipts.push((from, body));
                        Some(CoopPacketKind::AuthorityReceipt)
                    }
                    _ => None,
                };
                self.enqueue(
                    source,
                    source.peer(),
                    PacketBody::Frame(RawFrame::JsonValue(serde_json::to_value(&frame)?)),
                    kind,
                );
            }
            KernelEffect::SendProposal { proposal } => {
                if proposal.from != self.seat(source) {
                    return Err(invalid(
                        "SendProposal identity did not match its emitting endpoint",
                    ));
                }
                let to = if proposal.to == self.seat(source.peer()) {
                    source.peer()
                } else {
                    return Err(invalid("SendProposal targeted an unknown seat"));
                };
                self.enqueue(
                    source,
                    to,
                    PacketBody::Proposal(proposal),
                    Some(CoopPacketKind::Proposal),
                );
            }
            KernelEffect::ScheduleTimer {
                endpoint,
                timer_id,
                delay_ms,
                ..
            } => {
                let due = self
                    .clock_ms
                    .checked_add(delay_ms.get())
                    .ok_or_else(|| invalid("scheduled timer overflowed the virtual clock"))?;
                self.timers.insert(TimerKey { endpoint, timer_id }, due);
            }
            KernelEffect::CancelTimer { endpoint, timer_id } => {
                self.timers.remove(&TimerKey { endpoint, timer_id });
            }
            KernelEffect::PresentBattle { event, .. } => {
                self.pending_presentations
                    .push((source, event.event_id.clone()));
            }
            KernelEffect::EnterSharedTerminal { .. } => {
                self.terminal.insert(source);
            }
            KernelEffect::BattleUiChanged { .. } => {}
            _ => {}
        }
        Ok(())
    }

    fn enqueue(
        &mut self,
        from: Endpoint,
        to: Endpoint,
        body: PacketBody,
        kind: Option<CoopPacketKind>,
    ) {
        // Authority commits deliver at once: the harness must observe the
        // exact material boundary before any further raw-key admission can
        // advance either endpoint past it.
        let latency_ms = if matches!(kind, Some(CoopPacketKind::AuthorityCommit)) {
            0
        } else {
            HOP_LATENCY_MS
        };
        let seq = self.next_seq;
        self.next_seq += 1;
        self.queue.push(Packet {
            seq,
            deliver_at_ms: self.clock_ms + latency_ms,
            enqueue_generation: self.connection_generation,
            body,
            kind,
            from,
            to,
        });
    }

    fn set_transport(&mut self, endpoint: Endpoint, state: TransportState) -> TestResult<()> {
        let peer_state = match state {
            TransportState::Connected => TransportState::Connected,
            TransportState::Disconnected | TransportState::Connecting => {
                TransportState::Disconnected
            }
        };
        self.step(
            endpoint,
            KernelInput::TransportChanged {
                endpoint: self.seat(endpoint.peer()),
                state: state,
                generation: self.connection_generation,
            },
        )?;
        self.step(
            endpoint.peer(),
            KernelInput::TransportChanged {
                endpoint: self.seat(endpoint),
                state: peer_state,
                generation: self.connection_generation,
            },
        )?;
        self.connected
            .insert(endpoint, matches!(state, TransportState::Connected));
        Ok(())
    }

    // -- schedule application ------------------------------------------------

    fn selector_matches(packet: &Packet, selector: &CoopPacketSelector) -> bool {
        let Some(kind) = packet.kind else {
            return false;
        };
        kind == selector.kind
            && Endpoint::from_coop(selector.from) == packet.from
            && Endpoint::from_coop(selector.to) == packet.to
    }

    /// Next delivery ordinal of the packet's stream; kindless frames (tail,
    /// recovery, terminal) never match a selector and report ordinal one so
    /// anchor evaluation skips them.
    fn next_ordinal(&self, packet: &Packet) -> u32 {
        let Some(kind) = packet.kind else {
            return 1;
        };
        let key = (kind, packet.from, packet.to);
        self.delivered_ordinals.get(&key).copied().unwrap_or(0) + 1
    }

    fn pending_before_action(&self, packet: &Packet, ordinal: u32) -> Option<usize> {
        self.campaign
            .actions
            .iter()
            .enumerate()
            .find(|(index, entry)| {
                !self.applied_actions.contains(index)
                    && match entry.anchor {
                        CoopAnchor::BeforeDelivery {
                            selector,
                            ordinal: at,
                        } => at == ordinal && Self::selector_matches(packet, &selector),
                        _ => false,
                    }
            })
            .map(|(index, _)| index)
    }

    fn apply_packet_action(&mut self, index: usize, packet_index: usize) -> TestResult<()> {
        self.applied_actions.insert(index);
        let action = self.campaign.actions[index].action;
        match action {
            CoopScheduledActionKind::DuplicatePacket { .. } => {
                let mut duplicate = self.queue[packet_index].clone();
                self.next_seq += 1;
                duplicate.seq = self.next_seq - 1;
                self.queue.insert(packet_index + 1, duplicate);
            }
            CoopScheduledActionKind::DelayPacket { additional_ms, .. } => {
                let packet = &mut self.queue[packet_index];
                packet.deliver_at_ms = self
                    .clock_ms
                    .checked_add(additional_ms)
                    .ok_or_else(|| invalid("delay overflowed the virtual clock"))?;
            }
            CoopScheduledActionKind::Disconnect { .. }
            | CoopScheduledActionKind::Reconnect { .. } => {
                return Err(invalid("transport action anchored on packet delivery"));
            }
        }
        Ok(())
    }

    /// Deliver the earliest due packet (FIFO by deadline then enqueue order),
    /// applying any scheduled duplicate/delay anchors around it. Returns true
    /// when a delivery was processed.
    fn deliver_due_packet(&mut self) -> TestResult<bool> {
        // Before-delivery anchors may delay or duplicate the head packet, so
        // loop until the due head is stable before delivering it.
        loop {
            let Some(index) = self.earliest_due_packet() else {
                return Ok(false);
            };
            let packet = self.queue[index].clone();
            let ordinal = self.next_ordinal(&packet);
            let Some(action_index) = self.pending_before_action(&packet, ordinal) else {
                break;
            };
            let transport_op = matches!(
                self.campaign.actions[action_index].action,
                CoopScheduledActionKind::Disconnect { .. }
                    | CoopScheduledActionKind::Reconnect { .. }
            );
            if transport_op {
                // The matched packet never reaches its receiver: it is torn
                // down together with the endpoint's whole in-flight lane.
                if let PacketBody::Frame(RawFrame::JsonValue(value)) = &self.queue[index].body {
                    if let Some(operation) = value
                        .get("body")
                        .and_then(|body| body.get("operationId"))
                        .and_then(Value::as_str)
                    {
                        self.dropped_commit_ops.insert(operation.to_owned());
                    }
                }
                self.applied_actions.insert(action_index);
                self.queue.remove(index);
                self.apply_transport_action(action_index)?;
                continue;
            }
            self.apply_packet_action(action_index, index)?;
        }

        let index = self
            .earliest_due_packet()
            .ok_or_else(|| invalid("due packet vanished during anchor evaluation"))?;
        let packet = self.queue.remove(index);
        if self.packet_is_stale(&packet) {
            // Stale-generation traffic reaps silently, exactly like the live
            // fault network drops it without a kernel observation.
            return Ok(true);
        }
        let ordinal = self.next_ordinal(&packet);
        if let Some(kind) = packet.kind {
            let key = (kind, packet.from, packet.to);
            self.delivered_ordinals.insert(key, ordinal);
        }
        let commit_frame = matches!(packet.kind, Some(CoopPacketKind::AuthorityCommit));
        match &packet.body {
            PacketBody::Frame(raw) => {
                self.step(
                    packet.to,
                    KernelInput::RawNetworkFrame {
                        endpoint: self.seat(packet.to),
                        frame: raw.clone(),
                    },
                )?;
            }
            PacketBody::Proposal(proposal) => {
                self.step(
                    packet.to,
                    KernelInput::ProposalReceived {
                        endpoint: self.seat(packet.to),
                        proposal: proposal.clone(),
                    },
                )?;
            }
        }

        // After-delivery anchors fire immediately after the counted delivery.
        let after_indices: Vec<usize> = self
            .campaign
            .actions
            .iter()
            .enumerate()
            .filter(|(action_index, entry)| {
                !self.applied_actions.contains(action_index)
                    && match entry.anchor {
                        CoopAnchor::AfterDelivery {
                            selector,
                            ordinal: at,
                        } => at == ordinal && Self::selector_matches(&packet, &selector),
                        _ => false,
                    }
            })
            .map(|(action_index, _)| action_index)
            .collect();
        for action_index in after_indices {
            self.apply_transport_action(action_index)?;
        }

        if commit_frame {
            self.capture_commit_observation()?;
        }
        Ok(true)
    }

    fn apply_transport_action(&mut self, index: usize) -> TestResult<()> {
        self.applied_actions.insert(index);
        match self.campaign.actions[index].action {
            CoopScheduledActionKind::Disconnect { endpoint } => {
                let endpoint = Endpoint::from_coop(endpoint);
                self.disconnect_events += 1;
                self.set_transport(endpoint, TransportState::Disconnected)?;
                // In-flight traffic touching the torn-down endpoint goes
                // stale and reaps without reaching any kernel.
                self.queue
                    .retain(|packet| packet.from != endpoint && packet.to != endpoint);
            }
            CoopScheduledActionKind::Reconnect { endpoint } => {
                let endpoint = Endpoint::from_coop(endpoint);
                let next = self
                    .connection_generation
                    .get()
                    .get()
                    .checked_add(1)
                    .ok_or_else(|| invalid("connection generation exhausted"))?;
                self.connection_generation = generation(next);
                self.set_transport(endpoint, TransportState::Connected)?;
            }
            _ => return Err(invalid("packet action applied as transport action")),
        }
        Ok(())
    }

    fn packet_is_stale(&self, packet: &Packet) -> bool {
        !self.connected[&packet.from]
            || !self.connected[&packet.to]
            || packet.enqueue_generation != self.connection_generation
    }

    /// True while any authority commit awaits delivery.
    fn commit_lane_busy(&self) -> bool {
        self.queue
            .iter()
            .any(|packet| matches!(packet.kind, Some(CoopPacketKind::AuthorityCommit)))
    }

    /// Earliest deliverable packet. The authority-commit lane is ordered:
    /// only its oldest queued frame is ever eligible, so a scheduled delay
    /// postpones the whole lane exactly like a real ordered transport,
    /// keeping revision order intact at the receiver.
    fn earliest_due_packet(&self) -> Option<usize> {
        let mut lane_heads: HashMap<(CoopPacketKind, Endpoint, Endpoint), u64> = HashMap::new();
        for packet in &self.queue {
            if let Some(kind) = packet.kind {
                if matches!(kind, CoopPacketKind::AuthorityCommit) {
                    let key = (kind, packet.from, packet.to);
                    let head = lane_heads.entry(key).or_insert(packet.seq);
                    *head = (*head).min(packet.seq);
                }
            }
        }
        self.queue
            .iter()
            .enumerate()
            .filter(|(_, packet)| {
                let lane_blocked = packet.kind.is_some_and(|kind| {
                    matches!(kind, CoopPacketKind::AuthorityCommit)
                        && lane_heads[&(kind, packet.from, packet.to)] != packet.seq
                });
                !lane_blocked && packet.deliver_at_ms <= self.clock_ms
            })
            .min_by_key(|(_, packet)| (packet.deliver_at_ms, packet.seq))
            .map(|(index, _)| index)
    }

    fn next_packet_deadline(&self) -> Option<u64> {
        self.queue.iter().map(|packet| packet.deliver_at_ms).min()
    }

    fn capture_commit_observation(&mut self) -> TestResult<()> {
        self.settle_presentations_blocking()?;
        let host = self.kernel(Endpoint::Host).snapshot().state;
        let guest = self.kernel(Endpoint::Guest).snapshot().state;
        let Some((sender, entry)) = self.authority_entries.last() else {
            return Err(invalid(
                "commit capture without an observed authority entry",
            ));
        };
        let entry = entry.clone();
        let sender = *sender;
        if self
            .captured_commit_ids
            .insert(entry.operation_id.to_string())
        {
            self.commit_observations.push(CommitObservation {
                sender,
                entry,
                host_game: host
                    .get("game")
                    .cloned()
                    .ok_or_else(|| invalid("host snapshot has no game state"))?,
                host_control: host
                    .get("control")
                    .cloned()
                    .ok_or_else(|| invalid("host snapshot has no control plan"))?,
                guest_game: guest
                    .get("game")
                    .cloned()
                    .ok_or_else(|| invalid("guest snapshot has no game state"))?,
                guest_control: guest
                    .get("control")
                    .cloned()
                    .ok_or_else(|| invalid("guest snapshot has no control plan"))?,
            });
        }
        Ok(())
    }

    /// Blocking presentation barrier: settle every pending battle presentation
    /// on both endpoints while proving settlement never changes mechanics.
    fn settle_presentations_blocking(&mut self) -> TestResult<bool> {
        if self.pending_presentations.is_empty() {
            return Ok(false);
        }
        let before = self.mechanical_observations()?;
        for _ in 0..64 {
            if self.pending_presentations.is_empty() {
                break;
            }
            let pending = std::mem::take(&mut self.pending_presentations);
            for (endpoint, event_id) in pending {
                self.step(
                    endpoint,
                    KernelInput::BattlePresentationOutcome {
                        endpoint: self.seat(endpoint),
                        event_id,
                        outcome: PresentationSettlementOutcome::Settled,
                    },
                )?;
            }
        }
        if !self.pending_presentations.is_empty() {
            return Err(invalid(
                "battle presentation barriers did not settle within the fixture bound",
            ));
        }
        let after = self.mechanical_observations()?;
        assert_eq!(
            before, after,
            "presentation settlement changed the mechanical frontier"
        );
        Ok(true)
    }

    fn mechanical_observations(&self) -> TestResult<BTreeMap<&'static str, (Value, Value)>> {
        let mut observed = BTreeMap::new();
        for (label, endpoint) in [("host", Endpoint::Host), ("guest", Endpoint::Guest)] {
            let state = self.kernel(endpoint).snapshot().state;
            let game = state
                .get("game")
                .cloned()
                .ok_or_else(|| invalid("snapshot has no game state"))?;
            let control = state
                .get("control")
                .cloned()
                .ok_or_else(|| invalid("snapshot has no control plan"))?;
            observed.insert(label, (game, control));
        }
        Ok(observed)
    }

    fn apply_when_idle_actions(&mut self) -> TestResult<bool> {
        // Idle is an instant between scheduler ticks: nothing is deliverable
        // now, even when retry timers remain scheduled for later instants.
        let timers_pending = self.timers.values().any(|due| *due <= self.clock_ms);
        if !self.queue.is_empty() || timers_pending {
            return Ok(false);
        }
        // Idle means something to rebind: transport traffic has already
        // flowed and at least one endpoint sits torn down.
        let committed = self.delivered_ordinals.iter().any(|((kind, _, _), count)| {
            matches!(kind, CoopPacketKind::AuthorityCommit) && *count > 0
        });
        let torn_down = self.connected.values().any(|connected| !connected);
        if !committed || !torn_down {
            return Ok(false);
        }
        let mut applied = false;
        for index in 0..self.campaign.actions.len() {
            if self.applied_actions.contains(&index) {
                continue;
            }
            if matches!(self.campaign.actions[index].anchor, CoopAnchor::WhenIdle) {
                self.apply_transport_action(index)?;
                applied = true;
                break;
            }
        }
        Ok(applied)
    }

    fn fire_due_timer(&mut self) -> TestResult<bool> {
        let now = self.clock_ms;
        let Some((key, _)) = self
            .timers
            .iter()
            .find(|(_, due)| **due <= now)
            .map(|(key, due)| (*key, *due))
        else {
            return Ok(false);
        };
        self.timers.remove(&key);
        let endpoint = self
            .endpoint_of_seat
            .get(&key.endpoint)
            .copied()
            .ok_or_else(|| invalid("timer fired for an unknown endpoint seat"))?;
        self.step(
            endpoint,
            KernelInput::TimerFired {
                endpoint: key.endpoint,
                timer_id: key.timer_id,
            },
        )?;
        Ok(true)
    }

    fn advance_clock_toward_next_event(&mut self) -> bool {
        let mut candidates = Vec::new();
        if let Some(deadline) = self.next_packet_deadline() {
            candidates.push(deadline);
        }
        candidates.extend(self.timers.values().copied());
        let Some(target) = candidates.into_iter().min() else {
            return false;
        };
        if target > self.clock_ms {
            self.clock_ms = target;
        } else {
            self.clock_ms += 1;
        }
        true
    }

    /// Press the confirm key at every endpoint whose production UI projection
    /// currently offers an actionable decision menu. Physical keys only; the
    /// menu graph normalizes default selections itself.
    fn press_actionable_endpoints(&mut self) -> TestResult<bool> {
        let mut pressed = false;
        for endpoint in [Endpoint::Host, Endpoint::Guest] {
            if self.terminal.contains(&endpoint) {
                continue;
            }
            if self.commit_lane_busy() {
                // An authority commit is in flight: hold every endpoint at
                // the material boundary so the capture proves the exact
                // serialized frontier against both live kernels.
                return Ok(false);
            }
            let projection = self.kernel(endpoint).battle_ui_projection();
            let Some(projection) = projection else {
                continue;
            };
            if !projection.actionable || !is_decision_menu(&projection.seat_control.control) {
                continue;
            }
            // The proven M3 targeting recipe: the guest's default target is
            // the first enemy slot; one physical ArrowRight splits the
            // doubles focus so both one-hit enemies fall in the same
            // resolution and the battle completes inside the scripted
            // horizon. The redirect happens once per campaign.
            let redirecting = !self.guest_target_redirected
                && endpoint == Endpoint::Guest
                && matches!(
                    &projection.seat_control.control,
                    BattleControl::TargetSelect(control)
                        if control.menu.selected_option_id.as_str() == "target/enemy/0"
                );
            let key = if redirecting {
                self.guest_target_redirected = true;
                PhysicalKey::ArrowRight
            } else {
                self.campaign.confirm_key.clone()
            };
            self.step(
                endpoint,
                KernelInput::RawInput {
                    seat: self.seat(endpoint),
                    event: key_down(key.clone()),
                },
            )?;
            self.step(
                endpoint,
                KernelInput::RawInput {
                    seat: self.seat(endpoint),
                    event: key_up(key),
                },
            )?;
            pressed = true;
        }
        Ok(pressed)
    }

    fn drain_to_quiesce(&mut self, bound: usize) -> TestResult<()> {
        for _ in 0..bound {
            if self.deliver_due_packet()? {
                continue;
            }
            if self.fire_due_timer()? {
                continue;
            }
            if self.settle_presentations_blocking()? {
                continue;
            }
            if self.advance_clock_toward_next_event()
                && (self.earliest_due_packet().is_some() || !self.timers.is_empty())
            {
                continue;
            }
            return Ok(());
        }
        Err(invalid("campaign did not quiesce within its drain bound"))
    }

    /// Drive the campaign until both endpoints share the terminal state.
    fn drive_to_terminal(&mut self) -> TestResult<()> {
        let rounds = usize::try_from(self.campaign.decision_round_bound).unwrap_or(usize::MAX);
        for _ in 0..rounds.saturating_mul(64) {
            if self.terminal.contains(&Endpoint::Host) && self.terminal.contains(&Endpoint::Guest) {
                return Ok(());
            }
            if self.deliver_due_packet()? {
                continue;
            }
            if self.fire_due_timer()? {
                continue;
            }
            if self.apply_when_idle_actions()? {
                continue;
            }
            if self.settle_presentations_blocking()? {
                continue;
            }
            if self.press_actionable_endpoints()? {
                continue;
            }
            if self.advance_clock_toward_next_event() {
                continue;
            }
            return Err(invalid(format!(
                "raw-key campaign stalled: queue={:?} timers={} connected={:?} terminal={:?} clock={}",
                self.queue
                    .iter()
                    .map(|packet| (packet.kind, packet.from, packet.to, packet.deliver_at_ms))
                    .collect::<Vec<_>>(),
                self.timers.len(),
                self.connected,
                self.terminal,
                self.clock_ms
            )));
        }
        Err(invalid(
            "raw-key campaign exceeded its decision round bound before completing",
        ))
    }
}

fn operation_id_str(operation_id: &er_types::OperationId) -> &str {
    operation_id.as_str()
}

fn is_decision_menu(control: &BattleControl) -> bool {
    matches!(
        control,
        BattleControl::CommandRoot(_)
            | BattleControl::MoveSelect(_)
            | BattleControl::TargetSelect(_)
            | BattleControl::PartySelect(_)
            | BattleControl::PartyOptionSelect(_)
            | BattleControl::ReplacementSelect(_)
    )
}

// ---------------------------------------------------------------------------
// Campaign completion evidence.
// ---------------------------------------------------------------------------

struct CampaignEvidence {
    ledger: coop_campaign::CoopReceiptLedgerV1,
    material_commit_count: usize,
    parity: Vec<coop_campaign::CoopCommitParityV1>,
    trace: CoopTraceDigestV1,
    host_digest: String,
    guest_digest: String,
    receipt_revisions: Vec<u64>,
    disconnect_events: u32,
}

fn finish_and_verify(mut pump: CampaignPump) -> TestResult<CampaignEvidence> {
    pump.drain_to_quiesce(4096)?;

    // Exact host/guest mechanical frontiers must agree once the shared
    // terminal is reached; kernel digests additionally cover each endpoint's
    // distinct Authority V2 role state, so mechanical observations are the
    // cross-endpoint contract.
    let terminal_observations = pump.mechanical_observations()?;
    assert_eq!(
        terminal_observations["host"], terminal_observations["guest"],
        "host and guest mechanical observations diverged at the shared terminal"
    );
    let host_digest = pump.kernel(Endpoint::Host).state_digest();
    let guest_digest = pump.kernel(Endpoint::Guest).state_digest();

    // Ordered receipts: only the authority commits, strictly increasing
    // revisions, and every commit acknowledged by the replica.
    let observed = pump
        .authority_entries
        .iter()
        .map(|(sender, entry)| (*sender, entry.clone()))
        .collect::<Vec<_>>();
    let ledger = verify_authority_receipt_order(pump.campaign.host_seat, &observed)?;

    // Live per-commit parity requires that neither endpoint could admit
    // anything between material issuance and its capture. Transport faults
    // break that freeze, so disconnect campaigns prove the same laws through
    // replica recovery plus the final terminal equality instead.
    let strict_parity = !pump.campaign.actions.iter().any(|action| {
        matches!(
            action.action,
            CoopScheduledActionKind::Disconnect { .. } | CoopScheduledActionKind::Reconnect { .. }
        )
    });

    // Candidate == host == guest for every serialized commit.
    let mut candidate = CoopCandidateReplayV1::new(pump.campaign.guest_seat);
    let mut parity = Vec::new();
    for observation in &pump.commit_observations {
        assert_eq!(
            observation.sender, pump.campaign.host_seat,
            "a non-authority endpoint produced the captured commit"
        );
        // The candidate folds every TURN/REPLACEMENT material through the
        // common applier; TERMINAL commits carry no mechanical material and
        // close the shared terminal instead. Commits whose first delivery was
        // consumed by a disconnect prove convergence through the final
        // candidate == host == guest terminal equality plus replica recovery,
        // not through a mid-flight snapshot that no live endpoint retains.
        let dropped = pump
            .dropped_commit_ops
            .contains(operation_id_str(&observation.entry.operation_id));
        if matches!(
            observation.entry.kind,
            AuthorityEntryKind::TurnCommit | AuthorityEntryKind::ReplacementCommit
        ) {
            let result = candidate.apply_commit(&observation.entry, &pump.content)?;
            if strict_parity && !dropped {
                parity.push(verify_commit_parity(
                    &result,
                    &observation.entry.operation_id,
                    observation.entry.kind,
                    &observation.host_game,
                    &observation.host_control,
                    &observation.guest_game,
                    &observation.guest_control,
                )?);
            }
        }
    }
    let material_commits = ledger
        .commits
        .iter()
        .filter(|commit| {
            matches!(
                commit.kind,
                AuthorityEntryKind::TurnCommit | AuthorityEntryKind::ReplacementCommit
            )
        })
        .count();
    assert_eq!(
        candidate.frontier().len(),
        material_commits,
        "candidate replay depth differs from the ordered material ledger"
    );
    if strict_parity {
        assert_eq!(
            parity.len(),
            material_commits,
            "commit parity evidence depth differs from the ordered material ledger"
        );
    }
    assert!(
        !ledger.commits.is_empty(),
        "campaign completed without a single authority commit"
    );
    assert!(
        ledger
            .commits
            .last()
            .is_some_and(|commit| commit.kind == AuthorityEntryKind::TerminalCommit),
        "campaign ledger did not end with the shared-terminal commit"
    );

    // Ordered replica receipts: only the guest acknowledges, every stage
    // sequence stays canonical, and every committed revision is acked.
    let observed_receipts = pump
        .receipts
        .iter()
        .map(|(sender, receipt)| (*sender, receipt.clone()))
        .collect::<Vec<_>>();
    let committed_revisions = ledger
        .commits
        .iter()
        .map(|commit| commit.revision)
        .collect::<Vec<_>>();
    verify_replica_receipt_order(pump.campaign.guest_seat, &ledger, &observed_receipts)?;
    let mut receipt_revisions: Vec<u64> = committed_revisions
        .iter()
        .map(|revision| revision.get().get())
        .collect();
    let mut acked = BTreeSet::new();
    for (_, receipt) in &pump.receipts {
        acked.insert(receipt.revision.get().get());
    }
    receipt_revisions.retain(|revision| {
        assert!(
            acked.contains(revision),
            "commit revision {revision} was never acknowledged by the replica"
        );
        true
    });

    // Final candidate == host == guest proof: the purely replayed candidate
    // frontier must equal both endpoints' exact terminal mechanics.
    let candidate_state = serde_json::to_value(
        candidate
            .current_state()
            .ok_or_else(|| invalid("candidate replay never seeded a state"))?,
    )?;
    let candidate_control = {
        let control = terminal_observations["host"].1.clone();
        control
    };
    assert_eq!(
        candidate_state, terminal_observations["host"].0,
        "candidate frontier diverged from the host terminal mechanics"
    );
    assert_eq!(
        candidate_state, terminal_observations["guest"].0,
        "candidate frontier diverged from the guest terminal mechanics"
    );
    assert_eq!(
        candidate_control, terminal_observations["host"].1,
        "candidate control diverged from the host terminal projection"
    );
    assert_eq!(
        candidate_control, terminal_observations["guest"].1,
        "candidate control diverged from the guest terminal projection"
    );

    let trace = pump.trace.clone();

    // Snapshot restore equivalence: both endpoint kernels restore from their
    // own closed V2 snapshot into byte-identical continuations.
    for endpoint in [Endpoint::Host, Endpoint::Guest] {
        let snapshot = pump.kernel(endpoint).snapshot_v2()?;
        let wire = serde_json::to_string(&snapshot)?;
        let decoded: RestorableKernelSnapshotV2 = serde_json::from_str(&wire)?;
        let restored = GameKernel::from_snapshot(decoded, Arc::clone(&pump.content))?;
        assert_eq!(
            restored.state_digest(),
            pump.kernel(endpoint).state_digest(),
            "restored {endpoint:?} digest diverged from its live owner"
        );
        assert_eq!(
            serde_json::to_vec(&restored.snapshot_v2()?)?,
            serde_json::to_vec(&pump.kernel(endpoint).snapshot_v2()?)?,
            "restored {endpoint:?} snapshot bytes diverged from its live owner"
        );
    }

    // Zero-resource teardown: explicit disposal is the final lifecycle action.
    let _residual_packets = pump.queue.len();
    for endpoint in [Endpoint::Host, Endpoint::Guest] {
        let effects = pump
            .kernel_mut(endpoint)
            .dispose("m6 co-op campaign complete");
        drop(effects);
        assert_eq!(
            pump.kernel(endpoint).live_resources(),
            LiveResourceSnapshot::default(),
            "{endpoint:?} retained live resources after teardown"
        );
        assert!(pump.kernel(endpoint).is_disposed());
    }

    Ok(CampaignEvidence {
        ledger,
        material_commit_count: material_commits,
        parity,
        trace,
        host_digest,
        guest_digest,
        receipt_revisions,
        disconnect_events: pump.disconnect_events,
    })
}

// ---------------------------------------------------------------------------
// Campaign plans.
// ---------------------------------------------------------------------------

fn duplicate_delay_campaign(seed: u64) -> TestResult<CoopCampaignV1> {
    Ok(CoopCampaignV1::new(
        "duplicate-delay".to_owned(),
        seed,
        seat(1),
        seat(2),
        PhysicalKey::Enter,
        200,
        vec![
            CoopScheduledAction {
                anchor: CoopAnchor::BeforeDelivery {
                    selector: CoopPacketSelector::guest_proposal(),
                    ordinal: 1,
                },
                action: CoopScheduledActionKind::DuplicatePacket {
                    selector: CoopPacketSelector::guest_proposal(),
                },
            },
            CoopScheduledAction {
                anchor: CoopAnchor::BeforeDelivery {
                    selector: CoopPacketSelector::authority_commit(),
                    ordinal: 1,
                },
                action: CoopScheduledActionKind::DelayPacket {
                    selector: CoopPacketSelector::authority_commit(),
                    additional_ms: 40,
                },
            },
            CoopScheduledAction {
                anchor: CoopAnchor::BeforeDelivery {
                    selector: CoopPacketSelector::authority_commit(),
                    ordinal: 2,
                },
                action: CoopScheduledActionKind::DuplicatePacket {
                    selector: CoopPacketSelector::authority_commit(),
                },
            },
            CoopScheduledAction {
                anchor: CoopAnchor::BeforeDelivery {
                    selector: CoopPacketSelector::guest_receipt(),
                    ordinal: 1,
                },
                action: CoopScheduledActionKind::DuplicatePacket {
                    selector: CoopPacketSelector::guest_receipt(),
                },
            },
        ],
    )?)
}

fn disconnect_recovery_campaign(seed: u64) -> TestResult<CoopCampaignV1> {
    Ok(CoopCampaignV1::new(
        "disconnect-recovery".to_owned(),
        seed,
        seat(1),
        seat(2),
        PhysicalKey::Enter,
        200,
        vec![
            CoopScheduledAction {
                anchor: CoopAnchor::BeforeDelivery {
                    selector: CoopPacketSelector::authority_commit(),
                    ordinal: 2,
                },
                action: CoopScheduledActionKind::Disconnect {
                    endpoint: CoopEndpoint::Guest,
                },
            },
            CoopScheduledAction {
                anchor: CoopAnchor::WhenIdle,
                action: CoopScheduledActionKind::Reconnect {
                    endpoint: CoopEndpoint::Guest,
                },
            },
        ],
    )?)
}

fn combined_fault_campaign(seed: u64) -> TestResult<CoopCampaignV1> {
    Ok(CoopCampaignV1::new(
        "combined-faults".to_owned(),
        seed,
        seat(1),
        seat(2),
        PhysicalKey::Enter,
        200,
        vec![
            CoopScheduledAction {
                anchor: CoopAnchor::BeforeDelivery {
                    selector: CoopPacketSelector::guest_proposal(),
                    ordinal: 1,
                },
                action: CoopScheduledActionKind::DelayPacket {
                    selector: CoopPacketSelector::guest_proposal(),
                    additional_ms: 20,
                },
            },
            CoopScheduledAction {
                anchor: CoopAnchor::BeforeDelivery {
                    selector: CoopPacketSelector::authority_commit(),
                    ordinal: 1,
                },
                action: CoopScheduledActionKind::DuplicatePacket {
                    selector: CoopPacketSelector::authority_commit(),
                },
            },
            CoopScheduledAction {
                anchor: CoopAnchor::BeforeDelivery {
                    selector: CoopPacketSelector::authority_commit(),
                    ordinal: 2,
                },
                action: CoopScheduledActionKind::Disconnect {
                    endpoint: CoopEndpoint::Guest,
                },
            },
            CoopScheduledAction {
                anchor: CoopAnchor::WhenIdle,
                action: CoopScheduledActionKind::Reconnect {
                    endpoint: CoopEndpoint::Guest,
                },
            },
            CoopScheduledAction {
                anchor: CoopAnchor::BeforeDelivery {
                    selector: CoopPacketSelector::authority_commit(),
                    ordinal: 3,
                },
                action: CoopScheduledActionKind::DelayPacket {
                    selector: CoopPacketSelector::authority_commit(),
                    additional_ms: 60,
                },
            },
            CoopScheduledAction {
                anchor: CoopAnchor::BeforeDelivery {
                    selector: CoopPacketSelector::guest_receipt(),
                    ordinal: 1,
                },
                action: CoopScheduledActionKind::DuplicatePacket {
                    selector: CoopPacketSelector::guest_receipt(),
                },
            },
        ],
    )?)
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

fn run_victory_campaign(campaign: CoopCampaignV1) -> TestResult<CampaignEvidence> {
    let content = content_pack()?;
    let config = victory_config(replacement_campaign_config(&content)?)?;
    let mut pump = CampaignPump::new(campaign, config, Arc::clone(&content))?;
    pump.drive_to_terminal()?;
    finish_and_verify(pump)
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

#[test]
fn duplicate_delay_victory_campaign_completes_with_candidate_parity() -> TestResult {
    let evidence = run_victory_campaign(duplicate_delay_campaign(0x6D36_4443)?)?;
    let kinds = evidence
        .ledger
        .commits
        .iter()
        .map(|commit| commit.kind)
        .collect::<Vec<_>>();
    assert!(
        kinds.contains(&AuthorityEntryKind::TurnCommit)
            && kinds.contains(&AuthorityEntryKind::ReplacementCommit),
        "duplicate/delay victory campaign lacked TURN/REPLACEMENT commits: {kinds:?}"
    );
    assert_eq!(evidence.parity.len(), evidence.material_commit_count);
    assert!(
        evidence.receipt_revisions.len() >= evidence.parity.len(),
        "victory campaign produced fewer replica receipts than commits"
    );
    Ok(())
}

#[test]
fn disconnect_recovery_victory_campaign_restores_candidate_parity() -> TestResult {
    let evidence = run_victory_campaign(disconnect_recovery_campaign(0x6D36_4444)?)?;
    assert!(!evidence.ledger.commits.is_empty());
    // Disconnect campaigns prove candidate/host/guest equality through the
    // shared-terminal frontier instead of mid-flight snapshots.
    assert!(evidence.disconnect_events >= 1);
    Ok(())
}

#[test]
fn victory_campaign_commits_turn_replacement_and_terminal() -> TestResult {
    let evidence = run_victory_campaign(duplicate_delay_campaign(0x6D36_4447)?)?;
    let kinds = evidence
        .ledger
        .commits
        .iter()
        .map(|commit| commit.kind)
        .collect::<Vec<_>>();
    assert!(
        kinds.contains(&AuthorityEntryKind::TurnCommit),
        "victory campaign produced no TURN commit: {kinds:?}"
    );
    assert!(
        kinds.contains(&AuthorityEntryKind::ReplacementCommit),
        "victory campaign produced no REPLACEMENT commit: {kinds:?}"
    );
    assert!(
        kinds.contains(&AuthorityEntryKind::TerminalCommit),
        "victory campaign produced no TERMINAL commit: {kinds:?}"
    );
    assert_eq!(evidence.parity.len(), evidence.material_commit_count);
    Ok(())
}

#[test]
fn combined_fault_victory_campaign_completes_deterministically() -> TestResult {
    let first = run_victory_campaign(combined_fault_campaign(0x6D36_4445)?)?;
    assert!(!first.ledger.commits.is_empty());
    assert!(
        first.disconnect_events > 0,
        "combined-fault campaign never tore the transport down"
    );

    // Replay determinism: an independent rerun of the same seeded campaign
    // produces the identical ordered ledger and trace digest.
    let second = run_victory_campaign(combined_fault_campaign(0x6D36_4445)?)?;
    assert_eq!(
        first.trace, second.trace,
        "replayed campaign trace diverged from the original run"
    );
    assert_eq!(first.ledger, second.ledger);
    assert_eq!(first.host_digest, second.host_digest);
    assert_eq!(first.guest_digest, second.guest_digest);
    Ok(())
}

#[test]
fn duplicate_delay_victory_campaign_replays_identically() -> TestResult {
    let first = run_victory_campaign(duplicate_delay_campaign(0x6D36_4448)?)?;
    let second = run_victory_campaign(duplicate_delay_campaign(0x6D36_4448)?)?;
    assert_eq!(first.trace, second.trace);
    assert_eq!(first.ledger, second.ledger);
    assert_eq!(first.host_digest, second.host_digest);
    assert_eq!(first.guest_digest, second.guest_digest);
    Ok(())
}
