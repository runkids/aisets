package scanner

import (
	"testing"

	"aisets/internal/imageproc"
)

func TestLintEXIFGPSPrivacy(t *testing.T) {
	lat, lon := 35.6762, 139.6503
	items := []AssetItem{{
		ID:         "a1",
		ProjectID:  "p1",
		RepoPath:   "photo.jpg",
		ScanIntent: ProjectScanIntentCode,
		EXIF:       &imageproc.EXIFData{HasEXIF: true, GPSLatitude: &lat, GPSLongitude: &lon},
	}}
	findings := runLint(nil, items)
	found := false
	for _, f := range findings {
		if f.RuleID == "exif-gps-privacy" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected exif-gps-privacy finding for code project with GPS")
	}
}

func TestLintEXIFGPSSkipsAssetPack(t *testing.T) {
	lat, lon := 35.6762, 139.6503
	items := []AssetItem{{
		ID:         "a1",
		ProjectID:  "p1",
		RepoPath:   "photo.jpg",
		ScanIntent: ProjectScanIntentAssetPack,
		EXIF:       &imageproc.EXIFData{HasEXIF: true, GPSLatitude: &lat, GPSLongitude: &lon},
	}}
	findings := runLint(nil, items)
	for _, f := range findings {
		if f.RuleID == "exif-gps-privacy" {
			t.Error("asset packs should not trigger GPS privacy lint")
		}
	}
}

func TestLintEXIFNoGPS(t *testing.T) {
	items := []AssetItem{{
		ID:         "a1",
		ProjectID:  "p1",
		RepoPath:   "photo.jpg",
		ScanIntent: ProjectScanIntentCode,
		EXIF:       &imageproc.EXIFData{HasEXIF: true, CameraMake: "Canon"},
	}}
	findings := runLint(nil, items)
	for _, f := range findings {
		if f.RuleID == "exif-gps-privacy" {
			t.Error("should not trigger without GPS")
		}
	}
}
