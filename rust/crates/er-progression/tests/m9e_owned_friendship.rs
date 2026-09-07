//! Actual data remains unchanged. This qualifies a caller-resolved in-memory
//! composition, not native fuse/gameplay, ribbon application or profile persistence.
use er_progression::current_friendship::{
    ExistingStarterAccount, FRIENDSHIP_ORACLE_SHA, FriendshipIntent, FriendshipSourceProvenance,
    PINNED_FRIENDSHIP_CAPS, ResolvedFriendshipMode, ResolvedFriendshipStarter,
    ResolvedPositiveFriendship, friendship_booster_step, plan_resolved_friendship,
};
use er_progression::current_friendship_owner::{
    CompositionError, CompositionIntent, DirectCandyRequest, FriendshipAccountState,
    FriendshipCompositionOwner, ResolvedCandyTeamReward, ResolvedCosmeticEffect,
    ResolvedRewardRecipient, SemanticCandyCall,
};
use serde_json::Value;
use sha2::{Digest, Sha256};

const LEGACY_HASH: &str = "8182bb42b37ade8fd26bf9885b26c08d9a5c6b8ce028b6261fa369077d3e0e00";
const EFFECTS_HASH: &str = "f56af6cd8fb70f707a80d3e7e6906681965be329cd8e0ac1021e9ccdcb9dbf5a";
const IDS: [&str; 15] = ["negative_loss", "zero", "rare_cap", "above_rare_cap", "max",
    "repeated_max", "threshold", "candy_saturated", "boosted_threshold", "boosted_capped",
    "shared_fusion_threshold", "direct_saturation", "direct_egg", "direct_zero", "direct_negative"];

fn provenance() -> FriendshipSourceProvenance {
    FriendshipSourceProvenance { oracle_sha: FRIENDSHIP_ORACLE_SHA.to_owned(), resolution_sha256: EFFECTS_HASH.to_owned() }
}

fn state(friendship: f64, progress: u64, candy: i64) -> FriendshipAccountState {
    FriendshipAccountState { friendship,
        accounts: vec![ExistingStarterAccount { species_id: 1, friendship_progress: progress, candy_count: candy }],
        max_unlocked: false, splice_unlocked: false, cosmetic_bits: Vec::new() }
}

fn resolved(amount: f64) -> ResolvedPositiveFriendship {
    ResolvedPositiveFriendship { provenance: provenance(), pokemon_species: 1,
        starter: ResolvedFriendshipStarter { source_root: 1, candy_account_root: 1, starter_cost: 3.0 },
        fusion_starter: None, boosted_amount: amount, capped: false, fun_debug: false,
        mode: ResolvedFriendshipMode::Classic { candy_multiplier: 3.0 }, event_boosts_fusions: false,
        friendship_caps: PINNED_FRIENDSHIP_CAPS.to_vec(), total_candy_rate: 1 }
}

fn reward() -> ResolvedCandyTeamReward {
    ResolvedCandyTeamReward { provenance: provenance(), difficulty: "ace".to_owned(), per_mon: 10,
        total_candy_rate: 1, fun_debug: false, reunlock: false,
        recipients: (0..2).map(|object_id| ResolvedRewardRecipient { object_id, species: 1, source_root: 1, candy_root: 1 }).collect(),
        effects: vec![ResolvedCosmeticEffect { id: "sakura".to_owned(), index: 39 },
            ResolvedCosmeticEffect { id: "hearts".to_owned(), index: 40 }] }
}

