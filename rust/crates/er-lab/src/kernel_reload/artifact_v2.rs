//! Read-only executable verification. This does not install or copy artifacts.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use er_kernel_worker::KernelGenerationIdentityV2;
use sha2::{Digest, Sha256};

use super::types_v2::KernelEndpointErrorV2;

/// The executable digest is verified against bytes inside the allowed root.
/// Source/build metadata remains an explicit assertion from the build producer;
/// this reference is not an independent source-to-binary attestation.
#[derive(Clone, Debug)]
pub struct VerifiedKernelExecutableV2 {
    allowed_root: PathBuf,
    executable: PathBuf,
    identity: KernelGenerationIdentityV2,
}

impl VerifiedKernelExecutableV2 {
    pub fn verify(
        allowed_root: impl AsRef<Path>,
        executable: impl AsRef<Path>,
        identity: KernelGenerationIdentityV2,
    ) -> Result<Self, KernelEndpointErrorV2> {
        identity.validate().map_err(artifact_error)?;
        let allowed_root = allowed_root.as_ref().canonicalize().map_err(artifact_error)?;
        if !allowed_root.is_dir() {
            return Err(artifact_error("allowed root is not a directory"));
        }
        let executable = executable.as_ref().canonicalize().map_err(artifact_error)?;
        if !executable.starts_with(&allowed_root) || !executable.is_file() {
            return Err(artifact_error("executable is not a file inside the allowed root"));
        }
        let mut file = File::open(&executable).map_err(artifact_error)?;
        let mut digest = Sha256::new();
        let mut buffer = [0_u8; 65_536];
        loop {
            let count = file.read(&mut buffer).map_err(artifact_error)?;
            if count == 0 {
                break;
            }
            digest.update(&buffer[..count]);
        }
        if format!("{:x}", digest.finalize()) != identity.executable_sha256 {
            return Err(artifact_error("executable digest differs from expected identity"));
        }
        Ok(Self { allowed_root, executable, identity })
    }

    pub fn identity(&self) -> &KernelGenerationIdentityV2 {
        &self.identity
    }

    pub fn executable(&self) -> &Path {
        &self.executable
    }

    pub fn allowed_root(&self) -> &Path {
        &self.allowed_root
    }

    /// Repeat verification immediately before spawn. The artifact directory must
    /// remain immutable during execution: portable path-based spawn cannot lock
    /// the verified file identity atomically with process creation.
    pub(crate) fn reverify(&self) -> Result<(), KernelEndpointErrorV2> {
        let verified = Self::verify(&self.allowed_root, &self.executable, self.identity.clone())?;
        if verified.executable != self.executable || verified.allowed_root != self.allowed_root {
            return Err(artifact_error("verified executable path changed"));
        }
        Ok(())
    }
}

fn artifact_error(error: impl ToString) -> KernelEndpointErrorV2 {
    KernelEndpointErrorV2::Artifact(error.to_string())
}
