//go:build !windows

package capture

import "image"

func CaptureDisplayRGBABitBlt(display int) (*image.RGBA, error) {
	return CaptureDisplayRGBA(display)
}

func CaptureDisplayRGBAPreferBitBlt(display int) (*image.RGBA, error) {
	return CaptureDisplayRGBA(display)
}

func CaptureDisplayRGBAThumbnail(display, _ int) (*image.RGBA, error) {
	return CaptureDisplayRGBA(display)
}

func CleanupThumbnailCapture() {}
