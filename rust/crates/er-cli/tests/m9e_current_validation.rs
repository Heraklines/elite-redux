//! Actual normal CLI validator processes, with real current session fixtures.

use std::error::Error;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Arc, OnceLock};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use er_env::current::{CurrentExternalEvent, CurrentGameSession};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelRoleV7, KernelPresentationOutcomeV2};
use er_kernel::snapshot_v7::{CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7};
use er_repro::current::{CurrentCaptureStatusV1, CurrentReproCapsuleV1, CurrentReproErrorV1, CurrentReproLimitsV1, CurrentReproRecorderV1};
use er_save::m9e_save_v2::GameSaveV2;
use er_state::m9e_state_v6::{GameStateV6ContentContext, GameStateV6Error};
use er_types::battle_ids::SpeciesId;
use er_types::{GameContentIdentity, GameControlKindV2, InputFocus, PhysicalKey, RawInputEvent, SafeU53, SeatId};
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;
type ProcessOutput = (ExitStatus, Vec<u8>, Vec<u8>);
static NEXT_FILE: AtomicU64 = AtomicU64::new(0);

fn content_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/m9/engineering/game-content-bundle-v2.json")
}

fn key(code: PhysicalKey, down: bool) -> CurrentExternalEvent {
    CurrentExternalEvent::RawInput { input: if down {
        RawInputEvent::KeyDown { code, printable: false, browser_repeat: false, focus: InputFocus::Game }
    } else { RawInputEvent::KeyUp { code } } }
}

fn press(session: &mut CurrentGameSession, code: PhysicalKey) -> TestResult {
    session.apply(key(code.clone(), true))?;
    session.apply(key(code, false))?;
    Ok(())
}

struct Fixture {
    content: Arc<PreparedGameContentV2>,
    save: GameSaveV2,
    capsule: CurrentReproCapsuleV1,
    replayed: CoreGameKernelSnapshotV7,
}

fn build_fixture() -> TestResult<Fixture> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(&fs::read(content_path())?)?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?);
    let seat = SeatId::new(SafeU53::new(1)?);
    let mut session = CurrentGameSession::natural_start(
        serde_json::from_value(json!({
            "schema_version": 1, "unlocks": [], "achievements": [], "challenges": [], "flags": [],
            "dex": {"entries": []}, "statistics": {
                "runs_started": 0, "runs_won": 0, "runs_lost": 0, "battles_won": 0,
                "pokemon_captured": 0, "highest_wave": 1
            }
        }))?,
        "current-validator-fixture".to_owned(), seat, vec!["preview-slot".to_owned()],
        true, Arc::clone(&content), None,
    )?;
    assert_eq!(session.observe()?.control.ok_or("title")?.kind, GameControlKindV2::Title);
    // Reach the active checkpoint through real controls; this setup is not capsule history.
    for _ in 0..3 { press(&mut session, PhysicalKey::Space)?; }
    let bound = session.observe()?.control.ok_or("starter")?.menu.ok_or("menu")?.options.len() + 1;
    for _ in 0..bound {
        if session.kernel_ref()?.current_control().and_then(|control| control.menu.as_ref())
            .is_some_and(|menu| menu.selected_option_id.as_str() == "bootstrap/starter/confirm")
        { break; }
        press(&mut session, PhysicalKey::ArrowDown)?;
    }
    assert_eq!(session.observe()?.control.ok_or("starter")?.menu.ok_or("menu")?.selected_option_id.as_str(),
        "bootstrap/starter/confirm");
    for _ in 0..4 { press(&mut session, PhysicalKey::Space)?; }
    for pending in session.snapshot()?.pending_presentations {
        session.apply(CurrentExternalEvent::PresentationOutcome {
            event_id: pending.event_id, outcome: KernelPresentationOutcomeV2::Settled,
        })?;
    }
    assert_eq!(session.observe()?.control.ok_or("battle")?.kind, GameControlKindV2::BattleCommand);
    let GameKernelLifecycleSnapshotV7::Active(state) = session.snapshot()?.lifecycle else {
        return Err("real active state missing".into());
    };
    let save = GameSaveV2::new(content.identity().clone(), SafeU53::new(1)?, state)?;
    let mut recorder = CurrentReproRecorderV1::new(
        session.snapshot()?, seat, GameKernelRoleV7::Authority, Arc::clone(&content),
        CurrentReproLimitsV1::default(),
    )?;
    for (event, selected) in [key(PhysicalKey::ArrowDown, true),
        CurrentExternalEvent::AdvanceTime { milliseconds: SafeU53::new(249)? },
        CurrentExternalEvent::AdvanceTime { milliseconds: SafeU53::new(1)? }]
        .into_iter().zip(["battle/command/party", "battle/command/party", "battle/command/fight"])
    {
        let before = session.snapshot()?;
        let step = session.apply(event.clone())?;
        assert_eq!(session.observe()?.control.ok_or("held control")?.menu.ok_or("held menu")?.selected_option_id.as_str(), selected);
        assert!(matches!(recorder.record(&before, event, Ok(&step), &session.snapshot()?, &session.observe()?),
            CurrentCaptureStatusV1::Available { .. }));
    }
    let capsule = recorder.export()?;
    assert_eq!(capsule.base_position, 0);
    assert_eq!(capsule.attempts.len(), 3);
    let replayed = session.snapshot()?;
    Ok(Fixture { content, save, capsule, replayed })
}

