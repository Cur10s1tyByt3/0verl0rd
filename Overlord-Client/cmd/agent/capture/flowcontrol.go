package capture

import (
	"sync/atomic"
	"time"
)

const maxInFlightFrames int64 = 2

var (
	inFlightFrames atomic.Int64
	frameAckSeen   atomic.Bool
	lastAckNano    atomic.Int64
)

func AcquireFrameSlot() bool {
	if !frameAckSeen.Load() {
		return true
	}

	for {
		cur := inFlightFrames.Load()
		if cur >= maxInFlightFrames {
			lastAck := lastAckNano.Load()
			if lastAck > 0 && time.Since(time.Unix(0, lastAck)) > time.Second {
				inFlightFrames.Store(0)
				continue
			}
			return false
		}
		if inFlightFrames.CompareAndSwap(cur, cur+1) {
			return true
		}
	}
}

func ReleaseFrameSlot() {
	frameAckSeen.Store(true)
	lastAckNano.Store(time.Now().UnixNano())
	if inFlightFrames.Add(-1) < 0 {
		inFlightFrames.Store(0)
	}
}

func ResetFrameSlots() {
	inFlightFrames.Store(0)
	frameAckSeen.Store(false)
	lastAckNano.Store(0)
}
