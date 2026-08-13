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
use er_state::pokemon::{AbilityLoadout, BattleStats, PokemonState, StatStages, StatusState};
use er_state::snapshot::GameState;
use er_types::battle_command::{
    BattleCommand, BattleCommandProposalV1, ScriptedEnemyPolicyV1, player_command_operation_id,
};
use er_types::battle_control::{
    BATTLE_CONTROL_PLAN_SCHEMA_VERSION, BattleControl, BattleControlPlan, BattleMenu,
    BattleMenuOption, CommandRootControl, SeatBattleControl, SeatMenuInstanceAllocator,
};
use er_types::battle_ids::{
    AuthorityEpoch, BattleId, BattleSide, FaintOccurrenceId, FieldSlot, GameModeId, MenuInstanceId,
    PartyIndex, PokemonId, SpeciesId, TurnIndex, WaveIndex,
};
use er_types::battle_ui::{MenuOptionLayout, MenuOptionVisibility};
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
    let error = queue
        .pop()
        .expect_err("event 4097 must exceed the fixed budget");
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
    let player = pokemon(&content, 1, Some(SeatId::new(safe(1)?)), species.id)?;
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
    let control =
        BattleControl::CommandRoot(CommandRootControl::new(player.id, player_slot, menu)?);
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
    //! test parses its canonical state, normalizes only the closed legacy enum
    //! and stale-occupant encodings, removes the legacy `format.slots` mirror,
    //! and asks the production game-owned decision/projector to derive the typed
    //! control plan.  The legacy phase queue is deliberately not recreated: it
    //! has no er-game contract.  The semantic control identity, seat ownership,
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

    const LEGACY_STALE_OCCUPANT_CATALOGUE: &[(&str, &str, u64, u64)] = &[
        ("defeat", "PLAYER", 0, 1),
        ("mixed-side-simultaneous-faint", "PLAYER", 1, 1),
        ("no-legal-replacement", "PLAYER", 0, 1),
        ("no-legal-replacement", "PLAYER", 1, 2),
        ("same-side-simultaneous-faint", "PLAYER", 0, 1),
        ("same-side-simultaneous-faint", "PLAYER", 1, 2),
        ("victory", "ENEMY", 0, 2),
        ("wonder-guard-status-pass", "ENEMY", 0, 2),
        ("wonder-guard-super-effective-pass", "ENEMY", 0, 2),
    ];
    const LEGACY_STALE_OCCUPANT_COUNT: usize = 9;
    const LEGACY_COMPACTED_PLAYER_SLOT_CASE: &str = "mixed-side-simultaneous-faint";
    const LEGACY_ORACLE_CONTENT_DIGEST: &str =
        "3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";
    const LEGACY_ORACLE_CONTENT_HASH: &str =
        "blake3-v1:3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";

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
            include_str!("../../../fixtures/m3/oracle/battle-cases/special-hit-priority.json"),
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
            include_str!("../../../fixtures/m3/oracle/battle-cases/poison-type-immunity.json"),
        ),
        (
            "grass-powder-immunity",
            include_str!("../../../fixtures/m3/oracle/battle-cases/grass-powder-immunity.json"),
        ),
        (
            "existing-status-rejected",
            include_str!("../../../fixtures/m3/oracle/battle-cases/existing-status-rejected.json"),
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
            include_str!("../../../fixtures/m3/oracle/battle-cases/pp-unusable-rejected.json"),
        ),
        (
            "poison-application",
            include_str!("../../../fixtures/m3/oracle/battle-cases/poison-application.json"),
        ),
        (
            "poison-residual",
            include_str!("../../../fixtures/m3/oracle/battle-cases/poison-residual.json"),
        ),
        (
            "paralysis-application",
            include_str!("../../../fixtures/m3/oracle/battle-cases/paralysis-application.json"),
        ),
        (
            "paralysis-full-stop",
            include_str!("../../../fixtures/m3/oracle/battle-cases/paralysis-full-stop.json"),
        ),
        (
            "paralysis-speed-order",
            include_str!("../../../fixtures/m3/oracle/battle-cases/paralysis-speed-order.json"),
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
            include_str!("../../../fixtures/m3/oracle/battle-cases/burn-physical-penalty.json"),
        ),
        (
            "spread-stage-down",
            include_str!("../../../fixtures/m3/oracle/battle-cases/spread-stage-down.json"),
        ),
        (
            "stage-floor-cap",
            include_str!("../../../fixtures/m3/oracle/battle-cases/stage-floor-cap.json"),
        ),
        (
            "none-ability-no-trigger",
            include_str!("../../../fixtures/m3/oracle/battle-cases/none-ability-no-trigger.json"),
        ),
        (
            "intimidate-switch-in",
            include_str!("../../../fixtures/m3/oracle/battle-cases/intimidate-switch-in.json"),
        ),
        (
            "intimidate-stage-floor",
            include_str!("../../../fixtures/m3/oracle/battle-cases/intimidate-stage-floor.json"),
        ),
        (
            "wonder-guard-block",
            include_str!("../../../fixtures/m3/oracle/battle-cases/wonder-guard-block.json"),
        ),
        (
            "wonder-guard-super-effective-pass",
            include_str!(
                "../../../fixtures/m3/oracle/battle-cases/wonder-guard-super-effective-pass.json"
            ),
        ),
        (
            "wonder-guard-status-pass",
            include_str!("../../../fixtures/m3/oracle/battle-cases/wonder-guard-status-pass.json"),
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
            include_str!("../../../fixtures/m3/oracle/battle-cases/type-native-immunity.json"),
        ),
        (
            "voluntary-switch",
            include_str!("../../../fixtures/m3/oracle/battle-cases/voluntary-switch.json"),
        ),
        (
            "doubles-single-target",
            include_str!("../../../fixtures/m3/oracle/battle-cases/doubles-single-target.json"),
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
            include_str!("../../../fixtures/m3/oracle/battle-cases/forced-replacement.json"),
        ),
        (
            "no-legal-replacement",
            include_str!("../../../fixtures/m3/oracle/battle-cases/no-legal-replacement.json"),
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
        serde_json::from_str(source).map_err(|error| {
            boxed(format!(
                "{case}: could not parse frozen fixture JSON: {error}"
            ))
        })
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
        required(case, value, path)?.as_u64().ok_or_else(|| {
            boxed(format!(
                "{case}: fixture field {path} is not an unsigned integer"
            ))
        })
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

    fn require_legacy_format_slots_mirror(case: &str, canonical: &Value) -> TestResult {
        let battle = canonical
            .get("battle")
            .and_then(Value::as_object)
            .ok_or_else(|| boxed(format!("{case}: canonical.battle is invalid")))?;
        let format_slots = battle
            .get("format")
            .and_then(Value::as_object)
            .and_then(|format| format.get("slots"))
            .ok_or_else(|| boxed(format!("{case}: canonical.battle.format.slots is missing")))?;
        let field_slots = battle
            .get("field")
            .and_then(Value::as_object)
            .and_then(|field| field.get("slots"))
            .ok_or_else(|| boxed(format!("{case}: canonical.battle.field.slots is missing")))?;
        require(
            case,
            format_slots.is_array() && field_slots.is_array() && format_slots == field_slots,
            format!(
                "legacy format.slots mirror differs from field.slots: format={format_slots}, field={field_slots}"
            ),
        )
    }

    fn normalize_nested_kind(
        case: &str,
        path: &str,
        object: &mut Value,
        field_name: &str,
    ) -> TestResult {
        let object = object
            .as_object_mut()
            .ok_or_else(|| boxed(format!("{case}: {path} is not an object")))?;
        let kind = object
            .get(field_name)
            .cloned()
            .ok_or_else(|| boxed(format!("{case}: {path}.{field_name} is missing")))?;
        let normalized = match kind {
            Value::String(_) => kind,
            Value::Object(nested) => {
                if nested.len() != 1 || !nested.contains_key("kind") {
                    return Err(boxed(format!(
                        "{case}: {path}.{field_name} has an unsupported nested kind shape"
                    )));
                }
                let tag = nested.get("kind").and_then(Value::as_str).ok_or_else(|| {
                    boxed(format!("{case}: {path}.{field_name}.kind is not a string"))
                })?;
                Value::String(tag.to_owned())
            }
            other => {
                return Err(boxed(format!(
                    "{case}: {path}.{field_name} has unsupported value {other}"
                )));
            }
        };
        object.insert(field_name.to_owned(), normalized);
        Ok(())
    }

    fn validate_adjacent_condition_kind(
        case: &str,
        path: &str,
        object: &Value,
        field_name: &str,
    ) -> TestResult {
        let object = object
            .as_object()
            .ok_or_else(|| boxed(format!("{case}: {path} is not an object")))?;
        let nested = object
            .get(field_name)
            .and_then(Value::as_object)
            .ok_or_else(|| {
                boxed(format!(
                    "{case}: {path}.{field_name} is not an adjacent kind object"
                ))
            })?;
        let tag = nested
            .get("kind")
            .and_then(Value::as_str)
            .ok_or_else(|| boxed(format!("{case}: {path}.{field_name}.kind is not a string")))?;
        let exact_shape = match tag {
            "NONE" => nested.len() == 1,
            "UNSUPPORTED_ORACLE_CODE" => {
                nested.len() == 2
                    && nested
                        .get("value")
                        .and_then(Value::as_u64)
                        .is_some_and(|value| u16::try_from(value).is_ok())
            }
            _ => false,
        };
        require(
            case,
            exact_shape,
            format!("{path}.{field_name} has an unsupported adjacent kind shape"),
        )
    }

    fn legacy_replacement_queue_is_resolved(case: &str, queue: &Value) -> TestResult<bool> {
        let queue = queue.as_array().ok_or_else(|| {
            boxed(format!(
                "{case}: canonical.battle.faint_queue is not an array"
            ))
        })?;
        let mut all_applied = true;
        for (index, occurrence) in queue.iter().enumerate() {
            let occurrence_path = format!("canonical.battle.faint_queue[{index}]");
            let occurrence = occurrence
                .as_object()
                .ok_or_else(|| boxed(format!("{case}: {occurrence_path} is not an object")))?;
            let occurrence_slot = occurrence
                .get("slot")
                .ok_or_else(|| boxed(format!("{case}: {occurrence_path}.slot is missing")))?;
            let occurrence_slot = occurrence_slot
                .as_object()
                .ok_or_else(|| boxed(format!("{case}: {occurrence_path}.slot is not an object")))?;
            let occurrence_side = occurrence_slot
                .get("side")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    boxed(format!(
                        "{case}: {occurrence_path}.slot.side is not a string"
                    ))
                })?;
            if !matches!(occurrence_side, "PLAYER" | "ENEMY") {
                return Err(boxed(format!(
                    "{case}: {occurrence_path}.slot.side has unsupported value {occurrence_side:?}"
                )));
            }
            occurrence_slot
                .get("position")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    boxed(format!(
                        "{case}: {occurrence_path}.slot.position is not an unsigned integer"
                    ))
                })?;
            let _occurrence_pokemon = occurrence
                .get("pokemon")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    boxed(format!(
                        "{case}: {occurrence_path}.pokemon is not an unsigned integer"
                    ))
                })?;
            let replacement = occurrence
                .get("replacement")
                .and_then(Value::as_object)
                .ok_or_else(|| {
                    boxed(format!(
                        "{case}: {occurrence_path}.replacement is not an object"
                    ))
                })?;
            let kind = replacement
                .get("kind")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    boxed(format!(
                        "{case}: {occurrence_path}.replacement.kind is not a string"
                    ))
                })?;
            if !matches!(
                kind,
                "NOT_REQUIRED" | "PENDING" | "SELECTED" | "NO_LEGAL_REPLACEMENT" | "APPLIED"
            ) {
                return Err(boxed(format!(
                    "{case}: {occurrence_path}.replacement.kind has unsupported value {kind:?}"
                )));
            }
            if kind != "APPLIED" {
                all_applied = false;
            }
        }
        Ok(all_applied)
    }

    fn legacy_stale_occupant_is_known_shape(
        case: &str,
        outcome: &Value,
        command_state: &Value,
        slot: &Value,
        side: &str,
        owner_seat: Option<u64>,
        queue_is_resolved: bool,
    ) -> TestResult<bool> {
        if !queue_is_resolved {
            return Ok(false);
        }
        let outcome = outcome
            .as_str()
            .ok_or_else(|| boxed(format!("{case}: canonical.battle.outcome is not a string")))?;
        let command_state = command_state
            .as_object()
            .ok_or_else(|| boxed(format!("{case}: canonical.battle.command_state is invalid")))?;
        let frontier = command_state
            .get("frontier")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                boxed(format!(
                    "{case}: canonical.battle.command_state.frontier is not an array"
                ))
            })?;
        match outcome {
            "VICTORY" | "DEFEAT" => return Ok(frontier.is_empty()),
            "ONGOING" => {}
            other => {
                return Err(boxed(format!(
                    "{case}: canonical.battle.outcome has unsupported value {other:?}"
                )));
            }
        }
        if side != "PLAYER" || owner_seat.is_none() {
            return Ok(false);
        }

        let mut has_pending_human = false;
        for (index, entry) in frontier.iter().enumerate() {
            let entry_path = format!("canonical.battle.command_state.frontier[{index}]");
            let entry = entry
                .as_object()
                .ok_or_else(|| boxed(format!("{case}: {entry_path} is not an object")))?;
            let entry_slot = entry
                .get("field_slot")
                .ok_or_else(|| boxed(format!("{case}: {entry_path}.field_slot is missing")))?;
            let entry_slot_object = entry_slot.as_object().ok_or_else(|| {
                boxed(format!("{case}: {entry_path}.field_slot is not an object"))
            })?;
            let entry_side = entry_slot_object
                .get("side")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    boxed(format!(
                        "{case}: {entry_path}.field_slot.side is not a string"
                    ))
                })?;
            if !matches!(entry_side, "PLAYER" | "ENEMY") {
                return Err(boxed(format!(
                    "{case}: {entry_path}.field_slot.side has unsupported value {entry_side:?}"
                )));
            }
            entry_slot_object
                .get("position")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    boxed(format!(
                        "{case}: {entry_path}.field_slot.position is not an unsigned integer"
                    ))
                })?;
            let status = entry
                .get("status")
                .and_then(Value::as_object)
                .ok_or_else(|| boxed(format!("{case}: {entry_path}.status is invalid")))?;
            let status_kind = status.get("kind").and_then(Value::as_str).ok_or_else(|| {
                boxed(format!("{case}: {entry_path}.status.kind is not a string"))
            })?;
            if !matches!(status_kind, "PENDING" | "RETAINED" | "ADMITTED") {
                return Err(boxed(format!(
                    "{case}: {entry_path}.status.kind has unsupported value {status_kind:?}"
                )));
            }
            let entry_owner = match entry.get("owner_seat") {
                Some(Value::Null) => None,
                Some(value) => Some(value.as_u64().ok_or_else(|| {
                    boxed(format!(
                        "{case}: {entry_path}.owner_seat is not null or an unsigned integer"
                    ))
                })?),
                None => {
                    return Err(boxed(format!("{case}: {entry_path}.owner_seat is missing")));
                }
            };
            if entry_owner == owner_seat {
                return Ok(false);
            }
            if entry_slot == slot {
                return Ok(false);
            }
            if status_kind == "PENDING" && entry_owner.is_some() {
                has_pending_human = true;
            }
        }
        Ok(has_pending_human)
    }

    fn normalize_legacy_stale_occupants(
        case: &str,
        battle: &mut serde_json::Map<String, Value>,
    ) -> TestResult {
        if LEGACY_STALE_OCCUPANT_CATALOGUE.len() != LEGACY_STALE_OCCUPANT_COUNT {
            return Err(boxed(format!(
                "legacy stale-occupant catalogue count changed: expected {LEGACY_STALE_OCCUPANT_COUNT}, got {}",
                LEGACY_STALE_OCCUPANT_CATALOGUE.len()
            )));
        }
        let expected_for_case = LEGACY_STALE_OCCUPANT_CATALOGUE
            .iter()
            .filter(|entry| entry.0 == case)
            .collect::<Vec<_>>();
        let mut normalized_count = 0;
        let player_party = battle
            .get("player_party")
            .cloned()
            .ok_or_else(|| boxed(format!("{case}: canonical.battle.player_party is missing")))?;
        let enemy_party = battle
            .get("enemy_party")
            .cloned()
            .ok_or_else(|| boxed(format!("{case}: canonical.battle.enemy_party is missing")))?;
        let faint_queue = battle
            .get("faint_queue")
            .cloned()
            .ok_or_else(|| boxed(format!("{case}: canonical.battle.faint_queue is missing")))?;
        let outcome = battle
            .get("outcome")
            .cloned()
            .ok_or_else(|| boxed(format!("{case}: canonical.battle.outcome is missing")))?;
        let command_state = battle
            .get("command_state")
            .cloned()
            .ok_or_else(|| boxed(format!("{case}: canonical.battle.command_state is missing")))?;
        let queue_is_resolved = legacy_replacement_queue_is_resolved(case, &faint_queue)?;
        let field = battle
            .get_mut("field")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| boxed(format!("{case}: canonical.battle.field is invalid")))?;
        let slots = field
            .get_mut("slots")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| boxed(format!("{case}: canonical.battle.field.slots is invalid")))?;

        for (index, entry) in slots.iter_mut().enumerate() {
            let path = format!("canonical.battle.field.slots[{index}]");
            let entry = entry
                .as_object_mut()
                .ok_or_else(|| boxed(format!("{case}: {path} is not an object")))?;
            let slot = entry
                .get("slot")
                .cloned()
                .ok_or_else(|| boxed(format!("{case}: {path}.slot is missing")))?;
            let slot_object = slot
                .as_object()
                .ok_or_else(|| boxed(format!("{case}: {path}.slot is not an object")))?;
            let side = slot_object
                .get("side")
                .and_then(Value::as_str)
                .ok_or_else(|| boxed(format!("{case}: {path}.slot.side is not a string")))?;
            if !matches!(side, "PLAYER" | "ENEMY") {
                return Err(boxed(format!(
                    "{case}: {path}.slot.side has unsupported value {side:?}"
                )));
            }
            let position = slot_object
                .get("position")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    boxed(format!(
                        "{case}: {path}.slot.position is not an unsigned integer"
                    ))
                })?;
            let expected_slot = expected_for_case
                .iter()
                .find(|entry| entry.1 == side && entry.2 == position);
            let occupant = entry
                .get("occupant")
                .cloned()
                .ok_or_else(|| boxed(format!("{case}: {path}.occupant is missing")))?;
            let Some(occupant_id) = occupant.as_u64() else {
                if occupant.is_null() {
                    if expected_slot.is_some() {
                        return Err(boxed(format!(
                            "{case}: known legacy stale occupant at {side} position {position} is missing"
                        )));
                    }
                    continue;
                }
                return Err(boxed(format!(
                    "{case}: {path}.occupant is not null or an unsigned integer"
                )));
            };
            if let Some(expected_slot) = expected_slot
                && expected_slot.3 != occupant_id
            {
                return Err(boxed(format!(
                    "{case}: known legacy stale occupant at {side} position {position} has unexpected pokemon {occupant_id}, expected {}",
                    expected_slot.3
                )));
            }
            let party = match side {
                "PLAYER" => &player_party,
                "ENEMY" => &enemy_party,
                _ => unreachable!("field slot side was validated above"),
            };
            let party = party.as_array().ok_or_else(|| {
                boxed(format!(
                    "{case}: canonical.battle.{side}_party is not an array"
                ))
            })?;
            let matching_pokemon = party
                .iter()
                .filter(|pokemon| {
                    pokemon
                        .get("id")
                        .and_then(Value::as_u64)
                        .is_some_and(|id| id == occupant_id)
                })
                .collect::<Vec<_>>();
            let pokemon = match matching_pokemon.as_slice() {
                [] => {
                    if expected_slot.is_some() {
                        return Err(boxed(format!(
                            "{case}: known legacy stale occupant at {side} position {position} has no matching party pokemon {occupant_id}"
                        )));
                    }
                    continue;
                }
                [pokemon] => *pokemon,
                _ => {
                    return Err(boxed(format!(
                        "{case}: field occupant {occupant_id} has duplicate party records"
                    )));
                }
            };
            let hp = pokemon.get("hp").and_then(Value::as_u64).ok_or_else(|| {
                boxed(format!(
                    "{case}: {path}.occupant party record has no unsigned hp"
                ))
            })?;
            let fainted = pokemon
                .get("fainted")
                .and_then(Value::as_bool)
                .ok_or_else(|| {
                    boxed(format!(
                        "{case}: {path}.occupant party record has no boolean fainted flag"
                    ))
                })?;
            let owner_seat = match pokemon.get("owner_seat") {
                Some(Value::Null) => None,
                Some(value) => Some(value.as_u64().ok_or_else(|| {
                    boxed(format!(
                        "{case}: {path}.occupant party record owner_seat is not null or an unsigned integer"
                    ))
                })?),
                None => {
                    return Err(boxed(format!(
                        "{case}: {path}.occupant party record owner_seat is missing"
                    )));
                }
            };
            if hp != 0 || !fainted {
                if expected_slot.is_some() {
                    return Err(boxed(format!(
                        "{case}: known legacy stale occupant at {side} position {position} is not hp=0 and fainted=true"
                    )));
                }
                continue;
            }
            if expected_slot.is_none() {
                return Err(boxed(format!(
                    "{case}: hp=0/fainted field occupant at {side} position {position} is outside the known legacy catalogue"
                )));
            }
            if (side == "PLAYER" && owner_seat.is_none())
                || (side == "ENEMY" && owner_seat.is_some())
            {
                return Err(boxed(format!(
                    "{case}: known legacy stale occupant at {side} position {position} has an invalid owner seat"
                )));
            }
            if !legacy_stale_occupant_is_known_shape(
                case,
                &outcome,
                &command_state,
                &slot,
                side,
                owner_seat,
                queue_is_resolved,
            )? {
                return Err(boxed(format!(
                    "{case}: known legacy stale occupant at {side} position {position} is not a resolved terminal or excluded frontier state"
                )));
            }
            entry.insert("occupant".to_owned(), Value::Null);
            normalized_count += 1;
        }
        if normalized_count != expected_for_case.len() {
            return Err(boxed(format!(
                "{case}: normalized {normalized_count} known legacy stale occupants, expected {}",
                expected_for_case.len()
            )));
        }
        Ok(())
    }

    fn normalize_legacy_compacted_player_slot(
        case: &str,
        battle: &mut serde_json::Map<String, Value>,
    ) -> TestResult {
        if case != LEGACY_COMPACTED_PLAYER_SLOT_CASE {
            return Ok(());
        }

        let player_party = battle
            .get("player_party")
            .and_then(Value::as_array)
            .ok_or_else(|| boxed(format!("{case}: canonical.battle.player_party is invalid")))?;
        let survivor = player_party
            .iter()
            .find(|pokemon| pokemon.get("id").and_then(Value::as_u64) == Some(2))
            .ok_or_else(|| boxed(format!("{case}: compacted survivor 2 is missing")))?;
        require(
            case,
            survivor.get("owner_seat").and_then(Value::as_u64) == Some(2)
                && survivor
                    .get("hp")
                    .and_then(Value::as_u64)
                    .is_some_and(|hp| hp > 0)
                && survivor.get("fainted").and_then(Value::as_bool) == Some(false),
            "legacy compacted survivor no longer has the exact seat-2 live-party shape",
        )?;

        let field = battle
            .get("field")
            .and_then(Value::as_object)
            .ok_or_else(|| boxed(format!("{case}: canonical.battle.field is invalid")))?;
        let slots = field
            .get("slots")
            .and_then(Value::as_array)
            .ok_or_else(|| boxed(format!("{case}: canonical.battle.field.slots is invalid")))?;
        let source_index = slots
            .iter()
            .position(|entry| {
                entry
                    .get("slot")
                    .and_then(Value::as_object)
                    .is_some_and(|slot| {
                        slot.get("side").and_then(Value::as_str) == Some("PLAYER")
                            && slot.get("position").and_then(Value::as_u64) == Some(0)
                    })
            })
            .ok_or_else(|| boxed(format!("{case}: compacted source slot is missing")))?;
        let target_index = slots
            .iter()
            .position(|entry| {
                entry
                    .get("slot")
                    .and_then(Value::as_object)
                    .is_some_and(|slot| {
                        slot.get("side").and_then(Value::as_str) == Some("PLAYER")
                            && slot.get("position").and_then(Value::as_u64) == Some(1)
                    })
            })
            .ok_or_else(|| boxed(format!("{case}: canonical seat-2 slot is missing")))?;
        require(
            case,
            slots[source_index].get("occupant").and_then(Value::as_u64) == Some(2)
                && slots[target_index]
                    .get("occupant")
                    .is_some_and(Value::is_null),
            "legacy compacted field no longer has survivor 2 in player slot 0 and an empty player slot 1",
        )?;

        let frontier = battle
            .get("command_state")
            .and_then(Value::as_object)
            .and_then(|command_state| command_state.get("frontier"))
            .and_then(Value::as_array)
            .ok_or_else(|| {
                boxed(format!(
                    "{case}: canonical.battle.command_state.frontier is invalid"
                ))
            })?;
        require(
            case,
            frontier.len() == 1,
            "legacy compacted fixture no longer has exactly one pending command",
        )?;
        let entry = frontier[0]
            .as_object()
            .ok_or_else(|| boxed(format!("{case}: pending command entry is invalid")))?;
        let entry_slot = entry
            .get("field_slot")
            .and_then(Value::as_object)
            .ok_or_else(|| boxed(format!("{case}: pending command slot is invalid")))?;
        require(
            case,
            entry.get("actor").and_then(Value::as_u64) == Some(2)
                && entry.get("owner_seat").and_then(Value::as_u64) == Some(2)
                && entry_slot.get("side").and_then(Value::as_str) == Some("PLAYER")
                && entry_slot.get("position").and_then(Value::as_u64) == Some(0)
                && entry.get("operation_id").and_then(Value::as_str)
                    == Some("battle/1/wave/1/turn/2/command/player/0/seat/2")
                && entry
                    .get("status")
                    .and_then(Value::as_object)
                    .and_then(|status| status.get("kind"))
                    .and_then(Value::as_str)
                    == Some("PENDING"),
            "legacy compacted command no longer has the exact actor/owner/slot/operation/status shape",
        )?;

        let slots = battle
            .get_mut("field")
            .and_then(Value::as_object_mut)
            .and_then(|field| field.get_mut("slots"))
            .and_then(Value::as_array_mut)
            .expect("field slots were validated above");
        slots[source_index]
            .as_object_mut()
            .expect("source field slot was validated above")
            .insert("occupant".to_owned(), Value::Null);
        slots[target_index]
            .as_object_mut()
            .expect("target field slot was validated above")
            .insert("occupant".to_owned(), Value::from(2));

        let entry = battle
            .get_mut("command_state")
            .and_then(Value::as_object_mut)
            .and_then(|command_state| command_state.get_mut("frontier"))
            .and_then(Value::as_array_mut)
            .and_then(|frontier| frontier.first_mut())
            .and_then(Value::as_object_mut)
            .expect("pending command entry was validated above");
        entry
            .get_mut("field_slot")
            .and_then(Value::as_object_mut)
            .expect("pending command slot was validated above")
            .insert("position".to_owned(), Value::from(1));
        entry.insert(
            "operation_id".to_owned(),
            Value::String("battle/1/wave/1/turn/2/command/player/1/seat/2".to_owned()),
        );
        Ok(())
    }

    fn normalize_legacy_content_identity(
        case: &str,
        fixture: &Value,
        canonical: &mut Value,
        content: &er_content::pack::ContentPack,
    ) -> TestResult {
        let fixture_hash = string_field(case, canonical, "content_hash")?.to_owned();
        for peer_name in ["initial_state", "expected_final_state"] {
            let peer = required(case, required(case, fixture, peer_name)?, "canonical")?;
            let peer_hash = string_field(case, peer, "content_hash")?;
            require(
                case,
                peer_hash == fixture_hash,
                format!(
                    "published state content hashes disagree: expected {fixture_hash}, got {peer_hash} in {peer_name}.canonical"
                ),
            )?;
        }

        let provenance = required(case, fixture, "provenance")?;
        let provenance_hash = string_field(case, provenance, "content_pack_hash")?;
        let provenance_oracle_sha = string_field(case, provenance, "oracle_game_sha")?;
        require(
            case,
            provenance_oracle_sha == content.oracle_game_sha,
            format!(
                "provenance oracle_game_sha {provenance_oracle_sha} differs from selected content oracle_game_sha {}",
                content.oracle_game_sha
            ),
        )?;

        let selected_hash = content.hash.as_str();
        let selected_digest = selected_hash.strip_prefix("blake3-v1:").ok_or_else(|| {
            boxed(format!(
                "{case}: selected content hash {selected_hash} has no blake3-v1 prefix"
            ))
        })?;
        if fixture_hash == selected_hash {
            return require(
                case,
                provenance_hash == selected_digest,
                format!(
                    "selected fixture content hash {fixture_hash} differs from provenance digest {provenance_hash}"
                ),
            );
        }
        require(
            case,
            fixture_hash == LEGACY_ORACLE_CONTENT_HASH
                && provenance_hash == LEGACY_ORACLE_CONTENT_DIGEST,
            format!(
                "content identity {fixture_hash} / {provenance_hash} is neither selected nor the exact published legacy pair"
            ),
        )?;
        canonical
            .as_object_mut()
            .ok_or_else(|| {
                boxed(format!(
                    "{case}: expected_final_state.canonical is not an object"
                ))
            })?
            .insert(
                "content_hash".to_owned(),
                Value::String(selected_hash.to_owned()),
            );
        Ok(())
    }

    fn normalize_legacy_state(case: &str, state: &mut Value) -> TestResult {
        let battle = state
            .get_mut("battle")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| boxed(format!("{case}: canonical.battle is invalid")))?;

        for party_name in ["player_party", "enemy_party"] {
            let party = battle
                .get_mut(party_name)
                .and_then(Value::as_array_mut)
                .ok_or_else(|| {
                    boxed(format!("{case}: canonical.battle.{party_name} is invalid"))
                })?;
            for (index, pokemon) in party.iter_mut().enumerate() {
                let status = pokemon.get_mut("status").ok_or_else(|| {
                    boxed(format!(
                        "{case}: canonical.battle.{party_name}[{index}].status is missing"
                    ))
                })?;
                normalize_nested_kind(
                    case,
                    &format!("canonical.battle.{party_name}[{index}].status"),
                    status,
                    "kind",
                )?;
            }
        }
        for condition_name in ["weather", "terrain"] {
            let condition = battle.get(condition_name).ok_or_else(|| {
                boxed(format!(
                    "{case}: canonical.battle.{condition_name} is missing"
                ))
            })?;
            validate_adjacent_condition_kind(
                case,
                &format!("canonical.battle.{condition_name}"),
                condition,
                "kind",
            )?;
        }
        normalize_legacy_stale_occupants(case, battle)?;
        normalize_legacy_compacted_player_slot(case, battle)
    }

    fn parse_expected_final_state(
        case: &str,
        fixture: &Value,
        content: &er_content::pack::ContentPack,
    ) -> TestResult<GameState> {
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
        require_legacy_format_slots_mirror(case, canonical)?;
        let mut production_canonical = canonical.clone();
        normalize_legacy_content_identity(case, fixture, &mut production_canonical, content)?;
        normalize_legacy_state(case, &mut production_canonical)?;
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
            format!("allocator-before reconstruction requires frozen cursor 0, got {cursor}"),
        )?;
        let first =
            MenuInstanceId::new(SafeU53::new(1).map_err(|error| {
                boxed(format!("{case}: invalid initial menu allocator: {error}"))
            })?);
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
        Ok(MenuInstanceId::new(SafeU53::new(next).map_err(
            |error| boxed(format!("{case}: menu allocator overflowed: {error}")),
        )?))
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
                "menu allocator seat count differs from allocator-before: expected {}, got {}",
                before.len(),
                plan.menu_allocators.len()
            ),
        )?;
        let projected_seats = plan
            .seats
            .iter()
            .map(|entry| entry.seat)
            .collect::<Vec<_>>();
        let allocator_seats = plan
            .menu_allocators
            .iter()
            .map(|allocator| allocator.seat)
            .collect::<Vec<_>>();
        require(
            case,
            projected_seats == allocator_seats,
            format!(
                "projected allocator seats differ from projected controls: expected {projected_seats:?}, got {allocator_seats:?}"
            ),
        )?;
        for previous in before {
            let actual = plan.allocator(previous.seat).ok_or_else(|| {
                boxed(format!(
                    "{case}: projected plan omitted allocator for canonical seat {}",
                    previous.seat
                ))
            })?;
            let expected = if consumed.contains(&previous.seat) {
                next_menu_instance(case, previous.next_menu_instance_id)?
            } else {
                previous.next_menu_instance_id
            };
            require(
                case,
                actual.next_menu_instance_id == expected,
                format!(
                    "allocator mismatch for seat {}: expected next {}, got {}",
                    previous.seat, expected, actual.next_menu_instance_id
                ),
            )?;
        }
        for allocator in &plan.menu_allocators {
            require(
                case,
                before
                    .iter()
                    .any(|previous| previous.seat == allocator.seat),
                format!(
                    "projected plan introduced allocator for unknown seat {}",
                    allocator.seat
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
            (true, false, false, false) | (true, false, true, false) => Ok("Command"),
            (false, true, false, false) | (false, true, true, false) => Ok("PartyReplacement"),
            (false, false, true, false) => Ok("Waiting"),
            (false, false, false, true) => Ok("Terminal"),
            shape => mismatch(
                case,
                format!("projected plan has mixed control shape {shape:?}"),
            ),
        }
    }

    fn actionable_command_owners(plan: &BattleControlPlan) -> Vec<u64> {
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
                owner.as_u64().ok_or_else(|| {
                    boxed(format!(
                        "{case}: pending command owner is not an unsigned seat"
                    ))
                })
            })
            .collect()
    }

    fn projected_cursor(case: &str, plan: &BattleControlPlan, kind: &str) -> TestResult<u64> {
        match kind {
            "Command" => {
                for entry in &plan.seats {
                    let root = match &entry.control {
                        BattleControl::CommandRoot(root) => root,
                        BattleControl::Waiting(_) => continue,
                        _ => {
                            return mismatch(
                                case,
                                "command plan contains a control other than CommandRoot or Waiting",
                            );
                        }
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
                        .ok_or_else(|| {
                            boxed(format!("{case}: selected command option is absent"))
                        })?;
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
            other => mismatch(
                case,
                format!("cannot derive cursor for control kind {other}"),
            ),
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
            format!(
                "projected plan wave differs: expected {expected_wave}, got {}",
                plan.wave
            ),
        )?;
        require(
            case,
            plan.turn.get().get() == expected_turn,
            format!(
                "projected plan turn differs: expected {expected_turn}, got {}",
                plan.turn
            ),
        )?;

        let expected_owners = expected_command_owners(case, control)?;
        let actual_owners = actionable_command_owners(plan);
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
                        return mismatch(
                            case,
                            "terminal control has an ongoing final-state outcome",
                        );
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
        let canonical_seats = human_seats(&battle.format)
            .map_err(|error| boxed(format!("{case}: could not derive human seats: {error}")))?;
        let frontier_command_seats = canonical_seats
            .iter()
            .copied()
            .filter(|seat| {
                battle.command_state.frontier.iter().any(|entry| {
                    entry.owner_seat == Some(*seat)
                        && matches!(&entry.status, CommandFrontierStatus::Pending)
                })
            })
            .collect::<Vec<_>>();
        let projected_command_seats = plan
            .seats
            .iter()
            .filter(|entry| matches!(&entry.control, BattleControl::CommandRoot(_)))
            .map(|entry| entry.seat)
            .collect::<Vec<_>>();
        require(
            case,
            frontier_command_seats == projected_command_seats,
            format!(
                "pending command frontier seats differ: expected {frontier_command_seats:?}, got {projected_command_seats:?}"
            ),
        )?;
        let mut pending_operation_ids = battle
            .command_state
            .frontier
            .iter()
            .filter(|entry| matches!(&entry.status, CommandFrontierStatus::Pending))
            .map(|entry| entry.operation_id.clone())
            .collect::<Vec<_>>();
        pending_operation_ids.sort_unstable();
        require(
            case,
            !pending_operation_ids.is_empty(),
            "command projection has no pending operation identities",
        )?;

        let mut consumed = Vec::new();
        for seat_control in &plan.seats {
            let matching_frontier = battle
                .command_state
                .frontier
                .iter()
                .filter(|entry| {
                    entry.owner_seat == Some(seat_control.seat)
                        && matches!(&entry.status, CommandFrontierStatus::Pending)
                })
                .collect::<Vec<_>>();
            require(
                case,
                matching_frontier.len() <= 1,
                format!(
                    "seat {} owns duplicate pending frontier entries",
                    seat_control.seat
                ),
            )?;
            let Some(frontier) = matching_frontier.first().copied() else {
                let waiting = match &seat_control.control {
                    BattleControl::Waiting(waiting) => waiting,
                    other => {
                        return mismatch(
                            case,
                            format!(
                                "non-pending command seat {} projected {other:?}, not Waiting",
                                seat_control.seat
                            ),
                        );
                    }
                };
                require(
                    case,
                    waiting.reason == WaitingReason::PartnerCommand
                        && waiting.operation_ids.as_slice() == pending_operation_ids.as_slice(),
                    format!(
                        "non-pending command seat {} waiting identity differs",
                        seat_control.seat
                    ),
                )?;
                require(
                    case,
                    seat_control.decision_operation_id.is_none()
                        && !seat_control.control.is_actionable(),
                    format!(
                        "non-pending command seat {} is incorrectly actionable",
                        seat_control.seat
                    ),
                )?;
                continue;
            };
            let root = match &seat_control.control {
                BattleControl::CommandRoot(root) => root,
                other => {
                    return mismatch(
                        case,
                        format!(
                            "seat {} projected non-command control {other:?}",
                            seat_control.seat
                        ),
                    );
                }
            };
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
                format!(
                    "seat {} command menu graph differs from canonical offer",
                    seat_control.seat
                ),
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
                format!(
                    "seat {} command control is not actionable/bound",
                    seat_control.seat
                ),
            )?;
            consumed.push(seat_control.seat);
        }
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
            .ok_or_else(|| {
                boxed(format!(
                    "{case}: replacement occurrence {occurrence} is absent"
                ))
            })?;
        let owner = faint
            .owner_seat
            .ok_or_else(|| boxed(format!("{case}: replacement occurrence has no human owner")))?;
        let operation_id =
            replacement_operation_id_for_occurrence(battle, occurrence).map_err(|error| {
                boxed(format!(
                    "{case}: production replacement operation could not be derived: {error}"
                ))
            })?;
        let owner_allocator = before
            .iter()
            .find(|allocator| allocator.seat == owner)
            .ok_or_else(|| {
                boxed(format!(
                    "{case}: missing replacement owner allocator-before"
                ))
            })?;
        let expected_projection =
            build_replacement_menu(battle, occurrence, owner_allocator.next_menu_instance_id)
                .map_err(|error| {
                    boxed(format!(
                        "{case}: production replacement menu failed: {error}"
                    ))
                })?;

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
                                    format!(
                                        "replacement owner projected {other:?}, not ReplacementSelect"
                                    ),
                                );
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
                                );
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
                            format!(
                                "non-owner seat {} is incorrectly actionable",
                                seat_control.seat
                            ),
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
                            );
                        }
                    };
                    require(
                        case,
                        waiting.reason == WaitingReason::ReplacementOwner
                            && waiting.operation_ids == vec![operation_id.clone()],
                        format!(
                            "no-legal waiting identity differs for seat {}",
                            seat_control.seat
                        ),
                    )?;
                    require(
                        case,
                        seat_control.decision_operation_id.is_none()
                            && !seat_control.control.is_actionable(),
                        format!(
                            "no-legal seat {} is incorrectly actionable",
                            seat_control.seat
                        ),
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
                        format!(
                            "terminal seat {} projected {other:?}, not Complete",
                            seat_control.seat
                        ),
                    );
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
                seat_control.decision_operation_id.is_none()
                    && !seat_control.control.is_actionable(),
                format!(
                    "terminal seat {} is incorrectly actionable",
                    seat_control.seat
                ),
            )?;
        }
        require_allocators(case, plan, before, &[])
    }

    fn compare_case(
        case: &str,
        source: &str,
        content: &er_content::pack::ContentPack,
    ) -> TestResult {
        let fixture = parse_fixture(case, source)?;
        let control = expected_control(case, &fixture)?;
        let state = parse_expected_final_state(case, &fixture, content)?;
        state.validate().map_err(|error| {
            boxed(format!(
                "{case}: expected final state failed validation: {error}"
            ))
        })?;
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
        let plan =
            project_battle_control_plan(&state, decision, &before, content).map_err(|error| {
                boxed(format!(
                    "{case}: production control projection failed for {decision:?}: {error}"
                ))
            })?;
        plan.validate().map_err(|error| {
            boxed(format!(
                "{case}: projected BattleControlPlan is invalid: {error}"
            ))
        })?;
        let projected_seats = plan
            .seats
            .iter()
            .map(|entry| entry.seat)
            .collect::<Vec<_>>();
        require(
            case,
            projected_seats.as_slice() == seats.as_slice(),
            format!(
                "projected plan does not cover canonical human seats: expected {seats:?}, got {projected_seats:?}"
            ),
        )?;
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
                require(
                    case,
                    kind == "Command",
                    format!("decision projected as {kind}"),
                )?;
                require(
                    case,
                    battle.outcome == BattleOutcome::Ongoing,
                    "command frontier is not ongoing",
                )?;
                compare_command_plan(case, &state, &plan, &before)?;
            }
            BattleNextDecision::Replacement { occurrence } => {
                require(
                    case,
                    kind == "PartyReplacement" || kind == "Waiting",
                    format!("replacement decision projected as {kind}"),
                )?;
                require(
                    case,
                    battle.outcome == BattleOutcome::Ongoing,
                    "replacement decision is not ongoing",
                )?;
                compare_replacement_plan(case, &state, occurrence, &plan, &before)?;
            }
            BattleNextDecision::Complete(outcome) => {
                require(
                    case,
                    kind == "Terminal",
                    format!("complete decision projected as {kind}"),
                )?;
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
