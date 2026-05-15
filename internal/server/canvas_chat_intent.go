package server

var (
	canvasVisualResizeTerms    = []string{"resize", "bigger", "larger", "smaller"}
	canvasVisualMoveTerms      = []string{"move", "position", "beside", "nearby", "empty space", "away"}
	canvasVisualDuplicateTerms = []string{"duplicate", "copy", "clone"}
)

func canvasMessageWantsVisualResize(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage, canvasVisualResizeTerms...)
}

func canvasMessageWantsVisualMove(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage, canvasVisualMoveTerms...)
}

func canvasMessageWantsVisualDuplicate(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage, canvasVisualDuplicateTerms...)
}

func canvasToolIsCatalogSearchWork(tool string) bool {
	switch tool {
	case "search_assets", "add_assets_to_canvas", "get_asset_detail":
		return true
	default:
		return false
	}
}
