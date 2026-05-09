package precheck

import (
	"context"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/zeebo/blake3"

	"aisets/internal/imageproc"
	"aisets/internal/scanner"
)

const (
	NearDuplicateThreshold = 8
	HashAlgorithm          = "blake3"
)

type Verdict string

const (
	VerdictOK        Verdict = "ok"
	VerdictWarning   Verdict = "warning"
	VerdictDuplicate Verdict = "duplicate"
)

type ExactMatch struct {
	AssetID     string `json:"assetId"`
	RepoPath    string `json:"repoPath"`
	ProjectName string `json:"projectName"`
}

type NearMatch struct {
	AssetID     string `json:"assetId"`
	RepoPath    string `json:"repoPath"`
	ProjectName string `json:"projectName"`
	Distance    int    `json:"distance"`
	Flipped     bool   `json:"flipped"`
}

type NamingIssue struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type Result struct {
	Name          string                           `json:"name"`
	Ext           string                           `json:"ext"`
	Size          int64                            `json:"size"`
	ContentHash   string                           `json:"contentHash"`
	HashAlgorithm string                           `json:"hashAlgorithm"`
	DHash         string                           `json:"dHash,omitempty"`
	DHashFlipped  string                           `json:"dHashFlipped,omitempty"`
	Image         imageproc.Metadata               `json:"image"`
	ExactMatches  []ExactMatch                     `json:"exactMatches"`
	NearMatches   []NearMatch                      `json:"nearMatches"`
	NamingIssues  []NamingIssue                    `json:"namingIssues"`
	Optimization  []scanner.OptimizationSuggestion `json:"optimizationRecommendations"`
	Verdict       Verdict                          `json:"verdict"`
	VerdictReason string                           `json:"verdictReason"`
}

// Analyze examines a single uploaded file (already saved to localPath) and
// compares it against the catalog to produce a pre-check verdict.
func Analyze(ctx context.Context, name, localPath string, catalog scanner.Catalog) (Result, error) {
	info, err := os.Stat(localPath)
	if err != nil {
		return Result{}, err
	}

	contentHash, err := hashFile(ctx, localPath)
	if err != nil {
		return Result{}, err
	}

	ext := strings.ToLower(filepath.Ext(name))
	meta, _ := imageproc.Probe(localPath)
	hashes, _ := imageproc.DHash(localPath)

	res := Result{
		Name:          name,
		Ext:           ext,
		Size:          info.Size(),
		ContentHash:   contentHash,
		HashAlgorithm: HashAlgorithm,
		DHash:         hashes.DHash,
		DHashFlipped:  hashes.DHashFlipped,
		Image:         meta,
		ExactMatches:  []ExactMatch{},
		NearMatches:   []NearMatch{},
		NamingIssues:  []NamingIssue{},
		Optimization:  []scanner.OptimizationSuggestion{},
	}

	res.ExactMatches = findExactMatchesWithFallback(ctx, contentHash, info.Size(), catalog)
	res.NearMatches = findNearMatches(localPath, hashes.DHash, hashes.DHashFlipped, contentHash, catalog)
	res.NamingIssues = checkNaming(name)

	for _, opt := range imageproc.EstimateOptimization(localPath, meta, info.Size(), imageproc.DefaultOptimizationThresholds()) {
		res.Optimization = append(res.Optimization, scanner.OptimizationSuggestion{
			Category:       opt.Category,
			ReasonCode:     opt.ReasonCode,
			Reason:         opt.Reason,
			Severity:       opt.Severity,
			SuggestionCode: opt.SuggestionCode,
			Suggestion:     opt.Suggestion,
		})
	}

	res.Verdict, res.VerdictReason = decideVerdict(res)
	return res, nil
}

func hashFile(ctx context.Context, path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	h := blake3.New()
	buf := make([]byte, 128*1024)
	for {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		n, rerr := file.Read(buf)
		if n > 0 {
			if _, werr := h.Write(buf[:n]); werr != nil {
				return "", werr
			}
		}
		if rerr == io.EOF {
			return hex.EncodeToString(h.Sum(nil)), nil
		}
		if rerr != nil {
			return "", rerr
		}
	}
}

