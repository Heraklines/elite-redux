use std::error::Error;
use std::sync::Arc;

use er_canonical::canonical_bytes;
use er_content::pack::{ContentPack, selected_content_pack};
use er_content::species::find_species;
use er_game::runtime::BATTLE_START_SCHEMA_VERSION;
use er_kernel::snapshot::{KernelDeterminismDigest, RestorableKernelSnapshotV2};
use er_kernel::{
    BattleGameConfig, BattleProtocolConfig, BattleProtocolRoleConfig, BattleStartV1, GameKernel,
    KernelConfig, ProtocolKernelConfig, ProtocolRoleConfig,
};
use er_protocol::{
    AuthorityEntryIdentitySnapshotV2, AuthorityLogConfig, AuthorityReplicaConfig, BackoffPolicy,
    BattleTerminalMaterialV1, BattleTerminalReasonV1, OpaqueAuthorityEntrySnapshotV2, PeerBinding,
    ProposalLeaseConfig, RecoveryTransactionConfig, TailProofReplicaCaptureSnapshotV2,
    TailProofReplicaSnapshotV2, build_battle_terminal_commit_draft, control_id_of,
};
use er_rng::phaser::{PhaserRdg, RunRngState};
use er_state::format::BattleFormat;
use er_state::pokemon::{
    AbilityLoadout, BattleStats, MoveSlotState, PokemonState, StatStages, StatusState,
};
use er_state::snapshot::GameState;
use er_types::battle_command::{
    BattleCommand, BattleTargetSelection, ScriptedEnemyBattleCommandV1, ScriptedEnemyPolicyV1,
    scripted_enemy_command_operation_id,
};
use er_types::battle_ids::{
    BattleId, BattleSide, CanonicalHexBytes, FieldSlot, GameModeId, MoveSlotIndex, PartyIndex,
    PokemonId, SpeciesId, TurnIndex, WaveIndex,
};
use er_types::battle_ui::PresentationSettlementOutcome;
use er_types::{
    AuthorityEntry, AuthorityEntryBody, AuthorityEntryKind, AwaitSuccessorControl,
    ConnectionGeneration, ControlProjectionOutcome, FRAME_PROTOCOL_VERSION, FrameContext,
    FrameType, InputFocus, InputMap, KernelEffect, KernelInput, Material,
    MaterialApplicationOutcome, MembershipRevision, NetworkFrame, NextControl, OperationId,
    PhysicalKey, RawInputEvent, Revision, RunId, SafeU53, SeatId, SessionId, TailProofBody,
    TailProofPhase, TailRequestBody, TimeClass, UiState,
};
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(_) => SafeU53::MAX,
    }
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn generation(value: u64) -> ConnectionGeneration {
    ConnectionGeneration::new(safe(value))
}

fn revision(value: u64) -> Revision {
    Revision::new(safe(value))
}

fn operation(value: &str) -> TestResult<OperationId> {
    Ok(OperationId::new(value.to_owned())?)
}

fn context(sender: u64) -> TestResult<FrameContext> {
    Ok(FrameContext {
        session_id: SessionId::new("m3-kernel-tail-proof")?,
        run_id: RunId::new("m3-kernel-tail-proof-run")?,
        session_epoch: safe(1),
        seat_map_id: "m3-kernel-tail-proof-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id: seat(sender),
        authority_seat_id: seat(0),
        connection_generation: generation(1),
    })
}

fn battle_context(sender: u64) -> TestResult<FrameContext> {
    Ok(FrameContext {
        session_id: SessionId::new("m3-battle-tail-proof")?,
        run_id: RunId::new("m3-battle-tail-proof-run")?,
        session_epoch: safe(1),
        seat_map_id: "m3-battle-tail-proof-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id: seat(sender),
        authority_seat_id: seat(1),
        connection_generation: generation(1),
    })
}

fn network_frame(
    frame_type: FrameType,
    context: FrameContext,
    body: serde_json::Value,
) -> er_types::NetworkFrame {
    er_types::NetworkFrame {
        version: FRAME_PROTOCOL_VERSION,
        frame_type,
        context,
        body,
    }
}

