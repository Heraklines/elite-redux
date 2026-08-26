//! M6 `BattleContentPackV3` DTOs, canonical hashing, and total validation.
//!
//! The canonical pack contains typed mechanical content only. It has no
//! callback, source text, arbitrary JSON, renderer asset path, or runtime
//! compiler state. Validation proves ordering, program/behavior closure,
//! bespoke closure, RNG ownership, and the embedded content hash.

use std::collections::{BTreeMap, BTreeSet};

use er_canonical::content_digest;
use er_mechanics::{MechanicsProgramV2, MechanicsProgramV2Error};
use er_types::battle_ids::{AbilityId, MoveId, SpeciesId};
use er_types::battle_model::{
    EffectChance, MoveAccuracy, MoveCategory, MoveFlag, MovePower, MoveTarget, PokemonType,
    PokemonTyping,
};
use er_types::mechanics::MechanicsProgramId;
use er_types::{
    BattleContentPackHashV3, BehaviorClassificationKindV2, BehaviorUnitId, BespokeMechanicId,
    CatalogHash, FormId, M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION, OracleSha, RngDomainV1,
    RngSiteDefinitionV1, SafeU53,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::pack::{TypeChart, TypeChartError};
use crate::species::SpeciesBaseStats;

/// Pinned exact derivation table for the 936 frozen extraction-gap species
/// identities (`NO_STATIC_POKEMON_SPECIES_CONSTRUCTOR`). The parity adapter
/// resolves every such oracle identity through this table instead of
/// inventing or failing closed on content production itself derives from the
/// pinned construction seams.
#[path = "m6_species_gap.rs"]
pub mod species_gap;

pub const BESPOKE_MANIFEST_SCHEMA_VERSION_V2: u32 = 2;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AbilitySlotDefinitionV1 {
    pub active: AbilityId,
    pub passives: [Option<AbilityId>; 3],
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpeciesDefinitionV3 {
    pub id: SpeciesId,
    pub canonical_form: FormId,
    pub base_stats: SpeciesBaseStats,
    pub typing: PokemonTyping,
    /// Exact oracle weight integer in the exported unit.
    pub weight: u32,
    pub ability_slots: AbilitySlotDefinitionV1,
    pub form_ids: Vec<FormId>,
    pub mechanic_programs: Vec<MechanicsProgramId>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FormTransformationPolicyV1 {
    Static,
    BattleOverlay,
    Stance,
    MegaLike,
    TeraEligible,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FormDefinitionV1 {
    pub id: FormId,
    pub species: SpeciesId,
    pub stat_override: Option<SpeciesBaseStats>,
    pub typing_override: Option<PokemonTyping>,
    pub weight_override: Option<u32>,
    pub ability_override: Option<AbilitySlotDefinitionV1>,
    pub mechanic_programs: Vec<MechanicsProgramId>,
    pub transformation_policy: FormTransformationPolicyV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoveDefinitionV3 {
    pub id: MoveId,
    pub category: MoveCategory,
    pub move_type: PokemonType,
    pub power: MovePower,
    pub accuracy: MoveAccuracy,
    pub base_pp: u16,
    pub effect_chance: EffectChance,
    pub priority: i8,
    pub target: MoveTarget,
    pub flags: Vec<MoveFlag>,
    pub mechanic_programs: Vec<MechanicsProgramId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AbilityDefinitionV3 {
    pub id: AbilityId,
    pub mechanic_programs: Vec<MechanicsProgramId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HeldItemDefinitionV3 {
    pub registry_key: String,
    pub mechanic_programs: Vec<MechanicsProgramId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatusDefinitionV2 {
    pub id: SafeU53,
    pub mechanic_programs: Vec<MechanicsProgramId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WeatherDefinitionV2 {
    pub id: SafeU53,
    pub mechanic_programs: Vec<MechanicsProgramId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TerrainDefinitionV2 {
    pub id: SafeU53,
    pub mechanic_programs: Vec<MechanicsProgramId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TagDefinitionV2 {
    pub registry_key: String,
    pub mechanic_programs: Vec<MechanicsProgramId>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FieldContentV1 {
    pub statuses: Vec<Option<StatusDefinitionV2>>,
    pub weather: Vec<Option<WeatherDefinitionV2>>,
    pub terrain: Vec<Option<TerrainDefinitionV2>>,
    pub side_conditions: Vec<TagDefinitionV2>,
    pub battler_tags: Vec<TagDefinitionV2>,
    pub arena_tags: Vec<TagDefinitionV2>,
    pub positional_tags: Vec<TagDefinitionV2>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BehaviorClassificationEntryV2 {
    pub behavior_unit: BehaviorUnitId,
    pub kind: BehaviorClassificationKindV2,
    #[serde(default)]
    pub programs: Vec<MechanicsProgramId>,
    #[serde(default)]
    pub bespoke: Option<BespokeMechanicId>,
    #[serde(default)]
    pub unsupported_reason: Option<String>,
}

impl BehaviorClassificationEntryV2 {
    fn validate_shape(&self) -> Result<(), M6PackLoadError> {
        self.behavior_unit
            .validate()
            .map_err(|_| M6PackLoadError::InvalidBehaviorUnit)?;
        let valid = match self.kind {
            BehaviorClassificationKindV2::Compiled => {
                !self.programs.is_empty()
                    && self.bespoke.is_none()
                    && self.unsupported_reason.is_none()
            }
            BehaviorClassificationKindV2::Bespoke => {
                self.programs.is_empty()
                    && self.bespoke.is_some()
                    && self.unsupported_reason.is_none()
            }
            BehaviorClassificationKindV2::Unsupported => {
                self.programs.is_empty()
                    && self.bespoke.is_none()
                    && self
                        .unsupported_reason
                        .as_deref()
                        .is_some_and(|reason| !reason.is_empty())
            }
        };
        if !valid {
            return Err(M6PackLoadError::ClassificationShape);
        }
        validate_program_id_list(&self.programs)
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct BehaviorClassificationManifestV2(pub Vec<BehaviorClassificationEntryV2>);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BespokeManifestEntryV2 {
    pub mechanic: BespokeMechanicId,
    pub behavior_units: Vec<BehaviorUnitId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BespokeManifestV2 {
    pub schema_version: u32,
    pub entries: Vec<BespokeManifestEntryV2>,
}

impl Default for BespokeManifestV2 {
    fn default() -> Self {
        Self {
            schema_version: BESPOKE_MANIFEST_SCHEMA_VERSION_V2,
            entries: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleContentPackV3 {
    pub schema_version: u32,
    pub oracle_sha: OracleSha,
    pub raw_catalog_hash: CatalogHash,
    pub semantic_catalog_hash: CatalogHash,
    pub content_hash: BattleContentPackHashV3,
    pub species: Vec<Option<SpeciesDefinitionV3>>,
    pub forms: Vec<FormDefinitionV1>,
    pub moves: Vec<Option<MoveDefinitionV3>>,
    pub abilities: Vec<Option<AbilityDefinitionV3>>,
    pub held_items: Vec<HeldItemDefinitionV3>,
    pub field_content: FieldContentV1,
    pub programs: Vec<Option<MechanicsProgramV2>>,
    pub classifications: BehaviorClassificationManifestV2,
    pub bespoke: BespokeManifestV2,
    pub rng_sites: Vec<RngSiteDefinitionV1>,
    pub type_chart: TypeChart,
}

#[derive(Serialize)]
struct PackV3HashInput<'a> {
    schema_version: u32,
    oracle_sha: &'a OracleSha,
    raw_catalog_hash: &'a CatalogHash,
    semantic_catalog_hash: &'a CatalogHash,
    species: &'a [Option<SpeciesDefinitionV3>],
    forms: &'a [FormDefinitionV1],
    moves: &'a [Option<MoveDefinitionV3>],
    abilities: &'a [Option<AbilityDefinitionV3>],
    held_items: &'a [HeldItemDefinitionV3],
    field_content: &'a FieldContentV1,
    programs: &'a [Option<MechanicsProgramV2>],
    classifications: &'a BehaviorClassificationManifestV2,
    bespoke: &'a BespokeManifestV2,
    rng_sites: &'a [RngSiteDefinitionV1],
    type_chart: &'a TypeChart,
}

impl BattleContentPackV3 {
    pub fn compute_content_hash(&self) -> Result<BattleContentPackHashV3, M6PackLoadError> {
        let digest = content_digest(&PackV3HashInput {
            schema_version: self.schema_version,
            oracle_sha: &self.oracle_sha,
            raw_catalog_hash: &self.raw_catalog_hash,
            semantic_catalog_hash: &self.semantic_catalog_hash,
            species: &self.species,
            forms: &self.forms,
            moves: &self.moves,
            abilities: &self.abilities,
            held_items: &self.held_items,
            field_content: &self.field_content,
            programs: &self.programs,
            classifications: &self.classifications,
            bespoke: &self.bespoke,
            rng_sites: &self.rng_sites,
            type_chart: &self.type_chart,
        })?;
        Ok(BattleContentPackHashV3::from_digest(digest))
    }

    pub fn validate(&self) -> Result<(), M6PackLoadError> {
        if self.schema_version != M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION {
            return Err(M6PackLoadError::SchemaVersion {
                expected: M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }

        validate_indexed("species", &self.species, |definition| {
            definition.id.get().get()
        })?;
        validate_indexed("moves", &self.moves, |definition| definition.id.get().get())?;
        validate_indexed("abilities", &self.abilities, |definition| {
            definition.id.get().get()
        })?;
        validate_indexed("statuses", &self.field_content.statuses, |definition| {
            definition.id.get()
        })?;
        validate_indexed("weather", &self.field_content.weather, |definition| {
            definition.id.get()
        })?;
        validate_indexed("terrain", &self.field_content.terrain, |definition| {
            definition.id.get()
        })?;

        validate_sorted_unique_by("forms", &self.forms, |entry| entry.id.as_str())?;
        validate_sorted_unique_by("held_items", &self.held_items, |entry| {
            entry.registry_key.as_str()
        })?;
        validate_tags("side_conditions", &self.field_content.side_conditions)?;
        validate_tags("battler_tags", &self.field_content.battler_tags)?;
        validate_tags("arena_tags", &self.field_content.arena_tags)?;
        validate_tags("positional_tags", &self.field_content.positional_tags)?;

        let programs = self.validate_programs()?;
        self.validate_definition_references(&programs)?;
        let bespoke = self.validate_bespoke()?;
        let classifications = self.validate_classifications(&programs, &bespoke)?;
        self.validate_rng_sites(&programs, &classifications)?;
        self.validate_species_forms()?;
        self.type_chart
            .validate()
            .map_err(M6PackLoadError::TypeChart)?;

        let computed = self.compute_content_hash()?;
        if computed != self.content_hash {
            return Err(M6PackLoadError::ContentHashMismatch {
                expected: computed,
                actual: self.content_hash.clone(),
            });
        }
        Ok(())
    }

    fn validate_programs(
        &self,
    ) -> Result<BTreeMap<MechanicsProgramId, &MechanicsProgramV2>, M6PackLoadError> {
        let mut programs = BTreeMap::new();
        for (index, program) in self.programs.iter().enumerate() {
            let Some(program) = program else {
                continue;
            };
            if program.id.get().get() != index as u64 {
                return Err(M6PackLoadError::ProgramIndex {
                    index,
                    actual: program.id.get().get(),
                });
            }
            program
                .validate()
                .map_err(|source| M6PackLoadError::Program { index, source })?;
            programs.insert(program.id, program);
        }
        Ok(programs)
    }

    fn validate_definition_references(
        &self,
        programs: &BTreeMap<MechanicsProgramId, &MechanicsProgramV2>,
    ) -> Result<(), M6PackLoadError> {
        for definition in self.species.iter().flatten() {
            validate_program_refs(&definition.mechanic_programs, programs)?;
        }
        for definition in &self.forms {
            validate_program_refs(&definition.mechanic_programs, programs)?;
        }
        for definition in self.moves.iter().flatten() {
            if definition.base_pp == 0 {
                return Err(M6PackLoadError::ZeroMovePp {
                    move_id: definition.id,
                });
            }
            validate_program_refs(&definition.mechanic_programs, programs)?;
        }
        for definition in self.abilities.iter().flatten() {
            validate_program_refs(&definition.mechanic_programs, programs)?;
        }
        for definition in &self.held_items {
            validate_program_refs(&definition.mechanic_programs, programs)?;
        }
        for programs_list in self.field_program_lists() {
            validate_program_refs(programs_list, programs)?;
        }
        Ok(())
    }

    fn field_program_lists(&self) -> Vec<&[MechanicsProgramId]> {
        self.field_content
            .statuses
            .iter()
            .flatten()
            .map(|entry| entry.mechanic_programs.as_slice())
            .chain(
                self.field_content
                    .weather
                    .iter()
                    .flatten()
                    .map(|entry| entry.mechanic_programs.as_slice()),
            )
            .chain(
                self.field_content
                    .terrain
                    .iter()
                    .flatten()
                    .map(|entry| entry.mechanic_programs.as_slice()),
            )
            .chain(
                self.field_content
                    .side_conditions
                    .iter()
                    .map(|entry| entry.mechanic_programs.as_slice()),
            )
            .chain(
                self.field_content
                    .battler_tags
                    .iter()
                    .map(|entry| entry.mechanic_programs.as_slice()),
            )
            .chain(
                self.field_content
                    .arena_tags
                    .iter()
                    .map(|entry| entry.mechanic_programs.as_slice()),
            )
            .chain(
                self.field_content
                    .positional_tags
                    .iter()
                    .map(|entry| entry.mechanic_programs.as_slice()),
            )
            .collect()
    }

    fn validate_bespoke(
        &self,
    ) -> Result<BTreeMap<BespokeMechanicId, BTreeSet<&BehaviorUnitId>>, M6PackLoadError> {
        if self.bespoke.schema_version != BESPOKE_MANIFEST_SCHEMA_VERSION_V2 {
            return Err(M6PackLoadError::BespokeSchemaVersion {
                expected: BESPOKE_MANIFEST_SCHEMA_VERSION_V2,
                actual: self.bespoke.schema_version,
            });
        }
        let mut result = BTreeMap::new();
        let mut previous = None;
        for entry in &self.bespoke.entries {
            if previous.is_some_and(|value| value >= entry.mechanic) {
                return Err(M6PackLoadError::BespokeNotSortedUnique);
            }
            previous = Some(entry.mechanic);
            if entry.behavior_units.is_empty() {
                return Err(M6PackLoadError::EmptyBespokeBehaviorUnits {
                    mechanic: entry.mechanic,
                });
            }
            let mut units = BTreeSet::new();
            let mut previous_unit = None;
            for unit in &entry.behavior_units {
                unit.validate()
                    .map_err(|_| M6PackLoadError::InvalidBehaviorUnit)?;
                if previous_unit.is_some_and(|value| value >= unit) {
                    return Err(M6PackLoadError::BehaviorUnitsNotSortedUnique);
                }
                previous_unit = Some(unit);
                units.insert(unit);
            }
            result.insert(entry.mechanic, units);
        }
        Ok(result)
    }

    fn validate_classifications(
        &self,
        programs: &BTreeMap<MechanicsProgramId, &MechanicsProgramV2>,
        bespoke: &BTreeMap<BespokeMechanicId, BTreeSet<&BehaviorUnitId>>,
    ) -> Result<BTreeSet<&BehaviorUnitId>, M6PackLoadError> {
        let mut classified = BTreeSet::new();
        let mut previous = None;
        for entry in &self.classifications.0 {
            entry.validate_shape()?;
            if previous.is_some_and(|value| value >= &entry.behavior_unit) {
                return Err(M6PackLoadError::ClassificationsNotSortedUnique);
            }
            previous = Some(&entry.behavior_unit);
            classified.insert(&entry.behavior_unit);
            match entry.kind {
                BehaviorClassificationKindV2::Compiled => {
                    for program_id in &entry.programs {
                        let program = programs.get(program_id).ok_or(
                            M6PackLoadError::UnknownProgramReference {
                                program_id: *program_id,
                            },
                        )?;
                        if program
                            .behavior_units
                            .binary_search(&entry.behavior_unit)
                            .is_err()
                        {
                            return Err(M6PackLoadError::ProgramDoesNotOwnBehaviorUnit {
                                program_id: *program_id,
                            });
                        }
                    }
                }
                BehaviorClassificationKindV2::Bespoke => {
                    let mechanic = entry.bespoke.expect("shape validated");
                    if !bespoke
                        .get(&mechanic)
                        .is_some_and(|units| units.contains(&entry.behavior_unit))
                    {
                        return Err(M6PackLoadError::BespokeDoesNotOwnBehaviorUnit { mechanic });
                    }
                }
                BehaviorClassificationKindV2::Unsupported => {}
            }
        }

        for program in programs.values() {
            for unit in &program.behavior_units {
                if !classified.contains(unit) {
                    return Err(M6PackLoadError::UnclassifiedProgramBehaviorUnit {
                        program_id: program.id,
                    });
                }
            }
        }
        for (mechanic, units) in bespoke {
            for unit in units {
                if !classified.contains(*unit) {
                    return Err(M6PackLoadError::UnclassifiedBespokeBehaviorUnit {
                        mechanic: *mechanic,
                    });
                }
            }
        }
        Ok(classified)
    }

    fn validate_rng_sites(
        &self,
        programs: &BTreeMap<MechanicsProgramId, &MechanicsProgramV2>,
        classifications: &BTreeSet<&BehaviorUnitId>,
    ) -> Result<(), M6PackLoadError> {
        let mut sites = BTreeMap::new();
        let mut previous = None;
        for site in &self.rng_sites {
            if previous.is_some_and(|value| value >= &site.id) {
                return Err(M6PackLoadError::RngSitesNotSortedUnique);
            }
            previous = Some(&site.id);
            if site.domain != RngDomainV1::BattleMechanical || site.requested_range == SafeU53::ZERO
            {
                return Err(M6PackLoadError::InvalidBattleRngSite);
            }
            if !classifications.contains(&site.owner) {
                return Err(M6PackLoadError::UnclassifiedRngOwner);
            }
            sites.insert(&site.id, site);
        }
        for program in programs.values() {
            for binding in &program.rng_sites {
                if sites.get(&binding.site.id).copied() != Some(&binding.site) {
                    return Err(M6PackLoadError::ProgramRngSiteMismatch {
                        program_id: program.id,
                    });
                }
            }
        }
        Ok(())
    }

    fn validate_species_forms(&self) -> Result<(), M6PackLoadError> {
        let forms: BTreeMap<&FormId, &FormDefinitionV1> =
            self.forms.iter().map(|form| (&form.id, form)).collect();
        for species in self.species.iter().flatten() {
            if species.weight == 0 {
                return Err(M6PackLoadError::ZeroSpeciesWeight {
                    species_id: species.id,
                });
            }
            validate_sorted_unique_values("species form_ids", &species.form_ids)?;
            if !species.form_ids.contains(&species.canonical_form) {
                return Err(M6PackLoadError::CanonicalFormNotDeclared {
                    species_id: species.id,
                });
            }
            for form_id in &species.form_ids {
                if !forms
                    .get(form_id)
                    .is_some_and(|form| form.species == species.id)
                {
                    return Err(M6PackLoadError::UnknownSpeciesForm {
                        species_id: species.id,
                    });
                }
            }
        }
        for form in &self.forms {
            let species = self
                .species
                .get(form.species.get().get() as usize)
                .and_then(Option::as_ref)
                .ok_or(M6PackLoadError::UnknownFormSpecies {
                    form_id: form.id.clone(),
                })?;
            if !species.form_ids.contains(&form.id) {
                return Err(M6PackLoadError::FormMissingFromSpecies {
                    form_id: form.id.clone(),
                });
            }
        }
        Ok(())
    }
}

pub fn load_battle_content_pack_v3(bytes: &[u8]) -> Result<BattleContentPackV3, M6PackLoadError> {
    let pack: BattleContentPackV3 = serde_json::from_slice(bytes)?;
    pack.validate()?;
    Ok(pack)
}

fn validate_indexed<T>(
    kind: &'static str,
    entries: &[Option<T>],
    id: impl Fn(&T) -> u64,
) -> Result<(), M6PackLoadError> {
    for (index, entry) in entries.iter().enumerate() {
        if let Some(entry) = entry {
            let actual = id(entry);
            if actual != index as u64 {
                return Err(M6PackLoadError::IndexedDefinitionMismatch {
                    kind,
                    index,
                    actual,
                });
            }
        }
    }
    Ok(())
}

fn validate_sorted_unique_by<'a, T>(
    kind: &'static str,
    entries: &'a [T],
    key: impl Fn(&'a T) -> &'a str,
) -> Result<(), M6PackLoadError> {
    let mut previous = None;
    for entry in entries {
        let current = key(entry);
        if current.is_empty() {
            return Err(M6PackLoadError::EmptyRegistryKey { kind });
        }
        if previous.is_some_and(|value| value >= current) {
            return Err(M6PackLoadError::DefinitionsNotSortedUnique { kind });
        }
        previous = Some(current);
    }
    Ok(())
}

fn validate_sorted_unique_values<T: Ord>(
    kind: &'static str,
    values: &[T],
) -> Result<(), M6PackLoadError> {
    if values.windows(2).any(|window| window[0] >= window[1]) {
        return Err(M6PackLoadError::DefinitionsNotSortedUnique { kind });
    }
    Ok(())
}

fn validate_tags(kind: &'static str, entries: &[TagDefinitionV2]) -> Result<(), M6PackLoadError> {
    validate_sorted_unique_by(kind, entries, |entry| entry.registry_key.as_str())?;
    for entry in entries {
        validate_program_id_list(&entry.mechanic_programs)?;
    }
    Ok(())
}

fn validate_program_id_list(programs: &[MechanicsProgramId]) -> Result<(), M6PackLoadError> {
    if programs.contains(&MechanicsProgramId::ZERO)
        || programs.windows(2).any(|window| window[0] >= window[1])
    {
        return Err(M6PackLoadError::ProgramReferencesNotSortedUnique);
    }
    Ok(())
}

fn validate_program_refs(
    references: &[MechanicsProgramId],
    programs: &BTreeMap<MechanicsProgramId, &MechanicsProgramV2>,
) -> Result<(), M6PackLoadError> {
    validate_program_id_list(references)?;
    for program_id in references {
        if !programs.contains_key(program_id) {
            return Err(M6PackLoadError::UnknownProgramReference {
                program_id: *program_id,
            });
        }
    }
    Ok(())
}

#[derive(Debug, Error)]
pub enum M6PackLoadError {
    #[error("battle content pack JSON is malformed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("canonical content hash failed: {0}")]
    Canonical(#[from] er_canonical::CanonicalError),
    #[error("battle content pack schema must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("{kind} slot {index} carries ID {actual}")]
    IndexedDefinitionMismatch {
        kind: &'static str,
        index: usize,
        actual: u64,
    },
    #[error("{kind} definitions must be strictly sorted and unique")]
    DefinitionsNotSortedUnique { kind: &'static str },
    #[error("{kind} registry key must not be empty")]
    EmptyRegistryKey { kind: &'static str },
    #[error("program references must be positive, strictly sorted, and unique")]
    ProgramReferencesNotSortedUnique,
    #[error("program slot {index} carries program ID {actual}")]
    ProgramIndex { index: usize, actual: u64 },
    #[error("program at slot {index} is invalid: {source}")]
    Program {
        index: usize,
        #[source]
        source: MechanicsProgramV2Error,
    },
    #[error("unknown program reference {program_id}")]
    UnknownProgramReference { program_id: MechanicsProgramId },
    #[error("move {move_id} has zero PP")]
    ZeroMovePp { move_id: MoveId },
    #[error("behavior-unit identity is invalid")]
    InvalidBehaviorUnit,
    #[error("behavior classification fields do not match its kind")]
    ClassificationShape,
    #[error("behavior classifications must be strictly sorted and unique")]
    ClassificationsNotSortedUnique,
    #[error("compiled program {program_id} does not own the classified behavior unit")]
    ProgramDoesNotOwnBehaviorUnit { program_id: MechanicsProgramId },
    #[error("program {program_id} owns an unclassified behavior unit")]
    UnclassifiedProgramBehaviorUnit { program_id: MechanicsProgramId },
    #[error("bespoke manifest schema must be {expected}, got {actual}")]
    BespokeSchemaVersion { expected: u32, actual: u32 },
    #[error("bespoke manifest entries must be strictly sorted and unique")]
    BespokeNotSortedUnique,
    #[error("bespoke mechanic {mechanic:?} has no behavior units")]
    EmptyBespokeBehaviorUnits { mechanic: BespokeMechanicId },
    #[error("behavior units must be strictly sorted and unique")]
    BehaviorUnitsNotSortedUnique,
    #[error("bespoke mechanic {mechanic:?} does not own the classified behavior unit")]
    BespokeDoesNotOwnBehaviorUnit { mechanic: BespokeMechanicId },
    #[error("bespoke mechanic {mechanic:?} owns an unclassified behavior unit")]
    UnclassifiedBespokeBehaviorUnit { mechanic: BespokeMechanicId },
    #[error("RNG sites must be strictly sorted and unique")]
    RngSitesNotSortedUnique,
    #[error("battle program RNG site must be battle-mechanical with a positive range")]
    InvalidBattleRngSite,
    #[error("RNG site owner must be classified")]
    UnclassifiedRngOwner,
    #[error("program {program_id} RNG binding differs from the pack definition")]
    ProgramRngSiteMismatch { program_id: MechanicsProgramId },
    #[error("species {species_id} weight must be positive")]
    ZeroSpeciesWeight { species_id: SpeciesId },
    #[error("species {species_id} canonical form is absent from its form list")]
    CanonicalFormNotDeclared { species_id: SpeciesId },
    #[error("species {species_id} references an unknown or foreign form")]
    UnknownSpeciesForm { species_id: SpeciesId },
    #[error("form {form_id:?} references an unknown species")]
    UnknownFormSpecies { form_id: FormId },
    #[error("form {form_id:?} is absent from its species form list")]
    FormMissingFromSpecies { form_id: FormId },
    #[error("type chart is invalid: {0}")]
    TypeChart(#[source] TypeChartError),
    #[error("embedded content hash {actual:?} does not match computed hash {expected:?}")]
    ContentHashMismatch {
        expected: BattleContentPackHashV3,
        actual: BattleContentPackHashV3,
    },
}