fn array(value: &Value) -> &[Value] { value.as_array().expect("actual bounded array") }
fn unsigned(value: &Value) -> u32 { u32::try_from(value.as_u64().expect("actual unsigned value")).expect("bounded source ID") }
fn boolean(value: &Value) -> bool { value.as_bool().expect("actual boolean") }
fn float(value: &Value) -> f64 {
    let value_float = value["value"].as_f64().expect("actual binary64");
    assert!(value_float.is_finite());
    assert_eq!(format!("{:016x}", value_float.to_bits()), value["bits_be"].as_str().expect("actual binary64 bits"));
    value_float
}
fn source_accounts(snapshot: &Value) -> Vec<ExistingStarterAccount> {
    array(&snapshot["accounts"]).iter().map(|entry| ExistingStarterAccount { species_id: unsigned(&entry["id"]),
        friendship_progress: entry["friendship"].as_u64().expect("normalized existing progress"),
        candy_count: entry["candy"].as_i64().expect("existing signed candy") }).collect()
}
fn source_bits(value: &Value) -> Vec<u8> {
    array(value).iter().map(|byte| u8::try_from(unsigned(byte)).expect("actual byte")).collect()
}
fn source_starter(value: &Value) -> ResolvedFriendshipStarter {
    ResolvedFriendshipStarter { source_root: unsigned(&value["source_root"]), candy_account_root: unsigned(&value["candy_root"]),
        starter_cost: value["cost"].as_f64().expect("actual starter cost") }
}
fn source_resolved(row: &Value) -> ResolvedPositiveFriendship {
    let context = &row["context"];
    assert!(boolean(&context["classic"])); assert_eq!(context["fun_source_type"], "undefined");
    assert!(!boolean(&context["fun"]) && !boolean(&context["fun_debug"]));
    assert!(context["moody"].is_null() && context["active_event"].is_null());
    assert!(boolean(&context["timed_events_disabled_by_harness"]));
    let amount = float(&row["request"]["amount"]);
    let mut boosted = amount;
    if amount > 0.0 {
        for modifier in array(&context["held_boosters"]) {
            assert_eq!(modifier["type"], "SOOTHE_BELL"); assert!(boolean(&modifier["belongs_to_probe"]));
            boosted = friendship_booster_step(boosted, u8::try_from(unsigned(&modifier["stack"])).expect("actual stack"))
                .expect("qualified actual booster input");
        }
    }
    let sources = array(&context["sources"]);
    ResolvedPositiveFriendship { provenance: provenance(), pokemon_species: unsigned(&sources[0]["species"]),
        starter: source_starter(&sources[0]), fusion_starter: sources.get(1).map(source_starter),
        boosted_amount: boosted, capped: boolean(&row["request"]["capped"]), fun_debug: false,
        mode: ResolvedFriendshipMode::Classic { candy_multiplier: float(&context["classic_multiplier"]) },
        event_boosts_fusions: boolean(&context["fusions_boosted"]),
        friendship_caps: array(&context["cap_registry"]).iter().map(|cap| u16::try_from(unsigned(cap)).expect("actual cap")).collect(),
        total_candy_rate: u8::try_from(unsigned(&context["reward_rates"]["totalCandy"])).expect("actual rate") }
}
fn source_reward(sidecar: &Value, before: &Value, recipe_index: usize, context: &Value) -> ResolvedCandyTeamReward {
    let recipe = &sidecar["recipes"][recipe_index];
    assert_eq!(recipe["recipe"]["kind"], "candyTeam");
    ResolvedCandyTeamReward { provenance: provenance(), difficulty: before["difficulty"].as_str().expect("actual difficulty").to_owned(),
        per_mon: u16::try_from(unsigned(&recipe["recipe"]["perMon"])).expect("actual reward amount"),
        total_candy_rate: u8::try_from(unsigned(&context["reward_rates"]["totalCandy"])).expect("actual reward rate"),
        fun_debug: boolean(&context["fun_debug"]), reunlock: boolean(&before["reunlock"]),
        recipients: array(&before["team"]).iter().map(|mon| ResolvedRewardRecipient {
            object_id: mon["object"].as_u64().expect("actual stable object identity"), species: unsigned(&mon["species"]),
            source_root: unsigned(&mon["source_root"]), candy_root: unsigned(&mon["candy_root"]) }).collect(),
        effects: array(&recipe["effects"]).iter().map(|effect| ResolvedCosmeticEffect {
            id: effect["id"].as_str().expect("actual effect ID").to_owned(), index: u16::try_from(unsigned(&effect["index"])).expect("actual bit index") }).collect() }
}
fn read_actual(environment: &str, expected: &str, bound: u64) -> Value {
    let path = std::env::var(environment).expect("remote actual source input required");
    let metadata = std::fs::symlink_metadata(&path).expect("actual source file metadata");
    assert!(metadata.is_file() && !metadata.file_type().is_symlink() && metadata.len() > 0 && metadata.len() <= bound);
    let bytes = std::fs::read(path).expect("actual source file");
    assert_eq!(bytes.len() as u64, metadata.len()); assert_eq!(format!("{:x}", Sha256::digest(&bytes)), expected);
    serde_json::from_slice(&bytes).expect("qualified actual source JSON")
}
fn compare_calls(actual: &[SemanticCandyCall], expected: &[&Value]) {
    assert_eq!(actual.len(), expected.len());
    for (call, row) in actual.iter().zip(expected) {
        assert_eq!(call.species, unsigned(&row["species"])); assert_eq!(call.count as f64, float(&row["count"]));
        assert_eq!(call.from_egg, row["from_egg"].as_bool()); assert_eq!(call.show_bar, row["show_bar"].as_bool());
        assert_eq!(call.returned, boolean(&row["returned"]));
        assert_eq!(unsigned(&row["arity"]), if call.show_bar.is_some() { 4 } else if call.from_egg.is_some() { 3 } else { 2 });
    }
}

