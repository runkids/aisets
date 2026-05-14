package server

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"aisets/internal/scanner"
)

const (
	canvasFallbackResizeScale           = 1.35
	canvasFallbackResizeMinDelta        = 80
	canvasFallbackResizeMaxWidth        = 640
	canvasFallbackArrangeGapNormal      = 180
	canvasFallbackArrangeGapNearby      = 120
	canvasFallbackArrangeGapEmptySpace  = 220
	canvasFallbackArrangePairXOffset    = 60
	canvasFallbackArrangeCardGapY       = 120
	canvasFallbackDuplicateColumnOffset = 460
	canvasFallbackDefaultCardWidth      = 320
	canvasFallbackDefaultCardHeight     = 240
	canvasFallbackMaxTargets            = 3
	canvasFallbackMaxDuplicateCount     = 12
)

var (
	canvasFallbackResizeTerms        = []string{"放大", "變大", "变大", "縮小", "缩小", "resize", "bigger", "larger", "smaller"}
	canvasFallbackMoveTerms          = []string{"移動", "移动", "放到", "移到", "擺", "摆", "旁邊", "旁边", "空的地方", "空位", "空白", "move", "position", "beside", "nearby", "empty space", "away"}
	canvasFallbackDuplicateTerms     = []string{"複製", "复制", "拷貝", "拷贝", "duplicate", "copy", "clone"}
	canvasFallbackRotateTerms        = []string{"旋轉", "旋转", "rotate"}
	canvasFallbackMirrorTerms        = []string{"鏡像", "镜像", "翻轉", "翻转", "mirror", "flip"}
	canvasFallbackPreviousTerms      = []string{"也", "同樣", "同样", "一起", "also", "same", "them"}
	canvasFallbackSelectionTerms     = []string{"選取", "選中", "selected", "selection", "全部", "所有", "all"}
	canvasFallbackMultiTargetTerms   = []string{" and ", " both ", "和", "與", "与", "跟", "及", "以及"}
	canvasFallbackNearbyTerms        = []string{"不要太遠", "不用太遠", "旁邊", "旁边", "nearby", "beside", "not too far"}
	canvasFallbackEmptyTerms         = []string{"空的地方", "空位", "空白", "empty space"}
	canvasFallbackCatalogSearchTerms = []string{
		"search", "find", "show", "list", "catalog",
		"搜尋", "搜索", "查找", "找", "找出", "列出", "顯示", "显示",
	}
	canvasFallbackCatalogAddTerms = []string{
		"add", "include", "put", "place", "import",
		"加入", "新增", "添加", "放到", "加到", "匯入", "导入",
	}
	canvasFallbackCatalogLayoutTerms = []string{
		"row", "line", "grid",
		"一列", "一排", "橫排", "横排", "排成", "排列",
	}
	canvasFallbackCatalogStopTerms = canvasFallbackBuildCatalogStopTerms()

	canvasFallbackArabicCountRe = regexp.MustCompile(`(?i)(\d+)\s*(張|张|個|个|份|copies|copy|cards|items)?`)
	canvasFallbackCJKCounts     = map[rune]int{'一': 1, '二': 2, '兩': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}
	canvasFallbackEnglishCounts = map[string]int{"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9}
	canvasFallbackStopTerms     = canvasFallbackBuildStopTerms()
)

func canvasFallbackClauseBreakTerms() []string {
	terms := make([]string, 0, len(canvasFallbackDuplicateTerms)+len(canvasFallbackRotateTerms)+len(canvasFallbackMirrorTerms))
	terms = append(terms, canvasFallbackDuplicateTerms...)
	terms = append(terms, canvasFallbackRotateTerms...)
	terms = append(terms, canvasFallbackMirrorTerms...)
	return terms
}

func canvasFallbackBuildStopTerms() map[string]bool {
	stopTerms := map[string]bool{}
	for _, terms := range [][]string{
		canvasFallbackResizeTerms,
		canvasFallbackMoveTerms,
		canvasFallbackDuplicateTerms,
		canvasFallbackRotateTerms,
		canvasFallbackMirrorTerms,
		canvasFallbackPreviousTerms,
	} {
		for _, term := range terms {
			stopTerms[strings.ToLower(term)] = true
		}
	}
	for _, term := range []string{
		"把", "有", "一", "隻", "只", "張", "张", "個", "个", "份", "到", "的", "是", "和", "然後", "然后",
		"空", "處理", "处理", "the", "a", "an", "to", "and", "with", "of",
	} {
		stopTerms[strings.ToLower(term)] = true
	}
	return stopTerms
}

func canvasFallbackBuildCatalogStopTerms() map[string]bool {
	stopTerms := map[string]bool{}
	for _, terms := range [][]string{
		canvasFallbackCatalogSearchTerms,
		canvasFallbackCatalogAddTerms,
		canvasFallbackCatalogLayoutTerms,
		canvasFallbackMoveTerms,
		canvasFallbackSelectionTerms,
	} {
		for _, term := range terms {
			stopTerms[strings.ToLower(term)] = true
		}
	}
	for _, term := range []string{
		"asset", "assets", "image", "images", "item", "items", "file", "files", "relevant", "related", "most", "best",
		"canvas", "board", "to", "the", "a", "an", "and", "or", "with", "of", "in", "on",
		"素材", "圖片", "图像", "圖片", "影像", "檔案", "文件", "畫布", "画布", "相關", "相关", "最相關", "最相关",
		"把", "將", "将", "幫", "帮", "我", "的", "是", "有", "和", "或", "到", "成", "排", "張", "张", "個", "个", "份",
	} {
		stopTerms[strings.ToLower(term)] = true
	}
	return stopTerms
}

type canvasFallbackCardTarget struct {
	Card    canvasCardSnapshot
	Aliases []string
	Score   int
}

type canvasFallbackClause struct {
	Text      string
	Resize    bool
	Move      bool
	Duplicate bool
	Rotate    bool
	Mirror    bool
}

func fallbackCanvasManipulationActions(latestUserMessage string, canvas canvasSnapshot, confirmedCardIDs []string) []canvasAction {
	if !canvasUserWantsCanvasAction(latestUserMessage) {
		return nil
	}
	clauses := canvasFallbackClauses(latestUserMessage)
	if len(clauses) == 0 {
		return nil
	}

	var actions []canvasAction
	mentionedTargets := canvasMentionedActionTargetCardIDs(latestUserMessage, canvas)
	lastTargets := canvasFallbackFilterTargetsByMentioned(
		canvasFallbackTargetsForCardIDs(canvas, confirmedCardIDs),
		mentionedTargets,
	)
	resizedWidths := map[string]float64{}
	for _, clause := range clauses {
		targets := canvasFallbackIntentTargets(clause.Text, canvas)
		if len(targets) > 0 && !clause.Resize && !clause.Move && !clause.Duplicate && !clause.Rotate && !clause.Mirror {
			if canvasFallbackClauseKeepsMultipleTargets(clause.Text) {
				if mentioned := canvasMentionedActionTargetCardIDs(clause.Text, canvas); len(mentioned) > 0 {
					if filtered := canvasFallbackFilterTargetsByMentioned(targets, mentioned); len(filtered) > 0 {
						targets = filtered
					}
				}
				lastTargets = targets
			} else {
				lastTargets = canvasFallbackMostRecentTargets(clause.Text, targets, lastTargets)
			}
			continue
		}
		if len(targets) > 0 && !clause.Rotate && !clause.Mirror {
			lastTargets = targets
		}
		if len(targets) == 0 && canvasFallbackClauseCanUseConfirmedTargets(clause) {
			targets = lastTargets
		}
		if len(targets) == 0 && canvasFallbackClauseTargetsSelection(clause.Text) {
			targets = canvasFallbackFilterTargetsByMentioned(
				canvasFallbackSelectedTargets(canvas),
				mentionedTargets,
			)
		}

		if clause.Resize && len(targets) > 0 {
			if target, ok := canvasFallbackResizeTarget(clause.Text, targets); ok {
				width := canvasFallbackResizeWidth(target.Card)
				if width > canvasCardDisplayWidth(target.Card) {
					resizedWidths[target.Card.ID] = width
					actions = append(actions, canvasAction{
						Tool:        "resize_card",
						Params:      map[string]any{"cardId": target.Card.ID, "width": width},
						Description: "Resize the confirmed target card",
						Impact:      "Makes the target visually larger on the canvas",
					})
				}
			}
		}
		if clause.Move && len(targets) > 0 {
			positions := canvasFallbackArrangePositions(clause.Text, canvas, targets, resizedWidths, 0)
			if len(positions) > 0 {
				actions = append(actions, canvasAction{
					Tool:        "arrange_cards",
					Params:      map[string]any{"positions": positions},
					Description: "Move the confirmed target cards to nearby empty space",
					Impact:      "Places the target cards outside the crowded cluster without changing source files",
				})
			}
		}
		if clause.Duplicate && len(targets) > 0 {
			cardIDs := canvasFallbackTargetCardIDs(targets)
			count := canvasFallbackDuplicateCount(clause.Text, len(cardIDs))
			if len(cardIDs) > 0 && count > 0 {
				actions = append(actions, canvasAction{
					Tool: "duplicate_cards",
					Params: map[string]any{
						"cardIds": cardIDs,
						"count":   float64(count),
						"layout":  "empty-space",
						"label":   "Duplicate the confirmed cards and place the copies in empty space",
					},
					Description: "Duplicate the confirmed cards",
					Impact:      "Creates visual copies on the canvas without modifying source files",
				})
			}
		}
		if clause.Rotate {
			if action, ok := canvasFallbackImageVariantAction("rotate_image", targets); ok {
				actions = append(actions, action)
			}
		}
		if clause.Mirror {
			if action, ok := canvasFallbackImageVariantAction("mirror_image", targets); ok {
				actions = append(actions, action)
			}
		}
	}
	return actions
}

func canvasFallbackClauseKeepsMultipleTargets(text string) bool {
	return containsAnyText(text, canvasFallbackMultiTargetTerms...)
}

func canvasFallbackMostRecentTargets(text string, targets []canvasFallbackCardTarget, referenceTargets []canvasFallbackCardTarget) []canvasFallbackCardTarget {
	if len(targets) <= 1 {
		return targets
	}
	lower := strings.ToLower(text)
	bestIndex := -1
	var out []canvasFallbackCardTarget
	for _, target := range targets {
		targetIndex := -1
		for _, alias := range target.Aliases {
			alias = strings.ToLower(strings.TrimSpace(alias))
			if alias == "" {
				continue
			}
			if idx := strings.LastIndex(lower, alias); idx > targetIndex {
				targetIndex = idx
			}
		}
		if targetIndex < 0 {
			continue
		}
		if targetIndex > bestIndex {
			bestIndex = targetIndex
			out = out[:0]
		}
		if targetIndex == bestIndex {
			out = append(out, target)
		}
	}
	if len(out) == 0 {
		return targets
	}
	if len(out) > 1 {
		out = canvasFallbackNearestTargets(out, referenceTargets)
	}
	return out
}

func canvasFallbackNearestTargets(targets []canvasFallbackCardTarget, referenceTargets []canvasFallbackCardTarget) []canvasFallbackCardTarget {
	if len(targets) <= 1 || len(referenceTargets) == 0 {
		return targets
	}
	bestDistance := 0.0
	var out []canvasFallbackCardTarget
	for _, target := range targets {
		distance := canvasFallbackNearestDistance(target.Card, referenceTargets)
		if len(out) == 0 || distance < bestDistance {
			bestDistance = distance
			out = out[:0]
		}
		if distance == bestDistance {
			out = append(out, target)
		}
	}
	return out
}

func canvasFallbackNearestDistance(card canvasCardSnapshot, referenceTargets []canvasFallbackCardTarget) float64 {
	cardX := card.X + canvasCardDisplayWidth(card)/2
	cardY := card.Y + canvasCardDisplayHeight(card)/2
	best := 0.0
	for index, reference := range referenceTargets {
		refX := reference.Card.X + canvasCardDisplayWidth(reference.Card)/2
		refY := reference.Card.Y + canvasCardDisplayHeight(reference.Card)/2
		dx := cardX - refX
		dy := cardY - refY
		distance := dx*dx + dy*dy
		if index == 0 || distance < best {
			best = distance
		}
	}
	return best
}

func refineCanvasSearchActions(actions []canvasAction, latestUserMessage string) []canvasAction {
	count := canvasFallbackRequestedCount(latestUserMessage)
	if count <= 0 {
		return actions
	}
	refined := make([]canvasAction, 0, len(actions))
	for _, act := range actions {
		if act.Tool != "search_assets" {
			refined = append(refined, act)
			continue
		}
		clone := act
		clone.Params = cloneCanvasActionParams(act.Params)
		clone.Params["limit"] = float64(count)
		refined = append(refined, clone)
	}
	return refined
}

func fallbackCanvasCatalogSearchAction(latestUserMessage string, selectedSkillIDs []string) (canvasAction, bool) {
	if !canvasSkillIDsContain(selectedSkillIDs, canvasSkillSearch) && !containsAnyText(latestUserMessage, canvasFallbackCatalogSearchTerms...) {
		return canvasAction{}, false
	}
	candidates := canvasCatalogSearchQueryCandidates(latestUserMessage)
	if len(candidates) == 0 {
		return canvasAction{}, false
	}
	limit := canvasFallbackRequestedCount(latestUserMessage)
	if limit <= 0 {
		limit = 6
	}
	if limit > 18 {
		limit = 18
	}
	return canvasAction{
		Tool: "search_assets",
		Params: map[string]any{
			"q":     candidates[0],
			"limit": float64(limit),
		},
		Description: "Search the catalog for the requested assets",
		Impact:      "Returns matching catalog assets so they can be added to the canvas",
	}, true
}

func canvasSkillIDsContain(ids []string, want string) bool {
	for _, id := range ids {
		if id == want {
			return true
		}
	}
	return false
}

func canvasToolIsCatalogSearchWork(tool string) bool {
	switch tool {
	case "search_assets", "add_assets_to_canvas", "get_asset_detail":
		return true
	default:
		return false
	}
}

func canvasFallbackFilterTargetsByMentioned(targets []canvasFallbackCardTarget, mentioned map[string]bool) []canvasFallbackCardTarget {
	if len(targets) == 0 || len(mentioned) == 0 {
		return targets
	}
	out := make([]canvasFallbackCardTarget, 0, len(targets))
	for _, target := range targets {
		if mentioned[target.Card.ID] {
			out = append(out, target)
		}
	}
	return out
}

func canvasFallbackClauses(latestUserMessage string) []canvasFallbackClause {
	normalized := strings.NewReplacer(
		"。", "\n",
		"，", "\n",
		"；", "\n",
		";", "\n",
	).Replace(latestUserMessage)
	for _, term := range canvasFallbackClauseBreakTerms() {
		normalized = canvasFallbackBreakBeforeTerm(normalized, term)
	}

	raw := strings.Split(normalized, "\n")
	clauses := make([]canvasFallbackClause, 0, len(raw))
	for _, item := range raw {
		text := strings.TrimSpace(item)
		if text == "" {
			continue
		}
		clause := canvasFallbackClause{
			Text:      text,
			Resize:    canvasMessageWantsVisualResize(text),
			Move:      canvasMessageWantsVisualMove(text),
			Duplicate: canvasMessageWantsVisualDuplicate(text),
			Rotate:    containsAnyText(text, canvasFallbackRotateTerms...),
			Mirror:    containsAnyText(text, canvasFallbackMirrorTerms...),
		}
		if clause.Resize || clause.Move || clause.Duplicate || clause.Rotate || clause.Mirror || len(canvasFallbackQueryTerms(text)) > 0 {
			clauses = append(clauses, clause)
		}
	}
	return clauses
}

func canvasFallbackBreakBeforeTerm(text string, term string) string {
	lower := strings.ToLower(text)
	lowerTerm := strings.ToLower(term)
	var b strings.Builder
	start := 0
	search := 0
	for {
		idx := strings.Index(lower[search:], lowerTerm)
		if idx < 0 {
			break
		}
		idx += search
		breakAt := canvasFallbackActionBreakIndex(text, start, idx)
		if breakAt > 0 && text[breakAt-1] != '\n' {
			b.WriteString(text[start:breakAt])
			b.WriteByte('\n')
			start = breakAt
		}
		search = idx + len(term)
	}
	b.WriteString(text[start:])
	return b.String()
}

func canvasFallbackActionBreakIndex(text string, start int, actionIndex int) int {
	breakAt := actionIndex
	segment := text[start:actionIndex]
	for _, marker := range []string{"把", "將", "将"} {
		markerIndex := strings.LastIndex(segment, marker)
		if markerIndex > 0 {
			breakAt = start + markerIndex
			break
		}
	}
	return breakAt
}

func canvasMessageWantsVisualResize(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage, canvasFallbackResizeTerms...)
}

