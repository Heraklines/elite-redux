use std::error::Error;

use er_battle::faint::{
    FaintCandidate, FaintQueueError, queue_faint, queue_faint_request, queue_faint_with_source,
    queue_faints,
};
use er_battle::move_effect::FaintRequest;
use er_battle::replacement::{
    ReplacementError, advance_replacement_progress, apply_selected_replacement,
    compute_replacement_progress, resolve_no_legal_replacement, resolve_not_required,
    stored_faint_source, validate_stored_replacement_operation,
};
use er_battle::resolver::BattleMutation;
use er_state::battle::{BattleOutcome, BattleRngState, BattleState, CommandCollectionState};
use er_state::conditions::{
    GlobalAbilitySuppressionState, TerrainKind, TerrainState, WeatherKind, WeatherState,
};
use er_state::field::{FieldSlotState, FieldState};
use er_state::format::BattleFormat;
use er_state::pokemon::{AbilityLoadout, BattleStats, PokemonState, StatStages, StatusState};
use er_types::battle_command::{ReplacementSelection, replacement_operation_id};
use er_types::battle_ids::{
    AbilityId, AuthorityEpoch, BattleId, BattleSide, FaintOccurrenceId, FieldSlot, MoveId,
    PartyIndex, PokemonId, SpeciesId, TurnIndex, WaveIndex,
};
use er_types::battle_model::{
    FaintSource, PokemonType, PokemonTyping, ReplacementProgress, StatusKind,
};
use er_types::{OperationId, SafeU53, SeatId};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn safe(value: u64) -> TestResult<SafeU53> {
    Ok(SafeU53::new(value)?)
}

fn pokemon_id(value: u64) -> TestResult<PokemonId> {
    Ok(PokemonId::new(safe(value)?))
}

fn seat(value: u64) -> TestResult<SeatId> {
    Ok(SeatId::new(safe(value)?))
}

fn slot(side: BattleSide, position: u8) -> TestResult<FieldSlot> {
    Ok(FieldSlot::new(side, position)?)
}

fn fainted_pokemon(id: u64, owner_seat: Option<SeatId>) -> TestResult<PokemonState> {
    pokemon(id, owner_seat, false)
}

fn living_pokemon(id: u64, owner_seat: Option<SeatId>) -> TestResult<PokemonState> {
    pokemon(id, owner_seat, true)
}

