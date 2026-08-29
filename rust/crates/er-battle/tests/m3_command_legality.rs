use std::error::Error;

use er_battle::command::NormalizedBattleCommand;
use er_battle::legality::{
    CommandLegalityError, build_command_offer, build_replacement_offer, build_scripted_enemy_offer,
    normalize_command_set, validate_command_proposal, validate_preserved_offer,
    validate_replacement_proposal, validate_replacement_selection, validate_state_content,
};
use er_content::pack::{ContentPack, selected_content_pack};
use er_content::species::find_species;
use er_rng::phaser::{PhaserRdg, RunRngState};
use er_state::battle::{
    BattleOutcome, BattleRngState, BattleState, CommandCollectionState, FaintOccurrence,
    FaintSource, ReplacementProgress,
};
use er_state::conditions::{
    GlobalAbilitySuppressionState, TerrainKind, TerrainState, WeatherKind, WeatherState,
};
use er_state::field::{FieldSlotState, FieldState};
use er_state::format::BattleFormat;
use er_state::pokemon::{
    AbilityId, AbilityLoadout, BattleStats, MoveId, MoveSlotState, PokemonId, PokemonState,
    SpeciesId, StatStages, StatusKind, StatusState,
};
use er_state::snapshot::GameState;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleCommandProposalV1, BattleReplacementProposalV1,
    BattleTargetSelection, CommandAdmissionSource, CommandFrontierEntry, CommandFrontierStatus,
    CommandSet, ReplacementSelection, ScriptedEnemyBattleCommandV1, player_command_operation_id,
    replacement_operation_id, scripted_enemy_command_operation_id,
};
use er_types::battle_ids::{
    AuthorityEpoch, BattleId, BattleSide, FaintOccurrenceId, FieldSlot, GameModeId, MenuInstanceId,
    MoveSlotIndex, PartyIndex, TurnIndex, WaveIndex,
};
use er_types::{SafeU53, SeatId};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(_) => SafeU53::ZERO,
    }
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn slot(side: BattleSide, position: u8) -> FieldSlot {
    match FieldSlot::new(side, position) {
        Ok(slot) => slot,
        Err(_) => FieldSlot { side, position: 0 },
    }
}

fn wave(value: u64) -> TestResult<WaveIndex> {
    Ok(WaveIndex::new(safe(value))?)
}

fn turn(value: u64) -> TestResult<TurnIndex> {
    Ok(TurnIndex::new(safe(value))?)
}

fn move_id(value: u64) -> MoveId {
    MoveId::new(safe(value))
}

fn species_id(value: u64) -> SpeciesId {
    SpeciesId::new(safe(value))
}

fn pokemon(
    content: &ContentPack,
    id: u64,
    owner: Option<SeatId>,
    species: u64,
    moves: &[u64],
) -> TestResult<PokemonState> {
    let species_id = species_id(species);
    let definition = find_species(&content.species, species_id)?;
    let mut move_slots = [None, None, None, None];
    for (index, id) in moves.iter().copied().enumerate() {
        let Some(destination) = move_slots.get_mut(index) else {
            return Err("test fixture exceeds four move slots".into());
        };
        *destination = Some(MoveSlotState {
            move_id: move_id(id),
            pp_used: 0,
            pp_ups: 0,
            max_pp_override: None,
        });
    }
    Ok(PokemonState::new(
        PokemonId::new(safe(id)),
        owner,
        species_id,
        0,
        25,
        definition.base_types,
        BattleStats {
            hp: 100,
            attack: 50,
            defense: 50,
            special_attack: 50,
            special_defense: 50,
            speed: 50,
        },
        100,
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
            active: AbilityId::new(safe(0)),
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        false,
    )?)
}

