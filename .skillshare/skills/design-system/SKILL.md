---
name: design-system
description: >
  Aisets UI design system — token usage, CVA component patterns, Tailwind co-location rules,
  and pre-delivery checklist. Use this skill whenever editing ANY file under ui/src/, including .tsx,
  .ts, and style files. Also use when creating new UI components, modifying existing ones, changing
  colors/spacing/typography, adding animations, or touching anything visual. Even simple one-line
  UI tweaks should consult this skill — the token and cascade rules catch subtle bugs.
globs:
  - "ui/src/**/*.tsx"
  - "ui/src/**/*.ts"
  - "ui/src/styles/**"
---

# Aisets Design System

## Why this skill exists

This project uses a strict token-based design system with CVA (class-variance-authority) for
component variants and Tailwind for co-located styles. The system prevents visual inconsistencies,
dark/light theme breakage, and cascade conflicts that are hard to debug. Every rule below exists
because someone hit the problem it prevents.

---

## 1. How styling works

```
┌─ _tokens.scss ──── CSS custom properties (--g-canvas, --g-ink, --g-accent, etc.)
│                    `:root` = light, `[data-theme="dark"]` = canonical dark
│
├─ tailwind.css ──── @theme block maps --g-* → Tailwind classes
│                    e.g. --color-g-surface: var(--g-surface) → `bg-g-surface`
│                    The `g-` prefix in class names means "uses a design token"
│
├─ _patterns.scss ── @keyframes, .sr-only, .bg-checker (shared utilities)
│
├─ components/ui/ ── CVA primitives (Button, Modal, Select, Badge, etc.)
│                    Each exports a `*Variants` function + component
│
└─ components/ ───── Page components use Tailwind classes directly in JSX
```

**The only SCSS files are `_tokens.scss`, `_patterns.scss`, and `globals.scss`.
No component styles live in SCSS. Everything visual is co-located in `.tsx`.**

### Token naming convention

Tailwind classes use the `g-` prefix to reference design tokens:
- Colors: `bg-g-surface`, `text-g-ink`, `border-g-line`, `text-g-red`
- Radius: `rounded-g-sm` (4px), `rounded-g-md` (6px), `rounded-g-lg` (12px)
- Shadows: `shadow-g-sm`, `shadow-g-md`, `shadow-g-pop`, `shadow-g-focus`
- Fonts: `font-g` (body), `font-g-mono`, `font-g-display`
- Text: `text-g-chip` (10px), `text-g-caption` (11px), `text-g-ui` (12px), `text-g-body` (13px)
- Easing: `ease-g`, `ease-g-out`, `ease-g-spring`
- Button heights: `h-g-btn-sm` (26px), `h-g-btn-md` (32px), `h-g-btn-lg` (36px)

Full token values are in `_tokens.scss`. Full @theme mapping is in `tailwind.css`.

### Cascade gotcha (important)

SCSS files (`_tokens.scss`, `_patterns.scss`) are NOT inside a CSS `@layer`. Tailwind v4
utilities ARE in a layer. This means **SCSS properties always beat Tailwind utilities** in
the cascade.

Practical consequence: if an element has both a SCSS class and a Tailwind class for the same
property (e.g., `.content-scroll` sets `padding: 32px` and you add `p-4`), the SCSS wins
silently. The fix: **remove the SCSS class entirely** and replace with full Tailwind.

Also: `twMerge` in Tailwind v4 can't always resolve spacing-scale utilities (`w-80`) against
keyword utilities (`w-full`). Use arbitrary values (`w-[320px]`) when combining with CVA bases.

### twMerge font-size vs color conflict (critical)

`twMerge` treats ALL `text-*` classes as one group. Custom theme tokens like `text-g-ui`
(font-size) and `text-g-ink` (color) look identical to twMerge — it keeps only the last one,
**silently dropping font-size**. This is fixed in `cn.ts` via `extendTailwindMerge` registering
font-size tokens in a separate class group.

