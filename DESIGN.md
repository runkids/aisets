# Asset Studio — Design System

> **Midnight Command Center** — A dark, layered control panel for asset hygiene work. Deep charcoal surfaces, precise typography, and a single high-energy lime accent guide the eye across data-dense scans, lint findings, and bulk actions.

**Theme:** dark-first (Linear-inspired). A light variant exists for parity but the canonical product surface is dark.

> **🚨 ALL UI/UX CHANGES MUST UPDATE THIS FILE.** See root `CLAUDE.md` for the contract.

---

## 0. Styling Architecture

Asset Studio now supports a progressive migration from SCSS class inventory to React-owned component variants.

- **Design tokens remain the source of truth.** Tailwind utilities used by components must resolve to `--g-*` tokens or the 4px spacing/type scales in this document.
- **React components may own variants.** Shared primitives can use `clsx` + variant maps to express `variant`, `size`, and state in TypeScript instead of hand-concatenating SCSS classes.
- **Tailwind is allowed for shared primitives and new component-local styling** when it uses token aliases from `ui/src/styles/tailwind.css` (`bg-g-surface`, `text-g-ink`, `rounded-g-md`, `shadow-g-focus`, etc.).
- **SCSS remains valid for tokens, reset/layout, legacy screens, and complex view patterns** (`.acard`, `.opt-row`, `.dgroup`, sticky groups, drawers, modals).
- **Migration is incremental.** Existing semantic classes are preserved until their owning component is migrated; avoid broad rewrites that mix behavior changes with styling migration.

---

## 1. Design Principles

| #   | Principle                         | What it means here                                                                                                                                                                               |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Single CTA + single accent**    | `--g-cta` is reserved for _one_ primary CTA per screen. `--g-accent` (Neon Lime `#e4f222`) is reserved for dark CTA fill, active nav in dark mode, focus rings, and selection. Never decorative. |
| 2   | **Layered surfaces, not shadows** | Hierarchy comes from `canvas → graphite → deep-slate → charcoal-overlay`. Shadows are tight and contained, never diffuse.                                                                        |
| 3   | **Compact, not cramped**          | 4px base unit, 8px element gap, 12px card padding, 24px section gap. Information density is the feature.                                                                                         |
| 4   | **Inter + Berkeley Mono**         | Inter Variable for UI, Berkeley Mono (or IBM Plex Mono / JetBrains Mono fallback) for paths, hashes, sizes, counts.                                                                              |
| 5   | **6px is the default radius**     | Buttons, inputs, cards, badges all gravitate to 6px. Tags 2–4px. Pills 9999px.                                                                                                                   |
| 6   | **Motion is meaning**             | 150–300ms, ease-out for entry, spring/scale for press, never decorative parallax.                                                                                                                |
| 7   | **Color never alone**             | Severity, success, error always pair color with icon + text + position.                                                                                                                          |
| 8   | **Tooltips are non-native**       | Every icon-only control gets a `<Tooltip>` from `ui/Tooltip.tsx`. **Never** rely on the browser's native `title` attribute. See §6.23 for the full spec.                                         |

---

## 2. Tokens

### 2.1 Colors

The palette is dark-first. SCSS variable names (`--g-*`) are preserved for backwards compatibility and map onto the Linear surface scale.

| Token                   | Dark (canonical)        | Light (Daylight Console)   | Linear name             | Role                                                                                      |
| ----------------------- | ----------------------- | -------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| `--g-canvas`            | `#08090a`               | `#fafbfc`                  | Pitch Black ↔ Off-white | Page background, dotted grid base                                                         |
| `--g-surface`           | `#0f1011`               | `#ffffff`                  | Graphite ↔ Pure White   | Default card / sidebar / topbar fill                                                      |
| `--g-surface-2`         | `#161718`               | `#f4f5f7`                  | Deep Slate ↔ Cool Wash  | Hover wash, elevated card, segmented active                                               |
| `--g-surface-3`         | `#23252a`               | `#eceef2`                  | Charcoal ↔ Cooler Wash  | Inset wells, group headers, scrim accent                                                  |
| `--g-line`              | `#23252a`               | `#e5e7eb`                  | —                       | Default 1px borders, dividers                                                             |
| `--g-line-strong`       | `#383b3f`               | `#d1d5db`                  | —                       | Hover borders, scrollbar thumb, input outline                                             |
| `--g-ink`               | `#f7f8f8`               | `#0c0d0e`                  | Porcelain ↔ Near-Black  | Primary text & icons (AAA on canvas)                                                      |
| `--g-ink-2`             | `#d0d6e0`               | `#3f4045`                  | Light Steel ↔ Slate     | Secondary text, ghost button default                                                      |
| `--g-ink-3`             | `#8a8f98`               | `#62666d`                  | Storm Cloud (symmetric) | Tertiary text, descriptions, nav labels                                                   |
| `--g-ink-4`             | `#62666d`               | `#8a8f98`                  | Fog Grey (symmetric)    | Metadata, placeholders                                                                    |
| `--g-ink-5`             | `#43474d`               | `#c7c8cc`                  | —                       | Crumbs separator, very dim chrome                                                         |
| `--g-accent`            | `#e4f222`               | `#e4f222`                  | **Neon Lime**           | Focus ring, selection ring, accent wash (NOT primary CTA in light)                        |
| `--g-accent-soft`       | `rgba(228,242,34,0.14)` | `rgba(228,242,34,0.22)`    | —                       | Selected card meta, focus glow, hover wash                                                |
| `--g-accent-deep`       | `#c9d61c`               | `#c9d61c`                  | —                       | Reserved (legacy `.btn-accent` hover)                                                     |
| `--g-accent-ink`        | `#08090a`               | `#0c0d0e`                  | Pitch Black             | Text on Neon Lime when used as fill                                                       |
| **`--g-cta`**           | `#e4f222` (Neon Lime)   | **`#0c0d0e` (Near-Black)** | —                       | **Theme-swapped primary CTA fill** — `.btn-primary` reads this                            |
| **`--g-cta-ink`**       | `#08090a`               | `#ffffff`                  | —                       | Text on `--g-cta`                                                                         |
| **`--g-cta-hover`**     | `#c9d61c`               | `#25272a`                  | —                       | `.btn-primary:hover`                                                                      |
| **`--g-active-bg`**     | `#e4f222`               | `#eceef2`                  | —                       | Theme-swapped active nav / iconbtn bg                                                     |
| **`--g-active-text`**   | `#08090a`               | `#0c0d0e`                  | —                       | Active text                                                                               |
| **`--g-active-weight`** | `510`                   | `590`                      | —                       | Active font-weight (light needs heavier weight to read as "selected" without color punch) |
| `--g-info`              | `#5e6ad2`               | `#5e6ad2`                  | Aether Blue             | Informational highlights, links                                                           |
| `--g-info-soft`         | `rgba(94,106,210,0.16)` | `rgba(94,106,210,0.12)`    | —                       | Info chip background                                                                      |
| `--g-blue`              | `#02b8cc`               | `#02b8cc`                  | Cyan Spark              | Diff / preview accent                                                                     |
| `--g-blue-soft`         | `rgba(2,184,204,0.14)`  | `rgba(2,184,204,0.10)`     | —                       | Cyan chip / icon bg                                                                       |
| `--g-green`             | `#27a644`               | `#008d2c`                  | Emerald / Forest Green  | Success, preferred duplicate, savings                                                     |
| `--g-green-soft`        | `rgba(39,166,68,0.16)`  | `#dcfce7`                  | —                       | Success chip, run-panel result row                                                        |
| `--g-amber`             | `#f0b429`               | `#f59e0b`                  | —                       | Warning                                                                                   |
| `--g-amber-soft`        | `rgba(240,180,41,0.16)` | `#fef3c7`                  | —                       | Warning chip                                                                              |
| `--g-red`               | `#eb5757`               | `#dc2626`                  | Warning Red             | Danger, critical lint, delete                                                             |
| `--g-red-soft`          | `rgba(235,87,87,0.16)`  | `#fee2e2`                  | —                       | Danger chip                                                                               |
| `--g-purple`            | `#8b5cf6`               | `#7c3aed`                  | Amethyst / Deep Violet  | Lint badge, secondary category                                                            |
| `--g-purple-soft`       | `rgba(139,92,246,0.16)` | `#ede9fe`                  | —                       | Lint chip bg                                                                              |

