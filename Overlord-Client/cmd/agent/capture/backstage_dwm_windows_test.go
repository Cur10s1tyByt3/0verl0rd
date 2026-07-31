//go:build windows

package capture

import (
	"image"
	"testing"
)

func TestBackstageDWMFrameHasContent(t *testing.T) {
	tests := []struct {
		name  string
		frame []byte
		want  bool
	}{
		{name: "nil", frame: nil, want: false},
		{name: "short", frame: []byte{1, 2, 3}, want: false},
		{name: "black", frame: make([]byte, 64), want: false},
		{name: "alpha only", frame: []byte{0, 0, 0, 255}, want: false},
		{name: "blue", frame: []byte{1, 0, 0, 0}, want: true},
		{name: "green", frame: []byte{0, 1, 0, 0}, want: true},
		{name: "red", frame: []byte{0, 0, 1, 0}, want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := backstageDWMFrameHasContent(tt.frame); got != tt.want {
				t.Fatalf("backstageDWMFrameHasContent() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestBackstageDWMThumbnailRects(t *testing.T) {
	tests := []struct {
		name       string
		window     rect
		bounds     image.Rectangle
		sourceW    int
		sourceH    int
		outputW    int
		outputH    int
		wantDest   rect
		wantSource rect
		wantOK     bool
	}{
		{
			name:       "fully visible",
			window:     rect{left: 100, top: 50, right: 500, bottom: 350},
			bounds:     image.Rect(0, 0, 1920, 1080),
			sourceW:    400,
			sourceH:    300,
			outputW:    1920,
			outputH:    1080,
			wantDest:   rect{left: 100, top: 50, right: 500, bottom: 350},
			wantSource: rect{left: 0, top: 0, right: 400, bottom: 300},
			wantOK:     true,
		},
		{
			name:       "clipped left and top",
			window:     rect{left: -100, top: -50, right: 300, bottom: 250},
			bounds:     image.Rect(0, 0, 1920, 1080),
			sourceW:    800,
			sourceH:    600,
			outputW:    1920,
			outputH:    1080,
			wantDest:   rect{left: 0, top: 0, right: 300, bottom: 250},
			wantSource: rect{left: 200, top: 100, right: 800, bottom: 600},
			wantOK:     true,
		},
		{
			name:    "outside",
			window:  rect{left: 2000, top: 100, right: 2200, bottom: 300},
			bounds:  image.Rect(0, 0, 1920, 1080),
			sourceW: 200,
			sourceH: 200,
			outputW: 1920,
			outputH: 1080,
			wantOK:  false,
		},
		{
			name:       "scaled output",
			window:     rect{left: 100, top: 50, right: 500, bottom: 350},
			bounds:     image.Rect(0, 0, 1920, 1080),
			sourceW:    400,
			sourceH:    300,
			outputW:    960,
			outputH:    540,
			wantDest:   rect{left: 50, top: 25, right: 250, bottom: 175},
			wantSource: rect{left: 0, top: 0, right: 400, bottom: 300},
			wantOK:     true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dest, source, ok := backstageDWMThumbnailRects(
				tt.window,
				tt.bounds,
				tt.sourceW,
				tt.sourceH,
				tt.outputW,
				tt.outputH,
			)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if dest != tt.wantDest {
				t.Fatalf("destination = %+v, want %+v", dest, tt.wantDest)
			}
			if source != tt.wantSource {
				t.Fatalf("source = %+v, want %+v", source, tt.wantSource)
			}
		})
	}
}

func TestBackstageDWMOrdersEqual(t *testing.T) {
	if !backstageDWMOrdersEqual([]uintptr{1, 2, 3}, []uintptr{1, 2, 3}) {
		t.Fatal("matching order was reported as changed")
	}
	if backstageDWMOrdersEqual([]uintptr{1, 2, 3}, []uintptr{1, 3, 2}) {
		t.Fatal("z-order change was not detected")
	}
	if backstageDWMOrdersEqual([]uintptr{1, 2}, []uintptr{1, 2, 3}) {
		t.Fatal("window addition was not detected")
	}
}
