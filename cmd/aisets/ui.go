package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"aisets/internal/config"
	"aisets/internal/server"
	"aisets/internal/uidist"
)

const (
	defaultUIHost = "127.0.0.1"
	defaultUIPort = 19520
	uiOnceMode    = "once"
	uiStopMode    = "stop"
)

type uiOptions struct {
	host               string
	port               int
	basePath           string
	noOpen             bool
	appWindow          bool
	clearCache         bool
	projects           []string
	hostConfigured     bool
	portConfigured     bool
	basePathConfigured bool
}

type currentUIState struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	BasePath string `json:"basePath"`
}

func cmdUI(args []string, jsonModes ...bool) error {
	jsonOut := len(jsonModes) > 0 && jsonModes[0]
	mode, rest := splitUIMode(args)
	if mode == uiOnceMode {
		return cmdUIOnce(rest, jsonOut)
	}
	if mode == uiStopMode {
		return cmdUIStop(rest, jsonOut)
	}

	opts, err := parseUIOptions(rest)
	if err != nil {
		return err
	}
	opts = resolveRememberedUIOptions(opts)

	if uiServerReady(opts) {
		_ = writeCurrentUIState(opts)
		url := uiURL(opts)
		if jsonOut {
			return writeJSON(os.Stdout, map[string]any{"ok": true, "url": url, "status": "running"})
		}
		fmt.Fprintf(os.Stderr, "Aisets UI already running: %s\n", url)
		if !opts.noOpen {
			_ = openUIWindow(url, opts.appWindow)
		}
		return nil
	}

	return startUIInBackground(opts, jsonOut)
}

func cmdUIOnce(args []string, _ bool) error {
	opts, err := parseUIOptions(args)
	if err != nil {
		return err
	}

	if opts.clearCache {
		if err := uidist.ClearCache(); err != nil {
			return err
		}
	}

	uiDir, err := ensureUIAvailable()
	if err != nil {
		return err
	}

	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()
	if err := store.AddProjects(opts.projects); err != nil {
		return err
	}

	addr := uiAddr(opts)
	srv, err := server.New(server.Options{
		Addr:      addr,
		BasePath:  opts.basePath,
		Store:     store,
		UIDistDir: uiDir,
		Version:   version,
	})
	if err != nil {
		return err
	}

	url := uiURL(opts)
	srv.SetOnReady(func() {
		fmt.Fprintf(os.Stderr, "Aisets UI: %s\n", url)
		if !opts.noOpen {
			_ = openBrowser(url)
		}
	})

	return srv.StartWithContext(context.Background())
}

func cmdUIRestart(args []string) error {
	opts, err := parseUIOptions(args)
	if err != nil {
		return err
	}
	if len(opts.projects) > 0 {
		return fmt.Errorf("__restart-ui does not accept project paths")
	}
	opts = resolveRememberedUIOptions(opts)
	if !waitForUIServerDown(opts, 10*time.Second) {
		return fmt.Errorf("UI server did not stop before restart: %s", uiURL(opts))
	}
	return startUIInBackground(opts, false)
}

func cmdUIStop(args []string, jsonOut bool) error {
	opts, err := parseUIOptions(args)
	if err != nil {
		return err
	}
	if len(opts.projects) > 0 {
		return fmt.Errorf("ui stop does not accept project paths")
	}
	opts = resolveRememberedUIOptions(opts)

	stopped, err := stopUI(opts)
	if err != nil {
		return err
	}
	if jsonOut {
		status := "not_running"
		if stopped {
			status = "stopped"
		}
		return writeJSON(os.Stdout, map[string]any{"ok": true, "status": status, "url": uiURL(opts)})
	}
	if stopped {
		fmt.Fprintf(os.Stderr, "Aisets UI stopped: %s\n", uiURL(opts))
	} else {
		fmt.Fprintf(os.Stderr, "Aisets UI is not running: %s\n", uiURL(opts))
	}
	return nil
}

func splitUIMode(args []string) (string, []string) {
	if len(args) > 0 && (args[0] == uiOnceMode || args[0] == uiStopMode) {
		return args[0], args[1:]
	}
	return "", args
}

