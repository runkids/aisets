package optimize

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"aisets/internal/scanner"
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
func GenerateScript(items []scanner.AssetItem, req Request) string {
	req = normalizeRequest(req)
	var b strings.Builder
	b.WriteString("#!/usr/bin/env bash\n")
	b.WriteString("# aisets: optimization script\n")
	b.WriteString("# Review each command before running.\n")
	b.WriteString("# Commands are generated from the active optimization settings.\n")
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
		quoted := shellQuote(path)
		b.WriteString(fmt.Sprintf("# --- %s (%s) ---\n", item.RepoPath, item.ProjectName))
		for _, opt := range item.Optimization {
			b.WriteString(fmt.Sprintf("# [%s/%s] %s → %s\n", opt.Severity, opt.Category, opt.Reason, opt.Suggestion))
		}
		ops := Plan([]scanner.AssetItem{item}, req)
		if len(ops) == 0 {
			b.WriteString(fmt.Sprintf("#   (no automated command; review %s manually)\n", quoted))
			b.WriteString("\n")
			continue
		}
		for _, op := range ops {
			cmd := commandForOperation(op, path, req)
			if cmd == "" {
				b.WriteString(fmt.Sprintf("#   (no automated command for %s; review %s manually)\n", op.Operation, quoted))
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
	b.WriteString("echo \"aisets: optimization script complete.\"\n")
	return b.String()
}

func commandForOperation(op Operation, path string, req Request) string {
	if op.Operation == "" || op.Operation == "manual-review" {
		return ""
	}
	quality := formatQuality(op, req.Quality)
	target := operationOutputPath(op, path, req)
	q := shellQuote(path)
	out := shellQuote(target)
	switch op.Operation {
	case "svg-minify":
		return fmt.Sprintf("svgo --input %s --output %s", q, q)
	case "resize-variant", "resize-replace":
		maxDimension := resizeMaxDimension(op, req)
		if maxDimension <= 0 {
			maxDimension = 1200
		}
		return fmt.Sprintf("aisets-imgtools resize --max-dimension %d %s %s", maxDimension, q, out)
	case "convert-avif", "convert-webp", "webp-recompress", "gif-optimize", "png-recompress", "jpeg-recompress":
		if op.Tool != "" && op.Tool != "aisets-imgtools" {
			return externalCommandForOperation(op, path, target, req)
		}
		args := []string{
			"aisets-imgtools",
			"convert",
			"--format",
			op.OutputFormat,
			"--quality",
			fmt.Sprintf("%d", quality),
		}
		if op.Operation == "convert-avif" {
			speed := req.AvifSpeed
			if op.AvifSpeed > 0 {
				speed = op.AvifSpeed
			}
			if speed <= 0 {
				speed = 6
			}
			args = append(args, "--speed", fmt.Sprintf("%d", speed))
		}
		if maxDimension := resizeMaxDimension(op, req); op.ResizeMaxDimensionPx > 0 && maxDimension > 0 {
			args = append(args, "--resize", fmt.Sprintf("%d", maxDimension))
		}
		args = append(args, q, out)
		return strings.Join(args, " ")
	}
	return ""
}

func externalCommandForOperation(op Operation, path, target string, req Request) string {
	q := shellQuote(path)
	out := shellQuote(target)
	quality := formatQuality(op, req.Quality)
	switch op.Tool {
	case "svgo":
		return fmt.Sprintf("svgo --input %s --output %s", q, out)
	case "cwebp":
		return fmt.Sprintf("cwebp -q %d %s -o %s", quality, q, out)
	case "avifenc":
		speed := req.AvifSpeed
		if op.AvifSpeed > 0 {
			speed = op.AvifSpeed
		}
		if speed <= 0 {
			speed = 6
		}
		return fmt.Sprintf("avifenc --min %d --max %d --speed %d %s %s", quality, quality, speed, q, out)
	case "gifsicle":
		return fmt.Sprintf("gifsicle -O3 %s -o %s", q, out)
	case "ffmpeg":
		return fmt.Sprintf("ffmpeg -y -i %s %s", q, out)
	case "magick":
		maxDimension := resizeMaxDimension(op, req)
		if maxDimension <= 0 {
			maxDimension = 1200
		}
		return fmt.Sprintf("magick %s -resize %dx%d\\> %s", q, maxDimension, maxDimension, out)
	case "oxipng":
		return fmt.Sprintf("oxipng -o 4 --out %s %s", out, q)
	}
	return ""
}

func operationOutputPath(op Operation, path string, req Request) string {
	if op.Operation == "resize-variant" {
		return resizeTargetPath(path, resizeMaxDimension(op, req))
	}
	if op.TargetPath == op.RepoPath {
		return path
	}
	if op.OutputFormat == "" {
		return path
	}
	return replaceExt(path, "."+op.OutputFormat)
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
