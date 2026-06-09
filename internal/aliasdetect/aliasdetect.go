// Package aliasdetect reads import-alias declarations from a project's own
// build/IDE config files (tsconfig.json/jsconfig.json compilerOptions.paths and
// vite/next resolve.alias) and normalizes them into a map of alias key ->
// repo-relative path, suitable for references.ResolveWithAliases.
//
// Detection is best-effort and never fails a scan: missing or malformed files
// are skipped and whatever could be parsed is returned. Alias values are made
// relative to the project root because the resolver expects repo-relative paths.
package aliasdetect

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/tailscale/hujson"
)

// Detect collects aliases declared in projectRoot's own tsconfig/jsconfig and
// vite/next config. tsconfig is the base layer; vite/next is overlaid on top
// (it is the runtime source of truth for bundling). Returns nil when nothing
// usable is found. Only the project's own root is inspected — cross-package
// monorepo aliases are expected to come from the manual importAliases setting.
func Detect(projectRoot string) map[string]string {
	if projectRoot == "" {
		return nil
	}
	out := map[string]string{}
	for k, v := range detectTSConfig(projectRoot) {
		out[k] = v
	}
	for k, v := range detectViteLikeConfig(projectRoot) {
		out[k] = v
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// Merge returns auto with manual overlaid on top: manual entries win on key
// collision. Both inputs may be nil.
func Merge(auto, manual map[string]string) map[string]string {
	if len(auto) == 0 && len(manual) == 0 {
		return nil
	}
	out := make(map[string]string, len(auto)+len(manual))
	for k, v := range auto {
		out[k] = v
	}
	for k, v := range manual {
		out[k] = v
	}
	return out
}

// aliasKey normalizes a declared alias key by stripping a trailing glob and
// slash (e.g. "@/*" -> "@", "@components/" -> "@components").
func aliasKey(raw string) string {
	return strings.TrimSuffix(strings.TrimSuffix(strings.TrimSpace(raw), "*"), "/")
}

// repoRelative resolves a declared target value (relative to baseDir) into a
// clean repo-relative path rooted at projectRoot. It rejects values that escape
// the project root or resolve to the root itself.
func repoRelative(projectRoot, baseDir, raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimSuffix(strings.TrimSuffix(raw, "*"), "/")
	// An empty target (e.g. paths "@/*": ["*"]) means the alias points at
	// baseDir itself; resolving "" against baseDir yields baseDir. The rel
	// guard below still rejects the project-root case.
	abs := filepath.Join(baseDir, filepath.FromSlash(raw))
	rel, err := filepath.Rel(projectRoot, abs)
	if err != nil {
		return "", false
	}
	rel = filepath.ToSlash(rel)
	if rel == "." || rel == "" || strings.HasPrefix(rel, "..") {
		return "", false
	}
	return rel, true
}

// --- tsconfig / jsconfig ---

type tsConfigRaw struct {
	Extends         json.RawMessage `json:"extends"`
	CompilerOptions struct {
		BaseURL string              `json:"baseUrl"`
		Paths   map[string][]string `json:"paths"`
	} `json:"compilerOptions"`
}

func detectTSConfig(projectRoot string) map[string]string {
	for _, name := range []string{"tsconfig.json", "jsconfig.json"} {
		path := filepath.Join(projectRoot, name)
		if _, err := os.Stat(path); err != nil {
			continue
		}
		if aliases := loadTSConfigChain(projectRoot, path, 0, map[string]bool{}); len(aliases) > 0 {
			return aliases
		}
	}
	return nil
}

// loadTSConfigChain reads one tsconfig and its relative `extends` ancestors,
// resolving paths against each config's own baseUrl. Inherited aliases are
// applied first so the inheriting config wins on key collision. Cycles and
// runaway depth are guarded.
func loadTSConfigChain(projectRoot, configPath string, depth int, seen map[string]bool) map[string]string {
	if depth > 8 || seen[configPath] {
		return nil
	}
	seen[configPath] = true

	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil
	}
	std, err := hujson.Standardize(data)
	if err != nil {
		return nil
	}
	var cfg tsConfigRaw
	if err := json.Unmarshal(std, &cfg); err != nil {
		return nil
	}

	result := map[string]string{}
	configDir := filepath.Dir(configPath)

	for _, ext := range parseExtends(cfg.Extends) {
		if !strings.HasPrefix(ext, "./") && !strings.HasPrefix(ext, "../") {
			continue // relative extends only (MVP)
		}
		extPath := filepath.Join(configDir, filepath.FromSlash(ext))
		if filepath.Ext(extPath) == "" {
			extPath += ".json"
		}
		for k, v := range loadTSConfigChain(projectRoot, extPath, depth+1, seen) {
			result[k] = v
		}
	}

	base := configDir
	if bu := cfg.CompilerOptions.BaseURL; bu != "" {
		base = filepath.Join(configDir, filepath.FromSlash(bu))
	}
	for key, vals := range cfg.CompilerOptions.Paths {
		if len(vals) == 0 {
			continue
		}
		k := aliasKey(key)
		if k == "" {
			continue
		}
		if rel, ok := repoRelative(projectRoot, base, vals[0]); ok {
			result[k] = rel
		}
	}
	return result
}

func parseExtends(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return []string{s}
	}
	var arr []string
	if json.Unmarshal(raw, &arr) == nil {
		return arr
	}
	return nil
}

// --- vite / next config (heuristic, best-effort) ---

