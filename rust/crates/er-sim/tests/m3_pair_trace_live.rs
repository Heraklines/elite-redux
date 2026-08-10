//! Live production Battle-pair evidence for the frozen PairKernelTraceV2 API.
//!
//! The trace observation adapter is intentionally a narrow integration seam:
//! it must apply one V2 operation to the real `SimulatedPair` and return all
//! post-operation evidence owned by that pair.  The adapter is not present at
//! the integration SHA used by this worker; the exact method signature this
//! test targets is documented in `live_pair_trace_step` below.

use std::collections::BTreeMap;
use std::error::Error;
use std::sync::Arc;

use er_canonical::canonical_bytes;
use er_content::pack::ContentPack;
use er_kernel::{
    BattleGameConfig, BattleProtocolConfig, BattleProtocolRoleConfig, BattleStartV1,
};
use er_protocol::{
    AuthorityLogConfig, AuthorityReplicaConfig, BackoffPolicy, PeerBinding,
    ProposalLeaseConfig, RecoveryTransactionConfig,
};
use er_sim::snapshot::{
    InternalEventKindV1, PairKernelTraceRecorder, PairKernelTraceV2, PairOperationV2,
    PairTraceObservationV2, SnapshotError, TraceFailureOwnerV2, TraceReplayReportV2,
};
use er_sim::{PairEndpoint, SimulatedBattlePairConfig, SimulatedPair};
use er_types::battle_command::{
    BattleCommand, BattleTargetSelection, ScriptedEnemyBattleCommandV1, ScriptedEnemyPolicyV1,
    scripted_enemy_command_operation_id,
};
use er_types::battle_ids::{BattleId, BattleSide, FieldSlot, MoveSlotIndex, PartyIndex, WaveIndex};
use er_types::{
    ConnectionGeneration, FrameContext, InputFocus, MembershipRevision, PhysicalKey,
    RawInputEvent, RunId, SafeU53, SeatId, SessionId, TimeClass,
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const LIVE_BATTLE_FIXTURE: &str =
    include_str!("../../../fixtures/m3/oracle/battle-cases/physical-hit.json");
const LIVE_CONTENT_PACK_FIXTURE: &str =
    include_str!("../../../fixtures/m3/oracle/content-pack-v1.json");

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

fn content_pack() -> TestResult<Arc<ContentPack>> {
    let wire: Value = serde_json::from_str(LIVE_CONTENT_PACK_FIXTURE)?;
    let value = wire
        .get("content_pack")
        .cloned()
        .ok_or_else(|| invalid("content-pack fixture has no content_pack payload"))?;
    Ok(Arc::new(serde_json::from_value(value)?))
}

fn canonical_state(fixture: &Value) -> TestResult<&Value> {
    field(field(fixture, "initial_state")?, "canonical")
}

fn initial_battle(fixture: &Value) -> TestResult<&Value> {
    field(canonical_state(fixture)?, "battle")
}

fn kernel_format(battle: &Value) -> TestResult<Value> {
    let mut format = field(battle, "format")?.clone();
    format
        .as_object_mut()
        .ok_or_else(|| invalid("battle format is not an object"))?
        .remove("slots");
    Ok(format)
}

fn enemy_actor(battle: &Value) -> TestResult<er_types::battle_ids::PokemonId> {
    let slots = field(field(battle, "field")?, "slots")?
        .as_array()
        .ok_or_else(|| invalid("battle field slots are not an array"))?;
    let actor = slots.iter().find_map(|entry| {
        let slot = entry.get("slot")?;
        (slot.get("side")?.as_str() == Some("ENEMY")
            && slot.get("position")?.as_u64() == Some(0))
        .then(|| entry.get("occupant")?.as_u64())
        .flatten()
    });
    let actor = actor.ok_or_else(|| invalid("single fixture has no enemy lead"))?;
    Ok(er_types::battle_ids::PokemonId::new(SafeU53::new(actor)?))
}

fn scripted_enemy_policy(battle: &Value) -> TestResult<ScriptedEnemyPolicyV1> {
    let actor = enemy_actor(battle)?;
    let battle_id: BattleId = serde_json::from_value(field(battle, "battle_id")?.clone())?;
    let turn_number = field(battle, "turn")?
        .as_u64()
        .ok_or_else(|| invalid("battle turn is not an unsigned integer"))?;
    let wave: WaveIndex = serde_json::from_value(field(battle, "wave")?.clone())?;
    let enemy_slot = FieldSlot {
        side: BattleSide::Enemy,
        position: 0,
    };
    let turn = er_types::battle_ids::TurnIndex::new(SafeU53::new(turn_number)?)?;
    let operation_id = scripted_enemy_command_operation_id(
        battle_id,
        wave,
        turn,
        enemy_slot,
        SafeU53::ZERO,
    )?;
    let command = BattleCommand::fight(
        actor,
        MoveSlotIndex::ZERO,
        BattleTargetSelection::implicit(),
    )?;
    let scripted = ScriptedEnemyBattleCommandV1::new(
        operation_id,
        battle_id,
        wave,
        turn,
        SafeU53::ZERO,
        actor,
        enemy_slot,
        command,
    )?;
    Ok(ScriptedEnemyPolicyV1::new(SafeU53::ZERO, vec![scripted])?)
}

fn battle_config(fixture: &Value, local_seat: SeatId) -> TestResult<BattleGameConfig> {
    let canonical = canonical_state(fixture)?;
    let battle = initial_battle(fixture)?;
    let format = kernel_format(battle)?;
    let player_capacity = field(&format, "player_capacity")?
        .as_u64()
        .ok_or_else(|| invalid("player capacity is not an unsigned integer"))?;
    let enemy_capacity = field(&format, "enemy_capacity")?
        .as_u64()
        .ok_or_else(|| invalid("enemy capacity is not an unsigned integer"))?;
    if player_capacity != 1 || enemy_capacity != 1 {
        return Err(invalid("live pair fixture must use a single battle format"));
    }

    let mut run_state = canonical.clone();
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
    Ok(BattleGameConfig {
        run_state: serde_json::from_value(run_state)?,
        start: BattleStartV1 {
            schema_version: 1,
            format: serde_json::from_value(format)?,
            player_party: serde_json::from_value(field(battle, "player_party")?.clone())?,
            enemy_party: serde_json::from_value(field(battle, "enemy_party")?.clone())?,
            player_leads: vec![PartyIndex::try_from(0_u64)?],
            enemy_leads: vec![PartyIndex::try_from(0_u64)?],
        },
        local_seat,
        wave_seed,
        scripted_enemy_policy: scripted_enemy_policy(battle)?,
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
    let pair = SimulatedPair::new_battle(SimulatedBattlePairConfig {
        host_game: battle_config(&fixture, host)?,
        host_protocol: authority_protocol(host, guest, connection_generation)?,
        guest_game: battle_config(&fixture, guest)?,
        guest_protocol: replica_protocol(host, guest, connection_generation)?,
        content: Arc::clone(&content),
        replay_seed: 0x4c_u64,
        initial_storage: BTreeMap::new(),
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
    T: Serialize + DeserializeOwned + PartialEq,
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
    let mut mutated = false;
    Ok(trace.replay_simulated_pair::<SimulatedPair, _>(
        content,
        |pair, input, _virtual_time_ms| {
            let mut observation = live_pair_trace_step(pair, input)?;
            if mutate_observation && !mutated {
                // This changes exactly one live observation field while
                // retaining a valid frozen shape, so replay's first mismatch
                // is reported by the trace comparator rather than validation.
                observation
                    .host_internal_events
                    .push(InternalEventKindV1::Button);
                mutated = true;
            }
            Ok(observation)
        },
    )?)
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
