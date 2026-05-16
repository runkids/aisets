package main

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"aisets/internal/config"
	"aisets/internal/scanner"
)

func TestMainWithoutArgsPrintsUsage(t *testing.T) {
	oldArgs := os.Args
	os.Args = []string{"aisets"}
	t.Cleanup(func() { os.Args = oldArgs })

	stderr := captureStderr(t, main)
	if !strings.Contains(stderr, "Usage:") || !strings.Contains(stderr, "aisets ui") {
		t.Fatalf("usage stderr = %q", stderr)
	}
}

func TestCmdVersionWritesTextAndJSON(t *testing.T) {
	oldVersion := version
	version = "1.2.3"
	t.Cleanup(func() { version = oldVersion })

	text := captureStdout(t, func() {
		if err := cmdVersion(nil, false); err != nil {
			t.Fatal(err)
		}
	})
	if text != "1.2.3\n" {
		t.Fatalf("text version = %q", text)
	}

	jsonOut := captureStdout(t, func() {
		if err := cmdVersion([]string{"--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var body struct {
		OK      bool   `json:"ok"`
		Version string `json:"version"`
	}
	if err := json.Unmarshal([]byte(jsonOut), &body); err != nil {
		t.Fatal(err)
	}
	if !body.OK || body.Version != "1.2.3" {
		t.Fatalf("json version = %#v", body)
	}
}

func TestCmdUpdateDevModeWritesTextAndJSON(t *testing.T) {
	oldVersion := version
	version = "dev"
	t.Cleanup(func() { version = oldVersion })

	text := captureStderr(t, func() {
		if err := cmdUpdate(nil, false); err != nil {
			t.Fatal(err)
		}
	})
	if !strings.Contains(text, "DEV mode") || !strings.Contains(text, "0.1.1-dev") {
		t.Fatalf("text update = %q", text)
	}

	jsonOut := captureStdout(t, func() {
		if err := cmdUpdate([]string{"--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var body struct {
		OK     bool `json:"ok"`
		Update struct {
			CurrentVersion string `json:"currentVersion"`
			LatestVersion  string `json:"latestVersion"`
			Updated        bool   `json:"updated"`
			DevMode        bool   `json:"devMode"`
		} `json:"update"`
	}
	if err := json.Unmarshal([]byte(jsonOut), &body); err != nil {
		t.Fatal(err)
	}
	if !body.OK || !body.Update.DevMode || !body.Update.Updated || body.Update.CurrentVersion != "dev" || body.Update.LatestVersion != "0.1.1-dev" {
		t.Fatalf("json update = %#v", body)
	}
}

func TestCmdProjectsAddListAndScanJSON(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	project := filepath.Join(root, "project")
	if err := os.MkdirAll(filepath.Join(project, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "src", "icon.svg"), []byte(`<svg width="1" height="1"></svg>`), 0o644); err != nil {
		t.Fatal(err)
	}

	detected := captureStdout(t, func() {
		if err := cmdProjects([]string{"detect-intent", project, "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	if !strings.Contains(detected, `"detection"`) {
		t.Fatalf("projects detect-intent json = %s", detected)
	}

	added := captureStdout(t, func() {
		if err := cmdProjects([]string{"add", project, "--scan-intent", "assetPack", "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	if !strings.Contains(added, `"ok": true`) || !strings.Contains(added, project) || !strings.Contains(added, `"scanIntent": "assetPack"`) {
		t.Fatalf("projects add json = %s", added)
	}

	listed := captureStdout(t, func() {
		if err := cmdProjects([]string{"--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	if !strings.Contains(listed, `"projects"`) || !strings.Contains(listed, filepath.Base(project)) {
		t.Fatalf("projects list json = %s", listed)
	}

	scanned := captureStdout(t, func() {
		if err := cmdScan([]string{project, "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	if !strings.Contains(scanned, `"ok": true`) || !strings.Contains(scanned, `"scanId":`) || !strings.Contains(scanned, `"totalFiles": 1`) {
		t.Fatalf("scan json = %s", scanned)
	}
}

func TestCmdScansListAndDiffJSON(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	project := filepath.Join(root, "project")
	if err := os.MkdirAll(filepath.Join(project, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	icon := filepath.Join(project, "src", "icon.svg")
	if err := os.WriteFile(icon, []byte(`<svg width="1" height="1"></svg>`), 0o644); err != nil {
		t.Fatal(err)
	}

	baseID := scanProjectJSON(t, project)
	if err := os.WriteFile(icon, []byte(`<svg width="2" height="2"><rect width="2" height="2"/></svg>`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "src", "added.svg"), []byte(`<svg width="1" height="1"></svg>`), 0o644); err != nil {
		t.Fatal(err)
	}
	targetID := scanProjectJSON(t, project)

	listed := captureStdout(t, func() {
		if err := cmdScans([]string{"list", "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var listBody struct {
		OK    bool                 `json:"ok"`
		Scans []config.ScanSummary `json:"scans"`
	}
	decodeJSON(t, listed, &listBody)
	if !listBody.OK || len(listBody.Scans) != 2 || listBody.Scans[0].ID != targetID {
		t.Fatalf("scans list = %#v", listBody)
	}

	diffed := captureStdout(t, func() {
		if err := cmdScans([]string{"diff", "--base", strconv.FormatInt(baseID, 10), "--target", strconv.FormatInt(targetID, 10), "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var diffBody struct {
		OK   bool            `json:"ok"`
		Diff config.ScanDiff `json:"diff"`
	}
	decodeJSON(t, diffed, &diffBody)
	if !diffBody.OK || diffBody.Diff.Summary.Added != 1 || diffBody.Diff.Summary.Modified != 1 {
		t.Fatalf("scans diff = %#v", diffBody)
	}

	var code int
	stdout, stderr := captureOutput(t, func() {
		code = run([]string{"scans", "diff", "--target", strconv.FormatInt(targetID, 10), "--json"})
	})
	if code != 1 || stderr != "" {
		t.Fatalf("missing base code/stderr = %d/%q", code, stderr)
	}
	var errorBody struct {
		OK    bool `json:"ok"`
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	decodeJSON(t, stdout, &errorBody)
	if errorBody.OK || errorBody.Error.Code != "scan_id_required" {
		t.Fatalf("missing base error = %#v", errorBody)
	}
}

func TestCommandHelpers(t *testing.T) {
	if !wantsJSON([]string{"scan", "--json"}) || wantsJSON([]string{"scan"}) {
		t.Fatal("wantsJSON did not detect --json correctly")
	}
	args, found := stripJSONFlag([]string{"--json", "one", "--json", "two"})
	if !found || strings.Join(args, ",") != "one,two" {
		t.Fatalf("stripJSONFlag() = %#v, %v", args, found)
	}

	projects := toScannerProjects([]config.Project{{ID: "p", WorkspaceID: "default", Name: "Project", Path: "/repo", CreatedAt: "2026-05-07T00:00:00Z"}})
	if len(projects) != 1 || projects[0].ID != "p" || projects[0].WorkspaceID != "default" || projects[0].Path != "/repo" || projects[0].CreatedAt == "" {
		t.Fatalf("toScannerProjects() = %#v", projects)
	}
}

func scanProjectJSON(t *testing.T, project string) int64 {
	t.Helper()
	out := captureStdout(t, func() {
		if err := cmdScan([]string{project, "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var body struct {
		OK     bool  `json:"ok"`
		ScanID int64 `json:"scanId"`
	}
	decodeJSON(t, out, &body)
	if !body.OK || body.ScanID == 0 {
		t.Fatalf("scan body = %#v", body)
	}
	return body.ScanID
}

func TestRunGlobalJSONStrictErrorsAndUnknownCommand(t *testing.T) {
	oldVersion := version
	version = "9.9.9"
	t.Cleanup(func() { version = oldVersion })

	var code int
	stdout, stderr := captureOutput(t, func() {
		code = run([]string{"--json", "version"})
	})
	if code != 0 || stderr != "" {
		t.Fatalf("version code/stderr = %d/%q", code, stderr)
	}
	var versionBody struct {
		OK      bool   `json:"ok"`
		Version string `json:"version"`
	}
	decodeJSON(t, stdout, &versionBody)
	if !versionBody.OK || versionBody.Version != "9.9.9" {
		t.Fatalf("version body = %#v", versionBody)
	}

	stdout, stderr = captureOutput(t, func() {
		code = run([]string{"version", "--json", "--badflag"})
	})
	if code != 1 || stderr != "" {
		t.Fatalf("bad flag code/stderr = %d/%q", code, stderr)
	}
	var errorBody struct {
		OK    bool `json:"ok"`
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	decodeJSON(t, stdout, &errorBody)
	if errorBody.OK || errorBody.Error.Code != "version_invalid_flags" {
		t.Fatalf("bad flag body = %#v", errorBody)
	}

	stdout, stderr = captureOutput(t, func() {
		code = run([]string{"unknown", "--json"})
	})
	if code != 2 || stderr != "" {
		t.Fatalf("unknown code/stderr = %d/%q", code, stderr)
	}
	decodeJSON(t, stdout, &errorBody)
	if errorBody.OK || errorBody.Error.Code != "unknown_command" {
		t.Fatalf("unknown body = %#v", errorBody)
	}
}

func TestCmdProjectsRenameRemoveJSON(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	project := filepath.Join(root, "project")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := cmdProjects([]string{"add", project}, false); err != nil {
		t.Fatal(err)
	}

	renamed := captureStdout(t, func() {
		if err := cmdProjects([]string{"rename", "--id", project, "--name", "Team Assets", "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var renameBody struct {
		OK       bool             `json:"ok"`
		Projects []config.Project `json:"projects"`
	}
	decodeJSON(t, renamed, &renameBody)
	if !renameBody.OK || len(renameBody.Projects) != 1 || renameBody.Projects[0].Name != "Team Assets" {
		t.Fatalf("rename body = %#v", renameBody)
	}

	removed := captureStdout(t, func() {
		if err := cmdProjects([]string{"remove", "--id", project, "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var removeBody struct {
		OK       bool             `json:"ok"`
		Projects []config.Project `json:"projects"`
	}
	decodeJSON(t, removed, &removeBody)
	if !removeBody.OK || len(removeBody.Projects) != 0 {
		t.Fatalf("remove body = %#v", removeBody)
	}
}

func TestCmdSettingsExportImportAndResetJSON(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	project := filepath.Join(root, "project")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := cmdProjects([]string{"add", project}, false); err != nil {
		t.Fatal(err)
	}

	settingsJSON := captureStdout(t, func() {
		if err := cmdSettings([]string{"get", "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var settingsBody struct {
		OK       bool `json:"ok"`
		Settings struct {
			DatabasePath string `json:"databasePath"`
			DataDir      string `json:"dataDir"`
			CacheDir     string `json:"cacheDir"`
		} `json:"settings"`
	}
	decodeJSON(t, settingsJSON, &settingsBody)
	if !settingsBody.OK || settingsBody.Settings.DatabasePath == "" || settingsBody.Settings.DataDir == "" || settingsBody.Settings.CacheDir == "" {
		t.Fatalf("settings body = %#v", settingsBody)
	}

	exportPath := filepath.Join(root, "export.json")
	exported := captureStdout(t, func() {
		if err := cmdSettings([]string{"export", "--output", exportPath, "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var exportBody struct {
		OK     bool              `json:"ok"`
		Path   string            `json:"path"`
		Export config.ExportData `json:"export"`
	}
	decodeJSON(t, exported, &exportBody)
	if !exportBody.OK || exportBody.Path != exportPath || len(exportBody.Export.Projects) != 1 {
		t.Fatalf("export body = %#v", exportBody)
	}
	if _, err := os.Stat(exportPath); err != nil {
		t.Fatal(err)
	}

	reset := captureStdout(t, func() {
		if err := cmdSettings([]string{"reset-database", "--confirm", "RESET", "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var okBody struct {
		OK bool `json:"ok"`
	}
	decodeJSON(t, reset, &okBody)
	if !okBody.OK {
		t.Fatalf("reset body = %#v", okBody)
	}

	listed := captureStdout(t, func() {
		if err := cmdProjects([]string{"--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var listBody struct {
		Projects []config.Project `json:"projects"`
	}
	decodeJSON(t, listed, &listBody)
	if len(listBody.Projects) != 0 {
		t.Fatalf("projects after reset = %#v", listBody.Projects)
	}

	imported := captureStdout(t, func() {
		if err := cmdSettings([]string{"import", exportPath, "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var importBody struct {
		OK       bool             `json:"ok"`
		Projects []config.Project `json:"projects"`
	}
	decodeJSON(t, imported, &importBody)
	if !importBody.OK || len(importBody.Projects) != 1 || importBody.Projects[0].Path != project {
		t.Fatalf("import body = %#v", importBody)
	}
}

func TestCmdOptimizePreCheckAndActionsJSON(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	project := filepath.Join(root, "project")
	if err := os.MkdirAll(filepath.Join(project, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	oldPath := filepath.Join(project, "src", "old.svg")
	verboseSVG := `<svg width="16" height="16">
  <!-- comment that minify can remove -->
  <g>
    <rect width="16" height="16" fill="white"></rect>
  </g>
</svg>`
	if err := os.WriteFile(oldPath, []byte(verboseSVG), 0o644); err != nil {
		t.Fatal(err)
	}
	copyPath := filepath.Join(project, "src", "copy.svg")
	if err := os.WriteFile(copyPath, []byte(verboseSVG), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "src", "App.tsx"), []byte(`export const icon = "./old.svg";`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := cmdProjects([]string{"add", project}, false); err != nil {
		t.Fatal(err)
	}
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	fullProfile := scanner.ScanProfileFull
	if _, err := store.UpdateSettings(config.SettingsUpdate{ScanProfile: &fullProfile}); err != nil {
		t.Fatal(err)
	}
	store.Close()

	scanned := captureStdout(t, func() {
		if err := cmdScan([]string{"--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var summaryBody struct {
		OK     bool  `json:"ok"`
		ScanID int64 `json:"scanId"`
	}
	decodeJSON(t, scanned, &summaryBody)
	if !summaryBody.OK || summaryBody.ScanID == 0 {
		t.Fatalf("scan summary = %s", scanned)
	}
	listed := captureStdout(t, func() {
		if err := cmdCatalogItems([]string{"--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var scanBody struct {
		Page struct {
			Items []struct {
				ID       string   `json:"id"`
				RepoPath string   `json:"repoPath"`
				UsedBy   []string `json:"usedBy"`
			} `json:"items"`
		} `json:"page"`
	}
	decodeJSON(t, listed, &scanBody)
	assetID := ""
	copyID := ""
	for _, item := range scanBody.Page.Items {
		switch item.RepoPath {
		case "src/old.svg":
			assetID = item.ID
		case "src/copy.svg":
			copyID = item.ID
		}
	}
	if assetID == "" || copyID == "" {
		t.Fatalf("assets not found in scan = %#v", scanBody.Page.Items)
	}

	prechecked := captureStdout(t, func() {
		if err := cmdPreCheck([]string{oldPath, "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var precheckBody struct {
		OK      bool `json:"ok"`
		Results []struct {
			Verdict      string        `json:"verdict"`
			ExactMatches []interface{} `json:"exactMatches"`
		} `json:"results"`
	}
	decodeJSON(t, prechecked, &precheckBody)
	if !precheckBody.OK || len(precheckBody.Results) != 1 || precheckBody.Results[0].Verdict != "duplicate" || len(precheckBody.Results[0].ExactMatches) == 0 {
		t.Fatalf("precheck body = %#v", precheckBody)
	}

	estimated := captureStdout(t, func() {
		if err := cmdOptimize([]string{"estimate", assetID, "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var estimateBody struct {
		OK       bool `json:"ok"`
		Estimate struct {
			ItemCount int `json:"itemCount"`
		} `json:"estimate"`
	}
	decodeJSON(t, estimated, &estimateBody)
	if !estimateBody.OK || estimateBody.Estimate.ItemCount != 1 {
		t.Fatalf("estimate body = %#v", estimateBody)
	}

	estimatedAll := captureStdout(t, func() {
		if err := cmdOptimize([]string{"estimate", "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	decodeJSON(t, estimatedAll, &estimateBody)
	if !estimateBody.OK || estimateBody.Estimate.ItemCount != 2 {
		t.Fatalf("estimate all body = %#v", estimateBody)
	}

	scripted := captureStdout(t, func() {
		if err := cmdOptimize([]string{"script", assetID, "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var scriptBody struct {
		OK        bool   `json:"ok"`
		Format    string `json:"format"`
		Script    string `json:"script"`
		ItemCount int    `json:"itemCount"`
	}
	decodeJSON(t, scripted, &scriptBody)
	if !scriptBody.OK || scriptBody.Format != "bash" || scriptBody.ItemCount != 1 || !strings.Contains(scriptBody.Script, "svgo") {
		t.Fatalf("script body = %#v", scriptBody)
	}

	mergePreviewJSON := captureStdout(t, func() {
		if err := cmdActions([]string{"merge-duplicates", "preview", "--asset-id", copyID, "--preferred-path", "src/old.svg", "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var mergePreviewBody struct {
		OK      bool `json:"ok"`
		Preview struct {
			CanApply bool     `json:"canApply"`
			Deletes  []string `json:"deletes"`
		} `json:"preview"`
	}
	decodeJSON(t, mergePreviewJSON, &mergePreviewBody)
	if !mergePreviewBody.OK || !mergePreviewBody.Preview.CanApply || len(mergePreviewBody.Preview.Deletes) != 1 {
		t.Fatalf("merge preview body = %#v", mergePreviewBody)
	}

	deletePreviewJSON := captureStdout(t, func() {
		if err := cmdActions([]string{"delete-unused", "preview", "--asset-id", copyID, "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var deletePreviewBody struct {
		OK      bool `json:"ok"`
		Preview struct {
			CanApply bool     `json:"canApply"`
			Deletes  []string `json:"deletes"`
		} `json:"preview"`
	}
	decodeJSON(t, deletePreviewJSON, &deletePreviewBody)
	if !deletePreviewBody.OK || !deletePreviewBody.Preview.CanApply || len(deletePreviewBody.Preview.Deletes) != 1 {
		t.Fatalf("delete preview body = %#v", deletePreviewBody)
	}

	previewJSON := captureStdout(t, func() {
		if err := cmdActions([]string{"rename", "preview", "--asset-id", assetID, "--target-path", "src/new.svg", "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var previewBody struct {
		OK      bool `json:"ok"`
		Preview struct {
			ID       string        `json:"id"`
			CanApply bool          `json:"canApply"`
			Changes  []interface{} `json:"changes"`
		} `json:"preview"`
	}
	decodeJSON(t, previewJSON, &previewBody)
	if !previewBody.OK || previewBody.Preview.ID == "" || !previewBody.Preview.CanApply || len(previewBody.Preview.Changes) != 1 {
		t.Fatalf("preview body = %#v", previewBody)
	}
	previewPath := filepath.Join(root, "preview.json")
	if err := os.WriteFile(previewPath, []byte(previewJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	applied := captureStdout(t, func() {
		if err := cmdActions([]string{"apply", "--preview", previewPath, "--json"}, false); err != nil {
			t.Fatal(err)
		}
	})
	var applyBody struct {
		OK     bool `json:"ok"`
		Result struct {
			MovedFiles        int `json:"movedFiles"`
			ChangedReferences int `json:"changedReferences"`
		} `json:"result"`
	}
	decodeJSON(t, applied, &applyBody)
	if !applyBody.OK || applyBody.Result.MovedFiles != 1 || applyBody.Result.ChangedReferences != 1 {
		t.Fatalf("apply body = %#v", applyBody)
	}
	if _, err := os.Stat(filepath.Join(project, "src", "new.svg")); err != nil {
		t.Fatal(err)
	}
	appBytes, err := os.ReadFile(filepath.Join(project, "src", "App.tsx"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(appBytes), "./new.svg") {
		t.Fatalf("App.tsx was not rewritten: %s", appBytes)
	}
}

func TestCmdUIRejectsInvalidFlags(t *testing.T) {
	if err := cmdUI([]string{"--not-a-real-flag"}); err == nil {
		t.Fatal("expected invalid flag error")
	}
}

func TestParseUIOptionsAcceptsFlagsAfterProjects(t *testing.T) {
	t.Setenv("AISETS_UI_BASE_PATH", "/env-studio")
	opts, err := parseUIOptions([]string{
		"/workspace/a",
		"--port", "20555",
		"/workspace/b",
		"--host=0.0.0.0",
		"--base-path", "/studio/",
		"--app",
		"--no-open",
	})
	if err != nil {
		t.Fatal(err)
	}
	if opts.host != "0.0.0.0" || opts.port != 20555 || opts.basePath != "/studio/" || !opts.noOpen || !opts.appWindow {
		t.Fatalf("opts = %#v", opts)
	}
	if strings.Join(opts.projects, ",") != "/workspace/a,/workspace/b" {
		t.Fatalf("projects = %#v", opts.projects)
	}
	if _, err := parseUIOptions([]string{"--port", "bad"}); err == nil {
		t.Fatal("expected invalid port error")
	}
	if _, err := parseUIOptions([]string{"--host"}); err == nil {
		t.Fatal("expected missing host value error")
	}
}

func TestCurrentUIStateRemembersPortAndRespectsExplicitFlags(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))

	remembered := uiOptions{host: "127.0.0.1", port: 3003, basePath: "/studio"}
	if err := writeCurrentUIState(remembered); err != nil {
		t.Fatal(err)
	}

	opts, err := parseUIOptions(nil)
	if err != nil {
		t.Fatal(err)
	}
	resolved := resolveRememberedUIOptions(opts)
	if resolved.host != "127.0.0.1" || resolved.port != 3003 || resolved.basePath != "/studio" {
		t.Fatalf("remembered opts = %#v", resolved)
	}

	explicit, err := parseUIOptions([]string{"--port", "4004"})
	if err != nil {
		t.Fatal(err)
	}
	resolved = resolveRememberedUIOptions(explicit)
	if resolved.port != 4004 {
		t.Fatalf("explicit port was not respected: %#v", resolved)
	}

	if err := clearCurrentUIStateIfMatches(remembered); err != nil {
		t.Fatal(err)
	}
	if _, err := readCurrentUIState(); err == nil {
		t.Fatal("expected current UI state to be cleared")
	}
}

func TestUIModeURLAndBackgroundChildArgs(t *testing.T) {
	mode, rest := splitUIMode([]string{"once", "--port", "20555"})
	if mode != uiOnceMode || strings.Join(rest, " ") != "--port 20555" {
		t.Fatalf("mode=%q rest=%#v", mode, rest)
	}
	mode, rest = splitUIMode([]string{"stop", "--port", "20555"})
	if mode != uiStopMode || strings.Join(rest, " ") != "--port 20555" {
		t.Fatalf("stop mode=%q rest=%#v", mode, rest)
	}

	opts := uiOptions{
		host:       "0.0.0.0",
		port:       20555,
		basePath:   "/studio/",
		noOpen:     true,
		clearCache: true,
		projects:   []string{"/workspace/a", "/workspace/b"},
	}
	if got := uiURL(opts); got != "http://0.0.0.0:20555/studio" {
		t.Fatalf("uiURL() = %q", got)
	}
	if got := uiHealthURL(opts); got != "http://127.0.0.1:20555/studio/api/health" {
		t.Fatalf("uiHealthURL() = %q", got)
	}
	got := strings.Join(uiChildArgs(opts), "\n")
	want := strings.Join([]string{
		"ui",
		"once",
		"--no-open",
		"--host", "0.0.0.0",
		"--port", "20555",
		"--base-path", "/studio/",
		"--clear-cache",
		"/workspace/a",
		"/workspace/b",
	}, "\n")
	if got != want {
		t.Fatalf("child args = %#v", uiChildArgs(opts))
	}
}

func TestCmdUIReusesRunningServerWithJSON(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/health" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(server.Close)

	host, port, err := net.SplitHostPort(strings.TrimPrefix(server.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	out := captureStdout(t, func() {
		if err := cmdUI([]string{"--host", host, "--port", port, "--no-open"}, true); err != nil {
			t.Fatal(err)
		}
	})
	var body struct {
		OK     bool   `json:"ok"`
		URL    string `json:"url"`
		Status string `json:"status"`
	}
	decodeJSON(t, out, &body)
	if !body.OK || body.URL != server.URL || body.Status != "running" {
		t.Fatalf("ui reuse body = %#v", body)
	}
}

func TestCmdUIStopReportsNotRunningJSON(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatal(err)
	}
	out := captureStdout(t, func() {
		if err := cmdUI([]string{"stop", "--host", host, "--port", port}, true); err != nil {
			t.Fatal(err)
		}
	})
	var body struct {
		OK     bool   `json:"ok"`
		Status string `json:"status"`
	}
	decodeJSON(t, out, &body)
	if !body.OK || body.Status != "not_running" {
		t.Fatalf("stop body = %#v", body)
	}
	if err := cmdUI([]string{"stop", "/workspace/project"}); err == nil {
		t.Fatal("expected ui stop to reject project paths")
	}
}

func TestUIPortAndLogHelpers(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	host, portText, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatal(err)
	}
	if err := ensureUIPortAvailable(uiOptions{host: host, port: port}); err == nil {
		t.Fatal("expected occupied port to be rejected")
	}

	root := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	logFile, err := openUILog()
	if err != nil {
		t.Fatal(err)
	}
	name := logFile.Name()
	if err := logFile.Close(); err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(root, "cache", "aisets", "ui.log")
	if name != want {
		t.Fatalf("log path = %q, want %q", name, want)
	}
	opts := uiOptions{host: "127.0.0.1", port: 20555}
	if err := writeUIPidFile(opts, 12345); err != nil {
		t.Fatal(err)
	}
	pid, err := readUIPidFile(opts)
	if err != nil {
		t.Fatal(err)
	}
	if pid != 12345 {
		t.Fatalf("pid file = %d", pid)
	}
}

func TestExitWithErrorWritesJSONAndExits(t *testing.T) {
	if os.Getenv("AISETS_EXIT_WITH_ERROR_SUBPROCESS") == "1" {
		exitWithError("scan", errors.New("boom"), true)
		return
	}
	cmd := exec.Command(os.Args[0], "-test.run=TestExitWithErrorWritesJSONAndExits")
	cmd.Env = append(os.Environ(), "AISETS_EXIT_WITH_ERROR_SUBPROCESS=1")
	out, err := cmd.Output()
	if exitErr, ok := err.(*exec.ExitError); !ok || exitErr.ExitCode() != 1 {
		t.Fatalf("exitWithError subprocess err = %T %[1]v", err)
	}
	if !strings.Contains(string(out), `"ok": false`) || !strings.Contains(string(out), `"code": "scan_failed"`) {
		t.Fatalf("exitWithError output = %s", out)
	}
}

func TestOpenBrowserStartsPlatformCommand(t *testing.T) {
	commands := map[string]string{
		"darwin": "open",
		"linux":  "xdg-open",
	}
	name, ok := commands[runtime.GOOS]
	if !ok {
		t.Skipf("openBrowser command shim is not defined for %s", runtime.GOOS)
	}
	dir := t.TempDir()
	shim := filepath.Join(dir, name)
	if err := os.WriteFile(shim, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	if err := openBrowser("http://127.0.0.1:19520"); err != nil {
		t.Fatal(err)
	}
}

func TestOpenUIWindowStartsAppWindowWhenRequested(t *testing.T) {
	commands := map[string]string{
		"darwin": "open",
		"linux":  "google-chrome",
	}
	name, ok := commands[runtime.GOOS]
	if !ok {
		t.Skipf("desktop app command shim is not defined for %s", runtime.GOOS)
	}
	dir := t.TempDir()
	out := filepath.Join(dir, "args.txt")
	shim := filepath.Join(dir, name)
	if err := os.WriteFile(shim, []byte("#!/bin/sh\nprintf '%s\\n' \"$@\" > "+strconv.Quote(out)+"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	if err := openUIWindow("http://127.0.0.1:19520", true); err != nil {
		t.Fatal(err)
	}
	var content string
	for i := 0; i < 100; i++ {
		bytes, err := os.ReadFile(out)
		if err == nil {
			content = string(bytes)
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !strings.Contains(content, "--app=http://127.0.0.1:19520") {
		t.Fatalf("desktop app args = %q", content)
	}
}

func TestOpenUIWindowDefaultsToBrowser(t *testing.T) {
	commands := map[string]string{
		"darwin": "open",
		"linux":  "xdg-open",
	}
	name, ok := commands[runtime.GOOS]
	if !ok {
		t.Skipf("browser command shim is not defined for %s", runtime.GOOS)
	}
	dir := t.TempDir()
	out := filepath.Join(dir, "args.txt")
	shim := filepath.Join(dir, name)
	if err := os.WriteFile(shim, []byte("#!/bin/sh\nprintf '%s\\n' \"$@\" > "+strconv.Quote(out)+"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	if err := openUIWindow("http://127.0.0.1:19520", false); err != nil {
		t.Fatal(err)
	}
	var content string
	for i := 0; i < 100; i++ {
		bytes, err := os.ReadFile(out)
		if err == nil {
			content = string(bytes)
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if strings.Contains(content, "--app=") || !strings.Contains(content, "http://127.0.0.1:19520") {
		t.Fatalf("browser args = %q", content)
	}
}

func TestUINeedsDownloadDetectsReleaseCache(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	oldVersion := version
	t.Cleanup(func() { version = oldVersion })

	version = "1.2.3"
	if !uiNeedsDownload() {
		t.Fatal("expected release without cache to need download")
	}
	cacheDir := filepath.Join(root, "cache", "aisets", "ui", "1.2.3")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cacheDir, "index.html"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	if uiNeedsDownload() {
		t.Fatal("expected cached release to skip download")
	}
	version = "dev"
	if uiNeedsDownload() {
		t.Fatal("expected dev version to skip release download")
	}
	version = ""
	if uiNeedsDownload() {
		t.Fatal("expected empty version to skip release download")
	}
}

func TestWithUISpinnerWritesNonTerminalStatus(t *testing.T) {
	var err error
	stderr := captureStderr(t, func() {
		err = withUISpinner("Downloading UI assets", func() error { return nil })
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stderr, "Downloading UI assets...") || !strings.Contains(stderr, "UI assets ready.") {
		t.Fatalf("spinner stderr = %q", stderr)
	}
}

func TestUISpinnerFrameUsesDotMatrixStyle(t *testing.T) {
	got := uiSpinnerFrame("Downloading UI assets", 1)
	if !strings.Contains(got, "⠂⠂") || !strings.Contains(got, "Downloading UI assets.") {
		t.Fatalf("spinner frame = %q", got)
	}
}

func TestEnvironmentAndUIDistHelpers(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))

	if got := envOrDefault("AISETS_TEST_MISSING", "fallback"); got != "fallback" {
		t.Fatalf("env fallback = %q", got)
	}
	t.Setenv("AISETS_TEST_VALUE", "configured")
	if got := envOrDefault("AISETS_TEST_VALUE", "fallback"); got != "configured" {
		t.Fatalf("env configured = %q", got)
	}

	oldVersion := version
	version = "dev"
	t.Cleanup(func() { version = oldVersion })
	if dir, err := ensureUIAvailable(); err != nil || dir != "" {
		t.Fatalf("ensureUIAvailable dev = %q, %v", dir, err)
	}
	devCacheDir := filepath.Join(root, "cache", "aisets", "ui", "dev")
	if err := os.MkdirAll(devCacheDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(devCacheDir, "index.html"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	if dir, err := ensureUIAvailable(); err != nil || dir != devCacheDir {
		t.Fatalf("ensureUIAvailable cached dev = %q, %v", dir, err)
	}
	version = ""
	if dir, err := ensureUIAvailable(); err != nil || dir != "" {
		t.Fatalf("ensureUIAvailable empty = %q, %v", dir, err)
	}
}

func TestWriteJSONIndentsOutput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "out.json")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := writeJSON(file, map[string]any{"ok": true}); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(bytes) != "{\n  \"ok\": true\n}\n" {
		t.Fatalf("json output = %q", bytes)
	}
}

func decodeJSON(t *testing.T, raw string, target any) {
	t.Helper()
	if err := json.Unmarshal([]byte(raw), target); err != nil {
		t.Fatalf("decode JSON %q: %v", raw, err)
	}
}

func resolvedTempDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatal(err)
	}
	return resolved
}

func captureStderr(t *testing.T, fn func()) string {
	t.Helper()
	old := os.Stderr
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stderr = write
	defer func() { os.Stderr = old }()

	fn()
	if err := write.Close(); err != nil {
		t.Fatal(err)
	}
	bytes, err := io.ReadAll(read)
	if err != nil {
		t.Fatal(err)
	}
	if err := read.Close(); err != nil {
		t.Fatal(err)
	}
	return string(bytes)
}

func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	old := os.Stdout
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = write
	defer func() { os.Stdout = old }()

	fn()
	if err := write.Close(); err != nil {
		t.Fatal(err)
	}
	bytes, err := io.ReadAll(read)
	if err != nil {
		t.Fatal(err)
	}
	if err := read.Close(); err != nil {
		t.Fatal(err)
	}
	return string(bytes)
}

func captureOutput(t *testing.T, fn func()) (string, string) {
	t.Helper()
	oldStdout := os.Stdout
	oldStderr := os.Stderr
	stdoutRead, stdoutWrite, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	stderrRead, stderrWrite, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = stdoutWrite
	os.Stderr = stderrWrite
	defer func() {
		os.Stdout = oldStdout
		os.Stderr = oldStderr
	}()

	fn()
	if err := stdoutWrite.Close(); err != nil {
		t.Fatal(err)
	}
	if err := stderrWrite.Close(); err != nil {
		t.Fatal(err)
	}
	stdoutBytes, err := io.ReadAll(stdoutRead)
	if err != nil {
		t.Fatal(err)
	}
	stderrBytes, err := io.ReadAll(stderrRead)
	if err != nil {
		t.Fatal(err)
	}
	if err := stdoutRead.Close(); err != nil {
		t.Fatal(err)
	}
	if err := stderrRead.Close(); err != nil {
		t.Fatal(err)
	}
	return string(stdoutBytes), string(stderrBytes)
}
