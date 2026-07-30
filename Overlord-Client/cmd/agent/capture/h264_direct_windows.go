//go:build windows

package capture

import (
	"time"

	"overlord-client/cmd/agent/webrtcpub"
	"overlord-client/cmd/agent/wire"
)

func directVideoKeyframeDue(requested bool, nowNs, lastKeyframeNs int64) bool {
	if requested || lastKeyframeNs == 0 {
		return true
	}
	return videoKeyframeEvery > 0 && time.Duration(nowNs-lastKeyframeNs) >= videoKeyframeEvery
}

func directDesktopVideoEnabled() bool {
	return useDesktopDuplication()
}

func tryBuildDirectH264Frame(display int) (wire.Frame, time.Duration, time.Duration, bool, error) {
	codec := desktopCodec()
	if (codec != "h264" && codec != "hevc") || (codec == "h264" && useDesktopSoftwareH264()) || !useDesktopDuplication() {
		return wire.Frame{}, 0, 0, false, nil
	}
	now := time.Now()
	requestedKeyframe := webrtcpub.ConsumeKeyframeRequest(webrtcpub.KindDesktop)
	forceKeyframe := directVideoKeyframeDue(
		requestedKeyframe,
		now.UnixNano(),
		lastKeyframe.Load(),
	)
	var data []byte
	var width, height int
	var captureDur, encodeDur time.Duration
	var used bool
	var err error
	if codec == "hevc" {
		data, width, height, captureDur, encodeDur, used, err = captureDisplayDXGIHEVC(display, forceKeyframe)
	} else {
		data, width, height, captureDur, encodeDur, used, err = captureDisplayDXGIH264(display, forceKeyframe)
	}
	if !used || err != nil {
		if requestedKeyframe {
			webrtcpub.RequestKeyframe(webrtcpub.KindDesktop)
		}
		return wire.Frame{}, captureDur, encodeDur, used, err
	}
	if len(data) == 0 {
		if requestedKeyframe {
			webrtcpub.RequestKeyframe(webrtcpub.KindDesktop)
		}
		return wire.Frame{}, captureDur, encodeDur, true, nil
	}
	if retainKeyframeRequestUntilOutput(webrtcpub.KindDesktop, requestedKeyframe, codec, data) {
		lastKeyframe.Store(now.UnixNano())
	}
	statFullFrames.Add(1)
	return wire.Frame{Type: "frame", Header: wire.FrameHeader{Monitor: display, FPS: 0, Format: codec, Width: width, Height: height}, Data: data}, captureDur, encodeDur, true, nil
}
