//! Actual current control queries and raw-input plans. Remote execution only.
//! The short natural Title/ModeSelect route does not claim presentation ownership.

use std::error::Error;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, OnceLock, mpsc};
use std::time::{Duration, Instant};

use er_env::current::{CurrentExternalEvent, CurrentGameSession};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel_worker::{KERNEL_WORKER_ABI_VERSION_V2, KernelGenerationIdentityV2, KernelGenerationV1, KernelSessionIdV1};
use er_lab::kernel_reload::VerifiedKernelExecutableV2;
use er_state::m7_state::ProfileStateV1;
use er_types::{GameControlKindV2, InputFocus, PhysicalKey, RawInputEvent, SafeU53, SeatId};
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;
type Line = Result<Option<Vec<u8>>, String>;
type WriteJob = (Vec<u8>, mpsc::SyncSender<Result<(), String>>);
const SESSION: &str = "current-control-query";
const SEED: &str = "current-control-query";
const LINE_BOUND: usize = 4 << 20;
// Error envelopes retain the caller's large ID; use the existing capture-test
// reader cap without changing the product's 4 MiB inline-success admission.
const RESPONSE_BOUND: usize = 8 << 20;

fn content_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/m9/engineering/game-content-bundle-v2.json")
}

fn content() -> Arc<PreparedGameContentV2> {
    static CONTENT: OnceLock<Arc<PreparedGameContentV2>> = OnceLock::new();
    Arc::clone(CONTENT.get_or_init(|| {
        let bundle: GameContentBundleV2 = serde_json::from_slice(&std::fs::read(content_path()).expect("fixture bytes")).expect("V2 content");
        Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle)).expect("prepared V2 fixture"))
    }))
}

fn profile() -> Value {
    json!({"schema_version": 1, "unlocks": [], "achievements": [], "challenges": [], "flags": [],
        "statistics": {"runs_started": 0, "runs_won": 0, "runs_lost": 0, "battles_won": 0,
            "pokemon_captured": 0, "highest_wave": 1}, "dex": {"entries": []}})
}

fn start() -> Value {
    json!({"kind": "NATURAL", "profile": profile(), "seed": SEED, "owner_seat": 1,
        "save_slots": ["query-slot"], "local_is_host": true})
}

fn digest(value: &Value) -> TestResult<String> {
    Ok(format!("blake3-v1:{}", er_canonical::content_digest(value)?))
}

fn same(actual: &Value, expected: &Value) -> TestResult {
    assert_eq!(digest(actual)?, digest(expected)?, "complete canonical result differs");
    Ok(())
}

fn checkpoint(cli: &mut Cli, reference: &CurrentGameSession, native: bool) -> TestResult<(String, Option<Value>)> {
    let snapshot = cli.result("session.snapshot", json!({"session": SESSION}))?;
    same(&snapshot, &serde_json::to_value(reference.snapshot()?)?)?;
    let capture = if native { Some(cli.result("session.capsule.status", json!({"session": SESSION}))?) } else { None };
    Ok((digest(&snapshot)?, capture))
}

fn unchanged(cli: &mut Cli, before: &(String, Option<Value>)) -> TestResult {
    assert_eq!(digest(&cli.result("session.snapshot", json!({"session": SESSION}))?)?, before.0);
    if let Some(capture) = &before.1 {
        assert_eq!(&cli.result("session.capsule.status", json!({"session": SESSION}))?, capture);
    }
    Ok(())
}

fn describe(cli: &mut Cli, reference: &CurrentGameSession) -> TestResult<Value> {
    let observation = reference.observe()?;
    let description = observation.control.as_ref().map(er_lab::describe_control_v1).transpose()?;
    let expected = json!({"session": SESSION, "kernel_version": 7,
        "content_identity": observation.content_identity,
        "control_digest": digest(&serde_json::to_value(&observation.control)?)?, "description": description});
    let actual = cli.result("control.describe", json!({"session": SESSION}))?;
    same(&actual, &expected)?;
    Ok(actual)
}

fn parameters(description: &Value, target: &str, submit: bool, maximum_events: usize) -> Value {
    json!({"session": SESSION, "expected_menu_instance": description["description"]["menu_instance"],
        "expected_control_digest": description["control_digest"], "target": target,
        "submit": submit, "maximum_events": maximum_events})
}

fn raw(cli: &mut Cli, reference: &mut CurrentGameSession, input: RawInputEvent) -> TestResult {
    let step = reference.apply(CurrentExternalEvent::RawInput { input: input.clone() })?;
    same(&cli.result("session.raw_input", json!({"session": SESSION, "input": input}))?,
         &json!({"step": step, "observation": reference.observe()?}))?;
    same(&cli.result("session.snapshot", json!({"session": SESSION}))?, &serde_json::to_value(reference.snapshot()?)?)
}

