# Asset Studio — Feature Port Plan

Port design from internal `asset-duplicate-check` to public `asset-studio`.
Excludes company-specific logic (owner/theme facets, @gorilla aliases, shared-assets priority, Docker compose, batch auto-execute).

## Architecture Decisions

1. **Optimization**: recommendations + script generation only. No auto-execute (too risky for public users).
2. **Merge duplicates**: keep existing preview/apply pattern. No batch streaming auto-merge.
3. **Lint**: 7 universal rules only. No `duplicate-import` (requires monorepo context).
4. **Facets**: `project` + `extension` + status filters. No `owner`/`theme`.
5. **Pre-Check**: multipart upload (not base64). 10 files max, 20MB each.
6. **Image conversion for estimates**: pure Go (minify/svg for SVG, goimagehash for sizing analysis). Script output targets `sharp` CLI commands user runs manually.
7. **Charts**: manual SVG to keep bundle small.

---

## Dependency Graph

```
Phase 1: Backend (Go)
  ├─ T1: Lint engine
  ├─ T2: Pre-Check upload API
  └─ T3: Optimization estimate + script generation API

Phase 2: Frontend Foundation
  ├─ T4: FilterRail (project + ext + status)
  ├─ T5: BrowseGrid/BrowseList + virtualization
  ├─ T6: AssetDrawer (detail panel)
  └─ T7: CommandPalette (Cmd+K)

Phase 3: Feature Views
  ├─ T8: DuplicatesView (exact + similar, per-group merge)
  ├─ T9: UnusedView (bulk select, copy paths/rm)
  ├─ T10: OptimizeView (estimates, script gen)
  ├─ T11: LintView (findings table)
  └─ T12: Pre-Check View (drop zone + results)

Phase 4: Polish
  ├─ T13: Enhanced Dashboard (stat cards, charts, quick-jump)
  ├─ T14: Toast + scroll-to-top + keyboard shortcuts
  └─ T15: i18n for all new views (zh-TW, en, ja, ko, zh-CN)
```

---

## Phase 1: Backend

### T1 — Lint Engine

**Scope**: new `internal/lint/` package

**Work**:
- Port 7 rules to Go: missing-lazy-loading, missing-dimensions, large-inline-import, no-responsive-image, svg-as-img, img-as-background, bg-content-image
- Each rule receives: file content (the line), reference kind, asset bytes, asset ext
- Integrate into scanner: after references are built, run lint on each reference
- Add `LintFindings []LintFinding` to `Catalog` type
- Expose in `GET /api/catalog` response

**Types**:
```go
type LintFinding struct {
    RuleID     string `json:"ruleId"`
    Severity   string `json:"severity"` // critical, warning, info
    File       string `json:"file"`
    Line       int    `json:"line"`
    Snippet    string `json:"snippet"`
    Message    string `json:"message"`
    Suggestion string `json:"suggestion"`
    AssetID    string `json:"assetId,omitempty"`
}
```

**Acceptance**: `go test ./internal/lint/...` — 7 rules with positive/negative cases

---

### T2 — Pre-Check Upload API

**Scope**: new `internal/precheck/` + endpoint `POST /api/pre-check`

**Work**:
- Accept multipart form (field: `files`)
- Per file: read bytes → blake3 hash + dHash
- Find exact matches (same hash in catalog)
- Find near matches (hamming distance ≤ 10)
- Check naming: kebab-case, no Chinese chars, ≤60 chars, supported ext
- Compute size context: compare width to P95 of catalog
- Generate optimization recommendations (reuse `imageproc.Recommendations()`)
- Return verdict: fail (exact match or unsupported ext), warning (near/naming/size), pass

**Response shape**:
```json
{
  "results": [{
    "fileName": "icon.png",
    "verdict": "warning",
    "contentHash": "abc...",
    "exactMatches": [],
    "nearMatches": [{"assetId": "...", "distance": 3, "score": 0.95}],
    "namingIssues": [{"type": "non-kebab", "message": "..."}],
    "sizeContext": {"p95Width": 800, "isOversized": false},
    "optimizationRecommendations": [...],
    "suggestedFileName": "my_icon.png"
  }]
}
```

**Acceptance**: curl multipart upload returns correct verdict for duplicate/new/badly-named files

---

### T3 — Optimization Estimate + Script Generation

**Scope**: new `internal/optimizer/` + endpoints

**Work**:
- `POST /api/actions/optimization/estimate` — accepts `{ids: string[]}`, returns estimated savings per asset
- Estimate logic (pure analysis, no file writes):
  - SVG: run minify in-memory, compare sizes
  - PNG opaque: estimate AVIF size (~40% of original)
  - PNG alpha: estimate WebP size (~60% of original)
  - GIF: estimate WebP size (~50% of original)
  - JPEG >200KB: estimate AVIF size (~35% of original)
  - Oversized (>1600px && >250KB): estimate resized size
