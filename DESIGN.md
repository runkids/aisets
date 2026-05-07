# Asset Studio — Design System

> **Midnight Command Center** — A dark, layered control panel for asset hygiene work. Deep charcoal surfaces, precise typography, and a single high-energy lime accent guide the eye across data-dense scans, lint findings, and bulk actions.

**Theme:** dark-first (Linear-inspired). A light variant exists for parity but the canonical product surface is dark.

---

## 1. Tokens

### 1.1 Colors

The palette is dark-first. CSS custom property names (`--g-*`) map onto the Linear surface scale. Tailwind token aliases (e.g. `bg-g-surface`, `text-g-ink`) are defined in `tailwind.css`.

| Token                    | Dark (canonical)        | Light (Daylight Console)   | Linear name             | Role                                                                                      |
| ------------------------ | ----------------------- | -------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| `--g-canvas`             | `#08090a`               | `#fafbfc`                  | Pitch Black ↔ Off-white | Page background, dotted grid base                                                         |
| `--g-surface`            | `#0f1011`               | `#ffffff`                  | Graphite ↔ Pure White   | Default card / sidebar / topbar fill                                                      |
| `--g-surface-2`          | `#161718`               | `#f4f5f7`                  | Deep Slate ↔ Cool Wash  | Hover wash, elevated card, segmented active                                               |
| `--g-surface-3`          | `#23252a`               | `#eceef2`                  | Charcoal ↔ Cooler Wash  | Inset wells, group headers, scrim accent                                                  |
| `--g-line`               | `#23252a`               | `#e5e7eb`                  | —                       | Default 1px borders, dividers                                                             |
| `--g-line-strong`        | `#383b3f`               | `#d1d5db`                  | —                       | Hover borders, scrollbar thumb, default input outline                                     |
| `--g-input-border`       | `var(--g-line-strong)`  | `var(--g-line-strong)`     | —                       | Text input default outline                                                                |
| `--g-input-border-hover` | `var(--g-ink-4)`        | `var(--g-line-strong)`     | —                       | Text input hover outline; neutral, never semantic/accent                                  |
| `--g-input-border-focus` | `var(--g-ink-4)`        | `var(--g-line-strong)`     | —                       | Text input focus outline; neutral graphite/line treatment, not blue/coral/lime            |
| `--g-input-bg-hover`     | `var(--g-surface-2)`    | `var(--g-surface)`         | —                       | Text input hover fill; light mode avoids dirty grey washes                                |
| `--g-input-shadow-focus` | token shadow            | token shadow               | —                       | Text input focus halo using `--g-input-border-focus`                                      |
| `--g-ink`                | `#f7f8f8`               | `#0c0d0e`                  | Porcelain ↔ Near-Black  | Primary text & icons (AAA on canvas)                                                      |
| `--g-ink-2`              | `#d0d6e0`               | `#3f4045`                  | Light Steel ↔ Slate     | Secondary text, ghost button default                                                      |
| `--g-ink-3`              | `#8a8f98`               | `#62666d`                  | Storm Cloud (symmetric) | Tertiary text, descriptions, nav labels                                                   |
| `--g-ink-4`              | `#62666d`               | `#8a8f98`                  | Fog Grey (symmetric)    | Metadata, placeholders                                                                    |
| `--g-ink-5`              | `#43474d`               | `#c7c8cc`                  | —                       | Crumbs separator, very dim chrome                                                         |
| `--g-accent`             | `#e4f222`               | `#e4f222`                  | **Neon Lime**           | Focus ring, selection ring, accent wash (NOT primary CTA in light)                        |
| `--g-accent-soft`        | `rgba(228,242,34,0.14)` | `rgba(228,242,34,0.22)`    | —                       | Selected card meta, focus glow, hover wash                                                |
| `--g-accent-deep`        | `#c9d61c`               | `#c9d61c`                  | —                       | Reserved (accent button hover)                                                            |
| `--g-accent-ink`         | `#08090a`               | `#0c0d0e`                  | Pitch Black             | Text on Neon Lime when used as fill                                                       |
| **`--g-cta`**            | `#e4f222` (Neon Lime)   | **`#0c0d0e` (Near-Black)** | —                       | **Theme-swapped primary CTA fill** — `Button variant="primary"` reads this                |
| **`--g-cta-ink`**        | `#08090a`               | `#ffffff`                  | —                       | Text on `--g-cta`                                                                         |
| **`--g-cta-hover`**      | `#c9d61c`               | `#25272a`                  | —                       | `Button variant="primary"` hover                                                          |
| **`--g-active-bg`**      | `#e4f222`               | `#eceef2`                  | —                       | Theme-swapped active nav / iconbtn bg                                                     |
| **`--g-active-text`**    | `#08090a`               | `#0c0d0e`                  | —                       | Active text                                                                               |
| **`--g-active-weight`**  | `510`                   | `590`                      | —                       | Active font-weight (light needs heavier weight to read as "selected" without color punch) |
| `--g-info`               | `#5e6ad2`               | `#5e6ad2`                  | Aether Blue             | Informational highlights, links                                                           |
| `--g-info-soft`          | `rgba(94,106,210,0.16)` | `rgba(94,106,210,0.12)`    | —                       | Info chip background                                                                      |
| `--g-blue`               | `#02b8cc`               | `#02b8cc`                  | Cyan Spark              | Diff / preview accent                                                                     |
| `--g-blue-soft`          | `rgba(2,184,204,0.14)`  | `rgba(2,184,204,0.10)`     | —                       | Cyan chip / icon bg                                                                       |
| `--g-green`              | `#27a644`               | `#008d2c`                  | Emerald / Forest Green  | Success, preferred duplicate, savings                                                     |
| `--g-green-soft`         | `rgba(39,166,68,0.16)`  | `#dcfce7`                  | —                       | Success chip, run-panel result row                                                        |
| `--g-amber`              | `#f0b429`               | `#f59e0b`                  | —                       | Warning                                                                                   |
| `--g-amber-soft`         | `rgba(240,180,41,0.16)` | `#fef3c7`                  | —                       | Warning chip                                                                              |
| `--g-red`                | `#eb5757`               | `#dc2626`                  | Warning Red             | Danger, critical lint, delete                                                             |
| `--g-red-soft`           | `rgba(235,87,87,0.16)`  | `#fee2e2`                  | —                       | Danger chip                                                                               |
| `--g-purple`             | `#8b5cf6`               | `#7c3aed`                  | Amethyst / Deep Violet  | Lint badge, secondary category                                                            |
| `--g-purple-soft`        | `rgba(139,92,246,0.16)` | `#ede9fe`                  | —                       | Lint chip bg                                                                              |

### 1.2 Typography

| Token                   | Stack                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `--g-font` (body / CJK) | `'Inter Variable', 'Noto Sans TC', system-ui, -apple-system, 'Segoe UI', sans-serif`           |
| `--g-display`           | `'Inter Variable', 'Inter Tight', system-ui, sans-serif`                                       |
| `--g-mono`              | `'Berkeley Mono', 'IBM Plex Mono', 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace` |

> **Why Inter Variable?** Linear's signature typeface. Variable axis lets us use 510/590 instead of 500/600 for tighter optical weight. Noto Sans TC kept inline for CJK glyph coverage; the cascade picks it up only when Inter has no glyph.

OpenType features for Inter: `font-feature-settings: "cv01", "ss03";` applied globally on `body`.

#### Type scale

| Role                            | Font    | Size    | Weight | Line-height | Letter-spacing    |
| ------------------------------- | ------- | ------- | ------ | ----------- | ----------------- |
| Display (hero counts)           | display | 36px    | 590    | 1.1         | -0.8px            |
| Heading L (section title)       | display | 28px    | 590    | 1.2         | -0.6px            |
| Heading M (page title)          | display | 22px    | 590    | 1.27        | -0.4px            |
| Heading S (card title)          | display | 18px    | 510    | 1.33        | -0.3px            |
| KPI value                       | display | 22px    | 590    | 1.0         | -0.4px            |
| Subheading                      | body    | 16px    | 510    | 1.4         | -0.2px            |
| Body (`text-g-body`)            | body    | 13px    | 400    | 1.4         | -0.011em          |
| UI label / button (`text-g-ui`) | body    | 12px    | 510    | 1.4         | -0.011em          |
| Nav link                        | body    | 12px    | 400    | 1.4         | -0.011em          |
| Caption (`text-g-caption`)      | body    | 11px    | 510    | 1.36        | -0.011em          |
| Chip (`text-g-chip`)            | body    | 10px    | 510    | 1.4         | -0.011em          |
| Section label (uppercase)       | body    | 10px    | 510    | 1.4         | 0.06em (positive) |
| Mono — code / path / hash       | mono    | 11–12px | 400    | 1.5         | -0.013em          |
| Mono — value (KPI delta)        | mono    | 10px    | 510    | 1.4         | -0.013em          |

> Section labels are the _only_ uppercased text and the _only_ positive tracking values. Everywhere else, tracking is negative or zero — Linear's signature.

### 1.3 Spacing

Base unit **4px**. Density: **compact**.

```
--space-4: 4px    --space-20: 20px   --space-48: 48px
--space-8: 8px    --space-24: 24px   --space-56: 56px
--space-12: 12px  --space-28: 28px   --space-64: 64px
--space-16: 16px  --space-32: 32px   --space-80: 80px
                  --space-40: 40px   --space-96: 96px
```

| Layout constant         | Value                           |
| ----------------------- | ------------------------------- |
| Section gap             | 24px                            |
| Card padding (default)  | 12px                            |
| Card padding (elevated) | 24px vertical / 16px horizontal |
| Element gap (inline)    | 8px                             |
| Form row gap            | 8px                             |

### 1.4 Radius