**Before changing font-size tokens:** run `twMerge('text-g-ui text-g-ink')` to verify the
font-size class survives. If it's dropped, fix `cn.ts` `classGroups.font-size` first.

**When adding new `text-*` theme tokens:** register them in `cn.ts` `extendTailwindMerge →
classGroups → font-size` or they will be silently eaten by color classes.

---

## 2. Component pattern

### New UI primitive → CVA

```tsx
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const widgetVariants = cva("base tailwind classes here", {
  variants: {
    variant: { primary: "...", secondary: "..." },
    size: { sm: "...", md: "..." },
  },
  defaultVariants: { variant: "primary", size: "md" },
});

type WidgetProps = React.HTMLAttributes<HTMLElement> &
  VariantProps<typeof widgetVariants>;

function Widget({ variant, size, className, ...props }: WidgetProps) {
  return <div className={cn(widgetVariants({ variant, size }), className)} {...props} />;
}

export { Widget, widgetVariants };
```

### Page component → direct Tailwind

Page-level components don't need CVA — just use Tailwind classes in `className` with `cn()`
for conditionals. Use the existing UI primitives for buttons, inputs, modals, etc.

### Before creating a new component

Read the barrel export at `ui/src/components/ui/index.ts` to see what already exists. The
project has 21+ primitives including Button, Badge, Card, Modal, Select, Tabs, Tooltip,
DropdownMenu, Notice, Toast, EmptyState, and more. Check before building from scratch.

---

## 3. Page layout philosophy

Every view follows the Browse / Duplicates blueprint. Deviating from this structure makes the
product feel inconsistent.

### 3.1 Content-first — no decorative chrome

- **No page titles or hero sections.** Content (StatCards, toolbar, grid) starts at the top edge.
- **No standalone empty states.** If a page has a primary action area (e.g. dropzone), merge the
  empty-state message into that area. Never stack two centered visual blocks vertically.
- **No description paragraphs.** The sidebar nav label is sufficient context. Add help via tooltip.

### 3.2 Three-layer structure

Every data view follows: **StatCards → Sticky Toolbar → Content Grid**.

```
┌──────────────────────────────────────────────┐
│ [StatCard] [StatCard] [StatCard] [StatCard]  │  ← summary row
│ [StackedBar ···························]     │  ← optional health bar
├──────────────────────────────────────────────┤
│ [Tabs] [Search···] [Sort ▾] [View ▾] [Act]  │  ← sticky toolbar (z:4–5)
├──────────────────────────────────────────────┤
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐  │
│ │card│ │card│ │card│ │card│ │card│ │card│  │  ← content grid
│ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘  │
└──────────────────────────────────────────────┘
```

- Omit layers that don't apply (e.g. PreCheck has no toolbar, Browse has no StatCards).
- Sidebar `FilterRail` is a separate column — never embed filters in the main content area.

### 3.3 StatCard neutrality

StatCard icon and label are always `text-g-ink-4` (neutral grey). The large number value provides
emphasis. Semantic color goes only on badge/chip elements in the content area, not on stat labels.

### 3.4 Information density

- 4px base spacing, compact density. Avoid large padding between functional elements.
- File metadata uses compact `<Badge>` chips, not full sentences.
- Details open in drawers/panels on click — not inline-expanded paragraphs.

---

## 4. Component rules

These aren't taste preferences — each prevents a specific class of bugs:

