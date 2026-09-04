use std::error::Error;
use std::path::PathBuf;
use std::sync::Arc;

use er_env::current::{CurrentExternalEvent, CurrentGameSession};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelRoleV7, KernelPresentationOutcomeV2};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel_worker::{
    KERNEL_WORKER_ABI_VERSION_V2, KernelGenerationIdentityV2, KernelGenerationV1,
    KernelSessionIdV1, KernelWorkerFaultCodeV2, KernelWorkerInitializationV2,
};
use er_lab::kernel_reload::{
    ChildKernelGenerationV2, KernelEndpointErrorV2, VerifiedKernelExecutableV2,
};
use er_state::m7_state::ProfileStateV1;
use er_types::{InputFocus, PhysicalKey, PresentationEventId, RawInputEvent, SafeU53, SeatId};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");
const SEED: &str = "current-lab-endpoint";

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test integer is safe")
}

fn seat() -> SeatId {
    SeatId::new(safe(1))
}

fn profile() -> Result<ProfileStateV1, Box<dyn Error>> {
    Ok(serde_json::from_value(serde_json::json!({
        "schema_version": 1,
        "unlocks": [], "achievements": [], "challenges": [], "flags": [],
        "statistics": {
            "runs_started": 0, "runs_won": 0, "runs_lost": 0, "battles_won": 0,
            "pokemon_captured": 0, "highest_wave": 1
        },
        "dex": {"entries": []}
    }))?)
}

fn natural() -> Result<KernelWorkerInitializationV2, Box<dyn Error>> {
    Ok(KernelWorkerInitializationV2::Natural {
        profile: Box::new(profile()?),
        seed: SEED.to_owned(),
        local_seat: seat(),
        save_slots: Vec::new(),
        local_is_host: true,
        scheduler: KernelSchedulerSnapshotV2 {
            next_timer_id: Some(SafeU53::ZERO),
            timers: Vec::new(),
            pauses: Vec::new(),
            disposed: false,
        },
        protocol: Box::new(None),
    })
}

fn fixture() -> Result<(GameContentBundleV2, VerifiedKernelExecutableV2), Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = PreparedGameContentV2::prepare(Arc::new(bundle.clone()))?;
    // Mandatory exact-build metadata comes from Cargo artifact discovery in remote F.
    // Missing metadata is a failure, never a skipped test or guessed target path.
    let executable = PathBuf::from(std::env::var("ER_M9E_WORKER_EXECUTABLE")?);
    let executable_hash = std::env::var("ER_M9E_WORKER_EXECUTABLE_SHA256")?;
    let identity = KernelGenerationIdentityV2 {
        schema_version: 2,
        session_id: KernelSessionIdV1("current-lab-endpoint".to_owned()),
        generation: KernelGenerationV1(1),
        // This cut references one verified executable directly, without an archive.
        artifact_sha256: executable_hash.clone(),
        executable_sha256: executable_hash,
        source_git_sha: std::env::var("ER_M9E_WORKER_SOURCE_SHA")?,
        worker_abi_version: KERNEL_WORKER_ABI_VERSION_V2,
        minimum_snapshot_schema: 7,
        maximum_snapshot_schema: 7,
        content_identity: content.identity().clone(),
        build_target: std::env::var("ER_M9E_WORKER_BUILD_TARGET")?,
        build_profile: std::env::var("ER_M9E_WORKER_BUILD_PROFILE")?,
    };
    let root = executable.parent().ok_or("worker executable has no parent")?;
    let artifact = VerifiedKernelExecutableV2::verify(root, &executable, identity)?;
    Ok((bundle, artifact))
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

