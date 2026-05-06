package main

import (
	"context"
	"fmt"
	"os"

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

	catalog, err := scanCatalog(context.Background(), store)
	if err != nil {
		return err
	}

	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "catalog": catalog})
	}
	fmt.Printf("Projects: %d\n", len(catalog.Projects))
	fmt.Printf("Assets: %d\n", catalog.Stats.TotalFiles)
	fmt.Printf("Duplicate files: %d in %d groups\n", catalog.Stats.DuplicateFiles, catalog.Stats.DuplicateGroups)
	fmt.Printf("Near duplicates: %d\n", catalog.Stats.NearDuplicates)
	fmt.Printf("Unused files: %d\n", catalog.Stats.UnusedFiles)
	fmt.Printf("Cache hits: %d\n", catalog.Stats.CacheHits)
	return nil
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
		out = append(out, scanner.Project{ID: project.ID, Name: project.Name, Path: project.Path})
	}
	return out
}
