//go:build darwin || linux || freebsd || openbsd || netbsd

package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

var runPrivilegedUpdate = func(execPath string, args []string) error {
	sudoPath, err := exec.LookPath("sudo")
	if err != nil {
		return fmt.Errorf("sudo not found, please run: sudo %s", strings.Join(append([]string{execPath}, args...), " "))
	}
	cmd := exec.Command(sudoPath, append([]string{execPath}, args...)...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func reexecUpdateWithPrivileges(execPath string) error {
	return runPrivilegedUpdate(execPath, os.Args[1:])
}
