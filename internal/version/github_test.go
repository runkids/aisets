package version

import "testing"

func TestBuildReleaseAssetURLs(t *testing.T) {
	if got := BuildUIDistURL("1.2.3"); got != "https://github.com/runkids/asset-studio/releases/download/v1.2.3/asset-studio-ui-dist.tar.gz" {
		t.Fatalf("BuildUIDistURL() = %q", got)
	}
	if got := BuildChecksumsURL("1.2.3"); got != "https://github.com/runkids/asset-studio/releases/download/v1.2.3/checksums.txt" {
		t.Fatalf("BuildChecksumsURL() = %q", got)
	}
}
