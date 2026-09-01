//! Executable M2B-12 boundary audit.
//!
//! This test is intentionally source-facing. It is a hostile contract check, not a
//! substitute for the hosted behavioral, Wasm, or campaign gates. The test lexer
//! blanks comments and literals before matching so prose and fixture names cannot
//! satisfy or trip a production-boundary assertion.

use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde_json::Value;

const PAIR_SOURCE: &str = include_str!("../src/pair.rs");
const KEYBOARD_DRIVER_SOURCE: &str = include_str!("../../er-testkit/src/keyboard_driver.rs");
const SOURCE_LOCK: &str = include_str!("../../../source-lock.toml");
const M2_API: &str = include_str!("../../../contracts/m2-api.md");
const M2_OWNERSHIP: &str = include_str!("../../../contracts/m2-ownership.toml");
const TEST_MAP_SOURCE: &str = include_str!("../../../fixtures/v1/authority-v2-test-map.json");

const ORACLE_GAME_SHA: &str = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";
const M3_BASE_SHA: &str = "7357166c19bdb5cf0e32c84b0f74f22e79d80798";
const AUDITED_PRODUCTION_HEAD: &str = "1e81d198e99d18568151d197114c1e8cbad901d0";
const AUDITED_PRODUCTION_BLOBS: &str =
    include_str!("../../../fixtures/m3/m3-audited-production-blobs.json");

const SEMANTIC_BYPASS_NAMES: &[&str] = &[
    "select_command",
    "choose_replacement",
    "choose_option",
    "set_cursor",
    "submit_interaction",
    "open_menu",
    "close_menu",
];

const FORBIDDEN_CAMPAIGN_PAIR_OPERATION_VARIANTS: &[&str] = &[
    "UiIntent",
    "SelectCommand",
    "ChooseReplacement",
    "ChooseOption",
    "SetCursor",
    "SubmitInteraction",
    "OpenMenu",
    "CloseMenu",
];

const FORBIDDEN_PRODUCTION_IDENTIFIERS: &[&str] = &[
    "async",
    "tokio",
    "async_std",
    "futures",
    "thread",
    "spawn",
    "sleep",
    "park",
    "wait_timeout",
    "recv_timeout",
    "yield_now",
    "TcpStream",
    "TcpListener",
    "UdpSocket",
    "UnixStream",
    "SocketAddr",
    "reqwest",
    "hyper",
    "ureq",
    "curl",
    "WebSocket",
    "websocket",
    "fetch",
    "XMLHttpRequest",
    "File",
    "OpenOptions",
    "read_to_string",
    "write_all",
    "Path",
    "PathBuf",
    "Phaser",
    "Vite",
    "unsafe",
    "thread_local",
    "lazy_static",
    "OnceLock",
    "LazyLock",
    "callback",
    "Callback",
    "Fn",
    "FnMut",
    "FnOnce",
];

const FORBIDDEN_PRODUCTION_QUALIFIERS: &[&str] = &[
    "std::thread",
    "std::time::Instant",
    "std::time::SystemTime",
    "std::net",
    "std::fs",
    "std::os",
    "std::process",
    "async_std",
    "tokio",
    "wasm_bindgen",
    "js_sys",
    "web_sys",
];

const FORBIDDEN_BENCHMARK_IDENTIFIERS: &[&str] = &[
    "async",
    "tokio",
    "async_std",
    "futures",
    "thread",
    "spawn",
    "sleep",
    "park",
    "wait_timeout",
    "recv_timeout",
    "yield_now",
    "TcpStream",
    "TcpListener",
    "UdpSocket",
    "UnixStream",
    "SocketAddr",
    "reqwest",
    "hyper",
    "ureq",
    "curl",
    "WebSocket",
    "websocket",
    "fetch",
    "XMLHttpRequest",
    "Phaser",
    "Vite",
    "unsafe",
    "thread_local",
    "lazy_static",
    "OnceLock",
    "LazyLock",
    "callback",
    "Callback",
    "Fn",
    "FnMut",
    "FnOnce",
];

const CAMPAIGN_FILES: &[&str] = &[
    "m2_command_campaign.rs",
    "m2_replacement_campaign.rs",
    "m2_interaction_campaign.rs",
    "m2_recovery_campaign.rs",
    "m2_suspend_reconnect.rs",
];

type AuditResult = Result<(), String>;

#[test]
fn simulated_pair_and_keyboard_surfaces_are_raw_only() -> AuditResult {
    let pair_impl = impl_body(&mask_non_code(PAIR_SOURCE), "SimulatedPair")?;
    let pair_methods = public_methods(&pair_impl);
    let pair_names: Vec<&str> = pair_methods
        .iter()
        .map(|method| method.name.as_str())
        .collect();
    require(
        pair_names
            == [
                "new",
                "new_battle",
                "snapshot_v2",
                "from_snapshot",
                "from_snapshot_v2",
                "apply_trace_operation_v2",
                "apply",
                "apply_many_atomic",
                "try_fork",
                "try_fork_apply_many_atomic",
                "key_down",
                "key_up",
                "press",
                "hold_for",
                "blur",
                "focus",
                "advance_time",
                "snapshot",
                "teardown",
            ],
        format!("SimulatedPair public API changed: {pair_names:?}"),
    )?;

    for method in &pair_methods {
        reject_semantic_surface(
            &format!("SimulatedPair::{}", method.name),
            &method.signature,
        )?;
        for forbidden in [
            "GameKernel",
            "UiReducer",
            "KernelScheduler",
            "AuthorityLog",
            "AuthorityReplica",
            "ProposalLeaseManager",
            "RecoveryTransaction",
            "UiIntent",
            "&mutGameKernel",
            "&mutUiReducer",
        ] {
            require(
                !compact(&method.signature).contains(forbidden),
                format!(
                    "SimulatedPair::{} exposes forbidden {forbidden}",
                    method.name
                ),
            )?;
        }
    }

    require_signature_type(&pair_methods, "new", "SimulatedPairConfig")?;
    require_signature_type(&pair_methods, "apply", "PairOperation")?;
    for name in ["key_down", "key_up", "press", "hold_for"] {
        require_signature_type(&pair_methods, name, "PhysicalKey")?;
    }
    for name in ["hold_for", "advance_time"] {
        require_signature_type(&pair_methods, name, "SafeU53")?;
    }
    require_signature_type(&pair_methods, "snapshot", "PairSnapshot")?;
    require_signature_type(&pair_methods, "teardown", "PairSnapshot")?;

    let detached_impl = impl_body(
        &mask_non_code(KEYBOARD_DRIVER_SOURCE),
        "DetachedKeyboardDriver",
    )?;
    let detached_methods = public_methods(&detached_impl);
    let detached_names: Vec<&str> = detached_methods
        .iter()
        .map(|method| method.name.as_str())
        .collect();
    require(
        detached_names
            == [
                "new",
                "seat",
                "input_focus",
                "key_down",
                "key_up",
                "press",
                "hold_for",
                "blur",
                "focus",
                "export_state",
                "restorable_state",
                "from_state",
                "from_restorable_state",
                "restore_state",
                "pressed_keys",
                "active_holds",
                "set_active_hold",
                "clear_active_hold",
                "advance_active_holds",
            ],
        format!("DetachedKeyboardDriver public API changed: {detached_names:?}"),
    )?;

    let driver_impl = impl_body(&mask_non_code(KEYBOARD_DRIVER_SOURCE), "KeyboardDriver")?;
    let driver_methods = public_methods(&driver_impl);
    let driver_names: Vec<&str> = driver_methods
        .iter()
        .map(|method| method.name.as_str())
        .collect();
    require(
        driver_names
            == [
                "new",
                "key_down",
                "key_up",
                "press",
                "hold_for",
                "blur",
                "focus",
                "ui_view",
                "live_resources",
            ],
        format!("KeyboardDriver public API changed: {driver_names:?}"),
    )?;

    for method in detached_methods.iter().chain(driver_methods.iter()) {
        reject_semantic_surface(
            &format!("keyboard driver::{}", method.name),
            &method.signature,
        )?;
        for forbidden in [
            "UiIntent",
            "UiReducer",
            "KernelScheduler",
            "AuthorityLog",
            "AuthorityReplica",
            "ProposalLeaseManager",
            "RecoveryTransaction",
        ] {
            require(
                !compact(&method.signature).contains(forbidden),
                format!(
                    "keyboard driver::{} exposes forbidden {forbidden}",
                    method.name
                ),
            )?;
        }
    }

    let constructor = method_by_name(&driver_methods, "new")?;
    let constructor_signature = compact(&constructor.signature);
    require(
        constructor_signature.contains("&mutGameKernel")
            || (constructor_signature.contains("&'")
                && constructor_signature.contains("mutGameKernel")),
        "KeyboardDriver::new must be the explicit low-level mutable-borrow adapter boundary"
            .to_owned(),
    )?;
    require(
        compact(&constructor.signature)
            .matches("GameKernel")
            .count()
            == 1,
        "KeyboardDriver::new may expose only its one construction-time GameKernel borrow"
            .to_owned(),
    )?;
    require(
        !driver_methods.iter().any(|method| method.name == "kernel"),
        "KeyboardDriver::kernel is forbidden as an API bypass".to_owned(),
    )?;
    for method in &driver_methods {
        if method.name == "new" {
            continue;
        }
        require(
            !compact(&method.signature).contains("GameKernel")
                && !compact(&method.signature).contains("&mutGameKernel")
                && !compact(&method.signature).contains("&GameKernel"),
            format!(
                "KeyboardDriver::{} exposes a GameKernel handle",
                method.name
            ),
        )?;
    }

    for name in ["key_down", "key_up", "press", "hold_for"] {
        require_signature_type(&driver_methods, name, "PhysicalKey")?;
    }
    require_signature_type(&driver_methods, "hold_for", "SafeU53")?;
    require_signature_type(&driver_methods, "ui_view", "UiViewModel")?;
    require_signature_type(&driver_methods, "live_resources", "LiveResourceSnapshot")?;
    for name in ["ui_view", "live_resources"] {
        let method = method_by_name(&driver_methods, name)?;
        require(
            !compact(&method.signature).contains("->&")
                && !compact(&method.signature).contains("&mut"),
            format!("KeyboardDriver::{name} must return a copied value"),
        )?;
    }

    Ok(())
}

