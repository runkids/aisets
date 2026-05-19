package server

import (
	"archive/zip"
	"crypto/sha1"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"aisets/internal/actions"
	"aisets/internal/apierr"
	"aisets/internal/imageproc"
	"aisets/internal/optimize"
	"aisets/internal/scanner"
)

const imageToolDownloadTTL = time.Hour

type imageToolDownload struct {
	Path             string
	Name             string
	ContentType      string
	DeleteAfterServe bool
	Persistent       bool
	CreatedAt        time.Time
}

type imageToolRequestBody struct {
	AssetIDs       []string `json:"assetIds"`
	OutputFormat   string   `json:"outputFormat"`
	Quality        int      `json:"quality"`
	MaxDimensionPx int      `json:"maxDimensionPx"`
	OutputMode     string   `json:"outputMode"`
}

type imageToolResult struct {
	ID             string             `json:"id"`
	Name           string             `json:"name"`
	Source         string             `json:"source"`
	RepoPath       string             `json:"repoPath,omitempty"`
	OutputPath     string             `json:"outputPath,omitempty"`
	ProjectName    string             `json:"projectName,omitempty"`
	InputFormat    string             `json:"inputFormat"`
	OutputFormat   string             `json:"outputFormat"`
	CurrentBytes   int64              `json:"currentBytes"`
	OutputBytes    int64              `json:"outputBytes"`
	SavingsBytes   int64              `json:"savingsBytes"`
	Operation      string             `json:"operation"`
	Token          string             `json:"token,omitempty"`
	DownloadName   string             `json:"downloadName,omitempty"`
	ErrorCode      string             `json:"errorCode,omitempty"`
	ErrorMessage   string             `json:"errorMessage,omitempty"`
	OptimizationOp optimize.Operation `json:"optimizationOperation"`
}

func (s *Server) handleImageToolAssetPreview(w http.ResponseWriter, r *http.Request) {
	var body imageToolRequestBody
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	items, err := s.imageToolItems(r, body.AssetIDs)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	project, err := s.singleProjectForItems(items)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	preview, err := optimize.ManualPreview(project, items, s.imageToolOptimizeRequest(body))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.storePreview(preview)
	writeJSON(w, http.StatusOK, map[string]any{"preview": preview, "token": preview.ID})
}

func (s *Server) handleImageToolAssetProcess(w http.ResponseWriter, r *http.Request) {
	var body imageToolRequestBody
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	req := s.imageToolOptimizeRequest(body)
	if req.OutputMode == optimize.OutputModeReplace {
		writeError(w, http.StatusBadRequest, apierr.New("image_tools_replace_requires_preview", "replace mode must use preview/apply confirmation"))
		return
	}
	items, err := s.imageToolItems(r, body.AssetIDs)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	byProject := map[string][]scanner.AssetItem{}
	for _, item := range items {
		byProject[item.ProjectID] = append(byProject[item.ProjectID], item)
	}
	results := []imageToolResult{}
	var applied actions.ApplyResult
	for projectID, projectItems := range byProject {
		project, err := s.projectByID(projectID)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		preview, err := optimize.ManualPreview(project, projectItems, req)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		result, err := optimize.Apply(project, preview)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		applied.MovedFiles += result.MovedFiles
		applied.SkippedFiles += result.SkippedFiles
		applied.ChangedReferences += result.ChangedReferences
		if applied.AppliedAt == "" {
			applied.AppliedAt = result.AppliedAt
		}
		for _, op := range optimizePreviewOps(preview) {
			result := imageToolResultFromOperation(op, "", "", "project")
			if op.TargetPath != "" {
				if targetAbs, err := imageToolSafeAbs(project.Path, op.TargetPath); err == nil {
					if _, err := os.Stat(targetAbs); err == nil {
						token := imageToolToken("image-tool-project-download:" + op.TargetPath)
						downloadName := filepath.Base(op.TargetPath)
						s.storeImageToolDownload(token, imageToolDownload{
							Path:        targetAbs,
							Name:        downloadName,
							ContentType: contentTypeForName(downloadName),
							CreatedAt:   time.Now(),
						})
						result.Token = token
						result.DownloadName = downloadName
					}
				}
			}
			results = append(results, result)
		}
	}
	s.markCatalogStale()
	writeJSON(w, http.StatusOK, map[string]any{"results": results, "applied": applied})
}

