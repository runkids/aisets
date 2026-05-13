# Image Tools Preview Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a preview Drawer to Image Tools that provides before/after comparison, multi-format comparison grid, and EXIF metadata viewing with strip controls.

**Architecture:** Three new Go endpoints (render-preview, preview-serve, metadata) + one React Drawer component. Backend uses existing `optimize.ProcessLocalFile` for rendering and `imageproc.ExtractEXIF` / `config.CatalogEXIFEnrich` for EXIF. Frontend Drawer follows AssetDrawer's Radix Dialog pattern with `DialogDrawerSurface`. The Drawer opens from queue item clicks in ImageToolsView.

**Tech Stack:** Go (net/http, imageproc, optimize), React, Radix Dialog, TypeScript, Tailwind/CVA, i18n

---

## File Structure

| File | Responsibility |
|------|---------------|
| `internal/server/image_tools_handlers.go` | Modify: add `handleImageToolRenderPreview`, `handleImageToolPreviewServe`, `handleImageToolMetadata` handlers |
| `internal/server/server.go` | Modify: register 3 new routes |
| `internal/server/server_actions_test.go` | Modify: add test for render-preview, preview-serve, metadata endpoints |
| `ui/src/api/imageTools.ts` | Modify: add `renderImageToolPreview`, `getImageToolMetadata` functions |
| `ui/src/features/image-tools/ImageToolsPreviewDrawer.tsx` | Create: Drawer component with 3 sections |
| `ui/src/features/image-tools/ImageToolsView.tsx` | Modify: add drawer open state + click handler on queue items |
| `ui/src/i18n/locales/en.json` | Modify: add `imageTools.preview*` / `imageTools.metadata*` keys |
| `ui/src/i18n/locales/zh-TW.json` | Modify: add corresponding zh-TW keys |

---

### Task 1: Backend — render-preview + preview-serve endpoints

**Files:**
- Modify: `internal/server/image_tools_handlers.go`
- Modify: `internal/server/server.go:149-152`
- Test: `internal/server/server_actions_test.go`

- [ ] **Step 1: Write the failing test for render-preview**

Add to `internal/server/server_actions_test.go` after `TestImageToolsUploadDownloadAndProjectPreview`:

```go
func TestImageToolRenderPreviewAndServe(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	project := filepath.Join(root, "project")
	svgPath := filepath.Join(project, "img", "icon.svg")
	mustWrite(t, svgPath, `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>`)

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	items := catalogItemsForTest(t, s)
	if len(items) != 1 {
		t.Fatalf("items = %d", len(items))
	}

	// render-preview should produce a token + metadata
	payload, _ := json.Marshal(map[string]any{
		"assetId":      items[0].ID,
		"outputFormat": "svg",
		"quality":      80,
	})
	rec := httptest.NewRecorder()
	s.handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/image-tools/assets/render-preview", bytes.NewReader(payload)))
	if rec.Code != http.StatusOK {
		t.Fatalf("render-preview = %d %s", rec.Code, rec.Body.String())
	}
	var renderResp struct {
		Token        string `json:"token"`
		InputBytes   int64  `json:"inputBytes"`
		OutputBytes  int64  `json:"outputBytes"`
		InputFormat  string `json:"inputFormat"`
		OutputFormat string `json:"outputFormat"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &renderResp); err != nil {
		t.Fatal(err)
	}
	if renderResp.Token == "" {
		t.Fatal("render-preview returned empty token")
	}
	if renderResp.InputBytes <= 0 {
		t.Fatalf("inputBytes = %d", renderResp.InputBytes)
	}

	// preview-serve should serve the file without consuming the token
	rec = httptest.NewRecorder()
	s.handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/image-tools/preview/"+renderResp.Token, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("preview serve = %d %s", rec.Code, rec.Body.String())
	}

	// second request should still work (non-consuming)
	rec = httptest.NewRecorder()
	s.handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/image-tools/preview/"+renderResp.Token, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("preview serve second request = %d %s", rec.Code, rec.Body.String())
	}

	// invalid token should 404
	rec = httptest.NewRecorder()
	s.handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/image-tools/preview/badtoken", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("preview serve bad token = %d", rec.Code)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/server/ -run TestImageToolRenderPreviewAndServe -v`
Expected: FAIL (routes not registered, handlers not defined)

- [ ] **Step 3: Add render-preview request struct + handler**

In `internal/server/image_tools_handlers.go`, add after the existing `imageToolRequestBody` struct (line 39):