#[test]
fn actual_fifteen_friendship_observations_compose_with_owned_rewards() {
    let legacy = read_actual("M9_FRIENDSHIP_COMPARISON_INPUT", LEGACY_HASH, 32768);
    let sidecar = read_actual("M9_FRIENDSHIP_EFFECTS_INPUT", EFFECTS_HASH, 12288);
    assert_eq!(legacy["oracle_sha"], FRIENDSHIP_ORACLE_SHA); assert_eq!(sidecar["oracle_sha"], FRIENDSHIP_ORACLE_SHA);
    assert_eq!(sidecar["legacy"]["sha256"], LEGACY_HASH);
    let cases = array(&legacy["cases"]); assert_eq!(cases.len(), IDS.len());
    let mut observed_call_count = 0;
    for (ordinal, (row, id)) in cases.iter().zip(IDS).enumerate() {
        assert_eq!(row["id"], id);
        let scope = array(&sidecar["scopes"]).iter().find(|scope| scope["id"] == id).expect("actual action scope");
        let before_boundary = &sidecar["boundaries"][unsigned(&scope["before"]) as usize];
        let after_boundary = &sidecar["boundaries"][unsigned(&scope["after"]) as usize];
        let initial = FriendshipAccountState { friendship: float(&row["before"]["friendship"]), accounts: source_accounts(&row["before"]),
            max_unlocked: boolean(&before_boundary["unlocked"][0]), splice_unlocked: boolean(&before_boundary["unlocked"][1]),
            cosmetic_bits: source_bits(&sidecar["cosmetic_states"][unsigned(&before_boundary["cosmetics"]) as usize]["bits"]) };
        let mut owner = FriendshipCompositionOwner::new(initial.clone(), ordinal as u64 + 1).expect("actual admitted state");
        let is_max = id == "max" || id == "repeated_max";
        let token = if row["request"]["kind"] == "friendship" {
            owner.begin_friendship(float(&row["request"]["amount"]), Some(source_resolved(row)),
                is_max.then(|| source_reward(&sidecar, before_boundary, 0, &row["context"])))
                .expect("actual friendship head")
        } else {
            owner.begin_direct_candy(DirectCandyRequest { species: unsigned(&row["request"]["species"]), candy_root: unsigned(&legacy["setup"]["candy_root"]),
                count: float(&row["request"]["count"]) as i64, from_egg: boolean(&row["request"]["from_egg"]),
                show_bar: boolean(&row["request"]["show_bar"]), fun_debug: boolean(&row["context"]["fun_debug"]),
                total_candy_rate: u8::try_from(unsigned(&row["context"]["reward_rates"]["totalCandy"])).expect("actual rate"), provenance: provenance() }).expect("actual candy request")
        };
        assert_eq!(owner.state(), &initial, "pending arithmetic is not an external profile commit");
        if is_max { assert!(owner.settle_achievement(&token).expect("actual successful reward dispatch").newly_settled); }
        let completion = owner.finish(&token).expect("source-order tail"); assert!(completion.newly_settled);
        let result = &completion.receipt;
        assert_eq!(result.state.friendship.to_bits(), float(&row["after"]["friendship"]).to_bits());
        assert_eq!(result.state.accounts, source_accounts(&row["after"]));
        assert_eq!(result.state.max_unlocked, boolean(&row["after"]["max_friendship_unlocked"]));
        assert_eq!([result.state.max_unlocked, result.state.splice_unlocked],
            [boolean(&after_boundary["unlocked"][0]), boolean(&after_boundary["unlocked"][1])]);
        assert_eq!(result.state.cosmetic_bits, source_bits(&sidecar["cosmetic_states"][unsigned(&after_boundary["cosmetics"]) as usize]["bits"]));
        let expected_calls: Vec<&Value> = array(&sidecar["semantic_calls"]).iter().filter(|call| call["scope"] == id).collect();
        compare_calls(&result.semantic_calls, &expected_calls); observed_call_count += result.semantic_calls.len();
        assert_eq!(result.intents.iter().filter(|intent| matches!(intent, CompositionIntent::RibbonLine { .. })).count(), if is_max { 1 } else { 0 });
        let ui_intents = result.intents.iter().filter(|intent| matches!(intent, CompositionIntent::CandyBar(_))).count();
        if id == "max" { assert_eq!((ui_intents, array(&row["candy_bar_calls"]).len()), (2, 3)); }
        if id == "shared_fusion_threshold" { assert_eq!((ui_intents, array(&row["candy_bar_calls"]).len()), (1, 2)); }
        assert_eq!(result.direct_return, row["returned"].as_bool());
    }
    // Compose only the actual setup reward action, not native fuse or its UI queue.
    let scope = array(&sidecar["scopes"]).iter().find(|scope| scope["id"] == "setup_splice").expect("actual SPLICE scope");
    let before = &sidecar["boundaries"][unsigned(&scope["before"]) as usize];
    let after = &sidecar["boundaries"][unsigned(&scope["after"]) as usize];
    let mut initial = state(float(&cases[9]["after"]["friendship"]), 0, 0);
    initial.accounts = source_accounts(&cases[9]["after"]); initial.max_unlocked = boolean(&before["unlocked"][0]);
    initial.splice_unlocked = boolean(&before["unlocked"][1]);
    initial.cosmetic_bits = source_bits(&sidecar["cosmetic_states"][unsigned(&before["cosmetics"]) as usize]["bits"]);
    let mut owner = FriendshipCompositionOwner::new(initial, 16).expect("actual setup account");
    let token = owner.begin_splice_reward(source_reward(&sidecar, before, 1, &cases[9]["context"]))
        .expect("resolved setup reward");
    owner.settle_achievement(&token).expect("known successful setup dispatch");
    let completion = owner.finish(&token).expect("setup reward completion");
    assert_eq!([completion.receipt.state.max_unlocked, completion.receipt.state.splice_unlocked],
        [boolean(&after["unlocked"][0]), boolean(&after["unlocked"][1])]);
    let expected: Vec<&Value> = array(&sidecar["semantic_calls"]).iter().filter(|call| call["scope"] == "setup_splice").collect();
    compare_calls(&completion.receipt.semantic_calls, &expected);
    // Source-grounded arithmetic projection: setup's actual before-account is
    // the preceding legacy after-state; the sidecar directly observes two 15
    // calls, but does not itself contain post-account snapshots.
    assert_eq!(source_accounts(&cases[9]["after"])[0].candy_count, 0);
    assert_eq!(completion.receipt.semantic_calls.iter().map(|call| (call.before_candy, call.after_candy)).collect::<Vec<_>>(),
        vec![(0, 15), (15, 30)]);
    assert_eq!(completion.receipt.state.accounts[0].candy_count, 30);
    observed_call_count += completion.receipt.semantic_calls.len(); assert_eq!(observed_call_count, 12);
    assert_eq!(completion.receipt.state.cosmetic_bits, source_bits(&sidecar["cosmetic_states"][unsigned(&after["cosmetics"]) as usize]["bits"]));
}

