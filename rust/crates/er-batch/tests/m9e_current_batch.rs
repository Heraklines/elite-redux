//! Current library evidence. Normal CLI batch reachability needs its own process witness.

use std::collections::BTreeMap;
use std::error::Error;
use std::sync::{Arc, OnceLock};

use er_batch::current::{CurrentBatch, CurrentBatchEnvironmentId, CurrentBatchError,
    CurrentBatchEvent, CurrentBatchLimits, CurrentBatchResult, CURRENT_BATCH_MAXIMUM_ENVIRONMENTS,
    CURRENT_BATCH_MAXIMUM_EVENTS, CURRENT_BATCH_MAXIMUM_RESULT_BYTES};
use er_env::current::{CurrentExternalEvent, CurrentGameSession, CurrentSessionError};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelEffectV7, GameKernelRoleV7, GameKernelV7Error, KernelPresentationOutcomeV2};
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_state::m7_state::ProfileStateV1;
use er_types::{GameControlKindV2, InputFocus, PhysicalKey, PresentationEventId, RawInputEvent, SafeU53, SeatId};
use serde_json::json;
use thiserror::Error;

type TestResult<T = ()> = Result<T, Box<dyn Error>>;
type References = BTreeMap<CurrentBatchEnvironmentId, CurrentGameSession>;
const BUNDLE: &[u8] = include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 { SafeU53::new(value).expect("safe fixture value") }
fn id(value: u64) -> CurrentBatchEnvironmentId { CurrentBatchEnvironmentId(safe(value)) }
fn seat() -> SeatId { SeatId::new(safe(1)) }
fn key(code: PhysicalKey, down: bool) -> CurrentExternalEvent {
    CurrentExternalEvent::RawInput { input: if down {
        RawInputEvent::KeyDown { code, printable: false, browser_repeat: false, focus: InputFocus::Game }
    } else { RawInputEvent::KeyUp { code } } }
}
fn time(milliseconds: u64) -> CurrentExternalEvent { CurrentExternalEvent::AdvanceTime { milliseconds: safe(milliseconds) } }
fn operation(environment: u64, event: CurrentExternalEvent) -> CurrentBatchEvent {
    CurrentBatchEvent { environment: id(environment), event }
}

fn natural(content: Arc<PreparedGameContentV2>) -> TestResult<CurrentGameSession> {
    let profile: ProfileStateV1 = serde_json::from_value(json!({
        "schema_version": 1, "unlocks": [], "achievements": [], "challenges": [], "flags": [],
        "statistics": {"runs_started": 0, "runs_won": 0, "runs_lost": 0, "battles_won": 0,
            "pokemon_captured": 0, "highest_wave": 1}, "dex": {"entries": []}
    }))?;
    Ok(CurrentGameSession::natural_start(profile, "m9e-current-batch".to_owned(), seat(),
        vec!["preview-slot".to_owned()], true, content, None)?)
}

fn selected(session: &CurrentGameSession) -> TestResult<&str> {
    Ok(session.kernel_ref()?.current_control().ok_or("control missing")?
        .menu.as_ref().ok_or("menu missing")?.selected_option_id.as_str())
}

fn press(session: &mut CurrentGameSession, code: PhysicalKey) -> TestResult {
    session.apply(key(code.clone(), true))?;
    session.apply(key(code, false))?;
    Ok(())
}

