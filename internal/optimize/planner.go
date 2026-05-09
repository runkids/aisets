package optimize

import (
	"context"
	"crypto/sha1"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"asset-studio/internal/actions"
	"asset-studio/internal/apierr"
	"asset-studio/internal/imageproc"
	"asset-studio/internal/imgtools"
	"asset-studio/internal/scanner"

	minify "github.com/tdewolff/minify/v2"
	minifysvg "github.com/tdewolff/minify/v2/svg"
)

type Strategy string
type OutputMode string

const (
	StrategyConservative Strategy = "conservative"

	OutputModeSafeVariants OutputMode = "safeVariants"
	OutputModeReplace      OutputMode = "replace"
)

type Request struct {
	AssetIDs              []string                             `json:"assetIds"`
	Strategy              Strategy                             `json:"strategy"`
	OutputMode            OutputMode                           `json:"outputMode"`
	UpdateReferences      bool                                 `json:"updateReferences"`
	Quality               int                                  `json:"quality"`
	MaxDimensionPx        int                                  `json:"maxDimensionPx"`
	AvifSpeed             int                                  `json:"avifSpeed"`
	Workers               int                                  `json:"workers"`
	Strategies            []imageproc.OptimizationStrategy     `json:"optimizationStrategies,omitempty"`
	ExternalTools         []imageproc.OptimizationExternalTool `json:"optimizationExternalTools,omitempty"`
	StrategyHash          string                               `json:"optimizationStrategyHash,omitempty"`
	OutputFormatOverrides map[string]string                    `json:"outputFormatOverrides,omitempty"`
}

type Operation struct {
	AssetID              string   `json:"assetId"`
	RepoPath             string   `json:"repoPath"`
	ProjectName          string   `json:"projectName"`
	ScanIntent           string   `json:"scanIntent"`
	Operation            string   `json:"operation"`
	SuggestionCode       string   `json:"suggestionCode"`
	Category             string   `json:"category"`
	Severity             string   `json:"severity"`
	InputFormat          string   `json:"inputFormat"`
	OutputFormat         string   `json:"outputFormat"`
	OutputMode           string   `json:"outputMode"`
	TargetPath           string   `json:"targetPath"`
	ResizeMaxDimensionPx int      `json:"resizeMaxDimensionPx,omitempty"`
	Quality              int      `json:"quality,omitempty"`
	AvifSpeed            int      `json:"avifSpeed,omitempty"`
	CurrentBytes         int64    `json:"currentBytes"`
	EstimatedBytes       int64    `json:"estimatedBytes"`
	SavingsBytes         int64    `json:"savingsBytes"`
	Tool                 string   `json:"tool,omitempty"`
	Available            bool     `json:"available"`
	CanApply             bool     `json:"canApply"`
	ReasonCode           string   `json:"reasonCode,omitempty"`
	BlockedReason        string   `json:"blockedReason,omitempty"`
	ReferencePolicy      string   `json:"referencePolicy"`
	ReferenceEditCount   int      `json:"referenceEditCount"`
	CandidatePath        string   `json:"candidatePath,omitempty"`
	Warnings             []string `json:"warnings,omitempty"`
}

type ToolStatus struct {
	Name      string `json:"name"`
	Required  bool   `json:"required"`
	Available bool   `json:"available"`
}

type PreviewResult struct {
	Operations []Operation       `json:"operations"`
	Blockers   []actions.Blocker `json:"blockers"`
	Tools      []ToolStatus      `json:"tools"`
}

type toolChecker func(string) bool

func normalizeRequest(req Request) Request {
	if req.Strategy == "" {
		req.Strategy = StrategyConservative
	}
	if req.OutputMode == "" {
		req.OutputMode = OutputModeSafeVariants
	}
	if req.Quality <= 0 || req.Quality > 100 {
		req.Quality = 80
	}
	if req.MaxDimensionPx <= 0 {
		req.MaxDimensionPx = 1200
	}
	if req.AvifSpeed <= 0 {
		req.AvifSpeed = 6
	}
	req.Strategies = imageproc.NormalizeOptimizationStrategies(req.Strategies)
	return req
}

func Plan(items []scanner.AssetItem, req Request) []Operation {
	return planWithTools(items, normalizeRequest(req), defaultToolChecker)
}

func planWithTools(items []scanner.AssetItem, req Request, hasTool toolChecker) []Operation {
	out := make([]Operation, 0, len(items))
	for _, item := range items {
		if len(item.Optimization) == 0 {
			continue
		}
		op := operationForItem(item, req, hasTool)
		if op.Operation == "" {
			continue
		}
		out = append(out, op)
	}
	return out
}

