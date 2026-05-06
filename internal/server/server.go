package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"asset-studio/internal/actions"
	"asset-studio/internal/apierr"
	"asset-studio/internal/config"
	"asset-studio/internal/optimize"
	"asset-studio/internal/precheck"
	"asset-studio/internal/scanner"
)

type Options struct {
	Addr      string
	BasePath  string
	Store     *config.Store
	UIDistDir string
	Version   string
}

type Server struct {
	addr      string
	basePath  string
	store     *config.Store
	uiDistDir string
	version   string
	mux       *http.ServeMux
	handler   http.Handler
	scanner   *scanner.Scanner
	onReady   func()

	mu       sync.Mutex
	catalog  scanner.Catalog
	previews map[string]actions.Preview
}

func New(opts Options) (*Server, error) {
	s := &Server{
		addr:      opts.Addr,
		basePath:  normalizeBasePath(opts.BasePath),
		store:     opts.Store,
		uiDistDir: opts.UIDistDir,
		version:   opts.Version,
		mux:       http.NewServeMux(),
		scanner:   scanner.New(),
		previews:  map[string]actions.Preview{},
	}
	s.routes()
	s.handler = s.wrapBasePath(s.mux)
	return s, nil
}

func (s *Server) SetOnReady(fn func()) {
	s.onReady = fn
}

func (s *Server) StartWithContext(ctx context.Context) error {
	listener, err := net.Listen("tcp", s.addr)
	if err != nil {
		return err
	}
	server := &http.Server{Handler: s.handler}
	errCh := make(chan error, 1)
	go func() {
		if s.onReady != nil {
			s.onReady()
		}
		errCh <- server.Serve(listener)
	}()
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
		return ctx.Err()
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("GET /api/projects", s.handleProjects)
	s.mux.HandleFunc("POST /api/projects/add", s.handleAddProject)
	s.mux.HandleFunc("POST /api/projects/remove", s.handleRemoveProject)
	s.mux.HandleFunc("POST /api/projects/rename", s.handleRenameProject)
	s.mux.HandleFunc("GET /api/fs/directories", s.handleDirectories)
	s.mux.HandleFunc("GET /api/settings", s.handleSettings)
	s.mux.HandleFunc("PATCH /api/settings", s.handleUpdateSettings)
	s.mux.HandleFunc("GET /api/settings/export", s.handleSettingsExport)
	s.mux.HandleFunc("POST /api/settings/import", s.handleSettingsImport)
	s.mux.HandleFunc("POST /api/settings/reset-database", s.handleSettingsResetDatabase)
	s.mux.HandleFunc("GET /api/catalog", s.handleCatalog)
	s.mux.HandleFunc("POST /api/scan", s.handleScan)
	s.mux.HandleFunc("GET /api/assets/{id}", s.handleAsset)
	s.mux.HandleFunc("GET /api/thumbs/{id}", s.handleThumb)
	s.mux.HandleFunc("POST /api/actions/optimization/preview", s.handleOptimizationPreview)
	s.mux.HandleFunc("POST /api/actions/rename/preview", s.handleRenamePreview)
	s.mux.HandleFunc("POST /api/actions/rename/apply", s.handleApply)
	s.mux.HandleFunc("POST /api/actions/merge-duplicates/preview", s.handleMergePreview)
	s.mux.HandleFunc("POST /api/actions/merge-duplicates/apply", s.handleApply)
	s.mux.HandleFunc("POST /api/actions/delete-unused/preview", s.handleDeletePreview)
	s.mux.HandleFunc("POST /api/actions/delete-unused/apply", s.handleApply)
	s.mux.HandleFunc("POST /api/pre-check", s.handlePreCheck)
	s.mux.HandleFunc("POST /api/actions/optimization/estimate", s.handleOptimizationEstimate)
	s.mux.HandleFunc("POST /api/actions/optimization/generate-script", s.handleOptimizationGenerateScript)
	if s.uiDistDir != "" {
		s.mux.Handle("/", spaHandlerFromDisk(s.uiDistDir, s.basePath))
	} else {
		s.mux.HandleFunc("/", uiPlaceholderHandler)
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": s.version})
}

func (s *Server) handleProjects(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"projects": s.store.Projects()})
}

type directoryEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

