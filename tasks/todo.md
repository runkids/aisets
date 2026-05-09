# Aisets — Task List

## Phase 1: Backend (Go)

- [x] **T1** Lint engine — 7 rules + tests + scanner 整合
- [ ] **T2** Pre-Check upload API — `POST /api/pre-check`, multipart, verdict logic
- [ ] **T3** Optimization estimate + script — `POST /api/actions/optimization/estimate` + `generate-script`

## Phase 2: Frontend Foundation

- [x] **T4** FilterRail — component 建好（待接入 App.tsx browse view）
- [x] **T5** BrowseGrid + BrowseToolbar — virtualized grid + toolbar 建好（待接入）
- [x] **T6** AssetDrawer — detail panel, metadata, refs, actions
- [x] **T7** CommandPalette — ⌘P fuzzy search, keyboard nav, per-mode icons

## Phase 3: Feature Views

- [x] **T8** DuplicatesView — exact/similar tabs, per-group merge, sort
- [x] **T9** UnusedView — bulk select, copy paths/rm
- [x] **T10** OptimizeView — sticky filter bar, category chips, opt-row layout
- [x] **T11** LintView — findings table, severity filter, click-to-asset
- [ ] **T12** Pre-Check View — drop zone, upload, per-file verdict cards

## Phase 4: Polish

- [ ] **T13** Enhanced Dashboard — KPI cards 改設計完成，缺 charts + quick-jump
- [ ] **T14** Toast + scroll-to-top + keyboard shortcuts
- [ ] **T15** i18n — add keys for all new views (zh-TW, en, ja, ko, zh-CN)

## Design System

- [x] Tokens 重寫（暖色系 + accent red）
- [x] Layout 重寫（shell, sidebar, topbar frosted, content/page）
- [x] Components 重寫（btn, chip, card, seg-toggle, drawer, modal, notice, run-panel, opt-row, dgroup, bulkbar, dropzone）
- [x] DESIGN.md 完整設計規範
- [x] 所有 component class names 對齊新設計
- [x] Backdrop blur (drawer + modal + cmdk)
- [x] Search bar in topbar (⌘P trigger)

## Wiring（接線）

- [ ] Browse view 接入 FilterRail + BrowseGrid + BrowseToolbar（取代 AssetList）
- [ ] Browse view 加 grid size / bg mode / status filter 控制
- [ ] Browse view 加虛擬化滾動
- [ ] 各 view 加虛擬化滾動（OptimizeView, UnusedView, LintView）
- [ ] AssetDrawer 接入各 view（browse click → open drawer）
