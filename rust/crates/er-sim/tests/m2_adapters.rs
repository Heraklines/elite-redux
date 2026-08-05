use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;

use er_sim::{
    FaultPresenter, InstantPresenter, MemoryStorage, Presenter, PresenterError, StorageAdapter,
    StorageAdapterError,
};
use er_types::{
    PresentationEvent, PresentationEventId, PresentationOutcome, SafeU53, StorageRequest,
    StorageResult,
};
use serde_json::{Value, json};

type TestResult = Result<(), Box<dyn Error>>;

fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(_) => SafeU53::ZERO,
    }
}

fn event(event_id: u64, event_kind: &str) -> PresentationEvent {
    PresentationEvent {
        event_id: PresentationEventId::new(safe(event_id)),
        event_kind: event_kind.to_owned(),
        payload: json!({"event": event_id}),
    }
}

fn request(request_id: u64, key: &str, value: Option<Value>) -> StorageRequest {
    StorageRequest {
        request_id: safe(request_id),
        key: key.to_owned(),
        value,
    }
}

fn ids(values: &[u64]) -> BTreeSet<PresentationEventId> {
    values
        .iter()
        .map(|value| PresentationEventId::new(safe(*value)))
        .collect()
}

#[test]
fn instant_presenter_settles_once_and_releases_on_dispose() -> TestResult {
    let first = event(1, "sprite");
    let first_id = first.event_id;
    let mut presenter = InstantPresenter::new();

    assert_eq!(
        presenter.present(first.clone())?,
        vec![er_sim::PresentationCompletion {
            event_id: first_id,
            outcome: PresentationOutcome::Settled,
        }]
    );
    let diagnostics = presenter.diagnostics();
    assert!(diagnostics.pending_event_ids.is_empty());
    assert_eq!(diagnostics.settled_event_ids, ids(&[1]));
    assert!(!diagnostics.disposed);

    assert_eq!(
        presenter.settle(first_id, PresentationOutcome::Cancelled),
        Err(PresenterError::AlreadySettled { event_id: first_id })
    );
    assert_eq!(
        presenter.present(first),
        Err(PresenterError::AlreadySettled { event_id: first_id })
    );
    let unknown_id = PresentationEventId::new(safe(99));
    assert_eq!(
        presenter.settle(unknown_id, PresentationOutcome::Settled),
        Err(PresenterError::UnknownEvent {
            event_id: unknown_id,
        })
    );

    presenter.dispose();
    presenter.dispose();
    let disposed = presenter.diagnostics();
    assert!(disposed.disposed);
    assert!(disposed.pending_event_ids.is_empty());
    assert!(disposed.settled_event_ids.is_empty());
    assert!(matches!(
        presenter.present(event(2, "after-dispose")),
        Err(PresenterError::Disposed)
    ));
    assert!(matches!(
        presenter.settle(unknown_id, PresentationOutcome::Settled),
        Err(PresenterError::Disposed)
    ));
    Ok(())
}

