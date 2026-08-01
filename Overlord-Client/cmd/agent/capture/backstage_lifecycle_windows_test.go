//go:build windows

package capture

import "testing"

func TestBackstageDesktopCanRestartAfterCleanup(t *testing.T) {
	t.Cleanup(CleanupbackstageDesktop)
	for cycle := 1; cycle <= 2; cycle++ {
		if err := InitializebackstageDesktop(); err != nil {
			t.Fatalf("cycle %d initialize: %v", cycle, err)
		}
		if err := ensurebackstageThread(); err != nil {
			t.Fatalf("cycle %d worker: %v", cycle, err)
		}
		img, err := BackstageCaptureDisplay(0)
		if err != nil {
			t.Fatalf("cycle %d capture: %v", cycle, err)
		}
		if img == nil {
			t.Fatalf("cycle %d capture returned no image", cycle)
		}
		CleanupbackstageDesktop()
	}
}
