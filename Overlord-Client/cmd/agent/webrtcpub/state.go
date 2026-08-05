package webrtcpub

import (
	"sync"
	"sync/atomic"
	"time"

	"overlord-client/cmd/agent/h264util"
)

type Kind string

const (
	KindDesktop   Kind = "desktop"
	Kindbackstage Kind = "backstage"
	KindWebcam    Kind = "webcam"
	KindAudio     Kind = "audio"
)

type VideoWriter interface {
	WriteH264(nalu []byte, capturedAt time.Time) error
}

type AudioWriter interface {
	WriteAudio(pcm []int16) error
}

type writerEntry struct {
	video *latestVideoWriter
	audio AudioWriter
}

// Keep at most one frame behind the frame currently being packetized. Remote
// desktop latency is more important than preserving stale predictive frames.
const maxPendingVideoFrames = 1

type queuedVideoFrame struct {
	data       []byte
	capturedAt time.Time
	key        bool
}

type latestVideoWriter struct {
	writer        VideoWriter
	kind          Kind
	mu            sync.Mutex
	pending       []queuedVideoFrame
	needsKeyframe bool
	closed        bool
	wake          chan struct{}
}

func newLatestVideoWriter(kind Kind, writer VideoWriter) *latestVideoWriter {
	queued := &latestVideoWriter{writer: writer, kind: kind, wake: make(chan struct{}, 1)}
	go queued.run()
	return queued
}