func operationForItem(item scanner.AssetItem, req Request, hasTool toolChecker) Operation {
	primary := primaryRecommendation(item.Optimization)
	ext := strings.ToLower(filepath.Ext(item.RepoPath))
	op := Operation{
		AssetID:         item.ID,
		RepoPath:        item.RepoPath,
		ProjectName:     item.ProjectName,
		ScanIntent:      string(item.ScanIntent),
		SuggestionCode:  primary.SuggestionCode,
		Category:        primary.Category,
		Severity:        primary.Severity,
		InputFormat:     strings.TrimPrefix(ext, "."),
		OutputMode:      string(req.OutputMode),
		CurrentBytes:    item.Bytes,
		EstimatedBytes:  primary.EstimatedBytes,
		SavingsBytes:    primary.SavingsBytes,
		Available:       true,
		CanApply:        true,
		ReferencePolicy: referencePolicy(item),
	}
	planned := strategyOperationForItem(item, req)
	op.Operation = planned.Operation
	op.ResizeMaxDimensionPx = planned.ResizeMaxDimensionPx
	op.Quality = planned.Quality
	op.AvifSpeed = planned.AvifSpeed
	if op.Operation == "" {
		op.Operation = SuggestionOperation(primary.SuggestionCode, ext)
	}
	if overrideFmt, ok := req.OutputFormatOverrides[item.ID]; ok && overrideFmt != "" && overrideFmt != "auto" {
		op.Operation = formatToOperation(overrideFmt, ext)
	}
	switch op.Operation {
	case "svg-minify":
		op.OutputFormat = "svg"
		op.TargetPath = item.RepoPath
	case "resize-variant":
		op.OutputFormat = strings.TrimPrefix(ext, ".")
		op.TargetPath = resizeTargetPath(item.RepoPath, resizeMaxDimension(op, req))
		if req.OutputMode == OutputModeReplace {
			op.Operation = "resize-replace"
			op.TargetPath = item.RepoPath
		}
	case "convert-avif":
		op.OutputFormat = "avif"
		op.TargetPath = replaceExt(item.RepoPath, ".avif")
		op.Tool = "asset-studio-imgtools"
	case "convert-webp":
		op.OutputFormat = "webp"
		op.TargetPath = replaceExt(item.RepoPath, ".webp")
		op.Tool = "asset-studio-imgtools"
	case "webp-recompress":
		op.OutputFormat = "webp"
		op.TargetPath = item.RepoPath
		op.Tool = "asset-studio-imgtools"
	case "gif-optimize":
		op.OutputFormat = "gif"
		op.TargetPath = item.RepoPath
	case "png-recompress":
		op.OutputFormat = "png"
		op.TargetPath = item.RepoPath
	case "jpeg-recompress":
		op.OutputFormat = "jpg"
		op.TargetPath = item.RepoPath
	default:
		op.Operation = "manual-review"
		op.OutputFormat = strings.TrimPrefix(ext, ".")
		op.TargetPath = item.RepoPath
		op.CanApply = false
		op.BlockedReason = "No automated operation is available for this recommendation."
		op.ReasonCode = "operation_unsupported"
	}
	op.Tool = selectToolForOperation(op, req, hasTool)
	if op.Tool != "" && !hasTool(op.Tool) {
		op.Available = false
		op.CanApply = false
		op.ReasonCode = "optimizer_tool_missing"
		op.BlockedReason = fmt.Sprintf("Required optimizer tool is not installed: %s", op.Tool)
	}
	if op.ReferencePolicy != "canUpdateReferences" && op.TargetPath != item.RepoPath && op.CanApply {
		op.Warnings = append(op.Warnings, "Conversion creates a sibling file; references and original cleanup require manual review.")
	}
	if op.EstimatedBytes == 0 && op.SavingsBytes > 0 {
		op.EstimatedBytes = max(0, op.CurrentBytes-op.SavingsBytes)
	}
	return op
}

type plannedStrategyOperation struct {
	Operation            string
	ResizeMaxDimensionPx int
	Quality              int
	AvifSpeed            int
}

func strategyOperationForItem(item scanner.AssetItem, req Request) plannedStrategyOperation {
	var resize *imageproc.OptimizationStrategy
	var transform *imageproc.OptimizationStrategy
	for index := range req.Strategies {
		strategy := &req.Strategies[index]
		if !strategy.Enabled || !strategyMatchesItem(*strategy, item, req) {
			continue
		}
		if strategy.Action.Operation == "resize" && resize == nil {
			resize = strategy
			continue
		}
		if strategy.Action.Operation != "resize" && transform == nil {
			transform = strategy
		}
	}
	if transform == nil && resize == nil {
		return plannedStrategyOperation{}
	}
	if transform == nil {
		return operationFromStrategy(*resize, req, false)
	}
	out := operationFromStrategy(*transform, req, resize != nil)
	if resize != nil {
		out.ResizeMaxDimensionPx = strategyResizeMax(*resize, req)
	}
	return out
}