#[test]
fn pair_operation_is_the_raw_environment_union() -> AuditResult {
    let body = enum_body(&mask_non_code(PAIR_SOURCE), "PairOperation")?;
    let variants = enum_variants(&body);
    require(
        variants
            == [
                "RawInput",
                "AdvanceTime",
                "Fault",
                "Disconnect",
                "Reconnect",
                "PresentationSettled",
                "BattlePresentationOutcome",
                "StorageResult",
                "Suspend",
                "Resume",
            ],
        format!("PairOperation variants changed: {variants:?}"),
    )?;
    for forbidden in SEMANTIC_BYPASS_NAMES.iter().copied().chain([
        "UiIntent",
        "Choice",
        "Command",
        "Replacement",
        "Menu",
    ]) {
        require(
            !identifiers(&body)
                .iter()
                .any(|(identifier, _)| identifier == forbidden),
            format!("PairOperation accepts forbidden semantic input {forbidden}"),
        )?;
    }

    let snapshot = struct_body(&mask_non_code(PAIR_SOURCE), "PairSnapshot")?;
    require(
        identifiers(&snapshot)
            .iter()
            .any(|(identifier, _)| identifier == "seed")
            && compact(&snapshot).contains("seed:String"),
        "PairSnapshot.seed must be a string at the Rust boundary".to_owned(),
    )?;
    let normalized_api = M2_API.split_whitespace().collect::<Vec<_>>().join(" ");
    for phrase in [
        "PairSnapshot",
        "canonical unsigned decimal string",
        "never emitted as a JSON number",
        "empty, signed, padded",
    ] {
        require(
            normalized_api.contains(phrase),
            format!("M2 API contract lost frozen seed requirement phrase {phrase:?}"),
        )?;
    }
    Ok(())
}

#[test]
fn lexical_boundary_audit_ignores_comments_and_literals() -> AuditResult {
    let source = "// async Instant SystemTime\nlet text = \"File thread callback\"; /* sleep */\n";
    let masked = mask_non_code(source);
    let token_set: BTreeSet<String> = identifiers(&masked)
        .into_iter()
        .map(|(identifier, _)| identifier)
        .collect();
    for ignored in [
        "async",
        "Instant",
        "SystemTime",
        "File",
        "thread",
        "callback",
        "sleep",
    ] {
        require(
            !token_set.contains(ignored),
            format!("lexer leaked non-code token {ignored}"),
        )?;
    }
    require(
        token_set.contains("let") && token_set.contains("text"),
        "lexer removed executable identifiers while masking non-code text".to_owned(),
    )
}

fn approved_m3_benchmark_worker_source() -> &'static str {
    r#"
const PAIR_FRONTIER_CHECKSUM_DOMAIN: &str = "pokerogue-redux/m3/benchmark-pair-frontier/v2";
const PAIR_FRONTIER_CHECKSUM_VERSION: u32 = 2;
const TWO_CLIENT_SUPPORTED_TURNS: u64 = 1_000;
const TWO_CLIENT_SUPPORTED_TURN_RANGES: [(u64, u64); 2] = [(0, 500), (500, 1_000)];

fn benchmark() {
    let worker = std::thread::spawn(|| {});
    let worker_0_start = 0;
    let worker_0_end = 500;
    let worker_1_start = 500;
    let worker_1_end = 1_000;
    let pair_template_0 = ();
    let pair_template_1 = ();
    let worker_0 = spawn_worker(0, worker_0_start, worker_0_end, pair_template_0);
    let worker_1 = spawn_worker(1, worker_1_start, worker_1_end, pair_template_1);
    let worker_0_join = worker_0.join();
    let worker_1_join = worker_1.join();
    let total_iterations = TWO_CLIENT_SUPPORTED_TURNS;
    assert_eq!(total_iterations, TWO_CLIENT_SUPPORTED_TURNS);
    reduce(Reduction {
        domain: PAIR_FRONTIER_CHECKSUM_DOMAIN,
        version: PAIR_FRONTIER_CHECKSUM_VERSION,
    });
}
"#
}

fn audit_approved_m3_benchmark_worker(source: &str, path: &Path) -> AuditResult {
    let masked = mask_non_code(source);
    let code = strip_test_modules(&masked, path)?;
    assert_no_forbidden_benchmark_tokens(source, &code, path)
}

#[test]
fn approved_m3_benchmark_worker_guard_accepts_exact_source() -> AuditResult {
    let path = Path::new("rust/crates/er-sim/benches/m3_benchmark.rs");
    audit_approved_m3_benchmark_worker(approved_m3_benchmark_worker_source(), path)
}

#[test]
fn approved_m3_benchmark_worker_guard_rejects_second_thread_spawn() -> AuditResult {
    let source = format!(
        "{}\nlet extra = std::thread::spawn(|| {{}});",
        approved_m3_benchmark_worker_source()
    );
    let path = Path::new("rust/crates/er-sim/benches/m3_benchmark.rs");
    match audit_approved_m3_benchmark_worker(&source, path) {
        Err(error) => require(
            error.contains("must contain exactly one approved M3 benchmark worker qualifier"),
            format!("second thread spawn produced unexpected error: {error}"),
        ),
        Ok(()) => Err("second thread spawn was accepted by the approved worker guard".to_owned()),
    }
}

#[test]
fn approved_m3_benchmark_worker_guard_rejects_changed_ranges() -> AuditResult {
    let source = approved_m3_benchmark_worker_source()
        .replace("[(0, 500), (500, 1_000)]", "[(0, 499), (499, 1_000)]");
    let path = Path::new("rust/crates/er-sim/benches/m3_benchmark.rs");
    match audit_approved_m3_benchmark_worker(&source, path) {
        Err(error) => require(
            error.contains("is missing approved M3 benchmark worker marker")
                && error.contains(
                    "constTWO_CLIENT_SUPPORTED_TURN_RANGES:[(u64,u64);2]=[(0,500),(500,1_000)];",
                ),
            format!("changed ranges produced unexpected error: {error}"),
        ),
        Ok(()) => Err("changed fixed ranges were accepted by the approved worker guard".to_owned()),
    }
}

