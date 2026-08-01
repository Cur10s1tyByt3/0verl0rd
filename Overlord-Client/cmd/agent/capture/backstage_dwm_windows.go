//go:build windows

package capture

import (
	"image"
	"log"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	dwmapi                              = windows.NewLazySystemDLL("dwmapi.dll")
	procDwmRegisterThumbnail            = dwmapi.NewProc("DwmRegisterThumbnail")
	procDwmUnregisterThumbnail          = dwmapi.NewProc("DwmUnregisterThumbnail")
	procDwmUpdateThumbnailProperties    = dwmapi.NewProc("DwmUpdateThumbnailProperties")
	procDwmQueryThumbnailSourceSize     = dwmapi.NewProc("DwmQueryThumbnailSourceSize")
	procDWMCreateWindowExW              = user32.NewProc("CreateWindowExW")
	procDWMShowWindow                   = user32.NewProc("ShowWindow")
	procDWMUpdateWindow                 = user32.NewProc("UpdateWindow")
	procDWMDestroyWindow                = user32.NewProc("DestroyWindow")
	backstageDWMStateMu                 sync.Mutex
	backstageDWMHost                    uintptr
	backstageDWMThumbnails              map[uintptr]*backstageDWMThumbnail
	backstageDWMOrder                   []uintptr
	backstageDWMLastFallbackLogUnixNano atomic.Int64
	backstageDWMLastPerfLogUnixNano     atomic.Int64
	backstageDWMLoggedActive            atomic.Bool
)

const (
	dwmTNPRectDestination = 0x00000001
	dwmTNPRectSource      = 0x00000002
	dwmTNPVisible         = 0x00000008

	backstageDWMWSExTransparent  = 0x00000020
	backstageDWMWSExToolWindow   = 0x00000080
	backstageDWMWSExNoActivate   = 0x08000000
	backstageDWMWSDisabled       = 0x08000000
	backstageDWMWSVisible        = 0x10000000
	backstageDWMWSDisabledPopup  = 0x80000000 | backstageDWMWSDisabled | backstageDWMWSVisible
	backstageDWMSSBlackRect      = 0x00000004
	backstageDWMSWShowNoActivate = 4
	backstageDWMHWNDBottom       = 1
)

type dwmThumbnailProperties struct {
	flags                uint32
	destination          rect
	source               rect
	opacity              byte
	_padding             [3]byte
	visible              int32
	sourceClientAreaOnly int32
}

type backstageDWMSize struct {
	cx int32
	cy int32
}

type backstageDWMThumbnail struct {
	handle uintptr
	size   backstageDWMSize
}

type backstageDWMCandidate struct {
	hwnd       uintptr
	windowRect rect
}

type backstageDWMPerf struct {
	outputW   int
	outputH   int
	windows   int
	rebuilt   bool
	setup     time.Duration
	enumerate time.Duration
	register  time.Duration
	update    time.Duration
	readback  time.Duration
	validate  time.Duration
	total     time.Duration
	success   bool
	failure   string
}

func backstageIsDWMHost(hwnd uintptr) bool {
	if hwnd == 0 {
		return false
	}
	backstageDWMStateMu.Lock()
	isHost := backstageDWMHost == hwnd
	backstageDWMStateMu.Unlock()
	return isHost
}

