//go:build !windows

package mutex

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

func Acquire(name string) (func(), bool, error) {
	if name == "" {
		return func() {}, true, nil
	}

	sanitized, err := sanitizeName(name)
	if err != nil {
		return nil, false, err
	}

	lockPath := filepath.Join(os.TempDir(), fmt.Sprintf("overlord-%s.lock", sanitized))
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return nil, false, fmt.Errorf("open mutex file: %w", err)
	}

	if err := unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		_ = file.Close()
		if errors.Is(err, unix.EWOULDBLOCK) {
			return func() {}, false, nil
		}
		return nil, false, fmt.Errorf("lock mutex file: %w", err)
	}

	release := func() {
		_ = unix.Flock(int(file.Fd()), unix.LOCK_UN)
		_ = file.Close()
	}

	return release, true, nil
}
