package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"

	"aisets/internal/actions"
	"aisets/internal/apierr"
	"aisets/internal/config"
)

func cmdActions(args []string, jsonOut bool) error {
	args, forcedJSON := stripJSONFlag(args)
	jsonOut = jsonOut || forcedJSON
	if len(args) == 0 {
		return apierr.New("actions_subcommand_required", "actions subcommand is required")
	}
	switch args[0] {
	case "rename":
		return cmdActionRename(args[1:], jsonOut)
	case "merge-duplicates":
		return cmdActionMergeDuplicates(args[1:], jsonOut)
	case "delete-unused":
		return cmdActionDeleteUnused(args[1:], jsonOut)
	case "apply":
		return cmdActionApply(args[1:], jsonOut)
	default:
		return apierr.WithParams("actions_subcommand_unknown", "unknown actions subcommand", map[string]any{"subcommand": args[0]})
	}
}

func cmdActionRename(args []string, jsonOut bool) error {
	if len(args) == 0 || args[0] != "preview" {
		return apierr.New("actions_rename_preview_required", "actions rename requires the preview subcommand")
	}
	fs := newFlagSet("actions rename preview", jsonOut)
	assetID := fs.String("asset-id", "", "asset id")
	targetPath := fs.String("target-path", "", "target repo path")
	if err := parseFlagSet(fs, args[1:]); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return apierr.WithParams("actions_rename_preview_unexpected_args", "actions rename preview does not accept positional arguments", map[string]any{"args": fs.Args()})
	}
	if *assetID == "" {
		return apierr.New("asset_id_required", "asset id is required")
	}
	if *targetPath == "" {
		return apierr.New("target_path_required", "target path is required")
	}
	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()
	project, item, err := projectAndItem(context.Background(), store, *assetID)
	if err != nil {
		return err
	}
	preview, err := actions.RenamePreview(project, item, *targetPath)
	if err != nil {
		return err
	}
	return writeActionPreview(preview, jsonOut)
}

func cmdActionMergeDuplicates(args []string, jsonOut bool) error {
	if len(args) == 0 || args[0] != "preview" {
		return apierr.New("actions_merge_preview_required", "actions merge-duplicates requires the preview subcommand")
	}
	fs := newFlagSet("actions merge-duplicates preview", jsonOut)
	assetID := fs.String("asset-id", "", "asset id")
	preferredPath := fs.String("preferred-path", "", "preferred duplicate repo path")
	if err := parseFlagSet(fs, args[1:]); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return apierr.WithParams("actions_merge_preview_unexpected_args", "actions merge-duplicates preview does not accept positional arguments", map[string]any{"args": fs.Args()})
	}
	if *assetID == "" {
		return apierr.New("asset_id_required", "asset id is required")
	}
	if *preferredPath == "" {
		return apierr.New("preferred_path_required", "preferred path is required")
	}
	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()
	project, item, err := projectAndItem(context.Background(), store, *assetID)
	if err != nil {
		return err
	}
	preview, err := actions.MergePreview(project, item, *preferredPath)
	if err != nil {
		return err
	}
	return writeActionPreview(preview, jsonOut)
}

func cmdActionDeleteUnused(args []string, jsonOut bool) error {
	if len(args) == 0 || args[0] != "preview" {
		return apierr.New("actions_delete_preview_required", "actions delete-unused requires the preview subcommand")
	}
	fs := newFlagSet("actions delete-unused preview", jsonOut)
	assetID := fs.String("asset-id", "", "asset id")
	if err := parseFlagSet(fs, args[1:]); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return apierr.WithParams("actions_delete_preview_unexpected_args", "actions delete-unused preview does not accept positional arguments", map[string]any{"args": fs.Args()})
	}
	if *assetID == "" {
		return apierr.New("asset_id_required", "asset id is required")
	}
	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()
	_, item, err := projectAndItem(context.Background(), store, *assetID)
	if err != nil {
		return err
	}
	preview := actions.DeleteUnusedPreview(item)
	return writeActionPreview(preview, jsonOut)
}

func writeActionPreview(preview actions.Preview, jsonOut bool) error {
	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "preview": preview})
	}
	fmt.Printf("Preview: %s\n", preview.ID)
	fmt.Printf("Type: %s\n", preview.Type)
	fmt.Printf("Can apply: %t\n", preview.CanApply)
	fmt.Printf("Changes: %d\n", len(preview.Changes))
	fmt.Printf("Deletes: %d\n", len(preview.Deletes))
	fmt.Printf("Blockers: %d\n", len(preview.Blockers))
	return nil
}

func cmdActionApply(args []string, jsonOut bool) error {
	fs := newFlagSet("actions apply", jsonOut)
	previewPath := fs.String("preview", "", "preview JSON file or - for stdin")
	if err := parseFlagSet(fs, args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return apierr.WithParams("actions_apply_unexpected_args", "actions apply does not accept positional arguments", map[string]any{"args": fs.Args()})
	}
	if *previewPath == "" {
		return apierr.New("preview_required", "preview file is required")
	}
	preview, err := readPreviewInput(*previewPath)
	if err != nil {
		return err
	}
	if preview.ProjectID == "" {
		return apierr.New("preview_project_id_required", "preview project id is required")
	}
	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()
	project, err := projectByID(store, preview.ProjectID)
	if err != nil {
		return err
	}
	result, err := actions.Apply(project, preview)
	if err != nil {
		return err
	}
	catalog, scanErr := scanCatalog(context.Background(), store)
	if jsonOut {
		body := map[string]any{"ok": true, "result": result}
		if scanErr == nil {
			body["stats"] = catalog.Stats
		} else {
			body["scanError"] = apierr.From(scanErr, "scan_failed")
		}
		return writeJSON(os.Stdout, body)
	}
	fmt.Printf("Applied at: %s\n", result.AppliedAt)
	fmt.Printf("Changed references: %d\n", result.ChangedReferences)
	fmt.Printf("Moved files: %d\n", result.MovedFiles)
	fmt.Printf("Deleted files: %d\n", result.DeletedFiles)
	if scanErr != nil {
		fmt.Fprintf(os.Stderr, "aisets actions: post-apply scan failed: %v\n", scanErr)
	}
	return nil
}

func readPreviewInput(path string) (actions.Preview, error) {
	var bytes []byte
	var err error
	if path == "-" {
		bytes, err = io.ReadAll(os.Stdin)
	} else {
		bytes, err = os.ReadFile(path)
	}
	if err != nil {
		return actions.Preview{}, err
	}
	var envelope struct {
		Preview actions.Preview `json:"preview"`
	}
	if err := json.Unmarshal(bytes, &envelope); err == nil && envelope.Preview.ID != "" {
		return envelope.Preview, nil
	}
	var preview actions.Preview
	if err := json.Unmarshal(bytes, &preview); err != nil {
		return actions.Preview{}, apierr.New("preview_json_invalid", err.Error())
	}
	if preview.ID == "" {
		return actions.Preview{}, apierr.New("preview_json_invalid", "preview JSON is missing id")
	}
	return preview, nil
}
