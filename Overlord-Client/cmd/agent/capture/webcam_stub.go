//go:build !windows

package capture

import (
	"context"
	"errors"

	rt "overlord-client/cmd/agent/runtime"
)

func NowWebcam(_ context.Context, _ *rt.Env) error {
	return errors.New("webcam capture is only supported on Windows")
}

func CleanupWebcam() {
}
