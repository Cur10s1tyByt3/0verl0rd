//go:build windows

package capture

import "testing"

func TestPrintableKeyText(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "latin", in: "é", want: "é"},
		{name: "cyrillic", in: "ж", want: "ж"},
		{name: "cjk", in: "你", want: "你"},
		{name: "supplementary plane", in: "😀", want: "😀"},
		{name: "named key", in: "Enter", want: ""},
		{name: "control", in: "\n", want: ""},
		{name: "empty", in: "", want: ""},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := printableKeyText(tt.in); got != tt.want {
				t.Fatalf("printableKeyText(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}