struct Fixture { content: Arc<PreparedGameContentV2>, active: CoreGameKernelSnapshotV7 }
fn create_fixture() -> TestResult<Fixture> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?);
    let mut session = natural(Arc::clone(&content))?;
    for _ in 0..3 { press(&mut session, PhysicalKey::Space)?; }
    let bound = session.kernel_ref()?.current_control().ok_or("starter control")?
        .menu.as_ref().ok_or("starter menu")?.options.len() + 1;
    for _ in 0..bound {
        if selected(&session)? == "bootstrap/starter/confirm" { break; }
        press(&mut session, PhysicalKey::ArrowDown)?;
    }
    assert_eq!(selected(&session)?, "bootstrap/starter/confirm");
    for _ in 0..4 { press(&mut session, PhysicalKey::Space)?; }
    for pending in session.snapshot()?.pending_presentations {
        session.apply(CurrentExternalEvent::PresentationOutcome {
            event_id: pending.event_id, outcome: KernelPresentationOutcomeV2::Settled })?;
    }
    assert_eq!(session.observe()?.control.ok_or("battle control")?.kind, GameControlKindV2::BattleCommand);
    assert_eq!(selected(&session)?, "battle/command/fight");
    Ok(Fixture { content, active: session.snapshot()? })
}
fn fixture() -> TestResult<&'static Fixture> {
    static FIXTURE: OnceLock<Result<Fixture, String>> = OnceLock::new();
    FIXTURE.get_or_init(|| create_fixture().map_err(|error| error.to_string()))
        .as_ref().map_err(|error| error.clone().into())
}
fn active() -> TestResult<CurrentGameSession> {
    let fixture = fixture()?;
    Ok(CurrentGameSession::from_snapshot(fixture.active.clone(), seat(), GameKernelRoleV7::Authority,
        Arc::clone(&fixture.content))?)
}
fn batch(limits: CurrentBatchLimits) -> TestResult<CurrentBatch> {
    Ok(CurrentBatch::from_sessions(Arc::clone(&fixture()?.content), limits,
        vec![(id(1), active()?), (id(2), active()?)])?)
}
fn reference_results(references: &mut References, events: &[CurrentBatchEvent]) -> TestResult<Vec<CurrentBatchResult>> {
    let mut results = Vec::new();
    for (ordinal, operation) in events.iter().enumerate() {
        let session = references.get_mut(&operation.environment).ok_or("reference session missing")?;
        let step = session.apply(operation.event.clone())?;
        results.push(CurrentBatchResult { ordinal, environment: operation.environment, step, observation: session.observe()? });
    }
    Ok(results)
}
fn compare(batch: &mut CurrentBatch, references: &mut References, events: Vec<CurrentBatchEvent>) -> TestResult<Vec<CurrentBatchResult>> {
    let expected = reference_results(references, &events)?;
    let actual = batch.execute(events)?;
    assert_eq!(actual, expected, "complete ordered step and observation per input");
    for (environment, reference) in references {
        assert_eq!(batch.snapshot(*environment)?, reference.snapshot()?);
        assert!(Arc::ptr_eq(batch.content(), batch.session(*environment)?.content()));
    }
    Ok(actual)
}
fn press_pair(batch: &mut CurrentBatch, references: &mut References, code: PhysicalKey) -> TestResult {
    let _ = compare(batch, references, vec![operation(1, key(code.clone(), true)), operation(1, key(code, false))])?;
    Ok(())
}

#[test]
fn current_batch_natural_controls_and_held_time_return_ordered_typed_results() -> TestResult {
    let content = Arc::clone(&fixture()?.content);
    let mut batch = CurrentBatch::from_sessions(Arc::clone(&content), CurrentBatchLimits::default(),
        vec![(id(1), natural(Arc::clone(&content))?)])?;
    let mut references = BTreeMap::from([(id(1), natural(content)?) ]);
    let initial = batch.observe(id(1))?;
    assert_eq!(initial.kernel_version, 7);
    assert_eq!(initial.content_identity, *batch.content().identity());
    assert_eq!(initial.mechanical_digest, None);
    assert_eq!(initial.control.ok_or("title")?.kind, GameControlKindV2::Title);
    for _ in 0..3 { press_pair(&mut batch, &mut references, PhysicalKey::Space)?; }
    let bound = batch.observe(id(1))?.control.ok_or("starter")?.menu.ok_or("menu")?.options.len() + 1;
    for _ in 0..bound {
        if selected(batch.session(id(1))?)? == "bootstrap/starter/confirm" { break; }
        press_pair(&mut batch, &mut references, PhysicalKey::ArrowDown)?;
    }
    assert_eq!(selected(batch.session(id(1))?)?, "bootstrap/starter/confirm");
    for _ in 0..4 { press_pair(&mut batch, &mut references, PhysicalKey::Space)?; }
    let pending = batch.snapshot(id(1))?.pending_presentations;
    assert!(!pending.is_empty(), "batch must leave actual platform work pending");
    for presentation in pending {
        let _ = compare(&mut batch, &mut references, vec![operation(1, CurrentExternalEvent::PresentationOutcome {
            event_id: presentation.event_id, outcome: KernelPresentationOutcomeV2::Settled })])?;
    }
    assert_eq!(batch.observe(id(1))?.control.ok_or("battle")?.kind, GameControlKindV2::BattleCommand);
    let results = compare(&mut batch, &mut references, vec![
        operation(1, key(PhysicalKey::ArrowDown, true)), operation(1, time(249)), operation(1, time(1)),
        operation(1, key(PhysicalKey::ArrowDown, false)), operation(1, time(500))])?;
    let selection = |result: &CurrentBatchResult| result.observation.control.as_ref()
        .and_then(|control| control.menu.as_ref()).map(|menu| menu.selected_option_id.as_str().to_owned());
    assert_eq!(results.iter().map(selection).collect::<Vec<_>>(),
        ["party", "party", "fight", "fight", "fight"].map(|value| Some(format!("battle/command/{value}"))));
    assert!(results[2].step.effects.iter().any(|effect| matches!(effect, GameKernelEffectV7::UiChanged(control)
        if control.menu.as_ref().is_some_and(|menu| menu.selected_option_id.as_str() == "battle/command/fight"))));
    assert!(batch.snapshot(id(1))?.scheduler.timers.is_empty());
    Ok(())
}