| Token      | Value  | Used by                                                              |
| ---------- | ------ | -------------------------------------------------------------------- |
| `--g-r-xs` | 2px    | Tags, severity dot                                                   |
| `--g-r-sm` | 4px    | Badges, count chips                                                  |
| `--g-r-md` | 6px    | **Buttons, inputs, search, seg-toggle, icon buttons, default cards** |
| `--g-r-lg` | 12px   | Drawer, modal, run panel, settings, command palette, nested card     |
| `--g-r-xl` | 16px   | Dropzone (precheck)                                                  |
| `pill`     | 9999px | Toast, scrollbar thumb, scroll-top-btn, status chips                 |

> The big shift: most cards/rows that used to be 14px (`--g-r-lg` legacy) are now **6px (`--g-r-md`)** to match Linear's tight aesthetic. Only floating overlays keep 12px.

### 1.5 Shadows & Elevation

Elevation is built primarily from **inset 1px borders + tight 4px drop shadows**, not from soft diffuse blurs.

| Token              | Value                                                                | Used by                                                             |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `--g-shadow-sm`    | `0 2px 4px rgba(0,0,0,0.4)`                                          | Default card, active seg-toggle                                     |
| `--g-shadow-md`    | `0 4px 12px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.3)`              | Card hover, bulk bar, selected glow                                 |
| `--g-shadow-lg`    | `0 24px 48px -12px rgba(0,0,0,0.6), 0 8px 16px -8px rgba(0,0,0,0.4)` | Toast, scroll-top-btn                                               |
| `--g-shadow-pop`   | `0 4px 32px rgba(8,9,10,0.6), 0 12px 24px -8px rgba(0,0,0,0.5)`      | Drawer, modal, run panel, settings, command palette                 |
| `--g-shadow-inset` | `inset 0 0 0 1px #23252a`                                            | Elevated card border (replaces solid border on Deep Slate surfaces) |
| `--g-shadow-focus` | `0 0 0 2px rgba(228,242,34,0.4)`                                     | Focus ring (Neon Lime, 2px)                                         |

### 1.6 Easing & Duration

| Token             | Value                               | Used for                                  |
| ----------------- | ----------------------------------- | ----------------------------------------- |
| `--g-ease`        | `cubic-bezier(0.4, 0, 0.2, 1)`      | Standard transitions (120–180ms)          |
| `--g-ease-out`    | `cubic-bezier(0.16, 1, 0.3, 1)`     | Slide-in / slide-up panels (200–300ms)    |
| `--g-ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Press / scale feedback on cards & buttons |

| Speed                | Duration      | Where                             |
| -------------------- | ------------- | --------------------------------- |
| Hover / focus        | 120ms         | Buttons, links, chips             |
| Press / scale        | 100ms         | Pressable cards                   |
| Modal / drawer enter | 240ms         | Drawer slide, modal fade-scale    |
| Modal / drawer exit  | 160ms         | (60–70% of enter — Material rule) |
| Toast in             | 240ms         | slideUp + fade                    |
| Skeleton shimmer     | 1.5s linear ∞ | Loading rows                      |

---

## 2. Surfaces & Layers

| Level            | Token           | Hex (dark) | Where it lives                                           |
| ---------------- | --------------- | ---------- | -------------------------------------------------------- |
| **0** Canvas     | `--g-canvas`    | `#08090a`  | Page background, dotted grid base, scrim base            |
| **1** Graphite   | `--g-surface`   | `#0f1011`  | Sidebar, topbar, default cards, list rows                |
| **2** Deep Slate | `--g-surface-2` | `#161718`  | Elevated cards, hover wash, drawer body, modal body      |
| **3** Charcoal   | `--g-surface-3` | `#23252a`  | Inset wells, code blocks, group headers, scrollbar track |

> **Dotted main canvas:** keep the existing `radial-gradient(circle at 1px 1px, var(--g-line) 1px, transparent 0)` at `24px 24px`. In dark mode this becomes faint Charcoal dots on Pitch Black — preserves the "control panel grid" feel without adding light.

---

## 3. Shell Layout

```
┌──────────────────────────────────────────────────┐
│ .app  (grid: 240px | 1fr, height: 100vh)         │
│ ┌────────┬───────────────────────────────────────┐│
│ │ .sb    │ .main                                 ││
│ │ Graph- │ ┌────────────────────────────────────┐││
│ │ ite    │ │ .topbar (frosted Pitch Black, z:10)│││
│ │        │ ├────────────────────────────────────┤││
│ │ brand  │ │ .content (flex)                    │││
│ │ nav    │ │ ┌──────┬─────────────────────────┐ │││
│ │ footer │ │ │filter│ .content-scroll          │ │││
│ │        │ │ │rail  │  ┌─────────────────────┐ │ │││
│ │        │ │ │220px │  │ .page (max 1600px)  │ │ │││
│ │        │ │ │      │  │  .page-h (title)    │ │ │││
│ │        │ │ │      │  │  [sticky filters]   │ │ │││
│ │        │ │ │      │  │  [view content]     │ │ │││
│ │        │ │ │      │  └─────────────────────┘ │ │││
│ │        │ │ └──────┴─────────────────────────┘ │││
│ │        │ └────────────────────────────────────┘││
│ └────────┴───────────────────────────────────────┘│
└──────────────────────────────────────────────────┘
```

### 3.1 Sidebar `.sb`

- The sidebar sits under the global topbar and is part of the dotted canvas, not a line-separated slab: `background: transparent`, no right border, 12px left/bottom padding, and no right padding so sidebar cards align flush to the content boundary.
- Product brand is not rendered inside the sidebar. It lives in the global topbar (§3.2) so the brand and page chrome read as one header.
- Sidebar content is cardized: project switcher, each nav group, and footer use `--g-surface` fill, `--g-line` border, 6px radius, and `--g-shadow-sm`. Nav groups use 4px inner padding and stack rows with a 4px gap so active fills never visually merge. There are no full-height divider lines.
- **Nav section label**: 10px uppercase Storm Cloud, +0.06em tracking, 8px bottom padding
- **`.sb-link`**: 6px 8px padding, **6px radius** (matches `RailItem` active shape), Inter 13px / 400, Storm Cloud default
  - Non-active hover: light uses a medium `--g-surface-2` wash so it remains readable without becoming selected, and flips the count badge to `--g-surface` so the chip stays distinct; dark steps to `--g-surface-3` + `--g-ink` so it remains visible on the dark sidebar
  - **Active**: bg `--g-accent` (Neon Lime), text `--g-accent-ink` (Pitch Black), font-weight 510. Active hover keeps the exact active bg/text colors in both themes. _No_ shadow.
  - Focus: 2px Neon Lime ring (`--g-shadow-focus`)
- **Badge** in nav row: mono 11px on `--g-surface-3` background, 4px radius, Storm Cloud text. Tonal variants use `*-soft` bg + matching base color text
- **Footer**: cardized surface row with 32×32 user mark + name + team label (Storm Cloud); no top divider line
- **Responsive ≤960px**: collapse to 64px icon-only rail

### 3.2 Topbar `.topbar`

- Global header spans the full app width (`grid-column: 1 / -1`) and is transparent over the dotted canvas: `background: transparent`, no bottom border, no backdrop blur.
- `padding: 0 20px`, `z-index: 10`, `height: 60px`.
- Layout: left brand block (40×40 official raster app icon, 6px radius, `--g-surface` + `--g-shadow-sm`, name + uppercase tag) → centered command search trigger → right action cluster with **`<Tooltip><IconButton>FolderPlus</IconButton></Tooltip>`** (Add Project, always visible) → **`<IconButton>RefreshCw</IconButton>` scan trigger** (Rescan). The topbar intentionally does not render breadcrumbs; page identity lives in the active sidebar item and page/card titles so the header stays balanced. At wide widths the search trigger is absolutely centered in the topbar (GitHub-style balanced header); below 1180px it participates in the flex row between brand and actions; at ≤480px it collapses to an icon-only command trigger. Clicking the scan trigger starts a scan and opens a compact hover/focus status dropdown anchored to the icon; hovering or keyboard focus keeps the dropdown visible. The dropdown uses `--g-surface-2`, `--g-line`, 12px overlay radius, `--g-shadow-pop`, a Loader/Check/X icon, localized phase label, optional mono `current/total`, and a 6px determinate bar (`--g-accent` while running, `--g-green` on completion, `--g-red` on failure). Successful completion auto-dismisses quickly after 1.2s so it does not cover Settings rows; failures remain visible for 3.5s. It does **not** place inline progress text in the topbar and does **not** show a global blue "Scanning" notice during the pending state; completion/error still uses toast/notice.
- **Breadcrumbs:** topbar breadcrumbs are removed. No slash separators, no brand crumb, no page crumb, and no inline totals. Counts belong inside page cards or side/filter cards.
- **Search input / trigger** `.search`:
  - Wide topbar width: `min(520px, 42vw)`, centered in the header. The centered wrapper sits at z 20 inside the topbar stacking context so transparent left/right flex spacers cannot intercept clicks; the actual button keeps `pointer-events: auto`. Below 1180px: `min(360px, 36vw)` in-flow between crumbs and actions. At ≤480px: icon-only 32×32 trigger with `aria-label` preserved.
  - Background `--g-surface` (white in light mode, Graphite in dark mode) with a strong token border so the field stays visible on the frosted topbar
  - Border `1px solid var(--g-line-strong)` plus `--g-shadow-sm` so the centered trigger reads as a discrete header control without diffuse elevation
  - 6px radius, 10px 12px padding, Inter 13px / 400 / Light Steel
  - Placeholder/trigger copy: localized "Search or jump to..." phrasing, so the command palette reads as navigation as well as asset search.
  - Hover: bg `--g-surface-2`, border `--g-line-strong` (theme-aware; never hard-code separate light/dark colors)
  - Focus: border `--g-accent`, box-shadow `--g-shadow-focus`, bg `--g-surface`
  - Press: subtle `scale(0.99)` only; disabled by reduced motion