func parseUIOptions(args []string) (uiOptions, error) {
	opts := uiOptions{
		host:               envOrDefault("AISETS_UI_HOST", defaultUIHost),
		port:               envIntOrDefault("AISETS_PORT", defaultUIPort),
		basePath:           envOrDefault("AISETS_UI_BASE_PATH", ""),
		hostConfigured:     os.Getenv("AISETS_UI_HOST") != "",
		portConfigured:     os.Getenv("AISETS_PORT") != "",
		basePathConfigured: os.Getenv("AISETS_UI_BASE_PATH") != "",
	}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--host":
			value, next, err := requireUIFlagValue(args, i, "--host")
			if err != nil {
				return uiOptions{}, err
			}
			opts.host = value
			opts.hostConfigured = true
			i = next
		case strings.HasPrefix(arg, "--host="):
			opts.host = strings.TrimPrefix(arg, "--host=")
			opts.hostConfigured = true
		case arg == "--port":
			value, next, err := requireUIFlagValue(args, i, "--port")
			if err != nil {
				return uiOptions{}, err
			}
			port, err := parseUIPort(value)
			if err != nil {
				return uiOptions{}, err
			}
			opts.port = port
			opts.portConfigured = true
			i = next
		case strings.HasPrefix(arg, "--port="):
			port, err := parseUIPort(strings.TrimPrefix(arg, "--port="))
			if err != nil {
				return uiOptions{}, err
			}
			opts.port = port
			opts.portConfigured = true
		case arg == "--base-path" || arg == "-b":
			value, next, err := requireUIFlagValue(args, i, arg)
			if err != nil {
				return uiOptions{}, err
			}
			opts.basePath = value
			opts.basePathConfigured = true
			i = next
		case strings.HasPrefix(arg, "--base-path="):
			opts.basePath = strings.TrimPrefix(arg, "--base-path=")
			opts.basePathConfigured = true
		case strings.HasPrefix(arg, "-b="):
			opts.basePath = strings.TrimPrefix(arg, "-b=")
			opts.basePathConfigured = true
		case arg == "--no-open":
			opts.noOpen = true
		case arg == "--app":
			opts.appWindow = true
		case arg == "--clear-cache":
			opts.clearCache = true
		case strings.HasPrefix(arg, "-"):
			return uiOptions{}, fmt.Errorf("unknown flag: %s", arg)
		default:
			opts.projects = append(opts.projects, arg)
		}
	}
	return opts, nil
}

func requireUIFlagValue(args []string, index int, name string) (string, int, error) {
	next := index + 1
	if next >= len(args) || args[next] == "" {
		return "", index, fmt.Errorf("%s requires a value", name)
	}
	return args[next], next, nil
}

func parseUIPort(value string) (int, error) {
	port, err := strconv.Atoi(value)
	if err != nil || port <= 0 || port > 65535 {
		return 0, fmt.Errorf("--port must be a number between 1 and 65535")
	}
	return port, nil
}

func startUIInBackground(opts uiOptions, jsonOut bool) error {
	if err := ensureUIPortAvailable(opts); err != nil {
		return err
	}
	if err := prepareUIForBackground(jsonOut); err != nil {
		return err
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	logFile, err := openUILog()
	if err != nil {
		return err
	}
	defer logFile.Close()

	cmd := exec.Command(exe, uiChildArgs(opts)...)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.Stdin = nil
	detachUICommand(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	pid := cmd.Process.Pid
	if err := cmd.Process.Release(); err != nil {
		return err
	}
	if err := writeUIPidFile(opts, pid); err != nil {
		return err
	}
	if err := writeCurrentUIState(opts); err != nil {
		return err
	}

	url := uiURL(opts)
	if waitForUIServer(opts, 5*time.Second) {
		if !opts.noOpen {
			_ = openUIWindow(url, opts.appWindow)
		}
		if jsonOut {
			return writeJSON(os.Stdout, map[string]any{"ok": true, "url": url, "pid": pid})
		}
		fmt.Fprintf(os.Stderr, "Aisets UI: %s\n", url)
		return nil
	}

	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "url": url, "pid": pid, "log": logFile.Name(), "status": "starting"})
	}
	fmt.Fprintf(os.Stderr, "Aisets UI starting in background: %s\nLog: %s\n", url, logFile.Name())
	return nil
}

func uiChildArgs(opts uiOptions) []string {
	args := []string{
		"ui",
		uiOnceMode,
		"--no-open",
		"--host", opts.host,
		"--port", strconv.Itoa(opts.port),
	}
	if opts.basePath != "" {
		args = append(args, "--base-path", opts.basePath)
	}
	if opts.clearCache {
		args = append(args, "--clear-cache")
	}
	args = append(args, opts.projects...)
	return args
}

func stopUI(opts uiOptions) (bool, error) {
	if !uiServerReady(opts) {
		_ = os.Remove(uiPidFile(opts))
		_ = clearCurrentUIStateIfMatches(opts)
		return false, nil
	}
	pids := uiPIDs(opts)
	if len(pids) == 0 {
		return false, fmt.Errorf("UI server is running at %s, but no owning process could be found", uiURL(opts))
	}
	var killErr error
	for _, pid := range pids {
		if err := stopProcess(pid); err != nil {
			killErr = errors.Join(killErr, err)
		}
	}
	if waitForUIServerDown(opts, 3*time.Second) {
		_ = os.Remove(uiPidFile(opts))
		_ = clearCurrentUIStateIfMatches(opts)
		return true, killErr
	}
	for _, pid := range pids {
		process, err := os.FindProcess(pid)
		if err != nil {
			killErr = errors.Join(killErr, err)
			continue
		}
		if err := process.Kill(); err != nil {
			killErr = errors.Join(killErr, err)
		}
	}
	if waitForUIServerDown(opts, 2*time.Second) {
		_ = os.Remove(uiPidFile(opts))
		_ = clearCurrentUIStateIfMatches(opts)
		return true, killErr
	}
	return false, errors.Join(killErr, fmt.Errorf("UI server did not stop: %s", uiURL(opts)))
}

