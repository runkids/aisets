//go:build windows

package main

import "fmt"

func reexecUpdateWithPrivileges(_ string) error {
	return fmt.Errorf("elevated update is not supported on Windows; run aisets update from an elevated terminal")
}
