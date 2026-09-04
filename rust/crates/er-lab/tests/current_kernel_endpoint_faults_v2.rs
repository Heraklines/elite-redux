#![cfg(target_os = "linux")]

//! Deliberately invalid transport peers. These tests are not game execution evidence.

use std::error::Error;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use er_kernel_worker::{
    KERNEL_WORKER_ABI_VERSION_V2, KernelGenerationIdentityV2, KernelGenerationV1, KernelSessionIdV1,
};
use er_lab::kernel_reload::{
    ChildKernelGenerationV2, KernelEndpointErrorV2, KernelWorkerDeadlinesV2,
    VerifiedKernelExecutableV2,
};
use sha2::{Digest, Sha256};

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

const SILENT_PEER: &[u8] = b"#!/bin/sh\nprintf '%s\\n' \"$$\" > peer.pid\nexec /bin/sleep 60\n";
const MALFORMED_PEER: &[u8] = b"#!/bin/sh\nprintf '%s\\n' \"$$\" > peer.pid\nprintf '\\000\\000\\000\\001{'\nexec /bin/sleep 60\n";

#[derive(Debug)]
struct FaultPeer {
    directory: PathBuf,
}

impl FaultPeer {
    fn create(bytes: &[u8]) -> Result<(Self, VerifiedKernelExecutableV2), Box<dyn Error>> {
        let serial = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "er-lab-current-fault-peer-{}-{timestamp}-{serial}",
            std::process::id(),
        ));
        fs::create_dir(&directory)?;
        let peer = Self { directory };
        let executable = peer.directory.join("peer.sh");
        fs::write(&executable, bytes)?;
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700))?;
        let digest = format!("{:x}", Sha256::digest(bytes));
        // The fixture never initializes a game. These explicit dummy hashes label
        // its protocol envelope; they do not claim prepared or published content.
        let content_identity = serde_json::from_value(serde_json::json!({
            "oracle_sha": "0".repeat(40),
            "bundle_hash": format!("blake3-v1:{}", "0".repeat(64)),
            "battle_hash": format!("blake3-v3:{}", "0".repeat(64)),
            "run_hash": "0".repeat(64),
            "progression_hash": "0".repeat(64),
            "world_hash": "0".repeat(64),
            "scenario_hash": "0".repeat(64),
            "ai_hash": "0".repeat(64),
            "bootstrap_hash": "0".repeat(64),
            "presentation_hash": "0".repeat(64),
            "semantic_catalog_hash": "0".repeat(64),
        }))?;
        let identity = KernelGenerationIdentityV2 {
            schema_version: 2,
            session_id: KernelSessionIdV1(format!("deliberately-invalid-transport-{serial}")),
            generation: KernelGenerationV1(1),
            artifact_sha256: digest.clone(),
            executable_sha256: digest,
            source_git_sha: "0".repeat(40),
            worker_abi_version: KERNEL_WORKER_ABI_VERSION_V2,
            minimum_snapshot_schema: 7,
            maximum_snapshot_schema: 7,
            content_identity,
            build_target: "linux-shell-transport-fault-fixture".to_owned(),
            build_profile: "test-fixture".to_owned(),
        };
        let verified = VerifiedKernelExecutableV2::verify(&peer.directory, executable, identity)?;
        Ok((peer, verified))
    }

    fn pid(&self) -> Result<u32, Box<dyn Error>> {
        let pid = fs::read_to_string(self.directory.join("peer.pid"))?
            .trim()
            .parse::<u32>()?;
        if pid <= 1 {
            return Err("fault peer recorded an invalid PID".into());
        }
        Ok(pid)
    }

    fn assert_reaped(&self) -> Result<(), Box<dyn Error>> {
        let pid = self.pid()?;
        let process = PathBuf::from(format!("/proc/{pid}"));
        let deadline = Instant::now() + Duration::from_secs(2);
        while process.exists() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        // Linux retains /proc entries for zombies, so absence proves exit and
        // reaping, rather than merely successful delivery of a kill signal.
        assert!(
            !process.exists(),
            "fault peer {pid} is still alive or unreaped"
        );
        Ok(())
    }
}

impl Drop for FaultPeer {
    fn drop(&mut self) {
        // Failure cleanup targets only the recorded child of this test process.
        // This branch is not the success witness; assert_reaped runs before Drop.
        if let Ok(pid) = self.pid()
            && let Ok(status) = fs::read_to_string(format!("/proc/{pid}/status"))
            && status.lines().any(|line| {
                line.strip_prefix("PPid:")
                    .and_then(|value| value.trim().parse::<u32>().ok())
                    == Some(std::process::id())
            })
        {
            let _ = Command::new("/bin/kill")
                .arg("-KILL")
                .arg(pid.to_string())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        // This exact directory was created exclusively by this fixture.
        let _ = fs::remove_dir_all(&self.directory);
    }
}

fn reject_peer(bytes: &[u8]) -> Result<KernelEndpointErrorV2, Box<dyn Error>> {
    let (peer, artifact) = FaultPeer::create(bytes)?;
    let started = Instant::now();
    let result = ChildKernelGenerationV2::spawn_with_deadlines(
        &artifact,
        KernelWorkerDeadlinesV2 {
            request_timeout: Duration::from_millis(200),
            shutdown_timeout: Duration::from_secs(1),
        },
    );
    let error = result.expect_err("an invalid transport peer must never become a ready endpoint");
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "transport failure cleanup exceeded its bound"
    );
    peer.assert_reaped()?;
    Ok(error)
}

#[test]
fn silent_transport_peer_times_out_and_is_reaped() -> Result<(), Box<dyn Error>> {
    assert!(matches!(
        reject_peer(SILENT_PEER)?,
        KernelEndpointErrorV2::Deadline(_)
    ));
    Ok(())
}

#[test]
fn malformed_transport_peer_is_rejected_and_reaped() -> Result<(), Box<dyn Error>> {
    assert!(matches!(
        reject_peer(MALFORMED_PEER)?,
        KernelEndpointErrorV2::Process(_) | KernelEndpointErrorV2::Protocol(_)
    ));
    Ok(())
}