func (s *Server) handleImageToolUploadProcess(w http.ResponseWriter, r *http.Request) {
	const maxUploadBytes = 256 << 20
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		writeError(w, http.StatusBadRequest, apierr.New("upload_parse_failed", "failed to parse upload"))
		return
	}
	if r.MultipartForm == nil || len(r.MultipartForm.File["files"]) == 0 {
		writeError(w, http.StatusBadRequest, apierr.New("upload_missing", "no files uploaded"))
		return
	}
	body := imageToolRequestBody{
		OutputFormat:   r.FormValue("outputFormat"),
		Quality:        atoiDefault(r.FormValue("quality"), 80),
		MaxDimensionPx: atoiDefault(r.FormValue("maxDimensionPx"), 0),
		OutputMode:     string(optimize.OutputModeSafeVariants),
	}
	req := s.imageToolOptimizeRequest(body)
	results := make([]imageToolResult, 0, len(r.MultipartForm.File["files"]))
	for _, header := range r.MultipartForm.File["files"] {
		results = append(results, s.processImageToolUpload(header, req))
	}
	var zipToken string
	if len(results) > 1 {
		zipToken = s.zipImageToolResults(results)
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results, "zipToken": zipToken})
}

type imageToolRenderPreviewRequest struct {
	AssetID        string `json:"assetId"`
	Operation      string `json:"operation"`
	OutputFormat   string `json:"outputFormat"`
	Quality        int    `json:"quality"`
	MaxDimensionPx int    `json:"maxDimensionPx"`
	Flip           string `json:"flip"`
	RotateDegrees  int    `json:"rotateDegrees"`
	Degrees        int    `json:"degrees"`
}