#[test]
fn approved_m3_benchmark_worker_guard_rejects_spoofed_checksum_domain() -> AuditResult {
    let expected_domain = "const PAIR_FRONTIER_CHECKSUM_DOMAIN: &str = \"pokerogue-redux/m3/benchmark-pair-frontier/v2\";";
    let source = approved_m3_benchmark_worker_source()
        .replace(
            expected_domain,
            "const PAIR_FRONTIER_CHECKSUM_DOMAIN: &str = \"pokerogue-redux/m3/benchmark-pair-frontier/v1\";",
        )
        + &format!("\n// {expected_domain}");
    let path = Path::new("rust/crates/er-sim/benches/m3_benchmark.rs");
    match audit_approved_m3_benchmark_worker(&source, path) {
        Err(error) => require(
            error.contains(
                "must contain exactly one executable approved M3 benchmark checksum domain declaration",
            ),
            format!("spoofed checksum domain produced unexpected error: {error}"),
        ),
        Ok(()) => Err(
            "a wrong executable checksum domain with a commented expected declaration was accepted"
                .to_owned(),
        ),
    }
}

#[test]
fn approved_m3_benchmark_worker_guard_rejects_renamed_worker_one_join() -> AuditResult {
    let source = approved_m3_benchmark_worker_source().replace(
        "let worker_1_join = worker_1.join();",
        "let worker_1_join = worker_1.finish();",
    );
    let path = Path::new("rust/crates/er-sim/benches/m3_benchmark.rs");
    match audit_approved_m3_benchmark_worker(&source, path) {
        Err(error) => require(
            error.contains("is missing approved M3 benchmark worker marker")
                && error.contains("letworker_1_join=worker_1.join();"),
            format!("renamed worker_1 join produced unexpected error: {error}"),
        ),
        Ok(()) => Err("renamed worker_1 join was accepted by the approved worker guard".to_owned()),
    }
}

#[test]
fn generic_benchmark_guard_rejects_approved_worker_outside_m3_benchmark() -> AuditResult {
    let path = Path::new("rust/crates/er-sim/benches/other.rs");
    match audit_approved_m3_benchmark_worker(approved_m3_benchmark_worker_source(), path) {
        Err(error) => require(
            error.contains("contains forbidden benchmark escape hatch thread"),
            format!("generic benchmark guard produced unexpected error: {error}"),
        ),
        Ok(()) => Err("approved worker was accepted outside m3_benchmark.rs".to_owned()),
    }
}

#[test]
fn production_core_has_no_escape_hatches_or_test_transition_branches() -> AuditResult {
    let root = repository_root();
    let mut source_files = Vec::new();
    for crate_name in ["er-kernel", "er-protocol", "er-sim"] {
        let source_root = root
            .join("rust")
            .join("crates")
            .join(crate_name)
            .join("src");
        collect_rust_sources(&source_root, &mut source_files)?;
    }
    source_files.sort();
    require(
        source_files.len() >= 18,
        format!(
            "production source inventory unexpectedly small: {} files",
            source_files.len()
        ),
    )?;

    for path in source_files {
        let source = fs::read_to_string(&path)
            .map_err(|error| format!("read production source {}: {error}", path.display()))?;
        let masked = mask_non_code(&source);
        assert_cfg_policy(&masked, &path)?;
        let production_code = strip_test_modules(&masked, &path)?;
        assert_no_forbidden_production_tokens(&production_code, &path)?;
    }

    let benchmark_root = root
        .join("rust")
        .join("crates")
        .join("er-sim")
        .join("benches");
    if benchmark_root.is_dir() {
        let mut benchmark_files = Vec::new();
        collect_rust_sources(&benchmark_root, &mut benchmark_files)?;
        for path in benchmark_files {
            let source = fs::read_to_string(&path)
                .map_err(|error| format!("read benchmark source {}: {error}", path.display()))?;
            let masked = mask_non_code(&source);
            assert_cfg_policy(&masked, &path)?;
            let benchmark_code = strip_test_modules(&masked, &path)?;
            assert_no_forbidden_benchmark_tokens(&source, &benchmark_code, &path)?;
        }
    }
    Ok(())
}

#[test]
fn source_lock_ownership_and_contract_map_are_frozen() -> AuditResult {
    let lock = parse_flat_assignments(SOURCE_LOCK)?;
    let expected_lock = BTreeMap::from([
        ("oracle_game_sha".to_owned(), ORACLE_GAME_SHA.to_owned()),
        (
            "oracle_branch".to_owned(),
            "ci/coop/v2-showdown-command-coordinate-20260720".to_owned(),
        ),
        ("protocol_version".to_owned(), "er-coop-47".to_owned()),
        ("schema_version".to_owned(), "1".to_owned()),
        ("input_repeat_delay_ms".to_owned(), "250".to_owned()),
        ("input_repeat_interval_ms".to_owned(), "250".to_owned()),
    ]);
    require(
        lock == expected_lock,
        format!("source-lock drifted: {lock:?}"),
    )?;

    require(
        M2_OWNERSHIP.contains("schema_version = 6")
            && M2_OWNERSHIP.contains("M2B-12")
            && M2_OWNERSHIP.contains("production_typescript_read_only = true")
            && M2_OWNERSHIP.contains("local_rust_execution = false")
            && M2_OWNERSHIP.contains("local_coop_vitest = false"),
        "M2 ownership manifest no longer records schema revision 6 and the local execution boundary"
            .to_owned(),
    )?;
    for owned_path in [
        "rust/crates/er-sim/tests/m2_api_bypass.rs",
        "docs/plans/rust-kernel/m2-adversarial-audit.md",
    ] {
        require(
            M2_OWNERSHIP.contains(owned_path),
            format!("ownership manifest does not list {owned_path}"),
        )?;
    }
    let normalized_api = M2_API.split_whitespace().collect::<Vec<_>>().join(" ");
    for phrase in [
        "M2 ownership-manifest version: \u{60}6\u{60}",
        "er-coop-47",
        "schema version: \u{60}1\u{60}",
    ] {
        require(
            normalized_api.contains(phrase),
            format!("M2 API contract lost frozen metadata phrase {phrase:?}"),
        )?;
    }
    require(
        SOURCE_LOCK.contains("input_repeat_delay_ms = 250")
            && SOURCE_LOCK.contains("input_repeat_interval_ms = 250"),
        "source-lock lost the calibrated 250/250 repeat settings".to_owned(),
    )?;

    let map: Value = serde_json::from_str(TEST_MAP_SOURCE)
        .map_err(|error| format!("authority-v2 test map is not JSON: {error}"))?;
    audit_contract_array(&map, "source_lock_contracts", 29, true)?;
    audit_contract_array(&map, "node_contracts", 29, false)?;
    let nodes = required_array(&map, "node_contracts")?;
    let simulator_nodes: Vec<&Value> = nodes
        .iter()
        .filter(|node| {
            node.get("implementation_kind").and_then(Value::as_str) == Some("reference-simulator")
        })
        .collect();
    require(
        simulator_nodes.len() == 1,
        format!(
            "expected one visibly distinct reference simulator, found {}",
            simulator_nodes.len()
        ),
    )?;
    let simulator = simulator_nodes[0];
    require(
        simulator.get("id").and_then(Value::as_str) == Some("simulator")
            && simulator
                .get("typescript_source")
                .and_then(Value::as_str)
                .is_some_and(|source| source.ends_with("authority-v2-simulator.test.ts")),
        "reference simulator is not visibly distinct in the node contract map".to_owned(),
    )?;
    require(
        nodes
            .iter()
            .filter(|node| {
                node.get("implementation_kind").and_then(Value::as_str) == Some("production")
            })
            .count()
            == 28,
        "node contract map must contain 28 production contracts plus one reference simulator"
            .to_owned(),
    )?;
    Ok(())
}

