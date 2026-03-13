//go:build !cgo

package capture

import (
	"errors"
	"image"
)

func encodeH264Frame(_ *image.RGBA) ([]byte, error) {
	return nil, errors.New("h264 support not available (cgo disabled)")
}

func h264Available() bool {
	return false
}

func h264AvailabilityDetail() string {
	return "cgo disabled in this build"
}

func resetH264Encoder() {}

func SetH264TargetFPS(_ int) {}
