package capture

import (
	"testing"
	"time"
)

func TestConfiguredVideoKeyframeInterval(t *testing.T) {
	tests := []struct {
		value string
		want  time.Duration
	}{
		{value: "", want: 0},
		{value: "off", want: 0},
		{value: "0", want: 0},
		{value: "30", want: 30 * time.Second},
		{value: "2m", want: 2 * time.Minute},
		{value: "invalid", want: 0},
	}

	for _, test := range tests {
		t.Run(test.value, func(t *testing.T) {
			t.Setenv("OVERLORD_VIDEO_KEYFRAME_INTERVAL", test.value)
			if got := configuredVideoKeyframeInterval(); got != test.want {
				t.Fatalf("configuredVideoKeyframeInterval() = %s, want %s", got, test.want)
			}
		})
	}
}
