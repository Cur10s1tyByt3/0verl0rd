//go:build !windows

package capture

import (
	"time"

	"overlord-client/cmd/agent/wire"
)

func directDesktopVideoEnabled() bool {
	return false
}

func tryBuildDirectH264Frame(_ int) (wire.Frame, time.Duration, time.Duration, bool, error) {
	return wire.Frame{}, 0, 0, false, nil
}