fn fixture() -> TestResult<&'static Fixture> {
    static FIXTURE: OnceLock<Result<Fixture, String>> = OnceLock::new();
    FIXTURE.get_or_init(|| build_fixture().map_err(|error| error.to_string()))
        .as_ref().map_err(|error| error.clone().into())
}

struct Files(PathBuf);
impl Files {
    fn new() -> TestResult<Self> {
        let path = std::env::temp_dir().join(format!("m9e-validation-{}-{}",
            std::process::id(), NEXT_FILE.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&path)?;
        Ok(Self(path))
    }
    fn write(&self, name: &str, bytes: &[u8]) -> TestResult<PathBuf> {
        let path = self.0.join(name);
        fs::write(&path, bytes)?;
        Ok(path)
    }
}
impl Drop for Files {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}

struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn read_output(path: &Path) -> TestResult<Vec<u8>> {
    let mut bytes = Vec::new();
    File::open(path)?.take((8 << 20) + 1).read_to_end(&mut bytes)?;
    if bytes.len() > 8 << 20 { return Err("bounded CLI output exceeded".into()); }
    Ok(bytes)
}

fn run(files: &Files, command: &str, options: &[(&str, &Path)])
-> TestResult<ProcessOutput> {
    let id = NEXT_FILE.fetch_add(1, Ordering::Relaxed);
    let stdout = files.0.join(format!("stdout-{id}"));
    let stderr = files.0.join(format!("stderr-{id}"));
    let mut child = Command::new(env!("CARGO_BIN_EXE_er-cli"));
    child.arg(command).arg("--content").arg(content_path());
    for (name, path) in options { child.arg(format!("--{name}")).arg(path); }
    let mut child = Process(child.stdin(Stdio::null())
        .stdout(File::create(&stdout)?).stderr(File::create(&stderr)?).spawn()?);
    let deadline = Instant::now() + Duration::from_secs(120);
    let status = loop {
        if fs::metadata(&stdout)?.len() > 8 << 20 || fs::metadata(&stderr)?.len() > 8 << 20 {
            return Err("validator subprocess output exceeded 8 MiB".into());
        }
        if let Some(status) = child.0.try_wait()? { break status; }
        if Instant::now() >= deadline { return Err("validator subprocess deadline".into()); }
        std::thread::sleep(Duration::from_millis(10));
    };
    Ok((status, read_output(&stdout)?, read_output(&stderr)?))
}

fn success(output: ProcessOutput) -> TestResult<Value> {
    assert!(output.0.success(), "{}", String::from_utf8_lossy(&output.2));
    Ok(serde_json::from_slice(&output.1)?)
}
fn rejected(output: ProcessOutput) {
    assert!(!output.0.success());
    assert!(output.1.is_empty(), "failed validation must not publish success");
    assert!(!output.2.is_empty());
}

fn rejected_with_error(output: ProcessOutput, expected: &str) {
    assert_eq!(String::from_utf8_lossy(&output.2).trim(), expected);
    rejected(output);
}

fn legacy_identity(fixture: &Fixture) -> GameContentIdentity {
    let identity = fixture.content.identity();
    GameContentIdentity {
        oracle_sha: identity.oracle_sha.clone(), content_hash: identity.bundle_hash.clone(),
        battle_content_hash: identity.battle_hash.clone(), semantic_catalog_hash: identity.semantic_catalog_hash.clone(),
    }
}

fn legacy_capsule(fixture: &Fixture) -> TestResult<Vec<u8>> {
    let limits = er_repro::CapsuleLimitsV1 {
        maximum_manifest_bytes: 4 << 20, maximum_blob_count: 4096,
        maximum_blob_bytes: 64 << 20, maximum_total_stored_bytes: 256 << 20,
        maximum_total_decompressed_bytes: 512 << 20,
    };
    let identity = serde_json::from_value(json!({
        "mechanical": { "game_content": legacy_identity(fixture), "protocol_version": "1",
            "game_state_schema": 5, "material_schema": 5, "save_schema": 1, "canonical_model_slots": [] },
        "build": { "kernel_commit": {"kind": "UNKNOWN"}, "cargo_lock_hash": {"kind": "UNKNOWN"},
            "rust_toolchain": {"kind": "UNKNOWN"}, "target_triple": {"kind": "UNKNOWN"},
            "build_profile": {"kind": "UNKNOWN"}, "feature_flags": [] },
        "adapters": { "platform": null, "renderer": null, "asset_pack": null, "model_backends": [] }
    }))?;
    // The compatibility validator checks archive integrity; this is not a legacy replay claim.
    let state = er_state::m7_state::GameStateV5 {
        schema_version: er_state::m7_state::GAME_STATE_SCHEMA_VERSION_V5,
        content_identity: legacy_identity(fixture), profile: fixture.save.state.profile.clone(), active_run: None,
    };
    state.validate()?;
    let capsule = er_repro::ReproCapsuleV1::new(
        er_repro::CapsuleModeV1::SelfContained, identity,
        er_repro::FailureOracleV1::InvariantViolation("compatibility container witness".to_owned()),
        &er_canonical::canonical_bytes(&state)?, b"[]", Vec::new(),
        er_repro::RedactionManifestV1 {
            policy_version: 1, profile: "test".to_owned(), removed_paths: Vec::new(),
            aliased_fields: Vec::new(), omitted_blob_kinds: Vec::new(), retained_sensitive_fields: Vec::new(),
        }, limits,
    )?;
    let bytes = capsule.encode(limits)?;
    er_repro::ReproCapsuleV1::decode(&bytes, limits)?;
    Ok(bytes)
}

#[test]
fn ordinary_validate_save_accepts_v2_and_rejects_legacy_or_wrong_content() -> TestResult {
    let fixture = fixture()?;
    let files = Files::new()?;
    let valid = files.write("current-save.json", &fixture.save.encode()?)?;
    let result = success(run(&files, "validate-save", &[("save", &valid)])?)?;
    assert_eq!(result["valid"], true);
    assert_eq!(result["save_schema_version"], 2);
    assert_eq!(result["kernel_version"], 7);
    assert_eq!(result["validation"], "CANONICAL_SAVE_AND_CURRENT_CONTENT_STATE");
    assert_eq!(result["checksum"], serde_json::to_value(&fixture.save.checksum)?);
    assert_eq!(result["content_identity"], serde_json::to_value(fixture.content.identity())?);
    assert_eq!(result["active_run"], true);

    let mut bytes = fixture.save.encode()?;
    bytes.push(b'\n');
    let noncanonical = files.write("noncanonical.json", &bytes)?;
    rejected(run(&files, "validate-save", &[("save", &noncanonical)])?);
    let mut corrupt = serde_json::to_value(&fixture.save)?;
    corrupt["checksum"] = json!(format!("sha256-v1:{}", "0".repeat(64)));
    let corrupt = files.write("checksum.json", &er_canonical::canonical_bytes(&corrupt)?)?;
    rejected(run(&files, "validate-save", &[("save", &corrupt)])?);
    let mut state = fixture.save.state.clone();
    state.content_identity.bundle_hash = er_types::GameContentBundleHash::parse(format!("blake3-v1:{}", "f".repeat(64)))?;
    let other = GameSaveV2::new(state.content_identity.clone(), fixture.save.generation, state)?;
    other.validate()?;
    let other = files.write("other-content.json", &other.encode()?)?;
    rejected(run(&files, "validate-save", &[("save", &other)])?);
    // Keep the selected identity and a valid checksum. Only content-aware state
    // validation can reject this structurally valid, absent species reference.
    let absent_species = SpeciesId::new(SafeU53::MAX);
    assert!(!fixture.content.has_species_form(absent_species, 0));
    let mut state = fixture.save.state.clone();
    let pokemon = state.active_run.as_mut().ok_or("active save")?.party.first_mut().ok_or("party")?;
    pokemon.species_id = absent_species;
    pokemon.form_index = 0;
    state.validate()?;
    let absent = GameSaveV2::new(fixture.content.identity().clone(), fixture.save.generation, state)?;
    let bytes = absent.encode()?;
    let decoded = GameSaveV2::decode(&bytes)?;
    assert_eq!(&decoded.content_identity, fixture.content.identity());
    assert_eq!(decoded.state.validate_with(fixture.content.as_ref()), Err(GameStateV6Error::Content));
    let absent = files.write("absent-species.json", &bytes)?;
    rejected_with_error(run(&files, "validate-save", &[("save", &absent)])?, "Error: Content");
    let legacy = er_save::GameSaveV1::new(&legacy_identity(fixture), fixture.save.state.profile.clone(), None)?;
    legacy.validate(&legacy_identity(fixture))?;
    let legacy = files.write("legacy-save.json", &er_canonical::canonical_bytes(&legacy)?)?;
    rejected(run(&files, "validate-save", &[("save", &legacy)])?);
    let oversized = files.0.join("oversized-save.json");
    File::create(&oversized)?.set_len((8 << 20) + 1)?;
    rejected_with_error(run(&files, "validate-save", &[("save", &oversized)])?,
        "Error: \"current command input exceeds its byte limit\"");
    Ok(())
}

#[test]
fn ordinary_capsule_validation_replays_current_and_rejects_tampered_or_legacy_input() -> TestResult {
    let fixture = fixture()?;
    let files = Files::new()?;
    let valid = files.write("current-capsule.json", &er_canonical::canonical_bytes(&fixture.capsule)?)?;
    let result = success(run(&files, "capsule-validate", &[("capsule", &valid)])?)?;
    assert_eq!(result["validation"], "ISOLATED_CURRENT_CAPSULE_REPLAY");
    assert_eq!(result["schema_valid"], true);
    assert_eq!(result["replay_valid"], true);
    assert_eq!(result["processed_attempts"], 3);
    assert_eq!(result["snapshot_digest"], fixture.capsule.final_snapshot_digest);
    assert_eq!(serde_json::from_value::<CoreGameKernelSnapshotV7>(result["snapshot"].clone())?, fixture.replayed);
    let replay = success(run(&files, "replay", &[("capsule", &valid)])?)?;
    assert_eq!(replay["snapshot"], result["snapshot"]);
    assert_eq!(replay["observation"], result["observation"]);
    let mut tampered = fixture.capsule.clone();
    tampered.attempts[2].event = CurrentExternalEvent::AdvanceTime { milliseconds: SafeU53::new(2)? };
    tampered.validate(CurrentReproLimitsV1::default())?;
    let tampered = files.write("tampered.json", &er_canonical::canonical_bytes(&tampered)?)?;
    rejected_with_error(run(&files, "capsule-validate", &[("capsule", &tampered)])?,
        &format!("Error: {:?}", CurrentReproErrorV1::Divergence { position: 3, field: "snapshot_digest" }));
    let mut omitted = fixture.capsule.clone();
    drop(omitted.attempts.pop());
    omitted.final_position -= 1;
    omitted.validate(CurrentReproLimitsV1::default())?;
    let omitted = files.write("omitted.json", &er_canonical::canonical_bytes(&omitted)?)?;
    rejected_with_error(run(&files, "capsule-validate", &[("capsule", &omitted)])?,
        &format!("Error: {:?}", CurrentReproErrorV1::Divergence { position: 2, field: "final_snapshot_digest" }));
    let mut wrong = fixture.capsule.clone();
    wrong.content_identity.bundle_hash = er_types::GameContentBundleHash::parse(format!("blake3-v1:{}", "f".repeat(64)))?;
    let wrong = files.write("wrong-content.json", &er_canonical::canonical_bytes(&wrong)?)?;
    rejected(run(&files, "capsule-validate", &[("capsule", &wrong)])?);
    let legacy = files.write("legacy.cap", &legacy_capsule(fixture)?)?;
    rejected(run(&files, "capsule-validate", &[("capsule", &legacy)])?);
    let compatibility = run(&files, "capsule-validate-v1",
        &[("artifact-root", &files.0), ("capsule", Path::new("legacy.cap"))])?;
    assert!(compatibility.0.success(), "{}", String::from_utf8_lossy(&compatibility.2));
    assert!(String::from_utf8_lossy(&compatibility.1).starts_with("valid capsule:"));
    let oversized = files.0.join("oversized-capsule.json");
    File::create(&oversized)?.set_len((4 << 20) + 1)?;
    rejected_with_error(run(&files, "capsule-validate", &[("capsule", &oversized)])?,
        "Error: \"current command input exceeds its byte limit\"");
    let escape = Path::new("../legacy.cap");
    let output = run(&files, "capsule-validate-v1", &[("artifact-root", &files.0), ("capsule", escape)])?;
    let error = String::from_utf8_lossy(&output.2);
    assert!(error.contains("Invalid") || error.contains("invalid") || error.contains("PathEscape") || error.contains("escapes"), "{error}");
    rejected(output);
    Ok(())
}