type imageToolRenderPreviewResponse struct {
	Token        string `json:"token"`
	InputBytes   int64  `json:"inputBytes"`
	OutputBytes  int64  `json:"outputBytes"`
	InputFormat  string `json:"inputFormat"`
	OutputFormat string `json:"outputFormat"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	Alpha        bool   `json:"alpha"`
}

func (s *Server) handleImageToolRenderPreview(w http.ResponseWriter, r *http.Request) {
	var body imageToolRenderPreviewRequest
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.AssetID == "" {
		writeError(w, http.StatusBadRequest, apierr.New("empty_selection", "assetId is required"))
		return
	}
	if _, err := s.ensureLatestScan(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	item, err := s.store.CatalogItem(0, body.AssetID)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	sourcePath := item.LocalPath
	sourceBytes := item.Bytes
	sourceMeta := item.Image
	sourceDisplay := item.RepoPath
	ext := strings.ToLower(item.Ext)
	needsPreConvert := ext == ".heic" || ext == ".heif" || ext == ".avif"
	if needsPreConvert {
		pngData, convErr := imageproc.ImageToPNG(item.LocalPath, 0)
		if convErr != nil {
			writeError(w, http.StatusBadRequest, apierr.New("preview_decode_failed", "cannot decode image for preview"))
			return
		}
		tmp, tmpErr := os.CreateTemp("", "aisets-preview-*.png")
		if tmpErr != nil {
			writeError(w, http.StatusInternalServerError, tmpErr)
			return
		}
		if _, writeErr := tmp.Write(pngData); writeErr != nil {
			tmp.Close()
			os.Remove(tmp.Name())
			writeError(w, http.StatusInternalServerError, writeErr)
			return
		}
		tmp.Close()
		defer os.Remove(tmp.Name())
		sourcePath = tmp.Name()
		sourceBytes = int64(len(pngData))
		sourceMeta.Format = "png"
		sourceDisplay = strings.TrimSuffix(item.RepoPath, item.Ext) + ".png"
	}
	if imageToolRenderPreviewIsTransform(body) {
		s.handleImageToolTransformPreview(w, item, sourcePath, sourceBytes, sourceDisplay, sourceMeta.Alpha, needsPreConvert, body)
		return
	}
	settings, _ := s.store.Settings()
	req := optimize.Request{
		OutputFormat:   body.OutputFormat,
		Quality:        body.Quality,
		MaxDimensionPx: body.MaxDimensionPx,
		AvifSpeed:      settings.OptimizationAvifSpeed,
		ExternalTools:  settings.OptimizationExternalTools,
		AllowLarger:    true,
	}
	op, candidate, err := optimize.ProcessLocalFile(sourcePath, sourceDisplay, sourceBytes, sourceMeta, req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	outputMeta, _ := imageproc.Probe(candidate)
	token := imageToolToken("render-preview:" + body.AssetID + ":" + body.OutputFormat)
	downloadName := imageToolDownloadName(item.RepoPath, op.OutputFormat)
	s.storeImageToolDownload(token, imageToolDownload{
		Path:             candidate,
		Name:             downloadName,
		ContentType:      contentTypeForName(downloadName),
		DeleteAfterServe: true,
		CreatedAt:        time.Now(),
	})
	inputBytes := op.CurrentBytes
	inputFormat := op.InputFormat
	if needsPreConvert {
		inputBytes = item.Bytes
		inputFormat = strings.TrimPrefix(ext, ".")
	}
	writeJSON(w, http.StatusOK, imageToolRenderPreviewResponse{
		Token:        token,
		InputBytes:   inputBytes,
		OutputBytes:  op.EstimatedBytes,
		InputFormat:  inputFormat,
		OutputFormat: op.OutputFormat,
		Width:        outputMeta.Width,
		Height:       outputMeta.Height,
		Alpha:        outputMeta.Alpha,
	})
}

func imageToolRenderPreviewIsTransform(body imageToolRenderPreviewRequest) bool {
	switch strings.ToLower(strings.TrimSpace(body.Operation)) {
	case "mirror_image", "rotate_image", "transform_image":
		return true
	default:
		return body.Flip != "" || body.RotateDegrees != 0 || body.Degrees != 0
	}
}

func (s *Server) handleImageToolTransformPreview(w http.ResponseWriter, item scanner.AssetItem, sourcePath string, sourceBytes int64, sourceDisplay string, sourceAlpha bool, needsPreConvert bool, body imageToolRenderPreviewRequest) {
	opts, err := imageToolTransformOptions(body)
	if err != nil {
		writeError(w, http.StatusBadRequest, apierr.New("image_transform_invalid", err.Error()))
		return
	}
	outputFormat := imageToolTransformOutputFormat(body.OutputFormat, sourceDisplay, sourceAlpha)
	tmp, err := os.CreateTemp("", "aisets-transform-*."+outputFormat)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	targetPath := tmp.Name()
	_ = tmp.Close()
	if err := imageproc.TransformImage(sourcePath, targetPath, opts); err != nil {
		_ = os.Remove(targetPath)
		writeError(w, http.StatusBadRequest, apierr.New("image_transform_failed", err.Error()))
		return
	}
	info, err := os.Stat(targetPath)
	if err != nil {
		_ = os.Remove(targetPath)
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	outputMeta, _ := imageproc.Probe(targetPath)

	token := imageToolToken(fmt.Sprintf("render-preview:%s:%s:%s:%d:%s", item.ID, body.Operation, opts.Flip, opts.RotateDegrees, outputFormat))
	downloadName := imageToolTransformDownloadName(item.RepoPath, outputFormat, opts)
	s.storeImageToolDownload(token, imageToolDownload{
		Path:             targetPath,
		Name:             downloadName,
		ContentType:      contentTypeForName(downloadName),
		DeleteAfterServe: true,
		CreatedAt:        time.Now(),
	})

	inputBytes := sourceBytes
	inputFormat := strings.TrimPrefix(strings.ToLower(filepath.Ext(sourceDisplay)), ".")
	if needsPreConvert {
		inputBytes = item.Bytes
		inputFormat = strings.TrimPrefix(strings.ToLower(item.Ext), ".")
	}
	writeJSON(w, http.StatusOK, imageToolRenderPreviewResponse{
		Token:        token,
		InputBytes:   inputBytes,
		OutputBytes:  info.Size(),
		InputFormat:  inputFormat,
		OutputFormat: outputFormat,
		Width:        outputMeta.Width,
		Height:       outputMeta.Height,
		Alpha:        outputMeta.Alpha,
	})
}

func imageToolTransformOptions(body imageToolRenderPreviewRequest) (imageproc.TransformOptions, error) {
	operation := strings.ToLower(strings.TrimSpace(body.Operation))
	flip := strings.ToLower(strings.TrimSpace(body.Flip))
	degrees := body.RotateDegrees
	if degrees == 0 {
		degrees = body.Degrees
	}
	if operation == "mirror_image" && flip == "" {
		flip = "horizontal"
	}
	if operation == "rotate_image" && degrees == 0 {
		degrees = 90
	}
	if flip == "" {
		flip = "none"
	}
	degrees = ((degrees % 360) + 360) % 360
	if flip == "none" && degrees == 0 {
		return imageproc.TransformOptions{}, fmt.Errorf("no image transform requested")
	}
	return imageproc.TransformOptions{Flip: flip, RotateDegrees: degrees}, nil
}

func imageToolTransformOutputFormat(rawFormat, sourceDisplay string, sourceAlpha bool) string {
	format := imageproc.NormalizeOptimizationFormat(rawFormat)
	if format == "jpeg" {
		format = "jpg"
	}
	if sourceAlpha && format == "jpg" {
		format = "png"
	}
	switch format {
	case "png", "jpg", "webp", "avif", "gif":
		return format
	}
	sourceFormat := imageproc.NormalizeOptimizationFormat(filepath.Ext(sourceDisplay))
	switch sourceFormat {
	case "png", "jpg", "webp", "avif":
		return sourceFormat
	default:
		return "png"
	}
}

func imageToolTransformDownloadName(name, outputFormat string, opts imageproc.TransformOptions) string {
	base := strings.TrimSuffix(filepath.Base(name), filepath.Ext(name))
	parts := []string{base}
	if opts.Flip != "" && opts.Flip != "none" {
		parts = append(parts, "mirrored")
	}
	if opts.RotateDegrees != 0 {
		parts = append(parts, fmt.Sprintf("rotated%d", opts.RotateDegrees))
	}
	return strings.Join(parts, "-") + "." + outputFormat
}

type imageToolUploadRenderPreviewRequest struct {
	Token         string `json:"token"`
	Operation     string `json:"operation"`
	OutputFormat  string `json:"outputFormat"`
	Quality       int    `json:"quality"`
	Flip          string `json:"flip"`
	RotateDegrees int    `json:"rotateDegrees"`
}

func (s *Server) handleImageToolUploadRenderPreview(w http.ResponseWriter, r *http.Request) {
	var body imageToolUploadRenderPreviewRequest
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.Token == "" {
		writeError(w, http.StatusBadRequest, apierr.New("empty_token", "token is required"))
		return
	}
	download, ok := s.peekImageToolDownload(body.Token)
	if !ok {
		writeError(w, http.StatusNotFound, apierr.New("token_not_found", "upload token not found or expired"))
		return
	}
	sourcePath := download.Path
	sourceMeta, _ := imageproc.Probe(sourcePath)
	sourceInfo, _ := os.Stat(sourcePath)
	sourceBytes := int64(0)
	if sourceInfo != nil {
		sourceBytes = sourceInfo.Size()
	}
	sourceDisplay := download.Name
	if sourceDisplay == "" {
		sourceDisplay = filepath.Base(sourcePath)
	}

	renderBody := imageToolRenderPreviewRequest{
		Operation:     body.Operation,
		OutputFormat:  body.OutputFormat,
		Quality:       body.Quality,
		Flip:          body.Flip,
		RotateDegrees: body.RotateDegrees,
	}
	opts, err := imageToolTransformOptions(renderBody)
	if err != nil {
		writeError(w, http.StatusBadRequest, apierr.New("image_transform_invalid", err.Error()))
		return
	}
	outputFormat := imageToolTransformOutputFormat(body.OutputFormat, sourceDisplay, sourceMeta.Alpha)
	tmp, err := os.CreateTemp("", "aisets-upload-transform-*."+outputFormat)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	targetPath := tmp.Name()
	_ = tmp.Close()
	if err := imageproc.TransformImage(sourcePath, targetPath, opts); err != nil {
		_ = os.Remove(targetPath)
		writeError(w, http.StatusBadRequest, apierr.New("image_transform_failed", err.Error()))
		return
	}
	info, err := os.Stat(targetPath)
	if err != nil {
		_ = os.Remove(targetPath)
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	outputMeta, _ := imageproc.Probe(targetPath)

	token := imageToolToken(fmt.Sprintf("upload-render-preview:%s:%s:%s:%d:%s", body.Token, body.Operation, opts.Flip, opts.RotateDegrees, outputFormat))
	downloadName := imageToolTransformDownloadName(sourceDisplay, outputFormat, opts)
	s.storeImageToolDownload(token, imageToolDownload{
		Path:             targetPath,
		Name:             downloadName,
		ContentType:      contentTypeForName(downloadName),
		DeleteAfterServe: true,
		CreatedAt:        time.Now(),
	})

	writeJSON(w, http.StatusOK, imageToolRenderPreviewResponse{
		Token:        token,
		InputBytes:   sourceBytes,
		OutputBytes:  info.Size(),
		InputFormat:  strings.TrimPrefix(strings.ToLower(filepath.Ext(sourceDisplay)), "."),
		OutputFormat: outputFormat,
		Width:        outputMeta.Width,
		Height:       outputMeta.Height,
		Alpha:        outputMeta.Alpha,
	})
}

func (s *Server) handleImageToolMetadata(w http.ResponseWriter, r *http.Request) {
	assetID := r.PathValue("assetId")
	if _, err := s.ensureLatestScan(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	item, err := s.store.CatalogItem(0, assetID)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	exif, err := imageproc.ExtractEXIF(item.LocalPath)
	if err != nil {
		writeJSON(w, http.StatusOK, imageproc.EXIFData{})
		return
	}
	writeJSON(w, http.StatusOK, exif)
}

func (s *Server) handleImageToolPreviewServe(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	download, ok := s.peekImageToolDownload(token)
	if !ok {
		writeError(w, http.StatusNotFound, apierr.New("preview_token_invalid", "preview token is invalid or expired"))
		return
	}
	w.Header().Set("Content-Type", download.ContentType)
	w.Header().Set("Cache-Control", "private, max-age=300")
	http.ServeFile(w, r, download.Path)
}

func (s *Server) handleImageToolDownload(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	download, ok := s.takeImageToolDownload(token)
	if !ok {
		writeError(w, http.StatusNotFound, apierr.New("download_token_invalid", "download token is invalid or expired"))
		return
	}
	if download.DeleteAfterServe {
		defer os.Remove(download.Path)
	}
	w.Header().Set("Content-Type", download.ContentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, strings.ReplaceAll(download.Name, `"`, "")))
	http.ServeFile(w, r, download.Path)
}

