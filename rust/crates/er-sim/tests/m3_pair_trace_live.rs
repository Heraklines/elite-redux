//! Live production Battle-pair evidence for the frozen PairKernelTraceV2 API.
//!
//! The trace observation adapter is intentionally a narrow integration seam:
//! it must apply one V2 operation to the real `SimulatedPair` and return all
//! post-operation evidence owned by that pair.  The adapter is not present at
//! the integration SHA used by this worker; the exact method signature this
//! test targets is documented in `live_pair_trace_step` below.

use std::collections::BTreeMap;
use std::error::Error;
use std::fmt::Debug;
use std::sync::Arc;

use er_canonical::canonical_bytes;
use er_content::pack::{ContentPack, selected_content_pack};
use er_kernel::{BattleGameConfig, BattleProtocolConfig, BattleProtocolRoleConfig, BattleStartV1};
use er_protocol::{
    AuthorityLogConfig, AuthorityReplicaConfig, BackoffPolicy, PeerBinding, ProposalLeaseConfig,
    RecoveryTransactionConfig,
};
use er_sim::snapshot::{
    InternalEventKindV1, PairKernelTraceRecorder, PairKernelTraceV2, PairOperationV2,
    PairTraceObservationV2, SnapshotError, TraceFailureOwnerV2, TraceReplayReportV2,
};
use er_sim::{PairEndpoint, PairOperation, SimulatedBattlePairConfig, SimulatedPair};
use er_types::battle_command::{
    BattleCommand, BattleTargetSelection, ScriptedEnemyBattleCommandV1, ScriptedEnemyPolicyV1,
    scripted_enemy_command_operation_id,
};
use er_types::battle_ids::{
    BattleFormat, BattleId, BattleSide, FieldSlot, MoveSlotIndex, PartyIndex, WaveIndex,
};
use er_types::{
    ConnectionGeneration, FrameContext, InputFocus, MembershipRevision, PhysicalKey, RawInputEvent,
    RunId, SafeU53, SeatId, SessionId, TimeClass,
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const LIVE_BATTLE_FIXTURE: &str =
    include_str!("../../../fixtures/m3/oracle/battle-cases/doubles-single-target.json");
const LIVE_CONTENT_PACK_FIXTURE: &str =
    include_str!("../../../fixtures/m3/oracle/content-pack-v1.json");
const LEGACY_ORACLE_CONTENT_DIGEST: &str =
    "3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";
const LEGACY_ORACLE_CONTENT_HASH: &str =
    "blake3-v1:3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";

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

fn field<'a>(object: &'a Value, key: &str) -> TestResult<&'a Value> {
    object
        .get(key)
        .ok_or_else(|| invalid(format!("fixture is missing field {key:?}")))
}

fn fixture() -> TestResult<Value> {
    Ok(serde_json::from_str(LIVE_BATTLE_FIXTURE)?)
}

fn adapt_legacy_condition_kind(value: &mut Value, path: &str) -> TestResult<()> {
    let normalized = match value {
        Value::String(tag) if tag == "NONE" => serde_json::json!({ "kind": "NONE" }),
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

fn adapt_legacy_content_conditions(content: &mut Value) -> TestResult<()> {
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
            adapt_legacy_condition_kind(
                value,
                &format!("content_pack.capability_manifest.entries[{index}].subject.value"),
            )?;
        }
    }
    Ok(())
}

