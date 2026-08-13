// M3C-09 local raw-key campaigns against the public Battle kernel boundary.
//
// The command driver below deliberately knows only physical keydown/keyup
// events.  Presentation settlement is kept outside that driver because it is
// a renderer/environment callback, not a semantic command-selection escape
// hatch.

use std::error::Error;
use std::sync::Arc;

use er_kernel::{
    BattleGameConfig, BattleProtocolConfig, BattleProtocolRoleConfig, BattleStartV1, GameKernel,
    KernelEffect, KernelInput,
};
use er_protocol::{AuthorityLogConfig, BackoffPolicy};
use er_testkit::m3_fixture::load_m3_fixture_catalog;
use er_types::battle_command::{
    BattleCommand, BattleTargetSelection, ScriptedEnemyBattleCommandV1, ScriptedEnemyPolicyV1,
    scripted_enemy_command_operation_id,
};
use er_types::battle_control::BattleControl;
use er_types::battle_ids::{BattleId, BattleSide, FieldSlot, MoveSlotIndex, TurnIndex, WaveIndex};
use er_types::battle_model::BattleOutcome;
use er_types::battle_ui::{
    BattlePresentationEvent, BattlePresentationKind, PresentationSettlementOutcome,
};
use er_types::{
    ConnectionGeneration, FrameContext, InputFocus, MembershipRevision, PhysicalKey, RawInputEvent,
    RunId, SafeU53, SeatId, SessionId, TimeClass,
};
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

#[derive(Clone, Debug)]
struct BattleFixture {
    fixture: Value,
}

fn invalid_data(message: impl Into<String>) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message.into())
}

fn field<'a>(object: &'a Value, key: &str) -> TestResult<&'a Value> {
    object
        .get(key)
        .ok_or_else(|| invalid_data(format!("fixture is missing field {key:?}")))
        .map_err(Into::into)
}

fn is_status_kind_tag(tag: &str) -> bool {
    matches!(
        tag,
        "NONE" | "POISON" | "TOXIC" | "PARALYSIS" | "SLEEP" | "BURN"
    )
}

const LEGACY_ORACLE_CONTENT_DIGEST: &str =
    "3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";
const LEGACY_ORACLE_CONTENT_HASH: &str =
    "blake3-v1:3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";

fn normalize_legacy_status_kind(path: &str, status: &mut Value) -> TestResult {
    let status_object = status
        .as_object_mut()
        .ok_or_else(|| invalid_data(format!("{path} is not an object")))?;
    let kind = status_object
        .get("kind")
        .cloned()
        .ok_or_else(|| invalid_data(format!("{path}.kind is missing")))?;
    let normalized = match kind {
        Value::String(tag) if is_status_kind_tag(&tag) => Value::String(tag),
        Value::String(tag) => {
            return Err(invalid_data(format!("{path}.kind has unsupported value {tag:?}")).into());
        }
        Value::Object(wrapper) => {
            if wrapper.len() != 1 || !wrapper.contains_key("kind") {
                return Err(invalid_data(format!(
                    "{path}.kind has an unsupported nested wrapper shape"
                ))
                .into());
            }
            let tag = wrapper
                .get("kind")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid_data(format!("{path}.kind.kind is not a string")))?;
            if !is_status_kind_tag(tag) {
                return Err(invalid_data(format!(
                    "{path}.kind.kind has unsupported value {tag:?}"
                ))
                .into());
            }
            Value::String(tag.to_owned())
        }
        other => {
            return Err(invalid_data(format!("{path}.kind has unsupported value {other}")).into());
        }
    };
    status_object.insert("kind".to_owned(), normalized);
    Ok(())
}

fn normalize_legacy_battle_statuses(state_name: &str, battle: &mut Value) -> TestResult {
    for party_name in ["player_party", "enemy_party"] {
        let party = field_mut(battle, party_name)?
            .as_array_mut()
            .ok_or_else(|| {
                invalid_data(format!(
                    "{state_name}.canonical.battle.{party_name} is not an array"
                ))
            })?;
        for (index, pokemon) in party.iter_mut().enumerate() {
            let status = field_mut(pokemon, "status")?;
            normalize_legacy_status_kind(
                &format!("{state_name}.canonical.battle.{party_name}[{index}].status"),
                status,
            )?;
        }
    }
    Ok(())
}

fn normalize_legacy_adjacent_kind(path: &str, kind: Value) -> TestResult<Value> {
    match kind {
        Value::String(tag) if tag == "NONE" => Ok(json!({"kind": tag})),
        Value::String(tag) => {
            Err(invalid_data(format!("{path} has unsupported legacy value {tag:?}")).into())
        }
        Value::Object(wrapper) => {
            let tag = wrapper
                .get("kind")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid_data(format!("{path}.kind is not a string")))?;
            let valid_shape = match tag {
                "NONE" => wrapper.len() == 1,
                "UNSUPPORTED_ORACLE_CODE" => {
                    wrapper.len() == 2
                        && wrapper
                            .get("value")
                            .and_then(Value::as_u64)
                            .is_some_and(|value| u16::try_from(value).is_ok())
                }
                _ => false,
            };
            if !valid_shape {
                return Err(
                    invalid_data(format!("{path} has an invalid adjacent kind object")).into(),
                );
            }
            Ok(Value::Object(wrapper))
        }
        other => Err(invalid_data(format!("{path} has unsupported value {other}")).into()),
    }
}

fn normalize_legacy_adjacent_field(path: &str, object: &mut Value, field_name: &str) -> TestResult {
    let object = object
        .as_object_mut()
        .ok_or_else(|| invalid_data(format!("{path} is not an object")))?;
    let kind = object
        .get(field_name)
        .cloned()
        .ok_or_else(|| invalid_data(format!("{path}.{field_name} is missing")))?;
    let normalized = normalize_legacy_adjacent_kind(&format!("{path}.{field_name}"), kind)?;
    object.insert(field_name.to_owned(), normalized);
    Ok(())
}

fn normalize_legacy_battle_conditions(state_name: &str, battle: &mut Value) -> TestResult {
    for condition_name in ["weather", "terrain"] {
        let condition = field_mut(battle, condition_name)?;
        let condition_object = condition.as_object().ok_or_else(|| {
            invalid_data(format!(
                "{state_name}.canonical.battle.{condition_name} is not an object"
            ))
        })?;
        if condition_object.len() != 2
            || !condition_object.contains_key("kind")
            || !condition_object.contains_key("remaining_turns")
        {
            return Err(invalid_data(format!(
                "{state_name}.canonical.battle.{condition_name} has extra or missing fields"
            ))
            .into());
        }
        normalize_legacy_adjacent_field(
            &format!("{state_name}.canonical.battle.{condition_name}"),
            condition,
            "kind",
        )?;
    }
    Ok(())
}

