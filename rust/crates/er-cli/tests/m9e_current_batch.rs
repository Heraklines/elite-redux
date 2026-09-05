//! Actual native JSONL batch witnesses. Execute only in the remote focused gate.

use std::error::Error;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

use er_env::current::{CurrentExternalEvent, CurrentGameSession};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelRoleV7, KernelPresentationOutcomeV2};
use er_repro::current::{CurrentReproLimitsV1, CurrentReproRecorderV1};
use er_state::m7_state::ProfileStateV1;
use er_types::{GameControlKindV2, InputFocus, PhysicalKey, RawInputEvent, SafeU53, SeatId};
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;
type Line = Result<Option<Vec<u8>>, String>;
const RESPONSE_BOUND: u64 = 8 << 20;
const SEED: &str = "m9e-current-batch-cli";

fn content_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/m9/engineering/game-content-bundle-v2.json")
}

fn content() -> TestResult<Arc<PreparedGameContentV2>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(&std::fs::read(content_path())?)?;
    Ok(Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?))
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
    Ok(CurrentGameSession::natural_start(profile, SEED.to_owned(), SeatId::new(safe(1)),
        vec!["preview-slot".to_owned()], true, content, None)?)
}

fn safe(value: u64) -> SafeU53 { SafeU53::new(value).expect("bounded fixture integer") }
fn time(milliseconds: u64) -> CurrentExternalEvent {
    CurrentExternalEvent::AdvanceTime { milliseconds: safe(milliseconds) }
}
fn key(code: PhysicalKey, down: bool) -> CurrentExternalEvent {
    CurrentExternalEvent::RawInput { input: if down {
        RawInputEvent::KeyDown { code, printable: false, browser_repeat: false, focus: InputFocus::Game }
    } else { RawInputEvent::KeyUp { code } } }
}
fn same(actual: &Value, expected: &Value) -> TestResult {
    assert_eq!(er_canonical::content_digest(actual)?, er_canonical::content_digest(expected)?,
        "complete canonical JSON differs");
    Ok(())
}

/// One response in flight: no trace-sized snapshot or stdout collection. The
/// reader enforces a line cap before JSON parsing; stderr is continuously drained.
struct Cli {
    child: Child,
    input: Option<ChildStdin>,
    responses: Option<mpsc::Receiver<Line>>,
    reader: Option<std::thread::JoinHandle<()>>,
    stderr: Option<std::thread::JoinHandle<Vec<u8>>>,
    next: u64,
}