func strategyMatchesItem(strategy imageproc.OptimizationStrategy, item scanner.AssetItem, req Request) bool {
	format := imageproc.NormalizeOptimizationFormat(item.Ext)
	if format == "" {
		format = imageproc.NormalizeOptimizationFormat(filepath.Ext(item.RepoPath))
	}
	if len(strategy.Match.Formats) > 0 && !containsString(strategy.Match.Formats, format) {
		return false
	}
	switch strategy.Match.Alpha {
	case "transparent":
		if !item.Image.Alpha {
			return false
		}
	case "opaque":
		if item.Image.Alpha {
			return false
		}
	}
	switch strategy.Match.Animated {
	case "true":
		if !item.Image.Animated {
			return false
		}
	case "false":
		if item.Image.Animated {
			return false
		}
	}
	if strategy.Match.MinBytesKB != nil && item.Bytes < int64(*strategy.Match.MinBytesKB)*1024 {
		return false
	}
	if strategy.Match.MinWidthPx != nil && item.Image.Width < *strategy.Match.MinWidthPx {
		return false
	}
	if strategy.Match.MinHeightPx != nil && item.Image.Height < *strategy.Match.MinHeightPx {
		return false
	}
	if strategy.Action.Operation == "resize" {
		maxDimension := strategyResizeMax(strategy, req)
		if maxDimension <= 0 || (item.Image.Width <= maxDimension && item.Image.Height <= maxDimension) {
			return false
		}
	}
	return true
}

func operationFromStrategy(strategy imageproc.OptimizationStrategy, req Request, withResize bool) plannedStrategyOperation {
	out := plannedStrategyOperation{
		Quality:   strategyQuality(strategy, req),
		AvifSpeed: strategyAvifSpeed(strategy, req),
	}
	outputFormat := imageproc.NormalizeOptimizationFormat(strategy.Action.OutputFormat)
	switch strategy.Action.Operation {
	case "svg-minify":
		out.Operation = "svg-minify"
	case "resize":
		out.Operation = "resize-variant"
		out.ResizeMaxDimensionPx = strategyResizeMax(strategy, req)
	case "convert":
		out.Operation = "convert-" + outputFormat
	case "recompress":
		switch outputFormat {
		case "webp":
			out.Operation = "webp-recompress"
		case "gif":
			out.Operation = "gif-optimize"
		case "png":
			out.Operation = "png-recompress"
		case "jpg":
			out.Operation = "jpeg-recompress"
		default:
			out.Operation = "manual-review"
		}
	}
	if withResize && out.ResizeMaxDimensionPx == 0 {
		out.ResizeMaxDimensionPx = req.MaxDimensionPx
	}
	return out
}

func strategyQuality(strategy imageproc.OptimizationStrategy, req Request) int {
	if strategy.Action.Quality != nil {
		return *strategy.Action.Quality
	}
	return req.Quality
}

func strategyAvifSpeed(strategy imageproc.OptimizationStrategy, req Request) int {
	if strategy.Action.AvifSpeed != nil {
		return *strategy.Action.AvifSpeed
	}
	return req.AvifSpeed
}

func strategyResizeMax(strategy imageproc.OptimizationStrategy, req Request) int {
	if strategy.Action.ResizeMaxDimensionPx != nil && *strategy.Action.ResizeMaxDimensionPx > 0 {
		return *strategy.Action.ResizeMaxDimensionPx
	}
	return req.MaxDimensionPx
}

func primaryRecommendation(recs []scanner.OptimizationSuggestion) scanner.OptimizationSuggestion {
	best := recs[0]
	for _, r := range recs[1:] {
		if severityRank(r.Severity) > severityRank(best.Severity) {
			best = r
		}
	}
	return best
}

func severityRank(severity string) int {
	switch severity {
	case "critical":
		return 3
	case "warning":
		return 2
	case "info":
		return 1
	default:
		return 0
	}
}

func referencePolicy(item scanner.AssetItem) string {
	if item.ScanIntent == scanner.ProjectScanIntentCode && len(item.References) > 0 {
		return "canUpdateReferences"
	}
	if item.ScanIntent == scanner.ProjectScanIntentCode {
		return "noReferences"
	}
	return "manualReview"
}

func defaultToolChecker(name string) bool {
	if name == "asset-studio-imgtools" {
		return imgtools.Available()
	}
	_, err := exec.LookPath(name)
	return err == nil
}

