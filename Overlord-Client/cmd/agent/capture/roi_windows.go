//go:build windows

package capture

import (
	"image"
	"unsafe"
)

var (
	procGetForegroundWindowROI = user32.NewProc("GetForegroundWindow")
	procGetWindowRectROI       = user32.NewProc("GetWindowRect")
)

type winRect struct {
	left   int32
	top    int32
	right  int32
	bottom int32
}

func cursorROI() (image.Rectangle, bool) {
	x, y, visible := getCursorPosition()
	if !visible {
		return image.Rectangle{}, false
	}
	const cursorBox = 48
	half := cursorBox / 2
	r := image.Rect(int(x)-half, int(y)-half, int(x)+half, int(y)+half)
	if r.Dx() <= 0 || r.Dy() <= 0 {
		return image.Rectangle{}, false
	}
	return r, true
}

func focusWindowROI() (image.Rectangle, bool) {
	hwnd, _, _ := procGetForegroundWindowROI.Call()
	if hwnd == 0 {
		return image.Rectangle{}, false
	}
	var wr winRect
	ret, _, _ := procGetWindowRectROI.Call(hwnd, uintptr(unsafe.Pointer(&wr)))
	if ret == 0 {
		return image.Rectangle{}, false
	}
	r := image.Rect(int(wr.left), int(wr.top), int(wr.right), int(wr.bottom))
	if r.Dx() <= 0 || r.Dy() <= 0 {
		return image.Rectangle{}, false
	}
	return r, true
}
