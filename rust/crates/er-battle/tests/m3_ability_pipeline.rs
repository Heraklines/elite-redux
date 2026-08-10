//! Deterministic M3B-07 ability content and pipeline checks.
//!
//! These tests intentionally use the future public `er_battle::ability*`
//! modules.  The integration owner wires those modules through `lib.rs`.

use std::error::Error;

use er_battle::ability::{
    AbilityError, AbilitySuppressionReason, INTIMIDATE_ABILITY_ID, NONE_ABILITY_ID,
    WONDER_GUARD_ABILITY_ID, resolve_ability,
};
use er_battle::ability_pipeline::{
    AbilityPipelineError, DefensiveAbilityInput, DefensiveAbilityOutcome,
    DefensiveAbilityPassReason, SwitchInOutcome, evaluate_defensive_ability,
    evaluate_defensive_ability_for_target, evaluate_switch_in,
};
use er_battle::type_effectiveness::{
    EffectivenessMultiplier, TypeEffectiveness, resolve_type_effectiveness,
};
use er_content::pack::{ContentPack, ContentPackError, selected_content_pack};
use er_rng::battle::BattleRngState;
use er_state::battle::{BattleOutcome, BattleState, CommandCollectionState};
use er_state::conditions::{
    GlobalAbilitySuppressionState, TerrainKind, TerrainState, WeatherKind, WeatherState,
};
use er_state::field::{FieldSlotState, FieldState, FieldStateError};
use er_state::format::{BattleFormat, BattleFormatError, FormatTopologyError};
use er_state::pokemon::{AbilityLoadout, BattleStats, PokemonState, StatStages, StatusState};
use er_types::battle_ids::{
    AbilityId, BattleId, BattleSide, FaintOccurrenceId, FieldSlot, PokemonId, TurnIndex, WaveIndex,
};
use er_types::battle_model::{MoveCategory, PokemonType, PokemonTyping, StatusKind};
use er_types::{SafeU53, SeatId};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn safe(value: u64) -> TestResult<SafeU53> {
    Ok(SafeU53::new(value)?)
}

fn ability_id(value: u64) -> TestResult<AbilityId> {
    Ok(AbilityId::try_from_u64(value)?)
}

fn pokemon_id(value: u64) -> TestResult<PokemonId> {
    Ok(PokemonId::try_from_u64(value)?)
}

fn slot(side: BattleSide, position: u8) -> TestResult<FieldSlot> {
    Ok(FieldSlot::new(side, position)?)
}

fn pokemon(
    content: &ContentPack,
    id: u64,
    side: BattleSide,
    active: AbilityId,
    attack_stage: i8,
) -> TestResult<PokemonState> {
    let species_id = match side {
        BattleSide::Player => er_types::battle_ids::SpeciesId::try_from_u64(19)?,
        BattleSide::Enemy => er_types::battle_ids::SpeciesId::try_from_u64(52)?,
    };
    let species = content
        .species
        .iter()
        .find(|species| species.id == species_id)
        .ok_or_else(|| std::io::Error::other("ability test species is absent"))?;
    let owner_seat = match side {
        BattleSide::Player => Some(SeatId::new(safe(if id == 2 { 2 } else { 1 })?)),
        BattleSide::Enemy => None,
    };

    Ok(PokemonState::new(
        pokemon_id(id)?,
        owner_seat,
        species.id,
        0,
        100,
        species.base_types,
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
            attack: attack_stage,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: 0,
            accuracy: 0,
            evasion: 0,
        },
        [None, None, None, None],
        AbilityLoadout {
            active,
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        false,
    )?)
}

