package capture

import (
	"testing"

	"overlord-client/cmd/agent/webrtcpub"
)

func TestRetainKeyframeRequestUntilIDROutput(t *testing.T) {
	kind := webrtcpub.KindDesktop
	_ = webrtcpub.ConsumeKeyframeRequest(kind)

	if retainKeyframeRequestUntilOutput(kind, true, "h264", []byte{0, 0, 1, 0x41, 1}) {
		t.Fatal("delta access unit was classified as a keyframe")
	}
	if !webrtcpub.ConsumeKeyframeRequest(kind) {
		t.Fatal("keyframe request was not retained after delta output")
	}

	if !retainKeyframeRequestUntilOutput(kind, true, "h264", []byte{0, 0, 1, 0x65, 1}) {
		t.Fatal("IDR access unit was not classified as a keyframe")
	}
	if !webrtcpub.ConsumeKeyframeRequest(kind) {
		t.Fatal("keyframe request was not retained when IDR omitted SPS/PPS")
	}

	recoveryPoint := []byte{
		0, 0, 1, 0x67, 1,
		0, 0, 1, 0x68, 1,
		0, 0, 1, 0x65, 1,
	}
	if !retainKeyframeRequestUntilOutput(kind, true, "h264", recoveryPoint) {
		t.Fatal("complete recovery access unit was not classified as a keyframe")
	}
	if webrtcpub.ConsumeKeyframeRequest(kind) {
		t.Fatal("completed keyframe request was unexpectedly requeued")
	}
}
