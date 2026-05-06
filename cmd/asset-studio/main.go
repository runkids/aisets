package main

import (
	"encoding/json"
	"fmt"
	"os"
)

var version = "dev"

func main() {
	args := os.Args[1:]
	if len(args) == 0 {
		printUsage()
		return
	}

	switch args[0] {
	case "ui":
		if err := cmdUI(args[1:]); err != nil {
			fmt.Fprintf(os.Stderr, "asset-studio ui: %v\n", err)
			os.Exit(1)
		}
	case "version":
		if err := cmdVersion(args[1:]); err != nil {
			exitWithError("version", err, wantsJSON(args[1:]))
		}
	case "projects":
		if err := cmdProjects(args[1:]); err != nil {
			exitWithError("projects", err, wantsJSON(args[1:]))
		}
	case "scan":
		if err := cmdScan(args[1:]); err != nil {
			exitWithError("scan", err, wantsJSON(args[1:]))
		}
	case "help", "-h", "--help":
		printUsage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", args[0])
		printUsage()
		os.Exit(2)
	}
}

func printUsage() {
	fmt.Fprintln(os.Stderr, `Usage:
  asset-studio ui [projectPaths...] [flags]
  asset-studio projects [--json]
  asset-studio projects add [projectPaths...] [--json]
  asset-studio scan [projectPaths...] [--json]
  asset-studio version [--json]

Commands:
  ui        Start the localhost UI
  projects  List or add imported projects
  scan      Scan projects and print catalog summary or JSON
  version   Print version`)
}

func cmdVersion(args []string) error {
	jsonOut := wantsJSON(args)
	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "version": version})
	}
	fmt.Println(version)
	return nil
}

func exitWithError(command string, err error, jsonOut bool) {
	if jsonOut {
		_ = writeJSON(os.Stdout, map[string]any{
			"ok": false,
			"error": map[string]any{
				"code":    command + "_failed",
				"message": err.Error(),
			},
		})
	} else {
		fmt.Fprintf(os.Stderr, "asset-studio %s: %v\n", command, err)
	}
	os.Exit(1)
}

func wantsJSON(args []string) bool {
	for _, arg := range args {
		if arg == "--json" {
			return true
		}
	}
	return false
}

func writeJSON(file *os.File, value any) error {
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}
