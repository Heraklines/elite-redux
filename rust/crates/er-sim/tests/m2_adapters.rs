use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;

use er_sim::{
    FaultPresenter, InstantPresenter, MemoryStorage, Presenter, PresenterError, StorageAdapter,
    StorageAdapterError,
};
use er_types::{
    PresentationEvent, PresentationEventId, PresentationOutcome, SafeU53, SafeU53Error, SeatId,
    StorageRequest, StorageResult,
};
use serde_json::{Value, json};

type TestResult = Result<(), Box<dyn Error>>;

fn safe(value: u64) -> Result<SafeU53, SafeU53Error> {
    SafeU53::new(value)
}

fn seat(value: u64) -> Result<SeatId, SafeU53Error> {
    Ok(SeatId::new(safe(value)?))
}

fn event(event_id: u64, event_kind: &str) -> Result<PresentationEvent, SafeU53Error> {
    Ok(PresentationEvent {
        event_id: PresentationEventId::new(safe(event_id)?),
        event_kind: event_kind.to_owned(),
        payload: json!({"event": event_id}),
    })
}

fn request(
    request_id: u64,
    key: &str,
    value: Option<Value>,
) -> Result<StorageRequest, SafeU53Error> {
    Ok(StorageRequest {
        request_id: safe(request_id)?,
        key: key.to_owned(),
        value,
    })
}

fn ids(values: &[u64]) -> Result<BTreeSet<PresentationEventId>, SafeU53Error> {
    values
        .iter()
        .map(|value| safe(*value).map(PresentationEventId::new))
        .collect()
}

#[test]
fn instant_presenter_is_endpoint_qualified_and_releases_on_dispose() -> TestResult {
    let host = seat(1)?;
    let guest = seat(2)?;
    let max_endpoint = seat(SafeU53::MAX.get())?;
    let first = event(1, "sprite")?;
    let first_id = first.event_id;
    let mut presenter = InstantPresenter::new();

    assert_eq!(
        presenter.present(host, first.clone())?,
        vec![er_sim::PresentationCompletion {
            event_id: first_id,
            outcome: PresentationOutcome::Settled,
        }]
    );
    assert_eq!(
        presenter.present(guest, event(1, "guest-sprite")?)?,
        vec![er_sim::PresentationCompletion {
            event_id: first_id,
            outcome: PresentationOutcome::Settled,
        }]
    );
    assert!(presenter.pending_event_ids(host).is_empty());
    assert!(presenter.pending_event_ids(guest).is_empty());
    assert_eq!(presenter.settled_event_ids(host), ids(&[1])?);
    assert_eq!(presenter.settled_event_ids(guest), ids(&[1])?);
    assert_eq!(
        presenter.diagnostics_for(host),
        er_sim::PresenterDiagnostics {
            pending_event_ids: BTreeSet::new(),
            settled_event_ids: ids(&[1])?,
            disposed: false,
        }
    );

    assert_eq!(
        presenter.settle(host, first_id, PresentationOutcome::Cancelled),
        Err(PresenterError::AlreadySettled { event_id: first_id })
    );
    assert_eq!(
        presenter.present(host, first),
        Err(PresenterError::AlreadySettled { event_id: first_id })
    );
    let unknown_id = PresentationEventId::new(safe(99)?);
    assert_eq!(
        presenter.settle(host, unknown_id, PresentationOutcome::Settled),
        Err(PresenterError::UnknownEvent {
            event_id: unknown_id,
        })
    );

    let max_event = event(SafeU53::MAX.get(), "max-event")?;
    let max_event_id = max_event.event_id;
    assert_eq!(
        presenter.present(max_endpoint, max_event)?,
        vec![er_sim::PresentationCompletion {
            event_id: max_event_id,
            outcome: PresentationOutcome::Settled,
        }]
    );
    assert_eq!(
        presenter.settled_event_ids(max_endpoint),
        ids(&[SafeU53::MAX.get()])?
    );

    presenter.dispose();
    presenter.dispose();
    let disposed = presenter.diagnostics();
    assert!(disposed.disposed);
    assert!(disposed.pending_event_ids.is_empty());
    assert!(disposed.settled_event_ids.is_empty());
    assert!(presenter.pending_event_ids(host).is_empty());
    assert!(presenter.settled_event_ids(guest).is_empty());
    assert!(matches!(
        presenter.present(host, event(2, "after-dispose")?),
        Err(PresenterError::Disposed)
    ));
    assert!(matches!(
        presenter.settle(host, unknown_id, PresentationOutcome::Settled),
        Err(PresenterError::Disposed)
    ));
    Ok(())
}

