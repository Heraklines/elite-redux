//! Real executable witnesses for the current warm agent entry point.
//!
//! Run remotely: cargo test -p er-cli --test m9e_current_entry

use std::error::Error;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::GameKernelV7;
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::{CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7};
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::{GameControlKindV2, InputFocus, PhysicalKey, RawInputEvent, SafeU53, SeatId};
use serde_json::{Value, json};

fn content_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/m9/engineering/game-content-bundle-v2.json")
}

fn content() -> Result<Arc<PreparedGameContentV2>, Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(&std::fs::read(content_path())?)?;
    Ok(Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?))
}

fn profile() -> Result<ProfileStateV1, Box<dyn Error>> {
    Ok(ProfileStateV1 {
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
            highest_wave: WaveIndex::new(SafeU53::new(1)?)?,
        },
        dex: DexState::default(),
    })
}

fn request(id: &str, method: &str, params: Value) -> Value {
    json!({"protocol_version": 1, "id": id, "method": method, "params": params})
}

fn create_request() -> Result<Value, Box<dyn Error>> {
    Ok(request(
        "create",
        "session.create",
        json!({
            "session": "current",
            "start": {
                "kind": "NATURAL",
                "profile": profile()?,
                "seed": "m9e-current-cli",
                "owner_seat": 1,
                "save_slots": ["preview-slot"],
                "local_is_host": true
            }
        }),
    ))
}

fn run_cli(requests: &[Value]) -> Result<Vec<Value>, Box<dyn Error>> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_er-cli"))
        .args([
            "agent",
            "--protocol",
            "jsonl",
            "--warm",
            "true",
            "--content",
        ])
        .arg(content_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut input = child.stdin.take().ok_or("CLI stdin missing")?;
    let pending = requests.to_vec();
    let writer = std::thread::spawn(move || -> Result<(), String> {
        for request in pending {
            serde_json::to_writer(&mut input, &request).map_err(|error| error.to_string())?;
            input.write_all(b"\n").map_err(|error| error.to_string())?;
        }
        Ok(())
    });
    let output = child.wait_with_output()?;
    let write_result = writer.join().map_err(|_| "CLI input writer panicked")?;
    assert!(
        output.status.success(),
        "current agent failed before completing JSONL requests: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    write_result?;
    let responses = output
        .stdout
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
        .map(serde_json::from_slice)
        .collect::<Result<Vec<Value>, _>>()?;
    assert_eq!(responses.len(), requests.len(), "one response per request");
    for (response, request) in responses.iter().zip(requests) {
        assert_eq!(response["id"], request["id"]);
        assert_eq!(response["protocol_version"], 1);
    }
    Ok(responses)
}

fn result(response: &Value) -> Result<&Value, Box<dyn Error>> {
    assert!(response["error"].is_null(), "agent error: {response}");
    response
        .get("result")
        .ok_or_else(|| "missing result".into())
}

fn snapshot(response: &Value) -> Result<CoreGameKernelSnapshotV7, Box<dyn Error>> {
    Ok(serde_json::from_value(result(response)?.clone())?)
}

#[test]
fn public_agent_natural_start_owns_v7_content_and_raw_controls() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let responses = run_cli(&[
        request("hello", "protocol.hello", json!({})),
        create_request()?,
        request("before", "session.snapshot", json!({"session": "current"})),
        request(
            "down",
            "session.raw_input",
            json!({"session": "current", "input": RawInputEvent::KeyDown {
                code: PhysicalKey::Enter,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            }}),
        ),
        request(
            "up",
            "session.raw_input",
            json!({"session": "current", "input": RawInputEvent::KeyUp {
                code: PhysicalKey::Enter,
            }}),
        ),
        request("after", "session.snapshot", json!({"session": "current"})),
    ])?;
    let hello = result(&responses[0])?;
    assert_eq!(hello["kernel_version"], 7);
    assert_eq!(
        hello["content_identity"],
        serde_json::to_value(content.identity())?
    );
    result(&responses[1])?;
    result(&responses[3])?;
    result(&responses[4])?;
    let before = snapshot(&responses[2])?;
    let after = snapshot(&responses[5])?;
    before.validate(content.as_ref())?;
    after.validate(content.as_ref())?;
    assert_eq!(before.schema_version, 7);
    assert_eq!(after.schema_version, 7);
    let GameKernelLifecycleSnapshotV7::Bootstrap(before) = before.lifecycle else {
        return Err("natural start did not produce a current bootstrap lifecycle".into());
    };
    let GameKernelLifecycleSnapshotV7::Bootstrap(after) = after.lifecycle else {
        return Err("Enter did not retain the current bootstrap lifecycle".into());
    };
    assert_eq!(before.control.kind, GameControlKindV2::Title);
    assert_eq!(after.control.kind, GameControlKindV2::ModeSelect);
    Ok(())
}

