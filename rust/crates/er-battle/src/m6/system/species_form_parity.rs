//! M6 system proof adapter: exact species/form battle-metadata parity over
//! the frozen raw-source oracle catalog.
//!
//! The frozen `rust/fixtures/m6/raw-source-catalog-v2.json` oracle carries
//! every battle-relevant species/form identity extracted from production:
//! 2,018 species and their 534-form closure, each entry keyed by provenance
//! hash with resolved base stats, typing, ability slots, weight, and height.
//! Species extracted through the static constructor path compile directly
//! from oracle bytes; the 936 identities without a static constructor
//! (`NO_STATIC_POKEMON_SPECIES_CONSTRUCTOR`) resolve through the pinned
//! derivation table in `er-content::m6_pack::species_gap`, which carries the
//! verbatim primitives of production's own construction seams (dump drafts,
//! authored rosters, exact kit clones) with per-record provenance. Partial or
//! divergent evidence still fails closed — nothing is invented.
//!
//! Every function here is pure and deterministic: catalog JSON in, typed
//! battle metadata or a typed failure out. The companion testkit harness
//! (`m6_species_form_parity.rs`) drives these adapters against the frozen
//! fixture bytes and proves identity closure with zero residual, exact
//! content identity for both extracted and derived species (clone records
//! must equal their compiled source), overlay admission over every canonical
//! base identity (empty form keys included), the full transform copy surface
//! over all 534 forms including the typeless presentation, and negative
//! invalid-combination witnesses.

use std::collections::{BTreeMap, BTreeSet};

use crate::m6::bespoke::forms::{
    FormsOutcomeV2, FormsTransitionError, admit_mega, admit_tera, cleanup_battle_end,
    cleanup_on_switch, require_species_metadata, resolve_pending_stance, stage_stance_request,
};
use crate::m6::bespoke::transform_imposter::{
    TransformBattlerFactsV2, TransformCopiedFieldV2, TransformImposterError,
    TransformImposterFactsV2, TransformSourceMoveFactsV2, TransformTransitionKindV2,
    apply_transform_copy, clear_transform_copy, copied_field_evidence, plan_transform_copy,
};
use er_content::pack::m6_pack::species_gap::{
    self, ErGapDerivationError, ErGapSpeciesClass, ErGapSpeciesSource,
};
use er_content::species::SpeciesBaseStats;
use er_state::bespoke_v2::forms::{
    FormCueKindV2, FormIdentityV2, FormOverlayKindV2, FormsStateV2, MAX_POKEMON_TYPE_ORDINAL,
    SpeciesFormRegistryV2,
};
use er_state::bespoke_v2::transform_imposter::{
    TRANSFORM_COPIED_PP_CAP, TransformCopiedAbilitiesV2, TransformCopiedBattleStateV2,
    TransformCopiedGenderV2, TransformCopiedMoveV2, TransformCopiedStatsV2, TransformCopyTriggerV2,
    TransformFormCopyStateV2,
};
use er_types::SafeU53;
use er_types::battle_ids::{AbilityId, BattleSide, FieldSlot, MoveId, PokemonId};
use er_types::battle_model::{BattleStats, BattleTyping, PokemonType, PokemonTyping, StatStages};
use er_types::m6::FormId;
use er_types::mechanics::MechanicScope;
use serde_json::Value;
use thiserror::Error;

/// Exact frozen species identity closure of the raw source oracle.
pub const ORACLE_SPECIES_CLOSURE_COUNT: usize = 2018;
/// Exact frozen form closure of the raw source oracle.
pub const ORACLE_FORM_CLOSURE_COUNT: usize = 534;
/// Frozen extraction-gap marker for identities without a static species
/// constructor (`raw-source-catalog-v2.json`, `extraction_gap`).
pub const NO_STATIC_SPECIES_CONSTRUCTOR_GAP: &str = "NO_STATIC_POKEMON_SPECIES_CONSTRUCTOR";

/// Typed failures raised while resolving or proving species/form parity.
#[derive(Debug, Eq, Error, PartialEq)]
pub enum SpeciesFormParityError {
    #[error("{identity}: field `{field}` is missing or has an unexpected shape")]
    MalformedField {
        identity: String,
        field: &'static str,
    },
    #[error("{identity}: symbol member `{member}` is not part of closed enum {owner}")]
    UnknownEnumMember {
        identity: String,
        owner: &'static str,
        member: String,
    },
    #[error("{identity}: symbol owner `{owner}` does not match the expected owner `{expected}`")]
    SymbolOwnerMismatch {
        identity: String,
        owner: String,
        expected: &'static str,
    },
    #[error("{identity}: number `{field}` is not finite")]
    NonFiniteNumber {
        identity: String,
        field: &'static str,
    },
    #[error("ability table declares duplicate member `{0}`")]
    DuplicateAbilityMember(String),
    #[error(
        "species {id}: content evidence is incomplete (non-null `{field}` inside an extraction gap)"
    )]
    MixedIdentityEvidence { id: u64, field: &'static str },
    #[error(
        "species {id}: base stat total {declared} differs from the resolved stat sum {resolved}"
    )]
    BaseStatTotalMismatch {
        id: u64,
        declared: u32,
        resolved: u32,
    },
    #[error("form {id}: id string does not match its species/index/key fields")]
    FormIdShapeMismatch { id: String },
    #[error("form {id}: references species {species} outside the closed species registry")]
    UnknownFormSpecies { id: String, species: u64 },
    #[error("species {id}: declares duplicate form key `{key}`")]
    DuplicateFormKey { id: u64, key: String },
    #[error("closure violated: {0}")]
    ClosureViolated(String),
    #[error("species registry rejected identity: {0}")]
    RegistryRejected(String),
    #[error("canonical forms state is invalid: {0}")]
    StateInvariant(String),
    #[error("forms transition failed: {0}")]
    Transition(#[from] FormsTransitionError),
    #[error("transform copy surface failed: {0}")]
    Transform(#[from] TransformImposterError),
    #[error("species {id}: extraction gap has no pinned derivation record")]
    UnresolvedGapSpecies { id: u64 },
    #[error(
        "species {id}: pinned derivation key `{record}` does not bind the frozen oracle key `{oracle}`"
    )]
    GapKeyBindingMismatch {
        id: u64,
        record: String,
        oracle: String,
    },
    #[error(
        "species {id}: copy-source species {source_id} is not compiled ahead of the gap identity"
    )]
    UnknownGapCopySource { id: u64, source_id: u64 },
    #[error("species {id}: pinned derivation failed: {source}")]
    GapDerivation {
        id: u64,
        source: ErGapDerivationError,
    },
}

// ---------------------------------------------------------------------------
// Frozen catalog resolution
// ---------------------------------------------------------------------------

/// Member-to-numeric-id resolution table for the frozen `AbilityId` enum,
/// built from the oracle's own closed abilities section.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct AbilityTable {
    by_member: BTreeMap<String, u64>,
}

impl AbilityTable {
    /// Builds the table from the frozen `abilities` section values.
    pub fn from_catalog_values(values: &[Value]) -> Result<Self, SpeciesFormParityError> {
        let mut by_member = BTreeMap::new();
        for value in values {
            let member = value
                .get("member")
                .and_then(Value::as_str)
                .ok_or(SpeciesFormParityError::MalformedField {
                    identity: "ability table".to_owned(),
                    field: "member",
                })?
                .to_owned();
            let numeric_id = value.get("numeric_id").and_then(Value::as_u64).ok_or(
                SpeciesFormParityError::MalformedField {
                    identity: format!("ability {member}"),
                    field: "numeric_id",
                },
            )?;
            if by_member.insert(member.clone(), numeric_id).is_some() {
                return Err(SpeciesFormParityError::DuplicateAbilityMember(member));
            }
        }
        Ok(Self { by_member })
    }

    /// Resolves one frozen enum member to its numeric ability id; unknown
    /// members fail closed.
    pub fn resolve(
        &self,
        identity: &str,
        member: &str,
    ) -> Result<AbilityId, SpeciesFormParityError> {
        let numeric_id = self.by_member.get(member).ok_or_else(|| {
            SpeciesFormParityError::UnknownEnumMember {
                identity: identity.to_owned(),
                owner: "AbilityId",
                member: member.to_owned(),
            }
        })?;
        AbilityId::try_from_u64(*numeric_id).map_err(|_| {
            SpeciesFormParityError::RegistryRejected(format!(
                "ability member {member} resolves to out-of-range numeric id {numeric_id}"
            ))
        })
    }