fn source() -> TestResult<AuthorityEntry> {
    let operation_id = operation("turn-1")?;
    Ok(AuthorityEntry {
        context: context(0)?,
        revision: revision(1),
        operation_id: operation_id.clone(),
        kind: AuthorityEntryKind::TurnCommit,
        material: Material {
            digest: "turn-1-digest".to_owned(),
            payload: json!({"kind": "turn", "wave": 1, "turn": 1}),
        },
        next_control: NextControl::AwaitSuccessor(AwaitSuccessorControl {
            after_operation_id: operation_id,
            epoch: safe(1),
            wave: safe(1),
            turn: safe(1),
            allowed_kinds: vec![AuthorityEntryKind::TurnCommit],
            allowed_interaction_addresses: None,
            allowed_control_addresses: None,
            allow_next_wave_start: false,
            expected_operation_id: Some(operation("turn-2")?),
        }),
        subsumes: Vec::new(),
    })
}

fn candidate() -> TestResult<AuthorityEntry> {
    let material = BattleTerminalMaterialV1::new(
        "terminal-2",
        BattleTerminalReasonV1::GameOver,
        safe(1),
        safe(1),
    )?;
    let draft = build_battle_terminal_commit_draft(
        context(0)?,
        operation("terminal-2")?,
        material,
        vec![revision(1)],
    )?;
    Ok(AuthorityEntry {
        context: draft.context,
        revision: revision(2),
        operation_id: draft.operation_id,
        kind: draft.kind,
        material: draft.material,
        next_control: draft.next_control,
        subsumes: draft.subsumes,
    })
}

fn replica_kernel() -> TestResult<GameKernel> {
    let local_context = context(1)?;
    Ok(GameKernel::new(KernelConfig {
        input_map: InputMap::default(),
        initial_ui: UiState::default(),
        protocol: Some(ProtocolKernelConfig {
            role: ProtocolRoleConfig::Replica {
                replica: AuthorityReplicaConfig {
                    receipt_context: local_context.clone(),
                    authority_seat_id: seat(0),
                    authority_connection_generation: generation(1),
                },
                proposal_leases: ProposalLeaseConfig {
                    owner_prefix: "m3-tail-proof-proposal".to_owned(),
                    retry_initial_ms: safe(250),
                    retry_maximum_ms: safe(5_000),
                    absolute_ceiling_ms: safe(1_200_000),
                },
                recovery: RecoveryTransactionConfig {
                    local_context,
                    request_timeout_ms: safe(5_000),
                    control_timeout_ms: safe(5_000),
                    pacing_ms: safe(16),
                    timer_owner_id: "m3-tail-proof-recovery".to_owned(),
                },
            },
            menu_plans: Vec::new(),
        }),
    }))
}

fn authority_entry_input(entry: &AuthorityEntry) -> TestResult<KernelInput> {
    Ok(KernelInput::NetworkFrame {
        endpoint: seat(1),
        frame: network_frame(
            FrameType::AuthorityEntry,
            entry.context.clone(),
            serde_json::to_value(AuthorityEntryBody::from(entry))?,
        ),
    })
}

fn proof_input(context: &FrameContext, body: TailProofBody) -> TestResult<KernelInput> {
    Ok(KernelInput::NetworkFrame {
        endpoint: seat(1),
        frame: network_frame(
            FrameType::TailProof,
            context.clone(),
            serde_json::to_value(body)?,
        ),
    })
}

fn pokemon_id(value: u64) -> PokemonId {
    PokemonId::new(safe(value))
}

