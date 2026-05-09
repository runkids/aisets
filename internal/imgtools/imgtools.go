package imgtools

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
)

const binaryName = "aisets-imgtools"

var (
	resolveMu    sync.Mutex
	resolvedPath string
)

func Binary() (string, error) {
	resolveMu.Lock()
	defer resolveMu.Unlock()
	if resolvedPath != "" {
		return resolvedPath, nil
	}
	path, err := resolve()
	if err != nil {
		return "", err
	}
	resolvedPath = path
	return resolvedPath, nil
}

func Available() bool {
	p, err := Binary()
	return err == nil && p != ""
}

func resolve() (string, error) {
	if len(embeddedBinary) > 0 {
		if p, err := extractToCache(); err == nil {
			return p, nil
		}
	}
	if p, err := findNextToExe(); err == nil {
		return p, nil
	}
	if p, err := findInBinDir(); err == nil {
		return p, nil
	}
	if p, err := exec.LookPath(binaryName); err == nil {
		return p, nil
	}
	return "", fmt.Errorf("%s not found: run 'make imgtools-install' or build with -tags embed_imgtools", binaryName)
}

func findNextToExe() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	candidate := filepath.Join(filepath.Dir(exe), binaryName)
	if runtime.GOOS == "windows" {
		candidate += ".exe"
	}
	if _, err := os.Stat(candidate); err != nil {
		return "", err
	}
	return candidate, nil
}

func findInBinDir() (string, error) {
	candidate := filepath.Join("bin", binaryName)
	if runtime.GOOS == "windows" {
		candidate += ".exe"
	}
	abs, err := filepath.Abs(candidate)
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(abs); err != nil {
		return "", err
	}
	return abs, nil
}

func extractToCache() (string, error) {
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(cacheDir, "aisets")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	name := binaryName
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	target := filepath.Join(dir, name)
	info, err := os.Stat(target)
	if err == nil && info.Size() == int64(len(embeddedBinary)) {
		return target, nil
	}
	if err := os.WriteFile(target, embeddedBinary, 0o755); err != nil {
		return "", err
	}
	return target, nil
}
