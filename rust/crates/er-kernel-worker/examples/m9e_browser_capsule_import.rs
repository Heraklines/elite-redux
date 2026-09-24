//! Remote witness: a real browser capsule crosses the separate native worker
//! content and repro frames, preserves its final snapshot, and can continue.

use std::error::Error;
use std::fs;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::Path;
use std::process::{ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use er_env::current::CurrentExternalEvent;
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_kernel_worker::{
    KERNEL_WORKER_ABI_VERSION_V2, KernelGenerationIdentityV2, KernelGenerationV1,
    KernelSessionIdV1, KernelWorkerBootstrapV2, KernelWorkerInitializationV2,
    KernelWorkerRequestEnvelopeV2, KernelWorkerRequestV2, KernelWorkerResponseEnvelopeV2,
    KernelWorkerResponseV2, KernelWorkerRuntimeV2, MAXIMUM_WORKER_FRAME_BYTES_V2, read_frame_v1,
    write_frame_v1,
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

fn digest_file(path: &Path, maximum: u64) -> Result<String, Box<dyn Error>> {
    let metadata = fs::metadata(path)?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > maximum {
        return Err("native executable exceeds its bound".into());
    }
    let mut file = fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn send_process(
    input: &mut BufWriter<ChildStdin>,
    output: &mut BufReader<ChildStdout>,
    identity: &KernelGenerationIdentityV2,
    sequence: u64,
    request: KernelWorkerRequestV2,
) -> Result<KernelWorkerResponseV2, Box<dyn Error>> {
    let envelope = KernelWorkerRequestEnvelopeV2::new(identity, sequence + 100, sequence, request)?;
    write_frame_v1(input, &envelope)?;
    let response: KernelWorkerResponseEnvelopeV2 =
        read_frame_v1(output)?.ok_or("native worker process closed before its response")?;
    if response.abi_version != KERNEL_WORKER_ABI_VERSION_V2
        || response.session_id != identity.session_id
        || response.generation != identity.generation
        || response.request_id != sequence + 100
        || response.accepted_sequence != Some(sequence)
    {
        return Err("native worker process did not accept the exact request".into());
    }
    match response.response {
        KernelWorkerResponseV2::Fault(fault) => {
            Err(format!("native worker process fault: {fault:?}").into())
        }
        response => Ok(response),
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let arguments: Vec<_> = std::env::args().skip(1).collect();
    if arguments.len() != 5 {
        return Err("expected content, capsule, browser snapshot, source SHA and native worker".into());
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
    let executable_sha = digest_file(&std::env::current_exe()?, 128 << 20)?;
    let worker_path = Path::new(&arguments[4]);
    let process_worker_sha = digest_file(worker_path, 128 << 20)?;
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
    let process_bundle = bundle.clone();
    let process_capsule = capsule.clone();
    let process_profile = profile.clone();
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
    let mut process_identity = identity.clone();
    process_identity.session_id = KernelSessionIdV1("browser-process-import".to_owned());
    process_identity.artifact_sha256 = process_worker_sha.clone();
    process_identity.executable_sha256 = process_worker_sha.clone();
    let mut child = Command::new(worker_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()?;
    let mut input = BufWriter::new(child.stdin.take().ok_or("native worker stdin missing")?);
    let mut output = BufReader::new(child.stdout.take().ok_or("native worker stdout missing")?);
    write_frame_v1(
        &mut input,
        &KernelWorkerBootstrapV2 {
            abi_version: KERNEL_WORKER_ABI_VERSION_V2,
            identity: process_identity.clone(),
            maximum_success_response_bytes: MAXIMUM_WORKER_FRAME_BYTES_V2,
        },
    )?;
    let process_initialized = send_process(
        &mut input,
        &mut output,
        &process_identity,
        0,
        KernelWorkerRequestV2::Initialize {
            content_bundle: Box::new(process_bundle),
            initialization: Box::new(KernelWorkerInitializationV2::Natural {
                profile: Box::new(process_profile),
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
    if !matches!(process_initialized, KernelWorkerResponseV2::Initialized { .. }) {
        return Err("native worker process did not initialize".into());
    }
    let process_imported = send_process(
        &mut input,
        &mut output,
        &process_identity,
        1,
        KernelWorkerRequestV2::ImportRepro {
            capsule: Box::new(process_capsule),
        },
    )?;
    if !matches!(process_imported, KernelWorkerResponseV2::Restored { .. }) {
        return Err("native worker process did not import the browser capsule".into());
    }
    let KernelWorkerResponseV2::Snapshot {
        snapshot: process_snapshot,
    } = send_process(
        &mut input,
        &mut output,
        &process_identity,
        2,
        KernelWorkerRequestV2::Snapshot,
    )?
    else {
        return Err("native worker process did not return its imported snapshot".into());
    };
    if *process_snapshot != expected {
        return Err("native worker process snapshot differs from actual browser Worker".into());
    }
    let KernelWorkerResponseV2::Repro {
        capsule: process_initial_suffix,
    } = send_process(
        &mut input,
        &mut output,
        &process_identity,
        3,
        KernelWorkerRequestV2::ExportRepro,
    )?
    else {
        return Err("native worker process did not export its browser-origin suffix".into());
    };
    if process_initial_suffix.base_position != position
        || process_initial_suffix.final_position != position
        || !process_initial_suffix.attempts.is_empty()
    {
        return Err("native worker process suffix did not start at the browser frontier".into());
    }
    let process_applied = send_process(
        &mut input,
        &mut output,
        &process_identity,
        4,
        KernelWorkerRequestV2::Apply(CurrentExternalEvent::AdvanceTime {
            milliseconds: SafeU53::new(1)?,
        }),
    )?;
    if !matches!(process_applied, KernelWorkerResponseV2::Effects { .. }) {
        return Err("native worker process did not continue after browser import".into());
    }
    let KernelWorkerResponseV2::Repro {
        capsule: process_continued,
    } = send_process(
        &mut input,
        &mut output,
        &process_identity,
        5,
        KernelWorkerRequestV2::ExportRepro,
    )?
    else {
        return Err("native worker process did not export its continued suffix".into());
    };
    if process_continued.base_position != position
        || process_continued.final_position != position + 1
        || process_continued.attempts.len() != 1
    {
        return Err("native worker process did not retain the new native attempt".into());
    }
    if !matches!(
        send_process(
            &mut input,
            &mut output,
            &process_identity,
            6,
            KernelWorkerRequestV2::Dispose,
        )?,
        KernelWorkerResponseV2::Disposed
    ) {
        return Err("native worker process did not acknowledge disposal".into());
    }
    let process_deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(status) = child.try_wait()? {
            if !status.success() {
                return Err("disposed native worker process exited unsuccessfully".into());
            }
            break;
        }
        if Instant::now() >= process_deadline {
            return Err("disposed native worker process did not exit".into());
        }
        thread::sleep(Duration::from_millis(10));
    }
    let mut stdout = std::io::stdout().lock();
    serde_json::to_writer(
        &mut stdout,
        &serde_json::json!({
            "source_sha": source_sha,
            "executable_sha256": executable_sha,
            "browser_frontier": position,
            "native_frontier": continued.final_position,
            "full_snapshot_equal": true,
            "native_suffix_attempts": continued.attempts.len(),
            "process_snapshot_equal": true,
            "process_native_frontier": process_continued.final_position,
            "process_suffix_attempts": process_continued.attempts.len(),
            "process_worker_sha256": process_worker_sha,
            "process_disposed": true
        }),
    )?;
    stdout.write_all(b"\n")?;
    Ok(())
}