fn pokemon(id: u64, owner_seat: Option<SeatId>, living: bool) -> TestResult<PokemonState> {
    let (hp, fainted) = if living { (100, false) } else { (0, true) };
    Ok(PokemonState::new(
        pokemon_id(id)?,
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
        [None, None, None, None],
        AbilityLoadout {
            active: AbilityId::ZERO,
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        fainted,
    )?)
}

fn battle(
    format: BattleFormat,
    player_party: Vec<PokemonState>,
    enemy_party: Vec<PokemonState>,
    occupants: Vec<Option<PokemonId>>,
) -> TestResult<BattleState> {
    let slots = match (format.player_capacity, format.enemy_capacity) {
        (1, 1) => vec![slot(BattleSide::Player, 0)?, slot(BattleSide::Enemy, 0)?],
        (2, 2) => vec![
            slot(BattleSide::Player, 0)?,
            slot(BattleSide::Player, 1)?,
            slot(BattleSide::Enemy, 0)?,
            slot(BattleSide::Enemy, 1)?,
        ],
        _ => return Err("test only uses the selected M3 topologies".into()),
    };
    if slots.len() != occupants.len() {
        return Err("test field occupancy does not match format".into());
    }
    let turn = TurnIndex::new(safe(1)?)?;
    let wave = WaveIndex::new(safe(1)?)?;
    Ok(BattleState {
        battle_id: BattleId::new(safe(1)?),
        wave,
        wave_seed: "m3-faint-replacement-test".to_owned(),
        turn,
        format: format.clone(),
        authority_seat: seat(1)?,
        player_party,
        enemy_party,
        field: FieldState::new_for_format(
            &format,
            slots
                .into_iter()
                .zip(occupants)
                .map(|(field_slot, occupant)| FieldSlotState::new(field_slot, occupant))
                .collect(),
        )?,
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
        battle_rng: BattleRngState::new("m3-faint-replacement-test", turn),
        command_state: CommandCollectionState::new(Vec::new(), Vec::new())?,
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::ZERO,
        outcome: BattleOutcome::Ongoing,
    })
}

fn single_with_reserve() -> TestResult<BattleState> {
    battle(
        BattleFormat::single(),
        vec![
            fainted_pokemon(1, Some(seat(1)?))?,
            living_pokemon(2, Some(seat(1)?))?,
        ],
        vec![living_pokemon(3, None)?],
        vec![Some(pokemon_id(1)?), Some(pokemon_id(3)?)],
    )
}

fn single_without_reserve() -> TestResult<BattleState> {
    battle(
        BattleFormat::single(),
        vec![fainted_pokemon(1, Some(seat(1)?))?],
        vec![living_pokemon(3, None)?],
        vec![Some(pokemon_id(1)?), Some(pokemon_id(3)?)],
    )
}

fn double_all_fainted() -> TestResult<BattleState> {
    battle(
        BattleFormat::coop_double(),
        vec![
            fainted_pokemon(1, Some(seat(1)?))?,
            fainted_pokemon(2, Some(seat(2)?))?,
        ],
        vec![fainted_pokemon(3, None)?, fainted_pokemon(4, None)?],
        vec![
            Some(pokemon_id(1)?),
            Some(pokemon_id(2)?),
            Some(pokemon_id(3)?),
            Some(pokemon_id(4)?),
        ],
    )
}

fn candidate(side: BattleSide, position: u8, pokemon: u64) -> TestResult<FaintCandidate> {
    Ok(FaintCandidate::new(
        pokemon_id(pokemon)?,
        slot(side, position)?,
    ))
}

fn epoch(value: u64) -> TestResult<AuthorityEpoch> {
    Ok(AuthorityEpoch::new(safe(value)?))
}

#[test]
fn candidate_adapter_and_checked_queue_allocation_are_atomic() -> TestResult {
    let mut battle = single_with_reserve()?;
    let request = FaintRequest {
        pokemon: pokemon_id(1)?,
        slot: slot(BattleSide::Player, 0)?,
        source: pokemon_id(3)?,
        move_id: MoveId::ZERO,
    };
    let adapted = FaintCandidate::from(&request);
    assert_eq!(
        queue_faint_request(&mut battle, &request, epoch(17)?, 7)?.occurrence,
        battle.faint_queue[0]
    );
    assert_eq!(adapted.pokemon, battle.faint_queue[0].pokemon);
    assert_eq!(adapted.slot, battle.faint_queue[0].slot);
    assert_eq!(battle.faint_queue[0].source.epoch, epoch(17)?);
    assert_eq!(battle.faint_queue[0].source.turn_occurrence, 7);
    assert_eq!(
        battle.faint_queue[0].replacement,
        ReplacementProgress::Pending
    );
    assert_eq!(battle.faint_queue[0].id, FaintOccurrenceId::ZERO);
    assert_eq!(
        battle.next_faint_occurrence,
        FaintOccurrenceId::new(safe(1)?)
    );
    assert_eq!(
        battle
            .field
            .occupant(&battle.format, slot(BattleSide::Player, 0)?)?,
        Some(pokemon_id(1)?)
    );

    let before_duplicate = battle.clone();
    assert!(matches!(
        queue_faint(&mut battle, adapted, epoch(17)?, 8,),
        Err(FaintQueueError::CandidateAlreadyQueued { .. })
    ));
    assert_eq!(battle, before_duplicate);

    let mut exhausted = single_with_reserve()?;
    exhausted.next_faint_occurrence = FaintOccurrenceId::new(SafeU53::MAX);
    let before_exhausted = exhausted.clone();
    assert!(matches!(
        queue_faint(&mut exhausted, adapted, epoch(17)?, 7,),
        Err(FaintQueueError::OccurrenceAllocatorExhausted { .. })
    ));
    assert_eq!(exhausted, before_exhausted);

    let mut turn_overflow = double_all_fainted()?;
    let before_turn_overflow = turn_overflow.clone();
    let batch = vec![
        candidate(BattleSide::Player, 0, 1)?,
        candidate(BattleSide::Player, 1, 2)?,
    ];
    assert!(matches!(
        queue_faints(&mut turn_overflow, &batch, epoch(17)?, u32::MAX),
        Err(FaintQueueError::TurnOccurrenceOverflow)
    ));
    assert_eq!(turn_overflow, before_turn_overflow);

    let mut zero_epoch = single_with_reserve()?;
    let before_zero_epoch = zero_epoch.clone();
    assert!(matches!(
        queue_faint(&mut zero_epoch, adapted, AuthorityEpoch::ZERO, 7,),
        Err(FaintQueueError::ZeroAuthorityEpoch)
    ));
    assert_eq!(zero_epoch, before_zero_epoch);
    Ok(())
}

#[test]
fn malformed_duplicate_unresolved_queue_subject_is_rejected_atomically() -> TestResult {
    let mut battle = single_with_reserve()?;
    let target = candidate(BattleSide::Player, 0, 1)?;
    queue_faint(&mut battle, target, epoch(17)?, 7)?;

    let mut duplicate = battle.faint_queue[0];
    duplicate.id = FaintOccurrenceId::new(safe(1)?);
    duplicate.source.turn_occurrence = 8;
    battle.faint_queue.push(duplicate);
    battle.next_faint_occurrence = FaintOccurrenceId::new(safe(2)?);

    let before = battle.clone();
    assert!(matches!(
        queue_faint(&mut battle, target, epoch(17)?, 9),
        Err(FaintQueueError::DuplicateQueueSubject { .. })
    ));
    assert_eq!(battle, before);
    Ok(())
}

#[test]
fn candidate_validation_rejects_duplicate_nonzero_and_nonfainted_without_mutation() -> TestResult {
    let mut duplicate = single_with_reserve()?;
    let duplicate_actor = duplicate.player_party[0].clone();
    duplicate.player_party.push(duplicate_actor);
    let before_duplicate = duplicate.clone();
    assert!(matches!(
        queue_faint(
            &mut duplicate,
            candidate(BattleSide::Player, 0, 1)?,
            epoch(1)?,
            0,
        ),
        Err(FaintQueueError::CandidatePartyDuplicate { .. })
    ));
    assert_eq!(duplicate, before_duplicate);

    let mut nonzero = single_with_reserve()?;
    nonzero.player_party[0].hp = 1;
    nonzero.player_party[0].fainted = false;
    let before_nonzero = nonzero.clone();
    assert!(matches!(
        queue_faint(
            &mut nonzero,
            candidate(BattleSide::Player, 0, 1)?,
            epoch(1)?,
            0,
        ),
        Err(FaintQueueError::CandidateHpNonZero { .. })
    ));
    assert_eq!(nonzero, before_nonzero);

    let mut nonfainted = single_with_reserve()?;
    nonfainted.player_party[0].fainted = false;
    let before_nonfainted = nonfainted.clone();
    assert!(matches!(
        queue_faint(
            &mut nonfainted,
            candidate(BattleSide::Player, 0, 1)?,
            epoch(1)?,
            0,
        ),
        Err(FaintQueueError::CandidateNotFainted { .. })
    ));
    assert_eq!(nonfainted, before_nonfainted);

    let mut residual = single_without_reserve()?;
    let residual_source = FaintSource {
        epoch: epoch(22)?,
        wave: residual.wave,
        resolved_turn: residual.turn,
        turn_occurrence: 33,
    };
    let residual_result = queue_faint_with_source(
        &mut residual,
        candidate(BattleSide::Player, 0, 1)?,
        residual_source,
    )?;
    assert_eq!(residual_result.occurrence.source, residual_source);
    Ok(())
}

#[test]
fn supplied_same_and_mixed_side_order_is_causal_and_turn_identity_is_separate() -> TestResult {
    let mut battle = double_all_fainted()?;
    let supplied = vec![
        candidate(BattleSide::Enemy, 1, 4)?,
        candidate(BattleSide::Player, 0, 1)?,
        candidate(BattleSide::Enemy, 0, 3)?,
        candidate(BattleSide::Player, 1, 2)?,
    ];
    let results = queue_faints(&mut battle, &supplied, epoch(9)?, 12)?;
    assert_eq!(
        results
            .iter()
            .map(|result| result.occurrence.pokemon)
            .collect::<Vec<_>>(),
        supplied.iter().map(|item| item.pokemon).collect::<Vec<_>>()
    );
    assert_eq!(
        battle
            .faint_queue
            .iter()
            .map(|occurrence| occurrence.source.turn_occurrence)
            .collect::<Vec<_>>(),
        vec![12, 13, 14, 15]
    );
    assert_eq!(
        battle
            .faint_queue
            .iter()
            .map(|occurrence| occurrence.id)
            .collect::<Vec<_>>(),
        vec![
            FaintOccurrenceId::new(safe(0)?),
            FaintOccurrenceId::new(safe(1)?),
            FaintOccurrenceId::new(safe(2)?),
            FaintOccurrenceId::new(safe(3)?),
        ]
    );

    let mut noncontiguous = double_all_fainted()?;
    queue_faint(
        &mut noncontiguous,
        candidate(BattleSide::Player, 1, 2)?,
        epoch(9)?,
        2,
    )?;
    queue_faint(
        &mut noncontiguous,
        candidate(BattleSide::Enemy, 0, 3)?,
        epoch(9)?,
        10,
    )?;
    assert_eq!(
        noncontiguous
            .faint_queue
            .iter()
            .map(|occurrence| occurrence.source.turn_occurrence)
            .collect::<Vec<_>>(),
        vec![2, 10]
    );
    assert_eq!(
        noncontiguous
            .faint_queue
            .iter()
            .map(|occurrence| occurrence.id)
            .collect::<Vec<_>>(),
        vec![
            FaintOccurrenceId::new(safe(0)?),
            FaintOccurrenceId::new(safe(1)?)
        ]
    );
    Ok(())
}

#[test]
fn selected_replacement_uses_head_source_and_preserves_tail_and_rng() -> TestResult {
    let mut battle = single_with_reserve()?;
    let player_candidate = candidate(BattleSide::Player, 0, 1)?;
    queue_faint(&mut battle, player_candidate, epoch(17)?, 9)?;
    battle.enemy_party[0].hp = 0;
    battle.enemy_party[0].fainted = true;
    let enemy_candidate = candidate(BattleSide::Enemy, 0, 3)?;
    queue_faint(&mut battle, enemy_candidate, epoch(17)?, 10)?;

    let head = battle.faint_queue[0];
    let tail = battle.faint_queue[1];
    let stored = stored_faint_source(&battle, head.id)?;
    assert_eq!(stored.occurrence, head.id);
    assert_eq!(stored.actor, head.pokemon);
    assert_eq!(stored.field_slot, head.slot);
    assert_eq!(stored.owner_seat, Some(seat(1)?));
    assert_eq!(stored.replacement, ReplacementProgress::Pending);
    assert_eq!(stored.source.turn_occurrence, 9);

    let operation = replacement_operation_id(
        stored.source.epoch,
        battle.battle_id,
        stored.source.wave,
        stored.source.resolved_turn,
        stored.source.turn_occurrence,
        stored.field_slot,
        stored.owner_seat.ok_or("stored player owner missing")?,
    )?;
    assert_eq!(operation.as_str(), "RC/e17/b1/w1/t1/o9/f0/s1");
    validate_stored_replacement_operation(&operation, battle.battle_id, stored)?;
    let wrong_operation = OperationId::new("RC/e17/b1/w1/t1/o0/f0/s1")?;
    assert!(matches!(
        validate_stored_replacement_operation(&wrong_operation, battle.battle_id, stored),
        Err(ReplacementError::Operation(_))
    ));

    let rng_before = battle.battle_rng.clone();
    let selection = ReplacementSelection::selected(PartyIndex::new(1)?, pokemon_id(2)?);
    let result = apply_selected_replacement(&mut battle, head.id, &selection)?;
    assert_eq!(result.occurrence.replacement, ReplacementProgress::Applied);
    assert_eq!(result.selection, selection);
    assert_eq!(battle.battle_rng, rng_before);
    assert_eq!(
        battle.faint_queue[0].replacement,
        ReplacementProgress::Applied
    );
    assert_eq!(battle.faint_queue[1], tail);
    assert_eq!(
        battle.field.occupant(&battle.format, head.slot)?,
        Some(pokemon_id(2)?)
    );
    assert_eq!(
        result.mutations,
        vec![
            BattleMutation::FaintProgressChanged {
                occurrence: head.id,
                before: ReplacementProgress::Pending,
                after: ReplacementProgress::Selected {
                    party_slot: PartyIndex::new(1)?,
                    pokemon: pokemon_id(2)?,
                },
            },
            BattleMutation::FieldChanged {
                slot: head.slot,
                before: Some(pokemon_id(1)?),
                after: Some(pokemon_id(2)?),
            },
            BattleMutation::FaintResolved {
                occurrence: head.id
            },
        ]
    );
    Ok(())
}

#[test]
fn stale_nonhead_and_candidate_rejections_are_zero_mutation() -> TestResult {
    let mut queued = single_with_reserve()?;
    queue_faint(
        &mut queued,
        candidate(BattleSide::Player, 0, 1)?,
        epoch(17)?,
        9,
    )?;
    queued.enemy_party[0].hp = 0;
    queued.enemy_party[0].fainted = true;
    queue_faint(
        &mut queued,
        candidate(BattleSide::Enemy, 0, 3)?,
        epoch(17)?,
        10,
    )?;
    let head = queued.faint_queue[0].id;
    let tail = queued.faint_queue[1].id;

    let mut stale = queued.clone();
    let before_stale = stale.clone();
    assert!(matches!(
        apply_selected_replacement(
            &mut stale,
            FaintOccurrenceId::new(safe(999)?),
            &ReplacementSelection::selected(PartyIndex::new(1)?, pokemon_id(2)?),
        ),
        Err(ReplacementError::NotQueueHead { .. })
    ));
    assert_eq!(stale, before_stale);

    let mut nonhead = queued.clone();
    let before_nonhead = nonhead.clone();
    assert!(matches!(
        apply_selected_replacement(
            &mut nonhead,
            tail,
            &ReplacementSelection::selected(PartyIndex::new(1)?, pokemon_id(2)?),
        ),
        Err(ReplacementError::NotQueueHead { .. })
    ));
    assert_eq!(nonhead, before_nonhead);

    let mut external_no_legal = queued.clone();
    let before_external = external_no_legal.clone();
    assert!(matches!(
        apply_selected_replacement(
            &mut external_no_legal,
            head,
            &ReplacementSelection::NoLegalReplacement,
        ),
        Err(ReplacementError::NoLegalReplacementExternal)
    ));
    assert_eq!(external_no_legal, before_external);

    let invalid_candidates = [
        (
            PartyIndex::ZERO,
            pokemon_id(2)?,
            ReplacementError::CandidatePartyIdentityMismatch {
                party_slot: PartyIndex::ZERO,
                expected: pokemon_id(2)?,
                actual: pokemon_id(1)?,
            },
        ),
        (
            PartyIndex::new(5)?,
            pokemon_id(2)?,
            ReplacementError::CandidatePartySlotMissing {
                party_slot: PartyIndex::new(5)?,
            },
        ),
    ];
    for (party_slot, pokemon, expected) in invalid_candidates {
        let mut invalid = queued.clone();
        let before_invalid = invalid.clone();
        assert_eq!(
            apply_selected_replacement(
                &mut invalid,
                head,
                &ReplacementSelection::selected(party_slot, pokemon),
            )
            .err(),
            Some(expected)
        );
        assert_eq!(invalid, before_invalid);
    }

    let mut wrong_owner = queued.clone();
    wrong_owner.player_party[1].owner_seat = Some(seat(2)?);
    let before_wrong_owner = wrong_owner.clone();
    assert!(matches!(
        apply_selected_replacement(
            &mut wrong_owner,
            head,
            &ReplacementSelection::selected(PartyIndex::new(1)?, pokemon_id(2)?),
        ),
        Err(ReplacementError::CandidateOwnerMismatch { .. })
    ));
    assert_eq!(wrong_owner, before_wrong_owner);

    let mut fainted_candidate = queued.clone();
    fainted_candidate.player_party[1].hp = 0;
    fainted_candidate.player_party[1].fainted = true;
    let before_fainted_candidate = fainted_candidate.clone();
    assert!(matches!(
        apply_selected_replacement(
            &mut fainted_candidate,
            head,
            &ReplacementSelection::selected(PartyIndex::new(1)?, pokemon_id(2)?),
        ),
        Err(ReplacementError::CandidateNotLiving { .. })
    ));
    assert_eq!(fainted_candidate, before_fainted_candidate);

    let mut on_field = queued.clone();
    on_field.field.slots[1].occupant = Some(pokemon_id(2)?);
    let before_on_field = on_field.clone();
    assert!(matches!(
        apply_selected_replacement(
            &mut on_field,
            head,
            &ReplacementSelection::selected(PartyIndex::new(1)?, pokemon_id(2)?),
        ),
        Err(ReplacementError::CandidateAlreadyOnField { .. })
    ));
    assert_eq!(on_field, before_on_field);
    Ok(())
}

#[test]
fn no_legal_replacement_is_internal_progress_and_clears_slot_in_order() -> TestResult {
    let mut battle = single_without_reserve()?;
    let occurrence = queue_faint(
        &mut battle,
        candidate(BattleSide::Player, 0, 1)?,
        epoch(3)?,
        4,
    )?
    .occurrence;
    let rng_before = battle.battle_rng.clone();
    assert_eq!(
        compute_replacement_progress(&battle, occurrence.id)?,
        ReplacementProgress::NoLegalReplacement
    );

    let progress = advance_replacement_progress(&mut battle, occurrence.id)?;
    assert_eq!(progress.before, ReplacementProgress::Pending);
    assert_eq!(progress.after, ReplacementProgress::NoLegalReplacement);
    assert_eq!(
        progress.mutation,
        Some(BattleMutation::FaintProgressChanged {
            occurrence: occurrence.id,
            before: ReplacementProgress::Pending,
            after: ReplacementProgress::NoLegalReplacement,
        })
    );
    assert_eq!(
        battle.faint_queue[0].replacement,
        ReplacementProgress::NoLegalReplacement
    );

    let result = resolve_no_legal_replacement(&mut battle, occurrence.id)?;
    assert_eq!(result.selection, ReplacementSelection::NoLegalReplacement);
    assert_eq!(result.occurrence.replacement, ReplacementProgress::Applied);
    assert_eq!(battle.battle_rng, rng_before);
    assert_eq!(
        battle
            .field
            .occupant(&battle.format, slot(BattleSide::Player, 0)?)?,
        None
    );
    assert_eq!(
        battle.faint_queue[0].replacement,
        ReplacementProgress::Applied
    );
    assert_eq!(
        result.mutations,
        vec![
            BattleMutation::FieldChanged {
                slot: occurrence.slot,
                before: Some(occurrence.pokemon),
                after: None,
            },
            BattleMutation::FaintResolved {
                occurrence: occurrence.id,
            },
        ]
    );

    let mut direct_battle = single_without_reserve()?;
    let direct_occurrence = queue_faint(
        &mut direct_battle,
        candidate(BattleSide::Player, 0, 1)?,
        epoch(3)?,
        4,
    )?
    .occurrence;
    let direct = resolve_no_legal_replacement(&mut direct_battle, direct_occurrence.id)?;
    assert_eq!(
        direct.mutations,
        vec![
            BattleMutation::FaintProgressChanged {
                occurrence: direct_occurrence.id,
                before: ReplacementProgress::Pending,
                after: ReplacementProgress::NoLegalReplacement,
            },
            BattleMutation::FieldChanged {
                slot: direct_occurrence.slot,
                before: Some(direct_occurrence.pokemon),
                after: None,
            },
            BattleMutation::FaintResolved {
                occurrence: direct_occurrence.id,
            },
        ]
    );
    Ok(())
}

#[test]
fn enemy_not_required_resolution_is_stored_and_rng_free() -> TestResult {
    let mut battle = battle(
        BattleFormat::single(),
        vec![living_pokemon(1, Some(seat(1)?))?],
        vec![fainted_pokemon(3, None)?],
        vec![Some(pokemon_id(1)?), Some(pokemon_id(3)?)],
    )?;
    let occurrence = queue_faint(
        &mut battle,
        candidate(BattleSide::Enemy, 0, 3)?,
        epoch(4)?,
        2,
    )?
    .occurrence;
    assert_eq!(
        compute_replacement_progress(&battle, occurrence.id)?,
        ReplacementProgress::NotRequired
    );
    let rng_before = battle.battle_rng.clone();
    let result = resolve_not_required(&mut battle, occurrence.id)?;
    assert_eq!(result.occurrence.replacement, ReplacementProgress::Applied);
    assert_eq!(battle.battle_rng, rng_before);
    assert_eq!(
        battle.field.occupant(&battle.format, occurrence.slot)?,
        None
    );
    assert_eq!(
        battle.faint_queue[0].replacement,
        ReplacementProgress::Applied
    );
    assert_eq!(
        result.mutations,
        vec![
            BattleMutation::FieldChanged {
                slot: occurrence.slot,
                before: Some(occurrence.pokemon),
                after: None,
            },
            BattleMutation::FaintResolved {
                occurrence: occurrence.id,
            },
        ]
    );
    Ok(())
}

#[test]
fn stored_occurrence_validation_rejects_field_party_owner_actor_and_slot_drift() -> TestResult {
    let mut field_drift = single_with_reserve()?;
    let occurrence = queue_faint(
        &mut field_drift,
        candidate(BattleSide::Player, 0, 1)?,
        epoch(5)?,
        6,
    )?
    .occurrence;
    field_drift.field.slots[0].occupant = Some(pokemon_id(2)?);
    let before_field_drift = field_drift.clone();
    assert!(matches!(
        stored_faint_source(&field_drift, occurrence.id),
        Err(ReplacementError::StoredFieldMismatch { .. })
    ));
    assert_eq!(field_drift, before_field_drift);

    let mut party_missing = single_with_reserve()?;
    let occurrence = queue_faint(
        &mut party_missing,
        candidate(BattleSide::Player, 0, 1)?,
        epoch(5)?,
        6,
    )?
    .occurrence;
    party_missing
        .player_party
        .retain(|pokemon| pokemon.id != occurrence.pokemon);
    let before_party_missing = party_missing.clone();
    assert!(matches!(
        stored_faint_source(&party_missing, occurrence.id),
        Err(ReplacementError::StoredPartyMissing { .. })
    ));
    assert_eq!(party_missing, before_party_missing);

    let mut owner_drift = single_with_reserve()?;
    let occurrence = queue_faint(
        &mut owner_drift,
        candidate(BattleSide::Player, 0, 1)?,
        epoch(5)?,
        6,
    )?
    .occurrence;
    owner_drift.player_party[0].owner_seat = Some(seat(2)?);
    let before_owner_drift = owner_drift.clone();
    assert!(matches!(
        stored_faint_source(&owner_drift, occurrence.id),
        Err(ReplacementError::StoredOwnerMismatch { .. })
    ));
    assert_eq!(owner_drift, before_owner_drift);

    let mut actor_alive = single_with_reserve()?;
    let occurrence = queue_faint(
        &mut actor_alive,
        candidate(BattleSide::Player, 0, 1)?,
        epoch(5)?,
        6,
    )?
    .occurrence;
    actor_alive.player_party[0].hp = 1;
    actor_alive.player_party[0].fainted = false;
    let before_actor_alive = actor_alive.clone();
    assert!(matches!(
        stored_faint_source(&actor_alive, occurrence.id),
        Err(ReplacementError::StoredActorNotFainted { .. })
    ));
    assert_eq!(actor_alive, before_actor_alive);

    let mut slot_drift = single_with_reserve()?;
    let occurrence = queue_faint(
        &mut slot_drift,
        candidate(BattleSide::Player, 0, 1)?,
        epoch(5)?,
        6,
    )?
    .occurrence;
    slot_drift.faint_queue[0].slot = slot(BattleSide::Player, 1)?;
    let before_slot_drift = slot_drift.clone();
    assert!(matches!(
        stored_faint_source(&slot_drift, occurrence.id),
        Err(ReplacementError::InvalidSlot { .. })
    ));
    assert_eq!(slot_drift, before_slot_drift);

    let mut selected_drift = single_with_reserve()?;
    let occurrence = queue_faint(
        &mut selected_drift,
        candidate(BattleSide::Player, 0, 1)?,
        epoch(5)?,
        6,
    )?
    .occurrence;
    selected_drift.faint_queue[0].replacement = ReplacementProgress::Selected {
        party_slot: PartyIndex::ZERO,
        pokemon: pokemon_id(2)?,
    };
    let before_selected_drift = selected_drift.clone();
    assert!(matches!(
        stored_faint_source(&selected_drift, occurrence.id),
        Err(ReplacementError::CandidatePartyIdentityMismatch { .. })
    ));
    assert_eq!(selected_drift, before_selected_drift);
    Ok(())
}
