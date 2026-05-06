# Asset Studio — Project Instructions

> Project-level context for Claude Code. Loaded automatically on every session in this repo.

---

## 1. What this project is

Asset Studio is a Go-backed local web tool for auditing image / asset hygiene in a codebase: scan, detect duplicates, find unused, optimize, lint. The UI is a Vite + React + TypeScript + SCSS application under `ui/` consumed by the Go binary under `cmd/` + `internal/`.

| Layer | Tech | Path |
|-------|------|------|
| CLI / server | Go | `cmd/`, `internal/` |
| Web UI | React + TypeScript + SCSS | `ui/src/` |
| Design tokens & component styles | SCSS partials | `ui/src/styles/_tokens.scss`, `_layout.scss`, `_components.scss`, `_patterns.scss` |
| Single source of truth for UI/UX | **Markdown spec** | `DESIGN.md` |

---

## 2. UI/UX contract — non-negotiable

> **For ANY change that affects how a feature LOOKS, FEELS, MOVES, or is INTERACTED WITH, you MUST follow this loop:**

### 2.1 Before touching UI code

1. **Read `DESIGN.md` in full** — even if you've read it earlier in the session. The file is the canonical design system; assumptions from training data or previous projects do not apply here.
2. **Resolve the task to existing tokens / components.** If a token (color, spacing, radius, shadow, animation, type role) already exists for what you need, **use it**. Do not introduce a new one.
3. **Identify the affected sections** of `DESIGN.md` (e.g. §6.1 Buttons, §7.4 Optimize, §11 Accessibility) and re-read them.

### 2.2 While implementing

4. **All visual values must come from `_tokens.scss` CSS custom properties** (`--g-canvas`, `--g-surface`, `--g-ink`, `--g-accent`, `--g-r-md`, `--g-shadow-*`, etc.). No raw hex, no arbitrary px radii, no ad-hoc shadow strings.
5. **Class names from the existing inventory are preserved.** Restyle in place; do not rename `.acard`, `.opt-row`, `.dgroup`, `.bulkbar`, etc. New components must use names that match the file they live in and follow the existing kebab-case convention.
6. **Single primary CTA per screen.** Only one element gets the Neon Lime (`--g-accent`) filled background per visible page. Audit before committing.
7. **Color is never alone.** Status / severity / success / error must always combine color with icon + text + position.
8. **Pre-delivery checklist** in `DESIGN.md §15` — run through every box before reporting the task as done.

### 2.3 After implementing — **MANDATORY**

9. **Update `DESIGN.md`** to reflect what changed. This applies to:
   - Any new token, color, radius, shadow, easing, or animation.
   - Any new component, variant, or state.
   - Any change to a component's style, behavior, or markup contract.
   - Any new view pattern, sticky element, or z-index assignment.
   - Any breakpoint or responsive change.
   - Any accessibility-relevant change (focus, contrast, hit area, keyboard, reduced motion).
10. The update goes in the **same commit** as the code change. A UI commit without a `DESIGN.md` diff is incomplete unless the change literally introduced zero design-surface delta (rare — usually means renaming an internal helper).
11. **Token migrations:** when an old token's meaning changes (see `DESIGN.md §14`), update `_tokens.scss` AND `DESIGN.md §2` together; never one without the other.

### 2.4 What counts as "UI/UX work"

Triggers the contract:
- Editing any file under `ui/src/`
- Editing any `*.scss` partial
- Adding / removing a component, view, route, or visual element
- Changing copy that lives in the UI (button labels, empty states, tooltips, error text)
- Changing icons, illustrations, or imagery
- Changing keyboard shortcuts, ARIA labels, focus order
- Changing animations, transitions, durations, or easing
- Adjusting any layout (grid, flex, sticky position, z-index)

Does **not** trigger:
- Pure Go / backend / scanner / lint engine changes that have no UI surface
- Build / CI / dependency updates with no visual diff
- Documentation in `docs/` unrelated to UI

---

## 3. Stack-specific notes

