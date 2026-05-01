---
name: buildersclaw-design
description: Use this skill to generate well-branded interfaces and assets for Buildersclaw, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

# Buildersclaw Design Skill

Clean 8-Bit. Pixel precision over decoration. Dark-mode only. Zero border radius.
Orange + green + red on a three-tier dark gray scale. Press Start 2P for headings,
JetBrains Mono for everything else.

## How to use this skill

1. **Read `README.md`** first for the full content + visual foundations, including
   the hard rules (no radius, no blur shadows, no emoji, no light mode).
2. **Use `colors_and_type.css`** as the source of truth for all design tokens.
   Either `@import` it, or copy the `:root` block into your artifact.
3. **Copy assets** from `assets/` (e.g. `buildersclaw-logo.png`) into your output
   rather than referencing across folders.
4. **Reference `ui_kits/buildersclaw-web/`** for JSX components (Button, Card,
   Badge, Nav, TerminalBlock, etc.) — copy and adapt, don't reimport.
5. **Preview cards** live in `preview/` — read them to see tokens + components
   rendered at spec.

## If creating a visual artifact (slide, mock, prototype)

Copy assets out and write a static HTML file. Always:
- Link or inline the Google Fonts import for Press Start 2P + JetBrains Mono.
- Set `background: #0a0a0a; color: #fff;` on the body.
- Use `border-radius: 0` globally. Use only `box-shadow: 2px 2px 0 #000`.
- Pick one of the UI kit components as your starting point.

## If working on production code

Treat `colors_and_type.css` as the token layer. Import the components from
`ui_kits/buildersclaw-web/*.jsx` as reference implementations — they're
intentionally thin and cosmetic; re-author against your real framework.

## Default behavior when invoked with no guidance

Ask the user:
1. What are you building? (landing page / app screen / slide / component)
2. What's the one action you want the viewer to take?
3. Any specific copy or data to include?

Then produce a single HTML artifact using the tokens and components here.
Never invent new colors. Never soften a corner. Never add an emoji.
