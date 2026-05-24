# Contributing to NexoRC

## Prerequisites

- Rust 1.78+ (via rustup)
- Node.js 20+
- Tauri CLI v2: `cargo install tauri-cli --version "^2"`
- Windows: MSVC build tools (for RDP/FreeRDP integration)

## Development Setup

```bash
# Install frontend dependencies
npm install

# Run in development mode (hot reload)
npm run tauri dev
```

## Project Structure

```
src/                  React/TypeScript frontend
src-tauri/src/        Rust backend (Tauri commands)
src-tauri/tests/      Integration tests
src/components/       UI components
src/components/forms/ Protocol-specific sub-forms
src/components/docker/ Docker sub-components
src/services/api.ts   Frontend ↔ backend bridge (invoke wrappers)
src/store/            Zustand state stores
src/types/index.ts    Shared TypeScript types
```

## Architecture Overview

See [ARCHITECTURE.md](ARCHITECTURE.md) for a detailed breakdown.

## Running Tests

```bash
# Backend integration tests
cd src-tauri && cargo test

# Frontend lint
npm run lint

# TypeScript check
npm run tsc
```

## Pull Request Guidelines

- One feature/fix per PR
- `cargo check` must pass with no new warnings
- ESLint must pass with zero errors
- New Tauri commands must be registered in `lib.rs` `invoke_handler`
- DB schema changes: increment `CURRENT_SCHEMA_VERSION` in `database.rs` and add a migration step in `run_migrations`

## Commit Style

```
feat: add VNC native rendering canvas
fix: FTPS handshake type mismatch with suppaftp 8
refactor: split ConnectionForm into protocol sub-forms
```

## Security Issues

See [SECURITY.md](SECURITY.md) before reporting vulnerabilities.
