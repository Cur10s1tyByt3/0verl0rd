package persistence

import (
	"os"
	"path/filepath"
)

var DefaultPersistenceMethod = "startup"

var persistInstallFn func(targetPath string) error = func(_ string) error { return nil }

var persistUninstallFns []func() error

func Setup() error {
	exePath, err := os.Executable()
	if err != nil {
		return err
	}
	exePath, err = filepath.Abs(exePath)
	if err != nil {
		return err
	}
	return install(exePath)
}

func InstallFrom(exePath string) error {
	return install(exePath)
}

func Configure(exePath string) error {
	return configure(exePath)
}

func TargetPath() (string, error) {
	return getTargetPath()
}

func Remove() error {
	return uninstall()
}