#[test]
fn rejected_event_rolls_back_every_affected_environment_and_allows_continuation() -> TestResult {
    let mut batch = batch(CurrentBatchLimits::default())?;
    let before = [batch.snapshot(id(1))?, batch.snapshot(id(2))?];
    let mut events = vec![operation(2, time(37)), operation(1, key(PhysicalKey::ArrowDown, true)),
        operation(2, CurrentExternalEvent::PresentationOutcome { event_id: PresentationEventId::new(safe(999_999)),
            outcome: KernelPresentationOutcomeV2::Settled })];
    let mut completion_called = false;
    let result = batch.execute_with(events.clone(), |_, results| -> Result<_, CurrentBatchError> {
        completion_called = true;
        Ok(results)
    });
    assert!(matches!(result, Err(CurrentBatchError::Event { ordinal: 2, environment,
        source: CurrentSessionError::Kernel(GameKernelV7Error::Invalid) }) if environment == id(2)));
    assert!(!completion_called);
    assert_eq!([batch.snapshot(id(1))?, batch.snapshot(id(2))?], before);
    events[2].event = time(13);
    let mut references = BTreeMap::from([(id(1), active()?), (id(2), active()?) ]);
    let result = compare(&mut batch, &mut references, events)?;
    assert_eq!(result.iter().map(|item| item.environment).collect::<Vec<_>>(), [id(2), id(1), id(2)]);
    let _ = compare(&mut batch, &mut references, vec![operation(1, time(250)), operation(1, key(PhysicalKey::ArrowDown, false))])?;
    Ok(())
}

#[derive(Debug, Error)]
enum CompletionError {
    #[error(transparent)] Batch(#[from] CurrentBatchError),
    #[error(transparent)] Encoding(#[from] serde_json::Error),
    #[error("complete adapter response exceeds its byte bound")] ResponseCapacity,
}

#[test]
fn aggregate_completion_rejection_preserves_all_snapshots_and_effect_retry() -> TestResult {
    let mut batch = batch(CurrentBatchLimits::default())?;
    batch.insert(id(3), active()?)?;
    let before = [batch.snapshot(id(1))?, batch.snapshot(id(2))?, batch.snapshot(id(3))?];
    let events = vec![operation(2, time(17)), operation(1, key(PhysicalKey::ArrowDown, true))];
    let mut called = false;
    let rejected = batch.execute_with(events.clone(), |candidate, results| -> Result<Vec<u8>, CompletionError> {
        called = true;
        assert_ne!(candidate.snapshot(id(1))?, before[0]);
        assert_ne!(candidate.snapshot(id(2))?, before[1]);
        assert_eq!(candidate.snapshot(id(3))?, before[2]);
        assert!(Arc::ptr_eq(candidate.session(id(1))?.content(), &fixture().expect("prepared fixture").content));
        assert_eq!(candidate.observe(id(1))?, results[1].observation);
        let bytes = serde_json::to_vec(&json!({"results": results,
            "snapshots": [candidate.snapshot(id(1))?, candidate.snapshot(id(2))?]}))?;
        if bytes.len() > 1 { return Err(CompletionError::ResponseCapacity); }
        Ok(bytes)
    });
    assert!(called);
    assert!(matches!(rejected, Err(CompletionError::ResponseCapacity)));
    assert_eq!([batch.snapshot(id(1))?, batch.snapshot(id(2))?, batch.snapshot(id(3))?], before);
    let mut references = BTreeMap::from([(id(1), active()?), (id(2), active()?), (id(3), active()?) ]);
    let _ = compare(&mut batch, &mut references, events)?;
    Ok(())
}

