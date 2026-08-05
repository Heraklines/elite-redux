use std::collections::BTreeSet;
use std::error::Error;
use std::fmt::{Display, Formatter};

use er_canonical::fixture_digest;
use serde_json::Value;

const MAP_FIXTURE: &str =
    include_str!("../../../../rust/fixtures/v1/authority-v2-test-map.json");
const SOURCE_ORACLE: &str =
    include_str!("../../../../schemas/kernel/source/authority-v2-map-v1.json");
const PARITY_FIXTURES: &str =
    include_str!("../../../../test/kernel-fixtures/v1/authority-v2/contracts.json");

const EVIDENCE_PATH: &str =
    "rust/crates/er-protocol/tests/authority_v2_contract_map.rs::";
const PARITY_FIXTURE_PATH: &str = "test/kernel-fixtures/v1/authority-v2/contracts.json#";
const FROZEN_RUST_TARGET_FILES: &[&str] = &[
    "rust/crates/er-types/src/authority.rs",
    "rust/crates/er-types/src/protocol.rs",
    "rust/crates/er-protocol/src/authority_log.rs",
    "rust/crates/er-protocol/src/proposal.rs",
    "rust/crates/er-protocol/src/recovery.rs",
    "rust/crates/er-protocol/src/replica.rs",
    "rust/crates/er-protocol/src/scheduler.rs",
    "rust/crates/er-protocol/src/successor.rs",
    "rust/crates/er-protocol/src/validation.rs",
];

type TestResult = Result<(), Box<dyn Error>>;

#[derive(Debug)]
struct ContractMapError(String);

impl Display for ContractMapError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl Error for ContractMapError {}

fn failure(message: impl Into<String>) -> Box<dyn Error> {
    Box::new(ContractMapError(message.into()))
}

fn parse_json(raw: &str) -> Result<Value, serde_json::Error> {
    serde_json::from_str(raw)
}

fn array<'a>(value: &'a Value, field: &str) -> Result<&'a Vec<Value>, Box<dyn Error>> {
    value
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| failure(format!("{field} must be a JSON array")))
}

fn string_field<'a>(value: &'a Value, field: &str) -> Result<&'a str, Box<dyn Error>> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| failure(format!("{field} must be a JSON string")))
}

fn fixture_id(reference: &str) -> Result<&str, Box<dyn Error>> {
    let Some((path, id)) = reference.split_once('#') else {
        return Err(failure(format!("fixture reference has no fragment: {reference}")));
    };
    if path != PARITY_FIXTURE_PATH.trim_end_matches('#') || id.is_empty() {
        return Err(failure(format!("fixture reference has the wrong path: {reference}")));
    }
    Ok(id)
}

fn fixture_record<'a>(fixtures: &'a [Value], id: &str) -> Result<&'a Value, Box<dyn Error>> {
    fixtures
        .iter()
        .find(|fixture| fixture.get("fixture_id").and_then(Value::as_str) == Some(id))
        .ok_or_else(|| failure(format!("fixture {id} is missing")))
}

fn assert_concrete_rust_targets(value: &Value, field: &str) -> TestResult {
    let targets = array(value, field)?;
    assert!(!targets.is_empty(), "{field} must not be empty");
    for target in targets {
        let target = target
            .as_str()
            .ok_or_else(|| failure(format!("{field} contains a non-string target")))?;
        let Some((path, symbol)) = target.split_once("::") else {
            return Err(failure(format!("{field} target is module-only: {target}")));
        };
        assert!(path.starts_with("rust/crates/"), "non-Rust target: {target}");
        assert!(path.ends_with(".rs"), "Rust target must name a source file: {target}");
        assert!(
            FROZEN_RUST_TARGET_FILES.contains(&path),
            "Rust target is outside the frozen DTO/stub inventory: {target}"
        );
        assert!(!symbol.is_empty(), "Rust target must name a symbol: {target}");
        assert!(!symbol.contains("placeholder"), "placeholder Rust target: {target}");
        assert!(!symbol.contains("pending"), "pending Rust target: {target}");
    }
    Ok(())
}

fn assert_static_status(value: &Value, field: &str) -> TestResult {
    let status = string_field(value, field)?;
    for forbidden in ["pass", "green", "complete"] {
        assert!(
            !status.to_ascii_lowercase().contains(forbidden),
            "status must not claim unimplemented behavior: {status}"
        );
    }
    let reason = string_field(value, "reason")?;
    assert!(!reason.trim().is_empty(), "status reason must be explicit");
    Ok(())
}