fn battle_pokemon(
    content: &ContentPack,
    id: u64,
    owner_seat: Option<SeatId>,
    hp: u32,
) -> TestResult<PokemonState> {
    let species = find_species(&content.species, SpeciesId::new(safe(19)))?;
    let move_id = er_types::battle_ids::MoveId::new(safe(351));
    Ok(PokemonState::new(
        pokemon_id(id),
        owner_seat,
        species.id,
        0,
        25,
        species.base_types,
        BattleStats {
            hp: 100,
            attack: 100,
            defense: 100,
            special_attack: 100,
            special_defense: 100,
            speed: if owner_seat.is_some() { 120 } else { 80 },
        },
        hp,
        100,
        StatusState {
            kind: er_types::battle_model::StatusKind::None,
            toxic_turn_count: 0,
            sleep_turns_remaining: None,
        },
        StatStages {
            attack: 0,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: 0,
            accuracy: 0,
            evasion: 0,
        },
        [
            Some(MoveSlotState {
                move_id,
                pp_used: 0,
                pp_ups: 0,
                max_pp_override: None,
            }),
            None,
            None,
            None,
        ],
        AbilityLoadout {
            active: er_types::battle_ids::AbilityId::ZERO,
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        false,
    )?)
}

fn battle_game_config(content: &ContentPack) -> TestResult<BattleGameConfig> {
    let battle_id = BattleId::new(safe(1));
    let wave = WaveIndex::new(safe(1))?;
    let turn = TurnIndex::new(safe(1))?;
    let mut scripted = Vec::new();
    for position in 0_u8..2 {
        let enemy_slot = FieldSlot::new(BattleSide::Enemy, position)?;
        let player_slot = FieldSlot::new(BattleSide::Player, position)?;
        let actor = pokemon_id(3 + u64::from(position));
        let cursor = safe(u64::from(position));
        let command = BattleCommand::fight(
            actor,
            MoveSlotIndex::ZERO,
            BattleTargetSelection::selected(vec![player_slot])?,
        )?;
        scripted.push(ScriptedEnemyBattleCommandV1::new(
            scripted_enemy_command_operation_id(battle_id, wave, turn, enemy_slot, cursor)?,
            battle_id,
            wave,
            turn,
            cursor,
            actor,
            enemy_slot,
            command,
        )?);
    }
    let run_state = GameState::new(
        content.hash.clone(),
        GameModeId::new(safe(1)),
        wave,
        battle_id,
        RunRngState {
            rdg: PhaserRdg::from_seed("m3-battle-tail-proof-seed").state(),
        },
        None,
    )?;
    Ok(BattleGameConfig {
        run_state,
        start: BattleStartV1 {
            schema_version: BATTLE_START_SCHEMA_VERSION,
            format: BattleFormat::coop_double(),
            player_party: vec![
                battle_pokemon(content, 1, Some(seat(1)), 100)?,
                battle_pokemon(content, 2, Some(seat(2)), 100)?,
            ],
            enemy_party: vec![
                battle_pokemon(content, 3, None, 1)?,
                battle_pokemon(content, 4, None, 1)?,
            ],
            player_leads: vec![PartyIndex::ZERO, PartyIndex::try_from(1_u64)?],
            enemy_leads: vec![PartyIndex::ZERO, PartyIndex::try_from(1_u64)?],
        },
        local_seat: seat(1),
        wave_seed: "m3-battle-tail-proof-seed/wave".to_owned(),
        scripted_enemy_policy: ScriptedEnemyPolicyV1::new(SafeU53::ZERO, scripted)?,
    })
}

fn battle_authority_protocol() -> TestResult<BattleProtocolConfig> {
    Ok(BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Authority {
            log: AuthorityLogConfig {
                local_context: battle_context(1)?,
                peer_bindings: vec![PeerBinding {
                    seat_id: seat(2),
                    connection_generation: generation(1),
                }],
                owner_id: "m3-battle-tail-proof-authority".to_owned(),
                retain_capacity: safe(32),
                delivery_backoff: BackoffPolicy {
                    initial_ms: safe(250),
                    maximum_ms: safe(5_000),
                    factor_numerator: safe(2),
                    factor_denominator: safe(1),
                },
                delivery_time_class: TimeClass::Connected,
                max_delivery_attempts: Some(safe(8)),
            },
            proposal_capacity: safe(32),
        },
    })
}