func (s *Server) handleDirectories(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimSpace(r.URL.Query().Get("path"))
	if path == "" {
		cwd, err := os.Getwd()
		if err != nil {
			writeError(w, http.StatusInternalServerError, apierr.New("directory_default_path_failed", "failed to resolve default directory"))
			return
		}
		path = cwd
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		writeError(w, http.StatusBadRequest, apierr.WithParams("directory_path_invalid", "directory path is invalid", map[string]any{"path": path}))
		return
	}
	info, err := os.Stat(abs)
	if err != nil {
		writeError(w, http.StatusBadRequest, directoryAccessError(err, abs))
		return
	}
	if !info.IsDir() {
		writeError(w, http.StatusBadRequest, apierr.WithParams("directory_path_not_directory", "path is not a directory", map[string]any{"path": abs}))
		return
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		writeError(w, http.StatusBadRequest, directoryAccessError(err, abs))
		return
	}
	dirs := make([]directoryEntry, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		dirs = append(dirs, directoryEntry{Name: name, Path: filepath.Join(abs, name)})
	}
	sort.Slice(dirs, func(i, j int) bool { return strings.ToLower(dirs[i].Name) < strings.ToLower(dirs[j].Name) })
	parent := ""
	if next := filepath.Dir(abs); next != abs {
		parent = next
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": abs, "parent": parent, "directories": dirs})
}

func directoryAccessError(err error, path string) apierr.Error {
	params := map[string]any{"path": path}
	if errors.Is(err, os.ErrNotExist) {
		return apierr.WithParams("directory_not_found", "directory not found", params)
	}
	if errors.Is(err, os.ErrPermission) {
		return apierr.WithParams("directory_permission_denied", "directory permission denied", params)
	}
	return apierr.WithParams("directory_unreadable", "directory is unreadable", params)
}

func projectPathError(err error, path string) apierr.Error {
	params := map[string]any{"path": path}
	var pathErr *config.PathError
	if errors.As(err, &pathErr) {
		params["path"] = pathErr.Path
		return apierr.WithParams("project_path_not_directory", "project path must be a directory", params)
	}
	if errors.Is(err, os.ErrNotExist) {
		return apierr.WithParams("project_path_not_found", "project path not found", params)
	}
	if errors.Is(err, os.ErrPermission) {
		return apierr.WithParams("project_path_permission_denied", "project path permission denied", params)
	}
	return apierr.WithParams("project_path_invalid", "project path is invalid", params)
}

func projectErrorStatus(err error) int {
	if coded, ok := err.(apierr.Error); ok && coded.Code == "project_not_found" {
		return http.StatusNotFound
	}
	return http.StatusBadRequest
}

func settingsErrorStatus(err error) int {
	if _, ok := err.(apierr.Error); ok {
		return http.StatusBadRequest
	}
	return http.StatusInternalServerError
}

func (s *Server) handleAddProject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.store.AddProjects([]string{body.Path}); err != nil {
		writeError(w, http.StatusBadRequest, projectPathError(err, body.Path))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": s.store.Projects()})
}

func (s *Server) handleRemoveProject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.store.RemoveProject(body.ID); err != nil {
		writeError(w, projectErrorStatus(err), err)
		return
	}
	s.clearCatalog()
	writeJSON(w, http.StatusOK, map[string]any{"projects": s.store.Projects()})
}

func (s *Server) handleRenameProject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.store.RenameProject(body.ID, body.Name); err != nil {
		writeError(w, projectErrorStatus(err), err)
		return
	}
	s.clearCatalog()
	writeJSON(w, http.StatusOK, map[string]any{"projects": s.store.Projects()})
}

type settingsInfo struct {
	config.AppSettings
	DatabasePath string `json:"databasePath"`
	ConfigDir    string `json:"configDir"`
	DataDir      string `json:"dataDir"`
	CacheDir     string `json:"cacheDir"`
}

func (s *Server) currentSettingsInfo() (settingsInfo, error) {
	settings, err := s.store.Settings()
	if err != nil {
		return settingsInfo{}, err
	}
	return settingsInfo{
		AppSettings:  settings,
		DatabasePath: s.store.Path(),
		ConfigDir:    config.ConfigDir(),
		DataDir:      config.DataDir(),
		CacheDir:     config.CacheDir(),
	}, nil
}

func (s *Server) handleSettings(w http.ResponseWriter, _ *http.Request) {
	settings, err := s.currentSettingsInfo()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": settings})
}

