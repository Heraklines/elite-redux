//! Bounded CLI process transport reused from the qualified query witness.
use super::*;

struct IdentityDirectory(PathBuf);
impl Drop for IdentityDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// One bounded response in flight, continuously drained stderr, bounded teardown.
pub(super) struct Cli {
    child: Child,
    input: Option<mpsc::SyncSender<WriteJob>>,
    writer: Option<std::thread::JoinHandle<()>>,
    responses: Option<mpsc::Receiver<Line>>,
    reader: Option<std::thread::JoinHandle<()>>,
    stderr: Option<std::thread::JoinHandle<Vec<u8>>>,
    next: u64,
    _identity: Option<IdentityDirectory>,
}

impl Cli {
    pub(super) fn new(worker: bool, content: &PreparedGameContentV2) -> TestResult<Self> {
        let mut command = Command::new(env!("CARGO_BIN_EXE_er-cli"));
        command
            .args(["agent", "--protocol", "jsonl", "--content"])
            .arg(content_path());
        let identity = if worker {
            let executable = PathBuf::from(std::env::var("ER_M9E_WORKER_EXECUTABLE")?);
            assert!(executable.is_absolute());
            let hash = std::env::var("ER_M9E_WORKER_EXECUTABLE_SHA256")?;
            let identity = KernelGenerationIdentityV2 {
                schema_version: 2,
                session_id: KernelSessionIdV1(SESSION.to_owned()),
                generation: KernelGenerationV1(1),
                artifact_sha256: hash.clone(),
                executable_sha256: hash,
                source_git_sha: std::env::var("ER_M9E_WORKER_SOURCE_SHA")?,
                worker_abi_version: KERNEL_WORKER_ABI_VERSION_V2,
                minimum_snapshot_schema: 7,
                maximum_snapshot_schema: 7,
                content_identity: content.identity().clone(),
                build_target: std::env::var("ER_M9E_WORKER_BUILD_TARGET")?,
                build_profile: std::env::var("ER_M9E_WORKER_BUILD_PROFILE")?,
            };
            let artifact = VerifiedKernelExecutableV2::verify(
                executable.parent().ok_or("worker parent")?,
                &executable,
                identity,
            )?;
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_nanos();
            let directory = IdentityDirectory(
                std::env::temp_dir().join(format!("m9e-coop-{}-{nonce}", std::process::id())),
            );
            std::fs::create_dir(&directory.0)?;
            let path = directory.0.join("identity.json");
            std::fs::write(&path, serde_json::to_vec(artifact.identity())?)?;
            command
                .arg("--worker-executable")
                .arg(artifact.executable())
                .arg("--worker-root")
                .arg(artifact.allowed_root())
                .arg("--worker-identity")
                .arg(path);
            Some(directory)
        } else {
            None
        };
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        let mut input = child.stdin.take().ok_or("CLI stdin")?;
        let stdout = child.stdout.take().ok_or("CLI stdout")?;
        let mut stderr = child.stderr.take().ok_or("CLI stderr")?;
        let (input_sender, input_receiver) = mpsc::sync_channel::<WriteJob>(1);
        let writer = std::thread::spawn(move || {
            while let Ok((bytes, completed)) = input_receiver.recv() {
                let result = input
                    .write_all(&bytes)
                    .and_then(|()| input.flush())
                    .map_err(|error| error.to_string());
                let failed = result.is_err();
                let _ = completed.send(result);
                if failed {
                    break;
                }
            }
        });
        let (sender, responses) = mpsc::sync_channel(1);
        let reader = std::thread::spawn(move || {
            let mut output = BufReader::new(stdout);
            loop {
                let mut line = Vec::new();
                let next = match output
                    .by_ref()
                    .take((RESPONSE_BOUND + 1) as u64)
                    .read_until(b'\n', &mut line)
                {
                    Ok(0) => Ok(None),
                    Ok(_) if line.len() > RESPONSE_BOUND || !line.ends_with(b"\n") => {
                        Err("response exceeds bound or is unterminated".to_owned())
                    }
                    Ok(_) => Ok(Some(line)),
                    Err(error) => Err(error.to_string()),
                };
                let finished = !matches!(&next, Ok(Some(_)));
                if sender.send(next).is_err() || finished {
                    break;
                }
            }
        });
        let stderr = std::thread::spawn(move || {
            let mut retained = Vec::new();
            let mut buffer = [0_u8; 4096];
            while let Ok(count) = stderr.read(&mut buffer) {
                if count == 0 {
                    break;
                }
                let keep = count.min((64_usize << 10).saturating_sub(retained.len()));
                retained.extend_from_slice(&buffer[..keep]);
            }
            retained
        });
        Ok(Self {
            child,
            input: Some(input_sender),
            writer: Some(writer),
            responses: Some(responses),
            reader: Some(reader),
            stderr: Some(stderr),
            next: 0,
            _identity: identity,
        })
    }

