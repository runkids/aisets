//go:build !darwin && !linux && !freebsd && !openbsd && !netbsd && !windows

package main

import "os/exec"

func detachUICommand(_ *exec.Cmd) {}

func normalizeProcessUmask() {}