func (s *Server) imageToolOptimizeRequest(body imageToolRequestBody) optimize.Request {
	settings, _ := s.store.Settings()
	req := optimize.Request{
		AssetIDs:       body.AssetIDs,
		OutputFormat:   body.OutputFormat,
		OutputMode:     optimize.OutputMode(body.OutputMode),
		Quality:        body.Quality,
		MaxDimensionPx: body.MaxDimensionPx,
		AvifSpeed:      settings.OptimizationAvifSpeed,
		Workers:        settings.OptimizationWorkers,
		ExternalTools:  settings.OptimizationExternalTools,
		AllowLarger:    true,
	}
	if req.OutputMode == "" {
		req.OutputMode = optimize.OutputModeSafeVariants
	}
	return req
}

func (s *Server) imageToolItems(r *http.Request, ids []string) ([]scanner.AssetItem, error) {
	if len(ids) == 0 {
		return nil, apierr.New("empty_selection", "no assets selected")
	}
	if _, err := s.ensureLatestScan(r.Context()); err != nil {
		return nil, err
	}
	items, err := s.store.CatalogItemsByIDs(0, ids)
	if err != nil {
		return nil, err
	}
	if missing := missingAssetIDs(ids, items); len(missing) > 0 {
		return nil, apierr.WithParams("asset_not_found", "one or more assets were not found", map[string]any{"assetIds": missing})
	}
	return items, nil
}

