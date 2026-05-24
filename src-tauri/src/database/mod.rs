// MED-A5: database.rs god-module (1743 lines) split into focused sub-modules.
// All public items are re-exported here so existing callers (commands/*, lib.rs,
// bin/generate_types.rs) continue to use `database::Foo` without any changes.

pub mod models;
pub mod migrations;
pub mod connections;
pub mod groups;
pub mod import_export;
pub mod ssh_keys;
pub mod saved_commands;
pub mod credentials;
pub mod audit;

// Re-export everything callers need at the `database::` path
pub use models::*;
pub use migrations::{initialize_database, run_migrations_pub, CURRENT_SCHEMA_VERSION};
pub use connections::*;
pub use groups::*;
pub use import_export::*;
pub use ssh_keys::*;
pub use saved_commands::*;
pub use credentials::*;
pub use audit::*;