fn battle_replica_protocol() -> TestResult<BattleProtocolConfig> {
    let local_context = battle_context(2)?;
    Ok(BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Replica {
            replica: AuthorityReplicaConfig {
                receipt_context: local_context.clone(),
                authority_seat_id: seat(1),
                authority_connection_generation: generation(1),
            },
            proposal_leases: ProposalLeaseConfig {
                owner_prefix: "m3-battle-tail-proof-proposal".to_owned(),
                retry_initial_ms: safe(250),
                retry_maximum_ms: safe(5_000),
                absolute_ceiling_ms: safe(1_200_000),
            },
            recovery: RecoveryTransactionConfig {
                local_context,
                request_timeout_ms: safe(5_000),
                control_timeout_ms: safe(5_000),
                pacing_ms: safe(16),
                timer_owner_id: "m3-battle-tail-proof-recovery".to_owned(),
            },
        },
    })
}

fn raw_press(
    kernel: &mut GameKernel,
    endpoint: SeatId,
    code: PhysicalKey,
) -> TestResult<Vec<KernelEffect>> {
    let mut effects = kernel.step(KernelInput::RawInput {
        seat: endpoint,
        event: RawInputEvent::KeyDown {
            code: code.clone(),
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
    })?;
    effects.extend(kernel.step(KernelInput::RawInput {
        seat: endpoint,
        event: RawInputEvent::KeyUp { code },
    })?);
    Ok(effects)
}

fn route_frame(
    kernel: &mut GameKernel,
    endpoint: SeatId,
    frame: &NetworkFrame,
) -> TestResult<Vec<KernelEffect>> {
    Ok(kernel.step(KernelInput::NetworkFrame {
        endpoint,
        frame: frame.clone(),
    })?)
}

fn sent_frames(effects: &[KernelEffect], frame_type: FrameType) -> Vec<NetworkFrame> {
    effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::SendFrame { frame, .. } if frame.frame_type == frame_type => {
                Some(frame.clone())
            }
            _ => None,
        })
        .collect()
}

fn settle_battle_presentations(
    kernel: &mut GameKernel,
    endpoint: SeatId,
) -> TestResult<Vec<KernelEffect>> {
    let mut effects = Vec::new();
    for _ in 0..64 {
        let pending = kernel
            .snapshot_v2()?
            .pending_presentations
            .pending_barrier_ids;
        if pending.is_empty() {
            return Ok(effects);
        }
        for event_id in pending {
            effects.extend(kernel.step(KernelInput::BattlePresentationOutcome {
                endpoint,
                event_id,
                outcome: PresentationSettlementOutcome::Settled,
            })?);
        }
    }
    Err("battle presentation settlement exceeded its deterministic bound".into())
}

fn battle_mechanics(kernel: &GameKernel) -> TestResult<(Value, Value)> {
    let state = kernel.snapshot().state;
    let game = state
        .get("game")
        .cloned()
        .ok_or("Battle snapshot has no game state")?;
    let control = state
        .get("control")
        .cloned()
        .ok_or("Battle snapshot has no control plan")?;
    Ok((game, control))
}

fn entry_from_frame(frame: &NetworkFrame) -> TestResult<AuthorityEntry> {
    let body: AuthorityEntryBody = serde_json::from_value(frame.body.clone())?;
    Ok(body.with_context(frame.context.clone()))
}

fn entry_identity_snapshot(entry: &AuthorityEntry) -> AuthorityEntryIdentitySnapshotV2 {
    AuthorityEntryIdentitySnapshotV2 {
        revision: entry.revision,
        context: entry.context.clone(),
        operation_id: entry.operation_id.clone(),
        kind: entry.kind,
        material_digest: entry.material.digest.clone(),
        next_control_id: control_id_of(&entry.next_control),
        subsumes: entry.subsumes.clone(),
    }
}

fn opaque_entry_snapshot(entry: &AuthorityEntry) -> TestResult<OpaqueAuthorityEntrySnapshotV2> {
    Ok(OpaqueAuthorityEntrySnapshotV2 {
        identity: entry_identity_snapshot(entry),
        canonical_entry_bytes: CanonicalHexBytes::from_bytes(&canonical_bytes(entry)?),
    })
}