```go
type imageToolRenderPreviewRequest struct {
	AssetID        string `json:"assetId"`
	OutputFormat   string `json:"outputFormat"`
	Quality        int    `json:"quality"`
	MaxDimensionPx int    `json:"maxDimensionPx"`
}

type imageToolRenderPreviewResponse struct {
	Token        string `json:"token"`
	InputBytes   int64  `json:"inputBytes"`
	OutputBytes  int64  `json:"outputBytes"`
	InputFormat  string `json:"inputFormat"`
	OutputFormat string `json:"outputFormat"`
}

func (s *Server) handleImageToolRenderPreview(w http.ResponseWriter, r *http.Request) {
	var body imageToolRenderPreviewRequest
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.AssetID == "" {
		writeError(w, http.StatusBadRequest, apierr.New("missing_asset_id", "assetId is required"))
		return
	}
	if _, err := s.ensureLatestScan(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	item, err := s.store.CatalogItem(0, body.AssetID)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	settings, _ := s.store.Settings()
	req := optimize.Request{
		OutputFormat:   body.OutputFormat,
		Quality:        body.Quality,
		MaxDimensionPx: body.MaxDimensionPx,
		AvifSpeed:      settings.OptimizationAvifSpeed,
		AllowLarger:    true,
	}
	op, candidate, err := optimize.ProcessLocalFile(item.LocalPath, item.RepoPath, item.Bytes, item.Image, req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	token := imageToolToken("render-preview:" + body.AssetID + ":" + body.OutputFormat)
	s.storeImageToolDownload(token, imageToolDownload{
		Path:        candidate,
		Name:        filepath.Base(candidate),
		ContentType: contentTypeForName(candidate),
		CreatedAt:   time.Now(),
	})
	writeJSON(w, http.StatusOK, imageToolRenderPreviewResponse{
		Token:        token,
		InputBytes:   op.CurrentBytes,
		OutputBytes:  op.EstimatedBytes,
		InputFormat:  op.InputFormat,
		OutputFormat: op.OutputFormat,
	})
}
```

- [ ] **Step 4: Add preview-serve handler**

In `internal/server/image_tools_handlers.go`, add after the new handler:

```go
func (s *Server) handleImageToolPreviewServe(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	download, ok := s.peekImageToolDownload(token)
	if !ok {
		writeError(w, http.StatusNotFound, apierr.New("preview_token_invalid", "preview token is invalid or expired"))
		return
	}
	w.Header().Set("Content-Type", download.ContentType)
	w.Header().Set("Cache-Control", "private, max-age=300")
	http.ServeFile(w, r, download.Path)
}
```

- [ ] **Step 5: Register routes in server.go**

In `internal/server/server.go`, add after line 152 (`GET /api/image-tools/download/{token}`):

```go
s.mux.HandleFunc("POST /api/image-tools/assets/render-preview", s.handleImageToolRenderPreview)
s.mux.HandleFunc("GET /api/image-tools/preview/{token}", s.handleImageToolPreviewServe)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `go test ./internal/server/ -run TestImageToolRenderPreviewAndServe -v`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `go test ./internal/server/ -v -count=1`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add internal/server/image_tools_handlers.go internal/server/server.go internal/server/server_actions_test.go
git commit -m "feat(image-tools): add render-preview and preview-serve endpoints

Render-preview converts a single asset to a specified format and returns
a token + size metadata. Preview-serve serves the temp file without
consuming the token, allowing repeated img loads for before/after UI."
```

---

### Task 2: Backend — metadata endpoint

**Files:**
- Modify: `internal/server/image_tools_handlers.go`
- Modify: `internal/server/server.go`
- Test: `internal/server/server_actions_test.go`

- [ ] **Step 1: Write the failing test**

Add to `internal/server/server_actions_test.go`:

```go
func TestImageToolMetadata(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	project := filepath.Join(root, "project")
	svgPath := filepath.Join(project, "img", "icon.svg")
	mustWrite(t, svgPath, `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>`)

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	items := catalogItemsForTest(t, s)
	if len(items) != 1 {
		t.Fatalf("items = %d", len(items))
	}

	// metadata should return EXIF data (SVG has no EXIF, so hasExif should be false)
	rec := httptest.NewRecorder()
	s.handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/image-tools/metadata/"+items[0].ID, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("metadata = %d %s", rec.Code, rec.Body.String())
	}
	var meta struct {
		HasEXIF bool `json:"hasExif"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &meta); err != nil {
		t.Fatal(err)
	}
	if meta.HasEXIF {
		t.Fatal("SVG should not have EXIF")
	}

	// invalid asset ID should 404
	rec = httptest.NewRecorder()
	s.handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/image-tools/metadata/nonexistent", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("metadata bad id = %d", rec.Code)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/server/ -run TestImageToolMetadata -v`
