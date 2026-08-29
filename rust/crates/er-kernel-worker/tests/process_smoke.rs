use std::io::{BufReader, BufWriter};
use std::process::{Command, Stdio};

use er_kernel_worker::{
    KERNEL_WORKER_ABI_VERSION_V1, KernelGenerationIdentityV1, KernelGenerationV1,
    KernelSessionIdV1, KernelWorkerBootstrapV1, KernelWorkerRequestEnvelopeV1,
    KernelWorkerRequestV1, KernelWorkerResponseEnvelopeV1, KernelWorkerResponseV1, read_frame_v1,
    write_frame_v1,
};

#[test]
fn child_process_completes_hello_and_dispose_protocol() -> Result<(), Box<dyn std::error::Error>> {
    let identity = identity();
    let mut child = Command::new(env!("CARGO_BIN_EXE_er-kernel-worker"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let stdin = child.stdin.take().ok_or("worker stdin")?;
    let stdout = child.stdout.take().ok_or("worker stdout")?;
    let mut writer = BufWriter::new(stdin);
    let mut reader = BufReader::new(stdout);
    write_frame_v1(
        &mut writer,
        &KernelWorkerBootstrapV1 {
            abi_version: KERNEL_WORKER_ABI_VERSION_V1,
            identity: identity.clone(),
        },
    )?;
    let hello = KernelWorkerRequestEnvelopeV1::new(&identity, 1, 1, KernelWorkerRequestV1::Hello)?;
    write_frame_v1(&mut writer, &hello)?;
    let ready =
        read_frame_v1::<_, KernelWorkerResponseEnvelopeV1>(&mut reader)?.ok_or("ready response")?;
    assert!(matches!(&ready.response, KernelWorkerResponseV1::Ready(value) if value == &identity));
    let dispose =
        KernelWorkerRequestEnvelopeV1::new(&identity, 2, 2, KernelWorkerRequestV1::Dispose)?;
    write_frame_v1(&mut writer, &dispose)?;
    let disposed = read_frame_v1::<_, KernelWorkerResponseEnvelopeV1>(&mut reader)?
        .ok_or("disposed response")?;
    assert!(matches!(
        disposed.response,
        KernelWorkerResponseV1::Disposed
    ));
    drop(writer);
    assert!(child.wait()?.success());
    Ok(())
}

fn identity() -> KernelGenerationIdentityV1 {
    KernelGenerationIdentityV1 {
        schema_version: 1,
        session_id: KernelSessionIdV1("process-smoke".to_owned()),
        generation: KernelGenerationV1(1),
        artifact_sha256: "a".repeat(64),
        executable_sha256: "b".repeat(64),
        source_git_sha: "c".repeat(40),
        worker_abi_version: KERNEL_WORKER_ABI_VERSION_V1,
        minimum_snapshot_schema: 6,
        maximum_snapshot_schema: 6,
        content_identity: "blake3-v1:process-smoke".to_owned(),
        build_target: std::env::consts::ARCH.to_owned(),
        build_profile: "test".to_owned(),
    }
}