- Command palette search includes pages, assets, paths, and enabled Custom Filters. Selecting a Custom Filter navigates to Browse and applies that saved filter immediately.
- **Keyboard hint** `Keycap`: shared `ui/src/components/ui/Keycap.tsx` component using token-backed Tailwind classes. Default size is mono 12px / Storm Cloud, `--g-surface-2` bg, 1px strong line border, 4px radius, 2px 8px padding. Used by topbar search, command palette, Settings hotkey rows, and compact tooltip shortcut pills. Topbar command-palette trigger shows `⌘ P`, matching the implemented shortcut.

### 3.3 Rail

Canonical shared primitive: `Rail` / `RailSection` / `RailItem` from `ui/src/components/ui/Rail.tsx`. The primitive owns rail body, section, active item, icon, label, count rendering, responsive variants, and active / inactive / hover states through CVA variants.

- Filter rail is compact but readable: 200px wide with 6px horizontal rail padding, transparent rail body, and no right divider line. Browse and Settings add an 8px left inset to the first rail so the rail does not touch the shell sidebar after the sidebar's right padding is removed. The dotted canvas remains visible between rail cards and content cards.
- Each `RailSection` is a compact card: `--g-surface` fill, `--g-line` border, 6px radius, `--g-shadow-sm`, 4px inner padding.
- Section label: 10px uppercase Storm Cloud
- **`RailItem`**: full-width button, 6px 8px padding, 6px radius, Inter 12px / 400 / Light Steel
  - Inactive: transparent background, `--g-ink-2` text
  - Hover: `color-mix(in srgb, var(--g-surface-2) 54%, transparent)` bg, `--g-ink` text, 1px inset `--g-line`
  - **Active**: `--g-active-bg` bg, `--g-active-text` text, `--g-active-weight` weight
- Count badge: mono 11px / Storm Cloud (Pitch Black on accent when active)
- Filter variant is used by Browse and hidden ≤1024px. Settings uses the settings variant and collapses to an icon-only 64px rail ≤768px.

### 3.4 Main canvas `.main`

- Background: `var(--g-canvas)` (Pitch Black)
- Dotted grid: `radial-gradient(circle at 1px 1px, var(--g-line) 1px, transparent 0) 24px 24px`. Dots are Charcoal in dark mode — almost invisible but present, gives the "control panel" texture.

### 3.5 Project Switcher `.project-switcher`

- Lives in `.sb-project-switcher` under the brand and uses the same compact chrome as sidebar controls: `--g-surface` fill, `--g-line` border, 6px radius, and `--g-shadow-sm`. The wrapper does not draw a lower divider; spacing separates the switcher from navigation.
- Trigger: 44px minimum height, 8px gap, 10px inline padding, 24px icon well on `--g-surface-3`; hover/open state lifts to `--g-surface-2` with `--g-line-strong` border.
- Menu: anchored popover, matches the trigger width on desktop and caps to `min(320px, calc(100vw - 32px))` on compact icon-only layouts, `--g-surface-2` in both themes so the dropdown lifts away from the sidebar/canvas without hard-coded colors, 12px radius, `--g-shadow-pop`, 6px inner padding, max height `min(480px, calc(100vh - 88px))`.
- Header stays compact: 15px display title + 12px workspace meta, bottom divider `--g-line`.
- Workspace rows are interactive `menuitemradio` options in the same row grammar as projects, but they are visually treated as the **parent context** rather than another asset scope. Rows keep 4px vertical separation so hover fills do not visually merge. Workspace rows use the shared workspace avatar well (uploaded image or initial fallback). The active workspace uses a subtle row surface (`--g-surface` in light mode, `--g-surface-3` in dark mode) + `--g-line-strong` inset + check icon instead of the full active fill, so it stays distinct from the `--g-surface-2` dropdown background without competing with the selected project scope. Inactive workspace rows show project counts. Selecting a workspace keeps the menu open, clears project scope, invalidates the catalog, and reloads the active workspace's project list in-place so the user can continue choosing `All projects` or a project without reopening the switcher. Creation and deletion are intentionally excluded from this compact switcher and live in Settings only.
- Project options are 40px minimum rows with 10px gaps, 4px vertical separation, 6px radius, uploaded project image or neutral `FolderKanban` fallback, strong label, mono secondary path/count, and a right-side mono count chip. The `All projects` option also renders the right-side count chip so its statistics align with individual project rows. Project options are scoped to the active workspace only. The selected project scope keeps the full active treatment; hover/focus uses `--g-surface-3`.
- Hover logic matches sidebar rows: inactive hover uses the full `--g-surface-3` wash in both themes (not a transparent `--g-surface-2` mix) so it separates from the menu background and active workspace row; inactive count chips flip to `--g-surface`, and active hover keeps the exact `--g-active-bg` / `--g-active-text` colors. Selected project uses the same active treatment as sidebar active rows, with the check icon inheriting the active text color. Active count chips keep a distinct chip surface with an inset token-mixed contrast edge; dark mode uses the inverse active text/background pair for a solid dark chip on the neon active fill, while light mode keeps the neutral active recipe. Do not use left/right colored inset stripes or side-line accents in the switcher menu. Option copy remains left-aligned; counts stay as subdued mono chips.
- Press scale is disabled under `prefers-reduced-motion`.

---

## 4. Sticky Elements & Z-Index

| Element                  | Position             | Top                      | Z   | Style                                        |
| ------------------------ | -------------------- | ------------------------ | --- | -------------------------------------------- |
| `.topbar`                | static (flex column) | —                        | 10  | Frosted Pitch Black + blur(12px)             |
| `.opt-filters-wrap`      | sticky               | 0                        | 4   | Frosted (`canvas 92% + blur 12px`)           |
| `.bulkbar` (top)         | sticky               | 0                        | 5   | Pitch Black bg / Porcelain text / 6px radius |
| `.bulkbar.opt-bulkbar`   | sticky               | bottom 16px              | 10  | Same, bottom-anchored                        |
| `.lint-controls`         | sticky               | 0                        | 10  | Solid `--g-canvas` (no blur)                 |
| `.lint-group-h`          | sticky               | `var(--lint-controls-h)` | 5   | `--g-surface-3` Charcoal header              |
| `.list-row[data-header]` | sticky               | 0                        | 2   | `--g-surface-2`                              |
| `.dv2-tabs`              | sticky               | 0                        | 2   | Drawer tab strip                             |

### Frosted glass recipe

```css
background: color-mix(in srgb, var(--g-canvas) 85%, transparent);
backdrop-filter: blur(12px);
-webkit-backdrop-filter: blur(12px);
```

> Frosted overlays must be visible on top of _both_ the dotted canvas and the Graphite cards behind them — text must remain ≥4.5:1 contrast against whatever sits beneath.

### Z-index scale (canonical)

| Range | Elements                             |
| ----- | ------------------------------------ |
| 2     | List headers, drawer tabs            |
| 4–5   | Filter wraps, bulk bars, lint groups |
| 10    | Topbar, lint controls, opt bulkbar   |
| 50–51 | Drawer backdrop / drawer             |
| 60    | Settings panel                       |
| 100   | Command palette                      |
| 120   | Modal / prompt / confirm dialogs     |
| 200   | Toasts and tooltips                  |
| 180   | Run panel                            |
| 200   | Toast, chart tooltip                 |

---

## 5. Components

> All shared UI primitives live in `ui/src/components/ui/` and use CVA + `cn()` for variant/state styling. Page components compose these primitives with Tailwind utility classes.

### 5.1 Buttons

Canonical shared primitive: `ui/src/components/ui/Button.tsx`.

React API:

```tsx
<Button variant="primary" size="sm" leadingIcon={<Download size={14} />}>
  Export
</Button>
```

Variants are expressed via CVA (`cva()`) with token-backed Tailwind utilities, composed with `cn()`.

Base: `height: 32px; padding: 0 12px; border-radius: 6px; font: 510 13px/1.4 Inter; transition: 120ms var(--g-ease); letter-spacing: -0.012em;`

| Variant     | Background                                       | Text          | Border                      | Hover                                        | Notes                                |
| ----------- | ------------------------------------------------ | ------------- | --------------------------- | -------------------------------------------- | ------------------------------------ |
| `primary`   | **`--g-cta`** (dark Neon Lime, light Near-Black) | `--g-cta-ink` | transparent / none          | bg `--g-cta-hover`                           | **Singular per screen.**             |
| `secondary` | `--g-surface`                                    | `--g-ink`     | `1px solid --g-line-strong` | bg `--g-surface-2`, border `--g-line-strong` | Default action                       |
| `ghost`     | transparent                                      | `--g-ink-2`   | transparent / none          | bg `--g-surface-2`, text `--g-ink`           | Tertiary                             |
| `link`      | transparent                                      | `--g-ink-2`   | none                        | text `--g-ink`                               | 0/6px padding only                   |
| `danger`    | `--g-red`                                        | `--g-canvas`  | transparent / none          | brightness 1.08                              | Destructive                          |
| `size="sm"` | inherit                                          | inherit       | inherit                     | —                                            | 26px height, 10px padding, 12px font |

**Press state (all variants):** `transform: scale(0.97)` for 100ms with `--g-ease-spring`; disabled under `prefers-reduced-motion`.
**Disabled:** opacity 0.38, cursor not-allowed.
**Loading:** show 14px spinner (icon-spin), text stays.

### 5.2 Icon Button

Canonical shared primitive: `IconButton` from `ui/src/components/ui/Button.tsx`.

- 32×32, 6px radius, transparent bg, `--g-ink-2` icon
- Sizes: `sm` 26×26, `md` 32×32, `lg` 36×36
- Hover: bg `--g-surface-2`, icon `--g-ink`
- Active (toggled): bg `--g-active-bg`, icon `--g-active-text`
- Loading: SVG spins 900ms linear ∞
- Hit area extended to 44×44 via `::before` pseudo for mobile compliance