#[test]
fn later_m2b_campaigns_cannot_call_semantic_or_lower_level_transitions() -> AuditResult {
    require(
        CAMPAIGN_FILES.len() == 5,
        format!("campaign inventory changed: {} files", CAMPAIGN_FILES.len()),
    )?;
    let normalized_api = M2_API.split_whitespace().collect::<Vec<_>>().join(" ");
    require(
        normalized_api
            .contains("The ten required campaigns use only the raw-input/environment surface"),
        "M2 API contract lost the five-file/ten-scenario raw-only campaign requirement".to_owned(),
    )?;
    let campaign_root = repository_root()
        .join("rust")
        .join("crates")
        .join("er-sim")
        .join("tests");
    for file_name in CAMPAIGN_FILES {
        let path = campaign_root.join(file_name);
        require(
            path.is_file(),
            format!(
                "final M2 integration is missing required campaign source {}",
                path.display()
            ),
        )?;
        let source = fs::read_to_string(&path)
            .map_err(|error| format!("read campaign source {}: {error}", path.display()))?;
        let masked = mask_non_code(&source);
        for forbidden in SEMANTIC_BYPASS_NAMES.iter().copied().chain([
            "GameKernel",
            "KernelInput",
            "AuthorityLog",
            "AuthorityReplica",
            "ProposalLeaseManager",
            "RecoveryTransaction",
            "KernelScheduler",
            "UiReducer",
        ]) {
            require(
                !identifiers(&masked)
                    .iter()
                    .any(|(identifier, _)| identifier == forbidden),
                format!(
                    "{} contains forbidden semantic/lower-level identifier {forbidden}",
                    path.display()
                ),
            )?;
        }
        assert_no_campaign_pair_operation_semantics(&masked, &path)?;
        for forbidden in [
            "GameKernel::step",
            "KernelInput::",
            ".step(",
            ".reduce(",
            ".reduce_at(",
            ".replace_menu(",
        ] {
            require(
                !compact(&masked).contains(forbidden),
                format!(
                    "{} directly calls forbidden transition surface {forbidden}",
                    path.display()
                ),
            )?;
        }
    }
    Ok(())
}

fn assert_no_campaign_pair_operation_semantics(code: &str, path: &Path) -> AuditResult {
    for (identifier, position) in identifiers(code) {
        if identifier != "PairOperation" {
            continue;
        }
        let mut next = position + identifier.len();
        while code
            .as_bytes()
            .get(next)
            .is_some_and(|byte| byte.is_ascii_whitespace())
        {
            next += 1;
        }
        if code[next..].starts_with("::") {
            let mut variant_start = next + 2;
            while code
                .as_bytes()
                .get(variant_start)
                .is_some_and(|byte| byte.is_ascii_whitespace())
            {
                variant_start += 1;
            }
            let variant_end = code[variant_start..]
                .find(|character: char| !character.is_ascii_alphanumeric() && character != '_')
                .map_or(code.len(), |offset| variant_start + offset);
            let variant = &code[variant_start..variant_end];
            require(
                !FORBIDDEN_CAMPAIGN_PAIR_OPERATION_VARIANTS.contains(&variant),
                format!(
                    "{} constructs forbidden semantic PairOperation::{variant}",
                    path.display()
                ),
            )?;
        } else if code.as_bytes().get(next) == Some(&b'{') {
            let close = matching_delimiter(code, next, b'{', b'}')?;
            let body = &code[next + 1..close];
            for forbidden in FORBIDDEN_CAMPAIGN_PAIR_OPERATION_VARIANTS {
                require(
                    !identifiers(body).iter().any(|(name, _)| name == forbidden),
                    format!(
                        "{} constructs PairOperation with forbidden semantic field {forbidden}",
                        path.display()
                    ),
                )?;
            }
        }
    }
    Ok(())
}