#[test]
fn owned_friendship_tokens_reject_foreign_and_wrong_phase_without_mutation() {
    let initial = state(254.0, 0, 0);
    let mut first = FriendshipCompositionOwner::new(initial.clone(), 1).expect("valid owner");
    let mut second = FriendshipCompositionOwner::new(initial.clone(), 1).expect("distinct owner");
    let token = first.begin_friendship(3.0, Some(resolved(3.0)), Some(reward())).expect("head");
    let other = second.begin_friendship(3.0, Some(resolved(3.0)), Some(reward())).expect("other head");
    let pending = first.pending_state().cloned();
    assert_eq!(first.settle_achievement(&other), Err(CompositionError::Ownership));
    assert_eq!(first.finish(&token), Err(CompositionError::Ownership));
    assert_eq!(first.state(), &initial); assert_eq!(first.pending_state().cloned(), pending); assert_eq!(first.next_call(), 2);
    assert!(matches!(first.begin_friendship(3.0, Some(resolved(3.0)), Some(reward())), Err(CompositionError::Busy)));
}

#[test]
fn owned_reward_duplicate_settlement_and_finish_emit_no_new_effects() {
    let mut owner = FriendshipCompositionOwner::new(state(254.0, 0, 0), 1).expect("valid owner");
    let token = owner.begin_friendship(3.0, Some(resolved(3.0)), Some(reward())).expect("head");
    let first = owner.settle_achievement(&token).expect("first reward");
    assert_eq!(first.new_semantic_calls.len(), 2);
    assert!(matches!(first.new_intents.as_slice(), [
        CompositionIntent::AchievementValidated { unlocked_now: true, .. },
        CompositionIntent::CandyBar(FriendshipIntent::ShowStarterCandy { before_candy: 0, after_candy: 15, scaled_count: 15, .. }),
        CompositionIntent::CandyBar(FriendshipIntent::ShowStarterCandy { before_candy: 15, after_candy: 30, scaled_count: 15, .. }),
        CompositionIntent::CosmeticAvailability { effect: ResolvedCosmeticEffect { index: 39, .. }, changed: true },
        CompositionIntent::CosmeticAvailability { effect: ResolvedCosmeticEffect { index: 40, .. }, changed: true },
    ]));
    assert_eq!(first.receipt.state.accounts[0].candy_count, 30); assert_eq!(first.receipt.state.accounts[0].friendship_progress, 0);
    let again = owner.settle_achievement(&token).expect("retained reward");
    assert!(!again.newly_settled); assert_eq!(first.receipt, again.receipt);
    assert!(again.new_intents.is_empty() && again.new_semantic_calls.is_empty());
    let done = owner.finish(&token).expect("tail once");
    assert!(done.new_semantic_calls.is_empty());
    assert!(matches!(done.new_intents.as_slice(), [CompositionIntent::RibbonLine { original_species: 1 }]));
    assert_eq!(done.receipt.state.accounts[0].candy_count, 30); assert_eq!(done.receipt.state.accounts[0].friendship_progress, 9);
    let repeated = owner.finish(&token).expect("retained complete result");
    assert!(!repeated.newly_settled); assert_eq!(done.receipt, repeated.receipt);
    assert!(repeated.new_intents.is_empty() && repeated.new_semantic_calls.is_empty());
    assert_eq!(owner.settle_achievement(&token).expect("retained exact reward receipt").receipt, first.receipt);
    assert_eq!(owner.next_call(), 2);
    let next = owner.begin_friendship(3.0, Some(resolved(3.0)), Some(reward())).expect("second max head");
    assert!(owner.settle_achievement(&next).expect("already unlocked validation").receipt.semantic_calls.is_empty());
    let next_done = owner.finish(&next).expect("second max tail"); assert_eq!(next_done.receipt.state.accounts[0].candy_count, 30);
    assert_eq!(owner.finish(&token), Err(CompositionError::Ownership));
    // Source-grounded native saturation case; it is not an extra exported TS case.
    let mut saturated = FriendshipCompositionOwner::new(state(254.0, 74, 9990), 1).expect("near cap");
    let token = saturated.begin_friendship(3.0, Some(resolved(3.0)), Some(reward())).expect("near-cap head");
    let reward_result = saturated.settle_achievement(&token).expect("ordered saturation");
    assert_eq!(reward_result.receipt.semantic_calls.iter().map(|call| call.returned).collect::<Vec<_>>(), vec![true, false]);
    let final_result = saturated.finish(&token).expect("tail uses post-reward account");
    assert_eq!(final_result.receipt.state.accounts[0].candy_count, 9999);
    assert_eq!(final_result.receipt.state.accounts[0].friendship_progress, 74);
    assert_eq!(final_result.receipt.semantic_calls.len(), 3);
    assert!(!final_result.receipt.semantic_calls[2].returned);
}

