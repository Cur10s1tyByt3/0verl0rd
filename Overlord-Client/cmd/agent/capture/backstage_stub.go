//go:build !windows

package capture

import (
	"errors"
	"image"
)

func InitializebackstageDesktop() error {
	return errors.New("backstage not supported on this platform")
}

func CleanupbackstageDesktop() {}

func SetbackstageCursorCapture(enabled bool) {}

func SetbackstageDXGIEnabled(enabled bool) {}

func GetbackstageDXGIEnabled() bool { return false }

func SetbackstageUIAEnabled(enabled bool) {}

func GetbackstageUIAEnabled() bool { return false }

func BackstageCaptureDisplay(display int) (*image.RGBA, error) {
	return nil, errors.New("backstage not supported on this platform")
}

func BackstageMonitorCount() int {
	return 0
}

func StartbackstageProcess(filePath string, operaPatch bool, display int) error {
	return errors.New("backstage not supported on this platform")
}

func BackstageInputMouseMove(display int, x, y int32) error {
	return errors.New("backstage not supported on this platform")
}

func BackstageInputMouseDown(button int) error {
	return errors.New("backstage not supported on this platform")
}

func BackstageInputMouseUp(button int) error {
	return errors.New("backstage not supported on this platform")
}

func BackstageInputKeyDown(vk uint16, text string) error {
	return errors.New("backstage not supported on this platform")
}

func BackstageInputKeyUp(vk uint16) error {
	return errors.New("backstage not supported on this platform")
}

func BackstageInputMouseWheel(delta int32) error {
	return errors.New("backstage not supported on this platform")
}

func BackstageAutoStartExplorer() error {
	return errors.New("backstage not supported on this platform")
}

func BackstageKillAll() error {
	return errors.New("backstage not supported on this platform")
}

type BackstageWindowInfo struct {
	HWND        uintptr
	Title       string
	X           int
	Y           int
	Width       int
	Height      int
	PID         uint32
	ProcessName string
	Monitor     int
	Visible     bool
}

type BackstageMonitorInfo struct {
	Index   int
	Name    string
	X       int
	Y       int
	Width   int
	Height  int
	Primary bool
}

func BackstageEnumWindows() ([]BackstageWindowInfo, []BackstageMonitorInfo) {
	return nil, nil
}