> **Rule:** Never introduce a new bright/saturated color outside this list for interactive purposes. `--g-accent` (Neon Lime) is the only accent that gets a _filled_ background on a control.

### 2.2 Typography

| Token                   | Stack                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `--g-font` (body / CJK) | `'Inter Variable', 'Noto Sans TC', system-ui, -apple-system, 'Segoe UI', sans-serif`           |
| `--g-display`           | `'Inter Variable', 'Inter Tight', system-ui, sans-serif`                                       |
| `--g-mono`              | `'Berkeley Mono', 'IBM Plex Mono', 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace` |

> **Why Inter Variable?** Linear's signature typeface. Variable axis lets us use 510/590 instead of 500/600 for tighter optical weight. Noto Sans TC kept inline for CJK glyph coverage; the cascade picks it up only when Inter has no glyph.

OpenType features for Inter: `font-feature-settings: "cv01", "ss03";` applied globally on `body`.

#### Type scale

| Role                      | Font    | Size    | Weight | Line-height | Letter-spacing    |
| ------------------------- | ------- | ------- | ------ | ----------- | ----------------- |
| Display (hero counts)     | display | 72px    | 590    | 1.0         | -0.022em          |
| Heading L (section title) | display | 48px    | 590    | 1.2         | -0.022em          |
| Heading M (page title)    | display | 32px    | 590    | 1.2         | -0.022em          |
| Heading S (card title)    | display | 24px    | 510    | 1.33        | -0.022em          |
| KPI value                 | display | 32px    | 590    | 1.0         | -0.022em          |
| Subheading                | body    | 17px    | 510    | 1.47        | -0.013em          |
| Body                      | body    | 14px    | 400    | 1.4         | -0.013em          |
| UI label / button         | body    | 13px    | 510    | 1.4         | -0.012em          |
| Nav link                  | body    | 13px    | 400    | 1.4         | -0.012em          |
| Caption / chip            | body    | 12px    | 510    | 1.33        | -0.011em          |
| Section label (uppercase) | body    | 10px    | 510    | 1.4         | 0.06em (positive) |
| Mono — code / path / hash | mono    | 12–13px | 400    | 1.5         | -0.015em          |
| Mono — value (KPI delta)  | mono    | 11px    | 510    | 1.4         | -0.015em          |

> Section labels are the _only_ uppercased text and the _only_ positive tracking values. Everywhere else, tracking is negative or zero — Linear's signature.

### 2.3 Spacing

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

### 2.4 Radius

| Token      | Value  | Used by                                                              |
| ---------- | ------ | -------------------------------------------------------------------- |
| `--g-r-xs` | 2px    | Tags, severity dot                                                   |
| `--g-r-sm` | 4px    | Badges, count chips                                                  |
| `--g-r-md` | 6px    | **Buttons, inputs, search, seg-toggle, icon buttons, default cards** |
| `--g-r-lg` | 12px   | Drawer, modal, run panel, settings, command palette, nested card     |
| `--g-r-xl` | 16px   | Dropzone (precheck)                                                  |
| `pill`     | 9999px | Toast, scrollbar thumb, scroll-top-btn, status chips                 |

> The big shift: most cards/rows that used to be 14px (`--g-r-lg` legacy) are now **6px (`--g-r-md`)** to match Linear's tight aesthetic. Only floating overlays keep 12px.

### 2.5 Shadows & Elevation

Elevation is built primarily from **inset 1px borders + tight 4px drop shadows**, not from soft diffuse blurs.

| Token              | Value                                                                | Used by                                                             |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `--g-shadow-sm`    | `0 2px 4px rgba(0,0,0,0.4)`                                          | Default card, active seg-toggle                                     |
| `--g-shadow-md`    | `0 4px 12px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.3)`              | Card hover, bulk bar, selected glow                                 |
| `--g-shadow-lg`    | `0 24px 48px -12px rgba(0,0,0,0.6), 0 8px 16px -8px rgba(0,0,0,0.4)` | Toast, scroll-top-btn                                               |
| `--g-shadow-pop`   | `0 4px 32px rgba(8,9,10,0.6), 0 12px 24px -8px rgba(0,0,0,0.5)`      | Drawer, modal, run panel, settings, command palette                 |
| `--g-shadow-inset` | `inset 0 0 0 1px #23252a`                                            | Elevated card border (replaces solid border on Deep Slate surfaces) |
| `--g-shadow-focus` | `0 0 0 2px rgba(228,242,34,0.4)`                                     | Focus ring (Neon Lime, 2px)                                         |

### 2.6 Easing & Duration

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

## 3. Surfaces & Layers

| Level            | Token           | Hex (dark) | Where it lives                                           |
| ---------------- | --------------- | ---------- | -------------------------------------------------------- |
| **0** Canvas     | `--g-canvas`    | `#08090a`  | Page background, dotted grid base, scrim base            |
| **1** Graphite   | `--g-surface`   | `#0f1011`  | Sidebar, topbar, default cards, list rows                |
| **2** Deep Slate | `--g-surface-2` | `#161718`  | Elevated cards, hover wash, drawer body, modal body      |
| **3** Charcoal   | `--g-surface-3` | `#23252a`  | Inset wells, code blocks, group headers, scrollbar track |

> **Dotted main canvas:** keep the existing `radial-gradient(circle at 1px 1px, var(--g-line) 1px, transparent 0)` at `24px 24px`. In dark mode this becomes faint Charcoal dots on Pitch Black — preserves the "control panel grid" feel without adding light.

---

## 4. Shell Layout

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

### 4.1 Sidebar `.sb`

