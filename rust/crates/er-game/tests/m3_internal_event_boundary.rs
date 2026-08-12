use er_game::internal_event::{
    ButtonEventPayload, INTERNAL_EVENT_BUDGET, InternalEvent, InternalEventKind,
    InternalEventQueue, InternalEventQueueError, UiEventPayload,
};
use er_types::battle_ids::MenuInstanceId;
use er_types::{ButtonEvent, GameButton, MenuOptionId, SafeU53, SeatId};

const INTERNAL_EVENT_SOURCE: &str = include_str!("../src/internal_event.rs");
const TRANSACTION_SOURCE: &str = include_str!("../src/transaction.rs");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value must fit in a safe integer")
}

fn button(menu: u64) -> InternalEvent {
    InternalEvent::Button(ButtonEventPayload {
        endpoint: SeatId::new(safe(1)),
        menu_instance_id: MenuInstanceId::new(safe(menu)),
        event: ButtonEvent::Pressed(GameButton::Submit),
    })
}

fn ui(menu: u64) -> InternalEvent {
    InternalEvent::Ui(UiEventPayload::activate(
        SeatId::new(safe(1)),
        MenuInstanceId::new(safe(menu)),
        format!("control-{menu}"),
        MenuOptionId::new(format!("option-{menu}")).expect("test option ID must be valid"),
    ))
}

#[test]
fn fifo_keeps_source_order_and_read_only_processed_kind_evidence() {
    let mut queue = InternalEventQueue::from_events([button(1), ui(2), button(3), ui(4)]);
    let mut kinds = Vec::new();

    while let Some(event) = queue.pop().expect("FIFO pop must succeed") {
        kinds.push(event.kind());
    }

    assert_eq!(
        kinds,
        vec![
            InternalEventKind::Button,
            InternalEventKind::Ui,
            InternalEventKind::Button,
            InternalEventKind::Ui,
        ]
    );
    assert_eq!(queue.processed_kinds(), kinds.as_slice());
    assert!(queue.remaining_kinds().is_empty());
    assert!(queue.is_empty());
}

#[test]
fn budget_records_exactly_4096_kinds_and_keeps_event_4097() {
    let mut queue = InternalEventQueue::new();
    let expected_kinds: Vec<_> = (0..=INTERNAL_EVENT_BUDGET)
        .map(|index| match index % 2 {
            0 => InternalEventKind::Button,
            _ => InternalEventKind::Ui,
        })
        .collect();

    for index in 0..=INTERNAL_EVENT_BUDGET {
        let menu = index as u64 + 1;
        queue.push(match index % 2 {
            0 => button(menu),
            _ => ui(menu),
        });
    }

    for _ in 0..INTERNAL_EVENT_BUDGET {
        assert!(queue.pop().expect("budget events must process").is_some());
    }

    assert_eq!(queue.processed(), INTERNAL_EVENT_BUDGET);
    assert_eq!(
        queue.processed_kinds(),
        &expected_kinds[..INTERNAL_EVENT_BUDGET]
    );

    let error = queue
        .pop()
        .expect_err("event 4097 must be rejected at the fixed budget");
    assert_eq!(
        error,
        InternalEventQueueError::InternalEventBudgetExceeded {
            processed: INTERNAL_EVENT_BUDGET,
            remaining: 1,
            remaining_kinds: vec![expected_kinds[INTERNAL_EVENT_BUDGET]],
        }
    );
    assert_eq!(queue.len(), 1, "the rejected event must remain queued");
    assert_eq!(
        queue.remaining_kinds(),
        vec![expected_kinds[INTERNAL_EVENT_BUDGET]]
    );
    assert_eq!(
        queue.processed_kinds(),
        &expected_kinds[..INTERNAL_EVENT_BUDGET],
        "budget rejection must not append a phantom processed kind"
    );

    let repeated_error = queue
        .pop()
        .expect_err("a non-empty queue remains over budget");
    assert_eq!(repeated_error, error);
    assert_eq!(
        queue.len(),
        1,
        "repeated rejection must not drop event 4097"
    );
}

