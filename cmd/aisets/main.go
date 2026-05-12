package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"aisets/internal/apierr"
)

var version = "dev"

func main() {
	if code := run(os.Args[1:]); code != 0 {
		os.Exit(code)
	}
}

func run(rawArgs []string) int {
	args, jsonOut := stripJSONFlag(rawArgs)
	if len(args) == 0 {
		if jsonOut {
			writeCLIError("command", apierr.New("command_required", "command is required"), true)
			return 2
		}
		printUsage()
		return 0
	}

	var err error
	switch args[0] {
	case "ui":
		err = cmdUI(args[1:], jsonOut)
	case "version":
		err = cmdVersion(args[1:], jsonOut)
	case "projects":
		err = cmdProjects(args[1:], jsonOut)
	case "settings":
		err = cmdSettings(args[1:], jsonOut)
	case "update", "upgrade":
		err = cmdUpdate(args[1:], jsonOut)
	case "scan":
		err = cmdScan(args[1:], jsonOut)
	case "catalog":
		err = cmdCatalog(args[1:], jsonOut)
	case "scans":
		err = cmdScans(args[1:], jsonOut)
	case "optimize":
		err = cmdOptimize(args[1:], jsonOut)
	case "pre-check":
		err = cmdPreCheck(args[1:], jsonOut)
	case "actions":
		err = cmdActions(args[1:], jsonOut)
	case "help", "-h", "--help":
		if jsonOut {
			_ = writeJSON(os.Stdout, map[string]any{"ok": true, "usage": usageText()})
		} else {
			printUsage()
		}
		return 0
	default:
		err = apierr.WithParams("unknown_command", "unknown command", map[string]any{"command": args[0]})
		if jsonOut {
			writeCLIError("command", err, true)
		} else {
			fmt.Fprintf(os.Stderr, "unknown command: %s\n", args[0])
			printUsage()
		}
		return 2
	}
	if err != nil {
		writeCLIError(args[0], err, jsonOut)
		return 1
	}
	return 0
}

func usageText() string {
	return `Usage:
  aisets ui [projectPaths...] [--host HOST] [--port PORT] [--base-path PATH] [--app] [--no-open]
  aisets ui once [projectPaths...] [--host HOST] [--port PORT] [--base-path PATH] [--no-open]
  aisets ui stop [--host HOST] [--port PORT]
  aisets projects [--json]
  aisets projects add [projectPaths...] [--json]
  aisets projects rename --id ID --name NAME [--json]
  aisets projects remove --id ID [--json]
  aisets settings get [--json]
  aisets settings export [--output file.json] [--json]
  aisets settings import file.json [--json]
  aisets settings reset-database --confirm RESET [--json]
  aisets update [--dry-run] [--force] [--json]
  aisets scan [projectPaths...] [--json]
  aisets catalog items [--limit N] [--cursor C] [--project-id ID] [--q TEXT] [--status STATUS] [--sort SORT] [--json]
  aisets catalog item --id ID [--json]
  aisets catalog search QUERY [--semantic] [--type hybrid] [--project-id ID] [--ext EXT] [--json]
  aisets scans list [--json]
  aisets scans diff --base ID --target ID [--json]
  aisets optimize estimate [assetIds...] [--json]
  aisets optimize script [assetIds...] [--json]
  aisets pre-check [filePaths...] [--json]
  aisets actions rename preview --asset-id ID --target-path PATH [--json]
  aisets actions merge-duplicates preview --asset-id ID --preferred-path PATH [--json]
  aisets actions delete-unused preview --asset-id ID [--json]
  aisets actions apply --preview preview.json [--json]
  aisets version [--json]

Commands:
  ui         Start or reuse the localhost UI in the background
  projects   List, add, rename, or remove imported projects
  settings   Inspect, export, import, or reset local state
  update     Update the Aisets CLI binary
  scan       Scan projects and print catalog summary or JSON
  catalog    Query the latest scan catalog
  scans      List scan history or compare completed scans
  optimize   Estimate recommendations or generate a review script
  pre-check  Analyze files before adding them to a project
  actions    Preview or apply safe file mutations
  version    Print version

UI:
  aisets ui starts a background server and opens a browser.
  aisets ui once runs the same server in the foreground.
  aisets ui stop stops a background UI server for the selected port.
  --app opens a desktop-style app window when the browser supports it.
  --port defaults to 19520. --base-path supports reverse proxy hosting.`
}

func printUsage() {
	fmt.Fprintln(os.Stderr, usageText())
}

func cmdVersion(args []string, jsonOut bool) error {
	args, forcedJSON := stripJSONFlag(args)
	jsonOut = jsonOut || forcedJSON
	fs := newFlagSet("version", jsonOut)
	if err := parseFlagSet(fs, args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return apierr.WithParams("version_unexpected_args", "version does not accept positional arguments", map[string]any{"args": fs.Args()})
	}
	if jsonOut {
		return writeJSON(os.Stdout, map[string]any{"ok": true, "version": version})
	}
	fmt.Println(version)
	return nil
}

func writeCLIError(command string, err error, jsonOut bool) {
	if jsonOut {
		_ = writeJSON(os.Stdout, map[string]any{
			"ok":    false,
			"error": apierr.From(err, command+"_failed"),
		})
	} else {
		fmt.Fprintf(os.Stderr, "aisets %s: %v\n", command, err)
	}
}

func exitWithError(command string, err error, jsonOut bool) {
	writeCLIError(command, err, jsonOut)
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

func writeJSON(w io.Writer, value any) error {
	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}
