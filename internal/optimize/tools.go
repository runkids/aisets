package optimize

import (
	"os/exec"

	"asset-studio/internal/imageproc"
	"asset-studio/internal/imgtools"
)

type ToolRuntime struct {
	ID         string   `json:"id"`
	Detected   bool     `json:"detected"`
	Path       string   `json:"path,omitempty"`
	Enabled    bool     `json:"enabled"`
	Operations []string `json:"operations"`
}

func ToolRuntimeStatus(settings []imageproc.OptimizationExternalTool) []ToolRuntime {
	enabled := map[string]bool{}
	for _, tool := range imageproc.DefaultOptimizationExternalTools() {
		enabled[tool.ID] = false
	}
	for _, tool := range settings {
		enabled[tool.ID] = tool.Enabled
	}
	out := []ToolRuntime{imgtoolsRuntime()}
	for _, tool := range imageproc.DefaultOptimizationExternalTools() {
		path, err := exec.LookPath(tool.ID)
		out = append(out, ToolRuntime{
			ID:         tool.ID,
			Detected:   err == nil,
			Path:       path,
			Enabled:    enabled[tool.ID],
			Operations: externalToolOperations(tool.ID),
		})
	}
	return out
}

func imgtoolsRuntime() ToolRuntime {
	path, err := imgtools.Binary()
	return ToolRuntime{
		ID:       "aisets-imgtools",
		Detected: err == nil && path != "",
		Path:     path,
		Enabled:  true,
		Operations: []string{
			"convert-avif",
			"convert-webp",
			"webp-recompress",
			"gif-optimize",
			"png-recompress",
			"jpeg-recompress",
			"resize-variant",
			"resize-replace",
			"probe",
			"thumbnail",
			"dhash",
		},
	}
}

func externalToolOperations(id string) []string {
	switch id {
	case "svgo":
		return []string{"svg-minify"}
	case "gifsicle":
		return []string{"gif-optimize"}
	case "ffmpeg":
		return []string{"gif-optimize", "convert-webp", "webp-recompress"}
	case "magick":
		return []string{"resize-variant", "resize-replace"}
	case "avifenc":
		return []string{"convert-avif"}
	case "cwebp":
		return []string{"convert-webp", "webp-recompress"}
	case "oxipng":
		return []string{"png-recompress"}
	default:
		return nil
	}
}