func (s *Server) singleProjectForItems(items []scanner.AssetItem) (scanner.Project, error) {
	if len(items) == 0 {
		return scanner.Project{}, apierr.New("empty_selection", "no assets selected")
	}
	project, err := s.projectByID(items[0].ProjectID)
	if err != nil {
		return scanner.Project{}, err
	}
	for _, item := range items {
		if item.ProjectID != project.ID {
			return scanner.Project{}, apierr.New("image_tools_project_mixed", "preview can only include one project at a time")
		}
	}
	return project, nil
}

func (s *Server) processImageToolUpload(header *multipart.FileHeader, req optimize.Request) imageToolResult {
	src, err := header.Open()
	if err != nil {
		return imageToolUploadError(header.Filename, "upload_open_failed", "failed to open upload")
	}
	defer src.Close()
	tmp, err := os.CreateTemp("", "aisets-image-tools-*"+filepath.Ext(header.Filename))
	if err != nil {
		return imageToolUploadError(header.Filename, "upload_tempfile_failed", "failed to allocate temp file")
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	size, copyErr := io.Copy(tmp, src)
	closeErr := tmp.Close()
	if copyErr != nil {
		return imageToolUploadError(header.Filename, "upload_write_failed", "failed to write upload")
	}
	if closeErr != nil {
		return imageToolUploadError(header.Filename, "upload_close_failed", "failed to close upload")
	}
	meta, _ := imageproc.Probe(tmpPath)
	op, candidate, err := optimize.ProcessLocalFile(tmpPath, header.Filename, size, meta, req)
	if err != nil {
		return imageToolUploadError(header.Filename, op.ReasonCode, err.Error())
	}
	token := imageToolToken("image-tool-download:" + header.Filename)
	downloadName := imageToolDownloadName(header.Filename, op.OutputFormat)
	s.storeImageToolDownload(token, imageToolDownload{
		Path:             candidate,
		Name:             downloadName,
		ContentType:      contentTypeForName(downloadName),
		DeleteAfterServe: true,
		CreatedAt:        time.Now(),
	})
	return imageToolResultFromOperation(op, token, downloadName, "upload")
}

func imageToolUploadError(name, code, message string) imageToolResult {
	if code == "" {
		code = "image_tool_failed"
	}
	return imageToolResult{ID: "upload:" + name, Name: name, Source: "upload", ErrorCode: code, ErrorMessage: message}
}

func imageToolResultFromOperation(op optimize.Operation, token, downloadName, source string) imageToolResult {
	name := op.RepoPath
	if source == "upload" {
		name = filepath.Base(op.RepoPath)
	}
	return imageToolResult{
		ID:             op.AssetID,
		Name:           name,
		Source:         source,
		RepoPath:       op.RepoPath,
		OutputPath:     op.TargetPath,
		ProjectName:    op.ProjectName,
		InputFormat:    op.InputFormat,
		OutputFormat:   op.OutputFormat,
		CurrentBytes:   op.CurrentBytes,
		OutputBytes:    op.EstimatedBytes,
		SavingsBytes:   op.SavingsBytes,
		Operation:      op.Operation,
		Token:          token,
		DownloadName:   downloadName,
		OptimizationOp: op,
	}
}

func (s *Server) storeImageToolDownload(token string, download imageToolDownload) {
	s.cleanupImageToolDownloads()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.imageToolDownloads[token] = download
}

func (s *Server) takeImageToolDownload(token string) (imageToolDownload, bool) {
	s.cleanupImageToolDownloads()
	s.mu.Lock()
	defer s.mu.Unlock()
	download, ok := s.imageToolDownloads[token]
	if ok {
		delete(s.imageToolDownloads, token)
	}
	return download, ok
}

func (s *Server) cleanupImageToolDownloads() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for token, download := range s.imageToolDownloads {
		if download.Persistent {
			continue
		}
		if now.Sub(download.CreatedAt) > imageToolDownloadTTL {
			_ = os.Remove(download.Path)
			delete(s.imageToolDownloads, token)
		}
	}
}

