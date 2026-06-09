package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"aisets/internal/config"
)

func TestDetectedAliasesRoute(t *testing.T) {
	root := resolvedTempDir(t)
	proj := filepath.Join(root, "app")
	writePNG(t, filepath.Join(proj, "a.png"))
	if err := os.WriteFile(
		filepath.Join(proj, "tsconfig.json"),
		[]byte(`{"compilerOptions":{"baseUrl":".","paths":{"@ui/*":["packages/ui/src/*"]}}}`),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{proj}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/settings/detected-aliases", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Projects []detectedAliasProject `json:"projects"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Projects) != 1 || len(resp.Projects[0].Aliases) != 1 {
		t.Fatalf("detected = %#v", resp.Projects)
	}
	if got := resp.Projects[0].Aliases[0]; got.Key != "@ui" || got.Value != "packages/ui/src" {
		t.Fatalf("alias = %#v", got)
	}
}
