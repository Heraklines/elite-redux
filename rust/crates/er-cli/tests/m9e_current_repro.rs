//! Native browser-host export to actual CLI processes; not a Wasm/browser witness.

use std::error::Error;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, OnceLock};

use er_env::current::{CurrentExternalEvent, CurrentGameSession};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::GameKernelRoleV7;
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_kernel_worker::{
    KERNEL_WORKER_ABI_VERSION_V2, KernelGenerationIdentityV2, KernelGenerationV1, KernelSessionIdV1,
};
use er_lab::kernel_reload::VerifiedKernelExecutableV2;
use er_repro::current::CurrentReproCapsuleV1;
use er_state::m7_state::ProfileStateV1;
use er_types::{GameControlKindV2, InputFocus, PhysicalKey, RawInputEvent, SafeU53, SeatId};
use er_web::contracts_v2::{
    BROWSER_WORKER_PROTOCOL_VERSION_V2, BrowserEffectV2, BrowserLifecycleEventV2,
    BrowserPresentationOutcomeV2, BrowserRequestEnvelopeV2, BrowserRequestV2,
    BrowserResponseEnvelopeV2, BrowserResponseV2, BrowserSessionContextV2,
    BrowserSessionInitializationV2,
};
use er_web::host_v2::BrowserKernelHostV2;
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;
const SESSION: &str = "current-repro-import";
const MAX_LINE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe fixture integer")
}
fn content_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/m9/engineering/game-content-bundle-v2.json")
}
fn key(code: PhysicalKey, down: bool) -> RawInputEvent {
    if down {
        RawInputEvent::KeyDown {
            code,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        }
    } else {
        RawInputEvent::KeyUp { code }
    }
}

struct Browser {
    host: BrowserKernelHostV2,
    sequence: u64,
}
impl Browser {
    fn send(&mut self, request: BrowserRequestV2) -> TestResult<BrowserResponseV2> {
        let request = BrowserRequestEnvelopeV2 {
            version: BROWSER_WORKER_PROTOCOL_VERSION_V2,
            request_id: safe(self.sequence + 1),
            sequence: safe(self.sequence),
            request,
        };
        let bytes = self
            .host
            .process_bytes(&er_canonical::canonical_bytes(&request)?)?;
        let response: BrowserResponseEnvelopeV2 = serde_json::from_slice(&bytes)?;
        assert_eq!(response.version, BROWSER_WORKER_PROTOCOL_VERSION_V2);
        assert_eq!(response.request_id, request.request_id);
        assert_eq!(response.accepted_sequence, request.sequence);
        self.sequence += 1;
        assert!(!matches!(
            response.response,
            BrowserResponseV2::Fault { .. }
        ));
        Ok(response.response)
    }
    fn press(&mut self, code: PhysicalKey) -> TestResult {
        self.send(BrowserRequestV2::RawInput {
            event: key(code.clone(), true),
        })?;
        self.send(BrowserRequestV2::RawInput {
            event: key(code, false),
        })?;
        Ok(())
    }
    fn selected(&self) -> TestResult<String> {
        Ok(self
            .host
            .kernel_ref()
            .ok_or("kernel missing")?
            .current_control()
            .ok_or("control missing")?
            .menu
            .as_ref()
            .ok_or("menu missing")?
            .selected_option_id
            .as_str()
            .to_owned())
    }
}

struct Fixture {
    content: Arc<PreparedGameContentV2>,
    capsule: CurrentReproCapsuleV1,
    snapshot: CoreGameKernelSnapshotV7,
}
impl Fixture {
    fn reference(&self) -> TestResult<CurrentGameSession> {
        Ok(CurrentGameSession::from_snapshot(
            self.snapshot.clone(),
            self.capsule.local_seat,
            self.capsule.role,
            Arc::clone(&self.content),
        )?)
    }
    fn summary(&self) -> TestResult<Value> {
        Ok(
            json!({"kernel_version": 7, "processed_attempts": self.capsule.attempts.len(),
            "base_position": self.capsule.base_position, "final_position": self.capsule.final_position,
            "snapshot_digest": self.capsule.final_snapshot_digest, "observation": self.reference()?.observe()?}),
        )
    }
}

