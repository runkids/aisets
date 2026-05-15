package server

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"aisets/internal/scanner"
)

const canvasCatalogMaxRequestedCount = 18

var (
	canvasCatalogSearchTerms    = []string{"search", "find", "show", "list", "catalog"}
	canvasCatalogAddTerms       = []string{"add", "include", "put", "place", "import"}
	canvasCatalogLayoutTerms    = []string{"row", "line", "grid"}
	canvasCatalogStopTerms      = canvasBuildCatalogStopTerms()
	canvasCatalogTermExpansions = map[string][]string{
		"logo":     {"mark", "symbol", "icon", "badge", "emblem", "brand", "favicon"},
		"logos":    {"logo", "mark", "symbol", "icon", "badge", "emblem", "brand", "favicon"},
		"logotype": {"logo", "mark", "symbol", "icon", "badge", "emblem", "brand", "favicon"},
	}

	canvasRequestedArabicCountRe = regexp.MustCompile(`(?i)(\d+)\s*(copies|copy|cards|items)?`)
	canvasEnglishCounts          = map[string]int{"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9}
)

func canvasBuildCatalogStopTerms() map[string]bool {
	stopTerms := map[string]bool{}
	for _, terms := range [][]string{
		canvasCatalogSearchTerms,
		canvasCatalogAddTerms,
		canvasCatalogLayoutTerms,
		canvasVisualMoveTerms,
		{"selected", "selection", "all"},
	} {
		for _, term := range terms {
			stopTerms[strings.ToLower(term)] = true
		}
	}
	for _, term := range []string{
		"asset", "assets", "image", "images", "item", "items", "file", "files", "relevant", "related", "most", "best",
		"canvas", "board", "to", "the", "a", "an", "and", "or", "with", "of", "in", "on",
	} {
		stopTerms[strings.ToLower(term)] = true
	}
	return stopTerms
}

func refineCanvasSearchActions(actions []canvasAction, latestUserMessage string) []canvasAction {
	count := canvasRequestedCount(latestUserMessage)
	refined := make([]canvasAction, 0, len(actions))
	for _, act := range actions {
		if act.Tool != "search_assets" {
			refined = append(refined, act)
			continue
		}
		clone := act
		clone.Params = cloneCanvasActionParams(act.Params)
		if count > 0 {
			clone.Params["limit"] = float64(count)
		}
		if canvasSearchActionRequestsOCRText(clone) {
			clone.Params["hasText"] = true
		}
		refined = append(refined, clone)
	}
	return refined
}

func canvasSearchActionRequestsOCRText(act canvasAction) bool {
	hasText, _ := act.Params["hasText"].(bool)
	if hasText {
		return true
	}
	q, _ := act.Params["q"].(string)
	return canvasSearchTextQueryIsGeneric(q)
}

func canvasRequestedCount(text string) int {
	if match := canvasRequestedArabicCountRe.FindStringSubmatch(text); len(match) > 1 {
		count, err := strconv.Atoi(match[1])
		if err == nil {
			return canvasClampRequestedCount(count)
		}
	}
	for _, token := range canvasCatalogSearchTextTokens(text) {
		if count, ok := canvasEnglishCounts[strings.ToLower(token)]; ok {
			return canvasClampRequestedCount(count)
		}
	}
	return 0
}

func canvasClampRequestedCount(count int) int {
	if count < 0 {
		return 0
	}
	if count > canvasCatalogMaxRequestedCount {
		return canvasCatalogMaxRequestedCount
	}
	return count
}

func canvasCatalogSearchQueryCandidates(text string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(value string) {
		value = strings.ToLower(strings.TrimSpace(value))
		value = strings.Trim(value, `"'“”‘’`)
		if value == "" || seen[value] || canvasCatalogStopTerms[value] {
			return
		}
		if _, err := strconv.Atoi(value); err == nil {
			return
		}
		seen[value] = true
		out = append(out, value)
	}

	for _, match := range regexp.MustCompile(`["“”']([^"“”']{1,80})["“”']`).FindAllStringSubmatch(text, -1) {
		if len(match) > 1 {
			add(match[1])
		}
	}

	cleaned := strings.ToLower(text)
	for _, terms := range [][]string{
		canvasCatalogSearchTerms,
		canvasCatalogAddTerms,
		canvasCatalogLayoutTerms,
	} {
		for _, term := range terms {
			cleaned = strings.ReplaceAll(cleaned, strings.ToLower(term), " ")
		}
	}
	for _, marker := range []string{
		",", ".", ":", ";", "!", "?", "/", "\\", "|", "(", ")", "[", "]", "{", "}",
		" and ", " or ",
	} {
		cleaned = strings.ReplaceAll(cleaned, marker, " ")
	}

	for _, token := range canvasCatalogSearchTextTokens(cleaned) {
		add(token)
	}
	return out
}

func expandCanvasCatalogSearchCandidates(candidates []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(candidates))
	add := func(value string) {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		out = append(out, value)
	}
	for _, candidate := range candidates {
		add(candidate)
		for _, token := range canvasCatalogSearchQueryCandidates(candidate) {
			for _, expanded := range canvasCatalogTermExpansions[token] {
				add(expanded)
			}
		}
	}
	return out
}