fn game_state(
    content: &ContentPack,
    format: BattleFormat,
    player_party: Vec<PokemonState>,
    enemy_party: Vec<PokemonState>,
    occupants: Vec<Option<PokemonId>>,
) -> TestResult<GameState> {
    let battle_wave = wave(2)?;
    let battle_turn = turn(1)?;
    let slots = match (format.player_capacity, format.enemy_capacity) {
        (1, 1) => vec![slot(BattleSide::Player, 0), slot(BattleSide::Enemy, 0)],
        (2, 2) => vec![
            slot(BattleSide::Player, 0),
            slot(BattleSide::Player, 1),
            slot(BattleSide::Enemy, 0),
            slot(BattleSide::Enemy, 1),
        ],
        _ => return Err("unsupported test format".into()),
    };
    if occupants.len() != slots.len() {
        return Err("test field occupancy does not match format".into());
    }
    let field = FieldState::new_for_format(
        &format,
        slots
            .into_iter()
            .zip(occupants)
            .map(|(slot, occupant)| FieldSlotState::new(slot, occupant))
            .collect(),
    )?;
    let battle = BattleState {
        battle_id: BattleId::new(safe(7)),
        wave: battle_wave,
        wave_seed: "m3-command-wave".to_owned(),
        turn: battle_turn,
        format,
        authority_seat: seat(1),
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
        battle_rng: BattleRngState::new("m3-command-battle", battle_turn),
        command_state: CommandCollectionState::new(Vec::new(), Vec::new())?,
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::ZERO,
        outcome: BattleOutcome::Ongoing,
    };
    Ok(GameState::new(
        content.hash.clone(),
        GameModeId::new(safe(1)),
        battle_wave,
        BattleId::new(safe(8)),
        RunRngState {
            rdg: PhaserRdg::from_seed("m3-command-run").state(),
        },
        Some(battle),
    )?)
}

fn single_state(content: &ContentPack) -> TestResult<GameState> {
    let player = pokemon(content, 101, Some(seat(1)), 19, &[1, 589])?;
    let reserve = pokemon(content, 102, Some(seat(1)), 7, &[52])?;
    let enemy = pokemon(content, 201, None, 52, &[1])?;
    let occupants = vec![Some(player.id), Some(enemy.id)];
    game_state(
        content,
        BattleFormat::single(),
        vec![player, reserve],
        vec![enemy],
        occupants,
    )
}

fn double_state(content: &ContentPack) -> TestResult<GameState> {
    let player_zero = pokemon(content, 101, Some(seat(1)), 19, &[1, 589])?;
    let player_one = pokemon(content, 102, Some(seat(2)), 7, &[1])?;
    let reserve_zero = pokemon(content, 103, Some(seat(1)), 23, &[52])?;
    let reserve_one = pokemon(content, 104, Some(seat(2)), 1, &[77])?;
    let enemy_zero = pokemon(content, 201, None, 52, &[1])?;
    let enemy_one = pokemon(content, 202, None, 50, &[351])?;
    let occupants = vec![
        Some(player_zero.id),
        Some(player_one.id),
        Some(enemy_zero.id),
        Some(enemy_one.id),
    ];
    game_state(
        content,
        BattleFormat::coop_double(),
        vec![player_zero, player_one, reserve_zero, reserve_one],
        vec![enemy_zero, enemy_one],
        occupants,
    )
}

fn battle(state: &GameState) -> TestResult<&BattleState> {
    state.battle.as_ref().ok_or_else(|| "missing battle".into())
}

fn battle_mut(state: &mut GameState) -> TestResult<&mut BattleState> {
    state.battle.as_mut().ok_or_else(|| "missing battle".into())
}

