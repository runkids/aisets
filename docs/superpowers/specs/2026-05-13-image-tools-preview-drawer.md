# Image Tools Preview Drawer — Before/After, Format Compare, Metadata Strip

**Date:** 2026-05-13
**Status:** Approved
**Goal:** Add a preview Drawer to Image Tools that provides before/after comparison, multi-format comparison grid, and EXIF metadata viewing/stripping.

---

## 1. Trigger

Click any queue item in the right column -> Drawer slides in from right.

- **Project assets:** Full drawer (Before/After + Format Compare + Metadata)
- **Uploaded files:** Drawer shows original preview + file info only (no server-side conversion previews — uploads lack asset IDs)

## 2. Drawer Layout

Three sections stacked vertically inside a full-height Drawer:

### 2.1 Header

- Filename (mono, truncated)
- Format badge + file size + dimensions (e.g. `PNG · 2.1 MB · 3840x2560`)
- Close button (X)

### 2.2 Before/After Slider (project assets only)

- Full-width image area showing original vs compressed overlay
- Draggable vertical divider splits the view: left = original, right = compressed
- Implementation: two `<img>` stacked, the compressed image uses `clip-path: inset(0 0 0 ${position}%)` to reveal from left
- Default position: 50%
- Compressed image uses the current floating bar settings (outputFormat, quality, maxDimensionPx)
- **Original image source:** `GET /api/assets/{assetId}` (existing endpoint, serves full-size image)
- **Compressed image source:** New `POST /api/image-tools/assets/render-preview` endpoint (see §5). Returns a `token`; display via `GET /api/image-tools/preview/{token}` (non-consuming, unlike download endpoint)
- Loading state: skeleton shimmer while preview generates

### 2.3 Format Comparison Grid (2x2, project assets only)

- 4 cards in a 2-column grid: WebP, AVIF, JPEG, PNG
- Each card shows:
  - Format label
  - Compressed file size
  - Savings percentage with color (green >20%, amber >0%, grey <=0%)
  - Checkmark on the currently selected format
- Auto-runs `render-preview` for all 4 formats on Drawer open (parallel)
- Click a format card -> updates the Before/After slider to show that format's result + updates the floating bar's format setting
- Loading state: 4 skeleton cards while previews generate

### 2.4 EXIF Metadata Section

- Displays key EXIF fields: Camera, Lens, GPS, Date, Software, Dimensions, Color Space
- Only fields that exist in the image are shown
- Two action buttons:
  - "Strip All Metadata" -- removes all EXIF data
  - "Strip GPS Only" -- removes only GPS coordinates
- Actions are per-image toggles that affect the conversion output
- Requires new backend API: `GET /api/image-tools/metadata/{assetId}` returning EXIF key-value pairs
- For uploaded files: extract metadata client-side via `exifr` library if possible, otherwise show "Metadata not available"

## 3. Data Flow

```
Drawer opens (project asset, assetId = "abc123")
  -> GET /api/assets/abc123                                              (original image for left side)
  -> POST /api/image-tools/assets/render-preview { assetId, outputFormat: currentFormat, quality, maxDimensionPx }
  -> POST /api/image-tools/assets/render-preview { assetId, outputFormat: "webp", quality, maxDimensionPx }
  -> POST /api/image-tools/assets/render-preview { assetId, outputFormat: "avif", quality, maxDimensionPx }
  -> POST /api/image-tools/assets/render-preview { assetId, outputFormat: "jpg",  quality, maxDimensionPx }
  -> POST /api/image-tools/assets/render-preview { assetId, outputFormat: "png",  quality, maxDimensionPx }
  -> GET /api/image-tools/metadata/abc123

Render-preview returns:
  { token, inputBytes, outputBytes, inputFormat, outputFormat }

Compressed image displayed via:
  GET /api/image-tools/preview/{token}   (non-consuming — can reload without invalidating)
```

All requests fire in parallel. Results populate as they arrive. Tokens auto-expire after 1 hour (same TTL as download tokens).

## 4. Drawer Component

- Use Radix Dialog (same pattern as AssetDrawer)
- Width: `max-w-[520px]`
- ESC dismiss + click-outside dismiss + focus trap
- Content scrolls if taller than viewport
- Key by asset ID so state resets when switching items

## 5. Backend Changes

### New endpoint: POST /api/image-tools/assets/render-preview

Converts a single asset image to the specified format/quality/dimensions and stores as a temp file. Returns metadata + a preview token.

**Request:** `{ assetId: string, outputFormat: string, quality: number, maxDimensionPx: number }`

**Response:** `{ token: string, inputBytes: number, outputBytes: number, inputFormat: string, outputFormat: string }`

Uses the same `optimize.ProcessLocalFile` pipeline as uploads. Temp files stored with `imageToolDownload` map and cleaned up after `imageToolDownloadTTL`.

### New endpoint: GET /api/image-tools/preview/{token}

Serves a temp preview file **without consuming the token** (uses `peekImageToolDownload` instead of `takeImageToolDownload`). This allows the `<img>` element to reload the same preview multiple times (e.g. when switching between format cards). Tokens expire naturally after TTL.

### New endpoint: GET /api/image-tools/metadata/{assetId}

Returns EXIF key-value pairs. Only populated fields included. Uses `imageproc.Probe` or imgtools for extraction.

### Modify: POST /api/image-tools/assets/process

Add optional `stripMetadata: "all" | "gps" | "none"` to request body. Default: `"none"`. Backend uses imgtools or Go imageproc to strip EXIF.

## 6. i18n Keys (en + zh-TW)

```
imageTools.preview
imageTools.beforeAfter
imageTools.formatCompare
imageTools.metadata
imageTools.stripAll
imageTools.stripGps
imageTools.metadataNotAvailable
imageTools.generating
imageTools.savings
imageTools.noSavings
imageTools.original
imageTools.compressed
```

## 7. File Changes

| File | Change |
|------|--------|
| `ui/src/features/image-tools/ImageToolsPreviewDrawer.tsx` | New: Drawer with 3 sections |
| `ui/src/features/image-tools/ImageToolsView.tsx` | Drawer open state + pass to drawer |
| `ui/src/api/imageTools.ts` | Add `renderPreview`, `getImageToolMetadata`; update `ImageToolSettings` with `stripMetadata` |
| `ui/src/i18n/locales/en.json` | Add preview drawer keys |
| `ui/src/i18n/locales/zh-TW.json` | Add preview drawer keys |
| `internal/server/image_tools_handlers.go` | Add render-preview + preview-serve + metadata endpoints; add stripMetadata to process |
| `internal/server/server.go` | Register 3 new routes |

## 8. Acceptance Criteria

- [ ] Click queue item (project asset) opens Drawer with all 3 sections
- [ ] Click queue item (upload) opens Drawer with preview + file info only
- [ ] Before/After slider works with drag
- [ ] 4-format comparison grid loads and is clickable
- [ ] Clicking a format updates Before/After + floating bar setting
- [ ] EXIF metadata displays for project assets
- [ ] Strip All / Strip GPS buttons work
- [ ] Drawer dismisses on ESC / click-outside / X
- [ ] Loading states (skeleton) while previews generate
- [ ] Both dark and light themes verified
- [ ] i18n keys for en + zh-TW
