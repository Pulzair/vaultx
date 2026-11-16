# VaultX - Build Handoff

> **Read this first.** This file is the single source of truth for "where is the
> build up to". Update it at the end of every work session (and ideally after
> each meaningful step) so a new session - human or AI - can resume in minutes.
> Detailed history lives in [CHANGELOG.md](CHANGELOG.md).

_Last updated: 2026-11-16 - v0.0.3 work on branch `feature/v0.0.3` (released: v0.0.2 on `main`)_

## What VaultX is

A local-first desktop app for storing thoughts and plans: notes with a link
graph, TickTick-style tasks + calendar + focus timer, habits, diet tracking,
spreadsheets, a training-data hub (Garmin / .FIT) and an optional news digest.
All data stays on the user's computer. Open source (MIT), public GitHub repo:
https://github.com/Pulzair/vaultx (branch `main`).

## Stack decisions (settled - don't relitigate without reason)

| Area | Choice | Why |
|---|---|---|
| Shell | **Tauri 2** (Rust) | Small native binaries, real desktop app, web UI flexibility |
| UI | React 18 + TypeScript + Vite | Best library ecosystem for editor / graph / grid |
| Structured data | SQLite via `rusqlite` (bundled) in the app-data dir; columns added with guarded `ALTER TABLE` migrations (`db.rs MIGRATIONS`) | Upgrades keep existing data |
| Newer modules' data | Generic JSON document store (`docs` table: collection + id + JSON) | Diet, saved filters... without new Rust per feature |
| Notes | Plain `.md`/`.txt` files in a user-visible **vault folder** (default `Documents/VaultX`) | Obsidian/Logseq-compatible, user owns files |
| Sheets | `x-data-spreadsheet` (MIT), saved as JSON `Sheets/*.vxsheet` in the vault | Formulas, multi-sheet, styling out of the box |
| Editor / graph | CodeMirror 6 / `d3-force` on a canvas | |
| Garmin | Python helper `src-tauri/sidecar/garmin_bridge.py` using `garminconnect` 0.3.x in a private venv | Garmin has **no personal API keys**; same approach as the Garmin MCP servers |
| .FIT import | `fitparser` crate (Rust); keeps HR/speed/alt/cadence/power streams + laps | Works for any device |
| External calendars | ICS subscription (read-only) + `.ics` export | Google/Outlook/Apple with zero OAuth setup |
| Notifications | `tauri-plugin-notification` (+ in-app toast fallback) | Task/habit reminders, pomodoro end |
| Data portability | Versioned JSON export/import (`data.rs`), CSV per table, opt-in read-only local HTTP API (`tiny_http`, 127.0.0.1, token) | Move data between machines and versions; scripting |
| Look & feel | See [docs/DESIGN.md](docs/DESIGN.md) | Deliberately avoids the generic "AI app" look |

## Status by module

