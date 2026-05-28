package imageproc

import (
	"fmt"
	"image"
	"image/draw"
	"image/gif"
	"image/jpeg"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type TransformOptions struct {
	Flip          string
	RotateDegrees int
}

func TransformImage(inputPath, outputPath string, opts TransformOptions) error {
	normalized, err := normalizeTransformOptions(opts)
	if err != nil {
		return err
	}
	if err := transformViaImgtools(inputPath, outputPath, normalized); err != nil {
		if err := transformGoFallback(inputPath, outputPath, normalized); err != nil {
			return err
		}
	}
	return os.Chmod(outputPath, 0o644)
}

func normalizeTransformOptions(opts TransformOptions) (TransformOptions, error) {
	flip := strings.ToLower(strings.TrimSpace(opts.Flip))
	switch flip {
	case "", "none":
		flip = "none"
	case "horizontal", "h", "x", "mirror":
		flip = "horizontal"
	case "vertical", "v", "y":
		flip = "vertical"
	case "both", "xy", "yx":
		flip = "both"
	default:
		return TransformOptions{}, fmt.Errorf("unsupported flip mode: %s", opts.Flip)
	}

	rotation := ((opts.RotateDegrees % 360) + 360) % 360

	return TransformOptions{Flip: flip, RotateDegrees: rotation}, nil
}

func transformViaImgtools(inputPath, outputPath string, opts TransformOptions) error {
	return runImgtoolsExec(
		"transform",
		"--flip", opts.Flip,
		"--rotate", strconv.Itoa(opts.RotateDegrees),
		inputPath,
		outputPath,
	)
}

func transformGoFallback(inputPath, outputPath string, opts TransformOptions) error {
	img, err := decodeRaster(inputPath)
	if err != nil {
		return err
	}

	out := imageToNRGBA(img)
	switch opts.Flip {
	case "horizontal":
		out = flipHorizontalNRGBA(out)
	case "vertical":
		out = flipVerticalNRGBA(out)
	case "both":
		out = flipVerticalNRGBA(flipHorizontalNRGBA(out))
	}

	switch opts.RotateDegrees {
	case 90:
		out = rotate90NRGBA(out)
	case 180:
		out = rotate180NRGBA(out)
	case 270:
		out = rotate270NRGBA(out)
	case 0:
	default:
		out = rotateArbitraryNRGBA(out, opts.RotateDegrees)
	}

	return writeTransformedImage(outputPath, out)
}

func imageToNRGBA(src image.Image) *image.NRGBA {
	bounds := src.Bounds()
	dst := image.NewNRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	draw.Draw(dst, dst.Bounds(), src, bounds.Min, draw.Src)
	return dst
}

func flipHorizontalNRGBA(src *image.NRGBA) *image.NRGBA {
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	dst := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.SetNRGBA(w-1-x, y, src.NRGBAAt(x, y))
		}
	}
	return dst
}

func flipVerticalNRGBA(src *image.NRGBA) *image.NRGBA {
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	dst := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.SetNRGBA(x, h-1-y, src.NRGBAAt(x, y))
		}
	}
	return dst
}

func rotate90NRGBA(src *image.NRGBA) *image.NRGBA {
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	dst := image.NewNRGBA(image.Rect(0, 0, h, w))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.SetNRGBA(h-1-y, x, src.NRGBAAt(x, y))
		}
	}
	return dst
}

func rotate180NRGBA(src *image.NRGBA) *image.NRGBA {
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	dst := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.SetNRGBA(w-1-x, h-1-y, src.NRGBAAt(x, y))
		}
	}
	return dst
}

func rotate270NRGBA(src *image.NRGBA) *image.NRGBA {
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	dst := image.NewNRGBA(image.Rect(0, 0, h, w))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.SetNRGBA(y, w-1-x, src.NRGBAAt(x, y))
		}
	}
	return dst
}

func rotateArbitraryNRGBA(src *image.NRGBA, degrees int) *image.NRGBA {
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	radians := float64(degrees) * math.Pi / 180
	cos, sin := math.Cos(radians), math.Sin(radians)
	halfW, halfH := float64(w)/2, float64(h)/2
	corners := [][2]float64{
		{-halfW, -halfH},
		{halfW, -halfH},
		{-halfW, halfH},
		{halfW, halfH},
	}
	minX, maxX := math.Inf(1), math.Inf(-1)
	minY, maxY := math.Inf(1), math.Inf(-1)
	for _, corner := range corners {
		x := corner[0]*cos + corner[1]*sin
		y := -corner[0]*sin + corner[1]*cos
		minX = math.Min(minX, x)
		maxX = math.Max(maxX, x)
		minY = math.Min(minY, y)
		maxY = math.Max(maxY, y)
	}
	outW := int(math.Ceil(maxX - minX))
	outH := int(math.Ceil(maxY - minY))
	if outW <= 0 || outH <= 0 {
		return src
	}
	dst := image.NewNRGBA(image.Rect(0, 0, outW, outH))
	for y := 0; y < outH; y++ {
		for x := 0; x < outW; x++ {
			tx := float64(x) + 0.5 + minX
			ty := float64(y) + 0.5 + minY
			srcX := tx*cos - ty*sin + halfW
			srcY := tx*sin + ty*cos + halfH
			sx := int(math.Floor(srcX))
			sy := int(math.Floor(srcY))
			if sx < 0 || sx >= w || sy < 0 || sy >= h {
				continue
			}
			dst.SetNRGBA(x, y, src.NRGBAAt(sx, sy))
		}
	}
	return dst
}

func writeTransformedImage(outputPath string, img image.Image) error {
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		return err
	}
	out, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	defer out.Close()

	switch strings.ToLower(filepath.Ext(outputPath)) {
	case ".png":
		return png.Encode(out, img)
	case ".jpg", ".jpeg":
		return jpeg.Encode(out, img, &jpeg.Options{Quality: 90})
	case ".gif":
		return gif.Encode(out, img, nil)
	default:
		return fmt.Errorf("Go transform fallback cannot encode %s", filepath.Ext(outputPath))
	}
}
