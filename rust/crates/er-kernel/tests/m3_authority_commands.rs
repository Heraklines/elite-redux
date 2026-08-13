use std::error::Error;

use er_battle::faint::{FaintCandidate, queue_faint};
use er_battle::legality::{
    build_command_offer, build_scripted_enemy_offer, validate_state_content,
};
use er_content::pack::{ContentPack, selected_content_pack};
use er_content::species::find_species;
use er_game::authority_commands::{
    AuthorityCommandError, CommandAdmissionResult, CommandFrontierCompletion, HumanAdmissionSource,
    ReplacementAdmissionResult, admit_command_proposal, admit_replacement_proposal,
    admit_scripted_enemy_frontier, complete_command_frontier, internal_no_legal_replacement,
    retain_command_tombstones,
};
use er_game::target_menu::build_target_control;
use er_rng::battle::BattleRngState;
use er_rng::phaser::{PhaserRdg, RunRngState};
use er_state::battle::{BattleOutcome, BattleState, CommandCollectionState};
use er_state::conditions::{
    GlobalAbilitySuppressionState, TerrainKind, TerrainState, WeatherKind, WeatherState,
};
use er_state::field::{FieldSlotState, FieldState};
use er_state::format::BattleFormat;
use er_state::pokemon::{
    AbilityLoadout, BattleStats, MoveSlotState, PokemonState, StatStages, StatusState,
};
use er_state::snapshot::GameState;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleCommandProposalV1, BattleReplacementProposalV1,
    BattleTargetSelection, CommandAdmissionSource, CommandFrontierEntry, CommandFrontierStatus,
    ReplacementProposalFingerprintEntry, ReplacementSelection, ScriptedEnemyBattleCommandV1,
    ScriptedEnemyPolicyV1, player_command_operation_id, replacement_operation_id,
    scripted_enemy_command_operation_id,
};
use er_types::battle_control::{
    BATTLE_CONTROL_PLAN_SCHEMA_VERSION, BattleControl, BattleControlPlan, BattleMenu,
    BattleMenuOption, CommandRootControl, MenuOptionLayout, MenuOptionVisibility,
    MoveSelectControl, ReplacementSelectControl, SeatBattleControl, SeatMenuInstanceAllocator,
};
use er_types::battle_ids::{
    AuthorityEpoch, BattleId, BattleSide, FaintOccurrenceId, FieldSlot, GameModeId, MenuInstanceId,
    MoveSlotIndex, PartyIndex, PokemonId, SpeciesId, TurnIndex, WaveIndex,
};
use er_types::battle_model::{FaintOccurrence, StatusKind};
use er_types::{MenuOptionId, OperationId, SafeU53, SeatId};
use serde_json::json;

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn safe(value: u64) -> TestResult<SafeU53> {
    Ok(SafeU53::new(value)?)
}

fn seat(value: u64) -> TestResult<SeatId> {
    Ok(SeatId::new(safe(value)?))
}

fn slot(side: BattleSide, position: u8) -> FieldSlot {
    FieldSlot { side, position }
}

