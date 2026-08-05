use er_protocol::{
    LocalPresentationInputProof, control_allows_successor_entry, control_id_of,
    control_owner_seat_id, control_owner_seat_ids, controls_equal, is_valid_next_control,
    next_control_issues, partition_control_for_seat, same_control_address, successor_wait_allows,
    successor_wait_allows_local_presentation_input, validate_next_control,
};
use er_types::{
    AuthorityEntry, AuthorityEntryKind, AwaitSuccessorControl, CommandControlTarget,
    CommandFrontierControl, ConnectionGeneration, ControlAddress, FrameContext,
    InteractionControlAddress, InteractionSuccessor, Material, MembershipRevision, NextControl,
    OperationId, ReplacementControl, ReplacementControlAddress, RunId, SafeU53, SeatId, SessionId,
    SharedInteractionControl, TerminalControl,
};
use serde_json::{Value, json};

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test coordinate must be JavaScript-safe")
}

fn operation(value: &str) -> OperationId {
    OperationId::new(value).expect("test operation id must be valid")
}

fn command_target(field_index: u64, owner_seat_id: u64, pokemon_id: u64) -> CommandControlTarget {
    CommandControlTarget {
        owner_seat_id: SeatId::new(safe(owner_seat_id)),
        pokemon_id: safe(pokemon_id),
        field_index: safe(field_index),
    }
}

fn command_control(commands: Vec<CommandControlTarget>) -> NextControl {
    NextControl::CommandFrontier(CommandFrontierControl {
        epoch: safe(1),
        wave: safe(2),
        turn: safe(3),
        commands,
    })
}

fn replacement_control(operation_id: &str) -> NextControl {
    NextControl::Replacement(ReplacementControl {
        operation_id: operation(operation_id),
        owner_seat_id: SeatId::new(safe(0)),
        epoch: safe(1),
        wave: safe(2),
        turn: safe(3),
        occurrence: safe(0),
        field_index: safe(0),
        remaining: vec![ReplacementControlAddress {
            operation_id: operation("replacement/tail/1"),
            owner_seat_id: SeatId::new(safe(1)),
            epoch: safe(1),
            wave: safe(2),
            turn: safe(3),
            occurrence: safe(1),
            field_index: safe(1),
        }],
    })
}

fn shared_control(operation_kind: &str, operation_ids: Option<Vec<OperationId>>) -> NextControl {
    NextControl::SharedInteraction(SharedInteractionControl {
        operation_id: operation("interaction/current"),
        owner_seat_id: SeatId::new(safe(1)),
        epoch: safe(1),
        wave: safe(2),
        turn: safe(3),
        surface_class: "op:reward".to_owned(),
        operation_kind: operation_kind.to_owned(),
        successor: InteractionSuccessor {
            operation_kinds: vec!["REWARD".to_owned(), "REWARD_PRESENT".to_owned()],
            operation_ids,
        },
    })
}

fn successor_wait() -> AwaitSuccessorControl {
    AwaitSuccessorControl {
        after_operation_id: operation("predecessor"),
        epoch: safe(1),
        wave: safe(2),
        turn: safe(3),
        allowed_kinds: vec![
            AuthorityEntryKind::ControlCommit,
            AuthorityEntryKind::InteractionCommit,
            AuthorityEntryKind::WaveAdvance,
            AuthorityEntryKind::TerminalCommit,
        ],
        allowed_interaction_addresses: None,
        allowed_control_addresses: None,
        allow_next_wave_start: true,
        expected_operation_id: None,
    }
}

fn context() -> FrameContext {
    FrameContext {
        session_id: SessionId::new("session").expect("test session id must be valid"),
        run_id: RunId::new("run").expect("test run id must be valid"),
        session_epoch: safe(1),
        seat_map_id: "seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id: SeatId::new(safe(0)),
        authority_seat_id: SeatId::new(safe(0)),
        connection_generation: ConnectionGeneration::new(safe(1)),
    }
}

fn entry(
    kind: AuthorityEntryKind,
    operation_id: &str,
    payload: Value,
    next_control: NextControl,
) -> AuthorityEntry {
    AuthorityEntry {
        context: context(),
        revision: er_types::Revision::new(safe(1)),
        operation_id: operation(operation_id),
        kind,
        material: Material {
            digest: "digest".to_owned(),
            payload,
        },
        next_control,
        subsumes: Vec::new(),
    }
}

