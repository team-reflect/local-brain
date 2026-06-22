//! The CLI's error type and its mapping to stable process exit codes. Keeping
//! both in one place lets every command return `Result<_, CliError>` and lets
//! `main` translate a failure into the right exit code without per-command glue.

/// CLI failures, mapped to stable exit codes. Data goes to stdout; every error
/// here is printed to stderr by `main`.
#[derive(Debug)]
pub enum CliError {
    /// IO / SQL / runtime failure (exit 1).
    Runtime(String),
    /// A source-scoped external identity points at an active record whose own
    /// identity fields conflict with the incoming import (exit 1).
    ExternalIdentityConflict {
        message: String,
        existing_record_id: String,
        conflicting_fields: Vec<String>,
    },
    /// A requested record was not found (exit 3). Reserved for Plan 07 commands.
    #[allow(dead_code)]
    NotFound(String),
    /// The database is missing or unusable (exit 4).
    NoDatabase(String),
}

impl CliError {
    pub fn exit_code(&self) -> u8 {
        match self {
            CliError::Runtime(_) => 1,
            CliError::ExternalIdentityConflict { .. } => 1,
            CliError::NotFound(_) => 3,
            CliError::NoDatabase(_) => 4,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            CliError::Runtime(_) => "runtime",
            CliError::ExternalIdentityConflict { .. } => "external_identity_conflict",
            CliError::NotFound(_) => "not_found",
            CliError::NoDatabase(_) => "no_database",
        }
    }

    pub fn external_identity_conflict(
        existing_record_id: impl Into<String>,
        conflicting_fields: Vec<String>,
    ) -> Self {
        let existing_record_id = existing_record_id.into();
        let fields = conflicting_fields.join(", ");
        CliError::ExternalIdentityConflict {
            message: format!(
                "external identity already belongs to active record {existing_record_id} with conflicting fields: {fields}"
            ),
            existing_record_id,
            conflicting_fields,
        }
    }

    pub fn existing_record_id(&self) -> Option<&str> {
        match self {
            CliError::ExternalIdentityConflict {
                existing_record_id, ..
            } => Some(existing_record_id),
            _ => None,
        }
    }

    pub fn conflicting_fields(&self) -> Option<&[String]> {
        match self {
            CliError::ExternalIdentityConflict {
                conflicting_fields, ..
            } => Some(conflicting_fields),
            _ => None,
        }
    }
}

impl std::fmt::Display for CliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CliError::Runtime(message)
            | CliError::ExternalIdentityConflict { message, .. }
            | CliError::NotFound(message)
            | CliError::NoDatabase(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for CliError {}

impl From<brain_schema::SchemaError> for CliError {
    fn from(err: brain_schema::SchemaError) -> Self {
        CliError::NoDatabase(err.to_string())
    }
}

impl From<rusqlite::Error> for CliError {
    fn from(err: rusqlite::Error) -> Self {
        CliError::Runtime(err.to_string())
    }
}

impl From<serde_json::Error> for CliError {
    fn from(err: serde_json::Error) -> Self {
        CliError::Runtime(err.to_string())
    }
}
