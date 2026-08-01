//go:build windows

package capture

import "image"

func CaptureDisplayRGBABitBlt(display int) (*image.RGBA, error) {
	return captureDisplayBitBlt(display)
}

func CaptureDisplayRGBAPreferBitBlt(display int) (*image.RGBA, error) {
	img, err := captureDisplayBitBlt(display)
	if err == nil && img != nil {
		return img, nil
	}
	return CaptureDisplayRGBA(display)
}

func CaptureDisplayRGBAThumbnail(display, maxHeight int) (*image.RGBA, error) {
	return captureDisplayThumbnailBitBlt(display, maxHeight)
}

func CleanupThumbnailCapture() {
	thumbnailMu.Lock()
	thumbnailState.reset()
	thumbnailMu.Unlock()
}