fn normalize_legacy_fixture_statuses(fixture: &mut Value) -> TestResult {
    for state_name in ["initial_state", "expected_final_state"] {
        let state = field_mut(fixture, state_name)?;
        let canonical = field_mut(state, "canonical")?;
        let battle = field_mut(canonical, "battle")?;
        normalize_legacy_battle_statuses(state_name, battle)?;
        normalize_legacy_battle_conditions(state_name, battle)?;
    }
    Ok(())
}

fn normalize_legacy_type_chart(
    content_pack: &mut Value,
    selected: &er_content::pack::ContentPack,
) -> TestResult {
    let expected_entries = serde_json::to_value(&selected.type_chart.entries)?
        .as_array()
        .cloned()
        .ok_or_else(|| invalid_data("selected type chart entries are not an array"))?;
    let type_chart = field_mut(content_pack, "type_chart")?;
    let entries = field_mut(type_chart, "entries")?
        .as_array_mut()
        .ok_or_else(|| invalid_data("published type chart entries are not an array"))?;
    let legacy_entries = entries.clone();
    if legacy_entries.len() != expected_entries.len() {
        return Err(
            invalid_data("published type chart entry count differs from selected content").into(),
        );
    }
    for (index, expected) in expected_entries.iter().enumerate() {
        if legacy_entries
            .iter()
            .filter(|entry| *entry == expected)
            .count()
            != 1
        {
            return Err(invalid_data(format!(
                "published type chart does not contain selected entry at index {index}"
            ))
            .into());
        }
    }
    *entries = expected_entries;
    Ok(())
}

fn normalize_legacy_content_conditions(
    artifact: &mut Value,
    selected: &er_content::pack::ContentPack,
) -> TestResult {
    selected.validate()?;
    let provenance = field(artifact, "provenance")?
        .as_object()
        .ok_or_else(|| invalid_data("published content artifact provenance is not an object"))?;
    let provenance_hash = provenance
        .get("content_pack_hash")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid_data("published content provenance hash is missing"))?;
    let provenance_oracle_sha = provenance
        .get("oracle_game_sha")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid_data("published content provenance oracle SHA is missing"))?;
    let content_pack = field(artifact, "content_pack")?
        .as_object()
        .ok_or_else(|| invalid_data("published content pack is not an object"))?;
    let pack_hash = content_pack
        .get("hash")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid_data("published content pack hash is missing"))?;
    let pack_oracle_sha = content_pack
        .get("oracle_game_sha")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid_data("published content pack oracle SHA is missing"))?;
    if pack_hash != LEGACY_ORACLE_CONTENT_HASH
        || provenance_hash != LEGACY_ORACLE_CONTENT_DIGEST
        || pack_oracle_sha != selected.oracle_game_sha
        || provenance_oracle_sha != selected.oracle_game_sha
    {
        return Err(invalid_data(
            "published content artifact is not the exact supported legacy identity",
        )
        .into());
    }

    let content_pack = field_mut(artifact, "content_pack")?;
    normalize_legacy_type_chart(content_pack, selected)?;
    let manifest = field_mut(content_pack, "capability_manifest")?;
    let entries = field_mut(manifest, "entries")?
        .as_array_mut()
        .ok_or_else(|| invalid_data("content_pack.capability_manifest.entries is not an array"))?;
    for (index, entry) in entries.iter_mut().enumerate() {
        let subject = field_mut(entry, "subject")?;
        let subject_object = subject.as_object().ok_or_else(|| {
            invalid_data(format!(
                "content_pack.capability_manifest.entries[{index}].subject is not an object"
            ))
        })?;
        if subject_object.len() != 2
            || !subject_object.contains_key("kind")
            || !subject_object.contains_key("value")
        {
            return Err(invalid_data(format!(
                "content_pack.capability_manifest.entries[{index}].subject has extra or missing fields"
            ))
            .into());
        }
        let subject_kind = subject_object
            .get("kind")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                invalid_data(format!(
                    "content_pack.capability_manifest.entries[{index}].subject.kind is not a string"
                ))
            })?
            .to_owned();
        match subject_kind.as_str() {
            "WEATHER" | "TERRAIN" => {
                normalize_legacy_adjacent_field(
                    &format!("content_pack.capability_manifest.entries[{index}].subject"),
                    subject,
                    "value",
                )?;
            }
            "MOVE" | "ABILITY" | "STATUS" | "ARENA_CONDITION" => {}
            other => {
                return Err(invalid_data(format!(
                    "content_pack.capability_manifest.entries[{index}].subject has unsupported kind {other:?}"
                ))
                .into());
            }
        }
    }
    content_pack
        .as_object_mut()
        .ok_or_else(|| invalid_data("published content pack is not an object"))?
        .insert("hash".to_owned(), Value::String(selected.hash.to_string()));
    Ok(())
}

fn normalize_legacy_fixture_content_identity(
    fixture: &mut Value,
    selected: &er_content::pack::ContentPack,
) -> TestResult {
    selected.validate()?;
    let initial_hash = field(
        field(field(fixture, "initial_state")?, "canonical")?,
        "content_hash",
    )?
    .as_str()
    .ok_or_else(|| invalid_data("initial canonical content_hash is missing or not a string"))?
    .to_owned();
    let expected_hash = field(
        field(field(fixture, "expected_final_state")?, "canonical")?,
        "content_hash",
    )?
    .as_str()
    .ok_or_else(|| {
        invalid_data("expected final canonical content_hash is missing or not a string")
    })?;
    if expected_hash != initial_hash {
        return Err(invalid_data("published state content hashes disagree").into());
    }

    let provenance = field(fixture, "provenance")?
        .as_object()
        .ok_or_else(|| invalid_data("published fixture provenance is not an object"))?;
    let provenance_hash = provenance
        .get("content_pack_hash")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid_data("published fixture provenance hash is missing"))?;
    let provenance_oracle_sha = provenance
        .get("oracle_game_sha")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid_data("published fixture provenance oracle SHA is missing"))?;
    if provenance_oracle_sha != selected.oracle_game_sha {
        return Err(invalid_data(
            "published fixture provenance oracle SHA disagrees with selected content",
        )
        .into());
    }

    let selected_hash = selected.hash.to_string();
    let selected_digest = selected_hash
        .strip_prefix("blake3-v1:")
        .ok_or_else(|| invalid_data("selected content hash has no blake3-v1 prefix"))?;
    if initial_hash == selected_hash {
        if provenance_hash != selected_digest {
            return Err(invalid_data(
                "selected fixture content hash disagrees with provenance digest",
            )
            .into());
        }
        return Ok(());
    }
    if initial_hash != LEGACY_ORACLE_CONTENT_HASH || provenance_hash != LEGACY_ORACLE_CONTENT_DIGEST
    {
        return Err(invalid_data(
            "fixture content identity is neither the current selected pair nor the exact published legacy pair",
        )
        .into());
    }

    for state_name in ["initial_state", "expected_final_state"] {
        let state = field_mut(fixture, state_name)?;
        let canonical = field_mut(state, "canonical")?;
        canonical
            .as_object_mut()
            .ok_or_else(|| invalid_data("published canonical state is not an object"))?
            .insert(
                "content_hash".to_owned(),
                Value::String(selected_hash.clone()),
            );
    }
    Ok(())
}

