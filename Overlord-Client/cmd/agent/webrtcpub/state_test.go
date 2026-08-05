package webrtcpub

import (
	"sync"
	"testing"
	"time"

	"overlord-client/cmd/agent/h264util"
)

type blockingVideoWriter struct {
	started chan struct{}
	release chan struct{}
	mu      sync.Mutex
	frames  [][]byte
}

func (w *blockingVideoWriter) WriteH264(frame []byte, _ time.Time) error {
	w.mu.Lock()
	w.frames = append(w.frames, append([]byte(nil), frame...))
	count := len(w.frames)
	w.mu.Unlock()
	if count == 1 {
		close(w.started)
		<-w.release
	}
	return nil
}

func annexBDelta(value byte) []byte {
	return []byte{0, 0, 0, 1, 0x41, value}
}

func annexBKey(value byte) []byte {
	return []byte{0, 0, 0, 1, 0x67, 1, 0, 0, 1, 0x68, 1, 0, 0, 1, 0x65, value}
}

func TestWriteH264DoesNotBlockAndRequestsRecoveryAfterDroppingDelta(t *testing.T) {
	kind := Kind("queue-test")
	id := "slow-writer"
	writer := &blockingVideoWriter{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	registerVideoWriter(kind, id, writer)
	defer unregisterWriter(kind, id)
	_ = ConsumeKeyframeRequest(kind)

	if err := WriteH264(kind, annexBDelta(1), time.Now()); err != nil {
		t.Fatal(err)
	}
	select {
	case <-writer.started:
	case <-time.After(time.Second):
		t.Fatal("writer did not receive first frame")
	}

	started := time.Now()
	for frame := 2; frame <= maxPendingVideoFrames+2; frame++ {
		_ = WriteH264(kind, annexBDelta(byte(frame)), time.Now())
	}
	if elapsed := time.Since(started); elapsed > 100*time.Millisecond {
		t.Fatalf("capture path blocked for %s", elapsed)
	}
	if !ConsumeKeyframeRequest(kind) {
		t.Fatal("dropping a predictive frame did not request a keyframe")
	}
	_ = WriteH264(kind, annexBKey(9), time.Now())
	close(writer.release)

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		writer.mu.Lock()
		frames := append([][]byte(nil), writer.frames...)
		writer.mu.Unlock()
		if len(frames) >= 2 {
			if frames[0][len(frames[0])-1] != 1 || !h264util.IsIDR(frames[1]) {
				t.Fatalf("expected first frame followed by recovery IDR, got %v", frames)
			}
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("recovery keyframe was not delivered")
}

func TestLatestFrameQueuePreservesPendingRecoveryFrame(t *testing.T) {
	kind := Kind("keyframe-queue-test")
	id := "slow-writer"
	writer := &blockingVideoWriter{started: make(chan struct{}), release: make(chan struct{})}
	registerVideoWriter(kind, id, writer)
	defer unregisterWriter(kind, id)
	_ = ConsumeKeyframeRequest(kind)

	_ = WriteH264(kind, annexBDelta(1), time.Now())
	select {
	case <-writer.started:
	case <-time.After(time.Second):
		t.Fatal("writer did not receive first frame")
	}
	_ = WriteH264(kind, annexBKey(9), time.Now())
	_ = WriteH264(kind, annexBDelta(3), time.Now())
	close(writer.release)

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		writer.mu.Lock()
		frames := append([][]byte(nil), writer.frames...)
		writer.mu.Unlock()
		if len(frames) >= 2 {
			if !h264util.IsIDR(frames[1]) {
				t.Fatalf("pending recovery frame was replaced by a delta: %v", frames)
			}
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("pending recovery frame was not delivered")
}

func TestKeyframeRequestsAreIsolatedByStreamKind(t *testing.T) {
	for _, kind := range []Kind{KindDesktop, Kindbackstage, KindWebcam} {
		_ = ConsumeKeyframeRequest(kind)
	}

	RequestKeyframe(Kindbackstage)

	if ConsumeKeyframeRequest(KindDesktop) {
		t.Fatal("backstage keyframe request leaked into desktop stream")
	}
	if ConsumeKeyframeRequest(KindWebcam) {
		t.Fatal("backstage keyframe request leaked into webcam stream")
	}
	if !ConsumeKeyframeRequest(Kindbackstage) {
		t.Fatal("backstage keyframe request was not retained for backstage stream")
	}
}
