use std::error::Error;

use er_canonical::content_digest;
use er_rng::phaser::{PhaserRdg, RunRngState};
use er_state::battle::{
    BattleId, BattleOutcome, BattleRngState, BattleState, CommandCollectionState, FaintOccurrence,
    FaintSource, ReplacementProgress, TurnIndex, WaveIndex,
};
use er_state::conditions::{
    GlobalAbilitySuppressionState, TerrainKind, TerrainState, WeatherKind, WeatherState,
};
use er_state::digest::{
    MECHANICAL_DIGEST_DOMAIN, MECHANICAL_DIGEST_PREFIX, MechanicalDigestError,
    MechanicalStateDigest, compute_mechanical_state_digest,
};
use er_state::field::{FieldSlotState, FieldState};
use er_state::format::{BattleFormat, BattleSide, FieldSlot};
use er_state::pokemon::{
    AbilityId, AbilityLoadout, BattleStats, MoveId, MoveSlotState, PokemonId, PokemonState,
    PokemonType, PokemonTyping, SpeciesId, StatStages, StatusKind, StatusState,
};
use er_state::snapshot::{
    GAME_STATE_SCHEMA_VERSION, GameState, SnapshotError, canonical_game_state_bytes,
    decode_canonical_game_state,
};
use er_state::validation::{
    StateValidationError, validate_battle_state, validate_game_state,
    validate_game_state_for_content,
};
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleCommandOffer, BattleCommandProposalV1,
    BattleTargetSelection, CommandAdmissionSource, CommandFrontierEntry, CommandFrontierStatus,
    OfferedMoveCommand, player_command_operation_id,
};
use er_types::battle_ids::{
    ContentPackHash, FaintOccurrenceId, GameModeId, MenuInstanceId, MoveSlotIndex, PartyIndex,
};
use er_types::{SafeU53, SeatId};

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

fn turn(value: u64) -> Result<TurnIndex, Box<dyn Error>> {
    Ok(TurnIndex::new(safe(value)).map_err(|error| format!("turn: {error}"))?)
}

fn wave(value: u64) -> Result<WaveIndex, Box<dyn Error>> {
    Ok(WaveIndex::new(safe(value)).map_err(|error| format!("wave: {error}"))?)
}

