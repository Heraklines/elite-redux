use std::error::Error;

use er_protocol::{
    AuthorityEntryDraft, AuthorityEntryKind, AuthorityLog, AuthorityLogConfig, BackoffPolicy,
    FrameContext, KernelScheduler, Material, NextControl, TimeClass,
};
use er_types::{
    CommandControlTarget, CommandFrontierControl, ConnectionGeneration, MembershipRevision,
    OperationId, RunId, SafeU53, SeatId, SessionId,
};
use serde_json::json;

type TestResult = Result<(), Box<dyn Error>>;

fn safe(value: u64) -> Result<SafeU53, Box<dyn Error>> {
    Ok(SafeU53::new(value)?)
}

fn context() -> Result<FrameContext, Box<dyn Error>> {
    let authority = SeatId::new(safe(1)?);
    Ok(FrameContext {
        session_id: SessionId::new("m3-local-authority")?,
        run_id: RunId::new("m3-local-run")?,
        session_epoch: safe(1)?,
        seat_map_id: "m3-local-seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)?),
        sender_seat_id: authority,
        authority_seat_id: authority,
        connection_generation: ConnectionGeneration::new(safe(1)?),
    })
}

fn config() -> Result<AuthorityLogConfig, Box<dyn Error>> {
    Ok(AuthorityLogConfig {
        local_context: context()?,
        peer_bindings: Vec::new(),
        owner_id: "m3-local-authority-log".to_owned(),
        retain_capacity: safe(16)?,
        delivery_backoff: BackoffPolicy {
            initial_ms: safe(250)?,
            maximum_ms: safe(5_000)?,
            factor_numerator: safe(2)?,
            factor_denominator: safe(1)?,
        },
        delivery_time_class: TimeClass::Connected,
        max_delivery_attempts: None,
    })
}

fn draft() -> Result<AuthorityEntryDraft, Box<dyn Error>> {
    Ok(AuthorityEntryDraft {
        context: context()?,
        operation_id: OperationId::new("battle/1/wave/1/turn/1/result")?,
        kind: AuthorityEntryKind::TurnCommit,
        material: Material {
            digest: "0000000000000000".to_owned(),
            payload: json!({}),
        },
        next_control: NextControl::CommandFrontier(CommandFrontierControl {
            epoch: safe(1)?,
            wave: safe(1)?,
            turn: safe(2)?,
            commands: vec![CommandControlTarget {
                owner_seat_id: SeatId::new(safe(1)?),
                pokemon_id: safe(7)?,
                field_index: safe(0)?,
            }],
        }),
        subsumes: Vec::new(),
    })
}

fn second_m3_turn_draft() -> Result<AuthorityEntryDraft, Box<dyn Error>> {
    Ok(AuthorityEntryDraft {
        context: context()?,
        operation_id: OperationId::new("battle/1/wave/1/turn/2/result")?,
        kind: AuthorityEntryKind::TurnCommit,
        material: Material {
            digest: "1111111111111111".to_owned(),
            payload: json!({
                "wave": 1,
                "resolved_turn": 2,
            }),
        },
        next_control: NextControl::CommandFrontier(CommandFrontierControl {
            epoch: safe(1)?,
            wave: safe(1)?,
            turn: safe(3)?,
            commands: vec![CommandControlTarget {
                owner_seat_id: SeatId::new(safe(1)?),
                pokemon_id: safe(7)?,
                field_index: safe(0)?,
            }],
        }),
        subsumes: Vec::new(),
    })
}

#[test]
fn local_authority_uses_the_same_log_without_a_synthetic_peer_or_delivery_lease() -> TestResult {
    assert!(AuthorityLog::new(config()?).is_err());

    let mut log = AuthorityLog::new_local(config()?)?;
    let mut scheduler = KernelScheduler::new();
    let prepared = log.prepare_commit(draft()?)?;
    let outcome = log.publish_prepared(prepared.token, &mut scheduler)?;

    assert_eq!(outcome.entry.revision.get().get(), 1);
    assert!(outcome.actions.is_empty());
    assert!(scheduler.live_timers().is_empty());
    assert_eq!(log.retained(), vec![outcome.entry]);
    Ok(())
}

#[test]
fn local_authority_accepts_the_frozen_m3_resolved_turn_successor_coordinate() -> TestResult {
    let mut log = AuthorityLog::new_local(config()?)?;
    let mut scheduler = KernelScheduler::new();
    let first = log.commit(draft()?, &mut scheduler)?;
    let mut ambiguous = second_m3_turn_draft()?;
    ambiguous
        .material
        .payload
        .as_object_mut()
        .ok_or("M3 TURN fixture payload must be an object")?
        .insert("turn".to_owned(), json!(2));
    assert!(log.commit(ambiguous, &mut scheduler).is_err());
    let second = log.commit(second_m3_turn_draft()?, &mut scheduler)?;

    assert_eq!(first.entry.revision.get().get(), 1);
    assert_eq!(second.entry.revision.get().get(), 2);
    assert_eq!(log.head_revision(), second.entry.revision);
    Ok(())
}