- `background: var(--g-surface)` (Graphite `#0f1011`)
- `border-right: 1px solid var(--g-line)` (Charcoal `#23252a`)
- **Brand block** `.sb-brand`: **height locked to 60px** (matches topbar — see §4.2). Layout: 40×40 logo mark using the official raster app icon (`/brand/asset-studio-app-icon.png`) on `--g-canvas`, 6px radius + name (Inter 15px / 590, Porcelain) + tag (10px uppercase / +0.06em / Storm Cloud). The image is presentation-zoomed (`scale(1.22)`) inside the clipped mark so the logo subject remains legible at sidebar chrome size. Keep the official logo asset intact; improve legibility through sizing/presentation, not by replacing the mark.
- **Nav section label**: 10px uppercase Storm Cloud, +0.06em tracking, 12px bottom padding
- **`.sb-link`**: 6px 8px padding, **6px radius** (matches filter-rail `.f-pill` active shape), Inter 13px / 400, Storm Cloud default
  - Non-active hover: light uses a medium `--g-surface-2` wash so it remains readable without becoming selected, and flips the count badge to `--g-surface` so the chip stays distinct; dark steps to `--g-surface-3` + `--g-ink` so it remains visible on the dark sidebar
  - **Active**: bg `--g-accent` (Neon Lime), text `--g-accent-ink` (Pitch Black), font-weight 510. Active hover keeps the exact active bg/text colors in both themes. _No_ shadow.
  - Focus: 2px Neon Lime ring (`--g-shadow-focus`)
- **Badge** in nav row: mono 11px on `--g-surface-3` background, 4px radius, Storm Cloud text. Tonal variants use `*-soft` bg + matching base color text
- **Footer**: 1px top border, 32×32 user mark + name + team label (Storm Cloud)
- **Responsive ≤960px**: collapse to 64px icon-only rail

### 4.2 Topbar `.topbar`

- **Frosted Pitch Black**: `background: color-mix(in srgb, var(--g-canvas) 85%, transparent)`, `backdrop-filter: blur(12px) saturate(160%)`
- `padding: 0 20px`, `border-bottom: 1px solid var(--g-line)`, `z-index: 10`, `height: 60px` (locked — must match `.sb-brand` height so the sidebar/topbar bottom borders form one continuous line)
- Layout: `.crumbs` → `.tb-spacer` (flex: 1) → `.search` → **`<Tooltip><IconButton>FolderPlus</IconButton></Tooltip>`** (Add Project, always visible) → **`<Tooltip><IconButton>RefreshCw</IconButton></Tooltip>`** (Rescan). Rescan communicates in-progress state only through the Refresh icon loading/spin state and completion/error toast/notice; it does **not** show a global blue "Scanning" notice during the pending state.
- **Crumbs `.crumbs`** are NOT a file-path-style breadcrumb. They are a **page header inline trio**:

  ```
  [.crumbs-icon 26×26 mode glyph]  .crumbs-title  ·  .crumbs-meta
  ```

  - `.crumbs-icon`: 26×26 square, 6px radius, `--g-surface-2` bg, `--g-ink-2` icon (16×16). The icon must match the sidebar nav icon for the same mode (FolderKanban/FolderOpen/Recycle/Trash2/Sparkles/FileWarning/ShieldCheck/Settings) — visually ties topbar to active sidebar item.
  - `.crumbs-title`: Inter display 14px / 590 / `--g-ink`, `-0.013em` tracking. The mode title (e.g. "Dashboard").
  - `.crumbs-dot`: middle dot `·`, `--g-ink-5`, separates title from meta.
  - `.crumbs-meta`: mono 12px / `--g-ink-3` / tabular nums (e.g. `1 project · 5 assets`). Hidden ≤600px.

- The redundant `asset.studio` brand crumb and `/` separator are removed — sidebar already shows brand; crumbs reflect navigation, not file path.
- **Crumbs**: 13px / 400 / Storm Cloud. Current page: 510 / Porcelain. Slash separator: mono / `--g-ink-5`. Optional count chip uses `--g-info-soft` background
- **Search input / trigger** `.search`:
  - Width 320px (max 40vw)
  - Background `--g-surface-3` (Charcoal subtle input fill)
  - Border `1px solid var(--g-line-strong)`
  - 6px radius, 10px 12px padding, Inter 13px / 400 / Light Steel
  - Placeholder: Storm Cloud
  - Hover: bg `--g-surface-2`, border `--g-line-strong` (theme-aware; never hard-code separate light/dark colors)
  - Focus: border `--g-accent`, box-shadow `--g-shadow-focus`, bg `--g-surface`
  - Press: subtle `scale(0.99)` only; disabled by reduced motion
- **Keyboard hint** `.search-kbd`: mono 10px / Storm Cloud, `--g-surface-3` bg, 1px line border, 4px radius

### 4.3 Filter Rail `.filter-rail`

Canonical shared primitive: `Rail` / `RailSection` / `RailItem` from `ui/src/components/ui/Rail.tsx`. The primitive owns rail body, section, active item, icon, label, and count rendering through CVA variants. Legacy `.filter-rail` / `.f-pill` classes remain supported only for unmigrated markup.

- 220px wide, `background: var(--g-surface)`, `border-right: 1px solid var(--g-line)`
- Section label: 10px uppercase Storm Cloud
- **`RailItem` / `.f-pill`**: full-width button, 6px 10px padding, 6px radius, Inter 13px / 400 / Light Steel
  - Inactive: transparent background, `--g-ink-2` text
  - Hover: `color-mix(in srgb, var(--g-surface-2) 54%, transparent)` bg, `--g-ink` text, 1px inset `--g-line`
  - **Active**: `--g-active-bg` bg, `--g-active-text` text, `--g-active-weight` weight
- Count badge: mono 11px / Storm Cloud (Pitch Black on accent when active)
- Filter variant is used by Browse and hidden ≤1024px. Settings uses the settings variant and collapses to an icon-only 64px rail ≤768px.

### 4.4 Main canvas `.main`

- Background: `var(--g-canvas)` (Pitch Black)
- Dotted grid: `radial-gradient(circle at 1px 1px, var(--g-line) 1px, transparent 0) 24px 24px`. Dots are Charcoal in dark mode — almost invisible but present, gives the "control panel" texture.

### 4.5 Project Switcher `.project-switcher`

- Lives in `.sb-project-switcher` under the brand and uses the same compact chrome as sidebar controls: `--g-surface` fill, `--g-line` border, 6px radius, and `--g-shadow-sm`.
- Trigger: 44px minimum height, 8px gap, 10px inline padding, 24px icon well on `--g-surface-3`; hover/open state lifts to `--g-surface-2` with `--g-line-strong` border.
- Menu: anchored popover, 320px max width, `--g-surface` white/Graphite layer, 12px radius, `--g-shadow-pop`, 6px inner padding, max height `min(480px, calc(100vh - 88px))`.
- Header stays compact: 15px display title + 12px workspace meta, bottom divider `--g-line`.
- Workspace row uses a non-interactive `--g-surface` card so it reads as context, not a competing selected option.
- Project options are 40px minimum rows with 10px gaps, 6px radius, Lucide icon, strong label, mono secondary path/count, and a right-side mono count chip. The `All projects` option also renders the right-side count chip so its statistics align with individual project rows. Hover/focus uses `--g-surface-3`.
- Hover logic matches sidebar rows: inactive hover uses a subtle surface wash (`--g-surface-3` in dark), inactive count chips flip to `--g-surface`, and active hover keeps the exact `--g-active-bg` / `--g-active-text` colors. Selected project uses the same active treatment as sidebar active rows, with the check icon inheriting the active text color. Do not use left/right colored inset stripes or side-line accents in the switcher menu. Option copy remains left-aligned; counts stay as subdued mono chips.
- Press scale is disabled under `prefers-reduced-motion`.

---

## 5. Sticky Elements & Z-Index

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

> **Rule:** Frosted overlays must be visible on top of _both_ the dotted canvas and the Graphite cards behind them — verify after each change that text remains ≥4.5:1 contrast against whatever sits beneath.

