//! Actual JSONL CLI and exact-build worker reload witnesses. Run remotely.

use std::error::Error;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;

use er_env::current::{CurrentExternalEvent, CurrentGameSession};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelStepV7, KernelPresentationOutcomeV2};
use er_kernel_worker::{
    KERNEL_WORKER_ABI_VERSION_V2, KernelGenerationIdentityV2, KernelGenerationV1, KernelSessionIdV1,
};
use er_lab::kernel_reload::VerifiedKernelExecutableV2;
use er_state::m7_state::ProfileStateV1;
use er_types::{GameControlKindV2, InputFocus, PhysicalKey, RawInputEvent, SafeU53, SeatId};
use serde_json::{Value, json};

const SESSION: &str = "current-cli-reload";
const SEED: &str = "current-cli-reload";
const MAX_RESPONSE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe test integer")
}

fn content_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/m9/engineering/game-content-bundle-v2.json")
}

fn profile() -> Result<ProfileStateV1, Box<dyn Error>> {
    Ok(serde_json::from_value(json!({
        "schema_version": 1, "unlocks": [], "achievements": [], "challenges": [], "flags": [],
        "statistics": {
            "runs_started": 0, "runs_won": 0, "runs_lost": 0, "battles_won": 0,
            "pokemon_captured": 0, "highest_wave": 1
        }, "dex": {"entries": []}
    }))?)
}

struct Fixture {
    content: Arc<PreparedGameContentV2>,
    executable: PathBuf,
    root: PathBuf,
    identity: KernelGenerationIdentityV2,
}

impl Fixture {
    fn new() -> Result<Self, Box<dyn Error>> {
        let bundle: GameContentBundleV2 = serde_json::from_slice(&std::fs::read(content_path())?)?;
        let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?);
        // All five values are mandatory Cargo-artifact bindings from remote F.
        let executable = PathBuf::from(std::env::var("ER_M9E_WORKER_EXECUTABLE")?);
        assert!(executable.is_absolute(), "worker binding must be absolute");
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
            content_identity: content.identity().clone(),
            build_target: std::env::var("ER_M9E_WORKER_BUILD_TARGET")?,
            build_profile: std::env::var("ER_M9E_WORKER_BUILD_PROFILE")?,
        };
        let root = executable
            .parent()
            .ok_or("worker executable has no parent")?;
        let artifact = VerifiedKernelExecutableV2::verify(root, &executable, identity)?;
        Ok(Self {
            content,
            executable: artifact.executable().to_owned(),
            root: artifact.allowed_root().to_owned(),
            identity: artifact.identity().clone(),
        })
    }

    fn next_identity(&self) -> KernelGenerationIdentityV2 {
        let mut identity = self.identity.clone();
        identity.generation = KernelGenerationV1(2);
        identity
    }
}

struct IdentityDirectory(PathBuf);

impl IdentityDirectory {
    fn new() -> Result<Self, Box<dyn Error>> {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("m9e-cli-reload-{}-{nonce}", std::process::id()));
        std::fs::create_dir(&path)?;
        Ok(Self(path))
    }
}

impl Drop for IdentityDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

enum Expected {
    Exact(Value),
    Fields(Value),
    Error {
        code: &'static str,
        message: &'static str,
    },
}

enum RetainedExpected {
    ExactDigest(String),
    Fields(Value),
    Error {
        code: &'static str,
        message: &'static str,
    },
}

fn result_digest(value: &Value) -> Result<String, Box<dyn Error>> {
    Ok(format!("{:?}", er_canonical::content_digest(value)?))
}

// Reap the CLI and its worker process group even if a response assertion panics.
struct CliProcess {
    child: Child,
    writer: Option<std::thread::JoinHandle<Result<(), String>>>,
    stderr: Option<std::thread::JoinHandle<std::io::Result<Vec<u8>>>>,
}