fn create_fixture() -> TestResult<Fixture> {
    let bytes = std::fs::read(content_path())?;
    let bundle: GameContentBundleV2 = serde_json::from_slice(&bytes)?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?);
    let mut browser = Browser {
        host: BrowserKernelHostV2::from_bundle_bytes(&bytes)?,
        sequence: 0,
    };
    let profile: ProfileStateV1 = serde_json::from_value(json!({
        "schema_version": 1, "unlocks": [], "achievements": [], "challenges": [], "flags": [],
        "statistics": {"runs_started": 0, "runs_won": 0, "runs_lost": 0, "battles_won": 0,
            "pokemon_captured": 0, "highest_wave": 1}, "dex": {"entries": []}
    }))?;
    assert!(matches!(
        browser.send(BrowserRequestV2::Initialize {
            initialization: Box::new(BrowserSessionInitializationV2::NaturalStart {
                context: BrowserSessionContextV2 {
                    local_seat: SeatId::new(safe(1)),
                    role: GameKernelRoleV7::Authority,
                    scheduler: KernelSchedulerSnapshotV2 {
                        next_timer_id: Some(SafeU53::ZERO),
                        timers: Vec::new(),
                        pauses: Vec::new(),
                        disposed: false
                    },
                    protocol: None,
                },
                profile,
                seed: "current-browser-cli-repro".to_owned(),
                save_slots: vec!["preview-slot".to_owned()],
                local_is_host: true,
                existing_saves: false,
            }),
        })?,
        BrowserResponseV2::Ready
    ));
    assert_eq!(
        browser
            .host
            .kernel_ref()
            .ok_or("kernel")?
            .current_control()
            .ok_or("title")?
            .kind,
        GameControlKindV2::Title
    );
    for _ in 0..3 {
        browser.press(PhysicalKey::Space)?;
    }
    let bound = browser
        .host
        .kernel_ref()
        .ok_or("kernel")?
        .current_control()
        .ok_or("starter")?
        .menu
        .as_ref()
        .ok_or("starter menu")?
        .options
        .len()
        + 1;
    for _ in 0..bound {
        if browser.selected()? == "bootstrap/starter/confirm" {
            break;
        }
        browser.press(PhysicalKey::ArrowDown)?;
    }
    assert_eq!(browser.selected()?, "bootstrap/starter/confirm");
    for _ in 0..4 {
        browser.press(PhysicalKey::Space)?;
    }
    let pending = browser
        .host
        .kernel_ref()
        .ok_or("kernel")?
        .snapshot()?
        .pending_presentations;
    assert!(
        !pending.is_empty(),
        "natural battle emits presentations to acknowledge"
    );
    for presentation in pending {
        browser.send(BrowserRequestV2::PresentationSettled {
            event_id: presentation.event_id,
            outcome: BrowserPresentationOutcomeV2::Settled,
        })?;
    }
    assert_eq!(
        browser
            .host
            .kernel_ref()
            .ok_or("kernel")?
            .current_control()
            .ok_or("battle")?
            .kind,
        GameControlKindV2::BattleCommand
    );
    assert_eq!(browser.selected()?, "battle/command/fight");
    browser.send(BrowserRequestV2::RawInput {
        event: key(PhysicalKey::ArrowDown, true),
    })?;
    assert_eq!(browser.selected()?, "battle/command/party");
    browser.send(BrowserRequestV2::AdvanceTime {
        milliseconds: safe(249),
    })?;
    assert_eq!(browser.selected()?, "battle/command/party");
    browser.send(BrowserRequestV2::AdvanceTime {
        milliseconds: safe(1),
    })?;
    assert_eq!(browser.selected()?, "battle/command/fight");
    browser.send(BrowserRequestV2::RawInput {
        event: key(PhysicalKey::ArrowDown, false),
    })?;
    for event in [
        BrowserLifecycleEventV2::Hidden,
        BrowserLifecycleEventV2::Visible,
    ] {
        browser.send(BrowserRequestV2::Lifecycle { event })?;
    }
    browser.send(BrowserRequestV2::AdvanceTime {
        milliseconds: safe(500),
    })?;
    assert_eq!(browser.selected()?, "battle/command/fight");
    let snapshot = browser.host.kernel_ref().ok_or("kernel")?.snapshot()?;
    assert!(snapshot.scheduler.timers.is_empty());
    let BrowserResponseV2::Effects { batch } = browser.send(BrowserRequestV2::ExportRepro)? else {
        return Err("export returned no typed effects".into());
    };
    let [BrowserEffectV2::CurrentReproReady { capsule_bytes }] = batch.effects.as_slice() else {
        return Err("export did not return exactly the current capsule".into());
    };
    let capsule: CurrentReproCapsuleV1 = serde_json::from_slice(capsule_bytes)?;
    assert_eq!(&er_canonical::canonical_bytes(&capsule)?, capsule_bytes);
    // Production capture may rotate the older natural-start prefix at its bound.
    assert_eq!(
        capsule.final_position,
        capsule.base_position + capsule.attempts.len() as u64
    );
    for milliseconds in [249, 1, 500] {
        assert!(capsule.attempts.iter().any(|attempt| attempt.event
            == CurrentExternalEvent::AdvanceTime {
                milliseconds: safe(milliseconds)
            }));
    }
    for origin in ["browser.lifecycle.HIDDEN", "browser.lifecycle.VISIBLE"] {
        assert!(
            capsule
                .attempts
                .iter()
                .any(|attempt| attempt.origin.as_deref() == Some(origin))
        );
    }
    assert!(capsule.attempts.iter().any(|attempt| matches!(
        attempt.event,
        CurrentExternalEvent::PresentationOutcome { .. }
    )));
    let transport = capsule
        .browser_transport
        .as_ref()
        .ok_or("browser transport missing")?;
    assert_eq!(
        (transport.base_generation, transport.final_generation),
        (safe(1), safe(1))
    );
    assert!(matches!(
        browser.send(BrowserRequestV2::Dispose)?,
        BrowserResponseV2::Disposed
    ));
    Ok(Fixture {
        content,
        capsule,
        snapshot,
    })
}