fn normalize_legacy_type_chart(content: &mut Value, selected: &ContentPack) -> TestResult<()> {
    let expected_entries = serde_json::to_value(&selected.type_chart.entries)?
        .as_array()
        .cloned()
        .ok_or_else(|| invalid("selected type chart entries are not an array"))?;
    let type_chart = content
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

fn normalize_legacy_content_pack(artifact: &mut Value, selected: &ContentPack) -> TestResult<()> {
    selected.validate()?;
    let (provenance_hash, provenance_oracle_sha) = {
        let provenance = field(artifact, "provenance")?;
        (
            field(provenance, "content_pack_hash")?
                .as_str()
                .ok_or_else(|| invalid("published content provenance hash is not a string"))?
                .to_owned(),
            field(provenance, "oracle_game_sha")?
                .as_str()
                .ok_or_else(|| invalid("published content provenance oracle SHA is not a string"))?
                .to_owned(),
        )
    };
    let (pack_hash, pack_oracle_sha) = {
        let pack = field(artifact, "content_pack")?;
        (
            field(pack, "hash")?
                .as_str()
                .ok_or_else(|| invalid("published content pack hash is not a string"))?
                .to_owned(),
            field(pack, "oracle_game_sha")?
                .as_str()
                .ok_or_else(|| invalid("published content pack oracle SHA is not a string"))?
                .to_owned(),
        )
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

fn content_pack() -> TestResult<Arc<ContentPack>> {
    let mut artifact: Value = serde_json::from_str(LIVE_CONTENT_PACK_FIXTURE)?;
    let selected = selected_content_pack()?;
    normalize_legacy_content_pack(&mut artifact, &selected)?;
    let value = artifact
        .get("content_pack")
        .cloned()
        .ok_or_else(|| invalid("content-pack fixture has no content_pack payload"))?;
    let decoded: ContentPack = serde_json::from_value(value)?;
    assert_eq!(decoded, selected);
    Ok(Arc::new(decoded))
}

fn canonical_state(fixture: &Value) -> TestResult<&Value> {
    field(field(fixture, "initial_state")?, "canonical")
}

fn initial_battle(fixture: &Value) -> TestResult<&Value> {
    field(canonical_state(fixture)?, "battle")
}

fn normalize_legacy_state_content_identity(
    fixture: &Value,
    canonical: &Value,
    selected: &ContentPack,
) -> TestResult<Value> {
    let fixture_hash = field(canonical, "content_hash")?
        .as_str()
        .ok_or_else(|| invalid("initial canonical content_hash is not a string"))?
        .to_owned();
    let expected_hash = field(field(fixture, "expected_final_state")?, "canonical")?
        .get("content_hash")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("expected canonical content_hash is not a string"))?;
    if expected_hash != fixture_hash {
        return Err(invalid(
            "published state content hashes disagree between initial and expected final state",
        ));
    }
    let provenance = field(fixture, "provenance")?;
    let provenance_hash = field(provenance, "content_pack_hash")?
        .as_str()
        .ok_or_else(|| invalid("published provenance content_pack_hash is not a string"))?;
    let provenance_oracle_sha = field(provenance, "oracle_game_sha")?
        .as_str()
        .ok_or_else(|| invalid("published provenance oracle_game_sha is not a string"))?;
    if fixture_hash != LEGACY_ORACLE_CONTENT_HASH
        || provenance_hash != LEGACY_ORACLE_CONTENT_DIGEST
        || provenance_oracle_sha != selected.oracle_game_sha
    {
        return Err(invalid(
            "fixture content identity is not the exact supported legacy pair",
        ));
    }

    let mut normalized = canonical.clone();
    normalized
        .as_object_mut()
        .ok_or_else(|| invalid("initial canonical state is not an object"))?
        .insert(
            "content_hash".to_owned(),
            Value::String(selected.hash.to_string()),
        );
    Ok(normalized)
}

fn kernel_format(battle: &Value) -> TestResult<Value> {
    let mut format = field(battle, "format")?.clone();
    format
        .as_object_mut()
        .ok_or_else(|| invalid("battle format is not an object"))?
        .remove("slots");
    Ok(format)
}

fn adapt_party_status_kinds(party: &Value, party_name: &str) -> TestResult<Value> {
    let mut adapted = party.clone();
    let pokemon = adapted
        .as_array_mut()
        .ok_or_else(|| invalid(format!("{party_name} is not an array")))?;

    for (index, pokemon) in pokemon.iter_mut().enumerate() {
        let pokemon = pokemon
            .as_object_mut()
            .ok_or_else(|| invalid(format!("{party_name}[{index}] is not an object")))?;
        let status = pokemon
            .get_mut("status")
            .ok_or_else(|| invalid(format!("{party_name}[{index}].status is missing")))?
            .as_object_mut()
            .ok_or_else(|| invalid(format!("{party_name}[{index}].status is not an object")))?;
        let kind = status
            .get_mut("kind")
            .ok_or_else(|| invalid(format!("{party_name}[{index}].status.kind is missing")))?;
        let unwrapped = match kind {
            Value::String(_) => continue,
            Value::Object(wrapper) if wrapper.len() == 1 => wrapper
                .get("kind")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    invalid(format!(
                        "{party_name}[{index}].status.kind must be a string or an exact one-field kind wrapper"
                    ))
                })?
                .to_owned(),
            _ => {
                return Err(invalid(format!(
                    "{party_name}[{index}].status.kind must be a string or an exact one-field kind wrapper"
                )));
            }
        };
        *kind = Value::String(unwrapped);
    }

    Ok(adapted)
}

