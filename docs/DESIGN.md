# VaultX design language

Goal from the brief: **avoid the typical "AI-generated" UI look.** Research
(2026 write-ups on "AI slop" UI) converges on the same tells, so VaultX bans
them explicitly and picks a concrete direction instead of "modern and clean".

## Banned (the common tells)

- Purple/indigo gradients, gradient text, glowing buttons, glassmorphism.
- Inter + rounded-2xl cards + soft drop shadows on everything.
- Grids of three icon-in-a-rounded-square feature cards; card-inside-card.
- A thick coloured stripe down one side of a card.
- Emoji as UI icons; sparkle icons; "AI-ish" hero copy.
- Swapping purple for the *new* cliché (cream background + serif + sage green).

## Direction: "instrument panel"

A tool you use daily for hours, closer to a terminal, a DAW or a flight
instrument than a landing page.

- **Type:** IBM Plex Sans for UI, IBM Plex Mono for data, labels, dates and
  numbers (tabular figures). Bundled locally - no network fonts. 13px base.
- **Colour:** neutral graphite greys, near-black ink. **One** accent,
  vermilion (`#d9480f` light / `#ff6a33` dark), used only to signal state:
  selection, the calendar now-line, overdue, priority marks, the active nav item.
  Primary buttons are ink-on-paper, not accent-coloured.
- **Shape:** 3px radii, 1px hairline borders, no resting shadows (only modal
  dialogs get one). Panes are separated by lines, not floating cards.
- **Density:** compact rows (~28px), lots of information visible at once.
- **Labels:** small uppercase mono section labels (`LINKED FROM`, `FITNESS`).
- **Navigation:** a text rail with keyboard hints (`^1`) instead of an icon bar.
- **Charts:** follow the data-viz method - fixed categorical order per sport
  family (validated palette), one y-axis, thin 2px lines, legends always,
  hover tooltips, recessive grid.

## Tokens

Defined once in `src/styles/app.css` (`--bg`, `--surface`, `--surface-2`,
`--ink`, `--ink-2`, `--ink-3`, `--line`, `--line-strong`, `--accent`,
`--accent-soft`, `--r`). Dark mode is a hand-picked set of the same roles, not
an automatic inversion. Use the tokens - never hard-code colours in components
(exception: the categorical chart palette in `modules/fitness/fitness.css`).
