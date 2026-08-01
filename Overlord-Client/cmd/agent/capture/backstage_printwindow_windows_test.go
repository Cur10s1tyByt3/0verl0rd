//go:build windows

package capture

import (
	"testing"
	"time"
)

func TestBackstageWindowCacheByteSizeAndLimit(t *testing.T) {
	bytes, ok := backstageWindowCacheByteSize(3840, 2160)
	if !ok || bytes != 3840*2160*4 {
		t.Fatalf("4K cache size = %d, ok=%v", bytes, ok)
	}
	if bytes > backstageMaxWindowCacheBytes {
		t.Fatal("one 4K window should fit within the cache budget")
	}
	if _, ok := backstageWindowCacheByteSize(0, 2160); ok {
		t.Fatal("zero-width cache entry was accepted")
	}
}

func TestBackstageClearWindowCacheResetsAccounting(t *testing.T) {
	savedCache := backstageWinCache
	savedBytes := backstageWinCacheBytes
	backstageWinCache = map[uintptr]*backstageWinCacheEntry{
		1: {bytes: 40},
		2: {bytes: 60},
	}
	backstageWinCacheBytes = 100
	t.Cleanup(func() {
		backstageWinCache = savedCache
		backstageWinCacheBytes = savedBytes
	})

	backstageClearWindowCache()
	if backstageWinCache != nil || backstageWinCacheBytes != 0 {
		t.Fatalf("cache cleanup left entries=%d bytes=%d", len(backstageWinCache), backstageWinCacheBytes)
	}
}

func TestBackstagePrintWindowFallbackToggle(t *testing.T) {
	SetbackstagePrintWindowFallbackEnabled(true)
	t.Cleanup(func() { SetbackstagePrintWindowFallbackEnabled(true) })

	if !GetbackstagePrintWindowFallbackEnabled() {
		t.Fatal("PrintWindow fallback must be enabled by default")
	}
	SetbackstagePrintWindowFallbackEnabled(false)
	if GetbackstagePrintWindowFallbackEnabled() {
		t.Fatal("PrintWindow fallback did not disable")
	}
	SetbackstagePrintWindowFallbackEnabled(true)
	if !GetbackstagePrintWindowFallbackEnabled() {
		t.Fatal("PrintWindow fallback did not re-enable")
	}
}

func TestBackstagePrintWindowTimeoutQuarantinesHungWindow(t *testing.T) {
	savedFn := backstagePrintWindowFn
	savedCache := backstageWinCache
	savedBytes := backstageWinCacheBytes
	savedHung := backstageHungWindows
	release := make(chan struct{})
	returned := make(chan struct{})
	backstagePrintWindowFn = func(_, _ uintptr, _ uint32) bool {
		<-release
		close(returned)
		return true
	}
	entry := &backstageWinCacheEntry{bytes: 64}
	const hwnd = uintptr(0x1234)
	backstageWinCache = map[uintptr]*backstageWinCacheEntry{hwnd: entry}
	backstageWinCacheBytes = entry.bytes
	backstageHungWindows = make(map[uintptr]struct{})
	t.Cleanup(func() {
		close(release)
		select {
		case <-returned:
		case <-time.After(time.Second):
			t.Error("timed-out PrintWindow worker did not exit after release")
		}
		backstagePrintWindowFn = savedFn
		backstageWinCache = savedCache
		backstageWinCacheBytes = savedBytes
		backstageHungWindows = savedHung
	})

	start := time.Now()
	if backstagePrintWindowWithTimeout(hwnd, entry) {
		t.Fatal("hung PrintWindow unexpectedly succeeded")
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("PrintWindow timeout took too long: %s", elapsed)
	}
	if backstageWinCache[hwnd] != nil || backstageWinCacheBytes != 0 {
		t.Fatal("timed-out PrintWindow cache entry was not detached")
	}
	if _, ok := backstageHungWindows[hwnd]; !ok {
		t.Fatal("timed-out window was not quarantined")
	}
}
