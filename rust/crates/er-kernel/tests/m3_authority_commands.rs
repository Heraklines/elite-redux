use std::error::Error;
use std::sync::Arc;

use er_battle::faint::{FaintCandidate, queue_faint};
use er_battle::legality::{
    build_command_offer, build_scripted_enemy_offer, validate_state_content,
};
use er_battle::{BattleNextDecision, compute_presentation_plan_digest};
use er_content::pack::{ContentPack, selected_content_pack};
use er_content::species::find_species;
use er_game::authority_commands::{
    AuthorityCommandError, CommandAdmissionResult, CommandFrontierCompletion, HumanAdmissionSource,
    PreparedAuthorityTurn, ReplacementAdmissionResult, admit_command_proposal,
    admit_replacement_proposal, admit_scripted_enemy_frontier, complete_command_frontier,
    internal_no_legal_replacement, retain_command_tombstones,
};
use er_game::internal_event::{GameIntent, InternalEvent, PreparedBattleResolution};
use er_game::material::{
    BATTLE_MATERIAL_SCHEMA_VERSION, BattleMaterialApplyError, BattleTurnMaterialV1,
    apply_reducer_issued_turn_material_trusted,
};
use er_game::runtime::GameRuntime;
use er_game::target_menu::build_target_control;
use er_rng::battle::BattleRngState;
use er_rng::phaser::{PhaserRdg, RunRngState};
use er_state::battle::{BattleOutcome, BattleState, CommandCollectionState};
use er_state::conditions::{
    GlobalAbilitySuppressionState, TerrainKind, TerrainState, WeatherKind, WeatherState,
};
use er_state::digest::MechanicalStateDigest;
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
    scripted_enemy_command_operation_id, turn_result_operation_id,
};
use er_types::battle_control::{
    BATTLE_CONTROL_PLAN_SCHEMA_VERSION, BattleControl, BattleControlPlan, BattleMenu,
    BattleMenuOption, CommandRootControl, MenuOptionLayout, MenuOptionVisibility,
    MoveSelectControl, ReplacementSelectControl, SeatBattleControl, SeatMenuInstanceAllocator,
};
use er_types::battle_ids::{
    AuthorityEpoch, BattleId, BattleSide, ContentPackHash, FaintOccurrenceId, FieldSlot,
    GameModeId, MenuInstanceId, MoveSlotIndex, PartyIndex, PokemonId, SpeciesId, TurnIndex,
    WaveIndex,
};
use er_types::battle_model::{FaintOccurrence, StatusKind};
use er_types::battle_ui::PresentationPlanDigest;
use er_types::{MenuOptionId, OperationId, SafeU53, SeatId};
use serde_json::json;

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn blank_non_newline_bytes(source: &[u8], sanitized: &mut [u8], start: usize, end: usize) {
    for index in start..end {
        if !matches!(source[index], b'\r' | b'\n') {
            sanitized[index] = b' ';
        }
    }
}

fn raw_string_start(source: &[u8], start: usize) -> Option<(usize, usize)> {
    let prefix_len = if source.get(start) == Some(&b'r') {
        1
    } else if matches!(source.get(start), Some(&b'b') | Some(&b'c'))
        && source.get(start + 1) == Some(&b'r')
    {
        2
    } else {
        return None;
    };

    let mut quote = start + prefix_len;
    let mut hash_count = 0;
    while source.get(quote) == Some(&b'#') {
        hash_count += 1;
        quote += 1;
    }
    (source.get(quote) == Some(&b'"')).then_some((quote + 1, hash_count))
}

fn raw_string_end(source: &[u8], start: usize) -> Option<usize> {
    let (content_start, hash_count) = raw_string_start(source, start)?;
    let mut index = content_start;
    while index < source.len() {
        if source[index] == b'"' {
            let mut closing = index + 1;
            let mut matched_hashes = 0;
            while matched_hashes < hash_count && source.get(closing) == Some(&b'#') {
                matched_hashes += 1;
                closing += 1;
            }
            if matched_hashes == hash_count {
                return Some(closing);
            }
        }
        index += 1;
    }
    Some(source.len())
}

fn string_quote_start(source: &[u8], start: usize) -> Option<usize> {
    if source.get(start) == Some(&b'"') {
        Some(start)
    } else if matches!(source.get(start), Some(&b'b') | Some(&b'c'))
        && source.get(start + 1) == Some(&b'"')
    {
        Some(start + 1)
    } else {
        None
    }
}

fn string_literal_end(source: &[u8], quote_start: usize) -> usize {
    let mut index = quote_start + 1;
    while index < source.len() {
        match source[index] {
            b'\\' => {
                index += 1;
                if index < source.len() {
                    index += 1;
                }
            }
            b'"' => return index + 1,
            _ => index += 1,
        }
    }
    source.len()
}

fn is_ascii_hex(byte: u8) -> bool {
    byte.is_ascii_hexdigit()
}

