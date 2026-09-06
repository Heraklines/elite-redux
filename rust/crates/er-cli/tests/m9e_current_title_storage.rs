//! Actual current CLI ingress; callbacks are supplied by this test, not a filesystem provider.
use std::error::Error;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;
use er_env::current::{CurrentExternalEvent, CurrentGameSession};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelRoleV7, KernelStorageResultV2};
use er_kernel::snapshot_v7::{CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7};
use er_save::m9e_save_v2::GameSaveV2;
use er_state::m7_state::{DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics};
use er_types::battle_ids::WaveIndex;
use er_types::{InputFocus, PhysicalKey, RawInputEvent, SafeU53, SeatId};
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

fn direct(content: Arc<PreparedGameContentV2>) -> Result<CurrentGameSession, Box<dyn Error>> {
    Ok(CurrentGameSession::natural_start(profile()?, "m9e-current-cli".to_owned(),
        SeatId::new(SafeU53::new(1)?), vec!["preview-slot".to_owned()], true, content, None)?)
}
fn keys(code: PhysicalKey) -> [CurrentExternalEvent; 2] {
    [CurrentExternalEvent::RawInput { input: RawInputEvent::KeyDown {
        code: code.clone(), printable: false, browser_repeat: false, focus: InputFocus::Game } },
     CurrentExternalEvent::RawInput { input: RawInputEvent::KeyUp { code } }]
}
fn source_save(content: Arc<PreparedGameContentV2>) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut source = direct(content)?;
    for _ in 0..3 { for event in keys(PhysicalKey::Space) { source.apply(event)?; } }
    let bound = source.observe()?.control.as_ref().and_then(|control| control.menu.as_ref()).ok_or("starter menu absent")?.options.len() + 1;
    for _ in 0..bound {
        if source.observe()?.control.as_ref().and_then(|control| control.menu.as_ref())
            .is_some_and(|menu| menu.selected_option_id.as_str() == "bootstrap/starter/confirm") { break; }
        for event in keys(PhysicalKey::ArrowDown) { source.apply(event)?; }
    }
    for _ in 0..4 { for event in keys(PhysicalKey::Space) { source.apply(event)?; } }
    let GameKernelLifecycleSnapshotV7::Active(state) = source.snapshot()?.lifecycle else { return Err("actual natural source inactive".into()); };
    // Actual natural BattleCommand state encoded directly; no natural Save-menu claim.
    Ok(GameSaveV2::new(state.content_identity.clone(), SafeU53::new(7)?, state)?.encode()?)
}
fn record(session: &mut CurrentGameSession, requests: &mut Vec<Value>, expected: &mut Vec<(usize, CoreGameKernelSnapshotV7)>, event: CurrentExternalEvent) -> Result<(), Box<dyn Error>> {
    session.apply(event.clone())?;
    let id = requests.len();
    requests.push(request(&format!("event-{id}"), "platform.event", json!({"session":"current", "event":event})));
    let id = requests.len();
    requests.push(request(&format!("snapshot-{id}"), "session.snapshot", json!({"session":"current"})));
    expected.push((id, session.snapshot()?));
    Ok(())
}
#[test]
fn current_cli_opt_in_title_list_cancel_read_matches_every_full_native_snapshot() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let bytes = source_save(content.clone())?;
    let mut session = direct(content.clone())?;
    session.enable_current_title_storage()?;
    let mut create = create_request()?;
    create["params"]["start"]["existing_saves"] = json!(true);
    let mut requests = vec![create];
    let mut expected = Vec::new();
    for code in [PhysicalKey::ArrowDown, PhysicalKey::Space] {
        for event in keys(code) { record(&mut session, &mut requests, &mut expected, event)?; }
    }
    let cancelled_id = session.snapshot()?.pending_platform[0].request_id;
    for event in keys(PhysicalKey::Escape) { record(&mut session, &mut requests, &mut expected, event)?; }
    let rejected_index = requests.len();
    requests.push(request("cancelled-callback", "session.storage_result", json!({"session":"current", "request_id":cancelled_id,
        "result":KernelStorageResultV2::Slots { slots: vec!["stale".to_owned()] }})));
    let id = requests.len();
    requests.push(request("cancelled-snapshot", "session.snapshot", json!({"session":"current"})));
    expected.push((id, session.snapshot()?));
    for code in [PhysicalKey::ArrowDown, PhysicalKey::Space] {
        for event in keys(code) { record(&mut session, &mut requests, &mut expected, event)?; }
    }
    let list_id = session.snapshot()?.pending_platform[0].request_id;
    assert!(list_id > cancelled_id);
    record(&mut session, &mut requests, &mut expected, CurrentExternalEvent::StorageResult {
        request_id: list_id, result: KernelStorageResultV2::Slots { slots: vec!["stored-actual".to_owned()] } })?;
    for event in keys(PhysicalKey::Space) { record(&mut session, &mut requests, &mut expected, event)?; }
    let read_id = session.snapshot()?.pending_platform[0].request_id;
    assert!(read_id > list_id);
    record(&mut session, &mut requests, &mut expected, CurrentExternalEvent::StorageResult {
        request_id: read_id, result: KernelStorageResultV2::Read { bytes: Some(bytes) } })?;
    let loaded = session.snapshot()?;
    let restored = CurrentGameSession::from_snapshot(loaded.clone(), SeatId::new(SafeU53::new(1)?), GameKernelRoleV7::Authority, content)?;
    assert_eq!(restored.snapshot()?, loaded);
    for event in keys(PhysicalKey::Space) { record(&mut session, &mut requests, &mut expected, event)?; }
    assert_eq!(session.observe()?.control.ok_or("control absent")?.kind, er_types::GameControlKindV2::BattleMove);
    let responses = run_cli(&requests)?;
    assert!(!responses[rejected_index]["error"].is_null());
    for (index, expected) in expected { assert_eq!(snapshot(&responses[index])?, expected, "request {index}"); }
    for (index, response) in responses.iter().enumerate() {
        if index != rejected_index { result(response)?; }
    }
    Ok(())
}

#[test]
fn current_cli_absent_flag_preserves_old_title_and_rejects_non_host_opt_in() -> Result<(), Box<dyn Error>> {
    let old = create_request()?;
    let mut denied = create_request()?;
    denied["id"] = json!("denied");
    denied["params"]["session"] = json!("non-host");
    denied["params"]["start"]["existing_saves"] = json!(true);
    denied["params"]["start"]["local_is_host"] = json!(false);
    let requests = vec![old, request("old", "session.snapshot", json!({"session":"current"})), denied,
        request("old-after", "session.snapshot", json!({"session":"current"}))];
    let responses = run_cli(&requests)?;
    assert_eq!(snapshot(&responses[1])?, direct(content()?)?.snapshot()?);
    assert!(!responses[2]["error"].is_null());
    assert_eq!(snapshot(&responses[1])?, snapshot(&responses[3])?);
    Ok(())
}