#[test]
fn control_ids_match_the_frozen_fixture_shapes() {
    let command = command_control(vec![command_target(1, 1, 202), command_target(0, 0, 101)]);
    assert_eq!(
        control_id_of(&command),
        "COMMAND_FRONTIER/e1/w2/t3/f0:s0:p101,f1:s1:p202"
    );

    let replacement = replacement_control("replacement/e1/w2/t3/o0/f0");
    assert_eq!(
        control_id_of(&replacement),
        "REPLACEMENT/replacement%2Fe1%2Fw2%2Ft3%2Fo0%2Ff0/s0/e1/w2/t3/o0/f0/remaining:replacement%2Ftail%2F1:s1:e1:w2:t3:o1:f1"
    );

    let shared = shared_control("ABILITY_PRESENT", None);
    assert_eq!(
        control_id_of(&shared),
        "SHARED_INTERACTION/op%3Areward/ABILITY_PRESENT/interaction%2Fcurrent/s1/e1/w2/t3/results:REWARD,REWARD_PRESENT/resultIds:*"
    );

    let wait = NextControl::AwaitSuccessor(successor_wait());
    assert_eq!(
        control_id_of(&wait),
        "AWAIT_SUCCESSOR/predecessor/e1/w2/t3/INTERACTION_COMMIT,CONTROL_COMMIT,WAVE_ADVANCE,TERMINAL_COMMIT/interactionAddresses:*/controlAddresses:*/nextWave:1/next:*"
    );

    let terminal = NextControl::Terminal(TerminalControl {
        terminal_id: "terminal/e1/w2".to_owned(),
    });
    assert_eq!(control_id_of(&terminal), "TERMINAL/terminal%2Fe1%2Fw2");
}

#[test]
fn control_id_uses_encode_uri_component_and_utf16_ordering() {
    let terminal = NextControl::Terminal(TerminalControl {
        terminal_id: "é/🙂?&=+% #!*'()~_-.".to_owned(),
    });
    assert_eq!(
        control_id_of(&terminal),
        "TERMINAL/%C3%A9%2F%F0%9F%99%82%3F%26%3D%2B%25%20%23!*'()~_-."
    );

    let high_plane = operation("𐀀");
    let private_use = operation("");
    let first = shared_control(
        "REWARD",
        Some(vec![private_use.clone(), high_plane.clone()]),
    );
    let second = shared_control("REWARD", Some(vec![high_plane, private_use]));
    assert_eq!(control_id_of(&first), control_id_of(&second));
    assert!(control_id_of(&first).contains("resultIds:%F0%90%80%80,%EE%80%80"));
}

#[test]
fn control_id_canonicalizes_sets_but_preserves_replacement_tail_order() {
    let first = command_control(vec![
        command_target(2, 1, 99),
        command_target(0, 1, 11),
        command_target(1, 0, 22),
    ]);
    let second = command_control(vec![
        command_target(1, 0, 22),
        command_target(2, 1, 99),
        command_target(0, 1, 11),
    ]);
    assert_eq!(control_id_of(&first), control_id_of(&second));
    assert!(controls_equal(Some(&first), Some(&second)));
    assert!(same_control_address(&first, &second));

    let mut replacement = replacement_control("head");
    if let NextControl::Replacement(control) = &mut replacement {
        control.remaining.push(er_types::ReplacementControlAddress {
            operation_id: operation("replacement/tail/2"),
            owner_seat_id: SeatId::new(safe(0)),
            epoch: safe(1),
            wave: safe(2),
            turn: safe(3),
            occurrence: safe(2),
            field_index: safe(2),
        });
    }
    let replacement_id = control_id_of(&replacement);
    if let NextControl::Replacement(control) = &mut replacement {
        control.remaining.reverse();
    }
    assert_ne!(replacement_id, control_id_of(&replacement));

    let mut wait_a = successor_wait();
    wait_a.allowed_kinds.reverse();
    wait_a.allowed_interaction_addresses = Some(vec![
        InteractionControlAddress {
            surface_class: "op:reward".to_owned(),
            operation_kind: "REWARD".to_owned(),
            wave: safe(2),
            turn: safe(3),
        },
        InteractionControlAddress {
            surface_class: "op:me".to_owned(),
            operation_kind: "ME_BUTTON".to_owned(),
            wave: safe(2),
            turn: safe(3),
        },
    ]);
    wait_a.allowed_control_addresses = Some(vec![
        ControlAddress {
            material_kind: "interaction-open".to_owned(),
            wave: safe(2),
            turn: safe(3),
            operation_id: Some(operation("control/2")),
        },
        ControlAddress {
            material_kind: "command-open".to_owned(),
            wave: safe(2),
            turn: safe(3),
            operation_id: None,
        },
    ]);
    let mut wait_b = wait_a.clone();
    if let Some(items) = wait_b.allowed_interaction_addresses.as_mut() {
        items.reverse();
    }
    if let Some(items) = wait_b.allowed_control_addresses.as_mut() {
        items.reverse();
    }
    assert_eq!(
        control_id_of(&NextControl::AwaitSuccessor(wait_a)),
        control_id_of(&NextControl::AwaitSuccessor(wait_b))
    );
}