fn utf8_char_width(byte: u8) -> Option<usize> {
    match byte {
        0x00..=0x7f => Some(1),
        0xc2..=0xdf => Some(2),
        0xe0..=0xef => Some(3),
        0xf0..=0xf4 => Some(4),
        _ => None,
    }
}

fn char_literal_end(source: &[u8], quote_start: usize) -> Option<usize> {
    let mut index = quote_start + 1;
    let first = *source.get(index)?;
    if first == b'\\' {
        index += 1;
        match source.get(index) {
            Some(&b'u') if source.get(index + 1) == Some(&b'{') => {
                index += 2;
                let mut digits = 0;
                let mut closed = false;
                while let Some(&byte) = source.get(index) {
                    if byte == b'}' {
                        closed = (1..=6).contains(&digits);
                        index += 1;
                        break;
                    }
                    if !is_ascii_hex(byte) || digits == 6 {
                        return None;
                    }
                    digits += 1;
                    index += 1;
                }
                if !closed {
                    return None;
                }
            }
            Some(&b'x') => {
                index += 1;
                for _ in 0..2 {
                    match source.get(index) {
                        Some(&byte) if is_ascii_hex(byte) => index += 1,
                        _ => return None,
                    }
                }
            }
            Some(&byte) if !matches!(byte, b'\r' | b'\n') => index += 1,
            _ => return None,
        }
    } else {
        if matches!(first, b'\r' | b'\n') {
            return None;
        }
        let width = utf8_char_width(first)?;
        let end = index + width;
        if end > source.len()
            || !source[index + 1..end]
                .iter()
                .all(|byte| (byte & 0xc0) == 0x80)
        {
            return None;
        }
        index = end;
    }

    (source.get(index) == Some(&b'\'')).then_some(index + 1)
}

fn char_literal_quote_start(source: &[u8], start: usize) -> Option<usize> {
    if source.get(start) == Some(&b'\'') {
        Some(start)
    } else if source.get(start) == Some(&b'b') && source.get(start + 1) == Some(&b'\'') {
        Some(start + 1)
    } else {
        None
    }
}

fn sanitize_rust_source(source: &str) -> String {
    let source_bytes = source.as_bytes();
    let mut sanitized = source_bytes.to_vec();
    let mut index = 0;

    while index < source_bytes.len() {
        if source_bytes[index] == b'/' && source_bytes.get(index + 1) == Some(&b'/') {
            let mut end = index + 2;
            while end < source_bytes.len() && source_bytes[end] != b'\n' {
                end += 1;
            }
            blank_non_newline_bytes(source_bytes, &mut sanitized, index, end);
            index = end;
            continue;
        }

        if source_bytes[index] == b'/' && source_bytes.get(index + 1) == Some(&b'*') {
            let mut end = index + 2;
            let mut depth = 1;
            while end < source_bytes.len() && depth != 0 {
                if source_bytes[end] == b'/' && source_bytes.get(end + 1) == Some(&b'*') {
                    depth += 1;
                    end += 2;
                } else if source_bytes[end] == b'*' && source_bytes.get(end + 1) == Some(&b'/') {
                    depth -= 1;
                    end += 2;
                } else {
                    end += 1;
                }
            }
            blank_non_newline_bytes(source_bytes, &mut sanitized, index, end);
            index = end;
            continue;
        }

        if let Some(end) = raw_string_end(source_bytes, index) {
            blank_non_newline_bytes(source_bytes, &mut sanitized, index, end);
            index = end;
            continue;
        }

        if let Some(quote_start) = string_quote_start(source_bytes, index) {
            let end = string_literal_end(source_bytes, quote_start);
            blank_non_newline_bytes(source_bytes, &mut sanitized, index, end);
            index = end;
            continue;
        }

        if let Some(quote_start) = char_literal_quote_start(source_bytes, index)
            && let Some(end) = char_literal_end(source_bytes, quote_start)
        {
            blank_non_newline_bytes(source_bytes, &mut sanitized, index, end);
            index = end;
            continue;
        }

        index += 1;
    }

    String::from_utf8(sanitized).expect("source is valid UTF-8")
}

fn normalized_sanitized_source(source: &str) -> String {
    sanitize_rust_source(&source.replace("\r\n", "\n"))
}

fn unique_function_offset(source: &str, signature: &str) -> usize {
    let source = normalized_sanitized_source(source);
    assert_eq!(
        source.matches(signature).count(),
        1,
        "expected exactly one function signature {signature:?}",
    );

    let line_anchor = format!("\n{signature}");
    let mut matches = source.match_indices(&line_anchor);
    let first_match = matches.next();
    assert!(
        first_match.is_some(),
        "missing line-anchored function signature {signature:?}"
    );
    let Some((offset, _)) = first_match else {
        return 0;
    };
    assert!(
        matches.next().is_none(),
        "expected exactly one line-anchored function signature {signature:?}",
    );
    offset + 1
}