#[test]
fn singles_offer_uses_implicit_fixed_target_and_same_owner_switches() -> TestResult {
    let content = selected_content_pack()?;
    let mut state = single_state(&content)?;
    let player_slot = slot(BattleSide::Player, 0);
    let enemy_slot = slot(BattleSide::Enemy, 0);
    let offer = build_command_offer(&state, player_slot, &content)?;

    assert_eq!(offer.fight.len(), 2);
    assert_eq!(
        offer.fight[0].legal_targets,
        vec![BattleTargetSelection::Implicit]
    );
    assert_eq!(
        offer.fight[1].legal_targets,
        vec![BattleTargetSelection::Selected(vec![enemy_slot])]
    );
    assert_eq!(offer.switches.len(), 1);
    assert_eq!(offer.switches[0].party_slot, PartyIndex::new(1)?);

    let current = battle(&state)?;
    let battle_id = current.battle_id;
    let battle_wave = current.wave;
    let battle_turn = current.turn;
    let actor = current.player_party[0].id;
    let operation =
        player_command_operation_id(battle_id, battle_wave, battle_turn, player_slot, seat(1))?;
    let entry = CommandFrontierEntry::new(
        operation.clone(),
        Some(seat(1)),
        actor,
        player_slot,
        offer,
        CommandFrontierStatus::Pending,
    )?;
    battle_mut(&mut state)?.command_state = CommandCollectionState::new(vec![entry], Vec::new())?;

    let implicit = BattleCommandProposalV1::new(
        operation.clone(),
        battle_id,
        battle_wave,
        battle_turn,
        seat(1),
        actor,
        player_slot,
        BattleCommand::fight(
            actor,
            MoveSlotIndex::new(0)?,
            BattleTargetSelection::Implicit,
        )?,
        MenuInstanceId::new(safe(1)),
        "command/singles",
    )?;
    let before = state.clone();
    let normalized = validate_command_proposal(&state, &implicit, &content)?;
    assert!(matches!(
        normalized,
        NormalizedBattleCommand::Fight { targets, .. } if targets == vec![enemy_slot]
    ));
    assert_eq!(state, before);

    let selected = BattleCommandProposalV1::new(
        operation,
        battle_id,
        battle_wave,
        battle_turn,
        seat(1),
        actor,
        player_slot,
        BattleCommand::fight(
            actor,
            MoveSlotIndex::new(0)?,
            BattleTargetSelection::selected(vec![enemy_slot])?,
        )?,
        MenuInstanceId::new(safe(2)),
        "command/singles-selected",
    )?;
    assert!(matches!(
        validate_command_proposal(&state, &selected, &content),
        Err(CommandLegalityError::CommandNotOffered { .. })
    ));
    assert_eq!(state, before);
    Ok(())
}

#[test]
fn doubles_targets_are_canonical_and_spread_targets_are_complete() -> TestResult {
    let content = selected_content_pack()?;
    let state = double_state(&content)?;
    let actor_slot = slot(BattleSide::Player, 0);
    let ally = slot(BattleSide::Player, 1);
    let enemy_zero = slot(BattleSide::Enemy, 0);
    let enemy_one = slot(BattleSide::Enemy, 1);
    let offer = build_command_offer(&state, actor_slot, &content)?;

    assert_eq!(
        offer.fight[0].legal_targets,
        vec![
            BattleTargetSelection::Selected(vec![ally]),
            BattleTargetSelection::Selected(vec![enemy_zero]),
            BattleTargetSelection::Selected(vec![enemy_one]),
        ]
    );
    assert_eq!(
        offer.fight[1].legal_targets,
        vec![BattleTargetSelection::Selected(
            vec![enemy_zero, enemy_one,]
        )]
    );
    assert_eq!(offer.switches.len(), 1);
    assert_eq!(
        offer.switches[0].pokemon,
        battle(&state)?.player_party[2].id
    );
    Ok(())
}

#[test]
fn exhausted_pp_invalidates_a_preserved_offer_without_mutating_state() -> TestResult {
    let content = selected_content_pack()?;
    let mut state = single_state(&content)?;
    let player_slot = slot(BattleSide::Player, 0);
    let stale_offer = build_command_offer(&state, player_slot, &content)?;
    let current = battle(&state)?;
    let operation = player_command_operation_id(
        current.battle_id,
        current.wave,
        current.turn,
        player_slot,
        seat(1),
    )?;
    let actor = current.player_party[0].id;
    let entry = CommandFrontierEntry::new(
        operation,
        Some(seat(1)),
        actor,
        player_slot,
        stale_offer,
        CommandFrontierStatus::Pending,
    )?;
    let battle_state = battle_mut(&mut state)?;
    battle_state.command_state = CommandCollectionState::new(vec![entry], Vec::new())?;
    battle_state.player_party[0].moves[0]
        .as_mut()
        .ok_or("missing move")?
        .pp_used = 35;

    let before = state.clone();
    let entry = &battle(&state)?.command_state.frontier[0];
    assert!(matches!(
        validate_preserved_offer(&state, entry, &content),
        Err(CommandLegalityError::StaleOffer { .. })
    ));
    assert_eq!(state, before);

    let refreshed = build_command_offer(&state, player_slot, &content)?;
    assert_eq!(refreshed.fight.len(), 1);
    assert_eq!(refreshed.fight[0].move_slot, MoveSlotIndex::new(1)?);
    Ok(())
}

