#[path = "../src/battle_replica.rs"]
#[allow(dead_code)]
mod battle_replica;

use battle_replica::{
    M3_CONTENT_HASH_MISMATCH, M3_INVALID_AUTHORITY_MATERIAL, M3_MALFORMED_BATTLE_MATERIAL,
    ProtocolViolation, ReplicaApplyError, map_material_apply_error,
};
use er_content::pack::{ContentPack, selected_content_pack};
use er_game::material::{
    BattleMaterialApplyContext, BattleMaterialApplyError, BattleTurnMaterialV1,
    apply_turn_material, decode_replacement_material, decode_turn_material,
};
use serde_json::{Value, json};

const MATERIAL_SOURCE: &str = include_str!("../../er-game/src/material.rs");
const REPLICA_SOURCE: &str = include_str!("../src/battle_replica.rs");
const CONTENT_FIXTURE: &str = include_str!("../../../fixtures/m3/oracle/content-pack-v1.json");
const VICTORY_CASE_FIXTURE: &str =
    include_str!("../../../fixtures/m3/oracle/battle-cases/victory.json");
const CONTROL_FIXTURE: &str =
    include_str!("../../../fixtures/m3/schema/battle-control-plan-v1.json");
const LEGACY_ORACLE_CONTENT_DIGEST: &str =
    "3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";
const LEGACY_ORACLE_CONTENT_HASH: &str =
    "blake3-v1:3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";

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
    let missing_signature = format!("missing line-anchored function signature {signature:?}");
    let (offset, _) = matches.next().expect(&missing_signature);
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

fn is_status_kind_tag(tag: &str) -> bool {
    matches!(
        tag,
        "NONE" | "POISON" | "TOXIC" | "PARALYSIS" | "SLEEP" | "BURN"
    )
}

fn adapt_legacy_condition_kind(condition: &mut Value) -> Result<(), &'static str> {
    let kind = condition
        .as_object_mut()
        .and_then(|condition| condition.get_mut("kind"))
        .ok_or("condition kind is missing or invalid")?;
    if let Value::String(tag) = kind {
        let tag = tag.clone();
        *kind = json!({"kind": tag});
    }

    let adjacent = kind
        .as_object()
        .ok_or("condition kind is not an adjacent object")?;
    match adjacent.get("kind").and_then(Value::as_str) {
        Some("NONE") if adjacent.len() == 1 => Ok(()),
        Some("UNSUPPORTED_ORACLE_CODE") if adjacent.len() == 2 => {
            let value = adjacent
                .get("value")
                .and_then(Value::as_u64)
                .ok_or("unsupported condition code is not an unsigned integer")?;
            if value > u64::from(u16::MAX) {
                return Err("unsupported condition code exceeds u16");
            }
            Ok(())
        }
        _ => Err("condition kind has unknown, extra, or malformed fields"),
    }
}

fn adapt_legacy_game_state(state: &mut Value) -> Result<(), &'static str> {
    let battle = state
        .get_mut("battle")
        .and_then(Value::as_object_mut)
        .ok_or("battle is missing or invalid")?;

    let format_slots = battle
        .get("format")
        .and_then(Value::as_object)
        .and_then(|format| format.get("slots"))
        .and_then(Value::as_array)
        .ok_or("format.slots is missing or is not an array")?;
    let field_slots = battle
        .get("field")
        .and_then(Value::as_object)
        .and_then(|field| field.get("slots"))
        .and_then(Value::as_array)
        .ok_or("field.slots is missing or is not an array")?;
    if format_slots != field_slots {
        return Err("format.slots does not exactly match field.slots");
    }
    battle
        .get_mut("format")
        .and_then(Value::as_object_mut)
        .and_then(|format| format.remove("slots"))
        .ok_or("format.slots could not be removed")?;

    for party_name in ["player_party", "enemy_party"] {
        let party = battle
            .get_mut(party_name)
            .and_then(Value::as_array_mut)
            .ok_or("party is missing or is not an array")?;
        for pokemon in party {
            let kind = pokemon
                .get_mut("status")
                .and_then(Value::as_object_mut)
                .and_then(|status| status.get_mut("kind"))
                .ok_or("status kind is missing or invalid")?;
            match kind {
                Value::String(tag) if is_status_kind_tag(tag) => {}
                Value::String(_) => return Err("status kind has an unknown tag"),
                Value::Object(nested) => {
                    if nested.len() != 1 {
                        return Err("nested status kind has extra or missing fields");
                    }
                    let tag = nested
                        .get("kind")
                        .and_then(Value::as_str)
                        .ok_or("nested status kind is not a string")?
                        .to_owned();
                    if !is_status_kind_tag(&tag) {
                        return Err("nested status kind has an unknown tag");
                    }
                    *kind = Value::String(tag);
                }
                _ => return Err("status kind is neither a string nor an exact kind wrapper"),
            }
        }
    }

    for condition_name in ["weather", "terrain"] {
        let condition = battle
            .get_mut(condition_name)
            .ok_or("condition is missing")?;
        adapt_legacy_condition_kind(condition)?;
    }
    Ok(())
}

