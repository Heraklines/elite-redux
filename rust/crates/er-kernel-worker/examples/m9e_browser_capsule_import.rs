//! Remote witness: a real browser capsule crosses the separate native worker
//! content and repro frames, preserves its final snapshot, and can continue.

use std::error::Error;
use std::fs;
use std::path::Path;
use std::sync::Arc;

use er_env::current::CurrentExternalEvent;
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_kernel_worker::{
    KERNEL_WORKER_ABI_VERSION_V2, KernelGenerationIdentityV2, KernelGenerationV1,
    KernelSessionIdV1, KernelWorkerInitializationV2, KernelWorkerRequestEnvelopeV2,
    KernelWorkerRequestV2, KernelWorkerResponseEnvelopeV2, KernelWorkerResponseV2,
    KernelWorkerRuntimeV2,
};
use er_repro::current::CurrentReproCapsuleV1;
use er_state::m7_state::ProfileStateV1;
use er_types::SafeU53;
use sha2::{Digest, Sha256};

fn read_bounded(path: &Path, maximum: u64) -> Result<Vec<u8>, Box<dyn Error>> {
    let metadata = fs::metadata(path)?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > maximum {
        return Err("browser-to-native input exceeds its bound".into());
    }
    Ok(fs::read(path)?)
}

fn send(
    worker: &mut KernelWorkerRuntimeV2,
    identity: &KernelGenerationIdentityV2,
    sequence: u64,
    request: KernelWorkerRequestV2,
) -> Result<KernelWorkerResponseV2, Box<dyn Error>> {
    let envelope = KernelWorkerRequestEnvelopeV2::new(identity, sequence + 100, sequence, request)?;
    let bytes = worker.handle_bytes(envelope)?;
    let response: KernelWorkerResponseEnvelopeV2 = serde_json::from_slice(&bytes)?;
    if response.accepted_sequence != Some(sequence) {
        return Err("native worker did not accept the exact request sequence".into());
    }
    match response.response {
        KernelWorkerResponseV2::Fault(fault) => {
            Err(format!("native worker fault: {fault:?}").into())
        }
        response => Ok(response),
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let arguments: Vec<_> = std::env::args().skip(1).collect();
    if arguments.len() != 4 {
        return Err("expected content, capsule, browser snapshot and source SHA".into());
    }
    let source_sha = &arguments[3];
    if source_sha.len() != 40 || !source_sha.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("source SHA must be forty hex digits".into());
    }
    let bundle: GameContentBundleV2 =
        serde_json::from_slice(&read_bounded(Path::new(&arguments[0]), 64 << 20)?)?;
    let capsule: CurrentReproCapsuleV1 =
        serde_json::from_slice(&read_bounded(Path::new(&arguments[1]), 2 << 20)?)?;
    let expected: CoreGameKernelSnapshotV7 =
        serde_json::from_slice(&read_bounded(Path::new(&arguments[2]), 8 << 20)?)?;
    let position = capsule.final_position;
    let local_seat = capsule.local_seat;
    let prepared = PreparedGameContentV2::prepare(Arc::new(bundle.clone()))?;
    let executable = fs::read(std::env::current_exe()?)?;
    let executable_sha = format!("{:x}", Sha256::digest(executable));
    let identity = KernelGenerationIdentityV2 {
        schema_version: 2,
        session_id: KernelSessionIdV1("browser-native-import".to_owned()),
        generation: KernelGenerationV1(1),
        artifact_sha256: executable_sha.clone(),
        executable_sha256: executable_sha.clone(),
        source_git_sha: source_sha.to_owned(),
        worker_abi_version: KERNEL_WORKER_ABI_VERSION_V2,
        minimum_snapshot_schema: 7,
        maximum_snapshot_schema: 7,
        content_identity: prepared.identity().clone(),
        build_target: std::env::consts::ARCH.to_owned(),
        build_profile: "debug".to_owned(),
    };
    let profile: ProfileStateV1 = serde_json::from_value(serde_json::json!({
        "schema_version": 1, "unlocks": [], "achievements": [], "challenges": [], "flags": [],
        "statistics": {"runs_started": 0, "runs_won": 0, "runs_lost": 0, "battles_won": 0,
            "pokemon_captured": 0, "highest_wave": 1}, "dex": {"entries": []}
    }))?;
    let mut worker = KernelWorkerRuntimeV2::new(identity.clone())?;
    let initialized = send(
        &mut worker,
        &identity,
        0,
        KernelWorkerRequestV2::Initialize {
            content_bundle: Box::new(bundle),
            initialization: Box::new(KernelWorkerInitializationV2::Natural {
                profile: Box::new(profile),
                seed: "current-worker-natural".to_owned(),
                local_seat,
                save_slots: vec!["browser-native-import".to_owned()],
                local_is_host: true,
                scheduler: KernelSchedulerSnapshotV2 {
                    next_timer_id: Some(SafeU53::ZERO),
                    timers: Vec::new(),
                    pauses: Vec::new(),
                    disposed: false,
                },
                protocol: Box::new(None),
            }),
        },
    )?;
    if !matches!(initialized, KernelWorkerResponseV2::Initialized { .. }) {
        return Err("native worker content frame did not initialize".into());
    }
    let imported = send(
        &mut worker,
        &identity,
        1,
        KernelWorkerRequestV2::ImportRepro {
            capsule: Box::new(capsule),
        },
    )?;
    if !matches!(imported, KernelWorkerResponseV2::Restored { .. }) {
        return Err("native worker did not import the browser capsule".into());
    }
    let KernelWorkerResponseV2::Snapshot { snapshot } =
        send(&mut worker, &identity, 2, KernelWorkerRequestV2::Snapshot)?
    else {
        return Err("native worker did not return its imported snapshot".into());
    };
    if *snapshot != expected {
        return Err("native worker snapshot differs from actual browser Worker".into());
    }
    let KernelWorkerResponseV2::Repro {
        capsule: initial_suffix,
    } = send(
        &mut worker,
        &identity,
        3,
        KernelWorkerRequestV2::ExportRepro,
    )?
    else {
        return Err("native worker did not declare a browser-origin suffix".into());
    };
    if initial_suffix.base_position != position
        || initial_suffix.final_position != position
        || !initial_suffix.attempts.is_empty()
    {
        return Err("native worker suffix did not start at the verified browser frontier".into());
    }
    let applied = send(
        &mut worker,
        &identity,
        4,
        KernelWorkerRequestV2::Apply(CurrentExternalEvent::AdvanceTime {
            milliseconds: SafeU53::new(1)?,
        }),
    )?;
    if !matches!(applied, KernelWorkerResponseV2::Effects { .. }) {
        return Err("native worker did not continue after browser import".into());
    }
    let KernelWorkerResponseV2::Repro { capsule: continued } = send(
        &mut worker,
        &identity,
        5,
        KernelWorkerRequestV2::ExportRepro,
    )?
    else {
        return Err("native worker did not export its continued suffix".into());
    };
    if continued.base_position != position
        || continued.final_position != position + 1
        || continued.attempts.len() != 1
    {
        return Err("native worker did not retain the new native attempt".into());
    }
    println!(
        "{}",
        serde_json::json!({
            "source_sha": source_sha,
            "executable_sha256": executable_sha,
            "browser_frontier": position,
            "native_frontier": continued.final_position,
            "full_snapshot_equal": true,
            "native_suffix_attempts": continued.attempts.len()
        })
    );
    Ok(())
}
