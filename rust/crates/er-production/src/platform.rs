use serde::{Deserialize, Serialize};

use crate::{ProductionContractErrorV1, valid_sha256, validate_identifier};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlatformApiVersionSetV1 {
    pub schema_version: u32,
    pub save_api: u32,
    pub telemetry_api: u32,
    pub signaling_api: u32,
    pub showdown_api: u32,
    pub achievement_api: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthenticatedPlatformContextV1 {
    pub schema_version: u32,
    pub pseudonymous_account_id: String,
    pub entitlements_digest: String,
    pub server_api_versions: PlatformApiVersionSetV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileResultEnvelopeV1 {
    pub schema_version: u32,
    pub pseudonymous_account_id: String,
    pub release_id: String,
    pub profile_bytes: Vec<u8>,
    pub profile_sha256: String,
    pub achievement_result_bytes: Vec<u8>,
    pub achievement_result_sha256: String,
}

impl PlatformApiVersionSetV1 {
    pub fn validate(&self) -> Result<(), ProductionContractErrorV1> {
        if self.schema_version != 1
            || self.save_api == 0
            || self.telemetry_api == 0
            || self.signaling_api == 0
            || self.showdown_api == 0
            || self.achievement_api == 0
        {
            return Err(ProductionContractErrorV1::Schema);
        }
        Ok(())
    }
}

impl AuthenticatedPlatformContextV1 {
    pub fn validate(&self) -> Result<(), ProductionContractErrorV1> {
        if self.schema_version != 1 || !valid_sha256(&self.entitlements_digest) {
            return Err(ProductionContractErrorV1::Identifier("platform context"));
        }
        validate_identifier(&self.pseudonymous_account_id, "pseudonymous account")?;
        self.server_api_versions.validate()
    }
}

impl ProfileResultEnvelopeV1 {
    pub fn validate(&self) -> Result<(), ProductionContractErrorV1> {
        validate_identifier(&self.pseudonymous_account_id, "profile account")?;
        validate_identifier(&self.release_id, "profile release")?;
        if self.schema_version != 1
            || self.profile_bytes.is_empty()
            || self.achievement_result_bytes.is_empty()
            || !valid_sha256(&self.profile_sha256)
            || !valid_sha256(&self.achievement_result_sha256)
        {
            return Err(ProductionContractErrorV1::Identifier(
                "profile result envelope",
            ));
        }
        Ok(())
    }
}
