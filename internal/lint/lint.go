package lint

import (
	"fmt"
	"regexp"
	"strings"
)

type Context struct {
	File               string
	Line               int
	Content            string
	Kind               string // string, css-url, pattern
	Specifier          string
	AssetBytes         int64
	AssetExt           string
	AssetID            string
	AssetPath          string
	ProjectName        string
	AssetWidth         int
	AssetHeight        int
	AssetAnimated      bool
	AssetAlpha         bool
	AssetDuplicate     bool
	AssetNearDuplicate bool
	AssetOptimizable   bool
	AssetEXIFGPS       bool
}

type Finding struct {
	RuleID     string `json:"ruleId"`
	Severity   string `json:"severity"`
	File       string `json:"file"`
	Line       int    `json:"line"`
	Snippet    string `json:"snippet"`
	Message    string `json:"message"`
	Suggestion string `json:"suggestion"`
	AssetID    string `json:"assetId,omitempty"`
}

type Rule func(ctx Context) *Finding

type Settings struct {
	BuiltinRules []BuiltinRuleSetting `json:"builtinRules"`
	CustomRules  []CustomRuleSetting  `json:"customRules"`
}

type BuiltinRuleSetting struct {
	ID          string `json:"id"`
	Enabled     bool   `json:"enabled"`
	Severity    string `json:"severity"`
	ThresholdKB int    `json:"thresholdKB,omitempty"`
}

type CustomRuleSetting struct {
	ID         string            `json:"id"`
	Name       string            `json:"name"`
	Enabled    bool              `json:"enabled"`
	Severity   string            `json:"severity"`
	Message    string            `json:"message"`
	Suggestion string            `json:"suggestion"`
	Groups     []CustomRuleGroup `json:"groups"`
}

type CustomRuleGroup struct {
	Clauses []CustomRuleClause `json:"clauses"`
}

type CustomRuleClause struct {
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    string `json:"value"`
}

type builtinDefinition struct {
	id          string
	severity    string
	thresholdKB int
	run         func(Context, BuiltinRuleSetting) *Finding
}

var imgTagRe = regexp.MustCompile(`(?i)<img\b`)
var loadingAttrRe = regexp.MustCompile(`(?i)\bloading\s*=`)
var fetchPriorityRe = regexp.MustCompile(`(?i)\bfetchpriority\s*=`)
var widthAttrRe = regexp.MustCompile(`(?i)\b:?width\s*=`)
var heightAttrRe = regexp.MustCompile(`(?i)\b:?height\s*=`)
var aspectRatioClassRe = regexp.MustCompile(`(?:^|\s)(?:[a-z0-9-]+:)*aspect-`)
var aspectRatioCSSRe = regexp.MustCompile(`(?i)aspect-ratio\s*:`)
var widthCSSRe = regexp.MustCompile(`(?i)width\s*:`)
var heightCSSRe = regexp.MustCompile(`(?i)height\s*:`)
var srcsetAttrRe = regexp.MustCompile(`(?i)\bsrcset\s*=`)
var importRe = regexp.MustCompile(`^\s*import\b`)
var rawInlineRe = regexp.MustCompile(`[?&](raw|inline)\b`)
var emptyAltRe = regexp.MustCompile(`(?i)alt\s*=\s*["']\s*["']`)
var classAttrRe = regexp.MustCompile(`(?i)\bclass\s*=\s*["']([^"']*)["']`)
var widthFixedAttrRe = regexp.MustCompile(`(?i)\bwidth\s*=\s*["']?(\d+)`)
var tailwindWidthRe = regexp.MustCompile(`(?:^|\s)(?:[a-z0-9-]+:)*w-(\d+)(?:\s|$)`)
var tailwindWidthBracketRe = regexp.MustCompile(`(?:^|\s)(?:[a-z0-9-]+:)*w-\[(\d+)px\]`)
var tailwindHeightRe = regexp.MustCompile(`(?:^|\s)(?:[a-z0-9-]+:)*h-\d`)

var rasterExts = map[string]bool{
	".avif": true, ".gif": true, ".jpeg": true, ".jpg": true, ".png": true, ".webp": true,
}

