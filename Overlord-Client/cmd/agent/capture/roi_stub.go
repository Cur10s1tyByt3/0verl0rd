//go:build !windows

package capture

import "image"

func cursorROI() (image.Rectangle, bool) {
	return image.Rectangle{}, false
}

func focusWindowROI() (image.Rectangle, bool) {
	return image.Rectangle{}, false
}