fn assert_fixture_case_shape(fixture: &Value) -> TestResult {
    let cases = array(fixture, "cases")?;
    assert!(!cases.is_empty(), "fixture must contain concrete cases");
    for case in cases {
        let case_id = string_field(case, "case_id")?;
        assert!(!case_id.is_empty(), "fixture case ID must not be empty");
        let rust_types = array(case, "rust_types")?;
        assert!(!rust_types.is_empty(), "fixture case must name Rust types/symbols");
        for rust_type in rust_types {
            let rust_type = rust_type
                .as_str()
                .ok_or_else(|| failure(format!(
                    "fixture case {case_id} has a non-string Rust target"
                )))?;
            assert!(rust_type.contains("::"), "fixture case target is vague: {rust_type}");
        }
        assert!(!string_field(case, "rust_assertion")?.trim().is_empty());
        assert!(!string_field(case, "oracle_boundary")?.trim().is_empty());
    }
    Ok(())
}

fn validate_fixture_payload(map: &Value, fixture_root: &Value) -> TestResult {
    assert_eq!(fixture_root.get("schema_version").and_then(Value::as_u64), Some(1));
    assert_eq!(
        string_field(fixture_root, "fixture_kind")?,
        "authority-v2-contract-evidence-v1"
    );
    assert_eq!(
        string_field(fixture_root, "oracle_game_sha")?,
        "3b534099919efae827019d4a3f3c4ab0ecd6d67b"
    );
    assert_eq!(string_field(fixture_root, "protocol_version")?, "er-coop-47");

    let payload = fixture_root
        .get("payload")
        .ok_or_else(|| failure("fixture payload is missing"))?;
    let fixtures = payload
        .as_array()
        .ok_or_else(|| failure("fixture payload must be an array"))?;
    assert_eq!(fixtures.len(), 29);
    let expected_digest = string_field(fixture_root, "canonical_digest")?;
    let actual_digest = fixture_digest(payload)?;
    assert_eq!(actual_digest, expected_digest);

    let node_contracts = array(map, "node_contracts")?;
    assert_eq!(node_contracts.len(), fixtures.len());
    let mut fixture_ids = BTreeSet::new();
    let mut fixture_sources = BTreeSet::new();
    for (node, fixture) in node_contracts.iter().zip(fixtures) {
        let id = string_field(node, "id")?;
        let fixture_id = string_field(fixture, "fixture_id")?;
        assert_eq!(fixture_id, id, "fixture order/identity must be deterministic");
        assert!(fixture_ids.insert(fixture_id), "duplicate fixture ID: {fixture_id}");
        let node_source = string_field(node, "typescript_source")?;
        assert_eq!(string_field(fixture, "typescript_source")?, node_source);
        assert!(fixture_sources.insert(node_source), "duplicate fixture source: {node_source}");
        let symbols = array(fixture, "source_lock_symbols")?;
        assert!(!symbols.is_empty(), "fixture must name source-lock symbols");
        assert_fixture_case_shape(fixture)?;
    }

    let source_lock_contracts = array(map, "source_lock_contracts")?;
    for contract in source_lock_contracts {
        let reference = string_field(contract, "parity_fixture")?;
        let id = fixture_id(reference)?;
        let fixture = fixture_record(fixtures, id)?;
        let symbol = string_field(contract, "source_lock_symbol")?;
        let symbols = array(fixture, "source_lock_symbols")?;
        assert!(
            symbols.iter().any(|candidate| candidate.as_str() == Some(symbol)),
            "fixture {id} does not carry source-lock symbol {symbol}"
        );
    }
    Ok(())
}

