# Changelog

All notable changes to VaultX. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).
The current build state and next steps are in [HANDOFF.md](HANDOFF.md).

## [0.0.1] - Draft 0 - 2026-11-16

### Added
- Tauri 2 + React + TypeScript project scaffold, MIT licence, docs (HANDOFF, DESIGN, ARCHITECTURE).
- Design system: graphite neutrals, single vermilion accent, IBM Plex Sans/Mono (bundled, offline), light/dark/system themes.
- **Notes**: Markdown vault folder, CodeMirror editor with autosave, sanitised preview, `[[wiki links]]` with auto-create, backlinks panel, force-directed graph, rename/move, soft delete to `.trash/`.
- **Tasks**: lists, smart lists, tags, priorities, per-task note, due dates and time blocks, natural quick-add parser.
- **Calendar**: week view with drag-move/resize and click-to-create, month view, ICS subscriptions (Google/Outlook/Apple secret links) with RRULE/EXDATE expansion, `.ics` export of tasks.
- **Sheets**: spreadsheets with formulas via x-data-spreadsheet, stored as `.vxsheet` JSON in the vault; CSV import/export.
- **Training**: activity store (SQLite), `.FIT` import, Garmin Connect login (incl. MFA) and sync through a Python helper in a private venv, manual logging for any sport, Banister TRIMP, ATL/CTL/TSB, monotony/strain, effective VO2max, Daniels race predictions, weekly volume by sport family, load chart.
- **Digest** (experimental): RSS/Atom headlines ranked by interest keywords.
- Settings: vault folder, theme.