### Z-index scale (canonical)

| Range | Elements                             |
| ----- | ------------------------------------ |
| 2     | List headers, drawer tabs            |
| 4–5   | Filter wraps, bulk bars, lint groups |
| 10    | Topbar, lint controls, opt bulkbar   |
| 50–51 | Drawer backdrop / drawer             |
| 60    | Settings panel                       |
| 100   | Command palette                      |
| 180   | Run panel                            |
| 200   | Toast, chart tooltip                 |

---

## 6. Components

> Class names from the existing codebase are preserved for legacy and view-pattern CSS. Shared React primitives may migrate to token-backed Tailwind variants as described in §0.

### 6.1 Buttons

Canonical shared primitive: `ui/src/components/ui/Button.tsx`.

React API:

```tsx
<Button variant="primary" size="sm" leadingIcon={<Download size={14} />}>
  Export
</Button>
```

Variants are expressed in TypeScript with `clsx` and token-backed Tailwind utilities. Legacy `.btn*` classes remain supported for screens not yet migrated.

Base: `height: 32px; padding: 0 12px; border-radius: 6px; font: 510 13px/1.4 Inter; transition: 120ms var(--g-ease); letter-spacing: -0.012em;`

| Variant / legacy class         | Background                                       | Text          | Border                      | Hover                                        | Notes                                |
| ------------------------------ | ------------------------------------------------ | ------------- | --------------------------- | -------------------------------------------- | ------------------------------------ |
| `primary` / `.btn-primary`     | **`--g-cta`** (dark Neon Lime, light Near-Black) | `--g-cta-ink` | transparent / none          | bg `--g-cta-hover`                           | **Singular per screen.**             |
| `secondary` / `.btn-secondary` | `--g-surface`                                    | `--g-ink`     | `1px solid --g-line-strong` | bg `--g-surface-2`, border `--g-line-strong` | Default action                       |
| `ghost` / `.btn-ghost`         | transparent                                      | `--g-ink-2`   | transparent / none          | bg `--g-surface-2`, text `--g-ink`           | Tertiary                             |
| `.btn-link`                    | transparent                                      | `--g-ink-2`   | none                        | text `--g-ink`                               | Legacy 0/6px padding only            |
| `danger` / `.btn-danger`       | `--g-red`                                        | `--g-canvas`  | transparent / none          | brightness 1.08                              | Destructive                          |
| `size="sm"` / `.btn-sm`        | inherit                                          | inherit       | inherit                     | —                                            | 26px height, 10px padding, 12px font |

**Press state (all variants):** `transform: scale(0.97)` for 100ms with `--g-ease-spring`; disabled under `prefers-reduced-motion`.
**Disabled:** opacity 0.38, cursor not-allowed.
**Loading:** show 14px spinner (icon-spin), text stays.

### 6.2 Icon Button

Canonical shared primitive: `IconButton` from `ui/src/components/ui/Button.tsx`; legacy `.iconbtn` remains supported.

- 32×32, 6px radius, transparent bg, `--g-ink-2` icon
- Sizes: `sm` 26×26, `md` 32×32, `lg` 36×36
- Hover: bg `--g-surface-2`, icon `--g-ink`
- Active (toggled): bg `--g-active-bg`, icon `--g-active-text`
- Loading: SVG spins 900ms linear ∞
- Hit area extended to 44×44 via `::before` pseudo for mobile compliance

### 6.3 Tabs / Segmented Toggle

Canonical shared primitive: `Tabs` from `ui/src/components/ui/Tabs.tsx`; legacy `.seg-toggle` remains supported for unmigrated markup.

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
- Sizes: `sm` = 26px height, `md` = 32px height.
- Children: Inter 12–13px / 510 / token text. Icons 13px.
- Focus: every tab gets `--g-shadow-focus`.

### 6.4 Card

Canonical shared primitive: `Card` / `CardBody` from `ui/src/components/ui/Card.tsx`; legacy `.card` remains supported for unmigrated markup.

React API:

```tsx
<Card variant="default" padding="md" clickable>
  ...
</Card>
```

| Variant             | Background      | Border / shadow                                                            | Radius     | Notes                                    |
| ------------------- | --------------- | -------------------------------------------------------------------------- | ---------- | ---------------------------------------- |
| `default` / `.card` | `--g-surface`   | 1px `--g-line`, `--g-shadow-sm`; hover `--g-line-strong` + `--g-shadow-md` | `--g-r-md` | Default card / list container            |
| `elevated`          | `--g-surface-2` | `--g-shadow-inset`                                                         | `--g-r-lg` | Drawer hero, modal head, floating panels |
| `nested`            | `--g-canvas`    | none                                                                       | `--g-r-lg` | Inset card inside elevated surfaces      |

Padding is explicit through `padding="none | sm | md | lg"`. Default is `none` for backwards-compatible composition.

### 6.7 Badge / Chip

Canonical shared primitive: `Badge` from `ui/src/components/ui/Badge.tsx`; legacy `.chip` remains supported for unmigrated markup.

React API:

```tsx
<Badge tone="amber">Warning</Badge>
```

- Height 22px, 9999px radius (pill), mono **11px / 510**, tabular nums
- Default tone: bg `--g-surface-3`, text `--g-ink-3`
- `line`: transparent bg, 1px `--g-line-strong` border, `--g-ink-2` text
- Tonal variants `red | amber | green | blue | purple | info`: `*-soft` bg + base color text
- Alias tones: `danger → red`, `warning → amber`
- `accent`: `--g-accent` bg + `--g-accent-ink` text (use sparingly — counts as accent budget)

### 6.8 Text Input

Canonical shared primitive: `TextInput` from `ui/src/components/ui/TextInput.tsx`; legacy `.field` / `.input-shell` remains supported for unmigrated markup.

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
- `default`: `--g-surface-3` bg + `1px solid --g-line-strong` border (current primitive default)
- `outline`: transparent bg + `1px solid --g-line` border
- `subtle`: `--g-surface-3` bg + transparent border
- `search`: `--g-surface-3` bg + `--g-line-strong` border for toolbar/search contexts
- Placeholder: `--g-ink-3`
- Focus: border `--g-accent`, `--g-shadow-focus`, bg `--g-surface`
- Invalid: border `--g-red`, `aria-invalid=true`

### 6.9 Asset Card `.acard`

- `--g-surface` bg, `1px solid --g-line` border, **6px radius**, flex column
- Hover: `transform: translateY(-2px)` + `--g-line-strong` border + `--g-shadow-md`
- **Selected**: `--g-accent` border, 2px Neon Lime ring outset, `--g-shadow-md`, meta region tinted `--g-accent-soft`. A 1000ms `selectedPulse` plays once.
- Internal layout unchanged:
  ```
  .acard
    .acard-thumb     1:1, --g-surface-2 bg, border-bottom --g-line
      img            max 82% w/h, object-fit contain
      .acard-flags   absolute top-left, chip overlays
      .acard-check   absolute top-right, 0→1 opacity on hover/selected
    .acard-meta      8px 10px padding
      .acard-name    mono 12px / 510, truncate
      .acard-path    mono 10px / Storm Cloud, truncate
      .acard-row     chip stack, 4px gap
  ```
- Thumb backgrounds via `data-bg`: `checker` (14px Charcoal/Pitch Black checker), `light` (`#fff`), `dark` (`--g-canvas`)

