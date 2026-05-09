package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"aisets/internal/apierr"
	"aisets/internal/config"
	"aisets/internal/precheck"
)

func cmdPreCheck(args []string, jsonOut bool) error {
	args, forcedJSON := stripJSONFlag(args)
	jsonOut = jsonOut || forcedJSON
	fs := newFlagSet("pre-check", jsonOut)
	if err := parseFlagSet(fs, args); err != nil {
		return err
	}
	files := fs.Args()
	if len(files) == 0 {
		return apierr.New("pre_check_files_required", "pre-check requires at least one file path")
	}
	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()
	catalog, err := scanCatalog(context.Background(), store)
	if err != nil {
		return err
	}
	results := make([]precheck.Result, 0, len(files))
	for _, path := range files {
		abs, err := filepath.Abs(path)
		if err != nil {
			return apierr.WithParams("pre_check_path_invalid", "pre-check file path is invalid", map[string]any{"path": path})
		}
		result, err := precheck.Analyze(context.Background(), filepath.Base(abs), abs, catalog)
		if err != nil {
			return err
		}
		results = append(results, result)
	}
	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "results": results})
	}
	for _, result := range results {
		fmt.Printf("%s\t%s\t%s\n", result.Name, result.Verdict, result.VerdictReason)
	}
	return nil
}
