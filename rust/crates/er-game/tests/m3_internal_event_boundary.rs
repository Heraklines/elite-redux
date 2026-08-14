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

fn blank_non_newline_bytes(source: &[u8], sanitized: &mut [u8], start: usize, end: usize) {
    for index in start..end {
        if !matches!(source[index], b'\r' | b'\n') {
            sanitized[index] = b' ';
        }
    }
}

fn raw_string_start(source: &[u8], start: usize) -> Option<(usize, usize)> {
    let prefix_len = if source.get(start) == Some(&b'r') {
        1
    } else if matches!(source.get(start), Some(&b'b') | Some(&b'c'))
        && source.get(start + 1) == Some(&b'r')
    {
        2
    } else {
        return None;
    };

    let mut quote = start + prefix_len;
    let mut hash_count = 0;
    while source.get(quote) == Some(&b'#') {
        hash_count += 1;
        quote += 1;
    }
    (source.get(quote) == Some(&b'"')).then_some((quote + 1, hash_count))
}

fn raw_string_end(source: &[u8], start: usize) -> Option<usize> {
    let (content_start, hash_count) = raw_string_start(source, start)?;
    let mut index = content_start;
    while index < source.len() {
        if source[index] == b'"' {
            let mut closing = index + 1;
            let mut matched_hashes = 0;
            while matched_hashes < hash_count && source.get(closing) == Some(&b'#') {
                matched_hashes += 1;
                closing += 1;
            }
            if matched_hashes == hash_count {
                return Some(closing);
            }
        }
        index += 1;
    }
    Some(source.len())
}

fn string_quote_start(source: &[u8], start: usize) -> Option<usize> {
    if source.get(start) == Some(&b'"') {
        Some(start)
    } else if matches!(source.get(start), Some(&b'b') | Some(&b'c'))
        && source.get(start + 1) == Some(&b'"')
    {
        Some(start + 1)
    } else {
        None
    }
}

fn string_literal_end(source: &[u8], quote_start: usize) -> usize {
    let mut index = quote_start + 1;
    while index < source.len() {
        match source[index] {
            b'\\' => {
                index += 1;
                if index < source.len() {
                    index += 1;
                }
            }
            b'"' => return index + 1,
            _ => index += 1,
        }
    }
    source.len()
}

fn is_ascii_hex(byte: u8) -> bool {
    byte.is_ascii_hexdigit()
}

fn utf8_char_width(byte: u8) -> Option<usize> {
    match byte {
        0x00..=0x7f => Some(1),
        0xc2..=0xdf => Some(2),
        0xe0..=0xef => Some(3),
        0xf0..=0xf4 => Some(4),
        _ => None,
    }
}

fn char_literal_end(source: &[u8], quote_start: usize) -> Option<usize> {
    let mut index = quote_start + 1;
    let first = *source.get(index)?;
    if first == b'\\' {
        index += 1;
        match source.get(index) {
            Some(&b'u') if source.get(index + 1) == Some(&b'{') => {
                index += 2;
                let mut digits = 0;
                let mut closed = false;
                while let Some(&byte) = source.get(index) {
                    if byte == b'}' {
                        closed = (1..=6).contains(&digits);
                        index += 1;
                        break;
                    }
                    if !is_ascii_hex(byte) || digits == 6 {
                        return None;
                    }
                    digits += 1;
                    index += 1;
                }
                if !closed {
                    return None;
                }
            }
            Some(&b'x') => {
                index += 1;
                for _ in 0..2 {
                    match source.get(index) {
                        Some(&byte) if is_ascii_hex(byte) => index += 1,
                        _ => return None,
                    }
                }
            }
            Some(&byte) if !matches!(byte, b'\r' | b'\n') => index += 1,
            _ => return None,
        }
    } else {
        if matches!(first, b'\r' | b'\n') {
            return None;
        }
        let width = utf8_char_width(first)?;
        let end = index + width;
        if end > source.len()
            || !source[index + 1..end]
                .iter()
                .all(|byte| (byte & 0xc0) == 0x80)
        {
            return None;
        }
        index = end;
    }

    (source.get(index) == Some(&b'\'')).then_some(index + 1)
}

fn char_literal_quote_start(source: &[u8], start: usize) -> Option<usize> {
    if source.get(start) == Some(&b'\'') {
        Some(start)
    } else if source.get(start) == Some(&b'b') && source.get(start + 1) == Some(&b'\'') {
        Some(start + 1)
    } else {
        None
    }
}

