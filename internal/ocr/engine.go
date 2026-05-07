package ocr

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	_ "image/jpeg"
	"image/png"
	"os"
	"os/exec"
	"strings"
	"time"

	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	DefaultEngineName             = "tesseract-cli"
	assetStudioOCRPipelineVersion = "asset-studio-ocr-v2"
)

type AvailabilityChecker interface {
	Available(ctx context.Context) error
}

type TesseractCLIEngine struct {
	DataRoot string
	Binary   string
	version  string
}

func NewDefaultEngine(dataRoot string) TesseractCLIEngine {
	engine := TesseractCLIEngine{DataRoot: dataRoot, Binary: "tesseract"}
	engine.version = detectTesseractVersion(engine.Binary)
	return engine
}

func (e TesseractCLIEngine) Name() string {
	return DefaultEngineName
}

func (e TesseractCLIEngine) Version() string {
	version := e.version
	if e.version != "" {
		version = e.version
	} else {
		version = "unknown"
	}
	return version + " " + assetStudioOCRPipelineVersion
}

func (e TesseractCLIEngine) Available(ctx context.Context) error {
	binary := e.binary()
	if _, err := exec.LookPath(binary); err != nil {
		return fmt.Errorf("tesseract binary is not installed")
	}
	cmd := exec.CommandContext(ctx, binary, "--version")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("tesseract binary is not runnable: %w", err)
	}
	return nil
}

func (e TesseractCLIEngine) Extract(ctx context.Context, path string, languages []string) (Extraction, error) {
	start := time.Now()
	languages = InstalledLanguages(e.DataRoot, languages)
	if len(languages) == 0 {
		return Extraction{}, ErrNotInstalled
	}
	if err := e.Available(ctx); err != nil {
		return Extraction{}, err
	}

	attempts := []ocrAttempt{
		{Path: path, Mode: "default"},
		{Path: path, Mode: "psm_6_logo_light", PSM: "6", Preprocess: preprocessGameLogoText},
		{Path: path, Mode: "psm_11", PSM: "11", Preprocess: preprocessFullImage},
	}
	collected := []string{}
	modes := []string{}
	attemptCount := 0
	needsFallback := false
	for index, attempt := range attempts {
		select {
		case <-ctx.Done():
			return Extraction{}, ctx.Err()
		default:
		}
		attemptPath := attempt.Path
		cleanup := func() {}
		if attempt.Preprocess != nil {
			processedPath, remove, err := attempt.Preprocess(path)
			if err == nil {
				attemptPath = processedPath
				cleanup = remove
			}
		}
		text, err := e.extractOnce(ctx, attemptPath, languages, attempt.PSM)
		cleanup()
		if err != nil && index == 0 {
			return Extraction{}, err
		}
		attemptCount = index + 1
		if err != nil {
			continue
		}
		if NormalizeText(text) != "" {
			collected = appendUniqueOCRText(collected, text)
			modes = append(modes, attempt.Mode)
		}
		if index == 0 {
			needsFallback = needsOCRFallback(text)
			if !needsFallback {
				break
			}
		}
	}
	text := strings.Join(collected, "\n")
	return Extraction{
		Text:       text,
		Languages:  languages,
		Scripts:    DetectScripts(text),
		DurationMs: time.Since(start).Milliseconds(),
		Mode:       strings.Join(modes, "+"),
		Attempts:   attemptCount,
	}, nil
}

type ocrAttempt struct {
	Path       string
	Mode       string
	PSM        string
	Preprocess func(string) (string, func(), error)
}

func (e TesseractCLIEngine) extractOnce(ctx context.Context, path string, languages []string, psm string) (string, error) {
	args := []string{
		path,
		"stdout",
		"--tessdata-dir",
		DataDir(e.DataRoot),
		"-l",
		strings.Join(languages, "+"),
	}
	if psm != "" {
		args = append(args, "--psm", psm)
	}
	cmd := exec.CommandContext(ctx, e.binary(), args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("tesseract failed: %s", message)
	}
	return strings.TrimSpace(stdout.String()), nil
}

func appendUniqueOCRText(texts []string, next string) []string {
	normalizedNext := NormalizeText(next)
	for _, existing := range texts {
		if NormalizeText(existing) == normalizedNext {
			return texts
		}
	}
	return append(texts, next)
}