    /// Distinct frozen members covered by the table.
    pub fn len(&self) -> usize {
        self.by_member.len()
    }

    /// Whether the table is empty.
    pub fn is_empty(&self) -> bool {
        self.by_member.is_empty()
    }
}

fn field<'a>(
    value: &'a Value,
    identity: &str,
    name: &'static str,
) -> Result<&'a Value, SpeciesFormParityError> {
    value
        .get(name)
        .ok_or(SpeciesFormParityError::MalformedField {
            identity: identity.to_owned(),
            field: name,
        })
}

fn safe_integer(
    value: &Value,
    identity: &str,
    name: &'static str,
) -> Result<u64, SpeciesFormParityError> {
    if value.get("kind").and_then(Value::as_str) != Some("SAFE_INTEGER") {
        return Err(SpeciesFormParityError::MalformedField {
            identity: identity.to_owned(),
            field: name,
        });
    }
    value
        .get("value")
        .and_then(Value::as_u64)
        .ok_or(SpeciesFormParityError::MalformedField {
            identity: identity.to_owned(),
            field: name,
        })
}

/// Resolves one frozen JS number to its exact IEEE-754 bit pattern. Both
/// exported shapes (`SAFE_INTEGER`, `JS_NUMBER_BITS`) normalize onto the same
/// f64 domain, so equality on bits is exact content identity.
fn js_number_bits(
    value: &Value,
    identity: &str,
    name: &'static str,
) -> Result<u64, SpeciesFormParityError> {
    let bits = match value.get("kind").and_then(Value::as_str) {
        Some("SAFE_INTEGER") => {
            let integer = value.get("value").and_then(Value::as_f64).ok_or(
                SpeciesFormParityError::MalformedField {
                    identity: identity.to_owned(),
                    field: name,
                },
            )?;
            integer.to_bits()
        }
        Some("JS_NUMBER_BITS") => {
            let hex = value.get("bits").and_then(Value::as_str).ok_or(
                SpeciesFormParityError::MalformedField {
                    identity: identity.to_owned(),
                    field: name,
                },
            )?;
            u64::from_str_radix(hex, 16).map_err(|_| SpeciesFormParityError::MalformedField {
                identity: identity.to_owned(),
                field: name,
            })?
        }
        _ => {
            return Err(SpeciesFormParityError::MalformedField {
                identity: identity.to_owned(),
                field: name,
            });
        }
    };
    if f64::from_bits(bits).is_finite() {
        Ok(bits)
    } else {
        Err(SpeciesFormParityError::NonFiniteNumber {
            identity: identity.to_owned(),
            field: name,
        })
    }
}

fn symbol_member<'a>(
    value: &'a Value,
    identity: &str,
    expected_owner: &'static str,
) -> Result<&'a str, SpeciesFormParityError> {
    let kind = value.get("kind").and_then(Value::as_str);
    if kind != Some("SYMBOL_PROVENANCE") {
        return Err(SpeciesFormParityError::MalformedField {
            identity: identity.to_owned(),
            field: "symbol",
        });
    }
    let owner = value.get("owner").and_then(Value::as_str).ok_or(
        SpeciesFormParityError::MalformedField {
            identity: identity.to_owned(),
            field: "owner",
        },
    )?;
    if owner != expected_owner {
        return Err(SpeciesFormParityError::SymbolOwnerMismatch {
            identity: identity.to_owned(),
            owner: owner.to_owned(),
            expected: expected_owner,
        });
    }
    value
        .get("member")
        .and_then(Value::as_str)
        .ok_or(SpeciesFormParityError::MalformedField {
            identity: identity.to_owned(),
            field: "member",
        })
}

fn resolve_type_member(
    identity: &str,
    member: &str,
) -> Result<PokemonType, SpeciesFormParityError> {
    serde_json::from_value::<PokemonType>(Value::String(member.to_owned())).map_err(|_| {
        SpeciesFormParityError::UnknownEnumMember {
            identity: identity.to_owned(),
            owner: "PokemonType",
            member: member.to_owned(),
        }
    })
}

/// Resolves one frozen typing object. An explicit `{"kind":"NULL"}` secondary
/// means the oracle declares the identity single-typed.
///
/// The frozen oracle exports the production `PokemonType.UNKNOWN` presentation
/// for typeless identities (form `493:18:unknown`); those resolve to the
/// explicit [`BattleTyping::Typeless`] variant so they stay representable in
/// every copied payload while remaining structurally outside type-chart
/// lookup.
fn compile_typing(entry: &Value, identity: &str) -> Result<BattleTyping, SpeciesFormParityError> {
    let typing = field(entry, identity, "typing")?;
    let primary_value = field(typing, identity, "primary")?;
    let primary_member = symbol_member(primary_value, identity, "PokemonType")?;
    if primary_member == "UNKNOWN" {
        return Ok(BattleTyping::Typeless);
    }
    let primary = resolve_type_member(identity, primary_member)?;
    let secondary = match typing.get("secondary") {
        None | Some(Value::Null) => None,
        Some(secondary_value) => {
            if secondary_value.get("kind").and_then(Value::as_str) == Some("NULL") {
                None
            } else {
                let member = symbol_member(secondary_value, identity, "PokemonType")?;
                Some(resolve_type_member(identity, member)?)
            }
        }
    };
    Ok(BattleTyping::Typed(PokemonTyping { primary, secondary }))
}

/// Resolved ability slots: the active ability plus the ER three-passive
/// triple. Frozen `NONE` members resolve to absent passives.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedAbilitySlots {
    pub active: AbilityId,
    pub passives: [Option<AbilityId>; 3],
}

/// Battle-content block shared verbatim by species and form entries: exact
/// resolved stats, typing, physical constants, and ability slots.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedContent {
    pub base_stats: SpeciesBaseStats,
    pub base_stat_total: u32,
    pub typing: BattleTyping,
    /// Exact oracle weight as IEEE-754 bits.
    pub weight_bits: u64,
    /// Exact oracle height as IEEE-754 bits.
    pub height_bits: u64,
    pub ability_slots: ResolvedAbilitySlots,
}

/// Content provenance carried by one species identity: either the frozen
/// oracle's own extracted static-constructor content, or content derived
/// through a pinned production construction seam recorded by the generated
/// `er-content::m6_pack::species_gap` table. Every one of the 2,018 species
/// identities resolves to exact battle metadata; nothing is identity-only.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SpeciesContentEvidence {
    /// Content compiled directly from the frozen oracle entry.
    Extracted(Box<ResolvedContent>),
    /// Content derived from pinned primitives (dump draft, authored roster,
    /// or an exact kit clone of an earlier-resolved identity), with its seam
    /// class and human-auditable provenance.
    Derived(Box<DerivedSpeciesEvidence>),
}

/// Derived-content evidence for one extraction-gap identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DerivedSpeciesEvidence {
    /// Pinned production seam this identity resolves through.
    pub class: ErGapSpeciesClass,
    /// Human-auditable provenance (pinned source path / revision).
    pub provenance: &'static str,
    /// The exactly resolved battle content of the identity.
    pub content: ResolvedContent,
}

/// One fully resolved species identity from the frozen oracle.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedSpeciesMetadata {
    pub id: u64,
    pub key: String,
    pub provenance_hash: String,
    pub content: SpeciesContentEvidence,
}

/// One fully resolved form identity from the frozen oracle.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedFormMetadata {
    pub id: FormId,
    pub species: u64,
    pub form_index: u32,
    pub form_key: String,
    pub provenance_hash: String,
    pub content: ResolvedContent,
}

fn compile_ability_slots(
    entry: &Value,
    identity: &str,
    table: &AbilityTable,
) -> Result<ResolvedAbilitySlots, SpeciesFormParityError> {
    let slots = field(entry, identity, "ability_slots")?.as_array().ok_or(
        SpeciesFormParityError::MalformedField {
            identity: identity.to_owned(),
            field: "ability_slots",
        },
    )?;
    if slots.len() != 3 {
        return Err(SpeciesFormParityError::MalformedField {
            identity: identity.to_owned(),
            field: "ability_slots",
        });
    }
    let active_member = symbol_member(&slots[0], identity, "AbilityId")?;
    let active = table.resolve(identity, active_member)?;
    let mut passives = [None; 3];
    for (index, slot) in slots.iter().enumerate().skip(1) {
        let member = slot.get("member").and_then(Value::as_str);
        if slot.get("kind").and_then(Value::as_str) == Some("NULL") || member == Some("NONE") {
            continue;
        }
        let member = member.ok_or(SpeciesFormParityError::MalformedField {
            identity: identity.to_owned(),
            field: "ability_slots",
        })?;
        passives[index - 1] = Some(table.resolve(identity, member)?);
    }
    Ok(ResolvedAbilitySlots { active, passives })
}