func canvasAdditionalCatalogSearchCandidates(candidates []string) []string {
	base := map[string]bool{}
	for _, candidate := range candidates {
		base[strings.ToLower(strings.TrimSpace(candidate))] = true
	}
	var out []string
	for _, candidate := range expandCanvasCatalogSearchCandidates(candidates) {
		if base[candidate] {
			continue
		}
		out = append(out, candidate)
	}
	return out
}

func canvasSemanticSearchNeedsUserConfirmation(query string, items []scanner.AssetItem) bool {
	queryTerms := canvasCatalogSearchQueryCandidates(query)
	if len(queryTerms) == 0 || len(queryTerms) > 2 || len(items) == 0 {
		return false
	}
	for _, item := range items {
		if canvasCatalogSearchItemScore(item, queryTerms) > 0 {
			return false
		}
	}
	return true
}

func canvasCatalogSearchTextTokens(text string) []string {
	var tokens []string
	var b strings.Builder
	flush := func() {
		if b.Len() == 0 {
			return
		}
		tokens = append(tokens, b.String())
		b.Reset()
	}
	for _, r := range strings.ToLower(text) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '-' {
			b.WriteRune(r)
			continue
		}
		flush()
	}
	flush()

	var cjk strings.Builder
	flushCJK := func() {
		if cjk.Len() == 0 {
			return
		}
		chunk := cjk.String()
		cjk.Reset()
		for stop := range canvasCatalogStopTerms {
			if stop == "" || canvasRuneLen(stop) > canvasRuneLen(chunk) {
				continue
			}
			chunk = strings.ReplaceAll(chunk, stop, " ")
		}
		for _, part := range strings.Fields(chunk) {
			tokens = append(tokens, part)
		}
	}
	for _, r := range strings.ToLower(text) {
		if r > unicode.MaxASCII && (unicode.IsLetter(r) || unicode.IsNumber(r)) {
			cjk.WriteRune(r)
			continue
		}
		flushCJK()
	}
	flushCJK()
	return tokens
}

func canvasRankCatalogSearchItems(items []scanner.AssetItem, query string) []scanner.AssetItem {
	queryTerms := canvasCatalogSearchQueryCandidates(query)
	if len(items) == 0 || len(queryTerms) == 0 {
		return items
	}
	type scoredItem struct {
		item  scanner.AssetItem
		score int
		index int
	}
	scored := make([]scoredItem, 0, len(items))
	for index, item := range items {
		scored = append(scored, scoredItem{
			item:  item,
			score: canvasCatalogSearchItemScore(item, queryTerms),
			index: index,
		})
	}
	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].score != scored[j].score {
			return scored[i].score > scored[j].score
		}
		return scored[i].index < scored[j].index
	})
	out := make([]scanner.AssetItem, 0, len(scored))
	for _, item := range scored {
		out = append(out, item.item)
	}
	return out
}

func canvasCatalogSearchItemScore(item scanner.AssetItem, queryTerms []string) int {
	fields := canvasCatalogSearchItemFields(item)
	score := 0
	for _, query := range queryTerms {
		best := 0
		for _, field := range fields {
			if fieldScore := canvasCatalogSearchFieldScore(query, field); fieldScore > best {
				best = fieldScore
			}
		}
		score += best
	}
	return score
}