fn extract_function_section(source: &str, signature: &str, next_signature: &str) -> String {
    let source = normalized_sanitized_source(source);
    let start = unique_function_offset(&source, signature);
    let end = unique_function_offset(&source, next_signature);
    assert!(
        start < end,
        "function signature {signature:?} must precede {next_signature:?}",
    );
    source[start..end].to_owned()
}

#[test]
fn rust_source_sanitizer_masks_fake_signatures_and_preserves_code() {
    let source = concat!(
        "fn real() {\n",
        "// fn fake_line() {}\n",
        "/* fn fake_outer() { /* fn fake_nested() {} */ } */\n",
        "let raw = r###\"fn fake_raw() {}\"###;\n",
        "let normal = \"fn fake_normal() {}\";\n",
        "}\n",
    );
    let sanitized = sanitize_rust_source(source);

    assert_eq!(sanitized.len(), source.len());
    assert_eq!(
        sanitized.bytes().filter(|byte| *byte == b'\n').count(),
        source.bytes().filter(|byte| *byte == b'\n').count()
    );
    assert!(sanitized.contains("fn real()"));
    for fake in [
        "fn fake_line",
        "fn fake_outer",
        "fn fake_nested",
        "fn fake_raw",
        "fn fake_normal",
    ] {
        assert!(!sanitized.contains(fake), "sanitizer leaked {fake}");
    }
}

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

fn command_state_with_enemy_hp(
    content: &ContentPack,
    format: BattleFormat,
    enemy_hp: u32,
) -> TestResult<GameState> {
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
                enemy_hp,
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
        seats.push(SeatBattleControl::new(owner, Some(operation_id), control));
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
    command_fixture_with_enemy_hp(content, format, 100)
}