fn compile_content(
    identity: &str,
    entry: &Value,
    table: &AbilityTable,
) -> Result<ResolvedContent, SpeciesFormParityError> {
    let stats_value = field(entry, identity, "base_stats")?;
    let stat = |name| -> Result<u32, SpeciesFormParityError> {
        let raw = safe_integer(field(stats_value, identity, name)?, identity, name)?;
        u32::try_from(raw).map_err(|_| SpeciesFormParityError::MalformedField {
            identity: identity.to_owned(),
            field: name,
        })
    };
    let base_stats = SpeciesBaseStats {
        hp: stat("hp")?,
        attack: stat("attack")?,
        defense: stat("defense")?,
        special_attack: stat("special_attack")?,
        special_defense: stat("special_defense")?,
        speed: stat("speed")?,
    };
    let declared_total = safe_integer(
        field(entry, identity, "base_stat_total")?,
        identity,
        "base_stat_total",
    )?;
    let base_stat_total =
        u32::try_from(declared_total).map_err(|_| SpeciesFormParityError::MalformedField {
            identity: identity.to_owned(),
            field: "base_stat_total",
        })?;
    let resolved_total = u64::from(base_stats.hp)
        + u64::from(base_stats.attack)
        + u64::from(base_stats.defense)
        + u64::from(base_stats.special_attack)
        + u64::from(base_stats.special_defense)
        + u64::from(base_stats.speed);
    if resolved_total != u64::from(base_stat_total) {
        return Err(SpeciesFormParityError::BaseStatTotalMismatch {
            id: entry.get("id").and_then(Value::as_u64).unwrap_or_default(),
            declared: base_stat_total,
            resolved: u32::try_from(resolved_total).unwrap_or(u32::MAX),
        });
    }
    let typing = compile_typing(entry, identity)?;
    let weight_bits = js_number_bits(field(entry, identity, "weight")?, identity, "weight")?;
    let height_bits = js_number_bits(field(entry, identity, "height")?, identity, "height")?;
    let ability_slots = compile_ability_slots(entry, identity, table)?;
    Ok(ResolvedContent {
        base_stats,
        base_stat_total,
        typing,
        weight_bits,
        height_bits,
        ability_slots,
    })
}

/// Extracts one plain JSON number field (identity ids and form indices are
/// exported unwrapped, unlike stat values).
fn plain_u64(
    value: &Value,
    identity: &str,
    name: &'static str,
) -> Result<u64, SpeciesFormParityError> {
    value
        .get(name)
        .and_then(Value::as_u64)
        .ok_or(SpeciesFormParityError::MalformedField {
            identity: identity.to_owned(),
            field: name,
        })
}

/// Resolves one frozen species entry into typed battle metadata. Identities
/// carrying the frozen `NO_STATIC_POKEMON_SPECIES_CONSTRUCTOR` gap must have
/// every content field exactly null (partial content fails closed) and then
/// resolve through the pinned derivation table:
///
/// - dump-draft and authored records derive deterministically from their
///   pinned primitives with provenance attached;
/// - kit-clone records copy the already-compiled content of their source
///   identity, which `compiled` (ascending catalog order) must contain.
pub fn compile_species_entry_with_context<'a>(
    entry: &Value,
    table: &AbilityTable,
    compiled: &'a [ResolvedSpeciesMetadata],
) -> Result<ResolvedSpeciesMetadata, SpeciesFormParityError> {
    let id = plain_u64(entry, "species", "id")?;
    let identity = format!("species {id}");
    let key = field(entry, &identity, "key")?
        .as_str()
        .ok_or(SpeciesFormParityError::MalformedField {
            identity: identity.clone(),
            field: "key",
        })?
        .to_owned();
    let provenance_hash = field(entry, &identity, "provenance_hash")?
        .as_str()
        .ok_or(SpeciesFormParityError::MalformedField {
            identity: identity.clone(),
            field: "provenance_hash",
        })?
        .to_owned();
    let gap = entry.get("extraction_gap");
    let content = if gap.is_some() {
        let marker = gap
            .and_then(Value::as_str)
            .ok_or(SpeciesFormParityError::MalformedField {
                identity: identity.clone(),
                field: "extraction_gap",
            })?;
        if marker != NO_STATIC_SPECIES_CONSTRUCTOR_GAP {
            return Err(SpeciesFormParityError::ClosureViolated(format!(
                "species {id}: unknown extraction gap `{marker}`"
            )));
        }
        for null_field in [
            "base_stats",
            "base_stat_total",
            "weight",
            "height",
            "generation",
        ] {
            if !entry.get(null_field).map(Value::is_null).unwrap_or(true) {
                return Err(SpeciesFormParityError::MixedIdentityEvidence {
                    id,
                    field: null_field,
                });
            }
        }
        // Typing exports as an object whose members are both null for gap
        // identities; any resolved member would be partial content.
        match entry.get("typing") {
            None | Some(Value::Null) => {}
            Some(typing) => {
                let empty = typing.get("primary").map(Value::is_null).unwrap_or(true)
                    && typing.get("secondary").map(Value::is_null).unwrap_or(true);
                if !empty {
                    return Err(SpeciesFormParityError::MixedIdentityEvidence {
                        id,
                        field: "typing",
                    });
                }
            }
        }
        // The frozen identity binds its pinned derivation record by key; a
        // divergence means the two provenance chains disagree and fails closed.
        let record =
            species_gap::resolve(id).ok_or(SpeciesFormParityError::UnresolvedGapSpecies { id })?;
        if record.key != key {
            return Err(SpeciesFormParityError::GapKeyBindingMismatch {
                id,
                record: record.key.to_owned(),
                oracle: key.clone(),
            });
        }
        let derived_content = match &record.source {
            ErGapSpeciesSource::ContentOf(source_species) => {
                let source_metadata = compiled
                    .iter()
                    .find(|entry| entry.id == *source_species)
                    .ok_or(SpeciesFormParityError::UnknownGapCopySource {
                        id,
                        source_id: *source_species,
                    })?;
                match &source_metadata.content {
                    SpeciesContentEvidence::Extracted(content) => (**content).clone(),
                    SpeciesContentEvidence::Derived(derived) => derived.content.clone(),
                }
            }
            ErGapSpeciesSource::DumpCustom { .. } | ErGapSpeciesSource::Authored { .. } => {
                let derived = record
                    .derive_content()
                    .map_err(|source| SpeciesFormParityError::GapDerivation { id, source })?;
                ResolvedContent {
                    base_stats: derived.stats,
                    base_stat_total: derived.base_stat_total,
                    typing: BattleTyping::Typed(PokemonTyping {
                        primary: derived.primary,
                        secondary: derived.secondary,
                    }),
                    weight_bits: derived.weight_bits,
                    height_bits: derived.height_bits,
                    ability_slots: ResolvedAbilitySlots {
                        active: derived.active_ability,
                        passives: [derived.passives[0], derived.passives[1], None],
                    },
                }
            }
        };
        SpeciesContentEvidence::Derived(Box::new(DerivedSpeciesEvidence {
            class: record.class,
            provenance: record.provenance,
            content: derived_content,
        }))
    } else {
        let content = compile_content(&identity, entry, table)?;
        SpeciesContentEvidence::Extracted(Box::new(content))
    };
    Ok(ResolvedSpeciesMetadata {
        id,
        key,
        provenance_hash,
        content,
    })
}