var builtinDefinitions = []builtinDefinition{
	{id: "missing-lazy-loading", severity: "warning", thresholdKB: 20, run: missingLazyLoadingWithSetting},
	{id: "missing-dimensions", severity: "warning", run: missingDimensionsWithSetting},
	{id: "large-inline-import", severity: "critical", thresholdKB: 10, run: largeInlineImportWithSetting},
	{id: "no-responsive-image", severity: "info", thresholdKB: 100, run: noResponsiveImageWithSetting},
	{id: "svg-as-img", severity: "info", run: svgAsImgWithSetting},
	{id: "img-as-background", severity: "info", thresholdKB: 20, run: imgAsBackgroundWithSetting},
	{id: "bg-content-image", severity: "warning", thresholdKB: 80, run: bgContentImageWithSetting},
	{id: "duplicate-asset", severity: "warning"},
	{id: "exif-gps-privacy", severity: "advisory"},
}

func DefaultSettings() Settings {
	settings := Settings{
		BuiltinRules: make([]BuiltinRuleSetting, 0, len(builtinDefinitions)),
		CustomRules:  []CustomRuleSetting{},
	}
	for _, def := range builtinDefinitions {
		settings.BuiltinRules = append(settings.BuiltinRules, BuiltinRuleSetting{
			ID:          def.id,
			Enabled:     true,
			Severity:    def.severity,
			ThresholdKB: def.thresholdKB,
		})
	}
	return settings
}

func NormalizeSettings(settings Settings) Settings {
	defaults := DefaultSettings()
	custom := normalizeCustomRules(settings.CustomRules)
	if len(settings.BuiltinRules) == 0 {
		defaults.CustomRules = custom
		return defaults
	}
	byID := map[string]BuiltinRuleSetting{}
	for _, rule := range settings.BuiltinRules {
		rule.ID = strings.TrimSpace(rule.ID)
		if rule.ID == "" {
			continue
		}
		rule.Severity = normalizeSeverity(rule.Severity, "")
		byID[rule.ID] = rule
	}
	for i, def := range builtinDefinitions {
		if rule, ok := byID[def.id]; ok {
			defaults.BuiltinRules[i].Enabled = rule.Enabled
			defaults.BuiltinRules[i].Severity = normalizeSeverity(rule.Severity, def.severity)
			if def.thresholdKB > 0 {
				if rule.ThresholdKB > 0 {
					defaults.BuiltinRules[i].ThresholdKB = rule.ThresholdKB
				}
			} else {
				defaults.BuiltinRules[i].ThresholdKB = 0
			}
		}
	}
	defaults.CustomRules = custom
	return defaults
}

func normalizeCustomRules(rules []CustomRuleSetting) []CustomRuleSetting {
	if rules == nil {
		return []CustomRuleSetting{}
	}
	out := make([]CustomRuleSetting, 0, len(rules))
	for _, rule := range rules {
		rule.ID = strings.TrimSpace(rule.ID)
		rule.Name = strings.TrimSpace(rule.Name)
		rule.Severity = normalizeSeverity(rule.Severity, "warning")
		rule.Message = strings.TrimSpace(rule.Message)
		rule.Suggestion = strings.TrimSpace(rule.Suggestion)
		for groupIndex := range rule.Groups {
			clauses := rule.Groups[groupIndex].Clauses
			normalizedClauses := make([]CustomRuleClause, 0, len(clauses))
			for _, clause := range clauses {
				clause.Field = strings.TrimSpace(clause.Field)
				clause.Operator = strings.TrimSpace(clause.Operator)
				clause.Value = strings.TrimSpace(clause.Value)
				if clause.Field == "" || clause.Operator == "" {
					continue
				}
				normalizedClauses = append(normalizedClauses, clause)
			}
			rule.Groups[groupIndex].Clauses = normalizedClauses
		}
		out = append(out, rule)
	}
	return out
}

func normalizeSeverity(value, fallback string) string {
	switch strings.TrimSpace(value) {
	case "critical", "warning", "info", "advisory":
		return strings.TrimSpace(value)
	}
	if fallback != "" {
		return fallback
	}
	return "warning"
}

func BuiltinRule(settings Settings, id string) BuiltinRuleSetting {
	settings = NormalizeSettings(settings)
	for _, rule := range settings.BuiltinRules {
		if rule.ID == id {
			return rule
		}
	}
	return BuiltinRuleSetting{ID: id, Enabled: true, Severity: "warning"}
}

