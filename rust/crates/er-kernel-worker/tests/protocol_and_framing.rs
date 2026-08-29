use std::io::Cursor;

use er_kernel_worker::{
    KERNEL_WORKER_ABI_VERSION_V1, KernelGenerationIdentityV1, KernelGenerationV1,
    KernelSessionIdV1, KernelWorkerRequestEnvelopeV1, KernelWorkerRequestV1, read_frame_v1,
    write_frame_v1,
};

fn identity() -> KernelGenerationIdentityV1 {
    KernelGenerationIdentityV1 {
        schema_version: 1,
        session_id: KernelSessionIdV1("worker-session".to_owned()),
        generation: KernelGenerationV1(7),
        artifact_sha256: "1".repeat(64),
        executable_sha256: "2".repeat(64),
        source_git_sha: "3".repeat(40),
        worker_abi_version: KERNEL_WORKER_ABI_VERSION_V1,
        minimum_snapshot_schema: 6,
        maximum_snapshot_schema: 6,
        content_identity: "blake3-v1:content".to_owned(),
        build_target: "x86_64-pc-windows-msvc".to_owned(),
        build_profile: "release".to_owned(),
    }
}

#[test]
fn length_prefixed_frame_round_trips_exact_envelope() -> Result<(), Box<dyn std::error::Error>> {
    let identity = identity();
    let envelope =
        KernelWorkerRequestEnvelopeV1::new(&identity, 1, 1, KernelWorkerRequestV1::Hello)?;
    let mut bytes = Vec::new();
    write_frame_v1(&mut bytes, &envelope)?;
    let decoded = read_frame_v1::<_, KernelWorkerRequestEnvelopeV1>(&mut Cursor::new(bytes))?
        .ok_or("missing frame")?;
    assert_eq!(decoded, envelope);
    decoded.validate_for(&identity, None)?;
    Ok(())
}

#[test]
fn tampered_fingerprint_and_stale_generation_fail_closed() -> Result<(), Box<dyn std::error::Error>>
{
    let identity = identity();
    let mut envelope =
        KernelWorkerRequestEnvelopeV1::new(&identity, 1, 1, KernelWorkerRequestV1::Health)?;
    envelope.fingerprint = "0".repeat(64);
    assert!(envelope.validate_for(&identity, None).is_err());
    let mut stale_identity = identity.clone();
    stale_identity.generation = KernelGenerationV1(8);
    let envelope =
        KernelWorkerRequestEnvelopeV1::new(&stale_identity, 2, 2, KernelWorkerRequestV1::Health)?;
    assert!(envelope.validate_for(&identity, None).is_err());
    Ok(())
}

#[test]
fn invalid_generation_identity_is_rejected() {
    let mut value = identity();
    value.artifact_sha256 = "NOT-A-DIGEST".to_owned();
    assert!(value.validate().is_err());
}