fn adapt_legacy_content_pack_condition_subjects(
    content_pack: &mut Value,
) -> Result<(), &'static str> {
    let entries = content_pack
        .get_mut("capability_manifest")
        .and_then(Value::as_object_mut)
        .and_then(|manifest| manifest.get_mut("entries"))
        .and_then(Value::as_array_mut)
        .ok_or("capability manifest entries are missing or invalid")?;

    for entry in entries {
        let subject = entry
            .get_mut("subject")
            .and_then(Value::as_object_mut)
            .ok_or("capability subject is missing or invalid")?;
        let subject_kind = subject
            .get("kind")
            .and_then(Value::as_str)
            .ok_or("capability subject kind is missing or invalid")?;
        if !matches!(subject_kind, "WEATHER" | "TERRAIN") {
            continue;
        }
        if subject.len() != 2 || !subject.contains_key("value") {
            return Err("weather/terrain capability subject has extra or missing fields");
        }

        let value = subject
            .get("value")
            .cloned()
            .ok_or("weather/terrain capability subject value is missing")?;
        let normalized = match value {
            Value::String(tag) if tag == "NONE" => json!({"kind": "NONE"}),
            Value::String(_) => {
                return Err("weather/terrain capability subject has an unknown legacy tag");
            }
            Value::Object(adjacent) => {
                match adjacent.get("kind").and_then(Value::as_str) {
                    Some("NONE") if adjacent.len() == 1 => {}
                    Some("UNSUPPORTED_ORACLE_CODE") if adjacent.len() == 2 => {
                        let value = adjacent
                            .get("value")
                            .and_then(Value::as_u64)
                            .ok_or("unsupported weather/terrain code is not an unsigned integer")?;
                        if value > u64::from(u16::MAX) {
                            return Err("unsupported weather/terrain code exceeds u16");
                        }
                    }
                    _ => {
                        return Err(
                            "weather/terrain capability subject has an unknown, extra, or malformed adjacent tag",
                        );
                    }
                }
                Value::Object(adjacent)
            }
            _ => {
                return Err("weather/terrain capability subject has an invalid value");
            }
        };
        subject.insert("value".to_owned(), normalized);
    }
    Ok(())
}

fn normalize_legacy_type_chart(
    content_pack: &mut Value,
    selected: &ContentPack,
) -> Result<(), &'static str> {
    let expected_entries = serde_json::to_value(&selected.type_chart.entries)
        .map_err(|_| "selected type chart entries do not serialize")?
        .as_array()
        .cloned()
        .ok_or("selected type chart entries are not an array")?;
    let entries = content_pack
        .get_mut("type_chart")
        .and_then(|chart| chart.get_mut("entries"))
        .and_then(Value::as_array_mut)
        .ok_or("content fixture type chart entries are missing or invalid")?;
    let legacy_entries = entries.clone();
    if legacy_entries.len() != expected_entries.len() {
        return Err("content fixture type chart entry count differs from selected content");
    }
    for expected in &expected_entries {
        if legacy_entries
            .iter()
            .filter(|entry| *entry == expected)
            .count()
            != 1
        {
            return Err("content fixture type chart differs from selected content");
        }
    }
    *entries = expected_entries;
    Ok(())
}

