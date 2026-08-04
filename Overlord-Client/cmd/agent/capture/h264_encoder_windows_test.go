//go:build windows

package capture

import "testing"

func TestMFTCanAllocateOutputSample(t *testing.T) {
	tests := []struct {
		name  string
		flags uint32
		want  bool
	}{
		{name: "caller must allocate", flags: 0, want: false},
		{name: "transform provides samples", flags: mftOutputStreamProvidesSamples, want: true},
		{name: "transform can provide samples", flags: mftOutputStreamCanProvideSamples, want: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := mftCanAllocateOutputSample(test.flags); got != test.want {
				t.Fatalf("mftCanAllocateOutputSample(0x%x) = %t, want %t", test.flags, got, test.want)
			}
		})
	}
}
