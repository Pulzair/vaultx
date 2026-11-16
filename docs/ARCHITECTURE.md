# Architecture

```
┌──────────────────────── Tauri window (WebView2 / WKWebView / WebKitGTK) ───────────────┐
│ React UI (src/)                                                                         │
│   modules/notes  tasks  calendar  sheets  fitness  digest  settings                     │
│   lib/api.ts  ── invoke("command", args) ──┐                                            │
└────────────────────────────────────────────┼────────────────────────────────────────────┘
                                             ▼
┌──────────────────────── Rust core (src-tauri/src) ─────────────────────────────────────┐
│ lib.rs   AppState { db: Mutex<Connection>, vault: Mutex<PathBuf>, garmin: Mutex<..> }   │
│ db.rs    SQLite  <app-data>/vaultx.db   lists, tasks, calendars, external_events,       │
│                                         activities, settings                            │
│ vault.rs files   <vault>/**.md|txt, <vault>/Sheets/*.vxsheet, Exports/, .trash/         │
│ fitness.rs  .FIT -> activities ; spawns Python helper  ──stdin/stdout JSON lines──┐     │
│ net.rs   fetch_text (ICS, RSS)                                                     │     │
└────────────────────────────────────────────────────────────────────────────────────┼─────┘
                                                                                     ▼
                                   <app-data>/garmin-venv/python  sidecar/garmin_bridge.py
                                   (garminconnect)  tokens in <app-data>/garmin-tokens
```

## Data ownership

- **Vault folder** (default `~/Documents/VaultX`, changeable): human-readable
  files the user owns. Safe to sync with any file-sync tool or open in Obsidian.
- **App-data folder** (`%APPDATA%\io.github.vaultx.app` on Windows): SQLite DB,
  Garmin venv and tokens. Never leaves the machine.

## Conventions

- Rust commands return `Result<T, String>`; the UI shows the string.
- serde structs use `camelCase` to match TS interfaces in `src/lib/types.ts`.
- Times are stored as **local wall-clock strings** (`YYYY-MM-DDTHH:MM`) so a
  1pm block stays 1pm; audit timestamps (`createdAt`, `completedAt`) are UTC ISO.
- Vault paths from the UI are always relative and checked against escaping the
  vault (`vault::resolve`).
- Deletes in the vault are soft (moved to `.trash/`).
- Rendered Markdown is sanitised because the webview can call app commands.

## Adding a module

1. `src/modules/<name>/<Name>View.tsx` (+ css), add to `MODULES` in `App.tsx`.
2. Backend commands in a new `src-tauri/src/<name>.rs`, register in `lib.rs`.
3. Typed wrappers in `src/lib/api.ts`, types in `src/lib/types.ts`.
4. Update HANDOFF.md and CHANGELOG.md.