func (s *Server) zipImageToolResults(results []imageToolResult) string {
	token := imageToolToken("image-tool-download:zip")
	tmp, err := os.CreateTemp("", "aisets-image-tools-*.zip")
	if err != nil {
		return ""
	}
	zw := zip.NewWriter(tmp)
	for _, result := range results {
		if result.Token == "" || result.ErrorCode != "" {
			continue
		}
		download, ok := s.peekImageToolDownload(result.Token)
		if !ok {
			continue
		}
		file, err := os.Open(download.Path)
		if err != nil {
			continue
		}
		entry, err := zw.Create(download.Name)
		if err == nil {
			_, _ = io.Copy(entry, file)
		}
		file.Close()
	}
	_ = zw.Close()
	_ = tmp.Close()
	s.storeImageToolDownload(token, imageToolDownload{
		Path:             tmp.Name(),
		Name:             fmt.Sprintf("aisets-image-tools-%s.zip", time.Now().Format("2006-01-02")),
		ContentType:      "application/zip",
		DeleteAfterServe: true,
		CreatedAt:        time.Now(),
	})
	return token
}

func (s *Server) peekImageToolDownload(token string) (imageToolDownload, bool) {
	s.mu.Lock()
	download, ok := s.imageToolDownloads[token]
	s.mu.Unlock()
	if ok {
		return download, true
	}
	if restored, ok := restorePersistentCanvasUpload(token); ok {
		s.mu.Lock()
		s.imageToolDownloads[token] = restored
		s.mu.Unlock()
		return restored, true
	}
	return imageToolDownload{}, false
}

func optimizePreviewOps(preview actions.Preview) []optimize.Operation {
	raw, ok := preview.Payload["optimization"]
	if !ok {
		return nil
	}
	payload, ok := raw.(optimize.PreviewResult)
	if !ok {
		return nil
	}
	return payload.Operations
}

func imageToolDownloadName(name, outputFormat string) string {
	ext := "." + strings.TrimPrefix(outputFormat, ".")
	if ext == "." {
		ext = filepath.Ext(name)
	}
	base := strings.TrimSuffix(filepath.Base(name), filepath.Ext(name))
	return base + ext
}

func contentTypeForName(name string) string {
	if ct := mime.TypeByExtension(filepath.Ext(name)); ct != "" {
		return ct
	}
	return "application/octet-stream"
}

func imageToolSafeAbs(root, repoPath string) (string, error) {
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

func atoiDefault(raw string, fallback int) int {
	if raw == "" {
		return fallback
	}
	var value int
	if _, err := fmt.Sscanf(raw, "%d", &value); err != nil {
		return fallback
	}
	return value
}

func imageToolToken(seed string) string {
	sum := sha1.Sum([]byte(fmt.Sprintf("%s:%d", seed, time.Now().UnixNano())))
	return fmt.Sprintf("%x", sum[:])
}