fn restore_battle_with_parked_candidate(
    mut snapshot: RestorableKernelSnapshotV2,
    source: &AuthorityEntry,
    candidate: &AuthorityEntry,
    content: Arc<ContentPack>,
) -> TestResult<GameKernel> {
    let request_context = battle_context(2)?;
    let request_sequence = safe(1);
    let request_id = OperationId::new(format!(
        "authority-v2:{}:seat{}:boundary-proof:{}",
        request_context.session_id, request_context.sender_seat_id, request_sequence
    ))?;
    let authority_replica = snapshot
        .protocol
        .authority_replica
        .as_mut()
        .ok_or("Battle replica snapshot omitted its AuthorityReplica owner")?;
    authority_replica.tail_proof = TailProofReplicaSnapshotV2 {
        request_sequence,
        capture: Some(TailProofReplicaCaptureSnapshotV2 {
            candidate: opaque_entry_snapshot(candidate)?,
            predecessor_identity: entry_identity_snapshot(source),
            from_revision: source.revision,
            request_id,
            request_context,
            authority_context: candidate.context.clone(),
            manifest: None,
            sources: Vec::new(),
        }),
        admission_candidate: None,
    };
    snapshot.kernel_determinism_digest = KernelDeterminismDigest::compute(&snapshot)?;
    Ok(GameKernel::from_snapshot(snapshot, content)?)
}

#[test]
fn generic_kernel_routes_correlated_tail_request_and_tail_proof_completion() -> TestResult {
    let mut kernel = replica_kernel()?;
    let source = source()?;
    let candidate = candidate()?;

    let admitted = kernel.step(authority_entry_input(&source)?)?;
    assert!(admitted.iter().any(|effect| matches!(
        effect,
        KernelEffect::ApplyAuthorityMaterial { revision: actual, .. }
            if *actual == source.revision
    )));
    kernel.step(KernelInput::MaterialApplied {
        endpoint: seat(1),
        revision: source.revision,
        outcome: MaterialApplicationOutcome::Applied,
    })?;
    kernel.step(KernelInput::ControlProjected {
        endpoint: seat(1),
        revision: source.revision,
        outcome: ControlProjectionOutcome::Installed {
            control_id: control_id_of(&source.next_control),
        },
    })?;

    let parked = kernel.step(authority_entry_input(&candidate)?)?;
    let request_frame = parked
        .iter()
        .find_map(|effect| match effect {
            KernelEffect::SendFrame { frame, .. } if frame.frame_type == FrameType::TailRequest => {
                Some(frame)
            }
            _ => None,
        })
        .ok_or("generic kernel did not emit correlated tailRequest")?;
    let request: TailRequestBody = serde_json::from_value(request_frame.body.clone())?;
    assert!(request.request_id.is_some());
    assert_eq!(request.candidate_revision, Some(candidate.revision));

    let proof_base = TailProofBody {
        phase: TailProofPhase::Manifest,
        request_id: request.request_id.ok_or("correlated request id")?,
        from_revision: request.from_revision,
        candidate_revision: candidate.revision,
        candidate_operation_id: candidate.operation_id.clone(),
        head_revision: candidate.revision,
        source_revisions: vec![source.revision],
    };
    assert!(
        kernel
            .step(proof_input(&candidate.context, proof_base.clone())?)?
            .is_empty()
    );
    assert!(kernel.step(authority_entry_input(&source)?)?.is_empty());
    let mut complete = proof_base;
    complete.phase = TailProofPhase::Complete;
    let completed = kernel.step(proof_input(&candidate.context, complete)?)?;
    assert!(completed.iter().any(|effect| matches!(
        effect,
        KernelEffect::ApplyAuthorityMaterial {
            revision: actual,
            operation_id,
            ..
        } if *actual == candidate.revision && operation_id == &candidate.operation_id
    )));
    Ok(())
}

