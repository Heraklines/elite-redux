"""Remote-only retained current turn execution with whole-target regressions."""
import base64
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import urllib.request

BASE = "40a59698400da73aa15fe883538b7135b69ee51e"
BRANCH = "codex/m9e-current-turn-focused-20260909"
CI = [".github/workflows/m9e-current-turn-focused.yml", "scripts/ci/m9e_current_turn_diagnostic.py"]
DELTAS = {"after":{"rust/crates/er-save/src/m9e_save_v2.rs":"c40214202c7208aa7edd6f138c8debfbf80d35b80b0898c8ebf60fad5dac918f","rust/crates/er-kernel/tests/m9e_material_retention_v7.rs":"b10cbc0692d24cb38b37ed4572ab23b4313ea827b78a58a182abf197d1c2354c","rust/crates/er-battle/src/current_target_execution.rs":"ef1493c8d96c7b54964f525dc0737b38b911e7734009a2730316353bd122597f","rust/crates/er-game/src/m9e_runtime_v6.rs":"3a79ec4f30e8b262de6eb6db93ab88e04644fce5ef7ea25ae2df2397078eb63a","rust/crates/er-game/src/m9e_material_v6.rs":"80c79f00c87dd8b581cccf65dc329e7223c8915c99adc98f4f09056a2464a118","rust/crates/er-battle/src/m7_resolver.rs":"4e605aae3bc7a0d7bb23c67600916847b8d7b5bd8a0619d569aa4a23b9682ab6","rust/crates/er-battle/src/lib.rs":"e3c8df21c8bc774d7624cbdd2d9d847a96b4c69b6423aad5894862d074a0bdb5","rust/crates/er-kernel/tests/m9e_snapshot_v7.rs":"48a3c7075acbb038727402015fcc39dca491150b60386aaaa41b1e7b2be8a263","rust/crates/er-state/src/current_targeting.rs":"826c92f7ec5b79dda258f8be0151731a1fe2f0faa4d6a88f9938779cc7c2764f","rust/crates/er-state/src/current_turn_execution.rs":"9eecbdda3e11fddf6ee27c7c5a2e8c8819131f3cb03015658d4d3d4aacf7fa93","rust/crates/er-types/src/m7_action.rs":"26cd7a22833373d4c0f0b37a68516a2c80abd86f147f70a5653b7caeb24a06db","rust/crates/er-state/src/lib.rs":"33a00ad3a2c88de9019bb15ff5a244202bda7e08d248d1963e9b45529ae85f5c","rust/crates/er-game/tests/m9e_runtime_v6.rs":"4e1bf2dfdc4947be09d255d6198ef5f4adb52ce6d6b418699a0065b25d814c6c","rust/crates/er-game/src/m9e_content_v2.rs":"9a4dbe89507d2e82b60b3fa5107d3211e9b08101e997574299c362cccf250299","rust/crates/er-game/tests/m9e_content_v2.rs":"bb4e57a32dd8224e351e530a32a906e0d538e6a85c3fdee33926e131391d5245","rust/crates/er-game/src/m9e_new_run_v6.rs":"b43fd0846f670532da050bade946593ee7b08ce77815698aafb7512c6e20ecdc","rust/crates/er-game/tests/m9e_material_v6.rs":"269da25c5bf034487041c738061deea1ede83677ce06cd14276e6dfe01ff43e0","rust/crates/er-state/src/m9e_state_v6.rs":"08d6c5b16e0945e62c96853f512ad49318630eb129cda0c88e77f7615d8122dd","rust/crates/er-battle/src/current_turn_continuation.rs":"d66e529c526e3f5264679959fd6f30d80ccf579c44b362b1dec6b539b74cf701","rust/crates/er-kernel/tests/m9e_current_target_execution.rs":"77debdfc852bf73fdc55d9e5994f39a80956b88e4dab1c6c327aa5038dfdf750","rust/crates/er-kernel/src/game_kernel_v7.rs":"4578172d237e62a1c126a9631fa8fa3979b9ae3bd3ae207df3884aef04721074","rust/crates/er-game/tests/m9e_material_retention.rs":"0069b3ff0a82eaaab623ffa32ac3fd866b4403bcdd11acebe983338ef35770f3"},"before":{"rust/crates/er-battle/src/lib.rs":"e3b035c6ee1fa52237dc64945d0e42f897d0118e0479a769190c81164c77ed75","rust/crates/er-battle/src/m7_resolver.rs":"6df83bf311d6eb5e5f6d68e1b0d60be27020ea962e901e11304b67f769deb72b","rust/crates/er-game/src/m9e_content_v2.rs":"d38878172aa5c9b2bbee4ce5a572fc8291cfbfd125d2d81eae72cde6c46b1dc5","rust/crates/er-game/src/m9e_material_v6.rs":"af37672dbb96ea7253995ec6f129cede823ced28914893660c6dc33ee193ffe1","rust/crates/er-game/src/m9e_new_run_v6.rs":"883f8ddadf13a63ba7c1dfbfb2b338598e41458267cc0b17182d90b5bf83bd31","rust/crates/er-game/src/m9e_runtime_v6.rs":"7f17ad6dc294dbaa525d27f79684c363a755bf9956a2c1a8bb403753b5cfe46c","rust/crates/er-game/tests/m9e_content_v2.rs":"3b4477542ec3b435b756786f12a647d3421d7eda4c73de61d6c92d9a9c1f3f59","rust/crates/er-game/tests/m9e_material_retention.rs":"493f575642d93202e2396387f4daa6bfa2d8d85e9176ef0f43744bcba563fe1d","rust/crates/er-game/tests/m9e_material_v6.rs":"6e336a593e67e6c3bfa9804eafc63cf2ed384592fd188fac163dc4b2333e14b5","rust/crates/er-game/tests/m9e_runtime_v6.rs":"b60e14c71c62ec58b827ab503b51d1566078b66809034bd1c9afc7dbdb9d6cf4","rust/crates/er-kernel/src/game_kernel_v7.rs":"d04e1f07ea0e414a8a518cd4fbff46abea58b907d14b764d2e72d359eaba5400","rust/crates/er-kernel/tests/m9e_material_retention_v7.rs":"29bbf74b5d2202e7325dab930f8ed71bd4b5b4c63952b0a60cc3e6d9c1d11c84","rust/crates/er-kernel/tests/m9e_snapshot_v7.rs":"61bf667ffb72247c98d6f5bc3131c376635368c6426eab006de84794eaa209cd","rust/crates/er-save/src/m9e_save_v2.rs":"17f4b9ac328c4efa4054ab1253b85bfbcdffd22fcb6a28b0b6d5885976d846f7","rust/crates/er-state/src/lib.rs":"31982cf02e13bc26e4d8d79fee0cc4851cb0e9dc7f10637539c1f6fc33a80cfa","rust/crates/er-state/src/m9e_state_v6.rs":"6e9c98f67f695a4828c558748b7b4c73c1700fdea5930b1013bda385580e9909","rust/crates/er-types/src/m7_action.rs":"6accd7980ad895fb4d131b63fe46a7029db787c2006c2e255ac81f449e337f5f"}}
TARGETS = {"m9e_fresh_friendship_profile":{"crate":"er-cli","ids":["fresh_catalog_requires_qualified_complete_progression_not_only_oracle_sha","fresh_owner_restore_rejects_catalog_and_schema_forgery_transactionally","fresh_title_accounts_survive_natural_state_save_and_captured_replay","unknown_profile_restore_does_not_create_accounts_or_erase_legacy_bytes"]},"m9e_content_v2":{"crate":"er-game","ids":["direct_bundle_rejects_legacy_core_fields","direct_content_v2_prepares_every_current_domain","state_v6_validates_the_complete_content_identity","unresolved_starter_move_fails_closed"]},"m9e_material_v6":{"crate":"er-game","ids":["common_applier_is_idempotent_conflict_safe_and_snapshot_stable","material_rejects_variant_domain_revision_and_mutation_gaps"]},"m9e_runtime_v6":{"crate":"er-game","ids":["bootstrap_candidate_is_serialized_and_installed_through_the_common_applier","replica_cannot_dispatch_canonical_actions","save_action_allocates_one_typed_request_and_emits_canonical_save_v2"]},"m9e_material_retention":{"crate":"er-game","ids":["bounded_material_suffix_crosses_three_full_4096_windows_through_dispatch_and_apply","retention_policy_restore_and_revision_exhaustion_reject_without_retirement","small_suffix_retained_conflicts_late_invalid_and_stale_material_preserve_full_frontier"]},"m9e_snapshot_v7":{"crate":"er-kernel","ids":["active_snapshot_round_trips_at_a_quiescent_boundary","quiescent_v6_snapshot_migrates_without_gameplay_side_effects","terminal_lifecycle_requires_complete_control_and_terminal_identity","typed_pending_effects_cross_validate_allocator_and_content"]},"m9e_material_retention_v7":{"crate":"er-kernel","ids":["v7_material_rollover_restores_pending_effects_and_continues_exact_snapshots","v7_restore_rejects_historical_gapped_evidence_and_continues_a_valid_suffix"]},"m9e_game_kernel_v7":{"ids":["authority_ai_can_choose_a_legal_enemy_switch","authority_ai_exhausted_max_pp_uses_struggle_without_extra_decisions_or_pp","authority_ai_max_pp_boundaries_drive_raw_choices_without_extra_rng","final_wave_victory_terminates_the_run","gamepad_buttons_drive_bootstrap_and_active_controls","held_action_cannot_cross_bootstrap_menu_instance","natural_solo_battle_reaches_terminal_using_only_physical_keys","nonterminal_battle_progresses_to_next_wave","raw_keys_complete_natural_start_and_install_serialized_v6_state","read_preserves_saved_difficulty_over_other_naturally_selected_live_difficulty","read_rebind_clears_real_repeat_ownership_without_cancelling_unrelated_work","read_rebind_keeps_larger_saved_floors_and_no_active_run_behavior","read_rebind_preserves_saved_semantics_and_executes_write_after_restore","read_rebind_rejects_stale_action_context_and_preserves_canonical_battle_root","read_rebind_rolls_back_menu_revision_presentation_and_replay_exhaustion"],"crate":"er-kernel"},"m9e_current_move_targets":{"ids":["invalid_owner_context_fails_without_inventing_rng_or_callback_results","source_random_draw_precedes_alive_filter_and_other_never_falls_back_to_ally","source_spread_promotion_keeps_adjacency_and_multihit_exception","whole_source_targeting_matches_all_twenty_categories_and_owner_call_order"],"crate":"er-battle"},"m9e_current_target_execution":{"ids":["actual_target_menu_retains_move_restore_and_cancel_owner","natural_raw_turn_uses_current_targets_and_preserves_save_material","poison_redirect_and_source_passive_gate_share_actual_owner","queued_faint_retargets_opponents_but_preserves_same_side_cancellation","retained_turn_faint_blocks_later_move_at_live_reward_preimage","retained_turn_matches_uninterrupted_actions_rng_and_finalization","source_spread_group_executes_all_opponents_and_multihit_exception","unsupported_selection_and_owner_stripping_fail_atomically"],"crate":"er-kernel"}}
ROOT = Path(__file__).resolve().parents[2]
RUNNER = Path(os.environ["RUNNER_TEMP"]).resolve()
OUT = RUNNER / "m9e-current-turn"
TARGET = RUNNER / "m9e-current-turn-target"
START = float(os.environ["M9E_STARTED_AT"])
DEADLINE = START + 1800
COMMANDS = []