func canvasMessageWantsVisualMove(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage, canvasFallbackMoveTerms...)
}

func canvasMessageWantsVisualDuplicate(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage, canvasFallbackDuplicateTerms...)
}

func canvasFallbackClauseCanUsePrevious(clause canvasFallbackClause) bool {
	return containsAnyText(clause.Text, canvasFallbackPreviousTerms...)
}

func canvasFallbackClauseCanUseConfirmedTargets(clause canvasFallbackClause) bool {
	if clause.Resize || clause.Move || clause.Duplicate {
		return true
	}
	return canvasFallbackClauseCanUsePrevious(clause)
}

func canvasFallbackIntentTargets(text string, canvas canvasSnapshot) []canvasFallbackCardTarget {
	queryTerms := canvasFallbackQueryTerms(text)
	if len(queryTerms) == 0 {
		return nil
	}
	var targets []canvasFallbackCardTarget
	for _, card := range canvas.Cards {
		if !canvasCardCanBeVisuallyArranged(card) {
			continue
		}
		score, aliases := canvasFallbackCardScore(card, queryTerms)
		if score <= 0 {
			continue
		}
		targets = append(targets, canvasFallbackCardTarget{Card: card, Aliases: aliases, Score: score})
	}
	sort.SliceStable(targets, func(i, j int) bool {
		return targets[i].Score > targets[j].Score
	})
	if len(targets) > canvasFallbackMaxTargets {
		targets = targets[:canvasFallbackMaxTargets]
	}
	return targets
}