func drawbackstageStagingFromDWM(hdcMem uintptr, bounds image.Rectangle, outputW, outputH int, target []byte) (success bool) {
	if hdcMem == 0 || bounds.Empty() || outputW <= 0 || outputH <= 0 {
		return false
	}

	started := time.Now()
	perf := backstageDWMPerf{outputW: outputW, outputH: outputH}
	defer func() {
		perf.success = success
		perf.total = time.Since(started)
		backstageLogDWMPerf(perf, bounds)
	}()

	backstageDWMStateMu.Lock()
	defer backstageDWMStateMu.Unlock()

	stageStarted := time.Now()
	host := backstageEnsureDWMHostLocked(bounds, outputW, outputH)
	perf.setup = time.Since(stageStarted)
	if host == 0 {
		perf.failure = "host"
		backstageLogDWMFallback("staging window is unavailable")
		return false
	}

	stageStarted = time.Now()
	candidates := backstageCollectDWMCandidatesLocked(host, bounds)
	perf.enumerate = time.Since(stageStarted)
	perf.windows = len(candidates)
	if len(candidates) == 0 {
		perf.failure = "no_sources"
		backstageLogDWMFallback("no source windows are available")
		return false
	}

	order := make([]uintptr, len(candidates))
	for index, candidate := range candidates {
		order[index] = candidate.hwnd
	}
	if !backstageDWMOrdersEqual(backstageDWMOrder, order) {
		perf.rebuilt = true
		backstageUnregisterDWMThumbnailsLocked()
		backstageDWMOrder = append(backstageDWMOrder[:0], order...)
	}
	if backstageDWMThumbnails == nil {
		backstageDWMThumbnails = make(map[uintptr]*backstageDWMThumbnail)
	}

	registerStarted := time.Now()
	updated := 0
	for _, candidate := range candidates {
		entry := backstageDWMThumbnails[candidate.hwnd]
		if entry == nil {
			entry = backstageRegisterDWMThumbnailLocked(host, candidate.hwnd)
			if entry == nil {
				continue
			}
			backstageDWMThumbnails[candidate.hwnd] = entry
		}
	}
	perf.register = time.Since(registerStarted)

	updateStarted := time.Now()
	for _, candidate := range candidates {
		entry := backstageDWMThumbnails[candidate.hwnd]
		if entry == nil {
			continue
		}
		destinationRect, sourceRect, ok := backstageDWMThumbnailRects(
			candidate.windowRect,
			bounds,
			int(entry.size.cx),
			int(entry.size.cy),
			outputW,
			outputH,
		)
		if !ok {
			continue
		}
		properties := dwmThumbnailProperties{
			flags:       dwmTNPRectDestination | dwmTNPRectSource | dwmTNPVisible,
			destination: destinationRect,
			source:      sourceRect,
			opacity:     255,
			visible:     1,
		}
		result, _, _ := procDwmUpdateThumbnailProperties.Call(
			entry.handle,
			uintptr(unsafe.Pointer(&properties)),
		)
		if int32(result) >= 0 {
			updated++
		}
	}
	perf.update = time.Since(updateStarted)
	if updated == 0 {
		perf.failure = "update"
		backstageLogDWMFallback("no thumbnail relationships were updated")
		return false
	}

	readbackStarted := time.Now()
	if !printWindow(host, hdcMem, PW_RENDERFULLCONTENT) {
		perf.readback = time.Since(readbackStarted)
		perf.failure = "readback"
		backstageLogDWMFallback("PrintWindow staging readback failed")
		return false
	}
	perf.readback = time.Since(readbackStarted)

	validateStarted := time.Now()
	if !backstageDWMFrameHasContent(target) {
		perf.validate = time.Since(validateStarted)
		perf.failure = "empty"
		backstageLogDWMFallback("PrintWindow staging readback was empty")
		return false
	}
	perf.validate = time.Since(validateStarted)
	if backstageDWMLoggedActive.CompareAndSwap(false, true) {
		log.Printf("backstage dwm: staging thumbnail composite active (%d windows, %dx%d)", updated, outputW, outputH)
	}
	return true
}

func backstageEnsureDWMHostLocked(bounds image.Rectangle, outputW, outputH int) uintptr {
	if backstageDWMHost == 0 {
		className, err := syscall.UTF16PtrFromString("Static")
		if err != nil {
			return 0
		}
		title, err := syscall.UTF16PtrFromString("Overlord DWM Backstage Staging")
		if err != nil {
			return 0
		}
		host, _, _ := procDWMCreateWindowExW.Call(
			backstageDWMWSExTransparent|backstageDWMWSExToolWindow|backstageDWMWSExNoActivate,
			uintptr(unsafe.Pointer(className)),
			uintptr(unsafe.Pointer(title)),
			backstageDWMWSDisabledPopup|backstageDWMSSBlackRect,
			uintptr(int32(bounds.Min.X)),
			uintptr(int32(bounds.Min.Y)),
			uintptr(int32(outputW)),
			uintptr(int32(outputH)),
			0,
			0,
			0,
			0,
		)
		if host == 0 {
			return 0
		}
		backstageDWMHost = host
		procDWMShowWindow.Call(host, backstageDWMSWShowNoActivate)
		procDWMUpdateWindow.Call(host)
	}

	procSetWindowPos.Call(
		backstageDWMHost,
		backstageDWMHWNDBottom,
		uintptr(int32(bounds.Min.X)),
		uintptr(int32(bounds.Min.Y)),
		uintptr(int32(outputW)),
		uintptr(int32(outputH)),
		SWP_NOACTIVATE|SWP_SHOWWINDOW,
	)
	return backstageDWMHost
}