### 6.10 Optimize Row `.opt-row`

- Grid: `28px 64px 1fr 220px 140px` (checkbox / 64px thumb / text / chips / savings)
- 6px radius, `--g-surface` bg, 1px `--g-line` border, 12px padding
- Hover: `transform: translateX(2px)` + border `--g-line-strong`
- Selected: same Neon Lime ring as `.acard`
- Savings:
  - Original: mono 11px / Fog Grey, strikethrough
  - Target: mono 16px / 590 / `--g-green`
  - Percent: mono 11px / `--g-green`

### 6.11 Duplicate Group `.dgroup`

- Container: `--g-surface` bg, 1px `--g-line`, **6px radius**
- Header `.dgroup-h`: `--g-surface-3` (Charcoal) bg, border-bottom `--g-line`, padding 8px 12px. SHA in mono 11px / Storm Cloud. Spacer + action buttons right.
- Body `.dgroup-body`: auto-fill grid (min 160px), 12px gap, 16px padding
- Tile `.dgroup-tile`: 1px `--g-line`, 6px radius, `--g-surface` bg
- **Preferred tile**: `--g-green` border + 2px Emerald ring + green badge top-right

### 6.12 Drawer `.drawer`

- 480px wide (95vw max), fixed right, slide-in 240ms `--g-ease-out`
- Background `--g-surface-2` (Deep Slate, elevated)
- Backdrop: `rgba(8,9,10,0.6)` + `backdrop-filter: blur(4px)`
- Structure: `.drawer-h` (header, 16px padding, border-bottom `--g-line`) → `.drawer-body` (scrollable)
- **Enhanced variant `.dv2`**: min(680px, 95vw)
  - Hero area: `--g-surface-3` Charcoal bg with subtle `--g-info` linear-gradient overlay
  - Sticky tab strip: `--g-surface-2` bg, active tab gets a 2px **Neon Lime** underline + Porcelain text
- Close button: top-right `.iconbtn`, ESC also dismisses

### 6.13 Modal

Canonical shared primitive: `Modal` from `ui/src/components/ui/Modal.tsx`; legacy `.modal` remains supported for unmigrated markup.

- Centered on `rgba(8,9,10,0.6)` backdrop + blur(4px), z 50.
- Sizes: `sm` 520px, `md` 760px, `lg` 960px.
- Frame: `--g-surface-2` bg, `1px solid --g-line`, 12px radius, `--g-shadow-pop`.
- Header/footer: `--g-surface` bg, 16px horizontal padding, 1px `--g-line` divider.
- Body padding: `md` (16px) or `none` for code/script previews.
- Enter: fade backdrop + `slideUp2` 200ms `--g-ease-out`; reduced motion must disable transforms.

### 6.14 Toast

Canonical shared primitive: `Toast` from `ui/src/components/ui/Toast.tsx`; `ToastProvider` owns queue/timers only.

- Stack: fixed bottom-right 24px, z 200, max `min(420px, 90vw)`, 8px gap.
- Toast frame: rounded 12px, `--g-shadow-pop`, click dismiss, focus ring `--g-shadow-focus`.
- Content uses `Notice` tone variants, so status always includes icon + text, not color alone.
- Auto-dismiss defaults: 3.5s; danger 6s.

### 6.15 Command Palette `.cmdk`

- 580px wide, top offset 12vh
- Background `--g-surface-2` Deep Slate, 12px radius, `--g-shadow-pop`
- Border `1px solid --g-line` only; do **not** add an outer focus ring to the palette frame
- Backdrop blur(8px) on `rgba(8,9,10,0.5)`
- **Input**: `--g-surface` header strip, 15px / 400 / Porcelain, no border, padding 14px 16px, bottom 1px `--g-line`
- List items: 8px 10px padding, 6px radius, hover bg `--g-surface-3`
- Active / keyboard-highlighted item uses theme-swapped `--g-active-bg`, `--g-active-text`, `--g-active-weight` (dark = Neon Lime; light = neutral wash) so hover/active colors stay correct in both schemes
- Page commands show only icon + label; do not show `G O` / `G B` style hints unless those key chords are actually implemented
- Asset results show a 34px tokenized checker thumbnail, mono filename, dim mono path, and right-aligned project name
- Group label: 10px uppercase Storm Cloud
- Empty state: centered Storm Cloud text + Inter 13px helper

### 6.16 Run Panel `.opt-run-panel`

- Fixed bottom-right, min(680px, 100vw - 48px)
- `--g-surface-2` bg, 12px radius, `--g-shadow-pop`, slideUp 240ms
- **Progress bar**: 6px height, track `--g-surface-3`, fill `--g-accent` (or `--g-green` for completion). 180ms transition.
- Max-height: min(78vh, 760px)
- Result rows: success bg `--g-green-soft` + green icon; skipped bg `--g-red-soft` + red icon; pending: skeleton shimmer

### 6.17 Bulk Action Bar `.bulkbar`

- Sticky top-0 (default) or sticky bottom-16px (`.opt-bulkbar`)
- Background `--g-surface-3` (Charcoal) — _not_ Pitch Black, to lift visually off the dotted canvas
- 1px inset `--g-line-strong`, **6px radius**, `--g-shadow-md`
- Padding 8px 12px, height 44px
- Buttons `.bulkbar-btn`: ghost-style, 6px radius, hover `--g-surface-2` overlay
- Danger variant: `--g-red` bg + `--g-canvas` text

### 6.18 Dropzone `.precheck-dropzone`

- Min-height 160px, **1.5px dashed `--g-line-strong`**, **16px radius** (only place we use xl)
- Background `--g-surface` (Graphite)
- States:
  - Hover: border `--g-ink-3`, `--g-shadow-sm`
  - **Drag-over**: solid 2px `--g-accent` border, bg `--g-accent-soft`, 2px outer Neon Lime ring
  - Disabled: opacity 0.38

### 6.19 Empty State

Canonical shared primitive: `EmptyState` from `ui/src/components/ui/EmptyState.tsx`; legacy `.empty` remains supported for unmigrated markup.

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

### 6.20 Scroll-to-top `.scroll-top-btn`

- Fixed bottom-right 24px, 36px circle
- `--g-surface-2` bg, 1px `--g-line-strong` border, `--g-shadow-md`
- Hover: bg `--g-surface-3`, `translateY(-2px)`, icon `--g-ink`
- Show after 480px scroll

### 6.22 Directory Picker (`Select Project Directory` modal)

Used by `DirectoryPickerModal.tsx`. Sits inside a standard `.modal` (§6.13).

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
- **`.directory-path-row`**: input + Go button inline; input uses `.field` / `.input-shell` Charcoal Grey fill with HardDrive icon prefix
- **`.directory-panel`**: `--g-canvas` Pitch Black inset well with 1px Charcoal inset border (`--g-shadow-inset`), 6px radius — visually a recessed dark panel inside the Deep Slate modal body
- **`.directory-item`**: `display: grid; grid-template-columns: 18px minmax(0, 200px) 1fr; gap: 10px;` — folder icon + name + truncated full path. Hover bg `--g-surface-2`, focus 2px Neon Lime ring. Each row 32px tall.
  - Name: Inter 13px / 510 / Porcelain
  - Code path: mono 11px / Fog Grey, right-aligned, truncates with ellipsis