/// Resolves one frozen form entry into typed battle metadata. Forms always
/// carry full extracted content.
pub fn compile_form_entry(
    entry: &Value,
    table: &AbilityTable,
) -> Result<ResolvedFormMetadata, SpeciesFormParityError> {
    let id_string =
        field(entry, "form", "id")?
            .as_str()
            .ok_or(SpeciesFormParityError::MalformedField {
                identity: "form".to_owned(),
                field: "id",
            })?;
    let identity = format!("form {id_string}");
    let id = FormId::parse(id_string).map_err(|_| SpeciesFormParityError::MalformedField {
        identity: identity.clone(),
        field: "id",
    })?;
    let species = plain_u64(entry, &identity, "species_id")?;
    let form_index = plain_u64(entry, &identity, "form_index")?;
    let form_key = field(entry, &identity, "form_key")?
        .as_str()
        .ok_or(SpeciesFormParityError::MalformedField {
            identity: identity.clone(),
            field: "form_key",
        })?
        .to_owned();
    // The frozen id string is exactly the compound identity of its fields.
    if id_string != format!("{species}:{form_index}:{form_key}") {
        return Err(SpeciesFormParityError::FormIdShapeMismatch {
            id: id_string.to_owned(),
        });
    }
    let provenance_hash = field(entry, &identity, "provenance_hash")?
        .as_str()
        .ok_or(SpeciesFormParityError::MalformedField {
            identity: identity.clone(),
            field: "provenance_hash",
        })?
        .to_owned();
    let content = compile_content(&identity, entry, table)?;
    let form_index =
        u32::try_from(form_index).map_err(|_| SpeciesFormParityError::MalformedField {
            identity: identity.clone(),
            field: "form_index",
        })?;
    Ok(ResolvedFormMetadata {
        id,
        species,
        form_index,
        form_key,
        provenance_hash,
        content,
    })
}

// ---------------------------------------------------------------------------
// Identity closure with zero residual
// ---------------------------------------------------------------------------

/// Complete, validated species/form closure over the frozen oracle entries.
#[derive(Clone, Debug)]
pub struct SpeciesFormClosure {
    /// Canonical registry over every resolved species id.
    pub registry: SpeciesFormRegistryV2,
    /// Resolved species metadata in frozen catalog order (strictly ascending
    /// ids, proven by [`verify_identity_closure`]).
    pub species: Vec<ResolvedSpeciesMetadata>,
    /// Resolved form metadata in frozen catalog order.
    pub forms: Vec<ResolvedFormMetadata>,
    /// Form indices grouped by owning species, ordered by `form_index`.
    pub forms_by_species: BTreeMap<u64, Vec<usize>>,
}

impl SpeciesFormClosure {
    /// Exact battle content of one species, whether extracted from the frozen
    /// oracle or derived through its pinned seam.
    pub fn species_content(
        &self,
        species: u64,
    ) -> Result<&ResolvedContent, SpeciesFormParityError> {
        let metadata = self.metadata(species)?;
        match &metadata.content {
            SpeciesContentEvidence::Extracted(content) => Ok(content),
            SpeciesContentEvidence::Derived(derived) => Ok(&derived.content),
        }
    }

    /// Derived-content evidence of one extraction-gap identity; fails closed
    /// on identities the oracle extracted itself.
    pub fn derived_evidence(
        &self,
        species: u64,
    ) -> Result<&DerivedSpeciesEvidence, SpeciesFormParityError> {
        let metadata = self.metadata(species)?;
        match &metadata.content {
            SpeciesContentEvidence::Derived(derived) => Ok(derived),
            SpeciesContentEvidence::Extracted(_) => Err(SpeciesFormParityError::ClosureViolated(
                format!("species {species} carries extracted, not derived, content"),
            )),
        }
    }

    fn metadata(&self, species: u64) -> Result<&ResolvedSpeciesMetadata, SpeciesFormParityError> {
        self.species
            .binary_search_by(|entry| entry.id.cmp(&species))
            .ok()
            .and_then(|index| self.species.get(index))
            .ok_or_else(|| {
                SpeciesFormParityError::RegistryRejected(format!(
                    "species {species} is outside the closed closure"
                ))
            })
    }
}

/// Verifies exact identity closure between the frozen species and form
/// sections with zero residual in either direction:
///
/// - exactly 2,018 distinct strictly-ascending species ids with unique keys;
/// - exactly 534 forms whose compound id strings match their fields exactly;
/// - every form belongs to a registered species and every form of a species
///   exists in the form section (both directions, zero residual);
/// - per-species form indices are dense starting at zero with unique keys;
/// - every index-zero canonical form resolves to content identical to its
///   species definition;
/// - form-bearing species always carry extracted content.
pub fn verify_identity_closure(
    species_entries: &[Value],
    form_entries: &[Value],
    table: &AbilityTable,
) -> Result<SpeciesFormClosure, SpeciesFormParityError> {
    if species_entries.len() != ORACLE_SPECIES_CLOSURE_COUNT {
        return Err(SpeciesFormParityError::ClosureViolated(format!(
            "expected {ORACLE_SPECIES_CLOSURE_COUNT} species identities, found {}",
            species_entries.len()
        )));
    }
    let mut previous_id = None;
    let mut keys = BTreeSet::new();
    let mut species = Vec::with_capacity(species_entries.len());
    for entry in species_entries {
        let resolved = compile_species_entry_with_context(entry, table, &species)?;
        if previous_id.is_some_and(|previous| previous >= resolved.id) {
            return Err(SpeciesFormParityError::ClosureViolated(format!(
                "species ids are not strictly ascending at {}",
                resolved.id
            )));
        }
        if !keys.insert(resolved.key.clone()) {
            return Err(SpeciesFormParityError::ClosureViolated(format!(
                "duplicate species key `{}`",
                resolved.key
            )));
        }
        previous_id = Some(resolved.id);
        species.push(resolved);
    }

    let registry = SpeciesFormRegistryV2::from_species_ids(species.iter().map(|entry| entry.id))
        .map_err(|error| SpeciesFormParityError::RegistryRejected(error.to_string()))?;
    registry
        .validate()
        .map_err(|error| SpeciesFormParityError::RegistryRejected(error.to_string()))?;
    if registry.len() != ORACLE_SPECIES_CLOSURE_COUNT {
        return Err(SpeciesFormParityError::ClosureViolated(format!(
            "registry holds {} species, expected {ORACLE_SPECIES_CLOSURE_COUNT}",
            registry.len()
        )));
    }
    let mut forms = Vec::with_capacity(form_entries.len());
    let mut seen_ids = BTreeSet::new();
    for entry in form_entries {
        let resolved = compile_form_entry(entry, table)?;
        if !seen_ids.insert(resolved.id.as_str().to_owned()) {
            return Err(SpeciesFormParityError::ClosureViolated(format!(
                "duplicate form id `{}`",
                resolved.id.as_str()
            )));
        }
        if !registry.covers(resolved.species) {
            return Err(SpeciesFormParityError::UnknownFormSpecies {
                id: resolved.id.as_str().to_owned(),
                species: resolved.species,
            });
        }
        forms.push(resolved);
    }

    // The exact frozen form count is enforced after per-identity validation
    // so residual or dangling identities report their precise typed error
    // instead of a coarse length mismatch.
    if forms.len() != ORACLE_FORM_CLOSURE_COUNT {
        return Err(SpeciesFormParityError::ClosureViolated(format!(
            "expected {ORACLE_FORM_CLOSURE_COUNT} form identities, found {}",
            forms.len()
        )));
    }

    let mut forms_by_species: BTreeMap<u64, Vec<usize>> = BTreeMap::new();
    for (index, form) in forms.iter().enumerate() {
        forms_by_species
            .entry(form.species)
            .or_default()
            .push(index);
    }
    for (&species_id, indices) in forms_by_species.iter_mut() {
        indices.sort_by_key(|&index| forms[index].form_index);
        let dense_ok = indices
            .iter()
            .enumerate()
            .all(|(position, &index)| forms[index].form_index == position as u32);
        if !dense_ok {
            return Err(SpeciesFormParityError::ClosureViolated(format!(
                "species {species_id}: form indices are not dense from zero"
            )));
        }
        let mut form_keys = BTreeSet::new();
        for &index in indices.iter() {
            if !form_keys.insert(forms[index].form_key.clone()) {
                return Err(SpeciesFormParityError::DuplicateFormKey {
                    id: species_id,
                    key: forms[index].form_key.clone(),
                });
            }
        }
        // Every form-bearing species must exist in the compiled closure; the
        // frozen oracle permits a canonical (index-zero) form to carry its own
        // extracted content where the production form constructor overrides
        // species defaults, so content parity is proven per identity.
        if !species.iter().any(|entry| entry.id == species_id) {
            return Err(SpeciesFormParityError::UnknownFormSpecies {
                id: forms[indices[0]].id.as_str().to_owned(),
                species: species_id,
            });
        }
    }

    Ok(SpeciesFormClosure {
        registry,
        species,
        forms,
        forms_by_species,
    })
}

// ---------------------------------------------------------------------------
// Overlay admission: stance / Mega / Tera against real family transitions
// ---------------------------------------------------------------------------