impl Drop for CliProcess {
    fn drop(&mut self) {
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
        if let Some(writer) = self.writer.take() {
            let _ = writer.join();
        }
        if let Some(stderr) = self.stderr.take() {
            let _ = stderr.join();
        }
    }
}

struct Script {
    requests: Vec<Value>,
    expected: Vec<RetainedExpected>,
    reference: CurrentGameSession,
    frontier: u64,
}

impl Script {
    fn new(fixture: &Fixture) -> Result<Self, Box<dyn Error>> {
        let reference = CurrentGameSession::natural_start(
            profile()?,
            SEED.to_owned(),
            SeatId::new(safe(1)),
            vec!["preview-slot".to_owned()],
            true,
            Arc::clone(&fixture.content),
            None,
        )?;
        let mut script = Self {
            requests: Vec::new(),
            expected: Vec::new(),
            reference,
            frontier: 0,
        };
        script.push(
            "protocol.hello",
            json!({}),
            Expected::Fields(json!({
                "backend": "WORKER_V2", "kernel_version": 7,
                "content_identity": fixture.content.identity()
            })),
        );
        script.push(
            "session.create",
            json!({
                "session": SESSION, "start": {
                    "kind": "NATURAL", "profile": profile()?, "seed": SEED,
                    "owner_seat": 1, "save_slots": ["preview-slot"], "local_is_host": true
                }
            }),
            Expected::Exact(json!({"session": SESSION, "kernel_version": 7})),
        );
        script.snapshot()?;
        Ok(script)
    }

    fn push(&mut self, method: &str, params: Value, expected: Expected) {
        self.requests.push(json!({
            "protocol_version": 1, "id": format!("reload-{}", self.requests.len()),
            "method": method, "params": params
        }));
        self.expected.push(match expected {
            Expected::Exact(value) => RetainedExpected::ExactDigest(
                result_digest(&value).expect("valid finite fixture JSON canonicalizes"),
            ),
            Expected::Fields(value) => RetainedExpected::Fields(value),
            Expected::Error { code, message } => RetainedExpected::Error { code, message },
        });
    }

    fn snapshot(&mut self) -> Result<(), Box<dyn Error>> {
        self.push(
            "session.snapshot",
            json!({"session": SESSION}),
            Expected::Exact(serde_json::to_value(self.reference.snapshot()?)?),
        );
        Ok(())
    }

    fn event(&mut self, event: CurrentExternalEvent) -> Result<GameKernelStepV7, Box<dyn Error>> {
        let step = self.reference.apply(event.clone())?;
        self.push(
            "platform.event",
            json!({"session": SESSION, "event": event}),
            Expected::Exact(
                json!({"step": step.clone(), "observation": self.reference.observe()?}),
            ),
        );
        self.frontier += 1;
        self.snapshot()?;
        Ok(step)
    }

    fn press(&mut self, code: PhysicalKey) -> Result<(), Box<dyn Error>> {
        self.event(key(code.clone(), true))?;
        self.event(key(code, false))?;
        Ok(())
    }

    fn selected(&self) -> Result<String, Box<dyn Error>> {
        Ok(self
            .reference
            .observe()?
            .control
            .ok_or("missing control")?
            .menu
            .ok_or("missing menu")?
            .selected_option_id
            .as_str()
            .to_owned())
    }

    fn reach_battle(&mut self) -> Result<(), Box<dyn Error>> {
        assert_eq!(
            self.reference
                .observe()?
                .control
                .ok_or("title control")?
                .kind,
            GameControlKindV2::Title
        );
        for _ in 0..3 {
            self.press(PhysicalKey::Space)?;
        }
        let bound = self
            .reference
            .observe()?
            .control
            .ok_or("starter control")?
            .menu
            .ok_or("starter menu")?
            .options
            .len()
            + 1;
        for _ in 0..bound {
            if self.selected()? == "bootstrap/starter/confirm" {
                break;
            }
            self.press(PhysicalKey::ArrowDown)?;
        }
        assert_eq!(self.selected()?, "bootstrap/starter/confirm");
        for _ in 0..4 {
            self.press(PhysicalKey::Space)?;
        }
        for pending in self.reference.snapshot()?.pending_presentations {
            self.event(CurrentExternalEvent::PresentationOutcome {
                event_id: pending.event_id,
                outcome: KernelPresentationOutcomeV2::Settled,
            })?;
        }
        assert_eq!(
            self.reference
                .observe()?
                .control
                .ok_or("battle control")?
                .kind,
            GameControlKindV2::BattleCommand
        );
        assert_eq!(self.selected()?, "battle/command/fight");
        Ok(())
    }

