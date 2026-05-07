package version

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

const githubAPIURL = "https://api.github.com/repos/" + repo + "/releases/latest"

var httpClient = http.DefaultClient

type CheckResult struct {
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion,omitempty"`
	UpdateAvailable bool   `json:"updateAvailable"`
	DevMode         bool   `json:"devMode"`
	UpgradeCommand  string `json:"upgradeCommand"`
}

type UpgradeOptions struct {
	CurrentVersion string
	DryRun         bool
	Force          bool
	ExecPath       string
}

type UpgradeResult struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion,omitempty"`
	Updated        bool   `json:"updated"`
	DryRun         bool   `json:"dryRun"`
	DevMode        bool   `json:"devMode"`
	Message        string `json:"message"`
}

type latestReleaseResponse struct {
	TagName string `json:"tag_name"`
}

func Check(ctx context.Context, currentVersion string) (CheckResult, error) {
	currentVersion = normalizeVersion(currentVersion)
	if isDevVersion(currentVersion) {
		return CheckResult{
			CurrentVersion:  currentVersion,
			LatestVersion:   "0.1.1-dev",
			UpdateAvailable: true,
			DevMode:         true,
			UpgradeCommand:  "asset-studio update",
		}, nil
	}
	latest, err := FetchLatestVersion(ctx)
	if err != nil {
		return CheckResult{CurrentVersion: currentVersion, UpgradeCommand: "asset-studio update"}, nil
	}
	return CheckResult{
		CurrentVersion:  currentVersion,
		LatestVersion:   latest,
		UpdateAvailable: compareVersions(currentVersion, latest),
		UpgradeCommand:  "asset-studio update",
	}, nil
}

func Upgrade(ctx context.Context, opts UpgradeOptions) (UpgradeResult, error) {
	currentVersion := normalizeVersion(opts.CurrentVersion)
	if isDevVersion(currentVersion) {
		return UpgradeResult{
			CurrentVersion: currentVersion,
			LatestVersion:  "0.1.1-dev",
			Updated:        true,
			DryRun:         opts.DryRun,
			DevMode:        true,
			Message:        "DEV mode update simulated",
		}, nil
	}
	latest, err := FetchLatestVersion(ctx)
	if err != nil {
		return UpgradeResult{CurrentVersion: currentVersion, Message: "version check failed"}, err
	}
	if !compareVersions(currentVersion, latest) && !opts.Force {
		return UpgradeResult{CurrentVersion: currentVersion, LatestVersion: latest, Message: "Already up to date"}, nil
	}
	if opts.DryRun {
		return UpgradeResult{CurrentVersion: currentVersion, LatestVersion: latest, DryRun: true, Message: "Would update"}, nil
	}
	execPath := opts.ExecPath
	if execPath == "" {
		var err error
		execPath, err = os.Executable()
		if err != nil {
			return UpgradeResult{}, fmt.Errorf("get executable path: %w", err)
		}
		if resolved, err := filepath.EvalSymlinks(execPath); err == nil {
			execPath = resolved
		}
	}
	if err := downloadAndReplaceBinary(ctx, latest, execPath); err != nil {
		return UpgradeResult{CurrentVersion: currentVersion, LatestVersion: latest, Message: "Update failed"}, err
	}
	return UpgradeResult{CurrentVersion: currentVersion, LatestVersion: latest, Updated: true, Message: "Updated. Restart Asset Studio to use the new version."}, nil
}

func FetchLatestVersion(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, githubAPIURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("accept", "application/vnd.github+json")
	client := httpClient
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("fetch latest release: %s", resp.Status)
	}
	var body latestReleaseResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return "", err
	}
	version := normalizeVersion(body.TagName)
	if version == "" {
		return "", fmt.Errorf("latest release tag is empty")
	}
	return version, nil
}

func BuildBinaryAssetName(ver, goos, goarch string) string {
	format := "tar.gz"
	if goos == "windows" {
		format = "zip"
	}
	return fmt.Sprintf("asset-studio_%s_%s_%s.%s", normalizeVersion(ver), goos, goarch, format)
}

func BuildBinaryDownloadURL(ver, goos, goarch string) string {
	return fmt.Sprintf("https://github.com/%s/releases/download/v%s/%s", repo, normalizeVersion(ver), BuildBinaryAssetName(ver, goos, goarch))
}

