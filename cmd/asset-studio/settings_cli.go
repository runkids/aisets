package main

import (
	"encoding/json"
	"fmt"
	"os"

	"asset-studio/internal/apierr"
	"asset-studio/internal/config"
)

type cliSettingsInfo struct {
	config.AppSettings
	DatabasePath string `json:"databasePath"`
	DataDir      string `json:"dataDir"`
	CacheDir     string `json:"cacheDir"`
}

func currentSettingsInfo(store *config.Store) (cliSettingsInfo, error) {
	settings, err := store.Settings()
	if err != nil {
		return cliSettingsInfo{}, err
	}
	return cliSettingsInfo{
		AppSettings:  settings,
		DatabasePath: store.Path(),
		DataDir:      config.DataDir(),
		CacheDir:     config.CacheDir(),
	}, nil
}

func cmdSettings(args []string, jsonOut bool) error {
	args, forcedJSON := stripJSONFlag(args)
	jsonOut = jsonOut || forcedJSON
	if len(args) == 0 {
		return cmdSettingsGet(nil, jsonOut)
	}
	switch args[0] {
	case "get":
		return cmdSettingsGet(args[1:], jsonOut)
	case "export":
		return cmdSettingsExport(args[1:], jsonOut)
	case "import":
		return cmdSettingsImport(args[1:], jsonOut)
	case "reset-database":
		return cmdSettingsResetDatabase(args[1:], jsonOut)
	default:
		return apierr.WithParams("settings_subcommand_unknown", "unknown settings subcommand", map[string]any{"subcommand": args[0]})
	}
}

func cmdSettingsGet(args []string, jsonOut bool) error {
	fs := newFlagSet("settings get", jsonOut)
	if err := parseFlagSet(fs, args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return apierr.WithParams("settings_get_unexpected_args", "settings get does not accept positional arguments", map[string]any{"args": fs.Args()})
	}
	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()
	settings, err := currentSettingsInfo(store)
	if err != nil {
		return err
	}
	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "settings": settings})
	}
	fmt.Printf("Workspace: %s\n", settings.WorkspaceName)
	fmt.Printf("Database: %s\n", settings.DatabasePath)
	fmt.Printf("Data dir: %s\n", settings.DataDir)
	fmt.Printf("Cache dir: %s\n", settings.CacheDir)
	return nil
}

func cmdSettingsExport(args []string, jsonOut bool) error {
	fs := newFlagSet("settings export", jsonOut)
	output := fs.String("output", "", "write export JSON to file")
	if err := parseFlagSet(fs, args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return apierr.WithParams("settings_export_unexpected_args", "settings export does not accept positional arguments", map[string]any{"args": fs.Args()})
	}
	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()
	data := store.ExportData()
	if *output != "" {
		file, err := os.Create(*output)
		if err != nil {
			return err
		}
		if err := writeJSON(file, data); err != nil {
			_ = file.Close()
			return err
		}
		if err := file.Close(); err != nil {
			return err
		}
		if jsonOut {
			return writeJSON(os.Stdout, map[string]any{"ok": true, "path": *output, "export": data})
		}
		fmt.Printf("Exported settings: %s\n", *output)
		return nil
	}
	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "export": data})
	}
	return writeJSON(os.Stdout, data)
}

func cmdSettingsImport(args []string, jsonOut bool) error {
	fs := newFlagSet("settings import", jsonOut)
	if err := parseFlagSet(fs, args); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		return apierr.New("settings_import_file_required", "settings import requires exactly one file path")
	}
	bytes, err := os.ReadFile(fs.Arg(0))
	if err != nil {
		return err
	}
	var data config.ExportData
	if err := json.Unmarshal(bytes, &data); err != nil {
		return apierr.New("settings_import_json_invalid", err.Error())
	}
	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()
	if err := store.ImportData(data); err != nil {
		return err
	}
	settings, err := currentSettingsInfo(store)
	if err != nil {
		return err
	}
	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "projects": store.Projects(), "settings": settings})
	}
	fmt.Printf("Imported projects: %d\n", len(store.Projects()))
	return nil
}

func cmdSettingsResetDatabase(args []string, jsonOut bool) error {
	fs := newFlagSet("settings reset-database", jsonOut)
	confirm := fs.String("confirm", "", "confirmation token; must be RESET")
	if err := parseFlagSet(fs, args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return apierr.WithParams("settings_reset_unexpected_args", "settings reset-database does not accept positional arguments", map[string]any{"args": fs.Args()})
	}
	if *confirm != "RESET" {
		return apierr.New("reset_confirmation_required", "reset confirmation is required")
	}
	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()
	if err := store.ResetData(); err != nil {
		return err
	}
	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true})
	}
	fmt.Println("Reset database state.")
	return nil
}
