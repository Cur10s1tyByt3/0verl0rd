package wire

import (
	"context"
	"sync"

	"nhooyr.io/websocket"
)

type SafeWriter struct {
	mu sync.Mutex
	w  Writer
}

func NewSafeWriter(w Writer) *SafeWriter {
	return &SafeWriter{w: w}
}

func (s *SafeWriter) Write(ctx context.Context, messageType websocket.MessageType, p []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.w.Write(ctx, messageType, p)
}