### 3.1 SCSS / styling
- All tokens live in `ui/src/styles/_tokens.scss` under `:root` (light parity) and `[data-theme='dark']` (canonical).
- Layout primitives in `_layout.scss`. Components in `_components.scss`. View-specific patterns in `_patterns.scss`.
- Tailwind is **not** used for components (only `tailwind.css` placeholder). Author components in SCSS using tokens.
- No `!important`. No inline styles for visual properties (only for dynamic computed values like translateX offsets).

### 3.2 React / TypeScript
- Functional components, hooks, no class components.
- Class names follow kebab-case matching SCSS partials.
- Icons from Lucide React only — never emoji as structural icons.
- Every `<button>` without visible text needs `aria-label`.
- Every overlay needs ESC dismissal + focus trap + focus restoration.

### 3.3 Go
- Standard `gofmt`, `go vet`, table-driven tests. Project conventions follow `internal/` package layout.
- **Backend logic requires test coverage.** Any behavior change under `cmd/` or `internal/` must include deterministic Go tests in the same commit. Cover the successful path plus validation, error mapping, persistence, filesystem-safety, and serialization branches touched by the change.
- New backend packages, exported functions, API handlers, scanner/lint rules, action flows, pre-check logic, optimization logic, config migrations, and cache/download behavior must not land with 0% direct coverage. If a branch cannot be exercised deterministically, document why in the PR/commit notes and cover the nearest pure helper instead.
- Backend bug fixes start with a regression test that fails before the fix. Prefer table-driven tests for rule engines and focused integration tests for HTTP/store/scanner flows.
- `internal/scanner` and `internal/lint` are the two main domain packages — read them before changing scan or lint output shape, since UI consumes their JSON.

---

## 4. Commit & verification

- Conventional Commits, English. Commit message answers *why*, not *what*.
- A UI commit must:
  - Touch the relevant SCSS / TSX
  - Touch `DESIGN.md` if any design-surface delta exists
  - Pass `go test ./...` and `go vet ./...` (UI changes can break Go-side embed tests)
  - Render correctly at 1440 / 1024 / 768 / 375 widths in dark mode (canonical)
- A backend logic commit must:
  - Add or update Go tests for every changed behavior under `cmd/` or `internal/`
  - Pass `go test ./...`, `go vet ./...`, and `mkdir -p tmp && go test ./... -coverprofile=tmp/backend-coverage.out`
  - Inspect `go tool cover -func=tmp/backend-coverage.out` for newly added or modified backend functions and avoid untested logic regressions
- CI must mirror local verification via `.github/workflows/test.yaml`. The release workflow must depend on that reusable test workflow before publishing artifacts.
- Use pnpm for JavaScript tooling. Root `package.json` and `pnpm-lock.yaml` are intentional repo-level dev tooling for Husky + lint-staged; app/runtime UI dependencies stay under `ui/`.
- Never `--no-verify`.

---

## 5. Anti-patterns to avoid

- Inventing a new accent color or "decorative" tone.
- Hardcoding a hex anywhere in TSX or SCSS.
- Changing radius or shadow values inline instead of using tokens.
- Adding diffuse soft drop shadows (`0 24px 48px ...`) outside `--g-shadow-pop` (overlays only).
- Mixing icon styles (e.g. Lucide outline + filled emoji) within the same screen.
- Changing a component's visual contract without updating `DESIGN.md`.
- "While I'm here" cleanup of unrelated UI — keep the diff scoped.

---

## 6. Quick links

- Design system spec: [`DESIGN.md`](./DESIGN.md)
- Tokens: [`ui/src/styles/_tokens.scss`](./ui/src/styles/_tokens.scss)
- Components: [`ui/src/styles/_components.scss`](./ui/src/styles/_components.scss)
- Layout: [`ui/src/styles/_layout.scss`](./ui/src/styles/_layout.scss)
- Patterns: [`ui/src/styles/_patterns.scss`](./ui/src/styles/_patterns.scss)
- Pre-delivery checklist: [`DESIGN.md §15`](./DESIGN.md#15-pre-delivery-checklist-ui-changes)

---

## 7. TL;DR for new sessions

1. UI work? → Read `DESIGN.md` first.
2. Use tokens, not raw values.
3. One Neon Lime CTA per screen.
4. Update `DESIGN.md` in the same commit.
5. Run the §15 checklist before saying "done".