#[test]
fn m3_audited_production_surface_matches_frozen_manifest() -> AuditResult {
    let root = repository_root();
    for commit in [ORACLE_GAME_SHA, M3_BASE_SHA, AUDITED_PRODUCTION_HEAD] {
        let object = Command::new("git")
            .current_dir(&root)
            .args(["cat-file", "-e"])
            .arg(format!("{commit}^{{commit}}"))
            .output()
            .map_err(|error| format!("probe M3 production audit commit {commit}: {error}"))?;
        require(
            object.status.success(),
            format!("M3 production audit commit {commit} is unavailable"),
        )?;
    }

    let head = Command::new("git")
        .current_dir(&root)
        .args(["rev-parse", "HEAD"])
        .output()
        .map_err(|error| format!("resolve M3 production audit checkpoint: {error}"))?;
    require(
        head.status.success(),
        format!(
            "resolve M3 production audit checkpoint failed with {}",
            head.status
        ),
    )?;
    let checkpoint = String::from_utf8(head.stdout)
        .map_err(|error| format!("M3 production audit checkpoint was not UTF-8: {error}"))?;
    let checkpoint = checkpoint.trim();
    require(
        checkpoint != AUDITED_PRODUCTION_HEAD,
        "M3 production audit checkpoint must not equal the audited production head".to_owned(),
    )?;

    for (ancestor, descendant, label) in [
        (ORACLE_GAME_SHA, M3_BASE_SHA, "oracle-to-M2-base"),
        (
            AUDITED_PRODUCTION_HEAD,
            checkpoint,
            "audited-production-head-to-checkpoint",
        ),
        (M3_BASE_SHA, checkpoint, "M2-base-to-checkpoint"),
    ] {
        let relation = Command::new("git")
            .current_dir(&root)
            .args(["merge-base", "--is-ancestor", ancestor, descendant])
            .output()
            .map_err(|error| format!("check M3 production audit ancestry {label}: {error}"))?;
        require(
            relation.status.success(),
            format!("M3 production audit ancestry failed for {label}"),
        )?;
    }

    let locked_runtime = [
        ".nvmrc",
        ".gitmodules",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "src",
    ];
    let locked_diff = Command::new("git")
        .current_dir(&root)
        .args(["diff", "--exit-code", ORACLE_GAME_SHA, M3_BASE_SHA, "--"])
        .args(locked_runtime)
        .output()
        .map_err(|error| format!("run oracle-to-base immutable runtime audit: {error}"))?;
    require(
        locked_diff.status.success(),
        format!(
            "oracle-to-base immutable runtime surface changed: {}",
            String::from_utf8_lossy(&locked_diff.stdout)
        ),
    )?;

    let immutable_runtime = [
        ".nvmrc",
        ".gitmodules",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "rust/source-lock.toml",
    ];
    let immutable_diff = Command::new("git")
        .current_dir(&root)
        .args(["diff", "--exit-code", M3_BASE_SHA, checkpoint, "--"])
        .args(immutable_runtime)
        .output()
        .map_err(|error| format!("run M3 immutable runtime audit: {error}"))?;
    require(
        immutable_diff.status.success(),
        format!(
            "M3 immutable runtime surface changed after the frozen base: {}",
            String::from_utf8_lossy(&immutable_diff.stdout)
        ),
    )?;

    let manifest: Value = serde_json::from_str(AUDITED_PRODUCTION_BLOBS)
        .map_err(|error| format!("audited production blob manifest is not JSON: {error}"))?;
    let manifest_object = manifest
        .as_object()
        .ok_or_else(|| "audited production blob manifest is not an object".to_owned())?;
    let expected_manifest_keys = BTreeSet::from([
        "schema_version".to_owned(),
        "manifest_id".to_owned(),
        "m2_base_sha".to_owned(),
        "head_sha".to_owned(),
        "source_root".to_owned(),
        "path_count".to_owned(),
        "paths".to_owned(),
    ]);
    let manifest_keys = manifest_object.keys().cloned().collect::<BTreeSet<_>>();
    require(
        manifest_keys == expected_manifest_keys,
        format!("audited production blob manifest keys are not exact: {manifest_keys:?}"),
    )?;
    require(
        manifest.get("schema_version").and_then(Value::as_u64) == Some(1),
        "audited production blob manifest schema_version must be 1".to_owned(),
    )?;
    require(
        manifest.get("manifest_id").and_then(Value::as_str)
            == Some("m3-audited-production-blobs-v1"),
        "audited production blob manifest ID is not exact".to_owned(),
    )?;
    require(
        manifest.get("m2_base_sha").and_then(Value::as_str) == Some(M3_BASE_SHA),
        "audited production blob manifest M2 base SHA is not exact".to_owned(),
    )?;
    require(
        manifest.get("head_sha").and_then(Value::as_str) == Some(AUDITED_PRODUCTION_HEAD),
        "audited production blob manifest head SHA is not exact".to_owned(),
    )?;
    require(
        manifest.get("source_root").and_then(Value::as_str) == Some("src"),
        "audited production blob manifest source root is not exact".to_owned(),
    )?;
    require(
        manifest.get("path_count").and_then(Value::as_u64) == Some(41),
        "audited production blob manifest path count must be 41".to_owned(),
    )?;

    let entries = manifest
        .get("paths")
        .and_then(Value::as_array)
        .ok_or_else(|| "audited production blob manifest paths are not an array".to_owned())?;
    require(
        entries.len() == 41,
        format!(
            "audited production blob manifest path list count is {}, expected 41",
            entries.len()
        ),
    )?;
    let expected_entry_keys = BTreeSet::from(["path".to_owned(), "blob_oid".to_owned()]);
    let mut manifest_entries = Vec::with_capacity(entries.len());
    for entry in entries {
        let object = entry
            .as_object()
            .ok_or_else(|| format!("audited production blob entry is not an object: {entry}"))?;
        let keys = object.keys().cloned().collect::<BTreeSet<_>>();
        require(
            keys == expected_entry_keys,
            format!("audited production blob entry keys are not exact: {keys:?}"),
        )?;
        let path = object
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "audited production blob entry path is not a string".to_owned())?;
        require(
            is_safe_audited_production_path(path),
            format!("unsafe audited production source path: {path:?}"),
        )?;
        let blob_oid = object
            .get("blob_oid")
            .and_then(Value::as_str)
            .ok_or_else(|| "audited production blob object ID is not a string".to_owned())?;
        require(
            is_lower_hex_40(blob_oid),
            format!("invalid audited production blob object ID: {blob_oid:?}"),
        )?;
        manifest_entries.push((path.to_owned(), blob_oid.to_owned()));
    }
    let paths = manifest_entries
        .iter()
        .map(|(path, _)| path.clone())
        .collect::<Vec<_>>();
    let mut unique_paths = paths.clone();
    unique_paths.sort();
    unique_paths.dedup();
    require(
        unique_paths.len() == paths.len(),
        "audited production blob manifest contains duplicate paths".to_owned(),
    )?;
    require(
        paths.windows(2).all(|pair| pair[0] < pair[1]),
        "audited production blob manifest paths are not sorted".to_owned(),
    )?;

    let actual_diff = Command::new("git")
        .current_dir(&root)
        .args([
            "diff",
            "--name-only",
            "--no-renames",
            M3_BASE_SHA,
            checkpoint,
            "--",
            "src",
        ])
        .output()
        .map_err(|error| format!("run M3 production source path audit: {error}"))?;
    require(
        actual_diff.status.success(),
        format!(
            "M3 production source path audit failed with {}",
            actual_diff.status
        ),
    )?;
    let actual = String::from_utf8(actual_diff.stdout)
        .map_err(|error| format!("M3 production source path audit was not UTF-8: {error}"))?
        .lines()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let mut sorted_actual = actual.clone();
    sorted_actual.sort();
    sorted_actual.dedup();
    require(
        sorted_actual.len() == actual.len() && actual.windows(2).all(|pair| pair[0] < pair[1]),
        "actual production src diff is not a unique sorted path set".to_owned(),
    )?;
    require(
        actual == paths,
        format!(
            "actual M2-to-HEAD production src path set differs from the manifest: actual={actual:?} manifest={paths:?}"
        ),
    )?;

    for (path, expected_blob) in &manifest_entries {
        for (commit, label) in [
            (AUDITED_PRODUCTION_HEAD, "audited production head"),
            (checkpoint, "M3 checkpoint"),
        ] {
            let blob = Command::new("git")
                .current_dir(&root)
                .args(["rev-parse"])
                .arg(format!("{commit}:{path}"))
                .output()
                .map_err(|error| {
                    format!("resolve {label} audited production blob {path}: {error}")
                })?;
            require(
                blob.status.success(),
                format!("resolve {label} audited production blob {path} failed"),
            )?;
            let actual_blob = String::from_utf8(blob.stdout).map_err(|error| {
                format!("{label} audited production blob was not UTF-8: {error}")
            })?;
            require(
                actual_blob.trim() == expected_blob,
                format!(
                    "{label} blob for {path} differs from the frozen manifest: {}",
                    actual_blob.trim()
                ),
            )?;
            let kind = Command::new("git")
                .current_dir(&root)
                .args(["cat-file", "-t", expected_blob])
                .output()
                .map_err(|error| format!("probe {label} blob type for {path}: {error}"))?;
            require(
                kind.status.success() && String::from_utf8_lossy(&kind.stdout).trim() == "blob",
                format!("{label} object for {path} is not a blob"),
            )?;
        }
    }

    require(
        gitlink_entries(&root, ORACLE_GAME_SHA)? == gitlink_entries(&root, M3_BASE_SHA)?
            && gitlink_entries(&root, M3_BASE_SHA)? == gitlink_entries(&root, checkpoint)?,
        "production gitlinks changed across the frozen oracle/base/checkpoint chain".to_owned(),
    )?;
    Ok(())
}

fn is_lower_hex_40(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn is_safe_audited_production_path(path: &str) -> bool {
    let Some(relative) = path.strip_prefix("src/") else {
        return false;
    };
    !relative.is_empty()
        && relative.split('/').all(|component| {
            !component.is_empty()
                && component
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        })
}

fn gitlink_entries(root: &Path, commit: &str) -> Result<Vec<String>, String> {
    let output = Command::new("git")
        .current_dir(root)
        .args(["ls-tree", "-r", commit])
        .output()
        .map_err(|error| format!("list gitlinks for {commit}: {error}"))?;
    require(
        output.status.success(),
        format!("list gitlinks for {commit} failed with {}", output.status),
    )?;
    let tree = String::from_utf8(output.stdout)
        .map_err(|error| format!("gitlinks for {commit} were not UTF-8: {error}"))?;
    Ok(tree
        .lines()
        .filter(|line| line.starts_with("160000 "))
        .map(str::to_owned)
        .collect())
}

fn repository_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn require(condition: bool, message: String) -> AuditResult {
    if condition { Ok(()) } else { Err(message) }
}

fn identifiers(source: &str) -> Vec<(String, usize)> {
    let bytes = source.as_bytes();
    let mut result = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if is_identifier_start(bytes[index]) {
            let start = index;
            index += 1;
            while index < bytes.len() && is_identifier_continue(bytes[index]) {
                index += 1;
            }
            result.push((source[start..index].to_owned(), start));
        } else {
            index += 1;
        }
    }
    result
}

fn is_identifier_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

fn is_identifier_continue(byte: u8) -> bool {
    is_identifier_start(byte) || byte.is_ascii_digit()
}