fn ability_battle(
    content: &ContentPack,
    format: BattleFormat,
    source_ability: AbilityId,
    enemy_attack_stages: [i8; 2],
    source_occupant: Option<PokemonId>,
) -> TestResult<BattleState> {
    let source = pokemon(content, 1, BattleSide::Player, source_ability, 0)?;
    let ally = pokemon(content, 2, BattleSide::Player, NONE_ABILITY_ID, 0)?;
    let enemy_zero = pokemon(
        content,
        3,
        BattleSide::Enemy,
        NONE_ABILITY_ID,
        enemy_attack_stages[0],
    )?;
    let enemy_one = pokemon(
        content,
        4,
        BattleSide::Enemy,
        NONE_ABILITY_ID,
        enemy_attack_stages[1],
    )?;
    let player_zero = slot(BattleSide::Player, 0)?;
    let player_one = slot(BattleSide::Player, 1)?;
    let enemy_zero_slot = slot(BattleSide::Enemy, 0)?;
    let enemy_one_slot = slot(BattleSide::Enemy, 1)?;
    let occupants = [
        (player_zero, source_occupant),
        (player_one, Some(pokemon_id(2)?)),
        (enemy_zero_slot, Some(pokemon_id(3)?)),
        (enemy_one_slot, Some(pokemon_id(4)?)),
    ];
    let field = FieldState::new_for_format(
        &format,
        occupants
            .into_iter()
            .map(|(field_slot, occupant)| FieldSlotState::new(field_slot, occupant))
            .collect(),
    )?;
    let turn = TurnIndex::new(safe(1)?)?;
    Ok(BattleState {
        battle_id: BattleId::new(safe(1)?),
        wave: WaveIndex::new(safe(1)?)?,
        wave_seed: "m3-ability-pipeline".to_owned(),
        turn,
        format,
        authority_seat: SeatId::new(safe(1)?),
        player_party: vec![source, ally],
        enemy_party: vec![enemy_zero, enemy_one],
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
        battle_rng: BattleRngState::new("m3-ability-battle", turn),
        command_state: CommandCollectionState::new(Vec::new(), Vec::new())?,
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::ZERO,
        outcome: BattleOutcome::Ongoing,
    })
}

fn defensive_input(
    ability_id: AbilityId,
    move_category: MoveCategory,
    type_effectiveness: TypeEffectiveness,
) -> DefensiveAbilityInput {
    DefensiveAbilityInput::new(ability_id, move_category, type_effectiveness)
}

#[test]
fn none_is_an_explicit_content_no_op_and_missing_ids_fail_closed() -> TestResult {
    let content = selected_content_pack()?;
    let resolved = resolve_ability(&content, NONE_ABILITY_ID)?;
    assert_eq!(resolved.ability_id, NONE_ABILITY_ID);
    assert!(resolved.is_none());

    let unknown = ability_id(999)?;
    let error = match resolve_ability(&content, unknown) {
        Ok(_) => return Err("unsupported ability unexpectedly resolved".into()),
        Err(error) => error,
    };
    assert!(matches!(
        &error,
        AbilityError::UnsupportedContent { ability_id, .. } if *ability_id == unknown
    ));
    assert_eq!(error.ability_id(), Some(unknown));
    assert!(error.is_unsupported_content());
    Ok(())
}

#[test]
fn full_content_pack_corruption_is_not_misclassified_as_an_ability_id() -> TestResult {
    let mut content = selected_content_pack()?;
    content.schema_version += 1;

    let error = match resolve_ability(&content, NONE_ABILITY_ID) {
        Ok(_) => return Err("corrupt content pack unexpectedly resolved".into()),
        Err(error) => error,
    };
    assert!(matches!(
        &error,
        AbilityError::InvalidContentPack {
            source: ContentPackError::SchemaVersionMismatch { .. }
        }
    ));
    assert_eq!(error.ability_id(), None);
    assert!(!error.is_unsupported_content());
    Ok(())
}

