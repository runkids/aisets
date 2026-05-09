package optimize

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"asset-studio/internal/scanner"
)

// Estimate aggregates optimization recommendations across the given items.
type Estimate struct {
	ItemCount    int                 `json:"itemCount"`
	TotalBytes   int64               `json:"totalBytes"`
	SavingsBytes int64               `json:"savingsBytes"`
	ByCategory   []CategoryBreakdown `json:"byCategory"`
	BySeverity   map[string]int      `json:"bySeverity"`
	Items        []ItemEstimate      `json:"items"`
	Operations   []Operation         `json:"operations"`
	Tools        []ToolStatus        `json:"tools"`
}

type CategoryBreakdown struct {
	Category     string `json:"category"`
	Count        int    `json:"count"`
	SavingsBytes int64  `json:"savingsBytes"`
}

type ItemEstimate struct {
	AssetID         string                           `json:"assetId"`
	RepoPath        string                           `json:"repoPath"`
	ProjectName     string                           `json:"projectName"`
	CurrentBytes    int64                            `json:"currentBytes"`
	SavingsBytes    int64                            `json:"savingsBytes"`
	Recommendations []scanner.OptimizationSuggestion `json:"recommendations"`
}

func Compute(items []scanner.AssetItem) Estimate {
	return ComputeWithRequest(items, Request{})
}

func ComputeWithRequest(items []scanner.AssetItem, req Request) Estimate {
	out := Estimate{
		BySeverity: map[string]int{"critical": 0, "warning": 0, "info": 0},
		Items:      make([]ItemEstimate, 0),
		ByCategory: make([]CategoryBreakdown, 0),
	}
	cats := map[string]*CategoryBreakdown{}
	for _, item := range items {
		if len(item.Optimization) == 0 {
			continue
		}
		var saved int64
		for _, opt := range item.Optimization {
			out.BySeverity[opt.Severity]++
			cb, ok := cats[opt.Category]
			if !ok {
				cb = &CategoryBreakdown{Category: opt.Category}
				cats[opt.Category] = cb
			}
			cb.Count++
			cb.SavingsBytes += opt.SavingsBytes
			saved += opt.SavingsBytes
		}
		out.Items = append(out.Items, ItemEstimate{
			AssetID:         item.ID,
			RepoPath:        item.RepoPath,
			ProjectName:     item.ProjectName,
			CurrentBytes:    item.Bytes,
			SavingsBytes:    saved,
			Recommendations: item.Optimization,
		})
		out.ItemCount++
		out.TotalBytes += item.Bytes
		out.SavingsBytes += saved
	}
	for _, cb := range cats {
		out.ByCategory = append(out.ByCategory, *cb)
	}
	sort.Slice(out.ByCategory, func(i, j int) bool {
		if out.ByCategory[i].SavingsBytes != out.ByCategory[j].SavingsBytes {
			return out.ByCategory[i].SavingsBytes > out.ByCategory[j].SavingsBytes
		}
		return out.ByCategory[i].Count > out.ByCategory[j].Count
	})
	out.Operations = Plan(items, req)
	out.Tools = ToolStatuses(out.Operations)
	return out
}

func ComputeWithProject(project scanner.Project, items []scanner.AssetItem, req Request) Estimate {
	out := ComputeWithRequest(items, req)
	ops, _ := EstimateOperations(project, out.Operations, req)
	out.Operations = ops
	out.Tools = ToolStatuses(out.Operations)
	var savings int64
	for _, op := range out.Operations {
		savings += op.SavingsBytes
	}
	out.SavingsBytes = savings
	return out
}

// GenerateScript builds a bash script applying suggested optimizations to the
// given items. Operations write to sibling files where the tool does not
// overwrite by design; review before running.
func GenerateScript(items []scanner.AssetItem) string {
	var b strings.Builder
	b.WriteString("#!/usr/bin/env bash\n")
	b.WriteString("# asset-studio: optimization script\n")
	b.WriteString("# Review each command before running.\n")
	b.WriteString("# Script fallback requires external CLI tools. In-app optimization uses built-in handlers for common formats.\n")
	b.WriteString("set -euo pipefail\n\n")

	count := 0
	for _, item := range items {
		if len(item.Optimization) == 0 {
			continue
		}
		count++
		path := item.LocalPath
		if path == "" {
			path = item.RepoPath
		}
		ext := strings.ToLower(filepath.Ext(path))
		quoted := shellQuote(path)
		b.WriteString(fmt.Sprintf("# --- %s (%s) ---\n", item.RepoPath, item.ProjectName))
		for _, opt := range item.Optimization {
			b.WriteString(fmt.Sprintf("# [%s/%s] %s → %s\n", opt.Severity, opt.Category, opt.Reason, opt.Suggestion))
			cmd := commandFor(opt.SuggestionCode, ext, path)
			if cmd == "" {
				b.WriteString(fmt.Sprintf("#   (no automated command for %s; review %s manually)\n", opt.SuggestionCode, quoted))
				continue
			}
			b.WriteString(cmd)
			b.WriteString("\n")
		}
		b.WriteString("\n")
	}
	if count == 0 {
		b.WriteString("# No optimizable items in selection.\n")
	}
	b.WriteString("echo \"asset-studio: optimization script complete.\"\n")
	return b.String()
}

func commandFor(suggestionCode, ext, path string) string {
	q := shellQuote(path)
	switch SuggestionOperation(suggestionCode, ext) {
	case "svg-minify":
		return fmt.Sprintf("svgo --input %s --output %s", q, q)
	case "convert-avif":
		out := shellQuote(replaceExt(path, ".avif"))
		return fmt.Sprintf("asset-studio-imgtools convert --format avif --quality 50 --speed 6 %s %s", q, out)
	case "convert-webp":
		out := shellQuote(replaceExt(path, ".webp"))
		return fmt.Sprintf("asset-studio-imgtools convert --format webp --quality 80 %s %s", q, out)
	case "webp-recompress":
		return fmt.Sprintf("asset-studio-imgtools convert --format webp --quality 60 %s %s", q, q)
	case "gif-optimize":
		return fmt.Sprintf("asset-studio-imgtools convert --format gif --quality 75 %s %s", q, q)
	case "resize-variant":
		out := shellQuote(replaceExt(path, "@1200"+ext))
		return fmt.Sprintf("asset-studio-imgtools resize --max-dimension 1200 %s %s", q, out)
	}
	return ""
}

func replaceExt(path, newExt string) string {
	ext := filepath.Ext(path)
	if ext == "" {
		return path + newExt
	}
	return strings.TrimSuffix(path, ext) + newExt
}

func shellQuote(s string) string {
	if s == "" {
		return "\"\""
	}
	return "\"" + strings.ReplaceAll(s, "\"", "\\\"") + "\""
}