#[test]
fn complete_command_set_revalidates_human_and_singleton_enemy_frontiers() -> TestResult {
    let content = selected_content_pack()?;
    let mut state = single_state(&content)?;
    let player_slot = slot(BattleSide::Player, 0);
    let enemy_slot = slot(BattleSide::Enemy, 0);
    let current = battle(&state)?;
    let player_actor = current.player_party[0].id;
    let enemy_actor = current.enemy_party[0].id;
    let player_operation = player_command_operation_id(
        current.battle_id,
        current.wave,
        current.turn,
        player_slot,
        seat(1),
    )?;
    let enemy_cursor = safe(0);
    let enemy_operation = scripted_enemy_command_operation_id(
        current.battle_id,
        current.wave,
        current.turn,
        enemy_slot,
        enemy_cursor,
    )?;
    let player_command = BattleCommand::fight(
        player_actor,
        MoveSlotIndex::new(0)?,
        BattleTargetSelection::Implicit,
    )?;
    let enemy_command = BattleCommand::fight(
        enemy_actor,
        MoveSlotIndex::new(0)?,
        BattleTargetSelection::Implicit,
    )?;
    let player_proposal = BattleCommandProposalV1::new(
        player_operation.clone(),
        current.battle_id,
        current.wave,
        current.turn,
        seat(1),
        player_actor,
        player_slot,
        player_command,
        MenuInstanceId::new(safe(1)),
        "command/full-player",
    )?;
    let scripted = ScriptedEnemyBattleCommandV1::new(
        enemy_operation.clone(),
        current.battle_id,
        current.wave,
        current.turn,
        enemy_cursor,
        enemy_actor,
        enemy_slot,
        enemy_command.clone(),
    )?;
    let player_accepted = AcceptedBattleCommand::human(player_proposal);
    let enemy_accepted = AcceptedBattleCommand::scripted_enemy(scripted);
    let player_offer = build_command_offer(&state, player_slot, &content)?;
    let enemy_offer = build_scripted_enemy_offer(&state, enemy_slot, &enemy_command, &content)?;
    let entries = vec![
        CommandFrontierEntry::new(
            player_operation,
            Some(seat(1)),
            player_actor,
            player_slot,
            player_offer,
            CommandFrontierStatus::Admitted {
                command: player_accepted.clone(),
                source: CommandAdmissionSource::AuthorityLocalInternal,
            },
        )?,
        CommandFrontierEntry::new(
            enemy_operation,
            None,
            enemy_actor,
            enemy_slot,
            enemy_offer,
            CommandFrontierStatus::Admitted {
                command: enemy_accepted.clone(),
                source: CommandAdmissionSource::ScriptedEnemy,
            },
        )?,
    ];
    battle_mut(&mut state)?.command_state = CommandCollectionState::new(entries, Vec::new())?;
    let commands = CommandSet::new(vec![player_accepted, enemy_accepted])?;

    let before = state.clone();
    let normalized = normalize_command_set(&state, &commands, &content)?;
    assert_eq!(normalized.entries().len(), 2);
    assert_eq!(normalized.entries()[0].field_slot(), player_slot);
    assert_eq!(normalized.entries()[1].field_slot(), enemy_slot);
    assert_eq!(state, before);

    battle_mut(&mut state)?.player_party[0].moves[0]
        .as_mut()
        .ok_or("missing move")?
        .pp_used = 35;
    assert!(matches!(
        normalize_command_set(&state, &commands, &content),
        Err(CommandLegalityError::StaleOffer { .. })
    ));
    Ok(())
}