func canvasFallbackMergeTargets(first []canvasFallbackCardTarget, second []canvasFallbackCardTarget) []canvasFallbackCardTarget {
	merged := make([]canvasFallbackCardTarget, 0, len(first)+len(second))
	seen := map[string]bool{}
	add := func(target canvasFallbackCardTarget) {
		if target.Card.ID == "" || seen[target.Card.ID] {
			return
		}
		seen[target.Card.ID] = true
		merged = append(merged, target)
	}
	for _, target := range first {
		add(target)
	}
	for _, target := range second {
		add(target)
	}
	return merged
}

func canvasFallbackQueryTerms(text string) []string {
	terms := canvasFallbackTextTokens(text)
	seen := map[string]bool{}
	var out []string
	add := func(term string) {
		term = strings.ToLower(strings.TrimSpace(term))
		if term == "" || seen[term] || canvasFallbackStopTerm(term) {
			return
		}
		seen[term] = true
		out = append(out, term)
	}
	for _, term := range terms {
		add(term)
	}
	return out
}

func canvasCatalogSearchQueryCandidates(text string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(value string) {
		value = strings.ToLower(strings.TrimSpace(value))
		value = strings.Trim(value, `"'“”‘’`)
		if value == "" || seen[value] || canvasFallbackCatalogStopTerms[value] {
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
		canvasFallbackCatalogSearchTerms,
		canvasFallbackCatalogAddTerms,
		canvasFallbackCatalogLayoutTerms,
	} {
		for _, term := range terms {
			cleaned = strings.ReplaceAll(cleaned, strings.ToLower(term), " ")
		}
	}
	for _, marker := range []string{
		",", ".", ":", ";", "!", "?", "，", "。", "：", "；", "！", "？", "、", "/", "\\", "|", "(", ")", "[", "]", "{", "}",
		" and ", " or ", " 或 ", " 和 ", " 跟 ", " 與 ", " 与 ",
	} {
		cleaned = strings.ReplaceAll(cleaned, marker, " ")
	}

	for _, token := range canvasCatalogSearchTextTokens(cleaned) {
		add(token)
	}
	return out
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
		for stop := range canvasFallbackCatalogStopTerms {
			if stop == "" || canvasFallbackRuneLen(stop) > canvasFallbackRuneLen(chunk) {
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
	if len(queryTerms) == 0 {
		queryTerms = canvasFallbackQueryTerms(query)
	}
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
	if canvasFallbackRuneLen(query) > 1 && strings.Contains(field, query) {
		return 12
	}
	if canvasFallbackRuneLen(query) == 1 && strings.Contains(field, query) {
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

func canvasFallbackTextTokens(text string) []string {
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
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			continue
		}
		flush()
	}
	flush()
	for _, r := range text {
		if r > unicode.MaxASCII && (unicode.IsLetter(r) || unicode.IsNumber(r)) {
			tokens = append(tokens, string(r))
		}
	}
	return tokens
}

func canvasFallbackStopTerm(term string) bool {
	return canvasFallbackStopTerms[strings.ToLower(strings.TrimSpace(term))]
}

func canvasFallbackSelectedTargets(canvas canvasSnapshot) []canvasFallbackCardTarget {
	if len(canvas.SelectedCardIDs) == 0 {
		return nil
	}
	selected := map[string]bool{}
	for _, id := range canvas.SelectedCardIDs {
		selected[strings.TrimSpace(id)] = true
	}
	var targets []canvasFallbackCardTarget
	for _, card := range canvas.Cards {
		if !selected[card.ID] || !canvasCardCanBeVisuallyArranged(card) {
			continue
		}
		targets = append(targets, canvasFallbackCardTarget{Card: card})
	}
	return targets
}

func canvasFallbackTargetsForCardIDs(canvas canvasSnapshot, cardIDs []string) []canvasFallbackCardTarget {
	if len(cardIDs) == 0 {
		return nil
	}
	want := map[string]bool{}
	for _, id := range cardIDs {
		id = strings.TrimSpace(id)
		if id != "" {
			want[id] = true
		}
	}
	var targets []canvasFallbackCardTarget
	seen := map[string]bool{}
	for _, card := range canvas.Cards {
		if !want[card.ID] || seen[card.ID] || !canvasCardCanBeVisuallyArranged(card) {
			continue
		}
		seen[card.ID] = true
		targets = append(targets, canvasFallbackCardTarget{Card: card, Score: 1})
	}
	return targets
}

func canvasFallbackClauseTargetsSelection(text string) bool {
	return containsAnyText(text, canvasFallbackSelectionTerms...)
}

func canvasFallbackCardScore(card canvasCardSnapshot, queryTerms []string) (int, []string) {
	cardTerms := canvasFallbackCardTerms(card)
	score := 0
	var matched []string
	seen := map[string]bool{}
	for _, query := range queryTerms {
		for _, term := range cardTerms {
			if query == "" || term == "" {
				continue
			}
			if canvasFallbackTermMatches(query, term) {
				score++
				if !seen[query] {
					seen[query] = true
					matched = append(matched, query)
				}
				break
			}
		}
	}
	return score, matched
}

func canvasFallbackTermMatches(query string, term string) bool {
	query = strings.ToLower(strings.TrimSpace(query))
	term = strings.ToLower(strings.TrimSpace(term))
	if query == "" || term == "" {
		return false
	}
	if query == term {
		return true
	}
	if canvasFallbackRuneLen(query) <= 1 || canvasFallbackRuneLen(term) <= 1 {
		return false
	}
	return strings.Contains(term, query) || strings.Contains(query, term)
}

func canvasFallbackRuneLen(value string) int {
	count := 0
	for range value {
		count++
	}
	return count
}

func canvasFallbackCardTerms(card canvasCardSnapshot) []string {
	var text strings.Builder
	text.WriteString(card.ID)
	text.WriteByte(' ')
	text.WriteString(card.UploadFileName)
	if card.Asset != nil {
		text.WriteByte(' ')
		text.WriteString(card.Asset.ID)
		text.WriteByte(' ')
		text.WriteString(card.Asset.RepoPath)
		text.WriteByte(' ')
		text.WriteString(strings.Join(card.Asset.Tags, " "))
		text.WriteByte(' ')
		text.WriteString(card.Asset.Description)
		text.WriteByte(' ')
		text.WriteString(card.Asset.OcrText)
		text.WriteByte(' ')
		text.WriteString(canvasAssetSearchText(card.Asset))
	}
	return canvasFallbackTextTokens(text.String())
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

func canvasFallbackResizeTarget(latestUserMessage string, targets []canvasFallbackCardTarget) (canvasFallbackCardTarget, bool) {
	if len(targets) == 0 {
		return canvasFallbackCardTarget{}, false
	}
	best := targets[0]
	bestDistance := int(^uint(0) >> 1)
	for _, target := range targets {
		if len(target.Aliases) == 0 {
			continue
		}
		distance := canvasFallbackTermDistance(latestUserMessage, target.Aliases, canvasFallbackResizeTerms)
		if distance < bestDistance {
			best = target
			bestDistance = distance
		}
	}
	return best, true
}

func canvasFallbackTermDistance(text string, aliases []string, terms []string) int {
	text = strings.ToLower(text)
	best := int(^uint(0) >> 1)
	for _, alias := range aliases {
		aliasIndex := strings.Index(text, strings.ToLower(alias))
		if aliasIndex < 0 {
			continue
		}
		for _, term := range terms {
			termIndex := strings.Index(text, strings.ToLower(term))
			if termIndex < 0 {
				continue
			}
			distance := aliasIndex - termIndex
			if distance < 0 {
				distance = -distance
			}
			if distance < best {
				best = distance
			}
		}
	}
	return best
}

func canvasFallbackResizeWidth(card canvasCardSnapshot) float64 {
	current := canvasCardDisplayWidth(card)
	width := current * canvasFallbackResizeScale
	if width < current+canvasFallbackResizeMinDelta {
		width = current + canvasFallbackResizeMinDelta
	}
	if width > canvasFallbackResizeMaxWidth {
		width = canvasFallbackResizeMaxWidth
	}
	return canvasRoundCoord(width)
}

func canvasFallbackArrangePositions(latestUserMessage string, canvas canvasSnapshot, targets []canvasFallbackCardTarget, resizedWidths map[string]float64, columnOffset float64) []any {
	if len(targets) == 0 {
		return nil
	}
	gap := float64(canvasFallbackArrangeGapNormal)
	if containsAnyText(latestUserMessage, canvasFallbackNearbyTerms...) {
		gap = canvasFallbackArrangeGapNearby
	}
	if containsAnyText(latestUserMessage, canvasFallbackEmptyTerms...) {
		gap = canvasFallbackArrangeGapEmptySpace
	}
	x := canvasRoundCoord(canvasFallbackTargetMaxX(targets) + gap + columnOffset)
	y := canvasRoundCoord(canvasFallbackTargetMinY(targets))
	x = canvasFallbackAvoidOverlapX(x, y, canvas, targets, resizedWidths, gap)
	var positions []any
	for i, target := range targets {
		width := canvasCardDisplayWidth(target.Card)
		height := canvasCardDisplayHeight(target.Card)
		if resizedWidth, ok := resizedWidths[target.Card.ID]; ok && width > 0 {
			height = height * (resizedWidth / width)
		}
		cardX := x
		if i > 0 && len(targets) == 2 {
			cardX = x + canvasFallbackArrangePairXOffset
		}
		positions = append(positions, map[string]any{
			"cardId": target.Card.ID,
			"x":      canvasRoundCoord(cardX),
			"y":      canvasRoundCoord(y),
		})
		y += height + canvasFallbackArrangeCardGapY
	}
	return positions
}

func canvasFallbackAvoidOverlapX(x float64, y float64, canvas canvasSnapshot, targets []canvasFallbackCardTarget, resizedWidths map[string]float64, gap float64) float64 {
	targetIDs := map[string]bool{}
	for _, target := range targets {
		if target.Card.ID != "" {
			targetIDs[target.Card.ID] = true
		}
	}
	for attempt := 0; attempt < 24; attempt++ {
		overlapRight := 0.0
		for _, box := range canvasFallbackStackBoxes(x, y, targets, resizedWidths) {
			for _, card := range canvas.Cards {
				if targetIDs[card.ID] || !canvasCardCanBeVisuallyArranged(card) {
					continue
				}
				cardBox := canvasFallbackRect{
					X:      card.X,
					Y:      card.Y,
					Width:  canvasCardDisplayWidth(card),
					Height: canvasCardDisplayHeight(card),
				}
				if canvasFallbackRectsOverlap(box, cardBox) && cardBox.X+cardBox.Width > overlapRight {
					overlapRight = cardBox.X + cardBox.Width
				}
			}
		}
		if overlapRight == 0 {
			return canvasRoundCoord(x)
		}
		x = canvasRoundCoord(overlapRight + gap)
	}
	return canvasRoundCoord(x)
}

type canvasFallbackRect struct {
	X      float64
	Y      float64
	Width  float64
	Height float64
}

func canvasFallbackStackBoxes(x float64, y float64, targets []canvasFallbackCardTarget, resizedWidths map[string]float64) []canvasFallbackRect {
	boxes := make([]canvasFallbackRect, 0, len(targets))
	stackY := y
	for i, target := range targets {
		width := canvasCardDisplayWidth(target.Card)
		height := canvasCardDisplayHeight(target.Card)
		if resizedWidth, ok := resizedWidths[target.Card.ID]; ok && width > 0 {
			height = height * (resizedWidth / width)
			width = resizedWidth
		}
		cardX := x
		if i > 0 && len(targets) == 2 {
			cardX = x + canvasFallbackArrangePairXOffset
		}
		boxes = append(boxes, canvasFallbackRect{X: cardX, Y: stackY, Width: width, Height: height})
		stackY += height + canvasFallbackArrangeCardGapY
	}
	return boxes
}

func canvasFallbackRectsOverlap(a canvasFallbackRect, b canvasFallbackRect) bool {
	return a.X < b.X+b.Width && a.X+a.Width > b.X && a.Y < b.Y+b.Height && a.Y+a.Height > b.Y
}

func canvasFallbackTargetMaxX(targets []canvasFallbackCardTarget) float64 {
	if len(targets) == 0 {
		return 0
	}
	maxX := targets[0].Card.X + canvasCardDisplayWidth(targets[0].Card)
	for _, target := range targets[1:] {
		right := target.Card.X + canvasCardDisplayWidth(target.Card)
		if right > maxX {
			maxX = right
		}
	}
	return maxX
}

func canvasFallbackTargetCardIDs(targets []canvasFallbackCardTarget) []string {
	ids := make([]string, 0, len(targets))
	seen := map[string]bool{}
	for _, target := range targets {
		if target.Card.ID == "" || seen[target.Card.ID] {
			continue
		}
		seen[target.Card.ID] = true
		ids = append(ids, target.Card.ID)
	}
	return ids
}

func canvasFallbackDuplicateCount(latestUserMessage string, targetCount int) int {
	count := canvasFallbackRequestedCount(latestUserMessage)
	if count > 0 {
		if targetCount >= count {
			return 1
		}
		return count
	}
	return 1
}

func canvasFallbackRequestedCount(text string) int {
	if match := canvasFallbackArabicCountRe.FindStringSubmatch(text); len(match) > 1 {
		count, err := strconv.Atoi(match[1])
		if err == nil {
			return canvasFallbackClampDuplicateCount(count)
		}
	}
	runes := []rune(text)
	for i, r := range runes {
		count, ok := canvasFallbackCJKCounts[r]
		if !ok {
			continue
		}
		if i+1 < len(runes) && canvasFallbackCountUnit(runes[i+1]) {
			return canvasFallbackClampDuplicateCount(count)
		}
	}
	for _, token := range canvasFallbackTextTokens(text) {
		if count, ok := canvasFallbackEnglishCounts[strings.ToLower(token)]; ok {
			return canvasFallbackClampDuplicateCount(count)
		}
	}
	return 0
}

func canvasFallbackCountUnit(r rune) bool {
	switch r {
	case '張', '张', '個', '个', '份', '件':
		return true
	default:
		return false
	}
}

func canvasFallbackClampDuplicateCount(count int) int {
	if count < 1 {
		return 0
	}
	if count > canvasFallbackMaxDuplicateCount {
		return canvasFallbackMaxDuplicateCount
	}
	return count
}

func canvasFallbackImageVariantAction(tool string, targets []canvasFallbackCardTarget) (canvasAction, bool) {
	if len(targets) == 0 {
		return canvasAction{}, false
	}
	for _, target := range targets {
		if target.Card.Asset == nil {
			continue
		}
		switch tool {
		case "rotate_image":
			return canvasAction{
				Tool: "rotate_image",
				Params: map[string]any{
					"assetIds": []string{target.Card.Asset.ID},
					// TODO: Parse explicit clockwise/counterclockwise direction when the request includes it.
					"degrees":      float64(90),
					"outputFormat": "png",
				},
				Description: "Rotate the confirmed asset",
				Impact:      "Generates a rotated image variant without changing the source file",
			}, true
		case "mirror_image":
			return canvasAction{
				Tool: "mirror_image",
				Params: map[string]any{
					"assetIds": []string{target.Card.Asset.ID},
					// TODO: Parse vertical flip requests when the wording explicitly asks for them.
					"flip":         "horizontal",
					"outputFormat": "png",
				},
				Description: "Mirror the confirmed asset",
				Impact:      "Generates a mirrored image variant without changing the source file",
			}, true
		}
	}
	return canvasAction{}, false
}

func canvasFallbackDuplicateCopyPositions(latestUserMessage string, canvas canvasSnapshot, newCardIDs []string, sourceCardIDs []string) []any {
	if len(newCardIDs) == 0 {
		return nil
	}
	sourceTargets := canvasFallbackTargetsForCardIDs(canvas, sourceCardIDs)
	targets := make([]canvasFallbackCardTarget, 0, len(newCardIDs))
	for index, id := range newCardIDs {
		card := canvasCardSnapshot{
			ID:     id,
			Kind:   "asset",
			Width:  canvasFallbackDefaultCardWidth,
			Height: canvasFallbackDefaultCardHeight,
		}
		if len(sourceTargets) > 0 {
			source := sourceTargets[index%len(sourceTargets)].Card
			card.X = source.X
			card.Y = source.Y + canvasCardDisplayHeight(source) + canvasFallbackArrangeCardGapY
			card.Width = canvasCardDisplayWidth(source)
			card.Height = canvasCardDisplayHeight(source)
		}
		targets = append(targets, canvasFallbackCardTarget{
			Card: card,
		})
	}
	return canvasFallbackArrangePositions(latestUserMessage, canvas, targets, nil, canvasFallbackDuplicateColumnOffset)
}

func canvasFallbackAugmentDuplicateResult(result any, latestUserMessage string, canvas canvasSnapshot) any {
	out, ok := result.(map[string]any)
	if !ok {
		return result
	}
	newCardIDs := canvasFallbackStringSlice(out["newCardIds"])
	sourceCardIDs := canvasFallbackStringSlice(out["cardIds"])
	positions := canvasFallbackDuplicateCopyPositions(latestUserMessage, canvas, newCardIDs, sourceCardIDs)
	if len(positions) > 0 {
		out["positions"] = positions
	}
	return out
}

func canvasFallbackStringSlice(value any) []string {
	switch v := value.(type) {
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				out = append(out, text)
			}
		}
		return out
	default:
		return nil
	}
}

func canvasFallbackTargetMinY(targets []canvasFallbackCardTarget) float64 {
	if len(targets) == 0 {
		return 0
	}
	minY := targets[0].Card.Y
	for _, target := range targets[1:] {
		if target.Card.Y < minY {
			minY = target.Card.Y
		}
	}
	return minY
}

func canvasClusterBounds(cards []canvasCardSnapshot) (float64, float64, float64, float64, bool) {
	if len(cards) == 0 {
		return 0, 0, 0, 0, false
	}
	hasBounds := false
	var minX, minY, maxX, maxY float64
	for _, card := range cards {
		width := canvasCardDisplayWidth(card)
		height := canvasCardDisplayHeight(card)
		if !hasBounds {
			minX, minY, maxX, maxY = card.X, card.Y, card.X+width, card.Y+height
			hasBounds = true
			continue
		}
		if card.X < minX {
			minX = card.X
		}
		if card.Y < minY {
			minY = card.Y
		}
		if card.X+width > maxX {
			maxX = card.X + width
		}
		if card.Y+height > maxY {
			maxY = card.Y + height
		}
	}
	return minX, minY, maxX, maxY, hasBounds
}

func canvasCardCanBeVisuallyArranged(card canvasCardSnapshot) bool {
	return card.Kind == "asset" || card.Kind == "upload"
}

func canvasCardDisplayWidth(card canvasCardSnapshot) float64 {
	if card.Width > 0 {
		return card.Width
	}
	if card.UploadWidth > 0 {
		return float64(card.UploadWidth)
	}
	return canvasFallbackDefaultCardWidth
}

func canvasCardDisplayHeight(card canvasCardSnapshot) float64 {
	if card.Height > 0 {
		return card.Height
	}
	if card.UploadHeight > 0 {
		return float64(card.UploadHeight)
	}
	return canvasFallbackDefaultCardHeight
}

func canvasRoundCoord(value float64) float64 {
	if value < 0 {
		return float64(int(value/10-0.5) * 10)
	}
	return float64(int(value/10+0.5) * 10)
}

func canvasFallbackManipulationStatus(actions []canvasAction) string {
	if len(actions) == 0 {
		return ""
	}
	names := make([]string, 0, len(actions))
	seen := map[string]bool{}
	for _, action := range actions {
		if seen[action.Tool] {
			continue
		}
		seen[action.Tool] = true
		names = append(names, action.Tool)
	}
	return "Confirmation complete; applying the requested canvas tools now: " + strings.Join(names, " / ") + "."
}
