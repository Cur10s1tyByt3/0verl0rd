//go:build windows

package mutex

import (
	"fmt"

	"golang.org/x/sys/windows"
)

func Acquire(name string) (func(), bool, error) {
	if name == "" {
		return func() {}, true, nil
	}

	sanitized, err := sanitizeName(name)
	if err != nil {
		return nil, false, err
	}

	fullName := "Global\\Overlord-" + sanitized
	handle, err := windows.CreateMutex(nil, false, windows.StringToUTF16Ptr(fullName))
	if err != nil {
		return nil, false, fmt.Errorf("create mutex: %w", err)
	}

	if windows.GetLastError() == windows.ERROR_ALREADY_EXISTS {
		windows.CloseHandle(handle)
		return func() {}, false, nil
	}

	release := func() {
		_ = windows.ReleaseMutex(handle)
		_ = windows.CloseHandle(handle)
	}

	return release, true, nil
}