fn adapt_legacy_content_pack(
    artifact: &mut Value,
    selected: &ContentPack,
) -> Result<(), &'static str> {
    let provenance = artifact
        .get("provenance")
        .and_then(Value::as_object)
        .ok_or("content fixture provenance is missing or invalid")?;
    let provenance_hash = provenance
        .get("content_pack_hash")
        .and_then(Value::as_str)
        .ok_or("content fixture provenance content_pack_hash is missing or invalid")?;
    let provenance_oracle_sha = provenance
        .get("oracle_game_sha")
        .and_then(Value::as_str)
        .ok_or("content fixture provenance oracle_game_sha is missing or invalid")?;
    let content_pack = artifact
        .get("content_pack")
        .and_then(Value::as_object)
        .ok_or("content fixture content_pack is missing or invalid")?;
    let pack_hash = content_pack
        .get("hash")
        .and_then(Value::as_str)
        .ok_or("content fixture content_pack hash is missing or invalid")?;
    let pack_oracle_sha = content_pack
        .get("oracle_game_sha")
        .and_then(Value::as_str)
        .ok_or("content fixture content_pack oracle_game_sha is missing or invalid")?;
    if pack_hash != LEGACY_ORACLE_CONTENT_HASH
        || provenance_hash != LEGACY_ORACLE_CONTENT_DIGEST
        || pack_oracle_sha != selected.oracle_game_sha.as_str()
        || provenance_oracle_sha != selected.oracle_game_sha.as_str()
    {
        return Err("content fixture is not the exact supported legacy identity");
    }

    let content_pack = artifact
        .get_mut("content_pack")
        .ok_or("content fixture content_pack is missing")?;
    normalize_legacy_type_chart(content_pack, selected)?;
    adapt_legacy_content_pack_condition_subjects(content_pack)?;
    content_pack
        .as_object_mut()
        .ok_or("content fixture content_pack is not an object")?
        .insert(
            "hash".to_owned(),
            Value::String(selected.hash.as_str().to_owned()),
        );
    Ok(())
}

fn adapt_legacy_selected_content_hash(
    state: &mut Value,
    fixture: &mut Value,
    content: &ContentPack,
) -> Result<(), &'static str> {
    let state_hash = state
        .get("content_hash")
        .and_then(Value::as_str)
        .ok_or("state content_hash is missing or invalid")?
        .to_owned();
    let provenance = fixture
        .get("provenance")
        .and_then(Value::as_object)
        .ok_or("fixture provenance is missing or invalid")?;
    let provenance_hash = provenance
        .get("content_pack_hash")
        .and_then(Value::as_str)
        .ok_or("fixture provenance content_pack_hash is missing or invalid")?
        .to_owned();
    let provenance_oracle_sha = provenance
        .get("oracle_game_sha")
        .and_then(Value::as_str)
        .ok_or("fixture provenance oracle_game_sha is missing or invalid")?;
    if provenance_oracle_sha != content.oracle_game_sha.as_str() {
        return Err("fixture provenance oracle_game_sha disagrees with selected content");
    }
    for state_name in ["initial_state", "expected_final_state"] {
        let peer_hash = fixture
            .get(state_name)
            .and_then(Value::as_object)
            .and_then(|state| state.get("canonical"))
            .and_then(Value::as_object)
            .and_then(|canonical| canonical.get("content_hash"))
            .and_then(Value::as_str)
            .ok_or("fixture canonical content_hash is missing or invalid")?;
        if peer_hash != state_hash.as_str() {
            return Err("fixture canonical state hashes disagree");
        }
    }
    let selected_hash = content.hash.as_str();
    let selected_digest = selected_hash
        .strip_prefix("blake3-v1:")
        .ok_or("selected content hash has an invalid prefix")?;

    if state_hash == selected_hash {
        if provenance_hash == selected_digest {
            return Ok(());
        }
        return Err("selected state hash disagrees with fixture provenance digest");
    }

    if state_hash != LEGACY_ORACLE_CONTENT_HASH || provenance_hash != LEGACY_ORACLE_CONTENT_DIGEST {
        return Err("fixture content identity is not the selected or exact legacy pair");
    }

    state
        .as_object_mut()
        .ok_or("state is not an object")?
        .insert(
            "content_hash".to_owned(),
            Value::String(selected_hash.to_owned()),
        );
    for state_name in ["initial_state", "expected_final_state"] {
        fixture
            .get_mut(state_name)
            .and_then(Value::as_object_mut)
            .and_then(|state| state.get_mut("canonical"))
            .and_then(Value::as_object_mut)
            .ok_or("fixture canonical state is missing or invalid")?
            .insert(
                "content_hash".to_owned(),
                Value::String(selected_hash.to_owned()),
            );
    }
    Ok(())
}