fn seat(value: u64) -> TestResult<SeatId> {
    Ok(SeatId::new(SafeU53::new(value)?))
}

fn published_case(scenario_id: &str) -> TestResult<BattleFixture> {
    let catalog = load_m3_fixture_catalog()?;
    if !catalog.is_evidence_published() {
        return Err(invalid_data("M3 oracle evidence is not published").into());
    }
    let mut fixture = catalog.load_published_case::<Value>(scenario_id)?;
    let selected = er_content::pack::selected_content_pack()?;
    normalize_legacy_fixture_content_identity(&mut fixture, &selected)?;
    normalize_legacy_fixture_statuses(&mut fixture)?;
    Ok(BattleFixture { fixture })
}

fn published_content_pack() -> TestResult<er_content::pack::ContentPack> {
    let catalog = load_m3_fixture_catalog()?;
    if !catalog.is_evidence_published() {
        return Err(invalid_data("M3 oracle evidence is not published").into());
    }
    let selected = er_content::pack::selected_content_pack()?;
    let mut artifact = catalog.load_published_supporting_artifact::<Value>("content-pack-v1")?;
    normalize_legacy_content_conditions(&mut artifact, &selected)?;
    let content: er_content::pack::ContentPack =
        serde_json::from_value(field(&artifact, "content_pack")?.clone())?;
    if content != selected {
        return Err(invalid_data(
            "published legacy content pack did not normalize to the current selected content",
        )
        .into());
    }
    Ok(content)
}

fn canonical_state(fixture: &BattleFixture) -> TestResult<&Value> {
    field(field(&fixture.fixture, "initial_state")?, "canonical")
}

fn initial_battle(fixture: &BattleFixture) -> TestResult<&Value> {
    field(canonical_state(fixture)?, "battle")
}

fn kernel_format(battle: &Value) -> TestResult<Value> {
    // Oracle canonical state retains a legacy `format.slots` mirror.  The
    // production BattleFormat is the stricter topology-only public DTO.
    let mut format = field(battle, "format")?.clone();
    format
        .as_object_mut()
        .ok_or_else(|| invalid_data("battle format is not an object"))?
        .remove("slots");
    Ok(format)
}

fn enemy_actor(battle: &Value) -> TestResult<er_types::battle_ids::PokemonId> {
    let slots = field(field(battle, "field")?, "slots")?
        .as_array()
        .ok_or_else(|| invalid_data("battle field slots are not an array"))?;
    let actor = slots.iter().find_map(|entry| {
        let slot = entry.get("slot")?;
        (slot.get("side")?.as_str() == Some("ENEMY") && slot.get("position")?.as_u64() == Some(0))
            .then(|| entry.get("occupant")?.as_u64())
            .flatten()
    });
    let actor = actor.ok_or_else(|| invalid_data("single fixture has no enemy lead"))?;
    Ok(er_types::battle_ids::PokemonId::new(SafeU53::new(actor)?))
}

fn scripted_enemy_policy(battle: &Value) -> TestResult<ScriptedEnemyPolicyV1> {
    let actor = enemy_actor(battle)?;
    let battle_id: BattleId = serde_json::from_value(field(battle, "battle_id")?.clone())?;
    let turn_number = field(battle, "turn")?
        .as_u64()
        .ok_or_else(|| invalid_data("battle turn is not an unsigned integer"))?;
    let wave: WaveIndex = serde_json::from_value(field(battle, "wave")?.clone())?;
    let enemy_slot = FieldSlot {
        side: BattleSide::Enemy,
        position: 0,
    };

    // The first real turn consumes cursor zero.  Cursor one is also supplied
    // so an ongoing single campaign can build its next real enemy frontier.
    let mut commands = Vec::new();
    for cursor_number in 0..=1_u64 {
        let cursor = SafeU53::new(cursor_number)?;
        let turn = TurnIndex::new(SafeU53::new(turn_number + cursor_number)?)?;
        let operation_id =
            scripted_enemy_command_operation_id(battle_id, wave, turn, enemy_slot, cursor)?;
        let command = BattleCommand::fight(
            actor,
            MoveSlotIndex::ZERO,
            BattleTargetSelection::implicit(),
        )?;
        commands.push(ScriptedEnemyBattleCommandV1::new(
            operation_id,
            battle_id,
            wave,
            turn,
            cursor,
            actor,
            enemy_slot,
            command,
        )?);
    }
    Ok(ScriptedEnemyPolicyV1::new(SafeU53::ZERO, commands)?)
}

fn battle_config(fixture: &BattleFixture) -> TestResult<BattleGameConfig> {
    let canonical = canonical_state(fixture)?;
    let battle = initial_battle(fixture)?;
    let format = kernel_format(battle)?;
    let player_capacity = field(&format, "player_capacity")?
        .as_u64()
        .ok_or_else(|| invalid_data("player capacity is not an unsigned integer"))?;
    let enemy_capacity = field(&format, "enemy_capacity")?
        .as_u64()
        .ok_or_else(|| invalid_data("enemy capacity is not an unsigned integer"))?;
    if player_capacity != 1 || enemy_capacity != 1 {
        return Err(invalid_data("M3C-09 raw campaigns require a single battle format").into());
    }

    // `initial_state` is post-construction evidence.  Rebuild the public
    // constructor's pre-battle run state from the fixture's independent RNG
    // witness and the current battle ID.
    let mut run_state = canonical.clone();
    let run_state_object = run_state
        .as_object_mut()
        .ok_or_else(|| invalid_data("canonical game state is not an object"))?;
    run_state_object.insert("battle".to_owned(), Value::Null);
    run_state_object.insert(
        "next_battle_id".to_owned(),
        field(battle, "battle_id")?.clone(),
    );
    run_state_object.insert(
        "run_rng".to_owned(),
        field(field(&fixture.fixture, "initial_rng")?, "run")?.clone(),
    );

    let wave_seed = field(battle, "wave_seed")?
        .as_str()
        .ok_or_else(|| invalid_data("battle wave seed is not a string"))?
        .to_owned();
    Ok(BattleGameConfig {
        run_state: serde_json::from_value(run_state)?,
        start: BattleStartV1 {
            schema_version: 1,
            format: serde_json::from_value(format)?,
            player_party: serde_json::from_value(field(battle, "player_party")?.clone())?,
            enemy_party: serde_json::from_value(field(battle, "enemy_party")?.clone())?,
            player_leads: serde_json::from_value(json!([0]))?,
            enemy_leads: serde_json::from_value(json!([0]))?,
        },
        local_seat: seat(1)?,
        wave_seed,
        scripted_enemy_policy: scripted_enemy_policy(battle)?,
    })
}

