use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{RunOutcome, SafeU53};
use er_web::{
    BROWSER_WORKER_PROTOCOL_VERSION_V1, BrowserEffectV1, BrowserExecutionModeV1, BrowserInitV1,
    BrowserKernelHostV1, BrowserRequestEnvelopeV1, BrowserRequestV1, BrowserResponseEnvelopeV1,
    BrowserResponseV1,
};

const CONTENT: &[u8] = include_bytes!("../../../fixtures/m8/browser-reference/content-pack.json");
const IDENTITY: &[u8] =
    include_bytes!("../../../fixtures/m8/browser-reference/execution-identity.bin");
const SESSION: &[u8] = include_bytes!("../../../fixtures/m8/browser-reference/session-start.json");
const AUTHORITY_SESSION: &[u8] =
    include_bytes!("../../../fixtures/m8/browser-reference/session-authority.json");
const REPLICA_SESSION: &[u8] =
    include_bytes!("../../../fixtures/m8/browser-reference/session-replica.json");
const EXPECTED_DIGEST: &str =
    include_str!("../../../fixtures/m8/browser-reference/expected-terminal-digest.txt");

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

fn safe(value: u64) -> Result<SafeU53, er_types::SafeU53Error> {
    SafeU53::new(value)
}

#[test]
fn browser_json_without_optional_production_fields_initializes_both_roles() -> TestResult {
    for session in [AUTHORITY_SESSION, REPLICA_SESSION] {
        let mut host = BrowserKernelHostV1::create(CONTENT, session)
            .map_err(|_| "native browser host creation failed")?;
        let bytes = er_canonical::canonical_bytes(&serde_json::json!([{
            "version": 1,
            "request_id": 1,
            "sequence": 1,
            "request": {
                "kind": "INITIALIZE",
                "value": {
                    "mode": "RUST_STAGING_AUTHORITY",
                    "execution_identity_bytes": IDENTITY,
                    "session_start_bytes": session,
                    "maximum_pending_requests": 64
                }
            }
        }]))?;
        host.dispatch_batch_native(&bytes)
            .map_err(|error| format!("browser-shaped initialization failed: {error:?}"))?;
    }
    Ok(())
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
            mode: BrowserExecutionModeV1::RustProductionAuthority,
            execution_identity_bytes: IDENTITY.to_vec(),
            session_start_bytes: SESSION.to_vec(),
            maximum_pending_requests: 8,
            production_release_id: Some("release-test".to_owned()),
            production_generation: Some(safe(1)?),
        }),
    };
    let ready_bytes = er_canonical::canonical_bytes(&vec![initialize])?;
    let ready_encoded = host
        .dispatch_batch_native(&ready_bytes)
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
        .dispatch_batch_native(&raw_bytes)
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
    let storage = responses
        .iter()
        .filter_map(|response| match &response.response {
            BrowserResponseV1::Effects(batch) => batch.effects.iter().find_map(|effect| {
                if let BrowserEffectV1::StorageRequest(bytes) = effect {
                    Some(bytes)
                } else {
                    None
                }
            }),
            _ => None,
        })
        .next()
        .ok_or("mechanical state change emitted no save request")?;
    let storage_value: serde_json::Value = serde_json::from_slice(storage)?;
    assert_eq!(storage_value["request_id"], 2);
    assert_eq!(storage_value["operation"], "WRITE");
    assert_eq!(storage_value["key"], "game-save-v1");
    assert!(storage_value["expected_revision"].is_null());
    assert!(
        storage_value["bytes"]
            .as_array()
            .is_some_and(|bytes| !bytes.is_empty())
    );
    let storage_result = BrowserRequestEnvelopeV1 {
        version: BROWSER_WORKER_PROTOCOL_VERSION_V1,
        request_id: safe(4)?,
        sequence: safe(4)?,
        request: BrowserRequestV1::StorageResult {
            request_id: safe(2)?,
            bytes: er_canonical::canonical_bytes(&serde_json::json!({ "revision": 1 }))?,
        },
    };
    let acknowledgement: Vec<BrowserResponseEnvelopeV1> = serde_json::from_slice(
        &host.dispatch_batch_native(&er_canonical::canonical_bytes(&vec![storage_result])?)?,
    )?;
    assert!(acknowledgement.iter().all(|response| {
        match &response.response {
            BrowserResponseV1::Effects(batch) => !batch
                .effects
                .iter()
                .any(|effect| matches!(effect, BrowserEffectV1::StorageRequest(_))),
            _ => true,
        }
    }));
    let snapshot_bytes = host.snapshot().map_err(|_| "native snapshot failed")?;
    let snapshot: er_kernel::snapshot_v6::RestorableKernelSnapshotV6 =
        serde_json::from_slice(&snapshot_bytes)?;
    assert_eq!(
        snapshot
            .game_state
            .active_run
            .as_ref()
            .map(|run| run.outcome),
        Some(RunOutcome::Victory)
    );
    let restored = BrowserKernelHostV1::create(CONTENT, &snapshot_bytes)
        .map_err(|_| "saved browser snapshot did not restore")?;
    assert_eq!(
        restored
            .snapshot()
            .map_err(|_| "restored snapshot failed")?,
        snapshot_bytes
    );
    host.dispose();
    Ok(())
}