    fn request(&mut self, method: &str, params: Value) -> TestResult<Value> {
        self.next += 1;
        self.request_id(method, params, &format!("coop-{}", self.next))
    }

    fn request_id(&mut self, method: &str, params: Value, id: &str) -> TestResult<Value> {
        let mut bytes = serde_json::to_vec(
            &json!({"protocol_version": 1, "id": id, "method": method, "params": params}),
        )?;
        assert!(bytes.len() < LINE_BOUND);
        bytes.push(b'\n');
        let (sent, completed) = mpsc::sync_channel(1);
        self.input
            .as_ref()
            .ok_or("CLI input")?
            .try_send((bytes, sent))
            .map_err(|_| "CLI writer unavailable")?;
        completed.recv_timeout(Duration::from_secs(60))??;
        let line = self
            .responses
            .as_ref()
            .ok_or("CLI receiver")?
            .recv_timeout(Duration::from_secs(60))??
            .ok_or("unexpected EOF")?;
        let response: Value = serde_json::from_slice(&line)?;
        assert_eq!(response["protocol_version"], 1);
        assert_eq!(response["id"], id);
        Ok(response)
    }

    pub(super) fn result(&mut self, method: &str, params: Value) -> TestResult<Value> {
        let mut response = self.request(method, params)?;
        assert!(
            response["error"].is_null(),
            "unexpected CLI error: {response}"
        );
        Ok(response.get_mut("result").ok_or("missing result")?.take())
    }

    pub(super) fn finish(mut self) -> TestResult {
        drop(self.input.take());
        assert!(
            self.responses
                .as_ref()
                .ok_or("CLI receiver")?
                .recv_timeout(Duration::from_secs(5))??
                .is_none(),
            "extra response"
        );
        let started = Instant::now();
        loop {
            if let Some(status) = self.child.try_wait()? {
                assert!(status.success(), "CLI exit: {status}");
                return Ok(());
            }
            if started.elapsed() >= Duration::from_secs(5) {
                return Err("CLI exit deadline".into());
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for Cli {
    fn drop(&mut self) {
        drop(self.responses.take());
        drop(self.input.take());
        #[cfg(unix)]
        {
            let _ = Command::new("/bin/kill")
                .args(["-KILL", "--", &format!("-{}", self.child.id())])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        let _ = self.child.kill();
        let started = Instant::now();
        while matches!(self.child.try_wait(), Ok(None))
            && started.elapsed() < Duration::from_secs(5)
        {
            std::thread::sleep(Duration::from_millis(10));
        }
        if let Some(writer) = self
            .writer
            .take()
            .filter(std::thread::JoinHandle::is_finished)
        {
            let _ = writer.join();
        }
        if let Some(reader) = self
            .reader
            .take()
            .filter(std::thread::JoinHandle::is_finished)
        {
            let _ = reader.join();
        }
        if let Some(stderr) = self
            .stderr
            .take()
            .filter(std::thread::JoinHandle::is_finished)
            && let Ok(bytes) = stderr.join()
            && !bytes.is_empty()
        {
            let _ = std::io::stderr().write_all(&bytes);
        }
    }
}
