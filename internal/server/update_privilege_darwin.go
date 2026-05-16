//go:build darwin

package server

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

func defaultRunElevatedUpdate(execPath string) error {
	command := shellQuoteArgs(execPath, "update", "--force")
	script := fmt.Sprintf("do shell script %s with administrator privileges", strconv.Quote(command))
	output, err := exec.Command("osascript", "-e", script).CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			return err
		}
		return fmt.Errorf("%w: %s", err, message)
	}
	return nil
}

func shellQuoteArgs(args ...string) string {
	quoted := make([]string, 0, len(args))
	for _, arg := range args {
		quoted = append(quoted, "'"+strings.ReplaceAll(arg, "'", "'\\''")+"'")
	}
	return strings.Join(quoted, " ")
}
