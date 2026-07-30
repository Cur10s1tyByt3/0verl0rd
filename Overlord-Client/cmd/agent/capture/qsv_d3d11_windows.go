//go:build windows && cgo && !no_qsv

package capture

import (
	"fmt"
	"overlord-client/cmd/agent/capture/qsvbridge"
	"sync/atomic"
	"unsafe"
)

type qsvD3D11TextureBackend struct {
	encoder                                                 *qsvbridge.Encoder
	device                                                  unsafe.Pointer
	inputWidth, inputHeight, encodeWidth, encodeHeight, fps int
	dxgiFormat                                              uint32
	output                                                  []byte
	forceIDR                                                atomic.Bool
}

func newQSVD3D11TextureBackend() h264D3D11TextureBackend {
	return &qsvD3D11TextureBackend{output: make([]byte, 1024*1024)}
}

func (b *qsvD3D11TextureBackend) Name() string { return "Intel Quick Sync (oneVPL)" }

func (b *qsvD3D11TextureBackend) matches(req h264D3D11TextureRequest) bool {
	return b.encoder != nil && b.device == req.Device && b.inputWidth == req.InputWidth &&
		b.inputHeight == req.InputHeight && b.encodeWidth == req.EncodeWidth &&
		b.encodeHeight == req.EncodeHeight && b.fps == req.FPS && b.dxgiFormat == req.DXGIFormat
}

func (b *qsvD3D11TextureBackend) Encode(req h264D3D11TextureRequest) ([]byte, error) {
	if !b.matches(req) {
		b.Reset()
		encoder, err := qsvbridge.Create(req.Device, req.InputWidth, req.InputHeight, req.EncodeWidth,
			req.EncodeHeight, req.FPS, req.DXGIFormat, targetH264Bitrate(req.EncodeWidth, req.EncodeHeight, req.FPS))
		if err != nil {
			return nil, err
		}
		b.encoder = encoder
		b.device, b.inputWidth, b.inputHeight = req.Device, req.InputWidth, req.InputHeight
		b.encodeWidth, b.encodeHeight, b.fps, b.dxgiFormat = req.EncodeWidth, req.EncodeHeight, req.FPS, req.DXGIFormat
	}
	pendingIDR := b.forceIDR.Swap(false)
	forceIDR := req.ForceIDR || pendingIDR
	for attempts := 0; attempts < 2; attempts++ {
		result, size, err := b.encoder.Encode(req.Texture, forceIDR, b.output)
		if err != nil {
			return nil, err
		}
		if result == 2 {
			if size <= 0 || size > 64*1024*1024 {
				return nil, fmt.Errorf("oneVPL returned invalid output size %d", size)
			}
			b.output = make([]byte, size)
			forceIDR = false
			continue
		}
		if size == 0 {
			return nil, nil
		}
		out := make([]byte, size)
		copy(out, b.output[:size])
		return out, nil
	}
	return nil, fmt.Errorf("oneVPL output buffer resize retry failed")
}

func (b *qsvD3D11TextureBackend) RequestKeyframe() { b.forceIDR.Store(true) }
func (b *qsvD3D11TextureBackend) Reset() {
	if b.encoder != nil {
		b.encoder.Close()
	}
	b.encoder, b.device = nil, nil
	b.forceIDR.Store(false)
}

func probeQSVD3D11() (bool, string) { return qsvbridge.Probe() }