#[test]
fn semantic_event_and_transaction_surfaces_are_sealed_for_kernel_integration() {
    for item in [
        "pub struct CausalIdentity",
        "pub enum GameIntent",
        "pub struct UiEventPayload",
        "pub struct GameEventPayload",
        "pub enum InternalEvent",
        "pub enum InternalEventKind",
        "pub struct InternalEventQueue",
    ] {
        assert_doc_hidden_before(INTERNAL_EVENT_SOURCE, item);
    }
    for constructor in [
        "pub fn activate(",
        "pub fn cancel(endpoint: SeatId",
        "pub fn new(operation_id: Option<OperationId>",
    ] {
        assert_doc_hidden_before(INTERNAL_EVENT_SOURCE, constructor);
    }
    assert!(
        !INTERNAL_EVENT_SOURCE.contains("UiIntent"),
        "Battle UI payload must not carry the legacy semantic intent type"
    );
    assert!(
        !INTERNAL_EVENT_SOURCE.contains("serde_json::Value"),
        "Battle UI payload must not carry a serde JSON value"
    );
    assert!(INTERNAL_EVENT_SOURCE.contains("pub(crate) enum BattleUiAction"));
    assert!(INTERNAL_EVENT_SOURCE.contains("Activate {"));
    assert!(INTERNAL_EVENT_SOURCE.contains("Cancel {"));
    assert!(INTERNAL_EVENT_SOURCE.contains("control_id: String"));
    assert!(INTERNAL_EVENT_SOURCE.contains("option_id: MenuOptionId"));
    assert!(
        INTERNAL_EVENT_SOURCE.contains("pub(crate) fn new(intent: GameIntent"),
        "Game payload construction must remain crate-private"
    );
    assert!(
        !INTERNAL_EVENT_SOURCE.contains("pub fn new(intent: GameIntent"),
        "Game payload construction must not be a public semantic API"
    );
    assert!(
        INTERNAL_EVENT_SOURCE.contains("pub(crate) fn no_legal_replacement"),
        "automatic no-legal replacement construction must be crate-private"
    );
    assert!(
        INTERNAL_EVENT_SOURCE.contains("pub(crate) fn enqueue_no_legal_replacement"),
        "automatic no-legal replacement queue insertion must be crate-private"
    );

    let ui_fields = struct_body(INTERNAL_EVENT_SOURCE, "pub struct UiEventPayload");
    assert!(!ui_fields.contains("pub endpoint"));
    assert!(!ui_fields.contains("pub menu_instance_id"));
    assert!(!ui_fields.contains("pub action"));

    let game_fields = struct_body(INTERNAL_EVENT_SOURCE, "pub struct GameEventPayload");
    assert!(!game_fields.contains("pub intent"));
    assert!(!game_fields.contains("pub causal"));

    for method in [
        "pub fn reduce",
        "pub fn apply_intent",
        "pub fn install_resolution",
        "pub fn install_state",
        "pub fn install_control",
        "pub fn validate",
        "pub fn commit",
        "pub fn commit_into",
        "pub fn rollback",
    ] {
        assert_doc_hidden_before(TRANSACTION_SOURCE, method);
    }
    assert!(TRANSACTION_SOURCE.contains("pub(crate) fn begin"));
    assert!(TRANSACTION_SOURCE.contains("er-kernel"));
    assert!(TRANSACTION_SOURCE.contains("doc-hidden"));
    assert!(TRANSACTION_SOURCE.contains("let mut candidate = self.staged.clone();"));
    assert!(TRANSACTION_SOURCE.contains("candidate.validate()?;"));
    assert!(TRANSACTION_SOURCE.contains("self.staged = candidate;"));
    assert!(TRANSACTION_SOURCE.contains("if *live != self.base"));
    for insertion in [
        "pub fn push(&mut self, event: InternalEvent)",
        "pub fn push_all_source_order(",
    ] {
        assert_doc_hidden_before(INTERNAL_EVENT_SOURCE, insertion);
    }

    for vocabulary in [
        "Button",
        "Ui",
        "Game",
        "Protocol",
        "BattleResolved",
        "AuthorityEntryReady",
        "MaterialInstalled",
        "ControlInstalled",
    ] {
        assert!(
            INTERNAL_EVENT_SOURCE.contains(vocabulary),
            "frozen internal event vocabulary lost {vocabulary}"
        );
    }
}

fn assert_doc_hidden_before(source: &str, item: &str) {
    let position = source
        .find(item)
        .expect("missing expected source item");
    let preceding = source[..position].lines().rev().take(8);
    assert!(
        preceding
            .filter(|line| !line.trim().is_empty())
            .any(|line| line.trim() == "#[doc(hidden)]"),
        "{item} must be doc-hidden as a kernel integration boundary"
    );
}

fn struct_body<'a>(source: &'a str, declaration: &str) -> &'a str {
    let start = source
        .find(declaration)
        .expect("missing expected struct");
    let end = source[start..]
        .find('}')
        .map(|offset| start + offset)
        .expect("struct must have a closing brace");
    &source[start..=end]
}
