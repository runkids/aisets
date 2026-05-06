package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"asset-studio/internal/config"
	"asset-studio/internal/server"
	"asset-studio/internal/uidist"
)

func cmdUI(args []string, jsonModes ...bool) error {
	jsonOut := len(jsonModes) > 0 && jsonModes[0]
	fs := flag.NewFlagSet("ui", flag.ContinueOnError)
	if jsonOut {
		fs.SetOutput(io.Discard)
	}
	host := fs.String("host", "127.0.0.1", "host to bind")
	port := fs.Int("port", 19520, "port to bind")
	basePath := fs.String("base-path", envOrDefault("ASSET_STUDIO_UI_BASE_PATH", ""), "base path for reverse proxy hosting")
	noOpen := fs.Bool("no-open", false, "do not open the browser")
	clearCache := fs.Bool("clear-cache", false, "clear cached UI assets before starting")
	if err := fs.Parse(args); err != nil {
		return err
	}

	if *clearCache {
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
	if err := store.AddProjects(fs.Args()); err != nil {
		return err
	}

	addr := fmt.Sprintf("%s:%d", *host, *port)
	srv, err := server.New(server.Options{
		Addr:      addr,
		BasePath:  *basePath,
		Store:     store,
		UIDistDir: uiDir,
		Version:   version,
	})
	if err != nil {
		return err
	}

	url := fmt.Sprintf("http://%s", addr)
	if *basePath != "" {
		url += "/" + strings.Trim(*basePath, "/")
	}
	srv.SetOnReady(func() {
		fmt.Fprintf(os.Stderr, "Asset Studio UI: %s\n", url)
		if !*noOpen {
			_ = openBrowser(url)
		}
	})

	return srv.StartWithContext(context.Background())
}

func ensureUIAvailable() (string, error) {
	if version == "" || version == "dev" {
		return "", nil
	}
	if uidist.IsCached(version) {
		return uidist.CacheDir(version), nil
	}
	if err := uidist.Download(version); err != nil {
		return "", err
	}
	return uidist.CacheDir(version), nil
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
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