fn enemy_actor(battle: &Value, position: u8) -> TestResult<er_types::battle_ids::PokemonId> {
    let slots = field(field(battle, "field")?, "slots")?
        .as_array()
        .ok_or_else(|| invalid("battle field slots are not an array"))?;
    let actor = slots.iter().find_map(|entry| {
        let slot = entry.get("slot")?;
        (slot.get("side")?.as_str() == Some("ENEMY")
            && slot.get("position")?.as_u64() == Some(u64::from(position)))
        .then(|| entry.get("occupant")?.as_u64())
        .flatten()
    });
    let actor = actor.ok_or_else(|| {
        invalid(format!(
            "doubles fixture has no enemy lead at position {position}"
        ))
    })?;
    Ok(er_types::battle_ids::PokemonId::new(SafeU53::new(actor)?))
}

fn scripted_enemy_policy(
    battle: &Value,
    format: &BattleFormat,
) -> TestResult<ScriptedEnemyPolicyV1> {
    let battle_id: BattleId = serde_json::from_value(field(battle, "battle_id")?.clone())?;
    let turn_number = field(battle, "turn")?
        .as_u64()
        .ok_or_else(|| invalid("battle turn is not an unsigned integer"))?;
    let wave: WaveIndex = serde_json::from_value(field(battle, "wave")?.clone())?;
    let turn = er_types::battle_ids::TurnIndex::new(SafeU53::new(turn_number)?)?;
    let commands = (0..format.enemy_capacity)
        .map(|position| -> TestResult<ScriptedEnemyBattleCommandV1> {
            let actor = enemy_actor(battle, position)?;
            let enemy_slot = FieldSlot {
                side: BattleSide::Enemy,
                position,
            };
            let target = FieldSlot {
                side: BattleSide::Player,
                position: position.min(format.player_capacity.saturating_sub(1)),
            };
            let script_cursor = safe(u64::from(position));
            let operation_id = scripted_enemy_command_operation_id(
                battle_id,
                wave,
                turn,
                enemy_slot,
                script_cursor,
            )?;
            let command = BattleCommand::fight(
                actor,
                MoveSlotIndex::ZERO,
                BattleTargetSelection::selected(vec![target])?,
            )?;
            Ok(ScriptedEnemyBattleCommandV1::new(
                operation_id,
                battle_id,
                wave,
                turn,
                script_cursor,
                actor,
                enemy_slot,
                command,
            )?)
        })
        .collect::<TestResult<Vec<_>>>()?;
    Ok(ScriptedEnemyPolicyV1::new(SafeU53::ZERO, commands)?)
}

