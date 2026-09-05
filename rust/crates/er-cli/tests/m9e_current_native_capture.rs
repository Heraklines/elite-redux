//! Actual standalone native capture witnesses. Remote execution only.

use std::error::Error;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, OnceLock, mpsc};
use std::time::{Duration, Instant};

use er_env::current::{CurrentExternalEvent, CurrentGameSession};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelRoleV7, KernelPresentationOutcomeV2};
use er_repro::current::{CurrentReproCapsuleV1, CurrentReproLimitsV1, CurrentReproRecorderV1, replay_current_capsule_v1};
use er_state::m7_state::ProfileStateV1;
use er_types::{GameControlKindV2, InputFocus, PhysicalKey, RawInputEvent, SafeU53, SeatId};
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;
type Line = Result<Option<Vec<u8>>, String>;
type WriteJob = (Vec<u8>, mpsc::SyncSender<Result<(), String>>);
type ReplayOutput = (bool, Option<Value>, String);
const RESPONSE_BOUND: u64 = 8 << 20;
const SEED: &str = "m9e-native-capture";

fn content_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/m9/engineering/game-content-bundle-v2.json")
}

fn content() -> TestResult<Arc<PreparedGameContentV2>> {
    static CONTENT: OnceLock<Arc<PreparedGameContentV2>> = OnceLock::new();
    Ok(Arc::clone(CONTENT.get_or_init(|| {
        let bundle: GameContentBundleV2 = serde_json::from_slice(&std::fs::read(content_path()).expect("fixture bytes")).expect("V2 bundle");
        Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle)).expect("prepared V2 content"))
    })))
}

fn profile() -> Value {
    json!({"schema_version": 1, "unlocks": [], "achievements": [], "challenges": [], "flags": [],
        "statistics": {"runs_started": 0, "runs_won": 0, "runs_lost": 0,
            "battles_won": 0, "pokemon_captured": 0, "highest_wave": 1}, "dex": {"entries": []}})
}

fn start() -> Value {
    json!({"kind": "NATURAL", "profile": profile(), "seed": SEED, "owner_seat": 1,
        "save_slots": ["preview-slot"], "local_is_host": true})
}

fn reference(content: Arc<PreparedGameContentV2>) -> TestResult<CurrentGameSession> {
    let profile: ProfileStateV1 = serde_json::from_value(profile())?;
    Ok(CurrentGameSession::natural_start(
        profile,
        SEED.to_owned(),
        SeatId::new(safe(1)),
        vec!["preview-slot".to_owned()],
        true,
        content,
        None,
    )?)
}

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("bounded fixture integer")
}
fn time(milliseconds: u64) -> CurrentExternalEvent {
    CurrentExternalEvent::AdvanceTime {
        milliseconds: safe(milliseconds),
    }
}
fn key(code: PhysicalKey, down: bool) -> CurrentExternalEvent {
    CurrentExternalEvent::RawInput {
        input: if down {
            RawInputEvent::KeyDown {
                code,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            }
        } else {
            RawInputEvent::KeyUp { code }
        },
    }
}
fn same(actual: &Value, expected: &Value) -> TestResult {
    assert_eq!(
        er_canonical::content_digest(actual)?,
        er_canonical::content_digest(expected)?,
        "complete canonical JSON differs"
    );
    Ok(())
}

fn active(content: Arc<PreparedGameContentV2>) -> TestResult<CurrentGameSession> {
    static CHECKPOINT: OnceLock<er_kernel::snapshot_v7::CoreGameKernelSnapshotV7> = OnceLock::new();
    let snapshot = CHECKPOINT.get_or_init(|| build_active(Arc::clone(&content)).expect("real natural route").snapshot().expect("active checkpoint"));
    Ok(CurrentGameSession::from_snapshot(snapshot.clone(), SeatId::new(safe(1)), GameKernelRoleV7::Authority, content)?)
}

fn build_active(content: Arc<PreparedGameContentV2>) -> TestResult<CurrentGameSession> {
    let mut session = reference(content)?;
    let press = |session: &mut CurrentGameSession, code: PhysicalKey| -> TestResult {
        session.apply(key(code.clone(), true))?;
        session.apply(key(code, false))?;
        Ok(())
    };
    for _ in 0..3 { press(&mut session, PhysicalKey::Space)?; }
    let bound = session.observe()?.control.ok_or("starter")?.menu.ok_or("menu")?.options.len() + 1;
    for _ in 0..bound {
        if session.observe()?.control.ok_or("starter")?.menu.ok_or("menu")?.selected_option_id.as_str() == "bootstrap/starter/confirm" { break; }
        press(&mut session, PhysicalKey::ArrowDown)?;
    }
    assert_eq!(session.observe()?.control.ok_or("starter")?.menu.ok_or("menu")?.selected_option_id.as_str(), "bootstrap/starter/confirm");
    for _ in 0..4 { press(&mut session, PhysicalKey::Space)?; }
    for pending in session.snapshot()?.pending_presentations {
        session.apply(CurrentExternalEvent::PresentationOutcome { event_id: pending.event_id, outcome: KernelPresentationOutcomeV2::Settled })?;
    }
    assert_eq!(session.observe()?.control.ok_or("battle")?.kind, GameControlKindV2::BattleCommand);
    Ok(session)
}

