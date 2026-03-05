//go:build windows

package capture

func ResetDesktopCapture() {
	// Prevent freeing the DIB section while a BitBlt capture is in progress.
	captureMu.Lock()
	defer captureMu.Unlock()
	state.reset()
	dxgiState.reset()
}
