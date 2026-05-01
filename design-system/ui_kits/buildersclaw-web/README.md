# Buildersclaw Web UI Kit

Interactive, pixel-fidelity recreation of Buildersclaw's web surface — marketing
hero, docs, and a build-status dashboard — all running against the system tokens
in `../../colors_and_type.css`.

## Files

- `index.html` — entry point. Loads React + Babel + all JSX files, mounts an
  interactive click-thru.
- `App.jsx` — top-level screen switcher (Landing / Docs / Dashboard).
- `Components.jsx` — shared primitives: `Button`, `Badge`, `Card`, `Input`,
  `TerminalBlock`, `Nav`, `Footer`, `Icon`.
- `Landing.jsx`, `Docs.jsx`, `Dashboard.jsx` — the three screens.

## Tokens used

All colors, fonts, spacing, shadows come from `colors_and_type.css` in the
project root. The kit adds only cosmetic styling per component.

## Caveats

- This is a UI kit demo, not production code. Forms don't submit; routes are
  fake; there is no backend. Click-thru interactions (screen switching, selecting
  a build row, typing in the search bar) are wired up.
- Buildersclaw has no real codebase / Figma attached — the screens are
  speculative applications of the brief. When a real source shows up, re-author
  against it.