fn fixture() -> TestResult<&'static Fixture> {
    static FIXTURE: OnceLock<Result<Fixture, String>> = OnceLock::new();
    FIXTURE
        .get_or_init(|| create_fixture().map_err(|error| error.to_string()))
        .as_ref()
        .map_err(|error| error.clone().into())
}

struct TempDirectory(PathBuf);
impl TempDirectory {
    fn new() -> TestResult<Self> {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("m9e-current-repro-{}-{nonce}", std::process::id()));
        std::fs::create_dir(&path)?;
        Ok(Self(path))
    }
}
impl Drop for TempDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct Cli {
    child: Child,
    input: Option<ChildStdin>,
    output: BufReader<ChildStdout>,
    next_id: u64,
    stderr: Option<std::thread::JoinHandle<std::io::Result<Vec<u8>>>>,
}
impl Cli {
    fn spawn(mut command: Command) -> TestResult<Self> {
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        let input = child.stdin.take();
        let output = BufReader::new(child.stdout.take().expect("piped CLI stdout"));
        let mut stderr = child.stderr.take().expect("piped CLI stderr");
        let stderr = std::thread::spawn(move || -> std::io::Result<Vec<u8>> {
            let mut retained = Vec::new();
            let mut buffer = [0_u8; 8192];
            loop {
                let count = stderr.read(&mut buffer)?;
                if count == 0 {
                    break;
                }
                let keep = count.min(MAX_STDERR_BYTES.saturating_sub(retained.len()));
                retained.extend_from_slice(&buffer[..keep]);
            }
            Ok(retained)
        });
        Ok(Self {
            child,
            input,
            output,
            next_id: 0,
            stderr: Some(stderr),
        })
    }
    fn read(&mut self) -> TestResult<Value> {
        let mut line = Vec::new();
        self.output
            .by_ref()
            .take(MAX_LINE_BYTES + 1)
            .read_until(b'\n', &mut line)?;
        assert!(line.len() as u64 <= MAX_LINE_BYTES, "CLI response byte cap");
        assert_eq!(
            line.last(),
            Some(&b'\n'),
            "missing or unterminated CLI response"
        );
        Ok(serde_json::from_slice(&line)?)
    }
    fn request(&mut self, method: &str, params: Value) -> TestResult<Value> {
        let id = format!("repro-{}", self.next_id);
        self.next_id += 1;
        let input = self.input.as_mut().ok_or("CLI input closed")?;
        serde_json::to_writer(
            &mut *input,
            &json!({"protocol_version": 1, "id": id, "method": method, "params": params}),
        )?;
        input.write_all(b"\n")?;
        input.flush()?;
        let response = self.read()?;
        assert_eq!(response["protocol_version"], 1);
        assert_eq!(
            response["id"], id,
            "unsolicited output or response ordering changed"
        );
        Ok(response)
    }
    fn result(&mut self, method: &str, params: Value) -> TestResult<Value> {
        let mut response = self.request(method, params)?;
        assert!(
            response["error"].is_null(),
            "{method} rejected: {}",
            response["error"]
        );
        Ok(response["result"].take())
    }
    fn finish(mut self) -> TestResult {
        drop(self.input.take());
        let mut extra = [0_u8; 1];
        assert_eq!(
            self.output.read(&mut extra)?,
            0,
            "unexpected extra output, including replayed effects"
        );
        let status = self.child.wait()?;
        let stderr = self
            .stderr
            .take()
            .ok_or("stderr reader")?
            .join()
            .map_err(|_| "stderr reader panicked")??;
        assert!(
            status.success(),
            "CLI failed (bounded stderr prefix): {}",
            String::from_utf8_lossy(&stderr)
        );
        Ok(())
    }
}
impl Drop for Cli {
    fn drop(&mut self) {
        drop(self.input.take());
        #[cfg(unix)]
        {
            let _ = Command::new("/bin/kill")
                .args(["-KILL", "--", &format!("-{}", self.child.id())])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(stderr) = self.stderr.take() {
            let _ = stderr.join();
        }
    }
}

fn agent_command() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_er-cli"));
    command
        .args(["agent", "--protocol", "jsonl", "--content"])
        .arg(content_path());
    command
}
fn assert_json(actual: &Value, expected: &Value) -> TestResult {
    assert_eq!(
        er_canonical::content_digest(actual)?,
        er_canonical::content_digest(expected)?,
        "complete canonical JSON differs"
    );
    Ok(())
}
fn import(cli: &mut Cli, fixture: &Fixture) -> TestResult {
    let actual = cli.result(
        "session.from_capsule",
        json!({"session": SESSION, "capsule": fixture.capsule}),
    )?;
    let mut expected = fixture.summary()?;
    expected["session"] = json!(SESSION);
    // Exact shape excludes the historical effect stream: replay is quarantined.
    assert_json(&actual, &expected)?;
    assert_json(
        &cli.result("session.snapshot", json!({"session": SESSION}))?,
        &serde_json::to_value(&fixture.snapshot)?,
    )?;
    assert_json(
        &cli.result("session.observe", json!({"session": SESSION}))?,
        &serde_json::to_value(fixture.reference()?.observe()?)?,
    )
}
fn continue_session(cli: &mut Cli, reference: &mut CurrentGameSession) -> TestResult {
    for event in [
        CurrentExternalEvent::RawInput {
            input: key(PhysicalKey::ArrowDown, true),
        },
        CurrentExternalEvent::AdvanceTime {
            milliseconds: safe(250),
        },
        CurrentExternalEvent::RawInput {
            input: key(PhysicalKey::ArrowDown, false),
        },
    ] {
        let step = reference.apply(event.clone())?;
        assert_json(
            &cli.result(
                "platform.event",
                json!({"session": SESSION, "event": event}),
            )?,
            &json!({"step": step, "observation": reference.observe()?}),
        )?;
        assert_json(
            &cli.result("session.snapshot", json!({"session": SESSION}))?,
            &serde_json::to_value(reference.snapshot()?)?,
        )?;
    }
    assert_eq!(
        reference
            .observe()?
            .control
            .ok_or("control")?
            .menu
            .ok_or("menu")?
            .selected_option_id
            .as_str(),
        "battle/command/fight"
    );
    assert!(reference.snapshot()?.scheduler.timers.is_empty());
    Ok(())
}

