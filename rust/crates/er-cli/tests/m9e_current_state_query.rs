//! Immutable current state selectors through real native and Worker JSONL backends.
//! Natural bootstrap/Active; separately labeled fresh controlled Terminal fixture.

use std::error::Error;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, OnceLock, mpsc};
use std::time::{Duration, Instant};

use er_env::current::{CurrentExternalEvent, CurrentGameSession};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelRoleV7, KernelPresentationOutcomeV2};
use er_kernel::snapshot_v7::{CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7};
use er_kernel_worker::{
    KERNEL_WORKER_ABI_VERSION_V2, KernelGenerationIdentityV2, KernelGenerationV1, KernelSessionIdV1,
};
use er_lab::kernel_reload::VerifiedKernelExecutableV2;
use er_state::m7_state::{GameStateV5, ProfileStateV1};
use er_types::{
    GameContentIdentity, GameControlKindV2, GameControlPlanV2, InputFocus, PhysicalKey,
    RawInputEvent, SafeU53, SeatId, TerminalState,
};
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;
type Line = Result<Option<Vec<u8>>, String>;
type WriteJob = (Vec<u8>, mpsc::SyncSender<Result<(), String>>);
const SESSION: &str = "current-state-query";
const SEED: &str = "current-state-query";
const LINE_BOUND: usize = 4 << 20;
const RESPONSE_BOUND: usize = 8 << 20;
const QUERY_BOUND: usize = 1 << 20;

fn content_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/m9/engineering/game-content-bundle-v2.json")
}