func resizeMaxDimension(op Operation, req Request) int {
	if op.ResizeMaxDimensionPx > 0 {
		return op.ResizeMaxDimensionPx
	}
	return req.MaxDimensionPx
}

func selectToolForOperation(op Operation, req Request, hasTool toolChecker) string {
	if op.Operation == "" || op.Operation == "manual-review" {
		return ""
	}
	if op.Operation == "svg-minify" {
		if externalToolEnabled(req, "svgo") {
			return "svgo"
		}
		return ""
	}
	if hasTool("asset-studio-imgtools") {
		return "asset-studio-imgtools"
	}
	for _, candidate := range externalToolCandidates(op.Operation) {
		if externalToolEnabled(req, candidate) {
			return candidate
		}
	}
	return "asset-studio-imgtools"
}

func externalToolEnabled(req Request, id string) bool {
	for _, tool := range req.ExternalTools {
		if tool.ID == id && tool.Enabled {
			return true
		}
	}
	return false
}

func externalToolCandidates(operation string) []string {
	switch operation {
	case "convert-avif":
		return []string{"avifenc"}
	case "convert-webp", "webp-recompress":
		return []string{"cwebp", "ffmpeg"}
	case "gif-optimize":
		return []string{"gifsicle", "ffmpeg"}
	case "resize-variant", "resize-replace":
		return []string{"magick"}
	case "png-recompress":
		return []string{"oxipng"}
	}
	return nil
}

func resizeTargetPath(path string, maxDimension int) string {
	ext := filepath.Ext(path)
	return strings.TrimSuffix(path, ext) + fmt.Sprintf("@%d", maxDimension) + ext
}

func ToolStatuses(ops []Operation) []ToolStatus {
	required := map[string]bool{}
	for _, op := range ops {
		if op.Tool != "" {
			required[op.Tool] = true
		}
	}
	names := make([]string, 0, len(required))
	for name := range required {
		names = append(names, name)
	}
	sort.Strings(names)
	out := make([]ToolStatus, 0, len(names))
	for _, name := range names {
		out = append(out, ToolStatus{Name: name, Required: true, Available: defaultToolChecker(name)})
	}
	return out
}

func Preview(project scanner.Project, items []scanner.AssetItem, req Request) (actions.Preview, error) {
	req = normalizeRequest(req)
	ops := Plan(items, req)
	ops, blockers := measureOperations(project, ops, req, true, defaultToolChecker)
	changes, deletes, replacementBlockers := replacementEffects(project, items, ops, req)
	blockers = append(blockers, replacementBlockers...)
	payload := PreviewResult{Operations: ops, Blockers: blockers, Tools: ToolStatuses(ops)}
	return actions.Preview{
		ID:        newID("optimization:" + project.ID + ":" + strings.Join(itemIDs(items), ",")),
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

func EstimateOperations(project scanner.Project, ops []Operation, req Request) ([]Operation, []actions.Blocker) {
	return measureOperations(project, ops, normalizeRequest(req), false, defaultToolChecker)
}

type ProjectOperation struct {
	Project scanner.Project
	Op      Operation
}

func StreamMeasureOperations(ctx context.Context, items []ProjectOperation, req Request, workers int, onResult func(Operation)) {
	if workers <= 0 {
		workers = 4
	}
	req = normalizeRequest(req)
	hasTool := defaultToolChecker

	jobs := make(chan ProjectOperation)
	results := make(chan Operation, workers)
	var wg sync.WaitGroup

	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				results <- measureSingleOperation(j.Project, j.Op, req, hasTool)
			}
		}()
	}

	go func() {
		defer close(jobs)
		for _, item := range items {
			select {
			case <-ctx.Done():
				return
			case jobs <- item:
			}
		}
	}()

	go func() {
		wg.Wait()
		close(results)
	}()

	for op := range results {
		onResult(op)
	}
}

func measureSingleOperation(project scanner.Project, op Operation, req Request, hasTool toolChecker) Operation {
	if !op.CanApply {
		if op.EstimatedBytes == 0 {
			op.EstimatedBytes = op.CurrentBytes
		}
		op.SavingsBytes = 0
		return op
	}
	candidate, estimatedBytes, err := buildCandidate(project, op, req)
	if err != nil {
		op.CanApply = false
		op.ReasonCode = actionErrorCode(err)
		op.BlockedReason = err.Error()
		if op.EstimatedBytes == 0 {
			op.EstimatedBytes = op.CurrentBytes
		}
		op.SavingsBytes = 0
		if op.Operation == "gif-optimize" {
			gifFallbackToWebP(&op, hasTool)
		}
		return op
	}
	_ = os.Remove(candidate)
	if estimatedBytes > 0 {
		op.EstimatedBytes = estimatedBytes
		op.SavingsBytes = max(0, op.CurrentBytes-estimatedBytes)
	}
	if op.SavingsBytes <= 0 {
		op.CanApply = false
		op.ReasonCode = "no_effective_savings"
		op.BlockedReason = "Candidate output is not smaller than the original."
		if op.Operation == "gif-optimize" {
			gifTryWebPSingleOp(project, &op, req, hasTool)
		}
	}
	return op
}