- **Error state**: inaccessible / missing / invalid paths render an `.empty` state inside `.directory-panel` using an AlertTriangle icon, localized title, and the API error text (including the attempted path). Directory-listing queries do not retry these 4xx responses, so the panel must settle quickly instead of showing an indefinite loading state.
- **Footer**: `justify-content: space-between` so the current path label sits left and `[Cancel] [Add This Directory]` action group sits right. The Add CTA uses the primary button variant (`--g-cta`) and counts as the screen's primary action. Disable it unless the current listing resolved successfully.

### 6.23 Tooltip `<Tooltip>` (custom, non-native)

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
- Optional `.tooltip-kbd`: mono 10px / Storm Cloud, `--g-surface-3` bg, 4px radius, 1px Gunmetal border
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
- Truncated labels — pair with `truncation-strategy` rule from §11

### 6.24 Notice

Canonical shared primitive: `Notice` / `NoticeStack` from `ui/src/components/ui/Notice.tsx`; legacy `.notice` remains supported for unmigrated markup.

- Tones: `info | success | warning | danger`.
- Base: flex row, 10px icon gap, 12px padding, 6px radius, 1px token border, 13px Inter.
- Each tone combines soft background, matching icon color, title text, and body text.
- Role: `danger` uses `alert`; all other tones use `status`.
- Loading uses `Loader2` with token motion.

### 6.25 Select

Canonical shared primitive: `Select` from `ui/src/components/ui/Select.tsx`.

- Trigger: 26px (`sm`) or 32px (`md`), `--g-surface-3` bg, `--g-line-strong` border, 6px radius.
- Menu: absolutely positioned with viewport-aware top/bottom placement, `--g-surface-2`, `--g-line`, 6px radius, `--g-shadow-pop`, z 60.
- Option active state uses `--g-active-bg` / `--g-active-text`.
- ESC and outside click close the menu. Full roving keyboard navigation is a separate accessibility pass.

### 6.26 Stat Card

Canonical shared primitive: `StatCard` from `ui/src/components/ui/StatCard.tsx`.

- Default card chrome: `--g-surface`, 1px `--g-line`, 6px radius, `--g-shadow-sm`, 18px/20px padding.
- Label: uppercase 11px / 510, token tone color.
- Value: display 36px / 590, tabular nums, -0.035em tracking.
- Clickable cards are real buttons with focus ring and hover lift (`translateY(-2px)` disabled under reduced motion).
- Tones: `neutral | accent | green | red | amber | blue`.

### 6.27 Asset Thumbnail

Canonical shared primitive: `AssetThumbnail` from `ui/src/components/ui/AssetThumbnail.tsx`.

- Sizes: `sm` 36px, `md` 48px, `lg` 64px, `fill` square container.
- Backgrounds: `surface`, `checker`, `light`, `dark` mapped to existing thumbnail background rules.
- Container: `--g-r-sm`, 1px `--g-line`, grid centered, image object-fit contain.
- Empty `alt` marks the thumbnail as decorative with `aria-hidden`.

### 6.28 Rail

Canonical shared primitive: `Rail` / `RailSection` / `RailItem` from `ui/src/components/ui/Rail.tsx`.

- `Rail` renders the 220px rail body with token-backed CVA variants: `filter` for Browse-style facets and `settings` for section navigation.
- `RailSection` owns the vertical group stack and optional uppercase section heading.
- `RailItem` owns the button item shape, active state, optional Lucide icon, label truncation, and optional mono count. It exposes state as `data-state="active|inactive"`; active state uses `--g-active-bg`, `--g-active-text`, and `--g-active-weight` so dark and light modes stay theme-correct.
- Settings section items use the `settings` item variant, preserving icon + label on desktop and hiding labels at ≤768px.
- Browse facets must pass counts through `RailItem count` instead of composing custom count spans.

### 6.21 Severity Indicator

- 6px circle dot + 11px mono label, 6px gap
- Critical: `--g-red` dot + `chip-red`
- Warning: `--g-amber` dot + `chip-amber`
- Info: `--g-info` dot + `chip-info`
- Pass: `--g-green` dot + `chip-green`

> Color is paired with text in every case. A user reading via screen reader or with deuteranopia gets the same information.

---

## 7. View Patterns

### 7.1 Browse

- Grid mode `.browse-grid` size variants: `s` (120px min) / default (180px) / `l` (240px)
- List mode: `.list` 6-column grid, sticky header `--g-surface-2` bg
- In All projects scope, the Browse project filter rail is driven by the registered project list, not just assets in the current result set, so zero-asset projects remain visible with a `0` count.
- Project-scoped entry points open Browse with the matching project facet active in the `Rail` filter variant, so the visible active item matches the source project card / sidebar project scope. While a Project Switcher scope is active, the Browse project rail hides the redundant `All projects` row and keeps the scoped project as the only active project facet.
- Sticky filter bar `.opt-filters-wrap`: frosted (`--g-canvas` 92%) with status chips (全部 / 未使用 / 重複 / 可最佳化 / 已引用)
- Active list row: `--g-accent-soft` bg + 4px left **Neon Lime** stripe

### 7.2 Duplicates

- `Tabs` primitive in page header: Exact / Similar and sort controls
- `.dgroup` SHA-headed groups remain supported for denser duplicate layouts
- Preferred tile: green Emerald border + corner badge
- Similar tab: side-by-side compare with overlay slider — slider track `--g-surface-3`, thumb `--g-accent`

### 7.3 Unused

- `.acard-check` (top-right) toggles selection
- `.bulkbar` sticky top-0 with: select all, copy paths, copy `git rm`, delete selected
- Delete CTA uses `.btn-danger`, never `.btn-primary`

### 7.4 Optimize

- Sticky frosted `.opt-filters-wrap` (z 4, blur 12px)
- Category chips `.opt-filter-row` (大小 / 格式 / SVG / 尺寸 / 動畫), horizontally scrollable
- Severity chips (嚴重 / 警告 / 建議), separated by 1px Charcoal vertical divider
- `.opt-row` 5-column grid as in §6.10
- `.opt-summary` 4-column KPI grid at top
- `.opt-progress`: indeterminate uses `slide-right` keyframe; determinate fills with `--g-accent`
- Skeleton shimmer for in-flight estimates
- `.opt-bulkbar` is **bottom-sticky** (16px from bottom)

### 7.5 Lint

- `.lint-kpi`: 4-column KPI grid (critical / warning / info / total)
- `.lint-controls`: sticky top-0, solid `--g-canvas`, z 10
- Grouped findings (3 levels):
  - `.lint-group` (by rule) — sticky header at CSS var offset, `--g-surface-3` bg
  - `.lint-subgroup` (by file) — 12px indent
  - `.lint-finding` (leaf) — expandable suggestion + mono snippet in `--g-surface-3` block
- Severity dot + chip per §6.21

### 7.6 Pre-Check

- Top dropzone (§6.18) accepting drag/drop/paste/click
- `.precheck-result-card`: flex row (56px thumb + body), `--g-surface` bg, 6px radius
- Verdict badge: pass=`chip-green`, warning=`chip-amber`, fail=`chip-red`
- `.precheck-finding` rows: mini chip + mono path

### 7.7 Dashboard