fn pokemon(
    content: &ContentPack,
    id: u64,
    owner_seat: Option<SeatId>,
    moves: &[u64],
    hp: u32,
    speed: u32,
) -> TestResult<PokemonState> {
    let species = find_species(&content.species, SpeciesId::new(safe(19)?))?;
    let mut move_slots = [None, None, None, None];
    for (index, move_id) in moves.iter().copied().enumerate() {
        let destination = move_slots
            .get_mut(index)
            .ok_or("fixture exceeded four move slots")?;
        *destination = Some(MoveSlotState {
            move_id: er_types::battle_ids::MoveId::new(safe(move_id)?),
            pp_used: 0,
            pp_ups: 0,
            max_pp_override: None,
        });
    }

    Ok(PokemonState::new(
        PokemonId::new(safe(id)?),
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
            speed,
        },
        hp,
        100,
        StatusState {
            kind: StatusKind::None,
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
        move_slots,
        AbilityLoadout {
            active: er_types::battle_ids::AbilityId::ZERO,
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        hp == 0,
    )?)
}

fn state_for(
    content: &ContentPack,
    format: BattleFormat,
    player_party: Vec<PokemonState>,
    enemy_party: Vec<PokemonState>,
) -> TestResult<GameState> {
    let mut field_slots = Vec::new();
    for position in 0..format.player_capacity {
        let actor = player_party
            .get(usize::from(position))
            .ok_or("fixture has fewer player leads than its format")?
            .id;
        field_slots.push(FieldSlotState::new(
            slot(BattleSide::Player, position),
            Some(actor),
        ));
    }
    for position in 0..format.enemy_capacity {
        let actor = enemy_party
            .get(usize::from(position))
            .ok_or("fixture has fewer enemy leads than its format")?
            .id;
        field_slots.push(FieldSlotState::new(
            slot(BattleSide::Enemy, position),
            Some(actor),
        ));
    }

    let battle_id = BattleId::new(safe(1)?);
    let wave = WaveIndex::new(safe(1)?)?;
    let turn = TurnIndex::new(safe(1)?)?;
    let field = FieldState::new_for_format(&format, field_slots)?;
    let battle = BattleState {
        battle_id,
        wave,
        wave_seed: "m3-authority-command-wave".to_owned(),
        turn,
        format,
        authority_seat: seat(1)?,
        player_party,
        enemy_party,
        field,
        weather: WeatherState {
            kind: WeatherKind::None,
            remaining_turns: 0,
        },
        terrain: TerrainState {
            kind: TerrainKind::None,
            remaining_turns: 0,
        },
        arena_conditions: Vec::new(),
        global_ability_suppression: GlobalAbilitySuppressionState {
            ignore_abilities: false,
            source: None,
        },
        battle_rng: BattleRngState::new("m3-authority-command-battle", turn),
        command_state: CommandCollectionState::new(Vec::new(), Vec::new())?,
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::ZERO,
        outcome: BattleOutcome::Ongoing,
    };

    Ok(GameState::new(
        content.hash.clone(),
        GameModeId::new(safe(1)?),
        wave,
        BattleId::new(safe(2)?),
        RunRngState {
            rdg: PhaserRdg::from_seed("m3-authority-command-run").state(),
        },
        Some(battle),
    )?)
}

fn command_state(content: &ContentPack, format: BattleFormat) -> TestResult<GameState> {
    let player_party = (0..format.player_capacity)
        .map(|position| {
            pokemon(
                content,
                1 + u64::from(position),
                Some(seat(1 + u64::from(position))?),
                &[351, 589],
                100,
                100 + u32::from(position),
            )
        })
        .collect::<TestResult<Vec<_>>>()?;
    let enemy_party = (0..format.enemy_capacity)
        .map(|position| {
            pokemon(
                content,
                10 + u64::from(position),
                None,
                &[351, 589],
                100,
                90 + u32::from(position),
            )
        })
        .collect::<TestResult<Vec<_>>>()?;
    state_for(content, format, player_party, enemy_party)
}

fn menu_option(id: &str, row: u16) -> TestResult<BattleMenuOption> {
    let option_id = MenuOptionId::new(id.to_owned())?;
    Ok(BattleMenuOption::new(
        option_id.clone(),
        format!("m3.{id}"),
        MenuOptionVisibility::Visible,
        true,
        MenuOptionLayout::new(option_id, row, 0, 0),
    )?)
}

fn menu(
    instance: u64,
    owner: SeatId,
    control_id: String,
    selected: &str,
    options: Vec<BattleMenuOption>,
) -> TestResult<BattleMenu> {
    Ok(BattleMenu::new(
        MenuInstanceId::new(safe(instance)?),
        owner,
        control_id,
        MenuOptionId::new(selected.to_owned())?,
        options,
        Vec::new(),
    )?)
}

fn command_control_plan(state: &GameState) -> TestResult<BattleControlPlan> {
    let battle = state.battle.as_ref().ok_or("fixture has no battle")?;
    let mut seats = Vec::new();
    let mut allocators = Vec::new();
    for position in 0..battle.format.player_capacity {
        let owner = seat(1 + u64::from(position))?;
        let actor = battle
            .player_party
            .get(usize::from(position))
            .ok_or("missing player control actor")?
            .id;
        let operation_id = player_command_operation_id(
            battle.battle_id,
            battle.wave,
            battle.turn,
            slot(BattleSide::Player, position),
            owner,
        )?;
        let command_control_id = format!(
            "battle/{}/wave/{}/turn/{}/control/player/{}/seat/{}/command",
            battle.battle_id, battle.wave, battle.turn, position, owner,
        );
        let move_control_id = format!(
            "battle/{}/wave/{}/turn/{}/control/player/{}/seat/{}/move",
            battle.battle_id, battle.wave, battle.turn, position, owner,
        );
        let menu_span = if battle.format == BattleFormat::single() {
            3
        } else {
            4
        };
        let root_instance = 1 + u64::from(position) * menu_span;
        let root = BattleControl::CommandRoot(CommandRootControl::new(
            actor,
            slot(BattleSide::Player, position),
            menu(
                root_instance,
                owner,
                command_control_id,
                "command/fight",
                vec![menu_option("command/fight", 0)?],
            )?,
        )?);
        let move_control = BattleControl::MoveSelect(MoveSelectControl::new(
            actor,
            slot(BattleSide::Player, position),
            menu(
                root_instance + 1,
                owner,
                move_control_id,
                &format!("move/{actor}/slot/0"),
                vec![
                    menu_option(&format!("move/{actor}/slot/0"), 0)?,
                    menu_option(&format!("move/{actor}/slot/1"), 1)?,
                ],
            )?,
            Box::new(root),
        )?);
        let control = if battle.format == BattleFormat::single() {
            move_control
        } else {
            let target_control_id = format!(
                "battle/{}/wave/{}/turn/{}/control/player/{}/seat/{}/target",
                battle.battle_id, battle.wave, battle.turn, position, owner,
            );
            let candidate_targets = (0..battle.format.enemy_capacity)
                .map(|enemy_position| slot(BattleSide::Enemy, enemy_position))
                .collect::<Vec<_>>();
            BattleControl::TargetSelect(build_target_control(
                MenuInstanceId::new(safe(root_instance + 2)?),
                owner,
                target_control_id,
                actor,
                slot(BattleSide::Player, position),
                MoveSlotIndex::ZERO,
                false,
                &candidate_targets,
                Some(slot(BattleSide::Enemy, 0)),
                None,
                move_control,
            )?)
        };
        seats.push(SeatBattleControl::new(
            owner,
            Some(operation_id),
            control,
        ));
        allocators.push(SeatMenuInstanceAllocator::new(
            owner,
            MenuInstanceId::new(safe(
                root_instance
                    + if battle.format == BattleFormat::single() {
                        2
                    } else {
                        3
                    },
            )?),
        )?);
    }
    Ok(BattleControlPlan::new(
        BATTLE_CONTROL_PLAN_SCHEMA_VERSION,
        battle.battle_id,
        battle.wave,
        battle.turn,
        seats,
        allocators,
    )?)
}

struct CommandFixture {
    state: GameState,
    control: BattleControlPlan,
    human_proposals: Vec<BattleCommandProposalV1>,
    enemy_policy: ScriptedEnemyPolicyV1,
}

fn command_fixture(content: &ContentPack, format: BattleFormat) -> TestResult<CommandFixture> {
    let mut state = command_state(content, format)?;
    let control = command_control_plan(&state)?;
    let battle = state.battle.as_ref().ok_or("fixture has no battle")?;
    let mut frontier = Vec::new();
    let mut human_proposals = Vec::new();
    for position in 0..battle.format.player_capacity {
        let field_slot = slot(BattleSide::Player, position);
        let actor = battle
            .player_party
            .get(usize::from(position))
            .ok_or("missing player actor")?
            .id;
        let owner = seat(1 + u64::from(position))?;
        let (proposal_menu_instance, proposal_control_kind) =
            if battle.format == BattleFormat::single() {
                (2 + u64::from(position) * 3, "move")
            } else {
                (3 + u64::from(position) * 4, "target")
            };
        let operation_id = player_command_operation_id(
            battle.battle_id,
            battle.wave,
            battle.turn,
            field_slot,
            owner,
        )?;
        let proposal = BattleCommandProposalV1::new(
            operation_id.clone(),
            battle.battle_id,
            battle.wave,
            battle.turn,
            owner,
            actor,
            field_slot,
            BattleCommand::fight(
                actor,
                MoveSlotIndex::ZERO,
                if battle.format == BattleFormat::single() {
                    BattleTargetSelection::implicit()
                } else {
                    BattleTargetSelection::selected(vec![slot(BattleSide::Enemy, 0)])?
                },
            )?,
            MenuInstanceId::new(safe(proposal_menu_instance)?),
            format!(
                "battle/{}/wave/{}/turn/{}/control/player/{}/seat/{}/{}",
                battle.battle_id,
                battle.wave,
                battle.turn,
                position,
                owner,
                proposal_control_kind,
            ),
        )?;
        let offer = build_command_offer(&state, field_slot, content)?;
        frontier.push(CommandFrontierEntry::new(
            operation_id,
            Some(owner),
            actor,
            field_slot,
            offer,
            CommandFrontierStatus::Pending,
        )?);
        human_proposals.push(proposal);
    }

    let mut scripted_commands = Vec::new();
    for position in 0..battle.format.enemy_capacity {
        let field_slot = slot(BattleSide::Enemy, position);
        let actor = battle
            .enemy_party
            .get(usize::from(position))
            .ok_or("missing enemy actor")?
            .id;
        let cursor = safe(u64::from(position))?;
        let operation_id = scripted_enemy_command_operation_id(
            battle.battle_id,
            battle.wave,
            battle.turn,
            field_slot,
            cursor,
        )?;
        let command = ScriptedEnemyBattleCommandV1::new(
            operation_id.clone(),
            battle.battle_id,
            battle.wave,
            battle.turn,
            cursor,
            actor,
            field_slot,
            BattleCommand::fight(
                actor,
                MoveSlotIndex::ZERO,
                if battle.format == BattleFormat::single() {
                    BattleTargetSelection::implicit()
                } else {
                    BattleTargetSelection::selected(vec![slot(BattleSide::Player, 0)])?
                },
            )?,
        )?;
        let offer = build_scripted_enemy_offer(&state, field_slot, &command.command, content)?;
        frontier.push(CommandFrontierEntry::new(
            operation_id,
            None,
            actor,
            field_slot,
            offer,
            CommandFrontierStatus::Pending,
        )?);
        scripted_commands.push(command);
    }
    frontier.sort_by_key(|entry| entry.field_slot);
    state
        .battle
        .as_mut()
        .ok_or("fixture has no battle")?
        .command_state = CommandCollectionState::new(frontier, Vec::new())?;
    validate_state_content(&state, content)?;
    Ok(CommandFixture {
        state,
        control,
        human_proposals,
        enemy_policy: ScriptedEnemyPolicyV1::new(SafeU53::ZERO, scripted_commands)?,
    })
}

fn pending_replacement_fixture(
    content: &ContentPack,
    with_reserve: bool,
) -> TestResult<(GameState, FaintOccurrence)> {
    let mut player_party = vec![pokemon(content, 1, Some(seat(1)?), &[351], 100, 100)?];
    if with_reserve {
        player_party.push(pokemon(content, 2, Some(seat(1)?), &[351], 100, 90)?);
    }
    let mut state = state_for(
        content,
        BattleFormat::single(),
        player_party,
        vec![pokemon(content, 10, None, &[351], 100, 80)?],
    )?;
    let occurrence = {
        let battle = state.battle.as_mut().ok_or("fixture has no battle")?;
        let active = battle
            .player_party
            .first_mut()
            .ok_or("fixture has no active player")?;
        active.hp = 0;
        active.fainted = true;
        let active_id = active.id;
        queue_faint(
            battle,
            FaintCandidate::new(active_id, slot(BattleSide::Player, 0)),
            AuthorityEpoch::new(safe(7)?),
            4,
        )?
        .occurrence
    };
    validate_state_content(&state, content)?;
    Ok((state, occurrence))
}

fn replacement_control_plan(
    state: &GameState,
    occurrence: FaintOccurrence,
    pokemon: PokemonId,
    party_slot: PartyIndex,
) -> TestResult<BattleControlPlan> {
    let battle = state.battle.as_ref().ok_or("fixture has no battle")?;
    let owner = occurrence.owner_seat.ok_or("occurrence has no owner")?;
    let operation_id = replacement_operation_id(
        occurrence.source.epoch,
        battle.battle_id,
        occurrence.source.wave,
        occurrence.source.resolved_turn,
        occurrence.source.turn_occurrence,
        occurrence.slot,
        owner,
    )?;
    let option_id = format!("party/{pokemon}/slot/{}", party_slot.get());
    let menu = menu(
        2,
        owner,
        format!("{operation_id}/control/replacement"),
        &option_id,
        vec![menu_option(&option_id, 0)?],
    )?;
    let control = BattleControl::ReplacementSelect(ReplacementSelectControl::new(
        occurrence.id,
        occurrence.source,
        occurrence.pokemon,
        occurrence.slot,
        owner,
        menu,
        MenuOptionId::new(option_id.clone())?,
        MenuOptionId::new(option_id)?,
    )?);
    Ok(BattleControlPlan::new(
        BATTLE_CONTROL_PLAN_SCHEMA_VERSION,
        battle.battle_id,
        battle.wave,
        battle.turn,
        vec![SeatBattleControl::new(owner, Some(operation_id), control)],
        vec![SeatMenuInstanceAllocator::new(
            owner,
            MenuInstanceId::new(safe(3)?),
        )?],
    )?)
}

fn replacement_proposal(
    state: &GameState,
    occurrence: FaintOccurrence,
    pokemon: PokemonId,
    party_slot: PartyIndex,
) -> TestResult<BattleReplacementProposalV1> {
    let battle = state.battle.as_ref().ok_or("fixture has no battle")?;
    let owner = occurrence.owner_seat.ok_or("occurrence has no owner")?;
    let operation_id = replacement_operation_id(
        occurrence.source.epoch,
        battle.battle_id,
        occurrence.source.wave,
        occurrence.source.resolved_turn,
        occurrence.source.turn_occurrence,
        occurrence.slot,
        owner,
    )?;
    Ok(BattleReplacementProposalV1::new(
        operation_id,
        battle.battle_id,
        occurrence.source.wave,
        occurrence.source.resolved_turn,
        owner,
        occurrence.id,
        occurrence.source.turn_occurrence,
        occurrence.slot,
        ReplacementSelection::selected(party_slot, pokemon),
        MenuInstanceId::new(safe(2)?),
        format!(
            "{}/control/replacement",
            replacement_operation_id(
                occurrence.source.epoch,
                battle.battle_id,
                occurrence.source.wave,
                occurrence.source.resolved_turn,
                occurrence.source.turn_occurrence,
                occurrence.slot,
                owner,
            )?
        ),
    )?)
}

#[test]
fn exact_frontier_completion_waits_for_scripted_enemy_and_preserves_source() -> TestResult {
    let content = selected_content_pack()?;
    let fixture = command_fixture(&content, BattleFormat::single())?;
    let before = fixture.state.clone();
    let first = admit_command_proposal(
        &fixture.state,
        &fixture.control,
        fixture
            .human_proposals
            .first()
            .ok_or("missing human proposal")?,
        &content,
    )?;
    let (staged_state, source) = match first {
        CommandAdmissionResult::Admitted { state, source, .. } => (state, source),
        CommandAdmissionResult::Duplicate { .. } => return Err("unexpected duplicate".into()),
    };
    assert_eq!(source, HumanAdmissionSource::AuthorityLocalInternal);
    assert_ne!(staged_state, before);
    let incomplete = complete_command_frontier(&staged_state, &content)?;
    assert!(matches!(
        incomplete,
        CommandFrontierCompletion::Incomplete { .. }
    ));
    let enemy = admit_scripted_enemy_frontier(incomplete.state(), &fixture.enemy_policy, &content)?;
    assert_eq!(enemy.admitted.len(), 1);
    let complete = complete_command_frontier(&enemy.state, &content)?;
    let commands =
        match complete {
            CommandFrontierCompletion::Complete { commands, state } => {
                let battle = state.battle.as_ref().ok_or("missing completed battle")?;
                assert!(battle.command_state.frontier.iter().all(|entry| {
                    matches!(&entry.status, CommandFrontierStatus::Admitted { .. })
                }));
                commands
            }
            CommandFrontierCompletion::Incomplete { .. } => {
                return Err("frontier did not complete after enemy collection".into());
            }
        };
    assert_eq!(commands.entries.len(), 2);
    assert_eq!(
        commands.entries[0].field_slot(),
        slot(BattleSide::Player, 0)
    );
    assert_eq!(commands.entries[1].field_slot(), slot(BattleSide::Enemy, 0));
    Ok(())
}

#[test]
fn asymmetric_two_seat_arrival_is_canonical_and_marks_remote_source() -> TestResult {
    let content = selected_content_pack()?;
    let fixture = command_fixture(&content, BattleFormat::coop_double())?;
    let second = fixture
        .human_proposals
        .get(1)
        .ok_or("missing seat two proposal")?;
    let first = fixture
        .human_proposals
        .first()
        .ok_or("missing seat one proposal")?;
    let seat_two_state =
        match admit_command_proposal(&fixture.state, &fixture.control, second, &content)? {
            CommandAdmissionResult::Admitted { state, source, .. } => {
                assert_eq!(source, HumanAdmissionSource::AuthorityRemoteProposal);
                state
            }
            CommandAdmissionResult::Duplicate { .. } => return Err("unexpected duplicate".into()),
        };
    let both_players_state =
        match admit_command_proposal(&seat_two_state, &fixture.control, first, &content)? {
            CommandAdmissionResult::Admitted { state, source, .. } => {
                assert_eq!(source, HumanAdmissionSource::AuthorityLocalInternal);
                state
            }
            CommandAdmissionResult::Duplicate { .. } => return Err("unexpected duplicate".into()),
        };
    let enemy =
        admit_scripted_enemy_frontier(&both_players_state, &fixture.enemy_policy, &content)?;
    let complete = complete_command_frontier(&enemy.state, &content)?;
    let commands = match complete {
        CommandFrontierCompletion::Complete { commands, .. } => commands,
        CommandFrontierCompletion::Incomplete { .. } => {
            return Err("asymmetric frontier did not complete".into());
        }
    };
    assert_eq!(
        commands
            .entries
            .iter()
            .map(AcceptedBattleCommand::field_slot)
            .collect::<Vec<_>>(),
        vec![
            slot(BattleSide::Player, 0),
            slot(BattleSide::Player, 1),
            slot(BattleSide::Enemy, 0),
            slot(BattleSide::Enemy, 1),
        ]
    );
    Ok(())
}

#[test]
fn command_identity_control_and_fingerprint_failures_are_idempotent_or_rejected() -> TestResult {
    let content = selected_content_pack()?;
    let fixture = command_fixture(&content, BattleFormat::single())?;
    let proposal = fixture
        .human_proposals
        .first()
        .ok_or("missing human proposal")?
        .clone();
    let staged =
        match admit_command_proposal(&fixture.state, &fixture.control, &proposal, &content)? {
            CommandAdmissionResult::Admitted { state, .. } => state,
            CommandAdmissionResult::Duplicate { .. } => return Err("unexpected duplicate".into()),
        };
    let duplicate = admit_command_proposal(&staged, &fixture.control, &proposal, &content)?;
    assert!(matches!(
        duplicate,
        CommandAdmissionResult::Duplicate { .. }
    ));

    let mut conflict = proposal.clone();
    conflict.command = BattleCommand::fight(
        conflict.actor,
        MoveSlotIndex::new(1)?,
        BattleTargetSelection::implicit(),
    )?;
    let conflict_error = admit_command_proposal(&staged, &fixture.control, &conflict, &content)
        .expect_err("same operation with a different command must conflict");
    assert!(matches!(
        conflict_error,
        AuthorityCommandError::ProposalConflict { .. }
    ));

    let mut wrong_control = proposal.clone();
    wrong_control.control_id = "wrong/control".to_owned();
    let wrong_control_error =
        admit_command_proposal(&fixture.state, &fixture.control, &wrong_control, &content)
            .expect_err("wrong control identity must be rejected");
    assert!(matches!(
        wrong_control_error,
        AuthorityCommandError::ControlIdMismatch { .. }
    ));

    let mut wrong_menu = proposal.clone();
    wrong_menu.menu_instance_id = MenuInstanceId::new(safe(99)?);
    let wrong_menu_error =
        admit_command_proposal(&fixture.state, &fixture.control, &wrong_menu, &content)
            .expect_err("stale menu identity must be rejected");
    assert!(matches!(
        wrong_menu_error,
        AuthorityCommandError::MenuInstanceMismatch { .. }
    ));

    let mut wrong_owner = proposal.clone();
    wrong_owner.owner_seat = seat(2)?;
    let wrong_owner_error =
        admit_command_proposal(&fixture.state, &fixture.control, &wrong_owner, &content)
            .expect_err("wrong owner must be rejected by operation grammar");
    assert!(matches!(
        wrong_owner_error,
        AuthorityCommandError::Command(_)
    ));

    let mut wrong_operation = proposal.clone();
    wrong_operation.operation_id =
        OperationId::new("battle/1/wave/1/turn/1/command/player/0/seat/99".to_owned())?;
    let wrong_operation_error =
        admit_command_proposal(&fixture.state, &fixture.control, &wrong_operation, &content)
            .expect_err("wrong operation grammar must be rejected");
    assert!(matches!(
        wrong_operation_error,
        AuthorityCommandError::Command(_)
    ));

    let mut forged_state = staged.clone();
    let retained_command = match forged_state
        .battle
        .as_ref()
        .and_then(|battle| battle.command_state.frontier.first())
        .and_then(|entry| match &entry.status {
            CommandFrontierStatus::Retained { command, .. } => Some(command.clone()),
            _ => None,
        }) {
        Some(command) => command,
        None => return Err("missing retained command".into()),
    };
    let mut wire = serde_json::to_value(&retained_command)?;
    wire.as_object_mut()
        .ok_or("accepted command did not serialize as an object")?
        .insert("fingerprint".to_owned(), json!("bc1-0-0000000000000000"));
    let forged_command: AcceptedBattleCommand = serde_json::from_value(wire)?;
    let forged_entry = forged_state
        .battle
        .as_mut()
        .ok_or("missing battle")?
        .command_state
        .frontier
        .first_mut()
        .ok_or("missing command frontier")?;
    forged_entry.status = CommandFrontierStatus::Retained {
        command: forged_command,
        source: CommandAdmissionSource::AuthorityLocalInternal,
    };
    let forged_before = forged_state.clone();
    let fingerprint_error = complete_command_frontier(&forged_state, &content)
        .expect_err("forged retained fingerprint must fail before resolution");
    assert!(matches!(
        fingerprint_error,
        AuthorityCommandError::Legality(_)
    ));
    assert_eq!(forged_state, forged_before);
    Ok(())
}

#[test]
fn command_tombstones_preserve_duplicate_identity_after_frontier_clear() -> TestResult {
    let content = selected_content_pack()?;
    let fixture = command_fixture(&content, BattleFormat::single())?;
    let proposal = fixture
        .human_proposals
        .first()
        .ok_or("missing human proposal")?
        .clone();
    let staged =
        match admit_command_proposal(&fixture.state, &fixture.control, &proposal, &content)? {
            CommandAdmissionResult::Admitted { state, .. } => state,
            CommandAdmissionResult::Duplicate { .. } => return Err("unexpected duplicate".into()),
        };
    let enemy = admit_scripted_enemy_frontier(&staged, &fixture.enemy_policy, &content)?;
    let completed = complete_command_frontier(&enemy.state, &content)?;
    let (mut after, commands) = match completed {
        CommandFrontierCompletion::Complete { state, commands } => (state, commands),
        CommandFrontierCompletion::Incomplete { .. } => {
            return Err("frontier did not complete".into());
        }
    };
    after
        .battle
        .as_mut()
        .ok_or("missing battle")?
        .command_state
        .frontier
        .clear();
    let tombstoned = retain_command_tombstones(&after, &commands, &content)?;
    let duplicate = admit_command_proposal(&tombstoned, &fixture.control, &proposal, &content)?;
    assert!(matches!(
        duplicate,
        CommandAdmissionResult::Duplicate { .. }
    ));

    let mut conflicting = proposal;
    conflicting.command = BattleCommand::fight(
        conflicting.actor,
        MoveSlotIndex::new(1)?,
        BattleTargetSelection::implicit(),
    )?;
    let error = admit_command_proposal(&tombstoned, &fixture.control, &conflicting, &content)
        .expect_err("tombstone conflict must remain fail-closed");
    assert!(matches!(
        error,
        AuthorityCommandError::ProposalConflict { .. }
    ));
    Ok(())
}

#[test]
fn replacement_admission_pins_stored_occurrence_source_and_is_idempotent() -> TestResult {
    let content = selected_content_pack()?;
    let (state, occurrence) = pending_replacement_fixture(&content, true)?;
    let reserve = PokemonId::new(safe(2)?);
    let reserve_slot = PartyIndex::new(1)?;
    let control = replacement_control_plan(&state, occurrence, reserve, reserve_slot)?;
    let proposal = replacement_proposal(&state, occurrence, reserve, reserve_slot)?;
    let admitted = admit_replacement_proposal(&state, &control, &[], &proposal, &content)?;
    match admitted {
        ReplacementAdmissionResult::Admitted { proposal: admitted } => {
            assert_eq!(admitted.occurrence, occurrence.id);
            assert_eq!(admitted.turn_occurrence, occurrence.source.turn_occurrence);
        }
        ReplacementAdmissionResult::Duplicate { .. } => return Err("unexpected duplicate".into()),
    }
    let fingerprints = vec![ReplacementProposalFingerprintEntry::new(
        proposal.operation_id.clone(),
        proposal.fingerprint(),
    )?];
    let evidence_before = fingerprints.clone();
    let duplicate =
        admit_replacement_proposal(&state, &control, &fingerprints, &proposal, &content)?;
    assert!(matches!(
        duplicate,
        ReplacementAdmissionResult::Duplicate { .. }
    ));

    let conflicting = BattleReplacementProposalV1::new(
        proposal.operation_id.clone(),
        proposal.battle_id,
        proposal.wave,
        proposal.resolved_turn,
        proposal.owner_seat,
        proposal.occurrence,
        proposal.turn_occurrence,
        proposal.field_slot,
        ReplacementSelection::selected(PartyIndex::ZERO, PokemonId::new(safe(1)?)),
        proposal.menu_instance_id,
        proposal.control_id.clone(),
    )?;
    let conflict_error =
        admit_replacement_proposal(&state, &control, &fingerprints, &conflicting, &content)
            .expect_err("same replacement operation with another selection must conflict");
    assert!(matches!(
        conflict_error,
        AuthorityCommandError::ProposalConflict { .. }
    ));

    let mut wrong_control = proposal.clone();
    wrong_control.control_id = "wrong/replacement/control".to_owned();
    let wrong_control_error =
        admit_replacement_proposal(&state, &control, &[], &wrong_control, &content)
            .expect_err("wrong replacement control must fail closed");
    assert!(matches!(
        wrong_control_error,
        AuthorityCommandError::ControlIdMismatch { .. }
    ));

    let mut wrong_occurrence = proposal.clone();
    wrong_occurrence.occurrence = FaintOccurrenceId::new(safe(99)?);
    let wrong_occurrence_error =
        admit_replacement_proposal(&state, &control, &[], &wrong_occurrence, &content)
            .expect_err("global occurrence identity must remain pinned to the queue head");
    assert!(matches!(
        wrong_occurrence_error,
        AuthorityCommandError::ReplacementHeadMismatch { .. }
            | AuthorityCommandError::ReplacementControlMismatch { .. }
    ));

    let wrong_source_operation = replacement_operation_id(
        occurrence.source.epoch,
        proposal.battle_id,
        occurrence.source.wave,
        occurrence.source.resolved_turn,
        occurrence.source.turn_occurrence + 1,
        occurrence.slot,
        occurrence.owner_seat.ok_or("missing occurrence owner")?,
    )?;
    let wrong_source = BattleReplacementProposalV1::new(
        wrong_source_operation,
        proposal.battle_id,
        proposal.wave,
        proposal.resolved_turn,
        proposal.owner_seat,
        proposal.occurrence,
        proposal.turn_occurrence + 1,
        proposal.field_slot,
        proposal.selection,
        proposal.menu_instance_id,
        proposal.control_id.clone(),
    )?;
    let wrong_source_error =
        admit_replacement_proposal(&state, &control, &[], &wrong_source, &content)
            .expect_err("replacement operation must use source.turn_occurrence");
    assert!(matches!(
        wrong_source_error,
        AuthorityCommandError::DecisionOperationMismatch
            | AuthorityCommandError::Command(_)
            | AuthorityCommandError::ReplacementControlMismatch { .. }
    ));
    assert_eq!(fingerprints, evidence_before);
    Ok(())
}

#[test]
fn no_legal_replacement_is_internal_only_and_does_not_touch_fingerprint_evidence() -> TestResult {
    let content = selected_content_pack()?;
    let (state, occurrence) = pending_replacement_fixture(&content, false)?;
    let internal = internal_no_legal_replacement(&state, occurrence.id, &content)?;
    assert_eq!(internal.occurrence, occurrence.id);
    assert_eq!(internal.selection, ReplacementSelection::NoLegalReplacement);

    let fake_pokemon = PokemonId::new(safe(2)?);
    let fake_slot = PartyIndex::new(1)?;
    let control = replacement_control_plan(&state, occurrence, fake_pokemon, fake_slot)?;
    let selected = replacement_proposal(&state, occurrence, fake_pokemon, fake_slot)?;
    let mut wire = serde_json::to_value(&selected)?;
    wire.as_object_mut()
        .ok_or("replacement did not serialize as an object")?
        .insert(
            "selection".to_owned(),
            json!({"kind": "NO_LEGAL_REPLACEMENT"}),
        );
    let forged_external: BattleReplacementProposalV1 = serde_json::from_value(wire)?;
    let error = admit_replacement_proposal(&state, &control, &[], &forged_external, &content)
        .expect_err("external NO_LEGAL_REPLACEMENT must be rejected");
    assert!(matches!(
        error,
        AuthorityCommandError::ExternalNoLegalReplacement
    ));
    assert!(
        BattleReplacementProposalV1::new(
            selected.operation_id,
            selected.battle_id,
            selected.wave,
            selected.resolved_turn,
            selected.owner_seat,
            selected.occurrence,
            selected.turn_occurrence,
            selected.field_slot,
            ReplacementSelection::NoLegalReplacement,
            selected.menu_instance_id,
            selected.control_id,
        )
        .is_err()
    );
    Ok(())
}

#[test]
fn authority_admission_errors_are_fail_atomic_and_public_semantic_bypasses_are_absent() -> TestResult
{
    let content = selected_content_pack()?;
    let fixture = command_fixture(&content, BattleFormat::single())?;
    let proposal = fixture
        .human_proposals
        .first()
        .ok_or("missing human proposal")?
        .clone();
    let mut invalid = proposal.clone();
    invalid.control_id = "invalid/control".to_owned();
    let before = fixture.state.clone();
    let _ = admit_command_proposal(&fixture.state, &fixture.control, &invalid, &content)
        .expect_err("invalid control should reject");
    assert_eq!(fixture.state, before);

    let authority_source = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../er-game/src/authority_commands.rs"
    ));
    for forbidden in [
        "resolve_turn(",
        "resolve_replacement(",
        "UiIntent",
        "KernelInput",
        "ApplyAuthorityMaterial",
        "ProjectAuthorityControl",
        "ControlMenuPlan",
        "MenuProposalPlan",
        "AuthorityResolutionPlan",
        "ReplacementAdmissionLedger",
    ] {
        assert!(
            !authority_source.contains(forbidden),
            "game admission boundary contains forbidden semantic bypass: {forbidden}"
        );
    }
    for required in [
        "PreparedAuthorityAdmission",
        "PreparedAuthorityMenuPath",
        "validate_replayed_path",
        "MissingRemoteMenuReplay",
        "project_scripted_policy_for_material",
        "ReplacementProposalFingerprintEntry",
        "PreparedReplacementFingerprintEvidence",
        "validate_replacement_fingerprint_evidence",
    ] {
        assert!(
            authority_source.contains(required),
            "authority admission boundary is missing the typed {required} seam"
        );
    }
    Ok(())
}

