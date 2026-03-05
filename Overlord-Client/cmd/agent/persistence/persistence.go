package persistence

import (
	"os"
	"path/filepath"
)

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
