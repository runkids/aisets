package server

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync"
	"time"

	"asset-studio/internal/actions"
	"asset-studio/internal/config"
	"asset-studio/internal/ocr"
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
	ocrEngine ocr.Engine
	onReady   func()

	mu            sync.Mutex
	catalog       scanner.Catalog
	previews      map[string]actions.Preview
	batchPreviews map[string]actions.BatchPreview
}

func New(opts Options) (*Server, error) {
	s := &Server{
		addr:          opts.Addr,
		basePath:      normalizeBasePath(opts.BasePath),
		store:         opts.Store,
		uiDistDir:     opts.UIDistDir,
		version:       opts.Version,
		mux:           http.NewServeMux(),
		scanner:       scanner.New(),
		ocrEngine:     ocr.NewDefaultEngine(config.DataDir()),
		previews:      map[string]actions.Preview{},
		batchPreviews: map[string]actions.BatchPreview{},
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
	s.mux.HandleFunc("POST /api/workspaces/add", s.handleAddWorkspace)
	s.mux.HandleFunc("POST /api/workspaces/switch", s.handleSwitchWorkspace)
	s.mux.HandleFunc("POST /api/workspaces/rename", s.handleRenameWorkspace)
	s.mux.HandleFunc("POST /api/workspaces/remove", s.handleRemoveWorkspace)
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
	s.mux.HandleFunc("POST /api/ocr/install", s.handleOCRInstall)
	s.mux.HandleFunc("POST /api/ocr/remove", s.handleOCRRemove)
	s.mux.HandleFunc("POST /api/ocr/run", s.handleOCRRun)
	s.mux.HandleFunc("GET /api/scans", s.handleScans)
	s.mux.HandleFunc("GET /api/scans/{id}", s.handleScanSummary)
	s.mux.HandleFunc("GET /api/scans/diff", s.handleScanDiff)
	s.mux.HandleFunc("GET /api/assets/{id}", s.handleAsset)
	s.mux.HandleFunc("GET /api/thumbs/{id}", s.handleThumb)
	s.mux.HandleFunc("POST /api/actions/optimization/preview", s.handleOptimizationPreview)
	s.mux.HandleFunc("POST /api/actions/rename/preview", s.handleRenamePreview)
	s.mux.HandleFunc("POST /api/actions/rename/apply", s.handleApply)
	s.mux.HandleFunc("POST /api/actions/merge-duplicates/preview", s.handleMergePreview)
	s.mux.HandleFunc("POST /api/actions/merge-duplicates/apply", s.handleApply)
	s.mux.HandleFunc("POST /api/actions/delete-unused/preview", s.handleDeletePreview)
	s.mux.HandleFunc("POST /api/actions/delete-unused/apply", s.handleApply)
	s.mux.HandleFunc("POST /api/actions/batch/delete", s.handleBatchDelete)
	s.mux.HandleFunc("POST /api/actions/batch/move/preview", s.handleBatchMovePreview)
	s.mux.HandleFunc("POST /api/actions/batch/move/apply", s.handleBatchApply)
	s.mux.HandleFunc("POST /api/actions/batch/rename/preview", s.handleBatchRenamePreview)
	s.mux.HandleFunc("POST /api/actions/batch/rename/apply", s.handleBatchApply)
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
