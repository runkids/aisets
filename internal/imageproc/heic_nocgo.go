//go:build !cgo

package imageproc

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"path/filepath"
)

func decodeHEIC(path string) (image.Image, error) {
	data, err := heicToPNGSystem(path)
	if err != nil {
		return nil, fmt.Errorf("decode HEIC %s: %w", filepath.Base(path), err)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("decode HEIC %s: %w", filepath.Base(path), err)
	}
	return img, nil
}

func HeicToPNG(path string) ([]byte, error) {
	data, err := heicToPNGSystem(path)
	if err != nil {
		return nil, fmt.Errorf("decode HEIC %s: %w", filepath.Base(path), err)
	}
	return data, nil
}