Expected: FAIL (route not registered)

- [ ] **Step 3: Add metadata handler**

In `internal/server/image_tools_handlers.go`, add after the `handleImageToolPreviewServe` function:

```go
func (s *Server) handleImageToolMetadata(w http.ResponseWriter, r *http.Request) {
	assetID := r.PathValue("assetId")
	if _, err := s.ensureLatestScan(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	item, err := s.store.CatalogItem(0, assetID)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	exif, err := imageproc.ExtractEXIF(item.LocalPath)
	if err != nil {
		writeJSON(w, http.StatusOK, imageproc.EXIFData{})
		return
	}
	writeJSON(w, http.StatusOK, exif)
}
```

- [ ] **Step 4: Register route in server.go**

In `internal/server/server.go`, add after the two routes added in Task 1:

```go
s.mux.HandleFunc("GET /api/image-tools/metadata/{assetId}", s.handleImageToolMetadata)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `go test ./internal/server/ -run TestImageToolMetadata -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add internal/server/image_tools_handlers.go internal/server/server.go internal/server/server_actions_test.go
git commit -m "feat(image-tools): add EXIF metadata endpoint

GET /api/image-tools/metadata/{assetId} extracts EXIF data from the
asset's local file via imageproc.ExtractEXIF (imgtools-first with Go
fallback). Returns camera, GPS, date, orientation, DPI fields."
```

---

### Task 3: Frontend — API functions

**Files:**
- Modify: `ui/src/api/imageTools.ts`

- [ ] **Step 1: Add types and renderImageToolPreview function**

In `ui/src/api/imageTools.ts`, add after the existing `previewImageToolAssets` function (line 41):

```typescript
export type RenderPreviewResponse = {
  token: string;
  inputBytes: number;
  outputBytes: number;
  inputFormat: string;
  outputFormat: string;
};

export function renderImageToolPreview(params: {
  assetId: string;
  outputFormat: string;
  quality: number;
  maxDimensionPx: number;
}) {
  return request<RenderPreviewResponse>(
    "/api/image-tools/assets/render-preview",
    {
      method: "POST",
      body: JSON.stringify(params),
    },
  );
}
```

- [ ] **Step 2: Add getImageToolMetadata function**

In `ui/src/api/imageTools.ts`, add after the new function:

```typescript
export type ImageToolMetadata = {
  hasExif: boolean;
  gpsLatitude?: number;
  gpsLongitude?: number;
  cameraMake?: string;
  cameraModel?: string;
  dateTimeOriginal?: string;
  orientation?: number;
  dpiX?: number;
  dpiY?: number;
};

export function getImageToolMetadata(assetId: string) {
  return request<ImageToolMetadata>(
    `/api/image-tools/metadata/${encodeURIComponent(assetId)}`,
  );
}
```

- [ ] **Step 3: Add previewImageUrl helper**

In `ui/src/api/imageTools.ts`, add after the new function:

```typescript
export function previewImageUrl(token: string) {
  return `${basePath}/api/image-tools/preview/${encodeURIComponent(token)}`;
}
```

- [ ] **Step 4: Verify build**

Run: `pnpm --dir ui build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add ui/src/api/imageTools.ts
git commit -m "feat(image-tools): add render-preview and metadata API functions

renderImageToolPreview, getImageToolMetadata, previewImageUrl for the
upcoming preview drawer UI."
```

---

### Task 4: i18n keys

**Files:**
- Modify: `ui/src/i18n/locales/en.json`
- Modify: `ui/src/i18n/locales/zh-TW.json`

- [ ] **Step 1: Add English keys**

In `ui/src/i18n/locales/en.json`, inside the `"imageTools"` object, add after `"readyHint": "Ready — press Convert"`:

```json
    "preview": "Preview",
    "beforeAfter": "Before / After",
    "original": "Original",
    "compressed": "Compressed",
    "formatCompare": "Format Comparison",
    "generating": "Generating preview…",
    "metadata": "Metadata",
    "metadataCamera": "Camera",
    "metadataGps": "GPS",
    "metadataDate": "Date",
    "metadataDpi": "DPI",
    "stripAll": "Strip All Metadata",
    "stripGps": "Strip GPS Only",
    "metadataNotAvailable": "Metadata not available",
    "noExif": "No EXIF metadata found",
    "uploadPreviewOnly": "Upload — preview only"
