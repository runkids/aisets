package version

import "testing"

func TestBuildReleaseAssetURLs(t *testing.T) {
	if got := BuildUIDistURL("1.2.3"); got != "https://github.com/runkids/aisets/releases/download/v1.2.3/aisets-ui-dist.tar.gz" {
		t.Fatalf("BuildUIDistURL() = %q", got)
	}
	if got := BuildChecksumsURL("1.2.3"); got != "https://github.com/runkids/aisets/releases/download/v1.2.3/checksums.txt" {
		t.Fatalf("BuildChecksumsURL() = %q", got)
	}
	if got := BuildBinaryAssetName("v1.2.3", "darwin", "arm64"); got != "aisets_1.2.3_darwin_arm64.tar.gz" {
		t.Fatalf("BuildBinaryAssetName() = %q", got)
	}
	if got := BuildBinaryDownloadURL("1.2.3", "windows", "amd64"); got != "https://github.com/runkids/aisets/releases/download/v1.2.3/aisets_1.2.3_windows_amd64.zip" {
		t.Fatalf("BuildBinaryDownloadURL() = %q", got)
	}
}

func TestCheckDevModeUsesFakeUpdate(t *testing.T) {
	result, err := Check(t.Context(), "dev")
	if err != nil {
		t.Fatal(err)
	}
	if !result.DevMode || !result.UpdateAvailable || result.LatestVersion != "0.1.1-dev" {
		t.Fatalf("Check(dev) = %#v", result)
	}
}

func TestCompareVersions(t *testing.T) {
	if !compareVersions("1.2.3", "1.2.4") {
		t.Fatal("expected patch update")
	}
	if compareVersions("1.2.3", "1.2.3") {
		t.Fatal("same version should not update")
	}
	if compareVersions("dev", "9.9.9") {
		t.Fatal("dev version should not compare as update")
	}
}
