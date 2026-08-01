package capture

import (
	"context"
	"image"
	"testing"
)

func TestDesktopProfileFPSCeiling(t *testing.T) {
	tests := []struct {
		height int
		want   int
	}{
		{height: 720, want: 240},
		{height: 1080, want: 240},
		{height: 1440, want: 120},
		{height: 2160, want: 60},
		{height: 4320, want: 60},
	}
	for _, test := range tests {
		if got := desktopProfileFPSCeiling(test.height); got != test.want {
			t.Fatalf("height %d: expected ceiling %d, got %d", test.height, test.want, got)
		}
	}
}

func TestDesktopEncoderCapabilityProbeHonorsPreCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	caps := probeDesktopEncoderCapabilities(ctx, 0, image.Rect(0, 0, 3840, 2160))
	if caps.Probed {
		t.Fatal("cancelled probe reported itself as completed")
	}
	if len(caps.Profiles) == 0 {
		t.Fatal("cancelled probe did not return safe fallback profiles")
	}
	if caps.Detail != "Hardware encoder capability probing was cancelled." {
		t.Fatalf("unexpected cancellation detail %q", caps.Detail)
	}
}
