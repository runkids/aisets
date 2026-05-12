package scanner

import (
	"bufio"
	"fmt"
	"os"

	"aisets/internal/lint"
)

func runLint(projects []Project, items []AssetItem, settings lint.Settings) []lint.Finding {
	type refWithAsset struct {
		ref   AssetReference
		item  AssetItem
		pPath string
	}

	settings = lint.NormalizeSettings(settings)
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
			ctx := lintContextForItem(r.item)
			ctx.File = r.ref.File
			ctx.Line = r.ref.Line
			ctx.Content = lineContent
			ctx.Kind = r.ref.Kind
			ctx.Specifier = r.ref.Specifier
			findings = append(findings, lint.RunWithSettings(ctx, settings)...)
			findings = append(findings, lint.RunCustom(ctx, referenceOnlyCustomContext(ctx, settings))...)
		}
	}
	for _, item := range items {
		findings = append(findings, lint.RunCustom(lintContextForItem(item), assetOnlyCustomSettings(settings))...)
		duplicateRule := lint.BuiltinRule(settings, "duplicate-asset")
		if !duplicateRule.Enabled {
			continue
		}
		if item.DuplicateGroupID == nil || item.PreferredDuplicatePath == nil {
			continue
		}
		if item.RepoPath == *item.PreferredDuplicatePath {
			continue
		}
		findings = append(findings, lint.Finding{
			RuleID:     "duplicate-asset",
			Severity:   duplicateRule.Severity,
			File:       item.RepoPath,
			Line:       0,
			Snippet:    "",
			Message:    fmt.Sprintf("Identical copy exists at %s", *item.PreferredDuplicatePath),
			Suggestion: "Remove this copy and update references to use the preferred path.",
			AssetID:    item.ID,
		})
	}
	for _, item := range items {
		gpsRule := lint.BuiltinRule(settings, "exif-gps-privacy")
		if !gpsRule.Enabled {
			continue
		}
		if item.EXIF == nil || item.EXIF.GPSLatitude == nil {
			continue
		}
		if item.ScanIntent != ProjectScanIntentCode {
			continue
		}
		findings = append(findings, lint.Finding{
			RuleID:     "exif-gps-privacy",
			Severity:   gpsRule.Severity,
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

func lintContextForItem(item AssetItem) lint.Context {
	return lint.Context{
		File:               item.RepoPath,
		Line:               0,
		AssetBytes:         item.Bytes,
		AssetExt:           item.Ext,
		AssetID:            item.ID,
		AssetPath:          item.RepoPath,
		ProjectName:        item.ProjectName,
		AssetWidth:         item.Image.Width,
		AssetHeight:        item.Image.Height,
		AssetAnimated:      item.Image.Animated,
		AssetAlpha:         item.Image.Alpha,
		AssetDuplicate:     item.DuplicateGroupID != nil,
		AssetNearDuplicate: len(item.Similar) > 0,
		AssetOptimizable:   len(item.Optimization) > 0,
		AssetEXIFGPS:       item.EXIF != nil && item.EXIF.GPSLatitude != nil,
	}
}

func referenceOnlyCustomContext(ctx lint.Context, settings lint.Settings) lint.Settings {
	settings.CustomRules = filterCustomRules(settings.CustomRules, true)
	return settings
}

func assetOnlyCustomSettings(settings lint.Settings) lint.Settings {
	settings.CustomRules = filterCustomRules(settings.CustomRules, false)
	return settings
}

func filterCustomRules(rules []lint.CustomRuleSetting, referenceRules bool) []lint.CustomRuleSetting {
	out := make([]lint.CustomRuleSetting, 0, len(rules))
	for _, rule := range rules {
		if lint.CustomRuleUsesReference(rule) == referenceRules {
			out = append(out, rule)
		}
	}
	return out
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
