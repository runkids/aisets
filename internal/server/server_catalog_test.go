package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"aisets/internal/config"
	"aisets/internal/lint"
	"aisets/internal/scanner"
)

func TestCatalogLintRouteFiltersByProject(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	left := serverScanAsset(root, "src/left.png", 100, "left", 0)
	left.ProjectID = "left"
	left.ProjectName = "Left"
	right := serverScanAsset(root, "src/right.png", 100, "right", 0)
	right.ProjectID = "right"
	right.ProjectName = "Right"
	if _, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-07T00:00:00Z",
		Projects: []scanner.Project{
			{ID: "left", Name: "Left", Path: filepath.Join(root, "left")},
			{ID: "right", Name: "Right", Path: filepath.Join(root, "right")},
		},
		Items: []scanner.AssetItem{left, right},
		LintFindings: []lint.Finding{
			{RuleID: "left", Severity: "warning", File: "src/left.tsx", AssetID: left.ID},
			{RuleID: "right", Severity: "warning", File: "src/right.tsx", AssetID: right.ID},
			{RuleID: "global", Severity: "info", File: "src/App.tsx"},
		},
		Stats: scanner.CatalogStats{TotalFiles: 2, LintFindings: 3},
	}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/catalog/lint?projectId=left", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("catalog lint = %d %s", rec.Code, rec.Body.String())
	}
	var page struct {
		Items []lint.Finding `json:"items"`
		Total int            `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].AssetID != left.ID {
		t.Fatalf("catalog lint project page = %#v", page)
	}
}

func TestCatalogFavoriteRoutesToggleAndFilter(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	item := serverScanAsset(root, "src/logo.png", 100, "logo", 1)
	item.ID = "logo"
	if _, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-07T00:00:00Z",
		Projects:    []scanner.Project{{ID: "p", Name: "fixture", Path: root}},
		Items:       []scanner.AssetItem{item},
		Stats:       scanner.CatalogStats{TotalFiles: 1, ReferencedFiles: 1},
	}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/catalog/items/logo/favorite", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("favorite item = %d %s", rec.Code, rec.Body.String())
	}
	var favoriteResp struct {
		Item scanner.AssetItem `json:"item"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &favoriteResp); err != nil {
		t.Fatal(err)
	}
	if favoriteResp.Item.ID != item.ID || !favoriteResp.Item.Favorite {
		t.Fatalf("favorite response = %#v", favoriteResp)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/catalog/items?favorite=true", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("favorite catalog items = %d %s", rec.Code, rec.Body.String())
	}
	var page config.CatalogItemsPage
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].ID != item.ID || !page.Items[0].Favorite {
		t.Fatalf("favorite catalog page = %#v", page)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodDelete, "/api/catalog/items/logo/favorite", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("unfavorite item = %d %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &favoriteResp); err != nil {
		t.Fatal(err)
	}
	if favoriteResp.Item.Favorite {
		t.Fatalf("unfavorite response = %#v", favoriteResp)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/catalog/items?favorite=true", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("empty favorite catalog items = %d %s", rec.Code, rec.Body.String())
	}
	page = config.CatalogItemsPage{}
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if page.Total != 0 || len(page.Items) != 0 {
		t.Fatalf("empty favorite catalog page = %#v", page)
	}
}
