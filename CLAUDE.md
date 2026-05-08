# Asset Studio — Project Instructions

> Project-level context for Claude Code. Loaded automatically on every session in this repo.

---

## 1. What this project is

Asset Studio is a Go-backed local web tool for auditing image / asset hygiene in a codebase: scan, detect duplicates, find unused, optimize, lint. The UI is a Vite + React + TypeScript + Tailwind/CVA application under `ui/` consumed by the Go binary under `cmd/` + `internal/`.

| Layer | Tech | Path |
|-------|------|------|
| CLI / server | Go | `cmd/`, `internal/` |
| Web UI | React + TypeScript + Tailwind + CVA | `ui/src/` |
| Styling | CSS custom properties + Tailwind `@theme` + CVA | `ui/src/styles/`, `ui/src/components/ui/` |

---

## 2. Stack-specific notes

### 2.1 React / TypeScript
- Functional components, hooks, no class components.
- Icons from Lucide React only — never emoji as structural icons.
- Every `<button>` without visible text needs `aria-label`.
- Every overlay needs ESC dismissal + focus trap + focus restoration.
- **i18n code-first:** Backend API must return machine-readable codes (`reasonCode`, `code`, `suggestionCode`), not hardcoded human-readable strings. Frontend translates codes via `t(\`namespace.${code}\`, { defaultValue: fallbackString })`. Never display raw backend English strings to the user.
- **StatCard consistency:** Every `<StatCard>` must include an `icon` prop (Lucide, `size={14}`). Use semantic `tone` for actionable metrics (e.g. `tone={count > 0 ? "red" : "neutral"}`). Do not omit icons on some cards — all cards in a stats grid must look uniform.
- **Server-side filtering:** FilterRail filters (project, extension, custom) must be passed as query params to API hooks, triggering a server-side re-fetch. Never client-side filter loaded `items` arrays — with lazy loading, that only filters partial data and shows wrong counts.
- **Counts from API totals:** StatCards, Tabs, and FilterRail must use the first-page `total` and `facets` from the API response, not `items.length` or `groups.length` of accumulated loaded data. DuplicatesView uses group-count facets from `exactDuplicatesQuery`, not file-count facets from `duplicateItemsQuery`.
- **Virtual scrolling for large lists:** Any data view rendering 100+ items must use `@tanstack/react-virtual` (`useVirtualizer`). Use `measureElement` ref for auto-sizing — never set fixed `height` on virtual item wrappers (it clips content after images load). For section headers in virtual lists, render a sticky indicator in the toolbar instead of `position: sticky` on absolute-positioned items.
- **Lazy loading via sentinel:** Use `useInfiniteScrollSentinel` for scroll-triggered pagination. Never auto-paginate all pages on mount with `useEffect` loops.
- **Scroll containers and `ScrollToTop`:** Mark the element that **actually scrolls** (`scrollHeight > clientHeight`) with the `content-scroll` class. Views with nested scroll containers (e.g. BrowseList/BrowseGrid) need `content-scroll` on the inner scrolling element. `ScrollToTop` picks the `.content-scroll` with overflow.

