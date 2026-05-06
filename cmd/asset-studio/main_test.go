package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"asset-studio/internal/config"
)

func TestMainWithoutArgsPrintsUsage(t *testing.T) {
	oldArgs := os.Args
	os.Args = []string{"asset-studio"}
	t.Cleanup(func() { os.Args = oldArgs })

	stderr := captureStderr(t, main)
	if !strings.Contains(stderr, "Usage:") || !strings.Contains(stderr, "asset-studio ui") {
		t.Fatalf("usage stderr = %q", stderr)
	}
}

func TestCmdVersionWritesTextAndJSON(t *testing.T) {
	oldVersion := version
	version = "1.2.3"
	t.Cleanup(func() { version = oldVersion })

	text := captureStdout(t, func() {
		if err := cmdVersion(nil); err != nil {
			t.Fatal(err)
		}
	})
	if text != "1.2.3\n" {
		t.Fatalf("text version = %q", text)
	}

	jsonOut := captureStdout(t, func() {
		if err := cmdVersion([]string{"--json"}); err != nil {
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

	added := captureStdout(t, func() {
		if err := cmdProjects([]string{"add", project, "--json"}); err != nil {
			t.Fatal(err)
		}
	})
	if !strings.Contains(added, `"ok": true`) || !strings.Contains(added, project) {
		t.Fatalf("projects add json = %s", added)
	}

	listed := captureStdout(t, func() {
		if err := cmdProjects([]string{"--json"}); err != nil {
			t.Fatal(err)
		}
	})
	if !strings.Contains(listed, `"projects"`) || !strings.Contains(listed, filepath.Base(project)) {
		t.Fatalf("projects list json = %s", listed)
	}

	scanned := captureStdout(t, func() {
		if err := cmdScan([]string{project, "--json"}); err != nil {
			t.Fatal(err)
		}
	})
	if !strings.Contains(scanned, `"ok": true`) || !strings.Contains(scanned, `"totalFiles": 1`) {
		t.Fatalf("scan json = %s", scanned)
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

	projects := toScannerProjects([]config.Project{{ID: "p", Name: "Project", Path: "/repo"}})
	if len(projects) != 1 || projects[0].ID != "p" || projects[0].Path != "/repo" {
		t.Fatalf("toScannerProjects() = %#v", projects)
	}
}

func TestCmdUIRejectsInvalidFlags(t *testing.T) {
	if err := cmdUI([]string{"--not-a-real-flag"}); err == nil {
		t.Fatal("expected invalid flag error")
	}
}

func TestExitWithErrorWritesJSONAndExits(t *testing.T) {
	if os.Getenv("ASSET_STUDIO_EXIT_WITH_ERROR_SUBPROCESS") == "1" {
		exitWithError("scan", errors.New("boom"), true)
		return
	}
	cmd := exec.Command(os.Args[0], "-test.run=TestExitWithErrorWritesJSONAndExits")
	cmd.Env = append(os.Environ(), "ASSET_STUDIO_EXIT_WITH_ERROR_SUBPROCESS=1")
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
	if err := os.WriteFile(shim, []byte("#!/usr/bin/env sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	if err := openBrowser("http://127.0.0.1:19520"); err != nil {
		t.Fatal(err)
	}
}

func TestEnvironmentAndUIDistHelpers(t *testing.T) {
	if got := envOrDefault("ASSET_STUDIO_TEST_MISSING", "fallback"); got != "fallback" {
		t.Fatalf("env fallback = %q", got)
	}
	t.Setenv("ASSET_STUDIO_TEST_VALUE", "configured")
	if got := envOrDefault("ASSET_STUDIO_TEST_VALUE", "fallback"); got != "configured" {
		t.Fatalf("env configured = %q", got)
	}

	oldVersion := version
	version = "dev"
	t.Cleanup(func() { version = oldVersion })
	if dir, err := ensureUIAvailable(); err != nil || dir != "" {
		t.Fatalf("ensureUIAvailable dev = %q, %v", dir, err)
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