- `POST /api/actions/optimization/generate-script` — accepts `{ids: string[]}`, returns shell script string
- Script uses `sharp` CLI or `cwebp`/`avifenc` commands

**Acceptance**: estimate returns plausible savings; script is valid bash

---

## Phase 2: Frontend Foundation

### T4 — FilterRail

**Scope**: `ui/src/components/FilterRail.tsx`

**Work**:
- Collapsible left panel inside content area
- Sections: Project (multi-select), Extension (multi-select)
- Each option shows count badge
- "Clear all" button
- Filters stored in URL search params
- Visible on browse/duplicates/unused/optimize modes

**Acceptance**: selecting filters narrows the asset list; counts update reactively

---

### T5 — BrowseGrid + BrowseList

**Scope**: replace current `AssetList.tsx`

**Work**:
- Add `@tanstack/react-virtual` dependency
- Grid view: cards with thumbnail, filename, size badge, status indicators
- List view: compact rows (small thumbnail, name, ext, size, status)
- View toggle in toolbar (grid/list)
- Grid size toggle (S/M/L)
- Background mode toggle (checker/light/dark)
- In-page search (filename filter)
- Status filter tabs: all / unused / duplicate / optimizable / referenced

**Acceptance**: 3000+ items render at 60fps; view/size/bg toggles work

---

### T6 — AssetDrawer

**Scope**: `ui/src/components/AssetDrawer.tsx`

**Work**:
- Right-side slide panel triggered by selecting any asset
- Sections: preview, metadata table, references list, duplicates, similar, optimization recs
- Actions: copy path, rename (existing flow), delete (existing flow)
- Close via X / Esc / click outside
- URL sync: `?asset=ID`

**Acceptance**: click card → drawer slides in; deep-link works on page load

---

### T7 — CommandPalette

**Scope**: `ui/src/components/CommandPalette.tsx`

**Work**:
- Overlay triggered by Cmd+K / Ctrl+K
- Fuzzy search across asset filenames + modes
- Keyboard nav: ↑↓ Enter Esc
- Recent items in localStorage

**Acceptance**: Cmd+K opens; typing filters; Enter on asset opens browse+drawer

---

## Phase 3: Feature Views

### T8 — DuplicatesView

**Work**:
- Two tabs: "Exact" (same hash) / "Similar" (perceptual)
- Exact: group cards with preferred highlighted, merge button per group
- Similar: side-by-side with distance badge
- Sort: member count / total size / savings
- Per-group merge → existing preview/apply
- Integrates with FilterRail

**Acceptance**: groups display; merge works; similar tab shows near-dupes

---

### T9 — UnusedView

**Work**:
- Checkbox per item + select-all
- Toolbar: count + bytes, "Copy paths", "Copy git rm", "Delete selected"
- Delete → batch preview modal → apply
- Sortable columns

**Acceptance**: select → copy gives correct commands; delete works via preview

---

### T10 — OptimizeView

**Work**:
- Table: path, current size, estimated size, savings %, format, severity
- Checkbox + select-all
- "Estimate selected" → calls estimate API
- "Generate script" → copies shell script to clipboard
- Severity filter chips

**Acceptance**: estimates populate; script copies; severity filters work

---

### T11 — LintView

**Work**:
- Table: severity, rule, file:line, message
- Expandable suggestion row
- Click → opens asset drawer
- Severity filter + search
- Summary bar

**Acceptance**: findings from catalog render; click navigates

---

### T12 — Pre-Check View

**Work**:
- Drop zone (drag & drop + click)
- Calls `POST /api/pre-check` multipart
- Per-file result card: verdict, matches, naming, size, recommendations, suggested name
- "Clear all" reset

**Acceptance**: drop duplicate → fail; drop new → pass; bad name → warning

---

## Phase 4: Polish

### T13 — Enhanced Dashboard

- Stat cards with quick-jump
- Extension distribution bar chart (SVG)
- Project distribution bar chart (SVG)
- Last scan time + refresh

### T14 — Toast + Scroll-to-top + Shortcuts

- Toast auto-dismiss 2s
- Scroll-to-top FAB after 400px
- Cmd+K / Esc shortcuts

### T15 — i18n

- Add keys to zh-TW, en, ja, ko, zh-CN for all new views

---

## Checkpoints

| After | Gate |
|-------|------|
| Phase 1 | `go test ./...` passes; new endpoints return correct JSON |
| Phase 2 | `pnpm build` passes; components work with live data |
| Phase 3 | All modes functional end-to-end |
| Phase 4 | Feature parity confirmed; i18n complete |

## Recommended Execution Order

1. T1 + T4 parallel (lint engine + filter rail — independent)
2. T5 (BrowseGrid — foundation for all views)
3. T6 (AssetDrawer — used by every view)
4. T7 (CommandPalette)
5. T8–T12 parallelizable (each view is independent)
6. T2, T3 before T10/T12 need them
7. T13–T15 last