### 2.2 Go
- Standard `gofmt`, `go vet`, table-driven tests. Project conventions follow `internal/` package layout.
- Keep Go files domain-sized and navigable. When a non-test file grows beyond ~400 lines, split it by cohesive responsibility before adding more behavior (for example: `projects.go`, `settings.go`, `scans.go`, `migrations.go`, `helpers.go`). Preserve package-level interfaces and avoid behavior changes during file-only splits.
- **Backend logic requires test coverage.** Any behavior change under `cmd/` or `internal/` must include deterministic Go tests in the same commit. Cover the successful path plus validation, error mapping, persistence, filesystem-safety, and serialization branches touched by the change.
- New backend packages, exported functions, API handlers, scanner/lint rules, action flows, pre-check logic, optimization logic, config migrations, and cache/download behavior must not land with 0% direct coverage. If a branch cannot be exercised deterministically, document why in the PR/commit notes and cover the nearest pure helper instead.
- Backend bug fixes start with a regression test that fails before the fix. Prefer table-driven tests for rule engines and focused integration tests for HTTP/store/scanner flows.
- `internal/scanner` and `internal/lint` are the two main domain packages — read them before changing scan or lint output shape, since UI consumes their JSON.
- **Project scan intent is authoritative.** Each project has a `scanIntent` (`code`, `assetPack`, `library`, `mixed`) that controls how references, unused files, and reference-lint are interpreted. Do not infer deletion safety from `usedBy.length === 0` or `references.length === 0`.
- For catalog items, use backend policy fields: `usageClassification`, `deleteUnusedAllowed`, and `lintApplicability`. UI filters, badges, drawers, actions, and custom filters must consume these fields instead of recomputing safe-unused state.
- `unusedFiles` means safe delete-unused candidates only. Advisory or not-applicable counts belong in `possiblyUnusedFiles` and `usageNotApplicableFiles`. Asset packs skip reference-dependent analysis; library, mixed, and partial-coverage code projects can show "possibly unused" but must not enable delete-unused.
- When project `scanIntent` changes, treat reference-dependent catalog state as stale and require a rescan before enabling unused/delete-unused behavior. Persist and compare scan-time intent where scan history or diff logic depends on unused transitions.

---

## 3. Commit & verification

- Conventional Commits, English. Commit message answers *why*, not *what*.
- **Run all UI and CLI verification inside the devcontainer / Docker environment.** Do not run `go test`, `go vet`, `pnpm`, Vite, or CLI smoke checks on the host unless the user explicitly asks for a host-only check.
- If not already inside the devcontainer, enter it first with `make devc` (or `./scripts/devc.sh shell` when the container is already running). Use `/workspace` as the repo root inside the container.
- For UI review, first ask the user whether they are already inside the devcontainer. Once confirmed, run `ui` inside the devcontainer. The UI is served at `http://127.0.0.1:5174` and the API at `19520`.
- A UI commit must:
  - Touch the relevant TSX / SCSS tokens
  - Touch `DESIGN.md` if any design-surface delta exists
  - Inside the devcontainer, pass `go test ./...` and `go vet ./...` (UI changes can break Go-side embed tests)
  - Inside the devcontainer, pass the relevant UI checks such as `pnpm --dir ui lint`, `pnpm --dir ui test`, and/or `pnpm --dir ui build`
  - Render correctly at 1440 / 1024 / 768 / 375 widths in dark mode (canonical) via `http://127.0.0.1:5174`
- A backend logic commit must:
  - Add or update Go tests for every changed behavior under `cmd/` or `internal/`
  - Inside the devcontainer, pass `go test ./...`, `go vet ./...`, and `mkdir -p tmp && go test ./... -coverprofile=tmp/backend-coverage.out`
  - Inspect `go tool cover -func=tmp/backend-coverage.out` for newly added or modified backend functions and avoid untested logic regressions
- CLI / server changes must be smoke-tested inside the devcontainer with the project CLI or `go run ./cmd/asset-studio ...` command that matches the changed behavior.
- CI must mirror local verification via `.github/workflows/test.yaml`. The release workflow must depend on that reusable test workflow before publishing artifacts.
- Use pnpm for JavaScript tooling inside the devcontainer. Root `package.json` and `pnpm-lock.yaml` are intentional repo-level dev tooling for Husky + lint-staged; app/runtime UI dependencies stay under `ui/`.
- Never `--no-verify`.

---

## 4. Quick links

| Resource | Path |
|----------|------|
| Design system spec | `DESIGN.md` |
| **UI rules (auto-loaded skill)** | `.claude/skills/design-system.md` |
| Go domain packages | `internal/scanner`, `internal/lint` |