- KPI grid uses `StatCard`: auto-fit min 220px, `--g-surface` cards, 6px radius
- Clickable KPI: button semantics, focus ring, hover `translateY(-2px)` + `--g-shadow-md`
- KPI value: Inter display 32px / 590, delta badge mono 11px (green up / red down)
- Mini sparkline: 36px height bar cluster, hover `scaleY(1.04)` from bottom
- Segment composition bar: 22px height, 1px gaps between colored segments (`--g-surface` slivers)
- Action card grid: auto-fit min 260px, `.card` style with chevron
- Overview: 1.4fr / 1fr two-column at ≥980px, single-column below

### 7.8 Projects

- Projects uses the `FolderKanban` Lucide icon across the sidebar nav, topbar crumbs, command palette, project cards, project switcher project rows, and Settings projects section so project roots read as tracked folders rather than organizations.
- Projects is a workspace-level view: project cards, workspace KPIs, the Projects nav badge, and the topbar count always use the full catalog, independent of the Project Switcher selection.
- Project cards use `.project-card-health-bar` as a health meter: fill width equals `health / 100`, fill tone follows the health badge (`green` / `amber` / `red`), and the track is a 16% tone mix over `--g-surface-2` so `0% health` still reads as a red danger state instead of empty data. The same health, unused, duplicate, optimizable, and lint counts are repeated in text badges so the bar is never color-only.
- The `Browse Project` action on a project card sets the project scope to that card's project and navigates to Browse; Browse initializes its project facet to the same project rather than defaulting to `All Projects`.

### 7.9 Settings

- Settings uses the shared `Rail` settings variant for section navigation and renders the right pane as a single `.settings-panel` card per section, max-width 1040px and aligned to the content start so form controls do not sprawl across the canvas.
- `.settings-panel-head` uses a 32px tokenized icon well, `--g-surface-2` header strip, 24px display title, and 14px helper text to match the card/header hierarchy used elsewhere.
- `.settings-field` rows are compact 3-column grids (`32px icon | copy | control`) with `--g-surface-2` fill, `--g-shadow-inset`, 6px radius, and hover `--g-line-strong`; controls stay right-aligned on wide desktop and stack under copy once the settings pane gets narrow (≤1100px viewport).
- Every settings row pairs its label with a Lucide icon well so the large right pane has the same command-center affordance as nav, topbar crumbs, and project rows.
- Storage rows show the persisted database path, data directory, and cache directory only. There is no separate config directory row; app state lives in the SQLite data directory, and release UI assets live in cache.

---

## 8. Animations

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

## 9. Scrollbar

Webkit:

- Width 10px (thin variant 8px, inline 6px)
- Track transparent
- Thumb: `--g-line-strong` background, 9999px radius, **2px Pitch Black border** (creates the "floating pill" look)
- Hover thumb: `--g-ink-4`

---

## 10. Responsive Breakpoints

| Width   | Changes                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------- |
| ≤960px  | Sidebar collapses to 64px icon-only rail                                                        |
| ≤1024px | FilterRail hidden                                                                               |
| ≤768px  | Page padding 20px 16px. Page title 24px. `.opt-row` collapses to 3 cols. `.opt-summary` 2 cols. |
| ≤600px  | Drawer & modal full-width                                                                       |
| ≤480px  | Crumbs truncate (hide first + separator). Search input shrinks to icon-only.                    |

---

## 11. Accessibility (canonical, must verify each release)

- **Contrast**: Porcelain on Pitch Black = 17.4:1 (AAA). Storm Cloud on Pitch Black = 6.4:1 (AA). Storm Cloud on Graphite = 6.0:1 (AA). Verify any new pair.
- **Focus**: 2px Neon Lime ring on every interactive element — never `outline: none` without a `--g-shadow-focus` replacement.
- **Touch targets**: ≥44×44pt; small icons get `hitSlop` / extended `::before` hit area.
- **Color never alone**: severity always has icon + text; preferred tile has badge + border + text label.
- **Keyboard**: tab order matches visual order, ESC dismisses overlays, ⌘K opens command palette, ⌘/ focuses search.
- **Screen reader**: every icon button has `aria-label`; toasts use `role="status"` (`aria-live="polite"`); modals trap focus and restore on close.
- **Tooltips**: every icon-only control wrapped in `<Tooltip>` (§6.23). Keyboard-reachable (focus shows tooltip immediately), uses `role="tooltip"` + `aria-describedby`, and is supplementary — the trigger must still carry its own `aria-label`. **Never** use the browser's native `title` attribute.
- **Localized copy**: visible UI strings, placeholder text, dialog labels, toast text, `aria-label`s, filter chips, count summaries, and action labels live in `ui/src/i18n/locales/*.json`. Components call `t(...)`; do not hardcode user-facing copy in TSX except product names, file extensions, keyboard hints, and API/user-provided values.
- **Reduced motion**: respect `prefers-reduced-motion` — disable transforms, keep opacity-only fades.

---

## 12. Do / Don't

### Do

- Reserve **`--g-cta`** for one primary CTA per screen; reserve Neon Lime `--g-accent` for dark CTA fill, dark active nav, focus ring, and selection.
- Build hierarchy via the **4-tier surface stack** (canvas → graphite → deep-slate → charcoal).
- Use **Inter Variable** at 510/590 weights and **negative tracking** (-0.011 to -0.022em) on all UI text.
- Default to **6px radius** for buttons/inputs/cards. Use 12px only on overlays.
- Pair every functional color with **icon + text + position**.
- Keep shadows **tight and contained** (`0 2px 4px` defaults).
- Wrap every icon-only control in `<Tooltip>` (§6.23) — non-native, keyboard-reachable, with optional shortcut hint.

### Don't

- Don't introduce another saturated brand color for interactive purposes.
- Don't apply broad gradients to large sections.
- Don't use heavy diffuse drop shadows (`0 24px 48px` blur is for overlays only).
- Don't put body/UI text below 12px or above the 1.5 line-height ceiling.
- Don't drop the focus ring without an accessible replacement.
- Don't use emoji for structural icons — Lucide / Heroicons SVG only.
- Don't randomize spacing — stick to the 4px scale.
- Don't truncate text without offering full text via `<Tooltip>` or drawer.
- Don't use the browser's native `title` attribute for tooltips — use `<Tooltip>` from `ui/Tooltip.tsx` instead.

---

## 13. Imagery

- The product surface is **screenshots and chrome**, not decorative photography.
- Icons are SVG, mono-color, filled or 1.5px stroke (one consistent set per hierarchy level — currently Lucide).
- Asset thumbnails are user content rendered in `.acard-thumb` with the three `data-bg` modes.
- No raster icons. No emoji icons.

---

## 14. Token Migration (legacy `--g-*` → Linear surface intent)

| Old assumption                      | New canonical role                                               |
| ----------------------------------- | ---------------------------------------------------------------- |
| `--g-surface` = `#ffffff` paper     | `--g-surface` = `#0f1011` Graphite card layer                    |
| `--g-accent` = warm coral `#ff5436` | `--g-accent` = Neon Lime `#e4f222`                               |
| Card radius = 14px (`--g-r-lg`)     | Card radius = 6px (`--g-r-md`); `--g-r-lg` reserved for overlays |
| Shadows: soft 24/48px diffuse       | Shadows: tight 2/4/12px; `inset 0 0 0 1px` borders               |
| Display = Inter Tight               | Display = Inter Variable (510/590)                               |
| Mono = JetBrains                    | Mono = Berkeley Mono (JetBrains as fallback)                     |

