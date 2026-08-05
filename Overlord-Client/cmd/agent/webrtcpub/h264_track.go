//go:build overlord_webrtc

package webrtcpub

import (
	"crypto/rand"
	"encoding/binary"
	"errors"
	"sync"
	"time"

	"github.com/pion/rtp"
	"github.com/pion/rtp/codecs"
	"github.com/pion/webrtc/v4"
)

const (
	h264ClockRate = 90_000
	h264RTPMTU    = 1200
)

type rtpPacketSink interface {
	WriteRTP(*rtp.Packet) error
}

type h264TrackWriter struct {
	mu          sync.Mutex
	t           rtpPacketSink
	packetizer  rtp.Packetizer
	timestamp   uint32
	lastCapture time.Time
}

func newH264TrackWriter(track *webrtc.TrackLocalStaticRTP) *h264TrackWriter {
	return newH264TrackWriterWithSink(track, randomRTPVideoTimestamp())
}

func newH264TrackWriterWithSink(sink rtpPacketSink, initialTimestamp uint32) *h264TrackWriter {
	return &h264TrackWriter{
		t: sink,
		packetizer: rtp.NewPacketizer(
			h264RTPMTU, 0, initialTimestamp, &codecs.H264Payloader{},
			rtp.NewRandomSequencer(), h264ClockRate,
		),
		timestamp: initialTimestamp,
	}
}

func randomRTPVideoTimestamp() uint32 {
	var value [4]byte
	if _, err := rand.Read(value[:]); err == nil {
		return binary.BigEndian.Uint32(value[:])
	}
	return uint32(time.Now().UnixNano())
}

func (w *h264TrackWriter) WriteH264(nalu []byte, capturedAt time.Time) error {
	if len(nalu) == 0 {
		return nil
	}
	if capturedAt.IsZero() {
		capturedAt = time.Now()
	}

	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.lastCapture.IsZero() && capturedAt.After(w.lastCapture) {
		ticks := uint64(capturedAt.Sub(w.lastCapture).Seconds() * h264ClockRate)
		if ticks == 0 {
			ticks = 1
		}
		w.timestamp += uint32(ticks)
	}
	w.lastCapture = capturedAt

	packets := w.packetizer.Packetize(nalu, 0)
	var writeErrs []error
	for _, packet := range packets {
		packet.Timestamp = w.timestamp
		if err := w.t.WriteRTP(packet); err != nil {
			writeErrs = append(writeErrs, err)
		}
	}
	return errors.Join(writeErrs...)
}