func gifTryWebPSingleOp(project scanner.Project, op *Operation, req Request, hasTool toolChecker) {
	gifFallbackToWebP(op, hasTool)
	if !hasTool("asset-studio-imgtools") {
		return
	}
	candidate, fbBytes, err := buildCandidate(project, *op, req)
	if err != nil || fbBytes >= op.CurrentBytes {
		if candidate != "" {
			_ = os.Remove(candidate)
		}
		return
	}
	_ = os.Remove(candidate)
	op.EstimatedBytes = fbBytes
	op.SavingsBytes = op.CurrentBytes - fbBytes
	op.CanApply = true
	op.Available = true
	op.ReasonCode = ""
	op.BlockedReason = ""
}

func measureOperations(project scanner.Project, ops []Operation, req Request, keepCandidates bool, hasTool toolChecker) ([]Operation, []actions.Blocker) {
	blockers := []actions.Blocker{}
	for index := range ops {
		if !ops[index].CanApply {
			if ops[index].EstimatedBytes == 0 {
				ops[index].EstimatedBytes = ops[index].CurrentBytes
			}
			ops[index].SavingsBytes = 0
			blockers = append(blockers, actions.Blocker{File: ops[index].RepoPath, Code: ops[index].ReasonCode, Reason: ops[index].BlockedReason})
			continue
		}
		candidate, estimatedBytes, err := buildCandidate(project, ops[index], req)
		if err != nil {
			ops[index].CanApply = false
			ops[index].ReasonCode = actionErrorCode(err)
			ops[index].BlockedReason = err.Error()
			if ops[index].EstimatedBytes == 0 {
				ops[index].EstimatedBytes = ops[index].CurrentBytes
			}
			ops[index].SavingsBytes = 0
			if ops[index].Operation == "gif-optimize" {
				gifFallbackToWebP(&ops[index], hasTool)
			}
			blockers = append(blockers, actions.Blocker{File: ops[index].RepoPath, Code: ops[index].ReasonCode, Reason: ops[index].BlockedReason})
			continue
		}
		if keepCandidates {
			ops[index].CandidatePath = candidate
		} else {
			_ = os.Remove(candidate)
		}
		if estimatedBytes > 0 {
			ops[index].EstimatedBytes = estimatedBytes
			ops[index].SavingsBytes = max(0, ops[index].CurrentBytes-estimatedBytes)
		}
		if ops[index].SavingsBytes <= 0 {
			ops[index].CanApply = false
			ops[index].ReasonCode = "no_effective_savings"
			ops[index].BlockedReason = "Candidate output is not smaller than the original."
			if keepCandidates {
				_ = os.Remove(candidate)
				ops[index].CandidatePath = ""
			}

			if ops[index].Operation == "gif-optimize" {
				if gifTryWebPCandidate(project, &ops[index], req, keepCandidates, hasTool) {
					continue
				}
			}

			blockers = append(blockers, actions.Blocker{File: ops[index].RepoPath, Code: ops[index].ReasonCode, Reason: ops[index].BlockedReason})
		}
	}
	return ops, blockers
}

func gifFallbackToWebP(op *Operation, hasTool toolChecker) {
	op.Operation = "convert-webp"
	op.OutputFormat = "webp"
	op.TargetPath = replaceExt(op.RepoPath, ".webp")
	op.Tool = "asset-studio-imgtools"
	op.CanApply = false
	if !hasTool("asset-studio-imgtools") {
		op.Available = false
		op.ReasonCode = "optimizer_tool_missing"
		op.BlockedReason = "Required optimizer tool is not installed: asset-studio-imgtools"
	}
}

func gifTryWebPCandidate(project scanner.Project, op *Operation, req Request, keepCandidates bool, hasTool toolChecker) bool {
	gifFallbackToWebP(op, hasTool)
	if !hasTool("asset-studio-imgtools") {
		return false
	}
	candidate, fbBytes, err := buildCandidate(project, *op, req)
	if err != nil || fbBytes >= op.CurrentBytes {
		if candidate != "" {
			_ = os.Remove(candidate)
		}
		return false
	}
	op.CandidatePath = candidate
	op.EstimatedBytes = fbBytes
	op.SavingsBytes = op.CurrentBytes - fbBytes
	op.CanApply = true
	op.Available = true
	op.ReasonCode = ""
	op.BlockedReason = ""
	if !keepCandidates {
		_ = os.Remove(candidate)
		op.CandidatePath = ""
	}
	return true
}