#[test]
fn wonder_guard_uses_composed_native_effectiveness_and_status_bypass() -> TestResult {
    let content = selected_content_pack()?;
    let neutral = TypeEffectiveness::new(EffectivenessMultiplier::One);
    let resistant = TypeEffectiveness::new(EffectivenessMultiplier::Half);
    let super_effective = TypeEffectiveness::new(EffectivenessMultiplier::Two);
    let doubly_super_effective = TypeEffectiveness::new(EffectivenessMultiplier::Four);

    assert!(matches!(
        evaluate_defensive_ability(
            defensive_input(WONDER_GUARD_ABILITY_ID, MoveCategory::Physical, neutral),
            &content,
        )?,
        DefensiveAbilityOutcome::Blocked {
            type_effectiveness: TypeEffectiveness {
                multiplier: EffectivenessMultiplier::One
            },
            ..
        }
    ));
    assert!(matches!(
        evaluate_defensive_ability(
            defensive_input(WONDER_GUARD_ABILITY_ID, MoveCategory::Special, resistant),
            &content,
        )?,
        DefensiveAbilityOutcome::Blocked { .. }
    ));
    assert!(matches!(
        evaluate_defensive_ability(
            defensive_input(
                WONDER_GUARD_ABILITY_ID,
                MoveCategory::Special,
                super_effective
            ),
            &content,
        )?,
        DefensiveAbilityOutcome::Passed {
            reason: DefensiveAbilityPassReason::SuperEffective,
            ..
        }
    ));
    assert!(matches!(
        evaluate_defensive_ability(
            defensive_input(
                WONDER_GUARD_ABILITY_ID,
                MoveCategory::Physical,
                doubly_super_effective,
            ),
            &content,
        )?,
        DefensiveAbilityOutcome::Passed {
            reason: DefensiveAbilityPassReason::SuperEffective,
            ..
        }
    ));

    let composed_neutral = resolve_type_effectiveness(
        &content.type_chart,
        PokemonType::Electric,
        &PokemonTyping {
            primary: PokemonType::Water,
            secondary: Some(PokemonType::Grass),
        },
    )?;
    assert_eq!(composed_neutral.multiplier, EffectivenessMultiplier::One);
    assert!(
        evaluate_defensive_ability(
            defensive_input(
                WONDER_GUARD_ABILITY_ID,
                MoveCategory::Physical,
                composed_neutral
            ),
            &content,
        )?
        .is_blocked()
    );

    let composed_four = resolve_type_effectiveness(
        &content.type_chart,
        PokemonType::Grass,
        &PokemonTyping {
            primary: PokemonType::Water,
            secondary: Some(PokemonType::Ground),
        },
    )?;
    assert_eq!(composed_four.multiplier, EffectivenessMultiplier::Four);
    assert!(
        evaluate_defensive_ability(
            defensive_input(
                WONDER_GUARD_ABILITY_ID,
                MoveCategory::Physical,
                composed_four
            ),
            &content,
        )?
        .is_passed()
    );

    assert!(matches!(
        evaluate_defensive_ability(
            defensive_input(
                WONDER_GUARD_ABILITY_ID,
                MoveCategory::Status,
                TypeEffectiveness::new(EffectivenessMultiplier::Zero),
            ),
            &content,
        )?,
        DefensiveAbilityOutcome::Passed {
            reason: DefensiveAbilityPassReason::StatusMove,
            ..
        }
    ));
    Ok(())
}

#[test]
fn damaging_native_immunity_validates_content_and_ability_before_terminal() -> TestResult {
    let content = selected_content_pack()?;
    let native_immunity = TypeEffectiveness::new(EffectivenessMultiplier::Zero);

    let mut corrupt_content = content.clone();
    corrupt_content.schema_version += 1;
    assert!(matches!(
        evaluate_defensive_ability(
            defensive_input(
                WONDER_GUARD_ABILITY_ID,
                MoveCategory::Physical,
                native_immunity,
            ),
            &corrupt_content,
        ),
        Err(AbilityPipelineError::Ability(
            AbilityError::InvalidContentPack {
                source: ContentPackError::SchemaVersionMismatch { .. }
            }
        ))
    ));

    let unknown = ability_id(999)?;
    assert!(matches!(
        evaluate_defensive_ability(
            defensive_input(unknown, MoveCategory::Physical, native_immunity),
            &content,
        ),
        Err(AbilityPipelineError::Ability(
            AbilityError::UnsupportedContent { ability_id, .. }
        )) if ability_id == unknown
    ));

    assert!(matches!(
        evaluate_defensive_ability(
            defensive_input(
                WONDER_GUARD_ABILITY_ID,
                MoveCategory::Physical,
                native_immunity,
            ),
            &content,
        ),
        Err(AbilityPipelineError::NativeTypeImmunityTerminal {
            ability_id,
            type_effectiveness,
        }) if ability_id == WONDER_GUARD_ABILITY_ID
            && type_effectiveness == native_immunity
    ));
    assert!(matches!(
        evaluate_defensive_ability(
            defensive_input(
                WONDER_GUARD_ABILITY_ID,
                MoveCategory::Status,
                native_immunity,
            ),
            &content,
        )?,
        DefensiveAbilityOutcome::Passed {
            reason: DefensiveAbilityPassReason::StatusMove,
            ..
        }
    ));
    Ok(())
}