fn content() -> Arc<PreparedGameContentV2> {
    static CONTENT: OnceLock<Arc<PreparedGameContentV2>> = OnceLock::new();
    Arc::clone(CONTENT.get_or_init(|| {
        let bundle: GameContentBundleV2 =
            serde_json::from_slice(&std::fs::read(content_path()).expect("fixture bytes"))
                .expect("V2 content");
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
    Ok(format!(
        "blake3-v1:{}",
        er_canonical::content_digest(value)?
    ))
}

fn same(actual: &Value, expected: &Value) -> TestResult {
    assert_eq!(
        digest(actual)?,
        digest(expected)?,
        "complete canonical result differs"
    );
    Ok(())
}

fn checkpoint(
    cli: &mut Cli,
    reference: &CurrentGameSession,
    native: bool,
) -> TestResult<(String, Option<Value>)> {
    let snapshot = cli.result("session.snapshot", json!({"session": SESSION}))?;
    same(&snapshot, &serde_json::to_value(reference.snapshot()?)?)?;
    let capture = if native {
        Some(cli.result("session.capsule.status", json!({"session": SESSION}))?)
    } else {
        None
    };
    Ok((digest(&snapshot)?, capture))
}

fn unchanged(cli: &mut Cli, before: &(String, Option<Value>)) -> TestResult {
    assert_eq!(
        digest(&cli.result("session.snapshot", json!({"session": SESSION}))?)?,
        before.0
    );
    if let Some(capture) = &before.1 {
        assert_eq!(
            &cli.result("session.capsule.status", json!({"session": SESSION}))?,
            capture
        );
    }
    Ok(())
}

fn reject(response: &Value, code: &str, message: &str) {
    assert!(
        response["result"].is_null(),
        "rejected query published success"
    );
    assert_eq!(response["error"]["code"], code);
    assert!(
        response["error"]["message"]
            .as_str()
            .is_some_and(|text| text.contains(message)),
        "wrong error category: {}",
        response["error"]
    );
}

fn query_params(query: Value, maximum_bytes: usize) -> Value {
    json!({"session": SESSION, "query": query, "maximum_bytes": maximum_bytes})
}

// The oracle selects actual borrowed snapshot fields and encodes those fields
// directly; it does not call either product query helper to produce expectations.
fn expected_fields(snapshot: &CoreGameKernelSnapshotV7) -> TestResult<Vec<(Value, Vec<u8>)>> {
    let (profile, run, control) = match &snapshot.lifecycle {
        GameKernelLifecycleSnapshotV7::Bootstrap(value) => {
            (&value.profile, None, Some(&value.control))
        }
        GameKernelLifecycleSnapshotV7::Active(state) => (
            &state.profile,
            state.active_run.as_ref(),
            state.active_run.as_ref().map(|run| &run.control),
        ),
        GameKernelLifecycleSnapshotV7::Terminal { state, control, .. } => {
            (&state.profile, state.active_run.as_ref(), Some(control))
        }
    };
    let mut fields = vec![
        (
            json!({"kind": "PROFILE"}),
            er_canonical::canonical_bytes(profile)?,
        ),
        (json!({"kind": "RUN"}), er_canonical::canonical_bytes(&run)?),
    ];
    if let Some(control) = control {
        fields.push((
            json!({"kind": "CONTROL"}),
            er_canonical::canonical_bytes(control)?,
        ));
    }
    if let Some(run) = run {
        let pokemon = run.party.first().ok_or("natural party missing")?;
        fields.extend([
            (
                json!({"kind": "PARTY"}),
                er_canonical::canonical_bytes(&run.party)?,
            ),
            (
                json!({"kind": "POKEMON", "value": pokemon.id}),
                er_canonical::canonical_bytes(pokemon)?,
            ),
            (
                json!({"kind": "BATTLE"}),
                er_canonical::canonical_bytes(&run.battle)?,
            ),
            (
                json!({"kind": "WORLD"}),
                er_canonical::canonical_bytes(&run.world)?,
            ),
            (
                json!({"kind": "PROGRESSION"}),
                er_canonical::canonical_bytes(&run.progression_queue)?,
            ),
            (
                json!({"kind": "SCENARIO"}),
                er_canonical::canonical_bytes(&run.scenario)?,
            ),
        ]);
    }
    Ok(fields)
}

fn query_batch(cli: &mut Cli, reference: &CurrentGameSession, native: bool) -> TestResult {
    let snapshot = reference.snapshot()?;
    let before = checkpoint(cli, reference, native)?;
    if let Some(capture) = &before.1 {
        assert_eq!(
            capture["status"]["kind"], "AVAILABLE",
            "query conservation needs an available capture"
        );
    }
    let lifecycle = match &snapshot.lifecycle {
        GameKernelLifecycleSnapshotV7::Bootstrap(_) => "BOOTSTRAP",
        GameKernelLifecycleSnapshotV7::Active(_) => "ACTIVE",
        GameKernelLifecycleSnapshotV7::Terminal { .. } => "TERMINAL",
    };
    let mut fields = expected_fields(&snapshot)?;
    assert_eq!(fields.len(), if lifecycle == "ACTIVE" { 9 } else { 3 });
    for method in ["state.query", "state.inspect"] {
        for (query, bytes) in &fields {
            assert!(!bytes.is_empty() && bytes.len() <= QUERY_BOUND);
            let expected = json!({"session": SESSION, "kernel_version": 7,
                "content_identity": reference.observe()?.content_identity,
                "lifecycle": lifecycle, "snapshot_digest": before.0,
                "replay_sequence": snapshot.replay_sequence,
                "result": {"query": query, "canonical_bytes": bytes,
                    "digest": digest(&serde_json::from_slice::<Value>(bytes)?)?}});
            same(
                &cli.result(method, query_params(query.clone(), bytes.len()))?,
                &expected,
            )?;
            reject(
                &cli.request(method, query_params(query.clone(), bytes.len() - 1))?,
                "BACKEND_ERROR",
                "bound is invalid",
            );
        }
        fields.reverse();
    }
    if fields.len() == 3 {
        // Bootstrap and the explicit no-run terminal have profile/control but no run.
        for method in ["state.query", "state.inspect"] {
            for query in [
                json!({"kind":"PARTY"}),
                json!({"kind":"POKEMON","value":1}),
                json!({"kind":"BATTLE"}),
                json!({"kind":"WORLD"}),
                json!({"kind":"PROGRESSION"}),
                json!({"kind":"SCENARIO"}),
            ] {
                reject(
                    &cli.request(method, query_params(query, QUERY_BOUND))?,
                    "BACKEND_ERROR",
                    "state query path does not exist",
                );
            }
        }
    }
    unchanged(cli, &before)
}

fn raw(cli: &mut Cli, reference: &mut CurrentGameSession, input: RawInputEvent) -> TestResult {
    let step = reference.apply(CurrentExternalEvent::RawInput {
        input: input.clone(),
    })?;
    same(
        &cli.result(
            "session.raw_input",
            json!({"session": SESSION, "input": input}),
        )?,
        &json!({"step": step, "observation": reference.observe()?}),
    )?;
    same(
        &cli.result("session.snapshot", json!({"session": SESSION}))?,
        &serde_json::to_value(reference.snapshot()?)?,
    )
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

fn drain_presentations(
    cli: &mut Cli,
    reference: &mut CurrentGameSession,
    native: bool,
    settlements: &mut usize,
) -> TestResult {
    let pending = reference.snapshot()?.pending_presentations;
    if !pending.is_empty() && *settlements == 0 {
        assert!(
            matches!(
                reference.snapshot()?.lifecycle,
                GameKernelLifecycleSnapshotV7::Active(_)
            ),
            "positive ownership witness must be current Active"
        );
        // Query successes and failures conserve actual pending ownership before
        // any callback; this is distinct from the short control-query fixture.
        query_batch(cli, reference, native)?;
        assert_eq!(reference.snapshot()?.pending_presentations, pending);
    }
    for _ in 0..32 {
        let Some(pending) = reference.snapshot()?.pending_presentations.first().cloned() else {
            return Ok(());
        };
        let step = reference.apply(CurrentExternalEvent::PresentationOutcome {
            event_id: pending.event_id,
            outcome: KernelPresentationOutcomeV2::Settled,
        })?;
        same(
            &cli.result(
                "session.presentation_settled",
                json!({"session": SESSION, "event_id": pending.event_id,
                "outcome": "SETTLED"}),
            )?,
            &json!({"step": step, "observation": reference.observe()?}),
        )?;
        *settlements += 1;
        same(
            &cli.result("session.snapshot", json!({"session": SESSION}))?,
            &serde_json::to_value(reference.snapshot()?)?,
        )?;
    }
    Err("presentation settlement exceeded bounded fixture work".into())
}

fn press(
    cli: &mut Cli,
    reference: &mut CurrentGameSession,
    code: PhysicalKey,
    native: bool,
    settlements: &mut usize,
) -> TestResult {
    raw(cli, reference, key(code.clone(), true))?;
    raw(cli, reference, key(code, false))?;
    drain_presentations(cli, reference, native, settlements)
}

fn natural_active(cli: &mut Cli, reference: &mut CurrentGameSession, native: bool) -> TestResult {
    let mut settlements = 0;
    drain_presentations(cli, reference, native, &mut settlements)?;
    for _ in 0..3 {
        press(cli, reference, PhysicalKey::Space, native, &mut settlements)?;
    }
    // Setup uses the explicit control-query prerequisite and its real shortest
    // raw-input path. The full starter catalog is larger than 128 options.
    let observation = reference.observe()?;
    let control = observation
        .control
        .as_ref()
        .ok_or("starter control missing")?;
    let menu = control.menu.as_ref().ok_or("starter menu missing")?;
    let before_plan = checkpoint(cli, reference, native)?;
    let planned = cli.result(
        "control.plan_navigation",
        json!({"session":SESSION,
        "expected_menu_instance":menu.instance_id,
        "expected_control_digest":digest(&serde_json::to_value(&observation.control)?)?,
        "target":"bootstrap/starter/confirm", "submit":false, "maximum_events":4096}),
    )?;
    unchanged(cli, &before_plan)?;
    let inputs: Vec<RawInputEvent> = serde_json::from_value(planned["plan"]["events"].clone())?;
    assert!(inputs.len() <= 4096);
    let _ = writeln!(std::io::stderr(), "state-query natural plan: {} events", inputs.len());
    for (index, input) in inputs.into_iter().enumerate() {
        if index % 64 == 0 {
            let _ = writeln!(std::io::stderr(), "state-query natural input {index}");
        }
        raw(cli, reference, input)?;
        drain_presentations(cli, reference, native, &mut settlements)?;
    }
    assert_eq!(
        reference
            .observe()?
            .control
            .as_ref()
            .and_then(|control| control.menu.as_ref())
            .map(|menu| menu.selected_option_id.as_str()),
        Some("bootstrap/starter/confirm"),
        "actual raw setup did not select starter confirmation"
    );
    for _ in 0..4 {
        press(cli, reference, PhysicalKey::Space, native, &mut settlements)?;
    }
    assert!(
        settlements > 0,
        "natural fixture did not exercise real presentation callbacks"
    );
    assert!(reference.snapshot()?.pending_presentations.is_empty());
    assert!(matches!(
        reference.snapshot()?.lifecycle,
        GameKernelLifecycleSnapshotV7::Active(_)
    ));
    assert_eq!(
        reference.observe()?.control.ok_or("battle control")?.kind,
        GameControlKindV2::BattleCommand
    );
    Ok(())
}

fn rejection_batch(cli: &mut Cli, reference: &CurrentGameSession, native: bool) -> TestResult {
    let before = checkpoint(cli, reference, native)?;
    let valid = query_params(json!({"kind":"PROFILE"}), QUERY_BOUND);
    for method in ["state.query", "state.inspect"] {
        cli.result(method, valid.clone())?;
        for (field, value) in [
            ("maximum_bytes", json!(0)),
            ("maximum_bytes", json!(-1)),
            ("maximum_bytes", json!(1.5)),
            ("maximum_bytes", json!(true)),
            ("maximum_bytes", json!(QUERY_BOUND + 1)),
            ("maximum_bytes", json!(u64::MAX)),
            ("session", json!("")),
            ("session", json!("é".repeat(65))),
            ("query", json!({"kind":"PROFILE","ignored":true})),
            ("query", json!({"kind":"PROFILE","value":1})),
            ("query", json!({"kind":"POKEMON","value":true})),
            ("query", json!({"kind":"POKEMON","value":1,"ignored":1})),
            ("query", json!({"kind":"UNKNOWN"})),
            ("query", json!({"kind":"POKEMON","value":-1})),
            (
                "query",
                json!({"kind":"POKEMON","value":9007199254740992_u64}),
            ),
            ("ignored", json!(true)),
        ] {
            let mut bad = valid.clone();
            bad[field] = value;
            reject(&cli.request(method, bad)?, "INVALID_REQUEST", "");
        }
        for field in ["query", "maximum_bytes", "session"] {
            let mut bad = valid.clone();
            bad.as_object_mut().ok_or("params")?.remove(field);
            reject(
                &cli.request(method, bad)?,
                "INVALID_REQUEST",
                "missing field",
            );
        }
        reject(
            &cli.request(
                method,
                query_params(
                    json!({"kind":"POKEMON","value":9007199254740991_u64}),
                    QUERY_BOUND,
                ),
            )?,
            "BACKEND_ERROR",
            "state query path does not exist",
        );
        let duplicate = format!("duplicate-{method}");
        assert!(cli.request_id(method, valid.clone(), &duplicate)?["error"].is_null());
        reject(
            &cli.request_id(method, valid.clone(), &duplicate)?,
            "DUPLICATE_REQUEST",
            "",
        );
        let empty = json!({"protocol_version":1,"id":"","method":method,"params":valid});
        let id = "s".repeat(LINE_BOUND - serde_json::to_vec(&empty)?.len() - 2);
        reject(
            &cli.request_id(method, valid.clone(), &id)?,
            "BACKEND_ERROR",
            "success response JSONL",
        );
    }
    unchanged(cli, &before)
}

fn historical_selector_parity(
    reference: &CurrentGameSession,
    content: &PreparedGameContentV2,
) -> TestResult {
    let snapshot = reference.snapshot()?;
    let GameKernelLifecycleSnapshotV7::Active(state) = &snapshot.lifecycle else {
        return Err("active fixture required".into());
    };
    // Test-only historical selector envelope over real shared profile/run fields.
    // Its identity is not a V2-to-V1 migration or a current execution input.
    let identity = content.identity();
    let mut historical = GameStateV5 {
        schema_version: 5,
        content_identity: GameContentIdentity {
            oracle_sha: identity.oracle_sha.clone(),
            content_hash: identity.bundle_hash.clone(),
            battle_content_hash: identity.battle_hash.clone(),
            semantic_catalog_hash: identity.semantic_catalog_hash.clone(),
        },
        profile: state.profile.clone(),
        active_run: state.active_run.clone(),
    };
    for (selector, bytes) in expected_fields(&snapshot)? {
        let query: er_lab::StateQueryV1 = serde_json::from_value(selector)?;
        let result = er_lab::query_state_v1(&historical, query.clone(), bytes.len())?;
        assert_eq!(result.canonical_bytes, bytes);
        assert_eq!(
            result.digest,
            digest(&serde_json::from_slice::<Value>(&bytes)?)?
        );
        assert_eq!(result.query, query);
        assert_eq!(
            er_lab::query_state_v1(&historical, query.clone(), 0),
            Err(er_lab::LabQueryErrorV1::Invalid)
        );
        assert_eq!(
            er_lab::query_state_v1(&historical, query, bytes.len() - 1),
            Err(er_lab::LabQueryErrorV1::Invalid)
        );
    }
    historical.active_run = None;
    for selector in [
        json!({"kind":"PARTY"}),
        json!({"kind":"POKEMON","value":1}),
        json!({"kind":"BATTLE"}),
        json!({"kind":"CONTROL"}),
        json!({"kind":"WORLD"}),
        json!({"kind":"PROGRESSION"}),
        json!({"kind":"SCENARIO"}),
    ] {
        let query: er_lab::StateQueryV1 = serde_json::from_value(selector)?;
        assert_eq!(
            er_lab::query_state_v1(&historical, query.clone(), 0),
            Err(er_lab::LabQueryErrorV1::Invalid)
        );
        assert_eq!(
            er_lab::query_state_v1(&historical, query, QUERY_BOUND),
            Err(er_lab::LabQueryErrorV1::StatePath)
        );
    }
    assert_eq!(
        er_lab::query_state_v1(&historical, er_lab::StateQueryV1::Run, 4)?.canonical_bytes,
        b"null"
    );
    Ok(())
}

fn controlled_terminal(
    reference: &CurrentGameSession,
    content: Arc<PreparedGameContentV2>,
) -> TestResult<CurrentGameSession> {
    let snapshot = reference.snapshot()?;
    assert!(snapshot.pending_presentations.is_empty() && snapshot.pending_platform.is_empty());
    let GameKernelLifecycleSnapshotV7::Active(mut state) = snapshot.lifecycle else {
        return Err("active fixture required".into());
    };
    // A fresh, explicitly controlled fixture; no old material history is edited
    // or claimed to describe the changed state. This is not a terminal journey.
    state.active_run = None;
    state.validate_with(content.as_ref())?;
    let fresh = CurrentGameSession::from_active(
        state,
        SafeU53::new(1)?,
        SeatId::new(SafeU53::new(1)?),
        GameKernelRoleV7::Authority,
        Arc::clone(&content),
        snapshot.input_router,
        snapshot.scheduler,
        None,
    )?;
    let mut terminal = fresh.snapshot()?;
    assert!(terminal.material_ledger.records.is_empty());
    let GameKernelLifecycleSnapshotV7::Active(state) = terminal.lifecycle.clone() else {
        return Err("fresh active fixture required".into());
    };
    terminal.lifecycle = GameKernelLifecycleSnapshotV7::Terminal {
        state,
        control: GameControlPlanV2 {
            schema_version: er_types::GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
            revision: terminal.material_ledger.next_authority_revision,
            kind: GameControlKindV2::Complete,
            owner_seat: None,
            action_context: None,
            menu: None,
            actionable: false,
        },
        terminal: TerminalState {
            terminal_id: "controlled-query-terminal".to_owned(),
            reason: "CONTROLLED_QUERY_FIXTURE_WITHOUT_RUN".to_owned(),
        },
    };
    terminal.validate(content.as_ref())?;
    let restored = CurrentGameSession::from_snapshot(
        terminal.clone(),
        SeatId::new(SafeU53::new(1)?),
        GameKernelRoleV7::Authority,
        content,
    )?;
    assert_eq!(
        restored.snapshot()?,
        terminal,
        "controlled terminal restore changed the source image"
    );
    assert!(
        restored.observe()?.control.is_none(),
        "snapshot control is distinct from absent run observation"
    );
    Ok(restored)
}

fn exercise_queries(worker: bool) -> TestResult {
    let _ = writeln!(std::io::stderr(), "state-query worker={worker}: prepare content");
    let content = content();
    let mut reference = CurrentGameSession::natural_start(
        serde_json::from_value::<ProfileStateV1>(profile())?,
        SEED.to_owned(),
        SeatId::new(SafeU53::new(1)?),
        vec!["query-slot".to_owned()],
        true,
        Arc::clone(&content),
        None,
    )?;
    let _ = writeln!(std::io::stderr(), "state-query worker={worker}: launch CLI");
    let mut cli = Cli::new(worker, &content)?;
    let hello = cli.result("protocol.hello", json!({}))?;
    assert_eq!(
        hello["backend"],
        if worker { "WORKER_V2" } else { "IN_PROCESS_V7" }
    );
    assert_eq!(hello["capture"]["supported"], !worker);
    cli.result("session.create", json!({"session":SESSION,"start":start()}))?;
    let _ = writeln!(std::io::stderr(), "state-query worker={worker}: queries");
    query_batch(&mut cli, &reference, !worker)?;
    let _ = writeln!(std::io::stderr(), "state-query worker={worker}: natural setup");
    natural_active(&mut cli, &mut reference, !worker)?;
    let _ = writeln!(std::io::stderr(), "state-query worker={worker}: queries");
    query_batch(&mut cli, &reference, !worker)?;
    let _ = writeln!(std::io::stderr(), "state-query worker={worker}: historical parity");
    historical_selector_parity(&reference, &content)?;
    let _ = writeln!(std::io::stderr(), "state-query worker={worker}: rejections");
    rejection_batch(&mut cli, &reference, !worker)?;
    let active_before = checkpoint(&mut cli, &reference, !worker)?;
    reject(
        &cli.request(
            "state.delta",
            query_params(json!({"kind":"RUN"}), QUERY_BOUND),
        )?,
        "BACKEND_ERROR",
        "method state.delta is not implemented by the current V7 adapter",
    );
    assert_eq!(
        digest(&cli.result("session.snapshot", json!({"session":SESSION}))?)?,
        active_before.0
    );
    if !worker {
        assert_eq!(
            active_before.1.as_ref().ok_or("native capture")?["status"]["kind"],
            "AVAILABLE"
        );
        assert_eq!(
            cli.result("session.capsule.status", json!({"session":SESSION}))?["status"]["kind"],
            "UNAVAILABLE"
        );
    }
    let _ = writeln!(std::io::stderr(), "state-query worker={worker}: terminal");
    let terminal = controlled_terminal(&reference, Arc::clone(&content))?;
    cli.result("session.close", json!({"session":SESSION}))?;
    cli.result(
        "session.create",
        json!({"session":SESSION,"start":{"kind":"SNAPSHOT","snapshot":terminal.snapshot()?,
        "owner_seat":1,"role":GameKernelRoleV7::Authority}}),
    )?;
    query_batch(&mut cli, &terminal, !worker)?;
    let terminal_before = checkpoint(&mut cli, &terminal, !worker)?;
    reject(
        &cli.request("state.unimplemented", json!({"session":SESSION}))?,
        "METHOD_NOT_FOUND",
        "unknown agent protocol method",
    );
    assert_eq!(
        digest(&cli.result("session.snapshot", json!({"session":SESSION}))?)?,
        terminal_before.0
    );
    if !worker {
        assert_eq!(
            terminal_before.1.as_ref().ok_or("native capture")?["status"]["kind"],
            "AVAILABLE"
        );
        assert_eq!(
            cli.result("session.capsule.status", json!({"session":SESSION}))?["status"]["kind"],
            "UNAVAILABLE"
        );
    }
    cli.result("session.close", json!({"session":SESSION}))?;
    cli.finish()
}

#[test]
fn current_state_queries_preserve_natural_and_controlled_terminal_snapshots_and_capture()
-> TestResult {
    exercise_queries(false)
}

#[test]
fn worker_state_queries_bind_exact_current_snapshots_and_preserve_rejections() -> TestResult {
    exercise_queries(true)
}

struct IdentityDirectory(PathBuf);
impl Drop for IdentityDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
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
        command
            .args(["agent", "--protocol", "jsonl", "--content"])
            .arg(content_path());
        let identity = if worker {
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
                content_identity: content.identity().clone(),
                build_target: std::env::var("ER_M9E_WORKER_BUILD_TARGET")?,
                build_profile: std::env::var("ER_M9E_WORKER_BUILD_PROFILE")?,
            };
            let artifact = VerifiedKernelExecutableV2::verify(
                executable.parent().ok_or("worker parent")?,
                &executable,
                identity,
            )?;
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_nanos();
            let directory = IdentityDirectory(
                std::env::temp_dir().join(format!("m9e-query-{}-{nonce}", std::process::id())),
            );
            std::fs::create_dir(&directory.0)?;
            let path = directory.0.join("identity.json");
            std::fs::write(&path, serde_json::to_vec(artifact.identity())?)?;
            command
                .arg("--worker-executable")
                .arg(artifact.executable())
                .arg("--worker-root")
                .arg(artifact.allowed_root())
                .arg("--worker-identity")
                .arg(path);
            Some(directory)
        } else {
            None
        };
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
        let mut input = child.stdin.take().ok_or("CLI stdin")?;
        let stdout = child.stdout.take().ok_or("CLI stdout")?;
        let mut stderr = child.stderr.take().ok_or("CLI stderr")?;
        let (input_sender, input_receiver) = mpsc::sync_channel::<WriteJob>(1);
        let writer = std::thread::spawn(move || {
            while let Ok((bytes, completed)) = input_receiver.recv() {
                let result = input
                    .write_all(&bytes)
                    .and_then(|()| input.flush())
                    .map_err(|error| error.to_string());
                let failed = result.is_err();
                let _ = completed.send(result);
                if failed {
                    break;
                }
            }
        });
        let (sender, responses) = mpsc::sync_channel(1);
        let reader = std::thread::spawn(move || {
            let mut output = BufReader::new(stdout);
            loop {
                let mut line = Vec::new();
                let next = match output
                    .by_ref()
                    .take((RESPONSE_BOUND + 1) as u64)
                    .read_until(b'\n', &mut line)
                {
                    Ok(0) => Ok(None),
                    Ok(_) if line.len() > RESPONSE_BOUND || !line.ends_with(b"\n") => {
                        Err("response exceeds bound or is unterminated".to_owned())
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
            _identity: identity,
        })
    }

    fn request(&mut self, method: &str, params: Value) -> TestResult<Value> {
        self.next += 1;
        self.request_id(method, params, &format!("query-{}", self.next))
    }

    fn request_id(&mut self, method: &str, params: Value, id: &str) -> TestResult<Value> {
        let mut bytes = serde_json::to_vec(
            &json!({"protocol_version": 1, "id": id, "method": method, "params": params}),
        )?;
        assert!(bytes.len() < LINE_BOUND);
        bytes.push(b'\n');
        let (sent, completed) = mpsc::sync_channel(1);
        self.input
            .as_ref()
            .ok_or("CLI input")?
            .try_send((bytes, sent))
            .map_err(|_| "CLI writer unavailable")?;
        completed.recv_timeout(Duration::from_secs(60))??;
        let line = self
            .responses
            .as_ref()
            .ok_or("CLI receiver")?
            .recv_timeout(Duration::from_secs(60))??
            .ok_or("unexpected EOF")?;
        let response: Value = serde_json::from_slice(&line)?;
        assert_eq!(response["protocol_version"], 1);
        assert_eq!(response["id"], id);
        Ok(response)
    }

    fn result(&mut self, method: &str, params: Value) -> TestResult<Value> {
        let mut response = self.request(method, params)?;
        assert!(
            response["error"].is_null(),
            "unexpected CLI error: {response}"
        );
        Ok(response.get_mut("result").ok_or("missing result")?.take())
    }

    fn finish(mut self) -> TestResult {
        drop(self.input.take());
        assert!(
            self.responses
                .as_ref()
                .ok_or("CLI receiver")?
                .recv_timeout(Duration::from_secs(5))??
                .is_none(),
            "extra response"
        );
        let started = Instant::now();
        loop {
            if let Some(status) = self.child.try_wait()? {
                assert!(status.success(), "CLI exit: {status}");
                return Ok(());
            }
            if started.elapsed() >= Duration::from_secs(5) {
                return Err("CLI exit deadline".into());
            }
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
            let _ = Command::new("/bin/kill")
                .args(["-KILL", "--", &format!("-{}", self.child.id())])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        let _ = self.child.kill();
        let started = Instant::now();
        while matches!(self.child.try_wait(), Ok(None))
            && started.elapsed() < Duration::from_secs(5)
        {
            std::thread::sleep(Duration::from_millis(10));
        }
        if let Some(writer) = self
            .writer
            .take()
            .filter(std::thread::JoinHandle::is_finished)
        {
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