#[test]
fn authority_adapter_stages_material_and_log_before_publication() -> TestResult {
    let source = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/battle_authority.rs"
    ));
    let prepared = source
        .find("PreparedAuthorityTurn {")
        .ok_or("GameRuntime prepared TURN seam missing")?;
    let codec = source
        .find("let (decoded, payload) = encode_decode_material(&material)?")
        .ok_or("authority material codec seam missing")?;
    let apply = source
        .find("let applied = apply_turn_material(")
        .ok_or("authority common applier seam missing")?;
    let prepare = source
        .find(".prepare_commit(AuthorityEntryDraft {")
        .ok_or("authority log prepare seam missing")?;
    let validate = source
        .find("validator.validate_authority_stage(&self)?")
        .ok_or("enclosing validation hook missing")?;
    let publish = source
        .find(".publish_prepared(prepared.token")
        .ok_or("authority log publication seam missing")?;
    let post_validate = source
        .find("validator.validate_authority_publication(&published)?")
        .ok_or("post-publication enclosing validation hook missing")?;
    assert!(prepared < codec);
    assert!(codec < apply);
    assert!(apply < prepare);
    assert!(validate < publish);
    assert!(publish < post_validate);
    assert!(source.contains("PreparedAuthorityReplacement {"));
    assert!(source.contains("validate_control_allocator_projection(&next_control, &allocators)?"));
    assert!(source.contains("prepared_admission.allocator_before() != allocators.as_slice()"));
    assert!(source.contains("admit_scripted_if_pending"));
    assert!(source.contains("CommandCollectionState"));
    assert!(source.contains("protocol_next_control_from_plan"));
    assert!(source.contains("admit_command_proposal_with_context"));
    assert!(source.contains("admit_replacement_proposal_with_context"));
    assert!(source.contains("replacement_fingerprints.entries()"));
    assert!(source.contains("ReplacementAdmissionResult::Duplicate { .. }"));
    assert!(source.contains("expected read-only"));
    assert!(!source.contains("return Err(AuthorityTransactionError::Duplicate"));
    assert!(source.contains("commands: completed_commands"));
    assert!(source.contains("candidate.accepted_commands != completed_state_commands"));
    assert!(source.contains("frontier and tombstones"));
    assert!(source.contains("scripted_policy_after"));
    assert!(source.contains("validate_published_authority_stage(&published)?"));
    assert!(source.contains("peer_stage_quorum"));
    assert!(source.contains("AuthorityLogAction::Deliver"));
    assert!(source.contains("checked_add(1)"));
    assert!(source.contains("if required > allocator.next_menu_instance_id.get()"));
    assert!(!source.contains("resolve_turn("));
    assert!(!source.contains("resolve_replacement("));
    assert!(!source.contains("request.next_control"));
    assert!(!source.contains("request.protocol_next_control"));
    assert!(!source.contains("ReplacementAdmissionLedger"));
    assert!(!source.contains("replacement_ledger"));
    let prepared_start = source
        .find("pub(crate) struct AuthorityPreparedTransaction")
        .ok_or("prepared transaction type missing")?;
    let prepared_end = source
        .find("pub(crate) enum PreparedMaterial")
        .ok_or("prepared material type missing")?;
    assert!(source[prepared_start..prepared_end].contains("scripted_policy_after"));
    let published_start = source
        .find("pub(crate) struct AuthorityPublishedTransaction")
        .ok_or("published transaction type missing")?;
    let published_end = source
        .find("/// Prepare a complete authority TURN")
        .ok_or("authority preparation function missing")?;
    assert!(source[published_start..published_end].contains("scripted_policy_after"));
    assert!(source.contains("require_turn_equivalence(&candidate, &decoded, &applied)?"));
    assert!(source.contains("require_replacement_equivalence(&candidate, &decoded, &applied)?"));
    assert!(source.contains("stored.source.turn_occurrence"));
    Ok(())
}
