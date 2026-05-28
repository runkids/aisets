//go:build darwin || linux || freebsd || openbsd || netbsd

package imageproc

import (
	"image/color"
	"os"
	"path/filepath"
	"testing"
)

func TestTransformImageNormalizesPrecreatedOutputMode(t *testing.T) {
	root := t.TempDir()
	input := filepath.Join(root, "input.png")
	writePNG(t, input, solidImage(2, 2, color.NRGBA{R: 255, A: 255}))

	outputFile, err := os.CreateTemp(root, "output-*.png")
	if err != nil {
		t.Fatal(err)
	}
	output := outputFile.Name()
	if err := outputFile.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(output, 0o600); err != nil {
		t.Fatal(err)
	}

	if err := TransformImage(input, output, TransformOptions{Flip: "horizontal"}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(output)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o644 {
		t.Fatalf("mode = %04o, want 0644", got)
	}
}
