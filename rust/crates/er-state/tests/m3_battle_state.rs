use std::error::Error;

use er_state::battle::{
    BattleId, BattleOutcome, BattleRngState, BattleState, CommandCollectionState, FaintOccurrence,
    FaintSource, ReplacementProgress, TurnIndex, WaveIndex,
};
use er_state::conditions::{
    AbilitySuppressionSource, ArenaConditionScope, ArenaConditionState,
    GlobalAbilitySuppressionState, TerrainKind, TerrainState, WeatherKind, WeatherState,
    validate_m3_arena_conditions, validate_m3_conditions, validate_m3_global_ability_suppression,
    validate_m3_terrain, validate_m3_weather,
};
use er_state::field::{FieldSlotState, FieldState, FieldStateError};
use er_state::format::{
    BattleFormat, BattleSide, FieldSlot, FormatTopologyError, canonical_slots, human_seats,
    owner_seat_for, validate_m3_supported,
};
use er_types::battle_ids::{ArenaConditionId, AuthorityEpoch, FaintOccurrenceId, PokemonId};
use er_types::{SafeU53, SeatId};

fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(_) => SafeU53::ZERO,
    }
}

fn pokemon(value: u64) -> PokemonId {
    PokemonId::new(safe(value))
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn field_slot(side: BattleSide, position: u8) -> FieldSlot {
    match FieldSlot::new(side, position) {
        Ok(slot) => slot,
        Err(_) => FieldSlot { side, position: 0 },
    }
}

fn empty_field(format: &BattleFormat) -> Result<FieldState, FieldStateError> {
    FieldState::new_for_format(
        format,
        canonical_slots(format)?
            .into_iter()
            .map(|slot| FieldSlotState::new(slot, None))
            .collect(),
    )
}

fn empty_battle_state() -> Result<BattleState, Box<dyn Error>> {
    let turn = TurnIndex::new(safe(1)).map_err(|error| format!("turn: {error}"))?;
    let format = BattleFormat::single();
    Ok(BattleState {
        battle_id: BattleId::new(safe(7)),
        wave: WaveIndex::new(safe(2)).map_err(|error| format!("wave: {error}"))?,
        wave_seed: "m3-wave-seed".to_owned(),
        turn,
        field: empty_field(&format)?,
        format,
        authority_seat: seat(1),
        player_party: Vec::new(),
        enemy_party: Vec::new(),
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
        battle_rng: BattleRngState::new("m3-battle-seed", turn),
        command_state: CommandCollectionState::new(Vec::new(), Vec::new())?,
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::new(safe(0)),
        outcome: BattleOutcome::Ongoing,
    })
}

#[test]
fn battle_state_uses_the_frozen_closed_wire_shape_and_shared_rng_state()
-> Result<(), Box<dyn Error>> {
    let state = empty_battle_state()?;
    let encoded = serde_json::to_value(&state)?;
    let object = encoded
        .as_object()
        .ok_or("battle state must serialize as an object")?;
    let expected_fields = [
        "battle_id",
        "wave",
        "wave_seed",
        "turn",
        "format",
        "authority_seat",
        "player_party",
        "enemy_party",
        "field",
        "weather",
        "terrain",
        "arena_conditions",
        "global_ability_suppression",
        "battle_rng",
        "command_state",
        "faint_queue",
        "next_faint_occurrence",
        "outcome",
    ];
    assert_eq!(object.len(), expected_fields.len());
    assert!(
        expected_fields
            .iter()
            .all(|field| object.contains_key(*field))
    );
    assert_eq!(encoded["wave_seed"], "m3-wave-seed");
    assert_eq!(encoded["battle_rng"]["battle_seed"], "m3-battle-seed");
    assert_eq!(encoded["battle_rng"]["turn"], 1);
    assert_eq!(
        encoded["battle_rng"]["saved_substream"],
        serde_json::Value::Null
    );
    assert_eq!(
        serde_json::from_value::<BattleState>(encoded.clone())?,
        state
    );

    let mut missing_wave_seed = encoded.clone();
    missing_wave_seed
        .as_object_mut()
        .ok_or("battle state must serialize as an object")?
        .remove("wave_seed");
    assert!(serde_json::from_value::<BattleState>(missing_wave_seed).is_err());

    let mut malformed = encoded;
    malformed
        .as_object_mut()
        .ok_or("battle state must serialize as an object")?
        .insert("extra".to_owned(), serde_json::Value::Bool(true));
    assert!(serde_json::from_value::<BattleState>(malformed).is_err());
    Ok(())
}

#[test]
fn field_state_has_exact_closed_json_shape_and_round_trips() -> Result<(), Box<dyn Error>> {
    let state = empty_field(&BattleFormat::single())?;
    let encoded = serde_json::to_string(&state)?;
    assert_eq!(
        encoded,
        r#"{"slots":[{"slot":{"side":"PLAYER","position":0},"occupant":null},{"slot":{"side":"ENEMY","position":0},"occupant":null}]}"#,
    );
    assert_eq!(serde_json::from_str::<FieldState>(&encoded)?, state);
    assert!(serde_json::from_str::<FieldState>(r#"{"slots":[],"extra":true}"#).is_err());
    Ok(())
}

#[test]
fn supported_formats_have_canonical_slot_order_and_exact_closure() -> Result<(), Box<dyn Error>> {
    let singles = BattleFormat::single();
    assert_eq!(
        canonical_slots(&singles)?,
        vec![
            field_slot(BattleSide::Player, 0),
            field_slot(BattleSide::Enemy, 0)
        ]
    );
    assert!(validate_m3_supported(&singles).is_ok());
    assert!(empty_field(&singles).is_ok());

    let doubles = BattleFormat::coop_double();
    assert_eq!(canonical_slots(&doubles)?.len(), 4);
    assert_eq!(
        canonical_slots(&doubles)?.first().copied(),
        Some(field_slot(BattleSide::Player, 0))
    );
    assert_eq!(
        canonical_slots(&doubles)?.get(1).copied(),
        Some(field_slot(BattleSide::Player, 1))
    );
    assert_eq!(
        canonical_slots(&doubles)?.get(2).copied(),
        Some(field_slot(BattleSide::Enemy, 0))
    );
    assert_eq!(
        canonical_slots(&doubles)?.get(3).copied(),
        Some(field_slot(BattleSide::Enemy, 1))
    );
    assert!(validate_m3_supported(&doubles).is_ok());
    assert!(empty_field(&doubles).is_ok());

    let representable_triples = BattleFormat::new(3, 3, Vec::new())?;
    assert_eq!(canonical_slots(&representable_triples)?.len(), 6);
    assert!(validate_m3_supported(&representable_triples).is_err());
    Ok(())
}

#[test]
fn field_state_rejects_duplicate_missing_unsorted_and_duplicate_occupancy()
-> Result<(), Box<dyn Error>> {
    let player_zero = field_slot(BattleSide::Player, 0);
    let enemy_zero = field_slot(BattleSide::Enemy, 0);
    let duplicate_slot = FieldState::new(vec![
        FieldSlotState::new(player_zero, None),
        FieldSlotState::new(player_zero, None),
    ]);
    assert_eq!(
        duplicate_slot,
        Err(FieldStateError::DuplicateSlot { slot: player_zero })
    );

    let unsorted = FieldState::new(vec![
        FieldSlotState::new(enemy_zero, None),
        FieldSlotState::new(player_zero, None),
    ]);
    assert_eq!(unsorted, Err(FieldStateError::UnsortedSlots));

    let duplicate_occupant = FieldState::new(vec![
        FieldSlotState::new(player_zero, Some(pokemon(7))),
        FieldSlotState::new(enemy_zero, Some(pokemon(7))),
    ]);
    assert_eq!(
        duplicate_occupant,
        Err(FieldStateError::DuplicateOccupant {
            pokemon: pokemon(7)
        })
    );

    let missing = FieldState::new_for_format(
        &BattleFormat::single(),
        vec![FieldSlotState::new(player_zero, None)],
    );
    assert_eq!(
        missing,
        Err(FieldStateError::SlotCountMismatch {
            expected: 2,
            actual: 1,
        })
    );

    let wrong_closure = FieldState::new_for_format(
        &BattleFormat::single(),
        vec![
            FieldSlotState::new(player_zero, None),
            FieldSlotState::new(field_slot(BattleSide::Player, 1), None),
        ],
    );
    assert_eq!(
        wrong_closure,
        Err(FieldStateError::SlotClosureMismatch { index: 1 })
    );
    Ok(())
}

#[test]
fn format_helpers_freeze_authority_seats_and_reject_unsupported_topology()
-> Result<(), Box<dyn Error>> {
    let singles = BattleFormat::single();
    assert_eq!(human_seats(&singles)?, vec![seat(1)]);
    assert_eq!(
        owner_seat_for(&singles, field_slot(BattleSide::Player, 0))?,
        Some(seat(1))
    );
    assert_eq!(
        owner_seat_for(&singles, field_slot(BattleSide::Enemy, 0))?,
        None
    );

    let doubles = BattleFormat::coop_double();
    assert_eq!(human_seats(&doubles)?, vec![seat(1), seat(2)]);
    assert_eq!(
        owner_seat_for(&doubles, field_slot(BattleSide::Player, 0))?,
        Some(seat(1))
    );
    assert_eq!(
        owner_seat_for(&doubles, field_slot(BattleSide::Player, 1))?,
        Some(seat(2))
    );
    assert_eq!(
        owner_seat_for(&doubles, field_slot(BattleSide::Enemy, 1))?,
        None
    );

    let triples = BattleFormat::new(3, 3, Vec::new())?;
    assert_eq!(
        human_seats(&triples),
        Err(FormatTopologyError::UnsupportedM3Format {
            player_capacity: 3,
            enemy_capacity: 3,
        })
    );
    Ok(())
}

#[test]
fn positive_coordinates_and_explicit_outcomes_preserve_frozen_wire_values()
-> Result<(), Box<dyn Error>> {
    assert!(serde_json::from_str::<TurnIndex>("0").is_err());
    assert!(serde_json::from_str::<WaveIndex>("0").is_err());
    let turn = TurnIndex::new(safe(1)).map_err(|error| format!("turn: {error}"))?;
    let wave = WaveIndex::new(safe(2)).map_err(|error| format!("wave: {error}"))?;
    assert_eq!(serde_json::to_string(&turn)?, "1");
    assert_eq!(serde_json::to_string(&wave)?, "2");
    assert_eq!(
        serde_json::to_string(&BattleOutcome::Ongoing)?,
        r#""ONGOING""#
    );
    assert_eq!(
        serde_json::to_string(&BattleOutcome::Victory)?,
        r#""VICTORY""#
    );
    assert_eq!(
        serde_json::to_string(&BattleOutcome::Defeat)?,
        r#""DEFEAT""#
    );
    assert_eq!(
        serde_json::from_str::<BattleOutcome>(r#""ONGOING""#)?,
        BattleOutcome::Ongoing
    );
    Ok(())
}

#[test]
fn neutral_conditions_round_trip_and_active_conditions_fail_closed() -> Result<(), Box<dyn Error>> {
    let weather = WeatherState {
        kind: WeatherKind::None,
        remaining_turns: 0,
    };
    let terrain = TerrainState {
        kind: TerrainKind::None,
        remaining_turns: 0,
    };
    let suppression = GlobalAbilitySuppressionState {
        ignore_abilities: false,
        source: None,
    };
    assert_eq!(
        serde_json::to_string(&weather)?,
        r#"{"kind":{"kind":"NONE"},"remaining_turns":0}"#
    );
    assert_eq!(
        serde_json::from_str::<WeatherState>(&serde_json::to_string(&weather)?)?,
        weather
    );
    assert!(validate_m3_conditions(&weather, &terrain, &[], &suppression).is_ok());
    assert!(validate_m3_weather(&weather).is_ok());
    assert!(validate_m3_terrain(&terrain).is_ok());
    assert!(validate_m3_arena_conditions(&[]).is_ok());
    assert!(validate_m3_global_ability_suppression(&suppression).is_ok());

    let active_weather = WeatherState {
        kind: WeatherKind::UnsupportedOracleCode(9),
        remaining_turns: 2,
    };
    assert!(validate_m3_weather(&active_weather).is_err());
    assert_eq!(
        serde_json::from_str::<WeatherState>(&serde_json::to_string(&active_weather)?)?,
        active_weather
    );

    let active_terrain = TerrainState {
        kind: TerrainKind::UnsupportedOracleCode(4),
        remaining_turns: 3,
    };
    assert!(validate_m3_terrain(&active_terrain).is_err());

    let condition = ArenaConditionState {
        condition: ArenaConditionId::new("m3/arena")?,
        scope: ArenaConditionScope::Both,
        turn_count: 1,
        layers: 1,
    };
    let encoded_condition = serde_json::to_string(&condition)?;
    assert_eq!(
        encoded_condition,
        r#"{"condition":"m3/arena","scope":{"kind":"BOTH"},"turn_count":1,"layers":1}"#
    );
    assert_eq!(
        serde_json::from_str::<ArenaConditionState>(&encoded_condition)?,
        condition
    );
    assert!(validate_m3_arena_conditions(std::slice::from_ref(&condition)).is_err());

    let active_suppression = GlobalAbilitySuppressionState {
        ignore_abilities: true,
        source: Some(AbilitySuppressionSource::ArenaIgnoreAbilities),
    };
    assert!(validate_m3_global_ability_suppression(&active_suppression).is_err());
    assert!(validate_m3_conditions(&weather, &terrain, &[condition], &suppression).is_err());
    Ok(())
}

#[test]
fn malformed_identities_and_unknown_condition_fields_are_rejected() -> Result<(), Box<dyn Error>> {
    assert!(serde_json::from_str::<FieldSlot>(r#"{"side":"PLAYER","position":3}"#).is_err());
    assert!(serde_json::from_str::<PokemonId>("9007199254740992").is_err());
    assert!(
        serde_json::from_str::<FieldState>(
            r#"{"slots":[{"slot":{"side":"PLAYER","position":0},"occupant":null,"extra":true}]}"#
        )
        .is_err()
    );
    assert!(
        serde_json::from_str::<WeatherState>(
            r#"{"kind":{"kind":"NONE"},"remaining_turns":0,"extra":true}"#
        )
        .is_err()
    );
    assert!(serde_json::from_str::<ArenaConditionState>(
        r#"{"condition":"m3/arena","scope":{"kind":"BOTH"},"turn_count":1,"layers":1,"extra":true}"#
    )
    .is_err());
    Ok(())
}

#[test]
fn command_collection_and_faint_occurrence_shapes_are_explicit_and_closed()
-> Result<(), Box<dyn Error>> {
    let commands = er_state::battle::CommandCollectionState::new(Vec::new(), Vec::new())?;
    assert_eq!(
        serde_json::to_string(&commands)?,
        r#"{"frontier":[],"tombstones":[]}"#
    );
    assert_eq!(
        serde_json::from_str::<er_state::battle::CommandCollectionState>(&serde_json::to_string(
            &commands
        )?,)?,
        commands
    );

    let occurrence = FaintOccurrence {
        id: FaintOccurrenceId::new(safe(3)),
        source: FaintSource {
            epoch: AuthorityEpoch::new(safe(1)),
            wave: WaveIndex::new(safe(2)).map_err(|error| format!("wave: {error}"))?,
            resolved_turn: TurnIndex::new(safe(4)).map_err(|error| format!("turn: {error}"))?,
            turn_occurrence: 0,
        },
        slot: field_slot(BattleSide::Player, 0),
        pokemon: pokemon(11),
        owner_seat: Some(seat(1)),
        replacement: ReplacementProgress::Pending,
    };
    let encoded = serde_json::to_string(&occurrence)?;
    assert!(encoded.contains(r#""replacement":{"kind":"PENDING"}"#));
    assert_eq!(
        serde_json::from_str::<FaintOccurrence>(&encoded)?,
        occurrence
    );
    let malformed = format!("{},\"extra\":true}}", encoded.trim_end_matches('}'));
    assert!(serde_json::from_str::<FaintOccurrence>(&malformed).is_err());
    Ok(())
}