func stopProcess(pid int) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	if runtime.GOOS == "windows" {
		return process.Kill()
	}
	return process.Signal(os.Interrupt)
}

func uiPIDs(opts uiOptions) []int {
	seen := map[int]struct{}{}
	add := func(pid int) {
		if pid <= 0 {
			return
		}
		seen[pid] = struct{}{}
	}
	if pid, err := readUIPidFile(opts); err == nil {
		add(pid)
	}
	for _, pid := range pidsListeningOnPort(opts.port) {
		add(pid)
	}
	pids := make([]int, 0, len(seen))
	for pid := range seen {
		pids = append(pids, pid)
	}
	sort.Ints(pids)
	return pids
}

func writeUIPidFile(opts uiOptions, pid int) error {
	dir := config.CacheDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(uiPidFile(opts), []byte(strconv.Itoa(pid)+"\n"), 0o644)
}

func readUIPidFile(opts uiOptions) (int, error) {
	bytes, err := os.ReadFile(uiPidFile(opts))
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(strings.TrimSpace(string(bytes)))
}

func uiPidFile(opts uiOptions) string {
	name := strings.NewReplacer(":", "_", ".", "_").Replace(uiAddr(opts))
	return filepath.Join(config.CacheDir(), "ui-"+name+".pid")
}

func resolveRememberedUIOptions(opts uiOptions) uiOptions {
	if opts.hostConfigured || opts.portConfigured || opts.basePathConfigured {
		return opts
	}
	state, err := readCurrentUIState()
	if err != nil {
		return opts
	}
	opts.host = state.Host
	opts.port = state.Port
	opts.basePath = state.BasePath
	return opts
}

func writeCurrentUIState(opts uiOptions) error {
	if err := os.MkdirAll(config.CacheDir(), 0o755); err != nil {
		return err
	}
	body, err := json.Marshal(currentUIState{Host: opts.host, Port: opts.port, BasePath: opts.basePath})
	if err != nil {
		return err
	}
	return os.WriteFile(currentUIStateFile(), append(body, '\n'), 0o644)
}

func readCurrentUIState() (currentUIState, error) {
	bytes, err := os.ReadFile(currentUIStateFile())
	if err != nil {
		return currentUIState{}, err
	}
	var state currentUIState
	if err := json.Unmarshal(bytes, &state); err != nil {
		return currentUIState{}, err
	}
	if state.Host == "" || state.Port <= 0 || state.Port > 65535 {
		return currentUIState{}, fmt.Errorf("invalid UI state")
	}
	return state, nil
}

func clearCurrentUIStateIfMatches(opts uiOptions) error {
	state, err := readCurrentUIState()
	if err != nil {
		return nil
	}
	if state.Host == opts.host && state.Port == opts.port && state.BasePath == opts.basePath {
		return os.Remove(currentUIStateFile())
	}
	return nil
}

func currentUIStateFile() string {
	return filepath.Join(config.CacheDir(), "ui-current.json")
}

func pidsListeningOnPort(port int) []int {
	if runtime.GOOS == "windows" {
		return nil
	}
	out, err := exec.Command("lsof", "-tiTCP:"+strconv.Itoa(port), "-sTCP:LISTEN").Output()
	if err != nil {
		return nil
	}
	lines := strings.Fields(string(out))
	pids := make([]int, 0, len(lines))
	for _, line := range lines {
		pid, err := strconv.Atoi(line)
		if err == nil {
			pids = append(pids, pid)
		}
	}
	return pids
}

