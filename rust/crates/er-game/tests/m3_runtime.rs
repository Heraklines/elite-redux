use std::sync::Arc;

use er_content::pack::selected_content_pack;
use er_content::species::find_species;
use er_game::internal_event::{
    ButtonEventPayload, InternalEvent, InternalEventKind, InternalEventQueue,
    InternalEventQueueError,
};
use er_game::runtime::GameRuntime;
use er_rng::battle::BattleRngState;
use er_rng::phaser::{PhaserRdg, RunRngState};
use er_state::battle::{BattleOutcome, BattleState, CommandCollectionState};
use er_state::conditions::{
    GlobalAbilitySuppressionState, TerrainKind, TerrainState, WeatherKind, WeatherState,
};
use er_state::field::{FieldSlotState, FieldState};
use er_state::format::BattleFormat;
use er_state::pokemon::{
    AbilityLoadout, BattleStats, PokemonState, StatStages, StatusState,
};
use er_state::snapshot::GameState;
use er_types::battle_command::{
    BattleCommand, BattleCommandProposalV1, ScriptedEnemyPolicyV1, player_command_operation_id,
};
use er_types::battle_control::{
    BATTLE_CONTROL_PLAN_SCHEMA_VERSION, BattleControl, BattleControlPlan, BattleMenu,
    BattleMenuOption, CommandRootControl, SeatBattleControl, SeatMenuInstanceAllocator,
};
use er_types::battle_ids::{
    AuthorityEpoch, BattleId, BattleSide, FaintOccurrenceId, FieldSlot, GameModeId,
    MenuInstanceId, PartyIndex, PokemonId, SpeciesId, TurnIndex, WaveIndex,
};
use er_types::battle_ui::{
    MenuOptionLayout, MenuOptionVisibility,
};
use er_types::{ButtonEvent, GameButton, MenuOptionId, SafeU53, SeatId};

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

fn safe(value: u64) -> TestResult<SafeU53> {
    Ok(SafeU53::new(value)?)
}

fn single_button(endpoint: u64, menu: u64) -> TestResult<InternalEvent> {
    Ok(InternalEvent::Button(ButtonEventPayload {
        endpoint: SeatId::new(safe(endpoint)?),
        menu_instance_id: MenuInstanceId::new(safe(menu)?),
        event: ButtonEvent::Pressed(GameButton::Submit),
    }))
}

#[test]
fn internal_fifo_preserves_source_order_and_kind_evidence() -> TestResult {
    let mut queue = InternalEventQueue::new();
    queue.push(single_button(1, 1)?);
    queue.push(single_button(1, 2)?);
    queue.push(single_button(1, 3)?);

    assert_eq!(queue.len(), 3);
    assert_eq!(queue.processed(), 0);
    for menu in 1..=3 {
        let event = queue.pop()?.expect("queued event");
        assert_eq!(event.kind(), InternalEventKind::Button);
        let InternalEvent::Button(payload) = event else {
            unreachable!("kind assertion above guarantees Button");
        };
        assert_eq!(payload.menu_instance_id.get().get(), menu);
    }
    assert!(queue.pop()?.is_none());
    assert!(queue.is_empty());
    assert_eq!(queue.processed(), 3);
    Ok(())
}

#[test]
fn internal_fifo_rejects_event_4097_without_dropping_the_remaining_queue() -> TestResult {
    let mut queue = InternalEventQueue::new();
    for menu in 1..=4_097 {
        queue.push(single_button(1, menu)?);
    }
    for _ in 0..4_096 {
        assert!(queue.pop()?.is_some());
    }
    let error = queue.pop().expect_err("event 4097 must exceed the fixed budget");
    assert_eq!(
        error,
        InternalEventQueueError::InternalEventBudgetExceeded {
            processed: 4_096,
            remaining: 1,
            remaining_kinds: vec![InternalEventKind::Button],
        }
    );
    assert_eq!(queue.len(), 1);
    assert_eq!(queue.processed(), 4_096);
    Ok(())
}

