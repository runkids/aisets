package main

import (
	"context"
	"fmt"
	"os"

	"asset-studio/internal/apierr"
	"asset-studio/internal/config"
	"asset-studio/internal/optimize"
)

func cmdOptimize(args []string, jsonOut bool) error {
	args, forcedJSON := stripJSONFlag(args)
	jsonOut = jsonOut || forcedJSON
	if len(args) == 0 {
		return apierr.New("optimize_subcommand_required", "optimize subcommand is required")
	}
	switch args[0] {
	case "estimate":
		return cmdOptimizeEstimate(args[1:], jsonOut)
	case "script", "generate-script":
		return cmdOptimizeScript(args[1:], jsonOut)
	default:
		return apierr.WithParams("optimize_subcommand_unknown", "unknown optimize subcommand", map[string]any{"subcommand": args[0]})
	}
}

func cmdOptimizeEstimate(args []string, jsonOut bool) error {
	fs := newFlagSet("optimize estimate", jsonOut)
	if err := parseFlagSet(fs, args); err != nil {
		return err
	}
	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()
	items, err := selectedOptimizationItems(context.Background(), store, fs.Args())
	if err != nil {
		return err
	}
	estimate := optimize.Compute(items)
	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "estimate": estimate})
	}
	fmt.Printf("Optimizable assets: %d\n", estimate.ItemCount)
	fmt.Printf("Total bytes: %d\n", estimate.TotalBytes)
	fmt.Printf("Estimated savings: %d\n", estimate.SavingsBytes)
	return nil
}

func cmdOptimizeScript(args []string, jsonOut bool) error {
	fs := newFlagSet("optimize script", jsonOut)
	if err := parseFlagSet(fs, args); err != nil {
		return err
	}
	store, err := config.OpenStore()
	if err != nil {
		return err
	}
	defer store.Close()
	items, err := selectedOptimizationItems(context.Background(), store, fs.Args())
	if err != nil {
		return err
	}
	script := optimize.GenerateScript(items)
	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "format": "bash", "script": script, "itemCount": len(items)})
	}
	fmt.Print(script)
	return nil
}
