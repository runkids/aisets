package main

import (
	"context"
	"fmt"
	"os"

	"asset-studio/internal/apierr"
	versionpkg "asset-studio/internal/version"
)

func cmdUpdate(args []string, jsonOut bool) error {
	args, forcedJSON := stripJSONFlag(args)
	jsonOut = jsonOut || forcedJSON
	fs := newFlagSet("update", jsonOut)
	dryRun := fs.Bool("dry-run", false, "preview update without replacing the binary")
	force := fs.Bool("force", false, "update even when the current version matches latest")
	if err := parseFlagSet(fs, args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return apierr.WithParams("update_unexpected_args", "update does not accept positional arguments", map[string]any{"args": fs.Args()})
	}
	result, err := versionpkg.Upgrade(context.Background(), versionpkg.UpgradeOptions{
		CurrentVersion: version,
		DryRun:         *dryRun,
		Force:          *force,
	})
	if err != nil {
		return err
	}
	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "update": result})
	}
	if result.DevMode {
		fmt.Fprintf(os.Stderr, "Aisets update simulated in DEV mode: %s -> %s\n", result.CurrentVersion, result.LatestVersion)
		return nil
	}
	if result.DryRun {
		fmt.Fprintf(os.Stderr, "Aisets update available: %s -> %s\n", result.CurrentVersion, result.LatestVersion)
		return nil
	}
	if result.Updated {
		fmt.Fprintf(os.Stderr, "Aisets updated: %s -> %s\n", result.CurrentVersion, result.LatestVersion)
		fmt.Fprintln(os.Stderr, "Restart Aisets to use the new version.")
		return nil
	}
	fmt.Fprintln(os.Stderr, result.Message)
	return nil
}