fn battle_protocol() -> TestResult<BattleProtocolConfig> {
    let local_seat = seat(1)?;
    let context = FrameContext {
        session_id: SessionId::new("m3c09-raw-local-session")?,
        run_id: RunId::new("m3c09-raw-local-run")?,
        session_epoch: SafeU53::new(1)?,
        seat_map_id: "m3c09-raw-local-seat-map".to_owned(),
        membership_revision: MembershipRevision::new(SafeU53::new(1)?),
        sender_seat_id: local_seat,
        authority_seat_id: local_seat,
        connection_generation: ConnectionGeneration::ZERO,
    };
    Ok(BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Authority {
            log: AuthorityLogConfig {
                local_context: context,
                peer_bindings: Vec::new(),
                owner_id: "m3c09-raw-local-authority".to_owned(),
                retain_capacity: SafeU53::new(64)?,
                delivery_backoff: BackoffPolicy {
                    initial_ms: SafeU53::new(250)?,
                    maximum_ms: SafeU53::new(5_000)?,
                    factor_numerator: SafeU53::new(2)?,
                    factor_denominator: SafeU53::new(1)?,
                },
                delivery_time_class: TimeClass::Connected,
                max_delivery_attempts: None,
            },
            proposal_capacity: SafeU53::new(64)?,
        },
    })
}

fn new_kernel(fixture: &BattleFixture) -> TestResult<GameKernel> {
    let content = published_content_pack()?;
    let expected_hash = field(canonical_state(fixture)?, "content_hash")?
        .as_str()
        .ok_or_else(|| invalid_data("canonical content_hash is not a string"))?;
    if expected_hash != content.hash.to_string() {
        return Err(invalid_data("fixture content hash does not match selected content").into());
    }
    Ok(GameKernel::new_battle(
        battle_config(fixture)?,
        battle_protocol()?,
        Arc::new(content),
    )?)
}

/// Raw-only command driver.  It has no semantic command/proposal/reducer API.
struct RawKeyDriver<'kernel> {
    kernel: &'kernel mut GameKernel,
    seat: SeatId,
}

impl<'kernel> RawKeyDriver<'kernel> {
    fn new(kernel: &'kernel mut GameKernel, seat: SeatId) -> Self {
        Self { kernel, seat }
    }

    fn key_down(&mut self, code: PhysicalKey) -> TestResult<Vec<KernelEffect>> {
        let effects = self.kernel.step(KernelInput::RawInput {
            seat: self.seat,
            event: RawInputEvent::KeyDown {
                code,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            },
        })?;
        assert_no_compatibility_effects(&effects);
        Ok(effects)
    }

    fn key_up(&mut self, code: PhysicalKey) -> TestResult<Vec<KernelEffect>> {
        let effects = self.kernel.step(KernelInput::RawInput {
            seat: self.seat,
            event: RawInputEvent::KeyUp { code },
        })?;
        assert_no_compatibility_effects(&effects);
        Ok(effects)
    }

    fn press(&mut self, code: PhysicalKey) -> TestResult<Vec<KernelEffect>> {
        let mut effects = self.key_down(code.clone())?;
        effects.extend(self.key_up(code)?);
        Ok(effects)
    }
}

fn raw_key_down(kernel: &mut GameKernel, code: PhysicalKey) -> TestResult<Vec<KernelEffect>> {
    RawKeyDriver::new(kernel, seat(1)?).key_down(code)
}

fn raw_key_up(kernel: &mut GameKernel, code: PhysicalKey) -> TestResult<Vec<KernelEffect>> {
    RawKeyDriver::new(kernel, seat(1)?).key_up(code)
}

fn raw_press(kernel: &mut GameKernel, code: PhysicalKey) -> TestResult<Vec<KernelEffect>> {
    RawKeyDriver::new(kernel, seat(1)?).press(code)
}

fn assert_no_compatibility_effects(effects: &[KernelEffect]) {
    assert!(
        !effects.iter().any(|effect| {
            matches!(
                effect,
                KernelEffect::UiChanged { .. }
                    | KernelEffect::UiIntent { .. }
                    | KernelEffect::Present { .. }
                    | KernelEffect::ApplyAuthorityMaterial { .. }
                    | KernelEffect::ProjectAuthorityControl { .. }
            )
        }),
        "Battle mode emitted a compatibility effect: {effects:?}"
    );
}

fn control(kernel: &GameKernel) -> TestResult<&BattleControl> {
    Ok(&kernel
        .battle_ui_projection()
        .ok_or_else(|| invalid_data("kernel did not expose a Battle UI projection"))?
        .seat_control
        .control)
}

fn selected_option(kernel: &GameKernel) -> TestResult<String> {
    let option = match control(kernel)? {
        BattleControl::CommandRoot(value) => &value.menu.selected_option_id,
        BattleControl::MoveSelect(value) => &value.menu.selected_option_id,
        BattleControl::TargetSelect(value) => &value.menu.selected_option_id,
        BattleControl::PartySelect(value) => &value.menu.selected_option_id,
        BattleControl::PartyOptionSelect(value) => &value.menu.selected_option_id,
        BattleControl::ReplacementSelect(value) => &value.menu.selected_option_id,
        BattleControl::Waiting(_) | BattleControl::Complete(_) => {
            return Err(invalid_data("current control has no menu selection").into());
        }
    };
    Ok(option.as_str().to_owned())
}

fn game_state_json(kernel: &GameKernel) -> TestResult<Value> {
    Ok(field(&kernel.snapshot().state, "game")?.clone())
}

fn comparable_game_state(state: &Value) -> TestResult<Value> {
    // The frozen oracle stores only human pending commands and uses a
    // one-based faint allocator.  The production runtime additionally stores
    // pre-admitted scripted-enemy frontier entries and owns a zero-based
    // allocator.  Compare every other canonical mechanics field exactly;
    // allocator movement is asserted independently by the campaigns below.
    let mut comparable = state.clone();
    let battle = comparable
        .get_mut("battle")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| invalid_data("game state has no active battle object"))?;
    battle.remove("command_state");
    battle.remove("next_faint_occurrence");
    battle
        .get_mut("format")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| invalid_data("game state has no battle format object"))?
        .remove("slots");
    Ok(comparable)
}