func replacementEffects(project scanner.Project, items []scanner.AssetItem, ops []Operation, req Request) ([]actions.Change, []string, []actions.Blocker) {
	if req.OutputMode != OutputModeReplace {
		return nil, nil, nil
	}
	itemsByID := make(map[string]scanner.AssetItem, len(items))
	for _, item := range items {
		itemsByID[item.ID] = item
	}
	var changes []actions.Change
	var deletes []string
	var blockers []actions.Blocker
	for index := range ops {
		op := &ops[index]
		if !op.CanApply || op.TargetPath == op.RepoPath {
			continue
		}
		item, ok := itemsByID[op.AssetID]
		if !ok {
			blockOperation(op, "asset_not_found", "Asset was not found in the preview selection.")
			blockers = append(blockers, actions.Blocker{File: op.RepoPath, Code: op.ReasonCode, Reason: op.BlockedReason})
			continue
		}
		if item.ScanIntent != scanner.ProjectScanIntentCode {
			blockOperation(op, "replace_requires_code_project", "Replacing converted output is only supported for code projects with safe reference coverage.")
			blockers = append(blockers, actions.Blocker{File: op.RepoPath, Code: op.ReasonCode, Reason: op.BlockedReason})
			continue
		}
		if len(item.References) > 0 {
			if !req.UpdateReferences {
				blockOperation(op, "replace_requires_reference_update", "Referenced conversions must update references before deleting the original file.")
				blockers = append(blockers, actions.Blocker{File: op.RepoPath, Code: op.ReasonCode, Reason: op.BlockedReason})
				continue
			}
			refChanges, refBlockers := actions.ReferenceChanges(project, item, op.TargetPath)
			if len(refBlockers) > 0 {
				blockOperation(op, "reference_update_blocked", "One or more references cannot be safely updated.")
				blockers = append(blockers, refBlockers...)
				continue
			}
			op.ReferenceEditCount = len(refChanges)
			changes = append(changes, refChanges...)
		}
		deletes = append(deletes, op.RepoPath)
	}
	return changes, deletes, blockers
}

func blockOperation(op *Operation, code, reason string) {
	op.CanApply = false
	op.ReasonCode = code
	op.BlockedReason = reason
	op.SavingsBytes = 0
	op.EstimatedBytes = op.CurrentBytes
	if op.CandidatePath != "" {
		_ = os.Remove(op.CandidatePath)
		op.CandidatePath = ""
	}
}

func Apply(project scanner.Project, preview actions.Preview) (actions.ApplyResult, error) {
	if !preview.CanApply {
		return actions.ApplyResult{}, apierr.New("preview_has_blockers", "preview has blockers")
	}
	payload, err := previewPayload(preview)
	if err != nil {
		return actions.ApplyResult{}, err
	}
	if err := actions.ValidateReferenceChanges(project, preview.Changes); err != nil {
		return actions.ApplyResult{}, err
	}
	result := actions.ApplyResult{AppliedAt: time.Now().UTC().Format(time.RFC3339)}
	for _, op := range payload.Operations {
		if !op.CanApply {
			continue
		}
		targetAbs, err := safeAbs(project.Path, op.TargetPath)
		if err != nil {
			return actions.ApplyResult{}, err
		}
		if op.CandidatePath == "" {
			return actions.ApplyResult{}, apierr.WithParams("preview_stale_missing_candidate", "preview is stale: missing optimization candidate", map[string]any{"assetId": op.AssetID})
		}
		if _, err := os.Stat(op.CandidatePath); err != nil {
			return actions.ApplyResult{}, apierr.WithParams("preview_stale_missing_candidate", "preview is stale: missing optimization candidate", map[string]any{"assetId": op.AssetID})
		}
		if op.TargetPath != op.RepoPath {
			if _, err := os.Stat(targetAbs); err == nil {
				return actions.ApplyResult{}, apierr.WithParams("target_already_exists", "target already exists", map[string]any{"targetPath": op.TargetPath})
			}
		}
		if err := os.MkdirAll(filepath.Dir(targetAbs), 0o755); err != nil {
			return actions.ApplyResult{}, err
		}
		tmp, err := os.CreateTemp(filepath.Dir(targetAbs), ".asset-studio-optimize-*")
		if err != nil {
			return actions.ApplyResult{}, err
		}
		tmpPath := tmp.Name()
		copyErr := copyFile(tmp, op.CandidatePath)
		closeErr := tmp.Close()
		if copyErr != nil {
			_ = os.Remove(tmpPath)
			return actions.ApplyResult{}, copyErr
		}
		if closeErr != nil {
			_ = os.Remove(tmpPath)
			return actions.ApplyResult{}, closeErr
		}
		if err := os.Rename(tmpPath, targetAbs); err != nil {
			_ = os.Remove(tmpPath)
			return actions.ApplyResult{}, err
		}
		result.MovedFiles++
	}
	if result.MovedFiles == 0 {
		return actions.ApplyResult{}, apierr.New("preview_has_blockers", "preview has blockers")
	}
	if err := actions.ApplyReferenceChanges(project, preview.Changes); err != nil {
		return actions.ApplyResult{}, err
	}
	result.ChangedReferences = len(preview.Changes)
	for _, deletePath := range preview.Deletes {
		abs, err := safeAbs(project.Path, deletePath)
		if err != nil {
			return actions.ApplyResult{}, err
		}
		if err := os.Remove(abs); err != nil && !errors.Is(err, os.ErrNotExist) {
			return actions.ApplyResult{}, err
		}
		result.DeletedFiles++
	}
	return result, nil
}

