use er_game::internal_event::{
    ButtonEventPayload, INTERNAL_EVENT_BUDGET, InternalEvent, InternalEventKind,
    InternalEventQueue, InternalEventQueueError, UiEventPayload,
};
use er_types::battle_ids::MenuInstanceId;
use er_types::{ButtonEvent, GameButton, MenuOptionId, SafeU53, SeatId};

const INTERNAL_EVENT_SOURCE: &str = include_str!("../src/internal_event.rs");
const AUTHORITY_COMMAND_SOURCE: &str = include_str!("../src/authority_commands.rs");
const TRANSACTION_SOURCE: &str = include_str!("../src/transaction.rs");
const BATTLE_TURN_SOURCE: &str = include_str!("../../er-battle/src/turn.rs");
const RUNTIME_SOURCE: &str = include_str!("../src/runtime.rs");

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
        "pub struct TurnDigestEvidence",
        "pub enum InternalEvent",
        "pub enum InternalEventKind",
        "pub struct InternalEventQueue",
        "pub fn resolve_turn_trusted_with_finalizer",
    ] {
        let source = if item.contains("resolve_turn") {
            BATTLE_TURN_SOURCE
        } else {
            INTERNAL_EVENT_SOURCE
        };
        assert_doc_hidden_before(source, item);
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

    let digest_fields = struct_body(INTERNAL_EVENT_SOURCE, "pub struct TurnDigestEvidence");
    assert!(!digest_fields.contains("pub transition"));
    assert!(INTERNAL_EVENT_SOURCE.contains("pub(crate) fn from_finalized_transition"));
    assert!(!INTERNAL_EVENT_SOURCE.contains("fn into_transition"));

    assert!(BATTLE_TURN_SOURCE.contains("FinalizerError: From<BattleResolveError>"));
    let finalizer_call = BATTLE_TURN_SOURCE
        .split_once("let finalizer_decision_hint = {")
        .and_then(|(_, source)| source.split_once("validate_after_state_trusted(&after, content)?"))
        .map(|(source, _)| source)
        .expect("TURN finalizer must receive only a pre-validation decision hint");
    assert!(finalizer_call.contains("finalizer("));
    assert!(finalizer_call.contains("finalizer_decision_hint"));
    assert!(BATTLE_TURN_SOURCE.contains("validate_after_state_trusted(&after, content)?"));
    let finalized_metadata = BATTLE_TURN_SOURCE
        .split_once("validate_after_state_trusted(&after, content)?")
        .and_then(|(_, source)| source.split_once("let after_digest"))
        .map(|(source, _)| source)
        .expect("finalized TURN metadata must be derived after final validation");
    assert!(finalized_metadata.contains("let (outcome, next_decision)"));
    assert!(finalized_metadata.contains("let battle = active_battle(&after)?"));
    assert!(BATTLE_TURN_SOURCE.contains("validate_battle_mutation_evidence(before, &after"));
    assert!(BATTLE_TURN_SOURCE.contains("|_, _, _, _| Ok::<(), BattleResolveError>(())"));

    let reducer_identity = RUNTIME_SOURCE
        .split_once("fn validate_reducer_issued_turn_transition_identity(")
        .and_then(|(_, source)| source.split_once("fn validate_turn_transition_identity_inner("))
        .map(|(source, _)| source)
        .expect("reducer-issued transition identity seam must remain explicit");
    assert!(!reducer_identity.contains("validate_state_content_trusted"));
    assert!(!reducer_identity.contains("validate_battle_mutation_evidence"));
    assert!(!reducer_identity.contains("MechanicalStateDigest::compute"));
    let identity_inner = RUNTIME_SOURCE
        .split_once("fn validate_turn_transition_identity_inner(")
        .and_then(|(_, source)| source.split_once("fn validate_replacement_transition_identity("))
        .map(|(source, _)| source)
        .expect("turn transition identity implementation must remain explicit");
    assert!(identity_inner.contains("TurnTransitionDigestValidation::ReducerIssued"));

    let prepared_fields = struct_body(AUTHORITY_COMMAND_SOURCE, "pub struct PreparedAuthorityTurn");
    assert_doc_hidden_before(AUTHORITY_COMMAND_SOURCE, "pub struct PreparedAuthorityTurn");
    assert!(prepared_fields.contains("digest_evidence: TurnDigestEvidence"));
    assert!(!prepared_fields.contains("pub digest_evidence"));
    assert!(!prepared_fields.contains("pub transition"));
    assert!(!prepared_fields.contains("pub control_plan"));
    assert!(!prepared_fields.contains("pub admission"));
    assert!(AUTHORITY_COMMAND_SOURCE.contains("pub(crate) fn from_game_runtime"));
    assert!(AUTHORITY_COMMAND_SOURCE.contains("pub(crate) fn digest_evidence"));

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

#[test]
fn authority_local_proof_is_opaque_and_not_a_skip_flag() {
    assert_doc_hidden_before(
        INTERNAL_EVENT_SOURCE,
        "pub(crate) struct AuthorityLocalTurnProof<'a>",
    );
    let proof_start = INTERNAL_EVENT_SOURCE
        .find("pub(crate) struct AuthorityLocalTurnProof<'a>")
        .expect("authority-local proof type must remain in the game crate");
    let proof_end = INTERNAL_EVENT_SOURCE[proof_start..]
        .find("impl AuthorityLocalTurnProof")
        .map(|offset| proof_start + offset)
        .expect("authority-local proof implementation must remain adjacent");
    let proof_source = &INTERNAL_EVENT_SOURCE[proof_start..proof_end];
    assert!(proof_source.contains("transition: &'a BattleTransition"));
    assert!(proof_source.contains("control_plan: &'a BattleControlPlan"));
    assert!(proof_source.contains("menu_allocators_before: &'a [SeatMenuInstanceAllocator]"));
    assert!(proof_source.contains("material_operation_id: &'a OperationId"));
    assert!(!proof_source.contains("pub transition"));
    assert!(!proof_source.contains("pub control_plan"));
    assert!(!proof_source.contains("pub menu_allocators_before"));
    assert!(!proof_source.contains("pub material_operation_id"));
    assert!(INTERNAL_EVENT_SOURCE.contains("pub(crate) fn bind_authority_local_turn"));

    let authority_source = normalized_sanitized_source(AUTHORITY_COMMAND_SOURCE);
    assert!(authority_source.contains("pub(crate) fn bind_authority_local_turn"));
    assert!(authority_source.contains("self.digest_evidence.bind_authority_local_turn("));
    assert!(!authority_source.contains("skip_digest"));
    assert!(!authority_source.contains("bypass"));
}

fn assert_doc_hidden_before(source: &str, item: &str) {
    let position = source.find(item).expect("missing expected source item");
    let preceding = source[..position].lines().rev().take(8);
    assert!(
        preceding
            .filter(|line| !line.trim().is_empty())
            .any(|line| line.trim() == "#[doc(hidden)]"),
        "{item} must be doc-hidden as a kernel integration boundary"
    );
}

fn struct_body<'a>(source: &'a str, declaration: &str) -> &'a str {
    let start = source.find(declaration).expect("missing expected struct");
    let end = source[start..]
        .find('}')
        .map(|offset| start + offset)
        .expect("struct must have a closing brace");
    &source[start..=end]
}