fn key(code: PhysicalKey, down: bool) -> RawInputEvent {
    if down { RawInputEvent::KeyDown { code, printable: false, browser_repeat: false, focus: InputFocus::Game } }
    else { RawInputEvent::KeyUp { code } }
}

fn reject(response: &Value, code: &str, message: &str) {
    assert!(response["result"].is_null(), "rejected query published success");
    assert_eq!(response["error"]["code"], code);
    assert!(response["error"]["message"].as_str().is_some_and(|text| text.contains(message)), "wrong error category: {response}");
}

fn exercise_queries(worker: bool) -> TestResult {
    let content = content();
    let mut reference = CurrentGameSession::natural_start(
        serde_json::from_value::<ProfileStateV1>(profile())?, SEED.to_owned(), SeatId::new(SafeU53::new(1)?),
        vec!["query-slot".to_owned()], true, Arc::clone(&content), None,
    )?;
    let mut cli = Cli::new(worker, &content)?;
    let hello = cli.result("protocol.hello", json!({}))?;
    assert_eq!(hello["backend"], if worker { "WORKER_V2" } else { "IN_PROCESS_V7" });
    assert_eq!(hello["capture"]["supported"], !worker);
    cli.result("session.create", json!({"session": SESSION, "start": start()}))?;
    let before = checkpoint(&mut cli, &reference, !worker)?;
    let title = describe(&mut cli, &reference)?;
    assert_eq!(title["description"]["kind"], "Title");
    assert_eq!(title["description"]["selected_option"], "bootstrap/title/new-game");
    let title_params = parameters(&title, "bootstrap/title/new-game", true, 2);
    let planned = cli.result("control.plan_navigation", title_params.clone())?;
    assert_eq!(planned["kernel_version"], 7);
    assert_eq!(planned["content_identity"], serde_json::to_value(content.identity())?);
    assert_eq!(planned["control_digest"], title["control_digest"]);
    assert_eq!(planned["plan"]["expected_path"], json!(["bootstrap/title/new-game"]));
    let inputs: Vec<RawInputEvent> = serde_json::from_value(planned["plan"]["events"].clone())?;
    assert_eq!(inputs, vec![key(PhysicalKey::Space, true), key(PhysicalKey::Space, false)]);
    for (field, value) in [("maximum_events", json!(0)), ("maximum_events", json!(4097)),
        ("maximum_events", json!(1.5)), ("submit", json!("true")), ("target", json!("")),
        ("target", json!("é".repeat(129))), ("expected_control_digest", json!("bad")),
        ("expected_menu_instance", json!(-1)), ("unknown", json!(true))] {
        let mut bad = title_params.clone();
        bad[field] = value;
        reject(&cli.request("control.plan_navigation", bad)?, "INVALID_REQUEST", "");
    }
    let mut missing = title_params.clone();
    missing.as_object_mut().ok_or("parameters")?.remove("expected_control_digest");
    reject(&cli.request("control.plan_navigation", missing)?, "INVALID_REQUEST", "missing field");
    reject(&cli.request("control.describe", json!({"session": SESSION, "unknown": true}))?, "INVALID_REQUEST", "unknown field");
    reject(&cli.request("control.describe", json!({"session": "x".repeat(129)}))?, "INVALID_REQUEST", "session");
    let mut stale = title_params.clone();
    stale["expected_control_digest"] = json!(format!("blake3-v1:{}", "0".repeat(64)));
    reject(&cli.request("control.plan_navigation", stale)?, "BACKEND_ERROR", "digest is stale");
    reject(&cli.request("control.plan_navigation", parameters(&title, "unknown-target", false, 4096))?, "BACKEND_ERROR", "hidden, disabled, or unknown");
    reject(&cli.request("control.plan_navigation", parameters(&title, "bootstrap/title/new-game", true, 1))?, "BACKEND_ERROR", "event bound");
    unchanged(&mut cli, &before)?;
    for input in inputs { raw(&mut cli, &mut reference, input)?; }
    assert_eq!(reference.observe()?.control.ok_or("mode control")?.kind, GameControlKindV2::ModeSelect);
    let mode = describe(&mut cli, &reference)?;
    assert_ne!(mode["description"]["menu_instance"], title["description"]["menu_instance"]);
    let mode_before = checkpoint(&mut cli, &reference, !worker)?;
    reject(&cli.request("control.plan_navigation", title_params)?, "BACKEND_ERROR", "digest is stale");
    let target = mode["description"]["selected_option"].as_str().ok_or("selected mode")?.to_owned();
    let mut stale_instance = parameters(&mode, &target, false, 4096);
    stale_instance["expected_menu_instance"] = title["description"]["menu_instance"].clone();
    reject(&cli.request("control.plan_navigation", stale_instance)?, "BACKEND_ERROR", "menu instance is stale");
    unchanged(&mut cli, &mode_before)?;
    raw(&mut cli, &mut reference, key(PhysicalKey::ArrowDown, true))?;
    raw(&mut cli, &mut reference, key(PhysicalKey::ArrowDown, false))?;
    let moved = describe(&mut cli, &reference)?;
    assert_eq!(moved["description"]["menu_instance"], mode["description"]["menu_instance"]);
    assert_ne!(moved["description"]["selected_option"], mode["description"]["selected_option"]);
    assert_ne!(moved["control_digest"], mode["control_digest"]);
    let moved_before = checkpoint(&mut cli, &reference, !worker)?;
    reject(&cli.request("control.plan_navigation", parameters(&mode, &target, false, 4096))?, "BACKEND_ERROR", "digest is stale");
    let back = cli.result("control.plan_navigation", parameters(&moved, &target, false, 4096))?;
    assert_eq!(back["plan"]["expected_path"].as_array().ok_or("path")?.last(), Some(&json!(target)));
    unchanged(&mut cli, &moved_before)?;
    let inputs: Vec<RawInputEvent> = serde_json::from_value(back["plan"]["events"].clone())?;
    assert!(!inputs.is_empty());
    for input in inputs { raw(&mut cli, &mut reference, input)?; }
    let returned = describe(&mut cli, &reference)?;
    assert_eq!(returned["description"]["selected_option"], target);
    assert_eq!(reference.observe()?.control.ok_or("mode")?.kind, GameControlKindV2::ModeSelect);
    assert!(reference.snapshot()?.pending_presentations.is_empty(), "short fixture has no presentation ownership claim");
    let final_before = checkpoint(&mut cli, &reference, !worker)?;
    for (method, params, duplicate_id) in [
        ("control.describe", json!({"session": SESSION}), "same-description"),
        ("control.plan_navigation", parameters(&returned, &target, false, 4096), "same-plan"),
    ] {
        let first = cli.request_id(method, params.clone(), duplicate_id)?;
        assert!(first["error"].is_null());
        assert!(first["result"].is_object());
        reject(&cli.request_id(method, params.clone(), duplicate_id)?, "DUPLICATE_REQUEST", "");
        if !worker {
            let empty = json!({"protocol_version": 1, "id": "", "method": method, "params": params});
            let id = "q".repeat(LINE_BOUND - serde_json::to_vec(&empty)?.len() - 2);
            reject(&cli.request_id(method, params, &id)?, "BACKEND_ERROR", "success response JSONL");
        }
    }
    unchanged(&mut cli, &final_before)?;
    if !worker {
        // The exemption covers only the two supported read-only methods.
        reject(&cli.request("control.unimplemented", json!({"session": SESSION}))?, "METHOD_NOT_FOUND", "unknown agent protocol method");
        assert_eq!(cli.result("session.capsule.status", json!({"session": SESSION}))?["status"]["kind"], "UNAVAILABLE");
    }
    cli.result("session.close", json!({"session": SESSION}))?;
    cli.finish()
}