### 5.3 Tabs / Segmented Toggle

Canonical shared primitives: `Tabs` from `ui/src/components/ui/Tabs.tsx` for content tabs, and `SegmentedControl` from `ui/src/components/ui/SegmentedControl.tsx` for compact toolbar toggles (Browse view / size / background).

React API:

```tsx
<Tabs
  variant="segment"
  size="md"
  value={tab}
  items={items}
  onChange={setTab}
  ariaLabel="View"
/>
```

- `variant="segment"`: wrapper `--g-surface-2` bg, `1px solid --g-line` border, 6px radius, 3px inner padding, `--g-shadow-inset`; active child uses `--g-surface`, `--g-ink`, `--g-shadow-sm`.
- `variant="pills"`: no wrapper chrome; children use line borders and active `--g-active-bg` / `--g-active-text`.
- `variant="underline"`: drawer/detail tabs only; full-width token surface with bottom `--g-line` divider, 56px triggers, 16px inter-tab gap, active child uses `--g-ink` + 2px `--g-accent` underline.
- Sizes: `sm` = 26px height, `md` = 32px height; `underline` normalizes both sizes to 56px for drawer tap targets.
- Children: Inter 12–13px / 510 / token text. Icons 13px.
- `Tabs variant="segment"` is the unified page-tab recipe for content tabs and tab-like sort/status rows. Duplicates Exact/Similar + sort, Browse status filters, Projects sort, and Settings theme selection all use the same wrapper (`--g-surface-2`, `--g-line`, 6px radius, inset shadow) with active children on `--g-surface` + `--g-ink` + `--g-shadow-sm`.
- `SegmentedControl`: reserved for compact toolbar toggles (`text`, `icon`, `fixed`) such as Browse view / size / background. Its wrapper uses the same 32px control height, 6px radius, `--g-surface-2` background, token border, inset shadow, and 2px inner padding. Active children use the same selected recipe as segment tabs: `--g-surface` background, `--g-ink` text, and `--g-shadow-sm`; do not use `--g-active-*` fills for these tab-like toolbar toggles.
- Focus: every tab/toggle gets `--g-shadow-focus`.

### 5.4 Card

Canonical shared primitive: `Card` / `CardBody` from `ui/src/components/ui/Card.tsx`.

React API:

```tsx
<Card variant="default" padding="md" clickable>
  ...
</Card>
```

| Variant    | Background      | Border / shadow                                                            | Radius     | Notes                                    |
| ---------- | --------------- | -------------------------------------------------------------------------- | ---------- | ---------------------------------------- |
| `default`  | `--g-surface`   | 1px `--g-line`, `--g-shadow-sm`; hover `--g-line-strong` + `--g-shadow-md` | `--g-r-md` | Default card / list container            |
| `elevated` | `--g-surface-2` | `--g-shadow-inset`                                                         | `--g-r-lg` | Drawer hero, modal head, floating panels |
| `nested`   | `--g-canvas`    | none                                                                       | `--g-r-lg` | Inset card inside elevated surfaces      |

Padding is explicit through `padding="none | sm | md | lg"`. Default is `none` for backwards-compatible composition.

### 5.7 Badge / Chip

Canonical shared primitive: `Badge` from `ui/src/components/ui/Badge.tsx`.

React API:

```tsx
<Badge tone="amber">Warning</Badge>
```

- Height 20px, 9999px radius (pill), mono **10px / 510**, tabular nums
- Default tone: bg `--g-surface-3`, text `--g-ink-3`
- `line`: transparent bg, 1px `--g-line-strong` border, `--g-ink-2` text
- Tonal variants `red | amber | green | blue | purple | info`: `*-soft` bg + base color text
- Alias tones: `danger → red`, `warning → amber`
- `accent`: `--g-accent` bg + `--g-accent-ink` text (use sparingly — counts as accent budget)

### 5.8 Text Input

Canonical shared primitive: `TextInput` from `ui/src/components/ui/TextInput.tsx`. Shell, button trigger, control, icon, affix, size, and state styles are co-located via CVA variants and token-backed Tailwind classes.

React API:

```tsx
<TextInput
  variant="search"
  size="md"
  icon={<Search size={16} />}
  invalid={hasError}
/>
```

- Base: 32px height (`md`) or 26px (`sm`), 6px radius, 10px inline padding, Inter/mono text per context, 120ms token transitions
- `default`: `--g-surface` bg + `1px solid --g-input-border` border so light-mode inputs render white by default
- `outline`: transparent bg + `1px solid --g-line` border
- `subtle`: `--g-surface-3` bg + transparent border
- `search`: `--g-surface` bg + `--g-input-border` border for toolbar/search contexts; this keeps light-mode search fields white instead of grey
- `command`: transparent bg + transparent border + no shell focus ring for Command Palette header input
- Hover: border `--g-input-border-hover` + bg `--g-input-bg-hover`; hover stays neutral in both themes, and light mode keeps the fill white to avoid dirty grey or accent/coral halos
- Placeholder: `--g-ink-3`
- Focus: border `--g-input-border-focus`, `--g-input-shadow-focus`, bg `--g-surface` (`command` stays borderless and shadowless). Focus uses a quiet neutral outline in both themes, not blue, coral, or lime. Dialog prompt inputs and legacy inline search fields follow the same default white/Graphite input surface.
- Invalid: border `--g-red`, `aria-invalid=true`

### 5.8.1 Checkbox

Canonical shared primitive: `Checkbox` from `ui/src/components/ui/Checkbox.tsx`, backed by Radix Checkbox and styled with CVA.

- Base: square control, 4px radius, `--g-surface` bg, `--g-line-strong` border, token focus ring
- Sizes: `sm` 14px, `md` 16px, `lg` 20px
- Checked / indeterminate: `--g-accent` fill, `--g-accent-ink` Lucide check icon
- Browse and duplicate card selection uses the checkbox directly in the top-right corner; do not add a large outer shell around it.

### 5.9 Asset Card `.acard`

- `--g-surface` bg, `1px solid --g-line` border, **6px radius**, flex column
- Hover: `transform: translateY(-2px)` + `--g-line-strong` border + `--g-shadow-md`
- **Selected**: `--g-accent` border, 2px Neon Lime ring outset, `--g-shadow-md`, meta region tinted `--g-accent-soft`. A 1000ms `selectedPulse` plays once.
- Internal layout unchanged:
  ```
  .acard
    .acard-thumb     1:1, --g-surface-2 bg, border-bottom --g-line
      img            max 82% w/h, object-fit contain
      .acard-flags   absolute top-left, opaque token-mixed status flags (surface + 18% tone) with 52% tone border, 590 text, Lucide icon, and `--g-shadow-sm`; must stay readable on both white thumbnails and dark card surfaces
      .acard-check   absolute top-right token checkbox only, 0→1 opacity on hover/selected
    .acard-meta      8px 10px padding
      .acard-name    mono 12px / 510, truncate
      .acard-path    mono 10px / Storm Cloud, truncate
      .acard-row     chip stack, 4px gap; compact reference count badge (`N↗`) wrapped in custom `<Tooltip>` with localized full reference count
  ```
- Thumb backgrounds are driven by the global image background preference: `checker` (14px token checker), `light`, or `dark`; the Browse toolbar may still change this global preference inline.

### 5.10 Optimize Row `.opt-row`

- Grid: `28px 64px 1fr 220px 140px` (checkbox / 64px thumb / text / chips / savings)
- 6px radius, `--g-surface` bg, 1px `--g-line` border, 12px padding
- Hover: `transform: translateX(2px)` + border `--g-line-strong`
- Selected: same Neon Lime ring as `.acard`
- Savings:
  - Original: mono 11px / Fog Grey, strikethrough
  - Target: mono 16px / 590 / `--g-green`
  - Percent: mono 11px / `--g-green`

### 5.11 Duplicate Group `.dgroup`

- Container: `--g-surface` bg, 1px `--g-line`, **6px radius**
- Header `.dgroup-h`: `--g-surface-3` (Charcoal) bg, border-bottom `--g-line`, padding 8px 12px. SHA in mono 11px / Storm Cloud. Spacer + action buttons right.
- Body `.dgroup-body`: auto-fill grid (min 160px), 12px gap, 16px padding
- Tile `.dgroup-tile`: 1px `--g-line`, 6px radius, `--g-surface` bg
- **Preferred tile**: `--g-green` border + 2px Emerald ring + green badge top-right

### 5.12 Drawer `.drawer`

- 480px wide (95vw max), fixed right, slide-in 240ms `--g-ease-out`
- Background `--g-surface-2` (Deep Slate, elevated)
- Backdrop: `rgba(8,9,10,0.6)` + `backdrop-filter: blur(4px)`
- Structure: `.drawer-h` (compact header, 8px block / 16px inline padding, border-bottom `--g-line`) → compact sticky tab strip (6px top / 4px bottom / 16px inline padding, no bottom divider) → `.drawer-body` (scrollable, 16px padding)
- **Enhanced variant `.dv2`**: min(680px, 95vw)
  - Hero area: `--g-surface-3` Charcoal bg with subtle `--g-info` linear-gradient overlay
  - Sticky tab strip: `--g-surface-2` bg, active tab gets a 2px **Neon Lime** underline + Porcelain text
- Close button: top-right `.iconbtn`, ESC also dismisses

### 5.13 Modal

Canonical shared primitive: `Modal` from `ui/src/components/ui/Modal.tsx`. Shared overlay, viewport, surface, header, body, footer, and drawer surfaces live in `ui/src/components/ui/DialogShell.tsx`; `Modal`, `PromptDialog`, `ConfirmDialog`, Command Palette, and Asset Drawer compose that shell instead of duplicating backdrop/panel classes.

