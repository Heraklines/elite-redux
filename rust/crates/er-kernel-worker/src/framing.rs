use std::io::{Read, Write};

use serde::Serialize;
use serde::de::DeserializeOwned;
use thiserror::Error;

use crate::protocol::MAXIMUM_WORKER_FRAME_BYTES_V1;

#[derive(Debug, Error)]
pub enum WorkerFrameErrorV1 {
    #[error("worker frame I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("worker frame is empty or exceeds the frozen bound")]
    Size,
    #[error("worker frame JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
}

pub fn read_frame_v1<R: Read, T: DeserializeOwned>(
    reader: &mut R,
) -> Result<Option<T>, WorkerFrameErrorV1> {
    let mut length = [0_u8; 4];
    let mut read = 0;
    while read < length.len() {
        let count = reader.read(&mut length[read..])?;
        if count == 0 {
            return if read == 0 {
                Ok(None)
            } else {
                Err(WorkerFrameErrorV1::Size)
            };
        }
        read += count;
    }
    let length = u32::from_be_bytes(length) as usize;
    if length == 0 || length > MAXIMUM_WORKER_FRAME_BYTES_V1 {
        return Err(WorkerFrameErrorV1::Size);
    }
    let mut bytes = vec![0_u8; length];
    reader.read_exact(&mut bytes)?;
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(WorkerFrameErrorV1::from)
}

pub fn write_frame_v1<W: Write, T: Serialize>(
    writer: &mut W,
    value: &T,
) -> Result<(), WorkerFrameErrorV1> {
    let bytes = serde_json::to_vec(value)?;
    if bytes.is_empty() || bytes.len() > MAXIMUM_WORKER_FRAME_BYTES_V1 {
        return Err(WorkerFrameErrorV1::Size);
    }
    let length = u32::try_from(bytes.len()).map_err(|_| WorkerFrameErrorV1::Size)?;
    writer.write_all(&length.to_be_bytes())?;
    writer.write_all(&bytes)?;
    writer.flush()?;
    Ok(())
}