```

- [ ] **Step 2: Add zh-TW keys**

In `ui/src/i18n/locales/zh-TW.json`, inside the `"imageTools"` object, add after `"readyHint": "準備好了，按轉換"`:

```json
    "preview": "預覽",
    "beforeAfter": "前後對比",
    "original": "原始",
    "compressed": "壓縮",
    "formatCompare": "格式比較",
    "generating": "正在產生預覽…",
    "metadata": "中繼資料",
    "metadataCamera": "相機",
    "metadataGps": "GPS",
    "metadataDate": "日期",
    "metadataDpi": "DPI",
    "stripAll": "移除所有中繼資料",
    "stripGps": "僅移除 GPS",
    "metadataNotAvailable": "無法取得中繼資料",
    "noExif": "未偵測到 EXIF 中繼資料",
    "uploadPreviewOnly": "上傳檔案僅供預覽"
```

- [ ] **Step 3: Verify build**

Run: `pnpm --dir ui build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add ui/src/i18n/locales/en.json ui/src/i18n/locales/zh-TW.json
git commit -m "feat(image-tools): add i18n keys for preview drawer

Add en + zh-TW translations for before/after, format comparison,
and EXIF metadata sections."
```

---

### Task 5: Frontend — ImageToolsPreviewDrawer component

**Files:**
- Create: `ui/src/features/image-tools/ImageToolsPreviewDrawer.tsx`

This is the core UI task. The Drawer has 3 sections: Before/After slider, format comparison grid, EXIF metadata.

**Key patterns from codebase:**
- `DialogPrimitive.Root open onOpenChange={(o) => !o && requestClose()}` — AssetDrawer pattern (always open, controlled dismiss)
- `DialogDrawerSurface` — fixed right-slide drawer, 800px default width. Override to 520px via `className="!w-[520px]"`
- `DialogOverlay layer="drawer"` — drawer-specific overlay with blur
- Closing animation: set `closing` state → 200ms transition → call `onClose`
- `basePath` from `@/api/client` for image URLs

**Key API functions:**
- `renderImageToolPreview({ assetId, outputFormat, quality, maxDimensionPx })` → `{ token, inputBytes, outputBytes, inputFormat, outputFormat }`
- `previewImageUrl(token)` → URL string for `<img src>`
- `getImageToolMetadata(assetId)` → `{ hasExif, cameraMake, cameraModel, gpsLatitude, gpsLongitude, dateTimeOriginal, ... }`
- Original image: `${basePath}/api/assets/${encodeURIComponent(assetId)}`

- [ ] **Step 1: Create the Drawer component**

Create `ui/src/features/image-tools/ImageToolsPreviewDrawer.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Check, GripVertical, LoaderCircle, MapPin, Shield, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  getImageToolMetadata,
  previewImageUrl,
  renderImageToolPreview,
  type ImageToolMetadata,
  type ImageToolSettings,
  type RenderPreviewResponse,
} from "@/api";
import { basePath } from "@/api/client";
import type { AssetItem } from "@/types";
import { formatBytes } from "@/ui";
import {
  Badge,
  Button,
  IconButton,
} from "@/components/ui";
import {
  DialogDrawerSurface,
  DialogOverlay,
} from "@/components/ui/DialogShell";

type FormatPreview = {
  format: string;
  label: string;
  loading: boolean;
  data?: RenderPreviewResponse;
  error?: string;
};

const FORMAT_CARDS: { format: string; label: string }[] = [
  { format: "webp", label: "WebP" },
  { format: "avif", label: "AVIF" },
  { format: "jpg", label: "JPEG" },
  { format: "png", label: "PNG" },
];

type Props = {
  asset: AssetItem | null;
  uploadFile?: File;
  settings: ImageToolSettings;
  onClose: () => void;
  onFormatChange: (format: string) => void;
};