#[test]
fn aggregate_result_byte_limit_is_exact_atomic_and_resets_each_call() -> TestResult {
    let events = vec![operation(2, time(17)), operation(1, key(PhysicalKey::ArrowDown, true))];
    let mut references = BTreeMap::from([(id(1), active()?), (id(2), active()?) ]);
    let expected = reference_results(&mut references, &events)?;
    let bytes = serde_json::to_vec(&expected)?.len();
    let limits = CurrentBatchLimits { maximum_environments: 2, maximum_events: 2, maximum_result_bytes: bytes - 1 };
    let mut rejected = batch(limits)?;
    let before = [rejected.snapshot(id(1))?, rejected.snapshot(id(2))?];
    let mut called = false;
    let result = rejected.execute_with(events.clone(), |_, results| -> Result<_, CurrentBatchError> {
        called = true;
        Ok(results)
    });
    assert!(matches!(result, Err(CurrentBatchError::ResultCapacity { maximum }) if maximum == bytes - 1));
    assert!(!called, "aggregate completion must not receive an over-budget retained array");
    assert_eq!([rejected.snapshot(id(1))?, rejected.snapshot(id(2))?], before);
    let mut exact = batch(CurrentBatchLimits { maximum_result_bytes: bytes, ..limits })?;
    assert_eq!(exact.execute(events.clone())?, expected);
    for event in events { let _ = rejected.execute(vec![event])?; }
    assert_eq!([rejected.snapshot(id(1))?, rejected.snapshot(id(2))?],
        [exact.snapshot(id(1))?, exact.snapshot(id(2))?]);
    // The two-event bound is per invocation, not a retained lifetime counter.
    for _ in 0..3 { let _ = exact.execute(vec![operation(2, time(1))])?; }
    Ok(())
}

#[test]
fn equal_prepared_content_normalizes_and_forks_without_changing_private_state() -> TestResult {
    let fixture = fixture()?;
    let separate = Arc::new(PreparedGameContentV2::prepare(Arc::clone(fixture.content.bundle()))?);
    assert!(!Arc::ptr_eq(&separate, &fixture.content));
    assert_eq!(separate.identity(), fixture.content.identity());
    let session = CurrentGameSession::from_snapshot(fixture.active.clone(), seat(), GameKernelRoleV7::Authority, separate)?;
    let context = session.session_context()?;
    let before = session.snapshot()?;
    let mut batch = CurrentBatch::new(Arc::clone(&fixture.content), CurrentBatchLimits::default())?;
    batch.insert(id(1), session)?;
    assert_eq!(batch.snapshot(id(1))?, before);
    assert_eq!(batch.session(id(1))?.session_context()?, context);
    assert!(Arc::ptr_eq(batch.session(id(1))?.content(), &fixture.content));
    batch.fork(id(1), id(8))?;
    assert_eq!(batch.snapshot(id(8))?, before);
    assert_eq!(batch.session(id(8))?.session_context()?, context);
    assert!(Arc::ptr_eq(batch.session(id(8))?.content(), &fixture.content));
    let mut references = BTreeMap::from([(id(1), active()?), (id(8), active()?) ]);
    let _ = compare(&mut batch, &mut references, vec![operation(8, key(PhysicalKey::ArrowDown, true)), operation(8, time(250))])?;
    assert_eq!(batch.snapshot(id(1))?, before);
    assert_ne!(batch.snapshot(id(8))?, before);
    let _ = compare(&mut batch, &mut references, vec![operation(1, key(PhysicalKey::ArrowDown, true)), operation(1, time(250))])?;
    assert_eq!(batch.snapshot(id(1))?, batch.snapshot(id(8))?);
    Ok(())
}