impl Cli {
    fn new(maximum: usize) -> TestResult<Self> {
        let mut child = Command::new(env!("CARGO_BIN_EXE_er-cli"))
            .args(["agent", "--protocol", "jsonl", "--content"])
            .arg(content_path()).arg("--maximum-sessions").arg(maximum.to_string())
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
        let input = child.stdin.take().ok_or("CLI stdin")?;
        let stdout = child.stdout.take().ok_or("CLI stdout")?;
        let mut stderr = child.stderr.take().ok_or("CLI stderr")?;
        let (sender, responses) = mpsc::sync_channel(1);
        let reader = std::thread::spawn(move || {
            let mut output = BufReader::new(stdout);
            loop {
                let mut line = Vec::new();
                let next = match output.by_ref().take(RESPONSE_BOUND + 1).read_until(b'\n', &mut line) {
                    Ok(0) => Ok(None),
                    Ok(_) if line.len() as u64 > RESPONSE_BOUND || !line.ends_with(b"\n") =>
                        Err("CLI response exceeded line bound or was unterminated".to_owned()),
                    Ok(_) => Ok(Some(line)),
                    Err(error) => Err(error.to_string()),
                };
                let finished = !matches!(&next, Ok(Some(_)));
                if sender.send(next).is_err() || finished { break; }
            }
        });
        let stderr = std::thread::spawn(move || {
            let mut retained = Vec::new();
            let mut buffer = [0_u8; 4096];
            while let Ok(count) = stderr.read(&mut buffer) {
                if count == 0 { break; }
                let keep = count.min((64_usize << 10).saturating_sub(retained.len()));
                retained.extend_from_slice(&buffer[..keep]);
            }
            retained
        });
        Ok(Self { child, input: Some(input), responses: Some(responses), reader: Some(reader),
            stderr: Some(stderr), next: 0 })
    }
    fn request(&mut self, method: &str, params: Value) -> TestResult<Value> {
        self.next += 1;
        let id = format!("batch-{}", self.next);
        self.request_id(method, params, &id)
    }
    fn request_id(&mut self, method: &str, params: Value, id: &str) -> TestResult<Value> {
        let request = json!({"protocol_version": 1, "id": id, "method": method, "params": params});
        let bytes = serde_json::to_vec(&request)?;
        assert!(bytes.len() < 4 << 20, "fixture request exceeds current transport bound");
        let input = self.input.as_mut().ok_or("closed CLI stdin")?;
        input.write_all(&bytes)?;
        input.write_all(b"\n")?;
        input.flush()?;
        let line = self.responses.as_ref().ok_or("CLI receiver")?
            .recv_timeout(Duration::from_secs(60))??.ok_or("unexpected CLI EOF")?;
        let response: Value = serde_json::from_slice(&line)?;
        assert_eq!(response["protocol_version"], 1);
        assert!(response["id"].as_str() == Some(id), "response request ID mismatch");
        Ok(response)
    }
    fn result(&mut self, method: &str, params: Value) -> TestResult<Value> {
        let mut response = self.request(method, params)?;
        assert!(response["error"].is_null(), "unexpected CLI error: {response}");
        Ok(response.get_mut("result").ok_or("missing inline result")?.take())
    }
    fn rejects(&mut self, method: &str, params: Value, category: &str) -> TestResult {
        let response = self.request(method, params)?;
        assert!(response["result"].is_null(), "failed transaction published results");
        assert_eq!(response["error"]["code"], "BACKEND_ERROR");
        assert!(response["error"]["message"].as_str().is_some_and(|text| text.contains(category)),
            "wrong failure category: {response}");
        Ok(())
    }
    fn finish(mut self) -> TestResult {
        drop(self.input.take());
        assert!(self.responses.as_ref().ok_or("CLI receiver")?
            .recv_timeout(Duration::from_secs(5))??.is_none(), "unsolicited extra output");
        let start = Instant::now();
        loop {
            if let Some(status) = self.child.try_wait()? {
                assert!(status.success(), "CLI exited unsuccessfully: {status}");
                return Ok(());
            }
            if start.elapsed() >= Duration::from_secs(5) { return Err("CLI exit deadline".into()); }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for Cli {
    fn drop(&mut self) {
        // Drop the receiver first so a reader blocked on its one-slot send exits.
        drop(self.responses.take());
        drop(self.input.take());
        let _ = self.child.kill();
        let start = Instant::now();
        while matches!(self.child.try_wait(), Ok(None)) && start.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(10));
        }
        if let Some(reader) = self.reader.take().filter(std::thread::JoinHandle::is_finished) {
            let _ = reader.join();
        }
        if let Some(stderr) = self.stderr.take().filter(std::thread::JoinHandle::is_finished)
            && let Ok(bytes) = stderr.join()
            && !bytes.is_empty()
        {
            let _ = std::io::stderr().write_all(&bytes);
        }
    }
}

fn snapshots(cli: &mut Cli, batch: &str, environments: &[u64]) -> TestResult<Value> {
    cli.result("batch.snapshot", json!({"batch": batch, "environments": environments}))
}

fn events(cli: &mut Cli, references: &mut [CurrentGameSession], input: Vec<(u64, CurrentExternalEvent)>) -> TestResult {
    let mut expected = Vec::new();
    let mut wire = Vec::new();
    for (ordinal, (environment, event)) in input.into_iter().enumerate() {
        let session = references.get_mut(usize::try_from(environment - 1)?).ok_or("reference environment")?;
        let step = session.apply(event.clone())?;
        expected.push(json!({"ordinal": ordinal, "environment": environment,
            "step": step, "observation": session.observe()?}));
        wire.push(json!({"environment": environment, "event": event}));
    }
    same(&cli.result("batch.events", json!({"batch": "live", "events": wire}))?,
        &json!({"batch": "live", "kernel_version": 7, "results": expected}))
}

fn press(cli: &mut Cli, references: &mut [CurrentGameSession], code: PhysicalKey) -> TestResult {
    events(cli, references, vec![(1, key(code.clone(), true)), (1, key(code, false))])
}

fn selected(session: &CurrentGameSession) -> TestResult<String> {
    Ok(session.observe()?.control.ok_or("control")?.menu.ok_or("menu")?
        .selected_option_id.as_str().to_owned())
}

#[test]
fn actual_current_batch_preserves_order_timers_rollback_and_fork() -> TestResult {
    let content = content()?;
    let mut references = vec![reference(Arc::clone(&content))?, reference(content)?];
    let mut cli = Cli::new(4)?;
    assert_eq!(cli.result("protocol.hello", json!({}))?["backend"], "IN_PROCESS_V7");
    same(&cli.result("batch.create", json!({"batch": "live", "environments": [
        {"environment": 2, "start": start()}, {"environment": 1, "start": start()}]}))?,
        &json!({"batch": "live", "kernel_version": 7, "environments": [1, 2]}))?;
    assert_eq!(references[0].observe()?.control.ok_or("title")?.kind, GameControlKindV2::Title);
    for _ in 0..3 { press(&mut cli, &mut references, PhysicalKey::Space)?; }
    let bound = references[0].observe()?.control.ok_or("starter")?.menu.ok_or("menu")?.options.len() + 1;
    for _ in 0..bound {
        if selected(&references[0])? == "bootstrap/starter/confirm" { break; }
        press(&mut cli, &mut references, PhysicalKey::ArrowDown)?;
    }
    assert_eq!(selected(&references[0])?, "bootstrap/starter/confirm");
    for _ in 0..4 { press(&mut cli, &mut references, PhysicalKey::Space)?; }
    for pending in references[0].snapshot()?.pending_presentations {
        events(&mut cli, &mut references, vec![(1, CurrentExternalEvent::PresentationOutcome {
            event_id: pending.event_id, outcome: KernelPresentationOutcomeV2::Settled })])?;
    }
    assert_eq!(references[0].observe()?.control.ok_or("battle")?.kind, GameControlKindV2::BattleCommand);
    assert_eq!(selected(&references[0])?, "battle/command/fight");
    // An admissible request can still produce an oversized success envelope.
    // Choose the ID from the actual wire length, not a guessed overhead, and
    // independently prove the result would exceed the same 4 MiB JSONL limit.
    let parameters = json!({"batch": "live", "events": [{"environment": 1,
        "event": key(PhysicalKey::ArrowDown, true)}]});
    let empty_request = json!({"protocol_version": 1, "id": "", "method": "batch.events", "params": parameters});
    let long_id = "x".repeat((4 << 20) - serde_json::to_vec(&empty_request)?.len() - 2);
    let mut candidate = references[0].fork()?;
    let step = candidate.apply(key(PhysicalKey::ArrowDown, true))?;
    assert!(!step.effects.is_empty(), "admission witness must stage actual effects");
    assert_ne!(er_canonical::content_digest(&candidate.snapshot()?)?,
        er_canonical::content_digest(&references[0].snapshot()?)?, "admission witness must stage a real state change");
    let success = json!({"protocol_version": 1, "id": long_id, "artifact": null, "error": null,
        "result": {"batch": "live", "kernel_version": 7, "results": [
            {"ordinal": 0, "environment": 1, "step": step, "observation": candidate.observe()?}]}});
    assert!(serde_json::to_vec(&success)?.len() + 1 > 4 << 20, "fixture must overflow the success envelope");
    drop(success);
    drop(candidate);
    let before_envelope = er_canonical::content_digest(&snapshots(&mut cli, "live", &[1, 2])?)?;
    let rejected = cli.request_id("batch.events", parameters, &long_id)?;
    assert!(rejected["result"].is_null(), "oversized success published effects");
    assert_eq!(rejected["error"]["code"], "BACKEND_ERROR");
    assert!(rejected["error"]["message"].as_str().is_some_and(|text| text.contains("success response JSONL")));
    drop(rejected);
    drop(long_id);
    assert_eq!(er_canonical::content_digest(&snapshots(&mut cli, "live", &[1, 2])?)?, before_envelope);
    events(&mut cli, &mut references, vec![(1, key(PhysicalKey::ArrowDown, true))])?;
    assert_eq!(selected(&references[0])?, "battle/command/party");
    events(&mut cli, &mut references, vec![(2, time(7)), (1, time(249))])?;
    assert_eq!(selected(&references[0])?, "battle/command/party");
    events(&mut cli, &mut references, vec![(2, time(11)), (1, time(1)), (2, time(13))])?;
    assert_eq!(selected(&references[0])?, "battle/command/fight");
    // A valid, effectful prefix must not leak when a later known environment rejects malformed material.
    let before = er_canonical::content_digest(&snapshots(&mut cli, "live", &[2, 1, 2])?)?;
    cli.rejects("batch.events", json!({"batch": "live", "events": [
        {"environment": 1, "event": time(250)},
        {"environment": 2, "event": {"kind": "AUTHORITY_MATERIAL", "bytes": [255]}}]}), "event 1")?;
    assert_eq!(er_canonical::content_digest(&snapshots(&mut cli, "live", &[2, 1, 2])?)?, before);
    events(&mut cli, &mut references, vec![(1, time(250)), (2, time(17))])?;
    assert_eq!(selected(&references[0])?, "battle/command/party");
    events(&mut cli, &mut references, vec![(1, time(500)), (1, key(PhysicalKey::ArrowDown, false))])?;
    assert_eq!(selected(&references[0])?, "battle/command/party");
    events(&mut cli, &mut references, vec![(1, time(500))])?;
    assert_eq!(selected(&references[0])?, "battle/command/party");
    same(&snapshots(&mut cli, "live", &[2, 1, 2])?, &json!({"batch": "live", "kernel_version": 7,
        "results": [{"environment": 2, "snapshot": references[1].snapshot()?},
            {"environment": 1, "snapshot": references[0].snapshot()?},
            {"environment": 2, "snapshot": references[1].snapshot()?}]}))?;
    cli.result("batch.fork", json!({"batch": "live", "source_environment": 1, "target_environment": 3}))?;
    let fork = references[0].snapshot()?;
    press(&mut cli, &mut references, PhysicalKey::ArrowDown)?;
    same(&snapshots(&mut cli, "live", &[3])?, &json!({"batch": "live", "kernel_version": 7,
        "results": [{"environment": 3, "snapshot": fork}]}))?;
    cli.result("batch.close", json!({"batch": "live"}))?;
    cli.rejects("batch.snapshot", json!({"batch": "live", "environments": [1]}), "missing or closed")?;
    assert_eq!(cli.result("lab.resources", json!({}))?["total_environments"], 0);
    cli.finish()
}

#[test]
fn actual_current_batch_import_reset_limits_and_global_quota_are_atomic() -> TestResult {
    let content = content()?;
    let mut reference = reference(Arc::clone(&content))?;
    let checkpoint = reference.snapshot()?;
    let mut recorder = CurrentReproRecorderV1::new(checkpoint.clone(), SeatId::new(safe(1)),
        GameKernelRoleV7::Authority, content, CurrentReproLimitsV1::default())?;
    let step = reference.apply(time(37))?;
    let _ = recorder.record(&checkpoint, time(37), Ok(&step), &reference.snapshot()?, &reference.observe()?);
    let capsule = recorder.export()?;
    assert_eq!(capsule.attempts.len(), 1);
    let mut bad = capsule.clone();
    bad.content_identity.bundle_hash =
        er_types::GameContentBundleHash::parse(format!("blake3-v1:{}", "0".repeat(64)))?;
    assert_ne!(bad.content_identity, capsule.content_identity);
    let snapshot_start = json!({"kind": "SNAPSHOT", "snapshot": checkpoint,
        "owner_seat": 1, "role": GameKernelRoleV7::Authority});
    let mut cli = Cli::new(3)?;
    cli.rejects("batch.create", json!({"batch": "imports", "environments": [
        {"environment": 1, "start": snapshot_start},
        {"environment": 2, "start": {"kind": "CAPSULE", "capsule": bad}}]}), "content_identity")?;
    assert_eq!(cli.result("lab.resources", json!({}))?["total_environments"], 0);
    // Reuse the rejected batch ID; replay publishes only creation metadata.
    same(&cli.result("batch.create", json!({"batch": "imports", "environments": [
        {"environment": 1, "start": {"kind": "CAPSULE", "capsule": capsule}},
        {"environment": 2, "start": snapshot_start}]}))?,
        &json!({"batch": "imports", "kernel_version": 7, "environments": [1, 2]}))?;
    let before = snapshots(&mut cli, "imports", &[1, 2])?;
    same(&before["results"][0]["snapshot"], &serde_json::to_value(reference.snapshot()?)?)?;
    cli.rejects("batch.reset", json!({"batch": "imports", "environments": [
        {"environment": 9, "start": start()},
        {"environment": 10, "start": {"kind": "CAPSULE", "capsule": bad}}]}), "content_identity")?;
    same(&snapshots(&mut cli, "imports", &[1, 2])?, &before)?;
    cli.result("session.create", json!({"session": "standalone", "start": snapshot_start}))?;
    cli.rejects("batch.fork", json!({"batch": "imports", "source_environment": 1, "target_environment": 3}), "capacity")?;
    cli.rejects("session.create", json!({"session": "overflow", "start": start()}), "capacity")?;
    assert_eq!(cli.result("lab.resources", json!({}))?["total_environments"], 3);
    cli.result("session.close", json!({"session": "standalone"}))?;
    cli.result("batch.reset", json!({"batch": "imports", "environments": [
        {"environment": 7, "start": {"kind": "CAPSULE", "capsule": capsule}}]}))?;
    let next_step = reference.apply(time(5))?;
    same(&cli.result("batch.advance_time", json!({"batch": "imports", "advances": [
        {"environment": 7, "milliseconds": 5}]}))?, &json!({"batch": "imports", "kernel_version": 7,
        "results": [{"ordinal": 0, "environment": 7, "step": next_step, "observation": reference.observe()?}]}))?;
    same(&cli.result("batch.observe", json!({"batch": "imports", "environments": [7, 7]}))?,
        &json!({"batch": "imports", "kernel_version": 7, "results": [
            {"environment": 7, "observation": reference.observe()?},
            {"environment": 7, "observation": reference.observe()?}]}))?;
    cli.result("batch.create", json!({"batch": "tiny", "limits": {
        "maximum_environments": 1, "maximum_events": 2, "maximum_result_bytes": 2},
        "environments": [{"environment": 1, "start": snapshot_start}]}))?;
    let tiny_before = snapshots(&mut cli, "tiny", &[1])?;
    let input = RawInputEvent::KeyDown { code: PhysicalKey::Space, printable: false,
        browser_repeat: false, focus: InputFocus::Game };
    cli.rejects("batch.raw_input", json!({"batch": "tiny", "inputs": [
        {"environment": 1, "input": input}]}), "results exceed 2 JSON bytes")?;
    same(&snapshots(&mut cli, "tiny", &[1])?, &tiny_before)?;
    cli.result("batch.reset", json!({"batch": "tiny", "environments": [
        {"environment": 1, "start": snapshot_start}]}))?;
    cli.rejects("batch.raw_input", json!({"batch": "tiny", "inputs": [
        {"environment": 1, "input": input}]}), "results exceed 2 JSON bytes")?;
    same(&snapshots(&mut cli, "tiny", &[1])?, &tiny_before)?;
    cli.result("batch.close", json!({"batch": "tiny"}))?;
    cli.result("batch.create", json!({"batch": "tiny", "environments": [
        {"environment": 1, "start": snapshot_start}]}))?;
    // Same rejected action succeeds under a valid bound and advances exactly once.
    let initial = serde_json::from_value(tiny_before["results"][0]["snapshot"].clone())?;
    let mut corrected = CurrentGameSession::from_snapshot(initial, SeatId::new(safe(1)),
        GameKernelRoleV7::Authority, Arc::clone(reference.content()))?;
    let step = corrected.apply(CurrentExternalEvent::RawInput { input: input.clone() })?;
    assert_ne!(er_canonical::content_digest(&corrected.snapshot()?)?,
        er_canonical::content_digest(&tiny_before["results"][0]["snapshot"])?,
        "size-limit witness must stage a real state change");
    same(&cli.result("batch.raw_input", json!({"batch": "tiny", "inputs": [
        {"environment": 1, "input": input}]}))?, &json!({"batch": "tiny", "kernel_version": 7,
        "results": [{"ordinal": 0, "environment": 1, "step": step, "observation": corrected.observe()?}]}))?;
    let raw = RawInputEvent::KeyUp { code: PhysicalKey::Space };
    let step = corrected.apply(CurrentExternalEvent::RawInput { input: raw.clone() })?;
    same(&cli.result("batch.raw_input", json!({"batch": "tiny", "inputs": [
        {"environment": 1, "input": raw}]}))?, &json!({"batch": "tiny", "kernel_version": 7,
        "results": [{"ordinal": 0, "environment": 1, "step": step, "observation": corrected.observe()?}]}))?;
    cli.result("batch.close", json!({"batch": "tiny"}))?;
    cli.result("batch.close", json!({"batch": "imports"}))?;
    assert_eq!(cli.result("lab.resources", json!({}))?["total_environments"], 0);
    cli.finish()
}
