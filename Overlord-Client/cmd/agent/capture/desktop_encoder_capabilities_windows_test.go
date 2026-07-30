package capture

import "testing"

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
