package imgtools

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
)

const binaryName = "aisets-imgtools"

var (
	resolveMu    sync.Mutex
	resolvedPath string
	resolvedErr  error
	resolvedOnce bool
	appVersion   = "dev"
)

func SetAppVersion(ver string) {
	resolveMu.Lock()
	defer resolveMu.Unlock()
	ver = normalizeAppVersion(ver)
	if appVersion == ver {
		return
	}
	appVersion = ver
	resolvedPath = ""
	resolvedErr = nil
	resolvedOnce = false
}

func Binary() (string, error) {
	resolveMu.Lock()
	defer resolveMu.Unlock()
	if resolvedOnce {
		return resolvedPath, resolvedErr
	}
	resolvedOnce = true
	path, err := resolve()
	if err != nil {
		resolvedErr = err
		return "", err
	}
	if err := exec.Command(path, "version").Run(); err != nil {
		resolvedErr = fmt.Errorf("%s found at %s but not executable: %w", binaryName, path, err)
		return "", resolvedErr
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
	if p, err := cachedBinary(); err == nil {
		return p, nil
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
	candidate := filepath.Join(filepath.Dir(exe), platformBinaryName())
	if _, err := os.Stat(candidate); err != nil {
		return "", err
	}
	return candidate, nil
}

func findInBinDir() (string, error) {
	candidate := filepath.Join("bin", platformBinaryName())
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
	name := platformBinaryName()
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