func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var body config.SettingsUpdate
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if _, err := s.store.UpdateSettings(body); err != nil {
		writeError(w, settingsErrorStatus(err), err)
		return
	}
	settings, err := s.currentSettingsInfo()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": settings})
}

func (s *Server) handleSettingsExport(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("content-disposition", `attachment; filename="asset-studio-export.json"`)
	writeJSON(w, http.StatusOK, s.store.ExportData())
}

func (s *Server) handleSettingsImport(w http.ResponseWriter, r *http.Request) {
	var body config.ExportData
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.store.ImportData(body); err != nil {
		if _, ok := err.(apierr.Error); ok {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeError(w, http.StatusBadRequest, projectPathError(err, ""))
		return
	}
	s.clearCatalog()
	writeJSON(w, http.StatusOK, map[string]any{"projects": s.store.Projects()})
}

func (s *Server) handleSettingsResetDatabase(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Confirm string `json:"confirm"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.Confirm != "RESET" {
		writeError(w, http.StatusBadRequest, apierr.New("reset_confirmation_required", "reset confirmation is required"))
		return
	}
	if err := s.store.ResetData(); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	s.clearCatalog()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleCatalog(w http.ResponseWriter, r *http.Request) {
	catalog, err := s.ensureCatalog(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, catalog)
}

func (s *Server) handleScan(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("content-type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("cache-control", "no-store")
	sendNDJSON(w, map[string]any{"type": "start"})
	sendNDJSON(w, map[string]any{"type": "progress", "phase": "scan"})
	catalog, err := s.scan(r.Context())
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "scan_failed")})
		return
	}
	sendNDJSON(w, map[string]any{"type": "done", "stats": catalog.Stats})
}

func (s *Server) handleAsset(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	catalog, err := s.ensureCatalog(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	for _, item := range catalog.Items {
		if item.ID != id {
			continue
		}
		http.ServeFile(w, r, item.LocalPath)
		return
	}
	writeError(w, http.StatusNotFound, apierr.New("asset_not_found", "asset not found"))
}

func (s *Server) handleThumb(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	catalog, err := s.ensureCatalog(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	result, err := s.scanner.Thumbnail(r.Context(), catalog, id, 256)
	if errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusNotFound, apierr.New("asset_not_found", "asset not found"))
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	w.Header().Set("content-type", result.MimeType)
	w.Header().Set("cache-control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, result.Path)
}

func (s *Server) handleOptimizationPreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetID string `json:"assetId"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	_, item, err := s.projectAndItem(r.Context(), body.AssetID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	script := ""
	if len(item.Optimization) > 0 {
		script = "# Preview only. Asset Studio v1.1 does not apply image optimization.\n"
		script += "# Review recommendation codes before running a dedicated optimizer.\n"
		for _, opt := range item.Optimization {
			script += fmt.Sprintf("# %s: %s\n", opt.Category, opt.SuggestionCode)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"assetId":         item.ID,
		"recommendations": item.Optimization,
		"script":          script,
		"canApply":        false,
	})
}

func (s *Server) handleRenamePreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetID    string `json:"assetId"`
		TargetPath string `json:"targetPath"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	project, item, err := s.projectAndItem(r.Context(), body.AssetID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	preview, err := actions.RenamePreview(project, item, body.TargetPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.storePreview(preview)
	writeJSON(w, http.StatusOK, map[string]any{"preview": preview, "token": preview.ID})
}

func (s *Server) handleMergePreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetID       string `json:"assetId"`
		PreferredPath string `json:"preferredPath"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	project, item, err := s.projectAndItem(r.Context(), body.AssetID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	preview, err := actions.MergePreview(project, item, body.PreferredPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.storePreview(preview)
	writeJSON(w, http.StatusOK, map[string]any{"preview": preview, "token": preview.ID})
}

func (s *Server) handleDeletePreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetID string `json:"assetId"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	_, item, err := s.projectAndItem(r.Context(), body.AssetID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	preview := actions.DeleteUnusedPreview(item)
	s.storePreview(preview)
	writeJSON(w, http.StatusOK, map[string]any{"preview": preview, "token": preview.ID})
}

type optimizationSelectionBody struct {
	AssetIDs []string `json:"assetIds"`
}

func (s *Server) selectOptimizationItems(ctx context.Context, ids []string) ([]scanner.AssetItem, error) {
	catalog, err := s.ensureCatalog(ctx)
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		out := make([]scanner.AssetItem, 0, len(catalog.Items))
		for _, item := range catalog.Items {
			if len(item.Optimization) > 0 {
				out = append(out, item)
			}
		}
		return out, nil
	}
	idSet := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		idSet[id] = struct{}{}
	}
	out := make([]scanner.AssetItem, 0, len(idSet))
	for _, item := range catalog.Items {
		if _, ok := idSet[item.ID]; ok {
			out = append(out, item)
		}
	}
	return out, nil
}

func (s *Server) handleOptimizationEstimate(w http.ResponseWriter, r *http.Request) {
	var body optimizationSelectionBody
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	items, err := s.selectOptimizationItems(r.Context(), body.AssetIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, optimize.Compute(items))
}

func (s *Server) handleOptimizationGenerateScript(w http.ResponseWriter, r *http.Request) {
	var body optimizationSelectionBody
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	items, err := s.selectOptimizationItems(r.Context(), body.AssetIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"format":    "bash",
		"script":    optimize.GenerateScript(items),
		"itemCount": len(items),
	})
}

func (s *Server) handlePreCheck(w http.ResponseWriter, r *http.Request) {
	const maxUploadBytes = 64 << 20 // 64 MiB total
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		writeError(w, http.StatusBadRequest, apierr.New("upload_parse_failed", "failed to parse upload"))
		return
	}
	if r.MultipartForm == nil {
		writeError(w, http.StatusBadRequest, apierr.New("upload_missing", "no files uploaded"))
		return
	}
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		writeError(w, http.StatusBadRequest, apierr.New("upload_missing", "no files uploaded"))
		return
	}
	catalog, err := s.ensureCatalog(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	results := make([]precheck.Result, 0, len(files))
	for _, header := range files {
		res, perr := analyzeUpload(r.Context(), header, catalog)
		if perr != nil {
			writeError(w, http.StatusBadRequest, perr)
			return
		}
		results = append(results, res)
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func analyzeUpload(ctx context.Context, header *multipart.FileHeader, catalog scanner.Catalog) (precheck.Result, error) {
	src, err := header.Open()
	if err != nil {
		return precheck.Result{}, apierr.New("upload_open_failed", "failed to open upload")
	}
	defer src.Close()
	tmp, err := os.CreateTemp("", "asset-studio-precheck-*"+filepath.Ext(header.Filename))
	if err != nil {
		return precheck.Result{}, apierr.New("upload_tempfile_failed", "failed to allocate temp file")
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		return precheck.Result{}, apierr.New("upload_write_failed", "failed to write upload")
	}
	if err := tmp.Close(); err != nil {
		return precheck.Result{}, apierr.New("upload_close_failed", "failed to close upload")
	}
	return precheck.Analyze(ctx, header.Filename, tmpPath, catalog)
}

func (s *Server) handleApply(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token string `json:"token"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	preview, ok := s.takePreview(body.Token)
	if !ok {
		writeError(w, http.StatusNotFound, apierr.New("preview_token_invalid", "preview token is invalid or expired"))
		return
	}
	project, err := s.projectByID(preview.ProjectID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := actions.Apply(project, preview)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	go func() {
		_, _ = s.scan(context.Background())
	}()
	writeJSON(w, http.StatusOK, map[string]any{"result": result})
}

func (s *Server) ensureCatalog(ctx context.Context) (scanner.Catalog, error) {
	s.mu.Lock()
	hasCatalog := s.catalog.GeneratedAt != ""
	catalog := s.catalog
	s.mu.Unlock()
	if hasCatalog {
		return catalog, nil
	}
	return s.scan(ctx)
}

func (s *Server) scan(ctx context.Context) (scanner.Catalog, error) {
	projects := toScannerProjects(s.store.Projects())
	catalog, err := s.scanner.Scan(ctx, projects)
	if err != nil {
		return scanner.Catalog{}, err
	}
	if err := s.store.RecordScan(catalog); err != nil {
		return scanner.Catalog{}, err
	}
	s.mu.Lock()
	s.catalog = catalog
	s.mu.Unlock()
	return catalog, nil
}

func (s *Server) projectAndItem(ctx context.Context, assetID string) (scanner.Project, scanner.AssetItem, error) {
	catalog, err := s.ensureCatalog(ctx)
	if err != nil {
		return scanner.Project{}, scanner.AssetItem{}, err
	}
	for _, item := range catalog.Items {
		if item.ID != assetID {
			continue
		}
		project, err := s.projectByID(item.ProjectID)
		if err != nil {
			return scanner.Project{}, scanner.AssetItem{}, err
		}
		return project, item, nil
	}
	return scanner.Project{}, scanner.AssetItem{}, apierr.New("asset_not_found", "asset not found")
}

func (s *Server) projectByID(id string) (scanner.Project, error) {
	for _, project := range toScannerProjects(s.store.Projects()) {
		if project.ID == id {
			return project, nil
		}
	}
	return scanner.Project{}, apierr.New("project_not_found", "project not found")
}

func (s *Server) storePreview(preview actions.Preview) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.previews[preview.ID] = preview
}

func (s *Server) takePreview(id string) (actions.Preview, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	preview, ok := s.previews[id]
	if ok {
		delete(s.previews, id)
	}
	return preview, ok
}

func (s *Server) clearCatalog() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.catalog = scanner.Catalog{}
	s.previews = map[string]actions.Preview{}
}

func toScannerProjects(projects []config.Project) []scanner.Project {
	out := make([]scanner.Project, 0, len(projects))
	for _, project := range projects {
		out = append(out, scanner.Project{ID: project.ID, Name: project.Name, Path: project.Path})
	}
	return out
}

func normalizeBasePath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" || path == "/" {
		return ""
	}
	return "/" + strings.Trim(path, "/")
}