fn assert_fixture_state(
    kernel: &GameKernel,
    fixture: &BattleFixture,
    fixture_field: &str,
) -> TestResult {
    let expected = field(field(&fixture.fixture, fixture_field)?, "canonical")?;
    assert_eq!(
        comparable_game_state(&game_state_json(kernel)?)?,
        comparable_game_state(expected)?,
    );
    Ok(())
}

fn assert_fixture_state_with_authoritative_enemy_pp(
    kernel: &GameKernel,
    fixture: &BattleFixture,
    fixture_field: &str,
    expected_enemy_move_pp_used: u64,
) -> TestResult {
    // The published physical-hit oracle predates scripted-enemy PP accounting.
    // Correct only that explicit enemy move-slot-0 expectation;
    // every other canonical state field remains an exact fixture comparison.
    let expected = field(field(&fixture.fixture, fixture_field)?, "canonical")?;
    let mut expected = comparable_game_state(expected)?;
    let battle = expected
        .get_mut("battle")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| invalid_data("expected canonical state has no battle object"))?;
    let enemy_party = battle
        .get_mut("enemy_party")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| invalid_data("expected canonical state has no enemy party"))?;
    let enemy = enemy_party
        .first_mut()
        .ok_or_else(|| invalid_data("expected canonical state has no enemy lead"))?;
    let enemy_move = enemy
        .get_mut("moves")
        .and_then(Value::as_array_mut)
        .and_then(|moves| moves.first_mut())
        .ok_or_else(|| invalid_data("expected canonical state has no enemy move slot 0"))?;
    let pp_used = enemy_move
        .get_mut("pp_used")
        .ok_or_else(|| invalid_data("expected enemy move slot 0 has no pp_used"))?;
    if pp_used.as_u64() != Some(0) {
        return Err(invalid_data(
            "authoritative enemy PP correction expected the published stale value 0",
        )
        .into());
    }
    *pp_used = Value::from(expected_enemy_move_pp_used);
    assert_eq!(comparable_game_state(&game_state_json(kernel)?)?, expected,);
    Ok(())
}

fn assert_defeat_fixture_state_with_authoritative_terminal_faint(
    kernel: &GameKernel,
    fixture: &BattleFixture,
) -> TestResult {
    // The published defeat oracle predates the authoritative terminal-faint
    // state: the battle advances to turn two, its consumed RNG substream is
    // cleared, fixture passives stay unset, the fainted field slot is cleared,
    // and the applied faint occurrence remains as typed audit state.  Refuse
    // to normalize anything unless both sides have the exact known shapes,
    // then compare every remaining canonical field byte-for-byte.
    let expected = field(
        field(&fixture.fixture, "expected_final_state")?,
        "canonical",
    )?;
    let mut expected = comparable_game_state(expected)?;
    let actual = comparable_game_state(&game_state_json(kernel)?)?;

    let legacy_battle_rng = json!({
        "battle_seed": "fqJuSWpNWxXTocLw",
        "saved_substream": {
            "carry": 939700,
            "s0_bits": "3fe588bad3000000",
            "s1_bits": "3fd8ed71cf400000",
            "s2_bits": "3fedfaebf1a00000",
            "state_string": "!rnd,939700,0.6729406472295523,0.38949246634729207,0.9368800849188119"
        },
        "turn": 1
    });
    let authoritative_battle_rng = json!({
        "battle_seed": "fqJuSWpNWxXTocLw",
        "saved_substream": null,
        "turn": 2
    });
    let legacy_passives = json!([62, 95, 50]);
    let authoritative_passives = json!([null, null, null]);
    let player_slot = json!({ "position": 0, "side": "PLAYER" });
    let authoritative_faint_queue = json!([{
        "id": 0,
        "owner_seat": 1,
        "pokemon": 1,
        "replacement": { "kind": "APPLIED" },
        "slot": { "position": 0, "side": "PLAYER" },
        "source": {
            "epoch": 1,
            "resolved_turn": 1,
            "turn_occurrence": 0,
            "wave": 1
        }
    }]);

    if expected.pointer("/battle/battle_rng") != Some(&legacy_battle_rng)
        || actual.pointer("/battle/battle_rng") != Some(&authoritative_battle_rng)
        || expected.pointer("/battle/turn") != Some(&Value::from(1))
        || actual.pointer("/battle/turn") != Some(&Value::from(2))
        || expected.pointer("/battle/enemy_party/0/moves/0/pp_used") != Some(&Value::from(0))
        || actual.pointer("/battle/enemy_party/0/moves/0/pp_used") != Some(&Value::from(1))
        || expected.pointer("/battle/player_party/0/abilities/passives") != Some(&legacy_passives)
        || actual.pointer("/battle/player_party/0/abilities/passives")
            != Some(&authoritative_passives)
        || expected.pointer("/battle/field/slots/0/slot") != Some(&player_slot)
        || actual.pointer("/battle/field/slots/0/slot") != Some(&player_slot)
        || expected.pointer("/battle/field/slots/0/occupant") != Some(&Value::from(1))
        || actual.pointer("/battle/field/slots/0/occupant") != Some(&Value::Null)
        || expected.pointer("/battle/faint_queue") != Some(&json!([]))
        || actual.pointer("/battle/faint_queue") != Some(&authoritative_faint_queue)
    {
        return Err(invalid_data(
            "defeat fixture terminal-faint state is outside its exact legacy normalization catalogue",
        )
        .into());
    }

    *expected
        .pointer_mut("/battle/battle_rng")
        .ok_or_else(|| invalid_data("defeat fixture has no battle RNG state"))? =
        authoritative_battle_rng;
    *expected
        .pointer_mut("/battle/turn")
        .ok_or_else(|| invalid_data("defeat fixture has no battle turn"))? = Value::from(2);
    *expected
        .pointer_mut("/battle/enemy_party/0/moves/0/pp_used")
        .ok_or_else(|| invalid_data("defeat fixture has no enemy move PP state"))? = Value::from(1);
    *expected
        .pointer_mut("/battle/player_party/0/abilities/passives")
        .ok_or_else(|| invalid_data("defeat fixture has no player passive list"))? =
        authoritative_passives;
    *expected
        .pointer_mut("/battle/field/slots/0/occupant")
        .ok_or_else(|| invalid_data("defeat fixture has no player field occupant"))? = Value::Null;
    *expected
        .pointer_mut("/battle/faint_queue")
        .ok_or_else(|| invalid_data("defeat fixture has no faint queue"))? =
        authoritative_faint_queue;

    assert_eq!(actual, expected);
    Ok(())
}

