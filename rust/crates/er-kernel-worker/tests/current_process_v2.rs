use std::error::Error;
use std::io::{BufReader, BufWriter};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, mpsc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use er_env::current::CurrentExternalEvent;
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{
    GameKernelEffectV7, GameKernelRoleV7, KernelPresentationOutcomeV2,
};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v6::RestorableKernelSnapshotV6;
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_kernel_worker::{
    KERNEL_WORKER_ABI_VERSION_V2, KernelGenerationIdentityV2, KernelGenerationV1,
    KernelSessionIdV1, KernelWorkerBootstrapV2, KernelWorkerFaultCodeV2,
    KernelWorkerInitializationV2, KernelWorkerRequestEnvelopeV2, KernelWorkerRequestV2,
    KernelWorkerResponseEnvelopeV2, KernelWorkerResponseV2, read_frame_v1, write_frame_v1,
};
use er_types::{
    GameControlKindV2, InputFocus, PhysicalKey, PresentationEventId, RawInputEvent, SafeU53,
    SeatId,
};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

struct WorkerProcess {
    child: Child,
    input: Option<BufWriter<ChildStdin>>,
    output: mpsc::Receiver<Result<KernelWorkerResponseEnvelopeV2, String>>,
    reader: Option<JoinHandle<()>>,
    identity: KernelGenerationIdentityV2,
}

