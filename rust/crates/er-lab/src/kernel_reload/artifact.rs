use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use er_kernel_worker::GenerationArtifactManifestV1;
use sha2::{Digest, Sha256};

use super::types::KernelReloadErrorV1;

#[derive(Clone, Debug)]
pub struct ImmutableKernelArtifactCacheV1 {
    root: PathBuf,
    maximum_artifact_bytes: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedKernelArtifactV1 {
    pub directory: PathBuf,
    pub executable: PathBuf,
    pub manifest: GenerationArtifactManifestV1,
}

impl ImmutableKernelArtifactCacheV1 {
    pub fn new(root: PathBuf, maximum_artifact_bytes: u64) -> Result<Self, KernelReloadErrorV1> {
        if maximum_artifact_bytes == 0 {
            return Err(KernelReloadErrorV1::Artifact(
                "zero artifact bound".to_owned(),
            ));
        }
        fs::create_dir_all(&root)
            .map_err(|error| KernelReloadErrorV1::Artifact(error.to_string()))?;
        let root = fs::canonicalize(root)
            .map_err(|error| KernelReloadErrorV1::Artifact(error.to_string()))?;
        Ok(Self {
            root,
            maximum_artifact_bytes,
        })
    }

    pub fn install(
        &self,
        source_executable: &Path,
        manifest: GenerationArtifactManifestV1,
    ) -> Result<VerifiedKernelArtifactV1, KernelReloadErrorV1> {
        manifest
            .identity
            .validate()
            .map_err(|error| KernelReloadErrorV1::Artifact(error.to_string()))?;
        let metadata = fs::symlink_metadata(source_executable)
            .map_err(|error| KernelReloadErrorV1::Artifact(error.to_string()))?;
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.len() == 0
            || metadata.len() > self.maximum_artifact_bytes
            || metadata.len() != manifest.executable_bytes
        {
            return Err(KernelReloadErrorV1::Artifact(
                "invalid executable metadata".to_owned(),
            ));
        }
        let bytes = fs::read(source_executable)
            .map_err(|error| KernelReloadErrorV1::Artifact(error.to_string()))?;
        if sha256(&bytes) != manifest.identity.executable_sha256 {
            return Err(KernelReloadErrorV1::Artifact(
                "executable digest mismatch".to_owned(),
            ));
        }
        let directory = self.root.join(&manifest.identity.artifact_sha256);
        if directory.exists() {
            return self.verify(&directory);
        }
        fs::create_dir(&directory)
            .map_err(|error| KernelReloadErrorV1::Artifact(error.to_string()))?;
        let executable = directory.join(&manifest.executable_name);
        fs::write(&executable, &bytes)
            .map_err(|error| KernelReloadErrorV1::Artifact(error.to_string()))?;
        let manifest_bytes = serde_json::to_vec(&manifest)
            .map_err(|error| KernelReloadErrorV1::Artifact(error.to_string()))?;
        fs::write(directory.join("generation-manifest.json"), manifest_bytes)
            .map_err(|error| KernelReloadErrorV1::Artifact(error.to_string()))?;
        self.verify(&directory)
    }

    pub fn verify(
        &self,
        directory: &Path,
    ) -> Result<VerifiedKernelArtifactV1, KernelReloadErrorV1> {
        let directory = fs::canonicalize(directory)
            .map_err(|error| KernelReloadErrorV1::Artifact(error.to_string()))?;
        if !directory.starts_with(&self.root) {
            return Err(KernelReloadErrorV1::Artifact(
                "artifact escaped cache root".to_owned(),
            ));
        }
        let manifest_bytes = fs::read(directory.join("generation-manifest.json"))
            .map_err(|error| KernelReloadErrorV1::Artifact(error.to_string()))?;
        if manifest_bytes.is_empty() || manifest_bytes.len() > 65_536 {
            return Err(KernelReloadErrorV1::Artifact("manifest size".to_owned()));
        }
        let manifest: GenerationArtifactManifestV1 = serde_json::from_slice(&manifest_bytes)
            .map_err(|error| KernelReloadErrorV1::Artifact(error.to_string()))?;
        manifest
            .identity
            .validate()
            .map_err(|error| KernelReloadErrorV1::Artifact(error.to_string()))?;
        if directory.file_name().and_then(|name| name.to_str())
            != Some(&manifest.identity.artifact_sha256)
        {
            return Err(KernelReloadErrorV1::Artifact(
                "artifact directory identity".to_owned(),
            ));
        }
        let executable = directory.join(&manifest.executable_name);
        let metadata = fs::symlink_metadata(&executable)
            .map_err(|error| KernelReloadErrorV1::Artifact(error.to_string()))?;
        if metadata.file_type().is_symlink()
            || metadata.len() != manifest.executable_bytes
            || metadata.len() > self.maximum_artifact_bytes
        {
            return Err(KernelReloadErrorV1::Artifact(
                "cached executable metadata".to_owned(),
            ));
        }
        let bytes = fs::read(&executable)
            .map_err(|error| KernelReloadErrorV1::Artifact(error.to_string()))?;
        if sha256(&bytes) != manifest.identity.executable_sha256 {
            return Err(KernelReloadErrorV1::Artifact(
                "cached executable digest".to_owned(),
            ));
        }
        Ok(VerifiedKernelArtifactV1 {
            directory,
            executable,
            manifest,
        })
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct KernelBuildImpactV1;

impl KernelBuildImpactV1 {
    pub fn requires_kernel_rebuild(&self, changed_paths: &[String]) -> bool {
        changed_paths.iter().any(|path| {
            path == "rust/Cargo.toml"
                || path == "rust/Cargo.lock"
                || path.starts_with("rust/contracts/m81-")
                || path.starts_with("rust/crates/")
                    && matches!(
                        Path::new(path).extension().and_then(|value| value.to_str()),
                        Some("rs" | "toml")
                    )
        })
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct KernelBuildWatcherV1 {
    fingerprints: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct KernelBuildDecisionV1 {
    pub changed_paths: Vec<String>,
    pub rebuild_kernel: bool,
}

impl KernelBuildWatcherV1 {
    pub fn observe(
        &mut self,
        files: &[(String, PathBuf)],
    ) -> Result<KernelBuildDecisionV1, KernelReloadErrorV1> {
        let mut next = BTreeMap::new();
        for (relative, path) in files {
            if relative.is_empty() || relative.contains('\\') || relative.starts_with('/') {
                return Err(KernelReloadErrorV1::Artifact(
                    "build watcher path is not repository-relative".to_owned(),
                ));
            }
            let bytes =
                fs::read(path).map_err(|error| KernelReloadErrorV1::Artifact(error.to_string()))?;
            next.insert(relative.clone(), sha256(&bytes));
        }
        let mut changed_paths = next
            .iter()
            .filter(|(path, digest)| self.fingerprints.get(*path) != Some(*digest))
            .map(|(path, _)| path.clone())
            .collect::<Vec<_>>();
        changed_paths.extend(
            self.fingerprints
                .keys()
                .filter(|path| !next.contains_key(*path))
                .cloned(),
        );
        changed_paths.sort();
        changed_paths.dedup();
        self.fingerprints = next;
        Ok(KernelBuildDecisionV1 {
            rebuild_kernel: KernelBuildImpactV1.requires_kernel_rebuild(&changed_paths),
            changed_paths,
        })
    }
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