fn sanitize_rust_source(source: &str) -> String {
    let source_bytes = source.as_bytes();
    let mut sanitized = source_bytes.to_vec();
    let mut index = 0;

    while index < source_bytes.len() {
        if source_bytes[index] == b'/' && source_bytes.get(index + 1) == Some(&b'/') {
            let mut end = index + 2;
            while end < source_bytes.len() && source_bytes[end] != b'\n' {
                end += 1;
            }
            blank_non_newline_bytes(source_bytes, &mut sanitized, index, end);
            index = end;
            continue;
        }

        if source_bytes[index] == b'/' && source_bytes.get(index + 1) == Some(&b'*') {
            let mut end = index + 2;
            let mut depth = 1;
            while end < source_bytes.len() && depth != 0 {
                if source_bytes[end] == b'/' && source_bytes.get(end + 1) == Some(&b'*') {
                    depth += 1;
                    end += 2;
                } else if source_bytes[end] == b'*' && source_bytes.get(end + 1) == Some(&b'/') {
                    depth -= 1;
                    end += 2;
                } else {
                    end += 1;
                }
            }
            blank_non_newline_bytes(source_bytes, &mut sanitized, index, end);
            index = end;
            continue;
        }

        if let Some(end) = raw_string_end(source_bytes, index) {
            blank_non_newline_bytes(source_bytes, &mut sanitized, index, end);
            index = end;
            continue;
        }

        if let Some(quote_start) = string_quote_start(source_bytes, index) {
            let end = string_literal_end(source_bytes, quote_start);
            blank_non_newline_bytes(source_bytes, &mut sanitized, index, end);
            index = end;
            continue;
        }

        if let Some(quote_start) = char_literal_quote_start(source_bytes, index)
            && let Some(end) = char_literal_end(source_bytes, quote_start)
        {
            blank_non_newline_bytes(source_bytes, &mut sanitized, index, end);
            index = end;
            continue;
        }

        index += 1;
    }

    String::from_utf8(sanitized).expect("source is valid UTF-8")
}

fn normalized_sanitized_source(source: &str) -> String {
    sanitize_rust_source(&source.replace("\r\n", "\n"))
}

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
    let internal_source = normalized_sanitized_source(INTERNAL_EVENT_SOURCE);
    let proof_start = internal_source
        .find("pub(crate) struct AuthorityLocalTurnProof<'a>")
        .expect("authority-local proof type must remain in the game crate");
    let proof_end = internal_source[proof_start..]
        .find("impl<'a> AuthorityLocalTurnProof<'a>")
        .map(|offset| proof_start + offset)
        .expect("authority-local proof implementation must remain adjacent");
    let proof_source = &internal_source[proof_start..proof_end];
    assert!(proof_source.contains("transition: &'a BattleTransition"));
    assert!(proof_source.contains("control_plan: &'a BattleControlPlan"));
    assert!(proof_source.contains("menu_allocators_before: &'a [SeatMenuInstanceAllocator]"));
    assert!(proof_source.contains("material_operation_id: &'a OperationId"));
    assert!(!proof_source.contains("pub transition"));
    assert!(!proof_source.contains("pub control_plan"));
    assert!(!proof_source.contains("pub menu_allocators_before"));
    assert!(!proof_source.contains("pub material_operation_id"));
    assert!(internal_source.contains("pub(crate) fn bind_authority_local_turn"));

    let authority_source = normalized_sanitized_source(AUTHORITY_COMMAND_SOURCE);
    assert!(authority_source.contains("pub(crate) fn bind_authority_local_turn"));
    assert!(authority_source.contains("self.digest_evidence().bind_authority_local_turn("));
    assert!(!authority_source.contains("self.digest_evidence.bind_authority_local_turn("));
    assert!(!authority_source.contains("skip_digest"));
    assert!(!authority_source.contains("bypass"));
}

#[test]
fn authority_local_proof_has_external_compile_fail_privacy_coverage() {
    assert!(INTERNAL_EVENT_SOURCE.contains("```compile_fail"));
    assert!(
        INTERNAL_EVENT_SOURCE.contains("er_game::internal_event::AuthorityLocalTurnProof<'static>")
    );
    assert!(INTERNAL_EVENT_SOURCE.contains("er_game::internal_event::AuthorityLocalTurnProof {"));
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