impl WorkerProcess {
    fn spawn(identity: KernelGenerationIdentityV2) -> Result<Self, Box<dyn Error>> {
        let mut child = Command::new(env!("CARGO_BIN_EXE_er-kernel-worker"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;
        let input = child.stdin.take().ok_or("worker stdin missing")?;
        let stdout = child.stdout.take().ok_or("worker stdout missing")?;
        let (sender, output) = mpsc::channel();
        let reader = thread::spawn(move || {
            let mut stdout = BufReader::new(stdout);
            loop {
                match read_frame_v1::<_, KernelWorkerResponseEnvelopeV2>(&mut stdout) {
                    Ok(Some(response)) => {
                        if sender.send(Ok(response)).is_err() {
                            break;
                        }
                    }
                    Ok(None) => break,
                    Err(error) => {
                        let _ = sender.send(Err(error.to_string()));
                        break;
                    }
                }
            }
        });
        let mut process = Self {
            child,
            input: Some(BufWriter::new(input)),
            output,
            reader: Some(reader),
            identity,
        };
        write_frame_v1(
            process.input.as_mut().ok_or("worker stdin missing")?,
            &KernelWorkerBootstrapV2 {
                abi_version: KERNEL_WORKER_ABI_VERSION_V2,
                identity: process.identity.clone(),
            },
        )?;
        Ok(process)
    }

    fn exchange(
        &mut self,
        sequence: u64,
        request: KernelWorkerRequestV2,
    ) -> Result<KernelWorkerResponseEnvelopeV2, Box<dyn Error>> {
        let request_id = sequence + 100;
        let envelope = KernelWorkerRequestEnvelopeV2::new(
            &self.identity,
            request_id,
            sequence,
            request,
        )?;
        write_frame_v1(self.input.as_mut().ok_or("worker stdin missing")?, &envelope)?;
        let response = self.output.recv_timeout(Duration::from_secs(60))??;
        assert_eq!(response.abi_version, KERNEL_WORKER_ABI_VERSION_V2);
        assert_eq!(response.session_id, self.identity.session_id);
        assert_eq!(response.generation, self.identity.generation);
        assert_eq!(response.request_id, request_id);
        Ok(response)
    }

    fn accepted(
        &mut self,
        sequence: u64,
        request: KernelWorkerRequestV2,
    ) -> Result<KernelWorkerResponseV2, Box<dyn Error>> {
        let response = self.exchange(sequence, request)?;
        assert_eq!(response.accepted_sequence, Some(sequence));
        assert!(!matches!(response.response, KernelWorkerResponseV2::Fault(_)));
        Ok(response.response)
    }

    fn snapshot(&mut self, sequence: u64) -> Result<CoreGameKernelSnapshotV7, Box<dyn Error>> {
        match self.accepted(sequence, KernelWorkerRequestV2::Snapshot)? {
            KernelWorkerResponseV2::Snapshot { snapshot } => Ok(*snapshot),
            response => Err(format!("expected V7 snapshot, received {response:?}").into()),
        }
    }

    fn dispose(&mut self, sequence: u64) -> Result<(), Box<dyn Error>> {
        assert!(matches!(
            self.accepted(sequence, KernelWorkerRequestV2::Dispose)?,
            KernelWorkerResponseV2::Disposed
        ));
        // Keep stdin open: Dispose, rather than end-of-file, must terminate the worker.
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(status) = self.child.try_wait()? {
                assert!(status.success());
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err("disposed worker did not exit within five seconds".into());
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for WorkerProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        self.input.take();
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test integer is safe")
}

fn profile_json() -> serde_json::Value {
    serde_json::json!({
        "schema_version": 1,
        "unlocks": [], "achievements": [], "challenges": [], "flags": [],
        "statistics": {
            "runs_started": 0, "runs_won": 0, "runs_lost": 0, "battles_won": 0,
            "pokemon_captured": 0, "highest_wave": 1
        },
        "dex": {"entries": []}
    })
}

fn fixture() -> Result<(GameContentBundleV2, KernelGenerationIdentityV2), Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let prepared = PreparedGameContentV2::prepare(Arc::new(bundle.clone()))?;
    let identity = KernelGenerationIdentityV2 {
        schema_version: 2,
        session_id: KernelSessionIdV1("current-process-v2".to_owned()),
        generation: KernelGenerationV1(1),
        artifact_sha256: "a".repeat(64),
        executable_sha256: "b".repeat(64),
        source_git_sha: "c".repeat(40),
        worker_abi_version: KERNEL_WORKER_ABI_VERSION_V2,
        minimum_snapshot_schema: 7,
        maximum_snapshot_schema: 7,
        content_identity: prepared.identity().clone(),
        build_target: std::env::consts::ARCH.to_owned(),
        build_profile: "test".to_owned(),
    };
    Ok((bundle, identity))
}

fn initialization(bundle: GameContentBundleV2) -> Result<KernelWorkerRequestV2, Box<dyn Error>> {
    Ok(KernelWorkerRequestV2::Initialize {
        content_bundle: Box::new(bundle),
        initialization: Box::new(KernelWorkerInitializationV2::Natural {
            profile: serde_json::from_value(profile_json())?,
            seed: "current-worker-natural".to_owned(),
            local_seat: SeatId::new(safe(1)),
            save_slots: vec!["preview-slot".to_owned()],
            local_is_host: true,
            scheduler: KernelSchedulerSnapshotV2 {
                next_timer_id: Some(SafeU53::ZERO),
                timers: Vec::new(),
                pauses: Vec::new(),
                disposed: false,
            },
            protocol: None,
        }),
    })
}

fn assert_fault(
    response: KernelWorkerResponseEnvelopeV2,
    code: KernelWorkerFaultCodeV2,
    accepted_sequence: Option<u64>,
) {
    assert_eq!(response.accepted_sequence, accepted_sequence);
    assert!(matches!(response.response, KernelWorkerResponseV2::Fault(fault) if fault.code == code));
}

#[test]
fn actual_abi2_process_runs_current_natural_controls_and_non_key_time()
-> Result<(), Box<dyn Error>> {
    let (bundle, identity) = fixture()?;
    let mut worker = WorkerProcess::spawn(identity.clone())?;
    assert!(matches!(
        worker.accepted(0, KernelWorkerRequestV2::Hello)?,
        KernelWorkerResponseV2::Ready(value) if *value == identity
    ));
    let KernelWorkerResponseV2::Initialized { observation } =
        worker.accepted(1, initialization(bundle)?)?
    else {
        return Err("worker did not initialize a current session".into());
    };
    assert_eq!(observation.kernel_version, 7);
    assert_eq!(observation.content_identity, identity.content_identity);
    assert_eq!(observation.control.map(|control| control.kind), Some(GameControlKindV2::Title));
    let response = worker.accepted(2, KernelWorkerRequestV2::Apply(CurrentExternalEvent::RawInput {
        input: RawInputEvent::KeyDown {
            code: PhysicalKey::Enter,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
    }))?;
    let KernelWorkerResponseV2::Effects { step, observation } = response else {
        return Err("worker did not return typed current effects".into());
    };
    assert_eq!(observation.control.map(|control| control.kind), Some(GameControlKindV2::ModeSelect));
    assert!(step.effects.iter().any(|effect| matches!(
        effect,
        GameKernelEffectV7::UiChanged(control) if control.kind == GameControlKindV2::ModeSelect
    )));
    worker.accepted(3, KernelWorkerRequestV2::Apply(CurrentExternalEvent::RawInput {
        input: RawInputEvent::KeyUp { code: PhysicalKey::Enter },
    }))?;
    let before = worker.snapshot(4)?;
    assert_eq!(before.schema_version, 7);
    worker.accepted(5, KernelWorkerRequestV2::Apply(CurrentExternalEvent::AdvanceTime {
        milliseconds: safe(25),
    }))?;
    let after = worker.snapshot(6)?;
    let mut expected = before;
    expected.replay_sequence = safe(expected.replay_sequence.get() + 1);
    assert_eq!(after, expected);
    worker.dispose(7)
}

#[test]
fn actual_abi2_process_rejects_bad_content_events_sequence_and_historical_snapshot()
-> Result<(), Box<dyn Error>> {
    let (bundle, identity) = fixture()?;
    let mut worker = WorkerProcess::spawn(identity.clone())?;
    worker.accepted(0, KernelWorkerRequestV2::Hello)?;
    let mut invalid_bundle = bundle.clone();
    invalid_bundle.schema_version = 1;
    assert_fault(
        worker.exchange(1, initialization(invalid_bundle)?)?,
        KernelWorkerFaultCodeV2::ContentRejected,
        Some(0),
    );
    assert!(matches!(
        worker.accepted(1, initialization(bundle)?)?,
        KernelWorkerResponseV2::Initialized { .. }
    ));
    let before = worker.snapshot(2)?;
    assert_fault(
        worker.exchange(3, KernelWorkerRequestV2::Apply(CurrentExternalEvent::PresentationOutcome {
            event_id: PresentationEventId::new(safe(999)),
            outcome: KernelPresentationOutcomeV2::Settled,
        }))?,
        KernelWorkerFaultCodeV2::KernelFailure,
        Some(2),
    );
    assert_eq!(worker.snapshot(3)?, before);
    assert_fault(
        worker.exchange(5, KernelWorkerRequestV2::Apply(CurrentExternalEvent::AdvanceTime {
            milliseconds: safe(25),
        }))?,
        KernelWorkerFaultCodeV2::ProtocolViolation,
        Some(3),
    );
    assert_eq!(worker.snapshot(4)?, before);

    // A validator-approved historical snapshot, not a V7 object with its version edited.
    let old_identity = serde_json::json!({
        "oracle_sha": identity.content_identity.oracle_sha,
        "content_hash": identity.content_identity.bundle_hash,
        "battle_content_hash": identity.content_identity.battle_hash,
        "semantic_catalog_hash": identity.content_identity.semantic_catalog_hash
    });
    let legacy: RestorableKernelSnapshotV6 = serde_json::from_value(serde_json::json!({
        "schema_version": 6,
        "content_identity": old_identity,
        "game_state": {
            "schema_version": 5,
            "content_identity": old_identity,
            "profile": profile_json(),
            "active_run": null
        },
        "input_router": before.input_router,
        "scheduler": before.scheduler,
        "protocol": null,
        "pending_presentations": [],
        "prepared_transactions": [],
        "replay_sequence": 0,
        "terminal": null,
        "pressed_keys": []
    }))?;
    legacy.validate()?;
    assert_fault(
        worker.exchange(5, KernelWorkerRequestV2::Restore {
            snapshot_bytes: serde_json::to_vec(&legacy)?,
            local_seat: SeatId::new(safe(1)),
            role: GameKernelRoleV7::Authority,
        })?,
        KernelWorkerFaultCodeV2::SnapshotRejected,
        Some(4),
    );
    assert_eq!(worker.snapshot(5)?, before);
    worker.dispose(6)
}