#[test]
fn semantic_validation_rejects_invalid_coordinates_chains_and_closed_surfaces() {
    let invalid_command = json!({
        "kind": "COMMAND_FRONTIER",
        "epoch": 0,
        "wave": 2,
        "turn": 3,
        "commands": [
            {"ownerSeatId": 0, "pokemonId": 7, "fieldIndex": 0},
            {"ownerSeatId": 1, "pokemonId": 8, "fieldIndex": 0}
        ]
    });
    let issues = next_control_issues(&invalid_command);
    assert!(issues.contains(&"epoch".to_owned()));
    assert!(issues.contains(&"commands[1].fieldIndex: duplicate".to_owned()));
    assert!(!is_valid_next_control(&invalid_command));

    let invalid_replacement = json!({
        "kind": "REPLACEMENT",
        "operationId": "head",
        "ownerSeatId": 0,
        "epoch": 1,
        "wave": 2,
        "turn": 3,
        "occurrence": 2,
        "fieldIndex": 0,
        "remaining": [
            {"operationId": "head", "ownerSeatId": 1, "epoch": 1, "wave": 2, "turn": 3, "occurrence": 2, "fieldIndex": 1},
            {"operationId": "tail", "ownerSeatId": 1, "epoch": 1, "wave": 4, "turn": 3, "occurrence": 1, "fieldIndex": 2}
        ]
    });
    let issues = next_control_issues(&invalid_replacement);
    assert!(issues.contains(&"remaining[0].occurrence: order".to_owned()));
    assert!(issues.contains(&"remaining[0].operationId: duplicate".to_owned()));
    assert!(issues.contains(&"remaining[1]: boundary".to_owned()));

    let invalid_shared = json!({
        "kind": "SHARED_INTERACTION",
        "operationId": "interaction",
        "ownerSeatId": 0,
        "epoch": 1,
        "wave": 2,
        "turn": 3,
        "surfaceClass": "op:reward",
        "operationKind": "LEARN_MOVE",
        "successor": {"operationKinds": ["REWARD", "REWARD"], "operationIds": []}
    });
    let issues = next_control_issues(&invalid_shared);
    assert!(issues.contains(&"surfaceClass/operationKind".to_owned()));
    assert!(issues.contains(&"successor.operationKinds[1]: duplicate".to_owned()));
    assert!(issues.contains(&"successor.operationIds".to_owned()));

    let invalid_wait = json!({
        "kind": "AWAIT_SUCCESSOR",
        "afterOperationId": "predecessor",
        "epoch": 1,
        "wave": 2,
        "turn": 3,
        "allowedKinds": ["CONTROL_COMMIT"],
        "allowNextWaveStart": false,
        "expectedOperationId": null,
        "allowedControlAddresses": [{"materialKind": "command-open", "wave": 3, "turn": 1, "operationId": null}]
    });
    let issues = next_control_issues(&invalid_wait);
    assert!(issues.contains(&"allowedControlAddresses[0]".to_owned()));

    let invalid_terminal = json!({"kind": "TERMINAL", "terminalId": ""});
    assert_eq!(next_control_issues(&invalid_terminal), vec!["terminalId"]);
    assert!(!is_valid_next_control(&invalid_terminal));

    let valid = serde_json::to_value(command_control(vec![command_target(0, 0, 7)]))
        .expect("typed control serializes");
    assert!(validate_next_control(&valid).is_ok());
}

