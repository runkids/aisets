package server

import (
	"fmt"
	"path"
	"path/filepath"
	"strings"
)

func fillCanvasCopyAssetDestPathsFromOCR(act canvasAction, items []canvasOCRAnnotationItem) canvasAction {
	if act.Tool != "copy_asset" || act.Params == nil || len(items) == 0 || canvasCopyAssetProposalHasDestination(act) {
		return act
	}
	assetIDs := canvasActionAssetIDs(act)
	if len(assetIDs) == 0 {
		return act
	}
	byAssetID := map[string]canvasOCRAnnotationItem{}
	for _, item := range items {
		assetID := strings.TrimSpace(item.AssetID)
		if assetID != "" {
			byAssetID[assetID] = item
		}
	}
	destDir, _ := act.Params["destDir"].(string)
	destDir = strings.Trim(strings.TrimSpace(destDir), "/")
	rows := make([]any, 0, len(assetIDs))
	for _, assetID := range assetIDs {
		item, ok := byAssetID[assetID]
		if !ok || strings.TrimSpace(item.Text) == "" {
			continue
		}
		fileName := canvasTextDerivedCopyFileName(item.Text, item.FileName)
		destPath := fileName
		if destDir != "" {
			destPath = path.Join(destDir, fileName)
		}
		rows = append(rows, map[string]any{
			"assetId":  assetID,
			"destPath": destPath,
		})
	}
	if len(rows) == 0 {
		return act
	}
	next := act
	next.Params = cloneCanvasActionParams(act.Params)
	next.Params["perAssetDestPaths"] = rows
	return next
}

func sanitizeCanvasCopyAssetDestPathsFromOCR(act canvasAction, items []canvasOCRAnnotationItem) canvasAction {
	if act.Tool != "copy_asset" || act.Params == nil || len(items) == 0 {
		return act
	}
	rows, ok := act.Params["perAssetDestPaths"].([]any)
	if !ok || len(rows) == 0 {
		return act
	}
	byAssetID := map[string]canvasOCRAnnotationItem{}
	for _, item := range items {
		assetID := strings.TrimSpace(item.AssetID)
		if assetID != "" {
			byAssetID[assetID] = item
		}
	}
	nextRows := make([]any, 0, len(rows))
	changed := false
	for _, raw := range rows {
		row, ok := raw.(map[string]any)
		if !ok {
			nextRows = append(nextRows, raw)
			continue
		}
		nextRow := make(map[string]any, len(row))
		for key, value := range row {
			nextRow[key] = value
		}
		assetID, _ := row["assetId"].(string)
		destPath, _ := row["destPath"].(string)
		item, found := byAssetID[strings.TrimSpace(assetID)]
		if found && canvasCopyDestPathStem(destPath) == strings.TrimSpace(item.Text) {
			safeFileName := canvasTextDerivedCopyFileName(item.Text, item.FileName)
			if safeFileName != destPath {
				nextRow["destPath"] = safeFileName
				changed = true
			}
		}
		nextRows = append(nextRows, nextRow)
	}
	if !changed {
		return act
	}
	next := act
	next.Params = cloneCanvasActionParams(act.Params)
	next.Params["perAssetDestPaths"] = nextRows
	return next
}

func canvasCopyDestPathStem(destPath string) string {
	destPath = strings.TrimSpace(destPath)
	ext := filepath.Ext(destPath)
	if ext == "" {
		return destPath
	}
	return strings.TrimSuffix(destPath, ext)
}

func normalizeCanvasCopyAssetDestPaths(act canvasAction) canvasAction {
	if act.Tool != "copy_asset" || act.Params == nil {
		return act
	}
	rows, ok := act.Params["perAssetDestPaths"].([]any)
	if !ok || len(rows) == 0 {
		return act
	}
	used := map[string]bool{}
	nextRows := make([]any, 0, len(rows))
	changed := false
	var rowAssetIDs []string
	for _, raw := range rows {
		row, ok := raw.(map[string]any)
		if !ok {
			nextRows = append(nextRows, raw)
			continue
		}
		assetID, _ := row["assetId"].(string)
		assetID = strings.TrimSpace(assetID)
		if assetID != "" {
			rowAssetIDs = append(rowAssetIDs, assetID)
		}
		destPath, _ := row["destPath"].(string)
		destPath = strings.TrimSpace(destPath)
		uniqueDestPath := uniqueCanvasCopyDestPath(destPath, used)
		if uniqueDestPath != destPath {
			changed = true
		}
		nextRow := make(map[string]any, len(row))
		for key, value := range row {
			nextRow[key] = value
		}
		nextRow["destPath"] = uniqueDestPath
		nextRows = append(nextRows, nextRow)
	}
	if len(canvasActionAssetIDs(act)) == 0 && len(rowAssetIDs) > 0 {
		changed = true
	}
	if !changed {
		return act
	}
	next := act
	next.Params = cloneCanvasActionParams(act.Params)
	next.Params["perAssetDestPaths"] = nextRows
	if len(canvasActionAssetIDs(next)) == 0 && len(rowAssetIDs) > 0 {
		setCanvasActionAssetIDs(&next, rowAssetIDs)
	}
	return next
}

func canvasTextDerivedCopyFileName(text string, fallbackFileName string) string {
	ext := strings.TrimSpace(filepath.Ext(fallbackFileName))
	if ext == "" {
		ext = ".png"
	}
	base := strings.TrimSpace(text)
	var b strings.Builder
	for _, r := range base {
		switch r {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|':
			b.WriteRune('_')
		default:
			if r < 32 {
				b.WriteRune('_')
			} else {
				b.WriteRune(r)
			}
		}
	}
	name := strings.Trim(strings.TrimSpace(b.String()), ". ")
	if name == "" {
		name = strings.TrimSuffix(filepath.Base(fallbackFileName), filepath.Ext(fallbackFileName))
	}
	if name == "" {
		name = "asset"
	}
	name = truncate(name, 120)
	if filepath.Ext(name) != "" {
		return name
	}
	return name + ext
}

func uniqueCanvasCopyDestPath(destPath string, used map[string]bool) string {
	if destPath == "" {
		return destPath
	}
	candidate := destPath
	for index := 1; ; index++ {
		key := strings.ToLower(candidate)
		if !used[key] {
			used[key] = true
			return candidate
		}
		ext := filepath.Ext(destPath)
		stem := strings.TrimSuffix(destPath, ext)
		candidate = fmt.Sprintf("%s-%d%s", stem, index+1, ext)
	}
}