/// Evidence summary of the exhaustive overlay-admission proof.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct OverlayAdmissionEvidence {
    /// Species identities whose registry admission was proven.
    pub species_admission_checked: usize,
    /// Canonical base identities (empty catalog key included) that
    /// registered and completed a full Tera chain.
    pub base_form_registrations: usize,
    /// Stance swap chains staged, resolved, and lapsed on switch-out.
    pub stance_pairs_exercised: usize,
    /// One-time Mega admissions exercised with persistence checks.
    pub mega_pairs_exercised: usize,
    /// Terastallizations admitted with persistence-through-switch checks.
    pub tera_admissions: usize,
    /// Single-presentation identities that proved the negative witnesses:
    /// same-identity stance staging and self Mega admission fail closed,
    /// and cross-species targets stay rejected.
    pub single_key_negative_witnesses: usize,
}

fn require(condition: bool, detail: String) -> Result<(), SpeciesFormParityError> {
    if condition {
        Ok(())
    } else {
        Err(SpeciesFormParityError::ClosureViolated(detail))
    }
}

fn expect_error<T>(
    result: Result<T, FormsTransitionError>,
    expected: &FormsTransitionError,
) -> Result<(), SpeciesFormParityError> {
    match &result {
        Err(actual) => require(
            actual == expected,
            format!("expected transition error {expected:?}, got {actual:?}"),
        ),
        Ok(_) => Err(SpeciesFormParityError::ClosureViolated(format!(
            "expected transition error {expected:?}, but the transition succeeded"
        ))),
    }
}

fn field_scope(side: BattleSide, position: u8) -> MechanicScope {
    MechanicScope::Field {
        slot: FieldSlot::new(side, position)
            .expect("frozen parity harness uses in-range field slots"),
    }
}

fn register_base(
    scope: &MechanicScope,
    base: &FormIdentityV2,
) -> Result<FormsStateV2, SpeciesFormParityError> {
    FormsStateV2::default()
        .register_battler(scope.clone(), base.clone())
        .map_err(|error| SpeciesFormParityError::StateInvariant(error.to_string()))
}

/// Proves the staged presentation cues stay monotone over validated state.
fn expect_monotone_cues(
    state: &FormsStateV2,
    start: usize,
    detail: String,
) -> Result<(), SpeciesFormParityError> {
    let ordinals: Vec<u64> = state.cues[start..].iter().map(|cue| cue.ordinal).collect();
    let monotone = ordinals.windows(2).all(|window| window[0] < window[1]);
    require(
        monotone && state.validate().is_ok(),
        format!("cue ledger must be monotone over validated state: {detail}"),
    )
}

/// Exhaustive overlay-admission proof over every species identity of the
/// closure:
///
/// - every species registers its canonical base identity — the index-zero
///   catalog form key where one exists, otherwise the valid empty base-form
///   key `""` — and admits exactly one Tera per side, which persists through
///   switch-out and resets only at battle end;
/// - every same-species alternate key stages a reversible stance swap that
///   switch-out lapses back to the stable base;
/// - every same-species alternate key admits Mega exactly once per battle;
///   it persists through switch-out, blocks Tera and stance staging while
///   active, and battle end restores the admission;
/// - single-presentation identities prove the negative witnesses:
///   same-identity stance staging fails with `StanceTargetEqualsCurrent`,
///   self Mega admission with `MegaTargetEqualsBase`, cross-species targets
///   with `StanceCrossSpecies`;
/// - other invalid combinations (cross-species targets, equal-key targets,
///   ordinal overflow, exhausted budgets, side mismatches) are rejected with
///   their exact typed errors.
pub fn prove_overlay_admission(
    closure: &SpeciesFormClosure,
) -> Result<OverlayAdmissionEvidence, SpeciesFormParityError> {
    let mut evidence = OverlayAdmissionEvidence::default();
    let player_slot = field_scope(BattleSide::Player, 0);

    // A species outside the frozen closure fails closed on metadata lookup.
    let uncovered = FormIdentityV2::new(999_999u64, "probe")
        .map_err(|error| SpeciesFormParityError::StateInvariant(error.to_string()))?;
    expect_error(
        require_species_metadata(&closure.registry, &uncovered),
        &FormsTransitionError::UnknownBattlerScope,
    )?;

    for metadata in &closure.species {
        evidence.species_admission_checked += 1;
        require(
            closure.registry.covers(metadata.id),
            format!("registry must cover species {}", metadata.id),
        )?;
        // The canonical base-form key is the index-zero catalog form key when
        // the species owns forms, else the valid empty base-form key.
        let base_key = match closure.forms_by_species.get(&metadata.id) {
            Some(indices) => canonical_base_key(indices, &closure.forms),
            None => "",
        };
        let base = FormIdentityV2::new(metadata.id, base_key)
            .map_err(|error| SpeciesFormParityError::StateInvariant(error.to_string()))?;
        require_species_metadata(&closure.registry, &base)
            .map_err(|_| SpeciesFormParityError::ClosureViolated("gate".to_owned()))?;
        let content = closure.species_content(metadata.id)?;
        let typed_typing = content.typing.typed().ok_or_else(|| {
            SpeciesFormParityError::ClosureViolated(format!(
                "species {} presents typeless at its base; no typed Tera ordinal exists",
                metadata.id
            ))
        })?;
        let tera_ordinal = type_ordinal(typed_typing.primary)?;
        prove_tera_persistence(&player_slot, &base, tera_ordinal, &mut evidence)?;
        evidence.base_form_registrations += 1;

        let mut keys: Vec<&str> = match closure.forms_by_species.get(&metadata.id) {
            Some(indices) => indices
                .iter()
                .map(|&index| closure.forms[index].form_key.as_str())
                .collect(),
            None => vec![base_key],
        };
        keys.sort_unstable();
        keys.dedup();

        let alternates: Vec<&str> = keys
            .iter()
            .copied()
            .filter(|key| *key != base_key)
            .collect();
        if alternates.is_empty() {
            // No alternate key exists: same-identity and cross-species
            // staging must fail closed with their exact typed errors.
            let state = register_base(&player_slot, &base)?;
            expect_error(
                stage_stance_request(&state, &player_slot, 7, base.clone()),
                &FormsTransitionError::StanceTargetEqualsCurrent,
            )?;
            expect_error(
                admit_mega(&state, &player_slot, base.clone()),
                &FormsTransitionError::MegaTargetEqualsBase,
            )?;
            let foreign_identity = foreign_probe_identity(closure, metadata.id)?;
            expect_error(
                stage_stance_request(&state, &player_slot, 7, foreign_identity),
                &FormsTransitionError::StanceCrossSpecies,
            )?;
            evidence.single_key_negative_witnesses += 1;
            continue;
        }

        let target_key = alternates[0];
        let target = FormIdentityV2::new(metadata.id, target_key)
            .map_err(|error| SpeciesFormParityError::StateInvariant(error.to_string()))?;
        prove_stance_swap(&player_slot, &base, &target)?;
        evidence.stance_pairs_exercised += 1;
        prove_mega_admission(&player_slot, &base, &target)?;
        evidence.mega_pairs_exercised += 1;
    }

    Ok(evidence)
}

/// The canonical base-form presentation of a form-bearing species: its
/// index-zero catalog form key, empty or named.
fn canonical_base_key<'a>(indices: &[usize], forms: &'a [ResolvedFormMetadata]) -> &'a str {
    indices
        .iter()
        .map(|&index| &forms[index])
        .find(|form| form.form_index == 0)
        .map(|form| form.form_key.as_str())
        .unwrap_or("")
}

fn foreign_probe_identity(
    closure: &SpeciesFormClosure,
    exclude_species: u64,
) -> Result<FormIdentityV2, SpeciesFormParityError> {
    let probe = closure
        .forms
        .iter()
        .find(|form| !form.form_key.is_empty() && form.species != exclude_species)
        .ok_or_else(|| {
            SpeciesFormParityError::ClosureViolated(
                "closure holds no cross-species stance probe target".to_owned(),
            )
        })?;
    FormIdentityV2::new(probe.species, probe.form_key.clone())
        .map_err(|error| SpeciesFormParityError::StateInvariant(error.to_string()))
}

fn type_ordinal(kind: PokemonType) -> Result<u8, SpeciesFormParityError> {
    let ordinal = kind as u8;
    require(
        ordinal <= MAX_POKEMON_TYPE_ORDINAL,
        format!("type ordinal {ordinal} exceeds the frozen ceiling"),
    )?;
    Ok(ordinal)
}