func backstageCollectDWMCandidatesLocked(host uintptr, bounds image.Rectangle) []backstageDWMCandidate {
	var candidates []backstageDWMCandidate
	hwnd := getTopWindow(0)
	if hwnd != 0 {
		hwnd = getWindow(hwnd, GW_HWNDLAST)
	}
	for hwnd != 0 {
		next := getWindow(hwnd, GW_HWNDPREV)
		if hwnd != host && isWindowVisible(hwnd) {
			var windowRect rect
			ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&windowRect)))
			if ok != 0 &&
				windowRect.right > windowRect.left &&
				windowRect.bottom > windowRect.top &&
				rectIntersectsImage(windowRect, bounds) {
				candidates = append(candidates, backstageDWMCandidate{
					hwnd:       hwnd,
					windowRect: windowRect,
				})
			}
		}
		hwnd = next
	}
	return candidates
}

func backstageRegisterDWMThumbnailLocked(host, source uintptr) *backstageDWMThumbnail {
	var thumbnail uintptr
	result, _, _ := procDwmRegisterThumbnail.Call(
		host,
		source,
		uintptr(unsafe.Pointer(&thumbnail)),
	)
	if int32(result) < 0 || thumbnail == 0 {
		return nil
	}

	var size backstageDWMSize
	queryResult, _, _ := procDwmQueryThumbnailSourceSize.Call(
		thumbnail,
		uintptr(unsafe.Pointer(&size)),
	)
	if int32(queryResult) < 0 || size.cx <= 0 || size.cy <= 0 {
		var windowRect rect
		ok, _, _ := procGetWindowRect.Call(source, uintptr(unsafe.Pointer(&windowRect)))
		if ok == 0 {
			procDwmUnregisterThumbnail.Call(thumbnail)
			return nil
		}
		size.cx = windowRect.right - windowRect.left
		size.cy = windowRect.bottom - windowRect.top
	}
	return &backstageDWMThumbnail{handle: thumbnail, size: size}
}

func backstageDWMThumbnailRects(windowRect rect, bounds image.Rectangle, sourceW, sourceH, outputW, outputH int) (rect, rect, bool) {
	winW := int(windowRect.right - windowRect.left)
	winH := int(windowRect.bottom - windowRect.top)
	boundsW := bounds.Dx()
	boundsH := bounds.Dy()
	if winW <= 0 || winH <= 0 || sourceW <= 0 || sourceH <= 0 ||
		boundsW <= 0 || boundsH <= 0 || outputW <= 0 || outputH <= 0 {
		return rect{}, rect{}, false
	}

	left := maxInt(int(windowRect.left), bounds.Min.X)
	top := maxInt(int(windowRect.top), bounds.Min.Y)
	right := minInt(int(windowRect.right), bounds.Max.X)
	bottom := minInt(int(windowRect.bottom), bounds.Max.Y)
	if right <= left || bottom <= top {
		return rect{}, rect{}, false
	}

	destination := rect{
		left:   int32((left - bounds.Min.X) * outputW / boundsW),
		top:    int32((top - bounds.Min.Y) * outputH / boundsH),
		right:  int32(((right-bounds.Min.X)*outputW + boundsW - 1) / boundsW),
		bottom: int32(((bottom-bounds.Min.Y)*outputH + boundsH - 1) / boundsH),
	}
	source := rect{
		left:   int32((left - int(windowRect.left)) * sourceW / winW),
		top:    int32((top - int(windowRect.top)) * sourceH / winH),
		right:  int32(((right-int(windowRect.left))*sourceW + winW - 1) / winW),
		bottom: int32(((bottom-int(windowRect.top))*sourceH + winH - 1) / winH),
	}
	if source.right > int32(sourceW) {
		source.right = int32(sourceW)
	}
	if source.bottom > int32(sourceH) {
		source.bottom = int32(sourceH)
	}
	return destination, source, true
}

func rectIntersectsImage(windowRect rect, bounds image.Rectangle) bool {
	return int(windowRect.right) > bounds.Min.X &&
		int(windowRect.left) < bounds.Max.X &&
		int(windowRect.bottom) > bounds.Min.Y &&
		int(windowRect.top) < bounds.Max.Y
}

func backstageDWMOrdersEqual(left, right []uintptr) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func backstageDWMFrameHasContent(frame []byte) bool {
	if len(frame) < 4 {
		return false
	}
	stepPixels := len(frame) / 4 / (128 * 128)
	if stepPixels < 1 {
		stepPixels = 1
	}
	step := stepPixels * 4
	for offset := 0; offset+2 < len(frame); offset += step {
		if frame[offset]|frame[offset+1]|frame[offset+2] != 0 {
			return true
		}
	}
	return false
}

