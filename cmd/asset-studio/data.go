package main

import (
	"context"
	"fmt"
	"os"
	"strconv"

	"asset-studio/internal/apierr"
	"asset-studio/internal/config"
	"asset-studio/internal/scanner"
)

func cmdProjects(args []string, jsonOut bool) error {
	args, forcedJSON := stripJSONFlag(args)
	jsonOut = jsonOut || forcedJSON
	if len(args) > 0 {
		switch args[0] {
		case "add":
			return cmdProjectsAdd(args[1:], jsonOut)
		case "rename":
			return cmdProjectsRename(args[1:], jsonOut)
		case "remove":
			return cmdProjectsRemove(args[1:], jsonOut)
		}
	}

	fs := newFlagSet("projects", jsonOut)
	if err := parseFlagSet(fs, args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return apierr.WithParams("projects_unexpected_args", "projects does not accept positional arguments", map[string]any{"args": fs.Args()})
	}
	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()

	projects := store.Projects()
	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "projects": projects})
	}
	for _, project := range projects {
		fmt.Printf("%s\t%s\n", project.Name, project.Path)
	}
	return nil
}

func cmdProjectsAdd(args []string, jsonOut bool) error {
	fs := newFlagSet("projects add", jsonOut)
	if err := parseFlagSet(fs, args); err != nil {
		return err
	}
	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()

	if err := store.AddProjects(fs.Args()); err != nil {
		return err
	}
	projects := store.Projects()
	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "projects": projects})
	}
	fmt.Printf("Imported projects: %d\n", len(projects))
	return nil
}

func cmdProjectsRename(args []string, jsonOut bool) error {
	fs := newFlagSet("projects rename", jsonOut)
	id := fs.String("id", "", "project id")
	name := fs.String("name", "", "project name")
	if err := parseFlagSet(fs, args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return apierr.WithParams("projects_rename_unexpected_args", "projects rename does not accept positional arguments", map[string]any{"args": fs.Args()})
	}
	if *id == "" {
		return apierr.New("project_id_required", "project id is required")
	}
	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()
	if err := store.RenameProject(*id, *name); err != nil {
		return err
	}
	projects := store.Projects()
	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "projects": projects})
	}
	fmt.Printf("Renamed project: %s\n", *id)
	return nil
}

func cmdProjectsRemove(args []string, jsonOut bool) error {
	fs := newFlagSet("projects remove", jsonOut)
	id := fs.String("id", "", "project id")
	if err := parseFlagSet(fs, args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return apierr.WithParams("projects_remove_unexpected_args", "projects remove does not accept positional arguments", map[string]any{"args": fs.Args()})
	}
	if *id == "" {
		return apierr.New("project_id_required", "project id is required")
	}
	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()
	if err := store.RemoveProject(*id); err != nil {
		return err
	}
	projects := store.Projects()
	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "projects": projects})
	}
	fmt.Printf("Removed project: %s\n", *id)
	return nil
}

func cmdScan(args []string, jsonOut bool) error {
	args, forcedJSON := stripJSONFlag(args)
	jsonOut = jsonOut || forcedJSON
	fs := newFlagSet("scan", jsonOut)
	if err := parseFlagSet(fs, args); err != nil {
		return err
	}

	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()
	if err := store.AddProjects(fs.Args()); err != nil {
		return err
	}

	catalog, scanID, err := scanCatalogWithID(context.Background(), store)
	if err != nil {
		return err
	}

	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "scanId": scanID, "catalog": catalog})
	}
	fmt.Printf("Scan: %d\n", scanID)
	fmt.Printf("Projects: %d\n", len(catalog.Projects))
	fmt.Printf("Assets: %d\n", catalog.Stats.TotalFiles)
	fmt.Printf("Duplicate files: %d in %d groups\n", catalog.Stats.DuplicateFiles, catalog.Stats.DuplicateGroups)
	fmt.Printf("Near duplicates: %d\n", catalog.Stats.NearDuplicates)
	fmt.Printf("Unused files: %d\n", catalog.Stats.UnusedFiles)
	fmt.Printf("Cache hits: %d\n", catalog.Stats.CacheHits)
	return nil
}