func (w *latestVideoWriter) enqueue(frame []byte, capturedAt time.Time) {
	isKey := h264util.IsIDR(frame)
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	if w.needsKeyframe && !isKey {
		w.mu.Unlock()
		RequestKeyframe(w.kind)
		return
	}

	requestKeyframe := false
	if len(w.pending) >= maxPendingVideoFrames {
		// Never evict a recovery IDR in favor of a dependent P-frame. It is
		// already the newest independently decodable state available. Since the
		// discarded P-frame can be referenced later, request another recovery
		// point before accepting subsequent deltas.
		if w.pending[len(w.pending)-1].key && !isKey {
			w.needsKeyframe = true
			w.mu.Unlock()
			RequestKeyframe(w.kind)
			return
		}
		w.pending = nil
		if isKey {
			w.needsKeyframe = false
		} else {
			w.needsKeyframe = true
			requestKeyframe = true
			w.mu.Unlock()
			RequestKeyframe(w.kind)
			return
		}
	}
	if isKey && w.needsKeyframe {
		w.pending = nil
		w.needsKeyframe = false
		requestKeyframe = false
	}
	w.pending = append(w.pending, queuedVideoFrame{data: frame, capturedAt: capturedAt, key: isKey})
	w.mu.Unlock()
	if requestKeyframe {
		RequestKeyframe(w.kind)
	}
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

func (w *latestVideoWriter) close() {
	w.mu.Lock()
	w.closed = true
	w.pending = nil
	w.mu.Unlock()
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

func (w *latestVideoWriter) run() {
	for range w.wake {
		for {
			w.mu.Lock()
			if w.closed {
				w.mu.Unlock()
				return
			}
			if len(w.pending) == 0 {
				w.mu.Unlock()
				break
			}
			frame := w.pending[0]
			w.pending[0] = queuedVideoFrame{}
			w.pending = w.pending[1:]
			w.mu.Unlock()
			err := w.writer.WriteH264(frame.data, frame.capturedAt)
			requestKeyframe := false
			w.mu.Lock()
			if err != nil {
				w.pending = nil
				w.needsKeyframe = true
				requestKeyframe = true
			}
			w.mu.Unlock()
			if requestKeyframe {
				RequestKeyframe(w.kind)
			}
		}
	}
}

var (
	writersMu sync.RWMutex
	writers   = map[string]map[string]writerEntry{} // kind → id → entry
)

func registerVideoWriter(kind Kind, id string, w VideoWriter) {
	if id == "" || w == nil {
		return
	}
	writersMu.Lock()
	bucket := writers[string(kind)]
	if bucket == nil {
		bucket = map[string]writerEntry{}
		writers[string(kind)] = bucket
	}
	entry := bucket[id]
	if entry.video != nil {
		entry.video.close()
	}
	entry.video = newLatestVideoWriter(kind, w)
	bucket[id] = entry
	writersMu.Unlock()
	RequestKeyframe(kind)
}

func registerAudioWriter(kind Kind, id string, w AudioWriter) {
	if id == "" || w == nil {
		return
	}
	writersMu.Lock()
	bucket := writers[string(kind)]
	if bucket == nil {
		bucket = map[string]writerEntry{}
		writers[string(kind)] = bucket
	}
	entry := bucket[id]
	entry.audio = w
	bucket[id] = entry
	writersMu.Unlock()
}

func unregisterWriter(kind Kind, id string) {
	if id == "" {
		return
	}
	writersMu.Lock()
	if bucket, ok := writers[string(kind)]; ok {
		if entry, exists := bucket[id]; exists && entry.video != nil {
			entry.video.close()
		}
		delete(bucket, id)
		if len(bucket) == 0 {
			delete(writers, string(kind))
		}
	}
	writersMu.Unlock()
}

// IsActive reports whether any writer of the given kind is registered.
// Callers in capture loops use this as a cheap "should I divert this frame
// to WebRTC?" check before doing more expensive work.
func IsActive(kind Kind) bool {
	writersMu.RLock()
	defer writersMu.RUnlock()
	return len(writers[string(kind)]) > 0
}

var (
	desktopKeyframeWanted   atomic.Bool
	backstageKeyframeWanted atomic.Bool
	webcamKeyframeWanted    atomic.Bool
)

func keyframeRequestFlag(kind Kind) *atomic.Bool {
	switch kind {
	case Kindbackstage:
		return &backstageKeyframeWanted
	case KindWebcam:
		return &webcamKeyframeWanted
	default:
		return &desktopKeyframeWanted
	}
}

func RequestKeyframe(kind Kind) {
	keyframeRequestFlag(kind).Store(true)
}

func ConsumeKeyframeRequest(kind Kind) bool {
	return keyframeRequestFlag(kind).Swap(false)
}

func WriteH264(kind Kind, nalu []byte, capturedAt time.Time) error {
	if len(nalu) == 0 {
		return nil
	}
	frame := append([]byte(nil), nalu...)
	writersMu.RLock()
	bucket := writers[string(kind)]
	targets := make([]*latestVideoWriter, 0, len(bucket))
	for _, w := range bucket {
		if w.video != nil {
			targets = append(targets, w.video)
		}
	}
	writersMu.RUnlock()
	for _, target := range targets {
		target.enqueue(frame, capturedAt)
	}
	return nil
}

func WriteAudio(kind Kind, pcm []int16) error {
	if len(pcm) == 0 {
		return nil
	}
	writersMu.RLock()
	bucket := writers[string(kind)]
	targets := make([]AudioWriter, 0, len(bucket))
	for _, w := range bucket {
		if w.audio != nil {
			targets = append(targets, w.audio)
		}
	}
	writersMu.RUnlock()
	for _, target := range targets {
		_ = target.WriteAudio(pcm)
	}
	return nil
}

type Options struct {
	// (e.g. https://server:5173/api/webrtc/agents/abc/desktop/whip).
	WhipURL string
	// PublishToken is the bearer token issued by the server.
	PublishToken string
	// TLSInsecureSkipVerify mirrors the agent's existing TLS config.
	TLSInsecureSkipVerify bool
	// TLSCAPath is an optional custom CA bundle.
	TLSCAPath   string
	TLSSPKIPins []string
	// ICEServers contains the server-issued, short-lived Coturn configuration.
	ICEServers []ICEServer
	// HasVideo / HasAudio select which tracks to add to the peer connection.
	HasVideo bool
	HasAudio bool
}

type ICECandidate struct {
	Candidate     string `msgpack:"candidate"`
	SDPMid        string `msgpack:"sdpMid"`
	SDPMLineIndex uint16 `msgpack:"sdpMLineIndex"`
}

type ICEServer struct {
	URLs       []string
	Username   string
	Credential string
}

type P2POfferCallbacks struct {
	ICEServers          []ICEServer
	OnICE               func(c ICECandidate)
	OnClose             func()
	OnBandwidthEstimate func(bps int)
	OnInput             func(payload []byte)
}