#[test]
fn wonder_guard_honors_active_and_global_suppression() -> TestResult {
    let content = selected_content_pack()?;
    let type_effectiveness = TypeEffectiveness::new(EffectivenessMultiplier::One);

    let mut active = defensive_input(
        WONDER_GUARD_ABILITY_ID,
        MoveCategory::Physical,
        type_effectiveness,
    );
    active.ability_suppressed = true;
    assert!(matches!(
        evaluate_defensive_ability(active, &content)?,
        DefensiveAbilityOutcome::Passed {
            reason: DefensiveAbilityPassReason::Suppressed(AbilitySuppressionReason::Active),
            ..
        }
    ));

    let mut global = defensive_input(
        WONDER_GUARD_ABILITY_ID,
        MoveCategory::Physical,
        type_effectiveness,
    );
    global.global_suppressed = true;
    assert!(matches!(
        evaluate_defensive_ability(global, &content)?,
        DefensiveAbilityOutcome::Passed {
            reason: DefensiveAbilityPassReason::Suppressed(AbilitySuppressionReason::Global),
            ..
        }
    ));
    Ok(())
}

#[test]
fn intimidate_uses_post_occupancy_canonical_adjacency_and_opponent_filter() -> TestResult {
    let content = selected_content_pack()?;
    let format = BattleFormat::coop_double();
    let battle = ability_battle(
        &content,
        format,
        INTIMIDATE_ABILITY_ID,
        [0, 0],
        Some(pokemon_id(1)?),
    )?;
    let player_zero = slot(BattleSide::Player, 0)?;
    let player_one = slot(BattleSide::Player, 1)?;
    let enemy_zero = slot(BattleSide::Enemy, 0)?;
    let enemy_one = slot(BattleSide::Enemy, 1)?;

    let outcome = evaluate_switch_in(&battle, player_zero, &content)?;
    assert!(matches!(outcome, SwitchInOutcome::Triggered { .. }));
    assert_eq!(outcome.target_slots(), &[enemy_zero, enemy_one]);
    assert_eq!(outcome.mutations().len(), 2);
    assert!(outcome.mutations().iter().all(|change| change.mutation.stat
        == er_types::battle_model::BattleStat::Attack
        && change.mutation.before == 0
        && change.mutation.after == -1
        && change.source_slot == player_zero
        && change.target_slot != player_one));
    assert_eq!(outcome.mutations()[0].target, pokemon_id(3)?);
    assert_eq!(outcome.mutations()[1].target, pokemon_id(4)?);
    Ok(())
}

#[test]
fn intimidate_clamps_and_reports_no_mutation_at_the_attack_floor() -> TestResult {
    let content = selected_content_pack()?;
    let battle = ability_battle(
        &content,
        BattleFormat::coop_double(),
        INTIMIDATE_ABILITY_ID,
        [-5, -6],
        Some(pokemon_id(1)?),
    )?;
    let outcome = evaluate_switch_in(&battle, slot(BattleSide::Player, 0)?, &content)?;
    assert!(matches!(outcome, SwitchInOutcome::Triggered { .. }));
    assert_eq!(outcome.target_slots().len(), 2);
    assert_eq!(outcome.mutations().len(), 1);
    assert_eq!(outcome.mutations()[0].target, pokemon_id(3)?);
    assert_eq!(outcome.mutations()[0].mutation.before, -5);
    assert_eq!(outcome.mutations()[0].mutation.after, -6);

    let floor_battle = ability_battle(
        &content,
        BattleFormat::coop_double(),
        INTIMIDATE_ABILITY_ID,
        [-6, -6],
        Some(pokemon_id(1)?),
    )?;
    let floor = evaluate_switch_in(&floor_battle, slot(BattleSide::Player, 0)?, &content)?;
    assert!(matches!(floor, SwitchInOutcome::NoMutation { .. }));
    assert_eq!(floor.target_slots().len(), 2);
    assert!(!floor.has_mutation());
    Ok(())
}