#[test]
fn public_agent_rejects_old_snapshot_schema_without_replacing_current_session()
-> Result<(), Box<dyn Error>> {
    let content = content()?;
    let kernel = GameKernelV7::natural_start(
        profile()?,
        "m9e-current-cli".to_owned(),
        SeatId::new(SafeU53::new(1)?),
        vec!["preview-slot".to_owned()],
        true,
        content,
        KernelSchedulerSnapshotV2 {
            next_timer_id: None,
            timers: Vec::new(),
            pauses: Vec::new(),
            disposed: false,
        },
        None,
    )?;
    let current_snapshot = serde_json::to_value(kernel.snapshot()?)?;
    let mut old_schema = current_snapshot.clone();
    old_schema["schema_version"] = json!(6);
    let responses = run_cli(&[
        create_request()?,
        request("before", "session.snapshot", json!({"session": "current"})),
        request(
            "valid",
            "session.create",
            json!({"session": "restored", "start": {
                "kind": "SNAPSHOT", "snapshot": current_snapshot,
                "owner_seat": 1, "role": "AUTHORITY"
            }}),
        ),
        request(
            "invalid",
            "session.create",
            json!({"session": "old", "start": {
                "kind": "SNAPSHOT", "snapshot": old_schema,
                "owner_seat": 1, "role": "AUTHORITY"
            }}),
        ),
        request("after", "session.snapshot", json!({"session": "current"})),
    ])?;
    result(&responses[0])?;
    result(&responses[2])?;
    assert!(responses[3]["result"].is_null());
    assert!(
        !responses[3]["error"].is_null(),
        "old schema was silently accepted"
    );
    assert_eq!(snapshot(&responses[1])?, snapshot(&responses[4])?);
    Ok(())
}

#[test]
fn public_agent_fork_time_restore_and_close_preserve_current_session_identity()
-> Result<(), Box<dyn Error>> {
    let content = content()?;
    let initial = GameKernelV7::natural_start(
        profile()?,
        "m9e-current-cli".to_owned(),
        SeatId::new(SafeU53::new(1)?),
        vec!["preview-slot".to_owned()],
        true,
        content,
        KernelSchedulerSnapshotV2 {
            next_timer_id: Some(SafeU53::ZERO),
            timers: Vec::new(),
            pauses: Vec::new(),
            disposed: false,
        },
        None,
    )?
    .snapshot()?;
    let responses = run_cli(&[
        create_request()?,
        request("before", "session.snapshot", json!({"session": "current"})),
        request(
            "fork",
            "session.fork",
            json!({"session": "current", "target_session": "forked"}),
        ),
        request(
            "time",
            "session.advance_time",
            json!({"session": "current", "milliseconds": 13}),
        ),
        request(
            "fork-time",
            "session.advance_time",
            json!({"session": "forked", "milliseconds": 13}),
        ),
        request("after", "session.snapshot", json!({"session": "current"})),
        request(
            "fork-after",
            "session.snapshot",
            json!({"session": "forked"}),
        ),
        request(
            "restore",
            "session.restore",
            json!({"session": "current", "snapshot": initial}),
        ),
        request(
            "restored",
            "session.snapshot",
            json!({"session": "current"}),
        ),
        request("close", "session.close", json!({"session": "forked"})),
        request("closed", "session.observe", json!({"session": "forked"})),
    ])?;
    for response in &responses[..10] {
        result(response)?;
    }
    assert_eq!(snapshot(&responses[1])?, initial);
    let after = snapshot(&responses[5])?;
    assert_eq!(after, snapshot(&responses[6])?);
    assert_eq!(
        after.replay_sequence.get(),
        initial.replay_sequence.get() + 1
    );
    assert_eq!(snapshot(&responses[8])?, initial);
    let step: er_kernel::game_kernel_v7::GameKernelStepV7 =
        serde_json::from_value(result(&responses[3])?["step"].clone())?;
    assert!(
        step.effects.is_empty(),
        "empty bootstrap has no timer effects"
    );
    assert!(responses[10]["result"].is_null());
    assert!(
        !responses[10]["error"].is_null(),
        "closed session still observed"
    );
    Ok(())
}