#[test]
fn fault_presenter_holds_orders_cancels_fails_and_duplicates_by_identity() -> TestResult {
    let mut presenter = FaultPresenter::new();
    for event_id in [1, 2, 3] {
        assert!(presenter.present(event(event_id, "held"))?.is_empty());
    }
    assert!(presenter.present(event(2, "duplicate-pending"))?.is_empty());
    assert_eq!(presenter.diagnostics().pending_event_ids, ids(&[1, 2, 3]));

    let unknown_id = PresentationEventId::new(safe(99));
    assert_eq!(
        presenter.settle(unknown_id, PresentationOutcome::Settled),
        Err(PresenterError::UnknownEvent {
            event_id: unknown_id,
        })
    );
    assert_eq!(
        presenter.duplicate_completion(unknown_id),
        Err(PresenterError::UnknownEvent {
            event_id: unknown_id,
        })
    );

    let failed = PresentationOutcome::Failed {
        reason: "renderer fault".to_owned(),
    };
    let cancelled = PresentationOutcome::Cancelled;
    let settled = PresentationOutcome::Settled;
    let third_id = PresentationEventId::new(safe(3));
    let first_id = PresentationEventId::new(safe(1));
    let second_id = PresentationEventId::new(safe(2));

    assert_eq!(
        presenter.settle(third_id, failed.clone())?,
        vec![er_sim::PresentationCompletion {
            event_id: third_id,
            outcome: failed.clone(),
        }]
    );
    assert_eq!(
        presenter.settle(first_id, cancelled.clone())?,
        vec![er_sim::PresentationCompletion {
            event_id: first_id,
            outcome: cancelled.clone(),
        }]
    );
    assert_eq!(
        presenter.settle(second_id, settled.clone())?,
        vec![er_sim::PresentationCompletion {
            event_id: second_id,
            outcome: settled.clone(),
        }]
    );
    assert_eq!(presenter.diagnostics().settled_event_ids, ids(&[1, 2, 3]));
    assert!(presenter.diagnostics().pending_event_ids.is_empty());

    assert_eq!(
        presenter.duplicate_completion(first_id)?,
        er_sim::PresentationCompletion {
            event_id: first_id,
            outcome: cancelled,
        }
    );
    assert_eq!(
        presenter.duplicate_completion(first_id)?,
        er_sim::PresentationCompletion {
            event_id: first_id,
            outcome: PresentationOutcome::Cancelled,
        }
    );
    assert_eq!(
        presenter.settle(first_id, PresentationOutcome::Settled),
        Err(PresenterError::AlreadySettled { event_id: first_id })
    );
    assert_eq!(
        presenter.present(event(3, "duplicate-settled")),
        Err(PresenterError::AlreadySettled { event_id: third_id })
    );

    presenter.dispose();
    presenter.dispose();
    let diagnostics = presenter.diagnostics();
    assert!(diagnostics.disposed);
    assert!(diagnostics.pending_event_ids.is_empty());
    assert!(diagnostics.settled_event_ids.is_empty());
    assert!(matches!(
        presenter.duplicate_completion(first_id),
        Err(PresenterError::Disposed)
    ));
    Ok(())
}

#[test]
fn memory_storage_returns_explicit_load_and_persist_results() -> TestResult {
    let mut initial = BTreeMap::new();
    initial.insert("slot:one".to_owned(), json!({"wave": 3}));
    let mut storage = MemoryStorage::new(initial);

    assert_eq!(
        storage.execute(request(1, "missing", None))?,
        StorageResult::Loaded { value: None }
    );
    assert_eq!(
        storage.execute(request(2, "slot:one", None))?,
        StorageResult::Loaded {
            value: Some(json!({"wave": 3})),
        }
    );
    assert!(storage.diagnostics().pending_request_ids.is_empty());

    assert_eq!(
        storage.execute(request(3, "slot:two", Some(json!([1, 2, 3]))))?,
        StorageResult::Persisted
    );
    assert_eq!(
        storage.execute(request(4, "slot:two", None))?,
        StorageResult::Loaded {
            value: Some(json!([1, 2, 3])),
        }
    );

    assert_eq!(
        storage.execute(request(5, "explicit-null", Some(Value::Null)))?,
        StorageResult::Persisted
    );
    let explicit_null = Value::Null;
    assert_eq!(storage.value("explicit-null"), Some(&explicit_null));
    assert_eq!(
        storage.execute(request(6, "explicit-null", None))?,
        StorageResult::Loaded {
            value: Some(explicit_null),
        }
    );
    assert_eq!(
        storage.diagnostics().keys,
        ["explicit-null", "slot:one", "slot:two"]
            .into_iter()
            .map(str::to_owned)
            .collect()
    );
    Ok(())
}