func backstageEnsureDWMCompCache(w, h int) (uintptr, []byte, bool) {
	if backstageCompHdcMem != 0 &&
		backstageCompW == w &&
		backstageCompH == h &&
		backstageCompBits != nil {
		return backstageCompHdcMem, unsafe.Slice((*byte)(backstageCompBits), w*h*4), true
	}

	if backstageCompHbmp != 0 {
		deleteObject(backstageCompHbmp)
		backstageCompHbmp = 0
	}
	if backstageCompHdcMem != 0 {
		deleteDC(backstageCompHdcMem)
		backstageCompHdcMem = 0
	}
	backstageCompBits = nil
	backstageCompW = 0
	backstageCompH = 0

	screenDC := getDC(0)
	if screenDC == 0 {
		return 0, nil, false
	}
	backstageCompHdcMem = createCompatibleDC(screenDC)
	releaseDC(0, screenDC)
	if backstageCompHdcMem == 0 {
		return 0, nil, false
	}

	info := bitmapInfo{
		bmiHeader: bitmapInfoHeader{
			biSize:        uint32(unsafe.Sizeof(bitmapInfoHeader{})),
			biWidth:       int32(w),
			biHeight:      -int32(h),
			biPlanes:      1,
			biBitCount:    32,
			biCompression: BI_RGB,
		},
	}
	backstageCompHbmp = createDIBSection(
		backstageCompHdcMem,
		&info,
		DIB_RGB_COLORS,
		&backstageCompBits,
	)
	if backstageCompHbmp == 0 || backstageCompBits == nil {
		deleteDC(backstageCompHdcMem)
		backstageCompHdcMem = 0
		backstageCompBits = nil
		return 0, nil, false
	}
	selectObject(backstageCompHdcMem, backstageCompHbmp)
	backstageCompW = w
	backstageCompH = h
	return backstageCompHdcMem, unsafe.Slice((*byte)(backstageCompBits), w*h*4), true
}

func backstageCleanupDWMThumbnails() {
	backstageDWMStateMu.Lock()
	defer backstageDWMStateMu.Unlock()
	backstageUnregisterDWMThumbnailsLocked()
	if backstageDWMHost != 0 {
		// This runs on the worker that created the host. Destroying the HWND is
		// required before that OS thread can be moved back to its original
		// desktop; merely hiding it leaves SetThreadDesktop failing with
		// ERROR_BUSY on the next lifecycle.
		procDWMDestroyWindow.Call(backstageDWMHost)
	}
	backstageDWMHost = 0
}

func backstageAbandonDWMThumbnails() {
	backstageDWMStateMu.Lock()
	backstageDWMThumbnails = nil
	backstageDWMOrder = nil
	backstageDWMHost = 0
	backstageDWMStateMu.Unlock()
}

func backstageUnregisterDWMThumbnailsLocked() {
	for source, entry := range backstageDWMThumbnails {
		procDwmUnregisterThumbnail.Call(entry.handle)
		delete(backstageDWMThumbnails, source)
	}
	backstageDWMThumbnails = nil
	backstageDWMOrder = nil
}

func backstageLogDWMFallback(reason string) {
	now := time.Now().UnixNano()
	last := backstageDWMLastFallbackLogUnixNano.Load()
	if now-last < int64(5*time.Second) ||
		!backstageDWMLastFallbackLogUnixNano.CompareAndSwap(last, now) {
		return
	}
	log.Printf("backstage dwm: %s; using DXGI/PrintWindow fallback", reason)
}

func backstageLogDWMPerf(perf backstageDWMPerf, bounds image.Rectangle) {
	if !captureMetricsEnabled() {
		return
	}
	now := time.Now().UnixNano()
	last := backstageDWMLastPerfLogUnixNano.Load()
	if now-last < int64(5*time.Second) ||
		!backstageDWMLastPerfLogUnixNano.CompareAndSwap(last, now) {
		return
	}
	log.Printf(
		"backstage dwm perf: success=%v failure=%s source=%dx%d output=%dx%d windows=%d rebuilt=%v setup=%s enum=%s register=%s update=%s readback=%s validate=%s total=%s",
		perf.success,
		perf.failure,
		bounds.Dx(),
		bounds.Dy(),
		perf.outputW,
		perf.outputH,
		perf.windows,
		perf.rebuilt,
		perf.setup,
		perf.enumerate,
		perf.register,
		perf.update,
		perf.readback,
		perf.validate,
		perf.total,
	)
}