fn fixture_runtime() -> TestResult<GameRuntime> {
    let content = selected_content_pack()?;
    let species = find_species(&content.species, SpeciesId::new(safe(19)?))?;
    let player = pokemon(
        &content,
        1,
        Some(SeatId::new(safe(1)?)),
        species.id,
    )?;
    let enemy = pokemon(&content, 2, None, species.id)?;
    let format = BattleFormat::single();
    let player_slot = FieldSlot::new(BattleSide::Player, 0)?;
    let enemy_slot = FieldSlot::new(BattleSide::Enemy, 0)?;
    let wave = WaveIndex::new(safe(1)?)?;
    let turn = TurnIndex::new(safe(1)?)?;
    let battle = BattleState {
        battle_id: BattleId::new(safe(1)?),
        wave,
        wave_seed: "m3-runtime-test-wave".to_owned(),
        turn,
        format,
        authority_seat: SeatId::new(safe(1)?),
        player_party: vec![player.clone()],
        enemy_party: vec![enemy.clone()],
        field: FieldState::new_for_format(
            &BattleFormat::single(),
            vec![
                FieldSlotState::new(player_slot, Some(player.id)),
                FieldSlotState::new(enemy_slot, Some(enemy.id)),
            ],
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
        battle_rng: BattleRngState::new("m3-runtime-test-battle", turn),
        command_state: CommandCollectionState::new(Vec::new(), Vec::new())?,
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::ZERO,
        outcome: BattleOutcome::Ongoing,
    };
    let state = GameState::new(
        content.hash.clone(),
        GameModeId::new(safe(1)?),
        wave,
        BattleId::new(safe(2)?),
        RunRngState {
            rdg: PhaserRdg::from_seed("m3-runtime-test-run").state(),
        },
        Some(battle),
    )?;
    let operation_id = player_command_operation_id(
        BattleId::new(safe(1)?),
        wave,
        turn,
        player_slot,
        SeatId::new(safe(1)?),
    )?;
    let control_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/command".to_owned();
    let option_id = MenuOptionId::new("command/fight/0")?;
    let option = BattleMenuOption::new(
        option_id.clone(),
        "battle.command.fight",
        MenuOptionVisibility::Visible,
        true,
        MenuOptionLayout::new(option_id.clone(), 0, 0, 0),
    )?;
    let menu = BattleMenu::new(
        MenuInstanceId::new(safe(1)?),
        SeatId::new(safe(1)?),
        control_id,
        option_id,
        vec![option],
        Vec::new(),
    )?;
    let control = BattleControl::CommandRoot(CommandRootControl::new(
        player.id,
        player_slot,
        menu,
    )?);
    let control = BattleControlPlan::new(
        BATTLE_CONTROL_PLAN_SCHEMA_VERSION,
        BattleId::new(safe(1)?),
        wave,
        turn,
        vec![SeatBattleControl::new(
            SeatId::new(safe(1)?),
            Some(operation_id),
            control,
        )],
        vec![SeatMenuInstanceAllocator::new(
            SeatId::new(safe(1)?),
            MenuInstanceId::new(safe(2)?),
        )?],
    )?;
    Ok(GameRuntime::from_parts(
        state,
        control,
        SeatId::new(safe(1)?),
        ScriptedEnemyPolicyV1::new(SafeU53::ZERO, Vec::new())?,
        Vec::new(),
        Vec::new(),
        Arc::new(content),
    )?)
}

fn pokemon(
    content: &er_content::pack::ContentPack,
    id: u64,
    owner_seat: Option<SeatId>,
    species_id: er_types::battle_ids::SpeciesId,
) -> TestResult<PokemonState> {
    let species = find_species(&content.species, species_id)?;
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
            speed: 100,
        },
        100,
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
        [None, None, None, None],
        AbilityLoadout {
            active: er_types::battle_ids::AbilityId::ZERO,
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        false,
    )?)
}

#[test]
fn game_transaction_failure_is_atomic_and_commit_into_swaps_only_validated_state() -> TestResult {
    let runtime = fixture_runtime()?;
    let mut transaction = runtime.transaction();
    let before = transaction.staged().clone();
    let operation_id = player_command_operation_id(
        BattleId::new(safe(1)?),
        WaveIndex::new(safe(1)?)?,
        TurnIndex::new(safe(1)?)?,
        FieldSlot::new(BattleSide::Player, 0)?,
        SeatId::new(safe(1)?),
    )?;
    let proposal = BattleCommandProposalV1::new(
        operation_id,
        BattleId::new(safe(1)?),
        WaveIndex::new(safe(1)?)?,
        TurnIndex::new(safe(1)?)?,
        SeatId::new(safe(1)?),
        PokemonId::new(safe(1)?),
        FieldSlot::new(BattleSide::Player, 0)?,
        BattleCommand::switch(PokemonId::new(safe(1)?), PartyIndex::ZERO),
        MenuInstanceId::new(safe(1)?),
        "battle/1/wave/1/turn/1/control/player/0/seat/1/command",
    )?;
    let result = transaction.reduce(er_game::internal_event::GameIntent::CommandProposal {
        proposal,
        authority_epoch: AuthorityEpoch::new(safe(1)?),
    });
    assert!(result.is_err());
    assert_eq!(transaction.staged(), &before);

    let mut live = runtime.clone();
    transaction.commit_into(&mut live)?;
    assert_eq!(live, runtime);
    Ok(())
}
#[cfg(test)]
mod m3_oracle_control_axis8 {
    //! M3 oracle differential evidence for the `NEXT_LOGICAL_CONTROL` axis.
    //!
    //! The oracle's final-state envelope is legacy-observable evidence.  This
    //! test parses its canonical state, removes only the legacy `format.slots`
    //! mirror, and asks the production game-owned decision/projector to derive the
    //! typed control plan.  The legacy phase queue is deliberately not recreated:
    //! it has no er-game contract.  The semantic control identity, seat ownership,
    //! operation binding, complete menu graph, actionability, and terminal
    //! outcome are compared at the production boundary instead.

    use std::error::Error;

    use er_battle::BattleNextDecision;
    use er_content::pack::selected_content_pack;
    use er_game::command_menu::{CommandRootSelection, build_command_menu};
    use er_game::replacement_menu::{
        ReplacementMenuResult, build_replacement_menu, replacement_operation_id_for_occurrence,
    };
    use er_game::runtime::project_battle_control_plan;
    use er_state::battle::{BattleOutcome, CommandFrontierStatus, ReplacementProgress};
    use er_state::format::human_seats;
    use er_state::snapshot::GameState;
    use er_types::battle_control::{
        BattleControl, BattleControlPlan, SeatMenuInstanceAllocator, WaitingReason,
    };
    use er_types::battle_ids::{FaintOccurrenceId, MenuInstanceId};
    use er_types::{SafeU53, SeatId};
    use serde_json::Value;

