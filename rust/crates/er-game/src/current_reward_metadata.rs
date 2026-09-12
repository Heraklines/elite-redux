//! Complete initialized registry identity metadata and source English labels.
//! No sampled option, weight, RNG state, or generator-null result is consulted.
use super::current_reward_roll::{Offer, PregenArgs, RollError};
use serde::Deserialize;
use std::sync::OnceLock;
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Row {
    pub tier: usize,
    pub index: usize,
    pub id: String,
    pub generator: bool,
    pub name: String,
    pub group: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Catalog {
    source_sha: String,
    registry_rows: Vec<Row>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Names {
    temporary: Vec<String>,
    base_stat: Vec<String>,
    berry: Vec<String>,
    nature: Vec<String>,
    attack_type: Vec<String>,
    mint_template: String,
}
static CATALOG: OnceLock<Result<Catalog, RollError>> = OnceLock::new();
static NAMES: OnceLock<Result<Names, RollError>> = OnceLock::new();
pub(crate) fn rows() -> Result<&'static [Row], RollError> {
    let catalog = CATALOG
        .get_or_init(|| {
            let catalog: Catalog =
                serde_json::from_str(include_str!("current_reward_catalog.json"))
                    .map_err(|_| RollError::Invalid)?;
            if catalog.source_sha != "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7"
                || catalog.registry_rows.len() != 128
            {
                return Err(RollError::Invalid);
            }
            let mut pools = super::current_reward_pool::base();
            super::current_reward_tuning::apply(&mut pools)?;
            let expected = pools
                .iter()
                .enumerate()
                .flat_map(|(tier, rows)| {
                    rows.iter()
                        .enumerate()
                        .map(move |(index, row)| (tier, index, row.id))
                })
                .collect::<Vec<_>>();
            for (row, (tier, index, id)) in catalog.registry_rows.iter().zip(expected) {
                if row.tier != tier
                    || row.index != index
                    || row.id != id
                    || row.name.len() > 256
                    || row.group.as_ref().is_some_and(|g| g.len() > 128)
                {
                    return Err(RollError::Invalid);
                }
            }
            Ok(catalog)
        })
        .as_ref()
        .map_err(|e| *e)?;
    Ok(&catalog.registry_rows)
}
pub(crate) fn offer(row: &Row, args: Option<PregenArgs>) -> Result<Offer, RollError> {
    let mut name = row.name.clone();
    let mut group = row.group.clone();
    if let Some(args) = &args {
        let names = NAMES
            .get_or_init(|| {
                serde_json::from_str(include_str!("current_reward_generated_names.json"))
                    .map_err(|_| RollError::Invalid)
            })
            .as_ref()
            .map_err(|e| *e)?;
        let at = |rows: &[String], index: usize| {
            rows.get(index).cloned().ok_or(RollError::UnresolvedSource)
        };
        match args {
            PregenArgs::Berry { kind } => {
                name = at(&names.berry, usize::from(*kind))?;
                group = Some("berry".into());
            }
            PregenArgs::TemporaryStat { stat } => {
                name = at(
                    &names.temporary,
                    usize::from(stat.checked_sub(1).ok_or(RollError::Invalid)?),
                )?;
                group = None;
            }
            PregenArgs::BaseStat { stat } => {
                name = at(&names.base_stat, usize::from(*stat))?;
                group = None;
            }
            PregenArgs::Mint { nature } => {
                name = names
                    .mint_template
                    .replace("{{natureName}}", &at(&names.nature, usize::from(*nature))?);
                group = Some("mint".into());
            }
            PregenArgs::AttackType { kind } => {
                name = at(&names.attack_type, usize::from(*kind))?;
                group = None;
            }
            _ => return Err(RollError::UnresolvedSource),
        }
    } else if row.generator {
        return Err(RollError::Invalid);
    }
    Ok(Offer {
        id: row.id.clone(),
        name,
        group,
        tier: row.tier as u16,
        upgrade_count: 0,
        pregen_args: args,
    })
}