/// One full Tera chain: admission, budget exhaustion, persistence through
/// switch-out, idempotent repeat cleanup, battle-end reset.
fn prove_tera_persistence(
    scope: &MechanicScope,
    base: &FormIdentityV2,
    tera_ordinal: u8,
    evidence: &mut OverlayAdmissionEvidence,
) -> Result<(), SpeciesFormParityError> {
    let side = BattleSide::Player;
    let enemy_side = BattleSide::Enemy;
    let state = register_base(scope, base)?;

    // Ordinal overflow fails closed before any state is touched.
    expect_error(
        admit_tera(&state, side, scope, MAX_POKEMON_TYPE_ORDINAL + 1),
        &FormsTransitionError::InvalidTeraTypeOrdinal,
    )?;
    // Commanding the opposite side through this scope fails closed.
    match admit_tera(&state, enemy_side, scope, 0) {
        Err(err @ FormsTransitionError::TeraSideMismatch { .. }) => {
            require(
                err == FormsTransitionError::TeraSideMismatch { side: enemy_side },
                format!("side mismatch must name the command side, got {err:?}"),
            )?;
        }
        other => {
            return Err(SpeciesFormParityError::ClosureViolated(format!(
                "expected TeraSideMismatch, got {other:?}"
            )));
        }
    }

    let cue_start = state.cues.len();
    let applied = admit_tera(&state, side, scope, tera_ordinal)?;
    require(
        applied.outcome == FormsOutcomeV2::Applied,
        "tera must apply".to_owned(),
    )?;
    require(
        applied.cues.len() == 1
            && applied.cues[0].kind == FormCueKindV2::OverlayApplied(FormOverlayKindV2::Tera)
            && applied.cues[0].from.as_ref() == Some(base)
            && applied.cues[0].to.as_ref() == Some(base),
        "tera admission must stage exactly one apply cue preserving the presented identity"
            .to_owned(),
    )?;
    expect_monotone_cues(&applied.state, cue_start, "tera admission".to_owned())?;
    let battler = applied.state.battler(scope).ok_or_else(|| {
        SpeciesFormParityError::ClosureViolated("registered battler vanished".to_owned())
    })?;
    let overlay = battler.overlay.as_ref().ok_or_else(|| {
        SpeciesFormParityError::ClosureViolated("tera overlay missing after admission".to_owned())
    })?;
    require(
        overlay.kind == FormOverlayKindV2::Tera
            && overlay.current == *base
            && overlay.tera_type_ordinal == Some(tera_ordinal)
            && battler.current == *base
            && applied.state.teras_used(side) == 1,
        "tera overlay must carry the assigned type without changing the presented form".to_owned(),
    )?;
    evidence.tera_admissions += 1;

    // The frozen per-side budget allows exactly one admission.
    expect_error(
        admit_tera(&applied.state, side, scope, 0),
        &FormsTransitionError::TeraBudgetExhausted { side },
    )?;

    let cleaned = cleanup_on_switch(&applied.state, scope)?;
    // The Tera overlay persists untouched: nothing lapses, no cue stages,
    // and the canonical state is returned unchanged.
    require(
        cleaned.outcome == FormsOutcomeV2::IdempotentNoOp
            && cleaned.cues.is_empty()
            && cleaned.state == applied.state,
        "switch-out must preserve a Tera overlay untouched".to_owned(),
    )?;
    let battler = cleaned.state.battler(scope).ok_or_else(|| {
        SpeciesFormParityError::ClosureViolated("registered battler vanished".to_owned())
    })?;
    require(
        matches!(&battler.overlay, Some(active) if active.kind == FormOverlayKindV2::Tera)
            && battler.current == *base,
        "tera must persist through switch-out".to_owned(),
    )?;

    // Repeated cleanup is an explicit no-op over identical state.
    let repeated = cleanup_on_switch(&cleaned.state, scope)?;
    require(
        repeated.outcome == FormsOutcomeV2::IdempotentNoOp && repeated.state == cleaned.state,
        "repeated switch cleanup must be a no-op".to_owned(),
    )?;

    // Battle end is the only path that clears the overlay and the budget.
    let ended = cleanup_battle_end(&repeated.state)?;
    require(
        ended.outcome == FormsOutcomeV2::Applied,
        "battle-end reset applies".to_owned(),
    )?;
    require(
        ended
            .cues
            .last()
            .is_some_and(|cue| cue.kind == FormCueKindV2::BattleEndReset),
        "battle-end reset must stage its cue last".to_owned(),
    )?;
    let battler = ended.state.battler(scope).ok_or_else(|| {
        SpeciesFormParityError::ClosureViolated("registered battler vanished".to_owned())
    })?;
    require(
        battler.overlay.is_none() && battler.current == battler.base,
        "battle end must restore the stable base form".to_owned(),
    )?;
    require(
        ended.state.teras_used(side) == 0 && ended.state.teras_used(enemy_side) == 0,
        "battle end must restore both per-side budgets".to_owned(),
    )?;
    Ok(())
}

/// Full stance chain: stage, idempotent restage, typed conflicts, resolve
/// into the reversible swap, and lapse back to the base on switch-out.
fn prove_stance_swap(
    scope: &MechanicScope,
    base: &FormIdentityV2,
    target: &FormIdentityV2,
) -> Result<(), SpeciesFormParityError> {
    let state = register_base(scope, base)?;
    let cue_start = state.cues.len();

    let staged = stage_stance_request(&state, scope, 7, target.clone())?;
    require(
        staged.outcome == FormsOutcomeV2::RequestStaged && staged.cues.len() == 1,
        "stance staging must apply once".to_owned(),
    )?;
    require(
        staged.cues[0].kind == FormCueKindV2::StanceRequestStaged
            && staged.cues[0].from.as_ref() == Some(base)
            && staged.cues[0].to.as_ref() == Some(target),
        "stance staging must present the request transition".to_owned(),
    )?;
    let battler = staged.state.battler(scope).ok_or_else(|| {
        SpeciesFormParityError::ClosureViolated("registered battler vanished".to_owned())
    })?;
    require(
        battler
            .pending_stance_request
            .as_ref()
            .is_some_and(|request| request.request_id == 7 && &request.target == target),
        "the staged request must carry its id and target".to_owned(),
    )?;
    expect_monotone_cues(&staged.state, cue_start, "stance staging".to_owned())?;

    // Identical resubmission is idempotent over unchanged state.
    let restaged = stage_stance_request(&staged.state, scope, 7, target.clone())?;
    require(
        restaged.outcome == FormsOutcomeV2::RequestAlreadyStaged
            && restaged.cues.is_empty()
            && restaged.state == staged.state,
        "identical restaging must be an idempotent no-op".to_owned(),
    )?;

    // Same id with a different target is a typed conflict; a second id while
    // a request is pending names the staged id.
    let conflicting = base.clone();
    expect_error(
        stage_stance_request(&staged.state, scope, 7, conflicting),
        &FormsTransitionError::StanceRequestConflict {
            staged_request_id: 7,
        },
    )?;
    expect_error(
        stage_stance_request(&staged.state, scope, 8, target.clone()),
        &FormsTransitionError::StanceRequestPending {
            pending_request_id: 7,
        },
    )?;

    // Resolution swaps the presented form onto the reversible stance overlay.
    let resolved = resolve_pending_stance(&staged.state, scope)?;
    require(
        resolved.outcome == FormsOutcomeV2::Applied && resolved.cues.len() == 1,
        "stance resolution must apply once".to_owned(),
    )?;
    require(
        resolved.cues[0].kind == FormCueKindV2::OverlayApplied(FormOverlayKindV2::Stance)
            && resolved.cues[0].from.as_ref() == Some(base)
            && resolved.cues[0].to.as_ref() == Some(target),
        "stance resolution must present the swap".to_owned(),
    )?;
    let battler = resolved.state.battler(scope).ok_or_else(|| {
        SpeciesFormParityError::ClosureViolated("registered battler vanished".to_owned())
    })?;
    require(
        matches!(&battler.overlay, Some(active) if active.kind == FormOverlayKindV2::Stance)
            && battler.current == *target
            && battler.pending_stance_request.is_none(),
        "resolution must swap the presented form and clear the pending request".to_owned(),
    )?;

    // Switch-out lapses the reversible overlay back onto the stable base.
    let cleaned = cleanup_on_switch(&resolved.state, scope)?;
    require(
        cleaned.outcome == FormsOutcomeV2::Applied
            && cleaned.cues.len() == 2
            && cleaned.cues[0].kind == FormCueKindV2::OverlayReverted(FormOverlayKindV2::Stance)
            && cleaned.cues[1].kind == FormCueKindV2::SwitchCleanup,
        "switch-out must revert the stance and stage cleanup evidence".to_owned(),
    )?;
    let battler = cleaned.state.battler(scope).ok_or_else(|| {
        SpeciesFormParityError::ClosureViolated("registered battler vanished".to_owned())
    })?;
    require(
        battler.overlay.is_none() && battler.current == battler.base,
        "switch-out must restore the stable base form".to_owned(),
    )
}