func openUILog() (*os.File, error) {
	dir := config.CacheDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return os.OpenFile(filepath.Join(dir, "ui.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
}

func ensureUIPortAvailable(opts uiOptions) error {
	listener, err := net.Listen("tcp", uiAddr(opts))
	if err != nil {
		return fmt.Errorf("UI server is not ready and %s is unavailable: %w", uiAddr(opts), err)
	}
	return listener.Close()
}

func uiAddr(opts uiOptions) string {
	return fmt.Sprintf("%s:%d", opts.host, opts.port)
}

func uiURL(opts uiOptions) string {
	url := fmt.Sprintf("http://%s", uiAddr(opts))
	if opts.basePath != "" {
		url += "/" + strings.Trim(opts.basePath, "/")
	}
	return url
}

func uiHealthURL(opts uiOptions) string {
	connectOpts := opts
	connectOpts.host = uiConnectHost(opts.host)
	url := uiURL(connectOpts)
	if strings.HasSuffix(url, "/") {
		return url + "api/health"
	}
	return url + "/api/health"
}

func uiConnectHost(host string) string {
	if host == "" || host == "0.0.0.0" || host == "::" {
		return "127.0.0.1"
	}
	return host
}

func waitForUIServer(opts uiOptions, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if uiServerReady(opts) {
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}
	return false
}

func waitForUIServerDown(opts uiOptions, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !uiServerReady(opts) {
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}
	return !uiServerReady(opts)
}

func uiServerReady(opts uiOptions) bool {
	client := http.Client{Timeout: 300 * time.Millisecond}
	resp, err := client.Get(uiHealthURL(opts))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func prepareUIForBackground(jsonOut bool) error {
	if jsonOut || !uiNeedsDownload() {
		_, err := ensureUIAvailable()
		return err
	}
	return withUISpinner("Downloading UI assets", func() error {
		_, err := ensureUIAvailable()
		return err
	})
}

func uiNeedsDownload() bool {
	return version != "" && version != "dev" && !uidist.IsCached(version)
}

func ensureUIAvailable() (string, error) {
	if uidist.IsCached(version) {
		return uidist.CacheDir(version), nil
	}
	if version == "" || version == "dev" {
		return "", nil
	}
	if err := uidist.Download(version); err != nil {
		return "", err
	}
	return uidist.CacheDir(version), nil
}

func withUISpinner(message string, fn func() error) error {
	return withStatusSpinner(message, "UI assets ready.", "UI asset download failed.", fn)
}

func withStatusSpinner(message, successMessage, failureMessage string, fn func() error) error {
	if !isTerminal(os.Stderr) {
		fmt.Fprintf(os.Stderr, "%s...\n", message)
		err := fn()
		if err != nil {
			if failureMessage != "" {
				fmt.Fprintln(os.Stderr, failureMessage)
			}
			return err
		}
		if successMessage != "" {
			fmt.Fprintln(os.Stderr, successMessage)
		}
		return nil
	}

	done := make(chan struct{})
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		ticker := time.NewTicker(180 * time.Millisecond)
		defer ticker.Stop()
		index := 0
		for {
			fmt.Fprintf(os.Stderr, "\r%s", uiSpinnerFrame(message, index))
			index++
			select {
			case <-done:
				return
			case <-ticker.C:
			}
		}
	}()

	err := fn()
	close(done)
	<-stopped
	clearUISpinnerLine()
	if err != nil {
		if failureMessage != "" {
			fmt.Fprintf(os.Stderr, "✕ %s\n", failureMessage)
		}
		return err
	}
	if successMessage != "" {
		fmt.Fprintf(os.Stderr, "⋮ %s\n", successMessage)
	}
	return nil
}

func uiSpinnerFrame(message string, index int) string {
	patterns := []string{"⠂  ", "⠂⠂ ", " ⠂⠂", "  ⠂", "   "}
	dots := strings.Repeat(".", index%4)
	return fmt.Sprintf("%s %s%s", patterns[index%len(patterns)], message, dots)
}

func clearUISpinnerLine() {
	fmt.Fprint(os.Stderr, "\r\033[2K")
}

func isTerminal(file *os.File) bool {
	info, err := file.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envIntOrDefault(key string, fallback int) int {
	if value := os.Getenv(key); value != "" {
		if n, err := strconv.Atoi(value); err == nil && n > 0 {
			return n
		}
	}
	return fallback
}

func openBrowser(url string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", url).Start()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}

func openUIWindow(url string, appWindow bool) error {
	if appWindow {
		if err := openBrowserAppWindow(url); err == nil {
			return nil
		}
	}
	return openBrowser(url)
}

func openBrowserAppWindow(url string) error {
	switch runtime.GOOS {
	case "darwin":
		for _, app := range []string{"Google Chrome", "Microsoft Edge", "Brave Browser", "Chromium"} {
			if err := exec.Command("open", "-na", app, "--args", "--app="+url).Start(); err == nil {
				return nil
			}
		}
	case "windows":
		for _, name := range []string{"chrome", "msedge", "brave", "chromium"} {
			if _, err := exec.LookPath(name); err != nil {
				continue
			}
			return exec.Command("cmd", "/c", "start", "", name, "--app="+url).Start()
		}
	default:
		for _, name := range []string{"google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"} {
			path, err := exec.LookPath(name)
			if err != nil {
				continue
			}
			return exec.Command(path, "--app="+url).Start()
		}
	}
	return fmt.Errorf("no browser app window launcher found")
}
