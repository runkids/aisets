package server

import (
	"fmt"
	"path/filepath"
	"strings"

	"aisets/internal/lint"
	"aisets/internal/scanner"
)

func formatFileMetadata(item scanner.AssetItem) string {
	name := filepath.Base(item.RepoPath)
	size := formatBytes(item.Bytes)
	dims := fmt.Sprintf("%dx%d", item.Image.Width, item.Image.Height)

	alpha := "no transparency"
	if item.Image.Alpha {
		alpha = "has transparency"
	}
	anim := "not animated"
	if item.Image.Animated {
		anim = "animated"
	}

	return fmt.Sprintf("File: %s (%s, %s, %s, %s, %s)", name, item.Ext, size, dims, alpha, anim)
}

func formatLintFindings(findings []lint.Finding) string {
	if len(findings) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("Lint findings for this asset:")
	for _, f := range findings {
		b.WriteString(fmt.Sprintf("\n- [%s/%s] %s", f.Severity, f.RuleID, f.Message))
		if f.Suggestion != "" {
			b.WriteString(fmt.Sprintf(" → %s", f.Suggestion))
		}
	}
	return b.String()
}

func formatOptimizationFindings(opts []scanner.OptimizationSuggestion) string {
	if len(opts) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("Rule-based optimization analysis:")
	for _, o := range opts {
		b.WriteString(fmt.Sprintf("\n- [%s/%s] %s", o.Severity, o.ReasonCode, o.Reason))
		if o.SavingsBytes > 0 {
			b.WriteString(fmt.Sprintf(" (est. savings: %s)", formatBytes(o.SavingsBytes)))
		}
		if o.Suggestion != "" {
			b.WriteString(fmt.Sprintf(" → %s", o.Suggestion))
		}
	}
	return b.String()
}

func replaceDynamicVars(prompt string, vars map[string]string) string {
	for name, value := range vars {
		placeholder := "{{" + name + "}}"
		if value == "" {
			prompt = strings.ReplaceAll(prompt, placeholder+"\n\n", "")
			prompt = strings.ReplaceAll(prompt, "\n\n"+placeholder, "")
			prompt = strings.ReplaceAll(prompt, placeholder+"\n", "")
			prompt = strings.ReplaceAll(prompt, placeholder, "")
		} else {
			prompt = strings.ReplaceAll(prompt, placeholder, value)
		}
	}
	return prompt
}

func formatBytes(b int64) string {
	switch {
	case b >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(b)/float64(1<<20))
	case b >= 1<<10:
		return fmt.Sprintf("%.0f KB", float64(b)/float64(1<<10))
	default:
		return fmt.Sprintf("%d B", b)
	}
}