#[test]
fn typed_material_codecs_are_closed_and_canonical_only() {
    let unknown = serde_json::to_vec(&json!({"unknown": 1})).expect("JSON value serializes");
    assert!(decode_turn_material(&unknown).is_err());
    assert!(decode_replacement_material(&unknown).is_err());
    assert!(decode_turn_material(br#"{}"#).is_err());
    assert!(decode_replacement_material(br#"{}"#).is_err());

    let source = normalized_sanitized_source(MATERIAL_SOURCE);
    assert!(source.contains("serde(deny_unknown_fields)"));
    assert!(source.contains("canonical_bytes(&decoded)? != bytes"));
}

#[test]
fn material_self_digest_failure_precedes_local_state_and_other_tampering() {
    let selected = selected_content_pack().expect("selected content pack is valid");
    let mut content_value: serde_json::Value =
        serde_json::from_str(CONTENT_FIXTURE).expect("content fixture is JSON");
    adapt_legacy_content_pack(&mut content_value, &selected)
        .expect("legacy content pack adapts strictly");
    let content: ContentPack = serde_json::from_value(
        content_value
            .get("content_pack")
            .expect("content fixture has content_pack")
            .clone(),
    )
    .expect("content fixture is a typed content pack");
    assert_eq!(content, selected);
    let mut case_value: serde_json::Value =
        serde_json::from_str(VICTORY_CASE_FIXTURE).expect("victory fixture is JSON");
    let mut state_value = case_value
        .get("initial_state")
        .and_then(|value| value.get("canonical"))
        .expect("victory fixture has an initial canonical state")
        .clone();
    adapt_legacy_selected_content_hash(&mut state_value, &mut case_value, &content)
        .expect("legacy selected content hash adapts strictly");
    adapt_legacy_game_state(&mut state_value).expect("legacy initial state adapts strictly");
    let state: er_state::snapshot::GameState =
        serde_json::from_value(state_value.clone()).expect("initial state is typed");
    let next_control =
        serde_json::from_str::<er_types::battle_control::BattleControlPlan>(CONTROL_FIXTURE)
            .expect("control fixture is typed");
    let wrong_digest = format!("blake3-v1:{}", "0".repeat(64));
    let rng_before: er_rng::battle::BattleRngState =
        serde_json::from_value(state_value["battle"]["battle_rng"].clone())
            .expect("battle RNG is typed");
    let material = BattleTurnMaterialV1 {
        schema_version: 1,
        oracle_game_sha: content.oracle_game_sha.clone(),
        content_hash: content.hash.clone(),
        operation_id: serde_json::from_value(json!("battle/1/wave/1/turn/1/result"))
            .expect("operation ID is typed"),
        battle_id: serde_json::from_value(state_value["battle"]["battle_id"].clone())
            .expect("battle ID is typed"),
        wave: serde_json::from_value(state_value["battle"]["wave"].clone()).expect("wave is typed"),
        resolved_turn: serde_json::from_value(state_value["battle"]["turn"].clone())
            .expect("turn is typed"),
        before_digest: serde_json::from_value(json!(wrong_digest.clone()))
            .expect("digest is typed"),
        after_digest: serde_json::from_value(json!(wrong_digest)).expect("digest is typed"),
        commands: serde_json::from_value(json!({"entries": []}))
            .expect("empty command set is typed"),
        action_order: Vec::new(),
        mutations: Vec::new(),
        presentation: Vec::new(),
        presentation_digest: serde_json::from_value(json!(format!("blake3-v1:{}", "0".repeat(64))))
            .expect("presentation digest is typed"),
        rng_before: rng_before.clone(),
        rng_after: rng_before,
        rng_audit: Vec::new(),
        before_state: state.clone(),
        after_state: state.clone(),
        outcome: serde_json::from_value(json!("ONGOING")).expect("outcome is typed"),
        next_decision: serde_json::from_value(json!({"kind": "COMMAND_FRONTIER"}))
            .expect("next decision is typed"),
        menu_allocators_before: next_control.menu_allocators.clone(),
        next_control,
    };
    let context = BattleMaterialApplyContext {
        current_state: state,
        local_seat: material.next_control.seats[0].seat,
        menu_allocators: material.menu_allocators_before.clone(),
    };
    assert_eq!(
        apply_turn_material(&context, &material, &content),
        Err(BattleMaterialApplyError::InvalidMaterialBeforeDigest)
    );
}

#[test]
fn replica_maps_every_common_error_to_the_frozen_class() {
    let cases = [
        (
            BattleMaterialApplyError::MalformedIdentity,
            ReplicaApplyError::ProtocolViolation(ProtocolViolation::MalformedBattleMaterial),
        ),
        (
            BattleMaterialApplyError::SchemaVersionMismatch,
            ReplicaApplyError::ProtocolViolation(ProtocolViolation::MalformedBattleMaterial),
        ),
        (
            BattleMaterialApplyError::OracleIdentityMismatch,
            ReplicaApplyError::ProtocolViolation(ProtocolViolation::MalformedBattleMaterial),
        ),
        (
            BattleMaterialApplyError::ContentHashMismatch,
            ReplicaApplyError::ProtocolViolation(ProtocolViolation::ContentHashMismatch),
        ),
        (
            BattleMaterialApplyError::InvalidMaterialBeforeDigest,
            ReplicaApplyError::InvalidAfterState,
        ),
        (
            BattleMaterialApplyError::LocalBeforeStateMismatch,
            ReplicaApplyError::BeforeDigestMismatch,
        ),
        (
            BattleMaterialApplyError::InvalidEvidence,
            ReplicaApplyError::InvalidAfterState,
        ),
        (
            BattleMaterialApplyError::InvalidAfterState,
            ReplicaApplyError::InvalidAfterState,
        ),
        (
            BattleMaterialApplyError::InvalidControlProjection,
            ReplicaApplyError::InvalidAfterState,
        ),
        (
            BattleMaterialApplyError::MenuAllocatorMismatch,
            ReplicaApplyError::InvalidAfterState,
        ),
        (
            BattleMaterialApplyError::Invariant,
            ReplicaApplyError::Invariant,
        ),
    ];
    for (source, expected) in cases {
        assert_eq!(map_material_apply_error(source), expected);
    }
    assert_eq!(
        M3_CONTENT_HASH_MISMATCH,
        ProtocolViolation::ContentHashMismatch.terminal_reason()
    );
    assert_eq!(
        M3_MALFORMED_BATTLE_MATERIAL,
        ProtocolViolation::MalformedBattleMaterial.terminal_reason()
    );
    assert_eq!(
        M3_INVALID_AUTHORITY_MATERIAL,
        ReplicaApplyError::InvalidAfterState
            .terminal_reason()
            .expect("invalid material terminalizes")
    );
    assert!(ReplicaApplyError::BeforeDigestMismatch.is_recoverable());
    assert!(
        ReplicaApplyError::BeforeDigestMismatch
            .terminal_reason()
            .is_none()
    );
}

#[test]
fn authority_and_replica_are_role_neutral_and_replica_never_resolves() {
    let material_source = normalized_sanitized_source(MATERIAL_SOURCE);
    let replica_source = normalized_sanitized_source(REPLICA_SOURCE);
    assert!(material_source.contains("pub fn apply_turn_material"));
    assert!(material_source.contains("pub fn apply_replacement_material"));
    assert!(material_source.contains("validate_turn_evidence"));
    assert!(material_source.contains("validate_replacement_evidence"));
    assert!(replica_source.contains("apply_turn_material(current"));
    assert!(replica_source.contains("apply_replacement_material(current"));
    assert!(!replica_source.contains("resolve_turn"));
    assert!(!replica_source.contains("resolve_replacement"));
}

#[test]
fn turn_partial_frontier_and_replacement_full_equality_guards_are_present() {
    let source = normalized_sanitized_source(MATERIAL_SOURCE);
    let frontier = source
        .find("fn reconcile_turn_frontier")
        .expect("TURN reconciliation exists");
    let next_frontier = source
        .find("fn validate_fresh_command_frontier")
        .expect("TURN after-state frontier validation exists");
    let retained = source
        .find("fn retained_command")
        .expect("retained command subset guard exists");
    let admitted = source
        .find("fn admitted_command")
        .expect("admitted command subset guard exists");
    let replacement = source
        .find("if current.current_state != material.before_state")
        .expect("REPLACEMENT requires full before-state equality");
    assert!(frontier < retained && frontier < admitted);
    assert!(replacement < frontier && frontier < next_frontier);
    assert!(source.contains("same_frontier_window"));
    assert!(
        source.contains("current_command != remote_command")
            || source.contains("local_command != remote_command")
    );
    for required in [
        "CommandFrontierStatus::Pending",
        "CommandAdmissionSource::ScriptedEnemy",
        "build_scripted_enemy_offer",
        "validate_next_state_command_collection",
        "project_battle_control_plan",
    ] {
        assert!(
            source.contains(required),
            "missing frontier guard {required}"
        );
    }
    assert!(!source.contains("fn validate_command_root_menu"));
    assert!(!source.contains("fn validate_replacement_menu"));
}

#[test]
fn digest_evidence_presentation_and_state_tampering_are_fail_closed() {
    let source = normalized_sanitized_source(MATERIAL_SOURCE);
    let public_turn = extract_function_section(
        &source,
        "pub fn apply_turn_material(",
        "pub fn apply_turn_material_trusted(",
    );
    let public_turn_trusted = extract_function_section(
        &source,
        "pub fn apply_turn_material_trusted(",
        "pub fn apply_reducer_issued_turn_material_trusted(",
    );
    let reducer_turn = extract_function_section(
        &source,
        "pub fn apply_reducer_issued_turn_material_trusted(",
        "fn bind_reducer_issued_turn_material<'a>(",
    );
    let authority_binder = extract_function_section(
        &source,
        "fn bind_reducer_issued_turn_material<'a>(",
        "fn apply_bound_reducer_turn_material(",
    );
    let turn_inner = extract_function_section(
        &source,
        "fn apply_turn_material_inner(",
        "pub fn apply_replacement_material(",
    );

    for (name, section, signature) in [
        (
            "apply_turn_material",
            public_turn.as_str(),
            concat!(
                "pub fn apply_turn_material(\n",
                "    current: &BattleMaterialApplyContext,",
            ),
        ),
        (
            "apply_turn_material_trusted",
            public_turn_trusted.as_str(),
            concat!(
                "pub fn apply_turn_material_trusted(\n",
                "    current: &BattleMaterialApplyContext,",
            ),
        ),
    ] {
        assert!(
            section.starts_with(signature),
            "{name} no longer accepts current: &BattleMaterialApplyContext",
        );
    }
    let turn_inner_forwarding = concat!(
        "apply_turn_material_inner(\n",
        "        &current.current_state,\n",
        "        current.local_seat,\n",
        "        &current.menu_allocators,",
    );
    assert!(
        public_turn.contains(turn_inner_forwarding),
        "public TURN wrapper no longer forwards the current state, local seat, and menu allocators",
    );
    assert!(
        public_turn_trusted.contains(turn_inner_forwarding),
        "trusted TURN wrapper no longer forwards the current state, local seat, and menu allocators",
    );
    assert!(
        reducer_turn.starts_with(concat!(
            "pub fn apply_reducer_issued_turn_material_trusted(\n",
            "    current_state: &GameState,\n",
            "    local_seat: SeatId,\n",
            "    menu_allocators: &[SeatMenuInstanceAllocator],",
            "\n    material: &BattleTurnMaterialV1,\n",
            "    content: &ContentPack,\n",
            "    prepared: &PreparedAuthorityTurn,\n",
        )),
        "reducer-issued TURN entry point changed its borrowed state/seat/allocator/prepared views",
    );
    assert!(
        reducer_turn.contains("let proof = bind_reducer_issued_turn_material("),
        "reducer-issued TURN path no longer binds authority-local material evidence",
    );
    assert!(
        reducer_turn.contains("apply_bound_reducer_turn_material(material, proof)"),
        "reducer-issued TURN path no longer forwards the opaque authority-local proof",
    );
    assert!(!reducer_turn.contains("apply_turn_material_inner("));
    assert!(
        turn_inner.starts_with(concat!(
            "fn apply_turn_material_inner(\n",
            "    current_state: &GameState,\n",
            "    local_seat: SeatId,\n",
            "    current_menu_allocators: &[SeatMenuInstanceAllocator],",
        )),
        "TURN inner path changed its borrowed endpoint views",
    );
    assert!(
        turn_inner.contains(
            "validate_endpoint_allocators(\n        current_menu_allocators,\n        local_seat,",
        ),
        "TURN inner path no longer forwards its borrowed allocator slice",
    );

    for required in [
        "verify_material_before_digest",
        "validate_after_state_and_digest",
        "DigestValidationMode::Independent",
        "validate_battle_mutation_evidence",
        "compute_presentation_plan_digest",
        "event.event_id.sequence",
        "validate_turn_rng",
        "validate_replacement_rng",
    ] {
        assert!(source.contains(required), "missing guard {required}");
    }
    assert!(
        source.contains("BattlePresentationKind::BattleWon")
            && source.contains("BattlePresentationKind::BattleLost")
    );
    assert!(!reducer_turn.contains("DigestValidationMode::ReducerIssued"));
    for evidence_check in [
        "material.before_state != transition.before_state",
        "material.before_digest != transition.before_digest",
        "material.after_state != transition.after_state",
        "material.after_digest != transition.after_digest",
    ] {
        assert!(
            authority_binder.contains(evidence_check),
            "authority-local material binder omitted {evidence_check}",
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
            authority_binder.contains(retained_endpoint_guard),
            "authority-local material binder omitted {retained_endpoint_guard}",
        );
    }
    assert!(!MATERIAL_SOURCE.contains("skip_digest"));
}

#[test]
fn allocator_internal_validation_precedes_endpoint_recovery_classification() {
    let source = normalized_sanitized_source(MATERIAL_SOURCE);
    let turn_inner = extract_function_section(
        &source,
        "fn apply_turn_material_inner(",
        "pub fn apply_replacement_material(",
    );
    let authority_binder = extract_function_section(
        &source,
        "fn bind_reducer_issued_turn_material<'a>(",
        "fn apply_bound_reducer_turn_material(",
    );
    let internal = turn_inner
        .find("let menu_allocators = validate_allocator_projection(")
        .expect("internal allocator projection exists");
    let strict_endpoint = turn_inner
        .find("validate_endpoint_allocators(")
        .expect("endpoint allocator comparison exists");
    assert!(internal < strict_endpoint);
    let authority_endpoint = authority_binder
        .find("validate_endpoint_allocators(")
        .expect("authority-local endpoint allocator comparison exists");
    let proof = authority_binder
        .find("let proof = prepared.bind_authority_local_turn(")
        .expect("authority-local proof construction exists");
    assert!(authority_endpoint < proof);
    assert!(source.contains("MenuAllocatorMismatch"));
    assert!(source.contains("LocalBeforeStateMismatch"));
    assert!(source.contains("after_id < before_id"));
    assert!(source.contains("*id < before_id || *id >= after_id"));
}

#[test]
fn no_legal_replacement_is_validated_as_explicit_material_evidence() {
    let source = normalized_sanitized_source(MATERIAL_SOURCE);
    assert!(source.contains("pub selection: ReplacementSelection"));
    assert!(source.contains("validate_replacement_selection_trusted("));
    assert!(source.contains("legal_replacement_candidates"));
    assert!(source.contains("candidates.is_empty()"));
    assert!(source.contains("stored.replacement == ReplacementProgress::NoLegalReplacement"));
    assert!(source.contains("material.occurrence.id"));
    assert!(source.contains("validate_replacement_identity"));
}

#[test]
fn adapter_rejects_non_material_authority_entry_kinds_without_fallback() {
    let source = normalized_sanitized_source(REPLICA_SOURCE);
    assert!(!source.contains("pub fn apply_authority_material_payload"));
    for kind in [
        "AuthorityEntryKind::InteractionCommit",
        "AuthorityEntryKind::ControlCommit",
        "AuthorityEntryKind::WaveAdvance",
        "AuthorityEntryKind::TerminalCommit",
    ] {
        assert!(source.contains(kind), "missing closed kind branch {kind}");
    }
    assert!(source.contains("MalformedBattleMaterial"));
    assert!(!source.contains("fallback"));
}