func hasApplicableOperations(ops []Operation) bool {
	for _, op := range ops {
		if op.CanApply {
			return true
		}
	}
	return false
}

func previewPayload(preview actions.Preview) (PreviewResult, error) {
	raw, ok := preview.Payload["optimization"]
	if !ok {
		return PreviewResult{}, apierr.New("preview_payload_missing", "preview payload is missing")
	}
	bytes, err := json.Marshal(raw)
	if err != nil {
		return PreviewResult{}, err
	}
	var payload PreviewResult
	if err := json.Unmarshal(bytes, &payload); err != nil {
		return PreviewResult{}, err
	}
	return payload, nil
}

func buildCandidate(project scanner.Project, op Operation, req Request) (string, int64, error) {
	sourceAbs, err := safeAbs(project.Path, op.RepoPath)
	if err != nil {
		return "", 0, err
	}
	switch op.Operation {
	case "svg-minify":
		if op.Tool == "svgo" {
			return buildExternalCandidate(sourceAbs, op, req)
		}
		return buildSVGMinifyCandidate(sourceAbs)
	default:
		if op.Tool != "" && op.Tool != "asset-studio-imgtools" {
			return buildExternalCandidate(sourceAbs, op, req)
		}
		return buildImgtoolsCandidate(sourceAbs, op, req)
	}
}

func buildSVGMinifyCandidate(source string) (string, int64, error) {
	bytes, err := os.ReadFile(source)
	if err != nil {
		return "", 0, err
	}
	m := minify.New()
	m.AddFunc("image/svg+xml", minifysvg.Minify)
	minified, err := m.Bytes("image/svg+xml", bytes)
	if err != nil {
		return "", 0, err
	}
	return writeCandidate(source, ".svg", minified)
}

func formatQuality(op Operation, reqQuality int) int {
	if op.Quality > 0 {
		return op.Quality
	}
	if reqQuality > 0 {
		return reqQuality
	}
	switch op.Operation {
	case "convert-avif":
		return 50
	case "convert-webp":
		return 80
	case "webp-recompress":
		return 60
	case "gif-optimize":
		return 75
	default:
		return 80
	}
}

func buildImgtoolsCandidate(source string, op Operation, req Request) (string, int64, error) {
	bin, err := imgtools.Binary()
	if err != nil {
		return "", 0, apierr.WithParams("optimizer_tool_missing", "asset-studio-imgtools not found", map[string]any{"tool": "asset-studio-imgtools"})
	}
	ext := "." + op.OutputFormat
	target, err := os.CreateTemp("", "asset-studio-optimize-*"+ext)
	if err != nil {
		return "", 0, err
	}
	targetPath := target.Name()
	_ = target.Close()

	quality := formatQuality(op, req.Quality)
	args := []string{"convert", "--format", op.OutputFormat, "--quality", fmt.Sprintf("%d", quality)}
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
	if maxDimension := resizeMaxDimension(op, req); maxDimension > 0 && (op.Operation == "resize-variant" || op.Operation == "resize-replace" || op.ResizeMaxDimensionPx > 0) {
		args = append(args, "--resize", fmt.Sprintf("%d", maxDimension))
	}
	args = append(args, source, targetPath)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		_ = os.Remove(targetPath)
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return "", 0, apierr.WithParams("optimizer_tool_timeout", "optimizer tool timed out", map[string]any{"tool": "asset-studio-imgtools"})
		}
		return "", 0, apierr.WithParams("optimizer_tool_failed", "optimizer tool failed", map[string]any{"tool": "asset-studio-imgtools", "output": string(out)})
	}
	info, err := os.Stat(targetPath)
	if err != nil {
		return "", 0, err
	}
	return targetPath, info.Size(), nil
}