func compareVersions(current, latest string) bool {
	current = normalizeVersion(current)
	latest = normalizeVersion(latest)
	if isDevVersion(current) || latest == "" {
		return false
	}
	currentParts := strings.Split(current, ".")
	latestParts := strings.Split(latest, ".")
	maxLen := len(currentParts)
	if len(latestParts) > maxLen {
		maxLen = len(latestParts)
	}
	for i := 0; i < maxLen; i++ {
		var a, b int
		if i < len(currentParts) {
			a, _ = strconv.Atoi(numericPrefix(currentParts[i]))
		}
		if i < len(latestParts) {
			b, _ = strconv.Atoi(numericPrefix(latestParts[i]))
		}
		if a < b {
			return true
		}
		if a > b {
			return false
		}
	}
	return false
}

func numericPrefix(part string) string {
	for i, r := range part {
		if r < '0' || r > '9' {
			return part[:i]
		}
	}
	return part
}

func normalizeVersion(ver string) string {
	ver = strings.TrimSpace(ver)
	ver = strings.TrimPrefix(ver, "v")
	if ver == "" {
		return "dev"
	}
	return ver
}

func isDevVersion(ver string) bool {
	ver = strings.TrimSpace(ver)
	return ver == "" || ver == "dev" || strings.Contains(ver, "dev")
}

func downloadAndReplaceBinary(ctx context.Context, ver, destPath string) error {
	expected, err := fetchChecksumForAsset(ctx, ver, BuildBinaryAssetName(ver, runtime.GOOS, runtime.GOARCH))
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, BuildBinaryDownloadURL(ver, runtime.GOOS, runtime.GOARCH), nil)
	if err != nil {
		return err
	}
	client := httpClient
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download update: %s", resp.Status)
	}
	tmpArchive, err := os.CreateTemp("", "asset-studio-update-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmpArchive.Name())
	defer tmpArchive.Close()
	hash := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmpArchive, hash), io.LimitReader(resp.Body, 200<<20)); err != nil {
		return err
	}
	if actual := hex.EncodeToString(hash.Sum(nil)); actual != expected {
		return fmt.Errorf("checksum mismatch for %s", BuildBinaryAssetName(ver, runtime.GOOS, runtime.GOARCH))
	}
	if _, err := tmpArchive.Seek(0, io.SeekStart); err != nil {
		return err
	}
	tmpBinary, err := extractBinary(tmpArchive.Name(), tmpArchive, runtime.GOOS)
	if err != nil {
		return err
	}
	defer os.Remove(tmpBinary)
	mode := os.FileMode(0o755)
	if stat, err := os.Stat(destPath); err == nil {
		mode = stat.Mode()
	}
	if err := os.Chmod(tmpBinary, mode); err != nil {
		return err
	}
	backup := destPath + ".old"
	_ = os.Remove(backup)
	if err := os.Rename(destPath, backup); err != nil {
		return fmt.Errorf("prepare binary replacement: %w", err)
	}
	if err := os.Rename(tmpBinary, destPath); err != nil {
		_ = os.Rename(backup, destPath)
		return fmt.Errorf("replace binary: %w", err)
	}
	_ = os.Remove(backup)
	return nil
}

func fetchChecksumForAsset(ctx context.Context, ver, assetName string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, BuildChecksumsURL(ver), nil)
	if err != nil {
		return "", err
	}
	client := httpClient
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download checksums: %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(body), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && strings.TrimPrefix(fields[1], "*") == assetName {
			return fields[0], nil
		}
	}
	return "", fmt.Errorf("checksum for %s not found", assetName)
}

func extractBinary(name string, r io.ReaderAt, goos string) (string, error) {
	if goos == "windows" {
		stat, err := os.Stat(name)
		if err != nil {
			return "", err
		}
		zr, err := zip.NewReader(r, stat.Size())
		if err != nil {
			return "", err
		}
		for _, file := range zr.File {
			if filepath.Base(file.Name) != "asset-studio.exe" {
				continue
			}
			rc, err := file.Open()
			if err != nil {
				return "", err
			}
			defer rc.Close()
			return writeTempBinary(rc)
		}
		return "", fmt.Errorf("asset-studio.exe not found in archive")
	}
	gz, err := gzip.NewReader(io.NewSectionReader(r, 0, 1<<63-1))
	if err != nil {
		return "", err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			return "", fmt.Errorf("asset-studio not found in archive")
		}
		if err != nil {
			return "", err
		}
		if header.Typeflag == tar.TypeReg && filepath.Base(header.Name) == "asset-studio" {
			return writeTempBinary(tr)
		}
	}
}

func writeTempBinary(r io.Reader) (string, error) {
	file, err := os.CreateTemp("", "asset-studio-bin-*")
	if err != nil {
		return "", err
	}
	path := file.Name()
	_, copyErr := io.Copy(file, r)
	closeErr := file.Close()
	if copyErr != nil {
		_ = os.Remove(path)
		return "", copyErr
	}
	if closeErr != nil {
		_ = os.Remove(path)
		return "", closeErr
	}
	return path, nil
}
