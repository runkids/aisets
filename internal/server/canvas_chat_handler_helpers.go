package server

import (
	"encoding/json"
	"strings"

	"aisets/internal/config"
	"aisets/internal/scanner"
)

func canvasArrangeAddedCatalogItemsAction(items []scanner.AssetItem) canvasAction {
	const (
		cols   = 4
		startX = 100
		startY = 100
		gapX   = 380
		gapY   = 340
	)
	positions := make([]any, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		if item.ID == "" || seen[item.ID] {
			continue
		}
		seen[item.ID] = true
		index := len(positions)
		positions = append(positions, map[string]any{
			"cardId": item.ID,
			"x":      float64(startX + (index%cols)*gapX),
			"y":      float64(startY + (index/cols)*gapY),
		})
	}
	return canvasAction{
		Tool:        "arrange_cards",
		Params:      map[string]any{"positions": positions},
		Description: "Arrange newly added catalog assets",
		Impact:      "Places newly added cards into a scannable layout on the canvas",
	}
}

func canvasActionExecutionKey(act canvasAction) string {
	tool := strings.TrimSpace(act.Tool)
	if tool == "" {
		return ""
	}
	params, err := json.Marshal(canvasActionStreamParams(act.Params))
	if err != nil {
		return tool
	}
	return tool + ":" + string(params)
}

func splitParagraphs(text string) []string {
	raw := strings.Split(text, "\n\n")
	var result []string
	for _, p := range raw {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	if len(result) == 0 && text != "" {
		return []string{text}
	}
	return result
}

func (s *Server) latestScanID() int64 {
	scan, err := s.store.LatestScan()
	if err != nil {
		return 0
	}
	return scan.ID
}

func (s *Server) canvasStrategyPrompt() string {
	presets, err := s.store.ListPromptPresets("canvas")
	if err != nil {
		return config.DefaultCanvasPrompt()
	}
	for _, preset := range presets {
		if preset.IsDefault {
			return config.FormatPrompt(preset.Content)
		}
	}
	if len(presets) > 0 {
		return config.FormatPrompt(presets[0].Content)
	}
	return config.DefaultCanvasPrompt()
}