func hasImgTag(content string) bool {
	return imgTagRe.MatchString(content)
}

func hasWidthHint(content string) bool {
	if widthAttrRe.MatchString(content) {
		return true
	}
	if widthCSSRe.MatchString(content) {
		return true
	}
	if m := classAttrRe.FindStringSubmatch(content); len(m) > 1 {
		if tailwindWidthRe.MatchString(m[1]) || tailwindWidthBracketRe.MatchString(m[1]) {
			return true
		}
	}
	return false
}

func hasHeightHint(content string) bool {
	if heightAttrRe.MatchString(content) {
		return true
	}
	if heightCSSRe.MatchString(content) {
		return true
	}
	if m := classAttrRe.FindStringSubmatch(content); len(m) > 1 {
		if tailwindHeightRe.MatchString(m[1]) {
			return true
		}
		if aspectRatioClassRe.MatchString(m[1]) {
			return true
		}
	}
	if aspectRatioCSSRe.MatchString(content) {
		return true
	}
	return false
}

func extractFixedWidthPx(content string) int {
	if m := widthFixedAttrRe.FindStringSubmatch(content); len(m) > 1 {
		var v int
		fmt.Sscanf(m[1], "%d", &v)
		return v
	}
	if m := classAttrRe.FindStringSubmatch(content); len(m) > 1 {
		if bm := tailwindWidthBracketRe.FindStringSubmatch(m[1]); len(bm) > 1 {
			var v int
			fmt.Sscanf(bm[1], "%d", &v)
			return v
		}
		if rm := tailwindWidthRe.FindStringSubmatch(m[1]); len(rm) > 1 {
			var v int
			fmt.Sscanf(rm[1], "%d", &v)
			return v * 4
		}
	}
	return 0
}

func MissingLazyLoading(ctx Context) *Finding {
	return missingLazyLoadingWithSetting(ctx, BuiltinRule(DefaultSettings(), "missing-lazy-loading"))
}

func missingLazyLoadingWithSetting(ctx Context, setting BuiltinRuleSetting) *Finding {
	if !hasImgTag(ctx.Content) {
		return nil
	}
	if loadingAttrRe.MatchString(ctx.Content) || fetchPriorityRe.MatchString(ctx.Content) {
		return nil
	}
	if ctx.AssetExt == ".svg" {
		return nil
	}
	if ctx.AssetBytes <= int64(setting.ThresholdKB)*1024 {
		return nil
	}
	return &Finding{
		RuleID:     "missing-lazy-loading",
		Severity:   setting.Severity,
		File:       ctx.File,
		Line:       ctx.Line,
		Snippet:    truncateSnippet(ctx.Content),
		Message:    "<img> loads a large image without a loading attribute, which may affect scroll performance.",
		Suggestion: "Add loading=\"lazy\" for below-fold images, or loading=\"eager\" / fetchpriority=\"high\" for critical above-fold images.",
		AssetID:    ctx.AssetID,
	}
}

func MissingDimensions(ctx Context) *Finding {
	return missingDimensionsWithSetting(ctx, BuiltinRule(DefaultSettings(), "missing-dimensions"))
}

func missingDimensionsWithSetting(ctx Context, setting BuiltinRuleSetting) *Finding {
	if !hasImgTag(ctx.Content) {
		return nil
	}
	if hasWidthHint(ctx.Content) && hasHeightHint(ctx.Content) {
		return nil
	}
	return &Finding{
		RuleID:     "missing-dimensions",
		Severity:   setting.Severity,
		File:       ctx.File,
		Line:       ctx.Line,
		Snippet:    truncateSnippet(ctx.Content),
		Message:    "<img> lacks explicit width/height or aspect ratio, which may cause layout shift (CLS).",
		Suggestion: "Add width/height attributes, or provide both width and height/aspect-ratio via Tailwind/CSS.",
		AssetID:    ctx.AssetID,
	}
}

func LargeInlineImport(ctx Context) *Finding {
	return largeInlineImportWithSetting(ctx, BuiltinRule(DefaultSettings(), "large-inline-import"))
}

