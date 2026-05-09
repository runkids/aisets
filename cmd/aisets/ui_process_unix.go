//go:build darwin || linux || freebsd || openbsd || netbsd

package main

import (
	"os/exec"
	"syscall"
)

func detachUICommand(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}
