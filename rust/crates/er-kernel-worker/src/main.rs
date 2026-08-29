use std::io::{BufReader, BufWriter};
use std::process::ExitCode;

use er_kernel_worker::{
    KERNEL_WORKER_ABI_VERSION_V1, KernelWorkerBootstrapV1, KernelWorkerRequestEnvelopeV1,
    KernelWorkerResponseV1, KernelWorkerRuntimeV1, read_frame_v1, write_frame_v1,
};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = BufWriter::new(stdout.lock());
    let Some(bootstrap) = read_frame_v1::<_, KernelWorkerBootstrapV1>(&mut reader)? else {
        return Ok(());
    };
    if bootstrap.abi_version != KERNEL_WORKER_ABI_VERSION_V1 {
        return Err("unsupported bootstrap ABI".into());
    }
    let mut runtime = KernelWorkerRuntimeV1::new(bootstrap.identity)?;
    while let Some(request) = read_frame_v1::<_, KernelWorkerRequestEnvelopeV1>(&mut reader)? {
        let response = runtime.handle(request);
        let disposed = matches!(response.response, KernelWorkerResponseV1::Disposed);
        write_frame_v1(&mut writer, &response)?;
        if disposed {
            break;
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(_) => ExitCode::FAILURE,
    }
}
