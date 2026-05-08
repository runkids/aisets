package optimize

import (
	"bytes"
	"crypto/sha1"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"asset-studio/internal/actions"
	"asset-studio/internal/apierr"
	"asset-studio/internal/scanner"

	"github.com/gen2brain/avif"
	minify "github.com/tdewolff/minify/v2"
	minifysvg "github.com/tdewolff/minify/v2/svg"
	"golang.org/x/image/draw"
)

type Strategy string
type OutputMode string

const (
	StrategyConservative Strategy = "conservative"

	OutputModeSafeVariants OutputMode = "safeVariants"
	OutputModeReplace      OutputMode = "replace"
)

type Request struct {
	AssetIDs         []string   `json:"assetIds"`
	Strategy         Strategy   `json:"strategy"`
	OutputMode       OutputMode `json:"outputMode"`
	UpdateReferences bool       `json:"updateReferences"`
	Quality          int        `json:"quality"`
	MaxDimensionPx   int        `json:"maxDimensionPx"`
}

type Operation struct {
	AssetID            string   `json:"assetId"`
	RepoPath           string   `json:"repoPath"`
	ProjectName        string   `json:"projectName"`
	ScanIntent         string   `json:"scanIntent"`
	Operation          string   `json:"operation"`
	SuggestionCode     string   `json:"suggestionCode"`
	Category           string   `json:"category"`
	Severity           string   `json:"severity"`
	InputFormat        string   `json:"inputFormat"`
	OutputFormat       string   `json:"outputFormat"`
	OutputMode         string   `json:"outputMode"`
	TargetPath         string   `json:"targetPath"`
	CurrentBytes       int64    `json:"currentBytes"`
	EstimatedBytes     int64    `json:"estimatedBytes"`
	SavingsBytes       int64    `json:"savingsBytes"`
	Tool               string   `json:"tool,omitempty"`
	Available          bool     `json:"available"`
	CanApply           bool     `json:"canApply"`
	ReasonCode         string   `json:"reasonCode,omitempty"`
	BlockedReason      string   `json:"blockedReason,omitempty"`
	ReferencePolicy    string   `json:"referencePolicy"`
	ReferenceEditCount int      `json:"referenceEditCount"`
	CandidatePath      string   `json:"candidatePath,omitempty"`
	Warnings           []string `json:"warnings,omitempty"`
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
	op.Operation = SuggestionOperation(primary.SuggestionCode, ext)
	switch op.Operation {
	case "svg-minify":
		op.OutputFormat = "svg"
		op.TargetPath = item.RepoPath
	case "resize-variant":
		op.OutputFormat = strings.TrimPrefix(ext, ".")
		op.TargetPath = resizeTargetPath(item.RepoPath, req.MaxDimensionPx)
		if req.OutputMode == OutputModeReplace {
			op.Operation = "resize-replace"
			op.TargetPath = item.RepoPath
		}
	case "convert-avif":
		op.OutputFormat = "avif"
		op.TargetPath = replaceExt(item.RepoPath, ".avif")
	case "gif-optimize":
		op.OutputFormat = "gif"
		op.TargetPath = item.RepoPath
	default:
		op.Operation = "manual-review"
		op.OutputFormat = strings.TrimPrefix(ext, ".")
		op.TargetPath = item.RepoPath
		op.CanApply = false
		op.BlockedReason = "No automated operation is available for this recommendation."
		op.ReasonCode = "operation_unsupported"
	}
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
	_, err := exec.LookPath(name)
	return err == nil
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

			// GIF fallback: suggest WebP conversion when gif-optimize yields no savings
			if ops[index].Operation == "gif-optimize" {
				ops[index].Operation = "convert-webp"
				ops[index].OutputFormat = "webp"
				ops[index].TargetPath = replaceExt(ops[index].RepoPath, ".webp")
				ops[index].Tool = "cwebp"

				if hasTool("cwebp") {
					fbCandidate, fbBytes, fbErr := buildCandidate(project, ops[index], req)
					if fbErr == nil && fbBytes < ops[index].CurrentBytes {
						ops[index].CandidatePath = fbCandidate
						ops[index].EstimatedBytes = fbBytes
						ops[index].SavingsBytes = ops[index].CurrentBytes - fbBytes
						ops[index].CanApply = true
						ops[index].Available = true
						ops[index].ReasonCode = ""
						ops[index].BlockedReason = ""
						if !keepCandidates {
							_ = os.Remove(fbCandidate)
							ops[index].CandidatePath = ""
						}
						continue
					}
					if fbCandidate != "" {
						_ = os.Remove(fbCandidate)
					}
				} else {
					ops[index].Available = false
					ops[index].ReasonCode = "optimizer_tool_missing"
					ops[index].BlockedReason = "Required optimizer tool is not installed: cwebp"
				}
			}

			blockers = append(blockers, actions.Blocker{File: ops[index].RepoPath, Code: ops[index].ReasonCode, Reason: ops[index].BlockedReason})
		}
	}
	return ops, blockers
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
		return buildSVGMinifyCandidate(sourceAbs)
	case "png-recompress":
		return buildPNGCandidate(sourceAbs)
	case "jpeg-recompress":
		return buildJPEGCandidate(sourceAbs, req.Quality)
	case "convert-avif":
		return buildAVIFCandidate(sourceAbs, req.Quality)
	case "resize-variant", "resize-replace":
		return buildResizeCandidate(sourceAbs, op.OutputFormat, req.MaxDimensionPx, req.Quality)
	case "gif-optimize":
		return buildGIFCandidate(sourceAbs)
	case "convert-webp", "webp-recompress":
		return buildExternalCandidate(sourceAbs, op, req)
	default:
		return "", 0, apierr.WithParams("operation_unsupported", "optimization operation is unsupported", map[string]any{"operation": op.Operation})
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