#[test]
fn public_agent_rejected_external_results_do_not_commit_partial_state() -> Result<(), Box<dyn Error>>
{
    let responses = run_cli(&[
        create_request()?,
        request("before", "session.snapshot", json!({"session": "current"})),
        request(
            "network",
            "session.network_frame",
            json!({
                "session": "current", "generation": 1, "bytes": []
            }),
        ),
        request(
            "storage",
            "session.storage_result",
            json!({
                "session": "current", "request_id": 1, "result": {"kind": "WRITTEN"}
            }),
        ),
        request(
            "presentation",
            "session.presentation_settled",
            json!({
                "session": "current", "event_id": 1, "outcome": {"kind": "SETTLED"}
            }),
        ),
        request("after", "session.snapshot", json!({"session": "current"})),
    ])?;
    result(&responses[0])?;
    for response in &responses[2..5] {
        assert!(response["result"].is_null());
        assert_eq!(response["error"]["code"], "BACKEND_ERROR");
    }
    assert_eq!(snapshot(&responses[1])?, snapshot(&responses[5])?);
    Ok(())
}

#[derive(Debug, thiserror::Error)]
enum CompletionFailure {
    #[error(transparent)]
    Session(#[from] er_env::current::CurrentSessionError),
    #[error("adapter refused the prepared response")]
    Rejected,
}

#[test]
fn current_session_rolls_back_when_adapter_completion_rejects() -> Result<(), Box<dyn Error>> {
    use er_env::current::{CurrentExternalEvent, CurrentGameSession};
    let mut session = CurrentGameSession::natural_start(
        profile()?,
        "m9e-transaction".to_owned(),
        SeatId::new(SafeU53::new(1)?),
        vec!["preview-slot".to_owned()],
        true,
        content()?,
        None,
    )?;
    let before = session.snapshot()?;
    let event = CurrentExternalEvent::AdvanceTime { milliseconds: SafeU53::new(13)? };
    let rejected: Result<(), CompletionFailure> = session.apply_with(event.clone(), |candidate, _step| {
        assert_eq!(candidate.snapshot()?.replay_sequence.get(), before.replay_sequence.get() + 1);
        Err(CompletionFailure::Rejected)
    });
    assert!(matches!(rejected, Err(CompletionFailure::Rejected)));
    assert_eq!(session.snapshot()?, before, "adapter failure committed staged state");
    let mut expected = session.fork()?;
    let expected_step = expected.apply(event.clone())?;
    let completed: Result<_, CompletionFailure> = session.apply_with(event, |candidate, step| {
        Ok((candidate.snapshot()?, step))
    });
    let (snapshot, step) = completed?;
    assert_eq!(snapshot, expected.snapshot()?);
    assert_eq!(session.snapshot()?, snapshot);
    assert_eq!(step, expected_step);
    for event in [
        CurrentExternalEvent::ProposalFrame { bytes: Vec::new() },
        CurrentExternalEvent::AuthorityMaterial { bytes: Vec::new() },
    ] {
        assert!(session.apply(event).is_err());
        assert_eq!(session.snapshot()?, snapshot);
    }
    Ok(())
}