#[test]
fn battle_kernel_routes_correlated_proof_through_real_material_and_fails_closed() -> TestResult {
    let content = Arc::new(selected_content_pack()?);
    let authority_game = battle_game_config(content.as_ref())?;
    let mut replica_game = authority_game.clone();
    replica_game.local_seat = seat(2);
    let mut authority = GameKernel::new_battle(
        authority_game,
        battle_authority_protocol()?,
        Arc::clone(&content),
    )?;
    let mut replica = GameKernel::new_battle(
        replica_game.clone(),
        battle_replica_protocol()?,
        Arc::clone(&content),
    )?;

    for _ in 0..3 {
        raw_press(&mut authority, seat(1), PhysicalKey::Enter)?;
    }
    let mut guest_command_effects = Vec::new();
    for _ in 0..2 {
        guest_command_effects.extend(raw_press(&mut replica, seat(2), PhysicalKey::Enter)?);
    }
    guest_command_effects.extend(raw_press(&mut replica, seat(2), PhysicalKey::ArrowRight)?);
    guest_command_effects.extend(raw_press(&mut replica, seat(2), PhysicalKey::Enter)?);
    let proposals = guest_command_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::SendProposal { proposal } => Some(proposal.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    let [guest_proposal] = proposals.as_slice() else {
        return Err(format!(
            "guest target selection emitted {} proposals instead of one",
            proposals.len()
        )
        .into());
    };

    let published = authority.step(KernelInput::ProposalReceived {
        endpoint: seat(1),
        proposal: guest_proposal.clone(),
    })?;
    let mut source_frame = None;
    for frame in sent_frames(&published, FrameType::AuthorityEntry) {
        if entry_from_frame(&frame)?.kind == AuthorityEntryKind::TurnCommit {
            source_frame = Some(frame);
            break;
        }
    }
    let source_frame = source_frame.ok_or("Battle authority did not publish its TURN entry")?;
    let source = entry_from_frame(&source_frame)?;
    assert!(matches!(
        source.next_control,
        NextControl::AwaitSuccessor(_)
    ));

    let before_source = battle_mechanics(&replica)?;
    let mut replica_receipt_effects = route_frame(&mut replica, seat(2), &source_frame)?;
    let after_source = battle_mechanics(&replica)?;
    assert_ne!(before_source, after_source, "TURN material was not applied");
    assert_eq!(
        after_source.0,
        source
            .material
            .payload
            .get("after_state")
            .cloned()
            .ok_or("TURN material omitted after_state")?
    );
    assert_eq!(
        after_source.1,
        source
            .material
            .payload
            .get("next_control")
            .cloned()
            .ok_or("TURN material omitted next_control")?
    );
    assert!(
        !replica_receipt_effects
            .iter()
            .any(|effect| matches!(effect, KernelEffect::EnterSharedTerminal { .. }))
    );

    settle_battle_presentations(&mut authority, seat(1))?;
    replica_receipt_effects.extend(settle_battle_presentations(&mut replica, seat(2))?);
    let receipts = sent_frames(&replica_receipt_effects, FrameType::AuthorityReceipt);
    assert!(
        receipts.len() >= 4,
        "Battle replica did not publish every TURN receipt stage"
    );
    let mut authority_receipt_effects = Vec::new();
    for receipt in receipts {
        authority_receipt_effects.extend(route_frame(&mut authority, seat(1), &receipt)?);
    }

    let mut candidate_frame = None;
    for frame in sent_frames(&authority_receipt_effects, FrameType::AuthorityEntry) {
        if entry_from_frame(&frame)?.kind == AuthorityEntryKind::TerminalCommit {
            candidate_frame = Some(frame);
            break;
        }
    }
    let candidate_frame =
        candidate_frame.ok_or("Battle authority did not publish its terminal boundary")?;
    let candidate = entry_from_frame(&candidate_frame)?;
    assert_eq!(candidate.revision, revision(2));
    assert_eq!(candidate.subsumes, vec![source.revision]);

    let parked_snapshot = replica.snapshot_v2()?;
    let mut replica = restore_battle_with_parked_candidate(
        parked_snapshot.clone(),
        &source,
        &candidate,
        Arc::clone(&content),
    )?;
    let parked = route_frame(&mut replica, seat(2), &candidate_frame)?;
    assert!(
        !parked
            .iter()
            .any(|effect| matches!(effect, KernelEffect::EnterSharedTerminal { .. }))
    );
    let requests = sent_frames(&parked, FrameType::TailRequest);
    let [request_frame] = requests.as_slice() else {
        return Err(format!(
            "Battle boundary emitted {} correlated tail requests instead of one",
            requests.len()
        )
        .into());
    };
    let request: TailRequestBody = serde_json::from_value(request_frame.body.clone())?;
    assert!(request.request_id.is_some());
    assert_eq!(request.from_revision, source.revision);
    assert_eq!(request.candidate_revision, Some(candidate.revision));
    assert_eq!(
        request.candidate_operation_id.as_ref(),
        Some(&candidate.operation_id)
    );

    let response = route_frame(&mut authority, seat(1), request_frame)?;
    let response_frames = response
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::SendFrame { frame, .. } => Some(frame.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        response_frames
            .iter()
            .map(|frame| frame.frame_type)
            .collect::<Vec<_>>(),
        vec![
            FrameType::TailProof,
            FrameType::AuthorityEntry,
            FrameType::TailProof,
        ]
    );
    let manifest: TailProofBody = serde_json::from_value(response_frames[0].body.clone())?;
    let proof_source = entry_from_frame(&response_frames[1])?;
    let complete: TailProofBody = serde_json::from_value(response_frames[2].body.clone())?;
    assert_eq!(manifest.phase, TailProofPhase::Manifest);
    assert_eq!(manifest.source_revisions, vec![source.revision]);
    assert_eq!(proof_source, source);
    assert_eq!(complete.phase, TailProofPhase::Complete);

    assert!(route_frame(&mut replica, seat(2), &response_frames[0])?.is_empty());
    assert!(route_frame(&mut replica, seat(2), &response_frames[1])?.is_empty());
    assert_eq!(battle_mechanics(&replica)?, after_source);
    let completed = route_frame(&mut replica, seat(2), &response_frames[2])?;
    let terminal = completed.iter().find_map(|effect| match effect {
        KernelEffect::EnterSharedTerminal { terminal } => Some(terminal),
        _ => None,
    });
    let terminal = terminal.ok_or("valid Battle tail proof did not apply its terminal material")?;
    assert_eq!(terminal.terminal_id, candidate.operation_id.to_string());
    assert_eq!(terminal.reason, "game-over");

    let mut malformed_replica = restore_battle_with_parked_candidate(
        parked_snapshot,
        &source,
        &candidate,
        Arc::clone(&content),
    )?;
    let malformed_parked = route_frame(&mut malformed_replica, seat(2), &candidate_frame)?;
    assert_eq!(
        sent_frames(&malformed_parked, FrameType::TailRequest).len(),
        1
    );
    route_frame(&mut malformed_replica, seat(2), &response_frames[0])?;
    route_frame(&mut malformed_replica, seat(2), &response_frames[1])?;

    let mut malformed_complete = response_frames[2].clone();
    let mut malformed_body: TailProofBody =
        serde_json::from_value(malformed_complete.body.clone())?;
    malformed_body.source_revisions.clear();
    malformed_complete.body = serde_json::to_value(malformed_body)?;
    let failed = route_frame(&mut malformed_replica, seat(2), &malformed_complete)?;
    let failed_reason = failed.iter().find_map(|effect| match effect {
        KernelEffect::EnterSharedTerminal { terminal } => Some(terminal.reason.as_str()),
        _ => None,
    });
    assert!(
        failed_reason.is_some_and(|reason| reason.contains("tail proof rejected")),
        "malformed Battle completion did not fail closed: {failed:?}"
    );
    assert!(
        route_frame(&mut malformed_replica, seat(2), &response_frames[2])?.is_empty(),
        "terminalized Battle replica accepted productive follow-up work"
    );
    Ok(())
}
