use serde::{Serialize, Serializer};
use serde::ser::SerializeStruct;
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
    #[error("Not found: {0}")]
    NotFound(String),
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

// Ensure string errors from older maps can fallback into Internal
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
