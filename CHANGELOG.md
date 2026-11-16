# Changelog

All notable changes to VaultX. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).
The current build state and next steps are in [HANDOFF.md](HANDOFF.md).

## [0.0.3] - 2026-11-16

### Fixed
- Calendar (and any tall view) no longer stretches the window past the screen; the week grid scrolls to 23:00.

### Added
- **Tasks (TickTick-style):** list colours, folders and archive; board (kanban) view with sections; Tomorrow smart list; custom saved filters; tag colours and rename; checklist subtasks; repeat rules (daily / weekly on chosen days / monthly / yearly, interval, from completion, end date or count); multiple reminders with desktop notifications; won't-do; pin; duplicate; estimate in pomodoros; Trash with restore and empty; Summary report (copy or save as note); sort and group; search; right-click menus; drag tasks onto lists; quick-add `~List`, `^Section`, `every ...`.
- **Calendar:** day, 3-day and agenda views; list colours on blocks; Unscheduled panel with drag-onto-grid scheduling.
- **Focus:** configurable pomodoro, automatic short/long breaks, generated white/pink/brown noise, daily focus goal, end-of-session notifications.
- **Time window:** focus statistics by day/week/month/year - totals and change vs previous period, sessions, full pomodoros, daily average, best day, longest session, streak, goal days, trend chart, breakdown by list/tag/task, timeline, best-focus-hours heatmap, planned vs actual, records, CSV export.
- **Habits:** check-ins, counted goals, weekday or N-per-week schedules, sections, streaks, 30-day rate, month calendar, reminders, archive, templates.
- **Diet:** meal log, foods library, quick add, servings, calorie equation with exercise, macro targets, energy split, water, body weight, 30-day trends.
- **Training:** tabs (Overview, Activities, Wellness, Records, Setup); full activity detail with Garmin Training Effect/load/VO2max, exact stream TRIMP, aerobic decoupling, efficiency factor, HR zones, stream charts and laps; Garmin activity detail + daily wellness sync (sleep, HRV, resting HR, Body Battery, stress, steps); FIT streams and laps kept on import; personal records; yearly/monthly totals; acute:chronic ratio; methodology and accuracy notes.
- **Data:** full versioned backup/import that works across versions, CSV export per table, opt-in read-only local HTTP API with token, `VAULTX_DATA_DIR` portable mode.
- Ctrl+K command palette, toasts with undo, last-module memory.

### Changed
- Database gains new columns through in-place migrations; existing v0.0.1/v0.0.2 data is kept.

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