export function ImageToolsPreviewDrawer({
  asset,
  uploadFile,
  settings,
  onClose,
  onFormatChange,
}: Props) {
  const { t } = useTranslation();
  const [closing, setClosing] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);
  const [activeFormat, setActiveFormat] = useState(settings.outputFormat);
  const [formatPreviews, setFormatPreviews] = useState<FormatPreview[]>([]);
  const [metadata, setMetadata] = useState<ImageToolMetadata | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const isUpload = !asset && !!uploadFile;
  const displayName = asset
    ? asset.repoPath.split("/").pop() || asset.repoPath
    : uploadFile?.name || "";
  const ext = asset
    ? (asset.ext || "").replace(/^\./, "").toUpperCase()
    : (uploadFile?.name.split(".").pop() || "").toUpperCase();
  const bytes = asset ? asset.bytes : uploadFile?.size || 0;
  const dimensions =
    asset?.image?.width && asset?.image?.height
      ? `${asset.image.width}×${asset.image.height}`
      : "";
  const originalSrc = asset
    ? `${basePath}/api/assets/${encodeURIComponent(asset.id)}`
    : "";

  const requestClose = useCallback(() => {
    setClosing(true);
    setTimeout(onClose, 200);
  }, [onClose]);

  // Load format previews for project assets
  useEffect(() => {
    if (!asset) return;
    const controller = new AbortController();
    const previews: FormatPreview[] = FORMAT_CARDS.map((f) => ({
      ...f,
      loading: true,
    }));
    setFormatPreviews(previews);

    FORMAT_CARDS.forEach((f, i) => {
      renderImageToolPreview({
        assetId: asset.id,
        outputFormat: f.format,
        quality: settings.quality,
        maxDimensionPx: settings.maxDimensionPx,
      })
        .then((data) => {
          if (controller.signal.aborted) return;
          setFormatPreviews((prev) =>
            prev.map((p, j) => (j === i ? { ...p, loading: false, data } : p)),
          );
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setFormatPreviews((prev) =>
            prev.map((p, j) =>
              j === i
                ? { ...p, loading: false, error: String(err?.message || err) }
                : p,
            ),
          );
        });
    });

    return () => controller.abort();
  }, [asset?.id, settings.quality, settings.maxDimensionPx]);

  // Load metadata for project assets
  useEffect(() => {
    if (!asset) return;
    setMetadataLoading(true);
    getImageToolMetadata(asset.id)
      .then(setMetadata)
      .catch(() => setMetadata(null))
      .finally(() => setMetadataLoading(false));
  }, [asset?.id]);

  // Active format preview data (for Before/After slider)
  const activePreview = useMemo(
    () => formatPreviews.find((p) => p.format === activeFormat),
    [formatPreviews, activeFormat],
  );

  // Slider drag handlers
  const handleSliderMove = useCallback((clientX: number) => {
    if (!sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const pct = Math.max(
      0,
      Math.min(100, ((clientX - rect.left) / rect.width) * 100),
    );
    setSliderPos(pct);
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      handleSliderMove(e.clientX);
    },
    [handleSliderMove],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      handleSliderMove(e.clientX);
    },
    [handleSliderMove],
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const handleFormatClick = useCallback(
    (format: string) => {
      setActiveFormat(format);
      onFormatChange(format);
    },
    [onFormatChange],
  );

  const metadataFields = useMemo(() => {
    if (!metadata?.hasExif) return [];
    const fields: { label: string; value: string }[] = [];
    if (metadata.cameraMake || metadata.cameraModel) {
      fields.push({
        label: t("imageTools.metadataCamera"),
        value: [metadata.cameraMake, metadata.cameraModel]
          .filter(Boolean)
          .join(" "),
      });
    }
    if (metadata.gpsLatitude != null && metadata.gpsLongitude != null) {
      fields.push({
        label: t("imageTools.metadataGps"),
        value: `${metadata.gpsLatitude.toFixed(6)}, ${metadata.gpsLongitude.toFixed(6)}`,
      });
    }
    if (metadata.dateTimeOriginal) {
      fields.push({
        label: t("imageTools.metadataDate"),
        value: metadata.dateTimeOriginal,
      });
    }
    if (metadata.dpiX || metadata.dpiY) {
      fields.push({
        label: t("imageTools.metadataDpi"),
        value: `${metadata.dpiX || 0} × ${metadata.dpiY || 0}`,
      });
    }
    if (metadata.orientation) {
      fields.push({
        label: "Orientation",
        value: String(metadata.orientation),
      });
    }
    return fields;
  }, [metadata, t]);

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && requestClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay asChild>
          <DialogOverlay
            layer="drawer"
            style={{
              transition: "opacity 180ms var(--g-ease)",
              ...(closing ? { opacity: 0 } : {}),
            }}
          />
        </DialogPrimitive.Overlay>
        <DialogPrimitive.Content asChild>
          <DialogDrawerSurface
            className="!w-[520px]"
            style={{
              transition: "transform 200ms var(--g-ease)",
              ...(closing ? { transform: "translateX(100%)" } : {}),
            }}
          >
            {/* Header */}
            <header className="flex items-start gap-3 border-b border-g-line px-5 pb-3 pt-4">
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title asChild>
                  <h2 className="truncate font-g-mono text-g-body font-[590] text-g-ink">
                    {displayName}
                  </h2>
                </DialogPrimitive.Title>
                <div className="mt-0.5 flex items-center gap-1.5 text-g-chip text-g-ink-4">
                  <Badge variant="neutral" size="sm">
                    {ext}
                  </Badge>
                  <span>{formatBytes(bytes)}</span>
                  {dimensions && <span>· {dimensions}</span>}
                </div>
              </div>
              <DialogPrimitive.Close asChild>
                <IconButton size="sm" aria-label={t("common.close")}>
                  <X size={15} />
                </IconButton>
              </DialogPrimitive.Close>
            </header>

            {/* Scrollable body */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* Upload-only message */}
              {isUpload && (
                <div className="px-5 py-8 text-center text-g-ui text-g-ink-4">
                  {t("imageTools.uploadPreviewOnly")}
                </div>
              )}

              {/* Before/After Slider (project assets only) */}
              {asset && (
                <section className="border-b border-g-line px-5 py-4">
                  <h3 className="mb-2 text-g-ui font-[590] text-g-ink">
                    {t("imageTools.beforeAfter")}
                  </h3>
                  {activePreview?.loading ? (
                    <div className="flex h-[280px] items-center justify-center rounded-g-md bg-g-surface-2">
                      <LoaderCircle
                        size={20}
                        className="animate-spin text-g-ink-4"
                      />
                    </div>
                  ) : (
                    <div
                      ref={sliderRef}
                      className="relative h-[280px] cursor-col-resize select-none overflow-hidden rounded-g-md bg-g-surface-2"
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                    >
                      {/* Original (full width, behind) */}
                      <img
                        src={originalSrc}
                        alt={t("imageTools.original")}
                        className="absolute inset-0 h-full w-full object-contain"
                        draggable={false}
                      />
                      {/* Compressed (clipped from left) */}
                      {activePreview?.data?.token && (
                        <img
                          src={previewImageUrl(activePreview.data.token)}
                          alt={t("imageTools.compressed")}
                          className="absolute inset-0 h-full w-full object-contain"
                          style={{
                            clipPath: `inset(0 0 0 ${sliderPos}%)`,
                          }}
                          draggable={false}
                        />
                      )}
                      {/* Divider line */}
                      <div
                        className="absolute top-0 bottom-0 z-10 w-0.5 bg-white shadow-[0_0_4px_rgba(0,0,0,0.5)]"
                        style={{ left: `${sliderPos}%` }}
                      >
                        <div className="absolute top-1/2 left-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white shadow-g-md">
                          <GripVertical size={14} className="text-g-ink-3" />
                        </div>
                      </div>
                      {/* Labels */}
                      <span className="absolute top-2 left-2 rounded-g-sm bg-black/50 px-1.5 py-0.5 text-g-chip font-[500] text-white backdrop-blur">
                        {t("imageTools.original")}
                      </span>
                      <span className="absolute top-2 right-2 rounded-g-sm bg-black/50 px-1.5 py-0.5 text-g-chip font-[500] text-white backdrop-blur">
                        {t("imageTools.compressed")}
                      </span>
                    </div>
                  )}
                  {/* Size comparison below slider */}
                  {activePreview?.data && (
                    <div className="mt-2 flex items-center justify-between text-g-chip text-g-ink-4">
                      <span>
                        {formatBytes(activePreview.data.inputBytes)} →{" "}
                        {formatBytes(activePreview.data.outputBytes)}
                      </span>
                      <SavingsBadge
                        inputBytes={activePreview.data.inputBytes}
                        outputBytes={activePreview.data.outputBytes}
                      />
                    </div>
                  )}
                </section>
              )}

              {/* Format Comparison Grid (project assets only) */}
              {asset && (
                <section className="border-b border-g-line px-5 py-4">
                  <h3 className="mb-2 text-g-ui font-[590] text-g-ink">
                    {t("imageTools.formatCompare")}
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {formatPreviews.map((fp) => (
                      <button
                        key={fp.format}
                        type="button"
                        className={cn(
                          "relative flex flex-col items-start gap-1 rounded-g-md border p-3 text-left transition-colors duration-100",
                          fp.format === activeFormat
                            ? "border-g-accent bg-g-accent/5"
                            : "border-g-line bg-g-surface hover:border-g-line-strong",
                        )}
                        onClick={() => !fp.loading && handleFormatClick(fp.format)}
                        disabled={fp.loading}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className="font-g-mono text-g-ui font-[590] text-g-ink">
                            {fp.label}
                          </span>
                          {fp.format === activeFormat && (
                            <Check
                              size={14}
                              className="text-g-accent"
                              strokeWidth={2.5}
                            />
                          )}
                        </div>
                        {fp.loading ? (
                          <div className="h-4 w-20 animate-pulse rounded bg-g-surface-2" />
                        ) : fp.error ? (
                          <span className="text-g-chip text-g-red">
                            {t("imageTools.failed")}
                          </span>
                        ) : fp.data ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-g-chip text-g-ink-3">
                              {formatBytes(fp.data.outputBytes)}
                            </span>
                            <SavingsBadge
                              inputBytes={fp.data.inputBytes}
                              outputBytes={fp.data.outputBytes}
                            />
                          </div>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* EXIF Metadata Section */}
              {asset && (
                <section className="px-5 py-4">
                  <h3 className="mb-2 text-g-ui font-[590] text-g-ink">
                    {t("imageTools.metadata")}
                  </h3>
                  {metadataLoading ? (
                    <div className="flex h-16 items-center justify-center">
                      <LoaderCircle
                        size={16}
                        className="animate-spin text-g-ink-4"
                      />
                    </div>
                  ) : metadataFields.length === 0 ? (
                    <p className="text-g-ui text-g-ink-4">
                      {t("imageTools.noExif")}
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                        {metadataFields.map((field) => (
                          <div key={field.label} className="contents">
                            <span className="text-g-chip font-[500] text-g-ink-4">
                              {field.label}
                            </span>
                            <span className="truncate font-g-mono text-g-chip text-g-ink">
                              {field.value}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button variant="secondary" size="sm">
                          <Shield size={14} />
                          {t("imageTools.stripAll")}
                        </Button>
                        {metadata?.gpsLatitude != null && (
                          <Button variant="secondary" size="sm">
                            <MapPin size={14} />
                            {t("imageTools.stripGps")}
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                </section>
              )}
            </div>
          </DialogDrawerSurface>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SavingsBadge({
  inputBytes,
  outputBytes,
}: {
  inputBytes: number;
  outputBytes: number;
}) {
  const { t } = useTranslation();
  const diff = inputBytes - outputBytes;
  const pct =
    inputBytes > 0
      ? Math.round((Math.abs(diff) / inputBytes) * 100)
      : 0;
  if (diff > 0) {
    return (
      <span
        className={cn(
          "rounded-g-sm px-1 py-0.5 text-g-chip font-[500]",
          pct > 20
            ? "bg-g-green-soft text-g-green"
            : "bg-g-amber-soft text-g-amber",
        )}
      >
        {t("imageTools.compressionPct", { pct })}
      </span>
    );
  }
  if (diff < 0) {
    return (
      <span className="rounded-g-sm bg-g-surface-2 px-1 py-0.5 text-g-chip font-[500] text-g-ink-4">
        {t("imageTools.sizeIncrease", { pct })}
      </span>
    );
  }
  return (
    <span className="text-g-chip text-g-ink-4">
      {t("imageTools.noSavings")}
    </span>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm --dir ui build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add ui/src/features/image-tools/ImageToolsPreviewDrawer.tsx
git commit -m "feat(image-tools): add preview drawer component

Three sections: before/after slider with draggable divider, 2x2 format
comparison grid with savings badges, and EXIF metadata display with
strip action buttons. Uses Radix Dialog pattern matching AssetDrawer."
```

---

### Task 6: Frontend — Wire Drawer into ImageToolsView

**Files:**
- Modify: `ui/src/features/image-tools/ImageToolsView.tsx`

- [ ] **Step 1: Add import**

At the top of `ui/src/features/image-tools/ImageToolsView.tsx`, add after the existing imports:

```typescript
import { ImageToolsPreviewDrawer } from "./ImageToolsPreviewDrawer";
```

- [ ] **Step 2: Add Drawer state**

Inside the `ImageToolsView` component, add state after `const [wallWidth, setWallWidth] = useState(0);` (around line 84):

```typescript
const [drawerAssetId, setDrawerAssetId] = useState<string | null>(null);
const [drawerUploadIndex, setDrawerUploadIndex] = useState<number | null>(null);
```

- [ ] **Step 3: Add derived drawer values**

After the `const showFloatingBar = ...` line (or near the existing derived values), add:

```typescript
const drawerAsset = useMemo(
  () => (drawerAssetId ? basketItemById.get(drawerAssetId) || null : null),
  [drawerAssetId, basketItemById],
);
const drawerUploadFile =
  drawerUploadIndex !== null ? files[drawerUploadIndex] || null : null;
const showDrawer = drawerAsset !== null || drawerUploadFile !== null;
```

- [ ] **Step 4: Make queue items clickable**

Find the queue item inner `<div>` (around line 545-546):

```tsx
                      <div
                        className="flex h-14 items-center gap-2 rounded-g-md border border-g-line bg-g-surface p-2 shadow-g-sm animate-[imageToolCardIn_360ms_var(--g-ease-out)]"
```

Replace with:

```tsx
                      <button
                        type="button"
                        onClick={() => setDrawerAssetId(item.id)}
                        className="flex h-14 w-full items-center gap-2 rounded-g-md border border-g-line bg-g-surface p-2 text-left shadow-g-sm transition-colors hover:border-g-line-strong animate-[imageToolCardIn_360ms_var(--g-ease-out)]"
```

Change the corresponding closing `</div>` to `</button>`.

Add `e.stopPropagation()` to the remove button inside queue items (around line 566-571):

```tsx
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleAsset(item.id);
                          }}
                          aria-label={t("action.delete")}
                        >
```

- [ ] **Step 5: Make upload items clickable**

Find the upload item inner `<div>` (around line 586):

```tsx
                      <div
                        className="flex h-14 items-center gap-2 rounded-g-md border border-g-line bg-g-surface p-2 shadow-g-sm animate-[imageToolCardIn_360ms_var(--g-ease-out)]"
```

Replace with:

```tsx
                      <button
                        type="button"
                        onClick={() => setDrawerUploadIndex(index)}
                        className="flex h-14 w-full items-center gap-2 rounded-g-md border border-g-line bg-g-surface p-2 text-left shadow-g-sm transition-colors hover:border-g-line-strong animate-[imageToolCardIn_360ms_var(--g-ease-out)]"
```

Change the corresponding closing `</div>` to `</button>`.

Add `e.stopPropagation()` to the remove button inside upload items (around line 607-613):

```tsx
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFiles((prev) =>
                              prev.filter((_, i) => i !== index),
                            );
                          }}
                          aria-label={t("action.delete")}
                        >
```

- [ ] **Step 6: Render the Drawer**

At the end of the component's return JSX, just before the closing `</>` fragment, add:

```tsx
        {showDrawer && (
          <ImageToolsPreviewDrawer
            key={drawerAssetId || `upload-${drawerUploadIndex}`}
            asset={drawerAsset}
            uploadFile={drawerUploadFile || undefined}
            settings={settings}
            onClose={() => {
              setDrawerAssetId(null);
              setDrawerUploadIndex(null);
            }}
            onFormatChange={(format) =>
              setSettings((prev) => ({ ...prev, outputFormat: format }))
            }
          />
        )}
```

- [ ] **Step 7: Verify build**

Run: `pnpm --dir ui build`
Expected: Build succeeds

- [ ] **Step 8: Verify in browser**

1. Open `http://127.0.0.1:5174/image-tools`
2. Add project assets to the queue
3. Click a queue item → Drawer slides in from right
4. Verify: Before/After slider is draggable
5. Verify: 4 format cards load with size data
6. Verify: Clicking a format card updates the Before/After slider image
7. Verify: Clicking a format card updates the floating bar's format dropdown
8. Verify: EXIF section shows (or "No EXIF metadata found")
9. Verify: ESC / click overlay / X button dismisses Drawer
10. Verify: Drop an upload file, click its queue item → "Upload — preview only" message
11. Verify: Remove button on queue items still works (doesn't open drawer)
12. Test at 1440px + 768px widths in both dark and light themes

- [ ] **Step 9: Commit**

```bash
git add ui/src/features/image-tools/ImageToolsView.tsx
git commit -m "feat(image-tools): wire preview drawer into queue items

Click a queue item to open the preview drawer. Drawer keyed by asset
ID so state resets on item switch. Format card clicks update the
floating bar's output format setting."
```

---

### Task 7: Full verification

- [ ] **Step 1: Run full Go test suite**

Run: `go test ./... -count=1`
Expected: All tests pass

- [ ] **Step 2: Run Go vet**

Run: `go vet ./...`
Expected: No issues

- [ ] **Step 3: Run UI lint + build**

Run: `pnpm --dir ui lint && pnpm --dir ui build`
Expected: No errors or warnings

- [ ] **Step 4: Run Go embed tests (UI changes can break these)**

Run: `go test ./internal/server/ -run TestEmbed -v`
Expected: All embed tests pass