#[test]
fn verified_current_endpoint_matches_session_and_restores_a_second_process()
-> Result<(), Box<dyn Error>> {
    let (bundle, artifact) = fixture()?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle.clone()))?);
    let mut reference = CurrentGameSession::natural_start(
        profile()?, SEED.to_owned(), seat(), Vec::new(), true, content, None,
    )?;
    let mut active = ChildKernelGenerationV2::spawn(&artifact)?;
    assert_eq!(active.identity(), artifact.identity());
    assert_eq!(active.accepted_sequence(), Some(0));
    assert_eq!(active.initialize(bundle.clone(), natural()?)?, reference.observe()?);

    for event in [
        key(PhysicalKey::Enter, true),
        key(PhysicalKey::Enter, false),
        CurrentExternalEvent::AdvanceTime { milliseconds: safe(25) },
    ] {
        let step = reference.apply(event.clone())?;
        let actual = active.apply(event)?;
        assert_eq!(actual.step, step);
        assert_eq!(actual.observation, reference.observe()?);
        assert_eq!(active.snapshot()?, reference.snapshot()?);
    }
    let checkpoint = active.snapshot()?;
    let before_sequence = active.accepted_sequence();
    let before_health = active.health()?;
    let fault_sequence = active.accepted_sequence();
    let error = active.apply(CurrentExternalEvent::PresentationOutcome {
        event_id: PresentationEventId::new(safe(999)),
        outcome: KernelPresentationOutcomeV2::Settled,
    });
    assert!(matches!(error, Err(KernelEndpointErrorV2::Fault(fault))
        if fault.code == KernelWorkerFaultCodeV2::KernelFailure));
    assert_eq!(active.accepted_sequence(), fault_sequence);
    assert!(!active.is_fenced());
    assert_eq!(active.snapshot()?, checkpoint);
    assert_eq!(active.health()?.applied_events, before_health.applied_events);
    assert!(active.accepted_sequence() > before_sequence);

    let mut identity = artifact.identity().clone();
    identity.generation = KernelGenerationV1(2);
    let replacement_artifact = VerifiedKernelExecutableV2::verify(
        artifact.allowed_root(), artifact.executable(), identity,
    )?;
    let mut replacement = ChildKernelGenerationV2::spawn(&replacement_artifact)?;
    assert_ne!(active.process_id(), replacement.process_id());
    replacement.initialize(bundle, natural()?)?;
    assert_eq!(replacement.restore(
        serde_json::to_vec(&checkpoint)?, seat(), GameKernelRoleV7::Authority,
    )?, reference.observe()?);
    assert_eq!(replacement.snapshot()?, checkpoint);

    for event in [
        CurrentExternalEvent::AdvanceTime { milliseconds: safe(17) },
        key(PhysicalKey::ArrowDown, true),
        key(PhysicalKey::ArrowDown, false),
    ] {
        let expected_step = reference.apply(event.clone())?;
        let expected_observation = reference.observe()?;
        let original = active.apply(event.clone())?;
        let restored = replacement.apply(event)?;
        assert_eq!(original.step, expected_step);
        assert_eq!(restored.step, expected_step);
        assert_eq!(original.observation, expected_observation);
        assert_eq!(restored.observation, expected_observation);
        assert_eq!(active.snapshot()?, reference.snapshot()?);
        assert_eq!(replacement.snapshot()?, reference.snapshot()?);
    }
    active.dispose()?;
    replacement.dispose()?;
    assert!(active.is_disposed());
    assert!(replacement.is_disposed());
    assert!(active.observe().is_err());
    Ok(())
}

#[test]
fn current_executable_reference_rejects_wrong_hash_and_root_escape()
-> Result<(), Box<dyn Error>> {
    let (_, artifact) = fixture()?;
    let mut incorrect = artifact.identity().clone();
    incorrect.executable_sha256 = "0".repeat(64);
    assert!(matches!(VerifiedKernelExecutableV2::verify(
        artifact.allowed_root(), artifact.executable(), incorrect,
    ), Err(KernelEndpointErrorV2::Artifact(_))));
    // An existing directory outside the permitted executable directory is enough
    // to test containment; no executable copies or synthetic payloads are needed.
    let unrelated = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    assert!(matches!(VerifiedKernelExecutableV2::verify(
        unrelated, artifact.executable(), artifact.identity().clone(),
    ), Err(KernelEndpointErrorV2::Artifact(_))));
    Ok(())
}
