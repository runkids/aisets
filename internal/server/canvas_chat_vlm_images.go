package server

import (
	"fmt"
	"image"
	"image/color"
	stddraw "image/draw"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"math"
	"os"

	"golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
)

func canvasCoordinateGridImage(localPath string) (string, func(), error) {
	f, err := os.Open(localPath)
	if err != nil {
		return "", func() {}, err
	}
	defer f.Close()

	src, _, err := image.Decode(f)
	if err != nil {
		return "", func() {}, err
	}
	bounds := src.Bounds()
	srcW := bounds.Dx()
	srcH := bounds.Dy()
	if srcW <= 0 || srcH <= 0 {
		return "", func() {}, fmt.Errorf("invalid image bounds")
	}

	longest := math.Max(float64(srcW), float64(srcH))
	targetLongest := math.Min(math.Max(longest, 512), 768)
	dstW := int(math.Round(float64(srcW) * targetLongest / longest))
	dstH := int(math.Round(float64(srcH) * targetLongest / longest))
	if dstW <= 0 || dstH <= 0 {
		return "", func() {}, fmt.Errorf("invalid grid image bounds")
	}

	dst := image.NewRGBA(image.Rect(0, 0, dstW, dstH))
	stddraw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, stddraw.Src)
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, bounds, draw.Over, nil)
	drawCanvasCoordinateGrid(dst)

	tmp, err := os.CreateTemp("", "aisets-canvas-grid-*.png")
	if err != nil {
		return "", func() {}, err
	}
	path := tmp.Name()
	if err := png.Encode(tmp, dst); err != nil {
		tmp.Close()
		os.Remove(path)
		return "", func() {}, err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(path)
		return "", func() {}, err
	}
	return path, func() { os.Remove(path) }, nil
}

func drawCanvasCoordinateGrid(dst *image.RGBA) {
	bounds := dst.Bounds()
	w := bounds.Dx()
	h := bounds.Dy()
	if w <= 0 || h <= 0 {
		return
	}
	minor := color.RGBA{R: 0, G: 210, B: 255, A: 210}
	major := color.RGBA{R: 255, G: 205, B: 0, A: 240}
	for i := 0; i <= 10; i++ {
		x := int(math.Round(float64(i) * float64(w-1) / 10))
		y := int(math.Round(float64(i) * float64(h-1) / 10))
		lineColor := minor
		thickness := 1
		if i == 0 || i == 5 || i == 10 {
			lineColor = major
			thickness = 2
		}
		fillCanvasRect(dst, image.Rect(x, 0, x+thickness, h), lineColor)
		fillCanvasRect(dst, image.Rect(0, y, w, y+thickness), lineColor)
		if i == 0 || i == 5 || i == 10 {
			label := fmt.Sprintf("%.1f", float64(i)/10)
			drawCanvasLabel(dst, x+3, 15, "x="+label)
			drawCanvasLabel(dst, 3, y+14, "y="+label)
		}
	}
}

func fillCanvasRect(dst *image.RGBA, rect image.Rectangle, c color.RGBA) {
	rect = rect.Intersect(dst.Bounds())
	if rect.Empty() {
		return
	}
	stddraw.Draw(dst, rect, image.NewUniform(c), image.Point{}, stddraw.Over)
}

func drawCanvasLabel(dst *image.RGBA, x int, y int, label string) {
	if x < 0 {
		x = 0
	}
	if y < 13 {
		y = 13
	}
	if x > dst.Bounds().Dx()-48 {
		x = dst.Bounds().Dx() - 48
	}
	if y > dst.Bounds().Dy()-2 {
		y = dst.Bounds().Dy() - 2
	}
	d := font.Drawer{
		Dst:  dst,
		Src:  image.NewUniform(color.RGBA{R: 255, G: 255, B: 255, A: 245}),
		Face: basicfont.Face7x13,
		Dot:  fixed.P(x, y),
	}
	d.DrawString(label)
}