fn validate_source_lock_contracts(map: &Value, oracle: &Value) -> TestResult {
    let contracts = array(map, "source_lock_contracts")?;
    let schemas = array(oracle, "schemas")?;
    assert_eq!(contracts.len(), 29);
    assert_eq!(schemas.len(), 29);

    let mut ids = BTreeSet::new();
    let mut symbols = BTreeSet::new();
    let mut sources = BTreeSet::new();
    for (contract, schema) in contracts.iter().zip(schemas) {
        let id = string_field(contract, "id")?;
        let symbol = string_field(contract, "source_lock_symbol")?;
        let source = string_field(contract, "typescript_source")?;
        assert!(ids.insert(id), "duplicate source-lock ID: {id}");
        assert!(symbols.insert(symbol), "duplicate source-lock symbol: {symbol}");
        assert!(sources.insert(source), "duplicate source-lock node: {source}");
        assert_eq!(symbol, string_field(schema, "symbol")?);
        assert_eq!(source, string_field(schema, "source")?);
        assert_concrete_rust_targets(contract, "rust_equivalent")?;
        assert_eq!(
            string_field(contract, "rust_evidence")?,
            format!("{EVIDENCE_PATH}source_contract_{id}")
        );
        let fixture = string_field(contract, "parity_fixture")?;
        let _ = fixture_id(fixture)?;
        assert_static_status(contract, "status")?;
        let target_layer = string_field(schema, "target_layer")?;
        if target_layer == "browser_adapter" {
            assert!(
                !contract
                    .get("nonportable_boundary")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim()
                    .is_empty(),
                "browser adapter contract requires a boundary reason: {symbol}"
            );
        }
    }
    Ok(())
}

fn validate_node_contracts(map: &Value, oracle: &Value) -> TestResult {
    let contracts = array(map, "node_contracts")?;
    let tests = array(oracle, "tests")?;
    let source_files = array(oracle, "source_files")?;
    assert_eq!(contracts.len(), 29);
    assert_eq!(tests.len(), 29);

    let mut ids = BTreeSet::new();
    let mut sources = BTreeSet::new();
    let mut production = 0;
    let mut simulator = 0;
    for (contract, oracle_test) in contracts.iter().zip(tests) {
        let id = string_field(contract, "id")?;
        let source = string_field(contract, "typescript_source")?;
        assert!(ids.insert(id), "duplicate node contract ID: {id}");
        assert!(sources.insert(source), "duplicate node source: {source}");
        assert_eq!(source, string_field(oracle_test, "path")?);
        assert_eq!(
            string_field(contract, "oracle_semantics")?,
            string_field(oracle_test, "semantics")?
        );
        assert_eq!(
            string_field(contract, "oracle_covers")?,
            string_field(oracle_test, "covers")?
        );

        let source_record = source_files
            .iter()
            .find(|record| record.get("path").and_then(Value::as_str) == Some(source))
            .ok_or_else(|| failure(format!(
                "node source is not pinned in source_files: {source}"
            )))?;
        let expected_kind = if source.ends_with("authority-v2-simulator.test.ts") {
            "simulator-test"
        } else {
            "node-pure-test"
        };
        assert_eq!(string_field(source_record, "kind")?, expected_kind);
        assert_eq!(array(contract, "source_nodes")?, array(source_record, "citations")?);

        let implementation_kind = string_field(contract, "implementation_kind")?;
        if expected_kind == "simulator-test" {
            assert_eq!(implementation_kind, "reference-simulator");
            simulator += 1;
        } else {
            assert_eq!(implementation_kind, "production");
            production += 1;
        }
        assert_concrete_rust_targets(contract, "rust_equivalent")?;
        assert_eq!(
            string_field(contract, "rust_evidence")?,
            format!("{EVIDENCE_PATH}node_contract_{id}")
        );
        let fixture = string_field(contract, "parity_fixture")?;
        assert_eq!(fixture_id(fixture)?, id);
        assert_static_status(contract, "status")?;
        if implementation_kind == "reference-simulator" {
            assert!(
                string_field(contract, "status")?.contains("reference-only"),
                "simulator status must remain reference-only"
            );
        }
        let boundary = contract
            .get("nonportable_boundary")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if string_field(contract, "status")?.starts_with("boundary-") {
            assert!(!boundary.trim().is_empty(), "boundary mapping needs a reason");
        }
    }
    assert_eq!(production, 28);
    assert_eq!(simulator, 1);
    Ok(())
}