func (s *Server) wrapBasePath(next http.Handler) http.Handler {
	if s.basePath == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == strings.TrimRight(s.basePath, "/") {
			http.Redirect(w, r, s.basePath+"/", http.StatusTemporaryRedirect)
			return
		}
		if !strings.HasPrefix(r.URL.Path, s.basePath+"/") {
			http.NotFound(w, r)
			return
		}
		r2 := r.Clone(r.Context())
		r2.URL.Path = strings.TrimPrefix(r.URL.Path, s.basePath)
		if r2.URL.Path == "" {
			r2.URL.Path = "/"
		}
		next.ServeHTTP(w, r2)
	})
}

func readJSON(r *http.Request, target any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(target)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, err error) {
	fallback := "internal_error"
	if status >= 400 && status < 500 {
		fallback = "bad_request"
	}
	writeJSON(w, status, map[string]any{"error": apierr.From(err, fallback)})
}

func sendNDJSON(w http.ResponseWriter, value any) {
	bytes, _ := json.Marshal(value)
	_, _ = w.Write(append(bytes, '\n'))
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
}

func uiPlaceholderHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("content-type", "text/html; charset=utf-8")
	_, _ = fmt.Fprint(w, `<!doctype html>
<html><head><meta charset="utf-8"><title>Asset Studio</title></head>
<body style="font-family:system-ui;margin:48px;line-height:1.5">
<h1>Asset Studio dev server is running</h1>
<p>Run <code>cd ui && pnpm run dev</code>, then open the Vite URL. Vite proxies <code>/api</code> to this Go server.</p>
</body></html>`)
}

func spaHandlerFromDisk(dir, basePath string) http.Handler {
	indexPath := filepath.Join(dir, "index.html")
	index, _ := os.ReadFile(indexPath)
	if basePath != "" && len(index) > 0 {
		injection := []byte(`<script>window.__BASE_PATH__=` + fmt.Sprintf("%q", basePath) + `;</script>`)
		index = []byte(strings.Replace(string(index), "<head>", "<head>"+string(injection), 1))
	}
	fileServer := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cleanPath := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
		if cleanPath == "." {
			w.Header().Set("content-type", "text/html; charset=utf-8")
			_, _ = w.Write(index)
			return
		}
		target := filepath.Join(dir, cleanPath)
		absDir, _ := filepath.Abs(dir)
		absTarget, _ := filepath.Abs(target)
		if absTarget == absDir || strings.HasPrefix(absTarget, absDir+string(filepath.Separator)) {
			if info, err := os.Stat(absTarget); err == nil && !info.IsDir() {
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		w.Header().Set("content-type", "text/html; charset=utf-8")
		_, _ = w.Write(index)
	})
}