#[test]
fn successor_authorization_rejects_stale_and_unauthorized_entries() {
    let predecessor = operation("predecessor");
    let command = command_control(vec![command_target(0, 0, 7)]);
    let accepted = entry(
        AuthorityEntryKind::TurnCommit,
        "turn/accepted",
        json!({"epoch": 1, "wave": 2, "turn": 3}),
        command.clone(),
    );
    assert!(control_allows_successor_entry(
        &command,
        &predecessor,
        &accepted
    ));

    let stale = entry(
        AuthorityEntryKind::TurnCommit,
        "turn/stale",
        json!({"epoch": 1, "wave": 2, "turn": 4}),
        command.clone(),
    );
    assert!(!control_allows_successor_entry(
        &command,
        &predecessor,
        &stale
    ));

    let wrong_kind = entry(
        AuthorityEntryKind::ControlCommit,
        "control/wrong-kind",
        json!({"wave": 2, "turn": 3, "kind": "command-open"}),
        command.clone(),
    );
    assert!(!control_allows_successor_entry(
        &command,
        &predecessor,
        &wrong_kind
    ));

    let replacement = replacement_control("replacement/head");
    let replacement_entry = entry(
        AuthorityEntryKind::ReplacementCommit,
        "replacement/head",
        json!({"sourceAddress": {"epoch": 1, "wave": 2, "turn": 3}}),
        replacement.clone(),
    );
    assert!(control_allows_successor_entry(
        &replacement,
        &predecessor,
        &replacement_entry
    ));
    let unauthorized_replacement = entry(
        AuthorityEntryKind::ReplacementCommit,
        "replacement/other",
        json!({"sourceAddress": {"epoch": 1, "wave": 2, "turn": 3}}),
        replacement.clone(),
    );
    assert!(!control_allows_successor_entry(
        &replacement,
        &predecessor,
        &unauthorized_replacement
    ));

    let shared = shared_control("REWARD_PRESENT", Some(vec![operation("interaction/wrong")]));
    let shared_entry = entry(
        AuthorityEntryKind::InteractionCommit,
        "interaction/result",
        json!({
            "surfaceClass": "op:reward",
            "envelope": {
                "sessionEpoch": 1,
                "wave": 2,
                "turn": 3,
                "pendingOperation": {"kind": "REWARD"}
            }
        }),
        shared.clone(),
    );
    assert!(!control_allows_successor_entry(
        &shared,
        &predecessor,
        &shared_entry
    ));
    let shared_result = NextControl::SharedInteraction(SharedInteractionControl {
        operation_id: operation("interaction/current"),
        owner_seat_id: SeatId::new(safe(1)),
        epoch: safe(1),
        wave: safe(2),
        turn: safe(3),
        surface_class: "op:reward".to_owned(),
        operation_kind: "REWARD_PRESENT".to_owned(),
        successor: InteractionSuccessor {
            operation_kinds: vec!["REWARD".to_owned()],
            operation_ids: Some(vec![operation("interaction/result")]),
        },
    });
    assert!(control_allows_successor_entry(
        &shared_result,
        &predecessor,
        &shared_entry
    ));
}

#[test]
fn successor_wait_applies_exact_addresses_and_bounded_progression() {
    let mut wait = successor_wait();
    wait.allowed_kinds = vec![
        AuthorityEntryKind::ControlCommit,
        AuthorityEntryKind::InteractionCommit,
    ];
    wait.allow_next_wave_start = false;
    let wait_id = operation("predecessor");
    let command_open = json!({"kind": "command-open", "wave": 2, "turn": 4});
    assert!(successor_wait_allows(
        &wait,
        &wait_id,
        AuthorityEntryKind::ControlCommit,
        &operation("control/4"),
        safe(1),
        &command_open
    ));
    assert!(!successor_wait_allows(
        &wait,
        &wait_id,
        AuthorityEntryKind::ControlCommit,
        &operation("control/3"),
        safe(1),
        &json!({"kind": "command-open", "wave": 2, "turn": 3})
    ));
    assert!(!successor_wait_allows(
        &wait,
        &wait_id,
        AuthorityEntryKind::ControlCommit,
        &operation("control/4"),
        safe(2),
        &command_open
    ));

    wait.allowed_kinds = vec![AuthorityEntryKind::InteractionCommit];
    wait.allowed_interaction_addresses = Some(vec![InteractionControlAddress {
        surface_class: "op:me".to_owned(),
        operation_kind: "ME_TERMINAL".to_owned(),
        wave: safe(2),
        turn: safe(3),
    }]);
    let interaction_material = json!({
        "surfaceClass": "op:me",
        "envelope": {
            "sessionEpoch": 1,
            "wave": 2,
            "turn": 3,
            "pendingOperation": {"kind": "ME_TERMINAL"}
        }
    });
    assert!(successor_wait_allows(
        &wait,
        &wait_id,
        AuthorityEntryKind::InteractionCommit,
        &operation("interaction/terminal"),
        safe(1),
        &interaction_material
    ));
    assert!(!successor_wait_allows(
        &wait,
        &wait_id,
        AuthorityEntryKind::InteractionCommit,
        &operation("interaction/terminal"),
        safe(1),
        &json!({
            "surfaceClass": "op:reward",
            "envelope": {"sessionEpoch": 1, "wave": 2, "turn": 3, "pendingOperation": {"kind": "ME_TERMINAL"}}
        })
    ));
}

