use std::fs;

use er_kernel_worker::{
    GenerationArtifactManifestV1, KernelGenerationIdentityV1, KernelGenerationV1, KernelSessionIdV1,
};
use er_lab::kernel_reload::{ImmutableKernelArtifactCacheV1, KernelBuildWatcherV1};
use sha2::{Digest, Sha256};

#[test]
fn immutable_cache_verifies_bytes_and_build_watcher_selects_rust_impacts()
-> Result<(), Box<dyn std::error::Error>> {
    let root = std::env::temp_dir().join(format!("er-m81-cache-{}", std::process::id()));
    if root.exists() {
        fs::remove_dir_all(&root)?;
    }
    fs::create_dir_all(&root)?;
    let source = root.join("worker.bin");
    let bytes = b"worker-generation-one";
    fs::write(&source, bytes)?;
    let artifact_sha = "a".repeat(64);
    let manifest = GenerationArtifactManifestV1 {
        schema_version: 1,
        identity: KernelGenerationIdentityV1 {
            schema_version: 1,
            session_id: KernelSessionIdV1("artifact-session".to_owned()),
            generation: KernelGenerationV1(1),
            artifact_sha256: artifact_sha.clone(),
            executable_sha256: format!("{:x}", Sha256::digest(bytes)),
            source_git_sha: "b".repeat(40),
            worker_abi_version: 1,
            minimum_snapshot_schema: 6,
            maximum_snapshot_schema: 6,
            content_identity: "content".to_owned(),
            build_target: "test".to_owned(),
            build_profile: "release".to_owned(),
        },
        executable_name: "worker.bin".to_owned(),
        executable_bytes: bytes.len() as u64,
        created_unix_seconds: 1,
    };
    let cache_root = root.join("cache");
    let cache = ImmutableKernelArtifactCacheV1::new(cache_root, 1024)?;
    let installed = cache.install(&source, manifest)?;
    assert_eq!(installed.manifest.identity.artifact_sha256, artifact_sha);
    assert!(cache.verify(&installed.directory).is_ok());
    fs::write(&installed.executable, b"tampered")?;
    assert!(cache.verify(&installed.directory).is_err());

    let watched = root.join("watched.rs");
    fs::write(&watched, b"fn one() {}")?;
    let files = vec![("rust/crates/example/src/lib.rs".to_owned(), watched.clone())];
    let mut watcher = KernelBuildWatcherV1::default();
    let initial = watcher.observe(&files)?;
    assert!(initial.rebuild_kernel);
    assert!(watcher.observe(&files)?.changed_paths.is_empty());
    fs::write(&watched, b"fn two() {}")?;
    let changed = watcher.observe(&files)?;
    assert!(changed.rebuild_kernel);
    assert_eq!(
        changed.changed_paths,
        vec!["rust/crates/example/src/lib.rs"]
    );
    fs::remove_dir_all(root)?;
    Ok(())
}