fn assert_victory_fixture_state_with_authoritative_terminal_faint(
    kernel: &GameKernel,
    fixture: &BattleFixture,
) -> TestResult {
    // The published victory oracle predates three terminal-faint ownership
    // details: explicit fixture abilities stay unset, a fainted field slot is
    // cleared, and the applied faint occurrence remains as typed audit state.
    // Refuse to normalize anything unless both sides have those exact known
    // shapes, then compare every remaining canonical field byte-for-byte.
    let expected = field(
        field(&fixture.fixture, "expected_final_state")?,
        "canonical",
    )?;
    let mut expected = comparable_game_state(expected)?;
    let actual = comparable_game_state(&game_state_json(kernel)?)?;

    let legacy_passives = json!([5026, 101, 290]);
    let authoritative_passives = json!([null, null, null]);
    let enemy_slot = json!({ "position": 0, "side": "ENEMY" });
    let authoritative_faint_queue = json!([{
        "id": 0,
        "owner_seat": null,
        "pokemon": 2,
        "replacement": { "kind": "APPLIED" },
        "slot": { "position": 0, "side": "ENEMY" },
        "source": {
            "epoch": 1,
            "resolved_turn": 1,
            "turn_occurrence": 0,
            "wave": 1
        }
    }]);

    if expected.pointer("/battle/enemy_party/0/abilities/passives") != Some(&legacy_passives)
        || actual.pointer("/battle/enemy_party/0/abilities/passives")
            != Some(&authoritative_passives)
        || expected.pointer("/battle/field/slots/1/slot") != Some(&enemy_slot)
        || actual.pointer("/battle/field/slots/1/slot") != Some(&enemy_slot)
        || expected.pointer("/battle/field/slots/1/occupant") != Some(&Value::from(2))
        || actual.pointer("/battle/field/slots/1/occupant") != Some(&Value::Null)
        || expected.pointer("/battle/faint_queue") != Some(&json!([]))
        || actual.pointer("/battle/faint_queue") != Some(&authoritative_faint_queue)
    {
        return Err(invalid_data(
            "victory fixture terminal-faint state is outside its exact legacy normalization catalogue",
        )
        .into());
    }

    *expected
        .pointer_mut("/battle/enemy_party/0/abilities/passives")
        .ok_or_else(|| invalid_data("victory fixture has no enemy passive list"))? =
        authoritative_passives;
    *expected
        .pointer_mut("/battle/field/slots/1/occupant")
        .ok_or_else(|| invalid_data("victory fixture has no enemy field occupant"))? = Value::Null;
    *expected
        .pointer_mut("/battle/faint_queue")
        .ok_or_else(|| invalid_data("victory fixture has no faint queue"))? =
        authoritative_faint_queue;

    assert_eq!(actual, expected);
    Ok(())
}

fn next_faint_occurrence(kernel: &GameKernel) -> TestResult<u64> {
    let state = game_state_json(kernel)?;
    field(field(&state, "battle")?, "next_faint_occurrence")?
        .as_u64()
        .ok_or_else(|| invalid_data("next_faint_occurrence is not an unsigned integer"))
        .map_err(Into::into)
}

fn oracle_presentation_count(fixture: &BattleFixture) -> TestResult<usize> {
    Ok(field(&fixture.fixture, "expected_presentation")?
        .as_array()
        .ok_or_else(|| invalid_data("expected presentation is not an array"))?
        .len())
}

fn presentation_events(effects: &[KernelEffect]) -> Vec<BattlePresentationEvent> {
    effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::PresentBattle { event, .. } => Some(event.clone()),
            _ => None,
        })
        .collect()
}

fn settle_presentations(
    kernel: &mut GameKernel,
    events: &[BattlePresentationEvent],
) -> TestResult<Vec<KernelEffect>> {
    let mut effects = Vec::new();
    for event in events {
        let settled = kernel.step(KernelInput::BattlePresentationOutcome {
            endpoint: seat(1)?,
            event_id: event.event_id.clone(),
            outcome: PresentationSettlementOutcome::Settled,
        })?;
        assert_no_compatibility_effects(&settled);
        effects.extend(settled);
    }
    Ok(effects)
}

fn has_move_used(events: &[BattlePresentationEvent]) -> bool {
    events
        .iter()
        .any(|event| matches!(&event.kind, BattlePresentationKind::MoveUsed { .. }))
}

fn has_hp_changed(events: &[BattlePresentationEvent]) -> bool {
    events
        .iter()
        .any(|event| matches!(&event.kind, BattlePresentationKind::HpChanged { .. }))
}

fn has_fainted(events: &[BattlePresentationEvent]) -> bool {
    events
        .iter()
        .any(|event| matches!(&event.kind, BattlePresentationKind::Fainted { .. }))
}

fn has_switched(events: &[BattlePresentationEvent]) -> bool {
    events
        .iter()
        .any(|event| matches!(&event.kind, BattlePresentationKind::Switched { .. }))
}

fn has_battle_won(events: &[BattlePresentationEvent]) -> bool {
    events
        .iter()
        .any(|event| matches!(&event.kind, BattlePresentationKind::BattleWon))
}

fn has_battle_lost(events: &[BattlePresentationEvent]) -> bool {
    events
        .iter()
        .any(|event| matches!(&event.kind, BattlePresentationKind::BattleLost))
}

fn battle_outcome(kernel: &GameKernel) -> TestResult<String> {
    let state = game_state_json(kernel)?;
    Ok(field(field(&state, "battle")?, "outcome")?
        .as_str()
        .ok_or_else(|| invalid_data("battle outcome is not a string"))?
        .to_owned())
}

fn field_occupant(state: &Value, side: &str, position: u64) -> Option<u64> {
    state
        .get("battle")?
        .get("field")?
        .get("slots")?
        .as_array()?
        .iter()
        .find_map(|entry| {
            let slot = entry.get("slot")?;
            (slot.get("side")?.as_str() == Some(side)
                && slot.get("position")?.as_u64() == Some(position))
            .then(|| entry.get("occupant")?.as_u64())
            .flatten()
        })
}

fn single_replacement_case(
    forced: &BattleFixture,
    single_format: &Value,
) -> TestResult<BattleFixture> {
    let mut fixture = forced.fixture.clone();
    let initial_state = field(&fixture, "initial_state")?;
    let canonical = field(initial_state, "canonical")?;
    let battle = field(canonical, "battle")?;
    let player_party = field(battle, "player_party")?
        .as_array()
        .ok_or_else(|| invalid_data("forced replacement player party is not an array"))?;
    let enemy_party = field(battle, "enemy_party")?
        .as_array()
        .ok_or_else(|| invalid_data("forced replacement enemy party is not an array"))?;
    let active = player_party
        .first()
        .cloned()
        .ok_or_else(|| invalid_data("forced replacement has no active player"))?;
    let reserve = player_party
        .get(2)
        .cloned()
        .ok_or_else(|| invalid_data("forced replacement has no seat-one reserve"))?;
    let enemy = enemy_party
        .first()
        .cloned()
        .ok_or_else(|| invalid_data("forced replacement has no enemy lead"))?;

    let initial_state = field_mut(&mut fixture, "initial_state")?;
    let canonical = field_mut(initial_state, "canonical")?;
    let battle = field_mut(canonical, "battle")?;
    let battle_object = battle
        .as_object_mut()
        .ok_or_else(|| invalid_data("forced replacement battle is not an object"))?;
    battle_object.insert("format".to_owned(), single_format.clone());
    battle_object.insert("player_party".to_owned(), json!([active, reserve]));
    battle_object.insert("enemy_party".to_owned(), json!([enemy]));
    Ok(BattleFixture { fixture })
}

