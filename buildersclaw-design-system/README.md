# Buildersclaw Design System

> **Clean 8-Bit.** Pixel precision over decoration. Generous whitespace. Tight palette.

Buildersclaw is a design system built on top of the [**8bitcn/ui**](https://www.8bitcn.com/) library. It takes the retro 8-bit aesthetic and strips it back to the essentials — no ornamental pixel clutter, no decorative CRT filters, no rainbow palettes. The result reads as **modern monospace developer-tool UI that happens to speak in pixels**: dark-mode-only, orange-accented, zero border radius everywhere, and hard 2px drop shadows as the only depth cue.

The brand mascot is a **pixel-art lobster wearing a yellow hard hat** — a "builder's claw." The mascot is red/orange, friendly, and clearly sprite-art. It signals: *we build things, we're developer-flavored, we don't take ourselves too seriously — but the product is serious.*

---

## Sources provided

| Source | Path | Notes |
|---|---|---|
| Brand logo | `uploads/buildersclaw.png` → `assets/buildersclaw-logo.png` | 500×500 PNG, transparent background, pixel-art lobster |
| Design brief | pasted in chat (see below) | Library: 8bitcn/ui · Clean 8-Bit philosophy |
| Reference library | https://www.8bitcn.com/ | External — reader may or may not have access |

No codebase, Figma file, or slide deck was provided. The system below is authored from the written brief plus the mascot, and is designed to match the visual conventions of 8bitcn/ui. If/when a real codebase or Figma file becomes available, re-run against it to pin exact values.

---

## Contents — index of this folder

```
README.md                  ← you are here
SKILL.md                   ← agent skill manifest (Claude Code compatible)
colors_and_type.css        ← all design tokens (CSS vars) + base element styles
assets/
  buildersclaw-logo.png    ← pixel-art lobster mascot (500×500, transparent)
fonts/
  README.md                ← fonts are loaded from Google Fonts CDN (see note)
preview/                   ← Design System tab cards (one concept per card)
ui_kits/
  buildersclaw-web/        ← marketing + product surface UI kit
    README.md
    index.html             ← interactive demo surface
    *.jsx                  ← individual components
```

---

## CONTENT FUNDAMENTALS

**Voice.** Direct, technical, confident. Reads like a terminal prompt wrote it. Short sentences. No marketing fluff. No exclamation points except in actual status messages (`BUILD FAILED!`).

**Person.** Mostly second-person ("**you** ship faster") when describing value; first-person plural ("**we** believe") only for manifesto moments. Avoid "I".

**Casing.** UI chrome uses `UPPERCASE` for labels, buttons, nav, badges, and headings ≤ h2. Long-form body copy is sentence case. Never title case.

**Punctuation.** Em dashes for asides. `→` for navigation / consequence. `■` for status dots. Colons for labels (`STATUS: LIVE`). No Oxford-comma wars — use them.

**Emoji.** Never. Pixel-art icons or Unicode geometry (`■ ● ▲ → ▸ ×`) only.

**Numbers.** Always numerals, never spelled out. Display with monospace alignment: `00:42`, `v1.04.0`, `2.3k`.

**Tone examples — DO:**
- `SHIP FASTER. SHIP SHARPER.`
- `Build #1247 passed in 42s.`
- `■ LIVE — 12 builders online`
- `$ npm install @buildersclaw/core`
- `Zero radius. Zero excuses.`

**Tone examples — DON'T:**
- ~~"Unlock your team's full potential with AI-powered workflows! 🚀"~~
- ~~"Let's build something amazing together ✨"~~
- ~~"Our platform empowers builders to..."~~
- ~~Any sentence with "leverage", "seamless", or "robust"~~

**Copy length.** Headlines max 6 words. Sub-copy max 20 words per sentence. Button labels 1–3 words. Empty states get one line plus one CTA, nothing more.

---

## VISUAL FOUNDATIONS

### Color

Three-tier dark scale (`#0a0a0a` / `#111` / `#1a1a1a`) carries 95% of the surface area. One brand orange (`#FF6B00`) carries all primary action. Green (`#00FF88`) and red (`#FF3333`) only appear as semantic signal — never as decoration. Text is three steps of gray (`#FFF` / `#AAA` / `#555`). **Never light mode.** Never a fourth brand color.

### Type

Two families, never three. **Press Start 2P** for headings only (never below 11px — it becomes unreadable). **JetBrains Mono** for everything else: body, inputs, badges, code, nav links, tooltips. The pairing is the identity.

### Spacing

4px base unit. Card padding is always 24px. Section-to-section gaps 32–64px. Max content width 1080px. Never use arbitrary spacing values — if it's not a multiple of 4, it's wrong.

### Backgrounds

**No imagery, no gradients, no textures, no repeating patterns.** Backgrounds are flat `#0a0a0a`. The only visual "texture" allowed is optional inline ASCII art or a pixel-art SVG (like the mascot) placed as content, not background.

### Animation

**100ms linear max.** No easing curves, no bounces, no spring physics, no fades, no blurs, no parallax, no scroll-triggered reveals. State changes are instantaneous or near-instantaneous. The one allowed motion: **button press = `translate(1px, 1px)`** to simulate a mechanical keyboard key.

### Hover states

Borders go from `#2a2a2a` → `#3a3a3a`. Backgrounds go from `#111` → `#1a1a1a`. Text stays the same color. Orange stays orange (does not lighten). No opacity changes. No scale changes.

### Press states

Buttons translate 1px right + 1px down and lose their shadow (shadow is `2px 2px 0 #000` at rest → `0 0 0 #000` on press). This simulates the button being physically pressed.

### Borders

`1px solid #2a2a2a` is the default. Hover raises to `#3a3a3a`. Selected / active states get a `2px` left accent in `--primary` (orange). Never dashed, never dotted.

### Shadows

**One shadow, ever:** `2px 2px 0 #000` (hard, no blur, pure black, offset only). A large variant `4px 4px 0 #000` exists for hero-scale cards. **Box shadows with blur are forbidden.** There are no inner shadows.

### Corner radius

**Zero. Everywhere. Always.** `border-radius: 0` is enforced globally in `colors_and_type.css`. Rounded corners are the single fastest way to violate the brand.

### Cards

`#111` background, `1px solid #2a2a2a` border, 24px padding, zero radius, optional `2px 2px 0 #000` shadow. Selected state: `border-left: 2px solid #FF6B00`. No inner gradients, no hover-lift.

### Transparency / blur

Only used for modal scrim: `rgba(0,0,0,0.6)`. Never `backdrop-filter: blur()`. Never semi-transparent card backgrounds.

### Imagery (when it exists)

Pixel art only. 1× integer scaling with `image-rendering: pixelated`. Warm palette (reds, oranges, yellows) dominates; never cool-toned photography. No stock photos. No AI-generated imagery. If a photo has to exist, it should be grayscale with `filter: grayscale(1) contrast(1.1)`.

### Layout rules

- Left-aligned by default. Center only for hero CTAs and empty states.
- One column on mobile. Two to three columns on desktop. Never more than 3.
- Fixed elements: top nav (56px tall), optional sticky footer (32px). Nothing else floats.
- Whitespace is doing work — resist the urge to fill it.

---

## ICONOGRAPHY

Buildersclaw uses **three icon sources**, in strict priority order:

1. **Unicode geometry first.** `■ ● ▲ ▼ ◆ → ▸ × ✓ ✗ ±` set in JetBrains Mono. This is the default. A green `■` is "live"; a red `×` is "failed"; a `→` is any forward action. Zero asset weight, perfect pixel alignment with the mono type.
2. **Pixel-art PNG sprites** for the mascot and any illustrated moments. Always `image-rendering: pixelated`, always integer-scaled. Stored in `assets/`.
3. **[Lucide](https://lucide.dev)** *only* where Unicode can't express the meaning (e.g. `git-branch`, `terminal`, `settings`). Use `stroke-width: 2` to match the pixel grid weight. Loaded from CDN: `https://unpkg.com/lucide@latest`. **Flagged substitution** — 8bitcn/ui itself does not ship a canonical icon set, so Lucide is our chosen complement; swap it if the real codebase uses something else.

**No emoji, ever.** Emoji breaks the pixel grid, introduces color the palette doesn't allow, and renders inconsistently across platforms.

**No hand-drawn SVG icons** in this design system. If an icon is missing from the three sources above, add a pixel-art PNG to `assets/` — don't invent SVG paths.

**Logo usage.** The lobster appears at 24px (nav), 48px (footer / card headers), 128px+ (hero / splash). It always keeps its transparent background. It never gets placed on a light surface. It never gets rotated, recolored, or cropped.

---

## Fonts — note to user

Both typefaces are loaded from Google Fonts:

- **Press Start 2P** — free / OFL on Google Fonts, matches the brief exactly.
- **JetBrains Mono** — free / OFL on Google Fonts, matches the brief exactly.

No substitution was necessary. If you'd like to self-host the `.woff2` files to avoid the CDN dependency, drop them into `fonts/` and swap the `@import` at the top of `colors_and_type.css` for an `@font-face` block.

---

## SKILL.md

This design system is also a valid [Agent Skill](https://docs.claude.com/en/docs/claude-code/skills). Download the project folder, drop it into your Claude Code skills directory, and the `buildersclaw-design` skill is immediately invocable.