func canvasCatalogSearchItemFields(item scanner.AssetItem) []string {
	var fields []string
	add := func(values ...string) {
		for _, value := range values {
			value = strings.TrimSpace(value)
			if value != "" {
				fields = append(fields, value)
			}
		}
	}
	add(item.ID, item.RepoPath, strings.TrimSuffix(filepathBase(item.RepoPath), filepathExt(item.RepoPath)), item.ProjectName)
	if item.AITag != nil {
		add(item.AITag.Category, item.AITag.Description)
		add(item.AITag.Tags...)
		for _, value := range item.AITag.CategoryI18n {
			add(value)
		}
		for _, tags := range item.AITag.TagsI18n {
			add(tags...)
		}
		for _, value := range item.AITag.DescriptionI18n {
			add(value)
		}
	}
	if item.OCR != nil {
		add(item.OCR.Text)
	}
	return fields
}

func canvasMentionedCardIDsForPrompt(text string, canvas canvasSnapshot) map[string]bool {
	queryTerms := canvasCatalogSearchQueryCandidates(text)
	if len(queryTerms) == 0 {
		return nil
	}
	mentioned := map[string]bool{}
	for _, card := range canvas.Cards {
		if !canvasCardCanBeVisuallyArranged(card) {
			continue
		}
		score := canvasCardSearchScore(card, queryTerms)
		if score > 0 {
			mentioned[card.ID] = true
		}
	}
	if len(mentioned) == 0 || len(mentioned) > max(8, len(canvas.Cards)/2) {
		return nil
	}
	return mentioned
}

func canvasCardCanBeVisuallyArranged(card canvasCardSnapshot) bool {
	if strings.TrimSpace(card.ID) == "" {
		return false
	}
	switch card.Kind {
	case "asset", "upload", "variant", "proposal":
		return true
	default:
		return false
	}
}

func canvasCardSearchScore(card canvasCardSnapshot, queryTerms []string) int {
	fields := []string{card.ID, card.UploadFileName, card.Text}
	if card.Asset != nil {
		fields = append(fields,
			card.Asset.ID,
			card.Asset.RepoPath,
			strings.Join(card.Asset.Tags, " "),
			card.Asset.Description,
			card.Asset.OcrText,
			canvasAssetSearchText(card.Asset),
		)
	}
	score := 0
	for _, query := range queryTerms {
		best := 0
		for _, field := range fields {
			if fieldScore := canvasCatalogSearchFieldScore(query, field); fieldScore > best {
				best = fieldScore
			}
		}
		score += best
	}
	return score
}

func canvasCatalogSearchFieldScore(query string, field string) int {
	query = strings.ToLower(strings.TrimSpace(query))
	field = strings.ToLower(strings.TrimSpace(field))
	if query == "" || field == "" {
		return 0
	}
	if query == field {
		return 100
	}
	for _, token := range canvasCatalogSearchTextTokens(field) {
		if query == token {
			return 70
		}
	}
	if canvasRuneLen(query) > 1 && strings.Contains(field, query) {
		return 12
	}
	if canvasRuneLen(query) == 1 && strings.Contains(field, query) {
		return 4
	}
	return 0
}

func filepathBase(path string) string {
	path = strings.ReplaceAll(path, "\\", "/")
	if i := strings.LastIndex(path, "/"); i >= 0 {
		return path[i+1:]
	}
	return path
}

func filepathExt(path string) string {
	base := filepathBase(path)
	if i := strings.LastIndex(base, "."); i >= 0 {
		return base[i:]
	}
	return ""
}

func canvasAssetSearchText(asset *canvasAssetSnapshot) string {
	if asset == nil {
		return ""
	}
	var text strings.Builder
	write := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if text.Len() > 0 {
			text.WriteByte(' ')
		}
		text.WriteString(value)
	}
	write(asset.SearchCategory)
	write(strings.Join(asset.SearchTags, " "))
	write(asset.SearchDescription)
	for _, value := range asset.SearchCategoryI18n {
		write(value)
	}
	for _, tags := range asset.SearchTagsI18n {
		write(strings.Join(tags, " "))
	}
	for _, value := range asset.SearchDescriptionI18n {
		write(value)
	}
	return text.String()
}

func canvasRuneLen(value string) int {
	count := 0
	for range value {
		count++
	}
	return count
}
