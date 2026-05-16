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

var writePrivilegeRequired = binaryWriteRequiresPrivilege

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
	Privileged     bool   `json:"privileged,omitempty"`
	UICached       bool   `json:"uiCached"`
	UICacheError   string `json:"uiCacheError,omitempty"`
	Message        string `json:"message"`
}

type latestReleaseResponse struct {
	TagName string `json:"tag_name"`
}

type ElevatedPermissionError struct {
	Path string
}

func (e ElevatedPermissionError) Error() string {
	return fmt.Sprintf("elevated permissions are required to update %s", e.Path)
}

func Check(ctx context.Context, currentVersion string) (CheckResult, error) {
	currentVersion = normalizeVersion(currentVersion)
	if isDevVersion(currentVersion) {
		return CheckResult{
			CurrentVersion:  currentVersion,
			LatestVersion:   "0.1.1-dev",
			UpdateAvailable: true,
			DevMode:         true,
			UpgradeCommand:  "aisets update",
		}, nil
	}
	latest, err := FetchLatestVersion(ctx)
	if err != nil {
		return CheckResult{CurrentVersion: currentVersion, UpgradeCommand: "aisets update"}, nil
	}
	return CheckResult{
		CurrentVersion:  currentVersion,
		LatestVersion:   latest,
		UpdateAvailable: compareVersions(currentVersion, latest),
		UpgradeCommand:  "aisets update",
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
	if runtime.GOOS != "windows" && writePrivilegeRequired(execPath) {
		return UpgradeResult{CurrentVersion: currentVersion, LatestVersion: latest, Message: "Elevated permissions required"}, ElevatedPermissionError{Path: execPath}
	}
	if err := downloadAndReplaceBinary(ctx, latest, execPath); err != nil {
		return UpgradeResult{CurrentVersion: currentVersion, LatestVersion: latest, Message: "Update failed"}, err
	}
	return UpgradeResult{CurrentVersion: currentVersion, LatestVersion: latest, Updated: true, Message: "Updated. Restart Aisets to use the new version."}, nil
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
	return fmt.Sprintf("aisets_%s_%s_%s.%s", normalizeVersion(ver), goos, goarch, format)
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
	tmpArchive, err := os.CreateTemp("", "aisets-update-*")
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
	extracted, err := extractBinaries(tmpArchive.Name(), tmpArchive, runtime.GOOS)
	if err != nil {
		return err
	}
	defer os.Remove(extracted.binary)
	if extracted.imgtools != "" {
		defer os.Remove(extracted.imgtools)
		imgtoolsPath := filepath.Join(filepath.Dir(destPath), imgtoolsBinaryName(runtime.GOOS))
		imgtoolsMode := os.FileMode(0o755)
		if stat, err := os.Stat(imgtoolsPath); err == nil {
			imgtoolsMode = stat.Mode()
		}
		if err := os.Chmod(extracted.imgtools, imgtoolsMode); err != nil {
			return err
		}
		if err := replaceBinary(imgtoolsPath, extracted.imgtools); err != nil {
			return err
		}
	}
	mode := os.FileMode(0o755)
	if stat, err := os.Stat(destPath); err == nil {
		mode = stat.Mode()
	}
	if err := os.Chmod(extracted.binary, mode); err != nil {
		return err
	}
	return replaceBinary(destPath, extracted.binary)
}

func replaceBinary(destPath, tmpBinary string) error {
	if runtime.GOOS != "windows" {
		if err := os.Rename(tmpBinary, destPath); err != nil {
			return fmt.Errorf("replace binary: %w", err)
		}
		return nil
	}

	if _, err := os.Stat(destPath); os.IsNotExist(err) {
		if err := os.Rename(tmpBinary, destPath); err != nil {
			return fmt.Errorf("replace binary: %w", err)
		}
		return nil
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

func binaryWriteRequiresPrivilege(destPath string) bool {
	dir := filepath.Dir(destPath)
	file, err := os.CreateTemp(dir, ".aisets-update-check-*")
	if err != nil {
		return os.IsPermission(err)
	}
	name := file.Name()
	_ = file.Close()
	_ = os.Remove(name)
	return false
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

type extractedBinaries struct {
	binary   string
	imgtools string
}

func mainBinaryName(goos string) string {
	if goos == "windows" {
		return "aisets.exe"
	}
	return "aisets"
}

func imgtoolsBinaryName(goos string) string {
	if goos == "windows" {
		return "aisets-imgtools.exe"
	}
	return "aisets-imgtools"
}

func extractBinaries(name string, r io.ReaderAt, goos string) (extractedBinaries, error) {
	if goos == "windows" {
		return extractZipBinaries(name, r, goos)
	}
	return extractTarBinaries(r, goos)
}

func extractZipBinaries(name string, r io.ReaderAt, goos string) (extractedBinaries, error) {
	stat, err := os.Stat(name)
	if err != nil {
		return extractedBinaries{}, err
	}
	zr, err := zip.NewReader(r, stat.Size())
	if err != nil {
		return extractedBinaries{}, err
	}
	extracted := extractedBinaries{}
	for _, file := range zr.File {
		base := filepath.Base(file.Name)
		if base != mainBinaryName(goos) && base != imgtoolsBinaryName(goos) {
			continue
		}
		path, err := extractZipMember(file)
		if err != nil {
			return extractedBinaries{}, err
		}
		if base == mainBinaryName(goos) {
			extracted.binary = path
		} else {
			extracted.imgtools = path
		}
	}
	if extracted.binary == "" {
		return extractedBinaries{}, fmt.Errorf("%s not found in archive", mainBinaryName(goos))
	}
	return extracted, nil
}

func extractZipMember(file *zip.File) (string, error) {
	rc, err := file.Open()
	if err != nil {
		return "", err
	}
	defer rc.Close()
	return writeTempBinary(rc)
}

func extractTarBinaries(r io.ReaderAt, goos string) (extractedBinaries, error) {
	gz, err := gzip.NewReader(io.NewSectionReader(r, 0, 1<<63-1))
	if err != nil {
		return extractedBinaries{}, err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	extracted := extractedBinaries{}
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return extractedBinaries{}, err
		}
		base := filepath.Base(header.Name)
		if header.Typeflag != tar.TypeReg || (base != mainBinaryName(goos) && base != imgtoolsBinaryName(goos)) {
			continue
		}
		path, err := writeTempBinary(tr)
		if err != nil {
			return extractedBinaries{}, err
		}
		if base == mainBinaryName(goos) {
			extracted.binary = path
		} else {
			extracted.imgtools = path
		}
	}
	if extracted.binary == "" {
		return extractedBinaries{}, fmt.Errorf("%s not found in archive", mainBinaryName(goos))
	}
	return extracted, nil
}

func writeTempBinary(r io.Reader) (string, error) {
	file, err := os.CreateTemp("", "aisets-bin-*")
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
