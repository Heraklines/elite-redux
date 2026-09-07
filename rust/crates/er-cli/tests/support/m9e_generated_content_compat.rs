//! Bounded actual CLI pipes, adapted from m9e_current_native_capture at 9fbb9fa2.
use super::TestResult;
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};
type Line = Result<Option<Vec<u8>>, String>;
type WriteJob = (Vec<u8>, mpsc::SyncSender<Result<(), String>>);
const RESPONSE_BOUND: u64 = 8 << 20;
pub(super) struct Cli {
    child: Child,
    input: Option<mpsc::SyncSender<WriteJob>>,
    writer: Option<std::thread::JoinHandle<()>>,
    responses: Option<mpsc::Receiver<Line>>,
    reader: Option<std::thread::JoinHandle<()>>,
    stderr: Option<std::thread::JoinHandle<Vec<u8>>>,
    next: u64,
}

impl Cli {
    fn write_line(&self, bytes: &[u8]) -> TestResult {
        assert!(bytes.len() <= (4 << 20) + 1, "bounded ingress fixture");
        let mut line = bytes.to_vec();
        line.push(b'\n');
        let (sent, completed) = mpsc::sync_channel(1);
        // Only one request can be in flight. A full queue is a helper failure,
        // never a reason to block the test thread indefinitely.
        self.input
            .as_ref()
            .ok_or("closed CLI stdin")?
            .try_send((line, sent))
            .map_err(|_| "CLI writer is unavailable")?;
        completed.recv_timeout(Duration::from_secs(60))??;
        Ok(())
    }
    pub(super) fn new(content: &Path, maximum: usize) -> TestResult<Self> {
        let mut command = Command::new(env!("CARGO_BIN_EXE_er-cli"));
        command
            .args(["agent", "--protocol", "jsonl", "--content"])
            .arg(content)
            .arg("--maximum-sessions")
            .arg(maximum.to_string());
        Self::spawn(command)
    }
    fn spawn(mut command: Command) -> TestResult<Self> {
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
                    .take(RESPONSE_BOUND + 1)
                    .read_until(b'\n', &mut line)
                {
                    Ok(0) => Ok(None),
                    Ok(_) if line.len() as u64 > RESPONSE_BOUND || !line.ends_with(b"\n") => {
                        Err("CLI response exceeded line bound or was unterminated".to_owned())
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
        })
    }
    pub(super) fn request(&mut self, method: &str, params: Value) -> TestResult<Value> {
        self.next += 1;
        let id = format!("compat-{}", self.next);
        self.request_id(method, params, &id)
    }
    fn request_id(&mut self, method: &str, params: Value, id: &str) -> TestResult<Value> {
        let request = json!({"protocol_version": 1, "id": id, "method": method, "params": params});
        let bytes = serde_json::to_vec(&request)?;
        assert!(
            bytes.len() < 4 << 20,
            "fixture request exceeds current transport bound"
        );
        self.write_line(&bytes)?;
        let line = self
            .responses
            .as_ref()
            .ok_or("CLI receiver")?
            .recv_timeout(Duration::from_secs(60))??
            .ok_or("unexpected CLI EOF")?;
        let response: Value = serde_json::from_slice(&line)?;
        assert_eq!(response["protocol_version"], 1);
        assert!(
            response["id"].as_str() == Some(id),
            "response request ID mismatch"
        );
        Ok(response)
    }
    pub(super) fn result(&mut self, method: &str, params: Value) -> TestResult<Value> {
        let mut response = self.request(method, params)?;
        assert!(
            response["error"].is_null(),
            "unexpected CLI error: {response}"
        );
        Ok(response
            .get_mut("result")
            .ok_or("missing inline result")?
            .take())
    }
    pub(super) fn rejects(&mut self, method: &str, params: Value, category: &str) -> TestResult {
        let response = self.request(method, params)?;
        assert!(
            response["result"].is_null(),
            "failed transaction published results"
        );
        assert_eq!(response["error"]["code"], "BACKEND_ERROR");
        assert!(
            response["error"]["message"]
                .as_str()
                .is_some_and(|text| text.contains(category)),
            "wrong failure category: {response}"
        );
        Ok(())
    }
    pub(super) fn finish(mut self) -> TestResult {
        drop(self.input.take());
        assert!(
            self.responses
                .as_ref()
                .ok_or("CLI receiver")?
                .recv_timeout(Duration::from_secs(5))??
                .is_none(),
            "unsolicited extra output"
        );
        let start = Instant::now();
        loop {
            if let Some(status) = self.child.try_wait()? {
                assert!(status.success(), "CLI exited unsuccessfully: {status}");
                return Ok(());
            }
            if start.elapsed() >= Duration::from_secs(5) {
                return Err("CLI exit deadline".into());
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
impl Drop for Cli {
    fn drop(&mut self) {
        // Drop the receiver first so a reader blocked on its one-slot send exits.
        drop(self.responses.take());
        drop(self.input.take());
        let _ = self.child.kill();
        let start = Instant::now();
        while matches!(self.child.try_wait(), Ok(None)) && start.elapsed() < Duration::from_secs(5)
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