fn pokemon(id: u64, owner: Option<SeatId>, fainted: bool) -> Result<PokemonState, Box<dyn Error>> {
    let hp = if fainted { 0 } else { 100 };
    Ok(PokemonState::new(
        PokemonId::new(safe(id)),
        owner,
        SpeciesId::new(safe(id + 100)),
        0,
        25,
        PokemonTyping {
            primary: PokemonType::Normal,
            secondary: None,
        },
        BattleStats {
            hp: 100,
            attack: 50,
            defense: 50,
            special_attack: 50,
            special_defense: 50,
            speed: 50,
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
        [
            Some(MoveSlotState {
                move_id: MoveId::new(safe(1)),
                pp_used: 0,
                pp_ups: 0,
                max_pp_override: None,
            }),
            None,
            None,
            None,
        ],
        AbilityLoadout {
            active: AbilityId::new(safe(0)),
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        fainted,
    )?)
}

fn content_hash(fill: char) -> Result<ContentPackHash, Box<dyn Error>> {
    Ok(ContentPackHash::new(format!(
        "blake3-v1:{}",
        fill.to_string().repeat(64)
    ))?)
}

fn valid_game() -> Result<GameState, Box<dyn Error>> {
    let format = BattleFormat::single();
    let battle_turn = turn(1)?;
    let player = pokemon(17, Some(seat(1)), false)?;
    let enemy = pokemon(18, None, false)?;
    let field = FieldState::new_for_format(
        &format,
        vec![
            FieldSlotState::new(slot(BattleSide::Player, 0), Some(player.id)),
            FieldSlotState::new(slot(BattleSide::Enemy, 0), Some(enemy.id)),
        ],
    )?;
    let battle = BattleState {
        battle_id: BattleId::new(safe(7)),
        wave: wave(2)?,
        wave_seed: "m3-wave-seed".to_owned(),
        turn: battle_turn,
        format,
        authority_seat: seat(1),
        player_party: vec![player],
        enemy_party: vec![enemy],
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
        battle_rng: BattleRngState::new("m3-battle-seed", battle_turn),
        command_state: CommandCollectionState::new(Vec::new(), Vec::new())?,
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::ZERO,
        outcome: BattleOutcome::Ongoing,
    };
    Ok(GameState::new(
        content_hash('a')?,
        GameModeId::new(safe(1)),
        wave(2)?,
        BattleId::new(safe(8)),
        RunRngState {
            rdg: PhaserRdg::from_seed("m3-run-seed").state(),
        },
        Some(battle),
    )?)
}

#[test]
fn complete_game_state_is_valid_and_round_trips_only_as_canonical_bytes()
-> Result<(), Box<dyn Error>> {
    let state = valid_game()?;
    assert_eq!(state.schema_version, GAME_STATE_SCHEMA_VERSION);
    assert!(validate_game_state(&state).is_ok());

    let bytes = canonical_game_state_bytes(&state)?;
    assert!(bytes.starts_with(br#"{"battle":"#));
    assert_eq!(decode_canonical_game_state(&bytes)?, state);
    assert_eq!(state.canonical_bytes()?, bytes);

    let encoded = serde_json::to_value(&state)?;
    let object = encoded.as_object().ok_or("game state must be an object")?;
    let expected_fields = [
        "schema_version",
        "content_hash",
        "mode",
        "wave",
        "next_battle_id",
        "run_rng",
        "battle",
    ];
    assert_eq!(object.len(), expected_fields.len());
    assert!(
        expected_fields
            .iter()
            .all(|field| object.contains_key(*field))
    );

    let pretty = serde_json::to_vec_pretty(&state)?;
    assert!(matches!(
        decode_canonical_game_state(&pretty),
        Err(SnapshotError::NonCanonicalEncoding)
    ));

    let mut unknown = serde_json::to_value(&state)?;
    unknown
        .as_object_mut()
        .ok_or("game state must be an object")?
        .insert("extra".to_owned(), serde_json::Value::Bool(true));
    assert!(serde_json::from_value::<GameState>(unknown).is_err());
    Ok(())
}

#[test]
fn game_coordinates_allocator_and_rng_turn_must_agree() -> Result<(), Box<dyn Error>> {
    let mut state = valid_game()?;
    state.battle.as_mut().ok_or("missing battle")?.battle_id = BattleId::ZERO;
    state.next_battle_id = BattleId::new(safe(1));
    assert!(matches!(
        validate_game_state(&state),
        Err(StateValidationError::ZeroBattleId)
    ));

    let mut state = valid_game()?;
    state.wave = wave(3)?;
    assert!(matches!(
        validate_game_state(&state),
        Err(StateValidationError::WaveMismatch { .. })
    ));

    let mut state = valid_game()?;
    state.next_battle_id = BattleId::new(safe(9));
    assert!(matches!(
        validate_game_state(&state),
        Err(StateValidationError::NextBattleIdMismatch { .. })
    ));

    let mut state = valid_game()?;
    state
        .battle
        .as_mut()
        .ok_or("missing battle")?
        .battle_rng
        .turn = turn(2)?;
    assert!(matches!(
        validate_game_state(&state),
        Err(StateValidationError::BattleRngTurnMismatch { .. })
    ));

    let mut state = valid_game()?;
    let battle = state.battle.as_mut().ok_or("missing battle")?;
    battle.format = BattleFormat::coop_double();
    battle.player_party.push(pokemon(19, Some(seat(2)), false)?);
    battle.enemy_party.push(pokemon(20, None, false)?);
    battle.field = FieldState::new_for_format(
        &battle.format,
        vec![
            FieldSlotState::new(slot(BattleSide::Player, 0), Some(PokemonId::new(safe(17)))),
            FieldSlotState::new(slot(BattleSide::Player, 1), Some(PokemonId::new(safe(19)))),
            FieldSlotState::new(slot(BattleSide::Enemy, 0), Some(PokemonId::new(safe(18)))),
            FieldSlotState::new(slot(BattleSide::Enemy, 1), Some(PokemonId::new(safe(20)))),
        ],
    )?;
    battle.authority_seat = seat(2);
    assert!(matches!(
        validate_game_state(&state),
        Err(StateValidationError::AuthoritySeatMismatch { .. })
    ));
    Ok(())
}

#[test]
fn party_identity_ownership_field_and_outcome_invariants_fail_closed() -> Result<(), Box<dyn Error>>
{
    let mut state = valid_game()?;
    let player_id = state.battle.as_ref().ok_or("missing battle")?.player_party[0].id;
    state.battle.as_mut().ok_or("missing battle")?.enemy_party[0].id = player_id;
    assert!(matches!(
        validate_game_state(&state),
        Err(StateValidationError::DuplicatePokemonId { .. })
    ));

    let mut state = valid_game()?;
    state.battle.as_mut().ok_or("missing battle")?.player_party[0].owner_seat = None;
    assert!(matches!(
        validate_game_state(&state),
        Err(StateValidationError::InvalidPlayerOwner { .. })
    ));

    let mut state = valid_game()?;
    state.battle.as_mut().ok_or("missing battle")?.field.slots[0].occupant =
        Some(PokemonId::new(safe(999)));
    assert!(matches!(
        validate_game_state(&state),
        Err(StateValidationError::MissingFieldOccupant { .. })
    ));

    let mut state = valid_game()?;
    state.battle.as_mut().ok_or("missing battle")?.outcome = BattleOutcome::Victory;
    assert!(matches!(
        validate_game_state(&state),
        Err(StateValidationError::OutcomeMismatch { .. })
    ));
    Ok(())
}

#[test]
fn command_frontier_is_bound_to_current_actor_owner_and_coordinates() -> Result<(), Box<dyn Error>>
{
    let mut state = valid_game()?;
    let battle = state.battle.as_mut().ok_or("missing battle")?;
    let field_slot = slot(BattleSide::Player, 0);
    let actor = battle.player_party[0].id;
    let operation = player_command_operation_id(
        battle.battle_id,
        battle.wave,
        battle.turn,
        field_slot,
        seat(1),
    )?;
    let offer = BattleCommandOffer::new(
        vec![OfferedMoveCommand::new(
            MoveSlotIndex::new(0)?,
            vec![BattleTargetSelection::implicit()],
        )?],
        Vec::new(),
    )?;
    let entry = CommandFrontierEntry::new(
        operation,
        Some(seat(1)),
        actor,
        field_slot,
        offer,
        CommandFrontierStatus::Pending,
    )?;
    battle.command_state = CommandCollectionState::new(vec![entry], Vec::new())?;
    assert!(validate_game_state(&state).is_ok());

    state
        .battle
        .as_mut()
        .ok_or("missing battle")?
        .command_state
        .frontier[0]
        .actor = PokemonId::new(safe(999));
    assert!(matches!(
        validate_game_state(&state),
        Err(StateValidationError::CommandActorMismatch { .. })
    ));

    let mut state = valid_game()?;
    let battle = state.battle.as_mut().ok_or("missing battle")?;
    let field_slot = slot(BattleSide::Player, 0);
    let actor = battle.player_party[0].id;
    battle.player_party[0].moves[1] = Some(MoveSlotState {
        move_id: MoveId::new(safe(2)),
        pp_used: 0,
        pp_ups: 0,
        max_pp_override: None,
    });
    let operation = player_command_operation_id(
        battle.battle_id,
        battle.wave,
        battle.turn,
        field_slot,
        seat(1),
    )?;
    let offer = BattleCommandOffer::new(
        vec![OfferedMoveCommand::new(
            MoveSlotIndex::new(0)?,
            vec![BattleTargetSelection::implicit()],
        )?],
        Vec::new(),
    )?;
    let proposal = BattleCommandProposalV1::new(
        operation.clone(),
        battle.battle_id,
        battle.wave,
        battle.turn,
        seat(1),
        actor,
        field_slot,
        BattleCommand::fight(
            actor,
            MoveSlotIndex::new(1)?,
            BattleTargetSelection::implicit(),
        )?,
        MenuInstanceId::new(safe(1)),
        "control/m3-validation",
    )?;
    let accepted = AcceptedBattleCommand::human(proposal);
    let entry = CommandFrontierEntry::new(
        operation,
        Some(seat(1)),
        actor,
        field_slot,
        offer,
        CommandFrontierStatus::Admitted {
            command: accepted,
            source: CommandAdmissionSource::AuthorityLocalInternal,
        },
    )?;
    battle.command_state = CommandCollectionState::new(vec![entry], Vec::new())?;
    assert!(matches!(
        validate_game_state(&state),
        Err(StateValidationError::CommandNotOffered { .. })
    ));
    Ok(())
}

#[test]
fn faint_queue_preserves_allocator_causality_and_stored_replacement_truth()
-> Result<(), Box<dyn Error>> {
    let mut state = valid_game()?;
    let battle = state.battle.as_mut().ok_or("missing battle")?;
    battle.player_party[0] = pokemon(17, Some(seat(1)), true)?;
    battle.player_party.push(pokemon(19, Some(seat(1)), false)?);
    battle.faint_queue.push(FaintOccurrence {
        id: FaintOccurrenceId::new(safe(0)),
        source: FaintSource {
            epoch: er_types::battle_ids::AuthorityEpoch::new(safe(1)),
            wave: battle.wave,
            resolved_turn: battle.turn,
            turn_occurrence: 0,
        },
        slot: slot(BattleSide::Player, 0),
        pokemon: PokemonId::new(safe(17)),
        owner_seat: Some(seat(1)),
        replacement: ReplacementProgress::Pending,
    });
    battle.next_faint_occurrence = FaintOccurrenceId::new(safe(1));
    assert!(validate_battle_state(battle).is_ok());

    battle.faint_queue[0].replacement = ReplacementProgress::Applied;
    assert!(matches!(
        validate_battle_state(battle),
        Err(StateValidationError::AppliedFaintStillOccupiesField { .. })
    ));

    battle.faint_queue[0].replacement = ReplacementProgress::Selected {
        party_slot: PartyIndex::new(1)?,
        pokemon: PokemonId::new(safe(19)),
    };
    assert!(validate_battle_state(battle).is_ok());

    battle.faint_queue[0].replacement = ReplacementProgress::NoLegalReplacement;
    assert!(matches!(
        validate_battle_state(battle),
        Err(StateValidationError::InvalidReplacementProgress { .. })
    ));

    let mut state = valid_game()?;
    state.battle.as_mut().ok_or("missing battle")?.player_party[0] =
        pokemon(17, Some(seat(1)), true)?;
    assert!(matches!(
        validate_game_state(&state),
        Err(StateValidationError::FaintedFieldOccupantWithoutQueue { .. })
    ));
    Ok(())
}

#[test]
fn pending_last_player_faint_defers_defeat_until_replacement_applies() -> Result<(), Box<dyn Error>>
{
    let mut state = valid_game()?;
    let battle = state.battle.as_mut().ok_or("missing battle")?;
    battle.player_party[0] = pokemon(17, Some(seat(1)), true)?;
    battle.faint_queue.push(FaintOccurrence {
        id: FaintOccurrenceId::ZERO,
        source: FaintSource {
            epoch: er_types::battle_ids::AuthorityEpoch::new(safe(1)),
            wave: battle.wave,
            resolved_turn: battle.turn,
            turn_occurrence: 0,
        },
        slot: slot(BattleSide::Player, 0),
        pokemon: PokemonId::new(safe(17)),
        owner_seat: Some(seat(1)),
        replacement: ReplacementProgress::Pending,
    });
    battle.next_faint_occurrence = FaintOccurrenceId::new(safe(1));
    assert_eq!(battle.outcome, BattleOutcome::Ongoing);
    assert!(validate_battle_state(battle).is_ok());

    battle.outcome = BattleOutcome::Defeat;
    assert!(matches!(
        validate_battle_state(battle),
        Err(StateValidationError::OutcomeMismatch { .. })
    ));

    battle.faint_queue[0].replacement = ReplacementProgress::Applied;
    battle.field.slots[0].occupant = None;
    assert!(validate_battle_state(battle).is_ok());
    Ok(())
}

#[test]
fn faint_queue_rejects_noncanonical_authority_and_unresolved_subjects() -> Result<(), Box<dyn Error>>
{
    let mut state = valid_game()?;
    let battle = state.battle.as_mut().ok_or("missing battle")?;
    battle.player_party[0] = pokemon(17, Some(seat(1)), true)?;
    battle.player_party.push(pokemon(19, Some(seat(1)), false)?);
    battle.faint_queue.push(FaintOccurrence {
        id: FaintOccurrenceId::ZERO,
        source: FaintSource {
            epoch: er_types::battle_ids::AuthorityEpoch::ZERO,
            wave: battle.wave,
            resolved_turn: battle.turn,
            turn_occurrence: 0,
        },
        slot: slot(BattleSide::Player, 0),
        pokemon: PokemonId::new(safe(17)),
        owner_seat: Some(seat(1)),
        replacement: ReplacementProgress::Pending,
    });
    battle.next_faint_occurrence = FaintOccurrenceId::new(safe(1));
    assert!(matches!(
        validate_battle_state(battle),
        Err(StateValidationError::ZeroFaintAuthorityEpoch { .. })
    ));

    battle.faint_queue[0].source.epoch = er_types::battle_ids::AuthorityEpoch::new(safe(1));
    battle.faint_queue[0].replacement = ReplacementProgress::NotRequired;
    assert!(matches!(
        validate_battle_state(battle),
        Err(StateValidationError::InvalidReplacementProgress { .. })
    ));

    battle.faint_queue[0].replacement = ReplacementProgress::Pending;
    let mut duplicate = battle.faint_queue[0];
    duplicate.id = FaintOccurrenceId::new(safe(1));
    duplicate.source.turn_occurrence = 1;
    battle.faint_queue.push(duplicate);
    battle.next_faint_occurrence = FaintOccurrenceId::new(safe(2));
    assert!(matches!(
        validate_battle_state(battle),
        Err(StateValidationError::DuplicateUnresolvedFaint { .. })
    ));
    Ok(())
}

#[test]
fn mechanical_digest_is_strict_domain_separated_and_state_complete() -> Result<(), Box<dyn Error>> {
    let state = valid_game()?;
    let digest = compute_mechanical_state_digest(&state)?;
    assert!(digest.as_str().starts_with(MECHANICAL_DIGEST_PREFIX));
    assert_eq!(digest.as_str().len(), MECHANICAL_DIGEST_PREFIX.len() + 64);
    assert_eq!(MechanicalStateDigest::compute(&state)?, digest);
    assert!(digest.verify(&state).is_ok());

    let expected_preimage = serde_json::json!({
        "domain": MECHANICAL_DIGEST_DOMAIN,
        "state": &state,
    });
    assert_eq!(
        digest.as_str(),
        format!(
            "{MECHANICAL_DIGEST_PREFIX}{}",
            content_digest(&expected_preimage)?
        )
    );
    assert_eq!(
        serde_json::from_str::<MechanicalStateDigest>(&serde_json::to_string(&digest)?)?,
        digest
    );

    let mut changed = state.clone();
    changed.mode = GameModeId::new(safe(2));
    let changed_digest = MechanicalStateDigest::compute(&changed)?;
    assert_ne!(changed_digest, digest);
    assert!(matches!(
        digest.verify(&changed),
        Err(MechanicalDigestError::Mismatch { .. })
    ));

    assert!(MechanicalStateDigest::new("bad").is_err());
    assert!(
        MechanicalStateDigest::new(format!("{MECHANICAL_DIGEST_PREFIX}{}", "A".repeat(64)))
            .is_err()
    );
    Ok(())
}

#[test]
fn explicit_content_identity_check_rejects_the_wrong_pack() -> Result<(), Box<dyn Error>> {
    let state = valid_game()?;
    assert!(validate_game_state_for_content(&state, &state.content_hash).is_ok());
    assert!(matches!(
        validate_game_state_for_content(&state, &content_hash('b')?),
        Err(StateValidationError::ContentHashMismatch { .. })
    ));
    Ok(())
}
