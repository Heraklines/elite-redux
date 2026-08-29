use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{RunOutcome, SafeU53};
use er_web::{
    BROWSER_WORKER_PROTOCOL_VERSION_V1, BrowserExecutionModeV1, BrowserInitV1, BrowserKernelHostV1,
    BrowserRequestEnvelopeV1, BrowserRequestV1, BrowserResponseEnvelopeV1, BrowserResponseV1,
};

const CONTENT: &[u8] = include_bytes!("../../../fixtures/m8/browser-reference/content-pack.json");
const IDENTITY: &[u8] =
    include_bytes!("../../../fixtures/m8/browser-reference/execution-identity.bin");
const SESSION: &[u8] = include_bytes!("../../../fixtures/m8/browser-reference/session-start.json");
const EXPECTED_DIGEST: &str =
    include_str!("../../../fixtures/m8/browser-reference/expected-terminal-digest.txt");

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn safe(value: u64) -> Result<SafeU53, er_types::SafeU53Error> {
    SafeU53::new(value)
}

#[test]
fn native_browser_host_reaches_the_frozen_terminal_digest_from_raw_keys() -> TestResult {
    let mut host = BrowserKernelHostV1::create(CONTENT, SESSION)
        .map_err(|_| "native browser host creation failed")?;
    let initialize = BrowserRequestEnvelopeV1 {
        version: BROWSER_WORKER_PROTOCOL_VERSION_V1,
        request_id: safe(1)?,
        sequence: safe(1)?,
        request: BrowserRequestV1::Initialize(BrowserInitV1 {
            mode: BrowserExecutionModeV1::RustLocalAuthority,
            execution_identity_bytes: IDENTITY.to_vec(),
            session_start_bytes: SESSION.to_vec(),
            maximum_pending_requests: 8,
        }),
    };
    let ready_bytes = er_canonical::canonical_bytes(&vec![initialize])?;
    let ready_encoded = host
        .dispatch_batch(&ready_bytes)
        .map_err(|_| "native browser initialization dispatch failed")?;
    assert_eq!(
        host.dispatch_batch(&ready_bytes)
            .map_err(|_| "native duplicate initialization dispatch failed")?,
        ready_encoded
    );
    let ready: Vec<BrowserResponseEnvelopeV1> = serde_json::from_slice(&ready_encoded)?;
    assert!(matches!(
        ready.first().map(|response| &response.response),
        Some(BrowserResponseV1::Ready { .. })
    ));

    let raw = vec![
        BrowserRequestEnvelopeV1 {
            version: BROWSER_WORKER_PROTOCOL_VERSION_V1,
            request_id: safe(2)?,
            sequence: safe(2)?,
            request: BrowserRequestV1::RawInput(RawInputEvent::KeyDown {
                code: PhysicalKey::Space,
                printable: true,
                browser_repeat: false,
                focus: InputFocus::Game,
            }),
        },
        BrowserRequestEnvelopeV1 {
            version: BROWSER_WORKER_PROTOCOL_VERSION_V1,
            request_id: safe(3)?,
            sequence: safe(3)?,
            request: BrowserRequestV1::RawInput(RawInputEvent::KeyUp {
                code: PhysicalKey::Space,
            }),
        },
    ];
    let raw_bytes = er_canonical::canonical_bytes(&raw)?;
    let raw_encoded = host
        .dispatch_batch(&raw_bytes)
        .map_err(|_| "native browser raw-input dispatch failed")?;
    assert_eq!(
        host.dispatch_batch(&raw_bytes)
            .map_err(|_| "native duplicate raw-input dispatch failed")?,
        raw_encoded
    );
    let responses: Vec<BrowserResponseEnvelopeV1> = serde_json::from_slice(&raw_encoded)?;
    assert_eq!(
        responses
            .last()
            .map(|response| response.after_mechanical_digest.as_str()),
        Some(EXPECTED_DIGEST.trim())
    );
    let snapshot: er_kernel::snapshot_v6::RestorableKernelSnapshotV6 =
        serde_json::from_slice(&host.snapshot().map_err(|_| "native snapshot failed")?)?;
    assert_eq!(
        snapshot
            .game_state
            .active_run
            .as_ref()
            .map(|run| run.outcome),
        Some(RunOutcome::Victory)
    );
    host.dispose();
    Ok(())
}