- Centered on `rgba(8,9,10,0.6)` backdrop + blur(4px), z 120 so dialogs opened from the asset drawer layer above the drawer/backdrop stack.
- Sizes: `sm` 520px, `md` 760px, `lg` 960px.
- Frame: `--g-surface` bg, `1px solid --g-line-strong`, 12px radius, `--g-shadow-pop`.
- Header/footer: `--g-surface` bg, 20px horizontal padding, no internal divider lines; use whitespace to separate regions. Footer actions align right by default.
- Body padding: `md` (20px) or `none` for code/script previews.
- Enter: fade backdrop + `slideUp2` 200ms `--g-ease-out`; reduced motion must disable transforms.

### 5.14 Toast

Canonical shared primitive: `Toast` from `ui/src/components/ui/Toast.tsx`; `ToastProvider` owns queue/timers only.

- Stack: fixed bottom-right 24px, z 200, max `min(420px, 90vw)`, 8px gap.
- Toast frame: rounded 12px, `--g-surface` solid background, `--g-line-strong` border, `--g-shadow-pop`, click dismiss, focus ring `--g-shadow-focus`.
- Content uses a compact status icon well plus text on the solid toast surface, so status always includes icon + text, not color alone, and remains readable over thumbnails or dark panels. Do not reuse the full `Notice` soft-tint panel inside toast; its translucent backgrounds blend into image cards.
- Auto-dismiss defaults: 3.5s; danger 6s.

### 5.15 Command Palette `.cmdk`

- 580px wide, top offset 12vh
- Background `--g-surface-2` Deep Slate, 12px radius, `--g-shadow-pop`
- Border `1px solid --g-line` only; do **not** add an outer focus ring to the palette frame
- Backdrop blur(8px) on `rgba(8,9,10,0.5)`
- **Input**: rendered through `TextInput variant="command"` inside a `--g-surface` header strip, 15px / 400 / Porcelain, no input border or focus outline, padding 14px 16px on the strip, bottom 1px `--g-line`
- List items: 8px 10px padding, 6px radius, hover bg `--g-surface-3`
- Active / keyboard-highlighted item uses a neutral popup selection wash (`--g-surface-2` in light mode, `--g-surface-3` in dark mode) with `--g-ink` text and 590 weight. Do not use brand/CTA fills such as `--g-active-bg`, Neon Lime, or dark navy for popup list highlight states.
- Page commands show only icon + label; do not show `G O` / `G B` style hints unless those key chords are actually implemented
- Asset results show a 34px tokenized checker thumbnail, mono filename, dim mono path, and right-aligned project name
- Group label: 10px uppercase Storm Cloud
- Empty state: centered Storm Cloud text + Inter 13px helper

### 5.16 Run Panel `.opt-run-panel`

- Fixed bottom-right, min(680px, 100vw - 48px)
- `--g-surface-2` bg, 12px radius, `--g-shadow-pop`, slideUp 240ms
- **Progress bar**: 6px height, track `--g-surface-3`, fill `--g-accent` (or `--g-green` for completion). 180ms transition.
- Max-height: min(78vh, 760px)
- Result rows: success bg `--g-green-soft` + green icon; skipped bg `--g-red-soft` + red icon; pending: skeleton shimmer

### 5.17 Bulk Action Bar `.bulkbar`

- Sticky top-0 (default) or sticky bottom-16px (`.opt-bulkbar`)
- Background `--g-surface-3` (Charcoal) — _not_ Pitch Black, to lift visually off the dotted canvas
- 1px inset `--g-line-strong`, **6px radius**, `--g-shadow-md`
- Padding 8px 12px, height 44px
- Buttons `.bulkbar-btn`: ghost-style, 6px radius, hover `--g-surface-2` overlay
- Danger variant: `--g-red` bg + `--g-canvas` text

### 5.18 Dropzone `.precheck-dropzone`

- Min-height 160px, **1.5px dashed `--g-line-strong`**, **16px radius** (only place we use xl)
- Background `--g-surface` (Graphite)
- States:
  - Hover: border `--g-ink-3`, `--g-shadow-sm`
  - **Drag-over**: solid 2px `--g-accent` border, bg `--g-accent-soft`, 2px outer Neon Lime ring
  - Disabled: opacity 0.38

### 5.19 Empty State

Canonical shared primitive: `EmptyState` from `ui/src/components/ui/EmptyState.tsx`.

React API:

```tsx
<EmptyState
  size="md"
  align="center"
  tone="neutral"
  title="No assets"
  description="Try another filter."
/>
```

- Sizes: `sm` compact panel, `md` default 64px vertical padding, `lg` broad empty page.
- Align: `center` or `left`.
- Tones: `neutral`, `info`, `warning`; icon circle uses token soft backgrounds.
- Icon: Lucide icon in 40–64px circle, never emoji.
- Title: Inter display 17px / 510 / `--g-ink`, -0.013em tracking.
- Helper: Inter 13px / 400 / `--g-ink-3`.
- Optional CTA below via `action` prop.

### 5.20 Scroll-to-top `.scroll-top-btn`

- Fixed bottom-right 24px, 36px circle
- `--g-surface-2` bg, 1px `--g-line-strong` border, `--g-shadow-md`
- Hover: bg `--g-surface-3`, `translateY(-2px)`, icon `--g-ink`
- Show after 480px scroll

### 5.22 Directory Picker (`Select Project Directory` modal)

Used by `DirectoryPickerModal.tsx`. Sits inside a standard `.modal` (§5.13). Header copy stays localized and runtime-neutral: it describes directories readable by the environment running Asset Studio, never devcontainer-only mounts or repo-specific example paths. If the Add-project start path setting is empty, the picker starts from the API server's current working directory.

Structure:

```
.modal
  .modal-head      title + description + close
  .modal-body
    .directory-picker
      .directory-path-row       [.field (HardDrive icon + path input)] [Go button]
      .directory-panel          inset Pitch Black well, --g-shadow-inset border
        .directory-list
          .directory-item       grid: 18px icon | 200px name | 1fr code path
          .directory-item       (one per subdir)
          ...
  .modal-foot      [current path, mono Storm Cloud] [Cancel] [Add This Directory primary CTA]
```

- **`.directory-picker`**: vertical stack, 12px gap, min-height 320px
- **`.directory-path-row`**: input + Go button inline; input uses `TextInput` with HardDrive icon prefix
- **`.directory-panel`**: `--g-canvas` Pitch Black inset well with 1px Charcoal inset border (`--g-shadow-inset`), 6px radius — visually a recessed dark panel inside the Deep Slate modal body
- **`.directory-item`**: `display: grid; grid-template-columns: 18px minmax(0, 200px) 1fr; gap: 10px;` — folder icon + name + truncated full path. Hover bg `--g-surface-2`, focus 2px Neon Lime ring. Each row 32px tall.
  - Name: Inter 13px / 510 / Porcelain
  - Code path: mono 11px / Fog Grey, right-aligned, truncates with ellipsis
- **Error state**: inaccessible / missing / invalid paths render an `EmptyState` inside `.directory-panel` using an AlertTriangle icon, localized title, and the API error text (including the attempted path). Directory-listing queries do not retry these 4xx responses, so the panel must settle quickly instead of showing an indefinite loading state.
- **Footer**: `justify-content: space-between` so the current path label sits left and `[Cancel] [Add This Directory]` action group sits right. The Add CTA uses the primary button variant (`--g-cta`) and counts as the screen's primary action. Disable it unless the current listing resolved successfully.

### 5.23 Tooltip `<Tooltip>` (custom, non-native)

> **NEVER use the browser's native `title` attribute for tooltips.** Always wrap the trigger in `<Tooltip>` from `ui/Tooltip.tsx`. Native tooltips have no styling control, no shortcut hint, no animation, and inconsistent timing across OSes.

**API**

```tsx
<Tooltip label="Add Project" shortcut="⌘N" placement="bottom" delay={200}>
  <IconButton aria-label="Add Project" onClick={...}><FolderPlus size={16} /></IconButton>
</Tooltip>
```

Props:
| Prop | Default | Notes |
|------|---------|-------|
| `label` | required | Visible text or ReactNode |
| `shortcut` | — | Optional keyboard hint, rendered in mono pill |
| `placement` | `'bottom'` | `'top' \| 'bottom' \| 'left' \| 'right'` |
| `delay` | `200` | ms before showing on hover (focus is instant) |
| `disabled` | `false` | Suppress entirely (e.g. when content is empty) |

**Rendering**

The component clones the single child element and adds `onMouseEnter` / `onMouseLeave` / `onFocus` / `onBlur` (preserving any handlers already on the child) plus an `aria-describedby` link to the floating label. Wrapping happens in a thin `.tooltip-anchor` `<span>` so positioning is scoped.

**Visual**

- Background `--g-canvas` (Pitch Black) so it lifts above any surface
- Border `1px solid --g-line-strong` (Gunmetal)
- Radius `6px`, padding `5px 8px`, shadow `--g-shadow-md`
- Text: Inter 12px / 510, Porcelain, `-0.011em` tracking
- Optional shortcut pill: `Keycap size="sm" surface="strong"` (mono 10px / Storm Cloud, `--g-surface-3` bg, 4px radius, 1px Gunmetal border)
- Animation: 100ms opacity fade + 120ms ease-out 2px slide from the placement direction
- `pointer-events: none` so it never blocks the trigger

**Accessibility**

- `role="tooltip"`, `aria-describedby` linked to the trigger via `useId`
- `aria-hidden` toggles with visibility
- Focus also opens the tooltip (immediate, no delay) so keyboard users see it
- Trigger MUST keep its own `aria-label` — tooltip is supplementary, not the only label

**Where to use**