fn field_mut<'a>(object: &'a mut Value, key: &str) -> TestResult<&'a mut Value> {
    object
        .get_mut(key)
        .ok_or_else(|| invalid_data(format!("fixture is missing mutable field {key:?}")))
        .map_err(Into::into)
}

fn published_single_replacement_case() -> TestResult<BattleFixture> {
    let forced = published_case("forced-replacement")?;
    let single_source = published_case("physical-hit")?;
    let single_format = kernel_format(initial_battle(&single_source)?)?;
    single_replacement_case(&forced, &single_format)
}

#[test]
fn raw_driver_contains_only_raw_keydown_and_keyup_kernel_inputs() -> TestResult {
    let source = include_str!("m3_raw_key_local.rs");
    let start = source
        .find("impl<'kernel> RawKeyDriver")
        .ok_or_else(|| invalid_data("raw driver implementation is missing"))?;
    let end = source
        .find("fn assert_no_compatibility_effects")
        .ok_or_else(|| invalid_data("raw driver boundary marker is missing"))?;
    let driver_source = &source[start..end];
    assert!(driver_source.contains("KernelInput::RawInput"));
    assert_eq!(
        driver_source.matches("KernelInput::").count(),
        driver_source.matches("KernelInput::RawInput").count(),
        "raw driver contains a non-RawInput kernel path",
    );
    assert_eq!(driver_source.matches("RawInputEvent::").count(), 2);
    assert_eq!(driver_source.matches("RawInputEvent::KeyDown").count(), 1);
    assert_eq!(driver_source.matches("RawInputEvent::KeyUp").count(), 1);
    for forbidden in [
        "KernelInput::ProposalReceived",
        "KernelInput::MaterialApplied",
        "KernelInput::ControlProjected",
        "KernelInput::PresentationSettled",
        "KernelInput::BattlePresentationOutcome",
        "BattleCommand",
        "UiIntent",
    ] {
        assert!(
            !driver_source.contains(forbidden),
            "raw driver contains semantic or compatibility bypass {forbidden}"
        );
    }
    Ok(())
}

#[test]
fn raw_singles_walk_party_and_duplicate_keydown_cannot_bleed_into_new_menu() -> TestResult {
    let fixture = published_single_replacement_case()?;
    let mut kernel = new_kernel(&fixture)?;
    assert!(matches!(control(&kernel)?, BattleControl::CommandRoot(_)));

    let mut all_effects = Vec::new();
    all_effects.extend(raw_key_down(&mut kernel, PhysicalKey::Enter)?);
    assert!(matches!(control(&kernel)?, BattleControl::MoveSelect(_)));

    let duplicate = raw_key_down(&mut kernel, PhysicalKey::Enter)?;
    assert!(duplicate.is_empty(), "held Enter leaked into the new menu");
    let release = raw_key_up(&mut kernel, PhysicalKey::Enter)?;
    assert_eq!(
        release.len(),
        1,
        "Enter release was not exact timer cleanup"
    );
    assert!(matches!(&release[0], KernelEffect::CancelTimer { .. }));
    all_effects.extend(release);
    assert!(matches!(control(&kernel)?, BattleControl::MoveSelect(_)));

    all_effects.extend(raw_press(&mut kernel, PhysicalKey::Backspace)?);
    assert!(matches!(control(&kernel)?, BattleControl::CommandRoot(_)));

    all_effects.extend(raw_press(&mut kernel, PhysicalKey::ArrowDown)?);
    assert_eq!(selected_option(&kernel)?, "command/switch");
    all_effects.extend(raw_press(&mut kernel, PhysicalKey::Enter)?);
    assert!(matches!(control(&kernel)?, BattleControl::PartySelect(_)));

    all_effects.extend(raw_press(&mut kernel, PhysicalKey::Backspace)?);
    assert!(matches!(control(&kernel)?, BattleControl::CommandRoot(_)));
    assert_no_compatibility_effects(&all_effects);
    Ok(())
}

#[test]
fn raw_singles_complete_a_real_turn_and_settle_every_presentation() -> TestResult {
    let fixture = published_case("physical-hit")?;
    let mut kernel = new_kernel(&fixture)?;
    assert_fixture_state(&kernel, &fixture, "initial_state")?;
    let faint_allocator_before = next_faint_occurrence(&kernel)?;

    let mut effects = Vec::new();
    effects.extend(raw_press(&mut kernel, PhysicalKey::Enter)?);
    assert!(matches!(control(&kernel)?, BattleControl::MoveSelect(_)));
    effects.extend(raw_press(&mut kernel, PhysicalKey::Enter)?);
    assert!(matches!(control(&kernel)?, BattleControl::CommandRoot(_)));
    assert!(
        !kernel
            .battle_ui_projection()
            .ok_or_else(|| invalid_data("missing Battle UI projection"))?
            .actionable
    );

    let events = presentation_events(&effects);
    assert_eq!(events.len(), oracle_presentation_count(&fixture)?);
    assert!(has_move_used(&events));
    assert!(has_hp_changed(&events));
    assert_eq!(battle_outcome(&kernel)?, "ONGOING");

    effects.extend(settle_presentations(&mut kernel, &events)?);
    assert_no_compatibility_effects(&effects);
    assert_fixture_state_with_authoritative_enemy_pp(&kernel, &fixture, "expected_final_state", 1)?;
    assert_eq!(next_faint_occurrence(&kernel)?, faint_allocator_before);
    assert!(matches!(control(&kernel)?, BattleControl::CommandRoot(_)));
    assert!(
        kernel
            .battle_ui_projection()
            .ok_or_else(|| invalid_data("missing Battle UI projection"))?
            .actionable
    );
    assert!(kernel.live_resources().battle_presentations.is_empty());
    Ok(())
}