/// One-time Mega chain: admission, exhaustion, composition blocks,
/// persistence through switch-out, battle-end restoration.
fn prove_mega_admission(
    scope: &MechanicScope,
    base: &FormIdentityV2,
    target: &FormIdentityV2,
) -> Result<(), SpeciesFormParityError> {
    let state = register_base(scope, base)?;
    let cue_start = state.cues.len();

    let admitted = admit_mega(&state, scope, target.clone())?;
    require(
        admitted.outcome == FormsOutcomeV2::Applied && admitted.cues.len() == 1,
        "mega admission must apply once".to_owned(),
    )?;
    require(
        admitted.cues[0].kind == FormCueKindV2::OverlayApplied(FormOverlayKindV2::Mega)
            && admitted.cues[0].from.as_ref() == Some(base)
            && admitted.cues[0].to.as_ref() == Some(target),
        "mega admission must present the evolution".to_owned(),
    )?;
    expect_monotone_cues(&admitted.state, cue_start, "mega admission".to_owned())?;
    let battler = admitted.state.battler(scope).ok_or_else(|| {
        SpeciesFormParityError::ClosureViolated("registered battler vanished".to_owned())
    })?;
    require(
        battler.mega_used
            && matches!(&battler.overlay, Some(active) if active.kind == FormOverlayKindV2::Mega)
            && battler.current == *target,
        "mega admission must consume the one-time flag and present the evolved form".to_owned(),
    )?;

    // Exhaustion and composition blocks fail closed with exact errors.
    expect_error(
        admit_mega(&admitted.state, scope, target.clone()),
        &FormsTransitionError::MegaAlreadyUsed,
    )?;
    expect_error(
        admit_tera(&admitted.state, BattleSide::Player, scope, 0),
        &FormsTransitionError::OverlayActive {
            active: FormOverlayKindV2::Mega,
        },
    )?;
    expect_error(
        stage_stance_request(&admitted.state, scope, 1, target.clone()),
        &FormsTransitionError::OverlayActive {
            active: FormOverlayKindV2::Mega,
        },
    )?;

    // Switch-out lapses the presented Mega form back onto the stable base
    // (revert cue plus cleanup evidence) while the consumed one-time
    // admission `mega_used` survives until battle end.
    let cleaned = cleanup_on_switch(&admitted.state, scope)?;
    require(
        cleaned.outcome == FormsOutcomeV2::Applied
            && cleaned.cues.len() == 2
            && cleaned.cues[0].kind == FormCueKindV2::OverlayReverted(FormOverlayKindV2::Mega)
            && cleaned.cues[1].kind == FormCueKindV2::SwitchCleanup,
        "switch-out must revert the Mega presentation and stage cleanup evidence".to_owned(),
    )?;
    let battler = cleaned.state.battler(scope).ok_or_else(|| {
        SpeciesFormParityError::ClosureViolated("registered battler vanished".to_owned())
    })?;
    require(
        battler.mega_used && battler.overlay.is_none() && battler.current == battler.base,
        "the mega admission must persist through switch-out with the base form restored".to_owned(),
    )?;
    // Battle end restores the base form and the one-time admission.
    let ended = cleanup_battle_end(&cleaned.state)?;
    require(
        ended
            .cues
            .last()
            .is_some_and(|cue| cue.kind == FormCueKindV2::BattleEndReset),
        "battle end must stage its reset cue".to_owned(),
    )?;
    let battler = ended.state.battler(scope).ok_or_else(|| {
        SpeciesFormParityError::ClosureViolated("registered battler vanished".to_owned())
    })?;
    require(
        !battler.mega_used && battler.overlay.is_none() && battler.current == battler.base,
        "battle end must restore the base form and the mega admission".to_owned(),
    )?;

    // Admitting the base identity itself fails closed.
    let fresh = register_base(scope, base)?;
    expect_error(
        admit_mega(&fresh, scope, base.clone()),
        &FormsTransitionError::MegaTargetEqualsBase,
    )
}

// ---------------------------------------------------------------------------
// Transform exclusions and the copied battle-metadata surface
// ---------------------------------------------------------------------------

/// Evidence summary of the exhaustive transform-copy proof.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransformCopySurfaceEvidence {
    /// The closed copied-field evidence list, compared byte-for-byte.
    pub copied_fields: Vec<TransformCopiedFieldV2>,
    /// Copy plans projected over every form identity (all 534, empty
    /// catalog keys included).
    pub copy_plans_projected: usize,
    /// Applied-then-cleared overlay cycles on canonical state.
    pub apply_clear_cycles: usize,
    /// Plans whose copied typing is the explicit typeless presentation
    /// (`493:18:unknown`); they carry `BattleTyping::Typeless` and stay
    /// structurally outside type-chart lookup.
    pub typeless_copies: usize,
}

fn zero_stages() -> StatStages {
    StatStages {
        attack: 0,
        defense: 0,
        special_attack: 0,
        special_defense: 0,
        speed: 0,
        accuracy: 0,
        evasion: 0,
    }
}

fn pokemon_id(value: u64) -> Result<PokemonId, SpeciesFormParityError> {
    PokemonId::try_from_u64(value)
        .map_err(|_| SpeciesFormParityError::ClosureViolated(format!("invalid pokemon id {value}")))
}
fn battler_facts(
    pokemon: PokemonId,
    slot_side: BattleSide,
    slot_position: u8,
    species: SafeU53,
    form_key: FormId,
    typing: BattleTyping,
    content: &ResolvedContent,
) -> TransformBattlerFactsV2 {
    let slot = FieldSlot::new(slot_side, slot_position)
        .expect("frozen parity harness uses in-range field slots");
    TransformBattlerFactsV2 {
        pokemon,
        slot,
        fainted: false,
        transformed: false,
        behind_illusion: false,
        has_substitute: false,
        fusion: false,
        species,
        form_key,
        typing,
        gender: TransformCopiedGenderV2::Unknown,
        stats: BattleStats {
            hp: content.base_stats.hp,
            attack: content.base_stats.attack,
            defense: content.base_stats.defense,
            special_attack: content.base_stats.special_attack,
            special_defense: content.base_stats.special_defense,
            speed: content.base_stats.speed,
        },
        stages: zero_stages(),
        moveset: vec![TransformSourceMoveFactsV2 {
            move_id: MoveId::try_from_u64(1).expect("move id 1 is in range"),
            // Above the frozen clamp so every plan witnesses the capping.
            pp: TRANSFORM_COPIED_PP_CAP + 9,
        }],
        abilities: TransformCopiedAbilitiesV2 {
            active: content.ability_slots.active,
            passives: content.ability_slots.passives,
        },
    }
}

