package server

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"aisets/internal/apierr"
)

var (
	processExit          = os.Exit
	startUIRestartHelper = defaultStartUIRestartHelper
)

func (s *Server) handleRestart(w http.ResponseWriter, r *http.Request) {
	if !restartRequestAllowed(r) {
		writeError(w, http.StatusForbidden, apierr.New("restart_forbidden", "restart is only available from the local Aisets UI"))
		return
	}
	args, err := s.uiRestartHelperArgs()
	if err != nil {
		writeError(w, http.StatusInternalServerError, apierr.From(err, "restart_failed"))
		return
	}
	if err := startUIRestartHelper(args); err != nil {
		writeError(w, http.StatusInternalServerError, apierr.From(err, "restart_failed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "restarting": true})
	go func() {
		time.Sleep(250 * time.Millisecond)
		processExit(0)
	}()
}

func (s *Server) uiRestartHelperArgs() ([]string, error) {
	host, port, err := net.SplitHostPort(s.addr)
	if err != nil {
		return nil, fmt.Errorf("restart unavailable for server address %q: %w", s.addr, err)
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	args := []string{"__restart-ui", "--no-open", "--host", host, "--port", port, "--clear-cache"}
	if s.basePath != "" {
		args = append(args, "--base-path", s.basePath)
	}
	return args, nil
}

func defaultStartUIRestartHelper(args []string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, args...)
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Stdin = nil
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

func restartRequestAllowed(r *http.Request) bool {
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		return false
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		originHost, err := hostFromURL(origin)
		if err != nil || !sameHost(originHost, r.Host) {
			return false
		}
	}
	if r.RemoteAddr == "" {
		return true
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func hostFromURL(raw string) (string, error) {
	withoutScheme := raw
	if index := strings.Index(withoutScheme, "://"); index >= 0 {
		withoutScheme = withoutScheme[index+3:]
	}
	if slash := strings.Index(withoutScheme, "/"); slash >= 0 {
		withoutScheme = withoutScheme[:slash]
	}
	if withoutScheme == "" {
		return "", fmt.Errorf("empty origin host")
	}
	return withoutScheme, nil
}

func sameHost(a, b string) bool {
	ah, ap := splitHostPortDefault(a)
	bh, bp := splitHostPortDefault(b)
	return strings.EqualFold(ah, bh) && ap == bp
}

func splitHostPortDefault(value string) (string, string) {
	host, port, err := net.SplitHostPort(value)
	if err == nil {
		return host, port
	}
	if strings.Count(value, ":") == 1 {
		parts := strings.SplitN(value, ":", 2)
		if _, err := strconv.Atoi(parts[1]); err == nil {
			return parts[0], parts[1]
		}
	}
	return value, ""
}
