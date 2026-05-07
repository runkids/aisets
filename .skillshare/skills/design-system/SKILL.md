---
name: design-system
description: >
  Asset Studio UI design system — token usage, CVA component patterns, Tailwind co-location rules,
  and pre-delivery checklist. Use this skill whenever editing ANY file under ui/src/, including .tsx,
  .ts, and style files. Also use when creating new UI components, modifying existing ones, changing
  colors/spacing/typography, adding animations, or touching anything visual. Even simple one-line
  UI tweaks should consult this skill — the token and cascade rules catch subtle bugs.
globs:
  - "ui/src/**/*.tsx"
  - "ui/src/**/*.ts"
  - "ui/src/styles/**"
---

# Asset Studio Design System

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

## 3. Design principles

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
| **No left-edge accent bars** | Never add vertical colored bars/stripes on container edges. Use tinted bg + border + icon for tone. |

---

## 4. Pre-delivery checklist

Run through before reporting any UI task as done:

- [ ] All visual values from `--g-*` tokens — no raw hex, no arbitrary px for radius/shadow
- [ ] New component uses CVA with exported `*Variants` function
- [ ] Only one `--g-cta` filled button per visible screen
- [ ] Status/severity combines color + icon + text
- [ ] `aria-label` on every icon-only button
- [ ] Overlays: ESC dismiss + focus trap (Radix Dialog/AlertDialog handles this)
- [ ] Verified in dark mode (canonical theme)
- [ ] Responsive check: 1440 / 1024 / 768 / 375
- [ ] `DESIGN.md` updated if you added a new token, component, or variant

---

## 5. Reference

For full token tables (all colors, spacing, radius, shadow values), type scale, surface
hierarchy, component specs, accessibility rules, and view-by-view patterns:

→ Read `DESIGN.md` (the comprehensive spec). This skill covers the rules you need for every
edit; DESIGN.md has the detailed reference data you need when designing something new.