#[test]
fn raw_singles_target_path_reaches_fixture_exact_defeat() -> TestResult {
    let fixture = published_case("defeat")?;
    let mut kernel = new_kernel(&fixture)?;
    assert_fixture_state(&kernel, &fixture, "initial_state")?;
    let faint_allocator_before = next_faint_occurrence(&kernel)?;
    let mut effects = Vec::new();
    effects.extend(raw_press(&mut kernel, PhysicalKey::Enter)?);
    assert!(matches!(control(&kernel)?, BattleControl::MoveSelect(_)));
    effects.extend(raw_press(&mut kernel, PhysicalKey::Enter)?);
    assert!(matches!(control(&kernel)?, BattleControl::TargetSelect(_)));
    effects.extend(raw_press(&mut kernel, PhysicalKey::Enter)?);
    assert!(matches!(
        control(&kernel)?,
        BattleControl::Complete(BattleOutcome::Defeat)
    ));

    let events = presentation_events(&effects);
    assert_eq!(events.len(), oracle_presentation_count(&fixture)? + 1);
    assert!(has_move_used(&events));
    assert!(has_hp_changed(&events));
    assert!(has_fainted(&events));
    assert!(has_battle_lost(&events));
    effects.extend(settle_presentations(&mut kernel, &events)?);
    assert_no_compatibility_effects(&effects);
    assert_eq!(battle_outcome(&kernel)?, "DEFEAT");
    assert_defeat_fixture_state_with_authoritative_terminal_faint(&kernel, &fixture)?;
    assert_eq!(next_faint_occurrence(&kernel)?, faint_allocator_before + 1,);
    assert!(matches!(
        control(&kernel)?,
        BattleControl::Complete(BattleOutcome::Defeat)
    ));
    assert!(
        !kernel
            .battle_ui_projection()
            .ok_or_else(|| invalid_data("missing Battle UI projection"))?
            .actionable
    );
    assert!(kernel.live_resources().battle_presentations.is_empty());
    Ok(())
}

#[test]
fn raw_singles_victory_path_reaches_terminal_control_after_settlement() -> TestResult {
    let fixture = published_case("victory")?;
    let mut kernel = new_kernel(&fixture)?;
    assert_fixture_state(&kernel, &fixture, "initial_state")?;
    let faint_allocator_before = next_faint_occurrence(&kernel)?;
    let mut effects = Vec::new();
    effects.extend(raw_press(&mut kernel, PhysicalKey::Enter)?);
    assert!(matches!(control(&kernel)?, BattleControl::MoveSelect(_)));
    effects.extend(raw_press(&mut kernel, PhysicalKey::Enter)?);
    assert!(matches!(
        control(&kernel)?,
        BattleControl::Complete(BattleOutcome::Victory)
    ));

    let events = presentation_events(&effects);
    assert_eq!(events.len(), oracle_presentation_count(&fixture)? + 1);
    assert!(has_move_used(&events));
    assert!(has_hp_changed(&events));
    assert!(has_fainted(&events));
    assert!(has_battle_won(&events));
    effects.extend(settle_presentations(&mut kernel, &events)?);
    assert_no_compatibility_effects(&effects);
    assert_eq!(battle_outcome(&kernel)?, "VICTORY");
    assert_victory_fixture_state_with_authoritative_terminal_faint(&kernel, &fixture)?;
    assert_eq!(next_faint_occurrence(&kernel)?, faint_allocator_before + 1,);
    assert!(matches!(
        control(&kernel)?,
        BattleControl::Complete(BattleOutcome::Victory)
    ));
    assert!(kernel.live_resources().battle_presentations.is_empty());
    Ok(())
}

#[test]
fn raw_single_replacement_uses_the_published_forced_replacement_fixture() -> TestResult {
    let fixture = published_single_replacement_case()?;
    let mut kernel = new_kernel(&fixture)?;
    let faint_allocator_before = next_faint_occurrence(&kernel)?;

    let mut first_effects = Vec::new();
    first_effects.extend(raw_press(&mut kernel, PhysicalKey::Enter)?);
    assert!(matches!(control(&kernel)?, BattleControl::MoveSelect(_)));
    first_effects.extend(raw_press(&mut kernel, PhysicalKey::Enter)?);
    assert!(matches!(control(&kernel)?, BattleControl::TargetSelect(_)));
    first_effects.extend(raw_press(&mut kernel, PhysicalKey::Enter)?);
    assert!(matches!(
        control(&kernel)?,
        BattleControl::ReplacementSelect(_)
    ));
    assert!(
        !kernel
            .battle_ui_projection()
            .ok_or_else(|| invalid_data("missing Battle UI projection"))?
            .actionable
    );
    let first_events = presentation_events(&first_effects);
    assert!(has_fainted(&first_events));
    first_effects.extend(settle_presentations(&mut kernel, &first_events)?);
    assert_no_compatibility_effects(&first_effects);
    assert!(matches!(
        control(&kernel)?,
        BattleControl::ReplacementSelect(_)
    ));
    assert!(
        kernel
            .battle_ui_projection()
            .ok_or_else(|| invalid_data("missing Battle UI projection"))?
            .actionable
    );
    assert_eq!(next_faint_occurrence(&kernel)?, faint_allocator_before + 1,);
    let pending_faint_queue = json!([{
        "id": 0,
        "owner_seat": 1,
        "pokemon": 1,
        "replacement": { "kind": "PENDING" },
        "slot": { "position": 0, "side": "PLAYER" },
        "source": {
            "epoch": 1,
            "resolved_turn": 1,
            "turn_occurrence": 0,
            "wave": 1
        }
    }]);
    let state = game_state_json(&kernel)?;
    assert_eq!(
        field(field(&state, "battle")?, "faint_queue")?,
        &pending_faint_queue
    );

    let applied_faint_queue = json!([{
        "id": 0,
        "owner_seat": 1,
        "pokemon": 1,
        "replacement": { "kind": "APPLIED" },
        "slot": { "position": 0, "side": "PLAYER" },
        "source": {
            "epoch": 1,
            "resolved_turn": 1,
            "turn_occurrence": 0,
            "wave": 1
        }
    }]);

    let mut replacement_effects = Vec::new();
    replacement_effects.extend(raw_press(&mut kernel, PhysicalKey::Enter)?);
    assert!(matches!(
        control(&kernel)?,
        BattleControl::PartyOptionSelect(_)
    ));
    replacement_effects.extend(raw_press(&mut kernel, PhysicalKey::Enter)?);
    let replacement_events = presentation_events(&replacement_effects);
    assert!(has_switched(&replacement_events));
    replacement_effects.extend(settle_presentations(&mut kernel, &replacement_events)?);
    assert_no_compatibility_effects(&replacement_effects);

    let final_state = game_state_json(&kernel)?;
    assert_eq!(field_occupant(&final_state, "PLAYER", 0), Some(3));
    assert_eq!(
        field(field(&final_state, "battle")?, "faint_queue")?,
        &applied_faint_queue
    );
    assert!(matches!(control(&kernel)?, BattleControl::CommandRoot(_)));
    assert_eq!(next_faint_occurrence(&kernel)?, faint_allocator_before + 1,);
    assert!(kernel.live_resources().battle_presentations.is_empty());
    Ok(())
}