fn event(cli: &mut Cli, id: &str, reference: &mut CurrentGameSession, event: CurrentExternalEvent) -> TestResult {
    let step = reference.apply(event.clone())?;
    let (method, params) = match &event {
        CurrentExternalEvent::RawInput { input } => ("session.raw_input", json!({"session": id, "input": input})),
        CurrentExternalEvent::AdvanceTime { milliseconds } => ("session.advance_time", json!({"session": id, "milliseconds": milliseconds})),
        _ => ("platform.event", json!({"session": id, "event": event})),
    };
    same(&cli.result(method, params)?, &json!({"step": step, "observation": reference.observe()?}))?;
    same(&cli.result("session.snapshot", json!({"session": id}))?, &serde_json::to_value(reference.snapshot()?)?)
}

fn export(cli: &mut Cli, id: &str, reference: &CurrentGameSession) -> TestResult<CurrentReproCapsuleV1> {
    let result = cli.result("session.capsule.export", json!({"session": id}))?;
    let capsule: CurrentReproCapsuleV1 = serde_json::from_value(result["capsule"].clone())?;
    let replay = replay_current_capsule_v1(&capsule, Arc::clone(reference.content()), CurrentReproLimitsV1::default())?;
    assert_eq!(replay.snapshot()?, reference.snapshot()?);
    assert_eq!(replay.observe()?, reference.observe()?);
    Ok(capsule)
}

fn create_snapshot(cli: &mut Cli, id: &str, session: &CurrentGameSession, events: usize, bytes: usize) -> TestResult {
    cli.result("session.from_snapshot", json!({"session": id, "snapshot": session.snapshot()?, "owner_seat": 1, "role": "AUTHORITY", "capture_limits": {"maximum_events": events, "maximum_bytes": bytes}}))?;
    Ok(())
}

fn selected(session: &CurrentGameSession) -> TestResult<String> {
    Ok(session.observe()?.control.ok_or("control")?.menu.ok_or("menu")?.selected_option_id.as_str().to_owned())
}

#[test]
fn actual_native_capture_replays_natural_events_rejections_and_imported_history() -> TestResult {
    let content = content()?;
    let mut reference = reference(Arc::clone(&content))?;
    let mut cli = Cli::new(4)?;
    assert_eq!(cli.result("protocol.hello", json!({}))?["capture"], json!({"supported": true, "scope": "STANDALONE_NATIVE", "methods": ["session.capsule.export", "session.capsule.status"]}));
    cli.result("session.create", json!({"session": "natural", "start": start()}))?;
    assert_eq!(reference.observe()?.control.ok_or("title")?.kind, GameControlKindV2::Title);
    event(&mut cli, "natural", &mut reference, key(PhysicalKey::Space, true))?;
    event(&mut cli, "natural", &mut reference, key(PhysicalKey::Space, false))?;
    event(&mut cli, "natural", &mut reference, time(249))?;
    let invalid = CurrentExternalEvent::PresentationOutcome { event_id: er_types::PresentationEventId::new(safe(999_999)), outcome: KernelPresentationOutcomeV2::Settled };
    assert!(reference.apply(invalid.clone()).is_err());
    cli.rejects("platform.event", json!({"session": "natural", "event": invalid}), "invalid")?;
    let capsule = export(&mut cli, "natural", &reference)?;
    assert_eq!(capsule.final_position, 4);
    assert_eq!(capsule.attempts.last().ok_or("rejection")?.origin.as_deref(), Some("platform.event"));
    assert!(matches!(capsule.attempts.last().ok_or("rejection")?.outcome, er_repro::current::CurrentReproOutcomeV1::KernelRejected { .. }));
    cli.result("session.from_capsule", json!({"session": "import", "capsule": capsule}))?;
    assert_eq!(export(&mut cli, "import", &reference)?, capsule);
    let mut imported = reference.fork()?;
    event(&mut cli, "import", &mut imported, time(1))?;
    let continued = export(&mut cli, "import", &imported)?;
    assert_eq!(continued.final_position, 5);
    assert_eq!(continued.attempts.last().ok_or("time")?.origin.as_deref(), Some("session.advance_time"));
    assert_eq!(continued.base_position, capsule.base_position);
    assert_eq!(&continued.attempts[..capsule.attempts.len()], capsule.attempts.as_slice());
    assert_eq!(export(&mut cli, "natural", &reference)?, capsule);
    normal_replay_accepts_extended_native_capture(&mut cli)?;
    cli.finish()
}

