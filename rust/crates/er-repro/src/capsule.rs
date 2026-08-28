//! Deterministic, bounded M7.1 reproduction capsule container.

use std::collections::BTreeSet;

use er_canonical::canonical_bytes;
use er_dev_types::ExecutionIdentityV1;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{CapsuleModeV1, FailureOracleV1, REPRO_CAPSULE_VERSION_V1};

const CAPSULE_MAGIC_V1: &[u8; 8] = b"ERCAP71\0";
const DIGEST_PREFIX: &str = "blake3-v1:";

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CapsuleBlobKindV1 {
    InitialSnapshot,
    Trace,
    DiagnosticCheckpoint,
    CausalGraph,
    PlatformEvidence,
    RenderEvidence,
    Content,
    FailureEvidence,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CapsuleCompressionV1 {
    None,
    RleV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CapsuleBlobRefV1 {
    pub kind: CapsuleBlobKindV1,
    pub digest: String,
    pub uncompressed_size: u64,
    pub stored_size: u64,
    pub compression: CapsuleCompressionV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CapsuleBlobV1 {
    pub kind: CapsuleBlobKindV1,
    pub digest: String,
    pub uncompressed_size: u64,
    pub compression: CapsuleCompressionV1,
    pub payload: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CapsuleLimitsV1 {
    pub maximum_manifest_bytes: u64,
    pub maximum_blob_count: usize,
    pub maximum_blob_bytes: u64,
    pub maximum_total_stored_bytes: u64,
    pub maximum_total_decompressed_bytes: u64,
}

impl CapsuleLimitsV1 {
    pub fn validate(self) -> Result<(), CapsuleErrorV1> {
        if self.maximum_manifest_bytes == 0
            || self.maximum_blob_count == 0
            || self.maximum_blob_bytes == 0
            || self.maximum_total_stored_bytes == 0
            || self.maximum_total_decompressed_bytes == 0
        {
            return Err(CapsuleErrorV1::InvalidLimits);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RedactionAliasV1 {
    pub path: String,
    pub alias: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RedactionManifestV1 {
    pub policy_version: u32,
    pub profile: String,
    pub removed_paths: Vec<String>,
    pub aliased_fields: Vec<RedactionAliasV1>,
    pub omitted_blob_kinds: Vec<CapsuleBlobKindV1>,
    pub retained_sensitive_fields: Vec<String>,
}

impl RedactionManifestV1 {
    fn validate(&self) -> Result<(), CapsuleErrorV1> {
        if self.policy_version != 1
            || self.profile.is_empty()
            || !self.retained_sensitive_fields.is_empty()
            || !is_strictly_sorted_unique(&self.removed_paths)
            || self
                .aliased_fields
                .iter()
                .any(|field| field.path.is_empty() || field.alias.is_empty())
            || self
                .aliased_fields
                .windows(2)
                .any(|pair| pair[0].path >= pair[1].path)
            || self
                .omitted_blob_kinds
                .windows(2)
                .any(|pair| pair[0] >= pair[1])
        {
            return Err(CapsuleErrorV1::Redaction);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReproCapsuleManifestV1 {
    pub schema_version: u32,
    pub mode: CapsuleModeV1,
    pub identity: ExecutionIdentityV1,
    pub failure_oracle: FailureOracleV1,
    pub initial_snapshot_digest: String,
    pub trace_digest: String,
    pub diagnostic_checkpoint_digests: Vec<String>,
    pub blobs: Vec<CapsuleBlobRefV1>,
    pub redaction: RedactionManifestV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReproCapsuleV1 {
    pub manifest: ReproCapsuleManifestV1,
    pub blobs: Vec<CapsuleBlobV1>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CapsuleErrorV1 {
    #[error("capsule limits are zero or inconsistent")]
    InvalidLimits,
    #[error("capsule magic or schema version is invalid")]
    Version,
    #[error("capsule manifest is malformed or oversized")]
    Manifest,
    #[error("capsule blob table is unsorted, duplicated, missing, or contains an unknown kind")]
    BlobTable,
    #[error("capsule blob size exceeds a configured bound")]
    Size,
    #[error("capsule blob digest does not match its uncompressed bytes")]
    Digest,
    #[error("capsule compression stream is malformed")]
    Compression,
    #[error("capsule redaction manifest is unsafe or nondeterministic")]
    Redaction,
    #[error("capsule canonical encoding failed: {0}")]
    Canonical(String),
    #[error("capsule JSON decoding failed: {0}")]
    Json(String),
}

impl CapsuleBlobV1 {
    pub fn from_uncompressed(
        kind: CapsuleBlobKindV1,
        bytes: &[u8],
        limits: CapsuleLimitsV1,
    ) -> Result<Self, CapsuleErrorV1> {
        limits.validate()?;
        let size = u64::try_from(bytes.len()).map_err(|_| CapsuleErrorV1::Size)?;
        if size > limits.maximum_blob_bytes || size > limits.maximum_total_decompressed_bytes {
            return Err(CapsuleErrorV1::Size);
        }
        let compressed = rle_compress(bytes);
        let (compression, payload) = if compressed.len() < bytes.len() {
            (CapsuleCompressionV1::RleV1, compressed)
        } else {
            (CapsuleCompressionV1::None, bytes.to_vec())
        };
        let stored = u64::try_from(payload.len()).map_err(|_| CapsuleErrorV1::Size)?;
        if stored > limits.maximum_blob_bytes || stored > limits.maximum_total_stored_bytes {
            return Err(CapsuleErrorV1::Size);
        }
        Ok(Self {
            kind,
            digest: raw_digest(bytes),
            uncompressed_size: size,
            compression,
            payload,
        })
    }

    pub fn reference(&self) -> Result<CapsuleBlobRefV1, CapsuleErrorV1> {
        Ok(CapsuleBlobRefV1 {
            kind: self.kind,
            digest: self.digest.clone(),
            uncompressed_size: self.uncompressed_size,
            stored_size: u64::try_from(self.payload.len()).map_err(|_| CapsuleErrorV1::Size)?,
            compression: self.compression,
        })
    }

    pub fn decode(&self, limits: CapsuleLimitsV1) -> Result<Vec<u8>, CapsuleErrorV1> {
        limits.validate()?;
        if self.uncompressed_size > limits.maximum_blob_bytes
            || self.uncompressed_size > limits.maximum_total_decompressed_bytes
            || u64::try_from(self.payload.len()).map_err(|_| CapsuleErrorV1::Size)?
                > limits.maximum_blob_bytes
        {
            return Err(CapsuleErrorV1::Size);
        }
        let maximum = usize::try_from(self.uncompressed_size).map_err(|_| CapsuleErrorV1::Size)?;
        let bytes = match self.compression {
            CapsuleCompressionV1::None => self.payload.clone(),
            CapsuleCompressionV1::RleV1 => rle_decompress(&self.payload, maximum)?,
        };
        if bytes.len() != maximum {
            return Err(CapsuleErrorV1::Compression);
        }
        if raw_digest(&bytes) != self.digest {
            return Err(CapsuleErrorV1::Digest);
        }
        Ok(bytes)
    }
}

impl ReproCapsuleV1 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        mode: CapsuleModeV1,
        identity: ExecutionIdentityV1,
        failure_oracle: FailureOracleV1,
        initial_snapshot: &[u8],
        trace: &[u8],
        optional_blobs: Vec<(CapsuleBlobKindV1, Vec<u8>)>,
        mut redaction: RedactionManifestV1,
        limits: CapsuleLimitsV1,
    ) -> Result<Self, CapsuleErrorV1> {
        let mut blobs = vec![
            CapsuleBlobV1::from_uncompressed(
                CapsuleBlobKindV1::InitialSnapshot,
                initial_snapshot,
                limits,
            )?,
            CapsuleBlobV1::from_uncompressed(CapsuleBlobKindV1::Trace, trace, limits)?,
        ];
        for (kind, bytes) in optional_blobs {
            if mode == CapsuleModeV1::Thin && kind == CapsuleBlobKindV1::Content {
                if !redaction.omitted_blob_kinds.contains(&kind) {
                    redaction.omitted_blob_kinds.push(kind);
                    redaction.omitted_blob_kinds.sort();
                }
                continue;
            }
            blobs.push(CapsuleBlobV1::from_uncompressed(kind, &bytes, limits)?);
        }
        blobs.sort_by(|left, right| (left.kind, &left.digest).cmp(&(right.kind, &right.digest)));
        let refs = blobs
            .iter()
            .map(CapsuleBlobV1::reference)
            .collect::<Result<Vec<_>, _>>()?;
        let initial_snapshot_digest = refs
            .iter()
            .find(|entry| entry.kind == CapsuleBlobKindV1::InitialSnapshot)
            .map(|entry| entry.digest.clone())
            .ok_or(CapsuleErrorV1::BlobTable)?;
        let trace_digest = refs
            .iter()
            .find(|entry| entry.kind == CapsuleBlobKindV1::Trace)
            .map(|entry| entry.digest.clone())
            .ok_or(CapsuleErrorV1::BlobTable)?;
        let diagnostic_checkpoint_digests = refs
            .iter()
            .filter(|entry| entry.kind == CapsuleBlobKindV1::DiagnosticCheckpoint)
            .map(|entry| entry.digest.clone())
            .collect();
        let value = Self {
            manifest: ReproCapsuleManifestV1 {
                schema_version: REPRO_CAPSULE_VERSION_V1,
                mode,
                identity,
                failure_oracle,
                initial_snapshot_digest,
                trace_digest,
                diagnostic_checkpoint_digests,
                blobs: refs,
                redaction,
            },
            blobs,
        };
        value.validate(limits)?;
        Ok(value)
    }

    pub fn validate(&self, limits: CapsuleLimitsV1) -> Result<(), CapsuleErrorV1> {
        limits.validate()?;
        if self.manifest.schema_version != REPRO_CAPSULE_VERSION_V1 {
            return Err(CapsuleErrorV1::Version);
        }
        self.manifest
            .identity
            .validate()
            .map_err(|_| CapsuleErrorV1::Manifest)?;
        self.manifest.redaction.validate()?;
        if self
            .manifest
            .redaction
            .omitted_blob_kinds
            .iter()
            .any(|kind| self.blobs.iter().any(|blob| blob.kind == *kind))
        {
            return Err(CapsuleErrorV1::Redaction);
        }
        if self.blobs.len() > limits.maximum_blob_count
            || self.manifest.blobs.len() != self.blobs.len()
            || self.blobs.is_empty()
        {
            return Err(CapsuleErrorV1::BlobTable);
        }
        if !self
            .blobs
            .windows(2)
            .all(|pair| (pair[0].kind, &pair[0].digest) < (pair[1].kind, &pair[1].digest))
            || !self
                .manifest
                .blobs
                .windows(2)
                .all(|pair| (pair[0].kind, &pair[0].digest) < (pair[1].kind, &pair[1].digest))
        {
            return Err(CapsuleErrorV1::BlobTable);
        }
        let mut stored_total = 0_u64;
        let mut decompressed_total = 0_u64;
        for (blob, reference) in self.blobs.iter().zip(&self.manifest.blobs) {
            if &blob.reference()? != reference {
                return Err(CapsuleErrorV1::BlobTable);
            }
            stored_total = stored_total
                .checked_add(reference.stored_size)
                .ok_or(CapsuleErrorV1::Size)?;
            decompressed_total = decompressed_total
                .checked_add(reference.uncompressed_size)
                .ok_or(CapsuleErrorV1::Size)?;
            blob.decode(limits)?;
        }
        if stored_total > limits.maximum_total_stored_bytes
            || decompressed_total > limits.maximum_total_decompressed_bytes
        {
            return Err(CapsuleErrorV1::Size);
        }
        let initial = self.find_blob(&self.manifest.initial_snapshot_digest)?;
        let trace = self.find_blob(&self.manifest.trace_digest)?;
        if initial.kind != CapsuleBlobKindV1::InitialSnapshot
            || trace.kind != CapsuleBlobKindV1::Trace
        {
            return Err(CapsuleErrorV1::BlobTable);
        }
        let checkpoints = self
            .blobs
            .iter()
            .filter(|blob| blob.kind == CapsuleBlobKindV1::DiagnosticCheckpoint)
            .map(|blob| blob.digest.as_str())
            .collect::<BTreeSet<_>>();
        if self
            .manifest
            .diagnostic_checkpoint_digests
            .iter()
            .any(|digest| !checkpoints.contains(digest.as_str()))
            || !is_strictly_sorted_unique(&self.manifest.diagnostic_checkpoint_digests)
        {
            return Err(CapsuleErrorV1::BlobTable);
        }
        let manifest_bytes = canonical_bytes(&self.manifest)
            .map_err(|error| CapsuleErrorV1::Canonical(error.to_string()))?;
        if u64::try_from(manifest_bytes.len()).map_err(|_| CapsuleErrorV1::Size)?
            > limits.maximum_manifest_bytes
        {
            return Err(CapsuleErrorV1::Manifest);
        }
        Ok(())
    }

    pub fn find_blob(&self, digest: &str) -> Result<&CapsuleBlobV1, CapsuleErrorV1> {
        self.blobs
            .iter()
            .find(|blob| blob.digest == digest)
            .ok_or(CapsuleErrorV1::BlobTable)
    }

    pub fn encode(&self, limits: CapsuleLimitsV1) -> Result<Vec<u8>, CapsuleErrorV1> {
        self.validate(limits)?;
        let manifest = canonical_bytes(&self.manifest)
            .map_err(|error| CapsuleErrorV1::Canonical(error.to_string()))?;
        let manifest_len = u32::try_from(manifest.len()).map_err(|_| CapsuleErrorV1::Size)?;
        let count = u32::try_from(self.blobs.len()).map_err(|_| CapsuleErrorV1::Size)?;
        let capacity = CAPSULE_MAGIC_V1
            .len()
            .checked_add(8)
            .and_then(|value| value.checked_add(manifest.len()))
            .and_then(|value| {
                self.blobs.iter().try_fold(value, |total, blob| {
                    total.checked_add(22 + blob.digest.len() + blob.payload.len())
                })
            })
            .ok_or(CapsuleErrorV1::Size)?;
        if u64::try_from(capacity).map_err(|_| CapsuleErrorV1::Size)?
            > limits.maximum_total_stored_bytes + limits.maximum_manifest_bytes + 8
        {
            return Err(CapsuleErrorV1::Size);
        }
        let mut output = Vec::with_capacity(capacity);
        output.extend_from_slice(CAPSULE_MAGIC_V1);
        output.extend_from_slice(&manifest_len.to_le_bytes());
        output.extend_from_slice(&manifest);
        output.extend_from_slice(&count.to_le_bytes());
        for blob in &self.blobs {
            output.push(kind_code(blob.kind));
            output.push(compression_code(blob.compression));
            let digest_len = u16::try_from(blob.digest.len()).map_err(|_| CapsuleErrorV1::Size)?;
            output.extend_from_slice(&digest_len.to_le_bytes());
            output.extend_from_slice(blob.digest.as_bytes());
            output.extend_from_slice(&blob.uncompressed_size.to_le_bytes());
            let payload_len =
                u64::try_from(blob.payload.len()).map_err(|_| CapsuleErrorV1::Size)?;
            output.extend_from_slice(&payload_len.to_le_bytes());
            output.extend_from_slice(&blob.payload);
        }
        Ok(output)
    }

    pub fn decode(bytes: &[u8], limits: CapsuleLimitsV1) -> Result<Self, CapsuleErrorV1> {
        limits.validate()?;
        let mut cursor = ByteCursor::new(bytes);
        if cursor.take(CAPSULE_MAGIC_V1.len())? != CAPSULE_MAGIC_V1 {
            return Err(CapsuleErrorV1::Version);
        }
        let manifest_len = usize::try_from(cursor.u32()?).map_err(|_| CapsuleErrorV1::Size)?;
        if u64::try_from(manifest_len).map_err(|_| CapsuleErrorV1::Size)?
            > limits.maximum_manifest_bytes
        {
            return Err(CapsuleErrorV1::Manifest);
        }
        let manifest: ReproCapsuleManifestV1 =
            serde_json::from_slice(cursor.take(manifest_len)?)
                .map_err(|error| CapsuleErrorV1::Json(error.to_string()))?;
        let count = usize::try_from(cursor.u32()?).map_err(|_| CapsuleErrorV1::Size)?;
        if count > limits.maximum_blob_count {
            return Err(CapsuleErrorV1::Size);
        }
        let mut blobs = Vec::with_capacity(count);
        let mut stored_total = 0_u64;
        for _ in 0..count {
            let kind = decode_kind(cursor.u8()?)?;
            let compression = decode_compression(cursor.u8()?)?;
            let digest_len = usize::from(cursor.u16()?);
            let digest = std::str::from_utf8(cursor.take(digest_len)?)
                .map_err(|_| CapsuleErrorV1::BlobTable)?
                .to_owned();
            let uncompressed_size = cursor.u64()?;
            let payload_len_u64 = cursor.u64()?;
            stored_total = stored_total
                .checked_add(payload_len_u64)
                .ok_or(CapsuleErrorV1::Size)?;
            if payload_len_u64 > limits.maximum_blob_bytes
                || stored_total > limits.maximum_total_stored_bytes
            {
                return Err(CapsuleErrorV1::Size);
            }
            let payload_len = usize::try_from(payload_len_u64).map_err(|_| CapsuleErrorV1::Size)?;
            let payload = cursor.take(payload_len)?.to_vec();
            blobs.push(CapsuleBlobV1 {
                kind,
                digest,
                uncompressed_size,
                compression,
                payload,
            });
        }
        if !cursor.is_empty() {
            return Err(CapsuleErrorV1::BlobTable);
        }
        let value = Self { manifest, blobs };
        value.validate(limits)?;
        Ok(value)
    }
}

fn raw_digest(bytes: &[u8]) -> String {
    format!("{DIGEST_PREFIX}{}", blake3::hash(bytes).to_hex())
}

fn rle_compress(bytes: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        let mut count: u8 = 1;
        while index + usize::from(count) < bytes.len()
            && bytes[index + usize::from(count)] == byte
            && count < u8::MAX
        {
            count = count.saturating_add(1);
        }
        output.push(count);
        output.push(byte);
        index += usize::from(count);
    }
    output
}

fn rle_decompress(bytes: &[u8], maximum: usize) -> Result<Vec<u8>, CapsuleErrorV1> {
    if !bytes.len().is_multiple_of(2) {
        return Err(CapsuleErrorV1::Compression);
    }
    let mut output = Vec::with_capacity(maximum.min(bytes.len().saturating_mul(2)));
    for pair in bytes.chunks_exact(2) {
        let count = usize::from(pair[0]);
        if count == 0
            || output
                .len()
                .checked_add(count)
                .is_none_or(|size| size > maximum)
        {
            return Err(CapsuleErrorV1::Compression);
        }
        output.extend(std::iter::repeat_n(pair[1], count));
    }
    Ok(output)
}

fn is_strictly_sorted_unique(values: &[String]) -> bool {
    values.windows(2).all(|pair| pair[0] < pair[1])
}

fn kind_code(kind: CapsuleBlobKindV1) -> u8 {
    match kind {
        CapsuleBlobKindV1::InitialSnapshot => 1,
        CapsuleBlobKindV1::Trace => 2,
        CapsuleBlobKindV1::DiagnosticCheckpoint => 3,
        CapsuleBlobKindV1::CausalGraph => 4,
        CapsuleBlobKindV1::PlatformEvidence => 5,
        CapsuleBlobKindV1::RenderEvidence => 6,
        CapsuleBlobKindV1::Content => 7,
        CapsuleBlobKindV1::FailureEvidence => 8,
    }
}

fn decode_kind(value: u8) -> Result<CapsuleBlobKindV1, CapsuleErrorV1> {
    match value {
        1 => Ok(CapsuleBlobKindV1::InitialSnapshot),
        2 => Ok(CapsuleBlobKindV1::Trace),
        3 => Ok(CapsuleBlobKindV1::DiagnosticCheckpoint),
        4 => Ok(CapsuleBlobKindV1::CausalGraph),
        5 => Ok(CapsuleBlobKindV1::PlatformEvidence),
        6 => Ok(CapsuleBlobKindV1::RenderEvidence),
        7 => Ok(CapsuleBlobKindV1::Content),
        8 => Ok(CapsuleBlobKindV1::FailureEvidence),
        _ => Err(CapsuleErrorV1::BlobTable),
    }
}

fn compression_code(value: CapsuleCompressionV1) -> u8 {
    match value {
        CapsuleCompressionV1::None => 0,
        CapsuleCompressionV1::RleV1 => 1,
    }
}

fn decode_compression(value: u8) -> Result<CapsuleCompressionV1, CapsuleErrorV1> {
    match value {
        0 => Ok(CapsuleCompressionV1::None),
        1 => Ok(CapsuleCompressionV1::RleV1),
        _ => Err(CapsuleErrorV1::Compression),
    }
}

struct ByteCursor<'bytes> {
    bytes: &'bytes [u8],
    offset: usize,
}

impl<'bytes> ByteCursor<'bytes> {
    fn new(bytes: &'bytes [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(&mut self, count: usize) -> Result<&'bytes [u8], CapsuleErrorV1> {
        let end = self.offset.checked_add(count).ok_or(CapsuleErrorV1::Size)?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or(CapsuleErrorV1::BlobTable)?;
        self.offset = end;
        Ok(value)
    }

    fn u8(&mut self) -> Result<u8, CapsuleErrorV1> {
        self.take(1)?
            .first()
            .copied()
            .ok_or(CapsuleErrorV1::BlobTable)
    }

    fn u16(&mut self) -> Result<u16, CapsuleErrorV1> {
        let bytes: [u8; 2] = self
            .take(2)?
            .try_into()
            .map_err(|_| CapsuleErrorV1::BlobTable)?;
        Ok(u16::from_le_bytes(bytes))
    }

    fn u32(&mut self) -> Result<u32, CapsuleErrorV1> {
        let bytes: [u8; 4] = self
            .take(4)?
            .try_into()
            .map_err(|_| CapsuleErrorV1::BlobTable)?;
        Ok(u32::from_le_bytes(bytes))
    }

    fn u64(&mut self) -> Result<u64, CapsuleErrorV1> {
        let bytes: [u8; 8] = self
            .take(8)?
            .try_into()
            .map_err(|_| CapsuleErrorV1::BlobTable)?;
        Ok(u64::from_le_bytes(bytes))
    }

    fn is_empty(&self) -> bool {
        self.offset == self.bytes.len()
    }
}