- Every icon-only `IconButton` in chrome (topbar, drawer header, list row actions, run-panel close, etc.)
- Disabled state explainers (pair with `disabled` prop on tooltip = `false` to keep showing)
- Truncated labels — pair with `truncation-strategy` rule from §10

### 5.24 Notice

Canonical shared primitive: `Notice` / `NoticeStack` from `ui/src/components/ui/Notice.tsx`.

- Tones: `info | success | warning | danger`.
- Base: flex row, 10px icon gap, 12px padding, 6px radius, 1px token border, 13px Inter.
- Each tone combines soft background, matching icon color, title text, and body text.
- Role: `danger` uses `alert`; all other tones use `status`.
- Loading uses `Loader2` with token motion.

### 5.25 Select

Canonical shared primitive: `Select` from `ui/src/components/ui/Select.tsx`.

- Trigger: 26px (`sm`) or 32px (`md`), `--g-surface` bg, `--g-line` border + inset token shadow, 6px radius. Hover uses `--g-input-border-hover` + `--g-input-bg-hover` so light mode stays clean white while dark mode lifts to `--g-surface-2`.
- Menu: absolutely positioned with viewport-aware top/bottom placement, `--g-surface`, `--g-line-strong`, 6px radius, `--g-shadow-pop`, z 60. Max-height is `min(320px, var(--radix-select-content-available-height))`; do not use spacing-scale `max-h-64` because this project maps `64` to 64px.
- Options are stacked with a 4px gap so rounded hover / checked states do not visually merge. Highlighted option uses `--g-surface-2` / `--g-ink`. Checked option uses the same active treatment as Project Switcher and sidebar active rows: `--g-active-bg`, `--g-active-text`, and `--g-active-weight`; the check icon inherits the active text color.
- ESC and outside click close the menu. Full roving keyboard navigation is a separate accessibility pass.

### 5.26 Switch

Canonical shared primitive: `Switch` from `ui/src/components/ui/Switch.tsx`, backed by Radix `Switch.Root` / `Switch.Thumb` for checked state, keyboard interaction, and ARIA semantics.

- Track: 36×20, pill radius, unchecked `--g-surface-3`, checked `--g-active-bg`.
- Thumb: 14×14, unchecked `--g-ink-3`, checked `--g-active-text`, 120ms token transition.
- Focus: `--g-shadow-focus`; disabled opacity 0.38; press scale uses `--g-ease-spring` and is disabled by reduced motion.
- Touch target extends beyond the visual 36×20 track via pseudo-element hit slop.
- Settings toggles must use this primitive rather than hand-rolled `role="switch"` buttons.

### 5.27 Stat Card

Canonical shared primitive: `StatCard` from `ui/src/components/ui/StatCard.tsx`.

- Default card chrome: `--g-surface`, 1px `--g-line`, 6px radius, `--g-shadow-sm`, 18px/20px padding.
- Label: uppercase 11px / 510, token tone color.
- Value: display 36px / 590, tabular nums, -0.035em tracking.
- Clickable cards are real buttons with focus ring and hover lift (`translateY(-2px)` disabled under reduced motion).
- Tones: `neutral | accent | green | red | amber | blue`.

### 5.28 Asset Thumbnail

Canonical shared primitive: `AssetThumbnail` from `ui/src/components/ui/AssetThumbnail.tsx`.

- Sizes: `sm` 36px, `md` 48px, `lg` 64px, `fill` square container.
- Backgrounds: `surface`, `checker`, `light`, `dark` mapped to token-backed thumbnail background rules. Asset thumbnails default to the global image background preference unless a caller intentionally overrides `bg`.
- Container: `--g-r-sm`, 1px `--g-line`, grid centered, image object-fit contain.
- Empty `alt` marks the thumbnail as decorative with `aria-hidden`.

### 5.29 Rail

Canonical shared primitive: `Rail` / `RailSection` / `RailItem` from `ui/src/components/ui/Rail.tsx`.

- `Rail` renders the 220px rail body with token-backed CVA variants: `filter` for Browse-style facets and `settings` for section navigation.
- `RailSection` owns the vertical group stack and optional uppercase section heading.
- `RailItem` owns the button item shape, active state, optional Lucide icon, label truncation, and optional mono count. Active and inactive visual states are CVA variants; `data-state="active|inactive"` is emitted for inspection and accessibility tooling. Active state uses `--g-active-bg`, `--g-active-text`, and `--g-active-weight` so dark and light modes stay theme-correct.
- Settings section items use the `settings` item variant, preserving icon + label on desktop and hiding labels at ≤768px.
- Browse facets must pass counts through `RailItem count` instead of composing custom count spans.

### 5.21 Severity Indicator

- 6px circle dot + 11px mono label, 6px gap
- Critical: `--g-red` dot + `chip-red`
- Warning: `--g-amber` dot + `chip-amber`
- Info: `--g-info` dot + `chip-info`
- Pass: `--g-green` dot + `chip-green`

> Color is paired with text in every case. A user reading via screen reader or with deuteranopia gets the same information.

---

## 6. View Patterns

### 6.1 Browse

- Grid mode `.browse-grid` size variants: `s` (120px min) / default (180px) / `l` (240px)
- List mode: `.list` 6-column grid, sticky header `--g-surface-2` bg
- In All projects scope, the Browse project filter rail is driven by the registered project list, not just assets in the current result set, so zero-asset projects remain visible with a `0` count.
- Project-scoped entry points open Browse with the matching project facet active in the `Rail` filter variant, so the visible active item matches the source project card / sidebar project scope. While a Project Switcher scope is active, the Browse project rail hides the redundant `All projects` row and keeps the scoped project as the only active project facet.
- Custom Filters appear as their own Browse rail section when enabled filters exist in Settings. They are applied after status, search, project, and extension filters; counts are computed from that composed pre-custom result so the section answers "what would this saved filter do inside my current Browse scope?"
- Sticky Browse toolbar keeps view / size / background toggles, compact sort select (`w-36` / 144px), bulk toggle, search, count, and status tabs inline where space allows; first-row controls share the 32px `md` control height, while status filters use the same compact `Tabs variant="segment"` page-tab recipe as Duplicates. The sort select must not span the full row or push results downward. Browse's filter rail keeps an 8px left inset from the shell sidebar.
- Browse uses `.content-scroll--compact` so its scrollport keeps only 8px of bottom padding, avoiding a large artificial gap under dense asset grids while preserving the default 48px bottom gutter for non-Browse pages.
- Sticky filter bar `.opt-filters-wrap`: frosted (`--g-canvas` 92%) with compact status tabs (全部 / 未使用 / 重複 / 可最佳化 / 已引用)
- Active list row: `--g-accent-soft` bg + 4px left **Neon Lime** stripe

### 6.2 Duplicates

- `Tabs` primitive in page header: Exact / Similar and sort controls
- `.dgroup` SHA-headed groups remain supported for denser duplicate layouts
- Preferred tile: green Emerald border + corner badge
- Similar tab: side-by-side compare with overlay slider — slider track `--g-surface-3`, thumb `--g-accent`

### 6.3 Unused

- `.acard-check` (top-right) toggles selection
- `.bulkbar` sticky top-0 with: select all, copy paths, copy `git rm`, delete selected
- Delete CTA uses `Button variant="danger"`, never `variant="primary"`

### 6.4 Optimize

- Sticky frosted `.opt-filters-wrap` (z 4, blur 12px)
- Category chips `.opt-filter-row` (大小 / 格式 / SVG / 尺寸 / 動畫), horizontally scrollable
- Severity chips (嚴重 / 警告 / 建議), separated by 1px Charcoal vertical divider
- `.opt-row` 5-column grid as in §5.10
- `.opt-summary` 4-column KPI grid at top
- `.opt-progress`: indeterminate uses `slide-right` keyframe; determinate fills with `--g-accent`
- Skeleton shimmer for in-flight estimates
- `.opt-bulkbar` is **bottom-sticky** (16px from bottom)

### 6.5 Lint

- Page body starts directly with search/severity controls; do not render a large page title or subtitle.
- `.lint-kpi`: 4-column KPI grid (critical / warning / info / total)
- `.lint-controls`: sticky top-0, solid `--g-canvas`, z 10
- Grouped findings (3 levels):
  - `.lint-group` (by rule) — sticky header at CSS var offset, `--g-surface-3` bg
  - `.lint-subgroup` (by file) — 12px indent
  - `.lint-finding` (leaf) — expandable suggestion + mono snippet in `--g-surface-3` block
- Severity dot + chip per §5.21

### 6.6 Pre-Check

- Page body starts directly with the dropzone or result summary controls; do not render a large page title or subtitle.
- Top dropzone (§5.18) accepting drag/drop/paste/click
- `.precheck-result-card`: flex row (56px thumb + body), `--g-surface` bg, 6px radius
- Verdict badge: pass=`chip-green`, warning=`chip-amber`, fail=`chip-red`
- `.precheck-finding` rows: mini chip + mono path

### 6.7 Dashboard

- KPI grid uses `StatCard`: auto-fit min 220px, `--g-surface` cards, 6px radius
- Clickable KPI: button semantics, focus ring, hover `translateY(-2px)` + `--g-shadow-md`
- KPI value: Inter display 32px / 590, delta badge mono 11px (green up / red down)
- Mini sparkline: 36px height bar cluster, hover `scaleY(1.04)` from bottom
- Segment composition bar: 22px height, 1px gaps between colored segments (`--g-surface` slivers)
- Action card grid: auto-fit min 260px, `.card` style with chevron
- Overview: 1.4fr / 1fr two-column at ≥980px, single-column below

### 6.8 Projects

