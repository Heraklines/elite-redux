use std::error::Error;

use er_battle::command::NormalizedBattleCommand;
use er_battle::resolver::BattleMutation;
use er_battle::switch::{SwitchError, SwitchEvidence, resolve_switch, validate_switch};
use er_state::battle::{BattleOutcome, BattleState, CommandCollectionState};
use er_state::conditions::{
    GlobalAbilitySuppressionState, TerrainKind, TerrainState, WeatherKind, WeatherState,
};
use er_state::field::{FieldSlotState, FieldState};
use er_state::format::BattleFormat;
use er_state::pokemon::{AbilityLoadout, BattleStats, PokemonState, StatStages, StatusState};
use er_types::battle_ids::{
    AbilityId, BattleId, BattleSide, FaintOccurrenceId, FieldSlot, MoveSlotIndex, PartyIndex,
    PokemonId, SpeciesId, TurnIndex, WaveIndex,
};
use er_types::battle_model::{PokemonType, PokemonTyping, StatusKind};
use er_types::battle_ui::BattlePresentationKind;
use er_types::{OperationId, SafeU53, SeatId};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value is JavaScript-safe")
}

fn pokemon_id(value: u64) -> PokemonId {
    PokemonId::new(safe(value))
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn slot(side: BattleSide, position: u8) -> FieldSlot {
    FieldSlot::new(side, position).expect("test field slot is representable")
}

fn operation(value: &str) -> OperationId {
    OperationId::new(value).expect("test operation ID is valid")
}

fn pokemon(id: u64, owner_seat: Option<SeatId>) -> PokemonState {
    PokemonState::new(
        pokemon_id(id),
        owner_seat,
        SpeciesId::ZERO,
        0,
        1,
        PokemonTyping {
            primary: PokemonType::Normal,
            secondary: None,
        },
        BattleStats {
            hp: 100,
            attack: 100,
            defense: 100,
            special_attack: 100,
            special_defense: 100,
            speed: 100,
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
        [None, None, None, None],
        AbilityLoadout {
            active: AbilityId::ZERO,
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        false,
    )
    .expect("test Pokémon is state-valid")
}

fn battle(
    format: BattleFormat,
    player_party: Vec<PokemonState>,
    enemy_party: Vec<PokemonState>,
    occupants: Vec<Option<PokemonId>>,
) -> BattleState {
    let slots = match (format.player_capacity, format.enemy_capacity) {
        (1, 1) => vec![slot(BattleSide::Player, 0), slot(BattleSide::Enemy, 0)],
        (2, 2) => vec![
            slot(BattleSide::Player, 0),
            slot(BattleSide::Player, 1),
            slot(BattleSide::Enemy, 0),
            slot(BattleSide::Enemy, 1),
        ],
        _ => Vec::new(),
    };
    assert!(!slots.is_empty(), "test only uses the selected M3 topologies");
    assert_eq!(slots.len(), occupants.len());
    let turn = TurnIndex::new(safe(1));
    BattleState {
        battle_id: BattleId::new(safe(1)),
        wave: WaveIndex::new(safe(1)),
        wave_seed: "m3-switch-test".to_owned(),
        turn,
        format: format.clone(),
        authority_seat: seat(1),
        player_party,
        enemy_party,
        field: FieldState::new_for_format(
            &format,
            slots
                .into_iter()
                .zip(occupants)
                .map(|(field_slot, occupant)| FieldSlotState::new(field_slot, occupant))
                .collect(),
        )
        .expect("test field is canonical"),
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
        battle_rng: er_rng::battle::BattleRngState::new("m3-switch-test", turn),
        command_state: CommandCollectionState::new(Vec::new(), Vec::new())
            .expect("test command state is canonical"),
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::ZERO,
        outcome: BattleOutcome::Ongoing,
    }
}

fn single_battle() -> BattleState {
    battle(
        BattleFormat::single(),
        vec![pokemon(1, Some(seat(1))), pokemon(2, Some(seat(1)))],
        vec![pokemon(3, None)],
        vec![Some(pokemon_id(1)), Some(pokemon_id(3))],
    )
}

fn double_battle() -> BattleState {
    battle(
        BattleFormat::coop_double(),
        vec![
            pokemon(1, Some(seat(1))),
            pokemon(2, Some(seat(2))),
            pokemon(3, Some(seat(1))),
            pokemon(4, Some(seat(2))),
        ],
        vec![pokemon(5, None), pokemon(6, None)],
        vec![
            Some(pokemon_id(1)),
            Some(pokemon_id(2)),
            Some(pokemon_id(5)),
            Some(pokemon_id(6)),
        ],
    )
}

fn switch_command(
    operation_name: &str,
    actor: u64,
    source: FieldSlot,
    party_slot: u8,
    incoming: u64,
) -> NormalizedBattleCommand {
    NormalizedBattleCommand::Switch {
        operation_id: operation(operation_name),
        actor: pokemon_id(actor),
        field_slot: source,
        party_slot: PartyIndex::new(party_slot).expect("test party slot is representable"),
        incoming: pokemon_id(incoming),
    }
}

fn fight_command() -> NormalizedBattleCommand {
    NormalizedBattleCommand::Fight {
        operation_id: operation("fight/not-switch"),
        actor: pokemon_id(1),
        field_slot: slot(BattleSide::Player, 0),
        move_slot: MoveSlotIndex::ZERO,
        move_id: er_types::battle_ids::MoveId::ZERO,
        targets: Vec::new(),
    }
}

fn assert_rejected<F>(
    mut battle: BattleState,
    command: &NormalizedBattleCommand,
    matches_error: F,
) where
    F: FnOnce(&SwitchError) -> bool,
{
    let before = battle.clone();
    let result = resolve_switch(&mut battle, command, |_, _| ());
    assert!(result.is_err(), "invalid switch unexpectedly resolved");
    if let Err(error) = result {
        assert!(matches_error(&error), "unexpected switch error: {error:?}");
    }
    assert_eq!(battle, before, "rejected switch mutated canonical state");
}

#[test]
fn non_switch_commands_are_rejected_without_mutation() {
    let command = fight_command();
    assert_rejected(single_battle(), &command, |error| {
        matches!(error, SwitchError::NotSwitchCommand)
    });
}

#[test]
fn source_slot_validation_rejects_missing_empty_and_actor_mismatch() {
    let command = switch_command("missing-source", 1, slot(BattleSide::Player, 0), 1, 2);
    let mut missing = single_battle();
    missing
        .field
        .slots
        .retain(|entry| entry.slot != slot(BattleSide::Player, 0));
    assert_rejected(missing, &command, |error| {
        matches!(error, SwitchError::SourceSlotMissing { .. })
    });

    let mut empty = single_battle();
    empty.field.slots[0].occupant = None;
    assert_rejected(empty, &command, |error| {
        matches!(error, SwitchError::SourceSlotEmpty { .. })
    });

    let wrong_actor = switch_command("wrong-actor", 3, slot(BattleSide::Player, 0), 1, 2);
    assert_rejected(single_battle(), &wrong_actor, |error| {
        matches!(error, SwitchError::ActorMismatch { .. })
    });

    let invalid_topology = NormalizedBattleCommand::Switch {
        operation_id: operation("invalid-topology"),
        actor: pokemon_id(1),
        field_slot: FieldSlot {
            side: BattleSide::Player,
            position: 1,
        },
        party_slot: PartyIndex::ZERO,
        incoming: pokemon_id(2),
    };
    assert_rejected(single_battle(), &invalid_topology, |error| {
        matches!(error, SwitchError::InvalidSourceTopology { .. })
    });
}

#[test]
fn active_actor_must_exist_belong_to_slot_owner_and_be_living() {
    let missing_actor = switch_command("missing-actor", 99, slot(BattleSide::Player, 0), 1, 2);
    let mut missing = single_battle();
    missing.field.slots[0].occupant = Some(pokemon_id(99));
    assert_rejected(missing, &missing_actor, |error| {
        matches!(
            error,
            SwitchError::ActiveActorMissing {
                actor,
                side: BattleSide::Player
            } if *actor == pokemon_id(99)
        )
    });

    let owner_mismatch = switch_command("active-owner", 1, slot(BattleSide::Player, 0), 1, 2);
    let mut wrong_owner = single_battle();
    wrong_owner.player_party[0].owner_seat = Some(seat(2));
    assert_rejected(wrong_owner, &owner_mismatch, |error| {
        matches!(error, SwitchError::ActiveOwnerMismatch { .. })
    });

    let fainted = switch_command("fainted-actor", 1, slot(BattleSide::Player, 0), 1, 2);
    let mut fainted_battle = single_battle();
    fainted_battle.player_party[0].hp = 0;
    fainted_battle.player_party[0].fainted = true;
    assert_rejected(fainted_battle, &fainted, |error| {
        matches!(error, SwitchError::ActiveActorFainted { .. })
    });
}

#[test]
fn incoming_party_identity_owner_and_faint_state_are_revalidated() {
    let missing = switch_command("missing-party", 1, slot(BattleSide::Player, 0), 5, 2);
    assert_rejected(single_battle(), &missing, |error| {
        matches!(error, SwitchError::IncomingPartySlotMissing { .. })
    });

    let wrong_identity = switch_command("wrong-identity", 1, slot(BattleSide::Player, 0), 1, 99);
    assert_rejected(single_battle(), &wrong_identity, |error| {
        matches!(error, SwitchError::IncomingPartyIdentityMismatch { .. })
    });

    let owner = switch_command("incoming-owner", 1, slot(BattleSide::Player, 0), 1, 2);
    let mut wrong_owner = single_battle();
    wrong_owner.player_party[1].owner_seat = Some(seat(2));
    assert_rejected(wrong_owner, &owner, |error| {
        matches!(error, SwitchError::IncomingOwnerMismatch { .. })
    });

    let fainted = switch_command("incoming-fainted", 1, slot(BattleSide::Player, 0), 1, 2);
    let mut fainted_battle = single_battle();
    fainted_battle.player_party[1].hp = 0;
    fainted_battle.player_party[1].fainted = true;
    assert_rejected(fainted_battle, &fainted, |error| {
        matches!(error, SwitchError::IncomingFainted { .. })
    });
}

#[test]
fn incoming_already_on_any_field_slot_is_rejected_without_mutation() {
    let command = switch_command("already-fielded", 1, slot(BattleSide::Player, 0), 1, 2);
    let mut battle = single_battle();
    battle.field.slots[1].occupant = Some(pokemon_id(2));
    assert_rejected(battle, &command, |error| {
        matches!(error, SwitchError::IncomingAlreadyOnField { .. })
    });
}

#[test]
fn singles_switch_installs_only_occupancy_and_returns_exact_evidence() -> TestResult {
    let mut battle = single_battle();
    let command = switch_command("single-switch", 1, slot(BattleSide::Player, 0), 1, 2);
    let before = battle.clone();
    let resolution = resolve_switch(&mut battle, &command, |_, _| ())?;

    let mut expected = before;
    expected.field.slots[0].occupant = Some(pokemon_id(2));
    assert_eq!(battle, expected);
    assert_eq!(
        resolution.mutation,
        BattleMutation::FieldChanged {
            slot: slot(BattleSide::Player, 0),
            before: Some(pokemon_id(1)),
            after: Some(pokemon_id(2)),
        }
    );
    assert_eq!(
        resolution.evidence,
        SwitchEvidence {
            operation_id: operation("single-switch"),
            slot: slot(BattleSide::Player, 0),
            outgoing: Some(pokemon_id(1)),
            incoming: pokemon_id(2),
            semantic: BattlePresentationKind::Switched {
                slot: slot(BattleSide::Player, 0),
                outgoing: Some(pokemon_id(1)),
                incoming: pokemon_id(2),
            },
        }
    );
    assert_eq!(resolution.post_switch, ());
    Ok(())
}

#[test]
fn doubles_switch_uses_the_position_owner_and_preserves_other_occupants() -> TestResult {
    let mut battle = double_battle();
    let command = switch_command("double-switch", 2, slot(BattleSide::Player, 1), 3, 4);
    validate_switch(&battle, &command)?;
    let resolution = resolve_switch(&mut battle, &command, |_, _| ())?;

    assert_eq!(battle.field.slots[0].occupant, Some(pokemon_id(1)));
    assert_eq!(battle.field.slots[1].occupant, Some(pokemon_id(4)));
    assert_eq!(battle.field.slots[2].occupant, Some(pokemon_id(5)));
    assert_eq!(battle.field.slots[3].occupant, Some(pokemon_id(6)));
    assert_eq!(resolution.evidence.slot, slot(BattleSide::Player, 1));
    assert_eq!(resolution.evidence.outgoing, Some(pokemon_id(2)));
    Ok(())
}

#[test]
fn enemy_side_switch_uses_enemy_party_and_no_human_owner() -> TestResult {
    let mut battle = single_battle();
    battle.enemy_party.push(pokemon(7, None));
    let command = switch_command("enemy-switch", 3, slot(BattleSide::Enemy, 0), 1, 7);
    let resolution = resolve_switch(&mut battle, &command, |_, _| ())?;

    assert_eq!(battle.field.slots[0].occupant, Some(pokemon_id(1)));
    assert_eq!(battle.field.slots[1].occupant, Some(pokemon_id(7)));
    assert_eq!(resolution.evidence.slot, slot(BattleSide::Enemy, 0));
    assert_eq!(resolution.evidence.outgoing, Some(pokemon_id(3)));
    Ok(())
}

#[test]
fn post_switch_trigger_observes_occupancy_and_precedes_resolution_return() -> TestResult {
    let mut battle = single_battle();
    let command = switch_command("ordered-switch", 1, slot(BattleSide::Player, 0), 1, 2);
    let mut callback_observed = false;
    let resolution = resolve_switch(&mut battle, &command, |battle, evidence| {
        callback_observed = true;
        assert_eq!(
            battle.field.slots[0].occupant,
            Some(evidence.incoming),
            "trigger must see incoming occupancy installed first"
        );
        assert_eq!(
            evidence.semantic,
            BattlePresentationKind::Switched {
                slot: slot(BattleSide::Player, 0),
                outgoing: Some(pokemon_id(1)),
                incoming: pokemon_id(2),
            }
        );
        evidence.incoming
    })?;

    assert!(callback_observed);
    assert_eq!(resolution.post_switch, pokemon_id(2));
    assert_eq!(resolution.evidence.incoming, pokemon_id(2));
    Ok(())
}