fn command_fixture_with_enemy_hp(
    content: &ContentPack,
    format: BattleFormat,
    enemy_hp: u32,
) -> TestResult<CommandFixture> {
    let mut state = command_state_with_enemy_hp(content, format, enemy_hp)?;
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
                battle.battle_id, battle.wave, battle.turn, position, owner, proposal_control_kind,
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

struct PreparedTurnFixture {
    content: ContentPack,
    current_state: GameState,
    local_seat: SeatId,
    menu_allocators: Vec<SeatMenuInstanceAllocator>,
    prepared: PreparedAuthorityTurn,
    material: BattleTurnMaterialV1,
}

fn material_from_prepared(
    prepared: &PreparedAuthorityTurn,
    content: &ContentPack,
) -> TestResult<BattleTurnMaterialV1> {
    let transition = prepared.transition();
    let before_battle = transition
        .before_state
        .battle
        .as_ref()
        .ok_or("prepared TURN has no before battle")?;
    let after_battle = transition
        .after_state
        .battle
        .as_ref()
        .ok_or("prepared TURN has no after battle")?;
    Ok(BattleTurnMaterialV1 {
        schema_version: BATTLE_MATERIAL_SCHEMA_VERSION,
        oracle_game_sha: content.oracle_game_sha.clone(),
        content_hash: content.hash.clone(),
        operation_id: turn_result_operation_id(
            before_battle.battle_id,
            before_battle.wave,
            before_battle.turn,
        )?,
        battle_id: before_battle.battle_id,
        wave: before_battle.wave,
        resolved_turn: before_battle.turn,
        before_digest: transition.before_digest.clone(),
        after_digest: transition.after_digest.clone(),
        commands: transition.accepted_commands.clone(),
        action_order: transition.action_order.clone(),
        mutations: transition.mutations.clone(),
        presentation: transition.presentation.clone(),
        presentation_digest: compute_presentation_plan_digest(&transition.presentation)?,
        rng_before: before_battle.battle_rng.clone(),
        rng_after: after_battle.battle_rng.clone(),
        rng_audit: transition.rng_audit.clone(),
        before_state: transition.before_state.clone(),
        after_state: transition.after_state.clone(),
        outcome: transition.outcome,
        next_decision: transition.next_decision,
        menu_allocators_before: prepared.admission().allocator_before().to_vec(),
        next_control: prepared.control_plan().clone(),
    })
}

fn prepared_turn_fixture() -> TestResult<PreparedTurnFixture> {
    let content = selected_content_pack()?;
    // Keep the existing scripted command, but make this one-turn fixture
    // terminal so the runtime does not need an unmodeled next-turn script.
    let fixture = command_fixture_with_enemy_hp(&content, BattleFormat::single(), 1)?;
    let scripted = admit_scripted_enemy_frontier(&fixture.state, &fixture.enemy_policy, &content)?;
    let proposal = fixture
        .human_proposals
        .first()
        .cloned()
        .ok_or("command fixture has no human proposal")?;
    let mut runtime = GameRuntime::from_parts(
        scripted.state,
        fixture.control,
        seat(1)?,
        scripted.policy,
        Vec::new(),
        Vec::new(),
        Arc::new(content.clone()),
    )?;
    let reduction = runtime.reduce(GameIntent::CommandProposal {
        proposal,
        authority_epoch: AuthorityEpoch::new(safe(1)?),
    })?;
    let resolution = reduction
        .events
        .into_iter()
        .find_map(|event| match event {
            InternalEvent::BattleResolved(payload) => Some(payload.resolution),
            _ => None,
        })
        .ok_or("runtime did not emit a prepared TURN")?;
    let PreparedBattleResolution::Turn {
        digest_evidence,
        material_operation_id,
        next_control,
    } = resolution
    else {
        return Err("runtime emitted a non-TURN resolution".into());
    };
    let prepared =
        runtime.prepare_authority_turn(digest_evidence, &material_operation_id, next_control)?;
    if runtime.state() != &prepared.transition().before_state {
        return Err("prepared TURN before state differs from runtime state".into());
    }
    let current_state = runtime.state().clone();
    let local_seat = runtime.local_seat();
    let menu_allocators = runtime.control().menu_allocators.clone();
    let material = material_from_prepared(&prepared, &content)?;
    Ok(PreparedTurnFixture {
        content,
        current_state,
        local_seat,
        menu_allocators,
        prepared,
        material,
    })
}

// Keep this destructuring exhaustive: adding a material field must update the
// fixture and the mutation table below before this test can compile.
fn assert_material_field_inventory(material: &BattleTurnMaterialV1) {
    let BattleTurnMaterialV1 {
        schema_version,
        oracle_game_sha,
        content_hash,
        operation_id,
        battle_id,
        wave,
        resolved_turn,
        before_digest,
        after_digest,
        commands,
        action_order,
        mutations,
        presentation,
        presentation_digest,
        rng_before,
        rng_after,
        rng_audit,
        before_state,
        after_state,
        outcome,
        next_decision,
        menu_allocators_before,
        next_control,
    } = material;
    let _ = (
        schema_version,
        oracle_game_sha,
        content_hash,
        operation_id,
        battle_id,
        wave,
        resolved_turn,
        before_digest,
        after_digest,
        commands,
        action_order,
        mutations,
        presentation,
        presentation_digest,
        rng_before,
        rng_after,
        rng_audit,
        before_state,
        after_state,
        outcome,
        next_decision,
        menu_allocators_before,
        next_control,
    );
}

fn tampered_content_hash() -> ContentPackHash {
    ContentPackHash::new(format!("blake3-v1:{}", "0".repeat(64)))
        .expect("tampered content hash must be well-formed")
}

fn tampered_state_digest() -> MechanicalStateDigest {
    MechanicalStateDigest::new(format!("blake3-v1:{}", "0".repeat(64)))
        .expect("tampered state digest must be well-formed")
}

fn tampered_presentation_digest() -> PresentationPlanDigest {
    PresentationPlanDigest::new(format!("blake3-v1:{}", "0".repeat(64)))
        .expect("tampered presentation digest must be well-formed")
}

fn replace_run_rng(state: &mut GameState, seed: &str) {
    state.run_rng = RunRngState {
        rdg: PhaserRdg::from_seed(seed).state(),
    };
}

fn increment_first_menu_allocator(plan: &mut BattleControlPlan) {
    let schema_version = plan.schema_version;
    let battle_id = plan.battle_id;
    let wave = plan.wave;
    let turn = plan.turn;
    let seats = plan.seats.clone();
    let mut allocators = plan.menu_allocators.clone();
    let allocator = allocators
        .first_mut()
        .expect("fixture has a menu allocator");
    let seat = allocator.seat;
    let next_value = allocator
        .next_menu_instance_id
        .get()
        .get()
        .checked_add(1)
        .and_then(|value| SafeU53::new(value).ok())
        .expect("fixture menu allocator can advance");
    *allocator = SeatMenuInstanceAllocator::new(seat, MenuInstanceId::new(next_value))
        .expect("advanced menu allocator is valid");
    *plan = BattleControlPlan::new(schema_version, battle_id, wave, turn, seats, allocators)
        .expect("allocator-only control mutation is valid");
}

#[test]
fn authority_local_material_binding_rejects_each_turn_material_field_mutation() -> TestResult {
    let fixture = prepared_turn_fixture()?;
    assert_material_field_inventory(&fixture.material);
    let apply = |material: &BattleTurnMaterialV1| {
        apply_reducer_issued_turn_material_trusted(
            &fixture.current_state,
            fixture.local_seat,
            &fixture.menu_allocators,
            material,
            &fixture.content,
            &fixture.prepared,
        )
    };

    let baseline = apply(&fixture.material);
    assert!(
        baseline.is_ok(),
        "valid prepared TURN material was rejected: {baseline:?}"
    );

    type Mutation = (&'static str, fn(&mut BattleTurnMaterialV1));
    let mutations: [Mutation; 23] = [
        ("schema_version", |material| material.schema_version = 0),
        ("oracle_game_sha", |material| {
            material.oracle_game_sha.push_str("-tampered");
        }),
        ("content_hash", |material| {
            material.content_hash = tampered_content_hash();
        }),
        ("operation_id", |material| {
            material.operation_id =
                OperationId::new("material/tampered").expect("tampered operation is valid");
        }),
        ("battle_id", |material| {
            material.battle_id = BattleId::new(SafeU53::new(99).expect("safe value"));
        }),
        ("wave", |material| {
            material.wave =
                WaveIndex::new(SafeU53::new(99).expect("safe value")).expect("positive wave");
        }),
        ("resolved_turn", |material| {
            material.resolved_turn =
                TurnIndex::new(SafeU53::new(99).expect("safe value")).expect("positive turn");
        }),
        ("before_digest", |material| {
            material.before_digest = tampered_state_digest();
        }),
        ("after_digest", |material| {
            material.after_digest = tampered_state_digest();
        }),
        ("commands", |material| material.commands.entries.clear()),
        ("action_order", |material| material.action_order.clear()),
        ("mutations", |material| material.mutations.clear()),
        ("presentation", |material| material.presentation.clear()),
        ("presentation_digest", |material| {
            material.presentation_digest = tampered_presentation_digest();
        }),
        ("rng_before", |material| {
            material.rng_before = BattleRngState::new("tampered", material.rng_before.turn);
        }),
        ("rng_after", |material| {
            material.rng_after = BattleRngState::new("tampered", material.rng_after.turn);
        }),
        ("rng_audit", |material| material.rng_audit.clear()),
        ("before_state", |material| {
            replace_run_rng(&mut material.before_state, "tampered-before-state");
        }),
        ("after_state", |material| {
            replace_run_rng(&mut material.after_state, "tampered-after-state");
        }),
        ("outcome", |material| {
            material.outcome = match material.outcome {
                BattleOutcome::Ongoing => BattleOutcome::Victory,
                BattleOutcome::Victory => BattleOutcome::Defeat,
                BattleOutcome::Defeat => BattleOutcome::Ongoing,
            };
        }),
        ("next_decision", |material| {
            material.next_decision = if matches!(
                material.next_decision,
                BattleNextDecision::Complete(BattleOutcome::Victory)
            ) {
                BattleNextDecision::Complete(BattleOutcome::Defeat)
            } else {
                BattleNextDecision::Complete(BattleOutcome::Victory)
            };
        }),
        ("menu_allocators_before", |material| {
            material.menu_allocators_before.clear();
        }),
        ("next_control", |material| {
            increment_first_menu_allocator(&mut material.next_control);
        }),
    ];

    let serialized = serde_json::to_value(&fixture.material)?;
    let mut serialized_fields = serialized
        .as_object()
        .ok_or("serialized TURN material is not an object")?
        .keys()
        .map(|field| field.as_str())
        .collect::<Vec<_>>();
    serialized_fields.sort_unstable();
    let mut mutation_fields = mutations
        .iter()
        .map(|(field, _)| *field)
        .collect::<Vec<_>>();
    mutation_fields.sort_unstable();
    assert_eq!(
        mutation_fields, serialized_fields,
        "mutation labels must exactly cover serialized TURN material fields"
    );

    for (field, mutate) in mutations {
        let mut candidate = fixture.material.clone();
        mutate(&mut candidate);
        assert_ne!(
            candidate, fixture.material,
            "{field} mutation did not change the fixture"
        );
        let before_validity = validate_state_content(&candidate.before_state, &fixture.content);
        assert!(
            before_validity.is_ok(),
            "{field} mutation produced an invalid before_state: {before_validity:?}"
        );
        let after_validity = validate_state_content(&candidate.after_state, &fixture.content);
        assert!(
            after_validity.is_ok(),
            "{field} mutation produced an invalid after_state: {after_validity:?}"
        );
        let control_validity = candidate.next_control.validate();
        assert!(
            control_validity.is_ok(),
            "{field} mutation produced an invalid next_control: {control_validity:?}"
        );
        if field == "before_state" {
            assert_ne!(candidate.before_state, fixture.material.before_state);
        } else if field == "after_state" {
            assert_ne!(candidate.after_state, fixture.material.after_state);
        } else if field == "next_control" {
            assert_ne!(candidate.next_control, fixture.material.next_control);
        }
        let rejection = apply(&candidate);
        assert!(
            rejection.is_err(),
            "binder accepted an independently mutated {field} field"
        );
        if matches!(field, "before_state" | "after_state" | "next_control") {
            assert_eq!(
                rejection.as_ref().err(),
                Some(&BattleMaterialApplyError::InvalidEvidence),
                "{field} mutation did not reach the prepared-evidence comparison"
            );
        }
    }
    Ok(())
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

    let authority_source = normalized_sanitized_source(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../er-game/src/authority_commands.rs"
    )));
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
    let source = normalized_sanitized_source(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/battle_authority.rs"
    )));
    let prepared = source
        .find("let candidate = prepared.transition();")
        .ok_or("GameRuntime prepared TURN seam missing")?;
    let codec = source
        .find("let (decoded, payload, material_bytes) = encode_decode_material(&material)?")
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
    assert!(source.contains("apply_reducer_issued_turn_material_trusted as apply_turn_material"));
    let replacement_start =
        unique_function_offset(&source, "pub(crate) fn prepare_authority_replacement(");
    let turn_source = extract_function_section(
        &source,
        "pub(crate) fn prepare_authority_turn(",
        "pub(crate) fn prepare_authority_replacement(",
    );
    assert_eq!(
        turn_source
            .matches("validate_admitted_command_frontier_trusted(")
            .count(),
        1,
        "TURN hot path must call trusted frontier validation exactly once"
    );
    assert!(
        turn_source.contains(
            "validate_admitted_command_frontier_trusted(scripted_state.as_ref(), content)?"
        )
    );
    assert_eq!(
        turn_source
            .matches("complete_command_frontier(scripted_state.as_ref(), content)?")
            .count(),
        1,
        "TURN hot path must complete the scripted frontier exactly once"
    );
    let applier_start =
        unique_function_offset(&turn_source, "    let applied = apply_turn_material(");
    let applier_end = unique_function_offset(
        &turn_source,
        "    .map_err(AuthorityTransactionError::MaterialApply)?;",
    );
    let applier_source = &turn_source[applier_start..applier_end];
    assert!(applier_source.contains("&prepared,"));
    assert_eq!(
        applier_source.matches("complete_state.as_ref(),").count(),
        1,
        "TURN material applier must receive the completed state"
    );
    assert_eq!(
        applier_source.matches("&allocators,").count(),
        1,
        "TURN material applier must receive the advanced allocators"
    );
    assert!(
        turn_source.contains("validate_control_allocator_projection(next_control, &allocators)?")
    );
    assert_eq!(
        turn_source
            .matches("validate_control_allocator_projection(")
            .count(),
        1,
        "TURN audit must bind allocator projection inside prepare_authority_turn"
    );
    assert!(
        source[replacement_start..]
            .contains("validate_control_allocator_projection(&next_control, &allocators)?")
    );
    assert!(source.contains("prepared_admission.allocator_before() != allocators.as_slice()"));
    assert!(source.contains("admit_scripted_if_pending"));
    assert!(turn_source.contains(
        "let (complete_state, completed_commands): (Cow<GameState>, _) = if let Some(validated) ="
    ));
    assert!(source.contains("protocol_next_control_from_plan"));
    assert!(source.contains("admit_command_proposal_with_context"));
    assert!(source.contains("admit_replacement_proposal_with_context"));
    assert!(source.contains("replacement_fingerprints.entries()"));
    assert!(source.contains("ReplacementAdmissionResult::Duplicate { .. }"));
    assert!(!source.contains("return Err(AuthorityTransactionError::Duplicate"));
    let scripted_source = extract_function_section(
        &source,
        "fn admit_scripted_if_pending<'a>(",
        "fn validate_prepared_projection(",
    );
    assert_eq!(
        scripted_source
            .matches("Cow::Borrowed(state), Cow::Borrowed(policy)")
            .count(),
        1,
        "scripted admission helper must preserve its borrowed no-op path"
    );
    for required in [
        "(Cow::Borrowed(state), commands)",
        "(Cow::Owned(state), commands)",
    ] {
        assert_eq!(
            turn_source.matches(required).count(),
            1,
            "TURN authority adapter is missing the required {required} seam"
        );
    }
    assert!(source.contains("candidate.accepted_commands != completed_state_commands"));
    assert!(source.contains("if candidate.before_state != *complete_state.as_ref()"));
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
    let prepared_start =
        unique_function_offset(&source, "pub(crate) struct AuthorityPreparedTransaction {");
    let prepared_end = unique_function_offset(&source, "pub(crate) enum PreparedMaterial {");
    assert!(source[prepared_start..prepared_end].contains("scripted_policy_after"));
    let take_entry_start = unique_function_offset(
        &source,
        "    pub(crate) fn take_prepared_entry(&mut self) -> PreparedAuthorityEntry {",
    );
    let take_entry_end = unique_function_offset(
        &source,
        "    pub(crate) fn operation_id(&self) -> &OperationId {",
    );
    let take_entry_source = &source[take_entry_start..take_entry_end];
    assert_eq!(
        take_entry_source
            .lines()
            .filter(|line| *line == "        PreparedAuthorityEntry {")
            .count(),
        1,
        "authority adapter must have one crate-private production authority-preparation construction seam"
    );
    assert!(
        source.contains("pub(crate) fn take_prepared_entry(&mut self) -> PreparedAuthorityEntry")
    );
    assert!(source.contains("material_bytes: std::mem::take(&mut self.material_bytes)"));
    let input_start =
        unique_function_offset(&source, "pub(crate) struct AuthorityTransactionInput<'a> {");
    let input_end = unique_function_offset(&source, "pub(crate) struct AuthorityTurnRequest {");
    let input_source = &source[input_start..input_end];
    for required in [
        "pub state: &'a GameState",
        "pub control: &'a BattleControlPlan",
        "pub menu_allocators: &'a [SeatMenuInstanceAllocator]",
        "pub scripted_policy: &'a ScriptedEnemyPolicyV1",
    ] {
        assert!(
            input_source.contains(required),
            "authority transaction input is missing {required}"
        );
    }
    let kernel_source = normalized_sanitized_source(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/battle_kernel.rs"
    )));
    assert!(kernel_source.contains("prepared.take_prepared_entry()"));
    assert!(!kernel_source.contains("PreparedAuthorityEntry {"));
    assert!(!kernel_source.contains("take_material_bytes"));
    assert!(!kernel_source.contains("material_bytes"));
    let resolved_start = kernel_source
        .find("fn reduce_battle_resolved(")
        .ok_or("BattleKernel battle-resolved reducer missing")?;
    let resolved_end = kernel_source
        .find("fn reduce_authority_ready(")
        .ok_or("BattleKernel authority-ready reducer missing")?;
    let resolved_source = &kernel_source[resolved_start..resolved_end];
    let turn_branch_start = resolved_source
        .find("PreparedBattleResolution::Turn {")
        .ok_or("TURN battle-resolution branch missing")?;
    let replacement_branch_start = resolved_source
        .find("PreparedBattleResolution::Replacement {")
        .ok_or("REPLACEMENT battle-resolution branch missing")?;
    assert!(turn_branch_start < replacement_branch_start);
    let resolved_turn_source = &resolved_source[turn_branch_start..replacement_branch_start];
    let resolved_replacement_source = &resolved_source[replacement_branch_start..];
    assert_eq!(
        resolved_source
            .matches("let input = AuthorityTransactionInput {")
            .count(),
        2,
        "BattleKernel resolved reducer must prepare both TURN and REPLACEMENT inputs"
    );
    assert_eq!(
        resolved_turn_source
            .matches("let input = AuthorityTransactionInput {")
            .count(),
        1,
        "TURN battle-resolution branch must prepare one borrowed input"
    );
    assert_eq!(
        resolved_replacement_source
            .matches("let input = AuthorityTransactionInput {")
            .count(),
        1,
        "REPLACEMENT battle-resolution branch must prepare one borrowed input"
    );
    let turn_input_start = resolved_turn_source
        .find("let input = AuthorityTransactionInput {")
        .ok_or("TURN authority transaction input initializer missing")?;
    let turn_input_end = resolved_turn_source[turn_input_start..]
        .find("\n                };")
        .map(|offset| turn_input_start + offset)
        .ok_or("TURN authority transaction input initializer end missing")?;
    let replacement_input_start = resolved_replacement_source
        .find("let input = AuthorityTransactionInput {")
        .ok_or("REPLACEMENT authority transaction input initializer missing")?;
    let replacement_input_end = resolved_replacement_source[replacement_input_start..]
        .find("\n                };")
        .map(|offset| replacement_input_start + offset)
        .ok_or("REPLACEMENT authority transaction input initializer end missing")?;
    let turn_input_source = &resolved_turn_source[turn_input_start..turn_input_end];
    let replacement_input_source =
        &resolved_replacement_source[replacement_input_start..replacement_input_end];
    for forbidden in [
        ".state().clone()",
        ".control().clone()",
        ".scripted_enemy_policy().clone()",
        ".control().menu_allocators.clone()",
    ] {
        assert!(
            !resolved_source.contains(forbidden),
            "BattleKernel authority reducer must not clone {forbidden}"
        );
    }
    for required in [
        "state: self.staged.game.state(),",
        "control: self.staged.game.control(),",
        "menu_allocators: &self.staged.game.control().menu_allocators,",
        "scripted_policy: self.staged.game.scripted_enemy_policy(),",
    ] {
        assert_eq!(
            resolved_source.matches(required).count(),
            2,
            "BattleKernel authority reducer must borrow {required} for TURN and REPLACEMENT"
        );
        assert_eq!(
            turn_input_source.matches(required).count(),
            1,
            "TURN authority reducer input is missing {required}"
        );
        assert_eq!(
            replacement_input_source.matches(required).count(),
            1,
            "REPLACEMENT authority reducer input is missing {required}"
        );
    }
    let ready_start = kernel_source
        .find("let prepared_entry = prepared.take_prepared_entry();")
        .ok_or("BattleKernel FIFO payload handoff missing")?;
    let ready_end = kernel_source
        .find("fn reduce_authority_ready(")
        .ok_or("BattleKernel authority-ready reducer missing")?;
    let ready_source = &kernel_source[ready_start..ready_end];
    assert!(!ready_source.contains("canonical_bytes"));
    assert!(!ready_source.contains("fnv1a"));
    let published_start =
        unique_function_offset(&source, "pub(crate) struct AuthorityPublishedTransaction {");
    let published_end = unique_function_offset(&source, "pub(crate) fn prepare_authority_turn(");
    assert!(source[published_start..published_end].contains("scripted_policy_after"));
    assert!(source.contains("require_turn_equivalence(candidate, &decoded, &applied)?"));
    assert!(source.contains("require_replacement_equivalence(&candidate, &decoded, &applied)?"));
    assert!(source.contains("stored.source.turn_occurrence"));
    Ok(())
}