#[test]
fn current_control_queries_are_read_only_and_plans_drive_natural_raw_input() -> TestResult {
    exercise_queries(false)
}

#[test]
fn worker_control_queries_bind_current_control_and_preserve_rejections() -> TestResult {
    exercise_queries(true)
}

struct IdentityDirectory(PathBuf);
impl Drop for IdentityDirectory {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

/// One bounded response in flight, continuously drained stderr, bounded teardown.
struct Cli {
    child: Child,
    input: Option<mpsc::SyncSender<WriteJob>>,
    writer: Option<std::thread::JoinHandle<()>>,
    responses: Option<mpsc::Receiver<Line>>,
    reader: Option<std::thread::JoinHandle<()>>,
    stderr: Option<std::thread::JoinHandle<Vec<u8>>>,
    next: u64,
    _identity: Option<IdentityDirectory>,
}

impl Cli {
    fn new(worker: bool, content: &PreparedGameContentV2) -> TestResult<Self> {
        let mut command = Command::new(env!("CARGO_BIN_EXE_er-cli"));
        command.args(["agent", "--protocol", "jsonl", "--content"]).arg(content_path());
        let identity = if worker {
            let executable = PathBuf::from(std::env::var("ER_M9E_WORKER_EXECUTABLE")?);
            assert!(executable.is_absolute());
            let hash = std::env::var("ER_M9E_WORKER_EXECUTABLE_SHA256")?;
            let identity = KernelGenerationIdentityV2 {
                schema_version: 2, session_id: KernelSessionIdV1(SESSION.to_owned()), generation: KernelGenerationV1(1),
                artifact_sha256: hash.clone(), executable_sha256: hash,
                source_git_sha: std::env::var("ER_M9E_WORKER_SOURCE_SHA")?, worker_abi_version: KERNEL_WORKER_ABI_VERSION_V2,
                minimum_snapshot_schema: 7, maximum_snapshot_schema: 7, content_identity: content.identity().clone(),
                build_target: std::env::var("ER_M9E_WORKER_BUILD_TARGET")?, build_profile: std::env::var("ER_M9E_WORKER_BUILD_PROFILE")?,
            };
            let artifact = VerifiedKernelExecutableV2::verify(executable.parent().ok_or("worker parent")?, &executable, identity)?;
            let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_nanos();
            let directory = IdentityDirectory(std::env::temp_dir().join(format!("m9e-query-{}-{nonce}", std::process::id())));
            std::fs::create_dir(&directory.0)?;
            let path = directory.0.join("identity.json");
            std::fs::write(&path, serde_json::to_vec(artifact.identity())?)?;
            command.arg("--worker-executable").arg(artifact.executable())
                .arg("--worker-root").arg(artifact.allowed_root()).arg("--worker-identity").arg(path);
            Some(directory)
        } else { None };
        #[cfg(unix)]
        { use std::os::unix::process::CommandExt; command.process_group(0); }
        let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
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
                let next = match output.by_ref().take((RESPONSE_BOUND + 1) as u64).read_until(b'\n', &mut line) {
                    Ok(0) => Ok(None),
                    Ok(_) if line.len() > RESPONSE_BOUND || !line.ends_with(b"\n") => Err("response exceeds bound or is unterminated".to_owned()),
                    Ok(_) => Ok(Some(line)), Err(error) => Err(error.to_string()),
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
        Ok(Self { child, input: Some(input_sender), writer: Some(writer), responses: Some(responses),
            reader: Some(reader), stderr: Some(stderr), next: 0, _identity: identity })
    }

    fn request(&mut self, method: &str, params: Value) -> TestResult<Value> {
        self.next += 1;
        self.request_id(method, params, &format!("query-{}", self.next))
    }

    fn request_id(&mut self, method: &str, params: Value, id: &str) -> TestResult<Value> {
        let mut bytes = serde_json::to_vec(&json!({"protocol_version": 1, "id": id, "method": method, "params": params}))?;
        assert!(bytes.len() < LINE_BOUND);
        bytes.push(b'\n');
        let (sent, completed) = mpsc::sync_channel(1);
        self.input.as_ref().ok_or("CLI input")?.try_send((bytes, sent)).map_err(|_| "CLI writer unavailable")?;
        completed.recv_timeout(Duration::from_secs(60))??;
        let line = self.responses.as_ref().ok_or("CLI receiver")?.recv_timeout(Duration::from_secs(60))??.ok_or("unexpected EOF")?;
        let response: Value = serde_json::from_slice(&line)?;
        assert_eq!(response["protocol_version"], 1);
        assert_eq!(response["id"], id);
        Ok(response)
    }

    fn result(&mut self, method: &str, params: Value) -> TestResult<Value> {
        let mut response = self.request(method, params)?;
        assert!(response["error"].is_null(), "unexpected CLI error: {response}");
        Ok(response.get_mut("result").ok_or("missing result")?.take())
    }

    fn finish(mut self) -> TestResult {
        drop(self.input.take());
        assert!(self.responses.as_ref().ok_or("CLI receiver")?.recv_timeout(Duration::from_secs(5))??.is_none(), "extra response");
        let started = Instant::now();
        loop {
            if let Some(status) = self.child.try_wait()? { assert!(status.success(), "CLI exit: {status}"); return Ok(()); }
            if started.elapsed() >= Duration::from_secs(5) { return Err("CLI exit deadline".into()); }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for Cli {
    fn drop(&mut self) {
        drop(self.responses.take());
        drop(self.input.take());
        #[cfg(unix)]
        {
            let _ = Command::new("/bin/kill").args(["-KILL", "--", &format!("-{}", self.child.id())])
                .stdout(Stdio::null()).stderr(Stdio::null()).status();
        }
        let _ = self.child.kill();
        let started = Instant::now();
        while matches!(self.child.try_wait(), Ok(None)) && started.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(10));
        }
        if let Some(writer) = self.writer.take().filter(std::thread::JoinHandle::is_finished) { let _ = writer.join(); }
        if let Some(reader) = self.reader.take().filter(std::thread::JoinHandle::is_finished) { let _ = reader.join(); }
        if let Some(stderr) = self.stderr.take().filter(std::thread::JoinHandle::is_finished)
            && let Ok(bytes) = stderr.join() && !bytes.is_empty() {
            let _ = std::io::stderr().write_all(&bytes);
        }
    }
}