- Projects uses the `FolderKanban` Lucide icon across the sidebar nav, topbar crumbs, command palette, and empty/default project identity states so project roots read as tracked folders rather than organizations. Individual projects may override the neutral folder well with an uploaded PNG/JPEG/GIF/WebP image.
- Projects is a workspace-level view: project cards, workspace KPIs, and the Projects nav badge always use the full catalog, independent of the Project Switcher selection. Topbar breadcrumbs stay title-only; counts live in cards.
- Page scroll containers start close to the global header by moving the scrollport itself down 12px (`margin-top: 12px`) rather than using internal top padding. This keeps the scroll clipping edge aligned with the cardized sidebar rhythm, so scrolled content cannot appear above the first visible row.
- Projects page fills the available content column (`width: 100%; max-width: none`) and is start-aligned (`mx: 0`), matching Duplicates and other dense pages so both left and right gutters stay consistent through the shared content-scroll padding. Projects uses full-width layout (`max-width: none`) rather than the centered content pattern.
- The Projects toolbar search filters project cards only. Placeholder copy must describe project search, not asset or path result search. The Projects page stack uses 8px vertical gaps between the workspace hero, toolbar mask, and project card grid so cards sit close to their controls without feeling cramped. The toolbar sits inside a sticky top mask (`top: 0`, z 20, 12px inline padding, no bottom/top padding, solid `--g-canvas` background) so its card top aligns with the sidebar project switcher and the scrollport clips content above that edge. The card inside the mask uses `--g-surface`, `--g-line`, 6px radius, and `--g-shadow-sm`; do not leave bare controls on the canvas.
- Projects toolbar sort uses `Tabs variant="segment"` labels for name, count, size, health, and imported date so its tab-like sort control matches Duplicates and Browse status tabs. Count / size / health / imported sort descending (imported = newest first) with project name as the stable tiebreaker; name sort is ascending.
- The workspace hero avatar uses the active workspace's uploaded image when available and falls back to a tokenized initial well; the same avatar grammar is reused in Project Switcher and Settings so workspace identity stays consistent.
- Clickable workspace KPI cells use an 8px padded hover/focus target with a matching negative offset so the text remains aligned while the hover wash never hugs the label or value.
- Project cards sit in a responsive grid with 16px column gaps and 8px row gaps. The leading project well uses the uploaded project image when available and falls back to a solid neutral `FolderKanban` well. They use `.project-card-health-bar` as a health meter: fill width equals `health / 100`, fill tone follows the health badge (`green` / `amber` / `red`), and the track is a 16% tone mix over `--g-surface-2` so `0% health` still reads as a red danger state instead of empty data. The same health, unused, duplicate, optimizable, and lint counts are repeated in text badges so the bar is never color-only.
- The `Browse Project` action on a project card sets the project scope to that card's project and navigates to Browse; Browse initializes its project facet to the same project rather than defaulting to `All Projects`.

### 6.9 Settings

- Settings uses the shared `Rail` settings variant for section navigation with an 8px left inset from the shell sidebar, and renders the right pane as a single `.settings-panel` card per section, max-width 1040px and aligned to the content start so form controls do not sprawl across the canvas. The language select keeps the canonical language inventory but promotes Simplified Chinese to the first option when the browser locale resolves to Mainland China, Hong Kong, or Macau.
- Settings panel headers are plain text blocks inside the single outer panel: 28px display title plus 14px helper text. No nested header strip and no icon well.
- The Workspace section owns multi-workspace management through the workspace list, avoiding a duplicate standalone active-workspace name field. The workspace list and default-root input share the same 560px desktop control width so the section reads as one aligned column. A compact token-backed workspace list shows each workspace as a 6px-radius row with a workspace avatar well (uploaded image when present, initial fallback otherwise), name, mono project count, an always-visible secondary Switch button with an exchange icon for inactive workspaces, hover/focus-revealed Rename/Delete actions on desktop, and a secondary `Add workspace` button below the list. On stacked mobile/touch layouts, Rename/Delete remain visible. Desktop hover/focus actions reveal as the two 12px-caption small buttons directly, without an extra pill/tag wrapper around the action group. Row hover/focus applies to the full row surface, never just the label cluster, but the label cluster itself is non-interactive; only the explicit Switch button changes workspace. The Active badge and Switch button share the same 32px height and 112px width so the workspace state column stays aligned; Active uses a check icon with the neutral active surface, while Switch keeps the same footprint with interactive hover/focus treatment. Add and Rename use a workspace dialog that collects the name plus an optional uploaded PNG/JPEG/GIF/WebP image up to 512 KB, with 64px tokenized preview, 12px-caption secondary Upload/Remove controls, and a single primary confirm CTA. Delete uses the shared danger `ConfirmDialog`, preserves files on disk, and disables deletion when only one workspace remains. `Add workspace` lives here (not in the sidebar switcher), opens the workspace dialog (never a native browser prompt), collects a name, and switches to the new empty workspace after creation.
- All Settings sections use the same simple content rows (`copy | control`) with generous vertical rhythm and no per-row box, inset shadow, or icon well. Controls use a consistent 280px desktop control column; text inputs and textareas use the shared longer 320px width, stay right-aligned on desktop, and stack under copy on narrow panes. Boolean controls use the shared Radix-backed `Switch` primitive. The Add-project start path input keeps its placeholder short, while the resolved server working directory renders as a wrapping mono helper below the input so long English copy or paths do not clip inside the field. The workspace section does not show a duplicate auto-scan toggle; startup scanning is owned by Scanning → `scanOnOpen`, whose helper copy explains that Asset Studio rescans the catalog once after startup and project load.
- Projects groups all registered project roots by workspace inside the single settings panel: each workspace gets a compact header with the same workspace avatar well, workspace name, mono project count, and Active/secondary Switch affordance; project rows sit under a subtle left rule with a small project avatar well (uploaded image or neutral folder fallback), mono path, an active-workspace asset count chip placed beside the project name, and Rename/Delete actions that reveal on row hover/focus on desktop while staying visible in stacked mobile/touch layout. Rename opens the project dialog, which edits the name plus an optional uploaded PNG/JPEG/GIF/WebP image up to 512 KB. Do not flatten projects across workspaces. Hotkeys, About, Data, and Storage follow the same row pattern as form settings; no section may introduce nested cards or boxed subgroups. Scanning → exclude patterns uses a wider 420px textarea with vertical resize enabled so patterns can be entered one per line; save parsing accepts both newlines and commas.
- Scanning owns OCR because OCR is a manual scan-adjacent operation, not a cleanup action. OCR controls must present it as optional local runtime setup: enable toggle, comma-separated language packs, conservative max-pixels/batch limits, install/remove language-pack actions, and a manual `Run OCR` action. Copy must state that the language packs are free open-source files downloaded locally, images are not uploaded, and normal scans/catalog loads never run OCR.
- Custom Filters is the only Settings section with repeated rule-builder records. Each saved filter is an individual editable record with name, enable switch, delete action, OR groups, and AND clauses; use token-backed compact borders to separate the repeated rule rows without introducing a second card component. Path/folder-like operators should include contains, starts with, ends with, equals, and regex; extension/project support one-of lists where useful. OCR clauses may read cached local OCR fields only: text, language/script, confidence, and status. They must never trigger OCR work during filtering.
- Custom Filters must include a right-aligned help icon in the section header. The help modal explains OR groups, AND clauses, setup steps, and concrete examples for non-engineers.
- Settings workspace/project rename and delete success paths must show success toasts with the affected workspace/project name. The Settings `Save` action must show a success toast after persistence and a danger toast with the API error message when persistence fails. The Settings `Reset` action must open a confirmation dialog before applying defaults, then show success/error toasts with error details on failure. It resets app preferences and custom filters, not projects, scans, or files; database reset remains a separate danger confirmation in About/Data and also reports success/error via toast.
- The Settings right pane intentionally avoids nested cards and heavy dividers; hierarchy comes from typography, spacing, and one outer panel only.
- Storage rows show the persisted database path, data directory, and cache directory only. There is no separate config directory row; app state lives in the SQLite data directory, and release UI assets live in cache.

---

## 7. Animations

| Name            | Duration | Easing   | Effect                                                               |
| --------------- | -------- | -------- | -------------------------------------------------------------------- |
| `slideInR`      | 240ms    | ease-out | Drawer translateX(100%) → 0                                          |
| `fadeIn`        | 160ms    | ease     | Backdrop opacity 0 → 1                                               |
| `slideUp`       | 200ms    | ease-out | Panels & toast translateY(8px) + opacity                             |
| `selectedPulse` | 1000ms   | ease-out | One-shot Neon Lime box-shadow pulse 0 → 14px → 0 spread on selection |
| `pressScale`    | 100ms    | spring   | `transform: scale(0.97)` on press, restore on release                |
| `icon-spin`     | 900ms    | linear ∞ | Loading spinner                                                      |
| `spin-slow`     | 2.4s     | linear ∞ | Progress wedge                                                       |
| `shimmer`       | 1.5s     | linear ∞ | Skeleton gradient sweep                                              |
| `slide-right`   | 1.4s     | ease ∞   | Indeterminate progress bar                                           |

**Global rules**

- Standard hover transition: 120ms `--g-ease`
- Hover / focus colors are token-driven and theme-aware: use `--g-surface-2`, `--g-surface-3`, `--g-line-strong`, `--g-shadow-focus`, and `--g-active-*` instead of hard-coded dark/light overrides
- Theme transition: 200ms (color-only properties)
- Exit animations: 60–70% of entry duration
- All animations interruptible — gesture/click cancels in-flight
- `prefers-reduced-motion` honored on every keyframe — disable transform/scale, keep opacity only

---

## 8. Scrollbar

Webkit:

- Width 10px (thin variant 8px, inline 6px)
- Track transparent
- Thumb: `--g-line-strong` background, 9999px radius, **2px Pitch Black border** (creates the "floating pill" look)
- Hover thumb: `--g-ink-4`

---

## 9. Responsive Breakpoints

