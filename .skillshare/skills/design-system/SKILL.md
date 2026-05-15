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
| **AI contracts stay English-only** | Every AI-facing prompt, system/follow-up/repair prompt, tool schema, tool arg, label, description, impact, stream status code, and action metadata stays English/structured, even for non-English user messages. Define response formats that separate machine fields from display text, then localize only assistant prose and UI-visible status/reply strings through i18n/settings; hard-coded non-English intent, synonym, count/unit, or fallback phrases in UI/backend logic become hidden business rules. |
| **AI-readable asset payloads** | Canvas snapshots, debug JSON, and compact tool results must include file name, repo path, image format/dimensions/bytes, visual `url`/`thumbnailUrl`, AI tag summaries, OCR text when available, and stable IDs. IDs alone force extra lookups and make image-description tasks unreliable. |
| **Canvas terminal answer phase** | Tool-use flows must finish with a localized display reply when the user requested a status or description. Keep tool contracts English/structured, but render the final prose from compact tool results or i18n data instead of looping through more focus/layout actions. |
| **Intentional multilingual data is explicit** | Native-language text is allowed only when it is the data itself: language names, OCR/language aliases, Unicode language detection regexes, and deliberate semantic loading phrase arrays such as `SEMANTIC_PHASES`. Do not reuse those exceptions for AI prompts, tool metadata, status codes, or intent routing. |
| **i18n key hygiene** | Add English for every new key. Add non-English locale entries only for the display language(s) the change actually surfaces or the user asks for; do not bulk-fill all five locales speculatively. Remove unused translation keys instead of keeping stale duplicates that hide missing-key regressions. |
| **Locale parity on request** | When a feature is already translated across locales or the user explicitly asks to fill the other languages, compare every locale against `en` and validate `{{placeholder}}` parity before delivery. Missing keys silently fall back to English or produce partially translated UI. |
| **Collapsible via grid-rows** | Animated expand/collapse uses `grid-rows-[0fr]` → `grid-rows-[1fr]` with `overflow-hidden` inner div. Add `motion-reduce:transition-none`. |
| **Upload results accumulate** | Multi-batch upload flows append to existing results via ref + `setResults(prev => [...prev, ...incoming])`. Clear button resets all. |
| **Module-level state cache** | Views that unmount on route change use module-level `let _state` + `useEffect` sync to persist data across navigations. Cleared on page refresh. |
| **Drawer tabs stay mounted** | Drawer tab panels that contain forms, async output, or AI results must switch visibility with `hidden`/CSS instead of conditional-rendering only the active tab. Key the mounted panel group by `asset.id` or the drawer entity ID so state resets on item changes, not tab changes; otherwise AI messages and local state disappear when users inspect another tab. |
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
| **English translation UI uses raw fallback** | In English translation views, show the English translation when available and otherwise the raw stored label. Do not hide untranslated non-English values and do not render `translated (raw)` in English mode — incomplete translation coverage must degrade to a visible fallback, not blank or confusing UI. |
| **Localized catalog surfaces must request locale-aware data** | Browse cards, drawers, category dropdowns, global command-palette semantic samples, and tag/category editors that display AI category/tag translations must pass `i18n.language` to catalog/detail APIs. Render-only localization is insufficient when the UI depends on backend-provided `categoryI18n`, `tagsI18n`, category-list translations, or translated facet maps — omitting `lang` leaves parts of the screen stuck in the default language. |
| **Reference animation parity** | When implementing UI from an `animation/` reference, match its component structure, class semantics, spacing, and state-specific layout before tuning styles. Shared pieces like `.lsb-header`, pips, timer, ghost input rotator, recommendation row, and loading visual height are the spec; generic loaders or approximate layouts create visible regressions. |
| **AI metadata from settings** | AI model labels, embedding dimensions, search type, limits, thresholds, and context-strip status text must render from settings/runtime/stat APIs instead of demo literals. Hard-coded values make semantic search UI incorrect when users change provider or model settings. |
| **AI feature gates are workspace-scoped** | Semantic search, language/i18n search, tag/OCR badges, translate/embed controls, and command-palette AI entries must only appear when the active workspace/project scope reports ready AI data. Global SQLite rows from another workspace are not readiness and must not enable the UI. |
| **No `overflow-hidden` with sticky children** | `overflow: hidden/auto/scroll` on a container breaks `position: sticky` for descendants. Remove overflow or use `overflow-clip` when a child needs sticky relative to an outer scroll ancestor. |
| **Callback ref for conditional-render measurement** | When a view has early-return branches (loading/empty), `useEffect(fn, [])` misses the ref target on first render. Use `useCallback` ref + `ResizeObserver` for dynamic measurements like toolbar height for second-level sticky. If the callback ref writes measurements to state, update only when a mounted node's dimensions change; clearing state on the transient `null` callback can create a null/node render loop and hit maximum update depth. |
| **Selection overlays use rendered dimensions** | Group selection boxes, canvas bounds, and similar visual overlays must measure actual DOM size (`offsetWidth`/`offsetHeight` or `ResizeObserver`) instead of relying only on stored widths or card-height constants. Resized and compact cards otherwise extend outside the overlay. |
| **Canvas snapshots use rendered image rects** | Canvas screenshot/export code must capture the same rendered DOM geometry users see: card position, user-resized width, actual `<img>` content box, and `object-contain` natural aspect ratio. Do not recomposite from original assets with fixed card ratios or stored widths only; resized images will export at the wrong scale and spacing. |
| **Canvas captures include upload cards** | Screenshot/export and AI snapshot code must collect rendered frames from both catalog asset cards and uploaded image cards through a shared image-frame marker. Asset-only selectors make uploaded images vanish from captures even though they are visible on the canvas. |
| **Canvas cursor labels are transient** | AI cursor labels for dragging, resizing, confirming, or applying work must clear after the request and all scheduled animations settle. Nested animation timers can update the cursor after request completion, leaving stale status bubbles over the canvas. |
| **Terminal AI tool output suppresses prose** | When a safe AI Canvas tool already returns a user-facing result, such as OCR text or per-image failure status, do not append the model's same-response prose after the formatted result. The prose can be stale or speculative and may contradict the actual tool output. |
| **AI Canvas phase status is visible** | Multi-round AI Canvas flows must show concise confirmation/planning/action status in the cursor/status surface, not as normal assistant chat transcript. Keep cursor labels short and truncate the bubble; long backend status text can cover the canvas and make the cursor feel broken. Hidden backend repair loops make the AI look stuck; visible phase text lets users follow precise target confirmation before operations execute. |
| **AI Canvas follow-up state is projected** | When a streamed AI Canvas loop applies `resize_card`, `move_card`, `arrange_cards`, or layer changes, follow-up prompts and UI validation must use a projected current canvas state from those results. Reusing the original snapshot makes later tools reason from stale positions, widths, or layers and can make a mostly-correct first step regress during repair. |
| **Resize cursor anchors to handle** | Manual and AI-driven resize interactions must place the pointer tip on the actual bottom-right resize handle in rendered canvas coordinates, including viewport scale and screen-stable card scale. Anchoring to the raw card edge or center makes the cursor miss the tiny handle after zoom or card scaling. |
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
| **useEffect deps include read fields** | Effects that persist snapshots from activity/state objects must depend on every field they read, such as `phase`, `counts`, `startedAt`, `scopeLabel`, `providerName`, `modelName`, and `errors`. Missing deps keep stale metadata and leave `react-hooks/exhaustive-deps` warnings. |
| **Conditional listeners depend on open state** | Popover/menu/suggestion click-outside effects must include the open boolean in their dependency array. Empty deps capture the initial closed state, so listeners fail to attach when the UI opens or stay stale after it closes. |
| **Wheel prevention belongs in native non-passive listeners** | Canvas-style panes that need to block browser wheel behavior should use a native `wheel` listener with `{ passive: false }`. Do not call `preventDefault()` in React `onWheel`; browsers may treat it as passive and spam `Unable to preventDefault inside passive event listener` errors. |
| **Canvas card motion outside React state** | AI-driven card moves and drag previews should run on `requestAnimationFrame` with direct DOM `transform` updates, then commit `cards` state once at the end. Updating React state every animation step can re-render the Canvas with stale card coordinates and make images jitter or snap backward. |
| **Feature refactors keep shims** | Moving UI implementation from `components/*` to `features/*` must copy the real implementation, leave the old path as a re-export shim, move colocated tests, and update App/activity imports plus Vite `manualChunks` in the same change. |
| **Protect existing feature files during moves** | Before generating shims, check whether destination feature files already exist and inspect `git diff --name-status`. Mechanical move loops can overwrite a real implementation with a shim, turning compatibility glue into broken source. |
| **Action panel: left-right between layout** | AI run cards and similar action panels use `flex items-start justify-between` — description on the left (`max-w-[28ch]`), controls on the right (`shrink-0 w-[520px]`). Don't use FieldRow for action-oriented cards where the primary purpose is "pick scope → run" — FieldRow is for settings fields, not execution panels. |
| **Use shared input primitives** | Never use raw `<input>`/`<textarea>` in page components. Use `TextInput`, `Textarea`, `Select` from `./ui`. Raw elements miss `--g-input-*` tokens and produce broken focus/hover states in light mode. |
| **Route-backed controls clean their query params** | If a URL query param hydrates a visible control, that control's clear action must remove the query param too. Keep one-shot focus params separate from persistent search/filter params: drawer close clears `asset` / `focusAsset`, while the Browse search clear button clears `q`. |
| **Tool/config pages follow Settings layout** | New tool/config pages must match the Settings pattern: `Rail variant="settings"` sidebar + content in a single `Card` at `max-w-[1040px]`. Data views follow the Browse pattern with `FilterRail` + three-layer structure. Never invent a new layout. |
| **Sidebar nav must use RailItem** | All sidebar navigation uses `Rail` + `RailSection` + `RailItem`. The active state tokens (`--g-active-bg`, `--g-active-text`, `--g-active-weight`) are built into `RailItem` — custom button lists will mismatch both themes. |
| **Rail sticky section headers stack** | Scrollable Rail section headers that must stay visible should be rendered as one sticky overlay stack owned by `Rail`, not as independent per-section sticky headings. Show every scrolled-past header, keep rows the same height as Rail items, add separators plus one stack shadow, clip top radius on the Rail container, and compute click-to-return with `getBoundingClientRect()` relative to the Rail scroller while subtracting stacked header height; otherwise headings disappear into each other or jump to the next card. |
| **Register new pages in Command Palette** | Adding a new route to sidebar/topbar navigation also requires adding it to the Command Palette page list in the same change. Otherwise the page ships but cannot be found through search, which is a navigation parity regression. |
| **Editable tag UIs show localized labels but mutate raw tags** | Tag chips in drawers, popovers, and similar editors may display `tagsI18n[locale]`, but add/remove operations must still read and write the raw `tags_json` values. Submitting translated labels back to the mutation API corrupts tag identity because translations are presentation-only. |
| **Toast for every mutation** | Every React Query mutation needs `onSuccess`/`onError` with `useToast()`. Use `errorMessage(err)` for error bodies. Toast is the terminal status surface, so don't repeat the same completion counts inline unless they remain actionable. Multi-metric toast bodies should use line breaks for scanability. Add English i18n keys plus only the needed display locale keys. |
| **Web update restart modal** | After web update success, use `Modal` plus copyable command blocks for ordinary `aisets ui stop --port ...` → `aisets ui --port ... --clear-cache --no-open` restart guidance based on the current browser port. Auto-reload can pair new UI assets with an old backend process; devcontainer commands are not user-facing copy. |
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