fn validate_map() -> TestResult {
    let map = parse_json(MAP_FIXTURE)?;
    let oracle = parse_json(SOURCE_ORACLE)?;
    let fixture_root = parse_json(PARITY_FIXTURES)?;

    assert_eq!(map.get("schema_version").and_then(Value::as_u64), Some(1));
    assert_eq!(string_field(&map, "map_id")?, "authority-v2-test-map-v1");
    assert_eq!(
        string_field(&map, "oracle_game_sha")?,
        "3b534099919efae827019d4a3f3c4ab0ecd6d67b"
    );
    assert_eq!(
        string_field(&map, "oracle_branch")?,
        "ci/coop/v2-showdown-command-coordinate-20260720"
    );
    assert_eq!(string_field(&map, "protocol_version")?, "er-coop-47");
    assert_eq!(map.get("frame_protocol_version").and_then(Value::as_u64), Some(2));
    assert_eq!(map.get("status_policy").and_then(|value| value.get("functional_claim")).and_then(Value::as_bool), Some(false));

    let source_oracle = map
        .get("source_oracle")
        .ok_or_else(|| failure("source_oracle metadata is missing"))?;
    assert_eq!(string_field(source_oracle, "path")?, "schemas/kernel/source/authority-v2-map-v1.json");
    assert_eq!(source_oracle.get("schema_version").and_then(Value::as_u64), Some(1));
    assert_eq!(source_oracle.get("source_file_count").and_then(Value::as_u64), Some(66));
    assert_eq!(source_oracle.get("production_module_count").and_then(Value::as_u64), Some(37));
    assert_eq!(source_oracle.get("node_test_count").and_then(Value::as_u64), Some(29));
    assert_eq!(source_oracle.get("schema_contract_count").and_then(Value::as_u64), Some(29));

    let source_lock = map
        .get("source_lock")
        .ok_or_else(|| failure("source_lock metadata is missing"))?;
    assert_eq!(string_field(source_lock, "path")?, "rust/source-lock.toml");
    assert_eq!(source_lock.get("schema_version").and_then(Value::as_u64), Some(1));
    assert_eq!(string_field(source_lock, "oracle_game_sha")?, string_field(&map, "oracle_game_sha")?);
    assert_eq!(string_field(source_lock, "oracle_branch")?, string_field(&map, "oracle_branch")?);
    assert_eq!(string_field(source_lock, "protocol_version")?, string_field(&map, "protocol_version")?);

    let source_files = array(&oracle, "source_files")?;
    assert_eq!(source_files.len(), 66);
    let mut source_paths = BTreeSet::new();
    let mut production_modules = 0;
    let mut node_tests = 0;
    let mut simulator_tests = 0;
    for source_file in source_files {
        let path = string_field(source_file, "path")?;
        assert!(source_paths.insert(path), "duplicate pinned source path: {path}");
        match string_field(source_file, "kind")? {
            "production" => production_modules += 1,
            "node-pure-test" => node_tests += 1,
            "simulator-test" => simulator_tests += 1,
            kind => return Err(failure(format!("unknown source-file kind: {kind}"))),
        }
    }
    assert_eq!(production_modules, 37);
    assert_eq!(node_tests, 28);
    assert_eq!(simulator_tests, 1);

    validate_source_lock_contracts(&map, &oracle)?;
    validate_node_contracts(&map, &oracle)?;
    validate_fixture_payload(&map, &fixture_root)?;
    Ok(())
}

#[test]
fn authority_v2_contract_map_is_complete_and_exactly_pinned() -> TestResult {
    validate_map()
}

macro_rules! source_contract_test {
    ($name:ident) => {
        #[test]
        fn $name() -> TestResult {
            let map = parse_json(MAP_FIXTURE)?;
            let oracle = parse_json(SOURCE_ORACLE)?;
            let contracts = array(&map, "source_lock_contracts")?;
            let schemas = array(&oracle, "schemas")?;
            let id = stringify!($name)
                .strip_prefix("source_contract_")
                .ok_or_else(|| failure("source evidence test name has no ID"))?;
            let contract = contracts
                .iter()
                .find(|record| record.get("id").and_then(Value::as_str) == Some(id))
                .ok_or_else(|| failure(format!(
                    "source contract evidence is missing: {id}"
                )))?;
            let schema = schemas
                .iter()
                .find(|record| record.get("symbol").and_then(Value::as_str)
                    == contract.get("source_lock_symbol").and_then(Value::as_str))
                .ok_or_else(|| failure(format!("source schema is missing for: {id}")))?;
            assert_eq!(
                string_field(contract, "typescript_source")?,
                string_field(schema, "source")?
            );
            assert_concrete_rust_targets(contract, "rust_equivalent")?;
            assert_static_status(contract, "status")?;
            Ok(())
        }
    };
}

