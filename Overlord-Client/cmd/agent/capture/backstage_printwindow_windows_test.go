//go:build windows

package capture

import "testing"

func TestBackstagePrintWindowFallbackToggle(t *testing.T) {
	SetbackstagePrintWindowFallbackEnabled(true)
	t.Cleanup(func() { SetbackstagePrintWindowFallbackEnabled(true) })

	if !GetbackstagePrintWindowFallbackEnabled() {
		t.Fatal("PrintWindow fallback must be enabled by default")
	}
	SetbackstagePrintWindowFallbackEnabled(false)
	if GetbackstagePrintWindowFallbackEnabled() {
		t.Fatal("PrintWindow fallback did not disable")
	}
	SetbackstagePrintWindowFallbackEnabled(true)
	if !GetbackstagePrintWindowFallbackEnabled() {
		t.Fatal("PrintWindow fallback did not re-enable")
	}
}
