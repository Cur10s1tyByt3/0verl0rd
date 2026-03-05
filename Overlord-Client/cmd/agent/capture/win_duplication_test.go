//go:build windows

package capture

import (
	"image"
	"testing"
)

func TestDesktopDuplicationToggleResetsState(t *testing.T) {
	dxgiState.mu.Lock()
	dxgiState.display = 0
	dxgiState.outputName = "test-output"
	dxgiState.bounds = image.Rect(1, 2, 3, 4)
	dxgiState.mu.Unlock()

	SetDesktopDuplication(true)
	if !useDesktopDuplication() {
		t.Fatalf("expected desktop duplication to be enabled")
	}

	dxgiState.mu.Lock()
	if dxgiState.display != -1 {
		dxgiState.mu.Unlock()
		t.Fatalf("expected display reset to -1, got %d", dxgiState.display)
	}
	if dxgiState.outputName != "" {
		dxgiState.mu.Unlock()
		t.Fatalf("expected outputName reset, got %q", dxgiState.outputName)
	}
	if dxgiState.bounds != (image.Rectangle{}) {
		dxgiState.mu.Unlock()
		t.Fatalf("expected bounds reset, got %+v", dxgiState.bounds)
	}
	dxgiState.mu.Unlock()

	SetDesktopDuplication(false)
	if useDesktopDuplication() {
		t.Fatalf("expected desktop duplication to be disabled")
	}
}

func TestCaptureDisplayDXGI(t *testing.T) {
	if displayCount() == 0 {
		t.Skip("no displays detected")
	}

	SetDesktopDuplication(true)
	t.Cleanup(func() { SetDesktopDuplication(false) })

	img, err := captureDisplayDXGI(0)
	if err != nil {
		t.Fatalf("dxgi capture failed: %v", err)
	}
	if img == nil {
		t.Fatalf("dxgi capture returned nil image")
	}
	bounds := img.Bounds()
	if bounds.Dx() <= 0 || bounds.Dy() <= 0 {
		t.Fatalf("invalid capture bounds: %dx%d", bounds.Dx(), bounds.Dy())
	}
}