| Rule | Why |
|------|-----|
| **All values from `--g-*` tokens** | Raw hex breaks when themes switch. A hardcoded `#ffffff` is invisible on light canvas. |
| **Single CTA per screen** | Multiple `--g-cta` buttons create visual competition. Users don't know where to click. |
| **Color + icon + text for status** | ~8% of males are colorblind. Color alone is invisible to them. |
| **6px default radius (`--g-r-md`)** | Consistency across the product. Only overlays get 12px. |
| **Tooltips via Radix, not `title`** | Native tooltips can't be styled, have inconsistent delay, and no keyboard trigger. |
| **Lucide icons only** | Mixing icon sets (or using emoji) creates visual noise. |
| **`cn()` for all class merging** | It wraps `clsx` + `twMerge` — handles conditional classes and deduplicates conflicts. |
| **No decorative left-edge bars** | Never add purely decorative vertical colored bars on container edges. Exception: functional severity indicators (`border-l-[3px]` + severity color) are allowed on data rows when severity is a primary dimension (e.g. Optimize list items). Always pair with `border-l-transparent` fallback for consistent alignment and add extra `pl-5` to separate the bar from content. |
| **StatCard icon mandatory** | Every `<StatCard>` must have `icon={<LucideIcon size={14} />}`. Omitting icons on some cards in a grid breaks visual rhythm. |
| **i18n code-first** | Never render backend strings directly. Use `t(\`ns.${code}\`, { defaultValue: raw })` with the machine code field. |
| **i18n key hygiene** | Add locale keys only for namespaces that UI code actually reads, or for backend machine codes that can flow into that namespace. Remove unused translation keys instead of keeping speculative duplicates; stale keys hide missing-key regressions and create translation maintenance debt. |
| **Collapsible via grid-rows** | Animated expand/collapse uses `grid-rows-[0fr]` → `grid-rows-[1fr]` with `overflow-hidden` inner div. Add `motion-reduce:transition-none`. |
| **Upload results accumulate** | Multi-batch upload flows append to existing results via ref + `setResults(prev => [...prev, ...incoming])`. Clear button resets all. |
| **Module-level state cache** | Views that unmount on route change use module-level `let _state` + `useEffect` sync to persist data across navigations. Cleared on page refresh. |
| **Virtual scroll: no fixed height** | `useVirtualizer` items must NOT set `height: vItem.size` on wrappers — it clips content when images load. Use only `transform: translateY(...)` + `measureElement` ref. |
| **Sticky headers in virtual lists** | `position: sticky` doesn't work on absolute-positioned virtual items. Render a sticky indicator in the toolbar div that reads the current section from visible virtual items. |
| **`content-scroll` on the real scroller** | Put `content-scroll` on the element with `scrollHeight > clientHeight`, not a non-scrolling wrapper. `ScrollToTop` picks the overflowing one. Early-return branches (loading/empty) must NOT have `content-scroll` — it poisons the `ScrollToTop` binding. |
| **Server-side filtering** | FilterRail filters → API query params (re-fetch), not client-side `useMemo` on loaded data. Lazy-loaded data is partial. |
| **API totals, not loaded counts** | StatCards, Tabs, FilterRail use `query.data.pages[0].total` / `.facets`. Never `items.length` during lazy loading. |
| **Lazy load via sentinel** | Use `useInfiniteScrollSentinel`, not `useEffect` auto-pagination. |
| **Facets match the view's unit** | DuplicatesView shows groups → facets must count groups (from duplicates API), not files (from items API). Use `project_name` not `project_id` for display. |
| **Query key normalizers** | Adding a filter param to `CatalogXxxParams` → also add it to `normalizeCatalogXxxParams` in `queries.ts`. Omitting it means the React Query cache key won't change, silently returning stale data. |
| **Cross-filter facets** | FilterRail facets use cross-filter: project facets computed with ext filter (project cleared), vice versa. Backend facet function accepts both params, clears the "self" dimension. |
| **Toolbar controls: 32px height** | All toolbar filter controls — TextInput, Tabs, Select — use `h-g-btn-md` (32px). TextInput uses `variant="search"`. Never use custom styled buttons for filters — use the project's `Tabs` or `SegmentedControl` components. |
| **FilterRail on every data view** | Every data-heavy page (Browse, Duplicates, Lint, History) must have a `Rail` + `RailSection` + `RailItem` sidebar. Use the existing `FilterRail` component or compose from Rail primitives. Each rail filter must trigger an API re-fetch (server-side), not client-side filtering. Client-side cross-filter is acceptable when all data is already loaded (e.g. scan diff rows). |
| **FilterRail labels must be translated** | RailItem labels for machine IDs (ruleId, status codes) must use `t(\`ns.${id}.name\`, { defaultValue: id })`. Never display raw kebab-case IDs to users. |
| **Fragment pattern for FilterRail views** | Views with a FilterRail sidebar render as `<> <Rail/> <div content-scroll/> </>`. App.tsx must NOT wrap them in the shared scroll div — move them to a separate branch like DuplicatesView. |
| **Virtualizer: call `measure()` on collapse** | When collapsible groups change the virtual row count, cached `estimateSize` results become stale (old finding sizes applied to header indices). Call `virtualizer.measure()` via `useEffect` keyed on row count + collapsed size to force re-estimation. |
| **Sticky toolbar: translucent backdrop** | Sticky toolbars use `bg-[color-mix(in_srgb,var(--g-canvas)_92%,transparent)] backdrop-blur-[12px]` — not opaque `bg-g-canvas`. Match the BrowseToolbar pattern. |
| **i18n: extract args from English fallback** | When backend embeds dynamic values (KB, paths) in message strings but doesn't persist structured args, use a frontend `extractArgs(finding)` helper with regex to parse values from the English message before passing to `t()`. |
| **No `overflow-hidden` with sticky children** | `overflow: hidden/auto/scroll` on a container breaks `position: sticky` for descendants. Remove overflow or use `overflow-clip` when a child needs sticky relative to an outer scroll ancestor. |
| **Callback ref for conditional-render measurement** | When a view has early-return branches (loading/empty), `useEffect(fn, [])` misses the ref target on first render. Use `useCallback` ref + `ResizeObserver` for dynamic measurements like toolbar height for second-level sticky. |
| **Virtual scroll `scrollMargin` for nested containers** | When the virtual container sits below StatCards/toolbar/panels inside the scroll element, pass `scrollMargin: virtualContainerRef.offsetTop` to `useVirtualizer` and subtract it from each item's `translateY`. Without this, items render at wrong positions (gap between header and first row). |
| **No `<table>` with virtualizer** | `<tr>` cannot be `position: absolute`. Use div + CSS grid (`grid-cols-[...]`) with `role="table"`, `role="row"`, `role="columnheader"` for virtualized tabular data. Match BrowseList's `--row-y` CSS custom property + `translate-y-[var(--row-y,0)]` pattern. |
| **Tab counts via `badge` prop** | Show tab counts as separate styled elements using the Tabs `badge` prop (`<span className="font-[400] text-g-ink-4">{count}</span>`), not embedded in the `label` string. "All" tabs must NOT show counts — only individual filter values show counts. Consistent across Duplicates, Optimize, and Lint views. |
| **Grid table: `border-b` on row, not cells** | In div-based CSS grid tables, put `border-b` on the row div, not on individual cells. Cells may have different heights (badges vs text), causing per-cell borders to misalign. A single row-level border guarantees one straight horizontal line. |
| **Grid table: distribute `fr` across columns** | When defining `grid-cols-[...]` for data tables, never give only one column `1fr` while all others are fixed `px` — that column absorbs all remaining space, creating a visual gap. Use `fr` on 2–3 content columns (e.g. `path: 2fr`, `project: 1fr`, `bytes: 1fr`) so extra space is distributed proportionally. |
| **i18n tab label length** | English labels are 2–3× wider than CJK ("Dimensions" vs "尺寸"). When multiple `<Tabs>` groups share one row, keep EN labels to 3–6 chars (Fmt, Dims, Crit, Warn, Suggest). Always verify EN locale at 1440px — overflow invisible in zh-TW will break English. |
| **No `max-h-full` on images in grid containers** | `max-height: 100%` inside `grid` with `place-items-center` resolves against the auto-sized grid track, not the container's explicit height — the image overflows and gets clipped by `overflow-hidden`. Use `absolute inset-0 h-full w-full object-contain` with a `relative` container instead. This is the standard pattern for fitting an image within a fixed-aspect-ratio box (e.g. `aspect-[4/3]`). |
| **useEffect deps: derived booleans** | `useReducer` activity objects get a new reference on every dispatch (streaming counts). Effects watching `[activity]` re-run per event. Extract the derived value outside (`const busy = isBusy(activity)`) and watch only the boolean — reruns only when it actually changes. |
| **Portal for dropdowns in scroll containers** | `position: absolute` dropdowns inside `overflow-y-auto` scroll containers get clipped. Use `createPortal(menu, document.body)` + `position: fixed` with `getBoundingClientRect()` positioning. Listen to scroll events (with `{ capture: true }`) to reposition on scroll. Include the portal element in click-outside detection via a separate ref. |
| **Auto-flip dropdown on viewport edge** | Fixed-position dropdown menus must check `spaceBelow` vs `menuHeight`. If insufficient space below and more space above, flip the menu upward (`top = triggerRect.top - menuH - gap`). Use `requestAnimationFrame(updatePosition)` after first render to get accurate menu height for the flip calculation. |
| **Action panel: left-right between layout** | AI run cards and similar action panels use `flex items-start justify-between` — description on the left (`max-w-[28ch]`), controls on the right (`shrink-0 w-[520px]`). Don't use FieldRow for action-oriented cards where the primary purpose is "pick scope → run" — FieldRow is for settings fields, not execution panels. |
| **Use shared input primitives** | Never use raw `<input>`/`<textarea>` in page components. Use `TextInput`, `Textarea`, `Select` from `./ui`. Raw elements miss `--g-input-*` tokens and produce broken focus/hover states in light mode. |
| **Tool/config pages follow Settings layout** | New tool/config pages must match the Settings pattern: `Rail variant="settings"` sidebar + content in a single `Card` at `max-w-[1040px]`. Data views follow the Browse pattern with `FilterRail` + three-layer structure. Never invent a new layout. |
| **Sidebar nav must use RailItem** | All sidebar navigation uses `Rail` + `RailSection` + `RailItem`. The active state tokens (`--g-active-bg`, `--g-active-text`, `--g-active-weight`) are built into `RailItem` — custom button lists will mismatch both themes. |
| **Toast for every mutation** | Every React Query mutation needs `onSuccess`/`onError` with `useToast()`. Use `errorMessage(err)` for error bodies. Add i18n keys to all 5 locales. |
| **Verify both themes before delivery** | Dark mode (canonical) passes ≠ done. Light mode has different surface/border contrast — test both. White-on-white inputs and invisible borders only appear in light mode. |

---

## 5. Pre-delivery checklist

Run through before reporting any UI task as done:

- [ ] All visual values from `--g-*` tokens — no raw hex, no arbitrary px for radius/shadow
- [ ] New component uses CVA with exported `*Variants` function
- [ ] Only one `--g-cta` filled button per visible screen
- [ ] Status/severity combines color + icon + text
- [ ] `aria-label` on every icon-only button
- [ ] Overlays: ESC dismiss + focus trap (Radix Dialog/AlertDialog handles this)
- [ ] Verified in **both dark mode (canonical) and light mode** — light mode has different surface contrast
- [ ] Responsive check: 1440 / 1024 / 768 / 375
- [ ] All text inputs use `TextInput`/`Textarea`/`Select` from `./ui` — no raw `<input>`
- [ ] Layout matches an established page pattern (Settings or Browse blueprint)
- [ ] `DESIGN.md` updated if you added a new token, component, or variant

---

## 6. Reference

For full token tables (all colors, spacing, radius, shadow values), type scale, surface
hierarchy, component specs, accessibility rules, and view-by-view patterns:

→ Read `DESIGN.md` (the comprehensive spec). This skill covers the rules you need for every
edit; DESIGN.md has the detailed reference data you need when designing something new.