#[test]
fn limits_missing_duplicate_disposed_and_wrong_content_are_atomic() -> TestResult {
    let content = Arc::clone(&fixture()?.content);
    for limits in [CurrentBatchLimits { maximum_environments: 0, ..CurrentBatchLimits::default() },
        CurrentBatchLimits { maximum_environments: CURRENT_BATCH_MAXIMUM_ENVIRONMENTS + 1, ..CurrentBatchLimits::default() },
        CurrentBatchLimits { maximum_events: 0, ..CurrentBatchLimits::default() },
        CurrentBatchLimits { maximum_events: CURRENT_BATCH_MAXIMUM_EVENTS + 1, ..CurrentBatchLimits::default() },
        CurrentBatchLimits { maximum_result_bytes: 1, ..CurrentBatchLimits::default() },
        CurrentBatchLimits { maximum_result_bytes: CURRENT_BATCH_MAXIMUM_RESULT_BYTES + 1, ..CurrentBatchLimits::default() }]
    {
        assert!(matches!(CurrentBatch::new(Arc::clone(&content), limits), Err(CurrentBatchError::InvalidLimits)));
    }
    assert!(serde_json::from_value::<CurrentBatchEnvironmentId>(json!(u64::MAX)).is_err());
    let limits = CurrentBatchLimits { maximum_environments: 2, maximum_events: 2, ..CurrentBatchLimits::default() };
    let mut batch = batch(limits)?;
    let before = [batch.snapshot(id(1))?, batch.snapshot(id(2))?];
    assert!(matches!(batch.insert(id(1), active()?), Err(CurrentBatchError::DuplicateEnvironment { .. })));
    assert!(matches!(batch.fork(id(1), id(3)), Err(CurrentBatchError::EnvironmentCapacity { maximum: 2 })));
    assert!(matches!(batch.execute(vec![operation(1, time(1)), operation(9, time(1))]),
        Err(CurrentBatchError::MissingEnvironment { environment }) if environment == id(9)));
    assert!(matches!(batch.execute(vec![operation(1, time(1)); 3]), Err(CurrentBatchError::EventCapacity { maximum: 2 })));
    assert_eq!([batch.snapshot(id(1))?, batch.snapshot(id(2))?], before);
    batch.remove(id(2))?;
    let mut disposed = active()?;
    disposed.dispose();
    assert!(matches!(batch.insert(id(2), disposed), Err(CurrentBatchError::Session { source: CurrentSessionError::Disposed, .. })));
    assert!(matches!(batch.fork(id(9), id(2)), Err(CurrentBatchError::MissingEnvironment { .. })));
    let mut bundle = (**content.bundle()).clone();
    let bootstrap = Arc::make_mut(&mut bundle.bootstrap);
    bootstrap.modes.first_mut().ok_or("mode fixture")?.key.push_str("-batch-other");
    bootstrap.content_hash = bootstrap.recompute_hash()?;
    bundle.content_hash = bundle.recompute_hash()?;
    let wrong = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?);
    assert_ne!(wrong.identity(), content.identity());
    assert!(matches!(batch.insert(id(2), natural(wrong)?), Err(CurrentBatchError::ContentMismatch { environment }) if environment == id(2)));
    assert_eq!(batch.environment_ids(), [id(1)]);
    assert_eq!(batch.snapshot(id(1))?, before[0]);
    batch.fork(id(1), id(2))?;
    assert_eq!(batch.len(), 2);
    batch.dispose();
    assert!(batch.is_empty());
    assert!(batch.is_disposed());
    assert!(matches!(batch.snapshot(id(1)), Err(CurrentBatchError::Disposed)));
    assert!(matches!(batch.execute(Vec::new()), Err(CurrentBatchError::Disposed)));
    assert!(matches!(batch.insert(id(1), active()?), Err(CurrentBatchError::Disposed)));
    Ok(())
}