#[test]
fn actual_native_capture_rotation_fork_restore_and_byte_gaps_are_explicit() -> TestResult {
    let mut reference = active(content()?)?;
    let original = reference.snapshot()?;
    let mut cli = Cli::new(4)?;
    create_snapshot(&mut cli, "active", &reference, 2, 2 << 20)?;
    event(&mut cli, "active", &mut reference, key(PhysicalKey::ArrowDown, true))?;
    assert_eq!(selected(&reference)?, "battle/command/party");
    event(&mut cli, "active", &mut reference, time(249))?;
    assert_eq!(selected(&reference)?, "battle/command/party");
    let rotation_checkpoint = reference.snapshot()?;
    event(&mut cli, "active", &mut reference, time(1))?;
    assert_eq!(selected(&reference)?, "battle/command/fight");
    let rotated = export(&mut cli, "active", &reference)?;
    assert_eq!((rotated.base_position, rotated.final_position, rotated.attempts.len()), (2, 3, 1));
    assert_eq!(*rotated.checkpoint, rotation_checkpoint);
    cli.result("session.fork", json!({"session": "active", "target_session": "fork"}))?;
    assert_eq!(export(&mut cli, "fork", &reference)?, rotated);
    let mut fork = reference.fork()?;
    event(&mut cli, "fork", &mut fork, time(500))?;
    assert_eq!(selected(&fork)?, "battle/command/fight");
    event(&mut cli, "fork", &mut fork, key(PhysicalKey::ArrowDown, false))?;
    let mut quiet = fork.fork()?;
    assert!(quiet.apply(time(500))?.effects.is_empty(), "released navigation must not repeat");
    event(&mut cli, "fork", &mut fork, time(500))?;
    assert_eq!(selected(&fork)?, "battle/command/fight");
    assert_eq!(export(&mut cli, "active", &reference)?, rotated);
    let fork_before_restore = export(&mut cli, "fork", &fork)?;
    cli.result("session.restore", json!({"session": "fork", "snapshot": original}))?;
    let restored = CurrentGameSession::from_snapshot(original, SeatId::new(safe(1)), GameKernelRoleV7::Authority, Arc::clone(reference.content()))?;
    let reset = export(&mut cli, "fork", &restored)?;
    assert_eq!(reset.base_position, fork_before_restore.final_position + 1);
    assert_eq!(reset.final_position, reset.base_position);
    assert!(reset.attempts.is_empty());
    create_snapshot(&mut cli, "tiny", &restored, 2, 1)?;
    assert_eq!(cli.result("session.capsule.status", json!({"session": "tiny"}))?["status"]["kind"], "UNAVAILABLE");
    let mut tiny = restored.fork()?;
    event(&mut cli, "tiny", &mut tiny, time(1))?;
    assert!(cli.request("session.capsule.export", json!({"session": "tiny"}))?["error"].is_object());
    cli.result("session.close", json!({"session": "fork"}))?;
    assert!(cli.request("session.capsule.status", json!({"session": "fork"}))?["error"].is_object());
    create_snapshot(&mut cli, "fork", &restored, 2, 2 << 20)?;
    assert_eq!(export(&mut cli, "fork", &restored)?.final_position, 0);
    assert!(CurrentReproRecorderV1::new_at_position(restored.snapshot()?, SeatId::new(safe(1)), GameKernelRoleV7::Authority, Arc::clone(restored.content()), CurrentReproLimitsV1::default(), 9_007_199_254_740_992).is_err());
    let maximum = er_repro::current::MAXIMUM_CURRENT_REPRO_POSITION_V1;
    let exhausted = CurrentReproRecorderV1::new_at_position(restored.snapshot()?, SeatId::new(safe(1)), GameKernelRoleV7::Authority, Arc::clone(restored.content()), CurrentReproLimitsV1::default(), maximum)?.export()?;
    cli.result("session.from_capsule", json!({"session": "maximum", "capsule": exhausted}))?;
    assert_ne!(restored.snapshot()?, reference.snapshot()?, "restore must change actual gameplay state");
    cli.result("session.restore", json!({"session": "maximum", "snapshot": reference.snapshot()?}))?;
    same(&cli.result("session.snapshot", json!({"session": "maximum"}))?, &serde_json::to_value(reference.snapshot()?)?)?;
    let status = cli.result("session.capsule.status", json!({"session": "maximum"}))?;
    assert_eq!(status["status"]["kind"], "UNAVAILABLE");
    assert_eq!(status["status"]["position"], maximum);
    assert!(status["status"]["reason"].as_str().is_some_and(|reason| reason.contains("exhausted")));
    assert!(cli.request("session.capsule.export", json!({"session": "maximum"}))?["error"].is_object());
    let mut maximum_reference = reference.fork()?;
    event(&mut cli, "maximum", &mut maximum_reference, time(500))?;
    assert_eq!(cli.result("session.capsule.status", json!({"session": "maximum"}))?["status"]["position"], maximum);
    cli.finish()
}