def require(value, message):
    if not value:
        raise RuntimeError(message)

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def bounded_write(path, value, maximum):
    raw = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    require(len(raw) <= maximum, "compact result exceeds retained bound")
    path.write_bytes(raw)

def run(name, argv, cwd=ROOT, maximum=8 << 20):
    remaining = DEADLINE - 20 - time.time()
    require(remaining > 0, "shared deadline exhausted before " + name)
    seconds = min(600, remaining)
    log = OUT / "diagnostics" / (name + ".log")
    started = time.monotonic()
    with log.open("wb") as output:
        process = subprocess.Popen(argv, cwd=cwd, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        limit = started + seconds
        reason = None
        while process.poll() is None:
            if time.monotonic() >= limit or log.stat().st_size > maximum:
                reason = "deadline or diagnostic log bound exceeded"
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
                break
            time.sleep(0.1)
    raw = log.read_bytes()
    COMMANDS.append(dict(name=name, argv=argv, cwd=str(cwd.relative_to(ROOT)) or ".", limit_seconds=seconds,
                         elapsed_ms=int((time.monotonic()-started)*1000), returncode=process.returncode,
                         log_bytes=len(raw), log_sha256=sha(raw)))
    require(reason is None and process.returncode == 0 and len(raw) <= maximum, reason or name + " failed")
    require(time.time() <= DEADLINE-20, "reserved cleanup deadline exhausted")
    return raw

def git(*args):
    return run("git-"+str(len(COMMANDS)), ["git", *args])

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def source_oracle():
    """Independent source-derived projection, not a full TS GameData execution."""
    pins = {
        "src/data/balance/starters.ts": "21bd9442711f1f7381f5e7e5c4a51dac43db0584272fd5b4767493f8a68e39ef",
        "src/enums/species-id.ts": "6323f21fd3dfb859b6ae682f2f94507ad140ceeff811fdee43289779cf6665ba",
        "src/enums/passive.ts": "f4a2b339a018fe01700fb42586bb7b72006a2922d87fdf5d213a385758b310b6",
    }
    for path, digest in pins.items():
        require(sha((ROOT/path).read_bytes()) == digest, "pinned literal source differs: "+path)
    oid = "b88d78bbcf0e36c937af4fa30e45e73d7e5aea90"
    try:
        request = urllib.request.Request("https://api.github.com/repos/Heraklines/elite-redux/git/blobs/"+oid,
            headers={"Authorization": "Bearer "+os.environ["GITHUB_TOKEN"], "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "m9e-fresh-account-source"})
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            require(response.status == 200, "source HTTP status")
            body = response.read(524289)
        require(len(body) <= 524288, "single immutable source response bound")
        value = json.loads(body)
        require(value.get("sha") == oid and value.get("encoding") == "base64" and type(value.get("size")) is int and value["size"] == 325510, "source blob metadata")
        raw = base64.b64decode("".join(value["content"].splitlines()), validate=True)
        require(len(raw) == 325510 and sha(raw) == "16a69ee97d552e16ab6bb6bb2504d358a05fcf1ca80a6d53c38a4f3d1910e89f"
                and hashlib.sha1(f"blob {len(raw)}\0".encode()+raw).hexdigest() == oid, "source blob identity")
    except Exception:
        raise RuntimeError("bounded pinned GameData source retrieval/validation failed") from None
    init = "\n".join(raw.decode().splitlines()[6884:6919])
    require(all(token in init for token in ("Object.keys(speciesStarterCosts)", "species.speciesId >= 10000", "candyCount: 0", "friendship: 0", "passiveAttr: 0")), "exact reviewed constructor semantics")
    ids, next_id = {}, 0
    enum_text = (ROOT/"src/enums/species-id.ts").read_text()
    entries = re.findall(r"^  ([A-Z][A-Z0-9_]*)(?: = ([0-9]+))?,\s*$", enum_text, re.M)
    require(len(entries) == len(re.findall(r"^  [A-Z].*$", enum_text, re.M)) == 1082, "complete numeric enum source")
    for name, explicit in entries:
        if explicit:
            next_id = int(explicit)
        ids[name] = next_id
        next_id += 1
    block = re.search(r"export const speciesStarterCosts = \{(.*?)\n\};", (ROOT/"src/data/balance/starters.ts").read_text(), re.S).group(1)
    entries = re.findall(r"^  \[SpeciesId\.([A-Z0-9_]+)\]: ([0-9]+),\s*$", block, re.M)
    require(len(entries) == len([line for line in block.splitlines() if line.strip()]) == 570, "complete starter cost literals")
    expected_table = [(ids[name], int(cost), name) for name, cost in entries]
    rust = (ROOT/"rust/crates/er-game/src/current_friendship_profile.rs").read_text()
    actual_table = [(int(species), int(cost), name) for species, cost, name in re.findall(r"^\s*\(([0-9]+), ([0-9]+)\),[ \t]+// ([A-Z0-9_]+)$", rust, re.M)]
    require(actual_table == expected_table, "every Rust table row must match actual pinned source")
    definitions_path = ROOT/"rust/fixtures/m9/engineering/complete-progression-definitions-v1.json"
    definitions_raw = definitions_path.read_bytes()
    require(len(definitions_raw) == 3724089 and sha(definitions_raw) == "bba00376cae18feae56bebe38c5be0f1bb3aae3fd9a6e99e3ec7fa60a15de08f", "qualified complete allSpecies export")
    definitions = json.loads(definitions_raw)
    species = definitions["species"]
    require(len(species) == 3384 and all(type(row["species_id"]) is int and row["species_id"] > 0 for row in species), "complete source species definitions")
    custom = {row["species_id"] for row in species if row["species_id"] >= 10000}
    keys = sorted({entry[0] for entry in expected_table} | custom)
    require(len(keys) > 570 and len(keys) <= 4096, "complete bounded fresh account closure")
    path = OUT/"diagnostics/fresh-account-oracle.json"
    bounded_write(path, keys, 65536)
    # Reuse the already hash-verified source body; retain only the requested
    # initialization excerpt needed to establish fresh ribbon ownership.
    source_lines = raw.decode().splitlines()
    starts = [index for index, line in enumerate(source_lines)
        if re.match(r"^\s*(?:(?:private|public|protected)\s+)?initDexData\(", line)]
    require(len(starts) == 1, "exact fresh dex initialization definition")
    start = starts[0]
    excerpt = "\n".join(f"{index+1:05}: {source_lines[index]}"
        for index in range(start, min(start + 160, len(source_lines)))) + "\n"
    require(len(excerpt.encode()) <= 16384, "narrow dex initialization excerpt bound")
    proof = dict(qualification="source-derived complete seed-set comparison; not full TypeScript execution",
        oracle_sha="399d5d368f0b5642ebf8f45bd8a5e73350fa4de7", source_hashes=pins,
        game_data_blob=oid, game_data_bytes=len(raw), game_data_sha256=sha(raw), constructor_excerpt_sha256=sha(init.encode()),
        starter_rows=570, custom_species=len(custom), source_definition_rows=3384, total_accounts=len(keys),
        definitions_sha256=sha(definitions_raw), oracle_bytes=path.stat().st_size, oracle_sha256=sha(path.read_bytes()),
        dex_initializer_excerpt=excerpt, dex_initializer_excerpt_sha256=sha(excerpt.encode()))
    print(json.dumps(proof, sort_keys=True, separators=(",", ":")))

def main():
    require(os.environ.get("GITHUB_REPOSITORY") == "Heraklines/elite-redux" and os.environ.get("GITHUB_REF") == "refs/heads/"+BRANCH, "isolated source branch required")
    require(os.environ.get("GITHUB_REF_NAME") == BRANCH and os.environ.get("GITHUB_EVENT_NAME") == "push", "actual branch and push event")
    require(re.fullmatch(r"[0-9]{10}", os.environ["M9E_STARTED_AT"]) and 0 <= time.time()-START < 1780, "precheckout shared budget")
    require(os.name == "posix" and os.uname().machine == "x86_64", "Ubuntu x64")
    require(OUT.parent == RUNNER and TARGET.parent == RUNNER and not OUT.exists() and not TARGET.exists(), "fresh owned directories")
    (OUT/"compact").mkdir(parents=True)
    (OUT/"diagnostics").mkdir()
    TARGET.mkdir()
    os.environ["CARGO_TARGET_DIR"] = str(TARGET)
    result = dict(status="failed", qualification="current target execution; no full damage/status/source-AI, browser, XP settlement or aggregate full M9 qualification",
        schema_version=1, branch=os.environ["GITHUB_REF_NAME"], event=os.environ["GITHUB_EVENT_NAME"], started_at=START, source_sha=os.environ["GITHUB_SHA"], run_id=os.environ["GITHUB_RUN_ID"], run_attempt=os.environ["GITHUB_RUN_ATTEMPT"], base_sha=BASE, tests_executed=0, commands=COMMANDS)
    try:
        require(git("rev-parse", "HEAD").decode().strip() == result["source_sha"], "actual source HEAD")
        paths = git("diff", "--name-only", BASE, "HEAD").decode().splitlines()
        require(sorted(paths) == sorted([*DELTAS["after"], *CI]), "exact reviewed source delta")
        for path, expected in DELTAS["before"].items():
            require(sha(git("show", BASE+":"+path)) == expected, "base source differs: "+path)
        for path, expected in DELTAS["after"].items():
            require(sha((ROOT/path).read_bytes()) == expected, "reviewed source differs: "+path)
        pins = sorted(set([*DELTAS["after"], *CI, "rust/Cargo.toml", "rust/Cargo.lock", "rust/rust-toolchain.toml",
            *["rust/crates/"+crate+"/Cargo.toml" for crate in ("er-types", "er-battle", "er-state", "er-game", "er-save", "er-kernel", "er-env", "er-cli", "er-repro", "er-web")],
            "rust/crates/er-cli/src/main.rs", "rust/crates/er-repro/src/current.rs", "test/kernel-fixtures/m9/export-progression-content.ts",
            "src/data/balance/starters.ts", "src/enums/species-id.ts", "src/enums/passive.ts",
            "scripts/ci/m9e_current_move_targets_oracle.mjs",
            *["rust/crates/"+row["crate"]+"/tests/"+name+".rs" for name,row in TARGETS.items()]]))
        result["source_hashes"] = {path: sha((ROOT/path).read_bytes()) for path in pins}
        for path in pins:
            if path not in DELTAS["after"] and path not in CI:
                require(sha(git("show",BASE+":"+path)) == result["source_hashes"][path], "unchanged exact base input: "+path)
        result["fixture_tree_sha256"] = sha(git("ls-tree", "-r", "HEAD", "--", "rust/fixtures/m9/engineering"))
        result["source_oracle"] = json.loads(run("source-oracle", [sys.executable, str(Path(__file__).resolve()), "--source-oracle"], maximum=65536))
        os.environ["ER_M9E_FRESH_ACCOUNT_ORACLE"] = str(OUT/"diagnostics/fresh-account-oracle.json")
        run("toolchain-install", ["rustup", "toolchain", "install", "1.97.1", "--profile", "minimal", "--component", "rustfmt", "--component", "clippy"])
        rustc = run("rustc-version", ["rustc", "-Vv"], ROOT/"rust").decode()
        require("release: 1.97.1\n" in rustc and "host: x86_64-unknown-linux-gnu\n" in rustc, "pinned actual compiler")
        result["rustc"] = rustc
        originals = {path: (ROOT/path).read_bytes() for path in DELTAS["after"] if path.endswith(".rs")}
        run("rustfmt", ["rustfmt", "--edition", "2024", "--config", "skip_children=true", *originals])
        patch, format_rows = b"", []
        for path, original in originals.items():
            formatted = (ROOT/path).read_bytes()
            if formatted != original:
                patch += "".join(difflib.unified_diff(original.decode().splitlines(True), formatted.decode().splitlines(True), fromfile="a/"+path, tofile="b/"+path)).encode()
                format_rows.append(dict(path=path, before_sha256=sha(original), after_sha256=sha(formatted)))
        if patch:
            require(len(patch) <= 262144, "named format patch bound")
            (OUT/"diagnostics/format.patch").write_bytes(patch)
            result["format_patch"] = dict(bytes=len(patch), sha256=sha(patch), files=format_rows)
            raise RuntimeError("exact remote formatter patch required before qualification")
        cases = OUT/"diagnostics/target-source-cases.jsonl"
        oracle = json.loads(run("target-source-oracle", ["node", "--disable-warning=ExperimentalWarning", "scripts/ci/m9e_current_move_targets_oracle.mjs", str(cases)], maximum=65536))
        require(oracle["cases"] == 200 and oracle["runtime"] == "v24.9.0" and oracle["whole_target_function"] is True and oracle["whole_line_adjacency"] is True and oracle["resolved_owner_inputs_only"] is True, "whole current target source")
        require(oracle["output_bytes"] == cases.stat().st_size <= 262144 and oracle["output_sha256"] == sha(cases.read_bytes()), "complete source observations")
        for path, expected in oracle["source_hashes"].items():
            require(sha((ROOT/path).read_bytes()) == expected and sha(git("show",BASE+":"+path)) == expected, "whole unchanged target source")
        result["target_oracle"] = oracle
        os.environ["M9E_CURRENT_MOVE_TARGETS_ORACLE"] = str(cases)
        profile_keys = ["CARGO_PROFILE_"+mode+"_"+field for mode in ("DEV", "TEST") for field in ("OPT_LEVEL", "DEBUG_ASSERTIONS", "OVERFLOW_CHECKS", "DEBUG")]
        result["profile_environment"] = {key: os.environ.get(key) for key in profile_keys}
        require(all(value == ("true" if key.endswith(("DEBUG_ASSERTIONS", "OVERFLOW_CHECKS")) else "0") for key, value in result["profile_environment"].items()), "ordinary correctness profile")
        require(not any(os.environ.get(key) for key in ("RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUST_MIN_STACK", "RUST_TEST_THREADS")), "no ambient flags or execution overrides")
        run("all-target-consumer-check", ["cargo", "check", "--locked", "--workspace", "--all-targets"], ROOT/"rust")
        run("proposal-clippy", ["cargo", "clippy", "--locked", "-p", "er-types", "-p", "er-battle", "-p", "er-state", "-p", "er-game", "-p", "er-kernel", "-p", "er-save", "-p", "er-env", "-p", "er-cli", "--tests", "--no-deps", "--", "-D", "warnings"], ROOT/"rust")
        selector = ["-p", "er-battle", "-p", "er-game", "-p", "er-kernel", "-p", "er-cli"] + [argument for name in TARGETS for argument in ("--test", name)]
        raw = run("proposal-build", ["cargo", "test", "--locked", *selector, "--no-run", "--message-format=json"], ROOT/"rust")
        rows = [json.loads(line) for line in raw.splitlines() if line.startswith(b"{")]
        require([row.get("success") for row in rows if row.get("reason") == "build-finished"] == [True], "complete successful Cargo stream")
        artifacts = [row for row in rows if row.get("reason") == "compiler-artifact" and row.get("executable")]
        hosts = [row for row in artifacts if not row["profile"]["test"]]
        require(len(hosts) == 1 and hosts[0]["target"]["name"] == "er-cli" and hosts[0]["target"]["kind"] == ["bin"], "one compile-only CLI artifact")
        host = hosts[0]
        host_binary = Path(host["executable"])
        host_profile = host["profile"]
        require(host["manifest_path"] == str(ROOT/"rust/crates/er-cli/Cargo.toml") and host["target"]["src_path"] == str(ROOT/"rust/crates/er-cli/src/main.rs")
            and host.get("features") == [] and host_profile["test"] is False and host_profile["opt_level"] == "0"
            and host_profile["debug_assertions"] is True and host_profile["overflow_checks"] is True and host_profile["debuginfo"] == 0
            and host_binary == TARGET/"debug/er-cli" and host_binary.is_file() and not host_binary.is_symlink() and host_binary.resolve() == host_binary
            and 0 < host_binary.stat().st_size <= 128 << 20, "actual compile-only CLI source/profile")
        result["compile_only_cli"] = dict(target=host["target"], profile=host_profile, manifest_path=host["manifest_path"], path=str(host_binary), bytes=host_binary.stat().st_size, sha256=sha(host_binary.read_bytes()), executions=0)
        tests = [row for row in artifacts if row["profile"]["test"]]
        require(len(tests) == 10 and {row["target"]["name"] for row in tests} == set(TARGETS), "ten complete native targets")
        result["artifacts"] = []
        for artifact in sorted(tests, key=lambda row: row["target"]["name"]):
            name = artifact["target"]["name"]
            crate, ids = TARGETS[name]["crate"], TARGETS[name]["ids"]
            profile = artifact["profile"]
            binary = Path(artifact["executable"])
            require(artifact["manifest_path"] == str(ROOT/("rust/crates/"+crate+"/Cargo.toml")) and artifact["target"]["src_path"] == str(ROOT/("rust/crates/"+crate+"/tests/"+name+".rs"))
                and artifact["target"]["kind"] == ["test"] and artifact.get("features") == [] and profile["test"] is True and profile["opt_level"] == "0"
                and profile["debug_assertions"] is True and profile["overflow_checks"] is True and profile["debuginfo"] == 0
                and binary.is_absolute() and binary.parent == TARGET/"debug/deps" and binary.is_file() and not binary.is_symlink() and binary.resolve() == binary
                and re.fullmatch(re.escape(name)+r"-[0-9a-f]{16}", binary.name) and 0 < binary.stat().st_size <= 128 << 20, "actual artifact/source/profile identity")
            listing = run(name+"-list", [str(binary), "--list", "--format", "terse"], ROOT/("rust/crates/"+crate), maximum=16384)
            require(listing == "".join(test+": test\n" for test in ids).encode(), "exact whole target IDs")
            digest = sha(binary.read_bytes())
            output = run(name+"-execute", [str(binary), "--format", "terse"], ROOT/("rust/crates/"+crate), maximum=32768)
            require(re.findall(rb"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output) == [(str(len(ids)).encode(), b"0", b"0", b"0", b"0")], "every whole-target test must pass")
            require(sha(binary.read_bytes()) == digest, "executed artifact changed")
            result["artifacts"].append(dict(target=artifact["target"], profile=profile, manifest_path=artifact["manifest_path"], path=str(binary), bytes=binary.stat().st_size, sha256=digest, ids=ids, listing_bytes=len(listing), listing_sha256=sha(listing)))
            result["tests_executed"] += len(ids)
        require(result["tests_executed"] == 49, "all47 targeting regressions plus2 retained turn witnesses")
        require(sha(cases.read_bytes()) == result["target_oracle"]["output_sha256"], "whole target oracle changed")
        require(sha(host_binary.read_bytes()) == result["compile_only_cli"]["sha256"], "compile-only CLI artifact changed")
        require(sha((OUT/"diagnostics/fresh-account-oracle.json").read_bytes()) == result["source_oracle"]["oracle_sha256"], "independent source oracle changed")
        for path, digest in result["source_hashes"].items():
            require(sha((ROOT/path).read_bytes()) == digest, "source changed during execution: "+path)
        result["status"] = "passed"
    except Exception as error:
        result["first_failure"] = str(error)[:2048]
    finally:
        require(TARGET.resolve().parent == RUNNER and TARGET.name == "m9e-current-turn-target", "cleanup ownership")
        begun = time.monotonic()
        try:
            cleanup = subprocess.run([sys.executable, "-c", "import shutil,sys; shutil.rmtree(sys.argv[1])", str(TARGET)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20, check=False)
            okay = cleanup.returncode == 0
        except (subprocess.TimeoutExpired, OSError):
            okay = False
        result["cleanup"] = dict(target_removed=not TARGET.exists(), success=okay, limit_seconds=20, elapsed_ms=int((time.monotonic()-begun)*1000))
        result["elapsed_seconds"] = time.time()-START
        if not okay or TARGET.exists() or time.time() > DEADLINE:
            result["status"] = "failed"
            result["first_failure"] = "cleanup or shared deadline failed"
        if result["status"] != "passed":
            failure = (result.get("first_failure", "qualification failed")+"\n").encode()
            if COMMANDS:
                failure += (OUT/"diagnostics"/(COMMANDS[-1]["name"]+".log")).read_bytes()[-22000:]
            (OUT/"compact/failure.txt").write_bytes(failure[:24576])
        bounded_write(OUT/"compact/summary.json", result, 65536)
    raise SystemExit(0 if result["status"] == "passed" else 1)

if __name__ == "__main__":
    if sys.argv[1:] == ["--source-oracle"]:
        source_oracle()
    else:
        require(not sys.argv[1:], "no unsupported producer arguments")
        main()