#[test]
fn owned_friendship_frontier_and_arithmetic_failures_preserve_pending() {
    let initial = state(50.0, 0, 0);
    let mut exhausted = FriendshipCompositionOwner::new(initial.clone(), u64::MAX).expect("valid exhausted frontier");
    assert!(matches!(exhausted.begin_friendship(3.0, Some(resolved(3.0)), None), Err(CompositionError::Overflow)));
    assert_eq!(exhausted.state(), &initial); assert_eq!(exhausted.next_call(), u64::MAX); assert!(exhausted.pending_state().is_none());
    let mut owner = FriendshipCompositionOwner::new(initial.clone(), 1).expect("valid owner");
    let token = owner.begin_direct_candy(DirectCandyRequest { species: 1, candy_root: 1, count: i64::MAX,
        from_egg: false, show_bar: true, fun_debug: false, total_candy_rate: 1, provenance: provenance() }).expect("retained request");
    let pending = owner.pending_state().cloned();
    assert!(matches!(owner.finish(&token), Err(CompositionError::Arithmetic(_))));
    assert_eq!(owner.state(), &initial); assert_eq!(owner.pending_state().cloned(), pending); assert_eq!(owner.next_call(), 2);
    assert!(matches!(owner.finish(&token), Err(CompositionError::Arithmetic(_))));
}

