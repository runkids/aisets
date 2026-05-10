package config

import (
	"path/filepath"
	"testing"

	"aisets/internal/imageproc"
	"aisets/internal/scanner"
)

func TestRecordAndEnrichEXIF(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	lat, lon := 35.6762, 139.6503
	catalog := scanner.Catalog{
		Projects: []scanner.Project{{ID: "p1", Name: "test", Path: root}},
		Items: []scanner.AssetItem{{
			ID: "a1", ProjectID: "p1", ProjectName: "test", RepoPath: "photo.jpg",
			LocalPath: filepath.Join(root, "photo.jpg"), Ext: ".jpg", Bytes: 1000,
			ContentHash: "abc", HashAlgorithm: "sha256",
			EXIF: &imageproc.EXIFData{
				HasEXIF: true, GPSLatitude: &lat, GPSLongitude: &lon,
				CameraMake: "Canon", CameraModel: "EOS R5",
				DateTimeOriginal: "2026-03-15T14:30:00", Orientation: 1, DPIX: 300, DPIY: 300,
			},
		}},
	}
	scanID, err := store.RecordScan(catalog)
	if err != nil {
		t.Fatalf("RecordScan: %v", err)
	}
	results, err := store.CatalogEXIFEnrich(scanID, []string{"a1"})
	if err != nil {
		t.Fatalf("CatalogEXIFEnrich: %v", err)
	}
	exif := results["a1"]
	if exif == nil {
		t.Fatal("expected EXIF data for a1")
	}
	if !exif.HasEXIF {
		t.Error("expected HasEXIF=true")
	}
	if exif.GPSLatitude == nil || *exif.GPSLatitude != 35.6762 {
		t.Errorf("GPS lat: got %v", exif.GPSLatitude)
	}
	if exif.CameraMake != "Canon" {
		t.Errorf("camera make: got %q", exif.CameraMake)
	}
	if exif.DPIX != 300 {
		t.Errorf("DPI X: got %d", exif.DPIX)
	}
}

func TestEXIFFacetCounts(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	lat, lon := 35.6762, 139.6503
	catalog := scanner.Catalog{
		Projects: []scanner.Project{{ID: "p1", Name: "test", Path: root}},
		Items: []scanner.AssetItem{
			{ID: "a1", ProjectID: "p1", ProjectName: "test", RepoPath: "photo.jpg",
				LocalPath: filepath.Join(root, "photo.jpg"), Ext: ".jpg", Bytes: 1000,
				ContentHash: "abc", HashAlgorithm: "sha256",
				EXIF: &imageproc.EXIFData{HasEXIF: true, GPSLatitude: &lat, GPSLongitude: &lon, CameraMake: "Canon"}},
			{ID: "a2", ProjectID: "p1", ProjectName: "test", RepoPath: "icon.png",
				LocalPath: filepath.Join(root, "icon.png"), Ext: ".png", Bytes: 500,
				ContentHash: "def", HashAlgorithm: "sha256"},
		},
	}
	scanID, err := store.RecordScan(catalog)
	if err != nil {
		t.Fatalf("RecordScan: %v", err)
	}
	facets, err := store.CatalogEXIFFacetCounts(scanID, "", "")
	if err != nil {
		t.Fatalf("facets: %v", err)
	}
	if facets.HasGPS != 1 {
		t.Errorf("HasGPS: got %d", facets.HasGPS)
	}
	if facets.HasCamera != 1 {
		t.Errorf("HasCamera: got %d", facets.HasCamera)
	}
}
