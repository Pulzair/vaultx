# VaultX - Build Handoff

> **Read this first.** This file is the single source of truth for "where is the
> build up to". Update it at the end of every work session (and ideally after
> each meaningful step) so a new session - human or AI - can resume in minutes.
> Detailed history lives in [CHANGELOG.md](CHANGELOG.md).

_Last updated: 2026-11-16 - Draft 0 (build 00)_

## What VaultX is

A local-first desktop app for storing thoughts and plans: notes with a link
graph, tasks + calendar, spreadsheets, a training-data hub (Garmin / .FIT) and
an optional news digest. All data stays on the user's computer. Open source
(MIT), public GitHub repo.

## Stack decisions (settled - don't relitigate without reason)

| Area | Choice | Why |
|---|---|---|
| Shell | **Tauri 2** (Rust) | Small native binaries, real desktop app, web UI flexibility |
| UI | React 18 + TypeScript + Vite | Best library ecosystem for editor / graph / grid |
| Structured data | SQLite via `rusqlite` (bundled) in the app-data dir | Tasks, calendars, activities, settings |
| Notes | Plain `.md`/`.txt` files in a user-visible **vault folder** (default `Documents/VaultX`) | Obsidian/Logseq-compatible, user owns files |
| Sheets | `x-data-spreadsheet` (MIT), saved as JSON `Sheets/*.vxsheet` in the vault | Formulas, multi-sheet, styling out of the box |
| Editor | CodeMirror 6 | |
| Graph | `d3-force` on a canvas | |
| Garmin | Python helper `src-tauri/sidecar/garmin_bridge.py` using the community `garminconnect` lib, run inside a private venv the app creates | Garmin has **no personal API keys**; this is the same approach the Garmin MCP servers use |
| .FIT import | `fitparser` crate (Rust) | Works for any device |
| External calendars | ICS subscription (read-only) + `.ics` export | Works with Google/Outlook/Apple with zero OAuth setup |
| Look & feel | See [docs/DESIGN.md](docs/DESIGN.md) | Deliberately avoids the generic "AI app" look |

## Status by module

| Module | State | Notes |
|---|---|---|
| App shell / nav | Done | Text rail, Ctrl+1..6, Ctrl+, settings, light/dark/system theme |
| Notes | Working | File list, CodeMirror editor, preview, `[[wiki links]]` (click creates missing notes), backlinks, force graph, rename/move, trash to `.trash/` |
| Tasks | Working | Lists, smart lists (Today / 7 days / All / Completed), tags, priority, attached note, date + start/end time, quick-add parser (`Maths homework mon 1pm-3pm #school !2`) |
| Calendar | Working | Week (drag to move, drag bottom edge to resize, click to create) + Month views, all-day row, now-line, ICS subscriptions with RRULE expansion, `.ics` export |
| Sheets | Working | Create / rename / trash, autosave, CSV import/export. Grid stays light in dark mode (canvas colours are hard-coded in the lib) |
| Training | Working (needs real-data testing) | Activities table, TRIMP, ATL/CTL/TSB, monotony/strain, effective VO2max, race predictions, weekly volume by sport, manual logging, .FIT import, Garmin login/MFA/sync |
| Digest | Experimental | RSS/Atom reader ranked by interest keywords |
| Settings | Basic | Vault folder, theme |

## How to run

```bash
npm install
npm run tauri dev      # dev app with hot reload
npm run tauri build    # installers in src-tauri/target/release/bundle
cargo test --manifest-path src-tauri/Cargo.toml   # Rust unit tests
```

Prereqs: Node 20+, Rust stable, (Windows) MSVC C++ Build Tools + WebView2.
Garmin sync additionally needs Python 3 on PATH (the app creates its own venv).

## Where things are

```
src/                     React UI
  App.tsx                shell + navigation
  lib/                   api (invoke wrappers), types, dates, ics, quickadd, fitness science, markdown, dialog
  modules/<name>/        one folder per module (notes, tasks, calendar, sheets, fitness, digest, settings)
  styles/app.css         design tokens + primitives
src-tauri/
  src/lib.rs             app setup, state, command registry
  src/db.rs              SQLite schema + task/list/calendar/activity/settings commands
  src/vault.rs           notes & sheets file I/O (path-escape protected), wiki-link indexing
  src/fitness.rs         .FIT parsing + Garmin helper process management
  src/net.rs             fetch_text (ICS / RSS) without CORS
  sidecar/garmin_bridge.py  JSON-lines bridge to garminconnect
docs/                    DESIGN.md, ARCHITECTURE.md
```

## Known gaps / next steps (priority order)

1. **Verify Garmin flow end-to-end with a real account** (login, MFA, sync). `garminconnect`'s login internals change when Garmin changes SSO; pin a working version in `sidecar/requirements.txt` once confirmed.
2. **Two-way Google Calendar sync** (OAuth). Needs the user to create a Google Cloud OAuth client (desktop app type). ICS subscribe/export covers read + manual import for now.
3. Marathon shape (Runalyze-style) - needs weekly-km + long-run targets derived from VO2max; also per-activity HR streams for more accurate TRIMP (currently uses session average HR).
4. Recurring tasks (RRULE on tasks), reminders/notifications.
5. Notes: folder tree with collapse, tags (`#tag`) index, full-text search, daily notes, drag-drop attachments.
6. Sheets: dark-mode grid, consider Univer or Fortune-sheet if x-data-spreadsheet (unmaintained) becomes limiting.
7. TZID-aware ICS parsing (currently TZID times are treated as local wall-clock).
8. Packaging: code signing, auto-update (tauri-plugin-updater), app icon design (current icon is a placeholder).
9. Tests: TS unit tests for `quickadd`, `ics`, `fitness` (add vitest).

## Session log (newest first)

- **2026-11-16 - Draft 0.** Toolchain installed (Node, Rust, MSVC Build Tools, gh). Full scaffold written: Rust backend (SQLite, vault I/O, FIT, Garmin bridge, fetch), React UI with all six modules. Verified: frontend typechecks + builds, Rust compiles with 3 passing unit tests, `tauri dev` launches and creates the vault (`Documents/VaultX/Welcome.md`) and DB; Garmin bridge protocol smoke-tested offline against garminconnect 0.3.20. **Not yet verified:** clicking through every module inside the native window, a real Garmin login, a real ICS feed. GitHub remote not yet created (needs `gh auth login`). See CHANGELOG for detail.
