package imageproc

import (
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"os/exec"
	"strings"

	"aisets/internal/imgtools"

	"golang.org/x/image/draw"

	_ "image/gif"
	_ "image/jpeg"

	_ "golang.org/x/image/webp"
)

type CompositeItem struct {
	Path      string  `json:"path"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	FitWidth  float64 `json:"fitWidth"`
	FitHeight float64 `json:"fitHeight"`
}

type CompositeSpec struct {
	Width       int             `json:"width"`
	Height      int             `json:"height"`
	Transparent bool            `json:"transparent"`
	Items       []CompositeItem `json:"items"`
}

func CompositeCanvas(spec CompositeSpec, outputPath string) error {
	err := compositeViaImgtools(spec, outputPath)
	if err == nil {
		return nil
	}
	return compositeGoFallback(spec, outputPath)
}

func compositeViaImgtools(spec CompositeSpec, outputPath string) error {
	bin, err := imgtools.Binary()
	if err != nil {
		return err
	}

	specJSON, err := json.Marshal(spec)
	if err != nil {
		return fmt.Errorf("marshal composite spec: %w", err)
	}

	cmd := exec.Command(bin, "composite", "--output", outputPath)
	cmd.Stdin = strings.NewReader(string(specJSON))
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("imgtools composite: %w: %s", err, string(out))
	}
	return nil
}

func compositeGoFallback(spec CompositeSpec, outputPath string) error {
	var bg color.Color
	if spec.Transparent {
		bg = color.Transparent
	} else {
		bg = color.NRGBA{R: 0xff, G: 0xff, B: 0xff, A: 0xff}
	}

	canvas := image.NewNRGBA(image.Rect(0, 0, spec.Width, spec.Height))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{bg}, image.Point{}, draw.Src)

	for _, item := range spec.Items {
		f, err := os.Open(item.Path)
		if err != nil {
			continue
		}
		src, _, err := image.Decode(f)
		f.Close()
		if err != nil {
			continue
		}

		srcW := src.Bounds().Dx()
		srcH := src.Bounds().Dy()
		fitW := int(item.FitWidth)
		fitH := int(item.FitHeight)
		if srcW <= 0 || srcH <= 0 || fitW <= 0 || fitH <= 0 {
			continue
		}

		scaleX := float64(fitW) / float64(srcW)
		scaleY := float64(fitH) / float64(srcH)
		scale := scaleX
		if scaleY < scale {
			scale = scaleY
		}
		drawW := int(float64(srcW) * scale)
		drawH := int(float64(srcH) * scale)
		if drawW <= 0 || drawH <= 0 {
			continue
		}

		cx := int(item.X) + (fitW-drawW)/2
		cy := int(item.Y) + (fitH-drawH)/2

		destRect := image.Rect(cx, cy, cx+drawW, cy+drawH)
		draw.CatmullRom.Scale(canvas, destRect, src, src.Bounds(), draw.Over, nil)
	}

	out, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("create output: %w", err)
	}
	defer out.Close()
	return png.Encode(out, canvas)
}
