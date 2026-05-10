package scanner

import (
	"bufio"
	"fmt"
	"os"

	"aisets/internal/lint"
)

func runLint(projects []Project, items []AssetItem) []lint.Finding {
	type refWithAsset struct {
		ref   AssetReference
		item  AssetItem
		pPath string
	}

	byFile := map[string][]refWithAsset{}
	projectPath := map[string]string{}
	for _, p := range projects {
		projectPath[p.ID] = p.Path
	}
	for _, item := range items {
		pPath := projectPath[item.ProjectID]
		for _, ref := range item.References {
			key := pPath + "/" + ref.File
			byFile[key] = append(byFile[key], refWithAsset{ref: ref, item: item, pPath: pPath})
		}
	}

	var findings []lint.Finding
	for filePath, refs := range byFile {
		lines := readFileLines(filePath)
		if lines == nil {
			continue
		}
		for _, r := range refs {
			lineContent := ""
			if r.ref.Line > 0 && r.ref.Line <= len(lines) {
				lineContent = lines[r.ref.Line-1]
			}
			ctx := lint.Context{
				File:       r.ref.File,
				Line:       r.ref.Line,
				Content:    lineContent,
				Kind:       r.ref.Kind,
				Specifier:  r.ref.Specifier,
				AssetBytes: r.item.Bytes,
				AssetExt:   r.item.Ext,
				AssetID:    r.item.ID,
			}
			findings = append(findings, lint.Run(ctx)...)
		}
	}
	for _, item := range items {
		if item.DuplicateGroupID == nil || item.PreferredDuplicatePath == nil {
			continue
		}
		if item.RepoPath == *item.PreferredDuplicatePath {
			continue
		}
		findings = append(findings, lint.Finding{
			RuleID:     "duplicate-asset",
			Severity:   "warning",
			File:       item.RepoPath,
			Line:       0,
			Snippet:    "",
			Message:    fmt.Sprintf("Identical copy exists at %s", *item.PreferredDuplicatePath),
			Suggestion: "Remove this copy and update references to use the preferred path.",
			AssetID:    item.ID,
		})
	}
	for _, item := range items {
		if item.EXIF == nil || item.EXIF.GPSLatitude == nil {
			continue
		}
		if item.ScanIntent != ProjectScanIntentCode {
			continue
		}
		findings = append(findings, lint.Finding{
			RuleID:     "exif-gps-privacy",
			Severity:   "advisory",
			File:       item.RepoPath,
			Line:       0,
			Snippet:    "",
			Message:    fmt.Sprintf("Image contains GPS coordinates (%.4f, %.4f) that may expose physical location", *item.EXIF.GPSLatitude, *item.EXIF.GPSLongitude),
			Suggestion: "Strip EXIF GPS data before committing if the location is sensitive.",
			AssetID:    item.ID,
		})
	}
	return findings
}

func readFileLines(path string) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	var lines []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	return lines
}