    fn begin(&mut self, fixture: &Fixture) {
        self.push(
            "session.reload",
            json!({"session": SESSION, "action": "begin"}),
            Expected::Exact(
                json!({"ticket": 1, "frontier": self.frontier, "identity": fixture.identity}),
            ),
        );
    }

    fn activate(&mut self, fixture: &Fixture, replayed: u64) {
        self.push(
            "session.reload",
            json!({
                "session": SESSION, "action": "activate", "ticket": 1,
                "executable": fixture.executable, "identity": fixture.next_identity()
            }),
            Expected::Exact(json!({
                "previous_identity": fixture.identity, "active_identity": fixture.next_identity(),
                "frontier": self.frontier, "replayed_events": replayed, "retirement_issue": null
            })),
        );
    }

    fn close(&mut self, session: &str) {
        self.push(
            "session.close",
            json!({"session": session}),
            Expected::Exact(json!({"closed": session, "retirement_issue": null})),
        );
    }

    fn run(self, fixture: &Fixture) -> Result<(), Box<dyn Error>> {
        let directory = IdentityDirectory::new()?;
        let identity_path = directory.0.join("identity.json");
        std::fs::write(&identity_path, serde_json::to_vec(&fixture.identity)?)?;
        // Cargo supplies the CLI binary; the worker path is separately bound by F.
        let mut command = Command::new(env!("CARGO_BIN_EXE_er-cli"));
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let child = command
            .args(["agent", "--protocol", "jsonl", "--content"])
            .arg(content_path())
            .arg("--worker-executable")
            .arg(&fixture.executable)
            .arg("--worker-root")
            .arg(&fixture.root)
            .arg("--worker-identity")
            .arg(identity_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        let mut process = CliProcess {
            child,
            writer: None,
            stderr: None,
        };
        let mut input = process.child.stdin.take().ok_or("CLI stdin missing")?;
        let mut stdout = BufReader::new(process.child.stdout.take().ok_or("CLI stdout missing")?);
        let mut stderr = process.child.stderr.take().ok_or("CLI stderr missing")?;
        process.stderr = Some(std::thread::spawn(move || -> std::io::Result<Vec<u8>> {
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
        }));
        let Self {
            requests,
            expected,
            reference,
            ..
        } = self;
        drop(reference);
        let methods: Vec<String> = requests
            .iter()
            .map(|request| {
                request["method"]
                    .as_str()
                    .expect("script method")
                    .to_owned()
            })
            .collect();
        process.writer = Some(std::thread::spawn(move || -> Result<(), String> {
            for request in requests {
                serde_json::to_writer(&mut input, &request).map_err(|error| error.to_string())?;
                input.write_all(b"\n").map_err(|error| error.to_string())?;
            }
            Ok(())
        }));
        let mut line = Vec::new();
        for (index, (method, expected)) in methods.iter().zip(&expected).enumerate() {
            line.clear();
            let count = stdout
                .by_ref()
                .take(MAX_RESPONSE_BYTES + 1)
                .read_until(b'\n', &mut line)?;
            assert!(count > 0, "missing response {index} ({method})");
            assert!(
                line.len() as u64 <= MAX_RESPONSE_BYTES,
                "response {index} ({method}) exceeds byte cap"
            );
            assert_eq!(
                line.last(),
                Some(&b'\n'),
                "unterminated response {index} ({method})"
            );
            let response: Value = serde_json::from_slice(&line)?;
            assert_eq!(response["protocol_version"], 1);
            assert_eq!(response["id"], format!("reload-{index}"));
            match expected {
                RetainedExpected::Error { code, message } => {
                    assert!(
                        response["error"].is_object(),
                        "expected rejection: {index} ({method})"
                    );
                    assert_eq!(
                        response["error"]["code"], *code,
                        "request: {index} ({method})"
                    );
                    assert!(
                        response["error"]["message"]
                            .as_str()
                            .is_some_and(|text| text.contains(*message)),
                        "wrong rejection category: {index} ({method})"
                    );
                    assert!(response["result"].is_null());
                }
                RetainedExpected::ExactDigest(expected) => {
                    assert!(
                        response["error"].is_null(),
                        "request rejected: {index} ({method})"
                    );
                    assert_eq!(
                        &result_digest(&response["result"])?,
                        expected,
                        "full canonical result differs: {index} ({method})"
                    );
                }
                RetainedExpected::Fields(expected) => {
                    assert!(
                        response["error"].is_null(),
                        "request rejected: {index} ({method})"
                    );
                    for (key, value) in expected.as_object().ok_or("expected fields missing")? {
                        assert_eq!(
                            &response["result"][key], value,
                            "request: {index} ({method})"
                        );
                    }
                }
            }
        }
        let mut extra = [0_u8; 1];
        assert_eq!(
            stdout.read(&mut extra)?,
            0,
            "extra JSONL response or trailing output"
        );
        let status = process.child.wait()?;
        let write_result = process
            .writer
            .take()
            .ok_or("CLI writer missing")?
            .join()
            .map_err(|_| "CLI writer panicked")?;
        let diagnostic = process
            .stderr
            .take()
            .ok_or("CLI stderr reader missing")?
            .join()
            .map_err(|_| "CLI stderr reader panicked")??;
        assert!(
            status.success(),
            "CLI failed (stderr prefix, capped at {MAX_STDERR_BYTES} bytes): {}",
            String::from_utf8_lossy(&diagnostic)
        );
        write_result?;
        Ok(())
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

fn time(milliseconds: u64) -> CurrentExternalEvent {
    CurrentExternalEvent::AdvanceTime {
        milliseconds: safe(milliseconds),
    }
}

#[test]
fn actual_worker_cli_reload_replays_held_timer_tail_and_preserves_failed_ticket()
-> Result<(), Box<dyn Error>> {
    let fixture = Fixture::new()?;
    let mut script = Script::new(&fixture)?;
    script.reach_battle()?;
    script.begin(&fixture);
    let base = script.frontier;
    script.event(key(PhysicalKey::ArrowDown, true))?;
    assert_eq!(script.selected()?, "battle/command/party");
    assert!(script.event(time(249))?.effects.is_empty());
    assert_eq!(script.selected()?, "battle/command/party");
    assert!(!script.event(time(1))?.effects.is_empty());
    assert_eq!(script.selected()?, "battle/command/fight");
    script.event(time(500))?;
    assert_eq!(script.selected()?, "battle/command/fight");
    assert_eq!(script.frontier, base + 4);
    assert_eq!(
        script.reference.snapshot()?.scheduler.timers[0].remaining_active_ms,
        safe(250)
    );
    script.push(
        "session.reload",
        json!({
            "session": SESSION, "action": "activate", "ticket": 1,
            "executable": fixture.executable, "identity": fixture.identity
        }),
        Expected::Error {
            code: "BACKEND_ERROR",
            message: "generation must increase",
        },
    );
    script.snapshot()?;
    // A rejected generation must retain ticket 1 and the complete active state.
    script.activate(&fixture, 4);
    script.snapshot()?;
    assert!(!script.event(time(250))?.effects.is_empty());
    assert_eq!(script.selected()?, "battle/command/party");
    script.event(key(PhysicalKey::ArrowDown, false))?;
    assert!(script.reference.snapshot()?.scheduler.timers.is_empty());
    assert!(script.event(time(500))?.effects.is_empty());
    script.push(
        "session.reload",
        json!({
            "session": SESSION, "action": "activate", "ticket": 1,
            "executable": fixture.executable, "identity": fixture.next_identity()
        }),
        Expected::Error {
            code: "INVALID_REQUEST",
            message: "no pending reload ticket",
        },
    );
    script.snapshot()?;
    script.close(SESSION);
    script.run(&fixture)
}

#[test]
fn actual_worker_cli_rejects_bad_artifacts_then_forks_and_restores() -> Result<(), Box<dyn Error>> {
    let fixture = Fixture::new()?;
    let mut script = Script::new(&fixture)?;
    script.begin(&fixture);
    let mut wrong_hash = fixture.next_identity();
    wrong_hash.executable_sha256 = "0".repeat(64);
    for (params, expected) in [
        (
            json!({"session": SESSION, "action": "activate", "ticket": 999,
            "executable": fixture.executable, "identity": fixture.next_identity()}),
            Expected::Error {
                code: "INVALID_REQUEST",
                message: "stale reload ticket",
            },
        ),
        (
            json!({"session": SESSION, "action": "activate", "ticket": 1,
            "executable": fixture.executable, "identity": wrong_hash}),
            Expected::Error {
                code: "BACKEND_ERROR",
                message: "executable digest differs from expected identity",
            },
        ),
        (
            json!({"session": SESSION, "action": "activate", "ticket": 1,
            "executable": fixture.root.join("missing-reload-worker"), "identity": fixture.next_identity()}),
            Expected::Error {
                code: "BACKEND_ERROR",
                message: "current worker artifact rejected",
            },
        ),
    ] {
        script.push("session.reload", params, expected);
        script.snapshot()?;
    }
    script.activate(&fixture, 0);
    let initial = script.reference.snapshot()?;
    script.push(
        "session.fork",
        json!({"session": SESSION, "target_session": "forked"}),
        Expected::Exact(json!({"session": "forked", "kernel_version": 7})),
    );
    script.press(PhysicalKey::Space)?;
    script.push(
        "session.snapshot",
        json!({"session": "forked"}),
        Expected::Exact(serde_json::to_value(&initial)?),
    );
    // Begin(1) and successful activation consumed IDs 1 and 2. Failed
    // activations did not consume an ID, so this pending ticket is exactly 3.
    script.push(
        "session.reload",
        json!({"session": SESSION, "action": "begin"}),
        Expected::Exact(json!({"ticket": 3, "frontier": script.frontier,
            "identity": fixture.next_identity()})),
    );
    script.push(
        "session.restore",
        json!({"session": SESSION, "snapshot": initial}),
        Expected::Exact(json!({"restored": true, "kernel_version": 7, "retirement_issue": null})),
    );
    script.reference.restore(initial)?;
    script.frontier = 0;
    let mut restored_identity = fixture.next_identity();
    restored_identity.generation = KernelGenerationV1(3);
    let mut later_identity = restored_identity.clone();
    later_identity.generation = KernelGenerationV1(4);
    script.push(
        "session.reload",
        json!({
            "session": SESSION, "action": "activate", "ticket": 3,
            "executable": fixture.executable, "identity": later_identity
        }),
        Expected::Error {
            code: "INVALID_REQUEST",
            message: "no pending reload ticket",
        },
    );
    script.snapshot()?;
    script.push(
        "session.reload",
        json!({"session": SESSION, "action": "begin"}),
        Expected::Exact(json!({"ticket": 4, "frontier": 0, "identity": restored_identity})),
    );
    script.snapshot()?;
    script.press(PhysicalKey::Space)?;
    script.close("forked");
    script.push(
        "session.observe",
        json!({"session": "forked"}),
        Expected::Error {
            code: "BACKEND_ERROR",
            message: "current session missing or closed",
        },
    );
    script.close(SESSION);
    script.run(&fixture)
}