func buildPNGCandidate(source string) (string, int64, error) {
	file, err := os.Open(source)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	img, _, err := image.Decode(file)
	if err != nil {
		return "", 0, err
	}
	var buf bytes.Buffer
	enc := png.Encoder{CompressionLevel: png.BestCompression}
	if err := enc.Encode(&buf, img); err != nil {
		return "", 0, err
	}
	return writeCandidate(source, ".png", buf.Bytes())
}

func buildJPEGCandidate(source string, quality int) (string, int64, error) {
	file, err := os.Open(source)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	img, _, err := image.Decode(file)
	if err != nil {
		return "", 0, err
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		return "", 0, err
	}
	return writeCandidate(source, ".jpg", buf.Bytes())
}

func buildAVIFCandidate(source string, quality int) (string, int64, error) {
	file, err := os.Open(source)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	img, _, err := image.Decode(file)
	if err != nil {
		return "", 0, err
	}
	var buf bytes.Buffer
	if err := avif.Encode(&buf, img, avif.Options{Quality: quality, QualityAlpha: quality, Speed: 10}); err != nil {
		return "", 0, err
	}
	return writeCandidate(source, ".avif", buf.Bytes())
}

func buildGIFCandidate(source string) (string, int64, error) {
	file, err := os.Open(source)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	img, err := gif.DecodeAll(file)
	if err != nil {
		return "", 0, err
	}
	var buf bytes.Buffer
	if err := gif.EncodeAll(&buf, img); err != nil {
		return "", 0, err
	}
	return writeCandidate(source, ".gif", buf.Bytes())
}

func buildResizeCandidate(source, format string, maxDimension, quality int) (string, int64, error) {
	file, err := os.Open(source)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	img, _, err := image.Decode(file)
	if err != nil {
		return "", 0, err
	}
	bounds := img.Bounds()
	w, h := fitBounds(bounds.Dx(), bounds.Dy(), maxDimension)
	dst := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, bounds, draw.Over, nil)
	var buf bytes.Buffer
	switch format {
	case "jpg", "jpeg":
		if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: quality}); err != nil {
			return "", 0, err
		}
		return writeCandidate(source, ".jpg", buf.Bytes())
	default:
		enc := png.Encoder{CompressionLevel: png.BestCompression}
		if err := enc.Encode(&buf, dst); err != nil {
			return "", 0, err
		}
		return writeCandidate(source, ".png", buf.Bytes())
	}
}

func buildExternalCandidate(source string, op Operation, req Request) (string, int64, error) {
	ext := "." + op.OutputFormat
	target, err := os.CreateTemp("", "asset-studio-optimize-*"+ext)
	if err != nil {
		return "", 0, err
	}
	targetPath := target.Name()
	_ = target.Close()
	var cmd *exec.Cmd
	switch op.Operation {
	case "convert-webp":
		cmd = exec.Command("cwebp", "-q", fmt.Sprintf("%d", req.Quality), source, "-o", targetPath)
	case "webp-recompress":
		cmd = exec.Command("cwebp", "-q", fmt.Sprintf("%d", req.Quality), source, "-o", targetPath)
	default:
		return "", 0, apierr.WithParams("operation_unsupported", "optimization operation is unsupported", map[string]any{"operation": op.Operation})
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

func fitBounds(width, height, maxSize int) (int, int) {
	if width <= 0 || height <= 0 || maxSize <= 0 {
		return width, height
	}
	scale := min(float64(maxSize)/float64(width), float64(maxSize)/float64(height))
	if scale >= 1 {
		return width, height
	}
	return max(1, int(float64(width)*scale)), max(1, int(float64(height)*scale))
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
