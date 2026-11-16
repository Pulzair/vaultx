# VaultX

A local-first desktop vault for your thoughts, plans and training.
Everything stays on your computer. Open source (MIT).

> Status: **draft 0** - early and moving fast. See [HANDOFF.md](HANDOFF.md) for exactly what works.

## Modules

- **Notes** - Markdown files in a folder you own, `[[wiki links]]`, backlinks and a link graph. Works with an existing Obsidian vault.
- **Tasks** - lists, tags, priorities, notes per task, and time blocks. Type `Maths homework mon 1pm-3pm #school !2` and it is scheduled.
- **Calendar** - week and month views of your tasks, drag to reschedule, plus read-only Google / Outlook / Apple calendars via their ICS links; export tasks as `.ics`.
- **Sheets** - spreadsheets with formulas, CSV import/export.
- **Training** - Garmin Connect sync or `.FIT` import from any device, plus hand-logged sessions. Runalyze-style load (TRIMP, fitness/fatigue/form), effective VO2max, race predictions, and weekly volume across every sport: run, ride, swim, paddle, walk, gym and more.
- **Digest** (experimental) - RSS headlines ranked by your interests.

## Build from source

Prerequisites: [Node.js](https://nodejs.org) 20+, [Rust](https://rustup.rs) stable, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS
(on Windows: Microsoft C++ Build Tools and WebView2).

```bash
npm install
npm run tauri dev     # run in development
npm run tauri build   # produce an installer
```

Garmin sync also needs Python 3; the app installs its helper library into a private environment the first time you connect.

## Garmin note

Garmin does not offer personal API keys. VaultX signs in to Garmin Connect the same way the
open-source [`garminconnect`](https://github.com/cyberjunky/python-garminconnect) library does,
and stores only the resulting login token locally. This is unofficial and may break when Garmin
changes its login; `.FIT` import always works as a fallback.

## Contributing

Read [HANDOFF.md](HANDOFF.md) (current state + next steps), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
and [docs/DESIGN.md](docs/DESIGN.md) (visual rules) before opening a PR. Update HANDOFF and
CHANGELOG with every meaningful change.

## Licence

MIT - see [LICENSE](LICENSE).
