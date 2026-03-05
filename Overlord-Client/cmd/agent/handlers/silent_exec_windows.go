//go:build windows
// +build windows

package handlers

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"
)

func startSilentProcess(command string, args []string, cwd string, hideWindow bool) error {
	ext := strings.ToLower(filepath.Ext(command))

	var cmd *exec.Cmd
	switch ext {
	case ".bat", ".cmd":
		cmd = exec.Command("cmd.exe", append([]string{"/c", command}, args...)...)
	case ".ps1":
		cmd = exec.Command("powershell.exe", append([]string{"-ExecutionPolicy", "Bypass", "-NoProfile", "-File", command}, args...)...)
	default:
		cmd = exec.Command(command, args...)
	}

	if cwd != "" {
		cmd.Dir = cwd
	}

	if hideWindow {
		attr := &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
		nullFile, err := os.OpenFile(os.DevNull, os.O_RDWR, 0)
		if err == nil {
			cmd.Stdin = nullFile
			cmd.Stdout = nullFile
			cmd.Stderr = nullFile
		}

		cmd.SysProcAttr = attr
		return cmd.Start()
	}

	switch ext {
	case ".ps1":
		psArgs := append([]string{"-ExecutionPolicy", "Bypass", "-NoProfile", "-File", command}, args...)
		cmd = exec.Command("cmd.exe", append([]string{"/c", "start", "", "powershell.exe"}, psArgs...)...)
	case ".bat", ".cmd":
		cmd = exec.Command("cmd.exe", append([]string{"/c", "start", "", "cmd.exe", "/c", command}, args...)...)
	default:
		cmd = exec.Command("cmd.exe", append([]string{"/c", "start", "", command}, args...)...)
	}
	if cwd != "" {
		cmd.Dir = cwd
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: false}
	return cmd.Start()
}