#[test]
fn owned_reward_admission_rejects_unsupported_context_and_keys() {
    let initial = state(254.0, 0, 0);
    for mode in 0..7 {
        let mut value = reward();
        match mode {
            0 => value.difficulty = "elite".to_owned(),
            1 => value.reunlock = true,
            2 => value.recipients[1].object_id = value.recipients[0].object_id,
            3 => value.recipients[0].candy_root = 2,
            4 => value.effects[0].index = 40,
            5 => value.provenance.resolution_sha256 = "0".repeat(64),
            _ => value.fun_debug = true,
        }
        let mut owner = FriendshipCompositionOwner::new(initial.clone(), 7).expect("valid before");
        assert!(matches!(owner.begin_friendship(3.0, Some(resolved(3.0)), Some(value)), Err(CompositionError::Unsupported)));
        assert_eq!(owner.state(), &initial); assert_eq!(owner.next_call(), 7); assert!(owner.pending_state().is_none());
    }
    let mut unknown = initial; unknown.cosmetic_bits = vec![1];
    assert!(matches!(FriendshipCompositionOwner::new(unknown, 1), Err(CompositionError::Unsupported)));
}

#[test]
fn owned_reward_projection_keeps_unrelated_accounts_and_source_argument_identity() {
    let mut initial = state(50.0, 74, 0);
    initial.accounts.push(ExistingStarterAccount { species_id: 2, friendship_progress: 11, candy_count: 20 });
    initial.accounts.push(ExistingStarterAccount { species_id: 3, friendship_progress: 33, candy_count: 44 });
    let mut input = resolved(3.0); input.starter.candy_account_root = 2;
    let mut owner = FriendshipCompositionOwner::new(initial.clone(), 1).expect("four-root view");
    let token = owner.begin_friendship(3.0, Some(input), None).expect("explicit distinct root mapping");
    let result = owner.finish(&token).expect("mapped tail").receipt;
    assert_eq!(result.semantic_calls[0].species, 1); assert_eq!(result.semantic_calls[0].candy_root, 2);
    assert_eq!(result.state.accounts[0].friendship_progress, 8); assert_eq!(result.state.accounts[1].candy_count, 21);
    assert_eq!(result.state.accounts[1].friendship_progress, 11); assert_eq!(result.state.accounts[2], initial.accounts[2]);
    // The old public plan intentionally retains its original external-intent semantics.
    let old = plan_resolved_friendship(254.0, 3.0, &state(254.0, 0, 0).accounts, Some(&resolved(3.0))).expect("unchanged old API");
    assert_eq!(old.accounts[0].candy_count, 0); assert_eq!(old.accounts[0].friendship_progress, 9); assert_eq!(old.intents.len(), 2);
}