fn battle_config(
    fixture: &Value,
    content: &ContentPack,
    local_seat: SeatId,
) -> TestResult<BattleGameConfig> {
    let canonical =
        normalize_legacy_state_content_identity(fixture, canonical_state(fixture)?, content)?;
    let battle = initial_battle(fixture)?;
    let format: BattleFormat = serde_json::from_value(kernel_format(battle)?)?;
    if format != BattleFormat::coop_double() {
        return Err(invalid(
            "live pair fixture must use the exact co-op doubles battle format",
        ));
    }

    let mut run_state = canonical;
    let run_state_object = run_state
        .as_object_mut()
        .ok_or_else(|| invalid("canonical game state is not an object"))?;
    run_state_object.insert("battle".to_owned(), Value::Null);
    run_state_object.insert(
        "next_battle_id".to_owned(),
        field(battle, "battle_id")?.clone(),
    );
    run_state_object.insert(
        "run_rng".to_owned(),
        field(field(fixture, "initial_rng")?, "run")?.clone(),
    );

    let wave_seed = field(battle, "wave_seed")?
        .as_str()
        .ok_or_else(|| invalid("battle wave seed is not a string"))?
        .to_owned();
    let player_party =
        adapt_party_status_kinds(field(battle, "player_party")?, "battle.player_party")?;
    let enemy_party =
        adapt_party_status_kinds(field(battle, "enemy_party")?, "battle.enemy_party")?;
    Ok(BattleGameConfig {
        run_state: serde_json::from_value(run_state)?,
        start: BattleStartV1 {
            schema_version: 1,
            format: format.clone(),
            player_party: serde_json::from_value(player_party)?,
            enemy_party: serde_json::from_value(enemy_party)?,
            player_leads: (0..format.player_capacity)
                .map(|position| Ok(PartyIndex::try_from(u64::from(position))?))
                .collect::<TestResult<Vec<_>>>()?,
            enemy_leads: (0..format.enemy_capacity)
                .map(|position| Ok(PartyIndex::try_from(u64::from(position))?))
                .collect::<TestResult<Vec<_>>>()?,
        },
        local_seat,
        wave_seed,
        scripted_enemy_policy: scripted_enemy_policy(battle, &format)?,
    })
}

fn context(
    sender_seat_id: SeatId,
    authority_seat_id: SeatId,
    connection_generation: ConnectionGeneration,
) -> TestResult<FrameContext> {
    Ok(FrameContext {
        session_id: SessionId::new("m3-pair-trace-live-session")?,
        run_id: RunId::new("m3-pair-trace-live-run")?,
        session_epoch: safe(1),
        seat_map_id: "m3-pair-trace-live-seat-map".to_owned(),
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
                owner_id: "m3-pair-trace-live:authority".to_owned(),
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
                owner_prefix: "m3-pair-trace-live:proposal:".to_owned(),
                retry_initial_ms: safe(1),
                retry_maximum_ms: safe(64),
                absolute_ceiling_ms: safe(1_200_000),
            },
            recovery: RecoveryTransactionConfig {
                local_context: guest_context,
                request_timeout_ms: safe(300_000),
                control_timeout_ms: safe(30_000),
                pacing_ms: safe(16),
                timer_owner_id: "m3-pair-trace-live:recovery".to_owned(),
            },
        },
    })
}

fn new_live_pair() -> TestResult<(SimulatedPair, Arc<ContentPack>)> {
    let fixture = fixture()?;
    let content = content_pack()?;
    let host = seat(1);
    let guest = seat(2);
    let connection_generation = generation(1);
    let mut pair = SimulatedPair::new_battle(SimulatedBattlePairConfig {
        host_game: battle_config(&fixture, &content, host)?,
        host_protocol: authority_protocol(host, guest, connection_generation)?,
        guest_game: battle_config(&fixture, &content, guest)?,
        guest_protocol: replica_protocol(host, guest, connection_generation)?,
        content: Arc::clone(&content),
        replay_seed: 0x4c_u64,
        initial_storage: BTreeMap::new(),
    })?;
    // Battle protocol construction starts at generation one, while simulated
    // transport starts at zero. Establish the connected generation before the
    // trace captures its initial snapshot.
    pair.apply(PairOperation::Reconnect {
        endpoint: PairEndpoint::Host,
    })?;
    Ok((pair, content))
}