func largeInlineImportWithSetting(ctx Context, setting BuiltinRuleSetting) *Finding {
	if ctx.AssetBytes <= int64(setting.ThresholdKB)*1024 {
		return nil
	}
	if !importRe.MatchString(ctx.Content) {
		return nil
	}
	if !rawInlineRe.MatchString(ctx.Specifier) {
		return nil
	}
	if ctx.Kind == "css-url" {
		return nil
	}
	return &Finding{
		RuleID:     "large-inline-import",
		Severity:   setting.Severity,
		File:       ctx.File,
		Line:       ctx.Line,
		Snippet:    truncateSnippet(ctx.Content),
		Message:    fmt.Sprintf("Importing %dKB asset as raw/inline may bloat the JS bundle.", ctx.AssetBytes/1024),
		Suggestion: "Use a standard URL import instead. Only use ?raw/?inline for very small SVG/icons.",
		AssetID:    ctx.AssetID,
	}
}

func NoResponsiveImage(ctx Context) *Finding {
	return noResponsiveImageWithSetting(ctx, BuiltinRule(DefaultSettings(), "no-responsive-image"))
}

func noResponsiveImageWithSetting(ctx Context, setting BuiltinRuleSetting) *Finding {
	if !hasImgTag(ctx.Content) {
		return nil
	}
	if ctx.AssetBytes <= int64(setting.ThresholdKB)*1024 {
		return nil
	}
	if !rasterExts[ctx.AssetExt] {
		return nil
	}
	if srcsetAttrRe.MatchString(ctx.Content) {
		return nil
	}
	if fixedW := extractFixedWidthPx(ctx.Content); fixedW > 0 && fixedW <= 240 {
		return nil
	}
	return &Finding{
		RuleID:     "no-responsive-image",
		Severity:   setting.Severity,
		File:       ctx.File,
		Line:       ctx.Line,
		Snippet:    truncateSnippet(ctx.Content),
		Message:    fmt.Sprintf("Large raster image (%dKB) without srcset may waste bandwidth on small screens.", ctx.AssetBytes/1024),
		Suggestion: "Provide multiple sizes via srcset for content images, or compress the source for fixed-size UI images.",
		AssetID:    ctx.AssetID,
	}
}

func SvgAsImg(ctx Context) *Finding {
	return svgAsImgWithSetting(ctx, BuiltinRule(DefaultSettings(), "svg-as-img"))
}

func svgAsImgWithSetting(ctx Context, setting BuiltinRuleSetting) *Finding {
	if ctx.AssetExt != ".svg" {
		return nil
	}
	if !hasImgTag(ctx.Content) {
		return nil
	}
	return &Finding{
		RuleID:     "svg-as-img",
		Severity:   setting.Severity,
		File:       ctx.File,
		Line:       ctx.Line,
		Snippet:    truncateSnippet(ctx.Content),
		Message:    "SVG loaded via <img> cannot be styled with CSS or animated interactively.",
		Suggestion: "Keep <img> for static SVGs. Switch to inline SVG or a component when you need CSS color control or animation.",
		AssetID:    ctx.AssetID,
	}
}

func ImgAsBackground(ctx Context) *Finding {
	return imgAsBackgroundWithSetting(ctx, BuiltinRule(DefaultSettings(), "img-as-background"))
}

func imgAsBackgroundWithSetting(ctx Context, setting BuiltinRuleSetting) *Finding {
	if !hasImgTag(ctx.Content) {
		return nil
	}
	if ctx.AssetBytes <= int64(setting.ThresholdKB)*1024 {
		return nil
	}
	if !emptyAltRe.MatchString(ctx.Content) {
		return nil
	}
	return &Finding{
		RuleID:     "img-as-background",
		Severity:   setting.Severity,
		File:       ctx.File,
		Line:       ctx.Line,
		Snippet:    truncateSnippet(ctx.Content),
		Message:    "Large decorative image (alt=\"\") loaded via <img>. Consider whether it needs to occupy the DOM.",
		Suggestion: "Use CSS background/pseudo-elements for pure decoration. Keep <img alt=\"\"> if you need sizing or loading behavior.",
		AssetID:    ctx.AssetID,
	}
}

func BgContentImage(ctx Context) *Finding {
	return bgContentImageWithSetting(ctx, BuiltinRule(DefaultSettings(), "bg-content-image"))
}