#[test]
fn fault_presenter_keeps_endpoint_local_pending_and_settled_tombstones() -> TestResult {
    let host = seat(1)?;
    let guest = seat(2)?;
    let unrelated_endpoint = seat(3)?;
    let shared_event = event(7, "held")?;
    let shared_event_id = shared_event.event_id;
    let mut presenter = FaultPresenter::new();

    assert!(presenter.present(host, shared_event.clone())?.is_empty());
    assert!(
        presenter
            .present(guest, event(7, "guest-held")?)?
            .is_empty()
    );
    assert!(
        presenter
            .present(host, event(7, "duplicate-pending")?)?
            .is_empty()
    );
    assert_eq!(presenter.pending_event_ids(host), ids(&[7])?);
    assert_eq!(presenter.pending_event_ids(guest), ids(&[7])?);
    assert!(presenter.settled_event_ids(host).is_empty());
    assert!(presenter.settled_event_ids(guest).is_empty());

    assert_eq!(
        presenter.settle(
            unrelated_endpoint,
            shared_event_id,
            PresentationOutcome::Settled
        ),
        Err(PresenterError::UnknownEvent {
            event_id: shared_event_id,
        })
    );
    assert_eq!(
        presenter.duplicate_completion(unrelated_endpoint, shared_event_id),
        Err(PresenterError::UnknownEvent {
            event_id: shared_event_id,
        })
    );

    let failed = PresentationOutcome::Failed {
        reason: "renderer fault".to_owned(),
    };
    assert_eq!(
        presenter.settle(host, shared_event_id, failed.clone())?,
        vec![er_sim::PresentationCompletion {
            event_id: shared_event_id,
            outcome: failed.clone(),
        }]
    );
    assert!(presenter.pending_event_ids(host).is_empty());
    assert_eq!(presenter.settled_event_ids(host), ids(&[7])?);
    assert_eq!(presenter.pending_event_ids(guest), ids(&[7])?);
    assert!(presenter.settled_event_ids(guest).is_empty());
    assert_eq!(
        presenter.duplicate_completion(host, shared_event_id)?,
        er_sim::PresentationCompletion {
            event_id: shared_event_id,
            outcome: failed,
        }
    );
    assert_eq!(
        presenter.duplicate_completion(guest, shared_event_id),
        Err(PresenterError::UnknownEvent {
            event_id: shared_event_id,
        })
    );

    assert_eq!(
        presenter.settle(guest, shared_event_id, PresentationOutcome::Settled)?,
        vec![er_sim::PresentationCompletion {
            event_id: shared_event_id,
            outcome: PresentationOutcome::Settled,
        }]
    );
    assert!(presenter.pending_event_ids(guest).is_empty());
    assert_eq!(presenter.settled_event_ids(guest), ids(&[7])?);
    assert_eq!(presenter.settled_event_ids(host), ids(&[7])?);
    assert_eq!(
        presenter.diagnostics_for(guest),
        er_sim::PresenterDiagnostics {
            pending_event_ids: BTreeSet::new(),
            settled_event_ids: ids(&[7])?,
            disposed: false,
        }
    );
    assert_eq!(
        presenter.settle(host, shared_event_id, PresentationOutcome::Settled),
        Err(PresenterError::AlreadySettled {
            event_id: shared_event_id,
        })
    );
    assert_eq!(
        presenter.present(guest, event(7, "duplicate-settled")?),
        Err(PresenterError::AlreadySettled {
            event_id: shared_event_id,
        })
    );

    let cancelled_event = event(8, "cancelled")?;
    let cancelled_event_id = cancelled_event.event_id;
    assert!(presenter.present(host, cancelled_event)?.is_empty());
    assert_eq!(
        presenter.settle(host, cancelled_event_id, PresentationOutcome::Cancelled)?,
        vec![er_sim::PresentationCompletion {
            event_id: cancelled_event_id,
            outcome: PresentationOutcome::Cancelled,
        }]
    );
    assert_eq!(presenter.settled_event_ids(host), ids(&[7, 8])?);
    assert_eq!(
        presenter.duplicate_completion(host, cancelled_event_id)?,
        er_sim::PresentationCompletion {
            event_id: cancelled_event_id,
            outcome: PresentationOutcome::Cancelled,
        }
    );

    presenter.dispose();
    presenter.dispose();
    let diagnostics = presenter.diagnostics();
    assert!(diagnostics.disposed);
    assert!(diagnostics.pending_event_ids.is_empty());
    assert!(diagnostics.settled_event_ids.is_empty());
    assert!(presenter.pending_event_ids(host).is_empty());
    assert!(presenter.settled_event_ids(guest).is_empty());
    assert!(matches!(
        presenter.duplicate_completion(host, shared_event_id),
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
        storage.execute(request(1, "missing", None)?)?,
        StorageResult::Loaded { value: None }
    );
    assert_eq!(
        storage.execute(request(2, "slot:one", None)?)?,
        StorageResult::Loaded {
            value: Some(json!({"wave": 3})),
        }
    );
    assert!(storage.diagnostics().pending_request_ids.is_empty());

    assert_eq!(
        storage.execute(request(3, "slot:two", Some(json!([1, 2, 3])))?)?,
        StorageResult::Persisted
    );
    assert_eq!(
        storage.execute(request(4, "slot:two", None)?)?,
        StorageResult::Loaded {
            value: Some(json!([1, 2, 3])),
        }
    );

    assert_eq!(
        storage.execute(request(5, "explicit-null", Some(Value::Null))?)?,
        StorageResult::Persisted
    );
    let explicit_null = Value::Null;
    assert_eq!(storage.value("explicit-null"), Some(&explicit_null));
    assert_eq!(
        storage.execute(request(6, "explicit-null", None)?)?,
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
fn memory_storage_reuses_completed_request_ids_synchronously() -> TestResult {
    let max_request_id = SafeU53::MAX.get();
    let mut storage = MemoryStorage::new(BTreeMap::new());

    assert_eq!(
        storage.execute(request(max_request_id, "reuse", Some(json!(1)))?)?,
        StorageResult::Persisted
    );
    assert_eq!(
        storage.execute(request(max_request_id, "reuse", None)?)?,
        StorageResult::Loaded {
            value: Some(json!(1)),
        }
    );
    assert!(storage.diagnostics().pending_request_ids.is_empty());
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
        storage.execute(request(1, &empty_key, None)?)?,
        StorageResult::Loaded {
            value: Some(json!("initial-empty")),
        }
    );
    assert_eq!(
        storage.execute(request(2, &long_key, None)?)?,
        StorageResult::Loaded {
            value: Some(json!("initial-long")),
        }
    );
    assert_eq!(
        storage.execute(request(3, &control_key, None)?)?,
        StorageResult::Loaded {
            value: Some(json!("initial-control")),
        }
    );

    assert_eq!(
        storage.execute(request(4, &empty_key, Some(json!("written-empty")))?)?,
        StorageResult::Persisted
    );
    assert_eq!(
        storage.execute(request(5, &long_key, Some(json!("written-long")))?)?,
        StorageResult::Persisted
    );
    assert_eq!(
        storage.execute(request(6, &control_key, Some(json!("written-control")))?)?,
        StorageResult::Persisted
    );
    assert_eq!(
        storage.execute(request(7, &empty_key, None)?)?,
        StorageResult::Loaded {
            value: Some(json!("written-empty")),
        }
    );
    assert_eq!(
        storage.execute(request(8, &long_key, None)?)?,
        StorageResult::Loaded {
            value: Some(json!("written-long")),
        }
    );
    assert_eq!(
        storage.execute(request(9, &control_key, None)?)?,
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
        storage.execute(request(10, &empty_key, None)?)?,
        StorageResult::Loaded {
            value: Some(json!("recovered-empty")),
        }
    );
    assert_eq!(
        storage.execute(request(11, &long_key, None)?)?,
        StorageResult::Loaded {
            value: Some(json!("recovered-long")),
        }
    );
    assert_eq!(
        storage.execute(request(12, &control_key, None)?)?,
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
fn memory_storage_rejects_one_atomic_write_without_partial_mutation() -> TestResult {
    let mut initial = BTreeMap::new();
    initial.insert("untouched".to_owned(), json!({"keep": true}));
    initial.insert("would-overwrite".to_owned(), json!("before"));
    let mut storage = MemoryStorage::new(initial);
    let before_keys = storage.diagnostics().keys.clone();
    let before_untouched = storage.value("untouched").cloned();
    let before_overwrite = storage.value("would-overwrite").cloned();

    storage.reject_next_atomic_write_with_reason("injected test fault");
    let mut updates = BTreeMap::new();
    updates.insert("would-overwrite".to_owned(), json!("after"));
    updates.insert("would-add".to_owned(), json!(42));
    assert_eq!(
        storage.apply_recovery_atomically(updates),
        Err(StorageAdapterError::AtomicWriteRejected {
            reason: "injected test fault".to_owned(),
        })
    );

    assert_eq!(storage.diagnostics().keys, before_keys);
    assert_eq!(storage.value("untouched").cloned(), before_untouched);
    assert_eq!(storage.value("would-overwrite").cloned(), before_overwrite);
    assert_eq!(storage.value("would-add"), None);
    assert!(!storage.diagnostics().keys.contains("would-add"));

    let mut accepted_updates = BTreeMap::new();
    accepted_updates.insert("would-overwrite".to_owned(), json!("after"));
    accepted_updates.insert("would-add".to_owned(), json!(42));
    storage.apply_recovery_atomically(accepted_updates)?;
    let expected_untouched = json!({"keep": true});
    let expected_overwrite = json!("after");
    let expected_add = json!(42);
    assert_eq!(storage.value("untouched"), Some(&expected_untouched));
    assert_eq!(storage.value("would-overwrite"), Some(&expected_overwrite));
    assert_eq!(storage.value("would-add"), Some(&expected_add));

    storage.reject_next_atomic_write();
    assert_eq!(
        storage.apply_recovery_atomically(BTreeMap::new()),
        Err(StorageAdapterError::AtomicWriteRejected {
            reason: "injected atomic write rejection".to_owned(),
        })
    );
    storage.apply_recovery_atomically(BTreeMap::new())?;
    Ok(())
}

#[test]
fn memory_storage_disposal_takes_precedence_and_cleans_resources() -> TestResult {
    let mut initial = BTreeMap::new();
    initial.insert("slot".to_owned(), json!(1));
    let mut storage = MemoryStorage::new(initial);
    storage.execute(request(1, "other", Some(json!(2)))?)?;
    storage.reject_next_atomic_write_with_reason("must not win over disposal");
    assert!(!storage.diagnostics().keys.is_empty());

    storage.dispose();
    storage.dispose();
    let diagnostics = storage.diagnostics();
    assert!(diagnostics.disposed);
    assert!(diagnostics.keys.is_empty());
    assert!(diagnostics.pending_request_ids.is_empty());
    assert_eq!(storage.value("slot"), None);
    assert_eq!(
        storage.execute(request(2, "after-dispose", None)?),
        Err(StorageAdapterError::Disposed)
    );
    assert_eq!(
        storage.apply_recovery_atomically(BTreeMap::new()),
        Err(StorageAdapterError::Disposed)
    );
    Ok(())
}

#[test]
fn safe_u53_helpers_preserve_maximum_and_reject_max_plus_one() -> TestResult {
    let max_plus_one = SafeU53::MAX.get() + 1;
    let expected = SafeU53Error {
        value: max_plus_one,
    };
    assert_eq!(safe(max_plus_one), Err(expected));
    assert_eq!(seat(max_plus_one), Err(expected));
    assert_eq!(event(max_plus_one, "invalid"), Err(expected));
    assert_eq!(request(max_plus_one, "invalid", None), Err(expected));
    assert_eq!(ids(&[max_plus_one]), Err(expected));
    assert_eq!(safe(SafeU53::MAX.get())?, SafeU53::MAX);
    Ok(())
}