/// Intended integration-owned adapter signature.
///
/// The adapter must apply `input` through the real `SimulatedPair` boundary,
/// capture ordered production effects with their endpoint origins, capture
/// the actual host/guest RNG and internal-event evidence, and snapshot the
/// actual pair/environment after the operation.  It must not construct a
/// `PairTraceObservationV2` from DTO-only fixtures.
fn live_pair_trace_step(
    pair: &mut SimulatedPair,
    input: &PairOperationV2,
) -> Result<PairTraceObservationV2, SnapshotError> {
    // Required integration-owned method at the current base:
    //
    // pair.apply_trace_operation_v2(input.clone())
    //     -> Result<PairTraceObservationV2, SnapshotError>
    pair.apply_trace_operation_v2(input.clone())
}

fn canonical_json_round_trip<T>(value: &T) -> TestResult<T>
where
    T: Serialize + DeserializeOwned + PartialEq + Debug,
{
    let canonical = canonical_bytes(value)?;
    let json: Value = serde_json::from_slice(&canonical)?;
    let decoded = serde_json::from_value(json)?;
    assert_eq!(canonical, canonical_bytes(&decoded)?);
    assert_eq!(decoded, *value);
    Ok(decoded)
}

fn operations() -> Vec<PairOperationV2> {
    vec![
        PairOperationV2::RawInput {
            endpoint: PairEndpoint::Host,
            event: RawInputEvent::KeyDown {
                code: PhysicalKey::Enter,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            },
        },
        PairOperationV2::RawInput {
            endpoint: PairEndpoint::Host,
            event: RawInputEvent::KeyUp {
                code: PhysicalKey::Enter,
            },
        },
    ]
}

fn replay(
    trace: &PairKernelTraceV2,
    content: Arc<ContentPack>,
    mutate_observation: bool,
) -> TestResult<TraceReplayReportV2> {
    let mut expected = trace.clone();
    if mutate_observation {
        // This changes exactly one expected live observation field while
        // retaining a valid frozen shape, so replay's first mismatch is
        // reported by the trace comparator rather than validation.
        expected
            .entries
            .first_mut()
            .expect("live trace must contain an entry")
            .host
            .internal_events
            .push(InternalEventKindV1::Button);
    }
    Ok(expected.replay_simulated_pair(content)?)
}

fn divergence_coordinates(
    report: &TraceReplayReportV2,
) -> (SafeU53, SafeU53, TraceFailureOwnerV2, String, String) {
    let divergence = report
        .first_divergence
        .as_ref()
        .expect("mutated replay must report a first divergence");
    (
        divergence.sequence,
        divergence.virtual_time_ms,
        divergence.owner,
        divergence.code.clone(),
        divergence.path.clone(),
    )
}

#[test]
fn live_battle_pair_trace_round_trips_replays_and_attributes_first_observation_divergence()
-> TestResult {
    let (mut pair, content) = new_live_pair()?;
    let origin = pair.snapshot_v2()?;
    let mut recorder = PairKernelTraceRecorder::new(origin.clone())?;

    for input in operations() {
        let input = canonical_json_round_trip(&input)?;
        let observation = live_pair_trace_step(&mut pair, &input)?;
        recorder.record_observation(input, observation)?;
    }
    let trace = recorder.finish()?;
    let trace = canonical_json_round_trip(&trace)?;
    trace.validate()?;
    assert_eq!(trace.initial_snapshot, origin);
    assert_eq!(trace.entries.len(), operations().len());

    let exact = replay(&trace, Arc::clone(&content), false)?;
    assert_eq!(exact.replayed_entries, safe(operations().len() as u64));
    assert_eq!(exact.first_divergence, None);

    let mutated_first = replay(&trace, Arc::clone(&content), true)?;
    let mutated_second = replay(&trace, content, true)?;
    let expected = (
        safe(1),
        SafeU53::ZERO,
        TraceFailureOwnerV2::Host,
        "TRACE_DIVERGENCE".to_owned(),
        "host.internal_events".to_owned(),
    );
    assert_eq!(mutated_first.replayed_entries, safe(1));
    assert_eq!(mutated_second.replayed_entries, safe(1));
    assert_eq!(divergence_coordinates(&mutated_first), expected);
    assert_eq!(divergence_coordinates(&mutated_second), expected);
    Ok(())
}