| Width   | Changes                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------- |
| ≤960px  | Sidebar collapses to 64px icon-only rail                                                        |
| ≤1024px | FilterRail hidden                                                                               |
| ≤768px  | Page padding 20px 16px. Page title 24px. `.opt-row` collapses to 3 cols. `.opt-summary` 2 cols. |
| ≤600px  | Drawer & modal full-width                                                                       |
| ≤480px  | Crumbs truncate (hide first + separator). Search input shrinks to icon-only.                    |

---

## 10. Accessibility

- **Contrast**: Porcelain on Pitch Black = 17.4:1 (AAA). Storm Cloud on Pitch Black = 6.4:1 (AA). Storm Cloud on Graphite = 6.0:1 (AA). Verify any new pair.
- **Focus**: visible token focus ring on every interactive element — controls use `--g-shadow-focus`; text inputs use `--g-input-shadow-focus` plus `--g-input-border-focus` so the focused outline stays distinct from hover. Never `outline: none` without a token-backed replacement.
- **Touch targets**: ≥44×44pt; small icons get `hitSlop` / extended `::before` hit area.
- **Color never alone**: severity always has icon + text; preferred tile has badge + border + text label.
- **Keyboard**: tab order matches visual order, ESC dismisses overlays, ⌘P opens command palette, ⌘/ focuses search.
- **Screen reader**: every icon button has `aria-label`; toasts use `role="status"` (`aria-live="polite"`); modals trap focus and restore on close.
- **Tooltips**: every icon-only control wrapped in `<Tooltip>` (§5.23). Keyboard-reachable (focus shows tooltip immediately), uses `role="tooltip"` + `aria-describedby`, and is supplementary — the trigger must still carry its own `aria-label`. **Never** use the browser's native `title` attribute.
- **Localized copy**: visible UI strings, placeholder text, dialog labels, toast text, `aria-label`s, filter chips, count summaries, and action labels live in `ui/src/i18n/locales/*.json`. Components call `t(...)`; do not hardcode user-facing copy in TSX except product names, file extensions, keyboard hints, and API/user-provided values.
- **Reduced motion**: respect `prefers-reduced-motion` — disable transforms, keep opacity-only fades.

---

## 11. Imagery

- The product surface is **screenshots and chrome**, not decorative photography.
- Icons are SVG, mono-color, filled or 1.5px stroke (one consistent set per hierarchy level — currently Lucide).
- Asset thumbnails are user content rendered in `.acard-thumb` with the three `data-bg` modes.
- No raster icons. No emoji icons.

---

## 12. Token Migration (legacy `--g-*` → Linear surface intent)

| Old assumption                      | New canonical role                                               |
| ----------------------------------- | ---------------------------------------------------------------- |
| `--g-surface` = `#ffffff` paper     | `--g-surface` = `#0f1011` Graphite card layer                    |
| `--g-accent` = warm coral `#ff5436` | `--g-accent` = Neon Lime `#e4f222`                               |
| Card radius = 14px (`--g-r-lg`)     | Card radius = 6px (`--g-r-md`); `--g-r-lg` reserved for overlays |
| Shadows: soft 24/48px diffuse       | Shadows: tight 2/4/12px; `inset 0 0 0 1px` borders               |
| Display = Inter Tight               | Display = Inter Variable (510/590)                               |
| Mono = JetBrains                    | Mono = Berkeley Mono (JetBrains as fallback)                     |

Update `_tokens.scss`, `_patterns.scss`, and `tailwind.css` to honor this table whenever you touch them.

---

## 13. Light Mode Companion — "Daylight Console"

> Asset Studio is **dark-first** (Linear Midnight Command Center). The light theme is a **deliberately designed companion**, not an inversion. It shares the same component shapes, spacing, typography, and motion — only surfaces and CTA strategy change.

### 13.1 Why a separate light spec

A naive inversion fails because Neon Lime `#e4f222` has only **1.4:1 contrast** on white — far below WCAG AA's 4.5:1. Filling a primary CTA with lime on a white canvas reads as "construction sign," not "professional tool." So the light variant must:

1. **Swap the CTA color**, not invert it.
2. **Demote the accent** to focus / selection / wash usage only.
3. **Recalibrate shadows** so the "elevation by tight shadow" intent still reads on white (where any shadow > 0.1 alpha looks heavy).

### 13.2 Surface strategy

| Layer     | Light value                | Why                                                                  |
| --------- | -------------------------- | -------------------------------------------------------------------- |
| Canvas    | `#fafbfc` (warm off-white) | Pure white causes screen fatigue; off-white preserves "page" feeling |
| Surface   | `#ffffff` (pure white)     | Cards must visually lift above the canvas                            |
| Surface-2 | `#f4f5f7` (cool wash)      | Hover state on cards, segmented inactive                             |
| Surface-3 | `#eceef2` (cooler wash)    | Inset wells, group headers, active nav bg                            |

Borders: `#e5e7eb` default, `#d1d5db` strong. Both light enough to whisper, dark enough to define edges.

### 13.3 CTA strategy — the Vercel pattern

```
Dark mode:  Primary CTA = Neon Lime fill + Pitch Black text  (16.7:1 contrast)
Light mode: Primary CTA = Near-Black fill + White text       (16.5:1 contrast)
```

This mirrors Vercel and GitHub: the primary action **flips with the theme** so it always punches through. Both modes are recognizable as "the button" without sharing the same color.

Implemented via theme-swapped tokens:

- `--g-cta`, `--g-cta-ink`, `--g-cta-hover` — the `Button variant="primary"` CVA definition reads these and swaps automatically.
- `--g-active-bg`, `--g-active-text`, `--g-active-weight` — sidebar active item, iconbtn active toggle.

### 13.4 Where Neon Lime still appears in light mode

- **Focus rings**: 2px Neon Lime @ 0.55 alpha + 1px ink @ 0.08 alpha layered (the second ring gives definition on white).
- **Selection rings on cards**: 2px Neon Lime border, 1px Neon Lime soft wash on the meta region.
- **Hover wash on accent chips** `chip-accent`: filled lime + near-black text (still passes contrast since lime is bright).
- **NEVER** as a primary CTA filled background on a light surface.
- **NEVER** as a section background or large coverage area.

### 13.5 Active state — neutral wash, not lime

Light-mode active nav uses:

- Background: `--g-surface-3` (#eceef2 cooler wash)
- Text color: `--g-ink` (near-black)
- Font weight: **590** (one notch heavier than non-active 400)

The combination of subtle bg + bold weight reads as "selected" without screaming. Lime fill on a white sidebar against a near-white canvas would be visually exhausting.

### 13.6 Semantic colors — adjusted for white background

| Token        | Dark               | Light                  | Why light value differs                                       |
| ------------ | ------------------ | ---------------------- | ------------------------------------------------------------- |
| `--g-green`  | `#27a644` Emerald  | `#007a26` Forest Green | Emerald loses contrast on white; Forest Green is AA-compliant |
| `--g-amber`  | `#f0b429`          | `#b45309` Burnt Amber  | Yellow on white is unreadable (1.7:1); burnt amber passes AA  |
| `--g-red`    | `#eb5757`          | `#dc2626`              | Slightly deeper red so error chips read on white              |
| `--g-purple` | `#8b5cf6` Amethyst | `#7c3aed`              | Deeper violet for AA on white                                 |

### 13.7 Shadow recalibration

Light-mode shadows are **3–4× lower alpha** than dark:

| Token            | Dark                                         | Light                                             |
| ---------------- | -------------------------------------------- | ------------------------------------------------- |
| `--g-shadow-sm`  | `0 2px 4px rgba(0,0,0,0.4)`                  | `0 1px 2px rgba(15,17,21,0.04)`                   |
| `--g-shadow-md`  | `0 4px 12px rgba(0,0,0,0.4) + 0 1px 3px 0.3` | `0 4px 12px rgba(15,17,21,0.06) + 0 1px 3px 0.04` |
| `--g-shadow-pop` | `0 4px 32px rgba(8,9,10,0.6) ...`            | `0 24px 48px -12px rgba(15,17,21,0.18) ...`       |

Dark shadows can be opaque because the canvas is already black. Light shadows must be subtle — over-shadowing on white is the #1 tell of an amateur Linear-clone.

### 13.8 Theme switching

- Default theme preference is **dark** (`localStorage` absence or invalid value → dark). Explicit preferences are `"light"`, `"dark"`, and `"system"`.
- The Settings theme row uses a three-option segmented control: Light (`Sun`), Dark (`Moon`), and System (`Monitor`). It fills the same control-column width as the language select and distributes the three options evenly. System resolves through `prefers-color-scheme` and updates when the OS preference changes.
- Settings also owns the global image background preference (`checker`, `light`, `dark`) for asset thumbnails and previews. Browse keeps its inline background segmented control as a convenience entry point, but it writes the same global preference.
- The resolved theme is applied via `[data-theme='dark' | 'light']` on `<html>`. `:root` defaults to light, dark overrides via attribute.
- All token-driven components (buttons, inputs, modals, drawers, etc.) automatically theme-swap via CSS custom properties. No component needs `[data-theme]` selectors — theme-aware values flow through `_tokens.scss` and are consumed by Tailwind token aliases and CVA variants.

### 13.9 Light-mode delivery checklist

In addition to §13, when delivering UI work that lands light-side:

- [ ] No Neon Lime as a filled CTA on white surfaces.
- [ ] All shadows lifted to `--g-shadow-*` tokens (don't hand-roll on white — you will over-shadow).
- [ ] Focus ring uses the layered (lime + ink @0.08) variant — single lime ring is invisible on white.
- [ ] Functional colors verified at 4.5:1 against the surface they sit on (use `--g-green / --g-amber / --g-red / --g-purple` light values, not dark values).
- [ ] Active nav/icon states use `--g-active-*` tokens, not `--g-accent`.
- [ ] Tested side-by-side with dark — both modes should feel like the same product, just different lighting.
