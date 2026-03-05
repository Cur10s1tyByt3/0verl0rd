//go:build !windows
// +build !windows

package handlers

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func startSilentProcess(command string, args []string, cwd string, _ bool) error {
	ext := strings.ToLower(filepath.Ext(command))

	var cmd *exec.Cmd
	if ext == ".sh" {
		cmd = exec.Command("sh", append([]string{command}, args...)...)
	} else {
		cmd = exec.Command(command, args...)
	}

	if cwd != "" {
		cmd.Dir = cwd
	}

	nullFile, err := os.OpenFile(os.DevNull, os.O_RDWR, 0)
	if err == nil {
		cmd.Stdin = nullFile
		cmd.Stdout = nullFile
		cmd.Stderr = nullFile
	}
	return cmd.Start()
}