/// One response in flight: no trace-sized snapshot or stdout collection. The
/// reader enforces a line cap before JSON parsing; stderr is continuously drained.
struct Cli {
    child: Child,
    input: Option<mpsc::SyncSender<WriteJob>>,
    writer: Option<std::thread::JoinHandle<()>>,
    responses: Option<mpsc::Receiver<Line>>,
    reader: Option<std::thread::JoinHandle<()>>,
    stderr: Option<std::thread::JoinHandle<Vec<u8>>>,
    next: u64,
}

impl Cli {
    fn raw(&mut self, bytes: &[u8]) -> TestResult<Value> {
        self.write_line(bytes)?;
        let line = self.responses.as_ref().ok_or("CLI receiver")?
            .recv_timeout(Duration::from_secs(60))??.ok_or("unexpected CLI EOF")?;
        Ok(serde_json::from_slice(&line)?)
    }
    fn write_line(&self, bytes: &[u8]) -> TestResult {
        assert!(bytes.len() <= (4 << 20) + 1, "bounded ingress fixture");
        let mut line = bytes.to_vec();
        line.push(b'\n');
        let (sent, completed) = mpsc::sync_channel(1);
        // Only one request can be in flight. A full queue is a helper failure,
        // never a reason to block the test thread indefinitely.
        self.input.as_ref().ok_or("closed CLI stdin")?.try_send((line, sent))
            .map_err(|_| "CLI writer is unavailable")?;
        completed.recv_timeout(Duration::from_secs(60))??;
        Ok(())
    }
    fn new(maximum: usize) -> TestResult<Self> {
        let mut command = Command::new(env!("CARGO_BIN_EXE_er-cli"));
        command.args(["agent", "--protocol", "jsonl", "--content"])
            .arg(content_path()).arg("--maximum-sessions").arg(maximum.to_string());
        Self::spawn(command)
    }
    fn spawn(mut command: Command) -> TestResult<Self> {
        let mut child = command.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        let mut input = child.stdin.take().ok_or("CLI stdin")?;
        let stdout = child.stdout.take().ok_or("CLI stdout")?;
        let mut stderr = child.stderr.take().ok_or("CLI stderr")?;
        let (input_sender, input_receiver) = mpsc::sync_channel::<WriteJob>(1);
        let writer = std::thread::spawn(move || {
            while let Ok((bytes, completed)) = input_receiver.recv() {
                let result = input.write_all(&bytes).and_then(|()| input.flush()).map_err(|error| error.to_string());
                let failed = result.is_err();
                let _ = completed.send(result);
                if failed { break; }
            }
        });
        let (sender, responses) = mpsc::sync_channel(1);
        let reader = std::thread::spawn(move || {
            let mut output = BufReader::new(stdout);
            loop {
                let mut line = Vec::new();
                let next = match output
                    .by_ref()
                    .take(RESPONSE_BOUND + 1)
                    .read_until(b'\n', &mut line)
                {
                    Ok(0) => Ok(None),
                    Ok(_) if line.len() as u64 > RESPONSE_BOUND || !line.ends_with(b"\n") => {
                        Err("CLI response exceeded line bound or was unterminated".to_owned())
                    }
                    Ok(_) => Ok(Some(line)),
                    Err(error) => Err(error.to_string()),
                };
                let finished = !matches!(&next, Ok(Some(_)));
                if sender.send(next).is_err() || finished {
                    break;
                }
            }
        });
        let stderr = std::thread::spawn(move || {
            let mut retained = Vec::new();
            let mut buffer = [0_u8; 4096];
            while let Ok(count) = stderr.read(&mut buffer) {
                if count == 0 {
                    break;
                }
                let keep = count.min((64_usize << 10).saturating_sub(retained.len()));
                retained.extend_from_slice(&buffer[..keep]);
            }
            retained
        });
        Ok(Self {
            child,
            input: Some(input_sender),
            writer: Some(writer),
            responses: Some(responses),
            reader: Some(reader),
            stderr: Some(stderr),
            next: 0,
        })
    }
    fn terminal(mut self) -> TestResult<ReplayOutput> {
        drop(self.input.take());
        let receiver = self.responses.as_ref().ok_or("CLI receiver")?;
        let line = receiver.recv_timeout(Duration::from_secs(60))??;
        let result = if let Some(line) = line {
            assert!(line.len() <= (4 << 20) + 1, "current terminal result bound");
            let value = serde_json::from_slice(&line)?;
            assert!(receiver.recv_timeout(Duration::from_secs(5))??.is_none(), "extra terminal output");
            Some(value)
        } else { None };
        let deadline = Instant::now() + Duration::from_secs(5);
        let status = loop {
            if let Some(status) = self.child.try_wait()? { break status; }
            if Instant::now() >= deadline { return Err("terminal exit deadline".into()); }
            std::thread::sleep(Duration::from_millis(10));
        };
        let deadline = Instant::now() + Duration::from_secs(5);
        while !self.stderr.as_ref().ok_or("terminal stderr")?.is_finished() {
            if Instant::now() >= deadline { return Err("terminal stderr deadline".into()); }
            std::thread::sleep(Duration::from_millis(10));
        }
        let stderr = self.stderr.take().ok_or("terminal stderr")?.join().map_err(|_| "terminal stderr reader panicked")?;
        Ok((status.success(), result, String::from_utf8(stderr)?))
    }
    fn request(&mut self, method: &str, params: Value) -> TestResult<Value> {
        self.next += 1;
        let id = format!("capture-{}", self.next);
        self.request_id(method, params, &id)
    }
    fn request_id(&mut self, method: &str, params: Value, id: &str) -> TestResult<Value> {
        let request = json!({"protocol_version": 1, "id": id, "method": method, "params": params});
        let bytes = serde_json::to_vec(&request)?;
        assert!(
            bytes.len() < 4 << 20,
            "fixture request exceeds current transport bound"
        );
        self.write_line(&bytes)?;
        let line = self
            .responses
            .as_ref()
            .ok_or("CLI receiver")?
            .recv_timeout(Duration::from_secs(60))??
            .ok_or("unexpected CLI EOF")?;
        let response: Value = serde_json::from_slice(&line)?;
        assert_eq!(response["protocol_version"], 1);
        assert!(
            response["id"].as_str() == Some(id),
            "response request ID mismatch"
        );
        Ok(response)
    }
    fn result(&mut self, method: &str, params: Value) -> TestResult<Value> {
        let mut response = self.request(method, params)?;
        assert!(
            response["error"].is_null(),
            "unexpected CLI error: {response}"
        );
        Ok(response
            .get_mut("result")
            .ok_or("missing inline result")?
            .take())
    }
    fn rejects(&mut self, method: &str, params: Value, category: &str) -> TestResult {
        let response = self.request(method, params)?;
        assert!(
            response["result"].is_null(),
            "failed transaction published results"
        );
        assert_eq!(response["error"]["code"], "BACKEND_ERROR");
        assert!(
            response["error"]["message"]
                .as_str()
                .is_some_and(|text| text.contains(category)),
            "wrong failure category: {response}"
        );
        Ok(())
    }
    fn finish(mut self) -> TestResult {
        drop(self.input.take());
        assert!(
            self.responses
                .as_ref()
                .ok_or("CLI receiver")?
                .recv_timeout(Duration::from_secs(5))??
                .is_none(),
            "unsolicited extra output"
        );
        let start = Instant::now();
        loop {
            if let Some(status) = self.child.try_wait()? {
                assert!(status.success(), "CLI exited unsuccessfully: {status}");
                return Ok(());
            }
            if start.elapsed() >= Duration::from_secs(5) {
                return Err("CLI exit deadline".into());
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

#[test]
fn actual_native_capture_late_response_and_rejected_ingress_preserve_gameplay() -> TestResult {
    let mut reference = active(content()?)?;
    let mut cli = Cli::new(3)?;
    create_snapshot(&mut cli, "active", &reference, 16, 2 << 20)?;
    create_snapshot(&mut cli, "other", &reference, 16, 2 << 20)?;
    let other = export(&mut cli, "other", &reference)?;
    let before = reference.snapshot()?;
    let parameters = json!({"session": "active", "event": key(PhysicalKey::ArrowDown, true)});
    let empty = json!({"protocol_version": 1, "id": "", "method": "platform.event", "params": parameters});
    let long_id = "x".repeat((4 << 20) - serde_json::to_vec(&empty)?.len() - 2);
    let mut candidate = reference.fork()?;
    let step = candidate.apply(key(PhysicalKey::ArrowDown, true))?;
    assert!(!step.effects.is_empty());
    assert_ne!(candidate.snapshot()?, before);
    let success = json!({"protocol_version": 1, "id": long_id, "artifact": null, "error": null,
        "result": {"step": step, "observation": candidate.observe()?}});
    assert!(serde_json::to_vec(&success)?.len() + 1 > 4 << 20);
    drop(success);
    let response = cli.request_id("platform.event", parameters, &long_id)?;
    assert!(response["result"].is_null());
    assert_eq!(response["error"]["code"], "BACKEND_ERROR");
    assert!(response["error"]["message"].as_str().is_some_and(|message| message.contains("success response JSONL")));
    drop(response);
    drop(long_id);
    same(&cli.result("session.snapshot", json!({"session": "active"}))?, &serde_json::to_value(&before)?)?;
    assert_eq!(cli.result("session.capsule.status", json!({"session": "active"}))?["status"]["kind"], "UNAVAILABLE");
    assert_eq!(export(&mut cli, "other", &reference)?, other);
    event(&mut cli, "active", &mut reference, key(PhysicalKey::ArrowDown, true))?;
    let recovered = export(&mut cli, "active", &reference)?;
    assert_eq!((recovered.base_position, recovered.final_position, recovered.attempts.len()), (1, 2, 1));
    assert_eq!(*recovered.checkpoint, before);

    let readonly = cli.request_id("session.capsule.export", json!({"session": "active"}), "read-only-id")?;
    assert!(readonly["error"].is_null());
    assert_eq!(cli.request_id("session.capsule.export", json!({"session": "active"}), "read-only-id")?["error"]["code"], "DUPLICATE_REQUEST");
    assert_eq!(export(&mut cli, "active", &reference)?, recovered);
    let empty_export = json!({"protocol_version": 1, "id": "", "method": "session.capsule.export", "params": {"session": "active"}});
    let export_id = "e".repeat((4 << 20) - serde_json::to_vec(&empty_export)?.len() - 2);
    let rejected_export = cli.request_id("session.capsule.export", json!({"session": "active"}), &export_id)?;
    assert_eq!(rejected_export["error"]["code"], "BACKEND_ERROR");
    assert!(rejected_export["error"]["message"].as_str().is_some_and(|message| message.contains("success response JSONL")));
    drop(rejected_export);
    drop(export_id);
    assert_eq!(export(&mut cli, "active", &reference)?, recovered);
    let params = json!({"session": "active", "milliseconds": 1});
    assert!(cli.request_id("session.advance_time", params.clone(), "typed-id")?["error"].is_null());
    reference.apply(time(1))?;
    assert_eq!(cli.request_id("session.advance_time", params, "typed-id")?["error"]["code"], "DUPLICATE_REQUEST");
    assert_eq!(cli.result("session.capsule.status", json!({"session": "active"}))?["status"]["kind"], "UNAVAILABLE");
    let other_reference = CurrentGameSession::from_snapshot(before.clone(), SeatId::new(safe(1)), GameKernelRoleV7::Authority, Arc::clone(reference.content()))?;
    assert_eq!(export(&mut cli, "other", &other_reference)?, other);
    event(&mut cli, "active", &mut reference, time(1))?;

    let bad = cli.request("session.raw_input", json!({"session": "active", "input": {"invalid": true}}))?;
    assert_eq!(bad["error"]["code"], "INVALID_REQUEST");
    assert_eq!(export(&mut cli, "other", &other_reference)?, other);
    event(&mut cli, "active", &mut reference, time(1))?;
    assert_eq!(cli.request("session.advance_time", json!({"session": "", "milliseconds": 1}))?["error"]["code"], "INVALID_REQUEST");
    for id in ["active", "other"] {
        assert_eq!(cli.result("session.capsule.status", json!({"session": id}))?["status"]["kind"], "UNAVAILABLE");
    }
    event(&mut cli, "active", &mut reference, time(1))?;
    assert_eq!(cli.request("session.advance_time", json!({"session": "x".repeat(129), "milliseconds": 1}))?["error"]["code"], "INVALID_REQUEST");
    assert_eq!(cli.result("session.capsule.status", json!({"session": "active"}))?["status"]["kind"], "UNAVAILABLE");
    event(&mut cli, "active", &mut reference, time(1))?;
    assert_eq!(cli.raw(b"{malformed")?["error"]["code"], "PARSE_ERROR");
    assert_eq!(cli.result("session.capsule.status", json!({"session": "active"}))?["status"]["kind"], "UNAVAILABLE");
    event(&mut cli, "active", &mut reference, time(1))?;
    assert_eq!(cli.raw(&vec![b'x'; (4 << 20) + 1])?["error"]["code"], "REQUEST_TOO_LARGE");
    assert_eq!(cli.result("session.capsule.status", json!({"session": "active"}))?["status"]["kind"], "UNAVAILABLE");
    same(&cli.result("session.snapshot", json!({"session": "active"}))?, &serde_json::to_value(reference.snapshot()?)?)?;
    same(&cli.result("session.snapshot", json!({"session": "other"}))?, &serde_json::to_value(before)?)?;
    event(&mut cli, "active", &mut reference, time(1))?;
    let final_capsule = export(&mut cli, "active", &reference)?;
    assert_eq!(final_capsule.attempts.len(), 1);
    assert_eq!(final_capsule.final_position, final_capsule.base_position + 1);
    cli.finish()
}

#[test]
fn actual_native_capture_browser_import_declares_native_suffix_at_original_frontier() -> TestResult {
    use er_web::contracts_v2::{BrowserEffectV2, BrowserRequestEnvelopeV2, BrowserRequestV2,
        BrowserResponseEnvelopeV2, BrowserResponseV2, BrowserSessionContextV2, BrowserSessionInitializationV2};
    let mut reference = active(content()?)?;
    let initial = reference.snapshot()?;
    let mut browser = er_web::host_v2::BrowserKernelHostV2::from_content(Arc::clone(reference.content()));
    let mut send = |sequence: u64, request: BrowserRequestV2| -> TestResult<BrowserResponseV2> {
        let envelope = BrowserRequestEnvelopeV2 { version: 2, request_id: safe(sequence + 1), sequence: safe(sequence), request };
        let response: BrowserResponseEnvelopeV2 = serde_json::from_slice(&browser.process_bytes(&er_canonical::canonical_bytes(&envelope)?)?)?;
        assert_eq!(response.accepted_sequence, safe(sequence));
        assert!(!matches!(&response.response, BrowserResponseV2::Fault { .. }));
        Ok(response.response)
    };
    send(0, BrowserRequestV2::Initialize { initialization: Box::new(BrowserSessionInitializationV2::Snapshot {
        context: BrowserSessionContextV2 { local_seat: SeatId::new(safe(1)), role: GameKernelRoleV7::Authority, scheduler: initial.scheduler.clone(), protocol: initial.protocol.clone() }, snapshot: initial,
    }) })?;
    send(1, BrowserRequestV2::AdvanceTime { milliseconds: safe(249) })?;
    reference.apply(time(249))?;
    let BrowserResponseV2::Effects { batch } = send(2, BrowserRequestV2::ExportRepro)? else { return Err("browser export effects".into()); };
    let bytes = batch.effects.into_iter().find_map(|effect| match effect { BrowserEffectV2::CurrentReproReady { capsule_bytes } => Some(capsule_bytes), _ => None }).ok_or("current browser capsule")?;
    let capsule: CurrentReproCapsuleV1 = serde_json::from_slice(&bytes)?;
    assert!(capsule.browser_transport.is_some());
    assert_eq!(capsule.final_position, 1);
    let mut cli = Cli::new(2)?;
    cli.result("session.from_capsule", json!({"session": "native", "capsule": capsule}))?;
    let suffix = export(&mut cli, "native", &reference)?;
    assert_eq!((suffix.base_position, suffix.final_position), (capsule.final_position, capsule.final_position));
    assert!(suffix.browser_transport.is_none());
    assert!(suffix.attempts.is_empty());
    event(&mut cli, "native", &mut reference, time(1))?;
    let continued = export(&mut cli, "native", &reference)?;
    assert_eq!(continued.base_position, capsule.final_position);
    assert_eq!(continued.final_position, capsule.final_position + 1);
    assert!(continued.attempts.iter().all(|attempt| attempt.browser_transport.is_none()));
    cli.finish()
}

impl Drop for Cli {
    fn drop(&mut self) {
        // Drop the receiver first so a reader blocked on its one-slot send exits.
        drop(self.responses.take());
        drop(self.input.take());
        let _ = self.child.kill();
        let start = Instant::now();
        while matches!(self.child.try_wait(), Ok(None)) && start.elapsed() < Duration::from_secs(5)
        {
            std::thread::sleep(Duration::from_millis(10));
        }
        if let Some(writer) = self.writer.take().filter(std::thread::JoinHandle::is_finished) {
            let _ = writer.join();
        }
        if let Some(reader) = self
            .reader
            .take()
            .filter(std::thread::JoinHandle::is_finished)
        {
            let _ = reader.join();
        }
        if let Some(stderr) = self
            .stderr
            .take()
            .filter(std::thread::JoinHandle::is_finished)
            && let Ok(bytes) = stderr.join()
            && !bytes.is_empty()
        {
            let _ = std::io::stderr().write_all(&bytes);
        }
    }
}

struct ReplayFiles(PathBuf);
impl ReplayFiles {
    fn new() -> TestResult<Self> {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!("m9e-native-replay-{}-{}", std::process::id(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
        std::fs::create_dir(&path)?;
        Ok(Self(path))
    }
    fn run(&self, command: &str, bytes: &[u8]) -> TestResult<ReplayOutput> {
        assert!(bytes.len() < 4 << 20, "fixture must pass the independent file-size bound");
        let path = self.0.join("capsule.json");
        std::fs::write(&path, bytes)?;
        let mut process = Command::new(env!("CARGO_BIN_EXE_er-cli"));
        process.arg(command).arg("--content").arg(content_path()).arg("--capsule").arg(path);
        Cli::spawn(process)?.terminal()
    }
}
impl Drop for ReplayFiles {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

// This is an actual 257-attempt export, not an expanded synthetic replay trace.
// The event ceiling and byte ceiling are independent: 4096 complete observations
// need not fit 2 MiB. Test the exact configuration ceiling without enlarging bytes.
fn normal_replay_accepts_extended_native_capture(cli: &mut Cli) -> TestResult {
    let limits = CurrentReproLimitsV1::default();
    assert_eq!(limits.maximum_events, 256, "recorder default must remain unchanged");
    assert_eq!(limits.maximum_bytes, 2 << 20);
    assert_eq!(er_repro::current::MAXIMUM_CURRENT_REPRO_EVENTS_V1, 4096);
    let maximum = er_repro::current::MAXIMUM_CURRENT_REPRO_EVENTS_V1;
    cli.result("session.create", json!({"session": "wide", "start": start(),
        "capture_limits": {"maximum_events": maximum, "maximum_bytes": limits.maximum_bytes}}))?;
    assert_eq!(cli.result("session.capsule.status", json!({"session": "wide"}))?["limits"],
        json!({"maximum_events": 4096, "maximum_bytes": 2 << 20}));
    cli.rejects("session.create", json!({"session": "too-wide", "start": start(),
        "capture_limits": {"maximum_events": maximum + 1, "maximum_bytes": limits.maximum_bytes}}), "limits")?;
    let mut session = reference(content()?)?;
    for _ in 0..=limits.maximum_events { event(cli, "wide", &mut session, time(0))?; }
    let mut exported = cli.result("session.capsule.export", json!({"session": "wide"}))?;
    let capsule: CurrentReproCapsuleV1 = serde_json::from_value(exported["capsule"].take())?;
    assert_eq!(capsule.attempts.len(), 257);
    assert_eq!((capsule.base_position, capsule.final_position), (0, 257));
    assert_eq!(capsule.attempts.first().ok_or("first retained event")?.position, 1);
    assert_eq!(capsule.attempts.last().ok_or("last retained event")?.position, 257);
    assert_eq!(capsule.attempts.last().ok_or("event origin")?.origin.as_deref(), Some("session.advance_time"));
    let bytes = serde_json::to_vec(&capsule)?;
    assert!(bytes.len() <= limits.maximum_bytes, "real exported capsule must fit the unchanged byte cap");
    let expected_snapshot = serde_json::to_value(session.snapshot()?)?;
    let expected_observation = serde_json::to_value(session.observe()?)?;
    let files = ReplayFiles::new()?;
    for command in ["replay", "capsule-validate"] {
        let (succeeded, result, diagnostic) = files.run(command, &bytes)?;
        assert!(succeeded, "{command} rejected a supported native capture: {diagnostic}");
        let result = result.ok_or("terminal replay result")?;
        assert_eq!(result["processed_attempts"], 257);
        assert_eq!(result["base_position"], 0);
        assert_eq!(result["final_position"], 257);
        assert_eq!(result["snapshot_digest"], capsule.final_snapshot_digest);
        same(&result["snapshot"], &expected_snapshot)?;
        same(&result["observation"], &expected_observation)?;
        if command == "capsule-validate" {
            assert_eq!(result["validation"], "ISOLATED_CURRENT_CAPSULE_REPLAY");
            assert_eq!(result["replay_valid"], true);
        }
    }
    // Retain a typed, small-count capsule and cross only the serialized byte cap.
    // The overlong origin also cannot be admitted, but bounds are checked first:
    // assert that precise category rather than treating any rejection as proof.
    let mut oversized = capsule;
    oversized.attempts.first_mut().ok_or("oversize attempt")?.origin = Some("x".repeat(limits.maximum_bytes));
    let oversized_bytes = serde_json::to_vec(&oversized)?;
    assert!(oversized_bytes.len() > limits.maximum_bytes);
    assert!(oversized_bytes.len() < 4 << 20);
    for command in ["replay", "capsule-validate"] {
        let (succeeded, result, diagnostic) = files.run(command, &oversized_bytes)?;
        assert!(!succeeded, "{command} accepted an oversized capsule");
        assert!(result.is_none(), "rejected replay published a result");
        assert!(diagnostic.contains("capsule bounds"), "wrong replay rejection: {diagnostic}");
    }
    cli.result("session.close", json!({"session": "wide"}))?;
    Ok(())
}
