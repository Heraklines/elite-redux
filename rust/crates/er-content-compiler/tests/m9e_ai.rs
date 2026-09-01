use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;

use er_ai::authority_v2::{AuthorityAiErrorV2, AuthorityAiV2};
use er_ai::full_surface::{AiActorViewV1, AiScoreContextV1, legal_actions_v1};
use er_content::pack::m6_pack::load_battle_content_pack_v3;
use er_content_compiler::m9e_ai::build_m9_engineering_ai_v2;
use er_types::battle_ids::{MoveId, PokemonId};
use er_types::{AiPolicyId, SafeU53};

const AI: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/engineering/complete-ai-definitions-v2.json"
));
const CATALOG: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m7/run-behavior-unit-manifest-v1.json"
));
const IMPLEMENTATIONS: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m7/m7-behavior-implementation-v2.json"
));
const BATTLE: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/engineering/battle-content-pack-v3.json"
));
const PACK: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/engineering/ai-policy-pack-v2.json"
));

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value is safe")
}

fn compiled() -> Result<er_ai::content_v2::AiPolicyPackV2, Box<dyn Error>> {
    let battle = load_battle_content_pack_v3(BATTLE)?;
    let species = battle
        .species
        .iter()
        .flatten()
        .map(|definition| definition.id)
        .collect::<BTreeSet<_>>();
    let moves = battle
        .moves
        .iter()
        .flatten()
        .map(|definition| definition.id)
        .collect::<BTreeSet<_>>();
    Ok(build_m9_engineering_ai_v2(
        AI,
        CATALOG,
        IMPLEMENTATIONS,
        &species,
        &moves,
    )?)
}

#[test]
fn complete_ai_catalog_is_classified_prepared_and_byte_stable() -> Result<(), Box<dyn Error>> {
    let first = compiled()?;
    let second = compiled()?;
    assert_eq!(first, second);
    assert_eq!(serde_json::to_vec(&first)?, PACK);
    assert_eq!(first.policies.len(), 4);
    assert_eq!(first.trainer_profiles.len(), 273);
    assert_eq!(first.registered_trainers.len(), 895);
    assert_eq!(first.mode_policies.len(), 9);
    assert_eq!(first.behavior_bindings.len(), 2_586);
    assert_eq!(
        first
            .registered_trainers
            .iter()
            .map(|trainer| {
                trainer.default_party.len()
                    + trainer.insane_party.as_ref().map_or(0, Vec::len)
                    + trainer.hell_party.as_ref().map_or(0, Vec::len)
            })
            .sum::<usize>(),
        7_469
    );
    first.prepare()?;
    Ok(())
}

#[test]
fn authority_ai_selects_only_legal_actions_and_restores_exactly() -> Result<(), Box<dyn Error>> {
    let prepared = compiled()?.prepare()?;
    let actor = AiActorViewV1 {
        pokemon: PokemonId::new(safe(1)),
        hp: 100,
        max_hp: 100,
        moves: vec![(MoveId::new(safe(1)), 0, 50, 0, vec![1, 2])],
        legal_switches: vec![PokemonId::new(safe(2))],
    };
    let legal = legal_actions_v1(&actor);
    let contexts = legal
        .iter()
        .cloned()
        .map(|action| {
            (
                action,
                AiScoreContextV1 {
                    effectiveness_percent: 100,
                    accuracy_percent: 100,
                    target_hp: 50,
                    target_max_hp: 100,
                    ally_damage_penalty: 0,
                },
            )
        })
        .collect::<BTreeMap<_, _>>();
    let random_policy = AiPolicyId::new(safe(2));
    let mut authority = AuthorityAiV2::new(prepared.clone());
    assert_eq!(
        authority.choose_single(false, random_policy, &actor, &contexts, Some(7)),
        Err(AuthorityAiErrorV2::NotAuthority)
    );
    let decision = authority.choose_single(true, random_policy, &actor, &contexts, Some(7))?;
    assert_eq!(decision.actions.len(), 1);
    assert!(legal.contains(&decision.actions[0]));
    assert_eq!(decision.rng_evidence.len(), 1);

    let snapshot = authority.snapshot();
    let mut restored = AuthorityAiV2::from_snapshot(prepared, snapshot)?;
    let expected = authority.choose_single(true, random_policy, &actor, &contexts, Some(11))?;
    let actual = restored.choose_single(true, random_policy, &actor, &contexts, Some(11))?;
    assert_eq!(actual, expected);
    Ok(())
}
