use std::io::{BufReader, BufWriter, Write};
use std::process::ExitCode;

use er_kernel_worker::{
    KERNEL_WORKER_ABI_VERSION_V1, KERNEL_WORKER_ABI_VERSION_V2, KernelWorkerBootstrapV1,
    KernelWorkerBootstrapV2, KernelWorkerRequestEnvelopeV1, KernelWorkerRequestEnvelopeV2,
    KernelWorkerResponseV1, KernelWorkerRuntimeV1, KernelWorkerRuntimeV2,
    MAXIMUM_WORKER_FRAME_BYTES_V2, read_frame_v1, write_frame_v1,
};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = BufWriter::new(stdout.lock());
    let Some(value) = read_frame_v1::<_, serde_json::Value>(&mut reader)? else {
        return Ok(());
    };
    match value.get("abi_version").and_then(serde_json::Value::as_u64) {
        Some(version) if version == u64::from(KERNEL_WORKER_ABI_VERSION_V1) => {
            let bootstrap: KernelWorkerBootstrapV1 = serde_json::from_value(value)?;
            let mut runtime = KernelWorkerRuntimeV1::new(bootstrap.identity)?;
            while let Some(request) =
                read_frame_v1::<_, KernelWorkerRequestEnvelopeV1>(&mut reader)?
            {
                let response = runtime.handle(request);
                let disposed = matches!(response.response, KernelWorkerResponseV1::Disposed);
                write_frame_v1(&mut writer, &response)?;
                if disposed {
                    break;
                }
            }
        }
        Some(version) if version == u64::from(KERNEL_WORKER_ABI_VERSION_V2) => {
            let bootstrap: KernelWorkerBootstrapV2 = serde_json::from_value(value)?;
            bootstrap.validate()?;
            let mut runtime = KernelWorkerRuntimeV2::with_success_response_limit(
                bootstrap.identity,
                bootstrap.maximum_success_response_bytes,
            )?;
            while let Some(request) =
                read_frame_v1::<_, KernelWorkerRequestEnvelopeV2>(&mut reader)?
            {
                let bytes = runtime.handle_bytes(request)?;
                write_prepared_frame_v2(&mut writer, &bytes)?;
                if runtime.is_disposed() {
                    break;
                }
            }
        }
        _ => {
            return Err(
                "unsupported bootstrap ABI; select ABI1 compatibility or current ABI2".into(),
            );
        }
    }
    Ok(())
}

fn write_prepared_frame_v2(
    writer: &mut impl Write,
    bytes: &[u8],
) -> Result<(), Box<dyn std::error::Error>> {
    if bytes.is_empty() || bytes.len() > MAXIMUM_WORKER_FRAME_BYTES_V2 {
        return Err("prepared current worker response exceeds its bound".into());
    }
    let length = u32::try_from(bytes.len())?;
    writer.write_all(&length.to_be_bytes())?;
    writer.write_all(bytes)?;
    writer.flush()?;
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(_) => ExitCode::FAILURE,
    }
}
