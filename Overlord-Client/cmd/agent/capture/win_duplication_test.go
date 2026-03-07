//go:build windows

package capture

import (
	"image"
	"os"
	"strings"
	"testing"
	"time"
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

	var (
		img *image.RGBA
		err error
	)
	for attempt := 0; attempt < 4; attempt++ {
		img, err = captureDisplayDXGI(0)
		if err == nil {
			break
		}

		msg := strings.ToLower(err.Error())
		if strings.Contains(msg, "dxgi: frame timeout") || strings.Contains(msg, "dxgi: access lost") {
			time.Sleep(60 * time.Millisecond)
			continue
		}
		break
	}

	if err != nil {
		msg := strings.ToLower(err.Error())
		if os.Getenv("GITHUB_ACTIONS") == "true" &&
			(strings.Contains(msg, "dxgi: frame timeout") || strings.Contains(msg, "dxgi: access lost")) {
			t.Skipf("skipping unstable DXGI capture on CI runner: %v", err)
		}
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
