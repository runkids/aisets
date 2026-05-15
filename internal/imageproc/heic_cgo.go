//go:build cgo

package imageproc

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"

	"github.com/jdeng/goheif"
)

func decodeHEIC(path string) (image.Image, error) {
	if data, err := heicToPNGSystem(path); err == nil {
		return png.Decode(bytes.NewReader(data))
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, err := goheif.Decode(f)
	if err != nil {
		return nil, fmt.Errorf("decode HEIC %s: %w", filepath.Base(path), err)
	}
	return img, nil
}

func HeicToPNG(path string) ([]byte, error) {
	if data, err := heicToPNGSystem(path); err == nil {
		return data, nil
	}
	img, err := decodeHEIC(path)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("encode png: %w", err)
	}
	return buf.Bytes(), nil
}
