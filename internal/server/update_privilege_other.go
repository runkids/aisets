//go:build !darwin

package server

import "fmt"

func defaultRunElevatedUpdate(execPath string) error {
	return fmt.Errorf("web update cannot request elevated permissions for %s on this platform", execPath)
}
