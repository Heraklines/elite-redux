//! M7.2 bounded JSONL framing and root-confined artifact reads.

use std::fs::File;
use std::io::{BufRead, Read};
use std::path::{Component, Path};

use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BoundedLineStatusV1 {
    Line,
    Oversized,
    Eof,
}

#[derive(Debug, Error)]
pub enum BoundedIoErrorV1 {
    #[error("I/O bound or path is invalid")]
    Invalid,
    #[error("path escapes the configured root")]
    PathEscape,
    #[error("input exceeds its byte bound")]
    TooLarge,
    #[error("I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

pub fn read_bounded_jsonl_line_v1<R: BufRead>(
    reader: &mut R,
    output: &mut Vec<u8>,
    maximum_bytes: usize,
) -> Result<BoundedLineStatusV1, BoundedIoErrorV1> {
    if maximum_bytes == 0 {
        return Err(BoundedIoErrorV1::Invalid);
    }
    output.clear();
    let mut saw_bytes = false;
    let mut oversized = false;
    loop {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            if oversized {
                output.clear();
                return Ok(BoundedLineStatusV1::Oversized);
            }
            return Ok(if saw_bytes {
                BoundedLineStatusV1::Line
            } else {
                BoundedLineStatusV1::Eof
            });
        }
        saw_bytes = true;
        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let consumed = newline.map_or(buffer.len(), |index| index + 1);
        if !oversized {
            let content_count = newline.unwrap_or(consumed);
            let allowed = maximum_bytes.saturating_add(1).saturating_sub(output.len());
            let copy = content_count.min(allowed);
            output.extend_from_slice(&buffer[..copy]);
            oversized = output.len() > maximum_bytes || copy < content_count;
        }
        reader.consume(consumed);
        if newline.is_some() {
            if oversized {
                output.clear();
                return Ok(BoundedLineStatusV1::Oversized);
            }
            if output.last() == Some(&b'\r') {
                output.pop();
            }
            return Ok(BoundedLineStatusV1::Line);
        }
    }
}

pub fn read_bounded_file_v1(
    root: &Path,
    relative: &Path,
    maximum_bytes: usize,
) -> Result<Vec<u8>, BoundedIoErrorV1> {
    if maximum_bytes == 0
        || relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(BoundedIoErrorV1::Invalid);
    }
    let canonical_root = root.canonicalize()?;
    let candidate = canonical_root.join(relative).canonicalize()?;
    if !candidate.starts_with(&canonical_root) {
        return Err(BoundedIoErrorV1::PathEscape);
    }
    let metadata = candidate.metadata()?;
    if !metadata.is_file()
        || metadata.len() > u64::try_from(maximum_bytes).map_err(|_| BoundedIoErrorV1::Invalid)?
    {
        return Err(BoundedIoErrorV1::TooLarge);
    }
    let mut bytes = Vec::with_capacity(
        usize::try_from(metadata.len()).map_err(|_| BoundedIoErrorV1::TooLarge)?,
    );
    File::open(candidate)?
        .take(u64::try_from(maximum_bytes).map_err(|_| BoundedIoErrorV1::Invalid)? + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > maximum_bytes {
        return Err(BoundedIoErrorV1::TooLarge);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::{BufReader, Cursor};

    use super::*;

    #[test]
    fn oversized_jsonl_is_drained_before_next_line() -> Result<(), Box<dyn std::error::Error>> {
        let mut reader = BufReader::new(Cursor::new(b"123456\nok\n".to_vec()));
        let mut output = Vec::new();
        assert_eq!(
            read_bounded_jsonl_line_v1(&mut reader, &mut output, 3)?,
            BoundedLineStatusV1::Oversized
        );
        assert!(output.is_empty());
        assert_eq!(
            read_bounded_jsonl_line_v1(&mut reader, &mut output, 3)?,
            BoundedLineStatusV1::Line
        );
        assert_eq!(output, b"ok");
        Ok(())
    }

    #[test]
    fn bounded_file_rejects_escape_and_oversize() -> Result<(), Box<dyn std::error::Error>> {
        let root = std::env::temp_dir().join(format!("er-m72-bounded-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root)?;
        fs::write(root.join("small.bin"), [1_u8, 2, 3])?;
        fs::write(root.join("large.bin"), [0_u8; 8])?;
        assert_eq!(
            read_bounded_file_v1(&root, Path::new("small.bin"), 3)?,
            vec![1, 2, 3]
        );
        assert!(matches!(
            read_bounded_file_v1(&root, Path::new("large.bin"), 3),
            Err(BoundedIoErrorV1::TooLarge)
        ));
        assert!(matches!(
            read_bounded_file_v1(&root, Path::new("../escape"), 3),
            Err(BoundedIoErrorV1::Invalid)
        ));
        fs::remove_dir_all(root)?;
        Ok(())
    }
}