func buildExternalCandidate(source string, op Operation, req Request) (string, int64, error) {
	ext := "." + op.OutputFormat
	target, err := os.CreateTemp("", "asset-studio-optimize-*"+ext)
	if err != nil {
		return "", 0, err
	}
	targetPath := target.Name()
	_ = target.Close()

	quality := formatQuality(op, req.Quality)
	var cmd *exec.Cmd
	switch op.Tool {
	case "svgo":
		cmd = exec.Command("svgo", "--input", source, "--output", targetPath)
	case "cwebp":
		cmd = exec.Command("cwebp", "-q", fmt.Sprintf("%d", quality), source, "-o", targetPath)
	case "avifenc":
		cmd = exec.Command("avifenc", "--min", fmt.Sprintf("%d", quality), "--max", fmt.Sprintf("%d", quality), source, targetPath)
	case "gifsicle":
		cmd = exec.Command("gifsicle", "--optimize=3", "--output", targetPath, source)
	case "magick":
		cmd = exec.Command("magick", source, "-resize", fmt.Sprintf("%dx%d>", resizeMaxDimension(op, req), resizeMaxDimension(op, req)), targetPath)
	case "oxipng":
		copyBytes, err := os.ReadFile(source)
		if err != nil {
			_ = os.Remove(targetPath)
			return "", 0, err
		}
		if err := os.WriteFile(targetPath, copyBytes, 0o644); err != nil {
			_ = os.Remove(targetPath)
			return "", 0, err
		}
		cmd = exec.Command("oxipng", "-o", "4", "--strip", "safe", targetPath)
	case "ffmpeg":
		cmd = exec.Command("ffmpeg", "-y", "-i", source, targetPath)
	default:
		_ = os.Remove(targetPath)
		return "", 0, apierr.WithParams("optimizer_tool_missing", "optimizer tool is not available", map[string]any{"tool": op.Tool})
	}
	if out, err := cmd.CombinedOutput(); err != nil {
		_ = os.Remove(targetPath)
		return "", 0, apierr.WithParams("optimizer_tool_failed", "optimizer tool failed", map[string]any{"tool": op.Tool, "output": string(out)})
	}
	info, err := os.Stat(targetPath)
	if err != nil {
		return "", 0, err
	}
	return targetPath, info.Size(), nil
}

func writeCandidate(source, ext string, bytes []byte) (string, int64, error) {
	target, err := os.CreateTemp("", "asset-studio-optimize-*"+ext)
	if err != nil {
		return "", 0, err
	}
	path := target.Name()
	if _, err := target.Write(bytes); err != nil {
		_ = target.Close()
		_ = os.Remove(path)
		return "", 0, err
	}
	if err := target.Close(); err != nil {
		_ = os.Remove(path)
		return "", 0, err
	}
	return path, int64(len(bytes)), nil
}

func copyFile(dst io.Writer, source string) error {
	src, err := os.Open(source)
	if err != nil {
		return err
	}
	defer src.Close()
	_, err = io.Copy(dst, src)
	return err
}

func safeAbs(root, repoPath string) (string, error) {
	repoPath = filepath.ToSlash(filepath.Clean(strings.TrimSpace(repoPath)))
	if repoPath == "." || repoPath == "" {
		return "", apierr.New("empty_path", "empty path")
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	abs := filepath.Join(absRoot, filepath.FromSlash(repoPath))
	abs, err = filepath.Abs(abs)
	if err != nil {
		return "", err
	}
	if abs != absRoot && !strings.HasPrefix(abs, absRoot+string(filepath.Separator)) {
		return "", apierr.New("path_escapes_project_root", "path escapes project root")
	}
	return abs, nil
}

func itemIDs(items []scanner.AssetItem) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		if item.ID != "" {
			ids = append(ids, item.ID)
		}
	}
	return ids
}

func newID(seed string) string {
	sum := sha1.Sum([]byte(fmt.Sprintf("%s:%d", seed, time.Now().UnixNano())))
	return fmt.Sprintf("%x", sum[:8])
}

func actionErrorCode(err error) string {
	if coded, ok := err.(apierr.Error); ok {
		return coded.Code
	}
	if errors.Is(err, exec.ErrNotFound) {
		return "optimizer_tool_missing"
	}
	return "optimization_preview_failed"
}