func findExactMatches(contentHash string, catalog scanner.Catalog) []ExactMatch {
	out := make([]ExactMatch, 0)
	if contentHash == "" {
		return out
	}
	for _, item := range catalog.Items {
		if item.ContentHash == contentHash {
			out = append(out, exactMatch(item))
		}
	}
	return out
}

func findExactMatchesWithFallback(ctx context.Context, contentHash string, size int64, catalog scanner.Catalog) []ExactMatch {
	out := findExactMatches(contentHash, catalog)
	if contentHash == "" {
		return out
	}
	seen := make(map[string]struct{}, len(out))
	for _, match := range out {
		seen[match.AssetID] = struct{}{}
	}
	for _, item := range catalog.Items {
		if item.ContentHash != "" || item.LocalPath == "" || item.Bytes != size {
			continue
		}
		if _, ok := seen[item.ID]; ok {
			continue
		}
		if ctx.Err() != nil {
			return out
		}
		hash, err := hashFile(ctx, item.LocalPath)
		if err != nil || hash != contentHash {
			continue
		}
		out = append(out, exactMatch(item))
		seen[item.ID] = struct{}{}
	}
	return out
}

func exactMatch(item scanner.AssetItem) ExactMatch {
	return ExactMatch{
		AssetID:     item.ID,
		RepoPath:    item.RepoPath,
		ProjectName: item.ProjectName,
	}
}

func findNearMatches(localPath, dHash, dHashFlipped, contentHash string, catalog scanner.Catalog) []NearMatch {
	out := make([]NearMatch, 0)
	if dHash == "" {
		return out
	}
	for _, item := range catalog.Items {
		if item.DHash == "" || item.ContentHash == contentHash {
			continue
		}
		dist, ok := imageproc.DistanceHex(dHash, item.DHash)
		flipped := false
		if dHashFlipped != "" {
			if flipDist, fok := imageproc.DistanceHex(dHashFlipped, item.DHash); fok && (!ok || flipDist < dist) {
				dist = flipDist
				ok = true
				flipped = true
			}
		}
		if ok && dist <= NearDuplicateThreshold && imageproc.IsVisualMatch(localPath, item.LocalPath, flipped) {
			out = append(out, NearMatch{
				AssetID:     item.ID,
				RepoPath:    item.RepoPath,
				ProjectName: item.ProjectName,
				Distance:    dist,
				Flipped:     flipped,
			})
		}
	}
	return out
}

func checkNaming(name string) []NamingIssue {
	out := make([]NamingIssue, 0)
	base := filepath.Base(name)
	if strings.ContainsAny(base, " ") {
		out = append(out, NamingIssue{Code: "contains_spaces", Message: "Filename contains spaces; prefer dashes or underscores."})
	}
	if base != strings.ToLower(base) {
		out = append(out, NamingIssue{Code: "uppercase_letters", Message: "Filename contains uppercase letters; prefer lowercase."})
	}
	if strings.ContainsAny(base, "()[]{}!@#$%^&*+=,;:'\"") {
		out = append(out, NamingIssue{Code: "special_chars", Message: "Filename contains special characters that may cause URL/path issues."})
	}
	if strings.HasPrefix(base, "-") || strings.HasPrefix(base, ".") {
		out = append(out, NamingIssue{Code: "leading_punctuation", Message: "Filename starts with punctuation."})
	}
	return out
}

func decideVerdict(r Result) (Verdict, string) {
	if len(r.ExactMatches) > 0 {
		return VerdictDuplicate, "An asset with identical content already exists in the catalog."
	}
	if len(r.NearMatches) > 0 {
		return VerdictWarning, "Visually similar assets exist; review before adding."
	}
	for _, opt := range r.Optimization {
		if opt.Severity == "critical" {
			return VerdictWarning, "Asset has critical optimization recommendations."
		}
	}
	if len(r.NamingIssues) > 0 {
		return VerdictWarning, "Filename has style issues."
	}
	return VerdictOK, "No conflicts detected."
}