#[test]
fn m3_state_entrypoints_require_occupancy_and_reject_suppression() -> TestResult {
    let content = selected_content_pack()?;
    let source_slot = slot(BattleSide::Player, 0)?;

    let before_occupancy = ability_battle(
        &content,
        BattleFormat::coop_double(),
        INTIMIDATE_ABILITY_ID,
        [0, 0],
        None,
    )?;
    assert!(matches!(
        evaluate_switch_in(&before_occupancy, source_slot, &content),
        Err(er_battle::ability_pipeline::AbilityPipelineError::MissingSourceOccupant {
            slot
        }) if slot == source_slot
    ));

    let mut globally_suppressed = ability_battle(
        &content,
        BattleFormat::coop_double(),
        INTIMIDATE_ABILITY_ID,
        [0, 0],
        Some(pokemon_id(1)?),
    )?;
    globally_suppressed
        .global_ability_suppression
        .ignore_abilities = true;
    assert!(matches!(
        evaluate_switch_in(&globally_suppressed, source_slot, &content),
        Err(AbilityPipelineError::UnsupportedSuppression {
            reason: AbilitySuppressionReason::Global,
        })
    ));
    assert!(matches!(
        evaluate_defensive_ability_for_target(
            &globally_suppressed,
            slot(BattleSide::Enemy, 0)?,
            MoveCategory::Physical,
            TypeEffectiveness::new(EffectivenessMultiplier::One),
            &content,
        ),
        Err(AbilityPipelineError::UnsupportedSuppression {
            reason: AbilitySuppressionReason::Global,
        })
    ));

    let mut actively_suppressed = ability_battle(
        &content,
        BattleFormat::coop_double(),
        INTIMIDATE_ABILITY_ID,
        [0, 0],
        Some(pokemon_id(1)?),
    )?;
    let Some(source) = actively_suppressed.player_party.first_mut() else {
        return Err("ability test source is absent".into());
    };
    source.abilities.active_suppressed = true;
    assert!(matches!(
        evaluate_switch_in(&actively_suppressed, source_slot, &content),
        Err(AbilityPipelineError::UnsupportedSuppression {
            reason: AbilitySuppressionReason::Active,
        })
    ));

    let Some(target) = actively_suppressed.enemy_party.first_mut() else {
        return Err("ability test target is absent".into());
    };
    target.abilities.active_suppressed = true;
    assert!(matches!(
        evaluate_defensive_ability_for_target(
            &actively_suppressed,
            slot(BattleSide::Enemy, 0)?,
            MoveCategory::Physical,
            TypeEffectiveness::new(EffectivenessMultiplier::One),
            &content,
        ),
        Err(AbilityPipelineError::UnsupportedSuppression {
            reason: AbilitySuppressionReason::Active,
        })
    ));
    Ok(())
}

#[test]
fn switch_and_target_evaluators_reject_malformed_field_closure() -> TestResult {
    let content = selected_content_pack()?;
    let source_slot = slot(BattleSide::Player, 0)?;
    let target_slot = slot(BattleSide::Enemy, 0)?;
    let mut battle = ability_battle(
        &content,
        BattleFormat::coop_double(),
        INTIMIDATE_ABILITY_ID,
        [0, 0],
        Some(pokemon_id(1)?),
    )?;
    let _ = battle.field.slots.pop();

    assert!(matches!(
        evaluate_switch_in(&battle, source_slot, &content),
        Err(AbilityPipelineError::Field(
            FieldStateError::SlotCountMismatch {
                expected: 4,
                actual: 3,
            }
        ))
    ));
    assert!(matches!(
        evaluate_defensive_ability_for_target(
            &battle,
            target_slot,
            MoveCategory::Physical,
            TypeEffectiveness::new(EffectivenessMultiplier::One),
            &content,
        ),
        Err(AbilityPipelineError::Field(
            FieldStateError::SlotCountMismatch {
                expected: 4,
                actual: 3,
            }
        ))
    ));
    Ok(())
}

#[test]
fn ability_pipeline_rejects_custom_canonical_non_m3_topology() -> TestResult {
    let content = selected_content_pack()?;
    let player_zero = slot(BattleSide::Player, 0)?;
    let player_one = slot(BattleSide::Player, 1)?;
    let enemy_zero = slot(BattleSide::Enemy, 0)?;
    let enemy_one = slot(BattleSide::Enemy, 1)?;
    let format = BattleFormat::new(
        2,
        2,
        vec![
            er_types::battle_ids::AdjacencyEdge::new(player_zero, player_one)?,
            er_types::battle_ids::AdjacencyEdge::new(player_one, enemy_zero)?,
            er_types::battle_ids::AdjacencyEdge::new(enemy_zero, enemy_one)?,
        ],
    )?;
    let battle = ability_battle(
        &content,
        format,
        INTIMIDATE_ABILITY_ID,
        [0, 0],
        Some(pokemon_id(1)?),
    )?;
    assert!(matches!(
        evaluate_switch_in(&battle, player_zero, &content),
        Err(AbilityPipelineError::Format(
            FormatTopologyError::InvalidFormat(BattleFormatError::UnsupportedTopology)
        ))
    ));
    Ok(())
}
