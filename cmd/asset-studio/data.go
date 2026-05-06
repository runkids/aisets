package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"asset-studio/internal/config"
	"asset-studio/internal/scanner"
)

func cmdProjects(args []string) error {
	if len(args) > 0 && args[0] == "add" {
		return cmdProjectsAdd(args[1:])
	}

	args, forcedJSON := stripJSONFlag(args)
	fs := flag.NewFlagSet("projects", flag.ContinueOnError)
	jsonOut := fs.Bool("json", false, "print JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}
	*jsonOut = *jsonOut || forcedJSON
	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()

	projects := store.Projects()
	if *jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "projects": projects})
	}
	for _, project := range projects {
		fmt.Printf("%s\t%s\n", project.Name, project.Path)
	}
	return nil
}

func cmdProjectsAdd(args []string) error {
	args, forcedJSON := stripJSONFlag(args)
	fs := flag.NewFlagSet("projects add", flag.ContinueOnError)
	jsonOut := fs.Bool("json", false, "print JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}
	*jsonOut = *jsonOut || forcedJSON
	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()

	if err := store.AddProjects(fs.Args()); err != nil {
		return err
	}
	projects := store.Projects()
	if *jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "projects": projects})
	}
	fmt.Printf("Imported projects: %d\n", len(projects))
	return nil
}

func cmdScan(args []string) error {
	args, forcedJSON := stripJSONFlag(args)
	fs := flag.NewFlagSet("scan", flag.ContinueOnError)
	jsonOut := fs.Bool("json", false, "print full catalog JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}
	*jsonOut = *jsonOut || forcedJSON

	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()
	if err := store.AddProjects(fs.Args()); err != nil {
		return err
	}

	projects := toScannerProjects(store.Projects())
	catalog, err := scanner.New().Scan(context.Background(), projects)
	if err != nil {
		return err
	}
	if err := store.RecordScan(catalog); err != nil {
		return err
	}

	if *jsonOut {
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