#[test]
fn native_browser_capsule_replays_through_actual_cli_and_continues() -> TestResult {
    let fixture = fixture()?;
    let directory = TempDirectory::new()?;
    let path = directory.0.join("browser-current-capsule.json");
    std::fs::write(&path, er_canonical::canonical_bytes(&fixture.capsule)?)?;
    let mut command = Command::new(env!("CARGO_BIN_EXE_er-cli"));
    command
        .args(["replay", "--capsule"])
        .arg(&path)
        .arg("--content")
        .arg(content_path());
    let mut replay = Cli::spawn(command)?;
    drop(replay.input.take());
    let mut expected = fixture.summary()?;
    expected["snapshot"] = serde_json::to_value(&fixture.snapshot)?;
    assert_json(&replay.read()?, &expected)?;
    replay.finish()?;
    let mut cli = Cli::spawn(agent_command())?;
    assert_eq!(
        cli.result("protocol.hello", json!({}))?["backend"],
        "IN_PROCESS_V7"
    );
    import(&mut cli, fixture)?;
    continue_session(&mut cli, &mut fixture.reference()?)?;
    cli.result("session.close", json!({"session": SESSION}))?;
    cli.finish()
}

#[test]
fn actual_worker_capsule_import_rejects_tampering_without_claiming_session_id() -> TestResult {
    let fixture = fixture()?;
    let directory = TempDirectory::new()?;
    let executable = PathBuf::from(std::env::var("ER_M9E_WORKER_EXECUTABLE")?);
    assert!(executable.is_absolute());
    let hash = std::env::var("ER_M9E_WORKER_EXECUTABLE_SHA256")?;
    let identity = KernelGenerationIdentityV2 {
        schema_version: 2,
        session_id: KernelSessionIdV1(SESSION.to_owned()),
        generation: KernelGenerationV1(1),
        artifact_sha256: hash.clone(),
        executable_sha256: hash,
        source_git_sha: std::env::var("ER_M9E_WORKER_SOURCE_SHA")?,
        worker_abi_version: KERNEL_WORKER_ABI_VERSION_V2,
        minimum_snapshot_schema: 7,
        maximum_snapshot_schema: 7,
        content_identity: fixture.content.identity().clone(),
        build_target: std::env::var("ER_M9E_WORKER_BUILD_TARGET")?,
        build_profile: std::env::var("ER_M9E_WORKER_BUILD_PROFILE")?,
    };
    let artifact = VerifiedKernelExecutableV2::verify(
        executable.parent().ok_or("worker parent")?,
        &executable,
        identity,
    )?;
    let identity_path = directory.0.join("worker-identity.json");
    std::fs::write(&identity_path, serde_json::to_vec(artifact.identity())?)?;
    let mut command = agent_command();
    command
        .arg("--worker-executable")
        .arg(artifact.executable())
        .arg("--worker-root")
        .arg(artifact.allowed_root())
        .arg("--worker-identity")
        .arg(identity_path);
    let mut cli = Cli::spawn(command)?;
    assert_eq!(
        cli.result("protocol.hello", json!({}))?["backend"],
        "WORKER_V2"
    );
    for tamper_time in [false, true] {
        let mut bad = fixture.capsule.clone();
        let message = if tamper_time {
            let attempt = bad
                .attempts
                .iter_mut()
                .find(|attempt| {
                    attempt.event
                        == CurrentExternalEvent::AdvanceTime {
                            milliseconds: safe(249),
                        }
                })
                .ok_or("249ms attempt missing")?;
            attempt.event = CurrentExternalEvent::AdvanceTime {
                milliseconds: safe(248),
            };
            "current replay diverged at attempt"
        } else {
            bad.content_identity.bundle_hash =
                er_types::GameContentBundleHash::parse(format!("blake3-v1:{}", "0".repeat(64)))?;
            assert_ne!(bad.content_identity, fixture.capsule.content_identity);
            "content_identity"
        };
        let response = cli.request(
            "session.from_capsule",
            json!({"session": SESSION, "capsule": bad}),
        )?;
        assert_eq!(response["error"]["code"], "BACKEND_ERROR");
        assert!(
            response["error"]["message"]
                .as_str()
                .is_some_and(|text| text.contains(message))
        );
        assert!(response["result"].is_null());
        let missing = cli.request("session.snapshot", json!({"session": SESSION}))?;
        assert_eq!(missing["error"]["code"], "BACKEND_ERROR");
        assert!(
            missing["error"]["message"]
                .as_str()
                .is_some_and(|text| text.contains("missing or closed"))
        );
    }
    import(&mut cli, fixture)?;
    assert_json(
        &cli.result(
            "session.fork",
            json!({"session": SESSION, "target_session": "isolated"}),
        )?,
        &json!({"session": "isolated", "kernel_version": 7}),
    )?;
    continue_session(&mut cli, &mut fixture.reference()?)?;
    assert_json(
        &cli.result("session.snapshot", json!({"session": "isolated"}))?,
        &serde_json::to_value(&fixture.snapshot)?,
    )?;
    for session in ["isolated", SESSION] {
        assert_json(
            &cli.result("session.close", json!({"session": session}))?,
            &json!({"closed": session, "retirement_issue": null}),
        )?;
    }
    cli.finish()
}
