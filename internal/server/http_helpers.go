package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"asset-studio/internal/apierr"
)

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
