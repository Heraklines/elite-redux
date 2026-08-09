use std::error::Error;

use er_state::pokemon::SeatId;
use er_state::pokemon::{
    AbilityId, AbilityLoadout, AbilityLoadoutValidationError, BattleStat, BattleStats, MoveId,
    MoveSlotState, MoveSlotsValidationError, PokemonId, PokemonState, PokemonType, PokemonTyping,
    PpValidationError, SpeciesId, StatStages, StatStagesValidationError, StatusKind, StatusState,
    StatusValidationError, TypingPosition, TypingValidationError, calculate_max_pp,
    move_slot_is_usable, normalize_max_pp_override, validate_ability_loadout,
    validate_m3_status_state, validate_m3_typing, validate_move_slot, validate_move_slot_metadata,
    validate_move_slots, validate_stat_stages, validate_status_state, validate_typing,
};
use er_types::SafeU53;

fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(_) => SafeU53::ZERO,
    }
}

fn valid_moves() -> [Option<MoveSlotState>; 4] {
    [
        Some(MoveSlotState {
            move_id: MoveId::new(safe(1)),
            pp_used: 0,
            pp_ups: 0,
            max_pp_override: None,
        }),
        Some(MoveSlotState {
            move_id: MoveId::new(safe(52)),
            pp_used: 0,
            pp_ups: 0,
            max_pp_override: None,
        }),
        Some(MoveSlotState {
            move_id: MoveId::new(safe(351)),
            pp_used: 0,
            pp_ups: 0,
            max_pp_override: None,
        }),
        Some(MoveSlotState {
            move_id: MoveId::new(safe(589)),
            pp_used: 0,
            pp_ups: 0,
            max_pp_override: None,
        }),
    ]
}

fn valid_stages() -> StatStages {
    StatStages {
        attack: 0,
        defense: 0,
        special_attack: 0,
        special_defense: 0,
        speed: 0,
        accuracy: 0,
        evasion: 0,
    }
}

fn valid_abilities() -> AbilityLoadout {
    AbilityLoadout {
        active: AbilityId::new(safe(0)),
        passives: [None, None, None],
        active_suppressed: false,
        passive_suppressed: [false, false, false],
    }
}

fn valid_state() -> Result<PokemonState, er_state::pokemon::PokemonStateError> {
    PokemonState::new(
        PokemonId::new(safe(17)),
        Some(SeatId::new(safe(1))),
        SpeciesId::new(safe(19)),
        0,
        25,
        PokemonTyping {
            primary: PokemonType::Normal,
            secondary: None,
        },
        BattleStats {
            hp: 100,
            attack: 56,
            defense: 35,
            special_attack: 25,
            special_defense: 35,
            speed: 72,
        },
        100,
        100,
        StatusState {
            kind: StatusKind::None,
            toxic_turn_count: 0,
            sleep_turns_remaining: None,
        },
        valid_stages(),
        valid_moves(),
        valid_abilities(),
        false,
    )
}

