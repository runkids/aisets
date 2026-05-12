package optimize

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"aisets/internal/actions"
	"aisets/internal/apierr"
	"aisets/internal/imageproc"
	"aisets/internal/scanner"
)

func ManualPlan(items []scanner.AssetItem, req Request) []Operation {
	return manualPlanWithTools(items, normalizeManualRequest(req), defaultToolChecker)
}

func manualPlanWithTools(items []scanner.AssetItem, req Request, hasTool toolChecker) []Operation {
	out := make([]Operation, 0, len(items))
	for _, item := range items {
		op := manualOperationForItem(item, req, hasTool)
		if op.Operation != "" {
			out = append(out, op)
		}
	}
	return out
}

func ManualPreview(project scanner.Project, items []scanner.AssetItem, req Request) (actions.Preview, error) {
	req = normalizeManualRequest(req)
	ops := ManualPlan(items, req)
	ops, blockers := measureOperations(project, ops, req, true, defaultToolChecker)
	changes, deletes, replacementBlockers := replacementEffects(project, items, ops, req)
	blockers = append(blockers, replacementBlockers...)
	payload := PreviewResult{Operations: ops, Blockers: blockers, Tools: ToolStatuses(ops)}
	return actions.Preview{
		ID:        newID("image-tools:" + project.ID + ":" + strings.Join(itemIDs(items), ",")),
		Type:      "optimization",
		ProjectID: project.ID,
		Changes:   changes,
		Deletes:   deletes,
		Blockers:  blockers,
		CanApply:  hasApplicableOperations(ops),
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
		Payload:   map[string]any{"optimization": payload},
	}, nil
}

func ProcessLocalFile(sourcePath, displayName string, sizeBytes int64, meta imageproc.Metadata, req Request) (Operation, string, error) {
	req = normalizeManualRequest(req)
	item := scanner.AssetItem{
		ID:        "upload:" + displayName,
		RepoPath:  displayName,
		LocalPath: sourcePath,
		Ext:       strings.ToLower(filepath.Ext(displayName)),
		Bytes:     sizeBytes,
		Image:     meta,
	}
	op := manualOperationForItem(item, req, defaultToolChecker)
	if !op.CanApply {
		if op.ReasonCode == "" {
			op.ReasonCode = "operation_unsupported"
		}
		if op.BlockedReason == "" {
			op.BlockedReason = "No automated operation is available for this file."
		}
		return op, "", apierr.New(op.ReasonCode, op.BlockedReason)
	}
	candidate, estimatedBytes, err := buildLocalCandidate(sourcePath, op, req)
	if err != nil {
		op.CanApply = false
		op.ReasonCode = actionErrorCode(err)
		op.BlockedReason = err.Error()
		return op, "", err
	}
	op.EstimatedBytes = estimatedBytes
	op.SavingsBytes = max(0, op.CurrentBytes-estimatedBytes)
	return op, candidate, nil
}

func normalizeManualRequest(req Request) Request {
	if req.OutputMode == "" {
		req.OutputMode = OutputModeSafeVariants
	}
	if req.Quality <= 0 || req.Quality > 100 {
		req.Quality = 80
	}
	if req.AvifSpeed <= 0 {
		req.AvifSpeed = 6
	}
	req.AllowLarger = true
	return req
}

func manualOperationForItem(item scanner.AssetItem, req Request, hasTool toolChecker) Operation {
	ext := strings.ToLower(filepath.Ext(item.RepoPath))
	if ext == "" {
		ext = strings.ToLower(item.Ext)
	}
	outputFormat := manualOutputFormat(req.OutputFormat, ext)
	op := Operation{
		AssetID:         item.ID,
		RepoPath:        item.RepoPath,
		ProjectName:     item.ProjectName,
		ScanIntent:      string(item.ScanIntent),
		SuggestionCode:  "manual_image_tool",
		Category:        "manual",
		Severity:        "info",
		InputFormat:     strings.TrimPrefix(ext, "."),
		OutputFormat:    outputFormat,
		OutputMode:      string(req.OutputMode),
		CurrentBytes:    item.Bytes,
		EstimatedBytes:  item.Bytes,
		Available:       true,
		CanApply:        true,
		ReferencePolicy: referencePolicy(item),
	}
	op.Operation = formatToOperation(outputFormat, ext)
	if req.MaxDimensionPx > 0 {
		op.ResizeMaxDimensionPx = req.MaxDimensionPx
	}
	op.Quality = req.Quality
	op.AvifSpeed = req.AvifSpeed
	if req.OutputMode == OutputModeReplace {
		op.TargetPath = item.RepoPath
	} else {
		op.TargetPath = manualTargetPath(item.RepoPath, outputFormat, req.MaxDimensionPx)
	}
	switch op.Operation {
	case "svg-minify":
		if strings.TrimPrefix(ext, ".") != "svg" {
			blockOperation(&op, "operation_unsupported", "SVG output is only supported for SVG input.")
			return op
		}
	case "convert-avif", "convert-webp", "webp-recompress", "gif-optimize", "png-recompress", "jpeg-recompress":
		op.Tool = "aisets-imgtools"
	default:
		blockOperation(&op, "operation_unsupported", "No automated operation is available for this format.")
		return op
	}
	op.Tool = selectToolForOperation(op, req, hasTool)
	if op.Tool != "" && !hasTool(op.Tool) {
		blockOperation(&op, "optimizer_tool_missing", fmt.Sprintf("Required optimizer tool is not installed: %s", op.Tool))
		op.Available = false
	}
	return op
}

func manualOutputFormat(raw, sourceExt string) string {
	format := imageproc.NormalizeOptimizationFormat(raw)
	if format == "" || format == "original" || format == "auto" {
		format = imageproc.NormalizeOptimizationFormat(sourceExt)
	}
	if format == "jpeg" {
		return "jpg"
	}
	return format
}

func manualTargetPath(path, outputFormat string, maxDimension int) string {
	ext := filepath.Ext(path)
	base := strings.TrimSuffix(path, ext)
	targetExt := "." + outputFormat
	if outputFormat == "jpg" {
		targetExt = ".jpg"
	}
	if maxDimension > 0 {
		return fmt.Sprintf("%s@%d%s", base, maxDimension, targetExt)
	}
	if strings.EqualFold(ext, targetExt) {
		return base + "-processed" + targetExt
	}
	return base + targetExt
}

func buildLocalCandidate(source string, op Operation, req Request) (string, int64, error) {
	switch op.Operation {
	case "svg-minify":
		if op.Tool == "svgo" {
			return buildExternalCandidate(source, op, req)
		}
		return buildSVGMinifyCandidate(source)
	default:
		if op.Tool != "" && op.Tool != "aisets-imgtools" {
			return buildExternalCandidate(source, op, req)
		}
		return buildImgtoolsCandidate(source, op, req)
	}
}

func RemoveCandidate(path string) {
	if path != "" {
		_ = os.Remove(path)
	}
}