macro_rules! node_contract_test {
    ($name:ident) => {
        #[test]
        fn $name() -> TestResult {
            let map = parse_json(MAP_FIXTURE)?;
            let fixture_root = parse_json(PARITY_FIXTURES)?;
            let contracts = array(&map, "node_contracts")?;
            let fixtures = array(&fixture_root, "payload")?;
            let id = stringify!($name)
                .strip_prefix("node_contract_")
                .ok_or_else(|| failure("node evidence test name has no ID"))?;
            let contract = contracts
                .iter()
                .find(|record| record.get("id").and_then(Value::as_str) == Some(id))
                .ok_or_else(|| failure(format!(
                    "node contract evidence is missing: {id}"
                )))?;
            let fixture = fixture_record(fixtures, id)?;
            assert_eq!(string_field(contract, "typescript_source")?, string_field(fixture, "typescript_source")?);
            assert_eq!(fixture_id(string_field(contract, "parity_fixture")?)?, id);
            assert_concrete_rust_targets(contract, "rust_equivalent")?;
            assert_fixture_case_shape(fixture)?;
            assert_static_status(contract, "status")?;
            Ok(())
        }
    };
}

source_contract_test!(source_contract_runtime_context);
source_contract_test!(source_contract_frame_context);
source_contract_test!(source_contract_authority_entry);
source_contract_test!(source_contract_authoritative_material);
source_contract_test!(source_contract_authority_receipt);
source_contract_test!(source_contract_next_control);
source_contract_test!(source_contract_command_control_target);
source_contract_test!(source_contract_replacement_control_address);
source_contract_test!(source_contract_shared_interaction_control);
source_contract_test!(source_contract_await_successor_control);
source_contract_test!(source_contract_terminal_control);
source_contract_test!(source_contract_frame_v2);
source_contract_test!(source_contract_recovery_request);
source_contract_test!(source_contract_recovery_bundle);
source_contract_test!(source_contract_recovery_applied_proof);
source_contract_test!(source_contract_turn_resolution_image);
source_contract_test!(source_contract_replacement_proposal);
source_contract_test!(source_contract_wave_terminal_material);
source_contract_test!(source_contract_control_open_material);
source_contract_test!(source_contract_interaction_envelope);
source_contract_test!(source_contract_interaction_material);
source_contract_test!(source_contract_interaction_projection_plan);
source_contract_test!(source_contract_proposal_admission_lease);
source_contract_test!(source_contract_recovery_fence);
source_contract_test!(source_contract_authority_ledger);
source_contract_test!(source_contract_control_install_result);
source_contract_test!(source_contract_inbound_frame_result);
source_contract_test!(source_contract_scheduler_timer_owner);
source_contract_test!(source_contract_session_identity);

node_contract_test!(node_contract_command_frontier);
node_contract_test!(node_contract_control_open);
node_contract_test!(node_contract_control);
node_contract_test!(node_contract_cutover_interaction);
node_contract_test!(node_contract_cutover_replacement);
node_contract_test!(node_contract_cutover_turn);
node_contract_test!(node_contract_cutover_wave);
node_contract_test!(node_contract_duo_delivery);
node_contract_test!(node_contract_faint_replacement_command_open);
node_contract_test!(node_contract_frames);
node_contract_test!(node_contract_interaction_control_ledger);
node_contract_test!(node_contract_interaction_projection);
node_contract_test!(node_contract_interactions_learn);
node_contract_test!(node_contract_interactions_mystery);
node_contract_test!(node_contract_interactions_reward);
node_contract_test!(node_contract_log);
node_contract_test!(node_contract_mutation_ledger);
node_contract_test!(node_contract_proposal_admission);
node_contract_test!(node_contract_proposal_lease);
node_contract_test!(node_contract_recovery_channel);
node_contract_test!(node_contract_recovery);
node_contract_test!(node_contract_replacement);
node_contract_test!(node_contract_runtime);
node_contract_test!(node_contract_scheduler_clock_seam);
node_contract_test!(node_contract_session_identity);
node_contract_test!(node_contract_shadow);
node_contract_test!(node_contract_simulator);
node_contract_test!(node_contract_turn);
node_contract_test!(node_contract_wave);