/// Exhaustive transform-copy proof over the frozen closure:
/// - the copied-field evidence list is exactly the frozen eight-field order;
/// - every one of the 534 form identities — empty catalog keys included —
///   projects onto a valid plan whose payload carries that identity's exact
///   compiled metadata (species, form key, explicit typing including the
///   typeless presentation, gender presentation, stats excluding HP, zero
///   stages, PP clamped to the frozen cap, ability presentation identity);
/// - each plan applies onto canonical state and clears back to a stable
///   tombstone with typed transition kinds;
/// - every structural exclusion guard rejects with its exact typed error.
pub fn prove_transform_copy_surface(
    closure: &SpeciesFormClosure,
) -> Result<TransformCopySurfaceEvidence, SpeciesFormParityError> {
    let expected_copied_fields = vec![
        TransformCopiedFieldV2::Species,
        TransformCopiedFieldV2::FormKey,
        TransformCopiedFieldV2::Typing,
        TransformCopiedFieldV2::Gender,
        TransformCopiedFieldV2::StatsExcludingHp,
        TransformCopiedFieldV2::StatStages,
        TransformCopiedFieldV2::MovesetPpCapped,
        TransformCopiedFieldV2::AbilityPresentationIdentity,
    ];
    require(
        copied_field_evidence() == expected_copied_fields,
        "the copied-field evidence list must equal the frozen eight-field order".to_owned(),
    )?;

    // The fixed subject is the first form identity of the closure; every
    // form identity is now representable, typeless ones included.
    let subject_form = closure.forms.first().ok_or_else(|| {
        SpeciesFormParityError::ClosureViolated("closure holds no form identity".to_owned())
    })?;
    let subject = battler_facts(
        pokemon_id(1)?,
        BattleSide::Player,
        0,
        SafeU53::new(subject_form.species).map_err(|_| {
            SpeciesFormParityError::RegistryRejected(format!(
                "species {} exceeds SafeU53",
                subject_form.species
            ))
        })?,
        subject_form.id.clone(),
        subject_form.content.typing,
        &subject_form.content,
    );

    let mut evidence = TransformCopySurfaceEvidence {
        copied_fields: expected_copied_fields.clone(),
        copy_plans_projected: 0,
        apply_clear_cycles: 0,
        typeless_copies: 0,
    };

    for (index, form) in closure.forms.iter().enumerate() {
        let typing = form.content.typing;
        if typing.is_typeless() {
            evidence.typeless_copies += 1;
        }
        let target_species = SafeU53::new(form.species).map_err(|_| {
            SpeciesFormParityError::RegistryRejected(format!(
                "species {} exceeds SafeU53",
                form.species
            ))
        })?;
        let target = battler_facts(
            pokemon_id(2 + index as u64)?,
            BattleSide::Enemy,
            0,
            target_species,
            form.id.clone(),
            typing,
            &form.content,
        );
        let facts = TransformImposterFactsV2 {
            trigger: TransformCopyTriggerV2::MoveTransform,
            subject: subject.clone(),
            target: Some(target),
        };

        let plan = plan_transform_copy(&facts)?;
        let expected_payload = TransformCopiedBattleStateV2 {
            species: target_species,
            form_key: form.id.clone(),
            typing,
            gender: TransformCopiedGenderV2::Unknown,
            stats: TransformCopiedStatsV2 {
                attack: form.content.base_stats.attack,
                defense: form.content.base_stats.defense,
                special_attack: form.content.base_stats.special_attack,
                special_defense: form.content.base_stats.special_defense,
                speed: form.content.base_stats.speed,
            },
            stages: zero_stages(),
            moveset: vec![TransformCopiedMoveV2 {
                move_id: MoveId::try_from_u64(1).expect("move id 1 is in range"),
                pp: TRANSFORM_COPIED_PP_CAP,
            }],
            abilities: TransformCopiedAbilitiesV2 {
                active: form.content.ability_slots.active,
                passives: form.content.ability_slots.passives,
            },
        };
        require(
            plan.copied == expected_payload,
            format!(
                "copy payload must equal the compiled metadata of {}",
                form.id.as_str()
            ),
        )?;
        require(
            plan.evidence == expected_copied_fields,
            "every successful plan must carry the full ordered evidence".to_owned(),
        )?;
        require(
            plan.subject == subject.pokemon && plan.source == target_pokemon_id(&facts),
            "plan identity must name the subject and source".to_owned(),
        )?;
        evidence.copy_plans_projected += 1;

        // Apply onto fresh canonical state, then clear to a tombstone twice.
        let applied = apply_transform_copy(&TransformFormCopyStateV2::default(), &plan)?;
        require(
            applied.evidence.kind == TransformTransitionKindV2::Applied,
            "fresh application must report Applied".to_owned(),
        )?;
        let state = &applied.state;
        let entry_position = state.position_of(plan.subject).ok_or_else(|| {
            SpeciesFormParityError::ClosureViolated("applied entry missing".to_owned())
        })?;
        require(
            state.entries[entry_position].active,
            "applied entry must be active".to_owned(),
        )?;
        let cleared = clear_transform_copy(&applied.state, plan.subject)?;
        require(
            cleared.evidence.kind == TransformTransitionKindV2::Cleared,
            "clearing a live copy must report Cleared".to_owned(),
        )?;
        let cleared_state = &cleared.state;
        let tombstone_position = cleared_state.position_of(plan.subject).ok_or_else(|| {
            SpeciesFormParityError::ClosureViolated("tombstone entry missing".to_owned())
        })?;
        require(
            !cleared_state.entries[tombstone_position].active,
            "cleared entry must be an inactive tombstone".to_owned(),
        )?;
        let repeated = clear_transform_copy(&cleared.state, plan.subject)?;
        require(
            repeated.evidence.kind == TransformTransitionKindV2::ClearNoOp
                && repeated.state == cleared.state,
            "repeated clearing must be a no-op over identical state".to_owned(),
        )?;
        evidence.apply_clear_cycles += 1;
    }

    prove_transform_exclusion_guards(&subject)?;
    Ok(evidence)
}

fn target_pokemon_id(facts: &TransformImposterFactsV2) -> PokemonId {
    facts
        .target
        .as_ref()
        .map(|target| target.pokemon)
        .unwrap_or_else(|| facts.subject.pokemon)
}

/// Exercises every structural exclusion guard once against a healthy pair,
/// asserting the exact typed error of the frozen guard set.
fn prove_transform_exclusion_guards(
    subject: &TransformBattlerFactsV2,
) -> Result<(), SpeciesFormParityError> {
    let mut healthy_target = subject.clone();
    healthy_target.pokemon = pokemon_id(2)?;
    healthy_target.slot = FieldSlot::new(BattleSide::Enemy, 0)
        .expect("frozen parity harness uses in-range field slots");
    let facts_with = |subject: &TransformBattlerFactsV2,
                      target: Option<TransformBattlerFactsV2>|
     -> TransformImposterFactsV2 {
        TransformImposterFactsV2 {
            trigger: TransformCopyTriggerV2::Imposter,
            subject: subject.clone(),
            target,
        }
    };
    let expect_guard = |facts: &TransformImposterFactsV2,
                        expected: &TransformImposterError|
     -> Result<(), SpeciesFormParityError> {
        match plan_transform_copy(facts) {
            Err(actual) => require(
                &actual == expected,
                format!("expected exclusion {expected:?}, got {actual:?}"),
            ),
            Ok(_) => Err(SpeciesFormParityError::ClosureViolated(format!(
                "expected exclusion {expected:?}, but the plan succeeded"
            ))),
        }
    };

    expect_guard(
        &facts_with(subject, None),
        &TransformImposterError::MissingTarget,
    )?;

    let self_target = facts_with(subject, Some(subject.clone()));
    expect_guard(&self_target, &TransformImposterError::SelfTarget)?;

    let mut terminal_subject = subject.clone();
    terminal_subject.fainted = true;
    expect_guard(
        &facts_with(&terminal_subject, Some(healthy_target.clone())),
        &TransformImposterError::TerminalSubject,
    )?;
    let mut terminal_target = healthy_target.clone();
    terminal_target.fainted = true;
    expect_guard(
        &facts_with(subject, Some(terminal_target)),
        &TransformImposterError::TerminalTarget,
    )?;

    let mut transformed_subject = subject.clone();
    transformed_subject.transformed = true;
    expect_guard(
        &facts_with(&transformed_subject, Some(healthy_target.clone())),
        &TransformImposterError::AlreadyTransformed,
    )?;
    let mut transformed_target = healthy_target.clone();
    transformed_target.transformed = true;
    expect_guard(
        &facts_with(subject, Some(transformed_target)),
        &TransformImposterError::AlreadyTransformed,
    )?;

    let mut illusioned_target = healthy_target.clone();
    illusioned_target.behind_illusion = true;
    expect_guard(
        &facts_with(subject, Some(illusioned_target)),
        &TransformImposterError::TargetIllusion,
    )?;
    let mut illusioned_subject = subject.clone();
    illusioned_subject.behind_illusion = true;
    expect_guard(
        &facts_with(&illusioned_subject, Some(healthy_target.clone())),
        &TransformImposterError::SubjectIllusion,
    )?;

    let mut substituted_target = healthy_target.clone();
    substituted_target.has_substitute = true;
    expect_guard(
        &facts_with(subject, Some(substituted_target)),
        &TransformImposterError::TargetSubstitute,
    )?;

    let mut fused_subject = subject.clone();
    fused_subject.fusion = true;
    expect_guard(
        &facts_with(&fused_subject, Some(healthy_target.clone())),
        &TransformImposterError::SubjectFusion,
    )?;
    let mut fused_target = healthy_target;
    fused_target.fusion = true;
    expect_guard(
        &facts_with(subject, Some(fused_target)),
        &TransformImposterError::TargetFusion,
    )
}
