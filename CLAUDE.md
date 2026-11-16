# Notes for AI assistants working on VaultX

- Start every session by reading `HANDOFF.md` (state, decisions, next steps).
- After any meaningful change, update `HANDOFF.md` (status table, next steps, session log) and `CHANGELOG.md`.
- Follow `docs/DESIGN.md` for UI - no gradients/glows/emoji icons/card grids; use the CSS tokens.
- Follow `docs/ARCHITECTURE.md` conventions (local wall-clock times, relative vault paths, soft deletes, camelCase serde).
- Work on a branch, not `main`; the user's installed copy is built from release tags. Dev builds use separate data (see HANDOFF "Testing vs developing") - never point them at `Documents\VaultX`.
- Verify with: `npx tsc --noEmit`, `npx vite build`, `cargo test --manifest-path src-tauri/Cargo.toml`.