#[test]
fn command_frontier_accepts_only_the_frozen_turn_resolve_prompt_bridge() {
    let command = command_control(vec![command_target(0, 0, 7)]);
    let prompt = entry(
        AuthorityEntryKind::InteractionCommit,
        "prompt/learn",
        json!({
            "kind": "OPERATION_ENVELOPE_V1",
            "surfaceClass": "op:learnMove",
            "envelope": {
                "logicalPhase": "TURN_RESOLVE",
                "sessionEpoch": 1,
                "wave": 2,
                "turn": 3,
                "pendingOperation": {
                    "id": "prompt/learn",
                    "kind": "LEARN_MOVE",
                    "status": "applied",
                    "payload": {"type": "prompt"}
                }
            }
        }),
        command.clone(),
    );
    assert!(control_allows_successor_entry(
        &command,
        &operation("predecessor"),
        &prompt
    ));

    let not_prompt = entry(
        AuthorityEntryKind::InteractionCommit,
        "prompt/learn",
        json!({
            "kind": "OPERATION_ENVELOPE_V1",
            "surfaceClass": "op:learnMove",
            "envelope": {
                "logicalPhase": "TURN_RESOLVE",
                "sessionEpoch": 1,
                "wave": 2,
                "turn": 3,
                "pendingOperation": {
                    "id": "prompt/learn",
                    "kind": "LEARN_MOVE",
                    "status": "applied",
                    "payload": {"type": "choice"}
                }
            }
        }),
        command.clone(),
    );
    assert!(!control_allows_successor_entry(
        &command,
        &operation("predecessor"),
        &not_prompt
    ));
}

#[test]
fn local_presentation_bridge_is_limited_to_level_up_and_next_encounter() {
    let mut wait = successor_wait();
    wait.allowed_kinds = vec![AuthorityEntryKind::InteractionCommit];
    let exact_level_up = LocalPresentationInputProof {
        session_epoch: safe(1),
        wave: safe(2),
        turn: safe(3),
        phase_name: "LevelUpPhase".to_owned(),
        message_handler_actionable: true,
    };
    let exact_next_encounter = LocalPresentationInputProof {
        session_epoch: safe(1),
        wave: safe(3),
        turn: safe(1),
        phase_name: "NextEncounterPhase".to_owned(),
        message_handler_actionable: true,
    };
    assert!(successor_wait_allows_local_presentation_input(
        &wait,
        &exact_level_up
    ));
    assert!(successor_wait_allows_local_presentation_input(
        &wait,
        &exact_next_encounter
    ));
    assert!(!successor_wait_allows_local_presentation_input(
        &wait,
        &LocalPresentationInputProof {
            phase_name: "MessagePhase".to_owned(),
            ..exact_level_up.clone()
        }
    ));
    assert!(!successor_wait_allows_local_presentation_input(
        &wait,
        &LocalPresentationInputProof {
            session_epoch: safe(2),
            ..exact_next_encounter.clone()
        }
    ));
    wait.allow_next_wave_start = false;
    assert!(!successor_wait_allows_local_presentation_input(
        &wait,
        &exact_level_up
    ));
}

#[test]
fn ownership_and_partitions_are_numeric_and_deterministic() {
    let frontier = command_control(vec![
        command_target(2, 1, 44),
        command_target(0, 0, 42),
        command_target(1, 1, 43),
    ]);
    assert_eq!(
        control_owner_seat_ids(&frontier),
        [SeatId::new(safe(0)), SeatId::new(safe(1))]
            .into_iter()
            .collect()
    );
    assert_eq!(control_owner_seat_id(&frontier), None);
    let seat_one = partition_control_for_seat(&frontier, SeatId::new(safe(1)));
    assert_eq!(
        seat_one,
        Some(command_control(vec![
            command_target(1, 1, 43),
            command_target(2, 1, 44),
        ]))
    );
    assert!(partition_control_for_seat(&frontier, SeatId::new(safe(2))).is_some());

    let terminal = NextControl::Terminal(TerminalControl {
        terminal_id: "terminal".to_owned(),
    });
    assert_eq!(control_owner_seat_ids(&terminal).len(), 0);
    assert_eq!(control_owner_seat_id(&terminal), None);
}
