//go:build windows

package capture

import "testing"

func TestBackstageShouldKillPID(t *testing.T) {
	const currentPID uint32 = 42

	tests := []struct {
		name string
		pid  uint32
		want bool
	}{
		{name: "invalid pid", pid: 0, want: false},
		{name: "agent process", pid: currentPID, want: false},
		{name: "backstage process", pid: 99, want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := backstageShouldKillPID(tt.pid, currentPID); got != tt.want {
				t.Fatalf("backstageShouldKillPID(%d, %d) = %v, want %v", tt.pid, currentPID, got, tt.want)
			}
		})
	}
}