fn compact(source: &str) -> String {
    source
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn mask_range(output: &mut [u8], source: &[u8], start: usize, end: usize) {
    for index in start..end.min(output.len()) {
        if source[index] != b'\n' && source[index] != b'\r' {
            output[index] = b' ';
        }
    }
}

fn mask_approved_m3_benchmark_worker(
    source: &str,
    code: &str,
    path: &Path,
) -> Result<String, String> {
    let suffix = Path::new("rust")
        .join("crates")
        .join("er-sim")
        .join("benches")
        .join("m3_benchmark.rs");
    if !path.ends_with(&suffix) {
        return Ok(code.to_owned());
    }

    let compact_code = compact(code);
    let qualifier = "std::thread::spawn";
    require(
        code.match_indices(qualifier).count() == 1,
        format!(
            "{} must contain exactly one approved M3 benchmark worker qualifier",
            path.display()
        ),
    )?;
    for marker in [
        "constTWO_CLIENT_SUPPORTED_TURNS:u64=1_000;",
        "constTWO_CLIENT_SUPPORTED_TURN_RANGES:[(u64,u64);2]=[(0,500),(500,1_000)];",
        "letworker_0=spawn_worker(0,worker_0_start,worker_0_end,pair_template_0);",
        "letworker_1=spawn_worker(1,worker_1_start,worker_1_end,pair_template_1);",
        "letworker_0_join=worker_0.join();",
        "letworker_1_join=worker_1.join();",
        "assert_eq!(total_iterations,TWO_CLIENT_SUPPORTED_TURNS);",
        "domain:PAIR_FRONTIER_CHECKSUM_DOMAIN,",
        "version:PAIR_FRONTIER_CHECKSUM_VERSION,",
    ] {
        require(
            compact_code.contains(marker),
            format!(
                "{} is missing approved M3 benchmark worker marker {marker}",
                path.display()
            ),
        )?;
    }
    let domain_marker = "const PAIR_FRONTIER_CHECKSUM_DOMAIN: &str = \"pokerogue-redux/m3/benchmark-pair-frontier/v2\";";
    let executable_domain_marker = "constPAIR_FRONTIER_CHECKSUM_DOMAIN:&str=;";
    let executable_domain_count = source
        .match_indices(domain_marker)
        .filter(|(start, _)| {
            let Some(end) = (*start).checked_add(domain_marker.len()) else {
                return false;
            };
            code.get(*start..end)
                .is_some_and(|slice| compact(slice) == executable_domain_marker)
        })
        .count();
    require(
        executable_domain_count == 1,
        format!(
            "{} must contain exactly one executable approved M3 benchmark checksum domain declaration",
            path.display()
        ),
    )?;
    let version_marker = "constPAIR_FRONTIER_CHECKSUM_VERSION:u32=2;";
    require(
        compact_code.matches(version_marker).count() == 1,
        format!(
            "{} must contain exactly one executable approved M3 benchmark checksum version declaration",
            path.display()
        ),
    )?;
    require(
        compact_code.matches("spawn_worker(").count() == 2,
        format!(
            "{} must contain exactly two approved M3 benchmark worker launches",
            path.display()
        ),
    )?;
    for marker in [
        "letworker_0=spawn_worker(0,worker_0_start,worker_0_end,pair_template_0);",
        "letworker_1=spawn_worker(1,worker_1_start,worker_1_end,pair_template_1);",
        "letworker_0_join=worker_0.join();",
        "letworker_1_join=worker_1.join();",
    ] {
        require(
            compact_code.matches(marker).count() == 1,
            format!(
                "{} must contain exactly one approved M3 benchmark worker marker {marker}",
                path.display()
            ),
        )?;
    }

    let start: usize = code.find(qualifier).ok_or_else(|| {
        format!(
            "{} approved M3 benchmark worker qualifier disappeared before masking",
            path.display()
        )
    })?;
    let mut output = code.as_bytes().to_vec();
    mask_range(&mut output, code.as_bytes(), start, start + qualifier.len());
    String::from_utf8(output).map_err(|error| {
        format!(
            "{} masked approved M3 benchmark worker produced invalid UTF-8: {error}",
            path.display()
        )
    })
}

fn mask_non_code(source: &str) -> String {
    let bytes = source.as_bytes();
    let mut output = bytes.to_vec();
    let mut index = 0;
    while index < bytes.len() {
        if index + 1 < bytes.len() && bytes[index] == b'/' && bytes[index + 1] == b'/' {
            let start = index;
            index += 2;
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
            mask_range(&mut output, bytes, start, index);
            continue;
        }
        if index + 1 < bytes.len() && bytes[index] == b'/' && bytes[index + 1] == b'*' {
            let start = index;
            index += 2;
            let mut depth = 1;
            while index < bytes.len() && depth > 0 {
                if index + 1 < bytes.len() && bytes[index] == b'/' && bytes[index + 1] == b'*' {
                    depth += 1;
                    index += 2;
                } else if index + 1 < bytes.len()
                    && bytes[index] == b'*'
                    && bytes[index + 1] == b'/'
                {
                    depth -= 1;
                    index += 2;
                } else {
                    index += 1;
                }
            }
            mask_range(&mut output, bytes, start, index);
            continue;
        }
        if let Some(end) = raw_string_end(bytes, index) {
            mask_range(&mut output, bytes, index, end);
            index = end;
            continue;
        }
        if bytes[index] == b'"'
            || (bytes[index] == b'b' && index + 1 < bytes.len() && bytes[index + 1] == b'"')
        {
            let start = index;
            if bytes[index] == b'b' {
                index += 1;
            }
            index += 1;
            while index < bytes.len() {
                if bytes[index] == b'\\' {
                    index = (index + 2).min(bytes.len());
                } else if bytes[index] == b'"' {
                    index += 1;
                    break;
                } else {
                    index += 1;
                }
            }
            mask_range(&mut output, bytes, start, index);
            continue;
        }
        if bytes[index] == b'\''
            && let Some(end) = char_literal_end(bytes, index)
        {
            mask_range(&mut output, bytes, index, end);
            index = end;
            continue;
        }
        index += 1;
    }
    match String::from_utf8(output) {
        Ok(masked) => masked,
        Err(_) => source.to_owned(),
    }
}

fn raw_string_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut prefix = start;
    if bytes.get(prefix) == Some(&b'b') {
        prefix += 1;
    }
    if bytes.get(prefix) != Some(&b'r') {
        return None;
    }
    prefix += 1;
    let mut hashes = 0;
    while bytes.get(prefix + hashes) == Some(&b'#') {
        hashes += 1;
    }
    let quote = prefix + hashes;
    if bytes.get(quote) != Some(&b'"') {
        return None;
    }
    let mut index = quote + 1;
    while index < bytes.len() {
        let closing_hash_start = index + 1;
        let closing_hash_end = closing_hash_start + hashes;
        if bytes[index] == b'"'
            && closing_hash_end <= bytes.len()
            && bytes[closing_hash_start..closing_hash_end]
                .iter()
                .all(|byte| *byte == b'#')
        {
            return Some(closing_hash_end);
        }
        index += 1;
    }
    Some(bytes.len())
}

fn char_literal_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut index = start + 1;
    let mut content_length = 0;
    while index < bytes.len() && bytes[index] != b'\n' && bytes[index] != b'\r' {
        if bytes[index] == b'\\' {
            content_length += 2;
            index = (index + 2).min(bytes.len());
        } else if bytes[index] == b'\'' {
            return (content_length <= 4).then_some(index + 1);
        } else {
            content_length += 1;
            index += 1;
        }
    }
    None
}

fn impl_body(source: &str, type_name: &str) -> Result<String, String> {
    for (impl_start, _) in source.match_indices("impl") {
        let after_impl = &source[impl_start + "impl".len()..];
        let Some(type_offset) = after_impl.find(type_name) else {
            continue;
        };
        let before_type = &after_impl[..type_offset];
        if before_type
            .split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
            .any(|word| word == "for")
        {
            continue;
        }
        let type_start = impl_start + "impl".len() + type_offset;
        if type_start > 0 && is_identifier_continue(source.as_bytes()[type_start - 1]) {
            continue;
        }
        let type_end = type_start + type_name.len();
        if source
            .as_bytes()
            .get(type_end)
            .is_some_and(|byte| is_identifier_continue(*byte))
        {
            continue;
        }
        let Some(open_offset) = source[type_end..].find('{') else {
            continue;
        };
        let open = type_end + open_offset;
        let close = matching_delimiter(source, open, b'{', b'}')?;
        return Ok(source[open + 1..close].to_owned());
    }
    Err(format!("could not find impl {type_name}"))
}