func cmdScans(args []string, jsonOut bool) error {
	args, forcedJSON := stripJSONFlag(args)
	jsonOut = jsonOut || forcedJSON
	if len(args) > 0 {
		switch args[0] {
		case "list":
			return cmdScansList(args[1:], jsonOut)
		case "diff":
			return cmdScansDiff(args[1:], jsonOut)
		}
	}
	return cmdScansList(args, jsonOut)
}

func cmdScansList(args []string, jsonOut bool) error {
	fs := newFlagSet("scans list", jsonOut)
	if err := parseFlagSet(fs, args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return apierr.WithParams("scans_list_unexpected_args", "scans list does not accept positional arguments", map[string]any{"args": fs.Args()})
	}
	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()
	scans, err := store.ListScans()
	if err != nil {
		return err
	}
	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "scans": scans})
	}
	for _, scan := range scans {
		fmt.Printf("%d\t%s\t%d assets\t%d unused\n", scan.ID, scan.CompletedAt, scan.TotalFiles, scan.UnusedFiles)
	}
	return nil
}

func cmdScansDiff(args []string, jsonOut bool) error {
	fs := newFlagSet("scans diff", jsonOut)
	baseRaw := fs.String("base", "", "base scan id")
	targetRaw := fs.String("target", "", "target scan id")
	if err := parseFlagSet(fs, args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return apierr.WithParams("scans_diff_unexpected_args", "scans diff does not accept positional arguments", map[string]any{"args": fs.Args()})
	}
	baseID, err := parseScanID(*baseRaw, "base")
	if err != nil {
		return err
	}
	targetID, err := parseScanID(*targetRaw, "target")
	if err != nil {
		return err
	}
	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()
	diff, err := store.DiffScans(baseID, targetID)
	if err != nil {
		return err
	}
	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "diff": diff})
	}
	fmt.Printf("Base: %d\n", diff.Base.ID)
	fmt.Printf("Target: %d\n", diff.Target.ID)
	fmt.Printf("Added: %d\n", diff.Summary.Added)
	fmt.Printf("Removed: %d\n", diff.Summary.Removed)
	fmt.Printf("Modified: %d\n", diff.Summary.Modified)
	fmt.Printf("Reference changes: %d\n", diff.Summary.ReferenceChanged)
	fmt.Printf("Became unused: %d\n", diff.Summary.BecameUnused)
	fmt.Printf("No longer unused: %d\n", diff.Summary.NoLongerUnused)
	fmt.Printf("Total byte delta: %d\n", diff.Summary.TotalByteDelta)
	fmt.Printf("Optimization savings delta: %d\n", diff.Summary.OptimizationSavingsDelta)
	return nil
}

func parseScanID(raw, name string) (int64, error) {
	if raw == "" {
		return 0, apierr.WithParams("scan_id_required", "scan id is required", map[string]any{"param": name})
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, apierr.WithParams("scan_id_invalid", "scan id is invalid", map[string]any{"param": name, "value": raw})
	}
	return id, nil
}

func stripJSONFlag(args []string) ([]string, bool) {
	out := make([]string, 0, len(args))
	found := false
	for _, arg := range args {
		if arg == "--json" {
			found = true
			continue
		}
		out = append(out, arg)
	}
	return out, found
}

func toScannerProjects(projects []config.Project) []scanner.Project {
	out := make([]scanner.Project, 0, len(projects))
	for _, project := range projects {
		out = append(out, scanner.Project{ID: project.ID, WorkspaceID: project.WorkspaceID, Name: project.Name, Path: project.Path, CreatedAt: project.CreatedAt})
	}
	return out
}
