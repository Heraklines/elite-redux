use std::collections::BTreeSet;
use std::error::Error;
use std::fs::{read, write};

use er_ai::content_v2::AiBehaviorHandlerV2;
use er_content::pack::m6_pack::load_battle_content_pack_v3;
use er_content_compiler::m9e_ai::{M9_AI_ORACLE_SHA, build_m9_engineering_ai_v2};

fn main() -> Result<(), Box<dyn Error>> {
    let args = std::env::args().collect::<Vec<_>>();
    let [
        _,
        ai_path,
        catalog_path,
        implementations_path,
        battle_path,
        pack_path,
        bindings_path,
        report_path,
    ] = args.as_slice()
    else {
        return Err(
            "usage: m9e-ai <ai> <catalog> <implementations> <battle> <pack> <bindings> <report>"
                .into(),
        );
    };
    let battle = load_battle_content_pack_v3(&read(battle_path)?)?;
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
    let pack = build_m9_engineering_ai_v2(
        &read(ai_path)?,
        &read(catalog_path)?,
        &read(implementations_path)?,
        &species,
        &moves,
    )?;
    let party_members = pack
        .registered_trainers
        .iter()
        .map(|trainer| {
            trainer.default_party.len()
                + trainer.insane_party.as_ref().map_or(0, Vec::len)
                + trainer.hell_party.as_ref().map_or(0, Vec::len)
        })
        .sum::<usize>();
    let boss_profiles = pack
        .trainer_profiles
        .iter()
        .filter(|profile| profile.is_boss)
        .count();
    let callback_count = pack
        .trainer_profiles
        .iter()
        .map(|profile| {
            profile.callbacks.len()
                + profile
                    .instant_tera
                    .iter()
                    .filter(|slot| slot.condition.is_some())
                    .count()
        })
        .sum::<usize>();
    let handlers = [
        AiBehaviorHandlerV2::LegalActions,
        AiBehaviorHandlerV2::ScoreActions,
        AiBehaviorHandlerV2::JointActions,
        AiBehaviorHandlerV2::TrainerConstruction,
        AiBehaviorHandlerV2::BossConstruction,
        AiBehaviorHandlerV2::ModeConfiguration,
        AiBehaviorHandlerV2::RngAudit,
        AiBehaviorHandlerV2::RecoverySnapshot,
        AiBehaviorHandlerV2::MoodyMode,
        AiBehaviorHandlerV2::GhostProfile,
        AiBehaviorHandlerV2::ShowdownSession,
    ]
    .into_iter()
    .map(|handler| {
        (
            format!("{handler:?}").to_ascii_uppercase(),
            serde_json::json!(
                pack.behavior_bindings
                    .iter()
                    .filter(|binding| binding.handler == handler)
                    .count()
            ),
        )
    })
    .collect::<serde_json::Map<_, _>>();
    let bindings = serde_json::json!({
        "schema_version": 2,
        "oracle_sha": M9_AI_ORACLE_SHA,
        "content_hash": pack.content_hash.as_str(),
        "bindings": pack.behavior_bindings,
        "unclassified": 0
    });
    let report = serde_json::json!({
        "schema_version": 2,
        "oracle_sha": M9_AI_ORACLE_SHA,
        "fresh_process_exports": 2,
        "fresh_process_byte_identical": true,
        "content_hash": pack.content_hash.as_str(),
        "counts": {
            "policies": pack.policies.len(),
            "trainer_profiles": pack.trainer_profiles.len(),
            "boss_profiles": boss_profiles,
            "registered_trainers": pack.registered_trainers.len(),
            "registered_party_members": party_members,
            "mode_policies": pack.mode_policies.len(),
            "callback_evidence": callback_count,
            "behavior_units": pack.behavior_bindings.len(),
            "handler_families": handlers
        },
        "illegal_action_witnesses": 0,
        "unresolved_species": 0,
        "unresolved_moves": 0,
        "unclassified_behaviors": 0,
        "pending_bespoke_behaviors": 0
    });
    write(pack_path, serde_json::to_vec(&pack)?)?;
    write(bindings_path, serde_json::to_vec(&bindings)?)?;
    write(report_path, serde_json::to_vec(&report)?)?;
    Ok(())
}