#[test]
fn staging_authority_material_is_applied_by_the_native_replica() -> TestResult {
    let mut authority = BrowserKernelHostV1::create(CONTENT, AUTHORITY_SESSION)
        .map_err(|_| "authority browser host creation failed")?;
    let mut replica = BrowserKernelHostV1::create(CONTENT, REPLICA_SESSION)
        .map_err(|_| "replica browser host creation failed")?;
    assert_eq!(
        authority
            .snapshot()
            .map_err(|_| "authority initial snapshot failed")?,
        AUTHORITY_SESSION
    );
    assert_eq!(
        replica
            .snapshot()
            .map_err(|_| "replica initial snapshot failed")?,
        REPLICA_SESSION
    );
    for (host, session) in [
        (&mut authority, AUTHORITY_SESSION),
        (&mut replica, REPLICA_SESSION),
    ] {
        let request = BrowserRequestEnvelopeV1 {
            version: BROWSER_WORKER_PROTOCOL_VERSION_V1,
            request_id: safe(1)?,
            sequence: safe(1)?,
            request: BrowserRequestV1::Initialize(BrowserInitV1 {
                mode: BrowserExecutionModeV1::RustStagingAuthority,
                execution_identity_bytes: IDENTITY.to_vec(),
                session_start_bytes: session.to_vec(),
                maximum_pending_requests: 8,
                production_release_id: None,
                production_generation: None,
            }),
        };
        let bytes = er_canonical::canonical_bytes(&vec![request])?;
        host.dispatch_batch_native(&bytes)?;
        let connected = BrowserRequestEnvelopeV1 {
            version: BROWSER_WORKER_PROTOCOL_VERSION_V1,
            request_id: safe(2)?,
            sequence: safe(2)?,
            request: BrowserRequestV1::TransportChanged {
                generation: safe(1)?,
                connected: true,
            },
        };
        host.dispatch_batch_native(&er_canonical::canonical_bytes(&vec![connected])?)?;
    }
    let authority_requests = vec![
        BrowserRequestEnvelopeV1 {
            version: BROWSER_WORKER_PROTOCOL_VERSION_V1,
            request_id: safe(3)?,
            sequence: safe(3)?,
            request: BrowserRequestV1::RawInput(RawInputEvent::KeyDown {
                code: PhysicalKey::Space,
                printable: true,
                browser_repeat: false,
                focus: InputFocus::Game,
            }),
        },
        BrowserRequestEnvelopeV1 {
            version: BROWSER_WORKER_PROTOCOL_VERSION_V1,
            request_id: safe(4)?,
            sequence: safe(4)?,
            request: BrowserRequestV1::RawInput(RawInputEvent::KeyUp {
                code: PhysicalKey::Space,
            }),
        },
    ];
    let mut authority_responses = Vec::<BrowserResponseEnvelopeV1>::new();
    for request in authority_requests {
        authority_responses.extend(serde_json::from_slice::<Vec<BrowserResponseEnvelopeV1>>(
            &authority.dispatch_batch_native(&er_canonical::canonical_bytes(&vec![request])?)?,
        )?);
    }
    let materials = authority_responses
        .iter()
        .flat_map(|response| match &response.response {
            BrowserResponseV1::Effects(batch) => batch.effects.as_slice(),
            _ => &[],
        })
        .filter_map(|effect| match effect {
            BrowserEffectV1::SendNetworkFrame { bytes, .. } => Some(bytes.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert!(!materials.is_empty());
    let wrong_generation_request = vec![BrowserRequestEnvelopeV1 {
        version: BROWSER_WORKER_PROTOCOL_VERSION_V1,
        request_id: safe(3)?,
        sequence: safe(3)?,
        request: BrowserRequestV1::NetworkFrame {
            generation: safe(2)?,
            bytes: materials[0].clone(),
        },
    }];
    assert!(
        replica
            .dispatch_batch_native(&er_canonical::canonical_bytes(&wrong_generation_request)?)
            .is_err(),
        "authenticated adapter generation must match the Rust protocol frontier"
    );
    let replica_requests = materials
        .into_iter()
        .enumerate()
        .map(|(index, bytes)| {
            let sequence = safe(u64::try_from(index)? + 3)?;
            Ok(BrowserRequestEnvelopeV1 {
                version: BROWSER_WORKER_PROTOCOL_VERSION_V1,
                request_id: sequence,
                sequence,
                request: BrowserRequestV1::NetworkFrame {
                    generation: safe(1)?,
                    bytes,
                },
            })
        })
        .collect::<TestResult<Vec<_>>>()?;
    let replica_responses: Vec<BrowserResponseEnvelopeV1> = serde_json::from_slice(
        &replica
            .dispatch_batch_native(&er_canonical::canonical_bytes(&replica_requests)?)
            .map_err(|_| "replica material dispatch failed")?,
    )?;
    assert_eq!(
        replica_responses
            .last()
            .map(|response| response.after_mechanical_digest.as_str()),
        Some(EXPECTED_DIGEST.trim())
    );
    let replica_snapshot_bytes = replica.snapshot().map_err(|_| "replica snapshot failed")?;
    let snapshot: er_kernel::snapshot_v6::RestorableKernelSnapshotV6 =
        serde_json::from_slice(&replica_snapshot_bytes)?;
    assert_eq!(
        snapshot
            .game_state
            .active_run
            .as_ref()
            .map(|run| run.outcome),
        Some(RunOutcome::Victory)
    );
    let reconnected_replica = BrowserKernelHostV1::create(CONTENT, &replica_snapshot_bytes)
        .map_err(|_| "replica reconnect snapshot did not restore")?;
    assert_eq!(
        reconnected_replica
            .snapshot()
            .map_err(|_| "reconnected replica snapshot failed")?,
        replica_snapshot_bytes
    );
    authority.dispose();
    replica.dispose();
    Ok(())
}