func needsOCRFallback(text string) bool {
	normalized := NormalizeText(text)
	if normalized == "" {
		return true
	}
	letters := 0
	total := 0
	for _, r := range normalized {
		if r == ' ' {
			continue
		}
		total++
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			letters++
		}
	}
	return total < 8 || letters*2 < total
}

func preprocessGameLogoText(path string) (string, func(), error) {
	return preprocessOCRImage(path, ocrCropGameLogoText, ocrThresholdBrightText)
}

func preprocessFullImage(path string) (string, func(), error) {
	return preprocessOCRImage(path, ocrCropFull, ocrThresholdInverted)
}

type ocrCropMode string
type ocrThresholdMode string

const (
	ocrCropFull         ocrCropMode = "full"
	ocrCropGameLogoText ocrCropMode = "game_logo_text"

	ocrThresholdInverted   ocrThresholdMode = "inverted"
	ocrThresholdBrightText ocrThresholdMode = "bright_text"
)

func preprocessOCRImage(path string, cropMode ocrCropMode, thresholdMode ocrThresholdMode) (string, func(), error) {
	file, err := os.Open(path)
	if err != nil {
		return "", nil, err
	}
	defer file.Close()
	img, _, err := image.Decode(file)
	if err != nil {
		return "", nil, err
	}
	bounds := img.Bounds()
	source := img
	if cropMode == ocrCropGameLogoText {
		top := bounds.Min.Y + (bounds.Dy() * 50 / 100)
		if top < bounds.Max.Y {
			source = cropImage(img, image.Rect(bounds.Min.X, top, bounds.Max.X, bounds.Max.Y))
		}
	}
	scale := 3
	if cropMode == ocrCropGameLogoText {
		scale = 5
	}
	dst := image.NewGray(image.Rect(0, 0, source.Bounds().Dx()*scale, source.Bounds().Dy()*scale))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), source, source.Bounds(), xdraw.Over, nil)
	binarizeForOCR(dst, thresholdMode)
	temp, err := os.CreateTemp("", "asset-studio-ocr-*.png")
	if err != nil {
		return "", nil, err
	}
	tempPath := temp.Name()
	if err := png.Encode(temp, dst); err != nil {
		_ = temp.Close()
		_ = os.Remove(tempPath)
		return "", nil, err
	}
	if err := temp.Close(); err != nil {
		_ = os.Remove(tempPath)
		return "", nil, err
	}
	return tempPath, func() { _ = os.Remove(tempPath) }, nil
}

func cropImage(img image.Image, rect image.Rectangle) image.Image {
	dst := image.NewRGBA(image.Rect(0, 0, rect.Dx(), rect.Dy()))
	xdraw.Draw(dst, dst.Bounds(), img, rect.Min, xdraw.Src)
	return dst
}

func binarizeForOCR(img *image.Gray, mode ocrThresholdMode) {
	var total int
	for _, value := range img.Pix {
		total += int(value)
	}
	mean := total / max(len(img.Pix), 1)
	threshold := ocrThreshold(img, mode, mean)
	for index, value := range img.Pix {
		switch mode {
		case ocrThresholdBrightText:
			if value > threshold {
				img.Pix[index] = color.Gray{Y: 255}.Y
			} else {
				img.Pix[index] = color.Gray{Y: 0}.Y
			}
		default:
			if value >= threshold {
				img.Pix[index] = color.Gray{Y: 0}.Y
			} else {
				img.Pix[index] = color.Gray{Y: 255}.Y
			}
		}
	}
}

func ocrThreshold(_ *image.Gray, mode ocrThresholdMode, mean int) uint8 {
	if mode == ocrThresholdBrightText {
		return 145
	}
	if mean > 155 {
		return 150
	}
	return 120
}

func (e TesseractCLIEngine) binary() string {
	if e.Binary != "" {
		return e.Binary
	}
	return "tesseract"
}

func detectTesseractVersion(binary string) string {
	if binary == "" {
		binary = "tesseract"
	}
	cmd := exec.Command(binary, "--version")
	out, err := cmd.Output()
	if err != nil {
		return "unavailable"
	}
	line := strings.TrimSpace(strings.SplitN(string(out), "\n", 2)[0])
	if line == "" {
		return "unknown"
	}
	return line
}
