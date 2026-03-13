//go:build cgo

package capture

import (
	"bytes"
	"fmt"
	"image"
	"sync"
	"sync/atomic"

	x264 "github.com/gen2brain/x264-go"
)

var (
	h264Mu        sync.Mutex
	h264Enc       *x264.Encoder
	h264Buf       bytes.Buffer
	h264Width     int
	h264Height    int
	h264FPS       int
	h264LastErr   error
	h264Scratch   []byte
	h264TargetFPS atomic.Int64 // set by the stream handler; default 60
)

func encodeH264Frame(img *image.RGBA) ([]byte, error) {
	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	h264Mu.Lock()
	defer h264Mu.Unlock()

	if err := ensureH264EncoderLocked(width, height); err != nil {
		h264LastErr = err
		return nil, err
	}

	h264Buf.Reset()
	if err := h264Enc.Encode(img); err != nil {
		h264LastErr = err
		return nil, err
	}
	h264LastErr = nil

	n := h264Buf.Len()
	if n == 0 {
		return nil, nil
	}
	if cap(h264Scratch) < n {
		h264Scratch = make([]byte, n, n+(n/4))
	} else {
		h264Scratch = h264Scratch[:n]
	}
	copy(h264Scratch, h264Buf.Bytes())
	return h264Scratch, nil
}

func h264Available() bool {
	return true
}

func h264AvailabilityDetail() string {
	h264Mu.Lock()
	defer h264Mu.Unlock()
	if h264LastErr != nil {
		return fmt.Sprintf("x264 runtime error: %v", h264LastErr)
	}
	return "cgo build with x264-go"
}

// SetH264TargetFPS sets the frame rate hint for the x264 encoder so its
// rate-control matches the actual capture cadence. Call this before (or
// when) streaming starts. The encoder is automatically re-created on the
// next frame if the value differs from the current one.
func SetH264TargetFPS(fps int) {
	if fps < 1 {
		fps = 1
	}
	h264TargetFPS.Store(int64(fps))
}

func activeH264FPS() int {
	if v := int(h264TargetFPS.Load()); v > 0 {
		return v
	}
	return 60 // sensible default for desktop streaming
}

func ensureH264EncoderLocked(width, height int) error {
	fps := activeH264FPS()
	if h264Enc != nil && h264Width == width && h264Height == height && h264FPS == fps {
		return nil
	}

	closeH264EncoderLocked()

	opts := &x264.Options{
		Width:        width,
		Height:       height,
		FrameRate:    fps,
		Tune:         "zerolatency",
		Preset:       "veryfast",
		Profile:      "main",
		RateControl:  "crf",
		RateConstant: 23,
		LogLevel:     x264.LogError,
	}

	enc, err := x264.NewEncoder(&h264Buf, opts)
	if err != nil {
		return err
	}

	h264Enc = enc
	h264Width = width
	h264Height = height
	h264FPS = fps
	return nil
}

func resetH264Encoder() {
	h264Mu.Lock()
	defer h264Mu.Unlock()
	closeH264EncoderLocked()
}

func closeH264EncoderLocked() {
	if h264Enc != nil {
		_ = h264Enc.Close()
		h264Enc = nil
	}
	h264Width = 0
	h264Height = 0
	h264FPS = 0
	h264Buf.Reset()
}
