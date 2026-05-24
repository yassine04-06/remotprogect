use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Database constraint or internal error: {0}")]
    Database(String),
    #[error("Authentication failed: {0}")]
    AuthFailed(String),
    #[error("Network connection refused or timed out: {0}")]
    Network(String),
    #[error("Vault encryption or decryption failed: {0}")]
    Vault(String),
    #[error("Internal system error: {0}")]
    Internal(String),
    #[allow(dead_code)]
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Validation error: {0}")]
    Validation(String),
    /// HIGH-A5: returned when a command exceeds 100 req/s.
    #[error("Rate limit exceeded: {0}")]
    RateLimit(String),
    /// SSH private key is passphrase-protected and no passphrase was provided.
    /// The frontend catches this code and shows a passphrase prompt, then retries.
    #[error("SSH key requires passphrase: {0}")]
    KeyEncrypted(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Database(_) => "DATABASE_ERROR",
            AppError::AuthFailed(_) => "AUTH_FAILED",
            AppError::Network(_) => "NETWORK_ERROR",
            AppError::Vault(_) => "VAULT_ERROR",
            AppError::Internal(_) => "INTERNAL_ERROR",
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::Validation(_) => "VALIDATION_ERROR",
            AppError::RateLimit(_) => "RATE_LIMIT",
            AppError::KeyEncrypted(_) => "KEY_ENCRYPTED",
        }
    }
}

// Convert into a serializable struct that the frontend can parse as a JSON object
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

// ── HIGH-A1: russh::Error → AppError (required by client::Handler::Error bound) ─
impl From<russh::Error> for AppError {
    fn from(e: russh::Error) -> Self {
        AppError::Network(e.to_string())
    }
}

// ── M-3: legacy string-to-AppError fallback (do NOT use in new code) ─────────
//
// These conversions collapse every `Result<_, String>` into
// `AppError::Internal`, hiding the real category (network/auth/validation).
// `#[deprecated]` cannot be applied to trait-impl methods in Rust, so the
// migration is enforced by code review: every new `?` should produce a typed
// variant (`AppError::Network`, `::AuthFailed`, `::Validation`, `::Vault`,
// `::Database`) — only fall back here when the underlying error is genuinely
// unclassified internal logic.
//
// To audit remaining call sites:
//   grep -rn "format!.*: {}" src/ | grep -E "\\?$|\\?,$"
// or look for `.map_err(|e| format!(...))?` patterns returning `Result<_, AppError>`.
impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Internal(s)
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Internal(s.to_string())
    }
}
