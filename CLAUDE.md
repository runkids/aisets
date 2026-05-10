# Aisets — Project Instructions

> Project-level context for Claude Code. Loaded automatically on every session in this repo.

---

## 1. What this project is

Aisets is a Go-backed local web tool for auditing image / asset hygiene in a codebase: scan, detect duplicates, find unused, optimize, lint. The UI is a Vite + React + TypeScript + Tailwind/CVA application under `ui/` consumed by the Go binary under `cmd/` + `internal/`.

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
- **i18n key hygiene:** Only add locale keys for namespaces that the UI actually reads, or for backend machine codes that can flow into that namespace. Remove unused translation keys instead of keeping speculative duplicates — stale keys hide missing-key regressions and create unnecessary translation maintenance.
- **i18n CJK punctuation:** zh-TW / zh-CN / ja / ko translations must not end with a period (句號 `。`). Use bare sentences without trailing punctuation. English locale keeps standard punctuation.
- **i18n all 5 locales:** Every new or modified i18n key must be added to ALL 5 locale files (en, zh-TW, zh-CN, ja, ko) in the same commit. Never translate only en + zh-TW and leave the others to fallback — missing keys in ja/ko/zh-CN are silent regressions that ship broken UI for those languages.
- **StatCard consistency:** Every `<StatCard>` must include an `icon` prop (Lucide, `size={14}`). Use semantic `tone` for actionable metrics (e.g. `tone={count > 0 ? "red" : "neutral"}`). Do not omit icons on some cards — all cards in a stats grid must look uniform.
- **Server-side filtering:** FilterRail filters (project, extension, custom) must be passed as query params to API hooks, triggering a server-side re-fetch. Never client-side filter loaded `items` arrays — with lazy loading, that only filters partial data and shows wrong counts.
- **Counts from API totals:** StatCards, Tabs, and FilterRail must use the first-page `total` and `facets` from the API response, not `items.length` or `groups.length` of accumulated loaded data. DuplicatesView uses group-count facets from `exactDuplicatesQuery`, not file-count facets from `duplicateItemsQuery`.
- **Virtual scrolling for large lists:** Any data view rendering 100+ items must use `@tanstack/react-virtual` (`useVirtualizer`). Use `measureElement` ref for auto-sizing — never set fixed `height` on virtual item wrappers (it clips content after images load). For section headers in virtual lists, render a sticky indicator in the toolbar instead of `position: sticky` on absolute-positioned items. When the virtual container is nested deep inside the scroll element (e.g. below StatCards + toolbar + panels), pass `scrollMargin` from `virtualContainerRef.offsetTop` and subtract it from each item's `translateY` — without this, rows appear at wrong positions. Use div + CSS grid instead of `<table>` for virtualized tabular data (`<tr>` cannot be `position: absolute`); add `role="table"`, `role="row"`, `role="columnheader"` for accessibility.
- **Lazy loading via sentinel:** Use `useInfiniteScrollSentinel` for scroll-triggered pagination. Never auto-paginate all pages on mount with `useEffect` loops.
- **Scroll containers and `ScrollToTop`:** Mark the element that **actually scrolls** (`scrollHeight > clientHeight`) with the `content-scroll` class. Views with nested scroll containers (e.g. BrowseList/BrowseGrid) need `content-scroll` on the inner scrolling element. `ScrollToTop` picks the `.content-scroll` with overflow. Early-return branches (loading, empty states) must NOT use the `content-scroll` class — `ScrollToTop` binds to the first `.content-scroll` it finds on mount and won't rebind when the main view replaces the early-return DOM.
- **Query key normalizers must include all filter params.** When adding a new filter param to a `CatalogXxxParams` type and passing it to a React Query hook, also add the field to the corresponding `normalizeCatalogXxxParams` function in `queries.ts`. The normalizer builds the query key — omitting a param means the cache key won't change when the filter changes, silently returning stale data.
- **Cross-filter facets:** FilterRail facets in views with server-side filtering must use cross-filter: project facets are computed with ext filter applied (but project filter cleared), and vice versa. This way selecting a project updates extension counts to reflect that project's scope. Backend facet functions accept both filter params and clear the "self" dimension. DuplicatesView uses `duplicateGroupFacets(scanID, projectName, ext)` with `dupFacetCounts` for this.
- **FilterRail on every data view:** Browse, Duplicates, Lint, History — all data-heavy pages must have a FilterRail sidebar with a Project section at minimum. Views with their own FilterRail render as `<> <Rail/> <div content-scroll/> </>` and must NOT be inside App.tsx's shared scroll div.
- **Lint project facets use `asset_snapshots.project_name`:** `lint_snapshots` has no `project_id`. Project facets JOIN `asset_snapshots` on `(scan_id, asset_id)` and GROUP BY `a.project_name`. Never JOIN the `projects` table directly from `lint_snapshots`.
- **Struct fields ≠ DB columns:** Adding fields to a Go struct does NOT persist them to SQLite. If the field isn't in a migration, the API returns zero values. For i18n, derive translation keys from existing DB fields (`ruleId`) on the frontend instead of adding new columns.
- **i18n for lint messages:** Use `t(\`lint.rule.${finding.ruleId}.message\`, { defaultValue: finding.message, ...extractedArgs })`. When messages contain dynamic values (KB, paths), extract them on the frontend via regex from the English fallback string. Never rely on unpersisted `args` fields.
- **No `overflow-hidden` on containers with sticky children:** `overflow: hidden/auto/scroll` creates a scroll container that breaks `position: sticky` for descendants. Use `overflow-clip` or remove overflow entirely when a child (e.g. `<thead>`) needs to stick relative to an outer scroll ancestor. The card wrapper pattern `rounded-g-md border ... bg-g-surface` works without overflow for border-radius clipping.
- **Callback ref for conditional-render DOM measurement:** When a component has early-return branches (loading/empty), `useEffect(fn, [])` runs once on first mount when the ref target may not exist yet. Use a `useCallback` ref instead — it fires every time the DOM node mounts/unmounts, correctly handling conditional render transitions. Pair with `ResizeObserver` for dynamic measurements like toolbar height for second-level sticky positioning.
- **i18n tab label length:** English labels in horizontal `<Tabs>` groups are often 2–3× wider than CJK equivalents ("Dimensions" vs "尺寸"). When multiple `<Tabs>` groups share one row, keep English labels to 3–6 characters (e.g. "Fmt", "Dims", "Crit", "Warn", "Suggest"). Always verify the English locale at 1440px after adding or renaming tabs — overflow that doesn't appear in zh-TW will break English.

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
- **Catalog batch vs detail parity for derived fields.** `catalog_batch.go` and `catalog_detail.go` both load `OptimizationSuggestion` rows from `optimization_snapshots`, but derived fields (e.g. `Operation` computed via `optimize.SuggestionOperation`) must be set in both code paths. If a field isn't a DB column but is computed after the query, grep for all call sites that build the same struct and ensure every path applies the same derivation — otherwise the list API returns the field but the detail API silently returns a zero value.
- **SQLite read/write connection separation.** `Store` has two DB pools: `db` (write, MaxOpenConns=1) and `rdb` (read, MaxOpenConns=4). All `Query`/`QueryRow` calls must use `s.rdb`; all `Exec`/`Begin` mutations must use `s.db`. Both pools must share the same DSN with identical `_pragma` parameters (busy_timeout, journal_mode) — otherwise one pool silently lacks retry or WAL behavior. WAL mode enables concurrent reads while a write TX is active — using the wrong pool re-introduces the single-connection bottleneck that blocks API reads during scans.
- **Batch long write transactions.** `RecordScan` splits inserts into batched TXs (~500 assets per batch) with a `status='recording'` → `'completed'` lifecycle. Never wrap thousands of inserts in a single TX — it holds the SQLite write lock for the entire duration, starving other write operations. On failure, `DELETE FROM scans WHERE id=?` cascades cleanup via FK constraints.
- **Go test paths must resolve macOS symlinks.** `t.TempDir()` returns `/var/folders/...` on macOS, but `canonicalProjectPath` resolves symlinks to `/private/var/folders/...`. Tests that use temp paths as project IDs or for path comparison must call `resolvedTempDir(t)` (which wraps `filepath.EvalSymlinks`) to match the stored canonical path. Otherwise tests pass on Linux but fail on macOS.

