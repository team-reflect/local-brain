use serde::Serialize;

/// Every `#[tauri::command]` returns `Result<T, AppError>`. `AppError`
/// serializes as `{ "kind": "...", "message": "..." }` with a camelCase `kind`
/// discriminant, mirrored by the TypeScript `AppError` union in
/// `@local-brain/core`. The frontend branches on `kind`, never on message text.
#[allow(dead_code)]
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AppError {
    /// Filesystem / IO failure.
    Io { message: String },
    /// A requested record or file does not exist.
    NotFound { message: String },
    /// A path escaped an allowed root (security guard).
    Traversal { message: String },
    /// An operation needs an open database but none is set.
    NoDatabase { message: String },
    /// Parse / validation failure.
    Parse { message: String },
    /// A provider rejected our credentials.
    Auth { message: String },
    /// A remote is unreachable (offline, DNS, timeout) — retryable.
    Network { message: String },
    /// Anything not covered above.
    Unknown { message: String },
}

pub type AppResult<T> = Result<T, AppError>;

#[allow(dead_code)]
impl AppError {
    pub fn io(message: impl Into<String>) -> Self {
        Self::Io {
            message: message.into(),
        }
    }
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound {
            message: message.into(),
        }
    }
    pub fn no_database(message: impl Into<String>) -> Self {
        Self::NoDatabase {
            message: message.into(),
        }
    }
    pub fn parse(message: impl Into<String>) -> Self {
        Self::Parse {
            message: message.into(),
        }
    }
    pub fn unknown(message: impl Into<String>) -> Self {
        Self::Unknown {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            AppError::Io { message }
            | AppError::NotFound { message }
            | AppError::Traversal { message }
            | AppError::NoDatabase { message }
            | AppError::Parse { message }
            | AppError::Auth { message }
            | AppError::Network { message }
            | AppError::Unknown { message } => message,
        };
        write!(f, "{message}")
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::io(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::parse(err.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        AppError::io(err.to_string())
    }
}

impl From<brain_schema::SchemaError> for AppError {
    fn from(err: brain_schema::SchemaError) -> Self {
        AppError::no_database(err.to_string())
    }
}