var (
	viteLikeConfigNames = []string{
		"vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.mts", "vite.config.cjs",
		"next.config.js", "next.config.mjs", "next.config.ts", "next.config.cjs",
	}
	aliasBlockRe    = regexp.MustCompile(`(?s)\balias\b\s*:\s*([\[{])`)
	stringLiteralRe = regexp.MustCompile(`['"]([^'"]*)['"]`)
)

func detectViteLikeConfig(projectRoot string) map[string]string {
	for _, name := range viteLikeConfigNames {
		path := filepath.Join(projectRoot, name)
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		if aliases := parseViteAliases(projectRoot, string(data)); len(aliases) > 0 {
			return aliases
		}
	}
	return nil
}

func parseViteAliases(projectRoot, src string) map[string]string {
	block, kind, ok := extractAliasBlock(src)
	if !ok {
		return nil
	}
	inner := block
	if len(inner) >= 2 {
		inner = inner[1 : len(inner)-1] // strip outer { } or [ ]
	}
	out := map[string]string{}
	if kind == '[' {
		for _, item := range splitTopLevel(inner) {
			if find, repl := arrayAliasEntry(item); find != "" {
				addViteAlias(projectRoot, out, find, repl)
			}
		}
		return out
	}
	for _, part := range splitTopLevel(inner) {
		if key, val := objectEntry(part); key != "" {
			addViteAlias(projectRoot, out, key, val)
		}
	}
	return out
}

// objectEntry splits a `key: value` fragment at its top-level colon, unquoting
// the key. The value is returned as a raw expression (may contain commas).
func objectEntry(part string) (string, string) {
	idx := topLevelColon(part)
	if idx < 0 {
		return "", ""
	}
	key := strings.Trim(strings.TrimSpace(part[:idx]), "'\"`")
	return key, strings.TrimSpace(part[idx+1:])
}

// arrayAliasEntry parses a `{ find: '@', replacement: <expr> }` object literal.
func arrayAliasEntry(item string) (string, string) {
	item = strings.TrimSpace(item)
	item = strings.TrimSuffix(strings.TrimPrefix(item, "{"), "}")
	var find, repl string
	for _, part := range splitTopLevel(item) {
		switch key, val := objectEntry(part); key {
		case "find":
			find = strings.Trim(strings.TrimSpace(val), "'\"`")
		case "replacement":
			repl = val
		}
	}
	return find, repl
}

// splitTopLevel splits s on commas that are not inside (), [], {}, or a quoted
// string. Used to break a config object/array body into entries without
// tripping over commas inside expressions like path.resolve(__dirname, 'src').
func splitTopLevel(s string) []string {
	var parts []string
	depth := 0
	var quote byte
	start := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		if quote != 0 {
			if c == quote && s[i-1] != '\\' {
				quote = 0
			}
			continue
		}
		switch c {
		case '\'', '"', '`':
			quote = c
		case '(', '[', '{':
			depth++
		case ')', ']', '}':
			depth--
		case ',':
			if depth == 0 {
				parts = append(parts, s[start:i])
				start = i + 1
			}
		}
	}
	return append(parts, s[start:])
}

// topLevelColon returns the index of the first colon not inside brackets or a
// quoted string, or -1.
func topLevelColon(s string) int {
	depth := 0
	var quote byte
	for i := 0; i < len(s); i++ {
		c := s[i]
		if quote != 0 {
			if c == quote && s[i-1] != '\\' {
				quote = 0
			}
			continue
		}
		switch c {
		case '\'', '"', '`':
			quote = c
		case '(', '[', '{':
			depth++
		case ')', ']', '}':
			depth--
		case ':':
			if depth == 0 {
				return i
			}
		}
	}
	return -1
}

func addViteAlias(projectRoot string, out map[string]string, rawKey, rawVal string) {
	k := aliasKey(rawKey)
	if k == "" {
		return
	}
	target := extractStaticPath(rawVal)
	if target == "" {
		return
	}
	target = strings.TrimPrefix(target, "/") // vite treats /src as project-root relative
	if rel, ok := repoRelative(projectRoot, projectRoot, target); ok {
		out[k] = rel
	}
}

// extractAliasBlock returns the text of the first `alias: { ... }` or
// `alias: [ ... ]` block and whether it is an object or array, by matching
// brackets of the opening kind.
func extractAliasBlock(src string) (string, byte, bool) {
	loc := aliasBlockRe.FindStringSubmatchIndex(src)
	if loc == nil {
		return "", 0, false
	}
	start := loc[2]
	open := src[start]
	close := byte('}')
	if open == '[' {
		close = ']'
	}
	depth := 0
	for i := start; i < len(src); i++ {
		switch src[i] {
		case open:
			depth++
		case close:
			depth--
			if depth == 0 {
				return src[start : i+1], open, true
			}
		}
	}
	return "", 0, false
}

// extractStaticPath pulls a static path string out of an alias value
// expression, unwrapping the common path.resolve(__dirname, 'x') and
// fileURLToPath(new URL('./x', import.meta.url)) wrappers. Returns "" when no
// statically-known path is present.
func extractStaticPath(expr string) string {
	expr = strings.TrimSpace(strings.Trim(expr, ",};]"))
	lits := stringLiteralRe.FindAllStringSubmatch(expr, -1)
	if len(lits) == 0 {
		return ""
	}
	if strings.Contains(expr, "import.meta.url") || strings.Contains(expr, "new URL") {
		return lits[0][1] // URL(<path>, base): path is the first literal
	}
	return lits[len(lits)-1][1] // path.resolve/join(__dirname, <path>): path is last literal
}