func bgContentImageWithSetting(ctx Context, setting BuiltinRuleSetting) *Finding {
	if ctx.Kind != "css-url" {
		return nil
	}
	if ctx.AssetBytes <= int64(setting.ThresholdKB)*1024 {
		return nil
	}
	if !rasterExts[ctx.AssetExt] {
		return nil
	}
	return &Finding{
		RuleID:     "bg-content-image",
		Severity:   setting.Severity,
		File:       ctx.File,
		Line:       ctx.Line,
		Snippet:    truncateSnippet(ctx.Content),
		Message:    fmt.Sprintf("Large raster image (%dKB) loaded via CSS background-image cannot use lazy loading.", ctx.AssetBytes/1024),
		Suggestion: "Use <img> with loading=\"lazy\" for content images. For visual backgrounds, compress/convert the source or add a preload strategy.",
		AssetID:    ctx.AssetID,
	}
}

var AllRules = []Rule{
	MissingLazyLoading,
	MissingDimensions,
	LargeInlineImport,
	NoResponsiveImage,
	SvgAsImg,
	ImgAsBackground,
	BgContentImage,
}

func Run(ctx Context) []Finding {
	return RunWithSettings(ctx, DefaultSettings())
}

func RunWithSettings(ctx Context, settings Settings) []Finding {
	settings = NormalizeSettings(settings)
	builtins := map[string]BuiltinRuleSetting{}
	for _, rule := range settings.BuiltinRules {
		builtins[rule.ID] = rule
	}
	var findings []Finding
	for _, def := range builtinDefinitions {
		if def.run == nil {
			continue
		}
		setting, ok := builtins[def.id]
		if !ok || !setting.Enabled {
			continue
		}
		if f := def.run(ctx, setting); f != nil {
			findings = append(findings, *f)
		}
	}
	return findings
}

func RunCustom(ctx Context, settings Settings) []Finding {
	settings = NormalizeSettings(settings)
	var findings []Finding
	for _, rule := range settings.CustomRules {
		if !rule.Enabled || rule.ID == "" || len(rule.Groups) == 0 {
			continue
		}
		if !customRuleMatches(ctx, rule) {
			continue
		}
		message := rule.Message
		if message == "" {
			message = "Custom lint rule matched this image."
		}
		suggestion := rule.Suggestion
		if suggestion == "" {
			suggestion = "Review this image against your team asset rules."
		}
		file := ctx.File
		if file == "" {
			file = ctx.AssetPath
		}
		findings = append(findings, Finding{
			RuleID:     "custom-" + rule.ID,
			Severity:   rule.Severity,
			File:       file,
			Line:       ctx.Line,
			Snippet:    truncateSnippet(ctx.Content),
			Message:    message,
			Suggestion: suggestion,
			AssetID:    ctx.AssetID,
		})
	}
	return findings
}

func CustomRuleUsesReference(rule CustomRuleSetting) bool {
	for _, group := range rule.Groups {
		for _, clause := range group.Clauses {
			switch clause.Field {
			case "referenceKind", "specifier", "snippet", "snippetRegex", "hasLoading", "hasFetchPriority", "hasWidth", "hasHeight", "hasSrcset", "altEmpty":
				return true
			}
		}
	}
	return false
}

func customRuleMatches(ctx Context, rule CustomRuleSetting) bool {
	for _, group := range rule.Groups {
		if len(group.Clauses) == 0 {
			continue
		}
		matched := true
		for _, clause := range group.Clauses {
			if !customClauseMatches(ctx, clause) {
				matched = false
				break
			}
		}
		if matched {
			return true
		}
	}
	return false
}

