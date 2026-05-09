package lint

import (
	"fmt"
	"regexp"
	"strings"
)

type Context struct {
	File       string
	Line       int
	Content    string
	Kind       string // string, css-url, pattern
	Specifier  string
	AssetBytes int64
	AssetExt   string
	AssetID    string
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
	if !hasImgTag(ctx.Content) {
		return nil
	}
	if loadingAttrRe.MatchString(ctx.Content) || fetchPriorityRe.MatchString(ctx.Content) {
		return nil
	}
	if ctx.AssetExt == ".svg" {
		return nil
	}
	if ctx.AssetBytes <= 20*1024 {
		return nil
	}
	return &Finding{
		RuleID:     "missing-lazy-loading",
		Severity:   "warning",
		File:       ctx.File,
		Line:       ctx.Line,
		Snippet:    truncateSnippet(ctx.Content),
		Message:    "<img> loads a large image without a loading attribute, which may affect scroll performance.",
		Suggestion: "Add loading=\"lazy\" for below-fold images, or loading=\"eager\" / fetchpriority=\"high\" for critical above-fold images.",
		AssetID:    ctx.AssetID,
	}
}

func MissingDimensions(ctx Context) *Finding {
	if !hasImgTag(ctx.Content) {
		return nil
	}
	if hasWidthHint(ctx.Content) && hasHeightHint(ctx.Content) {
		return nil
	}
	return &Finding{
		RuleID:     "missing-dimensions",
		Severity:   "warning",
		File:       ctx.File,
		Line:       ctx.Line,
		Snippet:    truncateSnippet(ctx.Content),
		Message:    "<img> lacks explicit width/height or aspect ratio, which may cause layout shift (CLS).",
		Suggestion: "Add width/height attributes, or provide both width and height/aspect-ratio via Tailwind/CSS.",
		AssetID:    ctx.AssetID,
	}
}

func LargeInlineImport(ctx Context) *Finding {
	if ctx.AssetBytes <= 10*1024 {
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
		Severity:   "critical",
		File:       ctx.File,
		Line:       ctx.Line,
		Snippet:    truncateSnippet(ctx.Content),
		Message:    fmt.Sprintf("Importing %dKB asset as raw/inline may bloat the JS bundle.", ctx.AssetBytes/1024),
		Suggestion: "Use a standard URL import instead. Only use ?raw/?inline for very small SVG/icons.",
		AssetID:    ctx.AssetID,
	}
}

func NoResponsiveImage(ctx Context) *Finding {
	if !hasImgTag(ctx.Content) {
		return nil
	}
	if ctx.AssetBytes <= 100*1024 {
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
		Severity:   "info",
		File:       ctx.File,
		Line:       ctx.Line,
		Snippet:    truncateSnippet(ctx.Content),
		Message:    fmt.Sprintf("Large raster image (%dKB) without srcset may waste bandwidth on small screens.", ctx.AssetBytes/1024),
		Suggestion: "Provide multiple sizes via srcset for content images, or compress the source for fixed-size UI images.",
		AssetID:    ctx.AssetID,
	}
}

func SvgAsImg(ctx Context) *Finding {
	if ctx.AssetExt != ".svg" {
		return nil
	}
	if !hasImgTag(ctx.Content) {
		return nil
	}
	return &Finding{
		RuleID:     "svg-as-img",
		Severity:   "info",
		File:       ctx.File,
		Line:       ctx.Line,
		Snippet:    truncateSnippet(ctx.Content),
		Message:    "SVG loaded via <img> cannot be styled with CSS or animated interactively.",
		Suggestion: "Keep <img> for static SVGs. Switch to inline SVG or a component when you need CSS color control or animation.",
		AssetID:    ctx.AssetID,
	}
}

func ImgAsBackground(ctx Context) *Finding {
	if !hasImgTag(ctx.Content) {
		return nil
	}
	if ctx.AssetBytes <= 20*1024 {
		return nil
	}
	if !emptyAltRe.MatchString(ctx.Content) {
		return nil
	}
	return &Finding{
		RuleID:     "img-as-background",
		Severity:   "info",
		File:       ctx.File,
		Line:       ctx.Line,
		Snippet:    truncateSnippet(ctx.Content),
		Message:    "Large decorative image (alt=\"\") loaded via <img>. Consider whether it needs to occupy the DOM.",
		Suggestion: "Use CSS background/pseudo-elements for pure decoration. Keep <img alt=\"\"> if you need sizing or loading behavior.",
		AssetID:    ctx.AssetID,
	}
}

func BgContentImage(ctx Context) *Finding {
	if ctx.Kind != "css-url" {
		return nil
	}
	if ctx.AssetBytes <= 80*1024 {
		return nil
	}
	if !rasterExts[ctx.AssetExt] {
		return nil
	}
	return &Finding{
		RuleID:     "bg-content-image",
		Severity:   "warning",
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
	var findings []Finding
	for _, rule := range AllRules {
		if f := rule(ctx); f != nil {
			findings = append(findings, *f)
		}
	}
	return findings
}

func truncateSnippet(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 120 {
		return s[:120] + "..."
	}
	return s
}