#[test]
fn memory_storage_accepts_arbitrary_string_keys_for_init_requests_and_recovery() -> TestResult {
    let empty_key = String::new();
    let long_key = "x".repeat(257);
    let control_key = "fault\u{0}key".to_owned();
    let mut initial = BTreeMap::new();
    initial.insert(empty_key.clone(), json!("initial-empty"));
    initial.insert(long_key.clone(), json!("initial-long"));
    initial.insert(control_key.clone(), json!("initial-control"));
    let mut storage = MemoryStorage::new(initial);

    let expected_keys: BTreeSet<_> = [empty_key.clone(), long_key.clone(), control_key.clone()]
        .into_iter()
        .collect();
    assert_eq!(storage.diagnostics().keys, expected_keys);
    assert_eq!(
        storage.execute(request(1, &empty_key, None))?,
        StorageResult::Loaded {
            value: Some(json!("initial-empty")),
        }
    );
    assert_eq!(
        storage.execute(request(2, &long_key, None))?,
        StorageResult::Loaded {
            value: Some(json!("initial-long")),
        }
    );
    assert_eq!(
        storage.execute(request(3, &control_key, None))?,
        StorageResult::Loaded {
            value: Some(json!("initial-control")),
        }
    );

    assert_eq!(
        storage.execute(request(4, &empty_key, Some(json!("written-empty"))))?,
        StorageResult::Persisted
    );
    assert_eq!(
        storage.execute(request(5, &long_key, Some(json!("written-long"))))?,
        StorageResult::Persisted
    );
    assert_eq!(
        storage.execute(request(6, &control_key, Some(json!("written-control"))))?,
        StorageResult::Persisted
    );
    assert_eq!(
        storage.execute(request(7, &empty_key, None))?,
        StorageResult::Loaded {
            value: Some(json!("written-empty")),
        }
    );
    assert_eq!(
        storage.execute(request(8, &long_key, None))?,
        StorageResult::Loaded {
            value: Some(json!("written-long")),
        }
    );
    assert_eq!(
        storage.execute(request(9, &control_key, None))?,
        StorageResult::Loaded {
            value: Some(json!("written-control")),
        }
    );

    let mut recovery_updates = BTreeMap::new();
    recovery_updates.insert(empty_key.clone(), json!("recovered-empty"));
    recovery_updates.insert(long_key.clone(), json!("recovered-long"));
    recovery_updates.insert(control_key.clone(), json!("recovered-control"));
    storage.apply_recovery_atomically(recovery_updates)?;
    assert_eq!(
        storage.execute(request(10, &empty_key, None))?,
        StorageResult::Loaded {
            value: Some(json!("recovered-empty")),
        }
    );
    assert_eq!(
        storage.execute(request(11, &long_key, None))?,
        StorageResult::Loaded {
            value: Some(json!("recovered-long")),
        }
    );
    assert_eq!(
        storage.execute(request(12, &control_key, None))?,
        StorageResult::Loaded {
            value: Some(json!("recovered-control")),
        }
    );
    assert_eq!(storage.diagnostics().keys, expected_keys);
    assert!(storage.diagnostics().pending_request_ids.is_empty());

    storage.dispose();
    assert_eq!(storage.value(&empty_key), None);
    assert_eq!(storage.value(&long_key), None);
    assert_eq!(storage.value(&control_key), None);
    Ok(())
}

#[test]
fn memory_storage_disposal_is_idempotent_and_zeroes_resources() -> TestResult {
    let mut initial = BTreeMap::new();
    initial.insert("slot".to_owned(), json!(1));
    let mut storage = MemoryStorage::new(initial);
    storage.execute(request(1, "other", Some(json!(2))))?;
    assert!(!storage.diagnostics().keys.is_empty());

    storage.dispose();
    storage.dispose();
    let diagnostics = storage.diagnostics();
    assert!(diagnostics.disposed);
    assert!(diagnostics.keys.is_empty());
    assert!(diagnostics.pending_request_ids.is_empty());
    assert_eq!(storage.value("slot"), None);
    assert_eq!(
        storage.execute(request(2, "after-dispose", None)),
        Err(StorageAdapterError::Disposed)
    );
    assert_eq!(
        storage.apply_recovery_atomically(BTreeMap::new()),
        Err(StorageAdapterError::Disposed)
    );
    Ok(())
}