fn struct_body(source: &str, type_name: &str) -> Result<String, String> {
    let marker = format!("struct {type_name}");
    let start = source
        .find(&marker)
        .ok_or_else(|| format!("could not find {marker}"))?;
    let open = start
        + marker.len()
        + source[start + marker.len()..]
            .find('{')
            .ok_or_else(|| format!("could not find {type_name} body"))?;
    let close = matching_delimiter(source, open, b'{', b'}')?;
    Ok(source[open + 1..close].to_owned())
}

fn enum_body(source: &str, type_name: &str) -> Result<String, String> {
    let marker = format!("enum {type_name}");
    let start = source
        .find(&marker)
        .ok_or_else(|| format!("could not find {marker}"))?;
    let open = start
        + marker.len()
        + source[start + marker.len()..]
            .find('{')
            .ok_or_else(|| format!("could not find {type_name} body"))?;
    let close = matching_delimiter(source, open, b'{', b'}')?;
    Ok(source[open + 1..close].to_owned())
}

fn matching_delimiter(
    source: &str,
    open: usize,
    opening: u8,
    closing: u8,
) -> Result<usize, String> {
    let mut depth = 0;
    for (offset, byte) in source.as_bytes()[open..].iter().copied().enumerate() {
        if byte == opening {
            depth += 1;
        } else if byte == closing {
            depth -= 1;
            if depth == 0 {
                return Ok(open + offset);
            }
        }
    }
    Err(format!("unclosed delimiter at byte {open}"))
}

#[derive(Debug)]
struct PublicMethod {
    name: String,
    signature: String,
}

fn public_methods(body: &str) -> Vec<PublicMethod> {
    let tokens = identifiers(body);
    let mut methods = Vec::new();
    for (index, (identifier, position)) in tokens.iter().enumerate() {
        if identifier != "pub" || tokens.get(index + 1).map(|token| token.0.as_str()) != Some("fn")
        {
            continue;
        }
        let Some((name, name_position)) = tokens.get(index + 2) else {
            continue;
        };
        let Some(open_offset) = body[*name_position..].find('{') else {
            continue;
        };
        methods.push(PublicMethod {
            name: name.clone(),
            signature: body[*position..*name_position + open_offset].to_owned(),
        });
    }
    methods
}

fn method_by_name<'a>(methods: &'a [PublicMethod], name: &str) -> Result<&'a PublicMethod, String> {
    methods
        .iter()
        .find(|method| method.name == name)
        .ok_or_else(|| format!("missing public method {name}"))
}

fn require_signature_type(methods: &[PublicMethod], name: &str, type_name: &str) -> AuditResult {
    let method = method_by_name(methods, name)?;
    require(
        identifiers(&method.signature)
            .iter()
            .any(|(identifier, _)| identifier == type_name),
        format!("{name} signature lost required raw/environment type {type_name}"),
    )
}

fn reject_semantic_surface(label: &str, signature: &str) -> AuditResult {
    let signature_identifiers = identifiers(signature);
    for forbidden in SEMANTIC_BYPASS_NAMES {
        require(
            !signature_identifiers
                .iter()
                .any(|(identifier, _)| identifier == forbidden),
            format!("{label} exposes semantic bypass {forbidden}"),
        )?;
    }
    Ok(())
}

fn enum_variants(body: &str) -> Vec<&str> {
    body.lines()
        .filter_map(|line| {
            let trimmed = line.trim_start();
            if line.len() - trimmed.len() != 4 {
                return None;
            }
            let end = trimmed
                .find(|character: char| !character.is_ascii_alphanumeric() && character != '_')
                .unwrap_or(trimmed.len());
            let variant = &trimmed[..end];
            variant
                .chars()
                .next()
                .filter(|character| character.is_ascii_uppercase())?;
            Some(variant)
        })
        .collect()
}

fn assert_no_forbidden_production_tokens(code: &str, path: &Path) -> AuditResult {
    let token_set: BTreeSet<String> = identifiers(code)
        .into_iter()
        .map(|(identifier, _)| identifier)
        .collect();
    for forbidden in FORBIDDEN_PRODUCTION_IDENTIFIERS {
        require(
            !token_set.contains(*forbidden),
            format!(
                "{} contains forbidden production identifier {forbidden}",
                path.display()
            ),
        )?;
    }
    let compact_code = compact(code);
    for forbidden in FORBIDDEN_PRODUCTION_QUALIFIERS {
        require(
            !compact_code.contains(forbidden),
            format!(
                "{} contains forbidden production qualifier {forbidden}",
                path.display()
            ),
        )?;
    }
    assert_no_wall_clock_uses(code, path)?;
    let tokens = identifiers(code);
    for (index, (identifier, position)) in tokens.iter().enumerate() {
        if identifier != "static" {
            continue;
        }
        let next = tokens.get(index + 1).map(|token| token.0.as_str());
        require(
            next != Some("mut"),
            format!(
                "{} contains mutable static runtime state near byte {position}",
                path.display()
            ),
        )?;
    }
    for line in code.lines() {
        let trimmed = line.trim_start();
        let is_static_item = [
            "static ",
            "pub static ",
            "pub(crate) static ",
            "pub(super) static ",
        ]
        .iter()
        .any(|prefix| trimmed.starts_with(prefix));
        require(
            !is_static_item,
            format!("{} contains a global static item", path.display()),
        )?;
    }
    require(
        !compact_code.contains("cfg!(test)")
            && !compact_code.contains("cfg_attr")
            && !compact_code.contains("#[cfg(feature"),
        format!(
            "{} contains a test/feature-conditioned production branch",
            path.display()
        ),
    )
}

fn assert_no_wall_clock_uses(code: &str, path: &Path) -> AuditResult {
    let compact_code = compact(code);
    for qualified in [
        "std::time::Instant",
        "std::time::SystemTime",
        "core::time::Instant",
        "core::time::SystemTime",
    ] {
        require(
            !compact_code.contains(qualified),
            format!(
                "{} contains forbidden wall-clock type {qualified}",
                path.display()
            ),
        )?;
    }

    let mut namespace_aliases = BTreeSet::new();
    for (identifier, position) in identifiers(code) {
        if identifier != "use" {
            continue;
        }
        let Some(statement_end) = code[position..].find(';') else {
            continue;
        };
        let statement = &code[position..position + statement_end];
        let flattened = compact(statement).replace(['{', '}'], "");
        if !(flattened.contains("std::time") || flattened.contains("core::time")) {
            continue;
        }
        for imported in ["Instant", "SystemTime"] {
            require(
                !identifiers(statement)
                    .iter()
                    .any(|(name, _)| name == imported),
                format!(
                    "{} imports forbidden wall-clock type {imported}",
                    path.display()
                ),
            )?;
        }
        require(
            !flattened.contains("std::time::*") && !flattened.contains("core::time::*"),
            format!("{} wildcard-imports a wall-clock namespace", path.display()),
        )?;
        for marker in [
            "std::timeas",
            "core::timeas",
            "std::time::selfas",
            "core::time::selfas",
        ] {
            if let Some(alias_start) = flattened.find(marker) {
                let alias_tail = &flattened[alias_start + marker.len()..];
                let alias_end = alias_tail
                    .find(|character: char| !is_identifier_continue(character as u8))
                    .unwrap_or(alias_tail.len());
                if alias_end > 0 {
                    namespace_aliases.insert(alias_tail[..alias_end].to_owned());
                }
            }
        }
    }
    for alias in namespace_aliases {
        for wall_clock in ["Instant", "SystemTime"] {
            require(
                !compact_code.contains(&format!("{alias}::{wall_clock}")),
                format!(
                    "{} uses wall-clock alias {alias}::{wall_clock}",
                    path.display()
                ),
            )?;
        }
    }
    Ok(())
}