Update `_tokens.scss`, `_layout.scss`, `_components.scss`, `_patterns.scss` to honor this table whenever you touch them.

---

## 15. Light Mode Companion — "Daylight Console"

> Asset Studio is **dark-first** (Linear Midnight Command Center). The light theme is a **deliberately designed companion**, not an inversion. It shares the same component shapes, spacing, typography, and motion — only surfaces and CTA strategy change.

### 15.1 Why a separate light spec

A naive inversion fails because Neon Lime `#e4f222` has only **1.4:1 contrast** on white — far below WCAG AA's 4.5:1. Filling a primary CTA with lime on a white canvas reads as "construction sign," not "professional tool." So the light variant must:

1. **Swap the CTA color**, not invert it.
2. **Demote the accent** to focus / selection / wash usage only.
3. **Recalibrate shadows** so the "elevation by tight shadow" intent still reads on white (where any shadow > 0.1 alpha looks heavy).

### 15.2 Surface strategy

| Layer     | Light value                | Why                                                                  |
| --------- | -------------------------- | -------------------------------------------------------------------- |
| Canvas    | `#fafbfc` (warm off-white) | Pure white causes screen fatigue; off-white preserves "page" feeling |
| Surface   | `#ffffff` (pure white)     | Cards must visually lift above the canvas                            |
| Surface-2 | `#f4f5f7` (cool wash)      | Hover state on cards, segmented inactive                             |
| Surface-3 | `#eceef2` (cooler wash)    | Inset wells, group headers, active nav bg                            |

Borders: `#e5e7eb` default, `#d1d5db` strong. Both light enough to whisper, dark enough to define edges.

### 15.3 CTA strategy — the Vercel pattern

```
Dark mode:  Primary CTA = Neon Lime fill + Pitch Black text  (16.7:1 contrast)
Light mode: Primary CTA = Near-Black fill + White text       (16.5:1 contrast)
```

This mirrors Vercel and GitHub: the primary action **flips with the theme** so it always punches through. Both modes are recognizable as "the button" without sharing the same color.

Implemented via theme-swapped tokens:

- `--g-cta`, `--g-cta-ink`, `--g-cta-hover` — the `.btn-primary` rule reads these and swaps automatically.
- `--g-active-bg`, `--g-active-text`, `--g-active-weight` — sidebar active item, iconbtn active toggle.

### 15.4 Where Neon Lime still appears in light mode

- **Focus rings**: 2px Neon Lime @ 0.55 alpha + 1px ink @ 0.08 alpha layered (the second ring gives definition on white).
- **Selection rings on cards**: 2px Neon Lime border, 1px Neon Lime soft wash on the meta region.
- **Hover wash on accent chips** `chip-accent`: filled lime + near-black text (still passes contrast since lime is bright).
- **NEVER** as a primary CTA filled background on a light surface.
- **NEVER** as a section background or large coverage area.

### 15.5 Active state — neutral wash, not lime

Light-mode active nav uses:

- Background: `--g-surface-3` (#eceef2 cooler wash)
- Text color: `--g-ink` (near-black)
- Font weight: **590** (one notch heavier than non-active 400)

The combination of subtle bg + bold weight reads as "selected" without screaming. Lime fill on a white sidebar against a near-white canvas would be visually exhausting.

### 15.6 Semantic colors — adjusted for white background

| Token        | Dark               | Light                  | Why light value differs                                       |
| ------------ | ------------------ | ---------------------- | ------------------------------------------------------------- |
| `--g-green`  | `#27a644` Emerald  | `#007a26` Forest Green | Emerald loses contrast on white; Forest Green is AA-compliant |
| `--g-amber`  | `#f0b429`          | `#b45309` Burnt Amber  | Yellow on white is unreadable (1.7:1); burnt amber passes AA  |
| `--g-red`    | `#eb5757`          | `#dc2626`              | Slightly deeper red so error chips read on white              |
| `--g-purple` | `#8b5cf6` Amethyst | `#7c3aed`              | Deeper violet for AA on white                                 |

### 15.7 Shadow recalibration

Light-mode shadows are **3–4× lower alpha** than dark:

| Token            | Dark                                         | Light                                             |
| ---------------- | -------------------------------------------- | ------------------------------------------------- |
| `--g-shadow-sm`  | `0 2px 4px rgba(0,0,0,0.4)`                  | `0 1px 2px rgba(15,17,21,0.04)`                   |
| `--g-shadow-md`  | `0 4px 12px rgba(0,0,0,0.4) + 0 1px 3px 0.3` | `0 4px 12px rgba(15,17,21,0.06) + 0 1px 3px 0.04` |
| `--g-shadow-pop` | `0 4px 32px rgba(8,9,10,0.6) ...`            | `0 24px 48px -12px rgba(15,17,21,0.18) ...`       |

Dark shadows can be opaque because the canvas is already black. Light shadows must be subtle — over-shadowing on white is the #1 tell of an amateur Linear-clone.

### 15.8 Theme switching

- Default theme is **dark** (`localStorage` value `"light"` is the only opt-in trigger; absence or `"dark"` → dark).
- Theme is applied via `[data-theme='dark']` attribute on `<html>`. `:root` defaults to light, dark overrides via attribute.
- All token-driven components (buttons, inputs, modals, drawers, etc.) automatically theme-swap. No component needs `[data-theme]` selectors except the few exceptions noted in `_layout.scss` (e.g. dotted canvas in dark, sb-link active hover).

### 15.9 Light-mode delivery checklist

In addition to §15, when delivering UI work that lands light-side:

- [ ] No Neon Lime as a filled CTA on white surfaces.
- [ ] All shadows lifted to `--g-shadow-*` tokens (don't hand-roll on white — you will over-shadow).
- [ ] Focus ring uses the layered (lime + ink @0.08) variant — single lime ring is invisible on white.
- [ ] Functional colors verified at 4.5:1 against the surface they sit on (use `--g-green / --g-amber / --g-red / --g-purple` light values, not dark values).
- [ ] Active nav/icon states use `--g-active-*` tokens, not `--g-accent`.
- [ ] Tested side-by-side with dark — both modes should feel like the same product, just different lighting.

---

## 16. Pre-Delivery Checklist (UI changes)

Run through this list **before declaring any UI task complete**:

- [ ] No new color introduced outside §2.1.
- [ ] Single primary CTA per screen — `--g-cta` fill is unique.
- [ ] All radii from §2.4 (no arbitrary values).
- [ ] All spacing from the 4px scale.
- [ ] Body text ≥14px, line-height ≥1.4.
- [ ] All interactive elements have visible focus ring (2px Neon Lime).
- [ ] All icon-only buttons have `aria-label`.
- [ ] Touch targets ≥44pt (real or via hit-slop).
- [ ] Severity / status pairs color with icon + text.
- [ ] `prefers-reduced-motion` respected for any new animation.
- [ ] Tested at 375px / 768px / 1024px / 1440px widths.
- [ ] Frosted overlays still legible above whatever scrolls beneath.
- [ ] **Both themes verified side-by-side** — toggle dark ↔ light in Settings; layout, contrast, and intent must match. See §15.9 for light-specific checks.
- [ ] **DESIGN.md updated** to reflect any token / component / pattern change.