| Module | State | Notes |
|---|---|---|
| App shell | Done | Text rail with 9 modules (Ctrl+1..9), **Ctrl+K command palette** (search tasks/notes, jump, quick-add, timer actions), toasts with undo, remembers last module |
| Notes | Working | File list, CodeMirror, preview, `[[wiki links]]`, backlinks, graph, rename/move, trash |
| Tasks | Working (v0.0.3) | Lists with **colours, folders, archive**; **list or board (kanban) view with sections**; smart lists Today / Tomorrow / Next 7 days / All; **custom saved filters**; tags with **colours** + rename; Summary report (copy / save as note); Completed, Won't do, **Trash with restore/empty**; per task: **checklist subtasks**, **repeat rules** (daily/weekly on days/monthly/yearly, interval, from completion, until/count), **multiple reminders**, priority, estimate in pomodoros, pin, duplicate, won't-do, markdown note; sort + group options; search; right-click menus; drag tasks onto lists; quick-add understands `~List ^Section every mon,wed` |
| Calendar | Working (v0.0.3) | **Day / 3-day / week / month / agenda** views; blocks in **list colours**; drag to move/resize; **Unscheduled panel - drag tasks onto the grid**; plan vs tracked strip; ICS subscriptions; `.ics` export. **Fixed: window no longer grows past the screen (now scrolls to 23:00)** |
| Time (focus) | Working (v0.0.3) | Rail timer: pomodoro (configurable), stopwatch, **auto short/long breaks**, **generated white/pink/brown noise**, daily goal bar, desktop notification at end. **Time window**: day/week/month/year with totals vs previous period, sessions, full pomodoros, daily average, best day, longest session, streak, goal days; focus-by-day chart with goal line; by list / tag / task; timeline; best-focus-hours heatmap (12 weeks); planned vs actual; records table; CSV export; optional "include workouts" |
| Habits | Working (v0.0.3) | Daily / certain weekdays / N per week; counted goals (e.g. 8 glasses); sections (morning/afternoon/evening); week grid check-in; streak, best, total, 30-day rate; month calendar; colours; daily reminder; archive; templates |
| Diet | Working (v0.0.3) | Daily log by meal; foods library (per serving, favourites); recent foods; quick add (optionally saved); servings scaling; goal - food + exercise = remaining (exercise kcal from Training); macro progress vs targets; energy split; water; body weight; notes; 30-day trends (calories vs goal, macro averages, weight line) |
| Training | Working (v0.0.3) | Tabs: **Overview** (fitness/fatigue/form + state text, ACWR, monotony, VO2max vs Garmin's, race predictions, last-night sleep/HRV/RHR, load + volume charts, 4-week sport table, recent list), **Activities** (filter/search/sort, totals; click for detail: all Garmin extras, exact stream TRIMP, Garmin load + Training Effect, aerobic decoupling, efficiency factor, HR zones, HR/pace/elevation/cadence/power small multiples with shared crosshair, laps), **Wellness** (Garmin sleep, HRV, resting HR, Body Battery, stress, steps, intensity minutes, weight), **Records** (PRs per sport, yearly + monthly totals), **Setup** (Garmin connect incl. 5-year sync, FIT import, manual log, physiology, zones, methodology + accuracy notes) |
| Sheets | Working | Unchanged |
| Digest | Experimental | Unchanged |
| Settings | Working (v0.0.3) | Vault, theme, **Focus settings**, **Data: back up everything / import backup / CSV per table**, **Local API** (enable, port, token, curl examples) |

## Data, export and the local API

- **Backup:** Settings > Data > *Back up everything* writes `<vault>/Exports/vaultx-backup-<time>.json`:
  `{ format: "vaultx-export", schemaVersion, appVersion, exportedAt, tables: {<table>: [rows]}, vault: {<path>: text} }`.
  Machine-specific settings (`vault_path`, `api_*`) are excluded.
- **Import:** upserts rows by primary key, ignores unknown columns, lets missing ones take defaults - so old exports
  load into new versions and vice versa. Notes are written only if absent unless "overwrite" is ticked. A
  `pre-import-backup-*.json` is always written first. Logic in `data::import_data` (unit-tested).
- **Schema changes:** add new columns to `MIGRATIONS` in `db.rs` (never edit `SCHEMA` columns in place) and bump `SCHEMA_VERSION`.
- **Local API (opt-in, read-only, 127.0.0.1 only):** `GET /api/v1/health | export | <table> | docs/<collection> | notes | notes/<path>`,
  token via `Authorization: Bearer` or `?token=`. Default port 47821. Verified 401 without token, 405 on POST.
- **Portable / test mode:** env `VAULTX_DATA_DIR=<dir>` puts DB, Garmin data and the vault (in `<dir>/vault`) there.

## How to run

```bash
npm install
npm run tauri dev      # dev app with hot reload (separate dev data, see below)
npm run tauri build    # installers in src-tauri/target/release/bundle
cargo test --manifest-path src-tauri/Cargo.toml   # Rust unit tests
```

Prereqs: Node 20+, Rust stable, (Windows) MSVC C++ Build Tools + WebView2.
Garmin sync additionally needs Python 3 on PATH (the app creates its own venv).

### Testing vs developing (keep them apart)

| | Installed copy (real use / testing) | Dev build (`npm run tauri dev`) |
|---|---|---|
| Built from | a release tag, via `npm run tauri build` | whatever is checked out |
| Vault | `Documents\VaultX` | `Documents\VaultX-Dev` |
| App data (DB, Garmin) | `%APPDATA%\io.github.vaultx.app` | `%APPDATA%\io.github.vaultx.app.dev` |
| Window title | VaultX | VaultX (dev data) |

**UI-only testing in a browser:** `npm run dev` then open http://localhost:1420. `src/lib/mockBackend.ts` answers
commands with sample data (tasks, kanban list, habits, foods, a run with streams, 30 days of wellness). Dev-only,
never in the release bundle. **Add every new Rust command there too.**

Git workflow: `main` stays releasable; work on a branch, merge when it works, tag (`git tag v0.0.3`), rebuild the installer.

## Where things are

```
src/
  App.tsx                shell, navigation, palette, stores
  components/            TimerWidget, TaskTimer, Palette (Ctrl+K), Toasts, Menu (popover, colour picker, dot)
  lib/                   api, types, dates, ics, quickadd, recurrence, taskQuery (scopes/sort/group), taskStore,
                         timeStore, noise, notify, toast, reminders, habits, diet, fitness (science), colors, markdown, dialog, mockBackend
  modules/<name>/        notes, tasks (TasksView, TaskDetail, Kanban, Summary, FilterEditor), calendar, time, habits,
                         diet, fitness (FitnessView tabs, Detail, Charts), sheets, digest, settings
  styles/app.css         design tokens + primitives
src-tauri/
  src/lib.rs             app setup, state, command registry, VAULTX_DATA_DIR
  src/db.rs              SQLite schema + MIGRATIONS; lists/tasks/habits/calendars/time/activities/daily metrics
  src/data.rs            docs store, export/import, CSV, local HTTP API (+ round-trip test)
  src/vault.rs           notes & sheets file I/O, wiki-link indexing
  src/fitness.rs         FIT parsing (streams + laps), Garmin helper process, detail + wellness commands
  src/net.rs             fetch_text (ICS / RSS)
  sidecar/garmin_bridge.py  JSON-lines bridge: login, mfa, sync, detail, wellness
```

## Known gaps / next steps (priority order)

1. **Try v0.0.3 in the native window** (everything was click-tested in the browser mock; backend verified with the real binary: migration from a v0.0.2 DB, local API, export).
2. **Real Garmin account test of `detail` and `wellness`** commands (method names verified against garminconnect 0.3.20, responses not yet seen live).
3. Merge `feature/v0.0.3` -> `main`, bump version to 0.0.3 (package.json, Cargo.toml, tauri.conf.json), tag, build installer.
4. Two-way Google Calendar sync (OAuth client needed from the user).
5. Training: Runalyze "marathon shape" adjustment of predictions; best efforts from streams (fastest 1k/5k inside longer runs); route maps (needs GPS in detail).
6. Diet: barcode / public food database lookup (Open Food Facts) - currently manual library only.
7. Tasks: timeline (Gantt) view, sub-tasks as full tasks (TickTick has both), attachments, countdowns.
8. Focus: strict mode, per-task focus goals, sound choices.
9. Notes: folder tree, tag index, full-text search, daily notes.
10. TS unit tests (vitest) for quickadd / recurrence / ics / fitness / habits streaks; a sample .FIT file test in Rust.
11. Packaging: code signing, auto-update, real app icon.

## Session log (newest first)

- **2026-11-16 - v0.0.3 build (branch `feature/v0.0.3`).** From user testing of v0.0.2: fixed calendar not scrolling (CSS grid row grew to content; `.shell` now `grid-template-rows: minmax(0,1fr)`). Researched TickTick and built nearly all of its feature set except the Eisenhower matrix (see Tasks/Calendar/Time/Habits rows). Added Diet, Training overhaul with Garmin extras/streams/wellness, data export/import/CSV/local API, Ctrl+K palette, toasts, notifications. Verified: `tsc`, `vite build`, 4 Rust tests (incl. import round-trip with schema drift), browser-mock click-through of every module, real binary against a genuine v0.0.2-schema DB (migrated 14->22 task columns, data intact), local API auth/read-only/export. **Not verified:** native window click-through, live Garmin detail/wellness responses, notifications on Windows.
- **2026-11-16 - v0.0.2 Time tracking.** Timers, pomodoro, plan vs tracked calendar, browser mock backend. Released as v0.0.2.
- **2026-11-16 - Draft 0 (v0.0.1).** Full scaffold, toolchain, repo published.
