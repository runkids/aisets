package imageproc

import "testing"

func TestExtractEXIF_NonJPEG(t *testing.T) {
	// PNG files don't contain EXIF — imgtools will fail (not available in test),
	// then Go fallback skips non-JPEG/TIFF extensions.
	result, _ := ExtractEXIF("/nonexistent/sample.png")
	if result.HasEXIF {
		t.Error("PNG should not have EXIF")
	}
}

func TestExtractEXIF_MissingFile(t *testing.T) {
	// Missing JPEG file — imgtools fails, Go fallback can't open file, returns empty.
	result, _ := ExtractEXIF("/nonexistent/file.jpg")
	if result.HasEXIF {
		t.Error("missing file should not have EXIF")
	}
}