#[test]
fn replacement_uses_stored_queue_identity_owner_and_exact_operation_address() -> TestResult {
    let content = selected_content_pack()?;
    let mut state = single_state(&content)?;
    let occurrence = FaintOccurrenceId::new(safe(4));
    let epoch = AuthorityEpoch::new(safe(3));
    let player_slot = slot(BattleSide::Player, 0);
    let battle_state = battle_mut(&mut state)?;
    battle_state.player_party[0].hp = 0;
    battle_state.player_party[0].fainted = true;
    battle_state.faint_queue = vec![FaintOccurrence {
        id: occurrence,
        source: FaintSource {
            epoch,
            wave: battle_state.wave,
            resolved_turn: battle_state.turn,
            turn_occurrence: 2,
        },
        slot: player_slot,
        pokemon: battle_state.player_party[0].id,
        owner_seat: Some(seat(1)),
        replacement: ReplacementProgress::Pending,
    }];
    battle_state.next_faint_occurrence = FaintOccurrenceId::new(safe(5));

    let offer = build_replacement_offer(&state, occurrence, &content)?;
    assert_eq!(offer.len(), 1);
    let selected = ReplacementSelection::selected(offer[0].party_slot, offer[0].pokemon);
    assert!(validate_replacement_selection(&state, occurrence, &selected, &content).is_ok());
    assert!(matches!(
        validate_replacement_selection(
            &state,
            occurrence,
            &ReplacementSelection::NoLegalReplacement,
            &content,
        ),
        Err(CommandLegalityError::LegalReplacementExists)
    ));

    let current = battle(&state)?;
    let operation = replacement_operation_id(
        epoch,
        current.battle_id,
        current.wave,
        current.turn,
        2,
        player_slot,
        seat(1),
    )?;
    let proposal = BattleReplacementProposalV1::new(
        operation,
        current.battle_id,
        current.wave,
        current.turn,
        seat(1),
        occurrence,
        2,
        player_slot,
        selected,
        MenuInstanceId::new(safe(9)),
        "replacement/exact",
    )?;
    assert!(validate_replacement_proposal(&state, &proposal, &content).is_ok());

    let wrong_occurrence = BattleReplacementProposalV1::new(
        proposal.operation_id.clone(),
        proposal.battle_id,
        proposal.wave,
        proposal.resolved_turn,
        proposal.owner_seat,
        FaintOccurrenceId::new(safe(3)),
        proposal.turn_occurrence,
        proposal.field_slot,
        proposal.selection,
        MenuInstanceId::new(safe(10)),
        "replacement/wrong-global-id",
    )?;
    assert!(matches!(
        validate_replacement_proposal(&state, &wrong_occurrence, &content),
        Err(CommandLegalityError::ReplacementNotCurrent { .. })
    ));

    let wrong_operation = replacement_operation_id(
        epoch,
        proposal.battle_id,
        proposal.wave,
        proposal.resolved_turn,
        3,
        proposal.field_slot,
        proposal.owner_seat,
    )?;
    let wrong_turn_occurrence = BattleReplacementProposalV1::new(
        wrong_operation,
        proposal.battle_id,
        proposal.wave,
        proposal.resolved_turn,
        proposal.owner_seat,
        proposal.occurrence,
        3,
        proposal.field_slot,
        proposal.selection,
        MenuInstanceId::new(safe(11)),
        "replacement/wrong-turn-occurrence",
    )?;
    assert!(matches!(
        validate_replacement_proposal(&state, &wrong_turn_occurrence, &content),
        Err(CommandLegalityError::StaleReplacementCoordinates)
    ));
    Ok(())
}

#[test]
fn content_membership_and_internal_no_replacement_decision_fail_closed() -> TestResult {
    let content = selected_content_pack()?;
    let mut invalid = single_state(&content)?;
    battle_mut(&mut invalid)?.player_party[0].species_id = species_id(999);
    assert!(matches!(
        validate_state_content(&invalid, &content),
        Err(CommandLegalityError::UnknownSpecies { .. })
    ));

    let mut state = single_state(&content)?;
    let occurrence = FaintOccurrenceId::new(safe(0));
    let player_slot = slot(BattleSide::Player, 0);
    let battle_state = battle_mut(&mut state)?;
    for pokemon in &mut battle_state.player_party {
        pokemon.hp = 0;
        pokemon.fainted = true;
    }
    battle_state.faint_queue = vec![FaintOccurrence {
        id: occurrence,
        source: FaintSource {
            epoch: AuthorityEpoch::new(safe(1)),
            wave: battle_state.wave,
            resolved_turn: battle_state.turn,
            turn_occurrence: 0,
        },
        slot: player_slot,
        pokemon: battle_state.player_party[0].id,
        owner_seat: Some(seat(1)),
        replacement: ReplacementProgress::Pending,
    }];
    battle_state.next_faint_occurrence = FaintOccurrenceId::new(safe(1));

    assert!(build_replacement_offer(&state, occurrence, &content)?.is_empty());
    assert!(
        validate_replacement_selection(
            &state,
            occurrence,
            &ReplacementSelection::NoLegalReplacement,
            &content,
        )
        .is_ok()
    );
    assert!(matches!(
        validate_replacement_selection(
            &state,
            occurrence,
            &ReplacementSelection::selected(
                PartyIndex::new(1)?,
                battle(&state)?.player_party[1].id,
            ),
            &content,
        ),
        Err(CommandLegalityError::ReplacementNotOffered)
    ));
    Ok(())
}