func customClauseMatches(ctx Context, clause CustomRuleClause) bool {
	switch clause.Field {
	case "path":
		return matchText(ctx.AssetPath, clause.Operator, clause.Value)
	case "folder":
		folder := ""
		if i := strings.LastIndex(ctx.AssetPath, "/"); i >= 0 {
			folder = ctx.AssetPath[:i]
		}
		return matchText(folder, clause.Operator, clause.Value)
	case "extension":
		return matchText(ctx.AssetExt, clause.Operator, normalizeExt(clause.Value))
	case "project":
		return matchText(ctx.ProjectName, clause.Operator, clause.Value)
	case "bytes":
		return matchInt(ctx.AssetBytes, clause.Operator, clause.Value)
	case "width":
		return matchInt(int64(ctx.AssetWidth), clause.Operator, clause.Value)
	case "height":
		return matchInt(int64(ctx.AssetHeight), clause.Operator, clause.Value)
	case "megapixels":
		return matchFloat(float64(ctx.AssetWidth*ctx.AssetHeight)/1_000_000, clause.Operator, clause.Value)
	case "animated":
		return matchBool(ctx.AssetAnimated, clause.Operator, clause.Value)
	case "alpha":
		return matchBool(ctx.AssetAlpha, clause.Operator, clause.Value)
	case "duplicate":
		return matchBool(ctx.AssetDuplicate, clause.Operator, clause.Value)
	case "nearDuplicate":
		return matchBool(ctx.AssetNearDuplicate, clause.Operator, clause.Value)
	case "optimizable":
		return matchBool(ctx.AssetOptimizable, clause.Operator, clause.Value)
	case "exifGps":
		return matchBool(ctx.AssetEXIFGPS, clause.Operator, clause.Value)
	case "referenceKind":
		return matchText(ctx.Kind, clause.Operator, clause.Value)
	case "specifier":
		return matchText(ctx.Specifier, clause.Operator, clause.Value)
	case "snippet":
		return matchText(ctx.Content, clause.Operator, clause.Value)
	case "snippetRegex":
		return matchText(ctx.Content, "regex", clause.Value)
	case "hasLoading":
		return matchBool(loadingAttrRe.MatchString(ctx.Content), clause.Operator, clause.Value)
	case "hasFetchPriority":
		return matchBool(fetchPriorityRe.MatchString(ctx.Content), clause.Operator, clause.Value)
	case "hasWidth":
		return matchBool(hasWidthHint(ctx.Content), clause.Operator, clause.Value)
	case "hasHeight":
		return matchBool(hasHeightHint(ctx.Content), clause.Operator, clause.Value)
	case "hasSrcset":
		return matchBool(srcsetAttrRe.MatchString(ctx.Content), clause.Operator, clause.Value)
	case "altEmpty":
		return matchBool(emptyAltRe.MatchString(ctx.Content), clause.Operator, clause.Value)
	}
	return false
}

func matchText(actual, operator, expected string) bool {
	actual = strings.TrimSpace(actual)
	expected = strings.TrimSpace(expected)
	switch operator {
	case "contains":
		return strings.Contains(strings.ToLower(actual), strings.ToLower(expected))
	case "prefix":
		return strings.HasPrefix(strings.ToLower(actual), strings.ToLower(expected))
	case "suffix":
		return strings.HasSuffix(strings.ToLower(actual), strings.ToLower(expected))
	case "equals", "is":
		return strings.EqualFold(actual, expected)
	case "oneOf":
		for _, option := range splitList(expected) {
			if strings.EqualFold(actual, normalizeExt(option)) || strings.EqualFold(actual, option) {
				return true
			}
		}
		return false
	case "regex":
		re, err := regexp.Compile(expected)
		if err != nil {
			return false
		}
		return re.MatchString(actual)
	}
	return false
}

func matchInt(actual int64, operator, expected string) bool {
	var value int64
	if _, err := fmt.Sscanf(strings.TrimSpace(expected), "%d", &value); err != nil {
		return false
	}
	switch operator {
	case "gte":
		return actual >= value
	case "lte":
		return actual <= value
	case "equals", "is":
		return actual == value
	}
	return false
}

func matchFloat(actual float64, operator, expected string) bool {
	var value float64
	if _, err := fmt.Sscanf(strings.TrimSpace(expected), "%f", &value); err != nil {
		return false
	}
	switch operator {
	case "gte":
		return actual >= value
	case "lte":
		return actual <= value
	case "equals", "is":
		return actual == value
	}
	return false
}

func matchBool(actual bool, operator, expected string) bool {
	if operator != "is" && operator != "equals" {
		return false
	}
	expected = strings.ToLower(strings.TrimSpace(expected))
	want := expected == "true" || expected == "yes" || expected == "1"
	return actual == want
}

func splitList(value string) []string {
	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == '\n'
	})
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func normalizeExt(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value != "" && !strings.HasPrefix(value, ".") {
		return "." + value
	}
	return value
}

func truncateSnippet(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 120 {
		return s[:120] + "..."
	}
	return s
}
