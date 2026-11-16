# Changelog

All notable changes to VaultX. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).
The current build state and next steps are in [HANDOFF.md](HANDOFF.md).

## [0.0.2] - 2026-11-16

### Added
- **Time tracking**: stopwatch and 25-minute pomodoro timers started from any task (Tasks or Calendar) or from the rail; running timer always visible and survives restarts; sessions under a minute are discarded.
- Calendar "Plan + tracked" mode: actual time shown beside planned blocks, daily tracked totals in week and month views, a Tracked today list, and an editor for entries (times, note).
- Garmin / .FIT / manual workouts appear on the calendar as tracked time, and timer entries show any overlapping workout.
- Browser mock backend for UI work without the desktop shell (dev only).

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
- Dev builds use a separate vault (`Documents/VaultX-Dev`) and app-data folder (`*.dev`), and the window title says "dev data", so installed copies are never affected by development.
