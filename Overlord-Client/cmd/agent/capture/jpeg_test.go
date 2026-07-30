package capture

import (
	"testing"
)

func TestJPEGEncoderQualityCurve(t *testing.T) {
	tests := []struct {
		input int
		want  int
	}{
		{input: -1, want: 1},
		{input: 20, want: 36},
		{input: 50, want: 75},
		{input: 80, want: 96},
		{input: 90, want: 99},
		{input: 100, want: 100},
		{input: 101, want: 100},
	}
	for _, tt := range tests {
		if got := jpegEncoderQuality(tt.input); got != tt.want {
			t.Errorf("jpegEncoderQuality(%d) = %d, want %d", tt.input, got, tt.want)
		}
	}
}