    type TestResult<T = ()> = Result<T, Box<dyn Error>>;

    fn boxed(message: impl Into<String>) -> Box<dyn Error> {
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            message.into(),
        ))
    }

    const FROZEN_CASES: &[(&str, &str)] = &[
        (
            "physical-hit",
            include_str!("../../../fixtures/m3/oracle/battle-cases/physical-hit.json"),
        ),
        (
            "critical-hit",
            include_str!("../../../fixtures/m3/oracle/battle-cases/critical-hit.json"),
        ),
        (
            "special-hit-priority",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/special-hit-priority.json"
            ),
        ),
        (
            "always-hit",
            include_str!("../../../fixtures/m3/oracle/battle-cases/always-hit.json"),
        ),
        (
            "miss",
            include_str!("../../../fixtures/m3/oracle/battle-cases/miss.json"),
        ),
        (
            "poison-type-immunity",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/poison-type-immunity.json"
            ),
        ),
        (
            "grass-powder-immunity",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/grass-powder-immunity.json"
            ),
        ),
        (
            "existing-status-rejected",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/existing-status-rejected.json"
            ),
        ),
        (
            "speed-tie",
            include_str!("../../../fixtures/m3/oracle/battle-cases/speed-tie.json"),
        ),
        (
            "pp-consumption",
            include_str!("../../../fixtures/m3/oracle/battle-cases/pp-consumption.json"),
        ),
        (
            "pp-unusable-rejected",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/pp-unusable-rejected.json"
            ),
        ),
        (
            "poison-application",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/poison-application.json"
            ),
        ),
        (
            "poison-residual",
            include_str!("../../../fixtures/m3/oracle/battle-cases/poison-residual.json"),
        ),
        (
            "paralysis-application",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/paralysis-application.json"
            ),
        ),
        (
            "paralysis-full-stop",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/paralysis-full-stop.json"
            ),
        ),
        (
            "paralysis-speed-order",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/paralysis-speed-order.json"
            ),
        ),
        (
            "burn-application",
            include_str!("../../../fixtures/m3/oracle/battle-cases/burn-application.json"),
        ),
        (
            "burn-residual",
            include_str!("../../../fixtures/m3/oracle/battle-cases/burn-residual.json"),
        ),
        (
            "burn-physical-penalty",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/burn-physical-penalty.json"
            ),
        ),
        (
            "spread-stage-down",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/spread-stage-down.json"
            ),
        ),
        (
            "stage-floor-cap",
            include_str!("../../../fixtures/m3/oracle/battle-cases/stage-floor-cap.json"),
        ),
        (
            "none-ability-no-trigger",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/none-ability-no-trigger.json"
            ),
        ),
        (
            "intimidate-switch-in",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/intimidate-switch-in.json"
            ),
        ),
        (
            "intimidate-stage-floor",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/intimidate-stage-floor.json"
            ),
        ),
        (
            "wonder-guard-block",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/wonder-guard-block.json"
            ),
        ),
        (
            "wonder-guard-super-effective-pass",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/wonder-guard-super-effective-pass.json"
            ),
        ),
        (
            "wonder-guard-status-pass",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/wonder-guard-status-pass.json"
            ),
        ),
        (
            "type-weakness",
            include_str!("../../../fixtures/m3/oracle/battle-cases/type-weakness.json"),
        ),
        (
            "type-resistance",
            include_str!("../../../fixtures/m3/oracle/battle-cases/type-resistance.json"),
        ),
        (
            "type-native-immunity",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/type-native-immunity.json"
            ),
        ),
        (
            "voluntary-switch",
            include_str!("../../../fixtures/m3/oracle/battle-cases/voluntary-switch.json"),
        ),
        (
            "doubles-single-target",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/doubles-single-target.json"
            ),
        ),
        (
            "same-side-simultaneous-faint",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/same-side-simultaneous-faint.json"
            ),
        ),
        (
            "mixed-side-simultaneous-faint",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/mixed-side-simultaneous-faint.json"
            ),
        ),
        (
            "forced-replacement",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/forced-replacement.json"
            ),
        ),
        (
            "no-legal-replacement",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/no-legal-replacement.json"
            ),
        ),
        (
            "victory",
            include_str!("../../../fixtures/m3/oracle/battle-cases/victory.json"),
        ),
        (
            "defeat",
            include_str!("../../../fixtures/m3/oracle/battle-cases/defeat.json"),
        ),
    ];

    const EXPECTED_FINAL_STATE_KEYS: &[&str] = &["canonical", "legacy_identity_map"];
    const EXPECTED_NEXT_CONTROL_KEYS: &[&str] = &[
        "control_kind",
        "cursor",
        "handler",
        "pending_command_owners",
        "phase_name",
        "queued_phases",
        "turn",
        "ui_mode",
        "wave",
    ];

    fn mismatch<T>(case: &str, detail: impl Into<String>) -> TestResult<T> {
        Err(boxed(format!(
            "{case}: NEXT_LOGICAL_CONTROL mismatch: {}",
            detail.into()
        )))
    }

    fn require(case: &str, condition: bool, detail: impl Into<String>) -> TestResult {
        if condition {
            Ok(())
        } else {
            mismatch(case, detail)
        }
    }

    fn parse_fixture(case: &str, source: &str) -> TestResult<Value> {
        serde_json::from_str(source)
            .map_err(|error| boxed(format!("{case}: could not parse frozen fixture JSON: {error}")))
    }

    fn required<'a>(case: &str, value: &'a Value, path: &str) -> TestResult<&'a Value> {
        value
            .get(path)
            .ok_or_else(|| boxed(format!("{case}: fixture is missing {path}")))
    }

    fn string_field<'a>(case: &str, value: &'a Value, path: &str) -> TestResult<&'a str> {
        required(case, value, path)?
            .as_str()
            .ok_or_else(|| boxed(format!("{case}: fixture field {path} is not a string")))
    }

    fn u64_field(case: &str, value: &Value, path: &str) -> TestResult<u64> {
        required(case, value, path)?
            .as_u64()
            .ok_or_else(|| boxed(format!(
                "{case}: fixture field {path} is not an unsigned integer"
            )))
    }

    fn array_field<'a>(case: &str, value: &'a Value, path: &str) -> TestResult<&'a [Value]> {
        required(case, value, path)?
            .as_array()
            .map(|array| array.as_slice())
            .ok_or_else(|| boxed(format!("{case}: fixture field {path} is not an array")))
    }

    fn require_object_keys(case: &str, value: &Value, path: &str, expected: &[&str]) -> TestResult {
        let object = value
            .as_object()
            .ok_or_else(|| boxed(format!("{case}: fixture field {path} is not an object")))?;
        let mut actual = object.keys().map(String::as_str).collect::<Vec<_>>();
        actual.sort_unstable();
        let mut expected = expected.to_vec();
        expected.sort_unstable();
        require(
            case,
            actual == expected,
            format!("{path} keys differ: expected {expected:?}, got {actual:?}"),
        )
    }

    fn parse_expected_final_state(case: &str, fixture: &Value) -> TestResult<GameState> {
        let expected_final_state = required(case, fixture, "expected_final_state")?;
        require_object_keys(
            case,
            expected_final_state,
            "expected_final_state",
            EXPECTED_FINAL_STATE_KEYS,
        )?;
        if !required(case, expected_final_state, "legacy_identity_map")?.is_array() {
            return mismatch(
                case,
                "expected_final_state.legacy_identity_map is not an array",
            );
        }
        let canonical = required(case, expected_final_state, "canonical")?;
        let mut production_canonical = canonical.clone();
        let format = production_canonical
            .get_mut("battle")
            .and_then(Value::as_object_mut)
            .and_then(|battle| battle.get_mut("format"))
            .and_then(Value::as_object_mut)
            .ok_or_else(|| {
                boxed(format!(
                    "{case}: expected_final_state.canonical has no battle.format"
                ))
            })?;
        // The oracle preserves a legacy format.slots mirror.  BattleFormat is the
        // production topology DTO and intentionally does not accept that mirror.
        format.remove("slots");
        serde_json::from_value(production_canonical).map_err(|error| {
            boxed(format!(
                "{case}: expected_final_state.canonical is not a production GameState: {error}"
            ))
        })
    }

    fn expected_control<'a>(case: &str, fixture: &'a Value) -> TestResult<&'a Value> {
        let control = required(case, fixture, "expected_next_control")?;
        require_object_keys(
            case,
            control,
            "expected_next_control",
            EXPECTED_NEXT_CONTROL_KEYS,
        )?;
        let pending = array_field(case, control, "pending_command_owners")?;
        for (index, owner) in pending.iter().enumerate() {
            if owner.as_u64().is_none() {
                return mismatch(
                    case,
                    format!(
                        "expected_next_control.pending_command_owners[{index}] is not an unsigned seat"
                    ),
                );
            }
        }
        let queued = array_field(case, control, "queued_phases")?;
        for (index, phase) in queued.iter().enumerate() {
            if phase.as_str().is_none() || phase.as_str() == Some("") {
                return mismatch(
                    case,
                    format!(
                        "expected_next_control.queued_phases[{index}] is not a non-empty phase name"
                    ),
                );
            }
        }
        Ok(control)
    }

    fn decision_for_state(case: &str, state: &GameState) -> TestResult<BattleNextDecision> {
        let battle = state
            .battle
            .as_ref()
            .ok_or_else(|| boxed(format!("{case}: expected final state has no active battle")))?;
        if battle.outcome != BattleOutcome::Ongoing {
            return Ok(BattleNextDecision::Complete(battle.outcome));
        }
        if let Some(faint) = battle
            .faint_queue
            .iter()
            .find(|faint| faint.replacement != ReplacementProgress::Applied)
        {
            return Ok(BattleNextDecision::Replacement {
                occurrence: faint.id,
            });
        }
        Ok(BattleNextDecision::CommandFrontier)
    }

    fn allocator_before(
        case: &str,
        control: &Value,
        seats: &[SeatId],
    ) -> TestResult<Vec<SeatMenuInstanceAllocator>> {
        // The legacy control has no allocator field.  Its frozen cursor is zero
        // for every published case, so actionable projections explicitly start
        // from the first legal production menu instance (one).  Terminal and
        // waiting projections consume none of these allocators.
        let cursor = u64_field(case, control, "cursor")?;
        require(
            case,
            cursor == 0,
            format!(
                "allocator-before reconstruction requires frozen cursor 0, got {cursor}"
            ),
        )?;
        let first = MenuInstanceId::new(
            SafeU53::new(1)
                .map_err(|error| boxed(format!("{case}: invalid initial menu allocator: {error}")))?,
        );
        seats
            .iter()
            .map(|seat| {
                SeatMenuInstanceAllocator::new(*seat, first).map_err(|error| {
                    boxed(format!(
                        "{case}: could not reconstruct allocator for seat {seat}: {error}"
                    ))
                })
            })
            .collect()
    }

    fn next_menu_instance(case: &str, current: MenuInstanceId) -> TestResult<MenuInstanceId> {
        let next = current
            .get()
            .get()
            .checked_add(1)
            .ok_or_else(|| boxed(format!("{case}: menu allocator overflowed")))?;
        Ok(MenuInstanceId::new(
            SafeU53::new(next)
                .map_err(|error| boxed(format!("{case}: menu allocator overflowed: {error}")))?,
        ))
    }

    fn require_allocators(
        case: &str,
        plan: &BattleControlPlan,
        before: &[SeatMenuInstanceAllocator],
        consumed: &[SeatId],
    ) -> TestResult {
        require(
            case,
            plan.menu_allocators.len() == before.len(),
            format!(
                "menu allocator seat count differs: expected {}, got {}",
                before.len(),
                plan.menu_allocators.len()
            ),
        )?;
        for previous in before {
            let expected = if consumed.contains(&previous.seat) {
                next_menu_instance(case, previous.next_menu_instance_id)?
            } else {
                previous.next_menu_instance_id
            };
            let actual = plan
                .allocator(previous.seat)
                .ok_or_else(|| {
                    boxed(format!(
                        "{case}: projected plan omitted allocator for seat {}",
                        previous.seat
                    ))
                })?;
            require(
                case,
                actual.next_menu_instance_id == expected,
                format!(
                    "allocator mismatch for seat {}: expected next {}, got {}",
                    previous.seat, expected, actual.next_menu_instance_id
                ),
            )?;
        }
        Ok(())
    }

    fn plan_kind(case: &str, plan: &BattleControlPlan) -> TestResult<&'static str> {
        let has_command = plan
            .seats
            .iter()
            .any(|entry| matches!(&entry.control, BattleControl::CommandRoot(_)));
        let has_replacement = plan
            .seats
            .iter()
            .any(|entry| matches!(&entry.control, BattleControl::ReplacementSelect(_)));
        let has_waiting = plan
            .seats
            .iter()
            .any(|entry| matches!(&entry.control, BattleControl::Waiting(_)));
        let has_complete = plan
            .seats
            .iter()
            .any(|entry| matches!(&entry.control, BattleControl::Complete(_)));
        match (has_command, has_replacement, has_waiting, has_complete) {
            (true, false, false, false) => Ok("Command"),
            (false, true, false, false) | (false, true, true, false) => Ok("PartyReplacement"),
            (false, false, true, false) => Ok("Waiting"),
            (false, false, false, true) => Ok("Terminal"),
            shape => mismatch(case, format!("projected plan has mixed control shape {shape:?}")),
        }
    }

    fn command_owners(plan: &BattleControlPlan) -> Vec<u64> {
        plan.seats
            .iter()
            .filter_map(|entry| {
                matches!(&entry.control, BattleControl::CommandRoot(_))
                    .then_some(entry.seat.get().get())
            })
            .collect()
    }

    fn expected_command_owners(case: &str, control: &Value) -> TestResult<Vec<u64>> {
        array_field(case, control, "pending_command_owners")?
            .iter()
            .map(|owner| {
                owner
                    .as_u64()
                    .ok_or_else(|| boxed(format!("{case}: pending command owner is not an unsigned seat")))
            })
            .collect()
    }

    fn projected_cursor(case: &str, plan: &BattleControlPlan, kind: &str) -> TestResult<u64> {
        match kind {
            "Command" => {
                for entry in &plan.seats {
                    let BattleControl::CommandRoot(root) = &entry.control else {
                        return mismatch(case, "command plan contains a non-command control");
                    };
                    require(
                        case,
                        root.menu.selected_option_id.as_str() == "command/fight",
                        format!(
                            "command seat {} selected {:?}, expected command/fight",
                            entry.seat, root.menu.selected_option_id
                        ),
                    )?;
                    let selected = root
                        .menu
                        .option(root.menu.selected_option_id.clone())
                        .ok_or_else(|| boxed(format!("{case}: selected command option is absent")))?;
                    require(
                        case,
                        selected.layout.row == 0
                            && selected.layout.column == 0
                            && selected.layout.page == 0,
                        format!(
                            "command cursor geometry is not the frozen zero position: {:?}",
                            selected.layout
                        ),
                    )?;
                }
                Ok(0)
            }
            "Terminal" | "Waiting" => Ok(0),
            "PartyReplacement" => {
                let replacement = plan
                    .seats
                    .iter()
                    .find_map(|entry| match &entry.control {
                        BattleControl::ReplacementSelect(value) => Some(value),
                        _ => None,
                    })
                    .ok_or_else(|| boxed(format!("{case}: replacement plan has no owner menu")))?;
                let selected = replacement
                    .menu
                    .option(replacement.menu.selected_option_id.clone())
                    .ok_or_else(|| {
                        boxed(format!("{case}: replacement selected option is absent"))
                    })?;
                require(
                    case,
                    selected.layout.column == 0 && selected.layout.page == 0,
                    "legacy replacement cursor cannot be mapped from a paged or columnar production menu",
                )?;
                Ok(u64::from(selected.layout.row))
            }
            other => mismatch(case, format!("cannot derive cursor for control kind {other}")),
        }
    }

    fn compare_legacy_control_fields(
        case: &str,
        control: &Value,
        plan: &BattleControlPlan,
        battle: &er_state::battle::BattleState,
        kind: &str,
    ) -> TestResult {
        let expected_kind = string_field(case, control, "control_kind")?;
        require(
            case,
            expected_kind == kind,
            format!("control kind: expected {expected_kind}, got {kind}"),
        )?;

        let expected_wave = u64_field(case, control, "wave")?;
        let expected_turn = u64_field(case, control, "turn")?;
        require(
            case,
            expected_wave == battle.wave.get().get(),
            format!(
                "fixture control wave {} disagrees with final state wave {}",
                expected_wave,
                battle.wave.get().get()
            ),
        )?;
        require(
            case,
            expected_turn == battle.turn.get().get(),
            format!(
                "fixture control turn {} disagrees with final state turn {}",
                expected_turn,
                battle.turn.get().get()
            ),
        )?;
        require(
            case,
            plan.wave.get().get() == expected_wave,
            format!("projected plan wave differs: expected {expected_wave}, got {}", plan.wave),
        )?;
        require(
            case,
            plan.turn.get().get() == expected_turn,
            format!("projected plan turn differs: expected {expected_turn}, got {}", plan.turn),
        )?;

        let expected_owners = expected_command_owners(case, control)?;
        let actual_owners = command_owners(plan);
        require(
            case,
            expected_owners == actual_owners,
            format!(
                "pending command owners differ: expected {expected_owners:?}, got {actual_owners:?}"
            ),
        )?;

        let expected_mode = string_field(case, control, "ui_mode")?;
        let expected_handler = string_field(case, control, "handler")?;
        let (mode, handler) = match kind {
            "Command" => ("COMMAND", "CommandUiHandler"),
            "PartyReplacement" => ("PARTY", "PartyUiHandler"),
            "Waiting" | "Terminal" => ("MESSAGE", "BattleMessageUiHandler"),
            other => return mismatch(case, format!("unknown projected control kind {other}")),
        };
        require(
            case,
            expected_mode == mode,
            format!("ui mode: expected {expected_mode}, got production semantic {mode}"),
        )?;
        require(
            case,
            expected_handler == handler,
            format!("handler: expected {expected_handler}, got production semantic {handler}"),
        )?;

        let expected_cursor = u64_field(case, control, "cursor")?;
        let actual_cursor = projected_cursor(case, plan, kind)?;
        require(
            case,
            expected_cursor == actual_cursor,
            format!("cursor: expected {expected_cursor}, got production semantic {actual_cursor}"),
        )?;

        let expected_phase = string_field(case, control, "phase_name")?;
        match kind {
            "Command" => require(
                case,
                expected_phase == "CommandPhase",
                format!("command control phase is {expected_phase}, not CommandPhase"),
            )?,
            "Terminal" => {
                let expected = match battle.outcome {
                    BattleOutcome::Victory => "VictoryPhase",
                    BattleOutcome::Defeat => "GameOverPhase",
                    BattleOutcome::Ongoing => {
                        return mismatch(case, "terminal control has an ongoing final-state outcome")
                    }
                };
                require(
                    case,
                    expected_phase == expected,
                    format!("terminal phase: expected {expected}, got {expected_phase}"),
                )?;
            }
            "PartyReplacement" | "Waiting" => {
                return mismatch(
                    case,
                    format!(
                        "legacy phase {expected_phase} is not owned by the er-game control contract"
                    ),
                );
            }
            other => return mismatch(case, format!("unknown projected control kind {other}")),
        }
        Ok(())
    }

    fn compare_command_plan(
        case: &str,
        state: &GameState,
        plan: &BattleControlPlan,
        before: &[SeatMenuInstanceAllocator],
    ) -> TestResult {
        let battle = state
            .battle
            .as_ref()
            .ok_or_else(|| boxed(format!("{case}: command projection has no battle")))?;
        let human_count = usize::from(battle.format.player_capacity);
        let frontier_human_count = battle
            .command_state
            .frontier
            .iter()
            .filter(|entry| entry.owner_seat.is_some())
            .count();
        require(
            case,
            frontier_human_count == human_count,
            format!(
                "final command frontier has {frontier_human_count} human entries, expected {human_count}"
            ),
        )?;

        for seat_control in &plan.seats {
            let root = match &seat_control.control {
                BattleControl::CommandRoot(root) => root,
                other => {
                    return mismatch(
                        case,
                        format!("seat {} projected non-command control {other:?}", seat_control.seat),
                    )
                }
            };
            let frontier = battle
                .command_state
                .frontier
                .iter()
                .find(|entry| entry.owner_seat == Some(seat_control.seat))
                .ok_or_else(|| {
                    boxed(format!(
                        "{case}: projected command seat {} has no canonical frontier entry",
                        seat_control.seat
                    ))
                })?;
            require(
                case,
                matches!(frontier.status, CommandFrontierStatus::Pending),
                format!("frontier entry for seat {} is not pending", seat_control.seat),
            )?;
            require(
                case,
                root.actor == frontier.actor,
                format!(
                    "seat {} actor differs: expected {}, got {}",
                    seat_control.seat, frontier.actor, root.actor
                ),
            )?;
            require(
                case,
                root.field_slot == frontier.field_slot,
                format!(
                    "seat {} field slot differs: expected {:?}, got {:?}",
                    seat_control.seat, frontier.field_slot, root.field_slot
                ),
            )?;
            require(
                case,
                seat_control.decision_operation_id.as_ref() == Some(&frontier.operation_id),
                format!(
                    "seat {} operation differs: expected {}, got {:?}",
                    seat_control.seat, frontier.operation_id, seat_control.decision_operation_id
                ),
            )?;
            let expected_control_id = format!(
                "battle/{}/wave/{}/turn/{}/control/player/{}/seat/{}/command",
                battle.battle_id,
                battle.wave,
                battle.turn,
                frontier.field_slot.position,
                seat_control.seat,
            );
            require(
                case,
                root.menu.control_id == expected_control_id,
                format!(
                    "seat {} control identity differs: expected {expected_control_id}, got {}",
                    seat_control.seat, root.menu.control_id
                ),
            )?;
            let expected_menu = build_command_menu(
                root.menu.instance_id,
                seat_control.seat,
                expected_control_id,
                &frontier.offer,
                CommandRootSelection::Fight,
            )
            .map_err(|error| {
                boxed(format!(
                    "{case}: production command menu could not be rebuilt for seat {}: {error}",
                    seat_control.seat
                ))
            })?;
            require(
                case,
                root.menu == expected_menu,
                format!("seat {} command menu graph differs from canonical offer", seat_control.seat),
            )?;
            let allocator = before
                .iter()
                .find(|allocator| allocator.seat == seat_control.seat)
                .ok_or_else(|| {
                    boxed(format!(
                        "{case}: missing allocator-before for seat {}",
                        seat_control.seat
                    ))
                })?;
            require(
                case,
                root.menu.instance_id == allocator.next_menu_instance_id,
                format!(
                    "seat {} menu instance differs from explicit allocator-before: expected {}, got {}",
                    seat_control.seat, allocator.next_menu_instance_id, root.menu.instance_id
                ),
            )?;
            require(
                case,
                seat_control.control.is_actionable()
                    && seat_control.decision_operation_id.is_some(),
                format!("seat {} command control is not actionable/bound", seat_control.seat),
            )?;
        }
        let consumed = plan.seats.iter().map(|entry| entry.seat).collect::<Vec<_>>();
        require_allocators(case, plan, before, &consumed)
    }

    fn compare_replacement_plan(
        case: &str,
        state: &GameState,
        occurrence: FaintOccurrenceId,
        plan: &BattleControlPlan,
        before: &[SeatMenuInstanceAllocator],
    ) -> TestResult {
        let battle = state
            .battle
            .as_ref()
            .ok_or_else(|| boxed(format!("{case}: replacement projection has no battle")))?;
        let faint = battle
            .faint_queue
            .iter()
            .find(|faint| faint.id == occurrence)
            .ok_or_else(|| boxed(format!("{case}: replacement occurrence {occurrence} is absent")))?;
        let owner = faint
            .owner_seat
            .ok_or_else(|| boxed(format!("{case}: replacement occurrence has no human owner")))?;
        let operation_id = replacement_operation_id_for_occurrence(battle, occurrence).map_err(|error| {
            boxed(format!(
                "{case}: production replacement operation could not be derived: {error}"
            ))
        })?;
        let owner_allocator = before
            .iter()
            .find(|allocator| allocator.seat == owner)
            .ok_or_else(|| boxed(format!("{case}: missing replacement owner allocator-before")))?;
        let expected_projection = build_replacement_menu(
            battle,
            occurrence,
            owner_allocator.next_menu_instance_id,
        )
        .map_err(|error| boxed(format!("{case}: production replacement menu failed: {error}")))?;

        match expected_projection {
            ReplacementMenuResult::Menu(expected_control) => {
                let mut consumed = Vec::new();
                for seat_control in &plan.seats {
                    if seat_control.seat == owner {
                        let actual = match &seat_control.control {
                            BattleControl::ReplacementSelect(value) => value,
                            other => {
                                return mismatch(
                                    case,
                                    format!("replacement owner projected {other:?}, not ReplacementSelect"),
                                )
                            }
                        };
                        require(
                            case,
                            actual == &expected_control,
                            "replacement menu graph or identity differs from the canonical party graph",
                        )?;
                        require(
                            case,
                            seat_control.decision_operation_id.as_ref() == Some(&operation_id),
                            format!(
                                "replacement operation differs: expected {operation_id}, got {:?}",
                                seat_control.decision_operation_id
                            ),
                        )?;
                        require(
                            case,
                            seat_control.control.is_actionable(),
                            "replacement owner control is not actionable",
                        )?;
                        consumed.push(owner);
                    } else {
                        let waiting = match &seat_control.control {
                            BattleControl::Waiting(value) => value,
                            other => {
                                return mismatch(
                                    case,
                                    format!("non-owner seat projected {other:?}, not Waiting"),
                                )
                            }
                        };
                        require(
                            case,
                            waiting.reason == WaitingReason::ReplacementOwner
                                && waiting.operation_ids == vec![operation_id.clone()],
                            format!(
                                "non-owner seat {} waiting identity differs",
                                seat_control.seat
                            ),
                        )?;
                        require(
                            case,
                            seat_control.decision_operation_id.is_none()
                                && !seat_control.control.is_actionable(),
                            format!("non-owner seat {} is incorrectly actionable", seat_control.seat),
                        )?;
                    }
                }
                require_allocators(case, plan, before, &consumed)
            }
            ReplacementMenuResult::NoLegalReplacement {
                occurrence: projected_occurrence,
                source,
                actor,
                field_slot,
                owner_seat,
            } => {
                require(
                    case,
                    projected_occurrence == occurrence
                        && source == faint.source
                        && actor == faint.pokemon
                        && field_slot == faint.slot
                        && owner_seat == owner,
                    "no-legal-replacement identity differs from the stored faint occurrence",
                )?;
                for seat_control in &plan.seats {
                    let waiting = match &seat_control.control {
                        BattleControl::Waiting(value) => value,
                        other => {
                            return mismatch(
                                case,
                                format!("no-legal seat projected {other:?}, not Waiting"),
                            )
                        }
                    };
                    require(
                        case,
                        waiting.reason == WaitingReason::ReplacementOwner
                            && waiting.operation_ids == vec![operation_id.clone()],
                        format!("no-legal waiting identity differs for seat {}", seat_control.seat),
                    )?;
                    require(
                        case,
                        seat_control.decision_operation_id.is_none()
                            && !seat_control.control.is_actionable(),
                        format!("no-legal seat {} is incorrectly actionable", seat_control.seat),
                    )?;
                }
                require_allocators(case, plan, before, &[])
            }
        }
    }

    fn compare_complete_plan(
        case: &str,
        plan: &BattleControlPlan,
        before: &[SeatMenuInstanceAllocator],
        outcome: BattleOutcome,
    ) -> TestResult {
        require(
            case,
            outcome != BattleOutcome::Ongoing,
            "complete control was requested for an ongoing battle",
        )?;
        for seat_control in &plan.seats {
            let actual = match &seat_control.control {
                BattleControl::Complete(actual) => *actual,
                other => {
                    return mismatch(
                        case,
                        format!("terminal seat {} projected {other:?}, not Complete", seat_control.seat),
                    )
                }
            };
            require(
                case,
                actual == outcome,
                format!(
                    "terminal outcome for seat {} differs: expected {outcome:?}, got {actual:?}",
                    seat_control.seat
                ),
            )?;
            require(
                case,
                seat_control.decision_operation_id.is_none() && !seat_control.control.is_actionable(),
                format!("terminal seat {} is incorrectly actionable", seat_control.seat),
            )?;
        }
        require_allocators(case, plan, before, &[])
    }

    fn compare_case(case: &str, source: &str, content: &er_content::pack::ContentPack) -> TestResult {
        let fixture = parse_fixture(case, source)?;
        let control = expected_control(case, &fixture)?;
        let state = parse_expected_final_state(case, &fixture)?;
        state
            .validate()
            .map_err(|error| boxed(format!("{case}: expected final state failed validation: {error}")))?;
        require(
            case,
            state.content_hash == content.hash,
            format!(
                "final-state content hash differs from selected ContentPack: expected {}, got {}",
                content.hash, state.content_hash
            ),
        )?;
        let battle = state
            .battle
            .as_ref()
            .ok_or_else(|| boxed(format!("{case}: expected final state has no battle")))?;
        let seats = human_seats(&battle.format)
            .map_err(|error| boxed(format!("{case}: could not derive human seats: {error}")))?;
        let before = allocator_before(case, control, &seats)?;
        let decision = decision_for_state(case, &state)?;
        let plan = project_battle_control_plan(&state, decision, &before, content).map_err(|error| {
            boxed(format!(
                "{case}: production control projection failed for {decision:?}: {error}"
            ))
        })?;
        plan.validate()
            .map_err(|error| boxed(format!("{case}: projected BattleControlPlan is invalid: {error}")))?;
        require(
            case,
            plan.battle_id == battle.battle_id,
            format!(
                "projected battle identity differs: expected {}, got {}",
                battle.battle_id, plan.battle_id
            ),
        )?;
        let kind = plan_kind(case, &plan)?;
        compare_legacy_control_fields(case, control, &plan, battle, kind)?;
        match decision {
            BattleNextDecision::CommandFrontier => {
                require(case, kind == "Command", format!("decision projected as {kind}"))?;
                require(case, battle.outcome == BattleOutcome::Ongoing, "command frontier is not ongoing")?;
                compare_command_plan(case, &state, &plan, &before)?;
            }
            BattleNextDecision::Replacement { occurrence } => {
                require(
                    case,
                    kind == "PartyReplacement" || kind == "Waiting",
                    format!("replacement decision projected as {kind}"),
                )?;
                require(case, battle.outcome == BattleOutcome::Ongoing, "replacement decision is not ongoing")?;
                compare_replacement_plan(case, &state, occurrence, &plan, &before)?;
            }
            BattleNextDecision::Complete(outcome) => {
                require(case, kind == "Terminal", format!("complete decision projected as {kind}"))?;
                compare_complete_plan(case, &plan, &before, outcome)?;
            }
        }
        Ok(())
    }

    #[test]
    fn m3_oracle_next_logical_control_projects_all_frozen_cases() -> TestResult {
        require(
            "M3 catalog",
            FROZEN_CASES.len() == 38,
            format!("expected 38 frozen cases, got {}", FROZEN_CASES.len()),
        )?;
        let content = selected_content_pack()?;
        for &(case, source) in FROZEN_CASES {
            compare_case(case, source, &content)?;
        }
        Ok(())
    }


}
