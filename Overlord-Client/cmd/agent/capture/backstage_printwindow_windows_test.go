//go:build windows

package capture

import "testing"

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
