//go:build overlord_webrtc

package webrtcpub

import (
	"testing"
	"time"

	"github.com/pion/rtp"
)

type recordingRTPSink struct {
	packets []*rtp.Packet
}

func (s *recordingRTPSink) WriteRTP(packet *rtp.Packet) error {
	clone := *packet
	clone.Payload = append([]byte(nil), packet.Payload...)
	s.packets = append(s.packets, &clone)
	return nil
}

func TestH264TrackWriterUsesCaptureClockForTimestamps(t *testing.T) {
	sink := &recordingRTPSink{}
	writer := newH264TrackWriterWithSink(sink, 1000)
	start := time.Unix(100, 0)

	if err := writer.WriteH264(annexBKey(1), start); err != nil {
		t.Fatal(err)
	}
	firstCount := len(sink.packets)
	if firstCount == 0 {
		t.Fatal("first frame produced no RTP packets")
	}
	if err := writer.WriteH264(annexBDelta(2), start.Add(250*time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	if len(sink.packets) <= firstCount {
		t.Fatal("second frame produced no RTP packets")
	}
	if got, want := sink.packets[firstCount].Timestamp-sink.packets[0].Timestamp, uint32(22500); got != want {
		t.Fatalf("capture-clock RTP delta=%d, want %d", got, want)
	}
}
