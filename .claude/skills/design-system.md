---
name: design-system
description: Design system rules for Asset Studio UI. Auto-triggers when editing files under ui/src/ — enforces token usage, CVA patterns, component inventory, and pre-delivery checklist.
globs:
  - "ui/src/**/*.tsx"
  - "ui/src/**/*.ts"
  - "ui/src/styles/**"
---

# Asset Studio Design System

Applies to ALL edits under `ui/src/`. Read this before writing any UI code.

## Architecture

```
_tokens.scss     → CSS custom properties (--g-*), light + dark
tailwind.css     → @theme mapping (bg-g-surface, text-g-ink, etc.)
_patterns.scss   → @keyframes, .sr-only, .bg-checker
ui/components/ui → CVA primitives (Button, Badge, Modal, Select, etc.)
ui/components/   → Page components (Tailwind co-located in JSX)
```

No component styles in external SCSS. Everything co-located in `.tsx`.

## Token Rules

- **All visual values → `--g-*` tokens** via Tailwind aliases. No raw hex, no arbitrary px radii, no ad-hoc shadows.
- Token source of truth: `ui/src/styles/_tokens.scss`
- Tailwind mapping: `ui/src/styles/tailwind.css` `@theme` block
- Full token reference: `DESIGN.md §2`

## Component Pattern (CVA)

Every UI primitive uses this pattern:

```tsx
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const componentVariants = cva("base-classes", {
  variants: { variant: { ... }, size: { ... } },
  defaultVariants: { variant: "primary", size: "md" },
});

type Props = React.HTMLAttributes<HTMLElement> & VariantProps<typeof componentVariants>;

function Component({ variant, size, className, ...props }: Props) {
  return <div className={cn(componentVariants({ variant, size }), className)} {...props} />;
}

export { Component, componentVariants };
```

**Anti-patterns:**
- `Record<Variant, string>` maps → use CVA
- Manual className concatenation → use `cn()`
- `@apply` in CSS → use utility classes in JSX
- `w-80` with CVA `w-full` → use `w-[320px]` (twMerge + TW4 conflict)

## UI Primitive Inventory

Before creating a new component, check if one exists:

| Component | Variants | File |
|-----------|----------|------|
| Button | primary/secondary/ghost/danger × sm/md/lg | Button.tsx |
| IconButton | sm/md/lg + active | Button.tsx |
| Badge | 11 tones | Badge.tsx |
| Card | default/elevated/nested × padding | Card.tsx |
| StatCard | 6 tones | StatCard.tsx |
| TextInput | default/outline/subtle/search × sm/md | TextInput.tsx |
| TextInputButton | same variants as TextInput | TextInput.tsx |
| Select | sm/md (Radix) | Select.tsx |
| Tabs | segment/pills × sm/md (Radix) | Tabs.tsx |
| Modal | sm/md/lg (Radix Dialog) | Modal.tsx |
| ConfirmDialog | default/danger (Radix AlertDialog) | ConfirmDialog.tsx |
| PromptDialog | (Radix Dialog) | PromptDialog.tsx |
| Tooltip | top/bottom/left/right (Radix) | Tooltip.tsx |
| DropdownMenu | align left/right (Radix) | DropdownMenu.tsx |
| SegmentedControl | icon/text/fixed/status | SegmentedControl.tsx |
| Notice | info/success/warning/danger | Notice.tsx |
| Toast | wraps Notice | Toast.tsx |
| EmptyState | sm/md/lg × center/left × neutral/info/warning | EmptyState.tsx |
| IconWell | sm/md/lg × 7 tones | IconWell.tsx |
| AssetThumbnail | sm/md/lg/fill × surface/checker/light/dark | AssetThumbnail.tsx |
| StackedBar | segments with tone | StackedBar.tsx |
| ImagePreview | hover preview | ImagePreview.tsx |

## Design Principles (Quick)

1. **Single CTA per screen** — only one `--g-cta` filled button visible
2. **Color never alone** — status always pairs color + icon + text
3. **Compact, not cramped** — 4px base, 8px gap, 12px card padding
4. **6px default radius** — `--g-r-md` for most controls
5. **Tooltips on icon-only buttons** — Radix Tooltip, never native `title`
6. **Icons from Lucide only** — no emoji as structural icons

## Cascade Warning

SCSS in `_tokens.scss` / `_patterns.scss` is NOT in `@layer` — it has HIGHER priority than Tailwind utilities. If you need to override a token-level style, use inline `style` or Tailwind `!important` (rare).

## Pre-Delivery Checklist

Before reporting UI work as done:

- [ ] All values from `--g-*` tokens (no raw hex/px)
- [ ] New component uses CVA with exported `*Variants`
- [ ] Single primary CTA per visible screen
- [ ] Color + icon + text for status/severity
- [ ] `aria-label` on icon-only buttons
- [ ] Overlays: ESC dismiss + focus trap (Radix handles this)
- [ ] Dark mode verified (canonical theme)
- [ ] Responsive: 1440 / 1024 / 768 / 375
- [ ] `DESIGN.md` updated if new token/component/variant added