#[test]
fn authority_local_material_binding_covers_every_reused_field_and_endpoint_guard() -> TestResult {
    let material_source = normalized_sanitized_source(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../er-game/src/material.rs"
    )));
    let binding = extract_function_section(
        &material_source,
        "fn bind_reducer_issued_turn_material<'a>(",
        "fn apply_bound_reducer_turn_material(",
    );
    let reducer = extract_function_section(
        &material_source,
        "pub fn apply_reducer_issued_turn_material_trusted(",
        "fn bind_reducer_issued_turn_material<'a>(",
    );
    let applied = extract_function_section(
        &material_source,
        "fn apply_bound_reducer_turn_material(",
        "fn apply_turn_material_inner(",
    );

    for reused_field in [
        "material.operation_id != expected_operation",
        "material.battle_id != before_battle.battle_id",
        "material.wave != before_battle.wave",
        "material.resolved_turn != before_battle.turn",
        "material.before_state != transition.before_state",
        "material.before_digest != transition.before_digest",
        "material.after_state != transition.after_state",
        "material.after_digest != transition.after_digest",
        "material.commands != transition.accepted_commands",
        "material.action_order != transition.action_order",
        "material.mutations != transition.mutations",
        "material.presentation != transition.presentation",
        "material.presentation_digest != expected_presentation_digest",
        "material.rng_before != before_battle.battle_rng",
        "material.rng_after != after_battle.battle_rng",
        "material.rng_audit != transition.rng_audit",
        "material.outcome != transition.outcome",
        "material.next_decision != transition.next_decision",
        "material.menu_allocators_before.as_slice() != prepared_allocators",
        "material.menu_allocators_before.as_slice() != menu_allocators",
        "&material.next_control != prepared.control_plan()",
    ] {
        assert!(
            binding.contains(reused_field),
            "authority-local material binding omitted tamper guard {reused_field}"
        );
    }
    for retained_endpoint_guard in [
        "validate_material_header(",
        "validate_turn_identity(material)?",
        "current_state != &transition.before_state",
        "validate_endpoint_allocators(",
        "prepared.bind_authority_local_turn(",
    ] {
        assert!(
            binding.contains(retained_endpoint_guard),
            "authority-local material binding omitted {retained_endpoint_guard}"
        );
    }
    assert!(reducer.contains("bind_reducer_issued_turn_material("));
    assert!(reducer.contains("apply_bound_reducer_turn_material(material, proof)"));
    for candidate_assertion in [
        "transition.after_state != material.after_state",
        "transition.after_digest != material.after_digest",
        "transition.presentation != material.presentation",
        "transition.outcome != material.outcome",
        "transition.next_decision != material.next_decision",
        "proof.control_plan() != &material.next_control",
        "proof.control_plan().menu_allocators.as_slice()",
    ] {
        assert!(
            applied.contains(candidate_assertion),
            "authority-local result lost candidate equality assertion {candidate_assertion}"
        );
    }
    for decoded_output in [
        "after_state: material.after_state.clone()",
        "after_digest: material.after_digest.clone()",
        "presentation: material.presentation.clone()",
        "presentation_digest: material.presentation_digest.clone()",
        "outcome: material.outcome",
        "next_decision: material.next_decision",
        "next_control: material.next_control.clone()",
        "menu_allocators: material.next_control.menu_allocators.clone()",
    ] {
        assert!(
            applied.contains(decoded_output),
            "authority-local result does not source {decoded_output} from decoded material"
        );
    }
    for forbidden_replay in [
        "apply_turn_material_inner(",
        "validate_turn_commands(",
        "validate_after_state_and_digest(",
        "validate_turn_evidence(",
        "validate_turn_rng(",
    ] {
        assert!(
            !reducer.contains(forbidden_replay),
            "authority-local reducer-issued path still replays {forbidden_replay}"
        );
    }
    assert!(!material_source.contains("DigestValidationMode::ReducerIssued"));
    assert!(material_source.contains("DigestValidationMode::Independent"));
    let authority_source = normalized_sanitized_source(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/battle_authority.rs"
    )));
    assert!(authority_source.contains("require_turn_equivalence(candidate, &decoded, &applied)?"));
    Ok(())
}