#[test]
fn canonical_state_round_trips_and_rejects_unknown_fields() -> Result<(), Box<dyn Error>> {
    let state = valid_state()?;
    assert_eq!(state.id, PokemonId::new(safe(17)));
    assert_eq!(state.owner_seat, Some(SeatId::new(safe(1))));
    assert!(
        state
            .validate_with_base_pps([Some(35), Some(20), Some(15), Some(20)])
            .is_ok()
    );

    let encoded = serde_json::to_string(&state)?;
    assert!(encoded.contains(r#""owner_seat":1"#));
    assert!(encoded.contains(r#""moves":[{"#));
    let decoded: PokemonState = serde_json::from_str(&encoded)?;
    assert_eq!(decoded, state);

    let mut unknown = serde_json::to_value(&state)?;
    if let Some(object) = unknown.as_object_mut() {
        object.insert("extra".to_owned(), serde_json::Value::Bool(true));
    }
    assert!(serde_json::from_value::<PokemonState>(unknown).is_err());

    let mut wrong_move_count = serde_json::to_value(&state)?;
    if let Some(object) = wrong_move_count.as_object_mut() {
        object.insert("moves".to_owned(), serde_json::json!([]));
    }
    assert!(serde_json::from_value::<PokemonState>(wrong_move_count).is_err());
    Ok(())
}

#[test]
fn typing_accepts_one_or_two_distinct_types_and_rejects_deferred_stellar_in_m3() {
    let one = PokemonTyping {
        primary: PokemonType::Water,
        secondary: None,
    };
    let two = PokemonTyping {
        primary: PokemonType::Grass,
        secondary: Some(PokemonType::Poison),
    };
    assert!(validate_typing(&one).is_ok());
    assert!(validate_m3_typing(&one).is_ok());
    assert!(validate_typing(&two).is_ok());
    assert!(validate_m3_typing(&two).is_ok());

    let duplicate = PokemonTyping {
        primary: PokemonType::Normal,
        secondary: Some(PokemonType::Normal),
    };
    assert_eq!(
        validate_typing(&duplicate),
        Err(TypingValidationError::DuplicateType {
            pokemon_type: PokemonType::Normal,
        })
    );

    let stellar = PokemonTyping {
        primary: PokemonType::Stellar,
        secondary: None,
    };
    assert!(validate_typing(&stellar).is_ok());
    assert_eq!(
        validate_m3_typing(&stellar),
        Err(TypingValidationError::StellarUnsupported {
            position: TypingPosition::Primary,
        })
    );
}

#[test]
fn stats_hp_faint_and_stage_boundaries_are_strict() -> Result<(), Box<dyn Error>> {
    let mut state = valid_state()?;
    state.stat_stages.attack = -6;
    state.stat_stages.evasion = 6;
    assert!(state.validate().is_ok());

    state.stat_stages.attack = 7;
    assert_eq!(
        validate_stat_stages(&state.stat_stages),
        Err(StatStagesValidationError::OutOfRange {
            stat: BattleStat::Attack,
            value: 7,
            min: -6,
            max: 6,
        })
    );

    state.stat_stages = valid_stages();
    state.hp = 101;
    assert!(state.validate().is_err());

    state.hp = 0;
    state.fainted = false;
    assert!(state.validate().is_err());

    state.fainted = true;
    assert!(state.validate().is_ok());

    state.max_hp = 0;
    assert!(state.validate().is_err());
    Ok(())
}

#[test]
fn status_companions_are_preserved_but_unsupported_m3_mechanics_fail_closed() {
    let burn = StatusState {
        kind: StatusKind::Burn,
        toxic_turn_count: u16::MAX,
        sleep_turns_remaining: None,
    };
    assert!(validate_status_state(&burn).is_ok());
    assert!(validate_m3_status_state(&burn).is_ok());

    let none_with_toxic = StatusState {
        kind: StatusKind::None,
        toxic_turn_count: 1,
        sleep_turns_remaining: None,
    };
    assert_eq!(
        validate_status_state(&none_with_toxic),
        Err(StatusValidationError::ToxicTurnCountNotZero {
            kind: StatusKind::None,
            value: 1,
        })
    );

    let paralysis_with_sleep = StatusState {
        kind: StatusKind::Paralysis,
        toxic_turn_count: 0,
        sleep_turns_remaining: Some(2),
    };
    assert_eq!(
        validate_status_state(&paralysis_with_sleep),
        Err(StatusValidationError::SleepSubstateNotAllowed {
            kind: StatusKind::Paralysis,
        })
    );

    let toxic = StatusState {
        kind: StatusKind::Toxic,
        toxic_turn_count: 3,
        sleep_turns_remaining: None,
    };
    assert!(validate_status_state(&toxic).is_ok());
    assert_eq!(
        validate_m3_status_state(&toxic),
        Err(StatusValidationError::UnsupportedStatus {
            kind: StatusKind::Toxic,
        })
    );

    let sleep = StatusState {
        kind: StatusKind::Sleep,
        toxic_turn_count: 0,
        sleep_turns_remaining: Some(2),
    };
    assert!(validate_status_state(&sleep).is_ok());
    assert!(validate_m3_status_state(&sleep).is_err());
}

#[test]
fn ability_layout_has_three_ordered_passives_and_explicit_suppression_flags() {
    let mut abilities = valid_abilities();
    abilities.passives[1] = Some(AbilityId::new(safe(25)));
    assert!(validate_ability_loadout(&abilities).is_ok());

    abilities.passive_suppressed[1] = true;
    assert!(validate_ability_loadout(&abilities).is_ok());

    abilities.passives[1] = None;
    assert_eq!(
        validate_ability_loadout(&abilities),
        Err(AbilityLoadoutValidationError::EmptyPassiveSuppressed { slot: 1 })
    );

    abilities.passives[1] = Some(AbilityId::new(safe(25)));
    assert!(abilities.passive_suppressed[1]);
    assert!(
        er_state::pokemon::validate_m3_ability_loadout(&abilities).is_err(),
        "selected M3 policy rejects structural suppression"
    );
}

#[test]
fn pp_formula_metadata_override_and_usability_match_the_pinned_rules() {
    assert_eq!(calculate_max_pp(20, 0, None).ok(), Some(20));
    assert_eq!(calculate_max_pp(20, 3, None).ok(), Some(32));
    assert_eq!(calculate_max_pp(35, 3, None).ok(), Some(56));
    assert_eq!(calculate_max_pp(20, 3, Some(40)).ok(), Some(40));
    assert_eq!(calculate_max_pp(20, 0, Some(0)).ok(), Some(20));
    assert_eq!(normalize_max_pp_override(Some(0)), None);
    assert_eq!(normalize_max_pp_override(Some(17)), Some(17));

    let mut slot = MoveSlotState {
        move_id: MoveId::new(safe(1)),
        pp_used: 32,
        pp_ups: 3,
        max_pp_override: None,
    };
    assert_eq!(validate_move_slot(&slot, 20).ok(), Some(32));
    assert_eq!(move_slot_is_usable(&slot, 20).ok(), Some(false));

    slot.pp_used = 33;
    assert_eq!(
        validate_move_slot(&slot, 20),
        Err(PpValidationError::PpUsedExceedsMaximum {
            pp_used: 33,
            max_pp: 32,
        })
    );
    assert_eq!(
        validate_move_slot_metadata(&MoveSlotState { pp_ups: 4, ..slot }),
        Err(PpValidationError::PpUpsOutOfRange { value: 4 })
    );
    assert_eq!(
        validate_move_slot_metadata(&MoveSlotState {
            max_pp_override: Some(0),
            ..slot
        }),
        Err(PpValidationError::ZeroMaxPpOverride)
    );
    assert_eq!(
        calculate_max_pp(0, 0, None),
        Err(PpValidationError::ZeroBasePp)
    );
    assert_eq!(
        calculate_max_pp(u16::MAX, 1, None),
        Err(PpValidationError::MaximumPpOverflow)
    );
}

#[test]
fn fixed_move_slots_require_content_resolved_pp_for_occupied_slots() -> Result<(), Box<dyn Error>> {
    let state = valid_state()?;
    assert!(validate_move_slots(&state.moves, [Some(35), Some(20), Some(15), Some(20)]).is_ok());

    let mut missing = [None, None, None, None];
    missing[0] = state.moves[0];
    assert_eq!(
        validate_move_slots(&missing, [None, None, None, None]),
        Err(MoveSlotsValidationError::MissingBasePp { slot: 0 })
    );
    assert_eq!(
        validate_move_slots(&[None, None, None, None], [Some(35), None, None, None]),
        Err(MoveSlotsValidationError::UnexpectedBasePp { slot: 0 })
    );

    let mut overused = state;
    if let Some(move_slot) = overused.moves[0].as_mut() {
        move_slot.pp_used = 36;
    }
    assert!(
        overused
            .validate_with_base_pps([Some(35), Some(20), Some(15), Some(20)])
            .is_err()
    );
    Ok(())
}

#[test]
fn representable_state_keeps_deferred_status() -> Result<(), Box<dyn Error>> {
    let mut state = valid_state()?;
    state.status = StatusState {
        kind: StatusKind::Sleep,
        toxic_turn_count: 0,
        sleep_turns_remaining: Some(2),
    };
    assert!(state.validate_representable().is_ok());
    assert!(state.validate().is_err());
    Ok(())
}