### 2.3 Rust / imgtools CLI
- **Rust imgtools changes require CLI integration tests.** Any behavior change under `tools/imgtools` must add or update deterministic Cargo tests that execute `aisets-imgtools` through the compiled binary. Cover successful JSON/file-output paths plus validation and error paths, because unit tests alone can miss Clap wiring, filesystem behavior, and serialization regressions.
- **Rust imgtools verification must stay in CI.** Keep `.github/workflows/test.yaml`'s `imgtools-test` job in sync with local verification: `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test --manifest-path tools/imgtools/Cargo.toml`, and a release build. Otherwise Rust CLI regressions can ship while Go and UI checks still pass.

---

## 3. Commit & verification

- Conventional Commits, English. Commit message answers *why*, not *what*.
- **Run all UI and CLI verification inside the devcontainer / Docker environment.** Do not run `go test`, `go vet`, `pnpm`, Vite, or CLI smoke checks on the host unless the user explicitly asks for a host-only check.
- If not already inside the devcontainer, enter it first with `make devc` (or `./scripts/devc.sh shell` when the container is already running). Use `/workspace` as the repo root inside the container.
- For UI review, first ask the user whether they are already inside the devcontainer. Once confirmed, run `ui` inside the devcontainer. The UI is served at `http://127.0.0.1:5174` and the API at `19520`.
- **Custom devcontainer ports must be checked for host Vite collisions.** When running with `PORT=N`, the UI port is `N - 19520 + 5174`; before trusting the browser, run `lsof -nP -iTCP:<ui-port> -sTCP:LISTEN` on the host and confirm the listener is Docker/OrbStack, not a host `node ... vite` process. A stale host Vite can serve old main-branch UI on the same port while the devcontainer API is correct, making feature work look missing.
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
- CLI / server changes must be smoke-tested inside the devcontainer with the project CLI or `go run ./cmd/aisets ...` command that matches the changed behavior.
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