fn assert_no_forbidden_benchmark_tokens(source: &str, code: &str, path: &Path) -> AuditResult {
    let code = mask_approved_m3_benchmark_worker(source, code, path)?;
    let token_set: BTreeSet<String> = identifiers(&code)
        .into_iter()
        .map(|(identifier, _)| identifier)
        .collect();
    for forbidden in FORBIDDEN_BENCHMARK_IDENTIFIERS {
        require(
            !token_set.contains(*forbidden),
            format!(
                "{} contains forbidden benchmark escape hatch {forbidden}",
                path.display()
            ),
        )?;
    }
    for forbidden in [
        "std::thread",
        "std::net",
        "async_std",
        "tokio",
        "wasm_bindgen",
        "js_sys",
        "web_sys",
    ] {
        require(
            !compact(&code).contains(forbidden),
            format!(
                "{} contains forbidden benchmark qualifier {forbidden}",
                path.display()
            ),
        )?;
    }
    Ok(())
}

fn assert_cfg_policy(masked: &str, path: &Path) -> AuditResult {
    let bytes = masked.as_bytes();
    let mut cursor = 0;
    while let Some(relative) = masked[cursor..].find("#[cfg") {
        let start = cursor + relative;
        let open = start + 1;
        let close = matching_square(masked, open)?;
        let attribute = compact(&masked[start..=close]);
        require(
            attribute == "#[cfg(test)]",
            format!(
                "{} contains non-test cfg attribute {attribute}",
                path.display()
            ),
        )?;
        let mut next = close + 1;
        loop {
            while bytes
                .get(next)
                .is_some_and(|byte| byte.is_ascii_whitespace())
            {
                next += 1;
            }
            if bytes
                .get(next..)
                .is_some_and(|rest| rest.starts_with(b"#["))
            {
                let attribute_end = matching_square(masked, next + 1)?;
                next = attribute_end + 1;
            } else {
                break;
            }
        }
        let is_test_module =
            masked[next..].starts_with("mod ") || masked[next..].starts_with("mod\n");
        let is_scheduler_helper = path.file_name().and_then(|name| name.to_str())
            == Some("scheduler.rs")
            && masked[next..].starts_with("pub(crate) fn set_next_timer_id_for_test");
        require(
            is_test_module || is_scheduler_helper,
            format!(
                "{} uses #[cfg(test)] outside a test module or the documented scheduler helper",
                path.display()
            ),
        )?;
        cursor = close + 1;
    }
    require(
        !masked.contains("cfg_attr") && !compact(masked).contains("cfg!("),
        format!(
            "{} contains cfg_attr/cfg! executable branching",
            path.display()
        ),
    )
}

fn matching_square(source: &str, open: usize) -> Result<usize, String> {
    matching_delimiter(source, open, b'[', b']')
}

fn strip_test_modules(masked: &str, path: &Path) -> Result<String, String> {
    let mut output = masked.as_bytes().to_vec();
    let bytes = masked.as_bytes();
    let mut cursor = 0;
    while let Some(relative) = masked[cursor..].find("#[cfg(test)]") {
        let start = cursor + relative;
        let attribute_end = start + "#[cfg(test)]".len();
        let mut next = attribute_end;
        loop {
            while bytes
                .get(next)
                .is_some_and(|byte| byte.is_ascii_whitespace())
            {
                next += 1;
            }
            if bytes
                .get(next..)
                .is_some_and(|rest| rest.starts_with(b"#["))
            {
                let attribute_end = matching_square(masked, next + 1)?;
                next = attribute_end + 1;
            } else {
                break;
            }
        }
        let is_test_module =
            masked[next..].starts_with("mod ") || masked[next..].starts_with("mod\n");
        let is_scheduler_helper = path.file_name().and_then(|name| name.to_str())
            == Some("scheduler.rs")
            && masked[next..].starts_with("pub(crate) fn set_next_timer_id_for_test");
        if is_scheduler_helper {
            let Some(open_offset) = masked[next..].find('{') else {
                return Err(format!("{} scheduler helper has no body", path.display()));
            };
            let open = next + open_offset;
            let close = matching_delimiter(masked, open, b'{', b'}')?;
            mask_range(&mut output, bytes, start, close + 1);
            cursor = close + 1;
            continue;
        }
        require(
            is_test_module,
            format!("{} uses #[cfg(test)] outside a module", path.display()),
        )?;
        let Some(open_offset) = masked[next..].find('{') else {
            return Err(format!("{} test module has no body", path.display()));
        };
        let open = next + open_offset;
        let close = matching_delimiter(masked, open, b'{', b'}')?;
        mask_range(&mut output, bytes, start, close + 1);
        cursor = close + 1;
    }
    String::from_utf8(output)
        .map_err(|error| format!("{} source was not UTF-8: {error}", path.display()))
}

fn collect_rust_sources(root: &Path, files: &mut Vec<PathBuf>) -> AuditResult {
    let entries = fs::read_dir(root).map_err(|error| {
        format!(
            "read production source directory {}: {error}",
            root.display()
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("read production source entry: {error}"))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("inspect production source {}: {error}", path.display()))?;
        if file_type.is_dir() {
            collect_rust_sources(&path, files)?;
        } else if file_type.is_file()
            && path.extension().and_then(|extension| extension.to_str()) == Some("rs")
        {
            files.push(path);
        }
    }
    Ok(())
}

fn parse_flat_assignments(source: &str) -> Result<BTreeMap<String, String>, String> {
    let mut assignments = BTreeMap::new();
    for (line_number, line) in source.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        require(
            !line.starts_with('['),
            format!(
                "source-lock.toml unexpectedly contains a table at line {}",
                line_number + 1
            ),
        )?;
        let Some((key, raw_value)) = line.split_once('=') else {
            return Err(format!(
                "source-lock.toml line {} is not an assignment",
                line_number + 1
            ));
        };
        let key = key.trim();
        let raw_value = raw_value.trim();
        require(
            !key.is_empty() && !raw_value.is_empty(),
            format!(
                "source-lock.toml line {} has an empty key/value",
                line_number + 1
            ),
        )?;
        let value =
            if raw_value.starts_with('"') && raw_value.ends_with('"') && raw_value.len() >= 2 {
                raw_value[1..raw_value.len() - 1].to_owned()
            } else {
                raw_value.to_owned()
            };
        require(
            assignments.insert(key.to_owned(), value).is_none(),
            format!("source-lock.toml repeats key {key}"),
        )?;
    }
    Ok(assignments)
}

fn required_array<'a>(object: &'a Value, field: &str) -> Result<&'a Vec<Value>, String> {
    object
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("contract map field {field} is not an array"))
}

fn required_nonempty_string(object: &Value, field: &str) -> AuditResult {
    require(
        object
            .get(field)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty()),
        format!("contract map object lacks non-empty {field}"),
    )
}

fn audit_contract_array(
    object: &Value,
    field: &str,
    expected: usize,
    source_lock: bool,
) -> AuditResult {
    let contracts = required_array(object, field)?;
    require(
        contracts.len() == expected,
        format!(
            "{field} has {} entries, expected {expected}",
            contracts.len()
        ),
    )?;
    let mut ids = BTreeSet::new();
    for contract in contracts {
        let id = contract
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("{field} contains a contract without an id"))?;
        require(
            ids.insert(id.to_owned()),
            format!("{field} repeats id {id}"),
        )?;
        for required in [
            "typescript_source",
            "parity_fixture",
            "rust_evidence",
            "semantic_class",
            "status",
        ] {
            required_nonempty_string(contract, required)?;
        }
        let rust_equivalent = contract
            .get("rust_equivalent")
            .and_then(Value::as_array)
            .ok_or_else(|| format!("{field}:{id} rust_equivalent is not an array"))?;
        require(
            !rust_equivalent.is_empty()
                && rust_equivalent
                    .iter()
                    .all(|value| value.as_str().is_some_and(|text| !text.trim().is_empty())),
            format!("{field}:{id} has no Rust equivalent evidence"),
        )?;
        if source_lock {
            required_nonempty_string(contract, "source_lock_symbol")?;
            required_nonempty_string(contract, "target_layer")?;
        } else {
            required_nonempty_string(contract, "implementation_kind")?;
        }
    }
    Ok(())
}
