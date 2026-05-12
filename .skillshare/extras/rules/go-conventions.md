# Go — Conventions & Testing

## General

- Standard `gofmt`, `go vet`, table-driven tests. Project conventions follow `internal/` package layout.
- Keep Go files domain-sized and navigable. When a non-test file grows beyond ~400 lines, split it by cohesive responsibility before adding more behavior (for example: `projects.go`, `settings.go`, `scans.go`, `migrations.go`, `helpers.go`). Preserve package-level interfaces and avoid behavior changes during file-only splits.

## Testing

- **Backend logic requires test coverage.** Any behavior change under `cmd/` or `internal/` must include deterministic Go tests in the same commit. Cover the successful path plus validation, error mapping, persistence, filesystem-safety, and serialization branches touched by the change.
- New backend packages, exported functions, API handlers, scanner/lint rules, action flows, pre-check logic, optimization logic, config migrations, and cache/download behavior must not land with 0% direct coverage. If a branch cannot be exercised deterministically, document why in the PR/commit notes and cover the nearest pure helper instead.
- Backend bug fixes start with a regression test that fails before the fix. Prefer table-driven tests for rule engines and focused integration tests for HTTP/store/scanner flows.
- **Go test paths must resolve macOS symlinks.** `t.TempDir()` returns `/var/folders/...` on macOS, but `canonicalProjectPath` resolves symlinks to `/private/var/folders/...`. Tests that use temp paths as project IDs or for path comparison must call `resolvedTempDir(t)` (which wraps `filepath.EvalSymlinks`) to match the stored canonical path. Otherwise tests pass on Linux but fail on macOS.

## Domain Knowledge

- `internal/scanner` and `internal/lint` are the two main domain packages — read them before changing scan or lint output shape, since UI consumes their JSON.
- **Struct fields ≠ DB columns:** Adding fields to a Go struct does NOT persist them to SQLite. If the field isn't in a migration, the API returns zero values. For i18n, derive translation keys from existing DB fields (`ruleId`) on the frontend instead of adding new columns.
- **API-only derived fields via `FinalizeResult`.** When the frontend needs a field that can be computed from existing DB data (e.g. splitting `engineVersion` into `providerName` + `modelName`), add the field to the Go result struct and derive it in the existing `FinalizeResult`-style function — not as a new DB column. This avoids migrations, keeps the DB schema lean, and ensures every code path (fresh processing, cached DB reads) populates the field. The inverse of "Struct fields ≠ DB columns": sometimes you *want* a field that exists only in the JSON response.
- **Catalog batch vs detail parity for derived fields.** `catalog_batch.go` and `catalog_detail.go` both load `OptimizationSuggestion` rows from `optimization_snapshots`, but derived fields (e.g. `Operation` computed via `optimize.SuggestionOperation`) must be set in both code paths. If a field isn't a DB column but is computed after the query, grep for all call sites that build the same struct and ensure every path applies the same derivation — otherwise the list API returns the field but the detail API silently returns a zero value.
